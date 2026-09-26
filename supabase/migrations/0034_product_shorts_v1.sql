-- STEP52 (feature-product-shorts-v1, Phase 3A): minimal data model for
-- "상품 판매 숏츠" — independent from collaborations by design (see the PR
-- report: product/shopping sellers using this feature have no sponsorship
-- collaboration at all, and collaboration_photos/collaboration_videos have
-- a NOT NULL collaboration_id that must not be weakened or reinterpreted).
--
-- Two new tables only. Nothing here touches collaborations, contents,
-- collaboration_photos, collaboration_videos, payment_events,
-- payment_refunds, users, or any existing RLS/FK/migration. Purely
-- additive.
--
-- ---------------------------------------------------------------------------
-- product_shorts_projects: one row per "상품 판매 숏츠" project. Mirrors the
-- existing generation_input jsonb pattern already used for Reels/Carousel/
-- Naver Clip (contents.generation_input) — product_source and reels_project
-- hold the structured state as jsonb instead of a wide flat schema, so this
-- feature can evolve its shape without a migration every time. No separate
-- `status` column: `reels_project is null` IS "not generated yet", avoiding
-- a second field that could drift out of sync with the real state.
-- ---------------------------------------------------------------------------
create table public.product_shorts_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  source_url text,          -- null when the user used the manual-entry fallback (no URL analyzed)
  source_host text,
  target_duration_seconds smallint not null check (target_duration_seconds in (15, 30)),

  product_source jsonb not null default '{}'::jsonb,  -- ProductSource (incl. evidence[])
  reels_project jsonb,      -- ReelsProject shape, reused as-is; null until first generation

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Lets product_shorts_media below declare a COMPOSITE foreign key on
  -- (project_id, user_id), not just project_id. `id` is already unique as
  -- the primary key, so this adds no new uniqueness guarantee by itself —
  -- it exists purely so Postgres can validate the (id, user_id) PAIR as a
  -- referenced target from the child table (see the media table's FK
  -- below and its comment for why this matters).
  unique (id, user_id)
);

create index product_shorts_projects_user_id_idx
  on public.product_shorts_projects(user_id, created_at);

drop trigger if exists set_updated_at on public.product_shorts_projects;
create trigger set_updated_at before update on public.product_shorts_projects
  for each row execute function public.set_updated_at();

alter table public.product_shorts_projects enable row level security;

drop policy if exists "users manage own product_shorts_projects" on public.product_shorts_projects;
create policy "users manage own product_shorts_projects" on public.product_shorts_projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- product_shorts_media: one row per photo/video attached to a project.
-- `media_type` lets photo and video coexist in one table (rather than two,
-- like collaboration_photos/collaboration_videos) specifically so adding
-- video support later needs no new table — only using the already-nullable
-- video-only columns below. V1 only ever inserts media_type = 'photo'.
--
-- Ownership integrity (the actual point of this comment): `user_id` here is
-- denormalized, same convention as collaboration_photos (which also stores
-- user_id alongside collaboration_id rather than relying on a join). A
-- denormalized column CAN drift from the truth if nothing stops it — e.g.
-- a caller inserting `project_id` = someone else's project with `user_id` =
-- their own id, which plain `user_id = auth.uid()` RLS alone does NOT catch
-- (RLS only checks the row being written against the CALLER's uid, it does
-- not check that project_id actually belongs to that same uid).
--
-- Fixed with a COMPOSITE foreign key instead of a plain one:
--   foreign key (project_id, user_id) references product_shorts_projects(id, user_id)
-- This is a real Postgres-enforced constraint, not an application check: an
-- INSERT/UPDATE can only succeed if a row in product_shorts_projects exists
-- whose (id, user_id) pair EXACTLY matches both of these columns together.
-- Supplying someone else's project_id with your own user_id has no matching
-- row to reference (that project's real (id, user_id) pair has a DIFFERENT
-- user_id), so Postgres rejects it with a foreign key violation before the
-- row is ever written — independent of RLS, independent of application
-- code. Verified empirically pre-merge with a real Postgres engine (PGlite)
-- attempting exactly this cross-user insert and observing the FK violation;
-- see the PR report's ownership-integrity test.
-- ---------------------------------------------------------------------------
create table public.product_shorts_media (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,

  media_type text not null check (media_type in ('photo', 'video')),
  storage_path text not null,
  thumbnail_path text,
  edited_storage_path text,     -- reserved for future XMP-style editing support (like collaboration_photos' 0022 columns); always NULL in V1
  edited_thumbnail_path text,
  ai_analysis text,             -- existing PHOTO_ANALYSIS result, when run
  frame_analysis jsonb,         -- video-only, unused in V1 (schema-ready only)

  original_filename text,
  display_order int not null default 0,
  duration_seconds numeric,     -- video-only
  width int,
  height int,
  mime_type text,
  file_size_bytes bigint,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (project_id, user_id)
    references public.product_shorts_projects(id, user_id)
    on delete cascade
);

create index product_shorts_media_project_id_idx
  on public.product_shorts_media(project_id, display_order);

drop trigger if exists set_updated_at on public.product_shorts_media;
create trigger set_updated_at before update on public.product_shorts_media
  for each row execute function public.set_updated_at();

alter table public.product_shorts_media enable row level security;

drop policy if exists "users manage own product_shorts_media" on public.product_shorts_media;
create policy "users manage own product_shorts_media" on public.product_shorts_media
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: private bucket, objects keyed as "<user_id>/<project_id>/<file>",
-- identical isolation pattern to collaboration-photos (0003) and
-- collaboration-videos (0020). File-type restriction follows this
-- project's existing convention (neither existing bucket sets
-- `allowed_mime_types`; the upload action itself pins `contentType`), so
-- none is set here either.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('product-shorts-media', 'product-shorts-media', false, 104857600) -- 100MB, same ceiling as collaboration-videos
on conflict (id) do nothing;

drop policy if exists "users manage own product shorts media in storage" on storage.objects;
create policy "users manage own product shorts media in storage" on storage.objects
  for all
  using (bucket_id = 'product-shorts-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'product-shorts-media' and (storage.foldername(name))[1] = auth.uid()::text);
