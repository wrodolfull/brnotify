-- BR Notify etapa 0 / migração 010: mensagens avulsas, sem compromisso fictício.
-- Executar após 008_event_custom_scheduling.sql, antes de publicar API e worker.
alter table public.on_demand_messages
  add column if not exists source text not null default 'ivr',
  add column if not exists scheduled_for timestamptz not null default now();
alter table public.on_demand_messages drop constraint if exists on_demand_messages_source_check;
alter table public.on_demand_messages add constraint on_demand_messages_source_check
  check(source in ('ivr','panel'));
create index if not exists on_demand_panel_history_idx
  on public.on_demand_messages(tenant_id,scheduled_for desc,id desc);
-- Nenhuma fila existente é excluída ou reprogramada. O fluxo da URA permanece 'ivr'.
