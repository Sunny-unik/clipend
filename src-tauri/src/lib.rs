use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

#[derive(Clone, serde::Serialize)]
struct FilePayload {
    path: String,
    name: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum ClipboardPayload {
    Text { text: String },
    Image { path: String, width: u32, height: u32 },
    Files { files: Vec<FilePayload> },
}

#[tauri::command]
fn write_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(&text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn write_files_to_clipboard(paths: Vec<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        use clipboard_win::{options, raw, Clipboard};
        let _guard = Clipboard::new_attempts(10).map_err(|e| format!("open clipboard: {:?}", e))?;
        raw::set_file_list_with(&paths, options::DoClear)
            .map_err(|e| format!("set files: {:?}", e))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clipboard.set_text(paths.join("\n")).map_err(|e| e.to_string())?;
        Ok(())
    }
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

fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

fn images_dir(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let data_dir = app_handle.path().app_data_dir().ok()?;
    let dir = data_dir.join("images");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

#[cfg(windows)]
fn read_clipboard_files() -> Option<Vec<String>> {
    use clipboard_win::{formats, get_clipboard, Clipboard};
    let _guard = Clipboard::new_attempts(5).ok()?;
    let files: Vec<String> = get_clipboard(formats::FileList).ok()?;
    if files.is_empty() {
        None
    } else {
        Some(files)
    }
}

#[cfg(not(windows))]
fn read_clipboard_files() -> Option<Vec<String>> {
    None
}

enum LastKind {
    None,
    Text(String),
    Image(u64),
    Files(Vec<String>),
}

fn start_clipboard_monitor(app_handle: tauri::AppHandle) {
    let last = Arc::new(Mutex::new(LastKind::None));

    thread::spawn(move || {
        let mut clipboard = match arboard::Clipboard::new() {
            Ok(cb) => cb,
            Err(e) => {
                eprintln!("Failed to initialize clipboard: {}", e);
                return;
            }
        };

        loop {
            // Priority 1: file list (Windows Explorer copy/cut)
            if let Some(files) = read_clipboard_files() {
                let changed = {
                    let guard = last.lock().unwrap();
                    match &*guard {
                        LastKind::Files(prev) => prev != &files,
                        _ => true,
                    }
                };
                if changed {
                    {
                        let mut guard = last.lock().unwrap();
                        *guard = LastKind::Files(files.clone());
                    }
                    let payload_files: Vec<FilePayload> = files
                        .into_iter()
                        .map(|p| {
                            let name = std::path::Path::new(&p)
                                .file_name()
                                .map(|n| n.to_string_lossy().into_owned())
                                .unwrap_or_else(|| p.clone());
                            FilePayload { path: p, name }
                        })
                        .collect();
                    let _ = app_handle
                        .emit("clipboard-changed", ClipboardPayload::Files { files: payload_files });
                }
                thread::sleep(Duration::from_millis(500));
                continue;
            }

            // Priority 2: raw image (screenshots, Paint, etc.)
            if let Ok(img) = clipboard.get_image() {
                let h = hash_bytes(&img.bytes);
                let changed = {
                    let guard = last.lock().unwrap();
                    match &*guard {
                        LastKind::Image(prev) => *prev != h,
                        _ => true,
                    }
                };
                if changed {
                    if let Some(dir) = images_dir(&app_handle) {
                        let stamp = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis();
                        let filename = format!("img_{}_{:x}.png", stamp, h);
                        let filepath = dir.join(&filename);
                        if let Some(rgba) = image::RgbaImage::from_raw(
                            img.width as u32,
                            img.height as u32,
                            img.bytes.to_vec(),
                        ) {
                            if rgba.save_with_format(&filepath, image::ImageFormat::Png).is_ok() {
                                {
                                    let mut guard = last.lock().unwrap();
                                    *guard = LastKind::Image(h);
                                }
                                let _ = app_handle.emit(
                                    "clipboard-changed",
                                    ClipboardPayload::Image {
                                        path: filepath.to_string_lossy().into_owned(),
                                        width: img.width as u32,
                                        height: img.height as u32,
                                    },
                                );
                            }
                        }
                    }
                }
                thread::sleep(Duration::from_millis(500));
                continue;
            }

            // Priority 3: text
            if let Ok(current_text) = clipboard.get_text() {
                if !current_text.is_empty() {
                    let changed = {
                        let guard = last.lock().unwrap();
                        match &*guard {
                            LastKind::Text(prev) => prev != &current_text,
                            _ => true,
                        }
                    };
                    if changed {
                        {
                            let mut guard = last.lock().unwrap();
                            *guard = LastKind::Text(current_text.clone());
                        }
                        let _ = app_handle.emit(
                            "clipboard-changed",
                            ClipboardPayload::Text { text: current_text },
                        );
                    }
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
        .invoke_handler(tauri::generate_handler![
            write_to_clipboard,
            write_files_to_clipboard,
            toggle_window
        ])
        .setup(|app| {
            start_clipboard_monitor(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
