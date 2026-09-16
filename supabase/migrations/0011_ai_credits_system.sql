-- STEP 24: replace "1 AI call = 1 quota unit" with per-operation AI credits.
-- ai_usage_quotas.used_count now accumulates CREDITS going forward (not call
-- counts). Existing rows are left untouched — a user's used_count for the
-- current period keeps whatever it already was; only future increments use
-- the new per-operation amounts. This is intentional: STEP24 explicitly
-- must not retroactively rewrite/distort historical usage.

-- credits_used is nullable and NOT backfilled for existing ai_usage_logs
-- rows — old calls simply have no credit figure, they are not assigned one
-- after the fact.
alter table public.ai_usage_logs
  add column if not exists credits_used int;

-- ---------------------------------------------------------------------------
-- increment_ai_credits(): generalizes increment_ai_quota() (STEP18) to a
-- variable amount instead of always +1, atomically enforcing the monthly
-- credit limit under concurrent requests (row-level lock via the UPDATE's
-- WHERE clause, same pattern as before). increment_ai_quota() is left
-- defined but unused — nothing calls it anymore.
-- ---------------------------------------------------------------------------
create or replace function public.increment_ai_credits(p_period text, p_amount int, p_limit int)
returns table(used_count int, allowed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count int;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into public.ai_usage_quotas as q (user_id, period, used_count)
  values (v_user_id, p_period, p_amount)
  on conflict (user_id, period)
  do update set used_count = q.used_count + p_amount, updated_at = now()
  where q.used_count + p_amount <= p_limit
  returning q.used_count into v_count;

  if v_count is null then
    select q.used_count into v_count
    from public.ai_usage_quotas q
    where q.user_id = v_user_id and q.period = p_period;
    return query select coalesce(v_count, 0), false;
  else
    return query select v_count, true;
  end if;
end;
$$;

revoke all on function public.increment_ai_credits(text, int, int) from public;
grant execute on function public.increment_ai_credits(text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_ai_credits(): gives back credits reserved by increment_ai_credits
-- for a call that ended up failing. No limit check needed — reducing usage
-- can't push anyone over a limit. Floors at 0 defensively.
-- ---------------------------------------------------------------------------
create or replace function public.refund_ai_credits(p_period text, p_amount int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  update public.ai_usage_quotas
  set used_count = greatest(used_count - p_amount, 0), updated_at = now()
  where user_id = v_user_id and period = p_period;
end;
$$;

revoke all on function public.refund_ai_credits(text, int) from public;
grant execute on function public.refund_ai_credits(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_usage_grouped(): add credits_used (summed, nulls treated as 0) so
-- /admin/usage can show real credit totals alongside token-based $ cost.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_usage_grouped(timestamptz, timestamptz);

create function public.admin_usage_grouped(p_start timestamptz, p_end timestamptz)
returns table (
  day date,
  user_id uuid,
  email text,
  feature text,
  operation text,
  status text,
  provider text,
  model text,
  call_count bigint,
  input_tokens bigint,
  output_tokens bigint,
  credits_used bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
  select
    date(l.created_at) as day,
    l.user_id,
    u.email,
    l.feature,
    l.operation,
    l.status,
    l.provider,
    l.model,
    count(*) as call_count,
    coalesce(sum(l.input_tokens), 0)::bigint as input_tokens,
    coalesce(sum(l.output_tokens), 0)::bigint as output_tokens,
    coalesce(sum(l.credits_used), 0)::bigint as credits_used
  from public.ai_usage_logs l
  join public.users u on u.id = l.user_id
  where l.created_at >= p_start and l.created_at < p_end
  group by date(l.created_at), l.user_id, u.email, l.feature, l.operation, l.status, l.provider, l.model;
end;
$$;

revoke all on function public.admin_usage_grouped(timestamptz, timestamptz) from public;
grant execute on function public.admin_usage_grouped(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_list_users(): add credits_used_month so the 80%-of-limit indicator
-- compares credits to the (now credit-denominated) monthly limit correctly,
-- instead of comparing a raw call count to a credit limit.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_list_users(text, text, text);

create function public.admin_list_users(
  p_search text default null,
  p_plan text default null,
  p_active text default null
)
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  last_active_at timestamptz,
  plan_tier text,
  role text,
  ai_calls_month bigint,
  photo_analysis_month bigint,
  blog_generation_month bigint,
  fail_count_month bigint,
  credits_used_month bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start timestamptz := date_trunc('month', now());
  v_30d_ago timestamptz := now() - interval '30 days';
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
  with base as (
    select
      u.id as b_id,
      u.email as b_email,
      u.created_at as b_created_at,
      greatest(
        coalesce(au.last_sign_in_at, 'epoch'::timestamptz),
        coalesce((select max(l.created_at) from public.ai_usage_logs l where l.user_id = u.id), 'epoch'::timestamptz),
        coalesce((select max(c.updated_at) from public.collaborations c where c.user_id = u.id), 'epoch'::timestamptz)
      ) as b_last_active_at,
      u.plan_tier as b_plan_tier,
      u.role as b_role,
      (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start) as b_ai_calls_month,
      (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start and l.feature = 'VISION_ANALYSIS') as b_photo_analysis_month,
      (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start and l.operation = 'BLOG_WRITE') as b_blog_generation_month,
      (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start and l.status = 'failed') as b_fail_count_month,
      (select coalesce(sum(l.credits_used), 0) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start) as b_credits_used_month
    from public.users u
    left join auth.users au on au.id = u.id
    where
      (p_search is null or p_search = '' or u.email ilike '%' || p_search || '%')
      and (p_plan is null or p_plan = '' or upper(u.plan_tier) = upper(p_plan))
  )
  select
    base.b_id,
    base.b_email,
    base.b_created_at,
    base.b_last_active_at,
    base.b_plan_tier,
    base.b_role,
    base.b_ai_calls_month,
    base.b_photo_analysis_month,
    base.b_blog_generation_month,
    base.b_fail_count_month,
    base.b_credits_used_month
  from base
  where
    p_active is null or p_active = ''
    or (p_active = 'ACTIVE' and base.b_last_active_at >= v_30d_ago)
    or (p_active = 'INACTIVE' and base.b_last_active_at < v_30d_ago)
  order by base.b_created_at desc;
end;
$$;

revoke all on function public.admin_list_users(text, text, text) from public;
grant execute on function public.admin_list_users(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_user_detail(): include credits_used in the per-call log rows.
-- Return type is still jsonb, so no drop needed.
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start timestamptz := date_trunc('month', now());
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'display_name', u.display_name,
    'plan_tier', u.plan_tier,
    'role', u.role,
    'created_at', u.created_at,
    'last_sign_in_at', au.last_sign_in_at,
    'ai_calls_month', (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start),
    'photo_analysis_month', (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start and l.feature = 'VISION_ANALYSIS'),
    'blog_generation_month', (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start and l.operation = 'BLOG_WRITE'),
    'credits_used_month', (select coalesce(sum(l.credits_used), 0) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start),
    'recent_logs', (
      select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) from (
        select id, feature, operation, status, error_type, provider, model, input_tokens, output_tokens, credits_used, created_at
        from public.ai_usage_logs
        where user_id = u.id
        order by created_at desc
        limit 30
      ) r
    ),
    'failed_logs', (
      select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) from (
        select id, feature, operation, error_type, provider, model, created_at
        from public.ai_usage_logs
        where user_id = u.id and status = 'failed'
        order by created_at desc
        limit 20
      ) r
    )
  ) into v_result
  from public.users u
  left join auth.users au on au.id = u.id
  where u.id = p_user_id;

  if v_result is null then
    raise exception 'user not found';
  end if;

  return v_result;
end;
$$;

revoke all on function public.admin_user_detail(uuid) from public;
grant execute on function public.admin_user_detail(uuid) to authenticated;
