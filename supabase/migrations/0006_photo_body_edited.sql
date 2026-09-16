-- STEP 19: track whether a photo's body paragraph was manually edited by the
-- user, so a full blog regeneration doesn't silently overwrite their edits.
alter table public.collaboration_photos
  add column if not exists body_edited boolean not null default false;
