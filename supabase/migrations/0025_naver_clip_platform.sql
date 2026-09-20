-- STEP 46: NAVER CLIP Content Workflow V1
--
-- Adds 'NAVER_CLIP' to contents.platform, exactly following the pattern
-- STEP39 (0020, 'REELS') and STEP41 (0021, 'CAROUSEL') established: the
-- Naver Clip project (scene list, per-scene caption/duration, trims,
-- caption style, target duration, publish-copy text, hashtags, guide
-- snapshot, generation state) is stored in contents.generation_input
-- jsonb on a single platform='NAVER_CLIP' row per collaboration. No new
-- table, no new Storage bucket: scenes reference the existing
-- collaboration_photos.id / collaboration_videos.id rows and reuse their
-- existing display_order / ai_analysis / frame_analysis columns.
--
-- WHY THIS MIGRATION IS REQUIRED AT ALL:
--   contents.platform carries a CHECK constraint (0001, last rewritten by
--   0021). Inserting platform='NAVER_CLIP' without this migration fails
--   with a check-constraint violation, so the app cannot persist a Naver
--   Clip project until this is applied.
--
-- WHY NOTHING ELSE NEEDS MIGRATING:
--   collaborations.upload_platforms is `text[] not null default '{}'` with
--   NO check constraint / enum / domain (0001 line 45). The set of
--   selectable upload platforms and "제작할 콘텐츠" values is validated
--   purely app-side in TypeScript, so adding NAVER_CLIP there needs no DDL.
--
-- DATA SEPARATION (STEP46 item 4):
--   Because a Naver Clip project lives on its own platform='NAVER_CLIP'
--   row, it is physically separate from the platform='REELS' row for the
--   same collaboration. Generating a Naver Clip can therefore never
--   overwrite an existing Reels project — the separation is structural,
--   not a convention the app has to remember.
--
-- PRODUCT RULE: this migration adds a content-storage value only. CREVENA
-- does not upload or publish to Naver. There is no Naver OAuth token,
-- API key, credential or publish-state column here, deliberately.
--
-- SAFETY: this is a pure constraint widening. It only ever ACCEPTS more
-- values than before; no existing row can become invalid, no data is
-- rewritten, no column is dropped or retyped. It is therefore backwards
-- compatible with the currently deployed app (which simply never writes
-- the new value). The drop+add pair is not transactional-safe to run
-- concurrently with heavy writes to contents, so apply it during a quiet
-- window; the re-add revalidates every existing row in contents.
--
-- ROLLBACK: re-run 0021's constraint definition (the list below minus
-- 'NAVER_CLIP') AFTER deleting any rows that already use the new value:
--   delete from public.contents where platform = 'NAVER_CLIP';
--
-- OPERATOR STEPS (this file is NOT auto-applied by this change):
--   1. Run supabase/scripts/0025_precheck.sql  (READ ONLY) and record output.
--   2. Apply this file.
--   3. Run supabase/scripts/0025_postcheck.sql (READ ONLY) and compare.

alter table public.contents drop constraint if exists contents_platform_check;

alter table public.contents add constraint contents_platform_check check (platform in (
  'INSTAGRAM_FEED', 'INSTAGRAM_REELS_CAPTION', 'INSTAGRAM_REELS_SUBTITLE',
  'NAVER_BLOG_TITLE', 'NAVER_BLOG_BODY', 'NAVER_BLOG',
  'THREADS', 'COMMENT_REPLY', 'DM_REPLY', 'REELS', 'CAROUSEL', 'NAVER_CLIP'
));
