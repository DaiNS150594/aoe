// Drawing with the original Rise of Rome sprites (when the player has loaded
// their own game files). Every method returns false when it cannot draw, so
// the renderer falls back to the procedural sprites.
import { aoe } from '../assets/loader.js';
import { VILLAGER_TASKS, GFX, CARCASS_GFX, UNIT_ICON_SLP, TECH_ICON_SLP } from '../assets/mapping.js';
import { HW, HH } from './iso.js';
import { TICK_S } from '../engine/constants.js';
import { ORIGINAL_MAP_UNITS } from '../engine/data/original-map.js';

// screen direction of a world-space vector, in radians clockwise from
// "south" (towards the viewer) — the order AoE stores its angles in
export function aoeDir(fx, fy) {
  const sx = (fx - fy) * HW, sy = (fx + fy) * HH;
  if (!sx && !sy) return 0;
  const a = Math.atan2(-sx, sy);
  return a < 0 ? a + Math.PI * 2 : a;
}
const screenDirRad = (dx, dy) => { const a = Math.atan2(-dx, dy); return a < 0 ? a + Math.PI * 2 : a; };
const hash = (a, b) => (((a * 73856093) ^ (b * 19349663)) >>> 0);

export class AoeRender {
  constructor(renderer) { this.r = renderer; }
  get active() { return !!aoe(); }

  civOf(owner) { const p = this.r.world.players[owner]; return p && !p.isGaia ? p.civId : null; }
  colorOf(owner) { const p = this.r.world.players[owner]; return p && p.color && p.color.id >= 0 ? p.color.id : 0; }

  // ------------------------------------------------------------- units
  unitGraphic(A, e, def, civ) {
    const anim = e.anim;
    if (e.type === 'villager') {
      const task = e.task ? VILLAGER_TASKS[e.task] : null;
      const tdef = task ? A.mapping.taskDef(civ, e.task) : null;
      const base = tdef || def;
      const carrying = e.carry > 0.5 && e.carryKind && task;
      switch (anim) {
        case 'walk': case 'run': return [carrying && task[2] > 0 ? task[2] : base.walking, false];
        case 'build': return [466, false];
        case 'hunt': return [GFX.hunt, true];
        case 'attack': return [def.attackGraphic, true];
        case 'work': {
          if (e.task === 'woodcutter') {
            const t = e.order && e.order.target ? this.r.world.alive(e.order.target) : null;
            return [t && t.type === 'tree' && !t.felled ? GFX.chop : task[1], false];
          }
          return [task ? task[1] : base.standing, false];
        }
        default: return [carrying && task[3] > 0 ? task[3] : base.standing, false];
      }
    }
    switch (anim) {
      case 'walk': return [def.walking, false];
      case 'run': return [def.running >= 0 ? def.running : def.walking, false];
      case 'attack': case 'hunt': return [def.attackGraphic >= 0 ? def.attackGraphic : def.standing, true];
      case 'chant': case 'heal': return [GFX.priestChant, false];
      default: return [def.standing, false];
    }
  }

  unit(e, p, alpha) {
    const A = aoe();
    if (!A) return false;
    const civ = this.civOf(e.owner);
    const def = A.mapping.unitDef(civ, e.type);
    if (!def) return false;
    let [gid, once] = this.unitGraphic(A, e, def, civ);
    if (gid === undefined || gid < 0) gid = def.standing;
    const w = this.r.world;
    const t = Math.max(0, (w.tick - e.animT + alpha) * TICK_S) + (once ? 0 : (e.id % 7) * 0.13);
    return A.assets.draw(this.r.ctx, gid, p.x, p.y, this.r.cam.zoom, { dir: aoeDir(e.fx, e.fy), time: t, once, color: this.colorOf(e.owner) });
  }

  // dying animation, then the corpse slowly decaying; returns false when not drawable
  corpse(c, p, now) {
    const A = aoe();
    if (!A) return false;
    const civ = this.civOf(c.owner);
    let def = null;
    if (c.type === 'villager' && c.task) def = A.mapping.taskDef(civ, c.task);
    if (!def) def = A.mapping.unitDef(civ, c.type);
    if (!def) return false;
    const ctx = this.r.ctx, z = this.r.cam.zoom;
    const age = (now - c.t0) / 1000;
    const dir = aoeDir(c.fx, c.fy), color = this.colorOf(c.owner);
    const dur = def.dying >= 0 ? A.assets.duration(def.dying) : 0;
    if (age < dur) return A.assets.draw(ctx, def.dying, p.x, p.y, z, { dir, time: age, once: true, color });
    const civUnits = (A.mapping.civ(civ) || A.mapping.gaia()).units;
    const dead = def.deadUnit >= 0 ? civUnits[def.deadUnit] || A.mapping.gaia().units[def.deadUnit] : null;
    if (!dead || dead.standing < 0) return true;
    const left = c.life - (now - c.t0);
    ctx.globalAlpha = Math.max(0, Math.min(1, left / 4000));
    A.assets.draw(ctx, dead.standing, p.x, p.y, z, { dir, time: age - dur, once: true, color });
    ctx.globalAlpha = 1;
    return true;
  }

