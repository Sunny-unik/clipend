import { useEffect } from "react";
import { useUiStore } from "../store/uiStore";

interface ConfirmModalProps {
  title: string;
  message: string;
  /** Button label for the confirming action. Default: "OK". */
  confirmLabel?: string;
  /** When true, the confirm button gets danger styling (red). Use
   * for destructive actions like deletion. */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Generic in-app replacement for window.confirm — matches the rest of
 * the modal styling instead of the browser's "localhost:1420 says…"
 * default. Push/pop into uiStore so the global keyboard hook leaves
 * Esc / Enter alone while it's open.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel = "OK",
  danger = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  useEffect(() => {
    const { pushModal, popModal } = useUiStore.getState();
    pushModal();
    return () => popModal();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onConfirm, onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="modal-header">{title}</div>
        <div className="modal-body">
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#ccc" }}>
            {message}
          </p>
        </div>
        <div className="modal-footer">
          <button className="modal-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={
              danger ? "modal-btn modal-btn--danger" : "modal-btn modal-btn--primary"
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
