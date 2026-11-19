# D-006: CI no GitHub Actions (issue #5, E0.3)

Autor: analista-requisitos. Fontes, em ordem de precedência:
1. `docs/demandas/D-006/issue-5.md`, com RN-1..RN-5 e CA-1..CA-4 já decididos.
2. `CLAUDE.md`: "Comandos e cobertura", política do gate de cobertura e "Definição de pronto".
3. `PLAN.md`: critério de aceite 11 e a seção "Testes".
4. `docs/demandas/D-001/devops.md` §1 E0.3, §2, §4 R2/R3/R11, e `docs/demandas/D-001/design.md:63,160`.
5. `docs/demandas/D-003/devops.md:74-77,210`.
6. `docs/demandas/D-005/design.md:291-300` e o README da D-005, seção "Banco de teste".
7. O código da branch `feat/d-006-ci` (base `bc163e7`, igual a `origin/main`).

Esta especificação não reabre nenhuma decisão da issue. Ela acrescenta dois tipos de item, cada um marcado com a origem: (a) CAs que tornam verificáveis as RNs e os entregáveis da issue que não têm CA próprio; (b) a fronteira com E0.7, E4.4, E9.2 e E9.3.

## 1. Problema

Hoje nenhum gate da definição de pronto roda automaticamente num push ou num PR. Tudo depende de alguém executar os comandos na própria máquina. Evidências:

- `ls .github/workflows` mostra só `claude-code-review.yml` e `claude.yml`. Não há workflow de build nem de teste. O `claude-code-review.yml` reage a `pull_request` e roda a revisão do Claude, não os gates. `CLAUDE.md:7` confirma: "There is no queue or CI yet (E0.3, E0.7)".
- `CLAUDE.md`, na política do gate, diz "A CI executa o mesmo comando". Essa promessa ainda não tem implementação.
- O que a CI vai herdar já existe e pode ser reusado sem mudanças:
  - `package.json` tem os scripts `lint` (`eslint . --max-warnings=0`), `typecheck`, `build`, `db:generate`, `db:migrate:deploy`, `test:coverage` (`vitest run --coverage`) e `test:e2e` (`next build && playwright test`).
  - `.nvmrc` contém `24`.
  - `vitest.config.ts` tem `thresholds: { lines: 90 }` e os reporters `text`, `html`, `lcov` e `json-summary` em `coverage/`. O `.env` é opcional (`process.loadEnvFile` ignora `ENOENT`), e as variáveis do ambiente prevalecem sobre ele.
  - O projeto `integration` usa `maxWorkers: 4`.
  - `playwright.config.ts` tem `outputDir: 'test-results'`, o reporter HTML em `playwright-report`, `trace: 'retain-on-failure'`, `retries: CI ? 2 : 0`, `forbidOnly: !!CI`, `reuseExistingServer: !CI` e o `webServer` `npm run start`.
- O harness de integração (D-005) traz requisitos próprios para a CI:
  - Parte só de `TEST_DATABASE_URL`, cuja base é administrativa e **precisa existir** (`tests/support/global-setup.ts`; README, seção "Banco de teste").
  - Exige um papel com `CREATEDB` e um nome de base de no máximo 46 caracteres em `[a-z0-9_]` (`tests/support/banco.ts`, `MAX_BASE_DE_TESTE = 46`).
  - Recusa rodar se o nome da base de `TEST_DATABASE_URL` for igual ao da base de `DATABASE_URL`.
  - Aplica sozinho o `prisma migrate deploy` no template (`tests/support/db.ts:164`).
  - Usa até 72 conexões por execução.
