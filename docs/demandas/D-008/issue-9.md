# Issue #9 — Executar a fila de mensagens com pg-boss em um worker separado

## Objetivo
Ter um processo worker independente que consome jobs do PostgreSQL com novas tentativas e backoff.

## Origem e contexto
PLAN.md, "Mensagens pelo WhatsApp" (fila no PostgreSQL processada por worker separado); CLAUDE.md, "Required stack". Atual: inexistente.

## Escopo
`src/worker/main.ts` (substitui o stub de E0.2): registro de handlers, retry por env (`QUEUE_RETRY_LIMIT`, `QUEUE_RETRY_DELAY_SECONDS`, `QUEUE_RETRY_BACKOFF`), encerramento gracioso, jobs agendados (usados por E6.3, E7.1 e E4.2), heartbeat em log, job de exemplo.

## Especificação
Decidido:
- RN-1: o worker é um processo separado do servidor Next.js e usa o mesmo banco; o pg-boss fica no schema `pgboss`, separado do `public` gerido pelo Prisma.
- RN-2: número de tentativas, atraso e backoff configuráveis por env; os testes usam atraso de cerca de 1 s.
- RN-3: falha de um job não derruba o worker.
- RN-4: SIGTERM chama `stop({ graceful: true })` com timeout (25 s) menor que o `stop_grace_period` do compose (30 s).
- RN-5: versão do pg-boss fixada; payload do job contém apenas IDs (sem dados pessoais); as tabelas do pg-boss não são fonte do histórico de tentativas.
- RN-6: o worker não expõe HTTP nem healthcheck; o heartbeat em log basta na v1.
Sugestão (não decidida): padrões de 5 tentativas e atraso inicial de 30 s.

## Critérios de aceite
- [ ] CA-1: Dado um job enfileirado pelo app, quando o worker está em execução, então o handler correspondente o processa.
- [ ] CA-2: Dado um handler que falha nas 2 primeiras execuções, quando o job é processado, então ocorrem 3 tentativas com intervalos crescentes e o job termina concluído.
- [ ] CA-3: Dado um handler que sempre falha, quando se esgotam as tentativas, então o job fica em estado de falha consultável e o worker continua processando outros jobs.
- [ ] CA-4: Dado um job longo em andamento, quando o worker recebe SIGTERM (`docker compose stop worker` ou sinal no processo filho em teste de integração), então o job conclui e o processo sai com código 0 antes de 30 s.

## Validação
Testes de integração com PostgreSQL real (pg-boss real, processo filho para CA-4). Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #2 (E0)
- Bloqueada por: #6 (E0.4)
- Bloqueia: #40 (E6.3), #31 (E7.1)
- Relacionadas: #31 (E7.1), #40 (E6.3)

## Entregáveis
- src/worker/main.ts (substitui o stub: bootstrap pg-boss no schema pgboss, registro de handlers, SIGTERM gracioso)
- src/server/queue/client.ts (enfileirar com singletonKey, uso pós-commit, jobs agendados)
- src/worker/handlers/registry.ts e política de retry (retryLimit, retryDelay, retryBackoff) por env
- tests/integration/worker/*.test.ts com pg-boss real (CA-1..CA-3)
- stop_grace_period 30s no serviço worker do compose e teste de SIGTERM com job em andamento
- Handlers assinatura-prazos.ts, whatsapp-reserva.ts e reconciliar-mensagens.ts criados como stubs registrados (E6.3 e E7.1 os preenchem)

## Papel responsável
- Desenvolvedor
- Apoio/revisão: DevOps, DBA

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E0.7`. Prioridade P0, tamanho M (Project #3)._
<!-- agenda-beleza-backlog:E0.7 -->
