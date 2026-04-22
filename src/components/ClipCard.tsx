import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import type { Clip } from "../types/clip";
import { isImageFileName } from "../types/clip";
import { useClipStore } from "../store/clipStore";
import {
  cancelPendingHide,
  isTooltipVisible,
  scheduleHide,
  showTooltip,
} from "../lib/tooltipController";

const HOVER_DELAY_MS = 400;

interface ClipCardProps {
  clip: Clip;
  index: number;
  isSelected: boolean;
  onContextMenu: (e: React.MouseEvent, clip: Clip) => void;
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
      await invoke("write_to_clipboard", {
        text: clip.content,
        html: clip.htmlContent,
      });
    }
  };

  const handleClick = () => {
    setSelectedClip(clip.id);
  };

  const handleDoubleClick = async () => {
    setSelectedClip(clip.id);
    await handleCopy();
    await invoke("paste_to_active_window");
  };

  const handleMouseEnter = () => {
    cancelPendingHide();
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);

    const trigger = () => {
      if (!rowRef.current) return;
      const rect = rowRef.current.getBoundingClientRect();
      showTooltip(clip, rect).catch(() => {});
    };

    // If the tooltip is already visible (moving between rows), update it
    // immediately instead of waiting the hover delay.
    if (isTooltipVisible()) {
      trigger();
    } else {
      timerRef.current = window.setTimeout(trigger, HOVER_DELAY_MS);
    }
  };

  const handleMouseLeave = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    scheduleHide();
  };

  const handleDragStart = async (e: React.DragEvent) => {
    // Cancel the HTML5 drag and kick off an OS-native file drag via the
    // tauri-plugin-drag plugin (Ditto-style: a real file is generated and
    // dragged, so targets see it as a native file drop).
    e.preventDefault();
    cancelPendingHide();
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    try {
      let path: string;
      let icon: string = await invoke<string>("drag_icon_path");

      if (clip.clipType === "text") {
        path = await invoke<string>("prepare_text_drop_file", {
          text: clip.content,
        });
      } else if (clip.filePath) {
        path = clip.filePath;
        // For image files, use the image itself as the drag preview.
        if (
          clip.clipType === "image" ||
          (clip.clipType === "file" && isImageFileName(clip.fileName))
        ) {
          icon = clip.filePath;
        }
      } else {
        return;
      }

      await startDrag({ item: [path], icon });
    } catch (err) {
      console.error("[drag] startDrag failed:", err);
    }
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
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        setSelectedClip(clip.id);
        onContextMenu(e, clip);
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      draggable
      onDragStart={handleDragStart}
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
