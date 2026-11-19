# D-006: DevOps (T-2, T-3; T-4 pendente de autorização)

Autor: devops. Entradas: `docs/demandas/D-006/{issue-5,spec,design}.md`. Branch `feat/d-006-ci` (base `bc163e7`). Nada foi commitado, publicado ou aberto como PR.

## 1. O que mudou e por quê

| Arquivo | Mudança |
|---|---|
| `.github/workflows/ci.yml` | **Novo.** Workflow `CI` conforme o contrato do design §3.1: gatilhos `pull_request` e `push` em `main`; `permissions: contents: read` só no topo; `concurrency` por PR/ref com `cancel-in-progress: true` (K-4); `env` global `NEXT_TELEMETRY_DISABLED=1` e `TZ=UTC`; seis jobs paralelos sem `needs` (`lint`, `typecheck`, `build`, `testes`, `e2e`, `docker`), todos com `timeout-minutes` (10/10/15/20/20/20). Jobs de Node: `checkout@v7` (`persist-credentials: false`) → `setup-node@v7` (`node-version-file: .nvmrc`, `cache: npm`) → `npm ci` → `npm run db:generate` → gate. `testes`: service `postgres:17` (`POSTGRES_DB=agenda_beleza`, healthcheck TCP), `docker exec <service> createdb -U agenda agenda_beleza_test`, `db:migrate:deploy`, `test:coverage`, upload `cobertura`. `e2e`: versão do Playwright lida do lock via `jq`, `actions/cache@v6` em `~/.cache/ms-playwright`, `npx playwright install --with-deps chromium`, `npm run test:e2e`, uploads `playwright-report` e `playwright-traces`. `docker`: `docker compose config` e `docker build --target final --tag agenda-beleza:ci .`, sem login nem push. Uploads com `if: ${{ !cancelled() }}`; nenhum `continue-on-error`. `workflow_dispatch` não incluído (não é necessário para nenhum CA). |
| `README.md` | Nova seção `## CI` (depois de "Testes", antes de "Credenciais"): tabela job → comando local → artefato, nomes fixos dos checks, como baixar artefatos, "nenhum segredo necessário", `postgres:17` igual ao compose, concorrência e a pendência K-1 com as opções (a), (b), (c). Item "Privilégio" de "Banco de teste" reescrito para a CI real (superusuário do service, `createdb` no container). |
| `CLAUDE.md` | Linha 7: a D-006 (E0.3) adicionou a CI; a fila segue pendente (E0.7). Linha 77: o job `e2e` roda `install --with-deps chromium` com cache e `npm run test:e2e` (uma compilação no job). |

Arquivos intocados: `.github/workflows/claude*.yml`, `Dockerfile`, `docker-compose.yml`, `.env.example`, configs de Vitest/Playwright, `src/`, `tests/` (o `smoke-db.test.ts` é do desenvolvedor).

### Versões das ações (confirmadas em 2026-11-18)
`gh api repos/actions/<x>/releases/latest` e `gh api repos/actions/<x>/git/ref/tags/v<N>`:

| Ação | Última release | Tag major usada | Existe |
|---|---|---|---|
| `actions/checkout` | v7.0.1 | `v7` | sim (`refs/tags/v7`) |
| `actions/setup-node` | v7.1.0 | `v7` | sim |
| `actions/cache` | v6.1.0 | `v6` | sim |
| `actions/upload-artifact` | v7.0.2 | `v7` | sim |

Os `action.yml` dessas tags (lidos via `gh api .../contents/action.yml?ref=vN`) têm os inputs usados (`node-version-file`, `cache`, `persist-credentials`, `if-no-files-found`, `retention-days`) e rodam em `node24`. Nenhuma troca de major foi necessária.

### Ferramenta nova
Nenhuma no repositório. Validação de sintaxe com `actionlint` 1.7.12 via imagem Docker descartável (`rhysd/actionlint:latest`), sem dependência nem arquivo novo, conforme o design §1.3. Inclui shellcheck dos blocos `run:`.

## 2. Variáveis de ambiente
Nenhuma variável nova no `.env.example` nem em `src/server/env.ts`. O job `testes` define `DATABASE_URL` (`…/agenda_beleza`) e `TEST_DATABASE_URL` (`…/agenda_beleza_test`, 18 caracteres) com as credenciais de desenvolvimento do `.env.example`, num container efêmero. Nenhum `secrets.` e nenhum `*_ADAPTER`.

## 3. Como reproduzir localmente
Os mesmos comandos de cada job estão no README, seção "CI". A simulação abaixo foi feita numa **cópia limpa** da árvore (arquivos versionados + não ignorados, sem `.env`, sem `node_modules`) no scratchpad, para não interferir no `node_modules` nem no PostgreSQL do compose usados em paralelo pelo desenvolvedor, com `CI=true TZ=UTC NEXT_TELEMETRY_DISABLED=1` e Node 24.21.0 (`nvm use`).

