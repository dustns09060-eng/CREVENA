-- STEP45.2 POST-MIGRATION VERIFY — READ ONLY. SELECT statements only.
--
-- NOT a migration. Run by hand in the Supabase SQL Editor AFTER applying
-- supabase/migrations/0024_payment_record_retention.sql, and compare each
-- result against the matching query in 0024_precheck.sql.
--
-- Contains no INSERT/UPDATE/DELETE/ALTER/DROP.

-- 1) FK behaviour must now be SET NULL on all three changed constraints.
--    Expected AFTER:
--      payment_events_user_id_fkey        -> SET NULL
--      payment_refunds_user_id_fkey       -> SET NULL
--      payment_refunds_requested_by_fkey  -> SET NULL
--      payment_refunds_payment_event_id_fkey -> NO ACTION (unchanged, intended)
select
  rel.relname as table_name,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as definition,
  case con.confdeltype
    when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'  when 'd' then 'SET DEFAULT'
  end as on_delete
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname in ('payment_events', 'payment_refunds')
  and con.contype = 'f'
order by rel.relname, con.conname;

-- Hard assertion: this must return ZERO rows.
select rel.relname, con.conname, 'STILL CASCADING' as problem
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname in ('payment_events', 'payment_refunds')
  and con.contype = 'f'
  and con.confdeltype <> 'n'
  and con.conname <> 'payment_refunds_payment_event_id_fkey';

-- 2) Nullability. Expected AFTER: all three = YES.
select table_name, column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'payment_events'  and column_name = 'user_id') or
    (table_name = 'payment_refunds' and column_name in ('user_id', 'requested_by'))
  )
order by table_name, column_name;

-- 3) Row counts must be IDENTICAL to the precheck. The migration only
--    changes constraints; it must not have created or destroyed a row, and
--    must not have NULLed anything on its own.
select
  (select count(*) from public.payment_events)  as payment_events_rows,
  (select count(*) from public.payment_refunds) as payment_refunds_rows,
  (select count(*) from public.payment_events  where user_id is null)      as payment_events_null_user,
  (select count(*) from public.payment_refunds where user_id is null)      as payment_refunds_null_user,
  (select count(*) from public.payment_refunds where requested_by is null) as payment_refunds_null_requested_by;

-- 4) No dangling references: every non-null user_id / requested_by must
--    still point at a live public.users row. Must return ZERO rows.
select 'payment_events.user_id' as source, count(*) as dangling
from public.payment_events e
where e.user_id is not null
  and not exists (select 1 from public.users u where u.id = e.user_id)
having count(*) > 0
union all
select 'payment_refunds.user_id', count(*)
from public.payment_refunds r
where r.user_id is not null
  and not exists (select 1 from public.users u where u.id = r.user_id)
having count(*) > 0
union all
select 'payment_refunds.requested_by', count(*)
from public.payment_refunds r
where r.requested_by is not null
  and not exists (select 1 from public.users u where u.id = r.requested_by)
having count(*) > 0
union all
select 'payment_refunds.payment_event_id', count(*)
from public.payment_refunds r
where not exists (select 1 from public.payment_events e where e.id = r.payment_event_id)
having count(*) > 0;

-- 5) RLS must still be enabled and the SELECT policies must still exist,
--    unchanged (the migration does not touch RLS). Expected:
--    relrowsecurity = true for both tables, and one
--    "users can view own payment_events"/"...payment_refunds" SELECT policy
--    each, with qual `(user_id = auth.uid())`.
select rel.relname as table_name, rel.relrowsecurity as rls_enabled
from pg_class rel
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname in ('payment_events', 'payment_refunds');

select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and tablename in ('payment_events', 'payment_refunds')
order by tablename, policyname;

-- 6) Indexes untouched (payment_events_user_period_uidx must still exist —
--    it is the per-cycle idempotency lock used by claim_billing_attempt()).
select tablename, indexname
from pg_indexes
where schemaname = 'public'
  and tablename in ('payment_events', 'payment_refunds')
order by tablename, indexname;

-- 7) Past-due backlog, re-checked (should be unchanged by the migration).
select count(*) as past_due_rows
from public.users
where next_billing_at < now();
