# D-002 — Desenho: scaffolding Next.js + TypeScript + ESLint + Vitest (coverage-v8) + Playwright

Entrada: `docs/demandas/D-002/spec.md` (CA-1..CA-10, RN-1..RN-13, S-1..S-9). Branch `feat/d-002-scaffolding`. Ambiente verificado: Node v24.21.0, npm 11.19.0.

## 1. Resumo da solução

Os arquivos do projeto são escritos à mão, com versões **exatas** e um `package-lock.json` versionado. O ESLint fica na **9.39.5**, e não na 10, e o TypeScript na **6.0.3**, e não na 7 (ver 1.1). A cobertura é medida numa única execução do Vitest, com os projetos inline `unit` e `integration`. Os testes `*.test.tsx` declaram `jsdom` pelo docblock `@vitest-environment`. O `test:e2e` faz o build antes de rodar o Playwright, e o `webServer` só executa `next start`.

### 1.1 Versões fixadas (resolução validada em 2026-11-18)

A resolução foi validada com `npm install --package-lock-only` num diretório descartável: terminou com código 0, sem `--legacy-peer-deps` e sem nenhum aviso `ERESOLVE`.

| Pacote | Versão | Seção | Observação |
|---|---|---|---|
| next | 16.4.6 | dependencies | engines node `>=20.9.0` |
| react / react-dom | 19.3.1 / 19.3.1 | dependencies | peer do next `^19` |
| typescript | 6.0.3 | devDependencies | `typescript-eslint` 8.73.0 exige `<6.1.0`, o que exclui a 7.0.2 |
| @types/node | 24.19.2 | devDependencies | alinhado ao Node 24; peer do vitest `^22 \|\| >=24` |
| @types/react / @types/react-dom | 19.3.0 / 19.3.0 | devDependencies | |
| eslint | 9.39.5 | devDependencies | ver nota abaixo |
| eslint-config-next | 16.4.6 | devDependencies | traz o typescript-eslint 8.73.0 (resolvido) |
| vitest / @vitest/coverage-v8 | 5.1.1 / 5.1.1 | devDependencies | mesma versão (peer exato); traz o vite 8.3.8 |
| @vitejs/plugin-react | 6.3.0 | devDependencies | peer `vite ^8`; os peers opcionais (oxc, babel, compiler) não são instalados |
| jsdom | 31.0.1 | devDependencies | engines `^24.15.0` (ver `engines` abaixo) |
| @testing-library/react / @testing-library/dom | 16.3.3 / 10.4.2 | devDependencies | o dom é peer obrigatório do RTL 16 |
| @playwright/test | 1.65.1 | devDependencies | peer opcional do next `^1.51.1` |

**Por que não o ESLint 10:** o `eslint-config-next` 16.4.6 depende de `eslint-plugin-react` 7.37.5 (peer `eslint ^9.7`), `eslint-plugin-import` 2.32.0 (`^9`) e `eslint-plugin-jsx-a11y` 6.10.2 (`^9`). Nenhum deles aceita a 10, e essas já são as versões mais recentes. Com o ESLint 10.15.0, o npm emite `ERESOLVE overriding peer dependency` (verificado), ou seja, os peers ficam violados e há risco de quebra em tempo de execução. O `peer eslint >=9` do `eslint-config-next` engana: os plugins internos é que limitam.

**Engines:** `"node": ">=24.15.0 <25"`. O jsdom 31 exige `^24.15.0`, então `>=24 <25` aceitaria versões em que o jsdom não roda. O `.nvmrc` contém `24` (resolve para a 24.x mais recente), o que é coerente com o RN-10.

**Fixação exata:** `.npmrc` com `save-exact=true`, para que as próximas demandas não introduzam `^`. Não usamos `engine-strict` (S-5).

### 1.2 Decisões pedidas pelo líder

