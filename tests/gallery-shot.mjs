// Screenshot the sprite gallery pages.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] || 'tests/shots';
const parts = (process.argv[3] || 'units,buildings').split(',');
fs.mkdirSync(outDir, { recursive: true });
const PORT = 3600 + Math.floor(Math.random() * 300);
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
const server = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new' });
try {
  for (const part of parts) {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
    await page.setViewport({ width: 1560, height: 900 });
    await page.goto(`http://localhost:${PORT}/gallery.html?part=${part}`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(outDir, `gallery-${part}.png`), fullPage: true });
    console.log('shot', part);
  }
} finally {
  await browser.close();
  server.kill();
}
