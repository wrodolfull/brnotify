# Implantação BR Notify na VPS

## Pré-requisitos
Node.js 22+, npm, Git, Nginx, PM2, projeto Supabase e conta GoTo com WhatsApp habilitado. Não execute o worker em múltiplas instâncias no MVP.

## 1. Supabase
- Crie projeto dedicado.
- Execute database/001_init.sql, database/002_rebuild_queue.sql e database/003_public_integrations.sql e database/004_unified_reports.sql pelo SQL Editor, nesta ordem.
- Em Authentication, configure URL de produção, e-mail SMTP para convites e desative cadastro público.
- Obtenha Project URL, anon key, service_role key e connection string PostgreSQL.
- Use certificado de CA correto para conexão PostgreSQL; não desative validação TLS.

## 2. Servidor
Na raiz do projeto:

    cp .env.example .env
    openssl rand -hex 32

Configure TOKEN_ENCRYPTION_KEY com a saída e gere novo segredo longo para GOTO_WEBHOOK_SECRET.
Preencha DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, WEB_URL, API_URL e VITE_API_URL.

O GoTo requer GOTO_CLIENT_ID, GOTO_CLIENT_SECRET e GOTO_REDIRECT_URI.
O redirect deve corresponder exatamente ao cadastro do OAuth Client, por exemplo:
https://notify.exemplo.com/api/goto/callback

Instalação e validação:

    npm install
    npm run typecheck
    npm run build

Configure BOOTSTRAP_EMAIL e BOOTSTRAP_PASSWORD (mínimo 12 caracteres) e execute APENAS UMA VEZ:

    npm run bootstrap -w @brnotify/api

Após o bootstrap, apague BOOTSTRAP_PASSWORD do arquivo .env.

## 3. Processos
O projeto já inclui ecosystem.config.cjs para PM2:

    npm install -g pm2
    pm2 start ecosystem.config.cjs
    pm2 save
    pm2 startup

Proteja a porta 4000 no firewall, tornando-a acessível apenas localmente.
Utilize deploy/nginx.conf.example como modelo do Nginx. Configure HTTPS com certificado válido.

    sudo nginx -t
    sudo systemctl reload nginx

## 4. GoTo Connect
1. Na aplicação, selecione o ambiente.
2. Em Integrações, autorize via OAuth.
3. Informe accountKey e o WhatsApp Phone Number ID numérico da Meta (não +55).
4. Sincronize templates, mapeie parâmetros e configure os três lembretes.
5. Crie no GoTo um Notification Channel do tipo Webhook apontando para:
   https://notify.exemplo.com/api/webhooks/goto/SEU_GOTO_WEBHOOK_SECRET
6. Cole o identificador Webhook.<id> na tela Integrações e clique em Ativar status e descadastro.
7. O usuário GoTo precisa ser Super Admin para criar esta assinatura.
8. Teste um envio real, a confirmação de entrega e um pedido de opt-out.

## 5. Operação e verificações
    pm2 logs brnotify-api --lines 100
    pm2 logs brnotify-worker --lines 100
    pm2 status
    curl http://127.0.0.1:4000/health

Uma requisição à /api/me sem Authorization Bearer deve retornar HTTP 401.
Valide também isolamento entre ambientes, importação sem duplicações, três lembretes,
renovação OAuth, recebimento de webhook e comportamento após reinício do worker.

Os segredos nunca devem ser enviados ao GitHub. Configure backup do Supabase e retenção de logs.
O projeto não foi validado contra uma conta GoTo de produção; são necessárias credenciais reais.

## Integrações CRM/ERP

Após configurar a conta GoTo e o webhook de entrada, acesse **API e Integrações** no menu do Administrador. Crie uma chave com escopos mínimos e guarde o valor apresentado uma única vez. Cadastre URLs de webhook HTTPS público com porta 443 e configure assinatura HMAC no CRM receptor. Execute testes de autenticação, opt-out, idempotência de agendamento, reagendamento e entrega de webhook antes de produção.

Leia o guia [API Pública](../docs/PUBLIC_API.md) para contratos e exemplos.

## Templates avançados GoTo

Execute a migração `database/005_goto_rich_templates.sql` após a 004. Verifique o bucket privado `brnotify-goto-media` no Supabase Storage. Para configurar texto, mídia e botões, consulte [o guia](../docs/GOTO_RICH_TEMPLATES.md).

## Atualização: cadência de disparos WhatsApp

Pare o worker antes da atualização, execute `database/006_safe_message_dispatch.sql` no Supabase depois da 005, publique backend/worker juntos e reinicie o worker. Veja [Auditoria de disparos](../docs/SAFE_DISPATCH.md).

## API para URA GoTo

Execute a migração `database/007_ivr_on_demand.sql` **após 006**, antes de iniciar o worker atualizado. Veja [Disparo sob demanda](../docs/IVR_WHATSAPP_API.md).
