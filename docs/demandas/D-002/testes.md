# D-002 — Relatório de testes (tester)

## Rodada 1 — 2026-11-18

### Ambiente
- Branch `feat/d-002-scaffolding` (base `c55aaaa`), entrega não commitada (T-1, T-2, T-3).
- Node v24.21.0, npm 11.19.0, Chromium do Playwright 1255 (já instalado na máquina). Sem banco (não se aplica).
- **Clone limpo simulado:** cópia de `git ls-files -co --exclude-standard` (rastreados + não rastreados não ignorados, sem `node_modules`, `.next`, `coverage` etc.) para um diretório temporário **com espaço e acento** (`.../scratchpad/clone ção`). Todos os gates rodaram ali. Lint, typecheck e cobertura também foram repetidos no repositório.
- Os arquivos descartáveis (CA-3, CA-6, CA-9, CA-10) foram criados só na cópia e apagados. `git status --porcelain -uall` do repositório idêntico antes e depois (`diff` vazio).

### Gates (executados pelo tester)
| Comando | Resultado |
|---|---|
| `npm ci` | exit 0, 423 pacotes, sem `--legacy-peer-deps`/`--force` |
| `npm run lint` | exit 0 (`--max-warnings=0`) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (Next 16.4.6, Turbopack; `/` estática) |
| `npm test` | exit 0, 3 arquivos, 6 testes |
| `npm run test:unit` | exit 0, 3 arquivos, 6 testes |
| `npm run test:integration` | exit 0, "No test files found, exiting with code 0" |
| `npm run test:coverage` | exit 0, **Lines 100% (4/4)**, Statements 100%, Functions 100% |
| `npm run test:e2e` | exit 0, 1 passed (`[mobile-chromium] e2e/smoke.spec.ts`) |
| `npx vitest run src/lib/site.test.ts -t "define a marca"` | exit 0, 1 passed, 1 skipped |
| `npx playwright test e2e/smoke.spec.ts -g "viewport móvel"` | exit 0, 1 passed |

Cobertura por arquivo (`coverage/coverage-summary.json`): `src/app/layout.tsx` 2/2, `src/app/page.tsx` 1/1, `src/lib/site.ts` 1/1. Layout e page aparecem no relatório e não estão excluídos.

### Critérios de aceitação
| CA | Estado | Evidência |
|---|---|---|
| CA-1 | PASSOU | `npm ci` e `npm run build` exit 0 no clone limpo com caminho com espaço e acento. |
| CA-2 | PASSOU | lint e typecheck exit 0, sem avisos. |
| CA-3 | PASSOU | Arquivo descartável `src/lib/tmp-sem-teste.ts` (40 funções, sem teste). `npm run test:coverage` exit **1**; o arquivo aparece com 0% (`1-40` descobertas); saída: `ERROR: Coverage for lines (9.09%) does not meet global threshold (90%)`. Sem o arquivo: exit 0. |
| CA-4 | PASSOU | `npm run test:e2e` exit 0; o teste verifica `viewportSize() == {375, 812}`, o h1 "Agenda Beleza", `lang="pt-BR"` e o título. Config: Chromium, `isMobile`, `hasTouch`, `webServer` = `npm run start`. |
| CA-5 | PASSOU | O bloco "Comandos e cobertura" do `CLAUDE.md` lista instalar (incl. `npx playwright install chromium`), dev, build, start, lint, typecheck, teste, teste único (Vitest e Playwright), cobertura e E2E, com pré-requisitos; migrações como "a partir de E0.2/E0.4". Todos os comandos executáveis rodaram com exit 0 como escritos (o `dev` não foi exercitado de forma interativa; o `build`/`start` que ele compartilha passou). |
| CA-6 | PASSOU | Descartáveis: `src/lib/tmp-integ.ts` + `tests/integration/tmp-ca6.test.ts` (importa via `@/lib/tmp-integ`). `npx vitest run --coverage --reporter=verbose`: `✓ \|integration\| tests/integration/tmp-ca6.test.ts` junto com os `\|unit\|`, um só relatório, `tmp-integ.ts` 2/2 linhas cobertas, total Lines 100% (6/6). |
| CA-7 | PASSOU | `src/app/page.test.tsx` (docblock jsdom) usa `render` + `getByRole('heading', {level: 1, name: 'Agenda Beleza'})`; `page.tsx` 1/1 no relatório único. |
| CA-8 | PASSOU | Lines 100% ≥ 90%; layout/page no relatório. `coverage.exclude` tem só `src/**/*.test.{ts,tsx}` e `src/**/*.d.ts`, cada um com comentário de justificativa (RN-2). |
| CA-9 | PASSOU | `npx vitest list`: só os 6 testes de `src/**`. `npx playwright test --list`: só `smoke.spec.ts`. Negativo descartável: `e2e/tmp.test.ts` não foi coletado pelo Vitest (0 ocorrências) e `src/lib/tmp.spec.ts` não foi coletado pelo Playwright (`testDir: 'e2e'`, `testMatch: '**/*.spec.ts'`). |
| CA-10 | PASSOU | `src/lib/site.test.ts` assere `typeof window === 'undefined'` e `typeof document === 'undefined'` (node). Descartável `*.test.tsx` com docblock: `typeof window === 'object'` passou (jsdom). Todos os `*.test.tsx` do repositório (2) começam com `/** @vitest-environment jsdom */`. |

