# D-042 — Parecer do DBA

- Migração `20261126000000_sim_mp_operacao_atualizar_meio_pagamento`: `ALTER TYPE "sim_mp_operacao" ADD VALUE IF NOT EXISTS 'urlAtualizarMeioPagamento'`, sozinha no arquivo (o valor não pode ser usado na transação em que nasce; nada na migração o referencia). Aditiva, sem reescrita de tabela, lock breve no catálogo do tipo. Só afeta o simulador (`sim_*`).
- Reversão: o PostgreSQL não remove valor de enum; vale a recriação do tipo documentada no cabeçalho da migração (só sem linhas com o valor). Em produção não se aplica: o valor é inofensivo.
- Schema Prisma atualizado (valor no fim, ordem igual à do banco); `drift.test.ts` (lista de enums e `migrate diff`), `template.test.ts` (lista de migrações) e `sim-mp-operacao.test.ts` cobrem.
- `listarPagamentos` (JOIN por `assinatura_id`, ordem `criado_em`, LIMIT 12): dispensa índice novo, pois `assinatura_pagamento_assinatura_id_idx` serve o filtro e o conjunto por assinatura é pequeno.
