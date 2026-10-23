// The original technology system, as reverse-engineered from the Rise of Rome
// executable (empires.exe 1.0, 1998):
//  - every player owns a copy of each unit's data ("master"); effect commands
//    from technologies and the civilisation's tech tree modify these copies;
//  - each technology is disabled (-1), locked (0), available (1), being
//    researched (2) or done (3). After every research all locked/available
//    technologies are re-checked: when enough requirements are done they
//    become available, and the ones that take no time ("shadow" techs such as
//    "Granary + Tool Age -> Market") complete on the spot;
//  - a finished building researches its own building technology.
import { ORIGINAL_UNITS, ORIGINAL_TECHS, ORIGINAL_EFFECTS } from './data/original.js';
import { UNIT_DAT, BUILDING_DAT } from './data/ids.js';

export const TS = { DISABLED: -1, LOCKED: 0, AVAILABLE: 1, RESEARCHING: 2, DONE: 3 };
export const ATTR_COUNT = 64; // player attribute ("resource") slots used by Rise of Rome

// dat unit id -> this game's unit/building type
export const TYPE_OF_DAT = {};
for (const [t, id] of Object.entries(UNIT_DAT)) TYPE_OF_DAT[id] = t;
for (const [t, id] of Object.entries(BUILDING_DAT)) TYPE_OF_DAT[id] = t;

// unit upgrades always name the unit of the first level ("slot"); BASE_SLOT
// maps every later level back to it. ENABLED_BY / UPGRADED_BY: which
// technology enables (effect 2) or upgrades into (effect 3) a unit.
export const BASE_SLOT = {};
export const ENABLED_BY = {};
export const UPGRADED_BY = {};
ORIGINAL_TECHS.forEach((t, i) => {
  for (const [type, a, b] of ORIGINAL_EFFECTS[t.effect] || []) {
    if (type === 3 && a >= 0 && b >= 0) { BASE_SLOT[b] = a; if (UPGRADED_BY[b] === undefined) UPGRADED_BY[b] = i; }
    if (type === 2 && b === 1 && a >= 0 && ENABLED_BY[a] === undefined) ENABLED_BY[a] = i;
  }
});
export const baseSlot = (id) => (BASE_SLOT[id] !== undefined ? BASE_SLOT[id] : id);

function cloneMaster(u) {
  const m = { ...u };
  if (u.atk) m.atk = u.atk.map((a) => a.slice());
  if (u.arm) m.arm = u.arm.map((a) => a.slice());
  if (u.store) m.store = u.store.map((s) => s.slice());
  if (u.cost) m.cost = { ...u.cost };
  return m;
}

export function initTechTree(p, civEffects) {
  p.masters = new Map();
  for (const id in ORIGINAL_UNITS) p.masters.set(Number(id), cloneMaster(ORIGINAL_UNITS[id]));
  p.state = new Int8Array(ORIGINAL_TECHS.length);
  p.techTime = Int16Array.from(ORIGINAL_TECHS, (t) => t.time);
  p.techCost = ORIGINAL_TECHS.map((t) => ({ ...t.cost }));
  p.enabled = new Set();
  p.slot = new Map();
  p.techOrder = [];
  p.upgrades = [];
  applyEffect(p, civEffects);
  checkTechs(p);
}

// ------------------------------------------------------------ research
export function completeTech(p, i) {
  const s = p.state[i];
  if (s >= TS.DONE || s <= TS.DISABLED) return false;
  p.state[i] = TS.DONE;
  p.techOrder.push(i);
  applyEffect(p, ORIGINAL_EFFECTS[ORIGINAL_TECHS[i].effect]);
  checkTechs(p);
  return true;
}

export function checkTechs(p) {
  const n = ORIGINAL_TECHS.length;
  for (let i = 0; i < n; i++) {
    const s = p.state[i];
    if (s >= TS.RESEARCHING || s <= TS.DISABLED) continue;
    const t = ORIGINAL_TECHS[i];
    let met = 0;
    for (const r of t.req) if (p.state[r] === TS.DONE) met++;
    if (met >= t.need) {
      if (p.techTime[i] <= 0) completeTech(p, i);
      else if (p.state[i] < TS.AVAILABLE) p.state[i] = TS.AVAILABLE;
    } else if (p.state[i] > TS.LOCKED) p.state[i] = TS.LOCKED;
  }
}

