import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { emitTo } from "@tauri-apps/api/event";
import { currentMonitor } from "@tauri-apps/api/window";
import type { Clip } from "../types/clip";
import { isImageFileName } from "../types/clip";
import { useClipStore } from "../store/clipStore";

const HOVER_DELAY_MS = 400;
const TOOLTIP_WIDTH = 400;
const TOOLTIP_HEIGHT = 300;
const GAP = 8;

interface ClipCardProps {
  clip: Clip;
  index: number;
  isSelected: boolean;
  onContextMenu: (e: React.MouseEvent, clip: Clip) => void;
}

async function waitForTooltipWindow(timeoutMs = 2000): Promise<WebviewWindow | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const w = await WebviewWindow.getByLabel("tooltip");
    if (w) return w;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function showTooltip(clip: Clip, rowRect: DOMRect) {
  const tooltip = await waitForTooltipWindow();
  if (!tooltip) {
    console.warn("[tooltip] window not available");
    return;
  }

  const main = getCurrentWebviewWindow();
  const [mainPos, mainSize, scale, monitor] = await Promise.all([
    main.outerPosition(),
    main.outerSize(),
    main.scaleFactor(),
    currentMonitor(),
  ]);

  const widthPx = Math.round(TOOLTIP_WIDTH * scale);
  const heightPx = Math.round(TOOLTIP_HEIGHT * scale);
  const gapPx = Math.round(GAP * scale);

  // Prefer placing the tooltip to the right of the main window; fall back to left.
  let x = mainPos.x + mainSize.width + gapPx;
  if (monitor) {
    const screenRight = monitor.position.x + monitor.size.width;
    if (x + widthPx > screenRight) {
      x = mainPos.x - widthPx - gapPx;
    }
    if (x < monitor.position.x) {
      x = Math.max(monitor.position.x, screenRight - widthPx);
    }
  } else if (x + widthPx > window.screen.width) {
    x = Math.max(0, mainPos.x - widthPx - gapPx);
  }

  // Align vertically with the hovered row.
  const rowCenterCss = rowRect.top + rowRect.height / 2;
  let y = Math.round(mainPos.y + rowCenterCss * scale - heightPx / 2);
  if (monitor) {
    const screenTop = monitor.position.y;
    const screenBottom = monitor.position.y + monitor.size.height;
    if (y < screenTop) y = screenTop;
    if (y + heightPx > screenBottom) y = screenBottom - heightPx;
  }

  await emitTo("tooltip", "tooltip-clip", clip);
  await tooltip.setPosition(new PhysicalPosition(x, y));
  await tooltip.show();
}

async function hideTooltip() {
  const tooltip = await WebviewWindow.getByLabel("tooltip");
  if (!tooltip) return;
  await tooltip.hide();
  await emitTo("tooltip", "tooltip-clip", null);
}

export function ClipCard({ clip, index, isSelected, onContextMenu }: ClipCardProps) {
  const setSkipNextEvent = useClipStore((s) => s.setSkipNextEvent);
  const setSelectedClip = useClipStore((s) => s.setSelectedClip);
  const rowRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    setSkipNextEvent(true);
    if ((clip.clipType === "file" || clip.clipType === "image") && clip.filePath) {
      await invoke("write_files_to_clipboard", { paths: [clip.filePath] });
    } else {
      await invoke("write_to_clipboard", { text: clip.content });
    }
  };

  const handleClick = () => {
    setSelectedClip(clip.id);
    handleCopy();
  };

  const handleMouseEnter = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (!rowRef.current) return;
      const rect = rowRef.current.getBoundingClientRect();
      showTooltip(clip, rect).catch(() => {});
    }, HOVER_DELAY_MS);
  };

  const handleMouseLeave = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    hideTooltip().catch(() => {});
  };

  const showImagePreview =
    clip.filePath &&
    (clip.clipType === "image" ||
      (clip.clipType === "file" && isImageFileName(clip.fileName)));

  return (
    <div
      ref={rowRef}
      className={`clip-row${isSelected ? " clip-row--selected" : ""}${
        clip.clipType !== "text" ? " clip-row--file" : ""
      }`}
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        setSelectedClip(clip.id);
        onContextMenu(e, clip);
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-clip-id={clip.id}
    >
      <span className="clip-row-index">{index + 1}</span>
      {clip.isPinned && <span className="clip-row-icon" title="Pinned">📌</span>}
      {clip.isFavorite && <span className="clip-row-icon" title="Favorite">★</span>}
      {showImagePreview && clip.filePath && (
        <img
          className="clip-row-thumb"
          src={convertFileSrc(clip.filePath)}
          alt={clip.fileName ?? "preview"}
          loading="lazy"
        />
      )}
      {clip.clipType === "text" ? (
        <TextPreview clip={clip} />
      ) : (
        <FilePreview clip={clip} />
      )}
    </div>
  );
}

function TextPreview({ clip }: { clip: Clip }) {
  const preview = (clip.title || clip.content)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return <span className="clip-row-text">{preview}</span>;
}

function FilePreview({ clip }: { clip: Clip }) {
  const name = clip.fileName || clip.filePath || "unknown";
  const isImage =
    clip.clipType === "image" ||
    (clip.clipType === "file" && isImageFileName(clip.fileName));
  return (
    <span className="clip-row-text">
      {clip.title ? (
        <span className="clip-row-title">{clip.title}</span>
      ) : (
        <>
          {!isImage && <span className="clip-row-file-prefix">(Copied File)</span>}
          <span className="clip-row-file-name">{name}</span>
          {clip.filePath && (
            <span className="clip-row-file-path"> — {clip.filePath}</span>
          )}
        </>
      )}
    </span>
  );
}
