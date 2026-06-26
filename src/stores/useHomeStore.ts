import { create } from 'zustand';
import { Video } from '../types';

interface HomeStore {
  videos: Video[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  scrollPosition: number;

  setVideos: (videos: Video[]) => void;
  appendVideos: (videos: Video[]) => void;
  setPage: (page: number) => void;
  setHasMore: (hasMore: boolean) => void;
  setLoading: (loading: boolean) => void;
  setScrollPosition: (pos: number) => void;
  reset: () => void;
}

export const useHomeStore = create<HomeStore>((set) => ({
  videos: [],
  page: 1,
  hasMore: true,
  loading: false,
  scrollPosition: 0,

  setVideos: (videos) => set({ videos }),
  appendVideos: (videos) => set((s) => ({ videos: [...s.videos, ...videos] })),
  setPage: (page) => set({ page }),
  setHasMore: (hasMore) => set({ hasMore }),
  setLoading: (loading) => set({ loading }),
  setScrollPosition: (scrollPosition) => set({ scrollPosition }),
  reset: () =>
    set({
      videos: [],
      page: 1,
      hasMore: true,
      loading: false,
      scrollPosition: 0,
    }),
}));
