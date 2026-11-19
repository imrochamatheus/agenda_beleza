# D-006 — Desenvolvimento (T-1)

## 1. Tarefas concluídas e arquivos

- **T-1, smoke de banco:** `tests/integration/smoke-db.test.ts` (novo), conforme o contrato do `design.md` §3.2.
  - `describe('smoke de banco: conexão e SELECT 1 (CA-3 da D-006)')`, com o texto "CA-3 da D-006" para o `grep` no log da CI.
  - `beforeAll`: verifica `process.env.DATABASE_URL === urlDoWorker()` (nenhuma URL fixa) e abre **um** `pg.Client` com essa URL.
  - Teste 1: `SELECT 1 AS um` devolve uma linha com `um === 1`.
  - Teste 2: `SELECT current_database()` é igual a `nomeDoWorker()` e casa com `/_w\d{1,3}$/`.
  - `afterAll`: `cliente.end()`. Nenhuma escrita.
- Nenhum outro arquivo alterado. `tests/integration/health.test.ts` mantido (S-1). Sem mocks de banco.

## 2. Comandos e resultados

Ambiente: PostgreSQL do compose (`agenda_beleza-postgres-1`, `postgres:17`, healthy). Sem `.env` no checkout: `DATABASE_URL` e `TEST_DATABASE_URL` exportadas no shell com os valores do `.env.example`.

| Comando | Exit | Resultado |
|---|---|---|
| `npx vitest run --project integration tests/integration/smoke-db.test.ts` | 0 | 1 arquivo, 2 testes aprovados |
| Mutação M1: `toBe(1)` → `toBe(2)` | 1 | `AssertionError: expected 1 to be 2` (revertida) |
| Mutação M2: `toBe(nomeDoWorker())` → `toBe("agenda_beleza")` | 1 | `AssertionError: expected 'agenda_beleza_test_rht8hzleivn_w1' to be 'agenda_beleza'` (revertida) |
| `git diff --no-index` entre a cópia de segurança e o arquivo final | 0 | sem diferença: as mutações foram revertidas |
| `npm run lint` | 0 | sem avisos |
| `npm run typecheck` | 0 | sem erros |
| `npm run test:coverage` | 0 | 47 arquivos, 411 testes aprovados; linhas 100% (297/297), statements 100%, funções 100%, branches 99,33% |
| `npx vitest list --project integration --filesOnly` | 0 | `tests/integration/smoke-db.test.ts` incluído no projeto `integration` |

A M2 também mostra o nome real da base do worker: `<base>_r<exec>_w<N>`, nunca a de desenvolvimento nem a administrativa.

## 3. Testes e CAs

| Teste | CA |
|---|---|
| `smoke-db.test.ts` › "SELECT 1 devolve 1" | CA-3 (conexão e `SELECT 1`) |
| `smoke-db.test.ts` › "está conectado à base deste worker (sufixo _w<N>)" | CA-3 (URL do harness, base do worker) |
| asserção `DATABASE_URL === urlDoWorker()` no `beforeAll` | CA-3 (nenhuma URL fixa) |

A cobertura de `src/` não muda: o arquivo novo fica em `tests/`, fora do `coverage.include`.

## 4. Riscos e desvios

- Nenhum desvio do desenho.
- A verificação na CI (o teste aparece aprovado no log do job `testes`) depende de T-2 e T-4 (DevOps).
