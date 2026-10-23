// FPS measurement: 8 AI players on a gigantic map, spectator view.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const out = process.argv[2];
const PORT = 3700 + Math.floor(Math.random() * 200);
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
const server = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--window-size=1920,1080'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const civs = ['shang', 'yamato', 'assyrian', 'hittite', 'greek', 'egyptian', 'choson', 'persian'];
    window.app.startGame({ mapType: 'hill_country', mapSize: 'gigantic', rules: 'd3kt', popLimit: 200, startRes: 'default', startAge: 0, speed: 2, reveal: true, seed: 99,
      players: civs.map((c, i) => ({ id: i + 1, name: 'AI ' + (i + 1), civ: c, color: i, team: (i % 2) + 1, ai: 'hardest' })) }, 0, null);
  });
  await new Promise((r) => setTimeout(r, 1500));
  const r = await page.evaluate(async () => {
    const s = window.app.session, w = s.world;
    while (w.tick < 22 * 600) w.step();
    // find a busy spot
    const p = w.players[1];
    const tc = [...p.buildings].find((b) => b.type === 'town_center');
    s.renderer.cam.centerOn(tc.x, tc.y, 0);
    s.renderer.cam.zoom = 0.8;
    await new Promise((res) => setTimeout(res, 1500));
    let frames = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { frames++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const units = w.list.filter((e) => e.kind === 'unit').length;
    return { fps: frames / 5, units, ents: w.list.length, tick: w.tick, ages: w.realPlayers().map((q) => q.age).join('') };
  });
  console.log(JSON.stringify(r));
  if (out) await page.screenshot({ path: out });
} finally { await browser.close(); server.kill(); }
