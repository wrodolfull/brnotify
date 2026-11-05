# Portal de documentação do BR Notify

## Acesso
- Web: `https://SEU-DOMINIO/docs` (ou `http://localhost:5173/docs` durante o desenvolvimento).
- Botão **Documentação** em **API e Integrações** no aplicativo.
- OpenAPI técnico original: `https://SUA-API/v1/openapi.json`.

A página `/docs` tem layout próprio e **não exige login**; nenhum token privado, vínculo de tenant nem contato real é exposto. O usuário pode selecionar um endpoint na sidebar, filtrar a lista, abrir exemplos por caso de uso, copiar snippets **cURL / Python requests / Node.js 22+ fetch** e verificar respostas ilustrativas.

## Como manter sincronizado
- A API é definida em `apps/api/src/openapi.ts`.
- O portal usa uma cópia versionada desse documento, `apps/web/src/api-docs-openapi.json`, para continuar disponível mesmo se a API estiver offline.
- Quando a API está acessível, a página consulta o endpoint OpenAPI público e substitui a cópia por essa definição.
- Descrições, escopos e cenários úteis ficam em `apps/web/src/api-docs-data.ts`.
- CI executa `apps/api/scripts/docs-reference-smoke.ts` para garantir que o snapshot e todos os endpoints explicados correspondam à especificação, incluindo método, caminho e exemplos para cada linguagem.
- Ao adicionar uma rota pública, atualize **os três arquivos**, sem incluir rotas administrativas internas.

## Segurança de uso
- Os campos URL base e token servem apenas à composição dos exemplos. O token é mantido exclusivamente no estado local da página, **não** em localStorage, URL, servidor ou logs.
- Não existe botão de executar requisições no portal para evitar disparos involuntários.
- O token gerado pelo painel deve ser enviado no cabeçalho HTTP, nunca em query string.
- Mensagens `POST /messages/send` requerem consentimento real, mesmo quando originadas por URA. Respostas HTTP 202 indicam enfileiramento, não entrega.
- A referência é pública; a API de negócios sempre exige autenticação Bearer e scopes adequados.

## Desenvolvimento
```powershell
npm run dev:api
npm run dev:web
```
Abra `http://localhost:5173/docs`, selecione **Disparar WhatsApp pela URA** e alterne entre exemplos **Envio simples**, **Com variáveis**, **Botão com URL** e **Cabeçalho com mídia**. Em outra aba, confirme que a plataforma permanece disponível em `/`.

## Sistema de agendamento externo (clínicas, oficinas, concessionárias)

A seção **Agendamentos → Sincronizar agendamento externo** documenta `POST /v1/appointments/sync` com cenários **Clínica**, **Automotivo** e **Reagendamento**. Esse endpoint é a opção indicada quando data, hora, consentimento e fila de WhatsApp **não podem ser opcionais**. Se o BR Notify não conseguir gerar ao menos uma notificação futura corretamente configurada, retorna 409 sem persistir o agendamento.
