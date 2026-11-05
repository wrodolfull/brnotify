-- BR Notify report indexes (run AFTER 003_public_integrations.sql).
-- Índices B-tree otimizados para filtro por tenant e período, sem novos privilégios públicos.
create index if not exists report_messages_tenant_date_idx
  on public.scheduled_messages(tenant_id,scheduled_at desc,id);
create index if not exists report_events_tenant_date_idx
  on public.events(tenant_id,starts_at desc,id);
create index if not exists report_confirmations_tenant_date_idx
  on public.events(tenant_id,confirmation_received_at desc)
  where confirmation_received_at is not null;
create index if not exists report_imports_tenant_date_idx
  on public.import_jobs(tenant_id,created_at desc);
