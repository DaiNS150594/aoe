// Computer player. Runs inside the deterministic simulation (every peer runs
// the same AI with the same world state) and acts only through commands.
//
// Like the Rise of Rome computer player it follows a strategy: one of the
// original build lists (data2\*.ai), picked per civilisation the way
// empires.exe picks it (data/ai-strategies.js). The list is worked through in
// order, two items at a time: buildings (rebuilt when destroyed), units (U
// replaced when killed, T only a limited number of times), research (R
// skipped when impossible, C critical: waited for). The first item it cannot
// afford holds everything after it while the villagers gather what the next
// items cost. Items the rules forbid (D3KT, Cung R) are passed over for now.
// Houses and drop sites are built when needed, farms when wild food runs out,
// and the army attacks after the strategy's first-attack delay, in groups of
// 2 to 10 that grow with time.
import { UNITS, UNIT_LINES, isMilitary } from './data/units.js';
import { BUILDINGS } from './data/buildings.js';
import { TECHS, TECH_OF_DAT } from './data/techs.js';
import { UNIT_DAT, BUILDING_DAT } from './data/ids.js';
import { AI_LISTS } from './data/original-ai.js';
import { pickStrategy, firstAttackDelay, ATTACK_GROUP } from './data/ai-strategies.js';
import { GAIA } from './constants.js';
import { dist, distToRect } from './dmath.js';
import { trainError, researchError, buildError } from './production.js';
import { ruleBuildError, ruleTrainError } from './rules.js';
import { MsRand } from './rms.js';

const RES = ['food', 'wood', 'gold', 'stone'];
const UNIT_OF_DAT = {};
for (const [t, id] of Object.entries(UNIT_DAT)) UNIT_OF_DAT[id] = t;
const BUILDING_OF_DAT = {};
for (const [t, id] of Object.entries(BUILDING_DAT)) BUILDING_OF_DAT[id] = t;
// unit type -> its line's first unit (what a build list counts)
const LINE_KEY = {};
for (const lines of Object.values(UNIT_LINES)) for (const line of lines) for (const t of line) LINE_KEY[t] = line[0];
// seconds an item may stay blocked (not by money) before it is skipped
const GIVE_UP = 150;

export class AIController {
  constructor(world, player, level) {
    this.w = world;
    this.p = player;
    this.level = level || 'moderate';
    // the AI's own C library rand(), so its choices don't disturb the world's dice
    const r = new MsRand(((world.settings.seed >>> 0) ^ Math.imul(player.id, 0x9e3779b1)) >>> 0);
    this.rand = () => r.rand();
    this.strategy = pickStrategy(player.civId, this.level, world.settings.startRes === 'deathmatch', this.rand);
    this.firstAttack = firstAttackDelay(this.strategy, this.level, this.rand);
    this.items = this.readList(AI_LISTS[this.strategy] || []);
    this.home = world.starts[player.id] ? { x: world.starts[player.id].x + 0.5, y: world.starts[player.id].y + 0.5 } : { x: 10, y: 10 };
    this.attacking = false;
    this.attackTarget = 0;
    this.lastAttackOrder = -9999;
    this.defending = false;
    this.lastDrop = {};
    this.needs = { food: 0, wood: 0, gold: 0, stone: 0 };
    this.mem = { villagers: [], idle: [], military: [], byType: {}, tasks: {}, onTarget: new Map() };
  }

  // build list items with this game's ids; things this game doesn't have (boats) are dropped
  readList(list) {
    const items = [];
    for (const [k, id, n, r] of list) {
      const it = { k, n: Math.max(1, n), r, trained: 0, done: false, since: -1 };
      if (k === 'B' || k === 'A') it.btype = BUILDING_OF_DAT[id];
      else if (k === 'U' || k === 'T') it.key = LINE_KEY[UNIT_OF_DAT[id]];
      else it.tech = TECH_OF_DAT[id];
      if (it.btype || it.key || it.tech) items.push(it);
    }
    return items;
  }

  cmd(c) { this.w.applyCommand(this.p.id, c); }

  update() {
    const w = this.w, p = this.p;
    if (!p.alive || w.over) return;
    if ((w.tick + p.id * 3) % 10 !== 0) return;
    this.n = (this.n || 0) + 1;
    this.scan();
    this.budget = { ...p.res };
    this.houses();
    this.buildList();
    this.economy();
    this.farms();
    if (this.n % 5 === 1) this.foundations();
    this.military();
  }

