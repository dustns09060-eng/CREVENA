-- STEP53 PRECHECK — READ ONLY. One SELECT.
-- Run in the Supabase SQL Editor BEFORE supabase/migrations/0035_product_shorts_plans.sql.
-- Development first. Do not run against Production until Development is verified.

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, '신규 테이블이 아직 없음' as check_name,
         (select count(*)::text from information_schema.tables
          where table_schema = 'public' and table_name = 'product_shorts_plans') as result,
         '0' as expected
  union all
  select 2, '전제: product_shorts_projects / product_shorts_media 존재',
         (select count(*)::text from information_schema.tables
          where table_schema = 'public' and table_name in ('product_shorts_projects', 'product_shorts_media')),
         '2'
  union all
  select 3, '전제: product_shorts_projects (id, user_id) UNIQUE 존재 (복합 FK 대상)',
         (select count(*)::text from pg_constraint
          where conrelid = 'public.product_shorts_projects'::regclass and contype = 'u'),
         '1'
  union all
  select 4, '전제: public.set_updated_at() 함수 존재',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'set_updated_at'),
         '1'
  union all
  select 5, '기존 product_shorts_projects 행 수 (기록해 두세요: 적용 후에도 같아야 함)',
         (select count(*)::text from public.product_shorts_projects),
         (select count(*)::text from public.product_shorts_projects)
  union all
  select 6, '기존 product_shorts_media 행 수 (기록해 두세요)',
         (select count(*)::text from public.product_shorts_media),
         (select count(*)::text from public.product_shorts_media)
  union all
  select 7, '기존 users 행 수 (기록해 두세요)',
         (select count(*)::text from public.users), (select count(*)::text from public.users)
) c
order by n;