- No compose, quem cria a base de teste é o initdb (`docker/postgres/initdb/10-base-de-teste.sh`). Esse script **não** existe num service container do Actions, porque o service sobe antes do checkout. A CI precisa garantir de outro jeito que as duas bases existam: a de `DATABASE_URL`, usada pelo passo `migrate deploy`, e a administrativa de `TEST_DATABASE_URL`. O README:71 já antecipa isso.
- `docker-compose.yml:17` usa a imagem `postgres:17`. As migrações fazem `CREATE EXTENSION IF NOT EXISTS btree_gist` (`prisma/migrations/20261118000100_reserva_exclusion/migration.sql:26`), extensão que vem no contrib da imagem oficial.
- O `Dockerfile` faz `npm ci → db:generate → build → build:node → prune` sem `DATABASE_URL`. O compose declara o `.env` com `required: false`, então `docker compose config` e `docker compose build` funcionam sem `.env` (CA-7 da D-003).
- **Teste "conexão e `SELECT 1`":** `tests/integration/smoke-db.test.ts` **não existe**. O `SELECT 1` já é exercitado de forma indireta: `tests/integration/health.test.ts:19-34` passa pela rota `/api/health`, por `verificarBanco` e por `bancoDisponivel`, todos contra a base do worker. A issue, porém, lista `smoke-db.test.ts` como entregável. Ele é um arquivo **novo**, mínimo e direto: a prova de conexão de que o CA-3 precisa, sem passar pela camada HTTP.
- A cobertura local está em 100% de linhas, 297 de 297 (`coverage/coverage-summary.json`). Isso importa para o CA-2: o PR descartável precisa acrescentar **pelo menos 34 linhas executáveis sem teste** em `src/`, porque 297/(297+34) = 89,7% < 90%. Recomenda-se uma margem de 50 linhas ou mais.
- Repositório (somente leitura, `gh`):
  - `imrochamatheus/agenda_beleza` é **privado** (`isPrivate: true`).
  - O Actions está habilitado (`actions/permissions` devolve `enabled: true`, `allowed_actions: all`).
  - `GET branches/main/protection` e `GET rulesets` devolvem **403**: "Upgrade to GitHub Pro or make this repository public to enable this feature". Ver o risco K-1.

## 2. Objetivo

Todo PR e todo push em `main` executam, no GitHub Actions e sem nenhum segredo, os mesmos comandos da definição de pronto: lint, typecheck, build, testes de unidade e de integração com cobertura de pelo menos 90% contra PostgreSQL real com as migrações aplicadas, E2E móvel, `docker build` e `docker compose config`. O PR mostra um status por gate. Os relatórios de cobertura e do Playwright ficam disponíveis como artefatos.

## 3. Escopo

### Entra
1. **`.github/workflows/ci.yml`**, um arquivo novo:
   - Gatilhos: `pull_request` e `push` em `main` (D-001/devops.md:37).
   - `permissions: contents: read` no nível do workflow, sem nenhuma permissão adicional em qualquer job.
   - `concurrency` agrupada por workflow e ref, com `cancel-in-progress: true`.
   - `timeout-minutes` em todo job.
2. **Jobs separados por gate**, para que o PR mostre o status de cada um (CA-1): `lint`, `typecheck`, `build`, `testes` (`test:coverage`) e `e2e`, mais o job `docker`. Os nomes exatos ficam com o arquiteto, mas devem ser estáveis, porque viram os nomes dos checks exigidos na proteção de branch.
   - Todo job de Node usa `actions/setup-node` com `node-version-file: .nvmrc` e cache do npm.
   - Em cada job, os passos seguem a ordem da issue para o que lhe cabe: `npm ci` → `npm run db:generate` → gate. Nunca `npm install`, `--legacy-peer-deps` ou `--force`.
3. **Job de testes:**
   - Service `postgres` com a **mesma imagem do compose** (`postgres:17`) e healthcheck `pg_isready`.
   - As duas bases existem antes dos testes: a de `DATABASE_URL` e a administrativa de `TEST_DATABASE_URL`, com nomes diferentes e o de teste com no máximo 46 caracteres.
   - Passo `npm run db:migrate:deploy` contra `DATABASE_URL`, antes de `npm run test:coverage`.
   - Publicação de `coverage/` como artefato.
4. **Job E2E:** instala o Chromium com `npx playwright install --with-deps chromium`, com cache dos navegadores, e roda o Playwright no viewport 375×812. Se o build já tiver rodado no mesmo job, ou se o `.next` vier de um artefato do job `build`, usa `npx playwright test` direto, sem compilar duas vezes (CLAUDE.md, nota após a tabela). Publica `playwright-report/` e `test-results/` (traces) como artefatos.
5. **Job `docker`:** roda `docker compose config` e `docker build` da imagem do `Dockerfile` (alvo `final`) sem push, sem login em registry e sem `.env`.
6. **`tests/integration/smoke-db.test.ts`** (novo): conecta à base do worker indicada pelo harness e executa `SELECT 1` (CA-3).
7. **Documentação:**
   - README: nova seção "CI", com os jobs e o comando local equivalente a cada um, os artefatos, a ausência de segredos e a pendência manual de proteção de branch.
   - `CLAUDE.md`: frase de status ("There is no queue or CI yet") e nota da CI. A linha "Na CI (E0.3)…" passa a refletir o que foi feito.
