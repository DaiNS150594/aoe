// Optional: serve the player's own Age of Empires: Rise of Rome files to a
// browser on the same machine, so the original graphics/sounds load without
// picking the folder. Enabled by AOE_DIR=<game folder>. Only loopback
// clients are answered: the files are never offered to other players on the
// network (each player uses their own copy of the game).
import fs from 'node:fs';
import path from 'node:path';
import { parseDrs, stripInterface } from '../public/src/assets/drs.js';

const WANTED = {
  graphics: ['graphics.drs', 'graphic.drs'],
  terrain: ['terrain.drs'],
  border: ['border.drs'],
  interfac: ['interfac.drs'],
  sounds: ['sounds.drs', 'sound.drs'],
  dat: ['empires.dat'],
  tileedge: ['tileedge.dat'], // fog of war edge shapes
  blkedge: ['blkedge.dat'],
};

function listDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

// the MIDI music, played through the Windows GS wavetable bank
const MUSIC_RE = /^(music\d+|open|won|lost)\.mid$/;
// ambient sounds (birds, wind, forest, desert, water)
const AMBIENT_RE = /^(birds?|desert|forest|grass|lake|ocean|stream|wind)\d*\.wav$/;
export const GM_DLS = path.join(process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'gm.dls');

export function findGameFiles(root) {
  const found = {}, taunts = new Map(), music = new Map(), ambient = new Map();
  const dirs = [root, path.join(root, 'data'), path.join(root, 'Data'), path.join(root, 'sound'), path.join(root, 'Sound')];
  for (const d of listDir(root)) if (d.isDirectory()) dirs.push(path.join(root, d.name), path.join(root, d.name, 'data'), path.join(root, d.name, 'sound'));
  for (const dir of new Set(dirs)) {
    for (const ent of listDir(dir)) {
      if (!ent.isFile()) continue;
      const name = ent.name.toLowerCase();
      const full = path.join(dir, ent.name);
      let size = 0;
      try { size = fs.statSync(full).size; } catch { continue; }
      for (const [key, names] of Object.entries(WANTED)) {
        if (names.includes(name) && size > 1024 && (!found[key] || size > found[key].size)) found[key] = { file: full, size };
      }
      const m = /^taunt(\d{1,3})\.wav$/.exec(name);
      if (m && size < 4e6) taunts.set(Number(m[1]), full);
      if (MUSIC_RE.test(name) && size < 1e6) music.set(name, full);
      if (AMBIENT_RE.test(name) && size < 4e6) ambient.set(name, full);
    }
  }
  return { found, taunts, music, ambient };
}

const isLoopback = (addr) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

export function createAoeDataHandler(root) {
  if (!root) return null;
  const { found, taunts, music, ambient } = findGameFiles(root);
  const gmdls = fs.existsSync(GM_DLS) ? GM_DLS : null;
  if (!found.graphics || !found.dat || !found.interfac) {
    console.warn(`AOE_DIR=${root}: không tìm thấy graphic(s).drs / interfac.drs / empires.dat — bỏ qua đồ họa gốc.`);
    return null;
  }
  console.log(`Đồ họa/âm thanh gốc AoE từ ${root}: ${Object.keys(found).join(', ')}${taunts.size ? `, ${taunts.size} taunt` : ''} (chỉ phục vụ 127.0.0.1)`);
  let interfaceSlim = null;
  return (req, res, url) => {
    if (!url.startsWith('/aoe-data/')) return false;
    if (!isLoopback(req.socket.remoteAddress)) { res.writeHead(403); res.end('Local only'); return true; }
    const key = url.slice('/aoe-data/'.length);
    if (key === 'manifest.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ files: Object.keys(found), taunts: [...taunts.keys()].sort((a, b) => a - b), music: gmdls ? [...music.keys()].sort() : [], ambient: [...ambient.keys()].sort() }));
      return true;
    }
    let file = null;
    if (key.startsWith('taunt/')) file = taunts.get(Number(key.slice(6))) || null;
    else if (key.startsWith('music/')) file = music.get(key.slice(6)) || null;
    else if (key.startsWith('ambient/')) file = ambient.get(key.slice(8)) || null;
    else if (key === 'gmdls') file = gmdls;
    else if (key === 'interfac') {
      try {
        if (!interfaceSlim) interfaceSlim = Buffer.from(stripInterface(parseDrs(fs.readFileSync(found.interfac.file), 'interfac')));
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(interfaceSlim);
      } catch (e) { res.writeHead(500); res.end(String(e.message)); }
      return true;
    } else if (found[key]) file = found[key].file;
    if (!file) { res.writeHead(404); res.end(); return true; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
    return true;
  };
}
