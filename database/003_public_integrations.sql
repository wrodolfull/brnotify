-- 003_public_integrations.sql
-- Execute APÓS 001_init.sql e 002_rebuild_queue.sql, sem reexecutar migrations anteriores.
-- Nenhuma função Supabase Edge é usada: triggers servem somente para enfileirar notificações.

create table if not exists integration_api_keys (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references tenants(id) on delete cascade,
 label varchar(80) not null,
 token_prefix varchar(30) not null,
 token_hash char(64) not null unique,
 scopes text[] not null,
 expires_at timestamptz not null,
 last_used_at timestamptz,
 revoked_at timestamptz,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 constraint api_key_scopes_check check (array_length(scopes, 1) between 1 and 8)
);
create index if not exists integration_keys_tenant_idx on integration_api_keys(tenant_id, created_at desc);

create table if not exists integration_api_logs (
 id bigserial primary key,
 tenant_id uuid not null references tenants(id) on delete cascade,
 api_key_id uuid references integration_api_keys(id) on delete set null,
 request_id uuid not null,
 method varchar(8) not null,
 route varchar(120) not null,
 status_code integer not null,
 duration_ms integer not null,
 created_at timestamptz not null default now()
);
create index if not exists integration_api_logs_tenant_idx on integration_api_logs(tenant_id, created_at desc);

alter table contacts add column if not exists external_id varchar(120);
create unique index if not exists contacts_tenant_external_idx
 on contacts(tenant_id, external_id) where external_id is not null;
alter table records add column if not exists external_id varchar(120);
create unique index if not exists records_tenant_external_idx
 on records(tenant_id, contact_id, external_id) where external_id is not null;

alter table events add column if not exists external_id varchar(120);
create unique index if not exists events_tenant_external_idx
 on events(tenant_id, external_id) where external_id is not null;
alter table events add column if not exists schedule_revision integer not null default 1;
alter table events add column if not exists confirmation_enabled boolean not null default false;
alter table events add column if not exists confirmation_status text not null default 'not_requested';
alter table events add column if not exists confirmation_received_at timestamptz;
alter table events add constraint events_confirmation_status_check
 check (confirmation_status in ('not_requested','pending','confirmed','reschedule_requested','declined'));

alter table scheduled_messages add column if not exists schedule_revision integer not null default 1;
alter table scheduled_messages drop constraint if exists scheduled_messages_event_id_slot_key;
create unique index if not exists message_revision_unique_idx
 on scheduled_messages(event_id, slot, schedule_revision);

create table if not exists outbound_webhook_endpoints (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references tenants(id) on delete cascade,
 label varchar(80) not null,
 destination_url text not null,
 signing_secret_enc text not null,
 event_types text[] not null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint endpoint_event_types_check check (array_length(event_types,1) between 1 and 8)
);
create index if not exists webhook_endpoints_tenant_idx on outbound_webhook_endpoints(tenant_id, created_at desc);

create table if not exists outbound_webhook_deliveries (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references tenants(id) on delete cascade,
 endpoint_id uuid not null references outbound_webhook_endpoints(id) on delete cascade,
 event_id uuid not null,
 event_type varchar(70) not null,
 payload jsonb not null,
 status varchar(20) not null default 'queued'
  check (status in ('queued','processing','delivered','dead')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 locked_at timestamptz,
 delivered_at timestamptz,
 last_status_code integer,
 last_error text,
 created_at timestamptz not null default now(),
 unique (endpoint_id, event_id)
);
create index if not exists outbound_webhooks_due_idx
 on outbound_webhook_deliveries(next_attempt_at, id) where status='queued';
create index if not exists outbound_webhooks_tenant_idx
 on outbound_webhook_deliveries(tenant_id, created_at desc);

alter table webhook_events add column if not exists processed_at timestamptz;
update webhook_events set processed_at=received_at where processed_at is null;

create table if not exists inbound_interactions (
 id bigserial primary key,
 tenant_id uuid not null references tenants(id) on delete cascade,
 provider_event_id text not null unique,
 contact_id uuid references contacts(id) on delete set null,
 event_id uuid references events(id) on delete set null,
 decision varchar(40) not null,
 resolution varchar(30) not null,
 received_at timestamptz not null default now()
);
create index if not exists inbound_interactions_tenant_idx on inbound_interactions(tenant_id, received_at desc);

-- Enfileiramento transacional: se o status foi persistido, o evento de integração também foi.
create or replace function public.brnotify_queue_hook(
 p_tenant uuid, p_type text, p_data jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare new_event_id uuid := gen_random_uuid();
declare envelope jsonb;
begin
 envelope := jsonb_build_object(
  'id', new_event_id,
  'type', p_type,
  'timestamp', to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'data', p_data
 );
 insert into public.outbound_webhook_deliveries(
  tenant_id, endpoint_id, event_id, event_type, payload
 )
 select p_tenant, ep.id, new_event_id, p_type, envelope
 from public.outbound_webhook_endpoints ep
 where ep.tenant_id=p_tenant and ep.active
   and p_type=any(ep.event_types);
end;
$$;

create or replace function public.brnotify_message_transition()
returns trigger language plpgsql security definer set search_path=public as $$
declare ev_external_id text;
begin
 if old.status is not distinct from new.status then return new; end if;
 if new.status not in ('sent','delivered','failed') then return new; end if;
 select e.external_id into ev_external_id from events e
 where e.id=new.event_id and e.tenant_id=new.tenant_id;
 perform public.brnotify_queue_hook(
  new.tenant_id,
  case new.status when 'sent' then 'reminder.sent' when 'delivered' then 'reminder.delivered' else 'reminder.failed' end,
  jsonb_build_object(
   'message_id', new.id,
   'event_id', new.event_id,
   'external_id', ev_external_id,
   'status', new.status,
   'scheduled_at', new.scheduled_at,
   'sent_at', new.sent_at,
   'provider_message_id', new.goto_message_id,
   'error_code', new.error_code
  )
 );
 return new;
end;
$$;
drop trigger if exists brnotify_message_updated on scheduled_messages;
create trigger brnotify_message_updated
after update of status on scheduled_messages
for each row execute function public.brnotify_message_transition();

create or replace function public.brnotify_event_transition()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.confirmation_status is distinct from new.confirmation_status
  and new.confirmation_status in ('confirmed','reschedule_requested','declined') then
  perform public.brnotify_queue_hook(
   new.tenant_id, 'appointment.'||new.confirmation_status,
   jsonb_build_object(
    'event_id',new.id,'external_id',new.external_id,
    'status',new.confirmation_status,'received_at',new.confirmation_received_at
   )
  );
 end if;
 if old.status is distinct from new.status and new.status='cancelled' then
  perform public.brnotify_queue_hook(
   new.tenant_id,'event.cancelled',
   jsonb_build_object('event_id',new.id,'external_id',new.external_id,'status',new.status)
  );
 end if;
 return new;
end;
$$;
drop trigger if exists brnotify_event_updated on events;
create trigger brnotify_event_updated
after update of confirmation_status,status on events
for each row execute function public.brnotify_event_transition();

do $$
declare t text;
begin
 foreach t in array array[
  'integration_api_keys','integration_api_logs','outbound_webhook_endpoints',
  'outbound_webhook_deliveries','inbound_interactions'
 ] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon,authenticated',t);
 end loop;
end $$;
