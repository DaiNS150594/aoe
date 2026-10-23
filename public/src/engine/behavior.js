// Unit behaviours: movement, gathering, building, combat orders, priests,
// animals and unit separation. Deterministic (uses world.rng only).
import { GAIA } from './constants.js';
import { UNITS, originalStats } from './data/units.js';
import { TASK_DAT } from './data/ids.js';
import { dist } from './dmath.js';
import { performAttack, spawnProjectile, killEntity } from './combat.js';
import { ruleAttackError } from './rules.js';
import { updateAnimal, chaseCheck, attackFailed } from './animals.js';

export const CONTACT = 0.3;
const TASK = { forage: 'forager', hunt: 'hunter', farm: 'farmer', wood: 'woodcutter', gold: 'goldminer', stone: 'stoneminer' };
export const CARRY_RES = { forage: 'food', hunt: 'food', farm: 'food', wood: 'wood', gold: 'gold', stone: 'stone' };
// Priests (convert action 004B3A20, heal action 004B4410 of empires.exe): a
// conversion is tried every 3 s of chanting (work 2 of the convert task) and
// succeeds with chance 0.3 (work 1) x the priest's work rate, divided by the
// target's resistance; healing restores work 1 (3 hp/s) x Medicine.
const PRIEST = 125;
const CHANT_SOUND = 1.5; // the chant is heard every 1.5 s while trying
// resistance to conversion: the Macedonian bonus (x4) replaces the class one;
// chariots x8, priests and boats x2
export function conversionResist(world, t) {
  const owner = world.players[t.owner];
  if (owner && owner.civ && owner.civ.convResist > 1) return owner.civ.convResist;
  const cls = t.kind === 'unit' ? t.stats.def.datClass : 3;
  if (cls === 23 || cls === 35) return 8;
  if (cls === 18 || cls === 2 || cls === 20 || cls === 21 || cls === 22) return 2;
  return 1;
}

// The hunter's spear: the original "Hunter" job unit (range 4, 80% accuracy).
function hunterStats(p) {
  let s = p.statCache.get('#hunter');
  if (s) return s;
  const m = p.task(TASK_DAT.hunter);
  s = { ...originalStats(m), def: { dat: TASK_DAT.hunter, datClass: m.cls } };
  const pm = p.masters.get(m.proj);
  s.proj = { kind: 'spear', speed: pm ? pm.speed : 6, arc: pm ? pm.arc : 0.1, smart: false };
  p.statCache.set('#hunter', s);
  return s;
}

export function setOrder(world, e, order) {
  e.order = order;
  e.path = null; e.pathWait = false; e.goal = null; e.pathI = 0;
  e.swing = -1; e.chant = 0; e.chantT = 0; e.fails = 0; e.stuck = 0; e.fell = 0;
  if (order && order.type === 'gather') e.gphase = e.gphase === 'drop' && e.carry > 0 && order.keepDrop ? 'drop' : 'go';
  if (!order) e.run = false;
}
function endOrder(world, e) {
  const resume = e.order && e.order.resume;
  setOrder(world, e, resume || null);
}
export function setAnim(world, e, anim, restart) {
  if (e.anim !== anim || restart) { e.anim = anim; e.animT = world.tick; }
}
function face(e, t) {
  const dx = t.x - e.x, dy = t.y - e.y;
  if (dx * dx + dy * dy > 1e-6) { e.fx = dx; e.fy = dy; }
}
const isVillager = (e) => e.type === 'villager';
const isPriest = (e) => e.type === 'priest';

