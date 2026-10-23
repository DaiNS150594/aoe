// Procedural sprites. No original game art is used: every unit, building,
// tree and mine is drawn with canvas paths in an AoE1-inspired style, then
// cached as bitmaps keyed by (type, colour, direction, animation, frame).
import { HW, HH } from './iso.js';

const TAU = Math.PI * 2;
const SS = 1.5; // supersampling for crisper sprites

// ----------------------------------------------------------------- colours
export function shade(hex, f) {
  let r, g, b;
  if (hex[0] === '#') {
    const n = parseInt(hex.slice(1), 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    const m = hex.match(/\d+(\.\d+)?/g) || [0, 0, 0];
    r = +m[0]; g = +m[1]; b = +m[2];
  }
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
const SKIN = ['#c68d5e', '#b07a4c', '#d29a6a', '#9c6a40'];
const WOOD = '#7a5230', WOOD_D = '#4e3218', METAL = '#c4c8cc', METAL_D = '#7c8086', BRONZE = '#c8963c', BRONZE_D = '#8a6224';

// ------------------------------------------------------------------- cache
class Cache {
  constructor(limit = 6000) { this.map = new Map(); this.limit = limit; }
  get(key, make) {
    let v = this.map.get(key);
    if (v) {
      // LRU: move to the end
      this.map.delete(key); this.map.set(key, v);
      return v;
    }
    v = make();
    this.map.set(key, v);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
    return v;
  }
}
const cache = new Cache();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * SS); c.height = Math.ceil(h * SS);
  const g = c.getContext('2d');
  g.scale(SS, SS);
  g.lineCap = 'round'; g.lineJoin = 'round';
  return { c, g };
}
function sprite(w, h, ax, ay, draw) {
  const { c, g } = canvas(w, h);
  draw(g);
  return { c, w, h, ax, ay };
}

