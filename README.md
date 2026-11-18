# Agenda Beleza

SaaS multi-salão de agendamento para salões de beleza. A especificação da v1 está em [`PLAN.md`](PLAN.md).

Stack: Next.js + TypeScript, PostgreSQL 17, Prisma 7, Vitest e Playwright. Tudo roda localmente com adaptadores **simulados**, sem nenhuma credencial real.

## Executar com Docker

Pré-requisitos: Docker com Compose v2 e as portas **3000** (app) e **5432** (PostgreSQL) livres no host.

```bash
cp .env.example .env          # valores de desenvolvimento; funciona sem alterações
docker compose up -d --wait   # builda a imagem e espera postgres e app ficarem saudáveis
```

| Serviço | O que faz | Acesso |
|---|---|---|
| `postgres` | PostgreSQL 17; na primeira inicialização cria também a base de testes de `TEST_DATABASE_URL` | `localhost:5432` |
| `app` | Valida o ambiente, aplica as migrações (`prisma migrate deploy`) e sobe o Next.js | http://localhost:3000 e http://localhost:3000/api/health |
| `worker` | Processo separado (mesma imagem); por ora só emite um heartbeat em JSON | `docker compose logs -f worker` |

App e worker rodam como usuário não root. Só a app aplica migrações.

- **Porta 5432 ocupada:** defina `POSTGRES_PORT` no `.env` (por exemplo, `5433`) e troque a porta também em `DATABASE_URL` e `TEST_DATABASE_URL`, porque o Node não interpola variáveis do `.env`. Dentro do compose, a app sempre usa `postgres:5432`.
- **Porta 3000 ocupada:** libere-a antes de subir (ela é fixa no compose).
- **Parar:** `docker compose down` (mantém os dados) ou `docker compose down -v` (apaga o volume do banco).
- **Logs:** `docker compose logs app`, `docker compose logs worker`.

A publicação em servidor (VPS) ainda não está definida: este compose é só para desenvolvimento e testes locais.

## Desenvolvimento sem Docker para a app

```bash
nvm use                       # Node 24 (.nvmrc)
npm ci
npm run db:generate           # obrigatório depois de todo npm ci (gera o cliente Prisma)
cp .env.example .env
docker compose up -d postgres
npm run dev                   # http://localhost:3000
npm run worker                # em outro terminal; Ctrl-C encerra
```

## Testes

Os testes de integração rodam contra um PostgreSQL **real** (sem mocks de banco).

```bash
docker compose up -d postgres  # cria agenda_beleza_test na primeira subida
npm ci
npm run db:generate
npm test                       # unidade + integração
npm run test:coverage          # o mesmo, com o gate de 90% de linhas (relatório em coverage/)
npm run test:e2e               # build + Playwright (viewport de celular); libere a porta 3000 antes
```

- Os testes de integração usam **somente** `TEST_DATABASE_URL`, nunca `DATABASE_URL`, e recusam rodar se as duas forem iguais. Sem `TEST_DATABASE_URL`, eles falham com uma mensagem que nomeia a variável.
- **Volume antigo sem a base de testes** (criado antes do script de initdb): `docker compose exec postgres createdb -U agenda agenda_beleza_test`.
- **Volume parcialmente inicializado:** se o `TEST_DATABASE_URL` tiver um nome de base inválido (fora de `[a-z0-9_]`, com mais de 63 caracteres, igual a `POSTGRES_DB` ou a `postgres`, `template0` ou `template1`), a primeira subida do `postgres` falha com `exited (1)`, e o log diz o motivo. Nos `up` seguintes, o initdb não roda de novo, e o banco sobe **sem** a base de testes. Corrija a variável e rode `docker compose down -v` antes de subir de novo (ou crie a base com o `createdb` acima).
- Navegador do E2E (uma vez por máquina): `npx playwright install chromium`.

### Banco de teste e migrações

- **Cada execução de `npm run test:integration` (e de `npm test` e `npm run test:coverage`) apaga e recria o schema `public` da base de `TEST_DATABASE_URL`** (`DROP SCHEMA public CASCADE; CREATE SCHEMA public`) e depois aplica `prisma migrate deploy` nela. A guarda de `TEST_DATABASE_URL` roda antes de qualquer conexão. A base de `DATABASE_URL` nunca é tocada, e os dados da última execução ficam na base de teste para depuração.
- **Não rode duas execuções de testes de integração ao mesmo tempo** sobre a mesma base: uma apaga o schema da outra.
- **Teste único:** `npx vitest run --project integration tests/integration/db/reserva-exclusion.test.ts` (o reset e as migrações rodam do mesmo jeito).
- **`prisma db push` é proibido:** ele altera o banco sem migração e cria drift com o histórico. Também não use `prisma migrate reset` contra a base de desenvolvimento por engano: ele lê `DATABASE_URL`.
- **Como criar migrações:**
  1. Mude `prisma/schema.prisma` e gere a migração pelo Prisma (`npx prisma migrate dev --name <nome>` contra a base de desenvolvimento). Não edite à mão o SQL gerado.
  2. O que o Prisma não expressa (exclusion constraints, CHECKs, índices parciais, triggers) vai em **migração SQL própria**, criada com `npx prisma migrate dev --create-only --name <nome>` e escrita à mão, com o SQL inverso em comentário.
  3. **Migrações são congeladas depois do merge:** nunca edite uma migração já aplicada. Mudanças futuras criam migração nova.
  4. O teste `tests/integration/db/drift.test.ts` confere que o Prisma não acusa drift e que cada objeto de SQL bruto existe no catálogo pelo nome.
- Outros gates: `npm run lint`, `npm run typecheck`, `npm run build`.

## Credenciais para os serviços reais

Nenhuma é necessária para rodar ou testar. Elas só serão exigidas quando cada adaptador `real` for implementado:

- **Mercado Pago:** credenciais da conta para assinaturas e webhooks.
- **WhatsApp Business Platform:** conta, número e 3 templates aprovados (confirmação, reagendamento e cancelamento).
- **E-mail transacional:** credenciais do provedor.
- **Cloudflare Turnstile:** chave do site e chave secreta.

Os seletores `EMAIL_ADAPTER`, `WHATSAPP_ADAPTER`, `MP_ADAPTER` e `TURNSTILE_ADAPTER` (`simulado` | `real`) ficam no `.env`. Nunca versione valores reais.
