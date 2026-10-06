import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Guards the CSP in src-tauri/tauri.conf.json.
 *
 * The app renders HTML from arbitrary third-party CMS APIs (sanitized
 * synopsis) and streams video from arbitrary hosts, so `img-src`/`media-src`
 * and `connect-src` have to stay open to https. What must NOT regress is the
 * script surface and the framing/embedding directives: `csp: null` disables
 * all of it, which is the state this project was in.
 */

const conf = JSON.parse(
  readFileSync(
    new URL('../src-tauri/tauri.conf.json', import.meta.url),
    'utf8',
  ),
);

const parse = (csp: string) => {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    directives.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return directives;
};

describe('tauri CSP', () => {
  const csp = conf.app?.security?.csp;
  const devCsp = conf.app?.security?.devCsp;

  it('defines a production CSP', () => {
    assert.equal(typeof csp, 'string', 'production csp must be set, not null');
    assert.ok(csp.length > 0);
  });

  it('defines a separate dev CSP', () => {
    // Dev needs the Vite HMR websocket and eval-based reload.
    assert.equal(typeof devCsp, 'string');
  });

  for (const [label, policy] of [
    ['production', csp],
    ['dev', devCsp],
  ] as const) {
    describe(label, () => {
      const directives = parse(policy);

      it('sets a default-src', () => {
        assert.ok(directives.has('default-src'));
        assert.deepEqual(directives.get('default-src'), ["'self'"]);
      });

      it('restricts scripts to self in production', () => {
        const scriptSrc = directives.get('script-src') ?? [];
        assert.ok(scriptSrc.includes("'self'"));
        if (label === 'production') {
          assert.ok(
            !scriptSrc.includes("'unsafe-eval'"),
            'production must not allow unsafe-eval',
          );
          assert.ok(
            !scriptSrc.includes("'unsafe-inline'"),
            'production must not allow unsafe-inline scripts',
          );
        }
      });

      it('forbids plugins and objects', () => {
        assert.deepEqual(directives.get('object-src'), ["'none'"]);
      });

      it('locks base-uri', () => {
        assert.deepEqual(directives.get('base-uri'), ["'self'"]);
      });

      it('forbids framing', () => {
        assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
      });

      it('forbids form submission', () => {
        assert.deepEqual(directives.get('form-action'), ["'none'"]);
      });

      it('still allows remote images and media for CMS streams', () => {
        // These are user-configurable hosts, so they cannot be pinned, but they
        // must stay allowed or the app shows no posters and plays nothing.
        for (const d of ['img-src', 'media-src']) {
          const value = directives.get(d) ?? [];
          assert.ok(value.includes('https:'), `${d} must allow https`);
          assert.ok(value.includes('data:') || value.includes('blob:'), d);
        }
      });

      it('allows outbound connections for the API proxy and realtime', () => {
        const connect = directives.get('connect-src') ?? [];
        assert.ok(connect.includes('https:'));
        assert.ok(
          connect.includes('ipc:') || connect.includes('http://ipc.localhost'),
          'the Tauri IPC bridge must be reachable',
        );
      });

      it('keeps inline styles (Tailwind injects a stylesheet at runtime)', () => {
        assert.ok(
          (directives.get('style-src') ?? []).includes("'unsafe-inline'"),
        );
      });
    });
  }

  it('is stricter in production than in dev', () => {
    const prod = parse(csp);
    const dev = parse(devCsp);
    assert.ok(
      (prod.get('script-src') ?? []).length <
        (dev.get('script-src') ?? []).length,
    );
  });
});
