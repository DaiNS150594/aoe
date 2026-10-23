// Browser check of the original-asset mode (needs the player's own Rise of
// Rome files): AOE_DIR=<game folder> node tests/aoe-assets.mjs [outDir]
// Starts the server with AOE_DIR, loads the menu (assets come from the local
// /aoe-data route), starts a single-player game and takes screenshots.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (!process.env.AOE_DIR) { console.log('AOE_DIR not set — skipping original-asset browser test.'); process.exit(0); }
const outDir = process.argv[2] || 'tests/shots-aoe';
fs.mkdirSync(outDir, { recursive: true });
const PORT = 3600 + Math.floor(Math.random() * 300);
const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p));
const server = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
server.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
await new Promise((r) => setTimeout(r, 900));
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--window-size=1600,900', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log('shot', name); };
const clickText = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(t)); if (b) b.click(); return !!b; }, t);
try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  for (let i = 0; i < 60; i++) { if (await page.evaluate(() => document.querySelector('.aoe-ok, .aoe-err') !== null)) break; await sleep(250); }
  await shot('01-menu');
  console.log('status:', await page.evaluate(() => (document.querySelector('.aoe-box') || {}).innerText));
  await clickText('Chơi đơn');
  await sleep(300);
  await clickText('Bắt đầu trận');
  await sleep(2500);
  await shot('02-start');
  await page.evaluate(() => { const s = window.app.session; s.speed = 3; });
  await sleep(Number(process.env.WAIT || 20000));
  await shot('03-later');
  // zoom in on our town centre
  await page.evaluate(() => { const s = window.app.session, r = s.renderer, st = s.world.starts[s.pid]; r.cam.zoom = 2; r.cam.centerOn(st.x + 0.5, st.y + 2.5, s.world.map.heightAt(st.x, st.y)); });
  await sleep(600);
  await shot('04-zoom');
  const info = await page.evaluate(() => { const s = window.app.session, w = s.world; return { tick: w.tick, fps: s._fps, players: w.realPlayers().map((p) => ({ civ: p.civId, age: p.age, pop: p.pop })) }; });
  console.log(JSON.stringify(info));
} catch (e) { console.error('TEST ERROR', e); }
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 20).join('\n') : 'no console errors');
await browser.close();
server.kill();
