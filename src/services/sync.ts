import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { Clip } from "../types/clip";
import { useClipStore } from "../store/clipStore";
import { useSettingsStore } from "../store/settingsStore";
import { useSyncStore, type SyncStatus } from "../store/syncStore";
import { getSupabase } from "./supabase";

const FILES_BUCKET = "clips-files";

/**
 * Per-file ceiling for cloud sync. Anything larger stays local-only.
 * Keeps the unsynced badge on the clip so the user knows it didn't go
 * up. Tune this if you want — it's a soft cap on egress cost more
 * than a technical limit.
 */
const MAX_SYNCED_FILE_BYTES = 25 * 1024 * 1024;

/** Path inside the bucket: clips-files/{user_id}/{clip_id} */
function clipObjectPath(userId: string, clipId: string): string {
  return `${userId}/${clipId}`;
}

/** Crude content-type guess from extension. Used only as a hint to
 * the storage server; clients re-derive on download from file_name. */
function guessContentType(fileName: string | null): string {
  if (!fileName) return "application/octet-stream";
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

/**
 * Cross-window broadcast of sync state. The sync ticker only runs in the
 * main window, but the AccountTab lives in the Settings webview — which has
 * its own (empty) syncStore. This event lets that other window mirror our
 * state. Payload is the full SyncStateSnapshot below.
 */
export const SYNC_STATE_EVENT = "clipend:sync-state";

export interface SyncStateSnapshot {
  status: SyncStatus;
  lastPullAt: number | null;
  pendingCount: number;
  error: string | null;
}

function broadcastSyncState(): void {
  const s = useSyncStore.getState();
  const snapshot: SyncStateSnapshot = {
    status: s.status,
    lastPullAt: s.lastPullAt,
    pendingCount: s.pendingCount,
    error: s.error,
  };
  // Fire-and-forget — losing a state ping only delays the AccountTab
  // refresh, never breaks anything.
  emit(SYNC_STATE_EVENT, snapshot).catch(() => {});
}
import {
  clipExists,
  getDatabase,
  getSettingsMap,
  getUnsyncedClips,
  getUnsyncedSettings,
  markClipSynced,
  markSettingSynced,
  setClipLocalFilePath,
  setClipRemoteImageUrl,
  upsertClipFromRemote,
  upsertSettingFromRemote,
} from "./database";

const TICK_MS = 30_000;

/**
 * Settings whitelisted for cross-device sync. Anything else (auth tokens,
 * device-local UX flags like loginPromptDismissed, internal sync bookkeeping)
 * stays local — pushing them would either leak credentials or stomp the
 * other device's local-only state.
 */
export const SYNCED_SETTING_KEYS = ["toggleShortcut", "deleteClipShortcut"] as const;
const SYNCED_SETTING_KEY_LIST: string[] = [...SYNCED_SETTING_KEYS];
const SYNCED_SETTING_KEY_SET = new Set<string>(SYNCED_SETTING_KEY_LIST);

let currentUserId: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let focusListener: (() => void) | null = null;
let inFlight: Promise<void> | null = null;

function isSettingSyncable(key: string): boolean {
  return SYNCED_SETTING_KEY_SET.has(key);
}

export function isSyncRunning(): boolean {
  return currentUserId !== null;
}

export function getCurrentSyncUserId(): string | null {
  return currentUserId;
}

/**
 * Schedule a sync tick. Coalesces overlapping calls so rapid-fire
 * mutations don't spawn concurrent push/pulls. Becomes a no-op while
 * we're in error/offline state — the user has to hit Retry. This
 * stops a single permanent failure (404, bad RLS, dropped network)
 * from spamming the network on every clipboard copy and every focus.
 */
export function requestSync(): void {
  if (!currentUserId) return;
  if (inFlight) return;
  const status = useSyncStore.getState().status;
  if (status === "error" || status === "offline") return;
  inFlight = syncOnce()
    .catch(() => {})
    .finally(() => {
      inFlight = null;
    });
}

/**
 * Manual retry — bypasses the error/offline gate. Unlimited: each click
 * runs a fresh attempt regardless of how many previous attempts have
 * failed. On success, the periodic ticker resumes and the Retry button
 * disappears; on failure, the user can simply click again.
 */
export function retrySync(): void {
  if (!currentUserId) return;
  if (inFlight) return;
  inFlight = syncOnce()
    .catch(() => {})
    .finally(() => {
      inFlight = null;
      // Re-arm the periodic ticker iff the retry left us in a healthy
      // state. Otherwise stay paused until the next manual retry.
      const status = useSyncStore.getState().status;
      if (status === "idle" && !timer && currentUserId) {
        timer = setInterval(requestSync, TICK_MS);
      }
    });
}

export function startSync(userId: string): void {
  if (currentUserId === userId) return;
  stopSync();
  currentUserId = userId;
  // Initial pass: push anything queued from before sign-in, then pull.
  requestSync();
  timer = setInterval(requestSync, TICK_MS);
  focusListener = () => requestSync();
  window.addEventListener("focus", focusListener);
}

export function stopSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (focusListener) window.removeEventListener("focus", focusListener);
  focusListener = null;
  currentUserId = null;
  useSyncStore.getState().reset();
}

