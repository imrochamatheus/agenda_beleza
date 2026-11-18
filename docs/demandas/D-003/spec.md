# D-003 — Spec: subir app, worker e PostgreSQL com docker-compose e documentar variáveis em `.env.example` (issue #4, E0.2)

Fontes: `docs/demandas/D-003/issue-4.md` (base, já aprovada), `docs/demandas/D-001/spec.md` (ITEM E0.2, E0.3, E0.4, E0.6, E0.7, convenções G-1..G-4 e "Gate padrão"), `docs/demandas/D-001/design.md` (JSON, chave `E0.2`), `docs/demandas/D-001/devops.md` (§1 "E0.2", ajustes 1–10, riscos R8, R9 e R11), `PLAN.md` (linhas 7, 125 e 147), `CLAUDE.md` ("Required stack" e "Comandos e cobertura") e o estado da branch `feat/d-003-docker-compose` (empilhada sobre `feat/d-002-scaffolding`).

Os CA-1..CA-5 da issue estão preservados com a numeração original. Os CA-6..CA-10 detalham o que o escopo e os entregáveis da issue já exigem, mas que os CAs originais não cobrem de forma verificável. Nenhuma decisão aprovada foi reaberta.

## 1. Problema

Hoje não é possível rodar o produto com containers, e não existe banco, Prisma, worker nem documentação de variáveis. Evidências (somente leitura, nesta branch):

- Não existem `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `docker/`, `prisma/`, `.env.example`, `src/server/` nem `src/worker/` (`ls -a` na raiz; `ls -R src` mostra só `src/app` e `src/lib`).
- `package.json` não tem `prisma`, `@prisma/client`, `zod` (só aparece como dependência transitiva em `node_modules/zod`), nem scripts `worker` ou `db:*`.
- `README.md` contém só `# agenda_beleza`.
- `tests/integration/` está vazio, e `vitest.config.ts` usa `passWithNoTests: true` (comentário: "enquanto não houver testes de banco (RN-6)").
- `.gitignore` já ignora `.env` e `.env*.local` e mantém `.env.example` versionável. Ainda não ignora a saída do cliente Prisma.
- `eslint.config.mjs` (`globalIgnores`) e `vitest.config.ts` (`coverage.exclude`) ainda não excluem o cliente Prisma gerado.
- `CLAUDE.md`, "Comandos e cobertura", linha "Migrações": "ainda não existem; chegam com o Prisma (E0.2) e o esquema (E0.4)".
- Ambiente: Docker 29.8.1 e Compose v5.5.1. As portas 3000 e 5432 estão livres no host (`ss -ltn`). O `.nvmrc` contém `24`.

## 2. Objetivo

Quem clona o repositório consegue, com `cp .env.example .env` e `docker compose up -d --wait`, subir o PostgreSQL, a aplicação Next.js (com as migrações aplicadas) e um worker separado, sem nenhuma credencial real. Toda variável de ambiente fica documentada e validada. Esta é a base que E0.3 (CI), E0.4 (esquema), E0.6 (adaptadores) e E0.7 (fila) vão estender.

## 3. Escopo

