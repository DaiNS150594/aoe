// App shell: main menu, single-player setup, multiplayer room browser,
// lobby, post-game achievements, help and replays.
import { CIVS, CIV_IDS } from './engine/data/civs.js';
import { PLAYER_COLORS, MAP_SIZES, START_RESOURCES, RULES, SPEEDS } from './engine/constants.js';
import { NetClient } from './net/client.js';
import { GameSession } from './game/session.js';
import { Sfx } from './audio/sfx.js';
import { Music } from './audio/music.js';
import { computeScore, fmtTime } from './ui/hud.js';
import { AGE_NAMES } from './engine/production.js';
import { AOE, aoe, initAoe, importFolder, pickFolder, setAoeEnabled, onAoeChange, forgetSaved } from './assets/loader.js';

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MAP_TYPES = { hill_country: 'Hill Country (Đồi núi)', highland: 'Highland (Cao nguyên)' };
const AI_LEVELS = { easiest: 'Rất dễ', easy: 'Dễ', moderate: 'Vừa', hard: 'Khó', hardest: 'Rất khó' };
const DEFAULT_SETTINGS = {
  mapType: 'hill_country', mapSize: 'large', rules: 'd3kt', popLimit: 200, startRes: 'default', startAge: 0,
  speed: 2.0, reveal: false, cheats: false, teamsTogether: true, lockTeams: true, victory: 'conquest', allowLacViet: false,
};
const PRESETS = [
  { name: 'Solo Random D3KT', desc: '1vs1 · Large · Random', apply: (L) => L.preset({ mapSize: 'large', rules: 'd3kt' }, 2, 'random') },
  { name: '2vs2 Random', desc: 'Large · D3KT', apply: (L) => L.preset({ mapSize: 'large', rules: 'd3kt' }, 4, 'random', true) },
  { name: '3vs3 Random', desc: 'Huge · D3KT', apply: (L) => L.preset({ mapSize: 'huge', rules: 'd3kt' }, 6, 'random', true) },
  { name: '4vs4 Random', desc: 'Gigantic · D3KT', apply: (L) => L.preset({ mapSize: 'gigantic', rules: 'd3kt' }, 8, 'random', true) },
  { name: 'Solo Shang', desc: 'Luật Cung R', apply: (L) => L.preset({ mapSize: 'large', rules: 'cungr' }, 2, 'shang') },
  { name: 'Solo Assy', desc: 'Luật Cung R', apply: (L) => L.preset({ mapSize: 'large', rules: 'cungr' }, 2, 'assyrian') },
  { name: 'Assy - Ya', desc: 'Yamato vs Assyrian', apply: (L) => L.preset({ mapSize: 'large', rules: 'd3kt' }, 2, ['yamato', 'assyrian']) },
  { name: 'Deathmatch', desc: 'Tài nguyên 20000', apply: (L) => L.preset({ mapSize: 'large', rules: 'deathmatch', startRes: 'deathmatch' }, 2, 'random') },
];

class App {
  constructor() {
    this.root = document.getElementById('app');
    this.sfx = new Sfx();
    this.music = new Music(this.sfx);
    this.name = localStorage.getItem('deche_name') || 'Người chơi';
    this.net = null;
    this.session = null;
    this.showMainMenu();
    onAoeChange(() => {
      this.music.setSource(aoe() ? AOE.assets.music : null);
      const s = this.root.querySelector('.screen');
      if (s) this.screenBg(s, [...s.classList].find((c) => c !== 'screen' && c !== 'orig-bg'));
    });
    initAoe();
  }

  screen(cls, ...kids) {
    if (this.session && this.session.running) this.session.destroy();
    this.root.innerHTML = '';
    const s = h('div', { class: 'screen ' + cls }, ...kids);
    this.root.appendChild(s);
    this.screenBg(s, cls);
    return s;
  }

