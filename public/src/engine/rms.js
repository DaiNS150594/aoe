// The Rise of Rome random map generator, ported from empires.exe.
//
// The original runs its generators in this order (their sort keys in
// brackets): land placement [1.0], elevation [1.5], cliffs [1.75], terrain
// [2.0], objects [3.0]. Each one is ported here function by function: the
// clump growers with their priority lists, the elevation clean-up passes, the
// cliff random walk on a 3x3-tile grid with its 20-piece connection table, the
// terrain object densities and the map script object rules (player rings,
// map-wide groups, scattered and clumped groups).
//
// Everything works in the original's tile coordinates: X grows towards the
// screen's upper right, Y towards its lower right, arrays are [Y * W + X].
// mapgen.js converts the result into this game's map. Random numbers come
// from the same generator the original used (MSVC rand()).
import { ORIGINAL_TERRAINS, ORIGINAL_RMS, ORIGINAL_MAP_UNITS } from './data/original-map.js';

const GRASS = 0, DESERT = 6, CLIFF_TERRAIN = 16;
const WATERS = new Set([1, 4, 22]);

// ------------------------------------------------------------------ random
// MSVC rand(): a 15-bit linear congruential generator
export class MsRand {
  constructor(seed) { this.s = seed >>> 0; }
  rand() {
    this.s = (Math.imul(this.s, 214013) + 2531011) >>> 0;
    return (this.s >>> 16) & 0x7fff;
  }
  // rand() * n / 32767 as the original computes it (truncated; can reach n)
  scale(n) { return Math.trunc((this.rand() * n) / 32767); }
}

// ------------------------------------------------------------ clump lists
// One node per tile: a tile is in at most one list at a time and joining a
// list takes it out of the previous one (lazy deletion by version).
class Nodes {
  constructor(n) { this.owner = new Int32Array(n).fill(-1); this.ver = new Uint32Array(n); this.ids = 0; }
  unlink(i) { if (this.owner[i] !== -1) { this.owner[i] = -1; this.ver[i]++; } }
}
// Sorted by priority, lowest first; among equal priorities the newest first
// (the original inserts in front of the first node whose priority is >=).
class PrioList {
  constructor(N) { this.N = N; this.id = N.ids++; this.h = []; this.seq = 0; }
  push(i, prio) {
    const N = this.N;
    N.unlink(i);
    N.owner[i] = this.id;
    const h = this.h, e = { p: prio, s: ++this.seq, i, v: N.ver[i] };
    let k = h.length;
    h.push(e);
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (!less(e, h[up])) break;
      h[k] = h[up]; k = up;
    }
    h[k] = e;
  }
  pop() {
    const N = this.N, h = this.h;
    while (h.length) {
      const top = h[0], last = h.pop();
      if (h.length) {
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k, mv = last;
          if (l < h.length && less(h[l], mv)) { m = l; mv = h[l]; }
          if (r < h.length && less(h[r], mv)) { m = r; mv = h[r]; }
          if (m === k) break;
          h[k] = h[m]; k = m;
        }
        h[k] = last;
      }
      if (N.owner[top.i] === this.id && N.ver[top.i] === top.v) { N.unlink(top.i); return top.i; }
    }
    return -1;
  }
  get empty() {
    const N = this.N;
    for (const e of this.h) if (N.owner[e.i] === this.id && N.ver[e.i] === e.v) return false;
    return true;
  }
  clear() { for (const e of this.h) if (this.N.owner[e.i] === this.id && this.N.ver[e.i] === e.v) this.N.unlink(e.i); this.h = []; }
}
function less(a, b) { return a.p < b.p || (a.p === b.p && a.s > b.s); }

// Seed pool: tiles inserted at the front, taken from the front.
class Pool {
  constructor(N) { this.N = N; this.id = N.ids++; this.a = []; }
  push(i) { const N = this.N; N.unlink(i); N.owner[i] = this.id; this.a.push(i, N.ver[i]); }
  pop() {
    const N = this.N, a = this.a;
    while (a.length) {
      const v = a.pop(), i = a.pop();
      if (N.owner[i] === this.id && N.ver[i] === v) { N.unlink(i); return i; }
    }
    return -1;
  }
  get empty() {
    const N = this.N, a = this.a;
    for (let k = a.length - 2; k >= 0; k -= 2) if (N.owner[a[k]] === this.id && N.ver[a[k]] === a[k + 1]) return false;
    return true;
  }
}

// --------------------------------------------------------------- generate
// settings: { size, players: [{ id, team }], seed, mapType } -> AoE-space map
export function generateRMS({ size, players, seed, mapType = 'hill_country', groupTeams = false }) {
  const script = ORIGINAL_RMS[mapType] || ORIGINAL_RMS.hill_country;
  const W = size, H = size, n = W * H;
  const R = new MsRand(seed);
  const G = {
    W, H, R, script, type: script.type,
    terrain: new Uint8Array(n).fill(script.base === 1 ? GRASS : script.base),
    elev: new Uint8Array(n),
    lands: [], objects: [], decor: [], cliffs: [],
    occ: new Uint8Array(n), // tiles taken by objects that block placement
  };
  const landTiles = Math.trunc((W * H * script.cover) / 100);
  G.landTiles = landTiles;

  // --- set-up (the original's land / terrain / objects / elevation set-up)
  placeLands(G, players);
  // players are given lands in order; for "teams together" the lands are
  // first ordered around the map centre so team mates become neighbours
  if (groupTeams) G.lands.sort((a, b) => diamondAngle(a.x - W / 2, a.y - H / 2) - diamondAngle(b.x - W / 2, b.y - H / 2));
  const terrainParams = terrainSetup(G);
  const elevParams = elevationSetup(G);
  const cliffParams = cliffSetup(G);

  // --- generators in the original's order
  generateElevation(G, elevParams);
  if (cliffParams) generateCliffs(G, cliffParams);
  generateTerrain(G, terrainParams);
  generateObjects(G, players);
  return G;
}

