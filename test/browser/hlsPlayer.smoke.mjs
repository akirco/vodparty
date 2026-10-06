// Real-browser smoke test for HlsPlayer.
//
// The lazy hls.js load shipped a bug that typecheck, lint and `vite build`
// all passed: `setHls(mod)` handed React a class, which React invoked as a
// state updater -> "class constructors must be invoked with 'new'". Only
// actually rendering the component exposes it, so this drives a real browser.
//
// Run with:  node test/browser/hlsPlayer.smoke.mjs
// Skips (exit 0) when no Chromium is available.

import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

/**
 * Prefer a full Chrome build: `executablePath()` defaults to the headless
 * *shell*, which is a separate download and often absent. Falls back to
 * whatever is on the machine.
 */
const resolveBrowser = () => {
  const candidates = [
    process.env.CHROME_PATH,
    chromium.executablePath?.(),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
};

const executablePath = resolveBrowser();

if (!executablePath) {
  console.log('SKIP: no Chromium available');
  process.exit(0);
}

const root = process.cwd();

// A page that loads the real component through vite and renders it.
const html = `<!doctype html>
<html><body>
<div id="root"></div>
<script type="module">
import { HlsPlayer } from '/src/components/HlsPlayer.tsx';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));

createRoot(document.getElementById('root')).render(
  createElement(HlsPlayer, {
    // Force the hls.js path regardless of engine support.
    src: 'http://127.0.0.1:1/does-not-exist.m3u8',
    strategy: 'hlsjs',
    debug: true,
    nativeTimeoutMs: 1500,
  }),
);
// Signal that React has committed.
setTimeout(() => { window.__mounted = true; }, 800);
</script>
</body></html>`;

let vite;
let browser;
let failures = 0;

const check = (name, ok, extra = '') => {
  if (ok) console.log(`PASS  ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name} ${extra}`);
  }
};

try {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({
    configFile: `${root}/vite.config.ts`,
    root,
    server: { middlewareMode: true, port: 5199 },
    logLevel: 'error',
  });

  const app = vite.middlewares;
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
      return;
    }
    app(req, res, () => {
      res.writeHead(404);
      res.end('not found');
    });
  });
  await new Promise((r) => server.listen(5199, r));

  browser = await chromium.launch({ executablePath });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto('http://localhost:5199/', { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  const errors = await page.evaluate(() => window.__errors ?? []);
  const mounted = await page.evaluate(() => window.__mounted === true);

  check('component mounted without throwing', mounted);
  check(
    'no "class constructors must be invoked with new" error',
    ![...errors, ...consoleErrors].some((e) =>
      /class constructors must be invoked with 'new'/.test(e),
    ),
    [...errors, ...consoleErrors].join(' | '),
  );
  check('no uncaught page errors', errors.length === 0, errors.join(' | '));

  // The hls.js path was taken (strategy forced), so the module must have been
  // fetched lazily and the player attached rather than bailing at setup.
  const log = consoleErrors.join('\n');
  check(
    'reached hls.js attachment (setup did not fail)',
    !/Playback failed \(setup\)|hls\.js was selected but is not loaded/.test(
      log,
    ),
    log.slice(0, 200),
  );

  await page.close();
} catch (err) {
  console.log(`FAIL  harness error: ${err.message}`);
  failures += 1;
} finally {
  await browser?.close();
  await vite?.close();
}

console.log(
  failures === 0
    ? '\nbrowser smoke: OK'
    : `\nbrowser smoke: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
