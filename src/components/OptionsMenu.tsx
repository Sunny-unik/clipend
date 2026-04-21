import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useClipStore } from "../store/clipStore";

export function OptionsMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeFilter = useClipStore((s) => s.activeFilter);
  const setFilter = useClipStore((s) => s.setFilter);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const openSettings = async () => {
    setOpen(false);
    const existing = await WebviewWindow.getByLabel("settings");
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }
    const devUrl = import.meta.env.DEV ? "http://localhost:1420" : "";
    new WebviewWindow("settings", {
      url: `${devUrl}/?window=settings`,
      title: "Options",
      width: 400,
      height: 300,
      decorations: true,
      resizable: false,
      center: true,
    });
  };

  const handleFilter = (filter: "all" | "favorites" | "pinned") => {
    setFilter(filter);
    setOpen(false);
  };

  const handleExit = async () => {
    setOpen(false);
    await invoke("exit_app");
  };

  return (
    <div className="options-menu-wrapper" ref={menuRef}>
      <button
        className="options-btn"
        onClick={() => setOpen(!open)}
        title="Options"
      >
        &#8230;
      </button>
      {open && (
        <div className="options-dropdown">
          <div className="options-section-label">Filter</div>
          <button
            className={`options-item${activeFilter === "all" ? " options-item--active" : ""}`}
            onClick={() => handleFilter("all")}
          >
            All clips
          </button>
          <button
            className={`options-item${activeFilter === "pinned" ? " options-item--active" : ""}`}
            onClick={() => handleFilter("pinned")}
          >
            Pinned
          </button>
          <button
            className={`options-item${activeFilter === "favorites" ? " options-item--active" : ""}`}
            onClick={() => handleFilter("favorites")}
          >
            Favorites
          </button>
          <div className="options-divider" />
          <button className="options-item" onClick={openSettings}>
            Options...
          </button>
          <button
            className="options-item options-item--danger"
            onClick={handleExit}
          >
            Exit
          </button>
        </div>
      )}
    </div>
  );
}
