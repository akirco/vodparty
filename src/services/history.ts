import { Video } from '../types';
import { storage } from './storage';

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

export const getHistory = async (): Promise<HistoryItem[]> => {
  if (typeof window === 'undefined') return [];
  const stored = await storage.get<HistoryItem[]>(HISTORY_KEY);
  return stored || [];
};

export const saveHistoryItem = async (item: HistoryItem) => {
  if (typeof window === 'undefined') return;
  const history = await getHistory();
  const existingIndex = history.findIndex(h => h.videoId === item.videoId);
  
  if (existingIndex >= 0) {
    history[existingIndex] = { ...history[existingIndex], ...item, timestamp: Date.now() };
  } else {
    history.unshift({ ...item, timestamp: Date.now() });
  }
  
  if (history.length > 100) history.pop();
  
  await storage.set(HISTORY_KEY, history);
};

export const removeHistoryItem = async (videoId: number) => {
  if (typeof window === 'undefined') return;
  const history = await getHistory();
  const updated = history.filter(h => h.videoId !== videoId);
  await storage.set(HISTORY_KEY, updated);
};

export const clearHistory = async () => {
  if (typeof window === 'undefined') return;
  await storage.remove(HISTORY_KEY);
};
