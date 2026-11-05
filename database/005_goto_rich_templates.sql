-- 005_goto_rich_templates.sql
-- Run after 001...004. Media is stored in a private Supabase Storage bucket;
-- only metadata is stored in PostgreSQL.
create table if not exists goto_media_assets (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references tenants(id) on delete cascade,
 label varchar(120) not null,
 original_name varchar(180) not null,
 storage_path text not null unique,
 content_type varchar(80) not null
   check(content_type in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf')),
 size_bytes bigint not null check(size_bytes > 0 and size_bytes <= 16777216),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists goto_media_assets_tenant_idx on goto_media_assets(tenant_id,created_at desc);

alter table goto_media_assets enable row level security;
revoke all on table public.goto_media_assets from anon,authenticated;

-- Supabase has storage.buckets; plain PostgreSQL CI deliberately does not.
-- Private bucket with a 16 MiB cap. No public storage policies are granted.
do $$
begin
 if to_regclass('storage.buckets') is not null then
  execute $sql$
   insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values(
    'brnotify-goto-media','brnotify-goto-media',false,16777216,
    array['image/jpeg','image/png','image/webp','video/mp4','application/pdf']::text[]
   )
   on conflict(id) do update set public=false,file_size_limit=16777216,
     allowed_mime_types=excluded.allowed_mime_types
  $sql$;
 end if;
end $$;
