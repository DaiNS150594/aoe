// A running game: deterministic World + lockstep turn stream (from the server,
// or generated locally in single player) + renderer, HUD, input and audio.
import { World } from '../engine/world.js';
import { TERRAIN } from '../engine/map.js';
import { TICK_MS, TICKS_PER_TURN, SPEEDS, GAIA } from '../engine/constants.js';
import { UNITS } from '../engine/data/units.js';
import { TECHS } from '../engine/data/techs.js';
import { applyCheatCheck } from './cheatcheck.js';
import { Renderer } from '../render/renderer.js';
import { Minimap } from '../render/minimap.js';
import { Hud } from '../ui/hud.js';
import { Input } from './input.js';
import { Sfx } from '../audio/sfx.js';

export class GameSession {
  constructor(app, opts) {
    this.app = app;
    this.net = opts.net || null;
    this.settings = opts.settings;
    this.pid = opts.playerId;
    this.spectator = !!opts.spectator || !this.pid;
    this.replay = opts.replay || null;
    this.speed = opts.settings.speed || 2;
    this.turns = new Map();     // n -> commands [[pid, cmd]...]
    this.lastTurn = -1;
    this.pending = [];          // single player: commands for the next turn
    this.record = [];           // replay log
    this.paused = false;
    this.netPaused = false;
    this.waiting = false;
    this.acc = 0;
    this.ended = false;
    this.edgeScroll = true;
    this.sfx = app.sfx || new Sfx();
    this.root = opts.root;
    if (this.replay) {
      this.spectator = true;
      for (const [n, cmds] of this.replay.turns || []) this.turns.set(n, cmds);
    }
  }

  start() {
    const root = this.root;
    root.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view';
    root.appendChild(this.canvas);
    const hudRoot = document.createElement('div');
    hudRoot.className = 'hud';
    root.appendChild(hudRoot);

    const t0 = performance.now();
    this.world = new World(this.settings);
    console.log(`World created in ${(performance.now() - t0).toFixed(0)} ms`, this.world.settings);
    this.renderer = new Renderer(this.canvas, this.world, this.pid, { spectator: this.spectator });
    this.hud = new Hud(hudRoot, this);
    this.minimap = new Minimap(this.hud.miniCanvas, this.world);
    this.input = new Input(this, this.canvas);
    this.hud.applySkin();
    if (this.app.music) this.app.music.start('game');
    this.bindMinimap();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
    // camera on our town center
    const st = this.world.starts[this.pid] || Object.values(this.world.starts)[0];
    if (st) this.renderer.cam.centerOn(st.x + 0.5, st.y + 2.5, this.world.map.heightAt(st.x, st.y));
    this.renderer.fog.update();
    // welcome banner
    const me = this.spectator ? null : this.world.players[this.pid];
    if (me) {
      this.hud.showBanner(`${me.civ.vi} — ${this.world.settings.rules.toUpperCase()}`, 4000, me.color.light);
      this.hud.message(`Bạn chơi phe ${me.civ.vi} (${me.civ.name}). Kiến trúc: ${me.civ.arch}. Đặc điểm: ${(me.civ.desc || []).join('; ')}`, '#ffe8a0');
    }
    for (const p of this.world.realPlayers()) {
      if (p.id !== this.pid || this.spectator) this.hud.message(`${p.name}: ${p.civ.vi}${p.team ? ' — đội ' + p.team : ''}`, p.color.light);
    }
    if (this.net) this.bindNet();
    this.last = performance.now();
    this.running = true;
    this.frame = (t) => this.loop(t);
    requestAnimationFrame(this.frame);
  }

