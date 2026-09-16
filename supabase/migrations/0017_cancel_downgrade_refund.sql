-- STEP 29: user-initiated cancellation/downgrade scheduling, and an
-- admin-only refund structure built on top of STEP27/28's payment_events.

-- scheduled_plan: the plan to switch into at the next billing-cycle
-- boundary (see /api/cron/billing). Cancellation sets it to 'FREE' together
-- with cancel_at_period_end=true (no further charge, access ends at
-- next_billing_at); a PRO->BASIC downgrade sets it to 'BASIC' with
-- cancel_at_period_end left false (the subscription continues, just at the
-- lower price starting next cycle). A brand-new column is automatically
-- UPDATE-protected against `authenticated` by the same mechanism migration
-- 0013 already relies on: 0007's REVOKE ALL + explicit GRANT (display_name)
-- covers UPDATE for the whole table, and this column was never added to
-- that allow-list.
alter table public.users
  add column if not exists scheduled_plan text check (scheduled_plan in ('FREE', 'BASIC', 'PRO'));

-- ---------------------------------------------------------------------------
-- payment_refunds: the refund ledger. Idempotency works exactly like
-- payment_events' payment_id (STEP27) and ai_usage_reservations (STEP24) —
-- a UNIQUE idempotency_key, generated once per refund action and inserted
-- as PENDING before ever calling PortOne's cancel API, so a double-click or
-- a retried request lands on the existing row instead of refunding twice.
--
-- RLS mirrors payment_events: only a SELECT policy scoped to the owning
-- user exists. With RLS enabled and no INSERT/UPDATE/DELETE policy defined,
-- those commands are unconditionally denied for `authenticated` regardless
-- of any table-level grant (RLS requires a passing policy AND a grant, not
-- either alone) — every actual write happens through the service-role
-- client inside /api/admin/refund, after independently re-verifying the
-- remaining refundable amount from payment_events + prior successful
-- refunds, never from a client-supplied "remaining" figure.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_event_id uuid not null references public.payment_events(id),
  user_id uuid not null references public.users(id) on delete cascade,
  refund_amount int not null check (refund_amount > 0),
  reason text,
  status text not null default 'PENDING' check (status in ('PENDING', 'SUCCEEDED', 'FAILED')),
  provider_refund_id text,
  requested_by uuid references public.users(id),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists payment_refunds_payment_event_idx on public.payment_refunds(payment_event_id);
create index if not exists payment_refunds_user_idx on public.payment_refunds(user_id, created_at);

drop trigger if exists set_updated_at on public.payment_refunds;
create trigger set_updated_at before update on public.payment_refunds
  for each row execute function public.set_updated_at();

alter table public.payment_refunds enable row level security;

drop policy if exists "users can view own payment_refunds" on public.payment_refunds;
create policy "users can view own payment_refunds" on public.payment_refunds
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- admin_user_detail(): surface scheduled_plan and recent refund history.
-- Still never returns the raw billing key (has_billing_key boolean only,
-- unchanged from 0015).
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
    'scheduled_plan', u.scheduled_plan,
    'payment_provider', u.payment_provider,
    'payment_customer_id', u.payment_customer_id,
    'has_billing_key', (u.payment_subscription_id is not null),
    'retry_count', u.retry_count,
    'next_retry_at', u.next_retry_at,
    'last_payment_failed_at', u.last_payment_failed_at,
    'last_payment_error_type', u.last_payment_error_type,
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
    ),
    'recent_payments', (
      select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) from (
        select id, kind, plan, amount, status, error_type, created_at
        from public.payment_events
        where user_id = u.id
        order by created_at desc
        limit 10
      ) r
    ),
    'recent_refunds', (
      select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) from (
        select id, payment_event_id, refund_amount, reason, status, created_at
        from public.payment_refunds
        where user_id = u.id
        order by created_at desc
        limit 10
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