  // the original menu pictures (main menu temple, Stone Age village, scores)
  screenBg(s, cls) {
    const n = { menu: 1, mp: 2, 'lobby-screen': 2, help: 2, post: 10 }[cls];
    const A = aoe();
    if (!n || !A) { s.classList.remove('orig-bg'); s.style.backgroundImage = ''; return; }
    A.assets.screenBackground(n, window.innerWidth).then((url) => {
      if (!url || !s.isConnected) return;
      s.classList.add('orig-bg');
      s.style.backgroundImage = `url(${url})`;
    });
  }

  btn(label, fn, cls = '') { return h('button', { class: 'stone-btn ' + cls, onclick: () => { this.sfx.play('click'); fn(); } }, label); }

  // ------------------------------------------------------------- main menu
  showMainMenu() {
    if (this.net) { this.net.close(); this.net = null; }
    this.music.start('menu');
    this.screen('menu',
      h('div', { class: 'title-wrap' },
        h('div', { class: 'title' }, 'ĐẾ CHẾ'),
        h('div', { class: 'subtitle' }, 'Bản làm lại phi thương mại của người hâm mộ, theo Age of Empires I · The Rise of Rome'),
      ),
      h('div', { class: 'menu-col' },
        this.btn('Chơi đơn (với máy)', () => this.showSetup()),
        this.btn('Chơi mạng (Multiplayer / LAN)', () => this.showMultiplayer()),
        this.btn('Xem lại trận (Replay)', () => this.pickReplay()),
        this.btn('Hướng dẫn & Phe phái', () => this.showHelp()),
      ),
      this.aoeBox(),
      h('div', { class: 'menu-foot' }, 'Bản đồ Hill Country · Luật D3KT · 16 phe RoR + Lạc Việt · Lockstep multiplayer tới 8 người'),
      h('div', { class: 'legal-foot' }, 'Age of Empires © Microsoft Corporation. Đế Chế Web được làm theo “Game Content Usage Rules” của Microsoft, dùng tài nguyên từ Age of Empires (chỉ khi người chơi tự cung cấp từ bản game của mình), và không được Microsoft bảo trợ hay liên kết. Phi thương mại.'),
    );
  }

  // Original graphics & sounds from the player's own game folder
  aoeBox() {
    const box = h('div', { class: 'aoe-box' });
    const render = () => {
      if (!box.isConnected && box.dataset.done) { off(); return; }
      box.dataset.done = '1';
      box.innerHTML = '';
      const st = AOE.status;
      const head = h('div', { class: 'aoe-head' }, 'Đồ họa & âm thanh gốc AoE');
      let line;
      if (st === 'ready') line = h('div', { class: 'aoe-ok' }, '✔ Đã nạp từ ' + ({ builtin: 'dữ liệu trong dự án (assets/aoe)', folder: 'thư mục bạn chọn', saved: 'dữ liệu đã lưu trong trình duyệt', server: 'máy chủ cục bộ (AOE_DIR)' }[AOE.source] || 'máy') + ' — ' + AOE.message);
      else if (st === 'loading') line = h('div', { class: 'aoe-note' }, '⏳ ' + AOE.message);
      else if (st === 'error') line = h('div', { class: 'aoe-err' }, '✖ ' + AOE.message);
      else line = h('div', { class: 'aoe-note' }, 'Chưa có. Chọn thư mục cài Age of Empires (bản Rise of Rome 1.0, có data/graphic(s).drs, interfac.drs, sound(s).drs, empires.dat) để chơi bằng hình & tiếng thật. File chỉ được đọc trong trình duyệt của bạn, không tải lên đâu cả.');
      const row = h('div', { class: 'row aoe-row' });
      if (AOE.source !== 'builtin') {
        row.append(this.btn(st === 'ready' ? 'Chọn lại thư mục...' : 'Chọn thư mục game AoE...', async () => { const files = await pickFolder(); if (files && files.length) importFolder(files); }, 'small'));
      }
      if (st === 'ready') {
        const cb = h('input', { type: 'checkbox', checked: AOE.enabled, onchange: () => setAoeEnabled(cb.checked) });
        row.append(h('label', { class: 'aoe-toggle' }, cb, ' Dùng đồ họa/âm thanh gốc'));
        if (AOE.source === 'saved' || AOE.source === 'folder') row.append(this.btn('Xóa dữ liệu đã lưu', () => forgetSaved(), 'small'));
      }
      box.append(head, line, row);
    };
    const off = onAoeChange(render);
    render();
    return box;
  }

