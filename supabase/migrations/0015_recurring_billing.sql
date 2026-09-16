-- STEP 28: recurring subscription billing (auto-charge when next_billing_at
-- is due), a failure/retry lifecycle (ACTIVE -> PAST_DUE -> EXPIRED), and
-- locking down the STEP27 billing-key column that turned out to be
-- selectable by the owning user via a plain REST query — RLS only
-- restricts ROWS, not COLUMNS, and migration 0007 only ever locked down
-- UPDATE on public.users, never SELECT. A billing key is a live payment
-- credential; nothing except our own server (via the service-role client)
-- should ever be able to read it back.

alter table public.users
  add column if not exists retry_count int not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_payment_failed_at timestamptz,
  add column if not exists last_payment_error_type text;

revoke select (payment_subscription_id) on public.users from authenticated, anon;

-- ---------------------------------------------------------------------------
-- payment_events: fields needed for recurring charges, plus the partial
-- unique index that is the actual concurrency/idempotency guard for the
-- scheduler (see claim_billing_attempt below). billing_period_start is the
-- ORIGINAL due date being billed for and never moves while a cycle is being
-- retried (only a successful charge advances it, in the cron route) — that
-- stability is what lets the unique index act as a per-cycle lock across
-- however many retries a cycle takes.
-- ---------------------------------------------------------------------------
alter table public.payment_events
  add column if not exists billing_period_start timestamptz,
  add column if not exists kind text not null default 'INITIAL' check (kind in ('INITIAL', 'RECURRING')),
  add column if not exists error_code text,
  add column if not exists error_type text;

create unique index if not exists payment_events_user_period_uidx
  on public.payment_events(user_id, billing_period_start)
  where billing_period_start is not null;

-- ---------------------------------------------------------------------------
-- claim_billing_attempt(): the ONLY way a recurring-charge attempt row gets
-- created. Atomically claims the (user, billing_period_start) slot via
-- INSERT ... ON CONFLICT: if another process already has a live attempt for
-- this exact cycle (status still PENDING and recent — e.g. a second cron
-- tick firing while the first is mid-charge) or has already resolved it
-- (PAID, or FAILED but not yet due for retry), this returns no row and the
-- caller must skip that user rather than charge again. A PENDING attempt
-- older than 10 minutes is treated as abandoned (server crashed mid-charge)
-- and can be reclaimed, which is what makes a server restart safe to retry
-- instead of leaving the cycle stuck forever.
--
-- Deliberately plain SQL/SECURITY INVOKER, not SECURITY DEFINER: this only
-- ever needs to run as the service-role client (used exclusively by
-- /api/cron/billing after verifying CRON_SECRET), which already bypasses
-- RLS and grants via its BYPASSRLS role attribute — the same reason
-- confirm-payment's service-role writes to payment_events work today with
-- no INSERT/UPDATE policy defined. Not granted to authenticated/anon, so a
-- normal user has no path to invoke it via PostgREST at all.
-- ---------------------------------------------------------------------------
create or replace function public.claim_billing_attempt(
  p_user_id uuid,
  p_billing_period_start timestamptz,
  p_plan text,
  p_amount int,
  p_payment_id text
)
returns setof public.payment_events
language sql
as $$
  insert into public.payment_events (user_id, payment_id, plan, amount, status, provider, kind, billing_period_start)
  values (p_user_id, p_payment_id, p_plan, p_amount, 'PENDING', 'PORTONE_TOSSPAYMENTS', 'RECURRING', p_billing_period_start)
  on conflict (user_id, billing_period_start) where billing_period_start is not null
  do update set
    payment_id = excluded.payment_id,
    status = 'PENDING',
    error_code = null,
    error_type = null,
    updated_at = now()
  where
    public.payment_events.status = 'FAILED'
    or (public.payment_events.status = 'PENDING' and public.payment_events.updated_at < now() - interval '10 minutes')
  returning *;
$$;

revoke all on function public.claim_billing_attempt(uuid, timestamptz, text, int, text) from public;

-- ---------------------------------------------------------------------------
-- admin_user_detail(): surface the new retry/failure fields and recent
-- payment history, and stop returning the raw billing key — admins get a
-- has_billing_key boolean instead, matching the "never show the actual
-- secret/billing key value on screen" rule from this step.
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
