# D-024 — Parecer do DBA (T-1): enum `convite_avaliacao`, índice de reconciliação e CHECK da revisão

**Veredito: aprovado.** Migrações: `prisma/migrations/20261121200000_tipo_mensagem_convite_avaliacao/` (A) e `prisma/migrations/20261121200100_mensagem_reconciliacao/` (B). Cabeçalhos com impacto e reversão.

## 1. Impacto e compatibilidade
- A: um único comando, `ALTER TYPE "tipo_mensagem" ADD VALUE IF NOT EXISTS 'convite_avaliacao'`. Instantânea, sem reescrita. Arquivo e timestamp separados de B; B não referencia o valor novo (só `estado_mensagem`).
- B: `CREATE INDEX` (SHARE em `mensagem` durante a construção; tabela pequena) e `ADD CONSTRAINT … CHECK (revisao >= 0)` (validado nas linhas existentes; nenhuma revisão é negativa).
- Verificado: `migrate deploy` em base limpa; incremental (base em `20261121100000` com um salão, depois as duas); template do harness; `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` = "No difference detected".

## 2. Decisões
1. **Índice único**, não dois: `mensagem_reconciliacao_idx ON mensagem (estado, atualizado_em) WHERE estado IN ('pendente','enviando')`. O EXPLAIN com literal `estado = 'pendente'` (ou `'enviando'`) usa o índice, sem Seq Scan nem Sort (ordem do índice, `LIMIT` direto). Dois parciais dobrariam a escrita sem ganho. O índice antigo `mensagem_pendentes_idx (estado, criado_em)` fica (serve E8.3/`falhou` por `criado_em`).
2. **Literais:** a consulta do repositório deve escrever `'pendente'`/`'enviando'` literais (nunca parâmetro), para o plano parcial valer; cast implícito do literal ao enum é o que o planejador implica.
3. **CHECK `mensagem_revisao_chk`** `revisao >= 0`. Sem CHECK novo em `destinatario_e164`: já existe `mensagem_destinatario_e164_chk` (E.164 BR; NULL passa, serve à anonimização), na migração `20261118000200`.
4. **Sem** coluna, estado ou índice extra: a listagem por reserva usa `(salao_id, reserva_id)`; o `UNIQUE (reserva_id, tipo, revisao)` cobre a idempotência; a PK cobre `localizar(id)`; `UNIQUE (mensagem_id, numero)` cobre a tentativa.

## 3. Reversão
- B: `DROP INDEX "mensagem_reconciliacao_idx"; ALTER TABLE "mensagem" DROP CONSTRAINT "mensagem_revisao_chk";`
- A: enum não remove valor. Sem linha com o valor, recriar o tipo (passos no cabeçalho da migração A: renomear, criar, `ALTER COLUMN … USING tipo::text::tipo_mensagem`, apagar o antigo). Deixar o valor é inofensivo.

## 4. Consultas verificadas (CA-24)
Com 20 000 linhas (1% pendente, 1% enviando, resto enviada) e `ANALYZE`: `WHERE estado = 'pendente' AND atualizado_em < now() - interval '5 minutes' ORDER BY atualizado_em LIMIT 100` (idem `'enviando'`) resulta em Index Scan/Only no `mensagem_reconciliacao_idx`, sem Seq Scan nem Sort, também sem forçar `enable_seqscan=off`. Listagem por `(salao_id, reserva_id)` sem Seq Scan (forçado).

## 5. Testes
- Novo: `tests/integration/db/mensagem-reconciliacao.test.ts` (enum aceita `convite_avaliacao`, 23505 no duplicado, 22P02 em tipo desconhecido, 23514 `mensagem_revisao_chk`, EXPLAIN dos planos).
- Ajustados: `tests/integration/db/drift.test.ts` (enum com 4 valores, CHECK e índice novos, lista de migrações) e `tests/integration/harness/template.test.ts` (lista de migrações).
- Resultado: `npx vitest run --project integration tests/integration/db tests/integration/harness` = 335 passando.

## 6. Orientações ao desenvolvedor
- `schema.prisma` ganhou `convite_avaliacao` em `TipoMensagem`; cliente regenerado (`npm run db:generate`). Os índices parciais e o CHECK ficam só no SQL.
- Reconciliação: `… WHERE estado = 'pendente' AND atualizado_em < $1 ORDER BY atualizado_em LIMIT $2` (literal no estado; `FOR UPDATE SKIP LOCKED` é compatível). `atualizado_em` deve ser atualizado em toda transição de estado (o `@updatedAt` do Prisma não vale em SQL bruto: escreva `atualizado_em = $agora`).
- `23514 mensagem_revisao_chk` é erro de programação (revisão vem da reserva, nunca negativa). `23505` no `UNIQUE (reserva_id, tipo, revisao)` não deve chegar à aplicação: use `ON CONFLICT DO NOTHING`.
