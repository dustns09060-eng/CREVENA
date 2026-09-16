-- STEP 30 audit finding (MEDIUM): ai_usage_logs' RLS policy was "for all"
-- (select/insert/update/delete) scoped to the owning user. App code only
-- ever INSERTs (src/lib/ai/usage.ts) and SELECTs (rate-limit check) — it
-- never updates or deletes a log row. The excess UPDATE/DELETE privilege let
-- a user tamper with or erase their own usage history, which admin's cost
-- and abuse-audit views (/admin/usage, admin_user_detail's recent/failed
-- logs) rely on being an honest append-only record. Credits themselves are
-- unaffected (they live in ai_usage_quotas/ai_usage_reservations, which
-- already have no user-writable policy), so this is a data-integrity/audit
-- fix, not a billing exploit fix.
drop policy if exists "users manage own ai_usage_logs" on public.ai_usage_logs;

drop policy if exists "users can view own ai_usage_logs" on public.ai_usage_logs;
create policy "users can view own ai_usage_logs" on public.ai_usage_logs
  for select using (user_id = auth.uid());

drop policy if exists "users can insert own ai_usage_logs" on public.ai_usage_logs;
create policy "users can insert own ai_usage_logs" on public.ai_usage_logs
  for insert with check (user_id = auth.uid());
