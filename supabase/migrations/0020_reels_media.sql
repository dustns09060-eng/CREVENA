-- STEP 39: AI Reels Maker V1
--
-- 1. contents.platform gains 'REELS' — the reels project itself (scene list,
--    trims, captions, caption style, target duration, generation state) is
--    stored in contents.generation_input jsonb exactly like NAVER_BLOG's
--    BlogMeta, so no new project table is needed.
-- 2. collaboration_videos: a new table, NOT a rename/extension of
--    collaboration_photos, because video needs materially different
--    metadata (duration/width/height/aspect ratio) and has no photo_type.
--    Mirrors collaboration_photos' shape/RLS/ownership pattern exactly.
-- 3. A new private "collaboration-videos" Storage bucket, isolated the same
--    way as "collaboration-photos" (RLS keyed on the top-level folder =
--    auth.uid()). Kept separate from collaboration-photos instead of mixing
--    large video blobs into the existing photo bucket, so photo-only
--    tooling/limits are unaffected and video-specific size policy can be
--    tuned independently later.

alter table public.contents drop constraint if exists contents_platform_check;

alter table public.contents add constraint contents_platform_check check (platform in (
  'INSTAGRAM_FEED', 'INSTAGRAM_REELS_CAPTION', 'INSTAGRAM_REELS_SUBTITLE',
  'NAVER_BLOG_TITLE', 'NAVER_BLOG_BODY', 'NAVER_BLOG',
  'THREADS', 'COMMENT_REPLY', 'DM_REPLY', 'REELS'
));

create table if not exists public.collaboration_videos (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.collaborations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,

  storage_path text not null,
  original_filename text,
  mime_type text,
  file_size_bytes bigint,

  -- populated client-side from the browser's <video> metadata API right
  -- after upload — no server-side probing/ffmpeg involved.
  duration_seconds numeric,
  width int,
  height int,

  display_order int not null default 0,

  -- STEP39 item 6: never the raw video — 2-3 representative frame
  -- descriptions from the existing Vision analysis path, as a JSON array of
  -- {timestampSeconds, description}.
  frame_analysis jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collaboration_videos_collaboration_id_idx
  on public.collaboration_videos(collaboration_id, display_order);

drop trigger if exists set_updated_at on public.collaboration_videos;
create trigger set_updated_at before update on public.collaboration_videos
  for each row execute function public.set_updated_at();

alter table public.collaboration_videos enable row level security;

drop policy if exists "users manage own collaboration_videos" on public.collaboration_videos;
create policy "users manage own collaboration_videos" on public.collaboration_videos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: private bucket, objects keyed as "<user_id>/<collaboration_id>/<file>",
-- identical isolation pattern to collaboration-photos (0003). Videos are
-- uploaded directly browser -> Storage under the user's own session (RLS
-- enforces the path prefix), never through a server action/API route, since
-- they can be tens of MB and Vercel server action/function body limits do
-- not comfortably fit that.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('collaboration-videos', 'collaboration-videos', false, 104857600) -- 100MB
on conflict (id) do nothing;

drop policy if exists "users manage own collaboration videos in storage" on storage.objects;
create policy "users manage own collaboration videos in storage" on storage.objects
  for all
  using (bucket_id = 'collaboration-videos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'collaboration-videos' and (storage.foldername(name))[1] = auth.uid()::text);
