# D-004 — Testes (T-5, tester)

## Rodada 1 — 18/11/2026

### Ambiente
- Branch `feat/d-004-esquema-prisma`, árvore de trabalho sem commit (base `189f178`). Node 24.21.0, Prisma 7.10.1, PostgreSQL 17.12 (`postgres:17` do compose), `btree_gist` 1.7. Adaptadores: não se aplica.
- Preparação: `cp .env.example .env; docker compose up -d --wait postgres; npm run db:generate`.
- Mutações: cópia do repositório em diretório temporário fora do repo (com `node_modules` por link simbólico) e base descartável `tester_mut` no mesmo container, com `TEST_DATABASE_URL` apontando para ela. O repositório não foi alterado (só este arquivo).

### Gates
| Comando | Resultado |
|---|---|
| `npm run lint` | exit 0, 0 avisos |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm run test:unit` com o PostgreSQL **parado** (`docker compose stop postgres`, `docker compose ps` vazio) | exit 0: 11 arquivos, 41 testes |
| `npm run test:integration` (1ª execução) | exit 0: 11 arquivos, 115 testes |
| `npm run test:integration` (2ª execução seguida; a 1ª deixou 4 linhas em `auditoria` e 4 em `assinatura_transicao`) | exit 0: 11 arquivos, 115 testes (CA-22) |
| `npm run test:coverage` | exit 0: 22 arquivos, 156 testes. **Linhas 100% (85/85)**, statements 100%, funções 100%, branches 95%. Limiar `lines: 90` no `vitest.config.ts` intacto |
| Exclusões de cobertura | Sem mudança (o diff do `vitest.config.ts` só acrescenta o `globalSetup` ao projeto `integration`). `src/**` não mudou |
| Playwright | Não se aplica (não há UI nesta demanda) |

### CA-1: verificações manuais
- **Init não editado à mão:** `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` regenerado no scratchpad e comparado com `diff` a `prisma/migrations/20261118000000_init/migration.sql`: **idêntico**. O init tem 35 `FOREIGN KEY`, 35 `ON DELETE RESTRICT ON UPDATE RESTRICT` e 0 `CASCADE`/`SET NULL`.
- **`migrate dev` sem `--create-only` (decisão R-2):** na base de dev (`agenda_beleza`), `npx prisma migrate deploy` aplicou as 3 migrações; em seguida `npx prisma migrate dev` respondeu `Already in sync, no schema change or pending migration was found.`. Nenhuma pasta nova em `prisma/migrations/`, e o catálogo da base de dev continuou com `reserva_sem_sobreposicao`, `jornada_sem_sobreposicao`, `reserva_ordem_chk` e os 4 triggers.
- **Diff com controle negativo:** coberto pelo `drift.test.ts` (exit 0 com o schema real; exit 2 com `model ControleDrift` a mais). Reexecutado nas mutações M7, M8, M12 e M22, em que o diff acusou drift (FK simples, FK com CASCADE, índice único removido).
- **Catálogo contra remoção manual:** base descartável recém-migrada, vitest com o `globalSetup` desligado só na cópia. Controle: `drift.test.ts -t CA-1` com 14 aprovados. Depois de `ALTER TABLE reserva DROP CONSTRAINT reserva_sem_sobreposicao`, **2 testes falham**: "cada exclusion e CHECK de SQL bruto existe pelo nome…" e "reserva_sem_sobreposicao usa tstzrange…". Na mesma base, `migrate diff --exit-code` respondeu `No difference detected.` com exit 0, o que confirma a R-1 do desenho: só o catálogo protege os objetos de SQL bruto.

### Mutações (cada uma aplicada à cópia das migrações; os testes têm de falhar)
| ID | Mutação | Testes que falharam (pegaram a mutação) |
|---|---|---|
| M1 | `cancelado` no predicado da exclusion | CA-3, CA-7, CA-1 (definição) |
| M2 | `concluido` fora do predicado | CA-3 (predicado `concluido`) |
| M3 | limites `'[]'` em vez de `'[)'` | CA-4 (adjacência), virada de dia |
| M4 | `tstzrange(inicio, fim)` em vez de `ocupado_ate` | CA-6 |
| M5 | sem `reserva_sem_sobreposicao` | CA-2, CA-3 ×2, CA-4 (1 s), CA-6, CA-7, virada de dia, CA-1 ×2 |
| M6 | sem `reserva_ordem_chk` | CA-8 ×3 |
| M7 | FK `reserva → profissional` simples (não composta) | CA-9, CA-15 (compostas), CA-1 (diff) |
| M8 | FK `reserva → cliente` com `CASCADE` | CA-15 (RESTRICT), CA-1 (diff) |
| M9 | FK `reserva_item → servico` simples | CA-9 (serviço de B) |
| M10 | E.164 com `{9,11}` | CA-16 (`+55119876543210`) |
| M11 | sem `cliente_anonimizacao_chk` | CA-10 ×2, CA-16 (irreversibilidade) |
| M12 | sem `UNIQUE (salao_id, telefone_e164)` | CA-10, CA-1 (diff) |
| M13 | mesmo unique com `NULLS NOT DISTINCT` | CA-10 (duas anonimizadas) |
| M14 | sem trigger TRUNCATE de `auditoria` | CA-12 (TRUNCATE), CA-1 (triggers) |
| M15 | trigger de linha de `assinatura_transicao` só em UPDATE | CA-14 (DELETE), CA-1 (triggers) |
| M16 | `salao_slug_atual_uniq` não único | CA-11 (dois atuais), CA-1 (índices) |
| M17 | regex de slug `^[a-z0-9-]+$` | CA-11 (`-a`, `a--b`, `a-`) |
| M18 | sem `jornada_sem_sobreposicao` | CA-13 |
| M19 | faixa da jornada até 1441 | CA-19 (`fim_min > 1440`) |
| M20 | exclusion da jornada sem `dia_semana` | CA-19 ×2 |
| M21 | unique de mensagem sem `revisao` | CA-17a |
| M22 | sem unique de mensagem | CA-17a, CA-1 (diff) |
| M23 | dedupe de webhook sem `WHERE origem_valida` | CA-17b (origem inválida antes) |
| M24 | assinatura vigente sem `WHERE estado <> 'encerrada'` | CA-17d (encerrada + nova) |
| M25 | `usuario_papel_salao_chk` só em uma direção | CA-18 (`super_admin` com salão) |
| M26 | sem `reserva_item_duracao_chk` | CA-20 ×2 |

As 26 mutações foram mortas. Os testes conferem `code` e `constraint` por igualdade (`toEqual({code, constraint})`), e o `erroSql()` falha o teste quando a instrução é aceita. Os testes de append-only conferem `P0001`, a mensagem `<tabela> é somente inserção` e que a linha continua idêntica.

Fumaça extra (fora dos CAs, objetos só conferidos pelo catálogo): `servico_preco_chk`, `servico_duracao_chk`, `bloqueio_ordem_chk`, `convite_email_minusculo_chk` e `assinatura_pagamento_valor_chk` rejeitam com 23514 na base descartável.

### CA-21: verificação manual
Na base de dev, criei a tabela `sentinela_tester` (valor 42) e um salão `sentinela`. A captura antes/depois traz migrações, tabelas em `public`, salões, sentinela e exclusion presente.
- Antes: `3|26|1|42|1`.
- `TEST_DATABASE_URL= npm run test:integration` → exit 1, `Error: TEST_DATABASE_URL não definida…`. Depois: `3|26|1|42|1`.
- `TEST_DATABASE_URL='postgresql://agenda:agenda_dev@127.0.0.1:5432/agenda_beleza?schema=public' npm run test:integration` (outro host e `?schema`) → exit 1, `Error: TEST_DATABASE_URL aponta para a mesma base de DATABASE_URL…`. Depois: `3|26|1|42|1`.
- A base de dev não foi alterada. A sentinela foi removida em seguida. O teste automático (`db.test.ts`) prova com porta fechada que nada conecta antes da guarda (controle com `ECONNREFUSED`).

### Outras verificações
- **SQL inverso em comentário (RN-14):** `_reserva_exclusion` traz `DROP CONSTRAINT` de `reserva_sem_sobreposicao` e de `reserva_ordem_chk`, a remoção da linha em `_prisma_migrations`, e mantém a extensão. `_restricoes_sql` traz os 4 triggers, a função, os 7 índices e as 17 constraints, em ordem inversa.
- **RN-2 no catálogo:** `salao_id` é anulável só em `usuario`, `auditoria` e `webhook_evento` (justificado no `dba.md` §2). Nenhum índice tem `salao_id` fora da 1ª posição. As FKs de coluna única são só para `salao`, `usuario` (sessão, token, ator da auditoria), `assinatura`, `mensagem` e `webhook_evento`, todas tabelas sem escopo composto, conforme o `dba.md`.
- **Colunas da spec §3 item 2** existem com os tipos e defaults: `suspenso_manual_em`, `revisao` (default 0), `ocupado_ate`, `chave_requisicao` (anulável), `atualizado_em`, `anonimizada_em`, snapshot `int`, `fuso` e a PK `(chave, janela_inicio)` de `rate_limit_janela`.
- **Fora do escopo:** nenhuma coluna de cartão, caixa, estoque, comissão, fidelidade ou lembrete (grep no schema e consulta no catálogo, 0 ocorrências).
- **Documentação:** o README tem a seção "Banco de teste e migrações". `.env.example`, CI e compose não mudam (nenhuma variável nova; o DevOps foi dispensado no desenho §5).

### Resultado por CA
| CA | Estado | Evidência |
|---|---|---|
| CA-1 | passou | `drift.test.ts` (catálogo, diff, controle negativo); `migrate dev` "Already in sync"; init idêntico ao regenerado; remoção manual da exclusion detectada |
| CA-2..CA-8 | passou | `reserva-exclusion.test.ts`; M1–M6 |
| CA-9 | passou | `isolamento-salao.test.ts` (10 casos + controle); M7, M9 |
| CA-10, CA-16 | passou | `cliente-unicidade.test.ts`; M10–M13 |
| CA-11 | passou | `unicidade.test.ts`; M16, M17 |
| CA-12, CA-14 | passou | `append-only.test.ts`; M14, M15 |
| CA-13, CA-19 | passou | `jornada.test.ts`; M18–M20 |
| CA-15 | passou | `drift.test.ts` (35 FKs `r`/`r`, 12 compostas, `uuid`/`gen_random_uuid()`, `now()`); M7, M8 |
| CA-17 | passou | `unicidade.test.ts` (a–e); M21–M24 |
| CA-18 | passou | `unicidade.test.ts`; M25 |
| CA-20 | passou | `defaults.test.ts`; M26 |
| CA-21 | passou | `db.test.ts` + verificação manual acima |
| CA-22 | passou | duas execuções seguidas com linhas em `auditoria`; asserção `inicioDoReset` em `drift.test.ts` |

### Defeitos
Nenhum defeito crítico, alto, médio ou baixo.

Observações, que não são defeitos:
- O `migrate diff` é cego aos objetos de SQL bruto. Isso foi confirmado de novo: com a exclusion removida, o diff deu exit 0. A proteção é o teste de catálogo, que pegou a remoção. Toda migração futura precisa da revisão do DBA (R-1).
- O CA-15 fixa 35 FKs: uma FK nova exige atualizar o teste. Isso é intencional (`dev.md` §4).

### Veredito
**APROVADO.** Os 22 CAs passaram, todos os gates passaram, a cobertura de linhas é de 100% (≥ 90%) e não há defeito em aberto.

### Limpeza
`docker compose down -v`, remoção do `.env`, da cópia do repositório e da base `tester_mut` (que some com o volume). O `git status` antes e depois é o mesmo, exceto por este arquivo.
