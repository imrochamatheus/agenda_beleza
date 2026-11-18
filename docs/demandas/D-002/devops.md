# D-002 — DevOps

## T-1 — Toolchain e configurações

Executado em 2026-11-18 no caminho real `/home/cliente/Área de Trabalho/agenda_beleza`, com Node v24.21.0 e npm 11.19.0, na branch `feat/d-002-scaffolding`.

### 1. O que mudou e por quê

Os arquivos criados seguem as seções 1.1 e 3 do `design.md`, com as versões exatas da tabela 1.1. Nenhuma ferramenta foi adicionada além das que o desenho prevê.

| Arquivo | Conteúdo |
|---|---|
| `package.json` | `private`, `engines.node` `>=24.15.0 <25`, os scripts da seção 3.1 e 13 dependências com versão exata (nenhum `^`/`~`) |
| `package-lock.json` | gerado por `npm install` (lockfileVersion 3), 423 pacotes |
| `.npmrc` | `save-exact=true` (sem `engine-strict`, S-5) |
| `.nvmrc` | `24` |
| `.gitignore` | a lista da seção 2 do desenho; `.env.example` continua versionável |
| `tsconfig.json` | a seção 3.3, sem `baseUrl` e sem `types` (não foi necessário) |
| `next.config.ts` | `const nextConfig: NextConfig = {}` |
| `eslint.config.mjs` | `defineConfig([...nextVitals, ...nextTs, globalIgnores([...])])` |
| `vitest.config.ts` | a seção 3.2, com o desvio do R-2 descrito abaixo |
| `vitest.setup.ts` | `afterEach(cleanup)` |
| `playwright.config.ts` | a seção 3.5 (projeto único `mobile-chromium`, 375×812) |
| `tests/integration/.gitkeep` | marca o diretório do projeto `integration` |

**Desvio previsto (R-2):** o Vitest 5.1.1 não aceita `passWithNoTests` dentro de um projeto inline. O `tsc` acusa `TS2769 ... 'passWithNoTests' does not exist in type 'Omit<InlineConfig, NonProjectOptions | ...>'`, e sem a opção o `npm run test:integration` termina com código 1. A opção foi movida para a raiz de `test`, com um comentário. Efeito colateral: o projeto `unit` também passa quando não há testes. Isso não enfraquece o gate, porque a T-2 entrega testes unitários e o limiar de 90% de linhas sobre `src/**` continua valendo.

### 2. Variáveis de ambiente

Nenhuma. O `.env.example` fica para a E0.2.

### 3. Comandos para reproduzir

```
nvm use            # lê .nvmrc (24)
npm ci
npx playwright install chromium
npm run test:integration
npm test
npm run test:coverage
npm run typecheck
npm run lint
```

### 4. Evidências

| Comando | Código de saída | Saída resumida |
|---|---|---|
| `npm install` | 0 | `added 423 packages, audited 424`; apenas `npm warn deprecated eslint@9.39.5` (ver riscos) |
| `npm ci` | 0 | `added 423 packages ... in 8s`; `grep -ci eresolve` = **0**; sem `--legacy-peer-deps` nem `--force` |
| `grep -cE '"[\^~]' package.json` | — | **0** ocorrências |
| `npm ls --depth=0` | 0 | next 16.4.6, react/react-dom 19.3.1, typescript 6.0.3, eslint 9.39.5, vitest e @vitest/coverage-v8 5.1.1, jsdom 31.0.1, @playwright/test 1.65.1; transitivos vite 8.3.8 e typescript-eslint 8.73.0, como no desenho |
| `npm run test:integration` | **0** | `projects: integration`, nenhum arquivo encontrado, passa por `passWithNoTests` |
| `npm test` / `npm run test:unit` | 0 | nenhum teste ainda (projetos `unit` e `integration` listados) |
| `npm run test:coverage` | 0 | `Lines: Unknown% (0/0)`; ainda não há `src/` |
| `npm run typecheck` | 0 | sem erros (depois do ajuste do R-2) |
| `npm run lint` | 0 | sem erros nem avisos; imprime a mensagem informativa `Pages directory cannot be found at .../pages or .../src/pages` (vem da regra `no-html-link-for-pages`, não é um aviso do ESLint e não afeta o `--max-warnings=0`) |
| `npx playwright install chromium` | 0 | baixou chromium-1255 e chromium_headless_shell-1255 em `~/.cache/ms-playwright/`, **sem sudo** |
| Lançamento do Chromium (script `node -e` com `chromium.launch()`) | 0 | `LAUNCH_OK ok {"width":375,"height":812}`: nenhuma biblioteca de sistema faltando |
| `npx playwright test --list` | 1 | `No tests found` (esperado: `e2e/` é da T-2) |
| `npm audit --omit=dev` | 0 | `found 0 vulnerabilities`; `npm audit` completo mostra os 18 "high" de devDependencies do R-3 |

