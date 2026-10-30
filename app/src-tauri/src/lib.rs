mod assistant;

use assistant::Store;
use serde_json::{Map, Value};
use std::net::Ipv4Addr;
use tauri::{Manager, State};

// The WebView gets a JavaScript bridge (clipboard, files, intents), so it may only show AgentView itself.
fn trusted(url: &tauri::Url) -> bool {
    match url.host_str() {
        Some(h) => {
            h == "tauri.localhost"
                || h == "localhost"
                || h == "127.0.0.1"
                || h.ends_with(".netbird.cloud")
                || h.parse::<Ipv4Addr>().is_ok_and(|ip| ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]))
        }
        None => matches!(url.scheme(), "tauri" | "about"),
    }
}

// Links the WebView cannot show itself (mail, VS Code) go to the app macOS registers for them.
#[cfg(desktop)]
fn open_external(url: &tauri::Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto" | "vscode") {
        let _ = std::process::Command::new("open").arg(url.as_str()).spawn();
    }
}

fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn assistant_open(app: tauri::AppHandle, store: State<Store>, key: String) -> Result<(), String> {
    store.open(&data_dir(&app)?.join("assistant.db"), &key)
}

#[tauri::command]
fn assistant_close(store: State<Store>) {
    store.close();
}

#[tauri::command]
fn assistant_dev_key(app: tauri::AppHandle) -> Result<String, String> {
    if cfg!(target_os = "android") {
        return Err("not available".into());
    }
    assistant::dev_key(&data_dir(&app)?)
}

#[tauri::command]
fn assistant_batch(store: State<Store>, sql: String) -> Result<(), String> {
    store.batch(&sql)
}

#[tauri::command]
fn assistant_exec(store: State<Store>, sql: String, params: Vec<Value>) -> Result<usize, String> {
    store.exec(&sql, &params)
}

#[tauri::command]
fn assistant_query(store: State<Store>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    store.query(&sql, &params)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Store::new())
        .invoke_handler(tauri::generate_handler![assistant_open, assistant_close, assistant_dev_key, assistant_batch, assistant_exec, assistant_query])
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("agentview-nav").on_navigation(|_, url| {
            if trusted(url) {
                return true;
            }
            #[cfg(desktop)]
            if url.scheme() != "http" && url.scheme() != "https" {
                open_external(url);
            }
            false
        }).build())
        .setup(|app| {
            let builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?;
            // Links that open a new window (window.open, target="_blank") go to the default browser.
            #[cfg(desktop)]
            let builder = builder.on_new_window(|url, _| {
                open_external(&url);
                tauri::webview::NewWindowResponse::Deny
            });
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AgentView");
}
