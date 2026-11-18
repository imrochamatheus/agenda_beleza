## Objetivo
Permitir rodar o produto localmente com um único comando de containers.

## Origem e contexto
PLAN.md, "Direção técnica" (docker-compose com aplicação, worker e PostgreSQL; arquivo de exemplo de variáveis); CLAUDE.md, "Required stack". Atual: inexistente.

## Escopo
- `Dockerfile` multi-stage para app e worker: imagem não root, `TZ=UTC`, worker compilado para JS.
- `docker-compose.yml`: `postgres` (volume, healthcheck, porta `${POSTGRES_PORT:-5432}`); `app` com healthcheck em `GET /api/health` (executa `SELECT 1`); `worker` com `depends_on: app: service_healthy`; entrypoints com `exec` e `init: true`; o compose sobrescreve `DATABASE_URL`.
- Bootstrap do Prisma: `prisma/schema.prisma` só com datasource e generator, `prisma.config.ts`, script `db:generate`; cliente gerado excluído, com comentário, de lint, cobertura e `.gitignore`.
- Só o `app` executa `prisma migrate deploy` no entrypoint.
- Stub de `src/worker/main.ts` (substituído em E0.7).
- Validação do env com zod em `src/server/env.ts`.
- `.env.example` com todas as variáveis, incluindo `APP_URL`, `TEST_DATABASE_URL` e os seletores de adaptadores.
- README inicial com "Executar com Docker" e "Testes" (completado em E9.3).

## Fora do escopo
Publicação em VPS, proxy reverso e TLS (PLAN: "A publicação na internet fica para uma etapa posterior").

## Especificação
Decidido:
- RN-1: por padrão, `.env.example` seleciona os adaptadores simulados; o projeto sobe sem nenhuma credencial real.
- RN-2: o app aguarda o postgres saudável e aplica as migrações; o worker só sobe com o app saudável; reiniciar sem apagar o volume não gera erro de migração.
- RN-3: nenhum segredo real versionado.
- RN-4: a major do PostgreSQL é a mesma no compose e na CI (E0.3).
Casos limite: porta 5432 ocupada no host (`POSTGRES_PORT`); variável obrigatória ausente (falha nomeando a variável, E0.6).

## Critérios de aceite
- [ ] CA-1: Dado `cp .env.example .env` sem alterações, quando se executa `docker compose up -d --wait`, então o comando termina com código 0, `docker compose ps` mostra postgres e app `healthy` e worker `running`, e `curl -fsS localhost:3000/` responde 200.
- [ ] CA-2: Dado o compose em execução, quando se inspecionam os containers, então o worker roda em container separado do app e nenhum dos dois roda como root.
- [ ] CA-3: Dado `src/server/env.ts` e `.env.example`, quando o teste unitário compara as chaves dos dois, então elas coincidem.
- [ ] CA-4: Dado o compose em execução, quando se executa `docker compose down` e depois `docker compose up -d --wait` (sem `-v`), então tudo sobe sem erro de migração.
- [ ] CA-5: Dado o postgres indisponível, quando se chama `GET /api/health`, então responde 503.

## Validação
Testes unitários de CA-3 e do endpoint de health; verificação manual objetiva dos demais pelo tester, com comandos e saídas registrados. Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #2 (E0)
- Bloqueada por: #3 (E0.1)
- Bloqueia: #5 (E0.3), #6 (E0.4)

## Entregáveis
- Dockerfile multi-stage usado por app e worker
- docker-compose.yml com app, worker e postgres (imagem oficial ≥ 16, volume, healthcheck, depends_on healthy)
- docker/entrypoint.sh (exec; check-env; prisma migrate deploy só no app) e GET /api/health com SELECT 1; worker com depends_on app service_healthy
- prisma/schema.prisma (datasource e generator) e prisma.config.ts (bootstrap do Prisma)
- src/worker/main.ts stub (heartbeat) e script npm worker
- src/server/env.ts com validação zod do ambiente
- .env.example comentado, com adaptadores simulados por padrão e credenciais reais vazias
- Worker compilado para JS no build da imagem; imagem não root com TZ=UTC
- Variáveis APP_URL, TEST_DATABASE_URL e POSTGRES_PORT
- README.md inicial: Executar com Docker e Testes
- Teste unitário que confere .env.example contra o schema de src/server/env.ts

## Papel responsável
- DevOps
- Apoio/revisão: DBA, Desenvolvedor

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E0.2`. Prioridade P0, tamanho M (Project #3)._
<!-- agenda-beleza-backlog:E0.2 -->
