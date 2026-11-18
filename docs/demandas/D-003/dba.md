# D-003 — Parecer do DBA (T-5, só revisão)

Entradas: `spec.md`, `design.md` (§4), `devops.md` (T-1 e T-3), `dev.md`, `docs/demandas/D-001/dba.md` (E0.5 e E0.7).
Arquivos revisados: `docker-compose.yml`, `docker/postgres/initdb/10-base-de-teste.sh`, `docker/entrypoint.sh`, `Dockerfile` (cópia de `prisma/`), `prisma/schema.prisma`, `prisma.config.ts`, `src/server/db.ts`, `src/server/health.ts`, `src/app/api/health/route.ts` e `tests/integration/support/banco.ts`.

**Veredito: APROVADO com ressalvas.** Nenhum ajuste bloqueia o tester. Os ajustes A-1 a A-3 são de severidade baixa: recomendo aplicá-los nesta demanda porque são baratos, mas podem ser adiados com registro. As notas N-1 a N-5 são insumos para a E0.3, E0.4 e E0.5.

## Evidências

Validação num projeto compose isolado (`-p dba-d003`, `POSTGRES_PORT=55611`), removido com `down -v` ao final. O projeto `agenda_beleza` não foi tocado.

```
$ docker compose -p dba-d003 up -d --wait postgres          → Healthy
  10-base-de-teste: base "agenda_beleza_test" criada.
select version()                                             → PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1)
select rolsuper, rolcreatedb from pg_roles where rolname='agenda' → t | t
CREATE EXTENSION btree_gist; CREATE TABLE … EXCLUDE USING gist (p WITH =, tstzrange(s,e,'[)') WITH &&) WHERE (st IN (…))  → ok
CREATE DATABASE agenda_template TEMPLATE agenda_beleza_test  → ok
CREATE DATABASE agenda_test_1 TEMPLATE agenda_template       → ok (btree_gist 1.7 presente na cópia)
DROP DATABASE agenda_test_1 WITH (FORCE)                     → ok
show max_connections                                         → 100
$ prisma migrate deploy (sem prisma/migrations) ×2           → "No pending migrations to apply." nas duas; só _prisma_migrations criada
pg.Pool {max: 2, connectionTimeoutMillis: 3000}, 3× pg_sleep(4) em paralelo
                                                             → 2 fulfilled, 1 "timeout exceeded when trying to connect" (~3 s)
Falha no initdb (TEST_DATABASE_URL = base de dev), volume novo:
  1º up  → script sai com 1, container "exited (1)"
  2º up com a variável corrigida → Healthy, mas só existe "agenda_beleza" (o initdb não roda de novo)
```

## Parecer por ponto

### 1. Tag `postgres:17` e coerência com a E0.3 — **ok**
- Major fixa, sem `latest` nem faixa (RN-4). Hoje resolve para 17.12. Tem `btree_gist` no contrib e suporta `tstzrange`, `EXCLUDE … WHERE`, `CREATE DATABASE … TEMPLATE` e `DROP DATABASE … WITH (FORCE)`. Tudo o que o plano exige foi verificado.
- **N-1 (E0.3):** o service container da CI deve usar exatamente `postgres:17`, não `postgres:17-alpine` nem outra major: a collation e a libc mudam entre as variantes, e isso afeta a ordenação de texto nos testes.
- **N-2 (futuro):** a migração para a 18 não é uma troca de tag. A imagem 18 muda o `PGDATA` (`/var/lib/postgresql/18/docker`) e o ponto de montagem do volume, e os dados exigem `pg_dump`/`pg_upgrade`. Quem fizer essa troca precisa tratá-la como uma demanda própria.

### 2. Script de `initdb` — **ok, com ajustes A-1 e A-2 (baixa)**
Correto: extrai o último segmento e remove a query string. A regex `^[a-z0-9_]+$` impede a injeção no identificador citado e rejeita caixa alta, que o Postgres trataria de forma diferente. Também recusa `POSTGRES_DB`, usa `ON_ERROR_STOP` e não faz nada quando a variável está vazia. O arquivo tem `+x` no disco (o entrypoint o executa, não o faz `source`, então o `exit 0` não encerra o entrypoint da imagem).

- **A-1 (baixa, devops):** quando o script falha, o volume fica **parcialmente inicializado**. Nos `up` seguintes, o initdb não roda mais, e o Postgres fica saudável sem a base de teste (reproduzido acima). Os testes depois falham com um erro de conexão, não em silêncio, mas a causa fica obscura. Correção: nas duas mensagens de erro do script, acrescentar `Corrija a variável e rode "docker compose down -v" (o volume ficou parcialmente inicializado).`, e citar esse caso no README, ao lado do `createdb`.
- **A-2 (baixa, devops, opcional):** recusar também `postgres`, `template0` e `template1`, porque o `CREATE` falharia e cairia no caso de A-1, e limitar o tamanho a 63 caracteres (`^[a-z0-9_]{1,63}$`), já que o Postgres trunca identificadores maiores.
- Lembrete para o devops conferir no T-4: depois do `git add`, `git ls-files -s docker/` deve mostrar `100755` para os dois scripts (`core.fileMode=true` neste clone).

