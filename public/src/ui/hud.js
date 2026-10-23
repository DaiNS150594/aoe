// In-game interface in the style of Age of Empires I: top resource bar,
// bottom panel with object info / command buttons / minimap, tooltips,
// message log, chat input, in-game menu, diplomacy & tribute.
import { UNITS, UNIT_LINES, isMilitary } from '../engine/data/units.js';
import { BUILDINGS, BUILD_MENU } from '../engine/data/buildings.js';
import { TECHS, BUILDING_TECHS } from '../engine/data/techs.js';
import { displayStats } from '../engine/player.js';
import { TS } from '../engine/techtree.js';
import { CIVS } from '../engine/data/civs.js';
import { trainError, researchError, buildError, AGE_NAMES, AGE_NAMES_EN } from '../engine/production.js';
import { iconCanvas as procIcon, shade } from '../render/sprites.js';
import { aoeIcon } from '../render/aoe-render.js';
import { aoe, AOE, setAoeEnabled, onAoeChange } from '../assets/loader.js';
import { UI } from '../assets/aoe.js';
import { CHEAT_LIST } from '../engine/cheats.js';
import { RULES } from '../engine/constants.js';

const RES_VI = { food: 'Thịt', wood: 'Gỗ', gold: 'Vàng', stone: 'Đá' };
const ARCH_INDEX = { egyptian: 0, greek: 1, babylonian: 2, asian: 3, roman: 4 };
// original stat icons (interfac.drs 50731) replacing the emoji of the info panel
// original command button pictures (interfac.drs 50721) per command
const CMD_FRAME = { build: 0, back: 1, repair: 2, stop: 3, attack: 12, del: 13, cancelq: 10, cancelb: 10 };
const STAT_FRAME = { '⚔': 7, '🛡': 8, '🎯': 10, '⏳': 9, '👥': 4, 'wood': 0, 'stone': 1, 'food': 2, 'gold': 3 };
const TASK_VI = { villager: 'Dân', builder: 'Thợ xây', forager: 'Hái lượm', hunter: 'Thợ săn', farmer: 'Nông dân', woodcutter: 'Tiều phu', goldminer: 'Đào vàng', stoneminer: 'Đào đá', repairer: 'Thợ sửa' };
const TASK_EN = { villager: 'Villager', builder: 'Builder', forager: 'Forager', hunter: 'Hunter', farmer: 'Farmer', woodcutter: 'Woodcutter', goldminer: 'Gold Miner', stoneminer: 'Stone Miner', repairer: 'Repairman' };
const RES_NAMES = { tree: ['Cây', 'Tree'], berry_bush: ['Bụi quả', 'Berry Bush'], gold_mine: ['Mỏ vàng', 'Gold Mine'], stone_mine: ['Mỏ đá', 'Stone Mine'], carcass: ['Thịt thú', 'Carcass'] };

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
export function fmtTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function resIcon(kind) {
  const c = document.createElement('canvas'); c.width = 22; c.height = 18;
  const g = c.getContext('2d');
  const E = (x, y, rx, ry, f, s) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = f; g.fill(); if (s) { g.strokeStyle = s; g.lineWidth = 0.8; g.stroke(); } };
  if (kind === 'wood') { g.fillStyle = '#7a4a1e'; g.fillRect(3, 6, 16, 4); g.fillRect(4, 11, 15, 4); E(19, 8, 2, 2, '#c8a060'); E(19, 13, 2, 2, '#c8a060'); }
  if (kind === 'food') { E(9, 10, 6, 5, '#b8302a', '#5a1010'); E(15, 7, 4, 4, '#d04a3a', '#5a1010'); g.fillStyle = '#f0e0d0'; g.fillRect(14, 11, 6, 2); }
  if (kind === 'gold') { E(7, 11, 4.5, 3.5, '#f0c838', '#7a5a08'); E(14, 12, 4.5, 3.5, '#e8b828', '#7a5a08'); E(11, 7, 4, 3, '#ffe060', '#7a5a08'); }
  if (kind === 'stone') { E(7, 11, 5, 4, '#a8a49a', '#4a4840'); E(15, 11, 5, 4, '#8f8b82', '#4a4840'); E(11, 7, 4, 3, '#bdb9ae', '#4a4840'); }
  if (kind === 'pop') { E(11, 5, 3, 3, '#e8c090'); g.fillStyle = '#3a6ad0'; g.fillRect(7, 9, 8, 7); }
  return c;
}

export class Hud {
  constructor(root, session) {
    this.root = root;
    this.s = session;
    this.cmdSig = '';
    this.infoSig = '';
    this.mode = 'main'; // or 'build'
    this.buttons = [];
    this.messages = [];
    this.build();
    this.applySkin();
    this.offSkin = onAoeChange(() => { this.applySkin(); this.infoSig = ''; this.cmdSig = ''; });
    this.onResize = () => this.applySkin();
    window.addEventListener('resize', this.onResize);
  }

  // The AoE HD interface pictures of the player's architecture, when the
  // original game data is loaded: bars, top buttons and the mouse pointer.
  applySkin() {
    const A = aoe();
    const w = this.s.world, p = w.players[this.s.pid] || w.realPlayers()[0];
    const skin = A && A.assets.hudSkin(ARCH_INDEX[p.civ.arch] ?? 1, window.innerWidth);
    const r = this.root;
    r.classList.toggle('orig', !!skin);
    if (!skin) { this.statUrls = null; this.s.input && this.s.input.setCursors(null); return; }
    r.style.setProperty('--hud-top', `url(${skin.top})`);
    r.style.setProperty('--hud-bottom', `url(${skin.bottom})`);
    r.style.setProperty('--hud-btn', `url(${skin.button[0]})`);
    r.style.setProperty('--hud-btn-down', `url(${skin.button[1]})`);
    r.style.setProperty('--hud-w', skin.width + 'px');
    r.style.setProperty('--hud-pop', `url(${A.assets.uiUrl(UI.STAT_ICONS, 4)})`);
    this.statUrls = {};
    for (const [k, fr] of Object.entries(STAT_FRAME)) this.statUrls[k] = A.assets.uiUrl(UI.STAT_ICONS, fr);
    this.hpUrls = Array.from({ length: 26 }, (_, i) => A.assets.uiUrl(UI.HP_BARS, i));
    if (this.s.input) this.s.input.setCursors({ normal: A.assets.cursor(0), attack: A.assets.cursor(4), work: A.assets.cursor(3), target: A.assets.cursor(5) });
  }
  statIcon(sym) {
    const u = this.statUrls && this.statUrls[sym];
    return u ? `<img class="si" src="${u}" alt="">` : sym;
  }
  destroy() { if (this.offSkin) this.offSkin(); window.removeEventListener('resize', this.onResize); }

