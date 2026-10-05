-- LOCAL TEST DATABASE ONLY. Supabase already owns these roles and schemas.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table public.messages (id bigint primary key, content text);
create table public.profiles (
  id uuid primary key references auth.users(id), first_name text, last_name text,
  avatar_url text, created_at timestamptz default now()
);
create table public.votes (
  user_id uuid references auth.users(id), message_id bigint references public.messages(id),
  value smallint check (value in (-1,1)), created_at timestamptz default now(),
  primary key (user_id,message_id)
);
create policy old_messages_public on public.messages for select using (true);
create policy old_profiles_public on public.profiles for select using (true);
create policy old_votes_public on public.votes for select using (true);
grant all on all tables in schema public to anon, authenticated;
create table storage.buckets (id text primary key, public boolean);
insert into storage.buckets values ('avatars', true);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/');
$$;
create policy old_avatar_public on storage.objects for select using (bucket_id = 'avatars');
