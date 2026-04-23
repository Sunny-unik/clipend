import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSetting,
  removeSetting,
  setSetting,
} from "./database";

// Session/tokens/etc. are persisted into our SQLite `settings` table rather
// than webview localStorage so they survive reinstalls-to-same-profile and
// stay inside the user's local DB (the same place their clips live).
const sqliteStorage = {
  async getItem(key: string): Promise<string | null> {
    return await getSetting(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await setSetting(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await removeSetting(key);
  },
};

let client: SupabaseClient | null = null;

/**
 * Returns the shared Supabase client, or `null` if the build was not
 * configured with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Callers
 * should handle null as "cloud sync is disabled in this build".
 */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return null;

  client = createClient(url, key, {
    auth: {
      storage: sqliteStorage,
      storageKey: "sb.auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // we feed URLs in manually from the deep-link handler
      flowType: "pkce",
    },
  });
  return client;
}

export function isSupabaseConfigured(): boolean {
  return !!(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}