8. **Evidência de execução real** (seção "Validação" da issue): links dos runs registrados pelo tester em `docs/demandas/D-006/testes.md` (ver §5).

### Fica fora
- Push de imagem, registry, deploy, TLS e proxy (issue, "Fora do escopo"; PLAN: "A publicação na internet fica para uma etapa posterior").
- Alterar `.github/workflows/claude.yml` e `.github/workflows/claude-code-review.yml`. Esses workflows não fazem parte dos gates exigidos (D-001/devops.md R2).
- Configurar a proteção da branch `main` ou rulesets. É passo manual do dono do repositório, uma pendência e não um CA (issue). Ver K-1.
- Banco de E2E próprio, seed, rate limit elevado por env e `retries: 0` na CI. Tudo isso é da **E4.4** (D-001/devops.md:62-68). O E2E atual (`e2e/smoke.spec.ts`) só abre a página inicial e não usa banco.
- Subir o worker ou o pg-boss na CI: **E0.7** (ver a fronteira).
- Mudar `vitest.config.ts`, `playwright.config.ts`, o limiar ou as exclusões de cobertura. A CI usa a configuração atual (RN-1). Ver S-4.
- Tudo de "Fora da primeira versão" do `PLAN.md`. Nada desta demanda toca o domínio.

### Fronteira com outras demandas
| Tema | E0.3 (esta demanda) | Demanda futura |
|---|---|---|
| Fila | O harness já tem o ponto de extensão "inicializadores de schema" (D-005), e a CI roda `test:coverage` como está | **E0.7**: instala o `pg-boss`. Os testes dele rodam no mesmo job de testes, sem mudar o `ci.yml`, salvo se exigirem um serviço extra (aí a E0.7 ajusta a CI) |
| E2E com banco | Job E2E sem banco (o smoke atual não precisa) | **E4.4**: banco de E2E próprio, `migrate deploy` e seed no `globalSetup`, rate limit elevado por env, `retries: 0` na CI e, se algum cenário verificar o envio de mensagem, o worker no job |
| Seed | Fora | **E9.2**: seed de dois salões e do super admin |
| README final | Só a seção "CI" | **E9.3** (bloqueada por esta): consolida o README. O CA-1 dela (`npm ci`, `docker compose up -d --wait`, `npm run test:coverage`, `npm run test:e2e`, todos com código 0) se apoia na mesma sequência que a CI prova |
| Adaptadores | A CI não define nenhum seletor `*_ADAPTER=real` nem segredo | **E0.6, E6.6, E7.2**: adaptadores reais. O padrão continua `simulado` (`src/server/env.ts`), então a CI segue sem segredos |

## 4. Regras de negócio

- **RN-1** (issue): a CI usa o mesmo comando de cobertura do desenvolvimento local, `npm run test:coverage`. Ele falha abaixo de 90% de linhas pelo `thresholds.lines` do `vitest.config.ts`, e a CI não usa nenhum limiar paralelo. Unidade e integração rodam numa única execução, com um só relatório (D-001/devops.md:15).
- **RN-2** (issue): os testes de integração rodam contra o PostgreSQL real do service, com as migrações aplicadas (passo `migrate deploy` e o template do harness). Nenhum mock de banco.
- **RN-3** (issue): a CI usa os adaptadores simulados e não precisa de nenhum segredo real. O `ci.yml` não referencia `secrets.*`, a não ser o `GITHUB_TOKEN` implícito, e não define `*_ADAPTER=real`.
- **RN-4** (issue):
  - `node-version-file: .nvmrc` em todo `setup-node`.
  - `permissions: contents: read`.
  - `concurrency` cancela as execuções antigas do mesmo ref.
