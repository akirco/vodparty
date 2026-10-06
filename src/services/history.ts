import { storage } from './storage';

/**
 * Persisted watch-history record.
 *
 * This deliberately does NOT keep the whole `Video` object: `vod_content` is
 * often several KB of HTML, so storing 100 of them meant rewriting a few
 * hundred KB on every save. Only the two fields the history page renders are
 * kept (`videoName` / `videoPic`); everything else is re-fetched on demand.
 */
export interface HistoryItem {
  videoId: number;
  videoName: string;
  videoPic: string;
  sourceId: string;
  groupName: string;
  playUrl: string;
  episodeIndex: number;
  currentTime: number;
  duration: number;
  timestamp: number;
}

const HISTORY_KEY = 'apple_cms_history';
const MAX_ITEMS = 100;
/** Coalesces the per-few-seconds playback updates into one write. */
const SAVE_DEBOUNCE_MS = 5000;

const sameVideo = (a: HistoryItem, b: HistoryItem) =>
  a.videoId === b.videoId && a.sourceId === b.sourceId;

// In-memory mirror so a save no longer has to re-read + re-parse the whole
// array out of localStorage / the Tauri store on every call.
let cache: HistoryItem[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

const persist = async (): Promise<void> => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!dirty || !cache) return;
  dirty = false;
  await storage.set(HISTORY_KEY, cache);
};

const schedulePersist = (): void => {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist();
  }, SAVE_DEBOUNCE_MS);
};

/** Force any debounced write out immediately (pause, unmount, page hide). */
export const flushHistory = (): Promise<void> => persist();

/**
 * Records from before the slimming stored the full `Video` under `video`.
 * Map them onto the new flat shape instead of dropping the user's history.
 */
const migrate = (raw: unknown): HistoryItem[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): HistoryItem[] => {
    if (!entry || typeof entry !== 'object') return [];
    const e = entry as Record<string, unknown>;
    const video = (e.video ?? {}) as Record<string, unknown>;
    return [
      {
        videoId: Number(e.videoId ?? video.vod_id ?? 0),
        videoName: String(e.videoName ?? video.vod_name ?? ''),
        videoPic: String(e.videoPic ?? video.vod_pic ?? ''),
        sourceId: String(e.sourceId ?? ''),
        groupName: String(e.groupName ?? ''),
        playUrl: String(e.playUrl ?? ''),
        episodeIndex: Number(e.episodeIndex ?? 0),
        currentTime: Number(e.currentTime ?? 0),
        duration: Number(e.duration ?? 0),
        timestamp: Number(e.timestamp ?? 0),
      },
    ];
  });
};

export const getHistory = async (): Promise<HistoryItem[]> => {
  if (typeof window === 'undefined') return [];
  if (!cache) {
    cache = migrate(await storage.get<unknown>(HISTORY_KEY));
  }
  return cache;
};

export const saveHistoryItem = async (
  item: Omit<HistoryItem, 'timestamp'>,
): Promise<void> => {
  if (typeof window === 'undefined') return;
  const history = await getHistory();
  const entry: HistoryItem = { ...item, timestamp: Date.now() };
  const existingIndex = history.findIndex((h) => sameVideo(h, entry));

  if (existingIndex >= 0) {
    history[existingIndex] = entry;
  } else {
    history.unshift(entry);
  }

  if (history.length > MAX_ITEMS) history.length = MAX_ITEMS;
  schedulePersist();
};

export const removeHistoryItem = async (
  videoId: number,
  sourceId?: string,
): Promise<void> => {
  if (typeof window === 'undefined') return;
  const history = await getHistory();
  cache = history.filter(
    (h) => !(h.videoId === videoId && (!sourceId || h.sourceId === sourceId)),
  );
  dirty = true;
  await persist();
};

export const clearHistory = async (): Promise<void> => {
  if (typeof window === 'undefined') return;
  // Cancel any queued debounced write, otherwise it would fire after the
  // clear and write the pre-clear snapshot back out.
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  cache = [];
  dirty = false;
  await storage.remove(HISTORY_KEY);
};
