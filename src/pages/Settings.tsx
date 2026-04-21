import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Save,
  Star,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import {
  fetchCategories,
  getPrimarySource,
  getSources,
  saveSources,
} from "../services/api";
import {
  getHiddenCategories,
  saveHiddenCategories,
} from "../services/preferences";
import { ApiSource, Category } from "../types";
import { isTauri } from "../utils";
import { getPusherSettings, savePusherSettings, getProxySettings, saveProxySettings } from "../config/pusher";

const testSource = async (url: string): Promise<"valid" | "invalid"> => {
  try {
    const testUrl = url.includes("?") ? `${url}&ac=list` : `${url}?ac=list`;
    let data: any;
    if (isTauri()) {
      const result = await invoke<string>("proxy_request", { url: testUrl });
      data = JSON.parse(result);
    } else {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(testUrl)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) return "invalid";
      data = await res.json();
    }
    if (data.list || [0, 1, 200].includes(data.code)) {
      return "valid";
    }
    return "invalid";
  } catch (e) {
    console.error("testSource error:", e);
    return "invalid";
  }
};

export const Settings: React.FC = () => {
  const [sources, setSources] = useState<ApiSource[]>([]);
  const [primaryId, setPrimaryId] = useState("");
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const [newUrl, setNewUrl] = useState("");
  const [newType, setNewType] = useState("");

  const [showBatchImport, setShowBatchImport] = useState(false);
  const [batchInput, setBatchInput] = useState("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [hiddenCategories, setHiddenCategories] = useState<number[]>([]);

  const [pusherAppId, setPusherAppId] = useState("");
  const [pusherKey, setPusherKey] = useState("");
  const [pusherSecret, setPusherSecret] = useState("");
  const [pusherCluster, setPusherCluster] = useState("ap1");

  const [httpProxy, setHttpProxy] = useState("");
  const [httpsProxy, setHttpsProxy] = useState("");

  const [selectedType, setSelectedType] = useState<string>("");

  const allTypes = [...new Set(sources.map((s) => s.type).filter(Boolean))];
  const filteredSources = selectedType
    ? sources.filter((s) => s.type === selectedType)
    : sources;

  useEffect(() => {
    const primary = getPrimarySource();
    if (primary) {
      setPrimaryId(primary.id);
      getHiddenCategories(primary.id).then(setHiddenCategories);
    }
    const initialSources = getSources();
    setSources(initialSources);

    const loadCategories = async () => {
      try {
        const res = await fetchCategories();
        if (res.class) {
          setCategories(res.class);
        }
      } catch (error) {}
    };
    loadCategories();

    const testAllSources = async () => {
      const allSources = getSources();
      const tested = await Promise.all(
        allSources.map(async (s) => ({
          ...s,
          status: s.url ? await testSource(s.url) : s.status,
        })),
      );
      setSources(tested);
      saveSources(tested, primary?.id || "");
    };
    testAllSources();

    getPusherSettings().then((settings) => {
      setPusherAppId(settings.app_id);
      setPusherKey(settings.key);
      setPusherSecret(settings.secret);
      setPusherCluster(settings.cluster);
    });

    getProxySettings().then((settings) => {
      setHttpProxy(settings.http_proxy);
      setHttpsProxy(settings.https_proxy);
    });
  }, []);

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl) return;
    if (sources.some((s) => s.url === newUrl)) return;
    const newSource: ApiSource = {
      id: Date.now().toString(),
      name: `${Date.now().toString().slice(-4)}${Math.random().toString(36).slice(2, 6)}`,
      url: newUrl,
      type: newType,
      status: "testing",
    };
    const allSourcesWithNew = [...sources, newSource];
    setSources(allSourcesWithNew);
    setNewUrl("");
    setNewType("");
    setHasChanges(true);

    const status = await testSource(newUrl);
    const updatedSources = allSourcesWithNew.map((s) =>
      s.id === newSource.id ? { ...s, status } : s,
    );
    setSources(updatedSources);
    saveSources(updatedSources, primaryId);
  };

  const handleBatchImport = async () => {
    const lines = batchInput.split("\n").filter((line) => line.trim());
    const existingUrls = new Set(sources.map((s) => s.url));
    const newSources: ApiSource[] = lines
      .map((line, index) => ({
        id: (Date.now() + index).toString(),
        name: `${Date.now().toString().slice(-4)}${Math.random().toString(36).slice(2, 6)}`,
        url: line.trim(),
        type: newType,
        status: "testing" as const,
      }))
      .filter((s) => !existingUrls.has(s.url));
    setSources([...sources, ...newSources]);
    setBatchInput("");
    setNewType("");
    setShowBatchImport(false);
    setHasChanges(true);

    const allSourcesWithNew = [...sources, ...newSources];
    for (const source of newSources) {
      const status = await testSource(source.url);
      const idx = allSourcesWithNew.findIndex((s) => s.id === source.id);
      if (idx >= 0) {
        allSourcesWithNew[idx] = { ...source, status };
      }
    }
    setSources(allSourcesWithNew);
    saveSources(allSourcesWithNew, primaryId);
  };

  const handleSave = async () => {
    try {
      console.log("[Settings] Saving Pusher:", { pusherAppId, pusherKey, pusherSecret, pusherCluster });
      await saveSources(sources, primaryId);
      await saveHiddenCategories(primaryId, hiddenCategories);
      await savePusherSettings(pusherAppId, pusherKey, pusherSecret, pusherCluster);
      await saveProxySettings(httpProxy, httpsProxy);
      setHasChanges(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("[Settings] Save error:", err);
    }
  };

  const handleRemoveSource = (id: string) => {
    const updated = sources.filter((s) => s.id !== id);
    setSources(updated);
    setHasChanges(true);
    if (primaryId === id && updated.length > 0) {
      setPrimaryId(updated[0].id);
    }
  };

  const toggleCategoryVisibility = (categoryId: number) => {
    setHiddenCategories((prev) => {
      const updated = prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId];
      setHasChanges(true);
      return updated;
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-white">Settings</h2>
        <p className="text-zinc-400 mt-2">
          Manage your Apple CMS JSON API sources and preferences.
        </p>
      </div>
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6">
        <div className="flex items-center gap-4 justify-end">
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {hasChanges ? "Save Changes" : "Save Configuration"}
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-emerald-500 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" />
              Saved successfully
            </span>
          )}
          {hasChanges && !saved && (
            <span className="flex items-center gap-1 text-amber-500 text-sm font-medium">
              Unsaved changes
            </span>
          )}
        </div>
      </div>
      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">API Sources</h3>
          <button
            onClick={() => setShowBatchImport(true)}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Upload className="w-4 h-4" /> Batch Import
          </button>
        </div>
        <form
          onSubmit={handleAddSource}
          className="flex flex-wrap gap-3 pt-4 border-t border-zinc-800/50"
        >
          <input
            type="text"
            placeholder="Type (e.g. m3u8)"
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="w-32 bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
          />
          <input
            type="url"
            placeholder="https://.../api.php/provide/vod/"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm font-mono"
            required
          />
          <button
            type="submit"
            className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </form>

        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setSelectedType("")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              selectedType === ""
                ? "bg-indigo-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            All ({sources.length})
          </button>
          {allTypes.map((type) => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                selectedType === type
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              {type} ({sources.filter((s) => s.type === type).length})
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {filteredSources.map((source) => (
            <div
              key={source.id}
              className={`flex items-center justify-between p-4 rounded-lg border ${primaryId === source.id ? "border-indigo-500 bg-indigo-500/10" : "border-zinc-800/50 bg-zinc-950"}`}
            >
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2">
                  <h4 className="text-white font-medium truncate">
                    {source.name}
                  </h4>
                  {primaryId === source.id && (
                    <span className="px-2 py-0.5 bg-indigo-500 text-white text-[10px] uppercase font-bold rounded-full">
                      Primary
                    </span>
                  )}
                  {source.status === "valid" && (
                    <span className="flex items-center gap-1 text-emerald-500 text-xs">
                      <CheckCircle className="w-3.5 h-3.5" /> Valid
                    </span>
                  )}
                  {source.status === "invalid" && (
                    <span className="flex items-center gap-1 text-red-500 text-xs">
                      <XCircle className="w-3.5 h-3.5" /> Invalid
                    </span>
                  )}
                  {source.status === "testing" && (
                    <span className="flex items-center gap-1 text-yellow-500 text-xs">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing
                    </span>
                  )}
                </div>
                <p className="text-zinc-500 text-sm truncate font-mono mt-1">
                  {source.url}
                </p>
                {source.type && (
                  <p className="text-indigo-500 text-xs mt-0.5">
                    Type: {source.type}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {primaryId !== source.id && (
                  <button
                    onClick={() => {
                      setPrimaryId(source.id);
                      setHasChanges(true);
                    }}
                    className="p-2 text-zinc-400 hover:text-indigo-400 transition-colors"
                    title="Set as Primary"
                  >
                    <Star className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={() => handleRemoveSource(source.id)}
                  className="p-2 text-zinc-400 hover:text-red-400 transition-colors"
                  title="Remove Source"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {categories.length > 0 && (
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 space-y-6">
          <h3 className="text-xl font-semibold text-white">
            Category Visibility
          </h3>
          <p className="text-zinc-400 text-sm">
            Choose which categories to show on the home page.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {categories.map((cat) => {
              const isHidden = hiddenCategories.includes(cat.type_id);
              return (
                <button
                  key={cat.type_id}
                  onClick={() => toggleCategoryVisibility(cat.type_id)}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                    isHidden
                      ? "border-zinc-800/50 bg-zinc-950/50 text-zinc-500"
                      : "border-indigo-500/30 bg-indigo-500/10 text-indigo-100"
                  }`}
                >
                  <span className="text-sm font-medium truncate pr-2">
                    {cat.type_name}
                  </span>
                  {isHidden ? (
                    <EyeOff className="w-4 h-4 shrink-0" />
                  ) : (
                    <Eye className="w-4 h-4 shrink-0 text-indigo-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 space-y-6">
        <h3 className="text-xl font-semibold text-white">
          Watch Party (Pusher)
        </h3>
        <p className="text-zinc-400 text-sm">
          Configure Pusher for real-time watch party synchronization.
        </p>

        <div className="grid gap-4">
          <div>
            <label className="text-zinc-500 text-sm block mb-2">App ID</label>
            <input
              type="text"
              placeholder="Enter Pusher App ID"
              value={pusherAppId}
              onChange={(e) => {
                setPusherAppId(e.target.value);
                setHasChanges(true);
              }}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="text-zinc-500 text-sm block mb-2">Key</label>
            <input
              type="text"
              placeholder="Enter Pusher key"
              value={pusherKey}
              onChange={(e) => {
                setPusherKey(e.target.value);
                setHasChanges(true);
              }}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="text-zinc-500 text-sm block mb-2">Secret</label>
            <input
              type="password"
              placeholder="Enter Pusher secret"
              value={pusherSecret}
              onChange={(e) => {
                setPusherSecret(e.target.value);
                setHasChanges(true);
              }}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="text-zinc-500 text-sm block mb-2">Cluster</label>
            <input
              type="text"
              placeholder="e.g. ap1"
              value={pusherCluster}
              onChange={(e) => {
                setPusherCluster(e.target.value);
                setHasChanges(true);
              }}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 space-y-6">
        <h3 className="text-xl font-semibold text-white">
          Proxy Settings
        </h3>
        <p className="text-zinc-400 text-sm">
          Configure proxy for network requests (used when shortcut launching doesn't inherit system proxy).
        </p>

        <div className="grid gap-4">
          <div>
            <label className="text-zinc-500 text-sm block mb-2">HTTP Proxy</label>
            <input
              type="text"
              placeholder="http://127.0.0.1:7890"
              value={httpProxy}
              onChange={(e) => {
                setHttpProxy(e.target.value);
                setHasChanges(true);
              }}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="text-zinc-500 text-sm block mb-2">HTTPS Proxy</label>
            <input
              type="text"
              placeholder="http://127.0.0.1:7890"
              value={httpsProxy}
              onChange={(e) => {
                setHttpsProxy(e.target.value);
                setHasChanges(true);
              }}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
        </div>
      </div>

      {showBatchImport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-white">
                Batch Import URLs
              </h3>
              <button
                onClick={() => setShowBatchImport(false)}
                className="p-2 text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-zinc-400 text-sm">
              Enter one URL per line. Names will be auto-generated.
            </p>
            <input
              type="text"
              placeholder="Type (e.g. m3u8)"
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
            <textarea
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              placeholder="https://example.com/api1.php&#10;https://example.com/api2.php&#10;https://example.com/api3.php"
              className="w-full h-64 bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-3 text-white focus:border-indigo-500 focus:outline-none text-sm font-mono resize-none"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowBatchImport(false)}
                className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchImport}
                disabled={!batchInput.trim()}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                <Upload className="w-4 h-4" /> Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
