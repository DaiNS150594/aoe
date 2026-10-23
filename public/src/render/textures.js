// Procedural terrain textures (canvas patterns) with an AoE1-like palette.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgb(r, g, b) { return `rgb(${r | 0},${g | 0},${b | 0})`; }

function makeTexture(size, base, opts, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rng(seed);
  const [br, bg, bb] = hexToRgb(base);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // large soft blotches
  for (let i = 0; i < (opts.blotches || 30); i++) {
    const x = r() * size, y = r() * size, rad = 6 + r() * (opts.blotchSize || 22);
    const d = (r() - 0.5) * (opts.blotchVar || 26);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(${br + d | 0},${bg + d | 0},${bb + d * 0.6 | 0},0.55)`);
    grd.addColorStop(1, `rgba(${br + d | 0},${bg + d | 0},${bb + d * 0.6 | 0},0)`);
    g.fillStyle = grd;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.save(); g.translate(ox, oy); g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }
  // pixel noise
  const id = g.getImageData(0, 0, size, size);
  const px = id.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (r() - 0.5) * (opts.noise || 22);
    px[i] = Math.max(0, Math.min(255, px[i] + n));
    px[i + 1] = Math.max(0, Math.min(255, px[i + 1] + n * (opts.greenBias || 1)));
    px[i + 2] = Math.max(0, Math.min(255, px[i + 2] + n * 0.7));
  }
  g.putImageData(id, 0, 0);
  // little strokes (grass blades, pebbles, leaves)
  const strokes = opts.strokes || 0;
  for (let i = 0; i < strokes; i++) {
    const x = r() * size, y = r() * size;
    const k = r();
    const col = opts.strokeCols[(r() * opts.strokeCols.length) | 0];
    g.strokeStyle = col; g.fillStyle = col;
    if (opts.strokeKind === 'pebble') {
      g.globalAlpha = 0.6 + r() * 0.4;
      g.beginPath(); g.ellipse(x, y, 0.8 + k * 1.6, 0.6 + k, 0, 0, Math.PI * 2); g.fill();
    } else {
      g.globalAlpha = 0.5 + r() * 0.5;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2.5, y - 1.5 - k * 2.5); g.stroke();
    }
  }
  g.globalAlpha = 1;
  return c;
}

let cache = null;
export function getTextures() {
  if (cache) return cache;
  cache = {
    grass: makeTexture(256, '#5b8a2a', { blotches: 60, blotchVar: 30, noise: 26, greenBias: 1.2, strokes: 1400, strokeCols: ['#4a7621', '#6d9d35', '#3f6a1c', '#78a83e'] }, 11),
    grass2: makeTexture(256, '#6f9030', { blotches: 60, blotchVar: 30, noise: 24, greenBias: 1.1, strokes: 1200, strokeCols: ['#5d7d25', '#86a541', '#4f6e1f'] }, 23),
    dirt: makeTexture(256, '#8a6d3e', { blotches: 50, blotchVar: 34, noise: 30, greenBias: 0.9, strokes: 900, strokeKind: 'pebble', strokeCols: ['#6e5530', '#a3865a', '#5c4628', '#b49a6c'] }, 37),
    forest: makeTexture(256, '#3f5a20', { blotches: 70, blotchVar: 26, noise: 22, greenBias: 1, strokes: 1500, strokeCols: ['#2f4518', '#4d6a28', '#5b4a22', '#34501a'] }, 41),
    desert: makeTexture(256, '#c9ae6a', { blotches: 40, blotchVar: 24, noise: 18, greenBias: 0.95, strokes: 600, strokeKind: 'pebble', strokeCols: ['#b39a58', '#dcc38a'] }, 53),
    rock: makeTexture(256, '#7d7468', { blotches: 40, blotchVar: 30, noise: 30, greenBias: 1, strokes: 600, strokeKind: 'pebble', strokeCols: ['#5f574e', '#9a9184'] }, 61),
    water: makeTexture(256, '#2f5f8f', { blotches: 30, blotchVar: 20, noise: 10, greenBias: 1, strokes: 0 }, 71),
  };
  return cache;
}

// Procedural texture and minimap colour of a Rise of Rome terrain id
export function terrainTex(t) {
  switch (t) {
    case 2: case 6: case 11: case 13: case 14: return 'desert';
    case 1: case 4: case 15: case 22: return 'water';
    case 10: case 19: case 20: return 'forest';
    default: return 'grass';
  }
}
const TEX_COLOR = { grass: '#5b8a2a', desert: '#c9ae6a', water: '#2f5f8f', forest: '#3a5520' };
export const terrainColor = (t) => (t === 16 ? '#7d7468' : TEX_COLOR[terrainTex(t)]);
export { rgb };

// Terrain textures built from the player's own Rise of Rome tiles (grass,
// desert, water); variants of them stand in for terrain types RoR draws
// without a texture of their own.
let aoeTex = null, aoeTexFor = null;
export function getAoeTextures(assets) {
  if (!assets) return null;
  if (aoeTexFor === assets) return aoeTex;
  aoeTexFor = assets;
  aoeTex = null;
  try {
    const grass = assets.terrainTexture(0);
    if (!grass) return null;
    const desert = assets.terrainTexture(6) || grass;
    aoeTex = {
      grass,
      grass2: assets.terrainTexture(0, 'rgba(150,150,40,0.10)') || grass,
      forest: assets.terrainTexture(0, 'rgba(10,32,0,0.28)') || grass,
      dirt: assets.terrainTexture(6, 'rgba(96,62,24,0.38)') || desert,
      desert,
      water: assets.terrainTexture(1) || getTextures().water,
      rock: getTextures().rock,
    };
  } catch (e) { console.warn('AoE terrain textures:', e); aoeTex = null; }
  return aoeTex;
}