// ------------------------------------------------------------------- lands
// Player lands: random spots at least (W - 2b) / sqrt(n) apart (x0.9 for 4-6
// players, x0.8 for 7-8) outside a box around the centre (0046F300, mode 2).
function placeLands(G, players) {
  const { W, H, R, script } = G;
  const land = script.lands.find((l) => l.byPlayer) || script.lands[0];
  const n = players.length, border = script.border;
  let d = (W - 2 * border) / Math.sqrt(n);
  if (n > 3) d *= n < 7 ? Math.fround(0.9) : Math.fround(0.8);
  const minD2 = Math.fround(d * d);
  const hw = W >> 1, hh = H >> 1;
  let x0 = Math.trunc(hw - d * 0.9), y0 = Math.trunc(hh - d * 0.9);
  let x1 = Math.trunc(hw + d * 0.9), y1 = Math.trunc(hh + d * 0.9);
  if (x0 <= border) x0 = border + 1;
  if (y0 <= border) y0 = border + 1;
  if (x1 >= W - border - 1) x1 = W - border - 2;
  if (y1 >= H - border - 1) y1 = H - border - 2;
  const pos = [];
  for (let i = 0; i < n; i++) {
    for (let guard = 0; ; guard++) {
      const x = R.scale(W - 2 * border) + border, y = R.scale(H - 2 * border) + border;
      if (x > x0 && x < x1 && y > y0 && y < y1 && guard < 100000) continue;
      let clash = false;
      for (let j = 0; j < i; j++) {
        const dx = x - pos[j].x, dy = y - pos[j].y;
        if (dx * dx + dy * dy <= minD2) {
          if (j === i - 1) pos[j] = { x, y }; // the original moves the previous land here
          clash = true;
          break;
        }
      }
      if (!clash || guard > 100000) { pos.push({ x: Math.min(W - 1, x), y: Math.min(H - 1, y) }); break; }
    }
  }
  G.lands = pos.map((p) => ({ x: p.x, y: p.y, radius: land.radius, fade: land.fade, landId: land.id }));
}

// monotonic in the angle of (dx, dy), 0..4, exact arithmetic only
function diamondAngle(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  if (dy >= 0) return dx >= 0 ? dy / (dx + dy) : 1 - dx / (-dx + dy);
  return dx < 0 ? 2 - dy / (-dx - dy) : 3 + dx / (dx - dy);
}

// how strongly each tile avoids the players: edgeFade x (startRadius - d)
function avoidMap(G) {
  const { W, H } = G;
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (const l of G.lands) {
        const dx = Math.abs(x - l.x), dy = Math.abs(y - l.y);
        const d = Math.trunc(Math.sqrt(dx * dx + dy * dy));
        if (l.radius - d > 0) s += l.fade * (l.radius - d);
      }
      a[y * W + x] = s > 100 ? 101 : s;
    }
  }
  return a;
}

// random seed candidates: n / div random tiles (00470810, 004747F0)
function seedPool(G, N, div) {
  const { W, H, R } = G;
  const pool = new Pool(N);
  for (let k = Math.trunc((W * H) / div); k > 0; k--) {
    const x = R.scale(W - 1), y = R.scale(H - 1);
    pool.push(y * W + x);
  }
  return pool;
}
// take every tile of a square out of whatever list it is in
function unlinkSquare(G, N, x, y, r) {
  const { W, H } = G;
  const xa = Math.max(0, x - r), xb = Math.min(W - 1, x + r), ya = Math.max(0, y - r), yb = Math.min(H - 1, y + r);
  for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) N.unlink(yy * W + xx);
}

// --------------------------------------------------------------- elevation
// Four layers of hills (00470130), x(0.7..1.3) and x5 on Hill Country (004740A0)
function elevationSetup(G) {
  const { R, landTiles } = G;
  const layers = [
    { tiles: Math.trunc((landTiles * 10) / 100), height: 1, clumps: 10, radius: 2, base: 0, terrain: GRASS },
    { tiles: Math.trunc((landTiles * 8) / 100), height: 2, clumps: 8, radius: 1, base: 1, terrain: GRASS },
    { tiles: Math.trunc((landTiles * 6) / 100), height: 3, clumps: 6, radius: 1, base: 2, terrain: GRASS },
    { tiles: Math.trunc((landTiles * 4) / 100), height: 4, clumps: 4, radius: 1, base: 3, terrain: GRASS },
  ];
  let f = (70 - R.rand() * Math.fround(-0.0018311106)) * Math.fround(0.01);
  if (G.type === 7) f *= 5;
  for (const l of layers) l.tiles = Math.trunc(l.tiles * f);
  return layers;
}

function generateElevation(G, layers) {
  const { W, H } = G;
  const N = new Nodes(W * H);
  const avoid = avoidMap(G);
  G.elev.fill(layers[0].base);
  for (const layer of layers) {
    elevationLayer(G, N, avoid, layer);
    fixElevation(G, 8);
  }
}

// every tile of the square has the terrain and at least the elevation
function areaOk(G, x, y, terrain, minElev, r) {
  const { W, H } = G;
  const xa = Math.max(0, x - r), xb = Math.min(W - 1, x + r), ya = Math.max(0, y - r), yb = Math.min(H - 1, y + r);
  for (let yy = ya; yy <= yb; yy++) {
    for (let xx = xa; xx <= xb; xx++) {
      const i = yy * W + xx;
      if (terrain !== 255 && G.terrain[i] !== terrain) return false;
      if (G.elev[i] < minElev) return false;
    }
  }
  return true;
}
// tiles of the 5x5 square already at this height (0 when the area check fails)
function elevNeighbours(G, height, x, y, r, terrain, minElev) {
  const { W, H } = G;
  if (r > 0 && !areaOk(G, x, y, terrain, minElev, r)) return 0;
  let c = 0;
  const xa = Math.max(0, x - 2), xb = Math.min(W - 1, x + 2), ya = Math.max(0, y - 2), yb = Math.min(H - 1, y + 2);
  for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) if (G.elev[yy * W + xx] === height) c++;
  return c;
}

