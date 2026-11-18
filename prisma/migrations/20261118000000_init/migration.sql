-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "papel_usuario" AS ENUM ('gestor', 'profissional', 'super_admin');

-- CreateEnum
CREATE TYPE "tipo_token" AS ENUM ('confirmacao_email', 'recuperacao_senha');

-- CreateEnum
CREATE TYPE "status_reserva" AS ENUM ('confirmado', 'cancelado', 'concluido', 'nao_compareceu');

-- CreateEnum
CREATE TYPE "origem_reserva" AS ENUM ('publico', 'equipe');

-- CreateEnum
CREATE TYPE "origem_consentimento" AS ENUM ('publico', 'equipe');

-- CreateEnum
CREATE TYPE "estado_assinatura" AS ENUM ('pendente', 'em_teste', 'ativa', 'em_carencia', 'suspensa', 'cancelada', 'encerrada');

-- CreateEnum
CREATE TYPE "resultado_webhook" AS ENUM ('recebido', 'processado', 'ignorado', 'rejeitado', 'erro');

-- CreateEnum
CREATE TYPE "tipo_mensagem" AS ENUM ('confirmacao', 'remarcacao', 'cancelamento');

-- CreateEnum
CREATE TYPE "estado_mensagem" AS ENUM ('pendente', 'enviando', 'enviada', 'falhou', 'nao_enviada', 'substituida', 'cancelada_anonimizacao');

-- CreateEnum
CREATE TYPE "resultado_tentativa" AS ENUM ('sucesso', 'falha');

-- CreateEnum
CREATE TYPE "resultado_auditoria" AS ENUM ('sucesso', 'falha');

-- CreateTable
CREATE TABLE "salao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "fuso" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "grade_min" INTEGER NOT NULL DEFAULT 15,
    "antecedencia_min" INTEGER NOT NULL DEFAULT 120,
    "janela_dias" INTEGER NOT NULL DEFAULT 60,
    "intervalo_min" INTEGER NOT NULL DEFAULT 0,
    "suspenso_manual_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salao_slug" (
    "slug" TEXT NOT NULL,
    "salao_id" UUID NOT NULL,
    "atual" BOOLEAN NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salao_slug_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID,
    "papel" "papel_usuario" NOT NULL,
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "email_confirmado_em" TIMESTAMPTZ(6),
    "totp_segredo_cifrado" TEXT,
    "totp_ativado_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "revogada_em" TIMESTAMPTZ(6),
    "totp_verificado_em" TIMESTAMPTZ(6),
    "ultimo_uso_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "tipo" "tipo_token" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "usado_em" TIMESTAMPTZ(6),
    "invalidado_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profissional" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "usuario_id" UUID,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profissional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servico" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "preco_centavos" INTEGER NOT NULL,
    "duracao_min" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servico_profissional" (
    "salao_id" UUID NOT NULL,
    "servico_id" UUID NOT NULL,
    "profissional_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "servico_profissional_pkey" PRIMARY KEY ("salao_id","servico_id","profissional_id")
);

