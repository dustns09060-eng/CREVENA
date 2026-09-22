-- STEP51 PRECHECK — READ ONLY. One SELECT.
-- Run in the Supabase SQL Editor BEFORE supabase/migrations/0032_admin_orphaned_payment_refund.sql.
-- Deploy order: apply the migration FIRST, then deploy the app change.

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, '신규 RPC가 아직 없음' as check_name,
         (select count(*)::text from pg_proc
          where proname = 'admin_list_orphaned_refundable_payments'
            and pronamespace = 'public'::regnamespace) as result,
         '0' as expected
  union all
  select 2, '기존 payment_events 행 수 (기록해 두세요: 적용 후에도 같아야 함)',
         (select count(*)::text from public.payment_events), (select count(*)::text from public.payment_events)
  union all
  select 3, '기존 payment_refunds 행 수 (기록해 두세요: 적용 후에도 같아야 함)',
         (select count(*)::text from public.payment_refunds), (select count(*)::text from public.payment_refunds)
  union all
  select 4, 'user_id가 NULL인 payment_events 수 (탈퇴 회원 보존 기록, 기록해 두세요)',
         (select count(*)::text from public.payment_events where user_id is null),
         (select count(*)::text from public.payment_events where user_id is null)
  union all
  select 5, '그중 PAID 상태 (기록해 두세요)',
         (select count(*)::text from public.payment_events where user_id is null and status = 'PAID'),
         (select count(*)::text from public.payment_events where user_id is null and status = 'PAID')
  union all
  select 6, 'is_admin() 존재',
         (select count(*)::text from pg_proc
          where proname = 'is_admin' and pronamespace = 'public'::regnamespace),
         '1'
  union all
  select 7, 'admin_user_detail() 존재 (기존 admin 함수, 이번 migration이 건드리지 않음)',
         (select count(*)::text from pg_proc
          where proname = 'admin_user_detail' and pronamespace = 'public'::regnamespace),
         '1'
  union all
  select 8, 'payment_events RLS: authenticated는 본인 행만 SELECT (기존 정책 유지 확인)',
         (select count(*)::text from pg_policies
          where schemaname = 'public' and tablename = 'payment_events'),
         '1'
  union all
  select 9, 'payment_refunds RLS: authenticated는 본인 행만 SELECT (기존 정책 유지 확인)',
         (select count(*)::text from pg_policies
          where schemaname = 'public' and tablename = 'payment_refunds'),
         '1'
) c
order by n;

-- Notes
--  * Rows 2/3/4/5 compare each count to itself — there is no "before" value
--    to assert yet. Their purpose is to have you COPY the printed numbers
--    down before applying the migration, then compare them to postcheck's
--    rows 6/7/8/9 (which assert the SAME literal numbers) after applying.
--    The migration adds a read-only function; it must not change any of
--    these counts.
