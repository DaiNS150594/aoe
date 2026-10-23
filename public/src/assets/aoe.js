// Runtime access to the player's own Age of Empires: Rise of Rome data:
// sprites (SLP frames rendered to cached canvases per player colour),
// dat graphics with their deltas and animation timing, interface icons,
// terrain textures and sounds.
import { Slp, frameRGBA } from './slp.js';
import { parsePalette } from './drs.js';

const MAX_SPRITES = 7000;
// sprite variants of objects on tiles out of sight
const FOG_CHECK = [{ key: 'f0', fog: 1, parity: 0 }, { key: 'f1', fog: 1, parity: 1 }];
const FOG_DARK = { key: 'fd', fog: 2 };

// interface pictures of interfac.drs (AoE HD build)
export const UI = {
  BARS: { // [Egyptian, Greek, Babylonian, Asian, Roman] per screen width; frame 0 top bar, 1 bottom panel
    1366: [50733, 50734, 50735, 50736, 53010], 1600: [50737, 50738, 50739, 50740, 53011], 1920: [50741, 50742, 50743, 50744, 53012],
  },
  BUTTONS: [50747, 50748, 50749, 50750, 53008], // 108x20, frame 0 normal, 1 pressed
  STAT_ICONS: 50731, // wood, stone, food, gold, population, goods, (picture), attack, armor, time, pierce armor
  HP_BARS: 50745,    // 26 health bars, full -> empty
  CURSORS: 51000,    // arrow, hourglass, move, hand, sword, target, help
  COMMANDS: 50721,   // command button pictures (top-left 50x50 of each frame)
};


export class AoeAssets {
  constructor({ graphics, interfac, sounds, dat, pal, taunts, source }) {
    this.archives = graphics;   // [drs...] searched in order for SLPs
    this.interfac = interfac;
    this.sounds = sounds;
    this.dat = dat;
    this.pal = pal;
    this.taunts = taunts || new Map();
    this.source = source || '';
    this.slps = new Map();
    this.sprites = new Map();
    this.audio = new Map();
    this.textures = null;
    this.iconCache = new Map();
    this.edges = null; // fog of war edge shapes (tileedge.dat / blkedge.dat)
    // Fog shading of the next draws, set by the renderer around objects on
    // tiles out of sight: null, or { fog: 1 (checkerboard) | 2 (darkened),
    // p: parity of the anchor's world pixel (x + y) }.
    this.shade = null;
  }

  // ------------------------------------------------------------ sprites
  slp(id) {
    let s = this.slps.get(id);
    if (s !== undefined) return s;
    s = null;
    for (const a of this.archives) {
      const b = a.get(id);
      if (b && a.ext(id) === 'slp') { try { s = new Slp(b); } catch { s = null; } break; }
    }
    this.slps.set(id, s);
    return s;
  }
  interfaceSlp(id) {
    const key = 'i' + id;
    let s = this.slps.get(key);
    if (s !== undefined) return s;
    const b = this.interfac && this.interfac.get(id);
    s = b ? new Slp(b) : null;
    this.slps.set(key, s);
    return s;
  }

  // one SLP frame as a canvas (cached per player colour)
  sprite(slp, slpKey, frame, color = 0, opts = null) {
    const key = slpKey + '|' + frame + '|' + color + (opts && opts.key ? '|' + opts.key : '');
    let s = this.sprites.get(key);
    if (s) return s;
    const fr = slp.decode(frame);
    const c = makeCanvas(fr.w, fr.h);
    const g = c.getContext('2d');
    const id = g.createImageData(fr.w, fr.h);
    id.data.set(frameRGBA(fr, this.pal, color, opts || undefined));
    g.putImageData(id, 0, 0);
    s = { c, w: fr.w, h: fr.h, hx: fr.hx, hy: fr.hy };
    this.sprites.set(key, s);
    if (this.sprites.size > MAX_SPRITES) this.sprites.delete(this.sprites.keys().next().value);
    return s;
  }

  graphic(gid) { return gid >= 0 ? this.dat.graphics[gid] || null : null; }

  // seconds for one pass of a graphic's animation (no replay delay)
  duration(gid) {
    const g = this.graphic(gid);
    if (!g) return 0;
    let d = g.frames > 1 ? g.frames * g.frameRate : 0;
    for (const dl of g.deltas) if (dl.gid >= 0 && dl.gid !== gid) d = Math.max(d, this.duration(dl.gid));
    return d;
  }

