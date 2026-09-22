-- STEP50 POSTCHECK — READ ONLY. One SELECT.
-- Run AFTER supabase/migrations/0031_billing_key_revocation_tracking.sql.
-- Every row's `ok` must be true.

select check_name, result, expected, coalesce(result = expected, false) as ok
from (
  select 1 as n, '컬럼 billing_key_revoked_at' as check_name,
         (select data_type || ' / nullable=' || is_nullable || ' / default=' || coalesce(column_default, 'NULL')
          from information_schema.columns
          where table_schema = 'public' and table_name = 'users' and column_name = 'billing_key_revoked_at') as result,
         'timestamp with time zone / nullable=YES / default=NULL' as expected
  union all
  select 2, '컬럼 billing_key_revoke_error',
         (select data_type || ' / nullable=' || is_nullable || ' / default=' || coalesce(column_default, 'NULL')
          from information_schema.columns
          where table_schema = 'public' and table_name = 'users' and column_name = 'billing_key_revoke_error'),
         'text / nullable=YES / default=NULL'
  union all
  select 3, 'authenticated: 새 컬럼 SELECT 가능 (revoked_at / revoke_error)',
         has_column_privilege('authenticated', 'public.users', 'billing_key_revoked_at', 'SELECT')::text || ' / ' ||
         has_column_privilege('authenticated', 'public.users', 'billing_key_revoke_error', 'SELECT')::text, 'false / false'
  union all
  select 4, 'authenticated: 새 컬럼 UPDATE 가능 (revoked_at / revoke_error)',
         has_column_privilege('authenticated', 'public.users', 'billing_key_revoked_at', 'UPDATE')::text || ' / ' ||
         has_column_privilege('authenticated', 'public.users', 'billing_key_revoke_error', 'UPDATE')::text, 'false / false'
  union all
  select 5, 'anon: 새 컬럼 SELECT/UPDATE 가능 (하나라도)',
         (has_column_privilege('anon', 'public.users', 'billing_key_revoked_at', 'SELECT')
          or has_column_privilege('anon', 'public.users', 'billing_key_revoke_error', 'SELECT')
          or has_column_privilege('anon', 'public.users', 'billing_key_revoked_at', 'UPDATE')
          or has_column_privilege('anon', 'public.users', 'billing_key_revoke_error', 'UPDATE'))::text, 'false'
  union all
  select 6, '기존 빌링키 컬럼 잠금 유지 (authenticated SELECT / UPDATE)',
         has_column_privilege('authenticated', 'public.users', 'payment_subscription_id', 'SELECT')::text || ' / ' ||
         has_column_privilege('authenticated', 'public.users', 'payment_subscription_id', 'UPDATE')::text, 'false / false'
  union all
  select 7, '새 컬럼에 값이 들어 있는 회원 수 (적용 직후에는 0)',
         (select count(*)::text from public.users
          where billing_key_revoked_at is not null or billing_key_revoke_error is not null), '0'
  union all
  select 8, '회원 수 (precheck 2번과 같아야 함)',
         (select count(*)::text from public.users), '5'
  union all
  select 9, '빌링키를 가진 회원 수 (precheck 3번과 같아야 함: 이 migration 이 키를 건드리지 않음)',
         (select count(*)::text from public.users where payment_subscription_id is not null), '1'
) c
order by n;

-- Notes
--  * Row 7 is 0 only until the new app version has run. After deploying, a
--    value here means a billing-key delete was attempted (revoked_at set) or
--    failed (revoke_error set) — that is the feature working, not a problem.
