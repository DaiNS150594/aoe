// How the Rise of Rome computer player picks its strategy (build list,
// data2*.ai) on a random land map — empires.exe 004F5AD0:
//  1. a weight per build list from the civilisation's own function
//     (004F7800 Egyptians ... 004F8A10 Macedonians), the same on every land
//     map; on Hardest the civilisations that have one use their "Immortal"
//     list, death match games their death match list;
//  2. every list of a unit category (priests, cavalry, horse archers,
//     elephants, infantry, archers, siege) divided by 3 — a few twice;
//  3. a draw: rand() % (sum of weights), walking the lists in their order.
// The weights below are the result of 1-2. The learning file
// (savegamelearndefault.uh, which favours lists against the human's
// favourite units) and the water-map trireme lists are left out.
// Then the first attack (SNInitialAttackDelay, 004F6AA9) is set by the
// list: a stone/tool age rush attacks after 5-6 / 11-14 minutes, a bronze
// age strategy after 20-25, the others after 28-39; on Hardest one time in
// three five minutes earlier. Attack groups are 2 to 10 units (SN 16, 26).

export const STRATEGIES = {
  egyptian: {
    normal: [["Phalanx Bronze",3],["Infantry Stone",3],["Infantry Tool",3],["Elephant Archer Iron",4],["Priest Bronze",16],["Priest Iron",16],["Egypt War Elephants",40],["Egypt Chariots",33],["Egypt Chariot Archer",33],["Egypt Archers Bronze",10],["Egypt Archers Iron",6]],
    hardest: [["Immortal Egypt",100]],
    dm: [["Death Match Egypt",100]],
  },
  greek: {
    normal: [["Phalanx Bronze",23],["Phalanx Iron",16],["Cavalry Bronze",10],["Cavalry Iron",6],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",10],["Greek Phalanx",33],["Greek Siege",33],["Greek Priests",13]],
    hardest: [["Immortal Greek",100]],
    dm: [["Death Match Greek",100]],
  },
  babylonian: {
    normal: [["Archers Bronze",6],["Archers Iron",3],["Phalanx Bronze",6],["Cavalry Bronze",3],["Infantry Stone",3],["Infantry Tool",6],["Infantry Bronze",3],["Cav Archer Iron",10],["Priest Bronze",13],["Priest Iron",13],["Babylon Swordsmen",33],["Babylon Scouts",100]],
    dm: [["Death Match Babylon",100]],
  },
  assyrian: {
    normal: [["Phalanx Bronze",3],["Cavalry Bronze",6],["Cavalry Iron",3],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",13],["Cav Archer Iron",13],["Priest Bronze",10],["Assyria Ballista",33],["Assyria Bowmen",11],["Assyria Archer Bronze",26],["Assyria Archer Iron",26],["Assyria Infantry Bronze",26]],
    hardest: [["Immortal Assyria",100]],
    dm: [["Death Match Assyria",100]],
  },
  minoan: {
    normal: [["Archers Bronze",33],["Phalanx Bronze",6],["Phalanx Iron",3],["Cavalry Bronze",3],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",3],["Minoa Composite Bowmen",11]],
    hardest: [["Immortal Minoa",100]],
    dm: [["Death Match Minoa",100]],
  },
  hittite: {
    normal: [["Phalanx Bronze",10],["Phalanx Iron",13],["Cavalry Bronze",6],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",3],["Cav Archer Iron",26],["Elephant Archer Iron",4],["Hittite Horse Archers",33],["Hittite Bowmen",11],["Hittite Elephant",20]],
    dm: [["Death Match Hittite",100]],
  },
  phoenician: {
    normal: [["Archers Bronze",13],["Phalanx Bronze",3],["Phalanx Iron",3],["Cavalry Bronze",6],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",3],["Elephant Archer Iron",7],["Priest Bronze",6],["Priest Iron",10],["Phoenicia Elephants",46]],
    dm: [["Death Match Phoenicia",100]],
  },
  sumerian: {
    normal: [["Phalanx Bronze",3],["Phalanx Iron",6],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",3],["Cav Archer Iron",10],["Sumeria Catapults",33],["Sumeria Scouts",33],["Sumeria Chariots",33]],
    hardest: [["Immortal Sumeria",100]],
    dm: [["Death Match Sumeria",100]],
  },
  persian: {
    normal: [["Archers Bronze",6],["Archers Iron",13],["Cavalry Bronze",3],["Cavalry Iron",16],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",13],["Cav Archer Iron",6],["Elephant Archer Iron",6],["Persia Elephant Archers",100],["Persia War Elephant",20],["Persia Priests",16]],
    dm: [["Death Match Persia",100]],
  },
  shang: {
    normal: [["Archers Bronze",3],["Archers Iron",6],["Phalanx Bronze",3],["Cavalry Bronze",16],["Cavalry Iron",16],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",10],["Cav Archer Iron",6],["Priest Bronze",6],["Priest Iron",10],["Shang Heavy Cavalry",33],["Shang Cavalry",33],["Shang Clubmen",16]],
    dm: [["Death Match Shang",100]],
  },
  yamato: {
    normal: [["Archers Bronze",6],["Archers Iron",6],["Phalanx Bronze",3],["Phalanx Iron",3],["Cavalry Bronze",16],["Cavalry Iron",16],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",6],["Cav Archer Iron",13],["Yamato Heavy Cavalry",33]],
    hardest: [["Immortal Yamato",100]],
    dm: [["Death Match Yamato",100]],
  },
  choson: {
    normal: [["Archers Bronze",6],["Archers Iron",3],["Phalanx Bronze",3],["Cavalry Bronze",6],["Cavalry Iron",10],["Infantry Stone",10],["Infantry Tool",10],["Infantry Bronze",23],["Cav Archer Iron",3],["Choson Swordsmen",33],["Choson Axemen",33],["Choson Priests",23]],
    dm: [["Death Match Choson",100]],
  },
  roman: {
    normal: [["Archers Bronze",3],["Phalanx Bronze",6],["Phalanx Iron",6],["Cavalry Bronze",3],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",26],["Rome Legion",33],["Rome Axemen",20],["Rome Siege",26]],
    dm: [["Death Match Rome",100]],
  },
  carthaginian: {
    normal: [["Archers Bronze",3],["Archers Iron",3],["Phalanx Bronze",23],["Phalanx Iron",16],["Cavalry Bronze",10],["Cavalry Iron",3],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",3],["Cav Archer Iron",3],["Elephant Archer Iron",6],["Carthage Phalanx",26],["Carthage War Elephant",33]],
    dm: [["Death Match Carthage",100]],
  },
  palmyran: {
    normal: [["Archers Bronze",10],["Archers Iron",10],["Phalanx Bronze",13],["Phalanx Iron",6],["Cavalry Bronze",13],["Cavalry Iron",3],["Infantry Stone",3],["Infantry Tool",3],["Infantry Bronze",3],["Cav Archer Iron",20],["Palmyra Composite Bow",26],["Palmyra Horse Archer",26],["Palmyra Elephant",33]],
    dm: [["Death Match Palmyra",100]],
  },
  macedonian: {
    normal: [["Archers Bronze",3],["Archers Iron",3],["Phalanx Bronze",13],["Phalanx Iron",13],["Cavalry Bronze",10],["Cavalry Iron",10],["Cav Archer Iron",6],["Macedon Elephant",33],["Macedon Phalanx",26],["Macedon Cavalry",26]],
    dm: [["Death Match Macedon",100]],
  },
};
STRATEGIES.lac_viet = STRATEGIES.shang; // Lạc Việt: the Shang lists

const RUSH = {
  stone: ['Infantry Stone', 'Shang Clubmen'],
  tool: ['Infantry Tool', 'Assyria Bowmen', 'Babylon Scouts', 'Choson Swordsmen', 'Choson Axemen', 'Hittite Bowmen', 'Sumeria Scouts', 'Rome Axemen'],
  bronze: ['Archers Bronze', 'Phalanx Bronze', 'Infantry Bronze', 'Infantry Walls', 'Priest Bronze', 'Egypt Chariots', 'Greek Phalanx',
    'Minoa Composite Bowmen', 'Shang Cavalry', 'Sumeria Catapults', 'Assyria Archer Bronze', 'Assyria Infantry Bronze', 'Egypt Archers Bronze'],
};
export const STRATEGY_STAGE = {};
for (const [k, l] of Object.entries(RUSH)) for (const n of l) STRATEGY_STAGE[n] = k;

// rand: a C library rand() (0..32767). level: 'easiest'..'hardest'.
export function pickStrategy(civ, level, deathmatch, rand) {
  const s = STRATEGIES[civ] || STRATEGIES.greek;
  const list = deathmatch ? s.dm : level === 'hardest' && s.hardest ? s.hardest : s.normal;
  let sum = 0;
  for (const [, w] of list) sum += w;
  const r = rand() % sum;
  let acc = 0;
  for (const [name, w] of list) { acc += w; if (acc > r) return name; }
  return list[list.length - 1][0];
}

// seconds before the first attack
export function firstAttackDelay(name, level, rand) {
  let t = (rand() % 12 + 28) * 60;
  const stage = STRATEGY_STAGE[name];
  if (stage === 'bronze') t = (rand() % 6 + 20) * 60;
  else if (stage === 'tool') t = (rand() % 4 + 11) * 60;
  else if (stage === 'stone') t = (rand() % 2 + 5) * 60;
  if (level === 'hardest' && rand() % 3 === 0) t -= 300;
  return t;
}
export const ATTACK_GROUP = { min: 2, max: 10 };
