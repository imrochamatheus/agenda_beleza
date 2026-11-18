-- D-004 (E0.4) — Restrições que o Prisma não expressa: CHECKs, exclusion da jornada, índices
-- parciais/de expressão e triggers somente-inserção. SQL bruto escrito à mão; congelado depois do
-- merge (mudanças futuras = migração nova, revisada pelo DBA).
-- O `prisma migrate diff` NÃO enxerga estes objetos (nem para acusar drift, nem para protegê-los):
-- a existência de cada um é conferida pelo nome no catálogo (CA-1). Os nomes são contrato:
-- ver docs/demandas/D-004/dba.md, seção "Contrato de nomes".
--
-- Depende de btree_gist (20261118000100_reserva_exclusion) para a exclusion da jornada e para o
-- índice GiST do bloqueio (uuid/smallint em GiST).
--
-- Impacto: todas as tabelas estão recém-criadas e vazias; sem lock relevante nem varredura longa.
--
-- Reversão (manual; executar em ordem inversa e só se esta migração estiver aplicada):
--   DROP TRIGGER IF EXISTS assinatura_transicao_somente_insercao_truncate ON assinatura_transicao;
--   DROP TRIGGER IF EXISTS assinatura_transicao_somente_insercao_linha ON assinatura_transicao;
--   DROP TRIGGER IF EXISTS auditoria_somente_insercao_truncate ON auditoria;
--   DROP TRIGGER IF EXISTS auditoria_somente_insercao_linha ON auditoria;
--   DROP FUNCTION IF EXISTS rejeitar_alteracao_somente_insercao();
--   DROP INDEX IF EXISTS mensagem_pendentes_idx;
--   DROP INDEX IF EXISTS reserva_cliente_confirmada_idx;
--   DROP INDEX IF EXISTS bloqueio_periodo_idx;
--   DROP INDEX IF EXISTS webhook_evento_dedupe_uniq;
--   DROP INDEX IF EXISTS assinatura_vigente_por_salao_uniq;
--   DROP INDEX IF EXISTS salao_slug_atual_uniq;
--   DROP INDEX IF EXISTS usuario_gestor_por_salao_uniq;
--   ALTER TABLE mensagem             DROP CONSTRAINT IF EXISTS mensagem_destinatario_e164_chk;
--   ALTER TABLE bloqueio             DROP CONSTRAINT IF EXISTS bloqueio_ordem_chk;
--   ALTER TABLE assinatura_pagamento DROP CONSTRAINT IF EXISTS assinatura_pagamento_valor_chk;
--   ALTER TABLE reserva_item         DROP CONSTRAINT IF EXISTS reserva_item_duracao_chk;
--   ALTER TABLE reserva_item         DROP CONSTRAINT IF EXISTS reserva_item_preco_chk;
--   ALTER TABLE servico              DROP CONSTRAINT IF EXISTS servico_duracao_chk;
--   ALTER TABLE servico              DROP CONSTRAINT IF EXISTS servico_preco_chk;
--   ALTER TABLE jornada              DROP CONSTRAINT IF EXISTS jornada_sem_sobreposicao;
--   ALTER TABLE jornada              DROP CONSTRAINT IF EXISTS jornada_faixa_chk;
--   ALTER TABLE jornada              DROP CONSTRAINT IF EXISTS jornada_dia_semana_chk;
--   ALTER TABLE convite              DROP CONSTRAINT IF EXISTS convite_email_minusculo_chk;
--   ALTER TABLE usuario              DROP CONSTRAINT IF EXISTS usuario_papel_salao_chk;
--   ALTER TABLE usuario              DROP CONSTRAINT IF EXISTS usuario_email_minusculo_chk;
--   ALTER TABLE salao_slug           DROP CONSTRAINT IF EXISTS salao_slug_formato_chk;
--   ALTER TABLE cliente              DROP CONSTRAINT IF EXISTS cliente_telefone_e164_chk;
--   ALTER TABLE cliente              DROP CONSTRAINT IF EXISTS cliente_anonimizacao_chk;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261118000200_restricoes_sql';

-- ---------------------------------------------------------------------------
-- Cliente: anonimização coerente e irreversível; telefone E.164 brasileiro.
-- UNIQUE (salao_id, telefone_e164) está no init (NULLS DISTINCT: anonimizadas coexistem).
-- ---------------------------------------------------------------------------
ALTER TABLE cliente
  ADD CONSTRAINT cliente_anonimizacao_chk
  CHECK (
    (anonimizada_em IS NULL AND nome IS NOT NULL AND telefone_e164 IS NOT NULL)
    OR (anonimizada_em IS NOT NULL AND nome IS NULL AND telefone_e164 IS NULL)
  );

ALTER TABLE cliente
  ADD CONSTRAINT cliente_telefone_e164_chk
  CHECK (telefone_e164 ~ '^\+55[1-9][0-9]{9,10}$');

-- Destinatário da mensagem: mesmo formato; nulo depois da anonimização.
ALTER TABLE mensagem
  ADD CONSTRAINT mensagem_destinatario_e164_chk
  CHECK (destinatario_e164 ~ '^\+55[1-9][0-9]{9,10}$');

-- ---------------------------------------------------------------------------
-- Slug: formato e um slug atual por salão (a PK slug já dá unicidade global).
-- ---------------------------------------------------------------------------
ALTER TABLE salao_slug
  ADD CONSTRAINT salao_slug_formato_chk
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

