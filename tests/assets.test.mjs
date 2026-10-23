// Tests for the original-asset readers (DRS, SLP, palette, empires.dat).
// The format tests use synthetic data; with AOE_DIR=<Rise of Rome folder>
// they also run against the player's own game files.
import fs from 'node:fs';
import path from 'node:path';
import { parseDrs, writeDrs, parsePalette, stripInterface } from '../public/src/assets/drs.js';
import { Slp, frameRGBA, PX_COLOR, PX_PLAYER, PX_SHADOW, PX_NONE } from '../public/src/assets/slp.js';
import { inflateRaw, parseEmpiresDat } from '../public/src/assets/dat.js';
import { AoeMapping } from '../public/src/assets/mapping.js';
import { EDGE_INDEX, edgeCase, parseEdges } from '../public/src/assets/edges.js';
import { parseMidi } from '../public/src/audio/midi.js';
import { parseDls } from '../public/src/audio/dls.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL:', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// ------------------------------------------------------- synthetic SLP
function buildSlp() {
  const w = 4, h = 4;
  const rows = [
    { left: 1, right: 1, cmds: [0x08, 10, 11, 0x0f] },          // lesser draw 2 px
    { left: 0, right: 2, cmds: [0x26, 3, 4, 0x0f] },            // player colour draw 2 px
    { left: 0, right: 1, cmds: [0x27, 7, 0x1b, 0x0f] },         // fill 2 px colour 7, 1 shadow px
    { left: 0x8000, right: 0x8000, cmds: [] },                  // transparent row
  ];
  const outline = 32 + 32, cmdTable = outline + h * 4;
  let data = cmdTable + h * 4;
  const offsets = [];
  const bytes = [];
  for (const r of rows) { offsets.push(data + bytes.length); bytes.push(...r.cmds); }
  const buf = new Uint8Array(data + bytes.length);
  const dv = new DataView(buf.buffer);
  buf.set([...'2.0N'].map((c) => c.charCodeAt(0)), 0);
  dv.setInt32(4, 1, true);
  dv.setUint32(32, cmdTable, true); dv.setUint32(36, outline, true);
  dv.setInt32(48, w, true); dv.setInt32(52, h, true); dv.setInt32(56, 2, true); dv.setInt32(60, 3, true);
  rows.forEach((r, i) => { dv.setUint16(outline + i * 4, r.left, true); dv.setUint16(outline + i * 4 + 2, r.right, true); dv.setUint32(cmdTable + i * 4, offsets[i], true); });
  buf.set(bytes, data);
  return buf;
}
{
  const s = new Slp(buildSlp());
  eq(s.version, '2.0N', 'slp version');
  eq(s.count, 1, 'slp frame count');
  const fr = s.decode(0);
  eq([fr.w, fr.h, fr.hx, fr.hy], [4, 4, 2, 3], 'frame size/hotspot');
  eq([...fr.kind], [PX_NONE, PX_COLOR, PX_COLOR, PX_NONE, PX_PLAYER, PX_PLAYER, PX_NONE, PX_NONE, PX_COLOR, PX_COLOR, PX_SHADOW, PX_NONE, 0, 0, 0, 0], 'pixel kinds');
  eq([...fr.idx.slice(0, 10)], [0, 10, 11, 0, 3, 4, 0, 0, 7, 7], 'pixel indices');
  const pal = new Uint8Array(768);
  for (let i = 0; i < 256; i++) { pal[i * 3] = i; pal[i * 3 + 1] = 255 - i; pal[i * 3 + 2] = 7; }
  const rgba = frameRGBA(fr, pal, 1); // red player: ramp starts at 32
  eq([...rgba.slice(16, 20)], [35, 220, 7, 255], 'player colour pixel uses the red ramp (32 + 3)');
  eq([...rgba.slice(4, 8)], [10, 245, 7, 255], 'normal pixel uses the palette');
  eq(rgba[10 * 4 + 3] > 0 && rgba[10 * 4] === 0, true, 'shadow pixel is translucent black');
  eq(rgba[3], 0, 'transparent pixel');
  // out of sight: the original's checkerboard (colour 0 where x + y + parity is odd)
  const fogged = frameRGBA(fr, pal, 1, { fog: 1, parity: 0 });
  eq([...fogged.slice(4, 8)], [0, 255, 7, 255], 'checkerboard: pixel (1,0) becomes colour 0');
  eq([...fogged.slice(8, 12)], [11, 244, 7, 255], 'checkerboard: pixel (2,0) keeps its colour');
  eq([...frameRGBA(fr, pal, 1, { fog: 1, parity: 1 }).slice(4, 8)], [10, 245, 7, 255], 'checkerboard parity 1 keeps pixel (1,0)');
  eq([...frameRGBA(fr, pal, 1, { fog: 2 }).slice(4, 8)], [5, 122, 4, 255], 'darkened fog halves the colour');
}

