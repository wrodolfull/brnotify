-- Execução após 001_init.sql: recalcular agendamentos quando as regras mudam
create table if not exists rule_rebuild_queue (
 tenant_id uuid primary key references tenants(id) on delete cascade,
 last_event_id uuid,
 updated_at timestamptz not null default now()
);
alter table rule_rebuild_queue enable row level security;
revoke all on rule_rebuild_queue from anon,authenticated;
