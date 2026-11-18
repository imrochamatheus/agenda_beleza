# D-002 — Especificação: criar o projeto Next.js + TypeScript com lint, typecheck, Vitest com cobertura e Playwright

Origem: issue #3 (backlog E0.1, épico #2/E0), texto em `docs/demandas/D-002/issue-3.md`. Derivada de `docs/demandas/D-001/spec.md` (item E0.1) e `docs/demandas/D-001/design.md` (chave `E0.1`). Branch: `feat/d-002-scaffolding`.

## 1. Problema

Inexistente. O repositório não tem código de aplicação, `package.json`, configuração de TypeScript, lint, testes nem E2E.

Evidência (`git ls-files` em 2026-11-18): só `.claude/**`, `.github/workflows/claude*.yml`, `CLAUDE.md`, `PLAN.md`, `README.md` (15 bytes, só o título) e `docs/demandas/**`. O `CLAUDE.md` ("Comandos e cobertura") diz que nenhum comando existe e que a cobertura "não é mensurável neste momento".

Sem esse esqueleto, nenhuma demanda seguinte consegue cumprir a definição de pronto (build, lint, typecheck, testes e cobertura ≥ 90%).

## 2. Objetivo

Entregar o esqueleto do projeto com os comandos oficiais de desenvolvimento, qualidade e testes funcionando a partir de um clone limpo. O gate de cobertura de linhas ≥ 90% precisa estar ativo, ou seja, o comando falha abaixo do limiar. Os comandos reais ficam documentados no `CLAUDE.md`. É a base de E0.2 (Docker/Prisma, #4) e E0.8 (#10).

## 3. Escopo

**Entra:**
- Projeto Next.js (App Router) com TypeScript estrito, React e diretório `src/`.
- `.nvmrc` com Node 24 e `engines` no `package.json`.
- ESLint (flat config, `eslint.config.mjs`), com `lint` = `eslint .`, e o script `typecheck`.
- Vitest com os projetos `unit` e `integration` e cobertura `@vitest/coverage-v8`. Testes de componente usam `@testing-library/react` + `jsdom`.
- Playwright (Chromium, móvel 375×812) com um teste de fumaça.
- `src/app/layout.tsx` e `src/app/page.tsx` provisórios, com teste de componente.
- `.gitignore` com os artefatos gerados (suposição S-6).
- Atualização do `CLAUDE.md`: o bloco "Comandos e cobertura" e a frase de "Project status" que diz não haver código (suposição S-8).

**Fica fora (na própria issue ou no `PLAN.md`):**
- Dockerfile, docker-compose, Prisma, `.env.example`, `src/server/env.ts`, worker e README de execução: E0.2 (#4).
- Workflow de CI `ci.yml`, artefatos e `tests/integration/smoke-db.test.ts`: E0.3.
- Esquema de dados e migrações: E0.4.
- Design system, tema visual e componentes de UI: itens posteriores. A página provisória não precisa seguir a direção visual.
- Nada desta demanda toca a lista "Fora da primeira versão" do `PLAN.md`. Não há tela nem schema de funcionalidade.
- Os workflows existentes (`.github/workflows/claude.yml`, `claude-code-review.yml`) não são alterados.

## 4. Regras de negócio

Esta é uma demanda de infraestrutura de desenvolvimento, então as "regras" abaixo são técnicas e obrigatórias.

- **RN-1** (issue RN-1; CLAUDE.md "Comandos e cobertura"): o `vitest.config.ts` define `coverage.provider = 'v8'`, `coverage.include = ['src/**']` e `coverage.thresholds.lines = 90`. Arquivos de `src/**` que nenhum teste importa **entram** no relatório com 0%. Sem isso, o CA-3 não funciona. Na versão escolhida do Vitest, isso deve sair do `include`; se a versão exigir uma opção a mais, como o antigo `coverage.all`, ela precisa estar ligada.
- **RN-2** (issue RN-2): as exclusões de cobertura se limitam a código gerado (cliente Prisma), arquivos só de tipos (`*.d.ts`, por exemplo), configuração e migrações. Cada exclusão tem um comentário que a justifica. `layout.tsx`, `page.tsx` e os demais arquivos de `src/app/**` **não** podem ser excluídos: precisam ser cobertos por teste. Os próprios arquivos de teste (`*.test.ts(x)`) dentro de `src/` ficam fora da métrica. Isso não é exclusão de código de produção, mas também leva comentário.
- **RN-3** (issue RN-3): o Playwright fica fora da métrica de cobertura. O Vitest não coleta `e2e/**` e o Playwright não coleta os `*.test.ts(x)` do Vitest.
- **RN-4** (issue RN-4; entregáveis): o gerenciador é o npm, com `package-lock.json` versionado e `npm ci` como instalação oficial. Scripts obrigatórios: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:coverage` e `test:e2e`. O "teste único" não precisa de script próprio, mas a forma de rodá-lo fica documentada (ver RN-9).
- **RN-5** (issue RN-5): `npm run test:coverage` roda `unit` e `integration` numa **única** execução do Vitest, com um só relatório e um só limiar global. Não pode haver soma ou merge posterior de relatórios.
- **RN-6** (issue, Escopo): o projeto `integration` usa `passWithNoTests: true` enquanto não houver teste de banco. Nesta demanda **não** existe PostgreSQL nem Prisma, então nenhum teste do projeto `integration` pode depender de banco. Convenção de localização: `unit` coleta `src/**/*.test.ts` e `src/**/*.test.tsx`; `integration` coleta `tests/integration/**/*.test.ts`, alinhado ao `tests/integration/smoke-db.test.ts` previsto em E0.3. Os globs não se sobrepõem, então nenhum arquivo roda nos dois projetos.
- **RN-7** (issue, Escopo): `*.test.tsx` roda em `jsdom` com `@testing-library/react`, e `*.test.ts` roda em `node`. O mecanismo (subprojeto, `environment` por glob ou comentário `@vitest-environment`) fica a critério do arquiteto, desde que o comportamento seja esse e o RN-5 continue valendo.
- **RN-8** (issue, Escopo): o Playwright tem um único projeto, Chromium, com viewport 375×812, `isMobile: true` e `hasTouch: true`. O `webServer` sobe a aplicação com `next start` (build de produção), e os testes ficam em `e2e/`.
- **RN-9** (issue CA-5): o bloco "Comandos e cobertura" do `CLAUDE.md` passa a listar os comandos reais de instalar (incluindo a instalação do navegador do Playwright), dev, build, lint, typecheck, teste, teste único (arquivo e nome do teste), cobertura e E2E. Também registra os pré-requisitos de cada um, como "E2E exige build prévio", se for o caso. Migrações aparecem como "a partir de E0.2/E0.4" e não como comando inventado. O bloco mantém a política de cobertura vigente (limiar, escopo e exclusões permitidas).
- **RN-10** (`.nvmrc` como fonte única): `.nvmrc` contém `24`, e `package.json#engines.node` aceita Node 24 (ex.: `>=24 <25`). As versões de Node escritas em outros arquivos não podem divergir dessas.
- **RN-11** (CLAUDE.md, "UI conventions"): o `layout.tsx` declara `<html lang="pt-BR">`, e a página provisória tem texto em pt-BR com um título visível (ex.: "Agenda Beleza") que o E2E e o teste de componente usam para verificar a renderização.
- **RN-12** (TypeScript estrito): `tsconfig.json` com `"strict": true`. O `typecheck` (ex.: `tsc --noEmit`) cobre `src/`, `tests/`, `e2e/` e os arquivos de configuração em TypeScript, e não depende de rodar `next build` antes.
- **RN-13** (lint): `eslint .` ignora artefatos gerados (`.next/`, `coverage/`, `playwright-report/`, `test-results/`, `node_modules/`, `next-env.d.ts`) e analisa `src/`, `tests/`, `e2e/` e as configurações. A configuração usa a do Next (`eslint-config-next`, regras core-web-vitals e TypeScript).

## 5. Critérios de aceitação

Os CA-1 a CA-7 são os da issue #3. Ajustei apenas o que estava ambíguo; os acréscimos estão marcados. Todos se relacionam ao CA 11 do `PLAN.md` ("o projeto inicia localmente… com testes automatizados") como base, e ao gate padrão.

- **CA-1** (issue CA-1): Dado um clone limpo com Node 24 (`nvm use` lendo o `.nvmrc`), quando se executa `npm ci` e depois `npm run build`, então os dois terminam com código 0, sem `--legacy-peer-deps`/`--force` e sem `npm install` intermediário.
- **CA-2** (issue CA-2): Dado o projeto, quando se executam `npm run lint` e `npm run typecheck`, então os dois terminam com código 0 e sem avisos tratados como erro pendentes.
- **CA-3** (issue CA-3): Dada uma alteração descartável e não commitada que leva a cobertura global de linhas a menos de 90% (ex.: um arquivo novo em `src/` com várias linhas executáveis e sem teste), quando se executa `npm run test:coverage`, então o comando termina com código diferente de 0 e a saída menciona o limiar de linhas (90%). Verificação manual do tester, com a saída registrada em `testes.md`. Sem a alteração, o mesmo comando termina com código 0.
- **CA-4** (issue CA-4): Dado o teste de fumaça `e2e/smoke.spec.ts`, quando se executa `npm run test:e2e` (com os pré-requisitos documentados no `CLAUDE.md`), então o Playwright abre `/` no Chromium com viewport 375×812, encontra o título da página (RN-11) e o teste passa. O teste também confere o tamanho do viewport (`page.viewportSize()`).
- **CA-5** (issue CA-5): Dado o `CLAUDE.md`, quando se lê o bloco de comandos, então ele lista os comandos reais de instalar, dev, build, lint, typecheck, teste, teste único, cobertura e E2E. Cada um, executado como está escrito num clone limpo seguindo a ordem documentada, termina com código 0. O tester verifica isso.
- **CA-6** (issue CA-6, ajustado): Dado um teste no projeto `unit` e um teste no projeto `integration`, cada um cobrindo linhas **diferentes** de `src/`, quando se executa `npm run test:coverage`, então a saída mostra os dois projetos executados e é gerado um único relatório de cobertura em que as linhas exercitadas só pelo teste de `integration` aparecem cobertas. *Ajuste:* como ainda não há banco e o projeto `integration` passa sem testes (RN-6), o tester verifica este CA com um teste descartável e não commitado em `tests/integration/`, que importa um módulo de `src/` não coberto pelo `unit`, e registra a saída. Nenhum teste de integração sem banco é commitado só para isso (ver S-3).
- **CA-7** (issue CA-7): Dado um `*.test.tsx` que renderiza `src/app/page.tsx` com `@testing-library/react` e verifica o título (RN-11), quando `npm run test:coverage` roda, então o teste passa em `jsdom` e `src/app/page.tsx` aparece coberto no relatório único.
- **CA-8** (novo; RN-1, RN-2): Dado o projeto entregue, sem alterações, quando se executa `npm run test:coverage`, então a cobertura global de linhas fica ≥ 90%, e `src/app/layout.tsx` e `src/app/page.tsx` aparecem no relatório (não excluídos). Toda entrada de `coverage.exclude` tem um comentário de justificativa que se enquadra nas categorias do RN-2.
- **CA-9** (novo; RN-3, RN-6): Dado o projeto, quando se executa `npm test` (ou `npm run test:unit`), então nenhum arquivo de `e2e/` é coletado pelo Vitest. E quando se executa `npm run test:e2e`, nenhum `*.test.ts(x)` é coletado pelo Playwright. Verificável pela listagem de testes de cada ferramenta (`vitest list`, `playwright test --list`).
- **CA-10** (novo; RN-7): Dado um `*.test.ts` no projeto `unit`, quando ele roda, então o ambiente é `node`: `typeof window === 'undefined'` dentro do teste. Pode ser verificado por um teste unitário commitado que faça essa asserção, junto com uma função pura trivial de `src/` (ex.: um utilitário), ou pelo tester, de forma manual e descartável.

## 6. Casos limite

- **Versão do Node:** com Node diferente de 24, o `engines` deve sinalizar a incompatibilidade (aviso do npm é suficiente; `engine-strict` não é exigido, ver S-5). O ambiente local tem v24.21.0 / npm 11.19.0.
- **Conflitos de peer dependency:** `npm view` em 2026-11-18 mostra `typescript` em 7.0.2 como `latest`, mas `typescript-eslint` 8.73.0 exige `typescript >=4.8.4 <6.1.0`. Instalar a versão mais nova do TypeScript quebraria o `npm ci`/lint, que é o CA-1/CA-2. As versões precisam ser fixadas em combinações compatíveis (ex.: TypeScript 6.0.x ou 5.9.x), sem `--legacy-peer-deps`. Outras referências conferidas: `next` 16.4.6 (engines node `>=20.9.0`), `vitest`/`@vitest/coverage-v8` 5.1.1 (engines `^22.12.0 || ^24.0.0 || >=26`), `@playwright/test` 1.65.1, `eslint` 10.15.0, `eslint-config-next` 16.4.6 (peer `eslint >=9`), `jsdom` 31.0.1, `@testing-library/react` 16.3.3. `vitest` e `@vitest/coverage-v8` devem ficar na **mesma** versão.
- **Componentes assíncronos:** o `@testing-library/react` não renderiza Server Components `async`. A `page.tsx` provisória deve ser um componente síncrono para que o CA-7 seja possível.
- **Arquivo novo sem teste não aparece na cobertura:** se o `include` não fizer entrar arquivos não importados, o CA-3 passa falsamente. O tester deve confirmar que o arquivo descartável aparece com 0% no relatório.
- **Cobertura do `layout.tsx`:** ele conta na métrica (RN-2). Para não derrubar o limiar, precisa de teste próprio ou de cobertura indireta. Renderizar `<html>` dentro do `jsdom` gera aviso de aninhamento (`<html>` dentro de `<div>`), e o teste não pode depender de suprimir erros de forma genérica.
- **E2E sem build:** `next start` falha sem `.next/`. Ou o `test:e2e`/`webServer` garante o build, ou o `CLAUDE.md` documenta `npm run build` como pré-requisito. O CA-4 vale com o fluxo documentado.
- **Navegador do Playwright ausente:** num clone limpo, o Chromium não vem com o `npm ci`. O `CLAUDE.md` documenta `npx playwright install chromium`. As dependências de sistema (`--with-deps`) exigem sudo e ficam documentadas como passo opcional.
- **Porta ocupada:** o `webServer` usa uma porta definida (padrão 3000). `reuseExistingServer` fica ligado só fora da CI (`!process.env.CI`), para não testar um servidor de dev antigo na CI.
- **Fuso horário:** não se aplica a esta demanda, porque não há lógica de data. Suposição: os testes não dependem do TZ da máquina. `TZ=UTC` na imagem fica em E0.2.
- **Concorrência, isolamento entre salões, salão suspenso, cliente anonimizada, telefone, permissões por perfil:** não se aplicam, porque não há domínio, dados nem autenticação nesta demanda. Começam em E0.4/E0.5.
- **Diretório com acento e espaço:** o caminho local é `/home/cliente/Área de Trabalho/agenda_beleza`. Scripts e configurações não podem quebrar com espaços ou caracteres não ASCII no caminho (usar caminhos relativos e sem interpolação em shell sem aspas).
- **Telemetria do Next:** não deve exigir interação nem falhar sem rede. Desativá-la é opcional (S-7).
- **Arquivos gerados versionados por engano:** `next-env.d.ts`, `.next/`, `coverage/`, `playwright-report/` e `test-results/` não são commitados (S-6).

## 7. Dependências

- **Demandas:** nenhuma bloqueante (issue: "Bloqueada por: nenhuma"). Esta demanda bloqueia #4 (E0.2) e #10 (E0.8).
- **Integrações** (Mercado Pago, WhatsApp, e-mail, Turnstile): não se aplicam.
- **Infraestrutura:** acesso ao registro npm e ao download do Chromium do Playwright. Ambiente local: Node v24.21.0, npm 11.19.0, Docker 29.8 + Compose v5.5 e psql 14 (cliente). Docker e psql não são usados aqui.
- **Dados:** não se aplica.

## 8. Impactos prováveis

- **Dados (DBA):** nenhum. Não há banco, Prisma nem migrações. O DBA pode ser dispensado com esse motivo.
- **Infraestrutura/CI (DevOps):** o DevOps é o responsável pela issue. As decisões daqui condicionam E0.2 (o Dockerfile lê o `.nvmrc`; os scripts `build`/`start` são usados na imagem) e E0.3 (a CI usa `node-version-file: .nvmrc`, `npm ci`, `test:coverage`, `test:e2e` e publica `coverage/` e os traces do Playwright). Convém definir já os diretórios de saída (`coverage/`, `playwright-report/`, `test-results/`) e um reporter de cobertura em arquivo (ex.: `html` + `lcov` ou `json-summary`), além do `text` no terminal, para que E0.3 só os publique.
- **Documentação:** `CLAUDE.md` (RN-9). O README de execução fica em E0.2.

## 9. Dúvidas

**Bloqueantes:** nenhuma.

**Não bloqueantes (suposições adotadas):**
- **S-1:** o script `test` = `vitest run`, com todos os projetos e sem cobertura; `test:unit`/`test:integration` = `vitest run --project <nome>`; `test:coverage` = `vitest run --coverage` (todos os projetos). Teste único: `npx vitest run <caminho> -t "<nome>"`, documentado no `CLAUDE.md`.
- **S-2:** a versão do Next é a última estável (16.x em 2026-11-18), e as demais dependências são fixadas na última combinação compatível entre si (ver Casos limite). Os números exatos ficam com o arquiteto/DevOps e são registrados no `design.md`.
- **S-3:** o CA-6 é verificado com um teste descartável, não com um teste de integração commitado sem banco. O primeiro teste de integração commitado é o `smoke-db` de E0.3. Se o arquiteto preferir commitar um teste de integração sem banco agora, ele precisa ter asserções reais e não pode simular banco.
- **S-4:** os testes de componente ficam no projeto `unit`, e não num terceiro projeto, para respeitar "projetos `unit` e `integration`" da issue. Se a versão do Vitest exigir um subprojeto para o `jsdom`, ele pode existir, desde que `--project unit` continue rodando todos os testes unitários e o RN-5 continue valendo.
- **S-5:** `engines` sem `engine-strict`: um aviso do npm é suficiente.
- **S-6:** um `.gitignore` faz parte da entrega, mesmo sem constar na lista de arquivos da issue, porque é necessário para os CAs de clone limpo.
- **S-7:** a telemetria do Next pode ser desativada (`NEXT_TELEMETRY_DISABLED=1` nos scripts ou na documentação). Não é obrigatório.
- **S-8:** a frase "The repository has no application code yet…" em "Project status" do `CLAUDE.md` é atualizada para refletir o scaffolding. O resto do arquivo não muda.
- **S-9:** a forma de garantir o build antes do E2E (dentro do `webServer`/`test:e2e` ou como pré-requisito documentado) fica a critério do arquiteto. O critério é que o fluxo documentado funcione num clone limpo (CA-4/CA-5).
