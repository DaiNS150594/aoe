// Đế Chế Web — game server.
//  * Serves the static client (public/).
//  * WebSocket lobby: rooms, slots (civ / colour / team / AI), chat.
//  * Lockstep relay: every TURN the server broadcasts the commands it received
//    from players; each client simulates the same deterministic world.
//    The server never simulates the game, so it stays tiny and cheap.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createAoeDataHandler } from './aoedata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const TICK_MS = 100, TICKS_PER_TURN = 2;   // must match public/src/engine/constants.js
const MAX_LAG_TURNS = 30;                  // hold the game when a client falls this far behind
const aoeData = createAoeDataHandler(process.env.AOE_DIR || '');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url.startsWith('/aoe-data/')) {
    if (aoeData && aoeData(req, res, url)) return;
    if (url === '/aoe-data/manifest.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"files":[]}'); return; }
    res.writeHead(404); res.end(); return;
  }
  if (url === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'de-che-web', rooms: rooms.size, players: clients.size }));
    return;
  }
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if ((err || !st.isFile()) && url === '/assets/aoe/manifest.json') {
      // the game files have not been copied into the project (tools/import-aoe.mjs)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); res.end('{}'); return;
    }
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    // revalidated on every load, but unchanged files (the big game archives) come from the browser cache
    const modified = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === modified) { res.writeHead(304); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-cache', 'Last-Modified': modified,
    });
    fs.createReadStream(file).pipe(res);
  });
});

// ------------------------------------------------------------------ state
const clients = new Map(); // id -> client
const rooms = new Map();   // id -> room
let nextClient = 1, nextRoom = 1;

const DEFAULT_SETTINGS = {
  mapType: 'hill_country', mapSize: 'large', rules: 'd3kt', popLimit: 200, startRes: 'default', startAge: 0,
  speed: 2.0, reveal: false, cheats: false, teamsTogether: true, lockTeams: true, victory: 'conquest', allowLacViet: false,
};
const CIVS = ['random', 'assyrian', 'babylonian', 'carthaginian', 'choson', 'egyptian', 'greek', 'hittite', 'macedonian',
  'minoan', 'palmyran', 'persian', 'phoenician', 'roman', 'shang', 'sumerian', 'yamato', 'lac_viet'];
const AI_LEVELS = ['easiest', 'easy', 'moderate', 'hard', 'hardest'];

function send(c, msg) { if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); }
function roomClients(room) { return [...clients.values()].filter((c) => c.roomId === room.id); }
function broadcast(room, msg) { const s = JSON.stringify(msg); for (const c of roomClients(room)) if (c.ws.readyState === 1) c.ws.send(s); }

function newSlot(i) { return { idx: i, type: 'open', clientId: 0, name: '', civ: 'random', color: i, team: 0, ai: 'moderate', ready: false, connected: true }; }

function roomPublic(room) {
  return {
    id: room.id, name: room.name, hostId: room.hostId, state: room.state, settings: room.settings,
    slots: room.slots.map((s) => ({ ...s })),
    observers: [...(room.observers || [])].map((id) => ({ id, name: clients.get(id)?.name || '?' })),
  };
}
function roomSummary(room) {
  const humans = room.slots.filter((s) => s.type === 'human').length;
  const open = room.slots.filter((s) => s.type === 'open').length;
  return { id: room.id, name: room.name, state: room.state, humans, open, observers: (room.observers || new Set()).size, settings: room.settings, host: clients.get(room.hostId)?.name || '?' };
}
function sendRoomList(c) { send(c, { t: 'rooms', rooms: [...rooms.values()].map(roomSummary) }); }
function broadcastRoomList() { for (const c of clients.values()) if (!c.roomId) sendRoomList(c); }
function pushRoom(room) { broadcast(room, { t: 'room', room: roomPublic(room) }); broadcastRoomList(); }

