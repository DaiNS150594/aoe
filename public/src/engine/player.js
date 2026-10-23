// Player state: resources, the original technology tree with the player's own
// copy of every unit's data (engine/techtree.js), and the stats the
// simulation reads from it.
import { UNITS, originalStats } from './data/units.js';
import { BUILDINGS } from './data/buildings.js';
import { TECHS, TECH_OF_DAT } from './data/techs.js';
import { CIVS } from './data/civs.js';
import { UNIT_DAT, BUILDING_DAT, TASK_DAT } from './data/ids.js';
import { ORIGINAL_TECHS } from './data/original.js';
import { PLAYER_COLORS, GAIA_COLOR } from './constants.js';
import { initTechTree, techReachable, TS, TYPE_OF_DAT, baseSlot, ENABLED_BY, UPGRADED_BY, ATTR_COUNT } from './techtree.js';

// gather kind -> villager job unit whose work rate / carry capacity is used
const TASK_OF_KIND = {
  forage: TASK_DAT.forager, hunt: TASK_DAT.hunter, farm: TASK_DAT.farmer,
  wood: TASK_DAT.woodcutter, gold: TASK_DAT.goldminer, stone: TASK_DAT.stoneminer,
};
// player attributes (the original "resources" beyond food/wood/stone/gold)
export const ATTR = {
  AGE: 6, FAITH_RECHARGE: 35, FARM_FOOD: 36, TRIBUTE_TAX: 46, GOLD_BONUS: 47, WRITING: 50,
  CONVERT_PRIESTS: 27, CONVERT_BUILDINGS: 28, MEDICINE: 56, MARTYRDOM: 57,
};
// building technology researched when a building of that type is finished
export const BUILDING_OF_TECH = {};
for (const [type, def] of Object.entries(BUILDINGS)) if (def.research >= 0 && BUILDING_OF_TECH[def.research] === undefined) BUILDING_OF_TECH[def.research] = type;

export class Player {
  constructor(cfg) {
    this.id = cfg.id;
    this.name = cfg.name || (cfg.id === 0 ? 'Gaia' : 'Người chơi ' + cfg.id);
    this.civId = cfg.civ || 'greek';
    this.civ = CIVS[this.civId] || CIVS.greek;
    this.colorIdx = cfg.color ?? Math.max(0, cfg.id - 1);
    this.color = cfg.id === 0 ? GAIA_COLOR : PLAYER_COLORS[this.colorIdx % 8];
    this.team = cfg.team || 0;
    this.ai = cfg.ai || null;      // null for humans, else difficulty string
    this.isGaia = cfg.id === 0;
    this.res = { food: 0, wood: 0, gold: 0, stone: 0 };
    this.attr = new Float64Array(ATTR_COUNT);
    for (const [i, v] of Object.entries(this.civ.resources)) if (Number(i) >= 4) this.attr[i] = v;
    this.age = 0;
    this.flags = new Set();
    this.pop = 0;          // units alive (pop units)
    this.training = 0;     // pop reserved by units in training
    this.popCap = 0;
    this.units = new Set();
    this.buildings = new Set();
    this.alive = true;
    this.resigned = false;
    this.defeatedTick = -1;
    this.statCache = new Map();
    this.bstatCache = new Map();
    this.cheats = new Set();
    this.lastAlert = 0;
    this.stats = {
      killed: 0, lost: 0, razed: 0, buildingsLost: 0, converted: 0, convertedLost: 0, techs: 0,
      gathered: { food: 0, wood: 0, gold: 0, stone: 0 }, tributeSent: 0, tributeRecv: 0,
      villagerHigh: 0, militaryHigh: 0, ageTicks: [0, -1, -1, -1], wonder: 0, explored: 0,
    };
    initTechTree(this, this.isGaia ? [] : this.civ.effects);
    this.syncAttrs();
  }

  invalidate() { this.statCache.clear(); this.bstatCache.clear(); this.syncAttrs(); }

  // age and boolean flags follow the player attributes set by effects
  syncAttrs() {
    this.age = Math.max(0, Math.min(3, (this.attr[ATTR.AGE] || 1) - 1));
    const cheat = [...this.flags].filter((f) => f.startsWith('cheat:'));
    this.flags = new Set(cheat);
    if (this.attr[ATTR.WRITING] > 0) this.flags.add('sharedLos');
    if (this.attr[ATTR.CONVERT_BUILDINGS] > 0) this.flags.add('monotheism');
    if (this.attr[ATTR.MARTYRDOM] > 0) this.flags.add('martyrdom');
    if (this.attr[ATTR.TRIBUTE_TAX] <= 0) this.flags.add('tributeFree');
  }