  // ------------------------------------------------------- single player
  showSetup() {
    const state = {
      settings: { ...DEFAULT_SETTINGS },
      slots: [
        { idx: 0, type: 'human', name: this.name, civ: 'random', color: 0, team: 0, ai: 'moderate' },
        { idx: 1, type: 'ai', name: '', civ: 'random', color: 1, team: 0, ai: 'moderate' },
        ...Array.from({ length: 6 }, (_, i) => ({ idx: i + 2, type: 'closed', name: '', civ: 'random', color: i + 2, team: 0, ai: 'moderate' })),
      ],
    };
    const lobby = new LobbyView(this, {
      local: true, isHost: true, myIdx: 0, state,
      onChange: () => lobby.render(),
      onStart: () => {
        const players = [];
        let pid = 1, myPid = 1;
        for (const s of state.slots) {
          if (s.type !== 'human' && s.type !== 'ai') continue;
          if (s.type === 'human') myPid = pid;
          players.push({ id: pid, name: s.type === 'human' ? s.name : `Máy ${pid} (${AI_LEVELS[s.ai]})`, civ: s.civ, color: s.color, team: s.team, ai: s.type === 'ai' ? s.ai : null });
          pid++;
        }
        if (players.length < 2) { alert('Cần ít nhất 2 người chơi (thêm máy).'); return; }
        const seed = (Math.random() * 0xffffffff) >>> 0;
        this.startGame({ ...state.settings, seed, players }, myPid, null);
      },
      onLeave: () => this.showMainMenu(),
    });
    lobby.render();
  }

  // --------------------------------------------------------- multiplayer
  showMultiplayer() {
    const nameIn = h('input', { value: this.name, maxlength: 24 });
    const status = h('div', { class: 'status' });
    const list = h('div', { class: 'room-list' });
    const doConnect = async () => {
      this.name = nameIn.value.trim() || 'Người chơi';
      try { localStorage.setItem('deche_name', this.name); } catch { /* ignore */ }
      status.textContent = 'Đang kết nối...';
      try {
        if (this.net) this.net.close();
        this.net = new NetClient();
        this.bindNetGlobal();
        this.net.on('rooms', (m) => this.renderRooms(list, m.rooms));
        await this.net.connect(this.name);
        status.textContent = 'Đã kết nối tới máy chủ ' + location.host;
        connectBtn.textContent = 'Đổi tên';
      } catch (e) {
        status.textContent = '❌ ' + e.message + ' — hãy chạy máy chủ bằng "npm start" và mở trang qua http://<ip>:3000';
      }
    };
    const connectBtn = this.btn('Kết nối', doConnect);
    this.screen('mp',
      h('div', { class: 'panel wide' },
        h('h1', {}, 'Chơi mạng'),
        h('div', { class: 'row' }, h('label', {}, 'Tên của bạn: '), nameIn, connectBtn),
        status,
        h('h3', {}, 'Danh sách phòng'),
        list,
        h('div', { class: 'row' },
          this.btn('Tạo phòng mới', () => { if (!this.net || !this.net.connected) { status.textContent = 'Chưa kết nối'; return; } this.net.send({ t: 'createRoom', name: `Phòng của ${this.name}` }); }),
          this.btn('Làm mới', () => this.net && this.net.send({ t: 'listRooms' })),
          this.btn('Quay lại', () => this.showMainMenu()),
        ),
        h('p', { class: 'note', html: 'Mẹo: Một người chạy <b>npm start</b>, những người khác trong mạng LAN mở <b>http://&lt;IP-máy-chủ&gt;:3000</b>. Chơi qua Internet: mở cổng 3000 hoặc dùng Radmin VPN / ZeroTier như hồi chơi LAN ở quán net.' }),
      ),
    );
    this.renderRooms(list, []);
    if (this.net && this.net.connected) { this.net.on('rooms', (m) => this.renderRooms(list, m.rooms)); this.net.send({ t: 'listRooms' }); status.textContent = 'Đã kết nối'; }
    else doConnect();
  }

