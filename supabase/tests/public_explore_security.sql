-- PostgreSQL/local or staging only. Fixtures roll back. Run after the V6 migration.
begin;
insert into auth.users(id,email) values
 ('61000000-0000-4000-8000-000000000001','public-test-a@example.invalid'),
 ('61000000-0000-4000-8000-000000000002','public-test-b@example.invalid'),
 ('61000000-0000-4000-8000-000000000003','public-test-quota@example.invalid');
insert into public.profiles(id,first_name,last_name) values
 ('61000000-0000-4000-8000-000000000001','Alex','Artist'),
 ('61000000-0000-4000-8000-000000000002','Private','Member')
on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name;
insert into storage.objects(bucket_id,name) values
 ('caption-uploads','61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.jpg'),
 ('caption-uploads','61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000002.jpg');
insert into public.caption_images(id,title,src,alt,scene,owner_id,storage_path) values
 ('upload-62000000-0000-4000-8000-000000000001','Published photo','','A published photo.','Generic photo.',
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.jpg'),
 ('upload-62000000-0000-4000-8000-000000000002','Private photo','','A private photo.','Generic photo.',
  '61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000002.jpg');
insert into public.caption_generations(id,user_id,image_id,prompt,system_prompt,style,model,request_id,status,completed_at,format_version) values
 ('63000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',
  'upload-62000000-0000-4000-8000-000000000001','PRIVATE source prompt','PRIVATE system prompt','dry','deepseek-flash',
  '64000000-0000-4000-8000-000000000001','succeeded',now(),5),
 ('63000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001',
  'upload-62000000-0000-4000-8000-000000000002','PRIVATE pending prompt','PRIVATE system prompt','dry','deepseek-flash',
  '64000000-0000-4000-8000-000000000002','pending',null,5);
insert into public.captions(id,generation_id,content,position) values
 ('65000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001',
  'one two three four five six seven eight nine ten eleven twelve',1),
 ('65000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000001','Existing caption two.',2),
 ('65000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000001','Existing caption three.',3),
 ('65000000-0000-4000-8000-000000000004','63000000-0000-4000-8000-000000000002','Must stay unpublished.',1);
insert into public.caption_votes(caption_id,user_id,value) values
 ('65000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',1),
 ('65000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002',-1);
create temporary table v6_test_values(name text primary key,value text);
grant select,insert on v6_test_values to anon,authenticated;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$
declare f record; relation text;
begin
  select * into f from public.get_caption_feed_v6() where id='65000000-0000-4000-8000-000000000001';
  if f.id is null or f.laughs<>1 or f.groans<>1 or f.my_vote is not null or f.voted_at is not null
     or f.author_id is not null or f.author_name<>'Alex A.' or f.storage_path<>'uploaded'
     or f.author_key !~ '^creator-[a-f0-9]{64}$' then
    raise exception 'FAIL: public feed shape or caller privacy incorrect'; end if;
  insert into v6_test_values values('author_key',f.author_key);
  if exists(select 1 from public.get_caption_feed_v6() where id='65000000-0000-4000-8000-000000000004') then
    raise exception 'FAIL: unpublished caption in public feed'; end if;
  if public.get_caption_image_v6('65000000-0000-4000-8000-000000000001')
     <>'61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.jpg' then
    raise exception 'FAIL: published photo lookup denied'; end if;
  if public.get_caption_image_v6('65000000-0000-4000-8000-000000000004') is not null then
    raise exception 'FAIL: unpublished photo lookup allowed'; end if;
  foreach relation in array array['profiles','caption_generations','caption_votes','caption_images','captions'] loop
    begin
      execute format('select 1 from public.%I limit 1',relation);
      raise exception 'FAIL: anonymous raw table % readable',relation;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    perform public.reserve_caption_generation_v5(gen_random_uuid(),'earth','Prompt','dry','System','deepseek-flash');
    raise exception 'FAIL: anonymous generation accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.complete_caption_generation_v6('63000000-0000-4000-8000-000000000001',array['One caption.','Two caption.','Third caption.']);
    raise exception 'FAIL: anonymous completion accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.caption_votes(caption_id,user_id,value) values
      ('65000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001',1);
    raise exception 'FAIL: anonymous vote accepted';
  exception when insufficient_privilege then null; end;
end $$;

-- Anonymous downloads can see exactly published objects; listings cannot.
select set_config('storage.test_operation','object.get_authenticated',true);
do $$
begin
  if (select count(*) from storage.objects where bucket_id='caption-uploads')<>1 then
    raise exception 'FAIL: anonymous download must see one published photo only'; end if;
end $$;
select set_config('storage.test_operation','storage.object.list',true);
do $$
begin
  if exists(select 1 from storage.objects where bucket_id='caption-uploads') then
    raise exception 'FAIL: anonymous bucket listing allowed'; end if;
end $$;
select set_config('storage.test_operation','',true);
do $$
begin
  if exists(select 1 from storage.objects where bucket_id='caption-uploads') then
    raise exception 'FAIL: operation-less raw Storage read allowed'; end if;
end $$;
-- Older Storage middleware can omit the operation while still providing method/path.
select set_config('request.method','GET',true);
select set_config('request.path','/object/caption-uploads/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.jpg',true);
do $$
begin
  if (select count(*) from storage.objects where bucket_id='caption-uploads')<>1 then
    raise exception 'FAIL: exact published download fallback denied'; end if;
end $$;
select set_config('request.method','POST',true);
do $$
begin
  if exists(select 1 from storage.objects where bucket_id='caption-uploads') then
    raise exception 'FAIL: non-GET request inherited download fallback'; end if;
end $$;
select set_config('request.method','GET',true);
select set_config('request.path','/object/list/caption-uploads',true);
do $$
begin
  if exists(select 1 from storage.objects where bucket_id='caption-uploads') then
    raise exception 'FAIL: listing path inherited download fallback'; end if;
end $$;
select set_config('request.path','/object/caption-uploads/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000002.jpg',true);
do $$
begin
  if exists(select 1 from storage.objects where bucket_id='caption-uploads') then
    raise exception 'FAIL: exact unpublished path inherited download fallback'; end if;
end $$;
select set_config('request.method','',true);
select set_config('request.path','',true);
-- A single published-object signature is allowed; private objects and bulk/list
-- operations remain denied. The application requests a sixty-second signature.
select set_config('storage.test_operation','object.sign',true);
do $$
begin
  if (select count(*) from storage.objects where bucket_id='caption-uploads')<>1 then
    raise exception 'FAIL: single-object signing exposed a private photo or denied the published one'; end if;
end $$;
select set_config('storage.test_operation','object.sign_many',true);
do $$
begin
  if exists(select 1 from storage.objects where bucket_id='caption-uploads') then
    raise exception 'FAIL: anonymous bulk signing allowed';end if;
end $$;
select set_config('storage.test_operation','',true);
select set_config('request.method','POST',true);
select set_config('request.path','/object/sign/caption-uploads/61000000-0000-4000-8000-000000000001/62000000-0000-4000-8000-000000000001.jpg',true);
do $$
begin
  if (select count(*) from storage.objects where bucket_id='caption-uploads')<>1 then
    raise exception 'FAIL: exact published signing path fallback denied';end if;
end $$;
select set_config('request.path','/object/list/caption-uploads',true);
do $$
begin
  if exists(select 1 from storage.objects where bucket_id='caption-uploads') then
    raise exception 'FAIL: listing inherited signing permission';end if;
end $$;
select set_config('request.method','',true);
select set_config('request.path','',true);

-- Even a subject accidentally present in an anon-role context must not reveal votes.
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
do $$
begin
  if exists(select 1 from public.get_caption_feed_v6() where author_id is not null or my_vote is not null or voted_at is not null) then
    raise exception 'FAIL: anon role context inherited member details'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare f record;
begin
  select * into f from public.get_caption_feed_v6() where id='65000000-0000-4000-8000-000000000001';
  if f.my_vote<>-1 or f.author_id<>'61000000-0000-4000-8000-000000000001'
     or f.author_key<>(select value from v6_test_values where name='author_key') then
    raise exception 'FAIL: member own vote or stable public author key incorrect'; end if;
  if exists(select 1 from public.caption_generations where user_id='61000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.profiles where id='61000000-0000-4000-8000-000000000001') then
    raise exception 'FAIL: public gallery loosened prompt/profile privacy'; end if;
  if exists(select 1 from storage.objects where name like '%62000000-0000-4000-8000-000000000002.jpg') then
    raise exception 'FAIL: member read another owner unpublished image'; end if;
  if (select count(*) from public.complete_caption_generation_v6('63000000-0000-4000-8000-000000000001',
      array['Ignored first.','Ignored second.','Ignored third.']))<>0 then
    raise exception 'FAIL: another member completion accepted'; end if;
exception when raise_exception then if sqlerrm<>'GENERATION_NOT_FOUND' then raise; end if;
end $$;

-- Refund failed attempts, preserve successful/pending slots, and bound failures.
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$
declare r record; n integer;
begin
  for n in 1..5 loop
    select * into r from public.reserve_caption_generation_v5(
      ('66000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'earth','Quota context','dry','System','deepseek-flash');
    perform public.fail_caption_generation(r.id);
  end loop;
  if public.get_generation_allowance()<>5 then raise exception 'FAIL: failed requests consumed five-success allowance'; end if;
  select * into r from public.reserve_caption_generation_v5(
    '66000000-0000-4000-8000-000000000006','earth','Quota context','dry','System','deepseek-flash');
  insert into v6_test_values values('pending_id',r.id::text);
  begin
    perform public.complete_caption_generation_v6(r.id,
      array['one two three four five six seven eight nine ten eleven','Valid second caption.','Valid third caption.']);
    raise exception 'FAIL: eleven words accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.complete_caption_generation_v5(r.id,
      array[replace('one two three four five six seven eight nine ten eleven',' ',chr(160)),
        'Valid second caption.','Valid third caption.']);
    raise exception 'FAIL: old V5 RPC or Unicode spaces bypassed ten-word guard';
  exception when invalid_parameter_value then null; end;
  perform public.complete_caption_generation_v6(r.id,
    array['one two three four five six seven eight nine ten','Valid second caption.','Valid third caption.']);
  if public.get_generation_allowance()<>4 then raise exception 'FAIL: succeeded generation did not consume exactly one slot'; end if;
end $$;

-- Expired pending work must stop consuming UI allowance before a new reservation.
reset role;
insert into public.caption_generations(id,user_id,image_id,prompt,system_prompt,style,model,request_id,created_at,format_version)
 values('67000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000003','earth',
 'Stale context','System','dry','deepseek-flash','68000000-0000-4000-8000-000000000001',now()-interval '3 minutes',5);
set local role authenticated;
do $$
declare r record; n integer;
begin
  if public.get_generation_allowance()<>4 then raise exception 'FAIL: stale pending consumed UI allowance'; end if;
  select * into r from public.reserve_caption_generation_v5(
    '68000000-0000-4000-8000-000000000002','earth','New context','dry','System','deepseek-flash');
  if not exists(select 1 from public.caption_generations where id='67000000-0000-4000-8000-000000000001' and status='failed') then
    raise exception 'FAIL: reservation did not expire stale work first'; end if;
  perform public.fail_caption_generation(r.id);
  for n in 1..(20-(select count(*)::integer from public.caption_generations g where g.status='failed'
      and g.created_at >= ((now() at time zone 'America/New_York')::date::timestamp at time zone 'America/New_York')
      and g.created_at < (((now() at time zone 'America/New_York')::date+1)::timestamp at time zone 'America/New_York'))) loop
    select * into r from public.reserve_caption_generation_v5(
      ('69000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'earth','Quota context','dry','System','deepseek-flash');
    perform public.fail_caption_generation(r.id);
  end loop;
  begin
    perform public.reserve_caption_generation_v5(gen_random_uuid(),'earth','Quota context','dry','System','deepseek-flash');
    raise exception 'FAIL: separate failure cost cap did not reject new work';
  exception when raise_exception then if sqlerrm<>'GENERATION_ATTEMPT_LIMIT_REACHED' then raise; end if; end;
end $$;
reset role;
do $$
begin
  if not exists(select 1 from storage.buckets where id='caption-uploads' and not public) then
    raise exception 'FAIL: caption upload bucket became public'; end if;
  if (select content from public.captions where id='65000000-0000-4000-8000-000000000001')
      <>'one two three four five six seven eight nine ten eleven twelve' then
    raise exception 'FAIL: existing captions were changed'; end if;
  raise notice 'PASS: public gallery/media isolation, caller-specific votes, author keys, ten-word captions, refundable quota and failure cap.';
end $$;
rollback;