  scan() {
    const p = this.p;
    const vill = [], idle = [], mil = [];
    const tasks = { food: 0, wood: 0, gold: 0, stone: 0, build: 0 };
    const onTarget = new Map();
    for (const u of p.units) {
      if (u.type === 'villager') {
        vill.push(u);
        const o = u.order;
        if (!o) idle.push(u);
        else if (o.type === 'gather') {
          const k = o.kind;
          if (k === 'wood') tasks.wood++; else if (k === 'gold') tasks.gold++; else if (k === 'stone') tasks.stone++; else tasks.food++;
          onTarget.set(o.target, (onTarget.get(o.target) || 0) + 1);
        } else if (o.type === 'build' || o.type === 'repair') tasks.build++;
      } else if (isMilitary(UNITS[u.type])) mil.push(u);
    }
    const byType = {};
    for (const b of p.buildings) (byType[b.type] = byType[b.type] || []).push(b);
    this.mem = { villagers: vill, idle, military: mil, byType, tasks, onTarget };
    const tc = (byType.town_center || []).find((b) => b.built) || (byType.town_center || [])[0];
    if (tc) this.home = { x: tc.x, y: tc.y };
    this.tc = tc && tc.built ? tc : null;
  }

  count(type, builtOnly = false) {
    const l = this.mem.byType[type] || [];
    return builtOnly ? l.filter((b) => b.built).length : l.length;
  }
  afford(cost) { for (const k of RES) if ((cost[k] || 0) > this.budget[k]) return false; return true; }
  spend(cost) { for (const k of RES) this.budget[k] -= cost[k] || 0; }

  // ----------------------------------------------------------- build list
  buildList() {
    const p = this.p, w = this.w;
    // what there is: units per line (with the ones in production), buildings per type
    const have = new Map();
    const add = (k, n) => have.set(k, (have.get(k) || 0) + n);
    for (const u of p.units) if (LINE_KEY[u.type]) add(LINE_KEY[u.type], 1);
    const researching = new Set();
    for (const b of p.buildings) {
      add('b:' + b.type, 1);
      for (const q of b.queue) if (LINE_KEY[q.type]) add(LINE_KEY[q.type], q.n);
      if (b.research) researching.add(b.research.tech);
    }
    const used = new Map();
    const needs = { food: 0, wood: 0, gold: 0, stone: 0 };
    let pending = 0, ahead = 0;
    for (const it of this.items) {
      if (it.done) continue;
      if (it.tech) {
        if (p.has(it.tech) || p.techDisabled(it.tech)) { it.done = true; continue; }
        // critical research: nothing further down the list until it is done
        if (researching.has(it.tech)) { if (it.k === 'C') break; continue; }
      } else {
        const key = it.btype ? 'b:' + it.btype : it.key;
        const got = Math.min(it.n, (have.get(key) || 0) - (used.get(key) || 0));
        used.set(key, (used.get(key) || 0) + Math.max(0, got));
        if (got >= it.n) { it.since = -1; continue; }
        if (it.k === 'T' && it.trained >= it.n * Math.max(1, it.r)) continue; // its retrains are used up
      }
      if (this.never(it)) { it.done = true; continue; }
      // the next items' costs steer the gatherers
      if (ahead < 4 && !this.forbidden(it)) { const c = this.itemCost(it); for (const k of RES) needs[k] += c[k] || 0; ahead++; }
      if (pending >= 2) { if (it.k === 'C') break; continue; }
      pending++;
      const res = this.tryItem(it);
      if (res === 'skip') { it.done = true; pending--; continue; }
      if (res === 'pass') pending--;
      else if (res === 'started' || res === 'busy') it.since = -1;
      else {
        // waiting: for money, or for something to be unlocked (given up on after a while)
        if (res === 'blocked') {
          if (it.since < 0) it.since = w.tick;
          else if (it.k !== 'C' && w.tick - it.since > GIVE_UP * 10) { it.done = true; pending--; continue; }
        }
        pending = 2; // nothing after it until this one goes
      }
      if (it.k === 'C') break;
    }
    // and what the houses and farms built on the side will cost
    const p2 = this.p;
    if (p2.popCap - (p2.pop + p2.training) <= 4 && p2.popCap < w.settings.popLimit) needs.wood += p2.buildingStats('house').cost.wood || 0;
    if (this.count('market', true) && p2.age >= 1) needs.wood += Math.max(0, Math.min(3, this.wantedFarms() - this.count('farm'))) * (p2.buildingStats('farm').cost.wood || 0);
    this.needs = needs;
  }

