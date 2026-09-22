-- STEP50 (release legal blockers, PR C): track billing-key revocation.
--
-- Before this PR nothing ever deleted a PortOne billing key, so every path that
-- ended a subscription left a live key behind. The app now deletes the key at
-- PortOne when a subscription ends (src/lib/billing/revoke-billing-key.ts) and
-- clears users.payment_subscription_id once PortOne confirms it is gone. These
-- two columns are the bookkeeping for that:
--
--   billing_key_revoked_at    when the key was last confirmed deleted
--   billing_key_revoke_error  a short category (e.g. PG_PROVIDER) when a delete
--                             attempt FAILED; NULL otherwise. The cron uses it
--                             to retry only rows whose delete previously failed.
--
-- Purely additive: two nullable columns, no default, no backfill, no data
-- change. Existing rows (including any FREE account that still holds an old
-- key) get NULL in both and are NOT picked up for retry automatically; an
-- operator decides about those separately.
--
-- Privileges: nothing to grant. Migration 0007 left `authenticated` with
-- UPDATE on display_name only, and 0016 replaced its table-level SELECT with an
-- explicit column list that these columns are not on. So signed-in users can
-- neither read nor write them; only the service role (server routes) can.
--
-- DEPLOY ORDER: apply this migration FIRST, then deploy the app change. The
-- new code tolerates the columns being missing (it falls back to clearing only
-- the key), but the cron's retry query needs them.
--
-- Not applied automatically. Run supabase/scripts/0031_precheck.sql, then this
-- file, then supabase/scripts/0031_postcheck.sql.

alter table public.users
  add column if not exists billing_key_revoked_at timestamptz,
  add column if not exists billing_key_revoke_error text;

comment on column public.users.billing_key_revoked_at is
  'When the PortOne billing key was last confirmed deleted. Server-side bookkeeping only.';
comment on column public.users.billing_key_revoke_error is
  'Short category of the last FAILED billing-key delete attempt; NULL when none. Server-side bookkeeping only.';
