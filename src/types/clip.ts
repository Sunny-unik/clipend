export interface Clip {
  id: string;
  content: string;
  title: string | null;
  contentHash: string;
  isPinned: boolean;
  isFavorite: boolean;
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  sortOrder: number;
}

export interface AppSettings {
  geminiApiKey: string | null;
  defaultAiPrompt: string;
  maxHistorySize: number;
  pollingIntervalMs: number;
  theme: "light" | "dark" | "system";
}

export interface ClipRow {
  id: string;
  content: string;
  title: string | null;
  content_hash: string;
  is_pinned: number;
  is_favorite: number;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}

export function clipFromRow(row: ClipRow): Clip {
  return {
    id: row.id,
    content: row.content,
    title: row.title,
    contentHash: row.content_hash,
    isPinned: row.is_pinned === 1,
    isFavorite: row.is_favorite === 1,
    folderId: row.folder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
