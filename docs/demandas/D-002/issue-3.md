## Objetivo
Ter o esqueleto do projeto com os comandos oficiais de desenvolvimento, qualidade e testes.

## Origem e contexto
PLAN.md, "Direção técnica" e "Testes"; CLAUDE.md, "Comandos e cobertura" (Vitest + `@vitest/coverage-v8`, `coverage.thresholds.lines = 90`, escopo `src/**`). Atual: inexistente; não há `package.json`.

## Escopo
- Projeto Next.js (App Router) com TypeScript estrito, ESLint (`lint` = `eslint .`) e script de typecheck.
- `.nvmrc` com Node 24, fonte única da versão para local, Docker e CI.
- Vitest com projetos `unit` e `integration` e cobertura v8; ambiente de teste de componente (`@testing-library/react` + `jsdom`) para `*.test.tsx`; `passWithNoTests` no projeto `integration`.
- Playwright só com Chromium, viewport 375×812 com `isMobile` e `hasTouch`, e `webServer` com `next start`.
- Atualização do bloco "Comandos e cobertura" do `CLAUDE.md` com os comandos reais.

## Fora do escopo
Docker e bootstrap do Prisma (E0.2), CI (E0.3), esquema de dados (E0.4).

## Especificação
Decidido:
- RN-1: `vitest.config.ts` com `coverage.provider = 'v8'`, `coverage.include = ['src/**']`, `coverage.thresholds.lines = 90`.
- RN-2: exclusões permitidas só para código gerado (cliente Prisma), arquivos só de tipos, configuração e migrações, cada uma com comentário justificando.
- RN-3: Playwright fora da métrica de cobertura.
- RN-4: gerenciador npm (`npm ci`); scripts mínimos `dev`, `build`, `lint`, `typecheck`, `test`, teste único, `test:coverage`, `test:e2e`.
- RN-5: `test:coverage` roda `unit` e `integration` numa única execução do Vitest, com um só relatório e um só limiar.
Arquivos prováveis: `package.json`, `.nvmrc`, `tsconfig.json`, `next.config.*`, `eslint.config.*`, `vitest.config.ts`, `playwright.config.ts`, `src/app/**`, `CLAUDE.md`.

## Critérios de aceite
- [ ] CA-1: Dado um clone limpo, quando se executa `npm ci` e depois o build, então ambos terminam com código 0.
- [ ] CA-2: Dado o projeto, quando se executam lint e typecheck, então ambos terminam com código 0.
- [ ] CA-3: Dado uma alteração descartável (não commitada) que reduz a cobertura global de linhas para menos de 90% (ex.: arquivo novo em `src/` sem teste), quando se executa `npm run test:coverage`, então ele termina com código diferente de 0 e informa o limiar de linhas.
- [ ] CA-4: Dado um teste E2E de fumaça, quando se executa o comando E2E, então o Playwright abre a página inicial no Chromium em 375×812 e o teste passa.
- [ ] CA-5: Dado o `CLAUDE.md`, quando se lê o bloco de comandos, então ele lista os comandos reais de instalar, dev, build, lint, typecheck, teste, teste único, cobertura e E2E.
- [ ] CA-6: Dado testes nos projetos `unit` e `integration`, quando se executa `npm run test:coverage`, então é gerado um único relatório de cobertura que soma os dois.
- [ ] CA-7: Dado um `*.test.tsx` que renderiza `src/app/page.tsx`, quando `npm run test:coverage` roda, então o teste passa e o arquivo aparece coberto no relatório único.

## Validação
Teste unitário de fumaça; verificação manual da falha do gate (CA-3) registrada pelo tester com a saída do comando. Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #2 (E0)
- Bloqueada por: nenhuma
- Bloqueia: #4 (E0.2), #10 (E0.8)

## Entregáveis
- package.json (npm, engines Node 24 LTS, scripts dev/build/lint/typecheck/test/test:unit/test:integration/test:coverage/test:e2e) e package-lock.json
- tsconfig.json estrito, next.config.ts (App Router), eslint.config.mjs
- vitest.config.ts com projetos unit e integration, coverage.provider v8, include src/**, thresholds.lines 90 e exclusões comentadas
- playwright.config.ts com projeto mobile Chromium 375x812 (isMobile, hasTouch) e webServer via next start
- src/app/page.tsx provisória, teste unitário de fumaça e e2e/smoke.spec.ts
- CLAUDE.md: bloco 'Comandos e cobertura' com os comandos reais
- .nvmrc (Node 24) como fonte única da versão para Docker e CI
- `@testing-library/react` + jsdom para *.test.tsx; projeto integration com passWithNoTests até existir teste de banco

## Papel responsável
- DevOps
- Apoio/revisão: Desenvolvedor, Arquiteto de software

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E0.1`. Prioridade P0, tamanho M (Project #3)._
<!-- agenda-beleza-backlog:E0.1 -->
