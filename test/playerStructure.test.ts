import assert from 'node:assert/strict';
/**
 * Guards the #12 refactor: `Player.tsx` must delegate realtime and playback
 * switching to the shared hook / helper rather than re-implementing either.
 *
 * The bug this prevents coming back: every control used to carry its own copy
 * of the setState block plus its own party broadcast, so a fix to one path
 * (e.g. the missing `setInitialTime(0)` in the line selector) silently did
 * not apply to the others.
 */
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), 'utf8');

const player = read('../src/pages/Player.tsx');
const hook = read('../src/hooks/useWatchParty.ts');

describe('Player.tsx realtime delegation (#12)', () => {
  it('uses the shared hook', () => {
    assert.match(player, /from '\.\.\/hooks\/useWatchParty'/);
  });

  it('no longer imports a realtime transport directly', () => {
    assert.ok(
      !/from 'socket\.io-client'/.test(player),
      'Player must not talk to socket.io directly',
    );
    assert.ok(
      !/from '\.\.\/config\/pusher'/.test(player),
      'Player must not talk to Pusher directly',
    );
  });

  it('does not emit transport events inline', () => {
    assert.ok(
      !/socket\.emit\(/.test(player),
      'all emits must go through broadcastAction',
    );
    assert.ok(!/\.trigger\(/.test(player), 'no direct Pusher triggers');
  });

  it('has no leftover transport refs', () => {
    for (const name of ['pusherChannel', 'socketRef', 'hasRequestedStateRef']) {
      assert.ok(
        !new RegExp(`\\b${name}\\b`).test(player),
        `${name} should live in the hook, not the page`,
      );
    }
  });

  it('routes every playback switch through playEpisode', () => {
    const switches = [
      // keyboard shortcuts
      /playEpisode\(\{\s*sourceId: activeSourceId,\s*groupName: activeGroupName,\s*episodeIndex: newIndex/,
      // auto-advance on ended
      /playEpisode\(\{\s*sourceId: activeSourceId,\s*groupName: activeGroupName,\s*episodeIndex: nextIndex/,
    ];
    for (const re of switches) {
      assert.match(player, re);
    }
  });

  it('no longer sets playback state directly in the UI handlers', () => {
    // setCurrentPlayUrl should only appear inside the load effect and
    // applySelection, never in an onClick / onEnded handler.
    const clickHandlers = player.slice(player.indexOf('return ('));
    assert.ok(
      !/onClick=\{\(\) => \{[^}]*setCurrentPlayUrl/.test(clickHandlers),
      'onClick handlers must call playEpisode, not set state directly',
    );
    assert.ok(
      !/const handleEnded[\s\S]*?setCurrentPlayUrl/.test(player),
      'handleEnded must call playEpisode',
    );
  });

  it('has no unreachable duplicate branch', () => {
    // The old ternary had `partyId ? ... : partyId ? ... : ...`.
    assert.ok(
      !/\)\s*:\s*partyId\s*\?/.test(player),
      'the unreachable `partyId ?` branch should be gone',
    );
  });

  it('drops the removed no-op shadowed ref', () => {
    assert.ok(
      !/let socketRef: Socket \| null = null/.test(player),
      'the shadowing local socketRef should be gone',
    );
  });

  it('is meaningfully smaller than before the refactor', () => {
    const lines = player.split('\n').length;
    assert.ok(
      lines < 800,
      `Player.tsx is ${lines} lines; expected a real reduction from 945`,
    );
  });
});

describe('useWatchParty transport parity (#12)', () => {
  it('defines one applyRemoteAction, not one per transport', () => {
    // The page may keep a callback that drives the <video> element, but the
    // wire-level decoding must exist exactly once, in the hook.
    const inHook = hook.match(/const applyRemoteAction =/g)?.length ?? 0;
    assert.equal(inHook, 1, 'exactly one implementation in the hook');

    const pageCopies =
      player.match(/const applyRemoteAction\s*=/g)?.length ?? 0;
    assert.equal(pageCopies, 0, 'the page must not re-implement it');
  });

  it('separates wire decoding from element playback', () => {
    // driveLocalPlayback is the element-level half; the distinct name stops the
    // two responsibilities being conflated again.
    assert.match(player, /const driveLocalPlayback =/);
    assert.match(player, /onRemoteAction: driveLocalPlayback/);
  });

  it('defines one applyRemoteState', () => {
    const inHook = hook.match(/const applyRemoteState =/g)?.length ?? 0;
    assert.equal(inHook, 1);
  });

  it('both transports emit through the same broadcast helper', () => {
    const trigger =
      /pusherChannel\.current\?\.trigger\('client-video-action'/.test(hook);
    const emit = /socketRef\.current\?\.emit\('video-action'/.test(hook);
    assert.ok(trigger && emit, 'both transports must publish the same payload');
  });

  it('guards the remote-echo loop with a timer ref', () => {
    assert.match(hook, /REMOTE_ECHO_GUARD_MS/);
    assert.match(hook, /guardTimer/);
    assert.match(hook, /isRemoteUpdate\.current = false/);
  });

  it('cleans up the guard timer on unmount', () => {
    assert.match(
      hook,
      /return \(\) => \{\s*if \(guardTimer\.current\) clearTimeout\(guardTimer\.current\)/,
    );
  });
});
