-- BR Notify etapa 2: automações baseadas no log normalizado de eventos.
-- Execute após 011_goto_event_foundation.sql.
create table if not exists public.automation_flows (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 title varchar(120) not null,
 status text not null default 'draft' check(status in ('draft','active','paused')),
 trigger_type text not null check(trigger_type in
   ('message.received','message.delivery.updated','call.ended','call.report.ready')),
 match_mode text not null default 'any' check(match_mode in ('any','equals','contains')),
 match_text varchar(200),
 delay_minutes integer not null default 0 check(delay_minutes between 0 and 10080),
 check_no_new_message boolean not null default false,
 action_type text not null check(action_type in ('internal','webhook','whatsapp')),
 action_label varchar(180) not null default 'Ação automática',
 last_error varchar(250),
 endpoint_id uuid references public.outbound_webhook_endpoints(id) on delete set null,
 template_id uuid references public.message_templates(id) on delete set null,
 template_variables jsonb not null default '{}'::jsonb,
 revision integer not null default 1,
 cursor_received_at timestamptz not null default now(),
 cursor_event_id uuid not null default '00000000-0000-0000-0000-000000000000'::uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists automation_flows_active_idx
 on public.automation_flows(status,tenant_id) where status='active';

create table if not exists public.automation_runs (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 flow_id uuid not null references public.automation_flows(id) on delete cascade,
 event_id uuid not null references public.integration_events(id) on delete cascade,
 revision integer not null,
 status text not null default 'pending'
  check(status in ('pending','processing','completed','skipped','failed','unknown','cancelled')),
 due_at timestamptz not null,
 context jsonb not null default '{}'::jsonb,
 result jsonb not null default '{}'::jsonb,
 reason varchar(250),
 started_at timestamptz,
 finished_at timestamptz,
 created_at timestamptz not null default now(),
 unique(flow_id,event_id)
);
create index if not exists automation_runs_due_idx on public.automation_runs(due_at,id)
 where status='pending';
create index if not exists automation_runs_history_idx on public.automation_runs(tenant_id,created_at desc,id desc);

alter table public.on_demand_messages add column if not exists automation_run_id uuid
 references public.automation_runs(id) on delete set null;
alter table public.on_demand_messages drop constraint if exists on_demand_messages_source_check;
alter table public.on_demand_messages add constraint on_demand_messages_source_check
 check(source in ('ivr','panel','automation'));
create unique index if not exists automation_message_unique_idx
 on public.on_demand_messages(automation_run_id) where automation_run_id is not null;

alter table public.automation_flows enable row level security;
alter table public.automation_runs enable row level security;
revoke all on table public.automation_flows,public.automation_runs from public,anon,authenticated;
