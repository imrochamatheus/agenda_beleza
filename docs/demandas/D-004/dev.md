# D-004 — Desenvolvimento (T-3 e T-4)

Autor: desenvolvedor. Branch `feat/d-004-esquema-prisma`, sem commit. Entradas: `spec.md`, `design.md` (§0, §3, §9), `dba.md` §3 (contrato de nomes).

## 1. Tarefas concluídas e arquivos

### T-3: harness mínimo
| Arquivo | Mudança |
|---|---|
| `tests/integration/support/db.ts` | Novo. `prepararBancoDeTeste()`, `binarioPrisma()` e `executarPrisma()`, conforme design §3.1. |
| `tests/integration/support/global-setup.ts` | Novo. Chama `prepararBancoDeTeste()` e faz `provide('inicioDoReset')` para o teste do CA-22. Não tem teardown. |
| `tests/integration/support/db.test.ts` | Novo. Cobre o CA-21 e a sobrescrita de `DATABASE_URL` no processo filho. |
| `vitest.config.ts` | `globalSetup` **só** no projeto `integration`. |
| `package.json`, `package-lock.json` | `pg` e `@types/pg` `8.23.1` exatas em `devDependencies`. O lock só ganhou as 2 linhas de declaração, e a árvore instalada não mudou. |
| `README.md` | Nova subseção "Banco de teste e migrações". Cobre o reset destrutivo da base de teste, a proibição de execuções simultâneas, o teste único, a proibição de `db push` e `migrate reset` e como criar migrações (init gerado, SQL bruto em migração própria, migrações congeladas após o merge). |

Ordem dentro de `prepararBancoDeTeste` (RN-13a):
1. `urlBancoDeTeste()` é a primeira instrução.
2. `pg.Client` na URL devolvida pela guarda roda `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`.
3. `spawnSync(node_modules/.bin/prisma, ['migrate','deploy'])` roda **sem shell**, com `cwd` vindo de `fileURLToPath` e `env.DATABASE_URL = url`. Status diferente de 0 lança um erro com o stderr.

O harness não usa `migrate reset`, `db push` nem `TRUNCATE`.

### T-4: testes dos CAs
| Arquivo | Conteúdo |
|---|---|
| `tests/integration/support/sql.ts` | `conectar()`, `erroSql()` (devolve `{code, constraint}` e falha se a instrução for aceita), as fábricas mínimas (`criarSalao`, `criarProfissional`, `criarCliente`, `criarServico`, `inserirReserva`, `criarCenario`) e geradores de telefone, slug e e-mail únicos. |
| `tests/integration/db/drift.test.ts` | CA-1, CA-15, CA-22 |
| `tests/integration/db/reserva-exclusion.test.ts` | CA-2..CA-8, virada de dia e 1 s de sobreposição |
| `tests/integration/db/isolamento-salao.test.ts` | CA-9 |
| `tests/integration/db/cliente-unicidade.test.ts` | CA-10, CA-16 |
| `tests/integration/db/unicidade.test.ts` | CA-11, CA-17 (a–e), CA-18 |
| `tests/integration/db/append-only.test.ts` | CA-12, CA-14 |
| `tests/integration/db/jornada.test.ts` | CA-13, CA-19 |
| `tests/integration/db/defaults.test.ts` | CA-20 |

`src/**`, `prisma/**` e as migrações não foram alterados.

## 2. Testes e CAs cobertos
Todo `it` tem o ID do CA no título. Toda rejeição confere o SQLSTATE **e** o nome da constraint ou do índice (`err.constraint` do driver `pg`), comparados por igualdade. Onde a spec pede "nenhuma linha é gravada", há também uma consulta de contagem escopada aos dados do próprio teste.

