// Technologies. Costs, research times, requirements and effects are the
// original Rise of Rome ones (data/original.js); they are researched through
// the original technology tree (engine/techtree.js). This table names the
// technologies a player can click and describes them in Vietnamese.
//   advance: age reached (age technologies)
//   upgrade / bupgrade: unit / building line upgrade, unlocks / unlocksUnit:
//   what becomes available (derived from the effect commands, for the UI)
import { ORIGINAL_TECHS, ORIGINAL_EFFECTS } from './original.js';
import { TECH_DAT, UNIT_DAT, BUILDING_DAT } from './ids.js';

const T = (vi, desc, extra) => ({ vi, desc, ...extra });

export const TECHS = {
  // ---------------------------------------------------------------- ages (TC)
  tool_age: T('Lên đời 2 (Tool Age)', 'Cần 2 công trình đời đồ đá (Kho lương, Nhà kho, Nhà lính, Bến tàu).', { advance: 1, hotkey: 'T' }),
  bronze_age: T('Lên đời 3 (Bronze Age)', 'Cần 2 công trình đời công cụ (Chợ, Nhà cung, Chuồng ngựa).', { advance: 2, hotkey: 'B' }),
  iron_age: T('Lên đời 4 (Iron Age)', 'Cần 2 công trình đời đồ đồng (Đền, Nhà chính phủ, Xưởng cẩu, Học viện).', { advance: 3, hotkey: 'I' }),

  // ------------------------------------------------------------------ market
  woodworking: T('Nghề mộc', 'Đốn gỗ +0,2 tốc độ, +2 gỗ mỗi chuyến; cung thủ, chòi +1 tầm bắn & tầm nhìn.'),
  artisanship: T('Thợ thủ công', 'Đốn gỗ +0,2 tốc độ, +2 gỗ mỗi chuyến; cung thủ, chòi +1 tầm bắn & tầm nhìn.'),
  craftsmanship: T('Tay nghề', 'Đốn gỗ +0,2 tốc độ, +2 gỗ mỗi chuyến; cung thủ, chòi +1 tầm bắn & tầm nhìn.'),
  stone_mining: T('Khai thác đá', 'Đào đá +0,3 tốc độ, +3 đá mỗi chuyến; lính ném đá +1 công, tầm, tầm nhìn.'),
  siegecraft: T('Công thành', 'Đào đá +0,3 tốc độ, +3 đá; dân đánh chòi/thành mạnh; lính ném đá +1 công, tầm.'),
  gold_mining: T('Khai thác vàng', 'Đào vàng +0,3 tốc độ, +3 vàng mỗi chuyến.'),
  coinage: T('Đúc tiền', 'Vàng thu +25%, cống nạp không mất thuế.'),
  domestication: T('Thuần hóa', 'Ruộng +75 thịt.'),
  plow: T('Cày', 'Ruộng +75 thịt.'),
  irrigation: T('Thủy lợi', 'Ruộng +75 thịt.'),
  wheel: T('Bánh xe', 'Dân chạy nhanh hơn (+0,7). Mở khóa xe chiến, Cung R.'),

  // ------------------------------------------------------------- storage pit
  toolworking: T('Rèn công cụ', 'Bộ binh, kỵ binh, xe chiến, xiên +2 công.'),
  metalworking: T('Rèn kim loại', 'Bộ binh, kỵ binh, xe chiến, xiên +2 công.'),
  metallurgy: T('Luyện kim', 'Bộ binh, kỵ binh, xe chiến, xiên +3 công.'),
  leather_armor_infantry: T('Giáp da bộ binh', 'Bộ binh, xiên +2 giáp.'),
  leather_armor_archers: T('Giáp da cung thủ', 'Cung thủ +2 giáp.'),
  leather_armor_cavalry: T('Giáp da kỵ binh', 'Kỵ binh, xe chiến, voi +2 giáp.'),
  scale_armor_infantry: T('Giáp vảy bộ binh', 'Bộ binh, xiên +2 giáp.'),
  scale_armor_archers: T('Giáp vảy cung thủ', 'Cung thủ +2 giáp.'),
  scale_armor_cavalry: T('Giáp vảy kỵ binh', 'Kỵ binh, xe chiến, voi +2 giáp.'),
  chain_mail_infantry: T('Giáp xích bộ binh', 'Bộ binh, xiên +2 giáp.'),
  chain_mail_archers: T('Giáp xích cung thủ', 'Cung thủ +2 giáp.'),
  chain_mail_cavalry: T('Giáp xích kỵ binh', 'Kỵ binh, xe chiến, voi +2 giáp.'),
  bronze_shield: T('Khiên đồng', 'Bộ binh, xiên, lính ném đá +1 giáp tên.'),
  iron_shield: T('Khiên sắt', 'Bộ binh, xiên, lính ném đá +1 giáp tên.'),
  tower_shield: T('Khiên lớn', 'Bộ binh, xiên, lính ném đá +1 giáp tên.'),

  // ----------------------------------------------------------------- granary
  watch_tower_tech: T('Chòi canh', 'Cho phép xây chòi canh.'),
  sentry_tower_tech: T('Chòi gác', 'Nâng cấp chòi.'),
  guard_tower_tech: T('Chòi canh gác', 'Nâng cấp chòi.'),
  ballista_tower_tech: T('Chòi nỏ', 'Nâng cấp chòi thành chòi nỏ.'),
  small_wall_tech: T('Thành nhỏ', 'Cho phép xây thành.'),
  medium_wall_tech: T('Thành vừa', 'Nâng cấp thành.'),
  fortification_tech: T('Thành kiên cố', 'Nâng cấp thành.'),

  // ------------------------------------------------------- government center
  nobility: T('Quý tộc', 'Kỵ binh, xe chiến, Cung R, cung ngựa +15% máu.'),
  writing: T('Chữ viết', 'Chia sẻ tầm nhìn với đồng minh.'),
  architecture: T('Kiến trúc', 'Nhà & thành +20% máu, dân xây nhanh gấp 1,5.'),
  logistics: T('Hậu cần', 'Bộ binh và lính ném đá chỉ chiếm 1/2 dân số.'),
  aristocracy: T('Quý phái', 'Xiên chạy nhanh hơn (+0,25).'),
  ballistics: T('Đạn đạo', 'Tên, đá bắn đón đầu mục tiêu đang chạy.'),
  alchemy: T('Giả kim', 'Vũ khí tầm xa +1 công (tên lửa), cẩu đá +1.'),
  engineering: T('Công binh', 'Máy công thành +2 tầm bắn & tầm nhìn.'),

  // ------------------------------------------------------------------ temple
  astrology: T('Chiêm tinh', 'Cải đạo +30%.'),
  mysticism: T('Thần bí', 'Phù thủy x2 máu.'),
  polytheism: T('Đa thần', 'Phù thủy chạy nhanh +40%.'),
  afterlife: T('Kiếp sau', 'Phù thủy +3 tầm cải đạo & tầm nhìn.'),
  monotheism: T('Độc thần', 'Cải đạo được nhà và phù thủy địch.'),
  fanaticism: T('Cuồng tín', 'Phù thủy hồi phép nhanh hơn (+1,5/giây).'),
  jihad: T('Thánh chiến', 'Dân +7 công, +40 máu, chạy nhanh hơn nhưng mang ít tài nguyên.'),
  medicine: T('Y học', 'Phù thủy chữa thương nhanh gấp 3.'),
  martyrdom: T('Tử vì đạo', 'Hy sinh phù thủy để cải đạo tức thì (Delete khi đang cải đạo).'),

  // ---------------------------------------------------------------- barracks
  battle_axe: T('Rìu chiến', 'Lính chùy thành lính rìu.'),
  short_sword: T('Kiếm ngắn', 'Mở khóa lính kiếm ngắn.'),
  broad_sword: T('Kiếm rộng', 'Nâng cấp lính kiếm.'),
  long_sword: T('Kiếm dài', 'Nâng cấp lính kiếm.'),
  legion_tech: T('Lê dương', 'Nâng cấp lính kiếm thành Lê dương.'),

  // ----------------------------------------------------------- archery range
  improved_bow: T('Cung cải tiến', 'Mở khóa Cung A.'),
  composite_bow: T('Cung phức hợp', 'Nâng cấp Cung A.'),
  heavy_horse_archer_tech: T('Cung C nặng', 'Nâng cấp cung ngựa.'),

  // ------------------------------------------------------------------ stable
  heavy_cavalry_tech: T('Ngựa chém nặng', 'Nâng cấp kỵ binh.'),
  cataphract_tech: T('Ngựa thần', 'Nâng cấp kỵ binh thành Cataphract.'),
  scythe_chariot_tech: T('Xe lưỡi hái', 'Nâng cấp xe chiến.'),
  armored_elephant_tech: T('Voi thần', 'Nâng cấp voi chiến.'),

  // ---------------------------------------------------------- siege workshop
  catapult_tech: T('Cẩu đá', 'Nâng cấp máy bắn đá.'),
  heavy_catapult_tech: T('Cẩu đá to', 'Nâng cấp máy bắn đá hạng nặng.'),
  helepolis_tech: T('Pháo thần', 'Nâng cấp nỏ thành Helepolis.'),

  // ----------------------------------------------------------------- academy
  phalanx_tech: T('Xiên Phalanx', 'Nâng cấp xiên.'),
  centurion_tech: T('Xiên thần', 'Nâng cấp xiên thành Centurion.'),
};