  bindNetGlobal() {
    const n = this.net;
    n.on('room', (m) => this.onRoom(m.room));
    n.on('error', (m) => alert(m.msg));
    n.on('kicked', () => { alert('Bạn đã bị mời ra khỏi phòng.'); this.showMultiplayer(); });
    n.on('start', (m) => this.startGame(m.settings, m.playerId, n, m.rejoin));
    n.on('chat', (m) => { if (this.lobby) this.lobby.chat(m); });
    n.on('close', () => { if (!this.session || this.session.ended) { /* ignore */ } });
  }

  renderRooms(list, rooms) {
    list.innerHTML = '';
    if (!rooms.length) { list.appendChild(h('div', { class: 'empty' }, 'Chưa có phòng nào. Hãy tạo phòng mới!')); return; }
    const t = h('table', { class: 'rooms' }, h('tr', {}, h('th', {}, 'Phòng'), h('th', {}, 'Chủ phòng'), h('th', {}, 'Người'), h('th', {}, 'Bản đồ'), h('th', {}, 'Luật'), h('th', {}, 'Trạng thái'), h('th', {})));
    for (const r of rooms) {
      t.appendChild(h('tr', {},
        h('td', {}, r.name), h('td', {}, r.host), h('td', {}, `${r.humans} (+${r.open} trống)`),
        h('td', {}, `${MAP_TYPES[r.settings.mapType] || r.settings.mapType} · ${MAP_SIZES[r.settings.mapSize]?.vi || ''}`),
        h('td', {}, RULES[r.settings.rules]?.vi || r.settings.rules),
        h('td', {}, (r.state === 'playing' ? 'Đang chơi' : 'Đang chờ') + (r.observers ? ` · ${r.observers} người xem` : '')),
        h('td', {},
          r.state === 'lobby' && r.open > 0 ? this.btn('Vào', () => this.net.send({ t: 'joinRoom', id: r.id }), 'small') : '',
          this.btn('Xem', () => this.net.send({ t: 'joinRoom', id: r.id, observe: true }), 'small')),
      ));
    }
    list.appendChild(t);
  }

  onRoom(room) {
    if (this.session && this.session.running && room.state === 'playing') return;
    if (this.postGameShowing || (this.session && this.session.running)) { this.pendingRoom = room; return; }
    const myIdx = room.slots.findIndex((s) => s.type === 'human' && s.clientId === this.net.id);
    const observer = (room.observers || []).some((o) => o.id === this.net.id);
    if (myIdx < 0 && !observer) { this.lobby = null; return; }
    const isHost = room.hostId === this.net.id;
    if (!this.lobby || this.lobby.roomId !== room.id || !document.body.contains(this.lobby.el)) {
      this.lobby = new LobbyView(this, {
        local: false, isHost, myIdx, state: room, roomId: room.id,
        onStart: () => this.net.send({ t: 'start' }),
        onLeave: () => { this.net.send({ t: 'leaveRoom' }); this.lobby = null; this.showMultiplayer(); },
      });
      this.lobby.roomId = room.id;
    }
    this.lobby.opts.isHost = isHost;
    this.lobby.opts.myIdx = myIdx;
    this.lobby.opts.state = room;
    this.lobby.render();
  }

  // ------------------------------------------------------------- game
  startGame(settings, playerId, net, rejoin) {
    if (this.session && this.session.running) this.session.destroy();
    this.lobby = null;
    const root = this.screen('game');
    this.sfx.ensure();
    this.session = new GameSession(this, { settings, playerId, net, root });
    try {
      this.session.start();
      if (rejoin) this.session.catchingUp = true;
    } catch (e) {
      console.error(e);
      alert('Lỗi khi tạo trận đấu: ' + e.message);
      this.showMainMenu();
    }
  }

  startReplay(data) {
    const root = this.screen('game');
    this.session = new GameSession(this, { settings: data.settings, playerId: 0, net: null, root, spectator: true, replay: data });
    this.session.start();
  }

