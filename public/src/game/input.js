// Mouse & keyboard: selection (AoE1's 25-unit limit), smart right-click,
// building placement, control groups, camera scrolling and hotkeys.
import { BUILDINGS } from '../engine/data/buildings.js';
import { UNITS } from '../engine/data/units.js';
import { GAIA } from '../engine/constants.js';
import { actualBuildType } from '../engine/production.js';
import { HW, HH } from '../render/iso.js';

const MAX_SELECT = 25;

export class Input {
  constructor(session, canvas) {
    this.s = session;
    this.canvas = canvas;
    this.mouse = { x: 0, y: 0, inside: false };
    this.drag = null;
    this.keys = new Set();
    this.groups = new Map();
    this.lastClick = { t: 0, id: 0 };
    this.lastGroup = { k: '', t: 0 };
    this.target = null; // 'repair'|'convert'|'heal'|'attack'
    this.bind();
  }

  bind() {
    const c = this.canvas;
    this.onMouseDown = (e) => this.mouseDown(e);
    this.onMouseMove = (e) => this.mouseMove(e);
    this.onMouseUp = (e) => this.mouseUp(e);
    this.onKeyDown = (e) => this.keyDown(e);
    this.onKeyUp = (e) => this.keys.delete(e.key);
    this.onWheel = (e) => this.wheel(e);
    this.onCtx = (e) => e.preventDefault();
    this.onLeave = () => { this.mouse.inside = false; };
    this.onEnter = () => { this.mouse.inside = true; };
    c.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onCtx);
    document.addEventListener('mouseleave', this.onLeave);
    document.addEventListener('mouseenter', this.onEnter);
  }
  unbind() {
    const c = this.canvas;
    c.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onCtx);
    document.removeEventListener('mouseleave', this.onLeave);
    document.removeEventListener('mouseenter', this.onEnter);
  }

  get r() { return this.s.renderer; }
  get w() { return this.s.world; }

  localPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ------------------------------------------------------------ selection
  select(list, add) {
    const sel = this.r.selection;
    if (!add) sel.clear();
    for (const e of list) { if (sel.size >= MAX_SELECT) break; sel.add(e.id); }
    this.s.hud.mode = 'main';
    this.s.onSelectionChanged();
  }
  selectOnly(e) { this.select([e], false); }
  toggle(e) {
    const sel = this.r.selection;
    if (sel.has(e.id)) sel.delete(e.id);
    else if (sel.size < MAX_SELECT) sel.add(e.id);
    this.s.onSelectionChanged();
  }
  selectIdleVillager() {
    const p = this.w.players[this.s.pid];
    if (!p) return;
    const idle = [...p.units].filter((u) => u.type === 'villager' && !u.order);
    if (!idle.length) { this.s.toast('Không có dân rảnh'); return; }
    this._idleIdx = ((this._idleIdx || 0) + 1) % idle.length;
    const u = idle[this._idleIdx];
    this.selectOnly(u);
    this.r.cam.centerOn(u.x, u.y, this.w.map.heightAt(u.x, u.y));
  }
  selectTownCenter() {
    const p = this.w.players[this.s.pid];
    if (!p) return;
    const tcs = [...p.buildings].filter((b) => b.type === 'town_center');
    if (!tcs.length) return;
    this._tcIdx = ((this._tcIdx || 0) + 1) % tcs.length;
    const tc = tcs[this._tcIdx];
    this.selectOnly(tc);
    this.r.cam.centerOn(tc.x, tc.y, this.w.map.heightAt(tc.x, tc.y));
  }
  deleteSelection() {
    const ids = [...this.r.selection].filter((id) => { const e = this.w.alive(id); return e && e.owner === this.s.pid; });
    if (ids.length) this.s.issue({ type: 'delete', ids });
  }

  // -------------------------------------------------------------- placement
  startPlacement(btype) {
    this.cancelModes();
    this.r.placement = { type: btype, tx: 0, ty: 0, ok: false };
    this.updatePlacement();
  }
  startTargetMode(kind) {
    this.cancelModes();
    this.target = kind;
    this.setCursor('target');
  }
  cancelModes() {
    this.r.placement = null;
    this.wallStart = null;
    this.target = null;
    this.setCursor('normal');
  }
  // the original mouse pointers (null: browser cursors)
  setCursors(set) { this.cursors = set; this.setCursor(this.target ? 'target' : 'normal'); }
  setCursor(kind) {
    const c = this.cursors && this.cursors[kind];
    const css = c || (kind === 'target' ? 'crosshair' : '');
    if (this.cursorKind !== css) { this.cursorKind = css; this.canvas.style.cursor = css; }
  }
  updatePlacement() {
    const pl = this.r.placement;
    if (!pl) return;
    const def = BUILDINGS[pl.type];
    const wpt = this.r.cam.unproject(this.mouse.x, this.mouse.y, this.w.map);
    pl.tx = Math.round(wpt.x - def.size / 2);
    pl.ty = Math.round(wpt.y - def.size / 2);
    const p = this.w.players[this.s.pid];
    const real = actualBuildType(p, pl.type);
    pl.ok = !this.w.placementError(p, real, pl.tx, pl.ty) && this.s.isExplored(pl.tx, pl.ty, def.size);
  }

  // ------------------------------------------------------------------ mouse
  mouseDown(e) {
    if (this.s.hud.chatOpen()) this.s.hud.closeChat();
    const m = this.localPos(e);
    this.mouse.x = m.x; this.mouse.y = m.y;
    this.s.sfx.ensure();
    if (e.button === 0) {
      if (this.r.placement) { this.placeBuilding(e.shiftKey); return; }
      if (this.target) { this.targetClick(m); return; }
      this.drag = { x0: m.x, y0: m.y, x1: m.x, y1: m.y, shift: e.shiftKey, ctrl: e.ctrlKey };
    } else if (e.button === 2) {
      if (this.r.placement || this.target) { this.cancelModes(); return; }
      this.rightClick(m, e);
    } else if (e.button === 1) {
      this.pan = { x: m.x, y: m.y, cx: this.r.cam.x, cy: this.r.cam.y };
      e.preventDefault();
    }
  }
  mouseMove(e) {
    const m = this.localPos(e);
    this.mouse.x = m.x; this.mouse.y = m.y;
    this.mouse.inside = m.x >= 0 && m.y >= 0 && m.x < this.r.cam.w && m.y < this.r.cam.h;
    if (this.drag) {
      this.drag.x1 = m.x; this.drag.y1 = m.y;
      if (Math.abs(this.drag.x1 - this.drag.x0) + Math.abs(this.drag.y1 - this.drag.y0) > 6) this.r.dragBox = this.drag;
    }
    if (this.pan) {
      const z = this.r.cam.zoom;
      this.r.cam.x = this.pan.cx - (m.x - this.pan.x) / z;
      this.r.cam.y = this.pan.cy - (m.y - this.pan.y) / z;
    }
    if (this.r.placement) this.updatePlacement();
    else if (this.cursors && !this.target && this.mouse.inside) this.hoverCursor();
  }
  // AoE pointer over the map: sword on enemies, hand for villager work
  hoverCursor() {
    const now = performance.now();
    if (now - (this.hoverAt || 0) < 60) return;
    this.hoverAt = now;
    const t = this.r.pick(this.mouse.x, this.mouse.y);
    let kind = 'normal';
    if (t) {
      const sel = [...this.r.selection].map((id) => this.w.alive(id)).filter((e) => e && e.owner === this.s.pid && e.kind === 'unit');
      const enemy = t.owner !== GAIA && t.owner !== this.s.pid && this.w.isEnemy(this.s.pid, t.owner);
      if (enemy && sel.some((u) => u.stats.hasAtk || u.type === 'priest')) kind = 'attack';
      else if (sel.some((u) => u.type === 'villager') && (this.w.resKindOf(t) || (t.kind === 'building' && t.owner === this.s.pid && (!t.built || t.hp < t.stats.hp)))) kind = 'work';
    }
    this.setCursor(kind);
  }
  mouseUp(e) {
    if (e.button === 1) { this.pan = null; return; }
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.r.dragBox = null;
    const box = Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0) > 6;
    if (box) {
      const list = this.r.unitsInBox(d.x0, d.y0, d.x1, d.y1, this.s.pid);
      if (list.length) {
        // prefer military when mixed? AoE1 selects everything in the box
        this.select(list, d.shift);
        this.s.sfx.entity('select', list.find((u) => u.type !== 'villager') || list[0], this.s.world);
      } else if (!d.shift) this.select([], false);
      return;
    }
    const ent = this.r.pick(d.x0, d.y0);
    if (!ent) { if (!d.shift) this.select([], false); return; }
    const now = performance.now();
    const own = ent.owner === this.s.pid;
    if (own && ent.kind === 'unit' && now - this.lastClick.t < 350 && this.lastClick.id === ent.id) {
      // double click: all of this type on screen
      const all = this.r.drawn.filter((it) => it.e.kind === 'unit' && it.e.owner === this.s.pid && it.e.type === ent.type).map((it) => it.e);
      this.select(all, d.shift);
    } else if (own && ent.kind === 'unit' && d.shift) this.toggle(ent);
    else this.select([ent], false);
    this.lastClick = { t: now, id: ent.id };
    if (own) this.s.sfx.entity('select', ent, this.s.world);
  }
  wheel(e) {
    e.preventDefault();
    const cam = this.r.cam;
    const before = { x: cam.ix(this.mouse.x), y: cam.iy(this.mouse.y) };
    // steps of 10% that lead back to exactly 1, where the picture is crisp
    const k = Math.round(Math.log(cam.zoom) / Math.log(1.1)) + (e.deltaY > 0 ? -1 : 1);
    cam.zoom = 1.1 ** Math.max(-8, Math.min(6, k));
    cam.x = before.x - (this.mouse.x - cam.w / 2) / cam.zoom;
    cam.y = before.y - (this.mouse.y - cam.h / 2) / cam.zoom;
  }

  ownSelectedUnits() {
    const out = [];
    for (const id of this.r.selection) { const e = this.w.alive(id); if (e && e.kind === 'unit' && e.owner === this.s.pid) out.push(e); }
    return out;
  }
  ownSelectedBuildings() {
    const out = [];
    for (const id of this.r.selection) { const e = this.w.alive(id); if (e && e.kind === 'building' && e.owner === this.s.pid) out.push(e); }
    return out;
  }

  rightClick(m, ev) {
    const s = this.s, w = this.w;
    const units = this.ownSelectedUnits();
    const blds = this.ownSelectedBuildings();
    const wpt = this.r.cam.unproject(m.x, m.y, w.map);
    const target = this.r.pick(m.x, m.y);
    if (!units.length) {
      if (blds.length) {
        // rally point
        const tgt = target && (target.kind === 'resource' || (target.kind === 'building' && target.owner === s.pid)) ? target.id : 0;
        s.issue({ type: 'rally', bids: blds.map((b) => b.id), x: wpt.x, y: wpt.y, target: tgt });
        this.r.addMarker(wpt.x, wpt.y, 'move');
      }
      return;
    }
    const ids = units.map((u) => u.id);
    const vills = units.filter((u) => u.type === 'villager');
    const priests = units.filter((u) => u.type === 'priest');
    if (target && target.kind !== 'unit' || target && target.owner !== s.pid) {
      const t = target;
      const enemy = t.owner !== GAIA && w.isEnemy(s.pid, t.owner);
      if (enemy) {
        if (ev.ctrlKey || true) {
          const atk = units.filter((u) => u.type !== 'priest');
          if (atk.length) s.issue({ type: 'attack', ids: atk.map((u) => u.id), target: t.id });
          if (priests.length) s.issue({ type: 'convert', ids: priests.map((u) => u.id), target: t.id });
        }
        this.r.addMarker(t.x, t.y, 'attack');
        s.sfx.entity('attack', units[0], w);
        return;
      }
      if (t.kind === 'resource' || (t.kind === 'unit' && t.owner === GAIA)) {
        if (vills.length) s.issue({ type: 'gather', ids: vills.map((u) => u.id), target: t.id });
        const rest = units.filter((u) => u.type !== 'villager');
        if (rest.length) {
          if (t.kind === 'unit' && t.owner === GAIA && UNITS[t.type].atk) s.issue({ type: 'attack', ids: rest.map((u) => u.id), target: t.id, force: true });
          else s.issue({ type: 'move', ids: rest.map((u) => u.id), x: wpt.x, y: wpt.y });
        }
        this.r.addMarker(t.x, t.y, 'move');
        s.sfx.entity('move', units[0], w);
        return;
      }
      if (t.kind === 'building' && w.isAlly(s.pid, t.owner)) {
        if (vills.length) {
          if (t.type === 'farm' && t.built && t.owner === s.pid) s.issue({ type: 'gather', ids: vills.map((u) => u.id), target: t.id });
          else if (!t.built || t.hp < t.stats.hp) s.issue({ type: 'repair', ids: vills.map((u) => u.id), target: t.id });
          else s.issue({ type: 'move', ids: vills.map((u) => u.id), x: wpt.x, y: wpt.y });
        }
        const rest = units.filter((u) => u.type !== 'villager');
        if (rest.length) s.issue({ type: 'move', ids: rest.map((u) => u.id), x: wpt.x, y: wpt.y });
        this.r.addMarker(wpt.x, wpt.y, 'move');
        s.sfx.entity('move', units[0], w);
        return;
      }
    }
    if (target && target.kind === 'unit' && target.owner === s.pid && priests.length && target.hp < target.stats.hp) {
      s.issue({ type: 'heal', ids: priests.map((u) => u.id), target: target.id });
      const rest = units.filter((u) => u.type !== 'priest');
      if (rest.length) s.issue({ type: 'move', ids: rest.map((u) => u.id), x: wpt.x, y: wpt.y });
      return;
    }
    s.issue({ type: 'move', ids, x: wpt.x, y: wpt.y });
    this.r.addMarker(wpt.x, wpt.y, 'move');
    s.sfx.entity('move', units[0], w);
  }

  targetClick(m) {
    const kind = this.target;
    this.cancelModes();
    const t = this.r.pick(m.x, m.y);
    const units = this.ownSelectedUnits();
    if (!t || !units.length) return;
    const ids = units.map((u) => u.id);
    if (kind === 'repair') this.s.issue({ type: 'repair', ids, target: t.id });
    else if (kind === 'convert') this.s.issue({ type: 'convert', ids, target: t.id });
    else if (kind === 'heal') this.s.issue({ type: 'heal', ids, target: t.id });
    else if (kind === 'attack') this.s.issue({ type: 'attack', ids, target: t.id, force: true });
    this.r.addMarker(t.x, t.y, kind === 'heal' || kind === 'repair' ? 'move' : 'attack');
  }

  placeBuilding(keep) {
    const pl = this.r.placement;
    const vills = this.ownSelectedUnits().filter((u) => u.type === 'villager');
    if (!pl) return;
    if (!pl.ok) { this.s.sfx.play('error'); return; }
    if (pl.type === 'small_wall') {
      // walls: first click = start, second = end
      if (!this.wallStart) { this.wallStart = { x: pl.tx, y: pl.ty }; return; }
      this.s.issue({ type: 'buildWall', ids: vills.map((u) => u.id), x0: this.wallStart.x, y0: this.wallStart.y, x1: pl.tx, y1: pl.ty });
      this.wallStart = null;
    } else {
      this.s.issue({ type: 'build', btype: pl.type, tx: pl.tx, ty: pl.ty, ids: vills.map((u) => u.id) });
    }
    this.s.sfx.play('build');
    if (!keep) { this.cancelModes(); this.s.hud.mode = 'main'; }
  }

  // ---------------------------------------------------------------- keys
  keyDown(e) {
    const s = this.s;
    if (s.hud.chatOpen()) return;
    if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    const k = e.key;
    this.keys.add(k);
    if (k === 'Enter') { e.preventDefault(); s.hud.openChat(e.shiftKey ? 'team' : 'all'); return; }
    if (k === 'F3' || k === 'Pause') { e.preventDefault(); s.togglePause(); return; }
    if (k === 'F10' || (k === 'Escape' && !this.r.placement && !this.target && s.hud.mode === 'main' && !this.r.selection.size)) { e.preventDefault(); s.hud.toggleMenu(); return; }
    if (k === 'Escape') {
      if (this.r.placement || this.target) { this.cancelModes(); return; }
      if (s.hud.mode !== 'main') { s.hud.mode = 'main'; return; }
      if (s.hud.hotkey('Escape', e)) return;
      this.select([], false);
      return;
    }
    if (k === 'Delete') { if (!s.hud.hotkey('Delete', e)) this.deleteSelection(); return; }
    if (k === '+' || k === '=') { s.changeSpeed(1); return; }
    if (k === '-' || k === '_') { s.changeSpeed(-1); return; }
    if (k === ' ') { e.preventDefault(); this.centerSelection(); return; }
    // control groups
    if (/^[0-9]$/.test(k)) {
      e.preventDefault();
      if (e.ctrlKey) { this.groups.set(k, [...this.r.selection]); s.toast(`Đã gán nhóm ${k}`); return; }
      const g = (this.groups.get(k) || []).map((id) => this.w.alive(id)).filter(Boolean);
      if (!g.length) return;
      const now = performance.now();
      this.select(g, e.shiftKey);
      if (this.lastGroup.k === k && now - this.lastGroup.t < 400) this.centerSelection();
      this.lastGroup = { k, t: now };
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (k.length === 1) {
      const up = k.toUpperCase();
      if (s.hud.hotkey(up, e)) { e.preventDefault(); return; }
      if (up === 'H') { this.selectTownCenter(); return; }
      if (k === '.' || k === ',') { this.selectIdleVillager(); return; }
    }
  }

  centerSelection() {
    const ents = [...this.r.selection].map((id) => this.w.alive(id)).filter(Boolean);
    if (!ents.length) return;
    let x = 0, y = 0;
    for (const e of ents) { x += e.x; y += e.y; }
    x /= ents.length; y /= ents.length;
    this.r.cam.centerOn(x, y, this.w.map.heightAt(x, y));
  }

  // per frame: camera scrolling
  update(dt) {
    const cam = this.r.cam;
    const sp = 900 * dt / cam.zoom;
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= sp;
    if (this.keys.has('ArrowRight')) dx += sp;
    if (this.keys.has('ArrowUp')) dy -= sp;
    if (this.keys.has('ArrowDown')) dy += sp;
    if (this.mouse.inside && !this.drag && document.hasFocus() && this.s.edgeScroll) {
      const m = 6;
      if (this.mouse.x < m) dx -= sp; if (this.mouse.x > cam.w - m) dx += sp;
      if (this.mouse.y < m) dy -= sp; if (this.mouse.y > cam.h - m) dy += sp;
    }
    if (dx || dy) { cam.x += dx; cam.y += dy; cam.clamp(this.w.map); if (this.r.placement) this.updatePlacement(); }
  }
}
export { HW, HH };
