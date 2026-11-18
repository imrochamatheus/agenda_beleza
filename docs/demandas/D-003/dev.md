# D-003 — Desenvolvimento (T-2)

Responsável: desenvolvedor. Data: 2026-11-18. Branch `feat/d-003-docker-compose` (sem commit, conforme a orientação do líder).

## 1. Tarefa concluída e arquivos

T-2: as interfaces de §3.2 a §3.6 do `design.md`, com as assinaturas e os caminhos do desenho.

| Arquivo | Conteúdo |
|---|---|
| `src/server/env.ts` | `ADAPTADORES`, `esquemaEnv` (zod), `Env`, `CHAVES_FORA_DO_RUNTIME`, `chavesDeclaradas()`, `ErroDeAmbiente` e `validarEnv()`. String vazia conta como ausente, e a mensagem só traz nomes. |
| `src/server/check-env.ts` | `executarCheckEnv(fonte, saida): 0 \| 1` |
| `src/scripts/check-env.ts` | ponto de entrada (1 linha executável) |
| `src/server/db.ts` | `criarPrisma`, `obterPrisma` (cache por URL em `globalThis`; DATABASE_URL lida na chamada) e `encerrarPrisma` |
| `src/server/health.ts` | `TIMEOUT_HEALTH_MS = 3000` e `verificarBanco()` (corrida com o timeout; nunca lança) |
| `src/app/api/health/route.ts` | `dynamic = 'force-dynamic'`, `GET` → 200 `{"status":"ok"}` / 503 `{"status":"indisponivel"}`, sempre com `Cache-Control: no-store` |
| `src/worker/stub.ts` | `INTERVALO_HEARTBEAT_MS`, `DependenciasWorker` e `iniciarWorker()` |
| `src/worker/main.ts` | ponto de entrada (1 linha executável) |
| `tests/integration/support/banco.ts` | `urlBancoDeTeste()` |
| `tests/integration/health.test.ts` | CA-9 contra o PG real |
| `.env.example` | as 11 chaves de §3.5, todas comentadas; Postgres marcado como "SOMENTE DESENVOLVIMENTO"; avisos sobre `POSTGRES_PORT` e senha URL-encoded |
| `vitest.config.ts` | só a remoção de `passWithNoTests` e do comentário dele |
| testes unitários | `src/server/{env,check-env,db,health}.test.ts`, `src/scripts/check-env.test.ts`, `src/app/api/health/route.test.ts`, `src/worker/{stub,main}.test.ts` |

## 2. Comandos e resultados

PG descartável usado (o compose da T-3 ainda não estava pronto): `docker run -d --rm --name pg-d003-dev -e POSTGRES_USER=agenda -e POSTGRES_PASSWORD=agenda_dev -e POSTGRES_DB=agenda_beleza -p 127.0.0.1:55432:5432 postgres:17` e `docker exec pg-d003-dev createdb -U agenda agenda_beleza_test`. As URLs foram exportadas no shell (sem `.env`): `DATABASE_URL=…:55432/agenda_beleza` e `TEST_DATABASE_URL=…:55432/agenda_beleza_test`.

| Comando | Resultado |
|---|---|
| `npm run db:generate` | exit 0 (`Generated Prisma Client (7.10.1)`) |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `env -u DATABASE_URL npm run build` | exit 0; a rota aparece como `ƒ /api/health` (dinâmica) |
| `npm run build:node` | exit 0; `dist/worker/main.js` 2.3kb e `dist/scripts/check-env.js` 1.6kb |
| `npm run test:coverage` | exit 0; **12 arquivos e 45 testes passando** (unit e integration) |
| Cobertura (v8, `src/**`) | **Linhas 100% (85/85)**, statements 100% (91/91), funções 100% (26/26), branches 95% (19/20). A única branch sem cobertura é o `: []` em `stub.ts:20` (falha que não seja `ErroDeAmbiente`, que o `validarEnv` não lança). |
| `env -u TEST_DATABASE_URL npx vitest run --project integration` | **falha** (2 testes) com `Error: TEST_DATABASE_URL não definida: suba o PostgreSQL (docker compose up -d postgres) e configure o .env`; nenhum teste é pulado (S-5) |
| `env -u DATABASE_URL node dist/scripts/check-env.js` | exit 1; `check-env: Variáveis de ambiente ausentes ou inválidas: DATABASE_URL` |
| `DATABASE_URL=postgresql://a:b@h/d node dist/scripts/check-env.js` | exit 0; `check-env: ambiente válido` |
| `node dist/worker/main.js` + `kill -INT` | `{"evento":"worker.heartbeat",…}`, `{"evento":"worker.encerrando","sinal":"SIGINT"}`, exit 0 |
| `node dist/worker/main.js` + `kill -TERM` | heartbeat, `{"evento":"worker.encerrando","sinal":"SIGTERM"}`, exit 0 |
| `npm run worker` + SIGINT no grupo de processos (equivalente ao Ctrl-C) | heartbeat e `worker.encerrando` com `SIGINT`; o processo termina |
| `env -u DATABASE_URL node dist/worker/main.js` | exit 1; `{"evento":"worker.ambiente_invalido","variaveis":["DATABASE_URL"]}` |

## 3. Testes e CAs cobertos

