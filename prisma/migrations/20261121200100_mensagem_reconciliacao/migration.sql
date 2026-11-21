-- D-024 (E7.1) — Índices da reconciliação de mensagens e CHECK da revisão. Parecer: docs/demandas/D-024/dba.md.
-- Congelada depois do merge (mudanças futuras = migração nova).
--
-- Impacto: aditiva. CREATE INDEX (não CONCURRENTLY, pois roda em transação) toma SHARE sobre "mensagem"
-- durante a construção; tabela vazia ou pequena. O CHECK é validado sobre as linhas existentes
-- (revisao nunca é negativa na aplicação).
--
-- Consultas atendidas (literais, nunca parâmetro, para o plano parcial valer, como o 'confirmado' da D-016):
--   WHERE estado = 'pendente'  AND atualizado_em < $1 ORDER BY atualizado_em LIMIT n
--   WHERE estado = 'enviando'  AND atualizado_em < $1 ORDER BY atualizado_em LIMIT n
--
-- Reversão:
--   DROP INDEX "mensagem_reconciliacao_idx";
--   ALTER TABLE "mensagem" DROP CONSTRAINT "mensagem_revisao_chk";

CREATE INDEX "mensagem_reconciliacao_idx" ON "mensagem" ("estado", "atualizado_em")
  WHERE "estado" IN ('pendente', 'enviando');

ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_revisao_chk" CHECK ("revisao" >= 0);
