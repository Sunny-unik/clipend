import { openUrl } from "@tauri-apps/plugin-opener";
import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

const REDIRECT_URL = "clipend://auth-callback";

/**
 * Cross-window notification that the auth state just changed. Every window
 * listens so its local authStore (each webview has its own JS runtime and
 * its own Zustand state) can re-pull the session from shared storage.
 */
export const AUTH_CHANGED_EVENT = "clipend:auth-changed";

export class SyncNotConfiguredError extends Error {
  constructor() {
    super("Supabase URL and anon key are not configured for this build.");
  }
}

/**
 * Kick off the Google OAuth flow. Opens the system browser, lets the user
 * sign in, and returns early — the session is installed asynchronously when
 * the deep-link handler fires `handleCallbackUrl`.
 */
export async function signInWithGoogle(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new SyncNotConfiguredError();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: REDIRECT_URL,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error("Supabase did not return an OAuth URL");

  await openUrl(data.url);
}

/**
 * Called by the deep-link listener when Clipend is resumed via
 * `clipend://auth-callback?code=...`. Exchanges the PKCE code for a session.
 */
export async function handleCallbackUrl(urlString: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new SyncNotConfiguredError();

  const url = new URL(urlString);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (error) throw new Error(decodeURIComponent(error));
  if (!code) throw new Error("OAuth callback missing 'code' parameter");

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
  // Notify other windows (Settings, Tooltip) to refresh their auth state.
  // We pass the whole Session in the payload because each webview has its
  // own in-memory Supabase client that won't auto-rehydrate from storage.
  await emit(AUTH_CHANGED_EVENT, data.session);
  // Belt-and-suspenders: close the Settings window if it's open. The window
  // also has its own listener for AUTH_CHANGED_EVENT but doing it here too
  // guarantees the UI drops back to the signed-in main panel.
  try {
    const settings = await WebviewWindow.getByLabel("settings");
    if (settings) {
      setTimeout(() => {
        settings.close().catch((err) =>
          console.warn("[auth] failed to close settings window:", err)
        );
      }, 300);
    }
  } catch (err) {
    console.warn("[auth] settings lookup failed:", err);
  }
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
  await emit(AUTH_CHANGED_EVENT, null);
}

export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser(): Promise<User | null> {
  const session = await getSession();
  return session?.user ?? null;
}

/**
 * Subscribe to auth state changes. Caller gets an unsubscribe function.
 */
export function onAuthStateChange(
  handler: (session: Session | null) => void
): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    handler(session);
  });
  return () => data.subscription.unsubscribe();
}
