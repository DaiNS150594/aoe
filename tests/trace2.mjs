// Trace a villager doing a given task after N ticks (prints state changes only).
import { World } from '../public/src/engine/world.js';
const [civ = 'shang', seed = '777', startTick = '4800', len = '300', kind = 'hunt'] = process.argv.slice(2);
const w = new World({
  seed: Number(seed), mapSize: 'large', rules: 'd3kt',
  players: [{ id: 1, name: 'A', civ, ai: 'hard' }, { id: 2, name: 'B', civ: 'shang', ai: 'hard' }],
});
for (let i = 0; i < Number(startTick); i++) w.step();
const p = w.players[1];
const u = [...p.units].find((x) => x.order && x.order.type === 'gather' && x.order.kind === kind);
if (!u) { console.log('none'); process.exit(); }
console.log('start', w.starts[1]);
let lastLine = '';
for (let i = 0; i < Number(len); i++) {
  w.step();
  if (u.dead) { console.log('dead'); break; }
  const o = u.order;
  const t = o && o.target ? w.entities.get(o.target) : null;
  const tgt = t ? `${t.type}#${t.id}@${t.x.toFixed(0)},${t.y.toFixed(0)}` : 'none';
  const path = u.path ? u.path.length - u.pathI : u.pathWait ? 'wait' : '-';
  const line = `${u.anim} ${o ? o.type + '/' + o.kind : '-'} ph=${u.gphase} tgt=${tgt} drop=${u.dropId} path=${path}`;
  if (line !== lastLine) console.log(w.tick, `(${u.x.toFixed(1)},${u.y.toFixed(1)}) carry=${u.carry.toFixed(1)}`, line);
  lastLine = line;
}
