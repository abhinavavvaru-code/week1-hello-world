-- Assignment 5: private photo uploads, topic/perspective controls, short captions,
-- author attribution, and ratings this week/month. Apply after Assignment 4.
begin;

alter table public.caption_images
  add column owner_id uuid references auth.users(id) on delete cascade,
  add column storage_path text unique,
  add constraint caption_images_upload_metadata_check check (
    (owner_id is null and storage_path is null)
    or (owner_id is not null and storage_path is not null and src = ''
      and id ~ '^upload-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and storage_path = owner_id::text || '/' || substring(id from 8) || '.jpg')
  );
create index caption_images_owner_created on public.caption_images(owner_id, created_at);

alter table public.caption_generations
  add column topic text not null default 'campus'
    check (topic in ('campus','study','roommates','nyc','food','internet','other')),
  add column perspective text not null default 'observer'
    check (perspective in ('observer','student','roommate','tourist','object')),
  add column format_version smallint not null default 4 check (format_version in (4,5));
alter table public.caption_generations drop constraint caption_generations_style_check;
alter table public.caption_generations add constraint caption_generations_style_check
  check (style in ('dry','chaotic','wholesome','wordplay','roast'));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('caption-uploads','caption-uploads',false,1048576,array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg'];

create function punchline_private.caption_image_published_v5(p_image_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.caption_generations g join public.captions c on c.generation_id = g.id
     where g.image_id = p_image_id and g.status = 'succeeded');
$$;

drop policy caption_images_members_read on public.caption_images;
create policy caption_images_members_read on public.caption_images for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid())
    or punchline_private.caption_image_published_v5(id));

create function punchline_private.can_read_caption_upload_v5(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    split_part(p_name,'/',1) = auth.uid()::text
    or exists (
      select 1 from public.caption_images i join public.caption_generations g on g.image_id = i.id
        join public.captions c on c.generation_id = g.id
       where i.storage_path = p_name and g.status = 'succeeded'));
$$;

create function punchline_private.can_insert_caption_upload_v5(p_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  today date := (now() at time zone 'America/New_York')::date;
begin
  if caller is null or p_name is null
     or p_name !~ ('^' || caller::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    return false;
  end if;
  -- The lock lasts until the Storage object INSERT transaction commits. It
  -- prevents parallel direct uploads from racing past the daily object cap.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('caption-upload:' || caller::text,0));
  return (select count(*) from storage.objects o where o.bucket_id = 'caption-uploads'
    and split_part(o.name,'/',1) = caller::text
    and o.created_at >= (today::timestamp at time zone 'America/New_York')
    and o.created_at < ((today + 1)::timestamp at time zone 'America/New_York')) < 20;
end $$;

create function punchline_private.can_delete_caption_upload_v5(p_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid();
begin
  if caller is null or p_name is null or split_part(p_name,'/',1)<>caller::text then return false; end if;
  -- Coordinate cleanup with registration, including a lost registration response.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('caption-upload:' || caller::text,0));
  return not exists (select 1 from public.caption_images i where i.storage_path=p_name);
end;
$$;

create policy caption_uploads_members_read_v5 on storage.objects for select to authenticated
  using (bucket_id = 'caption-uploads' and punchline_private.can_read_caption_upload_v5(name));
create policy caption_uploads_owner_insert_v5 on storage.objects for insert to authenticated
  with check (bucket_id = 'caption-uploads' and punchline_private.can_insert_caption_upload_v5(name));
create policy caption_uploads_cleanup_unregistered_v5 on storage.objects for delete to authenticated
  using (bucket_id = 'caption-uploads' and punchline_private.can_delete_caption_upload_v5(name));
-- There is deliberately no UPDATE policy for this bucket: no overwrite/upsert.

create function punchline_private.register_caption_image_v5(p_image_id uuid,p_title text,p_alt text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  image_id text := 'upload-' || p_image_id::text;
  object_path text := caller::text || '/' || p_image_id::text || '.jpg';
  existing public.caption_images%rowtype;
  today date := (now() at time zone 'America/New_York')::date;
begin
  if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  if p_image_id is null or p_title is null or p_alt is null
     or char_length(btrim(p_title)) not between 1 and 100
     or char_length(btrim(p_alt)) not between 1 and 300 then
    raise exception using errcode='22023',message='INVALID_IMAGE_METADATA';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('caption-upload:' || caller::text,0));
  select i.* into existing from public.caption_images i where i.id = image_id;
  if found then
    if existing.owner_id <> caller or existing.storage_path <> object_path then
      raise exception using errcode='22023',message='IMAGE_ID_ALREADY_USED';
    end if;
    if existing.title <> btrim(p_title) or existing.alt <> btrim(p_alt) then
      raise exception using errcode='22023',message='IMAGE_ID_REUSED_WITH_DIFFERENT_INPUT';
    end if;
    return image_id;
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='caption-uploads' and o.name=object_path) then
    raise exception using errcode='22023',message='UPLOADED_IMAGE_NOT_FOUND';
  end if;
  if (select count(*) from public.caption_images i where i.owner_id=caller
      and i.created_at >= (today::timestamp at time zone 'America/New_York')
      and i.created_at < ((today+1)::timestamp at time zone 'America/New_York')) >= 20 then
    raise exception using errcode='P0001',message='IMAGE_UPLOAD_LIMIT_REACHED';
  end if;
  insert into public.caption_images(id,title,src,alt,scene,owner_id,storage_path)
    values (image_id,btrim(p_title),'',btrim(p_alt),btrim(p_alt),caller,object_path);
  return image_id;
