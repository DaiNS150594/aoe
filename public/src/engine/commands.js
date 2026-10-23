// Player commands. These are the only way input enters the simulation: the
// client sends them through the lockstep relay and every peer applies the same
// commands at the same tick. Each command is validated here (ownership,
// resources, rules), so a cheating client can't do anything illegal.
import { GAIA } from './constants.js';
import { UNITS } from './data/units.js';
import { BUILDINGS } from './data/buildings.js';
import { setOrder, canConvert, convertTarget } from './behavior.js';
import { killEntity } from './combat.js';
import { ruleAttackError } from './rules.js';
import { applyCheat } from './cheats.js';
import { queueTrain, startResearch, cancelWork, buildError, actualBuildType } from './production.js';

function ownUnits(world, p, ids) {
  const out = [];
  if (!Array.isArray(ids)) return out;
  for (const id of ids.slice(0, 200)) {
    const e = world.alive(id);
    if (e && e.kind === 'unit' && e.owner === p.id) out.push(e);
  }
  return out;
}
function ownBuilding(world, p, id) {
  const b = world.alive(id);
  return b && b.kind === 'building' && b.owner === p.id ? b : null;
}

// Spread a group around a destination (simple formation grid).
function formationOffsets(n, spacing) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    out.push({ x: (c - (cols - 1) / 2) * spacing, y: (r - (rows - 1) / 2) * spacing });
  }
  return out;
}

