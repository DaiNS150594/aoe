// Gameplay rule tests (node tests/rules.test.mjs)
import { World } from '../public/src/engine/world.js';
import { computeDamage, applyDamage, minDamage } from '../public/src/engine/combat.js';
import { displayStats } from '../public/src/engine/player.js';
import { applyTech } from '../public/src/engine/production.js';
import { setOrder, conversionResist } from '../public/src/engine/behavior.js';

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; } else { fail++; console.log('FAIL:', name); } }
function eq(a, b, name) { ok(Math.abs(a - b) < 1e-6, `${name} (got ${a}, want ${b})`); }

function mk(rules = 'd3kt', extra = {}, civ1 = 'greek') {
  const w = new World({ seed: 7, mapSize: 'small', rules, players: [{ id: 1, name: 'A', civ: civ1 }, { id: 2, name: 'B', civ: 'shang' }], ...extra });
  return w;
}
const run = (w, ticks) => { for (let i = 0; i < ticks; i++) w.step(); };
const msgs = (w) => w.events.filter((e) => e.t === 'msg').map((e) => e.text);
const tcOf = (w, pid) => [...w.players[pid].buildings].find((b) => b.type === 'town_center');
// nearest spot where player pid could place a building of this type (maps differ per seed)
function freeSpot(w, pid, type, x, y) {
  for (let r = 0; r < 30; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
    if (!w.placementError(w.players[pid], type, tx, ty)) return { tx, ty };
  }
  return { tx: Math.floor(x), ty: Math.floor(y) };
}

// ---- starting conditions (AoE1 RoR default)
{
  const w = mk();
  const p = w.players[1];
  eq(p.res.food, 200, 'start food'); eq(p.res.wood, 200, 'start wood'); eq(p.res.gold, 0, 'start gold'); eq(p.res.stone, 150, 'start stone');
  ok([...p.units].filter((u) => u.type === 'villager').length === 3, '3 starting villagers');
  ok(p.popCap === 4, 'TC gives 4 population');
  ok(w.players[2].unitStats('villager').cost.food === 35, 'Shang villagers cost 35 food (RoR 1.0)');
}

// ---- damage formula (reverse-engineered from the 1998 executable)
{
  const w = mk();
  const p2 = w.players[2];
  const archer = w.spawnUnit('bowman', 1, 20, 20);
  const club = w.spawnUnit('clubman', 2, 21, 20);
  eq(computeDamage(archer.stats, club, 1), 3, 'bowman 3 pierce vs clubman (0 pierce armor)');
  eq(computeDamage(archer.stats, club, 1.5), 4.5, 'ranged downhill x1.5');
  const hop = w.spawnUnit('hoplite', 2, 22, 20);
  eq(computeDamage(club.stats, hop, 1), 0, 'clubman 3 vs hoplite armor 5: no damage from the formula');
  const hit = (src, t, k = 1) => { const h0 = t.hp; applyDamage(w, src, { attacks: src.stats.attacks, minDmg: minDamage(src.stats, t) }, t, k); return h0 - t.hp; };
  eq(hit(club, hop), 1, 'but every hit takes at least 1 hit point');
  eq(hit(club, hop, 2 / 3), 1, 'melee uphill still loses 1');
  const house = [...p2.buildings].find((b) => b.type === 'town_center');
  eq(computeDamage(club.stats, house, 1), 3, 'buildings take full damage (clubman 3 vs town centre)');
  const st = w.spawnUnit('stone_thrower', 1, 23, 20);
  eq(computeDamage(st.stats, house, 1), 190, 'stone thrower vs building 50 + 140 (armor class 6: -140)');
  const cav = w.spawnUnit('cavalry', 1, 24, 20);
  eq(computeDamage(cav.stats, club, 1), 13, 'cavalry 8 +5 vs infantry (armor class 9: -5)');
  const camel = w.spawnUnit('camel', 2, 25, 20);
  eq(computeDamage(camel.stats, cav, 1), 14, 'camel 6 +8 vs horses (armor class 8: -8)');
  const chariot = w.spawnUnit('chariot', 1, 26, 20);
  eq(computeDamage(camel.stats, chariot, 1), 10, 'camel 6 +4 vs chariots');
  const pr = w.spawnUnit('priest', 2, 27, 20);
  eq(computeDamage(chariot.stats, pr, 1), 14, 'chariot 7 +7 vs priests');
  const sl = w.spawnUnit('slinger', 2, 28, 20);
  eq(computeDamage(sl.stats, archer, 1), 4, 'slinger 2 +2 vs archers');
  // archers lose only 0.1 per hit against armored units
  for (const t of ['bronze_shield', 'iron_shield', 'tower_shield']) applyTech(w, p2, t, true);
  const hop2 = w.spawnUnit('hoplite', 2, 29, 20);
  eq(hit(archer, hop2), 0.1, 'bowman vs hoplite with 3 pierce armor: 0.1 per arrow');
}