function elevationLayer(G, N, avoid, L) {
  const { W, H, R, elev } = G;
  const lists = Array.from({ length: L.clumps }, () => new PrioList(N));
  const pool = seedPool(G, N, 16);
  let spacing = Math.trunc(Math.trunc(Math.sqrt(L.tiles / L.clumps)) / 2);
  if (spacing < 2) spacing = 2;
  let placed = 0, c = 0;
  while (c < L.clumps) {
    const i = pool.pop();
    if (i < 0) break;
    const x = i % W, y = (i - x) / W;
    if (avoid[i] !== 0) continue;
    if (!areaOk(G, x, y, L.terrain, L.base, L.radius)) continue;
    unlinkSquare(G, N, x, y, spacing);
    elev[i] = L.height;
    const list = lists[c];
    if (x > 0) list.push(i - 1, 0);
    if (y > 0) list.push(i - W, 0);
    if (x < W - 1) list.push(i + 1, 0);
    if (y < H - 1) list.push(i + W, 0);
    placed++; c++;
  }
  for (let done = false; !done;) {
    done = true;
    for (let k = 0; k < L.clumps; k++) {
      if (placed >= L.tiles) continue;
      const i = lists[k].pop();
      if (i < 0) continue;
      done = false;
      const x = i % W, y = (i - x) / W;
      if (avoid[i] > R.scale(100)) { avoid[i] = 101; continue; }
      const nb = elevNeighbours(G, L.height, x, y, L.radius, L.terrain, L.base);
      if (elev[i] !== L.base || nb <= 0) continue;
      const w = 250 - 15 * nb;
      elev[i] = L.height;
      const list = lists[k];
      if (x > 0 && elev[i - 1] === L.base) list.push(i - 1, R.scale(100) + w);
      if (x < W - 1 && elev[i + 1] === L.base) list.push(i + 1, R.scale(100) + w);
      if (y > 0 && elev[i - W] === L.base) list.push(i - W, R.scale(100) + w);
      if (y < H - 1 && elev[i + W] === L.base) list.push(i + W, R.scale(100) + w);
      placed++;
    }
  }
  for (const l of lists) l.clear();
}

// The original's clean-up after each layer (00446360): no tile between two
// higher opposite neighbours (00445F80), no diagonal-only shapes the tiles
// cannot draw, at most one level between neighbours (00445C10).
export function fixElevation(G, maxElev = 8) {
  const { W, H, elev } = G;
  const at = (x, y) => elev[y * W + x];
  // flags: 0 ym, 1 yp, 2 xm, 3 xp, 4 xm_ym, 5 xp_ym, 6 xm_yp, 7 xp_yp (higher than E)
  const F = new Uint8Array(8);
  const OFF = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  const flags = (x, y, E) => {
    for (let k = 0; k < 8; k++) {
      const nx = x + OFF[k][0], ny = y + OFF[k][1];
      F[k] = nx >= 0 && ny >= 0 && nx < W && ny < H && at(nx, ny) > E ? 1 : 0;
    }
  };
  const fix = (x, y, E) => {
    if (E >= maxElev) {
      for (let k = 0; k < 8; k++) if (F[k]) elev[(y + OFF[k][1]) * W + x + OFF[k][0]] = E;
    } else elev[y * W + x] = E + 1;
  };
  for (let changed = true; changed;) {
    changed = false;
    // opposite sides higher
    for (let again = true; again;) {
      again = false;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const E = at(x, y);
          flags(x, y, E);
          if ((F[0] && F[1]) || (F[3] && F[2])) { fix(x, y, E); again = true; }
        }
      }
    }
    // diagonal configurations
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const E = at(x, y);
        flags(x, y, E);
        const [ym, yp, xm, xp, xmym, xpym, xmyp, xpyp] = F;
        let bad = false;
        if (xmym) bad = (xpym && !ym) || (xp && !xpym) || (xmyp && !xm) || (yp && !xmyp) || (xpyp && !yp && !xp);
        if (xpym && !bad) bad = (xpyp && !xp) || (yp && !xpyp) || (xmym && !ym) || (xm && !xmym) || (xmyp && !xm && !yp);
        if (xpyp && !bad) bad = (xmyp && !yp) || (xm && !xmyp) || (xpym && !xp) || (ym && !xpym) || (xmym && !ym && !xm);
        if (xmyp && !bad) bad = (xmym && !xm) || (ym && !xmym) || (xpyp && !yp) || (xp && !xpyp) || (xpym && !xp && !ym);
        if (bad) { fix(x, y, E); changed = true; }
      }
    }
    // at most one level between neighbours
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const E = at(x, y);
        if (E === maxElev) continue;
        const up = E < maxElev;
        let hit = false;
        for (let k = 0; k < 8 && !hit; k++) {
          const nx = x + OFF[k][0], ny = y + OFF[k][1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const v = at(nx, ny);
          hit = up ? v > E + 1 : v < E - 1;
        }
        if (hit) { elev[y * W + x] = up ? E + 1 : E - 1; changed = true; }
      }
    }
  }
}

// Slope shape of a tile from its neighbours' elevation (004493A0): 0 flat,
// 1-16 the slope tiles (terrain frames 9-24). In screen terms the
// neighbours are: (X, Y-1) north-west, (X+1, Y) north-east, (X-1, Y)
// south-west, (X, Y+1) south-east, (X+1, Y-1) north, (X-1, Y+1) south,
// (X-1, Y-1) west, (X+1, Y+1) east.
export function slopeType(E, nw, ne, sw, se, n, s, w, e) {
  const up = E + 1, dn = E - 1;
  if (nw === up && ne === up) return 14;
  if (sw === up && se === up) return 13;
  if (nw === up && sw === up) return 16;
  if (ne === up && se === up) return 15;
  if (nw === up) return 6;
  if (ne === up) return 8;
  if (sw === up) return 5;
  if (se === up) return 7;
  if (n === up) return sw === dn && se === dn ? 2 : 10;
  if (s === up) return nw === dn && ne === dn ? 1 : 9;
  if (w === up) return ne === dn && se === dn ? 3 : 11;
  if (e === up) return nw === dn && sw === dn ? 4 : 12;
  return 0;
}

