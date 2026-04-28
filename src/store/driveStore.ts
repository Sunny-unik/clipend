import { create } from "zustand";
import {
  connectDrive,
  disconnectDrive,
  isDriveConfigured,
  isDriveConnected,
} from "../services/googleDrive";

type DriveStatus = "loading" | "connected" | "disconnected" | "disabled";

interface DriveStore {
  status: DriveStatus;
  /** Last error from connect / disconnect; cleared on next attempt. */
  error: string | null;
  /** True while a connect flow is in progress (browser open, awaiting
   * callback). UI uses this to show a spinner / disable buttons. */
  busy: boolean;

  init: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useDriveStore = create<DriveStore>((set, get) => ({
  status: "loading",
  error: null,
  busy: false,

  init: async () => {
    if (!isDriveConfigured()) {
      set({ status: "disabled" });
      return;
    }
    const connected = await isDriveConnected();
    set({ status: connected ? "connected" : "disconnected" });
  },

  connect: async () => {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      await connectDrive();
      set({ status: "connected", busy: false });
    } catch (err) {
      set({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  disconnect: async () => {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      await disconnectDrive();
      set({ status: "disconnected", busy: false });
    } catch (err) {
      set({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
}));