// --------------------------------------------------------------- movement
// (running units — gazelles fleeing, lions chasing — use their running
// sprite's speed multiplier)
function followPath(world, e, dt, speedMul = e.run ? e.stats.runMul : 1) {
  if (e.pathWait) { setAnim(world, e, 'idle'); return false; }
  if (!e.path) return true;
  let budget = e.stats.speed * speedMul * dt;
  const map = world.map;
  const allow = e.goalAllow || 0;
  while (budget > 1e-9 && e.pathI < e.path.length) {
    const wp = e.path[e.pathI];
    const dx = wp.x - e.x, dy = wp.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) { e.pathI++; continue; }
    e.fx = dx; e.fy = dy;
    const step = d <= budget ? d : budget;
    const nx = e.x + (dx / d) * step, ny = e.y + (dy / d) * step;
    const ti = map.idx(Math.floor(nx), Math.floor(ny));
    const blk = map.block[ti];
    if ((blk !== 0 && blk !== allow) || !map.terrainPassable(Math.floor(nx), Math.floor(ny))) {
      // something was built in the way: stop and ask for a new path
      const curBlk = map.block[map.idx(Math.floor(e.x), Math.floor(e.y))];
      if (curBlk === 0 || curBlk === allow) {
        e.path = null;
        return true;
      }
    }
    e.x = nx; e.y = ny;
    budget -= step;
    if (d <= step + 1e-9) e.pathI++;
  }
  e.moved = true;
  setAnim(world, e, e.run ? 'run' : 'walk');
  return e.pathI >= e.path.length;
}

// Walk until within `reach` of target t. Returns 1 in reach, 0 walking, -1 unreachable.
function approach(world, e, t, reach, dt, customGoal = null, allowId = 0) {
  const d = world.edgeDist(e, t);
  if (d <= reach && !customGoal) { e.path = null; e.pathWait = false; e.fails = 0; return 1; }
  if (customGoal) {
    const inside = e.x >= customGoal.x0 && e.x <= customGoal.x1 + 1 && e.y >= customGoal.y0 && e.y <= customGoal.y1 + 1;
    if (inside && (!e.path || e.pathI >= e.path.length)) { e.path = null; e.pathWait = false; e.fails = 0; return 1; }
  }
  if (t.kind === 'unit' && d < 4 && world.pf.lineWalkable(e.x, e.y, t.x, t.y, allowId)) {
    e.path = [{ x: t.x, y: t.y }]; e.pathI = 0; e.pathWait = false; e.goal = null;
  } else if ((!e.path && !e.pathWait) ||
    (t.kind === 'unit' && !e.pathWait && e.goal && e.goal.px !== undefined && dist(e.goal.px, e.goal.py, t.x, t.y) > 1.5)) {
    world.requestPath(e, customGoal || world.goalFor(t), allowId);
  }
  const done = followPath(world, e, dt);
  if (done && !e.pathWait) {
    e.path = null;
    if (++e.fails > 8) { e.fails = 0; return -1; }
  }
  stuckCheck(world, e);
  return 0;
}

function stuckCheck(world, e) {
  if (!e.moved) return;
  const moved = Math.abs(e.x - e.lastX) + Math.abs(e.y - e.lastY);
  if (moved < 0.01) {
    if (++e.stuck > 12) { e.stuck = 0; e.path = null; e.pathWait = false; }
  } else e.stuck = 0;
  e.lastX = e.x; e.lastY = e.y;
}

// ------------------------------------------------------------- dispatcher
export function updateUnit(world, e, dt) {
  if (e.cd > 0) e.cd -= dt;
  if (e.ai) updateAnimal(world, e, dt);
  if (isPriest(e) && e.faith < 100) {
    const p = world.players[e.owner];
    e.faith = Math.min(100, e.faith + p.faithRecharge * dt);
  }
  const o = e.order;
  if (!o) { idle(world, e); return; }
  switch (o.type) {
    case 'move': doMove(world, e, dt); break;
    case 'amove': doAMove(world, e, dt); break;
    case 'attack': doAttack(world, e, dt); break;
    case 'gather': doGather(world, e, dt); break;
    case 'build': doBuild(world, e, dt, false); break;
    case 'repair': doBuild(world, e, dt, true); break;
    case 'convert': doConvert(world, e, dt); break;
    case 'heal': doHeal(world, e, dt); break;
    default: e.order = null;
  }
}

