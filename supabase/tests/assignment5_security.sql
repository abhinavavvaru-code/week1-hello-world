-- Run as postgres against a local/staging database after both migrations.
-- Fixture users, photos, captions, and ratings are rolled back.
begin;
insert into auth.users(id,email) values
 ('51000000-0000-4000-8000-000000000001','v5-a@example.invalid'),
 ('51000000-0000-4000-8000-000000000002','v5-b@example.invalid'),
 ('51000000-0000-4000-8000-000000000003','v5-c@example.invalid'),
 ('51000000-0000-4000-8000-000000000004','v5-d@example.invalid'),
 ('51000000-0000-4000-8000-000000000005','v5-e@example.invalid');
insert into public.profiles(id,first_name,last_name) values
 ('51000000-0000-4000-8000-000000000001','Alex','Smith'),
 ('51000000-0000-4000-8000-000000000002','person@example.invalid','Private')
on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name;

create temporary table v5_test_ids(name text primary key,id uuid);
grant select,insert on v5_test_ids to authenticated;
-- Simulate preserved A4 media, including an old caption longer than the new limit.
insert into public.caption_generations(id,user_id,image_id,prompt,system_prompt,style,model,request_id,status,completed_at)
 values ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',
 'udp','Historical private prompt','Historical system prompt','dry','deepseek-flash',
 '53000000-0000-4000-8000-000000000001','succeeded',now());
insert into public.captions(id,generation_id,content,position) values
 ('54000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',repeat('x',200),1),
 ('54000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','Historical caption two.',2),
 ('54000000-0000-4000-8000-000000000003','52000000-0000-4000-8000-000000000001','Historical caption three.',3);

set local role authenticated;
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
begin
  begin
    perform public.register_caption_image_v5('55000000-0000-4000-8000-000000000001','My photo','An uploaded photo.');
    raise exception 'FAIL: registration without Storage object accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'UPLOADED_IMAGE_NOT_FOUND' then raise; end if;
  end;
  begin
    insert into storage.objects(bucket_id,name) values
     ('caption-uploads','51000000-0000-4000-8000-000000000002/55000000-0000-4000-8000-000000000001.jpg');
    raise exception 'FAIL: upload into another folder accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name) values
     ('caption-uploads','51000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001.png');
    raise exception 'FAIL: invalid upload extension accepted';
  exception when insufficient_privilege then null; end;
  insert into storage.objects(bucket_id,name) values
   ('caption-uploads','51000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001.jpg');
  if public.register_caption_image_v5('55000000-0000-4000-8000-000000000001','My photo','An uploaded photo.')
     <>'upload-55000000-0000-4000-8000-000000000001' then raise exception 'FAIL: unexpected image ID'; end if;
  perform public.register_caption_image_v5('55000000-0000-4000-8000-000000000001','My photo','An uploaded photo.');
  if (select count(*) from public.caption_images where owner_id=auth.uid())<>1 then
    raise exception 'FAIL: registration retry duplicated metadata'; end if;
  begin
    perform public.register_caption_image_v5('55000000-0000-4000-8000-000000000001','Changed title','An uploaded photo.');
    raise exception 'FAIL: registration overwrite accepted';
  exception when invalid_parameter_value then null; end;
  delete from storage.objects where bucket_id='caption-uploads';
  if not exists(select 1 from storage.objects where bucket_id='caption-uploads') then
    raise exception 'FAIL: registered image deleted by cleanup'; end if;
  update storage.objects set name='changed.jpg' where bucket_id='caption-uploads';
  if exists(select 1 from storage.objects where name='changed.jpg') then raise exception 'FAIL: photo overwrite accepted'; end if;
  insert into storage.objects(bucket_id,name) values
   ('caption-uploads','51000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000002.jpg');
  delete from storage.objects where name='51000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000002.jpg';
  if exists(select 1 from storage.objects where name='51000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000002.jpg') then
    raise exception 'FAIL: unregistered orphan cleanup denied'; end if;
