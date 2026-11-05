# Diagnóstico de WhatsApp: destinatários e fila de lembretes

## O que o código valida
- GoTo WhatsApp: `from` é o ID numérico do remetente Meta; `to` é número do contato em E.164 (`+5519999999999`) — conforme documentação GoTo Messaging v2.
- Contatos BR com DDD de 10/11 dígitos são convertidos para `+55`. Um número já internacional com `+` mantém o DDI informado. Número sem `+` e sem padrão BR é rejeitado como ambíguo.
- Não acrescentamos automaticamente nono dígito nem alteramos telefones já existentes no banco: discrepâncias exigem conferência e correção do contato.
- A validação também é aplicada na geração do payload de disparo, inclusive para registros antigos.
- Mensagens inválidas são marcadas `failed`, com `error_description`, e não chegam à GoTo.

## Diagnóstico de uma tentativa real

No SQL Editor do Supabase, no projeto correto, execute **somente SELECT**:

```sql
select t.name as ambiente, e.title as compromisso, c.name as contato, c.phone as telefone,
       m.status, m.scheduled_at, m.next_attempt_at, m.attempt_count,
       m.goto_message_id, m.sent_at, m.error_code, m.error_description
from scheduled_messages m
join events e on e.id=m.event_id and e.tenant_id=m.tenant_id
join contacts c on c.id=e.contact_id and c.tenant_id=m.tenant_id
join tenants t on t.id=m.tenant_id
order by m.updated_at desc
limit 20;
```

- `sent` + `goto_message_id`: a GoTo **aceitou** a requisição, mas a entrega não está garantida.
- `failed`: verificar `error_code` e `error_description`. Se foi rejeição imediata HTTP, esses campos refletem a API.
- `delivered`: webhook GoTo confirmou a entrega.
- `unknown`: resultado indeterminado; **não reenviar** sem conciliar com a GoTo.
- Nenhuma linha: regras não geraram lembrete; verificar horário, antecedência, consentimento e se regras estão ativas.

A GoTo envia falhas posteriores à aceitação via evento `DELIVERY_STATUS`. O campo **Notification Channel ID** e uma assinatura válida são necessários para o BR Notify receber esse retorno; sem webhook o painel pode exibir `sent` enquanto o GoTo Connect mostra uma entrega falha.

Em cada envio, o worker agora imprime `goto_accepted` ou `goto_result` com IDs internos e status, sem mostrar número, nome ou segredo.

## Novo comportamento ao criar evento

`POST /api/events` retorna `reminders_scheduled`, calculado com base nas mensagens **realmente programadas**. A web não informa mais que houve programação quando não existe mensagem na fila. Se a regra calculou horários passados, evento poderá ser criado normalmente, mas a interface alertará que nenhum lembrete foi programado.

## Referência
- [GoTo Messaging API v2: WhatsApp template and E.164](https://developer.goto.com/guides/GoToConnect/18_HOW_useMessagingV2Api/)
