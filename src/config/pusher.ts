import Pusher from "pusher-js";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../utils";

const PUSHER_APP_ID = import.meta.env.PUSHER_APP_ID || "";
const PUSHER_KEY = import.meta.env.PUSHER_KEY || "";
const PUSHER_SECRET = import.meta.env.PUSHER_SECRET || "";
const PUSHER_CLUSTER = import.meta.env.PUSHER_CLUSTER || "ap1";
const PUSHER_AUTH_ENDPOINT = import.meta.env.PUSHER_AUTH_ENDPOINT || "/.netlify/functions/pusher-auth";

interface PusherSettings {
  app_id: string;
  key: string;
  secret: string;
  cluster: string;
}

let cachedPusher: Pusher | null = null;

const getStoredPusherConfig = async (): Promise<PusherSettings> => {
  if (isTauri()) {
    try {
      const result = await invoke<any>("get_pusher_settings");
      return {
        app_id: result.app_id || "",
        key: result.key || "",
        secret: result.secret || "",
        cluster: result.cluster || "ap1",
      };
    } catch {
      return {
        app_id: PUSHER_APP_ID,
        key: PUSHER_KEY,
        secret: PUSHER_SECRET,
        cluster: PUSHER_CLUSTER,
      };
    }
  }
  return {
    app_id: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
  };
};

export const initPusherClient = async (): Promise<Pusher | null> => {
  if (cachedPusher) return cachedPusher;

  const config = await getStoredPusherConfig();
  
  console.log("[Pusher] Key:", config.key ? "set" : "missing", "Cluster:", config.cluster);

  if (config.key && config.cluster) {
    if (isTauri()) {
      cachedPusher = new Pusher(config.key, {
        cluster: config.cluster,
        authorizer: ((channel: any, _options: any) => {
          return {
            authorize: (socketId: string, callback: any) => {
              invoke<string>("pusher_auth", { socketId, channelName: channel.name })
                .then((response) => callback(null, JSON.parse(response)))
                .catch((err) => callback(err, null));
            }
          };
        }) as any
      });
    } else {
      cachedPusher = new Pusher(config.key, {
        cluster: config.cluster,
        authEndpoint: PUSHER_AUTH_ENDPOINT,
      });
    }
    return cachedPusher;
  }
  return null;
};

export const getPusherSettings = async (): Promise<PusherSettings> => {
  return getStoredPusherConfig();
};

export const savePusherSettings = async (
  appId: string,
  key: string,
  secret: string,
  cluster: string,
) => {
  if (isTauri()) {
    try {
      await invoke("save_pusher_settings", { 
        id: appId, 
        key, 
        secret, 
        cluster 
      });
    } catch (e) {
      console.error("[pusher.ts] save_pusher_settings error:", e);
      throw e;
    }
  }
  cachedPusher = null;
};

export interface ProxySettings {
  http_proxy: string;
  https_proxy: string;
}

export const getProxySettings = async (): Promise<ProxySettings> => {
  if (isTauri()) {
    try {
      return await invoke<ProxySettings>("get_proxy_settings");
    } catch (e) {
      console.error("get_proxy_settings error:", e);
      return { http_proxy: "", https_proxy: "" };
    }
  }
  return { http_proxy: "", https_proxy: "" };
};

export const saveProxySettings = async (httpProxy: string, httpsProxy: string) => {
  if (isTauri()) {
    await invoke("save_proxy_settings", { http_proxy: httpProxy, https_proxy: httpsProxy });
  }
};

export const isPusherEnabled = async () => {
  const config = await getStoredPusherConfig();
  const enabled = !!config.key;
  console.log("[Pusher] Enabled:", enabled);
  return enabled;
};

export const pusherClient: Pusher | null = null;