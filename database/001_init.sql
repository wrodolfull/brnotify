-- BR Notify: execute no SQL Editor do Supabase, em projeto exclusivo.
create extension if not exists pgcrypto;

create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  segment text not null check(segment in ('automotive','clinic','pet','custom')),
  timezone text not null default 'America/Sao_Paulo',
  status text not null default 'active' check(status in ('active','paused','suspended')),
  created_at timestamptz not null default now()
);
create table if not exists tenant_members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null check(role in ('admin','viewer')),
  created_at timestamptz not null default now(),
  primary key(tenant_id, user_id)
);
create index if not exists tenant_members_user_idx on tenant_members(user_id);
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  phone text not null,
  email text,
  consent boolean not null default false,
  consent_source text,
  consent_at timestamptz,
  opted_out_at timestamptz,
  custom_data jsonb not null default '{}'::jsonb,
  reminder_overrides jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, phone)
);
create index if not exists contacts_tenant_idx on contacts(tenant_id, created_at desc);
create table if not exists records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  label text not null,
  kind text not null default 'generic',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists records_contact_idx on records(tenant_id,contact_id);
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  record_id uuid references records(id) on delete set null,
  title text not null,
  event_type text not null default 'reminder',
  import_key text,
  starts_at timestamptz not null,
  status text not null default 'scheduled' check(status in ('scheduled','cancelled','completed')),
  details jsonb not null default '{}'::jsonb,
  reminder_overrides jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists events_tenant_start_idx on events(tenant_id,starts_at desc);
create unique index if not exists events_tenant_import_key_idx on events(tenant_id,import_key) where import_key is not null;
create table if not exists reminder_rules (
  tenant_id uuid not null references tenants(id) on delete cascade,
  slot integer not null check(slot between 1 and 3),
  enabled boolean not null default true,
  offset_value integer not null check(offset_value between 1 and 365),
  offset_unit text not null check(offset_unit in ('days','weeks','months')),
  send_time time not null default '09:00:00',
  template_id uuid,
  primary key (tenant_id,slot)
);
create table if not exists goto_connections (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text not null,
  expires_at timestamptz not null,
  principal text,
  account_key text,
  from_touchpoint text,
  updated_at timestamptz not null default now()
);
create unique index if not exists goto_account_key_idx on goto_connections(account_key) where account_key is not null;
create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  language_code text not null,
  status text not null,
  category text,
  definition jsonb not null,
  variable_map jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(tenant_id,name,language_code)
);
alter table reminder_rules add constraint reminder_rules_template_fk foreign key(template_id) references message_templates(id) on delete set null;
create table if not exists scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  slot integer not null check(slot between 1 and 3),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check(status in ('scheduled','processing','sent','delivered','failed','cancelled','unknown')),
  template_id uuid references message_templates(id) on delete set null,
  goto_message_id text,
  attempt_count integer not null default 0,
  locked_at timestamptz,
  error_code text,
  error_description text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(event_id,slot)
);
create index if not exists messages_due_idx on scheduled_messages(scheduled_at,id) where status='scheduled';
create index if not exists messages_tenant_status_idx on scheduled_messages(tenant_id,status,scheduled_at desc);
create index if not exists messages_goto_idx on scheduled_messages(goto_message_id) where goto_message_id is not null;
create table if not exists message_attempts (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  message_id uuid not null references scheduled_messages(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  outcome text not null,
  error_detail text,
  provider_status integer
);
create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  file_name text not null,
  imported integer not null default 0,
  rejected integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists oauth_states (
  state_hash text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists webhook_events (
  event_id text primary key,
  tenant_id uuid references tenants(id) on delete set null,
  received_at timestamptz not null default now(),
  payload jsonb not null
);
create table if not exists audit_logs (
  id bigserial primary key,
  tenant_id uuid references tenants(id) on delete set null,
  user_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_tenant_idx on audit_logs(tenant_id,created_at desc);

-- A aplicação não usa REST do Supabase para acessar dados.
-- RLS sem policies: anon/authenticated não conseguem ler/escrever via API de dados.
do $$
declare t text;
begin
  foreach t in array array['platform_admins','tenants','tenant_members','contacts','records','events','reminder_rules','goto_connections','message_templates','scheduled_messages','message_attempts','import_jobs','oauth_states','webhook_events','audit_logs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon,authenticated',t);
  end loop;
end $$;
