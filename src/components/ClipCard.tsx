import { invoke } from "@tauri-apps/api/core";
import type { Clip } from "../types/clip";
import { useClipStore } from "../store/clipStore";

interface ClipCardProps {
  clip: Clip;
  index: number;
  isSelected: boolean;
  onContextMenu: (e: React.MouseEvent, clip: Clip) => void;
}

export function ClipCard({ clip, index, isSelected, onContextMenu }: ClipCardProps) {
  const setSkipNextEvent = useClipStore((s) => s.setSkipNextEvent);
  const setSelectedClip = useClipStore((s) => s.setSelectedClip);

  const preview = (clip.title || clip.content)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const handleCopy = async () => {
    setSkipNextEvent(true);
    await invoke("write_to_clipboard", { text: clip.content });
  };

  const handleClick = () => {
    setSelectedClip(clip.id);
    handleCopy();
  };

  return (
    <div
      className={`clip-row${isSelected ? " clip-row--selected" : ""}`}
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        setSelectedClip(clip.id);
        onContextMenu(e, clip);
      }}
      data-clip-id={clip.id}
    >
      <span className="clip-row-index">{index + 1}</span>
      {clip.isPinned && <span className="clip-row-icon" title="Pinned">📌</span>}
      {clip.isFavorite && <span className="clip-row-icon" title="Favorite">★</span>}
      <span className="clip-row-text">{preview}</span>
    </div>
  );
}
