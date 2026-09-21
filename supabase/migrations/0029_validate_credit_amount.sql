-- SECURITY FIX: increment_ai_credits() accepted any p_amount, including a
-- negative one.
--
-- Found while verifying STEP48 with a disposable FREE account: calling the RPC
-- straight from the browser with the user's own JWT and
--   p_amount = -40
-- returned allowed = true and moved used_count from 40 to 0. The guard is
--   used_count + p_amount <= p_limit
-- which any negative amount satisfies, so any signed-in user could zero their
-- own monthly credit counter at will — a complete credit bypass on every plan.
-- It is the same class of exploit migration 0012 closed for refunds, reachable
-- through the amount instead. The application routes always pass the fixed
-- per-operation cost (OPERATION_CREDIT_COST: 1..10), so no legitimate call is
-- affected.
--
-- (Production data was checked before writing this: no reservation with
-- amount <= 0 exists, no quota row has a negative used_count, and no
-- ai_usage_logs row has negative credits_used — i.e. no sign it was used.)
--
-- The rest of the function is exactly the migration 0027 version: unlimited
-- owner accounts still skip only the "used + amount <= limit" guard and are
-- still counted and refundable. p_limit is intentionally left as is: a caller
-- can only raise or lower their OWN counter's headroom with it, the app routes
-- always send the real plan limit, and after this fix a client can no longer
-- use any parameter to LOWER used_count. Same signature and return type, so
-- CREATE OR REPLACE keeps the existing grants (0028 removed anon's).
--
-- Not applied automatically. Run supabase/scripts/0029_precheck.sql, then this
-- file, then supabase/scripts/0029_postcheck.sql.

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

  -- The largest real operation costs 10 credits; 100 leaves generous headroom
  -- for future pricing changes while still rejecting absurd values.
  if p_amount is null or p_amount < 1 or p_amount > 100 then
    raise exception 'invalid amount';
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
