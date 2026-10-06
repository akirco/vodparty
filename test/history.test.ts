import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

/**
 * These tests exercise the real `history` service against the real `storage`
 * service, using the non-Tauri localStorage path (a fake `localStorage` is
 * installed, and `window` exists so the `typeof window` guards pass).
 */

const HISTORY_KEY = 'apple_cms_history';

// Minimal browser globals before the modules under test are imported.
const backing = new Map<string, string>();
let writes = 0;

(globalThis as Record<string, unknown>).window = {
  addEventListener() {},
  removeEventListener() {},
};
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => {
    backing.set(k, v);
    writes += 1;
  },
  removeItem: (k: string) => {
    backing.delete(k);
  },
};

// A unique query per run forces a fresh module instance, so the module-level
// cache in history.ts cannot leak between test cases.
let generation = 0;
const load = async () => {
  generation += 1;
  return import(`../src/services/history.ts?g=${generation}`);
};

beforeEach(() => {
  backing.clear();
  writes = 0;
});

const entry = (over: Record<string, unknown> = {}) => ({
  videoId: 1,
  videoName: 'Movie',
  videoPic: 'p.jpg',
  sourceId: 'srcA',
  groupName: 'g',
  playUrl: 'https://a/1.m3u8',
  episodeIndex: 0,
  currentTime: 10,
  duration: 5400,
  ...over,
});

describe('history service', () => {
  it('coalesces rapid saves into a single write', async () => {
    const H = await load();
    for (let i = 0; i < 20; i++) {
      await H.saveHistoryItem(entry({ currentTime: i }));
    }
    assert.equal(writes, 0, 'writes must be debounced, not eager');
    await H.flushHistory();
    assert.equal(writes, 1);
  });

  it('persists the latest value', async () => {
    const H = await load();
    for (let i = 0; i < 5; i++)
      await H.saveHistoryItem(entry({ currentTime: i }));
    await H.flushHistory();
    const h = await H.getHistory();
    assert.equal(h[0].currentTime, 4);
  });

  it('scopes identity by sourceId as well as videoId', async () => {
    const H = await load();
    await H.saveHistoryItem(entry({ sourceId: 'srcA' }));
    await H.saveHistoryItem(entry({ sourceId: 'srcB' }));
    await H.flushHistory();
    // vod_id is only unique within a source, so these must not collide.
    assert.equal((await H.getHistory()).length, 2);
  });

  it('updates in place for the same source', async () => {
    const H = await load();
    await H.saveHistoryItem(entry({ sourceId: 'srcA', currentTime: 1 }));
    await H.saveHistoryItem(entry({ sourceId: 'srcA', currentTime: 99 }));
    await H.flushHistory();
    const h = await H.getHistory();
    assert.equal(h.length, 1);
    assert.equal(h[0].currentTime, 99);
  });

  it('stores a slim record with no vod_content', async () => {
    const H = await load();
    await H.saveHistoryItem(entry());
    await H.flushHistory();
    const raw = backing.get(HISTORY_KEY) ?? '';
    assert.ok(!raw.includes('vod_content'));
    assert.ok(!raw.includes('"video"'));
    assert.ok(raw.length < 1000, `payload unexpectedly large: ${raw.length}`);
  });

  it('caps the list at 100 items', async () => {
    const H = await load();
    for (let i = 0; i < 150; i++) {
      await H.saveHistoryItem(entry({ videoId: 1000 + i }));
    }
    await H.flushHistory();
    assert.equal((await H.getHistory()).length, 100);
  });

  it('removes only the targeted source', async () => {
    const H = await load();
    await H.saveHistoryItem(entry({ sourceId: 'srcA' }));
    await H.saveHistoryItem(entry({ sourceId: 'srcB' }));
    await H.flushHistory();
    await H.removeHistoryItem(1, 'srcA');
    const h = await H.getHistory();
    assert.equal(h.length, 1);
    assert.equal(h[0].sourceId, 'srcB');
  });

  it('migrates the legacy fat format', async () => {
    backing.set(
      HISTORY_KEY,
      JSON.stringify([
        {
          videoId: 7,
          video: {
            vod_id: 7,
            vod_name: 'Old Movie',
            vod_pic: 'old.jpg',
            vod_content: 'x'.repeat(5000),
          },
          sourceId: 'srcA',
          groupName: 'g',
          playUrl: 'u',
          episodeIndex: 2,
          currentTime: 42,
          duration: 900,
          timestamp: 1700000000000,
        },
      ]),
    );
    const H = await load();
    const h = await H.getHistory();
    assert.equal(h.length, 1);
    assert.equal(h[0].videoName, 'Old Movie');
    assert.equal(h[0].videoPic, 'old.jpg');
    assert.equal(h[0].currentTime, 42);
    assert.ok(!('video' in h[0]));
    assert.ok(!('vod_content' in h[0]));
  });

  it('does not resurrect cleared data via a queued write', async () => {
    const H = await load();
    await H.saveHistoryItem(entry());
    await H.clearHistory();
    // Let any pending debounce timer fire.
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(backing.get(HISTORY_KEY), undefined);
  });

  it('ignores corrupt stored data', async () => {
    backing.set(HISTORY_KEY, 'not json');
    const H = await load();
    assert.deepEqual(await H.getHistory(), []);
  });
});
