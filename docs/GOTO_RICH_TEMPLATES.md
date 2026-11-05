# GoTo Connect — templates ricos (WhatsApp)

O BR Notify agora pode utilizar templates **previamente aprovados** na GoTo/Meta com texto, mídia e botões. Não cria nem altera modelos na Meta. A GoTo Messaging v2 exige `multipart/form-data` para anexos.

Referência: https://developer.goto.com/guides/GoToConnect/18_HOW_useMessagingV2Api/

## Requisitos

- OAuth por ambiente, com os escopos `messaging.v1.send`, `messaging.v1.read` e `messaging.v1.notifications.manage`.
- Account Key e WhatsApp Phone Number ID do ambiente, configurados em **Integração GoTo**.
- Template com status **APPROVED**, sincronizado da GoTo, conforme a definição original.
- Supabase Storage com bucket privado `brnotify-goto-media`, configurado pela migração `005_goto_rich_templates.sql`.
- Backend Node.js/Express e worker de fila, sem Edge Functions.

## Formatos

| Tipo | Onde aparece | Mapeamento |
|---|---|---|
| Texto | Header, Body, Footer | Campos do contato, evento, registro ou literal |
| Imagem | Header de template | JPG, PNG ou WebP da biblioteca privada |
| Vídeo | Header de template | MP4 da biblioteca privada |
| Documento | Header de template | PDF da biblioteca privada |
| Botões estáticos | Section buttons | Preservados na definição original; não exigem valor |
| Botões com parâmetros | Section buttons (URL dinâmica e outros tipos disponibilizados pela GoTo) | Valor por posição do botão e nome do parâmetro |

O template não pode receber botões ou mídia adicionais que não estejam aprovados na Meta. Para outros formatos de mídia, é necessário ampliar a lista de MIME-types do aplicativo e confirmar compatibilidade com a GoTo.

## Biblioteca privada

Em **Integração GoTo → Biblioteca de mídias**, o Administrador sobe um arquivo de até 5 MB (imagem) ou 16 MB (vídeo/PDF). O backend:

1. exige sessão Supabase, ambiente autorizado e perfil Administrador;
2. verifica MIME declarado, assinatura inicial do arquivo e limite de tamanho;
3. armazena o arquivo em bucket **privado**, com caminho prefixado pelo UUID do tenant;
4. registra apenas metadados no banco de dados;
5. recupera bytes exclusivamente no worker quando há disparo, checando que o arquivo pertence ao mesmo ambiente e tem o tipo exigido pelo template.

Nenhuma URL pública ou URL externa é processada para buscar mídia. Isso evita abrir uma superfície de SSRF no worker.

## Mapeamento

Cada campo tem uma chave qualificada por componente para evitar colisões entre nomes repetidos:

- `header.nome`
- `body.parameter_0`
- `buttons.0.tracking_code` (primeiro botão)
- `buttons.1.codigo` (segundo botão)
- `header.media`

O backend aceita chaves legadas pelo nome simples do parâmetro, mas o novo painel grava preferencialmente os nomes qualificados.

Seletores aceitos:
- `contact.name`, `contact.phone`, `contact.email`;
- `event.title`, `event.type`, `event.date`, `event.time`;
- `record.brand`, `record.model`, `record.plate` e demais dados em `record.details`;
- `contact.custom.CAMPO`, `event.custom.CAMPO` para valores dinâmicos;
- `literal:VALOR` para um texto ou parâmetro fixo.

Para mídia, selecione uma entrada da biblioteca (`asset:UUID`) ou use um seletor dinâmico cujo valor seja o **UUID de mídia do mesmo ambiente**, por exemplo `record.media_asset_id` ou `event.custom.media_asset_id`. A API pública pode carregar esses IDs nos dados adicionais do registro/agendamento. O campo `header.media` não aceita URL arbitrária.

### Como é enviado

O backend constrói o mesmo envelope da GoTo Messaging v2, preservando nome e idioma exatos do template. Envia:

- parte `request`: JSON com filename `request.json`, content-type `application/json`;
- parte(s) `attachments`: arquivos binários com nome idêntico ao referenciado em `header.components[].attributes.attachmentName`.

Parâmetros de texto entram em `header.parameters` e `body.parameters`. Botões variáveis entram em `buttons.components[].parameters`, respeitando a ordem dos botões do template. Os botões sem parâmetros não precisam ser enviados no payload.

## Envio real de teste

Na área do template escolhido, preencha:
1. número do destinatário no formato `+55...`;
2. valores de exemplo para todas as variáveis de texto e botão;
3. mídia de teste, caso o template exija uma;
4. confirmação de autorização do titular do número.

O endpoint `POST /api/goto/templates/:id/test` exige Administrador autenticado e limita a **cinco testes por hora e ambiente**. A resposta HTTP 201 e o `message_id` significam **aceitação pela API da GoTo**, não confirmação de entrega.

Teste com uma conta GoTo real, um número autorizado e modelos aprovados. O acompanhamento da entrega normal depende do webhook `DELIVERY_STATUS`.

## Implantação

1. Execute `database/001_init.sql`, `002_rebuild_queue.sql`, `003_public_integrations.sql`, `004_unified_reports.sql` e depois **`005_goto_rich_templates.sql`**, nessa ordem.
2. Confira se o bucket `brnotify-goto-media` foi criado como privado no Supabase Storage.
3. Configure o Nginx para aceitar ao menos 18 MB no caminho da API (`client_max_body_size 18m`), em razão do upload multipart de arquivos de até 16 MiB.
4. Publique backend, frontend e worker com o mesmo `TOKEN_ENCRYPTION_KEY` usado nas credenciais GoTo.
5. Conecte GoTo, sincronize os templates e faça testes dos três formatos de mídia e botões.
6. Não coloque `SUPABASE_SERVICE_ROLE_KEY` no frontend nem compartilhe dados de acesso em exemplos de código.

## Limitações conscientes

- Mídia de template: **um item no cabeçalho**, como no exemplo da documentação da GoTo. Mensagens simples com múltiplos anexos pertencem a outro fluxo e não estão disponíveis no agendador.
- A biblioteca oferece até 100 mídias por ambiente, listadas em páginas de 20.
- Um modelo com parâmetros obrigatórios sem mapeamento ou com mídia inválida falha de forma explícita, sem disparo improvisado.
- Suporte aos botões depende do conteúdo do template aprovado; nenhum botão interativo é inventado pelo BR Notify.
- O painel exibe a **estrutura textual** do template; a aparência final pode variar no aplicativo WhatsApp.