  // ---------------------------------------------------------- buildings
  building(e, p, now) {
    const A = aoe();
    if (!A) return false;
    const owner = this.r.world.players[e.owner];
    if (!owner) return false;
    const b = A.mapping.building(owner.civId, e.type, owner.age);
    if (!b) return false;
    const ctx = this.r.ctx, z = this.r.cam.zoom, color = this.colorOf(e.owner);
    if (!e.built) return true; // drawn by groundBuilding() as construction stages
    const t = now / 1000 + (e.id % 11) * 0.37;
    const facet = e.type.endsWith('_wall') ? this.wallFacet(e) : b.facet;
    if (!A.assets.draw(ctx, b.unit.standing, p.x, p.y, z, { facet, time: t, color })) return false;
    // fires on damaged buildings
    const dmg = 1 - e.hp / e.stats.hp;
    let fire = -1;
    for (const d of b.unit.damageGraphics || []) if (dmg * 100 >= d.percent) fire = d.gid;
    if (fire >= 0) A.assets.draw(ctx, fire, p.x, p.y, z, { time: t, color });
    return true;
  }

  // wall pieces: 0 = runs along y, 1 = runs along x, 2 = pillar (ends,
  // corners, junctions, isolated pieces)
  wallFacet(e) {
    const w = this.r.world, m = w.map;
    const isWall = (x, y) => {
      if (!m.inBounds(x, y)) return false;
      const o = w.alive(m.block[m.idx(x, y)]);
      return !!o && o.kind === 'building' && o.owner === e.owner && o.type.endsWith('_wall');
    };
    const ax = isWall(e.tx - 1, e.ty) || isWall(e.tx + 1, e.ty);
    const ay = isWall(e.tx, e.ty - 1) || isWall(e.tx, e.ty + 1);
    return ax && !ay ? 1 : ay && !ax ? 0 : 2;
  }

  // ground layer: farms and foundations / construction stages
  groundBuilding(e, p) {
    const A = aoe();
    if (!A) return false;
    const owner = this.r.world.players[e.owner];
    if (!owner) return false;
    const b = A.mapping.building(owner.civId, e.type, owner.age);
    if (!b) return false;
    const ctx = this.r.ctx, z = this.r.cam.zoom, color = this.colorOf(e.owner);
    if (e.built) return A.assets.draw(ctx, b.unit.standing, p.x, p.y, z, { facet: b.facet, color });
    const cg = b.unit.construction;
    const g = A.assets.graphic(cg);
    if (!g) return false;
    const stages = Math.max(1, g.angles || 1);
    const facet = Math.min(stages - 1, Math.floor(Math.max(0, e.progress) * stages));
    return A.assets.draw(ctx, cg, p.x, p.y, z, { facet, color });
  }

  // placement ghost
  ghost(type, p, alpha) {
    const A = aoe();
    if (!A) return false;
    const me = this.r.world.players[this.r.pid];
    if (!me) return false;
    const b = A.mapping.building(me.civId, type, me.age);
    if (!b) return false;
    this.r.ctx.globalAlpha = alpha;
    const ok = A.assets.draw(this.r.ctx, b.unit.standing, p.x, p.y, this.r.cam.zoom, { facet: b.facet, color: this.colorOf(this.r.pid) });
    this.r.ctx.globalAlpha = 1;
    return ok;
  }

  // visual height (pixels) of a building, for selection boxes / picking
  buildingHeight(e) {
    const A = aoe();
    if (!A) return null;
    const owner = this.r.world.players[e.owner];
    const b = owner && A.mapping.building(owner.civId, e.type, owner.age);
    if (!b) return null;
    const box = A.assets.bounds(b.unit.standing, b.facet);
    return box ? Math.max(0, -box.y0 - e.size * HH) : null;
  }

