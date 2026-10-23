// Wild animals: a port of the unit AI modules empires.exe gives Gaia's
// animals (004B13D0 picks one by unit class, see animalModule in
// data/units.js; the modules are at 004E5A10-004E63F8, on top of the base
// unit AI at 0040F1E0-00415600).
//
// Every module keeps an idle clock (module+F8h): it counts game milliseconds
// while the animal has no action and, past a threshold drawn once as
// rand() % (base / 2) + base * 3/4 (004135A0; base 3 s, gazelles 4 s), runs the
// idle step of the module. What an animal sees is tile based: the objects of
// its module's class list (module+124h) whose tile lies within its line of
// sight, measured with the game's circle table (00519390 builds it from the
// circles that reveal the map; 00519600 scans with it).
//   prey (gazelles; 004E5B60, 004E5C60): idle - the closest feared object
//     makes it run straight away 3 x its current speed; hit - it runs away from
//     the sum of its attackers 4 x its current speed (004130D0).
//   elephant (004E5F60, 004E9630): idle - nothing; hit - it charges the closest
//     of its attackers (when not already busy).
//   lion (004E61E0, 004E6300): idle every 4.5-7.5 s - attacks the closest
//     object of its list, whoever owns it (gazelles too); an attack that cannot
//     reach its target makes it rest 18.75-31.25 s.
//   predator (alligators, the "king" animals; base 00414BD0 -> 00411190):
//     idle - attacks the closest player unit of its list in sight.
// Lions and predators chase while the target stays within their line of sight
// (508 handlers 004E61E0, 004E5EB0); an elephant chases while Gaia still sees
// the target, then walks to where it was when the charge began (base 508
// handler 004143A7). Hit while not attacking, lions and predators turn on the
// attacker (base 500 handler 00413E8F). Gaia's units move through 004279B0,
// which picks the running sprite: gazelles and lions run at 1.9 x their speed.
import { GAIA } from './constants.js';
import { setOrder } from './behavior.js';

// classes each module reacts to (lists filled by the module constructors)
const FEARS = new Set([0, 4, 26, 24, 6, 25, 17, 10, 12, 35, 23, 36, 28, 18, 13, 39]); // 004E5A10
const PREY = new Set([29, 9, 0, 4, 26, 24, 6, 25, 17, 13, 12, 35, 23, 36, 28, 18, 39]); // 004E5D50, 004E6070
const IDLE_MS = { prey: 4000, elephant: 3000, lion: 6000, predator: 3000 };
const LION_REST_MS = 25000;      // after a failed attack (random map games)
const FLEE_SEEN = 3, FLEE_HIT = 4; // flight length in current speeds (0054E1A8, 00547B00)
const MOVED = 1.875;             // the target left its chase point (005473C0): notify 508

// distance in tiles between two tiles |dx|, |dy| <= 15 (the game's circles)
const CIRCLES = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  2, 2, 3, 4, 5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  3, 3, 4, 4, 5, 6, 7, 8, 9, 10, 10, 11, 12, 13, 14, 15,
  4, 4, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  5, 5, 5, 6, 6, 7, 8, 9, 9, 10, 11, 12, 13, 14, 15, 16,
  6, 6, 6, 7, 7, 8, 9, 9, 10, 11, 12, 13, 13, 14, 15, 16,
  7, 7, 7, 8, 8, 9, 9, 10, 11, 11, 12, 13, 14, 15, 16, 255,
  8, 8, 8, 9, 9, 9, 10, 11, 11, 12, 13, 14, 14, 15, 16, 255,
  9, 9, 9, 10, 10, 10, 11, 11, 12, 13, 14, 14, 15, 16, 255, 255,
  10, 10, 10, 10, 11, 11, 12, 12, 13, 14, 14, 15, 16, 16, 255, 255,
  11, 11, 11, 11, 12, 12, 13, 13, 14, 14, 15, 16, 16, 255, 255, 255,
  12, 12, 12, 12, 13, 13, 13, 14, 14, 15, 16, 16, 255, 255, 255, 255,
  13, 13, 13, 13, 14, 14, 14, 15, 15, 16, 16, 255, 255, 255, 255, 255,
  14, 14, 14, 14, 15, 15, 15, 16, 16, 255, 255, 255, 255, 255, 255, 255,
  15, 15, 15, 15, 16, 16, 16, 255, 255, 255, 255, 255, 255, 255, 255, 255,
]);
export function tileDist(ax, ay, bx, by) {
  const dx = Math.abs(Math.floor(ax) - Math.floor(bx)), dy = Math.abs(Math.floor(ay) - Math.floor(by));
  return dx > 15 || dy > 15 ? 255 : CIRCLES[dy * 16 + dx];
}

