-- Optional short-lived signed-download fallback for published caption photos.
-- No service key, public bucket, private-photo access, or bulk listing/signing.
begin;
create function punchline_private.caption_sign_context_v6(p_name text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(current_setting('request.method',true)='POST'
    and split_part(coalesce(current_setting('request.path',true),''),'?',1)=any(array[
      '/object/sign/caption-uploads/'||p_name,
      '/storage/v1/object/sign/caption-uploads/'||p_name]),false);
$$;
revoke all on function punchline_private.caption_sign_context_v6(text) from public,anon,authenticated,service_role;
grant execute on function punchline_private.caption_sign_context_v6(text) to anon,authenticated;
-- The same explicitly public media is safe for either gateway request role.
alter policy caption_uploads_published_download_v6 on storage.objects to anon,authenticated;
create policy caption_uploads_published_sign_v6 on storage.objects for select to anon,authenticated
  using(bucket_id='caption-uploads'
    and (storage.allow_any_operation(array['object.sign'])
      or punchline_private.caption_sign_context_v6(name))
    and punchline_private.published_caption_upload_v6(name));
notify pgrst,'reload schema';
commit;
