import { useState, useEffect, useCallback } from "react";
import { load, type Store } from "@tauri-apps/plugin-store";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const DEFAULT_SHORTCUT = "Alt+V";

const KEY_MAP: Record<string, string> = {
  Control: "Ctrl",
  Meta: "Super",
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

function formatKeyEvent(e: KeyboardEvent): string | null {
  // Ignore standalone modifier presses
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");

  const key = KEY_MAP[e.key] || e.key.length === 1 ? e.key.toUpperCase() : KEY_MAP[e.key] || e.key;
  parts.push(key);

  return parts.join("+");
}

export function SettingsApp() {
  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);
  const [recording, setRecording] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    load("settings.json", { autoSave: true, defaults: {} }).then(async (s) => {
      setStore(s);
      const val = await s.get<string>("toggleShortcut");
      if (val) setShortcut(val);
    });
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const combo = formatKeyEvent(e);
    if (combo) {
      setShortcut(combo);
      setRecording(false);
    }
  }, []);

  useEffect(() => {
    if (!recording) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [recording, handleKeyDown]);

  const handleSave = async () => {
    if (store) {
      await store.set("toggleShortcut", shortcut);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleCancel = () => {
    getCurrentWebviewWindow().close();
  };

  return (
    <div className="settings-root">
      <style>{settingsCSS}</style>
      <div className="settings-tabs">
        <div className="settings-tab settings-tab--active">Keyboard Shortcuts</div>
      </div>
      <div className="settings-body">
        <div className="settings-row">
          <label className="settings-label">Activate Clipend</label>
          <div className="shortcut-input-group">
            <input
              type="text"
              className={`shortcut-input${recording ? " shortcut-input--recording" : ""}`}
              value={recording ? "Press a key combo..." : shortcut}
              readOnly
              onClick={() => setRecording(true)}
              onBlur={() => setRecording(false)}
            />
          </div>
        </div>
      </div>
      <div className="settings-footer">
        {saved && <span className="settings-saved">Saved! Restart app to apply.</span>}
        <button className="settings-btn settings-btn--primary" onClick={handleSave}>
          OK
        </button>
        <button className="settings-btn" onClick={handleCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const settingsCSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  .settings-root {
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 13px;
    color: #ccc;
    background: #1e1e1e;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .settings-tabs {
    display: flex;
    border-bottom: 1px solid #333;
    background: #252526;
  }

  .settings-tab {
    padding: 8px 16px;
    font-size: 12px;
    color: #888;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }

  .settings-tab--active {
    color: #fff;
    border-bottom-color: #007acc;
  }

  .settings-body {
    flex: 1;
    padding: 20px 16px;
  }

  .settings-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  .settings-label {
    width: 130px;
    flex-shrink: 0;
    font-size: 13px;
    color: #ccc;
  }

  .shortcut-input-group {
    flex: 1;
  }

  .shortcut-input {
    width: 100%;
    padding: 5px 8px;
    background: #3c3c3c;
    border: 1px solid #555;
    border-radius: 3px;
    color: #fff;
    font-family: inherit;
    font-size: 13px;
    outline: none;
    cursor: pointer;
  }

  .shortcut-input:focus,
  .shortcut-input--recording {
    border-color: #007acc;
    background: #2a2a2a;
  }

  .settings-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid #333;
    background: #252526;
  }

  .settings-saved {
    margin-right: auto;
    color: #4ec9b0;
    font-size: 12px;
  }

  .settings-btn {
    padding: 5px 20px;
    border: 1px solid #555;
    border-radius: 3px;
    background: #3c3c3c;
    color: #ccc;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .settings-btn:hover {
    background: #4a4a4a;
  }

  .settings-btn--primary {
    background: #007acc;
    border-color: #007acc;
    color: #fff;
  }

  .settings-btn--primary:hover {
    background: #006bb3;
  }
`;
