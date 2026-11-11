# PostgreSQL/Supabase — queda por `ECONNRESET` no BR Notify

## O que o erro significa

Exemplo de stack:

```text
node:events ... throw er; // Unhandled 'error' event
Error: read ECONNRESET
Emitted 'error' event on BoundPool instance
... pg-pool/index.js
```

Um socket PostgreSQL previamente conectado pode ser encerrado durante ociosiade por falha de rede, manutenção do Postgres, reinício, failover, proxy ou outros motivos. O código original criava `new pg.Pool(...)` sem escutar o evento `error` do pool. No `node-postgres`, **erros em clientes ociosos** são emitidos via `pool.on('error')` fora das Promises de consulta. Sem um listener, o Node.js encerra a API e/ou o worker.

A correção adiciona esse listener **no `db.ts` compartilhado** entre API e worker. O pool descarta automaticamente o cliente ocioso quebrado; as próximas consultas podem criar novas conexões. Também habilita TCP keepalive. O aviso mostra apenas um código como `ECONNRESET` e os contadores do pool, sem `pg.Client`, credenciais nem conteúdo de SQL.

**Isso evita a queda causada pelo erro não tratado, mas não impede interrupções reais de conectividade.** Consultas em andamento ainda podem falhar; seus `try/catch` e rotinas de reprocessamento continuam responsáveis por isso. **Não adicionar retry indiscriminado em operações de escrita**: um comando pode ter sido concluído pelo banco antes do cliente perder a conexão.

## Segurança: `ssl: false` no seu log

O trace também indica `ssl: false` na conexão direta ao Supabase (`db.<ref>.supabase.co:5432`). A conexão usa PostgreSQL sem TLS. O `ECONNRESET` **não prova que isso causou a queda**, mas o banco remoto deve usar SSL.

1. No painel Supabase, abra o projeto → **Connect** e copie a **connection string** adequada ao ambiente.
2. Para um backend persistente com suporte a IPv6 (ou IPv4 add-on), a **Direct connection** é a opção apropriada. Redes somente IPv4 normalmente precisam do **Session pooler**. Não invente manualmente o host/username do pooler: copie-os do painel Supabase.
3. Configure `DATABASE_URL` com TLS. Se sua string ainda não tiver parâmetros, acrescente `?sslmode=require`; se já tiver, `&sslmode=require`. Em aplicações sensíveis, prefira `sslmode=verify-full` e o certificado raiz correto baixado no Supabase.
4. Guarde o arquivo `.env` fora de commits e nunca compartilhe a `DATABASE_URL` inteira: ela inclui senha.
5. Reinicie **API e worker** (ambos importam `db.ts`) depois de configurar SSL. Confirme que não ocorre erro de handshake/certificado; não usar `rejectUnauthorized:false` como solução genérica para erros de certificado.

Ajustar `sslmode` na `DATABASE_URL` pode exigir a configuração do certificado CA em determinados ambientes. Faça a alteração primeiro em staging.

## Validação

- `npm run typecheck`
- `npm run test -w @brnotify/api`
- `npm run build`

Para simular um evento do pool sem abrir conexão real, a suíte `apps/api/src/pg-idle-errors.test.ts` emite `pool.emit('error', ...)` e verifica que a API não encerra e que credenciais não aparecem nos logs.

## Comportamento esperado depois do deploy

Antes: `Unhandled 'error' event ... ECONNRESET`, processo encerrado.

Depois: `[postgres] Conexão ociosa interrompida; pool descartou o cliente. { code: 'ECONNRESET', ... }` e o processo permanece ativo.

**Referências:**
- https://node-postgres.com/apis/pool
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/platform/ssl-enforcement