// ---- villagers vs towers (Siegecraft), slingers vs towers
{
  const w = mk('free');
  const p = w.players[1];
  applyTech(w, p, 'tool_age', true); applyTech(w, p, 'watch_tower_tech', true);
  const tower = w.spawnBuilding('watch_tower', 1, 40, 40, true);
  const v = w.spawnUnit('villager', 2, 39, 40);
  eq(computeDamage(v.stats, tower, 1), 3, 'villager 3 vs watch tower');
  const sl = w.spawnUnit('slinger', 2, 39, 41);
  eq(computeDamage(sl.stats, tower, 1), 7, 'slinger +7 vs towers, pierce 2 vs 3 armor');
  for (const t of ['tool_age', 'stone_mining', 'bronze_age', 'iron_age', 'siegecraft']) applyTech(w, w.players[2], t, true);
  eq(computeDamage(v.stats, tower, 1), 43, 'Siegecraft: villager 3 + 40 vs towers');
}

// ---- elevation multiplier through real combat
{
  const w = mk();
  // find a hill tile next to a lower tile
  let hi = null, lo = null;
  const m = w.map;
  for (let y = 2; y < m.h - 2 && !hi; y++) for (let x = 2; x < m.w - 6 && !hi; x++) {
    if (m.elevAt(x + 0.5, y + 0.5) >= 2 && m.elevAt(x + 4.5, y + 0.5) <= m.elevAt(x + 0.5, y + 0.5) - 1 && m.passable(x, y) && m.passable(x + 4, y)) { hi = [x + 0.5, y + 0.5]; lo = [x + 4.5, y + 0.5]; }
  }
  if (hi) {
    const a = w.spawnUnit('bowman', 1, hi[0], hi[1]);
    const t = w.spawnUnit('villager', 2, lo[0], lo[1]);
    const hp0 = t.hp;
    setOrder(w, a, { type: 'attack', target: t.id });
    let dealt = 0;
    for (let i = 0; i < 60 && !dealt; i++) { w.step(); dealt = hp0 - t.hp; }
    ok(Math.abs(dealt - 4.5) < 1e-6, `archer shooting downhill deals 4.5 per arrow (first hit ${dealt})`);
  } else ok(true, 'no hill found (skipped)');
}