export function initAnimal(world, e) {
  const kind = e.stats.def.animal;
  if (!kind) return;
  e.ai = { kind, base: IDLE_MS[kind], idleT: 0, idleMax: 0, attackers: [], hits: [] };
  resetIdle(world, e.ai);
}
function resetIdle(world, a) { a.idleMax = world.rng.int(a.base >> 1) + ((a.base * 3) >> 2); }

// A hit taken (notification 500), handled at the animal's next update.
export function animalHit(e, src) {
  if (e.ai && src) e.ai.hits.push(src.id);
}

// Once per tick, before the animal's order runs.
export function updateAnimal(world, e, dt) {
  const a = e.ai;
  // attackers stay listed while they keep attacking it (base update sweep)
  if (a.attackers.length) a.attackers = a.attackers.filter((id) => attacking(world.alive(id), e.id));
  if (a.hits.length) {
    const hits = a.hits;
    a.hits = [];
    for (const id of hits) onHit(world, e, id);
  }
  if (e.order) { a.idleT = 0; return; }
  a.idleT += dt * 1000;
  if (a.idleT <= a.idleMax) return;
  a.idleT = 0;
  idle(world, e);
}

const attacking = (u, id) => !!(u && u.order && u.order.target === id && (u.order.type === 'attack' || u.order.type === 'gather'));

function idle(world, e) {
  const a = e.ai;
  switch (a.kind) {
    case 'prey': {
      const t = closestSeen(world, e, FEARS);
      if (t) flee(world, e, [t], FLEE_SEEN);
      break;
    }
    case 'lion': {
      a.base = IDLE_MS.lion;
      resetIdle(world, a);
      // a reach of 2 x sight: the 0.75 / 0.5 x of Easy / Easiest only applies
      // to single player scenarios
      const t = closestSeen(world, e, PREY);
      if (t && world.edgeDist(e, t) <= 2 * e.stats.los) attack(world, e, t);
      break;
    }
    case 'predator': {
      const t = closestTarget(world, e);
      if (t) attack(world, e, t);
      break;
    }
    default: break; // the elephant waits to be provoked
  }
}

function onHit(world, e, id) {
  const a = e.ai, src = world.alive(id);
  if (!src) return;
  if (!a.attackers.includes(id)) a.attackers.push(id);
  if (a.kind === 'prey') { // (a lion is Gaia's too: the gazelle runs all the same)
    flee(world, e, a.attackers.map((i) => world.alive(i)).filter(Boolean), FLEE_HIT);
  } else if (a.kind === 'elephant') {
    if (e.order) return;
    let best = null, bd = Infinity;
    for (const i of a.attackers) {
      const u = world.alive(i);
      const d = u ? world.edgeDist(e, u) : Infinity;
      if (d < bd) { bd = d; best = u; }
    }
    if (best) attack(world, e, best);
  } else {
    if (src.owner === e.owner || (e.order && e.order.type === 'attack')) return; // keeps its prey
    if (reachable(world, src)) attack(world, e, src);
    else if (!(e.order && e.order.wild)) flee(world, e, a.attackers.map((i) => world.alive(i)).filter(Boolean), FLEE_HIT);
  }
}

// During a chase (order o on target t): once the target has left the point
// the animal was heading for (notification 508) it decides whether to go on.
// Returns false when it gave up (its order has changed).
export function chaseCheck(world, e, o, t) {
  if (Math.abs(t.x - o.cx) <= MOVED && Math.abs(t.y - o.cy) <= MOVED) return true;
  if (e.ai.kind === 'elephant') {
    if (t.owner === GAIA || gaiaSees(world, t.x, t.y)) { o.cx = t.x; o.cy = t.y; return true; }
    moveTo(world, e, o.ax, o.ay, false); // Gaia is no computer player: to the last known spot
    return false;
  }
  if (world.edgeDist(e, t) <= e.stats.los) { // attacks it again
    o.cx = o.ax = t.x; o.cy = o.ay = t.y;
    return true;
  }
  setOrder(world, e, null);
  return false;
}

