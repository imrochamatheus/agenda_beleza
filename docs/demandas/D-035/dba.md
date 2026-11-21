# D-035 (E8.4) — Parecer do DBA

## 1. Impacto e compatibilidade
Migração `prisma/migrations/20261124000000_avaliacao_denuncia/migration.sql`, aditiva: enum `motivo_denuncia_avaliacao`, tabela `avaliacao_denuncia` e `UNIQUE (salao_id, id)` em `avaliacao` (`avaliacao_salao_id_id_key`; não existia, necessário à FK composta; `id` é PK, então nunca falha com dados existentes). O `ADD CONSTRAINT UNIQUE` faz SHARE lock em `avaliacao` durante a construção do índice (ms no volume da v1); sem reescrita nem alteração de linhas. `auditoria.acao`/`entidade` são TEXT e a tabela não tem CHECK (verificado em teste): `avaliacao.denuncia_resolver` e `avaliacao_denuncia` não exigem migração. Aplicada em base limpa (`migrate deploy`) e no harness; `migrate diff` = "No difference detected".
Tabela: FK `salao_id` e FK composta `(salao_id, avaliacao_id)` -> `avaliacao(salao_id, id)`, ambas RESTRICT (denúncia de outro salão = 23503). `resolvida_por` sem FK. CHECKs: `_texto_chk` (NULL ou 1..500 e sem espaços nas pontas; vazio = NULL), `_ip_hash_chk` (16..128), `_resolucao_chk` (`retirada`|`mantida`), `_estado_chk` (`resolvida_em IS NULL` = `resolucao IS NULL AND resolvida_por IS NULL`).
Índices: `avaliacao_denuncia_pendente_uniq` UNIQUE parcial `(avaliacao_id, ip_hash) WHERE resolvida_em IS NULL` (alvo do `ON CONFLICT (avaliacao_id, ip_hash) WHERE resolvida_em IS NULL DO NOTHING`; a cláusula WHERE precisa estar literal); `_fila_global_idx (criado_em DESC, id DESC)` e `_fila_idx (salao_id, criado_em DESC, id DESC)`, ambos parciais pendentes; `_avaliacao_pendente_idx (avaliacao_id)` parcial (teto de 20 e `resolverPendentes`); `_salao_id_avaliacao_id_criado_em_idx` (histórico e FK composta). Índice por `retirada_em` dispensado (volume baixo, filtro sempre combinado com outros). Predicados `resolvida_em IS NULL` devem ficar literais, nunca parâmetros.

## 2. Travas
Concordo com o design §3: `avaliacao FOR UPDATE` (nunca salão) -> UPDATE de denúncias -> auditoria. A denúncia só insere (FK = `FOR KEY SHARE` na avaliação, não conflita com `FOR NO KEY UPDATE`; conflita com `FOR UPDATE` do moderador, que apenas espera sem ciclo). Nunca capturar 23505 (o dedupe é `ON CONFLICT DO NOTHING`). Teto de 20 aproximado sob corrida (aceito).

## 3. EXPLAIN (50 mil denúncias, 500 pendentes; teste imprime `[D-035]`)
Fila global `WHERE resolvida_em IS NULL ORDER BY criado_em DESC, id DESC LIMIT 20`: Index Scan em `avaliacao_denuncia_fila_global_idx`, 0,15 ms. Por salão: Index Scan parcial com LIMIT, 0,03 ms (com um salão só o planejador usa o índice global; com vários, `_fila_idx`). Contagem de pendentes por avaliação: Index Only Scan parcial, 0,29 ms para 500 linhas. As 49.500 resolvidas não entram nos índices parciais.

## 4. Reversão
`DROP TABLE "avaliacao_denuncia"; DROP TYPE "motivo_denuncia_avaliacao"; ALTER TABLE "avaliacao" DROP CONSTRAINT "avaliacao_salao_id_id_key";` (perde denúncias; nada depende, desde que o código D-035 já tenha saído).

## 5. Testes
`tests/integration/avaliacoes/denuncia-esquema.test.ts` (CHECKs, enum, dedupe, 10 inserções concorrentes = 1 linha, FK composta/RESTRICT, auditoria sem CHECK, planos). Atualizados só com acréscimos: `tests/integration/db/drift.test.ts` (tabela, enum, 4 CHECKs, 3 índices parciais, FK composta, FKs 44 -> 46, migração) e `tests/integration/harness/template.test.ts`. Prisma: `AvaliacaoDenuncia`, `MotivoDenunciaAvaliacao`, `@@unique([salaoId, id])` em `Avaliacao`; `db:generate` ok.

## 6. Orientações ao desenvolvedor
- INSERT público: `ON CONFLICT (avaliacao_id, ip_hash) WHERE resolvida_em IS NULL DO NOTHING`; `rowCount 0` = resposta uniforme `recebida`.
- Resolver: setar `resolvida_em`, `resolucao` e `resolvida_por` juntos (o CHECK recusa parcial); `texto` vazio vira NULL antes de gravar; `ip_hash` = HMAC (>= 16 caracteres).
- Chave de trava de `Repos`: `avaliacao` `FOR UPDATE` primeiro; nunca `salao`.