async function syncOnce(): Promise<void> {
  const supabase = getSupabase();
  const userId = currentUserId;
  if (!supabase || !userId) return;

  const sync = useSyncStore.getState();
  sync.setStatus("syncing");
  broadcastSyncState();
  try {
    const pushedClips = await pushPending(userId);
    await pullAll(userId);
    // pullAll already reloads clips when it applied a remote change,
    // but a successful push without any remote update needs its own
    // reload so the UI's per-clip syncedAt picks up the new value
    // and the unsynced badge clears.
    if (pushedClips > 0) {
      await useClipStore.getState().loadClips(true);
    }
    sync.setStatus("idle");
    sync.setLastPullAt(Date.now());
    sync.setError(null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[sync] tick failed:", message);
    sync.setError(message);
    sync.setStatus(navigator.onLine ? "error" : "offline");
    // Pause the periodic ticker on the first failure — manual Retry
    // button reactivates it. Without this, a permanent failure
    // (404, revoked token, dead network) re-fires the same broken
    // request every 30s and on every focus.
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  } finally {
    await refreshPendingCount();
    broadcastSyncState();
  }
}

async function refreshPendingCount(): Promise<void> {
  try {
    const db = await getDatabase();
    const [{ n: clipPending }] = await db.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM clips WHERE synced_at IS NULL OR updated_at > synced_at"
    );
    const placeholders = SYNCED_SETTING_KEY_LIST
      .map((_, i) => `$${i + 1}`)
      .join(",");
    const [{ n: settingPending }] = await db.select<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM settings
       WHERE key IN (${placeholders})
         AND (synced_at IS NULL OR updated_at > synced_at)`,
      SYNCED_SETTING_KEY_LIST
    );
    useSyncStore.getState().setPendingCount(clipPending + settingPending);
  } catch {
    // Best-effort; don't let a count failure mask a successful sync.
  }
}

function clipToRemote(c: Clip, userId: string) {
  return {
    id: c.id,
    user_id: userId,
    content: c.content,
    html_content: c.htmlContent,
    title: c.title,
    content_hash: c.contentHash,
    clip_type: c.clipType,
    // We deliberately don't push file_path: it's a device-local absolute
    // path (e.g. C:\Users\sunny\AppData\...\images\synced_xyz.png) and
    // would be meaningless on another machine. Each device sets its own
    // file_path locally after it downloads the image from Storage.
    file_path: null,
    file_name: c.fileName,
    remote_image_url: c.remoteImageUrl,
    is_pinned: c.isPinned ? 1 : 0,
    is_favorite: c.isFavorite ? 1 : 0,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

/** Image and file clips both have a binary blob worth syncing. Text
 * clips don't (their full content is in the row already). */
function hasSyncableBlob(c: Clip): boolean {
  return (
    (c.clipType === "image" || c.clipType === "file") &&
    !!c.filePath
  );
}

/**
 * Generate a short-lived signed URL the user can copy/share. The
 * bucket is private so getPublicUrl-style URLs don't actually work
 * unauthenticated — the storage SDK has to mint a token URL on the
 * fly. Returns null if the clip has no uploaded blob, the user is
 * signed out, or the request fails.
 */
export async function createClipSignedUrl(
  clipId: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const supabase = getSupabase();
  const userId = currentUserId;
  if (!supabase || !userId) return null;
  const objectPath = clipObjectPath(userId, clipId);
  const { data, error } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds);
  if (error || !data?.signedUrl) {
    console.warn(`[sync] sign url for ${objectPath} failed:`, error?.message);
    return null;
  }
  return data.signedUrl;
}

/**
 * Upload a local clip blob (image, copied file, anything with a
 * file_path) to Supabase Storage. Mutates the clip's remoteImageUrl in
 * place so the subsequent upsert payload carries it. The column is
 * named remote_image_url for legacy reasons but holds the URL for any
 * synced blob, not just images.
 */
async function uploadClipFile(c: Clip, userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  if (!hasSyncableBlob(c)) return;
  // Already uploaded — nothing to do.
  if (c.remoteImageUrl) return;

  const bytes = await invoke<number[]>("read_clip_file_bytes", {
    path: c.filePath as string,
  });
  if (bytes.length > MAX_SYNCED_FILE_BYTES) {
    throw new Error(
      `file ${c.fileName ?? c.id} is ${bytes.length} bytes, exceeds ${MAX_SYNCED_FILE_BYTES}-byte cap`
    );
  }
  const contentType = guessContentType(c.fileName);
  const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
  const objectPath = clipObjectPath(userId, c.id);
  const { error } = await supabase.storage
    .from(FILES_BUCKET)
    .upload(objectPath, blob, { contentType, upsert: true });
  if (error) throw new Error(`upload ${objectPath}: ${error.message}`);

  const { data } = supabase.storage.from(FILES_BUCKET).getPublicUrl(objectPath);
  c.remoteImageUrl = data.publicUrl;
}

/**
 * Best-effort: ensure the clip's blob exists locally. If we have a
 * remote URL but no local file (different device, cache cleared,
 * etc.), download from Storage and write into our cache dir, then
 * update file_path.
 */
async function downloadClipFileIfMissing(
  c: Clip,
  userId: string
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  if ((c.clipType !== "image" && c.clipType !== "file") || !c.remoteImageUrl) {
    return;
  }

  if (c.filePath) {
    const exists = await invoke<boolean>("clip_file_exists", {
      path: c.filePath,
    });
    if (exists) return;
  }

  const objectPath = clipObjectPath(userId, c.id);
  const { data, error } = await supabase.storage
    .from(FILES_BUCKET)
    .download(objectPath);
  if (error || !data) {
    // Don't throw — a single missing blob shouldn't fail the whole
    // pull. Card renders broken; next tick retries.
    console.warn(`[sync] download ${objectPath} failed:`, error?.message);
    return;
  }
  const buf = await data.arrayBuffer();
  const localPath = await invoke<string>("save_clip_file_bytes", {
    clipId: c.id,
    fileName: c.fileName ?? "blob",
    bytes: Array.from(new Uint8Array(buf)),
  });
  await setClipLocalFilePath(c.id, localPath);
}

export async function pushPending(userIdArg?: string): Promise<number> {
  const supabase = getSupabase();
  const userId = userIdArg ?? currentUserId;
  if (!supabase || !userId) return 0;

  const clips = await getUnsyncedClips();
  if (clips.length > 0) {
    // Upload binary blobs (images + copied files) first so the row we
    // push already carries the remote URL. Per-clip failures don't
    // block the rest of the push: text-only clips and successfully-
    // uploaded image/file clips still go up; the failed one stays
    // dirty and is retried on the next tick.
    for (const c of clips) {
      if (hasSyncableBlob(c) && !c.remoteImageUrl) {
        try {
          await uploadClipFile(c, userId);
          if (c.remoteImageUrl) {
            await setClipRemoteImageUrl(c.id, c.remoteImageUrl, c.updatedAt);
          }
        } catch (err) {
          console.warn(`[sync] blob upload failed for ${c.id}:`, err);
          continue;
        }
      }
    }
    const payload = clips
      .filter((c) => !(hasSyncableBlob(c) && !c.remoteImageUrl))
      .map((c) => clipToRemote(c, userId));
    if (payload.length > 0) {
      const { error } = await supabase.from("clips").upsert(payload);
      if (error) throw new Error(`push clips: ${error.message}`);
      for (const c of clips) {
        if (hasSyncableBlob(c) && !c.remoteImageUrl) continue;
        await markClipSynced(c.id, c.updatedAt);
      }
    }
  }

  // Settings push is isolated: a settings failure (e.g. cloud schema
  // out of date — settings table missing) shouldn't fail the whole
  // sync and roll back the clip push, which is the user's primary
  // concern. Log the error so the user still sees it surfaced in the
  // syncStore, but don't throw.
  try {
    const dirty = await getUnsyncedSettings(SYNCED_SETTING_KEY_LIST);
    if (dirty.length > 0) {
      // Always send the full whitelisted blob so the cloud row is a
      // complete snapshot — partial blobs would lose any whitelisted
      // key that isn't currently dirty.
      const value = await getSettingsMap(SYNCED_SETTING_KEY_LIST);
      const updatedAt = Math.max(...dirty.map((d) => d.updated_at));
      const { error } = await supabase
        .from("settings")
        .upsert({ user_id: userId, value, updated_at: updatedAt });
      if (error) throw new Error(`push settings: ${error.message}`);
      for (const key of SYNCED_SETTING_KEY_LIST) {
        await markSettingSynced(key, updatedAt);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[sync] settings push failed (clips still synced):", message);
    useSyncStore.getState().setError(message);
  }

  return clips.length;
}

export async function pullAll(userIdArg?: string): Promise<void> {
  const supabase = getSupabase();
  const userId = userIdArg ?? currentUserId;
  if (!supabase || !userId) return;

  const [clipsRes, settingsRes, deletesRes] = await Promise.all([
    supabase.from("clips").select("*").eq("user_id", userId),
    supabase
      .from("settings")
      .select("value, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("deleted_clips").select("clip_id, deleted_at").eq("user_id", userId),
  ]);
  if (clipsRes.error) throw new Error(`pull clips: ${clipsRes.error.message}`);
  if (settingsRes.error) throw new Error(`pull settings: ${settingsRes.error.message}`);
  if (deletesRes.error) throw new Error(`pull deletes: ${deletesRes.error.message}`);

  let clipsTouched = false;
  for (const row of clipsRes.data ?? []) {
    const result = await upsertClipFromRemote({
      id: row.id,
      content: row.content,
      html_content: row.html_content,
      title: row.title,
      content_hash: row.content_hash,
      clip_type: row.clip_type,
      // The cloud row's file_path is from another device — useless here.
      // Keep file_path null until downloadClipImageIfMissing fills it in
      // with this device's local cache path.
      file_path: null,
      file_name: row.file_name,
      remote_image_url: row.remote_image_url,
      is_pinned: row.is_pinned,
      is_favorite: row.is_favorite,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    if (result === "applied") clipsTouched = true;

    // Download the blob if this clip type carries one (image or file)
    // and we don't already have it locally. Best-effort — failures
    // are logged in the helper, so the next tick can retry without
    // blocking the rest of the pull.
    if (
      (row.clip_type === "image" || row.clip_type === "file") &&
      row.remote_image_url
    ) {
      const synthetic: Clip = {
        id: row.id,
        content: row.content,
        htmlContent: row.html_content,
        title: row.title,
        contentHash: row.content_hash,
        clipType: row.clip_type,
        filePath: row.file_path,
        fileName: row.file_name,
        isPinned: row.is_pinned === 1,
        isFavorite: row.is_favorite === 1,
        folderId: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        syncedAt: row.updated_at,
        remoteImageUrl: row.remote_image_url,
      };
      await downloadClipFileIfMissing(synthetic, userId);
      // downloadClipFileIfMissing may have updated file_path; mark
      // touched so the store reloads and the card finds the new path.
      clipsTouched = true;
    }
  }

  // Settings is now a single JSONB blob per user; iterate the keys
  // inside the value object and apply each through per-key LWW. Filter
  // by the whitelist on the way in so a malicious or stale cloud row
  // can't push a key we'd never deliberately sync (e.g. sb.auth).
  let settingsTouched = false;
  if (settingsRes.data) {
    const blob = (settingsRes.data.value ?? {}) as Record<string, unknown>;
    const updatedAt = settingsRes.data.updated_at as number;
    for (const [key, value] of Object.entries(blob)) {
      if (!isSettingSyncable(key)) continue;
      if (typeof value !== "string") continue;
      const result = await upsertSettingFromRemote(key, value, updatedAt);
      if (result === "applied") settingsTouched = true;
    }
  }

  // Apply deletion log: hard-delete local rows whose tombstone says they're
  // gone. We trust the tombstone — if the user re-copied the same content it
  // would already have a different id locally.
  const db = await getDatabase();
  for (const row of deletesRes.data ?? []) {
    if (await clipExists(row.clip_id)) {
      await db.execute("DELETE FROM clips WHERE id = $1", [row.clip_id]);
      clipsTouched = true;
    }
  }

  if (clipsTouched) {
    await useClipStore.getState().loadClips(true);
  }
  if (settingsTouched) {
    await useSettingsStore.getState().loadSettings();
  }
}

/**
 * Mark a clip as deleted on the server. Inserts a tombstone in
 * deleted_clips (so other devices learn about the delete) and removes the
 * row from public.clips (so it doesn't pull back next tick). Best-effort —
 * a network failure here just means the delete propagates on a later tick.
 */
export async function deleteRemote(clipId: string): Promise<void> {
  const supabase = getSupabase();
  const userId = currentUserId;
  if (!supabase || !userId) return;

  try {
    const tombstone = {
      user_id: userId,
      clip_id: clipId,
      deleted_at: Date.now(),
    };
    const { error: e1 } = await supabase
      .from("deleted_clips")
      .upsert(tombstone);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await supabase
      .from("clips")
      .delete()
      .eq("user_id", userId)
      .eq("id", clipId);
    if (e2) throw new Error(e2.message);
  } catch (err) {
    console.warn("[sync] deleteRemote failed:", err);
    useSyncStore.getState().setError(
      err instanceof Error ? err.message : String(err)
    );
  }
}