end $$;

create function punchline_private.reserve_caption_generation_v5(
  p_request_id uuid,p_image_id text,p_prompt text,p_style text,p_system_prompt text,p_model text,
  p_topic text default 'campus',p_perspective text default 'observer'
)
returns table (
  id uuid,user_id uuid,image_id text,prompt text,system_prompt text,style text,provider text,model text,
  request_id uuid,status text,created_at timestamptz,completed_at timestamptz,topic text,perspective text,is_new boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  generation public.caption_generations%rowtype;
  today date := (now() at time zone 'America/New_York')::date;
  was_created boolean := false;
begin
  if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  if p_request_id is null or p_image_id is null or p_prompt is null or p_style is null
     or p_system_prompt is null or p_model is null or p_topic is null or p_perspective is null
     or char_length(btrim(p_prompt)) not between 1 and 500
     or char_length(btrim(p_system_prompt)) not between 1 and 8000
     or char_length(btrim(p_model)) not between 1 and 100
     or p_style not in ('dry','chaotic','wholesome','wordplay','roast')
     or p_topic not in ('campus','study','roommates','nyc','food','internet','other')
     or p_perspective not in ('observer','student','roommate','tourist','object') then
    raise exception using errcode='22023',message='INVALID_GENERATION_INPUT';
  end if;
  if not exists (select 1 from public.caption_images i where i.id=p_image_id
      and (i.owner_id is null or i.owner_id=caller)) then
    raise exception using errcode='22023',message='INVALID_CAPTION_IMAGE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('caption-generation:' || caller::text,0));
  select g.* into generation from public.caption_generations g
    where g.user_id=caller and g.request_id=p_request_id for update;
  if found then
    if generation.image_id<>p_image_id or generation.prompt<>btrim(p_prompt) or generation.style<>p_style
       or generation.system_prompt<>btrim(p_system_prompt) or generation.model<>btrim(p_model)
       or generation.topic<>p_topic or generation.perspective<>p_perspective then
      raise exception using errcode='22023',message='REQUEST_ID_REUSED_WITH_DIFFERENT_INPUT';
    end if;
    if generation.status='pending' and generation.created_at<now()-interval '2 minutes' then
      update public.caption_generations g set status='failed',completed_at=now()
        where g.id=generation.id and g.status='pending' returning g.* into generation;
    end if;
  else
    if (select count(*) from public.caption_generations g where g.user_id=caller
        and g.created_at >= (today::timestamp at time zone 'America/New_York')
        and g.created_at < ((today+1)::timestamp at time zone 'America/New_York')) >= 5 then
      raise exception using errcode='P0001',message='GENERATION_LIMIT_REACHED';
    end if;
    insert into public.caption_generations as g
      (user_id,image_id,prompt,style,system_prompt,model,request_id,topic,perspective,format_version)
    values (caller,p_image_id,btrim(p_prompt),p_style,btrim(p_system_prompt),btrim(p_model),p_request_id,p_topic,p_perspective,5)
    returning g.* into generation;
    was_created:=true;
  end if;
  return query select generation.id,generation.user_id,generation.image_id,generation.prompt,generation.system_prompt,
    generation.style,generation.provider,generation.model,generation.request_id,generation.status,generation.created_at,
    generation.completed_at,generation.topic,generation.perspective,was_created;
end $$;

create function punchline_private.complete_caption_generation_v5(p_generation_id uuid,p_captions text[])
returns setof public.captions language plpgsql security definer set search_path = '' as $$
declare
  caller uuid:=auth.uid();
  generation public.caption_generations%rowtype;
  normalized_captions text[];
  -- Match JavaScript trim()/\s: PostgreSQL \s alone misses nonbreaking spaces.
  whitespace_pattern text:=U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+';
begin
  if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  select g.* into generation from public.caption_generations g
    where g.id=p_generation_id and g.user_id=caller for update;
  if not found then raise exception using errcode='P0001',message='GENERATION_NOT_FOUND'; end if;
  if generation.status='succeeded' then
    return query select c.* from public.captions c where c.generation_id=generation.id order by c.position;
    return;
  end if;
  if generation.status<>'pending' then raise exception using errcode='P0001',message='GENERATION_NOT_PENDING'; end if;
  select array_agg(regexp_replace(x.content,'^'||whitespace_pattern||'|'||whitespace_pattern||'$','','g') order by x.position)
    into normalized_captions from pg_catalog.unnest(p_captions) with ordinality x(content,position);
  if p_captions is null or cardinality(p_captions)<>3
     or exists (select 1 from pg_catalog.unnest(normalized_captions) x(content) where x.content is null
       or char_length(x.content) not between 5 and 140
       or cardinality(regexp_split_to_array(x.content,whitespace_pattern))>12)
     or (select count(distinct lower(x.content)) from pg_catalog.unnest(normalized_captions) x(content))<>3 then
    raise exception using errcode='22023',message='INVALID_GENERATED_CAPTIONS';
  end if;
  insert into public.captions(generation_id,content,position)
    select generation.id,x.content,x.position::smallint
      from pg_catalog.unnest(normalized_captions) with ordinality x(content,position);
  update public.caption_generations g set status='succeeded',completed_at=now() where g.id=generation.id;
  return query select c.* from public.captions c where c.generation_id=generation.id order by c.position;
end $$;

-- Keep the old signatures and data. New legacy reservations use safe V5 image
-- authorization; existing rows keep format_version=4 and their saved captions.
create or replace function punchline_private.reserve_caption_generation(
  p_request_id uuid,p_image_id text,p_prompt text,p_style text,p_system_prompt text,p_model text
)
returns table (
  id uuid,user_id uuid,image_id text,prompt text,system_prompt text,style text,provider text,model text,
  request_id uuid,status text,created_at timestamptz,completed_at timestamptz,is_new boolean
)
language sql security invoker set search_path = '' as $$
  select r.id,r.user_id,r.image_id,r.prompt,r.system_prompt,r.style,r.provider,r.model,
    r.request_id,r.status,r.created_at,r.completed_at,r.is_new
  from punchline_private.reserve_caption_generation_v5(
    p_request_id,p_image_id,p_prompt,p_style,p_system_prompt,p_model,'campus','observer') r;
$$;

alter function punchline_private.complete_caption_generation(uuid,text[]) rename to complete_caption_generation_legacy_v4;
revoke all on function punchline_private.complete_caption_generation_legacy_v4(uuid,text[])
  from public,anon,authenticated,service_role;
create function punchline_private.complete_caption_generation(p_generation_id uuid,p_captions text[])
returns setof public.captions language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); version smallint;
begin
  if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  select g.format_version into version from public.caption_generations g where g.id=p_generation_id and g.user_id=caller;
  if not found then raise exception using errcode='P0001',message='GENERATION_NOT_FOUND'; end if;
  if version=5 then
    return query select c.* from punchline_private.complete_caption_generation_v5(p_generation_id,p_captions) c;
  else
    return query select c.* from punchline_private.complete_caption_generation_legacy_v4(p_generation_id,p_captions) c;
  end if;
