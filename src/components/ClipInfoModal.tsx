import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Clip } from "../types/clip";
import { useUiStore } from "../store/uiStore";
import { createClipSignedUrl } from "../services/sync";

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
    const { pushModal, popModal } = useUiStore.getState();
    pushModal();
    return () => popModal();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Mint a fresh signed URL on open. Bucket is private, so a raw
  // public URL wouldn't actually work — the SDK has to issue a
  // tokenised URL each time. Default expiry is 1h, plenty for
  // copy-paste-and-open use.
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [signedUrlState, setSignedUrlState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  useEffect(() => {
    if (!clip.remoteImageUrl) return;
    let cancelled = false;
    setSignedUrlState("loading");
    createClipSignedUrl(clip.id)
      .then((url) => {
        if (cancelled) return;
        if (url) {
          setSignedUrl(url);
          setSignedUrlState("idle");
        } else {
          setSignedUrlState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setSignedUrlState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [clip.id, clip.remoteImageUrl]);

  const [copied, setCopied] = useState(false);
  const copyUrl = async () => {
    if (!signedUrl) return;
    try {
      await invoke("write_to_clipboard", { text: signedUrl, html: null });
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("[info] copy url failed:", err);
    }
  };

  const isText = clip.clipType === "text";
  const sizeBytes = isText ? new TextEncoder().encode(clip.content).length : 0;
  const lineCount = isText ? clip.content.split(/\r?\n/).length : 0;
  const wordCount = isText && clip.content.trim()
    ? clip.content.trim().split(/\s+/).length
    : 0;

  const typeLabel =
    clip.clipType === "file"
      ? "File"
      : clip.clipType === "image"
        ? "Image"
        : "Text";

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">Clip info</div>
        <div className="modal-body">
          <div className="info-grid">
            <div className="info-label">Type</div>
            <div className="info-value">{typeLabel}</div>

            <div className="info-label">Title</div>
            <div className="info-value">{clip.title || <span className="info-muted">— none —</span>}</div>

            {clip.fileName && (
              <>
                <div className="info-label">File name</div>
                <div className="info-value">{clip.fileName}</div>
              </>
            )}

            {clip.filePath && (
              <>
                <div className="info-label">Path</div>
                <div className="info-value info-mono">{clip.filePath}</div>
              </>
            )}

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

            {isText && (
              <>
                <div className="info-label">Size</div>
                <div className="info-value">{formatBytes(sizeBytes)} ({clip.content.length} chars)</div>

                <div className="info-label">Lines / Words</div>
                <div className="info-value">{lineCount} lines · {wordCount} words</div>
              </>
            )}

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

            {clip.remoteImageUrl && (
              <>
                <div className="info-label">Cloud URL</div>
                <div
                  className="info-value info-mono info-hash"
                  title={signedUrl ?? undefined}
                >
                  {signedUrlState === "loading" && (
                    <span className="info-muted">Signing…</span>
                  )}
                  {signedUrlState === "error" && (
                    <span className="info-muted">Failed to sign URL</span>
                  )}
                  {signedUrl && (
                    <>
                      <span>{signedUrl.slice(0, 48)}…</span>
                      <button
                        className="modal-btn"
                        style={{
                          marginLeft: 8,
                          padding: "1px 8px",
                          fontSize: 11,
                        }}
                        onClick={copyUrl}
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
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
