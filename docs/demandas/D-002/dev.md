# D-002 — Desenvolvimento (T-2: código provisório e testes)

Branch `feat/d-002-scaffolding`. Todos os comandos rodaram no caminho real `/home/cliente/Área de Trabalho/agenda_beleza`, com Node v24.21.0, em 2026-11-18. Não fiz commit nem push.

## 1. Tarefas concluídas e arquivos

T-2 concluída. Arquivos criados, todos sob minha posse:

| Arquivo | Conteúdo |
|---|---|
| `src/lib/site.ts` | `siteConfig` (`name: 'Agenda Beleza'`, `locale: 'pt-BR'`, `description`), `as const` |
| `src/lib/site.test.ts` | asserções do `siteConfig` e do ambiente `node` (CA-10) |
| `src/app/layout.tsx` | `RootLayout` síncrono `<html lang={siteConfig.locale}><body>…</body></html>` e `metadata` (título e descrição); sem import de CSS |
| `src/app/layout.test.tsx` | docblock `@vitest-environment jsdom`; chama `RootLayout` como função, sem renderizar `<html>` no DOM |
| `src/app/page.tsx` | componente síncrono com `<main>`, `<h1>Agenda Beleza</h1>` e um texto provisório em pt-BR; sem design system (fica para E0.8) |
| `src/app/page.test.tsx` | docblock `@vitest-environment jsdom`; `render(<Home />)` com RTL (CA-7) |
| `e2e/smoke.spec.ts` | fumaça móvel (CA-4) |
| `docs/demandas/D-002/dev.md` | este arquivo |

Não editei nenhum arquivo da T-1.

## 2. Comandos e resultados

| Comando | Exit | Saída resumida |
|---|---|---|
| `npm run lint` | 0 | sem erros nem avisos (`--max-warnings=0`). **A mensagem "Pages directory cannot be found" sumiu** depois que `src/app/` passou a existir. |
| `npm run typecheck` | 0 | sem erros |
| `npm run typecheck` sem `.next/`, `next-env.d.ts` e `tsconfig.tsbuildinfo` (movidos temporariamente) | 0 | sem erros, ou seja, não depende do `next build` (RN-12) |
| `npm run build` | 0 | Next 16.4.6 com Turbopack; rotas `/` e `/_not-found` estáticas. **O R-1 não ocorreu**: o build passa no caminho com acento, então não precisamos do `--webpack`. |
| `npm run build` (2ª vez) | 0 | md5 do `tsconfig.json` idêntico antes e depois (`034eb835…`): o arquivo está estável |
| `npm run test:coverage` | 0 | 3 arquivos e 6 testes passaram. **Lines 100% (4/4)**, Statements 100%, Functions 100%, Branches 100% (0/0) |
| `coverage/coverage-summary.json` | — | `src/app/layout.tsx` 100%, `src/app/page.tsx` 100%, `src/lib/site.ts` 100%: layout e page aparecem no relatório (CA-8) |
| `npx vitest list` | 0 | 6 testes, todos `[unit]` em `src/**`, nenhum de `e2e/` (CA-9) |
| `npm run test:e2e` | 0 | build seguido de `1 passed`: `[mobile-chromium] › e2e/smoke.spec.ts` |
| `npx playwright test --list` | 0 | só `smoke.spec.ts` (1 teste), nenhum `*.test.ts(x)` (CA-9) |

## 3. Testes e CAs

| Teste | O que verifica | CA |
|---|---|---|
| `src/lib/site.test.ts` › "define a marca…" | valores exatos de `name`, `locale` e `description` | RN-11 |
| `src/lib/site.test.ts` › "roda no ambiente node…" | `typeof window` e `typeof document` são `'undefined'` | CA-10 |
| `src/app/layout.test.tsx` › "declara <html lang=…>" | `type === 'html'`, `lang === 'pt-BR'`, filho `body` contendo exatamente o `children` recebido | RN-11, CA-8 |
| `src/app/layout.test.tsx` › "exporta título e descrição" | `metadata.title` e `metadata.description` | CA-8 |
| `src/app/page.test.tsx` › "mostra o título…" | `h1` acessível "Agenda Beleza" dentro de `<main>` (jsdom) | CA-7 |
| `src/app/page.test.tsx` › "mostra texto provisório" | parágrafo pt-BR presente | RN-11 |
| `e2e/smoke.spec.ts` | `viewportSize()` igual a `{375, 812}`, `h1` visível, `html[lang=pt-BR]`, `<title>` "Agenda Beleza" | CA-4 |

Os testes de componente usam só as asserções nativas do Vitest e o DOM, porque o `@testing-library/jest-dom` não faz parte das dependências do desenho.

## 4. Riscos e desvios

- **Desvio R-2 (aplicado pelo devops na T-1):** o `passWithNoTests: true` fica na raiz de `test` do `vitest.config.ts`, e não no projeto `integration`, porque o Vitest 5.1.1 não aceita a opção por projeto. Efeito: `npm run test:integration` termina com código 0 sem testes, como pede o RN-6.
- **`tsconfig.json` reescrito pelo `next build`:** o build acrescentou `.next/dev/types/**/*.ts` ao `include` e expandiu os arrays para várias linhas. O arquivo é da T-1, então pedi ao devops que o revisasse. **Resolvido:** o devops assumiu a versão estabilizada (md5 `034eb835…`, que não muda num novo build).
- **Aviso do Vite no Vitest** ("ESM syntax in a file loaded as CommonJS"): **resolvido** pelo devops, que acrescentou `"type": "module"` ao `package.json`.
- **Nova rodada depois dos ajustes do devops:** `npm run lint`, `typecheck`, `test:coverage` (Lines 100%, 4/4, sem o aviso do Vite) e `test:e2e` (1 passed) terminaram todos com exit 0.
- **R-1:** não se manifestou.
- **R-3 (npm audit, devDependencies):** sem mudança e fora do escopo da T-2.
- Nenhum TODO pendente.
