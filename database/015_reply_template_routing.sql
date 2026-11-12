-- Restrict inbound automations to unambiguously sent WhatsApp templates.
-- Apply after database/014_contact_lifecycle.sql, before deploying backend and worker.
alter table public.automation_flows add column if not exists source_template_id uuid
 references public.message_templates(id) on delete set null;
create index if not exists on_demand_reply_origin_idx
 on public.on_demand_messages(tenant_id,recipient_phone,sent_at desc)
 where provider_message_id is not null and sent_at is not null;
create index if not exists scheduled_reply_origin_idx
 on public.scheduled_messages(tenant_id,sent_at desc)
 where goto_message_id is not null and sent_at is not null;