  // --------------------------------------------------------- resources
  resource(e, p, now) {
    const A = aoe();
    if (!A) return false;
    const ctx = this.r.ctx, z = this.r.cam.zoom;
    switch (e.type) {
      case 'tree': {
        const h = hash(e.tx, e.ty);
        if (e.felled) return A.assets.draw(ctx, h & 1 ? GFX.treeFallA : GFX.treeFallB, p.x, p.y, z, {});
        // the tree the random map placed (its own graphic, at its own spot)
        const def = e.dat !== undefined && ORIGINAL_MAP_UNITS[e.dat];
        if (def && def.gfx >= 0) {
          const q = e.ox || e.oy ? this.r.proj(e.x + (e.ox || 0), e.y + (e.oy || 0)) : p;
          return A.assets.draw(ctx, def.gfx, q.x, q.y, z, {});
        }
        const list = e.straggler ? GFX.stragglerTrees : GFX.forestTrees;
        return A.assets.draw(ctx, list[(e.variant * 7 + h) % list.length], p.x, p.y, z, {});
      }
      case 'gold_mine': return A.assets.draw(ctx, GFX.gold, p.x, p.y, z, { facet: hash(e.tx, e.ty) % 7 });
      case 'stone_mine': return A.assets.draw(ctx, GFX.stone, p.x, p.y, z, { facet: hash(e.tx, e.ty) % 7 });
      case 'berry_bush': return A.assets.draw(ctx, GFX.berry, p.x, p.y, z, {});
      case 'carcass': {
        const gid = CARCASS_GFX[e.animal];
        const g = A.assets.graphic(gid);
        if (!g) return false;
        const used = 1 - Math.max(0, e.amount) / Math.max(1, e.maxAmount);
        return A.assets.draw(ctx, gid, p.x, p.y, z, { dir: aoeDir(e.fx || 1, e.fy || 0), frame: Math.min(g.frames - 1, Math.floor(used * g.frames)) });
      }
    }
    return false;
  }

  // a terrain decoration (unit drawn with its standing graphic)
  decor(d, p) {
    const A = aoe();
    const def = ORIGINAL_MAP_UNITS[d.u];
    if (!A || !def || def.gfx < 0) return false;
    return A.assets.draw(this.r.ctx, def.gfx, p.x, p.y, this.r.cam.zoom, { facet: 0 });
  }

  // a cliff piece: its unit's graphic, the facet picked by the cliff table
  cliff(e, p) {
    const A = aoe();
    if (!A) return false;
    const def = ORIGINAL_MAP_UNITS[e.unit];
    if (!def) return false;
    return A.assets.draw(this.r.ctx, def.gfx, p.x, p.y, this.r.cam.zoom, { facet: e.facet });
  }

  // -------------------------------------------------------- projectiles
  projectile(pr, p, dx, dy) {
    const A = aoe();
    if (!A) return false;
    const gid = { arrow: GFX.arrow, bolt: GFX.bolt, stone: GFX.stone, pebble: GFX.slingStone, spear: GFX.spear }[pr.kind];
    if (gid === undefined) return false;
    return A.assets.draw(this.r.ctx, gid, p.x, p.y, this.r.cam.zoom, { dir: screenDirRad(dx, dy), frame: 0 });
  }

  // one-shot graphic effects (explosions) and rubble
  effect(gid, p, age) {
    const A = aoe();
    if (!A) return false;
    return A.assets.draw(this.r.ctx, gid, p.x, p.y, this.r.cam.zoom, { time: age, once: true });
  }
  rubble(size, p) {
    const A = aoe();
    if (!A) return false;
    return A.assets.draw(this.r.ctx, GFX.rubble[size] || GFX.rubble[3], p.x, p.y, this.r.cam.zoom, {});
  }
}

// ----------------------------------------------------------------- icons
// HUD icon from the original interface sheets, scaled into a size x size
// canvas; null when unavailable.
const iconMemo = new Map();
export function aoeIcon(kind, type, col, size, opts = {}) {
  const A = aoe();
  if (!A) return null;
  const color = col && col.id >= 0 ? col.id : 0;
  const key = [kind, type, color, size, opts.civ || '', opts.age ?? ''].join('|');
  if (iconMemo.has(key)) return iconMemo.get(key);
  let src = null;
  if (kind === 'unit') {
    const def = A.mapping.unitDef(opts.civ || 'greek', type);
    if (def && def.icon >= 0) src = A.assets.icon(UNIT_ICON_SLP, def.icon, color);
  } else if (kind === 'building') {
    const b = A.mapping.building(opts.civ || 'greek', type, opts.age ?? 1);
    if (b && b.unit.icon >= 0) src = A.assets.icon(A.mapping.buildingIconSlp(opts.civ || 'greek'), b.unit.icon, color);
  } else if (kind === 'tech') {
    const ic = A.mapping.techIcon(type);
    if (ic >= 0) src = A.assets.icon(TECH_ICON_SLP, ic, color);
  } else if (kind === 'res' || kind === 'tree') {
    const def = A.mapping.gaia().units[{ tree: 141, gold_mine: 66, stone_mine: 102, berry_bush: 59, carcass: 65 }[type] ?? -1];
    if (def && def.icon >= 0) src = A.assets.icon(UNIT_ICON_SLP, def.icon, 0);
  }
  let out = null;
  if (src) {
    out = document.createElement('canvas');
    const ss = 2;
    out.width = size * ss; out.height = size * ss;
    const g = out.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, out.width, out.height);
  }
  iconMemo.set(key, out);
  if (iconMemo.size > 600) iconMemo.delete(iconMemo.keys().next().value);
  return out;
}
export function clearAoeIconMemo() { iconMemo.clear(); }
