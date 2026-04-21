import { invoke } from "@tauri-apps/api/core";
import { ApiSource, AppleCmsResponse, Category, Video } from "../types";
import { isTauri } from "../utils";
import { storage } from "./storage";

const DEFAULT_SOURCES: ApiSource[] = [];

let sources: ApiSource[] = DEFAULT_SOURCES;
let primarySourceId: string = "";

const loadSources = async () => {
  const stored = await storage.get<ApiSource[]>("apple_cms_sources");
  if (stored) sources = stored;
  const storedPrimary = await storage.get<string>("apple_cms_primary_source_id");
  if (storedPrimary && sources.find((s) => s.id === storedPrimary)) {
    primarySourceId = storedPrimary;
  } else if (sources.length > 0) {
    primarySourceId = sources[0].id;
  }
};

if (typeof window !== "undefined") {
  loadSources();
}

export const getSources = () => sources;
export const getPrimarySource = () =>
  sources.find((s) => s.id === primarySourceId) || sources[0];

export const saveSources = (newSources: ApiSource[], newPrimaryId: string) => {
  sources = newSources;
  primarySourceId = newPrimaryId;
  storage.set("apple_cms_sources", sources);
  storage.set("apple_cms_primary_source_id", primarySourceId);
};

const getCategoriesCacheKey = (sourceId: string) => 
  `apple_cms_categories_${sourceId}`;

const getCachedCategories = async (sourceId: string): Promise<Category[] | null> => {
  const cached = await storage.get<{ data: Category[]; timestamp: number }>(
    getCategoriesCacheKey(sourceId)
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

const fetchProxied = async (targetUrl: string) => {
  if (isTauri()) {
    const result = await invoke<string>("proxy_request", { url: targetUrl });
    return JSON.parse(result);
  } else {
    const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok)
      throw new Error(`Failed to fetch from proxy: ${res.statusText}`);
    return res.json();
  }
};

const getUrlForSource = (sourceId?: string) => {
  const source = sourceId
    ? sources.find((s) => s.id === sourceId)
    : getPrimarySource();
  return source ? source.url : "";
};

export const fetchCategories = async (
  sourceId?: string,
): Promise<AppleCmsResponse> => {
  const source = sourceId
    ? sources.find((s) => s.id === sourceId)
    : getPrimarySource();
  if (!source) throw new Error("No API source configured");
  
  const cached = await getCachedCategories(source.id);
  if (cached) {
    return { code: 1, msg: "", page: 1, pagecount: 1, limit: "20", total: cached.length, list: [], class: cached };
  }

  const baseUrl = source.url;
  const url = baseUrl.includes("?")
    ? `${baseUrl}&ac=list`
    : `${baseUrl}?ac=list`;
  const data = await fetchProxied(url);
  
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
  if (!baseUrl) throw new Error("No API source configured");
  let url = baseUrl.includes("?")
    ? `${baseUrl}&ac=videolist&pg=${page}`
    : `${baseUrl}?ac=videolist&pg=${page}`;
  if (typeId) url += `&t=${typeId}`;
  if (keyword) url += `&wd=${encodeURIComponent(keyword)}`;
  return fetchProxied(url);
};

export const fetchVideoDetails = async (
  id: number,
  sourceId?: string,
): Promise<Video | null> => {
  const baseUrl = getUrlForSource(sourceId);
  if (!baseUrl) throw new Error("No API source configured");
  const url = baseUrl.includes("?")
    ? `${baseUrl}&ac=videolist&ids=${id}`
    : `${baseUrl}?ac=videolist&ids=${id}`;
  const data: AppleCmsResponse = await fetchProxied(url);
  return data.list && data.list.length > 0 ? data.list[0] : null;
};