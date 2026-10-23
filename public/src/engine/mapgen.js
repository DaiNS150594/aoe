// Random maps: "Hill Country" (and a hilly "Highland" without its rivers),
// built by the port of the original generator (rms.js) and converted into
// this game's map: our tile (tx, ty) is the original's (X = W-1-ty, Y = tx),
// so the same screen picture comes out (our x grows to the lower right, y to
// the lower left; the original's Y to the lower right, X to the upper right).
import { RNG } from './rng.js';
import { GameMap } from './map.js';
import { MAP_SIZES } from './constants.js';
import { generateRMS } from './rms.js';
import { ORIGINAL_MAP_UNITS } from './data/original-map.js';
import { dist } from './dmath.js';

const RESOURCE_OF = { 66: 'gold_mine', 102: 'stone_mine', 59: 'berry_bush' };
const ANIMAL_OF = { 48: 'elephant_wild', 65: 'gazelle', 126: 'lion', 1: 'alligator' };

export function generateMap(settings) {
  const size = (MAP_SIZES[settings.mapSize] || MAP_SIZES.large).tiles;
  const players = settings.players;
  const order = playerOrder(settings);
  const G = generateRMS({
    size, players: order.map((id) => players.find((p) => p.id === id)), seed: settings.seed >>> 0,
    mapType: settings.mapType, groupTeams: settings.teamsTogether !== false && players.some((p) => p.team > 0),
  });
  const W = size;
  const map = new GameMap(size, size);
  // tiles
  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      const a = tx * W + (W - 1 - ty); // original (X = W-1-ty, Y = tx)
      map.terrain[ty * size + tx] = G.terrain[a];
      map.elev[ty * size + tx] = Math.min(7, G.elev[a]);
    }
  }
  map.computeHeights();
  const rng = new RNG((settings.seed ^ 0x5eed) >>> 0);
  for (let i = 0; i < size * size; i++) map.variant[i] = rng.int(8);
  const conv = (x, y) => ({ x: y, y: W - x }); // original position -> ours

  const objects = [];
  const starts = {};
  // cliffs: blocking pieces (their footprint radii swap axes with the rotation)
  for (const c of G.cliffs) {
    const def = ORIGINAL_MAP_UNITS[c.unit];
    const p = conv(c.x, c.y);
    objects.push({ kind: 'cliff', unit: c.unit, facet: c.facet, x: p.x, y: p.y, rx: def ? def.r[1] : 1.5, ry: def ? def.r[0] : 1.5 });
  }
  for (const o of G.objects) {
    const def = ORIGINAL_MAP_UNITS[o.unit];
    if (!def) continue;
    const p = conv(o.x, o.y);
    const tx = Math.min(size - 1, Math.max(0, Math.floor(p.x))), ty = Math.min(size - 1, Math.max(0, Math.floor(p.y)));
    if (o.unit === 109) {
      const btx = Math.round(p.x - 1.5), bty = Math.round(p.y - 1.5);
      objects.push({ kind: 'building', type: 'town_center', owner: o.owner, tx: btx, ty: bty, built: true });
      if (o.owner) starts[o.owner] = { x: btx + 1, y: bty + 1 };
    } else if (o.unit === 83) {
      objects.push({ kind: 'unit', type: 'villager', owner: o.owner, x: p.x, y: p.y });
    } else if (RESOURCE_OF[o.unit]) {
      objects.push({ kind: 'resource', type: RESOURCE_OF[o.unit], tx, ty, amount: def.store ? def.store[0][1] : 100, dat: o.unit });
    } else if (ANIMAL_OF[o.unit]) {
      objects.push({ kind: 'unit', type: ANIMAL_OF[o.unit], owner: 0, x: p.x, y: p.y });
    } else if (def.cls === 15) {
      const wood = def.store ? def.store[0][1] : 40;
      objects.push({ kind: 'resource', type: 'tree', tx, ty, amount: wood, dat: o.unit, variant: o.unit % 6, straggler: wood > 40, ox: p.x - tx - 0.5, oy: p.y - ty - 0.5 });
    } else if (def.cls === 14 && def.type === 10) {
      map.decor.push({ u: o.unit, x: p.x, y: p.y });
    } else if (def.cls === 10) {
      map.birds.push({ u: o.unit, x: p.x, y: p.y }); // pigeons: scenery flying over the map
    }
  }
  // a player without a town centre (should not happen): start at the land
  order.forEach((pid, i) => {
    if (starts[pid]) return;
    const l = G.lands[i];
    if (l) starts[pid] = { x: l.y, y: W - 1 - l.x };
  });
  map.decor.sort((a, b) => (a.x + a.y) - (b.x + b.y));
  return { map, starts, objects };
}

// Which player gets which land: the original hands them out in order; with
// "teams together" the players are ordered by team here and the lands by
// angle around the map centre (rms.js), so team mates are neighbours.
function playerOrder(settings) {
  const players = settings.players;
  const rng = new RNG((settings.seed ^ 0x48c0ffee) >>> 0);
  let order = rng.shuffle(players.map((p) => p.id));
  if (settings.teamsTogether !== false) order.sort((a, b) => teamKey(players, a) - teamKey(players, b));
  return order;
}
function teamKey(players, id) {
  const p = players.find((q) => q.id === id);
  return p && p.team > 0 ? p.team : 10 + id;
}
export { dist };
