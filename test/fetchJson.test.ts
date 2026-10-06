import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  DEFAULT_TIMEOUT_MS,
  fetchUpstreamJson,
  MAX_BODY_BYTES,
} from '../src/shared/fetchJson.ts';

const realFetch = globalThis.fetch;

/** Replace global fetch with a queue of scripted responses. */
function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: string[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push(url);
    return handler(url, init ?? {});
  }) as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('fetchUpstreamJson', () => {
  it('passes through valid JSON', async () => {
    mockFetch(() => jsonResponse({ code: 1, list: [{ vod_id: 1 }] }));
    const res = await fetchUpstreamJson('https://api.example.com/x');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { code: 1, list: [{ vod_id: 1 }] });
  });

  it('accepts JSON served with a text/html content-type', async () => {
    // Several Apple CMS backends do this; the old Netlify handler rejected it.
    mockFetch(
      () =>
        new Response('{"code":1,"class":[]}', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    const res = await fetchUpstreamJson('https://api.example.com/x');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { code: 1, class: [] });
  });

  it('rejects non-JSON bodies', async () => {
    mockFetch(
      () =>
        new Response('<!doctype html><h1>hello</h1>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    const res = await fetchUpstreamJson('https://api.example.com/x');
    assert.equal(res.status, 403);
    assert.match((res.data as { error: string }).error, /JSON/i);
  });

  it('returns 403 for a private target without fetching', async () => {
    const calls = mockFetch(() => jsonResponse({}));
    const res = await fetchUpstreamJson('http://169.254.169.254/latest/');
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0, 'must not perform the request');
  });

  it('returns 502 when upstream is not ok', async () => {
    mockFetch(() => new Response('nope', { status: 500 }));
    const res = await fetchUpstreamJson('https://api.example.com/x');
    assert.equal(res.status, 502);
  });

  it('returns 504 on timeout', async () => {
    mockFetch(() => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      throw err;
    });
    const res = await fetchUpstreamJson('https://api.example.com/x');
    assert.equal(res.status, 504);
  });

  it('rejects an oversized body advertised in content-length', async () => {
    mockFetch(
      () =>
        new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': String(MAX_BODY_BYTES + 1),
          },
        }),
    );
    const res = await fetchUpstreamJson('https://api.example.com/x');
    assert.equal(res.status, 403);
    assert.match((res.data as { error: string }).error, /large/i);
  });

  it('rejects an oversized body without content-length', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES + 10) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const res = await fetchUpstreamJson('https://api.example.com/x');
    assert.equal(res.status, 403);
    assert.match((res.data as { error: string }).error, /large/i);
  });

  it('does not leak the raw error cause', async () => {
    mockFetch(() => {
      throw new Error('getaddrinfo ENOTFOUND 10.0.0.5:80');
    });
    const res = await fetchUpstreamJson('https://api.example.com/x');
    const body = JSON.stringify(res.data);
    assert.equal(res.status, 502);
    assert.ok(!body.includes('10.0.0.5'), 'must not echo internal addresses');
  });

  describe('redirects', () => {
    it('follows a redirect to another public host', async () => {
      const calls = mockFetch((url) => {
        if (url === 'https://a.example.com/x') {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://b.example.com/y' },
          });
        }
        return jsonResponse({ ok: true });
      });
      const res = await fetchUpstreamJson('https://a.example.com/x');
      assert.equal(res.status, 200);
      assert.deepEqual(res.data, { ok: true });
      assert.deepEqual(calls, [
        'https://a.example.com/x',
        'https://b.example.com/y',
      ]);
    });

    it('re-validates each hop and refuses to follow into a private host', async () => {
      const calls = mockFetch((url) => {
        if (url === 'https://evil.example.com/x') {
          return new Response(null, {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data/' },
          });
        }
        return jsonResponse({ secret: true });
      });
      const res = await fetchUpstreamJson('https://evil.example.com/x');
      assert.equal(res.status, 403);
      assert.equal(calls.length, 1, 'must not fetch the redirect target');
    });

    it('refuses a redirect to loopback', async () => {
      mockFetch(
        () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://127.0.0.1:8080/admin' },
          }),
      );
      const res = await fetchUpstreamJson('https://evil.example.com/x');
      assert.equal(res.status, 403);
    });

    it('stops after too many hops', async () => {
      let n = 0;
      mockFetch(() => {
        n += 1;
        return new Response(null, {
          status: 302,
          headers: { location: `https://loop${n}.example.com/` },
        });
      });
      const res = await fetchUpstreamJson('https://start.example.com/');
      assert.equal(res.status, 502);
      assert.match((res.data as { error: string }).error, /redirect/i);
      assert.ok(n <= 6, `expected a bounded hop count, made ${n}`);
    });

    it('reports a redirect with no target', async () => {
      mockFetch(() => new Response(null, { status: 302 }));
      const res = await fetchUpstreamJson('https://a.example.com/x');
      assert.equal(res.status, 502);
    });

    it('reports an unparseable location', async () => {
      mockFetch(
        () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://[bad' },
          }),
      );
      const res = await fetchUpstreamJson('https://a.example.com/x');
      assert.equal(res.status, 502);
    });
  });

  it('uses a bounded default timeout', () => {
    assert.ok(DEFAULT_TIMEOUT_MS > 0 && DEFAULT_TIMEOUT_MS <= 30_000);
  });
});
