# Relatório Geral — BR Notify

A plataforma possui uma única página de relatório, no menu Principal → Relatório geral.

## Indicadores
- Disparos previstos, aceitos pela GoTo, entregues, falhos, cancelados e indeterminados.
- Confirmações e solicitações de reagendamento registradas no histórico de respostas recebidas.
- Respostas ambíguas ou não associadas, novos contatos e eventos programados.
- Importações, chamadas de API, webhooks entregues, códigos de erro mais frequentes e tendências.
- Tabela única de atividades (mensagens, eventos, confirmações e integrações).

## Filtros e exportação
- 7, 30 ou 90 dias, ou intervalo personalizado de até 366 dias.
- Aplicar filtros atualiza a visão. Período vale para indicadores e gráfico; origem, status e busca refinam a tabela e o CSV.
- A listagem retorna 20 registros por página. O CSV entrega as 2.000 atividades mais recentes que correspondem ao filtro; divida períodos grandes para exportar os demais registros.
- Administradores e Visualizadores acessam somente relatórios do seu ambiente.

## Critério temporal
O fuso horário é o cadastrado no ambiente. O filtro representa:
- Mensagens: data programada do lembrete.
- Eventos: data prevista do compromisso.
- Confirmações: data de recebimento da resposta GoTo, no histórico inbound_interactions.
- Contatos, APIs, importações e webhooks: data de criação do registro.

A taxa de entrega equivale a **mensagens entregues ÷ mensagens com registro de envio GoTo** entre os lembretes programados no período. Ela pode aumentar conforme chegam status de entrega. Não representa presença na consulta e não inclui lembretes não disparados.

## API e banco
- GET /api/reports?days=30 — indicadores e tendências.
- GET /api/reports/activity?days=30&page=1&kind=message&status=failed — 20 atividades paginadas.
- GET /api/reports/export?days=30&kind=message&status=failed — CSV protegido de injeção de fórmulas.
- Datas personalizadas usam from=AAAA-MM-DD&to=AAAA-MM-DD, em vez de days.

As rotas exigem autenticação Supabase e tenant autorizado. O banco precisa da migration 004_unified_reports.sql depois de 001, 002 e 003. Os testes de relatório são executados em PostgreSQL pelo GitHub Actions, além dos testes unitários e build. O sistema não utiliza Edge Functions.
