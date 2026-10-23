// Fog of war drawn the way empires.exe draws it (RGE map view, 00514C10),
// used with the original game files. A tile out of sight is drawn through a
// checkerboard of black pixels (005459A0 with the row masks of 00545680:
// every other pixel cleared to palette colour 0, shifted by one each row), an
// unexplored tile not at all. Lit and fogged tiles next to such tiles take a
// piece of their neighbour's look — the part of a lit tile drawn fogged
// (tileedge.dat) and the part of an explored tile left black (blkedge.dat),
// picked per tile shape by which of the 8 neighbours lack sight / exploration.
//
// Drawn over the terrain, chunk by chunk (the terrain renderer's chunks, each
// fog chunk cached until a tile in or next to it changes). Objects standing on
// tiles out of sight are shaded by the renderer itself, like the original
// shades the objects of the tiles it draws fogged.
import { HW } from './iso.js';
import { edgeCase } from '../assets/edges.js';

const SIGHT = 2, EXPLORED = 1; // tile states: 0 unexplored, 1 explored (fogged), 2 in sight
const BLACK = 0xff000000, HALF = 0x80000000; // RGBA little endian
const MAX_CACHE = 40;

export class FogLayer {
  constructor(terrain, fog, edges) {
    this.t = terrain;
    this.fog = fog;
    this.edges = edges;
    const m = terrain.map;
    this.W = m.w; this.H = m.h;
    this.state = new Uint8Array(m.w * m.h);
    this.synced = -1;
    this.ver = new Uint32Array(terrain.cw * terrain.ch);
    this.cache = new Map();
    this.crisp = true;
    this.budget = 0;
    this.rendered = 0;
    // tile shape and the top of the tile's picture, per tile (the map's
    // elevation never changes)
    this.shape = new Uint8Array(m.w * m.h);
    this.top = new Int32Array(m.w * m.h);
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        const i = ty * m.w + tx, q = terrain.tileQuad(tx, ty, 0, 0);
        this.shape[i] = terrain.slopeTypeAt(tx, ty);
        this.top[i] = Math.round(Math.min(q.T[1], q.R[1], q.B[1], q.L[1]));
      }
    }
    this.cls = null;
    this.img = null;
  }

  // crisp: the checkerboard (the view is scaled by a whole number);
  // otherwise half-dark fog, which a scaled checkerboard would only blur
  setCrisp(on) {
    if (on === this.crisp) return;
    this.crisp = on;
    this.cache.clear();
  }

  // take the fog's latest state; chunks whose tiles (or their neighbours) changed go stale
  sync() {
    const f = this.fog;
    if (f.version === this.synced) return;
    this.synced = f.version;
    const st = this.state, vis = f.visible, exp = f.explored, W = this.W;
    for (let i = 0; i < st.length; i++) {
      const s = vis[i] ? SIGHT : exp[i] ? EXPLORED : 0;
      if (s !== st[i]) { st[i] = s; this.touch(i % W, (i / W) | 0); }
    }
  }
  touch(tx, ty) {
    const CS = this.t.cs;
    const cx0 = Math.max(0, Math.floor((tx - 2) / CS)), cx1 = Math.min(this.t.cw - 1, Math.floor((tx + 2) / CS));
    const cy0 = Math.max(0, Math.floor((ty - 2) / CS)), cy1 = Math.min(this.t.ch - 1, Math.floor((ty + 2) / CS));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.ver[cy * this.t.cw + cx]++;
  }

  // start of a frame: re-rendering stale chunks is spread over frames
  begin() { this.budget = performance.now() + 8; this.rendered = 0; }

  entry(cx, cy) {
    const key = cy * this.t.cw + cx;
    let e = this.cache.get(key);
    if (e && (e.ver === this.ver[key] || (this.rendered > 0 && performance.now() > this.budget))) {
      this.cache.delete(key); this.cache.set(key, e);
      return e;
    }
    e = this.render(cx, cy, e);
    this.rendered++;
    this.cache.delete(key);
    this.cache.set(key, e);
    if (this.cache.size > Math.max(MAX_CACHE, this.t.limit)) this.cache.delete(this.cache.keys().next().value);
    return e;
  }

  // the whole chunk unexplored: neither terrain nor fog needs drawing
  hidden(cx, cy) { return this.entry(cx, cy).hidden; }

  draw(ctx, cam, cx, cy) {
    const e = this.entry(cx, cy);
    if (!e.canvas) return;
    const z = cam.zoom;
    ctx.drawImage(e.canvas, cam.snap(cam.sx(e.x)), cam.snap(cam.sy(e.y)), Math.ceil(e.canvas.width * z), Math.ceil(e.canvas.height * z));
  }

  render(cx, cy, old) {
    const t = this.t, box = t.chunkBox(cx, cy), W = this.W, H = this.H, st = this.state;
    const e = { ver: this.ver[cy * t.cw + cx], x: box.left, y: box.top, canvas: null, hidden: false };
    let lit = true, unexplored = true;
    for (let y = Math.max(0, box.y0 - 1); y < Math.min(H, box.y1 + 1); y++) {
      for (let x = Math.max(0, box.x0 - 1); x < Math.min(W, box.x1 + 1); x++) {
        const s = st[y * W + x];
        if (s !== SIGHT) lit = false;
        if (s && x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) unexplored = false;
      }
    }
    if (lit) return e;
    if (unexplored) { e.hidden = true; return e; }
    // per pixel: 0 drawn as is, 1 fogged, 2 black — tile by tile, back to
    // front, so tiles in front cover the ones behind like the original's
    const w = box.w, h = box.h, n = w * h;
    if (!this.cls || this.cls.length < n) this.cls = new Uint8Array(n);
    const cls = this.cls;
    cls.fill(0, 0, n);
    let minY = h, maxY = -1;
    const paint = (sp, ax, ay, v) => {
      if (!sp) return;
      for (let k = 0; k < sp.length; k += 3) {
        const y = ay + sp[k];
        if (y < 0 || y >= h) continue;
        const a = Math.max(0, ax + sp[k + 1]), b = Math.min(w, ax + sp[k + 2] + 1);
        if (a >= b) continue;
        cls.fill(v, y * w + a, y * w + b);
        if (v) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
    };
    const E = this.edges;
    for (let s = box.x0 + box.y0; s <= box.x1 + box.y1 - 2; s++) {
      for (let tx = Math.max(box.x0, s - box.y1 + 1); tx <= Math.min(box.x1 - 1, s - box.y0); tx++) {
        const ty = s - tx, i = ty * W + tx, v = st[i];
        if (v === SIGHT && this.allInSight(tx, ty)) continue;
        const sh = this.shape[i], ax = (tx - ty - 1) * HW - box.left, ay = this.top[i] - box.top;
        if (!v) { paint(E.full[sh], ax, ay, 2); continue; }
        if (v === EXPLORED) paint(E.full[sh], ax, ay, 1);
        else {
          paint(E.full[sh], ax, ay, 0);
          const c = edgeCase(st, SIGHT, W, H, tx, ty);
          if (c) paint(E.fog[sh][c], ax, ay, 1);
        }
        const c = edgeCase(st, EXPLORED, W, H, tx, ty);
        if (c) paint(E.black[sh][c], ax, ay, 2);
      }
    }
    if (maxY < 0) return e;
    if (!this.img || this.img.width < w || this.img.height < h) this.img = new ImageData(Math.max(w, this.img ? this.img.width : 0), Math.max(h, this.img ? this.img.height : 0));
    const img = this.img, px = new Uint32Array(img.data.buffer), stride = img.width;
    for (let y = minY; y <= maxY; y++) {
      const r = y * w, o = y * stride;
      for (let x = 0; x < w; x++) {
        const c = cls[r + x];
        px[o + x] = c === 2 ? BLACK : c === 1 ? (this.crisp ? ((x + y) & 1 ? BLACK : 0) : HALF) : 0;
      }
    }
    let canvas = old && old.canvas;
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
    }
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.putImageData(img, 0, 0, 0, minY, w, maxY - minY + 1);
    e.canvas = canvas;
    return e;
  }

  allInSight(tx, ty) {
    const st = this.state, W = this.W, H = this.H;
    for (let y = Math.max(0, ty - 1); y <= Math.min(H - 1, ty + 1); y++) {
      for (let x = Math.max(0, tx - 1); x <= Math.min(W - 1, tx + 1); x++) if (st[y * W + x] !== SIGHT) return false;
    }
    return true;
  }
}