  // angle index of a graphic for a screen direction (radians, clockwise from
  // "south" = towards the viewer, which is how AoE orders its angles)
  angleOf(g, dir) {
    const A = g.angles || 1;
    if (A <= 1 || dir === undefined || dir === null) return 0;
    let a = Math.round(dir / (Math.PI * 2 / A)) % A;
    if (a < 0) a += A;
    return a;
  }

  // Draw a dat graphic and its deltas with the anchor at (x, y), scale z.
  // o: { dir, facet, time, once, frame, color, frac (0..1 animation position) }
  draw(ctx, gid, x, y, z, o = {}, depth = 0) {
    const g = this.graphic(gid);
    if (!g || depth > 5) return false;
    let drew = false;
    if (g.deltas.length) {
      for (const d of g.deltas) {
        if (d.gid === -1 || d.gid === gid) drew = this.drawSelf(ctx, g, x, y, z, o) || drew;
        else {
          // a delta's anchor moves the checkerboard parity by dx + dy
          const od = this.shade ? { ...o, _fp: ((o._fp ?? this.shade.p) + d.dx + d.dy) & 1 } : o;
          drew = this.draw(ctx, d.gid, x + d.dx * z * (o._mirror ? -1 : 1), y + d.dy * z, z, od, depth + 1) || drew;
        }
      }
      return drew;
    }
    return this.drawSelf(ctx, g, x, y, z, o);
  }