### 4.1 Ajustes depois da T-2 (pedido do desenvolvedor)

- **`tsconfig.json` estabilizado pelo `next build`:** o build acrescentou `.next/dev/types/**/*.ts` ao `include` e expandiu os arrays para várias linhas. Revisei o resultado e assumo essa versão: nenhuma opção de compilação mudou. Dois builds seguidos produziram o mesmo md5 (`034eb8352699f7b35debf9d98ac45cf1`), e o md5 continuou igual depois do `build` e do `test:e2e` abaixo.
- **`"type": "module"` no `package.json`:** o Vite 8 avisava `ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1)` em toda execução do Vitest. Como os arquivos de configuração já são ESM (`.ts` com `import` e `eslint.config.mjs`), declarar o pacote como ESM é a correção na origem. Descartei suprimir o aviso com `VITE_CONFIG_NATIVE_IGNORE_WARNING` porque isso só esconderia o problema. Verificação depois da mudança:

| Comando | Código | Observação |
|---|---|---|
| `npm run lint` | 0 | |
| `npm run typecheck` | 0 | |
| `npm run test:coverage` | 0 | `Tests 6 passed (6)`, `Lines: 100% (4/4)`; 0 ocorrências do aviso ESM/CommonJS |
| `npm run build` | 0 | Turbopack no caminho com acento (o R-1 não ocorreu) |
| `npm run test:e2e` | 0 | `1 passed` (`mobile-chromium`, `e2e/smoke.spec.ts`) |
| `npm ci` | 0 | o lock continua em sincronia |
| `npm run test:integration` | 0 | |

A mensagem "Pages directory cannot be found" do lint sumiu depois que a T-2 criou `src/app/`.

### 5. Riscos e pendências

- **ESLint 9.39.5 marcado como deprecated pelo npm:** o aviso aparece em todo `npm install`/`npm ci`. É uma consequência da decisão D-1, porque os plugins do `eslint-config-next` 16.4.6 ainda não aceitam o ESLint 10. Não bloqueia nada. Reavaliar junto com a D-1.
- **Mensagem "Pages directory cannot be found" no lint:** deve sumir ou continuar inofensiva quando a T-2 criar `src/app/`. O desenvolvedor confirma isso na T-2. Se continuar aparecendo, desligar `@next/next/no-html-link-for-pages` só vale com justificativa (o projeto usa apenas App Router).
- **`passWithNoTests` na raiz (R-2):** registrado acima. O `dev.md` da T-2 deve citar este desvio, já que o desenho pedia o registro lá.
- **R-1 (Turbopack e caminho não ASCII):** ainda não foi testado, porque não há `src/app` para o `next build`. A T-2 verifica isso.
- **`tsconfig.json`:** o `next build` pode reescrevê-lo. Se isso acontecer na T-2, o desenvolvedor pede ao devops que versione a versão estabilizada.
- Nenhum segredo, container ou CI nesta tarefa.

## T-3 — Documentação dos comandos e verificação em clone limpo

### 1. O que mudou