// ------------------------------------------------------------------ cliffs
// Cliff count and length by map size and type (004731A0), 75% of the maps.
function cliffSetup(G) {
  const { W, R, type } = G;
  if (R.rand() <= 0x1fff) return null;
  let count, len;
  if (W <= 72) { count = 1; len = 8; } else if (W <= 96) { count = 4; len = 10; } else if (W <= 120) { count = 6; len = 10; } else if (W <= 144) { count = 8; len = 10; } else if (W <= 200) { count = 9; len = 10; } else { count = 10; len = 10; }
  if (type === 0) { count = 0; len = 0; } else if (type === 1) count -= 5; else if (type === 2) count -= 3;
  else if (type === 3 || type === 4) len += 2; else if (type === 7) { count += 3; len += 4; }
  if (len < 3) len = 3;
  const extra = len - 3 > 0 ? Math.trunc((len - 3) / 2) : 0;
  const minLen = len - extra;
  if (minLen <= 0 || count <= 0) return null;
  return { count, minLen, range: extra, waterR: 2, spacing: 2 };
}

// The connection table of the cliff pieces (map constructor 004EF7F0):
// connections [+x, +y, -x, -y] in {-1, 0, 1} -> unit (264..272), facet, alternative, offset in the cell
export const CLIFF_PIECES = [
  [[1, 0, 0, 0], 264, 16, -1, -1, 1.5, 1.5], [[0, 1, 0, 0], 264, 18, -1, -1, 1.5, 1.5],
  [[0, 0, 1, 0], 264, 17, -1, -1, 1.5, 1.5], [[0, 0, 0, 1], 264, 19, -1, -1, 1.5, 1.5],
  [[-1, 0, 0, 0], 266, 20, -1, -1, 1.5, 1.5], [[0, -1, 0, 0], 265, 22, -1, -1, 1.5, 1.5],
  [[0, 0, -1, 0], 266, 21, -1, -1, 1.5, 1.5], [[0, 0, 0, -1], 265, 23, -1, -1, 1.5, 1.5],
  [[-1, 1, 0, 0], 270, 0, -1, -1, 1.5, 2], [[0, -1, -1, 0], 272, 9, -1, -1, 1, 2],
  [[0, 0, 1, -1], 268, 6, -1, -1, 1, 1.5], [[1, 0, 0, 1], 264, 3, -1, -1, 1.5, 1.5],
  [[1, -1, 0, 0], 267, 12, -1, -1, 2, 1.5], [[0, 1, 1, 0], 264, 15, -1, -1, 1.5, 1.5],
  [[0, 0, -1, 1], 269, 14, -1, -1, 1.5, 1], [[-1, 0, 0, -1], 271, 13, -1, -1, 2, 1],
  [[1, 0, 1, 0], 264, 4, 264, 5, 1.5, 1.5], [[0, 1, 0, 1], 264, 1, 264, 2, 1.5, 1.5],
  [[-1, 0, -1, 0], 266, 11, 266, 10, 1.5, 1.5], [[0, -1, 0, -1], 265, 8, 265, 7, 1.5, 1.5],
];
const PIECE = new Map(CLIFF_PIECES.map((p) => [p[0].join(','), p]));
const pieceOf = (conn) => PIECE.get(conn.join(','));

