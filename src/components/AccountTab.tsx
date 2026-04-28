import { useEffect } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { useAuthStore } from "../store/authStore";
import { useSyncStore, type SyncStatus } from "../store/syncStore";
import {
  SYNC_STATE_EVENT,
  retrySync,
  type SyncStateSnapshot,
} from "../services/sync";

/**
 * Settings webview asks main to run a sync — the actual ticker only
 * lives there. Main listens for this event in App.tsx.
 */
const SYNC_RETRY_EVENT = "clipend:sync-retry";

function formatRelative(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function syncLabel(
  status: SyncStatus,
  lastPullAt: number | null,
  pendingCount: number
): string {
  if (status === "syncing") return "Syncing…";
  if (status === "offline") return "Offline — will retry";
  if (status === "error") return "Sync failed — will retry";
  if (pendingCount > 0) return `${pendingCount} change${pendingCount === 1 ? "" : "s"} pending`;
  if (lastPullAt) return `Last synced ${formatRelative(lastPullAt)}`;
  return "Waiting for first sync";
}

export function AccountTab() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const error = useAuthStore((s) => s.error);
  const signIn = useAuthStore((s) => s.signIn);
  const signOut = useAuthStore((s) => s.signOut);
  const syncStatus = useSyncStore((s) => s.status);
  const lastPullAt = useSyncStore((s) => s.lastPullAt);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const syncError = useSyncStore((s) => s.error);

  // Sync ticker runs only in the main window. Mirror its broadcast state
  // into this webview's syncStore so the UI here stays accurate.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<SyncStateSnapshot>(SYNC_STATE_EVENT, (event) => {
      const s = useSyncStore.getState();
      s.setStatus(event.payload.status);
      s.setLastPullAt(event.payload.lastPullAt);
      s.setPendingCount(event.payload.pendingCount);
      s.setError(event.payload.error);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  if (status === "disabled") {
    return (
      <div className="settings-row settings-col">
        <p className="settings-note">
          Cloud sync isn't configured for this build. The maintainer needs to
          set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>{" "}
          before building to enable sign-in.
        </p>
      </div>
    );
  }

  if (status === "loading") {
    return <div className="settings-row">Checking sign-in state…</div>;
  }

  if (status === "signed-out") {
    return (
      <div className="settings-col">
        <p className="settings-note">
          Sign in with Google to sync your clips and settings across devices.
        </p>
        <button
          className="settings-btn settings-btn--primary"
          style={{ alignSelf: "flex-start" }}
          onClick={() => signIn()}
        >
          Sign in with Google
        </button>
        {error && <p className="settings-error">{error}</p>}
      </div>
    );
  }

  // signed-in
  const name =
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email ??
    "Signed in";
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  return (
    <div className="settings-col">
      <div className="account-card">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="account-avatar" />
        ) : (
          <div className="account-avatar account-avatar--placeholder" />
        )}
        <div className="account-info">
          <div className="account-name">{name}</div>
          {user?.email && <div className="account-email">{user.email}</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <p className="settings-note" style={{ margin: 0 }}>
          {syncLabel(syncStatus, lastPullAt, pendingCount)}
        </p>
        {/* Enable only when there's actual work — pending clips, or
            we're in error/offline so the user can retry the failed
            pull. Disabled when everything's already in sync, since
            clicking it would just re-run a no-op tick. */}
        <button
          className="settings-btn"
          disabled={
            syncStatus === "syncing" ||
            (pendingCount === 0 &&
              syncStatus !== "error" &&
              syncStatus !== "offline")
          }
          onClick={() => {
            // Settings webview can't drive the sync directly — only
            // the main window owns the ticker. Ask main to run one;
            // the broadcast back updates this UI's status/pending count.
            retrySync();
            emit(SYNC_RETRY_EVENT).catch(() => {});
          }}
        >
          {syncStatus === "syncing"
            ? "Syncing…"
            : syncStatus === "error" || syncStatus === "offline"
              ? "Retry"
              : "Sync now"}
        </button>
      </div>
      <button
        className="settings-btn"
        style={{ alignSelf: "flex-start" }}
        onClick={() => signOut()}
      >
        Sign out
      </button>
      {error && <p className="settings-error">{error}</p>}
      {syncError && syncStatus !== "syncing" && (
        <p className="settings-error">Sync: {syncError}</p>
      )}
    </div>
  );
}