  backToMenu() {
    if (this.session) this.session.destroy();
    this.session = null;
    this.postGameShowing = false;
    if (this.net && this.net.connected) {
      if (this.pendingRoom) { const r = this.pendingRoom; this.pendingRoom = null; this.showMultiplayer(); this.onRoom(r); }
      else this.showMultiplayer();
    } else this.showMainMenu();
  }

  showPostGame(session) {
    session.destroy();
    this.postGameShowing = true;
    const w = session.world;
    const ps = w.realPlayers();
    const rows = ps.map((p) => {
      const st = p.stats;
      const ages = st.ageTicks.slice(1).map((t) => (t >= 0 ? fmtTime(t / 10) : '—')).join(' / ');
      return h('tr', { class: w.winners && w.winners.includes(p.id) ? 'winner' : '' },
        h('td', { html: `<span class="swatch" style="background:${p.color.hex}"></span>${esc(p.name)}` }),
        h('td', {}, p.civ.vi),
        h('td', {}, `${st.killed} / ${st.lost} / ${st.razed} / ${st.converted}`),
        h('td', {}, `${Math.floor(st.gathered.food)} / ${Math.floor(st.gathered.wood)} / ${Math.floor(st.gathered.gold)} / ${Math.floor(st.gathered.stone)}`),
        h('td', {}, `${st.villagerHigh}`),
        h('td', {}, `${st.techs}`),
        h('td', {}, ages),
        h('td', { class: 'score' }, String(computeScore(p, w))),
      );
    });
    const me = w.players[session.pid];
    const won = me && w.winners && w.winners.includes(me.id);
    this.screen('post',
      h('div', { class: 'panel wide' },
        h('h1', {}, me ? (won ? 'Chiến thắng!' : 'Thất bại') : 'Kết thúc trận đấu'),
        h('div', { class: 'sub' }, `Thời gian: ${fmtTime(w.gameSeconds())} · ${RULES[w.settings.rules]?.vi || ''} · ${MAP_TYPES[w.settings.mapType] || ''}`),
        h('h3', {}, 'Thành tích (Achievements)'),
        h('table', { class: 'post' },
          h('tr', {}, h('th', {}, 'Người chơi'), h('th', {}, 'Phe'), h('th', {}, 'Giết / Mất / Phá nhà / Cải đạo'), h('th', {}, 'Thu hoạch Thịt / Gỗ / Vàng / Đá'), h('th', {}, 'Dân tối đa'), h('th', {}, 'Công nghệ'), h('th', {}, 'Lên đời 2 / 3 / 4'), h('th', {}, 'Điểm')),
          ...rows,
        ),
        h('div', { class: 'row' },
          this.btn('Lưu replay', () => {
            const blob = new Blob([JSON.stringify(session.replayData())], { type: 'application/json' });
            const a = h('a', { href: URL.createObjectURL(blob), download: `deche-replay-${Date.now()}.json` });
            document.body.appendChild(a); a.click(); a.remove();
          }),
          this.btn('Về menu', () => this.backToMenu()),
        ),
      ),
    );
  }

