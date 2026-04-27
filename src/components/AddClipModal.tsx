import { useEffect, useRef, useState } from "react";
import { useClipStore } from "../store/clipStore";
import { useUiStore } from "../store/uiStore";

interface AddClipModalProps {
  onClose: () => void;
}

export function AddClipModal({ onClose }: AddClipModalProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addClip = useClipStore((s) => s.addClip);

  useEffect(() => {
    const { pushModal, popModal } = useUiStore.getState();
    pushModal();
    return () => popModal();
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const canSave = text.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await addClip({ kind: "text", text });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd+Enter saves; plain Enter inserts a newline like any textarea.
  const handleTextareaKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="modal-header">New clip</div>
        <div className="modal-body">
          <textarea
            ref={textareaRef}
            className="modal-textarea"
            placeholder="Type or paste anything…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleTextareaKey}
          />
        </div>
        <div className="modal-footer">
          <span className="modal-hint">Ctrl+Enter to save</span>
          <button className="modal-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="modal-btn modal-btn--primary"
            onClick={save}
            disabled={!canSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
