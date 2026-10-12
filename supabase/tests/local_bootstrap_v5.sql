-- Local Postgres tests only: extend the minimal A4 Storage stubs to match Supabase.
alter table storage.buckets add column name text, add column file_size_limit bigint,
  add column allowed_mime_types text[];
update storage.buckets set name=id;
alter table storage.objects add column created_at timestamptz not null default now();
create unique index local_storage_bucket_name on storage.objects(bucket_id,name);