-- CreateTable
CREATE TABLE "jornada" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "profissional_id" UUID NOT NULL,
    "dia_semana" SMALLINT NOT NULL,
    "inicio_min" INTEGER NOT NULL,
    "fim_min" INTEGER NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jornada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "profissional_id" UUID,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fim" TIMESTAMPTZ(6) NOT NULL,
    "motivo" TEXT,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "nome" TEXT,
    "telefone_e164" TEXT,
    "anonimizada_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "origem" "origem_consentimento" NOT NULL,
    "versao_termos" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consentimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserva" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "profissional_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fim" TIMESTAMPTZ(6) NOT NULL,
    "ocupado_ate" TIMESTAMPTZ(6) NOT NULL,
    "status" "status_reserva" NOT NULL DEFAULT 'confirmado',
    "origem" "origem_reserva" NOT NULL,
    "encaixe" BOOLEAN NOT NULL DEFAULT false,
    "revisao" INTEGER NOT NULL DEFAULT 0,
    "chave_requisicao" TEXT,
    "cancelada_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserva_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "reserva_id" UUID NOT NULL,
    "servico_id" UUID NOT NULL,
    "ordem" SMALLINT NOT NULL,
    "preco_centavos" INTEGER NOT NULL,
    "duracao_min" INTEGER NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserva_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assinatura" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "estado" "estado_assinatura" NOT NULL DEFAULT 'pendente',
    "provedor_assinatura_id" TEXT,
    "teste_fim_em" TIMESTAMPTZ(6),
    "periodo_pago_ate" TIMESTAMPTZ(6),
    "primeira_falha_em" TIMESTAMPTZ(6),
    "carencia_ate" TIMESTAMPTZ(6),
    "cancelada_em" TIMESTAMPTZ(6),
    "acesso_ate" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assinatura_pagamento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assinatura_id" UUID NOT NULL,
    "pagamento_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    "aplicado_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assinatura_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assinatura_transicao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assinatura_id" UUID NOT NULL,
    "de" "estado_assinatura",
    "para" "estado_assinatura" NOT NULL,
    "causa" TEXT NOT NULL,
    "evento_id" UUID,
    "ocorrida_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assinatura_transicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_evento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provedor" TEXT NOT NULL,
    "chave_dedupe" TEXT NOT NULL,
    "tipo" TEXT,
    "recurso_id" TEXT,
    "payload" JSONB NOT NULL,
    "origem_valida" BOOLEAN NOT NULL,
    "resultado" "resultado_webhook" NOT NULL DEFAULT 'recebido',
    "salao_id" UUID,
    "erro" TEXT,
    "recebido_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processado_em" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "reserva_id" UUID NOT NULL,
    "tipo" "tipo_mensagem" NOT NULL,
    "revisao" INTEGER NOT NULL,
    "estado" "estado_mensagem" NOT NULL DEFAULT 'pendente',
    "destinatario_e164" TEXT,
    "parametros" JSONB,
    "provedor_mensagem_id" TEXT,
    "erro_codigo" TEXT,
    "enviada_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagem_tentativa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mensagem_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "iniciada_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizada_em" TIMESTAMPTZ(6),
    "resultado" "resultado_tentativa",
    "erro_codigo" TEXT,
    "erro_detalhe" TEXT,

    CONSTRAINT "mensagem_tentativa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "destinatario" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_janela" (
    "chave" TEXT NOT NULL,
    "janela_inicio" TIMESTAMPTZ(6) NOT NULL,
    "contador" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "rate_limit_janela_pkey" PRIMARY KEY ("chave","janela_inicio")
);

-- CreateTable
CREATE TABLE "convite" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "profissional_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "aceito_em" TIMESTAMPTZ(6),
    "invalidado_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ator_id" UUID,
    "ator_email_informado" TEXT,
    "acao" TEXT NOT NULL,
    "entidade" TEXT,
    "entidade_id" TEXT,
    "salao_id" UUID,
    "antes" JSONB,
    "depois" JSONB,
    "resultado" "resultado_auditoria" NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salao_slug_salao_id_idx" ON "salao_slug"("salao_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_salao_id_id_key" ON "usuario"("salao_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sessao_token_hash_key" ON "sessao"("token_hash");

-- CreateIndex
CREATE INDEX "sessao_usuario_id_idx" ON "sessao"("usuario_id");

-- CreateIndex
CREATE INDEX "sessao_expira_em_idx" ON "sessao"("expira_em");

-- CreateIndex
CREATE UNIQUE INDEX "token_token_hash_key" ON "token"("token_hash");

-- CreateIndex
CREATE INDEX "token_usuario_id_tipo_idx" ON "token"("usuario_id", "tipo");

-- CreateIndex
CREATE INDEX "token_expira_em_idx" ON "token"("expira_em");

