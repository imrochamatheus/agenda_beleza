# D-006: Desenho da CI no GitHub Actions (issue #5, E0.3)

Autor: arquiteto-software. Entradas: `docs/demandas/D-006/spec.md` (RN-1..RN-11, CA-1..CA-13, S-1..S-8, K-1..K-6), `issue-5.md`, `CLAUDE.md` ("Comandos e cobertura", "Definição de pronto"), `docs/demandas/D-005/design.md` (harness), `docs/demandas/D-003/devops.md` (compose e initdb) e o código da branch `feat/d-006-ci` (base `bc163e7`).

Sonda executada antes do desenho (somente leitura):
- `package.json`, `vitest.config.ts`, `playwright.config.ts`, `docker-compose.yml`, `Dockerfile`, `.dockerignore`, `.env.example`, `tests/support/{global-setup,banco,db}.ts`, `tests/integration/health.test.ts`, `e2e/smoke.spec.ts` e o README (seção "Testes"). Confirmam o que a spec descreve em §1.
- Versões mais recentes das ações oficiais (`gh api repos/actions/<x>/releases/latest`, nov/2026): `checkout` v7.0.1, `setup-node` v7.1.0, `cache` v6.1.0, `upload-artifact` v7.0.2. Todas rodam em Node 24 e migraram para ESM. Nenhuma mudança quebra o uso previsto aqui. Desde a v6, o `setup-node` só faz cache automático para npm, e aqui o `cache: npm` é explícito.

## 1. Resumo da solução

Um único arquivo novo, `.github/workflows/ci.yml` (workflow `CI`), com **seis jobs independentes e paralelos** (`lint`, `typecheck`, `build`, `testes`, `e2e`, `docker`), sem `needs` entre eles. Cada job de Node faz `checkout → setup-node (.nvmrc, cache npm) → npm ci → npm run db:generate → gate`. O job `testes` tem um service `postgres:17`, cria a base administrativa de teste com `createdb` dentro do container do service, roda `npm run db:migrate:deploy` e depois `npm run test:coverage`, e publica `coverage/` como artefato. O job `e2e` instala o Chromium (com cache dos navegadores), roda `npm run test:e2e` e publica `playwright-report/` e `test-results/`. O job `docker` roda `docker compose config` e `docker build --target final`, sem push. Também entram o teste novo `tests/integration/smoke-db.test.ts` e a documentação (README, seção "CI"; `CLAUDE.md`).

Nada muda em `Dockerfile`, `docker-compose.yml`, `.env.example`, `vitest.config.ts`, `playwright.config.ts`, migrações ou `src/`.

### 1.1 Confirmação ou ajuste de S-1..S-8