  build() {
    const r = this.root;
    // top bar
    const top = el('div', 'hud-top');
    this.resEls = {};
    for (const k of ['wood', 'food', 'gold', 'stone']) {
      const box = el('div', 'res ' + k);
      box.appendChild(resIcon(k));
      const b = el('b', '', '0'); box.appendChild(b);
      box.title = RES_VI[k];
      this.resEls[k] = b; top.appendChild(box);
    }
    const popBox = el('div', 'res pop'); popBox.appendChild(resIcon('pop')); this.popEl = el('b', '', '0/0'); popBox.appendChild(this.popEl); popBox.title = 'Dân số'; top.appendChild(popBox);
    this.ageEl = el('div', 'age', '');
    top.appendChild(this.ageEl);
    this.clockEl = el('div', 'clock', '00:00');
    top.appendChild(this.clockEl);
    const btns = el('div', 'top-btns');
    this.btnDipl = el('button', 'stone-btn small', 'Ngoại giao'); this.btnDipl.onclick = () => this.toggleDiplomacy();
    this.btnMenu = el('button', 'stone-btn small', 'Menu (F10)'); this.btnMenu.onclick = () => this.toggleMenu();
    btns.append(this.btnDipl, this.btnMenu);
    top.appendChild(btns);
    r.appendChild(top);

    // bottom panel
    const bottom = el('div', 'hud-bottom');
    this.infoEl = el('div', 'hud-info');
    this.cmdEl = el('div', 'hud-cmds');
    const mini = el('div', 'hud-mini');
    this.miniCanvas = el('canvas', 'minimap');
    this.miniCanvas.width = 236; this.miniCanvas.height = 118;
    mini.appendChild(this.miniCanvas);
    const mb = el('div', 'mini-btns');
    const idle = el('button', 'stone-btn tiny', 'Dân rảnh (.)'); idle.onclick = () => this.s.input.selectIdleVillager();
    const tc = el('button', 'stone-btn tiny', 'Nhà chính (H)'); tc.onclick = () => this.s.input.selectTownCenter();
    const sc = el('button', 'stone-btn tiny', 'Điểm số'); sc.onclick = () => this.toggleScores();
    mb.append(idle, tc, sc);
    mini.appendChild(mb);
    bottom.append(this.infoEl, this.cmdEl, mini);
    r.appendChild(bottom);

    this.msgEl = el('div', 'hud-msgs'); r.appendChild(this.msgEl);
    this.centerEl = el('div', 'hud-center'); r.appendChild(this.centerEl);
    this.bannerEl = el('div', 'hud-banner'); r.appendChild(this.bannerEl);
    this.tipEl = el('div', 'hud-tip'); r.appendChild(this.tipEl);
    this.scoreEl = el('div', 'hud-scores hidden'); r.appendChild(this.scoreEl);

    // chat
    this.chatBox = el('div', 'hud-chat hidden');
    this.chatLabel = el('span', '', 'Gửi tất cả:');
    this.chatInput = el('input');
    this.chatInput.maxLength = 160;
    this.chatBox.append(this.chatLabel, this.chatInput);
    r.appendChild(this.chatBox);
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = this.chatInput.value.trim(); if (t) this.s.sendChat(t, this.chatScope); this.closeChat(); }
      if (e.key === 'Escape') this.closeChat();
    });

    // overlays
    this.menuEl = el('div', 'hud-overlay hidden'); r.appendChild(this.menuEl);
    this.diplEl = el('div', 'hud-overlay hidden'); r.appendChild(this.diplEl);
  }

  // ------------------------------------------------------------- per frame
  update(now) {
    const s = this.s, w = s.world, p = s.spectator ? null : w.players[s.pid];
    if (s.spectator && !this._specInit) {
      this._specInit = true;
      for (const k in this.resEls) this.resEls[k].parentElement.style.display = 'none';
      this.popEl.parentElement.style.display = 'none';
      this.ageEl.textContent = '👁 Chế độ xem trận';
    }
    if (p) {
      for (const k of ['wood', 'food', 'gold', 'stone']) {
        const v = Math.floor(p.res[k]);
        if (this.resEls[k]._v !== v) { this.resEls[k]._v = v; this.resEls[k].textContent = v; }
      }
      const pop = `${Math.ceil(p.pop + p.training - 1e-9)}/${p.popCap}`;
      if (this.popEl.textContent !== pop) this.popEl.textContent = pop;
      this.popEl.classList.toggle('warn', p.pop + p.training >= p.popCap);
      const age = `${AGE_NAMES[p.age]} — ${AGE_NAMES_EN[p.age]}`;
      if (this.ageEl.textContent !== age) this.ageEl.textContent = age;
    }
    const clk = fmtTime(w.gameSeconds()) + (s.speedLabel ? '  ×' + s.speed : '');
    if (this.clockEl.textContent !== clk) this.clockEl.textContent = clk;
    this.updateCommands();
    this.updateInfo();
    // messages fade
    const keep = [];
    for (const m of this.messages) {
      const age = now - m.t;
      if (age > 11000) { m.el.remove(); continue; }
      m.el.style.opacity = age > 9000 ? String(1 - (age - 9000) / 2000) : '1';
      keep.push(m);
    }
    this.messages = keep;
    if (this.banner && now > this.banner.until) { this.bannerEl.classList.remove('show'); this.banner = null; }
    if (!this.scoreEl.classList.contains('hidden') && (!this._sc || now - this._sc > 1000)) { this._sc = now; this.renderScores(); }
    if (s.spectator && (!this._spec || now - this._spec > 500)) { this._spec = now; this.renderSpectator(); }
  }

  // observer overlay: every player's economy at a glance (for streams / casters)
  renderSpectator() {
    const w = this.s.world;
    if (!this.specEl) { this.specEl = el('div', 'hud-spec'); this.root.appendChild(this.specEl); }
    const rows = w.realPlayers().map((p) => {
      let v = 0, m = 0;
      for (const u of p.units) { if (u.type === 'villager') v++; else m++; }
      return `<tr class="${p.alive ? '' : 'dead'}"><td><span class="swatch" style="background:${p.color.hex}"></span>${esc(p.name)}</td><td>${esc(p.civ.vi)}</td><td>${['I', 'II', 'III', 'IV'][p.age]}</td>` +
        `<td>${Math.floor(p.res.food)}</td><td>${Math.floor(p.res.wood)}</td><td>${Math.floor(p.res.gold)}</td><td>${Math.floor(p.res.stone)}</td>` +
        `<td>${v}</td><td>${m}</td><td>${Math.ceil(p.pop)}/${p.popCap}</td><td>${p.stats.killed}</td></tr>`;
    }).join('');
    this.specEl.innerHTML = `<table><tr><th>Người chơi</th><th>Phe</th><th>Đời</th><th>Thịt</th><th>Gỗ</th><th>Vàng</th><th>Đá</th><th>Dân</th><th>Lính</th><th>Dân số</th><th>Giết</th></tr>${rows}</table>`;
  }

  message(text, color, opts = {}) {
    const m = el('div', 'msg');
    if (opts.from) {
      m.innerHTML = `<b style="color:${color || '#fff'}">${esc(opts.from)}${opts.team ? ' (đồng đội)' : ''}:</b> ${esc(text)}`;
    } else {
      m.textContent = text;
      if (color) m.style.color = color;
    }
    this.msgEl.appendChild(m);
    this.messages.push({ el: m, t: performance.now() });
    while (this.messages.length > 8) { this.messages.shift().el.remove(); }
  }
  showBanner(text, ms = 3500, color) {
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = color || '';
    this.bannerEl.classList.add('show');
    this.banner = { until: performance.now() + ms };
  }
  center(text) {
    this.centerEl.textContent = text || '';
    this.centerEl.classList.toggle('show', !!text);
  }

  openChat(scope) {
    this.chatScope = scope || 'all';
    this.chatLabel.textContent = this.chatScope === 'team' ? 'Gửi đồng đội:' : 'Gửi tất cả:';
    this.chatBox.classList.remove('hidden');
    this.chatInput.value = '';
    setTimeout(() => this.chatInput.focus(), 0);
  }
  closeChat() { this.chatBox.classList.add('hidden'); this.chatInput.blur(); }
  chatOpen() { return !this.chatBox.classList.contains('hidden'); }

  // ----------------------------------------------------------- tooltips
  showTip(btn, ev) {
    const t = btn.tip;
    if (!t) return;
    let h = `<div class="tt-title">${esc(t.title)}${t.hotkey ? ` <span class="hk">(${esc(t.hotkey)})</span>` : ''}</div>`;
    if (t.en) h += `<div class="tt-en">${esc(t.en)}</div>`;
    if (t.cost) {
      h += '<div class="tt-cost">' + Object.entries(t.cost).filter(([, v]) => v > 0).map(([k, v]) => `<span class="c-${k}">${RES_VI[k]} ${v}</span>`).join(' ') + (t.time ? ` <span class="c-time">⏱ ${t.time}s</span>` : '') + '</div>';
    }
    if (t.desc) h += `<div class="tt-desc">${esc(t.desc)}</div>`;
    if (t.stats) h += `<div class="tt-stats">${t.stats}</div>`;
    if (t.err) h += `<div class="tt-err">${esc(t.err)}</div>`;
    this.tipEl.innerHTML = h;
    this.tipEl.classList.add('show');
    const rect = btn.el.getBoundingClientRect();
    const tr = this.tipEl.getBoundingClientRect();
    this.tipEl.style.left = Math.max(4, Math.min(window.innerWidth - tr.width - 4, rect.left)) + 'px';
    this.tipEl.style.top = Math.max(4, rect.top - tr.height - 6) + 'px';
  }
  hideTip() { this.tipEl.classList.remove('show'); }

  // ------------------------------------------------------------- commands
  computeButtons() {
    const s = this.s, w = s.world, p = w.players[s.pid];
    const sel = s.selectedEntities();
    const out = [];
    if (!p || !sel.length) return out;
    const own = sel.filter((e) => e.owner === s.pid);
    if (!own.length) return out;
    const first = own[0];
    if (first.kind === 'unit') {
      const vills = own.filter((u) => u.type === 'villager');
      if (vills.length && this.mode === 'build') {
        for (const bt of BUILD_MENU) {
          const def = BUILDINGS[bt];
          if (def.water || p.buildingDisabled(bt)) continue;
          const err = buildError(w, p, bt);
          const cost = p.buildingStats(bt).cost;
          const afford = p.canAfford(cost);
          if (err && /Cần lên/.test(err) && def.age > p.age + 1) continue;
          out.push({
            key: 'b:' + bt, icon: () => iconCanvas('building', bt, p.color, 40, { arch: p.civ.arch, tier: Math.max(1, Math.min(2, p.age)), size: def.size, civ: p.civId, age: p.age }),
            hotkey: def.hotkey, enabled: !err && afford,
            tip: { title: def.vi, en: def.name, cost, time: p.buildingStats(bt).time, desc: def.desc, hotkey: def.hotkey, err: err || (!afford ? 'Không đủ tài nguyên' : '') },
            onClick: () => { if (err) { s.toast(err); return; } s.input.startPlacement(bt); },
          });
        }
        out.push({ key: 'back', label: '⮌', hotkey: 'Escape', enabled: true, tip: { title: 'Quay lại', hotkey: 'Esc' }, onClick: () => { this.mode = 'main'; } });
        return out;
      }
      if (vills.length) {
        out.push({ key: 'build', label: '🔨', text: 'Xây', hotkey: 'B', enabled: true, tip: { title: 'Xây dựng', en: 'Build', hotkey: 'B', desc: 'Mở danh sách công trình. Người VN gọi theo phím tắt: BE (nhà), BB (nhà lính), BA (nhà cung), BL (chuồng ngựa), BM (chợ)...' }, onClick: () => { this.mode = 'build'; } });
        out.push({ key: 'repair', label: '🔧', text: 'Sửa', hotkey: 'R', enabled: true, tip: { title: 'Sửa chữa', en: 'Repair', hotkey: 'R', desc: 'Chọn công trình cần sửa.' }, onClick: () => s.input.startTargetMode('repair') });
      }
      const priests = own.filter((u) => u.type === 'priest');
      if (priests.length) {
        out.push({ key: 'convert', label: '✨', text: 'Cải đạo', hotkey: 'C', enabled: true, tip: { title: 'Cải đạo (Wololo!)', en: 'Convert', hotkey: 'C', desc: 'Chọn quân địch để cải đạo. Phù thủy cần đầy phép (100%).' }, onClick: () => s.input.startTargetMode('convert') });
        out.push({ key: 'heal', label: '✚', text: 'Chữa', hotkey: 'E', enabled: true, tip: { title: 'Chữa thương', en: 'Heal', hotkey: 'E' }, onClick: () => s.input.startTargetMode('heal') });
      }
      if (own.some((u) => u.stats.hasAtk)) out.push({ key: 'attack', label: '⚔', text: 'Đánh', hotkey: 'A', enabled: true, tip: { title: 'Tấn công', en: 'Attack', hotkey: 'A', desc: 'Chọn mục tiêu để tấn công (kể cả công trình của mình với Ctrl).' }, onClick: () => s.input.startTargetMode('attack') });
      out.push({ key: 'stop', label: '✋', text: 'Dừng', hotkey: 'S', enabled: true, tip: { title: 'Dừng lại', en: 'Stop', hotkey: 'S' }, onClick: () => s.issue({ type: 'stop', ids: own.map((u) => u.id) }) });
      out.push({ key: 'del', label: '✖', text: 'Xóa', hotkey: 'Delete', enabled: true, tip: { title: 'Xóa', en: 'Delete', hotkey: 'Del', desc: 'Giết đơn vị đã chọn (giải phóng dân số).' }, onClick: () => s.input.deleteSelection() });
      return out;
    }
    if (first.kind === 'building' && own.length === 1) {
      const b = first;
      if (!b.built) {
        out.push({ key: 'cancelb', label: '✖', text: 'Hủy', hotkey: 'Delete', enabled: true, tip: { title: 'Hủy xây (hoàn tiền)', hotkey: 'Del' }, onClick: () => s.issue({ type: 'cancel', bid: b.id }) });
        return out;
      }
      const lines = UNIT_LINES[b.type] || [];
      for (const line of lines) {
        const ut = p.currentOfLine(line) || (!p.unitDisabled(line[0]) ? line[0] : null);
        if (!ut) continue;
        const def = UNITS[ut];
        if (def.age > p.age + 1) continue;
        const err = trainError(w, p, b, ut);
        const st = p.unitStats(ut);
        const afford = p.canAfford(st.cost);
        const queued = b.queue.filter((q) => q.type === ut).reduce((a, q) => a + q.n, 0);
        out.push({
          key: 'u:' + ut, icon: () => iconCanvas('unit', ut, p.color, 40, { civ: p.civId }), hotkey: def.hotkey, count: queued,
          enabled: !err && afford,
          tip: { title: def.vi, en: def.name, cost: st.cost, time: Math.round(st.time), desc: def.desc, hotkey: def.hotkey, stats: unitStatLine(st), err: err || (!afford ? 'Không đủ tài nguyên' : '') },
          onClick: (ev) => { if (err) { s.toast(err); return; } s.issue({ type: 'train', bid: b.id, utype: ut, n: ev && ev.shiftKey ? 5 : 1 }); },
          onRight: () => { if (queued) s.issue({ type: 'cancel', bid: b.id }); },
        });
      }
      for (const tid of BUILDING_TECHS[b.type] || []) {
        const def = TECHS[tid];
        const st = p.techState(tid);
        if (def.advance !== undefined) { if (def.advance !== p.age + 1 || st === TS.DISABLED) continue; }
        else if (st !== TS.AVAILABLE && st !== TS.RESEARCHING) continue;
        const err = researchError(w, p, b, tid);
        const cost = p.techCostOf(tid);
        const afford = p.canAfford(cost);
        const busy = b.research && b.research.tech === tid;
        out.push({
          key: 't:' + tid, icon: () => techIcon(tid, def, p), hotkey: def.hotkey || null, enabled: !err && afford, active: busy,
          tip: { title: def.vi, en: def.name, cost, time: p.techTimeOf(tid), desc: def.desc || techDesc(def), err: busy ? 'Đang nghiên cứu' : err || (!afford ? 'Không đủ tài nguyên' : '') },
          onClick: () => { if (err) { s.toast(err); return; } s.issue({ type: 'research', bid: b.id, tech: tid }); },
        });
      }
      if (b.research || b.queue.length) out.push({ key: 'cancelq', label: '⨯', text: 'Hủy', hotkey: 'Escape', enabled: true, tip: { title: b.research ? 'Hủy nghiên cứu' : 'Hủy 1 quân trong hàng chờ', hotkey: 'Esc' }, onClick: () => s.issue({ type: 'cancel', bid: b.id }) });
      out.push({ key: 'del', label: '✖', text: 'Xóa', hotkey: 'Delete', enabled: true, tip: { title: 'Phá công trình', hotkey: 'Del' }, onClick: () => s.input.deleteSelection() });
    }
    return out;
  }

  updateCommands() {
    const btns = this.computeButtons();
    const sig = btns.map((b) => `${b.key}:${b.enabled ? 1 : 0}:${b.count || 0}:${b.active ? 1 : 0}`).join('|') + '|' + this.mode;
    this.buttons = btns;
    if (sig === this.cmdSig) return;
    this.cmdSig = sig;
    this.cmdEl.innerHTML = '';
    const grid = el('div', 'cmd-grid');
    for (const b of btns) {
      const e = el('button', 'cmd' + (b.enabled ? '' : ' disabled') + (b.active ? ' active' : ''));
      const cmdPic = CMD_FRAME[b.key] !== undefined && aoe() ? aoe().assets.commandIcon(CMD_FRAME[b.key]) : null;
      if (b.icon) e.appendChild(b.icon().cloneNode ? cloneCanvas(b.icon()) : b.icon());
      else if (cmdPic) { const c = cloneCanvas(cmdPic); c.className = 'ico'; e.appendChild(c); }
      else { e.innerHTML = `<span class="sym">${b.label || ''}</span>${b.text ? `<span class="txt">${b.text}</span>` : ''}`; }
      if (b.hotkey && b.hotkey.length === 1) { const hk = el('span', 'hk', b.hotkey); e.appendChild(hk); }
      if (b.count) { const c = el('span', 'count', String(b.count)); e.appendChild(c); }
      b.el = e;
      e.addEventListener('click', (ev) => { this.s.sfx.play('click'); b.onClick(ev); this.cmdSig = ''; });
      e.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (b.onRight) { b.onRight(); this.cmdSig = ''; } });
      e.addEventListener('mouseenter', (ev) => this.showTip(b, ev));
      e.addEventListener('mouseleave', () => this.hideTip());
      grid.appendChild(e);
    }
    this.cmdEl.appendChild(grid);
    this.hideTip();
  }

  // hotkey dispatch from input; returns true if handled
  hotkey(key, ev) {
    const k = key.length === 1 ? key.toUpperCase() : key;
    for (const b of this.buttons) {
      if (!b.hotkey) continue;
      if (b.hotkey.toUpperCase() === k.toUpperCase()) { if (b.enabled || b.key === 'back' || b.key.startsWith('b:')) b.onClick(ev); else if (b.tip && b.tip.err) this.s.toast(b.tip.err); this.cmdSig = ''; return true; }
    }
    return false;
  }

  // ---------------------------------------------------------------- info
  updateInfo() {
    const s = this.s, w = s.world;
    const sel = s.selectedEntities();
    if (!sel.length) { if (this.infoSig !== 'none') { this.infoSig = 'none'; this.infoEl.innerHTML = '<div class="info-empty"></div>'; } return; }
    if (sel.length > 1) {
      const sig = 'multi:' + sel.map((e) => e.id + ':' + Math.round(e.hp / e.stats.hp * 20)).join(',');
      if (sig === this.infoSig) return;
      this.infoSig = sig;
      this.infoEl.innerHTML = '';
      const grid = el('div', 'multi');
      for (const e of sel.slice(0, 30)) {
        const p = w.players[e.owner];
        const b = el('div', 'mini-unit');
        b.appendChild(cloneCanvas(iconCanvas('unit', e.type, p.color, 30, { extra: e.task ? e.task + ',' : '', civ: p.civId })));
        const hp = el('div', 'mhp'); const f = el('div', 'mhp-f'); f.style.width = Math.max(0, e.hp / e.stats.hp * 100) + '%'; hp.appendChild(f); b.appendChild(hp);
        b.title = UNITS[e.type].vi;
        b.onclick = () => s.input.selectOnly(e);
        grid.appendChild(b);
      }
      this.infoEl.appendChild(grid);
      return;
    }
    const e = sel[0];
    const p = w.players[e.owner];
    let sig = `${e.id}:${Math.ceil(e.hp)}:${e.type}:${e.owner}`;
    if (e.kind === 'unit') sig += `:${e.task}:${Math.floor(e.carry)}:${Math.floor(e.faith)}`;
    if (e.kind === 'building') sig += `:${e.built}:${Math.floor(e.progress * 100)}:${e.research ? e.research.tech + Math.floor(e.research.t) : ''}:${e.queue.map((q) => q.type + q.n).join()}:${Math.floor(e.trainT)}:${Math.floor(e.food || 0)}`;
    if (e.kind === 'resource') sig += `:${Math.floor(e.amount)}`;
    if (sig === this.infoSig) return;
    this.infoSig = sig;
    let html = '';
    const head = (name, en, sub) => `<div class="i-name">${esc(name)}</div><div class="i-en">${esc(en)}${sub ? ' — ' + esc(sub) : ''}</div>`;
    const hpBar = (hp, max) => {
      if (this.hpUrls) return `<div class="i-hp orig"><img src="${this.hpUrls[Math.max(0, Math.min(25, Math.round((1 - hp / max) * 25)))]}" alt=""><span>${Math.ceil(hp)}/${Math.round(max)}</span></div>`;
      return `<div class="i-hp"><div class="i-hp-f" style="width:${Math.max(0, Math.min(100, hp / max * 100))}%"></div><span>${Math.ceil(hp)}/${Math.round(max)}</span></div>`;
    };
    if (e.kind === 'unit') {
      const def = UNITS[e.type], st = e.stats;
      const name = e.type === 'villager' && e.task ? TASK_VI[e.task] || 'Dân' : def.vi;
      const en = e.type === 'villager' && e.task ? TASK_EN[e.task] || 'Villager' : def.name;
      html += head(name, en, e.owner ? `${p.name} (${p.civ.vi})` : 'Gaia');
      html += hpBar(e.hp, st.hp);
      const rows = [];
      const ds = displayStats(st);
      if (st.hasAtk) rows.push(['⚔', ds.atkText]);
      rows.push(['🛡', ds.armText], ['🎯', ds.pierceText]);
      if (st.range > 0.5) rows.push(['🏹', fmtNum(st.range)]);
      rows.push(['👁', st.los.toFixed(0)]);
      if (e.type === 'villager' && e.carry > 0.5) rows.push([RES_VI[{ forage: 'food', hunt: 'food', farm: 'food', wood: 'wood', gold: 'gold', stone: 'stone' }[e.carryKind]] || '', `${Math.floor(e.carry)}/${p.carryCap(e.carryKind)}`]);
      if (e.type === 'priest') rows.push(['✨', `Phép ${Math.floor(e.faith)}%`]);
      html += '<div class="i-stats">' + rows.map(([a, b]) => `<span><i>${this.statIcon(a)}</i>${esc(b)}</span>`).join('') + '</div>';
    } else if (e.kind === 'building') {
      const def = BUILDINGS[e.type];
      html += head(def.vi, def.name, `${p.name} (${p.civ.vi})`);
      html += hpBar(e.hp, e.stats.hp);
      if (!e.built) html += `<div class="i-work">Đang xây: ${Math.floor(e.progress * 100)}%<div class="bar"><div style="width:${e.progress * 100}%"></div></div></div>`;
      else if (e.research) {
        const t = TECHS[e.research.tech];
        const tt = Math.max(1, p.techTimeOf(e.research.tech));
        html += `<div class="i-work">Nghiên cứu: ${esc(t.vi)} ${Math.floor(e.research.t / tt * 100)}%<div class="bar"><div style="width:${e.research.t / tt * 100}%"></div></div></div>`;
      } else if (e.queue.length) {
        const q = e.queue[0];
        const st = p.unitStats(q.type);
        const n = e.queue.reduce((a, x) => a + x.n, 0);
        html += `<div class="i-work">${e.training ? 'Đang tạo' : 'Chờ dân số'}: ${esc(UNITS[q.type].vi)} (${n}) ${Math.floor(e.trainT / st.time * 100)}%<div class="bar"><div style="width:${e.trainT / st.time * 100}%"></div></div></div>`;
      }
      const rows = [];
      if (e.type === 'farm') rows.push(['🌾', `Còn ${Math.floor(e.food)} thịt`]);
      if (e.stats.pop) rows.push(['👥', `+${e.stats.pop} dân số`]);
      if (e.stats.hasAtk) rows.push(['🏹', `${displayStats(e.stats).atkText} công, tầm ${fmtNum(e.stats.range)}`]);
      if (e.owner === s.pid && e.type === 'town_center') rows.push(['👥', `Dân số ${Math.ceil(p.pop + p.training)}/${p.popCap}`]);
      html += '<div class="i-stats">' + rows.map(([a, b]) => `<span><i>${this.statIcon(a)}</i>${esc(b)}</span>`).join('') + '</div>';
    } else {
      const nm = RES_NAMES[e.type] || [e.type, e.type];
      html += head(nm[0], nm[1]);
      html += `<div class="i-stats"><span><i>📦</i>Còn lại: ${Math.floor(e.amount)}</span></div>`;
    }
    this.infoEl.innerHTML = '';
    const wrap = el('div', 'info-single');
    const pic = el('div', 'i-pic');
    const col = p ? p.color : { hex: '#ddd' };
    if (e.kind === 'unit') pic.appendChild(cloneCanvas(iconCanvas('unit', e.type, col, 64, { extra: e.task ? e.task + ',' : '', civ: p && !p.isGaia ? p.civId : null })));
    else if (e.kind === 'building') pic.appendChild(cloneCanvas(iconCanvas('building', e.type, col, 64, { arch: p.civ.arch, tier: Math.min(2, p.age), size: e.size, civ: p.civId, age: p.age })));
    else pic.appendChild(cloneCanvas(iconCanvas(e.type === 'tree' ? 'tree' : 'res', e.type, col, 64)));
    const txt = el('div', 'i-text', html);
    wrap.append(pic, txt);
    this.infoEl.appendChild(wrap);
  }

  // ---------------------------------------------------------------- menus
  toggleMenu(force) {
    const show = force !== undefined ? force : this.menuEl.classList.contains('hidden');
    this.diplEl.classList.add('hidden');
    if (!show) { this.menuEl.classList.add('hidden'); return; }
    const s = this.s;
    const rules = RULES[s.world.settings.rules];
    this.menuEl.innerHTML = '';
    const box = el('div', 'panel menu-panel');
    box.appendChild(el('h2', '', 'Menu'));
    const add = (label, fn) => { const b = el('button', 'stone-btn', label); b.onclick = fn; box.appendChild(b); };
    add('Tiếp tục chơi', () => this.toggleMenu(false));
    if (!s.net) add(s.paused ? 'Bỏ tạm dừng (F3)' : 'Tạm dừng (F3)', () => { s.togglePause(); this.toggleMenu(true); });
    if (!s.net) add(`Tốc độ: ×${s.speed} (+/-)`, () => { s.cycleSpeed(); this.toggleMenu(true); });
    add(`Âm thanh: ${s.sfx.enabled ? 'Bật' : 'Tắt'}`, () => { s.sfx.enabled = !s.sfx.enabled; this.toggleMenu(true); });
    const music = s.app && s.app.music;
    if (music && music.available) add(`Nhạc nền (MIDI gốc): ${music.enabled ? 'Bật' : 'Tắt'}`, () => { music.setEnabled(!music.enabled); this.toggleMenu(true); });
    if (AOE.assets) add(`Đồ họa gốc AoE: ${AOE.enabled ? 'Bật' : 'Tắt'}`, () => { setAoeEnabled(!AOE.enabled); this.cmdSig = ''; this.infoSig = ''; this.toggleMenu(true); });
    add('Phím tắt & luật chơi', () => this.showHelp());
    if (s.world.settings.cheats) add('Danh sách cheat', () => this.showCheats());
    if (!s.spectator && s.world.players[s.pid] && s.world.players[s.pid].alive) add('Đầu hàng (Resign)', () => { if (confirm('Bạn chắc chắn muốn đầu hàng?')) { s.issue({ type: 'resign' }); this.toggleMenu(false); } });
    add('Thoát về menu chính', () => { if (confirm('Thoát trận đấu?')) s.quit(); });
    box.appendChild(el('div', 'menu-foot', `Luật: <b>${esc(rules ? rules.vi : '')}</b><br>${esc(rules ? rules.desc : '')}`));
    this.menuEl.appendChild(box);
    this.menuEl.classList.remove('hidden');
  }

  showHelp() {
    this.menuEl.innerHTML = '';
    const box = el('div', 'panel help-panel');
    box.innerHTML = `<h2>Phím tắt</h2>
    <table class="keys">
      <tr><td>Chuột trái / kéo</td><td>Chọn quân (tối đa 25, như AoE1). Shift: thêm. Nhấp đúp: chọn cùng loại</td></tr>
      <tr><td>Chuột phải</td><td>Đi / đánh / khai thác / xây / sửa / cải đạo. Với công trình: đặt điểm tập kết</td></tr>
      <tr><td>Ctrl + 1..9 / 1..9</td><td>Gán / chọn nhóm (bấm 2 lần để đến nhóm)</td></tr>
      <tr><td>B + chữ</td><td>Xây: BE nhà, BB nhà lính, BG kho lương, BS nhà kho, BF ruộng, BM chợ, BA nhà cung, BL chuồng ngựa, BP đền, BC nhà chính phủ, BK xưởng cẩu, BY học viện, BN nhà chính, BO kỳ quan</td></tr>
      <tr><td>Nhà chính</td><td>C: tạo dân · T/B/I: lên đời 2/3/4</td></tr>
      <tr><td>Nhà cung</td><td>T: Cung T · A: Cung A · R: Cung R (xe cung) · C: Cung C (cung ngựa) · Y: Cung Y (voi cung)</td></tr>
      <tr><td>Chuồng ngựa</td><td>S: Ngựa dò · C: Ngựa chém · R: Xe chiến · M: Lạc đà · E: Voi</td></tr>
      <tr><td>Nhà lính</td><td>C: Lính chùy/rìu · S: Kiếm · L: Ném đá</td></tr>
      <tr><td>H / .</td><td>Chọn nhà chính / dân đang rảnh</td></tr>
      <tr><td>S / Del</td><td>Dừng / xóa đơn vị</td></tr>
      <tr><td>Enter / Shift+Enter</td><td>Chat tất cả / chat đồng đội (gõ mã cheat nếu được bật)</td></tr>
      <tr><td>F3 · F10 · Space</td><td>Tạm dừng · Menu · Đến quân đang chọn</td></tr>
      <tr><td>Mũi tên / chuột ra mép / lăn chuột</td><td>Di chuyển & phóng to bản đồ</td></tr>
      <tr><td>+ / −</td><td>Tốc độ game (chơi đơn)</td></tr>
    </table>
    <h2>Luật D3KT (Đời 3 Không Thành)</h2>
    <p>Luật thi đấu phổ biến nhất của cộng đồng AoE Việt Nam: cấm xây <b>Thành</b> và <b>Chòi</b>; trước khi lên xong đời 3 chỉ được có <b>1 đơn vị quân</b> (thường là ngựa dò hoặc Cung T); không được dùng dân đánh dân hoặc đập móng nhà (trừ nhà BE) của đối thủ trước đời 3. Game sẽ tự động ngăn các hành động vi phạm.</p>`;
    const b = el('button', 'stone-btn', 'Quay lại'); b.onclick = () => this.toggleMenu(true);
    box.appendChild(b);
    this.menuEl.appendChild(box);
    this.menuEl.classList.remove('hidden');
  }

  showCheats() {
    this.menuEl.innerHTML = '';
    const box = el('div', 'panel help-panel');
    box.innerHTML = '<h2>Mã cheat (gõ vào ô chat)</h2><table class="keys">' + CHEAT_LIST.map(([c, d]) => `<tr><td><b>${esc(c)}</b></td><td>${esc(d)}</td></tr>`).join('') + '</table>';
    const b = el('button', 'stone-btn', 'Quay lại'); b.onclick = () => this.toggleMenu(true);
    box.appendChild(b);
    this.menuEl.appendChild(box);
    this.menuEl.classList.remove('hidden');
  }

  toggleDiplomacy(force) {
    const show = force !== undefined ? force : this.diplEl.classList.contains('hidden');
    this.menuEl.classList.add('hidden');
    if (!show) { this.diplEl.classList.add('hidden'); return; }
    const s = this.s, w = s.world;
    this.diplEl.innerHTML = '';
    const box = el('div', 'panel dipl-panel');
    box.appendChild(el('h2', '', 'Ngoại giao & Cống nạp'));
    const tbl = el('table', 'dipl');
    tbl.innerHTML = '<tr><th>Người chơi</th><th>Phe</th><th>Đội</th><th>Quan hệ</th><th>Cống nạp</th></tr>';
    for (const q of w.realPlayers()) {
      const tr = el('tr');
      const rel = q.id === s.pid ? 'Bạn' : w.isAlly(q.id, s.pid) ? 'Đồng minh' : 'Kẻ thù';
      tr.innerHTML = `<td><span class="swatch" style="background:${q.color.hex}"></span>${esc(q.name)}${q.alive ? '' : ' ✝'}</td><td>${esc(q.civ.vi)}</td><td>${q.team || '-'}</td><td>${rel}</td>`;
      const td = el('td');
      if (q.id !== s.pid && !s.spectator) {
        for (const r of ['food', 'wood', 'gold', 'stone']) {
          const b = el('button', 'stone-btn tiny', `+100 ${RES_VI[r]}`);
          b.onclick = () => s.issue({ type: 'tribute', to: q.id, res: r, amount: 100 });
          td.appendChild(b);
        }
      }
      tr.appendChild(td);
      tbl.appendChild(tr);
    }
    box.appendChild(tbl);
    box.appendChild(el('p', 'note', 'Cống nạp cần có Chợ (Market) và mất 25% thuế (trừ khi có Coinage hoặc là Palmyra). Đội đã được khóa theo thiết lập phòng.'));
    const c = el('button', 'stone-btn', 'Đóng'); c.onclick = () => this.toggleDiplomacy(false);
    box.appendChild(c);
    this.diplEl.appendChild(box);
    this.diplEl.classList.remove('hidden');
  }

  toggleScores() {
    this.scoreEl.classList.toggle('hidden');
    this.renderScores();
  }
  renderScores() {
    const w = this.s.world;
    const rows = w.realPlayers().map((p) => `<div><span class="swatch" style="background:${p.color.hex}"></span>${esc(p.name)}: <b>${computeScore(p, w)}</b>${p.alive ? '' : ' ✝'}</div>`).join('');
    this.scoreEl.innerHTML = rows;
  }
}

