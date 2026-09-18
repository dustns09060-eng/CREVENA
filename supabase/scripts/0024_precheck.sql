-- STEP45.2 PRECHECK — READ ONLY. SELECT statements only.
--
-- NOT a migration. This directory (supabase/scripts/) is never applied by
-- `supabase db push` / `supabase migration up`, which only read
-- supabase/migrations/. Run this by hand in the Supabase SQL Editor
-- BEFORE applying supabase/migrations/0024_payment_record_retention.sql.
--
-- Contains no INSERT/UPDATE/DELETE/ALTER/DROP. Outputs counts and
-- aggregates only — never payment_id, provider_refund_id, billing keys,
-- raw_response, emails or any other identifier.

-- 1) Current FK behaviour on the two payment tables.
--    Expected BEFORE the migration:
--      payment_events_user_id_fkey        -> ON DELETE CASCADE
--      payment_refunds_user_id_fkey       -> ON DELETE CASCADE
--      payment_refunds_requested_by_fkey  -> ON DELETE NO ACTION  (the bug)
--      payment_refunds_payment_event_id_fkey -> ON DELETE NO ACTION
select
  rel.relname          as table_name,
  con.conname          as constraint_name,
  pg_get_constraintdef(con.oid) as definition,
  case con.confdeltype
    when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'  when 'd' then 'SET DEFAULT'
  end                  as on_delete
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname in ('payment_events', 'payment_refunds')
  and con.contype = 'f'
order by rel.relname, con.conname;

-- 2) Current nullability of the columns the migration changes.
--    Expected BEFORE: payment_events.user_id = NO, payment_refunds.user_id = NO,
--                     payment_refunds.requested_by = YES
select table_name, column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'payment_events'  and column_name = 'user_id') or
    (table_name = 'payment_refunds' and column_name in ('user_id', 'requested_by'))
  )
order by table_name, column_name;

-- 3) Row counts to compare against after the migration (must be identical).
select
  (select count(*) from public.payment_events)  as payment_events_rows,
  (select count(*) from public.payment_refunds) as payment_refunds_rows,
  (select count(*) from public.payment_events  where user_id is null)      as payment_events_null_user,
  (select count(*) from public.payment_refunds where user_id is null)      as payment_refunds_null_user,
  (select count(*) from public.payment_refunds where requested_by is null) as payment_refunds_null_requested_by;

-- 4) Subscription state lives on public.users (columns, not a separate
--    subscriptions table — see migrations 0013/0015/0017).
select subscription_status, count(*) as users
from public.users
group by subscription_status
order by subscription_status;

select count(*) as active_paid_subscriptions
from public.users
where plan_tier <> 'FREE' and subscription_status = 'ACTIVE';

-- 5) *** CRITICAL *** past-due billing backlog.
--    STEP45.1 found that /api/cron/billing had never actually run (GET vs
--    POST method mismatch). If this count is > 0 there is a backlog of
--    cycles that would all be charged the moment the cron starts working.
--    DO NOT enable/trigger the cron and DO NOT bill manually until the
--    operator has reviewed the result.
select count(*) as past_due_rows
from public.users
where next_billing_at < now();

select count(*) as past_due_and_still_billable
from public.users
where next_billing_at < now()
  and plan_tier <> 'FREE'
  and subscription_status in ('ACTIVE', 'PAST_DUE');

-- Oldest/newest past-due due-date (returns no rows when there is no backlog).
select
  min(next_billing_at) as oldest_past_due,
  max(next_billing_at) as newest_past_due,
  count(*)             as past_due_rows
from public.users
where next_billing_at < now()
having count(*) > 0;

-- 6) RLS baseline, to compare against after the migration.
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('payment_events', 'payment_refunds')
order by tablename, policyname;
