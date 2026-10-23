// Damage model, projectiles and death handling, as in the Rise of Rome
// executable (reverse-engineered from empires.exe 1.0):
//   damage = Σ over the attacker's attack classes of
//            max(0, (attack − target armor of that class) × kElev)
//            (a class missing from the target's armor list uses its default armor)
//   the target always loses at least 1 hit point per hit — 0.1 when an archer
//   or a watch/sentry/guard tower hits a unit; hit points are fractional.
//   kElev = 1.5 when a ranged attacker stands higher than its target, 2/3 when
//   a melee attacker stands lower, else 1 (heights compared exactly).
//   Area attacks (catapults; elephants and scythe chariots trampling) hit every
//   object whose edge lies within the blast radius, at full damage, when its
//   blast defense level is at least the attack's blast level. Trampling
//   elephants and chariots spare their owner's units; catapults spare no one.
//   Every hit first passes an accuracy roll (accuracy %).
import { GAIA, TICK_S } from './constants.js';
import { dist, distToRect } from './dmath.js';
import { CONTACT, villagerDefends } from './behavior.js';
import { animalHit } from './animals.js';

const ARCHER_CLASSES = [0, 23, 26, 36];     // foot archer, chariot archer, elephant archer, horse archer
const LIGHT_TOWERS = [69, 79, 199];         // guard, watch, sentry tower (not the ballista tower)
const TRAMPLE_CLASSES = [24, 35];           // war elephant, chariot: no damage to own units

function heightOf(world, e) { return world.map.heightAt(e.x, e.y); }

export function kElev(world, a, t, ranged) {
  const ha = heightOf(world, a), ht = heightOf(world, t);
  if (ranged) return ha > ht + 1e-6 ? 1.5 : 1;
  return ha < ht - 1e-6 ? 2 / 3 : 1;
}

// minimum hit-point loss of one hit by an attacker with these stats
export function minDamage(s, t) {
  if (t.kind !== 'building' && (ARCHER_CLASSES.includes(s.def.datClass) || LIGHT_TOWERS.includes(s.def.dat))) return 0.1;
  return 1;
}

// s: attacker stats {attacks}; t: target entity
export function computeDamage(s, t, k) {
  const ts = t.stats, armors = ts.armors, def = ts.defArmor || 0;
  let dmg = 0;
  for (let i = 0; i < s.attacks.length; i++) {
    const [cls, amount] = s.attacks[i];
    let arm = def;
    for (let j = 0; j < armors.length; j++) if (armors[j][0] === cls) arm = armors[j][1];
    const d = (amount - arm) * k;
    if (d > 0) dmg += d;
  }
  return dmg;
}

const accuracyHit = (world, s) => (s.accuracy ?? 100) >= 100 || world.rng.int(101) <= s.accuracy;

// s: { attacks, minDmg }
export function applyDamage(world, src, s, t, k, ownerId) {
  if (!t || t.dead || t.kind === 'resource') return;
  const owner = src ? src.owner : ownerId;
  const dmg = Math.max(computeDamage(s, t, k), s.minDmg !== undefined ? (t.kind === 'building' ? 1 : s.minDmg) : 1);
  t.hp -= dmg;
  t.lastAtkBy = src ? src.id : 0;
  t.lastAtkTick = world.tick;
  if (t.owner !== GAIA && owner !== t.owner) {
    const p = world.players[t.owner];
    if (!p.lastAlert || world.tick - p.lastAlert > 80) {
      p.lastAlert = world.tick;
      world.emit({ t: 'attacked', p: t.owner, x: t.x, y: t.y, kind: t.kind });
    }
  }
  world.emit({ t: 'hit', id: t.id });
  if (t.hp <= 0) { killEntity(world, t, src); return; }
  if (t.ai) { animalHit(t, src); return; }
  if (t.type === 'villager' && src && src.kind === 'unit' && !src.dead && src.owner === GAIA) { villagerDefends(world, t, src); return; }
  // retaliation of idle military units (wild animals included: base unit AI 00413E8F)
  if (t.kind === 'unit' && src && src.kind === 'unit' && !src.dead && t.owner !== GAIA && !t.order &&
    t.stats.hasAtk && t.type !== 'villager' && (world.isEnemy(t.owner, src.owner) || src.owner === GAIA)) {
    t.order = { type: 'attack', target: src.id, auto: true };
  }
}

function hitStats(e, t) {
  const s = e.stats;
  return { attacks: s.attacks, minDmg: minDamage(s, t) };
}