| Tema | Decisão | Motivo |
|---|---|---|
| Ambiente node/jsdom | Um projeto `unit` com `environment: 'node'`. Todo `*.test.tsx` começa com o docblock `/** @vitest-environment jsdom */`. | O Vitest 4+ removeu o `environmentMatchGlobs`. Um subprojeto separado obrigaria `--project unit` a deixar de rodar todos os testes unitários (S-4). O docblock é um mecanismo aceito pelo RN-7, e esquecê-lo falha na hora (`document is not defined`), então o erro não passa em silêncio. O tester verifica, para cada `*.test.tsx`, que o docblock está presente. |
| Build antes do E2E | `test:e2e` = `next build && playwright test`. O `webServer.command` é só `npm run start`. | O CA-4 e o CA-5 passam num clone limpo sem pré-requisito oculto. Na CI (E0.3), quando o build já tiver rodado, use `npx playwright test` direto para não compilar duas vezes. |
| Arquivos sem teste | `coverage.include: ['src/**/*.{ts,tsx}']`, sem `coverage.all`. | No Vitest 4+ (e na 5.1.1), quando `include` está definido, os arquivos não importados entram com 0%, e a opção `all` não existe mais. O tester confirma com o arquivo descartável do CA-3. |
| Caminho com espaço e acento | Só caminhos relativos nos scripts npm. Nas configurações, usar `fileURLToPath(new URL('./src', import.meta.url))`, nunca `new URL(...).pathname`, que deixaria o caminho em `%20`/`%C3%81`. Nenhum script usa `$(pwd)` ou interpolação sem aspas. | Todo o fluxo (`build`, `vitest`, `playwright`) roda no caminho real `/home/cliente/Área de Trabalho/agenda_beleza` como critério de conclusão. |

### 1.3 Alternativas descartadas

- **`create-next-app`:** instalaria `latest` (TypeScript 7, ESLint 10), com prompts e extras (Tailwind, CSS), e geraria um lock incompatível. Escrever à mão dá controle exato das versões.
- **Subprojetos `unit` + `unit-dom`:** quebram a semântica de `--project unit` (S-4).
- **`environment: 'jsdom'` para todo o `unit`:** viola o RN-7 e o CA-10.
- **E2E com build documentado como pré-requisito:** aceitável pelo S-9, mas mais frágil no clone limpo.
- **`npm audit fix --force`:** rebaixaria o vitest para a 3.x. Ver o risco R-3.
- **`vite-tsconfig-paths`:** é uma dependência a mais. Um `resolve.alias` com `@` resolve o caso.

## 2. Componentes afetados (todos novos, exceto `CLAUDE.md`)

| Caminho | Conteúdo |
|---|---|
| `package.json` | `"private": true`, `engines`, scripts (seção 3), dependências da tabela 1.1 |
| `package-lock.json` | gerado por `npm install` com o `.npmrc` abaixo |
| `.npmrc` | `save-exact=true` |
| `.nvmrc` | `24` |
| `.gitignore` | `node_modules/`, `.next/`, `out/`, `coverage/`, `playwright-report/`, `test-results/`, `blob-report/`, `playwright/.cache/`, `next-env.d.ts`, `*.tsbuildinfo`, `.env`, `.env*.local`, `npm-debug.log*` (o `.env.example` de E0.2 continua versionável) |
| `tsconfig.json` | ver a seção 3.3 |
| `next.config.ts` | `const nextConfig: NextConfig = {}` (App Router é o padrão) |
| `eslint.config.mjs` | ver a seção 3.4 |
| `vitest.config.ts` | ver a seção 3.2 |
| `vitest.setup.ts` | `afterEach(cleanup)` do `@testing-library/react`. Fica na raiz, fora de `src/`, então fora da métrica. |
| `playwright.config.ts` | ver a seção 3.5 |
| `src/lib/site.ts` | `export const siteConfig = { name: 'Agenda Beleza', locale: 'pt-BR', description: '…' } as const` |
| `src/lib/site.test.ts` | asserções sobre o `siteConfig` e `expect(typeof window).toBe('undefined')` (CA-10) |
| `src/app/layout.tsx` | `RootLayout` síncrono: `<html lang={siteConfig.locale}><body>{children}</body></html>`, mais `export const metadata` (título e descrição). Sem import de CSS nesta demanda. |
| `src/app/layout.test.tsx` | docblock jsdom. Chama `RootLayout({ children: <p>x</p> })` **como função** e verifica `type === 'html'`, `props.lang === 'pt-BR'` e o `body` com os filhos. Também confere o `metadata.title`. Não renderiza `<html>` no DOM, o que evita o aviso de aninhamento sem suprimir erros. |
| `src/app/page.tsx` | componente **síncrono**: `<main><h1>{siteConfig.name}</h1><p>texto pt-BR provisório</p></main>` |
| `src/app/page.test.tsx` | docblock jsdom. Faz `render(<Home />)` e `getByRole('heading', { level: 1, name: 'Agenda Beleza' })` (CA-7). |
| `tests/integration/.gitkeep` | marca o diretório do projeto `integration` (nenhum teste commitado, S-3) |
| `e2e/smoke.spec.ts` | `goto('/')`, título `h1` "Agenda Beleza" visível, `page.viewportSize()` igual a `{ width: 375, height: 812 }` (CA-4) |
| `CLAUDE.md` | "Project status" (S-8) e o bloco "Comandos e cobertura" (RN-9) |

