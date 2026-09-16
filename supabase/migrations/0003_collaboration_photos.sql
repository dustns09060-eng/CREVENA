-- STEP 16: photo-based blog content
-- - collaboration_photos: uploaded photos, AI vision analysis, per-photo memo/body, display order
-- - ai_usage_logs: append-only log of AI calls (vision + text) for future cost/quota tracking
-- - private Storage bucket, isolated per user via a user_id-prefixed path + storage RLS

create table if not exists public.collaboration_photos (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.collaborations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,

  storage_path text not null,
  thumbnail_path text not null,
  original_filename text,

  display_order int not null default 0,
  photo_type text check (photo_type in (
    'PRODUCT_ALONE', 'PACKAGE', 'COMPONENTS', 'DETAIL', 'USAGE', 'KID_USAGE', 'FINAL_SHOT', 'OTHER'
  )),
  ai_analysis text,
  user_memo text,
  body_section text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collaboration_photos_collaboration_id_idx
  on public.collaboration_photos(collaboration_id, display_order);

drop trigger if exists set_updated_at on public.collaboration_photos;
create trigger set_updated_at before update on public.collaboration_photos
  for each row execute function public.set_updated_at();

alter table public.collaboration_photos enable row level security;

drop policy if exists "users manage own collaboration_photos" on public.collaboration_photos;
create policy "users manage own collaboration_photos" on public.collaboration_photos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- ai_usage_logs: append-only, for future usage-based quotas/billing
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  collaboration_id uuid references public.collaborations(id) on delete set null,

  feature text not null check (feature in ('VISION_ANALYSIS', 'TEXT_GENERATION')),
  provider text not null,
  model text,
  unit_count int not null default 1,

  created_at timestamptz not null default now()
);

create index if not exists ai_usage_logs_user_id_idx on public.ai_usage_logs(user_id, created_at);

alter table public.ai_usage_logs enable row level security;

drop policy if exists "users manage own ai_usage_logs" on public.ai_usage_logs;
create policy "users manage own ai_usage_logs" on public.ai_usage_logs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: private bucket, objects keyed as "<user_id>/<collaboration_id>/<file>"
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('collaboration-photos', 'collaboration-photos', false)
on conflict (id) do nothing;

drop policy if exists "users manage own collaboration photos in storage" on storage.objects;
create policy "users manage own collaboration photos in storage" on storage.objects
  for all
  using (bucket_id = 'collaboration-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'collaboration-photos' and (storage.foldername(name))[1] = auth.uid()::text);
