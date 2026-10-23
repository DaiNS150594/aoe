// Buildings. Numbers (hit points, armor, costs, build time, line of sight,
// tower attacks, population) come from the original data (data/original.js).
// size = footprint in tiles (square, from the original radius).
// drop = resources accepted (meat = hunted food). Which buildings can be built
// when is decided by the original technology tree (engine/techtree.js);
// `age` is only shown in the interface.
import { ORIGINAL_UNITS } from './original.js';
import { BUILDING_DAT } from './ids.js';
import { originalStats } from './units.js';

const B = (o) => ({ cls: ['building', 'structure'], age: 0, drop: null, hotkey: null, proj: null, ...o });

export const BUILDINGS = {
  town_center: B({ name: 'Town Center', vi: 'Nhà chính', drop: ['food', 'meat', 'wood', 'gold', 'stone'], hotkey: 'N', desc: 'Trung tâm: tạo dân, lên đời. Xây thêm cần có Nhà chính phủ.' }),
  house: B({ name: 'House', vi: 'Nhà (BE)', hotkey: 'E', desc: 'Tăng 4 dân số.' }),
  barracks: B({ name: 'Barracks', vi: 'Nhà lính (BB)', hotkey: 'B', desc: 'Huấn luyện bộ binh.' }),
  granary: B({ name: 'Granary', vi: 'Kho lương (BG)', drop: ['food'], hotkey: 'G', desc: 'Nơi chứa lương thực (hái lượm, ruộng). Nghiên cứu Chòi/Thành.' }),
  storage_pit: B({ name: 'Storage Pit', vi: 'Nhà kho (BS)', drop: ['meat', 'wood', 'gold', 'stone'], hotkey: 'S', desc: 'Chứa gỗ, vàng, đá, thịt săn. Nâng cấp giáp, vũ khí.' }),
  dock: B({ name: 'Dock', vi: 'Bến tàu', water: true, hotkey: 'D', desc: 'Chỉ xây được cạnh nước (Hill Country không có nước).' }),
  farm: B({ name: 'Farm', vi: 'Ruộng (BF)', cls: ['building', 'structure', 'farm'], age: 1, hotkey: 'F', desc: 'Ruộng cho thịt (+công nghệ chợ).' }),
  market: B({ name: 'Market', vi: 'Chợ (BM)', age: 1, hotkey: 'M', desc: 'Công nghệ kinh tế. Mở khóa ruộng.' }),
  archery_range: B({ name: 'Archery Range', vi: 'Nhà cung (BA)', age: 1, hotkey: 'A', desc: 'Huấn luyện cung thủ.' }),
  stable: B({ name: 'Stable', vi: 'Chuồng ngựa (BL)', age: 1, hotkey: 'L', desc: 'Huấn luyện kỵ binh, xe chiến, voi.' }),
  temple: B({ name: 'Temple', vi: 'Đền (BP)', age: 2, hotkey: 'P', desc: 'Tạo phù thủy và nâng cấp tôn giáo.' }),
  government_center: B({ name: 'Government Center', vi: 'Nhà chính phủ (BC)', age: 2, hotkey: 'C', desc: 'Công nghệ quân sự & chính trị. Cho phép xây thêm Nhà chính.' }),
  siege_workshop: B({ name: 'Siege Workshop', vi: 'Xưởng cẩu (BK)', age: 2, hotkey: 'K', desc: 'Chế tạo cẩu đá, nỏ.' }),
  academy: B({ name: 'Academy', vi: 'Học viện (BY)', age: 2, hotkey: 'Y', desc: 'Huấn luyện xiên (Hoplite).' }),
  wonder: B({ name: 'Wonder', vi: 'Kỳ quan', cls: ['building', 'structure', 'wonder'], age: 3, hotkey: 'O', desc: 'Công trình vĩ đại.' }),

  // ---------------------------------------------------------------- defences
  watch_tower: B({ name: 'Watch Tower', vi: 'Chòi canh', cls: ['building', 'tower'], age: 1, proj: 'arrow', hotkey: 'T', desc: 'Chòi bắn tên.' }),
  sentry_tower: B({ name: 'Sentry Tower', vi: 'Chòi gác', cls: ['building', 'tower'], age: 2, proj: 'arrow', hotkey: 'T' }),
  guard_tower: B({ name: 'Guard Tower', vi: 'Chòi canh gác', cls: ['building', 'tower'], age: 3, proj: 'arrow', hotkey: 'T' }),
  ballista_tower: B({ name: 'Ballista Tower', vi: 'Chòi nỏ', cls: ['building', 'tower'], age: 3, proj: 'bolt', hotkey: 'T' }),
  small_wall: B({ name: 'Small Wall', vi: 'Thành nhỏ', cls: ['building', 'wall'], age: 1, hotkey: 'W', wall: true }),
  medium_wall: B({ name: 'Medium Wall', vi: 'Thành vừa', cls: ['building', 'wall'], age: 2, hotkey: 'W', wall: true }),
  fortified_wall: B({ name: 'Fortification', vi: 'Thành kiên cố', cls: ['building', 'wall'], age: 3, hotkey: 'W', wall: true }),
};

for (const [type, def] of Object.entries(BUILDINGS)) {
  def.dat = BUILDING_DAT[type];
  const m = ORIGINAL_UNITS[def.dat];
  Object.assign(def, originalStats(m));
  def.datClass = m.cls;
  def.size = Math.max(1, Math.round(m.r[0] * 2));
  // population headroom given (houses, town centres)
  def.pop = m.store ? Math.max(0, ...m.store.filter((s) => s[0] === 4).map((s) => s[1])) : 0;
  def.atk = def.attacks.some((a) => a[1] > 0) ? true : null;
  def.research = m.research ?? -1;
}

// What villagers can place, in the order of the build menu (AoE1 layout).
export const BUILD_MENU = [
  'house', 'barracks', 'granary', 'storage_pit', 'dock', 'town_center',
  'farm', 'market', 'archery_range', 'stable', 'watch_tower', 'small_wall',
  'temple', 'government_center', 'siege_workshop', 'academy', 'wonder',
];
