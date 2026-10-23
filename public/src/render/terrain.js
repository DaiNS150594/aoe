// Terrain renderer: the map is cut into 16x16-tile chunks, each rendered once
// into an offscreen canvas and cached (LRU).
//
// With the original game files every tile is drawn the way empires.exe draws
// it (RGE view, 00516710): the terrain shown (forests show grass, palm desert
// shows desert), its frame picked by slope shape and by the tile's position
// in the terrain's 3x3 (water 2x2) pattern, and the transition borders
// computed from the 8 neighbours (00449B10/004496B0): full transition tiles
// (style 0) or edge pieces laid over the tile (style 1). The original works in
// its own coordinates — X towards the screen's upper right, Y towards its
// lower right — which are ours as X = W-1-ty, Y = tx.
// Without them, procedural textures are blended through soft masks and
// hill-shaded per corner.
import { HW, HH, EPX } from './iso.js';
import { getTextures, getAoeTextures, terrainTex } from './textures.js';
import { aoe } from '../assets/loader.js';
import { TERRAIN_DRAWN } from '../engine/map.js';
import { slopeType } from '../engine/rms.js';

const CS = 16;
const MAX_CACHE = 48;
const LIGHT = normalize([-0.62, -0.32, 0.72]);

// Rise of Rome slope tiles (frames 9-24 of a terrain SLP) by which corners are
// one level up — key: top, right, bottom, left corner (screen directions).
const SLOPE_FRAME = {
  '0010': 9, '1000': 10, '0001': 11, '0100': 12, '0011': 13, '1001': 14, '0110': 15, '1100': 16,
  '0111': 21, '1101': 22, '1110': 23, '1011': 24,
};
export function slopeFrame(t, r, b, l) {
  const lo = Math.min(t, r, b, l);
  if (Math.max(t, r, b, l) - lo !== 1) return -1;
  return SLOPE_FRAME[`${t - lo}${r - lo}${b - lo}${l - lo}`] ?? -1;
}

