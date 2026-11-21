# Agenda Beleza

SaaS multi-salão de agendamento para salões de beleza. A especificação da v1 está em [`PLAN.md`](PLAN.md).

Stack: Next.js + TypeScript, PostgreSQL 17, Prisma 7, Vitest e Playwright. Tudo roda localmente com adaptadores **simulados**, sem nenhuma credencial real.

## Executar com Docker

Pré-requisitos: Docker com Compose v2 e as portas **3000** (app) e **5432** (PostgreSQL) livres no host.

```bash
cp .env.example .env          # valores de desenvolvimento; funciona sem alterações
docker compose up -d --wait   # builda a imagem e espera postgres e app ficarem saudáveis
```

| Serviço | O que faz | Acesso |
|---|---|---|
| `postgres` | PostgreSQL 17; na primeira inicialização cria também a base de testes de `TEST_DATABASE_URL` | `localhost:5432` |
| `app` | Valida o ambiente (o log mostra o modo de cada adaptador), aplica as migrações (`prisma migrate deploy`) e sobe o Next.js | http://localhost:3000 e http://localhost:3000/api/health |
| `worker` | Processo separado (mesma imagem) que consome a fila de jobs (pg-boss, schema `pgboss`; ver "Fila de jobs e worker"): valida o ambiente, registra os modos dos adaptadores, instala/migra o schema `pgboss`, processa os jobs com novas tentativas e emite um heartbeat em JSON a cada 30 s. `docker compose stop worker` espera até 25 s pelos jobs em andamento (`stop_grace_period: 30s`) | `docker compose logs -f worker` |

App e worker rodam como usuário não root. Só a app aplica migrações.

- **Porta 5432 ocupada:** defina `POSTGRES_PORT` no `.env` (por exemplo, `5433`) e troque a porta também em `DATABASE_URL` e `TEST_DATABASE_URL`, porque o Node não interpola variáveis do `.env`. Dentro do compose, a app sempre usa `postgres:5432`.
- **Porta 3000 ocupada:** libere-a antes de subir (ela é fixa no compose).
- **Parar:** `docker compose down` (mantém os dados) ou `docker compose down -v` (apaga o volume do banco).
- **Logs:** `docker compose logs app`, `docker compose logs worker`.
- **Depois de mudar o código:** `docker compose up -d --build --wait` reconstrói a imagem (sem `--build`, o compose reaproveita a imagem `agenda-beleza:dev` já existente).
- **Smoke da imagem:** `sh docker/smoke.sh` faz esse `up --build --wait` e confere `/api/health` e os cabeçalhos das páginas com token; é o mesmo comando do job `docker` da CI. Não derruba nada ao terminar.
- **`next.config.ts` na imagem:** o estágio final não tem `src/`. O build compila o `next.config.ts` com esbuild num `next.config.mjs` autocontido (o que ele importa de `src/` entra no arquivo; pacotes ficam em `node_modules`), então imports novos no config não exigem mexer no `Dockerfile`.

A publicação em servidor (VPS) ainda não está definida: este compose é só para desenvolvimento e testes locais.

## Desenvolvimento sem Docker para a app

```bash
nvm use                       # Node 24 (.nvmrc)
npm ci
npm run db:generate           # obrigatório depois de todo npm ci (gera o cliente Prisma)
cp .env.example .env
docker compose up -d postgres
npm run dev                   # http://localhost:3000
npm run worker                # em outro terminal; Ctrl-C encerra (espera os jobs em andamento)
npm run fila:exemplo -- 3000  # em outro terminal: enfileira um job de exemplo de 3 s
```

## Testes

Os testes de integração rodam contra um PostgreSQL **real** (sem mocks de banco).

```bash
docker compose up -d postgres  # cria agenda_beleza_test na primeira subida
npm ci
npm run db:generate
npm test                       # unidade + integração
npm run test:coverage          # o mesmo, com o gate de 90% de linhas (relatório em coverage/)
npm run test:e2e               # build + base `_e2e` com seed + Playwright (viewport de celular); libere a porta 3000 antes
npx playwright test e2e/a11y-base.spec.ts  # só o E2E de acessibilidade (exige build prévio)
npx playwright test e2e/entrar.spec.ts     # só o E2E de /entrar e do proxy (exige build prévio; sem banco)
npx playwright test e2e/recuperar-senha.spec.ts  # só o E2E da recuperação de senha (exige build prévio; sem banco)
npx playwright test e2e/fotos.spec.ts e2e/fotos-sem-js.spec.ts  # só o E2E das fotos do salão (exige build prévio; sem banco)
npx playwright test e2e/reserva-publica.spec.ts e2e/reserva-publica-sem-js.spec.ts  # só o E2E da página pública de reserva (`/dev/reserva`; exige build prévio; sem banco)
```

- Os testes de integração usam **somente** `TEST_DATABASE_URL`, nunca `DATABASE_URL`, e recusam rodar se as duas forem iguais. Sem `TEST_DATABASE_URL`, eles falham com uma mensagem que nomeia a variável.
- **Volume antigo sem a base de testes** (criado antes do script de initdb): `docker compose exec postgres createdb -U agenda agenda_beleza_test`.
- **Volume parcialmente inicializado:** se o `TEST_DATABASE_URL` tiver um nome de base inválido (fora de `[a-z0-9_]`, com mais de 63 caracteres (o harness de testes exige até 46), igual a `POSTGRES_DB` ou a `postgres`, `template0` ou `template1`), a primeira subida do `postgres` falha com `exited (1)`, e o log diz o motivo. Nos `up` seguintes, o initdb não roda de novo, e o banco sobe **sem** a base de testes. Corrija a variável e rode `docker compose down -v` antes de subir de novo (ou crie a base com o `createdb` acima).
- Navegador do E2E (uma vez por máquina): `npx playwright install chromium`.
- **E2E com banco (D-036):** `npm run test:e2e` faz `next build` e `build:node`, roda `node dist/e2e/preparar-banco.js` (recria a base descartável `<TEST_DATABASE_URL>_e2e`, aplica as migrações, roda o seed e um complemento só do E2E: oito salões de reserva isolados e um salão suspenso; fotos em `.armazenamento-e2e/`) e então o Playwright, com `retries: 0` e `reuseExistingServer: false`. Precisa de `TEST_DATABASE_URL` (ou `E2E_DATABASE_URL`) e do PostgreSQL no ar (`docker compose up -d postgres`). **`npx playwright test` isolado exige a base já preparada**: rode antes `npm run build:node && node --env-file-if-exists=.env dist/e2e/preparar-banco.js` (e `npm run build`). Os specs `e2e/publico-*.spec.ts` percorrem a página pública real (`/studio-aurora`, `/e2e-reservas-N`, `/e2e-suspenso`); os demais continuam em `/dev/*`.

### Banco de teste: template por execução e uma base por worker

O harness fica em `tests/support/` (`global-setup.ts`, `setup-arquivo.ts`, `db.ts`, `banco.ts`). A base de `TEST_DATABASE_URL` passa a ser só **administrativa**: o harness se conecta a ela para criar e apagar bases, mas não lê, grava, migra nem apaga nada dentro dela. A base de `DATABASE_URL` nunca é tocada.

1. **Uma vez por execução** (`globalSetup` do projeto `integration`): a guarda valida `TEST_DATABASE_URL` antes de qualquer conexão. Em seguida, apaga bases órfãs de execuções antigas e cria o template `<base>_r<exec>_tpl` a partir de `template0` (UTF-8). Depois aplica `prisma migrate deploy` nele e roda os **inicializadores de schema** (`INICIALIZADORES` em `tests/support/db.ts`): o schema de prova e o `pgboss`, instalado pelo `start()`/`stop()` do pg-boss com as mesmas opções do worker (papel `instalador`), sem filas. Por fim, confere que nenhuma sessão ficou aberta no template e o fecha para conexões (`ALLOW_CONNECTIONS false`).
2. **No início de cada arquivo de teste** (`setupFiles`): a base do worker `<base>_r<exec>_w<VITEST_POOL_ID>` é recriada a partir do template (`DROP DATABASE … WITH (FORCE)` + `CREATE DATABASE … TEMPLATE`). O `DATABASE_URL` do processo de teste passa a apontar para ela, e o pool do Prisma vai para 16 conexões. Cada arquivo começa com a base vazia e migrada. Não há `TRUNCATE` nem transação com rollback, então os testes de concorrência fazem `COMMIT` de verdade.
3. **No fim da execução**: o teardown apaga todas as bases da execução.

- **Execuções simultâneas** (dois terminais, o laço do tester enquanto você trabalha) são permitidas: cada execução tem nomes próprios (`exec` = instante + 2 caracteres aleatórios).
- **Até 4 workers** no projeto `integration` (`maxWorkers: 4` em `vitest.config.ts`).
- **Privilégio:** o papel de `TEST_DATABASE_URL` precisa de `CREATEDB`, e não de superusuário. No compose, o `POSTGRES_USER` já é superusuário. Na CI (job `testes`), o papel é o `POSTGRES_USER` do service `postgres` (`agenda`, superusuário). O service cria só a base de `DATABASE_URL` (`POSTGRES_DB=agenda_beleza`), e um passo cria a base de `TEST_DATABASE_URL` com `createdb` dentro do container do service (`docker exec <service> createdb -U agenda agenda_beleza_test`), porque o initdb do compose não roda lá.
- **Nome da base de teste:** no máximo **46 caracteres** em `[a-z0-9_]`, porque os sufixos `_r<10>_w999` precisam caber nos 63 do PostgreSQL. Um nome maior é recusado com uma mensagem que nomeia `TEST_DATABASE_URL`. O initdb do compose aceita até 63 caracteres, mas o harness exige até 46.
- **Orçamento de conexões:** cada execução usa até `maxWorkers × (POOL_MAX_TESTES + 2)` = 4 × 18 = 72 conexões (os arquivos de fila usam ≈ 11 por worker do Vitest: worker em teste 4, cliente 2, boss de inspeção 2, admin e Prisma). Mantenha `execuções × maxWorkers × (POOL_MAX_TESTES + 2) + compose (≈ 7 com o worker no ar) + psql/IDE (≈ 5) ≤ max_connections − superuser_reserved_connections` (100 − 3 = 97 no compose). Uma execução cabe (≈ 84). **Duas execuções simultâneas exigem `docker compose stop app worker`**: com o worker do compose no ar (4 conexões contínuas), os picos somados passam do limite. Se aparecer `53300 too many clients already`, pare app e worker durante o teste. Nos testes, um arquivo não satura o pool do Prisma e um `pg.Pool` ao mesmo tempo, e `criarPoolPg()` usa 12 conexões por padrão.
- **Sessão de superusuário aberta numa base de worker:** quando o papel de teste **não** é superusuário (por exemplo, um papel só com `CREATEDB`), um `psql` de superusuário conectado a uma base `…_w<N>` faz o `DROP … WITH (FORCE)` do reset falhar (`42501`). Feche essas sessões antes de rodar. No compose e na CI o papel é superusuário, e esse caso não ocorre.
- **Depuração:** os dados de um arquivo ficam na base `…_w<N>` só enquanto a execução dura, porque o teardown apaga tudo no final. Para inspecionar, rode o arquivo isolado e pause dentro do teste (ou consulte a base durante a execução). Uma execução interrompida deixa bases órfãs, que a varredura da próxima execução apaga quando tiverem **mais de 6 h**. Por isso, uma depuração parada por mais de 6 h pode perder a base para a varredura de outra execução. Limpeza manual: `psql "$TEST_DATABASE_URL" -Atc "SELECT datname FROM pg_database WHERE datname ~ '^agenda_beleza_test_r[0-9a-z]{10}_(tpl|w[0-9]{1,3})$'"` e, para cada nome, `DROP DATABASE IF EXISTS "<nome>" WITH (FORCE)`.
- **Teste único:** `npx vitest run --project integration tests/integration/db/reserva-exclusion.test.ts`. O template é criado e a base do worker é recriada do mesmo jeito.
- **Concorrência (CA-6 da D-005):** `for i in $(seq 10); do npx vitest run --project integration tests/integration/concorrencia --maxWorkers=2 --silent=false || break; done`. Com `--silent=false`, cada arquivo imprime `[CA-6] arquivo=… VITEST_POOL_ID=… base=…`.
- **Fila e worker (D-008):** os testes de `tests/integration/fila/` e `tests/integration/worker/` usam o pg-boss real na base do worker do Vitest, com atraso de retry de 1 s e busca a cada 0,5 s; o do CA-4 (`sigterm.test.ts`) empacota `src/worker/main.ts` com os argumentos do `build:node` em `node_modules/.cache/agenda-beleza/` e manda SIGTERM a um processo filho. Estabilidade: `for i in $(seq 10); do npx vitest run --project integration tests/integration/worker/retry.test.ts tests/integration/worker/sigterm.test.ts || break; done`.
- **Fábricas e sessão nos testes:** `tests/support/factories.ts` cria salões completos pelo Prisma (`criarSalaoCompleto`, `criarDoisSaloes`), e `tests/support/auth.ts` cria sessões reais (`credencialDoGestor`, `credencialDoProfissional`, `criarSuperAdmin`, `criarSessao`).

### Escopo de salão no servidor

- **Repositórios** (`src/server/repos/`): só eles importam o cliente Prisma. Toda operação de tenant recebe um `TenantContext` ou `SistemaContext` como primeiro argumento e filtra por `salao_id` na própria consulta. Um recurso de outro salão, inexistente ou com ID malformado gera a mesma resposta: `NaoEncontrado` (404). As leituras públicas (`repos/publico.ts`) resolvem o salão pelo slug e expõem só serviços e profissionais ativos.
- **Lint:** a regra `no-restricted-imports` proíbe importar `@/generated/prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg` e `src/server/repos/db` fora de `src/server/repos/**`, `src/worker/**`, `prisma/seed.ts`, `tests/**` e `*.test.ts(x)`. `import type` continua permitido. O `pg-boss` só pode ser importado em `src/server/queue/**`, `src/worker/**` e nos testes (inclusive `import type`); o resto da app enfileira pelo cliente de `src/server/queue/client.ts`.
- **Ações autenticadas:** são criadas com `defineAcao({ papeis, capacidade }, handler)` (`src/server/tenant/define-acao.ts`). O wrapper resolve a sessão do cookie `ab_sessao` (401), confere o papel (403), consulta a política de operação com a capacidade (403) e só então chama `handler(ctx, input)`. O `salaoId` vem **só** da sessão. A capacidade é obrigatória: `leitura`, `configurar`, `agendar`, `cancelar`, `assinatura` ou `lgpd`. Server Components usam `exigirContexto()` (`src/server/tenant/next.ts`).
- **Convenção `*.acao.ts`:** um arquivo `'use server'` em que **toda** exportação é `export const x = defineAcao(...)`. Tipos e constantes ficam em outro arquivo. O teste `tests/integration/tenant/registro.test.ts` carrega `src/**/*.acao.ts` e falha se alguma exportação não passar por `defineAcao` com capacidade válida.

### Migrações

- **`prisma db push` é proibido:** ele altera o banco sem migração e cria drift com o histórico. Também não use `prisma migrate reset` contra a base de desenvolvimento por engano: ele lê `DATABASE_URL`.
- **Como criar migrações:**
  1. Mude `prisma/schema.prisma` e gere a migração pelo Prisma (`npx prisma migrate dev --name <nome>` contra a base de desenvolvimento). Não edite à mão o SQL gerado.
  2. O que o Prisma não expressa (exclusion constraints, CHECKs, índices parciais, triggers) vai em **migração SQL própria**, criada com `npx prisma migrate dev --create-only --name <nome>` e escrita à mão, com o SQL inverso em comentário.
  3. **Migrações são congeladas depois do merge:** nunca edite uma migração já aplicada. Mudanças futuras criam migração nova.
  4. O teste `tests/integration/db/drift.test.ts` confere que o Prisma não acusa drift e que cada objeto de SQL bruto existe no catálogo pelo nome.
- Outros gates: `npm run lint`, `npm run typecheck`, `npm run build`.

## Seed de demonstração (E9.2)

Dois salões fictícios completos, para conhecer o sistema sem cadastrar nada. **Nunca use em produção:** as credenciais abaixo são públicas e o CLI recusa `NODE_ENV=production` sem `SEED_PERMITIR_PRODUCAO=true`.

