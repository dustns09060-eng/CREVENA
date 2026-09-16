-- STEP 9 combined Naver Blog title+body into a single content platform ("NAVER_BLOG"),
-- but 0001 only allowed the split NAVER_BLOG_TITLE / NAVER_BLOG_BODY values.
-- Add NAVER_BLOG as a valid value (keep the split ones for future use).

alter table public.contents drop constraint if exists contents_platform_check;

alter table public.contents add constraint contents_platform_check check (platform in (
  'INSTAGRAM_FEED', 'INSTAGRAM_REELS_CAPTION', 'INSTAGRAM_REELS_SUBTITLE',
  'NAVER_BLOG_TITLE', 'NAVER_BLOG_BODY', 'NAVER_BLOG',
  'THREADS', 'COMMENT_REPLY', 'DM_REPLY'
));
