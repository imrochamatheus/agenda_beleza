# D-037 — Parecer do DBA (T-2). Sem migração.

(a) Travas: `FOR NO KEY UPDATE [SKIP LOCKED]` em `assinatura` não conflita com o `FOR KEY SHARE` das FKs de `assinatura_pagamento`/`assinatura_transicao` (matriz de travas do PostgreSQL), então os INSERTs filhos nunca esperam nem criam impasse com o dono da linha. Basta respeitar a ordem canônica: `salao` (`FOR NO KEY UPDATE`) → `assinatura` → filhas. O job usa `SKIP LOCKED` e uma transação por assinatura, sem espera cruzada. Não promover `FOR SHARE` → `NO KEY UPDATE`, nem usar `FOR UPDATE` (bloquearia os INSERTs filhos).

(b) Varrimento: medido em banco migrado com 50 mil assinaturas (~97% `ativa`), na consulta de candidatas com cursor por `id` e `LIMIT 100`. O plano foi `Index Scan using assinatura_pkey` com filtro e 5.038 buffers, em 1,8 ms. O pior caso, sem candidatas e com varrimento completo, fica na casa de poucos ms. Nenhum índice novo: a tabela tem no máximo uma linha vigente por salão, e um índice parcial por prazo só acrescentaria custo de escrita. Reavaliar acima de ~500 mil linhas. Manter os literais de estado na SQL.

(c) `assinatura_pagamento.pagamento_id` já é UNIQUE (`ON CONFLICT DO NOTHING` serve à idempotência). `aplicado_em` nulo representa pagamento registrado e não aplicado (S-3, tardio), e `marcarAplicado` o preenche na mesma transação do passo; não precisa de CHECK. Os triggers somente-inserção de `assinatura_transicao` (linha e TRUNCATE) existem e são o reuso previsto; INSERT com `ocorrida_em` explícito é permitido.

(d) CHECKs: não criar `assinatura_estado_datas_chk` agora, porque seeds e fábricas gravam estados diretos e o domínio garante os campos. Os CHECKs `valor_centavos >= 0` já existem. O status do pagamento continua TEXT, validado na aplicação.
