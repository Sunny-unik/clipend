import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";

export function TitleBar() {
  const handleHide = async () => {
    // Explicit X click is unambiguously "hide" — calling toggle_window made
    // this miss when focus had just slipped (overlay open, dropdown active),
    // because the toggle then took the show-and-focus branch.
    try {
      await getCurrentWebviewWindow().hide();
      const tooltip = await WebviewWindow.getByLabel("tooltip");
      if (tooltip) await tooltip.hide();
    } catch (err) {
      console.warn("[titlebar] hide failed:", err);
    }
  };

  // data-tauri-drag-region triggers Tauri's native drag pipeline:
  //   Windows: ReleaseCapture + WM_NCLBUTTONDOWN(HTCAPTION)
  //   Linux:   gdk_window_begin_move_drag
  //   macOS:   NSWindow performWindowDragWithEvent
  // Same UX everywhere, no IPC roundtrip, no JS handler. The focus blip
  // that previously hid the window mid-drag is handled in Rust now.
  return (
    <div className="title-bar" data-tauri-drag-region>
      <span className="title-bar-title" data-tauri-drag-region>
        Clipend
        {import.meta.env.DEV && <span className="title-bar-env">dev</span>}
      </span>
      <button
        className="title-bar-btn"
        onClick={handleHide}
        title="Hide (keep running in background)"
        aria-label="Hide window"
      >
        &#215;
      </button>
    </div>
  );
}
