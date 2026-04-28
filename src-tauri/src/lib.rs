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
    Text {
        text: String,
        html: Option<String>,
    },
    Image {
        path: String,
        width: u32,
        height: u32,
    },
    Files {
        files: Vec<FilePayload>,
    },
}

#[tauri::command]
fn write_to_clipboard(text: String, html: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        use clipboard_win::{formats, raw, set_clipboard, Clipboard};
        let _guard = Clipboard::new_attempts(10)
            .map_err(|e| format!("open clipboard: {:?}", e))?;
        raw::empty().map_err(|e| format!("empty clipboard: {:?}", e))?;
        set_clipboard(formats::Unicode, text.as_str())
            .map_err(|e| format!("set text: {:?}", e))?;
        if let Some(html_content) = html.as_deref() {
            if !html_content.is_empty() {
                let html_fmt = formats::Html::new().ok_or("register html format")?;
                set_clipboard(html_fmt, html_content)
                    .map_err(|e| format!("set html: {:?}", e))?;
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = html;
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        clipboard.set_text(&text).map_err(|e| e.to_string())?;
        Ok(())
    }
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
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Read raw bytes of any local clip file (image, document, archive,
/// whatever) so the JS sync layer can upload it to Supabase Storage.
/// Done in Rust rather than via plugin-fs so it works regardless of
/// frontend FS-permission scoping.
#[tauri::command]
fn read_clip_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("read {}: {}", path, e))
}

/// Write a downloaded clip file into the per-user clip cache dir and
/// return its absolute path so the row's file_path can be updated.
/// The original file name (from the clip row) is preserved so the
/// receiving app sees the right extension when this clip is pasted
/// as a file.
#[tauri::command]
fn save_clip_file_bytes(
    app: tauri::AppHandle,
    clip_id: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let dir = images_dir(&app).ok_or_else(|| "cache dir unavailable".to_string())?;
    // Sanitize: nanoid uses URL-safe alphabet, but refuse path
    // separators / parent traversal just in case clip_id ever changes
    // shape, and strip the same from the user-supplied file_name.
    if clip_id.contains('/') || clip_id.contains('\\') || clip_id.contains("..") {
        return Err("invalid clip id".into());
    }
    let safe_name = sanitize_file_name(&file_name);
    let path = dir.join(format!("synced_{}_{}", clip_id, safe_name));
    fs::write(&path, &bytes).map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(path.to_string_lossy().into_owned())
}

fn sanitize_file_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return "blob".to_string();
    }
    // Keep only the basename: strip any path-separator segments the
    // caller may have included by accident.
    let base = std::path::Path::new(trimmed)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("blob");
    base.chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect()
}

#[tauri::command]
fn clip_file_exists(path: String) -> bool {
    !path.is_empty() && std::path::Path::new(&path).exists()
}

/// One-shot loopback HTTP server for the Google Drive OAuth callback.
/// Google's "Desktop application" OAuth clients require a loopback
/// redirect (custom URI schemes are no longer accepted for new desktop
/// clients), so we open a TcpListener on a random port, wait for the
/// browser to hit it after the user consents, parse the code from the
/// query string, emit it to the JS side as `drive-oauth-callback`, and
/// shut down. The whole listener lives for one request — typically a
/// few seconds.
///
/// Returns the port the listener bound to so JS can build the
/// redirect_uri before opening the auth URL.
#[tauri::command]
fn start_drive_oauth_listener(app: tauri::AppHandle) -> Result<u16, String> {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("bind oauth listener: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {}", e))?
        .port();

    std::thread::spawn(move || {
        // Single accept; the OAuth flow only needs one redirect.
        let (mut stream, _) = match listener.accept() {
            Ok(p) => p,
            Err(e) => {
                let _ = app.emit(
                    "drive-oauth-callback",
                    format!("error://accept-failed?msg={}", e),
                );
                return;
            }
        };

        // Read just the request line: `GET /?code=... HTTP/1.1`.
        let mut reader = BufReader::new(&stream);
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).is_err() {
            return;
        }
        // Path is the middle whitespace-separated token. Build the
        // full URL relative to the loopback host so JS can use the
        // standard URL parser on it.
        let path = request_line
            .split_whitespace()
            .nth(1)
            .unwrap_or("/")
            .to_string();
        let full_url = format!("http://127.0.0.1:{}{}", port, path);

        // Reply with a friendly close-this-tab page before notifying
        // JS, so the user's browser confirms success before our window
        // takes focus.
        let body =
            "<!doctype html><meta charset=utf-8><title>Clipend</title>\
             <style>body{font-family:system-ui;background:#1e1e1e;color:#eee;\
             display:flex;align-items:center;justify-content:center;\
             height:100vh;margin:0}div{text-align:center}</style>\
             <div><h2>Drive connected ✓</h2>\
             <p>You can close this tab and return to Clipend.</p></div>";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();

        let _ = app.emit("drive-oauth-callback", full_url);
    });

    Ok(port)
}

