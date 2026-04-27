-- Clipend — Supabase schema
-- Run this once in the Supabase SQL editor after creating a new project.
-- It creates the clips/settings/deleted_clips tables, row-level-security
-- policies that scope every row to its owner, and enables realtime on all
-- three tables so devices can subscribe to each other's changes.

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
-- postgres_changes events on insert/update/delete.
alter publication supabase_realtime add table public.clips;
alter publication supabase_realtime add table public.settings;
alter publication supabase_realtime add table public.deleted_clips;

-- Storage bucket for image clips (Phase 3). Create it via the Supabase
-- dashboard (Storage → New bucket → name: "clips-images", public = false),
-- then run the policies below.
--
-- create policy "own image reads" on storage.objects for select
--   using (bucket_id = 'clips-images' and auth.uid()::text = (storage.foldername(name))[1]);
-- create policy "own image writes" on storage.objects for insert
--   with check (bucket_id = 'clips-images' and auth.uid()::text = (storage.foldername(name))[1]);
-- create policy "own image deletes" on storage.objects for delete
--   using (bucket_id = 'clips-images' and auth.uid()::text = (storage.foldername(name))[1]);
