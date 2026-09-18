-- STEP 45.2: payment/refund record retention across account deletion.
--
-- Problem A (observed for real while testing STEP45.1's 회원탈퇴 flow):
-- /api/account/delete performs NO explicit DELETE against payment_events or
-- payment_refunds. It deletes Storage objects, then calls
-- auth.admin.deleteUser(), and every row disappears purely through the FK
-- chain auth.users -> public.users (on delete cascade, 0001) ->
-- payment_events.user_id / payment_refunds.user_id (on delete cascade,
-- 0014 / 0017). So a withdrawal silently erased the transaction ledger,
-- which conflicts with the expectation that 거래·결제 기록 survive the
-- account that produced them. [운영자 확인 필요] the exact retention period
-- is a legal/accounting decision and is deliberately NOT encoded here.
--
-- Problem B: payment_refunds.requested_by (the admin who executed a manual
-- refund) references public.users(id) with NO `on delete` action, i.e. the
-- default NO ACTION. Deleting that admin's account therefore raises a
-- foreign-key violation inside auth.admin.deleteUser() and blocks the
-- admin's own withdrawal entirely, instead of just losing the attribution.
--
-- Fix: keep the ROW, drop the reference. user_id / requested_by become
-- nullable with `on delete set null`, so the payment and refund ledgers
-- survive a withdrawal with their user pointer cleared. Deliberately NOT
-- done: copying email/name/any other PII into these tables as a
-- "snapshot" — the ledger keeps only amounts, plan, status and provider
-- identifiers it already held.
--
-- Everything else is untouched: collaborations, contents, photos, videos,
-- schedules, guides, creator_styles, photo_presets, ai_usage_* all keep
-- their `on delete cascade` and are still removed by a withdrawal, as are
-- Storage objects (removed explicitly by the route, before this cascade).
--
-- RLS is intentionally left as-is. Both tables' only policy is
-- `for select using (user_id = auth.uid())`. For a NULLed row that
-- predicate evaluates to NULL, never true, so a withdrawn member's
-- retained rows become invisible to every normal user — including the
-- next person to be issued any uuid — without a policy change. Adding a
-- `user_id is not null` guard would be redundant. Writes stay service-role
-- only (no insert/update/delete policy exists on either table).
--
-- Indexes are left as-is as well: payment_events_user_id_idx and
-- payment_refunds_user_idx simply stop matching the NULLed rows, and the
-- partial unique index payment_events_user_period_uidx (0015) treats NULLs
-- as distinct, so retained rows can never collide with a live user's
-- billing cycle or interfere with claim_billing_attempt().

-- ---------------------------------------------------------------------------
-- payment_events.user_id : not null + cascade  ->  nullable + set null
-- ---------------------------------------------------------------------------
alter table public.payment_events
  drop constraint if exists payment_events_user_id_fkey;

alter table public.payment_events
  alter column user_id drop not null;

alter table public.payment_events
  add constraint payment_events_user_id_fkey
  foreign key (user_id) references public.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- payment_refunds.user_id : not null + cascade  ->  nullable + set null
-- ---------------------------------------------------------------------------
alter table public.payment_refunds
  drop constraint if exists payment_refunds_user_id_fkey;

alter table public.payment_refunds
  alter column user_id drop not null;

alter table public.payment_refunds
  add constraint payment_refunds_user_id_fkey
  foreign key (user_id) references public.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- payment_refunds.requested_by : already nullable, but NO ACTION — deleting
-- the admin who processed a refund currently fails with an FK violation.
-- ---------------------------------------------------------------------------
alter table public.payment_refunds
  drop constraint if exists payment_refunds_requested_by_fkey;

alter table public.payment_refunds
  add constraint payment_refunds_requested_by_fkey
  foreign key (requested_by) references public.users(id) on delete set null;

-- payment_refunds.payment_event_id is deliberately NOT touched. It still
-- references payment_events(id) with NO ACTION, which is now harmless and
-- in fact desirable: payment_events rows are no longer deleted by a
-- withdrawal, so a refund can never be orphaned from its payment.