end $$;
revoke all on function punchline_private.complete_caption_generation(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function punchline_private.complete_caption_generation(uuid,text[]) to authenticated;

create function punchline_private.get_caption_feed_v5()
returns table (
  id uuid,content text,image_id text,created_at timestamptz,style text,laughs bigint,groans bigint,
  my_vote smallint,voted_at timestamptz,author_id uuid,author_name text,image_src text,image_alt text,
  storage_path text,topic text,perspective text,week_upvotes bigint,month_upvotes bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid:=auth.uid();
  local_now timestamp:=now() at time zone 'America/New_York';
  week_start timestamptz:=date_trunc('week',local_now) at time zone 'America/New_York';
  week_end timestamptz:=(date_trunc('week',local_now)+interval '1 week') at time zone 'America/New_York';
  month_start timestamptz:=date_trunc('month',local_now) at time zone 'America/New_York';
  month_end timestamptz:=(date_trunc('month',local_now)+interval '1 month') at time zone 'America/New_York';
begin
  if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  return query select c.id,c.content,g.image_id,c.created_at,g.style,
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=1),
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=-1),
    mine.value,mine.created_at,g.user_id,
    case when nullif(btrim(p.first_name),'') is null or p.first_name like '%@%' then 'Member'
      else split_part(btrim(p.first_name),' ',1) ||
        case when nullif(btrim(p.last_name),'') is null then '' else ' ' || left(btrim(p.last_name),1) || '.' end end,
    i.src,i.alt,i.storage_path,g.topic,g.perspective,
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=1 and v.created_at>=week_start and v.created_at<week_end),
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=1 and v.created_at>=month_start and v.created_at<month_end)
  from public.captions c join public.caption_generations g on g.id=c.generation_id and g.status='succeeded'
    join public.caption_images i on i.id=g.image_id
    left join public.profiles p on p.id=g.user_id
    left join public.caption_votes mine on mine.caption_id=c.id and mine.user_id=caller
  order by c.created_at desc,c.generation_id,c.position;