- **`CLAUDE.md`, "Project status":** registra que o projeto já tem o scaffolding (D-002), o que ainda falta (banco, Prisma, fila, Docker e CI, previstos para E0.2–E0.4) e aponta para o bloco de comandos.
- **`CLAUDE.md`, "Comandos e cobertura":** substituído por uma tabela com os comandos reais. Ela cobre `nvm use`, `npm ci`, `npx playwright install chromium`, dev, build, start, lint, typecheck, `npm test`, `test:unit` e `test:integration`, teste único (Vitest e Playwright), `test:coverage` e `test:e2e`. Para migrações, a tabela diz que ainda não existem e chegam na E0.2/E0.4. O bloco também cita os pré-requisitos (porta 3000 livre, build antes do Playwright avulso, docblock jsdom), o uso na CI, a telemetria opcional e a política do gate de 90% (limiar, escopo, exclusões permitidas e Playwright fora da métrica).
- O item 1 do líder (`tsconfig.json` estabilizado e `"type": "module"`) está na seção 4.1 da T-1.

### 2. Clone limpo

A árvore de trabalho (inclusive os arquivos não commitados) foi copiada com rsync, excluindo `node_modules`, `.next`, `coverage`, `playwright-report`, `test-results`, `*.tsbuildinfo` e `next-env.d.ts`. O destino tem espaço e acento:
`/tmp/claude-1000/-home-cliente--rea-de-Trabalho-agenda-beleza/c9fe176d-96c2-4130-9a5b-0c81e8d2bc70/scratchpad/Cópia Limpa/agenda_beleza`.
A porta 3000 estava livre no início. Os comandos rodaram como estão escritos no `CLAUDE.md`, na ordem abaixo.

| # | Comando | Código | Saída resumida |
|---|---|---|---|
| 1 | `nvm use` | 0 | Node v24.21.0 |
| 2 | `npm ci` | 0 | `added 423 packages ... in 6s`; 0 ocorrências de `ERESOLVE` |
| 3 | `npx playwright install chromium` | 0 | navegador já presente no cache do usuário |
| 4 | `npm run build` | 0 | `✓ Compiled successfully` (Turbopack, caminho com acento) |
| 5 | `npm run lint` | 0 | sem saída além do cabeçalho |
| 6 | `npm run typecheck` | 0 | |
| 7 | `npm test` | 0 | |
| 8 | `npm run test:unit` | 0 | |
| 9 | `npm run test:integration` | 0 | nenhum teste (passa sem testes) |
| 10 | `npx vitest run src/lib/site.test.ts -t "define a marca"` | 0 | `Tests 1 passed \| 1 skipped (2)`: o filtro funcionou |
| 11 | `npm run test:coverage` | 0 | `Test Files 3 passed`, `Tests 6 passed`, `Lines: 100% (4/4)` |
| 12 | `npm run test:e2e` | 0 | `✓ [mobile-chromium] › e2e/smoke.spec.ts › a página inicial abre no viewport móvel com o título da marca`, `1 passed` |
| 13 | `npx playwright test e2e/smoke.spec.ts -g "viewport móvel"` | 0 | `1 passed` (usou o build do passo 12) |
| 14 | `npm run dev` | — | servidor de longa duração: `curl http://127.0.0.1:3000/` devolveu HTTP 200 com `<h1>Agenda Beleza</h1>`, e o processo foi encerrado em seguida |
| 15 | `npm run start` | — | idem: HTTP 200 com `<h1>Agenda Beleza</h1>`, e o processo foi encerrado |

Outras verificações:
- O md5 do `tsconfig.json` no clone continuou `034eb8352699f7b35debf9d98ac45cf1` depois de dois builds, então o `next build` não o reescreve mais.
- O aviso ESM/CommonJS do Vite não apareceu em nenhum log.
- Depois da sondagem de `start`, um `next-server` (cwd no clone) ficou ouvindo a porta 3000. Encerrei o processo pelo PID e confirmei que a porta ficou livre. Isso é efeito do método de sondagem em segundo plano, não do projeto: no uso interativo, Ctrl+C encerra o servidor.

### 3. Riscos e pendências

- Sem variáveis de ambiente, segredos, containers nem CI nesta demanda.
- Continuam valendo o R-3 (`npm audit` com 18 "high" em devDependencies; `--omit=dev` mostra 0) e a D-1 (aviso de deprecated do ESLint 9). Reavaliar na E0.3.
