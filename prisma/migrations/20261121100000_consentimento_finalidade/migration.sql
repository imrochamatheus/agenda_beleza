-- D-023 (E4.3) — Consentimento versionado por finalidade.
-- Parecer: docs/demandas/D-023/dba.md. Congelada depois do merge (mudanças futuras = migração nova).
--
-- Impacto: aditiva. ADD COLUMN com DEFAULT constante não reescreve a tabela (PostgreSQL 11+); as linhas
-- legadas (única finalidade existente: mensagens da reserva) recebem 'mensagens_reserva'. Locks:
-- ACCESS EXCLUSIVE breve em "consentimento" (sem consumidor em produção). Índices e CHECKs rodam sobre
-- tabela vazia ou pequena.
--
-- Reversão (manual, antes de existir qualquer linha convite_avaliacao/publicacao_avaliacao):
--   DROP INDEX "consentimento_vigente_idx";
--   CREATE INDEX "consentimento_salao_id_cliente_id_idx" ON "consentimento"("salao_id", "cliente_id");
--   ALTER TABLE "consentimento" DROP CONSTRAINT "consentimento_versao_termos_chk",
--     DROP CONSTRAINT "consentimento_origem_finalidade_chk", DROP COLUMN "finalidade";
--   DROP TYPE "finalidade_consentimento";
-- Se já houver linhas de outras finalidades, elas se perdem (ou apagam-nas antes de forma consciente).

-- CreateEnum
CREATE TYPE "finalidade_consentimento" AS ENUM ('mensagens_reserva', 'convite_avaliacao', 'publicacao_avaliacao');

-- Backfill por DEFAULT; o padrão sai logo em seguida para que nenhum código grave a finalidade errada em silêncio.
ALTER TABLE "consentimento" ADD COLUMN "finalidade" "finalidade_consentimento" NOT NULL DEFAULT 'mensagens_reserva';
ALTER TABLE "consentimento" ALTER COLUMN "finalidade" DROP DEFAULT;

-- Convite e publicação de avaliação só nascem do aceite público; a equipe só registra mensagens da reserva.
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_origem_finalidade_chk"
  CHECK ("finalidade" = 'mensagens_reserva' OR "origem" = 'publico');

-- Versão dos termos: identificador curto (não vazio, sem espaços).
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_versao_termos_chk"
  CHECK ("versao_termos" ~ '^[a-z0-9._-]{1,40}$');

-- O prefixo (salao_id, cliente_id) do novo índice cobre a FK composta e o antigo índice.
DROP INDEX "consentimento_salao_id_cliente_id_idx";
CREATE INDEX "consentimento_vigente_idx" ON "consentimento"("salao_id", "cliente_id", "finalidade", "criado_em" DESC, "id" DESC);
