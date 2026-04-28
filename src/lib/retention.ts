import { getDatabase } from "../services/database";
import { useClipStore } from "../store/clipStore";

/**
 * Auto-delete clips older than this. Pinned and favorited clips are
 * preserved regardless — the user explicitly marked them as "keep."
 */
const RETENTION_DAYS = 7;

/**
 * How often to run the sweep while the app is open. Runs once
 * immediately on startup too. 6 hours is well below the 7-day
 * retention window so users running the app continuously still get
 * cleanup, without spamming the DB.
 */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Find clips older than RETENTION_DAYS that aren't pinned or favorited
 * and remove them. Goes through useClipStore.removeClips so cloud
 * sync (tombstone + Storage cleanup) and UI state stay consistent.
 */
export async function runRetentionSweep(): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const db = await getDatabase();
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM clips
     WHERE created_at < $1
       AND is_pinned = 0
       AND is_favorite = 0`,
    [cutoff]
  );
  if (rows.length === 0) return;
  console.log(
    `[retention] removing ${rows.length} clips older than ${RETENTION_DAYS} days`
  );
  await useClipStore
    .getState()
    .removeClips(rows.map((r) => r.id));
}

export function startRetentionTicker(): void {
  if (timer) return;
  // Initial sweep — catches clips that aged out while the app was
  // closed.
  runRetentionSweep().catch((err) =>
    console.warn("[retention] initial sweep failed:", err)
  );
  timer = setInterval(() => {
    runRetentionSweep().catch((err) =>
      console.warn("[retention] sweep failed:", err)
    );
  }, SWEEP_INTERVAL_MS);
}

export function stopRetentionTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
