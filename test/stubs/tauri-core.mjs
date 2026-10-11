// Stub for `@tauri-apps/api/core`.
//
// The real package reaches into `window.__TAURI_INTERNALS__`, which does not
// exist under `node --test`, and its exports are read-only module bindings that
// cannot be reassigned from a test.
//
// `ts-resolve.mjs` redirects this specifier here. `invoke` delegates to
// `globalThis.__tauriInvoke` when a test installs one; otherwise it throws
// loudly rather than silently resolving undefined.

const impl = (cmd, args) => {
  const hook = globalThis.__tauriInvoke;
  if (typeof hook !== 'function') {
    throw new Error(
      `Tauri command "${cmd}" was invoked but no __tauriInvoke stub is installed`,
    );
  }
  return hook(cmd, args);
};

export const invoke = (cmd, args) => impl(cmd, args);
export const convertFileSrc = (p) => `asset://localhost/${p}`;
export default { invoke, convertFileSrc };