// Can technology i still be researched some day (not disabled, requirements reachable)?
export function techReachable(p, i, seen = new Set()) {
  const s = p.state[i];
  if (s === TS.DONE) return true;
  if (s === TS.DISABLED || seen.has(i)) return false;
  seen.add(i);
  const t = ORIGINAL_TECHS[i];
  let ok = 0;
  for (const r of t.req) if (techReachable(p, r, seen)) ok++;
  seen.delete(i);
  return ok >= t.need;
}

// --------------------------------------------------------------- effects
export function applyEffect(p, cmds) {
  if (!cmds) return;
  for (const [type, a, b, c, d] of cmds) {
    switch (type) {
      case 0: case 4: case 5: forMasters(p, a, b, (m) => modifyAttr(m, type, c, d)); break;
      case 1: if (a > -1) setResource(p, a, b === 0 ? d : resource(p, a) + d); break;
      case 2: if (a > -1) { if (b) p.enabled.add(a); else p.enabled.delete(a); } break;
      case 3: if (a > -1 && b > -1 && p.masters.has(b)) { p.slot.set(a, b); p.upgrades.push([a, b]); } break;
      case 6: if (a > -1) setResource(p, a, resource(p, a) * d); break;
      case 101: if (a > -1 && b > -1) { const k = RES_NAMES[b]; if (k) p.techCost[a][k] = c ? (p.techCost[a][k] || 0) + d : d; } break;
      case 102: if (d > -1 && p.state[d] !== TS.DONE) p.state[d] = TS.DISABLED; break;
      case 103: if (a > -1) p.techTime[a] = c ? p.techTime[a] + d : d; break;
      default:
    }
  }
}

// a >= 0: that unit only; otherwise every unit of class b (a = b = -1 matches nothing)
function forMasters(p, a, b, fn) {
  if (a >= 0) { const m = p.masters.get(a); if (m) fn(m); return; }
  if (b < 0) return;
  for (const m of p.masters.values()) if (m.cls === b) fn(m);
}

const RES_NAMES = ['food', 'wood', 'stone', 'gold'];
export function resource(p, i) { return i < 4 ? p.res[RES_NAMES[i]] : p.attr[i]; }
function setResource(p, i, v) { if (i < 4) p.res[RES_NAMES[i]] = v; else if (i < ATTR_COUNT) p.attr[i] = v; }

// The attribute arithmetic of effect commands 0 (set), 4 (add) and 5
// (multiply). Integer fields truncate like the original (float -> int).
const trunc = Math.trunc;
export function modifyAttr(m, op, attr, d) {
  const num = (v) => (op === 0 ? d : op === 4 ? v + d : v * d);
  const int = (v) => trunc(num(v));
  switch (attr) {
    case 0: m.hp = int(m.hp); break;
    case 1: m.los = num(m.los); break;
    case 3: m.r = [num(m.r[0]), m.r[1]]; break;
    case 4: m.r = [m.r[0], num(m.r[1])]; break;
    case 5: if (m.speed !== undefined) m.speed = num(m.speed); break;
    case 8: case 9: { // armor / attack: d = class * 256 + amount
      const list = attr === 8 ? m.arm : m.atk;
      if (!list) break;
      const v = trunc(d), cls = (v >> 8) & 255, amount = v & 255;
      if (op === 0) { if (cls < list.length) list[cls][1] = amount; } // the original indexes the list here
      else if (op === 4) { const e = list.find((x) => x[0] === cls); if (e) e[1] += amount; }
      break;
    }
    case 10: if (m.reload !== undefined) m.reload = num(m.reload); break;
    case 11: if (m.accuracy !== undefined) m.accuracy = int(m.accuracy); break;
    case 12: if (m.range !== undefined) m.range = num(m.range); break;
    case 13: if (m.work !== undefined) m.work = num(m.work); break;
    case 14: m.cap = int(m.cap || 0); break;
    case 15: if (m.defArmor !== undefined) m.defArmor = op === 5 ? trunc((m.proj || 0) * d) & 255 : int(m.defArmor) & 255; break;
    case 16: if (m.proj !== undefined) m.proj = int(m.proj); break;
    case 17: m.facet = int(m.facet || 0); break;
    case 19: m.smart = int(m.smart || 0); break;
    case 20: if (m.minRange !== undefined) m.minRange = num(m.minRange); break;
    case 100: if (m.cost) for (const k in m.cost) m.cost[k] = int(m.cost[k]); break;
    case 101: { // population used (first storage entry: population headroom)
      const s = m.store && m.store.find((x) => x[0] === 4);
      if (s) s[1] = num(s[1]);
      break;
    }
    case 102: m.timeMul = num(m.timeMul ?? 1); break; // training time (only the custom Lạc Việt civ uses it)
    default:
  }
}
