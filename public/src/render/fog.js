// Fog of war for the local player (client side only; the simulation itself
// doesn't need it). Black = unexplored, dark = explored but not in sight.
const circles = new Map();
function circle(r) {
  const k = Math.round(r * 2) / 2;
  let c = circles.get(k);
  if (!c) {
    c = [];
    const R = Math.ceil(k);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= k * k + 0.5) c.push(dx, dy);
    circles.set(k, c);
  }
  return c;
}

export class Fog {
  constructor(world, playerId, spectator) {
    this.world = world;
    this.pid = playerId;
    this.spectator = !!spectator;
    const n = world.map.w * world.map.h;
    this.visible = new Uint8Array(n);
    this.explored = new Uint8Array(n);
    this.all = spectator || world.settings.reveal;
    if (world.settings.reveal) this.explored.fill(1);
    this.version = 0;
  }
  observers() {
    const w = this.world;
    const list = [];
    for (const p of w.realPlayers()) {
      if (p.id === this.pid) list.push(p);
      else if (w.isAlly(p.id, this.pid) && (p.flags.has('sharedLos') || w.settings.teamVision)) list.push(p);
    }
    return list;
  }
  update() {
    const w = this.world, map = w.map, W = map.w, H = map.h;
    const me = w.players[this.pid];
    if (this.spectator || (me && (me.flags.has('cheat:nofog')))) { this.visible.fill(1); this.explored.fill(1); this.version++; return; }
    if (me && me.flags.has('cheat:reveal')) this.explored.fill(1);
    this.visible.fill(0);
    const stamp = (x, y, r) => {
      const c = circle(r);
      const cx = Math.floor(x), cy = Math.floor(y);
      for (let i = 0; i < c.length; i += 2) {
        const tx = cx + c[i], ty = cy + c[i + 1];
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        const k = ty * W + tx;
        this.visible[k] = 1; this.explored[k] = 1;
      }
    };
    for (const p of this.observers()) {
      for (const u of p.units) stamp(u.x, u.y, u.stats.los + 0.5);
      for (const b of p.buildings) stamp(b.x, b.y, (b.built ? b.stats.los : 2) + b.size / 2);
    }
    this.version++;
  }
  vis(x, y) {
    if (this.spectator) return true;
    const map = this.world.map;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
    return this.visible[ty * map.w + tx] === 1;
  }
  exp(x, y) {
    if (this.spectator) return true;
    const map = this.world.map;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
    return this.explored[ty * map.w + tx] === 1;
  }
  // Is an object shown at (x, y)? Like the original (fog visibility of the
  // unit types, 00451FD0): everything in sight; on explored tiles out of
  // sight only wild animals, resources, carcasses, cliffs and the wonder
  // ("always visible") and trees while standing ("visible if alive") — not
  // player units nor buildings, which vanish into the fog.
  shows(e, x, y, pid) {
    if (this.spectator || (e.owner === pid && e.owner)) return true;
    if (this.vis(x, y)) return true;
    if (!this.exp(x, y)) return false;
    if (e.kind === 'unit') return !e.owner;
    if (e.kind === 'building') return e.type === 'wonder';
    if (e.kind === 'resource' && e.type === 'tree') return !e.felled;
    return true;
  }
  // any tile of a footprint visible?
  rectVis(tx, ty, s) {
    if (this.spectator) return true;
    const W = this.world.map.w;
    for (let y = ty; y < ty + s; y++) for (let x = tx; x < tx + s; x++) if (this.visible[y * W + x]) return true;
    return false;
  }
  rectExp(tx, ty, s) {
    if (this.spectator) return true;
    const W = this.world.map.w;
    for (let y = ty; y < ty + s; y++) for (let x = tx; x < tx + s; x++) if (this.explored[y * W + x]) return true;
    return false;
  }
  exploredPct() {
    let n = 0;
    for (let i = 0; i < this.explored.length; i++) n += this.explored[i];
    return n / this.explored.length;
  }
}
