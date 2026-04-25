import { create } from "zustand";

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

interface SyncStore {
  status: SyncStatus;
  /** Wall-clock ms of the last successful pullAll. */
  lastPullAt: number | null;
  /** Number of local rows still waiting to push. Updated by sync.ts. */
  pendingCount: number;
  /** Last error message; cleared on the next successful tick. */
  error: string | null;

  setStatus: (status: SyncStatus) => void;
  setLastPullAt: (ts: number | null) => void;
  setPendingCount: (n: number) => void;
  setError: (err: string | null) => void;
  reset: () => void;
}

export const useSyncStore = create<SyncStore>((set) => ({
  status: "idle",
  lastPullAt: null,
  pendingCount: 0,
  error: null,

  setStatus: (status) => set({ status }),
  setLastPullAt: (lastPullAt) => set({ lastPullAt }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setError: (error) => set({ error }),
  reset: () =>
    set({ status: "idle", lastPullAt: null, pendingCount: 0, error: null }),
}));
