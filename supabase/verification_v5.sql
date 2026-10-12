-- Read-only live checks after applying 202610120001_assignment5.sql.
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='caption-uploads';
select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p') order by c.relname;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
 where (schemaname='public' and tablename in ('caption_images','caption_generations','profiles','caption_votes'))
    or (schemaname='storage' and policyname like 'caption_uploads%')
 order by schemaname,tablename,policyname;
select n.nspname,p.proname,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') as anon_can_execute,
 has_function_privilege('authenticated',p.oid,'execute') as member_can_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','punchline_private') and (p.proname like '%_v5'
   or p.proname='complete_caption_generation_legacy_v4')
 order by n.nspname,p.proname;
-- The legacy implementation must not be callable by members; wrappers are invoker.
select format_version,status,count(*) from public.caption_generations group by format_version,status;
-- Should return zero rows: registered uploads use immutable owner-scoped paths.
select id from public.caption_images where owner_id is not null
 and (src<>'' or storage_path<>owner_id::text||'/'||substring(id from 8)||'.jpg');
-- Should return zero rows: V5 completed captions are at most 140 chars/12 words.
select c.id from public.captions c join public.caption_generations g on g.id=c.generation_id
 where g.format_version=5 and (char_length(c.content)>140
  or cardinality(regexp_split_to_array(c.content,U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+'))>12);
