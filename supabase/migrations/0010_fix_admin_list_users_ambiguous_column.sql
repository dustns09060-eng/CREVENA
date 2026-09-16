-- Fix: admin_list_users() failed with "column reference is ambiguous" for
-- last_active_at/created_at. RETURNS TABLE(...) implicitly declares each
-- output column as a plpgsql variable in scope for the whole function body,
-- so the bare column names in the outer WHERE/ORDER BY collided with those
-- variables. Qualifying every reference with the CTE alias resolves it.
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
      (select count(*) from public.ai_usage_logs l where l.user_id = u.id and l.created_at >= v_month_start and l.status = 'failed') as b_fail_count_month
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
    base.b_fail_count_month
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
