import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

/**
 * Regression guard for the "first load spins forever" hang.
 *
 * The API reads from `useSourceStore`. By seeding the tauri store stub before
 * imports and before `loadSources()` runs, these tests work with the real code
 * path (no source store mocking).
 */

let invokeImpl: (cmd: string, args: unknown) => unknown = () => {
  throw new Error('invoke stub not installed');
};

function seedSources() {
  (globalThis as unknown as Record<string, unknown>).__tauriStoreSeed = {
    apple_cms_sources: [
      {
        id: 'src-1',
        name: 'Test',
        type: 'apple',
        url: 'http://example.test/api.php',
      },
      {
        id: 'src-2',
        name: 'Test2',
        type: 'apple',
        url: 'http://example2.test/api.php',
      },
      {
        id: 'src-3',
        name: 'Test3',
        type: 'apple',
        url: 'http://example3.test/api.php',
      },
      {
        id: 'src-never',
        name: 'Never',
        type: 'apple',
        url: 'http://never.test/api.php',
      },
    ],
    apple_cms_primary_source_id: 'src-1',
  };
}

beforeEach(async () => {
  seedSources();
  (globalThis as unknown as Record<string, unknown>).__tauriInvoke = (
    cmd: string,
    args: unknown,
  ) => invokeImpl(cmd, args);
  const { useSourceStore } = await import('../src/stores/useSourceStore');
  // Ensure sources are loaded from the seed (idempotent).
  await useSourceStore.getState().loadSources();
});

afterEach(async () => {
  (globalThis as unknown as Record<string, unknown>).__tauriInvoke = undefined;
  (globalThis as unknown as Record<string, unknown>).__tauriStoreSeed =
    undefined;
  const { useSourceStore } = await import('../src/stores/useSourceStore');
  // Reset store state between tests.
  useSourceStore.setState({
    sources: [],
    primarySourceId: '',
    loaded: false,
    loading: false,
  });
});

describe('upstream requests cannot hang the UI', () => {
  it('returns parsed JSON on the happy path', async () => {
    const { fetchCategories } = await import('../src/services/api');
    const calls: string[] = [];
    invokeImpl = (cmd) => {
      calls.push(cmd);
      return Promise.resolve(
        JSON.stringify({
          code: 1,
          class: [{ type_id: 1, type_name: 'Movie' }],
        }),
      );
    };

    const res = await fetchCategories('src-1');
    assert.equal(res.code, 1);
    assert.equal(res.class?.[0]?.type_name, 'Movie');
    assert.deepEqual(calls, ['proxy_request']);
  });

  it('propagates upstream errors instead of resolving empty', async () => {
    const { fetchCategories } = await import('../src/services/api');
    invokeImpl = () =>
      Promise.reject(new Error('Upstream returned status 403'));

    await assert.rejects(fetchCategories('src-2'), /403/);
  });

  it('rejects when the IPC call never settles', async () => {
    const { fetchCategories } = await import('../src/services/api');
    invokeImpl = () => new Promise<string>(() => {});

    const started = Date.now();
    await assert.rejects(
      fetchCategories('src-never'),
      /timed out/i,
      'a never-settling invoke must reject, not hang forever',
    );
    const elapsed = Date.now() - started;
    assert.ok(
      elapsed >= 18_000 && elapsed < 60_000,
      `expected the backstop to fire near 20s, took ${elapsed}ms`,
    );
  });

  it('drops the inflight entry so a timeout does not poison later retries', async () => {
    const { fetchCategories } = await import('../src/services/api');

    // First call times out against a dead endpoint.
    invokeImpl = () => new Promise<string>(() => {});
    await assert.rejects(fetchCategories('src-3'), /timed out/i);

    // The endpoint recovers.
    let called = 0;
    invokeImpl = () => {
      called += 1;
      return Promise.resolve(JSON.stringify({ code: 1, class: [] }));
    };
    const res = await fetchCategories('src-3');
    assert.equal(res.code, 1);
    assert.equal(called, 1, 'a new request must actually be sent');
  });

  it('rejects rather than spinning when a category probe stalls', async () => {
    const { fetchEmptyCategoryIds } = await import('../src/services/api');

    invokeImpl = () => new Promise<string>(() => {});
    const categories = Array.from({ length: 6 }, (_, i) => ({
      type_id: i + 1,
      type_name: `cat${i}`,
    }));

    const started = Date.now();
    const empty = await fetchEmptyCategoryIds(categories, 'src-1');
    const elapsed = Date.now() - started;

    assert.equal(empty.length, 0, 'unknown results must keep tabs visible');
    assert.ok(
      elapsed < 60_000,
      `probe must not block indefinitely, took ${elapsed}ms`,
    );
  });
});