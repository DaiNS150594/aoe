// Tile map. Terrain ids are Rise of Rome's (empires.dat); elevation is per
// tile like the original (0..7, one level per step between neighbours) and the
// corner heights used for unit z and picking follow from it: a corner is as
// high as the highest tile touching it, which is exactly how the original's
// slope tiles are drawn.
import { ORIGINAL_TERRAINS } from './data/original-map.js';

export const TERRAIN = {
  GRASS: 0, WATER: 1, BEACH: 2, SHALLOWS: 4, DESERT: 6, FOREST: 10, DIRT: 11, PALM_DESERT: 13,
  DESERT_IMPASSABLE: 14, WATER_IMPASSABLE: 15, GRASS_IMPASSABLE: 16, PINE_FOREST: 19, JUNGLE: 20, DEEP_WATER: 22,
};
// land units can walk on it (terrain restriction 7 of empires.dat)
export const TERRAIN_PASSABLE = Array.from({ length: 32 }, (_, i) => !!(ORIGINAL_TERRAINS[i] && ORIGINAL_TERRAINS[i].land));
// terrain drawn in its place (forests are grass under the trees, palm desert is desert...)
export const TERRAIN_DRAWN = Array.from({ length: 32 }, (_, i) => {
  const t = ORIGINAL_TERRAINS[i];
  return t && t.repl >= 0 ? t.repl : i;
});
export const isForestTerrain = (t) => t === 10 || t === 19 || t === 20 || t === 13;
export const isDesertTerrain = (t) => TERRAIN_DRAWN[t] === 6;
export const isWaterTerrain = (t) => t === 1 || t === 4 || t === 15 || t === 22;
export const MAX_ELEV = 7;

export class GameMap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.terrain = new Uint8Array(w * h);
    this.elev = new Uint8Array(w * h);                 // elevation level of each tile
    this.heights = new Uint8Array((w + 1) * (h + 1)); // corner heights (derived from elev)
    this.tileElev = new Float64Array(w * h);           // average height of a tile
    this.block = new Int32Array(w * h);                // id of entity blocking the tile (0 = free)
    this.variant = new Uint8Array(w * h);              // visual variation per tile
    this.decor = [];                                   // terrain decorations: { u: unit id, x, y }
    this.birds = [];                                   // where the birds start: { u: unit id, x, y } (drawn only)
  }
  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  cornerH(x, y) { return this.heights[y * (this.w + 1) + x]; }
  setCornerH(x, y, v) { this.heights[y * (this.w + 1) + x] = v; }
  elevAtTile(x, y) { return this.inBounds(x, y) ? this.elev[y * this.w + x] : 0; }

  // corner heights from the tile elevations, then the tile averages
  computeHeights() {
    const { w, h } = this, W = w + 1;
    for (let cy = 0; cy <= h; cy++) {
      for (let cx = 0; cx <= w; cx++) {
        let m = 0;
        for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && y >= 0 && x < w && y < h && this.elev[y * w + x] > m) m = this.elev[y * w + x];
        }
        this.heights[cy * W + cx] = m;
      }
    }
    this.computeTileElev();
  }

  computeTileElev() {
    const W = this.w + 1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const h = this.heights;
        this.tileElev[y * this.w + x] =
          (h[y * W + x] + h[y * W + x + 1] + h[(y + 1) * W + x] + h[(y + 1) * W + x + 1]) / 4;
      }
    }
  }

  // Bilinear ground height at a continuous position (tile units).
  heightAt(fx, fy) {
    if (fx < 0) fx = 0; if (fy < 0) fy = 0;
    if (fx > this.w - 0.001) fx = this.w - 0.001;
    if (fy > this.h - 0.001) fy = this.h - 0.001;
    const x = Math.floor(fx), y = Math.floor(fy);
    const u = fx - x, v = fy - y;
    const W = this.w + 1, h = this.heights;
    const a = h[y * W + x], b = h[y * W + x + 1], c = h[(y + 1) * W + x], d = h[(y + 1) * W + x + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }

  elevAt(fx, fy) {
    const x = Math.floor(fx), y = Math.floor(fy);
    if (!this.inBounds(x, y)) return 0;
    return this.tileElev[y * this.w + x];
  }

  terrainPassable(x, y) {
    if (!this.inBounds(x, y)) return false;
    return TERRAIN_PASSABLE[this.terrain[y * this.w + x]];
  }
  passable(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const i = y * this.w + x;
    return this.block[i] === 0 && TERRAIN_PASSABLE[this.terrain[i]];
  }
  passableIdx(i) {
    return this.block[i] === 0 && TERRAIN_PASSABLE[this.terrain[i]];
  }
  // Max corner-height difference inside a footprint (building placement on slopes).
  footprintSlope(tx, ty, size) {
    let mn = 99, mx = -1;
    for (let y = ty; y <= ty + size; y++) {
      for (let x = tx; x <= tx + size; x++) {
        const h = this.cornerH(x, y);
        if (h < mn) mn = h; if (h > mx) mx = h;
      }
    }
    return mx - mn;
  }
}
