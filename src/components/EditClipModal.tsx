import { useState, useEffect, useRef } from "react";
import type { Clip } from "../types/clip";
import { useUiStore } from "../store/uiStore";

interface EditClipModalProps {
  clip: Clip;
  mode: "content" | "title";
  onClose: () => void;
  onSave: (value: string | null) => void;
}

export function EditClipModal({ clip, mode, onClose, onSave }: EditClipModalProps) {
  const initialValue = mode === "content" ? clip.content : clip.title || "";
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => {
    const { pushModal, popModal } = useUiStore.getState();
    pushModal();
    return () => popModal();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = () => {
    if (mode === "title") {
      onSave(value.trim() || null);
    } else {
      onSave(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Enter" && mode === "title") {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          {mode === "content" ? "Edit clip" : "Set title"}
        </div>
        <div className="modal-body">
          {mode === "content" ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              className="modal-textarea"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              className="modal-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Custom title (leave empty to clear)"
            />
          )}
        </div>
        <div className="modal-footer">
          <span className="modal-hint">
            {mode === "content" ? "Ctrl+Enter to save" : "Enter to save"}
          </span>
          <button className="modal-btn modal-btn--primary" onClick={handleSave}>
            Save
          </button>
          <button className="modal-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