  // items this player can never do (the civilisation lacks them, water, rules)
  never(it) {
    const p = this.p, w = this.w;
    if (it.btype) return p.buildingDisabled(it.btype) || !!BUILDINGS[it.btype].water || !!ruleBuildError(w, p, it.btype);
    if (it.key) { const line = findLine(it.key); return !line || p.unitDisabled(line[0]); }
    return p.techDisabled(it.tech);
  }
  // items the rules forbid right now (D3KT: one soldier before the Bronze Age...)
  forbidden(it) {
    if (!it.key) return false;
    const u = this.lineUnit(it.key);
    return !!u && !!ruleTrainError(this.w, this.p, u);
  }

  itemCost(it) {
    const p = this.p;
    if (it.btype) return p.buildingStats(it.btype).cost;
    if (it.key) { const t = this.lineUnit(it.key); return t ? p.unitStats(t).cost : {}; }
    const d = TECHS[it.tech];
    return d ? p.techCost[d.dat] || d.cost || {} : {};
  }
  lineUnit(key) {
    const line = findLine(key);
    return line ? this.p.currentOfLine(line) : null;
  }

  // 'started', 'busy' (its building is working: look further), 'wait' (money),
  // 'blocked' (not unlocked / no building yet), 'pass' (rules forbid it for now), 'skip' (never)
  tryItem(it) {
    const p = this.p, w = this.w, m = this.mem;
    if (it.btype) {
      const t = it.btype;
      if (p.buildingDisabled(t) || BUILDINGS[t].water || ruleBuildError(w, p, t)) return 'skip';
      if (buildError(w, p, t)) return 'blocked';
      const cost = p.buildingStats(t).cost;
      if (!this.afford(cost)) return 'wait';
      const spot = this.spotFor(t);
      if (!spot) return 'pass';
      if (!this.buildWith(t, spot, t === 'town_center' || t === 'wonder' ? 4 : t === 'farm' || t === 'house' ? 1 : 2)) return 'wait';
      this.spend(cost);
      return 'started';
    }
    if (it.key) {
      const line = findLine(it.key);
      const u = line && p.currentOfLine(line);
      if (!u) return line && p.unitDisabled(line[0]) ? 'skip' : 'blocked';
      if (ruleTrainError(w, p, u)) return 'pass';
      const blds = (m.byType[UNITS[u].building] || []).filter((b) => b.built);
      if (!blds.length) return 'blocked';
      const b = blds.find((x) => !x.research && x.queue.reduce((s, q) => s + q.n, 0) < 2 && (!x.queue.length || x.queue[0].type === u));
      if (!b) return 'busy';
      if (trainError(w, p, b, u)) return 'busy';
      if (p.pop + p.training + 1 > p.popCap) return p.popCap >= w.settings.popLimit ? 'pass' : 'wait'; // full: go on with the list
      const cost = p.unitStats(u).cost;
      if (!this.afford(cost)) return 'wait';
      this.cmd({ type: 'train', bid: b.id, utype: u, n: 1 });
      this.spend(cost);
      it.trained++;
      return 'started';
    }
    const def = TECHS[it.tech];
    const blds = (m.byType[def.building] || []).filter((b) => b.built);
    if (!blds.length) return 'blocked';
    const b = blds.find((x) => !x.research && !x.queue.length);
    if (!b) return 'busy';
    if (researchError(w, p, b, it.tech)) return 'blocked';
    const cost = p.techCost[def.dat] || def.cost;
    if (!this.afford(cost)) return 'wait';
    this.cmd({ type: 'research', bid: b.id, tech: it.tech });
    this.spend(cost);
    return 'started';
  }

