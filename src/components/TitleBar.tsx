import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export function TitleBar() {
  const handleHide = async () => {
    await invoke("toggle_window");
  };

  const handleMouseDown = async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    e.preventDefault();
    console.log("[titlebar] mousedown — calling startDragging");
    try {
      await getCurrentWebviewWindow().startDragging();
      console.log("[titlebar] startDragging resolved");
    } catch (err) {
      console.error("[titlebar] startDragging failed:", err);
    }
  };

  return (
    <div
      className="title-bar"
      data-tauri-drag-region=""
      onMouseDown={handleMouseDown}
    >
      <span className="title-bar-title" data-tauri-drag-region="">
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
