-- Read-only checks to run in the Supabase SQL Editor after applying the migration.
-- Every returned public table should show rls_enabled=true.
select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','p') order by c.relname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
  from pg_catalog.pg_policies
 where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')
 order by schemaname, tablename, policyname;

-- Prompts, user IDs, and individual vote rows are omitted from the public feed.
-- Public wrappers should show security_definer=false; private implementations=true.
select n.nspname as schema_name, p.proname as function_name, p.prosecdef as security_definer,
       p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as member_can_execute
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public','punchline_private')
   and p.proname in ('reserve_caption_generation','complete_caption_generation',
                     'fail_caption_generation','get_caption_feed','get_generation_allowance')
 order by n.nspname, p.proname;

-- Caption votes allow INSERT and SELECT only; anonymous grants should be absent.
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated','PUBLIC')
 order by table_name, grantee, privilege_type;

select grantee, table_name, column_name, privilege_type
  from information_schema.role_column_grants
 where table_schema = 'public' and table_name = 'caption_votes'
   and grantee in ('anon','authenticated','PUBLIC')
 order by grantee, privilege_type, column_name;

-- Every succeeded generation should have exactly three stored captions.
select g.id, g.status, count(c.id) as caption_count
  from public.caption_generations g left join public.captions c on c.generation_id = g.id
 group by g.id, g.status
having (g.status = 'succeeded' and count(c.id) <> 3) or (g.status <> 'succeeded' and count(c.id) <> 0);
