// Browser smoke test with the locally installed Edge/Chrome (puppeteer-core).
// Usage: node tests/browser.mjs [outDir] [scenario]
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] || 'tests/shots';
const scenario = process.argv[3] || 'single';
fs.mkdirSync(outDir, { recursive: true });
const PORT = 3100 + Math.floor(Math.random() * 500);
const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p));

const server = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 900));

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--window-size=1600,900', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const errors = [];
async function newPage(name) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name} pageerror] ${e.message}\n${e.stack}`));
  return page;
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log('shot', name); };
const clickText = async (page, text) => {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(t));
    if (b) { b.click(); return true; }
    return false;
  }, text);
  if (!ok) console.log('button not found:', text);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await newPage('p1');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await sleep(500);
  await shot(page, '01-menu');
  if (scenario === 'single' || scenario === 'long') {
    await clickText(page, 'Chơi đơn');
    await sleep(400);
    await shot(page, '02-setup');
    await clickText(page, 'Bắt đầu trận');
    await sleep(2500);
    await shot(page, '03-game-start');
    // select all villagers on screen with a drag box & open build menu
    await page.mouse.move(500, 250); await page.mouse.down(); await page.mouse.move(1100, 650, { steps: 5 }); await page.mouse.up();
    await sleep(300);
    await shot(page, '04-selected');
    await page.keyboard.press('b');
    await sleep(300);
    await shot(page, '05-buildmenu');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    // click the TC
    await page.evaluate(() => { const s = window.app.session; s.input.selectTownCenter(); });
    await sleep(300);
    await shot(page, '06-tc');
    // speed up: let the AI/sim run
    await page.evaluate(() => { const s = window.app.session; s.speed = 3; });
    await sleep(scenario === 'long' ? 30000 : 8000);
    await shot(page, '07-later');
    const info = await page.evaluate(() => {
      const s = window.app.session, w = s.world;
      return { tick: w.tick, ents: w.list.length, fps: s._fps, players: w.realPlayers().map((p) => ({ n: p.name, civ: p.civId, age: p.age, pop: p.pop, res: p.res })) };
    });
    console.log(JSON.stringify(info));
  }
  if (scenario === 'play') {
    await clickText(page, 'Chơi đơn');
    await sleep(300);
    await clickText(page, 'Bắt đầu trận');
    await sleep(2000);
    const proj = (x, y) => page.evaluate((x, y) => { const r = window.app.session.renderer; const p = r.proj(x, y); return { x: p.x, y: p.y }; }, x, y);
    const state = () => page.evaluate(() => {
      const s = window.app.session, w = s.world, p = w.players[s.pid];
      const tc = [...p.buildings].find((b) => b.type === 'town_center');
      return {
        tick: w.tick, res: p.res, pop: p.pop, cap: p.popCap,
        tc: tc && { x: tc.x, y: tc.y, q: tc.queue.map((q) => q.type + 'x' + q.n), training: tc.training },
        vills: [...p.units].map((u) => ({ id: u.id, x: +u.x.toFixed(1), y: +u.y.toFixed(1), o: u.order ? u.order.type : null, t: u.order && u.order.target })),
        blds: [...p.buildings].map((b) => `${b.type}${b.built ? '' : '*'}@${b.tx},${b.ty}`),
        sel: [...s.renderer.selection],
      };
    });
    let st = await state();
    console.log('start', JSON.stringify(st));
    // 1) click the TC, press C twice
    let p = await proj(st.tc.x, st.tc.y);
    await page.mouse.click(p.x, p.y - 20);
    await sleep(200);
    await page.keyboard.press('c'); await sleep(100); await page.keyboard.press('c');
    await sleep(400);
    st = await state();
    console.log('after C,C: sel', st.sel, 'tc queue', st.tc.q, 'food', st.res.food);
    // 2) box-select the villagers, B, E, place a house south-east of the TC
    const vp = await Promise.all(st.vills.map((v) => proj(v.x, v.y)));
    const xs = vp.map((q) => q.x), ys = vp.map((q) => q.y);
    await page.mouse.move(Math.min(...xs) - 25, Math.min(...ys) - 40); await page.mouse.down();
    await page.mouse.move(Math.max(...xs) + 25, Math.max(...ys) + 15, { steps: 6 }); await page.mouse.up();
    await sleep(200);
    st = await state();
    console.log('box selected', st.sel.length);
    await page.keyboard.press('b'); await sleep(150); await page.keyboard.press('e'); await sleep(150);
    p = await proj(st.tc.x + 4.5, st.tc.y + 1);
    await page.mouse.move(p.x, p.y); await sleep(150);
    await shot(page, '30-place-house');
    await page.mouse.click(p.x, p.y);
    await sleep(600);
    st = await state();
    console.log('after place: buildings', st.blds, 'orders', st.vills.map((v) => v.o));
    // 3) right-click a berry bush with one villager
    const bush = await page.evaluate(() => { const s = window.app.session, w = s.world; const st = w.starts[s.pid]; let best = null, bd = 1e9; for (const e of w.list) if (e.type === 'berry_bush') { const d = Math.hypot(e.x - st.x, e.y - st.y); if (d < bd) { bd = d; best = e; } } return { x: best.x, y: best.y, id: best.id }; });
    const v0 = st.vills[0];
    p = await proj(v0.x, v0.y);
    await page.mouse.click(p.x, p.y - 12);
    await sleep(150);
    p = await proj(bush.x, bush.y);
    await page.mouse.click(p.x, p.y - 8, { button: 'right' });
    await sleep(400);
    st = await state();
    console.log('after right-click bush: villager0 order', st.vills.find((v) => v.id === v0.id));
    await page.evaluate(() => { window.app.session.speed = 3; });
    for (let i = 0; i < 10; i++) { await sleep(1000); }
    st = await state();
    console.log('later', JSON.stringify({ tick: st.tick, res: st.res, pop: st.pop, cap: st.cap, blds: st.blds, orders: st.vills.map((v) => v.o) }));
    await shot(page, '31-play-later');
  }
  if (scenario === 'ui') {
    await clickText(page, 'Chơi đơn');
    await sleep(300);
    await page.evaluate(() => { const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'assyrian')); if (sel) { sel.value = 'egyptian'; sel.dispatchEvent(new Event('change')); } });
    await sleep(200);
    await clickText(page, 'Bắt đầu trận');
    await sleep(1500);
    // give resources & buildings to inspect the interface (test only)
    await page.evaluate(async () => {
      const s = window.app.session, w = s.world, p = w.players[s.pid];
      const { applyTech } = await import('/src/engine/production.js');
      applyTech(w, p, 'tool_age', true); applyTech(w, p, 'bronze_age', true);
      w.refreshStats(p);
      p.res = { food: 3000, wood: 3000, gold: 3000, stone: 1000 };
      const st = w.starts[s.pid];
      const mk = (t, dx, dy) => w.spawnBuilding(t, s.pid, st.x + dx, st.y + dy, true);
      s._b = { market: mk('market', 4, -5), range: mk('archery_range', -6, 3), temple: mk('temple', 4, 3), stable: mk('stable', -6, -5) };
      for (let i = 0; i < 4; i++) w.spawnUnit('chariot_archer', s.pid, st.x + 2 + i * 0.6, st.y + 6);
      w.spawnUnit('priest', s.pid, st.x - 1, st.y + 6);
      s.renderer.fog.update();
    });
    await sleep(500);
    const sel = async (k) => page.evaluate((k) => { const s = window.app.session; s.input.selectOnly(s._b[k]); s.renderer.cam.centerOn(s._b[k].x, s._b[k].y + 2, 0); }, k);
    await sel('market'); await sleep(400); await shot(page, '40-ui-market');
    await page.keyboard.press('Escape');
    await sel('range'); await sleep(300);
    await page.evaluate(() => { const s = window.app.session; s.issue({ type: 'research', bid: s._b.market.id, tech: 'wheel' }); s.issue({ type: 'train', bid: s._b.range.id, utype: 'bowman', n: 3 }); });
    await sleep(1500);
    await shot(page, '41-ui-range');
    await sel('temple'); await sleep(400); await shot(page, '42-ui-temple');
    // hover a button to see the tooltip
    const btn = await page.$('.cmd');
    if (btn) { const bb = await btn.boundingBox(); await page.mouse.move(bb.x + 20, bb.y + 20); await sleep(300); await shot(page, '43-ui-tooltip'); }
    // multi-selection of the chariot archers
    await page.evaluate(() => { const s = window.app.session, p = s.world.players[s.pid]; s.input.select([...p.units].filter((u) => u.type !== 'villager'), false); });
    await sleep(400); await shot(page, '44-ui-multi');
  }
  if (scenario === 'screens') {
    await page.setViewport({ width: 1280, height: 720 });
    await clickText(page, 'Hướng dẫn'); await sleep(400); await shot(page, '60-help');
    await clickText(page, 'Quay lại'); await sleep(300);
    await clickText(page, 'Chơi đơn'); await sleep(300);
    await clickText(page, '4vs4 Random'); await sleep(300); await shot(page, '61-preset-4v4');
    await clickText(page, 'Bắt đầu trận'); await sleep(2500);
    await page.keyboard.press('F10'); await sleep(300); await shot(page, '62-menu');
    await page.keyboard.press('F10'); await sleep(200);
    await clickText(page, 'Ngoại giao'); await sleep(300); await shot(page, '63-diplomacy');
    await clickText(page, 'Đóng'); await sleep(200);
    await page.keyboard.press('Enter'); await sleep(200);
    await page.keyboard.type('gg wp, chơi lại nhé!'); await sleep(100); await page.keyboard.press('Enter'); await sleep(300);
    await shot(page, '64-chat');
  }
  if (scenario === 'closeup') {
    await page.evaluate(() => {
      window.app.startGame({ mapType: 'hill_country', mapSize: 'normal', rules: 'd3kt', popLimit: 200, startRes: 'default', startAge: 0, speed: 2, reveal: true,
        seed: 4242, players: [{ id: 1, name: 'Máy Assy', civ: 'assyrian', color: 0, team: 0, ai: 'hardest' }, { id: 2, name: 'Máy Ya', civ: 'yamato', color: 1, team: 0, ai: 'hardest' }] }, 0, null);
    });
    await sleep(1200);
    const focus = async (what, name) => {
      const ok = await page.evaluate((what) => {
        const s = window.app.session, w = s.world;
        let t = null;
        if (what === 'farm') t = w.list.find((e) => e.type === 'farm' && e.built && e.farmer);
        if (what === 'fight') t = w.list.find((e) => e.kind === 'unit' && e.owner && e.order && e.order.type === 'attack' && e.type !== 'villager');
        if (what === 'wood') t = w.list.find((e) => e.kind === 'unit' && e.task === 'woodcutter' && e.anim === 'work');
        if (!t) return false;
        s.renderer.cam.centerOn(t.x, t.y, w.map.heightAt(t.x, t.y));
        s.renderer.cam.zoom = 1.7;
        return true;
      }, what);
      if (!ok) { console.log('no', what); return; }
      await sleep(700);
      await shot(page, name);
    };
    await page.evaluate(() => { const s = window.app.session, w = s.world; while (w.tick < 13 * 600) w.step(); });
    await focus('wood', '70-wood');
    await page.evaluate(() => { const s = window.app.session, w = s.world; while (w.tick < 19 * 600) w.step(); });
    await focus('farm', '71-farm');
    for (let m = 20; m < 40; m++) {
      const fight = await page.evaluate((m) => { const s = window.app.session, w = s.world; while (w.tick < m * 600) w.step(); return w.list.some((e) => e.kind === 'unit' && e.owner && e.order && e.order.type === 'attack' && e.type !== 'villager'); }, m);
      if (fight) { await focus('fight', '72-fight'); break; }
    }
  }
  if (scenario === 'cliff') {
    await page.evaluate(() => {
      window.app.startGame({ mapType: 'hill_country', mapSize: 'normal', rules: 'd3kt', popLimit: 200, startRes: 'default', startAge: 0, speed: 2, reveal: true,
        seed: 4242, players: [{ id: 1, name: 'A', civ: 'roman', color: 0, team: 0, ai: 'hard' }, { id: 2, name: 'B', civ: 'persian', color: 1, team: 0, ai: 'hard' }] }, 0, null);
    });
    await sleep(1200);
    await page.evaluate(() => {
      const s = window.app.session, m = s.world.map;
      const c = s.world.list.find((e) => e.kind === 'cliff');
      if (c) s.renderer.cam.centerOn(c.x, c.y, m.heightAt(c.x, c.y));
    });
    await sleep(1500);
    await shot(page, '50-cliff');
  }
  if (scenario === 'spectate') {
    const minutes = Number(process.argv[4] || 15);
    await page.evaluate(() => {
      window.app.startGame({ mapType: 'hill_country', mapSize: 'normal', rules: 'd3kt', popLimit: 200, startRes: 'default', startAge: 0, speed: 2, reveal: true,
        seed: 4242, players: [{ id: 1, name: 'Máy Shang', civ: 'shang', color: 0, team: 0, ai: 'hardest' }, { id: 2, name: 'Máy Yamato', civ: 'yamato', color: 1, team: 0, ai: 'hardest' }] }, 0, null);
    });
    await sleep(1500);
    await shot(page, '20-spectate-start');
    for (const m of [minutes, minutes + 5, minutes + 10]) {
      const info = await page.evaluate((target) => {
        const s = window.app.session, w = s.world;
        const t0 = performance.now();
        while (w.tick < target * 600 && !w.over) { w.step(); s.renderer.onEvents(w.events, performance.now()); }
        // centre on the biggest fight, else on player 1's base
        let best = null;
        for (const e of w.list) if (e.kind === 'unit' && e.owner && e.order && e.order.type === 'attack') { best = e; break; }
        const p1 = w.players[1];
        let tc = [...p1.buildings].find((b) => b.type === 'town_center') || [...p1.buildings][0];
        const c = best || tc;
        if (c) s.renderer.cam.centerOn(c.x, c.y, w.map.heightAt(c.x, c.y));
        s.renderer.fog.update();
        return { ms: Math.round(performance.now() - t0), tick: w.tick, over: w.over, fight: !!best, players: w.realPlayers().map((p) => `${p.name} age=${p.age} pop=${p.pop} bld=${p.buildings.size} killed=${p.stats.killed}`) };
      }, m);
      console.log(JSON.stringify(info));
      await sleep(800);
      await shot(page, `21-spectate-${m}min`);
      await page.evaluate(() => { const s = window.app.session, w = s.world; const p = w.players[2]; const tc = [...p.buildings].find((b) => b.type === 'town_center') || [...p.buildings][0]; if (tc) s.renderer.cam.centerOn(tc.x, tc.y, w.map.heightAt(tc.x, tc.y)); });
      await sleep(500);
      await shot(page, `22-spectate-p2-${m}min`);
    }
  }
  if (scenario === 'rejoin') {
    const p2 = await newPage('p2');
    await clickText(page, 'Chơi mạng'); await sleep(800);
    await p2.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
    await clickText(p2, 'Chơi mạng'); await sleep(800);
    await clickText(page, 'Tạo phòng mới'); await sleep(600);
    await clickText(p2, 'Vào'); await sleep(600);
    await clickText(p2, 'Sẵn sàng'); await sleep(400);
    await clickText(page, 'Bắt đầu trận'); await sleep(2500);
    for (let i = 0; i < 8; i++) { await (i % 2 ? page : p2).bringToFront(); await sleep(600); }
    // p2 drops (reload the page = new websocket, same key in localStorage)
    await p2.reload({ waitUntil: 'networkidle0' });
    await sleep(500);
    await clickText(p2, 'Chơi mạng');
    for (let i = 0; i < 14; i++) { await (i % 2 ? page : p2).bringToFront(); await sleep(700); }
    const s1 = await page.evaluate(() => ({ t: window.app.session.world.tick, log: [...(window.app.session.hashLog || new Map())] }));
    const s2 = await p2.evaluate(() => ({ t: window.app.session && window.app.session.world.tick, log: [...((window.app.session && window.app.session.hashLog) || new Map())] }));
    const m2 = new Map(s2.log);
    let same = 0, diff = 0;
    for (const [n, hv] of s1.log) if (m2.has(n)) { if (m2.get(n) === hv) same++; else diff++; }
    console.log('after rejoin: p1 tick', s1.t, 'p2 tick', s2.t, 'compared', same + diff, 'equal', same, 'DIFFERENT', diff);
    await shot(p2, '15-rejoined');
  }
  if (scenario === 'mp') {
    const p2 = await newPage('p2');
    await clickText(page, 'Chơi mạng');
    await sleep(800);
    await p2.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
    await clickText(p2, 'Chơi mạng');
    await sleep(800);
    await clickText(page, 'Tạo phòng mới');
    await sleep(600);
    await shot(page, '10-room');
    await p2.evaluate(() => {});
    await sleep(500);
    await clickText(p2, 'Vào');
    await sleep(600);
    await shot(p2, '11-joined');
    await clickText(p2, 'Sẵn sàng');
    await sleep(400);
    await clickText(page, 'Bắt đầu trận');
    await sleep(3000);
    await shot(page, '12-mp-p1');
    await shot(p2, '13-mp-p2');
    // p1 trains a villager, p2 too
    for (const pg of [page, p2]) await pg.evaluate(() => { const s = window.app.session; s.input.selectTownCenter(); });
    await sleep(200);
    for (const pg of [page, p2]) await pg.keyboard.press('c');
    // keep both tabs running (background tabs throttle requestAnimationFrame)
    for (let i = 0; i < 16; i++) { await (i % 2 ? page : p2).bringToFront(); await sleep(700); }
    // p2 sends a move order for its villagers
    await p2.evaluate(() => { const s = window.app.session; const p = s.world.players[s.pid]; const ids = [...p.units].map((u) => u.id); s.issue({ type: 'move', ids, x: s.world.starts[s.pid].x + 6, y: s.world.starts[s.pid].y + 6 }); });
    for (let i = 0; i < 16; i++) { await (i % 2 ? page : p2).bringToFront(); await sleep(700); }
    const h1 = await page.evaluate(() => ({ t: window.app.session.world.tick, log: [...(window.app.session.hashLog || new Map())] }));
    const h2 = await p2.evaluate(() => ({ t: window.app.session.world.tick, log: [...(window.app.session.hashLog || new Map())] }));
    const m2 = new Map(h2.log);
    let same = 0, diff = 0;
    for (const [n, hv] of h1.log) if (m2.has(n)) { if (m2.get(n) === hv) same++; else diff++; }
    console.log('p1 tick', h1.t, 'p2 tick', h2.t, 'hash turns compared:', same + diff, 'equal:', same, 'DIFFERENT:', diff);
    await shot(page, '14-mp-later');
  }
} catch (e) {
  console.error('TEST ERROR', e);
} finally {
  console.log('---- console errors ----');
  console.log(errors.slice(0, 40).join('\n') || '(none)');
  await browser.close();
  server.kill();
}
