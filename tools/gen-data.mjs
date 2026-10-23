// Generates public/src/engine/data/original.js — the Rise of Rome game data
// the simulation uses (unit stats, attack/armor classes, technologies, effect
// commands, civilisation tech trees) — from empires.dat.
//   node tools/gen-data.mjs [path/to/empires.dat]
// Default input: public/assets/aoe/empires.dat (copied by tools/import-aoe.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { inflateRaw, parseEmpiresDat } from '../public/src/assets/dat.js';
import { UNIT_DAT, BUILDING_DAT, TASK_DAT, RESOURCE_DAT } from '../public/src/engine/data/ids.js';
import { STRATEGIES } from '../public/src/engine/data/ai-strategies.js';

const src = process.argv[2] || 'public/assets/aoe/empires.dat';
const OUT = 'public/src/engine/data/original.js';
const dat = parseEmpiresDat(await inflateRaw(fs.readFileSync(src)));
if (dat.end !== dat.size) throw new Error('empires.dat was not read to the end');

const GAIA = dat.civs[0], BASE = dat.civs[2]; // Greek: every civ shares the same unit table
const unitOf = (id) => BASE.units[id] || GAIA.units[id];
const RES = ['food', 'wood', 'stone', 'gold'];
const f = (x) => Math.round(x * 1e6) / 1e6; // float32 noise -> the value the designers typed

// ---------------------------------------------------------------- units
// the units this game uses, the villager task units, everything they can be
// upgraded into (effect 3), and their projectiles
const ids = new Set([UNIT_DAT, BUILDING_DAT, TASK_DAT, RESOURCE_DAT].flatMap((m) => Object.values(m)));
for (let grew = true; grew;) {
  grew = false;
  for (const e of dat.effects) for (const c of e.effects) {
    if (c.type === 3 && ids.has(c.a) && c.b >= 0 && !ids.has(c.b)) { ids.add(c.b); grew = true; }
  }
  for (const id of [...ids]) {
    const u = unitOf(id);
    if (u && u.projectile >= 0 && !ids.has(u.projectile)) { ids.add(u.projectile); grew = true; }
  }
}

function costOf(list) {
  const o = {};
  for (const c of list || []) if (c.enabled && c.amount && RES[c.type]) o[RES[c.type]] = c.amount;
  return o;
}
function unitData(u) {
  const o = { name: u.name, type: u.type, cls: u.class, hp: u.hp, los: f(u.los), r: [f(u.radius[0]), f(u.radius[1])] };
  if (u.speed !== undefined) o.speed = f(u.speed);
  // the running sprite's speed multiplier (gazelles and lions run at 1.9x when
  // fleeing or chasing: the unit AI moves them with this sprite)
  if (u.type >= 30 && u.running >= 0) {
    const g = dat.graphics[u.running];
    if (g && g.speedAdjust > 0 && g.speedAdjust !== 1) o.runMul = f(g.speedAdjust);
  }
  if (u.resourceCapacity) o.cap = u.resourceCapacity;
  if (u.resourceDecay) o.decay = f(u.resourceDecay);
  const store = u.storage.filter((s) => s.type >= 0 && s.amount).map((s) => [s.type, f(s.amount)]);
  if (store.length) o.store = store;
  if (u.blastDefense) o.blastDef = u.blastDefense;
  if (u.deadUnit >= 0) o.dead = u.deadUnit;
  if (u.type >= 40) { o.work = f(u.workRate); o.search = f(u.searchRadius); }
  if (u.type >= 50) {
    o.atk = u.attacks.map((a) => [a.cls, a.amount]);
    o.arm = u.armors.map((a) => [a.cls, a.amount]);
    o.defArmor = u.defaultArmor;
    o.range = f(u.range); o.minRange = f(u.minRange); o.reload = f(u.reload);
    o.accuracy = u.accuracy; o.proj = u.projectile;
    o.blast = f(u.blastRange); o.blastLevel = u.blastLevel; o.frameDelay = u.frameDelay;
    o.shown = { atk: u.displayedAttack, arm: u.displayedArmor, range: f(u.displayedRange) };
    const g = dat.graphics[u.attackGraphic];
    if (g) o.atkAnim = [g.frames, f(g.frameRate)]; // frames, seconds per frame
  }
  if (u.type === 60) { o.smart = u.smartMode; o.arc = f(u.arc); }
  if (u.type >= 70) {
    o.cost = costOf(u.cost); o.time = u.trainTime; o.trainAt = u.trainLocation; o.button = u.button;
    o.shown.pierce = u.displayedPierce;
  }
  if (u.type >= 80) o.research = u.research;
  return o;
}
const units = {};
for (const id of [...ids].sort((a, b) => a - b)) {
  const u = unitOf(id);
  if (!u) { console.warn('unit', id, 'missing from empires.dat'); continue; }
  units[id] = unitData(u);
}
// every civilisation must carry the same base unit (civ bonuses are effects)
for (const [i, civ] of dat.civs.entries()) {
  if (i === 0) continue;
  for (const id of ids) {
    const u = civ.units[id];
    if (u && BASE.units[id] && JSON.stringify(unitData(u)) !== JSON.stringify(units[id])) console.warn(`civ ${civ.name}: unit ${id} differs`);
  }
}

