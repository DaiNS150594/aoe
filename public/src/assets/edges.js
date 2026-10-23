// Fog of war edge shapes of Age of Empires: data\tileedge.dat and
// data\blkedge.dat, loaded by empires.exe at 00511D70.
//
// Each file starts with 17 offsets, one table per tile shape (the slope types
// 0-16 the terrain pictures are drawn with), of 47 edge cases. A tileedge
// entry holds two span lists — the part of a lit tile drawn lit and the part
// drawn fogged — a blkedge entry one: the part of an explored tile left black.
// Offsets count from the start of the file (0 = none); a span list is
// (row, first x, last x) byte triplets ended by row 255, relative to the top
// left of the tile's picture.

export const EDGE_SHAPES = 17, EDGE_CASES = 47;

// Edge case of each 8-bit neighbour mask (the table built at 00511EEB). A mask
// has a bit per neighbour without sight / exploration (00516590): 0x80 the
// upper left side, 0x40 upper right, 0x20 lower right, 0x10 lower left, 0x08
// the top corner, 0x04 right, 0x02 bottom, 0x01 left. A corner next to a set
// side adds nothing, which leaves 47 cases, numbered in mask order.
export const EDGE_INDEX = (() => {
  const canon = (m) => {
    let c = m;
    if (m & 0x80) c &= ~0x09;
    if (m & 0x40) c &= ~0x0c;
    if (m & 0x20) c &= ~0x06;
    if (m & 0x10) c &= ~0x03;
    return c;
  };
  const t = new Uint8Array(256).fill(255);
  let n = 0;
  for (let m = 0; m < 256; m++) if (canon(m) === m) t[m] = n++;
  for (let m = 0; m < 256; m++) if (t[m] === 255) t[m] = t[canon(m)];
  return t;
})();

// Edge case of tile (tx, ty) in this game's coordinates (the original's
// X = W-1-ty, Y = tx): a neighbour lacks sight / exploration when its value in
// the per-tile array is below `level`; neighbours off the map never do.
export function edgeCase(state, level, W, H, tx, ty) {
  const lack = (x, y) => x >= 0 && y >= 0 && x < W && y < H && state[y * W + x] < level;
  let m = 0;
  if (lack(tx - 1, ty)) m |= 0x80;
  if (lack(tx, ty - 1)) m |= 0x40;
  if (lack(tx + 1, ty)) m |= 0x20;
  if (lack(tx, ty + 1)) m |= 0x10;
  if (lack(tx - 1, ty - 1)) m |= 0x08;
  if (lack(tx + 1, ty - 1)) m |= 0x04;
  if (lack(tx + 1, ty + 1)) m |= 0x02;
  if (lack(tx - 1, ty + 1)) m |= 0x01;
  return EDGE_INDEX[m];
}

// { lit, fog, black }: [shape][case] -> Uint8Array of (row, x0, x1) triplets
// (null when absent); full[shape] = the whole tile. Throws on a damaged file.
export function parseEdges(tileBuf, blkBuf) {
  const read = (buf, per, name) => {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const spans = (off) => {
      if (!off) return null;
      let p = off;
      while (p < b.length && b[p] !== 255) p += 3;
      if (p >= b.length) throw new Error(`${name}: span list out of the file`);
      return b.slice(off, p);
    };
    const out = Array.from({ length: per }, () => []);
    for (let s = 0; s < EDGE_SHAPES; s++) {
      const base = dv.getUint32(s * 4, true);
      if (base + EDGE_CASES * per * 4 > b.length) throw new Error(`${name}: table ${s} out of the file`);
      for (let k = 0; k < per; k++) out[k][s] = [];
      for (let i = 0; i < EDGE_CASES; i++) {
        for (let k = 0; k < per; k++) out[k][s][i] = spans(dv.getUint32(base + (i * per + k) * 4, true));
      }
    }
    return out;
  };
  const [lit, fog] = read(tileBuf, 2, 'tileedge.dat');
  const [black] = read(blkBuf, 1, 'blkedge.dat');
  const full = lit.map((t) => t[0]);
  if (full.some((l) => !l || !l.length)) throw new Error('tileedge.dat: missing tile shape');
  return { lit, fog, black, full };
}
