import { useEffect } from "react";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { useClipStore } from "../store/clipStore";
import { useSettingsStore } from "../store/settingsStore";

function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut) return false;
  const parts = shortcut.split("+").map((p) => p.trim());
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  if (e.ctrlKey !== mods.has("Ctrl")) return false;
  if (e.altKey !== mods.has("Alt")) return false;
  if (e.shiftKey !== mods.has("Shift")) return false;
  if (e.metaKey !== (mods.has("Super") || mods.has("Meta"))) return false;
  const pressed = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return pressed === key;
}

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
  const deleteShortcut = useSettingsStore((s) => s.deleteClipShortcut);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isSearchFocused = target === searchInputRef.current;

      // Ctrl+F to focus search
      if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Escape: always hide window (single press)
      if (e.key === "Escape") {
        e.preventDefault();
        invoke("toggle_window");
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

      // Enter: copy + paste selected clip (works from search box too)
      if (e.key === "Enter") {
        const clip = clips.find((c) => c.id === selectedClipId);
        if (!clip) return;
        e.preventDefault();
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
        return;
      }

      // Configurable delete clip shortcut. If the shortcut has no modifiers
      // and search is focused, we let the input handle the key (so Backspace/
      // Delete still edit the query instead of removing the clip).
      if (matchesShortcut(e, deleteShortcut)) {
        const hasModifier = e.ctrlKey || e.altKey || e.metaKey || e.shiftKey;
        if (!isSearchFocused || hasModifier) {
          e.preventDefault();
          if (selectedClipId) {
            const currentIndex = clips.findIndex((c) => c.id === selectedClipId);
            removeClip(selectedClipId);
            const nextClip = clips[currentIndex + 1] || clips[currentIndex - 1];
            setSelectedClip(nextClip?.id ?? null);
          }
          return;
        }
      }

      // Typing a printable character while nothing is focused:
      // focus the search input and forward the character into it.
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable;
      if (
        !isEditable &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        e.key.length === 1
      ) {
        const input = searchInputRef.current;
        if (!input) return;
        e.preventDefault();
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        if (setter) {
          setter.call(input, input.value + e.key);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clips, selectedClipId, setSelectedClip, removeClip, setSkipNextEvent, searchInputRef, deleteShortcut]);
}
