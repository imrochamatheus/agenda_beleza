# D-036 — DevOps (T-4)
- `package.json`: `build:node` ganhou `prisma/seed.ts` -> `dist/prisma/seed.js` e `e2e/suporte/preparar-banco.ts` -> `dist/e2e/preparar-banco.js` (segunda/terceira chamada esbuild); `db:seed`; `test:e2e` = next build + build:node + preparar-banco + playwright.
- `e2e/suporte/ambiente.ts` (puro): URL `<base>_e2e` (de `E2E_DATABASE_URL` ou `TEST_DATABASE_URL`), `.armazenamento-e2e`, env do servidor (adaptadores simulados, `PROTECAO_*`=100000, segredos públicos de E2E). `playwright.config.ts`: retries 0, `reuseExistingServer:false`, carrega `.env`.
- Stubs inofensivos: `prisma/seed.ts` e `e2e/suporte/preparar-banco.ts` (o desenvolvedor implementa).
- CI job `e2e`: service postgres:17 + `TEST_DATABASE_URL`; `.gitignore` com `.armazenamento-e2e/`. Sem ferramenta nova.
- Pendente: README/CLAUDE.md (T-6); `npx playwright test` isolado exige a base preparada; seed no `docker/smoke.sh` opcional, ainda não feito.