| CA | Teste(s) |
|---|---|
| CA-1 | Catálogo: as 24 tabelas por igualdade de conjunto; os 11 enums com os valores na ordem; `btree_gist`; as 2 exclusions e os 16 CHECKs pelo nome, tabela e `contype` (igualdade com tudo que é `x`/`c` em `public`); a definição de `reserva_sem_sobreposicao` (`tstzrange(inicio, ocupado_ate, '[)')` e os 3 status ativos, sem `cancelado`); os 7 índices de SQL bruto pelo nome, tabela e unicidade; os 4 triggers pelo nome, tabela, `tgtype` (27/34) e função `rejeitar_alteracao_somente_insercao`; nenhuma coluna `timestamp without time zone`. Diff: `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` sai com 0 e imprime "No difference detected". Controle negativo: schema copiado para `os.tmpdir()` com `model ControleDrift` sai com 2 e cita o model. |
| CA-2 | Sobreposição 10:30–11:30 sobre 10:00–11:00: `23P01` / `reserva_sem_sobreposicao`, com contagem 1. |
| CA-3 | Com a primeira `cancelado`, a segunda é aceita. Com a primeira `concluido` ou `nao_compareceu`, a segunda é rejeitada (`23P01`), o que prova o predicado (R-5). |
| CA-4 | Reservas adjacentes são aceitas. 1 s de sobreposição dá `23P01`. |
| CA-5 | Dois profissionais com reservas sobrepostas: as duas são aceitas. |
| CA-6 | `ocupado_ate` 10:45 bloqueia a reserva das 10:30 (`23P01`), com contagem 1. |
| CA-7 | UPDATE `cancelado → confirmado` dá `23P01`, e o status continua `cancelado`. |
| CA-8 | `fim = inicio`, `fim < inicio` e `ocupado_ate < fim` dão `23514` / `reserva_ordem_chk`, com contagem 0. |
| Caso limite §6 | Com `SET TIME ZONE 'America/Sao_Paulo'`, 23:30Z–00:30Z contra 00:00Z–01:00Z dá `23P01`, e a adjacente 00:30Z é aceita. O instante gravado em UTC é conferido. |
| CA-9 | `23503` com o nome da FK composta em 10 casos: reserva × profissional de B, reserva × cliente de B, item × serviço de B, item de B × reserva de A, bloqueio × profissional de B (e bloqueio com `profissional_id` nulo aceito), jornada, `servico_profissional` (os dois lados), mensagem e consentimento. Há um controle positivo (item do próprio salão aceito). |
| CA-10 | Mesmo telefone em salões diferentes: aceito. No mesmo salão: `23505` / `cliente_salao_id_telefone_e164_key`. Duas anonimizadas: aceitas. Anonimizada com nome: `23514` / `cliente_anonimizacao_chk`. Não anonimizada sem telefone: `23514`. |
| CA-11 | Slug atual ou histórico de outro salão: `23505` / `salao_slug_pkey`. Dois atuais: `23505` / `salao_slug_atual_uniq`. Os slugs `Salao`, `-a`, `a--b`, `a-`, `salão` e `a b` dão `23514` / `salao_slug_formato_chk`. |
| CA-12 | `auditoria`: INSERT aceito. UPDATE e DELETE dão `P0001`, e a linha fica idêntica. TRUNCATE (em transação com ROLLBACK) dá `P0001`, com a mensagem `auditoria é somente inserção`. |
| CA-13 | Jornada sobreposta no mesmo dia: `23P01` / `jornada_sem_sobreposicao`. |
| CA-14 | O mesmo que o CA-12 para `assinatura_transicao`. |
| CA-15 | As 35 FKs têm `confdeltype = 'r'` e `confupdtype = 'r'`. As 12 FKs compostas do contrato existem, com `salao_id` como primeira coluna. Todo `id` é `uuid` com `gen_random_uuid()`. As únicas tabelas sem `id` são `rate_limit_janela`, `salao_slug` e `servico_profissional`. O instante de registro tem default `CURRENT_TIMESTAMP` (= `now()`), e só `rate_limit_janela` não tem um. |
| CA-16 | `+5511987654321` e `+551133334444` são aceitos. `11987654321`, `+14155550100`, `+5501987654321` e `+55119876543210` dão `23514` / `cliente_telefone_e164_chk`. Repreencher uma anonimizada dá `23514` / `cliente_anonimizacao_chk`, com nome e telefone ainda nulos. |
| CA-17 | (a) `mensagem_reserva_id_tipo_revisao_key`, e a revisão seguinte é aceita. (b) `webhook_evento_dedupe_uniq`; com a primeira de origem inválida, as duas são aceitas. (c) `assinatura_pagamento_pagamento_id_key`. (d) `assinatura_vigente_por_salao_uniq`; com a primeira encerrada, a segunda é aceita. (e) `reserva_salao_id_chave_requisicao_key`, em horários distintos para isolar da exclusion; duas com chave nula são aceitas. |
| CA-18 | Segundo gestor: `23505` / `usuario_gestor_por_salao_uniq`, e um profissional no mesmo salão é aceito. E-mail com maiúscula: `usuario_email_minusculo_chk`. E-mail repetido: `usuario_email_key`. `super_admin` com salão, ou gestor/profissional sem salão: `usuario_papel_salao_chk`. `super_admin` sem salão: aceito. Usuário em dois profissionais: `profissional_salao_id_usuario_id_key`. |
| CA-19 | 12:00–18:00 na segunda e 09:00–12:00 na terça são aceitos, assim como outro profissional no mesmo intervalo e o dia inteiro (0–1440). `inicio = fim`, `inicio > fim`, `fim > 1440` e `inicio < 0` dão `jornada_faixa_chk`. `dia_semana` -1 e 7 dão `jornada_dia_semana_chk`. |
| CA-20 | `ativo = true` por default em profissional e serviço. Defaults do salão (`America/Sao_Paulo`, 15, 120, 60, 0). Reserva com `status confirmado`, `revisao 0` e `encaixe false` por default. Item com preço -1 dá `reserva_item_preco_chk`. Duração 0 e -15 dão `reserva_item_duracao_chk`. Preço 0 é aceito, com o snapshot gravado. |
| CA-21 | `db.test.ts`: `TEST_DATABASE_URL` ausente, ou com a mesma base de `DATABASE_URL` (por outro host, usuário e `?schema`), rejeita com a mensagem da guarda (regex ancorada no início), com as duas URLs apontando para `localhost:1`. No controle, com a guarda satisfeita, a mesma porta dá `ECONNREFUSED`, o que prova que nada conecta antes da guarda. `executarPrisma` faz o filho usar a URL passada e não o `.env` (`migrate status` mostra `agenda_beleza_test` em `localhost:1`). |
| CA-22 | `drift.test.ts`: as 3 migrações começaram depois do `inicioDoReset` desta execução e terminaram sem rollback, e não há linha em `auditoria` anterior ao reset. Mais duas execuções seguidas de `npm run test:integration` (seção 3). |