```bash
npm run db:seed                                   # build:node + node dist/prisma/seed.js (usa DATABASE_URL; a base precisa estar migrada)
docker compose exec -e SEED_PERMITIR_PRODUCAO=true app node dist/prisma/seed.js  # no Docker, com a stack no ar
```

No container a app roda com `NODE_ENV=production`, por isso o comando acima passa a flag `SEED_PERMITIR_PRODUCAO=true` (só no compose local de demonstração; **nunca** em um ambiente real). Sem a flag o seed recusa e não grava nada.

- **Idempotente:** ids fixos e `INSERT … ON CONFLICT DO NOTHING`; um salão já existente é pulado por inteiro e nada é apagado nem alterado. Reservas, bloqueios e avaliações usam datas relativas à **primeira** execução (em demonstração longa a agenda futura pode esgotar: use uma base nova).
- **Salão A, Studio Aurora** (`/studio-aurora`, `America/Sao_Paulo`, assinatura em teste): gestora que também atende, um profissional com login e uma terceira profissional; 5 serviços com vínculos parciais; jornadas com pausa; funcionamento semanal; bloqueios; clientes fictícias (uma anonimizada); reservas passadas e futuras em todos os status; 3 fotos e 3 avaliações publicadas.
- **Salão B, Ateliê Bromélia** (`/atelie-bromelia`, `America/Manaus`, grade de 30 min, assinatura ativa): o gestor não atende; 3 serviços, 2 profissionais, 2 fotos e 3 avaliações.
- **Fotos:** geradas por código (gradientes nas cores do tema, convertidas em WebP pelo mesmo processamento do envio) e gravadas pelo adaptador de armazenamento; nenhuma imagem de terceiros.
- **Super admin:** `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` do ambiente, ou o par de demonstração. O seed **não** cadastra o TOTP: o primeiro login em `/admin/entrar` faz o cadastro.

| Quem | E-mail | Senha |
|---|---|---|
| Gestora do salão A | `helena@aurora.example` | `Demo@12345` |
| Profissional do salão A | `marcos@aurora.example` | `Demo@12345` |
| Gestor do salão B | `rafael@bromelia.example` | `Demo@12345` |
| Super admin (se o ambiente não definir outro) | `admin@agendabeleza.example` | `Admin@Demo12345` |

Os e-mails usam o domínio reservado `.example`; nenhum telefone ou pessoa é real. Os testes de integração do seed estão em `tests/integration/seed/`.

## Entrar no painel (login e sessão)

