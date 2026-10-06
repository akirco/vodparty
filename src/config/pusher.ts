import { invoke } from '@tauri-apps/api/core';
import Pusher from 'pusher-js';
import { isTauri } from '../utils';

/**
 * Build-time configuration.
 *
 * These come from `vite.config.ts`, which reads them off `process.env` and
 * injects them through `define`. Reading `import.meta.env.PUSHER_KEY` instead
 * (as this module used to) always yielded `undefined`: Vite only exposes
 * `VITE_`-prefixed variables, and `define` had only declared `PUSHER_KEY` /
 * `PUSHER_CLUSTER` -- so `PUSHER_APP_ID` and `PUSHER_AUTH_ENDPOINT` were
 * silently undefined on every build.
 */
const ENV = {
  appId: __PUSHER_APP_ID__,
  key: __PUSHER_KEY__,
  cluster: __PUSHER_CLUSTER__,
  authEndpoint: __PUSHER_AUTH_ENDPOINT__,
};

const DEFAULT_AUTH_ENDPOINT = '/.netlify/functions/pusher-auth';
const DEFAULT_CLUSTER = 'ap1';

export interface PusherSettings {
  app_id: string;
  key: string;
  /** Server-side only; never populated in a browser context. */
  secret: string;
  cluster: string;
}

const emptySettings = (): PusherSettings => ({
  app_id: '',
  key: '',
  secret: '',
  cluster: DEFAULT_CLUSTER,
});

let cachedPusher: Pusher | null = null;
let cachedSettings: PusherSettings | null = null;

/**
 * Resolve the effective settings.
 *
 * Tauri reads the persisted store (written by Settings); the web build falls
 * back to build-time env, since there is no way to persist a secret safely in
 * a browser.
 */
const resolveSettings = async (): Promise<PusherSettings> => {
  if (isTauri()) {
    try {
      const stored = await invoke<PusherSettings>('get_pusher_settings');
      return {
        app_id: stored.app_id || '',
        key: stored.key || '',
        secret: stored.secret || '',
        cluster: stored.cluster || DEFAULT_CLUSTER,
      };
    } catch (err) {
      console.error('[pusher] get_pusher_settings failed:', err);
      return { ...emptySettings(), key: ENV.key, app_id: ENV.appId };
    }
  }
  return {
    app_id: ENV.appId,
    key: ENV.key,
    // The secret must never reach the browser.
    secret: '',
    cluster: ENV.cluster || DEFAULT_CLUSTER,
  };
};

export const getPusherSettings = async (): Promise<PusherSettings> => {
  if (cachedSettings) return cachedSettings;
  cachedSettings = await resolveSettings();
  return cachedSettings;
};

export const isPusherEnabled = async (): Promise<boolean> => {
  const { key, cluster } = await getPusherSettings();
  return Boolean(key && cluster);
};

export const initPusherClient = async (): Promise<Pusher | null> => {
  if (cachedPusher) return cachedPusher;

  const config = await getPusherSettings();
  if (!config.key || !config.cluster) return null;

  if (isTauri()) {
    // The desktop app authorizes over IPC so the secret stays in Rust.
    cachedPusher = new Pusher(config.key, {
      cluster: config.cluster,
      // pusher-js declares `authorizer` as a class, but an object literal with
      // an `authorize(socketId, cb)` method is the shape it actually accepts.
      // `PusherOptions` is not exported from the package root, so the cast
      // target is unavailable.
      authorizer: ((channel: { name: string }) => ({
        authorize: (
          socketId: string,
          callback: (err: unknown, auth: unknown) => void,
        ) => {
          invoke<string>('pusher_auth', {
            socketId,
            channelName: channel.name,
          })
            .then((response) => callback(null, JSON.parse(response)))
            .catch((err) => callback(err, null));
        },
      })) as any,
    });
  } else {
    cachedPusher = new Pusher(config.key, {
      cluster: config.cluster,
      authEndpoint: ENV.authEndpoint || DEFAULT_AUTH_ENDPOINT,
    });
  }

  return cachedPusher;
};

/**
 * Persist settings.
 *
 * Callers must debounce: this hits the Tauri store on disk and rebuilds the
 * Pusher client, so binding it to an input's `onChange` meant one disk write
 * and one client re-instantiation per keystroke.
 */
export const savePusherSettings = async (
  appId: string,
  key: string,
  secret: string,
  cluster: string,
): Promise<void> => {
  cachedSettings = {
    app_id: appId,
    key,
    secret,
    cluster: cluster || DEFAULT_CLUSTER,
  };
  cachedPusher = null;

  if (!isTauri()) return;
  try {
    await invoke('save_pusher_settings', {
      id: appId,
      key,
      secret,
      cluster: cluster || DEFAULT_CLUSTER,
    });
  } catch (e) {
    console.error('[pusher] save_pusher_settings error:', e);
    throw e;
  }
};

/** Test seam: drops the memoised client and settings. */
export const resetPusherCache = (): void => {
  cachedPusher = null;
  cachedSettings = null;
};

export interface ProxySettings {
  http_proxy: string;
  https_proxy: string;
}

const EMPTY_PROXY: ProxySettings = { http_proxy: '', https_proxy: '' };

export const getProxySettings = async (): Promise<ProxySettings> => {
  if (!isTauri()) return EMPTY_PROXY;
  try {
    return await invoke<ProxySettings>('get_proxy_settings');
  } catch (e) {
    console.error('[pusher] get_proxy_settings error:', e);
    return EMPTY_PROXY;
  }
};

export const saveProxySettings = async (
  httpProxy: string,
  httpsProxy: string,
): Promise<void> => {
  if (!isTauri()) return;
  await invoke('save_proxy_settings', {
    http_proxy: httpProxy,
    https_proxy: httpsProxy,
  });
};
