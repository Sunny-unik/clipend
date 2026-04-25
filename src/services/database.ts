import Database from "@tauri-apps/plugin-sql";
import type { Clip, ClipRow } from "../types/clip";
import { clipFromRow } from "../types/clip";
import { DB_FILENAME } from "../lib/env";

export interface SettingRow {
  key: string;
  value: string;
  updated_at: number;
  synced_at: number | null;
}

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
  html_content TEXT,
  title TEXT,
  content_hash TEXT NOT NULL,
  clip_type TEXT NOT NULL DEFAULT 'text',
  file_path TEXT,
  file_name TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(content_hash);
CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_folder ON clips(folder_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

INSERT OR IGNORE INTO schema_version VALUES (1);
`;

const MIGRATIONS: string[] = [
  "ALTER TABLE clips ADD COLUMN clip_type TEXT NOT NULL DEFAULT 'text'",
  "ALTER TABLE clips ADD COLUMN file_path TEXT",
  "ALTER TABLE clips ADD COLUMN file_name TEXT",
  "ALTER TABLE clips ADD COLUMN html_content TEXT",
  // Phase-2 sync bookkeeping. synced_at NULL or < updated_at means "dirty".
  "ALTER TABLE clips ADD COLUMN synced_at INTEGER",
  "ALTER TABLE clips ADD COLUMN remote_image_url TEXT",
  "ALTER TABLE settings ADD COLUMN synced_at INTEGER",
];

async function runMigrations(database: Database): Promise<void> {
  for (const stmt of MIGRATIONS) {
    try {
      await database.execute(stmt);
    } catch {
      // Column already exists — safe to ignore.
    }
  }
}

export async function initDatabase(): Promise<Database> {
  if (db) return db;
  db = await Database.load(`sqlite:${DB_FILENAME}`);
  const statements = SCHEMA_SQL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.execute(stmt);
  }
  await runMigrations(db);
  return db;
}

export async function getDatabase(): Promise<Database> {
  if (!db) return initDatabase();
  return db;
}

export async function insertClip(clip: Clip): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO clips (id, content, html_content, title, content_hash, clip_type, file_path, file_name, is_pinned, is_favorite, folder_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      clip.id,
      clip.content,
      clip.htmlContent,
      clip.title,
      clip.contentHash,
      clip.clipType,
      clip.filePath,
      clip.fileName,
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
    conditions.push(
      `(content LIKE $${paramIndex} OR title LIKE $${paramIndex} OR file_name LIKE $${paramIndex})`
    );
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
  if (updates.htmlContent !== undefined) {
    sets.push(`html_content = $${paramIndex}`);
    params.push(updates.htmlContent);
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

/* ---------- settings (key-value) ---------- */

export async function getSetting(key: string): Promise<string | null> {
  const database = await getDatabase();
  const rows = await database.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key]
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, Date.now()]
  );
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const database = await getDatabase();
  const rows = await database.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM settings"
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function removeSetting(key: string): Promise<void> {
  const database = await getDatabase();
  await database.execute("DELETE FROM settings WHERE key = $1", [key]);
}

/* ---------- sync bookkeeping (Phase 2) ---------- */

/**
 * Clips with no synced_at, or whose updated_at is newer than synced_at —
 * i.e. the rows that need to be pushed to Supabase on the next tick.
 */
export async function getUnsyncedClips(): Promise<Clip[]> {
  const database = await getDatabase();
  const rows = await database.select<ClipRow[]>(
    "SELECT * FROM clips WHERE synced_at IS NULL OR updated_at > synced_at"
  );
  return rows.map(clipFromRow);
}

export async function getUnsyncedSettings(
  keys: string[]
): Promise<SettingRow[]> {
  if (keys.length === 0) return [];
  const database = await getDatabase();
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(",");
  return database.select<SettingRow[]>(
    `SELECT key, value, updated_at, synced_at FROM settings
     WHERE key IN (${placeholders})
       AND (synced_at IS NULL OR updated_at > synced_at)`,
    keys
  );
}

export async function markClipSynced(id: string, syncedAt: number): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    "UPDATE clips SET synced_at = $1 WHERE id = $2",
    [syncedAt, id]
  );
}

export async function markSettingSynced(
  key: string,
  syncedAt: number
): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    "UPDATE settings SET synced_at = $1 WHERE key = $2",
    [syncedAt, key]
  );
}

/**
 * Apply a clip received from Supabase. Last-write-wins by updated_at: if the
 * local row is newer (or equal), nothing happens — the local edit will be
 * pushed up on the next tick. Otherwise the row is overwritten and marked
 * already-synced so we don't immediately push it back.
 */
export async function upsertClipFromRemote(remote: {
  id: string;
  content: string;
  html_content: string | null;
  title: string | null;
  content_hash: string;
  clip_type: string;
  file_path: string | null;
  file_name: string | null;
  remote_image_url: string | null;
  is_pinned: number;
  is_favorite: number;
  created_at: number;
  updated_at: number;
}): Promise<"applied" | "skipped"> {
  const database = await getDatabase();
  const existing = await database.select<{ updated_at: number }[]>(
    "SELECT updated_at FROM clips WHERE id = $1",
    [remote.id]
  );
  if (existing.length > 0 && existing[0].updated_at >= remote.updated_at) {
    return "skipped";
  }
  await database.execute(
    `INSERT INTO clips
       (id, content, html_content, title, content_hash, clip_type,
        file_path, file_name, remote_image_url, is_pinned, is_favorite,
        folder_id, created_at, updated_at, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,$13)
     ON CONFLICT(id) DO UPDATE SET
       content = excluded.content,
       html_content = excluded.html_content,
       title = excluded.title,
       content_hash = excluded.content_hash,
       clip_type = excluded.clip_type,
       file_path = excluded.file_path,
       file_name = excluded.file_name,
       remote_image_url = excluded.remote_image_url,
       is_pinned = excluded.is_pinned,
       is_favorite = excluded.is_favorite,
       updated_at = excluded.updated_at,
       synced_at = excluded.synced_at`,
    [
      remote.id,
      remote.content,
      remote.html_content,
      remote.title,
      remote.content_hash,
      remote.clip_type,
      remote.file_path,
      remote.file_name,
      remote.remote_image_url,
      remote.is_pinned,
      remote.is_favorite,
      remote.created_at,
      remote.updated_at,
    ]
  );
  return "applied";
}

/**
 * Apply a setting received from Supabase. LWW by updated_at; on apply the
 * row is marked already-synced so the next push tick doesn't bounce it back.
 */
export async function upsertSettingFromRemote(
  key: string,
  value: string,
  updatedAt: number
): Promise<"applied" | "skipped"> {
  const database = await getDatabase();
  const existing = await database.select<{ updated_at: number }[]>(
    "SELECT updated_at FROM settings WHERE key = $1",
    [key]
  );
  if (existing.length > 0 && existing[0].updated_at >= updatedAt) {
    return "skipped";
  }
  await database.execute(
    `INSERT INTO settings (key, value, updated_at, synced_at)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at,
       synced_at = excluded.synced_at`,
    [key, value, updatedAt]
  );
  return "applied";
}

export async function clipExists(id: string): Promise<boolean> {
  const database = await getDatabase();
  const rows = await database.select<{ id: string }[]>(
    "SELECT id FROM clips WHERE id = $1",
    [id]
  );
  return rows.length > 0;
}
