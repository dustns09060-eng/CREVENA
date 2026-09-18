-- STEP46 PRECHECK — READ ONLY. SELECT statements only.
--
-- NOT a migration. This directory (supabase/scripts/) is never applied by
-- `supabase db push` / `supabase migration up`, which only read
-- supabase/migrations/. Run this by hand in the Supabase SQL Editor
-- BEFORE applying supabase/migrations/0025_naver_clip_platform.sql.
--
-- Contains no INSERT/UPDATE/DELETE/ALTER/DROP. Outputs the constraint
-- definition and row counts only — never title, body, generation_input,
-- emails or any other user content/identifier.

-- 1) Current definition of the constraint the migration rewrites.
--    Expected BEFORE: the 0021 list, i.e. ... 'REELS', 'CAROUSEL'
--    and NO 'NAVER_CLIP'.
select
  con.conname                    as constraint_name,
  pg_get_constraintdef(con.oid)  as definition,
  position('NAVER_CLIP' in pg_get_constraintdef(con.oid)) > 0
                                 as already_has_naver_clip
from pg_constraint con
join pg_class rel      on rel.oid = con.conrelid
join pg_namespace ns   on ns.oid  = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname = 'contents'
  and con.conname = 'contents_platform_check';

-- 2) Confirm collaborations.upload_platforms really is unconstrained, i.e.
--    that NO second migration is needed for the platform selector.
--    Expected BEFORE and AFTER: data_type = ARRAY, and zero check
--    constraints naming upload_platforms.
select column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'collaborations'
  and column_name  = 'upload_platforms';

select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel    on rel.oid = con.conrelid
join pg_namespace ns on ns.oid  = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname = 'collaborations'
  and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%upload_platforms%';
-- Expected: ZERO rows. If this returns a row, the app-side-only assumption
-- in 0025's header is wrong and a second migration IS required.

-- 3) Baseline row counts per platform, so the postcheck can prove the
--    migration rewrote no data. Counts only, no content.
select platform, count(*) as row_count
from public.contents
group by platform
order by platform;

select count(*) as total_contents_rows from public.contents;

-- 4) Must be ZERO before the migration (the value cannot exist yet, since
--    the current constraint forbids it). A non-zero result means the
--    constraint was already widened out-of-band — stop and investigate.
select count(*) as existing_naver_clip_rows
from public.contents
where platform = 'NAVER_CLIP';

-- 5) Reels projects that must survive untouched (STEP46 item 36).
--    Record this number; the postcheck must return exactly the same one.
select count(*) as reels_project_rows
from public.contents
where platform = 'REELS';
