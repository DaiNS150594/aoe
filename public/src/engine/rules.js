// Vietnamese competitive rule sets, enforced by the engine:
//  - D3KT (Đời 3 Không Thành / "Bronze Age No Wall"): no walls & towers, at most
//    one military unit before finishing the Bronze Age, villagers may not
//    attack enemy villagers or non-house buildings before the Bronze Age.
//  - Cung R (Chariot Archer rules, for Shang/Assyrian tournaments): like D3KT,
//    no Bowmen (Cung T) in Tool Age, only Chariot Archers in Bronze Age until
//    minute 25 / Iron Age, no attacking villagers & houses before Wheel.
//  - Tự do: no restrictions.  - Deathmatch: towers ok, walls banned.
import { UNITS, isMilitary } from './data/units.js';
import { BUILDINGS } from './data/buildings.js';
import { GAIA } from './constants.js';

const NO_WALLS = ['d3kt', 'cungr', 'deathmatch'];
const NO_TOWERS = ['d3kt', 'cungr'];
const SHORT = { d3kt: 'D3KT', cungr: 'Cung R', free: 'Tự do', deathmatch: 'Deathmatch' };

export function ruleBuildError(world, p, btype) {
  const r = world.settings.rules;
  const def = BUILDINGS[btype];
  if (!def) return null;
  if (def.wall && NO_WALLS.includes(r)) return `Luật ${SHORT[r]}: cấm xây Thành`;
  if (def.cls.includes('tower') && NO_TOWERS.includes(r)) return `Luật ${SHORT[r]}: cấm xây Chòi`;
  return null;
}

export function ruleTrainError(world, p, utype) {
  const r = world.settings.rules;
  const def = UNITS[utype];
  if (!def || !isMilitary(def)) return null;
  if (r === 'd3kt' || r === 'cungr') {
    if (p.age < 2 && world.militaryCount(p) >= 1) return `Luật ${SHORT[r]}: chỉ được 1 lính trước khi lên xong đời 3`;
  }
  if (r === 'cungr') {
    if (p.age === 1 && utype === 'bowman') return 'Luật Cung R: không được xin Cung T ở đời 2';
    if (p.age === 2 && world.gameSeconds() < 25 * 60 && utype !== 'chariot_archer') return 'Luật Cung R: đời 3 chỉ được ra Cung R (tự do từ phút 25 hoặc đời 4)';
  }
  return null;
}

export function ruleAttackError(world, attacker, target) {
  const r = world.settings.rules;
  if (!target || target.owner === GAIA || attacker.owner === target.owner) return null;
  const p = world.players[attacker.owner];
  if (!p) return null;
  if ((r === 'd3kt' || r === 'cungr') && attacker.type === 'villager' && p.age < 2) {
    if (target.kind === 'unit' && target.type === 'villager') return 'Luật D3KT: không được dùng dân đánh dân trước đời 3';
    if (target.kind === 'building' && target.type !== 'house') return 'Luật D3KT: dân chỉ được đập nhà BE của đối thủ trước đời 3';
  }
  if (r === 'cungr' && !p.has('wheel')) {
    if ((target.kind === 'unit' && target.type === 'villager') || (target.kind === 'building' && target.type === 'house')) {
      return 'Luật Cung R: chưa có Wheel không được đánh dân & nhà BE';
    }
  }
  return null;
}
