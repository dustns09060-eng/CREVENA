-- STEP48 follow-up PRECHECK — READ ONLY. One SELECT.
-- Run BEFORE supabase/migrations/0028_lock_anon_users_update_and_credit_rpc.sql.
--
-- Records what `anon` and `authenticated` can do today, so the postcheck can
-- prove only the two intended anon privileges changed.
--
-- Expected BEFORE the migration: the two anon rows marked "will change" are
-- true. Everything for `authenticated` is what the postcheck must show again.

select 'anon: UPDATE plan_tier (will change -> false)' as check_name,
       has_column_privilege('anon', 'public.users', 'plan_tier', 'UPDATE')::text as result
union all
select 'anon: UPDATE role (will change -> false)',
       has_column_privilege('anon', 'public.users', 'role', 'UPDATE')::text
union all
select 'anon: UPDATE is_unlimited (will change -> false)',
       has_column_privilege('anon', 'public.users', 'is_unlimited', 'UPDATE')::text
union all
select 'anon: EXECUTE increment_ai_credits (will change -> false)',
       (select has_function_privilege('anon', p.oid, 'EXECUTE')::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'increment_ai_credits')
union all
select 'authenticated: UPDATE display_name (must stay true)',
       has_column_privilege('authenticated', 'public.users', 'display_name', 'UPDATE')::text
union all
select 'authenticated: UPDATE plan_tier (must stay false)',
       has_column_privilege('authenticated', 'public.users', 'plan_tier', 'UPDATE')::text
union all
select 'authenticated: UPDATE is_unlimited (must stay false)',
       has_column_privilege('authenticated', 'public.users', 'is_unlimited', 'UPDATE')::text
union all
select 'authenticated: EXECUTE increment_ai_credits (must stay true)',
       (select has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'increment_ai_credits')
union all
select 'for information: anon INSERT / DELETE on users (not changed by 0028)',
       has_table_privilege('anon', 'public.users', 'INSERT')::text || ' / ' ||
       has_table_privilege('anon', 'public.users', 'DELETE')::text;