### 3. Superusuário da imagem para a estratégia de template da E0.5 — **ok**
- O `POSTGRES_USER` da imagem oficial é superusuário (`rolsuper = t`, `rolcreatedb = t`). Ele cobre o `CREATE DATABASE … TEMPLATE`, o `DROP … WITH (FORCE)`, o `CREATE EXTENSION btree_gist` e a criação do schema `pgboss`, tudo verificado. Isso basta para dev e CI, como o devops-D001 ajuste 6 previa.
- **N-3 (E0.5):** o orçamento de conexões é `max_connections = 100`. O total de workers do Vitest × o `max` do pool por worker, mais as conexões do template e a app de dev, precisa ficar abaixo de cerca de 90. Exemplo: 4 workers × 15 = 60. O template não pode ter conexões abertas na hora da cópia, então o `globalSetup` precisa fechar o Prisma e o pg-boss antes, como já consta no D-001/dba.md.
- **N-4 (deploy, fora desta demanda):** em produção, a app não deve usar um superusuário. Um papel dono do database, com `CREATE` no database, basta para o `migrate deploy`, o `btree_gist` (extensão *trusted* desde a PG 13) e o pg-boss.

### 4. `migrate deploy` sem `prisma/migrations` — **ok**
- Executado duas vezes contra um banco limpo: as duas saem com "No pending migrations to apply." e só criam `_prisma_migrations`. O caminho é idempotente no restart (CA-4/RN-2). Só a app migra, e o Prisma ainda usa um advisory lock contra deploys concorrentes.
- O `Dockerfile` copia `prisma/` e `prisma.config.ts` para a imagem final, e o `.dockerignore` não exclui `prisma/`. As migrações da E0.4 vão estar na imagem sem nenhuma mudança.
- **N-5 (E0.4):** a primeira migração deve ser criada num volume que já tem `_prisma_migrations` vazia, o que funciona normalmente. A migração SQL bruta precisa começar com `CREATE EXTENSION IF NOT EXISTS btree_gist`. Nenhum dev deve usar `db push` no volume de desenvolvimento, porque isso gera drift com o histórico.

### 5. `connectionTimeoutMillis` de 3 s — **ok para esta demanda, com nota para a E0.5**
- No health, a combinação está coerente: a corrida de 3 s em `verificarBanco` e a conexão de 3 s ficam abaixo do `timeout: 5s` do healthcheck e do limite do CA-5. Uma porta fechada falha em cerca de 50 ms, e cada tentativa pendurada é limitada a 3 s, então as tentativas não se acumulam.
- **Atenção (verificado):** no `pg.Pool`, esse timeout vale **também para a espera na fila do pool**, não só para abrir o socket. Como o `PrismaPg` usa o `max` padrão do `pg` (10), toda consulta da app que esperar mais de 3 s por uma conexão livre falha com `timeout exceeded when trying to connect`. Para o health isso não importa, mas nos testes de concorrência da E0.5/E3.2 (12 requisições paralelas) isso gera falhas intermitentes que parecem conflito de reserva. **N-6 (E0.5):** tornar `max` configurável em `criarPrisma` e defini-lo explicitamente (≥ número de requisições paralelas do teste), mantendo os 3 s, ou separar o timeout de conexão do de fila.
- Não há `statement_timeout`. Para o health basta a corrida, mas uma demanda futura pode avaliar um `statement_timeout` por papel.

## Ponto extra (fora dos 5): guarda de `tests/integration/support/banco.ts`

- **A-3 (baixa agora, média a partir da E0.4, desenvolvedor):** a guarda compara as URLs **como texto**. Por isso, `…@localhost:5432/agenda_beleza` e `…@127.0.0.1:5432/agenda_beleza`, ou a mesma URL com `?schema=public`, passam como se fossem bases diferentes, embora apontem para a mesma base de desenvolvimento. Hoje o teste só faz `SELECT 1`, mas quando o harness da E0.4/E0.5 passar a apagar e recriar dados, essa brecha destrói a base semeada. Correção: comparar o nome da base (`new URL(url).pathname.slice(1)`, sem a query) de `TEST_DATABASE_URL` com o de `DATABASE_URL` (quando esta existir) e recusar se forem iguais. É a mesma regra do script de initdb, e o teste unitário cobre os dois casos acima. Se o líder preferir, o ajuste pode ser registrado como requisito de entrada da E0.4.

## Reversão

Esta demanda não cria nenhuma migração de domínio. Para reverter o estado do banco local, basta rodar `docker compose down -v`, que apaga só o volume `pgdata` de dev. Num banco compartilhado, `DROP TABLE _prisma_migrations` também serviria, mas não se aplica a nenhum ambiente hoje.