end $$;

-- Another member cannot read or use an unpublished uploaded image through either RPC version.
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
begin
  if exists(select 1 from public.caption_images where owner_id='51000000-0000-4000-8000-000000000001') then
    raise exception 'FAIL: unpublished metadata leaked'; end if;
  if exists(select 1 from storage.objects where bucket_id='caption-uploads') then
    raise exception 'FAIL: unpublished photo leaked'; end if;
  begin
    perform public.reserve_caption_generation_v5(gen_random_uuid(),'upload-55000000-0000-4000-8000-000000000001',
      'Private prompt','wordplay','System prompt','deepseek-flash','campus','student');
    raise exception 'FAIL: another owner photo reservation accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'INVALID_CAPTION_IMAGE' then raise; end if;
  end;
  begin
    perform public.reserve_caption_generation(gen_random_uuid(),'upload-55000000-0000-4000-8000-000000000001',
      'Private prompt','dry','System prompt','deepseek-flash');
    raise exception 'FAIL: legacy image ownership bypass accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'INVALID_CAPTION_IMAGE' then raise; end if;
  end;
  if (select count(*) from public.complete_caption_generation('52000000-0000-4000-8000-000000000001',
       array['Ignored retry one.','Ignored retry two.','Ignored retry three.']))<>3 then
    raise exception 'FAIL: A4 completed generation retry broken'; end if;
  if not exists(select 1 from public.get_caption_feed_v5() f
      where f.id='54000000-0000-4000-8000-000000000001' and char_length(f.content)=200
        and f.topic='campus' and f.perspective='observer' and f.author_name='Member') then
    raise exception 'FAIL: historical data/defaults or email-safe author fallback broken'; end if;
end $$;

select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into v5_test_ids
 select 'generation',r.id from public.reserve_caption_generation_v5(
 '56000000-0000-4000-8000-000000000001','upload-55000000-0000-4000-8000-000000000001',
 'Private city context','wordplay','A private system prompt','deepseek-flash','nyc','tourist') r where r.is_new;
do $$
declare r record; generation uuid:=(select id from v5_test_ids where name='generation');
begin
  select * into r from public.reserve_caption_generation_v5(
   '56000000-0000-4000-8000-000000000001','upload-55000000-0000-4000-8000-000000000001',
   'Private city context','wordplay','A private system prompt','deepseek-flash','nyc','tourist');
  if r.is_new or r.topic<>'nyc' or r.perspective<>'tourist' then raise exception 'FAIL: V5 idempotence or options lost'; end if;
  begin
    perform public.reserve_caption_generation_v5(
     '56000000-0000-4000-8000-000000000001','upload-55000000-0000-4000-8000-000000000001',
     'Private city context','wordplay','A private system prompt','deepseek-flash','food','tourist');
    raise exception 'FAIL: request ID topic change accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.complete_caption_generation_v5(generation,
      array['one two three four five six seven eight nine ten eleven twelve thirteen','Valid second caption.','Valid third caption.']);
    raise exception 'FAIL: thirteen-word caption accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.complete_caption_generation_v5(generation,array[repeat('x',141),'Valid second caption.','Valid third caption.']);
    raise exception 'FAIL: 141-character caption accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.complete_caption_generation_v5(generation,
      array[replace('one two three four five six seven eight nine ten eleven twelve thirteen',' ',chr(160)),
            'Valid second caption.','Valid third caption.']);
    raise exception 'FAIL: Unicode spaces bypassed word limit';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.complete_caption_generation_v5(generation,array['Duplicate caption.','DUPLICATE CAPTION.','A third caption.']);
    raise exception 'FAIL: duplicate captions accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.complete_caption_generation(generation,
      array['one two three four five six seven eight nine ten eleven twelve thirteen','Valid second caption.','Valid third caption.']);
    raise exception 'FAIL: legacy completion bypassed V5 format limit';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from public.captions where generation_id=generation) then raise exception 'FAIL: failed validation saved partial captions'; end if;