// small helpers
function ell(g, x, y, rx, ry, fill, stroke, lw = 0.8) {
  g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function line(g, x1, y1, x2, y2, col, w = 1) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
function poly(g, pts, fill, stroke, lw = 0.7) {
  g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function shadow(g, x, y, rx, ry) { ell(g, x, y, rx, ry, 'rgba(0,0,0,0.28)'); }

// --------------------------------------------------------------- humanoid
// P: { side, view, walk, armA, gear..., colors }
function drawMan(g, x, y, P) {
  const C = P.col;
  const skin = P.skin || SKIN[0];
  g.save();
  g.translate(x, y);
  const side = P.view === 'side';
  if (side) g.scale(P.side, 1);
  const sc = P.scale || 1;
  if (sc !== 1) g.scale(sc, sc);
  const bob = P.walk >= 0 ? Math.abs(Math.sin(P.walk * TAU)) * 0.8 : 0;
  g.translate(0, -bob);
  const hipY = P.riding ? -1 : -9, shY = hipY - 7, headY = shY - 4.2;
  // ---- legs
  if (!P.riding && !P.robe) {
    const legCol = P.legCol || shade(C.hex, -0.35);
    if (side) {
      const sw = P.walk >= 0 ? Math.sin(P.walk * TAU) * 2.8 : 0.9;
      line(g, -0.4, hipY, -sw, -0.6 + bob, shade(skin, -0.25), 2.1);
      line(g, -sw, -0.4 + bob, -sw + 1.4, -0.4 + bob, '#3a2a1a', 1.4);
      line(g, 0.4, hipY, sw, -0.6 + bob, skin, 2.1);
      line(g, sw, -0.4 + bob, sw + 1.4, -0.4 + bob, '#3a2a1a', 1.4);
      if (P.greaves) { line(g, sw, -4 + bob, sw * 0.6, -6 + bob, BRONZE, 1.6); }
    } else {
      const l1 = P.walk >= 0 ? Math.max(0, Math.sin(P.walk * TAU)) * 1.4 : 0;
      const l2 = P.walk >= 0 ? Math.max(0, -Math.sin(P.walk * TAU)) * 1.4 : 0;
      line(g, -1.4, hipY, -1.7, -0.6 - l1 + bob, skin, 2.1);
      line(g, 1.4, hipY, 1.7, -0.6 - l2 + bob, shade(skin, -0.12), 2.1);
    }
    // kilt / tunic skirt
    poly(g, side ? [-2.6, hipY - 1.5, 2.8, hipY - 1.5, 3.3, hipY + 2.4, -3, hipY + 2.4] : [-3.2, hipY - 1.5, 3.2, hipY - 1.5, 3.8, hipY + 2.6, -3.8, hipY + 2.6], P.skirt || C.hex, 'rgba(0,0,0,0.35)', 0.5);
  }
  if (P.riding) {
    // legs hanging along the mount's flank
    const legCol = P.legCol || shade(C.hex, -0.3);
    if (side) {
      line(g, 0.3, hipY - 0.5, 2.4, hipY + 4.6, legCol, 2.2);
      line(g, 2.4, hipY + 4.4, 1.8, hipY + 7.4, shade(skin, -0.1), 1.8);
      poly(g, [-2.6, hipY - 1.6, 2.8, hipY - 1.6, 3.2, hipY + 1.4, -3, hipY + 1.4], P.skirt || C.hex, 'rgba(0,0,0,0.35)', 0.5);
    } else {
      line(g, -2.6, hipY - 0.5, -3.6, hipY + 5.4, legCol, 2);
      line(g, 2.6, hipY - 0.5, 3.6, hipY + 5.4, legCol, 2);
    }
  }
  if (P.robe) {
    poly(g, side ? [-2.8, shY + 1, 3, shY + 1, 4.2, -0.4, -4.2, -0.4] : [-3.4, shY + 1, 3.4, shY + 1, 4.8, -0.4, -4.8, -0.4], P.robe, 'rgba(0,0,0,0.35)', 0.5);
    if (P.stole) { line(g, side ? 0.6 : -1.2, shY + 1, side ? 1.4 : -1.6, -1, P.stole, 1.6); if (!side) line(g, 1.2, shY + 1, 1.6, -1, P.stole, 1.6); }
  }
  // ---- back items (shield on back view, quiver)
  if (P.quiver) { poly(g, side ? [-3.6, shY - 0.5, -2.2, shY - 1.2, -1.6, hipY - 1, -3, hipY - 0.6] : [2, shY - 1, 3.4, shY - 0.6, 3, hipY, 1.6, hipY], WOOD, WOOD_D); }
  if (P.carry) drawCarry(g, side, shY, P.carry);
  if (P.shield && P.view === 'back') drawShield(g, 0, shY + 3.2, P.shield, C, 'back');
  // ---- back arm (shield arm in side view)
  const armCol = P.sleeve || skin;
  if (side) {
    const ba = P.backA ?? 1.1;
    const hx = Math.cos(ba) * 5.2, hy = shY + 1 + Math.sin(ba) * 5.2;
    line(g, -0.6, shY + 1, hx - 0.6, hy, shade(armCol, -0.25), 1.9);
    if (P.backItem) P.backItem(g, hx - 0.6, hy);
  }
  // ---- torso
  const torsoCol = P.torso || C.hex;
  if (side) poly(g, [-2.4, hipY - 0.5, 2.6, hipY - 0.5, 3.0, shY + 0.6, 1.6, shY - 0.2, -1.8, shY - 0.2, -2.6, shY + 0.6], torsoCol, 'rgba(0,0,0,0.4)', 0.5);
  else poly(g, [-3.0, hipY - 0.5, 3.0, hipY - 0.5, 3.6, shY + 0.6, 2.4, shY - 0.3, -2.4, shY - 0.3, -3.6, shY + 0.6], torsoCol, 'rgba(0,0,0,0.4)', 0.5);
  if (P.armor === 'bronze') { if (side) poly(g, [-1.6, hipY - 1, 2.6, hipY - 1, 2.8, shY + 1, -1.2, shY + 0.6], BRONZE, BRONZE_D, 0.5); else poly(g, [-2.4, hipY - 1, 2.4, hipY - 1, 3, shY + 1, -3, shY + 1], BRONZE, BRONZE_D, 0.5); }
  if (P.armor === 'metal') { if (side) poly(g, [-1.6, hipY - 1, 2.6, hipY - 1, 2.8, shY + 1, -1.2, shY + 0.6], METAL, METAL_D, 0.5); else poly(g, [-2.4, hipY - 1, 2.4, hipY - 1, 3, shY + 1, -3, shY + 1], METAL, METAL_D, 0.5); }
  if (P.armor === 'leather') { line(g, side ? -1.4 : -2.4, shY + 1, side ? 2.4 : 2.4, hipY - 1, '#6a4a2a', 1.2); }
  if (!P.robe) line(g, side ? -2.4 : -3, hipY - 0.6, side ? 2.6 : 3, hipY - 0.6, '#4a3018', 0.9); // belt
  if (P.cape) { if (side) poly(g, [-1.8, shY, -4.2, hipY + 2, -2.6, hipY + 2.4, -0.6, shY + 1], P.cape, 'rgba(0,0,0,0.3)'); }
  // ---- head
  const hx = side ? 0.6 : 0;
  ell(g, hx, headY, 3.1, 3.2, skin, 'rgba(0,0,0,0.35)', 0.5);
  if (P.view === 'front' || side) {
    if (side) { g.fillStyle = '#1a1208'; g.fillRect(hx + 1.5, headY - 0.9, 0.9, 0.9); }
    else { g.fillStyle = '#1a1208'; g.fillRect(-1.4, headY - 0.8, 0.8, 0.8); g.fillRect(0.6, headY - 0.8, 0.8, 0.8); }
  }
  if (P.beard) { if (side) poly(g, [hx + 0.4, headY + 1.2, hx + 3, headY + 1.2, hx + 2, headY + 3.4], P.beard); else ell(g, 0, headY + 2.2, 2, 1.3, P.beard); }
  drawHelmet(g, hx, headY, P.helmet, P.view, C, P.hair);
  // ---- shield (front / side)
  if (P.shield && P.view !== 'back') drawShield(g, side ? 3.4 : -3.6, shY + 3.6, P.shield, C, P.view);
  // ---- weapon arm
  const a = P.armA ?? 1.2;
  if (side) {
    const len = 5.4;
    const hx2 = 0.6 + Math.cos(a) * len, hy2 = shY + 1 + Math.sin(a) * len;
    if (P.weaponBehind && P.weapon) P.weapon(g, hx2, hy2, a);
    line(g, 0.6, shY + 1, hx2, hy2, armCol, 2);
    if (!P.weaponBehind && P.weapon) P.weapon(g, hx2, hy2, a);
  } else {
    // front/back: arms at both sides
    const wx = P.view === 'front' ? 3.6 : -3.6;
    const ay2 = shY + 1 + Math.sin(a) * 5, ax2 = wx + Math.cos(a) * 1.2 * Math.sign(wx);
    if (P.view === 'back' && P.weapon) P.weapon(g, ax2, ay2, a, true);
    line(g, wx * 0.75, shY + 0.8, ax2, ay2, armCol, 2);
    line(g, -wx * 0.75, shY + 0.8, -wx * 0.95, shY + 5, shade(armCol, -0.1), 2);
    if (P.view === 'front' && P.weapon) P.weapon(g, ax2, ay2, a, true);
  }
  g.restore();
}

function drawHelmet(g, hx, hy, kind, view, C, hair) {
  const side = view === 'side';
  switch (kind) {
    case 'cap': ell(g, hx, hy - 1.4, 3.3, 2.1, METAL, METAL_D, 0.5); break;
    case 'leather': ell(g, hx, hy - 1.4, 3.3, 2.2, '#7a5530', '#4a3018', 0.5); break;
    case 'crest':
      ell(g, hx, hy - 1.4, 3.4, 2.3, BRONZE, BRONZE_D, 0.5);
      poly(g, side ? [hx - 3, hy - 3, hx + 1, hy - 6.4, hx + 2.4, hy - 3.6] : [hx - 1, hy - 3, hx, hy - 6.4, hx + 1, hy - 3], C.hex, 'rgba(0,0,0,0.4)', 0.4);
      break;
    case 'corinthian':
      ell(g, hx, hy - 0.6, 3.5, 3.4, BRONZE, BRONZE_D, 0.5);
      if (side) { g.fillStyle = '#2a1a08'; g.fillRect(hx + 1, hy - 1, 2.2, 0.9); }
      poly(g, side ? [hx - 3.8, hy - 2.6, hx - 0.4, hy - 7.4, hx + 2.2, hy - 3.2] : [hx - 1.3, hy - 3, hx, hy - 7.4, hx + 1.3, hy - 3], C.hex, 'rgba(0,0,0,0.4)', 0.4);
      break;
    case 'plume':
      ell(g, hx, hy - 0.8, 3.5, 3.2, METAL, METAL_D, 0.5);
      ell(g, hx + (side ? -0.6 : 0), hy - 5.2, side ? 3.6 : 1.4, 1.6, '#c82020', 'rgba(0,0,0,0.4)', 0.4);
      break;
    case 'roman':
      ell(g, hx, hy - 1, 3.4, 2.8, METAL, METAL_D, 0.5);
      line(g, hx - 2.8, hy - 4, hx + 2.8, hy - 4, '#c82020', 1.4);
      break;
    case 'pointed':
      poly(g, [hx - 3.4, hy - 0.6, hx + 3.4, hy - 0.6, hx, hy - 6], METAL, METAL_D, 0.5);
      break;
    case 'conical':
      poly(g, [hx - 4.4, hy - 1, hx + 4.4, hy - 1, hx, hy - 5], '#c8a860', '#7a6030', 0.5);
      break;
    case 'bald': break;
    case 'hood': ell(g, hx - (side ? 0.6 : 0), hy - 0.6, 3.6, 3.6, '#e8e0d0', '#9a9080', 0.5); ell(g, hx + (side ? 1 : 0), hy + 0.4, 2.2, 2.4, SKIN[0]); break;
    case 'space': ell(g, hx, hy, 4, 4, 'rgba(180,220,255,0.55)', '#e8f4ff', 0.8); break;
    default:
      // hair
      g.fillStyle = hair || '#2a1a0a';
      g.beginPath();
      if (side) g.ellipse(hx - 0.8, hy - 1.4, 3, 2.2, -0.3, Math.PI, TAU);
      else g.ellipse(hx, hy - 1.5, 3.2, 2, 0, Math.PI, TAU);
      g.fill();
  }
}

function drawShield(g, x, y, kind, C, view) {
  const side = view === 'side';
  switch (kind) {
    case 'hoplon': ell(g, x, y, side ? 2.4 : 4.6, 5, BRONZE, BRONZE_D, 0.6); ell(g, x, y, side ? 1.2 : 2.6, 2.8, C.hex); break;
    case 'scutum': poly(g, side ? [x - 1.2, y - 6, x + 1.4, y - 6, x + 1.4, y + 5, x - 1.2, y + 5] : [x - 3.6, y - 6, x + 3.6, y - 6, x + 3.6, y + 5, x - 3.6, y + 5], C.hex, shade(C.hex, -0.5), 0.7); if (!side) { ell(g, x, y, 1, 1, BRONZE); } break;
    case 'rect': poly(g, side ? [x - 1, y - 4.5, x + 1.2, y - 4.5, x + 1.2, y + 4, x - 1, y + 4] : [x - 3, y - 4.5, x + 3, y - 4.5, x + 3, y + 4, x - 3, y + 4], C.hex, '#3a2a1a', 0.6); break;
    case 'small': ell(g, x, y, side ? 1.6 : 2.8, 3.2, C.hex, '#3a2a1a', 0.6); break;
    default: ell(g, x, y, side ? 2 : 3.6, 4, C.hex, WOOD_D, 0.7); ell(g, x, y, 0.8, 0.8, METAL);
  }
}

function drawCarry(g, side, shY, kind) {
  const x = side ? -3.2 : 0, y = shY + 1;
  switch (kind) {
    case 'wood': line(g, x - 3, y - 1.4, x + 3.4, y - 3, '#8a5a2a', 2.4); line(g, x - 3, y + 0.2, x + 3.2, y - 1.4, '#6e4620', 2.2); break;
    case 'food': ell(g, x, y + 1, 2.6, 2.2, '#b03a2a', '#5a1a10', 0.5); break;
    case 'gold': ell(g, x, y + 1, 2.6, 2.4, '#e8c030', '#8a6a10', 0.5); break;
    case 'stone': ell(g, x, y + 1, 2.6, 2.4, '#a8a8a0', '#5a5a52', 0.5); break;
  }
}

// ---- weapons (drawn at hand position hx,hy; a = arm angle)
const W = {
  club: (g, x, y, a) => { const d = a - 1.4; line(g, x, y, x + Math.cos(d) * 6, y + Math.sin(d) * 6, WOOD, 1.6); ell(g, x + Math.cos(d) * 6.4, y + Math.sin(d) * 6.4, 1.5, 1.5, WOOD_D); },
  axe: (g, x, y, a) => { const d = a - 1.4; const ex = x + Math.cos(d) * 6.5, ey = y + Math.sin(d) * 6.5; line(g, x, y, ex, ey, WOOD, 1.2); poly(g, [ex, ey, ex + Math.cos(d + 1.6) * 2.6, ey + Math.sin(d + 1.6) * 2.6, ex - Math.cos(d) * 2.2 + Math.cos(d + 1.6) * 2.6, ey - Math.sin(d) * 2.2 + Math.sin(d + 1.6) * 2.6], METAL, METAL_D, 0.4); },
  sword: (g, x, y, a) => { const d = a - 1.5; line(g, x, y, x + Math.cos(d) * 7.5, y + Math.sin(d) * 7.5, METAL, 1.2); line(g, x - Math.cos(d + 1.57) * 1.4, y - Math.sin(d + 1.57) * 1.4, x + Math.cos(d + 1.57) * 1.4, y + Math.sin(d + 1.57) * 1.4, BRONZE_D, 1); },
  bigsword: (g, x, y, a) => { const d = a - 1.5; line(g, x, y, x + Math.cos(d) * 9, y + Math.sin(d) * 9, '#dfe3e8', 1.5); line(g, x - Math.cos(d + 1.57) * 1.8, y - Math.sin(d + 1.57) * 1.8, x + Math.cos(d + 1.57) * 1.8, y + Math.sin(d + 1.57) * 1.8, BRONZE, 1.2); },
  spear: (g, x, y, a) => { const d = a - 1.35; line(g, x - Math.cos(d) * 6, y - Math.sin(d) * 6, x + Math.cos(d) * 10, y + Math.sin(d) * 10, WOOD, 1); poly(g, [x + Math.cos(d) * 10, y + Math.sin(d) * 10, x + Math.cos(d) * 12.5, y + Math.sin(d) * 12.5, x + Math.cos(d) * 10 + Math.cos(d + 1.57) * 0.9, y + Math.sin(d) * 10 + Math.sin(d + 1.57) * 0.9], METAL); },
  lance: (g, x, y, a) => { const d = a - 1.45; line(g, x - Math.cos(d) * 5, y - Math.sin(d) * 5, x + Math.cos(d) * 13, y + Math.sin(d) * 13, WOOD, 1.1); poly(g, [x + Math.cos(d) * 13, y + Math.sin(d) * 13, x + Math.cos(d) * 15.5, y + Math.sin(d) * 15.5, x + Math.cos(d) * 13 + Math.cos(d + 1.57) * 1, y + Math.sin(d) * 13 + Math.sin(d + 1.57) * 1], METAL); },
  bow: (g, x, y, a, front, pull = 0) => {
    g.strokeStyle = '#5a3a1a'; g.lineWidth = 1.2; g.beginPath(); g.arc(x - 1.5, y, 5.2, -1.15, 1.15); g.stroke();
    const sx = x - 1.5 + Math.cos(1.15) * 5.2, sy1 = y - Math.sin(1.15) * 5.2, sy2 = y + Math.sin(1.15) * 5.2;
    line(g, sx, sy1, sx - pull, y, '#e8e0c8', 0.5); line(g, sx - pull, y, sx, sy2, '#e8e0c8', 0.5);
  },
  sling: (g, x, y, a) => { line(g, x, y, x + Math.cos(a - 2.4) * 5, y + Math.sin(a - 2.4) * 5, '#8a6a40', 0.7); ell(g, x + Math.cos(a - 2.4) * 5.4, y + Math.sin(a - 2.4) * 5.4, 1, 1, '#9a9a9a'); },
  staff: (g, x, y, a) => { line(g, x, y + 4, x + 0.5, y - 8, '#8a6a3a', 1.1); ell(g, x + 0.5, y - 9, 1.6, 1.6, '#f0d040', '#8a6a10', 0.4); },
  pick: (g, x, y, a) => { const d = a - 1.4; const ex = x + Math.cos(d) * 6, ey = y + Math.sin(d) * 6; line(g, x, y, ex, ey, WOOD, 1.1); line(g, ex + Math.cos(d + 1.57) * 2.6, ey + Math.sin(d + 1.57) * 2.6, ex - Math.cos(d + 1.57) * 2.6, ey - Math.sin(d + 1.57) * 2.6, METAL_D, 1.1); },
  hammer: (g, x, y, a) => { const d = a - 1.4; const ex = x + Math.cos(d) * 4.5, ey = y + Math.sin(d) * 4.5; line(g, x, y, ex, ey, WOOD, 1); line(g, ex + Math.cos(d + 1.57) * 1.4, ey + Math.sin(d + 1.57) * 1.4, ex - Math.cos(d + 1.57) * 1.4, ey - Math.sin(d + 1.57) * 1.4, METAL_D, 1.8); },
  hoe: (g, x, y, a) => { const d = a - 1.1; const ex = x + Math.cos(d) * 7, ey = y + Math.sin(d) * 7; line(g, x, y, ex, ey, WOOD, 1); line(g, ex, ey, ex + Math.cos(d + 1.8) * 2, ey + Math.sin(d + 1.8) * 2, METAL_D, 1.2); },
  gun: (g, x, y, a) => { line(g, x - 1, y, x + 6, y - 0.6, '#3a3a4a', 2); line(g, x + 6, y - 0.6, x + 7.5, y - 0.6, '#60c0ff', 1.2); },
  basket: (g, x, y) => { ell(g, x, y + 0.8, 2, 1.6, '#b08a50', '#6a4a20', 0.4); },
};

// ------------------------------------------------------------------ horses
function drawHorse(g, x, y, view, side, walk, col, opts = {}) {
  g.save(); g.translate(x, y);
  if (view === 'side') g.scale(side, 1);
  const body = opts.body || '#7a4a24', dark = shade(body, -0.35);
  const ph = walk >= 0 ? walk * TAU : 0;
  if (view === 'side') {
    // legs
    const l = (bx, off, c) => { const s = walk >= 0 ? Math.sin(ph + off) * 2.6 : 0; line(g, bx, -7, bx + s, -0.5, c, 1.5); };
    l(-6, 0, dark); l(5, Math.PI, dark);
    // tail
    g.strokeStyle = dark; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-8, -10); g.quadraticCurveTo(-11, -8, -10.5, -3.5); g.stroke();
    ell(g, 0, -9.5, 8.6, 3.8, body, 'rgba(0,0,0,0.45)', 0.6);
    if (opts.barding) { poly(g, [-7.5, -11, 7, -11, 7.8, -6.5, -8, -6.5], opts.barding, 'rgba(0,0,0,0.4)', 0.5); }
    if (opts.armor) { poly(g, [-7.5, -12, 7, -12, 7.6, -7.4, -8, -7.4], METAL, METAL_D, 0.5); line(g, -6, -9.5, 6, -9.5, METAL_D, 0.6); }
    // neck & head
    poly(g, [4.5, -12, 7.6, -17.5, 10, -16.5, 8, -9.5], body, 'rgba(0,0,0,0.4)', 0.5);
    g.save(); g.translate(10.6, -16.4); g.rotate(0.45); ell(g, 0, 0, 3.4, 1.7, body, 'rgba(0,0,0,0.4)', 0.5); g.restore();
    poly(g, [8.6, -18.4, 9.2, -20.4, 9.9, -18.2], dark);
    line(g, 7, -17.6, 5, -12, dark, 1.2); // mane
    if (opts.armor) poly(g, [6.6, -17.8, 10.4, -17, 11.6, -15, 8.5, -14], METAL, METAL_D, 0.4);
    l(-4.4, Math.PI * 0.5, body); l(6.6, Math.PI * 1.5, body);
  } else {
    const front = view === 'front';
    const s1 = walk >= 0 ? Math.max(0, Math.sin(ph)) * 1.5 : 0, s2 = walk >= 0 ? Math.max(0, -Math.sin(ph)) * 1.5 : 0;
    line(g, -2.2, -7, -2.4, -0.6 - s1, dark, 1.6); line(g, 2.2, -7, 2.4, -0.6 - s2, dark, 1.6);
    if (!front) { g.strokeStyle = dark; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, -10); g.quadraticCurveTo(0.5, -6, 0, -3.5); g.stroke(); }
    ell(g, 0, -9.5, 4.2, 4.2, body, 'rgba(0,0,0,0.45)', 0.6);
    if (opts.barding) ell(g, 0, -9.6, 4.3, 3, opts.barding, 'rgba(0,0,0,0.4)', 0.5);
    if (opts.armor) ell(g, 0, -10, 4.4, 3.4, METAL, METAL_D, 0.5);
    if (front) {
      poly(g, [-1.6, -11.5, 1.6, -11.5, 1.2, -17, -1.2, -17], body, 'rgba(0,0,0,0.4)', 0.5);
      ell(g, 0, -16.4, 1.6, 2.6, body, 'rgba(0,0,0,0.4)', 0.5);
      poly(g, [-1.2, -18.4, -0.7, -20.2, -0.2, -18.4], dark); poly(g, [1.2, -18.4, 0.7, -20.2, 0.2, -18.4], dark);
    }
    line(g, -1.4, -7, -1.6, -0.5 - s2, body, 1.6); line(g, 1.4, -7, 1.6, -0.5 - s1, body, 1.6);
  }
  g.restore();
}

