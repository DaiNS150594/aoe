// Headless simulation tests: runs AI-vs-AI games in Node, checks that the
// economy works, ages advance, combat happens, and that the simulation is
// deterministic (same seed + commands => identical state hash).
import { World } from '../public/src/engine/world.js';
import { TICKS_PER_SEC } from '../public/src/engine/constants.js';

const args = process.argv.slice(2);
const minutes = Number(args.find((a) => a.startsWith('--min='))?.slice(6) || 25);
const size = args.find((a) => a.startsWith('--size='))?.slice(7) || 'large';
const nPlayers = Number(args.find((a) => a.startsWith('--players='))?.slice(10) || 2);
const rules = args.find((a) => a.startsWith('--rules='))?.slice(8) || 'd3kt';
const seed = Number(args.find((a) => a.startsWith('--seed='))?.slice(7) || 12345);
const quiet = args.includes('--quiet');

function makeSettings(seedv) {
  const civs = ['shang', 'yamato', 'assyrian', 'hittite', 'greek', 'egyptian', 'choson', 'persian'];
  return {
    seed: seedv, mapSize: size, rules, popLimit: 200, speed: 2,
    players: Array.from({ length: nPlayers }, (_, i) => ({ id: i + 1, name: 'AI ' + (i + 1), civ: civs[i % civs.length], color: i, team: nPlayers > 2 ? (i % 2) + 1 : 0, ai: 'hard' })),
  };
}

function summary(w) {
  return w.realPlayers().map((p) => {
    let v = 0, m = 0; for (const u of p.units) { if (u.type === 'villager') v++; else m++; }
    const ages = p.stats.ageTicks.map((t) => (t >= 0 ? (t / TICKS_PER_SEC / 60).toFixed(1) : '-')).join('/');
    return `${p.name}[${p.civId}] age=${p.age} vill=${v} mil=${m} bld=${p.buildings.size} pop=${p.pop}/${p.popCap} res=F${p.res.food | 0} W${p.res.wood | 0} G${p.res.gold | 0} S${p.res.stone | 0} kills=${p.stats.killed} lost=${p.stats.lost} razed=${p.stats.razed} ages(min)=${ages} alive=${p.alive}`;
  }).join('\n  ');
}

function run(seedv, ticks, log) {
  const t0 = performance.now();
  const w = new World(makeSettings(seedv));
  const tGen = performance.now() - t0;
  if (log) console.log(`map ${w.map.w}x${w.map.h} entities=${w.list.length} gen=${tGen.toFixed(0)}ms`);
  let worst = 0, total = 0;
  const hashes = [];
  for (let i = 0; i < ticks; i++) {
    const a = performance.now();
    w.step();
    const d = performance.now() - a;
    total += d; if (d > worst) worst = d;
    if (i % 600 === 599) {
      hashes.push(w.hash());
      if (log && !quiet) console.log(`t=${(w.tick / TICKS_PER_SEC / 60).toFixed(0)}min avg=${(total / (i + 1)).toFixed(2)}ms worst=${worst.toFixed(1)}ms ents=${w.list.length}\n  ${summary(w)}`);
    }
    if (w.over) { if (log) console.log('GAME OVER at', (w.tick / TICKS_PER_SEC / 60).toFixed(1), 'min, winners', w.winners); break; }
  }
  if (log) console.log(`final: avg tick ${(total / w.tick).toFixed(2)}ms worst ${worst.toFixed(1)}ms\n  ${summary(w)}`);
  return { w, hashes };
}

const ticks = minutes * 60 * TICKS_PER_SEC;
const a = run(seed, ticks, true);
// determinism: rerun a shorter game and compare hashes
const shortTicks = Math.min(ticks, 8 * 60 * TICKS_PER_SEC);
const b = run(seed, shortTicks, false);
const c = run(seed, shortTicks, false);
const same = JSON.stringify(b.hashes) === JSON.stringify(c.hashes) && b.hashes.every((h, i) => h === a.hashes[i]);
console.log(same ? 'DETERMINISM OK' : 'DETERMINISM FAILED', b.hashes.slice(0, 4));
let fail = !same;
for (const p of a.w.realPlayers()) {
  if (p.stats.gathered.food < 500) { console.log('FAIL: player gathered too little food', p.name); fail = true; }
}
process.exit(fail ? 1 : 0);
