# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The project is scaffolded (D-002): Next.js 16 (App Router) + TypeScript, ESLint, Vitest with coverage and Playwright, with a placeholder home page. D-003 (E0.2) added Prisma 7 (no models yet), the env schema, `GET /api/health`, a worker stub and `docker-compose` (app, worker, postgres). D-004 (E0.4) added the domain schema and migrations, including the `reserva_sem_sobreposicao` exclusion constraint. D-005 (E0.5) added server-side salon scoping: `src/server/tenant/` (contexts, `defineAcao`, session, operation policy), tenant-scoped repositories in `src/server/repos/` (the only place allowed to import the Prisma client, enforced by lint), and the integration harness in `tests/support/` (a template database plus one database per Vitest worker, and factories for two salons). D-006 (E0.3) added the GitHub Actions CI (`.github/workflows/ci.yml`: six parallel jobs `lint`, `typecheck`, `build`, `testes`, `e2e` and `docker`, running the same commands as below). D-007 (E0.6) added the integration ports and adapters in `src/server/integrations/`, selected by `EMAIL_ADAPTER`, `WHATSAPP_ADAPTER`, `MP_ADAPTER` and `TURNSTILE_ADAPTER` and obtained only through `registry.ts` (enforced by lint): simulated adapters for all four (state in `email_log` and the `sim_*` tables), real SMTP e-mail (`nodemailer`) and Turnstile, `NaoImplementado` stubs for real Mercado Pago (E6.6) and WhatsApp (E7.2), which startup still refuses, and the `/dev/mp-checkout` page (simulated mode only). There is no queue yet (E0.7). `PLAN.md` (in Portuguese) is the authoritative spec for the first version of **Agenda Beleza**, a multi-tenant SaaS for scheduling at Brazilian beauty salons. Read it before you implement anything. The real commands are listed in "Comandos e cobertura" below. Keep them up to date when you add scripts.

## Required stack (from PLAN.md)

- Next.js + TypeScript, PostgreSQL, Prisma.
- Message queue in PostgreSQL (e.g. `pg-boss`), processed by a **separate worker process**.
- Tests: Vitest for unit and integration tests against a **real PostgreSQL** (no DB mocks); Playwright for the public booking flow in a mobile viewport.
- `docker-compose` with three services: app, worker and postgres. Also ship `.env.example` and seed data with two distinct salons and one super admin.
- The README must document how to run and test the project. It must also list, separately, the credentials needed to enable the real services: Mercado Pago, WhatsApp Business Platform (account, number and 3 approved templates), transactional email, and Cloudflare Turnstile.

## Architectural invariants

These rules span many files. Breaking any of them breaks an acceptance criterion.

- **Tenant isolation is enforced on the server.** Every authenticated query and mutation must be scoped to the user's salon. Hiding data in the UI is not enough. Tests must cover isolation between salons.
- **No double booking is guaranteed by the database.** Use a PostgreSQL exclusion constraint (`btree_gist`, a `tstzrange` per professional, limited to active statuses), created in a raw SQL migration, because Prisma can't express it. This also applies to staff "encaixes" (overrides outside working hours or on blocked time). Validation in the UI is only for user experience.
- **Time:** store all timestamps in UTC. Show availability in each salon's configured timezone (default `America/Sao_Paulo`). Availability uses a configurable slot grid (default 15 min), minimum lead time (2 h), maximum window (60 days) and buffer (0 min).
- **Multi-service bookings** run back to back with a single professional. Offer only professionals who perform *every* chosen service. Booking items store a snapshot of each service's price and duration at booking time.
- **Soft deletes:** professionals and services are deactivated, never deleted. Deleting a client means *anonymizing* them (name and phone cleared, "cliente removida" shown) while keeping the bookings.
- **Clients** have no account. Each client is identified by salon + phone number, normalized to Brazilian E.164.
- **Integrations sit behind adapters:** Mercado Pago, WhatsApp Cloud API, transactional email and Turnstile each get a real adapter, selected by environment variables, and a simulated adapter for local runs and tests. Keep integration code out of the business logic. Never store card data.
- **Subscriptions:** never trust the browser redirect. Query Mercado Pago and process webhooks with origin validation and idempotency (persist every event). Timeline: 30-day trial → R$79/month → a 3-day grace period after the first failed charge → suspended. A suspended salon is read-only, except that staff can still cancel future bookings, and those cancellations still notify the client.
- **WhatsApp messages** (confirmation, reschedule, cancellation only) are queued *after* the booking is saved. Each attempt is logged, retries use backoff, and the idempotency key is booking + event type + booking revision (`reserva:tipo:revisao`), so each legitimate reschedule is notified once and never duplicated. A failed send must never change the booking.
- **Super admin** accounts are created by seed or environment variable and require TOTP. Every super admin action writes an audit log entry: who, when, what, and the old and new values.

