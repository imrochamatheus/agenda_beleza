# D-039 (E1.4) — Parecer do DBA

1. Impacto: aditiva. Migração `prisma/migrations/20261125000000_convite_pendente_unico/migration.sql`: saneamento + `CREATE UNIQUE INDEX convite_pendente_por_profissional_uniq ON convite (profissional_id) WHERE aceito_em IS NULL AND invalidado_em IS NULL`. SHARE lock em `convite` durante a construção (ms na v1), sem reescrita.
2. Base com dados: sem saneamento o índice falharia se houvesse 2+ pendentes por profissional. O SQL invalida (`invalidado_em = now()`) os pendentes mais antigos, mantendo o mais recente (`criado_em, id`); em base limpa afeta 0 linhas. Sem `ON CONFLICT` na aplicação: violação = 23505 = erro de ordem de travas, nunca capturar.
3. Semântica: vencido não invalidado AINDA é pendente para o índice (confirmado com o design R-5): `convidar` invalida antes de inserir; desativar já invalida; a edição de e-mail também.
4. Travas: ordem do design (`salao` → `profissional` → `convite` → `usuario` → `rate_limit_janela`); o índice não adiciona trava de linha; o `FOR NO KEY UPDATE` do profissional serializa os envios.
5. Prisma: `schema.prisma` só ganhou comentário no `Convite`; índice parcial não expresso (como os outros `*_uniq`), sem drift. Testes: `tests/integration/auth/convite-esquema.test.ts`, `drift.test.ts` e `template.test.ts` (verdes).
6. Reversão: `DROP INDEX "convite_pendente_por_profissional_uniq";` (o saneamento não é desfeito). Sem EXPLAIN necessário (índice de garantia; as leituras usam `convite_salao_id_profissional_id_idx`).
