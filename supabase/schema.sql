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

-- Storage bucket for clip blobs (images, copied files, anything with a
-- file_path). The bucket itself has to be created via the Supabase
-- dashboard (Storage → New bucket → name: "clips-files", public = off)
-- — Supabase doesn't expose bucket creation through plain SQL. While
-- you're there, set a sensible per-file size limit (e.g. 25 MB) so a
-- giant copied video doesn't blow your egress bill. Once the bucket
-- exists, the policies below restrict access so each user can only
-- touch files under their own {user_id}/ folder.
drop policy if exists "own clip file reads" on storage.objects;
create policy "own clip file reads" on storage.objects for select
  using (
    bucket_id = 'clips-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "own clip file writes" on storage.objects;
create policy "own clip file writes" on storage.objects for insert
  with check (
    bucket_id = 'clips-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "own clip file updates" on storage.objects;
create policy "own clip file updates" on storage.objects for update
  using (
    bucket_id = 'clips-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'clips-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "own clip file deletes" on storage.objects;
create policy "own clip file deletes" on storage.objects for delete
  using (
    bucket_id = 'clips-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