function doMove(world, e, dt) {
  const o = e.order;
  if (!e.path && !e.pathWait) {
    if (o.started) {
      // path ended (or was invalidated): close enough?
      if (dist(e.x, e.y, o.x, o.y) < 0.45 || ++e.fails > 3) { endOrder(world, e); setAnim(world, e, 'idle'); return; }
    }
    o.started = true;
    const tx = Math.floor(o.x), ty = Math.floor(o.y);
    const free = world.map.passable(tx, ty);
    world.requestPath(e, { x0: tx, y0: ty, x1: tx, y1: ty, adjacent: !free, px: o.x, py: o.y });
  }
  const done = followPath(world, e, dt);
  stuckCheck(world, e);
  if (done && !e.pathWait) {
    e.path = null;
    if (dist(e.x, e.y, o.x, o.y) < 0.45 || e.pathFail || e.fails > 2) { endOrder(world, e); setAnim(world, e, 'idle'); }
  }
}

// attack-move: walk, fighting anything hostile seen on the way
function doAMove(world, e, dt) {
  const o = e.order;
  if ((world.tick + e.id) % 4 === 0 && e.stats.hasAtk) {
    const t = findTarget(world, e, e.stats.los);
    if (t) { setOrder(world, e, { type: 'attack', target: t.id, auto: true, resume: { type: 'amove', x: o.x, y: o.y } }); return; }
  }
  doMove(world, e, dt);
}

// ------------------------------------------------------------------- idle
function idle(world, e) {
  setAnim(world, e, 'idle');
  if (e.owner === GAIA) return;
  if (isPriest(e)) {
    if ((world.tick + e.id) % 10 === 0) {
      const t = findHealTarget(world, e, e.stats.los);
      if (t) setOrder(world, e, { type: 'heal', target: t.id, auto: true });
    }
    return;
  }
  if (isVillager(e) || !e.stats.hasAtk) return;
  if ((world.tick + e.id) % 4 !== 0) return;
  // idle soldiers go for enemies in sight, human or computer (base unit AI
  // 00411190: twice the sight is only a bound on what the sight scan found;
  // the Easy / Easiest cut applies to single player scenarios)
  const t = findTarget(world, e, e.stats.los);
  if (t) setOrder(world, e, { type: 'attack', target: t.id, auto: true });
}

// Nearest hostile unit (then building) inside radius.
export function findTarget(world, e, radius) {
  let best = null, bd = Infinity;
  const own = e.owner;
  world.grid.query(e.x, e.y, radius + 1, (u) => {
    if (u.dead || u.owner === GAIA || !world.isEnemy(own, u.owner)) return false;
    const d = dist(e.x, e.y, u.x, u.y) - u.stats.radius;
    if (d > radius || d >= bd) return false;
    if (ruleAttackError(world, e, u)) return false;
    bd = d; best = u;
    return false;
  });
  if (best) return best;
  // buildings: scan block grid around
  const map = world.map;
  const r = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(e.x) - r), x1 = Math.min(map.w - 1, Math.floor(e.x) + r);
  const y0 = Math.max(0, Math.floor(e.y) - r), y1 = Math.min(map.h - 1, Math.floor(e.y) + r);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const id = map.block[y * map.w + x];
      if (!id) continue;
      const b = world.entities.get(id);
      if (!b || b.dead || b.kind !== 'building' || !world.isEnemy(own, b.owner)) continue;
      const d = world.edgeDist(e, b);
      if (d <= radius && d < bd && !ruleAttackError(world, e, b)) { bd = d; best = b; }
    }
  }
  return best;
}

function findHealTarget(world, e, radius) {
  let best = null, bd = Infinity;
  world.grid.query(e.x, e.y, radius + 1, (u) => {
    if (u.dead || u === e || !world.isAlly(e.owner, u.owner) || u.hp >= u.stats.hp - 0.01) return false;
    const d = dist(e.x, e.y, u.x, u.y);
    if (d <= radius && d < bd) { bd = d; best = u; }
    return false;
  });
  return best;
}

