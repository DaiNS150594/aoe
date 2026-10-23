// Deterministic PRNG (sfc32). Only integer ops, identical on every JS engine.
export class RNG {
  constructor(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    // splitmix32 to expand the seed into 4 state words
    const sm = () => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = sm(); this.b = sm(); this.c = sm(); this.d = sm();
    for (let i = 0; i < 12; i++) this.u32();
  }
  u32() {
    let { a, b, c, d } = this;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    return t >>> 0;
  }
  next() { return this.u32() / 4294967296; }
  int(n) { return Math.floor(this.next() * n); }
  range(a, b) { return a + this.next() * (b - a); }
  irange(a, b) { return a + this.int(b - a + 1); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[this.int(arr.length)]; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  state() { return [this.a, this.b, this.c, this.d]; }
}

// Small string hash (FNV-1a) used for seeds and state checksums.
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