// Notification 506: the attack could not reach its target.
export function attackFailed(world, e) {
  const a = e.ai;
  if (a.kind !== 'lion') return;
  a.base = LION_REST_MS;
  resetIdle(world, a);
}

function attack(world, e, t) {
  setOrder(world, e, { type: 'attack', target: t.id, auto: true, wild: true, ax: t.x, ay: t.y, cx: t.x, cy: t.y });
  e.run = e.stats.runMul > 1;
}

// 004130D0 / 004E5C60: run from the given objects, k x the current speed
function flee(world, e, from, k) {
  let sx = 0, sy = 0;
  for (const u of from) { sx += u.x - e.x; sy += u.y - e.y; }
  const len = Math.sqrt(sx * sx + sy * sy);
  if (len < 1e-6) return;
  const r = k * e.stats.speed * (e.anim === 'run' ? e.stats.runMul : 1);
  moveTo(world, e, e.x - (sx / len) * r, e.y - (sy / len) * r, true);
}

// 00412BB0: a point inside the map; an unreachable one is shifted up to five
// times by up to 3 tiles on each axis
function moveTo(world, e, x, y, run) {
  const map = world.map;
  const cx = (v) => (v < 0 ? 0 : v >= map.w ? map.w - 1 : v);
  const cy = (v) => (v < 0 ? 0 : v >= map.h ? map.h - 1 : v);
  x = cx(x); y = cy(y);
  for (let i = 0; i < 5 && !map.passable(Math.floor(x), Math.floor(y)); i++) {
    x = cx(x + (world.rng.int(2) ? 1 : -1) * world.rng.int(4));
    y = cy(y + (world.rng.int(2) ? 1 : -1) * world.rng.int(4));
  }
  setOrder(world, e, { type: 'move', x, y, wild: true });
  e.run = run && e.stats.runMul > 1;
}

// units of the class list whose tile is in sight: [unit, tile distance]
function seen(world, e, classes, playersOnly) {
  const R = Math.min(15, Math.floor(e.stats.los));
  const out = [];
  world.grid.query(e.x, e.y, (R + 1) * 1.5, (u) => {
    if (u === e || u.dead || (playersOnly && u.owner === GAIA)) return false;
    if (!classes.has(u.stats.def.datClass)) return false;
    const d = tileDist(e.x, e.y, u.x, u.y);
    if (d <= R) out.push([u, d]);
    return false;
  });
  return out;
}

// 00411C90: the closest in tiles, any owner
function closestSeen(world, e, classes) {
  let best = null, bd = 256, be = Infinity;
  for (const [u, d] of seen(world, e, classes, false)) {
    const ed = world.edgeDist(e, u);
    if (d < bd || (d === bd && (ed < be || (ed === be && u.id < best.id)))) { best = u; bd = d; be = ed; }
  }
  return best;
}

// 00411190: the closest by distance among the players' units in sight
// (Gaia's own objects are not targets of the base module)
function closestTarget(world, e) {
  let best = null, bd = Infinity;
  for (const [u] of seen(world, e, PREY, true)) {
    const d = world.edgeDist(e, u);
    if (d < bd || (d === bd && u.id < best.id)) { best = u; bd = d; }
  }
  return best;
}

// 0044EA60: whether the attacker stands on ground the animal can walk on
function reachable(world, u) {
  return world.map.terrainPassable(Math.floor(u.x), Math.floor(u.y));
}

// Gaia sees a tile when it lies within the sight of one of its animals.
function gaiaSees(world, x, y) {
  let yes = false;
  world.grid.query(x, y, 14, (u) => {
    if (u.dead || u.owner !== GAIA || !u.ai) return false;
    if (tileDist(u.x, u.y, x, y) <= Math.min(15, Math.floor(u.stats.los))) { yes = true; return true; }
    return false;
  });
  return yes;
}