// ------------------------------------------------------------------ others
function drawElephant(g, x, y, view, side, walk, opts = {}) {
  g.save(); g.translate(x, y);
  if (view === 'side') g.scale(side, 1);
  const body = opts.body || '#8c8a86', dark = shade(body, -0.35);
  const ph = walk >= 0 ? walk * TAU : 0;
  if (view === 'side') {
    const leg = (bx, off, c) => { const s = walk >= 0 ? Math.sin(ph + off) * 1.6 : 0; poly(g, [bx - 1.8, -9, bx + 1.8, -9, bx + 1.8 + s, -0.4, bx - 1.8 + s, -0.4], c, 'rgba(0,0,0,0.4)', 0.5); };
    leg(-7, 0, dark); leg(6, Math.PI, dark);
    ell(g, -0.5, -14, 12.5, 7.6, body, 'rgba(0,0,0,0.45)', 0.7);
    if (opts.cloth) poly(g, [-7, -21, 4, -21, 5, -12, -8, -12], opts.cloth, 'rgba(0,0,0,0.4)', 0.5);
    if (opts.armor) { poly(g, [-10, -18, 8, -18, 9, -11, -11, -11], opts.armor, 'rgba(0,0,0,0.4)', 0.5); }
    ell(g, 11, -16, 5.4, 5.6, body, 'rgba(0,0,0,0.4)', 0.6);
    ell(g, 8.6, -16.4, 3.4, 4.8, shade(body, -0.12), 'rgba(0,0,0,0.35)', 0.5); // ear
    g.strokeStyle = body; g.lineWidth = 2.6; g.beginPath(); g.moveTo(15, -14); g.quadraticCurveTo(18.5, -8, 16, -2.5); g.stroke();
    g.strokeStyle = '#f2ead8'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(14, -12.5); g.quadraticCurveTo(17.5, -11, 18.6, -13); g.stroke();
    g.fillStyle = '#1a1208'; g.fillRect(12.6, -17.6, 0.9, 0.9);
    leg(-4.4, Math.PI * 0.5, body); leg(8.4, Math.PI * 1.5, body);
    line(g, -13, -14, -14.5, -8, dark, 1);
  } else {
    const front = view === 'front';
    poly(g, [-6, -9, -2.6, -9, -2.6, -0.4, -6, -0.4], dark, 'rgba(0,0,0,0.4)', 0.5);
    poly(g, [2.6, -9, 6, -9, 6, -0.4, 2.6, -0.4], dark, 'rgba(0,0,0,0.4)', 0.5);
    ell(g, 0, -14, 8, 8, body, 'rgba(0,0,0,0.45)', 0.7);
    if (opts.cloth) ell(g, 0, -17, 7, 4, opts.cloth, 'rgba(0,0,0,0.4)', 0.5);
    if (opts.armor) ell(g, 0, -15, 8.2, 5, opts.armor, 'rgba(0,0,0,0.4)', 0.5);
    if (front) {
      ell(g, -7, -16, 4.2, 5.4, shade(body, -0.1), 'rgba(0,0,0,0.35)', 0.5); ell(g, 7, -16, 4.2, 5.4, shade(body, -0.1), 'rgba(0,0,0,0.35)', 0.5);
      ell(g, 0, -15, 4.8, 5, body, 'rgba(0,0,0,0.35)', 0.5);
      g.strokeStyle = body; g.lineWidth = 2.6; g.beginPath(); g.moveTo(0, -12); g.quadraticCurveTo(1, -6, 0, -2); g.stroke();
      line(g, -2, -11, -4, -8.4, '#f2ead8', 1.2); line(g, 2, -11, 4, -8.4, '#f2ead8', 1.2);
    }
    poly(g, [-4.4, -8, -1.4, -8, -1.4, -0.3, -4.4, -0.3], body, 'rgba(0,0,0,0.4)', 0.5);
    poly(g, [1.4, -8, 4.4, -8, 4.4, -0.3, 1.4, -0.3], body, 'rgba(0,0,0,0.4)', 0.5);
  }
  g.restore();
}

function drawCamel(g, x, y, view, side, walk) {
  g.save(); g.translate(x, y);
  if (view === 'side') g.scale(side, 1);
  const body = '#c4a065', dark = shade(body, -0.3);
  const ph = walk >= 0 ? walk * TAU : 0;
  const leg = (bx, off, c) => { const s = walk >= 0 ? Math.sin(ph + off) * 2.6 : 0; line(g, bx, -9, bx + s, -0.5, c, 1.3); };
  if (view === 'side') {
    leg(-5, 0, dark); leg(5, Math.PI, dark);
    ell(g, 0, -11.5, 7.6, 3.6, body, 'rgba(0,0,0,0.45)', 0.6);
    ell(g, -0.6, -15, 3.6, 2.6, body, 'rgba(0,0,0,0.4)', 0.5);
    poly(g, [5, -13, 9, -16, 9.4, -21, 7.6, -21, 7.2, -16.6, 4, -10], body, 'rgba(0,0,0,0.4)', 0.5);
    ell(g, 10, -21.4, 2.6, 1.4, body, 'rgba(0,0,0,0.4)', 0.5);
    leg(-3.6, Math.PI * 0.5, body); leg(6.4, Math.PI * 1.5, body);
  } else {
    leg(-2, 0, dark); leg(2, Math.PI, dark);
    ell(g, 0, -11.5, 4, 4, body, 'rgba(0,0,0,0.45)', 0.6);
    ell(g, 0, -15, 2.8, 2.4, body);
    if (view === 'front') { poly(g, [-1.2, -13, 1.2, -13, 1, -21, -1, -21], body); ell(g, 0, -21.5, 1.6, 1.8, body); }
  }
  g.restore();
}

function drawWheel(g, x, y, r, view) {
  const rx = view === 'side' ? r : r * 0.35;
  ell(g, x, y, rx, r, null, WOOD_D, 1.3);
  line(g, x - rx * 0.8, y, x + rx * 0.8, y, WOOD, 0.6); line(g, x, y - r * 0.8, x, y + r * 0.8, WOOD, 0.6);
}

// ------------------------------------------------------------ unit models
const MODELS = {};
const man = (opts) => opts;
// Each model returns a draw(g, ctx) where ctx = {view, side, walk, act, actT, col, task, carry}
function infantry(base) {
  return (g, s) => {
    const P = { ...base, view: s.view, side: s.side, walk: s.walk, col: s.col };
    P.armA = armAngle(s, base.attack || 'swing');
    if (base.weaponFn) P.weapon = base.weaponFn(s);
    drawMan(g, 0, 0, P);
  };
}
function armAngle(s, kind) {
  const t = s.actT;
  if (s.anim === 'attack' || s.anim === 'hunt') {
    if (kind === 'thrust') return t < 0.45 ? 0.5 - t * 0.6 : t < 0.65 ? 0.1 : 0.4;
    if (kind === 'shoot') return 0;
    if (kind === 'throw') return t < 0.5 ? -1.8 + t : t < 0.7 ? 0.2 : 0.9;
    return t < 0.45 ? 1.1 - t * 5.2 : t < 0.62 ? -1.24 + (t - 0.45) * 13 : 0.95;
  }
  if (s.anim === 'work' || s.anim === 'build') {
    const tt = (s.actT * 2) % 1;
    return tt < 0.5 ? 1.2 - tt * 4.4 : -1.0 + (tt - 0.5) * 4.8;
  }
  if (s.anim === 'chant' || s.anim === 'heal') return -1.3 + Math.sin(s.actT * TAU) * 0.3;
  if (s.walk >= 0) return 1.1 + Math.sin(s.walk * TAU) * 0.35;
  return 1.15;
}

function bowWeapon(s) {
  const pull = s.anim === 'attack' && s.actT < 0.5 ? s.actT * 6 : 0;
  return (g, x, y, a, front) => W.bow(g, x, y, a, front, pull);
}

MODELS.villager = (g, s) => {
  const t = s.task;
  let weapon = null, kind = 'swing', helmet = null;
  if (s.anim === 'work' || s.anim === 'build' || s.anim === 'hunt' || s.anim === 'attack') {
    if (t === 'woodcutter') weapon = W.axe;
    else if (t === 'goldminer' || t === 'stoneminer') weapon = W.pick;
    else if (t === 'builder' || t === 'repairer') weapon = W.hammer;
    else if (t === 'farmer') weapon = W.hoe;
    else if (t === 'hunter') { weapon = W.spear; kind = 'throw'; }
    else if (t === 'forager') weapon = W.basket;
    else weapon = W.club;
  }
  if (t === 'farmer') helmet = 'conical';
  const P = { view: s.view, side: s.side, walk: s.walk, col: s.col, helmet, weapon, hair: s.female ? '#4a2a10' : '#2a1a0a', carry: s.carry,
    skirt: shade(s.col.hex, -0.15), torso: s.col.hex };
  if (s.female) { P.robe = s.col.hex; P.hair = '#3a2010'; }
  P.armA = t === 'forager' && s.anim === 'work' ? 0.6 + Math.sin(s.actT * TAU) * 0.4 : armAngle(s, kind);
  drawMan(g, 0, 0, P);
};
MODELS.clubman = infantry({ weapon: W.club, skirt: '#8a6a3a', torso: null });
MODELS.axeman = infantry({ weapon: W.axe, helmet: 'leather', armor: 'leather' });
MODELS.short_swordsman = infantry({ weapon: W.sword, helmet: 'cap', shield: 'small' });
MODELS.broad_swordsman = infantry({ weapon: W.sword, helmet: 'crest', shield: 'round', armor: 'leather' });
MODELS.long_swordsman = infantry({ weapon: W.bigsword, helmet: 'plume', shield: 'rect', armor: 'metal', greaves: true });
MODELS.legion = infantry({ weapon: W.bigsword, helmet: 'roman', shield: 'scutum', armor: 'metal', greaves: true, cape: '#a02020' });
MODELS.slinger = (g, s) => drawMan(g, 0, 0, { view: s.view, side: s.side, walk: s.walk, col: s.col, weapon: W.sling, armA: s.anim === 'attack' ? (s.actT < 0.6 ? -1.6 + s.actT * 3 : 0.4) : 1.1, helmet: null });
MODELS.bowman = (g, s) => drawMan(g, 0, 0, { view: s.view, side: s.side, walk: s.walk, col: s.col, weapon: bowWeapon(s), armA: s.anim === 'attack' ? 0 : 0.7, quiver: true });
MODELS.improved_bowman = (g, s) => drawMan(g, 0, 0, { view: s.view, side: s.side, walk: s.walk, col: s.col, weapon: bowWeapon(s), armA: s.anim === 'attack' ? 0 : 0.7, quiver: true, helmet: 'leather', armor: 'leather' });
MODELS.composite_bowman = (g, s) => drawMan(g, 0, 0, { view: s.view, side: s.side, walk: s.walk, col: s.col, weapon: bowWeapon(s), armA: s.anim === 'attack' ? 0 : 0.7, quiver: true, helmet: 'cap', armor: 'bronze' });
MODELS.hoplite = infantry({ weapon: W.spear, helmet: 'corinthian', shield: 'hoplon', armor: 'bronze', greaves: true, attack: 'thrust' });
MODELS.phalanx = infantry({ weapon: W.spear, helmet: 'corinthian', shield: 'hoplon', armor: 'bronze', greaves: true, attack: 'thrust', cape: '#8a2020' });
MODELS.centurion = infantry({ weapon: W.spear, helmet: 'plume', shield: 'hoplon', armor: 'metal', greaves: true, attack: 'thrust', cape: '#c02020' });
MODELS.priest = (g, s) => drawMan(g, 0, 0, { view: s.view, side: s.side, walk: s.walk, col: s.col, robe: '#ece4d0', stole: s.col.hex, helmet: 'bald', weapon: W.staff, armA: armAngle(s), torso: '#ece4d0', sleeve: '#ece4d0' });
MODELS.photon_man = (g, s) => drawMan(g, 0, 0, { view: s.view, side: s.side, walk: s.walk, col: s.col, torso: '#d8dce4', skirt: '#9aa0aa', helmet: 'space', weapon: W.gun, armA: s.anim === 'attack' ? 0 : 0.6, legCol: '#c8ccd4' });
MODELS.nuke_trooper = (g, s) => drawMan(g, 0, 0, { view: s.view, side: s.side, walk: s.walk, col: s.col, torso: '#f0f0f0', skirt: '#e0e0e0', helmet: 'space', weapon: W.gun, armA: 0.8 });