  pickReplay() {
    const inp = h('input', { type: 'file', accept: '.json' });
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      try { this.startReplay(JSON.parse(await f.text())); } catch (e) { alert('File replay không hợp lệ: ' + e.message); }
    };
    inp.click();
  }

  showHelp() {
    const civRows = CIV_IDS.map((id) => {
      const c = CIVS[id];
      return `<tr><td><b>${esc(c.vi)}</b><br><small>${esc(c.name)}</small></td><td>${esc(c.arch)}</td><td>${(c.desc || []).map(esc).join('<br>')}</td></tr>`;
    }).join('');
    this.screen('help',
      h('div', { class: 'panel wide scroll' },
        h('h1', {}, 'Hướng dẫn'),
        h('div', { html: `
          <h3>Cách chơi</h3>
          <p>Giống Đế Chế 1 (Age of Empires: The Rise of Rome): bắt đầu ở <b>Đời 1 (Thời đồ đá)</b> với 1 Nhà chính và 3 dân, tài nguyên mặc định 200 thịt · 200 gỗ · 0 vàng · 150 đá. Khai thác bụi quả, săn hươu/voi, đốn gỗ, xây nhà (mỗi nhà +4 dân số), lên đời 2 (cần 2 công trình đời 1 + 500 thịt), đời 3 (2 công trình đời 2 + 800 thịt), đời 4 (2 công trình đời 3 + 1000 thịt, 800 vàng).</p>
          <p>Bản đồ <b>Hill Country</b> không có nước, nhiều đồi: quân <b>bắn từ trên cao xuống gây thêm 50% sát thương</b>, quân cận chiến <b>đánh lên dốc chỉ còn 2/3</b> sát thương. Công trình nhận đủ sát thương nhưng nhiều máu; Cẩu đá có +140 công với nhà, lính ném đá +7 với chòi/thành.</p>
          <p>Phù thủy (Priest) cải đạo quân địch (Wololo!), cần đầy phép 100% và hồi lại 50 giây. Xe chiến & Cung R khó bị cải đạo.</p>
          <h3>Luật chơi Việt Nam</h3>
          <ul>
            <li><b>D3KT – Đời 3 Không Thành</b>: cấm Thành & Chòi, trước khi lên xong đời 3 chỉ được 1 lính (ngựa dò hoặc Cung T), không dùng dân đánh dân / đập móng nhà (trừ BE) trước đời 3.</li>
            <li><b>Cung R</b> (giải Shang/Assy): đời 2 không được Cung T, đời 3 chỉ ra Cung R (xe cung), phút 25 hoặc đời 4 mới chuyển quân tự do, chưa có Wheel không được đánh dân & nhà BE.</li>
            <li><b>Thiết lập chuẩn</b>: Random Map · Hill Country · Large (solo/2vs2), Huge (3vs3), Gigantic (4vs4) · Conquest · Dân số 200 · Tốc độ 2.0 · Phe ngẫu nhiên · Đồng đội đứng gần nhau.</li>
          </ul>
          <h3>Phe phái</h3>
          <table class="civs"><tr><th>Phe</th><th>Kiến trúc</th><th>Đặc điểm</th></tr>${civRows}</table>
        ` }),
        this.btn('Quay lại', () => this.showMainMenu()),
      ),
    );
  }
}

// ----------------------------------------------------------------- lobby
class LobbyView {
  constructor(app, opts) {
    this.app = app;
    this.opts = opts;
    this.chatLines = [];
    this.el = null;
  }
  get state() { return this.opts.state; }

  setSetting(k, v) {
    if (this.opts.local) { this.state.settings[k] = v; this.render(); }
    else this.app.net.send({ t: 'setSettings', settings: { [k]: v } });
  }
  setSlot(idx, field, value) {
    const s = this.state.slots[idx];
    if (this.opts.local) {
      if (field === 'type') { s.type = value; }
      else if (field === 'color') {
        const other = this.state.slots.find((o) => o !== s && (o.type === 'human' || o.type === 'ai') && o.color === value);
        if (other) other.color = s.color;
        s.color = value;
      } else s[field] = value;
      this.render();
    } else this.app.net.send({ t: 'setSlot', idx, field, value });
  }
  preset(settings, n, civ, teams) {
    for (const [k, v] of Object.entries(settings)) this.setSetting(k, v);
    if (!settings.startRes) this.setSetting('startRes', 'default');
    if (!this.opts.isHost) return;
    const slots = this.state.slots;
    for (let i = 0; i < 8; i++) {
      const s = slots[i];
      const want = i < n;
      if (s.type === 'human') {
        if (Array.isArray(civ)) this.setSlot(i, 'civ', civ[i % civ.length]); else if (civ) this.setSlot(i, 'civ', civ);
        if (teams) this.setSlot(i, 'team', (i % 2) + 1); else this.setSlot(i, 'team', 0);
        continue;
      }
      if (want && s.type !== 'ai' && s.type !== 'open') this.setSlot(i, 'type', this.opts.local ? 'ai' : 'open');
      if (!want && s.type !== 'closed') this.setSlot(i, 'type', 'closed');
      if (want) {
        if (Array.isArray(civ)) this.setSlot(i, 'civ', civ[i % civ.length]); else if (civ) this.setSlot(i, 'civ', civ);
        this.setSlot(i, 'team', teams ? (i % 2) + 1 : 0);
      }
    }
  }

