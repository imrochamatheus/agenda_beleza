-- D-035 (E8.4) — Denúncias de avaliações. Parecer: docs/demandas/D-035/dba.md.
-- Congelada depois do merge (mudanças futuras = migração nova).
--
-- Impacto: aditiva. Nova tabela, novo enum e um UNIQUE (salao_id, id) em "avaliacao" (necessário à FK composta;
-- "id" já é PK, logo o UNIQUE nunca falha). O CREATE UNIQUE INDEX em "avaliacao" faz SHARE lock (bloqueia escrita
-- na tabela durante a construção, ms para o volume da v1). Sem reescrita de tabela, sem alterar linhas.
-- "auditoria.acao"/"entidade" são TEXT sem CHECK: os novos valores não exigem migração.
--
-- Reversão (manual; perde denúncias):
--   DROP TABLE "avaliacao_denuncia"; DROP TYPE "motivo_denuncia_avaliacao";
--   ALTER TABLE "avaliacao" DROP CONSTRAINT "avaliacao_salao_id_id_key";

CREATE TYPE "motivo_denuncia_avaliacao" AS ENUM ('ofensivo', 'falso', 'spam', 'dados_pessoais', 'outro');

ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_salao_id_id_key" UNIQUE ("salao_id", "id");

CREATE TABLE "avaliacao_denuncia" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "salao_id" UUID NOT NULL,
  "avaliacao_id" UUID NOT NULL,
  "motivo" "motivo_denuncia_avaliacao" NOT NULL,
  "texto" TEXT,
  "ip_hash" TEXT NOT NULL,
  "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "resolvida_em" TIMESTAMPTZ(6),
  "resolvida_por" UUID,
  "resolucao" TEXT,
  CONSTRAINT "avaliacao_denuncia_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "avaliacao_denuncia" ADD CONSTRAINT "avaliacao_denuncia_salao_id_fkey"
  FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "avaliacao_denuncia" ADD CONSTRAINT "avaliacao_denuncia_salao_id_avaliacao_id_fkey"
  FOREIGN KEY ("salao_id", "avaliacao_id") REFERENCES "avaliacao"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- SQL bruto (invisível ao Prisma).
ALTER TABLE "avaliacao_denuncia" ADD CONSTRAINT "avaliacao_denuncia_texto_chk"
  CHECK ("texto" IS NULL OR (char_length("texto") BETWEEN 1 AND 500 AND "texto" = btrim("texto")));
ALTER TABLE "avaliacao_denuncia" ADD CONSTRAINT "avaliacao_denuncia_ip_hash_chk"
  CHECK (char_length("ip_hash") BETWEEN 16 AND 128);
ALTER TABLE "avaliacao_denuncia" ADD CONSTRAINT "avaliacao_denuncia_resolucao_chk"
  CHECK ("resolucao" IS NULL OR "resolucao" IN ('retirada', 'mantida'));
ALTER TABLE "avaliacao_denuncia" ADD CONSTRAINT "avaliacao_denuncia_estado_chk"
  CHECK (("resolvida_em" IS NULL) = ("resolucao" IS NULL AND "resolvida_por" IS NULL));

-- Dedupe: no máximo uma denúncia pendente por (avaliação, IP). Alvo do ON CONFLICT ... WHERE resolvida_em IS NULL.
CREATE UNIQUE INDEX "avaliacao_denuncia_pendente_uniq" ON "avaliacao_denuncia"("avaliacao_id", "ip_hash")
  WHERE "resolvida_em" IS NULL;
-- Fila de moderação: pendentes de todos os salões (visão da plataforma) e filtrada por salão, mais recentes primeiro.
CREATE INDEX "avaliacao_denuncia_fila_global_idx" ON "avaliacao_denuncia"("criado_em" DESC, "id" DESC)
  WHERE "resolvida_em" IS NULL;
CREATE INDEX "avaliacao_denuncia_fila_idx" ON "avaliacao_denuncia"("salao_id", "criado_em" DESC, "id" DESC)
  WHERE "resolvida_em" IS NULL;
CREATE INDEX "avaliacao_denuncia_avaliacao_pendente_idx" ON "avaliacao_denuncia"("avaliacao_id")
  WHERE "resolvida_em" IS NULL;
-- Histórico por avaliação (detalhe da moderação), inclusive resolvidas; sustenta também a FK composta.
CREATE INDEX "avaliacao_denuncia_salao_id_avaliacao_id_criado_em_idx" ON "avaliacao_denuncia"("salao_id", "avaliacao_id", "criado_em" DESC);
