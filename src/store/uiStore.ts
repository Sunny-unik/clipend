import { create } from "zustand";

/**
 * Tracks how many modal-style overlays are currently mounted, so the
 * global keyboard hook can know whether to skip Esc/Enter/Delete (which
 * a modal usually owns). A counter rather than a boolean lets nested or
 * fast-replaced modals stack cleanly without one early-unmount turning
 * the flag off while another is still open.
 */
interface UiStore {
  modalCount: number;
  pushModal: () => void;
  popModal: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  modalCount: 0,
  pushModal: () => set((s) => ({ modalCount: s.modalCount + 1 })),
  popModal: () =>
    set((s) => ({ modalCount: Math.max(0, s.modalCount - 1) })),
}));

export function isModalOpen(): boolean {
  return useUiStore.getState().modalCount > 0;
}