// ------------------------------------------------- fog of war edges
{
  eq(new Set(EDGE_INDEX).size, 47, '47 edge cases');
  eq([EDGE_INDEX[0], EDGE_INDEX[1], EDGE_INDEX[0x0f], EDGE_INDEX[0xff]], [0, 1, 15, 46], 'edge case numbering');
  eq(EDGE_INDEX[0x89], EDGE_INDEX[0x80], 'corners next to a lacking side add nothing');
  eq(EDGE_INDEX[0x5f], EDGE_INDEX[0x50], 'two sides absorb their three corners');
  // neighbours in our coordinates: (tx-1, ty) is the original's (X, Y-1), the upper left side
  const W = 3, H = 3;
  const caseWith = (x, y) => { const st = new Uint8Array(9).fill(2); st[y * W + x] = 0; return edgeCase(st, 2, W, H, 1, 1); };
  eq([caseWith(0, 1), caseWith(1, 0), caseWith(2, 1), caseWith(1, 2)], [0x80, 0x40, 0x20, 0x10].map((m) => EDGE_INDEX[m]), 'sides: upper left, upper right, lower right, lower left');
  eq([caseWith(0, 0), caseWith(2, 0), caseWith(2, 2), caseWith(0, 2)], [8, 4, 2, 1], 'corners: top, right, bottom, left');
  eq(edgeCase(new Uint8Array(4), 1, 2, 2, 0, 0), EDGE_INDEX[0x30], 'off-map neighbours never lack');
  // synthetic files: every table the same, case i a one-span list
  const build = (per) => {
    const tableAt = 17 * 4, spansAt = tableAt + 47 * per * 4;
    const buf = new Uint8Array(spansAt + 47 * per * 4);
    const dv = new DataView(buf.buffer);
    for (let s = 0; s < 17; s++) dv.setUint32(s * 4, tableAt, true);
    for (let i = 0; i < 47 * per; i++) {
      const at = spansAt + i * 4;
      dv.setUint32(tableAt + i * 4, i % per === 1 && i < 2 * per ? 0 : at, true);
      buf.set([i % 47, 1, 2 + (i % 5), 255], at);
    }
    return buf;
  };
  const E = parseEdges(build(2), build(1));
  eq([E.lit.length, E.lit[16].length, E.black[3].length, E.full.length], [17, 47, 47, 17], 'edge tables per shape and case');
  eq([...E.full[0]], [0, 1, 2], 'full tile shape = lit part of case 0');
  eq(E.fog[0][0], null, 'absent span list');
  eq([...E.black[5][3]], [3, 1, 5], 'black part span list');
  let threw = false;
  try { parseEdges(build(2).slice(0, 100), build(1)); } catch { threw = true; }
  ok(threw, 'truncated edge file is rejected');
  // the real files (project copy or AOE_DIR): lit + fogged part make the whole tile
  const edgeDir = ['public/assets/aoe', process.env.AOE_DIR && path.join(process.env.AOE_DIR, 'data')].find((d) => d && fs.existsSync(path.join(d, 'tileedge.dat')));
  if (edgeDir) {
    const R = parseEdges(fs.readFileSync(path.join(edgeDir, 'tileedge.dat')), fs.readFileSync(path.join(edgeDir, 'blkedge.dat')));
    const px = (l) => { const s = new Set(); if (l) for (let k = 0; k < l.length; k += 3) for (let x = l[k + 1]; x <= l[k + 2]; x++) s.add(l[k] * 128 + x); return s; };
    let exact = true, inside = true;
    for (let s = 0; s < 17; s++) {
      const full = px(R.full[s]);
      for (let i = 0; i < 47; i++) {
        const a = px(R.lit[s][i]), b = px(R.fog[s][i]);
        if (a.size + b.size !== full.size || [...a, ...b].some((p) => !full.has(p))) exact = false;
        if ([...px(R.black[s][i])].some((p) => !full.has(p))) inside = false;
      }
    }
    ok(exact, 'tileedge: lit and fogged parts split every tile shape exactly');
    ok(inside, 'blkedge: black parts stay inside the tile');
    eq([R.full[0].length / 3, R.full[1].length / 3, R.full[2].length / 3], [33, 17, 49], 'tile shapes: flat 33 rows, slopes 17 / 49');
  }
}

