-- STEP46 POST-MIGRATION VERIFY — READ ONLY. SELECT statements only.
--
-- NOT a migration. Run by hand in the Supabase SQL Editor AFTER applying
-- supabase/migrations/0025_naver_clip_platform.sql, and compare each
-- result against the matching query in 0025_precheck.sql.
--
-- Contains no INSERT/UPDATE/DELETE/ALTER/DROP.

-- 1) The constraint must now accept NAVER_CLIP, and must still accept every
--    value 0021 allowed.
select
  con.conname                   as constraint_name,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel    on rel.oid = con.conrelid
join pg_namespace ns on ns.oid  = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname = 'contents'
  and con.conname = 'contents_platform_check';

-- Hard assertion: this must return ZERO rows. It lists any value that was
-- allowed by 0021 but is missing from the new constraint (i.e. an
-- accidental narrowing that would break Blog/Reels/Carousel saves).
with def as (
  select pg_get_constraintdef(con.oid) as d
  from pg_constraint con
  join pg_class rel    on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid  = rel.relnamespace
  where ns.nspname = 'public'
    and rel.relname = 'contents'
    and con.conname = 'contents_platform_check'
),
expected(v) as (values
  ('INSTAGRAM_FEED'),('INSTAGRAM_REELS_CAPTION'),('INSTAGRAM_REELS_SUBTITLE'),
  ('NAVER_BLOG_TITLE'),('NAVER_BLOG_BODY'),('NAVER_BLOG'),
  ('THREADS'),('COMMENT_REPLY'),('DM_REPLY'),('REELS'),('CAROUSEL'),('NAVER_CLIP')
)
select expected.v as missing_from_constraint, 'NARROWED - REGRESSION' as problem
from expected, def
where position(expected.v in def.d) = 0;

-- 2) The constraint must exist and be VALIDATED (not NOT VALID).
--    Expected: convalidated = true.
select con.conname, con.convalidated
from pg_constraint con
join pg_class rel    on rel.oid = con.conrelid
join pg_namespace ns on ns.oid  = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname = 'contents'
  and con.conname = 'contents_platform_check';

-- 3) No data was rewritten: these must match the precheck numbers EXACTLY
--    (NAVER_CLIP may newly appear once the app has been used, but every
--    pre-existing platform's count must be unchanged).
select platform, count(*) as row_count
from public.contents
group by platform
order by platform;

select count(*) as total_contents_rows from public.contents;

-- 4) STEP46 item 36 — existing Reels projects untouched. Must equal the
--    precheck's reels_project_rows.
select count(*) as reels_project_rows
from public.contents
where platform = 'REELS';

-- 5) Naver Blog projects untouched (STEP46 item 65 regression guard).
select count(*) as naver_blog_rows
from public.contents
where platform in ('NAVER_BLOG', 'NAVER_BLOG_TITLE', 'NAVER_BLOG_BODY');

-- 6) Confirm no Naver credential/token/publish-state column was added
--    anywhere by this step. Must return ZERO rows.
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (column_name ilike '%naver%token%'
    or column_name ilike '%naver%secret%'
    or column_name ilike '%naver%access%'
    or column_name ilike '%clip%upload%'
    or column_name ilike '%auto_publish%');
