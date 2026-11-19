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
| `worker` | Processo separado (mesma imagem); valida o ambiente, registra os modos dos adaptadores e, por ora, só emite um heartbeat em JSON | `docker compose logs -f worker` |

App e worker rodam como usuário não root. Só a app aplica migrações.

- **Porta 5432 ocupada:** defina `POSTGRES_PORT` no `.env` (por exemplo, `5433`) e troque a porta também em `DATABASE_URL` e `TEST_DATABASE_URL`, porque o Node não interpola variáveis do `.env`. Dentro do compose, a app sempre usa `postgres:5432`.
- **Porta 3000 ocupada:** libere-a antes de subir (ela é fixa no compose).
- **Parar:** `docker compose down` (mantém os dados) ou `docker compose down -v` (apaga o volume do banco).
- **Logs:** `docker compose logs app`, `docker compose logs worker`.

A publicação em servidor (VPS) ainda não está definida: este compose é só para desenvolvimento e testes locais.

## Desenvolvimento sem Docker para a app

```bash
nvm use                       # Node 24 (.nvmrc)
npm ci
npm run db:generate           # obrigatório depois de todo npm ci (gera o cliente Prisma)
cp .env.example .env
docker compose up -d postgres
npm run dev                   # http://localhost:3000
npm run worker                # em outro terminal; Ctrl-C encerra
```

## Testes

Os testes de integração rodam contra um PostgreSQL **real** (sem mocks de banco).

```bash
docker compose up -d postgres  # cria agenda_beleza_test na primeira subida
npm ci
npm run db:generate
npm test                       # unidade + integração
npm run test:coverage          # o mesmo, com o gate de 90% de linhas (relatório em coverage/)
npm run test:e2e               # build + Playwright (viewport de celular); libere a porta 3000 antes
```

- Os testes de integração usam **somente** `TEST_DATABASE_URL`, nunca `DATABASE_URL`, e recusam rodar se as duas forem iguais. Sem `TEST_DATABASE_URL`, eles falham com uma mensagem que nomeia a variável.
- **Volume antigo sem a base de testes** (criado antes do script de initdb): `docker compose exec postgres createdb -U agenda agenda_beleza_test`.
- **Volume parcialmente inicializado:** se o `TEST_DATABASE_URL` tiver um nome de base inválido (fora de `[a-z0-9_]`, com mais de 63 caracteres (o harness de testes exige até 46), igual a `POSTGRES_DB` ou a `postgres`, `template0` ou `template1`), a primeira subida do `postgres` falha com `exited (1)`, e o log diz o motivo. Nos `up` seguintes, o initdb não roda de novo, e o banco sobe **sem** a base de testes. Corrija a variável e rode `docker compose down -v` antes de subir de novo (ou crie a base com o `createdb` acima).
- Navegador do E2E (uma vez por máquina): `npx playwright install chromium`.

### Banco de teste: template por execução e uma base por worker

O harness fica em `tests/support/` (`global-setup.ts`, `setup-arquivo.ts`, `db.ts`, `banco.ts`). A base de `TEST_DATABASE_URL` passa a ser só **administrativa**: o harness se conecta a ela para criar e apagar bases, mas não lê, grava, migra nem apaga nada dentro dela. A base de `DATABASE_URL` nunca é tocada.

1. **Uma vez por execução** (`globalSetup` do projeto `integration`): a guarda valida `TEST_DATABASE_URL` antes de qualquer conexão. Em seguida, apaga bases órfãs de execuções antigas e cria o template `<base>_r<exec>_tpl` a partir de `template0` (UTF-8). Depois aplica `prisma migrate deploy` nele e roda os **inicializadores de schema**, o ponto de extensão onde a E0.7 vai plugar o `pg-boss`. Por fim, confere que nenhuma sessão ficou aberta no template e o fecha para conexões (`ALLOW_CONNECTIONS false`).
2. **No início de cada arquivo de teste** (`setupFiles`): a base do worker `<base>_r<exec>_w<VITEST_POOL_ID>` é recriada a partir do template (`DROP DATABASE … WITH (FORCE)` + `CREATE DATABASE … TEMPLATE`). O `DATABASE_URL` do processo de teste passa a apontar para ela, e o pool do Prisma vai para 16 conexões. Cada arquivo começa com a base vazia e migrada. Não há `TRUNCATE` nem transação com rollback, então os testes de concorrência fazem `COMMIT` de verdade.
3. **No fim da execução**: o teardown apaga todas as bases da execução.

