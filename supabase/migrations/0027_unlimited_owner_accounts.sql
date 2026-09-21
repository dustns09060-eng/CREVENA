-- STEP48: "운영자 무제한" entitlement.
--
-- WHAT THIS IS: an explicit per-user flag, public.users.is_unlimited, that
-- lets specific owner/test accounts bypass CREVENA's OWN internal usage
-- limits (monthly AI credit budget, collaboration/content save caps). It is
-- deliberately a SEPARATE concept from:
--   - role ('USER'|'ADMIN')   : who may open /admin. ADMIN does NOT imply
--                               unlimited, and unlimited does NOT imply ADMIN.
--   - plan_tier (FREE/BASIC/PRO): what the user pays for. This migration never
--                               touches plan_tier, subscriptions or payments.
--
-- WHAT THIS IS NOT: it does not (and cannot) lift the Anthropic account
-- balance, Supabase infrastructure quotas or any third-party rate limit.
--
-- THIS MIGRATION ONLY ADDS THE CAPABILITY. It grants unlimited to NOBODY.
-- Granting it to the two owner accounts is a separate, reviewable step:
-- supabase/scripts/0027_grant_unlimited_owners.sql.
--
-- Not applied automatically. Run supabase/scripts/0027_precheck.sql first,
-- then this file, then supabase/scripts/0027_postcheck.sql.

-- ---------------------------------------------------------------------------
-- 1) The flag. NOT NULL DEFAULT false: every existing and future user is
--    "not unlimited" unless someone with database access says otherwise.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists is_unlimited boolean not null default false;

comment on column public.users.is_unlimited is
  'Owner/operator entitlement: bypasses CREVENA internal AI-credit quota and save-count caps. Usage is still fully logged. Independent of role and plan_tier. Set only via service role / SQL editor.';

-- ---------------------------------------------------------------------------
-- 2) Privileges. Migration 0007 revoked table-level UPDATE on public.users
--    from `authenticated` and re-granted UPDATE only on (display_name); a new
--    column is NOT part of that list, so a signed-in user can never PATCH
--    their own is_unlimited. The explicit revoke below is belt-and-braces and
--    documents the intent.
--
--    Migration 0016 replaced the table-level SELECT grant with an explicit
--    column allow-list, so the app (which reads with the user's own session)
--    can only see is_unlimited if it is added to that list. Reading it is
--    harmless: RLS ("users can view own profile") limits each user to their
--    own row, and the value only ever appears as the user's own status.
-- ---------------------------------------------------------------------------
revoke update (is_unlimited) on public.users from authenticated, anon;
grant select (is_unlimited) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 3) increment_ai_credits(): unlimited users skip ONLY the
--    "used_count + amount <= limit" guard. Everything else is identical to
--    migration 0012 — the usage counter still goes up and a reservation row is
--    still created — so:
--      * real usage stays measurable in ai_usage_quotas / ai_usage_logs,
--      * a failed AI call is still refunded by reservation id, exactly once,
--      * no fake "999999999 credits" are ever granted.
--    The flag is read HERE, from the database, by auth.uid(). Nothing a client
--    sends (including p_limit, which is chosen by our server code) can make a
--    call unlimited.
--    Same signature and return type as 0012, so CREATE OR REPLACE is enough.
-- ---------------------------------------------------------------------------
create or replace function public.increment_ai_credits(p_period text, p_amount int, p_limit int)
returns table(reservation_id uuid, used_count int, allowed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_unlimited boolean := false;
  v_count int;
  v_reservation_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(u.is_unlimited, false) into v_unlimited
  from public.users u
  where u.id = v_user_id;

  if v_unlimited then
    insert into public.ai_usage_quotas as q (user_id, period, used_count)
    values (v_user_id, p_period, p_amount)
    on conflict (user_id, period)
    do update set used_count = q.used_count + p_amount, updated_at = now()
    returning q.used_count into v_count;
  else
    insert into public.ai_usage_quotas as q (user_id, period, used_count)
    values (v_user_id, p_period, p_amount)
    on conflict (user_id, period)
    do update set used_count = q.used_count + p_amount, updated_at = now()
    where q.used_count + p_amount <= p_limit
    returning q.used_count into v_count;
  end if;

  if v_count is null then
    select q.used_count into v_count
    from public.ai_usage_quotas q
    where q.user_id = v_user_id and q.period = p_period;
    return query select null::uuid, coalesce(v_count, 0), false;
    return;
  end if;

  insert into public.ai_usage_reservations (user_id, period, amount)
  values (v_user_id, p_period, p_amount)
  returning id into v_reservation_id;

  return query select v_reservation_id, v_count, true;
end;
$$;

revoke all on function public.increment_ai_credits(text, int, int) from public;
grant execute on function public.increment_ai_credits(text, int, int) to authenticated;
