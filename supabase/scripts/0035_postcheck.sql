-- STEP53 POSTCHECK — READ ONLY. One SELECT.
-- Run AFTER supabase/migrations/0035_product_shorts_plans.sql.
-- Every row's `ok` must be true. Rows 12-14 must match the numbers recorded from
-- 0035_precheck.sql rows 5-7.

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, '신규 테이블 존재' as check_name,
         (select count(*)::text from information_schema.tables
          where table_schema = 'public' and table_name = 'product_shorts_plans') as result,
         '1' as expected
  union all
  select 2, 'RLS 활성화',
         (select relrowsecurity::text from pg_class where oid = 'public.product_shorts_plans'::regclass),
         'true'
  union all
  select 3, 'RLS 정책 수 (본인 행만 SELECT/INSERT/UPDATE/DELETE)',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'product_shorts_plans'),
         '1'
  union all
  select 4, 'RLS 정책이 모든 명령(ALL)에 적용되고 user_id = auth.uid() 로 제한',
         (select cmd || ' / ' || qual from pg_policies
          where schemaname = 'public' and tablename = 'product_shorts_plans'),
         'ALL / (user_id = auth.uid())'
  union all
  select 5, '복합 FK (project_id, user_id) -> product_shorts_projects, ON DELETE CASCADE',
         (select confdeltype::text from pg_constraint
          where conrelid = 'public.product_shorts_plans'::regclass
            and contype = 'f' and array_length(conkey, 1) = 2),
         'c'
  union all
  select 6, 'user_id -> users FK, ON DELETE CASCADE',
         (select confdeltype::text from pg_constraint
          where conname = 'product_shorts_plans_user_id_fkey'
            and conrelid = 'public.product_shorts_plans'::regclass),
         'c'
  union all
  select 7, 'UNIQUE (project_id, label) 존재',
         (select count(*)::text from pg_constraint
          where conrelid = 'public.product_shorts_plans'::regclass and contype = 'u'),
         '1'
  union all
  select 8, 'label CHECK (A/B/C) 존재',
         (select count(*)::text from pg_constraint
          where conrelid = 'public.product_shorts_plans'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%label%'),
         '1'
  union all
  select 9, 'hook 길이 CHECK 존재',
         (select count(*)::text from pg_constraint
          where conrelid = 'public.product_shorts_plans'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%hook%'),
         '1'
  union all
  select 10, 'set_updated_at 트리거 존재',
         (select count(*)::text from pg_trigger
          where tgrelid = 'public.product_shorts_plans'::regclass and not tgisinternal and tgname = 'set_updated_at'),
         '1'
  union all
  select 11, '신규 테이블 행 수 (적용 직후 0)',
         (select count(*)::text from public.product_shorts_plans),
         '0'
  union all
  select 12, '기존 product_shorts_projects 행 수 (precheck 5번과 같아야 함)',
         (select count(*)::text from public.product_shorts_projects),
         (select count(*)::text from public.product_shorts_projects)
  union all
  select 13, '기존 product_shorts_media 행 수 (precheck 6번과 같아야 함)',
         (select count(*)::text from public.product_shorts_media),
         (select count(*)::text from public.product_shorts_media)
  union all
  select 14, '기존 users 행 수 (precheck 7번과 같아야 함)',
         (select count(*)::text from public.users), (select count(*)::text from public.users)
) c
order by n;
