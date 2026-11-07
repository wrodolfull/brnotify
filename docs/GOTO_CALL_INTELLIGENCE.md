# Etapa 3 — Inteligência e expansão GoTo Connect

A terceira etapa aproveita a fundação de eventos (etapa 1) e o motor de automações (etapa 2) para reagir a informações produzidas pela **GoTo Connect**, sem gerar transcrições próprias ou construir um Contact Center. O BR Notify continua limitado a **telefonia e WhatsApp**.

## Recursos disponíveis

### Insights de IA da GoTo

A API Call Events Report disponibiliza códigos de ação associados a análises da GoTo (quando o recurso está habilitado e licenciado): oportunidade de agendamento, agendamento realizado, oportunidade de agendamento não aproveitada, abordagem comercial, fechamento, apresentação sem fechamento e linguagem inadequada.

O BR Notify:
- consulta o **relatório detalhado** após notificações de `REPORT_SUMMARY` e `REPORT_SUMMARY_REVISION`;
- reconhece apenas códigos publicados na documentação e os transforma em eventos `call.ai.insight.detected`;
- guarda somente `signal_code`, categoria, existência de referência de transcrição e identificadores internos criptograficamente derivados; **não persiste** texto de transcrição, gravação, nome de atendente, resumo da IA ou conteúdo confidencial do relatório;
- apresenta os sinais em **Atividades → Insights e recados**;
- permite automações com qualquer insight ou um tipo específico. São permitidos aviso interno e webhook seguro. **Não** é permitido enviar WhatsApp automaticamente a partir de insights telefônicos.

### Correio de voz e recepcionista IA

A GoTo pode disponibilizar eventos explícitos de ciclo de vida de correio de voz: `VOICEMAIL_NEW`, `VOICEMAIL_READ` e `VOICEMAIL_DELETED`. A ação `VOICEMAIL_NEW` não é inferida da falta de atendimento.

Também são reconhecidos `AIR_SCHEDULING_INTERRUPTED` e `AIR_SCHEDULING_ERROR` relacionados a agendamentos da recepcionista IA.

Esses sinais ficam disponíveis no histórico e no editor de automações, quando o recurso existir na conta GoTo.

### Revisão de chamadas

O sistema agora indica:
- **Evidência de linha conectada**: o relatório de chamada recebida contém ao menos um participante `LINE` com estado `CONNECTED`;
- **Revisar atendimento**: o relatório de uma chamada recebida contém estados, mas não há evidência de linha conectada;
- **Não classificada**: faltam informações suficientes para análise.

**Revisar atendimento NÃO significa chamada perdida.** Transferências, URA, recepcionista IA, filas, ausência de estados e múltiplas pernas podem impedir uma interpretação simples. A classificação não é um gatilho para disparos automáticos. O acompanhamento de chamadas realmente perdidas e sem retorno exige evidência adicional de telefonia e validação com a GoTo.

## Configuração no sistema

1. Faça o merge e aplique **`database/013_goto_call_intelligence.sql` após a 012** no Supabase.
2. Implante API e worker atualizados e, depois, publique o frontend.
3. Confira em **GoTo Connect → Chamadas** se o monitoramento da etapa 1 está ativo.
4. Clique em **Ativar insights e correio de voz**. Essa ação cria uma assinatura específica para `REPORT_SUMMARY_REVISION` no canal de notificações do ambiente.
5. Faça uma ligação de teste com os recursos de IA/voicemail habilitados na GoTo e consulte **Atividades → Insights e recados**. Algumas análises podem ser disponibilizadas somente após o encerramento da chamada e posterior revisão do relatório.
6. Em **Automações**, escolha um gatilho de insight ou correio de voz, configure um aviso interno ou webhook, salve como rascunho e ative. Somente eventos novos após ativar uma regra serão processados.
7. Revise **Automações → Execuções** e o estado do webhook, se aplicável.

A assinatura é opt-in e independente do WhatsApp. Os novos eventos não ativam fluxos existentes automaticamente. O histórico de chamadas anterior à assinatura não é retroativamente reprocessado.

## API e armazenamento

- `POST /api/goto/calls/intelligence/activate`: habilita relatórios revisados apenas para administradores do ambiente com telefonia conectada e ativa.
- `GET /api/goto/calls/status`: inclui `intelligence_active`.
- `GET /api/goto/events?kind=intelligence`: histórico paginado com sinais mínimos.
- `GET /api/goto/calls`: inclui `attention_level`, `intelligence_checked_at`, `intelligence_signal_count`.
- As automações existentes passam a aceitar os novos gatilhos `call.ai.insight.detected`, `call.voicemail.new`, `call.voicemail.read`, `call.voicemail.deleted` e `call.receptionist.scheduling_issue`.

Eventos são idempotentes no banco por ambiente, origem e chave derivada do sinal. Quando a GoTo envia um relatório revisado, o worker consulta novamente seu conteúdo, incorpora novos sinais e descarta duplicados. O log segue retenção operacional de 90 dias da etapa 1. O acesso a dados permanece restrito por tenant e papéis existentes.

## Limitações conhecidas e validação necessária

- **Licenciamento**: a publicação de cada insight e de eventos de correio de voz depende da GoTo e dos produtos habilitados para a organização. Ausência de eventos não significa falha do BR Notify.
- **Estruturas dos relatórios**: o leitor aceita ações nos campos `actions` do relatório, participantes, perspectivas e estados e ignora qualquer tipo desconhecido. A existência da assinatura não garante a disponibilidade de todos esses campos na conta de teste. É obrigatória uma validação com eventos reais da GoTo.
- **Sem IA própria**: o BR Notify não chama um modelo de linguagem para classificar áudio. Apenas interpreta códigos explicitamente publicados pela GoTo.
- **Sem disparo automático de recuperação de chamadas**: não há evidência suficiente, apenas com `ENDING` e o resumo atual, para garantir que não houve atendimento nem retorno dentro de 24 horas. Até ser possível validar isso com fontes completas e testes de cenários de telefonia, o sistema oferece revisão e avisos, não disparos para o cliente.
- **Ações externas**: o status de execução do fluxo indica que a ação foi enfileirada, não necessariamente entregue. Veja o histórico da fila de WhatsApp/webhook quando aplicável.
- **Somente telefonia e WhatsApp**; nenhum canal adicional ou portal comercial para parceiros foi introduzido.

## Referências oficiais

- https://developer.goto.com/guides/GoToConnect/16_CallEventsReport/
- https://developer.goto.com/changelog/
- https://developer.goto.com/GoToConnect/

A PR inclui testes unitários de privacidade, filtros, sinais e classificação cautelosa; os testes PostgreSQL cobrem deduplicação, integração com regras, isolamento e fila de revisões. O CI **não** utiliza credenciais reais da GoTo.
