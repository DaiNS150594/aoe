// Training units, researching technologies, age advancement and towers, on
// top of the original technology tree (engine/techtree.js).
import { UNITS, UNIT_LINES } from './data/units.js';
import { BUILDINGS } from './data/buildings.js';
import { TECHS, TECH_OF_DAT } from './data/techs.js';
import { BUILDING_DAT } from './data/ids.js';
import { GAIA } from './constants.js';
import { completeTech, checkTechs, TS, TYPE_OF_DAT, baseSlot, ENABLED_BY, UPGRADED_BY } from './techtree.js';
import { BUILDING_OF_TECH } from './player.js';
import { ruleTrainError, ruleBuildError, ruleAttackError } from './rules.js';
import { spawnProjectile } from './combat.js';
import { setOrder } from './behavior.js';
import { dist } from './dmath.js';

export const AGE_NAMES = ['Đời 1 (Đồ đá)', 'Đời 2 (Công cụ)', 'Đời 3 (Đồ đồng)', 'Đời 4 (Đồ sắt)'];
export const AGE_NAMES_EN = ['Stone Age', 'Tool Age', 'Bronze Age', 'Iron Age'];
const QUEUE_MAX = 10;

// ------------------------------------------------------------- validation
export function trainError(world, p, b, utype) {
  const def = UNITS[utype];
  if (!def || !b || b.owner !== p.id) return 'Không hợp lệ';
  if (!b.built) return 'Công trình chưa xây xong';
  const lines = UNIT_LINES[b.type] || [];
  const line = lines.find((l) => l.includes(utype));
  if (!line) return 'Không thể tạo ở đây';
  if (p.currentOfLine(line) !== utype) {
    if (p.unitDisabled(utype)) return 'Phe ' + p.civ.vi + ' không có ' + def.vi;
    return unlockRequirement(p, def.dat) || 'Chưa mở khóa ' + def.vi;
  }
  if (b.research) return 'Công trình đang nghiên cứu';
  if (b.queue.length && b.queue[0].type !== utype) return 'Công trình đang tạo loại quân khác';
  let n = 0; for (const q of b.queue) n += q.n;
  if (n >= QUEUE_MAX) return 'Hàng chờ đã đầy';
  const re = ruleTrainError(world, p, utype);
  if (re) return re;
  return null;
}

// what still has to happen before a unit can be trained / a building placed
function unlockRequirement(p, datId) {
  const t = ENABLED_BY[datId] ?? UPGRADED_BY[datId];
  if (t === undefined) return null;
  if (TECH_OF_DAT[t]) return 'Cần nghiên cứu ' + TECHS[TECH_OF_DAT[t]].vi;
  return p.techRequirement(t);
}

export function researchError(world, p, b, techId) {
  const def = TECHS[techId];
  if (!def || !b || b.owner !== p.id || def.building !== b.type) return 'Không hợp lệ';
  if (!b.built) return 'Công trình chưa xây xong';
  const st = p.state[def.dat];
  if (st === TS.DONE) return def.advance !== undefined && p.age >= def.advance ? 'Đã lên đời' : 'Đã nghiên cứu';
  if (st === TS.RESEARCHING) return 'Đang nghiên cứu ở nơi khác';
  if (st === TS.DISABLED || p.techDisabled(techId)) return 'Phe ' + p.civ.vi + ' không có công nghệ này';
  if (st !== TS.AVAILABLE) return p.techRequirement(def.dat) || 'Chưa đủ điều kiện';
  if (b.research || b.queue.length) return 'Công trình đang bận';
  return null;
}

export function buildError(world, p, btype) {
  const def = BUILDINGS[btype];
  if (!def) return 'Không hợp lệ';
  if (!p.buildingEnabled(btype)) {
    if (p.buildingDisabled(btype)) return 'Phe ' + p.civ.vi + ' không có ' + def.vi;
    return unlockRequirement(p, def.dat) || 'Chưa mở khóa ' + def.vi;
  }
  if (def.water) return 'Bản đồ Hill Country không có nước';
  const re = ruleBuildError(world, p, btype);
  if (re) return re;
  return null;
}
// Towers and walls are placed as the best level the player has researched.
export function actualBuildType(p, btype) {
  if (btype === 'watch_tower' || btype === 'small_wall') return p.currentBuilding(btype);
  return btype;
}

