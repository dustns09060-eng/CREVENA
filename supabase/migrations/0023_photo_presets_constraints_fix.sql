-- STEP43.5 fix: the live photo_presets table (created from an earlier draft
-- of 0022) is missing updated_at, its CHECK constraints, and its UNIQUE
-- constraint. Verified via read-only probing (empty preset_name, empty {}
-- settings, and a duplicate name all wrongly succeeded; SELECT updated_at
-- errored with "column does not exist"). This migration brings the live
-- table up to the intended 0022 shape without dropping/recreating it, so no
-- existing photo_presets rows are touched.

alter table public.photo_presets
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_updated_at on public.photo_presets;
create trigger set_updated_at before update on public.photo_presets
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.photo_presets'::regclass
      and conname = 'photo_presets_preset_name_check'
  ) then
    alter table public.photo_presets
      add constraint photo_presets_preset_name_check check (length(trim(preset_name)) > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.photo_presets'::regclass
      and conname = 'photo_presets_settings_check'
  ) then
    alter table public.photo_presets
      add constraint photo_presets_settings_check check (settings <> '{}'::jsonb);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.photo_presets'::regclass
      and conname = 'photo_presets_user_id_preset_name_key'
  ) then
    alter table public.photo_presets
      add constraint photo_presets_user_id_preset_name_key unique (user_id, preset_name);
  end if;
end $$;