// --------------------------------------------------- DRS + palette
{
  const slpBytes = buildSlp();
  const palText = 'JASC-PAL\r\n0100\r\n3\r\n1 2 3\r\n250 128 0\r\n9 9 9\r\n';
  const drsBytes = writeDrs([{ id: 7, ext: 'slp', bytes: slpBytes }, { id: 50500, ext: 'bina', bytes: new TextEncoder().encode(palText) }]);
  const drs = parseDrs(drsBytes, 'test');
  eq(drs.version, '1.00', 'drs version');
  eq([...drs.entries.keys()].sort((a, b) => a - b), [7, 50500], 'drs ids');
  eq(drs.ext(7), 'slp', 'slp table type');
  eq(drs.ext(50500), 'bina', 'bin table type');
  eq([...drs.get(7)], [...slpBytes], 'entry bytes round-trip');
  const pal = parsePalette(drs.get(50500));
  eq([...pal.slice(0, 9)], [1, 2, 3, 250, 128, 0, 9, 9, 9], 'palette');
  const slim = parseDrs(stripInterface(drs));
  eq([...slim.entries.keys()], [50500], 'stripped interface keeps the palette only');
}

// ------------------------------------------------------- synthetic MIDI
{
  // format 1: tempo track (90 bpm after 1 quarter) + a piano track
  const vlq = (v) => { const out = [v & 0x7f]; while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80); return out; };
  const track = (bytes) => [...'MTrk'].map((c) => c.charCodeAt(0)).concat([0, 0, bytes.length >> 8, bytes.length & 255], bytes);
  const t0 = [...vlq(96), 0xff, 0x51, 3, 0x0a, 0x2c, 0x2b, ...vlq(0), 0xff, 0x2f, 0];       // 666667 us/quarter at tick 96
  const t1 = [...vlq(0), 0xc0, 48, ...vlq(0), 0x90, 60, 100, ...vlq(96), 0x80, 60, 0,       // note 60 for one quarter
    ...vlq(0), 0x90, 64, 90, ...vlq(96), 64, 0, ...vlq(0), 0xe0, 0, 0x60, ...vlq(0), 0xff, 0x2f, 0]; // running status note-off
  const bytes = new Uint8Array([...'MThd'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 6, 0, 1, 0, 2, 0, 96], track(t0), track(t1)));
  const m = parseMidi(bytes);
  eq(m.events.map((e) => e.type), ['prog', 'on', 'off', 'on', 'off', 'bend'], 'midi event order');
  eq(m.events[2].t, 0.5, 'first quarter at 120 bpm lasts 0.5 s');
  ok(Math.abs(m.events[4].t - (0.5 + 0.6666667)) < 1e-6, 'second quarter at 90 bpm (tempo change)');
  eq(m.events[5].a, (0x60 << 7) - 8192, 'pitch bend value');
}