export function performAttack(world, e, t) {
  if (t.dead) return;
  const s = e.stats;
  if (s.def.nuke) { nuke(world, e); return; }
  if (s.proj) {
    spawnProjectile(world, e, t, s);
    world.emit({ t: 'sound', s: 'shoot_' + s.proj.kind, x: e.x, y: e.y, p: e.owner });
    return;
  }
  if (world.edgeDist(e, t) > CONTACT + 0.6) return; // target slipped away during the swing
  const k = kElev(world, e, t, false);
  if (s.blast > 0) blastDamage(world, e, s, t.x, t.y, t);
  if (accuracyHit(world, s)) applyDamage(world, e, hitStats(e, t), t, k);
  world.emit({ t: 'sound', s: meleeSound(e), x: t.x, y: t.y, p: e.owner, tk: t.kind });
}

// Area damage around (x, y) — every object except `skip`
function blastDamage(world, src, s, x, y, skip, owner = src ? src.owner : 0) {
  const R = s.blast, R2 = R * R;
  const level = s.blastLevel || 0;
  const spareOwn = TRAMPLE_CLASSES.includes(s.def.datClass);
  const ranged = s.range > 0.99;
  const elev = (o) => (src ? kElev(world, src, o, ranged) : 1);
  const within = (ox, oy, rx, ry) => {
    const ex = Math.max(0, Math.abs(ox - x) - rx), ey = Math.max(0, Math.abs(oy - y) - ry);
    return ex * ex + ey * ey <= R2;
  };
  world.grid.query(x, y, R + 1, (u) => {
    if (u.dead || u === skip || u === src) return false;
    if (spareOwn && u.owner === owner) return false;
    if ((u.stats.blastDef || 0) < level) return false;
    if (!within(u.x, u.y, u.stats.radius, u.stats.radius)) return false;
    if (!accuracyHit(world, s)) return false;
    applyDamage(world, src, { attacks: s.attacks, minDmg: minDamage(s, u) }, u, elev(u), owner);
    return false;
  });
  forObjectsInRadius(world, x, y, R + 1.5, (b) => {
    if (b === skip) return;
    const half = (b.size || 1) / 2;
    if (!within(b.tx + half, b.ty + half, half, half)) return;
    if (b.kind === 'resource') {
      if (b.type === 'tree' && level <= 1) killEntity(world, b, null); // heavy catapults clear forests
      return;
    }
    if (spareOwn && b.owner === owner) return;
    if ((b.stats.blastDef || 0) < level) return;
    if (!accuracyHit(world, s)) return;
    applyDamage(world, src, { attacks: s.attacks, minDmg: 1 }, b, elev(b), owner);
  });
}

function meleeSound(e) {
  const c = e.stats.def.cls;
  if (e.type === 'villager') return 'hit_villager';
  if (c.includes('elephant')) return 'hit_elephant';
  if (e.type === 'clubman') return 'hit_club';
  return 'hit_sword';
}

function nuke(world, e) {
  const R = e.stats.def.nuke || 5;
  world.emit({ t: 'nuke', x: e.x, y: e.y, r: R });
  const s = { attacks: [[0, 1500]], minDmg: 1500 };
  world.grid.query(e.x, e.y, R + 1, (u) => {
    if (!u.dead && u !== e && dist(u.x, u.y, e.x, e.y) <= R) applyDamage(world, e, s, u, 1);
    return false;
  });
  forObjectsInRadius(world, e.x, e.y, R, (b) => { if (b.kind === 'building') applyDamage(world, e, s, b, 1); });
  killEntity(world, e, null);
}

// buildings and resource objects with a tile footprint near (x, y)
function forObjectsInRadius(world, x, y, r, fn) {
  const map = world.map, seen = new Set();
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(map.w - 1, Math.floor(x + r));
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(map.h - 1, Math.floor(y + r));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const id = map.block[ty * map.w + tx];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const b = world.entities.get(id);
    if (!b || b.dead) continue;
    if (b.kind === 'building' || b.kind === 'resource') fn(b);
  }
}

