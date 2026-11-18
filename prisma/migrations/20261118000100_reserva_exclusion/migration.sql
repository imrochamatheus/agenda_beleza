-- D-004 (E0.4) — Anti-sobreposição de reservas. SQL bruto: o Prisma não expressa EXCLUDE nem CHECK.
-- Escrita à mão; congelada depois do merge (mudanças futuras = migração nova, revisada pelo DBA).
-- Contrato de nomes com a aplicação (E3.2 traduz 23P01 pelo nome) e com os testes (CA-1):
--   reserva_sem_sobreposicao (EXCLUDE, SQLSTATE 23P01) e reserva_ordem_chk (CHECK, SQLSTATE 23514).
--
-- Regras:
-- - Ocupação = tstzrange(inicio, ocupado_ate, '[)'), com ocupado_ate = fim + intervalo vigente
--   (snapshot gravado pela aplicação). Intervalo semiaberto: reservas adjacentes não conflitam.
-- - Só os status que ocupam horário entram no predicado. 'cancelado' libera o horário.
--   PROIBIDO renomear valores de status_reserva: o predicado usa os nomes literais. Mudar a lista
--   exige DROP + ADD desta constraint (varredura completa sob ACCESS EXCLUSIVE).
-- - Vale para INSERT e UPDATE, inclusive encaixes da equipe (não há exceção por origem).
-- - O índice GiST criado pela constraint também atende a consulta de ocupação de E3.1/E3.2, desde
--   que ela repita exatamente a expressão e o predicado acima.
--
-- Impacto: tabela reserva recém-criada e vazia (primeira versão); sem lock relevante.
--
-- Reversão (manual; não há "migrate down" no Prisma). A extensão NÃO é removida, porque
-- jornada_sem_sobreposicao e bloqueio_periodo_idx (20261118000200_restricoes_sql) dependem dela.
-- Reverter primeiro a 20261118000200_restricoes_sql, se ela estiver aplicada.
--   ALTER TABLE reserva DROP CONSTRAINT IF EXISTS reserva_sem_sobreposicao;
--   ALTER TABLE reserva DROP CONSTRAINT IF EXISTS reserva_ordem_chk;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261118000100_reserva_exclusion';

-- btree_gist: operador "=" de uuid dentro de um índice GiST. Extensão trusted (PG >= 13).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reserva
  ADD CONSTRAINT reserva_ordem_chk
  CHECK (fim > inicio AND ocupado_ate >= fim);

ALTER TABLE reserva
  ADD CONSTRAINT reserva_sem_sobreposicao
  EXCLUDE USING gist (
    profissional_id WITH =,
    tstzrange(inicio, ocupado_ate, '[)') WITH &&
  )
  WHERE (status IN ('confirmado', 'concluido', 'nao_compareceu'));
