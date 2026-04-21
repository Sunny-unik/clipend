import { convertFileSrc } from "@tauri-apps/api/core";
import type { Clip } from "../types/clip";
import { isImageFileName } from "../types/clip";

interface ClipTooltipContentProps {
  clip: Clip;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function ClipTooltipContent({ clip }: ClipTooltipContentProps) {
  const isImage =
    clip.clipType === "image" ||
    (clip.clipType === "file" && isImageFileName(clip.fileName));

  return (
    <div className="clip-tooltip-body">
      {isImage && clip.filePath ? (
        <img
          className="clip-tooltip-image"
          src={convertFileSrc(clip.filePath)}
          alt={clip.fileName ?? "preview"}
        />
      ) : clip.clipType === "file" ? (
        <div className="clip-tooltip-file">
          <div className="clip-tooltip-file-name">{clip.fileName ?? clip.filePath}</div>
          {clip.filePath && (
            <div className="clip-tooltip-file-path">{clip.filePath}</div>
          )}
        </div>
      ) : (
        <pre className="clip-tooltip-content">{clip.content}</pre>
      )}
      <div className="clip-tooltip-meta">
        {clip.title && (
          <div className="clip-tooltip-meta-row">
            <span className="clip-tooltip-meta-label">Title:</span>
            <span>{clip.title}</span>
          </div>
        )}
        <div className="clip-tooltip-meta-row">
          <span className="clip-tooltip-meta-label">Added:</span>
          <span>{formatDate(clip.createdAt)}</span>
        </div>
        <div className="clip-tooltip-meta-row">
          <span className="clip-tooltip-meta-label">Last used:</span>
          <span>{formatDate(clip.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
}
