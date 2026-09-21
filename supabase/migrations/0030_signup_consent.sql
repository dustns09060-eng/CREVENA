-- STEP49 (release legal blockers, PR B): enforce signup consent in the database
-- and keep a record of it.
--
-- WHY THE DATABASE: signUp() is called from the browser straight to Supabase
-- Auth (src/app/login/page.tsx). The Next.js server is never in that path, and
-- the project URL and anon key are public, so a checkbox in the form can be
-- bypassed by anyone calling {SUPABASE_URL}/auth/v1/signup directly. The only
-- place every signup passes through is the auth.users AFTER INSERT trigger
-- (on_auth_user_created -> handle_new_user()), which runs inside GoTrue's
-- transaction. Raising there aborts the signup itself: no auth.users row, no
-- public.users row, no confirmation e-mail.
--
-- WHAT IS ENFORCED (all must be present in auth user metadata at signup):
--   raw_user_meta_data.consent = {
--     "age_over_14": true,            -- boolean true; the string "true" is rejected
--     "age_version": "<version>",
--     "terms_version": "<version>",
--     "privacy_version": "<version>"
--   }
-- Each version must match ^[A-Za-z0-9._-]{1,32}$. The versions come from
-- src/lib/legal-docs.ts. The database does not know which versions are
-- "current" (so a copy change never needs a migration); it records what was
-- sent and requires that it is present and well-formed. The timestamp is
-- always the database's now(), never a client-supplied value.
--
-- WHO IS NOT AFFECTED: existing accounts. The trigger fires on INSERT only, so
-- logging in, refreshing sessions, password resets and e-mail confirmation of
-- an already-created user never reach it. Nobody is blocked and no existing
-- account gets a consent row: existing members are deliberately NOT marked as
-- having consented.
--
-- OPERATIONAL NOTE: any way of creating an auth user that does not pass the
-- consent metadata now fails — including auth.admin.createUser() from scripts
-- and "Add user" in the Supabase dashboard. That is the intent (there is no
-- backdoor), but scripts that create disposable test accounts must pass
-- user_metadata: { consent: { ... } } like the signup form does.
--
-- DEPLOY ORDER: ship the app change first, THEN apply this migration. The other
-- order makes every signup fail (with a generic error) until the new form is
-- live; this order only leaves a short window where the form asks but the
-- database does not yet enforce or record.
--
-- Not applied automatically. Run supabase/scripts/0030_precheck.sql, then this
-- file, then supabase/scripts/0030_postcheck.sql.

-- ---------------------------------------------------------------------------
-- 1) The consent record: append-only, one row per (member, consent type, version).
-- ---------------------------------------------------------------------------
create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  -- SET NULL, not CASCADE: the row is evidence that consent was obtained and
  -- holds no personal data of its own (a type, a version and a time). It
  -- therefore survives a withdrawal with the member link removed, the same
  -- retention posture 0024 gave the payment ledger. [법률 검토 필요] whether it
  -- may/must be kept, and for how long. Switching to CASCADE later is a
  -- one-line constraint change; recovering deleted evidence is impossible.
  user_id uuid references public.users(id) on delete set null,
  consent_type text not null check (consent_type in ('AGE_14', 'TERMS', 'PRIVACY')),
  document_version text not null check (document_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  agreed_at timestamptz not null default now(),
  -- SIGNUP: written by the trigger below. REPROMPT is reserved for a future
  -- re-consent screen for existing members; nothing writes it yet.
  source text not null check (source in ('SIGNUP', 'REPROMPT')),
  created_at timestamptz not null default now()
);

create unique index if not exists user_consents_user_type_version_uidx
  on public.user_consents(user_id, consent_type, document_version)
  where user_id is not null;

create index if not exists user_consents_user_idx on public.user_consents(user_id);

-- ---------------------------------------------------------------------------
-- 2) Access: a member may read only their own rows; nobody but the trusted
--    database path (and service_role) can write. Supabase grants ALL on new
--    public tables to anon/authenticated by default, and a column- or
--    policy-level rule cannot narrow a table-level grant (see 0016/0028), so
--    the table-level privileges are reset explicitly.
--    With RLS enabled and no INSERT/UPDATE/DELETE policy, those writes are
--    also denied by RLS; the revoke is the second, independent lock.
-- ---------------------------------------------------------------------------
alter table public.user_consents enable row level security;

drop policy if exists "users can view own consents" on public.user_consents;
create policy "users can view own consents" on public.user_consents
  for select using (user_id = auth.uid());

revoke all on public.user_consents from anon, authenticated;
grant select on public.user_consents to authenticated;

-- ---------------------------------------------------------------------------
-- 3) handle_new_user(): identical to 0001 (creates the public.users row) plus
--    the consent check and the consent rows. CREATE OR REPLACE keeps the
--    existing on_auth_user_created trigger attached; nothing about it changes.
--    SECURITY DEFINER lets it write user_consents regardless of the caller's
--    (GoTrue's) own privileges; the table owner bypasses RLS.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_consent jsonb := new.raw_user_meta_data -> 'consent';
  v_age_version text := v_consent ->> 'age_version';
  v_terms_version text := v_consent ->> 'terms_version';
  v_privacy_version text := v_consent ->> 'privacy_version';
begin
  -- Every comparison below is written so that a missing key (NULL) fails the
  -- check instead of slipping through ("null is not true" is true).
  if jsonb_typeof(v_consent) is distinct from 'object'
     or (v_consent -> 'age_over_14') is distinct from 'true'::jsonb
     or (v_age_version ~ '^[A-Za-z0-9._-]{1,32}$') is not true
     or (v_terms_version ~ '^[A-Za-z0-9._-]{1,32}$') is not true
     or (v_privacy_version ~ '^[A-Za-z0-9._-]{1,32}$') is not true
  then
    raise exception 'signup_consent_required';
  end if;

  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.user_consents (user_id, consent_type, document_version, source)
  values
    (new.id, 'AGE_14', v_age_version, 'SIGNUP'),
    (new.id, 'TERMS', v_terms_version, 'SIGNUP'),
    (new.id, 'PRIVACY', v_privacy_version, 'SIGNUP');

  return new;
end;
$$;