  // where a building of the list goes
  spotFor(t) {
    const h = this.home;
    if (t === 'farm') return this.farmSpot();
    if (t === 'granary') {
      const r = this.pickStatic('berry_bush', h.x, h.y, 30, 99);
      return r ? this.findSpot(t, r.x, r.y, 2, 6) : this.findSpot(t, h.x, h.y, 4, 12);
    }
    if (t === 'storage_pit') {
      const r = this.pickStatic('tree', h.x, h.y, 30, 99);
      return r ? this.findSpot(t, r.x, r.y, 2, 6) : this.findSpot(t, h.x, h.y, 4, 12);
    }
    if (t === 'town_center') return this.findSpot(t, h.x, h.y, 12, 30);
    if (BUILDINGS[t].cls.includes('tower')) return this.findSpot(t, h.x, h.y, 7, 14, true);
    return this.findSpot(t, h.x, h.y, 5, 18);
  }

  // ------------------------------------------------------------- economy
  houses() {
    const p = this.p, w = this.w, m = this.mem;
    const room = p.popCap - (p.pop + p.training);
    const building = (m.byType.house || []).filter((b) => !b.built).length;
    if (room <= 2 + Math.floor(m.villagers.length / 12) && p.popCap < w.settings.popLimit && building < (m.villagers.length > 20 ? 2 : 1)) {
      const cost = p.buildingStats('house').cost;
      if (!this.afford(cost)) return;
      const spot = this.findSpot('house', this.home.x, this.home.y, 4, 16);
      if (spot && this.buildWith('house', spot, 1)) this.spend(cost);
    }
  }

  economy() {
    const m = this.mem;
    // assign idle villagers (skip the ones that just got a build order)
    for (const v of m.idle) if (!v.order && !v.dead) this.assign(v);
    // move villagers when the mix is badly off (every ~5s, up to two)
    if (this.n % 5 === 2) { this.rebalance(); this.rebalance(); }
    if (this.n % 12 === 3) this.dropSiteCheck();
    if (this.n % 6 === 2) this.elephantHunt();
  }

  // share of the villagers per resource: a base mix for the age, pulled
  // towards what the next items of the list still lack
  baseRatios() {
    return [
      { food: 0.62, wood: 0.38, gold: 0, stone: 0 },
      { food: 0.52, wood: 0.38, gold: 0.1, stone: 0 },
      { food: 0.45, wood: 0.3, gold: 0.25, stone: 0 },
      { food: 0.4, wood: 0.28, gold: 0.32, stone: 0 },
    ][Math.min(3, this.p.age)];
  }
  ratios() {
    const p = this.p, a = p.age, res = p.res;
    const base = this.baseRatios();
    const lack = {};
    let sum = 0;
    for (const k of RES) { lack[k] = Math.max(0, (this.needs[k] || 0) - res[k]); sum += lack[k]; }
    const r = {};
    for (const k of RES) r[k] = sum > 0 ? base[k] * 0.5 + 0.5 * lack[k] / sum : base[k];
    // don't pile up what nothing needs
    for (const k of RES) if (res[k] > 400 + a * 200 && !lack[k]) r[k] *= 0.4;
    let t = 0;
    for (const k of RES) t += r[k];
    for (const k of RES) r[k] /= t || 1;
    return r;
  }

  pickKind() {
    const t = this.mem.tasks, n = this.mem.villagers.length || 1, r = this.ratios();
    let best = 'food', bd = -Infinity;
    for (const k of RES) {
      const deficit = r[k] * n - t[k];
      if (r[k] > 0 && deficit > bd) { bd = deficit; best = k; }
    }
    return best;
  }

  assign(v) {
    const kind = this.pickKind();
    const t = this.findResource(kind, v);
    const on = this.mem.onTarget;
    if (t) {
      this.cmd({ type: 'gather', ids: [v.id], target: t.id });
      this.mem.tasks[kind]++;
      on.set(t.id, (on.get(t.id) || 0) + 1);
      this.ensureDropSite(kind, t);
    } else if (kind !== 'wood') {
      const t2 = this.findResource('wood', v);
      if (t2) { this.cmd({ type: 'gather', ids: [v.id], target: t2.id }); this.mem.tasks.wood++; on.set(t2.id, (on.get(t2.id) || 0) + 1); }
    }
  }

