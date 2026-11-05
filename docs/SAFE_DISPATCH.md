# Auditoria de disparos WhatsApp — BR Notify

## Resumo das falhas corrigidas

| Problema detectado | Correção |
|---|---|
| Worker antigo podia reivindicar até 20 envios sem pausa | Agora reivindica apenas um envio por ciclo e reserva a cadência em transação PostgreSQL |
| Dois ou mais workers poderiam iniciar envios simultâneos | Lock transacional global e linha de cadência compartilhada entre instâncias |
| Cada ambiente podia enviar várias mensagens sem intervalo | Tempo aleatório criptográfico de 1 a 5 segundos entre reservas do mesmo ambiente |
| Vários ambientes juntos podiam ultrapassar a cadência agregada | Intervalo global conservador de no mínimo 1 segundo entre reservas de mensagem |
| Disparo de teste não participava do controle do worker | Testes também reservam capacidade global e do ambiente; retorna HTTP 429 com Retry-After quando necessário |
| Retries sobrescreviam scheduled_at, distorcendo histórico | next_attempt_at é separado da data original de agendamento |
| 5xx/timeout poderiam reenviar algo já aceito pela GoTo | Resultado unknown, sem reenvio automático; requer conferência |
| 429 ignorava prazo indicado pelo provedor | Respeita Retry-After (segundos ou data HTTP), com backoff e cooldown compartilhado |
| Reenvio manual alterava a data original e não verificava consentimento | Só reenvia falha definitiva de agendamento atual/futuro, com consentimento válido |
| GoTo aceitava mensagem mas falha local podia perder messageId | Preserva o ID, marca unknown e permite reconciliação com webhook de entrega |

## Como funciona a cadência

A reserva ocorre **antes da requisição à GoTo**:
- Cada ambiente recebe um intervalo aleatório entre **1.000 e 5.000 ms**, com randomização por crypto.randomInt.
- A aplicação como um todo tem uma reserva por segundo no mínimo, evitando aumento inesperado de taxa quando novas empresas são cadastradas.
- Não é permitido outro envio simultâneo do mesmo ambiente enquanto um anterior estiver em estado processing.
- Várias instâncias do worker consultam **a mesma tabela PostgreSQL**, de modo que adicionar processos não contorna os limites.
- Em 429 a fila adia as próximas tentativas por no mínimo 30 segundos, ou mais conforme Retry-After (até 1 hora); a tentativa rejeitada usa backoff exponencial e nova data em next_attempt_at.
- Erros 5xx, timeout, corpo inválido após envio ou confirmação incompleta são **indeterminados**, sem reenvio automático. Verifique junto à GoTo antes de tentar novamente.
- Mensagens em processing depois de interrupção do worker tornam-se unknown após 3 minutos, sem auto-reenvio.

**Limites de taxa não equivalem à autorização da Meta/WhatsApp.** A GoTo documenta um limite padrão de API de 10 requisições/segundo, mas a capacidade real depende da conta, qualidade do número, classificação de template, consentimento, feedback negativo e políticas da Meta. O intervalo aleatório não é mecanismo de evasão de políticas e não garante ausência de bloqueios.

Fonte oficial de rate limit: https://developer.goto.com/guides/References/Ref-Rate-Limits/

## Implantação e migração (obrigatória)

1. Pare temporariamente o worker BR Notify na VPS, para evitar que envie mensagens com o código antigo durante a transição.
2. No SQL Editor do Supabase, após 001 a 005, execute **database/006_safe_message_dispatch.sql**.
3. Atualize o código do backend e do worker na VPS (mesma versão de release). Reinicie o processo do worker.
4. Confirme que public.goto_send_pacing existe, está sem permissões para anon/authenticated, e que scheduled_messages tem next_attempt_at.
5. Faça testes pequenos com um número autorizado, usando um template aprovado, e confira os status em Disparos e Relatório geral.
6. Verifique logs de 429/unknown e as mensagens com erro antes de habilitar importações ou campanhas maiores.

A migração preenche next_attempt_at com scheduled_at para os registros antigos. Se alguma tentativa já havia alterado scheduled_at na versão anterior, a data original dessa tentativa histórica não pode ser reconstruída automaticamente.

## Operação e capacidade

O limite global conservador de ~1 mensagem/segundo equivale teoricamente a até 60 reservas/minuto. É **apenas teto teórico**, não promessa de throughput ou tempo de entrega; as reservas por ambiente, tempo de rede, OAuth e worker reduzem a taxa real. Uma grande fila pode levar bastante tempo. Acompanhe o volume diário e a pontualidade; para escalar posteriormente, use limites homologados com a GoTo e aumente a capacidade conscientemente.

O worker mantém **dois loops independentes** no mesmo processo: um consulta a fila de mensagens aproximadamente a cada 800 ms; o outro executa manutenção, regras e webhooks de integração em ciclos de aproximadamente 10 segundos. Assim, um webhook externo lento não impede a consulta da fila de WhatsApp, embora o tempo de envio também dependa da GoTo e da rede. A aplicação não usa Supabase Edge Functions.

## Testes incluídos

- Unitários: jitter entre 1–5s, Retry-After, backoff e classificação de resultado incerto.
- PostgreSQL em CI: migração 006, concorrência entre dois workers, FIFO por data programada, integridade de scheduled_at, cadência global/tenant e pausa por 429.
- TypeScript, testes de regressão anteriores e build.

**Pendente:** homologar com a GoTo real e confirmar os limites específicos da conta. A auditoria é estática e baseada em CI; não substitui um teste de carga controlado e testes de aceitação em produção.
