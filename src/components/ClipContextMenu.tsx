import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
    // Close on window blur too — otherwise the menu survives the
    // auto-hide-on-blur cycle and is still floating there when the user
    // brings the window back via Alt+V or the tray icon.
    const handleBlur = () => onClose();
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("blur", handleBlur);
    };
  }, [onClose]);

  // Measure-and-adjust: render off-viewport (hidden) on the first pass,
  // measure the actual menu rect, then reposition so it fits inside the
  // viewport on the second pass. Hardcoded width/height estimates were
  // wrong for some clip types (more items → taller; longer labels →
  // wider) and the menu was clipping past the right/bottom edges.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 4;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    setPos({
      left: Math.min(Math.max(x, margin), maxLeft),
      top: Math.min(Math.max(y, margin), maxTop),
    });
  }, [x, y]);

  const menuStyle: React.CSSProperties = pos
    ? { left: `${pos.left}px`, top: `${pos.top}px` }
    : { left: `${x}px`, top: `${y}px`, visibility: "hidden" };

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
      await invoke("write_to_clipboard", {
        text: clip.content,
        html: clip.htmlContent,
      });
    }
  });

  const handleCopyPath = handleAction(async () => {
    if (!clip.filePath) return;
    setSkipNextEvent(true);
    await invoke("write_to_clipboard", { text: clip.filePath });
  });

  const handlePaste = handleAction(async () => {
    setSkipNextEvent(true);
    if (isFileLike && clip.filePath) {
      await invoke("write_files_to_clipboard", { paths: [clip.filePath] });
    } else {
      await invoke("write_to_clipboard", {
        text: clip.content,
        html: clip.htmlContent,
      });
    }
    await invoke("paste_to_active_window");
  });

  const handlePastePlain = handleAction(async () => {
    setSkipNextEvent(true);
    // Plain text only (no html) → target app pastes unformatted.
    await invoke("write_to_clipboard", { text: clip.content });
    await invoke("paste_to_active_window");
  });

  return (
    <div className="context-menu" ref={menuRef} style={menuStyle}>
      <button className="context-item" onClick={handlePaste}>
        Paste
      </button>
      <button className="context-item" onClick={handleCopy}>
        {isFileLike ? "Copy file" : "Copy"}
      </button>
      {isFileLike && (
        <button className="context-item" onClick={handleCopyPath}>
          Copy path
        </button>
      )}
      {!isFileLike && (
        <button className="context-item" onClick={handlePastePlain}>
          Paste without formatting
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
