// Birds: the pigeons the random map places (Pigeon 95, Pigeon_Big 96 — a few
// pairs, more on bigger maps), flying like the original's fly action
// (vtable 00547080, update 00402140): at height 6 above the map's zero level,
// towards a random point of the map, a new one once there; every 5-15 s they
// switch between flapping (the task's move graphic) and gliding (its proceed
// graphic), their shadow on the ground below. Drawn with the original
// graphics only and, like the original (fog visibility 1), over explored
// ground. Scenery: they are not part of the simulation.
import { isoX, isoY } from './iso.js';
import { aoeDir } from './aoe-render.js';

const HEIGHT = 6;
const KIND = {
  95: { speed: 1, flap: 482, glide: 487 },
  96: { speed: 1.5, flap: 483, glide: 485 },
};

export class Birds {
  constructor(map, seed) {
    this.map = map;
    this.seed = ((seed ^ 0x51ed) >>> 0) || 1;
    this.t = null;
    this.list = (map.birds || []).filter((b) => KIND[b.u]).map((b) => ({ u: b.u, x: b.x, y: b.y, tx: b.x, ty: b.y, fx: 1, fy: 0, glide: false, timer: 0, anim: 0 }));
    for (const b of this.list) { this.pick(b); this.flap(b, false); }
  }
  // the C library's rand() the original uses (0..32767)
  rand() {
    this.seed = (Math.imul(this.seed, 214013) + 2531011) >>> 0;
    return (this.seed >>> 16) & 0x7fff;
  }
  pick(b) {
    b.tx = Math.trunc(this.rand() * this.map.w / 32767);
    b.ty = Math.trunc(this.rand() * this.map.h / 32767);
  }
  flap(b, glide) {
    b.glide = glide;
    b.timer = Math.trunc(this.rand() * 10 / 32767) + 5;
    b.anim = 0;
  }

  // advance to game time t (seconds)
  update(t) {
    const dt = this.t === null ? 0 : Math.max(0, Math.min(1, t - this.t));
    this.t = t;
    if (!dt) return;
    for (const b of this.list) {
      b.anim += dt;
      b.timer -= dt;
      if (b.timer <= 0) this.flap(b, !b.glide);
      const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy), step = KIND[b.u].speed * dt;
      if (d <= step) { b.x = b.tx; b.y = b.ty; this.pick(b); this.flap(b, false); continue; }
      b.x += dx / d * step; b.y += dy / d * step;
      b.fx = dx; b.fy = dy;
    }
  }

  // birds over explored ground: their shadow (on the ground layer) or the
  // birds themselves (above everything); shade(x, y) sets the fog shading
  draw(r, A, shadows, shade) {
    const fog = r.fog, ctx = r.ctx, cam = r.cam, z = cam.zoom;
    for (const b of this.list) {
      if (!fog.exp(b.x, b.y)) continue;
      const k = KIND[b.u], gid = b.glide ? k.glide : k.flap, g = A.assets.graphic(gid);
      if (!g) continue;
      const ground = r.heightAt(b.x, b.y);
      const sx = cam.snap(cam.sx(isoX(b.x, b.y))), sy = cam.snap(cam.sy(isoY(b.x, b.y, shadows ? ground : HEIGHT)));
      if (sx < -80 || sx > cam.w + 80 || sy < -80 || sy > cam.h + 80) continue;
      shade(b.x, b.y);
      const o = { dir: aoeDir(b.fx, b.fy), time: b.anim };
      if (shadows) {
        for (const d of g.deltas) if (d.gid >= 0 && d.gid !== gid) A.assets.draw(ctx, d.gid, sx + d.dx * z, sy + d.dy * z, z, o);
      } else A.assets.drawSelf(ctx, g, sx, sy, z, o);
    }
  }
}
