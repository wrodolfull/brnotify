# Eventos com disparos automáticos ou personalizados

## Fluxos
- **Regras de Automações:** a data e a hora representam o compromisso. O BR Notify calcula as notificações anteriores ao compromisso conforme os slots de Automações e somente com templates GoTo aprovados.
- **Escolher data e hora do envio:** registra o compromisso e programa **uma** mensagem para data/hora exatas, com template aprovado selecionado no evento. A regra do ambiente não altera esse envio.
- A data/hora do envio personalizado precisa estar **ao menos 30 segundos no futuro e antes do compromisso**. Para testes, escolha uma margem de alguns minutos.
- A tela **Eventos → Novo evento** mostra a **Prévia dos disparos** usando o cálculo do servidor, inclusive quando nenhuma mensagem pode ser programada.
- Em **Eventos → Detalhes**, o status do compromisso e o status das mensagens são exibidos separadamente. Em **Disparos** também há histórico completo.

## Requisitos para enviar
- Contato cadastrado com consentimento registrado e sem opt-out.
- Ambiente ativo e integração GoTo com Account Key e ID do número WhatsApp.
- Template aprovado disponível neste ambiente, com parâmetros mapeados.
- Worker de disparos em execução (`npm run dev:worker`) e eventuais mensagens programadas no futuro.
- Se a GoTo aceitar, o status inicial é **Enviado**, mas **Entregue** requer webhook DELIVERY_STATUS válido. Falhas/indeterminados não são reenviados sem a política de segurança já existente.

## Migração
Antes de usar os novos campos, execute no SQL Editor Supabase, **uma única vez**, depois das migrações 001-007:

`database/008_event_custom_scheduling.sql`

A migração adiciona o modo padrão `automation` para eventos existentes e os campos opcionais `custom_send_at` e `custom_template_id`. Não atualiza nem dispara mensagens existentes.

## API
- `POST /api/events/preview`: calcula sem gravar. Exemplo:
```json
{"contact_id":"<UUID>","starts_at":"2026-11-20T10:00","delivery_mode":"custom","custom_send_at":"2026-11-19T14:00","custom_template_id":"<TEMPLATE_UUID>"}
```
- `POST /api/events`: mesmos campos mais `title` e demais dados do evento. Retorna `reminders_scheduled` e `dispatch_preview`.
- `GET /api/events/:id/notifications`: lista os estados reais (agendado, processando, enviado, entregue, falhou, cancelado, indeterminado) das mensagens do evento.
- `GET /api/templates/options`: modelos aprovados para o seletor do envio personalizado.
- `PATCH /api/events/:id`: alterações de horário/modo reprogramam a fila com uma nova revisão sem reenviar mensagens antigas.

**Importante:** `starts_at` é a hora do compromisso; `custom_send_at` é a hora do envio no fuso do ambiente. Não envie um campo como se fosse o outro.
