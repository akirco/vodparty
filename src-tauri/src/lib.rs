use pushers::{Channel, Config, Pusher};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::Mutex;
use tauri_plugin_store::StoreExt;
use url::Url;

/// Mirrors MAX_BODY_BYTES in src/shared/fetchJson.ts.
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

/// Mirrors DEFAULT_TIMEOUT_MS in src/shared/fetchJson.ts.
const PROXY_TIMEOUT_SECS: u64 = 10;

/// SSRF guard for `proxy_request`, mirroring src/shared/validateProxy.ts.
///
/// Without this the desktop app is an unrestricted relay: any page able to
/// reach the webview could ask it to fetch `http://169.254.169.254/...` or a
/// loopback admin port. The web deployments already had these checks; the
/// Tauri command did not.
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            o[0] == 0 // 0.0.0.0/8
                || o[0] == 10 // 10/8
                || o[0] == 127 // 127/8 loopback
                || (o[0] == 169 && o[1] == 254) // link-local + metadata
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && (o[1] == 168 || o[1] == 0))
                || (o[0] == 100 && (64..=127).contains(&o[1])) // CGNAT
                || o[0] >= 224 // multicast + reserved + broadcast
        }
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(mapped) => is_private_ip(IpAddr::V4(mapped)),
            None => {
                v6.is_loopback()
                    || v6.is_unspecified()
                    // fc00::/7 unique-local, fe80::/10 link-local
                    || (v6.segments()[0] & 0xfe00) == 0xfc00
                    || (v6.segments()[0] & 0xffc0) == 0xfe80
            }
        },
    }
}

fn validate_proxy_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|_| "Invalid URL format".to_string())?;

    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only HTTP/HTTPS URLs are allowed".to_string()),
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("URLs with credentials are not allowed".to_string());
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "Invalid URL format".to_string())?
        .to_ascii_lowercase();

    let blocked_suffixes = [".internal", ".local", ".localhost", ".localdomain"];
    if host == "localhost"
        || host == "0.0.0.0"
        || host == "metadata.google.internal"
        || host == "metadata.goog"
        || blocked_suffixes.iter().any(|s| host.ends_with(s))
    {
        return Err("Private/internal URLs are not allowed".to_string());
    }

    // A literal IP must not be private. `host_str` strips IPv6 brackets.
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_ip(ip) {
            return Err("Private/internal URLs are not allowed".to_string());
        }
        return Ok(parsed);
    }

    // Bare integer / hex / octal IPv4 literals (`2130706433`, `0x7f000001`,
    // `017700000001`) all resolve to loopback but are not valid `IpAddr`.
    let numeric = if host.starts_with("0x") || host.starts_with("0X") {
        u64::from_str_radix(&host[2..], 16).ok()
    } else if host.len() > 1
        && host.starts_with('0')
        && host.bytes().all(|b| (b'0'..=b'7').contains(&b))
    {
        u64::from_str_radix(&host[1..], 8).ok()
    } else if host.bytes().all(|b| b.is_ascii_digit()) {
        host.parse::<u64>().ok()
    } else {
        None
    };

    if let Some(n) = numeric {
        if n > u32::MAX as u64 || is_private_ip(IpAddr::V4(Ipv4Addr::from(n as u32))) {
            return Err("Private/internal URLs are not allowed".to_string());
        }
        return Ok(parsed);
    }

    // Unwrap IPv6-in-brackets that host_str left alone, plus zone ids.
    if let Some(v6) = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split('%')
        .next()
        .and_then(|s| s.parse::<Ipv6Addr>().ok())
    {
        if is_private_ip(IpAddr::V6(v6)) {
            return Err("Private/internal URLs are not allowed".to_string());
        }
    }

    Ok(parsed)
}

struct PusherState {
    pusher: Option<Pusher>,
    proxy_url: Option<String>,
    client: Option<reqwest::Client>,
}

static PUSHER_STATE: std::sync::OnceLock<Mutex<PusherState>> = std::sync::OnceLock::new();

