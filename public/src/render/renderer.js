// Main world renderer: terrain, entities (depth sorted), projectiles,
// effects, fog of war and selection overlays.
import { Camera, HW, HH, EPX, isoX, isoY, screenDir } from './iso.js';
import { TerrainRenderer } from './terrain.js';
import { Fog } from './fog.js';
import { FogLayer } from './fog-layer.js';
import { Birds } from './birds.js';
import {
  unitSprite, buildingSprite, farmSprite, foundationSprite, treeSprite, resourceSprite, carcassSprite,
  rubbleSprite, buildingHeight,
} from './sprites.js';
import { GAIA_COLOR } from '../engine/constants.js';
import { UNITS } from '../engine/data/units.js';
import { BUILDINGS } from '../engine/data/buildings.js';
import { TICK_MS } from '../engine/constants.js';
import { AoeRender } from './aoe-render.js';
import { aoe } from '../assets/loader.js';
import { GFX } from '../assets/mapping.js';

const ANIM = {
  walk: { a: 'walk', n: 8, period: 0.72 },
  run: { a: 'walk', n: 8, period: 0.45 },
  attack: { a: 'attack', n: 6 },
  hunt: { a: 'attack', n: 6 },
  work: { a: 'work', n: 6, period: 1.1 },
  build: { a: 'work', n: 6, period: 0.9 },
  chant: { a: 'chant', n: 4, period: 1.0 },
  heal: { a: 'chant', n: 4, period: 1.0 },
};

export class Renderer {
  constructor(canvas, world, playerId, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.pid = playerId;
    this.cam = new Camera();
    this.terrain = new TerrainRenderer(world.map);
    this.fog = new Fog(world, playerId, opts.spectator);
    this.corpses = [];
    this.rubble = [];
    this.effects = [];
    this.markers = [];
    this.selection = new Set();
    this.placement = null;
    this.dragBox = null;
    this.drawn = [];
    this.dpr = this.cam.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.showHp = false;
    this.fogTimer = 0;
    this.aoe = new AoeRender(this);
    this.birds = new Birds(world.map, world.settings.seed >>> 0);
    // terrain decorations (grass tufts, rocks, bones, cactus...) by 8x8-tile cell
    const m = world.map;
    this.decorCells = { cw: Math.ceil(m.w / 8), list: new Map() };
    for (const d of m.decor) {
      const k = Math.floor(d.y / 8) * this.decorCells.cw + Math.floor(d.x / 8);
      if (!this.decorCells.list.has(k)) this.decorCells.list.set(k, []);
      this.decorCells.list.get(k).push(d);
    }
  }