// ---- D3KT rules
{
  const w = mk('d3kt');
  const p = w.players[1];
  applyTech(w, p, 'tool_age', true);
  p.res = { food: 5000, wood: 5000, gold: 5000, stone: 5000 };
  const st = w.spawnBuilding('stable', 1, 30, 30, true);
  w.applyCommand(1, { type: 'train', bid: st.id, utype: 'scout', n: 1 });
  ok(st.queue.length === 1, 'D3KT: first military unit allowed in Tool Age');
  w.applyCommand(1, { type: 'train', bid: st.id, utype: 'scout', n: 1 });
  ok(st.queue.reduce((a, q) => a + q.n, 0) === 1, 'D3KT: second military unit refused before Bronze Age');
  w.events = [];
  applyTech(w, p, 'watch_tower_tech', true);
  w.applyCommand(1, { type: 'build', btype: 'watch_tower', ...freeSpot(w, 1, 'watch_tower', 40, 40), ids: [] });
  ok(![...p.buildings].some((b) => b.type === 'watch_tower'), 'D3KT: towers (chòi) are banned');
  ok(msgs(w).some((t) => /Chòi/.test(t)), 'D3KT: tower ban message');
  // villager vs villager before bronze
  const v = [...p.units].find((u) => u.type === 'villager');
  const ev = [...w.players[2].units].find((u) => u.type === 'villager');
  w.events = [];
  w.applyCommand(1, { type: 'attack', ids: [v.id], target: ev.id });
  ok(!v.order || v.order.type !== 'attack', 'D3KT: villager cannot attack enemy villager before Bronze');
  // after Bronze: unlimited
  applyTech(w, p, 'bronze_age', true);
  w.applyCommand(1, { type: 'train', bid: st.id, utype: 'scout', n: 3 });
  ok(st.queue.reduce((a, q) => a + q.n, 0) === 4, 'D3KT: free military after Bronze Age');
}
{
  const w = mk('free');
  const p = w.players[1];
  applyTech(w, p, 'tool_age', true); applyTech(w, p, 'watch_tower_tech', true);
  p.res.stone = 1000;
  w.applyCommand(1, { type: 'build', btype: 'watch_tower', ...freeSpot(w, 1, 'watch_tower', 40, 40), ids: [] });
  ok([...p.buildings].some((b) => b.type === 'watch_tower'), 'Free rules: towers allowed');
}
{
  const w = mk('cungr', {}, 'shang');
  const p = w.players[1];
  applyTech(w, p, 'tool_age', true);
  p.res = { food: 5000, wood: 5000, gold: 5000, stone: 5000 };
  const ar = w.spawnBuilding('archery_range', 1, 30, 30, true);
  w.applyCommand(1, { type: 'train', bid: ar.id, utype: 'bowman', n: 1 });
  ok(ar.queue.length === 0, 'Cung R: no bowman (Cung T) in Tool Age');
  applyTech(w, p, 'bronze_age', true); applyTech(w, p, 'wheel', true);
  w.applyCommand(1, { type: 'train', bid: ar.id, utype: 'chariot_archer', n: 2 });
  ok(ar.queue.length === 1 && ar.queue[0].n === 2, 'Cung R: chariot archers in Bronze Age');
  const ar2 = w.spawnBuilding('archery_range', 1, 34, 30, true);
  w.applyCommand(1, { type: 'train', bid: ar2.id, utype: 'bowman', n: 1 });
  ok(ar2.queue.length === 0, 'Cung R: only Cung R in Bronze Age before minute 25');
}

// ---- age requirements & upgrades
{
  const w = mk();
  const p = w.players[1];
  p.res.food = 2000;
  const tc = tcOf(w, 1);
  w.applyCommand(1, { type: 'research', bid: tc.id, tech: 'tool_age' });
  ok(!tc.research, 'Tool Age needs 2 Stone Age buildings');
  w.spawnBuilding('granary', 1, 20, 40, true); w.spawnBuilding('storage_pit', 1, 25, 40, true);
  w.applyCommand(1, { type: 'research', bid: tc.id, tech: 'tool_age' });
  ok(tc.research && tc.research.tech === 'tool_age', 'Tool Age research starts with granary + storage pit');
  eq(p.res.food, 1500, 'Tool Age costs 500 food');
  run(w, 1201);
  ok(p.age === 1, 'Tool Age after 120 game seconds');
  const club = w.spawnUnit('clubman', 1, 30, 30);
  applyTech(w, p, 'battle_axe');
  ok(club.type === 'axeman' && displayStats(club.stats).atk === 5, 'Battle Axe upgrades existing clubmen to axemen');
}

