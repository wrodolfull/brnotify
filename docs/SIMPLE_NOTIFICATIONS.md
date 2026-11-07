# Etapa 0 — Notificações simples

Esta atualização reorganiza o BR Notify em três caminhos que não se confundem.

1. **Enviar para uma pessoa:** contato existente e autorizado → modelo WhatsApp aprovado → agora ou data/hora. Não cria evento/compromisso fictício.
2. **Enviar usando uma planilha:** escolher modelo → baixar CSV de exemplo → preencher números, variáveis e horários opcionais → validar → confirmar. Não cria compromissos. Suporta CSV/XLSX e até 250 linhas por lote.
3. **Lembretes de compromissos:** apenas para datas reais de consultas, revisões etc. Utiliza as três regras existentes de antecedência. Os antigos eventos continuam acessíveis como **Compromissos**.

A navegação principal foi enxugada para Visão geral, Notificações, Contatos, Atividades, Relatórios e configurações. Os caminhos legados continuam disponíveis por links contextualizados (Compromissos, Importar compromissos, Regras de lembretes). O construtor visual de automações baseado em eventos da GoTo pertence à etapa 2, **não** está incluído nesta PR.

## Banco e implantação

1. Execute a sequência atual de migrações até **009_ivr_key_no_expiration.sql**.
2. Execute **010_panel_notifications.sql** antes de atualizar o backend/worker. Ela adiciona `source` e `scheduled_for` à fila existente, sem apagar mensagens.
3. Publique **backend e worker juntos**, depois frontend. Não reinicie o worker com um binário antigo após a migração.
4. Valide OAuth da GoTo, conta/remetente configurados, modelo aprovado e webhook de status `DELIVERY_STATUS`.
5. Verifique `/health`. Teste inicialmente com um contato que tenha autorização documentada. Confirme em **Atividades** se o estado passou por Na fila → Aceito pela GoTo → Entregue (este último depende do webhook).

## API interna do painel (JWT de sessão + tenant autorizado)

- `GET /api/notifications/templates` — modelos GoTo aprovados.
- `POST /api/notifications/send` — `contact_id`, `template_id`, `variables` e `scheduled_at` opcional (horário local do ambiente).
- `POST /api/notifications/batch/preview` — formulário multipart `file` + `template_id`, sem gravar.
- `POST /api/notifications/batch` — mesmo formulário, programa as linhas validadas; devolve totais e erros individualizados.
- `GET /api/notifications/history` — histórico combinado de mensagens do painel, da URA e dos lembretes, isolado por tenant.

### Formato da planilha

A opção **Baixar modelo da planilha** gera os cabeçalhos conforme o template selecionado. Cabeçalhos obrigatórios: `whatsapp`; as colunas `data_envio` e `hora_envio` devem vir juntas quando usadas. Deixe as duas vazias para enviar na fila assim que possível. Colunas de parâmetros do template são obrigatórias quando o template as exige, usando os nomes exatos e qualificados fornecidos pelo modelo (por exemplo `body.nome`). Datas aceitam `DD/MM/AAAA` ou `AAAA-MM-DD`, horários `HH:mm`.

A planilha **não registra consentimento novo**. O contato deve existir previamente com consentimento e origem registrados. A importação antiga de compromissos continua disponível separadamente. Modelos com mídia exigem um arquivo privado do ambiente previamente configurado em GoTo Connect.

## Segurança e funcionamento

- Isolamento por tenant no backend, sem confiar em `tenant_id` informado pelo navegador.
- Apenas administradores autorizados podem criar mensagens. O backend valida `consent`, origem e `opted_out_at`, inclusive antes de enfileirar.
- Nenhum envio fora da fila de ritmo existente; utiliza a cadência global e por ambiente. A origem `ivr` continua exigindo um token de integração válido; a origem `panel` exige autenticação de sessão na rota de criação.
- Agendamentos usam o **fuso horário do ambiente**; envio programado exige ao menos 30 segundos de antecedência e limita horizonte a 365 dias.
- A fila tem prazo de 30 minutos após o horário programado para evitar mensagens muito atrasadas.
- Requisições idênticas em 120 segundos são deduplicadas; há limite por destinatário em intervalo de tempo.
- Resposta HTTP 202 significa **enfileiramento**, não confirmação de entrega. Webhooks atualizam estados posteriores.
- Uma importação em lote pode ter falha parcial após validação (por exemplo, contato revoga consentimento no intervalo); revise o resultado. Uma nova tentativa de linhas idênticas no intervalo de deduplicação não duplica envios.

## Testes de regressão

O CI faz type-check, build, migrações SQL e testes de PostgreSQL com `panel-notifications-smoke.ts`. O teste cobre programação sem criar compromisso, isolação por tenant, bloqueio de opt-out e deduplicação. Envio efetivo depende de testes manuais com uma conta GoTo real e modelo aprovado.

## Fora do escopo desta etapa

Motor de eventos de chamadas, fluxograma estilo n8n, condições de espera/resposta, insights da GoTo e portal comercial de parceiros. A etapa 1 será a fundação de eventos, e a etapa 2 a criação de automações. A etapa 4 (revenda/portal) permanece adiada.