function normalize(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

// neighbour offsets (our tx, ty) of the original's directions
const NB = { ym: [-1, 0], yp: [1, 0], xm: [0, 1], xp: [0, -1], xmym: [-1, 1], xpym: [-1, -1], xmyp: [1, 1], xpyp: [1, -1] };

export class TerrainRenderer {
  constructor(map) {
    this.map = map;
    this.tex = getTextures();
    this.texSrc = null;
    this.cache = new Map();
    this.cs = CS;
    this.cw = Math.ceil(map.w / CS);
    this.ch = Math.ceil(map.h / CS);
    this.limit = MAX_CACHE; // chunks kept: never fewer than the view shows
    let maxH = 0;
    for (let i = 0; i < map.heights.length; i++) if (map.heights[i] > maxH) maxH = map.heights[i];
    this.maxElevPx = maxH * EPX + 4;
  }

  // chunk tiles + a 1-tile margin shared with neighbours (identical pixels in
  // the overlap, so chunk borders never show seams)
  chunkBox(cx, cy) {
    const x0 = Math.max(0, cx * CS - 1), y0 = Math.max(0, cy * CS - 1);
    const x1 = Math.min(this.map.w, cx * CS + CS + 1), y1 = Math.min(this.map.h, cy * CS + CS + 1);
    const left = (x0 - y1) * HW, right = (x1 - y0) * HW;
    const top = (x0 + y0) * HH - this.maxElevPx, bottom = (x1 + y1) * HH + 2;
    return { x0, y0, x1, y1, left, top, w: Math.ceil(right - left), h: Math.ceil(bottom - top) };
  }

  getChunk(cx, cy, allowRender = true) {
    const key = cy * this.cw + cx;
    let c = this.cache.get(key);
    if (c) { this.cache.delete(key); this.cache.set(key, c); return c; }
    if (!allowRender) return null;
    c = this.renderChunk(cx, cy);
    this.cache.set(key, c);
    if (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value);
    return c;
  }

  tileQuad(tx, ty, ox, oy) {
    const m = this.map;
    const hT = m.cornerH(tx, ty), hR = m.cornerH(tx + 1, ty), hB = m.cornerH(tx + 1, ty + 1), hL = m.cornerH(tx, ty + 1);
    return {
      T: [(tx - ty) * HW - ox, (tx + ty) * HH - hT * EPX - oy, hT],
      R: [(tx + 1 - ty) * HW - ox, (tx + 1 + ty) * HH - hR * EPX - oy, hR],
      B: [(tx - ty) * HW - ox, (tx + ty + 2) * HH - hB * EPX - oy, hB],
      L: [(tx - ty - 1) * HW - ox, (tx + ty + 1) * HH - hL * EPX - oy, hL],
    };
  }

  renderChunk(cx, cy) {
    if (this.texSrc) {
      const c = this.renderChunkOriginal(cx, cy);
      if (c) return c;
    }
    return this.renderChunkProcedural(cx, cy);
  }

  // --------------------------------------------------- original tiles
  // slope shape of a tile (004493A0) from its neighbours' elevation
  slopeTypeAt(tx, ty) {
    const m = this.map, E = m.elev[ty * m.w + tx];
    const at = (d) => {
      const x = tx + d[0], y = ty + d[1];
      return m.inBounds(x, y) ? m.elev[y * m.w + x] : E;
    };
    return slopeType(E, at(NB.ym), at(NB.xp), at(NB.xm), at(NB.yp), at(NB.xpym), at(NB.xmyp), at(NB.xmym), at(NB.xpyp));
  }

  // border of a tile (004496B0): [border id, shape] — style 0 shapes 1..12,
  // style 1 a mask of the sides (1 NW, 2 SE, 4 SW, 8 NE); null when none
  borderAt(dat, tx, ty) {
    const m = this.map, T = m.terrain[ty * m.w + tx];
    const tbl = dat.terrains[T] && dat.terrains[T].borders;
    if (!tbl) return null;
    const valid = (b) => b > 0 && b < 16 && dat.borders[b] && dat.borders[b].enabled;
    const nb = (d) => {
      const x = tx + d[0], y = ty + d[1];
      if (!m.inBounds(x, y)) return T;
      const n = m.terrain[y * m.w + x];
      return n !== T && !valid(tbl[n]) ? T : n;
    };
    const n = [nb(NB.ym), nb(NB.yp), nb(NB.xm), nb(NB.xp), nb(NB.xmym), nb(NB.xpym), nb(NB.xmyp), nb(NB.xpyp)];
    const other = n.find((v) => v !== T);
    if (other === undefined) return null;
    const b = tbl[other];
    if (!valid(b)) return null;
    const is = (k) => tbl[n[k]] === b;
    if (dat.borders[b].style === 1) return [b, (is(0) ? 1 : 0) + (is(1) ? 2 : 0) + (is(2) ? 4 : 0) + (is(3) ? 8 : 0)];
    let shape = 0;
    if (is(0) && is(2)) shape = 1;
    else if (is(0) && is(3)) shape = 2;
    else if (is(1) && is(2)) shape = 3;
    else if (is(1) && is(3)) shape = 4;
    else if (is(0)) shape = 9;
    else if (is(1)) shape = 10;
    else if (is(2)) shape = 11;
    else if (is(3)) shape = 12;
    else if (is(4)) shape = 5;
    else if (is(5)) shape = 6;
    else if (is(6)) shape = 7;
    else if (is(7)) shape = 8;
    return shape ? [b, shape] : null;
  }

  renderChunkOriginal(cx, cy) {
    const A = this.texSrc, dat = A.dat, m = this.map;
    const box = this.chunkBox(cx, cy);
    const canvas = document.createElement('canvas');
    canvas.width = box.w; canvas.height = box.h;
    const g = canvas.getContext('2d');
    const ox = box.left, oy = box.top;
    const borderFrame = (b, tt, shape) => {
      const e = dat.borders[b].frames[tt * 12 + shape - 1];
      return e && e.frames > 0 ? e.shape : -1;
    };
    // back to front, so the one-pixel overlaps fall like the original's
    for (let s = box.x0 + box.y0; s <= box.x1 + box.y1 - 2; s++) {
      for (let tx = Math.max(box.x0, s - box.y1 + 1); tx <= Math.min(box.x1 - 1, s - box.y0); tx++) {
        const ty = s - tx;
        const q = this.tileQuad(tx, ty, ox, oy);
        const ax = Math.round(q.L[0]), ay = Math.round(Math.min(q.T[1], q.R[1], q.B[1], q.L[1]));
        const tt = this.slopeTypeAt(tx, ty);
        const T = m.terrain[ty * m.w + tx];
        let base = true;
        const over = [];
        const bd = this.borderAt(dat, tx, ty);
        if (bd) {
          const [b, shape] = bd, B = dat.borders[b];
          if (B.style === 1) {
            for (const [bit, sh] of [[1, 1], [2, 4], [4, 3], [8, 2]]) {
              if (!(shape & bit)) continue;
              const f = borderFrame(b, tt, sh);
              if (f >= 0) over.push([B.slp, f]);
            }
          } else {
            const f = borderFrame(b, tt, shape);
            if (f >= 0) { over.push([B.slp, f]); base = false; }
          }
        }
        if (base) {
          const D = TERRAIN_DRAWN[T];
          const t = dat.terrains[D];
          const el = t && t.elevation[tt];
          if (el && el.frames > 0 && t.slp >= 0) {
            let idx = 0;
            if (el.frames > 1) {
              const rows = t.draw[0] & 255, cols = t.draw[1] & 255;
              if (rows > 1 || cols > 1) {
                const X = m.w - 1 - ty, Y = tx;
                idx = (rows ? Y % rows : 0) * cols + (cols ? X % cols : 0);
              }
              if (idx > el.frames - 1) idx = 0;
            }
            const sp = A.tileSprite(t.slp, el.angles * idx + el.shape);
            if (sp) g.drawImage(sp.c, ax - sp.hx, ay - sp.hy);
          }
        }
        for (const [slp, f] of over) {
          const sp = A.tileSprite(slp, f);
          if (sp) g.drawImage(sp.c, ax - sp.hx, ay - sp.hy);
        }
      }
    }
    return { canvas, x: box.left, y: box.top };
  }

  // ------------------------------------------------- procedural tiles
  renderChunkProcedural(cx, cy) {
    const m = this.map, box = this.chunkBox(cx, cy);
    const canvas = document.createElement('canvas');
    canvas.width = box.w; canvas.height = box.h;
    const g = canvas.getContext('2d');
    const ox = box.left, oy = box.top;
    const pat = (name) => {
      const tc = this.tex[name];
      const p = g.createPattern(tc, 'repeat');
      if (p.setTransform) p.setTransform(new DOMMatrix().translate(-(ox % tc.width), -(oy % tc.height)));
      return p;
    };
    const quadPath = (ctx, q, grow = 0) => {
      ctx.moveTo(q.T[0], q.T[1] - grow); ctx.lineTo(q.R[0] + grow * 2, q.R[1]);
      ctx.lineTo(q.B[0], q.B[1] + grow); ctx.lineTo(q.L[0] - grow * 2, q.L[1]); ctx.closePath();
    };
    // 1) base grass on every tile (expanded by a pixel to hide seams)
    const clip = new Path2D();
    for (let ty = box.y0; ty < box.y1; ty++) for (let tx = box.x0; tx < box.x1; tx++) quadPath(clip, this.tileQuad(tx, ty, ox, oy), 0.6);
    g.fillStyle = pat('grass');
    g.fill(clip);
    // 2) other terrain textures blended through blurred masks
    const kinds = new Set();
    for (let ty = Math.max(0, box.y0 - 1); ty < Math.min(m.h, box.y1 + 1); ty++) for (let tx = Math.max(0, box.x0 - 1); tx < Math.min(m.w, box.x1 + 1); tx++) {
      const k = terrainTex(m.terrain[ty * m.w + tx]);
      if (k !== 'grass') kinds.add(k);
    }
    if (kinds.size) {
      const mask = document.createElement('canvas'); mask.width = box.w; mask.height = box.h;
      const mg = mask.getContext('2d');
      const blur = document.createElement('canvas'); blur.width = box.w; blur.height = box.h;
      const bg = blur.getContext('2d');
      for (const k of kinds) {
        mg.clearRect(0, 0, box.w, box.h);
        mg.fillStyle = '#fff';
        mg.beginPath();
        for (let ty = Math.max(0, box.y0 - 2); ty < Math.min(m.h, box.y1 + 2); ty++) for (let tx = Math.max(0, box.x0 - 2); tx < Math.min(m.w, box.x1 + 2); tx++) {
          if (terrainTex(m.terrain[ty * m.w + tx]) === k) quadPath(mg, this.tileQuad(tx, ty, ox, oy), k === 'forest' ? 3 : 1);
        }
        mg.fill();
        bg.clearRect(0, 0, box.w, box.h);
        bg.globalCompositeOperation = 'source-over';
        bg.filter = k === 'forest' ? 'blur(7px)' : 'blur(5px)';
        bg.drawImage(mask, 0, 0);
        bg.filter = 'none';
        bg.globalCompositeOperation = 'source-in';
        bg.fillStyle = pat(k);
        bg.fillRect(0, 0, box.w, box.h);
        bg.globalCompositeOperation = 'source-over';
        g.save(); g.clip(clip); g.drawImage(blur, 0, 0); g.restore();
      }
    }
    // 3) smooth (Gouraud) hill shading: light per corner from the
    //    surrounding heights, interpolated across each triangle with a
    //    linear gradient into an opaque grey "lightmap" (128 = neutral)
    //    blended with 'soft-light'
    const lm = document.createElement('canvas'); lm.width = box.w; lm.height = box.h;
    const lg = lm.getContext('2d');
    lg.fillStyle = 'rgb(128,128,128)'; lg.fillRect(0, 0, box.w, box.h);
    let any = false;
    for (let ty = box.y0; ty < box.y1; ty++) {
      for (let tx = box.x0; tx < box.x1; tx++) {
        const q = this.tileQuad(tx, ty, ox, oy);
        const dT = this.cornerShade(tx, ty), dR = this.cornerShade(tx + 1, ty), dB = this.cornerShade(tx + 1, ty + 1), dL = this.cornerShade(tx, ty + 1);
        if (Math.abs(dT) < 0.003 && Math.abs(dR) < 0.003 && Math.abs(dB) < 0.003 && Math.abs(dL) < 0.003) continue;
        any = true;
        const hT = q.T[2], hR = q.R[2], hB = q.B[2], hL = q.L[2];
        const splitLR = hL === hR || hT !== hB;
        const tris = splitLR ? [[q.T, dT, q.R, dR, q.L, dL], [q.L, dL, q.R, dR, q.B, dB]] : [[q.T, dT, q.R, dR, q.B, dB], [q.T, dT, q.B, dB, q.L, dL]];
        for (const [a, da, b, db, c, dc] of tris) gouraud(lg, a, da, b, db, c, dc);
      }
    }
    if (any) {
      g.save(); g.clip(clip);
      g.globalCompositeOperation = 'soft-light';
      g.drawImage(lm, 0, 0);
      g.restore();
    }
    return { canvas, x: box.left, y: box.top };
  }

  // brightness offset (vs flat ground) at a tile corner
  cornerShade(cx, cy) {
    const m = this.map;
    const H = (x, y) => m.cornerH(Math.max(0, Math.min(m.w, x)), Math.max(0, Math.min(m.h, y)));
    const s = 0.9;
    const hx = (H(cx + 1, cy) - H(cx - 1, cy)) / 2 * s;
    const hy = (H(cx, cy + 1) - H(cx, cy - 1)) / 2 * s;
    // also look one step further for smoother hills
    const hx2 = (H(cx + 2, cy) - H(cx - 2, cy)) / 4 * s;
    const hy2 = (H(cx, cy + 2) - H(cx, cy - 2)) / 4 * s;
    const nx = -(hx * 0.65 + hx2 * 0.35), ny = -(hy * 0.65 + hy2 * 0.35);
    const l = Math.hypot(nx, ny, 1);
    return (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / l - LIGHT[2];
  }

  // switch between procedural and original (player-provided) textures
  syncTextures() {
    const A = aoe();
    const src = A ? A.assets : null;
    if (src === this.texSrc) return;
    this.texSrc = src;
    this.tex = (src && getAoeTextures(src)) || getTextures();
    this.cache.clear();
  }

  // fog: the FogLayer drawing the original's fog of war over each chunk (null: none)
  draw(ctx, cam, fog = null) {
    this.syncTextures();
    const z = cam.zoom;
    const vx0 = cam.ix(0), vy0 = cam.iy(0), vx1 = cam.ix(cam.w), vy1 = cam.iy(cam.h);
    const view = [];
    for (let s = 0; s < this.cw + this.ch - 1; s++) {
      for (let cx = 0; cx < this.cw; cx++) {
        const cy = s - cx;
        if (cy < 0 || cy >= this.ch) continue;
        const box = this.chunkBox(cx, cy);
        if (box.left > vx1 || box.left + box.w < vx0 || box.top > vy1 || box.top + box.h < vy0) continue;
        view.push(cx, cy);
      }
    }
    // zoomed far out, the view holds more chunks than the cache: dropping
    // ones still in view would re-render them every frame, black meanwhile
    this.limit = Math.max(MAX_CACHE, view.length / 2 + 8);
    const t0 = performance.now();
    let rendered = 0;
    for (let i = 0; i < view.length; i += 2) {
      const cx = view[i], cy = view[i + 1];
      if (fog && fog.hidden(cx, cy)) continue; // unexplored: stays black
      // spread expensive chunk rendering over several frames while scrolling
      const had = this.cache.has(cy * this.cw + cx);
      const c = this.getChunk(cx, cy, rendered === 0 || performance.now() - t0 < 18);
      if (!c) continue;
      if (!had) rendered++;
      ctx.drawImage(c.canvas, cam.snap(cam.sx(c.x)), cam.snap(cam.sy(c.y)), Math.ceil(c.canvas.width * z), Math.ceil(c.canvas.height * z));
      if (fog) fog.draw(ctx, cam, cx, cy);
    }
  }
}

// grey lightmap value for a brightness offset d (128 = unchanged)
function shadeColor(d) {
  const v = Math.max(10, Math.min(246, 128 + (d >= 0 ? d * 380 : d * 330))) | 0;
  return `rgb(${v},${v},${v})`;
}
// fill triangle (a,b,c) with values (da,db,dc) linearly interpolated; the
// triangle is grown by ~0.7px so neighbours overlap (same values, no seams)
function gouraud(g, a, da, b, db, c, dc) {
  const ax = b[0] - a[0], ay = b[1] - a[1], bx = c[0] - a[0], by = c[1] - a[1];
  const det = ax * by - ay * bx;
  let fill;
  if (Math.abs(det) < 1e-6) fill = shadeColor((da + db + dc) / 3);
  else {
    const gx = ((db - da) * by - (dc - da) * ay) / det;
    const gy = (ax * (dc - da) - bx * (db - da)) / det;
    const g2 = gx * gx + gy * gy;
    const dmin = Math.min(da, db, dc), dmax = Math.max(da, db, dc);
    if (g2 < 1e-12 || dmax - dmin < 0.002) fill = shadeColor((da + db + dc) / 3);
    else {
      const s0 = (dmin - da) / g2, s1 = (dmax - da) / g2;
      const grd = g.createLinearGradient(a[0] + gx * s0, a[1] + gy * s0, a[0] + gx * s1, a[1] + gy * s1);
      grd.addColorStop(0, shadeColor(dmin));
      if (dmin < 0 && dmax > 0) grd.addColorStop(-dmin / (dmax - dmin), shadeColor(0));
      grd.addColorStop(1, shadeColor(dmax));
      fill = grd;
    }
  }
  const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
  const grow = (p) => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 0.8, p[1] + dy / l * 0.8]; };
  const A = grow(a), B = grow(b), C = grow(c);
  g.fillStyle = fill;
  g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.lineTo(C[0], C[1]); g.closePath(); g.fill();
}
