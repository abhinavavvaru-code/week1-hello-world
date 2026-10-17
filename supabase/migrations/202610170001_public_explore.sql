-- Phase 1: public Explore, short new captions, and retry-aware generation quotas.
-- Apply after Assignment 5. The upload bucket remains private.
begin;

create or replace function punchline_private.reserve_caption_generation_v5(
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
  -- Expire crashed requests before counting active reservations.
  update public.caption_generations g set status='failed',completed_at=now()
    where g.user_id=caller and g.status='pending' and g.created_at<now()-interval '2 minutes';
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
        and g.status in ('pending','succeeded')
        and g.created_at >= (today::timestamp at time zone 'America/New_York')
        and g.created_at < ((today+1)::timestamp at time zone 'America/New_York')) >= 5 then
      raise exception using errcode='P0001',message='GENERATION_LIMIT_REACHED';
    end if;
    -- Pending calls may fail, so reserve their failure slots too. This keeps
    -- concurrent failures from exceeding the separate twenty-failure cost cap.
    if (select count(*) from public.caption_generations g where g.user_id=caller
        and g.status in ('pending','failed')
        and g.created_at >= (today::timestamp at time zone 'America/New_York')
        and g.created_at < ((today+1)::timestamp at time zone 'America/New_York')) >= 20 then
      raise exception using errcode='P0001',message='GENERATION_ATTEMPT_LIMIT_REACHED';
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

create or replace function punchline_private.complete_caption_generation_v5(p_generation_id uuid,p_captions text[])
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
       or cardinality(regexp_split_to_array(x.content,whitespace_pattern))>10)
     or (select count(distinct lower(x.content)) from pg_catalog.unnest(normalized_captions) x(content))<>3 then
    raise exception using errcode='22023',message='INVALID_GENERATED_CAPTIONS';
  end if;
  insert into public.captions(generation_id,content,position)
    select generation.id,x.content,x.position::smallint
      from pg_catalog.unnest(normalized_captions) with ordinality x(content,position);
  update public.caption_generations g set status='succeeded',completed_at=now() where g.id=generation.id;
  return query select c.* from public.captions c where c.generation_id=generation.id order by c.position;
end $$;

create or replace function punchline_private.get_generation_allowance()
returns integer language plpgsql stable security invoker set search_path = '' as $$
declare
  caller uuid:=auth.uid();
  today date:=(now() at time zone 'America/New_York')::date;
begin
  if caller is null then raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  return greatest(0,5-(select count(*)::integer from public.caption_generations g
    where g.user_id=caller and (g.status='succeeded'
      or (g.status='pending' and g.created_at>=now()-interval '2 minutes'))
    and g.created_at >= (today::timestamp at time zone 'America/New_York')
    and g.created_at < ((today+1)::timestamp at time zone 'America/New_York')));
end $$;

create function punchline_private.get_caption_feed_v6()
returns table (
  id uuid,content text,image_id text,created_at timestamptz,style text,laughs bigint,groans bigint,
  my_vote smallint,voted_at timestamptz,author_id uuid,author_name text,image_src text,image_alt text,
  storage_path text,topic text,perspective text,week_upvotes bigint,month_upvotes bigint,author_key text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid:=case when auth.role()='authenticated' then auth.uid() else null end;
  local_now timestamp:=now() at time zone 'America/New_York';
  week_start timestamptz:=date_trunc('week',local_now) at time zone 'America/New_York';
  week_end timestamptz:=(date_trunc('week',local_now)+interval '1 week') at time zone 'America/New_York';
  month_start timestamptz:=date_trunc('month',local_now) at time zone 'America/New_York';
  month_end timestamptz:=(date_trunc('month',local_now)+interval '1 month') at time zone 'America/New_York';
begin
  return query select c.id,c.content,g.image_id,c.created_at,g.style,
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=1),
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=-1),
    mine.value,mine.created_at,case when caller is null then null::uuid else g.user_id end,
    case when nullif(btrim(p.first_name),'') is null or p.first_name like '%@%' then 'Member'
      else split_part(btrim(p.first_name),' ',1) ||
        case when nullif(btrim(p.last_name),'') is null then '' else ' ' || left(btrim(p.last_name),1) || '.' end end,
    i.src,i.alt,case when i.storage_path is not null then 'uploaded'::text else null::text end,
    g.topic,g.perspective,
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=1 and v.created_at>=week_start and v.created_at<week_end),
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=1 and v.created_at>=month_start and v.created_at<month_end),
    'creator-' || encode(sha256(convert_to(g.user_id::text,'UTF8')),'hex')
  from public.captions c join public.caption_generations g on g.id=c.generation_id and g.status='succeeded'
    join public.caption_images i on i.id=g.image_id
    left join public.profiles p on p.id=g.user_id
    left join public.caption_votes mine on mine.caption_id=c.id and mine.user_id=caller
  order by c.created_at desc,c.generation_id,c.position;