- **Execuções simultâneas** (dois terminais, o laço do tester enquanto você trabalha) são permitidas: cada execução tem nomes próprios (`exec` = instante + 2 caracteres aleatórios).
- **Até 4 workers** no projeto `integration` (`maxWorkers: 4` em `vitest.config.ts`).
- **Privilégio:** o papel de `TEST_DATABASE_URL` precisa de `CREATEDB`, e não de superusuário. No compose, o `POSTGRES_USER` já é superusuário. Na CI (job `testes`), o papel é o `POSTGRES_USER` do service `postgres` (`agenda`, superusuário). O service cria só a base de `DATABASE_URL` (`POSTGRES_DB=agenda_beleza`), e um passo cria a base de `TEST_DATABASE_URL` com `createdb` dentro do container do service (`docker exec <service> createdb -U agenda agenda_beleza_test`), porque o initdb do compose não roda lá.
- **Nome da base de teste:** no máximo **46 caracteres** em `[a-z0-9_]`, porque os sufixos `_r<10>_w999` precisam caber nos 63 do PostgreSQL. Um nome maior é recusado com uma mensagem que nomeia `TEST_DATABASE_URL`. O initdb do compose aceita até 63 caracteres, mas o harness exige até 46.
- **Orçamento de conexões:** cada execução usa até `maxWorkers × (POOL_MAX_TESTES + 2)` = 4 × 18 = 72 conexões. Mantenha `execuções × 72 + compose (≈ 3) + psql/IDE (≈ 5) ≤ max_connections` (100 no compose). Duas execuções simultâneas cabem, mas sem folga quando os picos coincidem. Se aparecer `53300 too many clients already`, pare app e worker durante o teste (`docker compose stop app worker`). Nos testes, um arquivo não satura o pool do Prisma e um `pg.Pool` ao mesmo tempo, e `criarPoolPg()` usa 12 conexões por padrão.
- **Sessão de superusuário aberta numa base de worker:** quando o papel de teste **não** é superusuário (por exemplo, um papel só com `CREATEDB`), um `psql` de superusuário conectado a uma base `…_w<N>` faz o `DROP … WITH (FORCE)` do reset falhar (`42501`). Feche essas sessões antes de rodar. No compose e na CI o papel é superusuário, e esse caso não ocorre.
- **Depuração:** os dados de um arquivo ficam na base `…_w<N>` só enquanto a execução dura, porque o teardown apaga tudo no final. Para inspecionar, rode o arquivo isolado e pause dentro do teste (ou consulte a base durante a execução). Uma execução interrompida deixa bases órfãs, que a varredura da próxima execução apaga quando tiverem **mais de 6 h**. Por isso, uma depuração parada por mais de 6 h pode perder a base para a varredura de outra execução. Limpeza manual: `psql "$TEST_DATABASE_URL" -Atc "SELECT datname FROM pg_database WHERE datname ~ '^agenda_beleza_test_r[0-9a-z]{10}_(tpl|w[0-9]{1,3})$'"` e, para cada nome, `DROP DATABASE IF EXISTS "<nome>" WITH (FORCE)`.
- **Teste único:** `npx vitest run --project integration tests/integration/db/reserva-exclusion.test.ts`. O template é criado e a base do worker é recriada do mesmo jeito.
- **Concorrência (CA-6 da D-005):** `for i in $(seq 10); do npx vitest run --project integration tests/integration/concorrencia --maxWorkers=2 --silent=false || break; done`. Com `--silent=false`, cada arquivo imprime `[CA-6] arquivo=… VITEST_POOL_ID=… base=…`.
- **Fábricas e sessão nos testes:** `tests/support/factories.ts` cria salões completos pelo Prisma (`criarSalaoCompleto`, `criarDoisSaloes`), e `tests/support/auth.ts` cria sessões reais (`credencialDoGestor`, `credencialDoProfissional`, `criarSuperAdmin`, `criarSessao`).

