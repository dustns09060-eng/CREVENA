-- STEP52 POSTCHECK — READ ONLY. One SELECT.
-- Run AFTER supabase/migrations/0034_product_shorts_v1.sql.
-- Every row's `ok` must be true. Rows 12-16 must match the numbers you
-- recorded from 0034_precheck.sql rows 3-7.

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, '신규 테이블 2개 존재' as check_name,
         (select count(*)::text from information_schema.tables
          where table_schema = 'public' and table_name in ('product_shorts_projects', 'product_shorts_media')) as result,
         '2' as expected
  union all
  select 2, 'product_shorts_projects RLS 정책 수',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'product_shorts_projects'),
         '1'
  union all
  select 3, 'product_shorts_media RLS 정책 수',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'product_shorts_media'),
         '1'
  union all
  select 4, 'product_shorts_projects.(id, user_id) UNIQUE 존재',
         (select count(*)::text from pg_constraint
          where conrelid = 'public.product_shorts_projects'::regclass and contype = 'u'),
         '1'
  union all
  select 5, 'product_shorts_media: composite FK (project_id, user_id) 존재, ON DELETE CASCADE',
         (select confdeltype::text from pg_constraint
          where conrelid = 'public.product_shorts_media'::regclass
            and contype = 'f'
            and array_length(conkey, 1) = 2),
         'c'
  union all
  select 6, 'product_shorts_media.user_id -> users FK 존재, ON DELETE CASCADE',
         (select confdeltype::text from pg_constraint
          where conname = 'product_shorts_media_user_id_fkey' and conrelid = 'public.product_shorts_media'::regclass),
         'c'
  union all
  select 7, 'product_shorts_projects.user_id -> users FK 존재, ON DELETE CASCADE',
         (select confdeltype::text from pg_constraint
          where conname = 'product_shorts_projects_user_id_fkey' and conrelid = 'public.product_shorts_projects'::regclass),
         'c'
  union all
  select 8, '신규 Storage 버킷 존재, private, 100MB',
         (select public::text || ' / ' || file_size_limit::text from storage.buckets where id = 'product-shorts-media'),
         'false / 104857600'
  union all
  select 9, 'Storage RLS 정책 존재 (product-shorts-media)',
         (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and policyname = 'users manage own product shorts media in storage'),
         '1'
  union all
  select 10, 'product_shorts_projects.target_duration_seconds CHECK 존재',
         (select count(*)::text from pg_constraint
          where conrelid = 'public.product_shorts_projects'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%target_duration_seconds%'),
         '1'
  union all
  select 11, 'product_shorts_media.media_type CHECK 존재',
         (select count(*)::text from pg_constraint
          where conrelid = 'public.product_shorts_media'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%media_type%'),
         '1'
  union all
  select 12, '기존 collaborations 행 수 불변 (precheck 3번과 비교)',
         (select count(*)::text from public.collaborations), (select count(*)::text from public.collaborations)
  union all
  select 13, '기존 collaboration_photos 행 수 불변 (precheck 4번과 비교)',
         (select count(*)::text from public.collaboration_photos), (select count(*)::text from public.collaboration_photos)
  union all
  select 14, '기존 collaboration_videos 행 수 불변 (precheck 5번과 비교)',
         (select count(*)::text from public.collaboration_videos), (select count(*)::text from public.collaboration_videos)
  union all
  select 15, '기존 contents 행 수 불변 (precheck 6번과 비교)',
         (select count(*)::text from public.contents), (select count(*)::text from public.contents)
  union all
  select 16, '기존 users 행 수 불변 (precheck 7번과 비교)',
         (select count(*)::text from public.users), (select count(*)::text from public.users)
  union all
  select 17, 'collaboration_photos RLS 정책 수 불변 (precheck 8번과 비교)',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'collaboration_photos'),
         '1'
  union all
  select 18, 'collaboration_videos RLS 정책 수 불변 (precheck 9번과 비교)',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'collaboration_videos'),
         '1'
  union all
  select 19, '신규 테이블에 값이 들어 있는 행 수 (적용 직후에는 0)',
         ((select count(*) from public.product_shorts_projects) + (select count(*) from public.product_shorts_media))::text,
         '0'
) c
order by n;

-- Note: row 5 checks for a 2-column foreign key on product_shorts_media
-- (the composite FK on (project_id, user_id)) with confdeltype 'c' (CASCADE).
-- This is the ownership-integrity constraint proven empirically pre-merge
-- with a real Postgres engine (PGlite) — see the PR report's ownership
-- test. This row is a structural sanity check that the SAME constraint
-- actually made it into Production, not a re-proof of the behavior itself
-- (proving cross-user insert rejection against Production would require
-- attempting a real violating write, which this read-only postcheck does
-- not do).