  // decorations around the view, back to front (drawn on the ground layer)
  visibleDecor(fog, inView) {
    const cam = this.cam, m = this.world.map, D = this.decorCells;
    if (!D.list.size) return [];
    const pts = [[0, 0], [cam.w, 0], [cam.w, cam.h], [0, cam.h]].map(([px, py]) => {
      const a = cam.ix(px) / HW, b = (cam.iy(py) + 8 * EPX) / HH;
      return [(a + b) / 2, (b - a) / 2];
    });
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])) / 8) - 1), x1 = Math.min(D.cw - 1, Math.floor(Math.max(...pts.map((p) => p[0])) / 8) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])) / 8) - 1), y1 = Math.min(Math.ceil(m.h / 8) - 1, Math.floor(Math.max(...pts.map((p) => p[1])) / 8) + 1);
    const out = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const l = D.list.get(cy * D.cw + cx);
        if (!l) continue;
        for (const d of l) {
          if (!fog.exp(d.x, d.y)) continue;
          const p = this.proj(d.x, d.y);
          if (inView(p.x, p.y)) out.push({ d, p });
        }
      }
    }
    out.sort((a, b) => (a.d.x + a.d.y) - (b.d.x + b.d.y));
    return out;
  }

  resize(w, h) {
    this.cam.w = w; this.cam.h = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  colorOf(owner) { const p = this.world.players[owner]; return p ? p.color : GAIA_COLOR; }

  // ------------------------------------------------------------ sim events
  onEvents(events, now) {
    for (const ev of events) {
      switch (ev.t) {
        case 'death': {
          const def = UNITS[ev.type];
          if (!def) break;
          if (def.cls.includes('animal') && this.world.carcassOf && this.world.carcassOf.has(ev.id)) break;
          this.corpses.push({ type: ev.type, owner: ev.owner, task: ev.task || null, col: this.colorOf(ev.owner), x: ev.x, y: ev.y, fx: ev.fx, fy: ev.fy, t0: now, life: aoe() ? 60000 : 20000, siege: def.cls.includes('siege') });
          if (this.corpses.length > 300) this.corpses.shift();
          break;
        }
        case 'destroyed':
          if (ev.reason === 'exhausted' || ev.reason === 'cancel') break;
          if (ev.built !== false) this.rubble.push({ size: ev.size, x: ev.x, y: ev.y, t0: now });
          if (aoe() && ev.built !== false) this.effects.push({ k: 'gfx', gid: GFX.explode[Math.min(3, ev.size)] || GFX.explode[3], x: ev.x, y: ev.y, t0: now, dur: 900 });
          else this.effects.push({ k: 'dust', x: ev.x, y: ev.y, r: ev.size * 0.8, t0: now, dur: 1400 });
          break;
        case 'impact':
          if (aoe() && ev.kind === 'stone') this.effects.push({ k: 'gfx', gid: GFX.cataExplosion, x: ev.x, y: ev.y, t0: now, dur: 600 });
          else this.effects.push({ k: ev.kind === 'stone' ? 'dust' : 'puff', x: ev.x, y: ev.y, r: Math.max(0.4, ev.r || 0.4), t0: now, dur: 700 });
          break;
        case 'nuke':
          this.effects.push({ k: 'nuke', x: ev.x, y: ev.y, r: ev.r, t0: now, dur: 2200 });
          break;
        case 'converted':
          this.effects.push({ k: 'convert', x: ev.x, y: ev.y, t0: now, dur: 1200 });
          break;
        case 'treefall':
          break;
      }
    }
  }

  addMarker(x, y, kind) { this.markers.push({ x, y, kind, t0: performance.now() }); }

  // --------------------------------------------------------------- helpers
  heightAt(x, y) {
    const m = this.world.map;
    return m.heightAt(Math.max(0, Math.min(m.w - 0.01, x)), Math.max(0, Math.min(m.h - 0.01, y)));
  }
  // screen anchor of a world point, on whole device pixels like the terrain's
  proj(x, y, zExtra = 0) {
    const z = this.heightAt(x, y), cam = this.cam;
    return { x: cam.snap(cam.sx(isoX(x, y))), y: cam.snap(cam.sy(isoY(x, y, z)) - zExtra * cam.zoom) };
  }

  // ------------------------------------------------------------------ draw
  draw(alpha, now) {
    const ctx = this.ctx, cam = this.cam, w = this.world, z = cam.zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const devScale = z * this.dpr;
    ctx.imageSmoothingEnabled = !(aoe() && Math.abs(devScale - Math.round(devScale)) < 0.05);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cam.w, cam.h);
    if (now - this.fogTimer > 90) { this.fog.update(); this.fogTimer = now; }
    const fog = this.fog;
    // with the original's edge shapes, fog is drawn over the terrain and the
    // objects on tiles out of sight are shaded one by one (else: overlay at the end)
    const fl = this.fogLayerFor();
    this.terrain.draw(ctx, cam, fl);
    const assets = fl ? aoe().assets : null;
    const shade = (x, y) => {
      if (!assets) return;
      assets.shade = fog.vis(x, y) ? null : { fog: fl.crisp ? 1 : 2, p: (Math.round(isoX(x, y)) + Math.round(isoY(x, y, this.heightAt(x, y)))) & 1 };
    };

    const margin = 160 * z;
    const inView = (sx, sy) => sx > -margin && sx < cam.w + margin && sy > -margin && sy < cam.h + margin * 1.6;
    const items = [];
    const ground = [];
    const pid = this.pid;
    // rubble & corpses (ground layer)
    this.rubble = this.rubble.filter((r) => now - r.t0 < 40000);
    for (const r of this.rubble) {
      const p = this.proj(r.x, r.y);
      if (!inView(p.x, p.y) || !fog.exp(r.x, r.y)) continue;
      ground.push({ k: 'rubble', r, p });
    }
    this.corpses = this.corpses.filter((c) => now - c.t0 < (c.life || 20000));
    for (const c of this.corpses) {
      const p = this.proj(c.x, c.y);
      if (!inView(p.x, p.y) || !fog.vis(c.x, c.y)) continue;
      ground.push({ k: 'corpse', c, p });
    }

    for (const e of w.list) {
      if (e.dead) continue;
      let x = e.x, y = e.y;
      if (e.kind === 'unit') { x = e.px + (e.x - e.px) * alpha; y = e.py + (e.y - e.py) * alpha; }
      if (!fog.shows(e, x, y, pid)) continue;
      const p = this.proj(x, y);
      if (!inView(p.x, p.y)) continue;
      if (e.kind === 'building' && (e.type === 'farm' || !e.built)) { ground.push({ k: 'bground', e, p }); if (e.type === 'farm') continue; }
      const depth = e.kind === 'building' ? e.tx + e.ty + e.size - 0.2 : x + y;
      items.push({ e, x, y, p, depth });
    }
    // ground layer: decorations, then rubble, corpses, farms and foundations
    if (aoe()) for (const { d, p } of this.visibleDecor(fog, inView)) { shade(d.x, d.y); this.aoe.decor(d, p); }
    for (const gi of ground) {
      const at = gi.r || gi.c || gi.e;
      shade(at.x, at.y);
      if (gi.k === 'rubble') {
        ctx.globalAlpha = Math.min(1, (40000 - (now - gi.r.t0)) / 5000);
        if (!this.aoe.rubble(gi.r.size, gi.p)) {
          const spr = rubbleSprite(gi.r.size);
          ctx.drawImage(spr.c, gi.p.x - spr.ax * z, gi.p.y - spr.ay * z, spr.w * z, spr.h * z);
        }
        ctx.globalAlpha = 1;
      } else if (gi.k === 'corpse') { if (!this.aoe.corpse(gi.c, gi.p, now)) this.drawCorpse(gi.c, gi.p, now); }
      else if (gi.k === 'bground') {
        const e = gi.e;
        if (this.aoe.groundBuilding(e, gi.p)) continue;
        if (e.type === 'farm') {
          const stage = !e.built ? 0 : e.food > 0.66 * 400 ? 3 : e.food > 120 ? 2 : 1;
          const spr = farmSprite(e.built ? stage : 0, e.size);
          ctx.drawImage(spr.c, gi.p.x - spr.ax * z, gi.p.y - spr.ay * z, spr.w * z, spr.h * z);
          if (!e.built) this.drawScaffold(e, gi.p);
        } else {
          const spr = foundationSprite(e.size);
          ctx.drawImage(spr.c, gi.p.x - spr.ax * z, gi.p.y - spr.ay * z, spr.w * z, spr.h * z);
        }
      }
    }
    // birds fly in game time; their shadows lie on the ground, the birds above everything
    const A = aoe();
    if (A) { this.birds.update((w.tick + alpha) * TICK_MS / 1000); this.birds.draw(this, A, true, shade); }
    items.sort((a, b) => a.depth - b.depth || a.e.id - b.e.id);
    this.drawn = items;
    for (const it of items) {
      const e = it.e;
      shade(it.x, it.y);
      if (e.kind === 'unit') this.drawUnit(e, it.p, alpha, now);
      else if (e.kind === 'building') this.drawBuilding(e, it.p, now);
      else if (e.kind === 'cliff') this.drawCliff(e, it.p);
      else this.drawResource(e, it.p);
    }
    if (A) this.birds.draw(this, A, false, shade);
    if (assets) assets.shade = null;
    this.drawProjectiles(alpha);
    this.drawEffects(now);
    if (!fl) this.drawFog();
    this.drawOverlays(alpha, now);
  }

  // the original's fog of war, when its edge shapes are loaded (null: the
  // overlay of drawFog() instead); checkerboard only at whole-number scales
  fogLayerFor() {
    const A = aoe(), edges = A && A.assets.edges;
    if (!edges || this.fog.spectator) { this.fogLayer = null; return null; }
    if (!this.fogLayer || this.fogLayer.edges !== edges) this.fogLayer = new FogLayer(this.terrain, this.fog, edges);
    const fl = this.fogLayer;
    fl.setCrisp(this.cam.crisp);
    fl.sync();
    fl.begin();
    return fl;
  }

  drawUnit(e, p, alpha, now) {
    const ctx = this.ctx, z = this.cam.zoom;
    if (this.aoe.unit(e, p, alpha)) return;
    const col = this.colorOf(e.owner);
    const dir = screenDir(e.fx, e.fy);
    const mirror = dir === 3 || dir === 4 || dir === 5;
    const vdir = dir === 2 ? 2 : dir === 6 ? 6 : 0;
    const A = ANIM[e.anim];
    let anim = 'idle', frame = 0, n = 1;
    const t = (this.world.tick - e.animT + alpha) * (TICK_MS / 1000);
    if (A) {
      anim = A.a; n = A.n;
      if (A.period) frame = Math.floor(((t / A.period) % 1) * n);
      else frame = Math.min(n - 1, Math.floor((t / Math.max(0.3, (e.stats.windup || 0.5) * 1.8)) * n));
    }
    let extra = '';
    if (e.type === 'villager') {
      const carry = e.carry > 0.5 && (anim === 'walk' || anim === 'idle') ? ({ forage: 'food', hunt: 'food', farm: 'food', wood: 'wood', gold: 'gold', stone: 'stone' }[e.carryKind] || '') : '';
      extra = (e.task || '') + ',' + carry;
    }
    const spr = unitSprite(e.type, col, vdir, anim, frame, n, extra);
    if (mirror) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(-1, 1);
      ctx.drawImage(spr.c, -spr.ax * z, -spr.ay * z, spr.w * z, spr.h * z);
      ctx.restore();
    } else ctx.drawImage(spr.c, p.x - spr.ax * z, p.y - spr.ay * z, spr.w * z, spr.h * z);
    if (e.anim === 'chant') {
      const r = (8 + ((now / 60) % 8)) * z;
      ctx.strokeStyle = 'rgba(255,240,120,0.6)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y - 30 * z, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  drawCorpse(c, p, now) {
    const ctx = this.ctx, z = this.cam.zoom;
    const age = (now - c.t0) / 1000;
    const dir = screenDir(c.fx, c.fy);
    const mirror = dir === 3 || dir === 4 || dir === 5;
    const spr = unitSprite(c.type, c.col, dir === 2 ? 2 : dir === 6 ? 6 : 0, 'idle', 0, 1, '');
    const fall = c.siege ? 0 : Math.min(1, age / 0.45);
    ctx.save();
    ctx.globalAlpha = age > 14 ? Math.max(0, 1 - (age - 14) / 6) : 1;
    ctx.translate(p.x, p.y);
    if (mirror) ctx.scale(-1, 1);
    ctx.rotate(-fall * Math.PI / 2 * 0.92);
    if (c.siege) ctx.filter = 'brightness(0.45)';
    ctx.drawImage(spr.c, -spr.ax * z, -spr.ay * z, spr.w * z, spr.h * z);
    ctx.restore();
    if (age < 0.6 && !c.siege) {
      ctx.fillStyle = `rgba(150,20,20,${0.5 - age * 0.6})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 6 * z, 3 * z, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawBuilding(e, p, now) {
    const ctx = this.ctx, z = this.cam.zoom;
    if (this.aoe.building(e, p, now)) return;
    const w = this.world;
    const owner = w.players[e.owner];
    const tier = owner ? Math.min(2, owner.age) : 1;
    const arch = owner ? owner.civ.arch : 'greek';
    const spr = buildingSprite(e.type, arch, tier, owner.color, e.size);
    if (!e.built) {
      // construction rising from the ground
      const H = buildingHeight(e.type) + 16;
      const prog = Math.max(0.02, e.progress);
      const clipY = p.y + e.size * HH * z - (e.size * HH * 2 + H) * prog * z;
      ctx.save();
      ctx.beginPath(); ctx.rect(p.x - spr.ax * z, clipY, spr.w * z, spr.h * z); ctx.clip();
      ctx.globalAlpha = 0.95;
      ctx.drawImage(spr.c, p.x - spr.ax * z, p.y - spr.ay * z, spr.w * z, spr.h * z);
      ctx.restore();
      this.drawScaffold(e, p);
      return;
    }
    ctx.drawImage(spr.c, p.x - spr.ax * z, p.y - spr.ay * z, spr.w * z, spr.h * z);
    // fire on damaged buildings (AoE1 style)
    const hpf = e.hp / e.stats.hp;
    if (hpf < 0.66 && e.type !== 'farm') {
      const nf = hpf < 0.25 ? 3 : hpf < 0.5 ? 2 : 1;
      const H = buildingHeight(e.type);
      for (let i = 0; i < nf; i++) {
        const seed = (e.id * 13 + i * 7) % 17 / 17;
        const ox = (seed - 0.5) * e.size * 40 * z, oy = -(H * (0.4 + 0.5 * ((i * 0.37 + seed) % 1)) + 6) * z;
        const fl = 1 + Math.sin(now / 90 + i * 2 + e.id) * 0.25;
        const fx = p.x + ox, fy = p.y + oy;
        const r = (5 + e.size) * fl * z;
        const grd = ctx.createRadialGradient(fx, fy, 0, fx, fy - r * 0.5, r * 1.6);
        grd.addColorStop(0, 'rgba(255,240,140,0.95)'); grd.addColorStop(0.35, 'rgba(255,140,30,0.8)'); grd.addColorStop(1, 'rgba(120,30,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.ellipse(fx, fy - r * 0.4, r * 0.8, r * 1.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(60,60,60,${0.25 + 0.1 * Math.sin(now / 300 + i)})`;
        ctx.beginPath(); ctx.ellipse(fx + Math.sin(now / 700 + i) * 4 * z, fy - r * 2.6 - ((now / 30) % 20) * z, r * 0.9, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawScaffold(e, p) {
    const ctx = this.ctx, z = this.cam.zoom;
    const s = e.size / 2;
    const pts = [[-s, -s], [s, -s], [s, s], [-s, s]].map(([dx, dy]) => [p.x + (dx - dy) * HW * z, p.y + (dx + dy) * HH * z]);
    ctx.strokeStyle = '#6a4a22'; ctx.lineWidth = 1.5 * z;
    const H = (buildingHeight(e.type) * 0.5 + 6) * z * Math.max(0.3, e.progress);
    for (const [x, y] of pts) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - H); ctx.stroke(); }
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y - H) : ctx.moveTo(x, y - H))); ctx.closePath(); ctx.stroke();
  }

  // cliff pieces: the original graphics, or a rock ridge drawn over the footprint
  drawCliff(e, p) {
    if (this.aoe.cliff(e, p)) return;
    const ctx = this.ctx, z = this.cam.zoom;
    const pts = [[-e.rx, -e.ry], [e.rx, -e.ry], [e.rx, e.ry], [-e.rx, e.ry]].map(([dx, dy]) => [p.x + (dx - dy) * HW * z, p.y + (dx + dy) * HH * z]);
    const H = 18 * z;
    ctx.fillStyle = '#6f5a42';
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y - H) : ctx.moveTo(x, y - H))); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4e3e2c';
    ctx.beginPath(); ctx.moveTo(pts[3][0], pts[3][1] - H); ctx.lineTo(pts[2][0], pts[2][1] - H); ctx.lineTo(pts[1][0], pts[1][1] - H);
    ctx.lineTo(pts[1][0], pts[1][1]); ctx.lineTo(pts[2][0], pts[2][1]); ctx.lineTo(pts[3][0], pts[3][1]); ctx.closePath(); ctx.fill();
  }

  drawResource(e, p) {
    const ctx = this.ctx, z = this.cam.zoom;
    if (this.aoe.resource(e, p)) return;
    let spr;
    if (e.type === 'tree') spr = treeSprite(e.variant % 6, e.felled);
    else if (e.type === 'carcass') spr = carcassSprite(e.animal, GAIA_COLOR);
    else {
      const f = e.amount / e.maxAmount;
      spr = resourceSprite(e.type, f > 0.75 ? 3 : f > 0.45 ? 2 : f > 0.15 ? 1 : 0);
    }
    ctx.drawImage(spr.c, p.x - spr.ax * z, p.y - spr.ay * z, spr.w * z, spr.h * z);
  }

  drawProjectiles(alpha) {
    const ctx = this.ctx, z = this.cam.zoom;
    const fog = this.fog;
    for (const pr of this.world.projectiles) {
      const u = Math.min(1, (pr.t + alpha * TICK_MS / 1000) / pr.T);
      const x = pr.x0 + (pr.x1 - pr.x0) * u, y = pr.y0 + (pr.y1 - pr.y0) * u;
      if (!fog.vis(x, y)) continue;
      const h = (pr.z0 * (1 - u)) * 16 + pr.arc * 16 * 4 * u * (1 - u) + 6;
      const p = this.proj(x, y, h);
      const u2 = Math.min(1, u + 0.04);
      const h2 = (pr.z0 * (1 - u2)) * 16 + pr.arc * 16 * 4 * u2 * (1 - u2) + 6;
      const p2 = this.proj(pr.x0 + (pr.x1 - pr.x0) * u2, pr.y0 + (pr.y1 - pr.y0) * u2, h2);
      let dx = p2.x - p.x, dy = p2.y - p.y;
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      if (this.aoe.projectile(pr, p, dx, dy)) continue;
      switch (pr.kind) {
        case 'arrow': case 'spear': {
          const L = (pr.kind === 'spear' ? 9 : 7) * z;
          ctx.strokeStyle = pr.kind === 'spear' ? '#6a4a22' : '#3a2a14'; ctx.lineWidth = 1.1 * z;
          ctx.beginPath(); ctx.moveTo(p.x - dx * L, p.y - dy * L); ctx.lineTo(p.x, p.y); ctx.stroke();
          ctx.fillStyle = '#9a9a9a'; ctx.fillRect(p.x - 1 * z, p.y - 1 * z, 2 * z, 2 * z);
          break;
        }
        case 'bolt':
          ctx.strokeStyle = '#4a3418'; ctx.lineWidth = 2 * z;
          ctx.beginPath(); ctx.moveTo(p.x - dx * 11 * z, p.y - dy * 11 * z); ctx.lineTo(p.x, p.y); ctx.stroke();
          break;
        case 'stone':
          ctx.fillStyle = '#5a5248'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.4 * z, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.25)'; const gp = this.proj(x, y); ctx.beginPath(); ctx.ellipse(gp.x, gp.y, 3 * z, 1.5 * z, 0, 0, Math.PI * 2); ctx.fill();
          break;
        case 'pebble':
          ctx.fillStyle = '#7a746a'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.6 * z, 0, Math.PI * 2); ctx.fill();
          break;
        case 'rocket':
          ctx.strokeStyle = '#ff9020'; ctx.lineWidth = 2.4 * z;
          ctx.beginPath(); ctx.moveTo(p.x - dx * 10 * z, p.y - dy * 10 * z); ctx.lineTo(p.x, p.y); ctx.stroke();
          break;
        case 'laser':
          ctx.strokeStyle = '#60d0ff'; ctx.lineWidth = 2 * z;
          ctx.beginPath(); ctx.moveTo(p.x - dx * 16 * z, p.y - dy * 16 * z); ctx.lineTo(p.x, p.y); ctx.stroke();
          break;
      }
    }
  }

  drawEffects(now) {
    const ctx = this.ctx, z = this.cam.zoom;
    this.effects = this.effects.filter((ef) => now - ef.t0 < ef.dur);
    for (const ef of this.effects) {
      const u = (now - ef.t0) / ef.dur;
      const p = this.proj(ef.x, ef.y);
      if (!this.fog.vis(ef.x, ef.y)) continue;
      if (ef.k === 'gfx') { this.aoe.effect(ef.gid, p, (now - ef.t0) / 1000); continue; }
      if (ef.k === 'dust' || ef.k === 'puff') {
        const r = (ef.r * 22 + u * 18) * z;
        ctx.fillStyle = `rgba(150,130,100,${0.55 * (1 - u)})`;
        ctx.beginPath(); ctx.ellipse(p.x, p.y - u * 10 * z, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      } else if (ef.k === 'convert') {
        const r = (6 + u * 18) * z;
        ctx.strokeStyle = `rgba(255,240,140,${1 - u})`; ctx.lineWidth = 2 * z;
        ctx.beginPath(); ctx.ellipse(p.x, p.y - 10 * z, r, r * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
      } else if (ef.k === 'nuke') {
        const r = ef.r * 40 * z * (0.3 + u);
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        grd.addColorStop(0, `rgba(255,255,220,${1 - u})`); grd.addColorStop(0.5, `rgba(255,160,40,${0.8 * (1 - u)})`); grd.addColorStop(1, 'rgba(120,40,0,0)');
        ctx.fillStyle = grd; ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawFog() {
    const fog = this.fog;
    if (fog.spectator) return;
    const ctx = this.ctx, cam = this.cam, map = this.world.map, z = cam.zoom;
    // tile range covering the screen
    const c = [cam.unproject(0, 0), cam.unproject(cam.w, 0), cam.unproject(0, cam.h + 120 * z), cam.unproject(cam.w, cam.h + 120 * z)];
    const minX = Math.max(0, Math.floor(Math.min(...c.map((q) => q.x))) - 2), maxX = Math.min(map.w - 1, Math.ceil(Math.max(...c.map((q) => q.x))) + 2);
    const minY = Math.max(0, Math.floor(Math.min(...c.map((q) => q.y))) - 2), maxY = Math.min(map.h - 1, Math.ceil(Math.max(...c.map((q) => q.y))) + 2);
    const black = new Path2D(), dark = new Path2D();
    let nb = 0, nd = 0;
    const W = map.w;
    const hz = EPX * z;
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const i = ty * W + tx;
        const ex = fog.explored[i], vi = fog.visible[i];
        if (vi) continue;
        const path = ex ? dark : black;
        const sx = cam.sx(isoX(tx, ty)), sy = cam.sy(isoY(tx, ty, 0));
        if (sx < -80 || sx > cam.w + 80 || sy < -120 || sy > cam.h + 200) continue;
        const hT = map.cornerH(tx, ty) * hz, hR = map.cornerH(tx + 1, ty) * hz, hB = map.cornerH(tx + 1, ty + 1) * hz, hL = map.cornerH(tx, ty + 1) * hz;
        const hw = HW * z, hh = HH * z;
        const gr = ex ? 0.6 : 1.6; // black fog grows a bit more to hide terrain edges
        path.moveTo(sx, sy - hT - gr);
        path.lineTo(sx + hw + gr * 2, sy + hh - hR);
        path.lineTo(sx, sy + 2 * hh - hB + gr);
        path.lineTo(sx - hw - gr * 2, sy + hh - hL);
        path.closePath();
        if (ex) nd++; else nb++;
      }
    }
    if (nd) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill(dark); }
    if (nb) { ctx.fillStyle = '#000'; ctx.fill(black); }
  }

  drawOverlays(alpha, now) {
    const ctx = this.ctx, z = this.cam.zoom, w = this.world;
    // selection boxes + hp bars
    for (const id of this.selection) {
      const e = w.alive(id);
      if (!e) continue;
      if (e.kind === 'unit') {
        const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha;
        const p = this.proj(x, y);
        const r = e.stats.radius;
        const bw = (12 + r * 32) * z, bh = (r > 0.5 ? 60 : r > 0.35 ? 46 : 34) * z;
        this.bracket(p.x - bw / 2, p.y - bh, bw, bh + 3 * z);
        this.hpBar(p.x, p.y - bh - 5 * z, bw, e.hp / e.stats.hp, e.owner);
      } else if (e.kind === 'building') {
        const p = this.proj(e.x, e.y);
        const s = e.size / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        [[-s, -s], [s, -s], [s, s], [-s, s]].forEach(([dx, dy], i) => { const X = p.x + (dx - dy) * HW * z, Y = p.y + (dx + dy) * HH * z; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.closePath(); ctx.stroke();
        const H = ((this.aoe.buildingHeight(e) ?? buildingHeight(e.type)) + e.size * 10) * z;
        this.hpBar(p.x, p.y - H - 8 * z, e.size * 22 * z, e.hp / e.stats.hp, e.owner);
        if (e.rally && e.owner === this.pid) {
          const rp = this.proj(e.rally.x, e.rally.y);
          ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(rp.x, rp.y); ctx.lineTo(rp.x, rp.y - 16 * z); ctx.stroke();
          ctx.fillStyle = this.colorOf(e.owner).hex;
          ctx.beginPath(); ctx.moveTo(rp.x, rp.y - 16 * z); ctx.lineTo(rp.x + 9 * z, rp.y - 13 * z); ctx.lineTo(rp.x, rp.y - 10 * z); ctx.fill();
        }
      } else if (e.kind === 'resource') {
        const p = this.proj(e.x, e.y);
        this.bracket(p.x - 14 * z, p.y - 26 * z, 28 * z, 28 * z);
      }
    }
    // health bars for damaged own units when "showHp"
    // move / attack markers
    this.markers = this.markers.filter((m) => now - m.t0 < 700);
    for (const m of this.markers) {
      const u = (now - m.t0) / 700;
      const p = this.proj(m.x, m.y);
      ctx.strokeStyle = m.kind === 'attack' ? `rgba(255,60,40,${1 - u})` : `rgba(80,255,80,${1 - u})`;
      ctx.lineWidth = 2;
      const r = (10 - u * 6) * z;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x - r * 0.6, p.y); ctx.lineTo(p.x + r * 0.6, p.y); ctx.moveTo(p.x, p.y - r * 0.3); ctx.lineTo(p.x, p.y + r * 0.3); ctx.stroke();
    }
    // building placement ghost
    const pl = this.placement;
    if (pl) {
      const def = BUILDINGS[pl.type];
      const size = def.size;
      const cx = pl.tx + size / 2, cy = pl.ty + size / 2;
      const p = this.proj(cx, cy);
      const me = w.players[this.pid];
      if (!this.aoe.ghost(pl.type, p, 0.6)) {
        const spr = pl.type === 'farm' ? farmSprite(2, 3) : buildingSprite(pl.type, me.civ.arch, Math.min(2, me.age), me.color, size);
        ctx.globalAlpha = 0.6;
        ctx.drawImage(spr.c, p.x - spr.ax * z, p.y - spr.ay * z, spr.w * z, spr.h * z);
        ctx.globalAlpha = 1;
      }
      const s = size / 2;
      ctx.fillStyle = pl.ok ? 'rgba(60,255,60,0.25)' : 'rgba(255,40,40,0.35)';
      ctx.strokeStyle = pl.ok ? 'rgba(120,255,120,0.9)' : 'rgba(255,90,90,0.9)';
      ctx.beginPath();
      [[-s, -s], [s, -s], [s, s], [-s, s]].forEach(([dx, dy], i) => { const q = this.proj(cx + dx, cy + dy); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (this.dragBox) {
      const b = this.dragBox;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(b.x0, b.x1) + 0.5, Math.min(b.y0, b.y1) + 0.5, Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
  }

  bracket(x, y, w, h) {
    const ctx = this.ctx;
    const c = Math.min(6, w / 3);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
    ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
    ctx.moveTo(x + w, y + h - c); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - c, y + h);
    ctx.moveTo(x + c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - c);
    ctx.stroke();
  }
  hpBar(cx, y, w, f, owner) {
    const ctx = this.ctx;
    f = Math.max(0, Math.min(1, f));
    ctx.fillStyle = '#000'; ctx.fillRect(cx - w / 2 - 1, y - 1, w + 2, 5);
    ctx.fillStyle = '#b01010'; ctx.fillRect(cx - w / 2, y, w, 3);
    ctx.fillStyle = f > 0.5 ? '#20d020' : f > 0.25 ? '#e0d020' : '#e06010';
    ctx.fillRect(cx - w / 2, y, w * f, 3);
  }

  // -------------------------------------------------------------- picking
  pick(px, py) {
    const z = this.cam.zoom;
    let best = null;
    for (let i = this.drawn.length - 1; i >= 0; i--) {
      const it = this.drawn[i];
      const e = it.e, p = it.p;
      if (e.kind === 'unit') {
        const r = e.stats.radius;
        const bw = (12 + r * 32) * z, bh = (r > 0.5 ? 60 : r > 0.35 ? 46 : 34) * z;
        if (px >= p.x - bw / 2 && px <= p.x + bw / 2 && py >= p.y - bh && py <= p.y + 4 * z) return e;
      } else if (e.kind === 'cliff') {
        continue;
      } else if (e.kind === 'building') {
        const s = e.size;
        const H = ((this.aoe.buildingHeight(e) ?? buildingHeight(e.type)) + 6) * z;
        const hw = s * HW * z, hh = s * HH * z;
        // footprint diamond extruded upward
        const dx = Math.abs(px - p.x) / hw;
        if (dx > 1) continue;
        const top = p.y - hh * (1 - dx) - H, bottom = p.y + hh * (1 - dx);
        if (py >= top && py <= bottom) { if (!best) best = e; }
      } else {
        const tall = e.type === 'tree' && !e.felled;
        if (Math.abs(px - p.x) < 14 * z && py > p.y - (tall ? 56 : 22) * z && py < p.y + 8 * z) { if (!best) best = e; }
      }
    }
    // farms are drawn on the ground layer
    if (!best) {
      const wpt = this.cam.unproject(px, py, this.world.map);
      const tx = Math.floor(wpt.x), ty = Math.floor(wpt.y);
      const map = this.world.map;
      if (map.inBounds(tx, ty)) {
        const id = map.block[map.idx(tx, ty)];
        const e = id && this.world.alive(id);
        if (e && e.kind === 'building' && (e.type === 'farm' || !e.built) && this.fog.shows(e, e.x, e.y, this.pid)) return e;
      }
    }
    return best;
  }

  unitsInBox(x0, y0, x1, y1, owner) {
    const out = [];
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    for (const it of this.drawn) {
      const e = it.e;
      if (e.kind !== 'unit' || e.owner !== owner) continue;
      const p = it.p;
      if (p.x >= ax && p.x <= bx && p.y - 10 >= ay && p.y - 10 <= by) out.push(e);
    }
    return out;
  }
}