function rider(g, s, opts, hy = -11.5) {
  const P = { view: s.view, side: s.side, walk: -1, col: s.col, riding: true, ...opts };
  P.armA = opts.bow ? (s.anim === 'attack' ? 0 : 0.6) : armAngle(s, opts.attack || 'swing');
  if (opts.bow) P.weapon = bowWeapon(s);
  drawMan(g, s.view === 'side' ? -0.5 * s.side : 0, hy, P);
}
function mounted(horseOpts, riderOpts) {
  return (g, s) => {
    const back = s.view === 'back';
    if (back) rider(g, s, riderOpts);
    drawHorse(g, 0, 0, s.view, s.side, s.walk, s.col, typeof horseOpts === 'function' ? horseOpts(s) : horseOpts);
    if (!back) rider(g, s, riderOpts);
  };
}
MODELS.scout = mounted({ body: '#a0703a' }, { weapon: W.spear, attack: 'thrust', helmet: null });
MODELS.cavalry = mounted({ body: '#6a3e1e' }, { weapon: W.sword, helmet: 'cap', shield: 'small' });
MODELS.heavy_cavalry = mounted((s) => ({ body: '#4a2e18', barding: s.col.hex }), { weapon: W.sword, helmet: 'crest', shield: 'round', armor: 'leather' });
MODELS.cataphract = mounted((s) => ({ body: '#3a2a1a', armor: true, barding: s.col.hex }), { weapon: W.lance, helmet: 'plume', armor: 'metal', attack: 'thrust' });
MODELS.horse_archer = mounted({ body: '#9a6a34' }, { bow: true, quiver: true, helmet: 'leather' });
MODELS.heavy_horse_archer = mounted((s) => ({ body: '#5a3a1e', barding: s.col.hex }), { bow: true, quiver: true, helmet: 'cap', armor: 'bronze' });
MODELS.camel = (g, s) => { drawCamel(g, 0, 0, s.view, s.side, s.walk); rider(g, s, { weapon: W.sword, helmet: null, torso: s.col.hex }, -16); };
MODELS.big_daddy = (g, s) => {
  const side = s.view === 'side';
  g.save(); if (side) g.scale(s.side, 1);
  const L = side ? 13 : 6;
  poly(g, [-L, -3, L, -3, L, -8, L * 0.4, -9, -L * 0.2, -13, -L * 0.8, -13, -L, -8], '#121212', '#555', 0.8);
  poly(g, [-L * 0.15, -12, L * 0.3, -9, -L * 0.75, -9, -L * 0.7, -12], '#6aa6d8');
  ell(g, -L * 0.65, -2.5, side ? 2.6 : 1.4, 2.6, '#222', '#888', 0.6); ell(g, L * 0.65, -2.5, side ? 2.6 : 1.4, 2.6, '#222', '#888', 0.6);
  line(g, -L * 0.3, -14, L * 0.4, -16, '#7a7a7a', 2.2);
  g.restore();
};

function chariot(archer) {
  return (g, s) => {
    const side = s.view === 'side';
    const sd = side ? s.side : 1;
    const hx = side ? 7 * sd : 0, hy = side ? 0 : (s.view === 'front' ? 3 : -3);
    const cx = side ? -5 * sd : 0, cy = side ? 0 : (s.view === 'front' ? -2 : 3);
    const drawCart = () => {
      drawWheel(g, cx + (side ? 0 : -4), cy - 4.5, 4.4, s.view);
      poly(g, side ? [cx - 4.5 * sd, cy - 13, cx + 3.5 * sd, cy - 13, cx + 4 * sd, cy - 6, cx - 4.8 * sd, cy - 6] : [cx - 4.5, cy - 12, cx + 4.5, cy - 12, cx + 4.5, cy - 6, cx - 4.5, cy - 6], s.col.hex, '#3a2614', 0.7);
      line(g, cx, cy - 8, hx, hy - 8, WOOD, 1.2);
      const P = { view: s.view, side: s.side, walk: -1, col: s.col, riding: true, helmet: archer ? 'leather' : 'cap' };
      if (archer) { P.weapon = bowWeapon(s); P.armA = s.anim === 'attack' ? 0 : 0.6; }
      else { P.weapon = W.spear; P.armA = armAngle(s, 'thrust'); }
      drawMan(g, cx, cy - 11, P);
      if (!side) drawWheel(g, cx + 4, cy - 4.5, 4.4, s.view);
    };
    const drawH = () => drawHorse(g, hx, hy, s.view, s.side, s.walk, s.col, { body: '#8a5a2a' });
    if (s.view === 'back') { drawH(); drawCart(); } else if (s.view === 'front') { drawCart(); drawH(); } else { drawCart(); drawH(); }
    if (side) drawWheel(g, cx, cy - 4.5, 4.4, 'side');
  };
}
MODELS.chariot = chariot(false);
MODELS.scythe_chariot = (g, s) => { chariot(false)(g, s); const sd = s.view === 'side' ? s.side : 1; line(g, -5 * sd, -4.5, -12 * sd, -3, METAL, 1); };
MODELS.chariot_archer = chariot(true);

function elephantModel(kind) {
  return (g, s) => {
    const opts = { cloth: s.col.hex };
    if (kind === 'armored') opts.armor = METAL;
    const back = s.view === 'back';
    const riderFn = () => {
      if (kind === 'archer') {
        const hx = s.view === 'side' ? -1 * s.side : 0;
        poly(g, [hx - 5, -21, hx + 5, -21, hx + 4.4, -27, hx - 4.4, -27], '#8a5a2a', '#4a2a10', 0.6);
        drawMan(g, hx, -24, { view: s.view, side: s.side, walk: -1, col: s.col, riding: true, weapon: bowWeapon(s), armA: s.anim === 'attack' ? 0 : 0.6, helmet: 'cap' });
      } else if (kind !== 'wild') {
        drawMan(g, s.view === 'side' ? 2 * s.side : 0, -20, { view: s.view, side: s.side, walk: -1, col: s.col, riding: true, weapon: W.spear, armA: armAngle(s, 'thrust'), helmet: kind === 'armored' ? 'cap' : null, scale: 0.9 });
      }
    };
    if (back) riderFn();
    drawElephant(g, 0, 0, s.view, s.side, s.walk, kind === 'wild' ? {} : opts);
    if (!back) riderFn();
  };
}
MODELS.war_elephant = elephantModel('war');
MODELS.armored_elephant = elephantModel('armored');
MODELS.elephant_archer = elephantModel('archer');
MODELS.elephant_wild = elephantModel('wild');

function siegeModel(kind) {
  return (g, s) => {
    const side = s.view === 'side';
    g.save(); if (side) g.scale(s.side, 1);
    const w = side ? 1 : 0.55;
    const t = s.anim === 'attack' ? s.actT : 0.9;
    if (kind === 'ballista' || kind === 'helepolis') {
      if (kind === 'helepolis') {
        poly(g, [-8 * w, -2, 8 * w, -2, 7 * w, -30, -7 * w, -30], '#8a6236', '#4a3018', 0.8);
        for (let i = 0; i < 3; i++) line(g, -7 * w, -9 - i * 8, 7 * w, -9 - i * 8, '#5a3e20', 0.8);
        poly(g, [-7.5 * w, -30, 7.5 * w, -30, 6 * w, -34, -6 * w, -34], s.col.hex, '#3a2614', 0.6);
        line(g, 4 * w, -14, 12 * w, -15, METAL_D, 1.3); line(g, 4 * w, -22, 12 * w, -23, METAL_D, 1.3);
        drawWheel(g, -5 * w, -2.5, 3, s.view); drawWheel(g, 5 * w, -2.5, 3, s.view);
      } else {
        line(g, -9 * w, -2, 9 * w, -4, WOOD_D, 2.2);
        line(g, -2 * w, -3, 0, -10, WOOD, 1.8);
        poly(g, [-10 * w, -11, 10 * w, -12, 10 * w, -9.6, -10 * w, -8.8], s.col.hex, '#3a2614', 0.5);
        g.strokeStyle = '#5a3a1a'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(7 * w, -18); g.quadraticCurveTo(12 * w, -11, 7 * w, -4); g.stroke();
        line(g, 7 * w, -18, (t < 0.5 ? 1 : 5) * w, -11, '#e8e0c8', 0.6); line(g, (t < 0.5 ? 1 : 5) * w, -11, 7 * w, -4, '#e8e0c8', 0.6);
        if (t < 0.5) line(g, 1 * w, -11, 12 * w, -11.4, METAL_D, 1.2);
        drawWheel(g, -6 * w, -3, 3.4, s.view); drawWheel(g, 6 * w, -3.6, 3.4, s.view);
      }
    } else {
      const big = kind === 'heavy' ? 1.25 : kind === 'catapult' ? 1.12 : 1;
      g.scale(big, big);
      line(g, -12 * w, -3, 12 * w, -3, WOOD_D, 2.6);
      line(g, -9 * w, -2.5, -9 * w, -6, WOOD_D, 2); line(g, 9 * w, -2.5, 9 * w, -6, WOOD_D, 2);
      poly(g, [-4 * w, -3, -1 * w, -15, 1 * w, -15, 4 * w, -3], null, WOOD, 1.8);
      const armA = t < 0.25 ? -0.2 + t * 8 : t < 0.5 ? 1.8 : 1.8 - (t - 0.5) * 4;
      const ax = Math.cos(Math.PI - armA * 0.9) * 13, ay = -Math.sin(Math.PI - armA * 0.9) * 13;
      line(g, 0, -13, ax * w, -13 + ay * 0.6, '#9a6a3a', 2.2);
      ell(g, ax * w, -13 + ay * 0.6, 2.2, 1.6, '#6a4a2a');
      poly(g, [-3 * w, -14, 3 * w, -14, 2.4 * w, -9, -2.4 * w, -9], kind === 'heavy' ? METAL_D : '#5a3a1a');
      poly(g, [-11 * w, -6, -5 * w, -6, -5 * w, -4, -11 * w, -4], s.col.hex);
      drawWheel(g, -8 * w, -2.6, 3.2, s.view); drawWheel(g, 8 * w, -2.6, 3.2, s.view);
    }
    g.restore();
  };
}
MODELS.stone_thrower = siegeModel('stone');
MODELS.catapult = siegeModel('catapult');
MODELS.heavy_catapult = siegeModel('heavy');
MODELS.ballista = siegeModel('ballista');
MODELS.helepolis = siegeModel('helepolis');

