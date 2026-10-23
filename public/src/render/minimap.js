// Diamond-shaped minimap (AoE1 style): terrain, resources, units in player
// colours, fog of war and the current view outline. Click to move the camera.
import { terrainColor } from './textures.js';
import { isoX, isoY } from './iso.js';
import { slopeFrame } from './terrain.js';
import { aoe } from '../assets/loader.js';

// original minimap colours: each terrain's [lit slope, flat, shaded slope] palette entries
const LIT_SLOPES = new Set([10, 11, 14, 22, 24]), DARK_SLOPES = new Set([12, 15, 16, 23]);
const MINI_GOLD = 52, MINI_STONE = 116, MINI_TREE = 181;

export class Minimap {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.base = null;
    this.tile = document.createElement('canvas');
    this.tile.width = world.map.w; this.tile.height = world.map.h;
    this.dirty = true;
    this.lastDraw = 0;
  }
  // palette colour [r, g, b] when the original data is loaded
  palColor(i) { const p = this.pal; return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]; }
  buildBase() {
    const m = this.world.map;
    const g = this.tile.getContext('2d');
    const img = g.createImageData(m.w, m.h);
    const A = aoe();
    this.src = A ? A.assets : null;
    this.pal = A ? A.assets.pal : null;
    if (A) {
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const i = y * m.w + x;
        const t = A.assets.dat.terrains[m.terrain[i]] || A.assets.dat.terrains[0];
        const f = slopeFrame(m.cornerH(x, y), m.cornerH(x + 1, y), m.cornerH(x + 1, y + 1), m.cornerH(x, y + 1));
        const [r, gg, b] = this.palColor(t.mapColor[LIT_SLOPES.has(f) ? 0 : DARK_SLOPES.has(f) ? 2 : 1]);
        img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
      }
      this.baseImg = img;
      return;
    }
    for (let i = 0; i < m.w * m.h; i++) {
      const c = terrainColor(m.terrain[i]);
      const n = parseInt(c.slice(1), 16);
      const e = m.tileElev[i] * 7;
      img.data[i * 4] = Math.min(255, ((n >> 16) & 255) + e);
      img.data[i * 4 + 1] = Math.min(255, ((n >> 8) & 255) + e);
      img.data[i * 4 + 2] = Math.min(255, (n & 255) + e * 0.5);
      img.data[i * 4 + 3] = 255;
    }
    this.baseImg = img;
  }
  // transform from tile coords to minimap pixels
  setup() {
    const cw = this.canvas.width, ch = this.canvas.height;
    const m = this.world.map;
    // diamond: x axis goes down-right, y axis goes down-left
    this.sx = cw / (m.w + m.h);
    this.sy = ch / (m.w + m.h);
    this.ox = cw / 2 - (0 - 0) * this.sx;
  }
  toMini(x, y) { return [this.canvas.width / 2 + (x - y) * this.sx, (x + y) * this.sy]; }
  fromMini(px, py) {
    const a = (px - this.canvas.width / 2) / this.sx, b = py / this.sy;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }
  draw(fog, cam, pid, now) {
    if (now - this.lastDraw < 120) return;
    this.lastDraw = now;
    const A = aoe();
    if (!this.baseImg || this.src !== (A ? A.assets : null)) this.buildBase();
    this.setup();
    const w = this.world, m = w.map;
    const g = this.canvas.getContext('2d');
    // terrain + fog into tile canvas
    const tg = this.tile.getContext('2d');
    const img = tg.createImageData(m.w, m.h);
    const src = this.baseImg.data, dst = img.data;
    const all = fog.spectator;
    for (let i = 0; i < m.w * m.h; i++) {
      const o = i * 4;
      if (!all && !fog.explored[i]) { dst[o] = 0; dst[o + 1] = 0; dst[o + 2] = 0; dst[o + 3] = 255; continue; }
      const f = all || fog.visible[i] ? 1 : 0.55;
      dst[o] = src[o] * f; dst[o + 1] = src[o + 1] * f; dst[o + 2] = src[o + 2] * f; dst[o + 3] = 255;
    }
    // resources & trees
    const put = (x, y, r, gg, b) => {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) return;
      const o = (y * m.w + x) * 4;
      dst[o] = r; dst[o + 1] = gg; dst[o + 2] = b;
    };
    for (const e of w.list) {
      if (e.dead) continue;
      if (e.kind === 'cliff') {
        if (!all && !fog.explored[e.ty * m.w + e.tx]) continue;
        const [r, gg, b] = this.pal ? this.palColor(157) : [120, 100, 80];
        for (let y = Math.floor(e.y - e.ry + 0.01); y < Math.ceil(e.y + e.ry - 0.01); y++) for (let x = Math.floor(e.x - e.rx + 0.01); x < Math.ceil(e.x + e.rx - 0.01); x++) put(x, y, r, gg, b);
        continue;
      }
      if (e.kind !== 'resource' || e.size === 0) continue;
      if (!all && !fog.explored[e.ty * m.w + e.tx]) continue;
      if (this.pal) {
        // the original shows mines and woods, not berry bushes
        const c = e.type === 'tree' ? MINI_TREE : e.type === 'gold_mine' ? MINI_GOLD : e.type === 'stone_mine' ? MINI_STONE : -1;
        if (c >= 0) put(e.tx, e.ty, ...this.palColor(c));
      } else if (e.type === 'tree') put(e.tx, e.ty, 22, 60, 16);
      else if (e.type === 'gold_mine') put(e.tx, e.ty, 240, 200, 40);
      else if (e.type === 'stone_mine') put(e.tx, e.ty, 170, 170, 160);
      else if (e.type === 'berry_bush') put(e.tx, e.ty, 190, 60, 120);
    }
    tg.putImageData(img, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.save();
    g.imageSmoothingEnabled = false;
    // affine transform: tile (x,y) -> (cw/2 + (x-y)*sx, (x+y)*sy)
    g.setTransform(this.sx, this.sy, -this.sx, this.sy, this.canvas.width / 2, 0);
    g.drawImage(this.tile, 0, 0);
    g.restore();
    // buildings & units
    for (const e of w.list) {
      if (e.dead || e.kind === 'resource' || e.kind === 'cliff') continue;
      const p = w.players[e.owner];
      if (!p) continue;
      if (e.owner === 0) { if (!all && !fog.vis(e.x, e.y)) continue; }
      else if (!all && !fog.shows(e, e.x, e.y, pid)) continue; // players' units and buildings vanish into the fog
      const [mx, my] = this.toMini(e.x, e.y);
      g.fillStyle = e.owner === 0 ? '#e8e8d8' : this.playerColor(p);
      const s = e.kind === 'building' ? Math.max(3, e.size * this.sx * 1.4) : 2.2;
      g.fillRect(mx - s / 2, my - s / 2, s, s);
    }
    // camera view outline
    const corners = [[0, 0], [cam.w, 0], [cam.w, cam.h], [0, cam.h]].map(([px, py]) => {
      const a = cam.ix(px) / 32, b = cam.iy(py) / 16;
      return this.toMini((a + b) / 2, (b - a) / 2);
    });
    g.strokeStyle = '#ffffff'; g.lineWidth = 1;
    g.beginPath(); corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
    // diamond border
    g.strokeStyle = 'rgba(255,230,160,0.5)';
    g.beginPath();
    const d = [this.toMini(0, 0), this.toMini(m.w, 0), this.toMini(m.w, m.h), this.toMini(0, m.h)];
    d.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
    // pings
    if (this.pings) {
      this.pings = this.pings.filter((pg) => now - pg.t < 3000);
      for (const pg of this.pings) {
        const [x, y] = this.toMini(pg.x, pg.y);
        const r = 3 + ((now - pg.t) % 1000) / 1000 * 10;
        g.strokeStyle = pg.color || '#ff3030'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      }
    }
  }
  // player colour on the minimap: the original palette entry of the colour
  playerColor(p) {
    if (!this.pal || p.colorIdx === undefined) return p.color.hex;
    const pc = this.src.dat.playerColors[p.colorIdx % 8];
    if (!pc) return p.color.hex;
    const [r, g, b] = this.palColor(pc.minimap);
    return `rgb(${r},${g},${b})`;
  }
  ping(x, y, color) { (this.pings = this.pings || []).push({ x, y, color, t: performance.now() }); }
}
export { isoX, isoY };
