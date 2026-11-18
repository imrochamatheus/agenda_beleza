# D-003 — Testes (tester)

## Rodada 1 — 2026-11-18

**Veredito: APROVADO.** Nenhum defeito encontrado. Há três observações informativas, nenhuma bloqueante.

### Ambiente
- Branch `feat/d-003-docker-compose`, HEAD `08f03e8`, com a entrega ainda sem commit (working tree conforme o `git status` registrado abaixo).
- Host: Node v24.21.0, npm 11.19.0, Docker 29.8.1, Compose v5.5.1. Na imagem: Node v24.22.3 (`node:24-trixie-slim`) e PostgreSQL 17.12 (`postgres:17`).
- Caminho com espaço e acento (`Área de Trabalho`).
- Estado inicial: sem `.env`, sem containers, volumes ou redes do projeto, sem `DATABASE_URL` ou `TEST_DATABASE_URL` no shell, portas 3000 e 5432 livres.
- Antes de começar, apaguei `src/generated`, `dist`, `.next` e `coverage` e rodei `npm ci`, para partir de um ambiente limpo.
- `git status --short` ficou idêntico antes e depois da rodada. O único arquivo novo é este `testes.md`.

### Critérios de aceitação

| CA | Resultado | Evidência (comando → saída) |
|---|---|---|
| CA-1 | PASSOU | `cp .env.example .env && docker compose up -d --wait` → exit 0 em 9,1 s. `docker compose ps`: app `Up (healthy)`, postgres `Up (healthy)`, worker `Up`. `curl -fsS localhost:3000/` → 200. `/api/health` → `{"status":"ok"}` 200 |
| CA-2 | PASSOU | São 3 containers distintos. `exec app id -u` → 1000 e `exec worker id -u` → 1000 (usuário `node`). `Config.User=node`. `compose top worker` → `node /app/dist/worker/main.js`; `compose top app` → `next-server (v16.4.6)`. As duas imagens usam `HostConfig.Init=true` (`/sbin/docker-init`) |
| CA-3 | PASSOU | `src/server/env.test.ts` "coincidem nos dois lados" passou. Fiz uma mutação temporária no `.env.example` (incluí `CHAVE_NOVA` e removi `MP_ADAPTER`), e o teste falhou listando `sobrandoNoExemplo: [CHAVE_NOVA]` e `faltandoNoExemplo: [MP_ADAPTER]`. Depois restaurei o arquivo (`sha256sum -c` → SUCESSO) |
| CA-4 | PASSOU | `docker compose down` → exit 0, e o volume `agenda_beleza_pgdata` foi mantido. `up -d --wait` → exit 0, com o mesmo estado do CA-1. Log do app: "No pending migrations to apply.". `grep -icE 'error\|P[0-9]{4}'` → 0. O postgres registrou "Skipping initialization", e `agenda_beleza_test` continua existindo |
| CA-5 | PASSOU | Automatizado: `route.test.ts` faz uma conexão real a `127.0.0.1:1`, recebe 503 em menos de 5 s, e o corpo é exatamente `{"status":"indisponivel"}`, sem senha nem host. Manual com `docker compose stop postgres`: 503 em 0,075 s, e depois de cerca de 40 s o app ficou `unhealthy` enquanto o worker seguiu `Up`. Manual com `docker compose pause postgres` (conexão que trava): 503 em 3,006 s, que é o caminho do timeout. Com `unpause`/`start`, o health voltou a 200 |
| CA-6 | PASSOU | Unitários em `env.test.ts`, `check-env.test.ts` e `stub.test.ts`. Na imagem: `docker run agenda-beleza:dev app` sem `DATABASE_URL` → "Variáveis de ambiente ausentes ou inválidas: DATABASE_URL", exit 1. `worker` com `APP_URL=nao-url` → nomeia `APP_URL`, exit 1. Uma senha passada em `DATABASE_URL` não aparece na saída (0 ocorrências). Papel desconhecido → exit 64. Local: `env -i node dist/scripts/check-env.js` → exit 1, nomeando `DATABASE_URL` |
| CA-7 | PASSOU | Sem `.env` e sem as variáveis no shell: `npm ci` → 0, `npm run db:generate` → 0, `npm run build` → 0 (`/api/health` aparece como ƒ dinâmica), `docker compose config -q` → 0 e `docker compose build --no-cache` → 0 |
| CA-8 | PASSOU | `logs app`: check-env, "Loaded Prisma config", "No migration found", "No pending migrations to apply.". `logs worker`: `check-env: ambiente válido` mais `{"evento":"worker.heartbeat",...}`, com 0 linhas contendo "migrat" |
| CA-9 | PASSOU | `npx vitest run --project integration --reporter=verbose`: 11/11, incluindo "responde 200 com {"status":"ok"}" e "verificarBanco devolve true contra o banco real". Contraprovas: com `TEST_DATABASE_URL` apontando para uma base inexistente, falha (503≠200). Vazia, falha nomeando `TEST_DATABASE_URL` (não é pulado, S-5). Igual à base de dev, falha com "mesma base de DATABASE_URL" (RN-9/A-3) |
| CA-10 | PASSOU | `docker compose stop worker` em 0,24 s; `State.ExitCode=0`; log `{"evento":"worker.encerrando","sinal":"SIGTERM"}`. Local: SIGINT em `node dist/worker/main.js` → exit 0 |

### Initdb com nome inválido (ajustes A-1/A-2 do DBA)
Rodei num projeto compose isolado (`-p d003tester`, `--env-file /dev/null`, `POSTGRES_PORT=55432`, só o serviço postgres), com `down -v` entre os casos:

