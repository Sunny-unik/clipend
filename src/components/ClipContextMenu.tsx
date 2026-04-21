import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Clip } from "../types/clip";
import { useClipStore } from "../store/clipStore";

interface ClipContextMenuProps {
  clip: Clip;
  x: number;
  y: number;
  onClose: () => void;
  onEdit: () => void;
  onSetTitle: () => void;
  onInfo: () => void;
}

export function ClipContextMenu({
  clip,
  x,
  y,
  onClose,
  onEdit,
  onSetTitle,
  onInfo,
}: ClipContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const togglePin = useClipStore((s) => s.togglePin);
  const toggleFavorite = useClipStore((s) => s.toggleFavorite);
  const duplicateClip = useClipStore((s) => s.duplicateClip);
  const removeClip = useClipStore((s) => s.removeClip);
  const setSkipNextEvent = useClipStore((s) => s.setSkipNextEvent);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Clamp menu position to viewport
  const menuStyle = (() => {
    const menuWidth = 180;
    const menuHeight = 220;
    const left = Math.min(x, window.innerWidth - menuWidth - 4);
    const top = Math.min(y, window.innerHeight - menuHeight - 4);
    return { left: `${left}px`, top: `${top}px` };
  })();

  const handleAction = (action: () => void | Promise<void>) => {
    return () => {
      action();
      onClose();
    };
  };

  const isFileLike = clip.clipType === "file" || clip.clipType === "image";

  const handleCopy = handleAction(async () => {
    setSkipNextEvent(true);
    if (isFileLike && clip.filePath) {
      await invoke("write_files_to_clipboard", { paths: [clip.filePath] });
    } else {
      await invoke("write_to_clipboard", { text: clip.content });
    }
  });

  const handleCopyPath = handleAction(async () => {
    if (!clip.filePath) return;
    setSkipNextEvent(true);
    await invoke("write_to_clipboard", { text: clip.filePath });
  });

  return (
    <div className="context-menu" ref={menuRef} style={menuStyle}>
      <button className="context-item" onClick={handleCopy}>
        {isFileLike ? "Copy file" : "Copy"}
      </button>
      {isFileLike && (
        <button className="context-item" onClick={handleCopyPath}>
          Copy path
        </button>
      )}
      <div className="context-divider" />
      <button className="context-item" onClick={handleAction(() => togglePin(clip.id))}>
        {clip.isPinned ? "Unpin" : "Pin"}
      </button>
      <button className="context-item" onClick={handleAction(() => toggleFavorite(clip.id))}>
        {clip.isFavorite ? "Remove favorite" : "Add to favorites"}
      </button>
      <div className="context-divider" />
      <button className="context-item" onClick={handleAction(onSetTitle)}>
        Set title...
      </button>
      {!isFileLike && (
        <button className="context-item" onClick={handleAction(onEdit)}>
          Edit content...
        </button>
      )}
      <button className="context-item" onClick={handleAction(() => duplicateClip(clip.id))}>
        Duplicate
      </button>
      <div className="context-divider" />
      <button className="context-item" onClick={handleAction(onInfo)}>
        Info...
      </button>
      <button
        className="context-item context-item--danger"
        onClick={handleAction(() => removeClip(clip.id))}
      >
        Delete
      </button>
    </div>
  );
}