// ---- the original technology tree
{
  const w = mk();
  const p = w.players[1];
  p.res = { food: 9000, wood: 9000, gold: 9000, stone: 9000 };
  ok(!p.buildingEnabled('market'), 'no market in the Stone Age');
  w.spawnBuilding('granary', 1, 20, 40, true);
  applyTech(w, p, 'tool_age', true);
  ok(p.buildingEnabled('market'), 'Granary + Tool Age unlock the market');
  ok(!p.buildingEnabled('town_center'), 'a second town centre needs a government centre');
  applyTech(w, p, 'bronze_age', true);
  w.spawnBuilding('market', 1, 30, 40, true);
  ok(p.buildingEnabled('government_center'), 'Market + Bronze Age unlock the government centre');
  w.spawnBuilding('government_center', 1, 30, 50, true);
  ok(p.buildingEnabled('town_center'), 'government centre unlocks more town centres');
  eq(p.unitStats('villager').speed, 1.1, 'villager speed 1.1');
  applyTech(w, p, 'wheel', true);
  eq(p.unitStats('villager').speed, 1.8, 'Wheel: villager speed +0.7');
  eq(p.workRate('wood'), 0.55, 'woodcutters gather 0.55 wood/s');
  applyTech(w, p, 'woodworking', true);
  eq(p.workRate('wood'), 0.75, 'Woodworking: +0.2');
  eq(p.carryCap('wood'), 12, 'Woodworking: carry +2');
  applyTech(w, p, 'logistics', true);
  eq(p.unitStats('clubman').pop, 0.5, 'Logistics: infantry count as half a unit');
}
{
  const civ = (id) => mk('free', {}, id).players[1];
  eq(civ('egyptian').workRate('gold'), 0.65, 'Egyptian gold miners +0.2');
  eq(civ('assyrian').unitStats('bowman').rof, 1.1, 'Assyrian archers reload in 1.1 s');
  eq(civ('hittite').unitStats('ballista').hp, 110, 'Hittite siege weapons x2 hp (ballista too)');
  eq(civ('roman').buildingStats('house').cost.wood, 25, 'Roman buildings 15% cheaper (30 -> 25)');
  eq(civ('palmyran').unitStats('villager').cost.food, 75, 'Palmyran villagers cost 75 food');
  eq(civ('palmyran').unitStats('villager').defArmor, 1, 'Palmyran villagers +1 default armor');
  eq(civ('sumerian').farmFood, 500, 'Sumerian farms 250 + 250 food');
  eq(civ('babylonian').buildingStats('small_wall').hp, 400, 'Babylonian walls x2 hp');
  eq(civ('sumerian').unitStats('ballista').rof, 3.5, 'Sumerian siege reload set to 3.5 s (ballistas slower)');
  ok(civ('greek').techDisabled('broad_sword'), 'Greek: no Broad Sword');
  ok(civ('persian').unitDisabled('hoplite') || civ('persian').buildingDisabled('academy'), 'Persian: no hoplites');
}

// ---- population & houses
{
  const w = mk();
  const p = w.players[1];
  const v = [...p.units][0];
  w.applyCommand(1, { type: 'build', btype: 'house', ...freeSpot(w, 1, 'house', v.x + 2, v.y + 2), ids: [v.id] });
  const h = [...p.buildings].find((b) => b.type === 'house');
  ok(!!h && !h.built, 'house foundation placed');
  eq(p.res.wood, 170, 'house costs 30 wood');
  run(w, 400);
  ok(h.built && p.popCap === 8, 'house adds 4 population when built');
}

// ---- building, repairing, converting (actions reverse-engineered from empires.exe)
{
  const w = mk();
  const p = w.players[1];
  p.res.wood = 1000;
  const vs = [...p.units].filter((u) => u.type === 'villager');
  const sp = freeSpot(w, 1, 'house', vs[0].x + 3, vs[0].y + 3);
  w.applyCommand(1, { type: 'build', btype: 'house', ...sp, ids: [vs[0].id, vs[1].id] });
  const h = [...p.buildings].find((b) => b.type === 'house');
  let t = 0;
  // walk there, then count the seconds of building
  while (!h.built && t < 2000) { const before = h.progress; w.step(); t++; if (h.progress === before && !h.built) t--; }
  ok(h.built, 'two villagers finish a house');
  eq(p.buildRate(), 1, 'a builder adds one second of construction per second');
  eq(p.repairRate(3), 0.3, 'repairing buildings: 0.75 x work rate 0.4');
  // repair: 1.125 hp/s on a house (0.3 x 75 hp / 20 s), half its cost for full hit points
  h.hp = 15;
  const v = vs[0];
  w.applyCommand(1, { type: 'repair', ids: [v.id], target: h.id });
  const wood0 = p.res.wood;
  for (let i = 0; i < 1200 && h.hp < h.stats.hp - 1e-6; i++) w.step();
  ok(h.hp >= h.stats.hp - 1e-6, 'house repaired');
  eq(Math.round((wood0 - p.res.wood) * 100) / 100, 12, 'repairing 60 of 75 hp costs 60/150 of 30 wood');
  // conversion resistance
  const pr = w.spawnUnit('priest', 2, 30, 30);
  const ch = w.spawnUnit('chariot', 1, 31, 30);
  const hop = w.spawnUnit('hoplite', 1, 32, 30);
  const pri = w.spawnUnit('priest', 1, 33, 30);
  ok(conversionResist(w, ch) === 8 && conversionResist(w, hop) === 1 && conversionResist(w, pri) === 2, 'chariots x8, priests x2, others x1 against conversion');
  const wm = mk('d3kt', {}, 'macedonian');
  ok(conversionResist(wm, wm.spawnUnit('chariot', 1, 30, 30)) === 4, 'Macedonian units x4 (also chariots)');
}

