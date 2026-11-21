# D-034 (E1.5) — Parecer do DBA

## 1. Impacto
Migração aditiva `prisma/migrations/20261123000000_totp_ultimo_passo/migration.sql`: `usuario.totp_ultimo_passo BIGINT NULL` (sem DEFAULT: só catálogo, sem reescrita) e dois CHECKs. ACCESS EXCLUSIVE breve em `usuario` (tabela pequena). Banco limpo e com seed: aplicada pelo harness (testes de integração passam, 345/345 nos arquivos de esquema/harness).

## 2. CHECKs
- `usuario_totp_ativado_chk`: `totp_ativado_em IS NULL OR totp_segredo_cifrado IS NOT NULL` (pendente permitido).
- `usuario_totp_passo_chk`: `totp_ultimo_passo IS NULL OR >= 0`.
- CHECK de formato `^v1:` NÃO criado: a fábrica `criarSuperAdmin` (tests/support/auth.ts) grava `'segredo-cifrado-ficticio'` e quebraria; o formato é garantido pela aplicação (`cifra.ts`). Se o dev quiser o CHECK, deve antes trocar a fábrica por um valor `v1:...` e eu o acrescento em migração nova.

## 3. Schema existente
`sessao` já tem `revogada_em`, `totp_verificado_em`, `ultimo_uso_em` e índice `sessao_usuario_id_idx`: nenhum índice novo é necessário para revogar a pré-sessão (`WHERE usuario_id = $1 AND revogada_em IS NULL`: poucas linhas por usuário). `schema.prisma` ganhou `totpUltimoPasso BigInt?` (`BigInt` no cliente: o dev deve usar `bigint`/converter ao ler).

## 4. Travas do UPDATE de anti-replay
`UPDATE usuario SET totp_ultimo_passo=$p WHERE id=$u AND (totp_ultimo_passo IS NULL OR totp_ultimo_passo < $p)` por PK: lock de linha (FOR NO KEY UPDATE implícito) em READ COMMITTED; o concorrente espera o commit, reavalia o predicado e obtém 0 linhas (replay) — comprovado em esquema.test.ts. Não bloqueia FKs (`sessao` usa FOR KEY SHARE). Ordem sugerida: `usuario` (UPDATE) → `sessao` (insert/revoga) → `auditoria`; nunca `salao`. EXPLAIN dispensado (PK, 1 linha).

## 5. Reversão
`ALTER TABLE usuario DROP CONSTRAINT usuario_totp_ativado_chk, DROP CONSTRAINT usuario_totp_passo_chk, DROP COLUMN totp_ultimo_passo;` (perde só o anti-replay).

## 6. Orientações ao desenvolvedor
Checar `rowCount === 0` como replay (`invalido`). `cadastrarTotp` grava segredo pendente antes de `totp_ativado_em`; nunca ativar sem segredo (23514 `usuario_totp_ativado_chk`). Fábrica de teste continua válida. Testes: `tests/integration/auth/admin/esquema.test.ts`; contratos atualizados em `db/drift.test.ts` e `harness/template.test.ts`.
