-- Assignment 4: authenticated AI captions, private prompts, and insert-only ratings.
-- Run once as the project owner in Supabase's SQL Editor. This migration is atomic.
begin;

-- Stop rather than silently leaving an unexpected application table unsecured.
do $$
declare unexpected_tables text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into unexpected_tables
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relname not in ('messages', 'votes', 'profiles', 'caption_images',
                           'caption_generations', 'captions', 'caption_votes');
  if unexpected_tables is not null then
    raise exception 'Review RLS for unexpected public tables before running this migration: %', unexpected_tables;
  end if;
  if to_regclass('public.messages') is null or to_regclass('public.votes') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Expected Assignment 3 messages, votes, and profiles tables were not found.';
  end if;
end $$;

create schema if not exists punchline_private;
revoke all on schema punchline_private from public, anon;
grant usage on schema punchline_private to authenticated;

create table public.caption_images (
  id text primary key,
  title text not null,
  src text not null,
  alt text not null,
  scene text not null,
  created_at timestamptz not null default now()
);

create table public.caption_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_id text not null references public.caption_images(id),
  prompt text not null check (char_length(btrim(prompt)) between 1 and 500),
  system_prompt text not null check (char_length(btrim(system_prompt)) between 1 and 8000),
  style text not null check (style in ('dry', 'chaotic', 'wholesome')),
  provider text not null default 'deepseek' check (provider = 'deepseek'),
  model text not null check (char_length(btrim(model)) between 1 and 100),
  request_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, request_id),
  check ((status = 'pending' and completed_at is null)
      or (status <> 'pending' and completed_at is not null))
);
create index caption_generations_user_created on public.caption_generations(user_id, created_at);

create table public.captions (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.caption_generations(id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 5 and 220),
  position smallint not null check (position between 1 and 3),
  created_at timestamptz not null default now(),
  unique (generation_id, position),
  unique (generation_id, content)
);
create index captions_created on public.captions(created_at desc);

create table public.caption_votes (
  id uuid primary key default gen_random_uuid(),
  caption_id uuid not null references public.captions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  unique (user_id, caption_id)
);
create index caption_votes_caption_value on public.caption_votes(caption_id, value);
create index caption_votes_user_created on public.caption_votes(user_id, created_at desc);

insert into public.caption_images (id, title, src, alt, scene) values
  ('udp', 'Lost in transmission', '/captions/udp.svg',
   'A paper airplane carrying a message into the unknown',
   'A paper airplane carrying a message sails into a cloudy, uncertain sky.'),
  ('dark-mode', 'After hours', '/captions/dark-mode.svg',
   'A laptop glowing in the dark, attracting a few curious bugs',
   'A glowing laptop sits in a dark room while little bugs gather around its screen.'),
  ('gravity', 'Light reading', '/captions/gravity.svg',
   'An open book floating above a desk',
   'An open book floats weightlessly above a desk, with loose pages drifting nearby.'),
  ('interest', 'Funny business', '/captions/interest.svg',
   'A piggy bank beside a falling interest chart',
   'A piggy bank stands beside a chart whose line is falling downward.'),
  ('binary', 'Inside joke', '/captions/binary.svg',
   'Two friendly robots, one and zero',
   'Two friendly robots labeled one and zero stand together like an unlikely duo.'),
  ('earth', 'Daily rotation', '/captions/earth.svg',
   'A happy planet Earth enjoying the sunshine',
   'A smiling planet Earth floats in space, enjoying rays of sunshine.');

-- Replace only policies on this app's known tables; no rows are deleted.
do $$
declare existing_policy record;
begin
  for existing_policy in
    select schemaname, tablename, policyname from pg_catalog.pg_policies
     where schemaname = 'public'
       and tablename in ('messages', 'votes', 'profiles', 'caption_images',
                         'caption_generations', 'captions', 'caption_votes')
  loop
    execute format('drop policy %I on %I.%I', existing_policy.policyname,
                   existing_policy.schemaname, existing_policy.tablename);
  end loop;
end $$;

alter table public.messages enable row level security;
alter table public.votes enable row level security;
alter table public.profiles enable row level security;
alter table public.caption_images enable row level security;
alter table public.caption_generations enable row level security;
alter table public.captions enable row level security;
alter table public.caption_votes enable row level security;

revoke all on public.messages, public.votes, public.profiles, public.caption_images,
  public.caption_generations, public.captions, public.caption_votes from public, anon, authenticated;
grant select on public.messages, public.caption_images, public.captions to authenticated;
grant select on public.caption_generations to authenticated;
grant select on public.caption_votes to authenticated;
grant insert (caption_id, user_id, value) on public.caption_votes to authenticated;
grant select on public.profiles, public.votes to authenticated;
grant insert (id, first_name, last_name, avatar_url),
      update (id, first_name, last_name, avatar_url) on public.profiles to authenticated;

