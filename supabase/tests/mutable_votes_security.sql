-- Local test/staging only. Every fixture rolls back.
begin;
insert into auth.users(id,email) values ('91000000-0000-4000-8000-000000000001','vote-owner@example.invalid'),('91000000-0000-4000-8000-000000000002','vote-other@example.invalid');
insert into public.profiles(id,first_name) values ('91000000-0000-4000-8000-000000000001','Owner'),('91000000-0000-4000-8000-000000000002','Other');
insert into public.caption_generations(id,user_id,image_id,prompt,system_prompt,style,model,request_id,status,completed_at) values
 ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','udp','Private prompt','Private instructions','dry','deepseek-flash',gen_random_uuid(),'succeeded',now());
insert into public.captions(id,generation_id,content,position) values
 ('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','My deadline has left the chat.',1),
 ('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','My homework is enjoying its gap year.',2);
set local role anon;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"anon"}',true);
do $$begin
 begin perform public.set_caption_vote_v7('93000000-0000-4000-8000-000000000001',1);raise exception 'FAIL anonymous vote';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$declare first jsonb; switched jsonb; repeated jsonb; undone jsonb;
begin
 first:=public.set_caption_vote_v7('93000000-0000-4000-8000-000000000001',1);
 if first->>'value'<>'1' or first->>'laughs'<>'1' or first->>'groans'<>'0' or first->>'created_at' is null then raise exception 'FAIL initial vote/counts';end if;
 switched:=public.set_caption_vote_v7('93000000-0000-4000-8000-000000000001',-1);
 if switched->>'value'<>'-1' or switched->>'laughs'<>'0' or switched->>'groans'<>'1' or switched->>'created_at'<>first->>'created_at' then raise exception 'FAIL change vote/counts/original timestamp';end if;
 repeated:=public.set_caption_vote_v7('93000000-0000-4000-8000-000000000001',-1);
 if repeated->>'updated_at'<>switched->>'updated_at' then raise exception 'FAIL repeat vote modified timestamp';end if;
 if (select count(*) from public.caption_votes)<>1 then raise exception 'FAIL duplicate rating';end if;
 undone:=public.set_caption_vote_v7('93000000-0000-4000-8000-000000000001',0);
 if undone->>'value'<>'0' or undone->>'groans'<>'0' or undone->>'created_at' is not null or (select count(*) from public.caption_votes)<>0 then raise exception 'FAIL undo';end if;
 perform public.set_caption_vote_v7('93000000-0000-4000-8000-000000000001',0);
 begin perform public.set_caption_vote_v7('93000000-0000-4000-8000-000000000001',null);raise exception 'FAIL null value';exception when invalid_parameter_value then null;end;
 begin perform public.set_caption_vote_v7('93000000-0000-4000-8000-000000000001',2);raise exception 'FAIL invalid value';exception when invalid_parameter_value then null;end;
 -- Previous deployed client can still insert once, with server-owned timestamps.
 insert into public.caption_votes(caption_id,user_id,value) values('93000000-0000-4000-8000-000000000002',auth.uid(),1);
 begin insert into public.caption_votes(caption_id,user_id,value,updated_at) values('93000000-0000-4000-8000-000000000001',auth.uid(),1,'2000-01-01');raise exception 'FAIL forged timestamp';exception when insufficient_privilege then null;end;
 begin update public.caption_votes set value=-1;raise exception 'FAIL direct update';exception when insufficient_privilege then null;end;
 begin delete from public.caption_votes;raise exception 'FAIL direct delete';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
do $$declare rating jsonb;
begin
 if (select count(*) from public.caption_votes)<>0 then raise exception 'FAIL other owner votes exposed';end if;
 rating:=public.set_caption_vote_v7('93000000-0000-4000-8000-000000000002',-1);
 if rating->>'laughs'<>'1' or rating->>'groans'<>'1' then raise exception 'FAIL aggregate counts hide other rating';end if;
 perform public.set_caption_vote_v7('93000000-0000-4000-8000-000000000002',0);
end $$;
reset role;
update public.captions set deleted_at=now(),deletion_reason='Test moderation' where id='93000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$begin
 begin perform public.set_caption_vote_v7('93000000-0000-4000-8000-000000000002',1);raise exception 'FAIL hidden caption rated';exception when no_data_found then null;end;
 begin insert into public.caption_votes(caption_id,user_id,value) values('93000000-0000-4000-8000-000000000002',auth.uid(),1);raise exception 'FAIL legacy insert hidden';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin if (select count(*) from public.caption_votes where user_id='91000000-0000-4000-8000-000000000001')<>1 then raise exception 'FAIL undo deleted another user rating';end if;end $$;
rollback;