// ----------------------------------------------------------------- attack
function doAttack(world, e, dt) {
  const o = e.order;
  const t = world.alive(o.target);
  if (!t || (t.owner !== GAIA && !world.isEnemy(e.owner, t.owner) && !o.force && !o.wild) || t.kind === 'resource') { endOrder(world, e); return; }
  if (!e.stats.hasAtk) { endOrder(world, e); return; }
  const d = world.edgeDist(e, t);
  // wild animals decide on their own how long they chase (animals.js)
  if (o.wild) { if (!chaseCheck(world, e, o, t)) return; }
  else if (o.auto && d > e.stats.los + 3) { endOrder(world, e); return; }
  const ranged = e.stats.range > 0.5;
  const reach = ranged ? e.stats.range : CONTACT;
  if (ranged && e.stats.minRange && d < e.stats.minRange) {
    // too close for siege: wait (AoE behaviour)
    setAnim(world, e, 'idle'); e.swing = -1; return;
  }
  const r = approach(world, e, t, reach, dt);
  if (r === -1) { if (o.wild) attackFailed(world, e); endOrder(world, e); return; }
  if (r === 1) {
    face(e, t);
    attackTick(world, e, t, dt);
  } else {
    e.swing = -1;
  }
}

function attackTick(world, e, t, dt) {
  if (e.swing >= 0) {
    e.swing -= dt;
    if (e.swing <= 0) { e.swing = -1; performAttack(world, e, t); }
    return;
  }
  if (e.cd <= 0) {
    e.swing = e.stats.windup;
    e.cd = e.stats.rof;
    setAnim(world, e, 'attack', true);
  } else if (e.anim !== 'attack' || world.tick - e.animT > e.stats.rof * 10) {
    setAnim(world, e, 'ready');
  }
}

// ----------------------------------------------------------------- gather
function doGather(world, e, dt) {
  const o = e.order;
  const p = world.players[e.owner];
  if (e.gphase === 'drop') { doDrop(world, e, dt); return; }
  let t = world.alive(o.target);
  if (!t && world.carcassOf.has(o.target)) {
    t = world.alive(world.carcassOf.get(o.target));
    if (t) o.target = t.id;
  }
  if (!t || (t.kind === 'resource' && t.amount <= 0)) {
    // (a villager that fought off an animal goes back to its job instead)
    const nt = o.kind && !o.defend ? world.findNearbyResource(o.kind, e.x, e.y, o.kind === 'farm' ? 7 : o.kind === 'hunt' ? 10 : 9, e.owner, null) : null;
    if (nt) { o.target = nt.id; t = nt; e.path = null; e.pathWait = false; }
    else { if (e.carry > 0) { e.gphase = 'drop'; return; } endOrder(world, e); return; }
  }
  const kind = world.resKindOf(t);
  if (!kind) { endOrder(world, e); return; }
  if (e.carryKind && e.carry > 0 && CARRY_RES[e.carryKind] !== CARRY_RES[kind]) { e.carry = 0; e.carryKind = null; }
  if (e.carryKind && e.carryKind !== kind && CARRY_RES[e.carryKind] === CARRY_RES[kind]) e.carryKind = kind;
  o.kind = kind;
  e.task = TASK[kind];

  if (t.kind === 'unit') { huntTick(world, e, t, dt); return; }

  let r;
  if (kind === 'farm') {
    if (!t.built || t.owner !== e.owner) { endOrder(world, e); return; }
    if (t.farmer && t.farmer !== e.id) {
      const f = world.alive(t.farmer);
      if (f && f.order && f.order.type === 'gather' && f.order.target === t.id && f.gphase !== 'drop') {
        const nf = world.findNearbyResource('farm', e.x, e.y, 7, e.owner, t);
        if (nf) { o.target = nf.id; e.path = null; return; }
        setAnim(world, e, 'idle');
        return;
      }
    }
    const off = ((e.id * 37) % 9) / 9;
    const goal = { x0: t.tx, y0: t.ty, x1: t.tx + 2, y1: t.ty + 2, adjacent: false, px: t.tx + 0.6 + off * 1.8, py: t.ty + 0.6 + ((e.id * 53) % 7) / 7 * 1.8 };
    r = approach(world, e, t, 0, dt, goal, t.id);
  } else {
    r = approach(world, e, t, CONTACT, dt);
  }
  if (r === -1) {
    const nt = o.defend ? null : world.findNearbyResource(kind, e.x, e.y, 9, e.owner, t);
    if (nt) { o.target = nt.id; e.path = null; } else endOrder(world, e);
    return;
  }
  if (r !== 1) return;
  if (kind === 'farm') t.farmer = e.id;
  face(e, t);
  if (t.type === 'tree' && !t.felled) {
    setAnim(world, e, 'work');
    e.fell = (e.fell || 0) + dt;
    if (e.fell >= 1.5) { t.felled = true; e.fell = 0; world.emit({ t: 'treefall', id: t.id, x: t.x, y: t.y }); }
    return;
  }
  const cap = p.carryCap(kind);
  let amt = p.workRate(kind) * dt;
  const avail = kind === 'farm' ? t.food : t.amount;
  amt = Math.min(amt, avail, cap - e.carry);
  if (amt > 0) {
    if (kind === 'farm') t.food -= amt; else t.amount -= amt;
    e.carry += amt;
    e.carryKind = kind;
  }
  setAnim(world, e, 'work');
  if ((kind === 'farm' ? t.food : t.amount) <= 1e-6) {
    killEntity(world, t, null, kind === 'farm' ? 'exhausted' : 'depleted');
    e.gphase = e.carry > 0 ? 'drop' : 'go';
    return;
  }
  if (e.carry >= cap - 1e-6) {
    e.gphase = 'drop';
    if (kind === 'farm') t.farmer = 0;
  }
}

