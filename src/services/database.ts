import Database from "@tauri-apps/plugin-sql";
import type { Clip, ClipRow } from "../types/clip";
import { clipFromRow } from "../types/clip";

let db: Database | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  title TEXT,
  content_hash TEXT NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(content_hash);
CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_folder ON clips(folder_id);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

INSERT OR IGNORE INTO schema_version VALUES (1);
`;

export async function initDatabase(): Promise<Database> {
  if (db) return db;
  db = await Database.load("sqlite:clipend.db");
  // Run schema creation (IF NOT EXISTS makes it safe to re-run)
  const statements = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.execute(stmt);
  }
  return db;
}

export async function getDatabase(): Promise<Database> {
  if (!db) return initDatabase();
  return db;
}

export async function insertClip(clip: Clip): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO clips (id, content, title, content_hash, is_pinned, is_favorite, folder_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      clip.id,
      clip.content,
      clip.title,
      clip.contentHash,
      clip.isPinned ? 1 : 0,
      clip.isFavorite ? 1 : 0,
      clip.folderId,
      clip.createdAt,
      clip.updatedAt,
    ]
  );
}

export interface GetClipsOptions {
  limit?: number;
  offset?: number;
  folderId?: string | null;
  filter?: "all" | "favorites" | "pinned";
  search?: string;
}

export async function getClips(opts: GetClipsOptions = {}): Promise<Clip[]> {
  const database = await getDatabase();
  const { limit = 50, offset = 0, folderId, filter = "all", search } = opts;

  const conditions: string[] = [];
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (folderId !== undefined && folderId !== null) {
    conditions.push(`folder_id = $${paramIndex}`);
    params.push(folderId);
    paramIndex++;
  }

  if (filter === "favorites") {
    conditions.push("is_favorite = 1");
  } else if (filter === "pinned") {
    conditions.push("is_pinned = 1");
  }

  if (search && search.trim()) {
    conditions.push(`(content LIKE $${paramIndex} OR title LIKE $${paramIndex})`);
    params.push(`%${search.trim()}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await database.select<ClipRow[]>(
    `SELECT * FROM clips ${whereClause} ORDER BY is_pinned DESC, updated_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, limit, offset]
  );

  return rows.map(clipFromRow);
}

export async function deleteClip(id: string): Promise<void> {
  const database = await getDatabase();
  await database.execute("DELETE FROM clips WHERE id = $1", [id]);
}

export async function updateClip(id: string, updates: Partial<Clip>): Promise<void> {
  const database = await getDatabase();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  let paramIndex = 1;

  if (updates.content !== undefined) {
    sets.push(`content = $${paramIndex}`);
    params.push(updates.content);
    paramIndex++;
  }
  if (updates.title !== undefined) {
    sets.push(`title = $${paramIndex}`);
    params.push(updates.title);
    paramIndex++;
  }
  if (updates.contentHash !== undefined) {
    sets.push(`content_hash = $${paramIndex}`);
    params.push(updates.contentHash);
    paramIndex++;
  }
  if (updates.isPinned !== undefined) {
    sets.push(`is_pinned = $${paramIndex}`);
    params.push(updates.isPinned ? 1 : 0);
    paramIndex++;
  }
  if (updates.isFavorite !== undefined) {
    sets.push(`is_favorite = $${paramIndex}`);
    params.push(updates.isFavorite ? 1 : 0);
    paramIndex++;
  }
  if (updates.folderId !== undefined) {
    sets.push(`folder_id = $${paramIndex}`);
    params.push(updates.folderId);
    paramIndex++;
  }
  if (updates.updatedAt !== undefined) {
    sets.push(`updated_at = $${paramIndex}`);
    params.push(updates.updatedAt);
    paramIndex++;
  }

  if (sets.length === 0) return;

  await database.execute(
    `UPDATE clips SET ${sets.join(", ")} WHERE id = $${paramIndex}`,
    [...params, id]
  );
}

export async function findClipByHash(hash: string): Promise<Clip | null> {
  const database = await getDatabase();
  const rows = await database.select<ClipRow[]>(
    "SELECT * FROM clips WHERE content_hash = $1 ORDER BY updated_at DESC LIMIT 1",
    [hash]
  );
  return rows.length > 0 ? clipFromRow(rows[0]) : null;
}

export async function getClipCount(): Promise<number> {
  const database = await getDatabase();
  const result = await database.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM clips"
  );
  return result[0]?.count ?? 0;
}
