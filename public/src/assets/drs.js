// DRS archive reader (Age of Empires resource container).
// Layout: 40-byte copyright, 4-byte version, 12-byte type, int32 table count,
// int32 first file offset, then per table {char[4] ext (reversed), int32
// offset, int32 count} and per entry {int32 id, int32 offset, int32 size}.
export function parseDrs(buffer, name = '') {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 64) throw new Error(`${name}: not a DRS archive`);
  const version = String.fromCharCode(...bytes.subarray(40, 44));
  const nTables = dv.getInt32(56, true);
  if (nTables < 0 || nTables > 64) throw new Error(`${name}: not a DRS archive`);
  const entries = new Map();
  for (let t = 0; t < nTables; t++) {
    const o = 64 + t * 12;
    const ext = String.fromCharCode(bytes[o + 3], bytes[o + 2], bytes[o + 1], bytes[o]).trim();
    const toff = dv.getInt32(o + 4, true), n = dv.getInt32(o + 8, true);
    for (let i = 0; i < n; i++) {
      const e = toff + i * 12;
      const id = dv.getInt32(e, true), off = dv.getInt32(e + 4, true), size = dv.getInt32(e + 8, true);
      if (off < 0 || off + size > bytes.length) continue;
      entries.set(id, { ext, off, size });
    }
  }
  return {
    name, version, entries,
    has(id) { return entries.has(id); },
    get(id) { const e = entries.get(id); return e ? bytes.subarray(e.off, e.off + e.size) : null; },
    ext(id) { const e = entries.get(id); return e ? e.ext : null; },
  };
}

// Build a (small) DRS archive from selected entries: [{ id, ext, bytes }].
// Used to keep only the palette and icon sheets of the big interfac.drs.
export function writeDrs(entries) {
  const tables = new Map();
  for (const e of entries) {
    if (!tables.has(e.ext)) tables.set(e.ext, []);
    tables.get(e.ext).push(e);
  }
  const header = 64 + tables.size * 12;
  const index = entries.length * 12;
  let off = header + index;
  const total = off + entries.reduce((s, e) => s + e.bytes.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  const put = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  put(0, 'Copyright (c) 1997 Ensemble Studios.\x1a');
  put(40, '1.00');
  put(44, 'tribe');
  dv.setInt32(56, tables.size, true);
  dv.setInt32(60, off, true);
  let t = 0, eo = header;
  for (const [ext, list] of tables) {
    const e4 = (ext + '    ').slice(0, 4);
    for (let i = 0; i < 4; i++) out[64 + t * 12 + i] = e4.charCodeAt(3 - i);
    dv.setInt32(64 + t * 12 + 4, eo, true);
    dv.setInt32(64 + t * 12 + 8, list.length, true);
    for (const e of list) {
      dv.setInt32(eo, e.id, true); dv.setInt32(eo + 4, off, true); dv.setInt32(eo + 8, e.bytes.length, true);
      out.set(e.bytes, off);
      off += e.bytes.length; eo += 12;
    }
    t++;
  }
  return out;
}

// interfac.drs entries the game uses: palette, icon sheets (units, techs,
// buildings per architecture)
// palettes, icons, the AoE HD in-game interface (bars, buttons, stat icons,
// health bars, cursors, commands) and the main / setup / score screen pictures
export const INTERFACE_KEEP = [50500, 50704, 50705, 50706, 50707, 53005, 50729, 50730,
  50051, 50052, 50061, 50501, 50502, 50508, 50100, 50107, 50149,
  50721, 50731, 50732, 50745, 51000, 53007, 53008, 53010, 53011, 53012,
  ...Array.from({ length: 18 }, (_, i) => 50733 + i)];
export function stripInterface(drs) {
  return writeDrs(INTERFACE_KEEP.filter((id) => drs.has(id)).map((id) => ({ id, ext: drs.ext(id), bytes: drs.get(id) })));
}

// JASC-PAL text palette -> Uint8Array(768)
export function parsePalette(bytes) {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder('latin1').decode(bytes);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== 'JASC-PAL') throw new Error('palette: not JASC-PAL');
  const n = Math.min(256, parseInt(lines[2], 10) || 256);
  const pal = new Uint8Array(768);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = (lines[3 + i] || '0 0 0').split(/\s+/).map(Number);
    pal[i * 3] = r; pal[i * 3 + 1] = g; pal[i * 3 + 2] = b;
  }
  return pal;
}
