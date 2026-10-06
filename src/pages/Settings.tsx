import { invoke } from '@tauri-apps/api/core';
import {
  CheckCircle,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Star,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import {
  getProxySettings,
  getPusherSettings,
  saveProxySettings,
  savePusherSettings,
} from '../config/pusher';
import { fetchCategories } from '../services/api';
import {
  getHiddenCategories,
  saveHiddenCategories,
} from '../services/preferences';
import { ensureSourcesLoaded, useSourceStore } from '../stores/useSourceStore';
import type { ApiSource, Category } from '../types';
import { appendUrlParam, isTauri } from '../utils';

const testSource = async (url: string): Promise<'valid' | 'invalid'> => {
  try {
    const testUrl = appendUrlParam(url, 'ac=list');
    let data: any;
    if (isTauri()) {
      const result = await invoke<string>('proxy_request', { url: testUrl });
      data = JSON.parse(result);
    } else {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(testUrl)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) return 'invalid';
      data = await res.json();
    }
    if (data.list || [0, 1, 200].includes(data.code)) {
      return 'valid';
    }
    return 'invalid';
  } catch (e) {
    console.error('testSource error:', e);
    return 'invalid';
  }
};

export const Settings: React.FC = () => {
  const [sources, setSources] = useState<ApiSource[]>([]);
  const [primaryId, setPrimaryId] = useState('');

  const [newUrl, setNewUrl] = useState('');
  const [newType, setNewType] = useState('');

  const [showBatchImport, setShowBatchImport] = useState(false);
  const [batchInput, setBatchInput] = useState('');

  const [categories, setCategories] = useState<Category[]>([]);
  const [hiddenCategories, setHiddenCategories] = useState<number[]>([]);

  // Pusher / proxy fields are edited locally and persisted on an explicit
  // Save. Previously each keystroke called into the Tauri store (a disk write)
  // and rebuilt the Pusher client.
  const [pusherAppId, setPusherAppId] = useState('');
  const [pusherKey, setPusherKey] = useState('');
  const [pusherSecret, setPusherSecret] = useState('');
  const [pusherCluster, setPusherCluster] = useState('ap1');
  const [pusherSaved, setPusherSaved] = useState(false);
  const [pusherError, setPusherError] = useState<string | null>(null);

  const [httpProxy, setHttpProxy] = useState('');
  const [httpsProxy, setHttpsProxy] = useState('');
  const [proxySaved, setProxySaved] = useState(false);

  const [selectedType, setSelectedType] = useState<string>('');

  // Snapshot of what is actually persisted, used to detect edits and to roll
  // the form back to the saved state after a successful write.
  const [loadedPusher, setLoadedPusher] = useState({
    app_id: '',
    key: '',
    secret: '',
    cluster: 'ap1',
  });
  const [loadedProxy, setLoadedProxy] = useState({
    http_proxy: '',
    https_proxy: '',
  });

  const pusherDirty =
    pusherAppId !== loadedPusher.app_id ||
    pusherKey !== loadedPusher.key ||
    pusherSecret !== loadedPusher.secret ||
    pusherCluster !== loadedPusher.cluster;

  const proxyDirty =
    httpProxy !== loadedProxy.http_proxy ||
    httpsProxy !== loadedProxy.https_proxy;

  const handleSavePusher = async () => {
    try {
      await savePusherSettings(
        pusherAppId,
        pusherKey,
        pusherSecret,
        pusherCluster,
      );
      setLoadedPusher({
        app_id: pusherAppId,
        key: pusherKey,
        secret: pusherSecret,
        cluster: pusherCluster,
      });
      setPusherError(null);
      setPusherSaved(true);
      setTimeout(() => setPusherSaved(false), 2000);
    } catch (err) {
      setPusherError(
        err instanceof Error ? err.message : 'Failed to save Pusher settings',
      );
    }
  };

  const handleSaveProxy = async () => {
    try {
      await saveProxySettings(httpProxy, httpsProxy);
      setLoadedProxy({ http_proxy: httpProxy, https_proxy: httpsProxy });
      setProxySaved(true);
      setTimeout(() => setProxySaved(false), 2000);
    } catch (err) {
      console.error('Failed to save proxy settings:', err);
    }
  };

  const allTypes = [...new Set(sources.map((s) => s.type).filter(Boolean))];
  const filteredSources = selectedType
    ? sources.filter((s) => s.type === selectedType)
    : sources;

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // Wait for persisted sources to be loaded before reading the store,
      // otherwise re-saving on mount wipes stored sources with an empty list.
      await ensureSourcesLoaded();
      if (cancelled) return;

      const { sources: storeSources, primarySourceId: storePrimary } =
        useSourceStore.getState();
      const primary =
        storeSources.find((s) => s.id === storePrimary) || storeSources[0];
      if (primary) {
        setPrimaryId(primary.id);
        getHiddenCategories(primary.id).then(setHiddenCategories);
      }
      setSources(storeSources);

      const loadCategories = async () => {
        try {
          const res = await fetchCategories();
          if (res.class) {
            setCategories(res.class);
          }
        } catch {}
      };
      loadCategories();

      if (storeSources.length > 0) {
        const state = useSourceStore.getState();
        const tested = await Promise.all(
          state.sources.map(async (s) => ({
            ...s,
            status: s.url ? await testSource(s.url) : s.status,
          })),
        );
        if (cancelled) return;
        setSources(tested);
        state.saveSources(tested, primary?.id || '');
      }

      getPusherSettings().then((settings) => {
        if (cancelled) return;
        setPusherAppId(settings.app_id);
        setPusherKey(settings.key);
        setPusherSecret(settings.secret);
        setPusherCluster(settings.cluster);
        setLoadedPusher(settings);
      });

      getProxySettings().then((settings) => {
        if (cancelled) return;
        setHttpProxy(settings.http_proxy);
        setHttpsProxy(settings.https_proxy);
        setLoadedProxy(settings);
      });
    };

    init();

    return () => {
      cancelled = true;
    };
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
      status: 'testing',
    };
    const allSourcesWithNew = [...sources, newSource];
    setSources(allSourcesWithNew);
    setNewUrl('');
    setNewType('');
    const status = await testSource(newUrl);
    const updatedSources = allSourcesWithNew.map((s) =>
      s.id === newSource.id ? { ...s, status } : s,
    );
    setSources(updatedSources);
    useSourceStore.getState().saveSources(updatedSources, primaryId);
  };

  const handleBatchImport = async () => {
    const lines = batchInput.split('\n').filter((line) => line.trim());
    const existingUrls = new Set(sources.map((s) => s.url));
    const newSources: ApiSource[] = lines
      .map((line, index) => ({
        id: (Date.now() + index).toString(),
        name: `${Date.now().toString().slice(-4)}${Math.random().toString(36).slice(2, 6)}`,
        url: line.trim(),
        type: newType,
        status: 'testing' as const,
      }))
      .filter((s) => !existingUrls.has(s.url));
    setSources([...sources, ...newSources]);
    setBatchInput('');
    setNewType('');
    setShowBatchImport(false);

    const allSourcesWithNew = [...sources, ...newSources];
    for (const source of newSources) {
      const status = await testSource(source.url);
      const idx = allSourcesWithNew.findIndex((s) => s.id === source.id);
      if (idx >= 0) {
        allSourcesWithNew[idx] = { ...source, status };
      }
    }
    setSources(allSourcesWithNew);
    useSourceStore.getState().saveSources(allSourcesWithNew, primaryId);
  };

  const handleRemoveSource = (id: string) => {
    const updated = sources.filter((s) => s.id !== id);
    setSources(updated);
    const newPrimaryId =
      primaryId === id && updated.length > 0 ? updated[0].id : primaryId;
    if (primaryId === id) setPrimaryId(newPrimaryId);
    useSourceStore.getState().saveSources(updated, newPrimaryId);
  };

  const toggleCategoryVisibility = (categoryId: number) => {
    setHiddenCategories((prev) => {
      const updated = prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId];
      saveHiddenCategories(primaryId, updated);
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

      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">API Sources</h3>
          <button
            type="button"
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
            type="button"
            onClick={() => setSelectedType('')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              selectedType === ''
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            All ({sources.length})
          </button>
          {allTypes.map((type) => (
            <button
              type="button"
              key={type}
              onClick={() => setSelectedType(type)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                selectedType === type
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
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
              className={`flex items-center justify-between p-4 rounded-lg border ${primaryId === source.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-800/50 bg-zinc-950'}`}
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
                  {source.status === 'valid' && (
                    <span className="flex items-center gap-1 text-emerald-500 text-xs">
                      <CheckCircle className="w-3.5 h-3.5" /> Valid
                    </span>
                  )}
                  {source.status === 'invalid' && (
                    <span className="flex items-center gap-1 text-red-500 text-xs">
                      <XCircle className="w-3.5 h-3.5" /> Invalid
                    </span>
                  )}
                  {source.status === 'testing' && (
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
                    type="button"
                    onClick={() => {
                      setPrimaryId(source.id);
                      useSourceStore.getState().saveSources(sources, source.id);
                      getHiddenCategories(source.id).then(setHiddenCategories);
                    }}
                    className="p-2 text-zinc-400 hover:text-indigo-400 transition-colors"
                    title="Set as Primary"
                  >
                    <Star className="w-5 h-5" />
                  </button>
                )}
                <button
                  type="button"
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
                  type="button"
                  key={cat.type_id}
                  onClick={() => toggleCategoryVisibility(cat.type_id)}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                    isHidden
                      ? 'border-zinc-800/50 bg-zinc-950/50 text-zinc-500'
                      : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-100'
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
            <label
              htmlFor="pusher-app-id"
              className="text-zinc-500 text-sm block mb-2"
            >
              App ID
            </label>
            <input
              id="pusher-app-id"
              type="text"
              placeholder="Enter Pusher App ID"
              value={pusherAppId}
              onChange={(e) => setPusherAppId(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="pusher-key"
              className="text-zinc-500 text-sm block mb-2"
            >
              Key
            </label>
            <input
              id="pusher-key"
              type="text"
              placeholder="Enter Pusher key"
              value={pusherKey}
              onChange={(e) => setPusherKey(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="pusher-secret"
              className="text-zinc-500 text-sm block mb-2"
            >
              Secret
            </label>
            <input
              id="pusher-secret"
              type="password"
              placeholder="Enter Pusher secret"
              value={pusherSecret}
              onChange={(e) => setPusherSecret(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="pusher-cluster"
              className="text-zinc-500 text-sm block mb-2"
            >
              Cluster
            </label>
            <input
              id="pusher-cluster"
              type="text"
              placeholder="e.g. ap1"
              value={pusherCluster}
              onChange={(e) => setPusherCluster(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSavePusher}
            disabled={!pusherDirty || pusherSaved}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {pusherSaved ? (
              <>
                <CheckCircle className="w-4 h-4" /> Saved
              </>
            ) : (
              'Save Pusher settings'
            )}
          </button>
          {pusherError && (
            <span className="text-sm text-red-400">{pusherError}</span>
          )}
        </div>
        {!isTauri() && (
          <p className="text-xs text-zinc-500">
            In the browser build these values come from build-time environment
            variables and cannot be changed at runtime. Save applies to the
            desktop app only.
          </p>
        )}
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-6 space-y-6">
        <h3 className="text-xl font-semibold text-white">Proxy Settings</h3>
        <p className="text-zinc-400 text-sm">
          Configure proxy for network requests (used when shortcut launching
          doesn't inherit system proxy).
        </p>

        <div className="grid gap-4">
          <div>
            <label
              htmlFor="http-proxy"
              className="text-zinc-500 text-sm block mb-2"
            >
              HTTP Proxy
            </label>
            <input
              id="http-proxy"
              type="text"
              placeholder="http://127.0.0.1:7890"
              value={httpProxy}
              onChange={(e) => setHttpProxy(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="https-proxy"
              className="text-zinc-500 text-sm block mb-2"
            >
              HTTPS Proxy
            </label>
            <input
              type="text"
              placeholder="http://127.0.0.1:7890"
              value={httpsProxy}
              onChange={(e) => setHttpsProxy(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800/50 rounded-lg px-4 py-2 text-white focus:border-indigo-500 focus:outline-none text-sm"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleSaveProxy}
          disabled={!proxyDirty || proxySaved}
          className="flex items-center gap-2 self-start bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {proxySaved ? (
            <>
              <CheckCircle className="w-4 h-4" /> Saved
            </>
          ) : (
            'Save proxy settings'
          )}
        </button>
      </div>

      {showBatchImport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-white">
                Batch Import URLs
              </h3>
              <button
                type="button"
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
                type="button"
                onClick={() => setShowBatchImport(false)}
                className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
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
