-- STEP51 POSTCHECK — READ ONLY. One SELECT.
-- Run AFTER supabase/migrations/0032_admin_orphaned_payment_refund.sql.
-- Every row's `ok` must be true. Rows 6-9 must match the numbers you
-- recorded from 0032_precheck.sql rows 2-5 — compare them by eye (this
-- script cannot see precheck's earlier output).

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, '신규 RPC 존재' as check_name,
         (select count(*)::text from pg_proc
          where proname = 'admin_list_orphaned_refundable_payments'
            and pronamespace = 'public'::regnamespace) as result,
         '1' as expected
  union all
  select 2, '함수가 SECURITY DEFINER',
         (select prosecdef::text from pg_proc
          where proname = 'admin_list_orphaned_refundable_payments'
            and pronamespace = 'public'::regnamespace),
         'true'
  union all
  select 3, '함수 search_path가 고정됨 (public)',
         (select coalesce(
            (select option_value from unnest(proconfig) as option_value
             where option_value like 'search_path=%' limit 1),
            'NOT SET')
          from pg_proc
          where proname = 'admin_list_orphaned_refundable_payments'
            and pronamespace = 'public'::regnamespace),
         'search_path=public'
  union all
  select 4, 'authenticated: EXECUTE 권한 있음 (실제 접근 통제는 함수 안 is_admin()이 담당 — 기존 admin_* 함수와 동일 패턴)',
         has_function_privilege('authenticated', 'public.admin_list_orphaned_refundable_payments()', 'EXECUTE')::text,
         'true'
  union all
  select 5, 'anon: EXECUTE 권한 없음',
         has_function_privilege('anon', 'public.admin_list_orphaned_refundable_payments()', 'EXECUTE')::text,
         'false'
  union all
  select 6, '기존 payment_events 행 수 (precheck 2번과 비교)',
         (select count(*)::text from public.payment_events),
         (select count(*)::text from public.payment_events)
  union all
  select 7, '기존 payment_refunds 행 수 (precheck 3번과 비교)',
         (select count(*)::text from public.payment_refunds),
         (select count(*)::text from public.payment_refunds)
  union all
  select 8, 'user_id가 NULL인 payment_events 수 (precheck 4번과 비교, migration이 데이터를 건드리지 않았어야 함)',
         (select count(*)::text from public.payment_events where user_id is null),
         (select count(*)::text from public.payment_events where user_id is null)
  union all
  select 9, '그중 PAID 상태 (precheck 5번과 비교)',
         (select count(*)::text from public.payment_events where user_id is null and status = 'PAID'),
         (select count(*)::text from public.payment_events where user_id is null and status = 'PAID')
  union all
  select 10, 'payment_events RLS 정책 수 불변 (precheck 8번과 비교)',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'payment_events'),
         '1'
  union all
  select 11, 'payment_refunds RLS 정책 수 불변 (precheck 9번과 비교)',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'payment_refunds'),
         '1'
  union all
  select 12, 'payment_events.user_id FK: on delete set null 유지 (0024 변경 불변)',
         (select confdeltype::text from pg_constraint
          where conname = 'payment_events_user_id_fkey' and conrelid = 'public.payment_events'::regclass),
         'n'
  union all
  select 13, 'payment_refunds.user_id FK: on delete set null 유지 (0024 변경 불변)',
         (select confdeltype::text from pg_constraint
          where conname = 'payment_refunds_user_id_fkey' and conrelid = 'public.payment_refunds'::regclass),
         'n'
) c
order by n;

-- Notes
--  * confdeltype 'n' = ON DELETE SET NULL (Postgres catalog code). This must
--    still read 'n' after this migration — 0032 does not touch either FK.
--  * Rows 6-9 are the migration-doesn't-mutate-data check: this function is
--    SELECT-only (a `language plpgsql ... returns table`), it contains no
--    INSERT/UPDATE/DELETE, so these counts are structurally guaranteed
--    unchanged — this just double-checks that guarantee against reality.
--  * Row 4/5 confirm the GRANT matches every other admin_*() function in
--    this codebase (admin_dashboard_stats, admin_user_detail,
--    admin_list_users, admin_usage_grouped): `authenticated` can call it,
--    but the function body's `if not is_admin() then raise exception` is
--    what actually blocks a non-admin caller — that behavior is verified by
--    code review and the offline test suite, not by SQL privileges alone
--    (SQL has no notion of "this session is an ADMIN row in public.users").
