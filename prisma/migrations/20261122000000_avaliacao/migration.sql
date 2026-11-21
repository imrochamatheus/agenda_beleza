-- D-032 (E4.5) — Avaliações verificadas: convite individual (hash do token) e avaliação (1 por reserva).
-- Parecer: docs/demandas/D-032/dba.md. Congelada depois do merge (mudanças futuras = migração nova).
--
-- Impacto: aditiva (2 tabelas novas, sem tocar tabelas existentes além de FKs que as referenciam).
-- Locks: nenhum sobre dados existentes; os FKs compostos exigem apenas SHARE ROW EXCLUSIVE breve em
-- "reserva", "cliente" e "salao" (já têm UNIQUE (salao_id, id)).
--
-- Reversão (manual; perde convites e avaliações):
--   DROP TABLE "avaliacao"; DROP TABLE "avaliacao_convite";

CREATE TABLE "avaliacao_convite" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "salao_id" UUID NOT NULL,
  "reserva_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expira_em" TIMESTAMPTZ(6) NOT NULL,
  "usado_em" TIMESTAMPTZ(6),
  "invalidado_em" TIMESTAMPTZ(6),
  "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "avaliacao_convite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "avaliacao" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "salao_id" UUID NOT NULL,
  "reserva_id" UUID NOT NULL,
  "cliente_id" UUID NOT NULL,
  "nota" SMALLINT NOT NULL,
  "comentario" TEXT,
  "nome_exibicao" TEXT,
  "publicacao_aceita_em" TIMESTAMPTZ(6) NOT NULL,
  "versao_termos" TEXT NOT NULL,
  "retirada_em" TIMESTAMPTZ(6),
  "retirada_por" UUID,
  "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "avaliacao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "avaliacao_convite_reserva_id_key" ON "avaliacao_convite"("reserva_id");
CREATE UNIQUE INDEX "avaliacao_convite_token_hash_key" ON "avaliacao_convite"("token_hash");
CREATE INDEX "avaliacao_convite_salao_id_reserva_id_idx" ON "avaliacao_convite"("salao_id", "reserva_id");
CREATE UNIQUE INDEX "avaliacao_reserva_id_key" ON "avaliacao"("reserva_id");
CREATE INDEX "avaliacao_publica_idx" ON "avaliacao"("salao_id", "criado_em" DESC, "id");
CREATE INDEX "avaliacao_salao_id_cliente_id_idx" ON "avaliacao"("salao_id", "cliente_id");

ALTER TABLE "avaliacao_convite" ADD CONSTRAINT "avaliacao_convite_salao_id_reserva_id_fkey"
  FOREIGN KEY ("salao_id", "reserva_id") REFERENCES "reserva"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_salao_id_reserva_id_fkey"
  FOREIGN KEY ("salao_id", "reserva_id") REFERENCES "reserva"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_salao_id_cliente_id_fkey"
  FOREIGN KEY ("salao_id", "cliente_id") REFERENCES "cliente"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "avaliacao_convite" ADD CONSTRAINT "avaliacao_convite_salao_id_fkey"
  FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_salao_id_fkey"
  FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- SQL bruto (invisível ao Prisma).
ALTER TABLE "avaliacao_convite" ADD CONSTRAINT "avaliacao_convite_token_hash_chk" CHECK (char_length("token_hash") = 64);
ALTER TABLE "avaliacao_convite" ADD CONSTRAINT "avaliacao_convite_validade_chk" CHECK ("expira_em" > "criado_em");
ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_nota_chk" CHECK ("nota" BETWEEN 1 AND 5);
ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_comentario_chk" CHECK ("comentario" IS NULL OR char_length("comentario") <= 1000);
ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_nome_exibicao_chk" CHECK ("nome_exibicao" IS NULL OR char_length("nome_exibicao") <= 100);
ALTER TABLE "avaliacao" ADD CONSTRAINT "avaliacao_versao_termos_chk" CHECK ("versao_termos" ~ '^[a-z0-9._-]{1,40}$');
