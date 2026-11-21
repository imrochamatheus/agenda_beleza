# D-023 — Parecer do DBA (T-1): consentimento por finalidade

Entradas: `design.md` (§4, T-1), `docs/demandas/D-021/dba.md`, migração `20261118000000_init`.
**Veredito: aprovado.** Migração `prisma/migrations/20261121100000_consentimento_finalidade/migration.sql` (cabeçalho com impacto e reversão).

## 1. Impacto e compatibilidade
- Aditiva. `ADD COLUMN … DEFAULT` constante não reescreve a tabela (PG 11+); ACCESS EXCLUSIVE breve em `consentimento`, sem consumidor em produção.
- Base limpa: `migrate deploy` aplica; `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` = "No difference detected".
- Base com linha legada (inserida antes da migração, origem `publico`, versão `v1`): fica com `finalidade = 'mensagens_reserva'` (verificado por SQL).
- Risco aceito: o CHECK de versão é validado sobre as linhas existentes; uma linha legada com versão fora da regex faria a migração falhar (não há linhas assim; nenhum código gravava o termo).

## 2. Decisões
1. **Índice antigo:** removido (`consentimento_salao_id_cliente_id_idx`). O prefixo `(salao_id, cliente_id)` de `consentimento_vigente_idx` cobre a verificação da FK composta ao apagar/alterar `cliente` e qualquer consulta por cliente. Manter os dois dobraria o custo de escrita sem ganho.
2. **CHECK de `versao_termos`:** `^[a-z0-9._-]{1,40}$` (`consentimento_versao_termos_chk`); cobre "não vazia", tamanho e a forma da D-5.
3. **Gatilho de imutabilidade:** não incluído. Não é CA, e a anonimização (E5.2) e fábricas de teste podem precisar mexer. Custo se adotado: o padrão `auditoria_somente_insercao_*` (BEFORE UPDATE/DELETE por linha e BEFORE TRUNCATE); o harness recria bases a partir do template sem TRUNCATE/DELETE, então não quebraria, mas testes que limpam por DELETE sim. Pode vir em migração própria.
4. **Ordem:** `CREATE TYPE` → `ADD COLUMN … NOT NULL DEFAULT 'mensagens_reserva'` → `DROP DEFAULT` → CHECKs → `DROP INDEX` antigo → `CREATE INDEX` novo. Tudo na mesma transação.
5. **`consentimento_origem_finalidade_chk`:** `finalidade = 'mensagens_reserva' OR origem = 'publico'` (equipe só registra mensagens da reserva).
6. **`reserva_id`:** depois (R-5), aditiva e anulável na E3.2 se necessária.
7. **Índice de vigente:** `(salao_id, cliente_id, finalidade, criado_em DESC, id DESC)`; o `ORDER BY … LIMIT 1` da A-9 percorre o índice sem sort. Tabela ainda vazia, então o EXPLAIN real fica para a T-5 com volume.

## 3. Reversão
Passos manuais no cabeçalho da migração (índice, CHECKs, coluna, tipo). Perde linhas de finalidades novas.

## 4. Testes ajustados (posse do DBA)
- `tests/integration/db/isolamento-salao.test.ts`: o INSERT do CA-9 informa `finalidade`; continua esperando 23503.
- `tests/integration/db/drift.test.ts`: enum `finalidade_consentimento`, os dois CHECKs e a lista de migrações.
- `tests/integration/harness/template.test.ts`: lista de migrações.
- Resultado: `npx vitest run --project integration tests/integration/db tests/integration/harness` = 328 passando; eslint limpo nos dois diretórios.
- Sugerido para a T-5 (`banco.test.ts`): `22P02` com finalidade inválida; `23514` com origem `equipe` + `convite_avaliacao` e com versão `''`/`V1`/41 caracteres; `23502` sem finalidade.

## 5. Orientações ao desenvolvedor
- `schema.prisma`: `finalidade FinalidadeConsentimento` sem `@default`; SQL sempre informa `finalidade` (e o cast `::finalidade_consentimento`). Cliente Prisma regenerado (`npm run db:generate`).
- Violação de CHECK (23514) é erro de programação: a aplicação valida antes (RangeError).
- Sem UNIQUE: nenhum 23505 a tratar.