## Roles

There are four roles: gestor (salon owner, one per salon, may also have a linked professional profile), profissional (invited by email, manages only their own blocks and bookings), cliente (no account), and super admin. Staff log in with email and password, using httpOnly session cookies.

## UI conventions

- The UI language is pt-BR and the currency is BRL.
- Visual direction: elegant and warm, with earthy and nude tones, serif headings and sans-serif body text, and plenty of whitespace. Avoid generic pink.
- The UI must be responsive and usable with the keyboard alone.
- Use AppBarber and AppBeleza only as references for features and flows. Do not copy their visuals or text.

## Out of scope for v1

Don't build screens or schema for these: cash register, inventory, commissions, financial reports, loyalty, client payments, native apps, booking via WhatsApp, reminders, promotional messages, client accounts, multiple managers per salon, and per-professional pricing or duration.

## Comandos e cobertura

Pré-requisito: Node 24 (`.nvmrc` é a fonte única; `package.json#engines` exige `>=24.15.0 <25`). As versões das dependências são exatas (`.npmrc` com `save-exact=true`): não introduza `^`/`~`. Os comandos funcionam em caminhos com espaço e acento.

| Objetivo | Comando | Observações |
|---|---|---|
| Selecionar o Node | `nvm use` | lê o `.nvmrc` |
| Instalar | `npm ci` | instalação oficial (lock versionado); sem `--legacy-peer-deps`/`--force`. Os scripts de instalação de prisma/esbuild estão aprovados em `allowScripts` (por versão: ao atualizar um deles, rode `npm install-scripts approve <pkg>`) |
| Gerar o cliente Prisma | `npm run db:generate` | **obrigatório depois de todo `npm ci`**: typecheck, lint, build e testes dependem de `src/generated/prisma` (não versionado, sem `postinstall`). Funciona sem `DATABASE_URL` |
| Ambiente | `cp .env.example .env` | o `.env` é lido pelo Vitest, pelo `prisma.config.ts` e por `npm run worker`; variáveis já definidas no ambiente prevalecem. Os seletores `*_ADAPTER` vêm em `simulado` (sem credenciais); o modo `real` exige as variáveis do provedor (README, "Credenciais para os serviços reais") |
| Subir tudo (Docker) | `docker compose up -d --wait` | postgres, app (http://localhost:3000, aplica `migrate deploy` ao iniciar) e worker. Derrubar: `docker compose down` (mantém dados) ou `down -v` (apaga o volume) |
| Só o PostgreSQL | `docker compose up -d postgres` | pré-requisito de `npm test`, `test:integration` e `test:coverage`. O initdb cria a base de `TEST_DATABASE_URL` (só administrativa: o harness cria nela as bases de teste e não grava nada nela); volume antigo: `docker compose exec postgres createdb -U agenda agenda_beleza_test` |
| Navegador do E2E | `npx playwright install chromium` | uma vez por máquina. `--with-deps` instala bibliotecas do sistema e exige sudo; só use se o Chromium não abrir |
| Desenvolvimento | `npm run dev` | http://localhost:3000 |
| Build | `npm run build` | `next build` (Turbopack); não precisa de `DATABASE_URL` |
| Bundle do worker/check-env | `npm run build:node` | esbuild → `dist/worker/main.js` e `dist/scripts/check-env.js` |
| Worker local | `npm run worker` | `build:node` + `node --env-file-if-exists=.env dist/worker/main.js`; Ctrl-C encerra com 0 |
| Servir o build | `npm run start` | exige `npm run build` antes |
| Lint | `npm run lint` | `eslint . --max-warnings=0`: qualquer aviso reprova |
| Typecheck | `npm run typecheck` | `tsc --noEmit`; não depende de build |
| Testes (todos) | `npm test` | Vitest, projetos `unit` e `integration`; exige o PostgreSQL no ar (`docker compose up -d postgres`) e `TEST_DATABASE_URL` |
| Só unidade | `npm run test:unit` | `src/**/*.test.ts(x)`; ambiente `node`. Todo `*.test.tsx` deve começar com `/** @vitest-environment jsdom */` |
| Só integração | `npm run test:integration` | `tests/integration/**/*.test.ts`, contra PostgreSQL real, até 4 workers. Parte só de `TEST_DATABASE_URL` (nunca `DATABASE_URL`; falha nomeando a variável se faltar ou se o nome da base passar de 46 caracteres): template por execução (`<base>_r<exec>_tpl`) e uma base por worker, recriada no início de cada arquivo e apagada no fim; o papel precisa de `CREATEDB`. Execuções simultâneas são permitidas (README, "Banco de teste") |
| Teste único (Vitest) | `npx vitest run src/lib/site.test.ts -t "define a marca"` | `-t` filtra pelo nome (substring). Integração: `npx vitest run --project integration tests/integration/tenant/isolamento.test.ts` (o harness roda do mesmo jeito) |
| Concorrência (CA-6 da D-005) | `for i in $(seq 10); do npx vitest run --project integration tests/integration/concorrencia --maxWorkers=2 --silent=false \|\| break; done` | `--silent=false` mostra `[CA-6] arquivo=… VITEST_POOL_ID=… base=…` de cada arquivo |
| Teste único (Playwright) | `npx playwright test e2e/smoke.spec.ts -g "viewport móvel"` | exige build prévio e porta 3000 livre |
| Cobertura (gate) | `npm run test:coverage` | exige o PostgreSQL no ar; falha abaixo de 90% de linhas; relatório em `coverage/` (`text`, `html`, `lcov`, `json-summary`) |
| E2E | `npm run test:e2e` | faz `next build` e roda o Playwright (Chromium, viewport 375×812). Libere a porta 3000 antes (inclusive `docker compose stop app`): fora da CI, um servidor já rodando nela é reaproveitado |
| Migrações | `npm run db:migrate:deploy` | `prisma migrate deploy` com a `DATABASE_URL`; migrações em `prisma/migrations/` (SQL bruto revisado pelo DBA). No Docker, só a app as aplica, ao iniciar |

Na CI (`.github/workflows/ci.yml`, D-006), o job `e2e` roda `npx playwright install --with-deps chromium` (com cache dos navegadores pela versão do `@playwright/test`) e depois `npm run test:e2e`, com uma única compilação no job; ele não reaproveita o build do job `build`. Os seis jobs (`lint`, `typecheck`, `build`, `testes`, `e2e`, `docker`) e seus comandos locais equivalentes estão no README, seção "CI". Opcional: `npx next telemetry disable` desliga a telemetria anônima do Next nesta máquina.

Política do gate de cobertura (vigente):
- Ferramenta: Vitest com `@vitest/coverage-v8`. Limiar `coverage.thresholds.lines = 90` no `vitest.config.ts`: o próprio `npm run test:coverage` falha abaixo de 90%. A CI executa o mesmo comando.
- Escopo: código de produção (`coverage.include: src/**/*.{ts,tsx}`). Arquivos sem teste entram com 0%. A medição soma unidade e integração numa única execução, porque o projeto proíbe mocks de banco e o código de persistência só é testável contra o PostgreSQL real.
- Exclusões permitidas, cada uma com um comentário que a justifique: os próprios testes, código gerado (cliente Prisma), arquivos só de tipos, arquivos de configuração e migrações. Nenhuma outra.
- Playwright não entra na métrica. Cobertura abaixo de 90% vira trabalho obrigatório da demanda, sem exclusões injustificadas nem testes sem asserções.

## Squad de agentes e orquestração

A sessão principal é o **líder**: ela coordena, mas não implementa a demanda. Os papéis ficam em `.claude/agents/`: `analista-requisitos`, `arquiteto-software`, `dba`, `devops`, `desenvolvedor` e `tester`. Todos ficam disponíveis, mas só participam de uma demanda quando ela precisa deles.

### Fluxo de cada demanda

```
demanda → analista-requisitos → arquiteto-software → (dba / devops, se houver impacto)
        → desenvolvedor → tester ─┬─ APROVADO → líder confere os gates e encerra
                                  └─ REPROVADO → desenvolvedor corrige → tester retesta (repete)
                                     └─ mesma classe de falha recorrente → arquiteto (+ dba/devops) revisa o desenho
```

1. O líder atribui o ID `D-NNN` (sequencial) e cria `docs/demandas/D-NNN/`. Os artefatos são `spec.md` (analista), `design.md` (arquiteto), `dba.md`, `devops.md`, `dev.md` e `testes.md`.
2. O **analista** produz a especificação. O líder só leva perguntas ao usuário quando o analista sinaliza uma dúvida bloqueante.
3. O **arquiteto** produz o desenho e as tarefas `T-n`, cada uma com responsável, dependências, arquivos sob posse, entregável e critério de conclusão.
4. O **DBA** e o **DevOps** só entram quando o desenho aponta impacto em dados ou em infraestrutura/CI. Se o arquiteto dispensar algum dos dois, registre o motivo.
5. O **desenvolvedor** implementa e testa. O **tester** valida de forma independente e dá o veredito.
6. Um defeito reabre a tarefa do desenvolvedor. A demanda nunca é encerrada só porque houve uma tentativa de correção.

### Tarefas
O líder registra cada tarefa na ferramenta de tarefas da sessão: com Agent Teams ativo, a lista compartilhada da equipe; sem ele, a ferramenta de tarefas da sessão principal. Cada tarefa tem **responsável, dependências, estado (pendente/em andamento/bloqueada/concluída), entregável e critério de conclusão**. Só paralelize tarefas independentes **e** sem arquivos em comum; cada arquivo tem um único responsável por rodada.

### Transferência entre agentes
Os agentes **não** recebem o histórico da conversa. Toda transferência, feita pelo líder ou por mensagem direta entre os membros da equipe, contém:
```
DEMANDA / DE / PARA
OBJETIVO
CONTEXTO NECESSÁRIO
CRITÉRIOS DE ACEITAÇÃO
DECISÕES JÁ TOMADAS
ARQUIVOS ENVOLVIDOS
EVIDÊNCIAS (comandos, saídas, caminhos)
PENDÊNCIAS
PRÓXIMA AÇÃO
```

### Execução: Agent Teams ou subagentes
- `.claude/settings.json` ativa o Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; a mudança só vale depois de reiniciar o Claude Code). Se ele estiver disponível numa sessão interativa, o líder cria a equipe com os papéis acima, usando os arquivos de `.claude/agents/` como definição de cada membro. A comunicação direta entre especialistas e a lista de tarefas compartilhada ficam liberadas. Não crie nem edite manualmente os arquivos internos de estado da equipe.
- Sem Agent Teams, o mesmo fluxo roda com subagentes: o líder chama cada papel pela ferramenta Agent (`subagent_type` = nome do papel) e repassa a transferência de uma etapa para a seguinte.

### Definição de pronto (todos os itens são obrigatórios)
- Todos os critérios de aceitação atendidos, com evidência.
- Build, lint e typecheck passando.
- Testes unitários, de integração e os E2E pertinentes passando.
- Cobertura de linhas ≥ 90% no comando oficial. Se a medição ficar abaixo, elevar a cobertura vira trabalho obrigatório da demanda, sem exclusões injustificadas nem testes sem asserções.
- Veredito **APROVADO** do tester, sem defeito crítico ou alto em aberto.
- Documentação (README), migrações, `.env.example` e CI atualizados quando aplicável.

Se um bloqueio externo impedir um gate, apresente ao usuário a evidência, o impacto e a decisão necessária. Nunca declare sucesso sem comprovação.
