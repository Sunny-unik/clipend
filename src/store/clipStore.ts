import { create } from "zustand";
import { nanoid } from "nanoid";
import type { Clip } from "../types/clip";
import {
  insertClip,
  getClips,
  deleteClip,
  updateClip,
  findClipByHash,
  type GetClipsOptions,
} from "../services/database";
import { hashContent } from "../utils/hash";

interface ClipStore {
  clips: Clip[];
  selectedClipId: string | null;
  searchQuery: string;
  activeFilter: "all" | "favorites" | "pinned";
  activeFolderId: string | null;
  isLoading: boolean;
  hasMore: boolean;
  skipNextEvent: boolean;

  addClip: (text: string) => Promise<void>;
  removeClip: (id: string) => Promise<void>;
  loadClips: (reset?: boolean) => Promise<void>;
  setSearch: (query: string) => void;
  setFilter: (filter: "all" | "favorites" | "pinned") => void;
  setFolder: (folderId: string | null) => void;
  setSelectedClip: (id: string | null) => void;
  setSkipNextEvent: (skip: boolean) => void;
}

const PAGE_SIZE = 50;

export const useClipStore = create<ClipStore>((set, get) => ({
  clips: [],
  selectedClipId: null,
  searchQuery: "",
  activeFilter: "all",
  activeFolderId: null,
  isLoading: false,
  hasMore: true,
  skipNextEvent: false,

  addClip: async (text: string) => {
    const contentHash = await hashContent(text);

    // Check for duplicate
    const existing = await findClipByHash(contentHash);
    if (existing) {
      // Bump the existing clip to the top
      const now = Date.now();
      await updateClip(existing.id, { updatedAt: now });
      const updatedClip = { ...existing, updatedAt: now };
      set((state) => ({
        clips: [updatedClip, ...state.clips.filter((c) => c.id !== existing.id)],
      }));
      return;
    }

    const now = Date.now();
    const clip: Clip = {
      id: nanoid(),
      content: text.length > 102400 ? text.slice(0, 102400) : text, // Cap at 100KB
      title: null,
      contentHash,
      isPinned: false,
      isFavorite: false,
      folderId: null,
      createdAt: now,
      updatedAt: now,
    };

    await insertClip(clip);
    set((state) => ({ clips: [clip, ...state.clips] }));
  },

  removeClip: async (id: string) => {
    await deleteClip(id);
    set((state) => ({
      clips: state.clips.filter((c) => c.id !== id),
      selectedClipId: state.selectedClipId === id ? null : state.selectedClipId,
    }));
  },

  loadClips: async (reset = false) => {
    const state = get();
    if (state.isLoading) return;

    set({ isLoading: true });

    const offset = reset ? 0 : state.clips.length;
    const opts: GetClipsOptions = {
      limit: PAGE_SIZE,
      offset,
      filter: state.activeFilter,
      search: state.searchQuery || undefined,
      folderId: state.activeFolderId,
    };

    const newClips = await getClips(opts);

    set((prev) => ({
      clips: reset ? newClips : [...prev.clips, ...newClips],
      hasMore: newClips.length === PAGE_SIZE,
      isLoading: false,
    }));
  },

  setSearch: (query: string) => {
    set({ searchQuery: query, clips: [], hasMore: true });
    get().loadClips(true);
  },

  setFilter: (filter) => {
    set({ activeFilter: filter, clips: [], hasMore: true });
    get().loadClips(true);
  },

  setFolder: (folderId) => {
    set({ activeFolderId: folderId, clips: [], hasMore: true });
    get().loadClips(true);
  },

  setSelectedClip: (id) => set({ selectedClipId: id }),

  setSkipNextEvent: (skip) => set({ skipNextEvent: skip }),
}));
