// Wild animal behaviour tests (node tests/animals.test.mjs): the unit AI
// modules of empires.exe ported in engine/animals.js.
import { World } from '../public/src/engine/world.js';
import { applyDamage, killEntity } from '../public/src/engine/combat.js';
import { setOrder } from '../public/src/engine/behavior.js';
import { tileDist } from '../public/src/engine/animals.js';
import { dist } from '../public/src/engine/dmath.js';

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
const near = (a, b, eps, name) => ok(Math.abs(a - b) <= eps, `${name} (got ${a.toFixed(3)}, want ${b} ± ${eps})`);
const run = (w, ticks, until) => { for (let i = 0; i < ticks; i++) { w.step(); if (until && until()) return i + 1; } return ticks; };

// a world without its own animals, and an open 16x16 field far from the players
function setup(seed = 11) {
  const w = new World({ seed, mapSize: 'medium', rules: 'free', players: [{ id: 1, name: 'A', civ: 'greek' }, { id: 2, name: 'B', civ: 'shang' }] });
  for (const e of w.list) if (e.ai) killEntity(w, e, null);
  w.step();
  const m = w.map;
  const busy = [...w.players[1].units, ...w.players[2].units, ...w.players[1].buildings, ...w.players[2].buildings];
  // (trees and mines in the way are cleared; cliffs are not)
  const open = (x, y) => m.terrainPassable(x, y) && (!m.block[m.idx(x, y)] || w.get(m.block[m.idx(x, y)]).kind === 'resource');
  for (let y = 4; y < m.h - 24; y++) for (let x = 4; x < m.w - 24; x++) {
    let free = true;
    for (let dy = 0; dy < 20 && free; dy++) for (let dx = 0; dx < 20 && free; dx++) if (!open(x + dx, y + dy)) free = false;
    if (!free || !busy.every((b) => dist(b.x, b.y, x + 10, y + 10) > 24)) continue;
    for (let dy = 0; dy < 20; dy++) for (let dx = 0; dx < 20; dx++) {
      const id = m.block[m.idx(x + dx, y + dy)];
      if (id) killEntity(w, w.get(id), null);
    }
    w.step();
    return { w, x: x + 4, y: y + 4 };
  }
  throw new Error('no open field');
}
const unit = (w, type, owner, x, y) => { const u = w.spawnUnit(type, owner, x, y); setOrder(w, u, null); return u; };

// ---- the circle table: tile distances of the original
ok(tileDist(0.5, 0.5, 2.5, 0.5) === 2 && tileDist(0.5, 0.5, 1.5, 1.5) === 1 && tileDist(0.5, 0.5, 2.5, 2.5) === 3, 'circle table: (2,0)=2, (1,1)=1, (2,2)=3');
ok(tileDist(0, 0, 6.5, 6.5) === 9 && tileDist(10.2, 3, 10.9, 3.9) === 0, 'circle table: (6,6)=9, same tile 0');

// ---- gazelle: an approaching villager makes it run 3 x its speed away
{
  const { w, x, y } = setup();
  const g = unit(w, 'gazelle', 0, x + 0.5, y + 0.5);
  const v = unit(w, 'villager', 1, x - 1.5, y + 0.5); // 2 tiles west
  ok(g.ai && g.ai.kind === 'prey' && g.ai.idleMax >= 3000 && g.ai.idleMax < 5000, 'gazelle: hunted-animal module, idle check every 3-5 s');
  const t = run(w, 60, () => g.order);
  ok(g.order && g.order.type === 'move' && g.run, 'gazelle notices a villager 2 tiles away within 5 s and runs');
  ok(t * 100 > g.ai.idleMax - 100, 'gazelle reacts only at its idle check, not at once');
  near(dist(g.order.x, g.order.y, x + 0.5, y + 0.5), 3.3, 1e-6, 'gazelle flight: 3 x speed 1.1');
  ok(g.order.x > x + 0.5 && Math.abs(g.order.y - (y + 0.5)) < 1e-6, 'gazelle runs straight away from the villager');
  run(w, 2);
  near(g.px === g.x ? 0 : dist(g.x, g.y, g.px, g.py) / 0.1, 2.09, 0.01, 'gazelle runs at 2.09 (running sprite 1.9x)');
  run(w, 40, () => !g.order);
  ok(!g.order && dist(g.x, g.y, x + 3.8, y + 0.5) < 0.6, 'gazelle stops after its flight');
  // a villager 3 tiles away is out of its sight (2)
  const g2 = unit(w, 'gazelle', 0, x + 0.5, y + 6.5);
  unit(w, 'villager', 1, x + 0.5, y + 9.5);
  run(w, 80);
  ok(!g2.order && dist(g2.x, g2.y, x + 0.5, y + 6.5) < 0.3, 'gazelle ignores a villager 3 tiles away');
  ok(v.hp === v.stats.hp, 'gazelles never attack');
}

// ---- gazelle hit: runs 4 x its speed away from its attackers
{
  const { w, x, y } = setup();
  const g = unit(w, 'gazelle', 0, x + 0.5, y + 0.5);
  const h = unit(w, 'villager', 1, x + 0.5, y - 2.5); // north
  g.hp = 100; // survive the spear
  setOrder(w, h, { type: 'gather', target: g.id, kind: 'hunt' });
  applyDamage(w, h, { attacks: [[4, 1]], minDmg: 1 }, g, 1);
  w.step();
  ok(g.order && g.order.type === 'move' && g.run, 'hit gazelle runs at once');
  near(dist(g.order.x, g.order.y, x + 0.5, y + 0.5), 4.4, 1e-6, 'hit flight: 4 x speed 1.1');
  ok(g.order.y > y + 4, 'hit gazelle runs away from the hunter');
}

