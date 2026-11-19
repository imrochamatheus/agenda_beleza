-- D-007 (E0.6) — Estado persistente dos adaptadores simulados do Mercado Pago e do WhatsApp.
-- Parecer e contrato de nomes: docs/demandas/D-007/dba.md. Congelada depois do merge
-- (mudanças futuras = migração nova, revisada pelo DBA).
--
-- Parte 1 (até "Parte 2"): gerada por
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- sobre uma base com as 3 migrações da D-004 aplicadas, e NÃO editada.
-- Parte 2: SQL bruto (CHECKs e COMMENT ON TABLE), que o Prisma não expressa nem compara no diff.
--
-- Regras:
-- - Tabelas de PLATAFORMA, só do modo simulado: sem salao_id e sem FK para o domínio (o simulado
--   imita um sistema externo; referencia_externa guarda o salaoId como texto). FKs só entre sim_mp_*,
--   ON DELETE RESTRICT ON UPDATE RESTRICT.
-- - Lidas e escritas só por src/server/repos/sim-*.ts. Em produção (adaptadores reais) ficam vazias.
-- - Nenhuma coluna de cartão, segredo ou token de provedor.
-- - email_pagador e destinatario são dados pessoais FORA da anonimização da E5.2 (D-4): a limpeza
--   é manual (ver docs/demandas/D-007/dba.md §2.7).
-- - sim_whatsapp_chamada.modelo é text (a chamada com modelo inválido também é registrada, RN-19);
--   .resultado reaproveita resultado_tentativa (valor produzido pelo próprio simulado).
--
-- Impacto: só cria objetos novos (4 tipos, 6 tabelas vazias, 7 índices, 2 FKs, 4 CHECKs).
-- Nenhuma tabela existente é tocada; sem lock relevante; < 1 s.
--
-- Reversão (manual; não há "migrate down" no Prisma). Só sem dados que importem; em base que não
-- seja local/teste, exige autorização explícita do usuário. Reverter também o schema.prisma.
-- resultado_tentativa NÃO é removido (pertence ao domínio, D-004).
--   DROP TABLE IF EXISTS sim_mp_pagamento;
--   DROP TABLE IF EXISTS sim_mp_adiamento;
--   DROP TABLE IF EXISTS sim_mp_erro_forcado;
--   DROP TABLE IF EXISTS sim_mp_assinatura;
--   DROP TABLE IF EXISTS sim_whatsapp_chamada;
--   DROP TABLE IF EXISTS sim_whatsapp_falha_forcada;
--   DROP TYPE IF EXISTS sim_mp_estado_assinatura;
--   DROP TYPE IF EXISTS sim_mp_status_pagamento;
--   DROP TYPE IF EXISTS sim_mp_operacao;
--   DROP TYPE IF EXISTS sim_whatsapp_tipo_falha;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261119000000_simuladores_integracao';

-- ===========================================================================
-- Parte 1: gerada pelo prisma migrate diff (não editar)
-- ===========================================================================
-- CreateEnum
CREATE TYPE "sim_mp_estado_assinatura" AS ENUM ('pendente', 'autorizada', 'cancelada');

-- CreateEnum
CREATE TYPE "sim_mp_status_pagamento" AS ENUM ('aprovado', 'recusado');

-- CreateEnum
CREATE TYPE "sim_mp_operacao" AS ENUM ('criarAssinatura', 'consultarAssinatura', 'consultarPagamento', 'cancelarAssinatura', 'adiarProximaCobranca');

-- CreateEnum
CREATE TYPE "sim_whatsapp_tipo_falha" AS ENUM ('temporaria', 'permanente');

-- CreateTable
CREATE TABLE "sim_mp_assinatura" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "referencia_externa" TEXT NOT NULL,
    "email_pagador" TEXT NOT NULL,
    "url_retorno" TEXT NOT NULL,
    "estado" "sim_mp_estado_assinatura" NOT NULL DEFAULT 'pendente',
    "valor_centavos" INTEGER NOT NULL,
    "autorizada_em" TIMESTAMPTZ(6),
    "proxima_cobranca_em" TIMESTAMPTZ(6),
    "cancelada_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_mp_assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_mp_pagamento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assinatura_id" UUID NOT NULL,
    "status" "sim_mp_status_pagamento" NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    "cobrado_em" TIMESTAMPTZ(6) NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_mp_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_mp_adiamento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assinatura_id" UUID NOT NULL,
    "data_anterior" TIMESTAMPTZ(6),
    "nova_data" TIMESTAMPTZ(6) NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_mp_adiamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_mp_erro_forcado" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operacao" "sim_mp_operacao" NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_mp_erro_forcado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_whatsapp_chamada" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "destinatario" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "parametros" JSONB NOT NULL,
    "chave_idempotencia" TEXT NOT NULL,
    "resultado" "resultado_tentativa" NOT NULL,
    "tipo_falha" "sim_whatsapp_tipo_falha",
    "provedor_mensagem_id" TEXT,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_whatsapp_chamada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_whatsapp_falha_forcada" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" "sim_whatsapp_tipo_falha" NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_whatsapp_falha_forcada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sim_mp_assinatura_referencia_externa_idx" ON "sim_mp_assinatura"("referencia_externa");