MODELS.gazelle = (g, s) => {
  const side = s.view === 'side';
  g.save(); if (side) g.scale(s.side, 1);
  const body = '#c08a4a', ph = s.walk >= 0 ? s.walk * TAU : 0;
  const leg = (bx, off) => { const sw = s.walk >= 0 ? Math.sin(ph + off) * 2.2 : 0; line(g, bx, -5.5, bx + sw, -0.4, '#8a5a2a', 0.9); };
  if (side) {
    leg(-3.4, 0); leg(3, Math.PI);
    ell(g, 0, -6.5, 5, 2.4, body, 'rgba(0,0,0,0.4)', 0.5);
    ell(g, 0, -5.4, 3.6, 1, '#f0e0c8');
    poly(g, [3.4, -7.6, 5.4, -11, 6.6, -10.4, 5, -6.6], body);
    ell(g, 6.4, -11, 1.8, 1.1, body);
    line(g, 6, -12, 5, -15, '#2a1a0a', 0.6); line(g, 6.6, -12, 6.2, -15, '#2a1a0a', 0.6);
    leg(-2.2, Math.PI * 0.5); leg(4, Math.PI * 1.5);
  } else {
    leg(-1, 0); leg(1, Math.PI);
    ell(g, 0, -6.5, 2.4, 2.6, body, 'rgba(0,0,0,0.4)', 0.5);
    ell(g, 0, -10, 1.5, 1.8, body);
    line(g, -0.6, -11.4, -1.4, -14, '#2a1a0a', 0.6); line(g, 0.6, -11.4, 1.4, -14, '#2a1a0a', 0.6);
  }
  g.restore();
};
MODELS.lion = (g, s) => {
  const side = s.view === 'side';
  g.save(); if (side) g.scale(s.side, 1);
  const body = '#c8a050', ph = s.walk >= 0 ? s.walk * TAU : 0;
  const leg = (bx, off, c) => { const sw = s.walk >= 0 ? Math.sin(ph + off) * 2 : 0; line(g, bx, -5, bx + sw, -0.4, c, 1.5); };
  if (side) {
    leg(-4.4, 0, shade(body, -0.3)); leg(4, Math.PI, shade(body, -0.3));
    g.strokeStyle = body; g.lineWidth = 1; g.beginPath(); g.moveTo(-6.5, -6.5); g.quadraticCurveTo(-10, -8, -9.4, -4); g.stroke();
    ell(g, 0, -6.4, 6.6, 2.8, body, 'rgba(0,0,0,0.4)', 0.5);
    ell(g, 6, -8.4, 3.6, 3.6, '#7a4a1a', 'rgba(0,0,0,0.4)', 0.5);
    ell(g, 7, -8, 2.2, 2, body);
    leg(-3, Math.PI * 0.5, body); leg(5.4, Math.PI * 1.5, body);
  } else {
    leg(-1.6, 0, body); leg(1.6, Math.PI, body);
    ell(g, 0, -6.4, 3.2, 3, body, 'rgba(0,0,0,0.4)', 0.5);
    ell(g, 0, -9.4, 3.6, 3.4, '#7a4a1a');
    ell(g, 0, -9, 2.2, 2.2, body);
  }
  g.restore();
};
MODELS.alligator = (g, s) => {
  const side = s.view === 'side';
  g.save(); if (side) g.scale(s.side, 1);
  ell(g, 0, -1.8, side ? 9 : 3, 1.8, '#4a6a2a', '#22361a', 0.6);
  if (side) poly(g, [7, -2.4, 12, -1.8, 7, -0.8], '#4a6a2a');
  g.restore();
};

// ------------------------------------------------------------ unit sprite
const UNIT_BOX = {
  default: [44, 40, 22, 34],
  mounted: [56, 48, 28, 40],
  elephant: [72, 64, 36, 52],
  siege: [64, 56, 32, 44],
  animal: [40, 32, 20, 26],
};
function boxFor(type) {
  if (['war_elephant', 'armored_elephant', 'elephant_archer', 'elephant_wild'].includes(type)) return UNIT_BOX.elephant;
  if (['stone_thrower', 'catapult', 'heavy_catapult', 'ballista', 'helepolis', 'big_daddy'].includes(type)) return UNIT_BOX.siege;
  if (['scout', 'cavalry', 'heavy_cavalry', 'cataphract', 'horse_archer', 'heavy_horse_archer', 'camel', 'chariot', 'scythe_chariot', 'chariot_archer'].includes(type)) return UNIT_BOX.mounted;
  if (['gazelle', 'lion', 'alligator'].includes(type)) return UNIT_BOX.animal;
  return UNIT_BOX.default;
}

export const UNIT_SCALE = 1.3;
export function unitSprite(type, col, dir, anim, frame, nframes, extra = '') {
  const key = `u|${type}|${col.hex}|${dir}|${anim}|${frame}|${extra}`;
  return cache.get(key, () => {
    const [w0, h0, ax0, ay0] = boxFor(type);
    const k = UNIT_SCALE;
    const w = Math.ceil(w0 * k), h = Math.ceil(h0 * k), ax = Math.round(ax0 * k), ay = Math.round(ay0 * k);
    return sprite(w, h, ax, ay, (g) => {
      g.translate(ax, ay);
      g.scale(k, k);
      const view = dir === 2 ? 'front' : dir === 6 ? 'back' : 'side';
      const side = dir === 3 || dir === 4 || dir === 5 ? -1 : 1;
      const walking = anim === 'walk' || anim === 'run';
      const s = {
        view, side, col, anim,
        walk: walking ? frame / nframes : -1,
        actT: walking ? 0 : frame / Math.max(1, nframes),
        task: extra.split(',')[0] || null,
        carry: extra.split(',')[1] || null,
        female: extra.includes('F'),
      };
      const r = boxFor(type);
      shadow(g, 0, 0, r === UNIT_BOX.elephant ? 13 : r === UNIT_BOX.mounted || r === UNIT_BOX.siege ? 9 : 4.6, r === UNIT_BOX.elephant ? 5 : r === UNIT_BOX.mounted || r === UNIT_BOX.siege ? 3.4 : 2);
      const m = MODELS[type] || MODELS.clubman;
      m(g, s);
    });
  });
}

// ---------------------------------------------------------- buildings
export const STYLES = {
  stone: { wall: '#9a7a4c', wallD: '#6e5432', roof: '#c9a45a', roofD: '#97773a', trim: '#5a3e22', roofType: 'cone' },
  egyptian: { wall: '#ddc795', wallD: '#b49e6a', roof: '#cfb57e', roofD: '#a68c58', trim: '#7a5a2a', accent: '#3a7aa0', roofType: 'flat' },
  babylonian: { wall: '#c99c64', wallD: '#a07848', roof: '#b88c54', roofD: '#8f6a3c', trim: '#6a4a2a', accent: '#2c5ea8', roofType: 'flat' },
  greek: { wall: '#ebe5d6', wallD: '#c7bea8', roof: '#b8573c', roofD: '#8a3e2a', trim: '#9a8a6a', accent: '#b8573c', roofType: 'gable' },
  asian: { wall: '#a8784e', wallD: '#7c5634', roof: '#566660', roofD: '#3a4844', trim: '#a83228', accent: '#a83228', roofType: 'curved' },
  roman: { wall: '#dbd0b8', wallD: '#b5a888', roof: '#ab4b30', roofD: '#7e3420', trim: '#7a6a50', accent: '#ab4b30', roofType: 'hip' },
};

// world offset (tiles, height px) -> sprite px
const ZS = 1.85; // vertical exaggeration so buildings look as tall as in AoE1
function P3(dx, dy, dz) { return [(dx - dy) * HW, (dx + dy) * HH - dz * ZS]; }
function face(g, pts3, fill, stroke) {
  const pts = [];
  for (const p of pts3) { const q = P3(p[0], p[1], p[2]); pts.push(q[0], q[1]); }
  poly(g, pts, fill, stroke === undefined ? 'rgba(0,0,0,0.35)' : stroke, 0.6);
}
// axis-aligned box centred at (cx,cy) in tiles relative to footprint centre
function box(g, cx, cy, hx, hy, z0, h, col, colD, top) {
  const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z1 = z0 + h;
  face(g, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], colD);       // left (SW) face
  face(g, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], col);        // right (SE) face
  if (top !== null) face(g, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], top || shade(col, 0.12));
}
function roofFor(g, type, cx, cy, hx, hy, z, rh, S) {
  const ov = 0.08;
  const x0 = cx - hx - ov, x1 = cx + hx + ov, y0 = cy - hy - ov, y1 = cy + hy + ov;
  switch (type) {
    case 'flat':
      face(g, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], S.roof);
      face(g, [[x0, y1, z], [x1, y1, z], [x1, y1, z + 2.5], [x0, y1, z + 2.5]], S.trim);
      face(g, [[x1, y0, z], [x1, y1, z], [x1, y1, z + 2.5], [x1, y0, z + 2.5]], shade(S.trim, 0.15));
      break;
    case 'gable': {
      const ym = cy;
      face(g, [[x0, y0, z], [x1, y0, z], [x1, ym, z + rh], [x0, ym, z + rh]], S.roofD);
      face(g, [[x1, y0, z], [x1, y1, z], [x1, ym, z + rh]], shade(S.wall, -0.05));
      face(g, [[x0, y1, z], [x1, y1, z], [x1, ym, z + rh], [x0, ym, z + rh]], S.roof);
      break;
    }
    case 'hip': {
      const ax = cx, ay = cy, az = z + rh;
      const rx = Math.min(hx, hy) * 0.35;
      face(g, [[x0, y0, z], [x1, y0, z], [ax + rx, ay, az], [ax - rx, ay, az]], S.roofD);
      face(g, [[x0, y0, z], [x0, y1, z], [ax - rx, ay, az]], S.roofD);
      face(g, [[x1, y0, z], [x1, y1, z], [ax + rx, ay, az]], shade(S.roof, 0.08));
      face(g, [[x0, y1, z], [x1, y1, z], [ax + rx, ay, az], [ax - rx, ay, az]], S.roof);
      break;
    }
    case 'curved': {
      const o = 0.22;
      const X0 = x0 - o, X1 = x1 + o, Y0 = y0 - o, Y1 = y1 + o;
      const az = z + rh;
      face(g, [[X0, Y0, z + 2], [X1, Y0, z + 2], [cx, cy, az]], S.roofD);
      face(g, [[X0, Y0, z + 2], [X0, Y1, z + 2], [cx, cy, az]], S.roofD);
      face(g, [[X1, Y0, z + 2], [X1, Y1, z], [cx, cy, az]], shade(S.roof, 0.1));
      face(g, [[X0, Y1, z + 2], [X1, Y1, z], [cx, cy, az]], S.roof);
      // upturned corners
      const c = P3(X1, Y1, z), l = P3(X0, Y1, z + 2), r = P3(X1, Y0, z + 2);
      line(g, c[0], c[1], c[0], c[1] - 3, S.roofD, 1.2); line(g, l[0], l[1], l[0] - 2, l[1] - 3, S.roofD, 1.2); line(g, r[0], r[1], r[0] + 2, r[1] - 3, S.roofD, 1.2);
      const t = P3(cx, cy, az);
      line(g, t[0], t[1], t[0], t[1] - 4, S.trim, 1.2);
      break;
    }
    case 'cone': {
      const t = P3(cx, cy, z + rh);
      const c = P3(cx, cy, z);
      const rx = (hx + hy) * HW * 0.82, ry = (hx + hy) * HH * 0.82;
      g.beginPath(); g.moveTo(c[0] - rx, c[1]); g.lineTo(t[0], t[1]); g.lineTo(c[0] + rx, c[1]); g.ellipse(c[0], c[1], rx, ry, 0, 0, Math.PI); g.closePath();
      g.fillStyle = S.roof; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.6; g.stroke();
      g.strokeStyle = S.roofD; g.lineWidth = 0.6;
      for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(t[0], t[1]); g.lineTo(c[0] + (rx * i) / 3.4, c[1] + ry * 0.9 * (1 - Math.abs(i) / 4)); g.stroke(); }
      break;
    }
    case 'dome': {
      const c = P3(cx, cy, z);
      const rx = (hx + hy) * HW * 0.62;
      g.beginPath(); g.ellipse(c[0], c[1], rx, rh * ZS, 0, Math.PI, TAU); g.closePath();
      const gr = g.createLinearGradient(c[0] - rx, 0, c[0] + rx, 0); gr.addColorStop(0, shade(S.roof, 0.25)); gr.addColorStop(1, S.roofD);
      g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.6; g.stroke();
      break;
    }
  }
}
function round(g, cx, cy, r, z0, h, col, colD) {
  const c0 = P3(cx, cy, z0), c1 = P3(cx, cy, z0 + h);
  const rx = r * HW * 1.4, ry = r * HH * 1.4;
  g.beginPath(); g.moveTo(c0[0] - rx, c0[1]); g.ellipse(c0[0], c0[1], rx, ry, 0, Math.PI, 0, true); g.lineTo(c1[0] + rx, c1[1]); g.ellipse(c1[0], c1[1], rx, ry, 0, 0, Math.PI, false); g.closePath();
  const gr = g.createLinearGradient(c0[0] - rx, 0, c0[0] + rx, 0); gr.addColorStop(0, colD); gr.addColorStop(0.6, col); gr.addColorStop(1, shade(col, -0.2));
  g.fillStyle = gr; g.fill(); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.6; g.stroke();
  ell(g, c1[0], c1[1], rx, ry, shade(col, 0.1), 'rgba(0,0,0,0.3)', 0.5);
}
function flag(g, dx, dy, z, h, col) {
  const b = P3(dx, dy, z), t = P3(dx, dy, z + h);
  line(g, b[0], b[1], t[0], t[1], '#5a3a1a', 1);
  poly(g, [t[0], t[1], t[0] + 7, t[1] + 2, t[0], t[1] + 4.5], col.hex, shade(col.hex, -0.4), 0.5);
}
function columns(g, x0, x1, y, z, h, n, col) {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    const a = P3(x, y, z), b = P3(x, y, z + h);
    line(g, a[0], a[1], b[0], b[1], col, 2.2);
    line(g, a[0] - 0.4, a[1], b[0] - 0.4, b[1], 'rgba(255,255,255,0.35)', 0.6);
  }
}
function door(g, x, y, z, w, h, col = '#3a2412') {
  // door on the left (SW) face at x position
  face(g, [[x - w, y, z], [x + w, y, z], [x + w, y, z + h], [x - w, y, z + h]], col, null);
}
// row of windows on the left (SW, y = const) face
function winL(g, x0, x1, y, z, n, h = 3, col = '#2a1a0c') {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
    face(g, [[x - 0.07, y, z], [x + 0.07, y, z], [x + 0.07, y, z + h], [x - 0.07, y, z + h]], col, null);
  }
}
// row of windows on the right (SE, x = const) face
function winR(g, x, y0, y1, z, n, h = 3, col = '#2a1a0c') {
  for (let i = 0; i < n; i++) {
    const y = y0 + ((y1 - y0) * (i + 0.5)) / n;
    face(g, [[x, y - 0.07, z], [x, y + 0.07, z], [x, y + 0.07, z + h], [x, y - 0.07, z + h]], col, null);
  }
}
function fence(g, x0, y0, x1, y1, z = 0, h = 4) {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) * 2.5));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    const a = P3(x, y, z), b = P3(x, y, z + h);
    line(g, a[0], a[1], b[0], b[1], WOOD, 1);
  }
  const a = P3(x0, y0, z + h * 0.7), b = P3(x1, y1, z + h * 0.7);
  line(g, a[0], a[1], b[0], b[1], WOOD, 0.9);
}
function banner(g, x, y, z, h, col) {
  // hanging team-coloured banner on the left face
  face(g, [[x - 0.1, y + 0.02, z], [x + 0.1, y + 0.02, z], [x + 0.1, y + 0.02, z - h], [x, y + 0.02, z - h - 1.5], [x - 0.1, y + 0.02, z - h]], col.hex, shade(col.hex, -0.45));
}

