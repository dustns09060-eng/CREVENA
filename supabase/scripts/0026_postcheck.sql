-- STEP47 POST-MIGRATION VERIFY — READ ONLY. SELECT statements only.
--
-- NOT a migration. Run by hand in the Supabase SQL Editor AFTER applying
-- supabase/migrations/0026_photo_select_state.sql, and compare each result
-- against the matching query in 0026_precheck.sql.
--
-- Contains no INSERT/UPDATE/DELETE/ALTER/DROP.

-- 1) The column must now exist, and must be exactly: jsonb, NULLABLE, NO
--    default. Any other result means the wrong DDL ran.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'collaborations'
  and column_name  = 'photo_select';

-- Hard assertion: must return ZERO rows.
select 'WRONG SHAPE - REGRESSION' as problem, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'collaborations'
  and column_name  = 'photo_select'
  and (data_type <> 'jsonb' or is_nullable <> 'YES' or column_default is not null);

-- 2) No CHECK constraint was added for the new column (0026 deliberately
--    adds none — the shape is validated in TypeScript). Expected: ZERO rows.
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel    on rel.oid = con.conrelid
join pg_namespace ns on ns.oid  = rel.relnamespace
where ns.nspname = 'public'
  and rel.relname = 'collaborations'
  and con.contype  = 'c'
  and pg_get_constraintdef(con.oid) ilike '%photo_select%';

-- 3) Nothing else about the table changed. The column list must equal the
--    precheck's list PLUS exactly one new entry (photo_select), and the
--    count must be precheck_count + 1.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'collaborations'
order by ordinal_position;

select count(*) as collaborations_column_count
from information_schema.columns
where table_schema = 'public' and table_name = 'collaborations';

-- 4) No data was rewritten. Must equal the precheck number EXACTLY, and
--    every pre-existing row must still have NULL in the new column.
select count(*) as total_collaborations_rows from public.collaborations;

select count(*) as rows_with_non_null_photo_select
from public.collaborations
where photo_select is not null;
-- Expected immediately after applying: 0. It only becomes non-zero once a
-- user actually runs AI Photo Select in the app.

-- 5) RLS/policies unchanged — a column add must not have created, dropped
--    or altered any policy.
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

-- 6) collaboration_photos untouched — STEP47 adds no column and deletes no
--    row there. Must equal the precheck numbers.
select count(*) as total_collaboration_photos from public.collaboration_photos;

select count(*) as analyzed_photos
from public.collaboration_photos
where ai_analysis is not null;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'collaboration_photos'
order by ordinal_position;
-- Expected: identical to before STEP47 — id, collaboration_id, user_id,
-- storage_path, thumbnail_path, original_filename, display_order,
-- photo_type, ai_analysis, user_memo, body_section, created_at, updated_at,
-- body_edited, edited_storage_path, edited_thumbnail_path,
-- edit_preset_name, edit_intensity. NO new STEP47 column.

-- 7) Credit/quota tables untouched. Must equal the precheck numbers.
select count(*) as ai_usage_quota_rows from public.ai_usage_quotas;
select count(*) as ai_usage_reservation_rows from public.ai_usage_reservations;

-- 8) STEP47 adds no Storage-deletion capability and no new bucket.
--    Expected: exactly the pre-existing buckets, no new one.
select id, name, public from storage.buckets order by id;
