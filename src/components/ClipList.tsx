import { useEffect, useRef, useCallback } from "react";
import { useClipStore } from "../store/clipStore";
import { ClipCard } from "./ClipCard";

export function ClipList() {
  const clips = useClipStore((s) => s.clips);
  const isLoading = useClipStore((s) => s.isLoading);
  const hasMore = useClipStore((s) => s.hasMore);
  const loadClips = useClipStore((s) => s.loadClips);
  const selectedClipId = useClipStore((s) => s.selectedClipId);
  const listRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el || isLoading || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      loadClips(false);
    }
  }, [isLoading, hasMore, loadClips]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Scroll selected item into view
  useEffect(() => {
    if (!selectedClipId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-clip-id="${selectedClipId}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedClipId]);

  if (clips.length === 0 && !isLoading) {
    return (
      <div className="clip-list-empty">
        <span>No clips yet</span>
      </div>
    );
  }

  return (
    <div className="clip-list" ref={listRef}>
      {clips.map((clip, i) => (
        <ClipCard
          key={clip.id}
          clip={clip}
          index={i}
          isSelected={clip.id === selectedClipId}
        />
      ))}
    </div>
  );
}
