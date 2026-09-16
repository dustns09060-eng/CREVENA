-- CreatorFlow initial schema
-- Tables: users, collaborations, collaboration_guides, contents, schedules, creator_styles
-- Multi-tenant: every user-owned table carries user_id + RLS scoping to auth.uid()

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- users: app-level profile row, 1:1 with auth.users
-- plan_tier is a placeholder for the future paid-subscription tiers.
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  plan_tier text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- collaborations: core sponsorship record
-- status is text + check (not enum) so new statuses can be added later
-- without an ALTER TYPE migration.
-- ---------------------------------------------------------------------------
create table if not exists public.collaborations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  brand_name text not null,
  product_name text not null,
  campaign_name text,
  platform text,
  platform_site_url text,
  manager_name text,
  manager_contact text,

  provision_type text check (provision_type in ('PRODUCT', 'FEE', 'PRODUCT_AND_FEE')),
  product_price numeric,
  writing_fee numeric,

  product_received_date date,
  content_deadline date,
  payment_due_date date,

  upload_platforms text[] not null default '{}',

  required_keywords text,
  required_hashtags text,
  required_mentions text,
  required_photo_count int,
  required_video_info text,
  content_guide text,
  ad_disclosure_text text,
  memo text,

  status text not null default 'APPLIED' check (status in (
    'APPLIED', 'SELECTED', 'SHIPPING', 'RECEIVED', 'SHOOTING', 'WRITING',
    'REVIEW', 'UPLOAD_READY', 'COMPLETED', 'PAYMENT_PENDING', 'PAID'
  )),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collaborations_user_id_idx on public.collaborations(user_id);
create index if not exists collaborations_status_idx on public.collaborations(status);

-- ---------------------------------------------------------------------------
-- collaboration_guides: raw guideline text pasted from the brand,
-- kept separate from the structured fields on collaborations.
-- ---------------------------------------------------------------------------
create table if not exists public.collaboration_guides (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.collaborations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,

  raw_content text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collaboration_guides_collaboration_id_idx on public.collaboration_guides(collaboration_id);

-- ---------------------------------------------------------------------------
-- contents: AI-generated (or manually written) content per platform
-- ---------------------------------------------------------------------------
create table if not exists public.contents (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.collaborations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,

  platform text not null check (platform in (
    'INSTAGRAM_FEED', 'INSTAGRAM_REELS_CAPTION', 'INSTAGRAM_REELS_SUBTITLE',
    'NAVER_BLOG_TITLE', 'NAVER_BLOG_BODY', 'THREADS', 'COMMENT_REPLY', 'DM_REPLY'
  )),

  title text,
  body text,

  status text not null default 'DRAFT' check (status in ('DRAFT', 'REVIEW', 'APPROVED', 'POSTED')),

  ai_provider text,
  generation_input jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contents_collaboration_id_idx on public.contents(collaboration_id);
create index if not exists contents_user_id_idx on public.contents(user_id);

-- ---------------------------------------------------------------------------
-- schedules: shooting / content deadline / upload / payment dates
-- shown on the calendar
-- ---------------------------------------------------------------------------
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  collaboration_id uuid not null references public.collaborations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,

  schedule_type text not null check (schedule_type in (
    'SHOOTING', 'CONTENT_DEADLINE', 'UPLOAD', 'PAYMENT'
  )),
  scheduled_date date not null,
  title text,
  memo text,
  is_completed boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists schedules_collaboration_id_idx on public.schedules(collaboration_id);
create index if not exists schedules_user_id_date_idx on public.schedules(user_id, scheduled_date);

-- ---------------------------------------------------------------------------
-- creator_styles: user's writing-style presets/samples for the AI prompt
-- ---------------------------------------------------------------------------
create table if not exists public.creator_styles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  style_name text not null,
  sample_text text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_styles_user_id_idx on public.creator_styles(user_id);

-- ---------------------------------------------------------------------------
-- updated_at auto-touch trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.users;
create trigger set_updated_at before update on public.users
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.collaborations;
create trigger set_updated_at before update on public.collaborations
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.collaboration_guides;
create trigger set_updated_at before update on public.collaboration_guides
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.contents;
create trigger set_updated_at before update on public.contents
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.schedules;
create trigger set_updated_at before update on public.schedules
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.creator_styles;
create trigger set_updated_at before update on public.creator_styles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- auto-create a public.users row when a new auth user signs up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security: every user only ever sees their own rows
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.collaborations enable row level security;
alter table public.collaboration_guides enable row level security;
alter table public.contents enable row level security;
alter table public.schedules enable row level security;
alter table public.creator_styles enable row level security;

drop policy if exists "users can view own profile" on public.users;
create policy "users can view own profile" on public.users
  for select using (id = auth.uid());
drop policy if exists "users can update own profile" on public.users;
create policy "users can update own profile" on public.users
  for update using (id = auth.uid());

drop policy if exists "users manage own collaborations" on public.collaborations;
create policy "users manage own collaborations" on public.collaborations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "users manage own collaboration_guides" on public.collaboration_guides;
create policy "users manage own collaboration_guides" on public.collaboration_guides
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "users manage own contents" on public.contents;
create policy "users manage own contents" on public.contents
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "users manage own schedules" on public.schedules;
create policy "users manage own schedules" on public.schedules
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "users manage own creator_styles" on public.creator_styles;
create policy "users manage own creator_styles" on public.creator_styles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
