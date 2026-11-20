-- D-020 (E2.6) — Perfil público e horário de funcionamento do salão.
-- Parecer e contrato de nomes: docs/demandas/D-020/dba.md. Congelada depois do merge
-- (mudanças futuras = migração nova, revisada pelo DBA).
--
-- Parte 1 (até "Parte 2"): gerada por
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- sobre uma base com as 4 migrações anteriores aplicadas, e NÃO editada.
-- Parte 2: SQL bruto (NOT NULL das listas, CHECKs e a exclusion do funcionamento), que o Prisma não
-- expressa nem compara no diff. Os nomes são contrato (drift.test.ts e testes de banco).
--
-- Regras:
-- - Perfil em colunas anuláveis de salao: vazio = NULL, nunca ''. Listas text[] NOT NULL DEFAULT '{}',
--   com chaves estáveis da aplicação e SEM CHECK de valores (lista nova = mudança de código).
-- - funcionamento_definido = false ⇒ nenhuma linha em salao_funcionamento: garantido pela aplicação
--   (única via de escrita, sob SELECT … FROM salao … FOR NO KEY UPDATE) e neutralizado na leitura pelo
--   predicado "AND s.funcionamento_definido" do fragmento COLUNAS_FUNCIONAMENTO. Sem trigger.
-- - salao_funcionamento espelha jornada: minutos de parede no salao.fuso, [inicio, fim) com
--   0 <= inicio < fim <= 1440, sem sobreposição por (salão, dia). FK RESTRICT/RESTRICT.
--
-- Impacto: ADD COLUMN com default constante (NULL, '{}', false) não reescreve salao (PG >= 11).
-- SET NOT NULL e os 14 CHECKs de salao varrem a tabela uma vez sob ACCESS EXCLUSIVE, sem reescrita
-- (uma linha por salão; milissegundos). Tudo numa transação implícita: falha em qualquer comando
-- desfaz a migração inteira. A tabela nova nasce vazia. Nenhum dado existente muda: salões legados
-- ficam com perfil vazio e funcionamento "não informado".
--
-- Reversão (manual; não há "migrate down" no Prisma). Só sem dados que importem (apaga o perfil e o
-- funcionamento de todos os salões); em base que não seja local/teste, exige autorização explícita do
-- usuário. Reverter também o schema.prisma. btree_gist NÃO é removida (D-004 depende dela).
--   DROP TABLE IF EXISTS salao_funcionamento;
--   ALTER TABLE salao
--     DROP CONSTRAINT IF EXISTS salao_meios_pagamento_chk,
--     DROP CONSTRAINT IF EXISTS salao_comodidades_chk,
--     DROP CONSTRAINT IF EXISTS salao_descricao_chk,
--     DROP CONSTRAINT IF EXISTS salao_endereco_logradouro_chk,
--     DROP CONSTRAINT IF EXISTS salao_endereco_numero_chk,
--     DROP CONSTRAINT IF EXISTS salao_endereco_complemento_chk,
--     DROP CONSTRAINT IF EXISTS salao_endereco_bairro_chk,
--     DROP CONSTRAINT IF EXISTS salao_endereco_cidade_chk,
--     DROP CONSTRAINT IF EXISTS salao_endereco_uf_chk,
--     DROP CONSTRAINT IF EXISTS salao_endereco_cep_chk,
--     DROP CONSTRAINT IF EXISTS salao_endereco_completo_chk,
--     DROP CONSTRAINT IF EXISTS salao_telefone_e164_chk,
--     DROP CONSTRAINT IF EXISTS salao_whatsapp_e164_chk,
--     DROP CONSTRAINT IF EXISTS salao_instagram_chk,
--     DROP COLUMN IF EXISTS descricao,
--     DROP COLUMN IF EXISTS endereco_logradouro,
--     DROP COLUMN IF EXISTS endereco_numero,
--     DROP COLUMN IF EXISTS endereco_complemento,
--     DROP COLUMN IF EXISTS endereco_bairro,
--     DROP COLUMN IF EXISTS endereco_cidade,
--     DROP COLUMN IF EXISTS endereco_uf,
--     DROP COLUMN IF EXISTS endereco_cep,
--     DROP COLUMN IF EXISTS telefone_e164,
--     DROP COLUMN IF EXISTS whatsapp_e164,
--     DROP COLUMN IF EXISTS instagram,
--     DROP COLUMN IF EXISTS meios_pagamento,
--     DROP COLUMN IF EXISTS comodidades,
--     DROP COLUMN IF EXISTS funcionamento_definido;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261120000000_perfil_funcionamento';

