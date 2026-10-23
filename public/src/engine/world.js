// The deterministic game simulation. Every client in a multiplayer game runs
// an identical World and feeds it the same commands at the same ticks
// (lockstep), so the whole game state never has to be sent over the network.
import { RNG, hashString } from './rng.js';
import { TICK_S, START_RESOURCES, GAIA } from './constants.js';
import { UNITS, isMilitary } from './data/units.js';
import { BUILDINGS } from './data/buildings.js';
import { TECHS } from './data/techs.js';
import { CIVS, STANDARD_CIVS } from './data/civs.js';
import { Player } from './player.js';
import { generateMap } from './mapgen.js';
import { Pathfinder } from './pathfind.js';
import { dist, distToRect } from './dmath.js';
import { updateUnit, separateUnits, setOrder } from './behavior.js';
import { initAnimal } from './animals.js';
import { updateProjectiles, killEntity } from './combat.js';
import { updateBuilding, applyTech, buildingTechDone, stopResearch } from './production.js';
import { handleCommand } from './commands.js';
import { AIController } from './ai.js';

export function normalizeSettings(s) {
  const players = (s.players || []).map((p, i) => ({
    id: p.id ?? i + 1,
    name: p.name || 'Người chơi ' + (i + 1),
    civ: p.civ || 'random',
    color: p.color ?? i,
    team: p.team || 0,
    ai: p.ai || null,
  }));
  return {
    seed: (s.seed >>> 0) || 1,
    mapType: s.mapType || 'hill_country',
    mapSize: s.mapSize || 'large',
    rules: s.rules || 'd3kt',
    popLimit: s.popLimit || 200,
    startRes: s.startRes || 'default',
    startAge: s.startAge || 0,
    speed: s.speed || 2.0,
    reveal: !!s.reveal,
    cheats: !!s.cheats,
    teamsTogether: s.teamsTogether !== false,
    lockTeams: s.lockTeams !== false,
    victory: s.victory || 'conquest',
    allowLacViet: !!s.allowLacViet,
    players,
  };
}

// Resolve "random" civilizations deterministically from the seed.
export function resolveCivs(settings) {
  const rng = new RNG((settings.seed * 7919 + 13) >>> 0);
  const pool = settings.allowLacViet ? [...STANDARD_CIVS, 'lac_viet'] : STANDARD_CIVS;
  for (const p of settings.players) {
    if (!p.civ || p.civ === 'random' || !CIVS[p.civ]) p.civ = pool[rng.int(pool.length)];
  }
  return settings;
}

class SpatialGrid {
  constructor(w, h, cell) {
    this.cell = cell;
    this.cw = Math.ceil(w / cell);
    this.ch = Math.ceil(h / cell);
    this.cells = Array.from({ length: this.cw * this.ch }, () => []);
  }
  clear() { for (const c of this.cells) c.length = 0; }
  insert(e) {
    const cx = Math.min(this.cw - 1, Math.max(0, Math.floor(e.x / this.cell)));
    const cy = Math.min(this.ch - 1, Math.max(0, Math.floor(e.y / this.cell)));
    this.cells[cy * this.cw + cx].push(e);
  }
  // calls fn(e) for units whose cell intersects the circle; fn may return true to stop
  query(x, y, r, fn) {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(this.cw - 1, Math.floor((x + r) / c));
    const y0 = Math.max(0, Math.floor((y - r) / c)), y1 = Math.min(this.ch - 1, Math.floor((y + r) / c));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.cells[cy * this.cw + cx];
        for (let i = 0; i < arr.length; i++) if (fn(arr[i])) return;
      }
    }
  }
}