Itens extras pedidos:
- `package.json` sem `^`/`~` (`grep -nE '"[~^]'` sem resultado); `.npmrc` com `save-exact=true`; `vitest` e `@vitest/coverage-v8` ambos 5.1.1.
- `.nvmrc` = `24`; `engines` = `>=24.15.0 <25` (mais restrito que o exemplo do RN-10, justificado no `design.md` §1 pelo `engines` do jsdom 31; coerente).
- Testes com asserções reais: os 6 testes verificam valores concretos (tipo do elemento, `lang`, filhos, texto, metadata, ambiente). Nenhum teste só executa linhas.
- `.gitignore` cobre `node_modules`, `.next`, `next-env.d.ts`, `*.tsbuildinfo`, `coverage`, `playwright-report`, `test-results`; ESLint ignora os mesmos artefatos.

### Invariantes de regressão
Não se aplicam (sem domínio, dados, autenticação ou integrações nesta demanda), conforme `spec.md` §6.

### Defeitos
Nenhum defeito crítico, alto ou médio.

Observações (não bloqueiam; severidade baixa, sem CA violado):
- **OBS-1 (baixa) — ambiente jsdom depende de convenção.** Um `*.test.tsx` sem o docblock roda em `node`: o descartável `src/lib/tmp-env2.test.tsx` com `expect(typeof window).toBe('object')` falhou com `expected 'undefined' to be 'object'`. Decisão consciente do `design.md` (Vitest 5 sem `environmentMatchGlobs`; RN-7 aceita o docblock) e a falha é ruidosa. Sugestão futura: uma regra de lint ou um teste de guarda que exija o docblock.
- **OBS-2 (baixa) — `passWithNoTests` na raiz.** Vale também para o projeto `unit` (registrado como R-2 no `dev.md`/`design.md`). Rever quando o `smoke-db` de E0.3 existir.
- **OBS-3 (baixa) — `npm audit`: 18 vulnerabilidades altas só em devDependencies** (`picomatch` ReDoS via `tinyglobby`/`vite`/`vitest`/`@typescript-eslint`); `npm audit --omit=dev`: 0. A correção sugerida rebaixaria o Vitest para 3.1.4 (quebra). Acompanhar em E0.3 (CI).

### Veredito
**APROVADO.** Todos os CAs (CA-1 a CA-10 e CA-1 a CA-7 da issue) passaram, todos os gates passaram, cobertura de linhas 100% (≥ 90%), sem defeito crítico ou alto em aberto.