  bindMinimap() {
    const mc = this.hud.miniCanvas;
    const go = (e) => {
      const r = mc.getBoundingClientRect();
      const px = (e.clientX - r.left) * (mc.width / r.width), py = (e.clientY - r.top) * (mc.height / r.height);
      const t = this.minimap.fromMini(px, py);
      if (e.buttons === 2 || e.button === 2) {
        const units = this.input.ownSelectedUnits();
        if (units.length) { this.issue({ type: 'move', ids: units.map((u) => u.id), x: t.x, y: t.y }); this.renderer.addMarker(t.x, t.y, 'move'); }
        return;
      }
      this.renderer.cam.centerOn(t.x, t.y, this.world.map.heightAt(Math.max(0, Math.min(this.world.map.w - 1, t.x)), Math.max(0, Math.min(this.world.map.h - 1, t.y))));
    };
    mc.addEventListener('mousedown', (e) => { e.preventDefault(); go(e); this.miniDrag = e.button === 0; });
    mc.addEventListener('mousemove', (e) => { if (this.miniDrag && e.buttons & 1) go(e); });
    window.addEventListener('mouseup', () => { this.miniDrag = false; });
    mc.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindNet() {
    const n = this.net;
    n.on('turn', (m) => this.receiveTurn(m.n, m.c));
    n.on('catchup', (m) => { for (const t of m.turns) this.receiveTurn(t.n, t.c); this.catchingUp = true; });
    n.on('chat', (m) => {
      if (m.sys) { this.hud.message(m.text, '#ffe070'); return; }
      const col = (this.world.players.find((p) => p && p.name === m.from) || {}).color;
      this.hud.message(m.text, col ? col.light : '#fff', { from: m.from, team: m.scope === 'team' });
      if (!this.playTaunt(m.text)) this.sfx.play('chat');
    });
    n.on('paused', (m) => { this.netPaused = m.on; this.hud.message(m.on ? `${m.by} đã tạm dừng trận đấu (F3)` : `${m.by} đã tiếp tục trận đấu`, '#ffe070'); });
    n.on('wait', (m) => { this.waitServer = m.on; });
    n.on('desync', (m) => { this.hud.message(`⚠ Mất đồng bộ (desync) tại lượt ${m.n}! Trận đấu có thể sai lệch.`, '#ff6060'); });
    n.on('dropped', (m) => this.hud.message(`${m.name} đã mất kết nối.`, '#ff9060'));
    n.on('close', () => { if (!this.ended) this.hud.message('Mất kết nối tới máy chủ!', '#ff5050'); });
    n.on('room', () => {});
  }

  receiveTurn(n, cmds) {
    this.turns.set(n, cmds || []);
    if (n > this.lastTurn) this.lastTurn = n;
  }

  // ------------------------------------------------------------ commands
  issue(cmd) {
    if (this.spectator || this.ended) return;
    if (this.net) this.net.send({ t: 'cmd', c: cmd });
    else this.pending.push([this.pid, cmd]);
  }

  sendChat(text, scope) {
    if (this.world.settings.cheats && applyCheatCheck(text)) {
      this.issue({ type: 'cheat', code: text });
      return;
    }
    if (this.net) this.net.send({ t: 'chat', text, scope });
    else {
      const me = this.world.players[this.pid];
      this.hud.message(text, me ? me.color.light : '#fff', { from: me ? me.name : 'Bạn' });
      this.playTaunt(text);
    }
  }

  // AoE-style taunt: a chat message that is just a number plays tauntNNN.wav
  playTaunt(text) {
    const m = /^\s*(\d{1,3})\s*$/.exec(String(text || ''));
    return m ? this.sfx.taunt(Number(m[1])) : false;
  }

  toast(text) { this.hud.message(text, '#ffb080'); this.sfx.play('error'); }

  togglePause() {
    if (this.net) { this.net.send({ t: 'pause', on: !this.netPaused }); return; }
    this.paused = !this.paused;
  }
  changeSpeed(d) {
    if (this.net) { this.toast('Không đổi được tốc độ khi chơi mạng'); return; }
    let i = SPEEDS.indexOf(this.speed);
    if (i < 0) i = 2;
    i = Math.max(0, Math.min(SPEEDS.length - 1, i + d));
    this.speed = SPEEDS[i];
    this.hud.message(`Tốc độ ×${this.speed}`, '#ffe070');
  }
  cycleSpeed() { const i = SPEEDS.indexOf(this.speed); this.speed = SPEEDS[(i + 1) % SPEEDS.length]; }
  get speedLabel() { return !this.net; }

  selectedEntities() {
    const out = [];
    for (const id of this.renderer.selection) {
      const e = this.world.alive(id);
      if (e) out.push(e);
      else this.renderer.selection.delete(id);
    }
    return out;
  }
  onSelectionChanged() { this.hud.cmdSig = ''; this.hud.infoSig = ''; }
  isExplored(tx, ty, size) { return this.renderer.fog.rectExp(Math.max(0, tx), Math.max(0, ty), size) || this.spectator; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.resize(w, h);
  }

  // ---------------------------------------------------------------- loop
  loop(now) {
    if (!this.running) return;
    const dt = Math.min(250, now - this.last);
    this.last = now;
    const w = this.world;
    const paused = this.paused || this.netPaused;
    if (!paused && !this.ended) this.acc += dt * this.speed;
    // multiplayer catch-up: if many turns are buffered, simulate faster
    if (this.net) {
      const behind = (this.lastTurn + 1) * TICKS_PER_TURN - w.tick;
      if (behind > 8) this.acc += Math.min(behind - 4, 40) * TICK_MS;
    }
    const budgetEnd = performance.now() + (this.catchingUp ? 30 : 14);
    let steps = 0;
    this.waiting = false;
    while (this.acc >= TICK_MS && !w.over) {
      const T = w.tick;
      if (T % TICKS_PER_TURN === 0) {
        const n = T / TICKS_PER_TURN;
        let cmds = this.turns.get(n);
        if (!cmds) {
          if (this.net) { this.waiting = true; this.acc = Math.min(this.acc, TICK_MS * 2); break; }
          cmds = this.replay ? [] : this.pending; this.pending = [];
          this.turns.set(n, cmds);
        }
        if (n % 25 === 0) {
          const hv = w.hash();
          (this.hashLog || (this.hashLog = new Map())).set(n, hv);
          if (this.net) this.net.send({ t: 'hash', n, h: hv });
        }
        for (const [pid, c] of cmds) w.applyCommand(pid, c);
        if (cmds.length) this.record.push([n, cmds]);
        this.turns.delete(n - 50);
        if (this.net && n % 5 === 0) this.net.send({ t: 'ack', n });
      }
      w.step();
      this.handleEvents(w.events, now);
      this.acc -= TICK_MS;
      steps++;
      if (performance.now() > budgetEnd) { if (!this.net) this.acc = Math.min(this.acc, TICK_MS); break; }
    }
    if (this.catchingUp && (this.lastTurn + 1) * TICKS_PER_TURN - w.tick < 6) { this.catchingUp = false; this.hud.message('Đã đồng bộ lại trận đấu.', '#a0ffa0'); }
    const alpha = Math.max(0, Math.min(1, this.acc / TICK_MS));
    this.input.update(dt / 1000);
    this.renderer.draw(paused ? 1 : alpha, now);
    this.minimap.draw(this.renderer.fog, this.renderer.cam, this.pid, now);
    this.hud.update(now);
    if (!paused) this.ambientSound(now);
    if (paused) this.hud.center('TẠM DỪNG');
    else if (this.catchingUp) this.hud.center(`Đang đồng bộ lại... (${Math.floor(w.tick / TICKS_PER_TURN)}/${this.lastTurn})`);
    else if (this.waitServer) this.hud.center('Đang chờ người chơi khác...');
    else this.hud.center('');
    if (w.over && !this.ended) this.finish();
    requestAnimationFrame(this.frame);
  }

  // now and then, a sound of the land around the camera (birds, forest, desert wind...)
  ambientSound(now) {
    if (now < (this.nextAmbient || 0)) return;
    this.nextAmbient = now + 15000 + Math.random() * 25000;
    if (!this.nextAmbientStarted) { this.nextAmbientStarted = true; return; } // not right at the start
    const m = this.world.map, cam = this.renderer.cam;
    const c = cam.unproject(cam.w / 2, cam.h / 2, m);
    const n = new Array(32).fill(0);
    for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
      const tx = Math.floor(c.x) + x * 2, ty = Math.floor(c.y) + y * 2;
      if (m.inBounds(tx, ty)) n[m.terrain[ty * m.w + tx]]++;
    }
    const total = n.reduce((a, b) => a + b, 0) || 1;
    const water = n[TERRAIN.WATER] + n[TERRAIN.DEEP_WATER] + n[TERRAIN.SHALLOWS];
    const forest = n[TERRAIN.FOREST] + n[TERRAIN.PINE_FOREST] + n[TERRAIN.JUNGLE];
    const desert = n[TERRAIN.DESERT] + n[TERRAIN.PALM_DESERT] + n[TERRAIN.DIRT];
    const kind = water / total > 0.15 ? 'water' : forest / total > 0.2 ? 'forest' : desert / total > 0.35 ? 'desert' : 'grass';
    this.sfx.ambient(kind);
  }

