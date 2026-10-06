import { create } from 'zustand';
import type { Video } from '../types';

interface HomeStore {
  videos: Video[];
  page: number;
  hasMore: boolean;
  loading: boolean;

  setVideos: (videos: Video[]) => void;
  appendVideos: (videos: Video[]) => void;
  setPage: (page: number) => void;
  setHasMore: (hasMore: boolean) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useHomeStore = create<HomeStore>((set) => ({
  videos: [],
  page: 1,
  hasMore: true,
  loading: false,

  setVideos: (videos) => set({ videos }),
  appendVideos: (videos) => set((s) => ({ videos: [...s.videos, ...videos] })),
  setPage: (page) => set({ page }),
  setHasMore: (hasMore) => set({ hasMore }),
  setLoading: (loading) => set({ loading }),
  reset: () =>
    set({
      videos: [],
      page: 1,
      hasMore: true,
      loading: false,
    }),
}));

/**
 * Restored scroll offset, kept module-level and non-reactive on purpose.
 * It used to live in the zustand store, which meant every scroll frame
 * re-rendered the whole home page and its entire video grid; nothing ever
 * renders this value, it is only read back on mount.
 */
export const homeScrollPosition = { current: 0 };
