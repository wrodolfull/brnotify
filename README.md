# BR Notify

Plataforma de lembretes multitenant por WhatsApp, com integração GoTo Messaging API v2.

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
