# D-004 — Desenho: esquema Prisma base e constraint anti-sobreposição (issue #6, E0.4)

Autor: arquiteto-software. Entradas: `docs/demandas/D-004/spec.md` (RN-1..RN-14, CA-1..CA-22, §3 "Fronteira com a E0.5", S-1..S-6), `issue-6.md`, `docs/demandas/D-001/dba.md` (E0.4, E0.5, E3.2, E6.2, E6.3, E7.1, E8.1), `docs/demandas/D-003/dba.md` (N-1..N-6, A-3), `CLAUDE.md`, `PLAN.md` e o código da main (`189f178`).

## 0. Prova de drift (o T-0 sugerido pelo analista, já executado por mim)

Feita antes do desenho, num projeto compose isolado (`docker compose -p arq-d004`, `POSTGRES_PORT=55741`, removido com `down -v` ao final), com um schema de prova no scratchpad (fora do repositório). Esse schema reproduz os casos difíceis: enums, FK composta obrigatória e opcional (`bloqueio`), `@@unique([salaoId, id])` como alvo de FK composta, `onUpdate: Restrict` e `dbgenerated("gen_random_uuid()")`. A migração SQL bruta trazia exclusion `reserva_sem_sobreposicao` com predicado de status, CHECK de ordem, CHECK de e-mail, dois índices únicos parciais, índice parcial comum sobre as mesmas colunas de um `@@index`, índice GiST de expressão e função com triggers por linha e por instrução.

