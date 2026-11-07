# Etapa 1 — Fundação de eventos GoTo Connect

Esta etapa cria uma camada de eventos independente dos antigos compromissos da aplicação. **Nenhuma automação de chamadas ou novo envio WhatsApp é executado a partir dos eventos.** A orquestração visual `Quando → Aguardar → Se → Então` pertence à etapa 2.

## O que está incluído

- Registro normalizado de mensagens WhatsApp recebidas e alterações de entrega, preservando o motor existente de envios, descadastro e confirmação de consultas.
- Estados de chamadas GoTo Connect (`STARTING`, `ACTIVE`, `ENDING`) por Notification Channel com webhook, mais eventos `REPORT_SUMMARY` da Call Events Report API.
- `integration_events` com chave de deduplicação por tenant+provedor+origem+ID e informações compactas, sem gravar a notificação bruta da GoTo.
- `goto_call_conversations` para agrupar estados por `conversationSpaceId`, registrar a maior sequência conhecida, possíveis lacunas e status de consulta do relatório.
- Worker independente que busca o relatório pós-chamada, valida conta e conversa, armazena apenas um resumo limitado e não bloqueia a fila de mensagens.
- **Atividades → Chamadas** e **GoTo Connect → Chamadas** para ativar e consultar o monitoramento. Apenas telefonia e WhatsApp; sem caixa omnichannel, CRM ou regras automáticas.

## Implantação segura

1. Execute **`database/011_goto_event_foundation.sql`** no Supabase, depois da migração 010.
2. Publique backend e worker atualizados, depois frontend.
3. Configure `API_URL` com a URL pública **HTTPS** da API, acessível pela GoTo. O webhook da telefonia é gerado automaticamente com segredo aleatório e exclusivo do ambiente; não use URL pública sem HTTPS.
4. No portal GoTo Developer, adicione os escopos `cr.v1.read`, `call-events.v1.notifications.manage` e `call-events.v1.events.read` ao cliente OAuth, preservando os escopos do WhatsApp.
5. Entre em **GoTo Connect → Chamadas** e clique em **Autorizar telefonia**. Essa conexão requer um usuário com permissões de administrador/super administrador apropriadas.
6. Depois do redirecionamento OAuth, clique em **Ativar monitoramento**. O backend cria um Notification Channel exclusivo deste ambiente e assina Call Events e Call Events Report.
7. Faça uma chamada real de teste com a conta GoTo conectada; depois consulte **Atividades → Chamadas**. A mensagem `Relatório consultado` exige o evento `REPORT_SUMMARY` e o worker em execução.

A autorização de telefonia é opcional. Usuários que utilizam apenas os recursos de WhatsApp não precisam de novos escopos. Em caso de falha parcial ao criar as assinaturas, a tela mostra o erro; a nova tentativa pode deixar um canal antigo cadastrado na GoTo, exigindo limpeza administrativa. Não utilize este ambiente para testes de carga.

## API interna

- `POST /api/webhooks/goto-calls/:tenantId/:secret` — webhook exclusivo de telefonia com segredo longo, verificação do hash, validação de accountKey quando recebido, resposta 204 para eventos duplicados e handshake vazio.
- `GET /api/goto/calls/status` — prontidão da conexão, autorização e assinaturas.
- `POST /api/goto/calls/activate` — apenas administrador autorizado do tenant; cria canal/assinaturas.
- `GET /api/goto/calls?page=1` — resumo paginado das conversas telefônicas.
- `GET /api/goto/events?kind=all|call|message&page=1` — log normalizado por ambiente, para depuração e futura orquestração.

O endpoint de mensagens já existente permanece igual. Mensagens recebidas e status de entrega passam também a gerar entradas normalizadas no log sem afetar as ações existentes.

## Segurança e qualidade

- Os estados de chamadas podem chegar fora de ordem. `last_sequence` impede que um estado antigo substitua o mais recente; `sequence_gap` indica lacunas observadas para futura reconciliação. Não supomos que `ENDING` signifique `perdida`.
- A lista por `conversationSpaceId` mantém as informações separadas por ambiente. O webhook dedicado confia no **segredo exclusivo do tenant** para identificar a origem, pois os eventos `REPORT_SUMMARY` podem não conter `accountKey`. Quando `accountKey` está presente, ele precisa corresponder à conta do tenant.
- Relatórios são consultados pelo worker com tentativas limitadas e backoff nos erros transitórios. Resposta `404` transitória, `429` e `5xx` podem ser tentadas novamente. Resultado final nunca gera disparo por si só.
- O relatório completo, gravações e transcrições **não são persistidos**. O resumo armazena direção, datas, número externo quando inequívoco e quantidade de participantes. A classificação de atendimento/perda será desenvolvida na etapa 2 com regras e correlação de múltiplas ligações.
- Eventos e chamadas processadas são eliminados depois de 90 dias pelo worker. As tabelas têm RLS habilitado e bloqueio de acesso direto ao browser. O acesso via API depende do JWT e das permissões existentes.
- `api/goto/calls/activate` exige HTTPS público, permissões da GoTo e OAuth atualizado. Se a autorização não contemplar as novas APIs, o WhatsApp existente não é alterado; a ativação exibe erro.

## Documentação GoTo consultada

- https://developer.goto.com/guides/GoToConnect/14_HOW_useNotificationChannelApi/
- https://developer.goto.com/guides/GoToConnect/15_HOW_useCallEventsApi/
- https://developer.goto.com/guides/GoToConnect/16_CallEventsReport/

## Limites conhecidos

A etapa 1 não importa retroativamente o histórico de chamadas: recebe os eventos depois da ativação. Não classifica chamadas perdidas e não executa mensagens automáticas após ligações. A reconciliação de sequências ausentes será ampliada na etapa 2, antes de permitir condições baseadas em chamadas perdidas. APIs GoTo requerem validação real na conta que será utilizada em produção.