## 3. Interfaces e configuração

### 3.1 Scripts (`package.json`)
```
"dev": "next dev",
"build": "next build",
"start": "next start",
"lint": "eslint . --max-warnings=0",
"typecheck": "tsc --noEmit",
"test": "vitest run",
"test:unit": "vitest run --project unit",
"test:integration": "vitest run --project integration",
"test:coverage": "vitest run --coverage",
"test:e2e": "next build && playwright test"
```
`--max-warnings=0` atende ao "sem avisos pendentes" do CA-2: sem ele, os avisos se acumulariam sem quebrar o gate. Teste único: `npx vitest run <caminho> -t "<nome>"` e `npx playwright test <caminho> -g "<nome>"`.

### 3.2 `vitest.config.ts` (contrato)
- `plugins: [react()]` e `resolve.alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }`.
- Nível raiz `test`: `setupFiles: ['./vitest.setup.ts']` e `coverage`:
  - `provider: 'v8'`, `include: ['src/**/*.{ts,tsx}']`.
  - `exclude`, cada entrada com comentário: `'src/**/*.test.{ts,tsx}'` (os próprios testes, não são código de produção) e `'src/**/*.d.ts'` (arquivos só de tipos). Não pode haver outras exclusões. `src/app/**` não é excluído.
  - `thresholds: { lines: 90 }`.
  - `reporter: ['text', 'html', 'lcov', 'json-summary']`, `reportsDirectory: 'coverage'` (pronto para a publicação em E0.3).
- `projects` (inline, `extends: true` para herdar plugins, alias e setup):
  - `{ name: 'unit', environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] }`
  - `{ name: 'integration', environment: 'node', include: ['tests/integration/**/*.test.ts'], passWithNoTests: true }`. Se a 5.1.1 não aceitar `passWithNoTests` no nível do projeto, mova a opção para a raiz de `test` e registre a mudança no `dev.md`. O critério é que `npm run test:integration` termine com código 0 sem testes.
- Nada fora de `src/` e `tests/integration/` é coletado, então o `e2e/**` fica fora (CA-9 e RN-3).

### 3.3 `tsconfig.json`
`strict: true`, `noEmit: true`, `target: ES2022`, `lib: ["dom", "dom.iterable", "esnext"]`, `module: esnext`, `moduleResolution: bundler`, `jsx: react-jsx`, `isolatedModules`, `esModuleInterop`, `resolveJsonModule`, `skipLibCheck`, `allowJs: false`, `incremental`, `plugins: [{ "name": "next" }]` e `paths: { "@/*": ["./src/*"] }` (sem `baseUrl`, que está obsoleto no TS 6). `include`: `next-env.d.ts`, `**/*.ts`, `**/*.tsx`, `**/*.mts`, `.next/types/**/*.ts`. `exclude`: `node_modules`.
- O `typecheck` não pode depender de `next build` (RN-12). Sem o `next-env.d.ts`, o `tsc --noEmit` precisa passar num clone limpo, e por isso não há import de CSS nem de imagem nesta demanda. O TS 6 trata imports de efeito colateral sem tipos como erro.
- O `next build` pode reescrever o `tsconfig.json`. Rode o build uma vez e versione o resultado estabilizado. Critério: um `next build` posterior deixa o `git diff tsconfig.json` vazio.
- Se o TS 6 mudar o padrão de `types` e o typecheck reclamar de globais do Node, adicione `"types": ["node"]` e registre a mudança no `dev.md`.

### 3.4 `eslint.config.mjs`
`defineConfig([...nextVitals, ...nextTs, globalIgnores(['.next/**', 'out/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'blob-report/**', 'next-env.d.ts'])])`, com imports de `eslint/config`, `eslint-config-next/core-web-vitals` e `eslint-config-next/typescript`. O `node_modules` já é ignorado por padrão. As configurações `.ts` e `.mjs`, `src/`, `tests/` e `e2e/` são analisadas (RN-13).