// ------------------------------------------ the player's own game files
const dir = process.env.AOE_DIR;
if (dir) {
  const find = (names) => {
    for (const d of [dir, path.join(dir, 'data'), path.join(dir, 'Data')]) {
      for (const n of names) { const p = path.join(d, n); if (fs.existsSync(p) && fs.statSync(p).size > 1024) return p; }
    }
    return null;
  };
  const datFile = find(['empires.dat']), gfxFile = find(['graphics.drs', 'graphic.drs']), ifFile = find(['interfac.drs']);
  ok(datFile && gfxFile && ifFile, 'AOE_DIR contains empires.dat, graphic(s).drs and interfac.drs');
  if (datFile && gfxFile && ifFile) {
    const dat = parseEmpiresDat(await inflateRaw(fs.readFileSync(datFile)));
    eq(dat.end, dat.size, 'empires.dat parsed to the last byte');
    ok(dat.version.startsWith('VER 3.7'), 'Rise of Rome dat version');
    eq(dat.civs.length, 17, 'Gaia + 16 civilisations');
    eq([dat.tile.w, dat.tile.h, dat.tile.elev], [64, 32, 16], 'tile geometry matches the renderer (64x32, 16 px per level)');
    const m = new AoeMapping(dat);
    const name = (civ, type, age) => { const b = m.building(civ, type, age); return b && dat.graphics[b.unit.standing].name + '#' + b.facet; };
    eq(name('greek', 'town_center', 0), 'TownCentr1#1', 'stone age town centre');
    eq(name('greek', 'town_center', 2), 'GTownCentr2#2', 'greek bronze age town centre');
    eq(name('egyptian', 'house', 3), 'EHouse1 Smoke#2', 'egyptian iron age house');
    eq(name('yamato', 'barracks', 3), 'JBarrack2#1', 'asian iron age barracks');
    eq(m.civ('lac_viet').iconSet, 3, 'Lac Viet uses the Asian architecture');
    for (const type of ['villager', 'clubman', 'bowman', 'chariot_archer', 'priest', 'catapult', 'war_elephant', 'gazelle', 'lion']) {
      const u = m.unitDef('greek', type);
      ok(u && u.standing >= 0 && dat.graphics[u.standing], `unit ${type} has a standing graphic`);
    }
    const gfx = parseDrs(fs.readFileSync(gfxFile));
    const walk = dat.graphics[m.unitDef('greek', 'villager').walking];
    const s = new Slp(gfx.get(walk.slp));
    eq(s.count, walk.frames * 5, 'villager walk: 8 angles stored as 5 (3 mirrored)');
    const fr = s.decode(0);
    ok(fr.w > 10 && fr.h > 20 && fr.kind.some((k) => k === PX_PLAYER), 'villager frame decodes with player colour');
    const iface = parseDrs(fs.readFileSync(ifFile));
    ok(parsePalette(iface.get(50500)).length === 768, 'interface palette');
  }
} else console.log('(AOE_DIR not set: skipping checks against real game files)');

// the Windows GS wavetable bank the original MIDI music played through
const GM_DLS = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'drivers', 'gm.dls');
if (fs.existsSync(GM_DLS)) {
  const dls = parseDls(fs.readFileSync(GM_DLS));
  ok(dls.instruments.length > 128 && dls.waves.length > 100, 'gm.dls instruments and waves');
  const kit = dls.instruments.find((i) => i.drum && i.program === 0);
  ok(kit && kit.regions.some((r) => r.keyLo === 38), 'standard drum kit has a snare (key 38)');
  const strings = dls.instruments.find((i) => !i.drum && i.bank === 0 && i.program === 48);
  ok(strings && strings.regions.every((r) => r.wave < dls.waves.length && r.loop), 'string ensemble regions loop');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
