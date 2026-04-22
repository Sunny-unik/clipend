import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Clip } from "../types/clip";
import { isImageFileName } from "../types/clip";
import { useClipStore } from "../store/clipStore";
import {
  cancelPendingHide,
  isTooltipVisible,
  scheduleHide,
  showTooltip,
} from "../lib/tooltipController";
import { dragClips, pasteClips } from "../lib/clipActions";

const HOVER_DELAY_MS = 400;

interface ClipCardProps {
  clip: Clip;
  index: number;
  isSelected: boolean;
  isFocused: boolean;
  onContextMenu: (e: React.MouseEvent, clip: Clip) => void;
}

export function ClipCard({ clip, index, isSelected, isFocused, onContextMenu }: ClipCardProps) {
  const setSkipNextEvent = useClipStore((s) => s.setSkipNextEvent);
  const setSelectedClip = useClipStore((s) => s.setSelectedClip);
  const toggleSelectClip = useClipStore((s) => s.toggleSelectClip);
  const extendSelectionTo = useClipStore((s) => s.extendSelectionTo);
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

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      extendSelectionTo(clip.id);
    } else if (e.ctrlKey || e.metaKey) {
      toggleSelectClip(clip.id);
    } else {
      setSelectedClip(clip.id);
    }
  };

  const handleDoubleClick = async () => {
    const state = useClipStore.getState();
    // If the double-clicked clip is part of a multi-selection, paste ALL
    // selected clips as files. Otherwise fall back to single-clip paste.
    const isInMulti =
      state.selectedIds.length > 1 && state.selectedIds.includes(clip.id);
    setSkipNextEvent(true);
    if (isInMulti) {
      const ids = new Set(state.selectedIds);
      const selected = state.clips.filter((c) => ids.has(c.id));
      await pasteClips(selected);
    } else {
      setSelectedClip(clip.id);
      await handleCopy();
      await invoke("paste_to_active_window");
    }
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
    // Cancel the HTML5 drag and kick off an OS-native file drag via
    // tauri-plugin-drag. A real file is generated on disk for text clips so
    // the drop target receives it as a native file (CF_HDROP on Windows).
    e.preventDefault();
    cancelPendingHide();
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    try {
      const state = useClipStore.getState();
      const isInMulti =
        state.selectedIds.length > 1 && state.selectedIds.includes(clip.id);
      const clipsToDrag = isInMulti
        ? state.clips.filter((c) => state.selectedIds.includes(c.id))
        : [clip];
      await dragClips(clipsToDrag);
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
        isFocused ? " clip-row--focused" : ""
      }${clip.clipType !== "text" ? " clip-row--file" : ""}`}
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