// ----------------------------------------------------------------- actions
export function queueTrain(world, p, b, utype, n) {
  let added = 0;
  for (let i = 0; i < n; i++) {
    const err = trainError(world, p, b, utype);
    if (err) { if (!added) world.msg(p.id, err); break; }
    const cost = p.unitStats(utype).cost;
    if (!p.canAfford(cost)) { if (!added) world.msg(p.id, 'Không đủ tài nguyên', '#ff8080'); world.emit({ t: 'sound', s: 'error', p: p.id }); break; }
    p.pay(cost);
    if (b.queue.length && b.queue[b.queue.length - 1].type === utype) b.queue[b.queue.length - 1].n++;
    else b.queue.push({ type: utype, n: 1, cost: { ...cost } });
    added++;
  }
  return added;
}

export function startResearch(world, p, b, techId) {
  const err = researchError(world, p, b, techId);
  if (err) { world.msg(p.id, err); return false; }
  const def = TECHS[techId];
  const cost = { ...p.techCost[def.dat] };
  if (!p.canAfford(cost)) { world.msg(p.id, 'Không đủ tài nguyên', '#ff8080'); world.emit({ t: 'sound', s: 'error', p: p.id }); return false; }
  p.pay(cost);
  p.state[def.dat] = TS.RESEARCHING;
  b.research = { tech: techId, t: 0, cost };
  return true;
}

// Cancel the last queued unit (or the research) of a building, refunding it.
export function cancelWork(world, p, b) {
  if (b.research) {
    p.refund(b.research.cost);
    stopResearch(p, b);
    return;
  }
  if (!b.queue.length) return;
  const last = b.queue[b.queue.length - 1];
  p.refund(last.cost);
  last.n--;
  if (last.n <= 0) {
    b.queue.pop();
    if (b.queue.length === 0 && b.training) {
      p.training -= b.trainPop; b.training = false; b.trainT = 0;
    }
  }
}

// a research stopped without finishing (cancelled, building lost or converted)
export function stopResearch(p, b) {
  const def = TECHS[b.research.tech];
  b.research = null;
  if (p.state[def.dat] === TS.RESEARCHING) { p.state[def.dat] = TS.LOCKED; checkTechs(p); }
}

// ------------------------------------------------------------------ update
export function updateBuilding(world, b, dt) {
  if (!b.built) return;
  const p = world.players[b.owner];
  const ster = p.flags.has('cheat:steroids') ? 20 : 1;
  if (b.research) {
    b.research.t += dt * ster;
    if (b.research.t >= p.techTimeOf(b.research.tech)) {
      const tech = b.research.tech;
      b.research = null;
      applyTech(world, p, tech);
    }
  } else if (b.queue.length) {
    const item = b.queue[0];
    const st = p.unitStats(item.type);
    if (!b.training) {
      if (p.pop + p.training + st.pop <= p.popCap + 1e-9) {
        b.training = true; b.trainT = 0; b.trainPop = st.pop; p.training += st.pop; b.popBlocked = false;
      } else if (!b.popBlocked) {
        b.popBlocked = true;
        world.msg(p.id, p.popCap >= world.settings.popLimit ? 'Đã đạt giới hạn dân số' : 'Cần xây thêm nhà (BE)!', '#ffd080');
        world.emit({ t: 'sound', s: 'needhouse', p: p.id });
      }
    }
    if (b.training) {
      b.trainT += dt * ster;
      if (b.trainT >= st.time) {
        p.training -= b.trainPop;
        b.training = false; b.trainT = 0;
        item.n--;
        if (item.n <= 0) b.queue.shift();
        spawnTrained(world, p, b, item.type);
      }
    }
  }
  if (b.stats.hasAtk) towerTick(world, b, dt);
}

function spawnTrained(world, p, b, type) {
  const rp = b.rally;
  const tx = rp ? rp.x : b.x + b.size, ty = rp ? rp.y : b.y + b.size;
  const pos = world.spawnPointNear(b, tx, ty);
  const u = world.spawnUnit(type, p.id, pos.x, pos.y);
  u.fx = tx - pos.x; u.fy = ty - pos.y;
  world.emit({ t: 'trained', p: p.id, id: u.id, type, x: u.x, y: u.y });
  let mil = 0; for (const x of p.units) if (x.type !== 'villager') mil++;
  if (mil > p.stats.militaryHigh) p.stats.militaryHigh = mil;
  if (rp) {
    const t = rp.target ? world.alive(rp.target) : null;
    if (t && type === 'villager' && world.resKindOf(t) && (t.kind !== 'building' || t.owner === p.id)) {
      setOrder(world, u, { type: 'gather', target: t.id });
    } else if (t && type === 'villager' && t.kind === 'building' && t.owner === p.id && !t.built) {
      setOrder(world, u, { type: 'build', target: t.id });
    } else {
      setOrder(world, u, { type: 'move', x: rp.x, y: rp.y });
    }
  }
}

