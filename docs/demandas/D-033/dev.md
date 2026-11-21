# D-033 (E8.1) — dev.md

## Tarefas e arquivos
- T-1: `src/server/auditoria/{tipos,sanitizar}.ts` (+ `sanitizar.test.ts`), `exigirAdmin` em `src/server/tenant/context.ts` (+ teste).
- T-2: `src/server/repos/auditoria.ts`, `Repos.auditoria` (`repos/index.ts`), `src/server/auditoria/registrar.ts` (+ `registrar.test.ts`), `tests/support/auditoria.ts`.
- T-3: `tests/integration/auditoria/{auditoria,estatico}.test.ts` (lint não precisou de ajuste).
- T-4: cabeçalho de travas em `repos/servico.ts` (auditoria por último) e seção "Auditoria" no README. CLAUDE.md fica com o líder.

## Gates
lint 0 avisos; typecheck ok; build ok; `test:coverage` 99,46% de linhas (módulo 100%); `test:e2e` 171 passed (sem `.env`, porta 3000 livre); auditoria integração 10x seguidas (19 testes) sem falha; unitários em `TZ=UTC` e `America/Sao_Paulo` passam.

## Testes por CA
CA-1, CA-2 (FK 23503, >16 KiB e segredo revertem a mutação de `salao.nome`), CA-3 (P0001 em UPDATE/DELETE/TRUNCATE + estático sem ação/rota/UPDATE/DELETE), CA-4 (dentro da transação com rollback e no `catch`), CA-5, CA-6, CA-7 (unit), CA-8, CA-9, CA-10 (20 paralelas + `FOR NO KEY UPDATE`), CA-11 (estático), CA-12 (loop de fusos).

## Desvios / riscos
- `exigirAdmin` devolve o `usuarioId` e exige objeto congelado (como as fábricas).
- `ENTIDADES_AUDITAVEIS` não contém `login`: as ações `login.*` incidem na entidade `usuario` (o teste de vocabulário reflete isso).
- Chave `otpcode`/`codigootp` na lista exata, conforme design. R-2 (PII em valor livre) segue por convenção.
- A tabela é insert-only: os testes usam `entidade_id` próprio e não assumem contagem global.
