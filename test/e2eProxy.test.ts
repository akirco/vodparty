// End-to-end check that the running express server actually rejects SSRF
// attempts, rather than only asserting on the shared helper in isolation.
import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { after, before, describe, it } from 'node:test';

const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess;

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
};

before(async () => {
  server = spawn('node', ['server.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForServer();
});

after(() => {
  server?.kill('SIGTERM');
});

const get = (url: string) =>
  fetch(`${BASE}/api/proxy?url=${encodeURIComponent(url)}`);

describe('/api/proxy SSRF protection (live server)', () => {
  const blocked = [
    'http://127.0.0.1:22/',
    'http://localhost:3000/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://redis.internal/',
    'file:///etc/passwd',
  ];

  for (const url of blocked) {
    it(`rejects ${url}`, async () => {
      const res = await get(url);
      assert.equal(res.status, 403, `${url} returned ${res.status}`);
    });
  }

  it('requires a url parameter', async () => {
    const res = await fetch(`${BASE}/api/proxy`);
    assert.equal(res.status, 400);
  });

  it('does not attempt a real request for a blocked target', async () => {
    // 403 must come from validation, before any socket is opened.
    const started = Date.now();
    const res = await get('http://169.254.169.254/latest/meta-data/');
    assert.equal(res.status, 403);
    assert.ok(Date.now() - started < 2000, 'rejection should be immediate');
  });

  it('returns 502 for an unreachable public host', async () => {
    const res = await get('http://this-host-should-not-resolve.invalid/x');
    assert.ok([502, 504].includes(res.status), `got ${res.status}`);
  });

  it('still serves the SPA for unknown routes', async () => {
    const res = await fetch(`${BASE}/video/abc/1?party=xyz`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<div id="root">/);
  });
});
