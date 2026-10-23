// Units. All numbers (hit points, attack/armor classes, range, reload, speed,
// costs, training time...) are the original Rise of Rome values, read from
// data/original.js (generated from empires.dat). This table adds what the
// game needs on top: names, roles, hotkeys, projectile looks, animal AI.
// Speeds in tiles / game-second, times in game seconds, ranges in tiles.
//
// cls: roles used by the interface, the AI and the tournament rules
//   villager, infantry, swordsman, academy, slinger, archer, footArcher,
//   mounted, cavalry, horse, chariot, camel, elephant, siege, stoneThrower,
//   ballistaLine, priest, animal, huntable, predator, cheat
import { ORIGINAL_UNITS } from './original.js';
import { UNIT_DAT, BUILDING_DAT } from './ids.js';

const U = (o) => ({ cls: ['unit'], age: 0, hotkey: null, proj: null, convResist: 1, ...o });

export const UNITS = {
  // ------------------------------------------------------------------ economy
  villager: U({ name: 'Villager', vi: 'Dân', cls: ['unit', 'villager'], hotkey: 'C', desc: 'Khai thác tài nguyên, xây và sửa nhà.' }),

  // ----------------------------------------------------------------- barracks
  clubman: U({ name: 'Clubman', vi: 'Lính chùy', cls: ['unit', 'infantry'], hotkey: 'C', desc: 'Bộ binh rẻ tiền thời đồ đá.' }),
  axeman: U({ name: 'Axeman', vi: 'Lính rìu', cls: ['unit', 'infantry'], age: 1, hotkey: 'C', desc: 'Bộ binh cầm rìu (nâng cấp từ Lính chùy).' }),
  short_swordsman: U({ name: 'Short Swordsman', vi: 'Kiếm ngắn', cls: ['unit', 'infantry', 'swordsman'], age: 2, hotkey: 'S', desc: 'Bộ binh kiếm, cần công nghệ Short Sword.' }),
  broad_swordsman: U({ name: 'Broad Swordsman', vi: 'Kiếm rộng', cls: ['unit', 'infantry', 'swordsman'], age: 2, hotkey: 'S', desc: 'Bộ binh kiếm đời 3.' }),
  long_swordsman: U({ name: 'Long Swordsman', vi: 'Kiếm dài', cls: ['unit', 'infantry', 'swordsman'], age: 3, hotkey: 'S', desc: 'Bộ binh kiếm đời 4.' }),
  legion: U({ name: 'Legion', vi: 'Lê dương', cls: ['unit', 'infantry', 'swordsman'], age: 3, hotkey: 'S', desc: 'Bộ binh kiếm mạnh nhất.' }),
  slinger: U({ name: 'Slinger', vi: 'Ném đá', cls: ['unit', 'slinger'], age: 1, hotkey: 'L', proj: 'pebble', desc: 'Lính ném đá, khắc chế cung thủ và chòi.' }),

  // ------------------------------------------------------------ archery range
  bowman: U({ name: 'Bowman', vi: 'Cung T', cls: ['unit', 'archer', 'footArcher'], age: 1, hotkey: 'T', proj: 'arrow', desc: 'Cung thủ đời 2 (Cung T).' }),
  improved_bowman: U({ name: 'Improved Bowman', vi: 'Cung A', cls: ['unit', 'archer', 'footArcher'], age: 2, hotkey: 'A', proj: 'arrow', desc: 'Cung cải tiến (Cung A), cần Improved Bow.' }),
  composite_bowman: U({ name: 'Composite Bowman', vi: 'Cung A (phức hợp)', cls: ['unit', 'archer', 'footArcher'], age: 2, hotkey: 'A', proj: 'arrow', desc: 'Cung phức hợp tầm xa.' }),
  chariot_archer: U({ name: 'Chariot Archer', vi: 'Cung R (xe cung)', cls: ['unit', 'archer', 'mounted', 'chariot'], age: 2, hotkey: 'R', proj: 'arrow', convResist: 2, desc: 'Xe cung nhanh, không tốn vàng. Cần Wheel.' }),
  horse_archer: U({ name: 'Horse Archer', vi: 'Cung C (cung ngựa)', cls: ['unit', 'archer', 'mounted', 'horse'], age: 3, hotkey: 'C', proj: 'arrow', desc: 'Kỵ xạ đời 4.' }),
  heavy_horse_archer: U({ name: 'Heavy Horse Archer', vi: 'Cung C nặng', cls: ['unit', 'archer', 'mounted', 'horse'], age: 3, hotkey: 'C', proj: 'arrow', desc: 'Kỵ xạ hạng nặng.' }),
  elephant_archer: U({ name: 'Elephant Archer', vi: 'Cung Y (voi cung)', cls: ['unit', 'archer', 'mounted', 'elephant'], age: 3, hotkey: 'Y', proj: 'arrow', desc: 'Voi chở cung thủ, máu rất trâu.' }),

  // ------------------------------------------------------------------- stable
  scout: U({ name: 'Scout', vi: 'Ngựa dò', cls: ['unit', 'mounted', 'cavalry', 'horse'], age: 1, hotkey: 'S', desc: 'Ngựa trinh sát, tầm nhìn tăng mỗi đời.' }),
  cavalry: U({ name: 'Cavalry', vi: 'Ngựa chém', cls: ['unit', 'mounted', 'cavalry', 'horse'], age: 2, hotkey: 'C', desc: 'Kỵ binh đời 3, khắc chế bộ binh.' }),
  heavy_cavalry: U({ name: 'Heavy Cavalry', vi: 'Ngựa chém nặng', cls: ['unit', 'mounted', 'cavalry', 'horse'], age: 3, hotkey: 'C', desc: 'Kỵ binh hạng nặng.' }),
  cataphract: U({ name: 'Cataphract', vi: 'Ngựa thần', cls: ['unit', 'mounted', 'cavalry', 'horse'], age: 3, hotkey: 'C', desc: 'Kỵ binh mạnh nhất.' }),
  chariot: U({ name: 'Chariot', vi: 'Xe chiến', cls: ['unit', 'mounted', 'cavalry', 'chariot'], age: 2, hotkey: 'R', convResist: 2, desc: 'Xe chiến, khó bị phù thủy cải đạo. Cần Wheel.' }),
  scythe_chariot: U({ name: 'Scythe Chariot', vi: 'Xe lưỡi hái', cls: ['unit', 'mounted', 'cavalry', 'chariot'], age: 3, hotkey: 'R', convResist: 2, desc: 'Xe lưỡi hái gây sát thương lan.' }),
  camel: U({ name: 'Camel Rider', vi: 'Lạc đà', cls: ['unit', 'mounted', 'cavalry', 'camel'], age: 2, hotkey: 'M', desc: 'Lạc đà, khắc chế kỵ binh và xe chiến.' }),
  war_elephant: U({ name: 'War Elephant', vi: 'Voi', cls: ['unit', 'mounted', 'cavalry', 'elephant'], age: 3, hotkey: 'E', desc: 'Voi chiến, giẫm đạp gây sát thương lan.' }),
  armored_elephant: U({ name: 'Armored Elephant', vi: 'Voi thần', cls: ['unit', 'mounted', 'cavalry', 'elephant'], age: 3, hotkey: 'E', desc: 'Voi bọc giáp, phá nhà và chòi.' }),

  // ------------------------------------------------------------------ academy
  hoplite: U({ name: 'Hoplite', vi: 'Xiên', cls: ['unit', 'infantry', 'academy'], age: 2, hotkey: 'H', desc: 'Bộ binh giáp nặng.' }),
  phalanx: U({ name: 'Phalanx', vi: 'Xiên (Phalanx)', cls: ['unit', 'infantry', 'academy'], age: 3, hotkey: 'H', desc: 'Xiên đời 4.' }),
  centurion: U({ name: 'Centurion', vi: 'Xiên thần', cls: ['unit', 'infantry', 'academy'], age: 3, hotkey: 'H', desc: 'Bộ binh mạnh nhất.' }),

  // ------------------------------------------------------------ siege workshop
  stone_thrower: U({ name: 'Stone Thrower', vi: 'Cẩu đá', cls: ['unit', 'siege', 'stoneThrower'], age: 2, hotkey: 'T', proj: 'stone', desc: 'Máy bắn đá, phá nhà. Sát thương lan cả quân mình.' }),
  catapult: U({ name: 'Catapult', vi: 'Cẩu đá', cls: ['unit', 'siege', 'stoneThrower'], age: 3, hotkey: 'T', proj: 'stone', desc: 'Máy bắn đá đời 4.' }),
  heavy_catapult: U({ name: 'Heavy Catapult', vi: 'Cẩu đá to', cls: ['unit', 'siege', 'stoneThrower'], age: 3, hotkey: 'T', proj: 'stone', desc: 'Máy bắn đá hạng nặng, phá được cả cây.' }),
  ballista: U({ name: 'Ballista', vi: 'Nỏ (Ballista)', cls: ['unit', 'siege', 'ballistaLine'], age: 3, hotkey: 'B', proj: 'bolt', desc: 'Nỏ lớn bắn tên nặng.' }),
  helepolis: U({ name: 'Helepolis', vi: 'Pháo thần', cls: ['unit', 'siege', 'ballistaLine'], age: 3, hotkey: 'B', proj: 'bolt', desc: 'Tháp nỏ bắn nhanh.' }),

  // ------------------------------------------------------------------- temple
  priest: U({ name: 'Priest', vi: 'Phù thủy', cls: ['unit', 'priest'], age: 2, hotkey: 'P', desc: 'Cải đạo quân địch (Wololo!) và chữa thương.' }),

  // ------------------------------------------------------------------ animals
  // (what they do is the unit AI of the executable: engine/animals.js)
  gazelle: U({ name: 'Gazelle', vi: 'Hươu', cls: ['unit', 'animal', 'huntable'] }),
  elephant_wild: U({ name: 'Elephant', vi: 'Voi rừng', cls: ['unit', 'animal', 'huntable'] }),
  lion: U({ name: 'Lion', vi: 'Sư tử', cls: ['unit', 'animal', 'predator'] }),
  alligator: U({ name: 'Alligator', vi: 'Cá sấu', cls: ['unit', 'animal', 'predator'] }),

  // -------------------------------------------------------------- cheat units
  big_daddy: U({ name: 'Big Daddy', vi: 'Xe hơi BIGDADDY', cls: ['unit', 'cheat', 'mounted'], proj: 'rocket', desc: 'Xe hơi bắn tên lửa (cheat).' }),
  photon_man: U({ name: 'Photon Man', vi: 'Người Laser', cls: ['unit', 'cheat'], proj: 'laser', desc: 'Lính laser từ tương lai (cheat).' }),
  nuke_trooper: U({ name: 'E=MC2 Trooper', vi: 'Lính hạt nhân', cls: ['unit', 'cheat'], nuke: 5, desc: 'Phát nổ hạt nhân khi tấn công (cheat).' }),
};