function leaveRoom(c, silent) {
  const room = rooms.get(c.roomId);
  c.roomId = 0;
  if (!room) return;
  if (room.observers && room.observers.has(c.id)) {
    room.observers.delete(c.id);
    if (!silent) pushRoom(room);
    if (room.state === 'playing' && !roomClients(room).length) endRoom(room);
    return;
  }
  const slot = room.slots.find((s) => s.type === 'human' && s.clientId === c.id);
  if (room.state === 'playing' && room.game) {
    if (slot) { slot.connected = false; broadcast(room, { t: 'dropped', playerId: slot.playerId, name: slot.name }); }
    if (!roomClients(room).length) endRoom(room);
    return;
  }
  if (slot) Object.assign(slot, newSlot(slot.idx), { color: slot.color });
  if (room.hostId === c.id) {
    const other = roomClients(room)[0];
    if (other) room.hostId = other.id; else { endRoom(room); return; }
  }
  if (!silent) pushRoom(room);
}

function endRoom(room) {
  if (room.game && room.game.timer) clearInterval(room.game.timer);
  rooms.delete(room.id);
  broadcastRoomList();
}

// ------------------------------------------------------------- lockstep
function startGame(room) {
  const players = [];
  let pid = 1;
  for (const s of room.slots) {
    if (s.type !== 'human' && s.type !== 'ai') continue;
    s.playerId = pid;
    players.push({ id: pid, name: s.type === 'ai' ? `Máy ${pid} (${s.ai})` : s.name, civ: s.civ, color: s.color, team: s.team, ai: s.type === 'ai' ? s.ai : null, slot: s.idx });
    pid++;
  }
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const speed = Number(room.settings.speed) || 2;
  const turnMs = Math.round((TICKS_PER_TURN * TICK_MS) / speed);
  room.state = 'playing';
  room.game = { seed, players, turn: 0, pending: [], log: [], turnMs, acks: new Map(), hashes: new Map(), paused: false, started: Date.now(), over: false };
  for (const c of roomClients(room)) {
    const slot = room.slots.find((s) => s.type === 'human' && s.clientId === c.id);
    send(c, { t: 'start', seed, settings: { ...room.settings, seed, players }, playerId: slot ? slot.playerId : 0, turnMs, observer: !slot });
  }
  pushRoom(room);
  room.game.timer = setInterval(() => gameTick(room), turnMs);
}

function gameTick(room) {
  const g = room.game;
  if (!g || g.paused || g.over) return;
  // hold if a connected human is far behind
  const humans = room.slots.filter((s) => s.type === 'human' && s.connected);
  let minAck = Infinity;
  for (const s of humans) { const a = g.acks.get(s.clientId); minAck = Math.min(minAck, a === undefined ? -1 : a); }
  if (humans.length && g.turn - minAck > MAX_LAG_TURNS) {
    if (!g.waiting) { g.waiting = true; broadcast(room, { t: 'wait', on: true }); }
    return;
  }
  if (g.waiting) { g.waiting = false; broadcast(room, { t: 'wait', on: false }); }
  const cmds = g.pending;
  g.pending = [];
  const msg = { t: 'turn', n: g.turn, c: cmds };
  g.log.push(cmds.length ? [g.turn, cmds] : null);
  g.turn++;
  broadcast(room, msg);
}

