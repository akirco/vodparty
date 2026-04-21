import { load } from "@tauri-apps/plugin-store";
import { isTauri } from "../utils";

let tauriStore: Awaited<ReturnType<typeof load>> | null = null;

const getTauriStore = async () => {
  if (!tauriStore) {
    tauriStore = await load("synchive-store.json", {
      autoSave: true,
      defaults: {},
    });
  }
  return tauriStore;
};

export const storage = {
  async get<T>(key: string): Promise<T | null> {
    if (isTauri()) {
      try {
        const store = await getTauriStore();
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
      const store = await getTauriStore();
      await store.set(key, value);
      await store.save();
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  },

  async remove(key: string): Promise<void> {
    if (isTauri()) {
      const store = await getTauriStore();
      await store.delete(key);
      await store.save();
    } else {
      localStorage.removeItem(key);
    }
  },
};
