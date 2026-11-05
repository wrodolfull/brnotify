-- 006_safe_message_dispatch.sql
-- Execute depois de 001 a 005. Preserva scheduled_at como data ORIGINAL do lembrete.
alter table public.scheduled_messages
 add column if not exists next_attempt_at timestamptz;
update public.scheduled_messages
 set next_attempt_at=scheduled_at where next_attempt_at is null;
alter table public.scheduled_messages
 alter column next_attempt_at set default now();
alter table public.scheduled_messages
 alter column next_attempt_at set not null;

create index if not exists messages_due_retry_idx
 on public.scheduled_messages(next_attempt_at,scheduled_at,id)
 where status='scheduled';

-- Cadência consistente entre múltiplos processos/instâncias do worker.
-- Uma reserva global reduz a soma dos disparos de todos os ambientes;
-- uma reserva por tenant define a distribuição aleatória individual.
create table if not exists public.goto_send_pacing(
 scope text primary key,
 next_allowed_at timestamptz not null default '-infinity'::timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.goto_send_pacing enable row level security;
revoke all on table public.goto_send_pacing from public,anon,authenticated;
