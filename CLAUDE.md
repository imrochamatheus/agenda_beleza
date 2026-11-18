# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The repository has no application code yet. `PLAN.md` (in Portuguese) is the authoritative spec for the first version of **Agenda Beleza**, a multi-tenant SaaS for scheduling at Brazilian beauty salons. Read it before you implement anything. Once the project is scaffolded, add the real build, lint, test and single-test commands to this file. Do not guess them before then.

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
- **WhatsApp messages** (confirmation, reschedule, cancellation only) are queued *after* the booking is saved. Each attempt is logged, retries use backoff, and the idempotency key is booking + event type. A failed send must never change the booking.
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

Ainda não há código, `package.json` nem CI, então nenhum comando de build, lint, teste ou cobertura existe hoje. A cobertura **não é mensurável** neste momento.

Decisão já tomada para o gate de cobertura, a ser implementada pela primeira demanda (scaffolding):
- Ferramenta: Vitest (exigida pelo `PLAN.md`) com `@vitest/coverage-v8`, o provedor de cobertura nativo do Vitest, que não exige instrumentação extra.
- Limiar: `coverage.thresholds.lines = 90` no `vitest.config.ts`, para que o próprio comando falhe abaixo de 90%. A CI (quando existir) executa o mesmo comando.
- Escopo: código de produção (`src/**`). A medição soma unidade e integração Vitest, porque o projeto proíbe mocks de banco e o código de persistência só é testável contra o PostgreSQL real. São permitidas apenas as exclusões de código gerado (cliente Prisma), arquivos só de tipos, arquivos de configuração e migrações, cada uma com um comentário que a justifique. Playwright não entra na métrica.
- Quando o scaffolding existir, substitua este bloco pelos comandos reais: instalar, dev, build, lint, typecheck, teste, teste único, cobertura, E2E e migrações.

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
