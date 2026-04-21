import { useEffect, useRef } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useClipboardListener } from "./hooks/useClipboardListener";
import { useGlobalShortcut, useAppKeyboard } from "./hooks/useKeyboardShortcuts";
import { useClipStore } from "./store/clipStore";
import { useSettingsStore } from "./store/settingsStore";
import { initDatabase } from "./services/database";
import { Layout } from "./components/Layout";
import { ClipList } from "./components/ClipList";
import "./App.css";

async function ensureTooltipWindow() {
  const existing = await WebviewWindow.getByLabel("tooltip");
  if (existing) return;
  const devUrl = import.meta.env.DEV ? "http://localhost:1420" : "";
  const win = new WebviewWindow("tooltip", {
    url: `${devUrl}/?window=tooltip`,
    width: 400,
    height: 300,
    decorations: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    focus: false,
    visible: false,
  });
  win.once("tauri://error", (e) => {
    console.error("[tooltip] create failed:", e);
  });
  win.once("tauri://created", () => {
    console.log("[tooltip] created");
  });
}

function App() {
  const loadClips = useClipStore((s) => s.loadClips);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSettings();
    initDatabase().then(() => {
      loadClips(true);
    });
    ensureTooltipWindow().catch((err) => {
      console.warn("Failed to pre-create tooltip window:", err);
    });
  }, [loadClips, loadSettings]);

  useClipboardListener();
  useGlobalShortcut();
  useAppKeyboard(searchInputRef);

  return (
    <Layout searchInputRef={searchInputRef}>
      <ClipList />
    </Layout>
  );
}

export default App;