fn get_pusher_state() -> &'static Mutex<PusherState> {
    PUSHER_STATE.get_or_init(|| {
        Mutex::new(PusherState {
            pusher: None,
            proxy_url: None,
            client: None,
        })
    })
}

fn build_client(proxy_url: &Option<String>) -> Result<reqwest::Client, String> {
    let mut builder =
        reqwest::Client::builder().timeout(std::time::Duration::from_secs(PROXY_TIMEOUT_SECS));
    if let Some(ref proxy) = *proxy_url {
        builder = builder.proxy(reqwest::Proxy::http(proxy).map_err(|e| e.to_string())?);
    }
    builder.build().map_err(|e| e.to_string())
}

fn get_store_string<R: tauri::Runtime>(store: &tauri_plugin_store::Store<R>, key: &str) -> String {
    store
        .get(key)
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default()
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PusherSettings {
    pub app_id: String,
    pub key: String,
    pub secret: String,
    pub cluster: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProxySettings {
    pub http_proxy: String,
    pub https_proxy: String,
}

#[tauri::command]
async fn save_pusher_settings(
    id: String,
    key: String,
    secret: String,
    cluster: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    println!(
        "[Rust] save_pusher_settings called: id={}, key={}, cluster={}",
        id, key, cluster
    );

    let store = app
        .store("synchive-store.json")
        .map_err(|e| e.to_string())?;

    store.set("pusher_id", serde_json::Value::String(id.clone()));
    store.set("pusher_key", serde_json::Value::String(key.clone()));
    store.set("pusher_secret", serde_json::Value::String(secret.clone()));
    store.set("pusher_cluster", serde_json::Value::String(cluster.clone()));
    store.save().map_err(|e| e.to_string())?;

    if !id.is_empty() && !key.is_empty() && !secret.is_empty() {
        let config = Config::builder()
            .app_id(&id)
            .key(&key)
            .secret(&secret)
            .cluster(&cluster)
            .build()
            .map_err(|e| e.to_string())?;

        let pusher = Pusher::new(config).map_err(|e| e.to_string())?;

        let mut state = get_pusher_state().lock().map_err(|e| e.to_string())?;
        state.pusher = Some(pusher);
    } else {
        let mut state = get_pusher_state().lock().map_err(|e| e.to_string())?;
        state.pusher = None;
    }

    Ok(())
}

#[tauri::command]
async fn get_pusher_settings(app: tauri::AppHandle) -> Result<PusherSettings, String> {
    let store = app
        .store("synchive-store.json")
        .map_err(|e| e.to_string())?;

    let id = get_store_string(&store, "pusher_id");
    let key = get_store_string(&store, "pusher_key");
    let secret = get_store_string(&store, "pusher_secret");
    let mut cluster = get_store_string(&store, "pusher_cluster");
    if cluster.is_empty() {
        cluster = "ap1".to_string();
    }

    Ok(PusherSettings {
        app_id: id,
        key,
        secret,
        cluster,
    })
}

#[tauri::command]
async fn save_proxy_settings(
    http_proxy: Option<String>,
    https_proxy: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let http = http_proxy.unwrap_or_default();
    let https = https_proxy.unwrap_or_default();

    let store = app
        .store("synchive-store.json")
        .map_err(|e| e.to_string())?;

    store.set("http_proxy", serde_json::Value::String(http.clone()));
    store.set("https_proxy", serde_json::Value::String(https.clone()));
    store.save().map_err(|e| e.to_string())?;

    let mut state = get_pusher_state().lock().map_err(|e| e.to_string())?;
    if !http.is_empty() {
        state.proxy_url = Some(http);
    } else if !https.is_empty() {
        state.proxy_url = Some(https);
    } else {
        state.proxy_url = None;
    }
    state.client = build_client(&state.proxy_url).ok();

    Ok(())
}

#[tauri::command]
async fn get_proxy_settings(app: tauri::AppHandle) -> Result<ProxySettings, String> {
    let store = app
        .store("synchive-store.json")
        .map_err(|e| e.to_string())?;

    let mut http_proxy = String::new();
    let mut https_proxy = String::new();

    if let Some(v) = store.get("http_proxy") {
        if let Some(s) = v.as_str() {
            http_proxy = s.to_string();
        }
    }
    if let Some(v) = store.get("https_proxy") {
        if let Some(s) = v.as_str() {
            https_proxy = s.to_string();
        }
    }

    Ok(ProxySettings {
        http_proxy,
        https_proxy,
    })
}

#[tauri::command]
async fn pusher_auth(socket_id: String, channel_name: String) -> Result<String, String> {
    let state = get_pusher_state().lock().map_err(|e| e.to_string())?;

    let pusher = state.pusher.as_ref().ok_or("Pusher not initialized")?;

    let channel = Channel::from_string(&channel_name).map_err(|e| e.to_string())?;

    let auth = pusher
        .authorize_channel(&socket_id, &channel, None)
        .map_err(|e| e.to_string())?;

    serde_json::to_string(&auth).map_err(|e| e.to_string())
}

#[tauri::command]
async fn proxy_request(url: String) -> Result<String, String> {
    let parsed = validate_proxy_url(&url)?;

    let client = {
        let state = get_pusher_state().lock().map_err(|e| e.to_string())?;
        match state.client {
            Some(ref c) => c.clone(),
            None => {
                let client = build_client(&state.proxy_url)?;
                drop(state);
                let mut state = get_pusher_state().lock().map_err(|e| e.to_string())?;
                state.client = Some(client.clone());
                client
            }
        }
    };

    let res = client
        .get(parsed)
        .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36")
        .header("Accept", "application/json, text/plain, */*")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status();
    if !status.is_success() {
        return Err(format!("Upstream returned status {}", status.as_u16()));
    }

    // Cap the body instead of buffering an unbounded response into memory.
    if let Some(len) = res.content_length() {
        if len > MAX_BODY_BYTES as u64 {
            return Err("Response too large".to_string());
        }
    }

    let body = res.text().await.map_err(|e| e.to_string())?;
    if body.len() > MAX_BODY_BYTES {
        return Err("Response too large".to_string());
    }

    // Some Apple CMS backends serve JSON with a text/html content-type, so
    // decide by parsing rather than by trusting the header. Returning only
    // the serialized JSON also strips any HTML that slipped through.
    match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(value) => Ok(value.to_string()),
        Err(_) => Err("Only JSON responses are allowed".to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                // Devtools auto-opens in debug builds via the Cargo feature
            }

            if let Ok(store) = app.store("synchive-store.json") {
                let id = get_store_string(&store, "pusher_id");
                let key = get_store_string(&store, "pusher_key");
                let secret = get_store_string(&store, "pusher_secret");
                let mut cluster = get_store_string(&store, "pusher_cluster");
                if cluster.is_empty() {
                    cluster = "ap1".to_string();
                }

                // The proxy config is independent of Pusher: users who never
                // set up a watch party still need it to reach the CMS APIs.
                let http_proxy = get_store_string(&store, "http_proxy");
                let https_proxy = get_store_string(&store, "https_proxy");

                let proxy_url = if !http_proxy.is_empty() {
                    Some(http_proxy)
                } else if !https_proxy.is_empty() {
                    Some(https_proxy)
                } else {
                    None
                };

                if !id.is_empty() && !key.is_empty() && !secret.is_empty() {
                    let config = Config::builder()
                        .app_id(&id)
                        .key(&key)
                        .secret(&secret)
                        .cluster(cluster)
                        .timeout(std::time::Duration::from_secs(10))
                        .build();

                    if let Ok(config) = config {
                        if let Ok(pusher) = Pusher::new(config) {
                            let mut state = get_pusher_state().lock().unwrap();
                            state.pusher = Some(pusher);
                        }
                    }
                }

                let mut state = get_pusher_state().lock().unwrap();
                state.proxy_url = proxy_url;
                state.client = build_client(&state.proxy_url).ok();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            proxy_request,
            save_pusher_settings,
            get_pusher_settings,
            save_proxy_settings,
            get_proxy_settings,
            pusher_auth
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