| Nome da base em `TEST_DATABASE_URL` | `up --wait` | Resultado |
|---|---|---|
| `Base-Ruim` | 1 | `Exited (1)`, log "nome de base inválido … Corrija a variável e rode docker compose down -v" |
| `agenda_beleza` (= POSTGRES_DB) | 1 | "aponta para a base de desenvolvimento" |
| `postgres` / `template1` | 1 | "aponta para a base de sistema" |
| 64 caracteres | 1 | "nome de base inválido" |
| 63 caracteres | 0 | base criada com o nome exato |
| `teste_ok?sslmode=disable` | 0 | base `teste_ok` criada, sem a query string |

Também conferi o comportamento que o README documenta para um volume parcialmente inicializado: o 1º `up` com nome inválido → exit 1, e o 2º `up` → exit 0, com o banco no ar **sem** a base de teste. O projeto isolado foi removido: não sobrou container, volume nem rede `d003tester`.

### Gates

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Build | `npm run build` | exit 0 (sem `.env`) |
| Bundle node | `npm run build:node` | exit 0 (`dist/worker/main.js` 2,3 kB e `dist/scripts/check-env.js` 1,6 kB) |
| Vitest | `npm test` | 13 arquivos, 52 testes, todos passando |
| Cobertura | `npm run test:coverage` (PG real do compose, sem mocks de banco) | exit 0. **Linhas 100% (85/85)**, statements 100%, funções 100%, branches 95% (o único ramo descoberto é `stub.ts:20`, o `?? INTERVALO_HEARTBEAT_MS`, que tem efeito coberto por outro teste). Os 11 arquivos de `src/` estão no relatório (`coverage-summary.json`) |
| E2E | `npm run test:e2e` (com app e worker parados para liberar a 3000) | 1/1 passou (`mobile-chromium`) |
| Imagem | `docker compose build --no-cache` | exit 0 |

**Exclusões de cobertura:** `src/**/*.test.*`, `src/**/*.d.ts` e `src/generated/**`. Todas são permitidas pelo CLAUDE.md e cada uma traz um comentário. `tests/integration/support/banco.ts` fica fora de `src/`, então não entra na métrica, mas tem testes próprios (`banco.test.ts`).

**Qualidade dos testes:** os testes verificam comportamento, não só linhas. Exemplos: conteúdo exato do corpo 503, ausência do valor secreto nas mensagens, timeout medido, códigos de saída, ordem e conteúdo dos eventos JSON do worker e mensagens das guardas. Os stubs de `$queryRaw` em `health.test.ts` simulam só o contrato de timeout e de exceção síncrona. O caminho do banco é exercido com conexão real, tanto o recusado quanto o OK, então não é mock de banco. O `vi.mock('./stub')` em `main.test.ts` só confere a ligação do ponto de entrada.

### Verificações adicionais
- **Imagem:** sem `/app/src` e sem nenhum `.env` no filesystem (`find / -name .env` vazio). Ela contém `.next`, `dist`, `node_modules`, `prisma/schema.prisma`, `prisma.config.ts` e `node_modules/.bin/prisma`. Variáveis: `TZ=UTC`, `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`. `ENTRYPOINT` é `entrypoint.sh` e `CMD` é `["app"]` (não usa `npm run`). O `.dockerignore` exclui `.env` e `.env*.local` e libera `.env.example`.
- **Scripts em `docker/`:** `entrypoint.sh` e `initdb/10-base-de-teste.sh` estão com `-rwxr-xr-x`, e `core.fileMode=true`, então o bit executável vai junto no commit. O entrypoint usa `set -eu`, `exec node …` e só roda `migrate deploy` no papel `app`.
- **`.env.example`:** não tem segredo real, só `agenda_dev`, marcado com "SOMENTE DESENVOLVIMENTO". Os 4 seletores vêm como `simulado`, `TEST_DATABASE_URL` aponta para uma base diferente (`agenda_beleza_test`), e `APP_URL` e `POSTGRES_PORT` estão presentes.
- **`.gitignore`:** ignora `.env`, `dist/` e `src/generated/` (conferido com `git check-ignore -v`).
- **Compose:** a imagem é `postgres:17`, com major fixa (RN-4). O worker não publica porta e não tem healthcheck, e `depends_on` exige `app: service_healthy`. O `DATABASE_URL` é sobrescrito com o host `postgres`.
- **README e CLAUDE.md:** segui as seções "Executar com Docker", "Desenvolvimento sem Docker" e "Testes" literalmente, e todos os comandos funcionaram. A tabela "Comandos e cobertura" está atualizada.

### Observações (não são defeitos)
- **OBS-1:** `docker compose stop app` deixa o app com `ExitCode=143`. O `next start` não trata SIGTERM com saída 0. Nenhum CA exige isso (o CA-10 é só do worker), mas a E0.7 e a E9 podem querer tratar.
- **OBS-2:** por causa do `EXPOSE 3000` da imagem única, `docker compose ps` mostra `3000/tcp` no worker. A porta não é publicada, então o requisito "sem porta publicada" continua atendido.
- **OBS-3:** `prisma/migrations/` não existe nem está na imagem. O spec previa o diretório "mesmo vazio", mas o design.md (linha 38) decidiu não versioná-lo, com a evidência de que `migrate deploy` sai com 0. Confirmei isso nesta rodada ("No migration found … No pending migrations to apply.").

### Defeitos
Nenhum.

### Limpeza
Rodei `docker compose down -v`, que removeu o volume `agenda_beleza_pgdata` e a rede. Removi o `.env` e o projeto `d003tester`. Os artefatos gerados (`src/generated`, `dist`, `.next`, `coverage`, `test-results`) foram recriados pelos comandos oficiais, já estavam presentes no início e são ignorados pelo git. A imagem `agenda-beleza:dev` foi reconstruída e mantida, como no estado inicial.