export class World {
  constructor(rawSettings) {
    this.settings = resolveCivs(normalizeSettings(rawSettings));
    const S = this.settings;
    this.rng = new RNG(S.seed);
    this.tick = 0;
    this.entities = new Map();
    this.list = [];
    this.nextId = 1;
    this.projectiles = [];
    this.events = [];
    this.pathQueue = [];
    this.carcassOf = new Map();
    this.over = false;
    this.winners = null;
    this.paused = false;

    const gen = generateMap(S);
    this.map = gen.map;
    this.starts = gen.starts;
    this.pf = new Pathfinder(this.map);
    this.grid = new SpatialGrid(this.map.w, this.map.h, 2);

    this.players = [new Player({ id: GAIA, civ: 'greek' })];
    for (const pc of S.players) {
      const p = new Player(pc);
      const sr = START_RESOURCES[S.startRes] || START_RESOURCES.default;
      p.res = { food: sr.food, wood: sr.wood, gold: sr.gold, stone: sr.stone };
      this.players[p.id] = p;
    }
    for (let i = 0; i < this.players.length; i++) if (!this.players[i]) this.players[i] = null;

    for (const o of gen.objects) {
      if (o.kind === 'resource') {
        if (this.map.block[this.map.idx(o.tx, o.ty)]) continue;
        const r = this.spawnResource(o.type, o.tx, o.ty, o.amount, o.variant, o.straggler);
        if (o.dat) r.dat = o.dat;
        if (o.ox || o.oy) { r.ox = o.ox; r.oy = o.oy; }
      } else if (o.kind === 'building') this.spawnBuilding(o.type, o.owner, o.tx, o.ty, o.built);
      else if (o.kind === 'unit') this.spawnUnit(o.type, o.owner, o.x, o.y);
      else if (o.kind === 'cliff') this.spawnCliff(o);
    }
    // starting age
    for (const p of this.realPlayers()) {
      const ages = ['tool_age', 'bronze_age', 'iron_age'];
      for (let a = 0; a < S.startAge && a < 3; a++) applyTech(this, p, ages[a], true);
    }
    this.ai = [];
    for (const p of this.realPlayers()) if (p.ai) this.ai.push(new AIController(this, p, p.ai));
    this.recomputePop();
  }

  // ------------------------------------------------------------- helpers
  realPlayers() { return this.players.filter((p) => p && p.id !== GAIA); }
  get(id) { return this.entities.get(id); }
  alive(id) { const e = this.entities.get(id); return e && !e.dead ? e : null; }
  emit(ev) { this.events.push(ev); }
  msg(p, text, color) { this.events.push({ t: 'msg', p, text, color }); }

  isAlly(a, b) {
    if (a === b) return true;
    if (a === GAIA || b === GAIA) return false;
    const pa = this.players[a], pb = this.players[b];
    return !!(pa && pb && pa.team > 0 && pa.team === pb.team);
  }
  isEnemy(a, b) { return a !== GAIA && b !== GAIA && !this.isAlly(a, b); }

  addEntity(e) {
    e.id = this.nextId++;
    e.dead = false;
    this.entities.set(e.id, e);
    this.list.push(e);
    return e;
  }

  spawnUnit(type, owner, x, y) {
    const p = this.players[owner];
    const stats = p.unitStats(type);
    const e = this.addEntity({
      kind: 'unit', type, owner, x, y, px: x, py: y, hp: stats.hp, stats,
      fx: 0.7, fy: 0.7, order: null, path: null, pathI: 0, pathWait: false, goal: null,
      cd: 0, swing: -1, target: 0, carry: 0, carryKind: null, task: null,
      faith: 100, chant: 0, chantT: 0, anim: 'idle', animT: this.tick, lastAtkBy: 0, lastAtkTick: -9999,
      stuck: 0, lastX: x, lastY: y, repath: 0, run: false, moved: false,
    });
    if (stats.def.animal) initAnimal(this, e);
    p.units.add(e);
    if (owner !== GAIA) {
      p.pop += stats.pop;
      if (type === 'villager') {
        let v = 0; for (const u of p.units) if (u.type === 'villager') v++;
        if (v > p.stats.villagerHigh) p.stats.villagerHigh = v;
      }
    }
    return e;
  }

