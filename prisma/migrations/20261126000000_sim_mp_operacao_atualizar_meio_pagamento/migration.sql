-- D-042 (E6.3) — Valor 'urlAtualizarMeioPagamento' no enum sim_mp_operacao. Parecer: docs/demandas/D-042/dba.md.
-- Um único comando, de propósito: o valor novo não pode ser usado na transação em que nasce. Congelada depois do merge.
--
-- Impacto: aditiva e instantânea; sem reescrita de tabela. Lock breve no catálogo do tipo.
--
-- Reversão: o PostgreSQL não remove valor de enum. Só antes de existir linha com o valor, recriar o tipo:
--   ALTER TYPE sim_mp_operacao RENAME TO sim_mp_operacao_old;
--   CREATE TYPE sim_mp_operacao AS ENUM ('criarAssinatura', 'consultarAssinatura', 'consultarPagamento', 'cancelarAssinatura', 'adiarProximaCobranca');
--   ALTER TABLE <tabela que usa o tipo> ALTER COLUMN <coluna> TYPE sim_mp_operacao USING <coluna>::text::sim_mp_operacao;
--   DROP TYPE sim_mp_operacao_old;
-- Com linhas contendo o valor, apagá-las antes (tabela sim_*, só de simulação) ou deixar o valor, inofensivo.

ALTER TYPE "sim_mp_operacao" ADD VALUE IF NOT EXISTS 'urlAtualizarMeioPagamento';
