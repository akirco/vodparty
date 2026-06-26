import { create } from 'zustand';
import { storage } from '../services/storage';
import { ApiSource } from '../types';

interface SourceStore {
  sources: ApiSource[];
  primarySourceId: string;
  loaded: boolean;
  loading: boolean;
  loadSources: () => Promise<void>;
  saveSources: (newSources: ApiSource[], newPrimaryId: string) => Promise<void>;
}

let loadPromise: Promise<void> | null = null;

export const useSourceStore = create<SourceStore>((set, get) => ({
  sources: [],
  primarySourceId: '',
  loaded: false,
  loading: false,

  loadSources: async () => {
    if (get().loaded) return;
    set({ loading: true });
    try {
      const stored = await storage.get<ApiSource[]>('apple_cms_sources');
      const storedPrimary = await storage.get<string>(
        'apple_cms_primary_source_id',
      );
      const sources = stored || [];
      let primarySourceId = '';
      if (storedPrimary && sources.find((s) => s.id === storedPrimary)) {
        primarySourceId = storedPrimary;
      } else if (sources.length > 0) {
        primarySourceId = sources[0].id;
      }
      set({ sources, primarySourceId, loaded: true, loading: false });
    } catch {
      set({ loaded: true, loading: false });
    }
  },

  saveSources: async (newSources, newPrimaryId) => {
    set({ sources: newSources, primarySourceId: newPrimaryId });
    await storage.set('apple_cms_sources', newSources);
    await storage.set('apple_cms_primary_source_id', newPrimaryId);
  },
}));

export const ensureSourcesLoaded = (): Promise<void> => {
  const { loaded } = useSourceStore.getState();
  if (loaded) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = useSourceStore.getState().loadSources();
  }
  return loadPromise;
};