  spawnBuilding(type, owner, tx, ty, built) {
    const p = this.players[owner];
    const stats = p.buildingStats(type);
    const def = BUILDINGS[type];
    const size = def.size;
    const e = this.addEntity({
      kind: 'building', type, owner, tx, ty, size, x: tx + size / 2, y: ty + size / 2,
      hp: built ? stats.hp : 1, stats, built: !!built, progress: built ? 1 : 0, builders: 0, buildersPrev: 0,
      queue: [], training: false, trainT: 0, trainPop: 0, research: null, rally: null,
      food: 0, farmer: 0, cd: 0, target: 0, lastAtkTick: -9999, popBlocked: false,
    });
    if (type === 'farm') e.food = p.farmFood;
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) this.map.block[this.map.idx(x, y)] = e.id;
    p.buildings.add(e);
    if (built) this.onBuildingComplete(e, true);
    return e;
  }

  spawnResource(type, tx, ty, amount, variant = 0, straggler = false) {
    const e = this.addEntity({
      kind: 'resource', type, owner: GAIA, tx, ty, x: tx + 0.5, y: ty + 0.5, amount, maxAmount: amount,
      variant, straggler, felled: false, size: 1,
    });
    this.map.block[this.map.idx(tx, ty)] = e.id;
    return e;
  }

  // a piece of a random map cliff: a gaia obstacle covering its footprint
  spawnCliff(o) {
    const e = this.addEntity({
      kind: 'cliff', owner: GAIA, unit: o.unit, facet: o.facet, x: o.x, y: o.y, rx: o.rx, ry: o.ry, size: 0,
      tx: Math.floor(o.x), ty: Math.floor(o.y),
    });
    const m = this.map;
    for (let ty = Math.floor(o.y - o.ry + 0.01); ty < Math.ceil(o.y + o.ry - 0.01); ty++) {
      for (let tx = Math.floor(o.x - o.rx + 0.01); tx < Math.ceil(o.x + o.rx - 0.01); tx++) {
        if (m.inBounds(tx, ty) && !m.block[m.idx(tx, ty)]) m.block[m.idx(tx, ty)] = e.id;
      }
    }
    return e;
  }

  spawnCarcass(animal, x, y, food, decay) {
    return this.addEntity({
      kind: 'resource', type: 'carcass', animal, owner: GAIA, x, y, tx: Math.floor(x), ty: Math.floor(y),
      amount: food, maxAmount: food, decay, size: 0, felled: true,
    });
  }

  onBuildingComplete(b, silent) {
    const p = this.players[b.owner];
    b.built = true;
    b.progress = 1;
    if (b.hp < b.stats.hp && silent) b.hp = b.stats.hp;
    if (b.type === 'farm') b.food = p.farmFood;
    buildingTechDone(this, p, b);
    this.recomputePop(p);
    if (!silent) this.emit({ t: 'built', p: b.owner, id: b.id, type: b.type, x: b.x, y: b.y });
  }

  recomputePop(only) {
    for (const p of only ? [only] : this.realPlayers()) {
      let cap = 0;
      for (const b of p.buildings) if (b.built) cap += b.stats.pop;
      p.popCap = Math.min(cap, this.settings.popLimit);
    }
  }

  removeBlock(e) {
    if (e.kind === 'building') {
      for (let y = e.ty; y < e.ty + e.size; y++) for (let x = e.tx; x < e.tx + e.size; x++) {
        const i = this.map.idx(x, y);
        if (this.map.block[i] === e.id) this.map.block[i] = 0;
      }
    } else if (e.kind === 'resource' && e.size === 1) {
      const i = this.map.idx(e.tx, e.ty);
      if (this.map.block[i] === e.id) this.map.block[i] = 0;
    }
  }

  // Changes the owner of a unit or building (priest conversion).
  changeOwner(e, newOwner) {
    const old = this.players[e.owner], np = this.players[newOwner];
    if (e.kind === 'unit') {
      old.units.delete(e); old.pop -= e.stats.pop;
      const ratio = e.hp / e.stats.hp;
      e.owner = newOwner;
      e.stats = np.unitStats(e.type);
      e.hp = Math.max(1, ratio * e.stats.hp);
      np.units.add(e); np.pop += e.stats.pop;
      e.order = null; e.path = null; e.target = 0; e.carry = 0; e.carryKind = null; e.swing = -1;
    } else if (e.kind === 'building') {
      old.buildings.delete(e);
      if (e.training) old.training -= e.trainPop;
      if (e.research) stopResearch(old, e);
      e.queue = []; e.training = false;
      const ratio = e.hp / e.stats.hp;
      e.owner = newOwner;
      e.stats = np.buildingStats(e.type);
      e.hp = Math.max(1, ratio * e.stats.hp);
      np.buildings.add(e);
      this.recomputePop(old); this.recomputePop(np);
    }
  }

  stopResearch(p, b) { stopResearch(p, b); }

  // Refresh stats of all entities of a player after a tech / age change.
  refreshStats(p) {
    p.invalidate();
    for (const u of p.units) {
      const ns = p.unitStats(u.type);
      if (ns.hp > u.stats.hp) u.hp += ns.hp - u.stats.hp;
      u.stats = ns;
      if (u.hp > ns.hp) u.hp = ns.hp;
    }
    for (const b of p.buildings) {
      const ns = p.buildingStats(b.type);
      if (ns.hp > b.stats.hp && b.built) b.hp += ns.hp - b.stats.hp;
      b.stats = ns;
      if (b.hp > ns.hp) b.hp = ns.hp;
    }
    this.recomputePop(p);
  }

  // Distance from the edge of unit e to the nearest point of target t.
  edgeDist(e, t) {
    const er = e.kind === 'unit' ? e.stats.radius : 0;
    let d;
    if (t.kind === 'unit') d = dist(e.x, e.y, t.x, t.y) - t.stats.radius;
    else if (t.kind === 'resource' && t.size === 0) d = dist(e.x, e.y, t.x, t.y) - 0.3;
    else {
      const s = t.size || 1;
      d = distToRect(e.x, e.y, t.tx, t.ty, t.tx + s, t.ty + s);
    }
    return Math.max(0, d - er);
  }

  // Path goal (tile rect) for reaching a target entity or a point.
  goalFor(t) {
    if (t.kind === 'building' || (t.kind === 'resource' && t.size === 1)) {
      const s = t.size || 1;
      return { x0: t.tx, y0: t.ty, x1: t.tx + s - 1, y1: t.ty + s - 1, adjacent: true };
    }
    const x = Math.floor(t.x), y = Math.floor(t.y);
    const free = this.map.passable(x, y);
    return { x0: x, y0: y, x1: x, y1: y, adjacent: !free, px: t.x, py: t.y };
  }

  // Nearest finished drop site of player p for a resource kind.
  findDropSite(p, kind, x, y) {
    const res = kind === 'hunt' ? 'meat' : (kind === 'forage' || kind === 'farm') ? 'food' : kind;
    let best = null, bd = Infinity;
    for (const b of p.buildings) {
      if (!b.built || !b.stats.def.drop || !b.stats.def.drop.includes(res)) continue;
      const d = distToRect(x, y, b.tx, b.ty, b.tx + b.size, b.ty + b.size);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  resKindOf(t) {
    if (!t) return null;
    if (t.kind === 'resource') {
      switch (t.type) {
        case 'tree': return 'wood';
        case 'berry_bush': return 'forage';
        case 'gold_mine': return 'gold';
        case 'stone_mine': return 'stone';
        case 'carcass': return 'hunt';
      }
    } else if (t.kind === 'building' && t.type === 'farm') return 'farm';
    else if (t.kind === 'unit' && t.owner === GAIA && UNITS[t.type].food) return 'hunt';
    return null;
  }

  // Nearest resource entity of the same gather kind around (x, y).
  findNearbyResource(kind, x, y, radius, owner, exclude) {
    let best = null, bd = Infinity;
    const r = radius;
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(this.map.w - 1, Math.floor(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(this.map.h - 1, Math.floor(y + r));
    if (kind === 'hunt') {
      for (const e of this.list) {
        if (e.dead || e === exclude) continue;
        if (!((e.kind === 'resource' && e.type === 'carcass') || (e.kind === 'unit' && e.owner === GAIA && UNITS[e.type].food && e.type === 'gazelle'))) continue;
        const d = dist(x, y, e.x, e.y);
        if (d < r && d < bd) { bd = d; best = e; }
      }
      return best;
    }
    if (kind === 'farm') {
      const p = this.players[owner];
      for (const b of p.buildings) {
        if (b.type !== 'farm' || !b.built || b === exclude) continue;
        if (b.farmer && this.alive(b.farmer)) continue;
        const d = dist(x, y, b.x, b.y);
        if (d < r && d < bd) { bd = d; best = b; }
      }
      return best;
    }
    const want = kind === 'wood' ? 'tree' : kind === 'forage' ? 'berry_bush' : kind === 'gold' ? 'gold_mine' : 'stone_mine';
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const id = this.map.block[ty * this.map.w + tx];
        if (!id) continue;
        const e = this.entities.get(id);
        if (!e || e.dead || e.kind !== 'resource' || e.type !== want || e === exclude) continue;
        const d = dist(x, y, tx + 0.5, ty + 0.5);
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  // Can player p place a building of type at (tx, ty)? Returns null or a reason.
  placementError(p, type, tx, ty) {
    const def = BUILDINGS[type];
    const size = def.size;
    const map = this.map;
    if (tx < 0 || ty < 0 || tx + size > map.w || ty + size > map.h) return 'Ngoài bản đồ';
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) {
      const i = map.idx(x, y);
      if (map.block[i] !== 0) return 'Vướng vật cản';
      if (!map.terrainPassable(x, y)) return 'Địa hình không hợp lệ';
    }
    if (def.water) return 'Cần xây cạnh nước';
    const slope = map.footprintSlope(tx, ty, size);
    if (size >= 3 && slope > 1) return 'Địa hình quá dốc';
    if (slope > 2) return 'Địa hình quá dốc';
    // units of other players standing on the footprint block placement
    let blocked = false;
    this.grid.query(tx + size / 2, ty + size / 2, size, (u) => {
      if (u.dead || u.owner === p.id) return false;
      if (u.x > tx - 0.1 && u.x < tx + size + 0.1 && u.y > ty - 0.1 && u.y < ty + size + 0.1) { blocked = true; return true; }
      return false;
    });
    if (blocked) return 'Có quân đứng trên vị trí';
    return null;
  }

  // Free passable tile adjacent to a footprint, preferring the side nearest (px,py).
  spawnPointNear(b, px, py) {
    const s = b.size, map = this.map;
    let best = null, bd = Infinity;
    for (let ring = 0; ring < 4; ring++) {
      const x0 = b.tx - 1 - ring, y0 = b.ty - 1 - ring, x1 = b.tx + s + ring, y1 = b.ty + s + ring;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (x > x0 && x < x1 && y > y0 && y < y1) continue;
          if (!map.passable(x, y)) continue;
          const d = dist(x + 0.5, y + 0.5, px, py);
          if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
        }
      }
      if (best) return best;
    }
    return { x: b.x, y: b.ty + s + 0.5 };
  }

  requestPath(e, goal, allowId = 0) {
    // a unit standing inside a footprint (farmer in its field) may walk out of it
    if (!allowId) {
      const sb = this.map.block[this.map.idx(Math.floor(e.x), Math.floor(e.y))];
      if (sb) allowId = sb;
    }
    e.goal = goal;
    e.goalAllow = allowId;
    e.path = null;
    e.pathI = 0;
    // fast path: straight line to the goal point
    const gp = this.goalPoint(e, goal);
    if (dist(e.x, e.y, gp.x, gp.y) < 0.05) { e.path = []; e.pathWait = false; return; }
    if (this.pf.lineWalkable(e.x, e.y, gp.x, gp.y, allowId) && this.map.passable(Math.floor(gp.x), Math.floor(gp.y)) || (allowId && this.pf.lineWalkable(e.x, e.y, gp.x, gp.y, allowId))) {
      e.path = [gp]; e.pathWait = false; return;
    }
    if (!e.pathWait) { e.pathWait = true; this.pathQueue.push(e.id); }
  }

  // Concrete point to walk to for a goal (closest point next to a rect target).
  goalPoint(e, goal) {
    if (!goal.adjacent && goal.px !== undefined) return { x: goal.px, y: goal.py };
    if (!goal.adjacent) return { x: (goal.x0 + goal.x1 + 1) / 2, y: (goal.y0 + goal.y1 + 1) / 2 };
    const r = (e.stats ? e.stats.radius : 0.2) + 0.12;
    const x0 = goal.x0, y0 = goal.y0, x1 = goal.x1 + 1, y1 = goal.y1 + 1;
    let x = Math.min(Math.max(e.x, x0), x1), y = Math.min(Math.max(e.y, y0), y1);
    // push outwards from the rectangle
    const inside = e.x > x0 && e.x < x1 && e.y > y0 && e.y < y1;
    if (inside) {
      const dl = e.x - x0, dr = x1 - e.x, dt = e.y - y0, db = y1 - e.y;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) x = x0 - r; else if (m === dr) x = x1 + r; else if (m === dt) y = y0 - r; else y = y1 + r;
    } else {
      if (e.x <= x0) x = x0 - r; else if (e.x >= x1) x = x1 + r;
      if (e.y <= y0) y = y0 - r; else if (e.y >= y1) y = y1 + r;
    }
    return { x, y };
  }

  processPathQueue() {
    const pf = this.pf;
    pf.expansions = 0;
    let processed = 0;
    while (this.pathQueue.length && processed < 40 && pf.expansions < 60000) {
      const id = this.pathQueue.shift();
      const e = this.entities.get(id);
      if (!e || e.dead || !e.pathWait || !e.goal) continue;
      e.pathWait = false;
      processed++;
      const g = e.goal;
      const res = pf.find(Math.floor(e.x), Math.floor(e.y), g, 7000, e.goalAllow || 0);
      let pts = res.path;
      if (res.reached) {
        const gp = this.goalPoint(e, g);
        if (pts.length) pts[pts.length - 1] = this.pf.lineWalkable(pts[pts.length - 1].x, pts[pts.length - 1].y, gp.x, gp.y, e.goalAllow || 0) ? gp : pts[pts.length - 1];
        else pts = [gp];
      }
      e.path = pf.smooth(e.x, e.y, pts, e.goalAllow || 0);
      e.pathI = 0;
      e.pathFail = !res.reached;
    }
  }

  // ------------------------------------------------------------ commands
  applyCommand(pid, cmd) {
    const p = this.players[pid];
    if (!p || !cmd || this.over) return;
    try {
      handleCommand(this, p, cmd);
    } catch (err) {
      // a malformed command must never break the simulation
      if (typeof console !== 'undefined') console.warn('Command error', cmd, err);
    }
  }

  // ---------------------------------------------------------------- tick
  step() {
    this.events = [];
    this.tick++;
    const dt = TICK_S;
    for (const ai of this.ai) ai.update();

    // spatial grid
    this.grid.clear();
    for (const e of this.list) {
      if (e.dead) continue;
      if (e.kind === 'unit') {
        e.px = e.x; e.py = e.y; e.moved = false;
        this.grid.insert(e);
      } else if (e.kind === 'building' && !e.built) {
        e.buildersPrev = e.builders; e.builders = 0;
      }
    }
    if (this.tick % 600 === 0 && this.carcassOf.size > 200) this.carcassOf.clear();
    this.processPathQueue();

    // units, buildings
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const e = this.list[i];
      if (e.dead) continue;
      if (e.kind === 'unit') updateUnit(this, e, dt);
      else if (e.kind === 'building') updateBuilding(this, e, dt);
      else if (e.type === 'carcass') {
        e.amount -= e.decay * dt;
        if (e.amount <= 0) killEntity(this, e, null);
      }
    }
    separateUnits(this);
    updateProjectiles(this, dt);

    // compact
    if (this.dirty) {
      this.dirty = false;
      const keep = [];
      for (const e of this.list) {
        if (e.dead) this.entities.delete(e.id); else keep.push(e);
      }
      this.list = keep;
    }
    if (this.tick % 10 === 0) this.checkVictory();
  }

  checkVictory() {
    if (this.over) return;
    const ps = this.realPlayers();
    for (const p of ps) {
      if (!p.alive) continue;
      let any = p.units.size > 0;
      if (!any) for (const b of p.buildings) if (!b.stats.def.wall) { any = true; break; }
      if (!any || p.resigned) {
        p.alive = false;
        p.defeatedTick = this.tick;
        this.emit({ t: 'defeat', p: p.id });
        this.msg(-1, `${p.name} đã bị loại!`, p.color.hex);
      }
    }
    const alive = ps.filter((p) => p.alive);
    if (alive.length === 0) { this.over = true; this.winners = []; this.emit({ t: 'gameover', winners: [] }); return; }
    const first = alive[0];
    if (alive.every((p) => this.isAlly(p.id, first.id)) && ps.length > 1) {
      this.over = true;
      this.winners = alive.map((p) => p.id);
      for (const p of ps) if (this.winners.includes(p.id)) p.won = true;
      this.emit({ t: 'gameover', winners: this.winners });
    } else if (ps.length === 1 && !first.alive) {
      this.over = true; this.winners = [];
    }
  }

  // Deterministic checksum of the relevant game state (desync detection).
  hash() {
    let h = 0x811c9dc5 ^ this.tick;
    const mix = (v) => { h ^= v | 0; h = Math.imul(h, 0x01000193); };
    for (const e of this.list) {
      if (e.dead) continue;
      mix(e.id); mix(e.owner);
      mix(Math.round(e.x * 64)); mix(Math.round(e.y * 64));
      mix(Math.round((e.hp || 0) * 16));
      if (e.amount !== undefined) mix(Math.round(e.amount * 16));
    }
    for (const p of this.realPlayers()) {
      mix(Math.round(p.res.food)); mix(Math.round(p.res.wood)); mix(Math.round(p.res.gold)); mix(Math.round(p.res.stone));
      mix(p.age); mix(p.techOrder.length);
      for (let i = 0; i < p.state.length; i++) mix(p.state[i]);
    }
    mix(this.rng.a);
    return h >>> 0;
  }

  gameSeconds() { return this.tick * TICK_S; }

  // Count of military units (alive + queued) — used by the D3KT rule.
  militaryCount(p) {
    let n = 0;
    for (const u of p.units) if (isMilitary(UNITS[u.type])) n++;
    for (const b of p.buildings) {
      for (const q of b.queue) if (isMilitary(UNITS[q.type])) n += q.n;
    }
    return n;
  }
}

export { hashString, setOrder };
