import { useEffect } from "react";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { useClipStore } from "../store/clipStore";
import { useSettingsStore } from "../store/settingsStore";

export function useGlobalShortcut() {
  const toggleShortcut = useSettingsStore((s) => s.toggleShortcut);

  useEffect(() => {
    if (!toggleShortcut) return;

    register(toggleShortcut, (event) => {
      // Only fire on key press, not release — fixes the show-then-hide bug
      if (event.state === "Pressed") {
        invoke("toggle_window");
      }
    }).catch((err) => {
      console.warn("Failed to register global shortcut:", err);
    });

    return () => {
      unregister(toggleShortcut).catch(() => {});
    };
  }, [toggleShortcut]);
}

export function useAppKeyboard(searchInputRef: React.RefObject<HTMLInputElement | null>) {
  const clips = useClipStore((s) => s.clips);
  const selectedClipId = useClipStore((s) => s.selectedClipId);
  const setSelectedClip = useClipStore((s) => s.setSelectedClip);
  const removeClip = useClipStore((s) => s.removeClip);
  const setSkipNextEvent = useClipStore((s) => s.setSkipNextEvent);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isSearchFocused = target === searchInputRef.current;

      // Ctrl+F or / to focus search
      if ((e.key === "f" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !isSearchFocused)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Escape: blur search or hide window
      if (e.key === "Escape") {
        if (isSearchFocused) {
          searchInputRef.current?.blur();
        } else {
          invoke("toggle_window");
        }
        return;
      }

      // Arrow navigation
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (clips.length === 0) return;

        const currentIndex = selectedClipId
          ? clips.findIndex((c) => c.id === selectedClipId)
          : -1;

        let nextIndex: number;
        if (e.key === "ArrowDown") {
          nextIndex = currentIndex < clips.length - 1 ? currentIndex + 1 : 0;
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : clips.length - 1;
        }

        setSelectedClip(clips[nextIndex].id);
        return;
      }

      // Enter: copy + paste selected clip (same as double-click)
      if (e.key === "Enter" && !isSearchFocused) {
        e.preventDefault();
        const clip = clips.find((c) => c.id === selectedClipId);
        if (clip) {
          setSkipNextEvent(true);
          (async () => {
            if ((clip.clipType === "file" || clip.clipType === "image") && clip.filePath) {
              await invoke("write_files_to_clipboard", { paths: [clip.filePath] });
            } else {
              await invoke("write_to_clipboard", {
                text: clip.content,
                html: clip.htmlContent,
              });
            }
            await invoke("paste_to_active_window");
          })();
        }
        return;
      }

      // Delete: remove selected clip
      if (e.key === "Delete" && !isSearchFocused) {
        e.preventDefault();
        if (selectedClipId) {
          const currentIndex = clips.findIndex((c) => c.id === selectedClipId);
          removeClip(selectedClipId);
          const nextClip = clips[currentIndex + 1] || clips[currentIndex - 1];
          setSelectedClip(nextClip?.id ?? null);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clips, selectedClipId, setSelectedClip, removeClip, setSkipNextEvent, searchInputRef]);
}
