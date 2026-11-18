# D-003 — DevOps

Branch `feat/d-003-docker-compose`. Ambiente: Node v24.21.0, npm 11.19.0, Docker 29.8.1, Compose v5.5.1.

## T-1 — Dependências, scripts e bootstrap do Prisma

### O que mudou e por quê

| Arquivo | Mudança |
|---|---|
| `package.json` / `package-lock.json` | `prisma`, `@prisma/client`, `@prisma/adapter-pg` 7.10.1 e `zod` 4.6.7 em `dependencies`; `esbuild` 0.28.2 em `devDependencies` (versões exatas, `save-exact=true`). Scripts `db:generate`, `db:migrate:deploy`, `build:node` e `worker` (design §3.1). Campo `allowScripts` gerado por `npm install-scripts approve prisma @prisma/engines esbuild`. |
| `prisma/schema.prisma` | `generator client` (`prisma-client`, saída `../src/generated/prisma`) e `datasource db` (`postgresql`, sem `url`). Nenhum model. |
| `prisma.config.ts` | `defineConfig` com schema, `migrations.path` e `datasource.url: process.env.DATABASE_URL ?? ''`; `process.loadEnvFile()` em `try/catch` que ignora só `ENOENT`. |
| `.gitignore` | `src/generated/` e `dist/`, com comentário. |
| `eslint.config.mjs` | `globalIgnores` de `src/generated/**` e `dist/**`, com comentário. |
| `vitest.config.ts` | Carregamento do `.env` (caminho absoluto via `fileURLToPath`, ignora só `ENOENT`; variáveis do ambiente prevalecem) e exclusão de cobertura `src/generated/**` ("cliente Prisma gerado"). O `passWithNoTests` continua (a remoção é da T-2). |

Ferramenta nova: `esbuild` (bundle do worker e do `check-env`, justificativa no design §1.2). Prisma e zod são exigidos pela stack/issue; `@prisma/adapter-pg` é exigido pelo Prisma 7.

### Scripts de instalação

`npm install-scripts approve prisma @prisma/engines esbuild` **elimina** os avisos `install-scripts … not yet covered by allowScripts`. Ele grava no `package.json`:

```json
"allowScripts": { "prisma@7.10.1": true, "@prisma/engines@7.10.1": true, "esbuild@0.28.2": true }
```

As entradas são fixadas por versão: ao atualizar qualquer um dos três pacotes, é preciso rodar o `approve` de novo, ou o aviso volta.

### Evidências

```
$ ls .env            → inexistente
$ rm -rf node_modules && npm ci                     → exit 0
$ npm ci 2>&1 | grep -iE "install-scripts|ERESOLVE|warn"
npm warn deprecated eslint@9.39.5: ...              (único aviso; pré-existente da E0.1, sem install-scripts nem ERESOLVE)
$ ls node_modules/@prisma/engines | grep schema-engine
schema-engine-debian-openssl-3.0.x                  (o postinstall rodou)

$ npm ls prisma @prisma/client @prisma/adapter-pg zod esbuild
├── @prisma/adapter-pg@7.10.1
├─┬ @prisma/client@7.10.1  └── prisma@7.10.1 deduped
├── esbuild@0.28.2          (vite deduplica na mesma versão)
├── prisma@7.10.1
└── zod@4.6.7               (eslint-plugin-react-hooks deduplica na mesma versão)

# sem .env e com env -u DATABASE_URL:
npm run db:generate  exit=0  ✔ Generated Prisma Client (7.10.1) to ./src/generated/prisma
npm run typecheck    exit=0
npm run lint         exit=0
npm run build        exit=0  (rotas / e /_not-found estáticas)
npm test             exit=0  Test Files 3 passed (3), Tests 6 passed (6)
npx prisma migrate deploy  → "Error: Connection url is empty" (falha esperada sem URL)

$ npm audit --omit=dev → found 0 vulnerabilities
$ npm audit            → 18 high (picomatch via vitest/vite, só dev)
```

O `npm audit` completo dá 18 vulnerabilidades altas **também no lock de `HEAD`** (verificado num diretório descartável com o `package.json`/lock de `HEAD`). Elas vêm de dependências de desenvolvimento da E0.1 e não foram introduzidas por esta tarefa.

`git status` confirma que `src/generated/` não aparece (ignorado).

### Riscos e pendências

- O `allowScripts` é por versão; um bump de prisma/esbuild exige um novo `npm install-scripts approve`.
- As 18 vulnerabilidades de dev são pré-existentes; avaliar numa demanda própria (fora do escopo da D-003).

