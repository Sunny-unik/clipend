export type ClipType = "text" | "file" | "image";

export interface Clip {
  id: string;
  content: string;
  htmlContent: string | null;
  title: string | null;
  contentHash: string;
  clipType: ClipType;
  filePath: string | null;
  fileName: string | null;
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
  html_content: string | null;
  title: string | null;
  content_hash: string;
  clip_type: string | null;
  file_path: string | null;
  file_name: string | null;
  is_pinned: number;
  is_favorite: number;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "svg",
  "ico",
  "tiff",
  "tif",
  "avif",
  "heic",
  "heif",
]);

export function isImageFileName(name: string | null): boolean {
  if (!name) return false;
  const ext = name.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

export function clipFromRow(row: ClipRow): Clip {
  const rawType = row.clip_type as ClipType | null;
  const clipType: ClipType =
    rawType === "file" || rawType === "image" ? rawType : "text";
  return {
    id: row.id,
    content: row.content,
    htmlContent: row.html_content,
    title: row.title,
    contentHash: row.content_hash,
    clipType,
    filePath: row.file_path,
    fileName: row.file_name,
    isPinned: row.is_pinned === 1,
    isFavorite: row.is_favorite === 1,
    folderId: row.folder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