- **RN-5** (issue): o relatório de cobertura e os traces do Playwright são publicados como artefatos.
- **RN-6** (D-001/devops.md:34): ordem dos gates `npm ci → prisma generate → typecheck → lint → build → migrate deploy → test:coverage → e2e`. Jobs paralelos são permitidos, mas todo job que roda typecheck, lint, build ou testes faz `npm ci` e `db:generate` antes, porque o cliente gerado não é versionado. Qualquer falha reprova o workflow.
- **RN-7** (D-001/devops.md:29,35; R11): o service da CI usa exatamente a mesma imagem e tag do service `postgres` do `docker-compose.yml` (hoje `postgres:17`). Mudar uma exige mudar a outra.
- **RN-8** (issue, Escopo; D-001/devops.md:36): o job `docker` nunca publica imagem: sem `docker push`, sem `push: true`, sem login em registry e sem `packages: write`.
- **RN-9** (D-001/devops.md:37): todo job tem `timeout-minutes`. Há cache do npm e dos navegadores do Playwright.
- **RN-10** (harness da D-005): na CI, `TEST_DATABASE_URL` e `DATABASE_URL` apontam para bases distintas no mesmo service. O papel tem `CREATEDB`: o `POSTGRES_USER` da imagem oficial é superusuário. O nome da base de teste tem no máximo 46 caracteres. O `max_connections` fica no padrão (100) ou acima.
- **RN-11** (D-001/devops.md:19,40): o PR do CA-2 é descartável. Ele é fechado sem merge, e o código sem teste nunca chega a `main`.

## 5. Critérios de aceitação

Convenções:
- "Run" é uma execução do workflow `ci.yml` no GitHub Actions.
- "PR principal" é o PR da branch `feat/d-006-ci` para `main`. Num evento `pull_request`, o Actions usa o workflow do merge ref, então o `ci.yml` roda no próprio PR mesmo antes de existir em `main`.
- Toda evidência de run vai para `docs/demandas/D-006/testes.md` com: URL do run (`https://github.com/<owner>/<repo>/actions/runs/<id>`), SHA, evento, conclusão de cada job (por exemplo, a saída de `gh run view <id> --json jobs --jq '.jobs[]|{name,conclusion}'`) e o trecho de log pertinente (`gh run view <id> --log --job <job-id> | grep …`).

### CAs da issue (CA-1..CA-4), com o modo de verificação
- **CA-1** (RN-1, RN-2, RN-6): Dado um PR, quando o workflow roda, então lint, typecheck, build, testes com cobertura e E2E são executados, e o PR mostra o status de cada um.
  - Verificação: no PR principal, a aba de checks (`gh pr checks <n>`) lista um check por gate (`lint`, `typecheck`, `build`, testes e `e2e`, além do `docker`), todos `pass` no último SHA. No log de cada job aparecem o comando do script correspondente e a saída com código 0: `eslint . --max-warnings=0`, `tsc --noEmit`, `next build`, `vitest run --coverage` com a tabela de cobertura e `All files` ≥ 90, e o Playwright com `1 passed`. Registrar o link do run.
- **CA-2** (RN-1, RN-11): Dado um PR descartável (fechado sem merge) que reduz a cobertura de linhas para menos de 90%, quando o workflow roda, então o job de testes falha.
  - Preparação: branch descartável a partir de `feat/d-006-ci`, por exemplo `tmp/d-006-ca2-cobertura`. Ela acrescenta um arquivo em `src/`, por exemplo `src/lib/descartavel-ca2.ts`, com pelo menos 50 linhas executáveis que nenhum teste importa. Não pode ter `eslint-disable`, erro de tipo nem teste. O PR é aberto para `main`.
  - Verificação:
    - O job de testes termina `failure`, e o log contém a mensagem de limiar do Vitest (`ERROR: Coverage for lines (…%) does not meet global threshold (90%)`, ou o texto equivalente da versão 5.1.1) com o percentual abaixo de 90.
    - `lint`, `typecheck` e `build` terminam `success`. Isso prova que foi o gate de cobertura que reprovou, e não outro erro.
    - O PR é fechado sem merge (`gh pr view <n> --json state,mergedAt` → `CLOSED`, `mergedAt: null`), e a branch é apagada.
    - Registrar o link do run e o número do PR.
- **CA-3** (RN-2): Dado um teste de integração mínimo (conexão e `SELECT 1`), quando o workflow roda, então ele se conecta ao serviço postgres da CI e passa.
  - Verificação automatizada: `tests/integration/smoke-db.test.ts` existe. Ele usa a URL da base do worker fornecida pelo harness (`DATABASE_URL` do processo de teste, igual a `urlDoWorker()`), nunca uma URL fixa, e verifica que `SELECT 1` devolve 1 e que `current_database()` é a base do worker (sufixo `_w<N>`, não a de desenvolvimento).
  - Verificação na CI: no log do job de testes do PR principal, `tests/integration/smoke-db.test.ts` aparece como aprovado. O job não tem outro PostgreSQL além do service.
  - Verificação local: `npx vitest run --project integration tests/integration/smoke-db.test.ts` passa.
