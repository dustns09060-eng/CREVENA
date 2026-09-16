-- STEP 23: admin role + richer AI usage tagging + admin-only read RPCs.
--
-- Authorization model: `role` is a separate column from `plan_tier` (billing
-- tier and permission level must never be conflated). It is protected the
-- same way STEP19 protected plan_tier: migration 0007 already revoked
-- column-level UPDATE on public.users from `authenticated` except
-- `display_name`, and a newly added column is NOT automatically included in
-- that column-list grant. So `role` is self-update-proof from the moment it
-- exists, with no extra grant/revoke needed here.

alter table public.users
  add column if not exists role text not null default 'USER' check (role in ('USER', 'ADMIN'));

-- Lets a single AI call be tagged with which user-facing action triggered it
-- (e.g. "이 TEXT_GENERATION 호출은 전체 블로그 작성이었다" vs "문단 재생성"),
-- without adding new AiUsageFeature enum values or touching quota/rate-limit
-- logic. Purely informational; nothing reads it except the new admin stats.
alter table public.ai_usage_logs
  add column if not exists operation text;

-- ---------------------------------------------------------------------------
-- is_admin(): the single place every admin-only function checks permission.
-- SECURITY DEFINER so it can read public.users regardless of the caller's
-- own RLS visibility, but it only ever answers "is the CALLER (auth.uid())
-- an admin" — it can't be used to check anyone else's role.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'ADMIN'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- admin_dashboard_stats(): headline counts for /admin.
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start timestamptz := date_trunc('month', now());
  v_today_start timestamptz := date_trunc('day', now());
  v_30d_ago timestamptz := now() - interval '30 days';
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'total_users', (select count(*) from public.users),
    'active_30d', (
      select count(*) from public.users u
      where greatest(
        coalesce((select au.last_sign_in_at from auth.users au where au.id = u.id), 'epoch'::timestamptz),
        coalesce((select max(l.created_at) from public.ai_usage_logs l where l.user_id = u.id), 'epoch'::timestamptz),
        coalesce((select max(c.updated_at) from public.collaborations c where c.user_id = u.id), 'epoch'::timestamptz)
      ) >= v_30d_ago
    ),
    'free_users', (select count(*) from public.users where upper(plan_tier) = 'FREE'),
    'basic_users', (select count(*) from public.users where upper(plan_tier) = 'BASIC'),
    'pro_users', (select count(*) from public.users where upper(plan_tier) = 'PRO'),
    'ai_calls_today', (select count(*) from public.ai_usage_logs where created_at >= v_today_start),
    'ai_calls_month', (select count(*) from public.ai_usage_logs where created_at >= v_month_start),
    'photo_analysis_month', (select count(*) from public.ai_usage_logs where created_at >= v_month_start and feature = 'VISION_ANALYSIS'),
    'blog_generation_month', (select count(*) from public.ai_usage_logs where created_at >= v_month_start and operation = 'BLOG_WRITE'),
    'ai_failures_month', (select count(*) from public.ai_usage_logs where created_at >= v_month_start and status = 'failed')
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_dashboard_stats() from public;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- admin_list_users(): /admin/users table, with search + filters applied
-- server-side so non-admins never receive any rows to begin with.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users(
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
  fail_count_month bigint
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
      u.id,
      u.email,
      u.created_at,
      greatest(
        coalesce(au.last_sign_in_at, 'epoch'::timestamptz),
        coalesce((select max(l.created_at) from public.ai_usage_logs l where l.user_id = u.id), 'epoch'::timestamptz),
        coalesce((select max(c.updated_at) from public.collaborations c where c.user_id = u.id), 'epoch'::timestamptz)
      ) as last_active_at,
      u.plan_tier,
      u.role,
      (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start) as ai_calls_month,
      (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start and l.feature = 'VISION_ANALYSIS') as photo_analysis_month,
      (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start and l.operation = 'BLOG_WRITE') as blog_generation_month,
      (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start and l.status = 'failed') as fail_count_month
    from public.users u
    left join auth.users au on au.id = u.id
    where
      (p_search is null or p_search = '' or u.email ilike '%' || p_search || '%')
      and (p_plan is null or p_plan = '' or upper(u.plan_tier) = upper(p_plan))
  )
  select * from base
  where
    p_active is null or p_active = ''
    or (p_active = 'ACTIVE' and last_active_at >= v_30d_ago)
    or (p_active = 'INACTIVE' and last_active_at < v_30d_ago)
  order by created_at desc;
end;
$$;

revoke all on function public.admin_list_users(text, text, text) from public;
grant execute on function public.admin_list_users(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_user_detail(): /admin/users/[id]. Returns only operational metadata
-- from ai_usage_logs (feature/operation/status/tokens/timestamps) — never
-- prompt or response content, since ai_usage_logs never stores that to begin
-- with, and this function doesn't touch collaborations/contents/photos body
-- columns at all.
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
    'recent_logs', (
      select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) from (
        select id, feature, operation, status, error_type, provider, model, input_tokens, output_tokens, created_at
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

-- ---------------------------------------------------------------------------
-- admin_usage_grouped(): raw material for /admin/usage. Pre-grouped in SQL
-- (by day/user/feature/operation/status/provider/model) so the result set
-- stays small; $ cost itself is computed in application code from
-- src/lib/ai/pricing.ts, never in SQL, so pricing changes need one edit.
-- ---------------------------------------------------------------------------
create or replace function public.admin_usage_grouped(p_start timestamptz, p_end timestamptz)
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
  output_tokens bigint
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
    coalesce(sum(l.output_tokens), 0)::bigint as output_tokens
  from public.ai_usage_logs l
  join public.users u on u.id = l.user_id
  where l.created_at >= p_start and l.created_at < p_end
  group by date(l.created_at), l.user_id, u.email, l.feature, l.operation, l.status, l.provider, l.model;
end;
$$;

revoke all on function public.admin_usage_grouped(timestamptz, timestamptz) from public;
grant execute on function public.admin_usage_grouped(timestamptz, timestamptz) to authenticated;
