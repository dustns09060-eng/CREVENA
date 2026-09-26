-- STEP52 PRECHECK — READ ONLY. One SELECT.
-- Run in the Supabase SQL Editor BEFORE supabase/migrations/0034_product_shorts_v1.sql.

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, '신규 테이블 2개가 아직 없음' as check_name,
         (select count(*)::text from information_schema.tables
          where table_schema = 'public' and table_name in ('product_shorts_projects', 'product_shorts_media')) as result,
         '0' as expected
  union all
  select 2, '신규 Storage 버킷이 아직 없음',
         (select count(*)::text from storage.buckets where id = 'product-shorts-media'),
         '0'
  union all
  select 3, '기존 collaborations 행 수 (기록해 두세요: 적용 후에도 같아야 함)',
         (select count(*)::text from public.collaborations), (select count(*)::text from public.collaborations)
  union all
  select 4, '기존 collaboration_photos 행 수 (기록해 두세요)',
         (select count(*)::text from public.collaboration_photos), (select count(*)::text from public.collaboration_photos)
  union all
  select 5, '기존 collaboration_videos 행 수 (기록해 두세요)',
         (select count(*)::text from public.collaboration_videos), (select count(*)::text from public.collaboration_videos)
  union all
  select 6, '기존 contents 행 수 (기록해 두세요)',
         (select count(*)::text from public.contents), (select count(*)::text from public.contents)
  union all
  select 7, '기존 users 행 수 (기록해 두세요)',
         (select count(*)::text from public.users), (select count(*)::text from public.users)
  union all
  select 8, 'collaboration_photos RLS 정책 수 (기존, 불변이어야 함)',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'collaboration_photos'),
         '1'
  union all
  select 9, 'collaboration_videos RLS 정책 수 (기존, 불변이어야 함)',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'collaboration_videos'),
         '1'
) c
order by n;