  // ------------------------------------------------------- unit data
  // dat unit currently behind a game type (age upgrades that only change looks)
  datOf(type) {
    const base = UNIT_DAT[type] ?? BUILDING_DAT[type];
    const cur = this.slot.get(base);
    return cur !== undefined && TYPE_OF_DAT[cur] === undefined ? cur : base;
  }
  master(type) { return this.masters.get(this.datOf(type)); }
  unitStats(type) {
    let s = this.statCache.get(type);
    if (!s) { s = computeUnitStats(this, type); this.statCache.set(type, s); }
    return s;
  }
  buildingStats(type) {
    let s = this.bstatCache.get(type);
    if (!s) { s = computeBuildingStats(this, type); this.bstatCache.set(type, s); }
    return s;
  }
  // villager job unit (work rate, carry capacity, hunting weapon)
  task(id) { return this.masters.get(id); }

  carryCap(kind) {
    const m = this.masters.get(TASK_OF_KIND[kind]);
    return Math.max(1, m ? m.cap : 10);
  }
  workRate(kind) {
    // farming speed is the farm's own work rate (Palmyra's farming bonus targets the farm)
    const m = kind === 'farm' ? this.masters.get(BUILDING_DAT.farm) : this.masters.get(TASK_OF_KIND[kind]);
    return (m ? m.work : 0.45) * (this.flags.has('cheat:steroids') ? 6 : 1);
  }
  // A task's work value (empires.dat): [action, target class, work 1, work 2]
  // of a villager job or the priest; a target-class entry wins over the default (-1).
  taskWork(unitId, action, cls = -1, which = 2) {
    const m = this.masters.get(unitId);
    let best = null;
    for (const t of (m && m.tasks) || []) if (t[0] === action && (t[1] === cls || (t[1] === -1 && !best))) best = t;
    return best ? best[which] : 0;
  }
  // seconds of construction a builder adds per second (build task 1.0 x work rate 1.0)
  buildRate() { return this.taskWork(TASK_DAT.builder, 101) * this.masters.get(TASK_DAT.builder).work; }
  // seconds of construction a repairer restores per second (0.75 x 0.4 for buildings)
  repairRate(cls = 3) { return this.taskWork(TASK_DAT.repairer, 106, cls) * this.masters.get(TASK_DAT.repairer).work; }
  get farmFood() { return this.attr[ATTR.FARM_FOOD]; }
  get goldBonus() { return this.attr[ATTR.GOLD_BONUS] || 1; }
  get faithRecharge() { return this.attr[ATTR.FAITH_RECHARGE]; }
  get healBonus() { return this.attr[ATTR.MEDICINE] || 1; }
  get tributeTax() { return Math.max(0, this.attr[ATTR.TRIBUTE_TAX]); }

  canAfford(cost) {
    for (const k in cost) if ((this.res[k] || 0) < cost[k] - 1e-9) return false;
    return true;
  }
  pay(cost) { for (const k in cost) this.res[k] -= cost[k]; }
  refund(cost, frac = 1) { for (const k in cost) this.res[k] += cost[k] * frac; }

  // ----------------------------------------------------------- tech tree
  techState(id) { const d = TECHS[id]; return d ? this.state[d.dat] : TS.DISABLED; }
  has(id) { return this.techState(id) === TS.DONE; }
  techCostOf(id) { return this.techCost[TECHS[id].dat]; }
  techTimeOf(id) { return this.techTime[TECHS[id].dat]; }
  techDisabled(id) { const d = TECHS[id]; return !d || !techReachable(this, d.dat); }
  unitEnabled(type) { return this.enabled.has(baseSlot(UNIT_DAT[type])); }
  unitDisabled(type) {
    const id = UNIT_DAT[type];
    if (id === undefined) return true;
    const base = baseSlot(id);
    if (base === id) return !this.enabled.has(id) && !(ENABLED_BY[id] !== undefined && techReachable(this, ENABLED_BY[id]));
    if (this.unitDisabled(TYPE_OF_DAT[base])) return true;
    return UPGRADED_BY[id] === undefined || !techReachable(this, UPGRADED_BY[id]);
  }
  buildingEnabled(type) { return this.enabled.has(BUILDING_DAT[type]); }
  buildingDisabled(type) {
    const id = BUILDING_DAT[type];
    if (id === undefined) return true;
    if (baseSlot(id) !== id) return this.buildingDisabled(TYPE_OF_DAT[baseSlot(id)]);
    return !this.enabled.has(id) && !(ENABLED_BY[id] !== undefined && techReachable(this, ENABLED_BY[id]));
  }
  hasBuilt(type) {
    for (const b of this.buildings) if (b.type === type && b.built) return true;
    return false;
  }
  countBuildings(type, includeUnbuilt = true) {
    let n = 0;
    for (const b of this.buildings) if (b.type === type && (includeUnbuilt || b.built)) n++;
    return n;
  }
  // Which unit of a line is trainable now (the slot's current upgrade), or null.
  currentOfLine(line) {
    const base = UNIT_DAT[line[0]];
    if (!this.enabled.has(base)) return null;
    const cur = TYPE_OF_DAT[this.slot.get(base) ?? base];
    return line.includes(cur) ? cur : line[0];
  }
  // tower / wall type placed when building the first level of a line
  currentBuilding(type) {
    const cur = TYPE_OF_DAT[this.slot.get(BUILDING_DAT[type])];
    return cur || type;
  }

