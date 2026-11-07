-- Etapa 1: camada de eventos da GoTo, isolada dos compromissos existentes.
-- Rodar depois de database/010_panel_notifications.sql.
alter table public.oauth_states add column if not exists request_call_scopes boolean not null default false;
alter table public.goto_connections add column if not exists call_scopes_granted boolean not null default false;
create table if not exists public.goto_call_monitors (
 tenant_id uuid primary key references public.tenants(id) on delete cascade,
 webhook_secret_hash char(64) not null,
 channel_id text,
 state_subscribed boolean not null default false,
 report_subscription_id text,
 enabled boolean not null default false,
 last_error text,
 updated_at timestamptz not null default now()
);

create table if not exists public.integration_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 provider text not null default 'goto',
 source text not null,
 external_key text not null,
 event_type text not null,
 conversation_space_id text,
 occurred_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb,
 received_at timestamptz not null default now(),
 unique(tenant_id,provider,source,external_key)
);
create index if not exists integration_events_tenant_at_idx
 on public.integration_events(tenant_id,occurred_at desc,id desc);
create index if not exists integration_events_conversation_idx
 on public.integration_events(tenant_id,conversation_space_id,occurred_at desc)
 where conversation_space_id is not null;

create table if not exists public.goto_call_conversations (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 conversation_space_id text not null,
 direction text,
 last_state text not null default 'unknown',
 last_sequence integer not null default 0,
 sequence_gap boolean not null default false,
 started_at timestamptz,
 ended_at timestamptz,
 report_status text not null default 'none'
  check(report_status in ('none','pending','processing','retry','complete','failed')),
 report_attempts integer not null default 0,
 report_due_at timestamptz,
 report_locked_at timestamptz,
 report_last_error text,
 summary jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(tenant_id,conversation_space_id)
);
create index if not exists goto_call_report_due_idx
 on public.goto_call_conversations(report_due_at,id)
 where report_status in ('pending','retry');

-- Somente o backend de confiança usa estas tabelas. Sem acesso via browser/Supabase Data API.
alter table public.goto_call_monitors enable row level security;
alter table public.integration_events enable row level security;
alter table public.goto_call_conversations enable row level security;
revoke all on table public.goto_call_monitors,public.integration_events,public.goto_call_conversations
 from public,anon,authenticated;