end $$;
insert into v5_test_ids select 'caption',c.id from public.complete_caption_generation_v5(
 (select id from v5_test_ids where name='generation'),
 array['one two three four five six seven eight nine ten eleven twelve','My subway stop is a plot twist.','This coffee costs one elective.']) c where c.position=1;

do $$
declare r record; attempt integer;
begin
  if public.get_caption_image_v5((select id from v5_test_ids where name='caption'))
      <>'51000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001.jpg' then
    raise exception 'FAIL: published image path lookup failed'; end if;
  if public.get_caption_image_v5('54000000-0000-4000-8000-000000000001') is not null then
    raise exception 'FAIL: seed artwork should have no Storage path'; end if;
  for attempt in 2..5 loop
    select * into r from public.reserve_caption_generation_v5(
     ('56000000-0000-4000-8000-'||lpad(attempt::text,12,'0'))::uuid,
     'earth','More campus context','roast','System prompt','deepseek-flash');
    if r.topic<>'campus' or r.perspective<>'observer' then raise exception 'FAIL: default generation options incorrect'; end if;
  end loop;
  begin
    perform public.reserve_caption_generation_v5(gen_random_uuid(),'earth','More campus context','roast','System prompt','deepseek-flash');
    raise exception 'FAIL: sixth V5 daily generation accepted';
  exception when raise_exception then if sqlerrm<>'GENERATION_LIMIT_REACHED' then raise; end if; end;
end $$;

-- Published photos become readable to members, while source prompts/profiles stay private.
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
begin
  if not exists(select 1 from storage.objects where bucket_id='caption-uploads') then raise exception 'FAIL: published member photo read denied'; end if;
  if exists(select 1 from public.caption_generations where user_id='51000000-0000-4000-8000-000000000001') then
    raise exception 'FAIL: source prompts leaked'; end if;
  if exists(select 1 from public.profiles where id='51000000-0000-4000-8000-000000000001') then
    raise exception 'FAIL: author attribution loosened profiles RLS'; end if;
  if not exists(select 1 from public.get_caption_feed_v5() f where f.id=(select id from v5_test_ids where name='caption')
      and f.author_name='Alex S.' and f.topic='nyc' and f.perspective='tourist' and f.image_src=''
      and f.image_alt='An uploaded photo.' and f.storage_path is not null) then
    raise exception 'FAIL: attributed feed fields incorrect'; end if;
  delete from storage.objects where bucket_id='caption-uploads';
  if not exists(select 1 from storage.objects where bucket_id='caption-uploads') then raise exception 'FAIL: member deleted another owner published photo'; end if;
end $$;

reset role;
-- Cast votes at deliberately different New York calendar boundaries.
insert into public.caption_votes(caption_id,user_id,value,created_at)
 select (select id from v5_test_ids where name='caption'),u.id,u.value,u.cast_at from (values
  ('51000000-0000-4000-8000-000000000001'::uuid,1,now()),
  ('51000000-0000-4000-8000-000000000002'::uuid,-1,now()),
  ('51000000-0000-4000-8000-000000000003'::uuid,1,(date_trunc('week',now() at time zone 'America/New_York')+interval '1 hour') at time zone 'America/New_York'),
  ('51000000-0000-4000-8000-000000000004'::uuid,1,(date_trunc('month',now() at time zone 'America/New_York')+interval '1 hour') at time zone 'America/New_York'),
  ('51000000-0000-4000-8000-000000000005'::uuid,1,(date_trunc('month',now() at time zone 'America/New_York') at time zone 'America/New_York')-interval '1 second')
 )u(id,value,cast_at);
