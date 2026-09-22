-- STEP51 continued: revoke stray anon EXECUTE on every admin-only RPC.
--
-- Confirmed via Production catalog inspection (not assumed) during the
-- release-refund-safety verification: every admin_*() function in this
-- codebase is owned by role `postgres` (the role Supabase SQL Editor
-- migrations run as), and pg_default_acl has a default-privilege entry for
-- functions created by `postgres` in schema public that grants EXECUTE to
-- postgres, anon, authenticated AND service_role automatically at CREATE
-- FUNCTION time:
--
--   defaclrole=postgres, defaclnamespace=public, defaclobjtype='f',
--   defaclacl={postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,...}
--
-- Every admin migration's `revoke all on function ... from public` only
-- ever revoked the PUBLIC pseudo-role's own grant (confirmed separately —
-- every admin_*() function shows the PUBLIC pseudo-role has NO execute
-- grant of its own). It never touched anon's SEPARATE, already-applied
-- default-privilege grant, because that grant was never routed through
-- PUBLIC in the first place — it was attached directly to the anon role by
-- the project's default ACL the moment each function was created. That
-- combination is why every admin_*() function (not just this PR's new one)
-- has anon EXECUTE = true today, despite that `revoke ... from public`
-- line existing in every one of their own migrations.
--
-- Actual exposure: NONE, in every case. Every one of these six functions
-- checks `if not public.is_admin() then raise exception 'forbidden'` as
-- its very first statement (verified against each function's real body via
-- pg_get_functiondef(), not assumed), so an anon caller with this stray
-- EXECUTE grant still gets nothing but a 'forbidden' error and zero rows —
-- confirmed against Production for admin_list_orphaned_refundable_payments
-- specifically (HTTP 400 / P0001 / "forbidden"). This migration closes the
-- SQL-permission-hygiene gap anyway: the DB grant should match what is
-- actually intended (admin-only), not rely solely on the function body's
-- own runtime check as the sole line of defense.
--
-- Deliberately NOT done here: changing the project-wide default privilege
-- itself (e.g. `alter default privileges for role postgres in schema
-- public revoke execute on functions from anon`). That would affect every
-- OTHER function anon is meant to call in this schema going forward and is
-- out of scope for this PR — only these six existing admin-only functions
-- are touched here, by their exact current signatures. Recommended pattern
-- for every FUTURE admin-only RPC migration, to avoid re-discovering this
-- same gap: end it with
--   revoke execute on function public.<name>(<args>) from public, anon;
--   grant execute on function public.<name>(<args>) to authenticated;
-- (in that order — this migration is the `revoke ... from anon` half for
-- the six that already existed without it).
--
-- Not touched: authenticated (still needs EXECUTE — the function body's
-- is_admin() check is what actually gates access; unchanged by this
-- migration, not re-granted here since it was never revoked), service_role
-- (this app's server code never calls these RPCs through PostgREST as
-- service_role — the service-role client used elsewhere talks to tables
-- directly with its own key, bypassing RLS, not through these RPCs), and
-- every function's body (zero lines of function logic changed — this file
-- contains no `create or replace function`, only REVOKE statements).

revoke execute on function public.admin_dashboard_stats() from public, anon;
revoke execute on function public.admin_list_users(text, text, text) from public, anon;
revoke execute on function public.admin_user_detail(uuid) from public, anon;
revoke execute on function public.admin_usage_grouped(timestamptz, timestamptz) from public, anon;
revoke execute on function public.admin_apply_subscription(
  uuid, text, text, timestamptz, timestamptz, timestamptz, boolean, text, text, text
) from public, anon;
revoke execute on function public.admin_list_orphaned_refundable_payments() from public, anon;
