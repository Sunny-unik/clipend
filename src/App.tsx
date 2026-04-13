import { useEffect, useRef } from "react";
import { useClipboardListener } from "./hooks/useClipboardListener";
import { useGlobalShortcut, useAppKeyboard } from "./hooks/useKeyboardShortcuts";
import { useClipStore } from "./store/clipStore";
import { useSettingsStore } from "./store/settingsStore";
import { initDatabase } from "./services/database";
import { Layout } from "./components/Layout";
import { ClipList } from "./components/ClipList";
import "./App.css";

function App() {
  const loadClips = useClipStore((s) => s.loadClips);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSettings();
    initDatabase().then(() => {
      loadClips(true);
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