create policy messages_members_read on public.messages for select to authenticated using (true);
create policy legacy_votes_owner_read on public.votes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy profiles_owner_read on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy profiles_owner_insert on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
create policy profiles_owner_update on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy caption_images_members_read on public.caption_images for select to authenticated using (true);
create policy caption_generations_owner_read on public.caption_generations for select to authenticated
  using ((select auth.uid()) = user_id);
-- Captions are only published by the atomic completion function below.
create policy captions_members_read on public.captions for select to authenticated using (true);
create policy caption_votes_owner_read on public.caption_votes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy caption_votes_owner_insert on public.caption_votes for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Definer implementations stay outside the exposed API schema. The public
-- invoker wrappers below are the intentionally narrow authenticated API.
create function punchline_private.reserve_caption_generation(
  p_request_id uuid, p_image_id text, p_prompt text, p_style text,
  p_system_prompt text, p_model text
)
returns table (
  id uuid, user_id uuid, image_id text, prompt text, system_prompt text, style text,
  provider text, model text, request_id uuid, status text, created_at timestamptz,
  completed_at timestamptz, is_new boolean
)
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  generation public.caption_generations%rowtype;
  today date := (now() at time zone 'America/New_York')::date;
  day_start timestamptz := today::timestamp at time zone 'America/New_York';
  day_end timestamptz := (today + 1)::timestamp at time zone 'America/New_York';
  was_created boolean := false;
begin
  if caller is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  if p_request_id is null or p_image_id is null or p_prompt is null
     or p_system_prompt is null or p_model is null or p_style is null
     or char_length(btrim(p_prompt)) not between 1 and 500
     or char_length(btrim(p_system_prompt)) not between 1 and 8000
     or char_length(btrim(p_model)) not between 1 and 100
     or p_style not in ('dry', 'chaotic', 'wholesome') then
    raise exception using errcode = '22023', message = 'INVALID_GENERATION_INPUT';
  end if;
  if not exists (select 1 from public.caption_images i where i.id = p_image_id) then
    raise exception using errcode = '22023', message = 'INVALID_CAPTION_IMAGE';
  end if;

  -- Serialize reservations for this user so concurrent requests cannot exceed five.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('caption-generation:' || caller::text, 0));
  select g.* into generation from public.caption_generations g
   where g.user_id = caller and g.request_id = p_request_id for update;
  if found then
    if generation.image_id <> p_image_id or generation.prompt <> btrim(p_prompt)
       or generation.style <> p_style or generation.system_prompt <> btrim(p_system_prompt)
       or generation.model <> btrim(p_model) then
      raise exception using errcode = '22023', message = 'REQUEST_ID_REUSED_WITH_DIFFERENT_INPUT';
    end if;
    -- A server request has a shorter timeout. A crashed caller must not leave
    -- this request ID pending forever or cause a second provider call on retry.
    if generation.status = 'pending' and generation.created_at < now() - interval '2 minutes' then
      update public.caption_generations g set status = 'failed', completed_at = now()
       where g.id = generation.id and g.status = 'pending'
       returning g.* into generation;
    end if;
  else
    if (select count(*) from public.caption_generations g
         where g.user_id = caller and g.created_at >= day_start and g.created_at < day_end) >= 5 then
      raise exception using errcode = 'P0001', message = 'GENERATION_LIMIT_REACHED';
    end if;
    insert into public.caption_generations as g
      (user_id, image_id, prompt, style, system_prompt, model, request_id)
    values (caller, p_image_id, btrim(p_prompt), p_style, btrim(p_system_prompt), btrim(p_model), p_request_id)
    returning g.* into generation;
    was_created := true;
  end if;
  return query select generation.id, generation.user_id, generation.image_id,
    generation.prompt, generation.system_prompt, generation.style, generation.provider,
    generation.model, generation.request_id, generation.status, generation.created_at,
    generation.completed_at, was_created;
end $$;

create function punchline_private.complete_caption_generation(p_generation_id uuid, p_captions text[])
returns setof public.captions
language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid(); generation public.caption_generations%rowtype;
begin
  if caller is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  select g.* into generation from public.caption_generations g
   where g.id = p_generation_id and g.user_id = caller for update;
  if not found then raise exception using errcode = 'P0001', message = 'GENERATION_NOT_FOUND'; end if;
  if generation.status = 'succeeded' then
    return query select c.* from public.captions c where c.generation_id = generation.id order by c.position;
    return;
  end if;
  if generation.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'GENERATION_NOT_PENDING';
  end if;
  if p_captions is null or cardinality(p_captions) <> 3
     or exists (select 1 from pg_catalog.unnest(p_captions) x(content)
                where x.content is null or char_length(btrim(x.content)) not between 5 and 220)
     or (select count(distinct lower(btrim(x.content))) from pg_catalog.unnest(p_captions) x(content)) <> 3 then
    raise exception using errcode = '22023', message = 'INVALID_GENERATED_CAPTIONS';
  end if;
  insert into public.captions (generation_id, content, position)
    select generation.id, btrim(x.content), x.position::smallint
      from pg_catalog.unnest(p_captions) with ordinality x(content, position);
  update public.caption_generations g set status = 'succeeded', completed_at = now()
   where g.id = generation.id;
  return query select c.* from public.captions c where c.generation_id = generation.id order by c.position;
