import { load } from '@tauri-apps/plugin-store';
import { isTauri } from '../utils';

type StoreInstance = Awaited<ReturnType<typeof load>>;

const storeCache = new Map<string, StoreInstance>();

type Route = { match: (key: string) => boolean; filename: string };

const ROUTES: Route[] = [
  {
    match: (k) =>
      k === 'apple_cms_sources' || k === 'apple_cms_primary_source_id',
    filename: 'sources.json',
  },
  {
    match: (k) => k.startsWith('apple_cms_categories'),
    filename: 'categories.json',
  },
  { match: (k) => k === 'apple_cms_history', filename: 'history.json' },
  {
    match: (k) => k.startsWith('apple_cms_hidden_categories'),
    filename: 'preferences.json',
  },
];

function resolveFilename(key: string): string {
  for (const r of ROUTES) {
    if (r.match(key)) return r.filename;
  }
  return 'synchive-store.json';
}

async function getTauriStore(key: string): Promise<StoreInstance> {
  const filename = resolveFilename(key);
  let store = storeCache.get(filename);
  if (!store) {
    store = await load(filename, { autoSave: true, defaults: {} });
    storeCache.set(filename, store);
  }
  return store;
}

export const storage = {
  async get<T>(key: string): Promise<T | null> {
    if (isTauri()) {
      try {
        const store = await getTauriStore(key);
        const value = await store.get<T>(key);
        return value ?? null;
      } catch {
        return null;
      }
    } else {
      try {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : null;
      } catch {
        return null;
      }
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    if (isTauri()) {
      const store = await getTauriStore(key);
      await store.set(key, value);
      await store.save();
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  },

  async remove(key: string): Promise<void> {
    if (isTauri()) {
      const store = await getTauriStore(key);
      await store.delete(key);
      await store.save();
    } else {
      localStorage.removeItem(key);
    }
  },
};