function generateCliffs(G, P) {
  const { W, H, R } = G;
  const W3 = Math.trunc(W / 3), H3 = Math.trunc(H / 3);
  const N = new Nodes(W3 * H3);
  const avail = new Uint8Array(W3 * H3).fill(1);
  const pool = new PrioList(N);
  const unavail = (cx, cy, r) => {
    for (let y = Math.max(0, cy - r); y <= Math.min(H3 - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(W3 - 1, cx + r); x++) {
        const k = y * W3 + x;
        if (avail[k]) { avail[k] = 0; N.unlink(k); }
      }
    }
  };
  // 3x3 cells of grass or desert at one elevation
  for (let cy = 0; cy < H3; cy++) {
    for (let cx = 0; cx < W3; cx++) {
      let ok = true, water = false, e = -1;
      for (let yy = cy * 3; yy < cy * 3 + 3; yy++) {
        for (let xx = cx * 3; xx < cx * 3 + 3; xx++) {
          const t = G.terrain[yy * W + xx];
          if (t === GRASS || t === DESERT) {
            const v = G.elev[yy * W + xx];
            if (e < 0) e = v; else if (e !== v) ok = false;
          } else { ok = false; if (WATERS.has(t)) water = true; }
        }
      }
      const k = cy * W3 + cx;
      if (ok) {
        if (avail[k]) { avail[k] = e + 1; pool.push(k, 0); }
      } else {
        if (water) unavail(cx, cy, P.waterR);
        avail[k] = 0;
      }
    }
  }
  for (const l of G.lands) unavail(Math.trunc(l.x / 3), Math.trunc(l.y / 3), Math.trunc(l.radius / 3) + 2);
  for (let cy = 0; cy < H3; cy++) {
    for (let cx = 0; cx < W3; cx++) {
      const k = cy * W3 + cx;
      if (!avail[k]) continue;
      if (cy > 0 && avail[k - W3]) continue;
      if (cx > 0 && avail[k - 1]) continue;
      if (cy < H3 - 1 && avail[k + W3]) continue;
      if (cx < W3 - 1 && avail[k + 1]) continue;
      avail[k] = 0; N.unlink(k);
    }
  }
  // shuffle the start cells (0046D5D0): two rounds of 100 buckets
  let order = [];
  for (let i; (i = pool.pop()) >= 0;) order.push(i);
  for (let round = 0; round < 2; round++) {
    const buckets = Array.from({ length: 101 }, () => []);
    for (const i of order) buckets[R.scale(100)].push(i); // each goes to the front of its bucket
    const out = [];
    for (let b = 0; b < 100; b += 2) {
      const A = buckets[b], B = buckets[b + 1];
      for (let ia = A.length - 1, ib = B.length - 1; ia >= 0 || ib >= 0; ia--, ib--) {
        if (ia >= 0) out.push(A[ia]);
        if (ib >= 0) out.push(B[ib]);
      }
    }
    for (const i of buckets[100]) out.push(i);
    order = out.reverse(); // the original moves each into the front of the list
  }
  const starts = order;
  // the cliff pen of the map (004F0AB0): connections per cell
  const conns = new Map(); // cell -> [c0..c3]
  const pen = { cx: -1, cy: -1, keep: -1 };
  const opposite = (d) => (d + 2) % 4;
  const connect = (cx, cy, dir, val, keep) => {
    const k = cy * W3 + cx;
    const old = conns.get(k);
    const conn = old ? old.slice() : [0, 0, 0, 0];
    if (conn[dir] !== 0 && (val === 0 || val === conn[dir])) return conn[dir];
    if (keep === dir) keep = -1;
    if (keep >= 0) for (let i = 0; i < 4; i++) { if (i !== keep) conn[i] = 0; }
    if (val !== 0) {
      conn[dir] = val;
      if (!pieceOf(conn)) for (let i = 0; i < 4; i++) if (i !== dir) conn[i] = 0;
    } else {
      val = 1; conn[dir] = 1;
      if (!pieceOf(conn)) {
        val = -1; conn[dir] = -1;
        if (!pieceOf(conn)) for (let i = 0; i < 4; i++) if (i !== dir) conn[i] = 0;
      }
    }
    conns.set(k, conn);
    return val;
  };
  const penPoint = (x, y) => {
    let cx = Math.trunc(x / 3), cy = Math.trunc(y / 3);
    if (3 * cx + 2 >= W || 3 * cy + 2 >= H || cx < 0 || cy < 0) return;
    if (pen.cx === cx && pen.cy === cy) return;
    if (pen.cx < 0) { pen.cx = cx; pen.cy = cy; pen.keep = -1; return; }
    const dx = x - 3 * pen.cx, dy = y - 3 * pen.cy;
    if (dx < 3 && dx > -1) { if (!(dy < 3 && dy > -1)) cx = pen.cx; else return; } else cy = pen.cy;
    if (cx === pen.cx && cy === pen.cy) return;
    const dir = pen.cx < cx ? 0 : pen.cx > cx ? 2 : pen.cy < cy ? 1 : 3;
    const r = connect(pen.cx, pen.cy, dir, 0, pen.keep);
    const opp = opposite(dir);
    pen.keep = opp; pen.cx = cx; pen.cy = cy;
    connect(cx, cy, opp, r, -1);
  };
  const line = (x0, y0, x1, y1, fn) => {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.trunc(Math.sqrt(dx * dx + dy * dy));
    fn(x0, y0);
    let fx = x0, fy = y0;
    for (let s = 0; s < steps; s++) { fx += dx / steps; fy += dy / steps; fn(Math.trunc(fx), Math.trunc(fy)); }
    if (fx !== x1 || fy !== y1) fn(x1, y1);
  };
  // the random walks (0046E3C0)
  let next = 0;
  for (let c = 0; c < P.count; c++) {
    const len = R.scale(P.range * 2) + P.minLen - P.range;
    if (next >= starts.length || len < 3) continue;
    let k = -1;
    while (next < starts.length) { const s = starts[next++]; if (avail[s]) { k = s; break; } }
    if (k < 0) continue;
    let cx = k % W3, cy = (k - cx) / W3;
    const mark = avail[k];
    const path = [[cx, cy]];
    avail[k] = 0;
    let dir = R.scale(4), first = true;
    const step = (d) => {
      let e = d;
      if (e > 3) { for (let q = Math.trunc((e - 1) / 3); q > 0; q--) e -= 3; }
      if (e < 0) { const q = Math.trunc((2 - e) / 3); e = e + q + q * 2; }
      let nx = cx, ny = cy;
      if (e === 0) { if (ny <= 0) return false; ny--; } else if (e === 1) { if (nx >= W3 - 1) return false; nx++; }
      else if (e === 2) { if (ny >= H3 - 1) return false; ny++; } else if (e === 3) { if (nx <= 0) return false; nx--; } else return false;
      if (avail[ny * W3 + nx] !== mark) return false;
      cx = nx; cy = ny;
      return true;
    };
    for (let i = 0; i < len; i++) {
      const r = R.scale(100);
      if (r < 18) dir = dir <= 0 ? 3 : dir - 1;
      else if (r < 36) dir = dir >= 3 ? 0 : dir + 1;
      const ok = step(dir) || step(dir + 1) || step(dir - 1) || (first && step(dir - 2));
      first = false;
      if (!ok) break;
      path.push([cx, cy]);
      avail[cy * W3 + cx] = 0;
    }
    // draw it from the last cell back to the first (the path list is LIFO)
    let prev = null;
    for (let i = path.length - 1; i >= 0; i--) {
      const p = path[i];
      if (!prev) prev = p;
      const ax = 3 * prev[0] + 1, ay = 3 * prev[1] + 1, bx = 3 * p[0] + 1, by = 3 * p[1] + 1;
      if (pen.cx !== Math.trunc(ax / 3) || pen.cy !== Math.trunc(ay / 3)) { pen.cx = -1; pen.cy = -1; pen.keep = -1; }
      line(ax, ay, bx, by, (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) G.terrain[y * W + x] = CLIFF_TERRAIN; });
      line(ax, ay, bx, by, penPoint);
      unavail(p[0], p[1], P.spacing);
      prev = p;
    }
  }
  // the pieces (004F0170): the alternative graphic half of the time
  for (const [k, conn] of conns) {
    const p = pieceOf(conn);
    if (!p) continue;
    const cx = k % W3, cy = (k - cx) / W3;
    let unit = p[1], facet = p[2];
    if (p[3] > -1 && R.rand() * 2 > 0x7fff) { unit = p[3]; facet = p[4]; }
    const x = 3 * cx + p[5], y = 3 * cy + p[6];
    G.cliffs.push({ unit, facet, x, y });
    const def = ORIGINAL_MAP_UNITS[unit];
    const rx = def ? def.r[0] : 1.5, ry = def ? def.r[1] : 1.5;
    for (let ty = Math.floor(y - ry + 0.01); ty < Math.ceil(y + ry - 0.01); ty++) {
      for (let tx = Math.floor(x - rx + 0.01); tx < Math.ceil(x + rx - 0.01); tx++) {
        if (tx >= 0 && ty >= 0 && tx < W && ty < H) G.occ[ty * W + tx] = 2;
      }
    }
  }
}

