-- STEP51 POSTCHECK — READ ONLY. One SELECT.
-- Run AFTER supabase/migrations/0033_revoke_anon_admin_rpc_execute.sql.
-- Every row's `ok` must be true.

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, '6개 admin RPC 모두 anon EXECUTE 없음 (수정됨)' as check_name,
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'admin_dashboard_stats', 'admin_list_users', 'admin_user_detail',
              'admin_usage_grouped', 'admin_apply_subscription', 'admin_list_orphaned_refundable_payments'
            )
            and has_function_privilege('anon', oid, 'EXECUTE')) as result,
         '0' as expected
  union all
  select 2, '6개 모두 authenticated EXECUTE 유지',
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'admin_dashboard_stats', 'admin_list_users', 'admin_user_detail',
              'admin_usage_grouped', 'admin_apply_subscription', 'admin_list_orphaned_refundable_payments'
            )
            and has_function_privilege('authenticated', oid, 'EXECUTE')),
         '6'
  union all
  select 3, '6개 모두 여전히 SECURITY DEFINER (함수 재정의 없었음)',
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'admin_dashboard_stats', 'admin_list_users', 'admin_user_detail',
              'admin_usage_grouped', 'admin_apply_subscription', 'admin_list_orphaned_refundable_payments'
            )
            and prosecdef),
         '6'
  union all
  select 4, '6개 모두 search_path=public 유지',
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'admin_dashboard_stats', 'admin_list_users', 'admin_user_detail',
              'admin_usage_grouped', 'admin_apply_subscription', 'admin_list_orphaned_refundable_payments'
            )
            and exists (
              select 1 from unnest(proconfig) as option_value
              where option_value = 'search_path=public'
            )),
         '6'
  union all
  select 5, '6개 모두 is_admin() 호출 그대로 유지 (함수 본문 변경 없었음 확인)',
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'admin_dashboard_stats', 'admin_list_users', 'admin_user_detail',
              'admin_usage_grouped', 'admin_apply_subscription', 'admin_list_orphaned_refundable_payments'
            )
            and pg_get_functiondef(oid) ilike '%is_admin()%'),
         '6'
  union all
  select 6, 'payment_events 행 수 불변 (precheck 6번과 비교)',
         (select count(*)::text from public.payment_events),
         (select count(*)::text from public.payment_events)
  union all
  select 7, 'payment_refunds 행 수 불변 (precheck 7번과 비교)',
         (select count(*)::text from public.payment_refunds),
         (select count(*)::text from public.payment_refunds)
  union all
  select 8, 'payment_events RLS 정책 수 불변',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'payment_events'),
         '1'
  union all
  select 9, 'payment_refunds RLS 정책 수 불변',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'payment_refunds'),
         '1'
  union all
  select 10, 'payment_events.user_id FK 불변 (on delete set null)',
         (select confdeltype::text from pg_constraint
          where conname = 'payment_events_user_id_fkey' and conrelid = 'public.payment_events'::regclass),
         'n'
  union all
  select 11, 'payment_refunds.user_id FK 불변 (on delete set null)',
         (select confdeltype::text from pg_constraint
          where conname = 'payment_refunds_user_id_fkey' and conrelid = 'public.payment_refunds'::regclass),
         'n'
) c
order by n;
