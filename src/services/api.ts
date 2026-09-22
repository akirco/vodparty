import { invoke } from '@tauri-apps/api/core';
import { ensureSourcesLoaded, useSourceStore } from '../stores/useSourceStore';
import { AppleCmsResponse, Category, Video } from '../types';
import { appendUrlParam, isTauri } from '../utils';
import { storage } from './storage';

const cache = new Map<string, { data: unknown; timestamp: number }>();
const inflight = new Map<string, Promise<unknown>>();
const CACHE_TTL = 5_000;

function cacheKey(url: string): string {
  return isTauri() ? `tauri:${url}` : `http:${url}`;
}

async function dedupedFetch<T>(url: string, ttl = CACHE_TTL): Promise<T> {
  const key = cacheKey(url);

  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data as T;
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    try {
      const data = await doFetch(url);
      cache.set(key, { data, timestamp: Date.now() });
      return data as T;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

async function doFetch(targetUrl: string) {
  if (isTauri()) {
    const result = await invoke<string>('proxy_request', { url: targetUrl });
    return JSON.parse(result);
  } else {
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok)
      throw new Error(`Failed to fetch from proxy: ${res.statusText}`);
    return res.json();
  }
}

export function clearCache() {
  cache.clear();
  for (const key of inflight.keys()) {
    cache.delete(key);
  }
  inflight.clear();
}

const getCategoriesCacheKey = (sourceId: string) =>
  `apple_cms_categories_${sourceId}`;

const EMPTY_CATEGORIES_TTL = 24 * 60 * 60 * 1000;

const getEmptyCategoriesCacheKey = (sourceId: string) =>
  `apple_cms_categories_empty_${sourceId}`;

const getCachedEmptyCategories = async (
  sourceId: string,
): Promise<number[] | null> => {
  const cached = await storage.get<{ data: number[]; timestamp: number }>(
    getEmptyCategoriesCacheKey(sourceId),
  );
  if (cached && Date.now() - cached.timestamp < EMPTY_CATEGORIES_TTL) {
    return cached.data;
  }
  return null;
};

const setCachedEmptyCategories = async (
  sourceId: string,
  emptyIds: number[],
) => {
  await storage.set(getEmptyCategoriesCacheKey(sourceId), {
    data: emptyIds,
    timestamp: Date.now(),
  });
};

const getCachedCategories = async (
  sourceId: string,
): Promise<Category[] | null> => {
  const cached = await storage.get<{ data: Category[]; timestamp: number }>(
    getCategoriesCacheKey(sourceId),
  );
  if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
    return cached.data;
  }
  return null;
};

const setCachedCategories = async (sourceId: string, data: Category[]) => {
  await storage.set(getCategoriesCacheKey(sourceId), {
    data,
    timestamp: Date.now(),
  });
};

const getUrlForSource = (sourceId?: string) => {
  const { sources, primarySourceId } = useSourceStore.getState();
  const source = sourceId
    ? sources.find((s) => s.id === sourceId)
    : sources.find((s) => s.id === primarySourceId) || sources[0];
  return source ? source.url : '';
};

export const fetchCategories = async (
  sourceId?: string,
): Promise<AppleCmsResponse> => {
  const { sources, primarySourceId } = useSourceStore.getState();
  const source = sourceId
    ? sources.find((s) => s.id === sourceId)
    : sources.find((s) => s.id === primarySourceId) || sources[0];
  if (!source) throw new Error('No API source configured');

  const cached = await getCachedCategories(source.id);
  if (cached) {
    return {
      code: 1,
      msg: '',
      page: 1,
      pagecount: 1,
      limit: '20',
      total: cached.length,
      list: [],
      class: cached,
    };
  }

  const url = appendUrlParam(source.url, 'ac=list');
  const data = await dedupedFetch<AppleCmsResponse>(url);

  if (data.class) {
    await setCachedCategories(source.id, data.class);
  }

  return data;
};

export const fetchVideos = async (
  page = 1,
  typeId?: number,
  keyword?: string,
  sourceId?: string,
): Promise<AppleCmsResponse> => {
  const baseUrl = getUrlForSource(sourceId);
  if (!baseUrl) throw new Error('No API source configured');
  let url = appendUrlParam(baseUrl, `ac=videolist&pg=${page}`);
  if (typeId) url += `&t=${typeId}`;
  if (keyword) url += `&wd=${encodeURIComponent(keyword)}`;
  return dedupedFetch<AppleCmsResponse>(url);
};

export const fetchVideoDetails = async (
  id: number,
  sourceId?: string,
): Promise<Video | null> => {
  const baseUrl = getUrlForSource(sourceId);
  if (!baseUrl) throw new Error('No API source configured');
  const url = appendUrlParam(baseUrl, `ac=videolist&ids=${id}`);
  const data = await dedupedFetch<AppleCmsResponse>(url);
  return data.list && data.list.length > 0 ? data.list[0] : null;
};

/** Whether a category returns any videos (page 1, no pagination needed). */
export const fetchCategoryHasVideos = async (
  typeId: number,
  sourceId?: string,
): Promise<boolean> => {
  const data = await fetchVideos(1, typeId, undefined, sourceId);
  return (
    (data.list?.length ?? 0) > 0 ||
    (data.pagecount ?? 0) > 0 ||
    (data.total ?? 0) > 0
  );
};

/**
 * Probe every category and report which ones have content. Probing is done
 * with limited concurrency and the result is cached for 24h so the home page
 * doesn't hammer the upstream on every visit. `onResult` is called for each
 * category as its result resolves (used for progressive tab rendering).
 */
export const fetchEmptyCategoryIds = async (
  categories: Category[],
  sourceId: string,
  onResult?: (typeId: number, hasVideos: boolean) => void,
): Promise<number[]> => {
  const cached = await getCachedEmptyCategories(sourceId);
  if (cached) {
    const emptySet = new Set(cached);
    categories.forEach((cat) =>
      onResult?.(cat.type_id, !emptySet.has(cat.type_id)),
    );
    return cached;
  }

  const emptyIds: number[] = [];
  const concurrency = Math.min(4, Math.max(1, categories.length));
  let index = 0;

  const worker = async () => {
    while (index < categories.length) {
      const cat = categories[index++];
      try {
        const has = await fetchCategoryHasVideos(cat.type_id, sourceId);
        if (!has) emptyIds.push(cat.type_id);
        onResult?.(cat.type_id, has);
      } catch {
        // Unknown result — keep the tab visible rather than hiding it.
        onResult?.(cat.type_id, true);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  await setCachedEmptyCategories(sourceId, emptyIds);
  return emptyIds;
};

export { ensureSourcesLoaded };
