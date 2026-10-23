// Finds, validates, caches and loads the Age of Empires: Rise of Rome files.
// Sources, in order: the copy inside the project (public/assets/aoe, made by
// tools/import-aoe.mjs), files saved in this browser (IndexedDB), then the
// local server (/aoe-data, only when it was started with AOE_DIR).
// Nothing is uploaded anywhere: picked files stay inside the browser.
import { parseDrs, parsePalette, stripInterface } from './drs.js';
import { inflateRaw, parseEmpiresDat } from './dat.js';
import { AoeAssets } from './aoe.js';
import { AoeMapping } from './mapping.js';
import { parseEdges } from './edges.js';
import * as store from './store.js';

// logical file -> accepted names (first match wins; the largest file is
// preferred when several folders contain one, e.g. data/ vs data2/ stubs)
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

export const AOE = {
  assets: null, mapping: null, status: 'none', message: '', source: '',
  enabled: readPref(),
  listeners: new Set(),
};
function readPref() { try { return localStorage.getItem('deche_aoe_gfx') !== '0'; } catch { return true; } }
export function setAoeEnabled(on) {
  AOE.enabled = !!on;
  try { localStorage.setItem('deche_aoe_gfx', on ? '1' : '0'); } catch { /* ignore */ }
  notify();
}
// the active asset set, or null when not loaded / switched off
export function aoe() { return AOE.enabled && AOE.assets ? AOE : null; }
export function onAoeChange(fn) { AOE.listeners.add(fn); return () => AOE.listeners.delete(fn); }
function notify() { for (const fn of AOE.listeners) { try { fn(AOE); } catch (e) { console.error(e); } } }
function setStatus(status, message = '') { AOE.status = status; AOE.message = message; notify(); }

// ---------------------------------------------------------------- build
async function build(raw, source) {
  // raw: { graphics, terrain?, border?, interfac, sounds?, dat, taunts: Map<n, ArrayBuffer> }
  if (!raw.graphics || !raw.interfac || !raw.dat) throw new Error('Thiếu file: cần graphic(s).drs, interfac.drs và empires.dat trong thư mục data.');
  const graphics = [parseDrs(raw.graphics, 'graphics')];
  if (raw.terrain) graphics.push(parseDrs(raw.terrain, 'terrain'));
  if (raw.border) graphics.push(parseDrs(raw.border, 'border'));
  const interfac = parseDrs(raw.interfac, 'interfac');
  const palBytes = interfac.get(50500);
  if (!palBytes) throw new Error('interfac.drs không có bảng màu 50500.');
  const pal = parsePalette(palBytes);
  const sounds = raw.sounds ? parseDrs(raw.sounds, 'sounds') : null;
  let dat;
  try { dat = parseEmpiresDat(await inflateRaw(new Uint8Array(raw.dat))); } catch (e) {
    throw new Error('empires.dat không đọc được (cần bản Rise of Rome 1.0): ' + e.message);
  }
  if (!graphics[0].entries.size) throw new Error('graphics.drs rỗng.');
  const assets = new AoeAssets({ graphics, interfac, sounds, dat, pal, taunts: raw.taunts, source });
  if (raw.tileedge && raw.blkedge) {
    try { assets.edges = parseEdges(raw.tileedge, raw.blkedge); } catch (e) { console.warn('Bỏ qua viền sương mù gốc:', e.message); }
  }
  assets.music = raw.music || null; // { names, track(name), bank() } — MIDI files + Windows gm.dls
  assets.ambient = raw.ambient || null; // { names, load(name) } — birds, wind, forest... (sound/*.wav)
  const mapping = new AoeMapping(dat);
  return { assets, mapping };
}

function activate(res, source) {
  AOE.assets = res.assets;
  AOE.mapping = res.mapping;
  AOE.source = source;
  setStatus('ready', `${res.assets.dat.version.trim()} · ${res.assets.dat.civs.length - 1} phe · ${res.assets.dat.graphics.filter(Boolean).length} đồ họa${res.assets.sounds ? ' · ' + res.assets.sounds.entries.size + ' âm thanh' : ''}${res.assets.taunts.size ? ' · ' + res.assets.taunts.size + ' taunt' : ''}`);
}