// the work values of the villager tasks and the priest: [action, target class, work 1, work 2]
// (101 build, 104 convert: chance and seconds per try, 105 heal, 106 repair)
for (const id of [...Object.values(TASK_DAT), UNIT_DAT.priest]) {
  const u = unitOf(id);
  if (u && units[id] && u.commands) units[id].tasks = u.commands.filter((c) => c.type >= 100 || c.type === 5).map((c) => [c.type, c.classId, f(c.work1), f(c.work2)]);
}
// ---------------------------------------------------------------- techs
const techs = dat.techs.map((t) => ({
  name: t.name, at: t.location, req: t.requires.filter((r) => r >= 0), need: t.requiredCount,
  cost: costOf(t.cost), time: t.time, effect: t.effect, button: t.button, icon: t.icon,
}));
const usedEffects = new Set();
for (const t of techs) if (t.effect >= 0) usedEffects.add(t.effect);
for (const c of dat.civs) if (c.techTree >= 0) usedEffects.add(c.techTree);
const effects = {};
for (const id of [...usedEffects].sort((a, b) => a - b)) {
  effects[id] = dat.effects[id].effects.map((e) => [e.type, e.a, e.b, e.c, f(e.d)]);
}
const civs = dat.civs.map((c) => {
  const res = {};
  c.resources.forEach((v, i) => { if (v) res[i] = f(v); });
  return { name: c.name, techTree: c.techTree, architecture: c.iconSet, res };
});

// ---------------------------------------------------------------- write
const json = (v) => JSON.stringify(v).replace(/"(\w+)":/g, '$1:');
let out = `// Rise of Rome game data, generated by tools/gen-data.mjs from empires.dat (${dat.version.trim()}).\n`;
out += '// Do not edit: regenerate instead. Effect commands are [type, a, b, c, d].\n\n';
out += 'export const ORIGINAL_UNITS = {\n';
for (const [id, u] of Object.entries(units)) out += `  ${id}: ${json(u)},\n`;
out += '};\n\nexport const ORIGINAL_TECHS = [\n';
for (const t of techs) out += `  ${json(t)},\n`;
out += '];\n\nexport const ORIGINAL_EFFECTS = {\n';
for (const [id, e] of Object.entries(effects)) out += `  ${id}: ${json(e)},\n`;
out += '};\n\nexport const ORIGINAL_CIVS = [\n';
for (const c of civs) out += `  ${json(c)},\n`;
out += '];\n';
fs.writeFileSync(OUT, out);
console.log(`${OUT}: ${Object.keys(units).length} units, ${techs.length} techs, ${Object.keys(effects).length} effects, ${civs.length} civs (${(out.length / 1024).toFixed(0)} KB)`);