export function computeScore(p, w) {
  const st = p.stats;
  const gathered = st.gathered.food + st.gathered.wood + st.gathered.gold + st.gathered.stone;
  const military = st.killed * 10 + st.razed * 25 + st.converted * 15;
  const economy = Math.floor(gathered / 20) + st.villagerHigh * 5 + Math.floor(st.tributeSent / 20);
  const tech = st.techs * 10 + p.age * 100;
  const survival = p.alive ? 100 : 0;
  return military + economy + tech + survival + (p.won ? 500 : 0);
}

function unitStatLine(st) {
  const ds = displayStats(st);
  const parts = [];
  parts.push(`Máu ${st.hp}`);
  if (st.hasAtk) parts.push(`Công ${ds.atkText}`);
  parts.push(`Giáp ${ds.armText}`, `Giáp tên ${ds.pierceText}`);
  if (st.range > 0.5) parts.push(`Tầm ${fmtNum(st.range)}`);
  parts.push(`Tốc ${fmtNum(st.speed)}`);
  return parts.join(' · ');
}
const fmtNum = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

function techDesc(def) {
  if (def.advance !== undefined) return 'Cần 2 công trình của đời hiện tại.';
  if (def.upgrade) return `Nâng cấp ${UNITS[def.upgrade.from].vi} → ${UNITS[def.upgrade.to].vi}`;
  if (def.bupgrade) return `Nâng cấp ${BUILDINGS[def.bupgrade.from].vi} → ${BUILDINGS[def.bupgrade.to].vi}`;
  if (def.unlocksUnit) return `Mở khóa ${UNITS[def.unlocksUnit].vi}`;
  if (def.unlocks) return `Mở khóa ${BUILDINGS[def.unlocks].vi}`;
  return '';
}