  drawSelf(ctx, g, x, y, z, o) {
    if (g.slp < 0) return false;
    const s = this.slp(g.slp);
    if (!s || !s.count) return false;
    const A = g.angles || 1, F = Math.max(1, g.frames);
    const stored = g.mirror && A > 1 ? (A >> 1) + 1 : A;
    let a = o.facet !== undefined ? Math.min(A - 1, Math.max(0, o.facet)) : this.angleOf(g, o.dir);
    let mirror = false;
    if (a >= stored) { a = A - a; mirror = true; }
    let f = 0;
    if (o.frame !== undefined) f = Math.min(F - 1, o.frame);
    else if (o.frac !== undefined) f = Math.min(F - 1, Math.floor(o.frac * F));
    else if (F > 1 && g.frameRate > 0) {
      const t = Math.max(0, o.time || 0);
      if (o.once) f = Math.min(F - 1, Math.floor(t / g.frameRate));
      else {
        const cycle = F * g.frameRate + (g.replayDelay || 0);
        f = Math.min(F - 1, Math.floor((t % cycle) / g.frameRate));
      }
    }
    const idx = Math.min(s.count - 1, a * F + f);
    let shade = null;
    const sh = this.shade;
    if (sh && sh.fog === 2) shade = FOG_DARK;
    else if (sh) {
      // keep the checkerboard on the world's pixel grid: black where the
      // world pixel's x + y is odd (a mirrored picture runs right to left)
      const fr = s.frames[idx];
      shade = ((o._fp ?? sh.p) + fr.hx + fr.hy + (mirror ? 1 : 0)) & 1 ? FOG_CHECK[1] : FOG_CHECK[0];
    }
    const sp = this.sprite(s, g.slp, idx, o.color || 0, shade);
    if (mirror) {
      ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1);
      ctx.drawImage(sp.c, -sp.hx * z, -sp.hy * z, sp.w * z, sp.h * z);
      ctx.restore();
    } else ctx.drawImage(sp.c, x - sp.hx * z, y - sp.hy * z, sp.w * z, sp.h * z);
    return true;
  }

  // bounding box (relative to the anchor, unscaled) of a graphic's first frame
  bounds(gid, facet = 0) {
    const g = this.graphic(gid);
    if (!g) return null;
    let box = null;
    const add = (b) => {
      if (!b) return;
      if (!box) box = { ...b };
      else { box.x0 = Math.min(box.x0, b.x0); box.y0 = Math.min(box.y0, b.y0); box.x1 = Math.max(box.x1, b.x1); box.y1 = Math.max(box.y1, b.y1); }
    };
    const selfBox = () => {
      const s = g.slp >= 0 ? this.slp(g.slp) : null;
      if (!s || !s.count) return null;
      const f = s.frames[Math.min(s.count - 1, facet * Math.max(1, g.frames))];
      return { x0: -f.hx, y0: -f.hy, x1: f.w - f.hx, y1: f.h - f.hy };
    };
    if (!g.deltas.length) return selfBox();
    for (const d of g.deltas) {
      if (d.gid === -1 || d.gid === gid) add(selfBox());
      else { const b = this.bounds(d.gid, facet); if (b) add({ x0: b.x0 + d.dx, y0: b.y0 + d.dy, x1: b.x1 + d.dx, y1: b.y1 + d.dy }); }
    }
    return box;
  }

  // -------------------------------------------------------------- icons
  // kind: 'unit' (50730), 'tech' (50729), 'building' (per architecture)
  icon(slpId, frame, color = 0) {
    const key = slpId + ':' + frame + ':' + color;
    let c = this.iconCache.get(key);
    if (c !== undefined) return c;
    c = null;
    const s = this.interfaceSlp(slpId);
    if (s && frame >= 0 && frame < s.count) c = this.sprite(s, 'i' + slpId, frame, color).c;
    this.iconCache.set(key, c);
    return c;
  }

  // ------------------------------------------------- interface pictures
  // An interface frame as a PNG data URL (for CSS backgrounds and cursors).
  uiUrl(slpId, frame) {
    const key = 'u' + slpId + ':' + frame;
    if (this.iconCache.has(key)) return this.iconCache.get(key);
    const c = this.icon(slpId, frame);
    const url = c && typeof c.toDataURL === 'function' ? c.toDataURL('image/png') : null;
    this.iconCache.set(key, url);
    return url;
  }
  uiFrame(slpId, frame) {
    const s = this.interfaceSlp(slpId);
    return s && frame < s.count ? s.decode(frame) : null;
  }
  // The AoE HD in-game interface of an architecture (0 Egyptian, 1 Greek,
  // 2 Babylonian, 3 Asian, 4 Roman) for a screen width: top bar, bottom
  // panel and the small top-right button (normal, pressed).
  hudSkin(arch, width) {
    const widths = Object.keys(UI.BARS).map(Number);
    const w = widths.find((x) => x >= width) || widths[widths.length - 1];
    const id = UI.BARS[w][arch];
    if (!this.interfaceSlp(id)) return null;
    const btn = UI.BUTTONS[arch];
    return { width: w, top: this.uiUrl(id, 0), bottom: this.uiUrl(id, 1), button: [this.uiUrl(btn, 0), this.uiUrl(btn, 1)] };
  }
  // Background picture of a menu screen (1 main menu, 2 single player,
  // 10 achievements...): the screen description (bina 50050 + n) names one
  // picture per resolution and the palette. Promise of a blob URL or null.
  screenBackground(n, width = 1920) {
    const key = 'bg' + n;
    if (this.iconCache.has(key)) return this.iconCache.get(key);
    const p = (async () => {
      const sin = this.interfac && this.interfac.get(50050 + n);
      if (!sin) return null;
      const text = new TextDecoder('latin1').decode(sin);
      const ids = [1, 2, 3].map((k) => Number((new RegExp(`background${k}_files\\s+\\S+\\s+\\S+\\s+(-?\\d+)`).exec(text) || [])[1] ?? -1)).filter((id) => id > 0 && this.interfac.has(id));
      const palId = Number((/palette_file\s+\S+\s+(\d+)/.exec(text) || [])[1] || 50500);
      if (!ids.length || !this.interfac.has(palId)) return null;
      const slps = ids.map((id) => ({ id, s: this.interfaceSlp(id) })).filter((x) => x.s);
      if (!slps.length) return null;
      slps.sort((a, b) => a.s.decode(0).w - b.s.decode(0).w);
      const pick = slps.find((x) => x.s.decode(0).w >= width) || slps[slps.length - 1];
      const fr = pick.s.decode(0);
      const c = makeCanvas(fr.w, fr.h);
      const g = c.getContext('2d');
      const img = g.createImageData(fr.w, fr.h);
      img.data.set(frameRGBA(fr, parsePalette(this.interfac.get(palId)), 0));
      g.putImageData(img, 0, 0);
      const blob = c.convertToBlob ? await c.convertToBlob() : await new Promise((r) => c.toBlob(r));
      return blob ? URL.createObjectURL(blob) : null;
    })().catch(() => null);
    this.iconCache.set(key, p);
    return p;
  }

  // command button picture: the 50x50 top-left corner of a 50721 frame
  commandIcon(frame) {
    const key = 'c' + frame;
    if (this.iconCache.has(key)) return this.iconCache.get(key);
    const full = this.icon(UI.COMMANDS, frame);
    let c = null;
    if (full) { c = makeCanvas(50, 50); c.getContext('2d').drawImage(full, 0, 0, 50, 50, 0, 0, 50, 50); }
    this.iconCache.set(key, c);
    return c;
  }
  // CSS cursor value for one of the original mouse pointers
  cursor(frame) {
    const f = this.uiFrame(UI.CURSORS, frame);
    const url = f && this.uiUrl(UI.CURSORS, frame);
    return url ? `url(${url}) ${f.hx} ${f.hy}, auto` : null;
  }

  // ------------------------------------------------------------- terrain
  // Repeating texture assembled from a terrain's flat tile variants, aligned
  // to the isometric grid (period n tiles -> n*64 x n*32 pixels).
  terrainTexture(terrainId, tone = null) {
    const t = this.dat.terrains[terrainId];
    if (!t || t.slp < 0) return null;
    const s = this.slp(t.slp);
    if (!s || !s.count) return null;
    const flat = Math.max(1, Math.min(s.count, t.elevation[0] ? t.elevation[0].frames : 1));
    const n = Math.max(1, Math.round(Math.sqrt(flat)));
    const W = n * 64, H = n * 32;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    for (let j = -n * 2; j <= n * 2; j++) {
      for (let i = -n * 2; i <= n * 2; i++) {
        const v = (((i % n) + n) % n) + (((j % n) + n) % n) * n;
        const sp = this.sprite(s, t.slp, v % flat, 0);
        const X = (i - j) * 32 - 32, Y = (i + j) * 16;
        for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
          const px = ((X % W) + W) % W + ox, py = ((Y % H) + H) % H + oy;
          if (px > W || py > H || px + sp.w < 0 || py + sp.h < 0) continue;
          g.drawImage(sp.c, px, py);
        }
      }
    }
    if (tone) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = tone; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; }
    return c;
  }

  // One tile frame of a terrain (0-8 flat variants, 9-24 slopes), optionally
  // tinted like the terrain textures; null when the terrain has no picture.
  terrainTile(terrainId, frame, tone = null) {
    const key = 't' + terrainId + ':' + frame + ':' + (tone || '');
    if (this.iconCache.has(key)) return this.iconCache.get(key);
    let c = null;
    const t = this.dat.terrains[terrainId];
    const s = t && t.slp >= 0 ? this.slp(t.slp) : null;
    if (s && frame < s.count) {
      const sp = this.sprite(s, t.slp, frame, 0);
      c = sp.c;
      if (tone) {
        c = makeCanvas(sp.w, sp.h);
        const g = c.getContext('2d');
        g.drawImage(sp.c, 0, 0);
        g.globalCompositeOperation = 'source-atop'; g.fillStyle = tone; g.fillRect(0, 0, sp.w, sp.h);
      }
    }
    this.iconCache.set(key, c);
    return c;
  }

  // a frame of a terrain or border SLP: { c, w, h, hx, hy } or null
  tileSprite(slpId, frame) {
    if (slpId < 0 || frame < 0) return null;
    const s = this.slp(slpId);
    if (!s || frame >= s.count) return null;
    return this.sprite(s, slpId, frame, 0);
  }

  paletteColor(i) { return `rgb(${this.pal[i * 3]},${this.pal[i * 3 + 1]},${this.pal[i * 3 + 2]})`; }

  // --------------------------------------------------------------- sound
  // pick one file of a dat sound (weighted by probability) -> resource id
  pickSound(soundId) {
    const s = this.dat.sounds.get(soundId);
    if (!s || !s.items.length) return -1;
    const items = s.items.filter((i) => i.resource >= 0 && this.sounds && this.sounds.has(i.resource));
    if (!items.length) return -1;
    const total = items.reduce((a, i) => a + Math.max(1, i.probability), 0);
    let r = Math.random() * total;
    for (const i of items) { r -= Math.max(1, i.probability); if (r <= 0) return i.resource; }
    return items[items.length - 1].resource;
  }
  // decoded AudioBuffer for a sound.drs resource (Promise, cached)
  audioBuffer(actx, resId) {
    const key = 'r' + resId;
    let p = this.audio.get(key);
    if (p) return p;
    const bytes = this.sounds && this.sounds.get(resId);
    if (!bytes) return Promise.resolve(null);
    p = actx.decodeAudioData(bytes.slice().buffer).catch(() => null);
    this.audio.set(key, p);
    return p;
  }
  tauntBuffer(actx, n) {
    const key = 't' + n;
    let p = this.audio.get(key);
    if (p) return p;
    const src = this.taunts.get(n); // ArrayBuffer, or the URL of a project file
    if (!src) return Promise.resolve(null);
    const bytes = typeof src === 'string' ? fetch(src).then((r) => r.arrayBuffer()) : Promise.resolve(src.slice(0));
    p = bytes.then((b) => actx.decodeAudioData(b)).catch(() => null);
    this.audio.set(key, p);
    return p;
  }
}

export function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    return c;
  }
  return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
}
