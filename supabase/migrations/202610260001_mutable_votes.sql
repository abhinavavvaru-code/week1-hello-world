-- Apply after 202610170004_admin_console.sql. No new administrator grants.
begin;
alter table public.caption_votes add column updated_at timestamptz;
update public.caption_votes set updated_at=created_at;
alter table public.caption_votes alter column updated_at set default now(), alter column updated_at set not null;
-- Changes and undo pass through the atomic RPC. Legacy three-column INSERTs
-- remain compatible during rollout; timestamps and identities are protected.
revoke insert,update,delete on public.caption_votes from public,anon,authenticated;
revoke insert(caption_id,user_id,value),update(caption_id,user_id,value) on public.caption_votes from public,anon,authenticated;
drop policy caption_votes_owner_insert on public.caption_votes;
create function punchline_private.can_insert_caption_vote_v7(p_caption_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then return false; end if;
 perform 1 from public.captions c join public.caption_generations g on g.id=c.generation_id
  where c.id=p_caption_id and c.deleted_at is null and g.status='succeeded' for share of c;
 return found;
end $$;
revoke all on function punchline_private.can_insert_caption_vote_v7(uuid) from public,anon,authenticated,service_role;
grant execute on function punchline_private.can_insert_caption_vote_v7(uuid) to authenticated;
grant insert(caption_id,user_id,value) on public.caption_votes to authenticated;
create policy caption_votes_owner_insert on public.caption_votes for insert to authenticated
 with check((select auth.uid())=user_id and punchline_private.can_insert_caption_vote_v7(caption_id));


create function punchline_private.set_caption_vote_v7(p_caption_id uuid,p_value integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); current_vote public.caption_votes%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or caller is null then
    raise exception using errcode='42501',message='AUTHENTICATION_REQUIRED'; end if;
  if p_caption_id is null or p_value is null or p_value not in (-1,0,1) then
    raise exception using errcode='22023',message='INVALID_CAPTION_VOTE'; end if;
  -- Serialize votes and moderation on this caption so returned aggregates include
  -- this change, no duplicate ratings race, and hidden captions cannot be rated.
  perform 1 from public.captions c join public.caption_generations g on g.id=c.generation_id
    where c.id=p_caption_id and c.deleted_at is null and g.status='succeeded' for update of c;
  if not found then raise exception using errcode='P0002',message='CAPTION_NOT_FOUND'; end if;
  if p_value=0 then
    delete from public.caption_votes v where v.caption_id=p_caption_id and v.user_id=caller;
  else
    insert into public.caption_votes as v(caption_id,user_id,value)
      values(p_caption_id,caller,p_value::smallint)
      on conflict(user_id,caption_id) do update set value=excluded.value,
        updated_at=case when v.value is distinct from excluded.value then clock_timestamp() else v.updated_at end
      returning * into current_vote;
  end if;
  return jsonb_build_object('caption_id',p_caption_id,'value',p_value,
    'laughs',(select count(*) from public.caption_votes v where v.caption_id=p_caption_id and v.value=1),
    'groans',(select count(*) from public.caption_votes v where v.caption_id=p_caption_id and v.value=-1),
    'created_at',current_vote.created_at,'updated_at',current_vote.updated_at);
end $$;
create function public.set_caption_vote_v7(p_caption_id uuid,p_value integer)
returns jsonb language sql security invoker set search_path='' as $$
  select punchline_private.set_caption_vote_v7(p_caption_id,p_value);
$$;
revoke all on function public.set_caption_vote_v7(uuid,integer),punchline_private.set_caption_vote_v7(uuid,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.set_caption_vote_v7(uuid,integer),punchline_private.set_caption_vote_v7(uuid,integer) to authenticated;
-- Feed field names stay compatible; voted_at now reports the most recent change.
create or replace function punchline_private.get_caption_feed()
returns table (
  id uuid, content text, image_id text, created_at timestamptz, style text,
  laughs bigint, groans bigint, my_vote smallint, voted_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  return query
    select c.id, c.content, g.image_id, c.created_at, g.style,
      (select count(*) from public.caption_votes v where v.caption_id = c.id and v.value = 1),
      (select count(*) from public.caption_votes v where v.caption_id = c.id and v.value = -1),
      mine.value, mine.updated_at
    from public.captions c
    join public.caption_generations g on g.id = c.generation_id and g.status = 'succeeded'
    left join public.caption_votes mine on mine.caption_id = c.id and mine.user_id = caller
    where c.deleted_at is null
    order by c.created_at desc, c.generation_id, c.position;
end $$;


create or replace function punchline_private.get_caption_feed_v5()
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
    mine.value,mine.updated_at,g.user_id,
    case when nullif(btrim(p.first_name),'') is null or p.first_name like '%@%' then 'Member'
      else split_part(btrim(p.first_name),' ',1) ||
        case when nullif(btrim(p.last_name),'') is null then '' else ' ' || left(btrim(p.last_name),1) || '.' end end,
    i.src,i.alt,i.storage_path,g.topic,g.perspective,
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=1 and v.updated_at>=week_start and v.updated_at<week_end),
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=1 and v.updated_at>=month_start and v.updated_at<month_end)
  from public.captions c join public.caption_generations g on g.id=c.generation_id and g.status='succeeded'
    join public.caption_images i on i.id=g.image_id
    left join public.profiles p on p.id=g.user_id
    left join public.caption_votes mine on mine.caption_id=c.id and mine.user_id=caller
  where c.deleted_at is null
  order by c.created_at desc,c.generation_id,c.position;
end $$;


create or replace function punchline_private.get_caption_feed_v6()
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
    mine.value,mine.updated_at,case when caller is null then null::uuid else g.user_id end,
    case when nullif(btrim(p.first_name),'') is null or p.first_name like '%@%' then 'Member'
      else split_part(btrim(p.first_name),' ',1) ||
        case when nullif(btrim(p.last_name),'') is null then '' else ' ' || left(btrim(p.last_name),1) || '.' end end,
    i.src,i.alt,case when i.storage_path is not null then 'uploaded'::text else null::text end,
    g.topic,g.perspective,
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=1 and v.updated_at>=week_start and v.updated_at<week_end),
    (select count(*) from public.caption_votes v where v.caption_id=c.id and v.value=1 and v.updated_at>=month_start and v.updated_at<month_end),
    'creator-' || encode(sha256(convert_to(g.user_id::text,'UTF8')),'hex')
  from public.captions c join public.caption_generations g on g.id=c.generation_id and g.status='succeeded'
    join public.caption_images i on i.id=g.image_id
    left join public.profiles p on p.id=g.user_id
    left join public.caption_votes mine on mine.caption_id=c.id and mine.user_id=caller
  where c.deleted_at is null
  order by c.created_at desc,c.generation_id,c.position;
end $$;



notify pgrst,'reload schema';
commit;