// ---- lion: attacks what comes within its sight (3), chasing at 2.09
{
  const { w, x, y } = setup();
  const l = unit(w, 'lion', 0, x + 0.5, y + 0.5);
  const v = unit(w, 'villager', 1, x + 3.5, y + 0.5);
  ok(l.ai.kind === 'lion' && l.ai.idleMax >= 4500 && l.ai.idleMax < 7500, 'lion: idle check every 4.5-7.5 s (004E61A6)');
  run(w, 80, () => l.order);
  ok(l.order && l.order.type === 'attack' && l.order.target === v.id && l.run, 'lion attacks a villager 3 tiles away');
  ok(l.ai.idleMax >= 4500 && l.ai.idleMax < 7500, 'lion re-draws its idle clock: 4.5-7.5 s');
  run(w, 30, () => v.hp < v.stats.hp);
  ok(v.hp < v.stats.hp, 'lion bites the villager');
  ok(v.order && v.order.type === 'gather' && v.order.target === l.id && v.order.defend, 'bitten villager hunts the lion');
  // the target leaves its sight: the lion gives up
  setOrder(w, v, null);
  v.x += 10; v.y += 6;
  run(w, 2);
  ok(!l.order || l.order.type !== 'attack', 'lion gives up a target beyond its sight');
}

// ---- lion hunts gazelles; alligators leave them alone
{
  const { w, x, y } = setup();
  const l = unit(w, 'lion', 0, x + 0.5, y + 0.5);
  const g = unit(w, 'gazelle', 0, x + 2.5, y + 0.5);
  g.ai.idleMax = 1e9; // keep the gazelle still
  run(w, 80, () => l.order);
  ok(l.order && l.order.target === g.id, 'lion goes for a gazelle');
  const a = unit(w, 'alligator', 0, x + 0.5, y + 7.5);
  const g2 = unit(w, 'gazelle', 0, x + 3.5, y + 7.5);
  g2.ai.idleMax = 1e9;
  run(w, 60);
  ok(!a.order, 'alligator ignores gazelles (Gaia objects are not its targets)');
  const v = unit(w, 'villager', 1, x + 0.5, y + 12.5); // 5 tiles: its sight
  run(w, 60, () => a.order);
  ok(a.ai.kind === 'predator' && a.order && a.order.target === v.id && !a.run, 'alligator attacks a villager 5 tiles away (walking)');
}

// ---- elephant: ignores everybody until hit, then charges the closest attacker
{
  const { w, x, y } = setup();
  const el = unit(w, 'elephant_wild', 0, x + 0.5, y + 0.5);
  const v1 = unit(w, 'villager', 1, x + 2.5, y + 0.5);
  const v2 = unit(w, 'villager', 1, x + 4.5, y + 0.5);
  run(w, 80);
  ok(!el.order, 'elephant ignores villagers next to it');
  // (hits are handled one by one: the first makes it charge, the next find it busy)
  for (const v of [v2, v1]) { setOrder(w, v, { type: 'gather', target: el.id, kind: 'hunt' }); applyDamage(w, v, { attacks: [[4, 1]], minDmg: 1 }, el, 1); }
  setOrder(w, v1, null); setOrder(w, v2, null);
  w.step();
  ok(el.order && el.order.type === 'attack' && el.order.target === v2.id && !el.run, 'hit elephant charges its attacker, walking');
  ok(el.ai.attackers.length === 2, 'elephant keeps both attackers in mind');
  // the target slips out of Gaia's sight: back to where the charge began
  v2.x = x + 14.5; v2.y = y + 14.5;
  run(w, 2);
  ok(el.order && el.order.type === 'move' && Math.abs(el.order.x - (x + 4.5)) < 1e-6, 'elephant gives up and walks to the spot of its charge');
}

// ---- soldiers turn on a wild animal that bites them
{
  const { w, x, y } = setup();
  const c = unit(w, 'clubman', 1, x + 0.5, y + 0.5);
  const l = unit(w, 'lion', 0, x + 1.5, y + 0.5);
  applyDamage(w, l, { attacks: [[12, 2]], minDmg: 1 }, c, 1);
  ok(c.order && c.order.type === 'attack' && c.order.target === l.id, 'bitten clubman fights the lion');
}

// ---- a villager bitten at work goes back to its job once the animal is dead
{
  const { w, x, y } = setup();
  const v = unit(w, 'villager', 1, x + 0.5, y + 0.5);
  const job = { type: 'move', x: x + 6.5, y: y + 6.5 };
  setOrder(w, v, job);
  const l = unit(w, 'lion', 0, x + 1.5, y + 0.5);
  l.hp = 1;
  applyDamage(w, l, { attacks: [[12, 2]], minDmg: 1 }, v, 1);
  ok(v.order && v.order.defend && v.order.resume === job, 'villager keeps its job to resume');
  run(w, 200, () => l.dead);
  ok(l.dead, 'villager kills the lion');
  run(w, 2000, () => v.order === job); // (after cutting up the carcass)
  ok(v.order === job || dist(v.x, v.y, x + 6.5, y + 6.5) < 1, 'villager goes back to its job');
}

// ---- determinism with animals about
{
  const play = () => {
    const { w, x, y } = setup(23);
    for (let i = 0; i < 6; i++) unit(w, 'gazelle', 0, x + (i % 3) * 1.3, y + Math.floor(i / 3) * 1.7);
    unit(w, 'lion', 0, x + 5, y + 5);
    const v = unit(w, 'villager', 1, x - 2, y);
    setOrder(w, v, { type: 'move', x: x + 4, y: y + 1 });
    run(w, 600);
    return w.hash();
  };
  ok(play() === play(), 'animal behaviour is deterministic');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