// ------------------------------------------------------------ random maps
// What the random map generator needs: terrains (passability for land units
// = terrain restriction 7, the impassable variant used by cliffs, the
// objects each terrain is dotted with), the random map scripts of the land
// maps, and the objects they place.
const OUT_MAP = 'public/src/engine/data/original-map.js';
const LAND = dat.restrictions[7];
const terrains = dat.terrains.map((t, i) => (t.enabled ? {
  name: t.name, repl: t.replacement, impass: t.impassable, land: LAND[i] > 0,
  objects: t.units.filter((o) => unitOf(o.unit)).map((o) => [o.unit, o.density, o.placement]),
} : null));
const MAP_TYPES = { 7: 'hill_country', 4: 'highland' };
const rms = {};
for (const [i, key] of Object.entries(MAP_TYPES)) {
  const m = dat.maps[i];
  rms[key] = {
    type: Number(i), base: m.baseTerrain, cover: m.landCoverage, border: m.waterShape,
    lands: m.lands.map((l) => ({ id: l.id, terrain: l.terrain, spacing: l.spacing, size: l.baseSize, placement: l.placement, byPlayer: l.byPlayer, radius: l.startRadius, fade: l.edgeFade, clump: l.clumpiness, share: l.proportion })),
    terrains: m.terrains.map((t) => [t.terrain, t.proportion, t.clumps, t.edgeSpacing, t.zone, t.clumpiness]),
    units: m.units.map((u) => [u.unit, u.hostTerrain, u.groupPlacing, u.scale, u.perGroup, u.fluctuation, u.groups, u.radius, u.own, u.allPlayers, u.minDist, u.maxDist]),
  };
}
const mapUnitIds = new Set();
for (const t of terrains) if (t) for (const [u] of t.objects) mapUnitIds.add(u);
for (const m of Object.values(rms)) for (const u of m.units) mapUnitIds.add(u[0]);
for (let id = 264; id <= 273; id++) mapUnitIds.add(id); // cliffs
const mapUnits = {};
for (const id of [...mapUnitIds].sort((a, b) => a - b)) {
  const u = unitOf(id) || GAIA.units[id];
  if (!u) continue;
  const o = { name: u.name, type: u.type, cls: u.class, r: [f(u.radius[0]), f(u.radius[1])], gfx: u.standing };
  const store = u.storage.filter((s) => s.type >= 0 && s.amount > 0).map((s) => [s.type, f(s.amount)]);
  if (store.length) o.store = store;
  mapUnits[id] = o;
}
let mo = `// Random map data, generated by tools/gen-data.mjs from empires.dat (${dat.version.trim()}).\n`;
mo += '// Terrain objects are [unit, density per 1000 tiles, centred]; map script units are\n';
mo += '// [unit, host terrain, placing (0 single, 1 scattered, 2 clumped), scale, per group, fluctuation,\n';
mo += '//  groups, group radius, owner, land (>=0 player lands, -1 anywhere, -2 away from players), min, max].\n\n';
mo += 'export const ORIGINAL_TERRAINS = [\n';
for (const t of terrains) mo += `  ${t ? json(t) : 'null'},\n`;
mo += '];\n\nexport const ORIGINAL_RMS = {\n';
for (const [k, m] of Object.entries(rms)) mo += `  ${k}: ${json(m)},\n`;
mo += '};\n\nexport const ORIGINAL_MAP_UNITS = {\n';
for (const [id, u] of Object.entries(mapUnits)) mo += `  ${id}: ${json(u)},\n`;
mo += '};\n';
fs.writeFileSync(OUT_MAP, mo);
console.log(`${OUT_MAP}: ${terrains.filter(Boolean).length} terrains, ${Object.keys(rms).length} maps, ${Object.keys(mapUnits).length} objects (${(mo.length / 1024).toFixed(0)} KB)`);

// --------------------------------------------------------- AI build lists
// The computer player's strategies (data2\*.ai, copied to <dat folder>/ai by
// tools/import-aoe.mjs): the lists engine/data/ai-strategies.js can pick.
const OUT_AI = 'public/src/engine/data/original-ai.js';
const AI_DIR = path.join(path.dirname(src), 'ai');
if (!fs.existsSync(AI_DIR)) console.warn(`${AI_DIR} missing: ${OUT_AI} not regenerated (run tools/import-aoe.mjs)`);
else {
  const files = new Map(fs.readdirSync(AI_DIR).map((f) => [f.replace(/\.ai$/i, '').toLowerCase(), f]));
  const wanted = new Set();
  for (const s of Object.values(STRATEGIES)) for (const l of Object.values(s)) for (const [name] of l) wanted.add(name);
  let ao = `// Build lists of the Rise of Rome computer player, generated by tools/gen-data.mjs from data2\\*.ai.\n`;
  ao += '// Items in list order: [kind, dat id, quantity, limited retrains] — B building (rebuilt when destroyed),\n';
  ao += '// A building (rebuilt at most `retrains` times), U unit (always replaced), T unit (trained at most\n';
  ao += '// `retrains` times), R research (skipped when impossible), C critical research (waited for).\n\n';
  ao += 'export const AI_LISTS = {\n';
  let n = 0;
  for (const name of [...wanted].sort()) {
    const f = files.get(name.toLowerCase());
    if (!f) { console.warn('AI build list missing:', name); continue; }
    const items = [];
    for (const raw of fs.readFileSync(path.join(AI_DIR, f), 'latin1').split(/\r?\n/)) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      // a few lines have names with spaces or a doubled prefix ("UU35")
      const m = /^([BAURCT])+?(\d+)\s+(.+?)\s+(\d+)\s+(-?\d+)(?:\s+(\d+))?$/.exec(line);
      if (m) items.push([m[1], Number(m[2]), Number(m[4]), m[6] ? Number(m[6]) : 0]);
    }
    ao += `  ${JSON.stringify(name)}: ${JSON.stringify(items)},\n`;
    n++;
  }
  ao += '};\n';
  fs.writeFileSync(OUT_AI, ao);
  console.log(`${OUT_AI}: ${n} build lists (${(ao.length / 1024).toFixed(0)} KB)`);
}
