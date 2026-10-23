// Isometric projection (AoE1 uses 64x32 diamond tiles) and the camera.
export const TW = 64, TH = 32, HW = 32, HH = 16;
export const EPX = 16; // screen pixels per elevation level

export function isoX(x, y) { return (x - y) * HW; }
export function isoY(x, y, z) { return (x + y) * HH - z * EPX; }

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;      // iso-space point at the centre of the view (zoom 1)
    this.zoom = 1;
    this.w = 800; this.h = 600;  // viewport size in CSS pixels
    this.dpr = 1;                // device pixels per CSS pixel
  }
  // the picture is scaled by a whole number of device pixels (drawn crisp)
  get crisp() { const s = this.zoom * this.dpr; return s >= 1 && Math.abs(s - Math.round(s)) < 0.01; }
  // canvas position of the iso origin, kept on whole device pixels: the
  // picture then scrolls by whole pixels like the original's view, and the
  // ground and the things standing on it never shift against each other.
  // Drawn crisp, it moves 2 picture pixels at a time so that the fog's
  // checkerboard stays still on the screen, as in the original (whose masks
  // are picked by the screen row, 005459A0), instead of flickering
  get ox() { return this.origin(this.w / 2 - this.x * this.zoom); }
  get oy() { return this.origin(this.h / 2 - this.y * this.zoom); }
  origin(v) {
    const g = this.crisp ? 2 * Math.round(this.zoom * this.dpr) : 1;
    return Math.round(v * this.dpr / g) * g / this.dpr;
  }
  // iso-space -> canvas pixels
  sx(ix) { return ix * this.zoom + this.ox; }
  sy(iy) { return iy * this.zoom + this.oy; }
  // a canvas position rounded to whole device pixels
  snap(v) { return Math.round(v * this.dpr) / this.dpr; }
  // world tile coords -> canvas pixels
  project(x, y, z) { return { x: this.sx(isoX(x, y)), y: this.sy(isoY(x, y, z)) }; }
  // canvas pixels -> iso space
  ix(px) { return (px - this.ox) / this.zoom; }
  iy(py) { return (py - this.oy) / this.zoom; }
  // canvas pixels -> world tile coordinates (accounting for terrain height)
  unproject(px, py, map) {
    const IX = this.ix(px), IY = this.iy(py);
    let z = 0, x = 0, y = 0;
    for (let i = 0; i < 4; i++) {
      const a = IX / HW, b = (IY + z * EPX) / HH;
      x = (a + b) / 2; y = (b - a) / 2;
      if (!map) break;
      z = map.heightAt(Math.max(0, Math.min(map.w - 0.01, x)), Math.max(0, Math.min(map.h - 0.01, y)));
    }
    return { x, y };
  }
  centerOn(x, y, z = 0) { this.x = isoX(x, y); this.y = isoY(x, y, z); }
  clamp(map) {
    const minX = -map.h * HW, maxX = map.w * HW;
    const minY = 0, maxY = (map.w + map.h) * HH;
    this.x = Math.max(minX + 100, Math.min(maxX - 100, this.x));
    this.y = Math.max(minY, Math.min(maxY, this.y));
  }
}

// 8 screen directions from a tile-space vector: 0=E 1=SE 2=S 3=SW 4=W 5=NW 6=N 7=NE
export function screenDir(fx, fy) {
  const sx = (fx - fy) * HW, sy = (fx + fy) * HH;
  if (sx === 0 && sy === 0) return 2;
  const a = Math.atan2(sy, sx); // render-side only, determinism not needed
  let d = Math.round(a / (Math.PI / 4));
  if (d < 0) d += 8;
  return d % 8;
}
