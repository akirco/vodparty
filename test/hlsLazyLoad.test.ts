import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Regression guard for the lazy hls.js load.
 *
 * The hls.js default export is a *class*. Passing a class straight to a React
 * state setter makes React treat it as an updater function and call it, which
 * throws "class constructors must be invoked with 'new'" and kills the player.
 * Only a dev/prod smoke test surfaces this, because the build itself succeeds.
 */
const player = readFileSync(
  new URL('../src/components/HlsPlayer.tsx', import.meta.url),
  'utf8',
);

describe('lazy hls.js load (#9 regression)', () => {
  it('wraps the class in a thunk when storing it in state', () => {
    assert.ok(
      /setHls\(\(\)\s*=>\s*mod\)/.test(player),
      'setHls(mod) would be invoked by React as an updater and throw',
    );
  });

  it('does not pass the module directly to the setter anywhere', () => {
    assert.ok(
      !/setHls\(\s*mod\s*\)/.test(player),
      'bare `setHls(mod)` is the exact bug',
    );
  });

  it('constructs the player with `new`', () => {
    assert.match(player, /new HlsCtor\(/);
  });

  it('keeps the module memoised so it is fetched once', () => {
    assert.match(player, /hlsModulePromise \?\?=/);
  });

  it('still guards against the module being absent', () => {
    assert.match(player, /hls\.js was selected but is not loaded/);
  });

  it('reports a load failure instead of hanging', () => {
    assert.match(player, /Failed to load hls\.js/);
  });

  it('cancels a pending load when the effect tears down', () => {
    // The load guard and the cleanup that flips it must both be present.
    assert.match(player, /if \(!cancelled\) setHls/);
    assert.match(player, /cancelled = true/);
  });
});