end $$;

create function punchline_private.get_caption_image_v6(p_caption_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select i.storage_path from public.captions c
    join public.caption_generations g on g.id=c.generation_id and g.status='succeeded'
    join public.caption_images i on i.id=g.image_id where c.id=p_caption_id;
$$;

create function punchline_private.published_caption_upload_v6(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.caption_images i
    join public.caption_generations g on g.image_id=i.id and g.status='succeeded'
    join public.captions c on c.generation_id=g.id where i.storage_path=p_name);
$$;

create function punchline_private.caption_download_context_v6(p_name text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(current_setting('request.method',true)='GET'
    and split_part(coalesce(current_setting('request.path',true),''),'?',1)=any(array[
      '/object/caption-uploads/'||p_name,
      '/object/authenticated/caption-uploads/'||p_name,
      '/storage/v1/object/caption-uploads/'||p_name,
      '/storage/v1/object/authenticated/caption-uploads/'||p_name]),false);
$$;

-- A SELECT privilege also powers Storage listing. Restrict the anonymous policy
-- to the exact download operation, using Supabase's operation-aware helper.
do $$
begin
  if to_regprocedure('storage.allow_any_operation(text[])') is null then
    raise exception 'Public image downloads require the Supabase storage.allow_any_operation(text[]) helper.';
  end if;
  if not exists(select 1 from storage.buckets where id='caption-uploads' and not public) then
    raise exception 'caption-uploads must exist and remain private before enabling public Explore.';
  end if;
end $$;
grant usage on schema storage,punchline_private to anon;
grant select on storage.objects to anon;
create policy caption_uploads_published_download_v6 on storage.objects for select to anon
  using (bucket_id='caption-uploads'
    and (storage.allow_any_operation(array['object.get_authenticated'])
      or punchline_private.caption_download_context_v6(name))
    and punchline_private.published_caption_upload_v6(name));

create function public.get_caption_feed_v6()
returns table (
  id uuid,content text,image_id text,created_at timestamptz,style text,laughs bigint,groans bigint,
  my_vote smallint,voted_at timestamptz,author_id uuid,author_name text,image_src text,image_alt text,
  storage_path text,topic text,perspective text,week_upvotes bigint,month_upvotes bigint,author_key text
)
language sql stable security invoker set search_path = '' as $$
  select * from punchline_private.get_caption_feed_v6();
$$;
create function public.get_caption_image_v6(p_caption_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select punchline_private.get_caption_image_v6(p_caption_id);
$$;
create function public.complete_caption_generation_v6(p_generation_id uuid,p_captions text[])
returns setof public.captions language sql security invoker set search_path = '' as $$
  select * from punchline_private.complete_caption_generation_v5(p_generation_id,p_captions);
$$;

revoke all on function public.get_caption_feed_v6(),public.get_caption_image_v6(uuid),
  public.complete_caption_generation_v6(uuid,text[]),punchline_private.get_caption_feed_v6(),
  punchline_private.get_caption_image_v6(uuid),punchline_private.published_caption_upload_v6(text),
  punchline_private.caption_download_context_v6(text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_caption_feed_v6(),public.get_caption_image_v6(uuid),
  punchline_private.get_caption_feed_v6(),punchline_private.get_caption_image_v6(uuid),
  punchline_private.published_caption_upload_v6(text),punchline_private.caption_download_context_v6(text) to anon,authenticated;
grant execute on function public.complete_caption_generation_v6(uuid,text[]) to authenticated;

notify pgrst,'reload schema';
commit;

