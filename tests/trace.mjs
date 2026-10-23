// Trace one unit tick by tick.
import { World } from '../public/src/engine/world.js';

const w = new World({
  seed: 12345, mapSize: 'large', rules: 'd3kt',
  players: [{ id: 1, name: 'A', civ: 'shang', ai: 'hard' }, { id: 2, name: 'B', civ: 'yamato', ai: 'hard' }],
});
const id = Number(process.argv[2] || 4);
const from = Number(process.argv[3] || 90), to = Number(process.argv[4] || 140);
for (let i = 0; i < to; i++) {
  w.step();
  if (w.tick >= from) {
    const u = w.entities.get(id);
    if (!u) { console.log('gone'); break; }
    const o = u.order;
    const t = o && o.target ? w.entities.get(o.target) : null;
    console.log(`${w.tick} (${u.x.toFixed(3)},${u.y.toFixed(3)}) ${u.anim} ${o ? o.type : '-'} ph=${u.gphase} carry=${u.carry.toFixed(2)} path=${u.path ? JSON.stringify(u.path.slice(u.pathI).map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)])) : u.pathWait ? 'wait' : 'none'} fails=${u.fails} goal=${u.goal ? JSON.stringify(u.goal) : '-'} edge=${t ? w.edgeDist(u, t).toFixed(3) : '-'} tgt=${t ? t.type + '@' + t.tx + ',' + t.ty : '-'}`);
  }
}
