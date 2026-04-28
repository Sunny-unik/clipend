import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emitTo } from "@tauri-apps/api/event";
import { useClipStore } from "../store/clipStore";
import { useAuthStore } from "../store/authStore";

export function OptionsMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeFilter = useClipStore((s) => s.activeFilter);
  const setFilter = useClipStore((s) => s.setFilter);
  const authStatus = useAuthStore((s) => s.status);
  const showLoginPrompt = useAuthStore((s) => s.showLoginPrompt);

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

  // Close the dropdown whenever the main window loses focus (e.g.
  // Settings just opened and stole focus, or Alt-tab away). Without
  // this, opening Settings → toggling main → clicking the ⋯ button
  // can land on a stale `open: true` state — the click then toggles
  // it to false and nothing shows.
  useEffect(() => {
    const handleBlur = () => setOpen(false);
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, []);

  const openSettings = async (tab?: "account") => {
    setOpen(false);
    const existing = await WebviewWindow.getByLabel("settings");
    if (existing) {
      await existing.show();
      await existing.setFocus();
      // If an Account tab was requested, notify the already-open window.
      if (tab) await emitTo("settings", "settings-open-tab", tab);
      return;
    }
    const devUrl = import.meta.env.DEV ? "http://localhost:1420" : "";
    const tabQuery = tab ? `&tab=${tab}` : "";
    new WebviewWindow("settings", {
      url: `${devUrl}/?window=settings${tabQuery}`,
      title: "Options",
      width: 420,
      height: 420,
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
        onClick={() => setOpen((prev) => !prev)}
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
          {authStatus === "signed-out" && (
            <button
              className="options-item"
              onClick={() => {
                setOpen(false);
                showLoginPrompt();
              }}
            >
              Sign in...
            </button>
          )}
          {authStatus === "signed-in" && (
            <button className="options-item" onClick={() => openSettings("account")}>
              Account...
            </button>
          )}
          <button className="options-item" onClick={() => openSettings()}>
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
