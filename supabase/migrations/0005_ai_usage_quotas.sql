-- STEP 18: monthly AI quota, enforced atomically via a SECURITY DEFINER function
-- so concurrent requests cannot race past the limit. Rate limiting (short window)
-- is handled in application code against the existing ai_usage_logs table and
-- does not need this level of strictness.

create table if not exists public.ai_usage_quotas (
  user_id uuid not null references public.users(id) on delete cascade,
  period text not null, -- 'YYYY-MM', UTC, computed server-side
  used_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period)
);

alter table public.ai_usage_quotas enable row level security;

drop policy if exists "users can view own ai_usage_quotas" on public.ai_usage_quotas;
create policy "users can view own ai_usage_quotas" on public.ai_usage_quotas
  for select using (user_id = auth.uid());
-- No insert/update policy: all writes go through increment_ai_quota() below.

-- Atomically increments the caller's quota counter for the given period,
-- but only if it is still under p_limit. Returns the resulting count and
-- whether the increment was allowed. Identity comes from auth.uid(), not
-- from a parameter, so a caller cannot spoof another user's quota.
create or replace function public.increment_ai_quota(p_period text, p_limit int)
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
  values (v_user_id, p_period, 1)
  on conflict (user_id, period)
  do update set used_count = q.used_count + 1, updated_at = now()
  where q.used_count < p_limit
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

revoke all on function public.increment_ai_quota(text, int) from public;
grant execute on function public.increment_ai_quota(text, int) to authenticated;