  handleEvents(events, now) {
    const me = this.pid;
    const r = this.renderer;
    const cam = r.cam;
    const onScreen = (x, y) => {
      const p = r.proj(x, y);
      return p.x > -40 && p.x < cam.w + 40 && p.y > -40 && p.y < cam.h + 40 && r.fog.vis(x, y);
    };
    r.onEvents(events, now);
    for (const ev of events) {
      switch (ev.t) {
        case 'msg':
          if (ev.p === -1 || ev.p === me) this.hud.message(ev.text, ev.color);
          break;
        case 'sound':
          if (ev.p === me && (ev.s === 'error' || ev.s === 'needhouse')) this.sfx.play(ev.s);
          else if (ev.x !== undefined && onScreen(ev.x, ev.y)) this.sfx.play(ev.s, 0.7);
          break;
        case 'attacked':
          if (ev.p === me) {
            this.sfx.play('alert');
            this.minimap.ping(ev.x, ev.y, '#ff3030');
            this.lastAlert = { x: ev.x, y: ev.y };
            if (!this._alertMsg || now - this._alertMsg > 8000) { this._alertMsg = now; this.hud.message(ev.kind === 'building' ? 'Công trình đang bị tấn công!' : 'Quân ta đang bị tấn công!', '#ff7060'); }
          }
          break;
        case 'death':
          if (onScreen(ev.x, ev.y)) this.sfx.play(UNITS[ev.type] && UNITS[ev.type].cls.includes('animal') ? 'animal_death' : 'death', 0.8);
          break;
        case 'destroyed':
          if (ev.reason !== 'exhausted' && ev.reason !== 'cancel' && onScreen(ev.x, ev.y)) this.sfx.play('collapse');
          if (ev.owner === me && ev.reason === 'exhausted') this.hud.message('Ruộng đã cạn — cần trồng lại (BF).', '#ffd080');
          break;
        case 'impact':
          if (onScreen(ev.x, ev.y)) this.sfx.play('impact', 0.8);
          break;
        case 'built':
          if (ev.p === me) this.sfx.entity('built', this.world.alive(ev.id), this.world);
          break;
        case 'trained':
          if (ev.p === me) this.sfx.entity('train', this.world.alive(ev.id), this.world);
          break;
        case 'research':
          if (ev.p === me && !TECHS[ev.tech].advance) this.sfx.play('research');
          break;
        case 'age':
          if (ev.p === me) { this.sfx.play('ageup'); this.hud.showBanner(['', 'Đời 2 — Thời kỳ Công cụ', 'Đời 3 — Thời kỳ Đồ đồng', 'Đời 4 — Thời kỳ Đồ sắt'][ev.age], 4000, '#ffe080'); }
          break;
        case 'chant':
          if (onScreen(ev.x, ev.y) || ev.tp === me) this.sfx.play('chant');
          break;
        case 'converted':
          if (ev.from === me) { this.hud.message('Một đơn vị đã bị cải đạo!', '#ff9060'); this.sfx.play('converted'); this.renderer.selection.delete(ev.id); }
          else if (ev.to === me) this.sfx.play('converted');
          break;
        case 'treefall':
          if (onScreen(ev.x, ev.y)) this.sfx.play('tree', 0.5);
          break;
        case 'deposit':
          break;
        case 'defeat':
          if (ev.p === me) { this.sfx.play('defeat'); this.hud.showBanner('Bạn đã bị đánh bại!', 6000, '#ff6060'); }
          break;
        case 'cheat':
          break;
      }
    }
    // work sounds for visible villagers (sampled)
    if (this.world.tick % 5 === 0) {
      let played = 0;
      for (const it of r.drawn) {
        if (played > 1) break;
        const e = it.e;
        if (e.kind !== 'unit' || e.type !== 'villager' || (e.anim !== 'work' && e.anim !== 'build')) continue;
        if ((this.world.tick + e.id) % 15 !== 0) continue;
        const snd = e.anim === 'build' ? 'build' : e.task === 'woodcutter' ? 'chop' : (e.task === 'goldminer' || e.task === 'stoneminer') ? 'mine'
          : e.task === 'farmer' ? 'farm' : e.task === 'forager' ? 'forage' : e.task === 'hunter' ? 'skin' : null;
        if (snd) { this.sfx.play(snd, 0.45); played++; }
      }
    }
  }

