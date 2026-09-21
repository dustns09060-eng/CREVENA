-- STEP48 follow-up POSTCHECK — READ ONLY. One SELECT.
-- Run AFTER supabase/migrations/0028_lock_anon_users_update_and_credit_rpc.sql.
-- Same query as 0028_precheck.sql, plus the expected value for each row.

with checks as (
  select 1 as n, 'anon: UPDATE plan_tier' as check_name,
         has_column_privilege('anon', 'public.users', 'plan_tier', 'UPDATE')::text as result, 'false' as expected
  union all
  select 2, 'anon: UPDATE role',
         has_column_privilege('anon', 'public.users', 'role', 'UPDATE')::text, 'false'
  union all
  select 3, 'anon: UPDATE is_unlimited',
         has_column_privilege('anon', 'public.users', 'is_unlimited', 'UPDATE')::text, 'false'
  union all
  select 4, 'anon: EXECUTE increment_ai_credits',
         (select has_function_privilege('anon', p.oid, 'EXECUTE')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'increment_ai_credits'), 'false'
  union all
  select 5, 'authenticated: UPDATE display_name',
         has_column_privilege('authenticated', 'public.users', 'display_name', 'UPDATE')::text, 'true'
  union all
  select 6, 'authenticated: UPDATE plan_tier',
         has_column_privilege('authenticated', 'public.users', 'plan_tier', 'UPDATE')::text, 'false'
  union all
  select 7, 'authenticated: UPDATE is_unlimited',
         has_column_privilege('authenticated', 'public.users', 'is_unlimited', 'UPDATE')::text, 'false'
  union all
  select 8, 'authenticated: EXECUTE increment_ai_credits',
         (select has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'increment_ai_credits'), 'true'
  union all
  select 9, 'authenticated: SELECT is_unlimited (app reads its own flag)',
         has_column_privilege('authenticated', 'public.users', 'is_unlimited', 'SELECT')::text, 'true'
)
select check_name, result, expected, (result = expected) as ok
from checks
order by n;
