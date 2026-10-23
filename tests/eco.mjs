// Economy diagnostics: villager task distribution & gathered totals per minute.
import { World } from '../public/src/engine/world.js';

const civ = process.argv[2] || 'yamato';
const mins = Number(process.argv[3] || 12);
const w = new World({
  seed: Number(process.argv[4] || 12345), mapSize: 'large', rules: 'd3kt',
  players: [{ id: 1, name: 'A', civ, ai: process.argv[5] || 'hardest' }, { id: 2, name: 'B', civ: 'shang', ai: 'hard' }],
});
const p = w.players[1];
const food0 = { forage: 0, hunt: 0 };
for (let m = 1; m <= mins; m++) {
  for (let i = 0; i < 600; i++) w.step();
  const tasks = {};
  let idle = 0, walking = 0;
  for (const u of p.units) {
    if (u.type !== 'villager') continue;
    const k = u.order ? (u.order.type === 'gather' ? u.order.kind + (u.gphase === 'drop' ? '>drop' : '') : u.order.type) : 'IDLE';
    tasks[k] = (tasks[k] || 0) + 1;
    if (!u.order) idle++;
  }
  let berries = 0, gaz = 0, ele = 0;
  for (const e of w.list) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - w.starts[1].x, e.y - w.starts[1].y);
    if (d > 25) continue;
    if (e.type === 'berry_bush') berries += e.amount;
    if (e.type === 'gazelle') gaz++;
    if (e.type === 'elephant_wild') ele++;
  }
  console.log(`${m}min age=${p.age} F${p.res.food | 0} W${p.res.wood | 0} gathered F${p.stats.gathered.food | 0} W${p.stats.gathered.wood | 0} G${p.stats.gathered.gold | 0} near: berries=${berries | 0} gazelles=${gaz} elephants=${ele} tasks=${JSON.stringify(tasks)} blds=${[...p.buildings].map((b) => b.type + (b.built ? '' : '*')).join(',')}`);
}
