-- STEP 26: subscription lifecycle fields, integrated into public.users
-- rather than a new table — plan_tier already IS "current_plan", so it is
-- reused as-is (no duplicate column) and only the missing lifecycle fields
-- are added alongside it.
--
-- Protection: migration 0007 already revoked column-level UPDATE on
-- public.users from `authenticated` except display_name, and a newly added
-- column is NOT automatically included in that column-list grant. So every
-- column below is self-update-proof the moment it exists, exactly like
-- plan_tier (STEP19) and role (STEP23) — no extra grant/revoke needed here.

alter table public.users
  add column if not exists subscription_status text not null default 'NONE'
    check (subscription_status in ('NONE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')),
  add column if not exists subscription_started_at timestamptz,
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists next_billing_at timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists payment_provider text,
  add column if not exists payment_customer_id text,
  add column if not exists payment_subscription_id text;

-- ---------------------------------------------------------------------------
-- admin_apply_subscription(): the only write path for plan_tier/subscription
-- fields other than a future payment-provider webhook (which will use the
-- service-role key directly, bypassing RLS/grants entirely, once a provider
-- is chosen — see src/app/api/webhooks/subscription/route.ts). Gated by
-- is_admin() so only an admin's own session can call it. No UI button calls
-- this yet (STEP26 intentionally ships no "change plan" button) — it exists
-- so the write path itself can be built and tested securely ahead of time.
--
-- Deliberately does NOT enforce upgrade/downgrade timing rules (e.g.
-- "PRO→FREE takes effect at period end") — that's a decision for whatever
-- future caller (admin action or webhook handler) invokes this with the
-- fields already set accordingly (e.g. cancel_at_period_end=true while
-- plan_tier stays PRO until a later job applies the actual downgrade).
-- ---------------------------------------------------------------------------
create or replace function public.admin_apply_subscription(
  p_user_id uuid,
  p_plan text,
  p_subscription_status text,
  p_started_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_next_billing_at timestamptz default null,
  p_cancel_at_period_end boolean default false,
  p_payment_provider text default null,
  p_payment_customer_id text default null,
  p_payment_subscription_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_plan not in ('FREE', 'BASIC', 'PRO') then
    raise exception 'invalid plan: %', p_plan;
  end if;
  if p_subscription_status not in ('NONE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED') then
    raise exception 'invalid subscription_status: %', p_subscription_status;
  end if;

  update public.users
  set
    plan_tier = p_plan,
    subscription_status = p_subscription_status,
    subscription_started_at = p_started_at,
    subscription_expires_at = p_expires_at,
    next_billing_at = p_next_billing_at,
    cancel_at_period_end = p_cancel_at_period_end,
    payment_provider = p_payment_provider,
    payment_customer_id = p_payment_customer_id,
    payment_subscription_id = p_payment_subscription_id
  where id = p_user_id;

  if not found then
    raise exception 'user not found';
  end if;
end;
$$;

revoke all on function public.admin_apply_subscription(
  uuid, text, text, timestamptz, timestamptz, timestamptz, boolean, text, text, text
) from public;
grant execute on function public.admin_apply_subscription(
  uuid, text, text, timestamptz, timestamptz, timestamptz, boolean, text, text, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_user_detail(): surface the new subscription fields. Return type is
-- still jsonb, so no drop needed.
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
    'subscription_status', u.subscription_status,
    'subscription_started_at', u.subscription_started_at,
    'subscription_expires_at', u.subscription_expires_at,
    'next_billing_at', u.next_billing_at,
    'cancel_at_period_end', u.cancel_at_period_end,
    'payment_provider', u.payment_provider,
    'payment_customer_id', u.payment_customer_id,
    'payment_subscription_id', u.payment_subscription_id,
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