| Teste | CA / regra |
|---|---|
| `src/server/env.test.ts` › "coincidem nos dois lados" (`util.parseEnv` sobre o `.env.example` × `chavesDeclaradas()`; a falha lista o que sobra e o que falta) | CA-3 |
| `env.test.ts` › chaves de infraestrutura declaradas e sem duplicatas; base de teste ≠ base de dev | S-3, RN-5 |
| `env.test.ts` › `.env.example` válido e adaptadores `simulado`; sem `DATABASE_URL`; vazio = ausente; `APP_URL=nao-url`; protocolos e adaptador inválidos; mensagem sem o valor | CA-6, RN-1, RN-6 |
| `src/server/check-env.test.ts` (retorno 0/1, saída, sem valor) | CA-6 |
| `src/scripts/check-env.test.ts` (import com `vi.stubEnv`; `process.exitCode` 0/1, restaurado no fim) | CA-6, RN-6 |
| `src/app/api/health/route.test.ts` › porta fechada real → 503 em < 5 s, corpo exatamente `{"status":"indisponivel"}`, `no-store`; sem `DATABASE_URL` → 503; `dynamic` | CA-5, RN-10 |
| `src/server/health.test.ts` › porta fechada real → false; consulta travada → false pelo timeout; erro síncrono → false | CA-5 (cobertura) |
| `src/server/db.test.ts` › cache por URL, leitura de `DATABASE_URL` na chamada, erro sem URL, `encerrarPrisma` desconecta e esvazia | cobertura (§8) |
| `src/worker/stub.test.ts` › heartbeat imediato e periódico em ISO UTC; SIGTERM e SIGINT → log, `sair(0)` e nenhum timer restante; segundo sinal ignorado; ambiente inválido → `sair(1)` sem heartbeat | CA-10, RN-8, RN-6, S-7 |
| `src/worker/main.test.ts` (`vi.mock('./stub')`: liga `process.env`, `console` e `process`, e `sair` chama `process.exit`) | cobertura (§8) |
| `tests/integration/health.test.ts` › `GET` → 200 `{"status":"ok"}` contra o PG real em `TEST_DATABASE_URL`; `verificarBanco` → true; `urlBancoDeTeste` falha sem a variável e com URL igual à de dev | CA-9, RN-9, S-5 |

Nenhum teste usa mock de banco. Os dois dublês existentes são o *stub* do contrato de timeout em `health.test.ts`, autorizado em §8 do desenho, e o `vi.mock('./stub')` do ponto de entrada do worker, que não acessa o banco.

## 4. Riscos e desvios do desenho

- **Desvio pequeno, sem mudança de interface:** `verificarBanco` aceita `Pick<PrismaClient, '$queryRaw'>` em vez de `PrismaClient`. Um `PrismaClient` continua sendo aceito, e o tipo mais estreito permite o stub de timeout sem `as` no código de produção.
- **Achado do Prisma 7:** o construtor devolve um proxy. Por isso, `cliente instanceof PrismaClient` é `false`, e os matchers do Vitest (`toBeInstanceOf`, diffs) estouram a pilha ao formatar o cliente. `db.test.ts` compara com `===` e confere o contrato (`$queryRaw` e `$disconnect`). Isso vale como alerta para os testes da E0.4 em diante.
- **Ordem de execução:** `npm test` e `npm run test:coverage` agora **exigem** o PG em `TEST_DATABASE_URL` (R-5/S-5, intencional). Sem o `.env`, o `vitest.config.ts` não define as URLs: é preciso `cp .env.example .env`, ou exportá-las, como feito aqui.
- **`.env not found. Continuing without it.`:** o `--env-file-if-exists` do Node imprime esse aviso no stderr quando não há `.env`. Ele é inofensivo e aparece só no `npm run worker` local, não no container, que roda `node dist/worker/main.js` sem a flag.
- Os CAs manuais (CA-1, 2, 4, 7, 8 e 10 no compose) ficam com a T-4 (devops).
- Nenhum TODO pendente.

## 5. Ajuste A-3 do DBA (guarda da base de teste)

Pedido do líder com base em `dba.md` (A-3): a guarda de `urlBancoDeTeste()` comparava as URLs como texto.

**Alteração:**
- `tests/integration/support/banco.ts` ganhou `nomeDaBase(url)` (`new URL(url).pathname` sem a `/` inicial, sem query nem fragmento, decodificado).
- `urlBancoDeTeste()` agora recusa quando o **nome da base** de `TEST_DATABASE_URL` é igual ao de `DATABASE_URL` (se esta existir). É a mesma regra do script de initdb.
- Mensagem nova: `TEST_DATABASE_URL aponta para a mesma base de DATABASE_URL: …`.

**Testes:**
- `tests/integration/support/banco.test.ts` (novo) é puro, sem banco. Ele roda no projeto `integration` porque o glob do projeto `unit` cobre só `src/**`. Cobre:
  - a extração do nome (query e fragmento) e a decodificação;
  - a URL válida;
  - a ausência de `DATABASE_URL`;
  - a falta de `TEST_DATABASE_URL` (S-5);
  - a recusa nos casos: mesma URL, `127.0.0.1` × `localhost`, `?schema=public` a mais, e outro usuário/host/porta com a mesma base (RN-9, A-3).
- Os 2 testes da guarda que estavam em `tests/integration/health.test.ts` foram movidos para esse arquivo. O `health.test.ts` ficou só com o CA-9.

**Evidências** (PG do compose já no ar na 5432, sem subir nem derrubar o projeto; `.env` local):

| Comando | Resultado |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:coverage` | exit 0; 13 arquivos e 52 testes; linhas 100% (85/85), branches 95% |
| `npx vitest run --project integration --reporter=verbose` | 11/11 passando (9 de `banco.test.ts` e 2 do CA-9) |

Observação: `tests/**` fica fora do escopo de cobertura (`src/**`), então o ajuste não altera a métrica.
