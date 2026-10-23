use std::net::Ipv4Addr;

// The WebView gets a JavaScript bridge (clipboard, files, intents), so it may only show AgentView itself.
fn trusted(url: &tauri::Url) -> bool {
    match url.host_str() {
        Some(h) => {
            h == "tauri.localhost"
                || h == "localhost"
                || h == "127.0.0.1"
                || h.ends_with(".netbird.cloud")
                || h.parse::<Ipv4Addr>().map_or(false, |ip| ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]))
        }
        None => url.scheme() == "tauri" || url.scheme() == "about",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("agentview-nav").on_navigation(|_, url| trusted(url)).build())
        .run(tauri::generate_context!())
        .expect("error while running AgentView");
}