// ----------------------------------------------------------------- terrain
// The map script's terrains (0046FE20 + 004737D0): tiles in proportion to the
// land, clumps scaled with the map (not desert), and one map in four with
// three times the palm desert, double desert and half the forests.
function terrainSetup(G) {
  const { R, landTiles, script } = G;
  const list = script.terrains.map(([terrain, prop, clumps, edge, base, clumpiness]) => ({
    terrain, tiles: Math.trunc(prop * landTiles * Math.fround(0.01)), clumps, edge, base, clumpiness, mode: 1,
  }));
  const scale = landTiles * Math.fround(0.00005);
  for (const t of list) if (t.terrain !== DESERT && scale > 1) t.clumps = Math.trunc(t.clumps * scale);
  if (R.rand() < 0x1fff) {
    for (const t of list) {
      if (t.terrain === 13) { t.tiles *= 3; t.clumps *= 3; t.mode = 2; }
      else if (t.terrain === 20 || t.terrain === 19) { t.tiles = Math.trunc(t.tiles / 2); t.clumps = Math.trunc(t.clumps / 2); }
      else if (t.terrain === 10) { t.tiles = Math.trunc(t.tiles / 2); t.clumps = Math.trunc(t.clumps / 2); t.mode = 2; }
      else if (t.terrain === DESERT) { t.tiles *= 2; t.mode = 0; }
    }
  } else {
    for (const t of list) {
      if (t.terrain === DESERT) t.mode = 0;
      else if (t.terrain === 10 || t.terrain === 13) t.mode = 2;
    }
  }
  return list.filter((t) => !WATERS.has(t.terrain));
}

// area check + tiles of this terrain in the 5x5 square, plus one (00474520)
function terrainNeighbours(G, T, x, y, r, base) {
  const { W, H } = G;
  const impass = ORIGINAL_TERRAINS[base] ? ORIGINAL_TERRAINS[base].impass : -1;
  if (r > 0) {
    const xa = Math.max(0, x - r), xb = Math.min(W - 1, x + r), ya = Math.max(0, y - r), yb = Math.min(H - 1, y + r);
    for (let yy = ya; yy <= yb; yy++) {
      for (let xx = xa; xx <= xb; xx++) {
        const t = G.terrain[yy * W + xx];
        if (t !== base && t !== impass && t !== T) return 0;
      }
    }
  }
  let c = 1;
  const xa = Math.max(0, x - 2), xb = Math.min(W - 1, x + 2), ya = Math.max(0, y - 2), yb = Math.min(H - 1, y + 2);
  for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) if (G.terrain[yy * W + xx] === T) c++;
  return c & 255;
}

function generateTerrain(G, list) {
  const { W, H, R, terrain } = G;
  const N = new Nodes(W * H);
  const avoid = avoidMap(G);
  for (const P of list) {
    const T = P.terrain;
    const lists = Array.from({ length: 99 }, () => new PrioList(N));
    const pool = seedPool(G, N, 8);
    let spacing = 2 * Math.trunc(Math.sqrt(P.tiles / Math.max(1, P.clumps)));
    if (spacing < 2) spacing = 2;
    let placed = 0, c = 0;
    // seeds (the whole map is one land, so the per-player seeding of mode 2
    // is satisfied by the first seed, as in the original)
    while (c < P.clumps && c < 99) {
      const i = pool.pop();
      if (i < 0) break;
      const x = i % W, y = (i - x) / W;
      if (terrain[i] !== P.base) continue;
      if (terrainNeighbours(G, T, x, y, P.edge, P.base) <= 0) continue;
      if (P.mode !== 0 && avoid[i] !== 0) continue;
      unlinkSquare(G, N, x, y, spacing);
      terrain[i] = T;
      const l = lists[c];
      if (x > 0) l.push(i - 1, 0);
      if (y > 0) l.push(i - W, 0);
      if (x < W - 1) l.push(i + 1, 0);
      if (y < H - 1) l.push(i + W, 0);
      placed++; c++;
    }
    for (let done = false; !done;) {
      done = true;
      for (let k = 0; k < c; k++) {
        if (placed >= P.tiles) continue;
        const i = lists[k].pop();
        if (i < 0) continue;
        done = false;
        const x = i % W, y = (i - x) / W;
        if (P.mode !== 0 && avoid[i] > R.scale(100)) continue;
        const nb = terrainNeighbours(G, T, x, y, P.edge, P.base);
        if (terrain[i] !== P.base || nb <= 0) continue;
        let w = 250 - nb * P.clumpiness;
        if (P.mode !== 0) w += avoid[i];
        terrain[i] = T;
        const l = lists[k];
        if (x > 0 && terrain[i - 1] === P.base) l.push(i - 1, R.scale(100) + w);
        if (x < W - 1 && terrain[i + 1] === P.base) l.push(i + 1, R.scale(100) + w);
        if (y > 0 && terrain[i - W] === P.base) l.push(i - W, R.scale(100) + w);
        if (y < H - 1 && terrain[i + W] === P.base) l.push(i + W, R.scale(100) + w);
        placed++;
      }
    }
    // fill one-tile gaps left on the clump edges
    for (let k = 0; k < Math.min(99, P.clumps); k++) {
      for (let i; (i = lists[k].pop()) >= 0;) {
        const x = i % W, y = (i - x) / W;
        if ((x > 0 && terrain[i - 1] === T && x < W - 1 && terrain[i + 1] === T) || (y > 0 && terrain[i - W] === T && y < H - 1 && terrain[i + W] === T)) terrain[i] = T;
      }
    }
    for (const l of lists) l.clear();
  }
}