const BUILD_H = { house: 14, town_center: 26, barracks: 20, granary: 18, storage_pit: 10, market: 16, archery_range: 16, stable: 18, temple: 30, government_center: 30, siege_workshop: 20, academy: 22, wonder: 60, farm: 6, watch_tower: 40, sentry_tower: 44, guard_tower: 48, ballista_tower: 50, small_wall: 14, medium_wall: 17, fortified_wall: 20, dock: 14 };
export function buildingHeight(type) { return (BUILD_H[type] || 20) * ZS; }

function drawBuilding(g, type, S, tier, col, size) {
  const h = size / 2 - 0.15; // half-extent in tiles
  const H = BUILD_H[type] || 20;
  const rt = S.roofType;
  const stoneAge = tier === 0;
  switch (type) {
    case 'house': {
      if (stoneAge) {
        round(g, 0, 0, 0.62, 0, 7, S.wall, S.wallD);
        roofFor(g, 'cone', 0, 0, 0.62, 0.62, 7, 15, S);
        door(g, 0.1, 0.62, 0, 0.14, 5);
      } else {
        const hh = tier >= 2 ? 0.72 : 0.64;
        const wh = tier >= 2 ? 11 : 9;
        if (tier >= 2) box(g, 0, 0, hh + 0.08, hh + 0.08, 0, 1.5, shade(S.wallD, -0.1), shade(S.wallD, -0.25));
        box(g, 0, 0, hh, hh, tier >= 2 ? 1.5 : 0, wh, S.wall, S.wallD);
        roofFor(g, rt === 'flat' ? 'flat' : rt, 0, 0, hh, hh, wh + (tier >= 2 ? 1.5 : 0), rt === 'curved' ? 10 : 8, S);
        door(g, -0.15, hh, 0, 0.13, 6);
        winL(g, 0.1, 0.55, hh, 4, 1, 2.5); winR(g, hh, -0.4, 0.4, 4, 2, 2.5);
        if (rt === 'flat') box(g, -0.3, -0.3, 0.28, 0.28, wh + (tier >= 2 ? 1.5 : 0), 4, S.wall, S.wallD);
      }
      flag(g, -0.6, -0.6, stoneAge ? 6 : 10, 7, col);
      break;
    }
    case 'town_center': {
      if (stoneAge) {
        round(g, -0.5, -0.5, 0.75, 0, 9, S.wall, S.wallD); roofFor(g, 'cone', -0.5, -0.5, 0.75, 0.75, 9, 16, S);
        round(g, 0.6, -0.4, 0.6, 0, 7, S.wall, S.wallD); roofFor(g, 'cone', 0.6, -0.4, 0.6, 0.6, 7, 13, S);
        round(g, -0.4, 0.6, 0.6, 0, 7, S.wall, S.wallD); roofFor(g, 'cone', -0.4, 0.6, 0.6, 0.6, 7, 13, S);
        round(g, 0.5, 0.6, 0.55, 0, 6, S.wall, S.wallD); roofFor(g, 'cone', 0.5, 0.6, 0.55, 0.55, 6, 11, S);
        fence(g, -h, h, h, h, 0, 3); fence(g, h, -h, h, h, 0, 3);
        flag(g, -0.5, -0.5, 22, 8, col);
      } else {
        const big = tier >= 2;
        box(g, 0, 0, h, h, 0, 3, shade(S.wallD, -0.1), shade(S.wallD, -0.25));
        // side wings
        box(g, -0.15, -0.15, h - 0.2, h - 0.2, 3, big ? 9 : 7, shade(S.wall, -0.04), shade(S.wallD, -0.04));
        winL(g, -h + 0.4, h - 0.6, h - 0.35, 5.5, 4, 2.6); winR(g, h - 0.35, -h + 0.4, h - 0.6, 5.5, 4, 2.6);
        // main hall
        const z0 = 3 + (big ? 9 : 7);
        box(g, -0.25, -0.25, h - 0.55, h - 0.55, z0, big ? 9 : 7, S.wall, S.wallD);
        winL(g, -h + 0.5, h - 0.9, h - 0.8, z0 + 2.5, 3, 3); winR(g, h - 0.8, -h + 0.5, h - 0.9, z0 + 2.5, 3, 3);
        roofFor(g, rt, -0.25, -0.25, h - 0.55, h - 0.55, z0 + (big ? 9 : 7), rt === 'curved' ? 12 : 9, S);
        if (big && (rt === 'gable' || rt === 'hip')) columns(g, -h + 0.35, h - 0.45, h - 0.1, 3, big ? 9 : 7, 6, '#f4efe2');
        door(g, 0.1, h - 0.2, 3, 0.26, 7);
        banner(g, -0.6, h - 0.2, 10, 5, col); banner(g, 0.8, h - 0.2, 10, 5, col);
        flag(g, -h + 0.15, -h + 0.15, 3, 26, col); flag(g, h - 0.15, -h + 0.15, 3, 21, col); flag(g, -h + 0.15, h - 0.15, 3, 18, col);
        if (rt === 'flat') box(g, -0.7, -0.7, 0.35, 0.35, z0 + (big ? 9 : 7), 6, S.wall, S.wallD);
      }
      break;
    }
    case 'barracks': {
      const wh = stoneAge ? 8 : tier >= 2 ? 12 : 10;
      // training yard in front with a fence
      face(g, [[-h, 0.35, 0], [h, 0.35, 0], [h, h, 0], [-h, h, 0]], 'rgba(120,96,60,0.55)', null);
      box(g, 0, -0.35, h, h - 0.35, 0, wh, S.wall, S.wallD);
      roofFor(g, stoneAge ? 'gable' : rt, 0, -0.35, h, h - 0.35, wh, rt === 'curved' ? 10 : 8, S);
      winR(g, h, -h + 0.2, h - 0.9, wh * 0.45, 3, 2.5);
      // shields hanging on the front wall
      for (let i = 0; i < 4; i++) { const p = P3(-1 + i * 0.6, 0.67, wh * 0.55); ell(g, p[0], p[1], 2.6, 3.1, col.hex, '#3a2a1a', 0.5); ell(g, p[0], p[1], 0.8, 0.8, METAL); }
      // weapon rack & training dummy in the yard
      const r = P3(0.7, 1.0, 0); line(g, r[0] - 6, r[1] + 2, r[0] + 6, r[1] - 2, WOOD, 1.4);
      for (let i = 0; i < 4; i++) line(g, r[0] - 5 + i * 3.4, r[1] + 1.5 - i * 1.2, r[0] - 5 + i * 3.4, r[1] - 9 - i * 1.2, i % 2 ? METAL_D : WOOD, 0.9);
      const d = P3(-0.6, 1.0, 0); line(g, d[0], d[1], d[0], d[1] - 11, WOOD, 1.6); line(g, d[0] - 4, d[1] - 8, d[0] + 4, d[1] - 8, WOOD, 1.4); ell(g, d[0], d[1] - 12.5, 2, 2, '#c8a860');
      fence(g, -h, h, h, h, 0, 3);
      flag(g, -h + 0.1, -h + 0.1, wh, 10, col);
      break;
    }
    case 'granary': {
      const c = stoneAge ? S.wall : shade(S.wall, -0.05);
      round(g, -0.55, -0.35, 0.55, 0, 11, c, S.wallD); roofFor(g, stoneAge ? 'cone' : 'dome', -0.55, -0.35, 0.55, 0.55, 11, stoneAge ? 9 : 8, S);
      round(g, 0.45, -0.55, 0.5, 0, 10, c, S.wallD); roofFor(g, stoneAge ? 'cone' : 'dome', 0.45, -0.55, 0.5, 0.5, 10, stoneAge ? 8 : 7, S);
      round(g, 0.05, 0.55, 0.6, 0, 12, c, S.wallD); roofFor(g, stoneAge ? 'cone' : 'dome', 0.05, 0.55, 0.6, 0.6, 12, stoneAge ? 10 : 9, S);
      flag(g, 0.9, 0.6, 0, 16, col);
      break;
    }
    case 'storage_pit': {
      // low walled yard with logs & stones
      face(g, [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]], shade(S.wallD, -0.2));
      box(g, 0, -h + 0.1, h, 0.1, 0, 6, S.wall, S.wallD);
      box(g, -h + 0.1, 0, 0.1, h, 0, 6, S.wall, S.wallD);
      for (let i = 0; i < 4; i++) { const p = P3(-0.3 + i * 0.25, 0.4, 2 + i); line(g, p[0] - 7, p[1] + 3, p[0] + 7, p[1] - 3, i % 2 ? '#8a5a2a' : '#6a4420', 2.4); }
      ell(g, ...P3(0.6, -0.4, 3), 4, 2.6, '#a8a8a0', '#5a5a52', 0.5);
      ell(g, ...P3(0.8, -0.1, 2), 3.4, 2.2, '#e0c040', '#8a6a10', 0.5);
      const a = P3(0.7, 0.7, 0), b = P3(0.7, 0.7, 22), c2 = P3(0.1, 0.1, 18);
      line(g, a[0], a[1], b[0], b[1], WOOD, 1.6); line(g, b[0], b[1], c2[0], c2[1], WOOD, 1.2); line(g, c2[0], c2[1], c2[0], c2[1] + 8, '#d8d0b0', 0.5);
      box(g, h - 0.1, 0, 0.1, h, 0, 6, S.wall, S.wallD);
      box(g, 0, h - 0.1, h, 0.1, 0, 6, S.wall, S.wallD);
      flag(g, -h, -h, 6, 12, col);
      break;
    }
    case 'market': {
      face(g, [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]], shade(S.wall, -0.25));
      const stall = (x, y, c1) => {
        box(g, x, y, 0.45, 0.45, 0, 6, '#8a5a2a', '#6a4420');
        face(g, [[x - 0.55, y - 0.55, 12], [x + 0.55, y - 0.55, 12], [x + 0.55, y + 0.55, 9], [x - 0.55, y + 0.55, 9]], c1);
        const p = P3(x + 0.45, y + 0.45, 0), q = P3(x + 0.45, y + 0.45, 10); line(g, p[0], p[1], q[0], q[1], WOOD, 1);
      };
      stall(-0.6, -0.6, col.hex); stall(0.6, -0.6, '#e8e0c8'); stall(-0.6, 0.6, '#c8a030'); stall(0.6, 0.6, col.hex);
      if (tier >= 2) { box(g, 0, 0, 0.3, 0.3, 0, 14, S.wall, S.wallD); roofFor(g, rt, 0, 0, 0.3, 0.3, 14, 7, S); }
      break;
    }
    case 'archery_range': {
      face(g, [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]], shade(S.wall, -0.3));
      box(g, -0.7, -0.7, 0.55, 0.55, 0, 10, S.wall, S.wallD);
      roofFor(g, rt === 'cone' ? 'gable' : rt, -0.7, -0.7, 0.55, 0.55, 10, 8, S);
      for (let i = 0; i < 3; i++) {
        const p = P3(0.9, -0.8 + i * 0.75, 0);
        line(g, p[0], p[1], p[0], p[1] - 9, WOOD, 1.2);
        ell(g, p[0], p[1] - 10, 3.4, 3.4, '#e8e0c8', '#3a2a1a', 0.5); ell(g, p[0], p[1] - 10, 2, 2, '#c82020'); ell(g, p[0], p[1] - 10, 0.8, 0.8, '#e8e0c8');
      }
      for (let i = 0; i < 6; i++) { const a = P3(-h + i * 0.5, h, 0), b = P3(-h + i * 0.5, h, 6); line(g, a[0], a[1], b[0], b[1], WOOD, 1); }
      const f1 = P3(-h, h, 4), f2 = P3(h, h, 4); line(g, f1[0], f1[1], f2[0], f2[1], WOOD, 1);
      flag(g, -h + 0.1, -h + 0.1, 10, 10, col);
      break;
    }
    case 'stable': {
      const wh = tier >= 2 ? 11 : 9;
      // paddock in front
      face(g, [[-h, 0.1, 0], [h, 0.1, 0], [h, h, 0], [-h, h, 0]], 'rgba(130,100,50,0.5)', null);
      box(g, 0, -0.55, h, h - 0.95, 0, wh, S.wall, S.wallD);
      roofFor(g, rt === 'flat' ? 'flat' : rt === 'cone' ? 'gable' : rt, 0, -0.55, h, h - 0.95, wh, rt === 'flat' ? 8 : 9, S);
      for (let i = 0; i < 4; i++) door(g, -1 + i * 0.65, -0.55 + h - 0.95, 0, 0.16, 6.5, '#2a1a0a');
      // hay bales & trough
      ell(g, ...P3(0.85, 0.75, 1.5), 4, 2.6, '#d8c070', '#8a7030', 0.5); ell(g, ...P3(0.55, 0.95, 1.5), 4, 2.6, '#cdb460', '#8a7030', 0.5);
      const tr = P3(-0.4, 0.55, 1.5); poly(g, [tr[0] - 9, tr[1] + 2.5, tr[0] + 7, tr[1] - 5.5, tr[0] + 9, tr[1] - 3.5, tr[0] - 7, tr[1] + 4.5], '#6a4a22', '#3a2410', 0.5);
      fence(g, -h, h, h, h, 0, 3.5); fence(g, h, 0.1, h, h, 0, 3.5); fence(g, -h, 0.1, -h, h, 0, 3.5);
      flag(g, h - 0.1, -h + 0.1, wh, 10, col);
      break;
    }
    case 'temple': {
      if (S === STYLES.greek || S === STYLES.roman) {
        box(g, 0, 0, h, h, 0, 4, shade(S.wall, -0.1), shade(S.wallD, -0.1));
        box(g, 0, 0, h - 0.4, h - 0.5, 4, 18, S.wall, S.wallD);
        columns(g, -h + 0.25, h - 0.25, h - 0.15, 4, 18, 6, '#f6f1e4');
        roofFor(g, S === STYLES.roman ? 'dome' : 'gable', 0, 0, h - 0.2, h - 0.2, 22, S === STYLES.roman ? 16 : 10, S);
      } else if (S === STYLES.egyptian) {
        box(g, 0, -0.3, h - 0.2, h - 0.6, 0, 18, S.wall, S.wallD);
        box(g, -0.8, h - 0.5, 0.45, 0.35, 0, 26, S.wall, S.wallD); box(g, 0.8, h - 0.5, 0.45, 0.35, 0, 26, S.wall, S.wallD);
        door(g, 0, h - 0.3, 0, 0.3, 12);
        const ob = P3(h - 0.3, h - 0.2, 0), ot = P3(h - 0.3, h - 0.2, 30); poly(g, [ob[0] - 2, ob[1], ob[0] + 2, ob[1], ot[0] + 0.5, ot[1], ot[0] - 0.5, ot[1]], '#e8d8a8', '#8a7a4a', 0.5);
      } else if (S === STYLES.babylonian) {
        box(g, 0, 0, h, h, 0, 8, S.wall, S.wallD); box(g, 0, 0, h - 0.4, h - 0.4, 8, 8, shade(S.wall, 0.05), S.wallD);
        box(g, 0, 0, h - 0.8, h - 0.8, 16, 8, shade(S.wall, 0.1), S.wallD); box(g, 0, 0, 0.3, 0.3, 24, 8, S.accent, shade(S.accent, -0.3));
      } else {
        box(g, 0, 0, h - 0.3, h - 0.3, 0, 12, S.wall, S.wallD);
        roofFor(g, 'curved', 0, 0, h - 0.3, h - 0.3, 12, 8, S);
        box(g, 0, 0, h - 0.7, h - 0.7, 20, 7, S.wall, S.wallD);
        roofFor(g, 'curved', 0, 0, h - 0.7, h - 0.7, 27, 9, S);
      }
      flag(g, -h, -h, 0, 30, col);
      break;
    }
    case 'government_center': {
      // stepped plinth, colonnaded hall, dome or pediment
      box(g, 0, 0, h, h, 0, 2, shade(S.wall, -0.15), shade(S.wallD, -0.15));
      box(g, 0, 0, h - 0.12, h - 0.12, 2, 2, shade(S.wall, -0.08), S.wallD);
      box(g, -0.15, -0.15, h - 0.45, h - 0.45, 4, 14, S.wall, S.wallD);
      winL(g, -h + 0.5, h - 0.9, h - 0.6, 10, 3, 3); winR(g, h - 0.6, -h + 0.5, h - 0.9, 10, 3, 3);
      if (rt === 'gable' || rt === 'hip' || rt === 'curved') columns(g, -h + 0.3, h - 0.3, h - 0.18, 4, 14, 7, rt === 'curved' ? S.trim : '#f6f1e4');
      else columns(g, -h + 0.3, h - 0.3, h - 0.18, 4, 14, 5, shade(S.wall, 0.15));
      roofFor(g, rt === 'flat' ? 'flat' : rt, -0.15, -0.15, h - 0.45, h - 0.45, 18, rt === 'curved' ? 10 : 8, S);
      if (rt === 'flat' || rt === 'hip') roofFor(g, 'dome', -0.15, -0.15, 0.55, 0.55, rt === 'flat' ? 18 : 22, 9, S);
      door(g, 0.1, h - 0.6, 4, 0.22, 7);
      banner(g, -0.7, h - 0.6, 15, 6, col); banner(g, 0.9, h - 0.6, 15, 6, col);
      flag(g, -h, -h, 4, 28, col); flag(g, h - 0.2, -h, 4, 24, col);
      break;
    }
    case 'siege_workshop': {
      box(g, -0.3, -0.3, h - 0.35, h - 0.35, 0, 13, S.wall, S.wallD);
      roofFor(g, rt === 'cone' ? 'gable' : rt, -0.3, -0.3, h - 0.35, h - 0.35, 13, 9, S);
      const a = P3(0.8, 0.8, 0), b = P3(0.4, 0.9, 20);
      line(g, a[0] - 6, a[1], a[0] + 6, a[1] - 2, WOOD_D, 2); line(g, a[0], a[1] - 1, b[0], b[1], WOOD, 2);
      ell(g, b[0], b[1], 2, 1.5, '#6a4a2a');
      flag(g, -h, -h, 13, 9, col);
      break;
    }
    case 'academy': {
      face(g, [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]], shade(S.wall, -0.2));
      box(g, 0, -h + 0.3, h, 0.3, 0, 16, S.wall, S.wallD); box(g, -h + 0.3, 0, 0.3, h, 0, 16, S.wall, S.wallD);
      roofFor(g, rt === 'cone' ? 'gable' : rt, 0, -h + 0.3, h, 0.3, 16, 6, S);
      columns(g, -h + 0.7, h - 0.1, h - 0.15, 0, 13, 5, '#f6f1e4');
      const a = P3(-h + 0.6, h - 0.15, 13), b = P3(h - 0.1, h - 0.15, 13); line(g, a[0], a[1], b[0], b[1], S.trim, 2.4);
      flag(g, h - 0.1, -h + 0.1, 16, 10, col);
      break;
    }
    case 'wonder': {
      if (S === STYLES.egyptian || S === STYLES.stone) {
        face(g, [[-h, h, 0], [h, h, 0], [0, 0, 62]], shade(S.wall, -0.12));
        face(g, [[h, -h, 0], [h, h, 0], [0, 0, 62]], S.wall);
        const t = P3(0, 0, 62); ell(g, t[0], t[1] + 2, 2, 2, '#f0d040');
      } else if (S === STYLES.babylonian) {
        for (let i = 0; i < 4; i++) box(g, 0, 0, h - i * 0.5, h - i * 0.5, i * 13, 13, shade(S.wall, i * 0.05), S.wallD);
        box(g, 0, 0, 0.6, 0.6, 52, 10, S.accent, shade(S.accent, -0.3));
      } else if (S === STYLES.asian) {
        for (let i = 0; i < 4; i++) { box(g, 0, 0, h - 0.6 - i * 0.35, h - 0.6 - i * 0.35, i * 16, 10, S.wall, S.wallD); roofFor(g, 'curved', 0, 0, h - 0.6 - i * 0.35, h - 0.6 - i * 0.35, i * 16 + 10, 6, S); }
      } else {
        box(g, 0, 0, h, h, 0, 6, shade(S.wall, -0.1), S.wallD);
        box(g, 0, 0, h - 0.4, h - 0.4, 6, 34, S.wall, S.wallD);
        columns(g, -h + 0.5, h - 0.5, h - 0.25, 6, 34, 9, '#f6f1e4');
        roofFor(g, S === STYLES.roman ? 'dome' : 'gable', 0, 0, h - 0.3, h - 0.3, 40, 18, S);
      }
      flag(g, -h, -h, 0, 40, col); flag(g, h, -h, 0, 34, col);
      break;
    }
    case 'watch_tower': case 'sentry_tower': case 'guard_tower': case 'ballista_tower': {
      const th = H;
      const r = type === 'watch_tower' ? 0.32 : 0.38;
      if (type === 'watch_tower' && tier < 2) {
        // wooden watch tower
        const legs = [[-r, -r], [r, -r], [r, r], [-r, r]];
        for (const [x, y] of legs) { const a = P3(x, y, 0), b = P3(x * 0.8, y * 0.8, th - 10); line(g, a[0], a[1], b[0], b[1], WOOD, 1.8); }
        box(g, 0, 0, r, r, th - 12, 8, '#8a5a2a', '#6a4420');
        roofFor(g, 'cone', 0, 0, r, r, th - 4, 8, STYLES.stone);
      } else {
        box(g, 0, 0, r, r, 0, th, '#b8b0a0', '#8a8272');
        box(g, 0, 0, r + 0.06, r + 0.06, th, 4, '#c8c0b0', '#9a9282');
        for (let i = 0; i < 3; i++) { const p = P3(-r + i * r, r + 0.06, th + 4); g.fillStyle = '#a8a090'; g.fillRect(p[0] - 1.5, p[1] - 3, 3, 3); }
        if (type === 'ballista_tower') { const p = P3(0, 0, th + 6); line(g, p[0] - 6, p[1], p[0] + 6, p[1] - 2, WOOD_D, 1.6); }
      }
      flag(g, 0, 0, th + 2, 10, col);
      break;
    }
    case 'small_wall': case 'medium_wall': case 'fortified_wall': {
      const c = type === 'small_wall' ? '#a89a7a' : type === 'medium_wall' ? '#b0a68c' : '#bab2a0';
      box(g, 0, 0, 0.5, 0.5, 0, H, c, shade(c, -0.25));
      for (let i = 0; i < 2; i++) { const p = P3(-0.25 + i * 0.5, 0.5, H); g.fillStyle = shade(c, -0.1); g.fillRect(p[0] - 2, p[1] - 3, 4, 3); }
      break;
    }
    case 'dock': {
      face(g, [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]], '#8a5a2a');
      box(g, -0.6, -0.6, 0.6, 0.6, 0, 10, S.wall, S.wallD); roofFor(g, rt, -0.6, -0.6, 0.6, 0.6, 10, 8, S);
      break;
    }
    default:
      box(g, 0, 0, h, h, 0, H, S.wall, S.wallD);
      roofFor(g, rt, 0, 0, h, h, H, 10, S);
  }
}

