import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { useClipboardListener } from "./hooks/useClipboardListener";
import { useGlobalShortcut, useAppKeyboard } from "./hooks/useKeyboardShortcuts";
import { useClipStore } from "./store/clipStore";
import { useSettingsStore } from "./store/settingsStore";
import { useAuthStore } from "./store/authStore";
import { initDatabase } from "./services/database";
import { handleCallbackUrl } from "./services/auth";
import { requestSync, retrySync } from "./services/sync";
import {
  startRetentionTicker,
  stopRetentionTicker,
} from "./lib/retention";
import { Layout } from "./components/Layout";
import { ClipList } from "./components/ClipList";
import { LoginOverlay } from "./components/LoginOverlay";
import { setupTooltipListeners } from "./lib/tooltipController";
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
  const initAuth = useAuthStore((s) => s.init);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      // In dev, seed the dev DB from prod once (if it doesn't exist yet).
      if (import.meta.env.DEV) {
        try {
          await invoke("seed_dev_db");
        } catch (err) {
          console.warn("seed_dev_db failed:", err);
        }
      }
      await initDatabase();
      await loadSettings();
      await loadClips(true);
      initAuth().catch((err) => console.warn("[auth] init failed:", err));
      // Auto-delete clips older than 7 days (pinned/favorites kept).
      // Sweeps once now and every 6h while the app is open.
      startRetentionTicker();
    })();
    ensureTooltipWindow().catch((err) => {
      console.warn("Failed to pre-create tooltip window:", err);
    });
    setupTooltipListeners().catch(() => {});

    let unlisten: (() => void) | null = null;
    getCurrentWebviewWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          const store = useClipStore.getState();
          if (store.searchQuery) store.setSearch("");
          // Blur the search input if it held focus from a previous session —
          // we want Esc to hide the window on a single press.
          searchInputRef.current?.blur();
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    let unlistenSettings: (() => void) | null = null;
    listen("settings-updated", () => {
      loadSettings();
      // Settings window writes to SQLite directly, so its setSetting calls
      // bypass our store's requestSync. Trigger one here from the main
      // window (the sync owner) so the change pushes promptly.
      requestSync();
    }).then((fn) => {
      unlistenSettings = fn;
    });

    // The Settings webview's Retry button fires this — the actual sync
    // ticker lives only here in the main window.
    let unlistenRetry: (() => void) | null = null;
    listen("clipend:sync-retry", () => {
      retrySync();
    }).then((fn) => {
      unlistenRetry = fn;
    });

    // Deep-link: when the browser sends us back after Google sign-in via
    // clipend://auth-callback?code=..., the Rust side forwards the URL here.
    let unlistenDeepLink: (() => void) | null = null;
    listen<string[]>("deep-link", (event) => {
      for (const url of event.payload) {
        if (url.startsWith("clipend://auth-callback")) {
          console.log("[auth] handling callback url:", url);
          handleCallbackUrl(url)
            .then(() => console.log("[auth] session installed"))
            .catch((err) => {
              console.error("[auth] callback failed:", err);
              useAuthStore.setState({
                error: err instanceof Error ? err.message : String(err),
              });
            });
        }
      }
    }).then((fn) => {
      unlistenDeepLink = fn;
    });

    return () => {
      stopRetentionTicker();
      unlisten?.();
      unlistenSettings?.();
      unlistenRetry?.();
      unlistenDeepLink?.();
    };
  }, [loadClips, loadSettings, initAuth]);

  useClipboardListener();
  useGlobalShortcut();
  useAppKeyboard(searchInputRef);

  const authStatus = useAuthStore((s) => s.status);
  const loginPromptDismissed = useAuthStore((s) => s.loginPromptDismissed);
  const showLoginOverlay =
    authStatus === "signed-out" && !loginPromptDismissed;

  return (
    <Layout searchInputRef={searchInputRef}>
      <ClipList />
      {showLoginOverlay && <LoginOverlay />}
    </Layout>
  );
}

export default App;