// ----------------------------------------------------------------- objects
const MAP_UNIT = (id) => ORIGINAL_MAP_UNITS[id];
// can an object of this unit stand at (x, y)? Its footprint must be free of
// blocking objects and on terrain its kind can stand on.
function canPlace(G, unit, x, y) {
  const { W, H } = G;
  const def = MAP_UNIT(unit);
  const rx = def ? def.r[0] : 0.5, ry = def ? def.r[1] : 0.5;
  if (rx <= 0 && ry <= 0) {
    const tx = Math.floor(x), ty = Math.floor(y);
    return tx >= 0 && ty >= 0 && tx < W && ty < H && G.occ[ty * W + tx] !== 2;
  }
  const x0 = Math.floor(x - rx + 0.01), x1 = Math.ceil(x + rx - 0.01), y0 = Math.floor(y - ry + 0.01), y1 = Math.ceil(y + ry - 0.01);
  if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) return false;
  const building = def && def.type === 80;
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      const i = ty * W + tx;
      if (G.occ[i]) return false;
      const t = ORIGINAL_TERRAINS[G.terrain[i]];
      if (!t || !t.land) return false;
      if (building && (G.terrain[i] === 2 || G.terrain[i] === 4)) return false;
    }
  }
  return true;
}
function occupy(G, unit, x, y, kind = 1) {
  const { W, H } = G;
  const def = MAP_UNIT(unit);
  const rx = def ? def.r[0] : 0.5, ry = def ? def.r[1] : 0.5;
  if (rx <= 0 && ry <= 0) return;
  const x0 = Math.floor(x - rx + 0.01), x1 = Math.ceil(x + rx - 0.01), y0 = Math.floor(y - ry + 0.01), y1 = Math.ceil(y + ry - 0.01);
  for (let ty = Math.max(0, y0); ty < Math.min(H, y1); ty++) for (let tx = Math.max(0, x0); tx < Math.min(W, x1); tx++) G.occ[ty * W + tx] = kind;
}
// object position for a tile: +0.5 on an axis whose radius has a fraction
function tilePos(unit, x, y) {
  const def = MAP_UNIT(unit);
  const rx = def ? def.r[0] : 0.5, ry = def ? def.r[1] : 0.5;
  return [rx - Math.trunc(rx) > 0 ? x + 0.5 : x, ry - Math.trunc(ry) > 0 ? y + 0.5 : y];
}

function generateObjects(G, players) {
  const { W, H, R, script } = G;
  // terrain objects first: decorations, scattered trees, every forest tile's tree (004481B0)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = ORIGINAL_TERRAINS[G.terrain[y * W + x]];
      if (!t) continue;
      for (const [unit, density, centred] of t.objects) {
        for (let d = density; d > 0; d -= 1000) {
          let px, py;
          if (centred) { px = x + 0.5; py = y + 0.5; } else { px = x + R.rand() / 32767; py = y + R.rand() / 32767; }
          const place = d >= 1000 || R.scale(1000) < d;
          if (!place || !canPlace(G, unit, px, py)) continue;
          addObject(G, unit, px, py, 0);
        }
      }
    }
  }
  // the map script's objects (004719A0)
  const scale = (g) => Math.max(1, Math.trunc((W * H * g) / 20736));
  for (const [unit, host, placing, scaled, perGroup, fluct, groups0, radius, own, land, minD, maxD] of script.units) {
    if (!MAP_UNIT(unit)) continue;
    const e = { unit, host, placing, perGroup, fluct, groups: scaled ? scale(groups0) : groups0, radius, own, minD, maxD, spacing: groupSpacing(unit, land, W) };
    if (land >= 0) {
      G.lands.forEach((l, i) => { if (l.landId === land) placeAround(G, e, l, i, players); });
    } else placeAnywhere(G, e, land === -2 ? minD : -1);
  }
}

// candidates are removed this far around each placed group (00473F54)
function groupSpacing(unit, land, W) {
  if (land >= 0) return [59, 65, 66, 102].includes(unit) ? 12 : 1;
  if (land === -2) {
    if (unit === 65) return W >> 3;
    if ([59, 66, 102].includes(unit)) return Math.trunc(W / 6);
  }
  return 1;
}

function addObject(G, unit, x, y, owner) {
  occupy(G, unit, x, y, 1);
  G.objects.push({ unit, x, y, owner });
}

// candidate tiles (00471AF0): every available tile of the square in raster
// order, a quarter of them picked at random moved to the front
function candidates(G, avail, cx, cy, r) {
  const { W, H, R } = G;
  let x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1;
  if (cx >= 0 && cy >= 0 && r >= 0) { x0 = Math.max(0, cx - r); y0 = Math.max(0, cy - r); x1 = Math.min(W - 1, cx + r); y1 = Math.min(H - 1, cy + r); }
  const N = new Nodes(W * H);
  const front = new Pool(N);
  const tail = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (avail[y * W + x]) tail.push(y * W + x);
  const w = x1 - x0 - 1, h = y1 - y0 - 1;
  if (w > 1 && h > 1) {
    for (let k = Math.trunc((w * h) / 4); k > 0; k--) {
      const x = R.scale(w) + x0, y = R.scale(h) + y0;
      if (avail[y * W + x]) front.push(y * W + x);
    }
  }
  // iterate: front (newest first), then the raster tail
  const seen = new Uint8Array(W * H);
  const out = [];
  for (let i; (i = front.pop()) >= 0;) if (!seen[i]) { seen[i] = 1; out.push(i); }
  for (const i of tail) if (!seen[i]) { seen[i] = 1; out.push(i); }
  return { out, k: 0, removed: new Uint8Array(W * H) };
}
function nextCandidate(c) {
  while (c.k < c.out.length) { const i = c.out[c.k++]; if (!c.removed[i]) return i; }
  return -1;
}
function removeSquare(G, c, x, y, r) {
  const { W, H } = G;
  for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) c.removed[yy * W + xx] = 1;
}