### Entra
1. `Dockerfile` multi-stage único, usado por app e worker: imagem final não root, `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, `TZ=UTC`, Node da mesma major do `.nvmrc` (24). O estágio de build gera o cliente Prisma, faz o `next build` e compila o worker para JS (`dist/worker/main.js` é a sugestão do devops). A imagem final contém o CLI do Prisma, `prisma/` (incluindo `migrations/`, mesmo vazio) e `prisma.config.ts`.
2. `.dockerignore`: no mínimo `.env`, `.env*.local`, `node_modules`, `.next`, `coverage`, `playwright-report`, `test-results`, `.git` e a saída do cliente gerado. É requisito de RN-3: nenhum `.env` local entra na imagem.
3. `docker-compose.yml` com exatamente três serviços:
   - `postgres`: imagem oficial com major fixa ≥ 16 (RN-4), volume nomeado, healthcheck com `pg_isready` e porta `${POSTGRES_PORT:-5432}:5432`.
   - `app`: `depends_on: postgres: condition: service_healthy`; healthcheck em `GET /api/health`; porta 3000; `init: true`; `DATABASE_URL` sobrescrita em `environment:` com o host `postgres`.
   - `worker`: mesma imagem; `depends_on: app: condition: service_healthy`; `init: true`; mesma sobrescrita de `DATABASE_URL`; sem porta publicada e sem healthcheck (E0.7: "O worker não expõe HTTP").
4. `docker/entrypoint.sh`: valida o ambiente (`check-env`), executa `prisma migrate deploy` **só** no papel `app` e termina com `exec node …`. O `CMD` nunca é `npm run …`.
5. Bootstrap do Prisma:
   - `prisma/schema.prisma` só com `datasource` e `generator`, sem nenhum `model`;
   - `prisma.config.ts`;
   - script `db:generate`;
   - script de migração para uso local (sugestão: `db:migrate:deploy`);
   - saída do cliente gerado (sugestão do devops: `src/generated/prisma`) no `.gitignore`, no `globalIgnores` do ESLint e no `coverage.exclude` do Vitest, cada uma com comentário.
6. `GET /api/health` (Route Handler do App Router): executa `SELECT 1` no banco e responde 200 com o banco acessível ou 503 sem ele, sem autenticação.
7. `src/server/env.ts`: schema zod do ambiente e uma função de validação chamada na inicialização (RN-6).
8. Stub `src/worker/main.ts`: valida o ambiente, registra um heartbeat periódico em log e encerra com código 0 ao receber SIGTERM ou SIGINT. Script npm `worker`. Será substituído em E0.7.
9. `.env.example` comentado (RN-1, RN-5).
10. Teste unitário que compara as chaves do `.env.example` com as declaradas em `src/server/env.ts` (CA-3).
11. Testes do health (CA-5 e CA-9) e do `check-env` (CA-6).
12. `README.md` inicial com as seções "Executar com Docker" e "Testes".
13. `CLAUDE.md`, "Comandos e cobertura": atualizar a tabela com os comandos novos (Docker, `db:generate`, migrações, worker e pré-requisito de PostgreSQL para os testes de integração). Isso segue a regra do próprio `CLAUDE.md` ("Keep them up to date when you add scripts").

### Fica fora
- Publicação em VPS, proxy reverso, TLS, push de imagem e registry (issue, "Fora do escopo"; PLAN.md:147).
- Qualquer `model`, migração SQL, `CREATE EXTENSION btree_gist` ou constraint: ficam para a **E0.4**. A E0.2 não cria nenhuma migração.
- pg-boss, handlers, retry, `stop_grace_period` e encerramento gracioso de jobs: ficam para a **E0.7**. O stub só precisa sair limpo com SIGTERM.
- Portas e adaptadores, regras condicionais "modo real exige credencial X" e variáveis de credenciais (`SMTP_*`, `EMAIL_FROM`, `TURNSTILE_*`, Mercado Pago e WhatsApp): ficam para **E0.6**, **E6.6** e **E7.2**. Cada item acrescenta suas variáveis ao `env.ts` e ao `.env.example`, e o teste de CA-3 garante que os dois continuem iguais.
- Workflow de CI: fica para a **E0.3**, que apenas reutiliza a major do Postgres fixada aqui.
- Seed (`prisma/seed.ts`): fica para a **E9.2**.
- README completo, com credenciais reais por serviço: fica para a **E9.3**.
- Confronto com "Fora da primeira versão" do `PLAN.md`: nada desta demanda toca essas funcionalidades.

### Limite com E0.4 e E0.7 (pedido do líder)
| Tema | E0.2 (esta demanda) | E0.4 | E0.7 |
|---|---|---|---|
| Prisma | dependências, `schema.prisma` sem models, `prisma.config.ts`, `db:generate`, cliente gerado excluído, `migrate deploy` no entrypoint do app (sem migrações a aplicar) | models, primeira migração, SQL bruto (`btree_gist`, exclusion, CHECKs, trigger) | uso do banco pelo pg-boss no schema `pgboss` |
| Worker | processo separado, compilado para JS, check-env, heartbeat, saída 0 no SIGTERM | — | pg-boss, handlers, retry por env, `stop({ graceful })`, `stop_grace_period` |
| Banco nos testes | conexão real em `TEST_DATABASE_URL` para o health | estratégia de banco por teste (template por worker do Vitest, com DBA em E0.5) | — |

## 4. Regras de negócio

- **RN-1** (issue RN-1): por padrão, o `.env.example` seleciona os adaptadores simulados (`EMAIL_ADAPTER`, `WHATSAPP_ADAPTER`, `MP_ADAPTER`, `TURNSTILE_ADAPTER`, com valores `simulado|real` e padrão `simulado`, nomes da E0.6 e de `devops.md` §1). O projeto sobe sem nenhuma credencial real.
- **RN-2** (issue RN-2): o app espera o postgres ficar saudável e então aplica as migrações. O worker só sobe com o app saudável. Reiniciar sem apagar o volume não gera erro de migração.
- **RN-3** (issue RN-3; CLAUDE.md): nenhum segredo real é versionado nem copiado para a imagem. As credenciais do Postgres no `.env.example` são valores de desenvolvimento, marcados como tais em comentário.
- **RN-4** (issue RN-4; devops ajuste 8): o Postgres usa uma tag com major fixa, sem `latest` nem faixa. A E0.3 usa a mesma tag.
- **RN-5** (issue, escopo; devops ajustes 5, 6 e 7): o `.env.example` declara, além dos seletores, pelo menos:
  - `DATABASE_URL`, apontando para `localhost:${POSTGRES_PORT}` (o compose a sobrescreve com o host `postgres`);
  - `TEST_DATABASE_URL`, com uma base **diferente** da de desenvolvimento;
  - `APP_URL`, com padrão `http://localhost:3000`;
  - `POSTGRES_PORT`;
  - as variáveis da imagem oficial usadas pelo compose (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`).
- **RN-6** (E0.6 RN-5 e CA-6; devops §1 E0.6): a validação do ambiente roda na inicialização (entrypoint do app e início do worker), nunca no import de módulo nem no `next build`. O `docker build` e o `npm run build` funcionam sem `.env`. Variável obrigatória ausente ou inválida faz o processo sair com código ≠ 0, e a mensagem nomeia a variável.
- **RN-7** (devops ajuste 1; risco R8): só o app executa `prisma migrate deploy`. O worker nunca migra.
- **RN-8** (devops ajuste 2): o processo final de app e worker é o PID-alvo dos sinais (`exec` e `init: true`). O stub do worker encerra com código 0 em SIGTERM.
- **RN-9** (devops ajuste 6; risco R9): testes de integração usam só `TEST_DATABASE_URL`, nunca `DATABASE_URL`.
- **RN-10** (issue, escopo): `GET /api/health` não exige autenticação e não expõe detalhes do erro (mensagem, host, credenciais) no corpo da resposta 503.

## 5. Critérios de aceitação

Todos os CAs servem ao CA 11 do `PLAN.md` ("projeto inicia pelo README…"; mapeamento E0.2 em `D-001/spec.md`:32). Pré-condição comum dos CAs manuais: clone limpo da branch, Docker disponível, portas 3000 e `POSTGRES_PORT` livres. O tester registra comandos e saídas em `testes.md`.

**Da issue (inalterados na intenção; detalhes de verificação acrescentados):**

- **CA-1:** Dado `cp .env.example .env` sem alterações, quando se executa `docker compose up -d --wait`, então o comando termina com código 0, `docker compose ps` mostra postgres e app como `healthy` e o worker como `running`, e `curl -fsS localhost:3000/` responde 200. *(Manual.)*
- **CA-2:** Dado o compose em execução, quando se inspecionam os containers, então o worker roda em container separado do app e nenhum dos dois roda como root. *(Manual: `docker compose ps` lista dois containers distintos; `docker compose exec app id -u` e `docker compose exec worker id -u` retornam valor ≠ 0; `docker compose top worker` mostra o processo Node do worker, e não o `next start`.)*
- **CA-3:** Dado `src/server/env.ts` e `.env.example`, quando o teste unitário compara as chaves dos dois, então elas coincidem. *(Automatizado. O teste falha listando as chaves sobrando ou faltando em cada lado. As chaves usadas só pelo compose ou pelos testes, como `POSTGRES_*` e `TEST_DATABASE_URL`, também precisam estar declaradas no `env.ts`, ver suposição S-3.)*
- **CA-4:** Dado o compose em execução, quando se executa `docker compose down` e depois `docker compose up -d --wait` (sem `-v`), então tudo sobe sem erro de migração. *(Manual: código 0, mesmos estados do CA-1 e nenhuma linha de erro do Prisma em `docker compose logs app`.)*
- **CA-5:** Dado o postgres indisponível, quando se chama `GET /api/health`, então a resposta é 503. *(Automatizado: o handler aponta para um endereço sem PostgreSQL ouvindo, como uma porta fechada em `127.0.0.1`. É uma conexão real que falha, não um mock de banco. A resposta chega em até 5 s. Verificação manual complementar: `docker compose stop postgres` faz `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/health` imprimir `503`.)*

**Complementares (derivados do escopo e dos entregáveis da issue):**

- **CA-6** (caso limite da issue; RN-6): Dada a ausência de `DATABASE_URL`, ou um `APP_URL` que não é URL, quando a validação de inicialização roda, então ela falha e a mensagem contém o nome da variável. Dado o `.env.example` sem alterações, a validação passa. *(Automatizado, unitário.)*
- **CA-7** (RN-6; E0.6 CA-6): Dado um ambiente sem `.env` nem `DATABASE_URL`, quando se executam `npm run db:generate`, `npm run build` e `docker compose build`, então os três terminam com código 0. *(Manual.)*
- **CA-8** (RN-7): Dado o compose recém-subido (CA-1), quando se leem os logs, então só `docker compose logs app` contém a execução do `prisma migrate deploy`; `docker compose logs worker` não contém, e mostra pelo menos uma linha de heartbeat. *(Manual.)*
- **CA-9** (escopo: "executa `SELECT 1`"): Dado um PostgreSQL acessível em `TEST_DATABASE_URL`, quando se chama o handler de `GET /api/health`, então a resposta é 200. *(Automatizado, projeto `integration`, banco real.)*
- **CA-10** (RN-8): Dado o compose em execução, quando se executa `docker compose stop worker`, então o container sai com código 0 (`docker inspect -f '{{.State.ExitCode}}'` retorna `0`, e não 137) em menos de 10 s, o timeout padrão do compose. *(Manual.)*

**Gate padrão:** cobertura global de linhas ≥ 90% em `npm run test:coverage` (unidade e integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester. O stub do worker e o health contam para a cobertura. O desenho deve separar a lógica testável (heartbeat, tratamento de sinal, validação) do ponto de entrada.

## 6. Casos limite

- **Porta 5432 ocupada no host:** `POSTGRES_PORT=5433` no `.env` faz o compose publicar na 5433, e `DATABASE_URL`/`TEST_DATABASE_URL` locais devem usar a mesma porta. Dentro da rede do compose, a porta continua 5432. Documentar no README.
- **Porta 3000 ocupada:** fora do escopo. A porta fica fixa em 3000 (suposição S-6) e o README avisa para liberá-la.
- **Variável obrigatória ausente ou inválida:** CA-6. No container, o app ou o worker sai com código ≠ 0 e nomeia a variável (o comportamento por adaptador é da E0.6).
- **Primeira subida com volume vazio:** `migrate deploy` sem nenhuma migração em `prisma/migrations` deve terminar com código 0. Se a versão do Prisma adotada falhar com o diretório ausente, versionar `prisma/migrations/` vazio (por exemplo, com `.gitkeep`). O arquiteto confere e registra.
- **Reinício sem `-v`:** CA-4. Quando a E0.4 trouxer migrações, a mesma garantia continua valendo, porque o `migrate deploy` é idempotente.
- **Postgres cai com o app no ar:** o health passa a 503, e o compose marca o app como `unhealthy`. O worker já iniciado não é derrubado por isso: `depends_on` só vale na subida.
- **Base de teste inexistente:** a imagem oficial só cria `POSTGRES_DB`. A base de `TEST_DATABASE_URL` precisa ser criada por um script em `/docker-entrypoint-initdb.d`, que só roda com volume vazio, ou por um passo documentado. Com volume já existente, o README indica o comando para criá-la.
- **Testes de integração sem banco:** o `npm test` passa a precisar de um PostgreSQL acessível em `TEST_DATABASE_URL`. Sem ele, o teste de CA-9 falha com uma mensagem que nomeia a variável ou o host. Não pode passar em silêncio nem ser pulado (S-5).
- **Caminho com espaço e acento:** o repositório local está em `Área de Trabalho`. Scripts npm, entrypoint e configs devem funcionar nesse caminho (CLAUDE.md: "Os comandos funcionam em caminhos com espaço e acento").
- **SIGTERM durante a migração:** o app sai com código ≠ 0, e a próxima subida reaplica a migração. Não exige teste.
- **Fuso:** o container roda com `TZ=UTC`. Nenhum código desta demanda depende de fuso de salão.
- **Isolamento entre salões, salão suspenso, cliente anonimizada, telefone, perfis:** não se aplicam. Não há entidades de tenant, autenticação nem dados de negócio nesta demanda, e o health é público por definição (RN-10).
- **Concorrência:** não há corrida de migração, porque só o app migra (RN-7).

## 7. Dependências

- **Bloqueada por:** E0.1 (#3), implementada no PR #57, ainda aberto. Esta branch está empilhada sobre `feat/d-002-scaffolding`, então um ajuste no PR #57 pode exigir rebase.
- **Bloqueia:** E0.3 (#5), que reutiliza a tag do Postgres, `db:generate` e `migrate deploy`, e E0.4 (#6), que preenche o `schema.prisma`.
- **Integrações:** nenhuma chamada real. Só os seletores de adaptador entram no `.env.example`.
- **Infraestrutura:** Docker 29.8.1 e Compose v5.5.1, já disponíveis. É preciso baixar as imagens `node:24-*` e `postgres:<major>` (acesso à rede durante o build).
- **Novas dependências npm** (versões exatas, `.npmrc` com `save-exact`): `prisma`, `@prisma/client` (e o driver adapter, se a versão adotada exigir), `zod` como dependência direta, e a ferramenta de bundle do worker, cuja escolha o `devops.md` da demanda deve justificar (devops ajuste 3).

## 8. Impactos prováveis

- **Infraestrutura:** Dockerfile, `.dockerignore`, compose e entrypoint. É o núcleo da demanda, e o devops é o responsável (issue, "Papel responsável").
- **Dados:** bootstrap do Prisma sem models, a conexão do health e a base de teste separada. O DBA atua como apoio e revisão: confere a tag do Postgres, a criação da base de teste, o comportamento do `migrate deploy` sem migrações e o usuário com `CREATEDB` exigido pela estratégia de E0.5 (devops ajuste 6).
- **Configuração de qualidade:** `vitest.config.ts`, `eslint.config.mjs` e `.gitignore` recebem as exclusões do cliente gerado. O projeto `integration` passa a ter testes. O arquiteto decide se o `passWithNoTests` continua.
- **CI:** ainda não existe; a E0.3 precisa de `db:generate` antes de typecheck, lint e build, e de um Postgres para os testes. Esta demanda define os comandos que a E0.3 vai consumir.
- **Fluxo local:** depois de `npm ci`, typecheck, lint e build passam a exigir `npm run db:generate`, porque o cliente gerado não é versionado. Uma alternativa é `postinstall`, mas a ordem da E0.3 (`npm ci → prisma generate → …`) sugere passo explícito. O arquiteto decide e o `CLAUDE.md` registra.
- **Documentação:** `README.md` inicial e a tabela "Comandos e cobertura" do `CLAUDE.md`.

## 9. Dúvidas

### Bloqueantes
Nenhuma.

### Não bloqueantes (suposições adotadas)
- **S-1. Major do Postgres:** a issue diz "≥ 16", e o devops sugere `postgres:17`. Adoto uma tag de major fixa ≥ 16, escolhida pelo arquiteto ou devops e registrada no desenho (sugestão: `17`, como no `devops.md`). A E0.3 herda a mesma tag.
- **S-2. Variáveis desta demanda:** entram as variáveis de base e de banco (RN-5) e os quatro seletores de adaptador. Credenciais de provedores entram nos itens que as consomem (E0.6, E6.6, E7.2). "Credenciais reais vazias" (entregável) vale para elas a partir desses itens. Na E0.2, o valor `real` de um seletor é aceito pelo schema, mas ainda não tem efeito.
- **S-3. Chaves fora do runtime do app:** `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` e `TEST_DATABASE_URL` não são lidas pelo app em produção, mas estão no `.env.example`. Para o CA-3 ("coincidem") ser literal, o `env.ts` também as declara, seja no schema como opcionais, seja numa lista exportada e comentada de chaves de infraestrutura e teste. O teste compara o `.env.example` com essa união. O mecanismo fica a cargo do arquiteto.
- **S-4. Acesso ao banco no health:** o `SELECT 1` usa o cliente Prisma do bootstrap (`$queryRaw`), o que já exercita a geração e a conexão que a E0.4 vai usar. O arquiteto pode justificar outro caminho.
- **S-5. Testes de integração e PostgreSQL:** a partir desta demanda, `npm test` e `npm run test:coverage` exigem um PostgreSQL em `TEST_DATABASE_URL`, como `docker compose up -d postgres`. O README e o `CLAUDE.md` documentam isso. O teste de CA-9 não é pulado quando o banco falta.
- **S-6. Porta do app:** fica fixa em 3000 no host. Não se cria `APP_PORT`, porque nenhuma decisão anterior a prevê.
- **S-7. Heartbeat do stub:** intervalo fixo e curto o bastante para aparecer no log logo após a subida (sugestão: 30 s, com a primeira linha emitida na partida), sem nova variável de ambiente. A E0.7 substitui o stub.
- **S-8. Script `worker`:** `npm run worker` roda o worker localmente, fora do Docker. O worker é compilado para JS só na imagem; o arquiteto escolhe se o script local usa o JS compilado (com um script de build do worker) ou outra forma, e registra a escolha.
