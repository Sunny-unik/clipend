import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";

interface SettingsStore {
  toggleShortcut: string;
  _store: Store | null;

  loadSettings: () => Promise<void>;
  setToggleShortcut: (shortcut: string) => Promise<void>;
}

const DEFAULT_TOGGLE_SHORTCUT = "Alt+V";

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  toggleShortcut: DEFAULT_TOGGLE_SHORTCUT,
  _store: null,

  loadSettings: async () => {
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    const saved = await store.get<string>("toggleShortcut");
    set({
      _store: store,
      toggleShortcut: saved || DEFAULT_TOGGLE_SHORTCUT,
    });
  },

  setToggleShortcut: async (shortcut: string) => {
    const store = get()._store;
    if (store) {
      await store.set("toggleShortcut", shortcut);
    }
    set({ toggleShortcut: shortcut });
  },
}));