### 3.5 `playwright.config.ts`
`testDir: 'e2e'`, `testMatch: '**/*.spec.ts'` (os `*.test.ts(x)` não são coletados, CA-9), `outputDir: 'test-results'`, `reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]`, `forbidOnly: !!process.env.CI`, `retries: process.env.CI ? 2 : 0`, `use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' }`.
Há um único projeto, `mobile-chromium`, com `use: { browserName: 'chromium', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }`.
`webServer: { command: 'npm run start', url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI, timeout: 120_000 }`.

## 4. Dados

Não se aplica: não há banco, Prisma, entidades nem migrações. **O DBA foi dispensado** porque a demanda não toca dados. O Prisma começa em E0.2 e o esquema em E0.4.

## 5. Infraestrutura

O DevOps é o responsável pela demanda (tarefas T-1 e T-3), então não há um acionamento separado. Não há variáveis de ambiente, containers nem CI nesta demanda. As decisões que E0.2 e E0.3 herdam:
- O `.nvmrc` é a fonte única da versão do Node (Dockerfile e `node-version-file`).
- O `npm ci` é a instalação oficial. `build` e `start` são usados pela imagem.
- Diretórios para publicar: `coverage/` (com `lcov` e `json-summary`), `playwright-report/` e `test-results/`.
- Na CI, o E2E roda `npx playwright install --with-deps chromium`, e o `npx playwright test` vai direto se o build já tiver rodado.
- Telemetria do Next (S-7): não é alterada no código. O `CLAUDE.md` cita `npx next telemetry disable` como opcional.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como |
|---|---|---|
| Escopo por salão no servidor | Não | Não há autenticação nem dados (E0.5+). |
| Exclusion constraint anti-sobreposição | Não | Não há banco (E0.4). |
| UTC + fuso do salão | Não | Não há lógica de data. Os testes não dependem do TZ da máquina. |
| Adaptadores de integração | Não | Não há integrações. |
| Soft delete / anonimização | Não | Não há entidades. |
| Salão suspenso somente leitura | Não | Não há assinatura. |
| Idempotência de webhooks/mensagens | Não | Não há fila nem webhooks. |
| Auditoria do super admin | Não | Não há super admin. |
| UI pt-BR | **Sim** | `<html lang="pt-BR">` e título "Agenda Beleza" (RN-11). A direção visual fica fora do escopo. |
| Fora da v1 | **Sim** | Nenhuma tela nem schema de funcionalidade. |
| Gate de cobertura ≥ 90% (CLAUDE.md) | **Sim** | Seção 3.2, com exclusões limitadas às categorias permitidas e comentadas. |

## 7. Riscos e decisões

- **R-1. Turbopack ou Next com caminho não ASCII:** o `next build` pode falhar com `Área de Trabalho`. Mitigação: o critério da T-1/T-2 é rodar no caminho real. Se falhar, usar `next build --webpack` nos scripts `build` e `test:e2e`, registrar no `dev.md` e avisar o líder.
- **R-2. `passWithNoTests` por projeto ou TS 6 com `types`:** ajustes previstos nas seções 3.2 e 3.3, registrados no `dev.md`.
- **R-3. `npm audit`: 18 avisos "high", todos em devDependencies transitivas** (picomatch ≤ 4.0.7, ReDoS, GHSA-fc5q-39xc-vjpf, via vite, vitest, typescript-eslint e eslint-config-next). Não existe versão corrigida: a 4.0.7 é a mais recente, e o `audit fix --force` rebaixaria o vitest. `npm audit --omit=dev` mostra 0 vulnerabilidades. Aceito: só afeta ferramentas locais, com globs controlados pelo projeto. Reavaliar em E0.3, quando a CI for criada.
- **R-4. Docblock jsdom esquecido:** o teste falha imediatamente. O tester confere todos os `*.test.tsx`.
- **R-5. `reuseExistingServer` local pode reaproveitar um `next dev` na porta 3000:** fica documentado no `CLAUDE.md` que é preciso liberar a porta 3000 antes do `test:e2e`. Na CI, a opção fica desligada.
- **D-1. TypeScript 6.0.3 e ESLint 9.39.5** em vez das versões `latest` (seção 1.1). Revisar quando o typescript-eslint aceitar o TS 7 e os plugins do eslint-config-next aceitarem o ESLint 10.

## 8. Estratégia de testes