/// One-shot: copy the production clip DB over to the dev DB filename if the
/// dev DB doesn't exist yet. Lets developers start with realistic data.
#[tauri::command]
fn seed_dev_db(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let prod = data_dir.join("clipend.db");
    let dev = data_dir.join("clipend-dev.db");
    if dev.exists() {
        return Ok(());
    }
    if !prod.exists() {
        return Ok(());
    }
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    fs::copy(&prod, &dev).map_err(|e| format!("copy: {}", e))?;
    Ok(())
}

fn drag_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("drag");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn prepare_text_drop_file(app: tauri::AppHandle, text: String) -> Result<String, String> {
    let dir = drag_cache_dir(&app)?;
    // Auto-increment: find the next free clip_N.txt
    let mut i: u64 = 1;
    loop {
        let path = dir.join(format!("clip_{}.txt", i));
        if !path.exists() {
            fs::write(&path, &text).map_err(|e| e.to_string())?;
            return Ok(path.to_string_lossy().into_owned());
        }
        i += 1;
    }
}

#[cfg(windows)]
#[tauri::command]
fn hide_when_cursor_leaves(
    app: tauri::AppHandle,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
) -> Result<(), String> {
    use windows::Win32::Foundation::{HWND, POINT};
    use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, ShowWindow, SW_HIDE};

    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let main_hwnd = main_window.hwnd().map_err(|e| e.to_string())?;
    let main_addr = main_hwnd.0 as usize;

    // Also grab the tooltip window's HWND if it exists — we hide it too so
    // it doesn't linger on top after main disappears.
    let tooltip_addr = app
        .get_webview_window("tooltip")
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as usize);

    std::thread::spawn(move || {
        let start = std::time::Instant::now();
        let main_hwnd = HWND(main_addr as *mut core::ffi::c_void);
        loop {
            if start.elapsed() > std::time::Duration::from_secs(30) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));

            let mut pt = POINT { x: 0, y: 0 };
            let ok = unsafe { GetCursorPos(&mut pt) }.is_ok();
            if !ok {
                continue;
            }

            if pt.x < left || pt.x > right || pt.y < top || pt.y > bottom {
                // Restore the previously-focused window FIRST so it becomes
                // foreground while the native drag is still in progress.
                // VS Code / browser / editor will internally re-focus the
                // element that had focus (e.g. the Claude Code input), so
                // the drop lands in the right place.
                restore_previous_foreground();
                unsafe {
                    let _ = ShowWindow(main_hwnd, SW_HIDE);
                    if let Some(addr) = tooltip_addr {
                        let tt = HWND(addr as *mut core::ffi::c_void);
                        let _ = ShowWindow(tt, SW_HIDE);
                    }
                }
                return;
            }
        }
    });

    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
