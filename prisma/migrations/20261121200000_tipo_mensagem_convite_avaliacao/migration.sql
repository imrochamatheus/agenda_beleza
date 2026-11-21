-- D-024 (E7.1) — Valor 'convite_avaliacao' no enum tipo_mensagem. Parecer: docs/demandas/D-024/dba.md.
-- Um único comando, de propósito: o valor novo não pode ser usado na transação em que nasce, e nada
-- (nem a migração seguinte) o referencia. Congelada depois do merge.
--
-- Impacto: aditiva e instantânea; sem reescrita de tabela. Lock breve no catálogo do tipo.
--
-- Reversão: o PostgreSQL não remove valor de enum. Só antes de existir linha com o valor, recriar o tipo:
--   ALTER TYPE tipo_mensagem RENAME TO tipo_mensagem_old;
--   CREATE TYPE tipo_mensagem AS ENUM ('confirmacao', 'remarcacao', 'cancelamento');
--   ALTER TABLE mensagem ALTER COLUMN tipo TYPE tipo_mensagem USING tipo::text::tipo_mensagem;
--   DROP TYPE tipo_mensagem_old;
-- Com linhas 'convite_avaliacao' existentes, apagá-las antes de forma consciente (ou deixar o valor, inofensivo).

ALTER TYPE "tipo_mensagem" ADD VALUE IF NOT EXISTS 'convite_avaliacao';