| Item | Decisão | Justificativa |
|---|---|---|
| S-1 | **Confirmado.** O `smoke-db.test.ts` é novo e o `health.test.ts` continua igual. | É entregável da issue e prova a conexão sem passar pela camada HTTP. |
| S-2 | **Confirmado: seis jobs paralelos e nenhum `needs`.** | Cada gate tem check próprio e estável. O tempo total fica no ritmo do job mais lento (testes ou e2e), e uma falha num gate não esconde o resultado dos outros. Isso é essencial para o CA-2, que exige `lint`, `typecheck` e `build` verdes com `testes` vermelho. A ordem RN-6 vale dentro de cada job. |
| S-3 | **Ajustado: o job `e2e` roda `npm run test:e2e` e compila de novo.** Não reaproveita o `.next` do job `build`. | É a opção mais simples e robusta. (a) O job `e2e` não depende do `build`, então não serializa os jobs e o tempo total não cresce. (b) Não há transferência de artefato: o `.next` tem `cache/` grande, e o `upload-artifact` não preserva permissões nem links simbólicos, o que traria um risco sem ganho, porque subir e baixar o artefato custa quase o mesmo que o `next build`, cerca de 1 min. (c) O job roda exatamente o comando local da tabela do `CLAUDE.md`. (d) Dentro do job há uma única compilação, o que cumpre a nota "não compilar duas vezes". O custo é cerca de 1 min de runner por PR (K-2), aceitável. |
| S-4 | **Confirmado.** `retries: 2` e `trace: retain-on-failure` ficam como estão. | A mudança é da E4.4. |
| S-5 | **Confirmado.** `maxWorkers: 4` e o `max_connections` padrão (100) do service. | 72 conexões ≤ 100, e o service é exclusivo do job (não há app nem worker conectados). |
| S-6 | **Ajustado e invertido em relação à sugestão:** o service usa `POSTGRES_DB=agenda_beleza`, igual ao compose. Um passo cria `agenda_beleza_test` com `docker exec <service> createdb`. | Espelha o compose: a base de desenvolvimento é o `POSTGRES_DB`, e a de teste é criada à parte, como faz o initdb. O `createdb` roda **dentro** do container do service, com o binário da mesma versão do servidor, e não depende do cliente PostgreSQL do runner. O papel é o `POSTGRES_USER` (superusuário, logo tem `CREATEDB`), o que já atende a RN-10 sem papel restrito. |
| S-7 | **Confirmado.** Os nomes de check são os `name:` dos jobs: `lint`, `typecheck`, `build`, `testes`, `e2e` e `docker`. Na UI aparecem como `CI / <nome> (pull_request)` ou `(push)`. Eles ficam documentados no README e **não podem ser renomeados** sem atualizar o README (e a proteção, quando existir). | Proteção de branch futura (K-1). |
| S-8 | **Confirmado.** O tester registra os CAs do PR. O líder anexa o run de `push` em `main` depois do merge (T-6). | O gatilho `push` só existe depois do merge. |

### 1.2 K-4: `cancel-in-progress` em `main`

**Decisão: manter `cancel-in-progress: true` também em `main`, sem expressão condicional.**
- O texto da issue (RN-4) e o CA-5(c) pedem `cancel-in-progress: true`. Uma expressão como `${{ github.ref != 'refs/heads/main' }}` reabriria uma decisão da issue e tornaria o CA-5(c) ambíguo.
- Não há deploy nem publicação por SHA. O último SHA de `main` sempre roda e contém todos os anteriores, então um run cancelado num SHA intermediário não esconde regressão no estado atual.
- O repositório é privado e tem cota de minutos (K-2).
- Fica registrado como opção futura: se houver deploy por SHA (fora do escopo), trocar para cancelar só em `pull_request`.

### 1.3 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Um único job sequencial com todos os gates | O PR mostraria um só status, o que viola o CA-1. Além disso, uma falha precoce esconderia os demais gates, e o CA-2 deixaria de ser verificável. |
| `e2e` com `needs: build` e `.next` como artefato | Ver S-3. |
| Matrix para lint, typecheck e build | Nomes de check com sufixo de matrix ficam menos estáveis, e o ganho é nenhum. |
| Reusable workflow ou composite action para o "setup" comum | Seria um arquivo a mais e uma indireção para 4 linhas repetidas 5 vezes. Fica descartado até haver mais jobs (E0.7, E4.4). |
| `docker/build-push-action` com `push: false` e cache GHA | Acrescenta buildx, uma ação de terceiros e configuração de cache. O `docker build` puro atende ao CA-4. O cache de camadas não é exigido (RN-9 pede o do npm e o do Playwright). |
| `paths-ignore` (por exemplo, docs) | Um check exigido que não roda deixa o PR "pendente" para sempre quando a proteção existir. Além disso, a proteção da documentação também é gate (README). |
| `services:` com `POSTGRES_DB=agenda_beleza_test` mais `createdb agenda_beleza` | Equivale à escolhida. A escolhida espelha o compose (S-6). |
| `psql` ou `createdb` do runner | Depende do cliente instalado na imagem do runner (versão 16 no Ubuntu 24.04), e o `docker exec` no service elimina essa variável. |
| Pinning por SHA das ações | O repositório não exige (`sha_pinning_required: false`). Adotamos tags major das ações oficiais `actions/*`, que são do próprio GitHub. Fica como endurecimento futuro, se houver ação de terceiros. |
| `actionlint` como dependência do projeto | Não entra como dependência. O DevOps **pode** rodá-lo de forma descartável (`docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest`) antes do push, como verificação local sem rastro no repositório. É opcional, porque o run real é a prova. |