export function buildingSprite(type, arch, tier, col, size) {
  const S = tier === 0 ? STYLES.stone : (STYLES[arch] || STYLES.greek);
  const key = `b|${type}|${tier === 0 ? 'stone' : arch}|${tier}|${col.hex}`;
  return cache.get(key, () => {
    const H = (BUILD_H[type] || 20) * ZS + 46;
    const w = size * 64 + 24, h = size * 32 + H + 12;
    const ax = w / 2, ay = size * 16 + H + 4; // footprint centre
    return sprite(w, h, ax, ay, (g) => {
      g.translate(ax, ay);
      // ground shadow / base
      const s2 = size / 2;
      face(g, [[-s2, -s2, 0], [s2, -s2, 0], [s2, s2, 0], [-s2, s2, 0]], 'rgba(40,30,10,0.25)', null);
      drawBuilding(g, type, S, tier, col, size);
    });
  });
}

export function farmSprite(stage, size = 3) {
  const key = `farm|${stage}`;
  return cache.get(key, () => {
    const w = size * 64 + 8, h = size * 32 + 20;
    const ax = w / 2, ay = size * 16 + 14;
    return sprite(w, h, ax, ay, (g) => {
      g.translate(ax, ay);
      const s2 = size / 2 - 0.04;
      face(g, [[-s2, -s2, 0], [s2, -s2, 0], [s2, s2, 0], [-s2, s2, 0]], '#7a5a30', '#4a3418');
      const crop = stage === 0 ? '#5a3e20' : stage === 1 ? '#7a9a30' : stage === 2 ? '#9ab03a' : '#c8b040';
      for (let i = 0; i < 9; i++) {
        const y = -s2 + 0.15 + (i * (2 * s2 - 0.3)) / 8;
        const a = P3(-s2 + 0.15, y, 0.5), b = P3(s2 - 0.15, y, 0.5);
        line(g, a[0], a[1], b[0], b[1], crop, 2.2);
        if (stage >= 2) for (let k = 0; k < 6; k++) { const p = P3(-s2 + 0.3 + k * 0.45, y, 0); line(g, p[0], p[1], p[0], p[1] - 3, shade(crop, 0.1), 0.8); }
      }
      // little hut in the back corner
      box(g, -s2 + 0.35, -s2 + 0.35, 0.25, 0.25, 0, 5, '#a07a4a', '#7a5a30');
      roofFor(g, 'cone', -s2 + 0.35, -s2 + 0.35, 0.25, 0.25, 5, 6, STYLES.stone);
    });
  });
}

