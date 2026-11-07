-- Etapa 3: sinais de IA, correio de voz e revisões de relatórios GoTo.
-- Aplicar depois de database/012_automation_engine.sql.
alter table public.goto_call_monitors
 add column if not exists report_revision_subscription_id text;

alter table public.goto_call_conversations
 add column if not exists intelligence_checked_at timestamptz,
 add column if not exists intelligence_signal_count integer not null default 0,
 add column if not exists attention_level text not null default 'unclassified'
 check (attention_level in ('unclassified','review','evidence_of_answer'));

alter table public.automation_flows
 drop constraint if exists automation_flows_trigger_type_check;
alter table public.automation_flows
 add constraint automation_flows_trigger_type_check check (trigger_type in (
 'message.received','message.delivery.updated','call.ended','call.report.ready',
 'call.ai.insight.detected','call.voicemail.new','call.voicemail.read',
 'call.voicemail.deleted','call.receptionist.scheduling_issue'
 ));
create index if not exists integration_events_intelligence_idx
 on public.integration_events(tenant_id,occurred_at desc,id desc)
 where event_type in ('call.ai.insight.detected','call.voicemail.new',
 'call.voicemail.read','call.voicemail.deleted','call.receptionist.scheduling_issue');

-- Use apenas os metadados mínimos dos sinais no log de eventos; nunca grave a
-- transcrição, gravação ou relatório completo na base do BR Notify.
