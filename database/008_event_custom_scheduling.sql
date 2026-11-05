-- 008_event_custom_scheduling.sql
-- Existing events remain in automation mode. No queued messages are deleted.
alter table public.events
 add column if not exists delivery_mode text not null default 'automation';
alter table public.events
 add column if not exists custom_send_at timestamptz;
alter table public.events
 add column if not exists custom_template_id uuid references public.message_templates(id) on delete set null;

alter table public.events drop constraint if exists events_delivery_mode_check;
alter table public.events add constraint events_delivery_mode_check
 check(delivery_mode in ('automation','custom'));

create index if not exists events_custom_dispatch_idx
 on public.events(tenant_id,custom_send_at) where delivery_mode='custom';
