-- Compatibility for Storage releases that omit/rename the operation context.
-- Keep the bucket private and allow only the exact published-object GET path.
begin;
create or replace function punchline_private.caption_download_context_v6(p_name text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(current_setting('request.method',true)='GET'
    and split_part(coalesce(current_setting('request.path',true),''),'?',1)=any(array[
      '/object/caption-uploads/'||p_name,
      '/object/authenticated/caption-uploads/'||p_name,
      '/storage/v1/object/caption-uploads/'||p_name,
      '/storage/v1/object/authenticated/caption-uploads/'||p_name]),false);
$$;
revoke all on function punchline_private.caption_download_context_v6(text) from public,anon,authenticated,service_role;
grant execute on function punchline_private.caption_download_context_v6(text) to anon,authenticated;
drop policy if exists caption_uploads_published_download_v6 on storage.objects;
create policy caption_uploads_published_download_v6 on storage.objects for select to anon
  using (bucket_id='caption-uploads'
    and (storage.allow_any_operation(array['object.get_authenticated'])
      or punchline_private.caption_download_context_v6(name))
    and punchline_private.published_caption_upload_v6(name));
notify pgrst,'reload schema';
commit;
