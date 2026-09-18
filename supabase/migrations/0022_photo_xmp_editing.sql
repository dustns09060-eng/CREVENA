-- STEP43.5: XMP preset photo editing.
--
-- collaboration_photos gets nullable "edited derivative" metadata so a
-- correction can be applied without ever touching the original
-- storage_path/thumbnail_path (existing rows get NULLs here and keep
-- behaving exactly as before). photo_presets is a new user-owned table so a
-- parsed XMP preset (never the raw XMP XML) can be reused across
-- collaborations, following the same user_id + RLS(auth.uid()) pattern as
-- every other table in 0001_init_schema.sql.

alter table public.collaboration_photos
  add column if not exists edited_storage_path text,
  add column if not exists edited_thumbnail_path text,
  add column if not exists edit_preset_name text,
  add column if not exists edit_intensity smallint check (edit_intensity is null or edit_intensity between 0 and 100);

-- ---------------------------------------------------------------------------
-- photo_presets: a user's saved, reusable XMP-derived adjustment settings.
-- settings stores only the parsed/supported adjustment values (never the
-- original XMP XML) — see STEP43.5 report item 4 for why.
-- ---------------------------------------------------------------------------
create table if not exists public.photo_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  preset_name text not null check (length(trim(preset_name)) > 0),
  source_filename text,
  settings jsonb not null check (settings <> '{}'::jsonb),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, preset_name)
);

create index if not exists photo_presets_user_id_idx on public.photo_presets(user_id);

drop trigger if exists set_updated_at on public.photo_presets;
create trigger set_updated_at before update on public.photo_presets
  for each row execute function public.set_updated_at();

alter table public.photo_presets enable row level security;

drop policy if exists "users manage own photo presets" on public.photo_presets;
create policy "users manage own photo presets" on public.photo_presets
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