const TYPE_OF = {};
for (const [t, id] of Object.entries(UNIT_DAT)) TYPE_OF[id] = { kind: 'unit', t };
for (const [t, id] of Object.entries(BUILDING_DAT)) TYPE_OF[id] = { kind: 'building', t };
const AGE_OF_TECH = { 101: 1, 102: 2, 103: 3 };

for (const [id, def] of Object.entries(TECHS)) {
  const o = ORIGINAL_TECHS[TECH_DAT[id]];
  def.dat = TECH_DAT[id];
  def.name = o.name;
  def.building = TYPE_OF[o.at] ? TYPE_OF[o.at].t : null;
  def.cost = { ...o.cost };
  def.time = o.time;
  def.button = o.button;
  def.icon = o.icon;
  def.age = Math.max(0, ...o.req.map((r) => AGE_OF_TECH[r] || 0));
  if (def.advance !== undefined) def.age = def.advance - 1;
  // what the effects unlock/upgrade (interface texts and icons)
  for (const [type, a, b] of ORIGINAL_EFFECTS[o.effect] || []) {
    const ta = TYPE_OF[a], tb = TYPE_OF[b];
    if (type === 3 && ta && tb) {
      if (ta.kind === 'unit' && !def.upgrade) def.upgrade = { from: ta.t, to: tb.t };
      if (ta.kind === 'building' && tb.kind === 'building' && !def.bupgrade && def.advance === undefined) def.bupgrade = { from: ta.t, to: tb.t };
    }
    if (type === 2 && b === 1 && ta) {
      if (ta.kind === 'unit') def.unlocksUnit = ta.t; else def.unlocks = ta.t;
    }
  }
}

export const TECH_OF_DAT = {};
for (const [id, def] of Object.entries(TECHS)) TECH_OF_DAT[def.dat] = id;

// Research order shown in each building (the original button positions).
export const BUILDING_TECHS = {};
for (const [id, def] of Object.entries(TECHS)) {
  if (!def.building) continue;
  (BUILDING_TECHS[def.building] ||= []).push(id);
}
for (const list of Object.values(BUILDING_TECHS)) list.sort((a, b) => (TECHS[a].button - TECHS[b].button) || (TECHS[a].dat - TECHS[b].dat));
