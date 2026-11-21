-- D-021 (E2.7) — Fotos do salão (tabela salao_foto).
-- Parecer e contrato de nomes: docs/demandas/D-021/dba.md. Congelada depois do merge
-- (mudanças futuras = migração nova, revisada pelo DBA).
--
-- Parte 1 (até "Parte 2"): gerada por
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- sobre uma base com as migrações anteriores aplicadas, e NÃO editada.
-- Parte 2: SQL bruto (unicidade adiada de posição e CHECKs), que o Prisma não expressa nem compara.
-- Os nomes são contrato (drift.test.ts e salao-foto.test.ts).
--
-- Regras:
-- - Uma linha por foto; posições 1..n sem repetição, no máximo 12 por salão. O limite de 12 é a trava
--   salao FOR NO KEY UPDATE da aplicação (contagem entre linhas não cabe em CHECK); posicao <= 12 é defesa extra.
-- - salao_foto_posicao_unica é DEFERRABLE INITIALLY DEFERRED: a troca de vizinhas (um UPDATE ... CASE) e a
--   compactação (posicao = posicao - 1 em N linhas) passam por estados intermediários repetidos; a
--   verificação ao commit os tolera. Efeito: 23505 de posição só aparece no COMMIT. ON CONFLICT não pode
--   usar essa constraint (a aplicação não usa). O índice dela atende WHERE salao_id / ORDER BY posicao.
-- - O schema.prisma declara @@unique([salaoId, posicao], map: "salao_foto_posicao_unica") só para o
--   `migrate diff` não tratar a constraint como índice sobrando; a parte 1 então cria um índice único comum
--   com esse nome, e a parte 2 o troca pela constraint adiada (tabela vazia; sem efeito em dados).
-- - chave (única, gerada pelo servidor) e (salao_id, envio) (token de envio idempotente) são UNIQUE da parte 1.
-- - Nenhuma coluna guarda o nome do arquivo original. FK RESTRICT/RESTRICT (padrão do esquema).
--
-- Impacto: tabela nova e vazia; nenhum dado nem objeto existente muda. A única trava em tabela existente é
-- o ACCESS EXCLUSIVE breve do ADD FOREIGN KEY em salao (SHARE ROW EXCLUSIVE; milissegundos, sem varredura
-- relevante da tabela nova vazia). Depois, os INSERT em salao_foto tomam FOR KEY SHARE em salao, compatível
-- com FOR NO KEY UPDATE. Tudo numa transação implícita: falha em qualquer comando desfaz a migração.
--
-- Reversão (manual; não há "migrate down" no Prisma). Apaga todas as fotos cadastradas (os arquivos no
-- armazenamento ficam órfãos e precisam ser removidos à parte); em base que não seja local/teste, exige
-- autorização explícita do usuário. Reverter também o schema.prisma.
--   DROP TABLE IF EXISTS salao_foto;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261121000000_salao_foto';

-- CreateTable
CREATE TABLE "salao_foto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "chave" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "posicao" INTEGER NOT NULL,
    "largura" INTEGER NOT NULL,
    "altura" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "envio" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salao_foto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salao_foto_chave_key" ON "salao_foto"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "salao_foto_salao_id_envio_key" ON "salao_foto"("salao_id", "envio");

-- CreateIndex
CREATE UNIQUE INDEX "salao_foto_posicao_unica" ON "salao_foto"("salao_id", "posicao");

-- AddForeignKey
ALTER TABLE "salao_foto" ADD CONSTRAINT "salao_foto_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Parte 2: SQL bruto (não expresso pelo Prisma).

DROP INDEX "salao_foto_posicao_unica";

ALTER TABLE "salao_foto"
  ADD CONSTRAINT "salao_foto_posicao_unica" UNIQUE ("salao_id", "posicao") DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT "salao_foto_posicao_chk" CHECK ("posicao" BETWEEN 1 AND 12),
  ADD CONSTRAINT "salao_foto_dimensoes_chk" CHECK ("largura" BETWEEN 1 AND 1600 AND "altura" BETWEEN 1 AND 1600),
  ADD CONSTRAINT "salao_foto_bytes_chk" CHECK ("bytes" > 0),
  ADD CONSTRAINT "salao_foto_alt_chk" CHECK (char_length("alt") BETWEEN 1 AND 150 AND "alt" = btrim("alt")),
  ADD CONSTRAINT "salao_foto_chave_chk" CHECK ("chave" ~ '^fotos/[A-Za-z0-9_-]{22,}\.webp$');
