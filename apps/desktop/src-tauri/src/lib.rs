// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
#[path = "services/plus/core.rs"]
mod plus_core_tests;

#[cfg(test)]
use plus_core_tests as core;
#[cfg(test)]
#[path = "services/plus/session.rs"]
mod plus_session_tests;

#[cfg(test)]
#[path = "services/file_transfer/security.rs"]
mod plus_transfer_security_tests;