  rebalance() {
    const t = this.mem.tasks, n = this.mem.villagers.length, r = this.ratios();
    for (const k of RES) {
      if (r[k] > 0 && t[k] < r[k] * n - 2) {
        // take one from the most over-staffed resource
        let over = null, od = 1.5;
        for (const k2 of RES) { const d = t[k2] - r[k2] * n; if (d > od) { od = d; over = k2; } }
        if (!over) return;
        // the one carrying the least (farmers always carry a little)
        let v = null;
        for (const u of this.mem.villagers) if (u.order && u.order.type === 'gather' && kindGroup(u.order.kind) === over && (!v || u.carry < v.carry)) v = u;
        if (!v || v.carry > 5) return;
        const res = this.findResource(k, v);
        if (res) { this.cmd({ type: 'gather', ids: [v.id], target: res.id }); t[k]++; t[over]--; this.ensureDropSite(k, res); }
        return;
      }
    }
  }

  // Nearest static resource of a type with fewer than maxPer gatherers.
  pickStatic(type, cx, cy, radius, maxPer) {
    const w = this.w, map = w.map, on = this.mem.onTarget;
    let best = null, bd = Infinity;
    const r = Math.ceil(radius);
    const x0 = Math.max(0, Math.floor(cx) - r), x1 = Math.min(map.w - 1, Math.floor(cx) + r);
    const y0 = Math.max(0, Math.floor(cy) - r), y1 = Math.min(map.h - 1, Math.floor(cy) + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const id = map.block[y * map.w + x];
        if (!id) continue;
        const e = w.entities.get(id);
        if (!e || e.dead || e.kind !== 'resource' || e.type !== type) continue;
        if ((on.get(id) || 0) >= maxPer) continue;
        const d = dist(cx, cy, x + 0.5, y + 0.5);
        if (d <= radius && d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  pickAnimal(cx, cy, radius, types, maxPer) {
    const w = this.w, on = this.mem.onTarget;
    let best = null, bd = Infinity;
    w.grid.query(cx, cy, radius, (u) => {
      if (u.dead || u.owner !== GAIA || !types.includes(u.type)) return false;
      if ((on.get(u.id) || 0) >= maxPer) return false;
      const d = dist(cx, cy, u.x, u.y);
      if (d <= radius && d < bd) { bd = d; best = u; }
      return false;
    });
    // carcasses (not in the unit grid)
    for (const e of w.list) {
      if (e.dead || e.type !== 'carcass' || e.amount < 15) continue;
      if ((on.get(e.id) || 0) >= 5) continue;
      const d = dist(cx, cy, e.x, e.y) - 4; // prefer finishing carcasses
      if (d <= radius && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  findResource(kind, v) {
    const w = this.w, p = this.p, h = this.home;
    if (kind === 'food') {
      // berries -> gazelles -> elephants -> farms
      let r = this.pickStatic('berry_bush', h.x, h.y, 28, 3);
      if (r) return r;
      // an elephant hunt in progress? join the carcass
      for (const [id, n] of this.mem.onTarget) {
        const t = w.alive(id);
        if (t && t.type === 'carcass' && t.amount > 40 && n < 6) return t;
      }
      r = this.freeFarm();
      if (r) return r;
      r = this.pickAnimal(h.x, h.y, 28, ['gazelle'], 3);
      if (r) return r;
      this.wantFarm = true;
      if (p.age === 0) {
        r = this.pickStatic('berry_bush', h.x, h.y, 45, 4) || this.pickAnimal(h.x, h.y, 40, ['gazelle', 'elephant_wild'], 4);
        if (r) return r;
      }
      return null;
    }
    const type = kind === 'wood' ? 'tree' : kind === 'gold' ? 'gold_mine' : 'stone_mine';
    const maxPer = kind === 'wood' ? 2 : 3;
    // prefer resources near an existing drop site
    let best = null, bd = Infinity;
    for (const b of p.buildings) {
      if (!b.built || !b.stats.def.drop || !b.stats.def.drop.includes(kind)) continue;
      const r = this.pickStatic(type, b.x, b.y, 9, maxPer);
      if (r) { const d = dist(r.x, r.y, b.x, b.y) + dist(v.x, v.y, r.x, r.y) * 0.1; if (d < bd) { bd = d; best = r; } }
    }
    if (best && bd < 10) return best;
    return this.pickStatic(type, h.x, h.y, 40, maxPer) || best;
  }

  ensureDropSite(kind, res) {
    if (!res || res.kind === 'building') return;
    const p = this.p, w = this.w;
    const gk = res.type === 'berry_bush' ? 'forage' : (res.type === 'carcass' || res.kind === 'unit') ? 'hunt' : kind;
    const drop = w.findDropSite(p, gk, res.x, res.y);
    const d = drop ? distToRect(res.x, res.y, drop.tx, drop.ty, drop.tx + drop.size, drop.ty + drop.size) : 99;
    if (d < 7) return;
    const type = gk === 'forage' ? 'granary' : 'storage_pit';
    // don't spam drop sites
    const nv = this.mem.villagers.length;
    const maxN = type === 'storage_pit' ? 1 + Math.floor(nv / 9) : 1 + Math.floor(nv / 16);
    if (this.count(type) >= maxN) return;
    for (const b of p.buildings) if (!b.built && b.stats.def.drop && dist(b.x, b.y, res.x, res.y) < 10) return;
    const key = type + Math.floor(res.x / 10) + ',' + Math.floor(res.y / 10);
    if (this.lastDrop[key] && w.tick - this.lastDrop[key] < 900) return;
    if (p.res.wood < BUILDINGS[type].cost.wood) return;
    const spot = this.findSpot(type, res.x, res.y, 2, 6);
    if (spot) { this.lastDrop[key] = w.tick; this.buildWith(type, spot, 1); }
  }

  // Hunt wild elephants (300 food each) as a group of villagers — a lone hunter
  // would be trampled.
  elephantHunt() {
    const w = this.w, p = this.p, m = this.mem;
    if (m.villagers.length < 9 || p.age >= 2) return;
    for (const [id] of m.onTarget) {
      const t = w.alive(id);
      if (t && (t.type === 'elephant_wild' || (t.type === 'carcass' && t.animal === 'elephant_wild'))) return; // one hunt at a time
    }
    const el = this.pickAnimal(this.home.x, this.home.y, 22, ['elephant_wild'], 1);
    if (!el || el.type !== 'elephant_wild') return;
    const cands = m.villagers.filter((v) => !v.order || (v.order.type === 'gather' && (v.order.kind === 'wood' || v.order.kind === 'forage') && v.carry < 3));
    cands.sort((a, b) => dist(a.x, a.y, el.x, el.y) - dist(b.x, b.y, el.x, el.y) || a.id - b.id);
    const group = cands.slice(0, 5);
    if (group.length < 4) return;
    this.cmd({ type: 'gather', ids: group.map((v) => v.id), target: el.id });
    this.ensureDropSite('food', el);
  }

  // every ~15s: busy resource spots that are far from any drop site get one
  dropSiteCheck() {
    const w = this.w, p = this.p;
    let best = null, bestN = 1, bestKind = null;
    for (const [id, n] of this.mem.onTarget) {
      if (n < 2) continue;
      const t = w.alive(id);
      if (!t) continue;
      const kind = w.resKindOf(t);
      if (!kind || kind === 'farm') continue;
      const drop = w.findDropSite(p, kind, t.x, t.y);
      const d = drop ? distToRect(t.x, t.y, drop.tx, drop.ty, drop.tx + drop.size, drop.ty + drop.size) : 99;
      if (d > 6 && n > bestN) { best = t; bestN = n; bestKind = kind; }
    }
    if (best) this.ensureDropSite(kindGroup(bestKind), best);
  }

  wantedFarms() {
    const share = this.wantFarm || this.p.age >= 2 ? 0.9 : 0.5;
    return Math.round(this.mem.villagers.length * this.baseRatios().food * share);
  }

  // a farm nobody works (one farmer per farm)
  freeFarm() {
    const on = this.mem.onTarget, h = this.home;
    let best = null, bd = Infinity;
    for (const b of this.p.buildings) {
      if (b.type !== 'farm' || !b.built || (on.get(b.id) || 0) >= 1) continue;
      if (b.farmer && this.w.alive(b.farmer)) continue;
      const d = dist(h.x, h.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // farms (the list asks for some too): from the Tool Age for part of the
  // food gatherers, for all of them once the wild food runs out
  farms() {
    const p = this.p;
    if (!this.count('market', true) || (!this.wantFarm && p.age < 1)) return;
    const wantFarms = this.wantedFarms();
    this.wantFarm = false;
    const building = (this.mem.byType.farm || []).filter((f) => !f.built).length;
    if (this.count('farm') >= wantFarms || building >= 3) return;
    const cost = p.buildingStats('farm').cost;
    if (!this.afford(cost)) return;
    const spot = this.farmSpot();
    if (spot && this.buildWith('farm', spot, 1)) this.spend(cost);
  }
  // around the town centre first, then around granaries
  farmSpot() {
    const centers = [this.tc, ...(this.mem.byType.granary || []).filter((b) => b.built)].filter(Boolean);
    for (const c of centers) {
      const spot = this.findSpot('farm', c.x, c.y, 2, 7, true);
      if (spot) return spot;
    }
    return null;
  }

  buildWith(type, spot, n) {
    const vs = this.builders(spot.x, spot.y, n);
    if (!vs.length) return false;
    this.cmd({ type: 'build', btype: type, tx: spot.x, ty: spot.y, ids: vs.map((v) => v.id) });
    for (const v of vs) { const i = this.mem.idle.indexOf(v); if (i >= 0) this.mem.idle.splice(i, 1); }
    return true;
  }
  // the n villagers nearest to (x, y) among the idle ones and the wood and
  // forage gatherers, else among any gatherers
  builders(x, y, n) {
    const byDist = (a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id;
    let vs = this.mem.villagers.filter((v) => !v.order || (v.order.type === 'gather' && (v.order.kind === 'wood' || v.order.kind === 'forage')));
    if (!vs.length) vs = this.mem.villagers.filter((v) => v.order && v.order.type === 'gather');
    return vs.sort(byDist).slice(0, n);
  }

  // foundations nobody builds get a villager; one never started is given up
  foundations() {
    const building = new Set();
    for (const v of this.mem.villagers) if (v.order && (v.order.type === 'build' || v.order.type === 'repair')) building.add(v.order.target);
    this.tries = this.tries || new Map();
    for (const b of this.p.buildings) {
      if (b.built || building.has(b.id)) continue;
      const n = (this.tries.get(b.id) || 0) + 1;
      this.tries.set(b.id, n);
      if (n > 4 && b.progress < 0.01) { this.cmd({ type: 'delete', ids: [b.id] }); this.tries.delete(b.id); continue; }
      const [v] = this.builders(b.x, b.y, 1);
      if (v) this.cmd({ type: 'repair', target: b.id, ids: [v.id] });
    }
  }

  findSpot(type, cx, cy, rmin, rmax, tight = false) {
    const w = this.w, p = this.p;
    const size = BUILDINGS[type].size;
    const map = w.map;
    const ox = Math.round(cx - size / 2), oy = Math.round(cy - size / 2);
    for (let r = rmin; r <= rmax; r++) {
      for (let i = -r; i <= r; i++) {
        const cand = [[ox + i, oy - r], [ox + r, oy + i], [ox - i, oy + r], [ox - r, oy - i]];
        for (const [tx, ty] of cand) {
          if (w.placementError(p, type, tx, ty)) continue;
          if (this.encloses(tx, ty, size)) continue;
          if (!tight) {
            // keep a free ring around (don't wall ourselves in)
            let ok = true;
            for (let y = ty - 1; y <= ty + size && ok; y++) for (let x = tx - 1; x <= tx + size; x++) {
              if (!map.inBounds(x, y)) { ok = false; break; }
              const id = map.block[map.idx(x, y)];
              if (id) { const e = w.entities.get(id); if (e && e.kind === 'building') { ok = false; break; } }
            }
            if (!ok) continue;
          }
          return { x: tx, y: ty };
        }
      }
    }
    return null;
  }

  // Would a footprint at (tx, ty) cut some free tiles nearby off from the rest
  // (villagers walled in by tightly packed farms and houses)? Flood fill of
  // a window around it from the window's edge, with the footprint blocked.
  encloses(tx, ty, size) {
    const map = this.w.map, R = 7;
    const x0 = tx - R, y0 = ty - R, n = size + 2 * R;
    const free = (x, y) => map.passable(x, y) && !(x >= tx && x < tx + size && y >= ty && y < ty + size);
    const seen = new Uint8Array(n * n);
    const stack = [];
    for (let i = 0; i < n; i++) for (const [x, y] of [[x0 + i, y0], [x0 + i, y0 + n - 1], [x0, y0 + i], [x0 + n - 1, y0 + i]]) {
      const k = (y - y0) * n + (x - x0);
      if (!seen[k] && free(x, y)) { seen[k] = 1; stack.push(x, y); }
    }
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || ny < y0 || nx >= x0 + n || ny >= y0 + n) continue;
        const k = (ny - y0) * n + (nx - x0);
        if (!seen[k] && free(nx, ny)) { seen[k] = 1; stack.push(nx, ny); }
      }
    }
    // a free tile next to the footprint that the fill didn't reach is cut off
    for (let y = ty - 1; y <= ty + size; y++) for (let x = tx - 1; x <= tx + size; x++) {
      if (x >= tx && x < tx + size && y >= ty && y < ty + size) continue;
      if (free(x, y) && !seen[(y - y0) * n + (x - x0)]) return true;
    }
    return false;
  }

  // ------------------------------------------------------------- military
  military() {
    const w = this.w, m = this.mem;
    // defend the base
    const threat = this.findThreat();
    if (threat) {
      const idleArmy = m.military.filter((u) => !u.order || u.order.type !== 'attack');
      if (idleArmy.length) this.cmd({ type: 'amove', ids: idleArmy.map((u) => u.id), x: threat.x, y: threat.y });
      this.defending = true;
      return;
    }
    this.defending = false;
    // attack: after the strategy's first-attack delay, groups of at least
    // 2 units (one more every 4 minutes), at most 10
    const t = w.gameSeconds();
    if (t < this.firstAttack) return;
    const army = m.military.filter((u) => u.type !== 'priest');
    const minGroup = Math.min(ATTACK_GROUP.max, ATTACK_GROUP.min + Math.floor((t - this.firstAttack) / 240));
    if (this.attacking) {
      const target = w.alive(this.attackTarget);
      if (!army.length) { this.attacking = false; return; }
      if (!target) {
        const nt = this.pickTarget();
        if (nt) { this.attackTarget = nt.id; this.sendArmy(nt, army); } else this.attacking = false;
        return;
      }
      if (w.tick - this.lastAttackOrder > 150) {
        const idle = army.filter((u) => !u.order);
        if (idle.length >= minGroup) this.sendArmy(target, idle);
      }
      return;
    }
    const idle = army.filter((u) => !u.order || u.order.type === 'move');
    if (idle.length >= minGroup) {
      const target = this.pickTarget();
      if (target) { this.attacking = true; this.attackTarget = target.id; this.sendArmy(target, idle); }
    }
  }

  sendArmy(target, units) {
    const group = units.slice(0, ATTACK_GROUP.max);
    if (!group.length) return;
    this.lastAttackOrder = this.w.tick;
    this.cmd({ type: 'amove', ids: group.map((u) => u.id), x: target.x, y: target.y + (target.size || 0) / 2 + 1 });
  }

  pickTarget() {
    const w = this.w, h = this.home;
    let best = null, bd = Infinity;
    for (const q of w.realPlayers()) {
      if (!q.alive || !w.isEnemy(this.p.id, q.id)) continue;
      for (const b of q.buildings) {
        const d = dist(h.x, h.y, b.x, b.y) - (b.type === 'town_center' ? 15 : 0);
        if (d < bd) { bd = d; best = b; }
      }
      if (!best) for (const u of q.units) { const d = dist(h.x, h.y, u.x, u.y); if (d < bd) { bd = d; best = u; } }
    }
    return best;
  }

  findThreat() {
    const w = this.w, h = this.home;
    let best = null, bd = 18;
    w.grid.query(h.x, h.y, 18, (u) => {
      if (u.dead || u.owner === GAIA || !w.isEnemy(this.p.id, u.owner)) return false;
      if (u.type === 'villager' && w.settings.rules !== 'free') return false;
      const d = dist(h.x, h.y, u.x, u.y);
      if (d < bd) { bd = d; best = u; }
      return false;
    });
    return best;
  }
}

function kindGroup(k) { return k === 'forage' || k === 'hunt' || k === 'farm' ? 'food' : k; }
function findLine(u) {
  for (const b in UNIT_LINES) for (const line of UNIT_LINES[b]) if (line.includes(u)) return line;
  return null;
}