fn hide_when_cursor_leaves(
    _app: tauri::AppHandle,
    _left: i32,
    _top: i32,
    _right: i32,
    _bottom: i32,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn drag_icon_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = drag_cache_dir(&app)?;
    let icon_path = dir.join("drag_icon.png");
    if !icon_path.exists() {
        let img: image::RgbaImage = image::ImageBuffer::from_pixel(
            16,
            16,
            image::Rgba([80, 80, 80, 160]),
        );
        img.save_with_format(&icon_path, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
    }
    Ok(icon_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn paste_to_active_window(app: tauri::AppHandle) -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    if let Some(tt) = app.get_webview_window("tooltip") {
        let _ = tt.hide();
    }

    // Let the OS restore focus to the previously-focused window.
    thread::sleep(Duration::from_millis(120));

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| e.to_string())?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| e.to_string())?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(windows)]
fn previous_foreground() -> &'static std::sync::Mutex<Option<usize>> {
    static INSTANCE: std::sync::OnceLock<std::sync::Mutex<Option<usize>>> =
        std::sync::OnceLock::new();
    INSTANCE.get_or_init(|| std::sync::Mutex::new(None))
}

#[cfg(windows)]
fn save_previous_foreground() {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let hwnd = unsafe { GetForegroundWindow() };
    if !hwnd.0.is_null() {
        if let Ok(mut g) = previous_foreground().lock() {
            *g = Some(hwnd.0 as usize);
        }
    }
}

#[cfg(windows)]
fn restore_previous_foreground() {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, SetActiveWindow, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MENU,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetWindowThreadProcessId, SetForegroundWindow,
    };

    let addr = previous_foreground()
        .lock()
        .ok()
        .and_then(|g| *g);
    let Some(addr) = addr else { return };
    if addr == 0 {
        return;
    }
    let target = HWND(addr as *mut core::ffi::c_void);

    unsafe {
        // Simulate an Alt press/release — Windows requires the calling thread
        // to "own" a foreground-capable input event before it will let us
        // transfer foreground to another process. This is a well-known trick
        // for SetForegroundWindow.
        keybd_event(VK_MENU.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
        keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);

        // Attach our thread input to the target's thread so SetForegroundWindow
        // isn't rejected by rules about foreground switching.
        let target_tid = GetWindowThreadProcessId(target, None);
        let our_tid = GetCurrentThreadId();
        let attached = target_tid != 0
            && target_tid != our_tid
            && AttachThreadInput(our_tid, target_tid, true).as_bool();

        let _ = BringWindowToTop(target);
        let _ = SetForegroundWindow(target);
        let _ = SetActiveWindow(target);

        if attached {
            let _ = AttachThreadInput(our_tid, target_tid, false);
        }
    }
}

#[cfg(not(windows))]
fn save_previous_foreground() {}
#[cfg(not(windows))]
fn restore_previous_foreground() {}

