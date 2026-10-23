// Sprite gallery (dev tool): every unit, building (5 architecture sets x 3
// tiers) and nature sprite on one page. Open /gallery.html?part=units|buildings
import { UNITS } from '../engine/data/units.js';
import { BUILDINGS } from '../engine/data/buildings.js';
import { PLAYER_COLORS } from '../engine/constants.js';
import { unitSprite, buildingSprite, treeSprite, resourceSprite, farmSprite, rubbleSprite, carcassSprite, foundationSprite } from '../render/sprites.js';

const part = new URLSearchParams(location.search).get('part') || 'units';
const colorIdx = Number(new URLSearchParams(location.search).get('color') || 0);
const col = PLAYER_COLORS[colorIdx];

function section(title, w, h) {
  const t = document.createElement('h2'); t.textContent = title; document.body.appendChild(t);
  const c = document.createElement('canvas'); c.width = w; c.height = h; document.body.appendChild(c);
  const g = c.getContext('2d');
  g.fillStyle = '#5b8a2a'; g.fillRect(0, 0, w, h);
  return g;
}
function put(g, spr, x, y, mirror) {
  if (mirror) { g.save(); g.translate(x, y); g.scale(-1, 1); g.drawImage(spr.c, -spr.ax, -spr.ay, spr.w, spr.h); g.restore(); }
  else g.drawImage(spr.c, x - spr.ax, y - spr.ay, spr.w, spr.h);
}

if (part === 'units') {
  const types = Object.keys(UNITS);
  const cols = 8, cw = 190, rh = 96;
  const g = section('Đơn vị (trái→phải: đứng, đi, đánh, mặt trước, mặt sau)', cols * cw, Math.ceil(types.length / cols) * rh + 20);
  types.forEach((t, i) => {
    const x = (i % cols) * cw + 20, y = Math.floor(i / cols) * rh + 74;
    put(g, unitSprite(t, col, 0, 'idle', 0, 1, t === 'villager' ? 'woodcutter,wood' : ''), x, y);
    put(g, unitSprite(t, col, 0, 'walk', 2, 8, ''), x + 36, y);
    put(g, unitSprite(t, col, 0, 'attack', 2, 6, t === 'villager' ? 'woodcutter,' : ''), x + 72, y, true);
    put(g, unitSprite(t, col, 2, 'walk', 1, 8, ''), x + 108, y);
    put(g, unitSprite(t, col, 6, 'idle', 0, 1, ''), x + 144, y);
    g.fillStyle = '#fff'; g.font = '11px Georgia'; g.fillText(UNITS[t].vi, x - 12, y + 16);
  });
} else {
  const types = Object.keys(BUILDINGS).filter((t) => t !== 'farm' && t !== 'dock');
  const archs = ['egyptian', 'babylonian', 'greek', 'asian', 'roman'];
  for (const tier of [0, 1, 2]) {
    if (tier === 0 && part !== 'buildings0') continue;
    for (const arch of tier === 0 ? ['stone'] : archs) {
      const cw = 230, rh = 210;
      const g = section(`Kiến trúc ${arch} — ${['Đồ đá', 'Công cụ', 'Đồng/Sắt'][tier]}`, types.length * cw / 2 + 40, rh * 2 + 10);
      types.forEach((t, i) => {
        const def = BUILDINGS[t];
        const x = (i % Math.ceil(types.length / 2)) * cw + 110, y = Math.floor(i / Math.ceil(types.length / 2)) * rh + 150;
        const spr = buildingSprite(t, arch === 'stone' ? 'greek' : arch, tier, col, def.size);
        put(g, spr, x, y);
        g.fillStyle = '#fff'; g.font = '11px Georgia'; g.fillText(def.vi, x - 40, y + def.size * 16 + 14);
      });
    }
  }
  const g = section('Thiên nhiên & khác', 1400, 160);
  for (let v = 0; v < 6; v++) put(g, treeSprite(v, false), 40 + v * 60, 110);
  put(g, treeSprite(0, true), 420, 110);
  for (let s = 0; s < 4; s++) { put(g, resourceSprite('gold_mine', s), 480 + s * 56, 110); put(g, resourceSprite('stone_mine', s), 700 + s * 56, 110); put(g, resourceSprite('berry_bush', s), 920 + s * 56, 110); }
  put(g, farmSprite(3), 1200, 110);
  put(g, carcassSprite('gazelle', PLAYER_COLORS[6]), 1340, 110);
  const g2 = section('Đổ nát / móng', 600, 140);
  put(g2, rubbleSprite(3), 120, 90); put(g2, foundationSprite(3), 340, 90); put(g2, farmSprite(0), 520, 90);
}
