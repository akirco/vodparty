import { ApiSource, AppleCmsResponse, Video } from "../types";

const DEFAULT_SOURCES: ApiSource[] = [];

let sources: ApiSource[] = DEFAULT_SOURCES;
let primarySourceId: string = "";

if (typeof window !== "undefined") {
  const stored = localStorage.getItem("apple_cms_sources");
  if (stored) {
    try {
      sources = JSON.parse(stored);
    } catch (e) {}
  }
  const storedPrimary = localStorage.getItem("apple_cms_primary_source_id");
  if (storedPrimary && sources.find((s) => s.id === storedPrimary)) {
    primarySourceId = storedPrimary;
  } else if (sources.length > 0) {
    primarySourceId = sources[0].id;
  }
}

export const getSources = () => sources;
export const getPrimarySource = () =>
  sources.find((s) => s.id === primarySourceId) || sources[0];

export const saveSources = (newSources: ApiSource[], newPrimaryId: string) => {
  sources = newSources;
  primarySourceId = newPrimaryId;
  localStorage.setItem("apple_cms_sources", JSON.stringify(sources));
  localStorage.setItem("apple_cms_primary_source_id", primarySourceId);
};

const fetchProxied = async (targetUrl: string) => {
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Failed to fetch from proxy: ${res.statusText}`);
  return res.json();
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
  const baseUrl = getUrlForSource(sourceId);
  if (!baseUrl) throw new Error("No API source configured");
  const url = baseUrl.includes("?")
    ? `${baseUrl}&ac=list`
    : `${baseUrl}?ac=list`;
  return fetchProxied(url);
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
