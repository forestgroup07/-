#!/usr/bin/env node
/**
 * Record cup-shake-on-concept.html → mp4 (Chrome headless + ffmpeg)
 */
import { spawn } from 'child_process';
import { mkdirSync, existsSync, rmSync, createReadStream } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import http from 'http';

const require = createRequire('/tmp/sicbo-rec/package.json');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'export', 'cup-shake-on-concept-frames');
const OUT_MP4 = join(ROOT, 'export', 'cup-shake-on-concept-v109.mp4');
const PORT = 8791;
const FPS = 24;
const DURATION_MS = 4500; // shake+settle+hold
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/cup-shake-on-concept.html';
      const file = join(ROOT, p.replace(/^\//, ''));
      if (!file.startsWith(ROOT) || !existsSync(file)) {
        res.writeHead(404); res.end('no'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      createReadStream(file).pipe(res);
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(ROOT, 'export'), { recursive: true });

  const server = await startServer();
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1280,720'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/cup-shake-on-concept.html?record=1&v=109`, {
    waitUntil: 'networkidle0',
    timeout: 60000,
  });
  await page.waitForFunction('window.__READY === true', { timeout: 60000 });
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  // fixed faces + start shake, then capture by wall clock
  await page.evaluate(async () => {
    window.__SHAKE_DONE = false;
    window.__playShake([4, 6, 3]);
  });

  const totalFrames = Math.ceil((DURATION_MS / 1000) * FPS);
  const t0 = Date.now();
  for (let i = 0; i < totalFrames; i++) {
    const target = t0 + (i * 1000) / FPS;
    const wait = target - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const path = join(OUT_DIR, `f${String(i).padStart(4, '0')}.jpg`);
    await page.screenshot({ path, type: 'jpeg', quality: 90 });
    if (i % 12 === 0) console.log(`frame ${i}/${totalFrames}`);
  }

  await browser.close();
  server.close();

  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-framerate', String(FPS),
      '-i', join(OUT_DIR, 'f%04d.jpg'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20',
      OUT_MP4,
    ], { stdio: 'inherit' });
    ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg ' + code))));
  });
  console.log('WROTE', OUT_MP4);
}

main().catch((e) => { console.error(e); process.exit(1); });
