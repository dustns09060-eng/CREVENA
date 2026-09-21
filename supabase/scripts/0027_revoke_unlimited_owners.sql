-- STEP48 REVOKE — WRITES DATA. Turns "운영자 무제한" off for EVERY account.
-- Nobody but the two owner accounts is ever supposed to have it, so this is
-- simply the off switch. Afterwards the accounts fall back to their normal
-- plan_tier limits. Their usage history in ai_usage_logs / ai_usage_quotas
-- is untouched.

update public.users set is_unlimited = false where is_unlimited = true;

-- Expected: 0
select count(*) as accounts_still_unlimited from public.users where is_unlimited = true;
