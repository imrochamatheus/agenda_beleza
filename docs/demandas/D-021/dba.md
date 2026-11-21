# D-021 — Parecer do DBA (T-0): fotos do salão

Entradas: `docs/demandas/D-021/design.md` (§3.4, §3.5, §4 e a transferência), `docs/demandas/D-020/dba.md`, `prisma/schema.prisma`, migrações anteriores, `tests/integration/db/*`.

**Veredito: aprovado.** Tabela `salao_foto`, interface do §4 mantida (nomes, tipos, delegate Prisma `salaoFoto`). Quatro diferenças em relação ao §4, nenhuma muda código de aplicação:

1. `schema.prisma` declara `@@unique([salaoId, posicao], map: "salao_foto_posicao_unica")`. Sem isso o `migrate diff --exit-code` vê a constraint do SQL bruto como "índice único sobrando" e propõe removê-la (verificado). A parte 1 gerada cria um índice único comum com esse nome; a parte 2 o troca (`DROP INDEX` + `ADD CONSTRAINT … DEFERRABLE INITIALLY DEFERRED`), em tabela vazia. O Prisma não enxerga o diferimento: **nunca usar `upsert`/`ON CONFLICT` em (salao_id, posicao)** (o delegate gerado oferece `salaoId_posicao`; o desenho usa SQL bruto, então não há uso).
2. `bytes`: só `> 0` (decisão da pendência 2). Teto 5 MiB recusado: a saída WebP não tem garantia de ser menor que a entrada, e o banco nunca deve ser mais estrito que a aplicação.
3. `salao_foto_alt_chk` usa `btrim` padrão (só espaço U+0020, não `\n`/tab). A aplicação deve aparar (`normalizarNome`/equivalente) antes de gravar; o banco só pega a sobra mais comum.
4. Prisma gera `criado_em DEFAULT CURRENT_TIMESTAMP` (equivale a `now()`).

## 1. Impacto e compatibilidade

- Migração `prisma/migrations/20261121000000_salao_foto/migration.sql` (parte 1 por `prisma migrate diff`, sem edição; parte 2 SQL bruto). Cabeçalho com impacto e reversão.
- Aditiva: tabela nova e vazia; nada existente muda. Única trava em tabela existente: o `ADD FOREIGN KEY` toma `SHARE ROW EXCLUSIVE` em `salao` por milissegundos. Nenhum escritor atual de `salao` é afetado.
- Base limpa: `migrate deploy` aplica as 6 migrações; `migrate diff --exit-code` devolve "No difference detected". Base com dados: testada com 5.000 salões e 60.000 fotos inseridos depois (a migração roda antes de qualquer foto; não há dado legado a migrar).

## 2. Respostas às pendências

1. **Unicidade de posição:** `UNIQUE (salao_id, posicao) DEFERRABLE INITIALLY DEFERRED` aprovada. A troca (um `UPDATE … CASE`) e a compactação (`posicao - 1` em N linhas) passam; testado. Sem o diferimento, o `UPDATE posicao - 1` falharia conforme a ordem física das linhas. Consequência para o desenvolvedor: **o 23505 de posição aparece no COMMIT**, não no comando; uma sequência fora de ordem (ex. `posicao - 1` sem o `DELETE` antes) falha no commit (testado). `ON CONFLICT` do desenho não usa essa constraint (usa `(salao_id, envio)`, que é única comum).
2. **CHECKs:** todos aprovados, nomes `salao_foto_*_chk`: `posicao` 1..12; largura/altura 1..1600; `bytes > 0`; `alt` 1..150 code points e sem espaço nas pontas; `chave ~ '^fotos/[A-Za-z0-9_-]{22,}\.webp$'` (recusa `..`, outro prefixo e outra extensão). O limite de 12 por salão continua sendo a trava; `posicao <= 12` impede a 13ª linha mesmo sem ela (testado). `alt`: `char_length` (code points) ≤ `String#length`, o banco nunca é mais estrito.
3. **Índices (EXPLAIN, 5.000 salões × 12 fotos):** nenhum índice extra.
   - `listar` e contagem/`MAX(posicao)` por salão: `Bitmap Index Scan on salao_foto_posicao_unica` (salao_id), 6 buffers de índice, 12 linhas, sort em memória de 25 kB.
   - Troca/leitura de vizinho (`salao_id AND posicao = n`): `Index Scan using salao_foto_posicao_unica`, 7 buffers.
   - `prechecar` por token: `Index Only Scan using salao_foto_salao_id_envio_key`, 6 buffers, 0 heap fetches.
   - `buscarChaveDaFoto` por id: `Index Scan using salao_foto_pkey`, 5 buffers.
   - Busca por chave: `Index Only Scan using salao_foto_chave_key`.
   - Compactação (`posicao > p`): `Bitmap Index Scan on salao_foto_posicao_unica` com `salao_id = $1 AND posicao > p`.
   - A checagem da FK ao apagar salão usa o mesmo índice por `salao_id`.
