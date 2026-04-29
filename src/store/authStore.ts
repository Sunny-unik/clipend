import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  AUTH_CHANGED_EVENT,
  getSession,
  onAuthStateChange,
  signInWithGoogle,
  signOut,
} from "../services/auth";
import { getSupabase, isSupabaseConfigured } from "../services/supabase";
import { getDatabase, getSetting, removeSetting, setSetting } from "../services/database";
import { startSync, stopSync } from "../services/sync";
import { useClipStore } from "./clipStore";

/**
 * Sync runs from a single webview only. We pick the main window because it's
 * always alive while the app is running, whereas Settings/Tooltip come and go.
 * Other webviews still get the auth state updates via AUTH_CHANGED_EVENT and
 * can read clips locally — they just don't drive the network ticker.
 */
function isSyncOwnerWindow(): boolean {
  try {
    return getCurrentWebviewWindow().label === "main";
  } catch {
    return false;
  }
}

function maybeStartSync(session: Session | null): void {
  if (!isSyncOwnerWindow()) return;
  if (session?.user?.id) startSync(session.user.id);
  else stopSync();
}

const LOGIN_PROMPT_DISMISSED_KEY = "loginPromptDismissed";
const LAST_USER_ID_KEY = "lastSignedInUserId";

/**
 * Wipe local-but-user-scoped data. Runs when a different Supabase
 * user signs in on a device that previously hosted another user.
 * Without this, User B sees User A's local clips and could even
 * push them up under their own account on the next sync tick.
 *
 * Drive tokens are already user-scoped (keyed by Supabase user id in
 * googleDrive.ts) so they don't need explicit cleanup — User B
 * simply has no tokens until they connect Drive themselves. We do
 * remove any LEGACY non-scoped Drive keys that may have been written
 * by an earlier build, in case the device was upgraded mid-flight.
 */
async function wipeForUserSwitch(): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM clips");
  await useClipStore.getState().loadClips(true);
  await Promise.all([
    removeSetting("drive.access_token"),
    removeSetting("drive.refresh_token"),
    removeSetting("drive.expires_at"),
    removeSetting("drive.folder_id"),
  ]);
}

type AuthStatus = "loading" | "signed-in" | "signed-out" | "disabled";

interface AuthStore {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  error: string | null;
  /** Whether the first-run sign-in overlay has been dismissed (or satisfied). */
  loginPromptDismissed: boolean;

  init: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  dismissLoginPrompt: () => Promise<void>;
  /** Re-show the first-run sign-in overlay (e.g. from the ⋯ menu). */
  showLoginPrompt: () => Promise<void>;
  /** Internal: called by the auth-state-change subscription. */
  _setSession: (session: Session | null) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  status: "loading",
  user: null,
  session: null,
  error: null,
  loginPromptDismissed: false,

  init: async () => {
    if (!isSupabaseConfigured()) {
      set({
        status: "disabled",
        user: null,
        session: null,
        // No sign-in available → treat the first-run prompt as dismissed so
        // the rest of the UI doesn't gate on it.
        loginPromptDismissed: true,
      });
      return;
    }
    try {
      const [session, dismissedRaw] = await Promise.all([
        getSession(),
        getSetting(LOGIN_PROMPT_DISMISSED_KEY),
      ]);
      const dismissed = dismissedRaw === "1";
      set({
        status: session ? "signed-in" : "signed-out",
        session,
        user: session?.user ?? null,
        // If a session exists, consider the prompt dismissed — user has
        // already been through the flow on this (or another) device.
        loginPromptDismissed: dismissed || !!session,
      });
      maybeStartSync(session);
      onAuthStateChange((session) => {
        useAuthStore.getState()._setSession(session);
      });

      // Cross-window sync: each webview has its own in-memory Supabase client
      // that does NOT auto-rehydrate from shared storage, so we receive the
      // full session as the event payload and feed it back into the local
      // client via setSession. On sign-out, the payload is null and we drop
      // the local session.
      const supabaseForSync = getSupabase();
      listen<Session | null>(AUTH_CHANGED_EVENT, async (event) => {
        console.log("[auth] cross-window event received", !!event.payload);
        if (!supabaseForSync) return;
        try {
          if (event.payload) {
            await supabaseForSync.auth.setSession({
              access_token: event.payload.access_token,
              refresh_token: event.payload.refresh_token,
            });
          } else {
            await supabaseForSync.auth.signOut({ scope: "local" });
          }
          const session = await getSession();
          console.log("[auth] cross-window session updated", !!session);
          useAuthStore.getState()._setSession(session);
        } catch (err) {
          console.warn("[auth] cross-window sync failed:", err);
        }
      });
    } catch (err) {
      console.error("[auth] init failed:", err);
      set({
        status: "signed-out",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  signIn: async () => {
    set({ error: null });
    try {
      await signInWithGoogle();
      // The overlay is also dismissed once the user has explicitly chosen to
      // sign in — the callback completes asynchronously via deep-link.
      await setSetting(LOGIN_PROMPT_DISMISSED_KEY, "1");
      set({ loginPromptDismissed: true });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  signOut: async () => {
    set({ error: null });
    try {
      await signOut();
      // Treat explicit sign-out as "back to fresh-install state" — undo the
      // dismissed flag so the LoginOverlay reappears on the main panel.
      await setSetting(LOGIN_PROMPT_DISMISSED_KEY, "0");
      set({
        status: "signed-out",
        user: null,
        session: null,
        loginPromptDismissed: false,
      });
      maybeStartSync(null);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  dismissLoginPrompt: async () => {
    await setSetting(LOGIN_PROMPT_DISMISSED_KEY, "1");
    set({ loginPromptDismissed: true });
  },

  showLoginPrompt: async () => {
    await setSetting(LOGIN_PROMPT_DISMISSED_KEY, "0");
    set({ loginPromptDismissed: false, error: null });
  },

  _setSession: (session) => {
    set((prev) => ({
      session,
      user: session?.user ?? null,
      status: session ? "signed-in" : "signed-out",
      // A successful auth flow implicitly satisfies the first-run prompt;
      // on sign-out we leave the previous value alone.
      loginPromptDismissed: session ? true : prev.loginPromptDismissed,
    }));
    maybeStartSync(session);

    // Detect a different user signing in on this device and wipe
    // user-scoped local state. Compares against the persisted
    // last-signed-in id rather than the previous in-memory user
    // because sign-out → sign-in-as-different-user goes through a
    // null intermediate state that would otherwise mask the switch.
    const newUserId = session?.user?.id ?? null;
    if (newUserId) {
      (async () => {
        const lastUserId = await getSetting(LAST_USER_ID_KEY);
        if (lastUserId && lastUserId !== newUserId) {
          await wipeForUserSwitch();
        }
        await setSetting(LAST_USER_ID_KEY, newUserId);
      })().catch((err) =>
        console.warn("[auth] user-switch handling failed:", err)
      );
    }
  },
}));
