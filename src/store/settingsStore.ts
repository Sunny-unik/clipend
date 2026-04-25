import { create } from "zustand";
import { load } from "@tauri-apps/plugin-store";
import { getSetting, setSetting } from "../services/database";
import { SETTINGS_FILENAME } from "../lib/env";
import { requestSync } from "../services/sync";

interface SettingsStore {
  toggleShortcut: string;
  deleteClipShortcut: string;

  loadSettings: () => Promise<void>;
  setToggleShortcut: (shortcut: string) => Promise<void>;
  setDeleteClipShortcut: (shortcut: string) => Promise<void>;
}

export const DEFAULT_TOGGLE_SHORTCUT = "Alt+V";
export const DEFAULT_DELETE_SHORTCUT = "Delete";

const KEY_TOGGLE = "toggleShortcut";
const KEY_DELETE = "deleteClipShortcut";

// Lazy one-off migration: older versions kept settings in a plugin-store
// file. If the DB still has no value for a key but the legacy file does,
// copy it over once so returning users don't lose their customizations.
async function legacyValue(key: string): Promise<string | null> {
  try {
    const legacy = await load(SETTINGS_FILENAME, { autoSave: false, defaults: {} });
    const v = await legacy.get<string>(key);
    return v ?? null;
  } catch {
    return null;
  }
}

async function readWithFallback(key: string): Promise<string | null> {
  const fromDb = await getSetting(key);
  if (fromDb) return fromDb;
  const fromLegacy = await legacyValue(key);
  if (fromLegacy) {
    await setSetting(key, fromLegacy);
    return fromLegacy;
  }
  return null;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  toggleShortcut: DEFAULT_TOGGLE_SHORTCUT,
  deleteClipShortcut: DEFAULT_DELETE_SHORTCUT,

  loadSettings: async () => {
    const [toggle, del] = await Promise.all([
      readWithFallback(KEY_TOGGLE),
      readWithFallback(KEY_DELETE),
    ]);
    set({
      toggleShortcut: toggle || DEFAULT_TOGGLE_SHORTCUT,
      deleteClipShortcut: del || DEFAULT_DELETE_SHORTCUT,
    });
  },

  setToggleShortcut: async (shortcut: string) => {
    await setSetting(KEY_TOGGLE, shortcut);
    set({ toggleShortcut: shortcut });
    requestSync();
  },

  setDeleteClipShortcut: async (shortcut: string) => {
    await setSetting(KEY_DELETE, shortcut);
    set({ deleteClipShortcut: shortcut });
    requestSync();
  },
}));