4. **DELETE + UPDATE `posicao - 1` na mesma transação:** commit sem 23505 (testado). Inserções concorrentes em salões diferentes não se bloqueiam (testado). Duas inserções da mesma posição no mesmo salão: a segunda falha no COMMIT com 23505 `salao_foto_posicao_unica`, sem impasse (testado); na aplicação isso nem ocorre, pois a trava `salao FOR NO KEY UPDATE` serializa.
5. **Ciclo de espera:** ordem `salao (FOR NO KEY UPDATE)` → `salao_foto`. O INSERT em `salao_foto` toma `FOR KEY SHARE` em `salao`, compatível com `FOR NO KEY UPDATE` de qualquer transação (testado com `lock_timeout`: com T1 segurando a trava, T2 insere foto sem esperar e a segunda trava `FOR NO KEY UPDATE` espera, 55P03). `salao_foto` não tem FK para outra tabela além de `salao`, logo nenhuma trava volta de `salao_foto` para `salao`/`profissional`/`servico`. Sem ciclo.
6. **Testes:** `tests/integration/db/salao-foto.test.ts` (novo, 10 casos): cada CHECK aceita e recusa; 12 posições aceitas e a 13ª recusada; chave única entre salões; `(salao_id, envio)` único por salão e repetível em outro; posição repetida só falha no COMMIT; FK RESTRICT (apagar salão com fotos e foto de salão inexistente); troca, compactação e a falha do `posicao - 1` sem `DELETE`; travas.
7. **Cabeçalho e reversão:** no cabeçalho da migração (padrão D-007/D-020).

## 3. Reversão

Manual (não há "migrate down"): `DROP TABLE IF EXISTS salao_foto; DELETE FROM _prisma_migrations WHERE migration_name = '20261121000000_salao_foto';` e reverter `schema.prisma`. Apaga as fotos cadastradas; os arquivos no armazenamento viram órfãos e precisam de limpeza à parte. Fora de base local/teste exige autorização explícita do usuário.

## 4. Ajustes em testes fora da posse (autorizados)

- `tests/integration/harness/template.test.ts`: `MIGRACOES` ganhou `20261121000000_salao_foto`.
- `tests/integration/db/drift.test.ts`: tabela `salao_foto`, 5 CHECKs em `CONSTRAINTS_SQL_BRUTO`, caso novo da constraint adiada (`condeferrable`/`condeferred`), FKs 38 → 39, lista de migrações; título "31 tabelas" generalizado (estava defasado).

## 5. Orientações ao desenvolvedor

- Tratar 23505 por `constraint`: `salao_foto_salao_id_envio_key` = envio duplicado (idempotência, CA-13); `salao_foto_chave_key` = colisão de chave (gerar outra); `salao_foto_posicao_unica` só no COMMIT e indica quebra da trava (bug), não fluxo normal.
- Toda mudança de lista sob `salao … FOR NO KEY UPDATE` (nunca `FOR UPDATE`, que bloquearia a FK).
- A ordem `DELETE … RETURNING posicao` → `UPDATE posicao - 1 WHERE posicao > $p` na mesma transação é obrigatória.
- Aparar `alt` antes de gravar (ver diferença 3). Não guardar o nome do arquivo original.
- Prisma Client: `npm run db:generate` já feito; o modelo é `salaoFoto`, mas o desenho usa SQL bruto nos repositórios.
