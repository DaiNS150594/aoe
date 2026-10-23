// Debug helper: run a short game and dump villager states.
import { World } from '../public/src/engine/world.js';

const w = new World({
  seed: 12345, mapSize: 'large', rules: 'd3kt',
  players: [{ id: 1, name: 'A', civ: 'shang', ai: 'hard' }, { id: 2, name: 'B', civ: 'yamato', ai: 'hard' }],
});
const ticks = Number(process.argv[2] || 300);
const every = Number(process.argv[3] || 50);
for (let i = 0; i < ticks; i++) {
  w.step();
  for (const ev of w.events) if (ev.t === 'msg' && (ev.p === 1 || ev.p === -1)) console.log('  MSG', w.tick, ev.text);
  if (w.tick % every === 0) {
    const p = w.players[1];
    console.log(`tick ${w.tick} res F${p.res.food.toFixed(1)} W${p.res.wood.toFixed(1)} pop ${p.pop}/${p.popCap} training=${p.training}`);
    for (const u of p.units) {
      const o = u.order;
      console.log(`   #${u.id} ${u.type} (${u.x.toFixed(2)},${u.y.toFixed(2)}) anim=${u.anim} order=${o ? o.type + ':' + (o.target || '') + ':' + (o.kind || '') : '-'} phase=${u.gphase} carry=${u.carry.toFixed(2)} path=${u.path ? u.pathI + '/' + u.path.length : u.pathWait ? 'wait' : 'none'} fails=${u.fails}`);
    }
    for (const b of p.buildings) console.log(`   B#${b.id} ${b.type} built=${b.built} prog=${b.progress.toFixed(2)} hp=${b.hp.toFixed(0)} q=${JSON.stringify(b.queue.map((q) => q.type + 'x' + q.n))} training=${b.training}`);
  }
}
