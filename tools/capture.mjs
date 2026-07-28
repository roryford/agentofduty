#!/usr/bin/env node
/**
 * Headless, seeded capture of the named shot list to PNG.
 *
 * Usage:
 *   node tools/capture.mjs
 *   node tools/capture.mjs --out captures --seed 1 --port 4173
 *
 * Expects a production build in dist/ (run `npm run build` first).
 * Serves dist/, boots lockstep, pumps to each shot frame, writes PNGs.
 */

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DEFAULT_OUT = path.join(ROOT, 'captures');
const SHOTS_PATH = path.join(__dirname, 'shots.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    seed: 1,
    port: 4173,
    w: 1280,
    h: 720,
    host: '127.0.0.1',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--seed') args.seed = Number(argv[++i]) >>> 0;
    else if (a === '--port') args.port = Number(argv[++i]) | 0;
    else if (a === '--w') args.w = Number(argv[++i]) | 0;
    else if (a === '--h') args.h = Number(argv[++i]) | 0;
    else if (a === '--help') {
      console.log('Usage: node tools/capture.mjs [--out dir] [--seed N] [--port P] [--w W] [--h H]');
      process.exit(0);
    }
  }
  return args;
}

async function assertDist() {
  try {
    await access(path.join(DIST, 'index.html'));
  } catch {
    console.error('dist/ missing. Run `npm run build` first.');
    process.exit(1);
  }
}

function startStaticServer(root, host, port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const filePath = path.normalize(path.join(root, rel));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!existsSync(filePath)) {
      res.writeHead(404).end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

async function main() {
  const args = parseArgs(process.argv);
  await assertDist();

  const shots = JSON.parse(await readFile(SHOTS_PATH, 'utf8'));
  if (!Array.isArray(shots) || shots.length === 0) {
    console.error('tools/shots.json is empty or invalid');
    process.exit(1);
  }

  await mkdir(args.out, { recursive: true });
  const server = await startStaticServer(DIST, args.host, args.port);
  const base = `http://${args.host}:${args.port}`;

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--hide-scrollbars',
    ],
  });

  const page = await browser.newPage({
    viewport: { width: args.w, height: args.h },
    deviceScaleFactor: 1,
  });

  // Fail fast on page errors.
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      pageErrors.push(`console.error: ${msg.text()}`);
    }
  });

  const url =
    `${base}/index.html?lockstep=1&seed=${args.seed}` +
    `&w=${args.w}&h=${args.h}`;

  console.log(`[capture] ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  // Wait for boot: __BOOT_COMPLETE__ after 3-frame boot pump in main.
  await page.waitForFunction(
    () => window.__BOOT_COMPLETE__ === true && window.__READY__ === true,
    null,
    { timeout: 15000 },
  );

  if (pageErrors.length) {
    console.error('[capture] boot errors:\n' + pageErrors.join('\n'));
    await browser.close();
    server.close();
    process.exit(1);
  }

  // Sort shots by frame so we only pump forward.
  const ordered = [...shots].sort((a, b) => a.frame - b.frame);
  let current = 0; // frames pumped since ready

  const manifest = {
    seed: args.seed,
    width: args.w,
    height: args.h,
    shots: [],
  };

  for (const shot of ordered) {
    const target = shot.frame | 0;
    if (target < current) {
      throw new Error(`Shot ${shot.name} frame ${target} is behind cursor ${current}`);
    }
    const delta = target - current;
    if (delta > 0) {
      await page.evaluate((n) => window.__PUMP__(n), delta);
      current = target;
    }

    // Capture the WebGL canvas pixels (preserveDrawingBuffer is on).
    const dataUrl = await page.evaluate(async () => {
      const canvas = document.getElementById('game');
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error('canvas #game missing');
      }
      // Ensure a present frame is in the buffer.
      window.__PUMP__(0);
      return canvas.toDataURL('image/png');
    });

    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    const outPath = path.join(args.out, `${shot.name}.png`);
    await writeFile(outPath, buf);

    const metrics = await page.evaluate(() => window.__METRICS__());
    manifest.shots.push({
      name: shot.name,
      frame: target,
      file: `${shot.name}.png`,
      bytes: buf.length,
      drawCalls: metrics.drawCalls,
      shaderCompilesAfterReady: metrics.shaderCompilesAfterReady,
    });
    const w = metrics.drawCallsWorld ?? '?';
    const v = metrics.drawCallsView ?? '?';
    const t = metrics.drawCalls ?? '?';
    console.log(
      `[capture] ${shot.name}  frame=${target}  ${buf.length}B  draws=${t} (world=${w} view=${v})`,
    );
  }

  await writeFile(
    path.join(args.out, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  if (pageErrors.length) {
    console.error('[capture] runtime errors:\n' + pageErrors.join('\n'));
    await browser.close();
    server.close();
    process.exit(1);
  }

  await browser.close();
  server.close();
  console.log(`[capture] wrote ${ordered.length} shots → ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
