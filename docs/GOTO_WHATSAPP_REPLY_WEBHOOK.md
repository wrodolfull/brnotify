# GoTo WhatsApp — recebimento de respostas com um clique

## Configuração
1. Conecte a GoTo como **Super Admin**. O token OAuth deve incluir `messaging.v1.notifications.manage`.
2. Configure o Account Key e o ID numérico do número WhatsApp.
3. Configure o backend: `API_URL=https://api.seu-dominio.com` e `GOTO_WEBHOOK_SECRET` com pelo menos 24 caracteres. O segredo é privado; não pertence ao frontend.
4. Exponha `/api/webhooks/goto/` no Nginx por HTTPS/443 e permita OPTIONS e POST. A GoTo verifica a URL antes de criar o canal.
5. Aplique `database/016_goto_message_notifications.sql`, após a 015. Implante API e frontend.

No menu **Integração GoTo**, selecione **Ativar recebimento de respostas**. O BR Notify cria um canal Webhook com nome estável por ambiente e assina `INBOUND_MESSAGE` e `DELIVERY_STATUS`. Uma assinatura já cadastrada pode ser verificada e reutilizada. A operação é protegida contra cliques simultâneos.

O status da tela reflete a assinatura **cadastrada**, não a garantia de chegada das mensagens. Faça um teste real: envie um template, responda no WhatsApp e confira `message.received` em Atividades e a execução em Automações.

### Falhas
- `403`: a GoTo pode exigir Super Admin ou retornar bloqueio pelo gateway/CDN. O BR Notify apresenta erro sanitizado e referência da requisição, quando disponível.
- Falha de canal: confirme HTTPS público, encaminhamento correto no Nginx e acesso externo ao endpoint.
- Falha ao assinar: revise permissões do usuário OAuth e o Account Key. Clique novamente para retomar.
- O vínculo da assinatura GoTo é com o usuário utilizado; ao reautorizar ou alterar o Account Key, revise e ative novamente.

### Rotas
- `GET /api/goto/notifications/status` — estado por ambiente, sem expor segredos.
- `POST /api/goto/notifications/activate` — ativação automática apenas para administradores do ambiente.
- `POST /api/goto/notifications/subscribe` — opção manual em Configuração avançada.

### Segurança e limites
A URL do webhook é montada exclusivamente a partir de variáveis de ambiente do backend, nunca recebida do navegador. A GoTo confirma canal e assinatura via APIs; não foi possível executar teste com credenciais GoTo reais no CI. A desconexão local não revoga automaticamente canais e assinaturas remotas.
\n## Diagnóstico de conflito 409 e fluxos sem execuções\n- Antes de criar o canal ou assinatura, a API consulta **todas as páginas** de assinaturas de mensagens do usuário OAuth e procura a assinatura da organização. Se encontrar a assinatura vinculada ao canal salvo, reutiliza sem enviar POST. Se houver assinatura em outro canal, bloqueia a alteração e preserva a configuração para não interromper eventos de outra aplicação.\n- Em caso de HTTP 409 após POST, pesquisa novamente e só considera resolvido se a GoTo mostrar a assinatura compatível. Não mascara conflito como sucesso.\n- Disparos originados pela URA (`/v1/messages/send`) já constam de `on_demand_messages` com `source='ivr'`. A correlação utiliza o número E.164 e o `template_id` gravados no momento do envio. Se houver múltiplos envios ao mesmo número nos últimos sete dias, a origem permanece ambígua, por segurança. Envios feitos pelo botão **Testar template** da tela de integração não fazem parte desse histórico.\n- Respostas correspondentes ao texto da automação, mas sem origem inequívoca ou com origem diferente, aparecem como **Ignorada** em Automações → Execuções, com motivo. Isso ajuda a distinguir webhook ativo de filtro bloqueado.\n
## Motivos de uma execução Ignorada
Quando o texto coincide com a automação, mas a associação ao template falha, o histórico diferencia: (a) dois ou mais envios aceitos para o mesmo número nos sete dias anteriores à resposta; (b) nenhum disparo da URA/painel para o número informado pela GoTo; (c) disparo na fila, falhado ou indeterminado; (d) envio posterior à resposta ou anterior à janela de sete dias; (e) identificador de telefone incompatível com E.164; (f) template de origem diferente. Nenhuma dessas situações resulta no envio automático da ação, para evitar mensagens ao contexto errado. A UI não exibe o telefone nem o segredo da GoTo na justificativa.

## Associação de respostas após múltiplos envios
Uma resposta `2` não traz um ID documentado do template original no evento `INBOUND_MESSAGE` da GoTo. Para automações filtradas por **template de origem**, o BR Notify agora considera **todos os envios aceitos dos últimos 7 dias** ao mesmo número e avalia os **templates distintos** (não apenas o total de mensagens): caso sejam todos o *mesmo template*, permite executar o fluxo correspondente àquele template, inclusive após repetidos disparos pela URA. O contexto registra a quantidade de envios, mas não atribui a resposta a um ID individual quando há mais de um. Caso haja pelo menos **dois templates diferentes**, a execução é ignorada e explica a ambiguidade. Confirmações específicas de agendamento mantêm a validação mais rigorosa de um único envio. Esse comportamento garante apenas associação ao modelo, não a um disparo específico.