- **CA-4** (RN-8): Dado um PR, quando o workflow roda, então o job de `docker build` e `docker compose config` termina verde sem publicar imagem.
  - Verificação: no PR principal, o job `docker` está `success`, e o log mostra `docker compose config` com código 0 e o build do `Dockerfile` concluído. Estaticamente, `grep -nE "docker push|push: *true|docker/login-action|packages: *write" .github/workflows/ci.yml` não encontra nada.

### CAs complementares (tornam verificáveis RNs e entregáveis da issue sem CA próprio)
- **CA-5** (RN-4; issue RN-4): Dado o `ci.yml`, quando inspecionado, então:
  - (a) todo `actions/setup-node` usa `node-version-file: .nvmrc`, sem `node-version` literal;
  - (b) `permissions` no nível do workflow é exatamente `contents: read`, e nenhum job amplia as permissões;
  - (c) `concurrency.group` inclui o ref (`github.ref` ou equivalente, por exemplo `github.head_ref || github.ref`) e `cancel-in-progress: true`;
  - (d) dados dois pushes seguidos na mesma branch de PR, quando o segundo run começa com o primeiro ainda em andamento, então o primeiro run termina `cancelled`.
  - Verificação: (a) a (c) por leitura ou `grep`. (d) pelo tester, com dois commits vazios (`git commit --allow-empty`) em sequência rápida na branch do PR principal ou numa descartável. Registrar os dois links, e o primeiro deve estar `cancelled`.
- **CA-6** (RN-5; entregável "Artefatos"): Dado qualquer run em que o job de testes chegou a executar `test:coverage`, passando ou falhando, quando ele termina, então existe um artefato de cobertura com `coverage-summary.json`, `lcov.info` e `index.html`. Dado qualquer run do job E2E, então existe o artefato `playwright-report`. Dado um run em que um teste E2E falha, então existe um artefato com o diretório `test-results/` contendo ao menos um `trace.zip`.
  - Verificação:
    - Cobertura e relatório: `gh run download <id>` no run verde do CA-1 e no run vermelho do CA-2 (o upload roda com `if: ${{ !cancelled() }}` ou `always()`), com `ls` dos arquivos.
    - Trace: num PR descartável, que pode ser o mesmo do CA-2 se o job E2E não depender do job de testes, ou outro, troque uma asserção de `e2e/smoke.spec.ts` para um valor errado. O job E2E deve falhar, e o artefato deve conter `trace.zip`. O PR é fechado sem merge. Registrar os links.
- **CA-7** (RN-2, RN-7, RN-10): Dado o job de testes, quando ele roda:
  - (a) o service usa a mesma `image` do service `postgres` do `docker-compose.yml`, comparação textual igual (`postgres:17`), com healthcheck `pg_isready`;
  - (b) o passo `npm run db:migrate:deploy` roda contra `DATABASE_URL`, antes de `test:coverage`, termina com código 0 e lista as migrações aplicadas, inclusive `20261118000100_reserva_exclusion`, o que prova o `btree_gist` disponível;
  - (c) `TEST_DATABASE_URL` aponta para uma base diferente da de `DATABASE_URL`, que existe antes do `test:coverage` e cujo nome tem no máximo 46 caracteres.
  - Verificação: (a) e (c) por leitura do `ci.yml`. (b) e (c) pelo log do run verde do CA-1: a saída do `prisma migrate deploy` e o `test:coverage` sem o erro de guarda que nomeia `TEST_DATABASE_URL`.
- **CA-8** (RN-6): Dado o `ci.yml`, quando inspecionado, então todo job de Node faz `npm ci` seguido de `npm run db:generate` antes do gate. No job de testes, a sequência é `npm ci → db:generate → migrate deploy → test:coverage`. Dado um gate que falha num passo, os passos seguintes do mesmo job não rodam (sem `continue-on-error`, salvo nos uploads de artefato), e o workflow fica vermelho.
  - Verificação: leitura do `ci.yml` (`grep -n "continue-on-error"` só pode achar passos de upload) e o run do CA-2, em que o workflow termina `failure`.
