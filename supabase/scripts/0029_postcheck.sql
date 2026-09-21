-- 0029 POSTCHECK — READ ONLY. One SELECT. Run AFTER
-- supabase/migrations/0029_validate_credit_amount.sql.

with checks as (
  select 1 as n, 'function has the amount validation' as check_name,
         (select (pg_get_functiondef(p.oid) ilike '%invalid amount%')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'increment_ai_credits') as result,
         'true' as expected
  union all
  select 2, 'function keeps the unlimited branch (0027)',
         (select (pg_get_functiondef(p.oid) ilike '%is_unlimited%')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'increment_ai_credits'), 'true'
  union all
  select 3, 'function is SECURITY DEFINER',
         (select p.prosecdef::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'increment_ai_credits'), 'true'
  union all
  select 4, 'anon can execute (0028 removed it)',
         (select has_function_privilege('anon', p.oid, 'EXECUTE')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'increment_ai_credits'), 'false'
  union all
  select 5, 'authenticated can execute',
         (select has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'increment_ai_credits'), 'true'
  union all
  select 6, 'only one overload exists',
         (select count(*)::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'increment_ai_credits'), '1'
)
select check_name, result, expected, (result = expected) as ok
from checks
order by n;