-- CreateIndex
CREATE INDEX "sim_mp_pagamento_assinatura_id_cobrado_em_idx" ON "sim_mp_pagamento"("assinatura_id", "cobrado_em");

-- CreateIndex
CREATE INDEX "sim_mp_adiamento_assinatura_id_criado_em_idx" ON "sim_mp_adiamento"("assinatura_id", "criado_em");

-- CreateIndex
CREATE INDEX "sim_mp_erro_forcado_operacao_criado_em_id_idx" ON "sim_mp_erro_forcado"("operacao", "criado_em", "id");

-- CreateIndex
CREATE INDEX "sim_whatsapp_chamada_chave_idempotencia_idx" ON "sim_whatsapp_chamada"("chave_idempotencia");

-- CreateIndex
CREATE INDEX "sim_whatsapp_chamada_criado_em_idx" ON "sim_whatsapp_chamada"("criado_em");

-- CreateIndex
CREATE INDEX "sim_whatsapp_falha_forcada_criado_em_id_idx" ON "sim_whatsapp_falha_forcada"("criado_em", "id");

-- AddForeignKey
ALTER TABLE "sim_mp_pagamento" ADD CONSTRAINT "sim_mp_pagamento_assinatura_id_fkey" FOREIGN KEY ("assinatura_id") REFERENCES "sim_mp_assinatura"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sim_mp_adiamento" ADD CONSTRAINT "sim_mp_adiamento_assinatura_id_fkey" FOREIGN KEY ("assinatura_id") REFERENCES "sim_mp_assinatura"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ===========================================================================
-- Parte 2: SQL bruto (o Prisma não enxerga; o drift.test.ts confere pelo nome)
-- ===========================================================================

-- Coerência da assinatura simulada com o estado (RN-17). SQLSTATE 23514.
ALTER TABLE sim_mp_assinatura
  ADD CONSTRAINT sim_mp_assinatura_estado_chk
  CHECK (
    (estado <> 'pendente' OR (autorizada_em IS NULL AND proxima_cobranca_em IS NULL))
    AND (estado <> 'autorizada' OR (autorizada_em IS NOT NULL AND proxima_cobranca_em IS NOT NULL))
    AND ((estado = 'cancelada') = (cancelada_em IS NOT NULL))
  );

ALTER TABLE sim_mp_assinatura
  ADD CONSTRAINT sim_mp_assinatura_valor_chk CHECK (valor_centavos > 0);

ALTER TABLE sim_mp_pagamento
  ADD CONSTRAINT sim_mp_pagamento_valor_chk CHECK (valor_centavos > 0);

-- Sucesso tem ID do provedor e não tem tipo de falha; falha tem tipo e não tem ID (RN-19).
ALTER TABLE sim_whatsapp_chamada
  ADD CONSTRAINT sim_whatsapp_chamada_resultado_chk
  CHECK (
    (resultado = 'sucesso' AND tipo_falha IS NULL AND provedor_mensagem_id IS NOT NULL)
    OR (resultado = 'falha' AND tipo_falha IS NOT NULL AND provedor_mensagem_id IS NULL)
  );

COMMENT ON TABLE sim_mp_assinatura IS 'Somente adaptador simulado do Mercado Pago (D-007). Vazia em produção.';
COMMENT ON TABLE sim_mp_pagamento IS 'Somente adaptador simulado do Mercado Pago (D-007). Vazia em produção.';
COMMENT ON TABLE sim_mp_adiamento IS 'Somente adaptador simulado do Mercado Pago (D-007). Vazia em produção.';
COMMENT ON TABLE sim_mp_erro_forcado IS 'Somente adaptador simulado do Mercado Pago (D-007). Vazia em produção.';
COMMENT ON TABLE sim_whatsapp_chamada IS 'Somente adaptador simulado do WhatsApp (D-007). Vazia em produção.';
COMMENT ON TABLE sim_whatsapp_falha_forcada IS 'Somente adaptador simulado do WhatsApp (D-007). Vazia em produção.';
