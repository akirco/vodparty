// Stub for `@tauri-apps/plugin-store`.
//
// Redirected by `ts-resolve.mjs`. Backed by an in-memory map so
// `src/services/storage.ts` exercises its real read/write logic without
// touching the filesystem. `globalThis.__tauriStore` seeds initial contents.

const store = new Map();

const applySeed = () => {
  const seed = globalThis.__tauriStoreSeed;
  if (seed && !store.size) {
    for (const [k, v] of Object.entries(seed)) store.set(k, v);
  }
};

export const load = async (_filename, _options) => {
  applySeed();
  return {
    get: async (key) => (store.has(key) ? store.get(key) : null),
    set: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
    save: async () => {},
    // Test helpers.
    __dump: () => Object.fromEntries(store),
    __clear: () => store.clear(),
  };
};

export default { load };