## 2. Componentes afetados

| Caminho | Mudança | Responsável |
|---|---|---|
| `.github/workflows/ci.yml` | **novo** | devops (T-2) |
| `tests/integration/smoke-db.test.ts` | **novo** | desenvolvedor (T-1) |
| `README.md` | nova seção `## CI` e ajuste do item "Privilégio" em "Banco de teste" | devops (T-3) |
| `CLAUDE.md` | frase de status da linha 7 e a nota "Na CI (E0.3)…" (linha 77) | devops (T-3) |
| `.github/workflows/claude.yml`, `claude-code-review.yml` | **intocados** (CA-11) | n/a |

Nenhuma rota, server action, worker, adaptador, tela ou repositório é alterado.

## 3. Interfaces

### 3.1 `.github/workflows/ci.yml` (contrato normativo)

O DevOps escreve o arquivo. A estrutura abaixo é o contrato: nomes, gatilhos, permissões, ordem dos passos, variáveis, artefatos e timeouts. Comentários, nomes de passos (`name:`) e detalhes de formatação ficam a critério do DevOps, desde que o contrato se mantenha.

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

env:
  NEXT_TELEMETRY_DISABLED: '1'
  TZ: UTC

jobs:
  lint:
    name: lint
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
        with: { persist-credentials: false }
      - uses: actions/setup-node@v7
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run db:generate
      - run: npm run lint

  typecheck:            # idem, gate: npm run typecheck; timeout-minutes: 10
  build:                # idem, gate: npm run build;     timeout-minutes: 15

  testes:
    name: testes
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:17          # RN-7: igual a docker-compose.yml (services.postgres.image)
        env:
          POSTGRES_USER: agenda
          POSTGRES_PASSWORD: agenda_dev
          POSTGRES_DB: agenda_beleza
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -h 127.0.0.1 -U agenda -d agenda_beleza"
          --health-interval 2s --health-timeout 5s --health-retries 30
    env:
      DATABASE_URL: postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza
      TEST_DATABASE_URL: postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza_test
    steps:
      - checkout / setup-node (iguais ao lint)
      - run: npm ci
      - run: npm run db:generate
      - name: Criar a base administrativa de teste
        run: docker exec "${{ job.services.postgres.id }}" createdb -U agenda agenda_beleza_test
      - run: npm run db:migrate:deploy
      - run: npm run test:coverage
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with:
          name: cobertura
          path: coverage/
          if-no-files-found: warn
          retention-days: 14

  e2e:
    name: e2e
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - checkout / setup-node (iguais ao lint)
      - run: npm ci
      - run: npm run db:generate
      - name: Versão do Playwright
        id: pw
        run: echo "versao=$(jq -r '.packages["node_modules/@playwright/test"].version' package-lock.json)" >> "$GITHUB_OUTPUT"
      - uses: actions/cache@v6
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ steps.pw.outputs.versao }}
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with: { name: playwright-report, path: playwright-report/, if-no-files-found: warn, retention-days: 14 }
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with: { name: playwright-traces, path: test-results/, if-no-files-found: ignore, retention-days: 14 }

  docker:
    name: docker
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
        with: { persist-credentials: false }
      - run: docker compose config
      - run: docker build --target final --tag agenda-beleza:ci .
