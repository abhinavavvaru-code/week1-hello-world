-- Execute as postgres after the migration, preferably on a local/staging database.
-- All fixture users, media, and ratings roll back at the end.
begin;

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'assignment4-a@example.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'assignment4-b@example.invalid');
insert into public.profiles (id, first_name, last_name) values
  ('10000000-0000-4000-8000-000000000001', 'Test', 'A'),
  ('10000000-0000-4000-8000-000000000002', 'Test', 'B')
on conflict (id) do update set first_name = excluded.first_name, last_name = excluded.last_name;
insert into public.messages (id, content) values (9223372036854775806, 'Assignment 4 historical fixture');
insert into public.votes (user_id,message_id,value)
  values ('10000000-0000-4000-8000-000000000001',9223372036854775806,1);

create temporary table assignment4_test_ids (name text primary key, id uuid not null);
grant select, insert on assignment4_test_ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
begin
  if (select count(*) from public.profiles) <> 1 then raise exception 'FAIL: profiles must be private'; end if;
  if (select count(*) from public.caption_images) <> 6 then raise exception 'FAIL: image seeds missing'; end if;
  if public.get_generation_allowance() <> 5 then raise exception 'FAIL: initial allowance must be five'; end if;
  if (select count(*) from public.votes) <> 1 then raise exception 'FAIL: historical own vote must remain readable'; end if;
  begin
    insert into public.votes (user_id,message_id,value)
      values ('10000000-0000-4000-8000-000000000001',9223372036854775806,-1);
    raise exception 'FAIL: legacy vote insertion accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.votes set value = -1 where user_id = '10000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: legacy vote editing accepted';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.votes where user_id = '10000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: legacy vote deletion accepted';
  exception when insufficient_privilege then null; end;
  insert into public.profiles (id,first_name,last_name,avatar_url)
    values ('10000000-0000-4000-8000-000000000001','Updated','Profile',null)
    on conflict (id) do update set id = excluded.id, first_name = excluded.first_name,
      last_name = excluded.last_name, avatar_url = excluded.avatar_url;
  if not exists (select 1 from public.profiles where first_name = 'Updated' and last_name = 'Profile') then
    raise exception 'FAIL: profile upsert must still work';
  end if;
  begin
    update public.profiles set created_at = now() - interval '1 year'
      where id = '10000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: profile timestamp editing accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.profiles (id,first_name,created_at)
      values ('10000000-0000-4000-8000-000000000001','Spoofed',now() - interval '1 year');
    raise exception 'FAIL: profile timestamp insertion accepted';
  exception when insufficient_privilege then null; end;
  insert into storage.objects (bucket_id,name)
    values ('avatars','10000000-0000-4000-8000-000000000001/test-avatar.png');
  begin
    insert into storage.objects (bucket_id,name)
      values ('avatars','10000000-0000-4000-8000-000000000002/test-avatar.png');
    raise exception 'FAIL: another owner avatar folder accepted';
  exception when insufficient_privilege then null; end;
end $$;

insert into assignment4_test_ids
  select 'generation-a', r.id from public.reserve_caption_generation(
    '20000000-0000-4000-8000-000000000001', 'udp', 'Dorm group chat context', 'dry',
    'Generate three short captions for the supplied scene.', 'deepseek-flash') r
  where r.is_new;

do $$
declare result record;
begin
  select * into result from public.reserve_caption_generation(
    '20000000-0000-4000-8000-000000000001', 'udp', 'Dorm group chat context', 'dry',
    'Generate three short captions for the supplied scene.', 'deepseek-flash');
  if result.is_new or result.status <> 'pending'
     or result.id <> (select id from assignment4_test_ids where name = 'generation-a') then
    raise exception 'FAIL: reservation retries must return the existing pending row';
  end if;
  begin
    perform public.reserve_caption_generation(
      '20000000-0000-4000-8000-000000000001', 'udp', 'A different prompt', 'dry',
      'Generate three short captions for the supplied scene.', 'deepseek-flash');
    raise exception 'FAIL: request IDs cannot be reused for another input';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.complete_caption_generation(
      result.id, array['Duplicate caption', 'Duplicate caption', 'A third caption']);
    raise exception 'FAIL: duplicate captions must be rejected';
  exception when invalid_parameter_value then null; end;
  if exists (select 1 from public.captions where generation_id = result.id) then
    raise exception 'FAIL: invalid completion must leave no partial captions';
  end if;