function huntTick(world, e, t, dt) {
  const hs = hunterStats(world.players[e.owner]);
  const r = approach(world, e, t, hs.range, dt);
  if (r === -1) { endOrder(world, e); return; }
  if (r !== 1) { e.swing = -1; return; }
  face(e, t);
  if (e.swing >= 0) {
    e.swing -= dt;
    if (e.swing <= 0) {
      e.swing = -1;
      const miss = world.rng.int(101) > hs.accuracy;
      spawnProjectile(world, e, t, hs, { miss });
      world.emit({ t: 'sound', s: 'spear', x: e.x, y: e.y, p: e.owner });
    }
    return;
  }
  if (e.cd <= 0) { e.swing = Math.max(0.1, hs.windup); e.cd = hs.rof; setAnim(world, e, 'hunt', true); }
}

function doDrop(world, e, dt) {
  const p = world.players[e.owner];
  if (!e.carry || !e.carryKind) { e.gphase = 'go'; return; }
  let d = world.alive(e.dropId);
  if (!d || d.owner !== e.owner || !d.built) {
    d = world.findDropSite(p, e.carryKind, e.x, e.y);
    e.dropId = d ? d.id : 0;
    e.path = null; e.pathWait = false;
  }
  if (!d) { setAnim(world, e, 'idle'); return; }
  const r = approach(world, e, d, CONTACT, dt);
  if (r === -1) { e.dropId = 0; setAnim(world, e, 'idle'); return; }
  if (r !== 1) return;
  const res = CARRY_RES[e.carryKind];
  let amount = e.carry;
  if (res === 'gold') amount *= p.goldBonus;
  p.res[res] += amount;
  p.stats.gathered[res] += amount;
  e.carry = 0;
  e.gphase = 'go';
  e.path = null; e.pathWait = false; e.fails = 0;
  world.emit({ t: 'deposit', p: e.owner, id: e.id });
}

