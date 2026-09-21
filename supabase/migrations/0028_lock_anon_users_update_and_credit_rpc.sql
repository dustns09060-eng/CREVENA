-- STEP48 follow-up: close two privilege gaps the 0027 postcheck exposed.
--
-- 1) `anon` could UPDATE any column of public.users at the privilege level.
--    Migration 0007 revoked the table-level UPDATE grant from `authenticated`
--    only and never touched `anon`, so Supabase's default table grant to
--    `anon` was left in place. That is why 0027's column-level
--    `revoke update (is_unlimited) ... from anon` did nothing: a column-level
--    revoke cannot narrow a table-level grant (same reason 0016 exists).
--    In practice nothing was writable — the RLS policy "users can update own
--    profile" is `id = auth.uid()`, and auth.uid() is NULL for anon, so no row
--    ever matches — but plan_tier, role and is_unlimited should not depend on
--    RLS alone. `anon` has no legitimate reason to UPDATE users at all.
--
-- 2) `anon` could EXECUTE increment_ai_credits. Migration 0012 did
--    `revoke all ... from public; grant execute ... to authenticated`, but
--    Supabase also grants EXECUTE on new public functions to `anon`
--    explicitly, which `revoke ... from public` does not remove. The function
--    itself raises 'not authenticated' first thing when auth.uid() is NULL, so
--    an anon call could never reserve or spend anything — this only removes
--    the pointless door.
--
-- Nothing signed-in users can do changes: `authenticated` keeps exactly the
-- grants it has today. No data is touched.
--
-- Not applied automatically. Run supabase/scripts/0028_precheck.sql, then this
-- file, then supabase/scripts/0028_postcheck.sql.

revoke update on public.users from anon;

revoke execute on function public.increment_ai_credits(text, int, int) from anon;
