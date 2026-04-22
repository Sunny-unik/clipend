// Single source of truth for per-environment storage names.
// Vite sets import.meta.env.DEV = true when running `tauri dev` (development
// build), false for `tauri build` (production). We use that to keep dev and
// prod state completely separate on disk, so experimenting in dev won't
// pollute the user's real clip history or settings.

const IS_DEV = import.meta.env.DEV;

export const DB_FILENAME = IS_DEV ? "clipend-dev.db" : "clipend.db";
export const SETTINGS_FILENAME = IS_DEV ? "settings-dev.json" : "settings.json";