-- ===========================================================================
-- Parte 1: gerada pelo prisma migrate diff (não editar)
-- ===========================================================================
-- AlterTable
ALTER TABLE "salao" ADD COLUMN     "comodidades" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "descricao" TEXT,
ADD COLUMN     "endereco_bairro" TEXT,
ADD COLUMN     "endereco_cep" TEXT,
ADD COLUMN     "endereco_cidade" TEXT,
ADD COLUMN     "endereco_complemento" TEXT,
ADD COLUMN     "endereco_logradouro" TEXT,
ADD COLUMN     "endereco_numero" TEXT,
ADD COLUMN     "endereco_uf" TEXT,
ADD COLUMN     "funcionamento_definido" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "meios_pagamento" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "telefone_e164" TEXT,
ADD COLUMN     "whatsapp_e164" TEXT;

-- CreateTable
CREATE TABLE "salao_funcionamento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salao_id" UUID NOT NULL,
    "dia_semana" SMALLINT NOT NULL,
    "inicio_min" INTEGER NOT NULL,
    "fim_min" INTEGER NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salao_funcionamento_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "salao_funcionamento" ADD CONSTRAINT "salao_funcionamento_salao_id_fkey" FOREIGN KEY ("salao_id") REFERENCES "salao"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ===========================================================================
-- Parte 2: SQL bruto (revisado pelo DBA)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- Listas do perfil: NOT NULL (o Prisma cria text[] anulável e não compara a nulidade de listas no
-- diff), sem elemento NULL e no máximo 20 itens. Valores SEM CHECK (D-8 da spec).
-- ---------------------------------------------------------------------------
ALTER TABLE salao
  ALTER COLUMN meios_pagamento SET NOT NULL,
  ALTER COLUMN comodidades SET NOT NULL;

ALTER TABLE salao
  ADD CONSTRAINT salao_meios_pagamento_chk
  CHECK (array_position(meios_pagamento, NULL) IS NULL AND cardinality(meios_pagamento) <= 20);

ALTER TABLE salao
  ADD CONSTRAINT salao_comodidades_chk
  CHECK (array_position(comodidades, NULL) IS NULL AND cardinality(comodidades) <= 20);

-- ---------------------------------------------------------------------------
-- Textos do perfil: NULL ou forma normalizada (nunca '', sem espaço nas pontas, sem controle).
-- Limites em char_length (code points), iguais aos da aplicação, que conta unidades UTF-16 e é
-- portanto igual ou mais estrita. Controle = \p{Cc} (U+0001–U+001F, U+007F–U+009F; U+0000 não
-- existe em text). A descrição aceita só \n entre os controles (o \t vira espaço na aplicação).
-- ---------------------------------------------------------------------------
ALTER TABLE salao
  ADD CONSTRAINT salao_descricao_chk
  CHECK (char_length(descricao) BETWEEN 1 AND 1000
         AND descricao = btrim(descricao, E' \n')
         AND descricao !~ '[\x01-\x09\x0B-\x1F\x7F-\x9F]');

ALTER TABLE salao
  ADD CONSTRAINT salao_endereco_logradouro_chk
  CHECK (char_length(endereco_logradouro) BETWEEN 1 AND 120
         AND endereco_logradouro = btrim(endereco_logradouro)
         AND endereco_logradouro !~ '[\x01-\x1F\x7F-\x9F]');

