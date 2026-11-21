# D-036 T-3: página inicial (dev)
Arquivos: `src/app/page.tsx`, `src/app/page.module.css` (só tokens), `src/app/page.test.tsx`, `e2e/landing.spec.ts`. `smoke.spec` não mudou (h1 e título "Agenda Beleza" seguem valendo).
Preço e dias vêm de `plano.ts` (via `formatarMoeda`), links por `ROTAS`. Textos próprios; sem "Trinks".
Testes: unit `page.test.tsx` 4/4 (CA-9, 12, 13 + teste estático sem literal 79/30). E2E `landing.spec.ts` (CA-10 teclado, CA-11 375 px sem rolagem + axe).
Gates: lint, typecheck e unit OK; `npm run build` OK.
Pendência: E2E NÃO rodado, porta 3000 ocupada por outro `next-server` (pid 1199407); o líder deve rodar `npx playwright test e2e/landing.spec.ts e2e/smoke.spec.ts`.