function ownerOf(e, landIndex, players) {
  if (e.own > -1) return e.own;
  const p = players[landIndex];
  return p ? p.id : 0;
}

// one object, a scattered group or a clump at a tile
function placeGroup(G, e, x, y, owner, avail) {
  const { R } = G;
  if (e.placing === 0) {
    const [px, py] = tilePos(e.unit, x, y);
    addObject(G, e.unit, px, py, owner);
    return;
  }
  let count = e.perGroup + R.scale(2 * e.fluct) - e.fluct;
  if (count < 1) count = 1;
  if (e.placing === 1) {
    const c = candidates(G, avail, x, y, e.radius);
    for (let i; count > 0 && (i = nextCandidate(c)) >= 0;) {
      const tx = i % G.W, ty = (i - tx) / G.W;
      if (e.host >= 0 && G.terrain[i] !== e.host) continue;
      const [px, py] = tilePos(e.unit, tx, ty);
      if (!canPlace(G, e.unit, px, py)) continue;
      addObject(G, e.unit, px, py, owner);
      count--;
    }
    return;
  }
  // clumped (00472780): grow from the tile in random order inside the radius
  const { W, H } = G;
  const x0 = Math.max(0, x - e.radius), x1 = Math.min(W - 1, x + e.radius), y0 = Math.max(0, y - e.radius), y1 = Math.min(H - 1, y + e.radius);
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) avail[yy * W + xx] = 1;
  const N = new Nodes(W * H);
  const list = new PrioList(N);
  list.push(y * W + x, 0);
  for (let i; count > 0 && (i = list.pop()) >= 0;) {
    const tx = i % W, ty = (i - tx) / W;
    const [px, py] = tilePos(e.unit, tx, ty);
    if (!canPlace(G, e.unit, px, py)) continue;
    addObject(G, e.unit, px, py, owner);
    count--;
    avail[i] = 0;
    if (tx > x0 && avail[i - 1]) list.push(i - 1, R.rand());
    if (tx < x1 && avail[i + 1]) list.push(i + 1, R.rand());
    if (ty > y0 && avail[i - W]) list.push(i - W, R.rand());
    if (ty < y1 && avail[i + W]) list.push(i + W, R.rand());
  }
}

function placeAt(G, e, i, owner, c, avail) {
  const { W } = G;
  const x = i % W, y = (i - x) / W;
  if (e.host >= 0 && G.terrain[i] !== e.host) return false;
  const [px, py] = tilePos(e.unit, x, y);
  if (!canPlace(G, e.unit, px, py)) return false;
  removeSquare(G, c, x, y, e.spacing);
  placeGroup(G, e, x, y, owner, avail);
  return true;
}

// around one player's land (00472250): outside every player's minimum
// square, inside this player's maximum square
function placeAround(G, e, land, landIndex, players) {
  const { W, H } = G;
  const avail = new Uint8Array(W * H).fill(1);
  for (const l of G.lands) {
    for (let y = Math.max(0, l.y - e.minD); y <= Math.min(H - 1, l.y + e.minD); y++) for (let x = Math.max(0, l.x - e.minD); x <= Math.min(W - 1, l.x + e.minD); x++) avail[y * W + x] = 0;
  }
  const owner = ownerOf(e, landIndex, players);
  const c = candidates(G, avail, land.x, land.y, e.maxD);
  let groups = e.groups;
  const forced = e.placing === 0 && e.unit === 109; // a town centre is always placed
  for (let i; groups > 0 && (i = nextCandidate(c)) >= 0;) if (placeAt(G, e, i, owner, c, avail)) groups--;
  if (groups > 0 && forced) {
    clearFootprint(G, e.unit, land.x + 0.5, land.y + 0.5);
    addObject(G, e.unit, land.x + 0.5, land.y + 0.5, owner);
  }
}

// anywhere, or away from every player (00472040, 00471E00)
function placeAnywhere(G, e, minD) {
  const { W, H } = G;
  const avail = new Uint8Array(W * H).fill(1);
  if (minD >= 0) {
    for (const l of G.lands) {
      for (let y = Math.max(0, l.y - minD); y <= Math.min(H - 1, l.y + minD); y++) for (let x = Math.max(0, l.x - minD); x <= Math.min(W - 1, l.x + minD); x++) avail[y * W + x] = 0;
    }
  }
  const c = candidates(G, avail, -1, -1, -1);
  let groups = e.groups;
  for (let i; groups > 0 && (i = nextCandidate(c)) >= 0;) if (placeAt(G, e, i, Math.max(0, e.own), c, avail)) groups--;
}

// remove terrain objects under a footprint (so a town centre always fits)
function clearFootprint(G, unit, x, y) {
  const def = MAP_UNIT(unit);
  const rx = def ? def.r[0] : 1.5, ry = def ? def.r[1] : 1.5;
  G.objects = G.objects.filter((o) => Math.abs(o.x - x) >= rx + 0.5 || Math.abs(o.y - y) >= ry + 0.5);
  const { W } = G;
  for (let ty = Math.floor(y - ry); ty < Math.ceil(y + ry); ty++) for (let tx = Math.floor(x - rx); tx < Math.ceil(x + rx); tx++) if (G.occ[ty * W + tx] === 1) G.occ[ty * W + tx] = 0;
}
