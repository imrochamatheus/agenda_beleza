# Guia de testes locais

Este guia mostra como configurar o ambiente do Agenda Beleza na sua máquina, conhecer as funcionalidades implementadas e testá-las passo a passo, manualmente e com os testes automatizados.

- **Base:** estado do repositório na branch `main` depois da D-048 (README completo, portas configuráveis). Quando a documentação antiga diverge do código, este guia segue o código e os testes. As divergências encontradas estão em [Divergências encontradas](#16-divergências-encontradas-na-documentação).
- **Referências:** o [`README.md`](../README.md) detalha cada funcionalidade e as credenciais dos serviços reais. O `CLAUDE.md` lista todos os comandos, inclusive os laços de estabilidade. O `PLAN.md` é a especificação, mas nem tudo o que ele descreve foi implementado.
- **Convenções:** `$APP` é a origem da aplicação no navegador (padrão `http://localhost:3000`). Ela precisa ser igual a `APP_URL`. Comandos `psql` aparecem no formato do Docker. Sem Docker, veja [como consultar o banco](#81-atalho-para-consultar-o-banco).

## Índice

1. [O que roda localmente](#1-o-que-roda-localmente)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Configuração do `.env`](#3-configuração-do-env)
4. [Bases de dados: desenvolvimento, teste e E2E](#4-bases-de-dados-desenvolvimento-teste-e-e2e)
5. [Caminho A: stack completa no Docker](#5-caminho-a-stack-completa-no-docker)
6. [Caminho B: app e worker pelo npm, PostgreSQL no Docker](#6-caminho-b-app-e-worker-pelo-npm-postgresql-no-docker)
7. [Portas ocupadas](#7-portas-ocupadas)
8. [Dados de demonstração e observação dos simuladores](#8-dados-de-demonstração-e-observação-dos-simuladores)
9. [Inventário de rotas](#9-inventário-de-rotas)
10. [Roteiro: visitante e cliente](#10-roteiro-visitante-e-cliente)
11. [Roteiro: gestor](#11-roteiro-gestor)
12. [Roteiro: profissional](#12-roteiro-profissional)
13. [Roteiro: super admin](#13-roteiro-super-admin)
14. [Roteiro: sistema (worker, fila, webhooks, prazos)](#14-roteiro-sistema-worker-fila-webhooks-prazos)
15. [Vitrines `/dev/*`, planejado e não implementado](#15-vitrines-dev-planejado-e-não-implementado)
16. [Divergências encontradas na documentação](#16-divergências-encontradas-na-documentação)
17. [Testes automatizados](#17-testes-automatizados)
18. [Diagnóstico](#18-diagnóstico)
19. [Encerrar e limpar](#19-encerrar-e-limpar)
20. [Registro de verificação deste guia](#20-registro-de-verificação-deste-guia)

---

## 1. O que roda localmente

| Peça | O que é | Real ou simulado no teste local |
|---|---|---|
| PostgreSQL 17 | banco único, com o schema `public` (Prisma) e o schema `pgboss` (fila) | **real**, sempre no Docker |
| App (Next.js 16) | páginas, Server Actions e as rotas `/api/*` | **real** |
| Worker (pg-boss) | processo separado que consome a fila: envio de WhatsApp, reconciliação, prazos da assinatura e limpeza dos limites | **real** |
| E-mail, WhatsApp, Mercado Pago, Turnstile e armazenamento de fotos | integrações atrás de adaptadores (`src/server/integrations/`) | **simulados** por padrão: não precisam de credenciais e guardam o estado no próprio PostgreSQL ou em disco |

Com os cinco seletores `*_ADAPTER=simulado`, nada sai da sua máquina. O banco e o worker continuam reais: as reservas, as mensagens, a fila e os retries rodam como em produção, e só a chamada ao provedor é trocada pelo simulador.

## 2. Pré-requisitos

- **Node 24:** o `.nvmrc` é a fonte da versão, e o `package.json` exige `>=24.15.0 <25`. Com o nvm: `nvm install && nvm use`.
- **Docker** com Compose v2: `docker compose version`.
- **Chromium do Playwright**, só para o E2E: `npx playwright install chromium`, uma vez por máquina.
- Opcionais para os testes manuais: `curl`, `openssl` (para gerar segredos e assinar webhooks) e um aplicativo autenticador TOTP (Google Authenticator, Aegis, 1Password…) ou o `oathtool`, para o super admin.
- Os comandos funcionam em caminhos com espaço e acento. Use aspas ao fazer `cd`.

## 3. Configuração do `.env`

### 3.1 Criar sem sobrescrever

```bash
[ -f .env ] || cp .env.example .env   # só cria se ainda não existir
```

O `.env` nunca é versionado nem entra na imagem. As variáveis já definidas no ambiente do processo prevalecem sobre ele. Um `.env` antigo pode não ter as chaves mais novas. Para ver quais faltam sem mostrar nenhum valor:

```bash
diff <(grep -oE '^[A-Z0-9_]+' .env.example | sort) <(grep -oE '^[A-Z0-9_]+' .env | sort)
```

As linhas com `<` são as chaves ausentes no seu `.env`. Quase todas têm um padrão seguro: veja a tabela a seguir para saber quais fazem falta no seu caminho. No caminho B, por exemplo, `ADMIN_TOTP_CHAVE` é necessária para usar o `/admin`. Acrescente só as chaves que faltam e não apague as suas.

> **Atenção:** o Node (`--env-file`) **não interpola** variáveis. Ao mudar uma porta, reescreva-a por extenso nas URLs (`DATABASE_URL`, `TEST_DATABASE_URL`, `APP_URL`).

### 3.2 Bloco local copiável (tudo simulado)

Este bloco funciona nos dois caminhos e não exige nenhuma credencial externa. Os valores são fictícios. Gere os segredos na sua máquina e **não copie valores de outro `.env`**.

```dotenv
# --- PostgreSQL (docker compose) ---
POSTGRES_USER=agenda
POSTGRES_PASSWORD=agenda_dev
POSTGRES_DB=agenda_beleza
POSTGRES_PORT=5432
DATABASE_URL=postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza
TEST_DATABASE_URL=postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza_test

# --- Aplicação e E2E ---
APP_PORT=3000
APP_URL=http://localhost:3000
E2E_PORT=3000
VITRINE_COMPONENTES=false

# --- Fila (worker) ---
QUEUE_RETRY_LIMIT=4
QUEUE_RETRY_DELAY_SECONDS=30
QUEUE_RETRY_BACKOFF=true

# --- Adaptadores: todos simulados (sem credenciais) ---
EMAIL_ADAPTER=simulado
WHATSAPP_ADAPTER=simulado
MP_ADAPTER=simulado
TURNSTILE_ADAPTER=simulado
STORAGE_ADAPTER=simulado
ARMAZENAMENTO_DIR=

# --- Segurança (gere os seus; veja abaixo) ---
TRUSTED_PROXY_HOPS=0
RATE_LIMIT_SEGREDO=
AVALIACAO_SEGREDO=
ADMIN_TOTP_CHAVE=
SUPERADMIN_EMAIL=
SUPERADMIN_PASSWORD=

# --- Proteção da página pública ---
PROTECAO_JANELA_SEGUNDOS=900
PROTECAO_LIMITE_IP_RESERVA=10
PROTECAO_LIMITE_IP_DISPONIBILIDADE=60
PROTECAO_LIMITE_IP_AVALIACAO=5
PROTECAO_LIMITE_IP_DENUNCIA=5
PROTECAO_LIMITE_NUMERO=5
```

As variáveis dos provedores reais (`WHATSAPP_*`, `SMTP_*`, `EMAIL_FROM`, `MP_*`, `TURNSTILE_*_KEY`, `S3_*`) podem ficar vazias ou ausentes: no modo simulado elas são **ignoradas**, mesmo com valores inválidos.

Para gerar os segredos locais:

```bash
openssl rand -base64 48 | tr -d '\n'; echo   # RATE_LIMIT_SEGREDO e AVALIACAO_SEGREDO (≥ 32 caracteres; use valores diferentes)
openssl rand -base64 32                      # ADMIN_TOTP_CHAVE (exatamente 32 bytes em base64)
```

- **Caminho A (Docker):** os três segredos podem ficar vazios. O `docker-compose.yml` fornece valores próprios de desenvolvimento, necessários porque a imagem roda com `NODE_ENV=production`.
- **Caminho B (npm):** `RATE_LIMIT_SEGREDO` e `AVALIACAO_SEGREDO` têm um padrão de desenvolvimento fora da produção, mas **`ADMIN_TOTP_CHAVE` não tem**. Preencha-a se for usar o `/admin`.
- `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD`: opcionais. Sem elas, o seed cria o super admin de demonstração. Veja a [seção 8](#8-dados-de-demonstração-e-observação-dos-simuladores).

### 3.3 Tabela completa das variáveis

Conferida com o `.env.example`, com `src/server/env.ts` e com os módulos `src/server/integrations/*/ambiente.ts`. Uma string vazia conta como ausente. Uma variável inválida faz o `check-env` (app) e o worker saírem com código 1, nomeando a variável e nunca o valor.

**PostgreSQL**

| Variável | Serviço | Finalidade | Valor local de exemplo | Obrigatória quando | Como verificar |
|---|---|---|---|---|---|
| `POSTGRES_USER` | compose (postgres) | usuário criado pela imagem oficial | `agenda` | sempre que usar o compose (padrão `agenda`) | `docker compose exec postgres psql -U agenda -d agenda_beleza -c 'select 1'` |
| `POSTGRES_PASSWORD` | compose (postgres) | senha desse usuário (só desenvolvimento) | `agenda_dev` | idem (padrão `agenda_dev`) | a `DATABASE_URL` conecta (`/api/health` = 200) |
| `POSTGRES_DB` | compose (postgres) | base de desenvolvimento criada no initdb | `agenda_beleza` | idem (padrão `agenda_beleza`) | `docker compose exec postgres psql -U agenda -l` |
| `POSTGRES_PORT` | compose (postgres) | porta publicada no host | `5432` (ou `5433` se ocupada) | opcional (padrão `5432`) | `docker compose ps postgres` mostra `0.0.0.0:<porta>->5432` |
| `DATABASE_URL` | app, worker, migrações, seed | banco da aplicação **fora** do container (no compose, a app e o worker usam o host `postgres`) | `postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza` | sempre (o `check-env` a exige) | `npm run db:migrate:deploy` ou `curl $APP/api/health` |
| `TEST_DATABASE_URL` | Vitest, initdb, E2E | base **administrativa** dos testes de integração; o E2E deriva dela `<nome>_e2e` | `postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza_test` | `npm test`, `test:integration`, `test:coverage` e `test:e2e` (ou use `E2E_DATABASE_URL`) | `npm run test:integration` sai sem "Defina TEST_DATABASE_URL" |

**Aplicação e E2E**

| Variável | Serviço | Finalidade | Valor local de exemplo | Obrigatória quando | Como verificar |
|---|---|---|---|---|---|
| `APP_URL` | app e worker | origem pública: monta os links de e-mail, convite, avaliação e retorno do checkout; o envio de fotos exige `Origin` igual a ela | `http://localhost:3000` | sempre (padrão `http://localhost:3000`); **`https://` com `MP_ADAPTER=real`** | um link em `email_log` começa com ela; enviar uma foto não dá 403 |
| `APP_PORT` | compose e `docker/smoke.sh` | porta publicada da app no host (no container é sempre 3000) | `3000` (ou `3100`) | opcional (padrão 3000) | `docker compose ps app` |
| `E2E_PORT` | Playwright | porta do `next start` do E2E; também define o `APP_URL` do servidor de teste (`http://127.0.0.1:<porta>`) | `3000` (ou `3110`) | opcional (padrão 3000) | o E2E sobe sem "port already in use" |
| `VITRINE_COMPONENTES` | app | liga as páginas `/dev/*` fora do `next dev` | `false` | opcional; só `true` ou `false` (`TRUE` ou `1` derrubam o `check-env`); **nunca `true` em produção** | `curl -o /dev/null -w '%{http_code}' $APP/dev/componentes` → 404 com `false` no `next start`/Docker |

**Fila e worker**

| Variável | Serviço | Finalidade | Valor local de exemplo | Obrigatória quando | Como verificar |
|---|---|---|---|---|---|
| `QUEUE_RETRY_LIMIT` | worker | novas tentativas depois da 1ª execução (0 a 20) | `4` | opcional (padrão 4) | log `worker.iniciado`; em teste rápido use `1` |
| `QUEUE_RETRY_DELAY_SECONDS` | worker | atraso antes da 1ª nova tentativa (1 a 3600 s) | `30` (`1` para testes rápidos) | opcional (padrão 30) | intervalo entre `worker.job_falhou` |
| `QUEUE_RETRY_BACKOFF` | worker | backoff exponencial com jitter (`true`/`false`) | `true` | opcional (padrão true) | idem |

**Seletores de adaptador** (`simulado` | `real`; vazio ou ausente = `simulado`)

| Variável | Serviço | Finalidade | Valor local de exemplo | Obrigatória quando | Como verificar |
|---|---|---|---|---|---|
| `EMAIL_ADAPTER` | app e worker | e-mail transacional (simulado → tabela `email_log`) | `simulado` | opcional | log `check-env: ambiente válido (adaptadores: … email=simulado …)` |
| `WHATSAPP_ADAPTER` | app e worker | mensagens de reserva (simulado → `sim_whatsapp_chamada`) | `simulado` | opcional | log JSON `worker.adaptadores` |
| `MP_ADAPTER` | app e worker | assinatura (simulado → `sim_mp_*` e `/dev/mp-checkout`) | `simulado` | opcional | `/dev/mp-checkout?assinatura=<id>` existe só no simulado |
| `TURNSTILE_ADAPTER` | app | anti-bot da reserva, avaliação e denúncia (simulado → token fixo em campo oculto) | `simulado` | opcional | o formulário público tem `cf-turnstile-response` oculto |
| `STORAGE_ADAPTER` | app (e seed) | fotos do salão (simulado → disco em `ARMAZENAMENTO_DIR`) | `simulado` | opcional | arquivos `fotos/*.webp` no diretório |

**WhatsApp real** (lidas só com `WHATSAPP_ADAPTER=real`)

| Variável | Serviço | Finalidade | Valor local de exemplo | Obrigatória quando | Como verificar |
|---|---|---|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | worker | token da Cloud API (credencial) | vazio | `WHATSAPP_ADAPTER=real` | `check-env` não o nomeia |
| `WHATSAPP_API_VERSION` | worker | versão da Graph API (`^v\d+\.\d+$`) | vazio (padrão `v25.0`) | opcional no real; se informada, precisa ser válida | idem |
| `WHATSAPP_PHONE_NUMBER_ID` | worker | id do número (só dígitos) | vazio | `WHATSAPP_ADAPTER=real` | idem |
| `WHATSAPP_TEMPLATE_CONFIRMACAO` | worker | nome do modelo aprovado (`[a-z0-9_]`) | vazio | `WHATSAPP_ADAPTER=real` | idem |
| `WHATSAPP_TEMPLATE_REMARCACAO` | worker | idem | vazio | `WHATSAPP_ADAPTER=real` | idem |
| `WHATSAPP_TEMPLATE_CANCELAMENTO` | worker | idem | vazio | `WHATSAPP_ADAPTER=real` | idem |
| `WHATSAPP_TEMPLATE_CONVITE_AVALIACAO` | worker | idem | vazio | `WHATSAPP_ADAPTER=real` | idem |
| `WHATSAPP_TEMPLATE_IDIOMA` | worker | idioma dos modelos | vazio (padrão `pt_BR`) | opcional no real | idem |

**E-mail real** (só com `EMAIL_ADAPTER=real`)

| Variável | Serviço | Finalidade | Valor local de exemplo | Obrigatória quando | Como verificar |
|---|---|---|---|---|---|
| `SMTP_HOST` | app | servidor SMTP | vazio | `EMAIL_ADAPTER=real` | `check-env` não o nomeia |
| `SMTP_PORT` | app | porta (1 a 65535) | vazio (padrão 587, ou 465 com `SMTP_SECURE=true`) | opcional | idem |
| `SMTP_USER` | app | usuário SMTP | vazio | opcional, **em par** com `SMTP_PASSWORD` | idem |
| `SMTP_PASSWORD` | app | senha SMTP (credencial) | vazio | opcional, em par com `SMTP_USER` | idem |
| `SMTP_SECURE` | app | TLS implícito (`true`) ou STARTTLS (`false`) | vazio (padrão `false`) | opcional | idem |
| `EMAIL_FROM` | app | remetente (`email@dominio` ou `Nome <email@dominio>`) | vazio | `EMAIL_ADAPTER=real` | idem |

**Mercado Pago real** (só com `MP_ADAPTER=real`)

| Variável | Serviço | Finalidade | Valor local de exemplo | Obrigatória quando | Como verificar |
|---|---|---|---|---|---|
| `MP_ACCESS_TOKEN` | app e worker | access token (credencial) | vazio | `MP_ADAPTER=real` | `check-env` não o nomeia |
| `MP_WEBHOOK_SECRET` | app | segredo HMAC das notificações (credencial) | vazio | `MP_ADAPTER=real` | idem |
| `MP_PREAPPROVAL_PLAN_ID` | app | id do plano (R$ 79,00/mês, 30 dias grátis) | vazio | `MP_ADAPTER=real` | idem |

**Turnstile real** (só com `TURNSTILE_ADAPTER=real`)

| Variável | Serviço | Finalidade | Valor local de exemplo | Obrigatória quando | Como verificar |
|---|---|---|---|---|---|
| `TURNSTILE_SITE_KEY` | app | chave pública do widget (lida em runtime, sem `NEXT_PUBLIC_`) | vazio | `TURNSTILE_ADAPTER=real` | `check-env` não a nomeia |
| `TURNSTILE_SECRET_KEY` | app | chave do `siteverify` (credencial) | vazio | `TURNSTILE_ADAPTER=real` | idem |

**Fotos**

| Variável | Serviço | Finalidade | Valor local de exemplo | Obrigatória quando | Como verificar |
|---|---|---|---|---|---|
| `ARMAZENAMENTO_DIR` | app e seed (só simulado) | diretório dos objetos | vazio (padrão `.armazenamento`; no compose, o volume `armazenamento` em `/app/.armazenamento`) | opcional | `ls .armazenamento/fotos` (caminho B) |
| `S3_ENDPOINT` | app | URL do serviço S3-compatível | vazio | `STORAGE_ADAPTER=real` | `check-env` não o nomeia |
| `S3_REGIAO` | app | região (`auto` no R2) | vazio | `STORAGE_ADAPTER=real` | idem |
| `S3_BUCKET` | app | bucket | vazio | `STORAGE_ADAPTER=real` | idem |
| `S3_ACCESS_KEY_ID` | app | chave de acesso | vazio | `STORAGE_ADAPTER=real` | idem |
| `S3_SECRET_ACCESS_KEY` | app | segredo da chave (credencial) | vazio | `STORAGE_ADAPTER=real` | idem |
| `S3_URL_PUBLICA` | app | URL pública do bucket/CDN, sem listagem | vazio (fotos por `/api/fotos/<id>`) | opcional | URL das fotos na página pública |
| `S3_FORCE_PATH_STYLE` | app | endereçamento por caminho | vazio (padrão `true`) | opcional | idem |

**Segurança e administração**

| Variável | Serviço | Finalidade | Valor local de exemplo | Obrigatória quando | Como verificar |
|---|---|---|---|---|---|
| `TRUSTED_PROXY_HOPS` | app | quantos proxies confiáveis contam no `X-Forwarded-For` (0 a 10) | `0` (todos os acessos caem no balde de IP `desconhecido`) | opcional; em produção atrás de proxy, informe | limite por IP compartilhado localmente |
| `RATE_LIMIT_SEGREDO` | app | HMAC das chaves por telefone e do `ip_hash` das denúncias (≥ 32) | gere com `openssl` | **`NODE_ENV=production`** (o compose já fornece um) | `check-env` em produção não o nomeia |
| `AVALIACAO_SEGREDO` | app e worker | HMAC dos links de avaliação (≥ 32); app e worker precisam do **mesmo** valor | gere com `openssl` | **`NODE_ENV=production`** (o compose já fornece um) | o link do convite abre o formulário, não "Link inválido" |
| `ADMIN_TOTP_CHAVE` | app | chave AES-256-GCM dos segredos TOTP (32 bytes em base64 ou 64 hex) | `openssl rand -base64 32` | **produção** e **qualquer uso do `/admin` fora do compose** | o cadastro do TOTP em `/admin/entrar` mostra o QR em vez de erro 500 |
| `SUPERADMIN_EMAIL` | `npm run superadmin:criar` e seed | e-mail do super admin | `admin@exemplo.test` | só para o script (validada se presente) | o script imprime `criado` ou `existente` |
| `SUPERADMIN_PASSWORD` | idem | senha (12 a 1024 caracteres) | uma senha local sua | só para o script | idem |

**Proteção pública** (janela fixa em UTC; a chamada K+1 é negada com um aviso em pt-BR, HTTP 200)

| Variável | Serviço | Finalidade | Valor local de exemplo | Obrigatória quando | Como verificar |
|---|---|---|---|---|---|
| `PROTECAO_JANELA_SEGUNDOS` | app e worker (limpeza) | duração da janela (60 a 86400) | `900` | opcional | `select chave, janela_inicio, contador from rate_limit_janela` (chaves só com hash) |
| `PROTECAO_LIMITE_IP_RESERVA` | app | envios de reserva por IP e janela | `10` | opcional | a 11ª tentativa mostra "Muitas tentativas…" |
| `PROTECAO_LIMITE_IP_DISPONIBILIDADE` | app | consultas de horários por IP | `60` | opcional | idem, sem horários calculados |
| `PROTECAO_LIMITE_IP_AVALIACAO` | app | abertura e envio do link de avaliação por IP | `5` | opcional | mensagem genérica de limite |
| `PROTECAO_LIMITE_IP_DENUNCIA` | app | denúncias por IP | `5` | opcional | idem |
| `PROTECAO_LIMITE_NUMERO` | app | tentativas de reserva por telefone e salão | `5` | opcional | aviso de limite para o mesmo número |

> **Teste manual e limites:** como `TRUSTED_PROXY_HOPS=0` põe todos os acessos no mesmo balde, um roteiro longo pode bater no limite de disponibilidade (60 consultas a cada 15 min). Para explorar à vontade, aumente os `PROTECAO_LIMITE_*` **só no seu `.env` local** (o E2E usa 100000) ou espere a janela virar.

### 3.4 Credenciais condicionais ao modo real

Só são exigidas quando o seletor correspondente vai para `real`. O código dos cinco adaptadores reais existe, mas **a integração com os provedores externos ainda não foi validada**. Segundo o README ("O que não foi validado"), Mercado Pago e WhatsApp foram testados só por contrato contra um servidor HTTP local, S3 só com um servidor falso local, e SMTP e Turnstile só com servidores locais ou clientes injetados. Trate o modo `real` como experimental. Ele não faz parte do teste local.

| Seletor `=real` | Exige | Observações |
|---|---|---|
| `EMAIL_ADAPTER` | `SMTP_HOST`, `EMAIL_FROM` (+ `SMTP_USER`/`SMTP_PASSWORD` em par, se houver autenticação) | com usuário e `SMTP_SECURE=false`, o STARTTLS é obrigatório |
| `WHATSAPP_ADAPTER` | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` e os 4 `WHATSAPP_TEMPLATE_*` | modelos sugeridos em `docs/whatsapp-templates.md`; custo por mensagem na Meta |
| `MP_ADAPTER` | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PREAPPROVAL_PLAN_ID` **e `APP_URL` pública com `https://`** | o Mercado Pago chama `<APP_URL>/api/webhooks/mercadopago`; com `http://localhost` o `check-env` recusa `APP_URL` |
| `TURNSTILE_ADAPTER` | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | o widget real exige JavaScript no navegador |
| `STORAGE_ADAPTER` | `S3_ENDPOINT`, `S3_REGIAO`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | chave só com Put/Get/DeleteObject; bucket sem listagem |

Verificado neste guia: com `MP_ADAPTER=real` e nada mais, o `check-env` responde `Variáveis de ambiente ausentes ou inválidas: APP_URL, MP_ACCESS_TOKEN, MP_PREAPPROVAL_PLAN_ID, MP_WEBHOOK_SECRET` e sai com código 1. O passo a passo de cada provedor está no README, em "Credenciais para os serviços reais".

### 3.5 Variáveis pontuais (fora do `.env`)

| Variável | Onde | Para quê |
|---|---|---|
| `SEED_PERMITIR_PRODUCAO=true` | **só** no comando do seed dentro do container: `docker compose exec -e SEED_PERMITIR_PRODUCAO=true app node dist/prisma/seed.js` | a imagem roda com `NODE_ENV=production` e o seed recusa produção sem essa flag. Não a coloque no `.env` nem a use num ambiente real |
| `E2E_DATABASE_URL` | ambiente do `npm run test:e2e` | URL completa da base descartável do E2E; substitui o `<TEST_DATABASE_URL>_e2e`. **Essa base é apagada e recriada a cada execução** |
| `SMOKE_URL_BASE`, `SMOKE_WAIT_TIMEOUT` | ambiente do `sh docker/smoke.sh` | URL alvo (padrão `http://localhost:${APP_PORT}`) e espera máxima (padrão 180 s) |
| `COMPOSE_PROJECT_NAME` | ambiente do `docker compose` | segunda stack isolada (containers e volumes próprios); combine com `POSTGRES_PORT` e `APP_PORT` diferentes |
| `TZ` | ambiente do Vitest | laços de fuso: `TZ=UTC` e `TZ=America/Sao_Paulo` |

## 4. Bases de dados: desenvolvimento, teste e E2E

| Base | Vem de | Quem usa | Ciclo de vida |
|---|---|---|---|
| `agenda_beleza` (desenvolvimento) | `POSTGRES_DB` / `DATABASE_URL` | app, worker, migrações, seed, testes manuais | persistente no volume `pgdata`; **nenhum teste automatizado a toca** |
| `agenda_beleza_test` (administrativa) | `TEST_DATABASE_URL` | harness do Vitest (`tests/support/`) | criada no 1º `up` do postgres (script `docker/postgres/initdb/10-base-de-teste.sh`). O harness só se **conecta** a ela para criar e apagar as bases de execução: o template `<base>_r<exec>_tpl` e uma base por worker, apagadas ao fim. Ela precisa ser diferente da de desenvolvimento, e o nome pode ter até 46 caracteres |
| `agenda_beleza_test_e2e` (descartável) | `<TEST_DATABASE_URL>_e2e` ou `E2E_DATABASE_URL` | `npm run test:e2e` | **apagada e recriada** (`DROP DATABASE … WITH (FORCE)`) a cada `test:e2e`, migrada, com o seed e o complemento do E2E (salões `e2e-reservas-1..8` e `e2e-suspenso`); fotos em `.armazenamento-e2e/` |

Volume antigo sem a base de teste: `docker compose exec postgres createdb -U agenda agenda_beleza_test`. O papel precisa de `CREATEDB`, e o usuário do compose já tem.

## 5. Caminho A: stack completa no Docker

PostgreSQL 17, app e worker em containers, a partir de uma única imagem (`agenda-beleza:dev`). A app roda com `NODE_ENV=production`.

```bash
# 1. Dependências locais (para os scripts npm e os testes; a imagem instala as dela)
nvm use
npm ci
npm run db:generate                 # obrigatório depois de todo npm ci

# 2. Ambiente
[ -f .env ] || cp .env.example .env

# 3. Subir tudo (constrói a imagem; a app aplica as migrações ao iniciar)
docker compose up -d --build --wait
docker compose ps                   # postgres e app "(healthy)", worker "Up" (o worker não tem healthcheck)

# 4. Saúde
curl -s http://localhost:3000/api/health      # {"status":"ok"}  (503 {"status":"indisponivel"} sem banco)

# 5. Dados de demonstração (idempotente)
docker compose exec -e SEED_PERMITIR_PRODUCAO=true app node dist/prisma/seed.js

# 6. (Opcional) super admin com e-mail e senha seus, sem gravar no .env
docker compose exec -e SUPERADMIN_EMAIL=admin@exemplo.test -e SUPERADMIN_PASSWORD='<sua senha de 12+>' \
  app node dist/scripts/superadmin-criar.js   # imprime "criado" ou "existente"

# 7. Logs
docker compose logs -f app          # primeira linha: check-env: ambiente válido (adaptadores: …)
docker compose logs -f worker       # JSON: worker.adaptadores, worker.iniciado, worker.heartbeat (30 s)
```

- **Migrações:** só a app as aplica (`prisma migrate deploy` no entrypoint). Para conferir: `docker compose exec postgres psql -U agenda -d agenda_beleza -c "select count(*) from _prisma_migrations"`.
- **Depois de mudar o código**, use `docker compose up -d --build --wait`. Sem `--build`, o compose reaproveita a imagem antiga.
- **Smoke oficial da imagem** (o mesmo da CI): `sh docker/smoke.sh`. Ele confere `/api/health` 200 e `Referrer-Policy: strict-origin` em `/confirmar-email` e `/redefinir-senha`, e não derruba nada ao terminar.
- **Vitrines** (`/dev/*`) respondem 404 no Docker, porque `VITRINE_COMPONENTES=false`. A exceção é `/dev/mp-checkout`, que só depende de `MP_ADAPTER=simulado`.
- **Cookie `Secure`:** em produção (Docker) os cookies de sessão saem com `Secure`. Chromium e Firefox aceitam esse cookie em `http://localhost` e `http://127.0.0.1`. O Safari e o acesso pelo IP da rede (ex.: `http://192.168.0.10:3000`) não aceitam, e o login "não pega". Veja o [Diagnóstico](#18-diagnóstico).

## 6. Caminho B: app e worker pelo npm, PostgreSQL no Docker

Útil para desenvolver: recarga a quente, `/dev/*` ligadas no `next dev` e cookies sem `Secure`.

```bash
nvm use && npm ci && npm run db:generate
[ -f .env ] || cp .env.example .env
# Preencha ADMIN_TOTP_CHAVE no .env se for usar o /admin (seção 3.2)

docker compose up -d postgres        # só o banco (cria também agenda_beleza_test na 1ª subida)
npm run db:migrate:deploy            # aplica as migrações na DATABASE_URL
npm run db:seed                      # build:node + seed (sem a flag: aqui NODE_ENV não é production)

# Terminal 1: app
npm run dev                          # http://localhost:3000 (porta: npx next dev -p 3100)
# Terminal 2: worker (instala/migra o schema pgboss no 1º início)
npm run worker                       # Ctrl-C espera até 25 s pelos jobs e sai com 0
# Terminal 3: verificações
curl -s http://localhost:3000/api/health
npm run fila:exemplo -- 3000         # o worker loga worker.exemplo_iniciado e, 3 s depois, worker.job_concluido
SUPERADMIN_EMAIL=admin@exemplo.test SUPERADMIN_PASSWORD='<sua senha de 12+>' npm run superadmin:criar
```

- **Inicie o worker pelo menos uma vez antes** de testar reservas. Sem o schema `pgboss`, enfileirar falha: a reserva é gravada assim mesmo, e o log mostra `mensagem.fila_indisponivel`. A reconciliação reenfileira depois que o worker sobe.
- Para servir o build de produção em vez do `dev`: `npm run build && npm run start`. O CLAUDE.md alerta: não rode `npm run build` no repositório enquanto um `next dev` usa a `.next`.
- **Fotos:** no caminho B, o armazenamento simulado grava em `./.armazenamento` (ou em `ARMAZENAMENTO_DIR`). As fotos do seed rodado no container ficam no volume Docker e não aparecem para o `npm run dev`, e vice-versa: rode o seed no mesmo caminho que vai usar.

## 7. Portas ocupadas

| Situação | O que mudar no `.env` | Observação |
|---|---|---|
| 3000 ocupada, stack Docker | `APP_PORT=3100` **e** `APP_URL=http://localhost:3100` | sem ajustar `APP_URL`, os links de e-mail e do checkout apontam para a porta errada, e o envio de fotos responde 403 (`Origin` diferente) |
| 3000 ocupada, `npm run dev` | `APP_URL=http://localhost:3100` e `npx next dev -p 3100` | idem |
| E2E com a 3000 ocupada ou com a stack no ar | `E2E_PORT=3110` (ou `E2E_PORT=3110 npm run test:e2e`) | o E2E usa `http://127.0.0.1:<E2E_PORT>` e **não reaproveita** um servidor existente (`reuseExistingServer: false`) |
| 5432 ocupada | `POSTGRES_PORT=5433` e a porta trocada por extenso em `DATABASE_URL` e `TEST_DATABASE_URL` | dentro do compose, a app continua usando `postgres:5432` |
| Segunda stack ao lado da primeira | `COMPOSE_PROJECT_NAME=outra POSTGRES_PORT=5434 APP_PORT=3110 docker compose up -d --build --wait` | containers e volumes próprios; derrube com o mesmo `COMPOSE_PROJECT_NAME` |

Para ver quem ocupa uma porta: `ss -ltnp | grep ':3000'` (Linux) ou `lsof -i :3000` (macOS).

## 8. Dados de demonstração e observação dos simuladores

### Seed

Fonte: `prisma/seed.ts` e `prisma/seed/*`. É idempotente: ids fixos e `ON CONFLICT DO NOTHING`, um salão já existente é pulado e nada é apagado. As datas das reservas são relativas à **primeira** execução. Numa demonstração longa, a agenda futura se esgota, e a solução é usar uma base nova.

| Salão | Endereço público | Situação | Destaques |
|---|---|---|---|
| A, Studio Aurora | `/studio-aurora` | `America/Sao_Paulo`, assinatura **em teste** | gestora que também atende, um profissional com login e uma terceira profissional; 5 serviços; jornadas com pausa; funcionamento semanal; bloqueios; clientes fictícias (uma anonimizada); reservas passadas e futuras em vários status; 3 fotos e 3 avaliações |
| B, Ateliê Bromélia | `/atelie-bromelia` | `America/Manaus`, grade de 30 min, assinatura **ativa** | o gestor não atende; 3 serviços, 2 profissionais, 2 fotos e 3 avaliações |

### 8.0 Contas de demonstração (todos os perfis)

As credenciais são **fictícias e públicas**, as mesmas da tabela "Seed de demonstração" do README. A fonte é `CREDENCIAIS_DEMO` em `prisma/seed/dados.ts`, e um teste estático confere que o README as repete. Os e-mails usam o domínio reservado `.example`. Nunca use essas contas num ambiente real.

| Perfil | Salão | Onde entrar | E-mail | Senha |
|---|---|---|---|---|
| Gestora **que também atende** (tem perfil de profissional) | A, Studio Aurora | `/entrar` | `helena@aurora.example` | `Demo@12345` |
| Profissional **com login** | A, Studio Aurora | `/entrar` | `marcos@aurora.example` | `Demo@12345` |
| Gestor **que não atende** (sem perfil de profissional) | B, Ateliê Bromélia | `/entrar` | `rafael@bromelia.example` | `Demo@12345` |
| Super admin | plataforma | `/admin/entrar` (+ TOTP) | `admin@agendabeleza.example` | `Admin@Demo12345` |

- O super admin acima só existe se `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` **não** estiverem definidas quando o seed roda. Se estiverem, vale a conta do ambiente. O seed **não** cadastra o TOTP: o primeiro login em `/admin/entrar` mostra o QR code (13.1).
- Os salões `e2e-reservas-N` e `e2e-suspenso` (gestor `gestor@<slug>.example`) existem só na base descartável do E2E, não na de desenvolvimento.

### 8.0.1 Equipe do seed e jornadas de trabalho

Horários na hora local de cada salão. Domingo é folga para todos.

| Pessoa | Salão | Tipo | Login próprio | Serviços | Jornada semanal |
|---|---|---|---|---|---|
| Helena Moura | A | gestora + profissional | sim (gestora) | todos os 5 | seg a sáb, 09:00–12:00 e 13:00–18:00 |
| Marcos Pires | A | profissional | sim | Corte feminino, Escova | ter a sáb, 10:00–12:00 e 14:00–19:00 |
| Beatriz Lima | A | profissional | **não** | Manicure, Hidratação | seg a sex, 09:00–12:00 e 13:00–17:00 |
| Rafael Barros | B | gestor | sim | não atende | sem jornada (sem perfil de profissional) |
| Camila Reis | B | profissional | **não** | Barba, Corte masculino, Design de sobrancelha | ter a sáb, 09:00–12:00 e 13:00–18:00 |
| Diego Alves | B | profissional | **não** | Barba, Corte masculino | ter a sáb, 10:00–12:00 e 14:00–18:00 |

Fonte: `prisma/seed/salao-a.ts` e `prisma/seed/salao-b.ts`.

### 8.0.2 Como visualizar a jornada de cada tipo de conta

| Quem está logado | O que vê | Caminho na interface |
|---|---|---|
| Gestora que atende (Helena) | a jornada de **todos** os profissionais do salão A, **editável**, inclusive a própria e a de inativos | `/painel/profissionais` → profissional → "Ver e editar a jornada" (`/painel/profissionais/<id>/jornada`) |
| Gestor que não atende (Rafael) | a jornada de Camila e Diego, editável. Ele não tem jornada própria até usar "Eu também atendo" em `/painel/profissionais`, que cria o perfil dele | idem |
| Profissional (Marcos) | **só a própria** jornada, somente leitura | `/painel` → "Minha jornada" |
| Profissional abrindo a jornada de um colega pela URL | "Acesso negado" | `/painel/profissionais/<id de outro>/jornada` |
| Qualquer conta, com o id de outro salão | 404 | — |
| Visitante | não vê a jornada; vê só os horários livres que resultam dela | `/<slug>` → serviço → profissional → dia |
| Super admin | não há tela de jornada no `/admin` | — |

A agenda (`/painel/agenda`) também mostra a jornada como faixa de fundo "Fora da jornada": a gestora vê todos os profissionais, com o filtro `?profissional=<id>`, e o profissional vê só a própria.

### 8.0.3 Como obter os tipos de conta que o seed não traz

| Tipo | Como criar localmente |
|---|---|
| Profissional **sem login** recebendo acesso (Beatriz, Camila, Diego) | como gestor, edite o profissional, informe um e-mail fictício e use "Enviar convite". Abra o link lido em `email_log` e defina a senha (11.4 e 12.1) |
| Profissional **inativo** | como gestor, "Desativar" na página do profissional. A desativação é recusada se houver uma reserva confirmada futura: escolha alguém sem reservas futuras ou cancele-as antes. As sessões dele são revogadas e a jornada continua editável pelo gestor |
| Gestor que passa a atender | Rafael → `/painel/profissionais` → "Eu também atendo" |
| Gestor **novo**, com salão sem assinatura | `/cadastro` + confirmação de e-mail (11.1) |
| Super admin próprio | `superadmin:criar` com `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` (seções 5 e 6) |

### 8.1 Atalho para consultar o banco

```bash
# Docker (caminho A ou B): use seus POSTGRES_USER/POSTGRES_DB se forem outros
alias q='docker compose exec -T postgres psql -U agenda -d agenda_beleza -c'
q "select 1"
```

As consultas abaixo são **somente leitura**. Elas podem mostrar dados fictícios do seed, mas nunca segredos: o banco guarda só hashes de tokens e senhas.

### 8.2 Como observar cada simulador

| Simulador | Onde fica o estado | Como observar |
|---|---|---|
| **E-mail** (`EMAIL_ADAPTER=simulado`) | tabela `email_log` (destinatário, assunto, corpo em texto) | `q "select criado_em, destinatario, assunto from email_log order by criado_em desc limit 5"`; o link está no `corpo`: `q "select corpo from email_log order by criado_em desc limit 1"` |
| **Mercado Pago** (`MP_ADAPTER=simulado`) | `sim_mp_assinatura`, `sim_mp_pagamento`, `sim_mp_adiamento`, `sim_mp_erro_forcado` | checkout em `$APP/dev/mp-checkout?assinatura=<id>` ("Autorizar assinatura"/"Desistir"); `q "select id, estado from sim_mp_assinatura order by criado_em desc limit 5"`. Cobranças aprovadas ou recusadas e erros forçados **não têm tela**: são funções de controle do adaptador usadas pelos testes (`tests/integration/assinatura/apoio-webhook.ts`) |
| **WhatsApp** (`WHATSAPP_ADAPTER=simulado`) | `sim_whatsapp_chamada` (uma linha por chamada, inclusive as que falham) | `q "select criado_em, modelo, resultado, chave_idempotencia from sim_whatsapp_chamada order by criado_em desc limit 10"`. Os parâmetros (`parametros`) incluem o link do convite de avaliação, só nesta tabela do simulador |
| **Turnstile** (`TURNSTILE_ADAPTER=simulado`) | nenhum (sem rede, sem banco) | aceita só o token de teste da Cloudflare `XXXX.DUMMY.TOKEN.XXXX`, que a página entrega num campo oculto `cf-turnstile-response`. Para ver a recusa: `/dev/reserva` com a vitrine ligada tem um seletor de token inválido |
| **Armazenamento** (`STORAGE_ADAPTER=simulado`) | disco: `.armazenamento/fotos/*.webp` (caminho B) ou o volume `armazenamento` (Docker) | `ls .armazenamento/fotos` ou `docker compose exec app ls /app/.armazenamento/fotos`; `q "select id, posicao, chave from salao_foto order by salao_id, posicao"` |

Para limpar as tabelas `sim_*` (destrutivo, **só na base local**), veja o README, "Limpeza das tabelas dos simulados". Não é necessário para seguir este guia.

## 9. Inventário de rotas

Legenda do tipo: **R** = fluxo real com banco e persistência; **V** = vitrine `/dev/*` (não persiste); **API** = route handler.

| Rota | Tipo | Quem | Evidência (código) |
|---|---|---|---|
| `/` | R (estática) | todos | `src/app/page.tsx` |
| `/termos`, `/privacidade` | R (estáticas) | todos | `src/app/(publico)/termos`, `privacidade` |
| `/cadastro`, `/confirmar-email` | R | visitante | `src/app/(publico)/cadastro`, `confirmar-email` |
| `/entrar` | R | equipe | `src/app/(publico)/entrar` |
| `/recuperar-senha`, `/redefinir-senha?token=` | R | equipe | `src/app/(publico)/recuperar-senha`, `redefinir-senha` |
| `/convite/<token>` | R | profissional convidado | `src/app/(publico)/convite/[token]` |
| `/<slug>` | R | cliente | `src/app/(publico)/[slug]/page.tsx` |
| `/<slug>/avaliar/<token>` | R | cliente | `src/app/(publico)/[slug]/avaliar/[token]` |
| `/painel` | R | gestor, profissional | `src/app/painel/page.tsx` |
| `/painel/agenda`, `/painel/agenda/nova`, `/painel/agenda/reservas/<id>` | R | gestor, profissional | `src/app/painel/agenda/**` |
| `/painel/clientes`, `/<id>`, `/<id>/excluir` | R | gestor | `src/app/painel/clientes/**` |
| `/painel/servicos`, `/novo`, `/<id>` | R | gestor | `src/app/painel/servicos/**` |
| `/painel/profissionais`, `/novo`, `/<id>`, `/<id>/jornada` | R | gestor (jornada própria: profissional, leitura) | `src/app/painel/profissionais/**` |
| `/painel/bloqueios`, `/<id>` | R | gestor, profissional | `src/app/painel/bloqueios/**` |
| `/painel/configuracoes`, `/perfil`, `/funcionamento`, `/fotos` | R | gestor | `src/app/painel/configuracoes/**` |
| `/painel/assinatura`, `/painel/assinatura/retorno` | R | gestor | `src/app/painel/assinatura/**` |
| `/admin/entrar`, `/admin` | R | super admin | `src/app/admin/entrar`, `src/app/admin/page.tsx` |
| `/admin/saloes`, `/<id>`, `/<id>/assinatura` | R | super admin | `src/app/admin/saloes/**` |
| `/admin/mensagens`, `/admin/auditoria` | R | super admin | `src/app/admin/mensagens`, `auditoria` |
| `/admin/avaliacoes`, `/<id>` | R | super admin | `src/app/admin/avaliacoes/**` |
| `GET /api/health` | API | público | `src/app/api/health/route.ts` |
| `POST /api/painel/fotos` | API (multipart) | gestor | `src/app/api/painel/fotos/route.ts` |
| `GET /api/fotos/<id>` | API | público | `src/app/api/fotos/[id]/route.ts` |
| `POST /api/webhooks/mercadopago` | API | Mercado Pago (sistema) | `src/app/api/webhooks/mercadopago/route.ts` |
| `/dev/mp-checkout` (+ `POST /dev/mp-checkout/decisao`) | **R** do simulador (grava em `sim_mp_assinatura`); só com `MP_ADAPTER=simulado` | gestor no checkout | `src/app/dev/mp-checkout/**` |
| `/dev/componentes`, `/dev/jornada`, `/dev/bloqueios`, `/dev/configuracoes`, `/dev/perfil`, `/dev/funcionamento`, `/dev/fotos` (+ `/dev/fotos/enviar`), `/dev/clientes`, `/dev/consentimento`, `/dev/convite`, `/dev/reserva`, `/dev/reserva-nova`, `/dev/reserva-acoes`, `/dev/agenda`, `/dev/mensagens-reserva`, `/dev/avaliacao`, `/dev/denuncia`, `/dev/moderacao`, `/dev/assinatura`, `/dev/aviso-plano`, `/dev/admin-entrar`, `/dev/admin-saloes`, `/dev/admin-mensagens` | V | desenvolvimento | `src/app/dev/**` (404 sem `VITRINE_COMPONENTES=true` ou `next dev`) |

O `src/proxy.ts` só confere se o cookie existe em `/painel/**` (sem cookie, responde 307 para `/entrar?proximo=…`) e em `/admin/**` (sem cookie, 307 para `/admin/entrar`). A autorização de verdade é feita no servidor de cada página e ação.

## 10. Roteiro: visitante e cliente

Formato de cada fluxo: **URL · Pré-requisitos · Passos · Esperado · Persistência e conferência · Simulador · Evidência**.

### 10.1 Página inicial, Termos e Privacidade

- **URL:** `$APP/`, `$APP/termos`, `$APP/privacidade#avaliacoes`.
- **Passos:** abra as três páginas. Na inicial, confira os links "cadastro", "entrar", "Termos" e "Privacidade".
- **Esperado:** o preço e os dias de teste vêm de `src/config/plano.ts` (R$ 79,00/mês, 30 dias). Termos e Privacidade mostram a versão, a vigência e o aviso de **texto provisório** (sem revisão jurídica).
- **Persistência:** nenhuma (páginas estáticas).
- **Evidência:** `e2e/landing.spec.ts`, `e2e/smoke.spec.ts`, `e2e/termos-privacidade.spec.ts`, `src/config/termos.test.ts`.

### 10.2 Página pública do salão

- **URL:** `$APP/studio-aurora` e `$APP/atelie-bromelia`.
- **Pré-requisitos:** seed.
- **Passos:** confira o nome, as fotos, a descrição, os serviços, a equipe, o horário de funcionamento, o endereço, o contato, as formas de pagamento, as comodidades e as avaliações (média, contagem e as 10 mais recentes). Teste também `$APP/painel-x-inexistente` e `$APP/Studio-Aurora` (maiúsculas).
- **Esperado:** um campo vazio omite a seção. Um slug inexistente, malformado ou com maiúsculas responde 404. Um slug **histórico** (após trocar o endereço em 11.9) responde **308** para o atual: confira com `curl -sI $APP/<slug-antigo>`.
- **Persistência:** só leitura.
- **Simulador:** armazenamento (as fotos saem por `/api/fotos/<id>` com `Cache-Control: public, max-age=3600`).
- **Evidência:** `tests/integration/reserva-publica/` (inclusive `http.test.ts` com o 308) e `e2e/publico-reserva.spec.ts`.

### 10.3 Disponibilidade e reserva pública

- **URL:** `$APP/studio-aurora` → passos por GET (`?s=…&p=…&data=…&h=…`) → a confirmação é uma Server Action.
- **Pré-requisitos:** seed; worker no ar (para a mensagem de confirmação).
- **Passos:**
  1. Escolha um ou mais serviços → um profissional (só aparecem os que executam **todos** os serviços escolhidos) ou "Sem preferência" → um dia → um horário.
  2. Preencha o nome e um celular brasileiro fictício válido (ex.: `(11) 98888-7766`). Marque os consentimentos: mensagens da reserva, convite de avaliação e publicação.
  3. Confirme.
- **Esperado:** a tela de confirmação aparece na própria resposta (sem id na URL). Os horários respeitam a grade, a antecedência mínima (2 h), a janela (60 dias), a jornada ∩ o funcionamento, os bloqueios e as reservas existentes. Repetir o envio (F5 no POST) devolve a mesma confirmação, sem duplicar.
- **Persistência e conferência:**
  ```bash
  q "select r.inicio, r.status, r.revisao, c.telefone_e164 from reserva r join cliente c on c.id = r.cliente_id order by r.criado_em desc limit 1"
  q "select finalidade, origem, versao_termos from consentimento order by criado_em desc limit 3"
  q "select tipo, revisao, estado from mensagem order by criado_em desc limit 1"   # confirmacao: pendente → enviada
  q "select modelo, resultado from sim_whatsapp_chamada order by criado_em desc limit 1"
  ```
- **Simuladores:** Turnstile (token oculto) e WhatsApp.
- **Variações:**
  - **Horário tomado:** abra o mesmo horário em duas abas e confirme nas duas. A segunda mostra "horário indisponível" com horários atualizados e mantém os dados digitados.
  - **Limite de 3 reservas futuras** por telefone e salão: a 4ª é recusada.
  - **Sem o consentimento de mensagens**, a reserva é criada e a mensagem nasce `nao_enviada`.
- **Evidência:** `src/server/reservas/criar-reserva.ts`, `src/server/reserva-publica/`, `tests/integration/reservas/`, `tests/integration/protecao/`, `e2e/publico-reserva.spec.ts`, `e2e/publico-reserva-teclado.spec.ts` e `e2e/publico-conflito-captcha.spec.ts`.

### 10.4 Salão indisponível (somente leitura)

- **Pré-requisitos:** o super admin suspende o salão B (13.3) **ou** um salão novo fica `pendente` depois de "Assinar" (11.14).
- **Passos:** abra `$APP/atelie-bromelia`.
- **Esperado:** o perfil, as fotos, as avaliações, os serviços e a equipe continuam visíveis, com o aviso "Agendamento indisponível" e **sem** o formulário de reserva. A denúncia de avaliação continua disponível.
- **Evidência:** `src/server/assinatura/politica-operacao.ts`, `tests/integration/politica/` e `e2e/publico-suspenso.spec.ts` (salão `e2e-suspenso`).

### 10.5 Avaliação verificada por link

- **URL:** `$APP/<slug>/avaliar/<token>`. O link chega por WhatsApp e, no simulador, fica em `sim_whatsapp_chamada.parametros`.
- **Pré-requisitos:** uma reserva **concluída** cuja cliente aceitou o consentimento "convite de avaliação"; worker no ar. Como a conclusão exige `agora >= início` e o seed não tem reserva passada `confirmado`, o caminho mais curto é:
  1. Como gestora do salão A, em `/painel/configuracoes`, reduza a **antecedência mínima para 0 h** e, se quiser, a grade para 5 min. Isso só afeta a sua base local.
  2. Faça uma reserva pública (10.3) para o próximo horário livre, marcando o consentimento de convite.
  3. Depois do horário de início, abra a reserva em `/painel/agenda/reservas/<id>` e marque **Concluída**.
  4. Em até alguns segundos, o worker envia o convite: `q "select parametros->>'link' from sim_whatsapp_chamada where modelo = 'convite_avaliacao' order by criado_em desc limit 1"`.
- **Passos:** abra o link, dê uma nota de 1 a 5, escreva um comentário opcional, autorize a publicação e envie.
- **Esperado:** "obrigado", e a avaliação aparece na hora em `/<slug>`, com "Primeiro nome + inicial" e mês/ano. Reabrir o link, adulterá-lo, usar o link de outro salão ou de uma reserva marcada depois como `nao_compareceu` mostra sempre "Link inválido ou expirado.".
- **Persistência:** `q "select nota, retirada_em from avaliacao order by criado_em desc limit 1"`; o convite fica em `avaliacao_convite`, que guarda só o SHA-256 do token.
- **Simuladores:** WhatsApp e Turnstile. O link depende de `AVALIACAO_SEGREDO` e de `APP_URL` **do worker**.
- **Evidência:** `src/server/avaliacoes/`, `tests/integration/avaliacoes/` (inclusive `convite.test.ts`, com o worker real) e `e2e/publico-avaliacao-denuncia.spec.ts`.

### 10.6 Denúncia de avaliação

- **URL:** `$APP/studio-aurora` → em uma avaliação, "Denunciar avaliação" (um `<details>`, funciona sem JS).
- **Passos:** escolha um motivo (ofensivo, falso, spam, dados pessoais, outro), escreva um detalhe opcional e envie.
- **Esperado:** sempre "Recebemos sua denúncia" (`?denuncia=recebida`), inclusive para duplicadas. A avaliação continua visível.
- **Persistência:** `q "select motivo, resolvida_em from avaliacao_denuncia order by criado_em desc limit 3"`. Do denunciante, só o `ip_hash` (HMAC).
- **Evidência:** `src/server/denuncias/`, `tests/integration/denuncias/` e `e2e/publico-avaliacao-denuncia.spec.ts`.

## 11. Roteiro: gestor

Entre com a gestora do salão A (seção 8.0) ou com um gestor criado em 11.1.

### 11.1 Cadastro do salão e confirmação de e-mail

- **URL:** `$APP/cadastro` → link `$APP/confirmar-email?token=…`.
- **Passos:** informe o seu nome, um e-mail fictício (ex.: `gestor1@exemplo.test`), uma senha com 8 ou mais caracteres e o nome do salão. Envie. Leia o e-mail simulado: `q "select corpo from email_log order by criado_em desc limit 1"`. Abra o link. Antes de confirmar, tente entrar em `/entrar`.
- **Esperado:** antes de confirmar, o login com a senha correta mostra "Confirme seu e-mail antes de entrar." e o botão "Reenviar link de confirmação". Depois de confirmar, o login leva a `/painel`. Reabrir o link mostra "já foi utilizado". Um e-mail repetido é recusado.
- **Persistência:** o salão (fuso `America/Sao_Paulo`, grade de 15 min, antecedência de 2 h, janela de 60 dias, intervalo de 0), o slug derivado do nome e o usuário `gestor`. **Sem assinatura** e sem perfil de profissional. `q "select nome, (select slug from salao_slug ss where ss.salao_id = s.id and ss.atual) from salao s order by criado_em desc limit 1"`.
- **Simulador:** e-mail. O link vale 24 h e é de uso único. O reenvio tem limite de 3 por e-mail a cada 15 min.
- **Evidência:** `src/server/auth/cadastro.ts`, `confirmacao-email.ts`, `tests/integration/auth/`, `e2e/cadastro*.spec.ts` (sem banco).

### 11.2 Login, logout e sessão

- **URL:** `$APP/entrar` → `/painel`; "Sair" no cabeçalho (POST).
- **Esperado:** um e-mail inexistente ou uma senha errada recebem a mesma mensagem, "E-mail ou senha incorretos.". A 11ª falha em 15 min recebe "Muitas tentativas…". Acessar `/painel/agenda` sem sessão leva a `/entrar?proximo=/painel/agenda`. O super admin **não** entra por aqui.
- **Persistência:** a tabela `sessao` guarda só o hash; o cookie é `ab_sessao` (httpOnly, SameSite=Lax). `q "select count(*) from sessao where revogada_em is null"`.
- **Evidência:** `src/server/auth/login.ts`, `sessao.ts`, `tests/integration/auth/login.test.ts`, `e2e/entrar.spec.ts`.

### 11.3 Recuperação de senha

- **URL:** `$APP/recuperar-senha` → `$APP/redefinir-senha?token=…`.
- **Passos:** peça o link e leia `email_log`, onde o assunto é "Redefinição de senha no Agenda Beleza". O e-mail aparece logo **depois** da resposta da tela. Abra o link, defina a nova senha e entre.
- **Esperado:** a resposta é a mesma para qualquer e-mail. O link vale 1 h e é de uso único, e um pedido novo invalida os anteriores. Redefinir encerra **todas** as sessões do usuário.
- **Evidência:** `src/server/auth/recuperacao-senha.ts`, `tests/integration/auth/recuperacao-senha*.test.ts`, `e2e/recuperar-senha.spec.ts`.

### 11.4 Profissionais e convite

- **URL:** `$APP/painel/profissionais`, `/novo` e `/<id>` (seção "Acesso ao painel").
- **Passos:** cadastre um profissional com o nome e um e-mail fictício. Na página dele, use "Enviar convite". Leia o link: `q "select corpo from email_log where assunto = 'Seu convite para o Agenda Beleza' order by criado_em desc limit 1"`. Em seguida, teste desativar o profissional (ele tem reserva confirmada futura?), reativá-lo e a ação "Eu também atendo".
- **Esperado:** a lista mostra "Sem acesso (convite pendente)". Reenviar invalida o convite anterior (limite de 3 a cada 15 min). A desativação é **recusada** se houver uma reserva confirmada que ainda não terminou, e a tela lista essas reservas. Profissionais nunca são apagados.
- **Persistência:** `q "select nome, ativo from profissional order by criado_em desc limit 3"`; `convite` guarda só o hash do token.
- **Simulador:** e-mail. A aceitação está em 12.1.
- **Evidência:** `src/server/profissionais/`, `src/server/convites/`, `tests/integration/profissionais/`, `tests/integration/convites/`, `e2e/convite*.spec.ts` (sem banco).

### 11.5 Serviços

- **URL:** `$APP/painel/servicos`, `/novo` e `/<id>`.
- **Passos:** crie um serviço com o preço `80,00` (o servidor recusa `80.00`) e a duração `45`, marcando os profissionais. Edite o preço. Desative e reative o serviço.
- **Esperado:** um serviço sem profissional ativo mostra o aviso "Não aparece na página pública…". Alterar o preço ou a duração não muda as reservas existentes, que guardam um snapshot em `reserva_item`.
- **Persistência:** `q "select nome, preco_centavos, duracao_min, ativo from servico order by criado_em desc limit 3"`.
- **Evidência:** `src/server/servicos/`, `tests/integration/servicos/`.

### 11.6 Jornada do profissional

- **URL:** `$APP/painel/profissionais/<id>/jornada`.
- **Passos:** defina intervalos por dia (`09:00`–`12:00`, `13:00`–`18:00`), com horários múltiplos de 5. Teste um intervalo sobreposto e `24:00` como fim.
- **Esperado:** um erro em qualquer dia recusa a semana inteira e mostra os erros por campo. Intervalos contíguos são unidos. Salvar a mesma semana não grava nada. A página pública passa a refletir a nova jornada.
- **Persistência:** a tabela `jornada`.
- **Evidência:** `src/server/jornadas/`, `tests/integration/jornadas/`.

### 11.7 Bloqueios

- **URL:** `$APP/painel/bloqueios` e `/<id>`.
- **Passos:** crie um bloqueio do salão inteiro de "dia inteiro" e um bloqueio "com horário" de um profissional sobre uma reserva existente. Edite um e remova outro.
- **Esperado:** depois de salvar, a tela lista as reservas confirmadas cobertas, **sem** alterá-las nem enviar mensagens. Os horários bloqueados somem da página pública.
- **Persistência:** a tabela `bloqueio` (instantes em UTC).
- **Evidência:** `src/server/bloqueios/`, `tests/integration/bloqueios/`.

### 11.8 Perfil público e horário de funcionamento

- **URL:** `$APP/painel/configuracoes/perfil` e `$APP/painel/configuracoes/funcionamento`.
- **Passos:** preencha a descrição, o endereço completo (tudo ou nada), o telefone, o WhatsApp, o Instagram, os meios de pagamento e as comodidades. No funcionamento, escolha "Informar" e feche um dia.
- **Esperado:** os dados aparecem em `/<slug>`. Um dia fechado não oferece horários. "Não informar" não limita a disponibilidade.
- **Persistência:** colunas de perfil em `salao`, `salao_funcionamento` e `salao.funcionamento_definido`.
- **Evidência:** `src/server/salao/perfil*.ts`, `funcionamento*.ts`, `tests/integration/salao/`.

### 11.9 Configurações: regras e endereço público

- **URL:** `$APP/painel/configuracoes`.
- **Passos:** altere a grade (5, 10, 15, 20, 30 ou 60), a antecedência (0–72 h), a janela (1–365 dias), o intervalo (0–120 min) e o fuso. Troque o slug, por exemplo para `studio-aurora-centro`.
- **Esperado:** as regras valem para os próximos horários oferecidos. O slug antigo vira histórico e responde 308 na página pública. Um slug reservado (`painel`, `admin`…) ou em uso por outro salão é recusado.
- **Persistência:** `q "select slug, atual from salao_slug order by criado_em desc limit 5"`.
- **Evidência:** `src/server/salao/configuracoes.ts`, `tests/integration/salao/`.

### 11.10 Fotos do salão

- **URL:** `$APP/painel/configuracoes/fotos` (o envio faz um POST multipart para `/api/painel/fotos`).
- **Pré-requisitos:** acesse pelo **mesmo endereço de `APP_URL`**. `localhost` e `127.0.0.1` são origens diferentes, e um `Origin` divergente responde 403.
- **Passos:** envie um JPEG, PNG ou WebP de até 5 MB com o texto alternativo. Mova a foto para cima ou para baixo, edite o texto e remova uma foto.
- **Esperado:** o servidor responde 303 com `?envio=<código>`. A imagem é convertida para WebP (lado maior de até 1600 px, sem metadados). O máximo é de 12 fotos.
- **Persistência e conferência:** `salao_foto` e o arquivo em `.armazenamento/fotos/` (ou no volume). `curl -sI $APP/api/fotos/<id>` → 200, `image/webp`, `ETag`.
- **Simulador:** armazenamento.
- **Evidência:** `src/server/fotos/`, `src/server/imagem/`, `tests/integration/fotos/`, `e2e/fotos*.spec.ts` (vitrine).

### 11.11 Agenda da equipe

- **URL:** `$APP/painel/agenda?data=AAAA-MM-DD&visao=dia|semana&profissional=<id>`, com o detalhe em `/painel/agenda/reservas/<id>`.
- **Esperado:** reservas em todos os status, bloqueios e as faixas "Fora do funcionamento" e "Fora da jornada". A cliente anonimizada aparece como "cliente removida". Uma reserva com falha de envio vigente mostra um triângulo de alerta. O detalhe tem a seção "Mensagens de WhatsApp", só de leitura e sem reenvio.
- **Evidência:** `src/server/agenda/`, `tests/integration/agenda/`, `e2e/agenda*.spec.ts` (vitrine).

### 11.12 Reserva manual e encaixe

- **URL:** `$APP/painel/agenda/nova?profissional=<id>&data=AAAA-MM-DD&hora=HH:MM` (botão "Nova reserva" na agenda).
- **Passos:**
  1. Registre uma reserva dentro da jornada.
  2. Registre outra fora da jornada ou sobre um bloqueio: a tela lista os motivos e pede "Confirmo o encaixe". Confirme.
  3. Tente sobrepor uma reserva ativa.
- **Esperado:** sem confirmação, um encaixe não grava nada. Confirmado, grava `encaixe = true`. A sobreposição é **sempre** recusada, pela exclusion constraint `reserva_sem_sobreposicao`. Um início no passado é recusado. A caixa de consentimento da equipe é opcional: sem ela, a mensagem nasce `nao_enviada`.
- **Persistência:** `q "select inicio, encaixe, origem from reserva order by criado_em desc limit 3"`.
- **Evidência:** `src/server/reservas/reserva-equipe.ts`, `encaixe.ts`, `tests/integration/reservas/equipe/`.

### 11.13 Remarcar, cancelar e concluir

- **URL:** `$APP/painel/agenda/reservas/<id>`.
- **Passos:**
  1. Remarque uma reserva futura confirmada.
  2. Cancele outra em dois passos ("Cancelar reserva" → "Confirmar cancelamento").
  3. Marque uma reserva já iniciada como **Concluída** ou **Não compareceu**.
- **Esperado:** a remarcação é um UPDATE da mesma reserva: `revisao` + 1 e a mensagem `remarcacao` dessa revisão. O cancelamento grava `cancelada_em`, não altera a revisão e registra `cancelamento`. A conclusão registra o `convite_avaliacao`. `cancelado` é final.
- **Persistência:** `q "select tipo, revisao, estado from mensagem where reserva_id = '<id>' order by criado_em"`; `q "select modelo, chave_idempotencia from sim_whatsapp_chamada order by criado_em desc limit 5"` (chave `reserva:tipo:revisao`).
- **Evidência:** `src/server/reservas/status.ts`, `remarcar.ts`, `cancelar.ts`, `alterar-status.ts`, `tests/integration/reservas/alteracao/`.

### 11.14 Clientes, consentimento e anonimização

- **URL:** `$APP/painel/clientes?q=…&pagina=N`, `/<id>` e `/<id>/excluir`.
- **Passos:** busque por parte do nome (acentos e maiúsculas não importam) ou do telefone. Edite o nome. Tente usar o telefone de outra cliente. Em "Excluir cliente", confirme.
- **Esperado:** a cliente é única por salão + telefone E.164, e não existe tela "nova cliente": ela nasce na reserva. Depois da exclusão, o nome e o telefone ficam nulos, ela aparece como "Cliente removida", e as reservas e os consentimentos permanecem. Mensagens `pendente`/`falhou` passam a `cancelada_anonimizacao`. As avaliações dela perdem o nome e o comentário.
- **Persistência:** `q "select nome, telefone_e164, anonimizada_em from cliente order by atualizado_em desc limit 3"`; consentimentos em `consentimento`, com finalidade, origem e versão.
- **Evidência:** `src/server/clientes/`, `src/server/consentimento/`, `tests/integration/clientes/`, `tests/integration/consentimento/`.

### 11.15 Assinatura e checkout simulado

- **URL:** `$APP/painel/assinatura` → `$APP/dev/mp-checkout?assinatura=<id>` → `$APP/painel/assinatura/retorno`.
- **Pré-requisitos:** um gestor **sem assinatura**, como o criado em 11.1. O salão A está em teste e o B está ativo. Use `MP_ADAPTER=simulado` e acesse pela origem de `APP_URL`.
- **Passos:**
  1. Clique em "Assinar". O salão fica `pendente`: o agendamento público para (10.4), e a faixa do plano aparece com "Assinar agora".
  2. No checkout simulado, sem nenhum dado de cartão, clique em **Autorizar assinatura**.
  3. Volte ao retorno.
- **Esperado:** o retorno **ignora a query string**, consulta o simulador e passa o salão para `em_teste`, com fim 30 dias depois da autorização. Depois, teste "Cancelar assinatura" → "Sim, cancelar assinatura" (em teste, o acesso continua até o fim do teste). Com "Desistir" no checkout, a assinatura continua `pendente`.
- **Persistência:**
  ```bash
  q "select estado, teste_fim_em, provedor_assinatura_id is not null as vinculada from assinatura order by criado_em desc limit 1"
  q "select de, para, ocorrida_em from assinatura_transicao order by ocorrida_em desc limit 5"
  q "select id, estado from sim_mp_assinatura order by criado_em desc limit 1"
  ```
- **Estados do plano** (`em_carencia`, `suspensa`, `encerrada`): dependem de cobranças recusadas e do tempo, e **não há tela para disparar cobranças no simulador**. Para ver como cada estado aparece, use as vitrines `/dev/assinatura?situacao=…` e `/dev/aviso-plano?estado=…` (no `next dev` ou com `VITRINE_COMPONENTES=true`). O efeito real de cada estado está coberto por `tests/integration/assinatura/` e `tests/integration/politica/`. Para observar o modo somente leitura com dados reais, use a suspensão manual pelo super admin (13.3).
- **Evidência:** `src/server/assinatura/`, `src/domain/assinatura/`, `tests/integration/assinatura/`, `e2e/assinatura*.spec.ts` (vitrine).

## 12. Roteiro: profissional

### 12.1 Aceitar o convite

- **URL:** o link `$APP/convite/<token>`, lido em `email_log` (11.4).
- **Passos:** defina a senha (8 a 1024 caracteres) e entre em `/entrar` com o e-mail do convite.
- **Esperado:** "Senha definida" com o link para entrar, sem login automático. Reabrir o link mostra sempre a mesma recusa.
- **Persistência:** usuário `profissional` com e-mail confirmado, vinculado ao perfil: `q "select papel, email_confirmado_em is not null from usuario order by criado_em desc limit 1"`.
- **Evidência:** `src/server/convites/`, `tests/integration/convites/`.

### 12.2 Acesso do profissional

Entre com o profissional do salão A (seção 8.0) ou com o convidado em 12.1.

| O que testar | URL | Esperado |
|---|---|---|
| menu | `/painel` | só "Agenda" e "Bloqueios", mais o link "Minha jornada" |
| agenda própria | `/painel/agenda` | só as próprias reservas; o parâmetro `profissional` é ignorado |
| reserva de colega | `/painel/agenda/reservas/<id de outro>` | 404 |
| jornada | "Minha jornada" | somente leitura; a jornada de um colega mostra "Acesso negado" |
| bloqueios | `/painel/bloqueios` | cria, edita e remove só os próprios; os do salão inteiro aparecem só para leitura |
| reserva manual | `/painel/agenda/nova` | só para si (para um colega: 403) |
| remarcar, cancelar e concluir | detalhe da própria reserva | permitido; não troca de profissional |
| áreas do gestor | `/painel/servicos`, `/painel/clientes`, `/painel/configuracoes`, `/painel/assinatura` | "Acesso negado" |
| desativação | o gestor desativa o profissional | as sessões dele são revogadas; o login responde "Seu acesso está desativado…" |

Evidência: `src/server/auth/permissoes.ts` e `tests/integration/tenant/` (isolamento entre salões e papéis).

## 13. Roteiro: super admin

### 13.1 Criar a conta e cadastrar o TOTP

- **Pré-requisitos:** conta criada pelo seed (seção 8.0) **ou** por `superadmin:criar` (seções 5 e 6). No caminho B, a variável `ADMIN_TOTP_CHAVE` precisa estar preenchida.
- **URL:** `$APP/admin/entrar`.
- **Passos:**
  1. Informe o e-mail e a senha. No primeiro acesso aparece o QR code (SVG gerado no servidor) com a **chave em texto**.
  2. Cadastre-a no autenticador ou gere um código no terminal: `oathtool --totp -b '<chave exibida na tela>'`. Não salve a chave em arquivos versionados.
  3. Confirme o código.
- **Esperado:** sessão própria (`ab_admin`, Path `/admin`, 30 min de inatividade e teto de 8 h). Cada código vale uma única vez. Uma sessão de salão em `/admin` mostra "Acesso negado". O super admin em `/entrar` recebe a mensagem genérica de erro.
- **Persistência:** a auditoria registra `totp.cadastrar` e `login.sucesso`: `q "select acao, resultado, ocorrido_em from auditoria order by ocorrido_em desc limit 5"`.
- **Reset local do TOTP**, se você trocou a `ADMIN_TOTP_CHAVE`: veja o README, tabela da seção "Proteção da página pública". O comando altera dados, então use só na base local.
- **Evidência:** `src/server/auth/admin/`, `tests/integration/auth/admin/`, `e2e/admin-entrar*.spec.ts` (vitrine e redirecionamentos).

### 13.2 Salões: lista e edição

- **URL:** `$APP/admin/saloes?q=…&estado=…&suspenso=…&pagina=N` e `/admin/saloes/<id>`.
- **Passos:** busque por "aurora". Edite o nome, o slug, o fuso, as regras e o e-mail do gestor.
- **Esperado:** valores iguais não gravam nada. Trocar o e-mail do gestor desfaz a confirmação, revoga as sessões dele e envia um novo link (`email_log`). Tudo é auditado na mesma transação (`salao.atualizar`, `usuario.atualizar_email`).
- **Evidência:** `src/server/admin/`, `tests/integration/admin-saloes/`.

### 13.3 Suspender, reativar e estender o teste

- **Passos:**
  1. No detalhe do salão B, clique em "Suspender", informe um motivo de 5 a 280 caracteres, sem e-mail nem telefone, e confirme na 2ª etapa.
  2. Confira `$APP/atelie-bromelia` (10.4) e o painel do gestor B, que mostra a faixa e recusa as escritas.
  3. Reative o salão.
  4. Em um salão `em_teste` (o A), clique em "Estender teste" com N = 1 a 90 dias.
- **Esperado:** a suspensão altera só `salao.suspenso_manual_em`. A extensão chama `adiarProximaCobranca` no simulador e grava o novo fim do teste. Em produção ela depende do Mercado Pago real, que ainda não foi validado.
- **Persistência:** `q "select acao, resultado from auditoria order by ocorrido_em desc limit 5"`; `q "select assinatura_id, criado_em from sim_mp_adiamento order by criado_em desc limit 1"`.
- **Evidência:** `tests/integration/admin-saloes/`.

### 13.4 Assinatura e eventos do salão

- **URL:** `$APP/admin/saloes/<id>/assinatura`.
- **Esperado:** o resumo (sem o id do provedor), as últimas 50 transições e os eventos de webhook com o resultado, no fuso do salão. Ler esta tela **não** grava auditoria.
- **Evidência:** `tests/integration/admin/`.

### 13.5 Fila de mensagens e reenvio

- **URL:** `$APP/admin/mensagens?estado=falhou&salao=…&tipo=…`, `?detalhe=<id>` e `?confirmar=<id>`.
- **Pré-requisitos:** uma mensagem `falhou`. O WhatsApp simulado só falha com uma falha forçada, que não tem tela (`criarWhatsAppSimulado().forcarFalhas(...)`, usado em `tests/integration/mensagens/`). Sem uma falha real na base, a lista filtrada fica vazia, e esse é o resultado esperado. A tela com dados fictícios de falha está na vitrine `/dev/admin-mensagens`.
- **Esperado:** o telefone aparece sempre mascarado (`+55 (71) 9****-1234`). Só `falhou` vigente pode ser reenviada. O reenvio volta a mensagem para `pendente`, audita `mensagem.reenviar` e enfileira depois do commit. O resultado volta por PRG em `?reenvio=…`.
- **Evidência:** `src/server/admin/`, `tests/integration/admin/` (inclusive `concorrencia-reenvio`).

### 13.6 Auditoria

- **URL:** `$APP/admin/auditoria?salao=…&ator=<e-mail>&acao=…&resultado=…&de=…&ate=…`.
- **Esperado:** antes e depois de cada ação aparecem como diff por campo, com o JSON recolhido. O período é um dia civil em `America/Sao_Paulo`. Um filtro inválido mostra um aviso, nunca um erro. A tabela é só de inserção: triggers recusam UPDATE e DELETE.
- **Evidência:** `src/server/auditoria/`, `tests/integration/auditoria/`.

### 13.7 Moderação de avaliações

- **URL:** `$APP/admin/avaliacoes?salao=…&estado=visivel|retirada|com-denuncia` e `/admin/avaliacoes/<id>`. Chega-se a ela por um link em `/admin`, não pelo menu.
- **Passos:** abra uma avaliação denunciada (10.6). Clique em "Retirar" com um motivo de 3 a 300 caracteres, sem dados pessoais. Confira a página pública. Depois, "Restaurar". Por último, arquive uma denúncia.
- **Esperado:** a avaliação retirada some da página, da média e da contagem. As denúncias pendentes são resolvidas. Cada ação é auditada (`avaliacao.retirar`, `avaliacao.restaurar`, `avaliacao.denuncia_resolver`).
- **Evidência:** `src/server/denuncias/`, `tests/integration/denuncias/`.

## 14. Roteiro: sistema (worker, fila, webhooks, prazos)

### 14.1 Filas do worker

| Fila | Agendamento (UTC) | O que faz | Como observar |
|---|---|---|---|
| `exemplo` | — | job de verificação | `npm run fila:exemplo -- 3000` ou `docker compose exec worker node dist/scripts/enfileirar-exemplo.js 3000` → `worker.job_concluido` |
| `whatsapp-reserva` | — | envia a mensagem (chave `reserva:tipo:revisao`) | `mensagem`, `mensagem_tentativa`, `sim_whatsapp_chamada`; logs `mensagem.enviada` |
| `reconciliar-mensagens` | a cada minuto | reenfileira `pendente` com mais de 2 min e fecha `enviando` com mais de 5 min como `falhou/resultado_incerto` | log `mensagem.reconciliacao` |
| `assinatura-prazos` | a cada 5 min | aplica os prazos (fim do teste, carência, suspensão, fim do acesso cancelado) | `assinatura_transicao` |
| `limpar-rate-limit` | minuto 17 de cada hora | apaga janelas antigas de `rate_limit_janela` | contagem da tabela |

Fonte: `src/worker/handlers/registry.ts` e `src/server/queue/filas.ts`. Para ver a recuperação: pare o worker (`docker compose stop worker` ou Ctrl-C), faça uma reserva pública (ela fica `pendente`, e a app loga `mensagem.fila_indisponivel` se o schema não existir) e suba o worker de novo. A mensagem é enviada, e a reserva nunca muda por causa de uma falha de envio.

Encerramento gracioso: `time docker compose stop worker` termina em menos de 30 s, e o log mostra `worker.encerrando` → `worker.encerrado`.

### 14.2 Webhook do Mercado Pago (simulado)

Não há tela. O webhook aceita só notificações assinadas. No simulador, o segredo é **público e fixo** (`segredo-do-webhook-simulado`, em `src/server/integrations/mercadopago/webhook-simulado.ts`) e não tem valor fora dele. Para enviar uma notificação de assinatura à mão:

```bash
APP=http://localhost:3000
ID='<provedor_assinatura_id>'   # q "select provedor_assinatura_id from assinatura order by criado_em desc limit 1"
REQ=$(cat /proc/sys/kernel/random/uuid)          # macOS: REQ=$(uuidgen | tr A-Z a-z)
TS=$(($(date +%s) * 1000))
SIG=$(printf 'id:%s;request-id:%s;ts:%s;' "$ID" "$REQ" "$TS" \
  | openssl dgst -sha256 -hmac 'segredo-do-webhook-simulado' -hex | sed 's/^.*= //')
curl -s -w ' HTTP %{http_code}\n' -X POST \
  "$APP/api/webhooks/mercadopago?data.id=$ID&type=subscription_preapproval" \
  -H 'content-type: application/json' -H "x-request-id: $REQ" -H "x-signature: ts=$TS,v1=$SIG" \
  --data "{\"type\":\"subscription_preapproval\",\"action\":\"updated\",\"data\":{\"id\":\"$ID\"}}"
q "select resultado, origem_valida, recebido_em from webhook_evento order by recebido_em desc limit 3"
```

- **Esperado:** `{"ok":true}` HTTP 200. O evento é gravado **antes** de ser processado, e o estado **consultado** no simulador vence o payload: reenviar a mesma assinatura não muda nada (idempotência). Com um id desconhecido, o resultado é `ignorado`, com HTTP 200.
- **Assinatura errada** (troque um caractere de `SIG`): HTTP 401 `{"erro":"nao_autorizado"}`, e o evento fica `rejeitado` com `origem_valida = false`.
- Cobranças aprovadas ou recusadas (`subscription_authorized_payment`) precisam de um pagamento criado no simulador, e isso só existe nas funções de controle usadas pelos testes (`tests/integration/assinatura/webhook*.test.ts`).
- **Evidência:** `src/server/assinatura/webhook*.ts`, `tests/integration/assinatura/webhook*.test.ts`.

## 15. Vitrines `/dev/*`, planejado e não implementado

### 15.1 Vitrines (`/dev/*`): interface sem persistência

Respondem só com `VITRINE_COMPONENTES=true` no processo do servidor ou em `next dev`; fora disso, 404. Elas usam os **mesmos componentes** das telas reais, com dados em memória e ações que só validam: **nada é gravado** e elas **não substituem** os fluxos da seção 10 em diante. Servem para ver estados difíceis de reproduzir (os 9 estados da assinatura, uma falha de mensagem, um link de avaliação inválido, o salão suspenso) e para o E2E sem banco. Parâmetros úteis: `/dev/assinatura?situacao=…&cancelar=1&historico=12`, `/dev/aviso-plano?estado=…&papel=…`, `/dev/agenda?visao=semana`, `/dev/admin-mensagens?vista=auditoria`. A lista completa está no README, uma por funcionalidade.

**Exceção:** `/dev/mp-checkout` **grava** no simulador do Mercado Pago e existe sempre que `MP_ADAPTER=simulado`, inclusive no Docker. Ele faz parte do fluxo real da assinatura (11.15). Ele não tem CSRF nem autenticação: nunca publique uma instalação com algum seletor em `simulado`.

### 15.2 Não implementado ou planejado

| Item | Situação | Evidência |
|---|---|---|
| **Login com Google** | **não implementado.** Não há OAuth, rota de callback nem variáveis de cliente; o login da equipe é só por e-mail e senha | busca por `google`/`oauth` em `src/` não encontra login social (só nomes de fontes) |
| Validação dos adaptadores reais (Mercado Pago, WhatsApp, S3, SMTP, Turnstile) com os provedores | pendente (o README fala em spike E9.3/E9.4) | README, "O que não foi validado" |
| Disparar cobranças, falhas de cobrança ou falhas de WhatsApp pela interface | não existe (só funções de controle usadas pelos testes) | README, "Adaptadores simulados" |
| Reenvio de mensagem pela equipe do salão | não existe (só o super admin, em `/admin/mensagens`) | D-043 |
| Tela global de eventos de webhook, exportação, expurgo e retenção dos dados | não existe | README, seção D-045 |
| Publicação em servidor (VPS) e bloqueio dos simuladores em ambiente publicado | não definido | README, "Riscos" |
| Revogação de consentimento por tela | não existe na v1 | README, "Termos, Privacidade e consentimento" |
| Fora do escopo da v1 | caixa, estoque, comissões, relatórios financeiros, fidelidade, pagamento de clientes, apps nativos, agendamento via WhatsApp, lembretes, mensagens promocionais, contas de cliente, vários gestores por salão, preço ou duração por profissional | `CLAUDE.md`, "Out of scope for v1" |

## 16. Divergências encontradas na documentação

Registradas aqui e **não corrigidas** nesta tarefa, que altera só documentação de apoio:

- O README, na tabela da seção "Fila de jobs e worker", marca `assinatura-prazos` como "stub (E6.3)" e não lista a fila `limpar-rate-limit`. No código, as duas são funcionais (`src/worker/handlers/assinatura-prazos.ts` chama `processarPrazos`; `limpar-rate-limit.ts` roda no minuto 17), conforme a seção 14.1.
- A seção "Mensagens de WhatsApp" do README diz que o convite termina `falhou/link_indisponivel` "enquanto a E4.5 não o injetar". A D-032 já injetou o gerador em `src/worker/handlers/whatsapp-reserva.ts`, e o convite é enviado.
- A seção "Criação de reserva" do README descreve `deps.politica` como "hoje `permitirTudo`". A D-038 já aplica a política real (`src/server/assinatura/politica-operacao.ts`).
- Nenhuma dessas divergências impede o teste. Ao atualizar o README, ajuste esses trechos.

## 17. Testes automatizados

Pré-requisitos: `npm ci`, `npm run db:generate` e, para os testes com banco, `docker compose up -d postgres` com `TEST_DATABASE_URL` definida.

| Objetivo | Comando | Banco |
|---|---|---|
| Lint (qualquer aviso reprova) | `npm run lint` | não |
| Typecheck | `npm run typecheck` | não |
| Build | `npm run build` | não |
| Unidade | `npm run test:unit` | não |
| Integração (PostgreSQL real, até 4 workers) | `npm run test:integration` | `TEST_DATABASE_URL` |
| Todos | `npm test` | idem |
| Cobertura (gate de 90% de linhas; relatório em `coverage/`) | `npm run test:coverage` | idem |
| Um arquivo | `npx vitest run --project integration tests/integration/tenant/isolamento.test.ts` | idem |
| E2E completo | `npm run test:e2e` (ou `E2E_PORT=3110 npm run test:e2e`) | base `_e2e` descartável |
| Smoke da imagem | `sh docker/smoke.sh` | stack Docker |

Os laços de estabilidade (10 repetições) e de fuso (`TZ=UTC` e `TZ=America/Sao_Paulo`) de cada funcionalidade estão no `CLAUDE.md`, em "Comandos e cobertura".

**O que o `npm run test:e2e` faz:** `next build` → `build:node` → `node dist/e2e/preparar-banco.js` (**apaga e recria** a base `<TEST_DATABASE_URL>_e2e` ou `E2E_DATABASE_URL`, migra, roda o seed e o complemento, e recria `.armazenamento-e2e/`) → `playwright test`. O servidor de teste (`next start` na `E2E_PORT`) recebe um ambiente **forçado**, que vence o `.env`: os cinco adaptadores simulados, `VITRINE_COMPONENTES=true`, `PROTECAO_*=100000`, os segredos públicos de E2E e `APP_URL=http://127.0.0.1:<E2E_PORT>`. Ele roda com `retries: 0` e `reuseExistingServer: false`: a porta precisa estar **livre**. Nunca rode duas execuções do Playwright ao mesmo tempo. Para um spec isolado, primeiro `npm run build && npm run build:node && node --env-file-if-exists=.env dist/e2e/preparar-banco.js`, depois `npx playwright test e2e/<arquivo>.spec.ts`.

**Quais specs exercitam o quê** (viewport 375×812 em todos):

| Grupo | Specs | Natureza |
|---|---|---|
| Rotas reais **com banco** (seed + complemento) | `publico-reserva`, `publico-reserva-teclado`, `publico-conflito-captcha`, `publico-suspenso`, `publico-avaliacao-denuncia` | fluxo público completo em `/studio-aurora`, `/e2e-reservas-N`, `/e2e-suspenso` |
| Rotas reais **sem depender de dados** | `landing`, `smoke`, `termos-privacidade`, `entrar`, `cadastro`, `cadastro-sem-js`, `recuperar-senha`, `convite` e `convite-sem-js` (token malformado), e os trechos de `admin-entrar*`, `admin-saloes`, `moderacao` e `admin-mensagens` que conferem os redirecionamentos de `/admin/**` | formulários, cabeçalhos e redirecionamentos |
| Vitrines `/dev/*` (sem persistência) | `a11y-base`, `agenda*`, `assinatura*`, `avaliacao*`, `aviso-plano`, `bloqueios*`, `clientes*`, `clientes-excluir*`, `configuracoes*`, `consentimento*`, `denuncia*`, `fotos*`, `funcionamento*`, `jornada*`, `mensagens-situacao*`, `moderacao*`, `perfil*`, `protecao*`, `reserva-acoes*`, `reserva-nova*`, `reserva-publica*`, `admin-saloes*`, `admin-mensagens*`, `admin-entrar*` | interface, teclado, axe 4.14.0, sem JS |

O painel autenticado (gestor, profissional e super admin) é coberto pelos testes de **integração** contra o PostgreSQL real (`tests/integration/**`), e não por E2E com login.

## 18. Diagnóstico

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `/api/health` → 503 `{"status":"indisponivel"}` ou `ECONNREFUSED` | banco fora do ar ou `DATABASE_URL` errada (porta, usuário) | `docker compose ps postgres`; `docker compose logs postgres`; confira a porta em `DATABASE_URL` (o Node não interpola `POSTGRES_PORT`) |
| `postgres` sai com `exited (1)` na 1ª subida | `TEST_DATABASE_URL` com um nome inválido ou igual ao de `POSTGRES_DB` | o log diz o motivo; corrija e crie a base com `createdb` (seção 4). `docker compose down -v` também resolve, mas **apaga o volume** |
| Testes de integração: "Defina TEST_DATABASE_URL" ou erro de permissão | variável ausente, igual à `DATABASE_URL` ou papel sem `CREATEDB` | use uma base separada; o usuário do compose já tem `CREATEDB` |
| `check-env: Variáveis de ambiente ausentes ou inválidas: X` e a app ou o worker saem com 1 | valor inválido (ex.: `VITRINE_COMPONENTES=TRUE`) ou modo `real` sem as credenciais | corrija `X`; para testar localmente, volte o seletor para `simulado` |
| `check-env` em produção nomeia `ADMIN_TOTP_CHAVE, AVALIACAO_SEGREDO, RATE_LIMIT_SEGREDO` | `NODE_ENV=production` fora do compose (ex.: `npm run start` com `NODE_ENV` exportado) | preencha os três (seção 3.2) |
| Erro 500 ao cadastrar o TOTP em `/admin/entrar` (caminho B) | `ADMIN_TOTP_CHAVE` vazia ou inválida | `openssl rand -base64 32` no `.env` e reinicie a app |
| Reserva criada, mas nenhuma linha em `sim_whatsapp_chamada` | worker parado ou schema `pgboss` ainda não criado (log `mensagem.fila_indisponivel`) | suba o worker; a reconciliação reenfileira em até cerca de 2 min |
| Worker: `worker.falha_inicio` com `politica_divergente` | a fila existente tem outra política | veja o README, "Fila de jobs e worker" |
| `EADDRINUSE` ou E2E "port already in use" | porta 3000 ocupada (inclusive pela stack Docker) | `APP_PORT`/`APP_URL` ou `E2E_PORT` (seção 7); `docker compose stop app` |
| Login "não pega" (volta a `/entrar` sem erro) no Docker | cookie `Secure` (`NODE_ENV=production`) em HTTP fora de `localhost`/`127.0.0.1`, ou Safari | acesse por `http://localhost:<porta>` no Chromium ou no Firefox, ou use o caminho B (`npm run dev`, sem `Secure`) |
| Envio de foto → 403 | `Origin` diferente de `APP_URL` (`127.0.0.1` × `localhost`, porta diferente) | acesse pelo endereço exato de `APP_URL` |
| O link do e-mail ou o retorno do checkout leva à porta errada | `APP_URL` desatualizada depois de trocar a `APP_PORT` | ajuste `APP_URL` e reinicie a app **e** o worker (`docker compose up -d --wait`) |
| "Muitas tentativas…" ao navegar na página pública | limite por IP com `TRUSTED_PROXY_HOPS=0` (balde único) | aumente os `PROTECAO_LIMITE_*` no `.env` local ou espere a janela de 15 min |
| Fotos do seed não aparecem | seed rodado em outro caminho (o volume Docker e `.armazenamento` são diferentes) | rode o seed no mesmo caminho em que a app roda |
| Página `/dev/...` → 404 | vitrine desligada | `npm run dev` ou `VITRINE_COMPONENTES=true` (só local) |
| Seed recusa: "Para forçar, defina SEED_PERMITIR_PRODUCAO=true" | seed dentro do container (`NODE_ENV=production`) | use o `-e SEED_PERMITIR_PRODUCAO=true` só nesse comando |

## 19. Encerrar e limpar

```bash
docker compose stop app worker   # para app e worker; mantém o banco no ar
docker compose down              # remove os containers; MANTÉM os dados (volumes pgdata e armazenamento)
# Caminho B: Ctrl-C no "npm run dev" e no "npm run worker" (o worker espera até 25 s pelos jobs)
```

`docker compose down -v` **apaga os volumes** (banco e fotos) de forma irreversível. Use só quando quiser recomeçar do zero de propósito. Para uma segunda stack criada com `COMPOSE_PROJECT_NAME`, derrube com o mesmo nome. `.armazenamento-e2e/`, `test-results/`, `playwright-report/` e `coverage/` são artefatos locais de teste.

## 20. Registro de verificação deste guia

Comandos executados ao escrever este guia (2026-11-22), sem alterar o `.env` existente nem a base ou os volumes de desenvolvimento. A stack Docker foi verificada num projeto Compose **isolado** (`COMPOSE_PROJECT_NAME`, portas e volumes próprios), removido ao final.

| Comando | Resultado |
|---|---|
| `docker compose config --quiet` | ok |
| `npm run build:node` | ok |
| `node dist/scripts/check-env.js` com o mínimo (`DATABASE_URL`) | `check-env: ambiente válido (adaptadores: armazenamento=simulado, email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)`, saída 0 |
| idem com `VITRINE_COMPONENTES=TRUE` | nomeia `VITRINE_COMPONENTES`, saída 1 |
| idem com `MP_ADAPTER=real` | nomeia `APP_URL, MP_ACCESS_TOKEN, MP_PREAPPROVAL_PLAN_ID, MP_WEBHOOK_SECRET`, saída 1 |
| idem com `NODE_ENV=production` | nomeia `ADMIN_TOTP_CHAVE, AVALIACAO_SEGREDO, RATE_LIMIT_SEGREDO`, saída 1 |
| diff de chaves `.env.example` × `.env` | o comando da seção 3.1 lista as chaves ausentes sem mostrar valores |

Stack Docker isolada (`COMPOSE_PROJECT_NAME=agendaguia POSTGRES_PORT=5434 APP_PORT=3110`, o mesmo mecanismo da seção 7):

| Comando | Resultado |
|---|---|
| `docker compose up -d --build --wait` | postgres e app `(healthy)`, worker `Up` |
| `curl -s …/api/health` | `{"status":"ok"}` HTTP 200 |
| `docker compose logs app` / `worker` | `check-env: ambiente válido (… todos simulado)`; `worker.adaptadores` e `worker.iniciado` com as 5 filas (`assinatura-prazos`, `exemplo`, `limpar-rate-limit`, `reconciliar-mensagens`, `whatsapp-reserva`) |
| seed no container **sem** a flag | recusa: "…Para forçar, defina SEED_PERMITIR_PRODUCAO=true." |
| seed com `-e SEED_PERMITIR_PRODUCAO=true` | `seed: ok (2 salões; credenciais de demonstração no README)` |
| `superadmin-criar.js` com `-e SUPERADMIN_*` (duas vezes) | `criado`, depois `existente` |
| `enfileirar-exemplo.js 2000` | `worker.exemplo_iniciado` e, 2 s depois, `worker.job_concluido` |
| `curl` de rotas | `/`, `/termos`, `/studio-aurora`, `/atelie-bromelia`, `/entrar`, `/cadastro`, `/admin/entrar` → 200; `/Studio-Aurora`, `/painel-x-inexistente` → 404; `/dev/componentes` → 404 (vitrine desligada no Docker); `/dev/mp-checkout` com id inexistente → 404; `/painel/agenda` → 307 `/entrar?proximo=%2Fpainel%2Fagenda`; `/admin` → 307 `/admin/entrar`; `/confirmar-email` com `Referrer-Policy: strict-origin` |
| `curl -sI /api/fotos/<id do seed>` | 200, `image/webp`, `cache-control: public, max-age=3600`, `etag`, `nosniff`; arquivos `fotos/demo-*.webp` no volume |
| webhook da seção 14.2 com assinatura válida (id desconhecido) | `{"ok":true}` HTTP 200, evento `ignorado`, `origem_valida = t` |
| idem com assinatura adulterada | `{"erro":"nao_autorizado"}` HTTP 401, evento `rejeitado`, `origem_valida = f` |
| todas as consultas `q "…"` deste guia | executadas sem erro de sintaxe ou de coluna na base migrada |
| `docker compose down -v` **do projeto isolado** | removeu só os volumes `agendaguia_*`; os volumes `agenda_beleza_*` ficaram intactos |

**Não validado neste guia:** os adaptadores reais (nenhuma credencial foi usada); os fluxos que dependem de cliques no navegador (cadastro, login, reservas, painel, checkout, TOTP, moderação), conferidos no código, nas rotas e nos testes citados em cada seção, mas não percorridos manualmente; o `oathtool`; o caminho B (`npm run dev` e `npm run worker`) de ponta a ponta; e o `npm run test:coverage` e o `npm run test:e2e` completos, não executados nesta tarefa.
