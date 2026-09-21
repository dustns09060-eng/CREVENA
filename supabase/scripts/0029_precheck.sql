-- 0029 PRECHECK — READ ONLY. Run BEFORE supabase/migrations/0029_validate_credit_amount.sql.
-- The SQL Editor shows only the last statement's result: run each query separately.

-- 1) The function is still the pre-fix version. Expected: 1 row,
--    has_amount_validation = false, has_unlimited_branch = true (0027 is in place).
select pg_get_functiondef(p.oid) ilike '%invalid amount%' as has_amount_validation,
       pg_get_functiondef(p.oid) ilike '%is_unlimited%'   as has_unlimited_branch
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'increment_ai_credits';

-- 2) Has the hole been used? Every successful call leaves a reservation row
--    (until refunded), and a negative amount would leave a negative one.
--    Expected: all three = 0.
select
  (select count(*) from public.ai_usage_reservations where amount <= 0)   as reservations_amount_le_0,
  (select count(*) from public.ai_usage_quotas       where used_count < 0) as quotas_negative,
  (select count(*) from public.ai_usage_logs         where credits_used < 0) as logs_negative;

-- 3) Baseline that the migration must not change (it only replaces a function).
select
  (select count(*) from public.ai_usage_quotas)       as ai_usage_quota_rows,
  (select count(*) from public.ai_usage_reservations) as ai_usage_reservation_rows,
  (select count(*) from public.ai_usage_logs)         as ai_usage_log_rows;