CREATE UNIQUE INDEX salao_slug_atual_uniq ON salao_slug (salao_id) WHERE atual;

-- ---------------------------------------------------------------------------
-- Usuário: e-mail normalizado, papel x salão, um gestor por salão.
-- ---------------------------------------------------------------------------
ALTER TABLE usuario
  ADD CONSTRAINT usuario_email_minusculo_chk
  CHECK (email = lower(email));

ALTER TABLE usuario
  ADD CONSTRAINT usuario_papel_salao_chk
  CHECK ((papel = 'super_admin') = (salao_id IS NULL));

CREATE UNIQUE INDEX usuario_gestor_por_salao_uniq ON usuario (salao_id) WHERE papel = 'gestor';

ALTER TABLE convite
  ADD CONSTRAINT convite_email_minusculo_chk
  CHECK (email = lower(email));

-- ---------------------------------------------------------------------------
-- Jornada (hora local, minutos desde 00:00): faixas e sem sobreposição por profissional e dia.
-- Jornada que cruza a meia-noite local não é representável (S-3).
-- ---------------------------------------------------------------------------
ALTER TABLE jornada
  ADD CONSTRAINT jornada_dia_semana_chk
  CHECK (dia_semana BETWEEN 0 AND 6);

ALTER TABLE jornada
  ADD CONSTRAINT jornada_faixa_chk
  CHECK (0 <= inicio_min AND inicio_min < fim_min AND fim_min <= 1440);

ALTER TABLE jornada
  ADD CONSTRAINT jornada_sem_sobreposicao
  EXCLUDE USING gist (
    profissional_id WITH =,
    dia_semana WITH =,
    int4range(inicio_min, fim_min) WITH &&
  );

-- ---------------------------------------------------------------------------
-- Dinheiro (centavos, int) e duração (minutos, int).
-- ---------------------------------------------------------------------------
ALTER TABLE servico
  ADD CONSTRAINT servico_preco_chk CHECK (preco_centavos >= 0);

ALTER TABLE servico
  ADD CONSTRAINT servico_duracao_chk CHECK (duracao_min > 0);

ALTER TABLE reserva_item
  ADD CONSTRAINT reserva_item_preco_chk CHECK (preco_centavos >= 0);

ALTER TABLE reserva_item
  ADD CONSTRAINT reserva_item_duracao_chk CHECK (duracao_min > 0);

ALTER TABLE assinatura_pagamento
  ADD CONSTRAINT assinatura_pagamento_valor_chk CHECK (valor_centavos >= 0);

-- ---------------------------------------------------------------------------
-- Bloqueio: ordem e índice GiST para a consulta de disponibilidade (E3.1).
-- ---------------------------------------------------------------------------
ALTER TABLE bloqueio
  ADD CONSTRAINT bloqueio_ordem_chk CHECK (fim > inicio);

CREATE INDEX bloqueio_periodo_idx ON bloqueio
  USING gist (salao_id, tstzrange(inicio, fim, '[)'));

-- ---------------------------------------------------------------------------
-- Unicidades parciais de idempotência.
-- ---------------------------------------------------------------------------
-- Uma assinatura vigente por salão (uma 'pendente' abandonada é reutilizada ou encerrada).
CREATE UNIQUE INDEX assinatura_vigente_por_salao_uniq
  ON assinatura (salao_id) WHERE estado <> 'encerrada';

-- Deduplicação só entre eventos com origem válida: um evento forjado com a mesma chave, chegando
-- antes, não pode fazer o legítimo ser descartado.
CREATE UNIQUE INDEX webhook_evento_dedupe_uniq
  ON webhook_evento (provedor, chave_dedupe) WHERE origem_valida;

-- ---------------------------------------------------------------------------
-- Índices parciais de consulta.
-- ---------------------------------------------------------------------------
-- Reservas futuras confirmadas da cliente (limite de 3 por número, E4.2).
CREATE INDEX reserva_cliente_confirmada_idx
  ON reserva (salao_id, cliente_id, inicio) WHERE status = 'confirmado';

-- Fila de mensagens e reconciliação (E7.1, E8.3).
CREATE INDEX mensagem_pendentes_idx
  ON mensagem (estado, criado_em) WHERE estado IN ('pendente', 'enviando', 'falhou');

-- ---------------------------------------------------------------------------
-- Somente inserção: auditoria e assinatura_transicao.
-- REVOKE não basta (a aplicação é dona das tabelas). Limitação: o dono ainda pode
-- ALTER TABLE ... DISABLE TRIGGER; separar papéis fica para depois da v1.
-- DROP SCHEMA ... CASCADE (reset do harness de teste) não dispara estes triggers.
-- ---------------------------------------------------------------------------
CREATE FUNCTION rejeitar_alteracao_somente_insercao() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% é somente inserção', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER auditoria_somente_insercao_linha
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION rejeitar_alteracao_somente_insercao();

CREATE TRIGGER auditoria_somente_insercao_truncate
  BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION rejeitar_alteracao_somente_insercao();

CREATE TRIGGER assinatura_transicao_somente_insercao_linha
  BEFORE UPDATE OR DELETE ON assinatura_transicao
  FOR EACH ROW EXECUTE FUNCTION rejeitar_alteracao_somente_insercao();

CREATE TRIGGER assinatura_transicao_somente_insercao_truncate
  BEFORE TRUNCATE ON assinatura_transicao
  FOR EACH STATEMENT EXECUTE FUNCTION rejeitar_alteracao_somente_insercao();