| Verificação (Prisma 7.10.1, PG 17) | Resultado |
|---|---|
| `migrate diff --from-empty --to-schema` | FKs saem como `ON DELETE RESTRICT ON UPDATE RESTRICT`, inclusive as compostas e a opcional. A S-2 está confirmada. |
| `migrate deploy` (init gerado + SQL bruto) | Aplicado sem erro. |
| `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | `No difference detected.`, código **0** (~1 s). |
| Controle negativo: `DROP INDEX` de um índice declarado no schema | Diff acusa `Added index`, código **2**. O teste não é vácuo. |
| Remover a exclusion, um índice parcial e um trigger | Código **0**. **O diff é cego aos objetos de SQL bruto**: não acusa drift sobre eles, mas também não protege a existência deles. |
| `migrate dev` (sem `--create-only`), não interativo | `Already in sync, no schema change or pending migration was found.` (criou e descartou a shadow DB sozinho; o usuário `agenda` é superusuário). |
| `migrate dev --create-only --name probe` | **Sempre cria uma pasta**, com `-- This is an empty migration.`, mesmo sem nenhuma diferença. |
| `migrate diff --from-migrations` | Exige `datasource.shadowDatabaseUrl` no `prisma.config.ts`. |
| Erro do driver `pg` | `23P01` com `constraint = 'reserva_sem_sobreposicao'`, `23503` com o nome da FK composta e `23514` com `reserva_ordem_chk`, todos legíveis em `err.code` e `err.constraint`. |
| Reset por `DROP SCHEMA public CASCADE; CREATE SCHEMA public` com linhas em `auditoria` | Funciona: os triggers append-only não disparam em `DROP`. A `btree_gist`, instalada em `public`, cai junto e volta pelo `CREATE EXTENSION IF NOT EXISTS`. |

**Consequências para o desenho:**
1. A RN-11 se cumpre com o SQL bruto em migrações separadas, sem nenhuma mitigação extra (não é preciso declarar índice parcial no schema).
2. O CA-1 precisa de **duas** provas: o diff vazio, que mostra o schema Prisma coerente com as migrações, e a **consulta ao catálogo** de cada objeto de SQL bruto pelo nome, que mostra que esses objetos existem e que o Prisma não os removeu. Uma prova sem a outra não basta.
3. **Ajuste no CA-1 (verificação manual):** na 7.10.1, o `migrate dev --create-only` sempre cria pasta, então "não cria pasta nova" reprovaria um schema correto. O tester usa `prisma migrate dev` **sem** `--create-only`, numa base local recém-migrada, e espera `Already in sync…` sem pedido de reset. Isso é registrado em `testes.md`. A redação do CA-1 muda só no modo de verificação, não no conteúdo (ver §7, R-2).
4. Estratégia de drift escolhida: **`--from-config-datasource`** contra a base de teste já migrada pelo `globalSetup`. Fica descartada a `--from-migrations` com shadow DB, porque exigiria `shadowDatabaseUrl`, uma variável nova, uma base a mais no compose e na CI e o DevOps, para provar a mesma coisa: o `globalSetup` acabou de aplicar exatamente as migrações do repositório numa base vazia.

## 1. Resumo da solução

- **Esquema** em `prisma/schema.prisma` com as 24 tabelas da spec §3, nomes físicos em snake_case por `@@map`/`@map`, `DateTime` sempre `@db.Timestamptz(6)`, IDs `@db.Uuid @default(dbgenerated("gen_random_uuid()"))`, `criado_em @default(now())`, `@@unique([salaoId, id])` em toda tabela de salão que é alvo de FK composta e relações com `onDelete: Restrict, onUpdate: Restrict` explícitos. A S-1 é aceita: nenhum `ON UPDATE CASCADE`.
- **Três migrações**, em ordem:
  1. `20261118000000_init`: gerada pelo Prisma (`migrate diff --from-empty --to-schema --script`) e **não editada à mão**, mais `prisma/migrations/migration_lock.toml`.
  2. `20261118000100_reserva_exclusion`: o nome é o da issue. Contém `CREATE EXTENSION IF NOT EXISTS btree_gist`, `reserva_sem_sobreposicao`, `reserva_ordem_chk` e o SQL inverso em comentário (RN-14).
  3. `20261118000200_restricoes_sql`: os demais objetos que o Prisma não expressa. São os CHECKs (cliente, E.164, slug, e-mail minúsculo, papel × salão, faixas da jornada, dinheiro e duração, bloqueio), a exclusion `int4range` da jornada, os índices únicos parciais (gestor, slug atual, assinatura vigente, webhook com origem válida), os índices parciais e de expressão (reserva da cliente, mensagens pendentes, GiST do bloqueio) e a função e os triggers append-only de `auditoria` e `assinatura_transicao`. Também traz o SQL inverso em comentário.
  - Os timestamps das pastas são fixos e crescentes, e a ordem lexicográfica é a ordem de aplicação. A 2 vem antes da 3 porque a exclusion da jornada usa a `btree_gist`.
- **Harness mínimo** (só no projeto Vitest `integration`). Um `globalSetup` valida a URL com `urlBancoDeTeste()`, faz `DROP SCHEMA public CASCADE; CREATE SCHEMA public` **na base de `TEST_DATABASE_URL`** e roda `prisma migrate deploy` num processo filho, com `DATABASE_URL` sobrescrita pela URL de teste. Isso acontece uma vez por execução.
- **Testes de integração** por SQL direto com o driver `pg`, que passa a ser declarado como devDependency (§1.2). Cada teste cria os próprios dados, e o teste de drift (CA-1) roda o CLI do Prisma num processo filho.
- **Nenhum código novo em `src/**`.** A tradução de `23P01` é da E3.2, e os repositórios são da E0.5.

### 1.1 Alternativas descartadas
| Alternativa | Motivo |
|---|---|
| Uma única migração (init + SQL bruto no mesmo arquivo) | Se o init for gerado e depois editado à mão, perde-se a garantia de que ele corresponde ao `migrate diff`. Além disso, a reversão da constraint crítica (RN-14) deixaria de ser uma unidade isolada. |
| Duas migrações (init + todo o SQL bruto em `_reserva_exclusion`) | Funciona, mas mistura a constraint crítica com outros 20 objetos. Separar custa só um arquivo e deixa a reversão e a revisão do DBA mais limpas. |
| `migrate diff --from-migrations` com shadow DB | Exige `shadowDatabaseUrl`, uma variável nova e o DevOps, e não prova nada além do `--from-config-datasource` depois do `deploy` numa base vazia (§0). |
| `prisma migrate reset --force` no `globalSetup` | Ele usa a URL do `prisma.config.ts`, que lê `DATABASE_URL`. Um esquecimento de override apagaria a base de desenvolvimento. O reset por `DROP SCHEMA` usa um cliente `pg` aberto **com a URL que a guarda devolveu**, sem caminho alternativo. |
| `TRUNCATE` ou `DELETE` entre arquivos | `TRUNCATE` é bloqueado pelo trigger de `auditoria` (RN-10, RN-13c), e a limpeza entre arquivos é escopo da E0.5. |
| `prisma db push` | É proibido (D-003/dba.md N-5): gera drift com o histórico. |
| Testes via `$executeRaw` do Prisma | O erro do Prisma embrulha o SQLSTATE e o nome da constraint. Além disso, os matchers do Vitest estouram a pilha com o cliente Prisma 7 (D-003/dev.md:67). Com o `pg`, `err.code` e `err.constraint` são diretos (§0). |
| Índices parciais como exclusion `btree` (para "esconder" do Prisma) | É desnecessário, porque o diff já os ignora (§0). Também trocaria o SQLSTATE `23505` exigido pelo CA-17 e pelo CA-18 por `23P01`. |

### 1.2 Dependência nova
`pg@8.23.1` e `@types/pg@8.23.1` passam a ser **devDependencies explícitas, com versão exata**. As duas já estão no `package-lock.json` como dependências transitivas do `@prisma/adapter-pg`, nas mesmas versões, então a árvore instalada não muda. Declarar evita depender do hoisting do npm. Nenhuma outra ferramenta nova.

## 2. Componentes afetados

| Caminho | Mudança |
|---|---|
| `prisma/schema.prisma` | Os models e enums da v1 (T-1). |
| `prisma/migrations/migration_lock.toml` | Novo, com `provider = "postgresql"` (T-1). |
| `prisma/migrations/20261118000000_init/migration.sql` | Gerado pelo Prisma (T-1). |
| `prisma/migrations/20261118000100_reserva_exclusion/migration.sql` | SQL bruto (T-2). |
| `prisma/migrations/20261118000200_restricoes_sql/migration.sql` | SQL bruto (T-2). |
| `docs/demandas/D-004/dba.md` | Parecer do DBA: lista final de tabelas, renomeações, decisões de S-1, S-6, função append-only e reversão (T-2). |
| `tests/integration/support/db.ts` | Novo: `prepararBancoDeTeste()` (T-3). |
| `tests/integration/support/global-setup.ts` | Novo: entrada do `globalSetup` do Vitest (T-3). |
| `tests/integration/support/db.test.ts` | Novo: CA-21 (T-3). |
| `vitest.config.ts` | `globalSetup` **só** no projeto `integration` (T-3). |
| `package.json`, `package-lock.json` | `pg` e `@types/pg` em devDependencies (T-3). |
| `README.md` | Seção de testes de integração e migrações (T-3). |
| `tests/integration/support/sql.ts` | Novo: conexão `pg`, captura de erro e fábricas mínimas (T-4). |
| `tests/integration/db/*.test.ts` | Novos: CA-1..CA-20 e CA-22 (T-4). |

Não mudam: `src/**`, `prisma.config.ts`, `docker-compose.yml`, `Dockerfile`, `docker/**`, `.env.example` e `.github/**`. O `docker/entrypoint.sh` já roda `migrate deploy`, então as migrações novas entram na app do compose sem nenhuma mudança (D-003/dba.md §4).

## 3. Interfaces

### 3.1 Harness (`tests/integration/support/db.ts`)
```ts
/** Recria o schema public da base de TEST_DATABASE_URL e aplica as migrações. Uma vez por execução. */
export async function prepararBancoDeTeste(): Promise<void>;