```

Regras que o arquivo precisa cumprir (cada uma ligada a um CA):

| Regra | CA |
|---|---|
| Gatilhos são exatamente `pull_request`, com os tipos padrão, e `push` com `branches: [main]`. Sem `paths`/`paths-ignore`, sem `pull_request_target` e sem `workflow_dispatch` (este último é opcional e só pode entrar se o DevOps justificar; ele não muda nada nos CAs). | CA-10 |
| `permissions` no topo é exatamente `contents: read`, e **nenhum** job declara `permissions`. | CA-5(b) |
| `concurrency.group` contém `github.ref` (via `github.event.pull_request.number \|\| github.ref`) e `cancel-in-progress: true`. | CA-5(c) |
| Todo `actions/setup-node` usa `node-version-file: .nvmrc` e `cache: npm`, sem `node-version`. | CA-5(a), CA-10 |
| Todo job de Node: `npm ci` → `npm run db:generate` → gate. Nunca `npm install`, `--legacy-peer-deps` ou `--force`. | CA-8 |
| `continue-on-error` não aparece em nenhum passo. Os uploads usam `if: ${{ !cancelled() }}` e `if-no-files-found`, então não precisam dele. | CA-8 |
| Nenhum `secrets.` e nenhum `*_ADAPTER`: os adaptadores ficam no padrão `simulado` de `src/server/env.ts`. A senha `agenda_dev` é a de desenvolvimento do `.env.example`, num container efêmero do job, e não é segredo. | CA-9 |
| Sem `docker push`, `push: true`, `docker/login-action` ou `packages: write`. | CA-4 |
| Todo job tem `timeout-minutes`. | CA-10 |
| `image: postgres:17` textualmente igual ao `docker-compose.yml`. Um comentário no `ci.yml` aponta o compose, e o comentário no compose fica para quando ele for tocado (fora de escopo agora; o README registra). | CA-7(a), K-5 |
| `TEST_DATABASE_URL` (`agenda_beleza_test`, 18 caracteres) ≠ base de `DATABASE_URL` (`agenda_beleza`). | CA-7(c) |
| `persist-credentials: false` no checkout: nenhum passo usa o token do git depois do checkout. | endurecimento (RN-3) |

Notas de implementação:
- **Healthcheck:** o Actions espera o service ficar `healthy` antes do primeiro passo. `-h 127.0.0.1` força TCP, como no compose.
- **`docker exec` no service:** `job.services.postgres.id` é o ID do container. O `createdb` usa o socket local do container e o `POSTGRES_USER` (superusuário).
- **Playwright:** o `install --with-deps` roda sempre. Num cache hit, ele pula o download do Chromium e só instala as bibliotecas do sistema via apt (os runners hospedados têm sudo sem senha). A chave usa a versão exata do `@playwright/test` lida do lock, porque o `node -p "require('@playwright/test/package.json')"` pode esbarrar no `exports` do pacote.
- **Porta 3000 no `e2e`:** nenhum service e nenhum compose no job. Com `CI=true` (definido pelo Actions), o `webServer` sobe `npm run start`.
- **Sem `.env` na CI:** as variáveis vêm de `env:`. `vitest.config.ts` tolera `ENOENT`, e o compose declara `required: false`.
- **`TZ: UTC`:** fica explícito, embora seja o padrão do runner, para documentar o ambiente-alvo (igual ao `TZ=UTC` do Dockerfile).
- **Artefatos:** `cobertura` (`coverage/` com `coverage-summary.json`, `lcov.info`, `index.html`), `playwright-report` e `playwright-traces` (`test-results/`, que só existe com falha, por causa do `retain-on-failure`). Os nomes ficam estáveis e documentados no README. A retenção é de 14 dias, para limitar o armazenamento do plano privado (K-2).

### 3.2 `tests/integration/smoke-db.test.ts`

Contrato (CA-3):
- Usa `process.env.DATABASE_URL`, apontada pelo `setupFiles` do harness para a base do worker, e verifica de saída que ela é igual a `urlDoWorker()` (`tests/support/db.ts`). Nenhuma URL fixa.
- Abre **um** `pg.Client` (permitido em `tests/**` pela regra de lint), executa `SELECT 1 AS um` e verifica `rows[0].um === 1`.
- Executa `SELECT current_database()` e verifica que o resultado é igual a `nomeDoWorker()` e casa com `/_w\d{1,3}$/`. Isso prova que não é a base de desenvolvimento nem a administrativa.
- Fecha o cliente em `afterAll` (ou `finally`). Nenhuma escrita.
- Título do `describe` com "CA-3 da D-006", para facilitar o `grep` no log da CI.

## 4. Dados

Nenhuma entidade, campo, constraint, índice ou migração muda. O `smoke-db.test.ts` só lê.

**DBA dispensado.** Motivos:
- Não há mudança de schema nem de migração.
- Os requisitos de banco da CI (papel com `CREATEDB`, nome ≤ 46 caracteres, bases distintas, orçamento de 72 conexões contra `max_connections` 100) já foram definidos pelo DBA na D-005 (`docs/demandas/D-005/dba.md` §2.4) e são só aplicados aqui (RN-10).
- O service usa a mesma imagem e as mesmas migrações do compose (`btree_gist` no contrib da imagem oficial).

## 5. Infraestrutura

É o núcleo da demanda. O **DevOps é o responsável** (T-2, T-3, T-4).
- Variáveis de ambiente: só as do `env:` acima. Nenhuma variável nova no `.env.example` nem em `src/server/env.ts`.
- Containers: o service `postgres:17` no job `testes`. O `docker build` no job `docker`, com a imagem local descartada ao fim do job.
- CI: arquivo novo. `Dockerfile` e `docker-compose.yml` intocados.
- Observabilidade: o resumo do job (tabela `text` da cobertura no log) e os artefatos. Não se aplica telemetria de app.
- Custo (K-2): 6 jobs por PR, estimados em cerca de 20 a 25 min de runner por run, com cache. Os PRs descartáveis da validação (§8) são 2 a 3 runs extras, únicos.

## 6. Verificação das invariantes

| Invariante | Aplica-se? | Como |
|---|---|---|
| Escopo por salão no servidor | Indiretamente | A CI passa a rodar em todo PR os testes de isolamento (`tests/integration/tenant/isolamento.test.ts`, `db/isolamento-salao.test.ts`). Nenhum código de escopo muda. |
| Exclusion constraint anti-sobreposição | Indiretamente | O `migrate deploy` (CA-7(b)) e o template do harness aplicam `20261118000100_reserva_exclusion`, o que prova o `btree_gist` na imagem. `reserva-exclusion.test.ts` e `concorrencia/` rodam na CI. |
| UTC com o fuso do salão | Ambiente | Runner em UTC, com `TZ: UTC` explícito, igual ao Dockerfile. Sem mudança de código. |
| Adaptadores de integração | Sim | Nenhum `*_ADAPTER` é definido, então vale o padrão `simulado`. Sem `secrets.` (CA-9). |
| Soft deletes e anonimização | Não | Nenhum código de domínio é tocado. |
| Salão suspenso somente leitura | Não | Idem. |
| Idempotência de webhooks e mensagens | Não | Idem. Fila e worker ficam na E0.7. |
| Auditoria do super admin | Não | Idem. |
| Sem dados de cartão e sem segredos | Sim | A CI não recebe nenhuma credencial. `permissions: contents: read` e `persist-credentials: false`. |

## 7. Riscos e decisões

| ID | Risco ou decisão | Mitigação |
|---|---|---|
| K-1 | Proteção de `main` e rulesets indisponíveis (403, repositório privado sem Pro). Um check vermelho não impede o merge. | **Fora dos CAs: é decisão do usuário**, que o líder leva no encerramento (T-6). As opções são (a) assinar GitHub Pro/Team e exigir os 6 checks, (b) tornar o repositório público ou (c) disciplina manual: nunca mesclar com check vermelho. O README (seção "CI") lista os 6 nomes de check a exigir e registra a pendência. Não bloqueia a D-006. |
| K-2 | Cota de minutos do plano privado. | Cache do npm e do Playwright, `concurrency` com cancelamento, `timeout-minutes`, retenção de 14 dias e PRs descartáveis combinados (§8: um só PR para CA-2, CA-6 e CA-5(d)). Se a cota estourar, é bloqueio externo e vai ao usuário. |
| K-3 | `retries: 2` esconde instabilidade do E2E. | Os traces das tentativas falhas ficam em `playwright-traces`. A troca para `retries: 0` é da E4.4. |
| K-4 | `cancel-in-progress` em `main`. | Mantido (§1.2). |
| K-5 | Imagem do PG da CI diverge do compose. | Comparação textual no CA-7(a), comentário no `ci.yml` e nota no README: "mudar uma exige mudar a outra". |
| K-6 | Texto da mensagem de limiar do Vitest 5.1.1. | O CA-2 se apoia na conclusão `failure` do job `testes`, com os outros três gates verdes, e num `grep -i "threshold"` no log. |
| K-7 (novo) | O Docker Hub limita pulls anônimos (`postgres:17`, `node:24-trixie-slim`). | Os runners hospedados do GitHub têm um acordo de limite elevado com o Docker Hub. Se ocorrer `toomanyrequests`, é falha transitória: reexecutar o job. Login no Docker Hub exigiria segredo, e por isso fica descartado (RN-3). |
| K-8 (novo) | O `upload-artifact@v7` exclui arquivos ocultos por padrão. | Nenhum dos diretórios publicados depende de arquivos ocultos (relatórios HTML, `lcov.info`, `trace.zip`). O tester verifica no CA-6. |
| K-9 (novo) | Nomes de check acoplados ao `name:` dos jobs. | Ficam fixos (S-7). Renomear exige atualizar o README e, no futuro, a proteção. |

## 8. Estratégia de testes e plano de validação real

### 8.1 Testes automatizados
- **Unidade:** nada novo. O `ci.yml` não é código de produção.
- **Integração (PostgreSQL real):** `tests/integration/smoke-db.test.ts` (CA-3). Toda a suíte existente roda na CI (CA-1 e CA-7).
- **Playwright:** `e2e/smoke.spec.ts` existente, sem mudança (CA-1). A versão "quebrada" só existe no PR descartável (CA-6).
- **Cobertura ≥ 90%:** a única mudança de código fica em `tests/`, fora do `coverage.include`. A métrica de `src/` não se altera (hoje 100%, 297 de 297 linhas). O gate é o próprio `npm run test:coverage` (RN-1).

### 8.2 Execução real (quem, como e limpeza)

Pushes e PRs exigem a autorização do usuário, obtida pelo líder antes de T-4. Nenhum agente faz merge.

**V-1, PR principal (DevOps, T-4):** a branch `feat/d-006-ci` é publicada e um PR para `main` é aberto. Itere até os 6 checks ficarem `pass` no último SHA. Cubra com o mesmo PR CA-1, CA-3, CA-4, CA-7(b,c), CA-9 (run verde sem segredos) e o artefato de cobertura e de relatório do CA-6. O DevOps entrega ao tester o número do PR e o ID do run verde.

**V-2, PR descartável único para CA-2, CA-6 (trace) e CA-5(d) (tester, T-5):** os jobs são independentes, então um só PR cobre os três e economiza minutos (K-2).
1. `git switch -c tmp/d-006-validacao feat/d-006-ci`.
2. Commit A, com duas mudanças:
   - (CA-2) `src/lib/descartavel-ca2.ts` com ≥ 50 linhas executáveis, sem teste, sem `eslint-disable` e sem erro de tipo, por exemplo uma função exportada com 50 atribuições ou `if`s simples;
   - (CA-6) em `e2e/smoke.spec.ts`, trocar `toHaveTitle('Agenda Beleza')` por um valor errado.
   
   Antes do push, confirme localmente `npm run lint` e `npm run typecheck` (o gate não pode reprovar por outro motivo).
3. Push e `gh pr create --base main --head tmp/d-006-validacao --draft --title "[DESCARTÁVEL] D-006 validação CA-2/CA-5/CA-6 — não mesclar"`.
4. Esperar o run R1 terminar. Evidências esperadas:
   - `testes` = `failure`, com a mensagem de limiar (< 90%) no log;
   - `lint`, `typecheck`, `build` e `docker` = `success`;
   - `e2e` = `failure`.
   
   Baixe os artefatos **fora do repositório**: `gh run download <R1> -D <scratchpad>/r1`. `cobertura` precisa ter `coverage-summary.json`, `lcov.info` e `index.html` (run vermelho), e `playwright-traces` precisa ter pelo menos um `trace.zip`.
5. (CA-5(d)) `git commit --allow-empty -m c1 && git push`, e de 20 a 40 s depois, com o run de c1 em andamento, `git commit --allow-empty -m c2 && git push`. O run de c1 precisa terminar `cancelled`. O run de c2 pode ser cancelado manualmente (`gh run cancel`) assim que a evidência for registrada, para poupar minutos.
6. Limpeza:
   - `gh pr close <n> --delete-branch`;
   - `git switch feat/d-006-ci && git branch -D tmp/d-006-validacao`;
   - confirmar `gh pr view <n> --json state,mergedAt` → `CLOSED`/`null` e que `git ls-remote --heads origin 'tmp/d-006-*'` está vazio.
   
   Nada do PR descartável entra em `feat/d-006-ci` nem em `main` (RN-11).

**V-3, verificação estática (tester, T-5):** CA-4 (grep de push e login), CA-5(a–c), CA-8 (`grep -n continue-on-error` vazio), CA-9 (`grep -n "secrets\."` vazio e nenhum `_ADAPTER`), CA-10 (gatilhos, timeouts e caches), CA-11 (`git diff main -- .github/workflows/claude*.yml` vazio), CA-12 (leitura) e CA-13 (gates locais).

**V-4, run de `push` em `main` (líder, T-6):** depois do merge, registre o link do run do evento `push` no SHA de merge (CA-10, S-8).

Toda evidência vai para `docs/demandas/D-006/testes.md` no formato da spec §5 (URL, SHA, evento, `gh run view <id> --json jobs --jq '.jobs[]|{name,conclusion}'` e trecho de log).

### 8.3 Mapa CA → tarefa → verificação

| CA | Tarefa(s) | Tipo de verificação |
|---|---|---|
| CA-1 | T-2, T-4, T-5 | run real V-1 |
| CA-2 | T-2, T-5 | run real V-2 (PR descartável) |
| CA-3 | T-1, T-4, T-5 | integração (PG real), local e na CI |
| CA-4 | T-2, T-4, T-5 | run real V-1 e grep estático |
| CA-5 | T-2, T-5 | estático (a–c) e run real V-2 passo 5 (d) |
| CA-6 | T-2, T-4, T-5 | artefatos de V-1 e de V-2 |
| CA-7 | T-2, T-4, T-5 | estático (a, c) e log do V-1 (b, c) |
| CA-8 | T-2, T-5 | estático e V-2 (workflow `failure`) |
| CA-9 | T-2, T-5 | estático e V-1 |
| CA-10 | T-2, T-5, T-6 | estático e run de `push` pós-merge |
| CA-11 | T-2, T-5 | `git diff` |
| CA-12 | T-3, T-5 | leitura |
| CA-13 | T-1..T-4, T-5 | gates locais |

## 9. Tarefas

| ID | Responsável | Depende de | Paralela com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | desenvolvedor | n/a | T-2, T-3 | `tests/integration/smoke-db.test.ts` |
| T-2 | devops | n/a | T-1, T-3 | `.github/workflows/ci.yml` |
| T-3 | devops | n/a (usa os nomes fixados em §3.1) | T-1, T-2 | `README.md`, `CLAUDE.md` |
| T-4 | devops | T-1, T-2, T-3; autorização do usuário para push e PR | n/a | `docs/demandas/D-006/devops.md`. Correções voltam ao dono do arquivo |
| T-5 | tester | T-4 | n/a | `docs/demandas/D-006/testes.md`; branch descartável `tmp/d-006-validacao` (nunca mesclada) |
| T-6 | líder | T-5 APROVADO; merge autorizado pelo usuário | n/a | registro do encerramento (link do run de `push`; decisão K-1) |

T-2 e T-3 são do mesmo papel, mas os arquivos são distintos, e o DevOps pode executá-las em sequência numa mesma sessão.

**T-1, smoke de banco (desenvolvedor).**
- Entregável: `tests/integration/smoke-db.test.ts` conforme §3.2.
- Critério de conclusão:
  - `npx vitest run --project integration tests/integration/smoke-db.test.ts` passa com o PostgreSQL do compose;
  - `npm run lint` e `npm run typecheck` passam;
  - `npm run test:coverage` continua ≥ 90%;
  - registrar em `docs/demandas/D-006/dev.md`.

**T-2, workflow (devops).**
- Entregável: `.github/workflows/ci.yml` conforme §3.1 e as regras da tabela.
- Critério de conclusão:
  - YAML válido (opcional: `actionlint` descartável via Docker, sem rastro no repositório);
  - os greps estáticos de CA-4, CA-5(a–c), CA-8, CA-9 e CA-10 passam;
  - `git diff main -- .github/workflows/claude*.yml` vazio;
  - localmente, `docker compose config` (sem `.env`) e `docker build --target final .` passam.

**T-3, documentação (devops).**
- Entregável:
  - README, nova seção `## CI` depois de "Testes". Ela traz:
    - tabela job → comando local equivalente → artefato;
    - os 6 nomes de check (`lint`, `typecheck`, `build`, `testes`, `e2e`, `docker`) e a regra de que não se renomeiam;
    - como baixar artefatos (aba Summary do run ou `gh run download <id>`);
    - "nenhum segredo necessário" (adaptadores simulados);
    - `postgres:17` igual ao compose ("mudar um exige mudar o outro");
    - a pendência K-1, com as três opções.
  - README, "Banco de teste": o item "Privilégio" passa a dizer que, na CI, o papel é o `POSTGRES_USER` do service (superusuário) e que a base de teste é criada por `createdb` no container do service.
  - `CLAUDE.md`, linha 7: "There is no queue or CI yet (E0.3, E0.7)" passa a mencionar que a D-006 (E0.3) adicionou `.github/workflows/ci.yml` e que a fila continua pendente (E0.7).
  - `CLAUDE.md`, linha 77: passa a dizer que a CI roda `npm run test:e2e` no job `e2e` (uma compilação no job), depois de `npx playwright install --with-deps chromium`, com cache dos navegadores.
  - O texto "A CI executa o mesmo comando" segue válido.
- Critério de conclusão: CA-12 verificável por leitura. Nenhuma outra seção alterada.

**T-4, gates locais e PR principal verde (devops).**
- Entregável:
  - `docs/demandas/D-006/devops.md` com a saída dos gates locais do CA-13 (`npm ci && npm run db:generate`, `lint`, `typecheck`, `build`, `test:coverage` com o PG do compose, `test:e2e`);
  - o PR `feat/d-006-ci` → `main` aberto;
  - o ID do run verde e `gh pr checks <n>` com os 6 checks `pass`.
- Critério de conclusão: run verde no último SHA. Os artefatos `cobertura` e `playwright-report` estão presentes no run. Se algum job falhar, o DevOps corrige o `ci.yml`, ou devolve ao desenvolvedor se o problema for o `smoke-db`, e reexecuta. A mesma classe de falha repetida volta ao arquiteto.

**T-5, validação independente (tester).**
- Entregável: `docs/demandas/D-006/testes.md` com V-1 (conferência do run do DevOps), V-2, V-3 e o veredito.
- Critério de conclusão:
  - CA-1..CA-9 e CA-11..CA-13 com evidência, e CA-10 com a parte estática (o `push` fica para T-6);
  - PR descartável fechado sem merge e branch apagada (local e remota);
  - artefatos baixados só no scratchpad.

**T-6, encerramento (líder).**
- Registrar o run de `push` em `main` depois do merge (CA-10, S-8).
- Levar ao usuário a decisão K-1 (a, b ou c). Ela não bloqueia o encerramento.

## 10. Pendências
- **K-1:** decisão do usuário sobre a proteção de `main`, fora dos CAs (T-6).
- Autorização do usuário para push, PRs (principal e descartável) e merge. Ela é pré-requisito de T-4, T-5 e T-6, e cabe ao líder obtê-la.
- Nenhuma dúvida bloqueante de desenho.
