-- STEP 27: idempotency ledger for PortOne V2 + Toss Payments billing-key
-- charges. A row is inserted with status='PENDING' BEFORE the card is ever
-- charged, using payment_id's UNIQUE constraint as the concurrency guard —
-- if the client submits the same paymentId twice (double-click, retry, or
-- a malicious replay of a callback), the second attempt's insert fails and
-- the request is answered from this table instead of charging the card or
-- the user's plan a second time.
--
-- No insert/update/delete policy for `authenticated`: every write goes
-- through the service-role client inside the trusted
-- /api/billing/confirm-payment route, after independently verifying the
-- charge with PortOne's server API — never based on a client-supplied
-- "it succeeded" claim. Same reasoning as ai_usage_quotas (STEP18) and
-- ai_usage_reservations (STEP24).
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  payment_id text not null unique,
  plan text not null check (plan in ('BASIC', 'PRO')),
  amount int not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'FAILED')),
  provider text not null default 'PORTONE_TOSSPAYMENTS',
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_events_user_id_idx on public.payment_events(user_id, created_at);

drop trigger if exists set_updated_at on public.payment_events;
create trigger set_updated_at before update on public.payment_events
  for each row execute function public.set_updated_at();

alter table public.payment_events enable row level security;

drop policy if exists "users can view own payment_events" on public.payment_events;
create policy "users can view own payment_events" on public.payment_events
  for select using (user_id = auth.uid());
