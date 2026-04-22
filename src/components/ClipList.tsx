import { useEffect, useRef, useCallback, useState } from "react";
import { useClipStore } from "../store/clipStore";
import { ClipCard } from "./ClipCard";
import { ClipContextMenu } from "./ClipContextMenu";
import { EditClipModal } from "./EditClipModal";
import { ClipInfoModal } from "./ClipInfoModal";
import type { Clip } from "../types/clip";

interface MenuState {
  clip: Clip;
  x: number;
  y: number;
}

interface EditState {
  clip: Clip;
  mode: "content" | "title";
}

export function ClipList() {
  const clips = useClipStore((s) => s.clips);
  const isLoading = useClipStore((s) => s.isLoading);
  const hasMore = useClipStore((s) => s.hasMore);
  const loadClips = useClipStore((s) => s.loadClips);
  const selectedClipId = useClipStore((s) => s.selectedClipId);
  const selectedIds = useClipStore((s) => s.selectedIds);
  const editClip = useClipStore((s) => s.editClip);
  const setTitle = useClipStore((s) => s.setTitle);

  const selectedSet = new Set(selectedIds);

  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [info, setInfo] = useState<Clip | null>(null);

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

  useEffect(() => {
    if (!selectedClipId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-clip-id="${selectedClipId}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedClipId]);

  const handleContextMenu = (e: React.MouseEvent, clip: Clip) => {
    setMenu({ clip, x: e.clientX, y: e.clientY });
  };

  const handleEditSave = async (value: string | null) => {
    if (!edit) return;
    if (edit.mode === "content" && value !== null) {
      await editClip(edit.clip.id, value);
    } else if (edit.mode === "title") {
      await setTitle(edit.clip.id, value);
    }
    setEdit(null);
  };

  if (clips.length === 0 && !isLoading) {
    return (
      <div className="clip-list-empty">
        <span>No clips yet</span>
      </div>
    );
  }

  return (
    <>
      <div className="clip-list" ref={listRef}>
        {clips.map((clip, i) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            index={i}
            isSelected={selectedSet.has(clip.id)}
            isFocused={clip.id === selectedClipId}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>
      {menu && (
        <ClipContextMenu
          clip={menu.clip}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onEdit={() => setEdit({ clip: menu.clip, mode: "content" })}
          onSetTitle={() => setEdit({ clip: menu.clip, mode: "title" })}
          onInfo={() => setInfo(menu.clip)}
        />
      )}
      {edit && (
        <EditClipModal
          clip={edit.clip}
          mode={edit.mode}
          onClose={() => setEdit(null)}
          onSave={handleEditSave}
        />
      )}
      {info && <ClipInfoModal clip={info} onClose={() => setInfo(null)} />}
    </>
  );
}