export function foundationSprite(size) {
  return cache.get(`found|${size}`, () => {
    const w = size * 64 + 8, h = size * 32 + 30;
    const ax = w / 2, ay = size * 16 + 24;
    return sprite(w, h, ax, ay, (g) => {
      g.translate(ax, ay);
      const s2 = size / 2 - 0.05;
      face(g, [[-s2, -s2, 0], [s2, -s2, 0], [s2, s2, 0], [-s2, s2, 0]], 'rgba(110,80,40,0.55)', '#3a2410');
      for (const [x, y] of [[-s2, -s2], [s2, -s2], [s2, s2], [-s2, s2]]) { const a = P3(x, y, 0), b = P3(x, y, 12); line(g, a[0], a[1], b[0], b[1], WOOD, 1.4); }
    });
  });
}

// ------------------------------------------------------------- nature
export function treeSprite(variant, felled) {
  return cache.get(`tree|${variant}|${felled ? 1 : 0}`, () => sprite(56, 72, 28, 64, (g) => {
    g.translate(28, 64);
    shadow(g, 3, 0, 12, 5);
    if (felled) {
      ell(g, 0, -1.5, 3.4, 2, '#8a6a40', '#4a3018', 0.6); ell(g, 0, -2.2, 2.4, 1.2, '#c8a870');
      line(g, 2, -1, 12, 2, '#7a5230', 2.4);
      return;
    }
    const pine = variant >= 3;
    line(g, 0, 0, 0, pine ? -12 : -14, '#5a3a1a', 3);
    if (pine) {
      const cols = ['#2f5a24', '#3a6a2c', '#2a4e1e'];
      for (let i = 0; i < 4; i++) {
        const y = -10 - i * 9, w = 13 - i * 2.6;
        poly(g, [-w, y + 2, w, y + 2, 0, y - 12], cols[i % 3], 'rgba(0,0,0,0.3)', 0.5);
        poly(g, [-w * 0.2, y + 1, w, y + 2, 0, y - 12], 'rgba(0,0,0,0.15)');
      }
    } else {
      const base = variant === 0 ? '#3e6a24' : variant === 1 ? '#46732a' : '#365e20';
      const blobs = [[0, -30, 11], [-8, -24, 8], [8, -24, 8.5], [-4, -38, 7.5], [5, -37, 7], [0, -20, 8]];
      for (const [x, y, r] of blobs) ell(g, x, y, r, r * 0.88, base, 'rgba(0,0,0,0.25)', 0.5);
      for (const [x, y, r] of blobs) ell(g, x - r * 0.3, y - r * 0.3, r * 0.5, r * 0.42, shade(base, 0.18));
      for (const [x, y, r] of blobs.slice(0, 3)) ell(g, x + r * 0.35, y + r * 0.3, r * 0.45, r * 0.35, shade(base, -0.25));
    }
  }));
}

export function resourceSprite(type, stage) {
  return cache.get(`res|${type}|${stage}`, () => sprite(56, 44, 28, 32, (g) => {
    g.translate(28, 30);
    if (type === 'berry_bush') {
      shadow(g, 1, 0, 11, 4);
      const blobs = [[-5, -6, 6], [5, -6, 6], [0, -10, 7], [0, -4, 6]];
      for (const [x, y, r] of blobs) ell(g, x, y, r, r * 0.8, '#3d6a22', 'rgba(0,0,0,0.3)', 0.5);
      for (const [x, y, r] of blobs) ell(g, x - 1.5, y - 1.5, r * 0.5, r * 0.4, '#5a8a32');
      const n = [0, 4, 9, 14][stage];
      for (let i = 0; i < n; i++) { const a = i * 2.4, rr = 3 + (i % 3) * 2; ell(g, Math.cos(a) * rr, -7 + Math.sin(a) * rr * 0.6, 1.2, 1.2, i % 2 ? '#b02040' : '#d04060', '#5a0a18', 0.3); }
    } else {
      const gold = type === 'gold_mine';
      const n = [2, 3, 5, 7][stage];
      shadow(g, 0, 0, 12, 4.5);
      const rocks = [[-6, -3, 6], [5, -3, 5.5], [0, -7, 6.5], [-3, -10, 4.5], [4, -9, 4.2], [-8, -6, 3.6], [8, -6, 3.4]].slice(0, n);
      for (const [x, y, r] of rocks) {
        poly(g, [x - r, y + 2, x - r * 0.6, y - r * 0.7, x + r * 0.3, y - r, x + r, y - r * 0.2, x + r * 0.8, y + 2], gold ? '#8a7a5a' : '#9a968c', 'rgba(0,0,0,0.45)', 0.6);
        poly(g, [x - r * 0.6, y - r * 0.7, x + r * 0.3, y - r, x + r * 0.1, y - r * 0.2], gold ? '#a89874' : '#b8b4aa');
        if (gold) { ell(g, x + 0.5, y - 1, 1.6, 1.1, '#f2cc3a', '#8a6a10', 0.3); ell(g, x - r * 0.4, y - r * 0.4, 1, 0.8, '#ffe070'); }
      }
    }
  }));
}

export function carcassSprite(animal, col) {
  return cache.get(`carc|${animal}`, () => {
    const base = unitSprite(animal, col, 0, 'idle', 0, 1);
    return sprite(base.w, base.h, base.ax, base.ay, (g) => {
      g.translate(base.ax, base.ay);
      g.rotate(-Math.PI / 2 * 0.95);
      g.globalAlpha = 0.95;
      g.drawImage(base.c, -base.ax, -base.ay, base.w, base.h);
      g.globalAlpha = 1;
      g.rotate(Math.PI / 2 * 0.95);
      ell(g, 2, -2, 3, 1.5, 'rgba(140,20,20,0.7)');
    });
  });
}

export function rubbleSprite(size) {
  return cache.get(`rubble|${size}`, () => {
    const w = size * 64 + 8, h = size * 32 + 24;
    const ax = w / 2, ay = size * 16 + 16;
    return sprite(w, h, ax, ay, (g) => {
      g.translate(ax, ay);
      const s2 = size / 2 - 0.1;
      face(g, [[-s2, -s2, 0], [s2, -s2, 0], [s2, s2, 0], [-s2, s2, 0]], 'rgba(60,45,30,0.6)', null);
      let seed = size * 97;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < size * size * 6; i++) {
        const p = P3((rnd() - 0.5) * size * 0.9, (rnd() - 0.5) * size * 0.9, rnd() * 4);
        const r = 1.5 + rnd() * 3;
        poly(g, [p[0] - r, p[1], p[0], p[1] - r * 0.8, p[0] + r, p[1] - r * 0.1, p[0] + r * 0.4, p[1] + r * 0.5], rnd() > 0.5 ? '#8a8070' : '#6a5038', 'rgba(0,0,0,0.4)', 0.4);
      }
    });
  });
}

// Icon (HUD buttons / portraits): a unit or building sprite fitted into a box.
export function iconCanvas(kind, type, col, size = 40, opts = {}) {
  const key = `icon|${kind}|${type}|${col.hex}|${size}|${opts.arch || ''}|${opts.tier ?? ''}`;
  return cache.get(key, () => {
    const c = document.createElement('canvas');
    c.width = size * SS; c.height = size * SS;
    const g = c.getContext('2d');
    g.scale(SS, SS);
    const grd = g.createLinearGradient(0, 0, 0, size);
    grd.addColorStop(0, opts.bg1 || '#5a6a7a'); grd.addColorStop(1, opts.bg2 || '#2a3440');
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
    let spr;
    if (kind === 'unit') spr = unitSprite(type, col, 1, 'idle', 0, 1, opts.extra || '');
    else if (kind === 'building') spr = type === 'farm' ? farmSprite(2) : buildingSprite(type, opts.arch || 'greek', opts.tier ?? 1, col, opts.size || 3);
    else if (kind === 'tree') spr = treeSprite(0, false);
    else if (kind === 'res') spr = resourceSprite(type, 3);
    if (spr && kind === 'building') {
      // crop to the building itself (sprites carry headroom for tall roofs)
      const bs = type === 'farm' ? 3 : (opts.size || 3);
      const H = buildingHeight(type) + 18;
      const top = Math.max(0, spr.ay - bs * 16 - H), bot = Math.min(spr.h, spr.ay + bs * 16 + 3);
      const left = Math.max(0, spr.ax - bs * 32 - 4), right = Math.min(spr.w, spr.ax + bs * 32 + 4);
      const sw = right - left, sh = bot - top;
      const sc = Math.min((size - 4) / sw, (size - 4) / sh);
      g.drawImage(spr.c, left * SS, top * SS, sw * SS, sh * SS, (size - sw * sc) / 2, (size - sh * sc) / 2 + 1, sw * sc, sh * sc);
    } else if (spr) {
      const sc = Math.min((size - 4) / spr.w, (size - 4) / spr.h) * (kind === 'unit' ? 1.45 : 1.05);
      const dw = spr.w * sc, dh = spr.h * sc;
      let dx = (size - dw) / 2, dy = (size - dh) / 2;
      if (kind === 'unit') dy = size - 3 - spr.ay * sc;
      g.drawImage(spr.c, dx, dy, dw, dh);
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, size - 1, size - 1);
    return c;
  });
}

export const SUPERSAMPLE = SS;