/** Caminho absoluto do binário do Prisma CLI (node_modules/.bin/prisma), resolvido a partir da raiz do repo. */
export function binarioPrisma(): string;

/** Executa o Prisma CLI com DATABASE_URL = url (sobrescrita explícita). Sem shell. */
export function executarPrisma(args: string[], url: string): { status: number | null; stdout: string; stderr: string };
```
Ordem obrigatória dentro de `prepararBancoDeTeste` (RN-13a):
1. `const url = urlBancoDeTeste()`. É a **primeira** instrução, antes de abrir qualquer conexão. A guarda é reaproveitada de `./banco`, não duplicada.
2. `new pg.Client({ connectionString: url })`, depois `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;` e `end()`.
3. `executarPrisma(['migrate', 'deploy'], url)`. Se `status !== 0`, lança um erro com o `stderr`.
- `executarPrisma` usa `spawnSync(binarioPrisma(), args, { env: { ...process.env, DATABASE_URL: url }, cwd: raiz, encoding: 'utf8' })`, **sem `shell: true`**, porque o caminho do repositório tem espaço e acento (`Área de Trabalho`). A raiz vem de `fileURLToPath(new URL('../../..', import.meta.url))`, nunca de `URL.pathname`. O `prisma.config.ts` chama `process.loadEnvFile()`, que não sobrescreve variáveis já definidas, então o override prevalece sobre o `.env`.
- Proibido: `migrate reset`, `db push`, `TRUNCATE` e qualquer comando que dependa da `DATABASE_URL` herdada.

`tests/integration/support/global-setup.ts`: `export default async function setup() { await prepararBancoDeTeste(); }`, sem teardown. Os dados ficam para depuração, e a próxima execução reseta.

`vitest.config.ts`: acrescentar `globalSetup: ['./tests/integration/support/global-setup.ts']` **dentro** do projeto `integration`. `npm run test:unit` continua sem exigir banco, e isso faz parte do critério de conclusão do T-3.

### 3.2 Helpers de teste (`tests/integration/support/sql.ts`, T-4)
```ts
export async function conectar(): Promise<pg.Client>;            // usa urlBancoDeTeste()
/** Executa e devolve o erro do driver; falha o teste se a instrução for aceita. */
export async function erroSql(p: Promise<unknown>): Promise<{ code: string; constraint?: string }>;
export async function criarSalao(c: pg.Client): Promise<string>;
export async function criarProfissional(c: pg.Client, salaoId: string): Promise<string>;
export async function criarCliente(c: pg.Client, salaoId: string, telefone?: string): Promise<string>;
export async function criarServico(c: pg.Client, salaoId: string): Promise<string>;
export async function inserirReserva(c: pg.Client, r: { salaoId; profissionalId; clienteId; inicio; fim; ocupadoAte; status? }): Promise<string>;
```
- Cada chamada gera UUIDs e telefones novos (por exemplo, sufixo aleatório no E.164), e nenhuma asserção depende de contagem global (spec §3).
- Os helpers ficam mínimos: as fábricas de dois salões completos são da E0.5 (`tests/support/factories.ts`), e este arquivo não deve virar essa fábrica.
- Os testes não passam o cliente `pg` nem o cliente Prisma a `expect(...)` (spec §6, último item).

### 3.3 Arquivos de teste (`tests/integration/db/`, T-4)
| Arquivo | CAs |
|---|---|
| `drift.test.ts` | CA-1 (catálogo + diff), CA-15 |
| `reserva-exclusion.test.ts` (nome da issue) | CA-2..CA-8, caso de virada de dia com `SET TIME ZONE 'America/Sao_Paulo'`, 1 s de sobreposição |
| `isolamento-salao.test.ts` | CA-9 (reserva.profissional, reserva.cliente, reserva_item.servico; recomendado: bloqueio com profissional de outro salão e bloqueio com `profissional_id` nulo aceito) |
| `cliente-unicidade.test.ts` (nome da issue) | CA-10, CA-16 |
| `unicidade.test.ts` | CA-11 (com os slugs inválidos `Salao`, `-a` e `a--b`), CA-17 (a–e), CA-18 |
| `append-only.test.ts` | CA-12, CA-14 |
| `jornada.test.ts` | CA-13, CA-19 |
| `defaults.test.ts` | CA-20 |

O `drift.test.ts` (CA-1) faz o seguinte:
- **Catálogo.** Compara a lista final de tabelas do `dba.md` com `information_schema.tables` (schema `public`, sem `_prisma_migrations`), com igualdade de conjuntos. Confere `btree_gist` em `pg_extension` e, em `pg_constraint`, cada constraint de SQL bruto **pelo nome** (`contype` `x` para as exclusions e `c` para os CHECKs). Confere cada índice parcial pelo nome em `pg_indexes` e os triggers em `pg_trigger` (`tgname`, `tgtype`, com o de TRUNCATE por instrução).
- **Diff.** `executarPrisma(['migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--exit-code'], urlBancoDeTeste())` deve terminar com status 0.
- **Controle negativo.** O mesmo diff contra uma cópia temporária do schema (em `os.tmpdir()`) com um model extra precisa sair com status 2. Isso prova que o comando detecta diferenças sem alterar a base compartilhada.
- **RN-1.** Nenhuma coluna `timestamp without time zone` em `public` (exceto `_prisma_migrations`).

Os nomes dos objetos vêm do `dba.md` (T-2) e precisam bater com ele um a um.

## 4. Dados

O DBA é o **responsável principal** (T-1, T-2). Pontos que ele decide e registra no `dba.md`:
1. A lista final de tabelas (S-6) e os nomes de todas as constraints, índices e triggers de SQL bruto. Os nomes são fixos, porque o CA-1 e a E3.2 dependem deles.
2. S-1: `onUpdate: Restrict` em toda relação. Recomendo `Restrict` (verificado em §0) a `NoAction`.
3. As FKs compostas da RN-2 e a regra geral: toda tabela de salão que referencia outra tabela de salão usa FK composta `(salao_id, x_id)`. O alvo precisa de `@@unique([salaoId, id])`.
4. Os enums Prisma com `@@map` em snake_case. Os valores de `status_reserva` são exatamente `confirmado`, `cancelado`, `concluido` e `nao_compareceu`, e os de `assinatura` e `mensagem` seguem a spec §3 item 2 (mensagem inclui `enviando` e `cancelada_anonimizacao`).
5. A função append-only. Sugiro uma única função genérica que use `TG_TABLE_NAME` na mensagem (`'% é somente inserção'`), com `ERRCODE 'P0001'`, ligada a `auditoria` e `assinatura_transicao`.
6. **Todo** `DateTime` com `@db.Timestamptz(6)`. Sem isso, o Prisma gera `timestamp(3)` sem fuso, e o CA-1 detecta.
7. As colunas da E6.2, E6.3, E7.1 e E8.1 conforme o D-001/dba.md. Nada de cartão nem de itens fora da v1.
8. A geração do init é feita com `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/20261118000000_init/migration.sql`, sem banco. O arquivo não é editado depois.
9. Todas as migrações são **congeladas** depois do merge (RN-14). Mudanças futuras criam migração nova.

O DBA **está acionado** e é o dono das tarefas de dados. Não há `EXPLAIN` exigido nesta demanda: as consultas de ocupação são da E3.1.

## 5. Infraestrutura

- **Nenhuma** variável de ambiente nova: o harness usa `TEST_DATABASE_URL`, que já existe. Também não muda o container, o compose, o Dockerfile nem a CI.
- **DevOps dispensado.** A estratégia de drift não usa shadow DB (§0), o initdb já cria a base de teste e o entrypoint já aplica as migrações.
- Nota para a E0.3 (#5): a CI deve rodar `npm run test:integration` contra o service `postgres:17` (D-003 N-1). O teste de drift está dentro desse comando e não exige passo extra.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como é atendida |
|---|---|---|
| Escopo por salão no servidor | Parcial | A camada do servidor é da E0.5. Aqui fica a defesa no banco: `salao_id NOT NULL`, `UNIQUE (salao_id, id)` e FKs compostas (CA-9). |
| Exclusion anti-sobreposição | **Sim** | `reserva_sem_sobreposicao` em migração SQL própria, com predicado da lista explícita de status e `ocupado_ate` (CA-2..CA-8). O nome é fixo e o catálogo confere a presença dela (CA-1). |
| UTC + fuso do salão | **Sim** | `timestamptz` em todo instante (verificado no CA-1). A jornada fica em minutos locais com exclusion `int4range`, e o salão tem `fuso` com default `America/Sao_Paulo` e os demais defaults de configuração. Há um teste de virada de dia com `TimeZone` da sessão alterado. |
| Adaptadores de integração | Não | Não há integração nesta demanda. |
| Soft deletes / anonimização | **Sim** | `ativo DEFAULT true` (CA-20), CHECK de anonimização coerente e irreversível e `UNIQUE` com NULLS DISTINCT (CA-10, CA-16). Todas as FKs são RESTRICT (CA-15). |
| Salão suspenso somente leitura | Não | Só existem as colunas (`suspenso_manual_em` e o estado da assinatura). A política é da E6.4. |
| Idempotência de webhooks e mensagens | **Sim (no banco)** | `mensagem UNIQUE (reserva_id, tipo, revisao)`, `webhook_evento UNIQUE … WHERE origem_valida`, `assinatura_pagamento.pagamento_id UNIQUE` e `reserva UNIQUE (salao_id, chave_requisicao)` (CA-17). |
| Auditoria do super admin | **Sim (no banco)** | Triggers append-only em `auditoria` e `assinatura_transicao` (CA-12, CA-14). O reset do harness usa `DROP SCHEMA` e não depende de `TRUNCATE` (CA-22). |

## 7. Riscos e decisões

| # | Risco | Mitigação |
|---|---|---|
| R-1 | O diff do Prisma é cego aos objetos de SQL bruto (provado em §0). Uma migração futura pode removê-los sem que o diff acuse. | O CA-1 confere cada objeto **pelo nome** no catálogo. Os nomes são fixos no `dba.md`, e o DBA revisa toda migração futura. |
| R-2 | Na 7.10.1, `migrate dev --create-only` sempre cria uma pasta vazia, e o CA-1 manual reprovaria um schema correto. | O tester usa `migrate dev` sem `--create-only` e espera `Already in sync`. **O líder deve confirmar o ajuste com o analista** (é só o modo de verificação). |
| R-3 | O reset do harness é destrutivo e pode atingir a base errada. | `urlBancoDeTeste()` é a primeira instrução. O cliente `pg` e o processo filho recebem só essa URL, e não se usa `migrate reset`. O CA-21 é testado com `DATABASE_URL` igual à de teste e com uma variável ausente, apontando para uma porta fechada: se houvesse conexão antes da guarda, o erro seria `ECONNREFUSED`, e não a mensagem da guarda. |
| R-4 | Duas execuções simultâneas de `test:integration` na mesma base se destroem. | É uma limitação documentada no README. Uma base por worker e por execução é da E0.5. |
| R-5 | Renomear um valor de `status_reserva` quebra o predicado da constraint. | Fica proibido renomear (D-001/dba.md). O catálogo do CA-1 confere a constraint pelo nome, e o CA-3 e o CA-7 provam o predicado. |
| R-6 | Prisma `DateTime` sem `@db.Timestamptz` gera `timestamp(3)`. | Regra do §4, item 6, com asserção no CA-1. |
| R-7 | Prisma gera `ON UPDATE CASCADE` por padrão (S-1), e um UPDATE de `salao_id` moveria reservas entre salões. | `onUpdate: Restrict` explícito, conferido pelo CA-15. |
| R-8 | Depender do `pg` transitivo. | Declarado como devDependency com a mesma versão (§1.2). |
| R-9 | Tamanho L: o schema tem 24 tabelas. | O T-1 e o T-2 ficam separados e sequenciais com o mesmo dono. O T-3 roda em paralelo, e o T-4 só começa com o schema congelado. |
| R-10 | O `globalSetup` falha (migração inválida) e todos os testes de integração caem juntos. | É o comportamento desejado: a falha mostra o `stderr` do `migrate deploy`. |

## 8. Estratégia de testes

- **Integração com PostgreSQL real (Vitest, projeto `integration`):** CA-1 a CA-20 e CA-22, por SQL direto (§3.3). O CA-22 é provado por duas execuções seguidas de `npm run test:integration` sobre a mesma base. A primeira deixa linhas em `auditoria` (CA-12), e a segunda reseta sem `TRUNCATE`. A evidência fica em `dev.md` e é repetida pelo tester.
- **Teste puro no projeto `integration`:** CA-21, em `tests/integration/support/db.test.ts`. Usa `vi.stubEnv` para a variável ausente e para o mesmo nome de base, com `DATABASE_URL` apontando para uma porta fechada, e espera a mensagem da guarda (R-3). O tester ainda faz a prova manual de que a base de dev não muda (contagem de `_prisma_migrations` antes e depois).
- **Unitário (`src/**`):** não há código novo. `npm run test:unit` deve continuar sem exigir banco.
- **Playwright:** não se aplica, porque não há UI.
- **Verificação manual do tester:** `prisma migrate dev` sem `--create-only` numa base local recém-migrada responde `Already in sync` (R-2).
- **Cobertura ≥ 90%:** a métrica é sobre `src/**`, que não recebe código nesta demanda. As migrações, o `prisma/` e o `tests/**` estão fora da métrica, e `src/generated/**` já está excluído com justificativa. O gate é `npm run test:coverage` (unidade + integração) passando com o limiar atual, sem nenhuma exclusão nova. Se algum código surgir em `src/**`, ele entra com teste na mesma tarefa.
- **Gates:** `npm run db:generate`, `lint`, `typecheck` e `build` passando com os models novos.

## 9. Tarefas

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | dba | — | T-3 | `prisma/schema.prisma`, `prisma/migrations/migration_lock.toml`, `prisma/migrations/20261118000000_init/migration.sql` |
| T-2 | dba | T-1 | T-3 | `prisma/migrations/20261118000100_reserva_exclusion/migration.sql`, `prisma/migrations/20261118000200_restricoes_sql/migration.sql`, `docs/demandas/D-004/dba.md` |
| T-3 | desenvolvedor | — | T-1, T-2 | `tests/integration/support/db.ts`, `tests/integration/support/global-setup.ts`, `tests/integration/support/db.test.ts`, `vitest.config.ts`, `package.json`, `package-lock.json`, `README.md` |
| T-4 | desenvolvedor | T-2, T-3 | — | `tests/integration/support/sql.ts`, `tests/integration/db/*.test.ts`, `docs/demandas/D-004/dev.md` |
| T-5 | tester | T-4 | — | `docs/demandas/D-004/testes.md` |

**T-1 — Schema Prisma e migração init (dba).**
- Entregável: os models e enums conforme §1 e §4 e o init gerado por `migrate diff --from-empty` (§4, item 8).
- Critério de conclusão:
  - `npx prisma validate` e `npm run db:generate` passam.
  - `npm run typecheck` passa.
  - Todo `DateTime` é `@db.Timestamptz(6)`.
  - Toda relação declara `onDelete: Restrict, onUpdate: Restrict`.
  - O init contém só `ON DELETE RESTRICT ON UPDATE RESTRICT` (`grep -c CASCADE` = 0, `grep -c "SET NULL"` = 0).

**T-2 — Migrações SQL brutas e parecer (dba).**
- Entregável: as migrações 2 e 3 (§1), cada uma com cabeçalho e SQL inverso em comentário (RN-14), e o `dba.md` com a lista final de tabelas e o nome de cada objeto de SQL bruto. Esse nome é o contrato com o T-4.
- Critério de conclusão: num compose isolado (`-p dba-d004`, porta própria, `down -v` ao final), `migrate deploy` sobre a base vazia passa, `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` sai com 0 e `migrate dev` (sem `--create-only`) responde `Already in sync`. As saídas ficam no `dba.md`.

**T-3 — Harness mínimo (desenvolvedor).**
- Entregável: §3.1, o CA-21 em `db.test.ts`, a declaração de `pg` e `@types/pg` 8.23.1 (exatas, `npm install -D -E`) e a seção do README. A seção explica que `test:integration` **apaga e recria o schema da base de `TEST_DATABASE_URL`** a cada execução, que não se pode rodar duas execuções simultâneas, que é proibido `db push` e como criar migrações (init gerado, SQL bruto em migração própria, migrações congeladas após o merge).
- Critério de conclusão:
  - Com as migrações ainda ausentes, `npm run test:integration` passa (o `deploy` sem migrações é válido, D-003 §4), e `health.test.ts` continua verde.
  - `npm run test:unit` passa **sem** PostgreSQL no ar.
  - O CA-21 passa.
  - `lint` e `typecheck` passam.

**T-4 — Testes dos CAs (desenvolvedor).**
- Entregável: §3.2 e §3.3 e o `dev.md` com as evidências.
- Critério de conclusão:
  - CA-1..CA-20 e CA-22 cobertos, cada `it` com o ID do CA no título.
  - `npm run test:integration` passa duas vezes seguidas (CA-22).
  - `npm run test:coverage` passa com ≥ 90%.
  - `lint`, `typecheck` e `build` passam.
  - Os nomes de objetos usados no CA-1 batem com o `dba.md`.
- Se um teste revelar um defeito no SQL, o T-4 não edita a migração: devolve ao DBA, que reabre o T-2. Enquanto não houver merge, a migração pode ser corrigida no lugar.

**T-5 — Validação independente (tester).**
- Entregável: o `testes.md` com o veredito.
- Critério de conclusão: todos os CAs com evidência, incluindo a prova manual do CA-1 (`migrate dev`, R-2), o CA-21 manual (a base de dev intacta) e o CA-22 com duas execuções.

### Mapa CA → tarefa → tipo de teste
| CA | Tarefa | Tipo |
|---|---|---|
| CA-1 | T-1, T-2, T-4 (`drift.test.ts`), T-5 (manual) | Integração + manual |
| CA-2..CA-8 | T-2, T-4 (`reserva-exclusion.test.ts`) | Integração |
| CA-9 | T-1, T-4 (`isolamento-salao.test.ts`) | Integração |
| CA-10, CA-16 | T-1, T-2, T-4 (`cliente-unicidade.test.ts`) | Integração |
| CA-11, CA-17, CA-18 | T-1, T-2, T-4 (`unicidade.test.ts`) | Integração |
| CA-12, CA-14 | T-2, T-4 (`append-only.test.ts`) | Integração |
| CA-13, CA-19 | T-2, T-4 (`jornada.test.ts`) | Integração |
| CA-15 | T-1, T-4 (`drift.test.ts`) | Integração |
| CA-20 | T-1, T-2, T-4 (`defaults.test.ts`) | Integração |
| CA-21 | T-3 (`db.test.ts`), T-5 (manual) | Teste puro + manual |
| CA-22 | T-3, T-4 (duas execuções), T-5 | Integração (execução repetida) |
