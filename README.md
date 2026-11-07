# BR Notify

Plataforma de lembretes multitenant por WhatsApp, com integração GoTo Messaging API v2.

## Notificações simples — etapa 0

O menu **Notificações** permite escolher uma ação sem precisar entender a estrutura de Eventos:
- **Enviar para uma pessoa:** modelo GoTo aprovado, contato autorizado e envio imediato ou agendado.
- **Enviar usando uma planilha:** template aprovado, CSV/XLSX, horários opcionais por linha, validação antes de confirmar.
- **Criar lembretes de compromissos:** mantém os lembretes antes de uma data real e as até três regras existentes.

**Atividades** reúne o histórico de envios individuais, em lote, URA e lembretes. Nenhuma mensagem avulsa cria um compromisso fictício.

Execute a migração **`database/010_panel_notifications.sql` após `009_ivr_key_no_expiration.sql`** antes da publicação desta etapa. Consulte [Etapa 0 — Notificações simples](docs/SIMPLE_NOTIFICATIONS.md) para deploy, API interna, limites, planilhas e testes.

## Estrutura
- `apps/web`: frontend React + Vite, mobile-first, tema claro e sidebar preta.
- `apps/api`: backend Express/TypeScript e worker de agendamentos independente.
- `database`: migração SQL para Supabase PostgreSQL. **Sem Edge Functions**.

## Instalação
1. Requer Node.js 22+, Supabase (Auth + PostgreSQL) e uma organização GoTo com WhatsApp habilitado.
2. Execute `database/001_init.sql`, `database/002_rebuild_queue.sql` e `database/003_public_integrations.sql` e `database/004_unified_reports.sql`, nesta ordem, no SQL Editor do Supabase.
3. Copie `.env.example` para `.env` e configure os segredos apenas no servidor.
4. Execute `npm install`.
5. Execute `npm run bootstrap -w @brnotify/api` para criar o primeiro super administrador (requer BOOTSTRAP_EMAIL e BOOTSTRAP_PASSWORD; mínimo 12 caracteres).
6. Para desenvolvimento: `npm run dev:api`, `npm run dev:worker` e `npm run dev:web`, em terminais separados.
7. Produção: `npm run build`, `pm2 start ecosystem.config.cjs`; sirva `apps/web/dist` via Nginx. Veja [implantação na VPS](deploy/DEPLOY.md).

## Controle de acesso
Cadastro público desativado. Somente o Super Admin cria ambientes e convida usuários. O backend valida o JWT do Supabase Auth e o vínculo entre usuário, ambiente e função em todas as rotas protegidas. Nunca confiar no `x-tenant-id` sem validar a associação.

## WhatsApp
Crie um OAuth Client no portal GoTo, configure os scopes `messaging.v1.send messaging.v1.read messaging.v1.notifications.manage` e cadastre `GOTO_REDIRECT_URI`. Em Configurações, autorize a conta, informe o `accountKey` e o identificador numérico Meta do remetente, então sincronize templates. Apenas templates de texto aprovados são enviados pelo MVP.

Para status de entrega, configure no GoTo Notification Channel um webhook HTTPS apontando para `/api/webhooks/goto/:secret`, usando `GOTO_WEBHOOK_SECRET` como segredo aleatório longo e na tela Integrações, informe o ID do canal e crie a assinatura do Messaging V2 com `DELIVERY_STATUS` e `INBOUND_MESSAGE` (opt-out por STOP/SAIR). O webhook não é iniciado automaticamente; depende das permissões Super Admin GoTo. Restrinja o endpoint por gateway/IP quando possível. **A URL secreta não substitui uma assinatura criptográfica quando o provedor suportar uma.**

