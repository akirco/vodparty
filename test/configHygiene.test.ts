import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Guards the #14/#15 cleanup of Pusher configuration.
 *
 * Two things regressed before: `savePusherSettings` was bound to each input's
 * `onChange` (one disk write + one Pusher client rebuild per keystroke), and
 * the env reads went through `import.meta.env.PUSHER_*`, which Vite never
 * populates for non-`VITE_`-prefixed names.
 */

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), 'utf8');

const settings = read('../src/pages/Settings.tsx');
const pusher = read('../src/config/pusher.ts');
const vite = read('../vite.config.ts');
const env = read('../src/vite-env.d.ts');
const pkg = JSON.parse(read('../package.json'));

describe('#14 settings are not written per keystroke', () => {
  it('never calls a save function from an input onChange', () => {
    // Any `onChange` that persists is the regression we are guarding.
    const onChangeBlocks = settings.match(/onChange=\{[^}]*\}/g) ?? [];
    for (const block of onChangeBlocks) {
      assert.ok(
        !/savePusherSettings|saveProxySettings/.test(block),
        `onChange must not persist: ${block}`,
      );
    }
  });

  it('exposes explicit save handlers', () => {
    assert.match(settings, /const handleSavePusher = async/);
    assert.match(settings, /const handleSaveProxy = async/);
  });

  it('renders save buttons bound to those handlers', () => {
    assert.match(settings, /onClick=\{handleSavePusher\}/);
    assert.match(settings, /onClick=\{handleSaveProxy\}/);
  });

  it('disables the save button until something changes', () => {
    assert.match(settings, /disabled=\{!pusherDirty/);
    assert.match(settings, /disabled=\{!proxyDirty/);
  });

  it('tracks the persisted baseline to compute dirtiness', () => {
    assert.match(settings, /const \[loadedPusher, setLoadedPusher\]/);
    assert.match(settings, /const \[loadedProxy, setLoadedProxy\]/);
  });

  it('surfaces save failures instead of swallowing them', () => {
    assert.match(settings, /pusherError/);
    assert.match(settings, /catch \(err\)/);
  });

  it('notes that browser builds cannot persist these values', () => {
    // Better an explicit note than a Save button that silently does nothing.
    assert.match(settings, /cannot be changed at runtime/);
  });
});

describe('#15 Pusher env reads resolve', () => {
  it('does not read import.meta.env.PUSHER_*', () => {
    // Vite only exposes VITE_-prefixed vars, so these were always undefined.
    const bad = pusher.match(/import\.meta\.env\.PUSHER\w+/g) ?? [];
    // The only allowed mention is inside the explanatory comment.
    const code = pusher
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      .join('\n');
    assert.ok(
      !/import\.meta\.env\.PUSHER\w+/.test(code),
      'application code must not read import.meta.env.PUSHER_*',
    );
    assert.ok(bad.length <= 1, 'at most the doc comment may mention it');
  });

  it('declares every injected constant in vite.config', () => {
    for (const name of [
      '__PUSHER_APP_ID__',
      '__PUSHER_KEY__',
      '__PUSHER_CLUSTER__',
      '__PUSHER_AUTH_ENDPOINT__',
    ]) {
      assert.match(vite, new RegExp(`${name}:`), `${name} not injected`);
      assert.match(
        env,
        new RegExp(`declare const ${name}`),
        `${name} not typed`,
      );
      assert.match(pusher, new RegExp(name), `${name} not consumed`);
    }
  });

  it('declares them as bare identifiers, not import.meta.env', () => {
    assert.ok(
      !/define:\s*\{\s*'import\.meta\.env\.PUSHER/.test(vite),
      'define must inject bare identifiers',
    );
  });

  it('falls back to a sensible default auth endpoint', () => {
    assert.match(vite, /\.netlify\/functions\/pusher-auth/);
    assert.match(pusher, /DEFAULT_AUTH_ENDPOINT/);
  });

  it('never returns a secret to browser code', () => {
    // The secret is only meaningful in Rust / the Netlify function.
    const webBranch = pusher.slice(
      pusher.indexOf('return {\n    app_id: ENV.appId'),
    );
    assert.match(webBranch, /secret: ''/);
  });
});

describe('#16 dead code removed', () => {
  it('drops the always-null pusherClient export', () => {
    assert.ok(
      !/export const pusherClient: Pusher \| null = null/.test(pusher),
      'the constant was never used',
    );
  });

  it('clearCache no longer deletes from the wrong map', () => {
    const api = read('../src/services/api.ts');
    assert.ok(
      !/for \(const key of inflight\.keys\(\)\) \{\s*cache\.delete/.test(api),
      'looping inflight keys while deleting from cache is a no-op',
    );
  });

  it('hls debug logging is opt-in', () => {
    const hls = read('../src/components/HlsPlayer.tsx');
    assert.match(hls, /debug = false/);
  });

  it('does not log the full user agent unconditionally', () => {
    const hls = read('../src/components/HlsPlayer.tsx');
    assert.ok(
      !/logAlways\('capabilities'/.test(hls),
      'capabilities dump should follow the debug flag',
    );
  });

  it('drops the pointless hls.js VOD flags', () => {
    const hls = read('../src/components/HlsPlayer.tsx');
    assert.ok(!/enableWorker: false/.test(hls));
    assert.match(hls, /lowLatencyMode: false/);
  });
});

describe('#21 dependency hygiene', () => {
  it('keeps @netlify/functions out of runtime dependencies', () => {
    assert.equal(pkg.dependencies['@netlify/functions'], undefined);
    assert.ok(pkg.devDependencies['@netlify/functions']);
  });

  it('pins the package manager', () => {
    assert.match(pkg.packageManager, /^pnpm@/);
  });

  it('netlify.toml builds with the same package manager', () => {
    assert.match(read('../netlify.toml'), /command = "pnpm build"/);
  });
});

describe('#24 small cleanups', () => {
  it('registers the layout scroll listener as passive', () => {
    const layout = read('../src/components/Layout.tsx');
    assert.match(
      layout,
      /addEventListener\('scroll', handleScroll, \{ passive: true \}\)/,
    );
  });

  it('no longer disables text selection on the whole page', () => {
    const layout = read('../src/components/Layout.tsx');
    assert.ok(
      !/<main[^>]*select-none/.test(layout),
      'the synopsis must stay selectable',
    );
    assert.match(read('../src/pages/Player.tsx'), /select-text/);
  });

  it('does not mutate the params object from useSearchParams', () => {
    const home = read('../src/pages/Home.tsx');
    assert.ok(
      !/searchParams\.delete\(|searchParams\.set\(/.test(home),
      'useSearchParams returns router state; mutating it is unsafe',
    );
    assert.match(home, /new URLSearchParams\(searchParams\)/);
  });

  it('points the @ alias at src, not the repo root', () => {
    assert.match(vite, /path\.resolve\(import\.meta\.dirname, '\.\/src'\)/);
  });
});