-- CreateIndex
CREATE UNIQUE INDEX "profissional_salao_id_id_key" ON "profissional"("salao_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "profissional_salao_id_usuario_id_key" ON "profissional"("salao_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "servico_salao_id_id_key" ON "servico"("salao_id", "id");

-- CreateIndex
CREATE INDEX "servico_profissional_salao_id_profissional_id_idx" ON "servico_profissional"("salao_id", "profissional_id");

-- CreateIndex
CREATE INDEX "jornada_salao_id_profissional_id_dia_semana_idx" ON "jornada"("salao_id", "profissional_id", "dia_semana");

-- CreateIndex
CREATE INDEX "bloqueio_salao_id_profissional_id_idx" ON "bloqueio"("salao_id", "profissional_id");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_salao_id_telefone_e164_key" ON "cliente"("salao_id", "telefone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_salao_id_id_key" ON "cliente"("salao_id", "id");

-- CreateIndex
CREATE INDEX "consentimento_salao_id_cliente_id_idx" ON "consentimento"("salao_id", "cliente_id");

-- CreateIndex
CREATE INDEX "reserva_salao_id_inicio_idx" ON "reserva"("salao_id", "inicio");

-- CreateIndex
CREATE INDEX "reserva_salao_id_profissional_id_inicio_idx" ON "reserva"("salao_id", "profissional_id", "inicio");

-- CreateIndex
CREATE INDEX "reserva_salao_id_cliente_id_inicio_idx" ON "reserva"("salao_id", "cliente_id", "inicio");

-- CreateIndex
CREATE INDEX "reserva_atualizado_em_idx" ON "reserva"("atualizado_em");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_salao_id_id_key" ON "reserva"("salao_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_salao_id_chave_requisicao_key" ON "reserva"("salao_id", "chave_requisicao");

-- CreateIndex
CREATE INDEX "reserva_item_salao_id_servico_id_idx" ON "reserva_item"("salao_id", "servico_id");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_item_salao_id_reserva_id_ordem_key" ON "reserva_item"("salao_id", "reserva_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "assinatura_provedor_assinatura_id_key" ON "assinatura"("provedor_assinatura_id");

-- CreateIndex
CREATE INDEX "assinatura_salao_id_idx" ON "assinatura"("salao_id");

-- CreateIndex
CREATE UNIQUE INDEX "assinatura_pagamento_pagamento_id_key" ON "assinatura_pagamento"("pagamento_id");

-- CreateIndex
CREATE INDEX "assinatura_pagamento_assinatura_id_idx" ON "assinatura_pagamento"("assinatura_id");

-- CreateIndex
CREATE INDEX "assinatura_transicao_assinatura_id_ocorrida_em_idx" ON "assinatura_transicao"("assinatura_id", "ocorrida_em");

-- CreateIndex
CREATE INDEX "assinatura_transicao_evento_id_idx" ON "assinatura_transicao"("evento_id");

-- CreateIndex
CREATE INDEX "webhook_evento_recebido_em_idx" ON "webhook_evento"("recebido_em" DESC);

-- CreateIndex
CREATE INDEX "webhook_evento_salao_id_recebido_em_idx" ON "webhook_evento"("salao_id", "recebido_em" DESC);

-- CreateIndex
CREATE INDEX "mensagem_salao_id_criado_em_idx" ON "mensagem"("salao_id", "criado_em" DESC);

-- CreateIndex
CREATE INDEX "mensagem_salao_id_reserva_id_idx" ON "mensagem"("salao_id", "reserva_id");

-- CreateIndex
CREATE UNIQUE INDEX "mensagem_reserva_id_tipo_revisao_key" ON "mensagem"("reserva_id", "tipo", "revisao");

-- CreateIndex
CREATE UNIQUE INDEX "mensagem_tentativa_mensagem_id_numero_key" ON "mensagem_tentativa"("mensagem_id", "numero");

-- CreateIndex
CREATE INDEX "email_log_destinatario_criado_em_idx" ON "email_log"("destinatario", "criado_em" DESC);

-- CreateIndex
CREATE INDEX "rate_limit_janela_janela_inicio_idx" ON "rate_limit_janela"("janela_inicio");

-- CreateIndex
CREATE UNIQUE INDEX "convite_token_hash_key" ON "convite"("token_hash");

-- CreateIndex
CREATE INDEX "convite_salao_id_profissional_id_idx" ON "convite"("salao_id", "profissional_id");

-- CreateIndex
CREATE INDEX "auditoria_ocorrido_em_idx" ON "auditoria"("ocorrido_em" DESC);

-- CreateIndex
CREATE INDEX "auditoria_salao_id_ocorrido_em_idx" ON "auditoria"("salao_id", "ocorrido_em" DESC);

-- CreateIndex
CREATE INDEX "auditoria_ator_id_ocorrido_em_idx" ON "auditoria"("ator_id", "ocorrido_em" DESC);

-- AddForeignKey
ALTER TABLE "salao_slug" ADD CONSTRAINT "salao_slug_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "token" ADD CONSTRAINT "token_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "profissional" ADD CONSTRAINT "profissional_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "profissional" ADD CONSTRAINT "profissional_salao_id_usuario_id_fkey" FOREIGN KEY ("salao_id", "usuario_id") REFERENCES "usuario"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "servico" ADD CONSTRAINT "servico_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "servico_profissional" ADD CONSTRAINT "servico_profissional_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "servico_profissional" ADD CONSTRAINT "servico_profissional_salao_id_servico_id_fkey" FOREIGN KEY ("salao_id", "servico_id") REFERENCES "servico"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "servico_profissional" ADD CONSTRAINT "servico_profissional_salao_id_profissional_id_fkey" FOREIGN KEY ("salao_id", "profissional_id") REFERENCES "profissional"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "jornada" ADD CONSTRAINT "jornada_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "jornada" ADD CONSTRAINT "jornada_salao_id_profissional_id_fkey" FOREIGN KEY ("salao_id", "profissional_id") REFERENCES "profissional"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bloqueio" ADD CONSTRAINT "bloqueio_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "bloqueio" ADD CONSTRAINT "bloqueio_salao_id_profissional_id_fkey" FOREIGN KEY ("salao_id", "profissional_id") REFERENCES "profissional"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_salao_id_cliente_id_fkey" FOREIGN KEY ("salao_id", "cliente_id") REFERENCES "cliente"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_salao_id_profissional_id_fkey" FOREIGN KEY ("salao_id", "profissional_id") REFERENCES "profissional"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_salao_id_cliente_id_fkey" FOREIGN KEY ("salao_id", "cliente_id") REFERENCES "cliente"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reserva_item" ADD CONSTRAINT "reserva_item_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reserva_item" ADD CONSTRAINT "reserva_item_salao_id_reserva_id_fkey" FOREIGN KEY ("salao_id", "reserva_id") REFERENCES "reserva"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reserva_item" ADD CONSTRAINT "reserva_item_salao_id_servico_id_fkey" FOREIGN KEY ("salao_id", "servico_id") REFERENCES "servico"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assinatura" ADD CONSTRAINT "assinatura_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assinatura_pagamento" ADD CONSTRAINT "assinatura_pagamento_assinatura_id_fkey" FOREIGN KEY ("assinatura_id") REFERENCES "assinatura"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assinatura_transicao" ADD CONSTRAINT "assinatura_transicao_assinatura_id_fkey" FOREIGN KEY ("assinatura_id") REFERENCES "assinatura"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "assinatura_transicao" ADD CONSTRAINT "assinatura_transicao_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "webhook_evento"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "webhook_evento" ADD CONSTRAINT "webhook_evento_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_salao_id_reserva_id_fkey" FOREIGN KEY ("salao_id", "reserva_id") REFERENCES "reserva"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "mensagem_tentativa" ADD CONSTRAINT "mensagem_tentativa_mensagem_id_fkey" FOREIGN KEY ("mensagem_id") REFERENCES "mensagem"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "convite" ADD CONSTRAINT "convite_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "convite" ADD CONSTRAINT "convite_salao_id_profissional_id_fkey" FOREIGN KEY ("salao_id", "profissional_id") REFERENCES "profissional"("salao_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_ator_id_fkey" FOREIGN KEY ("ator_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

