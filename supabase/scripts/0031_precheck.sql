-- STEP50 PRECHECK — READ ONLY. One SELECT.
-- Run in the Supabase SQL Editor BEFORE supabase/migrations/0031_billing_key_revocation_tracking.sql.
-- Deploy order: apply the migration FIRST, then deploy the app change.

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, '추적 컬럼 2개가 아직 없음' as check_name,
         (select count(*)::text from information_schema.columns
          where table_schema = 'public' and table_name = 'users'
            and column_name in ('billing_key_revoked_at', 'billing_key_revoke_error')) as result,
         '0' as expected
  union all
  select 2, '회원 수 (기록해 두세요: 적용 후에도 같아야 함)',
         (select count(*)::text from public.users), '5'
  union all
  select 3, '빌링키를 가진 회원 수 (기록해 두세요: 적용 후에도 같아야 함)',
         (select count(*)::text from public.users where payment_subscription_id is not null), '1'
  union all
  select 4, '그중 FREE 요금제 회원 수 (오래된 테스트 키 1건으로 알려져 있음)',
         (select count(*)::text from public.users where payment_subscription_id is not null and plan_tier = 'FREE'), '1'
  union all
  select 5, 'authenticated 가 빌링키 컬럼을 읽을 수 없음 (기존 잠금 확인)',
         has_column_privilege('authenticated', 'public.users', 'payment_subscription_id', 'SELECT')::text, 'false'
  union all
  select 6, 'authenticated 가 빌링키 컬럼을 수정할 수 없음 (기존 잠금 확인)',
         has_column_privilege('authenticated', 'public.users', 'payment_subscription_id', 'UPDATE')::text, 'false'
) c
order by n;

-- Notes
--  * Rows 3 and 4 are the counts seen on 2026-09-22 (one FREE account still
--    holding an old key). If they differ, that is fine — just note the numbers
--    and compare them after the migration (they must not change).
--  * This migration does NOT touch that key. The app only retries deletions
--    that previously FAILED, so a pre-existing key is never revoked
--    automatically; handle it by hand (see the PR report).
