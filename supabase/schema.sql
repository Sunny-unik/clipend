-- Clipend — Supabase schema
-- Run this in the Supabase SQL editor whenever the schema changes.
-- The whole script is idempotent — re-running on an existing project
-- is safe.
--
-- Supabase only stores metadata: clip rows, settings (JSON blob per
-- user), and a deletion log. Actual file blobs (images, copied files)
-- live in each user's own Google Drive — see src/services/googleDrive.ts.
-- No Storage buckets or storage.objects policies are needed here.

create table if not exists public.clips (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  html_content text,
  title text,
  content_hash text not null,
  clip_type text not null default 'text',
  file_path text,
  file_name text,
  remote_image_url text,
  is_pinned int not null default 0,
  is_favorite int not null default 0,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists clips_user_updated_idx
  on public.clips(user_id, updated_at desc);
alter table public.clips enable row level security;
drop policy if exists "own clips" on public.clips;
create policy "own clips" on public.clips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Settings are stored as a single JSONB blob per user. Clipend is a
-- single-user app (multi-device for one person, not collaborative), so
-- per-key conflict resolution would be theatre — the rare case where
-- the same user changes the same setting on two devices simultaneously
-- is not worth the schema overhead. The blob LWW by updated_at is fine.
--
-- Re-running this on a project that has the OLD per-key table will
-- replace it; data in that table is dropped. There are no production
-- users yet, so this is safe.
drop table if exists public.settings;
create table public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  value jsonb not null default '{}'::jsonb,
  updated_at bigint not null
);
alter table public.settings enable row level security;
drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.deleted_clips (
  user_id uuid not null references auth.users(id) on delete cascade,
  clip_id text not null,
  deleted_at bigint not null,
  primary key (user_id, clip_id)
);
alter table public.deleted_clips enable row level security;
drop policy if exists "own deletions" on public.deleted_clips;
create policy "own deletions" on public.deleted_clips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Enable realtime publication for all three tables so clients get
-- postgres_changes events on insert/update/delete. Wrapped in DO
-- blocks because `alter publication ... add table` raises 42710
-- (duplicate_object) on re-run if the table is already a member,
-- and Postgres has no `add table if not exists` for publications.
do $$ begin
  alter publication supabase_realtime add table public.clips;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.settings;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.deleted_clips;
exception when duplicate_object then null; end $$;

-- Drop the legacy storage policies from the previous Supabase Storage
-- backend. Idempotent — if these never existed (fresh project), the
-- statements no-op. If you migrated from a build that used the
-- "clips-files" bucket, this also lets you safely delete that bucket
-- in the dashboard without leaving orphaned policies behind.
drop policy if exists "own clip file reads" on storage.objects;
drop policy if exists "own clip file writes" on storage.objects;
drop policy if exists "own clip file updates" on storage.objects;
drop policy if exists "own clip file deletes" on storage.objects;
-- And the even-older image-only names from the original Phase 3 plan.
drop policy if exists "own image reads" on storage.objects;
drop policy if exists "own image writes" on storage.objects;
drop policy if exists "own image updates" on storage.objects;
drop policy if exists "own image deletes" on storage.objects;
