# BR Notify — Gerenciamento de automações e desconexão GoTo

## Página /flows: modelos sempre acessíveis

Antes: o componente `WorkflowAutomations.tsx` renderizava os cards "Comece por um exemplo" apenas quando `flows.data.items.length === 0`. A primeira regra criada ocultava os modelos, sem opção para voltar.

Agora:
- Um cabeçalho **Modelos prontos** com controle **Ver modelos de automação / Ocultar modelos** fica disponível independentemente da quantidade de regras.
- Os modelos permanecem clicáveis e abrem o editor pré-preenchido, sempre criando uma **nova** regra.
- A lista de automações, edições, execução e paginação continuam separadas.

## Exclusão de automação

Endpoint autenticado: `DELETE /api/automation-flows/:id`, protegido por `tenant(true)` e `activeTenant`.

- Somente administradores daquele ambiente (e Super Admin) podem excluir.
- A interface solicita confirmação explícita e avisa que execuções anteriores também serão apagadas.
- A exclusão é transacional e sempre filtra `tenant_id`.
- Execuções em processamento e envios WhatsApp/webhooks que já estão processando bloqueiam a exclusão com **HTTP 409**. Uma ação em andamento não pode ser cancelada com segurança após começar a interagir com o provedor.
- Mensagens de automação ainda `queued` recebem `cancelled` e continuam consultáveis no histórico de envios, mesmo depois da exclusão do fluxo.
- Webhooks de automação ainda `queued` recebem `dead` para não serem enviados após a exclusão.
- A regra e seu histórico de execuções (`automation_runs`) são apagados pelo relacionamento `ON DELETE CASCADE`.
- Uma mensagem já enviada/aceita pela GoTo não pode ser retirada; permanece no histórico de mensagens.
- Depois de apagar, /flows atualiza a lista. Quando a última regra de uma página é apagada, volta à página anterior.

## Desconectar GoTo (por ambiente)

Endpoint autenticado: `DELETE /api/goto`, protegido por `tenant(true)` e `activeTenant`.

A interface **GoTo Connect → Desconectar GoTo** mostra uma confirmação de impacto e, com sucesso, atualiza os status.

O backend executa uma transação de banco que:
1. Bloqueia a desconexão caso haja mensagens, webhooks de automação ou execuções em processamento (HTTP 409, para evitar resultado ambíguo).
2. Cancela lembretes `scheduled` e mensagens avulsas `queued` **somente** daquele ambiente.
3. Cancela execuções pendentes e desativa entregas webhook pendentes originadas de automações.
4. Pausa as automações ativas do ambiente.
5. Apaga `goto_call_monitors` e estados OAuth locais ainda pendentes, impedindo processamento de webhooks da conexão antiga.
6. Exclui `goto_connections`, incluindo os tokens de acesso e refresh criptografados, a conta e os IDs locais de assinatura.
7. Registra auditoria sem dados sensíveis e retorna o número de itens cancelados.

Os templates, histórico de mensagens, atividades e chamadas **não são apagados**: permanecem disponíveis como histórico do ambiente, mas não podem ser enviados novamente até conectar uma conta e revisar os modelos.

**Importante sobre “revogar”**: esta ação **desconecta o BR Notify e remove as credenciais locais**, sem depender de a GoTo estar acessível (inclusive durante erro HTTP 403). Não se afirma que o consentimento OAuth foi revogado no servidor GoTo. Para revogar também esse acesso e limpar assinaturas externas, utilize os controles de aplicativos/integrações na conta GoTo ou acione o suporte GoTo. A interface e o retorno da API informam explicitamente `provider_authorization_revoked:false`.

## Validação

- `npm run typecheck` e `npm run build` para API e frontend.
- `apps/web/flows-settings.test.mjs` valida permanência dos modelos, exclusão confirmada e botão de desconexão.
- `apps/api/scripts/flows-disconnect-smoke.ts` utiliza **somente banco PostgreSQL local de CI** para validar isolamento entre dois ambientes, exclusão, cancelamento de mensagens/webhooks pendentes, bloqueio de processamento e auditoria.
- Nenhuma migração SQL. Backend e frontend devem ser publicados juntos, com reinício dos processos API e worker.

## Limitações operacionais

- Caso exista efeito externo já iniciado, aguarde o resultado antes de excluir/desconectar; não há desfazer para mensagens aceitas pelo provedor.
- Uma falha de gateway da GoTo não impede remover as credenciais locais, mas assinaturas antigas na GoTo podem continuar existindo até serem removidas no provedor.
- Se o operador conectar outra conta GoTo no futuro, os fluxos pausados não são reativados automaticamente. É necessário revisar e ativar manualmente cada automação.