  finish() {
    this.ended = true;
    const w = this.world;
    const me = this.spectator ? null : w.players[this.pid];
    const won = me && w.winners && w.winners.includes(this.pid);
    if (me) { this.sfx.play(won ? 'victory' : 'defeat'); this.hud.showBanner(won ? 'CHIẾN THẮNG!' : 'THẤT BẠI', 6000, won ? '#ffe060' : '#ff6060'); }
    else {
      const names = (w.winners || []).map((id) => w.players[id].name).join(', ');
      this.sfx.play('victory');
      this.hud.showBanner(names ? `${names} chiến thắng!` : 'Kết thúc trận đấu', 6000, '#ffe060');
    }
    if (this.net) this.net.send({ t: 'gameOver', winners: w.winners });
    if (this.app.music) this.app.music.start(won || !me ? 'won' : 'lost');
    setTimeout(() => this.app.showPostGame(this), 4500);
  }

  replayData() {
    return { v: 1, settings: { ...this.world.settings }, turns: this.record, ticks: this.world.tick };
  }

  quit() {
    this.running = false;
    this.input.unbind();
    this.hud.destroy();
    window.removeEventListener('resize', this.onResize);
    if (this.net) { this.net.send({ t: 'leaveGame' }); }
    this.app.backToMenu();
  }
  destroy() {
    this.running = false;
    if (this.input) this.input.unbind();
    if (this.hud) this.hud.destroy();
    window.removeEventListener('resize', this.onResize);
  }
}

export { GAIA };