const TECH_SYM = {
  woodworking: '🪓', artisanship: '🪚', craftsmanship: '🔨', stone_mining: '⛏️', siegecraft: '🧱', gold_mining: '⛏️', coinage: '🪙',
  domestication: '🐄', plow: '🌾', irrigation: '💧', wheel: '☸️',
  toolworking: '🗡️', metalworking: '⚔️', metallurgy: '🔥',
  leather_armor_infantry: '🦺', scale_armor_infantry: '🦺', chain_mail_infantry: '🦺',
  leather_armor_archers: '🏹', scale_armor_archers: '🏹', chain_mail_archers: '🏹',
  leather_armor_cavalry: '🐎', scale_armor_cavalry: '🐎', chain_mail_cavalry: '🐎',
  bronze_shield: '🛡️', iron_shield: '🛡️', tower_shield: '🛡️',
  nobility: '👑', writing: '📜', architecture: '🏛️', logistics: '📦', aristocracy: '🎖️', ballistics: '🎯', alchemy: '⚗️', engineering: '⚙️',
  astrology: '✨', mysticism: '🔮', polytheism: '⚡', afterlife: '☥', monotheism: '☀️', fanaticism: '🔥', jihad: '⚔️', medicine: '✚', martyrdom: '💀',
};
const TECH_BG = {
  market: ['#6a8a3a', '#26360e'], storage_pit: ['#7a6a5a', '#2a2018'], government_center: ['#5a5a9a', '#1a1a3a'],
  temple: ['#8a5a9a', '#2a1a3a'], granary: ['#8a7a4a', '#3a3018'],
};
const techIconCache = new Map();
function techIcon(tid, def, p) {
  const key = tid + p.color.hex + (aoe() ? '|aoe' : '');
  if (techIconCache.has(key)) return techIconCache.get(key);
  let c = aoeIcon('tech', tid, p.color, 40);
  if (c) { techIconCache.set(key, c); return c; }
  if (def.upgrade) c = procIcon('unit', def.upgrade.to, p.color, 40, { bg1: '#7a6a3a', bg2: '#3a3018' });
  else if (def.unlocksUnit) c = procIcon('unit', def.unlocksUnit, p.color, 40, { bg1: '#7a6a3a', bg2: '#3a3018' });
  else if (def.bupgrade || def.unlocks) c = procIcon('building', def.bupgrade ? def.bupgrade.to : def.unlocks, p.color, 40, { arch: p.civ.arch, tier: 2, size: 1, bg1: '#7a6a3a', bg2: '#3a3018' });
  else {
    c = document.createElement('canvas'); c.width = 60; c.height = 60;
    const g = c.getContext('2d'); g.scale(1.5, 1.5);
    const grd = g.createLinearGradient(0, 0, 0, 40);
    const age = def.advance !== undefined;
    const [c1, c2] = age ? ['#c89a34', '#5a4010'] : TECH_BG[def.building] || ['#4a6a8a', '#1a2a3a'];
    grd.addColorStop(0, c1); grd.addColorStop(1, c2);
    g.fillStyle = grd; g.fillRect(0, 0, 40, 40);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (age) {
      g.fillStyle = '#fff4d0'; g.font = 'bold 16px "Times New Roman", serif';
      g.fillText(['', 'II', 'III', 'IV'][def.advance], 20, 21);
    } else {
      g.font = '20px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      g.fillText(TECH_SYM[tid] || '✦', 20, 22);
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeRect(0.5, 0.5, 39, 39);
  }
  techIconCache.set(key, c);
  return c;
}

function iconCanvas(kind, type, col, size, opts = {}) {
  return aoeIcon(kind, type, col, size, opts) || procIcon(kind, type, col, size, opts);
}

export function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  c.className = 'ico';
  return c;
}
export { CIVS, isMilitary, shade };