```bash
# lint / typecheck / build
npm ci && npm run db:generate && npm run lint && npm run typecheck && npm run build
# testes: PostgreSQL igual ao service (porta 55432 só para não colidir com o compose)
docker run -d --rm --name d006-ci-pg -e POSTGRES_USER=agenda -e POSTGRES_PASSWORD=agenda_dev \
  -e POSTGRES_DB=agenda_beleza -p 55432:5432 \
  --health-cmd "pg_isready -h 127.0.0.1 -U agenda -d agenda_beleza" postgres:17
docker exec d006-ci-pg createdb -U agenda agenda_beleza_test
export DATABASE_URL=postgresql://agenda:agenda_dev@localhost:55432/agenda_beleza
export TEST_DATABASE_URL=postgresql://agenda:agenda_dev@localhost:55432/agenda_beleza_test
npm run db:migrate:deploy && npm run test:coverage
docker stop d006-ci-pg
# e2e (porta 3000 livre)
npx playwright install chromium && npm run test:e2e
# docker
docker compose config && docker build --target final --tag agenda-beleza:ci . && docker image rm agenda-beleza:ci
```

## 4. Evidências (2026-11-18)

| Comando | Exit | Resumo |
|---|---|---|
| `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest -no-color -verbose .github/workflows/ci.yml` | 0 | `Found total 0 errors` |
| `grep -n 'secrets\.'` / `'_ADAPTER'` / `continue-on-error` / `'docker push\|push: true\|login-action\|packages:'` em `ci.yml` | sem ocorrências | CA-4, CA-8, CA-9 |
| `grep -nE 'node-version(:\|-file)'` | 5 ocorrências, todas `node-version-file: .nvmrc` | CA-5(a) |
| `grep -c timeout-minutes` | 6 (um por job) | CA-10 |
| `git diff --stat main -- .github/workflows/claude.yml .github/workflows/claude-code-review.yml` | 0, vazio | CA-11 |
| `npm ci` | 0 | `found 0 vulnerabilities` |
| `npm run db:generate` | 0 | |
| `npm run lint` | 0 | |
| `npm run typecheck` | 0 | |
| `npm run build` | 0 | rotas `/`, `/_not-found`, `/api/health` |
| service equivalente `postgres:17` | healthy | |
| `docker exec … createdb -U agenda agenda_beleza_test` | 0 | |
| `npm run db:migrate:deploy` | 0 | `All migrations have been successfully applied.` |
| `npm run test:coverage` | 0 | `Test Files 47 passed (47)`, `Tests 411 passed (411)`, `Lines: 100% (297/297)`; `coverage/` com `index.html`, `lcov.info`, `coverage-summary.json`. `vitest list --filesOnly --project integration` inclui `tests/integration/smoke-db.test.ts` (versão do desenvolvedor no momento da cópia) |
| `npx playwright install chromium` | 0 | sem `--with-deps` (exige sudo localmente; na CI o runner tem sudo) |
| `npm run test:e2e` | 0 | `1 passed` (`mobile-chromium › e2e/smoke.spec.ts`), `playwright-report/index.html` gerado |
| `docker compose config` (sem `.env`) | 0 | `image: postgres:17` |
| `docker build --target final --tag agenda-beleza:ci .` | 0 | imagem removida em seguida |

Logs completos no scratchpad da sessão (`ci-sim/../log-*.txt`), fora do repositório.

## 5. Riscos e pendências

- **T-4 (execução real no GitHub):** depende da autorização do usuário para push e PR. Passos: commit dos arquivos da D-006 (incluindo o `smoke-db.test.ts` e o `dev.md` do desenvolvedor), `git push -u origin feat/d-006-ci`, `gh pr create --base main`, acompanhar `gh pr checks <n> --watch` até os 6 checks `pass`, conferir os artefatos `cobertura` e `playwright-report` (`gh run view <id> --json artifacts` ou `gh run download <id> -D <scratchpad>`), registrar aqui o número do PR, o ID e o SHA do run verde.
- Não verificado localmente (só no run real): `--with-deps` do Playwright (apt no runner), o `job.services.postgres.id` do `docker exec` e o cache do npm/Playwright (hit no segundo run).
- **K-1:** proteção de `main` indisponível no plano atual; decisão do usuário (registrada no README).
- **K-7:** limite de pull anônimo do Docker Hub (`toomanyrequests`) é transitório: reexecutar o job.
- Observação para o líder: o item "Sessão de superusuário aberta numa base de worker" do README ("Banco de teste") ainda cita "(CI, por exemplo)" como caso de papel não superusuário. Na CI desta demanda o papel é superusuário, então o exemplo ficou impreciso. Não alterei porque o design restringe a T-3 ao item "Privilégio"; sugiro trocar o exemplo numa próxima edição do README (ou autorizar o ajuste de uma linha agora).
