use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};

#[derive(Clone, serde::Serialize)]
struct ClipboardPayload {
    text: String,
}

#[tauri::command]
fn write_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(&text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn toggle_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn start_clipboard_monitor(app_handle: tauri::AppHandle) {
    let last_text = Arc::new(Mutex::new(String::new()));

    thread::spawn(move || {
        let mut clipboard = match arboard::Clipboard::new() {
            Ok(cb) => cb,
            Err(e) => {
                eprintln!("Failed to initialize clipboard monitor: {}", e);
                return;
            }
        };

        loop {
            if let Ok(current_text) = clipboard.get_text() {
                let mut last = last_text.lock().unwrap();
                if !current_text.is_empty() && *last != current_text {
                    *last = current_text.clone();
                    let _ = app_handle.emit("clipboard-changed", ClipboardPayload { text: current_text });
                }
            }
            thread::sleep(Duration::from_millis(500));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![write_to_clipboard, toggle_window])
        .setup(|app| {
            start_clipboard_monitor(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
