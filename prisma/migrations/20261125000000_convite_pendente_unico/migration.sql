-- D-039 (E1.4) — Um convite pendente por profissional. Parecer: docs/demandas/D-039/dba.md.
-- Congelada depois do merge (mudanças futuras = migração nova).
--
-- Pendente = aceito_em IS NULL AND invalidado_em IS NULL. Um convite vencido e não invalidado AINDA é pendente
-- para o índice: a aplicação sempre invalida os pendentes antes de inserir o novo (e o desativar já invalida).
--
-- Impacto: aditiva. Saneamento (UPDATE só nas linhas pendentes duplicadas; em base limpa afeta 0 linhas) e
-- CREATE UNIQUE INDEX (SHARE lock em "convite" durante a construção; ms no volume da v1; sem reescrita).
-- O índice parcial não é expresso pelo Prisma (como os demais *_uniq do SQL bruto): sem drift no schema.prisma.
-- Sem ON CONFLICT no código de aplicação para esta tabela: a violação seria 23505 em convite_pendente_por_profissional_uniq
-- (bug de ordem de travas; nunca capturar).
--
-- Reversão (manual; sem perda de dados): DROP INDEX "convite_pendente_por_profissional_uniq";
-- (o saneamento não é revertido: os convites duplicados ficam invalidados.)

-- Saneamento: mantém só o pendente mais recente por profissional; os mais antigos viram invalidados.
UPDATE "convite" c
   SET "invalidado_em" = now()
 WHERE c."aceito_em" IS NULL
   AND c."invalidado_em" IS NULL
   AND EXISTS (
     SELECT 1 FROM "convite" n
      WHERE n."profissional_id" = c."profissional_id"
        AND n."aceito_em" IS NULL
        AND n."invalidado_em" IS NULL
        AND (n."criado_em", n."id") > (c."criado_em", c."id")
   );

CREATE UNIQUE INDEX "convite_pendente_por_profissional_uniq"
  ON "convite" ("profissional_id")
  WHERE "aceito_em" IS NULL AND "invalidado_em" IS NULL;
