import { useEffect } from "react";
import type { Clip } from "../types/clip";

interface ClipInfoModalProps {
  clip: Clip;
  onClose: () => void;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

export function ClipInfoModal({ clip, onClose }: ClipInfoModalProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const sizeBytes = new TextEncoder().encode(clip.content).length;
  const lineCount = clip.content.split(/\r?\n/).length;
  const wordCount = clip.content.trim() ? clip.content.trim().split(/\s+/).length : 0;

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">Clip info</div>
        <div className="modal-body">
          <div className="info-grid">
            <div className="info-label">Title</div>
            <div className="info-value">{clip.title || <span className="info-muted">— none —</span>}</div>

            <div className="info-label">Created</div>
            <div className="info-value">
              {formatDate(clip.createdAt)}
              <span className="info-relative"> · {formatRelative(clip.createdAt)}</span>
            </div>

            <div className="info-label">Last updated</div>
            <div className="info-value">
              {formatDate(clip.updatedAt)}
              <span className="info-relative"> · {formatRelative(clip.updatedAt)}</span>
            </div>

            <div className="info-label">Size</div>
            <div className="info-value">{formatBytes(sizeBytes)} ({clip.content.length} chars)</div>

            <div className="info-label">Lines / Words</div>
            <div className="info-value">{lineCount} lines · {wordCount} words</div>

            <div className="info-label">Pinned</div>
            <div className="info-value">{clip.isPinned ? "Yes" : "No"}</div>

            <div className="info-label">Favorite</div>
            <div className="info-value">{clip.isFavorite ? "Yes" : "No"}</div>

            <div className="info-label">ID</div>
            <div className="info-value info-mono">{clip.id}</div>

            <div className="info-label">Hash</div>
            <div className="info-value info-mono info-hash" title={clip.contentHash}>
              {clip.contentHash.slice(0, 16)}…
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="modal-btn modal-btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
