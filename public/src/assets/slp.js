// SLP 2.0N sprite decoder (Age of Empires / Rise of Rome).
// Every frame is stored as run-length commands per row between left/right
// outline margins. Pixels decode into a palette index plus a "kind":
// normal colour, player colour (index 0..9 inside the player's ramp), shadow
// or obstruction outline.
export const PX_NONE = 0, PX_COLOR = 1, PX_PLAYER = 2, PX_SHADOW = 3, PX_OUTLINE = 4;

export class Slp {
  constructor(bytes) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.version = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const n = this.v.getInt32(4, true);
    this.frames = [];
    for (let i = 0; i < n; i++) {
      const o = 32 + i * 32;
      if (o + 32 > bytes.length) break;
      this.frames.push({
        cmd: this.v.getUint32(o, true), outline: this.v.getUint32(o + 4, true),
        w: this.v.getInt32(o + 16, true), h: this.v.getInt32(o + 20, true),
        hx: this.v.getInt32(o + 24, true), hy: this.v.getInt32(o + 28, true),
      });
    }
  }
  get count() { return this.frames.length; }

  // -> { w, h, hx, hy, idx: Uint8Array, kind: Uint8Array }
  decode(i) {
    const f = this.frames[i];
    if (!f || f.w <= 0 || f.h <= 0 || f.w > 4096 || f.h > 4096) return { w: 1, h: 1, hx: 0, hy: 0, idx: new Uint8Array(1), kind: new Uint8Array(1) };
    const { w, h } = f;
    const b = this.b, v = this.v, len = b.length;
    const idx = new Uint8Array(w * h), kind = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const lo = f.outline + y * 4;
      if (lo + 4 > len) break;
      const left = v.getUint16(lo, true), right = v.getUint16(lo + 2, true);
      if (left === 0x8000 || right === 0x8000) continue;
      let p = v.getUint32(f.cmd + y * 4, true);
      let x = left;
      const row = y * w;
      const put = (k, c) => { if (x >= 0 && x < w) { idx[row + x] = c; kind[row + x] = k; } x++; };
      for (let guard = 0; guard < 8192 && p < len; guard++) {
        const c = b[p++];
        const low2 = c & 3, low4 = c & 15;
        let n;
        if (low2 === 0) { n = c >> 2; for (let k = 0; k < n; k++) put(PX_COLOR, b[p++]); continue; }
        if (low2 === 1) { n = c >> 2 || b[p++]; x += n; continue; }
        switch (low4) {
          case 2: n = ((c & 0xf0) << 4) + b[p++]; for (let k = 0; k < n; k++) put(PX_COLOR, b[p++]); continue;
          case 3: n = ((c & 0xf0) << 4) + b[p++]; x += n; continue;
          case 6: n = c >> 4 || b[p++]; for (let k = 0; k < n; k++) put(PX_PLAYER, b[p++]); continue;
          case 7: { n = c >> 4 || b[p++]; const col = b[p++]; for (let k = 0; k < n; k++) put(PX_COLOR, col); continue; }
          case 10: { n = c >> 4 || b[p++]; const col = b[p++]; for (let k = 0; k < n; k++) put(PX_PLAYER, col); continue; }
          case 11: n = c >> 4 || b[p++]; for (let k = 0; k < n; k++) put(PX_SHADOW, 0); continue;
          case 14:
            if (c === 0x4e || c === 0x6e) put(PX_OUTLINE, 0);
            else if (c === 0x5e || c === 0x7e) { n = b[p++]; for (let k = 0; k < n; k++) put(PX_OUTLINE, 0); }
            continue;
          case 15: break;
          default: break;
        }
        break; // end of row (0x0F) or unknown command
      }
    }
    return { w, h, hx: f.hx, hy: f.hy, idx, kind };
  }
}

// Player colour ramps start at 16 * (colour + 1) in the AoE1 palette
// (blue 16, red 32, yellow 48, brown 64, orange 80, green 96, grey 112, cyan 128).
export function playerRampBase(colorIndex) { return 16 * ((colorIndex & 7) + 1); }

// decoded frame -> RGBA pixels (Uint8ClampedArray)
export function frameRGBA(fr, pal, colorIndex = 0, opts = {}) {
  const out = new Uint8ClampedArray(fr.w * fr.h * 4);
  const base = playerRampBase(colorIndex);
  const shadowA = opts.shadow === undefined ? 110 : opts.shadow;
  const tint = opts.tint || null; // [r,g,b,mix] blend toward a colour (e.g. fog)
  // out of sight: 1 = the original's checkerboard (every other pixel colour 0,
  // black where x + y + parity is odd), 2 = darkened by half instead
  const fog = opts.fog || 0, par = opts.parity || 0;
  for (let i = 0, n = fr.w * fr.h; i < n; i++) {
    const k = fr.kind[i];
    if (k === PX_NONE || k === PX_OUTLINE) continue;
    const o = i * 4;
    if (k === PX_SHADOW) { if (shadowA) { out[o + 3] = shadowA; } continue; }
    const ci = k === PX_PLAYER ? base + Math.min(15, fr.idx[i]) : fr.idx[i];
    let r = pal[ci * 3], g = pal[ci * 3 + 1], b = pal[ci * 3 + 2];
    if (tint) { const m = tint[3]; r += (tint[0] - r) * m; g += (tint[1] - g) * m; b += (tint[2] - b) * m; }
    if (fog === 1) { if ((i % fr.w + ((i / fr.w) | 0) + par) & 1) { r = pal[0]; g = pal[1]; b = pal[2]; } }
    else if (fog === 2) { r *= 0.5; g *= 0.5; b *= 0.5; }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
  }
  return out;
}