end $$;

create function punchline_private.get_caption_image_v5(p_caption_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  return (select i.storage_path from public.captions c
    join public.caption_generations g on g.id=c.generation_id and g.status='succeeded'
    join public.caption_images i on i.id=g.image_id where c.id=p_caption_id);
end $$;

create function public.register_caption_image_v5(p_image_id uuid,p_title text,p_alt text)
returns text language sql security invoker set search_path = '' as $$
  select punchline_private.register_caption_image_v5(p_image_id,p_title,p_alt);
$$;
create function public.reserve_caption_generation_v5(
  p_request_id uuid,p_image_id text,p_prompt text,p_style text,p_system_prompt text,p_model text,
  p_topic text default 'campus',p_perspective text default 'observer'
)
returns table (
  id uuid,user_id uuid,image_id text,prompt text,system_prompt text,style text,provider text,model text,
  request_id uuid,status text,created_at timestamptz,completed_at timestamptz,topic text,perspective text,is_new boolean
)
language sql security invoker set search_path = '' as $$
  select * from punchline_private.reserve_caption_generation_v5(
    p_request_id,p_image_id,p_prompt,p_style,p_system_prompt,p_model,p_topic,p_perspective);
$$;
create function public.complete_caption_generation_v5(p_generation_id uuid,p_captions text[])
returns setof public.captions language sql security invoker set search_path = '' as $$
  select * from punchline_private.complete_caption_generation_v5(p_generation_id,p_captions);
$$;
create function public.get_caption_feed_v5()
returns table (
  id uuid,content text,image_id text,created_at timestamptz,style text,laughs bigint,groans bigint,
  my_vote smallint,voted_at timestamptz,author_id uuid,author_name text,image_src text,image_alt text,
  storage_path text,topic text,perspective text,week_upvotes bigint,month_upvotes bigint
)
language sql stable security invoker set search_path = '' as $$
  select * from punchline_private.get_caption_feed_v5();
$$;
create function public.get_caption_image_v5(p_caption_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select punchline_private.get_caption_image_v5(p_caption_id);
$$;

revoke all on function
  punchline_private.caption_image_published_v5(text),punchline_private.can_read_caption_upload_v5(text),
  punchline_private.can_insert_caption_upload_v5(text),punchline_private.can_delete_caption_upload_v5(text),
  punchline_private.register_caption_image_v5(uuid,text,text),
  punchline_private.reserve_caption_generation_v5(uuid,text,text,text,text,text,text,text),
  punchline_private.complete_caption_generation_v5(uuid,text[]),punchline_private.get_caption_feed_v5(),
  punchline_private.get_caption_image_v5(uuid),public.register_caption_image_v5(uuid,text,text),
  public.reserve_caption_generation_v5(uuid,text,text,text,text,text,text,text),
  public.complete_caption_generation_v5(uuid,text[]),public.get_caption_feed_v5(),public.get_caption_image_v5(uuid)
  from public,anon,authenticated,service_role;
grant execute on function
  punchline_private.caption_image_published_v5(text),punchline_private.can_read_caption_upload_v5(text),
  punchline_private.can_insert_caption_upload_v5(text),punchline_private.can_delete_caption_upload_v5(text),
  punchline_private.register_caption_image_v5(uuid,text,text),
  punchline_private.reserve_caption_generation_v5(uuid,text,text,text,text,text,text,text),
  punchline_private.complete_caption_generation_v5(uuid,text[]),punchline_private.get_caption_feed_v5(),
  punchline_private.get_caption_image_v5(uuid),public.register_caption_image_v5(uuid,text,text),
  public.reserve_caption_generation_v5(uuid,text,text,text,text,text,text,text),
  public.complete_caption_generation_v5(uuid,text[]),public.get_caption_feed_v5(),public.get_caption_image_v5(uuid)
  to authenticated;

notify pgrst,'reload schema';
commit;