function towerTick(world, b, dt) {
  if (b.cd > 0) b.cd -= dt;
  const range = b.stats.range + b.size / 2;
  let t = world.alive(b.target);
  if (t && (dist(b.x, b.y, t.x, t.y) - t.stats.radius > range || t.owner === b.owner || !world.isEnemy(b.owner, t.owner))) t = null;
  if (!t && (world.tick + b.id) % 3 === 0) {
    let bd = Infinity;
    world.grid.query(b.x, b.y, range + 1, (u) => {
      if (u.dead || u.owner === GAIA || !world.isEnemy(b.owner, u.owner)) return false;
      const d = dist(b.x, b.y, u.x, u.y) - u.stats.radius;
      if (d <= range && d < bd && !ruleAttackError(world, b, u)) { bd = d; t = u; }
      return false;
    });
    b.target = t ? t.id : 0;
  }
  if (t && b.cd <= 0) {
    b.cd = b.stats.rof;
    spawnProjectile(world, b, t, b.stats);
    world.emit({ t: 'sound', s: b.stats.proj && b.stats.proj.kind === 'bolt' ? 'shoot_bolt' : 'shoot_arrow', x: b.x, y: b.y, p: b.owner });
  }
}

// --------------------------------------------------------------- tech effects
// Research a technology (or force it, for tests and later starting ages) and
// bring every unit and building of the player up to date.
export function applyTech(world, p, techId, silent) {
  const def = TECHS[techId];
  if (!def) return;
  if (p.state[def.dat] === TS.DONE) return;
  if (p.state[def.dat] === TS.DISABLED) p.state[def.dat] = TS.LOCKED;
  const ageBefore = p.age;
  completeTech(p, def.dat);
  p.stats.techs++;
  techDone(world, p);
  if (p.age > ageBefore) p.stats.ageTicks[p.age] = world.tick;
  if (!silent) {
    world.emit({ t: 'research', p: p.id, tech: techId });
    if (p.age > ageBefore) {
      world.emit({ t: 'age', p: p.id, age: p.age });
      world.msg(-1, `${p.name} đã lên ${AGE_NAMES[p.age]}!`, p.color.hex);
    } else {
      world.msg(p.id, `Nghiên cứu xong: ${def.vi}`, '#a0ffa0');
    }
  }
}

// A finished building researches its building technology (Granary, Market...).
export function buildingTechDone(world, p, b) {
  const id = BUILDINGS[b.type].research;
  if (id < 0 || BUILDING_OF_TECH[id] === undefined) return;
  if (completeTech(p, id)) techDone(world, p);
}

// After any research: unit upgrades, new stats for everything, age, population.
function techDone(world, p) {
  const ups = p.upgrades.splice(0);
  for (const [a, b] of ups) {
    const to = TYPE_OF_DAT[b];
    if (!to) continue; // an upgrade that only changes the looks (Iron Age villager, Bronze Age buildings)
    const conv = (type) => type !== to && baseSlot(UNITS[type] ? UNITS[type].dat : BUILDINGS[type].dat) === a;
    for (const u of p.units) if (UNITS[u.type] && conv(u.type)) { u._ratio = u.hp / u.stats.hp; u.type = to; }
    for (const bld of p.buildings) {
      if (BUILDINGS[bld.type] && conv(bld.type)) { bld._ratio = bld.hp / bld.stats.hp; bld.type = to; }
      for (const q of bld.queue) if (UNITS[q.type] && conv(q.type)) q.type = to;
    }
  }
  p.invalidate();
  for (const u of p.units) {
    const ns = p.unitStats(u.type);
    if (u._ratio !== undefined) { u.hp = Math.max(1, u._ratio * ns.hp); delete u._ratio; }
    else if (u.stats && ns.hp > u.stats.hp) u.hp += ns.hp - u.stats.hp;
    u.stats = ns;
    if (u.hp > ns.hp) u.hp = ns.hp;
  }
  for (const bld of p.buildings) {
    const ns = p.buildingStats(bld.type);
    if (bld._ratio !== undefined) { bld.hp = Math.max(1, bld._ratio * ns.hp); delete bld._ratio; }
    else if (bld.built && ns.hp > bld.stats.hp) bld.hp += ns.hp - bld.stats.hp;
    bld.stats = ns;
    if (bld.hp > ns.hp) bld.hp = ns.hp;
  }
  world.recomputePop(p);
}