## T-3 — Imagem, compose, entrypoint e initdb

### O que mudou e por quê

| Arquivo | Conteúdo |
|---|---|
| `Dockerfile` | Multi-stage `node:24-trixie-slim` (`ARG NODE_IMAGE`). O `build` roda `npm ci`, depois `db:generate`, `build`, `build:node` e `prune --omit=dev`. O `final` define `NODE_ENV=production`, `TZ=UTC`, `HOSTNAME=0.0.0.0` e `PORT=3000` e copia, com `--chown=node:node`, só `package.json`, `next.config.ts`, `prisma.config.ts`, `prisma/`, `node_modules/`, `.next/` e `dist/`. O entrypoint vai com modo 0755. `USER node`, `ENTRYPOINT` e `CMD ["app"]`. |
| `.dockerignore` | Ignora `.git`, `node_modules`, `.next`, `dist`, `src/generated`, `coverage`, os relatórios do Playwright, `.env`, `.env*.local`, `*.tsbuildinfo` e `docs`. O `.env.example` fica permitido. |
| `docker/entrypoint.sh` | `set -eu`. Roda `check-env` nos dois papéis. `app` faz `prisma migrate deploy` e depois `exec next start`. `worker` faz `exec node dist/worker/main.js`. Qualquer outro papel sai com 64. |
| `docker/postgres/initdb/10-base-de-teste.sh` | Extrai o nome da base de `TEST_DATABASE_URL` (último segmento, sem query string) e valida com `^[a-z0-9_]+$`. Recusa um nome igual a `POSTGRES_DB` e cria a base com `psql -v ON_ERROR_STOP=1`. Com a variável vazia, não faz nada. |
| `docker-compose.yml` | Serviços `postgres:17` (healthcheck TCP com `pg_isready -h 127.0.0.1`, intervalo de 2 s e 30 tentativas, volume `pgdata`, initdb `:ro` e porta `${POSTGRES_PORT:-5432}`), `app` (build, `init: true`, healthcheck via `fetch` em `/api/health`, `start_period` de 30 s, porta 3000, depende do PG saudável) e `worker` (mesma imagem, `init: true`, depende da app saudável, sem portas). O `env_file` `.env` tem `required: false`, e a `DATABASE_URL` é sobrescrita com o host `postgres`. Sem `restart:`. O `env_file` e a `DATABASE_URL` comuns aos dois ficam na âncora YAML `x-env-app`, para não haver duplicação. |

### Evidências

```
$ ls .env → inexistente
$ docker compose config -q            → exit 0
$ sh -n docker/entrypoint.sh && sh -n docker/postgres/initdb/10-base-de-teste.sh → ok
```
O `shellcheck` não está instalado no host, e a execução via imagem `koalaman/shellcheck` foi negada pela política de permissões da sessão. Por isso fica só o `sh -n`, como o design admite.

Script de initdb exercitado no host com um `psql` falso (que imprime os argumentos):
```
TEST_DATABASE_URL=""                                   → "nenhuma base de teste criada", exit 0
…/agenda_beleza_test                                   → CREATE DATABASE "agenda_beleza_test", exit 0
…/agenda_beleza_test?sslmode=disable                   → CREATE DATABASE "agenda_beleza_test", exit 0
…/agenda_beleza   (= POSTGRES_DB)                      → "aponta para a base de desenvolvimento", exit 1
…/Bad-Name                                             → "nome de base inválido", exit 1
```

PostgreSQL real, num projeto isolado (`COMPOSE_PROJECT_NAME=d003t3`, porta 55499) para não colidir com o `pg-d003-dev` do desenvolvedor:
```
$ docker compose up -d --wait postgres     → Healthy em ~4,8 s
postgres-1 | running /docker-entrypoint-initdb.d/10-base-de-teste.sh
postgres-1 | 10-base-de-teste: base "agenda_beleza_test" criada.
$ psql … select datname … → agenda_beleza, agenda_beleza_test
$ docker compose down -v                   → volume d003t3_pgdata removido
```

`docker build` de sonda, antecipado com os arquivos da T-2 ainda em andamento (tag `agenda-beleza:t3-sonda`, removida depois):
```
build exit=0 (sem aviso de install-scripts; só o deprecated do eslint, pré-existente)
tamanho: 943 MB (R-8 aceito; acima da estimativa de ~720 MB de node_modules da sonda do arquiteto)
id -u → 1000 ; /app sem src/ e sem .env ; dist/worker/main.js e dist/scripts/check-env.js presentes
node_modules/@prisma/engines → schema-engine-debian-openssl-3.0.x
run worker com DATABASE_URL vazia → "check-env: Variáveis de ambiente ausentes ou inválidas: DATABASE_URL", exit 1
run bogus com DATABASE_URL válida  → "uso: entrypoint.sh app|worker", exit 64
```
A validação ponta a ponta (CA-1, 2, 4, 5, 7, 8 e 10) fica para a T-4, com a T-2 concluída.