### Escopo de salão no servidor

- **Repositórios** (`src/server/repos/`): só eles importam o cliente Prisma. Toda operação de tenant recebe um `TenantContext` ou `SistemaContext` como primeiro argumento e filtra por `salao_id` na própria consulta. Um recurso de outro salão, inexistente ou com ID malformado gera a mesma resposta: `NaoEncontrado` (404). As leituras públicas (`repos/publico.ts`) resolvem o salão pelo slug e expõem só serviços e profissionais ativos.
- **Lint:** a regra `no-restricted-imports` proíbe importar `@/generated/prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg` e `src/server/repos/db` fora de `src/server/repos/**`, `src/worker/**`, `prisma/seed.ts`, `tests/**` e `*.test.ts(x)`. `import type` continua permitido.
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

## Integrações (adaptadores)

Cada serviço externo fica atrás de uma **porta** (`src/server/integrations/<serviço>/port.ts`), com um adaptador `simulado` e um `real`. O adaptador é escolhido por uma variável de ambiente. A lógica de negócio pede as portas a `integracoes()` (`src/server/integrations/registry.ts`) e nunca importa um adaptador ou o SDK de um provedor.

| Integração | Seletor | `simulado` (padrão) | `real` |
|---|---|---|---|
| E-mail transacional | `EMAIL_ADAPTER` | grava cada mensagem na tabela `email_log` | SMTP (`nodemailer`), configurado pelas variáveis `SMTP_*` e `EMAIL_FROM` |
| Cloudflare Turnstile | `TURNSTILE_ADAPTER` | aceita só o token de teste documentado abaixo | `siteverify` da Cloudflare, com `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` |
| Mercado Pago (assinaturas) | `MP_ADAPTER` | estado nas tabelas `sim_mp_*` e checkout em `/dev/mp-checkout` | adaptador real: E6.6 (ainda recusado na inicialização) |
| WhatsApp Cloud API | `WHATSAPP_ADAPTER` | registra cada chamada em `sim_whatsapp_chamada` | adaptador real: E7.2 (ainda recusado na inicialização) |

- **Valores aceitos:** `simulado` ou `real`. Vazio ou ausente vale `simulado`. Com o `.env.example` sem alterações, os quatro ficam no modo simulado, sem nenhuma credencial.
- **Validação na inicialização:** o `check-env` (entrypoint da app e do worker) e o próprio worker validam o ambiente **antes** de migrar ou de processar qualquer coisa. Se faltar ou estiver inválida alguma variável exigida pelo modo `real`, o processo sai com código diferente de 0, e o log nomeia as variáveis, nunca os valores. Exemplo: `EMAIL_ADAPTER=real` sem `SMTP_HOST` nomeia `SMTP_HOST`. Com o `.env.example` sem alterações (em que `EMAIL_FROM` também está vazio), a saída real é `check-env: Variáveis de ambiente ausentes ou inválidas: EMAIL_FROM, SMTP_HOST`. Hoje `MP_ADAPTER=real` e `WHATSAPP_ADAPTER=real` são sempre recusados, nomeando o seletor.
- **No modo simulado**, as variáveis do provedor são ignoradas, mesmo com valores inválidos.
- **Modos ativos no log:** a app imprime `check-env: ambiente válido (adaptadores: email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)`, e o worker emite o evento JSON `worker.adaptadores` antes do primeiro heartbeat (`docker compose logs app worker`).
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

## CI

O workflow `CI` (`.github/workflows/ci.yml`, GitHub Actions) roda em todo pull request e em todo push em `main`. São seis jobs independentes e paralelos: a falha de um não esconde o resultado dos outros, e qualquer falha deixa o workflow vermelho. Cada job de Node usa o Node do `.nvmrc` (com cache do npm) e roda `npm ci` → `npm run db:generate` → gate, ou seja, os mesmos comandos da seção "Testes".

