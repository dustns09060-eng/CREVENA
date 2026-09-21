-- STEP49 PRECHECK — READ ONLY. One SELECT.
--
-- NOT a migration (this directory is never applied by `supabase db push`).
-- Run in the Supabase SQL Editor BEFORE applying
-- supabase/migrations/0030_signup_consent.sql.
--
-- Deploy order reminder: merge/deploy the app change (signup form) FIRST, then
-- apply the migration.

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, 'user_consents 테이블이 아직 없음' as check_name,
         (select count(*)::text from information_schema.tables
          where table_schema = 'public' and table_name = 'user_consents') as result,
         '0' as expected
  union all
  select 2, 'handle_new_user() 가 원래(0001) 정의임 (consent 미참조)',
         (select (pg_get_functiondef(p.oid) not ilike '%consent%')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'handle_new_user'),
         'true'
  union all
  select 3, 'handle_new_user() 가 SECURITY DEFINER',
         (select p.prosecdef::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'handle_new_user'),
         'true'
  union all
  select 4, 'auth.users 의 사용자 정의 트리거 목록',
         (select coalesce(string_agg(t.tgname, ', ' order by t.tgname), '(없음)')
          from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal),
         'on_auth_user_created'
  union all
  select 5, 'on_auth_user_created 는 AFTER INSERT 트리거',
         (select (t.tgtype & 4 = 4 and t.tgtype & 64 = 0 and t.tgtype & 2 = 0 and t.tgtype & 8 = 0 and t.tgtype & 16 = 0)::text
          from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'on_auth_user_created'),
         'true'
  union all
  select 6, '기존 회원 수 (기록해 두세요: 적용 후에도 같아야 함)',
         (select count(*)::text from public.users), '5'
  union all
  select 7, 'auth.users 수 (기록해 두세요)',
         (select count(*)::text from auth.users), '5'
) c
order by n;

-- Notes
--  * Row 4 must list only on_auth_user_created. If another trigger appears on
--    auth.users, tell the developer before applying: it may interact.
--  * Row 5 checks the trigger fires AFTER INSERT (tgtype bits: 4 = INSERT,
--    64 = INSTEAD OF, 2 = BEFORE, 8 = DELETE, 16 = UPDATE) — an UPDATE/login
--    can therefore never reach the new consent check.
--  * Rows 6/7 expected values are the counts seen on 2026-09-21; if they
--    differ because someone signed up since, that is fine — just compare the
--    same numbers after the migration.
