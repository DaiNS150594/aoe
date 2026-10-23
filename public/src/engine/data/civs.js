// The 16 civilizations of The Rise of Rome (1.0) + Lạc Việt (bonus civ from the
// Definitive Edition's "Return of Rome", included for Vietnamese players).
// Bonuses and missing technologies are the original tech-tree effects of each
// civilization (data/original.js); `desc` explains them in Vietnamese.
// arch = architecture set used by the renderer.
import { ORIGINAL_CIVS, ORIGINAL_EFFECTS } from './original.js';
import { CIV_DAT, TECH_DAT } from './ids.js';

export const CIVS = {
  assyrian: { name: 'Assyrian', vi: 'Assyria (Assy)', arch: 'egyptian', desc: ['Cung thủ bắn nhanh hơn (nạp 1,1 giây)', 'Dân chạy nhanh hơn (+0,2)'] },
  babylonian: { name: 'Babylonian', vi: 'Babylon', arch: 'babylonian', desc: ['Chòi và thành x2 máu', 'Đào đá nhanh hơn (+0,2), +3 đá mỗi chuyến', 'Phù thủy hồi phép nhanh hơn (+0,75/giây)'] },
  carthaginian: { name: 'Carthaginian', vi: 'Carthage', arch: 'roman', desc: ['Voi, voi cung và xiên +25% máu', 'Thuyền chở quân nhanh hơn'] },
  choson: { name: 'Choson', vi: 'Triều Tiên (Choson)', arch: 'asian', desc: ['Kiếm dài & Lê dương +80 máu', 'Chòi +2 tầm', 'Phù thủy rẻ hơn 32%'] },
  egyptian: { name: 'Egyptian', vi: 'Ai Cập', arch: 'egyptian', desc: ['Đào vàng nhanh hơn (+0,2), +2 vàng mỗi chuyến', 'Xe chiến & Cung R +33% máu', 'Phù thủy +3 tầm'] },
  greek: { name: 'Greek', vi: 'Hy Lạp', arch: 'greek', desc: ['Xiên (Học viện) chạy nhanh hơn (+0,3)', 'Tàu chiến nhanh hơn'] },
  hittite: { name: 'Hittite', vi: 'Hittite', arch: 'babylonian', desc: ['Cung thủ +1 công', 'Cẩu đá & nỏ x2 máu', 'Tàu chiến +4 tầm'] },
  macedonian: { name: 'Macedonian', vi: 'Macedonia', arch: 'roman', convResist: 4, desc: ['Xiên +2 giáp tên', 'Bộ binh, kỵ binh, dân... +2 tầm nhìn', 'Máy công thành rẻ 50%', 'Khó bị cải đạo gấp 4 lần'] },
  minoan: { name: 'Minoan', vi: 'Minoan', arch: 'greek', desc: ['Ruộng +60 thịt', 'Cung A phức hợp +2 tầm', 'Tàu rẻ hơn 30%'] },
  palmyran: { name: 'Palmyran', vi: 'Palmyra', arch: 'roman', desc: ['Dân giá 75 thịt nhưng +1 giáp và làm việc nhanh hơn (+0,2)', 'Lạc đà nhanh hơn 25%', 'Cống nạp không mất thuế'] },
  persian: { name: 'Persian', vi: 'Ba Tư', arch: 'babylonian', desc: ['Săn nhanh hơn (+0,3), +3 thịt mỗi chuyến', 'Voi & voi cung chạy nhanh hơn (+0,5)', 'Tàu trireme bắn nhanh hơn'] },
  phoenician: { name: 'Phoenician', vi: 'Phoenicia', arch: 'greek', desc: ['Đốn gỗ nhanh hơn (+0,2), +3 gỗ mỗi chuyến', 'Voi & voi cung rẻ hơn 25%', 'Tàu bắn đá bắn nhanh hơn'] },
  roman: { name: 'Roman', vi: 'La Mã', arch: 'roman', desc: ['Nhà rẻ hơn 15%', 'Chòi canh & chòi gác rẻ hơn 50%', 'Lính kiếm đánh nhanh hơn (nạp 1 giây)'] },
  shang: { name: 'Shang', vi: 'Nhà Thương (Shang)', arch: 'asian', desc: ['Dân chỉ 35 thịt', 'Thành x2 máu'] },
  sumerian: { name: 'Sumerian', vi: 'Sumer', arch: 'egyptian', desc: ['Dân +15 máu', 'Máy công thành nạp 3,5 giây (cẩu đá nhanh hơn)', 'Ruộng +250 thịt (gấp đôi)'] },
  yamato: { name: 'Yamato', vi: 'Yamato (Ya)', arch: 'asian', desc: ['Ngựa dò, kỵ binh, cung ngựa rẻ hơn 25%', 'Dân chạy nhanh hơn (+0,2)', 'Tàu +30% máu'] },
  lac_viet: { name: 'Lac Viet', vi: 'Lạc Việt (DE)', arch: 'asian', bonusCiv: true, desc: ['(Phe thêm từ bản DE) Hái lượm nhanh hơn 20%', 'Lính ra nhanh hơn 25%', 'Cung thủ & nỏ +2 giáp'] },
};

// Lạc Việt is not in the 1998 data: its tech tree written as effect commands
const MILITARY_CLASSES = [0, 6, 12, 13, 23, 24, 26, 28, 35, 36, 39];
const NO_LAC_VIET = ['aristocracy', 'mysticism', 'polytheism', 'afterlife', 'fanaticism', 'monotheism', 'chain_mail_infantry',
  'tower_shield', 'siegecraft', 'engineering', 'phalanx_tech', 'legion_tech', 'cataphract_tech', 'helepolis_tech'];
const LAC_VIET_EFFECTS = [
  [4, 120, -1, 13, 0.09],
  ...MILITARY_CLASSES.map((c) => [5, -1, c, 102, 0.8]),
  ...[0, 23, 26, 36].map((c) => [4, -1, c, 8, 4 * 256 + 2]),
  [4, 11, -1, 8, 4 * 256 + 2], [4, 279, -1, 8, 4 * 256 + 2],
  ...NO_LAC_VIET.map((t) => [102, -1, -1, -1, TECH_DAT[t]]),
  [102, -1, -1, -1, 124], // Camel
];

for (const [id, civ] of Object.entries(CIVS)) {
  civ.dat = CIV_DAT[id];
  const orig = ORIGINAL_CIVS[civ.dat];
  civ.resources = orig.res;
  civ.effects = id === 'lac_viet' ? LAC_VIET_EFFECTS : ORIGINAL_EFFECTS[orig.techTree] || [];
}

export const CIV_IDS = Object.keys(CIVS);
export const STANDARD_CIVS = CIV_IDS.filter((id) => !CIVS[id].bonusCiv);

export const ARCH_NAMES = { egyptian: 'Ai Cập', greek: 'Hy Lạp', babylonian: 'Lưỡng Hà', asian: 'Á Đông', roman: 'La Mã' };