- **CA-9** (RN-3): Dado o `ci.yml`, quando inspecionado, então `grep -n "secrets\." .github/workflows/ci.yml` não encontra nada e nenhum `*_ADAPTER` é definido como `real`. Dado o run verde do CA-1, ele passou sem nenhum segredo configurado no repositório para a CI.
- **CA-10** (D-001/devops.md:37; RN-9): Dado o `ci.yml`, quando inspecionado, então os gatilhos são `pull_request` e `push` com `branches: [main]`, todo job tem `timeout-minutes`, e há cache do npm (`setup-node` com `cache: npm`) e dos navegadores do Playwright (cache de `~/.cache/ms-playwright` com chave na versão do `@playwright/test`, ou mecanismo equivalente).
  - Verificação: leitura do `ci.yml`. O gatilho `push` em `main` é comprovado **depois do merge** do PR principal, pelo link do run do evento `push` no SHA de merge. Esse registro fica a cargo do líder, no encerramento.
- **CA-11** (issue "Fora do escopo"): Dado o diff da demanda, quando comparado com `main`, então `git diff main -- .github/workflows/claude.yml .github/workflows/claude-code-review.yml` é vazio.
- **CA-12** (entregável de documentação; "Definição de pronto"):
  - O README tem a seção "CI" com: cada job, o comando local equivalente, os artefatos e onde baixá-los, "nenhum segredo necessário" e a pendência manual de proteção de branch (K-1).
  - O `CLAUDE.md` deixa de afirmar que não há CI.
  - Verificação: por leitura.