#[tauri::command]
fn toggle_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && focused {
            restore_previous_foreground();
            window.hide().map_err(|e| e.to_string())?;
        } else {
            // About to steal foreground — remember what we're taking it from so
            // we can restore it when we hide.
            save_previous_foreground();
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

#[cfg(windows)]
fn read_clipboard_html() -> Option<String> {
    use clipboard_win::{formats, get_clipboard, Clipboard};
    let _guard = Clipboard::new_attempts(5).ok()?;
    let html_fmt = formats::Html::new()?;
    let html: String = get_clipboard(html_fmt).ok()?;
    if html.is_empty() {
        None
    } else {
        Some(html)
    }
}

#[cfg(not(windows))]
fn read_clipboard_html() -> Option<String> {
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

            // Priority 3: text (with optional HTML)
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
                        let html = read_clipboard_html();
                        let _ = app_handle.emit(
                            "clipboard-changed",
                            ClipboardPayload::Text {
                                text: current_text,
                                html,
                            },
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
        // single-instance MUST be registered first so a second invocation of
        // Clipend (e.g. via a clipend:// URL) forwards to the already-running
        // process instead of spawning a new one.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Windows delivers deep-link URLs as CLI args to a freshly-spawned
            // process. single-instance short-circuits that launch back to us,
            // so we have to pull the URL out of `args` ourselves and emit the
            // same "deep-link" event the frontend already listens for.
            let urls: Vec<String> = args
                .iter()
                .filter(|a| a.starts_with("clipend://"))
                .cloned()
                .collect();
            if !urls.is_empty() {
                let _ = app.emit("deep-link", &urls);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .invoke_handler(tauri::generate_handler![
            write_to_clipboard,
            write_files_to_clipboard,
            toggle_window,
            exit_app,
            paste_to_active_window,
            prepare_text_drop_file,
            drag_icon_path,
            hide_when_cursor_leaves,
            seed_dev_db,
            read_clip_file_bytes,
            save_clip_file_bytes,
            clip_file_exists,
            start_drive_oauth_listener
        ])
        .setup(|app| {
            // If we were launched on system startup via autostart, keep the
            // main window hidden — the user expects Clipend to sit silently
            // in the background until Alt+V.
            if std::env::args().any(|a| a == "--autostart") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }

            // Deep-link: register the clipend:// scheme on the dev machine
            // (production registration is handled by the installer), and
            // forward any incoming URL to the main window for the auth code
            // to pick up.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(target_os = "windows", target_os = "linux"))]
                let _ = app.deep_link().register_all();

                let app_handle_for_dl = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    let urls: Vec<String> =
                        event.urls().into_iter().map(|u| u.to_string()).collect();
                    let _ = app_handle_for_dl.emit("deep-link", urls);
                    // Bring the main window forward so the user sees the
                    // post-sign-in state immediately.
                    if let Some(window) = app_handle_for_dl.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            }

            start_clipboard_monitor(app.handle().clone());

            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                let app_handle = app.handle().clone();
                // Generation counter so a focus-back cancels a pending hide.
                // Without this, the click-outside-to-dismiss behavior fires
                // during the brief Focused(false) the OS produces while
                // entering its modal drag loop on a frameless window — the
                // window vanishes before the drag can register any motion.
                // Behaves the same on Linux/macOS: the focus blip there is
                // either absent or instantaneous, so the grace period is a
                // no-op rather than a regression.
                let blur_gen = std::sync::Arc::new(
                    std::sync::atomic::AtomicU64::new(0),
                );
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::Focused(false) => {
                        // The tooltip is alwaysOnTop and never the target
                        // of a drag, so hide it immediately rather than
                        // after the 180ms main-window grace period — the
                        // delay leaves it floating over other apps when
                        // the user alt-tabs away from Clipend, which is
                        // visually jarring. Tell the JS controller too so
                        // its internal `visible` flag doesn't go stale.
                        if let Some(tt) = app_handle.get_webview_window("tooltip") {
                            let _ = tt.hide();
                            let _ = tt.emit("tooltip-force-hidden", ());
                        }
                        let my_gen = blur_gen
                            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                            + 1;
                        let blur_gen = blur_gen.clone();
                        let win = window_clone.clone();
                        let app = app_handle.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(180));
                            // Newer focus event invalidated this hide.
                            if blur_gen.load(std::sync::atomic::Ordering::SeqCst)
                                != my_gen
                            {
                                return;
                            }
                            // Focus came back during the grace period — drag
                            // ended, or the user clicked back in. Don't hide.
                            if win.is_focused().unwrap_or(false) {
                                return;
                            }
                            let _ = win.hide();
                            // Defensive re-hide in case JS re-showed it
                            // during the grace period.
                            if let Some(tt) = app.get_webview_window("tooltip") {
                                let _ = tt.hide();
                            }
                        });
                    }
                    tauri::WindowEvent::Focused(true) => {
                        // Bumping the generation invalidates any in-flight
                        // hide closure — order matters: this MUST run before
                        // the closure's load() check, which is why we do it
                        // synchronously in the event handler.
                        blur_gen
                            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        restore_previous_foreground();
                        let _ = window_clone.hide();
                        if let Some(tt) = app_handle.get_webview_window("tooltip")
                        {
                            let _ = tt.hide();
                        }
                    }
                    _ => {}
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
