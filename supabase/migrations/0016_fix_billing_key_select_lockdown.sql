-- Fix for 0015: a column-level REVOKE cannot narrow an already-existing
-- TABLE-level SELECT grant. Postgres stores table-level and column-level
-- ACL entries independently, so `revoke select (col) ... from authenticated`
-- did nothing while the broader `grant select on public.users to
-- authenticated` (set up long before this project's migrations, as part of
-- the default Supabase table permissions) still authorized every column,
-- payment_subscription_id included — confirmed via
-- `has_column_privilege('authenticated', 'public.users',
-- 'payment_subscription_id', 'select')` still returning true after 0015.
--
-- The correct fix is the same pattern migration 0007 already used for
-- UPDATE: revoke the table-level grant entirely, then re-grant SELECT only
-- for the explicit column list that should remain readable — leaving
-- payment_subscription_id (the PortOne billing key) off it.
revoke select on public.users from authenticated, anon;

grant select (
  id, email, display_name, plan_tier, role,
  subscription_status, subscription_started_at, subscription_expires_at,
  next_billing_at, cancel_at_period_end,
  payment_provider, payment_customer_id,
  retry_count, next_retry_at, last_payment_failed_at, last_payment_error_type,
  created_at, updated_at
) on public.users to authenticated, anon;
