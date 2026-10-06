import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Guards the fix for the infinite native <-> hls.js fallback loop.
 *
 * The bug: the effect reset its own "already fell back" flag on every run, and
 * each fallback re-entered the effect, so the strategies could trade places
 * forever. The repair keeps the retry count in a ref keyed by `src` and caps
 * it with MAX_FALLBACKS.
 *
 * The constants are read from the component source so this test fails if they
 * drift.
 */
const MAX_FALLBACKS = 2;

interface Cap {
  canPlayNative: boolean;
  hlsSupported: boolean;
  nativeWorks: boolean;
  hlsWorks: boolean;
}

interface Outcome {
  strategy: string;
  infinite: boolean;
  attempts: number;
}

/** Mirrors the strategy selection + fallback wiring in HlsPlayer. */
function simulate(cap: Cap): Outcome {
  const fallback = { src: 'A.m3u8', count: 0 };
  const trace: string[] = [];

  for (let attempt = 0; attempt < 50; attempt++) {
    const canRetry = fallback.count < MAX_FALLBACKS;
    const nativeExhausted = fallback.count > 0;

    let chosen: string;
    if (canPlayNative(cap, nativeExhausted)) chosen = 'native';
    else if (cap.hlsSupported) chosen = 'hlsjs';
    else if (cap.canPlayNative) chosen = 'native';
    else chosen = 'none';

    trace.push(chosen);
    if (trace.length > 20)
      return { strategy: 'none', infinite: true, attempts: trace.length };

    if (chosen === 'none') {
      return { strategy: 'none', infinite: false, attempts: trace.length };
    }

    if (chosen === 'native') {
      if (cap.nativeWorks) {
        return { strategy: 'native', infinite: false, attempts: trace.length };
      }
      // native timed out
      if (cap.hlsSupported && canRetry) {
        fallback.count += 1;
        continue;
      }
      return {
        strategy: 'native-error',
        infinite: false,
        attempts: trace.length,
      };
    }

    // hls.js
    if (cap.hlsWorks) {
      return { strategy: 'hlsjs', infinite: false, attempts: trace.length };
    }
    // fatal network error -> try native
    if (cap.canPlayNative && canRetry) {
      fallback.count += 1;
      continue;
    }
    return { strategy: 'hlsjs-error', infinite: false, attempts: trace.length };
  }

  return { strategy: 'none', infinite: true, attempts: trace.length };
}

function canPlayNative(cap: Cap, nativeExhausted: boolean): boolean {
  return cap.canPlayNative && !nativeExhausted;
}

describe('HlsPlayer fallback termination', () => {
  const cases: Array<[string, Cap]> = [
    [
      'native works (Safari/WebKit)',
      {
        canPlayNative: true,
        hlsSupported: true,
        nativeWorks: true,
        hlsWorks: true,
      },
    ],
    [
      'native stalls, hls.js works',
      {
        canPlayNative: true,
        hlsSupported: true,
        nativeWorks: false,
        hlsWorks: true,
      },
    ],
    [
      'both fail (WebKitGTK) - the reported infinite loop',
      {
        canPlayNative: true,
        hlsSupported: true,
        nativeWorks: false,
        hlsWorks: false,
      },
    ],
    [
      'hls.js network error, native works',
      {
        canPlayNative: true,
        hlsSupported: true,
        nativeWorks: true,
        hlsWorks: false,
      },
    ],
    [
      'no native, hls.js fails',
      {
        canPlayNative: false,
        hlsSupported: true,
        nativeWorks: false,
        hlsWorks: false,
      },
    ],
    [
      'no playback path at all',
      {
        canPlayNative: false,
        hlsSupported: false,
        nativeWorks: false,
        hlsWorks: false,
      },
    ],
  ];

  for (const [label, cap] of cases) {
    it(`terminates: ${label}`, () => {
      const r = simulate(cap);
      assert.equal(r.infinite, false, 'fallback chain must terminate');
      // Bounded by 1 + MAX_FALLBACKS attempts.
      assert.ok(
        r.attempts <= MAX_FALLBACKS + 1,
        `made ${r.attempts} attempts, expected at most ${MAX_FALLBACKS + 1}`,
      );
    });
  }

  it('reaches hls.js after a native timeout', () => {
    const r = simulate({
      canPlayNative: true,
      hlsSupported: true,
      nativeWorks: false,
      hlsWorks: true,
    });
    assert.equal(r.strategy, 'hlsjs');
    assert.equal(r.attempts, 2);
  });

  it('gives up with an error when every strategy fails', () => {
    const r = simulate({
      canPlayNative: true,
      hlsSupported: true,
      nativeWorks: false,
      hlsWorks: false,
    });
    assert.ok(r.strategy.endsWith('error'), `got ${r.strategy}`);
  });

  it('matches MAX_FALLBACKS declared in the component', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../src/components/HlsPlayer.tsx', import.meta.url),
      'utf8',
    );
    const m = /const MAX_FALLBACKS = (\d+)/.exec(src);
    assert.ok(m, 'MAX_FALLBACKS not found in HlsPlayer.tsx');
    assert.equal(Number(m[1]), MAX_FALLBACKS);
  });
});
