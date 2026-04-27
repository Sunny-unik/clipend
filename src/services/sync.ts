import { emit } from "@tauri-apps/api/event";
import type { Clip } from "../types/clip";
import { useClipStore } from "../store/clipStore";
import { useSettingsStore } from "../store/settingsStore";
import { useSyncStore, type SyncStatus } from "../store/syncStore";
import { getSupabase } from "./supabase";

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
 * Schedule a sync tick. Coalesces overlapping calls so rapid-fire mutations
 * (e.g. paste 5 clips in a second) don't spawn 5 concurrent push/pulls.
 */
export function requestSync(): void {
  if (!currentUserId) return;
  if (inFlight) return;
  inFlight = syncOnce()
    .catch(() => {})
    .finally(() => {
      inFlight = null;
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
    file_path: c.filePath,
    file_name: c.fileName,
    is_pinned: c.isPinned ? 1 : 0,
    is_favorite: c.isFavorite ? 1 : 0,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

export async function pushPending(userIdArg?: string): Promise<number> {
  const supabase = getSupabase();
  const userId = userIdArg ?? currentUserId;
  if (!supabase || !userId) return 0;

  const clips = await getUnsyncedClips();
  if (clips.length > 0) {
    const payload = clips.map((c) => clipToRemote(c, userId));
    const { error } = await supabase.from("clips").upsert(payload);
    if (error) throw new Error(`push clips: ${error.message}`);
    for (const c of clips) {
      await markClipSynced(c.id, c.updatedAt);
    }
  }

  const dirty = await getUnsyncedSettings(SYNCED_SETTING_KEY_LIST);
  if (dirty.length > 0) {
    // Always send the full whitelisted blob so the cloud row is a
    // complete snapshot — partial blobs would lose any whitelisted key
    // that isn't currently dirty.
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
      file_path: row.file_path,
      file_name: row.file_name,
      remote_image_url: row.remote_image_url,
      is_pinned: row.is_pinned,
      is_favorite: row.is_favorite,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    if (result === "applied") clipsTouched = true;
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
