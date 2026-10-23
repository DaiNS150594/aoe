// Zoomed screenshot of a page region: node tests/zoomshot.mjs url out.png x y w h scale
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [urlPath, out, x, y, w, h, scale] = process.argv.slice(2);
const PORT = 3900 + Math.floor(Math.random() * 90);
const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
const server = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new' });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1560, height: 1400, deviceScaleFactor: Number(scale || 3) });
  await page.goto(`http://localhost:${PORT}/${urlPath}`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: out, clip: { x: +x, y: +y, width: +w, height: +h } });
} finally { await browser.close(); server.kill(); }
