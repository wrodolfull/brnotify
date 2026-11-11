# BR Notify — administração de ambientes, contatos e compromissos (11/11/2026)

## 1. Exclusão de ambientes (/tenants)

Apenas Super Admin. Cada empresa agora tem **Excluir** ao lado de Pausar/Ativar. A interface solicita que o administrador digite o **nome exato da empresa**.

`DELETE /api/tenants/:id` exige `confirm_name` igual ao nome do ambiente. A exclusão permanente remove os dados associados pelas chaves estrangeiras em cascata: contatos, compromissos, registros, mensagens programadas, automações e credenciais GoTo locais.

**Bloqueios:** se existir envio WhatsApp, automação ou webhook em processamento, a ação retorna HTTP 409 e não apaga dados. Mensagens já entregues não podem ser revogadas. A autorização OAuth e assinaturas remotas devem ser removidas no portal GoTo separadamente; apagar as credenciais locais não revoga a autorização no provedor.

## 2. Exclusão de compromissos (/events)

O modal de detalhes inclui **Excluir compromisso**, disponível também para eventos cancelados/concluídos.

`DELETE /api/events/:id` exige administrador do ambiente. Em uma transação, verifica mensagens em processamento (HTTP 409), **cancela todos os disparos ainda agendados** e exclui o evento. Os disparos associados também são removidos pela relação ON DELETE CASCADE. Histórico de mensagens que dependia desse evento é apagado; mensagens já aceitas pelo provedor não podem ser retiradas.

O cancelamento normal (sem exclusão) continua disponível.

## 3. Criar contato sem sair de Novo compromisso

A tela Novo compromisso possui **Criar novo contato**. É possível informar nome, WhatsApp, e-mail opcional e autorização para receber lembretes. O contato é salvo pela API existente e selecionado automaticamente no compromisso; depois o operador pode preencher data, serviço e os lembretes.

Para agilizar cadastros manuais, o checkbox **“O contato autorizou receber mensagens via WhatsApp”** inicia **marcado** nos dois formulários. Essa marcação é uma **declaração do operador**: ele deve confirmar que obteve autorização e desmarcar quando não houver. A origem do consentimento é preenchida inicialmente com texto descritivo editável, mas não constitui prova independente. Opt-outs existentes continuam protegidos.

## 4. Importação independente de contatos

Em **Contatos → Importar planilha**, baixe o modelo Excel. Suporta XLSX/CSV, até **10.000 contatos preenchidos por arquivo**, tamanho máximo de 12 MB. Campos: `nome`, `whatsapp`, `email`, `consentimento`, `origem_consentimento`.

- Nome/WhatsApp obrigatórios. E-mail opcional validado.
- `consentimento=SIM` requer uma origem válida e verdadeira; `NÃO` ou célula vazia não autorizam WhatsApp.
- O backend normaliza telefones, recusa fórmulas XLSX, detecta duplicatas e oferece **Validar planilha** antes da importação.
- Linhas inválidas impedem a importação; o usuário recebe até 100 erros com os números de linha.
- Registros repetidos dentro do arquivo são ignorados. Contatos já existentes são ignorados por telefone (ON CONFLICT DO NOTHING), sem sobrescrever opt-out, estado inativo ou dados anteriores.
- O backend insere os contatos novos em **lotes de 250**, evitando milhares de consultas SQL individuais. Se houver interrupção durante a importação, alguns lotes podem ter sido concluídos; repetir o mesmo arquivo é seguro porque duplicatas serão ignoradas.
- **Importar contatos NÃO cria compromissos nem programa WhatsApp**. A importação de compromissos existente permanece independente e com suas próprias regras.

Endpoints autenticados: `GET /api/contacts/import/template`, `POST /api/contacts/import/preview`, `POST /api/contacts/import`.

## 5. Contatos Ativos / Inativos e exclusão

Novo campo `contacts.is_active BOOLEAN NOT NULL DEFAULT true`, independente de `consent` e `opted_out_at`.

A tela Contatos ganhou abas **Ativos/Inativos**, seleção múltipla por página (até 50), **Desativar/Reativar** e **Excluir** com confirmação. O modal individual também disponibiliza essas ações.

- Desativar cancela lembretes programados e WhatsApps avulsos na fila e impede novos disparos pelo scheduler e pelo worker de mensagens avulsas.
- Disparos em processamento bloqueiam a alteração com HTTP 409.
- Reativar não altera o consentimento nem reprograma automaticamente lembretes que haviam sido cancelados; o administrador deverá rever os compromissos.
- Excluir remove permanentemente o contato, registros e compromissos vinculados; antes, verifica operações em andamento.
- **Opt-out** (revogar autorização do WhatsApp) continua sendo um fluxo distinto de **desativação administrativa**.

Endpoints: `PATCH /api/contacts/status` body `{"ids":["<uuid>"],"active":false}`; `DELETE /api/contacts/bulk` body `{"ids":["<uuid>"]}`. Máximo 50 IDs distintos por requisição. O backend sempre filtra pelo tenant autorizado, não pelo tenant informado no JSON.

## 6. Paginação 50 registros

`pageParams` mudou de 20 para **50 registros por página**, com offset de 50 e contagem coerente. Atualizei os endpoints paginados de ambientes, contatos, eventos, membros, mensagens, templates, atividades, eventos GoTo, execuções de automações, mídia, importações e API pública. Os endpoints de opções, dashboards e prévias continuam com seus limites de propósito próprios.

Esse limite impede que as consultas de listagem retornem a base toda de uma vez, mesmo quando ela possui milhares de registros.

## Implantação e validação

**Migração necessária:** executar `database/014_contact_lifecycle.sql` no PostgreSQL/Supabase **antes** de atualizar a API. Caso contrário, consultas que usam `is_active` vão falhar.

1. Faça backup do banco e aplique a migração 014 em staging, depois em produção.
2. Publique backend, frontend e worker na mesma versão; reinicie ambos os processos que acessam Postgres.
3. Teste o novo contato no compromisso e um contato inativo tentando agendar/enviar mensagem.
4. Teste importação de XLSX e CSV, duplicados, consentimento SIM/NÃO, limite 10.000 e linhas inválidas.
5. Teste exclusão de evento com lembrete aguardando, de contatos em lote e de um ambiente **de teste**, jamais de um ambiente real na primeira validação.

Testes automatizados: `apps/api/scripts/lifecycle-contacts-smoke.ts` (PostgreSQL de CI) e `apps/web/contacts-lifecycle.test.mjs`. Não há disparos de WhatsApp reais executados por essa suíte.

**Nota:** exclusão permanente de tenant ou contato não pode ser desfeita. Isso altera históricos; confirme a política de retenção e backup da sua operação antes de usar em produção.
