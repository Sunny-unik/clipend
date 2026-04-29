import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSetting, removeSetting, setSetting } from "./database";
import { useAuthStore } from "../store/authStore";

/**
 * Google Drive integration for per-user file sync.
 *
 * Each user grants Clipend access to their OWN Drive via PKCE OAuth.
 * Tokens live in this device's local SQLite (settings table, prefixed
 * `drive.*`) and are NEVER synced — they're per-device secrets.
 *
 * Architecture:
 *   - Auth: separate from Supabase. Loopback redirect (Google requires
 *     it for Desktop OAuth clients), PKCE so no client secret needed.
 *   - Storage path: every uploaded file lives in the user's Drive at
 *     `My Drive/Clipend/`. The folder id is cached locally; if the
 *     user deletes the folder we transparently recreate it.
 *   - Token refresh: access tokens expire in ~1h; refresh tokens are
 *     long-lived. We refresh on demand when we're within 60s of expiry
 *     or when an API call returns 401.
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID as
  | string
  | undefined;
// Google requires the client_secret on the token endpoint for
// "Desktop application" OAuth clients, even with PKCE. Per Google's
// docs this secret is treated as non-confidential for desktop apps —
// it's shipped to every user inside the binary. PKCE is what
// actually protects the auth code.
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_SECRET as
  | string
  | undefined;

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

// Dev builds use a separate Drive folder so testing doesn't pollute
// the user's prod folder (and the user's prod-app instance, if they
// have it installed alongside, keeps its own state). Same split as
// the SQLite db filename and the Tauri bundle identifier.
const FOLDER_NAME = import.meta.env.DEV ? "Clipend Dev" : "Clipend";

// SQLite settings keys are scoped by Supabase user id so multiple
// Google identities sharing a device don't stomp each other's tokens.
// All keys are local-only and never round-trip to Supabase (the
// settings whitelist in sync.ts excludes everything starting with
// "drive.").
function tokenKeys(supabaseUserId: string) {
  return {
    access: `drive.${supabaseUserId}.access_token`,
    refresh: `drive.${supabaseUserId}.refresh_token`,
    expires: `drive.${supabaseUserId}.expires_at`,
    folder: `drive.${supabaseUserId}.folder_id`,
  };
}

function currentSupabaseUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

export class DriveNotConfiguredError extends Error {
  constructor() {
    super("VITE_GOOGLE_DRIVE_CLIENT_ID is not set");
  }
}

export class DriveNotConnectedError extends Error {
  constructor() {
    super("Google Drive is not connected on this device");
  }
}

/* ───────── PKCE helpers ───────── */

/** RFC 7636 verifier: 43-128 unreserved chars. We use 64 random bytes
 * base64url-encoded → 86 chars of [A-Za-z0-9_-]. */
function randomVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ───────── token storage ───────── */

interface DriveTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

async function loadTokens(): Promise<DriveTokens | null> {
  const userId = currentSupabaseUserId();
  if (!userId) return null;
  const keys = tokenKeys(userId);
  const [access, refresh, expires] = await Promise.all([
    getSetting(keys.access),
    getSetting(keys.refresh),
    getSetting(keys.expires),
  ]);
  if (!access || !refresh || !expires) return null;
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: parseInt(expires, 10),
  };
}

async function saveTokens(tokens: DriveTokens): Promise<void> {
  const userId = currentSupabaseUserId();
  if (!userId) {
    throw new Error("can't save Drive tokens: no signed-in Supabase user");
  }
  const keys = tokenKeys(userId);
  await setSetting(keys.access, tokens.accessToken);
  await setSetting(keys.refresh, tokens.refreshToken);
  await setSetting(keys.expires, String(tokens.expiresAt));
}

async function clearTokens(): Promise<void> {
  const userId = currentSupabaseUserId();
  if (!userId) return;
  const keys = tokenKeys(userId);
  await removeSetting(keys.access);
  await removeSetting(keys.refresh);
  await removeSetting(keys.expires);
  await removeSetting(keys.folder);
}

/* ───────── public surface ───────── */

export function isDriveConfigured(): boolean {
  return (
    !!CLIENT_ID &&
    CLIENT_ID !== "your-client-id.apps.googleusercontent.com" &&
    !!CLIENT_SECRET &&
    CLIENT_SECRET !== "your-client-secret"
  );
}

