// Deterministic math helpers. The simulation must produce bit-identical
// results on every browser, so it never uses Math.sin/cos/atan2/pow/hypot
// (their precision is implementation-defined). +,-,*,/ and Math.sqrt are
// IEEE-754 exact and safe.

export const TAU = 6.283185307179586;
export const PI = 3.141592653589793;

export function dist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}
export function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

// sin/cos via range reduction + Taylor polynomial (enough precision for
// placing things on a map; deterministic because only basic ops are used).
export function dsin(x) {
  x = x % TAU;
  if (x < 0) x += TAU;
  let sign = 1;
  if (x > PI) { x -= PI; sign = -1; }
  if (x > PI / 2) x = PI - x;
  const x2 = x * x;
  // Taylor up to x^11
  const r = x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110)))));
  return sign * r;
}
export function dcos(x) { return dsin(x + PI / 2); }

// Distance from point to axis-aligned rectangle [x0,x1]x[y0,y1].
export function distToRect(px, py, x0, y0, x1, y1) {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// 8-way direction index from a vector in tile space (no trig). 0 = +x, then
// counter-clockwise in 45° steps. Used for sim-side facing only.
export function dir8(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  // tan(22.5°) ≈ 0.41421356
  if (ay <= ax * 0.41421356) return dx > 0 ? 0 : 4;
  if (ax <= ay * 0.41421356) return dy > 0 ? 2 : 6;
  if (dx > 0) return dy > 0 ? 1 : 7;
  return dy > 0 ? 3 : 5;
}