// ------------------------------------------------------------ build/repair
function doBuild(world, e, dt, repair) {
  const t = world.alive(e.order.target);
  if (!t || t.kind !== 'building' || !world.isAlly(e.owner, t.owner)) { endOrder(world, e); return; }
  if (!repair && t.built) { afterBuild(world, e, t); return; }
  if (repair && !t.built) { e.order.type = 'build'; return; }
  if (repair && t.hp >= t.stats.hp - 1e-6) { endOrder(world, e); return; }
  const r = approach(world, e, t, CONTACT, dt);
  if (r === -1) { endOrder(world, e); return; }
  if (r !== 1) return;
  face(e, t);
  setAnim(world, e, 'build');
  e.task = repair ? 'repairer' : 'builder';
  const p = world.players[t.owner];
  const ster = p.flags.has('cheat:steroids') ? 20 : 1;
  const T = Math.max(1, t.stats.time);
  if (!repair) {
    // every builder adds its own seconds of construction (004B2C90 -> 004AF0E0):
    // two villagers build twice as fast
    t.builders++;
    const before = t.progress;
    t.progress = Math.min(1, t.progress + p.buildRate() * ster * dt / T);
    t.hp = Math.min(t.stats.hp, t.hp + (t.progress - before) * (t.stats.hp - 1));
    if (t.progress >= 1) {
      world.onBuildingComplete(t);
      afterBuild(world, e, t);
    }
  } else {
    // repair (004B6FE0 -> 004AE480): hit points at 0.3 of the building speed,
    // paid as it goes with half the building's cost for its full hit points
    const builder = world.players[e.owner];
    let inc = builder.repairRate(3) * ster * dt * t.stats.hp / T;
    inc = Math.min(inc, t.stats.hp - t.hp);
    const frac = inc / (2 * t.stats.hp);
    const cost = t.stats.cost || {};
    for (const k in cost) {
      if ((builder.res[k] || 0) < cost[k] * frac) {
        world.msg(e.owner, 'Không đủ tài nguyên để sửa nhà.', '#ffb060');
        endOrder(world, e);
        return;
      }
    }
    for (const k in cost) builder.res[k] -= cost[k] * frac;
    t.hp = Math.min(t.stats.hp, t.hp + inc);
  }
}

function afterBuild(world, e, t) {
  if (t.type === 'farm' && t.owner === e.owner && (!t.farmer || !world.alive(t.farmer))) {
    setOrder(world, e, { type: 'gather', target: t.id, kind: 'farm' });
    return;
  }
  const p = world.players[e.owner];
  let best = null, bd = 12;
  for (const b of p.buildings) {
    if (b.built || b === t || b.dead) continue;
    const d = dist(e.x, e.y, b.x, b.y);
    if (d < bd) { bd = d; best = b; }
  }
  if (best) { setOrder(world, e, { type: 'build', target: best.id }); return; }
  // freshly built drop site: gather what is next to it (keeps villagers busy)
  if (e.order && e.order.then) { setOrder(world, e, e.order.then); return; }
  endOrder(world, e);
  e.task = null;
}

// ---------------------------------------------------------------- priests
export function canConvert(world, p, t) {
  if (!t || t.dead || t.owner === GAIA) return false;
  if (t.kind === 'building') {
    if (!p.flags.has('monotheism')) return false;
    if (!t.built || t.type === 'town_center' || t.type === 'wonder' || t.stats.def.wall) return false;
    return true;
  }
  if (t.kind !== 'unit') return false;
  if (t.type === 'priest' && !p.flags.has('monotheism')) return false;
  return true;
}

function doConvert(world, e, dt) {
  const t = world.alive(e.order.target);
  const p = world.players[e.owner];
  if (!t || !world.isEnemy(e.owner, t.owner) || !canConvert(world, p, t)) { endOrder(world, e); return; }
  const r = approach(world, e, t, e.stats.range, dt);
  if (r === -1) { endOrder(world, e); return; }
  if (r !== 1) { e.chant = 0; e.chantT = 0; return; }
  face(e, t);
  if (e.faith < 100) { setAnim(world, e, 'idle'); e.chant = 0; e.chantT = 0; return; }
  setAnim(world, e, 'chant');
  if (e.chantT === 0 && e.chant === 0) world.emit({ t: 'chant', id: e.id, p: e.owner, tp: t.owner, x: e.x, y: e.y });
  const tryEvery = p.taskWork(PRIEST, 104, -1, 3) || 3;
  e.chantT += dt;
  if (Math.floor((e.chantT - dt) / CHANT_SOUND) !== Math.floor(e.chantT / CHANT_SOUND)) world.emit({ t: 'chant', id: e.id, p: e.owner, tp: t.owner, x: e.x, y: e.y });
  if (e.chantT >= tryEvery) {
    e.chantT -= tryEvery;
    e.chant++;
    let chance = (p.taskWork(PRIEST, 104) || 0.3) * p.task(UNITS.priest.dat).work;
    if (p.flags.has('cheat:hoyohoyo')) chance = 1;
    // the original scales its random number by the resistance: rand x k <= chance
    if (world.rng.next() * conversionResist(world, t) <= chance) convertTarget(world, e, t);
  }
}

