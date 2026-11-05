# Biblioteca de modelos WhatsApp — BR Notify

Acesse em **GoTo Connect → Explorar biblioteca**. São **12 modelos sugeridos**, três para cada segmento: Automotivo, Clínicas, Pet shops e Genéricos.

## Funcionalidades
- Pesquisa e filtro por segmento, prévia com dados fictícios e recomendação de antecedência (30, 3 ou 1 dia).
- Copiar nome, corpo, cabeçalho textual e kit completo com nome Meta, idioma pt_BR, variáveis, exemplos, botões e instruções.
- Link para [WhatsApp Manager](https://business.facebook.com/wa/manage/message-templates/).
- Conferir template sincronizado da GoTo e aplicar mapeamento compatível preservando campos já configurados.
- Não cria nem aprova templates na Meta e não ativa automaticamente disparos.

## Modelos cadastrados
| Segmento | 30 dias | 3 dias | 1 dia |
|---|---|---|---|
| Automotivo | Revisão agendada | Confirmação com imagem e botões | Retirada de veículo com URL |
| Clínica | Consulta agendada | Orientações de exame em PDF | Confirmação de retorno |
| Pet shop | Banho e tosa | Consulta veterinária com imagem e botões | Retorno do pet |
| Genérico | Lembrete de compromisso | Confirmar presença com cabeçalho e botões | Orientações com PDF |

## Passo a passo
1. Abra a biblioteca e selecione o modelo. Copie o **kit completo**.
2. No WhatsApp Manager, crie um modelo com **nome idêntico**, idioma **Português (Brasil)** e categoria Utilidade somente se couber para uma transação agendada.
3. Reproduza corpo, cabeçalho (quando houver), exemplos de variáveis e botões na ordem indicada. Submeta à Meta.
4. Aguarde aprovação. O BR Notify não garante categoria, aprovação nem preço da mensagem.
5. Em GoTo Connect, clique **Sincronizar**. Volte ao modelo e clique **Verificar novamente**.
6. Se nome, idioma, estrutura de corpo e cabeçalho, variáveis e botões estiverem compatíveis, clique **Aplicar mapeamento sugerido**.
7. Confira dados personalizados e selecione a mídia em sua biblioteca privada antes do envio; faça um teste real pela integração GoTo.

## Restrições importantes
- A categoria **UTILITY** é sugestão, não classificação garantida pela Meta.
- Botões de resposta rápida devem ser aprovados na Meta. A resposta ao clique requer validação com o webhook de entrada GoTo; não presume confirmação automática.
- Para URL dinâmica, substitua o endereço seu-dominio.com por seu domínio HTTPS e disponibilize o sufixo em event.custom.url_suffix.
- IDs de mídia são específicos de cada empresa. O catálogo não vincula automaticamente arquivos.
- As antecedências (30/3/1 dias) são sugestões e não alteram as regras de lembretes existentes.
- Não é editor de templates nem biblioteca oficial da Meta.

## API interna
- GET /api/template-library: lista estática de modelos com 20 por página.
- GET /api/template-library/:id: informações completas.
- GET /api/template-library/:id/match: consulta compatibilidade com o template sincronizado do ambiente.
- POST /api/template-library/:id/apply: administrador autenticado, template APPROVED, mesmo nome e idioma, payload com template_id e overwrite:false.
- O tenant é obtido da sessão; o mapeamento rejeita estruturas diferentes e preserva valores existentes sem overwrite explícito.

## Documentação oficial
- [GoTo Messaging v2](https://developer.goto.com/guides/GoToConnect/18_HOW_useMessagingV2Api/)
- [Meta: gerenciar templates WhatsApp](https://whatsappbusiness.com/pt-br/blog/manage-message-templates-whatsapp-business-api/)