## 3. Comandos executados e resultados
Ambiente: `cp .env.example .env` e `docker compose up -d --wait postgres` (projeto principal, PG 17). `npm run db:generate` foi rodado depois da entrega do DBA.

| Comando | Resultado |
|---|---|
| `npm run lint` | passou (0 avisos) |
| `npm run typecheck` | passou (inclui `tests/**`) |
| `npm run build` | passou (exit 0) |
| `npm run test:unit` com o postgres **parado** (`docker compose stop postgres`) | passou: 11 arquivos, 41 testes |
| `npm run test:integration` (1ª execução) | passou: 11 arquivos, 115 testes |
| `npm run test:integration` (2ª execução seguida, com 4 linhas em `auditoria` deixadas pela 1ª) | passou: 11 arquivos, 115 testes (CA-22) |
| `npm run test:coverage` | passou: 22 arquivos, 156 testes. **Linhas 100%**, statements 100%, funções 100%, branches 95%. Não houve exclusão nova; `src/**` não mudou. |
| CA-21 manual: `TEST_DATABASE_URL= npm run test:integration` | exit 1, com `Error: TEST_DATABASE_URL não definida…` no globalSetup |
| CA-21 manual: `TEST_DATABASE_URL=postgresql://agenda:agenda_dev@127.0.0.1:5432/agenda_beleza npm run test:integration` | exit 1, com `Error: TEST_DATABASE_URL aponta para a mesma base de DATABASE_URL…`. Antes, foi criada a tabela `sentinela_dev` na base de dev: havia 1 tabela em `public` antes e 1 depois, então a base de dev não foi alterada. A sentinela foi removida em seguida. |

A verificação manual do CA-1 (`prisma migrate dev` sem `--create-only` respondendo `Already in sync`, R-2) é da T-5, com o tester.

## 4. Riscos conhecidos e desvios do desenho
- **Sem desvio de comportamento.** Há dois acréscimos ao §3.1 do design:
  1. O `global-setup.ts` faz `project.provide('inicioDoReset', …)` para que o CA-22 tenha também uma asserção automática, além das duas execuções.
  2. `executarPrisma` relança `r.error` do `spawnSync` (binário ausente, por exemplo), em vez de devolver um status nulo.
- **Diferença no contrato do DBA, sem defeito:** a mensagem de transferência do DBA listou as exceções a `criado_em` como `auditoria`, `assinatura_transicao` e `webhook_evento`. O banco mostra também `mensagem_tentativa.iniciada_em` (`DEFAULT CURRENT_TIMESTAMP`) e `rate_limit_janela` sem instante de registro. O CA-15 confere esse estado real por igualdade. Se o DBA quiser, pode registrar essas duas tabelas no `dba.md` §3.5.
- **`salao_slug` não tem coluna `id`** (a PK é o `slug`). O CA-15 trata essa tabela como exceção explícita.
- **Contagem fixa de 35 FKs no CA-15:** uma migração futura que acrescente FKs precisa atualizar esse número. A intenção é que o teste quebre nesse caso, para que a revisão do DBA confira a nova FK.
- **R-4:** duas execuções simultâneas de `test:integration` na mesma base se destroem. Isso está documentado no README, e a base por worker é da E0.5.
- O helper `sql.ts` ficou mínimo, conforme o design. As fábricas de dois salões completos são da E0.5.
- **Limpeza:** ao final, rodei `docker compose down -v` e apaguei o `.env` (criado por mim).
