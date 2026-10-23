// Core simulation constants. Everything in the simulation is expressed in
// "game seconds" (the unit used by all Age of Empires stats); the game speed
// setting only changes how fast game time passes in real time.
export const TICK_MS = 100;              // game milliseconds per simulation tick
export const TICK_S = TICK_MS / 1000;    // game seconds per tick
export const TICKS_PER_SEC = 1000 / TICK_MS;
export const TICKS_PER_TURN = 2;         // lockstep turn = 2 ticks (200 game ms)
export const MAX_PLAYERS = 8;
export const GAIA = 0;

export const AGE_STONE = 0;
export const AGE_TOOL = 1;
export const AGE_BRONZE = 2;
export const AGE_IRON = 3;

export const RES_TYPES = ['food', 'wood', 'gold', 'stone'];

// AoE1 player colours (Blue, Red, Yellow, Brown, Orange, Green, Grey, Cyan)
export const PLAYER_COLORS = [
  { id: 0, name: 'Xanh dương', en: 'Blue', hex: '#2c52e0', dark: '#16288c', light: '#7c98ff' },
  { id: 1, name: 'Đỏ', en: 'Red', hex: '#d42020', dark: '#7c0c0c', light: '#ff7a6a' },
  { id: 2, name: 'Vàng', en: 'Yellow', hex: '#e8d020', dark: '#8c7808', light: '#fff27a' },
  { id: 3, name: 'Nâu', en: 'Brown', hex: '#8c5a2c', dark: '#4c2e12', light: '#c8946a' },
  { id: 4, name: 'Cam', en: 'Orange', hex: '#f08418', dark: '#8c4404', light: '#ffbe70' },
  { id: 5, name: 'Xanh lá', en: 'Green', hex: '#1ea02a', dark: '#0c5212', light: '#7ee07a' },
  { id: 6, name: 'Xám', en: 'Grey', hex: '#9a9a9a', dark: '#545454', light: '#dcdcdc' },
  { id: 7, name: 'Xanh ngọc', en: 'Cyan', hex: '#16c4c4', dark: '#066a6a', light: '#86f2f2' },
];
export const GAIA_COLOR = { id: -1, name: 'Gaia', hex: '#e8e8e8', dark: '#9a9a9a', light: '#ffffff' };

export const MAP_SIZES = {
  small: { tiles: 72, vi: 'Nhỏ (Small)' },
  medium: { tiles: 96, vi: 'Vừa (Medium)' },
  normal: { tiles: 120, vi: 'Thường (Normal)' },
  large: { tiles: 144, vi: 'Lớn (Large)' },
  huge: { tiles: 200, vi: 'Rất lớn (Huge)' },
  gigantic: { tiles: 250, vi: 'Khổng lồ (Gigantic)' },
};

export const START_RESOURCES = {
  default: { food: 200, wood: 200, gold: 0, stone: 150, vi: 'Mặc định (200/200/0/150)' },
  low: { food: 100, wood: 100, gold: 0, stone: 100, vi: 'Thấp' },
  medium: { food: 500, wood: 500, gold: 250, stone: 250, vi: 'Trung bình' },
  high: { food: 1000, wood: 1000, gold: 750, stone: 750, vi: 'Cao' },
  deathmatch: { food: 20000, wood: 20000, gold: 20000, stone: 5000, vi: 'Deathmatch (20000)' },
};

export const RULES = {
  d3kt: { vi: 'D3KT - Đời 3 Không Thành', desc: 'Cấm Thành & Chòi. Trước khi lên xong đời 3 chỉ được 1 lính. Không được dùng dân đánh dân/móng nhà (trừ nhà BE) của đối thủ trước đời 3.' },
  cungr: { vi: 'Luật Cung R (Xe cung)', desc: 'Cấm Thành & Chòi. Đời 2 chỉ 1 lính (không được Cung T). Đời 3 chỉ được Cung R. Đời 4 hoặc sau phút 25 chuyển quân tự do. Chưa có Wheel không được đánh dân & nhà BE.' },
  free: { vi: 'Tự do', desc: 'Không giới hạn: được xây thành, chòi, đánh mọi lúc.' },
  deathmatch: { vi: 'Deathmatch', desc: 'Tài nguyên khổng lồ, cho phép chòi nhưng cấm thành.' },
};

export const SPEEDS = [1.0, 1.5, 2.0, 2.5, 3.0];