### Riscos e pendências

- Imagem de 943 MB (R-8). O `output: 'standalone'` fica como otimização futura.
- A senha do Postgres entra na URL montada pelo compose sem *encoding* (R-9). Os valores de desenvolvimento são alfanuméricos.

## T-4 — Validação ponta a ponta, README e CLAUDE.md

### O que mudou

- `README.md`: seções "Executar com Docker" (pré-requisitos, `cp .env.example .env`, `up -d --wait`, serviços e URLs, portas 3000/5432 e `POSTGRES_PORT` com ajuste das URLs, `down`/`down -v` e o aviso de que a publicação em VPS fica para depois), "Desenvolvimento sem Docker para a app", "Testes" (PG obrigatório, `db:generate`, `createdb` para volume antigo, `TEST_DATABASE_URL` exclusiva) e a lista separada de credenciais reais.
- `CLAUDE.md`: frase de status (linha 7) e tabela "Comandos e cobertura". Entraram `db:generate` (obrigatório após `npm ci`), `.env`, `docker compose up -d --wait`/`down`/`down -v`, `up -d postgres`, `build:node`, `worker`, `db:migrate:deploy` e o PG como pré-requisito de `npm test`/`test:integration`/`test:coverage`. Saiu o "passa sem testes". A nota do `allowScripts` por versão também foi registrada.
- Nenhum ajuste foi necessário em `Dockerfile`, compose ou scripts.

### Evidências dos CAs manuais

Antes de subir: o `pg-d003-dev` não existe mais (`docker ps -a`), e as portas 3000/5432 estavam livres (`ss -ltn`).

**CA-7** (sem `.env`, `env -u DATABASE_URL`):
```
npm run db:generate   exit=0
npm run build         exit=0   (└ ƒ /api/health, dinâmica)
docker compose build  exit=0   Image agenda-beleza:dev Built
```

**CA-1** (`cp .env.example .env` sem alterações):
```
$ docker compose up -d --wait   → exit 0 em 9,1 s
agenda_beleza-app-1       app       Up 6 seconds (healthy)
agenda_beleza-postgres-1  postgres  Up 8 seconds (healthy)
agenda_beleza-worker-1    worker    Up Less than a second
$ curl -fsS localhost:3000/        → 200
$ curl -i localhost:3000/api/health → HTTP/1.1 200 OK, cache-control: no-store, {"status":"ok"}
pg_database: agenda_beleza, agenda_beleza_test   (criada pelo initdb)
```

**CA-2:**
```
docker compose ps -q | wc -l → 3 (app e worker em containers distintos)
app uid=1000  worker uid=1000
docker compose top worker → /sbin/docker-init -- entrypoint.sh worker ; node /app/dist/worker/main.js
docker compose top app    → /sbin/docker-init -- entrypoint.sh app    ; next-server (v16.4.6)
```

**CA-8:**
```
logs app    → check-env: ambiente válido / No migration found in prisma/migrations / No pending migrations to apply.
logs worker → check-env: ambiente válido / {"evento":"worker.heartbeat","em":"2026-11-18T13:44:27.105Z"}
logs worker | grep -ic migrat → 0
```

**CA-5 (manual):**
```
$ docker compose stop postgres
$ curl -i localhost:3000/api/health → HTTP/1.1 503, cache-control: no-store, {"status":"indisponivel"}, tempo=0,068 s
$ docker compose start postgres → health volta a 200 {"status":"ok"}
```

**CA-10:**
```
$ docker compose stop worker → 0,21 s ; docker inspect ExitCode → 0
logs: {"evento":"worker.encerrando","sinal":"SIGTERM"}
```

**CA-4:**
```
$ docker compose down            (volume agenda_beleza_pgdata mantido)
$ docker compose up -d --wait    → exit 0; app/postgres healthy, worker Up; GET / → 200
logs app: "No pending migrations to apply.", Next "Ready"; grep -icE "error|P[0-9]{4}" → 0
```

### Gate completo (host, com o PG do compose e o `.env` copiado)