// --------------------------------------------------------------- handlers
function handle(c, m) {
  switch (m.t) {
    case 'hello': {
      c.name = String(m.name || 'Người chơi').slice(0, 24);
      // reconnect to a running game
      if (m.key) {
        c.key = String(m.key).slice(0, 64);
        for (const room of rooms.values()) {
          if (room.state !== 'playing') continue;
          const slot = room.slots.find((s) => s.type === 'human' && s.key === c.key && !s.connected);
          if (slot) {
            slot.clientId = c.id; slot.connected = true; c.roomId = room.id;
            const g = room.game;
            send(c, { t: 'welcome', id: c.id });
            send(c, { t: 'start', seed: g.seed, settings: { ...room.settings, seed: g.seed, players: g.players }, playerId: slot.playerId, turnMs: g.turnMs, rejoin: true });
            send(c, { t: 'catchup', turns: g.log.map((x, i) => (x ? x : [i, []])).map(([n, cmds]) => ({ n, c: cmds })) });
            broadcast(room, { t: 'chat', from: 'Hệ thống', text: `${c.name} đã kết nối lại.`, sys: true });
            return;
          }
        }
      }
      send(c, { t: 'welcome', id: c.id });
      sendRoomList(c);
      return;
    }
    case 'listRooms': sendRoomList(c); return;
    case 'createRoom': {
      if (c.roomId) leaveRoom(c);
      const room = {
        id: nextRoom++, name: String(m.name || `Phòng của ${c.name}`).slice(0, 40), hostId: c.id, state: 'lobby',
        settings: { ...DEFAULT_SETTINGS }, slots: Array.from({ length: 8 }, (_, i) => newSlot(i)),
      };
      room.slots[0] = { ...newSlot(0), type: 'human', clientId: c.id, name: c.name, key: c.key };
      room.slots[1].type = 'ai';
      for (let i = 2; i < 8; i++) room.slots[i].type = i < 2 ? 'open' : (i < 4 ? 'open' : 'closed');
      rooms.set(room.id, room);
      c.roomId = room.id;
      pushRoom(room);
      return;
    }
    case 'joinRoom': {
      const room = rooms.get(m.id);
      if (!room) { send(c, { t: 'error', msg: 'Phòng không tồn tại' }); return; }
      if (m.observe) {
        if (c.roomId) leaveRoom(c);
        room.observers = room.observers || new Set();
        room.observers.add(c.id);
        c.roomId = room.id;
        if (room.state === 'playing' && room.game) {
          const g = room.game;
          send(c, { t: 'start', seed: g.seed, settings: { ...room.settings, seed: g.seed, players: g.players }, playerId: 0, turnMs: g.turnMs, rejoin: true, observer: true });
          send(c, { t: 'catchup', turns: g.log.map((x, i) => (x ? x : [i, []])).map(([n, cmds]) => ({ n, c: cmds })) });
        }
        pushRoom(room);
        broadcast(room, { t: 'chat', from: 'Hệ thống', text: `${c.name} đang xem trận.`, sys: true });
        return;
      }
      if (room.state !== 'lobby') { send(c, { t: 'error', msg: 'Trận đấu đang diễn ra' }); return; }
      const slot = room.slots.find((s) => s.type === 'open');
      if (!slot) { send(c, { t: 'error', msg: 'Phòng đã đầy' }); return; }
      if (c.roomId) leaveRoom(c);
      Object.assign(slot, { type: 'human', clientId: c.id, name: c.name, key: c.key, ready: false, connected: true });
      c.roomId = room.id;
      pushRoom(room);
      broadcast(room, { t: 'chat', from: 'Hệ thống', text: `${c.name} đã vào phòng.`, sys: true });
      return;
    }
    case 'leaveRoom': leaveRoom(c); sendRoomList(c); return;
    case 'setSlot': {
      const room = rooms.get(c.roomId);
      if (!room || room.state !== 'lobby') return;
      const s = room.slots[m.idx | 0];
      if (!s) return;
      const isHost = room.hostId === c.id;
      const own = s.type === 'human' && s.clientId === c.id;
      if (!own && !isHost) return;
      switch (m.field) {
        case 'type':
          if (!isHost) return;
          if (m.value === 'kick') {
            if (s.type === 'human' && s.clientId !== c.id) {
              const kc = clients.get(s.clientId);
              if (kc) { kc.roomId = 0; send(kc, { t: 'kicked' }); sendRoomList(kc); }
              Object.assign(s, newSlot(s.idx));
            }
            break;
          }
          if (s.type === 'human') return;
          if (['open', 'closed', 'ai'].includes(m.value)) s.type = m.value;
          break;
        case 'civ': if (CIVS.includes(m.value) && (own || (isHost && s.type === 'ai'))) s.civ = m.value; break;
        case 'color': {
          const v = m.value | 0;
          if (v >= 0 && v < 8 && (own || (isHost && s.type === 'ai'))) {
            const other = room.slots.find((o) => o !== s && (o.type === 'human' || o.type === 'ai') && o.color === v);
            if (other) other.color = s.color;
            s.color = v;
          }
          break;
        }
        case 'team': { const v = m.value | 0; if (v >= 0 && v <= 4 && (own || (isHost && s.type === 'ai'))) s.team = v; break; }
        case 'ai': if (AI_LEVELS.includes(m.value) && isHost && s.type === 'ai') s.ai = m.value; break;
        case 'ready': if (own) s.ready = !!m.value; break;
        default: return;
      }
      pushRoom(room);
      return;
    }
    case 'setSettings': {
      const room = rooms.get(c.roomId);
      if (!room || room.hostId !== c.id || room.state !== 'lobby') return;
      const st = m.settings || {};
      for (const k of Object.keys(DEFAULT_SETTINGS)) if (st[k] !== undefined) room.settings[k] = st[k];
      for (const s of room.slots) if (s.type === 'human' && s.clientId !== room.hostId) s.ready = false;
      pushRoom(room);
      return;
    }
    case 'start': {
      const room = rooms.get(c.roomId);
      if (!room || room.hostId !== c.id || room.state !== 'lobby') return;
      const active = room.slots.filter((s) => s.type === 'human' || s.type === 'ai');
      if (active.length < 2) { send(c, { t: 'error', msg: 'Cần ít nhất 2 người chơi (có thể thêm máy)' }); return; }
      const notReady = room.slots.filter((s) => s.type === 'human' && s.clientId !== room.hostId && !s.ready);
      if (notReady.length) { send(c, { t: 'error', msg: 'Còn người chơi chưa sẵn sàng: ' + notReady.map((s) => s.name).join(', ') }); return; }
      startGame(room);
      return;
    }
    case 'chat': {
      const room = rooms.get(c.roomId);
      const text = String(m.text || '').slice(0, 200);
      if (!text) return;
      if (!room) return;
      const slot = room.slots.find((s) => s.type === 'human' && s.clientId === c.id);
      const msg = { t: 'chat', from: c.name, text, color: slot ? slot.color : 0, scope: m.scope === 'team' ? 'team' : 'all', team: slot ? slot.team : 0 };
      if (msg.scope === 'team' && slot && slot.team) {
        for (const cc of roomClients(room)) {
          const s2 = room.slots.find((s) => s.type === 'human' && s.clientId === cc.id);
          if (s2 && s2.team === slot.team) send(cc, msg);
        }
      } else broadcast(room, msg);
      return;
    }
    // ------------------------------------------------------------ in game
    case 'cmd': {
      const room = rooms.get(c.roomId);
      if (!room || !room.game || room.game.over) return;
      const slot = room.slots.find((s) => s.type === 'human' && s.clientId === c.id);
      if (!slot || !m.c || typeof m.c !== 'object') return;
      if (room.game.pending.length > 500) return;
      room.game.pending.push([slot.playerId, m.c]);
      return;
    }
    case 'ack': {
      const room = rooms.get(c.roomId);
      if (room && room.game) room.game.acks.set(c.id, m.n | 0);
      return;
    }
    case 'hash': {
      const room = rooms.get(c.roomId);
      if (!room || !room.game) return;
      const g = room.game;
      const key = m.n | 0;
      const prev = g.hashes.get(key);
      if (prev === undefined) g.hashes.set(key, m.h);
      else if (prev !== m.h && !g.desynced) { g.desynced = true; broadcast(room, { t: 'desync', n: key }); }
      if (g.hashes.size > 200) g.hashes.delete(g.hashes.keys().next().value);
      return;
    }
    case 'pause': {
      const room = rooms.get(c.roomId);
      if (!room || !room.game) return;
      room.game.paused = !!m.on;
      broadcast(room, { t: 'paused', on: room.game.paused, by: c.name });
      return;
    }
    case 'gameOver': {
      const room = rooms.get(c.roomId);
      if (!room || !room.game || room.game.over) return;
      room.game.over = true;
      clearInterval(room.game.timer);
      setTimeout(() => {
        if (!rooms.has(room.id)) return;
        room.state = 'lobby';
        room.game = null;
        for (const s of room.slots) { s.ready = false; if (s.type === 'human' && !s.connected) Object.assign(s, newSlot(s.idx)); }
        pushRoom(room);
      }, 3000);
      return;
    }
    case 'leaveGame': leaveRoom(c); sendRoomList(c); return;
    default:
  }
}

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const c = { id: nextClient++, ws, name: 'Người chơi', roomId: 0, key: '' };
  clients.set(c.id, c);
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    try { handle(c, m); } catch (e) { console.error('handler error', e); }
  });
  ws.on('close', () => { leaveRoom(c); clients.delete(c.id); broadcastRoomList(); });
});

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('==============================================');
  console.log(' ĐẾ CHẾ WEB - Age of Empires I (Rise of Rome)');
  console.log('==============================================');
  console.log(` Mở trình duyệt:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(` Chơi mạng LAN:    http://${ip}:${PORT}`);
  console.log('');
});