## Segurança operacional
- Não armazene credenciais no repositório, logs ou frontend.
- Bloqueie REST/Data API direto ao banco; as tabelas estão com RLS habilitado e sem policies para browser.
- Use DATABASE_URL de conexão PostgreSQL somente no backend.
- Cada lista é paginada em 20 registros.
- Na planilha, as colunas lembrete_1/2/3 aceitam vazio (padrão do ambiente), 1m, 3d, 1s ou off.
- O worker reserva jobs usando SKIP LOCKED, registra tentativas e não reenvia automaticamente resultados incertos de rede.
- Teste real de autenticação, OAuth, templates e webhook antes de produção.

Documentação GoTo: https://developer.goto.com/guides/GoToConnect/18_HOW_useMessagingV2Api/

## Integrações v1

O módulo **API e Integrações** permite ao Administrador criar chaves por ambiente, cadastrar webhooks assinados e monitorar chamadas, entregas e confirmações recebidas pelo GoTo.

- Documentação e exemplos: [API Pública](docs/PUBLIC_API.md)
- Contrato OpenAPI disponível em `/v1/openapi.json`
- Sem planos, cobrança ou criação pública de usuários.

## Relatório unificado

A tela **Relatório geral**, disponível para Administradores e Visualizadores, consolida notificações, falhas, confirmações e integrações com filtros e exportação CSV. Leia [Relatórios](docs/REPORTS.md).

## Templates ricos GoTo (mídia e botões)

A integração suporta templates com imagens/vídeo/PDF no cabeçalho, botões com variáveis e envios reais de teste. A mídia é privada por ambiente no Supabase Storage. Veja [GoTo — templates ricos](docs/GOTO_RICH_TEMPLATES.md).

## Biblioteca de modelos de WhatsApp

Na integração GoTo Connect, a **Biblioteca de modelos** oferece 12 sugestões para cadastro manual na Meta, com variáveis, mídia, botões e mapeamento guiado após sincronização. Guia: [Biblioteca de modelos](docs/TEMPLATE_LIBRARY.md).

## Segurança de disparos WhatsApp

A fila usa cadência de 1–5 segundos por ambiente, reserva global no PostgreSQL, tratamento de 429 com Retry-After e revisão manual de erros indeterminados. Migração 006 obrigatória. [Guia de segurança dos disparos](docs/SAFE_DISPATCH.md).

## Diagnóstico de envios WhatsApp

O payload valida telefones em E.164 antes de chamar a GoTo, o worker registra resultados de cada tentativa e o cadastro de agendamentos informa quantos lembretes foram realmente programados. [Guia de diagnóstico](docs/WHATSAPP_DELIVERY_DIAGNOSTICS.md).

## API de disparo imediato para URA GoTo

`POST /v1/messages/send` permite enfileirar templates aprovados por token `brn_live_...` com escopo exclusivo `messages:send`, **sem Call ID**. Antiduplicação de 120 segundos, consentimento explícito e mesma cadência do worker. [Guia da URA](docs/IVR_WHATSAPP_API.md).

## Portal de documentação para desenvolvedores

Acesse **`/docs`** (por exemplo `http://localhost:5173/docs`) para navegar pelos endpoints públicos do BR Notify sem login, consultar escopos e exemplos de integração em **cURL, Python e Node.js**. A documentação tem índice lateral por recurso, busca, múltiplos cenários por endpoint e exemplos de respostas. O botão **Documentação** em **API e Integrações** abre o portal. O JSON OpenAPI continua disponível em `/v1/openapi.json` na API. Os exemplos usam dados fictícios e não executam requisições automaticamente.

## Integrações de agendamentos de clínicas e CRMs

Use **`POST /v1/appointments/sync`** para importar um agendamento completo do sistema externo. Contato, consentimento, título, data e **horário são obrigatórios**. A API cria/atualiza contato, registro opcional e compromisso no mesmo ambiente; só confirma sucesso se houver lembrete futuro com template aprovado e remetente GoTo configurado. Retorna horários efetivamente programados e não gera cadastros parciais quando faltam pré-requisitos. `external_id` permite reagendar sem duplicar. Veja [docs/PUBLIC_API.md](docs/PUBLIC_API.md) e a página pública `/docs`.
