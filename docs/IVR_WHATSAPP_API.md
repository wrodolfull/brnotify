# Disparo WhatsApp sob demanda pela URA GoTo

A URA não precisa disponibilizar Call ID. A integração usa **token Bearer exclusivo do ambiente**, telefone e nome do template aprovado. O BR Notify valida os dados, registra a solicitação e devolve HTTP 202. A entrega real acontece pelo worker com o mesmo controle de cadência dos lembretes.

## 1. Criar um token para URA

Entre em **API e Integrações → Chaves de API → Token para URA**. Crie uma chave com somente o escopo **messages:send**, defina validade e copie o token `brn_live_...` exibido uma única vez. Não use o access token OAuth da GoTo nessa chamada. O token pode ser revogado a qualquer momento no painel.

## 2. Configuração do HTTP Request na URA

```http
POST https://API-PUBLICA-DO-BRNOTIFY/v1/messages/send
Authorization: Bearer brn_live_COLE_AQUI_SUA_CHAVE
Content-Type: application/json
```

Body mínimo (variáveis `${callerNumber}` ilustrativas; troque pelo nome correto de variável do seu Canvas):

```json
{
  "to": "${callerNumber}",
  "template": "continuar_atendimento_whatsapp",
  "consent": {"confirmed": true, "source": "ivr_option_whatsapp"}
}
```

Para um template com parâmetro no corpo e botão de URL:

```json
{
  "to": "${callerNumber}",
  "template": "continuar_atendimento_whatsapp",
  "language": "pt_BR",
  "variables": {
    "body.parameter_0": "Atendimento",
    "buttons.0.parameter_0": "codigo-de-acesso"
  },
  "consent": {"confirmed": true, "source": "ivr_option_whatsapp"}
}
```

O nome e idioma devem corresponder ao template **APPROVED** sincronizado no mesmo ambiente do token. As chaves de `variables` correspondem aos nomes qualificados exibidos na tela de integração GoTo. Se o template não possui variáveis, omita `variables`. Para cabeçalho de imagem/PDF, selecione no template uma mídia privada autorizada ou informe `media_asset_id` com UUID pertencente ao ambiente.

Em produção, use sempre HTTPS e `Authorization: Bearer ...` no **cabeçalho**, nunca token em query string/URL. Se o Canvas não permitir métodos POST/cabeçalhos, não transforme isso em uma API GET aberta: avalie um intermediário autenticado.

## 3. Resposta HTTP

```json
{
  "success": true,
  "request_id": "uuid-gerado-pelo-brnotify",
  "status": "queued",
  "deduplicated": false,
  "notice": "Pedido aceito para processamento, não confirmação de entrega"
}
```

O HTTP 202 informa somente enfileiramento. Duas solicitações idênticas no intervalo de **120 segundos** retornam o mesmo `request_id` e `deduplicated: true`, mesmo sem Call ID. Alterar o número, template, conteúdo dos parâmetros ou mídia gera um pedido novo. Há limite adicional de 10 solicitações por hora para o mesmo telefone e ambiente.

Consulte o resultado via:

```http
GET https://API-PUBLICA-DO-BRNOTIFY/v1/messages/send/UUID_DO_PEDIDO
Authorization: Bearer brn_live_SUA_CHAVE
```

Status possíveis: `queued`, `processing`, `sent` (aceito pela GoTo), `delivered`, `failed`, `unknown` (incerto, não reenviar automaticamente) e `cancelled`.
Quando o pedido falhar, a consulta retorna `error_code` e `error_description` (para erros locais de validação). Respostas brutas da GoTo não são expostas na API pública. Chaves `messages:send` marcadas como **nunca expirar** (`expires_at` nulo) são aceitas no worker; chaves revogadas ou vencidas são rejeitadas. Um pedido que já falhou não é reenviado automaticamente. O endpoint de consulta aceita qualquer chave ativa com permissão `messages:send` **do mesmo ambiente**, mantendo isolamento entre empresas. Isso permite consultar uma solicitação deduplicada mesmo quando duas chaves do mesmo ambiente fizeram a mesma chamada.

## Consentimento, segurança e limites

- Configurar `consent.confirmed=true` SOMENTE no ramo da URA em que o cliente escolheu receber o WhatsApp. Caller ID sozinho não significa consentimento. A origem `ivr_option_whatsapp` fica registrada no banco; preserve também evidências da escolha em logs da URA.
- Respeite opt-outs: a API rejeita contatos com descadastro prévio e o webhook `STOP`/`SAIR` cancela pedidos ainda na fila.
- Não há envio imediato síncrono; a fila utiliza intervalo aleatório de 1–5 segundos por tenant, cadência global, cooldown 429 e cuidado com resultados indeterminados.
- Pedidos não enviados em **30 minutos** são cancelados para não enviar WhatsApp muito tempo depois de a ligação terminar.
- A entrega posterior depende de assinatura de notificações `DELIVERY_STATUS` na GoTo.
- A API autentica e limita por chave de ambiente. Nunca exponha seu token em screenshots, logs, URL, snippets públicos ou código frontend.

## Implantação

1. Após merge da PR, pare o worker e execute `database/007_ivr_on_demand.sql` no Supabase, **depois da 006**.
2. Atualize o backend e worker juntos, reinicie os processos e confirme `/health`.
3. Na UI, conecte a GoTo e sincronize um template aprovado.
4. Crie um token `messages:send`, configure o HTTP POST na URA e faça um teste com um único número autorizado.
5. Veja `GET /v1/messages/send/:id` e o retorno de entrega na GoTo. Não use importações de volume para o primeiro teste.

## Referências
- [GoTo Messaging API v2](https://developer.goto.com/guides/GoToConnect/18_HOW_useMessagingV2Api/)
- [API pública BR Notify](PUBLIC_API.md)