// The unit AI module the executable gives a unit (004B13D0, by class): class 9
// (prey) the hunted-animal one; class 10 (predators) the elephant one for the
// Elephant (48), the lion one for the Lion (126), the hunted-animal one for the
// Horse (157) and the plain predator one for the rest (alligators, "kings").
export function animalModule(cls, id) {
  if (cls === 9) return 'prey';
  if (cls !== 10) return null;
  if (id === 157) return 'prey';
  if (id === 48) return 'elephant';
  if (id === 126) return 'lion';
  return 'predator';
}

// The original numbers of a unit (or building) of the data: shared by the unit
// and building tables, and by Player.unitStats for the per-player copies.
export function originalStats(m) {
  const pop = m.store ? -(m.store.find((s) => s[0] === 4) || [0, 0])[1] : 0;
  const anim = m.atkAnim || [1, 0];
  return {
    hp: m.hp, los: m.los, speed: m.speed || 0, runMul: m.runMul || 1, radius: m.r[0],
    attacks: m.atk || [], armors: m.arm || [], defArmor: m.defArmor || 0,
    range: m.range || 0, minRange: m.minRange || 0, rof: m.reload || 0, accuracy: m.accuracy ?? 100,
    blast: m.blast || 0, blastLevel: m.blastLevel || 0, blastDef: m.blastDef || 0,
    projDat: m.proj ?? -1, windup: (m.frameDelay || 0) * anim[1],
    cost: { ...(m.cost || {}) }, time: m.time || 0, pop: pop > 0 ? pop : 0,
    work: m.work || 0, cap: m.cap || 0, food: m.store && m.store[0] && m.store[0][0] === 0 ? m.store[0][1] : 0,
    decay: m.decay || 0, shown: m.shown || null,
  };
}

