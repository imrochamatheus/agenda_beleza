# D-003 — Desenho: docker-compose (app, worker, PostgreSQL), bootstrap do Prisma e `.env.example` (issue #4, E0.2)

Entrada: `docs/demandas/D-003/spec.md` (CA-1..CA-10, RN-1..RN-10, S-1..S-8), `docs/demandas/D-003/issue-4.md` e `docs/demandas/D-001/devops.md` (§1 E0.2, ajustes 1–10). Branch `feat/d-003-docker-compose`, empilhada sobre `feat/d-002-scaffolding` (PR #57). Ambiente: Node v24.21.0, npm 11.19.0, Docker 29.8.1, Compose v5.5.1.

Todas as decisões abaixo foram **validadas em 2026-11-18** num diretório descartável (`npm ci`, `prisma generate`, `prisma migrate deploy`, `next build`, `next start`, Vitest, `esbuild` e um `docker build` de sonda com `node:24-trixie-slim` e `postgres:17`). Os resultados aparecem como "verificado" em cada item.

## 1. Resumo da solução

- Uma imagem multi-stage (`node:24-trixie-slim`) serve a app e o worker. O papel vem do argumento do entrypoint: `entrypoint.sh app` valida o ambiente, roda `prisma migrate deploy` e faz `exec node …/next start`; `entrypoint.sh worker` valida o ambiente e faz `exec node dist/worker/main.js`.
- Prisma **7.10.1** com o gerador `prisma-client` (saída TS em `src/generated/prisma`) e o driver adapter `@prisma/adapter-pg`. A URL fica em `prisma.config.ts`, lida de `process.env` **sem** o helper `env()`, para o `generate` e o `build` funcionarem sem `DATABASE_URL` (CA-7).
- O cliente é gerado por um **script explícito** `db:generate`, sem `postinstall`.
- O worker e o `check-env` são empacotados com **esbuild** em `dist/` (JS ESM). Localmente, `npm run worker` empacota e executa o mesmo JS.
- O PostgreSQL usa **`postgres:17`**, publica `${POSTGRES_PORT:-5432}:5432` para os testes locais, e um script de `initdb` cria a base de teste a partir do nome em `TEST_DATABASE_URL`.
- A lógica fica em módulos testáveis (`env.ts`, `check-env.ts`, `health.ts`, `worker/stub.ts`), e os pontos de entrada são finos (até 3 linhas executáveis) e cobertos por testes que os importam.

### 1.1 Versões fixadas

`npm install --package-lock-only` sobre o `package.json`/lock atuais terminou com código 0, sem `--legacy-peer-deps` e sem `ERESOLVE`. `npm audit --omit=dev`: 0 vulnerabilidades.

| Pacote | Versão | Seção | Observação |
|---|---|---|---|
| prisma | 7.10.1 | dependencies | o CLI precisa estar na imagem final para o `migrate deploy`; engines `^20.19 \|\| ^22.12 \|\| >=24.0`; peer `typescript >=5.4` (opcional) aceita a 6.0.3 |
| @prisma/client | 7.10.1 | dependencies | runtime do cliente gerado; mesma versão do CLI |
| @prisma/adapter-pg | 7.10.1 | dependencies | exigido pelo Prisma 7 (cliente sem engine Rust); traz `pg` ^8.16.3 |
| zod | 4.6.7 | dependencies | `z.url({ protocol })` e `z.enum().default()`; typecheck limpo com TS 6.0.3 (verificado) |
| esbuild | 0.28.2 | devDependencies | bundle do worker e do `check-env` (ver 1.2) |

**Atenção ao instalar:** a dist-tag `latest` do pacote `prisma` aponta hoje para **`8.0.0-rc.34`** (pré-lançamento), enquanto `@prisma/client@latest` é a 7.10.1. Use sempre a versão explícita (`npm install prisma@7.10.1 …`). Um `npm install prisma` sem versão traria o RC e quebraria o par CLI/cliente.

**Scripts de instalação (npm 11.19):** o npm avisa `install-scripts … not yet covered by allowScripts` para `prisma`, `@prisma/engines` e `esbuild`. Com `strict-allow-scripts=false` (padrão), os scripts **rodam**: no `docker build` sem cache, o `schema-engine-debian-openssl-3.0.x` estava presente logo após o `npm ci` (verificado). Para remover o aviso e não depender do modo não estrito, o T-1 registra a aprovação com `npm install-scripts approve prisma @prisma/engines esbuild` (campo `allowScripts` no `package.json`, ignorado por npm mais antigos).

### 1.2 Decisões e alternativas descartadas

| Tema | Decisão | Descartado e motivo |
|---|---|---|
| Geração do cliente | Script `db:generate` explícito; a ordem documentada é `npm ci → npm run db:generate → typecheck/lint/build/test` (a mesma que a E0.3 vai usar) | `postinstall`: na camada de dependências do Dockerfile só existem `package.json` e lock, então o `prisma generate` falharia sem o schema. Além disso, scripts do projeto em `npm ci --omit=dev` e a tendência do npm de bloquear scripts tornam o comportamento implícito frágil. |
| URL no `prisma.config.ts` | `datasource.url: process.env.DATABASE_URL ?? ''` e `process.loadEnvFile()` dentro de `try/catch` para o uso local | `env('DATABASE_URL')` de `prisma/config`: **quebra** o `prisma generate` sem a variável (`PrismaConfigEnvError`, verificado). `dotenv`: dependência nova sem necessidade, porque o Node 24 já tem `process.loadEnvFile`, que não sobrescreve variáveis já definidas (verificado). |
| `migrate deploy` sem migrações | Não versionar `prisma/migrations/` agora; a E0.4 cria o diretório | Verificado: com o diretório ausente **e** com ele vazio, `migrate deploy` imprime "No pending migrations to apply.", sai com 0 e cria `_prisma_migrations`. A segunda execução também sai com 0 (CA-4). Sem `DATABASE_URL`, sai com 1 ("Connection url is empty"). |
| Bundle do worker | esbuild: `--bundle --platform=node --format=esm --target=node24 --packages=external --outbase=src --outdir=dist` | `tsc`: não reescreve o alias `@/` e exigiria extensões `.js` nos imports. `tsx`/remoção de tipos do Node em runtime: frágil (devops ajuste 3), não resolve aliases. `tsup`: só uma camada sobre o esbuild. O esbuild lê os `paths` do `tsconfig.json`, empacota o cliente gerado e deixa `node_modules` externo (verificado: bundle de 2,6 kB executa `SELECT 1` com sucesso). |
| Imagem base | `node:24-trixie-slim` (major do `.nvmrc`) | Alpine: exigiria o engine `linux-musl` e testes extras. A slim de trixie já traz `libssl.so.3`, e o `migrate deploy` roda nela como usuário `node` (uid 1000) (verificado). |
| Saída do Next | `next build` padrão; a imagem final copia `node_modules` podado (`npm prune --omit=dev`) | `output: 'standalone'`: o CLI do Prisma e o `prisma.config.ts` exigem o `node_modules` completo de produção mesmo assim. Otimizar o tamanho da imagem fica para depois. |
| Major do PostgreSQL | `postgres:17` | 18: muda o layout do volume (`PGDATA` em `/var/lib/postgresql/18/docker`) e não traz nada que a v1 precise; 16: sem motivo para ficar atrás. A 17 é a sugestão do `devops.md` (D-001) e é suportada até 2029. A E0.3 usa a mesma tag. |
| Base de teste | Script em `/docker-entrypoint-initdb.d` que lê o nome da base de `TEST_DATABASE_URL`; com volume já existente, o README dá o `createdb` | `globalSetup` do Vitest criando a base: seria aplicado também ao projeto `unit` (configuração por projeto é instável na 5.1.1, ver R-2 da D-002) e invade a estratégia da E0.5. |
| Acesso ao banco no health | Cliente Prisma (`$queryRaw\`SELECT 1\``) via `obterPrisma()` (S-4) | `pg` direto: seria uma dependência a mais e não exercitaria o cliente que a E0.4 vai usar. |
| Healthcheck da app no compose | `node -e "fetch('http://127.0.0.1:3000/api/health')…"` | `curl`/`wget`: não existem na imagem slim; instalá-los aumenta a superfície da imagem. |

## 2. Componentes afetados

| Caminho | Natureza | Tarefa |
|---|---|---|
| `package.json`, `package-lock.json` | deps de 1.1, `allowScripts`, scripts novos (§3.1) | T-1 |
| `prisma/schema.prisma` | `generator client` (`prisma-client`, `output = "../src/generated/prisma"`) e `datasource db` (`provider = "postgresql"`, sem `url`); nenhum `model` | T-1 |
| `prisma.config.ts` | `defineConfig({ schema, migrations: { path: 'prisma/migrations' }, datasource: { url } })` | T-1 |
| `.gitignore` | `src/generated/` e `dist/`, com comentário | T-1 |
| `eslint.config.mjs` | `globalIgnores`: `src/generated/**` e `dist/**`, com comentário | T-1 |
| `vitest.config.ts` | `coverage.exclude`: `src/generated/**` (comentário: "cliente Prisma gerado"); carregamento de `.env` (§3.6) | T-1 (exclusão e `.env`); T-2 (remove `passWithNoTests`) |
| `src/server/env.ts` (+ `env.test.ts`) | schema zod, chaves de infraestrutura e validação | T-2 |
| `src/server/check-env.ts` (+ teste) | lógica do `check-env` | T-2 |
| `src/scripts/check-env.ts` (+ teste) | ponto de entrada do `check-env` | T-2 |
| `src/server/db.ts` (+ teste) | fábrica e cache do `PrismaClient` | T-2 |
| `src/server/health.ts` (+ teste) | verificação do banco com timeout | T-2 |
| `src/app/api/health/route.ts` (+ `route.test.ts`) | Route Handler `GET` | T-2 |
| `src/worker/stub.ts` (+ teste), `src/worker/main.ts` (+ teste) | stub do worker e ponto de entrada | T-2 |
| `tests/integration/health.test.ts`, `tests/integration/support/banco.ts` | CA-9 com PostgreSQL real | T-2 |
| `.env.example` | variáveis comentadas (§3.5) | T-2 |
| `Dockerfile`, `.dockerignore` | imagem multi-stage | T-3 |
| `docker-compose.yml` | 3 serviços | T-3 |
| `docker/entrypoint.sh` | papéis `app` e `worker` | T-3 |
| `docker/postgres/initdb/10-base-de-teste.sh` | cria a base de teste | T-3 |
| `README.md`, `CLAUDE.md` ("Comandos e cobertura") | documentação | T-4 |

## 3. Interfaces

### 3.1 Scripts npm (T-1)

```json
"db:generate": "prisma generate",
"db:migrate:deploy": "prisma migrate deploy",
"build:node": "esbuild src/worker/main.ts src/scripts/check-env.ts --bundle --platform=node --format=esm --target=node24 --packages=external --outbase=src --outdir=dist",
"worker": "npm run build:node && node --env-file-if-exists=.env dist/worker/main.js"
```

- `build:node` gera `dist/worker/main.js` e `dist/scripts/check-env.js`. O `build` continua sendo só `next build` (CA-7 e E2E sem mudança).
- `npm run worker` (S-8) roda o **mesmo JS** da imagem; o `.env` é carregado pelo Node, sem dependência nova. Os caminhos são relativos, o que funciona com espaço e acento.
- Os scripts existentes não mudam. `test`, `typecheck`, `lint` e `build` passam a exigir `npm run db:generate` antes (documentado no T-4).

### 3.2 `src/server/env.ts` (T-2)

Nada é validado no import (RN-6).

```ts
export const ADAPTADORES = ['simulado', 'real'] as const;

export const esquemaEnv = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
  EMAIL_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
  WHATSAPP_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
  MP_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
  TURNSTILE_ADAPTER: z.enum(ADAPTADORES).default('simulado'),
});
export type Env = z.infer<typeof esquemaEnv>;

/** Chaves do .env.example que o runtime da app não lê (S-3): usadas pelo compose ou pelos testes. */
export const CHAVES_FORA_DO_RUNTIME = [
  'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_PORT', 'TEST_DATABASE_URL',
] as const;

/** União comparada pelo teste de CA-3. */
export function chavesDeclaradas(): string[];

export class ErroDeAmbiente extends Error {
  readonly variaveis: string[]; // nomes das variáveis inválidas, ordenados
}

/** Lança ErroDeAmbiente; a mensagem contém o nome de cada variável inválida (nunca o valor). */
export function validarEnv(fonte: Record<string, string | undefined>): Env;
```

- Uma string vazia conta como ausente (pré-processar `''` → `undefined`), para que `APP_URL=` caia no padrão e `DATABASE_URL=` falhe nomeando a variável.
- A mensagem do erro **não** inclui o valor da variável, porque `DATABASE_URL` contém senha.
- E0.6, E6.6 e E7.2 acrescentam campos a `esquemaEnv` e chaves ao `.env.example`; o teste de CA-3 mantém os dois iguais.

### 3.3 `check-env`, health e banco (T-2)

```ts
// src/server/check-env.ts
export function executarCheckEnv(fonte: Record<string, string | undefined>, saida: { log(m: string): void; error(m: string): void }): 0 | 1;

// src/scripts/check-env.ts  (ponto de entrada; só isto)
process.exitCode = executarCheckEnv(process.env, console);

// src/server/db.ts
export function criarPrisma(url: string): PrismaClient;     // new PrismaClient({ adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 3000 }) })
export function obterPrisma(url?: string): PrismaClient;    // padrão: process.env.DATABASE_URL, lido na chamada; cache por URL em globalThis
export async function encerrarPrisma(): Promise<void>;      // $disconnect em todos os clientes do cache (testes e, na E0.7, o worker)

// src/server/health.ts
export const TIMEOUT_HEALTH_MS = 3000;
export async function verificarBanco(prisma: PrismaClient, timeoutMs?: number): Promise<boolean>; // SELECT 1 em corrida com o timeout; nunca lança

// src/app/api/health/route.ts
export const dynamic = 'force-dynamic';
export async function GET(): Promise<Response>;
```

Contrato HTTP de `GET /api/health`, sem autenticação:

| Situação | Status | Corpo | Cabeçalhos |
|---|---|---|---|
| `SELECT 1` ok | 200 | `{"status":"ok"}` | `Cache-Control: no-store` |
| falha, timeout ou `DATABASE_URL` ausente | 503 | `{"status":"indisponivel"}` | `Cache-Control: no-store` |

O corpo da resposta 503 não traz mensagem, host nem credencial (RN-10). O timeout de 3 s fica abaixo do `timeout: 5s` do healthcheck e do limite de 5 s do CA-5. Verificado: uma porta fechada falha em cerca de 50 ms, e um IP sem rota respeita o `connectionTimeoutMillis` (~3 s). O `next build` passa sem `DATABASE_URL`, e a rota sai como `ƒ` (dinâmica).

### 3.4 Worker (T-2)

```ts
// src/worker/stub.ts
export const INTERVALO_HEARTBEAT_MS = 30_000;
export interface DependenciasWorker {
  env: Record<string, string | undefined>;
  log: (linha: string) => void;            // uma linha JSON por evento
  erro: (linha: string) => void;
  sinais: { once(evento: 'SIGTERM' | 'SIGINT', fn: () => void): unknown };
  sair: (codigo: number) => void;
  intervaloMs?: number;
}
export function iniciarWorker(deps: DependenciasWorker): { parar(): void };

// src/worker/main.ts  (ponto de entrada; só isto)
iniciarWorker({ env: process.env, log: console.log, erro: console.error, sinais: process, sair: (c) => process.exit(c) });
```

Comportamento:
1. `validarEnv(env)`. Se falhar, `erro(...)` com os nomes das variáveis e `sair(1)`, sem iniciar o heartbeat.
2. Emite logo `{"evento":"worker.heartbeat","em":"<ISO UTC>"}` e repete a cada `intervaloMs` (S-7).
3. Em `SIGTERM`/`SIGINT`: `clearInterval`, log `{"evento":"worker.encerrando","sinal":"SIGTERM"}` e `sair(0)` (RN-8, CA-10).
4. Não acessa o banco (o pg-boss chega na E0.7).

### 3.5 `.env.example` (T-2)

Cada variável tem um comentário. Os valores do Postgres são marcados como **"somente desenvolvimento"** (RN-3).

```
POSTGRES_USER=agenda
POSTGRES_PASSWORD=agenda_dev
POSTGRES_DB=agenda_beleza
POSTGRES_PORT=5432
DATABASE_URL=postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza
TEST_DATABASE_URL=postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza_test
APP_URL=http://localhost:3000
EMAIL_ADAPTER=simulado
WHATSAPP_ADAPTER=simulado
MP_ADAPTER=simulado
TURNSTILE_ADAPTER=simulado
```

O comentário de `POSTGRES_PORT` avisa que, ao trocar a porta, é preciso ajustar também a porta em `DATABASE_URL` e `TEST_DATABASE_URL`, porque o `--env-file` do Node não interpola variáveis.

### 3.6 Testes e variáveis de ambiente (T-1, T-2)

- No topo de `vitest.config.ts`, carregue `.env` com `process.loadEnvFile(<caminho absoluto via fileURLToPath>)` dentro de `try/catch`, ignorando só o erro de arquivo inexistente. Variáveis já definidas no ambiente (CI) prevalecem (verificado). Os processos de teste herdam o ambiente.
- `tests/integration/support/banco.ts` exporta `urlBancoDeTeste(): string`, que:
  - lança `Error('TEST_DATABASE_URL não definida: suba o PostgreSQL (docker compose up -d postgres) e configure o .env')` se a variável faltar (o teste falha, sem `skip`; S-5);
  - lança um erro se `TEST_DATABASE_URL === DATABASE_URL` (proteção do RN-9).
- O teste de CA-9 usa `vi.stubEnv('DATABASE_URL', urlBancoDeTeste())` e chama o `GET` da rota: exercita a rota inteira contra o banco real de teste, nunca contra a base de desenvolvimento. `afterAll(encerrarPrisma)`.
- O teste de CA-5 (projeto `unit`, sem PG) faz `vi.stubEnv('DATABASE_URL', 'postgresql://x:y@127.0.0.1:1/z')`, espera 503 em menos de 5 s e confere que o corpo é exatamente `{"status":"indisponivel"}`. É uma conexão real que falha, sem mock de banco.

### 3.7 Imagem, compose e entrypoint (T-3)

**Dockerfile** (um único arquivo; `ARG NODE_IMAGE=node:24-trixie-slim`):
- Estágio `build`: `ENV NEXT_TELEMETRY_DISABLED=1`; `COPY package.json package-lock.json .npmrc` → `npm ci` → `COPY . .` → `npm run db:generate && npm run build && npm run build:node && npm prune --omit=dev`.
- Estágio final: `ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 TZ=UTC HOSTNAME=0.0.0.0 PORT=3000`. Copia com `--chown=node:node` só o necessário: `package.json`, `next.config.ts`, `prisma.config.ts`, `prisma/`, `node_modules/`, `.next/` e `dist/`. Copia `docker/entrypoint.sh` para `/usr/local/bin/` com modo 0755. `USER node`, `EXPOSE 3000`, `ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]`, `CMD ["app"]`.
- A pasta `src/` não entra na imagem final: o cliente gerado já está empacotado em `.next/` e em `dist/`.

**`docker/entrypoint.sh`** (`#!/bin/sh`, `set -eu`):
```sh
node /app/dist/scripts/check-env.js            # nos dois papéis; sai ≠ 0 nomeando a variável
case "${1:-}" in
  app)    /app/node_modules/.bin/prisma migrate deploy
          exec node /app/node_modules/next/dist/bin/next start ;;
  worker) exec node /app/dist/worker/main.js ;;
  *)      echo "uso: entrypoint.sh app|worker" >&2; exit 64 ;;
esac
```
O worker também valida o ambiente em `iniciarWorker`, porque `npm run worker` roda fora do container.

**`docker-compose.yml`:**
- `postgres`:
  - `image: postgres:17` com `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` vindos do `.env`, com padrões iguais aos do `.env.example`, e `TEST_DATABASE_URL: ${TEST_DATABASE_URL:-}`;
  - volume `pgdata:/var/lib/postgresql/data` e `./docker/postgres/initdb:/docker-entrypoint-initdb.d:ro`;
  - porta `"${POSTGRES_PORT:-5432}:5432"`;
  - healthcheck `pg_isready -h 127.0.0.1 -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"`, com intervalo de 2 s e 30 tentativas. O `-h 127.0.0.1` força TCP: durante o `initdb`, o servidor temporário só escuta no socket Unix, e sem isso o healthcheck ficaria verde antes da hora.
- `app`:
  - `build: .`, `image: agenda-beleza:dev`, `command: ["app"]`, `init: true`;
  - `env_file: [{ path: .env, required: false }]`, para o `docker compose build`/`config` funcionar sem `.env` (CA-7, verificado);
  - `environment.DATABASE_URL: postgresql://${POSTGRES_USER:-agenda}:${POSTGRES_PASSWORD:-agenda_dev}@postgres:5432/${POSTGRES_DB:-agenda_beleza}`;
  - `ports: ["3000:3000"]`;
  - `depends_on: postgres: condition: service_healthy`;
  - healthcheck `["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]`, com intervalo de 5 s, timeout de 5 s, 6 tentativas e `start_period` de 30 s (cobre o `migrate deploy`).
- `worker`:
  - `image: agenda-beleza:dev` (a mesma imagem, sem segundo build), `command: ["worker"]`, `init: true`;
  - o mesmo `env_file` e a mesma sobrescrita de `DATABASE_URL`;
  - `depends_on: app: condition: service_healthy`;
  - sem `ports`, sem `healthcheck` e sem `stop_grace_period` (E0.7).
- Sem `restart:`, para que uma falha de inicialização apareça como `exited (1)`.
- `volumes: pgdata: {}`.

**`docker/postgres/initdb/10-base-de-teste.sh`:**
1. Extrai o nome da base de `TEST_DATABASE_URL` (o trecho depois da última `/`, sem a query string).
2. Se a variável estiver vazia, não faz nada.
3. Valida o nome com `^[a-z0-9_]+$` e sai com 1 se o nome for igual a `POSTGRES_DB`.
4. Executa `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"<nome>\""`.

O script só roda com o volume vazio. Para um volume já existente, o README dá o comando `docker compose exec postgres createdb -U agenda agenda_beleza_test`. O superusuário da imagem tem `CREATEDB`, o que atende à E0.5 em desenvolvimento e na CI.

**`.dockerignore`:** `.git`, `node_modules`, `.next`, `dist`, `src/generated`, `coverage`, `playwright-report`, `test-results`, `blob-report`, `.env`, `.env*.local`, `*.tsbuildinfo` e `docs`. O `.env.example` continua permitido. Na imagem, o `prisma.config.ts` não encontra `.env` e usa só as variáveis do ambiente.

## 4. Dados

Não há entidade, constraint, índice nem migração. O `migrate deploy` só cria `_prisma_migrations` (verificado). O impacto em dados se limita a três pontos: a major do Postgres, a base de teste separada e o comportamento do `migrate deploy` sem migrações. **O DBA é acionado só para revisão (T-5)**, sem tarefa de implementação. Pontos a avaliar:
1. A tag `postgres:17` e a coerência com a E0.3.
2. O script de `initdb` (extração e validação do nome, proteção contra a base de desenvolvimento).
3. Se o superusuário da imagem para dev e CI basta para a estratégia de template por worker da E0.5.
4. O `migrate deploy` sem `prisma/migrations`.
5. O `connectionTimeoutMillis` de 3 s do adapter.

## 5. Infraestrutura

O DevOps é o responsável principal (T-1, T-3 e T-4).

- **Variáveis novas:** as de §3.5.
- **Containers:** os 3 serviços de §3.7.
- **CI:** nenhuma; a E0.3 consome `db:generate`, `db:migrate:deploy`, `build:node`, `postgres:17` e `TEST_DATABASE_URL`.
- **Observabilidade:** logs JSON de uma linha do worker e healthcheck HTTP da app.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como foi atendida |
|---|---|---|
| Escopo por salão no servidor | Não | Não há entidades de tenant nem autenticação; o health é público por definição (RN-10) e não expõe dados. |
| Exclusion constraint anti-sobreposição | Não (E0.4) | A imagem `postgres:17` oficial traz o contrib (`btree_gist`), e a E0.4 cria a extensão via SQL bruto. |
| UTC e fuso do salão | Parcial | `TZ=UTC` na imagem; o heartbeat usa ISO UTC (`toISOString`). Não há lógica de fuso de salão. |
| Adaptadores de integração | Parcial | Só os quatro seletores (`simulado\|real`, padrão `simulado`) entram no schema e no `.env.example` (RN-1). Os adaptadores são da E0.6. |
| Soft delete e anonimização | Não | Não há entidades. |
| Salão suspenso somente leitura | Não | Não há entidades. |
| Idempotência de webhooks e mensagens | Não (E0.7, E6.x, E7.x) | O worker é um stub sem fila. |
| Auditoria do super admin | Não | Não há super admin. |
| Segredos | Sim | `.env` fora do git e da imagem (`.dockerignore`); a mensagem de erro do env nunca imprime valores; o corpo 503 não traz detalhes. |

## 7. Riscos e decisões

| # | Risco | Mitigação |
|---|---|---|
| R-1 | A dist-tag `latest` do `prisma` é um RC 8.x | Versões explícitas em §1.1; o T-1 confere `npm ls prisma @prisma/client` = 7.10.1. |
| R-2 | O npm passa a bloquear os scripts de instalação (modo estrito) e o schema engine não chega | `allowScripts` aprovado no T-1. Além disso, o `prisma generate` baixa o engine se ele faltar (verificado), e o Dockerfile roda `db:generate` antes do `prune`. |
| R-3 | Typecheck, lint, test e build quebram depois do `npm ci` sem `db:generate` | Documentado no `CLAUDE.md` e no README (T-4); a E0.3 segue a mesma ordem. |
| R-4 | A mudança na PR #57 (base empilhada) exige rebase | Os arquivos de E0.1 tocados aqui são poucos (`package.json`, os configs e o `CLAUDE.md`); o rebase cabe ao líder. |
| R-5 | `npm test` passa a exigir PG; quem não tem o compose no ar vê falha | Essa falha é intencional (S-5), com mensagem que nomeia `TEST_DATABASE_URL`. O README e o `CLAUDE.md` indicam `docker compose up -d postgres`. |
| R-6 | Volume antigo sem base de teste | Comando `createdb` no README; a base de teste nunca é a de desenvolvimento (guarda em `banco.ts` e no script de `initdb`). |
| R-7 | Pontos de entrada com efeito colateral no import reduzem a cobertura | Entradas de até 3 linhas executáveis, testadas por import com `vi.mock` do módulo de lógica (que não é mock de banco) ou com `vi.stubEnv`. |
| R-8 | Imagem grande (cerca de 720 MB de `node_modules` na sonda) | Aceito na v1; `standalone` fica como otimização futura (ver 1.2). |
| R-9 | Senha do Postgres com caracteres especiais quebra a URL montada no compose | Valores de desenvolvimento são alfanuméricos; o comentário no `.env.example` avisa que a senha precisa ser *URL-encoded*. |

## 8. Estratégia de testes

| CA | Tipo | Onde | Tarefa |
|---|---|---|---|
| CA-1 | Manual | `cp .env.example .env && docker compose up -d --wait; docker compose ps; curl -fsS localhost:3000/` | T-4 (tester repete) |
| CA-2 | Manual | `docker compose exec app id -u`, `… worker id -u` (≠ 0), `docker compose top worker` | T-4 |
| CA-3 | Unitário | `src/server/env.test.ts`: `util.parseEnv` do Node sobre `.env.example` × `chavesDeclaradas()`; a mensagem de falha lista o que sobra e o que falta em cada lado | T-2 |
| CA-4 | Manual | `docker compose down && docker compose up -d --wait`; `docker compose logs app` sem erro do Prisma | T-4 |
| CA-5 | Unitário + manual | `src/app/api/health/route.test.ts` (porta fechada, 503, < 5 s, corpo sem detalhes); manual com `docker compose stop postgres` | T-2, T-4 |
| CA-6 | Unitário | `env.test.ts` (sem `DATABASE_URL`, `APP_URL=nao-url`, `.env.example` válido, vazio = ausente, mensagem sem valor) e `check-env.test.ts` (retorno 0/1 e saída) | T-2 |
| CA-7 | Manual | `env -u DATABASE_URL` sem `.env`: `npm run db:generate`, `npm run build`, `docker compose build` | T-4 |
| CA-8 | Manual | `docker compose logs app \| grep -i migrat` presente; `docker compose logs worker` sem `migrat` e com `worker.heartbeat` | T-4 |
| CA-9 | Integração (PG real) | `tests/integration/health.test.ts` com `urlBancoDeTeste()` | T-2 |
| CA-10 | Unitário + manual | `stub.test.ts` (SIGTERM e SIGINT → `sair(0)`, intervalo limpo, com fake timers); manual: `docker compose stop worker` e `docker inspect -f '{{.State.ExitCode}}'` = 0 em < 10 s | T-2, T-4 |

Os testes adicionais para a cobertura ficam em T-2:
- `db.test.ts`: o cache por URL devolve a mesma instância e o `encerrarPrisma` esvazia o cache;
- `health.test.ts`: o timeout devolve `false`, usando um `PrismaClient` real com um IP sem rota e `timeoutMs` curto, ou uma promessa que nunca resolve injetada via objeto com `$queryRaw`. Esse objeto não é um mock de banco: é um *stub* do contrato de timeout. Prefira o IP sem rota se ficar abaixo de 1 s;
- `main.test.ts` (com `vi.mock('./stub')`: confere a chamada com `process`) e `src/scripts/check-env.test.ts` (com `vi.stubEnv`: confere o `process.exitCode`, restaurado no fim).

A lógica nova soma cerca de 120 linhas, e os pontos de entrada ficam em 3 linhas executáveis, todos exercitados. A meta é que cada arquivo novo de `src/` fique em ≥ 95% de linhas, para manter a cobertura global ≥ 90% em `npm run test:coverage` (unidade e integração, com o PG no ar). Playwright não muda.

## 9. Tarefas

```
T-1 (devops) ──┬── T-2 (desenvolvedor) ──┬── T-4 (devops) ── tester
               └── T-3 (devops) ─────────┤
                                         └── T-5 (dba, revisão; em paralelo com T-4)
```
T-2 e T-3 rodam **em paralelo** (não compartilham arquivos). T-4 e T-5 também rodam em paralelo.

### T-1 — Dependências, scripts e bootstrap do Prisma
- **Responsável:** devops. **Dependências:** nenhuma.
- **Arquivos sob posse:** `package.json`, `package-lock.json`, `prisma/schema.prisma`, `prisma.config.ts`, `.gitignore`, `eslint.config.mjs`, `vitest.config.ts`, `docs/demandas/D-003/devops.md` (seção T-1).
- **Entregável:**
  - as deps de §1.1, com versões explícitas, e `allowScripts` para `prisma`, `@prisma/engines` e `esbuild`;
  - os scripts de §3.1;
  - o schema sem models e o config de §1.2;
  - as exclusões comentadas de `src/generated` (gitignore, ESLint e cobertura) e de `dist` (gitignore e ESLint);
  - o carregamento de `.env` no `vitest.config.ts` (§3.6). O `passWithNoTests` continua até o T-2.
- **Critério de conclusão:**
  - `npm ci` sem aviso `install-scripts` nem `ERESOLVE`;
  - `npm ls prisma @prisma/client @prisma/adapter-pg zod esbuild` mostra as versões de §1.1;
  - sem `.env` e com `env -u DATABASE_URL`: `npm run db:generate`, `npm run typecheck`, `npm run lint` e `npm run build` terminam com 0;
  - `npm test` continua verde (os testes de E0.1 passam);
  - saídas registradas no `devops.md`.

### T-2 — Código da app: env, check-env, health, banco, worker stub, `.env.example` e testes
- **Responsável:** desenvolvedor. **Dependências:** T-1. **Paralelo com:** T-3.
- **Arquivos sob posse:**
  - `src/server/env.ts`, `src/server/env.test.ts`;
  - `src/server/check-env.ts`, `src/server/check-env.test.ts`;
  - `src/scripts/check-env.ts`, `src/scripts/check-env.test.ts`;
  - `src/server/db.ts`, `src/server/db.test.ts`;
  - `src/server/health.ts`, `src/server/health.test.ts`;
  - `src/app/api/health/route.ts`, `src/app/api/health/route.test.ts`;
  - `src/worker/stub.ts`, `src/worker/stub.test.ts`, `src/worker/main.ts`, `src/worker/main.test.ts`;
  - `tests/integration/health.test.ts`, `tests/integration/support/banco.ts`;
  - `.env.example`;
  - `vitest.config.ts`, só para remover o `passWithNoTests` e o comentário dele, depois do T-1;
  - `docs/demandas/D-003/dev.md`.
- **Entregável:** as interfaces de §3.2 a §3.6, exatamente com essas assinaturas e caminhos, e os testes de §8 (CA-3, CA-5, CA-6, CA-9, CA-10 e os de cobertura).
- **Critério de conclusão:**
  - com `docker compose up -d postgres` (ou um PG equivalente) e a base de teste criada: `npm run db:generate`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:node` e `npm run test:coverage` terminam com 0, e a cobertura de linhas é ≥ 90%;
  - `npm run worker` imprime o heartbeat e sai com 0 com Ctrl-C;
  - sem `TEST_DATABASE_URL`, o teste de CA-9 **falha** nomeando a variável;
  - evidências registradas no `dev.md`.
  - Se o T-3 ainda não estiver pronto, use um `docker run` descartável de `postgres:17` para o PG.

### T-3 — Imagem, compose, entrypoint e initdb
- **Responsável:** devops. **Dependências:** T-1 (scripts e caminhos `dist/`). **Paralelo com:** T-2.
- **Arquivos sob posse:** `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker/entrypoint.sh`, `docker/postgres/initdb/10-base-de-teste.sh`, `docs/demandas/D-003/devops.md` (seção T-3).
- **Entregável:** o que está em §3.7.
- **Critério de conclusão:**
  - `docker compose config` sem `.env` termina com 0;
  - `shellcheck` (se estiver disponível) ou `sh -n` limpos nos dois scripts;
  - o `docker build` só é validado no T-4, porque depende dos arquivos do T-2. Se o T-2 já tiver terminado, o T-3 pode antecipar a validação.
- **Observação sobre a posse do `devops.md`:** o T-1 e o T-3 têm o mesmo dono (devops) e escrevem em seções distintas, em sequência dentro do mesmo agente.

### T-4 — Validação ponta a ponta, README e CLAUDE.md
- **Responsável:** devops. **Dependências:** T-2 e T-3. **Paralelo com:** T-5.
- **Arquivos sob posse:** `README.md`, `CLAUDE.md` (só a seção "Comandos e cobertura" e a frase de status da linha 7), `docs/demandas/D-003/devops.md` (seção T-4). Se a validação revelar um ajuste em `Dockerfile`, compose ou scripts, ele também pode editá-los, já que são do mesmo dono.
- **Entregável:**
  - **README** com as seções:
    - "Executar com Docker": pré-requisitos, `cp .env.example .env`, `docker compose up -d --wait`, as URLs, a porta 3000 que precisa estar livre, `POSTGRES_PORT` para a 5432 ocupada (com o ajuste nas URLs), `down` e `down -v`, e o aviso de que a publicação em VPS fica para depois;
    - "Testes": `docker compose up -d postgres`, `npm ci`, `npm run db:generate`, `npm test`, `npm run test:coverage`, o `createdb` para volume antigo e o aviso de que os testes de integração usam só `TEST_DATABASE_URL`.
  - **`CLAUDE.md`:** a tabela atualizada com `db:generate` (obrigatório depois do `npm ci`), `db:migrate:deploy`, `build:node`, `worker`, `docker compose up -d --wait`/`down`, o PG como pré-requisito de `npm test`/`test:integration`/`test:coverage` e a remoção do "passa sem testes".
  - Execução e registro de CA-1, CA-2, CA-4, CA-5 (manual), CA-7, CA-8 e CA-10, com comandos e saídas, mais o gate completo.
- **Critério de conclusão:** todos os CAs manuais com evidência no `devops.md`; build, lint, typecheck e `test:coverage` (≥ 90%) passando no estado final.

### T-5 — Revisão do DBA
- **Responsável:** dba. **Dependências:** T-3. **Paralelo com:** T-4.
- **Arquivos sob posse:** `docs/demandas/D-003/dba.md`.
- **Entregável:** parecer sobre os 5 pontos de §4.
- **Critério de conclusão:** parecer "aprovado" ou "ajustes" com uma lista objetiva. Um ajuste vira retrabalho de T-3 ou T-2 (com o mesmo dono do arquivo) antes do tester.

### Mapeamento CA → tarefa

| CA | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Tarefa | T-3, T-4 | T-3, T-4 | T-2 | T-3, T-4 | T-2, T-4 | T-2 | T-1, T-3, T-4 | T-3, T-4 | T-2 | T-2, T-3, T-4 |

Nenhuma ferramenta nova sem justificativa: o Prisma e o zod são exigidos pela stack e pela issue, o `@prisma/adapter-pg` é exigido pelo Prisma 7 e o esbuild está justificado em 1.2. Não há ADR: as decisões valem só para esta demanda, e as transversais (major do PG e ordem do `db:generate`) ficam no `CLAUDE.md` pelo T-4.
