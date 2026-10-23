// Maps this game's unit/building/resource/tech ids onto Rise of Rome data
// (unit ids inside empires.dat), and resolves per civilisation + age which
// building graphic and facet (frame variant) the original game shows.

// game unit / building type -> RoR unit id (age upgrades are read from the dat)
export { UNIT_DAT as UNIT_IDS, BUILDING_DAT as BUILDING_IDS, TECH_DAT as TECH_IDS } from '../engine/data/ids.js';
import { UNIT_DAT as UNIT_IDS, BUILDING_DAT as BUILDING_IDS, TECH_DAT as TECH_IDS } from '../engine/data/ids.js';

// villager task -> [task unit id, work graphic, carry-walk graphic, idle-holding graphic]
export const VILLAGER_TASKS = {
  builder: [118, 466], repairer: [156, 466],
  farmer: [259, 468, 829, -1], forager: [120, 470, 681, 275], hunter: [122, 472, 92, 276],
  woodcutter: [123, 473, 93, 277], goldminer: [251, 474, 91, 278], stoneminer: [124, 474, 94, 278],
  fisher: [119, 469, 89, -1],
};
export const GFX = {
  chop: 467, hunt: 471, priestChant: 36,
  arrow: 0, bolt: 2, stone: 96, slingStone: 901, spear: 513,
  rubble: { 1: 493, 2: 494, 3: 495, 4: 495, 5: 495 }, explode: { 1: 270, 2: 491, 3: 492 },
  cataExplosion: 272, treeFallA: 634, treeFallB: 636, stump: 600,
  gold: 477, stone: 478, berry: 333, flame: [324, 326, 328, 330],
  forestTrees: [627, 628, 631, 609, 610, 614, 627, 628, 631, 930],
  stragglerTrees: [601, 603, 607, 608, 611, 613],
};
// hunted animal -> dead unit (corpse / carcass) graphic
export const CARCASS_GFX = { gazelle: 395, elephant_wild: 147, lion: 460, alligator: 391 };

// game civ id -> civ name in empires.dat
const CIV_NAMES = {
  egyptian: 'Egyptian', greek: 'Greek', babylonian: 'Babylonian', assyrian: 'Assyrian', minoan: 'Minoan',
  hittite: 'Hittite', phoenician: 'Phoenician', sumerian: 'Sumerian', persian: 'Persian', shang: 'Shang',
  yamato: 'Yamato', choson: 'Choson', roman: 'Roman', carthaginian: 'Carthage', palmyran: 'Palmyra',
  macedonian: 'Macedonian', lac_viet: 'Shang',
};
// building icon sheets per architecture (civ.iconSet): Egyptian, Greek, Babylonian, Asian, Roman
const BUILDING_ICON_SLPS = [50704, 50705, 50706, 50707, 53005];
export const UNIT_ICON_SLP = 50730;
export const TECH_ICON_SLP = 50729;


export class AoeMapping {
  constructor(dat) {
    this.dat = dat;
    this.civIndex = {};
    for (const [id, name] of Object.entries(CIV_NAMES)) {
      const i = dat.civs.findIndex((c) => c.name === name);
      this.civIndex[id] = i > 0 ? i : 1;
    }
    // replay the age technologies: unit upgrades (effect 3) and building
    // facet changes (effect 0, attribute 17) per age
    const ageTech = ['Stone Age', 'Tool Age', 'Bronze Age', 'Iron Age'].map((n) => dat.techs.findIndex((t) => t.name === n));
    this.ages = [];
    const current = new Map(); // base id -> current id
    const facet = new Map();   // base id -> facet
    const baseOf = (id) => { for (const [b, c] of current) if (c === id || b === id) return b; return id; };
    for (let age = 0; age < 4; age++) {
      const t = dat.techs[ageTech[age]];
      const eb = t && t.effect >= 0 ? dat.effects[t.effect] : null;
      if (eb) {
        for (const e of eb.effects) {
          if (e.type === 3) current.set(baseOf(e.a), e.b);
          else if (e.type === 0 && e.c === 17 && e.a >= 0) facet.set(baseOf(e.a), e.d | 0);
        }
      }
      this.ages.push({ current: new Map(current), facet: new Map(facet) });
    }
  }

  civ(civId) { return this.dat.civs[this.civIndex[civId] || 1]; }
  gaia() { return this.dat.civs[0]; }

  unitDef(civId, type) {
    const id = UNIT_IDS[type];
    if (id === undefined) return null;
    const animal = type === 'gazelle' || type === 'elephant_wild' || type === 'lion' || type === 'alligator';
    const civ = animal || !civId ? this.gaia() : this.civ(civId);
    return civ.units[id] || this.gaia().units[id] || null;
  }
  taskDef(civId, task) {
    const t = VILLAGER_TASKS[task];
    if (!t) return null;
    return this.civ(civId).units[t[0]] || null;
  }

  // -> { unit, facet } for a building of a civ at an age
  building(civId, type, age) {
    const base = BUILDING_IDS[type];
    if (base === undefined) return null;
    const a = this.ages[Math.max(0, Math.min(3, age | 0))];
    const id = a.current.get(base) ?? base;
    const unit = this.civ(civId).units[id] || this.civ(civId).units[base];
    if (!unit) return null;
    return { unit, facet: a.facet.get(base) || 0 };
  }

  buildingIconSlp(civId) { return BUILDING_ICON_SLPS[this.civ(civId).iconSet] || BUILDING_ICON_SLPS[1]; }
  techIcon(techId) {
    const i = TECH_IDS[techId];
    const t = i !== undefined ? this.dat.techs[i] : null;
    return t ? t.icon : -1;
  }
}
