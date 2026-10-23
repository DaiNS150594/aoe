// This game's unit / building / technology / civilisation ids and the matching
// ids inside the original Rise of Rome data (empires.dat). Shared by the
// simulation, the renderer and tools/gen-data.mjs.

export const UNIT_DAT = {
  villager: 83, clubman: 73, axeman: 74, short_swordsman: 75, broad_swordsman: 76, long_swordsman: 77, legion: 282,
  slinger: 347, bowman: 4, improved_bowman: 5, composite_bowman: 6, chariot_archer: 41, horse_archer: 39,
  heavy_horse_archer: 281, elephant_archer: 25, scout: 299, cavalry: 37, heavy_cavalry: 38, cataphract: 283,
  chariot: 40, scythe_chariot: 339, camel: 338, war_elephant: 46, armored_elephant: 345, hoplite: 93, phalanx: 94,
  centurion: 291, stone_thrower: 35, catapult: 36, heavy_catapult: 280, ballista: 11, helepolis: 279, priest: 125,
  gazelle: 65, elephant_wild: 48, lion: 126, alligator: 1, big_daddy: 372, photon_man: 274, nuke_trooper: 248,
};

// Stone Age buildings; the age technologies upgrade some of them (graphics only)
export const BUILDING_DAT = {
  town_center: 109, house: 70, barracks: 12, granary: 68, storage_pit: 103, dock: 45, farm: 50, market: 84,
  archery_range: 87, stable: 101, temple: 104, government_center: 82, siege_workshop: 49, academy: 0, wonder: 276,
  watch_tower: 79, sentry_tower: 199, guard_tower: 69, ballista_tower: 278, small_wall: 72, medium_wall: 117,
  fortified_wall: 155,
};

// villager jobs: the unit a villager turns into while doing them
export const TASK_DAT = {
  builder: 118, repairer: 156, fisher: 119, forager: 120, hunter: 122, woodcutter: 123, stoneminer: 124,
  goldminer: 251, farmer: 259,
};

// resource objects on the map
export const RESOURCE_DAT = { berry: 59, gold: 66, stone: 102 };

export const TECH_DAT = {
  tool_age: 101, bronze_age: 102, iron_age: 103, woodworking: 107, artisanship: 32, craftsmanship: 110,
  stone_mining: 109, siegecraft: 111, gold_mining: 108, coinage: 30, domestication: 81, plow: 31, irrigation: 80,
  wheel: 28, toolworking: 46, metalworking: 51, metallurgy: 52, leather_armor_infantry: 40, leather_armor_archers: 41,
  leather_armor_cavalry: 42, scale_armor_infantry: 43, scale_armor_archers: 44, scale_armor_cavalry: 45,
  chain_mail_infantry: 48, chain_mail_archers: 49, chain_mail_cavalry: 50, bronze_shield: 47, iron_shield: 117,
  tower_shield: 122, watch_tower_tech: 16, sentry_tower_tech: 12, guard_tower_tech: 15, ballista_tower_tech: 2,
  small_wall_tech: 11, medium_wall_tech: 13, fortification_tech: 14, nobility: 34, writing: 114, architecture: 112,
  logistics: 121, aristocracy: 113, ballistics: 106, alchemy: 37, engineering: 35, astrology: 22, mysticism: 21,
  polytheism: 24, afterlife: 18, monotheism: 19, fanaticism: 20, jihad: 23, medicine: 119, martyrdom: 120,
  battle_axe: 63, short_sword: 64, broad_sword: 65, long_sword: 66, legion_tech: 77, improved_bow: 56,
  composite_bow: 57, heavy_horse_archer_tech: 38, heavy_cavalry_tech: 71, cataphract_tech: 78,
  scythe_chariot_tech: 126, armored_elephant_tech: 125, catapult_tech: 54, heavy_catapult_tech: 36,
  helepolis_tech: 27, phalanx_tech: 73, centurion_tech: 79,
};

// civilisation index in empires.dat (Lạc Việt borrows the Shang entry)
export const CIV_DAT = {
  egyptian: 1, greek: 2, babylonian: 3, assyrian: 4, minoan: 5, hittite: 6, phoenician: 7, sumerian: 8,
  persian: 9, shang: 10, yamato: 11, choson: 12, roman: 13, carthaginian: 14, palmyran: 15, macedonian: 16,
  lac_viet: 10,
};
