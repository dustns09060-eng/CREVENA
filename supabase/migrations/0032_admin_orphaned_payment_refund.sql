-- STEP51 (release-refund-safety): let an admin find and refund a payment
-- record that survived a withdrawal (migration 0024 SET NULLs
-- payment_events.user_id / payment_refunds.user_id on account deletion,
-- keeping the transaction ledger). Before this migration there was no way
-- for an admin to even SEE such a row: admin_user_detail() requires an
-- existing public.users row, and no admin screen queries payment_events
-- directly. /api/admin/refund's `if (!paymentUserId) return 409` guard was
-- therefore unreachable through any admin screen, not a working control.
--
-- This migration is READ-ONLY infrastructure: one new SECURITY DEFINER
-- function, gated by the existing is_admin() (0009), that lists exactly the
-- withdrawn-member PAID payment_events that still have a refundable balance.
-- It does not alter payment_events/payment_refunds/users in any way, does
-- not touch RLS, and does not grant `authenticated` or `anon` any new table
-- access — every column here is already only readable via the service-role
-- client or an is_admin()-gated function, same as admin_user_detail().
--
-- What it deliberately does NOT return: raw_response (may hold legacy PG
-- response data — see migration 0031's PR report), any billing-key column,
-- any card/customer data, and no user identity at all (there is none left
-- to return — user_id is NULL by definition for every row this lists).

create or replace function public.admin_list_orphaned_refundable_payments()
returns table (
  id uuid,
  payment_id text,
  amount int,
  status text,
  kind text,
  created_at timestamptz,
  refunded_amount int,
  remaining_amount int
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
  select
    pe.id,
    pe.payment_id,
    pe.amount,
    pe.status,
    pe.kind,
    pe.created_at,
    coalesce(r.refunded_amount, 0)::int as refunded_amount,
    (pe.amount - coalesce(r.refunded_amount, 0))::int as remaining_amount
  from public.payment_events pe
  left join (
    select payment_event_id, sum(refund_amount) as refunded_amount
    from public.payment_refunds
    where status = 'SUCCEEDED'
    group by payment_event_id
  ) r on r.payment_event_id = pe.id
  where
    pe.user_id is null
    and pe.status = 'PAID'
    and (pe.amount - coalesce(r.refunded_amount, 0)) > 0
  order by pe.created_at desc;
end;
$$;

revoke all on function public.admin_list_orphaned_refundable_payments() from public;
grant execute on function public.admin_list_orphaned_refundable_payments() to authenticated;

-- Note: granting EXECUTE to `authenticated` (not just admins) matches every
-- existing admin_*() function in this codebase (admin_dashboard_stats,
-- admin_user_detail, admin_list_users, admin_usage_grouped) — the function
-- body itself is what actually enforces ADMIN-only access via is_admin(),
-- raising 'forbidden' for anyone else. A non-admin calling this function
-- gets an error, not data; see 0032_postcheck.sql check 4/5.
