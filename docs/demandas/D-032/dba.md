# D-032 (E4.5) — Parecer do DBA

## 1. Impacto e compatibilidade
Migração `prisma/migrations/20261122000000_avaliacao/migration.sql`, aditiva: 2 tabelas novas (`avaliacao_convite`, `avaliacao`); nenhuma tabela existente é alterada. Sem locks relevantes (FKs para `reserva(salao_id,id)`, `cliente(salao_id,id)`, `salao(id)` já indexadas). Sem extensão nova. Aplica em banco limpo e com seed.
- `avaliacao_convite`: UNIQUE `reserva_id` (convite estável, `ON CONFLICT (reserva_id) DO NOTHING`), UNIQUE `token_hash` (busca por igualdade), CHECK hash = 64, CHECK `expira_em > criado_em`, FK composta `(salao_id, reserva_id)` RESTRICT.
- `avaliacao`: UNIQUE `reserva_id`, nota 1..5, comentário <= 1000, nome <= 100 (ambos nullable p/ anonimização), `versao_termos` com o mesmo formato de `consentimento_versao_termos_chk`, FKs compostas `(salao_id, reserva_id)` e `(salao_id, cliente_id)` RESTRICT, `retirada_por` sem FK (E8.4). Nada de CASCADE.
- Índices: `avaliacao_publica_idx (salao_id, criado_em DESC, id)`; `(salao_id, cliente_id)` para anonimização.
- Prisma: relações de `Reserva` são 1:N (`avaliacoes`, `convitesAvaliacao`); a unicidade 1:1 vem do UNIQUE em `reserva_id`. `cliente_id` coerente com a reserva é responsabilidade do serviço (grava o `cliente_id` da reserva travada).

## 2. Ordem de travas
Concordo com o design §3.3: `salao` (FOR NO KEY UPDATE, quando usado) -> reserva `FOR SHARE` -> cliente `FOR SHARE` -> convite `FOR UPDATE` -> `INSERT avaliacao ON CONFLICT (reserva_id) DO NOTHING RETURNING` -> `UPDATE convite SET usado_em WHERE usado_em IS NULL`. Convite e avaliação ficam por último (após mensagem, ou junto: nunca antes de reserva/cliente). Anonimização: salão -> cliente FOR UPDATE -> mensagem -> avaliacao/convite. Sem ciclo. Nunca promover FOR SHARE para FOR UPDATE na mesma linha. Nunca capturar 23505 dentro da transação (a trava serializa; o UNIQUE é só rede de segurança).

## 3. Leitura pública (EXPLAIN, 50 mil avaliações em um salão)
Teste `tests/integration/avaliacoes/esquema.test.ts` (imprime `[D-032]`). Lista `ORDER BY criado_em DESC, id DESC LIMIT 10` com joins a `reserva` (status `concluido`) e `cliente` (`anonimizada_em IS NULL`): Index Scan em `avaliacao_publica_idx` + Incremental Sort, 11 linhas lidas, 0,07 ms. Agregado `count(*)` + `round(avg(nota)::numeric,1)` com os mesmos joins: ~23 ms para 50 mil (leitura do salão inteiro, joins por PK/UNIQUE). Aceitável; índice parcial dispensado. Se um salão passar de ~200 mil avaliações, considerar contadores materializados (E8.x), não agora. Os joins ao predicado de visibilidade devem usar `(salao_id, id)`.

## 4. Reversão
`DROP TABLE "avaliacao"; DROP TABLE "avaliacao_convite";` (perde convites e avaliações; nada mais depende). Só antes de haver dados que importem.

## 5. Orientações ao desenvolvedor
- Gerador: `INSERT … ON CONFLICT (reserva_id) DO NOTHING`; não renova a validade.
- Envio: seguir §2; `RETURNING` vazio -> resposta uniforme `link_invalido`, nunca erro 23505.
- Anonimização: `UPDATE avaliacao SET nome_exibicao=NULL, comentario=NULL` e `UPDATE avaliacao_convite SET invalidado_em` pela reserva da cliente, atualizar os testes de contrato.
- Atualizar contratos existentes (fora do escopo do DBA nesta rodada): `tests/integration/db/drift.test.ts` (TABELAS +2: `avaliacao`, `avaliacao_convite`; CONSTRAINTS_SQL_BRUTO +6: `avaliacao_convite_token_hash_chk`, `avaliacao_convite_validade_chk`, `avaliacao_nota_chk`, `avaliacao_comentario_chk`, `avaliacao_nome_exibicao_chk`, `avaliacao_versao_termos_chk`; contagem de FKs 39 -> 44; lista de migrações) e `tests/integration/harness/template.test.ts` (lista de migrações aplicadas).