ALTER TABLE salao
  ADD CONSTRAINT salao_endereco_numero_chk
  CHECK (char_length(endereco_numero) BETWEEN 1 AND 10
         AND endereco_numero = btrim(endereco_numero)
         AND endereco_numero !~ '[\x01-\x1F\x7F-\x9F]');

ALTER TABLE salao
  ADD CONSTRAINT salao_endereco_complemento_chk
  CHECK (char_length(endereco_complemento) BETWEEN 1 AND 60
         AND endereco_complemento = btrim(endereco_complemento)
         AND endereco_complemento !~ '[\x01-\x1F\x7F-\x9F]');

ALTER TABLE salao
  ADD CONSTRAINT salao_endereco_bairro_chk
  CHECK (char_length(endereco_bairro) BETWEEN 1 AND 80
         AND endereco_bairro = btrim(endereco_bairro)
         AND endereco_bairro !~ '[\x01-\x1F\x7F-\x9F]');

ALTER TABLE salao
  ADD CONSTRAINT salao_endereco_cidade_chk
  CHECK (char_length(endereco_cidade) BETWEEN 1 AND 80
         AND endereco_cidade = btrim(endereco_cidade)
         AND endereco_cidade !~ '[\x01-\x1F\x7F-\x9F]');

ALTER TABLE salao
  ADD CONSTRAINT salao_endereco_uf_chk
  CHECK (endereco_uf IN ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
                         'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'));

ALTER TABLE salao
  ADD CONSTRAINT salao_endereco_cep_chk
  CHECK (endereco_cep ~ '^[0-9]{8}$' AND endereco_cep <> '00000000');

-- Endereço tudo ou nada (RN-6): os 6 obrigatórios juntos; complemento só com endereço.
ALTER TABLE salao
  ADD CONSTRAINT salao_endereco_completo_chk
  CHECK (num_nonnulls(endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf,
                      endereco_cep) IN (0, 6)
         AND (endereco_complemento IS NULL OR endereco_logradouro IS NOT NULL));

-- Mesma expressão de cliente_telefone_e164_chk (20261118000200_restricoes_sql).
ALTER TABLE salao
  ADD CONSTRAINT salao_telefone_e164_chk
  CHECK (telefone_e164 ~ '^\+55[1-9][0-9]{9,10}$');

ALTER TABLE salao
  ADD CONSTRAINT salao_whatsapp_e164_chk
  CHECK (whatsapp_e164 ~ '^\+55[1-9][0-9]{9,10}$');

-- Nome de usuário do Instagram (RN-8): 1 a 30 de [a-z0-9._], sem ponto nas pontas nem "..".
ALTER TABLE salao
  ADD CONSTRAINT salao_instagram_chk
  CHECK (instagram ~ '^[a-z0-9._]{1,30}$' AND instagram !~ '^\.|\.$|\.\.');

-- ---------------------------------------------------------------------------
-- Funcionamento (hora de parede do salao.fuso, minutos desde 00:00): o mesmo desenho da jornada.
-- int4range é [): intervalos contíguos não colidem. btree_gist já instalado (20261118000100).
-- O índice GiST da exclusion (salao_id, dia_semana, int4range) atende WHERE salao_id = $1 e a
-- verificação da FK: sem btree próprio (EXPLAIN no dba.md).
-- ---------------------------------------------------------------------------
ALTER TABLE salao_funcionamento
  ADD CONSTRAINT salao_funcionamento_dia_semana_chk
  CHECK (dia_semana BETWEEN 0 AND 6);

ALTER TABLE salao_funcionamento
  ADD CONSTRAINT salao_funcionamento_faixa_chk
  CHECK (0 <= inicio_min AND inicio_min < fim_min AND fim_min <= 1440);

ALTER TABLE salao_funcionamento
  ADD CONSTRAINT salao_funcionamento_sem_sobreposicao
  EXCLUDE USING gist (
    salao_id WITH =,
    dia_semana WITH =,
    int4range(inicio_min, fim_min) WITH &&
  );
