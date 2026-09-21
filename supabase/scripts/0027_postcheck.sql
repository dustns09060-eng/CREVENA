-- STEP48 POSTCHECK — READ ONLY. SELECT statements only.
-- Run AFTER 0027_unlimited_owner_accounts.sql, and once more after the grant
-- script. The SQL Editor shows only the LAST statement's result when several
-- are run together — run each numbered query separately.

-- 1) Column shape. Expected: boolean / is_nullable = NO / default false.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'users' and column_name = 'is_unlimited';

-- 2) A signed-in user must NOT be able to change the flag, and must be able
--    to read their own. Expected: both can_update_is_unlimited_* = false,
--    can_select_is_unlimited = true, can_update_plan_tier = false,
--    can_update_role = false.
select
  has_column_privilege('authenticated', 'public.users', 'is_unlimited', 'UPDATE') as can_update_is_unlimited_authenticated,
  has_column_privilege('anon',          'public.users', 'is_unlimited', 'UPDATE') as can_update_is_unlimited_anon,
  has_column_privilege('authenticated', 'public.users', 'is_unlimited', 'SELECT') as can_select_is_unlimited,
  has_column_privilege('authenticated', 'public.users', 'plan_tier',    'UPDATE') as can_update_plan_tier,
  has_column_privilege('authenticated', 'public.users', 'role',         'UPDATE') as can_update_role;

-- 3) The credit function knows about the flag and is still SECURITY DEFINER.
--    Expected: mentions_is_unlimited = true, security_definer = true,
--    anon_can_execute = false, authenticated_can_execute = true.
select pg_get_functiondef(p.oid) ilike '%is_unlimited%'          as mentions_is_unlimited,
       p.prosecdef                                                as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE')           as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'increment_ai_credits';

-- 4) Who has the flag. Expected: 0 rows BEFORE the grant script; exactly the
--    two owner emails AFTER it. Nobody else, ever.
select lower(btrim(a.email)) as email, p.is_unlimited, p.role, p.plan_tier
from public.users p
join auth.users a on a.id = p.id
where p.is_unlimited = true
order by 1;

-- 5) Nothing else moved. Must equal the precheck baseline (its query 3).
select
  (select count(*) from public.users)                                    as users_rows,
  (select count(*) from public.users where role = 'ADMIN')               as admin_rows,
  (select count(*) from public.users where plan_tier = 'FREE')           as free_rows,
  (select count(*) from public.users where plan_tier = 'BASIC')          as basic_rows,
  (select count(*) from public.users where plan_tier = 'PRO')            as pro_rows,
  (select count(*) from public.ai_usage_quotas)                          as ai_usage_quota_rows,
  (select count(*) from public.ai_usage_reservations)                    as ai_usage_reservation_rows,
  (select count(*) from public.ai_usage_logs)                            as ai_usage_log_rows,
  (select count(*) from public.payment_events)                           as payment_event_rows,
  (select count(*) from public.payment_refunds)                          as payment_refund_rows;