- **CA-13** ("Definição de pronto"): Dado o estado final da branch, quando se rodam localmente `npm ci && npm run db:generate`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:coverage` (com o PostgreSQL do compose) e `npm run test:e2e`, então todos terminam com código 0 e a cobertura de linhas fica em pelo menos 90%, com o `smoke-db.test.ts` incluído.

### Relação com o PLAN
- PLAN, critério de aceite 11 ("testes automatizados para isolamento entre salões, concorrência da agenda, permissões e eventos de assinatura"): a CI passa a executar esses testes em todo PR e todo push em `main`.
- PLAN, seção "Testes" ("Vitest … com PostgreSQL real; Playwright … em tela de celular"): CA-3, CA-7 e o job E2E no viewport 375×812.

## 6. Casos limite

- **Fuso horário e virada de dia:** não se aplicam ao workflow. O runner `ubuntu-latest` roda em UTC, e o Dockerfile já fixa `TZ=UTC`. Se algum teste depender de TZ local, ele falha na CI tanto quanto em UTC local. Suposição: não definir `TZ` no workflow, porque o padrão do runner (UTC) já é o ambiente-alvo. Se o arquiteto preferir explicitar, use `TZ: UTC`.
- **Concorrência:**
  - Entre runs do mesmo ref: o `concurrency` cancela o mais antigo (CA-5 d).
  - Dentro do job de testes: o harness cria uma base por worker (até 4) e um template por execução. Com o service exclusivo do job, não há colisão com outros runs, porque cada job tem o próprio container.
  - Os testes de concorrência (`tests/integration/concorrencia/`) rodam junto com o resto, já são determinísticos (CA-6 da D-005) e precisam de pelo menos 2 workers. O runner `ubuntu-latest` tem 4 vCPUs (S-5).
- **Push em `main` com `cancel-in-progress`:** dois merges seguidos cancelam o run do primeiro SHA de `main`. Isso foi decidido na issue (RN-4) e fica registrado como risco K-4, sem reabrir a decisão.
- **Isolamento entre salões, salão suspenso, cliente anonimizada, telefone inválido, permissões por perfil:** não se aplicam como regra desta demanda. A CI só executa os testes que os cobrem (D-005 e as demandas seguintes).
- **Ausência de `.env`:** a CI não cria `.env`. As variáveis vão em `env:` do job. O `vitest.config.ts` tolera a ausência (`ENOENT`), e o `docker compose config` também (`required: false`). Um `cp .env.example .env` na CI é aceitável, mas não é necessário. Se for usado, as variáveis do `env:` prevalecem.
- **Nome e existência das bases:** sem o initdb, a base que não for o `POSTGRES_DB` do service precisa ser criada num passo (por exemplo `psql`/`createdb` contra o service) antes do `migrate deploy` ou do `test:coverage`. Um nome com mais de 46 caracteres faz o harness falhar com uma mensagem que nomeia `TEST_DATABASE_URL`. Bases iguais disparam a guarda.
- **Papel sem `CREATEDB` ou não superusuário:** com o `POSTGRES_USER` da imagem oficial (superusuário), o caso `42501` do README não ocorre. Se o arquiteto optar por um papel restrito, nenhuma sessão de superusuário pode ficar aberta nas bases `_w<N>` durante o teste.
- **Cobertura no limite:** o limiar é `lines ≥ 90` (o Vitest reprova estritamente abaixo). O PR do CA-2 precisa ficar claramente abaixo (§1: ≥ 34 linhas, recomendado ≥ 50).
- **Falha antes da cobertura:** se `migrate deploy` ou o harness falharem, `coverage/` pode não existir. O upload não deve transformar a ausência em um erro que esconda a falha original (`if-no-files-found: warn` ou `ignore`). O CA-6 só exige o artefato quando o `test:coverage` chegou a rodar.
- **E2E instável:** com `retries: 2` na CI (`playwright.config.ts`), uma falha intermitente pode passar em silêncio. `trace: retain-on-failure` mantém o trace das tentativas que falharam. Mudar para `retries: 0` é da E4.4 (fronteira). Ver K-3.
- **Porta 3000 no job E2E:** com `CI=true`, `reuseExistingServer` é `false`. Se a porta estiver ocupada, o Playwright falha. O job E2E não pode subir o compose nem outro servidor na 3000.
- **PR de fork:** em `pull_request` vindo de fork, o `GITHUB_TOKEN` é somente leitura e não há segredos. A CI não depende de nenhum dos dois, então funciona igual.
- **Workflow do Claude nos PRs descartáveis:** o `claude-code-review.yml` também roda nos PRs do CA-2 e do CA-6 (custo e ruído, D-001 R2). É aceitável, e o resultado dele não conta como gate.

## 7. Dependências

- **Bloqueada por:** #4 (E0.2), mesclada. As D-004 e D-005 também já estão em `main` (`bc163e7`): migrações com `btree_gist` e o harness por worker.
- **Bloqueia:** #55 (E9.3).
- **Integrações** (Mercado Pago, WhatsApp, e-mail, Turnstile): não se aplicam. Todos ficam no modo simulado (padrão em `src/server/env.ts`).
- **Infraestrutura externa:**
  - GitHub Actions habilitado (verificado).
  - Runners `ubuntu-latest` com Docker e Compose v2 (pré-instalados) e minutos do plano para repositório privado (K-2).
  - Imagens `postgres:17` e `node:24-trixie-slim` vindas do Docker Hub.
  - Downloads do npm e dos navegadores do Playwright.
- **Ações do GitHub:** `actions/checkout`, `actions/setup-node`, `actions/cache` (ou o cache do setup-node) e `actions/upload-artifact`. O arquiteto ou o DevOps fixam a versão (major tag ou SHA). Hoje o repositório não exige pinning por SHA (`sha_pinning_required: false`).

## 8. Impactos prováveis

- **Dados:** nenhum. Não há migração nem mudança de schema. O `smoke-db.test.ts` só lê. O DBA pode ser dispensado (motivo: nenhuma mudança de dados, e o service usa a mesma imagem e as mesmas migrações). Os requisitos de banco da CI (RN-10) já foram definidos pelo DBA na D-005.
- **Infra/CI:** é o núcleo da demanda, e o responsável na issue é o **DevOps**.
  - Arquivo novo: `.github/workflows/ci.yml`.
  - Nenhuma mudança esperada em `Dockerfile`, `docker-compose.yml`, `.env.example`, `vitest.config.ts` ou `playwright.config.ts`. Se for preciso mudar algum deles, registre o motivo, sem reabrir RN-1 nem a fronteira com a E4.4.
- **Código e testes:** um arquivo novo, `tests/integration/smoke-db.test.ts`. Ele não afeta a cobertura de `src/` (só código de produção conta).
- **Documentação:** README (seção "CI") e `CLAUDE.md` (status e nota da CI).
- **Custo:** cada PR dispara cerca de 6 jobs. Ver K-2.

## 9. Dúvidas, suposições e riscos

### Bloqueantes
Nenhuma.

### Decisões tomadas (não bloqueantes), para o arquiteto confirmar
- **S-1, `smoke-db.test.ts` novo apesar do `health.test.ts`:** o arquivo é criado porque é entregável da issue e prova a conexão sem passar pela rota HTTP. Ele não substitui nem remove o `health.test.ts`.
- **S-2, jobs paralelos:** `lint`, `typecheck`, `build`, testes, `e2e` e `docker` podem rodar em paralelo, cada um com `npm ci` e `db:generate` (RN-6). A ordem da issue vale **dentro** de cada job. O arquiteto pode encadear jobs com `needs` (por exemplo, `e2e` depois de `build` para reaproveitar o `.next`), desde que todo gate continue com um check próprio no PR.
- **S-3, E2E sem recompilar:** a opção recomendada é baixar o `.next` gerado pelo job `build` (artefato) e rodar `npx playwright test`. A alternativa aceitável é `npm run test:e2e` no job E2E, compilando de novo, ao custo de cerca de 1 min. As duas atendem ao CA-1, e a decisão fica com o arquiteto ou o DevOps.
- **S-4, configs intocadas:** `retries: 2` e `trace: retain-on-failure` ficam como estão. Os traces são publicados quando existirem (CA-6). Mudar `retries` é da E4.4.
- **S-5, workers na CI:** `maxWorkers: 4` é mantido. O runner padrão comporta isso, e o orçamento de 72 conexões cabe no `max_connections` 100 do service.
- **S-6, bases na CI:** sugestão, a confirmar pelo DevOps: `POSTGRES_DB=agenda_beleza_test` no service (base administrativa, como sugere o README:71), mais um passo `createdb agenda_beleza` para a base de `DATABASE_URL`, usada pelo `migrate deploy`. O inverso também atende ao CA-7.
- **S-7, nomes dos checks:** como serão os nomes exigidos na proteção de branch, ficam fixos e documentados no README (CA-12).
- **S-8, verificação pós-merge:** o gatilho `push` em `main` (CA-10) só pode ser evidenciado depois do merge. O tester registra os CAs do PR, e o líder anexa o link do run de `push` ao encerrar.

### Riscos
| ID | Risco | Evidência | Impacto | Mitigação |
|---|---|---|---|---|
| K-1 | A proteção de branch e os rulesets não estão disponíveis: o repositório é privado num plano sem esse recurso | `gh api repos/{owner}/{repo}/branches/main/protection` e `…/rulesets` → 403 "Upgrade to GitHub Pro or make this repository public" | A pendência manual "exigir os checks em `main`" não pode ser cumprida no plano atual, e uma CI vermelha não impede o merge (D-001 R3) | Não é CA (issue). Registrar no README e no encerramento como pendência que **exige decisão do usuário**: (a) assinar GitHub Pro/Team, (b) tornar o repositório público ou (c) aceitar a disciplina manual (não mesclar com check vermelho). Não bloqueia a D-006 |
| K-2 | Minutos do Actions em repositório privado | `isPrivate: true` | Cerca de 6 jobs por PR, mais os PRs descartáveis e o workflow do Claude, consomem a cota mensal do plano | Cache do npm e do Playwright, `concurrency` com cancelamento e `timeout-minutes`. Acompanhar o uso. Se a cota estourar, os runs ficam em fila ou falham, o que é um bloqueio externo a ser levado ao usuário |
| K-3 | `retries: 2` na CI esconde instabilidade do E2E | `playwright.config.ts` | Um E2E instável passa sem ninguém ver | Os traces das tentativas falhas ficam no artefato. A E4.4 muda para `retries: 0` |
| K-4 | `cancel-in-progress` em `push` para `main` | issue RN-4 | Merges seguidos deixam SHAs intermediários de `main` sem run completo | Aceito pela issue. O último SHA sempre roda. Opção futura: cancelar só em `pull_request` |
| K-5 | Divergência futura entre a imagem do PG do compose e a da CI | RN-7 | "Passa local, falha na CI" (D-001 R11) | CA-7 (a) faz a comparação textual. O README registra que as duas mudam juntas |
| K-6 | Limiar do Vitest e versão da mensagem | Vitest 5.1.1 | O texto exato do erro de limiar pode variar | O CA-2 aceita o "texto equivalente" e se apoia na conclusão `failure` do job, com `lint`, `typecheck` e `build` verdes |