export function handleCommand(world, p, c) {
  switch (c.type) {
    case 'move':
    case 'amove': {
      const us = ownUnits(world, p, c.ids);
      if (!us.length) return;
      const x = clampF(+c.x, 0.5, world.map.w - 0.5), y = clampF(+c.y, 0.5, world.map.h - 0.5);
      // keep formation order stable: sort by distance to target
      const d2 = (u) => (u.x - x) * (u.x - x) + (u.y - y) * (u.y - y);
      const sorted = us.slice().sort((a, b) => (d2(a) - d2(b)) || (a.id - b.id));
      const sp = sorted.length > 1 ? Math.max(0.7, ...sorted.map((u) => u.stats.radius * 2 + 0.25)) : 0;
      const offs = formationOffsets(sorted.length, sp);
      sorted.forEach((u, i) => {
        setOrder(world, u, { type: c.type, x: clampF(x + offs[i].x, 0.5, world.map.w - 0.5), y: clampF(y + offs[i].y, 0.5, world.map.h - 0.5) });
      });
      return;
    }
    case 'attack': {
      const t = world.alive(c.target);
      if (!t) return;
      for (const u of ownUnits(world, p, c.ids)) {
        if (u.type === 'priest') {
          if (world.isEnemy(p.id, t.owner) && canConvert(world, p, t)) setOrder(world, u, { type: 'convert', target: t.id });
          continue;
        }
        if (u.type === 'villager' && t.kind === 'unit' && t.owner === GAIA && UNITS[t.type].food) {
          setOrder(world, u, { type: 'gather', target: t.id });
          continue;
        }
        if (!u.stats.hasAtk) continue;
        const err = ruleAttackError(world, u, t);
        if (err) { world.msg(p.id, err, '#ff9090'); continue; }
        if (t.kind === 'resource') continue;
        if (t.owner !== GAIA && !world.isEnemy(p.id, t.owner) && !c.force) continue;
        setOrder(world, u, { type: 'attack', target: t.id, force: !!c.force });
      }
      return;
    }
    case 'gather': {
      const t = world.alive(c.target);
      if (!t) return;
      const kind = world.resKindOf(t);
      if (!kind) return;
      if (t.kind === 'building' && t.owner !== p.id) return;
      for (const u of ownUnits(world, p, c.ids)) {
        if (u.type !== 'villager') continue;
        setOrder(world, u, { type: 'gather', target: t.id, kind });
      }
      return;
    }
    case 'build': {
      let btype = c.btype;
      if (!BUILDINGS[btype]) return;
      const err = buildError(world, p, btype);
      if (err) { world.msg(p.id, err, '#ff9090'); world.emit({ t: 'sound', s: 'error', p: p.id }); return; }
      btype = actualBuildType(p, btype);
      const tx = c.tx | 0, ty = c.ty | 0;
      const perr = world.placementError(p, btype, tx, ty);
      if (perr) { world.msg(p.id, perr, '#ff9090'); world.emit({ t: 'sound', s: 'error', p: p.id }); return; }
      const cost = p.buildingStats(btype).cost;
      if (!p.canAfford(cost)) { world.msg(p.id, 'Không đủ tài nguyên', '#ff9090'); world.emit({ t: 'sound', s: 'error', p: p.id }); return; }
      p.pay(cost);
      const b = world.spawnBuilding(btype, p.id, tx, ty, false);
      b.cost = { ...cost };
      // push own units standing on the footprint out of the way
      pushOutUnits(world, b);
      for (const u of ownUnits(world, p, c.ids)) if (u.type === 'villager') setOrder(world, u, { type: 'build', target: b.id });
      world.emit({ t: 'placed', p: p.id, id: b.id, type: btype });
      return;
    }
    case 'buildWall': {
      // a straight line of 1x1 wall segments
      const err = buildError(world, p, 'small_wall');
      if (err) { world.msg(p.id, err, '#ff9090'); return; }
      const btype = actualBuildType(p, 'small_wall');
      const tiles = lineTiles(c.x0 | 0, c.y0 | 0, c.x1 | 0, c.y1 | 0).slice(0, 60);
      const segs = [];
      for (const [tx, ty] of tiles) {
        if (world.placementError(p, btype, tx, ty)) continue;
        const cost = p.buildingStats(btype).cost;
        if (!p.canAfford(cost)) break;
        p.pay(cost);
        segs.push(world.spawnBuilding(btype, p.id, tx, ty, false));
      }
      const us = ownUnits(world, p, c.ids).filter((u) => u.type === 'villager');
      if (segs.length) us.forEach((u, i) => setOrder(world, u, { type: 'build', target: segs[i % segs.length].id }));
      return;
    }
    case 'repair': {
      const t = world.alive(c.target);
      if (!t || t.kind !== 'building' || !world.isAlly(p.id, t.owner)) return;
      for (const u of ownUnits(world, p, c.ids)) if (u.type === 'villager') setOrder(world, u, { type: t.built ? 'repair' : 'build', target: t.id });
      return;
    }
    case 'train': {
      const b = ownBuilding(world, p, c.bid);
      if (!b) return;
      queueTrain(world, p, b, c.utype, Math.max(1, Math.min(10, c.n | 0 || 1)));
      return;
    }
    case 'research': {
      const b = ownBuilding(world, p, c.bid);
      if (b) startResearch(world, p, b, c.tech);
      return;
    }
    case 'cancel': {
      const b = ownBuilding(world, p, c.bid);
      if (!b) return;
      if (!b.built) { // cancel a foundation: refund
        if (b.cost) p.refund(b.cost);
        killEntity(world, b, null, 'cancel');
        return;
      }
      cancelWork(world, p, b);
      return;
    }
    case 'stop': {
      for (const u of ownUnits(world, p, c.ids)) { setOrder(world, u, null); u.anim = 'idle'; }
      return;
    }
    case 'delete': {
      const ids = Array.isArray(c.ids) ? c.ids.slice(0, 200) : [];
      for (const id of ids) {
        const e = world.alive(id);
        if (!e || e.owner !== p.id) continue;
        if (e.kind === 'unit' && e.type === 'priest' && p.flags.has('martyrdom') && e.order && e.order.type === 'convert') {
          const t = world.alive(e.order.target);
          if (t && t.type !== 'priest' && world.edgeDist(e, t) <= e.stats.range + 0.5) convertTarget(world, e, t);
        }
        if (e.kind === 'building' && !e.built && e.cost) p.refund(e.cost);
        killEntity(world, e, null, 'deleted');
      }
      return;
    }
    case 'rally': {
      const ids = Array.isArray(c.bids) ? c.bids : [c.bid];
      for (const id of ids) {
        const b = ownBuilding(world, p, id);
        if (b) b.rally = { x: clampF(+c.x, 0, world.map.w), y: clampF(+c.y, 0, world.map.h), target: c.target || 0 };
      }
      return;
    }
    case 'convert': {
      const t = world.alive(c.target);
      if (!t) return;
      for (const u of ownUnits(world, p, c.ids)) if (u.type === 'priest' && canConvert(world, p, t) && world.isEnemy(p.id, t.owner)) setOrder(world, u, { type: 'convert', target: t.id });
      return;
    }
    case 'heal': {
      const t = world.alive(c.target);
      if (!t || t.kind !== 'unit' || !world.isAlly(p.id, t.owner)) return;
      for (const u of ownUnits(world, p, c.ids)) if (u.type === 'priest') setOrder(world, u, { type: 'heal', target: t.id });
      return;
    }
    case 'tribute': {
      const to = world.players[c.to | 0];
      const res = c.res;
      const amount = Math.floor(+c.amount || 0);
      if (!to || to.id === GAIA || to.id === p.id || !['food', 'wood', 'gold', 'stone'].includes(res) || amount <= 0) return;
      if (!p.hasBuilt('market')) { world.msg(p.id, 'Cần xây Chợ (Market) để cống nạp', '#ff9090'); return; }
      const tax = p.tributeTax;
      const total = Math.ceil(amount * (1 + tax));
      if (p.res[res] < total) { world.msg(p.id, 'Không đủ tài nguyên', '#ff9090'); return; }
      p.res[res] -= total;
      to.res[res] += amount;
      p.stats.tributeSent += amount; to.stats.tributeRecv += amount;
      world.msg(-1, `${p.name} đã cống nạp ${amount} ${RES_VI[res]} cho ${to.name}`, p.color.hex);
      return;
    }
    case 'resign': {
      if (!p.alive) return;
      p.resigned = true;
      world.msg(-1, `${p.name} đã đầu hàng.`, p.color.hex);
      for (const e of [...p.units]) killEntity(world, e, null, 'resign');
      for (const e of [...p.buildings]) killEntity(world, e, null, 'resign');
      return;
    }
    case 'cheat': {
      applyCheat(world, p, c.code);
      return;
    }
    case 'diplomacy': {
      if (world.settings.lockTeams) return;
      const q = world.players[c.to | 0];
      if (!q || q.id === GAIA || q.id === p.id) return;
      // simple model: alliance = shared team id
      if (c.stance === 'ally') {
        if (!p.team) p.team = 10 + p.id;
        if (q.team !== p.team && q.ai) q.team = p.team;
      } else if (c.stance === 'enemy' && p.team && p.team === q.team) {
        p.team = 20 + p.id;
      }
      return;
    }
    default:
  }
}

const RES_VI = { food: 'thịt', wood: 'gỗ', gold: 'vàng', stone: 'đá' };
function clampF(v, a, b) { if (!(v === v)) return a; return v < a ? a : v > b ? b : v; }

function lineTiles(x0, y0, x1, y1) {
  const out = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0, guard = 0;
  while (guard++ < 200) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

function pushOutUnits(world, b) {
  const map = world.map;
  for (const u of world.list) {
    if (u.dead || u.kind !== 'unit') continue;
    if (u.x < b.tx - 0.2 || u.x > b.tx + b.size + 0.2 || u.y < b.ty - 0.2 || u.y > b.ty + b.size + 0.2) continue;
    if (!(u.x > b.tx && u.x < b.tx + b.size && u.y > b.ty && u.y < b.ty + b.size)) continue;
    const pos = world.spawnPointNear(b, u.x, u.y);
    if (map.passable(Math.floor(pos.x), Math.floor(pos.y))) { u.x = pos.x; u.y = pos.y; u.px = u.x; u.py = u.y; u.path = null; }
  }
}
