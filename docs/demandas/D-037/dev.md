# D-037 (E6.3) - dev.md

## Tarefas
T-1 domínio `src/domain/assinatura/` (maquina-estados, mes-civil, capacidades, estado-efetivo, tipos, index) + `DIAS_CARENCIA = 3` em `src/config/plano.ts`.
T-3 `src/server/repos/assinatura.ts` (+ `Repos.assinaturas`, `repoAssinaturaSistema`), cabeçalho de travas em `repos/servico.ts`, `tests/support/assinatura.ts`.
T-4 `src/server/assinatura/` (`tipos`, `servico` = `aplicarEventoAssinatura`, `prazos` = `processarPrazos`, `estado-operacional` = `estadoEfetivoDoSalao` + tabela, `config`).
T-5 `src/worker/handlers/assinatura-prazos.ts` real (+ teste; stub removido de `handlers.test.ts`).
T-6 `tests/integration/assinatura/{transicoes,idempotencia,prazos,estado-efetivo,concorrencia}.test.ts`; unitários ao lado do domínio.
T-7 README (CLAUDE.md fica com o líder). Sem migração (parecer em dba.md).

## Desvios
- `travar` sem `assinaturaId` resolve o alvo sem trava e trava por id em seguida: num único comando, o READ COMMITTED reavaliava só a linha travada e perdia a corrida cancelamento x aprovada (aprovada virava `sem_assinatura`). Achado pelo teste de concorrência.
- Transições do mesmo instante (relógio injetado) têm `ocorrida_em` igual: a ordem entre duas passagens da mesma execução não é observável por data; testes comparam sem ordem.
- Triggers de somente-inserção: reuso do `tests/integration/db/append-only.test.ts` existente (CA-8), sem arquivo novo.
- Sem teste E2E (sem UI). `agendamentoDisponivel`/`politicaDeOperacao` intactos (E6.4).

## Riscos
R-1..R-4 do design mantidos. `ocupada` no job adia a transição ao ciclo seguinte (5 min).