```
npm run db:generate   exit=0
npm run lint          exit=0
npm run typecheck     exit=0
npm run build         exit=0
npm run build:node    exit=0
npm run test:coverage exit=0   Test Files 12 passed, Tests 45 passed
                               All files: Stmts 100 | Branch 95 | Funcs 100 | Lines 100
npm run test:integration (verbose) → 4/4 contra o PG real (CA-9 e as guardas de TEST_DATABASE_URL)
npm run test:e2e      exit=0   1 passed [mobile-chromium] (app do compose parada antes, para liberar a 3000)
docker compose up -d --wait    exit=0 (CA-1/CA-4)
```

### Limpeza

`docker compose down -v` removeu os containers, a rede e o volume `agenda_beleza_pgdata`. O `.env` local, cópia idêntica do `.env.example` (`cmp`), foi apagado para o tester repetir o CA-7 sem `.env`. A imagem `agenda-beleza:dev` continua no cache local.

### Riscos e pendências

- Imagem de 943 MB (R-8).
- CI: nenhuma ainda. A E0.3 deve seguir a ordem `npm ci → db:generate → lint/typecheck/build → PG postgres:17 + TEST_DATABASE_URL → test:coverage → test:e2e`.
- `npm audit` de dev: 18 altas pré-existentes (ver T-1).
- Nenhum segredo real foi versionado: o `.env` é ignorado pelo git e pelo `.dockerignore`, e a imagem não contém `.env`.

### Ajustes do DBA (A-1 e A-2) e gate final com o A-3

**O que mudou:**
- `docker/postgres/initdb/10-base-de-teste.sh`:
  - **A-1:** toda mensagem de erro termina com `Corrija a variável e rode "docker compose down -v" (o volume ficou parcialmente inicializado).`
  - **A-2:** a regex passou para `^[a-z0-9_]{1,63}$`, e o script recusa `postgres`, `template0` e `template1`, além de `POSTGRES_DB`.
- `README.md`, seção "Testes": novo item "Volume parcialmente inicializado", com os casos que disparam a falha, o sintoma (`exited (1)` na primeira subida; nas seguintes, o banco sobe sem a base de testes) e a correção (`down -v` ou `createdb`).

**Script com `psql` falso** (`sh -n` ok; modo `-rwxr-xr-x`):
```
""                                → nenhuma base criada, exit 0
agenda_beleza_test                → CREATE, exit 0
agenda_beleza_test?sslmode=…      → CREATE, exit 0
agenda_beleza (= POSTGRES_DB)     → "…base de desenvolvimento… Corrija a variável e rode "docker compose down -v"…", exit 1
postgres / template0 / template1  → "…base de sistema "<nome>". Corrija a variável…", exit 1
Bad-Name                          → "nome de base inválido (… de 1 a 63 caracteres). Corrija a variável…", exit 1
63 × "a"                          → CREATE, exit 0
64 × "a"                          → nome inválido, exit 1
```

**PostgreSQL real, no projeto isolado `-p d003a1` (porta 55498):**
```
TEST_DATABASE_URL=…/template1: up -d --wait postgres → "container d003a1-postgres-1 exited (1)", up exit=1
  log: 10-base-de-teste: TEST_DATABASE_URL aponta para a base de sistema "template1". Corrija a variável e rode "docker compose down -v" (o volume ficou parcialmente inicializado).
  down -v
TEST_DATABASE_URL=…/agenda_beleza_test: Healthy; "base agenda_beleza_test criada"; pg_database: agenda_beleza, agenda_beleza_test
  down -v
```

**Gate final** (partindo do zero: `cp .env.example .env`, `docker compose up -d --wait --build` com exit 0, app e postgres healthy, worker Up e a base de teste criada pelo initdb):
```
db:generate 0 | lint 0 | typecheck 0 | build 0 | build:node 0
test:coverage 0 → Test Files 13 passed, Tests 52 passed (inclui o A-3 em banco.ts/banco.test.ts)
                  All files: Stmts 100 | Branch 95 | Funcs 100 | Lines 100
test:e2e 0      → 1 passed [mobile-chromium] (app e worker parados para liberar a 3000)
```

**Limpeza:** o `docker compose down -v` removeu os containers, a rede e o volume `agenda_beleza_pgdata`. Os projetos `d003a1` também foram removidos com `down -v`. O `.env` (cópia idêntica do `.env.example`) foi apagado. Nenhum container nem volume da D-003 ficou ativo.

**Bit de execução (lembrete do DBA):** `core.fileMode=true`, e os dois scripts estão `-rwxr-xr-x` no disco. Como nada foi adicionado ao índice (sem commit, conforme combinado), a conferência de `git ls-files -s docker/` = `100755` fica para quem fizer o `git add`/commit.