export async function isDriveConnected(): Promise<boolean> {
  return !!(await loadTokens());
}

/**
 * Run the full OAuth flow: spin up a loopback listener, open the user's
 * browser, wait for the redirect, exchange code for tokens, persist.
 * Resolves when tokens are stored; rejects on user cancel / network
 * failure.
 */
export async function connectDrive(): Promise<void> {
  if (!isDriveConfigured()) throw new DriveNotConfiguredError();

  const verifier = randomVerifier();
  const challenge = await pkceChallenge(verifier);
  const port = await invoke<number>("start_drive_oauth_listener");
  const redirectUri = `http://127.0.0.1:${port}`;

  // Wait for the loopback listener to deliver the callback URL. We
  // attach the listener BEFORE opening the browser so we can't miss
  // a fast redirect.
  const callbackUrlPromise = new Promise<string>((resolve, reject) => {
    let unlisten: (() => void) | null = null;
    const timer = setTimeout(() => {
      unlisten?.();
      reject(new Error("OAuth flow timed out (5 minutes). Try again."));
    }, 5 * 60 * 1000);
    listen<string>("drive-oauth-callback", (event) => {
      clearTimeout(timer);
      unlisten?.();
      resolve(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
  });

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set("client_id", CLIENT_ID!);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  // offline + consent ensures we get a refresh_token. Without prompt=consent,
  // a returning user who already authorized may get back only the access
  // token, leaving us no way to refresh later.
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  await openUrl(authUrl.toString());
  const callbackUrl = await callbackUrlPromise;

  const url = new URL(callbackUrl);
  const error = url.searchParams.get("error");
  if (error) {
    throw new Error(
      `OAuth error: ${error} (${url.searchParams.get("error_description") ?? ""})`
    );
  }
  const code = url.searchParams.get("code");
  if (!code) throw new Error("OAuth callback missing 'code' parameter");

  // Exchange the code for tokens. PKCE: send the verifier; client
  // secret is also required by Google's token endpoint for the
  // Desktop client type even though the flow is PKCE.
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(
      `token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`
    );
  }
  const data = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  if (!data.refresh_token) {
    // Without a refresh token we'd be locked out in 1h. Refuse to
    // record a half-broken connection.
    throw new Error(
      "Google did not return a refresh token. Revoke Clipend at " +
        "myaccount.google.com → Security → Apps with access, then try again."
    );
  }
  await saveTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
}

/**
 * Forget local tokens AND best-effort revoke them with Google. Either
 * direction alone leaves a loose end (local-only: Google still has the
 * grant; remote-only: device still has stale tokens).
 */
export async function disconnectDrive(): Promise<void> {
  const tokens = await loadTokens();
  await clearTokens();
  if (!tokens) return;
  try {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(tokens.refreshToken)}`, {
      method: "POST",
    });
  } catch (err) {
    console.warn("[drive] revoke failed (tokens already cleared locally):", err);
  }
}

/* ───────── token refresh ───────── */

async function refreshAccessToken(): Promise<DriveTokens> {
  if (!isDriveConfigured()) throw new DriveNotConfiguredError();
  const tokens = await loadTokens();
  if (!tokens) throw new DriveNotConnectedError();

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // 400 invalid_grant means the refresh token is dead (user revoked,
    // password changed, 6mo unused, exceeded 50-token cap). Force a
    // local disconnect so the UI prompts a reconnect.
    if (res.status === 400) {
      console.warn("[drive] refresh token rejected — clearing local tokens:", body);
      await clearTokens();
    }
    throw new Error(`refresh failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  const next: DriveTokens = {
    accessToken: data.access_token,
    // Google sometimes rotates the refresh token. Keep the new one if
    // returned; otherwise stick with the old (still valid) one.
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await saveTokens(next);
  return next;
}

/** Returns a token good for at least the next 60 seconds. Refreshes
 * proactively if we're inside that window. */
async function getValidAccessToken(): Promise<string> {
  let tokens = await loadTokens();
  if (!tokens) throw new DriveNotConnectedError();
  if (Date.now() > tokens.expiresAt - 60_000) {
    tokens = await refreshAccessToken();
  }
  return tokens.accessToken;
}

/**
 * Wrapper around fetch that adds the Drive auth header and retries
 * once with a fresh token if Google says 401 — handles the case where
 * the token expires mid-flight or is revoked between our last refresh
 * and the call.
 */
async function driveFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getValidAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  let res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    headers.set("Authorization", `Bearer ${fresh.accessToken}`);
    res = await fetch(url, { ...init, headers });
  }
  return res;
}

/* ───────── folder management ───────── */

async function findClipendFolder(): Promise<string | null> {
  const q =
    "name='" +
    FOLDER_NAME +
    "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
  const res = await driveFetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`
  );
  if (!res.ok) {
    throw new Error(`find folder (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

async function createClipendFolder(): Promise<string> {
  const res = await driveFetch(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  if (!res.ok) {
    throw new Error(`create folder (${res.status}): ${await res.text()}`);
  }
  return ((await res.json()) as { id: string }).id;
}

/** Cached lookup with a self-heal fallback. If the user manually
 * deleted the folder, the cached id 404s on first use, we re-find or
 * recreate, and update the cache. Cache is per Supabase user so
 * switching users doesn't try to reuse the wrong folder. */
async function getOrCreateFolderId(): Promise<string> {
  const userId = currentSupabaseUserId();
  if (!userId) throw new DriveNotConnectedError();
  const folderKey = tokenKeys(userId).folder;
  const cached = await getSetting(folderKey);
  if (cached) {
    // Verify it still exists. A trashed folder reads as trashed=true,
    // a hard-deleted one 404s. Either way, force re-find.
    const verify = await driveFetch(
      `${DRIVE_API}/files/${cached}?fields=id,trashed`
    );
    if (verify.ok) {
      const data = (await verify.json()) as { trashed?: boolean };
      if (!data.trashed) return cached;
    }
    await removeSetting(folderKey);
  }
  const existing = await findClipendFolder();
  const id = existing ?? (await createClipendFolder());
  await setSetting(folderKey, id);
  return id;
}

/* ───────── file ops ───────── */

/** Upload bytes to the user's Clipend folder. Returns the Drive file
 * id, which the caller stores as the clip's remote_image_url. */
export async function uploadFile(
  fileName: string,
  bytes: Uint8Array,
  mimeType = "application/octet-stream"
): Promise<string> {
  const folderId = await getOrCreateFolderId();
  // Drive's multipart upload bundles metadata + body in one request.
  // Boundary chosen to be unguessable so a malicious filename can't
  // close it early.
  const boundary = `----clipend-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
  });
  const head = new TextEncoder().encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      metadata +
      `\r\n--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  const res = await driveFetch(
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!res.ok) {
    throw new Error(`upload (${res.status}): ${await res.text()}`);
  }
  return ((await res.json()) as { id: string }).id;
}

/**
 * Returns Drive's canonical web URL for the file (the one shown in
 * the Drive web app for "Open in new tab"). Includes the owner's
 * authuser hint so users with multiple Google accounts signed into
 * their browser don't land on a "wrong account, can't open" error.
 */
export async function getFileWebViewLink(
  fileId: string
): Promise<string | null> {
  const res = await driveFetch(
    `${DRIVE_API}/files/${fileId}?fields=webViewLink`
  );
  if (!res.ok) {
    console.warn(
      `[drive] webViewLink for ${fileId} failed (${res.status}):`,
      await res.text()
    );
    return null;
  }
  const data = (await res.json()) as { webViewLink?: string };
  return data.webViewLink ?? null;
}

export async function downloadFile(fileId: string): Promise<Uint8Array> {
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  if (!res.ok) {
    throw new Error(`download (${res.status}): ${await res.text()}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Hard-delete (skips Trash). Trashed files still count against the
 * user's Drive quota for 30 days, which we don't want for the auto
 * retention sweep — the whole point is to free quota.
 */
export async function deleteFile(fileId: string): Promise<void> {
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}`, {
    method: "DELETE",
  });
  // 404 = already gone, fine. Otherwise surface so the caller can log.
  if (!res.ok && res.status !== 404) {
    throw new Error(`delete (${res.status}): ${await res.text()}`);
  }
}
