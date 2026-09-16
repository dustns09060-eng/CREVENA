-- STEP 20: the same 8-field "후기 메모" form was duplicated in both the
-- content studio (/content) and the photo blog studio (/photos) as pure
-- client state, so a user retyping it in one screen lost it when visiting
-- the other, and lost it entirely on navigating away before generating.
-- Persist it once per collaboration and share it across both screens.
alter table public.collaborations
  add column if not exists review_notes jsonb not null default '{}'::jsonb;
