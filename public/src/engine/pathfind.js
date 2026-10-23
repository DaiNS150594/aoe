import { TERRAIN_PASSABLE } from './map.js';
// Grid A* (8-directional, no corner cutting) with a node budget, plus
// straight-line walkability tests used for path smoothing. Deterministic.
const SQRT2 = 1.4142135623730951;
const DX = [1, -1, 0, 0, 1, -1, 1, -1];
const DY = [0, 0, 1, -1, 1, 1, -1, -1];

export class Pathfinder {
  constructor(map) {
    this.map = map;
    const n = map.w * map.h;
    this.g = new Float64Array(n);
    this.f = new Float64Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n + 1);
    this.heapSize = 0;
    this.gen = 0;
    this.expansions = 0; // stats for budget accounting
  }

  _push(i) {
    const h = this.heap, f = this.f;
    let k = this.heapSize++;
    h[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[h[p]] <= f[i]) break;
      h[k] = h[p]; k = p;
    }
    h[k] = i;
  }
  _pop() {
    const h = this.heap, f = this.f;
    const top = h[0];
    const last = h[--this.heapSize];
    let k = 0;
    const n = this.heapSize;
    while (true) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && f[h[c + 1]] < f[h[c]]) c++;
      if (f[h[c]] >= f[last]) break;
      h[k] = h[c]; k = c;
    }
    if (n > 0) h[k] = last;
    return top;
  }

  // goal: { x0, y0, x1, y1, adjacent } tile rectangle (inclusive). When
  // adjacent is true the path ends on a tile touching the rectangle (used for
  // buildings / resources); otherwise it ends inside the rectangle.
  // allowId: entity id whose blocked tiles are treated as walkable (farms).
  find(sx, sy, goal, maxNodes = 6000, allowId = 0) {
    const map = this.map, W = map.w, H = map.h;
    sx = Math.max(0, Math.min(W - 1, sx | 0));
    sy = Math.max(0, Math.min(H - 1, sy | 0));
    const gen = ++this.gen;
    if (gen === 0xffffffff) { this.seen.fill(0); this.closed.fill(0); this.gen = 1; }
    const { g, f, from, seen, closed } = this;
    const adj = !!goal.adjacent;
    const gx0 = goal.x0 - (adj ? 1 : 0), gy0 = goal.y0 - (adj ? 1 : 0);
    const gx1 = goal.x1 + (adj ? 1 : 0), gy1 = goal.y1 + (adj ? 1 : 0);
    const block = map.block, terr = map.terrain;
    const pass = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const i = y * W + x;
      const b = block[i];
      if (b !== 0 && b !== allowId) return false;
      return TERRAIN_PASSABLE[terr[i]];
    };
    const isGoal = (x, y) => {
      if (x < gx0 || x > gx1 || y < gy0 || y > gy1) return false;
      if (adj && x >= goal.x0 && x <= goal.x1 && y >= goal.y0 && y <= goal.y1) return false;
      return true;
    };
    const heur = (x, y) => {
      const dx = x < gx0 ? gx0 - x : x > gx1 ? x - gx1 : 0;
      const dy = y < gy0 ? gy0 - y : y > gy1 ? y - gy1 : 0;
      return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
    };
    const s = sy * W + sx;
    this.heapSize = 0;
    g[s] = 0; f[s] = heur(sx, sy); from[s] = -1; seen[s] = gen;
    this._push(s);
    let best = s, bestH = f[s];
    let found = -1;
    let n = 0;
    while (this.heapSize > 0) {
      const cur = this._pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      const cx = cur % W, cy = (cur - cx) / W;
      if (isGoal(cx, cy) && (cur !== s || pass(cx, cy) || adj)) { found = cur; break; }
      const hc = f[cur] - g[cur];
      if (hc < bestH) { bestH = hc; best = cur; }
      if (++n > maxNodes) break;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (!pass(nx, ny)) continue;
        if (d >= 4 && (!pass(cx + DX[d], cy) || !pass(cx, cy + DY[d]))) continue;
        const ni = ny * W + nx;
        if (closed[ni] === gen) continue;
        const ng = g[cur] + (d >= 4 ? SQRT2 : 1);
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen;
          g[ni] = ng;
          f[ni] = ng + heur(nx, ny);
          from[ni] = cur;
          this._push(ni);
        }
      }
    }
    this.expansions += n;
    const end = found >= 0 ? found : best;
    const pts = [];
    let c = end;
    while (c !== -1 && c !== s) {
      const x = c % W;
      pts.push({ x: x + 0.5, y: (c - x) / W + 0.5 });
      c = from[c];
    }
    pts.reverse();
    return { path: pts, reached: found >= 0, nodes: n };
  }

  // Is the straight segment walkable (tile supercover)?
  lineWalkable(x0, y0, x1, y1, allowId = 0) {
    const map = this.map, W = map.w, H = map.h;
    let tx = Math.floor(x0), ty = Math.floor(y0);
    const ex = Math.floor(x1), ey = Math.floor(y1);
    const pass = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const i = y * W + x;
      const b = map.block[i];
      if (b !== 0 && b !== allowId) return false;
      return TERRAIN_PASSABLE[map.terrain[i]];
    };
    const dx = x1 - x0, dy = y1 - y0;
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMX = dx !== 0 ? (dx > 0 ? (tx + 1 - x0) : (x0 - tx)) * tDX : Infinity;
    let tMY = dy !== 0 ? (dy > 0 ? (ty + 1 - y0) : (y0 - ty)) * tDY : Infinity;
    let guard = 0;
    while (!(tx === ex && ty === ey)) {
      if (++guard > 1000) return false;
      if (Math.abs(tMX - tMY) < 1e-9) {
        // passing exactly through a corner: both side tiles must be free
        if (!pass(tx + stepX, ty) || !pass(tx, ty + stepY)) return false;
        tx += stepX; ty += stepY; tMX += tDX; tMY += tDY;
      } else if (tMX < tMY) { tx += stepX; tMX += tDX; } else { ty += stepY; tMY += tDY; }
      if (tMX > 1 + 1e-9 && tMY > 1 + 1e-9 && !(tx === ex && ty === ey)) {
        // numeric safety: we've gone past the end
        break;
      }
      if (!pass(tx, ty)) return false;
    }
    return true;
  }

  // Remove intermediate waypoints that can be skipped with straight lines.
  smooth(sx, sy, pts, allowId = 0) {
    if (pts.length <= 1) return pts;
    const out = [];
    let cx = sx, cy = sy, i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 12);
      while (j > i && !this.lineWalkable(cx, cy, pts[j].x, pts[j].y, allowId)) j--;
      out.push(pts[j]);
      cx = pts[j].x; cy = pts[j].y;
      i = j + 1;
    }
    return out;
  }
}
