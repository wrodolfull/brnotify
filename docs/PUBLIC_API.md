# BR Notify — API pública v1 e integração com CRMs/ERPs

Esta API foi criada para integrações **servidor a servidor**. Os endpoints usam autenticação por chave de API, não por login de usuário ou Supabase Edge Functions.

## Início rápido

1. Crie o ambiente no painel do Super Admin e conecte o GoTo no ambiente.
2. Acesse **API e Integrações → Chaves de API** como Administrador.
3. Crie uma chave com \`contacts:write\` e \`events:write\`. Guarde o token apresentado **uma única vez**.
4. Faça requisições para \`https://SEU_DOMINIO/v1/\` com \`Authorization: Bearer brn_live_...\`.
5. Documentação estruturada em \`GET /v1/openapi.json\` (pública, sem tokens). Importável no Postman ou Swagger UI.

Cada chave está vinculada a um único ambiente. Não envie \`tenant_id\` no body ou no header: o backend determina o ambiente por assinatura da chave.

### Endpoint principal: cadastrar tudo em uma chamada

\`\`\`http
POST /v1/reminders
Authorization: Bearer <SUA_CHAVE>
Content-Type: application/json
\`\`\`

\`\`\`json
{
  "external_id": "REV-2026-1045",
  "contact": {
    "external_id": "CLIENTE-102",
    "name": "Carlos Silva",
    "phone": "+5519999999999",
    "consent": true,
    "consent_source": "Termo assinado na concessionária"
  },
  "record": {
    "type": "vehicle",
    "external_id": "VEICULO-ABC1D23",
    "label": "Corolla ABC1D23",
    "model": "Corolla",
    "plate": "ABC1D23"
  },
  "event": {
    "title": "Revisão",
    "type": "revisao",
    "date": "2026-12-15",
    "time": "09:00",
    "confirmation_enabled": true
  },
  "reminders": [
    {"before": 30, "unit": "days"},
    {"before": 3, "unit": "days"},
    {"before": 1, "unit": "days"}
  ]
}
\`\`\`

**Respostas:** HTTP 201 para evento novo; HTTP 200 para evento já identificado e atualizado. O retorno inclui \`event_id\`, \`external_id\`, \`schedule_revision\` e \`confirmation_status\`.

**Idempotência:** \`external_id\` é único dentro de cada ambiente. Reenviar o mesmo payload não gera outro evento. Se a data mudar, o evento ganha nova revisão de agendamento, cancela os jobs pendentes da revisão anterior e programa os novos. O histórico de mensagens já enviadas continua preservado.

### Operações

| Escopo | Método | Endpoint | Ação |
|---|---|---|---|
| \`contacts:read\` | GET | \`/v1/contacts?page=1&q=Carlos\` | Consulta até 20 contatos |
| \`contacts:write\` | POST | \`/v1/contacts\` | Cria ou atualiza contato |
| \`contacts:write\` | PATCH | \`/v1/contacts/{uuid}\` | Edita contato |
| \`contacts:write\` + \`events:write\` | POST | \`/v1/reminders\` | Cria ou atualiza contato + registro + evento |
| \`contacts:write\` + \`events:write\` | POST | \`/v1/events\` | Mesmo contrato do endpoint de lembretes |
| \`events:read\` | GET | \`/v1/events?page=1\` | Lista eventos |
| \`events:read\` | GET | \`/v1/events/{externalId}\` | Consulta evento, confirmação e lembretes |
| \`events:write\` | PATCH | \`/v1/events/{externalId}\` | Reagenda ou muda confirmação |
| \`events:write\` | POST | \`/v1/events/{externalId}/cancel\` | Cancela evento |
| \`events:read\` | GET | \`/v1/reminders/{externalId}\` | Alias de consulta |
| \`imports:write\` + \`contacts:write\` + \`events:write\` | POST | \`/v1/imports\` | Lote JSON de 1 a 50 eventos |
| \`events:read\` | GET | \`/v1/imports/{uuid}\` | Resultado da importação |
| \`messages:read\` | GET | \`/v1/messages?page=1&external_id=...\` | Status de mensagens |

Todas as listagens retornam \`items\`, \`total\`, \`page\` e \`pages\`. A quantidade fixa é de **20 itens por página**.

A importação em lote usa \`{"items":[... ]}\`; responde com **HTTP 207** e um \`job_id\`, \`imported\`, \`rejected\`, itens aceitos e erros por item. Cada item é processado em sua própria transação: falhas não descartam os itens válidos.

### Exemplo de reagendamento

\`\`\`http
PATCH /v1/events/REV-2026-1045
Authorization: Bearer <SUA_CHAVE>
Content-Type: application/json

{"date":"2027-01-15","time":"10:00"}
\`\`\`

Cancelamento:

\`\`\`http
POST /v1/events/REV-2026-1045/cancel
Authorization: Bearer <SUA_CHAVE>
\`\`\`

## Chaves, rate limits e rastreabilidade

- Chaves geradas com 32 bytes aleatórios; apenas SHA-256 e prefixo ficam no banco.
- Criação, revogação e validade são geridas no painel pela equipe Administradora.
- Até 10 chaves ativas por ambiente; validade de 1 a 365 dias.
- Limite inicial de 60 chamadas por minuto por chave, além do limitador geral por IP.
- Respostas HTTP: \`401\` (chave inválida/expirada), \`403\` (escopo), \`409\` (conflito), \`422\` (validação), \`423\` (ambiente pausado), \`429\` (limite).
- Log de chamadas por ambiente, com método, rota normalizada, tempo e status, **sem guardar token nem corpo da requisição**.
- Em várias instâncias de backend, substitua o rate limiter em memória por armazenamento compartilhado antes de ampliar a operação.

## Webhooks de saída (BR Notify → CRM/ERP)

Cadastre até cinco URLs HTTPS públicas em **API e Integrações → Webhooks**, selecionando os eventos:

- \`reminder.sent\`, \`reminder.delivered\`, \`reminder.failed\`
- \`event.cancelled\`
- \`appointment.confirmed\`, \`appointment.reschedule_requested\`, \`appointment.declined\`

O BR Notify envia \`POST\` JSON contendo \`id\` (UUID do evento), \`type\`, \`timestamp\` e \`data\` com o \`external_id\` original do CRM.

### Verificação HMAC

O segredo de assinatura (\`whsec_...\`) é exibido apenas na criação ou rotação do endpoint. O servidor receptor deve:

1. Ler o **corpo JSON bruto** exatamente como recebido.
2. Obter \`X-BRNotify-Timestamp\` e \`X-BRNotify-Signature\`.
3. Calcular HMAC-SHA256 do texto \`timestamp + "." + rawBody\` usando o segredo.
4. Comparar em tempo constante, rejeitar timestamps fora de uma janela curta (por exemplo, 5 minutos) e deduplicar pelo \`X-BRNotify-Event\` ou \`payload.id\`.

Exemplo Node.js:

\`\`\`js
import crypto from 'node:crypto';

function verifyWebhook(secret, timestamp, rawBody, header) {
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + rawBody)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
\`\`\`

Um HTTP **2xx** confirma entrega. Respostas 5xx, 408, 429 e erros de rede recebem novas tentativas com intervalos crescentes (até 8 tentativas); erros 4xx permanentes são exibidos como falha. O worker faz DNS seguro e pinagem do IP público, só aceita HTTPS/443 e não segue redirecionamentos. Após queda do worker, notificações podem ser reenviadas. **Os consumidores precisam ser idempotentes.**

## Confirmações pelo WhatsApp (GoTo → BR Notify)

A GoTo Messaging API v2 precisa estar conectada e inscrita em \`INBOUND_MESSAGE\` e \`DELIVERY_STATUS\`. Um evento só é elegível para confirmação se:

1. \`confirmation_enabled=true\` no evento;
2. O evento ainda está programado e no futuro;
3. O contato tem autorização e recebeu mensagem GoTo nos últimos 7 dias;
4. Existe **exatamente um** evento elegível para aquele contato.

O contato pode responder **SIM**, **CONFIRMAR**, **1** (confirmado); **REAGENDAR**, **REMARCAR**, **2** (reagendamento); ou **CANCELAR AGENDAMENTO**, **NÃO VOU**, **3** (recusado). Mensagens desconhecidas são ignoradas.

Se houver vários eventos possíveis, o BR Notify registra resposta **ambígua** no painel e não altera nenhum agendamento. Pedidos de reagendamento suspendem lembretes futuros até a alteração da data; recusas cancelam o evento. Confirmações mantêm a programação normal de lembretes.

**Importante:** os botões ou instruções de resposta fazem parte de um template do WhatsApp já aprovado pela Meta e disponível na GoTo. O BR Notify não cria nem aprova templates automaticamente. O retorno de resposta é baseado no conteúdo recebido no webhook; não presume que exista uma confirmação transacional nativa na API.

## Implantação

Execute em ordem no SQL Editor do Supabase:

1. \`database/001_init.sql\`
2. \`database/002_rebuild_queue.sql\`
3. \`database/003_public_integrations.sql\`

Inicie o backend e worker independentes conforme \`deploy/DEPLOY.md\`. Não utilize Edge Functions, não exponha \`DATABASE_URL\` ou a chave \`SUPABASE_SERVICE_ROLE_KEY\` no frontend.

## URA: disparo de templates sem agendamento

Além de lembretes, o BR Notify aceita `POST /v1/messages/send` com token específico `messages:send`, `to`, `template`, parâmetros opcionais e confirmação da escolha do cliente na URA. Não exige Call ID; evita duplicatas por 120 segundos. Confira [o guia detalhado](IVR_WHATSAPP_API.md).
