-- STEP 41: AI Carousel Maker V1
--
-- The carousel project (card list, template, aspect ratio, guide snapshot)
-- lives in contents.generation_input jsonb for a new platform='CAROUSEL'
-- row — the exact same pattern STEP36/STEP39 established for BlogMeta and
-- ReelsProject. No new table: cards reference collaboration_photos.id
-- directly and reuse its existing display_order/ai_analysis columns, so
-- there is nothing else to migrate.

alter table public.contents drop constraint if exists contents_platform_check;

alter table public.contents add constraint contents_platform_check check (platform in (
  'INSTAGRAM_FEED', 'INSTAGRAM_REELS_CAPTION', 'INSTAGRAM_REELS_SUBTITLE',
  'NAVER_BLOG_TITLE', 'NAVER_BLOG_BODY', 'NAVER_BLOG',
  'THREADS', 'COMMENT_REPLY', 'DM_REPLY', 'REELS', 'CAROUSEL'
));
