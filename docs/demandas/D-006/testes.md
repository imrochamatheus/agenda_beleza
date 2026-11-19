# D-006 — Testes (T-5)

Autor: tester. Entradas: `docs/demandas/D-006/{issue-5,spec,design,dev,devops}.md`. Plano seguido: `design.md` §8.2 (V-1 a V-4).

## Rodada 1 (2026-11-18/19)

### Ambiente
- Branch `feat/d-006-ci`, SHA `d2658cc6f7fb364400949bc47bf22bc3c13b12e4` (PR principal #61, aberto, não mesclado).
- Local: Node 24.21.0 (`nvm use`), PostgreSQL do compose (`postgres:17`, healthy), sem `.env`; `DATABASE_URL` e `TEST_DATABASE_URL` exportadas com os valores do `.env.example`. Gates locais rodados num `git worktree` limpo de `feat/d-006-ci` no scratchpad (`npm ci` do zero), removido ao final.
- CI: runners `ubuntu-latest` do GitHub Actions. `gh` 2.4.0 (consultas pela API REST).
- PR descartável: #62 (`tmp/d-006-validacao` → `main`, rascunho), autorizado pelo usuário. Fechado sem merge e branch apagada (ver "Limpeza").

### Runs usados como evidência

| Run | Evento | SHA | Branch | Conclusão | Uso |
|---|---|---|---|---|---|
| [44442844352](https://github.com/imrochamatheus/agenda_beleza/actions/runs/44442844352) | pull_request | `d2658cc` | `feat/d-006-ci` (PR #61) | success | V-1: CA-1, 3, 4, 6, 7, 9, 10 |
| [44442523728](https://github.com/imrochamatheus/agenda_beleza/actions/runs/44442523728) | pull_request | `cbe8968` | `feat/d-006-ci` (PR #61) | success | V-1 (run anterior, 6/6 success) |
| [44443235038](https://github.com/imrochamatheus/agenda_beleza/actions/runs/44443235038) | pull_request | `97b662c` | `tmp/d-006-validacao` (PR #62) | failure | V-2 (R1): CA-2, 6, 8 |
| [44443525818](https://github.com/imrochamatheus/agenda_beleza/actions/runs/44443525818) | pull_request | `c85c1e8` (c1) | `tmp/d-006-validacao` (PR #62) | **cancelled** | V-2: CA-5(d), primeiro push |
| [44443622942](https://github.com/imrochamatheus/agenda_beleza/actions/runs/44443622942) | pull_request | `698a8b6` (c2) | `tmp/d-006-validacao` (PR #62) | cancelled (manual, `gh run cancel`, depois da evidência) | V-2: CA-5(d), segundo push |

Jobs do run verde 44442844352 (`gh api …/runs/44442844352/jobs --jq '.jobs[]|{name,conclusion}'`): `lint` success, `typecheck` success, `build` success, `testes` success, `e2e` success, `docker` success. Os check-runs do SHA `d2658cc` (`gh api …/commits/d2658cc…/check-runs`) mostram os 6 checks, mais `claude-review` (não é gate).

Jobs do R1 44443235038: `lint` success, `typecheck` success, `build` success, `docker` success, `testes` **failure**, `e2e` **failure**; workflow `failure`.

### Resultado por CA

| CA | Resultado | Evidência |
|---|---|---|
| CA-1 | PASSOU | Run 44442844352: 6 checks `success` no SHA `d2658cc`. Logs: `lint` → `> eslint . --max-warnings=0`; `typecheck` → `> tsc --noEmit`; `build` → `> next build`, `✓ Compiled successfully`; `testes` → `> vitest run --coverage`, `Test Files 47 passed (47)`, `All files | 100 | 99.33 | 100 | 100`; `e2e` → `✓ 1 [mobile-chromium] › e2e/smoke.spec.ts:3:1 …`, `1 passed (2.6s)`. |
| CA-2 | PASSOU | PR #62, run 44443235038. `src/lib/descartavel-ca2.ts` (65 linhas, 62 executáveis, sem teste; lint e typecheck locais com exit 0 antes do push). Log de `testes`: `All files | 83.1 | 99.33 | 98.82 | 82.72` e `ERROR: Coverage for lines (82.72%) does not meet global threshold (90%)`, `##[error]Process completed with exit code 1.` (os 47 arquivos de teste passaram: foi o limiar que reprovou). `lint`, `typecheck`, `build` = success. `gh pr view 62 --json state,mergedAt,closed` → `{"closed":true,"mergedAt":null,"state":"CLOSED"}`. |
| CA-3 | PASSOU | Arquivo `tests/integration/smoke-db.test.ts`: usa `process.env.DATABASE_URL` conferida contra `urlDoWorker()` (sem URL fixa), verifica `SELECT 1` = 1 e `current_database()` = `nomeDoWorker()` com `/_w\d{1,3}$/`; só leitura. CI (44442844352): `✓ integration tests/integration/smoke-db.test.ts (2 tests)`; o job só tem o service `postgres`. Local: `npx vitest run --project integration tests/integration/smoke-db.test.ts` → `Test Files 1 passed (1)`, `Tests 2 passed (2)`. |
| CA-4 | PASSOU | Run 44442844352, job `docker` success: `Run docker compose config` (exit 0) e `#21 naming to docker.io/library/agenda-beleza:ci done`. `grep -nE "docker push\|push: *true\|docker/login-action\|packages: *write" .github/workflows/ci.yml` → nada. |
| CA-5 | PASSOU | (a) `grep -nE "node-version(:\|-file)"` → 5 ocorrências, todas `node-version-file: .nvmrc` (uma por job de Node). (b) `permissions: contents: read` só no topo (linhas 13-14); nenhum job declara `permissions`. (c) `group: ${{ github.workflow }}-${{ github.event.pull_request.number \|\| github.ref }}`, `cancel-in-progress: true`. (d) c1 pushado, run 44443525818 `in_progress`; ~25 s depois c2 pushado (run 44443622942, criado 02:20:47Z); o run de c1 terminou `cancelled` às 02:21:06Z, com `testes`, `e2e`, `docker` = cancelled (`lint`/`typecheck`/`build` já tinham terminado success). |
| CA-6 | PASSOU | Run verde 44442844352 (`gh run download`): `cobertura/` com `coverage-summary.json` (`lines` 297/297, 100%), `lcov.info`, `index.html`; `playwright-report/index.html`. Run vermelho 44443235038: `cobertura/` com os três arquivos (`lines` 297/359 = 82,72%, `lcov.info` contém `descartavel-ca2`), log `Artifact cobertura has been successfully uploaded!`; `playwright-report/` presente; `playwright-traces/` com 3 `trace.zip` (tentativa inicial, `retry1`, `retry2`) da asserção trocada para `toHaveTitle('Titulo Errado CA-6')` (`Expected: "Titulo Errado CA-6"`, `1 failed`). |
| CA-7 | PASSOU | (a) `ci.yml:81 image: postgres:17` = `docker-compose.yml:15 image: postgres:17`; healthcheck `pg_isready -h 127.0.0.1 -U agenda -d agenda_beleza`. (b) Log 44442844352: `Applying migration 20261118000100_reserva_exclusion` … `All migrations have been successfully applied.`, antes de `> vitest run --coverage`. (c) `TEST_DATABASE_URL` → `agenda_beleza_test` (18 caracteres) ≠ `agenda_beleza`; criada antes pelo passo `docker exec "<id>" createdb -U agenda agenda_beleza_test` (exit 0); nenhuma ocorrência do erro de guarda que nomeia `TEST_DATABASE_URL`. |
| CA-8 | PASSOU | Todo job de Node: `npm ci` → `npm run db:generate` → gate; `testes`: `npm ci → db:generate → createdb → db:migrate:deploy → test:coverage`. `grep -n continue-on-error ci.yml` → nada (os uploads usam `if: ${{ !cancelled() }}`). R1 44443235038: workflow `failure` com `testes` e `e2e` vermelhos. |
| CA-9 | PASSOU | `grep -n "secrets\." ci.yml` → nada; `grep -n _ADAPTER ci.yml` → nada. O único segredo do repositório (`gh api …/actions/secrets`) é `CLAUDE_CODE_OAUTH_TOKEN`, usado só por `claude.yml` e `claude-code-review.yml`; o `ci.yml` não o referencia, e o run 44442844352 passou. |
| CA-10 | PASSOU (parte estática) / **PENDENTE (líder, T-6)** | `on: pull_request` e `push: branches: [main]`; `timeout-minutes` em 6 de 6 jobs (10/10/15/20/20/20); `setup-node` com `cache: npm` em todos os jobs de Node (log: `Cache restored from key: node-cache-Linux-x64-npm-…`); `actions/cache@v6` em `~/.cache/ms-playwright` com chave pela versão do lock (log: `Cache restored from key: playwright-Linux-1.65.1`). O run do evento `push` no SHA de merge em `main` só existe depois do merge: registro a cargo do líder. |
| CA-11 | PASSOU | `git diff --stat origin/main -- .github/workflows/claude.yml .github/workflows/claude-code-review.yml` → vazio. Diff total de `origin/main...feat/d-006-ci`: `ci.yml`, `CLAUDE.md`, `README.md`, `docs/demandas/D-006/*`, `tests/integration/smoke-db.test.ts`. |
| CA-12 | PASSOU | README `## CI` (linhas 97-115): tabela job → comando local → artefato, nomes fixos dos 6 checks, download (`gh run download … -n cobertura`), "Nenhum segredo necessário", `postgres:17` igual ao compose, concorrência e a pendência de proteção de `main` com as opções (a)/(b)/(c). `CLAUDE.md:7` cita a CI da D-006 ("There is no queue yet (E0.7)"); `CLAUDE.md:77` descreve o job `e2e`. |
| CA-13 | PASSOU | Worktree limpo de `d2658cc`: `npm ci` 0 (`found 0 vulnerabilities`), `db:generate` 0, `lint` 0, `typecheck` 0, `build` 0, `db:migrate:deploy` 0 (`3 migrations found`, base de dev já migrada; a aplicação em base limpa está no log da CI, CA-7 b), `test:coverage` 0 (`Test Files 47 passed (47)`, `Tests 411 passed (411)`, `Lines: 100% (297/297)`), smoke-db 0, `test:e2e` 0 (`1 passed`). Porta 3000 livre. |

### Gates e cobertura
- Local (comando oficial `npm run test:coverage`): linhas **100%** (297/297), statements 100%, funções 100%, branches 99,33%. ≥ 90%: sim.
- CI (run 44442844352): mesma tabela (`All files | 100 | 99.33 | 100 | 100`).
- Exclusões de cobertura: não alteradas por esta demanda (`vitest.config.ts` fora do diff).
- Teste novo (`smoke-db.test.ts`): verifica comportamento (valor do `SELECT 1` e nome da base do worker), não só executa linhas; o desenvolvedor registrou duas mutações que o derrubam (dev.md §2).

### Regressão das invariantes
A demanda não toca código de produção, schema nem migrações. A suíte completa (47 arquivos, 411 testes, incluindo isolamento entre salões e concorrência da D-005) passou localmente e na CI contra PostgreSQL real, e as três migrações (com `btree_gist`/`reserva_sem_sobreposicao`) aplicaram numa base limpa no service da CI.

### Observações (não são defeitos)
- O `claude-code-review.yml` terminou `failure` nos runs dos commits vazios c1/c2 do PR #62 (44443525821, 44443622920). Não é gate desta demanda (spec §6) e o arquivo está fora do escopo (CA-11).
- Com `retries: 2` na CI, o E2E quebrado gerou 3 traces; o risco K-3 (instabilidade escondida) segue para a E4.4.
- K-1 (proteção de `main` indisponível no plano) continua como decisão do usuário, registrada no README.

### Limpeza do PR descartável
- `gh pr close 62 --delete-branch` → `CLOSED`, `mergedAt: null`.
- `git ls-remote --heads origin 'tmp/d-006-*'` → vazio; branch local `tmp/d-006-validacao` apagada; `git fetch --prune` sem refs `tmp`.
- Runs pendentes da branch cancelados; nenhum arquivo do PR descartável está em `feat/d-006-ci` ou `main` (`src/lib` só tem `site.ts` e `site.test.ts`; `e2e/smoke.spec.ts` com `toHaveTitle('Agenda Beleza')`).
- Artefatos e logs baixados só no scratchpad da sessão, fora do repositório.

### Defeitos
Nenhum defeito aberto nesta rodada.

### Veredito
**APROVADO.** CA-1 a CA-9 e CA-11 a CA-13 passaram com evidência; CA-10 passou na parte estática e fica com a evidência do run de `push` em `main` pendente do líder (T-6, depois do merge autorizado). Gates locais e da CI verdes, cobertura de linhas 100%, nenhum defeito crítico ou alto.