- **Fluxo:** a equipe (gestor e profissional) entra em `/entrar` com e-mail e senha e vai para `/painel` (ou para o caminho de `?proximo=`, aceito só se for `/painel` ou estiver abaixo dele). "Sair", no cabeçalho do painel, é um formulário POST (ação de servidor) que revoga a sessão, apaga o cookie e volta para `/entrar`. O super admin **não** entra por `/entrar` (recebe a mensagem genérica); o login dele, com TOTP, é `/admin/entrar` (E1.5).
- **Mensagens:** e-mail inexistente, senha errada e super admin recebem a mesma resposta, "E-mail ou senha incorretos.", com o mesmo custo de verificação (argon2id contra um hash fictício quando o e-mail não existe). Só depois da senha correta aparecem "Confirme seu e-mail antes de entrar." (e-mail não confirmado) e "Seu acesso está desativado. Fale com a gestão do salão." (profissional desativado ou sem perfil).
- **Sessão:** guardada na tabela `sessao` (só o SHA-256 do token; o token vai no cookie `ab_sessao`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` de 30 dias). Ela expira após **7 dias sem uso**, é renovada no uso (no máximo uma escrita por hora) e tem **teto de 30 dias** desde o login. Logout, `revogarSessoesDoUsuario` (redefinição de senha, desativação) e profissional desativado invalidam a sessão no servidor.
- **Limite de tentativas:** 10 falhas por e-mail numa janela fixa de 15 minutos (tabela `rate_limit_janela`, chave com o SHA-256 do e-mail). A 11ª tentativa recebe "Muitas tentativas. Aguarde alguns minutos e tente de novo.", mesmo com a senha certa ou com e-mail inexistente. Sucesso não conta como falha.
- **`Secure` só em produção:** o cookie sai com `Secure` quando `NODE_ENV=production` (inclusive `next start` e a imagem Docker). Chromium e Firefox aceitam cookie `Secure` em `http://localhost` e `http://127.0.0.1`; o **Safari não**. Para entrar pelo Safari sem HTTPS, use `npm run dev`.
- **Usuário de exemplo:** rode o seed de demonstração (seção "Seed de demonstração", logo abaixo) e entre com as credenciais de lá, ou crie um gestor pelo cadastro (seção seguinte). Os testes criam usuários pelas fábricas (`tests/support/factories.ts`, senha `SENHA_DE_TESTE`) e fazem login real por `entrarDeVerdade` (`tests/support/auth.ts`).
- **Atrás de proxy reverso:** as ações de servidor do Next recusam POST cujo `Origin` não bate com o `Host`. Se a implantação reescrever o `Host`, configure `experimental.serverActions.allowedOrigins` no `next.config.ts` (ajuste de implantação, E9.x).
- **Permissões:** a matriz por papel fica em `src/server/auth/permissoes.ts` (`pode`, `exigirPermissao`, `filtroDeProfissional`). Páginas do painel usam `exigirAcessoAoPainel(caminho)` (`src/server/auth/pagina.ts`): sem sessão, redireciona para `/entrar?proximo=…`; sessão sem permissão mostra "Acesso negado". O `src/proxy.ts` só confere a presença do cookie em `/painel/**` (não autoriza nada).
- **Nenhuma credencial externa nova:** o hash de senha usa `@node-rs/argon2` (binário pré-compilado, sem script de instalação).

## Cadastro do salão e confirmação de e-mail

- **Fluxo:** em `/cadastro` (link "Criar conta do salão" em `/entrar`) a pessoa informa o próprio nome, e-mail, senha (mínimo de 8 caracteres) e o nome do salão. Numa única transação são criados o salão (fuso `America/Sao_Paulo`, grade de 15 min, antecedência de 2 h, janela de 60 dias, intervalo de 0 min), o slug público, o usuário **gestor ainda não confirmado** e um token de confirmação; depois do commit sai um e-mail com o link `APP_URL/confirmar-email?token=…`. O cadastro não cria sessão, assinatura nem perfil de profissional.
- **Confirmação:** abrir o link confirma o e-mail. O link vale **24 horas** e é de **uso único** (o banco guarda só o SHA-256 do token). Reaberto, mostra "Este link já foi utilizado" com o link para entrar; vencido ou substituído por um mais recente, oferece o reenvio. Depois de confirmar, o gestor entra em `/entrar` e vai para `/painel` (sem login automático).
- **Reenvio:** `/confirmar-email` sem `token` mostra o formulário "Reenviar link de confirmação"; a tela de link vencido reenvia pelo próprio token (POST); e o login de um gestor não confirmado, **com a senha correta**, mostra o botão "Reenviar link de confirmação". O reenvio invalida os links anteriores e responde sempre a mesma mensagem ("Se houver um cadastro aguardando confirmação para este e-mail, enviamos um novo link…"), sem revelar se o e-mail existe. Limite: **3 pedidos por e-mail a cada 15 minutos** (janela fixa em UTC, tabela `rate_limit_janela`); o 4º recebe "Muitas solicitações. Aguarde alguns minutos e tente de novo.".
- **E-mail já cadastrado:** o cadastro é recusado com "Este e-mail já está cadastrado. Entre ou, se ainda não confirmou o e-mail, peça um novo link." (vale para qualquer papel). O duplo envio do formulário cria um único salão.
- **Slug:** derivado do nome do salão (minúsculas, sem acentos, cada sequência fora de `[a-z0-9]` vira `-`, até 50 caracteres; nome sem nenhum caractere aproveitável vira `salao`). Em colisão com qualquer slug existente (atual ou histórico), recebe `-2`, `-3`… Os primeiros segmentos das rotas da aplicação (`SEGMENTOS_RESERVADOS` em `src/config/navegacao.ts`: `painel`, `admin`, `entrar`, `api`, `cadastro`, `confirmar-email`…) contam como colisão: "Painel" vira `painel-2`.
- **Falha no envio:** se o adaptador de e-mail falhar, o cadastro continua gravado e a tela avisa "Não conseguimos enviar o e-mail agora. Use 'Reenviar link' em alguns minutos.".
- **Ler o link no modo simulado** (`EMAIL_ADAPTER=simulado`): o texto do e-mail fica em `email_log`. Com o Docker: `docker compose exec postgres psql -U agenda agenda_beleza -c "select corpo from email_log order by criado_em desc limit 1"`. Copie a URL do corpo e abra no navegador.
- **Produção:** `APP_URL` precisa ser a URL pública da aplicação, porque é ela que monta o link do e-mail (o cabeçalho `Host` da requisição nunca é usado). Nenhuma credencial nova: o envio real usa o SMTP já descrito em "Credenciais para os serviços reais".

## Recuperação de senha

- **Fluxo:** em `/recuperar-senha` (link "Esqueci minha senha" em `/entrar`) a pessoa informa o e-mail e recebe um link `APP_URL/redefinir-senha?token=…`. Abrir o link só **verifica** o token (não o consome: scanners de e-mail e pré-carregamento não o queimam) e mostra o formulário "Definir nova senha" (mínimo de 8 caracteres, sem campo de confirmação). Ao salvar, a tela mostra "Senha alterada" e o link para `/entrar` (sem login automático). Funciona com e sem JavaScript.
- **Quem pode:** gestor (com o e-mail confirmado ou não) e profissional com perfil ativo. Super admin, profissional desativado ou sem perfil e e-mail inexistente recebem a mesma resposta e nada é gravado nem enviado.
- **Resposta uniforme:** a tela sempre diz "Se houver uma conta com este e-mail, enviamos um link para redefinir a senha. Ele vale por 1 hora.", inclusive quando o envio falha (a falha só vai para o log). **Envio depois da resposta:** a busca do usuário, a gravação do token e o envio do e-mail rodam em `after()` (Next), depois que a resposta sai; o tempo de resposta não depende de o e-mail existir. `next start` (e a imagem Docker) executa os `after()` pendentes ao receber SIGTERM.
- **Link:** vale **1 hora** e é de **uso único** (o banco guarda só o SHA-256 do token). Um novo pedido invalida os links anteriores. Link usado, vencido, substituído, malformado ou de quem deixou de poder recuperar mostra uma única mensagem: "Este link de redefinição é inválido, expirou ou já foi usado. Peça um novo link.". A página envia `Referrer-Policy: strict-origin` (cabeçalho HTTP em `next.config.ts`), para o token não vazar no `Referer`.
- **Ao redefinir:** **todas as sessões** do usuário são encerradas (inclusive a do navegador em uso); um login com a senha antiga em andamento no mesmo instante não gera sessão válida. O link também **confirma o e-mail** de um gestor ainda não confirmado (invalidando os links de confirmação pendentes) e zera as falhas de login da janela atual, então quem se bloqueou com 10 tentativas entra logo com a nova senha.
- **Limite:** **3 pedidos por e-mail a cada 15 minutos** (janela fixa em UTC, tabela `rate_limit_janela`, chave `recuperacao-senha:` + SHA-256 do e-mail, independente do login e do reenvio de confirmação), contando também e-mails inexistentes. O 4º recebe "Muitas solicitações. Aguarde alguns minutos e tente de novo.".
- **Ler o link no modo simulado** (`EMAIL_ADAPTER=simulado`): o mesmo comando do cadastro (`select corpo from email_log …`); o assunto é "Redefinição de senha no Agenda Beleza". O e-mail aparece em `email_log` logo depois da resposta da tela (não antes dela).
- **Produção:** `APP_URL` monta o link (como no cadastro). Nenhuma variável nem credencial nova.

## Profissionais

- **Onde:** `/painel/profissionais` (lista), `/painel/profissionais/novo` (cadastro) e `/painel/profissionais/<id>` (edição, desativação e reativação). Só o **gestor** gerencia profissionais: o profissional vê "Acesso negado" e recebe 403 nas ações; sem sessão, a página leva a `/entrar`. A lista traz apenas o salão da sessão (ativos primeiro, por nome), com o estado ("Ativo"/"Inativo") e o acesso ("Você", "Com acesso", "Sem acesso").
- **Cadastro e edição:** nome obrigatório (de 2 a 100 caracteres, espaços extras removidos) e e-mail opcional (gravado em minúsculas; guardado para o convite). Nomes repetidos são permitidos. Quem já tem acesso ao painel (convite aceito ou o próprio gestor) tem o e-mail como **somente leitura**: o servidor recusa a troca, e o e-mail de login nunca muda por esta tela.
- **Desativar** (com confirmação): o profissional nunca é apagado. Ele sai da página pública e da escolha de profissional, e reservas, jornadas, bloqueios e vínculos com serviços continuam apontando para ele. A desativação é **recusada** se houver reserva **confirmada** que ainda não terminou (inclusive em andamento); a tela lista essas reservas (data e hora no fuso do salão, serviços e cliente, ou "cliente removida"). Remarque ou cancele antes. Na mesma transação, as **sessões** do usuário profissional vinculado são revogadas (ele perde o acesso na próxima requisição e o login responde "Seu acesso está desativado. Fale com a gestão do salão.") e os **convites pendentes** são invalidados. Desativar o próprio perfil do gestor não encerra as sessões do gestor.
- **Reativar:** volta à lista de ativos e à página pública; sessões e convites antigos não voltam (o profissional entra de novo com a senha).
- **"Eu também atendo":** o gestor sem perfil ativo vê essa ação na lista. Ela cria o perfil de profissional vinculado a ele (sem convite, com o nome do usuário) ou reativa o existente; há no máximo um perfil por gestor, mesmo com cliques simultâneos.
- **Convite:** o envio do convite por e-mail é da E1.4; a seção "Acesso ao painel" da edição é onde ele vai aparecer.
- **Estabilidade dos testes de concorrência:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/profissionais/concorrencia.test.ts || break; done`.

## Serviços

- **Onde:** `/painel/servicos` (lista), `/painel/servicos/novo` (cadastro) e `/painel/servicos/<id>` (edição dos dados e dos profissionais, desativação e reativação). Só o **gestor** gerencia serviços: o profissional vê "Acesso negado" e recebe 403 nas ações; sem sessão, a página leva a `/entrar`. A lista traz apenas o salão da sessão (ativos primeiro, por nome), com preço, duração, situação ("Ativo"/"Inativo") e a quantidade de profissionais **ativos** que executam cada serviço.
- **Campos:** nome (de 2 a 100 caracteres; nomes repetidos são permitidos), **preço** em reais no formato brasileiro, de `0,00` a `99.999,99` (aceita `80`, `80,5`, `80,00`, `1.234,56` e o prefixo `R$`; recusa ponto decimal como `80.00`, mais de duas casas e valores negativos), gravado em centavos inteiros, e **duração** em minutos, múltipla de 5, de 5 a 720. Toda validação é feita no servidor.
- **Profissionais que executam:** no próprio formulário (cadastro e edição), uma caixa por profissional **ativo** do salão. Só profissionais ativos do salão da sessão podem ser vinculados. Profissionais inativos que já tinham vínculo aparecem como "Inativo, vínculo mantido": o vínculo é preservado e volta a valer se o profissional for reativado. Não há preço nem duração por profissional.
- **Página pública:** um serviço só é ofertado se estiver ativo **e** tiver ao menos um profissional ativo vinculado (`listarServicosPublicos`, a única leitura de serviços ofertáveis para a disponibilidade e a página pública). A lista e a edição avisam "Não aparece na página pública: nenhum profissional ativo executa este serviço." quando falta profissional.
- **Desativar e reativar** (um botão, sem confirmação; funciona sem JavaScript): o serviço nunca é apagado. Desativar o tira da página pública e de novas reservas; reservas já feitas, com o preço e a duração da época (snapshot), e os vínculos não mudam. Alterar preço ou duração também não altera reservas existentes.
- **Estabilidade dos testes de concorrência:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/servicos/concorrencia.test.ts || break; done`.

## Jornada

- **Onde:** `/painel/profissionais/<id>/jornada`, pelo link "Ver e editar a jornada" na página do profissional. Só o **gestor** edita, a jornada de qualquer profissional do salão (inclusive a do próprio perfil e a de um profissional inativo, que só passa a valer quando ele for reativado). O profissional vê a **própria** jornada, somente leitura, pelo link "Minha jornada" em `/painel`; a de outro profissional do salão mostra "Acesso negado", e a de outro salão, 404.
- **Formato:** para cada dia (de segunda a domingo), até **6 intervalos** de trabalho; as pausas são as lacunas entre eles, e um dia sem intervalos é folga. Os horários são **hora local do salão** (sem conversão de fuso), no formato `HH:MM` (aceita `9:00`), em **múltiplos de 5 minutos**. O fim precisa ser depois do início e a jornada não atravessa a meia-noite: use `24:00` como fim (ex.: `22:00`–`24:00`) e continue no dia seguinte a partir de `00:00`. Intervalos sobrepostos são recusados; intervalos **contíguos** (`09:00`–`12:00` e `12:00`–`13:00`) são **unidos** ao salvar. Linhas vazias são ignoradas.
- **Salvar:** a semana inteira de uma vez, numa transação. Qualquer erro recusa tudo e mostra os erros por dia e por intervalo, com o que foi digitado; salvar a mesma semana não grava nada. Funciona sem JavaScript.
- **Reservas:** alterar a jornada não altera nem cancela reservas existentes (que podem ficar fora da nova jornada) e não envia mensagens.
- **Demonstração para o E2E:** `/dev/jornada` (`?modo=edicao|leitura|vazia`), ligada pela mesma `VITRINE_COMPONENTES=true` da vitrine, com os mesmos componentes e uma ação que só valida (não grava nada; 404 com a variável desligada).
- **Estabilidade dos testes de concorrência:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/jornadas/concorrencia.test.ts || break; done`.

## Bloqueios

- **Onde:** `/painel/bloqueios` (item "Bloqueios" do menu do gestor e do profissional): formulário "Novo bloqueio" e a lista dos bloqueios **vigentes e futuros** (os já encerrados não aparecem), por início. Cada bloqueio editável tem "Editar" (`/painel/bloqueios/<id>`: início, fim e motivo; o dono e o nível não mudam, para isso remova e crie outro) e "Remover" (apaga de vez; bloqueio não é histórico).
- **Quem:** o **gestor** cria, edita e remove bloqueios do **salão inteiro** (feriado, reforma: vale para todos os profissionais) e de **qualquer profissional** do salão, inclusive do próprio perfil e de profissional inativo (marcado "(inativo)"). O **profissional** gere só os **próprios** e vê os do salão inteiro somente leitura; não vê os de colegas. Bloqueio de outro salão responde 404.
- **Horário:** sempre **hora local do salão** (fuso configurado), gravado em UTC. "Com horário": datas `dd/mm/aaaa` e horas `HH:MM` (00:00 a 23:55) em **múltiplos de 5 minutos**; pode atravessar a meia-noite e durar vários dias. "Dia inteiro": da data de início à data de fim, **inclusivas** (00:00 local da primeira até 00:00 local do dia seguinte à última, também em dias de 23 h ou 25 h de horário de verão); as horas são ignoradas. Trocar o fuso do salão não recalcula os bloqueios: eles passam a ser exibidos no novo fuso.
- **Limites:** o fim precisa ser depois do início e depois de agora (o início pode estar no passado, ex.: "hoje, dia inteiro"); duração de até **366 dias** (366 datas no dia inteiro); início até **2 anos** à frente; motivo opcional de até 200 caracteres. Bloqueios podem se sobrepor.
- **Reservas cobertas:** é permitido bloquear um período com reservas. Depois de salvar, a tela lista as reservas **confirmadas** sob o bloqueio (data e hora, profissional e cliente, ou "cliente removida"). Elas **não são alteradas nem canceladas**, e nenhuma mensagem é enviada.
- **Demonstração para o E2E:** `/dev/bloqueios` (`?modo=gestor|profissional|edicao`), ligada pela mesma `VITRINE_COMPONENTES=true` da vitrine, com os mesmos componentes e ações que só validam (não grava nada; 404 com a variável desligada).
- **Estabilidade dos testes de concorrência:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/bloqueios/concorrencia.test.ts || break; done`.

## Configurações do salão

- **Onde:** `/painel/configuracoes` (item "Configurações" do menu), só para o **gestor**; o profissional vê "Acesso negado". São dois formulários independentes, e ambos funcionam sem JavaScript.
- **Dados e regras de horário** (gravados juntos, ou nenhum): nome do salão (de 2 a 80 caracteres; trocar o nome não muda o endereço); fuso horário, escolhido da lista (o grupo "Brasil" primeiro; a lista é a de fusos canônicos do Node, `Intl.supportedValuesOf('timeZone')`, e não aceita `UTC`, offsets como `+03:00` nem aliases como `Brazil/East`, exceto o valor já gravado no salão); grade de horários de **5, 10, 15, 20, 30 ou 60 minutos**; antecedência mínima de **0 a 72 horas** inteiras; janela máxima de **1 a 365 dias**; intervalo entre atendimentos de **0 a 120 minutos**. A antecedência precisa ser menor que a janela. Os padrões de um salão novo são `America/Sao_Paulo`, 15 min, 2 h, 60 dias e 0 min.
- **Efeito:** as regras valem para os próximos horários oferecidos; reservas, jornadas e bloqueios existentes não mudam. Ao trocar o fuso, a jornada continua com os mesmos horários de relógio (agora no novo fuso), e bloqueios e reservas mantêm o instante e passam a ser exibidos no novo fuso.
- **Endereço público (slug):** letras minúsculas sem acento, números e hífens entre eles, de 3 a 60 caracteres (o texto é aparado e posto em minúsculas, sem outra conversão). Segmentos reservados das rotas (`painel`, `admin`, `entrar`…) são recusados. O endereço anterior vira **histórico permanente** do salão: continua levando ao salão (o redirecionamento é da página pública, E4.1) e nunca pode ser usado por outro salão; o salão pode voltar a um endereço anterior dele. Um endereço em uso por outro salão (atual ou histórico) é recusado sem revelar o dono.
- **Concorrência:** a troca de endereço e a gravação das regras travam a linha do salão (`FOR NO KEY UPDATE`, que não bloqueia novas reservas); dois salões pedindo o mesmo endereço ao mesmo tempo: um vence e o outro recebe "em uso".
- **Demonstração para o E2E:** `/dev/configuracoes` (`?fuso=alias` mostra um fuso gravado fora da lista), ligada pela mesma `VITRINE_COMPONENTES=true` da vitrine, com os mesmos componentes e ações que só validam (não grava nada; 404 com a variável desligada).
- **Estabilidade dos testes de concorrência:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/salao/concorrencia.test.ts || break; done`.

## Perfil público e funcionamento

- **Onde:** `/painel/configuracoes/perfil` ("Perfil público") e `/painel/configuracoes/funcionamento` ("Horário de funcionamento"), com links em `/painel/configuracoes`. Só o **gestor**; o profissional vê "Acesso negado". Os dois formulários funcionam sem JavaScript.
- **Perfil (tudo opcional; o que for preenchido fica público, inclusive os telefones):**
  - **Descrição:** texto simples de até 1.000 caracteres (quebras de linha mantidas, sem HTML nem Markdown).
  - **Endereço:** tudo ou nada. Com qualquer campo preenchido, logradouro, número (aceita `123A` e `s/n`), bairro, cidade, UF (uma das 27 siglas) e CEP (`01310-100` ou `01310100`, gravado com 8 dígitos) são obrigatórios; o complemento é sempre opcional.
  - **Telefone e WhatsApp:** só números brasileiros com DDD válido, fixo (10 dígitos, começando por 2 a 5) ou celular (11, começando por 9), com ou sem `+55`; gravados em E.164 (`+5511987654321`) e exibidos como `(11) 98765-4321`. 0800, 0300, 4004 e números de outros países são recusados. A lista de DDDs fica em `src/lib/telefone.ts` (a E5.1 a reaproveita).
  - **Instagram:** `perfil`, `@perfil` ou `instagram.com/perfil` (com ou sem `https://`, `www.` ou parâmetros); grava só o nome de usuário, em minúsculas.
  - **Meios de pagamento** (informativos: como a cliente paga no salão) e **comodidades:** listas fixas com chaves estáveis em `src/server/salao/perfil-tipos.ts`. Ampliar uma lista é mudança de código, sem migração.
- **Funcionamento:** semana por dia, em horário local do salão, com as mesmas regras da jornada (`HH:MM`, múltiplos de 5, até 6 intervalos por dia, sem cruzar a meia-noite, 24:00 só como fim, contíguos unidos). A escolha é explícita:
  - **"Não informar"** (padrão de todo salão): o funcionamento não limita a disponibilidade, e a página pública omite o horário. Os horários digitados são descartados ao salvar.
  - **"Informar"**: a semana gravada vale; um dia sem intervalos fica **fechado**. Uma semana inteira fechada é válida e significa "sem horários públicos" (a tela avisa).
  - Gravar a mesma semana de novo não escreve nada. Trocar o fuso não recalcula o funcionamento. Feriados e fechamentos em datas específicas usam um **bloqueio do salão inteiro** (`/painel/bloqueios`).
- **Efeito:** só a partir da E3.1 (disponibilidade), que intersecta o funcionamento com a jornada de cada profissional. Gravar o funcionamento não altera reservas, jornadas nem bloqueios e não envia mensagens.
- **Concorrência:** as gravações do perfil, do funcionamento, das regras e do endereço público se serializam na linha do salão (`FOR NO KEY UPDATE`), sem bloquear novas reservas nem bloqueios.
- **Demonstrações para o E2E:** `/dev/perfil` (`?vazio=1` mostra o perfil vazio) e `/dev/funcionamento` (`?modo=nao-informado` e `?modo=fechado` mostram os avisos), ligadas pela mesma `VITRINE_COMPONENTES=true`, com os mesmos formulários e ações que só validam (404 com a variável desligada).
- **E2E:** `npx playwright test e2e/perfil.spec.ts e2e/perfil-sem-js.spec.ts e2e/funcionamento.spec.ts e2e/funcionamento-sem-js.spec.ts` (build prévio e porta 3000 livre).
- **Estabilidade dos testes de concorrência:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/salao/concorrencia-perfil-funcionamento.test.ts || break; done`.

## Fotos do salão

- **Onde:** `/painel/configuracoes/fotos` ("Fotos do salão"), com link em `/painel/configuracoes`. Só o **gestor**; o profissional vê "Acesso negado". Até **12** fotos por salão, com texto alternativo obrigatório (1 a 150 caracteres), ordem por "Mover para cima/baixo" e remoção. Tudo funciona sem JavaScript.
- **Envio:** formulário nativo `multipart/form-data` para `POST /api/painel/fotos` (a primeira mutação por route handler do projeto; fica fora do proxy de `/painel`). Arquivo de até **5 MB** (5.242.880 bytes) em JPEG, PNG ou WebP; o tipo vem dos bytes iniciais, nunca da extensão. Toda imagem é reprocessada: orientação EXIF aplicada, maior lado de no máximo **1600 px** (nunca amplia), sRGB, **sem nenhum metadado (EXIF, GPS, XMP, ICC)**, primeiro quadro de animações e saída em WebP. Imagens acima de 50 megapixels são recusadas. O resultado volta por redirecionamento (303) para a página, com um código de lista fechada em `?envio=`.
- **Segurança do envio:** o cabeçalho `Origin` tem de ser igual à origem de `APP_URL` (senão **403**, sem ler o arquivo). Por isso, **acesse o painel pelo endereço configurado em `APP_URL`** (`http://localhost:3000` e `http://127.0.0.1:3000` são origens diferentes). O corpo nunca é lido além do limite, e a chave do objeto (`fotos/<128 bits aleatórios>.webp`) é gerada no servidor, sem o nome do arquivo.
- **Entrega pública:** `GET /api/fotos/<id>` (sem sessão; não filtra suspensão), com `Cache-Control: public, max-age=3600`, `ETag` e `nosniff`. Nada lista fotos ou objetos. **Cache:** uma foto removida pode continuar visível por até 1 hora em navegadores e proxies (e mais, se houver CDN).
- **Leitura para a página pública (E4.1):** `lerFotosPublicas` (`src/server/fotos/leitura.ts`) devolve `{ id, url, alt, largura, altura }` por foto, na ordem; nunca monte a URL à mão.
- **Variáveis** (`.env.example`):
  - `STORAGE_ADAPTER`: `simulado` (padrão) grava arquivos em `ARMAZENAMENTO_DIR` (padrão `.armazenamento`, fora de `public/`; no compose, o volume nomeado `armazenamento` em `/app/.armazenamento`, que sobrevive a `docker compose down`); `real` usa um armazenamento compatível com S3 (variáveis em "Credenciais para os serviços reais"). Como nos outros adaptadores, o worker também valida o ambiente: `STORAGE_ADAPTER=real` incompleto derruba app e worker.
- **Consistência:** o objeto é gravado antes da transação; se o limite, o token ou a transação recusarem, ele é removido. Na remoção, a linha sai primeiro e o objeto depois do commit; se essa limpeza falhar, o log tem `armazenamento.orfao` com a chave, e a foto continua removida (a rota pública responde 404). Não há varredura de objetos órfãos nesta versão.
- **Duplo envio:** cada renderização da página gera um token de envio (`salao_foto.envio`, único por salão); o mesmo envio repetido responde "ok" sem criar outra foto.
- **Suspensão:** as quatro operações (enviar, descrever, mover, remover) declaram a capacidade `configurar`; o bloqueio com o salão suspenso é da E6.4. A leitura pública continua liberada.
- **Demonstração para o E2E:** `/dev/fotos` (`?n=0..12` escolhe quantas fotos de exemplo), ligada pela `VITRINE_COMPONENTES=true`, com os mesmos componentes; o envio de demonstração valida e processa em memória (com o `sharp`), não grava e responde 303.
- **E2E:** `npx playwright test e2e/fotos.spec.ts e2e/fotos-sem-js.spec.ts` (build prévio e porta 3000 livre).
- **Estabilidade dos testes de concorrência:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/fotos/concorrencia.test.ts || break; done`.

## Clientes

- **Onde:** `/painel/clientes` (item "Clientes" do menu) e `/painel/clientes/<id>`, só para o **gestor**; o profissional vê "Acesso negado". A busca é um `GET` e a edição devolve o resultado na própria resposta: tudo funciona sem JavaScript.
- **Identidade:** cada cliente é única por **salão + telefone** brasileiro em E.164 (`+55` + DDD + 8 ou 9 dígitos). O mesmo número em dois salões são duas clientes independentes. Não há tela "nova cliente": a cliente nasce na reserva (E3.2, E3.4 e E4.2, pela função `upsertCliente`).
- **Lista e busca:** 20 por página (`?pagina=N`), ordenadas por nome sem acento. `?q=` busca por parte do nome (acento e maiúsculas não importam; `%`, `_` e `\` são literais) ou, se só tiver números e `( ) - + .` (3 dígitos ou mais), por parte do telefone. Clientes anonimizadas não aparecem na lista nem na busca.
- **Edição:** nome (2 a 100 caracteres) e telefone. Trocar para o telefone de outra cliente do salão é recusado, com link para ela (não há mesclagem). Salvar os mesmos valores não grava nada. Editar nunca altera reservas nem mensagens já registradas.
- **Detalhe:** dados, formulário e as 50 reservas mais recentes (data no fuso do salão, status, profissional, serviços, duração e preço do **snapshot**). A cliente anonimizada aparece como "Cliente removida", sem formulário (a anonimização é a E5.2).
- **Busca sem extensão:** a busca normaliza nome em SQL (`normalize(… NFD)`) e varre as clientes do salão. Mede cerca de 20 ms com 5 mil clientes e 90 a 210 ms com 50 mil num único salão (ver `docs/demandas/D-022/dev.md`).
- **Demonstração para o E2E:** `/dev/clientes` (`?vista=detalhe` ou `?vista=anonimizada`), ligada pela `VITRINE_COMPONENTES=true`, com os mesmos componentes, dados fixos e uma ação que só valida (404 com a variável desligada).
- **E2E:** `npx playwright test e2e/clientes.spec.ts e2e/clientes-sem-js.spec.ts` (build prévio e porta 3000 livre).
- **Estabilidade dos testes de concorrência:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/clientes/concorrencia.test.ts || break; done`.

### Excluir cliente (anonimização, LGPD)

- **Onde:** botão "Excluir cliente" no detalhe da cliente ativa (`/painel/clientes/<id>`), só para o **gestor**. Leva à página de confirmação `/painel/clientes/<id>/excluir` (GET só mostra; nada muda). "Confirmar exclusão" é um POST seguido de redirecionamento ao detalhe com o aviso (`?exclusao=ok`); "Cancelar" é um link. Funciona sem JavaScript e nunca ocorre com um único clique. Profissional: "Acesso negado"; cliente de outro salão ou id inválido: 404.
- **O que acontece (irreversível):** numa única transação, `nome` e `telefone` ficam nulos e `anonimizada_em` recebe o instante da ação; reservas, itens e consentimentos permanecem (a cliente aparece como "Cliente removida"). As mensagens de WhatsApp da cliente em `pendente` ou `falhou` passam a `cancelada_anonimizacao`, e `destinatario_e164`, `parametros` e o `erro_detalhe` das tentativas são apagados em todas elas; `enviando` mantém o estado (o fechamento do envio não grava dado pessoal). A cliente deixa de receber avisos.
- **Número liberado:** uma nova reserva com o mesmo telefone cria uma cliente nova, sem ligação com a anonimizada. Repetir a exclusão responde "já excluída" sem gravar nada. A ação (`anonimizarCliente`, capacidade `lgpd`) é permitida mesmo com o salão suspenso.
- **Código:** `src/server/clientes/anonimizar.ts` (`anonimizarCliente(ctx, { clienteId }, agora, deps?)`); gancho `aoAnonimizar` (padrão desde a D-032: apaga nome e comentário das avaliações da cliente e invalida seus convites, via `r.avaliacoes.anonimizarDaCliente`), chamado dentro da transação depois da limpeza das mensagens. Ordem de travas: salão `FOR NO KEY UPDATE` → cliente `FOR UPDATE` → `mensagem` → `mensagem_tentativa`. Sem migração (parecer do DBA em `docs/demandas/D-031/dba.md`). Risco aceito: uma mensagem já entregue ao provedor no instante da exclusão não pode ser recolhida.
- **Fora do escopo:** `email_log` e as tabelas `sim_*` (ver "Limpeza das tabelas dos simulados").
- **Demonstração e E2E:** `/dev/clientes?vista=excluir` (a ação só redireciona); `npx playwright test e2e/clientes-excluir.spec.ts e2e/clientes-excluir-sem-js.spec.ts` (build prévio e porta 3000 livre).
- **Estabilidade:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/clientes/anonimizacao-concorrencia.test.ts || break; done`.

## Agenda da equipe

- **Onde:** `/painel/agenda` (dia e semana) e `/painel/agenda/reservas/<id>` (detalhe), para o **gestor** (todos os profissionais, ativos e inativos, com filtro) e o **profissional** (só a própria agenda). Tudo é somente leitura e por links `GET` (`?data=AAAA-MM-DD&visao=dia|semana&profissional=<id>`): funciona sem JavaScript. Não há ação, migração nem variável de ambiente nova.
- **O que mostra:** reservas de todos os status (com o rótulo em texto, a cancelada também tracejada), bloqueios próprios e do salão inteiro (com o motivo), e faixas de fundo "Fora do funcionamento" e "Fora da jornada". A semana começa no domingo e é uma lista empilhada por dia (sem grade horizontal no celular). No máximo 200 reservas por período, com aviso.
- **Regras:** horários no fuso do salão; reserva que cruza a meia-noite aparece nos dois dias; `data` ou `visao` inválidos caem no padrão (hoje, dia); `profissional` inválido ou de outro salão responde 404, e para o profissional o parâmetro é ignorado; reserva de outro profissional ou de outro salão no detalhe responde 404. A grade nunca mostra telefone (só o detalhe, conforme `cliente.contato`); cliente anonimizada aparece como "cliente removida". A agenda abre mesmo com o salão suspenso.
- **Demonstração para o E2E:** `/dev/agenda` (`?visao=semana`, `?profissional=demo-ana`, `?reserva=demo-r1`), ligada pela `VITRINE_COMPONENTES=true`, com os mesmos componentes e dados em memória relativos a hoje (404 com a variável desligada).
- **E2E:** `npx playwright test e2e/agenda.spec.ts e2e/agenda-sem-js.spec.ts` (build prévio e porta 3000 livre; 375×812, axe 4.14.0, teclado e sem JavaScript).
- **Fuso:** `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/agenda src/app/painel/agenda tests/integration/agenda/fuso.test.ts || break; done`.
- **Plano e volume (D-028):** `npx vitest run --project integration tests/integration/agenda/repo.test.ts --silent=false` imprime o `EXPLAIN` da listagem com 60.000 reservas (Index Scan em `reserva_salao_id_profissional_id_inicio_idx`, sem Seq Scan em `reserva`) e `tests/integration/agenda/consultar.test.ts` confere 6 instruções SQL por consulta, qualquer que seja o volume.

## Reserva manual e encaixe

Entrega da D-029 (E3.4). Sem migração, variável de ambiente nem dependência nova.

- **Onde:** `/painel/agenda/nova` (botão "Nova reserva" na agenda, que leva a data e o profissional da vista; `?profissional=`, `?data=AAAA-MM-DD` e `?hora=HH:MM` pré-preenchem). O **gestor** registra para qualquer profissional ativo do salão; o **profissional**, só para si (outro do mesmo salão: 403; de outro salão ou inexistente: 404). Funciona sem JavaScript, sem PRG: o aviso e os erros voltam na resposta do POST, com os dados preservados.
- **Encaixe:** o servidor (`src/server/reservas/reserva-equipe.ts`, ação `criarReservaManual` com capacidade `agendar`) converte data e hora **locais do salão** em UTC e calcula, sob a trava do profissional, os motivos: `fora_da_jornada` (o atendimento inteiro precisa caber em UM intervalo da jornada do dia; atravessar a meia-noite conta como fora), `bloqueado` (bloqueio próprio ou do salão) e `fora_do_funcionamento` (funcionamento definido; "não informado" nunca é motivo). Com motivo e sem "Confirmo o encaixe", **nada é gravado** e a resposta lista todos os motivos; confirmando, grava `encaixe = true`. Sem motivo grava `encaixe = false`, mesmo fora da grade ou da antecedência de 2 h. Início no passado é sempre recusado.
- **Sobreposição:** continua recusada sempre (só a exclusion constraint `reserva_sem_sobreposicao` decide; mensagem sem revelar quem ocupa). A equipe não é limitada pelas 3 reservas futuras por número nem pela janela de dias. Risco aceito: bloqueio criado entre a detecção e o INSERT.
- **Consentimento:** a equipe declara `mensagens_reserva` por uma caixa opcional (texto da D-023). Sem o aceite a reserva é criada, sem linha de consentimento, e a confirmação nasce `nao_enviada` (sem job); com ele, `pendente` e enfileirada depois do commit.
- **Idempotência:** a chave UUID nasce no render do servidor (campo oculto); o aviso de encaixe não a consome e o duplo envio devolve a mesma reserva.
- **Demonstração para o E2E:** `/dev/reserva-nova` (`?modo=profissional`), ligada pela `VITRINE_COMPONENTES=true`, com os mesmos componentes e uma ação que só valida (404 com a variável desligada).
- **Testes e E2E:** `tests/integration/reservas/equipe/` (PostgreSQL real). `npx playwright test e2e/reserva-nova.spec.ts e2e/reserva-nova-sem-js.spec.ts` (build prévio e porta 3000 livre; 375×812, axe 4.14.0, teclado e sem JavaScript).
- **Estabilidade:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/reservas/equipe/concorrencia.test.ts || break; done` (10 encaixes sobrepostos em paralelo: 1 criada e 9 `horario_indisponivel`); fuso: `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/reservas tests/integration/reservas/equipe || break; done`.

## Remarcar, cancelar e marcar o resultado

Entrega da D-030 (E3.5). Sem migração, variável de ambiente nem dependência nova.

- **Onde:** no detalhe da reserva (`/painel/agenda/reservas/[id]`) aparecem só as ações que a máquina de status permite agora: **Remarcar**, **Cancelar** (em dois passos, "Cancelar reserva" e depois "Confirmar cancelamento" ou "Manter reserva", sem diálogo de JavaScript) e **Marcar como concluída / não compareceu**. Funciona sem JavaScript: erros e avisos voltam na resposta do POST, com os dados preservados; o sucesso é PRG (`?resultado=remarcada|cancelada|concluida|nao_compareceu`). O gestor age em qualquer reserva do salão; o profissional só nas próprias (outro profissional: 403; outro salão, inexistente ou id malformado: 404 igual) e não troca de profissional.
- **Máquina (`src/server/reservas/status.ts`, pura):** `confirmado → cancelado` só com `agora < fim`; `confirmado → concluido|nao_compareceu` só com `agora >= inicio`; `concluido ↔ nao_compareceu` nos dois sentidos; `cancelado` é final; repetir o mesmo status é recusado. Só `confirmado` remarca.
- **Remarcar:** `UPDATE` da MESMA reserva numa transação, com as travas canônicas (salão `FOR SHARE` → profissional(is) `FOR NO KEY UPDATE` em ordem de id → serviços `FOR SHARE` → cliente `FOR KEY SHARE` → reserva `FOR UPDATE`). A própria posição não conflita (10:00–11:00 → 10:30–11:30); a exclusion constraint continua sendo a garantia final (`horario_indisponivel`, reserva intacta). Fora da jornada, bloqueio ou funcionamento pede a confirmação de encaixe, como na reserva manual. Serviços mantidos conservam o snapshot de preço e duração; os acrescentados usam o cadastro atual; `ocupado_ate = fim + intervalo`. Sem mudança, `recusado/sem_alteracao` e nada é gravado. Incrementa `revisao` e registra a mensagem `remarcacao` (substitui as pendentes anteriores) na mesma transação.
- **Cancelar:** grava `cancelada_em`, não incrementa a revisão e registra `cancelamento`; o horário volta à disponibilidade.
- **Concluir:** registra o convite de avaliação (revisão 0; sem consentimento do convite nasce `nao_enviada`). `concluido → nao_compareceu` substitui só o convite ainda pendente; a volta a `concluido` não cria nem reenvia convite. Gancho da E4.5 em `src/server/reservas/marcar-status.ts`.
- **Mensagens:** sempre pelo outbox na mesma transação; `enfileirarMensagens` só depois do commit (falha da fila só loga `mensagem.fila_indisponivel`). Cliente anonimizada: todas as operações valem e a mensagem nasce `cancelada_anonimizacao`.
- **Política:** as três operações consultam `deps.politica` (remarcar = `agendar`; cancelar e marcar = `cancelar`), o gancho da E6.4.
- **Demonstração para o E2E:** `/dev/reserva-acoes` (`?vista=futura|iniciada|concluida|cancelada`), ligada pela `VITRINE_COMPONENTES=true`, com os mesmos componentes e ações que só validam (404 com a variável desligada).
- **Testes e E2E:** `tests/integration/reservas/alteracao/` (PostgreSQL real). `npx playwright test e2e/reserva-acoes.spec.ts e2e/reserva-acoes-sem-js.spec.ts` (build prévio e porta 3000 livre; 375×812, axe 4.14.0, teclado e sem JavaScript).
- **Estabilidade:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/reservas/alteracao/concorrencia.test.ts || break; done` (remarcar × remarcar, troca cruzada de profissionais, cancelar × remarcar, concluir × cancelar); fuso: `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/reservas tests/integration/reservas/alteracao/fuso.test.ts || break; done`.

## Termos, Privacidade e consentimento

- **Páginas:** `/termos` e `/privacidade` (públicas, estáticas, sem JavaScript nem banco). Cada uma mostra a versão, a data de vigência e um aviso destacado de que o **texto é provisório**: são textos próprios, ainda sem revisão jurídica, que precisam ser revisados antes de produção. A Privacidade tem a seção `#avaliacoes` (dados publicados, retirada, denúncia e pedido de anonimização).
- **Onde mudar:** os textos ficam em `src/config/termos.ts` (versão `VERSAO_TERMOS`, vigência e as três caixas de consentimento) e `src/config/termos-documentos.ts` (seções dos dois documentos). **Mudar qualquer texto exige mudar `VERSAO_TERMOS`** e acrescentar o novo hash em `HASHES_POR_VERSAO` (`src/config/termos.test.ts`): o teste de guarda falha com o hash calculado na mensagem. Nunca altere a entrada de uma versão antiga.
- **Registro:** cada aceite grava uma linha em `consentimento` com finalidade (`mensagens_reserva`, `convite_avaliacao`, `publicacao_avaliacao`), origem (`publico`/`equipe`), a versão vigente lida do servidor e o instante UTC. A equipe só declara `mensagens_reserva`; o convite e a publicação da avaliação são sempre da própria cliente (o banco recusa o contrário). Não há revogação por tela: a cliente pede ao salão ou à plataforma.
- **Para as próximas demandas:** a reserva chama `registrarConsentimentoDaReserva` (`src/server/consentimento/servico.ts`) dentro da transação; `consentimentoVigente` e `temConsentimentoDeMensagens` (`leitura.ts`) respondem ao convite de avaliação e às mensagens; o formulário público usa `CaixasConsentimento` (`src/components/consentimento/`).
- **Demonstração para o E2E:** `/dev/consentimento`, ligada pela `VITRINE_COMPONENTES=true`, com o mesmo componente e uma ação que só valida (404 com a variável desligada).
- **E2E:** `npx playwright test e2e/termos-privacidade.spec.ts e2e/consentimento.spec.ts e2e/consentimento-sem-js.spec.ts` (build prévio e porta 3000 livre).
- **Estabilidade:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/consentimento/concorrencia.test.ts || break; done`; fuso: `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/consentimento src/config/termos.test.ts || break; done`.

## Avaliações verificadas

Entrega da D-032 (E4.5). Migração `20261122000000_avaliacao` (tabelas `avaliacao_convite` e `avaliacao`; parecer em `docs/demandas/D-032/dba.md`).

- **Convite:** ao concluir a reserva a E3.5 registra o convite de WhatsApp (com o consentimento `convite_avaliacao`). O **worker** gera o link no envio (`src/server/avaliacoes/convite.ts`, injetado em `src/worker/handlers/whatsapp-reserva.ts`): `APP_URL/<slug>/avaliar/<token>`, com `token = base64url(HMAC-SHA256(AVALIACAO_SEGREDO, "convite-avaliacao:" + salaoId + ":" + reservaId))`. É determinístico (reenvio e retentativa geram o mesmo link), só o SHA-256 do token fica gravado e a validade é de **30 dias** a partir da primeira geração (não renova). O token nunca vai a `mensagem.parametros`, tentativas, logs nem ao payload do job. Rotacionar `AVALIACAO_SEGREDO` invalida os links ainda não usados.
- **Página `/<slug>/avaliar/<token>`:** a cliente (sem conta) dá nota de 1 a 5, comentário opcional (até 1000 caracteres) e autoriza a publicação (texto da D-023, finalidade `publicacao_avaliacao`); funciona sem JavaScript. Link malformado, desconhecido, de outro salão, usado, vencido, invalidado, de reserva que não está `concluido` ou de cliente anonimizada recebe **a mesma resposta** ("Link inválido ou expirado."), sem dados da reserva. A rota responde `Referrer-Policy: strict-origin`, `Cache-Control: no-store` e `X-Robots-Tag: noindex` (`next.config.ts`).
- **Envio:** uma avaliação por reserva, de reserva `concluido`; transação que toma reserva `FOR SHARE` → cliente `FOR SHARE` → convite `FOR UPDATE` (10 envios simultâneos do mesmo link geram exatamente 1 avaliação). Limite por IP no escopo `avaliacao` (`PROTECAO_LIMITE_IP_AVALIACAO`, **também na abertura da página**, então atrás de proxy configure `TRUSTED_PROXY_HOPS`) e Turnstile. Salão suspenso lê e envia normalmente.
- **Publicação:** imediata, na `/<slug>`, com nome "Primeiro nome + inicial" e mês/ano no fuso do salão; média com 1 casa (`round` do PostgreSQL) e contagem das visíveis; as 10 mais recentes. Visível = não retirada **e** reserva `concluido` **e** cliente não anonimizada (um único predicado em `src/server/repos/avaliacao-publica.ts`): corrigir a reserva para `nao_compareceu` oculta a avaliação e a volta a `concluido` a reexibe. Anonimizar a cliente apaga nome e comentário e invalida os convites. Denúncia e retirada pelo super admin: ver "Denúncias e moderação de avaliações".
- **Demonstração para o E2E:** `/dev/avaliacao` (`?vista=invalido`), ligada pela `VITRINE_COMPONENTES=true`, com o mesmo formulário e ação que só valida.
- **E2E:** `npx playwright test e2e/avaliacao.spec.ts e2e/avaliacao-sem-js.spec.ts` (build prévio e porta 3000 livre; sem banco; idioma do navegador em inglês).
- **Estabilidade:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/avaliacoes/concorrencia.test.ts || break; done`; fuso: `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/lib/format.test.ts src/server/avaliacoes tests/integration/avaliacoes || break; done`; pipeline com worker real: `npx vitest run --project integration tests/integration/avaliacoes/convite.test.ts`.

## Denúncias e moderação de avaliações (E8.4)

Entrega da D-035. Migração `20261124000000_avaliacao_denuncia` (tabela `avaliacao_denuncia`, enum `motivo_denuncia_avaliacao`, `UNIQUE (salao_id, id)` em `avaliacao`; parecer em `docs/demandas/D-035/dba.md`). Nenhuma variável de ambiente nova.

- **Denúncia pública:** em cada avaliação da `/<slug>` há "Denunciar avaliação" (`<details>`, funciona sem JavaScript): motivo (`ofensivo`, `falso`, `spam`, `dados_pessoais`, `outro`) e detalhe opcional de até 500 caracteres, que só o super admin lê. Ordem: validar, limite por IP no escopo `denuncia` (`PROTECAO_LIMITE_IP_DENUNCIA`; atrás de proxy configure `TRUSTED_PROXY_HOPS`), Turnstile, `INSERT`. Sucesso, duplicada, acima do teto de 20 pendentes, avaliação retirada, de outro salão, inexistente ou id malformado recebem **a mesma resposta** ("Recebemos sua denúncia", PRG com `?denuncia=recebida`) e só o primeiro caso grava. A avaliação continua visível. Do denunciante guarda-se só `ip_hash` = HMAC-SHA256 do IP com `RATE_LIMIT_SEGREDO` (rotacioná-lo só quebra o dedupe das pendentes). No máximo uma denúncia pendente por avaliação e IP (índice único parcial, `ON CONFLICT … DO NOTHING`, nunca se captura 23505).
- **Moderação:** `/admin/avaliacoes` (fila: filtros GET por salão e estado `visível`/`retirada`/`com denúncia pendente`, 20 por página, mais recentes primeiro, datas em UTC rotuladas) e `/admin/avaliacoes/[id]` (retirar, restaurar, arquivar uma ou todas as denúncias pendentes). Só super admin com TOTP: sem sessão redireciona a `/admin/entrar`, gestor e profissional veem "Acesso negado". As ações são `defineAcaoAdmin` (`src/server/tenant/define-acao-admin.ts`; lê o cookie `ab_admin`): 401 sem sessão, 403 para qualquer sessão de salão ou admin sem TOTP, também em POST direto. Gestor e profissional não têm rota nem ação que edite ou apague avaliação.
- **Retirar/restaurar:** exigem motivo de 3 a 300 caracteres, sem e-mail nem telefone óbvios (o motivo vai para a auditoria: não coloque dados pessoais). Retirar define `retirada_em`/`retirada_por`, resolve as denúncias pendentes (`resolucao = 'retirada'`) e some da página, da média e da contagem; restaurar volta tudo e não reabre denúncias. Cada ação grava `avaliacao.retirar`, `avaliacao.restaurar` ou `avaliacao.denuncia_resolver` (arquivar, `resolucao = 'mantida'`) na **mesma transação**, com antes/depois; se a auditoria falhar, nada muda. Repetir a operação (retirar uma retirada, restaurar uma visível) é recusado sem escrever nem auditar. Nada é enviado a ninguém (sem mensagem, e-mail ou job).
- **Travas:** moderar toma `avaliacao … FOR UPDATE` (nunca o salão); a denúncia só insere (`FOR KEY SHARE` da FK), então retirar, restaurar, arquivar e denunciar em paralelo não geram impasse.
- **Demonstrações para o E2E (sem banco):** `/dev/denuncia` e `/dev/moderacao` (`?vista=detalhe`), ligadas pela `VITRINE_COMPONENTES=true`, com os mesmos componentes e ações que só validam.
- **Testes:** `npx vitest run src/server/denuncias src/app/admin src/app/dev` e `npx vitest run --project integration tests/integration/denuncias`; E2E: `npx playwright test e2e/denuncia.spec.ts e2e/denuncia-sem-js.spec.ts e2e/moderacao.spec.ts e2e/moderacao-sem-js.spec.ts` (build prévio e porta 3000 livre; idioma do navegador em inglês). Estabilidade: `for i in $(seq 10); do npx vitest run --project integration tests/integration/denuncias/concorrencia.test.ts tests/integration/denuncias/denunciar.test.ts || break; done`.

## Auditoria (serviço de escrita, E8.1)

`src/server/auditoria/` registra as ações do super admin na tabela `auditoria` (somente inserção: triggers do banco rejeitam UPDATE/DELETE/TRUNCATE). Não há tela nem consulta ainda (E8.3).

- `registrarAuditoria(ctx: AdminContext, entrada, r)` grava na MESMA transação da mutação (`r` obrigatório): se a gravação falha, a mutação é desfeita. O ator é sempre `ctx.usuarioId` e o resultado, `sucesso`.
- `registrarFalhaAuditoria(entrada)` grava `falha` em conexão própria; chame no `catch`, depois do rollback.
- `acao` e `entidade` vêm de listas fechadas em `tipos.ts` (acrescente por PR). `antes`/`depois`: JSON puro, até 6 níveis e 16 KiB; chaves suspeitas de segredo (`senha`, `token`, `totp`, ...) fazem a gravação FALHAR, nunca são redigidas. Grave só campos de negócio escolhidos, sem PII em valores livres.
- Testes: `npx vitest run src/server/auditoria` e `npx vitest run --project integration tests/integration/auditoria`.

## Super admin e TOTP (E1.5)

Acesso da operação da plataforma, só com senha **e** código TOTP (RFC 6238, HMAC-SHA1, 6 dígitos, 30 s, ±1 janela). Não há cadastro público: a única forma de criar a conta é o script abaixo (e, depois, o seed).

- **Criar a conta:** defina `SUPERADMIN_EMAIL` e `SUPERADMIN_PASSWORD` (12 a 1024 caracteres) no `.env` e rode `npm run superadmin:criar`. Imprime só `criado` ou `existente` (nunca a senha) e sai com 0; é idempotente (rodar de novo não troca a senha nem reseta o TOTP). E-mail que já é de gestor ou profissional: sai com 1 e nada muda. Com o compose: `docker compose exec -e SUPERADMIN_EMAIL=… -e SUPERADMIN_PASSWORD=… app node dist/scripts/superadmin-criar.js` (o `dist/` vai na imagem).
- **Primeiro acesso:** em `/admin/entrar`, senha correta sem TOTP leva ao cadastro: QR code (SVG gerado no servidor, sem serviço externo e sem JavaScript) e a chave em texto. O segredo só é ativado depois de confirmar um código válido. Os próximos acessos pedem senha e código.
- **Sessão própria:** cookie `ab_admin` (httpOnly, SameSite=Strict, Path `/admin`, Secure em produção), 30 min de inatividade e teto de 8 h, sem a renovação de 7/30 dias do salão. A etapa do código vale 10 min. Cada código só vale uma vez (anti-replay em `usuario.totp_ultimo_passo`). Limites por janela fixa de 15 min: 10 falhas de senha por e-mail e 5 falhas de código por usuário (a 6ª é recusada mesmo com o código certo).
- **Chave:** `ADMIN_TOTP_CHAVE` cifra o segredo (AES-256-GCM, AAD = id do usuário). Perdê-la ou trocá-la invalida todos os TOTP (reset manual na tabela de variáveis, seção "Proteção da página pública").
- **Auditoria:** `login.sucesso` e `totp.cadastrar` na mesma transação da sessão; `login.falha_senha` e `login.falha_totp` em conexão própria. Nunca guardam senha, código nem segredo.
- **Demonstração e testes:** `/dev/admin-entrar` (`?vista=codigo|cadastro`; `VITRINE_COMPONENTES=true`) e `npx playwright test e2e/admin-entrar.spec.ts e2e/admin-entrar-sem-js.spec.ts`; integração em `tests/integration/auth/admin/`. Estabilidade: `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/admin/concorrencia.test.ts || break; done`.

## Integrações (adaptadores)

Cada serviço externo fica atrás de uma **porta** (`src/server/integrations/<serviço>/port.ts`), com um adaptador `simulado` e um `real`. O adaptador é escolhido por uma variável de ambiente. A lógica de negócio pede as portas a `integracoes()` (`src/server/integrations/registry.ts`) e nunca importa um adaptador ou o SDK de um provedor.

| Integração | Seletor | `simulado` (padrão) | `real` |
|---|---|---|---|
| E-mail transacional | `EMAIL_ADAPTER` | grava cada mensagem na tabela `email_log` | SMTP (`nodemailer`), configurado pelas variáveis `SMTP_*` e `EMAIL_FROM` |
| Cloudflare Turnstile | `TURNSTILE_ADAPTER` | aceita só o token de teste documentado abaixo | `siteverify` da Cloudflare, com `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` |
| Armazenamento de fotos | `STORAGE_ADAPTER` | arquivos em `ARMAZENAMENTO_DIR` (padrão `.armazenamento`) | compatível com S3 (`@aws-sdk/client-s3`), configurado pelas variáveis `S3_*` |
| Mercado Pago (assinaturas) | `MP_ADAPTER` | estado nas tabelas `sim_mp_*` e checkout em `/dev/mp-checkout` | adaptador real: E6.6 (ainda recusado na inicialização) |
| WhatsApp Cloud API | `WHATSAPP_ADAPTER` | registra cada chamada em `sim_whatsapp_chamada` | adaptador real: E7.2 (ainda recusado na inicialização) |

- **Valores aceitos:** `simulado` ou `real`. Vazio ou ausente vale `simulado`. Com o `.env.example` sem alterações, os cinco ficam no modo simulado, sem nenhuma credencial.
- **Validação na inicialização:** o `check-env` (entrypoint da app e do worker) e o próprio worker validam o ambiente **antes** de migrar ou de processar qualquer coisa. Se faltar ou estiver inválida alguma variável exigida pelo modo `real`, o processo sai com código diferente de 0, e o log nomeia as variáveis, nunca os valores. Exemplo: `EMAIL_ADAPTER=real` sem `SMTP_HOST` nomeia `SMTP_HOST`. Com o `.env.example` sem alterações (em que `EMAIL_FROM` também está vazio), a saída real é `check-env: Variáveis de ambiente ausentes ou inválidas: EMAIL_FROM, SMTP_HOST`. Hoje `MP_ADAPTER=real` e `WHATSAPP_ADAPTER=real` são sempre recusados, nomeando o seletor.
- **No modo simulado**, as variáveis do provedor são ignoradas, mesmo com valores inválidos.
- **Modos ativos no log:** a app imprime `check-env: ambiente válido (adaptadores: armazenamento=simulado, email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)`, e o worker emite o evento JSON `worker.adaptadores` antes do primeiro heartbeat (`docker compose logs app worker`).
- **Build:** o `next build` não valida o ambiente e não precisa de `.env`. O registro só lê as variáveis no primeiro uso, em runtime.
- **Lint (RN-16):** fora de `src/server/integrations/**` e dos testes, a regra `no-restricted-imports` proíbe importar os SDKs dos provedores (`nodemailer`, `mercadopago`, `@cloudflare/*`, …) e os arquivos `real`/`simulado` dos adaptadores. A única exceção é `src/app/dev/**`, que pode usar o MP simulado. A regra `no-restricted-syntax` também proíbe escrever as URLs dos provedores (`challenges.cloudflare.com`, `api.mercadopago.com`, `graph.facebook.com`) fora das integrações.
- **Valores do plano:** o preço (R$ 79,00 por mês, `PRECO_MENSAL_CENTAVOS = 7900`) e o teste grátis (`DIAS_TESTE = 30`) ficam só em `src/config/plano.ts`.

### Adaptadores simulados

Os simulados que guardam estado usam o PostgreSQL. Assim, app, worker, Vitest e Playwright, que são processos diferentes, enxergam o mesmo estado.

> **Aviso:** o modo simulado é só para desenvolvimento e testes. **Não publique** uma instalação com `MP_ADAPTER=simulado` ou com outro seletor em `simulado`. Com o MP simulado, quem souber o ID de uma assinatura consegue autorizá-la em `/dev/mp-checkout`, e os e-mails e mensagens não saem de verdade. Além disso, o `POST /dev/mp-checkout/decisao` não verifica a origem da requisição (não tem proteção CSRF): um formulário de outro site consegue postar nele. Por isso, nunca publique com nenhum seletor em `simulado`. O bloqueio dos simulados em ambiente publicado fica para a etapa de publicação.

**Turnstile simulado.** Aceita só o token `XXXX.DUMMY.TOKEN.XXXX`, quantas vezes ele for apresentado, e recusa qualquer outro. `chaveDoSite()` devolve a chave de site de teste `1x00000000000000000000AA`. Os dois valores são os de teste documentados pela Cloudflare. Não há acesso à rede.

**E-mail simulado.** Cada e-mail enviado vira uma linha em `email_log`, com o destinatário, o assunto e o corpo em texto (o `html`, opcional, não é guardado). Para ler os últimos e-mails, por exemplo, para abrir um link de convite ou de recuperação de senha:

```bash
docker compose exec postgres psql -U agenda -d agenda_beleza -c "SELECT criado_em, destinatario, assunto, corpo FROM email_log ORDER BY criado_em DESC LIMIT 5"
```

Com outro usuário ou outra base no `.env`, troque `-U agenda -d agenda_beleza` pelos valores de `POSTGRES_USER` e `POSTGRES_DB`.

**Mercado Pago simulado.**
- `criarAssinatura` grava uma assinatura `pendente` em `sim_mp_assinatura`, com o valor do plano, e devolve a `urlCheckout` `${APP_URL}/dev/mp-checkout?assinatura=<id>`.
- **Checkout simulado** (`/dev/mp-checkout?assinatura=<id>`): a página mostra "Assinatura Agenda Beleza", o valor (R$ 79,00 por mês), os 30 dias grátis e os botões "Autorizar assinatura" e "Desistir". Ela não pede nenhum dado de cartão, funciona só pelo teclado e tem `noindex`. As duas decisões redirecionam (303) para a `urlRetorno` **gravada** na criação da assinatura, com o parâmetro `preapproval_id=<id>`, como o Mercado Pago faz. Nenhum endereço vindo do formulário é usado. "Autorizar" passa a assinatura para `autorizada`, com a próxima cobrança em 30 dias. Uma assinatura que não está pendente não muda.
- A rota `/dev/mp-checkout` (e o `POST` em `/dev/mp-checkout/decisao`) **só existe com `MP_ADAPTER=simulado`**: com outro valor, responde 404 sem consultar o banco. Um ID inexistente ou inválido também dá 404.
- **Disparos dos eventos do provedor:** são funções de controle do adaptador, usadas pelos testes (não há tela para isso). Cada disparo devolve a notificação de webhook no formato do MP (`x-request-id` e `x-signature` com HMAC-SHA256), que `validarWebhook` aceita. O segredo do simulado é `segredo-do-webhook-simulado`, público e sem valor fora daqui.

  ```ts
  import { criarMercadoPagoSimulado } from '@/server/integrations/mercadopago/simulado';

  const mp = criarMercadoPagoSimulado({ appUrl: 'http://localhost:3000' });
  await mp.autorizar(id);                   // pendente → autorizada; próxima cobrança em 30 dias
  await mp.aprovarCobranca(id);             // pagamento aprovado; próxima cobrança + 1 mês
  await mp.falharCobranca(id);              // pagamento recusado; estado e data não mudam
  await mp.cancelar(id);                    // → cancelada
  await mp.forcarErro('cancelarAssinatura'); // a próxima chamada dessa operação, de qualquer processo, lança ErroProvedor sem efeito
  ```

  Um disparo inválido para o estado atual (por exemplo, cobrar uma assinatura pendente) lança `OperacaoInvalidaNoProvedor` sem efeito. Os adiamentos de `adiarProximaCobranca` ficam em `sim_mp_adiamento` (`listarAdiamentos(id)`).

**WhatsApp simulado.** Cada chamada de `enviarModelo` vira uma linha em `sim_whatsapp_chamada`, com o destinatário, o modelo, os parâmetros, a chave de idempotência e o resultado, inclusive as que falham. O simulado **não** deduplica (isso é da fila de mensagens). Para forçar falhas:

```ts
import { criarWhatsAppSimulado } from '@/server/integrations/whatsapp/simulado';

const wa = criarWhatsAppSimulado();
await wa.forcarFalhas(2, 'temporaria');   // as 2 próximas chamadas, de qualquer processo, lançam ErroEnvioTemporario
await wa.forcarFalhas(1, 'permanente');   // a seguinte lança ErroEnvioPermanente
await wa.listarChamadas({ chaveIdempotencia: 'reserva:confirmacao:1' });
```

Cada falha forçada é consumida por uma única chamada, mesmo com envios concorrentes. As falhas pendentes ficam em `sim_whatsapp_falha_forcada`.

**Limpeza das tabelas dos simulados.** As tabelas `sim_*` guardam e-mails de gestores e telefones e nomes de clientes, e não entram na anonimização. Para esvaziá-las, **só na base local de desenvolvimento ou de teste** (o comando é destrutivo e não deve ser usado em nenhuma outra base):

```bash
docker compose exec postgres psql -U agenda -d agenda_beleza -c "DELETE FROM sim_mp_pagamento; DELETE FROM sim_mp_adiamento; DELETE FROM sim_mp_assinatura; DELETE FROM sim_mp_erro_forcado; DELETE FROM sim_whatsapp_chamada; DELETE FROM sim_whatsapp_falha_forcada;"
```

A ordem importa: pagamentos e adiamentos antes das assinaturas. A alternativa é `docker compose down -v`, que apaga o volume inteiro. As bases dos testes de integração são descartadas ao fim de cada execução e não precisam de limpeza.

## Fila de jobs e worker

O worker (`src/worker/main.ts` → `src/worker/iniciar.ts`) é um processo separado do Next.js, ligado ao mesmo banco. Ele consome a fila do [pg-boss](https://github.com/timgit/pg-boss) (versão fixada `12.38.0`), que fica no schema **`pgboss`**, separado do `public` gerido pelo Prisma. Nenhuma migração Prisma toca em `pgboss`.

- **Quem instala:** só o worker cria e migra o schema `pgboss` (no `start()`) e cria as filas. A app nunca o faz: antes do primeiro início do worker, enfileirar falha com `ErroFilaIndisponivel` (motivo `schema_ausente` ou `fila_inexistente`).
- **Filas** (`src/server/queue/filas.ts`, contratos; `src/worker/handlers/`, um arquivo por fila; `src/worker/handlers/registry.ts`, a lista):

  | Fila | Política | Payload | Agendamento (UTC) | Situação |
  |---|---|---|---|---|
  | `exemplo` | `standard` | `{ esperaMs?: 0..60000 }` | — | funcional (verificação manual) |
  | `whatsapp-reserva` | `exclusive`, chave obrigatória (`reserva:tipo:revisao`) | `{ mensagemId: uuid }` | — | funcional (D-024, ver "Mensagens de WhatsApp") |
  | `assinatura-prazos` | `exclusive` | `{}` | `*/5 * * * *` | stub (E6.3) |
  | `reconciliar-mensagens` | `exclusive` | `{}` | `* * * * *` | funcional (D-024) |

  No início, o worker cria as filas que faltam, recusa iniciar se a política de uma fila existente divergir (`worker.falha_inicio`, `motivo: politica_divergente`; a política é imutável), aplica o retry do ambiente (`updateQueue`), registra um consumidor por fila e sincroniza os agendamentos: cria ou atualiza os crons e remove os que não estão mais no registro. Reiniciar não duplica nada.
- **Enfileirar** (`enfileirar(fila, payload, { chave })` de `src/server/queue/client.ts`):
  - **só depois do commit** da transação de negócio. O cliente tem conexão própria (pool de 2), não aceita transação e não participa dela;
  - o payload é validado antes de qualquer I/O: objeto estrito só com IDs (UUID), sem dados pessoais. Campo extra, id inválido ou payload que não é objeto lançam `ErroPayloadInvalido`, sem criar job;
  - `chave` vira a `singletonKey`. Nas filas `exclusive`, enquanto houver um job com a mesma chave em `created`, `retry` ou `active`, um novo `enfileirar` devolve `{ criado: false, motivo: 'chave_em_uso' }`; depois que ele termina (concluído ou falho), a chave pode ser usada de novo. Sem chave, uma fila `exclusive` aceita um job pendente por vez (é o que impede varreduras sobrepostas nos crons). A deduplicação definitiva das mensagens fica no banco de domínio (`UNIQUE (reserva_id, tipo, revisao)`, D-024);
  - falha de banco ou de schema vira `ErroFilaIndisponivel`, sem URL nem senha, e o cliente não tenta de novo.
- **Novas tentativas** (valem para todo job, inclusive os dos crons; padrões no `.env.example`):

  | Variável | Faixa | Padrão | Significado |
  |---|---|---|---|
  | `QUEUE_RETRY_LIMIT` | 0 a 20 | `4` | novas tentativas depois da 1ª execução (4 = 5 execuções no total) |
  | `QUEUE_RETRY_DELAY_SECONDS` | 1 a 3600 | `30` | atraso `d` antes da 1ª nova tentativa |
  | `QUEUE_RETRY_BACKOFF` | `true`/`false` | `true` | backoff exponencial com jitter |

  Com backoff, a k-ésima espera fica entre `d·2^(k−1)` e `d·2^k` segundos. Com os padrões: [30, 60], [60, 120], [120, 240] e [240, 480] s, ou seja, de 7,5 a 15 min até a falha definitiva. Sem backoff, todas as esperas valem `d`. Valor inválido faz `check-env` e o worker falharem na inicialização nomeando a variável. A falha de um job não derruba o worker: esgotadas as tentativas, o job fica `failed`, consultável por id até a retenção.
- **Encerramento:** no SIGTERM ou SIGINT, o worker para de buscar jobs e espera até **25 s** os que estão em andamento (`stop({ graceful: true, timeout: 25000 })`); um 2º sinal é ignorado. Se todos concluírem, sai com 0 (`worker.encerrado`). Se o prazo estourar, sai com 1 (`worker.encerramento_forcado`): o job interrompido volta para nova tentativa e **consome uma tentativa**, então os handlers reais precisam ser idempotentes. O compose usa `stop_grace_period: 30s`.
- **Eventos de log** (uma linha JSON com `em` em UTC; nunca o payload, a `DATABASE_URL` ou credenciais): `worker.adaptadores`, `worker.iniciado` (lista de filas), `worker.heartbeat` (a cada 30 s), `worker.exemplo_iniciado`, `worker.job_concluido` e `worker.job_falhou` (fila, id, tentativa e, na falha, nome e mensagem do erro), `worker.erro_fila` e `worker.aviso_fila` (erros e avisos do pg-boss, inclusive queda de conexão: o worker continua e volta a buscar quando o banco responde), `worker.encerrando`, `worker.encerrado`, `worker.encerramento_forcado`, `worker.erro_encerramento`, `worker.ambiente_invalido` e `worker.falha_inicio` (saída 1). Na app, um erro do pg-boss vira `fila.erro`.
- **`application_name`:** as conexões aparecem em `pg_stat_activity` como `agenda-beleza:worker` e `agenda-beleza:app`. Se a `DATABASE_URL` trouxer `?application_name=…`, ele vence o do pg-boss e esses nomes somem do diagnóstico: não o use nas URLs.
- **Retenção (padrões do pg-boss):** um job `active` expira em 15 min, um job em `created`/`retry` é apagado em 14 dias e um job encerrado é apagado 7 dias depois. A limpeza é feita pelo worker em execução: com o worker parado, nada é apagado. O histórico de tentativas das mensagens não vem do pg-boss (é do domínio: `mensagem_tentativa`, D-024).

### Verificar o worker manualmente

- **Sem Docker:** `npm run worker` num terminal e `npm run fila:exemplo -- 3000` em outro. O log mostra `worker.exemplo_iniciado` e, 3 s depois, `worker.job_concluido`. Ctrl-C encerra com 0.
- **Encerramento gracioso no compose (CA-4 da D-008):**
  ```bash
  docker compose up -d --wait
  docker compose exec worker node dist/scripts/enfileirar-exemplo.js 20000   # job de 20 s
  docker compose logs -f worker      # espere worker.exemplo_iniciado; depois, em outro terminal:
  time docker compose stop worker    # menos de 30 s
  docker compose ps -a worker        # Exited (0)
  ```
  O log termina com `worker.encerrando`, `worker.job_concluido` e `worker.encerrado`.

### Conexões, privilégios e upgrade

- **Conexões em produção:** o pool do pg-boss usa conexões do mesmo cluster que o Prisma. Mantenha `instâncias_app × (10 + 2) + worker × (10 + 4) + 3 ≤ max_connections − superuser_reserved_connections − reserved_connections` (10 = Prisma por processo; 2 e 4 = pg-boss na app e no worker; 3 = `migrate deploy`, psql e administração). No compose (97 utilizáveis): 1 app + 1 worker = 29. Esta versão prevê **um** worker por banco.
- **Privilégios:** o papel do worker precisa de `CREATE` no database (ele cria o schema `pgboss` e fica dono dele). Com um papel único para app e worker (compose e v1), nada mais é necessário. Com papéis separados:
  ```sql
  GRANT CREATE ON DATABASE <base> TO <papel_worker>;
  -- depois do 1º start do worker (o schema precisa existir):
  GRANT USAGE ON SCHEMA pgboss TO <papel_app>;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO <papel_app>;
  ALTER DEFAULT PRIVILEGES FOR ROLE <papel_worker> IN SCHEMA pgboss
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO <papel_app>;
  ```
  O papel da app não precisa de `CREATE` nem de ser dono de nada em `pgboss`.
- **Upgrade do pg-boss:** a versão é exata (o `config.test.ts` confere `package.json` e lock) porque o `start()` do worker migra o schema `pgboss` sozinho, e o cliente da app (`migrate: false`) exige a mesma versão de schema. Toda mudança de versão é uma demanda própria, revisada pelo DBA: comparar `pgboss.schema` do `package.json` do pacote novo com o antigo; se mudar, ler o SQL de `getMigrationPlans(schema, versãoAtual)` (locks e tempo em volume), trocar app e worker **juntos** (mesma imagem) e documentar a reversão com `getRollbackPlans(schema, versãoNova)`, aplicada antes de voltar à imagem anterior. Evidência: `SELECT version FROM pgboss.version` antes e depois, e o `tests/integration/worker/schema.test.ts` verde.
- **Reverter numa base local:** `docker compose down -v`. `DROP SCHEMA pgboss CASCADE` (com o worker parado) remove só a fila, sem tocar em `public`.

## Mensagens de WhatsApp (outbox, envio, tentativas e backoff)

Pipeline da D-024 (E7.1). Ainda não há tela nem rota: as demandas de reserva (E3.2, E3.4, E3.5), de avaliação (E4.5), de anonimização (E5.2), de situação (E7.3) e do super admin (E8.3) usam as funções abaixo. O adaptador real do WhatsApp é a E7.2; até lá `WHATSAPP_ADAPTER=simulado` (o real ainda é recusado na inicialização).

- **Tipos e chave:** `confirmacao`, `remarcacao`, `cancelamento` e `convite_avaliacao`. Uma mensagem por `reserva:tipo:revisao` (`<reservaId>:<tipo>:<revisao>`): é a `UNIQUE` do banco, a `singletonKey` do pg-boss e a chave de idempotência entregue ao adaptador. Revisões: `confirmacao` e `convite_avaliacao` = 0; `remarcacao` e `cancelamento` = `reserva.revisao` (a E3.4 incrementa antes de registrar).
- **Estados:** `pendente` → `enviando` → `enviada`; `falhou` (só sai por reenvio manual); `nao_enviada` (sem consentimento da finalidade); `substituida` (obsoleta ou trocada por evento posterior); `cancelada_anonimizacao` (cliente anonimizada). `enviada`, `nao_enviada`, `substituida` e `cancelada_anonimizacao` são finais.
- **Como a reserva grava a mensagem** (`src/server/mensagens/`): dentro da transação do evento, `registrarMensagem(ctx, { reservaId, tipo }, agora, r)` (outbox: `INSERT … ON CONFLICT DO NOTHING`, sem rede); **depois do commit**, `enfileirarMensagens([...])`, que nunca lança (falha da fila vira o log `mensagem.fila_indisponivel`, só com IDs, e a reconciliação recupera). Remarcação substitui `pendente` de confirmação e remarcação de revisão menor; cancelamento substitui `pendente` de confirmação e remarcação.
- **Elegibilidade:** `confirmacao`, `remarcacao` e `cancelamento` exigem consentimento da finalidade `mensagens_reserva`; `convite_avaliacao`, o da finalidade `convite_avaliacao`. Avaliada no registro (nasce `nao_enviada`, sem job) e de novo no envio. Cliente anonimizada nunca recebe.
- **Envio** (`enviarMensagem`, chamado pelo handler `whatsapp-reserva`): três tempos curtos e **nenhuma transação aberta durante a chamada ao adaptador**: reivindica `pendente → enviando` (atômico, só uma execução vence), lê reserva/serviços/salão/cliente e confere se a mensagem ainda é vigente; chama a porta; fecha a tentativa e o estado. Cada chamada ao adaptador é uma linha em `mensagem_tentativa`. O telefone é o da cliente no momento do envio e os parâmetros (`salao`, `servicos`, `profissional`, `data`, `horario`; o cancelamento não leva `profissional`) vêm da reserva no fuso do salão.
- **Tentativas e backoff:** falha temporária (`ErroEnvioTemporario`, erro desconhecido ou `NaoImplementado`) devolve a mensagem a `pendente` e o handler lança um erro fixo para o pg-boss reagendar com `QUEUE_RETRY_LIMIT`/`QUEUE_RETRY_DELAY_SECONDS`/`QUEUE_RETRY_BACKOFF`; esgotadas as tentativas (`retryLimit + 1` do próprio job) vai a `falhou` e o job termina `completed`. Falha permanente (`ErroEnvioPermanente`) vai a `falhou` na hora. Nada disso altera a reserva.
- **Reconciliação** (cron de 1 min, só olha `mensagem`; prazos em `src/server/mensagens/config.ts`, sem variável de ambiente): `pendente` com `atualizado_em` há mais de **2 min** é reenfileirada com a mesma chave (se já há job, nada se faz); `enviando` há mais de **5 min** vira `falhou/resultado_incerto` (o envio pode ter ocorrido: **nunca** reenvia sozinha). Lotes de 100, mais antigas primeiro. Um sucesso tardio do adaptador corrige `resultado_incerto` para `enviada`. O prazo de 5 min fica acima do timeout máximo do adaptador real (60 s, E7.2) e abaixo da expiração de 15 min do job.
- **Reenvio manual:** `reenviarMensagem(ctx, mensagemId, agora)` aceita só `falhou` e ainda vigente do salão do contexto; volta a `pendente` (mantém as tentativas) e enfileira depois do commit. Devolve `reenfileirada` ou `recusada` (`nao_falhou`, `obsoleta`, `cliente_anonimizada`). Quem pode chamar (e a auditoria do super admin) é decisão da E7.3/E8.3: a função não verifica papel. `mensagensDaReserva(ctx, reservaId)` devolve a situação (sem destinatário, parâmetros nem id do provedor).
- **Link do convite de avaliação:** nunca é gravado (nem em `parametros`, tentativa, log, erro ou payload do job). O handler recebe um `GeradorLinkAvaliacao` e só o mantém em memória até a chamada ao adaptador. Enquanto a E4.5 não o injetar em `src/worker/handlers/whatsapp-reserva.ts`, o convite termina `falhou` com `erro_codigo = link_indisponivel` (reenviável). Recomendação à E4.5: token derivável por HMAC da reserva (`docs/demandas/D-024/design.md` §3.9).
- **Log:** só `mensagemId`, `tipo`, `revisao`, `tentativa`, `estado` e `erroCodigo` (eventos `mensagem.enviada`, `mensagem.tentativa_falhou`, `mensagem.encerrada`, `mensagem.nao_reivindicada`, `mensagem.nao_encontrada`, `mensagem.fechamento_ignorado`, `mensagem.reconciliacao` com contagens). Nunca telefone, nome, parâmetros, link nem a mensagem crua de um erro.
- **Estabilidade:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/mensagens/concorrencia.test.ts tests/integration/mensagens/idempotencia.test.ts || break; done`; fuso: `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/mensagens src/lib/format.test.ts || break; done`.

## Criação de reserva (serviço de domínio)

Entrega da D-025 (E3.2). A reserva manual da equipe (E3.4, ver "Reserva manual e encaixe") e a página pública (E4.1/E4.2) chamam `criarReserva(ctx, entrada, deps?)` (`src/server/reservas/criar-reserva.ts`, sem `'use server'` e sem `next/*`). Não há migração nem variável de ambiente nova.

- **Resultado discriminado, nunca exceção de negócio:** `criada`, `repetida`, `horario_indisponivel` (causa `revalidacao` ou `23P01`), `servico_indisponivel`, `profissional_indisponivel`, `invalido` (campos `servicos`, `inicio`, `nome`, `telefone`, `chave`), `consentimento_ausente`, `chave_reutilizada`, `recusado` (motivo da E4.2) e `salao_indisponivel`. Só 401/403/404 são `ErroDeDominio`; `RangeError` é erro de programação (`agora` inválido, `encaixe` no público).
- **O que grava, numa só transação (tudo ou nada):** cliente (`upsertCliente`, por salão + telefone E.164), reserva `confirmado` com `revisao 0` e `ocupado_ate = fim + intervalo`, itens em sequência com o **snapshot** de preço e duração lido sob trava, consentimento (D-023) e o registro `pendente` da mensagem de `confirmacao` (D-024). **Depois do commit**, `enfileirarMensagens`: falha da fila nunca desfaz a reserva (a reconciliação a recupera).
- **Revalidação no servidor:** dentro da transação, com `consultarDisponibilidade` (D-018) sobre o leitor da transação: funcionamento do salão, jornada, bloqueios, grade, antecedência, janela e intervalo. Não há segunda implementação da regra. O `encaixe` (`modo: 'encaixe'`, só equipe) pula essa revalidação, mas mantém as travas, `inicio >= agora` e a constraint.
- **Conflito de horário:** o banco decide. O `23P01` da exclusion `reserva_sem_sobreposicao` (reconhecido por SQLSTATE **e** nome, depois do rollback) vira `horario_indisponivel` com `causa: '23P01'`.
- **Idempotência:** `chaveRequisicao` (UUID do formulário público) com `UNIQUE (salao_id, chave_requisicao)`: a repetição devolve `repetida` com o mesmo `id` sem revalidar; chave de outra reserva (outro horário, profissional ou serviços) devolve `chave_reutilizada` sem expor nada.
- **Ordem de travas** (sem ciclo; E3.5 deve repeti-la): salão `FOR SHARE` → profissional `FOR NO KEY UPDATE` → serviços `FOR SHARE` por `id` → cliente (upsert) → reserva → itens → consentimento → mensagem. O salão `FOR SHARE` não conflita com outras reservas, só com quem grava regras, slug, perfil ou funcionamento. O profissional é tomado com `FOR NO KEY UPDATE` (DEF-1): serializa as reservas do mesmo profissional e evita o `40P01` dos speculative tokens do `ON CONFLICT` com a exclusion; E3.4/E3.5 devem fazer o mesmo em todo comando que insira ou atualize `reserva` para status ocupante (criar, reagendar, voltar a `confirmado`); cancelar pode manter `FOR SHARE`.
- **Risco aceito:** a exclusion constraint **não cobre `bloqueio`**, e criar um bloqueio só toma `FOR KEY SHARE` no profissional. Um bloqueio criado entre a revalidação e o INSERT pode coexistir com a reserva. Não se trava para não serializar a agenda; a tela de bloqueios já mostra as reservas cobertas.
- **Pontos de extensão:** `deps.antesDaReserva` (E4.2: limite de reservas futuras, entre o upsert e o INSERT), `deps.politica` (E6.4: estado da assinatura; hoje `permitirTudo`) e `deps.enfileirar`. `deps.aposRevalidar` é só de teste (barreira de concorrência) e nada em produção o define.
- **Log:** evento `reserva.criar` só com `reservaId`, `salaoId`, `profissionalId`, `origem`, `modo`, `resultado`, `causa` e `repetida`; nunca nome, telefone, chave, aceites nem mensagem do banco.
- **Estabilidade:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/reservas/concorrencia.test.ts tests/integration/reservas/idempotencia.test.ts || break; done`; fuso: `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/reservas tests/integration/reservas/fuso.test.ts || break; done`.

## Página pública do salão e reserva

Entrega da D-026 (E4.1). A cliente (sem conta) abre `/<slug>` no celular, vê o perfil do salão e reserva um ou mais serviços com um profissional. Não há migração, variável de ambiente nem dependência nova.

- **Rota:** `src/app/(publico)/[slug]/page.tsx` (dinâmica, `ƒ` no build; `/termos` e `/privacidade` seguem estáticas). O slug é resolvido só por `resolverSalaoPorSlug` (atual ou histórico): **slug histórico responde 308** para `/<slugAtual>` preservando a query; inexistente, malformado, com maiúsculas ou em `SEGMENTOS_RESERVADOS` responde 404 sem consultar o banco. Rotas estáticas têm precedência sobre `[slug]`.
- **Perfil:** nome (`<h1>`), fotos, descrição, serviços, equipe, horário de funcionamento, endereço, contato, formas de pagamento e comodidades. Campo vazio omite a seção; nada interno (e-mail do gestor, ids além dos necessários) é exposto. Não há seção de avaliações (E4.5).
- **Fluxo (cada passo é um GET; o último é uma Server Action):** serviços → profissional (ou "Sem preferência") → dia (14 por página) → horário → dados (nome, telefone e consentimento da D-023) → confirmação. O estado vive só na query string (`s` repetido na ordem da lista, `p`, `data`, `h`, `de`, `aviso`); parâmetro inválido volta ao passo anterior, nunca vira 500. Funciona sem JavaScript. Os horários vêm só de `consultarDisponibilidade` (fuso do salão); a UI não os calcula.
- **Reserva:** `reservarPelaPagina` (`src/server/reserva-publica/servico.ts`) chama `criarReserva` com `modo: 'normal'` (nunca encaixe). `chaveRequisicao` é gerada no render do passo de dados e reenviada em campo oculto: o duplo envio devolve a mesma confirmação. Horário tomado, serviço ou profissional indisponíveis redirecionam para o passo com `?aviso=<código fechado>`; erros por campo ficam na resposta, com os valores digitados.
- **"Agendamento indisponível":** `agendamentoDisponivel` (`src/server/reserva-publica/agendamento.ts`, função pura e gancho da E6.4) decide por suspensão manual (`salao.suspenso_manual_em`), assinatura (`pendente`, `suspensa`, `encerrada` e `cancelada` após `acesso_ate` bloqueiam; `em_teste`, `ativa` e `em_carencia` permitem; salão sem assinatura é disponível) e ausência de serviço ofertável. Nesse estado a página mostra perfil e fotos, o aviso e nenhum formulário, e a ação recusa antes de qualquer escrita.
- **Pontos de extensão:** `deps.antesDaReserva` (usado pela proteção, ver a próxima seção) e `deps.politica` (E6.4) de `criarReserva`.
- **Demonstração para o E2E:** `/dev/reserva` (`?vista=indisponivel` ou `?vista=vazio`), ligada pela `VITRINE_COMPONENTES=true`, com o mesmo componente, dados em memória e uma ação que só valida (404 com a variável desligada).
- **Testes:** `tests/integration/reserva-publica/` (PostgreSQL real; `http.test.ts` sobe o `next start`, constrói o app se faltar `.next`, e prova o 308 com `fetch(redirect: 'manual')`). Fuso: `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/reserva-publica src/app/dev/reserva tests/integration/reserva-publica || break; done`. Estabilidade: `for i in $(seq 10); do npx vitest run --project integration tests/integration/reserva-publica/concorrencia.test.ts || break; done`.

## Proteção da página pública

Entrega da D-027 (E4.2). Sem migração. Módulo `src/server/protecao/` sobre `rate_limit_janela` (`incrementarJanela`, janela fixa em UTC). Ordem na reserva: salão indisponível (não consome cota) → limite por IP → Turnstile → limite por número → transação, com o limite de **3 reservas futuras confirmadas por número e salão** conferido em `antesDaReserva` (depois do upsert que trava a cliente: tentativas paralelas do mesmo número se serializam aí e a segunda enxerga a primeira; a requisição repetida, com a mesma chave, nunca é recusada nem consome o número).

| Variável | Padrão | Efeito |
|---|---|---|
| `TRUSTED_PROXY_HOPS` | `0` | 0 a 10. `0` ignora `X-Forwarded-For`; o App Router não expõe o IP do socket, então **todos caem no balde `desconhecido`** (limite global). Atrás de proxy/CDN, informe quantos (ex.: `1`): vale a N-ésima entrada de `X-Forwarded-For` contada da direita. Valor inválido falha no `check-env` |
| `RATE_LIMIT_SEGREDO` | vazio | HMAC das chaves por número (mínimo 32 caracteres). **Obrigatório com `NODE_ENV=production`**; fora dela há um padrão de desenvolvimento. O compose local traz um valor próprio. Trocá-lo zera as contagens por número |
| `AVALIACAO_SEGREDO` | vazio | HMAC dos links de avaliação enviados por WhatsApp (mínimo 32 caracteres; app e worker). **Obrigatório com `NODE_ENV=production`**; fora dela há um padrão de desenvolvimento. O compose local traz um valor próprio. **Rotação invalida os links ainda não usados** (o hash gravado deixa de casar) |
| `ADMIN_TOTP_CHAVE` | vazio | chave AES-256-GCM (32 bytes: base64 ou 64 hex; gere com `openssl rand -base64 32`) que cifra os segredos TOTP do super admin (D-034). **Obrigatória com `NODE_ENV=production`**; o compose local traz um valor próprio. **Perder ou trocar a chave invalida todos os TOTP**: reset manual = `UPDATE usuario SET totp_segredo_cifrado = NULL, totp_ativado_em = NULL, totp_ultimo_passo = NULL WHERE papel = 'super_admin'` e novo cadastro no próximo login |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | vazio | lidas só por `npm run superadmin:criar` (cria o super admin se não existir, imprime `criado` ou `existente`; senha de 12 a 1024 caracteres). Não são exigidas pelo `check-env` |
| `PROTECAO_JANELA_SEGUNDOS` | `900` | janela fixa (60 a 86400); permite rajada de até 2x na virada |
| `PROTECAO_LIMITE_IP_RESERVA` / `_DISPONIBILIDADE` / `_AVALIACAO` / `_DENUNCIA` | `10` / `60` / `5` / `5` | por IP e janela |
| `PROTECAO_LIMITE_NUMERO` | `5` | tentativas de reserva por número e salão na janela |

- **Chaves:** `pub:<escopo>:ip:<sha256(ip)>` e `pub:reserva:tel:<HMAC(RATE_LIMIT_SEGREDO, salaoId:E.164)>`; nunca IP nem telefone em claro. A chamada K+1 é negada.
- **API reutilizável (E4.5, E8.4):** `limitarPorIp(ip, 'avaliacao' | 'denuncia', agora)` devolve `{ permitido: true }` ou `{ permitido: false, reiniciaEm }`; escopos não compartilham contador. O IP vem de `extrairIp(headers, hops)`.
- **Sem 429 HTTP na página:** a página GET e a Server Action não fixam status; o limite aparece como aviso em pt-BR ("Muitas tentativas…") e, na consulta limitada, nenhum horário é calculado. O 429 real só caberia em route handler.
- **Turnstile:** verificação no servidor pela porta, com falha fechada. Simulado: campo `cf-turnstile-response` com o token documentado (campo oculto, funciona sem JavaScript; na vitrine `/dev/reserva` há um seletor para token inválido ou ausente). Real: script oficial com `TURNSTILE_SITE_KEY`; **exige JavaScript**.
- **Limpeza:** o worker apaga de hora em hora (UTC, minuto 17, fila `limpar-rate-limit`) as janelas anteriores a `agora - (maior janela + 1 h)`, em lotes de 1000; idempotente.
- **Efeito colateral aceito:** mais de `PROTECAO_LIMITE_NUMERO` envios idênticos simultâneos do mesmo número, antes de qualquer commit, ficam limitados.
- **Testes:** `tests/integration/protecao/`. Estabilidade: `for i in $(seq 10); do npx vitest run --project integration tests/integration/protecao/concorrencia.test.ts || break; done`. E2E: `npx playwright test e2e/protecao.spec.ts e2e/protecao-sem-js.spec.ts`.

## Interface e acessibilidade

Base visual e de navegação (D-009). Toda tela compõe estas peças; não crie cores, fontes, formatadores nem caminhos próprios.

### Tema (`src/app/globals.css`)

Tokens em `:root`, com nomes em pt-BR. **Só o `globals.css` tem literais de cor** (`#rrggbb`, dentro do `:root`). Componentes e layouts usam apenas `var(--…)`, e os testes `src/app/globals.test.ts` e `src/components/conformidade.test.ts` conferem isso.

| Grupo | Tokens |
|---|---|
| Fundo e superfície | `--cor-fundo`, `--cor-superficie`, `--cor-superficie-alt` |
| Texto | `--cor-texto`, `--cor-texto-suave` |
| Bordas | `--cor-borda-controle` (controles, contraste ≥ 3:1), `--cor-borda-sutil` (divisores) |
| Ações | `--cor-primaria`, `--cor-primaria-forte`, `--cor-sobre-primaria`, `--cor-perigo`, `--cor-perigo-forte`, `--cor-sobre-perigo` |
| Foco | `--cor-foco`, `--foco-largura` (3px), `--foco-afastamento` |
| Alertas | `--cor-{info,sucesso,aviso,erro}-{fundo,texto}` |
| Tipografia | `--fonte-titulo`, `--fonte-corpo`, `--texto-sm` … `--texto-3xl`, `--altura-linha` |
| Espaço e forma | `--espaco-1` … `--espaco-16` (base 0,25 rem), `--raio`, `--raio-grande`, `--largura-conteudo`, `--largura-lateral`, `--alvo-minimo` (44 px) |

- Contraste WCAG AA de todos os pares conferido por teste (texto ≥ 4,5:1; bordas de controle e foco ≥ 3:1). Nenhum token tem matiz em [290°, 360°) com saturação ≥ 20% (sem rosa genérico).
- **Ponto de quebra único:** `@media (min-width: 48rem)` (768 px), mobile-first. Nenhuma outra media query de largura é aceita.
- Foco visível por `:focus-visible` (contorno de 3 px). Nunca use `outline: none`/`0`. `prefers-reduced-motion: reduce` desliga transições.

### Fontes

| Uso | Família | Arquivo (`src/app/_fontes/`) | Origem | sha256 |
|---|---|---|---|---|
| Títulos | Fraunces (variável) | `fraunces-latin-opsz-normal.woff2` | `@fontsource-variable/fraunces@5.3.0` | `7234ed86…e0d783` |
| Corpo e controles | Source Sans 3 (variável) | `source-sans-3-latin-wght-normal.woff2` | `@fontsource-variable/source-sans-3@5.3.1` | `19143dca…60c7d5` |

As duas têm licença SIL OFL 1.1 (`OFL-Fraunces.txt` e `OFL-SourceSans3.txt`, ao lado dos arquivos). Elas são carregadas por `next/font/local` (`src/app/fontes.ts`), então o build não acessa servidor de fontes. Os pacotes **não** ficam instalados. Para atualizar, extraia os arquivos numa pasta temporária vazia e confira o sha256, que `src/app/fontes.test.ts` verifica:

```bash
npm pack @fontsource-variable/fraunces@5.3.0 @fontsource-variable/source-sans-3@5.3.1
mkdir -p fraunces sourcesans   # o -C do tar exige a pasta existente
tar -xzf fontsource-variable-fraunces-5.3.0.tgz -C fraunces      # package/files/fraunces-latin-opsz-normal.woff2 + package/LICENSE
tar -xzf fontsource-variable-source-sans-3-5.3.1.tgz -C sourcesans  # package/files/source-sans-3-latin-wght-normal.woff2 + package/LICENSE
sha256sum fraunces/package/files/fraunces-latin-opsz-normal.woff2 sourcesans/package/files/source-sans-3-latin-wght-normal.woff2
```

### Formatação (`src/lib/format.ts`)

Fonte única de formatação de exibição. Um teste recusa `Intl.NumberFormat` e `toLocale*String` em `src/`, e `Intl.DateTimeFormat` nas camadas de exibição. `src/server` pode usar `Intl.DateTimeFormat` para cálculo.

- `formatarMoeda(centavos)` → `R$ 79,00` (U+00A0 depois de `R$`, aritmética inteira; negativo, fração e não finito lançam `RangeError`). `formatarMoedaSemSimbolo(centavos)` → `79,00` (valor inicial do campo de preço).
- `formatarDuracao(minutos)` → `45 min`, `1 h`, `1 h 30 min` (inteiro maior que zero). `formatarLista(nomes)` → `A`, `A e B`, `A, B e C`.
- `formatarData`, `formatarHora` e `formatarDataHora(instante, fuso?)` → `dd/mm/aaaa`, `HH:mm` e `dd/mm/aaaa HH:mm`, no fuso IANA do salão (padrão `FUSO_PADRAO = 'America/Sao_Paulo'`, igual ao `@default` de `salao.fuso`), independentes do `TZ` do processo.
- `formatarDeslocamentoUtc(instante, fuso?)` → `UTC−03:00`.

### Componentes (`src/components/ui/`, sem barril)

Importe cada um pelo caminho: `@/components/ui/Button`, `Field`, `Select`, `Checkbox`, `ConfirmDialog`, `Alert`, `EmptyState`, `ErrorState`, `DataList` e `SlotGrid`.

- `Button`: variantes `primaria`, `secundaria`, `perigo` e `discreta`; `type="button"` por padrão; `ocupado` (com `disabled` e `aria-busy`); `desabilitadoFocavel` (`aria-disabled`, continua focável e bloqueia o clique).
- `Field`, `Select` e `Checkbox`: rótulo associado, `ajuda`, `erro` (com `aria-invalid`, `aria-describedby` e "Erro:" visível) e `obrigatorio` (escrito no rótulo).
- `ConfirmDialog`: `<dialog>` nativo com `showModal()`; foco inicial em Cancelar; ciclo de foco explícito; Esc cancela; clique no fundo não fecha; `onConfirmar` assíncrono deixa o diálogo ocupado e chama a ação uma vez; o foco volta à origem (ou ao `main`).
- `Alert` (`erro` com `role="alert"`, demais com `role="status"`), `EmptyState` e `ErrorState` (só recebem texto, nunca o `Error`).
- `DataList`: tabela semântica que empilha as linhas abaixo de 48 rem. **Limitação conhecida:** o Safari remove a semântica de tabela quando `tr`/`td` mudam de `display`. Chromium e Firefox preservam. Na v1, o `DataList` é usado só no painel da equipe.
- `SlotGrid`: rádios nativos num `fieldset`, com uma parada de Tab por grupo e setas para mudar a seleção. Mostra só os instantes recebidos (UTC), em `HH:mm` no fuso do salão. Rótulos repetidos (fim de horário de verão) ganham o deslocamento UTC.

### Layouts e navegação

- `@/components/layout/PublicLayout`: `variante="plataforma"` (padrão: Entrar e Criar conta) ou `variante="salao"` com `nomeSalao` (sem links de equipe). Rodapé com Termos de Uso e Política de Privacidade.
- `@/components/layout/PanelLayout`: props `papel` (`gestor` | `profissional`, vindo da sessão no servidor), `nomeSalao`, `caminhoAtual?` (padrão `usePathname()`) e `areaUsuario?`. Um papel inválido não mostra nenhum item. A navegação por papel é só interface: a autorização continua no servidor.
- `@/components/layout/AdminLayout`: navegação do super admin, com `caminhoAtual?`, `areaUsuario?` e `rotuloArea?`.
- Os três têm o link "Pular para o conteúdo" (1º focável), `header`, `nav` com nome próprio e um `main#conteudo` com `tabindex="-1"`. Abaixo de 48 rem, a navegação do painel e do admin fica atrás do botão "Menu" (um *disclosure*, que não prende o foco).
- `src/config/navegacao.ts` é a fonte única dos caminhos (`ROTAS`, com funções que codificam parâmetros), da navegação por papel (`NAVEGACAO_PAINEL`, `NAVEGACAO_ADMIN`, `itensDoPainel`) e do item ativo (`itemAtivo`). `SEGMENTOS_RESERVADOS` lista os primeiros segmentos de rota (`painel`, `admin`, `entrar`, …, `api`, `_next`). **E1.1/E2.5 devem recusar ou desviar slugs de salão que colidam com eles.** Toda pasta nova de primeiro nível em `src/app` precisa entrar em `ROTAS` (um teste confere).

### Vitrine `/dev/componentes` e E2E de acessibilidade

- A vitrine mostra todos os componentes, variantes e estados, com dados fictícios. O layout é escolhido por `?layout=publico|publico-salao|painel|admin&papel=gestor|profissional&caminho=/painel/…`.
- Ela só responde com `VITRINE_COMPONENTES=true` no processo do servidor, lido na requisição, ou em `next dev`. Sem isso, inclusive na imagem Docker e no `next start` padrão, responde **404**. O mesmo build serve os dois casos. Valores diferentes de `true`/`false` (`TRUE`, `1`) fazem o `check-env` recusar o ambiente na inicialização. Nunca ligue a variável em produção.
- O `playwright.config.ts` liga a variável no `webServer`. Se um `next start` sem a variável já estiver na porta 3000 (o `reuseExistingServer`, fora da CI), o teste falha com a mensagem "ligue VITRINE_COMPONENTES=true no servidor ou libere a porta 3000".
- `e2e/a11y-base.spec.ts` cobre: o menu móvel só pelo teclado; o diálogo com Tab, Shift+Tab, Esc e Enter, e o fundo inerte; as larguras de 320, 375 e 1280 px sem rolagem horizontal; o foco visível e o alcance por Tab de todos os interativos; alvos de 44 × 44 px; o texto a 200%; o movimento reduzido; as fontes aplicadas; e o axe (`@axe-core/playwright` e `axe-core` fixados em 4.14.0, etiquetas WCAG 2.0/2.1 A e AA, zero violações, nenhuma regra desligada).

```bash
npm run build && npx playwright test e2e/a11y-base.spec.ts   # porta 3000 livre
```

## CI

O workflow `CI` (`.github/workflows/ci.yml`, GitHub Actions) roda em todo pull request e em todo push em `main`. São seis jobs independentes e paralelos: a falha de um não esconde o resultado dos outros, e qualquer falha deixa o workflow vermelho. Cada job de Node usa o Node do `.nvmrc` (com cache do npm) e roda `npm ci` → `npm run db:generate` → gate, ou seja, os mesmos comandos da seção "Testes".

| Job (nome do check) | Comando local equivalente | Artefato |
|---|---|---|
| `lint` | `npm run lint` | n/a |
| `typecheck` | `npm run typecheck` | n/a |
| `build` | `npm run build` | n/a |
| `testes` | `docker compose up -d postgres`, `npm run db:migrate:deploy` e `npm run test:coverage` (falha abaixo de 90% de linhas) | `cobertura` (`coverage/`: `index.html`, `lcov.info`, `coverage-summary.json`) |
| `e2e` | `npx playwright install chromium` e `npm run test:e2e` (service `postgres:17`; base `_e2e` com seed recriada a cada execução; uma compilação no job; cache dos navegadores pela versão do `@playwright/test`) | `playwright-report` (relatório HTML) e `playwright-traces` (`test-results/`, só quando um teste falha) |
| `docker` | `docker compose config`, `docker build --target final .` (sem push) e `sh docker/smoke.sh` (sobe o compose do zero com `--build --wait`, exige `GET /api/health` 200 e `Referrer-Policy: strict-origin` em `/confirmar-email` e `/redefinir-senha`; porta 3000 livre). Na CI o job termina com `docker compose down -v` | n/a |

- **Nomes dos checks:** na interface do PR aparecem como `CI / <job> (pull_request)` ou `(push)`. Os seis nomes (`lint`, `typecheck`, `build`, `testes`, `e2e`, `docker`) são os que a proteção de `main` vai exigir. Não os renomeie sem atualizar esta seção e a proteção.
- **Artefatos:** ficam 14 dias no run. Baixe pela aba *Summary* do run, na seção *Artifacts*, ou com `gh run download <id-do-run> -n cobertura -D <pasta fora do repositório>` (ou `-n playwright-report`, `-n playwright-traces`). Os uploads rodam também quando o gate falha.
- **Nenhum segredo necessário:** o workflow não usa `secrets.` e não define nenhum `*_ADAPTER`, então todas as integrações ficam nos adaptadores simulados. A senha `agenda_dev` do service é a de desenvolvimento do `.env.example`, num container descartado ao fim do job. O token do workflow só tem `contents: read`.
- **PostgreSQL da CI:** o service usa `postgres:17`, a mesma imagem de `docker-compose.yml`. Mudar uma exige mudar a outra.
- **Concorrência:** um push novo no mesmo PR (ou em `main`) cancela o run anterior ainda em andamento.
- **Pendência manual (proteção de `main`):** o plano atual do repositório (privado, sem GitHub Pro/Team) não oferece proteção de branch nem rulesets, então um check vermelho **não** impede o merge. A decisão é do responsável pelo repositório: (a) assinar GitHub Pro/Team e exigir os seis checks acima em `main`; (b) tornar o repositório público e exigir os mesmos checks; ou (c) manter a disciplina manual de nunca mesclar com check vermelho.

## Credenciais para os serviços reais

Nenhuma credencial é necessária para rodar ou testar o projeto: tudo funciona com os adaptadores simulados. Elas só são exigidas quando o seletor do serviço vai para `real`. As variáveis ficam no `.env` (declaradas, vazias, no `.env.example`). **Nunca versione valores reais.**

Os seletores são `EMAIL_ADAPTER`, `WHATSAPP_ADAPTER`, `MP_ADAPTER`, `TURNSTILE_ADAPTER` e `STORAGE_ADAPTER` (`simulado` | `real`).

### E-mail transacional (`EMAIL_ADAPTER=real`, SMTP)

Credenciais: um provedor de e-mail transacional com acesso SMTP e um remetente verificado no provedor.

| Variável | Obrigatória | Conteúdo |
|---|---|---|
| `SMTP_HOST` | sim | servidor SMTP do provedor |
| `SMTP_PORT` | não | porta de 1 a 65535. Padrão: **587**, ou **465** com `SMTP_SECURE=true` |
| `SMTP_SECURE` | não | `true` (TLS implícito, normalmente na 465) ou `false` (padrão: STARTTLS) |
| `SMTP_USER` | em par | usuário SMTP; informe junto com `SMTP_PASSWORD` (os dois ou nenhum) |
| `SMTP_PASSWORD` | em par | senha ou chave SMTP (**credencial**) |
| `EMAIL_FROM` | sim | remetente: `email@dominio` ou `Nome <email@dominio>` |

- Com usuário e senha e `SMTP_SECURE=false`, a conexão **exige** STARTTLS (`requireTLS`): um servidor que não oferece TLS é recusado, e a senha nunca é enviada em texto claro.
- Os tempos-limite de conexão, saudação, socket e DNS são de 10 s cada. Erros de envio não carregam a senha nem a resposta do servidor.

### Cloudflare Turnstile (`TURNSTILE_ADAPTER=real`)

Credenciais: um widget Turnstile criado no painel da Cloudflare para o domínio da aplicação.

| Variável | Obrigatória | Conteúdo |
|---|---|---|
| `TURNSTILE_SITE_KEY` | sim | chave pública do widget (do site). É lida pelo servidor a cada requisição, e não no build, por isso não usa `NEXT_PUBLIC_` |
| `TURNSTILE_SECRET_KEY` | sim | chave secreta usada no `siteverify` (**credencial**) |

- O `siteverify` tem tempo-limite de 5 s. Se a Cloudflare estiver indisponível, a validação devolve "indisponível", sem lançar erro.

### Armazenamento de fotos (`STORAGE_ADAPTER=real`, compatível com S3)

**Não validado contra um provedor real:** os testes cobrem o adaptador com um cliente injetado e um servidor S3 falso local (sem rede). Credenciais: um bucket compatível com S3 (AWS S3, Cloudflare R2, MinIO etc.) e uma chave de acesso com permissão **só** de `PutObject`, `GetObject` e `DeleteObject` nesse bucket.

| Variável | Obrigatória | Conteúdo |
|---|---|---|
| `S3_ENDPOINT` | sim | URL `http`/`https` do serviço (na AWS, o endpoint regional) |
| `S3_REGIAO` | sim | região (`auto` no Cloudflare R2) |
| `S3_BUCKET` | sim | nome do bucket |
| `S3_ACCESS_KEY_ID` | sim | chave de acesso |
| `S3_SECRET_ACCESS_KEY` | sim | segredo da chave (**credencial**) |
| `S3_URL_PUBLICA` | não | URL pública do bucket ou da CDN (`https`, ou `http` em `localhost`), **sem listagem**; com ela a leitura pública devolve essa URL em vez de `/api/fotos/<id>` |
| `S3_FORCE_PATH_STYLE` | não | `true` (padrão, compatível com MinIO e R2) ou `false` (endereçamento virtual, aceito pela AWS) |

- O objeto é gravado sem ACL pública (a política de leitura é do bucket) e com `Content-Type: image/webp`. O adaptador nunca lista o bucket.
- Se usar `S3_URL_PUBLICA`, o bucket ou a CDN **não podem listar objetos**; isso é configuração do operador. A foto removida pode continuar visível pelo cache da CDN.

### Mercado Pago (`MP_ADAPTER=real`)

**Adaptador real: E6.6.** Hoje `MP_ADAPTER=real` é recusado na inicialização. Credenciais que serão necessárias: uma conta do Mercado Pago com assinaturas (planos de pagamento recorrente) habilitadas, o access token de produção e o segredo de assinatura dos webhooks. As variáveis serão definidas pela E6.6.

### WhatsApp Business Platform (`WHATSAPP_ADAPTER=real`)

**Adaptador real: E7.2.** Hoje `WHATSAPP_ADAPTER=real` é recusado na inicialização. Credenciais que serão necessárias: uma conta do WhatsApp Business Platform (Cloud API), um número de telefone registrado, um token de acesso e **4 templates aprovados**: confirmação, remarcação, cancelamento e o convite de avaliação (`convite_avaliacao`, acrescentado na D-024). Os parâmetros são nomeados e a E7.2 os mapeia à posição de cada template: `confirmacao` e `remarcacao` com `salao`, `servicos`, `profissional`, `data` e `horario`; `cancelamento` com `salao`, `servicos`, `data` e `horario`; `convite_avaliacao` com `salao` e `link`. As variáveis serão definidas pela E7.2.
