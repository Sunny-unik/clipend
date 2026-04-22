import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import type { Clip } from "../types/clip";
import { isImageFileName } from "../types/clip";

async function collectDropPaths(clips: Clip[]): Promise<string[]> {
  const paths: string[] = [];
  for (const clip of clips) {
    if ((clip.clipType === "file" || clip.clipType === "image") && clip.filePath) {
      paths.push(clip.filePath);
    } else {
      const p = await invoke<string>("prepare_text_drop_file", {
        text: clip.content,
      });
      paths.push(p);
    }
  }
  return paths;
}

/**
 * Write the given clip(s) to the OS clipboard and invoke paste.
 * - Single text clip: writes text + html (formatting preserved).
 * - Anything else (single file/image, or multiple of anything): generates
 *   files as needed and writes them as a CF_HDROP file list so the target
 *   app receives multiple files on Ctrl+V.
 */
export async function pasteClips(clips: Clip[]): Promise<void> {
  if (clips.length === 0) return;

  if (clips.length === 1 && clips[0].clipType === "text") {
    const clip = clips[0];
    await invoke("write_to_clipboard", {
      text: clip.content,
      html: clip.htmlContent,
    });
  } else {
    const paths = await collectDropPaths(clips);
    await invoke("write_files_to_clipboard", { paths });
  }

  await invoke("paste_to_active_window");
}

/**
 * Start an OS-native file drag carrying one entry per clip in `clips`.
 * Text clips are materialized to disk (clip_N.txt). File/image clips use
 * their existing path.
 *
 * Ditto-style behavior: Clipend stays visible when the drag begins; as
 * soon as the cursor leaves Clipend's bounds, the window hides so the
 * user can see the drop target. The OS-level drag keeps running.
 */
export async function dragClips(clips: Clip[]): Promise<void> {
  if (clips.length === 0) return;

  const paths = await collectDropPaths(clips);

  let icon: string | null = null;
  for (const c of clips) {
    if (
      c.filePath &&
      (c.clipType === "image" ||
        (c.clipType === "file" && isImageFileName(c.fileName)))
    ) {
      icon = c.filePath;
      break;
    }
  }
  if (!icon) {
    icon = await invoke<string>("drag_icon_path");
  }

  const main = getCurrentWebviewWindow();
  const [pos, size] = await Promise.all([main.outerPosition(), main.outerSize()]);

  // Ask Rust to watch the cursor on its own thread and hide the window when
  // it leaves the given bounds. We can't do this from JS because the OS
  // drag loop blocks Tauri's main thread (so setInterval doesn't fire).
  void invoke("hide_when_cursor_leaves", {
    left: pos.x,
    top: pos.y,
    right: pos.x + size.width,
    bottom: pos.y + size.height,
  });

  // Kick off the native drag.
  await startDrag({ item: paths, icon });
}
