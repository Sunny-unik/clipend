import { useState, useEffect, useRef } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export function OptionsMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    // Use same SPA with ?window=settings query to render settings view
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
          <button className="options-item" onClick={openSettings}>
            Options...
          </button>
        </div>
      )}
    </div>
  );
}
