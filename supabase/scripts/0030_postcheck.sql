-- STEP49 POSTCHECK — READ ONLY. One SELECT.
-- Run AFTER supabase/migrations/0030_signup_consent.sql.
-- Every row's `ok` must be true.

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, 'user_consents 테이블 존재' as check_name,
         (select count(*)::text from information_schema.tables
          where table_schema = 'public' and table_name = 'user_consents') as result, '1' as expected
  union all
  select 2, '컬럼 목록',
         (select string_agg(column_name, ',' order by ordinal_position)
          from information_schema.columns where table_schema = 'public' and table_name = 'user_consents'),
         'id,user_id,consent_type,document_version,agreed_at,source,created_at'
  union all
  select 3, 'user_id FK 삭제 동작',
         (select case con.confdeltype when 'n' then 'SET NULL' when 'c' then 'CASCADE' when 'a' then 'NO ACTION' else con.confdeltype::text end
          from pg_constraint con join pg_class rel on rel.oid = con.conrelid join pg_namespace ns on ns.oid = rel.relnamespace
          where ns.nspname = 'public' and rel.relname = 'user_consents' and con.contype = 'f'),
         'SET NULL'
  union all
  select 4, 'RLS 켜짐',
         (select relrowsecurity::text from pg_class rel join pg_namespace ns on ns.oid = rel.relnamespace
          where ns.nspname = 'public' and rel.relname = 'user_consents'), 'true'
  union all
  select 5, '정책 (SELECT 1개 / 전체 1개)',
         (select count(*) filter (where cmd = 'SELECT')::text || ' / ' || count(*)::text
          from pg_policies where schemaname = 'public' and tablename = 'user_consents'), '1 / 1'
  union all
  select 6, '정책 조건이 user_id = auth.uid()',
         (select count(*)::text from pg_policies
          where schemaname = 'public' and tablename = 'user_consents' and qual ilike '%user_id = auth.uid()%'), '1'
  union all
  select 7, 'authenticated: SELECT 가능',
         has_table_privilege('authenticated', 'public.user_consents', 'SELECT')::text, 'true'
  union all
  select 8, 'authenticated: INSERT 가능',
         has_table_privilege('authenticated', 'public.user_consents', 'INSERT')::text, 'false'
  union all
  select 9, 'authenticated: UPDATE 가능',
         has_table_privilege('authenticated', 'public.user_consents', 'UPDATE')::text, 'false'
  union all
  select 10, 'authenticated: DELETE 가능',
         has_table_privilege('authenticated', 'public.user_consents', 'DELETE')::text, 'false'
  union all
  select 11, 'anon: SELECT/INSERT/UPDATE/DELETE 중 하나라도 가능',
         (has_table_privilege('anon', 'public.user_consents', 'SELECT')
          or has_table_privilege('anon', 'public.user_consents', 'INSERT')
          or has_table_privilege('anon', 'public.user_consents', 'UPDATE')
          or has_table_privilege('anon', 'public.user_consents', 'DELETE'))::text, 'false'
  union all
  select 12, 'handle_new_user() 가 동의를 검사함',
         (select (pg_get_functiondef(p.oid) ilike '%signup_consent_required%')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'handle_new_user'), 'true'
  union all
  select 13, 'handle_new_user() 가 user_consents 에 기록함',
         (select (pg_get_functiondef(p.oid) ilike '%insert into public.user_consents%')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'handle_new_user'), 'true'
  union all
  select 14, 'handle_new_user() 가 여전히 SECURITY DEFINER',
         (select p.prosecdef::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'handle_new_user'), 'true'
  union all
  select 15, 'on_auth_user_created 트리거가 그대로 존재',
         (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'on_auth_user_created' and not t.tgisinternal), '1'
  union all
  select 16, '기존 회원에게 가짜 동의 기록이 만들어지지 않음 (가입이 없었다면 0)',
         (select count(*)::text from public.user_consents), '0'
  union all
  select 17, '회원 수 (precheck 6번과 같아야 함)',
         (select count(*)::text from public.users), '5'
  union all
  select 18, 'auth.users 수 (precheck 7번과 같아야 함)',
         (select count(*)::text from auth.users), '5'
) c
order by n;

-- Notes
--  * Row 16 is 0 only if nobody signed up between deploying the form and
--    applying the migration AND after it. If you (or a tester) completed a
--    signup after the migration, expect 3 rows per such signup (AGE_14, TERMS,
--    PRIVACY), all with source = 'SIGNUP'. Existing members never get rows.
--  * This script proves structure and privileges, not behaviour. To prove the
--    trigger blocks a signup without consent and records one with consent,
--    run a real signup with a disposable address after applying (see the PR
--    report) — do not test by inserting into auth.users by hand.