// opts: { miss, attacks, minDmg }
export function spawnProjectile(world, src, t, s, opts = {}) {
  const speed = s.proj.speed;
  const sx = src.x, sy = src.y;
  let tx = t.x, ty = t.y;
  let d = dist(sx, sy, tx, ty);
  let T = Math.max(0.15, d / speed);
  if (s.proj.smart && t.kind === 'unit') {
    // Ballistics: aim where the target will be
    const vx = (t.x - t.px) / TICK_S, vy = (t.y - t.py) / TICK_S;
    tx = t.x + vx * T; ty = t.y + vy * T;
    d = dist(sx, sy, tx, ty); T = Math.max(0.15, d / speed);
  }
  if (opts.miss) {
    tx += world.rng.range(-1.2, 1.2); ty += world.rng.range(-1.2, 1.2);
  }
  const k = kElev(world, src, t, true);
  world.projectiles.push({
    kind: s.proj.kind, owner: src.owner, srcId: src.id,
    x0: sx, y0: sy, x1: tx, y1: ty, t: 0, T,
    z0: src.kind === 'building' ? (src.size <= 2 ? 2.2 : 1.2) : 0.6,
    attacks: opts.attacks || s.attacks, minDmg: opts.minDmg ?? minDamage(s, t), k, target: t.id,
    blast: s.blast || 0, blastLevel: s.blastLevel || 0, srcDef: s.def, range: s.range,
    fire: /Fire|_F$/.test(s.proj.dat || ''),
    arc: s.proj.kind === 'stone' ? 1.2 + d * 0.15 : s.proj.kind === 'laser' ? 0 : 0.25 + d * 0.05,
  });
}

export function updateProjectiles(world, dt) {
  const list = world.projectiles;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    p.t += dt;
    if (p.t >= p.T) impact(world, p);
    else list[w++] = p;
  }
  list.length = w;
}

function impact(world, p) {
  const s = { attacks: p.attacks, minDmg: p.minDmg };
  const src = world.alive(p.srcId);
  if (p.blast > 0) {
    world.emit({ t: 'impact', kind: p.kind, x: p.x1, y: p.y1, r: p.blast });
    blastDamage(world, src, { attacks: p.attacks, blast: p.blast, blastLevel: p.blastLevel, def: p.srcDef, range: p.range, accuracy: 100 }, p.x1, p.y1, null, p.owner);
    return;
  }
  const t = world.alive(p.target);
  let hit = null;
  if (t) {
    if (t.kind === 'unit') { if (dist(t.x, t.y, p.x1, p.y1) <= t.stats.radius + 0.35) hit = t; }
    else if (t.kind === 'building' && distToRect(p.x1, p.y1, t.tx, t.ty, t.tx + t.size, t.ty + t.size) <= 0.45) hit = t;
  }
  if (!hit) {
    world.grid.query(p.x1, p.y1, 1.2, (u) => {
      if (u.dead || u.owner === p.owner || world.isAlly(p.owner, u.owner)) return false;
      if (dist(u.x, u.y, p.x1, p.y1) <= u.stats.radius + 0.15) { hit = u; return true; }
      return false;
    });
  }
  if (hit) applyDamage(world, src, s, hit, p.k, p.owner);
  else world.emit({ t: 'miss', kind: p.kind, x: p.x1, y: p.y1 });
}

export function killEntity(world, e, killer, reason) {
  if (e.dead) return;
  e.dead = true;
  world.dirty = true;
  world.removeBlock(e);
  const p = world.players[e.owner];
  if (e.kind === 'unit') {
    e.hp = 0;
    p.units.delete(e);
    if (e.owner !== GAIA) {
      p.pop -= e.stats.pop;
      p.stats.lost++;
      if (killer && killer.owner !== e.owner && killer.owner !== GAIA) world.players[killer.owner].stats.killed++;
    }
    world.emit({ t: 'death', type: e.type, owner: e.owner, x: e.x, y: e.y, fx: e.fx, fy: e.fy, id: e.id, task: e.task || null, reason });
    const st = e.stats;
    if (e.owner === GAIA && st.food && killer && killer.kind === 'unit' && killer.type === 'villager') {
      const c = world.spawnCarcass(e.type, e.x, e.y, st.food, st.decay);
      world.carcassOf.set(e.id, c.id);
    }
  } else if (e.kind === 'building') {
    e.hp = 0;
    p.buildings.delete(e);
    if (e.training) p.training -= e.trainPop;
    if (e.research) world.stopResearch(p, e);
    if (e.built) world.recomputePop(p);
    if (killer && killer.owner !== e.owner && reason !== 'exhausted') {
      world.players[killer.owner].stats.razed++;
      p.stats.buildingsLost++;
    }
    world.emit({ t: 'destroyed', type: e.type, owner: e.owner, x: e.x, y: e.y, tx: e.tx, ty: e.ty, size: e.size, built: e.built, reason });
  } else {
    world.emit({ t: 'depleted', type: e.type, x: e.x, y: e.y, id: e.id });
  }
}