const TYPE_BY_DAT = {};
for (const [t, id] of Object.entries(BUILDING_DAT)) TYPE_BY_DAT[id] = t;
for (const [type, def] of Object.entries(UNITS)) {
  def.dat = UNIT_DAT[type];
  const m = ORIGINAL_UNITS[def.dat];
  Object.assign(def, originalStats(m));
  def.datClass = m.cls;
  def.animal = animalModule(m.cls, def.dat);
  def.building = TYPE_BY_DAT[m.trainAt] || null;
  def.atk = def.attacks.some((a) => a[1] > 0) ? true : null;
}

// Unit lines: what a building shows for each slot (the newest unlocked unit).
export const UNIT_LINES = {
  town_center: [['villager']],
  barracks: [['clubman', 'axeman'], ['short_swordsman', 'broad_swordsman', 'long_swordsman', 'legion'], ['slinger']],
  archery_range: [['bowman'], ['improved_bowman', 'composite_bowman'], ['chariot_archer'], ['horse_archer', 'heavy_horse_archer'], ['elephant_archer']],
  stable: [['scout'], ['cavalry', 'heavy_cavalry', 'cataphract'], ['chariot', 'scythe_chariot'], ['camel'], ['war_elephant', 'armored_elephant']],
  academy: [['hoplite', 'phalanx', 'centurion']],
  siege_workshop: [['stone_thrower', 'catapult', 'heavy_catapult'], ['ballista', 'helepolis']],
  temple: [['priest']],
};
for (const lines of Object.values(UNIT_LINES)) {
  for (const line of lines) line.forEach((t, i) => { if (i) UNITS[t].upgradeOf = line[i - 1]; if (i < line.length - 1) UNITS[t].upgradesTo = line[i + 1]; });
}

export function isMilitary(def) {
  return def && def.cls.includes('unit') && !def.cls.includes('villager') && !def.cls.includes('animal');
}
