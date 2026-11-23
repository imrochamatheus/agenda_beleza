-- D-050 (E3.6, issue #111) — O item da reserva passa a ser a unidade de agenda: profissional, início, fim,
-- ocupado-até, status, encaixe e revisão próprios. Parecer e contrato de nomes: docs/demandas/D-050/dba.md.
-- Escrita à mão (DDL + DML + guarda); congelada depois do merge (mudanças futuras = migração nova).
--
-- Contrato de nomes com a aplicação e os testes:
--   reserva_item_sem_sobreposicao (EXCLUDE, 23P01; a ÚNICA que a aplicação traduz para horario_indisponivel)
--   reserva_item_mesma_reserva_sem_sobreposicao (EXCLUDE, 23P01; defesa em profundidade do RN-8, NUNCA traduzida)
--   reserva_item_ordem_chk, reserva_item_fim_chk, reserva_item_duracao_teto_chk, reserva_item_revisao_chk,
--   reserva_ordem_chk (recriada só com fim > inicio), mensagem_item_tipo_chk (CHECK, 23514)
--   reserva_item_salao_id_reserva_id_servico_id_key (UNIQUE, 23505; RN-2, inclusive com itens cancelados)
--   reserva_item_salao_id_profissional_id_fkey, mensagem_salao_id_reserva_id_reserva_item_id_fkey (FK, 23503)
--
-- Regras:
-- - PROIBIDO renomear valores de status_reserva: os predicados das duas exclusions usam os nomes literais.
--   As consultas que querem o GiST repetem `tstzrange(i.inicio, i.ocupado_ate, '[)')` e o literal de status.
-- - reserva.status/inicio/fim continuam armazenados como DERIVADOS dos itens (status por prioridade,
--   envelope dos não cancelados), gravados pela aplicação na mesma transação, sob reserva FOR UPDATE. Sem trigger.
-- - Migração de dados (RN-39): cada item herda profissional, status, encaixe e revisao da reserva; o item k (por
--   ordem) começa em reserva.inicio + soma das durações anteriores; fim = inicio + duracao_min; ocupado_ate = fim,
--   exceto no último, que recebe reserva.ocupado_ate. A união das ocupações por profissional fica idêntica.
-- - mensagem.reserva_item_id (nulo para confirmação, convite, "cancelar todos" e TODAS as mensagens antigas).
--
-- Guarda: antes de qualquer DDL, aborta com RAISE (SQLSTATE 23514) e as contagens se houver reserva sem itens,
-- reserva com fim <> inicio + soma das durações, serviço repetido na mesma reserva ou item com mais de 1440 min.
-- O `prisma migrate deploy` envia o arquivo inteiro numa transação implícita: qualquer erro desfaz tudo; a linha
-- em _prisma_migrations fica marcada como falha (P3009) e exige `prisma migrate resolve --rolled-back
-- 20261127000000_reserva_item_autonomo` depois de corrigir os dados.
--
-- Impacto: ACCESS EXCLUSIVE em reserva, reserva_item e mensagem até o COMMIT (leituras e escritas da agenda
-- param). UPDATE reescreve todas as linhas de reserva_item; os índices e as exclusions são construídos com uma
-- varredura cada. Medido (dba.md, Q9): 60 mil reservas / 96 mil itens em ~8 s numa máquina de desenvolvimento
-- (UPDATE 3,3 s; exclusion por profissional 3,4 s; exclusion da mesma reserva 1,2 s; o resto < 1 s).
-- Rodar com app e worker parados (docker compose stop app worker; a app aplica a migração ao subir).
--
-- Reversão (manual; não há "migrate down" no Prisma). Executar o bloco abaixo (sem o prefixo "-- ") numa única
-- transação, por exemplo extraindo-o para reversao.sql e `psql -v ON_ERROR_STOP=1 -f reversao.sql`. Ele aborta
-- (23514, com a contagem) se alguma reserva não for representável no modelo antigo: itens fora da ordem
-- contígua, com profissional, status ou encaixe diferentes entre si, ou com ocupado_ate > fim fora do último.
-- Perde apenas mensagem.reserva_item_id (a referência de exibição). Reverter também o schema.prisma.
-- Em base que não seja local/teste, exige autorização explícita do usuário.
-- REVERSAO-INICIO
-- BEGIN;
-- DO $$
-- DECLARE
--   nao_representaveis bigint;
-- BEGIN
--   SELECT count(*) INTO nao_representaveis
--     FROM (
--       SELECT i.reserva_id
--         FROM (
--           SELECT i.*, lag(i.fim) OVER w AS fim_anterior,
--                  row_number() OVER (PARTITION BY i.reserva_id ORDER BY i.ordem DESC) AS de_tras
--             FROM reserva_item i
--           WINDOW w AS (PARTITION BY i.reserva_id ORDER BY i.ordem)
--         ) i
--        GROUP BY i.reserva_id
--       HAVING count(DISTINCT i.profissional_id) > 1
--           OR count(DISTINCT i.status) > 1
--           OR count(DISTINCT i.encaixe) > 1
--           OR bool_or(i.fim_anterior IS NOT NULL AND i.inicio <> i.fim_anterior)
--           OR bool_or(i.de_tras > 1 AND i.ocupado_ate <> i.fim)
--     ) x;
--   IF nao_representaveis > 0 THEN
--     RAISE EXCEPTION USING
--       ERRCODE = 'check_violation',
--       MESSAGE = format('D-050: reversão abortada: %s reserva(s) não representável(is) no modelo antigo', nao_representaveis),
--       HINT = 'Itens precisam ser contíguos pela ordem, com o mesmo profissional, status e encaixe.';
--   END IF;
-- END
-- $$;
-- ALTER TABLE mensagem DROP CONSTRAINT mensagem_item_tipo_chk;
-- ALTER TABLE mensagem DROP CONSTRAINT mensagem_salao_id_reserva_id_reserva_item_id_fkey;
-- ALTER TABLE mensagem DROP COLUMN reserva_item_id;
-- ALTER TABLE reserva
--   ADD COLUMN profissional_id uuid,
--   ADD COLUMN ocupado_ate timestamptz(6),
--   ADD COLUMN encaixe boolean NOT NULL DEFAULT false;
-- UPDATE reserva r
--    SET profissional_id = x.profissional_id, inicio = x.inicio, fim = x.fim,
--        ocupado_ate = x.ocupado_ate, encaixe = x.encaixe
--   FROM (
--     SELECT DISTINCT ON (i.reserva_id) i.reserva_id,
--            first_value(i.profissional_id) OVER w AS profissional_id,
--            first_value(i.inicio) OVER w AS inicio,
--            last_value(i.fim) OVER w AS fim,
--            last_value(i.ocupado_ate) OVER w AS ocupado_ate,
--            first_value(i.encaixe) OVER w AS encaixe
--       FROM reserva_item i
--     WINDOW w AS (PARTITION BY i.reserva_id ORDER BY i.ordem ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
--      ORDER BY i.reserva_id
--   ) x
--  WHERE x.reserva_id = r.id;
-- ALTER TABLE reserva
--   ALTER COLUMN profissional_id SET NOT NULL,
--   ALTER COLUMN ocupado_ate SET NOT NULL;
-- ALTER TABLE reserva DROP CONSTRAINT reserva_ordem_chk;
-- ALTER TABLE reserva ADD CONSTRAINT reserva_ordem_chk CHECK (fim > inicio AND ocupado_ate >= fim);
-- ALTER TABLE reserva ADD CONSTRAINT reserva_salao_id_profissional_id_fkey FOREIGN KEY (salao_id, profissional_id)
--   REFERENCES profissional (salao_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
-- CREATE INDEX reserva_salao_id_profissional_id_inicio_idx ON reserva (salao_id, profissional_id, inicio);
-- ALTER TABLE reserva
--   ADD CONSTRAINT reserva_sem_sobreposicao
--   EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, ocupado_ate, '[)') WITH &&)
--   WHERE (status IN ('confirmado', 'concluido', 'nao_compareceu'));
-- ALTER TABLE reserva_item
--   DROP CONSTRAINT reserva_item_mesma_reserva_sem_sobreposicao,
--   DROP CONSTRAINT reserva_item_sem_sobreposicao,
--   DROP CONSTRAINT reserva_item_ordem_chk,
--   DROP CONSTRAINT reserva_item_fim_chk,
--   DROP CONSTRAINT reserva_item_duracao_teto_chk,
--   DROP CONSTRAINT reserva_item_revisao_chk,
--   DROP CONSTRAINT reserva_item_salao_id_profissional_id_fkey;
-- DROP INDEX reserva_item_salao_id_reserva_id_id_key;
-- DROP INDEX reserva_item_salao_id_reserva_id_servico_id_key;
-- DROP INDEX reserva_item_salao_id_profissional_id_inicio_idx;
-- DROP INDEX reserva_item_salao_id_inicio_idx;
-- ALTER TABLE reserva_item
--   DROP COLUMN profissional_id,
--   DROP COLUMN inicio,
--   DROP COLUMN fim,
--   DROP COLUMN ocupado_ate,
--   DROP COLUMN status,
--   DROP COLUMN encaixe,
--   DROP COLUMN revisao,
--   DROP COLUMN atualizado_em;
-- DELETE FROM _prisma_migrations WHERE migration_name = '20261127000000_reserva_item_autonomo';
-- COMMIT;
-- REVERSAO-FIM

-- 0. Guarda (antes de qualquer DDL).
DO $$
DECLARE
  sem_itens bigint;
  fim_inconsistente bigint;
  servico_repetido bigint;
  item_longo bigint;
BEGIN
  SELECT count(*) INTO sem_itens
    FROM reserva r
   WHERE NOT EXISTS (SELECT 1 FROM reserva_item i WHERE i.salao_id = r.salao_id AND i.reserva_id = r.id);

  SELECT count(*) INTO fim_inconsistente
    FROM reserva r
    JOIN (SELECT salao_id, reserva_id, sum(duracao_min) AS soma
            FROM reserva_item GROUP BY salao_id, reserva_id) s
      ON s.salao_id = r.salao_id AND s.reserva_id = r.id
   WHERE r.fim <> r.inicio + make_interval(mins => s.soma::int);

  SELECT count(DISTINCT reserva_id) INTO servico_repetido
    FROM (SELECT reserva_id FROM reserva_item GROUP BY salao_id, reserva_id, servico_id HAVING count(*) > 1) d;

  SELECT count(*) INTO item_longo FROM reserva_item WHERE duracao_min > 1440;

  IF sem_itens + fim_inconsistente + servico_repetido + item_longo > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'D-050: migração abortada sem alterar nada: %s reserva(s) sem itens, %s com fim <> inicio + soma das durações, '
        '%s com serviço repetido, %s item(ns) com mais de 1440 min',
        sem_itens, fim_inconsistente, servico_repetido, item_longo),
      HINT = 'Corrija os dados, rode prisma migrate resolve --rolled-back 20261127000000_reserva_item_autonomo e aplique de novo.';
  END IF;