end $$;

create function punchline_private.fail_caption_generation(p_generation_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  -- Only the owner can fail a pending reservation; completed results stay intact.
  update public.caption_generations g set status = 'failed', completed_at = now()
   where g.id = p_generation_id and g.user_id = caller and g.status = 'pending';
end $$;

create function punchline_private.get_caption_feed()
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
      mine.value, mine.created_at
    from public.captions c
    join public.caption_generations g on g.id = c.generation_id and g.status = 'succeeded'
    left join public.caption_votes mine on mine.caption_id = c.id and mine.user_id = caller
    order by c.created_at desc, c.generation_id, c.position;
end $$;

create function punchline_private.get_generation_allowance()
returns integer language plpgsql stable security invoker set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  today date := (now() at time zone 'America/New_York')::date;
begin
  if caller is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  return greatest(0, 5 - (select count(*)::integer from public.caption_generations g
    where g.user_id = caller
      and g.created_at >= (today::timestamp at time zone 'America/New_York')
      and g.created_at < ((today + 1)::timestamp at time zone 'America/New_York')));
end $$;

create function public.reserve_caption_generation(
  p_request_id uuid, p_image_id text, p_prompt text, p_style text,
  p_system_prompt text, p_model text
)
returns table (
  id uuid, user_id uuid, image_id text, prompt text, system_prompt text, style text,
  provider text, model text, request_id uuid, status text, created_at timestamptz,
  completed_at timestamptz, is_new boolean
)
language sql security invoker set search_path = '' as $$
  select * from punchline_private.reserve_caption_generation(
    p_request_id, p_image_id, p_prompt, p_style, p_system_prompt, p_model);
$$;
create function public.complete_caption_generation(p_generation_id uuid, p_captions text[])
returns setof public.captions language sql security invoker set search_path = '' as $$
  select * from punchline_private.complete_caption_generation(p_generation_id, p_captions);
$$;
create function public.fail_caption_generation(p_generation_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select punchline_private.fail_caption_generation(p_generation_id);
$$;
create function public.get_caption_feed()
returns table (
  id uuid, content text, image_id text, created_at timestamptz, style text,
  laughs bigint, groans bigint, my_vote smallint, voted_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select * from punchline_private.get_caption_feed();
$$;
create function public.get_generation_allowance()
returns integer language sql stable security invoker set search_path = '' as $$
  select punchline_private.get_generation_allowance();
$$;

revoke all on function punchline_private.reserve_caption_generation(uuid,text,text,text,text,text),
  punchline_private.complete_caption_generation(uuid,text[]), punchline_private.fail_caption_generation(uuid),
  punchline_private.get_caption_feed(), public.reserve_caption_generation(uuid,text,text,text,text,text),
  public.complete_caption_generation(uuid,text[]), public.fail_caption_generation(uuid),
  public.get_caption_feed(), punchline_private.get_generation_allowance(), public.get_generation_allowance()
  from public, anon, authenticated, service_role;
grant execute on function punchline_private.reserve_caption_generation(uuid,text,text,text,text,text),
  punchline_private.complete_caption_generation(uuid,text[]), punchline_private.fail_caption_generation(uuid),
  punchline_private.get_caption_feed(), public.reserve_caption_generation(uuid,text,text,text,text,text),
  public.complete_caption_generation(uuid,text[]), public.fail_caption_generation(uuid),
  public.get_caption_feed(), punchline_private.get_generation_allowance(), public.get_generation_allowance()
  to authenticated;

-- Preserve public avatar URLs, but restrict uploads/listing/changes to own folders.
-- Existing project owns only this bucket. Abort if policies also protect another bucket.
do $$
declare existing_policy record;
begin
  if exists (select 1 from storage.buckets where id <> 'avatars') then
    raise exception 'Additional Storage buckets require a scoped policy review before this migration.';
  end if;
  for existing_policy in
    select policyname from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
  loop
    execute format('drop policy %I on storage.objects', existing_policy.policyname);
  end loop;
end $$;
create policy avatars_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

notify pgrst, 'reload schema';
commit;