| CA | Tipo | Como |
|---|---|---|
| CA-1 | Manual (tester) | Clone limpo no caminho real: `nvm use`, `npm ci`, `npm run build`, todos com código 0 |
| CA-2 | Manual | `npm run lint` e `npm run typecheck` com código 0 |
| CA-3 | Manual, descartável | Arquivo novo em `src/` sem teste: o comando termina com código ≠ 0, a saída menciona o limiar de linhas e o arquivo aparece com 0% |
| CA-4 | Playwright | `e2e/smoke.spec.ts` |
| CA-5 | Manual | Executar cada comando do `CLAUDE.md` como está escrito, num clone limpo |
| CA-6 | Manual, descartável | Teste em `tests/integration/` que importa um módulo descartável de `src/` não coberto pelo `unit`: os dois projetos aparecem na saída e há um único relatório (S-3) |
| CA-7 | Unitário (jsdom) | `src/app/page.test.tsx` |
| CA-8 | Unitário + manual | `layout.test.tsx`, `page.test.tsx` e `site.test.ts` cobrem 100% de `src/`; inspeção dos comentários do `exclude` |
| CA-9 | Manual | `npx vitest list` não mostra `e2e/`, e `npx playwright test --list` não mostra `*.test.ts(x)` |
| CA-10 | Unitário (node) | `src/lib/site.test.ts` |

Cobertura: os três arquivos de `src/` têm teste direto, então a cobertura esperada é de 100% de linhas. Integração com PostgreSQL real não se aplica (não há banco).

## 9. Tarefas

Execução sequencial: cada tarefa depende da anterior, e nenhuma roda em paralelo.

### T-1 — Toolchain e configurações (devops)
- **Dependências:** nenhuma.
- **Arquivos sob posse:** `package.json`, `package-lock.json`, `.npmrc`, `.nvmrc`, `.gitignore`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts`, `tests/integration/.gitkeep`.
- **Entregável:** as configurações das seções 1.1 e 3, com as versões exatas da tabela 1.1. Instalar com `npm install`, sem `--legacy-peer-deps` nem `--force`.
- **Critério de conclusão:** o `npm ci` termina com código 0 e sem `ERESOLVE` no caminho real; o `package.json` não tem nenhum `^`/`~`; `npm run test:integration` termina com código 0 sem testes.

### T-2 — Código provisório e testes (desenvolvedor)
- **Dependências:** T-1.
- **Arquivos sob posse:** `src/lib/site.ts`, `src/lib/site.test.ts`, `src/app/layout.tsx`, `src/app/layout.test.tsx`, `src/app/page.tsx`, `src/app/page.test.tsx`, `e2e/smoke.spec.ts`, `docs/demandas/D-002/dev.md`.
- **Entregável:** os arquivos da seção 2, com os docblocks jsdom nos `*.test.tsx` e componentes síncronos.
- **Critério de conclusão:** no caminho real, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:coverage` (cobertura de linhas ≥ 90%, com `layout.tsx` e `page.tsx` no relatório) e `npm run test:e2e` terminam com código 0. Se for preciso ajustar o `tsconfig.json` (estabilização após o build, `types`) ou o `vitest.config.ts` (R-2), o desenvolvedor **pede o ajuste ao devops**, porque esses arquivos são da T-1, e registra o pedido no `dev.md`.

### T-3 — Documentação dos comandos e verificação em clone limpo (devops)
- **Dependências:** T-2.
- **Arquivos sob posse:** `CLAUDE.md` (só a frase de "Project status" e o bloco "Comandos e cobertura"), `docs/demandas/D-002/devops.md`.
- **Entregável:** o bloco do RN-9, com: `nvm use`; `npm ci`; `npx playwright install chromium` (`--with-deps` opcional, exige sudo); dev; build; start; lint; typecheck; `npm test`, `test:unit` e `test:integration`; teste único (Vitest e Playwright); `test:coverage` (com o relatório em `coverage/`); `test:e2e` (faz o build sozinho, exige a porta 3000 livre); migrações "a partir de E0.2/E0.4". Também mantém a política de cobertura (limiar, escopo, exclusões permitidas, Playwright fora da métrica) e cita a telemetria opcional.
- **Critério de conclusão:** num `git clone` local do branch para um diretório **com espaço e acento**, cada comando do bloco, executado como está escrito e na ordem, termina com código 0. As saídas ficam registradas no `devops.md`.

DBA: dispensado (sem dados). Arquiteto: disponível para revisão se R-1 ou R-2 exigirem mudar o desenho.
