-- D-034 (E1.5) — Super admin + TOTP: anti-replay do código (último passo de 30 s aceito) e coerência do segundo fator.
-- Parecer: docs/demandas/D-034/dba.md. Congelada depois do merge (mudanças futuras = migração nova).
--
-- Impacto: aditiva. ADD COLUMN nullable sem DEFAULT é só catálogo (sem reescrita); os CHECKs varrem "usuario"
-- (tabela pequena) sob ACCESS EXCLUSIVE por instantes.
--
-- Reversão (manual; perde só o anti-replay):
--   ALTER TABLE "usuario" DROP CONSTRAINT "usuario_totp_ativado_chk", DROP CONSTRAINT "usuario_totp_passo_chk",
--     DROP COLUMN "totp_ultimo_passo";

ALTER TABLE "usuario" ADD COLUMN "totp_ultimo_passo" BIGINT;

-- Segundo fator ativo exige segredo gravado (o inverso é permitido: segredo pendente de cadastro).
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_totp_ativado_chk"
  CHECK ("totp_ativado_em" IS NULL OR "totp_segredo_cifrado" IS NOT NULL);

ALTER TABLE "usuario" ADD CONSTRAINT "usuario_totp_passo_chk"
  CHECK ("totp_ultimo_passo" IS NULL OR "totp_ultimo_passo" >= 0);
