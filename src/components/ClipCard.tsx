import { invoke } from "@tauri-apps/api/core";
import type { Clip } from "../types/clip";
import { useClipStore } from "../store/clipStore";

interface ClipCardProps {
  clip: Clip;
  index: number;
  isSelected: boolean;
}

export function ClipCard({ clip, index, isSelected }: ClipCardProps) {
  const setSkipNextEvent = useClipStore((s) => s.setSkipNextEvent);

  // Single line preview: collapse whitespace, strip newlines
  const preview = (clip.title || clip.content)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const handleCopy = async () => {
    setSkipNextEvent(true);
    await invoke("write_to_clipboard", { text: clip.content });
  };

  return (
    <div
      className={`clip-row${isSelected ? " clip-row--selected" : ""}`}
      onClick={handleCopy}
      data-clip-id={clip.id}
    >
      <span className="clip-row-index">{index + 1}</span>
      <span className="clip-row-text">{preview}</span>
    </div>
  );
}