END
$$;

-- 1. Colunas novas do item (nulas até a cópia).
ALTER TABLE "reserva_item"
  ADD COLUMN "profissional_id" UUID,
  ADD COLUMN "inicio" TIMESTAMPTZ(6),
  ADD COLUMN "fim" TIMESTAMPTZ(6),
  ADD COLUMN "ocupado_ate" TIMESTAMPTZ(6),
  ADD COLUMN "status" "status_reserva",
  ADD COLUMN "encaixe" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "revisao" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2. Cópia (RN-39). `antes` = soma das durações dos itens anteriores pela ordem.
UPDATE "reserva_item" i
   SET "profissional_id" = x.profissional_id,
       "inicio" = x.inicio_item,
       "fim" = x.inicio_item + make_interval(mins => i.duracao_min),
       "ocupado_ate" = CASE WHEN x.ultimo THEN x.ocupado_ate_reserva
                            ELSE x.inicio_item + make_interval(mins => i.duracao_min) END,
       "status" = x.status,
       "encaixe" = x.encaixe,
       "revisao" = x.revisao
  FROM (
    SELECT i2.id, r.profissional_id, r.status, r.encaixe, r.revisao, r.ocupado_ate AS ocupado_ate_reserva,
           r.inicio + make_interval(mins => (sum(i2.duracao_min) OVER w - i2.duracao_min)::int) AS inicio_item,
           row_number() OVER (PARTITION BY i2.reserva_id ORDER BY i2.ordem DESC) = 1 AS ultimo
      FROM reserva_item i2
      JOIN reserva r ON r.salao_id = i2.salao_id AND r.id = i2.reserva_id
    WINDOW w AS (PARTITION BY i2.reserva_id ORDER BY i2.ordem ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  ) x
 WHERE x.id = i.id;

-- 3. Restrições do item.
ALTER TABLE "reserva_item"
  ALTER COLUMN "profissional_id" SET NOT NULL,
  ALTER COLUMN "inicio" SET NOT NULL,
  ALTER COLUMN "fim" SET NOT NULL,
  ALTER COLUMN "ocupado_ate" SET NOT NULL,
  ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE "reserva_item" ADD CONSTRAINT "reserva_item_salao_id_profissional_id_fkey"
  FOREIGN KEY ("salao_id", "profissional_id") REFERENCES "profissional"("salao_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Alvo da FK de mensagem (item da MESMA reserva) e RN-2 (serviço único por reserva, inclusive cancelados).
CREATE UNIQUE INDEX "reserva_item_salao_id_reserva_id_id_key" ON "reserva_item"("salao_id", "reserva_id", "id");
CREATE UNIQUE INDEX "reserva_item_salao_id_reserva_id_servico_id_key" ON "reserva_item"("salao_id", "reserva_id", "servico_id");
-- Agenda (D-028 sobre itens): com e sem filtro de profissional.
CREATE INDEX "reserva_item_salao_id_profissional_id_inicio_idx" ON "reserva_item"("salao_id", "profissional_id", "inicio");
CREATE INDEX "reserva_item_salao_id_inicio_idx" ON "reserva_item"("salao_id", "inicio");

ALTER TABLE reserva_item
  ADD CONSTRAINT reserva_item_ordem_chk CHECK (fim > inicio AND ocupado_ate >= fim);
-- Minutos são exatos em timestamptz (sem dia de calendário): seguro com qualquer TimeZone de sessão e no DST.
ALTER TABLE reserva_item
  ADD CONSTRAINT reserva_item_fim_chk CHECK (fim = inicio + make_interval(mins => duracao_min));
-- Teto de 1 dia: torna exata a margem `i.inicio >= de - interval '1 day'` da agenda (a aplicação limita a 720).
ALTER TABLE reserva_item
  ADD CONSTRAINT reserva_item_duracao_teto_chk CHECK (duracao_min <= 1440);
ALTER TABLE reserva_item
  ADD CONSTRAINT reserva_item_revisao_chk CHECK (revisao >= 0);

-- Anti-sobreposição por profissional (RN-15), inclusive encaixes. Criada ANTES da exclusion da mesma reserva:
-- num conflito que viole as duas (mesmo profissional), é esta que dispara (índices verificados em ordem de OID).
ALTER TABLE reserva_item
  ADD CONSTRAINT reserva_item_sem_sobreposicao
  EXCLUDE USING gist (
    profissional_id WITH =,
    tstzrange(inicio, ocupado_ate, '[)') WITH &&
  )
  WHERE (status IN ('confirmado', 'concluido', 'nao_compareceu'));

-- RN-8: itens não cancelados da mesma reserva não se cruzam em [inicio, fim) (sem o intervalo).
ALTER TABLE reserva_item
  ADD CONSTRAINT reserva_item_mesma_reserva_sem_sobreposicao
  EXCLUDE USING gist (
    reserva_id WITH =,
    tstzrange(inicio, fim, '[)') WITH &&
  )
  WHERE (status IN ('confirmado', 'concluido', 'nao_compareceu'));

-- 4. Referência opcional da mensagem ao item (MATCH SIMPLE: nula não é conferida).
ALTER TABLE "mensagem" ADD COLUMN "reserva_item_id" UUID;
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_salao_id_reserva_id_reserva_item_id_fkey"
  FOREIGN KEY ("salao_id", "reserva_id", "reserva_item_id") REFERENCES "reserva_item"("salao_id", "reserva_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE mensagem
  ADD CONSTRAINT mensagem_item_tipo_chk CHECK (reserva_item_id IS NULL OR tipo IN ('remarcacao', 'cancelamento'));

-- 5. Remoções em reserva (status, inicio, fim, revisao e cancelada_em ficam).
ALTER TABLE reserva DROP CONSTRAINT reserva_sem_sobreposicao;
ALTER TABLE reserva DROP CONSTRAINT reserva_ordem_chk;
ALTER TABLE reserva DROP CONSTRAINT "reserva_salao_id_profissional_id_fkey";
DROP INDEX "reserva_salao_id_profissional_id_inicio_idx";
ALTER TABLE "reserva"
  DROP COLUMN "profissional_id",
  DROP COLUMN "ocupado_ate",
  DROP COLUMN "encaixe";
ALTER TABLE reserva ADD CONSTRAINT reserva_ordem_chk CHECK (fim > inicio);
