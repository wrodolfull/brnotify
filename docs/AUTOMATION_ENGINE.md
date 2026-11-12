# Etapa 2 — Motor de automações do BR Notify

Esta etapa acrescenta ao BR Notify **gatilhos e ações sem código**, preservando totalmente a configuração existente de lembretes de compromissos (até três regras no menu contextual de Notificações).

## O que o cliente vê

Novo menu **Automações** com fluxos simples: **Quando acontecer → Aguardar → Verificar → Então fazer**. Os exemplos são configurações iniciais editáveis, não ações pré-ativadas. O usuário precisa **salvar como rascunho e ativar** explicitamente.

Gatilhos:
- Resposta recebida no WhatsApp (qualquer texto, exatamente um texto, ou contendo uma expressão).
- Mudança de status de entrega de mensagem WhatsApp enviada pelo BR Notify (inclusive filtro por falha ou entrega).
- Chamada encerrada no GoTo Connect.
- Relatório de uma chamada disponibilizado pela GoTo.

Condições:
- Esperar de 0 até 10.080 minutos (sete dias).
- Para mensagens recebidas: opcionalmente continuar **somente se o mesmo número não tiver enviado outra mensagem durante a espera**.

Ações:
- **Registrar aviso**: cria uma execução consultável na área Automações → Execuções; não envia e-mail ou push.
- **Enviar webhook**: utiliza somente endpoints HTTPS já registrados no BR Notify, com assinatura HMAC, proteção contra redes locais e fila própria de tentativas.
- **Enviar template WhatsApp**: permitido **somente a partir de uma mensagem recebida no WhatsApp**. Reaproveita o motor de envio cadenciado, com template GoTo aprovado e contato previamente cadastrado com consentimento ativo. Aceita valores fixos e `{{contact.name}}`, `{{contact.phone}}` ou `{{message.text}}` como valores de variáveis.

## Segurança e limites de ativação

- **Não** inferir que `call.ended` representa uma chamada perdida. A fundação atual não distingue com segurança todos os casos de multi-leg, atendimento e transferência. Chamadas podem gerar avisos/webhooks, **não** uma mensagem automática de recuperação. A análise de chamadas perdidas e retornos exigirá correlação validada em evolução posterior.
- Ativação não reprocessa eventos anteriores; o cursor avança apenas sobre eventos recebidos **depois da ativação**. Fluxos começam sempre como rascunho.
- A alteração exige pausar o fluxo. Ao pausar, editar ou reativar, execuções pendentes são canceladas e o cursor é renovado.
- O motor usa chave única `(flow_id,event_id)`, cursor transacional, `FOR UPDATE SKIP LOCKED` e limite de 1.500 execuções por ambiente em 24 horas. Ultrapassar o limite pausa o fluxo e cancela ações pendentes, exigindo revisão manual.
- Ações externas interrompidas durante a execução são marcadas como **indeterminadas** e não são reenviadas automaticamente; verificar o histórico e o provedor antes de tentar novamente.
- O status `Concluída` significa que o alerta foi registrado ou a ação externa foi **colocada em fila**. Não indica que um webhook foi entregue ou que a mensagem foi recebida; os canais possuem históricos separados.
- Os registros de execução são retidos até 90 dias; chamadas e mensagens normalizadas seguem a retenção da etapa 1. As tabelas são privadas (RLS, sem acesso via anon/authenticated). A API exige sessão e acesso ao tenant.
- Ações webhook utilizam endpoints cadastrados em **API e Integrações**, não URLs livres. O endpoint recebe `automation.triggered` com ID da automação, tipo/horário do evento e contexto mínimo; receptores devem verificar assinatura e deduplicar a entrega.
- O limite por número, a cadência GoTo, os templates aprovados e o opt-out continuam válidos. Nenhum consentimento novo é criado automaticamente por um fluxo.

## Implantação

1. Confirme que `database/011_goto_event_foundation.sql` já foi executada, assim como todas as anteriores.
2. Execute **`database/012_automation_engine.sql`** no PostgreSQL/Supabase **antes** de publicar a API ou worker atualizados.
3. Implante API e worker na mesma versão e reinicie os processos, então publique o frontend.
4. Garanta o funcionamento dos webhooks da GoTo e o processamento de eventos; sem eventos novos a automação não executa.
5. Crie uma automação de aviso interno a partir de uma resposta recebida. Salve e **ative**, depois gere uma **nova** resposta real no WhatsApp de teste.
6. Consulte **Automações → Execuções**. Teste a espera e a condição de não receber nova resposta. Só então habilite webhook ou template de WhatsApp.
7. Para teste com envio de WhatsApp, verifique número cadastrado e consentido, template aprovado e entregas no histórico de Notificações.

## API interna

- `GET /api/automation-options` — templates aprovados e webhooks ativos no ambiente.
- `GET /api/automation-flows?page=1` — lista de fluxos.
- `POST /api/automation-flows` — cria rascunho.
- `PUT /api/automation-flows/:id` — edita somente em rascunho/pausado.
- `POST /api/automation-flows/:id/status` — corpo `{"status":"active"}` ou `{"status":"paused"}`.
- `GET /api/automation-runs?page=1&flow_id=...` — histórico por tenant.

A execução não fornece um editor n8n genérico: ela suporta um único gatilho, filtro simples, espera, verificação e uma ação. Isso mantém a experiência de uso objetiva, consistente e testável.

## Fora do escopo

- Portais para revendedores/parceiros (etapa 4 adiada).
- IA e inferência de oportunidades, tom de voz ou chamadas perdidas (etapa 3).
- SMS, e-mail, Messenger, Instagram ou chat omnichannel.
- Desenho de fluxos arbitrários com ramificações ilimitadas ou execução de código de terceiros.

A estrutura atual suporta ampliação futura dos gatilhos e ações sem precisar remodelar os compromissos.

## Respostas associadas a templates enviados

O filtro opcional `source_template_id` restringe o gatilho `message.received` ao modelo enviado anteriormente pelo BR Notify. A associação é conservadora: procura um único envio aceito nos últimos sete dias, pelo mesmo número, antes do horário da resposta. Se nenhum envio ou mais de um envio for encontrado, o fluxo específico não dispara; a GoTo não garante que a resposta informe qual template a originou. A regra sem filtro continua disponível para compatibilidade. A confirmação legada de compromissos só deve processar mensagens associadas inequivocamente a um lembrete, nunca respostas a envios avulsos. Execute `database/015_reply_template_routing.sql` antes de atualizar API/worker; publique frontend em seguida.