  chat(m) {
    this.chatLines.push(m);
    if (this.chatLines.length > 60) this.chatLines.shift();
    this.renderChat();
  }
  renderChat() {
    if (!this.chatEl) return;
    this.chatEl.innerHTML = this.chatLines.map((m) => m.sys ? `<div class="sys">${esc(m.text)}</div>` : `<div><b style="color:${PLAYER_COLORS[m.color || 0].light}">${esc(m.from)}:</b> ${esc(m.text)}</div>`).join('');
    this.chatEl.scrollTop = 1e9;
  }

  render() {
    const app = this.app, st = this.state, S = st.settings, o = this.opts;
    const host = o.isHost;
    const civOpts = [['random', 'Ngẫu nhiên']].concat(CIV_IDS.filter((id) => S.allowLacViet || id !== 'lac_viet' || true).map((id) => [id, CIVS[id].vi]));
    const sel = (opts, value, onchange, disabled) => {
      const e = h('select', { disabled: !!disabled, onchange: (ev) => onchange(ev.target.value) });
      for (const [v, label] of opts) { const op = h('option', { value: v }, label); if (String(v) === String(value)) op.selected = true; e.appendChild(op); }
      return e;
    };
    const slotRows = st.slots.map((s, i) => {
      const mine = i === o.myIdx;
      const active = s.type === 'human' || s.type === 'ai';
      let nameCell;
      if (s.type === 'human') {
        nameCell = h('div', { class: 'pname' }, s.name + (s.clientId && st.hostId === s.clientId ? ' ★' : ''), !o.local && host && !mine ? h('button', { class: 'stone-btn tiny', onclick: () => this.setSlot(i, 'type', 'kick') }, 'Mời ra') : '');
      } else {
        const typeOpts = [['open', 'Mở'], ['closed', 'Đóng'], ['ai', 'Máy']];
        if (o.local) typeOpts.shift();
        nameCell = h('div', { class: 'pname' }, sel(typeOpts, s.type, (v) => this.setSlot(i, 'type', v), !host),
          s.type === 'ai' ? sel(Object.entries(AI_LEVELS), s.ai, (v) => this.setSlot(i, 'ai', v), !host) : '');
      }
      const canEdit = mine || (host && s.type === 'ai');
      return h('tr', { class: active ? '' : 'inactive' },
        h('td', {}, String(i + 1)),
        h('td', {}, nameCell),
        h('td', {}, active ? sel(civOpts, s.civ, (v) => this.setSlot(i, 'civ', v), !canEdit) : ''),
        h('td', {}, active ? (() => {
          const c = sel(PLAYER_COLORS.map((pc) => [pc.id, pc.name]), s.color, (v) => this.setSlot(i, 'color', Number(v)), !canEdit);
          c.style.background = PLAYER_COLORS[s.color].hex; c.style.color = '#fff';
          return c;
        })() : ''),
        h('td', {}, active ? sel([[0, '-'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], s.team, (v) => this.setSlot(i, 'team', Number(v)), !canEdit) : ''),
        h('td', {}, s.type === 'human' && !o.local ? (st.hostId === s.clientId ? 'Chủ phòng' : s.ready ? '✔ Sẵn sàng' : '…') : ''),
      );
    });
    const setRow = (label, control) => h('tr', {}, h('td', {}, label), h('td', {}, control));
    const chk = (k) => h('input', { type: 'checkbox', checked: !!S[k], disabled: !host, onchange: (ev) => this.setSetting(k, ev.target.checked) });
    const settingsTbl = h('table', { class: 'settings' },
      setRow('Kiểu bản đồ', sel(Object.entries(MAP_TYPES), S.mapType, (v) => this.setSetting('mapType', v), !host)),
      setRow('Kích thước', sel(Object.entries(MAP_SIZES).map(([k, v]) => [k, v.vi]), S.mapSize, (v) => this.setSetting('mapSize', v), !host)),
      setRow('Luật chơi', sel(Object.entries(RULES).map(([k, v]) => [k, v.vi]), S.rules, (v) => this.setSetting('rules', v), !host)),
      setRow('Dân số tối đa', sel([25, 50, 75, 100, 125, 150, 175, 200].map((v) => [v, String(v)]), S.popLimit, (v) => this.setSetting('popLimit', Number(v)), !host)),
      setRow('Tốc độ game', sel(SPEEDS.map((v) => [v, '×' + v.toFixed(1)]), S.speed, (v) => this.setSetting('speed', Number(v)), !host)),
      setRow('Tài nguyên', sel(Object.entries(START_RESOURCES).map(([k, v]) => [k, v.vi]), S.startRes, (v) => this.setSetting('startRes', v), !host)),
      setRow('Bắt đầu ở', sel(AGE_NAMES.map((n, i) => [i, n]), S.startAge, (v) => this.setSetting('startAge', Number(v)), !host)),
      setRow('Mở bản đồ', chk('reveal')),
      setRow('Cho phép cheat', chk('cheats')),
      setRow('Đồng đội đứng gần nhau', chk('teamsTogether')),
      setRow('Khóa đội', chk('lockTeams')),
      setRow('Random có Lạc Việt (DE)', chk('allowLacViet')),
    );
    const presetBar = host ? h('div', { class: 'presets' }, ...PRESETS.map((p) => h('button', { class: 'stone-btn small', title: p.desc, onclick: () => { app.sfx.play('click'); p.apply(this); } }, p.name))) : '';
    const me = st.slots[o.myIdx];
    const actions = h('div', { class: 'row' });
    if (host) actions.appendChild(app.btn('Bắt đầu trận', () => o.onStart()));
    else if (me) actions.appendChild(app.btn(me.ready ? 'Hủy sẵn sàng' : 'Sẵn sàng', () => this.setSlot(o.myIdx, 'ready', !me.ready)));
    else actions.appendChild(h('span', { class: 'status' }, '👁 Bạn đang ở chế độ xem trận (observer)'));
    if (st.observers && st.observers.length) actions.appendChild(h('span', { class: 'status' }, ' Người xem: ' + st.observers.map((x) => x.name).join(', ')));
    actions.appendChild(app.btn(o.local ? 'Quay lại' : 'Rời phòng', () => o.onLeave()));
    let chatPanel = '';
    if (!o.local) {
      this.chatEl = h('div', { class: 'lobby-chat' });
      const inp = h('input', { placeholder: 'Nhập tin nhắn rồi Enter...', maxlength: 200, onkeydown: (ev) => { if (ev.key === 'Enter' && inp.value.trim()) { app.net.send({ t: 'chat', text: inp.value.trim() }); inp.value = ''; } } });
      chatPanel = h('div', { class: 'chat-wrap' }, this.chatEl, inp);
    }
    const rule = RULES[S.rules];
    const el = h('div', { class: 'panel lobby' },
      h('h1', {}, o.local ? 'Chơi đơn — Thiết lập trận' : `Phòng: ${st.name || ''}`),
      presetBar,
      h('div', { class: 'lobby-grid' },
        h('div', { class: 'players' },
          h('table', { class: 'slots' }, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Người chơi'), h('th', {}, 'Phe'), h('th', {}, 'Màu'), h('th', {}, 'Đội'), h('th', {}, '')), ...slotRows),
          h('div', { class: 'rule-box', html: `<b>${esc(rule.vi)}</b>: ${esc(rule.desc)}` }),
          chatPanel,
        ),
        h('div', { class: 'game-settings' }, h('h3', {}, 'Thiết lập'), settingsTbl),
      ),
      actions,
    );
    const focused = document.activeElement && this.el && this.el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' ? document.activeElement.value : null;
    app.screen('lobby-screen', el);
    this.el = el;
    if (!o.local) {
      this.renderChat();
      if (focused !== null) { const i = el.querySelector('.chat-wrap input'); i.value = focused; i.focus(); }
    }
  }
}

window.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
