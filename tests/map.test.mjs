// Random map tests (node tests/map.test.mjs): the port of the original
// generator — valid elevation (every tile drawable by the slope tiles),
// cliffs from the piece table, town centres, the map script's resources, and
// determinism.
import { generateRMS, slopeType, CLIFF_PIECES, MsRand } from '../public/src/engine/rms.js';
import { generateMap } from '../public/src/engine/mapgen.js';
import { TERRAIN_PASSABLE } from '../public/src/engine/map.js';
import { slopeFrame } from '../public/src/render/terrain.js';

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('FAIL:', name); } }

// MSVC rand(): the first values for seed 1 are well known
{
  const R = new MsRand(1);
  ok([R.rand(), R.rand(), R.rand()].join(',') === '41,18467,6334', 'MSVC rand() sequence (41, 18467, 6334)');
}

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
const RAISED = { 1: 'b', 2: 't', 3: 'l', 4: 'r', 9: 'b', 10: 't', 11: 'l', 12: 'r', 5: 'bl', 6: 'tl', 7: 'rb', 8: 'tr', 13: 'rbl', 14: 'trl', 15: 'trb', 16: 'tbl' };

for (const [size, n, seed] of [[144, 4, 3], [96, 2, 11], [200, 6, 99], [250, 8, 7]]) {
  const G = generateRMS({ size, players: players(n), seed });
  const { W, H } = G;
  const E = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : G.elev[y * W + x]);
  // every tile's slope shape agrees with its corners (corner = highest tile touching it)
  let bad = 0, steep = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const e = E(x, y), nb = (dx, dy) => { const v = E(x + dx, y + dy); return v === null ? e : v; };
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) { const v = E(x + dx, y + dy); if (v !== null && Math.abs(v - e) > 1) steep++; }
      const t = slopeType(e, nb(0, -1), nb(1, 0), nb(-1, 0), nb(0, 1), nb(1, -1), nb(-1, 1), nb(-1, -1), nb(1, 1));
      // corners in screen terms: top (X, Y-1)+(X+1, Y)+(X+1, Y-1), right (X+1, Y)+(X, Y+1)+(X+1, Y+1),
      // bottom (X, Y+1)+(X-1, Y)+(X-1, Y+1), left (X-1, Y)+(X, Y-1)+(X-1, Y-1)
      const c = (a, b, d) => Math.max(e, nb(...a), nb(...b), nb(...d)) > e;
      const got = (c([0, -1], [1, 0], [1, -1]) ? 't' : '') + (c([1, 0], [0, 1], [1, 1]) ? 'r' : '') + (c([0, 1], [-1, 0], [-1, 1]) ? 'b' : '') + (c([-1, 0], [0, -1], [-1, -1]) ? 'l' : '');
      const want = t === 0 ? '' : RAISED[t];
      if (got !== want) bad++;
    }
  }
  ok(steep === 0, `${size}: neighbouring tiles differ by at most one level (${steep})`);
  ok(bad === 0, `${size}: slope shapes match the corner heights (${bad} tiles)`);
  // one town centre and three villagers per player, lands apart
  const tcs = G.objects.filter((o) => o.unit === 109);
  ok(tcs.length === n, `${size}: ${n} town centres (${tcs.length})`);
  ok(G.objects.filter((o) => o.unit === 83).length === 3 * n, `${size}: 3 villagers each`);
  let minD = 1e9;
  for (let i = 0; i < tcs.length; i++) for (let j = i + 1; j < tcs.length; j++) minD = Math.min(minD, Math.hypot(tcs[i].x - tcs[j].x, tcs[i].y - tcs[j].y));
  ok(minD > (W - 20) / Math.sqrt(n) * 0.75, `${size}: town centres far apart (${minD.toFixed(1)})`);
  // the map script's resources near each player
  for (const tc of tcs) {
    const near = (u, r) => G.objects.filter((o) => o.unit === u && Math.max(Math.abs(o.x - tc.x), Math.abs(o.y - tc.y)) <= r).length;
    ok(near(66, 36) >= 12, `${size}: gold near player (${near(66, 36)})`);
    ok(near(102, 36) >= 10, `${size}: stone near player (${near(102, 36)})`);
    ok(near(59, 18) >= 5, `${size}: berries near player (${near(59, 18)})`);
  }
  // cliffs: table pieces, never near a town centre
  for (const c of G.cliffs) {
    ok(CLIFF_PIECES.some((p) => (p[1] === c.unit && p[2] === c.facet) || (p[3] === c.unit && p[4] === c.facet)), `${size}: cliff piece ${c.unit}/${c.facet} from the table`);
    for (const tc of tcs) ok(Math.max(Math.abs(c.x - tc.x), Math.abs(c.y - tc.y)) > 10, `${size}: cliff away from town centres`);
  }
  // forests have their trees
  const forestTiles = [...G.terrain].filter((t) => t === 10 || t === 19 || t === 20 || t === 13).length;
  const trees = G.objects.filter((o) => [113, 114, 121, 129, 142, 143, 147, 161, 195, 198, 203, 226, 365, 366, 367, 391, 392, 393].includes(o.unit)).length;
  ok(forestTiles > 0 && trees >= forestTiles * 0.9, `${size}: a tree on (nearly) every forest tile (${trees}/${forestTiles})`);
}

// cliffs on most Hill Country maps (75%), none on some
{
  let withCliffs = 0;
  for (let s = 1; s <= 12; s++) if (generateRMS({ size: 144, players: players(4), seed: s }).cliffs.length) withCliffs++;
  ok(withCliffs >= 6 && withCliffs <= 12, `cliffs on most maps (${withCliffs}/12)`);
}

// the game map: rotated into our coordinates, cliffs impassable, deterministic
{
  const settings = { seed: 3, mapSize: 'large', mapType: 'hill_country', players: [{ id: 1, team: 0 }, { id: 2, team: 0 }, { id: 3, team: 0 }, { id: 4, team: 0 }] };
  const a = generateMap(settings), b = generateMap(settings);
  ok(a.map.terrain.every((t, i) => t === b.map.terrain[i]) && a.objects.length === b.objects.length, 'same seed, same map');
  const m = a.map;
  ok(Object.keys(a.starts).length === 4, 'a start for every player');
  ok([...m.terrain].filter((t) => t === 16).every(() => !TERRAIN_PASSABLE[16]), 'cliff lines are impassable');
  // every slope tile of the game map has a picture (no saddles)
  let missing = 0;
  for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) {
    const t = m.cornerH(tx, ty), r = m.cornerH(tx + 1, ty), bb = m.cornerH(tx + 1, ty + 1), l = m.cornerH(tx, ty + 1);
    if (Math.max(t, r, bb, l) > Math.min(t, r, bb, l) && slopeFrame(t, r, bb, l) < 0) missing++;
  }
  ok(missing === 0, `every sloped tile has an original tile picture (${missing} missing)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