end $$;

insert into assignment4_test_ids
  select 'caption-a', c.id from public.complete_caption_generation(
    (select id from assignment4_test_ids where name = 'generation-a'),
    array['The group chat has left the building.', 'Office hours, delivered by paper airplane.', 'My Wi-Fi has a flight delay.']) c
  where c.position = 1;

do $$
declare caption uuid := (select id from assignment4_test_ids where name = 'caption-a'); result_count bigint;
begin
  select count(*) into result_count from public.complete_caption_generation(
    (select id from assignment4_test_ids where name = 'generation-a'),
    array['A retry does not publish again.', 'A retry uses the saved results.', 'There should still be three captions.']);
  if result_count <> 3 then raise exception 'FAIL: completion retries must return three saved rows'; end if;
  if (select count(*) from public.captions) <> 3 then raise exception 'FAIL: captions were duplicated'; end if;
  insert into public.caption_votes (caption_id, user_id, value)
    values (caption, '10000000-0000-4000-8000-000000000001', 1);
  begin
    insert into public.caption_votes (caption_id, user_id, value)
      values (caption, '10000000-0000-4000-8000-000000000001', -1);
    raise exception 'FAIL: duplicate ratings must be rejected';
  exception when unique_violation then null; end;
  begin
    insert into public.caption_votes (caption_id, user_id, value)
      values (caption, '10000000-0000-4000-8000-000000000002', 1);
    raise exception 'FAIL: spoofed vote owner accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.caption_votes set value = -1 where caption_id = caption;
    raise exception 'FAIL: votes must be insert-only';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.caption_votes where caption_id = caption;
    raise exception 'FAIL: votes must not be deleted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.captions (generation_id, content, position)
      values ((select id from assignment4_test_ids where name = 'generation-a'), 'A direct caption insert.', 1);
    raise exception 'FAIL: direct caption writes must be denied';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.caption_generations (user_id,image_id,prompt,system_prompt,style,model,request_id)
      values ('10000000-0000-4000-8000-000000000001','udp','prompt','system','dry','deepseek-flash',gen_random_uuid());
    raise exception 'FAIL: reservations must go through the quota function';
  exception when insufficient_privilege then null; end;
  if not exists (select 1 from public.get_caption_feed() f
      where f.id = caption and f.laughs = 1 and f.groans = 0 and f.my_vote = 1) then
    raise exception 'FAIL: aggregate score or own vote missing';
  end if;
end $$;

-- Complete, pending, and failed attempts all count toward the daily limit.
do $$
declare r record; attempt integer;
begin
  for attempt in 2..5 loop
    select * into r from public.reserve_caption_generation(
      ('20000000-0000-4000-8000-' || lpad(attempt::text, 12, '0'))::uuid,
      'earth', 'Weekend city context', 'wholesome', 'Generate three captions.', 'deepseek-flash');
    if attempt = 2 then perform public.fail_caption_generation(r.id); end if;
  end loop;
  begin
    perform public.reserve_caption_generation(
      '20000000-0000-4000-8000-000000000006','earth','Weekend city context','wholesome',
      'Generate three captions.','deepseek-flash');
    raise exception 'FAIL: sixth daily generation accepted';
  exception when raise_exception then
    if sqlerrm <> 'GENERATION_LIMIT_REACHED' then raise; end if;
  end;
  select * into r from public.reserve_caption_generation(
    '20000000-0000-4000-8000-000000000001','udp','Dorm group chat context','dry',
    'Generate three short captions for the supplied scene.','deepseek-flash');
  if r.is_new or r.status <> 'succeeded' then
    raise exception 'FAIL: idempotent retry at the quota must still succeed';
  end if;
  if public.get_generation_allowance() <> 0 then raise exception 'FAIL: exhausted allowance must be zero'; end if;