| Job (nome do check) | Comando local equivalente | Artefato |
|---|---|---|
| `lint` | `npm run lint` | n/a |
| `typecheck` | `npm run typecheck` | n/a |
| `build` | `npm run build` | n/a |
| `testes` | `docker compose up -d postgres`, `npm run db:migrate:deploy` e `npm run test:coverage` (falha abaixo de 90% de linhas) | `cobertura` (`coverage/`: `index.html`, `lcov.info`, `coverage-summary.json`) |
| `e2e` | `npx playwright install chromium` e `npm run test:e2e` (uma compilação no job; cache dos navegadores pela versão do `@playwright/test`) | `playwright-report` (relatório HTML) e `playwright-traces` (`test-results/`, só quando um teste falha) |
| `docker` | `docker compose config` e `docker build --target final .` (sem push) | n/a |

- **Nomes dos checks:** na interface do PR aparecem como `CI / <job> (pull_request)` ou `(push)`. Os seis nomes (`lint`, `typecheck`, `build`, `testes`, `e2e`, `docker`) são os que a proteção de `main` vai exigir. Não os renomeie sem atualizar esta seção e a proteção.
- **Artefatos:** ficam 14 dias no run. Baixe pela aba *Summary* do run, na seção *Artifacts*, ou com `gh run download <id-do-run> -n cobertura -D <pasta fora do repositório>` (ou `-n playwright-report`, `-n playwright-traces`). Os uploads rodam também quando o gate falha.
- **Nenhum segredo necessário:** o workflow não usa `secrets.` e não define nenhum `*_ADAPTER`, então todas as integrações ficam nos adaptadores simulados. A senha `agenda_dev` do service é a de desenvolvimento do `.env.example`, num container descartado ao fim do job. O token do workflow só tem `contents: read`.
- **PostgreSQL da CI:** o service usa `postgres:17`, a mesma imagem de `docker-compose.yml`. Mudar uma exige mudar a outra.
- **Concorrência:** um push novo no mesmo PR (ou em `main`) cancela o run anterior ainda em andamento.
- **Pendência manual (proteção de `main`):** o plano atual do repositório (privado, sem GitHub Pro/Team) não oferece proteção de branch nem rulesets, então um check vermelho **não** impede o merge. A decisão é do responsável pelo repositório: (a) assinar GitHub Pro/Team e exigir os seis checks acima em `main`; (b) tornar o repositório público e exigir os mesmos checks; ou (c) manter a disciplina manual de nunca mesclar com check vermelho.

## Credenciais para os serviços reais

Nenhuma credencial é necessária para rodar ou testar o projeto: tudo funciona com os adaptadores simulados. Elas só são exigidas quando o seletor do serviço vai para `real`. As variáveis ficam no `.env` (declaradas, vazias, no `.env.example`). **Nunca versione valores reais.**

Os seletores são `EMAIL_ADAPTER`, `WHATSAPP_ADAPTER`, `MP_ADAPTER` e `TURNSTILE_ADAPTER` (`simulado` | `real`).

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

### Mercado Pago (`MP_ADAPTER=real`)

**Adaptador real: E6.6.** Hoje `MP_ADAPTER=real` é recusado na inicialização. Credenciais que serão necessárias: uma conta do Mercado Pago com assinaturas (planos de pagamento recorrente) habilitadas, o access token de produção e o segredo de assinatura dos webhooks. As variáveis serão definidas pela E6.6.

### WhatsApp Business Platform (`WHATSAPP_ADAPTER=real`)

**Adaptador real: E7.2.** Hoje `WHATSAPP_ADAPTER=real` é recusado na inicialização. Credenciais que serão necessárias: uma conta do WhatsApp Business Platform (Cloud API), um número de telefone registrado, um token de acesso e **3 templates aprovados** (confirmação, remarcação e cancelamento). As variáveis serão definidas pela E7.2.
