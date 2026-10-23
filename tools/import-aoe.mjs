// Copies the Age of Empires: The Rise of Rome files the game uses from an
// installation into public/assets/aoe/ and writes manifest.json.
//   node tools/import-aoe.mjs "C:\path\to\Age of Empires"
// interfac.drs is slimmed down: the menu backgrounds only keep their largest
// resolution and the unused SHP pictures are dropped. Windows' gm.dls (the
// wavetable bank the MIDI music played through) is copied too.
import fs from 'node:fs';
import path from 'node:path';
import { parseDrs, writeDrs } from '../public/src/assets/drs.js';

const root = process.argv[2];
if (!root) { console.error('usage: node tools/import-aoe.mjs <game folder>'); process.exit(1); }
const OUT = path.resolve('public/assets/aoe');

// largest file with one of the names, searched in the game folder and data/, sound/
function find(names, dirs = ['', 'data', 'Data']) {
  let best = null;
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(root, d, n);
      if (fs.existsSync(p) && fs.statSync(p).size > 1024 && (!best || fs.statSync(p).size > fs.statSync(best).size)) best = p;
    }
  }
  return best;
}

const SOURCES = {
  dat: ['empires.dat'],
  graphics: ['graphics.drs', 'graphic.drs'],
  terrain: ['terrain.drs'],
  border: ['border.drs'],
  sounds: ['sounds.drs', 'sound.drs'],
  interfac: ['interfac.drs'],
  tileedge: ['tileedge.dat'],
  blkedge: ['blkedge.dat'],
  shadow: ['shadow.col'],
};

function slimInterface(buf) {
  const drs = parseDrs(buf, 'interfac');
  const drop = new Set();
  for (const [id] of drs.entries) {
    if (drs.ext(id) !== 'bina') continue;
    const text = new TextDecoder('latin1').decode(drs.get(id));
    const bg = [1, 2, 3].map((k) => Number((new RegExp(`background${k}_files\\s+\\S+\\s+\\S+\\s+(-?\\d+)`).exec(text) || [])[1] ?? -1));
    if (bg[2] > 0) for (const b of bg.slice(0, 2)) if (b > 0 && b !== bg[2]) drop.add(b);
  }
  const entries = [];
  for (const [id] of drs.entries) {
    const ext = drs.ext(id);
    if (ext === 'shp' || drop.has(id)) continue;
    entries.push({ id, ext, bytes: drs.get(id) });
  }
  return writeDrs(entries);
}

fs.mkdirSync(path.join(OUT, 'sound'), { recursive: true });
const manifest = { files: {}, taunts: [], ambient: [], music: [] };
for (const [key, names] of Object.entries(SOURCES)) {
  const src = find(names);
  if (!src) { if (['dat', 'graphics', 'interfac'].includes(key)) throw new Error('missing ' + names.join('/')); continue; }
  const name = key === 'graphics' ? 'graphics.drs' : key === 'sounds' ? 'sounds.drs' : path.basename(src).toLowerCase();
  let bytes = fs.readFileSync(src);
  if (key === 'interfac') bytes = slimInterface(bytes);
  fs.writeFileSync(path.join(OUT, name), bytes);
  manifest.files[key] = name;
  console.log(`${key.padEnd(9)} ${src} -> ${name} (${(bytes.length / 1048576).toFixed(1)} MB)`);
}

const soundDir = ['sound', 'Sound'].map((d) => path.join(root, d)).find((d) => fs.existsSync(d));
if (soundDir) {
  for (const f of fs.readdirSync(soundDir).sort()) {
    const lower = f.toLowerCase();
    const m = /^taunt(\d{1,3})\.wav$/.exec(lower);
    if (!m && !/\.(wav|mid)$/.test(lower)) continue;
    fs.copyFileSync(path.join(soundDir, f), path.join(OUT, 'sound', lower));
    if (m) manifest.taunts.push(Number(m[1]));
    else if (lower.endsWith('.mid')) manifest.music.push(lower);
    else manifest.ambient.push(lower);
  }
}
// the computer player's build lists (data2\*.ai; a few older ones in data\),
// turned into engine data by tools/gen-data.mjs
fs.mkdirSync(path.join(OUT, 'ai'), { recursive: true });
let lists = 0;
for (const d of ['data', 'Data', 'data2', 'Data2']) {
  const dir = path.join(root, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.ai')) continue;
    fs.copyFileSync(path.join(dir, f), path.join(OUT, 'ai', f));
    lists++;
  }
}
console.log(`ai        ${lists} build lists -> ai/`);
// the Windows GS wavetable bank the MIDI music was played through
const dls = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'drivers', 'gm.dls');
if (fs.existsSync(dls)) { fs.copyFileSync(dls, path.join(OUT, 'gm.dls')); manifest.files.gmdls = 'gm.dls'; console.log(`gmdls     ${dls} -> gm.dls`); }
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`sound: ${manifest.taunts.length} taunts, ${manifest.ambient.length} ambient, ${manifest.music.length} music -> ${OUT}`);
