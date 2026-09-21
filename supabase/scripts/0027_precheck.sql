-- STEP48 PRECHECK — READ ONLY. SELECT statements only.
--
-- NOT a migration (this directory is never applied by `supabase db push`).
-- Run by hand in the Supabase SQL Editor BEFORE applying
-- supabase/migrations/0027_unlimited_owner_accounts.sql.
--
-- The SQL Editor shows only the LAST statement's result when several are
-- run together — run each numbered query separately.

-- 1) The column must NOT exist yet. Expected: ZERO rows.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'users' and column_name = 'is_unlimited';

-- 2) The two owner accounts must ALREADY exist (this feature never creates
--    accounts). Expected: exactly 2 rows, each with in_public_users = true.
--    Emails are compared trimmed + lower-cased.
select
  lower(btrim(a.email))                                   as email,
  a.id                                                    as auth_user_id,
  exists (select 1 from public.users p where p.id = a.id) as in_public_users
from auth.users a
where lower(btrim(a.email)) in ('dustns0906@kakao.com', 'dustns0906@naver.com')
order by 1;

-- 3) Baseline for the tables/columns this change must NOT alter.
--    Record these; the postcheck must show the same values.
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

-- 4) Current UPDATE privileges of `authenticated` on public.users.
--    Expected: plan_tier = false, role = false (the 0007 lock-down),
--    display_name = true.
select
  has_column_privilege('authenticated', 'public.users', 'plan_tier',    'UPDATE') as can_update_plan_tier,
  has_column_privilege('authenticated', 'public.users', 'role',         'UPDATE') as can_update_role,
  has_column_privilege('authenticated', 'public.users', 'display_name', 'UPDATE') as can_update_display_name;

-- 5) The current increment_ai_credits is the original 0012 version — the
--    migration replaces it. Expected: 1 row, still_original_0012_definition = true.
select pg_get_functiondef(p.oid) not ilike '%is_unlimited%' as still_original_0012_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'increment_ai_credits';