export function convertTarget(world, e, t) {
  const from = t.owner;
  world.changeOwner(t, e.owner);
  world.players[e.owner].stats.converted++;
  world.players[from].stats.convertedLost++;
  e.faith = 0; e.chant = 0; e.chantT = 0;
  world.emit({ t: 'converted', id: t.id, from, to: e.owner, x: t.x, y: t.y });
  endOrder(world, e);
}

function doHeal(world, e, dt) {
  const t = world.alive(e.order.target);
  if (!t || t.kind !== 'unit' || !world.isAlly(e.owner, t.owner) || t.hp >= t.stats.hp - 1e-6) { endOrder(world, e); return; }
  if (e.order.auto && dist(e.x, e.y, t.x, t.y) > e.stats.los + 2) { endOrder(world, e); return; }
  const r = approach(world, e, t, 1.5, dt);
  if (r === -1) { endOrder(world, e); return; }
  if (r !== 1) return;
  face(e, t);
  setAnim(world, e, 'heal');
  const p = world.players[e.owner];
  const heal = (p.taskWork(PRIEST, 105) || 3) * p.task(UNITS.priest.dat).work * (p.healBonus > 0.1 ? p.healBonus : 1);
  t.hp = Math.min(t.stats.hp, t.hp + heal * dt);
}

// ---------------------------------------------------------------- animals
// (the wild animals themselves: animals.js)
// A villager bitten by a wild animal hunts it down, then goes back to its job
// (villager unit AI 004E6650: notification 500 from a Gaia unit). Hit by a
// player's unit instead it would run (not done yet).
export function villagerDefends(world, v, animal) {
  const o = v.order;
  if (o && o.target === animal.id) return;
  setOrder(world, v, { type: 'gather', target: animal.id, kind: 'hunt', defend: true, resume: o && o.defend ? o.resume : o });
}

// ------------------------------------------------------------- separation
const NUDGE = [[1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7], [0, -1], [0.7, -0.7]];
export function separateUnits(world) {
  const map = world.map;
  for (const e of world.list) {
    if (e.dead || e.kind !== 'unit') continue;
    if (e.anim === 'work' || e.anim === 'build' || e.swing >= 0 || e.anim === 'chant' || e.anim === 'heal') continue;
    const r = e.stats.radius;
    let px = 0, py = 0;
    world.grid.query(e.x, e.y, r + 0.8, (o) => {
      if (o === e || o.dead) return false;
      const dx = e.x - o.x, dy = e.y - o.y;
      const md = r + o.stats.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= md * md) return false;
      if (d2 < 1e-8) {
        const n = NUDGE[(e.id * 5) % 8];
        px += n[0] * 0.04; py += n[1] * 0.04;
        return false;
      }
      const d = Math.sqrt(d2);
      const ov = (md - d) * (e.moved ? 0.35 : 0.5);
      px += (dx / d) * ov; py += (dy / d) * ov;
      return false;
    });
    if (px === 0 && py === 0) continue;
    const pl = Math.sqrt(px * px + py * py);
    const maxp = 0.12;
    if (pl > maxp) { px = (px / pl) * maxp; py = (py / pl) * maxp; }
    const nx = e.x + px, ny = e.y + py;
    const bi = map.idx(Math.floor(nx), Math.floor(ny));
    const blk = map.block[bi];
    if ((blk === 0 || blk === e.goalAllow) && map.terrainPassable(Math.floor(nx), Math.floor(ny))) { e.x = nx; e.y = ny; }
  }
}

export function unitDef(type) { return UNITS[type]; }
