use pushers::{Channel, Config, Pusher};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri_plugin_store::StoreExt;

struct PusherState {
    pusher: Option<Pusher>,
    proxy_url: Option<String>,
}

static PUSHER_STATE: std::sync::OnceLock<Mutex<PusherState>> = std::sync::OnceLock::new();

fn get_pusher_state() -> &'static Mutex<PusherState> {
    PUSHER_STATE.get_or_init(|| {
        Mutex::new(PusherState {
            pusher: None,
            proxy_url: None,
        })
    })
}

fn get_pusher_state_mut() -> &'static Mutex<PusherState> {
    PUSHER_STATE.get_or_init(|| {
        Mutex::new(PusherState {
            pusher: None,
            proxy_url: None,
        })
    })
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
    println!("[Rust] save_pusher_settings called: id={}, key={}, cluster={}", id, key, cluster);
    
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

        let mut state = get_pusher_state_mut().lock().map_err(|e| e.to_string())?;
        state.pusher = Some(pusher);
    } else {
        let mut state = get_pusher_state_mut().lock().map_err(|e| e.to_string())?;
        state.pusher = None;
    }

    Ok(())
}

#[tauri::command]
async fn get_pusher_settings(app: tauri::AppHandle) -> Result<PusherSettings, String> {
    let store = app
        .store("synchive-store.json")
        .map_err(|e| e.to_string())?;

    let mut id = String::new();
    let mut key = String::new();
    let mut secret = String::new();
    let mut cluster = String::new();

    if let Some(v) = store.get("pusher_id") {
        if let Some(s) = v.as_str() {
            id = s.to_string();
        }
    }
    if let Some(v) = store.get("pusher_key") {
        if let Some(s) = v.as_str() {
            key = s.to_string();
        }
    }
    if let Some(v) = store.get("pusher_secret") {
        if let Some(s) = v.as_str() {
            secret = s.to_string();
        }
    }
    if let Some(v) = store.get("pusher_cluster") {
        if let Some(s) = v.as_str() {
            cluster = s.to_string();
        }
    }

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

    let mut state = get_pusher_state_mut().lock().map_err(|e| e.to_string())?;
    if !http.is_empty() {
        state.proxy_url = Some(http);
    } else if !https.is_empty() {
        state.proxy_url = Some(https);
    } else {
        state.proxy_url = None;
    }

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
    let proxy_url = {
        let state = get_pusher_state().lock().map_err(|e| e.to_string())?;
        state.proxy_url.clone()
    };

    let mut builder = reqwest::Client::builder();

    if let Some(proxy) = proxy_url {
        builder = builder.proxy(reqwest::Proxy::http(&proxy).map_err(|e| e.to_string())?);
    }

    let client = builder.build().map_err(|e| e.to_string())?;

    let res = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(body)
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
                let mut id = String::new();
                let mut key = String::new();
                let mut secret = String::new();
                let mut cluster = "ap1".to_string();

                if let Some(v) = store.get("pusher_id") {
                    if let Some(s) = v.as_str() {
                        id = s.to_string();
                    }
                }
                if let Some(v) = store.get("pusher_key") {
                    if let Some(s) = v.as_str() {
                        key = s.to_string();
                    }
                }
                if let Some(v) = store.get("pusher_secret") {
                    if let Some(s) = v.as_str() {
                        secret = s.to_string();
                    }
                }
                if let Some(v) = store.get("pusher_cluster") {
                    if let Some(s) = v.as_str() {
                        cluster = s.to_string();
                    }
                }

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
                            let mut state = get_pusher_state_mut().lock().unwrap();
                            state.pusher = Some(pusher);
                            if !http_proxy.is_empty() {
                                state.proxy_url = Some(http_proxy);
                            } else if !https_proxy.is_empty() {
                                state.proxy_url = Some(https_proxy);
                            }
                        }
                    }
                }
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