// ---- tribute
{
  const w = mk();
  const p = w.players[1];
  p.res.gold = 1000;
  w.applyCommand(1, { type: 'tribute', to: 2, res: 'gold', amount: 100 });
  eq(p.res.gold, 1000, 'tribute needs a market');
  w.spawnBuilding('market', 1, 20, 40, true);
  w.applyCommand(1, { type: 'tribute', to: 2, res: 'gold', amount: 100 });
  eq(p.res.gold, 875, 'tribute has a 25% tax (Rise of Rome)');
  eq(w.players[2].res.gold, 100, 'recipient gets the tribute');
}

// ---- conversion
{
  const w = mk('free');
  const p = w.players[1];
  applyTech(w, p, 'tool_age', true); applyTech(w, p, 'bronze_age', true);
  const pr = w.spawnUnit('priest', 1, 30, 30);
  const t = w.spawnUnit('axeman', 2, 34, 30);
  setOrder(w, t, null);
  w.applyCommand(1, { type: 'convert', ids: [pr.id], target: t.id });
  let converted = false;
  for (let i = 0; i < 1200 && !converted; i++) { w.step(); if (t.owner === 1) converted = true; t.order = null; }
  ok(converted, 'priest converts an axeman (wololo)');
  ok(pr.faith < 100, 'priest faith resets after conversion');
}

// ---- carcass hunting: killing a gazelle with a villager gives food
{
  const w = mk();
  const p = w.players[1];
  const v = [...p.units][0];
  const g = w.spawnUnit('gazelle', 0, v.x + 3, v.y);
  w.applyCommand(1, { type: 'gather', ids: [v.id], target: g.id });
  run(w, 600);
  ok(g.dead, 'gazelle hunted');
  ok(p.stats.gathered.food > 0 || v.carry > 0, 'hunter collects meat from the carcass');
}

// ---- walls (free rules), cheats, resign / victory
{
  const w = mk('free', { cheats: true });
  const p = w.players[1];
  applyTech(w, p, 'tool_age', true); applyTech(w, p, 'small_wall_tech', true);
  const v = [...p.units][0];
  const x0 = Math.floor(v.x) + 3, y0 = Math.floor(v.y) + 3;
  w.applyCommand(1, { type: 'buildWall', ids: [v.id], x0, y0, x1: x0 + 4, y1: y0 });
  ok([...p.buildings].filter((b) => b.type === 'small_wall').length >= 3, 'Free rules: a wall line is placed');
  const f0 = p.res.food;
  w.applyCommand(1, { type: 'cheat', code: 'pepperoni pizza' });
  eq(p.res.food, f0 + 1000, 'cheat pepperoni pizza +1000 food');
  w.applyCommand(1, { type: 'cheat', code: 'photon man' });
  ok([...p.units].some((u) => u.type === 'photon_man'), 'cheat photon man spawns a laser trooper');
  w.applyCommand(2, { type: 'resign' });
  run(w, 12);
  ok(w.over && w.winners && w.winners[0] === 1, 'resign ends the game, the other player wins');
}
{
  const w = mk('d3kt', { cheats: false });
  const p = w.players[1];
  const f0 = p.res.food;
  w.applyCommand(1, { type: 'cheat', code: 'pepperoni pizza' });
  eq(p.res.food, f0, 'cheats ignored when disabled in the lobby');
}

// ---- determinism of a scripted game: same commands -> same hash
{
  const script = (w) => {
    const v = [...w.players[1].units].map((u) => u.id);
    w.applyCommand(1, { type: 'move', ids: v, x: 30, y: 30 });
    run(w, 200);
    w.applyCommand(1, { type: 'gather', ids: v.slice(0, 2), target: w.list.find((e) => e.type === 'tree').id });
    run(w, 600);
    return w.hash();
  };
  ok(script(mk()) === script(mk()), 'same commands give identical state hash');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
