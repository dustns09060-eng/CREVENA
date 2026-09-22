-- STEP51 PRECHECK — READ ONLY. One SELECT.
-- Run in the Supabase SQL Editor BEFORE supabase/migrations/0033_revoke_anon_admin_rpc_execute.sql.
-- Confirms the current (known-wrong) state this migration is about to fix,
-- plus the invariants that must not change: is_admin() presence, security
-- definer, and payment/refund row counts.

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, '6개 admin RPC 모두 존재' as check_name,
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'admin_dashboard_stats', 'admin_list_users', 'admin_user_detail',
              'admin_usage_grouped', 'admin_apply_subscription', 'admin_list_orphaned_refundable_payments'
            )) as result,
         '6' as expected
  union all
  select 2, '6개 모두 SECURITY DEFINER',
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'admin_dashboard_stats', 'admin_list_users', 'admin_user_detail',
              'admin_usage_grouped', 'admin_apply_subscription', 'admin_list_orphaned_refundable_payments'
            )
            and prosecdef),
         '6'
  union all
  select 3, '6개 모두 함수 본문에 is_admin() 호출 존재 (실제 definition 확인, 추정 아님)',
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'admin_dashboard_stats', 'admin_list_users', 'admin_user_detail',
              'admin_usage_grouped', 'admin_apply_subscription', 'admin_list_orphaned_refundable_payments'
            )
            and pg_get_functiondef(oid) ilike '%is_admin()%'),
         '6'
  union all
  select 4, '(현재, 수정 전) anon EXECUTE 있는 함수 수 — 이 migration이 고치려는 상태',
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'admin_dashboard_stats', 'admin_list_users', 'admin_user_detail',
              'admin_usage_grouped', 'admin_apply_subscription', 'admin_list_orphaned_refundable_payments'
            )
            and has_function_privilege('anon', oid, 'EXECUTE')),
         '6'
  union all
  select 5, '(현재) authenticated EXECUTE 있는 함수 수 — 그대로 유지되어야 함',
         (select count(*)::text from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in (
              'admin_dashboard_stats', 'admin_list_users', 'admin_user_detail',
              'admin_usage_grouped', 'admin_apply_subscription', 'admin_list_orphaned_refundable_payments'
            )
            and has_function_privilege('authenticated', oid, 'EXECUTE')),
         '6'
  union all
  select 6, 'payment_events 행 수 (기록해 두세요: 적용 후에도 같아야 함)',
         (select count(*)::text from public.payment_events), (select count(*)::text from public.payment_events)
  union all
  select 7, 'payment_refunds 행 수 (기록해 두세요: 적용 후에도 같아야 함)',
         (select count(*)::text from public.payment_refunds), (select count(*)::text from public.payment_refunds)
) c
order by n;

-- Note: this migration touches ONLY function grants (REVOKE EXECUTE), never
-- payment_events/payment_refunds/users. Rows 6-7 exist purely to prove that
-- guarantee against reality, same as 0031/0032's precheck/postcheck.
