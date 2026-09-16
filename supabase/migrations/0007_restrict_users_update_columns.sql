-- Security fix: the "users can update own profile" RLS policy (0001) only
-- restricts which ROW a user can update (their own), not which COLUMNS.
-- Combined with Supabase's default table-level UPDATE grant to `authenticated`,
-- any signed-in user could PATCH /rest/v1/users?id=eq.<self> with an arbitrary
-- plan_tier, self-upgrading their plan and bypassing the STEP18 AI quota system.
-- RLS cannot restrict columns, so this is enforced at the grant level instead:
-- authenticated users may only ever update display_name on their own row.
-- plan_tier will only ever change through a future trusted server-side/billing path.
revoke update on public.users from authenticated;
grant update (display_name) on public.users to authenticated;
