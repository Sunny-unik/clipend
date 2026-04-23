import { useState, useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { getSetting, initDatabase, setSetting } from "../services/database";
import { SETTINGS_FILENAME } from "../lib/env";

const DEFAULT_TOGGLE = "Alt+V";
const DEFAULT_DELETE = "Delete";

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
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");

  const mapped = KEY_MAP[e.key];
  const key = mapped ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(key);

  return parts.join("+");
}

type Field = "toggle" | "delete";

export function SettingsApp() {
  const [toggle, setToggle] = useState(DEFAULT_TOGGLE);
  const [del, setDel] = useState(DEFAULT_DELETE);
  const [autostart, setAutostart] = useState(false);
  const [recording, setRecording] = useState<Field | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      await initDatabase();
      let t = await getSetting("toggleShortcut");
      let d = await getSetting("deleteClipShortcut");
      // One-time migration from the legacy plugin-store file.
      if (!t || !d) {
        try {
          const legacy = await load(SETTINGS_FILENAME, {
            autoSave: false,
            defaults: {},
          });
          if (!t) {
            const v = await legacy.get<string>("toggleShortcut");
            if (v) {
              await setSetting("toggleShortcut", v);
              t = v;
            }
          }
          if (!d) {
            const v = await legacy.get<string>("deleteClipShortcut");
            if (v) {
              await setSetting("deleteClipShortcut", v);
              d = v;
            }
          }
        } catch {
          // Legacy file doesn't exist — fine, user just keeps defaults.
        }
      }
      if (t) setToggle(t);
      if (d) setDel(d);
      try {
        setAutostart(await isAutostartEnabled());
      } catch (err) {
        console.warn("autostart check failed:", err);
      }
    })();
  }, []);

  const handleAutostartChange = async (next: boolean) => {
    setAutostart(next);
    try {
      if (next) await enableAutostart();
      else await disableAutostart();
    } catch (err) {
      console.error("autostart toggle failed:", err);
      // Revert the UI if the OS call failed.
      setAutostart(!next);
    }
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      const combo = formatKeyEvent(e);
      if (!combo) return;
      if (recording === "toggle") setToggle(combo);
      if (recording === "delete") setDel(combo);
      setRecording(null);
    },
    [recording]
  );

  useEffect(() => {
    if (!recording) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [recording, handleKeyDown]);

  const handleSave = async () => {
    await setSetting("toggleShortcut", toggle);
    await setSetting("deleteClipShortcut", del);
    await emit("settings-updated");
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
              className={`shortcut-input${recording === "toggle" ? " shortcut-input--recording" : ""}`}
              value={recording === "toggle" ? "Press a key combo..." : toggle}
              readOnly
              onClick={() => setRecording("toggle")}
              onBlur={() => setRecording((r) => (r === "toggle" ? null : r))}
            />
          </div>
        </div>
        <div className="settings-row">
          <label className="settings-label">Delete clip</label>
          <div className="shortcut-input-group">
            <input
              type="text"
              className={`shortcut-input${recording === "delete" ? " shortcut-input--recording" : ""}`}
              value={recording === "delete" ? "Press a key combo..." : del}
              readOnly
              onClick={() => setRecording("delete")}
              onBlur={() => setRecording((r) => (r === "delete" ? null : r))}
            />
          </div>
        </div>
        <div className="settings-row">
          <label className="settings-label">Launch on startup</label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(e) => handleAutostartChange(e.target.checked)}
            />
            <span>Start Clipend in the background when the system boots</span>
          </label>
        </div>
      </div>
      <div className="settings-footer">
        {saved && <span className="settings-saved">Saved!</span>}
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

  .settings-check {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #ccc;
    font-size: 13px;
    cursor: pointer;
  }

  .settings-check input[type="checkbox"] {
    accent-color: #007acc;
    width: 14px;
    height: 14px;
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
