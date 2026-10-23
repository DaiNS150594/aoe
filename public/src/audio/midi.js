// Standard MIDI file reader (formats 0 and 1): the channel events of all
// tracks merged in time order, with times in seconds (tempo map applied).
//   events: { t, type: 'on' | 'off' | 'cc' | 'prog' | 'bend', ch, a, b }
export function parseMidi(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== 'MThd') throw new Error('not a MIDI file');
  const nTracks = dv.getUint16(10), division = dv.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');
  const raw = []; // { tick, order, ... }
  const tempos = []; // { tick, usPerQuarter }
  let o = 8 + dv.getUint32(4), order = 0;
  for (let t = 0; t < nTracks && o + 8 <= b.length; t++) {
    const len = dv.getUint32(o + 4), end = Math.min(b.length, o + 8 + len);
    const isTrack = tag(o) === 'MTrk';
    o += 8;
    if (!isTrack) { o = end; continue; }
    let tick = 0, running = 0;
    const vlq = () => { let v = 0, c; do { c = b[o++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && o < end); return v; };
    while (o < end) {
      tick += vlq();
      let st = b[o];
      if (st & 0x80) o++; else st = running;
      if (st === 0xff) {
        const type = b[o++], l = vlq();
        if (type === 0x51 && l === 3) tempos.push({ tick, us: (b[o] << 16) | (b[o + 1] << 8) | b[o + 2] });
        if (type === 0x2f) { o += l; break; }
        o += l;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) { o += vlq(); continue; }
      running = st;
      const hi = st & 0xf0, ch = st & 15;
      const a = b[o++];
      const c = hi === 0xc0 || hi === 0xd0 ? 0 : b[o++];
      let ev = null;
      if (hi === 0x90) ev = c ? { type: 'on', a, b: c } : { type: 'off', a, b: 0 };
      else if (hi === 0x80) ev = { type: 'off', a, b: 0 };
      else if (hi === 0xb0) ev = { type: 'cc', a, b: c };
      else if (hi === 0xc0) ev = { type: 'prog', a, b: 0 };
      else if (hi === 0xe0) ev = { type: 'bend', a: ((c << 7) | a) - 8192, b: 0 };
      if (ev) { ev.ch = ch; ev.tick = tick; ev.order = order++; raw.push(ev); }
    }
    o = end;
  }
  // ticks -> seconds through the tempo map (default 120 bpm)
  tempos.sort((x, y) => x.tick - y.tick);
  const seg = [{ tick: 0, sec: 0, spt: 0.5 / division }];
  for (const tp of tempos) {
    const last = seg[seg.length - 1];
    const sec = last.sec + (tp.tick - last.tick) * last.spt;
    if (tp.tick === last.tick) last.spt = tp.us / 1e6 / division;
    else seg.push({ tick: tp.tick, sec, spt: tp.us / 1e6 / division });
  }
  raw.sort((x, y) => x.tick - y.tick || x.order - y.order);
  let si = 0;
  const events = raw.map((ev) => {
    while (si + 1 < seg.length && seg[si + 1].tick <= ev.tick) si++;
    const s = seg[si];
    return { t: s.sec + (ev.tick - s.tick) * s.spt, type: ev.type, ch: ev.ch, a: ev.a, b: ev.b };
  });
  return { events, duration: events.length ? events[events.length - 1].t : 0 };
}
