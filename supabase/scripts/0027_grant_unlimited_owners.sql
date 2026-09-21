-- STEP48 GRANT — WRITES DATA. Run ONLY after 0027_unlimited_owner_accounts.sql
-- has been applied and 0027_postcheck.sql looked right.
--
-- Turns the "운영자 무제한" flag on for EXACTLY these two existing accounts:
--   dustns0906@kakao.com, dustns0906@naver.com
-- It changes nothing else: no plan_tier, role, subscription, payment or
-- credit data, and it never creates an account. An account that doesn't
-- exist is simply skipped (the verification below then lists fewer than 2).
--
-- Safe to re-run. To switch it off again, run 0027_revoke_unlimited_owners.sql.

do $$
declare
  v_updated int;
begin
  update public.users u
     set is_unlimited = true
   where u.id in (
     select a.id
     from auth.users a
     where lower(btrim(a.email)) in ('dustns0906@kakao.com', 'dustns0906@naver.com')
   );
  get diagnostics v_updated = row_count;

  -- Hard stop: this script may never flag more than the two owner accounts.
  -- Raising rolls the whole statement back.
  if v_updated > 2 then
    raise exception 'refusing: % rows matched (expected at most 2)', v_updated;
  end if;
  raise notice 'is_unlimited set on % account(s)', v_updated;
end $$;

-- Verify. Expected: exactly the two owner emails, nobody else.
select lower(btrim(a.email)) as email, p.is_unlimited, p.role, p.plan_tier
from public.users p
join auth.users a on a.id = p.id
where p.is_unlimited = true
order by 1;
