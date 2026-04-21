import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";

interface SettingsStore {
  toggleShortcut: string;
  deleteClipShortcut: string;
  _store: Store | null;

  loadSettings: () => Promise<void>;
  setToggleShortcut: (shortcut: string) => Promise<void>;
  setDeleteClipShortcut: (shortcut: string) => Promise<void>;
}

export const DEFAULT_TOGGLE_SHORTCUT = "Alt+V";
export const DEFAULT_DELETE_SHORTCUT = "Delete";

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  toggleShortcut: DEFAULT_TOGGLE_SHORTCUT,
  deleteClipShortcut: DEFAULT_DELETE_SHORTCUT,
  _store: null,

  loadSettings: async () => {
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    const toggle = await store.get<string>("toggleShortcut");
    const del = await store.get<string>("deleteClipShortcut");
    set({
      _store: store,
      toggleShortcut: toggle || DEFAULT_TOGGLE_SHORTCUT,
      deleteClipShortcut: del || DEFAULT_DELETE_SHORTCUT,
    });
  },

  setToggleShortcut: async (shortcut: string) => {
    const store = get()._store;
    if (store) {
      await store.set("toggleShortcut", shortcut);
    }
    set({ toggleShortcut: shortcut });
  },

  setDeleteClipShortcut: async (shortcut: string) => {
    const store = get()._store;
    if (store) {
      await store.set("deleteClipShortcut", shortcut);
    }
    set({ deleteClipShortcut: shortcut });
  },
}));
