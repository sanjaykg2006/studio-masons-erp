-- Database-wide safety rules that every migration must keep.
begin;
select plan(5);

select is_empty(
  $$select proname from pg_proc
    where pronamespace = 'public'::regnamespace
    group by proname having count(*) > 1$$,
  'no function has a forgotten older version beside the current one');

select is_empty(
  $$select p.oid::regprocedure::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')$$,
  'every function that runs with extra rights pins its search_path');

select is_empty(
  $$select relname from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity$$,
  'every table has row-level security switched on');

select is_empty(
  $$select p.oid::regprocedure::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'apply\_%'
      and (has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('anon', p.oid, 'execute'))$$,
  'approval outcome helpers (apply_*) cannot be called by users, only by the approval engine');

select is_empty(
  $$select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and not (has_table_privilege('authenticated', c.oid, 'select')
               and has_table_privilege('service_role', c.oid, 'select'))$$,
  'signed-in users and the server can reach every table (row-level security then decides the rows)');

select * from finish();
rollback;