// ------------------------------------------------------------ folder pick
export function pickFolder() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.webkitdirectory = true;
    inp.multiple = true;
    inp.style.display = 'none';
    inp.addEventListener('change', () => { resolve(inp.files); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

// choose the wanted files out of a picked folder (FileList)
export function selectFiles(fileList) {
  const pick = {};
  const taunts = new Map();
  for (const f of fileList) {
    const name = f.name.toLowerCase();
    const rel = (f.webkitRelativePath || f.name).toLowerCase();
    for (const [key, names] of Object.entries(WANTED)) {
      if (!names.includes(name)) continue;
      const prev = pick[key];
      const score = (f.size > 1024 ? f.size : 0) + (/(^|\/)data\//.test(rel) ? 1 : 0);
      if (!prev || score > prev.score) pick[key] = { file: f, score };
    }
    const m = /(^|\/)taunt(\d{1,3})\.wav$/.exec(rel);
    if (m && f.size < 4e6) taunts.set(Number(m[2]), f);
  }
  const out = {};
  for (const [k, v] of Object.entries(pick)) if (v.score > 1) out[k] = v.file;
  return { files: out, taunts };
}

// import a picked folder: validate, keep in IndexedDB, activate
export async function importFolder(fileList) {
  setStatus('loading', 'Đang đọc thư mục game...');
  try {
    const { files, taunts } = selectFiles(fileList);
    const raw = { taunts: new Map() };
    for (const [k, f] of Object.entries(files)) raw[k] = await f.arrayBuffer();
    for (const [n, f] of taunts) raw.taunts.set(n, await f.arrayBuffer());
    // keep only what the game needs from the big interface archive
    if (raw.interfac) raw.interfac = stripInterface(parseDrs(raw.interfac, 'interfac')).buffer;
    setStatus('loading', 'Đang kiểm tra dữ liệu...');
    const res = await build(raw, 'folder');
    const save = {};
    for (const k of Object.keys(WANTED)) if (raw[k]) save[k] = new Blob([raw[k]]);
    for (const [n, b] of raw.taunts) save['taunt:' + n] = new Blob([b]);
    try {
      await store.clearAll();
      await store.putFiles(save);
    } catch (e) { console.warn('Không lưu được vào IndexedDB:', e); }
    activate(res, 'folder');
    return true;
  } catch (e) {
    console.error(e);
    setStatus(AOE.assets ? 'ready' : 'error', e.message || String(e));
    return false;
  }
}

async function loadSaved() {
  let all;
  try { all = await store.getAll(); } catch { return null; }
  if (!all || !all.graphics || !all.dat || !all.interfac) return null;
  const raw = { taunts: new Map() };
  for (const [k, v] of Object.entries(all)) {
    const buf = await v.arrayBuffer();
    if (k.startsWith('taunt:')) raw.taunts.set(Number(k.slice(6)), buf);
    else raw[k] = buf;
  }
  return build(raw, 'saved');
}

// files copied into the project by tools/import-aoe.mjs; taunts load on demand
async function loadBuiltin() {
  let man;
  try {
    const r = await fetch('assets/aoe/manifest.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    man = await r.json();
  } catch { return null; }
  const files = man && man.files;
  if (!files || !files.graphics || !files.dat || !files.interfac) return null;
  const raw = { taunts: new Map() };
  await Promise.all(Object.entries(files).filter(([k]) => WANTED[k]).map(async ([k, name]) => {
    const r = await fetch('assets/aoe/' + name);
    if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
    raw[k] = await r.arrayBuffer();
  }));
  for (const n of man.taunts || []) raw.taunts.set(n, `assets/aoe/sound/taunt${String(n).padStart(3, '0')}.wav`);
  const fetchBuf = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.arrayBuffer(); };
  if (files.gmdls && (man.music || []).length) {
    raw.music = { names: man.music, track: (n) => fetchBuf('assets/aoe/sound/' + n), bank: () => fetchBuf('assets/aoe/' + files.gmdls) };
  }
  if ((man.ambient || []).length) raw.ambient = { names: man.ambient, load: (n) => fetchBuf('assets/aoe/sound/' + n) };
  return build(raw, 'builtin');
}

async function loadServer() {
  let man;
  try {
    const r = await fetch('aoe-data/manifest.json', { cache: 'no-store' });
    if (!r.ok) return null;
    man = await r.json();
  } catch { return null; }
  if (!man || !Array.isArray(man.files) || !man.files.length) return null;
  const get = async (key) => { const r = await fetch('aoe-data/' + key); if (!r.ok) throw new Error(key + ': HTTP ' + r.status); return r.arrayBuffer(); };
  const raw = { taunts: new Map() };
  for (const k of man.files || []) raw[k] = await get(k);
  for (const n of man.taunts || []) { try { raw.taunts.set(n, await get('taunt/' + n)); } catch { /* optional */ } }
  if ((man.music || []).length) raw.music = { names: man.music, track: (n) => get('music/' + n), bank: () => get('gmdls') };
  if ((man.ambient || []).length) raw.ambient = { names: man.ambient, load: (n) => get('ambient/' + n) };
  return build(raw, 'server');
}

// called once at start-up
export async function initAoe() {
  setStatus('loading', 'Đang tìm dữ liệu game gốc...');
  try {
    const builtin = await loadBuiltin();
    if (builtin) { activate(builtin, 'builtin'); return; }
    const saved = await loadSaved();
    if (saved) { activate(saved, 'saved'); return; }
    const srv = await loadServer();
    if (srv) { activate(srv, 'server'); return; }
    setStatus('none', '');
  } catch (e) {
    console.error(e);
    setStatus('error', e.message || String(e));
  }
}

export async function forgetSaved() {
  try { await store.clearAll(); } catch { /* ignore */ }
  AOE.assets = null; AOE.mapping = null; AOE.source = '';
  setStatus('none', '');
  initAoe();
}
