// Node ESM resolver/loader hooks so tests can import the app's source directly.
//
// The app is bundled by vite and uses extensionless / directory imports
// (`from './validateProxy'`, `from '../utils'`), which Node's native ESM loader
// rejects. Rather than contorting the source (or testing a copy), these hooks
// apply bundler-style resolution and handle `.tsx`.
//
// Node's built-in type stripping covers `.ts` but NOT JSX, so `.tsx` files are
// transpiled through vite's esbuild pass.

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx'];

/**
 * Tauri APIs are redirected to stubs.
 *
 * The real packages talk to `window.__TAURI_INTERNALS__` and expose read-only
 * module bindings, so a test cannot simply reassign `invoke`. Redirecting the
 * specifier is the only way to drive the app's real IPC call sites.
 */
const STUBS = {
  '@tauri-apps/api/core': './stubs/tauri-core.mjs',
  '@tauri-apps/plugin-store': './stubs/tauri-store.mjs',
  'pusher-js': './stubs/pusher.mjs',
};

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export async function resolve(specifier, context, nextResolve) {
  // Tauri APIs -> local stubs (see STUBS above).
  if (specifier in STUBS) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return {
      url: pathToFileURL(path.join(here, STUBS[specifier])).href,
      shortCircuit: true,
    };
  }

  // Bare specifiers (node builtins, packages) go straight through.
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return nextResolve(specifier, context);
  }

  const parentPath = context.parentURL
    ? fileURLToPath(context.parentURL)
    : process.cwd();
  const base = path.resolve(path.dirname(parentPath), specifier);

  const file = pathToFileURL;

  // Exact file (this also covers an explicit `./foo.ts`).
  if (isFile(base)) return { url: file(base).href, shortCircuit: true };

  // `./foo` -> `./foo.ts` (and friends).
  for (const ext of CANDIDATE_SUFFIXES) {
    if (isFile(base + ext)) {
      return { url: file(base + ext).href, shortCircuit: true };
    }
  }

  // Directory import -> index file. Checked with isDir so a directory is never
  // handed to the loader as if it were a module.
  if (isDir(base)) {
    for (const ext of CANDIDATE_SUFFIXES) {
      const idx = path.join(base, `index${ext}`);
      if (isFile(idx)) return { url: file(idx).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}

/**
 * Transpile `.tsx`/`.jsx` through vite's esbuild pass. Without this, Node's
 * type stripper refuses `.tsx` with ERR_UNKNOWN_FILE_EXTENSION.
 */
export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:')) return nextLoad(url, context);
  const p = fileURLToPath(url);
  if (!/\.(tsx|jsx)$/.test(p) || !existsSync(p)) return nextLoad(url, context);

  const { readFile } = await import('node:fs/promises');
  const source = await readFile(p, 'utf8');
  const vite = await import('vite');

  // vite 8 (rolldown) prefers oxc; `transformWithEsbuild` is deprecated and
  // requires esbuild to be installed separately.
  if (typeof vite.transformWithOxc === 'function') {
    const result = await vite.transformWithOxc(source, p, {
      lang: p.endsWith('.tsx') ? 'tsx' : 'jsx',
      jsx: { runtime: 'automatic' },
    });
    return { format: 'module', source: result.code, shortCircuit: true };
  }

  const result = await vite.transformWithEsbuild(source, p, {
    loader: p.endsWith('.tsx') ? 'tsx' : 'jsx',
    jsx: 'automatic',
    target: 'esnext',
  });
  return { format: 'module', source: result.code, shortCircuit: true };
}