  // Why a locked technology is not available yet (Vietnamese), or null.
  techRequirement(dat) {
    const t = ORIGINAL_TECHS[dat];
    const missing = t.req.filter((r) => this.state[r] !== TS.DONE);
    if (t.req.length - missing.length >= t.need) return null;
    const names = missing.map((r) => requirementName(r)).filter(Boolean);
    const need = t.need - (t.req.length - missing.length);
    if (!names.length) return 'Chưa đủ điều kiện';
    return need < names.length ? `Cần ${need} trong số: ${names.join(', ')}` : 'Cần ' + names.join(', ');
  }
}

const AGE_TECH_VI = { 101: 'lên Đời 2', 102: 'lên Đời 3', 103: 'lên Đời 4' };
function requirementName(r) {
  if (AGE_TECH_VI[r]) return AGE_TECH_VI[r];
  if (BUILDING_OF_TECH[r]) return 'xây ' + BUILDINGS[BUILDING_OF_TECH[r]].vi;
  if (TECH_OF_DAT[r]) return 'nghiên cứu ' + TECHS[TECH_OF_DAT[r]].vi;
  // "2 buildings of the age" shadow technologies
  const t = ORIGINAL_TECHS[r];
  if (t && t.time === 0 && t.need) return `${t.need} công trình (${t.req.map((x) => BUILDING_OF_TECH[x] ? BUILDINGS[BUILDING_OF_TECH[x]].vi : '').filter(Boolean).join(', ')})`;
  return null;
}

// --------------------------------------------------------------- stats
function projectileOf(p, m, kind) {
  if (!kind || m.proj < 0) return null;
  const pm = p.masters.get(p.slot.get(m.proj) ?? m.proj) || p.masters.get(m.proj);
  return { kind, dat: pm ? pm.name : '', speed: pm ? pm.speed : 8, arc: pm ? pm.arc : 0.1, smart: pm ? !!pm.smart : false };
}

export function computeUnitStats(player, type) {
  const def = UNITS[type];
  const m = player.master(type);
  const s = { type, def, ...originalStats(m) };
  s.attacks = s.attacks.map((a) => a.slice());
  s.armors = s.armors.map((a) => a.slice());
  s.hasAtk = !!def.atk;
  s.proj = projectileOf(player, m, def.proj);
  s.time = s.time * (m.timeMul ?? 1);
  s.convResist = def.convResist * (player.civ.convResist || 1);
  // cheats
  if (type === 'priest' && player.flags.has('cheat:hoyohoyo')) { s.speed *= 3; s.hp = 600; }
  if (type === 'ballista' && player.flags.has('cheat:icbm')) { s.range = 100; s.los = 100; }
  if (type === 'heavy_catapult' && player.flags.has('cheat:bigbertha')) { s.range += 8; s.los += 8; }
  return s;
}

export function computeBuildingStats(player, type) {
  const def = BUILDINGS[type];
  const m = player.master(type);
  const s = { type, def, ...originalStats(m) };
  s.attacks = s.attacks.map((a) => a.slice());
  s.armors = s.armors.map((a) => a.slice());
  s.hasAtk = !!def.atk;
  s.pop = m.store ? Math.max(0, ...m.store.filter((x) => x[0] === 4).map((x) => x[1])) : 0;
  s.proj = projectileOf(player, m, def.proj);
  return s;
}

// The original HUD numbers: highest attack / armor of the lists, pierce armor
// (class 3); shown as base + bonus like the 1998 interface.
export function displayStats(s) {
  const top = (list, dflt) => list.reduce((mx, a) => Math.max(mx, a[1]), dflt);
  const atk = top(s.attacks, 0);
  const arm = top(s.armors, s.defArmor || 0);
  const pierce = (s.armors.find((a) => a[0] === 3) || [3, 0])[1];
  const sh = s.shown || {};
  const split = (v, base) => (base !== undefined && base !== null && v !== base && base > 0 ? `${base}+${v - base}` : String(v));
  return {
    atk, arm, pierce, range: s.range,
    atkText: split(atk, sh.atk), armText: split(arm, sh.arm), pierceText: split(pierce, sh.pierce),
  };
}

export function ageRequirementMet(player, techId) {
  const d = TECHS[techId];
  if (!d) return true;
  return ORIGINAL_TECHS[d.dat].req.every((r) => ORIGINAL_TECHS[r].time !== 0 || player.state[r] === TS.DONE || AGE_TECH_VI[r]);
}
