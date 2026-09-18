-- STEP47 PRECHECK — READ ONLY. SELECT statements only.
--
-- NOT a migration. This directory (supabase/scripts/) is never applied by
-- `supabase db push` / `supabase migration up`, which only read
-- supabase/migrations/. Run this by hand in the Supabase SQL Editor
-- BEFORE applying supabase/migrations/0026_photo_select_state.sql.
--
-- Contains no INSERT/UPDATE/DELETE/ALTER/DROP. Outputs column metadata and
-- row counts only — never brand/product names, guide text, review notes,
-- emails or any other user content.

-- 1) The column must NOT exist yet. Expected: ZERO rows.
--    A row here means the migration was already applied out-of-band — stop
--    and compare its definition against 0026 before doing anything else.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'collaborations'
  and column_name  = 'photo_select';

-- 2) Baseline shape of the table the migration touches, so the postcheck
--    can prove nothing else changed (names/types/nullability only).
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'collaborations'
order by ordinal_position;

select count(*) as collaborations_column_count
from information_schema.columns
where table_schema = 'public' and table_name = 'collaborations';

-- 3) Baseline row count. The migration rewrites no data, so this must be
--    unchanged afterwards.
select count(*) as total_collaborations_rows from public.collaborations;

-- 4) RLS must already be enabled on collaborations, and the existing
--    policies are what will govern the new column too (a column add never
--    creates or loosens a policy). Record these; the postcheck must match.
select relrowsecurity as rls_enabled
from pg_class rel
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relname = 'collaborations';

select polname, polcmd
from pg_policy pol
join pg_class rel on rel.oid = pol.polrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relname = 'collaborations'
order by polname;

-- 5) Baseline photo counts — STEP47 only ever READS collaboration_photos;
--    it adds no column and deletes no row there. These must be identical
--    in the postcheck.
select count(*) as total_collaboration_photos from public.collaboration_photos;

select count(*) as analyzed_photos
from public.collaboration_photos
where ai_analysis is not null;

-- 6) Credit constants are code-side (src/lib/ai/credits.ts), but the
--    quota/reservation tables must be untouched by this step. Record the
--    counts; the postcheck must match.
select count(*) as ai_usage_quota_rows from public.ai_usage_quotas;
select count(*) as ai_usage_reservation_rows from public.ai_usage_reservations;