end $$;

-- User B sees published captions and aggregate counts, but no A prompts or vote rows.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare caption uuid := (select id from assignment4_test_ids where name = 'caption-a');
begin
  if exists (select 1 from public.caption_generations) then raise exception 'FAIL: another owner prompt leaked'; end if;
  if exists (select 1 from public.caption_votes) then raise exception 'FAIL: another owner vote leaked'; end if;
  if exists (select 1 from public.votes) then raise exception 'FAIL: another owner historical vote leaked'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'avatars') then
    raise exception 'FAIL: another owner avatar listing leaked';
  end if;
  if public.get_generation_allowance() <> 5 then raise exception 'FAIL: B allowance must be independent'; end if;
  if not exists (select 1 from public.get_caption_feed() f
      where f.id = caption and f.laughs = 1 and f.my_vote is null) then
    raise exception 'FAIL: B must see aggregate ratings with their own empty vote';
  end if;
  begin
    perform public.complete_caption_generation(
      (select id from assignment4_test_ids where name = 'generation-a'),
      array['An unauthorized completion.', 'Another unauthorized caption.', 'This must not be stored.']);
    raise exception 'FAIL: another owner generation accepted';
  exception when raise_exception then
    if sqlerrm <> 'GENERATION_NOT_FOUND' then raise; end if;
  end;
  perform public.fail_caption_generation((select id from assignment4_test_ids where name = 'generation-a'));
  insert into public.caption_votes (caption_id,user_id,value)
    values (caption,'10000000-0000-4000-8000-000000000002',-1);
  if not exists (select 1 from public.get_caption_feed() f
      where f.id = caption and f.laughs = 1 and f.groans = 1 and f.my_vote = -1) then
    raise exception 'FAIL: B rating or aggregate count incorrect';
  end if;
end $$;

-- An interrupted request can expire without a duplicate provider reservation.
insert into assignment4_test_ids
  select 'pending-b', r.id from public.reserve_caption_generation(
    '40000000-0000-4000-8000-000000000001','gravity','Finals week context','chaotic',
    'Generate three captions.','deepseek-flash') r;
do $$
declare r record;
begin
  select * into r from public.reserve_caption_generation(
    '40000000-0000-4000-8000-000000000001','gravity','Finals week context','chaotic',
    'Generate three captions.','deepseek-flash');
  if r.is_new or r.status <> 'pending' then raise exception 'FAIL: recent pending request must stay pending'; end if;
end $$;
reset role;
update public.caption_generations set created_at = now() - interval '3 minutes'
 where id = (select id from assignment4_test_ids where name = 'pending-b');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.reserve_caption_generation(
    '40000000-0000-4000-8000-000000000001','gravity','Finals week context','chaotic',
    'Generate three captions.','deepseek-flash');
  if r.is_new or r.status <> 'failed' or r.completed_at is null then
    raise exception 'FAIL: stale pending request must expire without another provider reservation';
  end if;
end $$;

-- A disconnected anonymous request cannot read app tables or call privileged RPCs.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform 1 from public.captions;
    raise exception 'FAIL: anonymous caption read accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_caption_feed();
    raise exception 'FAIL: anonymous feed accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.reserve_caption_generation(gen_random_uuid(),'earth','prompt','dry','system','deepseek-flash');
    raise exception 'FAIL: anonymous reservation accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_generation_allowance();
    raise exception 'FAIL: anonymous allowance accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
  ) then raise exception 'FAIL: an application table is missing RLS'; end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('reserve_caption_generation',
       'complete_caption_generation','fail_caption_generation','get_caption_feed','get_generation_allowance') and p.prosecdef
  ) then raise exception 'FAIL: privileged functions should not be exposed directly'; end if;
  raise notice 'PASS: Assignment 4 ownership, rating insert, prompt privacy, quota, idempotence, and anonymous access checks.';
end $$;
rollback;
