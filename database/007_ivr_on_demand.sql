-- 007_ivr_on_demand.sql
-- Execute depois de 001 a 006: fila independente dos agendamentos.
create table if not exists public.on_demand_messages (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 api_key_id uuid references public.integration_api_keys(id) on delete set null,
 contact_id uuid references public.contacts(id) on delete set null,
 template_id uuid references public.message_templates(id) on delete set null,
 media_asset_id uuid references public.goto_media_assets(id) on delete set null,
 recipient_phone text not null,
 recipient_name varchar(180) not null default 'Cliente',
 variables jsonb not null default '{}'::jsonb,
 consent_source varchar(80) not null,
 dedupe_hash char(64) not null,
 status text not null default 'queued'
  check(status in ('queued','processing','sent','delivered','failed','unknown','cancelled')),
 next_attempt_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '30 minutes'),
 attempt_count integer not null default 0,
 locked_at timestamptz,
 provider_message_id text,
 error_code text,
 error_description text,
 sent_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists on_demand_claim_idx on public.on_demand_messages(next_attempt_at,created_at,id) where status='queued';
create index if not exists on_demand_dedupe_idx on public.on_demand_messages(tenant_id,dedupe_hash,created_at desc);
create index if not exists on_demand_status_idx on public.on_demand_messages(tenant_id,created_at desc);
create index if not exists on_demand_provider_idx on public.on_demand_messages(tenant_id,provider_message_id) where provider_message_id is not null;
create index if not exists on_demand_phone_idx on public.on_demand_messages(tenant_id,recipient_phone,created_at desc);
alter table public.on_demand_messages enable row level security;
revoke all on table public.on_demand_messages from public,anon,authenticated;
