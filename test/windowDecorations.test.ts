import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Guards the per-platform window-decoration policy.
 *
 * Windows draws its own caption buttons in-app (`decorations: false`).
 * macOS and Linux must keep their native titlebar buttons, which means
 * `decorations: true` — otherwise those platforms would have no visible way to
 * close the window at all, because `tauri.conf.json` disables decorations
 * globally.
 */
const readJson = (rel: string) =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

const readText = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), 'utf8');

const base = readJson('../src-tauri/tauri.conf.json');

const decorationOf = (conf: {
  app: { windows: { decorations?: boolean }[] };
}) => conf.app.windows[0].decorations;

describe('window decorations per platform', () => {
  it('base config is frameless (Windows is the custom-control target)', () => {
    assert.equal(decorationOf(base), false);
  });

  it('macOS overrides back to decorated', () => {
    const mac = readJson('../src-tauri/tauri.macos.conf.json');
    assert.equal(decorationOf(mac), true);
  });

  it('Linux overrides back to decorated', () => {
    const linux = readJson('../src-tauri/tauri.linux.conf.json');
    assert.equal(decorationOf(linux), true);
  });

  it('platform overrides keep the rest of the window definition', () => {
    // A platform file that only sets `decorations` must not blank out the size.
    for (const rel of [
      '../src-tauri/tauri.macos.conf.json',
      '../src-tauri/tauri.linux.conf.json',
    ]) {
      const conf = readJson(rel);
      assert.equal(conf.app.windows[0].title, 'synchive', rel);
      assert.equal(conf.app.windows[0].width, 800, rel);
      assert.equal(conf.app.windows[0].height, 600, rel);
    }
  });

  it('platform files exist for both non-Windows targets', () => {
    // If either is missing, that platform silently falls back to frameless and
    // loses its close button.
    for (const name of ['macos', 'linux']) {
      assert.doesNotThrow(() =>
        readJson(`../src-tauri/tauri.${name}.conf.json`),
      );
    }
  });
});

describe('in-app window controls are Windows-only', () => {
  const controls = readText('../src/components/WindowControls.tsx');
  const utils = readText('../src/utils/index.ts');

  it('renders only when both Tauri and Windows', () => {
    assert.match(controls, /const visible = isTauri\(\) && isWindows\(\)/);
    assert.match(controls, /if \(!visible\) return null/);
  });

  it('detects Windows from the user agent', () => {
    assert.match(utils, /export const isWindows/);
    assert.match(utils, /Windows\/i\.test\(navigator\.userAgent\)/);
  });

  it('does not branch on macOS or Linux', () => {
    // Those platforms get native buttons; drawing our own would duplicate them.
    assert.ok(!/isMacOS|isLinux|darwin/i.test(controls));
  });

  it('still wires up the three window actions', () => {
    for (const call of ['.minimize(', '.toggleMaximize(', '.close(']) {
      assert.ok(controls.includes(call), `${call} missing`);
    }
  });
});
