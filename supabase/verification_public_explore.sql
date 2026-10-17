-- Read-only checks; run as the project owner before and after migration.
select to_regprocedure('storage.allow_any_operation(text[])') as required_storage_helper;
select id,public from storage.buckets where id='caption-uploads';
select n.nspname,p.proname,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') as anon_can_execute,
 has_function_privilege('authenticated',p.oid,'execute') as member_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','punchline_private') and p.proname in
 ('get_caption_feed_v6','get_caption_image_v6','complete_caption_generation_v6','published_caption_upload_v6')
order by n.nspname,p.proname;
select policyname,roles,cmd,qual from pg_policies
 where schemaname='storage' and policyname='caption_uploads_published_download_v6';
-- Must stay owner-only: no anonymous table grants to prompts, profiles, or ratings.
select table_name,grantee,privilege_type from information_schema.role_table_grants
 where table_schema='public' and grantee in ('anon','PUBLIC') order by table_name,grantee;
select status,count(*) from public.caption_generations
 where created_at >= ((now() at time zone 'America/New_York')::date::timestamp at time zone 'America/New_York')
 group by status;
