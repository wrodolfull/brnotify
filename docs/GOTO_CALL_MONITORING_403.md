# Diagnóstico: GoTo HTTP 403 ao ativar monitoramento de telefonia

Este guia aplica-se a **GoTo Connect → Chamadas → Ativar monitoramento**.

## O que acontece no código

A ativação usa um token OAuth de um usuário GoTo Connect com privilégios administrativos e realiza, em sequência:

1. `POST /notification-channel/v1/channels/:nickname` — criar um Webhook Notification Channel exclusivo do ambiente.
2. `POST /call-events/v1/subscriptions` — assinar os estados `STARTING`, `ACTIVE`, `ENDING`.
3. `POST /call-events-report/v1/subscriptions` — assinar `REPORT_SUMMARY`.

O primeiro `POST` precisa atingir o webhook HTTPS público do BR Notify (configurado por `API_URL`). O backend da API pode escutar na porta **4000** atrás de um proxy; a URL pública deve ser HTTPS/443.

### 403 com HTML da CDN, não JSON

Exemplo de resposta: `HTTP 403` com `<!DOCTYPE HTML>` e título `The request could not be satisfied`.

Esse formato sugere que a solicitação foi recusada numa camada de gateway/distribuição antes de uma resposta usual JSON da API. **Não confirma por si só** ausência de escopos, IP bloqueado, permissão administrativa ou um incidente GoTo específico. Não inventar a causa nem repetir chamadas automaticamente para contornar o bloqueio.

A partir desta correção o erro mostrará **a operação exata** em que ocorreu o 403. Logs também indicam `responseKind: html` e, se houver, `cdnRequestId` que pode ser usado no chamado ao suporte. Corpo HTML e credenciais não são registrados.

### 403 JSON da API GoTo

Se a GoTo responder `application/json` com `errorCode: AUTHZ_INSUFFICIENT_SCOPE`, verifique explicitamente os escopos e refaça a autorização:

- `cr.v1.read`
- `call-events.v1.notifications.manage`
- `call-events.v1.events.read`

Confirme que esses escopos foram adicionados ao **OAuth Client do GoTo Developer** e que a autorização foi refeita por usuário com permissão de administrador na **mesma conta GoTo Connect** informada em Account Key.

**Importante:** o flag `call_scopes_granted` no BR Notify indica que o usuário percorreu o fluxo OAuth com solicitação de escopos de chamadas, não prova independente de que a GoTo concedeu acesso ao recurso. Um 403 JSON continua sendo possível.

## Como isolar o problema

1. Confira se o WhatsApp da GoTo continua conectado e se o Account Key corresponde à conta de telefonia.
2. Entre em GoTo Developer, confirme os escopos do OAuth Client e faça **GoTo Connect → Chamadas → Autorizar telefonia** usando um usuário com privilégios adequados.
3. Confira `API_URL` em produção. Deve apontar ao domínio público HTTPS do **BR Notify**, sem porta 4000 exposta no endereço. Certifique-se de que o domínio encaminha para o backend.
4. Clique em **Ativar monitoramento** uma vez e consulte os logs da API. Registre a operação, o status, se a resposta foi `html` ou `api`, e `cdnRequestId` quando disponível.
5. Se o mesmo 403 HTML persistir, reúna horário UTC, etapa, URL base `https://api.goto.com`, código HTTP e `cdnRequestId` para o suporte GoTo. Informe que a chamada partiu da VPS do BR Notify, mas **não envie** client secret, access token, refresh token, cookie, segredo de webhook ou conteúdo de `.env`.

O backend também salva um resumo em `goto_call_monitors.last_error`, disponível em `GET /api/goto/calls/status` para o administrador do ambiente.

## Referências oficiais

- https://developer.goto.com/guides/GoToConnect/14_HOW_useNotificationChannelApi/
- https://developer.goto.com/guides/GoToConnect/15_HOW_useCallEventsApi/
- https://developer.goto.com/guides/GoToConnect/16_CallEventsReport/

**Limitações:** este ajuste melhora diagnóstico; não altera permissões do usuário GoTo, regras de CDN, certificados ou política do provedor. Falha parcial na criação de subscriptions pode deixar canais antigos na GoTo. Não executar tentativas repetidas como solução para 403.
