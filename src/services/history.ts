import { Video } from '../types';

export interface HistoryItem {
  videoId: number;
  video: Video;
  sourceId: string;
  groupName: string;
  playUrl: string;
  episodeIndex: number;
  currentTime: number;
  duration: number;
  timestamp: number;
}

const HISTORY_KEY = 'apple_cms_history';

export const getHistory = (): HistoryItem[] => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

export const saveHistoryItem = (item: HistoryItem) => {
  if (typeof window === 'undefined') return;
  const history = getHistory();
  const existingIndex = history.findIndex(h => h.videoId === item.videoId);
  
  if (existingIndex >= 0) {
    history[existingIndex] = { ...history[existingIndex], ...item, timestamp: Date.now() };
  } else {
    history.unshift({ ...item, timestamp: Date.now() });
  }
  
  // Keep last 100 items
  if (history.length > 100) history.pop();
  
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
};

export const removeHistoryItem = (videoId: number) => {
  if (typeof window === 'undefined') return;
  const history = getHistory();
  const updated = history.filter(h => h.videoId !== videoId);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
};

export const clearHistory = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(HISTORY_KEY);
};