create temporary table v5_expected_counts as select
 count(*) filter(where value=1) as laughs,count(*) filter(where value=-1) as groans,
 count(*) filter(where value=1 and created_at >= (date_trunc('week',now() at time zone 'America/New_York') at time zone 'America/New_York')
   and created_at < ((date_trunc('week',now() at time zone 'America/New_York')+interval '1 week') at time zone 'America/New_York')) as week_upvotes,
 count(*) filter(where value=1 and created_at >= (date_trunc('month',now() at time zone 'America/New_York') at time zone 'America/New_York')
   and created_at < ((date_trunc('month',now() at time zone 'America/New_York')+interval '1 month') at time zone 'America/New_York')) as month_upvotes
 from public.caption_votes where caption_id=(select id from v5_test_ids where name='caption');
grant select on v5_expected_counts to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare f record; e record; n integer; image uuid;
begin
  select * into f from public.get_caption_feed_v5() where id=(select id from v5_test_ids where name='caption');
  select * into e from v5_expected_counts;
  if f.laughs<>e.laughs or f.groans<>e.groans or f.week_upvotes<>e.week_upvotes or f.month_upvotes<>e.month_upvotes or f.my_vote<>1 then
    raise exception 'FAIL: weekly/monthly/all-time scores or own vote incorrect'; end if;
  for n in 2..20 loop
    image:=('57000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
    insert into storage.objects(bucket_id,name) values('caption-uploads',auth.uid()::text||'/'||image::text||'.jpg');
    perform public.register_caption_image_v5(image,'Extra photo','An uploaded photo.');
  end loop;
  begin
    insert into storage.objects(bucket_id,name) values('caption-uploads',auth.uid()::text||'/57000000-0000-4000-8000-000000000021.jpg');
    raise exception 'FAIL: twenty-first daily Storage object accepted';
  exception when insufficient_privilege then null; end;
  perform public.register_caption_image_v5('55000000-0000-4000-8000-000000000001','My photo','An uploaded photo.');
end $$;
reset role;
insert into storage.objects(bucket_id,name,created_at) values('caption-uploads',
 '51000000-0000-4000-8000-000000000001/57000000-0000-4000-8000-000000000021.jpg',
 (date_trunc('day',now() at time zone 'America/New_York') at time zone 'America/New_York')-interval '1 second');
set local role authenticated;
do $$
begin
  begin
    perform public.register_caption_image_v5('57000000-0000-4000-8000-000000000021','Extra photo','An uploaded photo.');
    raise exception 'FAIL: twenty-first daily metadata row accepted';
  exception when raise_exception then if sqlerrm<>'IMAGE_UPLOAD_LIMIT_REACHED' then raise; end if; end;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
begin
  begin
    if exists(select 1 from storage.objects where bucket_id='caption-uploads') then raise exception 'FAIL: anonymous private photo read allowed'; end if;
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_caption_feed_v5(); raise exception 'FAIL: anonymous V5 feed allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_caption_image_v5('54000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: anonymous image lookup allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.register_caption_image_v5(gen_random_uuid(),'Title','Photo');
    raise exception 'FAIL: anonymous registration allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
begin
  if not exists(select 1 from storage.buckets where id='caption-uploads' and not public
      and file_size_limit=1048576 and allowed_mime_types=array['image/jpeg']) then
    raise exception 'FAIL: upload bucket configuration incorrect'; end if;
  if exists(select 1 from public.caption_generations where id='52000000-0000-4000-8000-000000000001' and format_version<>4) then
    raise exception 'FAIL: A4 format version changed'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like '%_v5' and p.prosecdef) then
    raise exception 'FAIL: privileged V5 functions exposed'; end if;
  if has_function_privilege('authenticated','punchline_private.complete_caption_generation_legacy_v4(uuid,text[])','execute') then
    raise exception 'FAIL: legacy completion implementation directly callable'; end if;
  raise notice 'PASS: V5 private uploads, ownership, cleanup, short captions, legacy compatibility, options, author privacy, calendar scores, and quotas.';
end $$;
rollback;
