-- STEP53 (Shopping Shorts Studio, Phase D-3): one product, several independent
-- short-form "versions" (A / B / C), each with its own sales angle, chosen hook,
-- photo recommendation, user photo selection and plan.
--
-- WHY A TABLE and not another key inside product_shorts_projects.reels_project:
-- versions must never overwrite each other. Rows are written independently (one
-- UPDATE per version row, touching only that row), so saving/regenerating version A
-- cannot change B or C, and two tabs saving different versions cannot lose each
-- other's work. A single jsonb blob that is read-modify-written as a whole could.
--
-- product_shorts_projects.reels_project stays exactly as it is: it keeps serving
-- the existing single-plan projects (V1) unchanged. No existing data is migrated,
-- converted or touched. Purely additive: one new table.
--
-- Not applied automatically. Run supabase/scripts/0035_precheck.sql, then this
-- file, then supabase/scripts/0035_postcheck.sql. Development first; Production
-- only after that has been verified and the operator approves.

create table public.product_shorts_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,

  -- 'A' | 'B' | 'C': at most three versions per project, one row each.
  label text not null check (label in ('A', 'B', 'C')),

  -- The sales angle this version was built on ({type, title, rationale}) and the
  -- hook the user picked for it. Copied from the server-stored suggestions at
  -- creation time, never taken from client-supplied text.
  angle jsonb not null,
  hook text not null check (char_length(hook) between 1 and 200),

  -- Same shapes as ProductShortsGenerationState.{recommendation, selection, plan}.
  recommendation jsonb,
  selection jsonb,
  plan jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Ownership: the project must belong to the same user (same pattern as
  -- product_shorts_media). Deleting the project removes its versions.
  foreign key (project_id, user_id)
    references public.product_shorts_projects(id, user_id)
    on delete cascade,

  unique (project_id, label)
);

create index product_shorts_plans_user_id_idx on public.product_shorts_plans(user_id);

drop trigger if exists set_updated_at on public.product_shorts_plans;
create trigger set_updated_at before update on public.product_shorts_plans
  for each row execute function public.set_updated_at();

alter table public.product_shorts_plans enable row level security;

-- A member can SELECT / INSERT / UPDATE / DELETE only their own rows.
drop policy if exists "users manage own product_shorts_plans" on public.product_shorts_plans;
create policy "users manage own product_shorts_plans" on public.product_shorts_plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
