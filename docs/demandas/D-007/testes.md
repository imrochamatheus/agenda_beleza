# D-007 — Testes (T-9, tester)

## Rodada 1 — 19/11/2026

### Ambiente
- Branch `feat/d-007-adaptadores` (conferida com `git branch --show-current` no início e no fim), árvore de trabalho sem commit sobre `a042410`. Node 24.21.0, Prisma 7.10.1, Vitest 5.1.1, PostgreSQL 17 (`postgres:17` do compose), Chromium do Playwright (viewport 375×812), Docker com a imagem `agenda-beleza:dev` reconstruída a partir da árvore atual (`docker compose build app`, exit 0).
- Adaptadores: os quatro em `simulado` (padrão do `.env.example`), exceto onde a variação está indicada.
- **Sem `.env`** nos comandos npm: as variáveis do `.env.example` foram exportadas no shell (`set -a; . ./.env.example`). Os comandos marcados `env -i` rodaram só com `PATH` e `HOME`. Para o CA-1 e o CA-2 por processo, criei um `.env` temporário (`cp .env.example .env`) e o apaguei no fim.
- `npm ci` não foi refeito: usei o `node_modules` e o `src/generated/prisma` já presentes. O `package-lock.json` só acrescenta `nodemailer@10.3.1` (versão exata em `dependencies`).
- Mutações: feitas no próprio arquivo, com cópia prévia no scratchpad, restauradas por cópia e conferidas com `md5sum -c` (8/8 `SUCESSO`). Arquivos temporários (lint do CA-22, bundles `dist/tester-tmp/`) foram removidos. As linhas criadas na base de dev (assinaturas simuladas do CA-19, chamadas do laço multiprocesso do CA-21) foram apagadas. Os containers `app` e `worker` foram removidos (`docker compose rm -sf app worker`), o `postgres` continua no ar e as portas 3000/3001 ficaram livres.
- `git status --porcelain` final igual ao inicial, exceto por este arquivo.

### Gates
| Comando | Resultado |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` (`--max-warnings=0`) | exit 0 |
| `env -i PATH HOME npm run build` (sem `.env`) | exit 0, sem aviso. `ƒ /api/health`, `ƒ /dev/mp-checkout`, `ƒ /dev/mp-checkout/decisao`; `○ /`, `○ /_not-found` |
| `env -i PATH HOME EMAIL_ADAPTER=real TURNSTILE_ADAPTER=real npm run build` (sem SMTP nem chaves) | exit 0, mesmas rotas, sem aviso (CA-6, variante) |
| `env -i PATH HOME npm run build:node` | exit 0. `grep -E "^import" dist/scripts/check-env.js dist/worker/main.js` → só `zod` |
| `docker compose build app` (sem `.env`) | exit 0. Mesmas rotas `ƒ` no `next build` da imagem |
| `env -i PATH HOME npm run test:unit` (sem banco nem `DATABASE_URL`) | exit 0: 40 arquivos, 372 testes |
| `npm run test:integration` | exit 0: 33 arquivos, 644 testes (12,4 s) |
| `npm run test:coverage` | exit 0: 73 arquivos, 1016 testes. **Linhas 100% (725/725)**, statements 99,26% (808/814), funções 100% (202/202), ramos 98,44% (508/516) |
| `npm run test:e2e` (porta 3000 livre antes) | exit 0: 1 teste (`smoke.spec.ts`, mobile-chromium), 1 passou |
| Migrações num banco limpo | base descartável `tester_d007_limpo`: `npm run db:migrate:deploy` aplicou as 4 migrações; as 6 tabelas `sim_*` existem; `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` → "No difference detected". Base apagada no fim |
| Exclusões de cobertura | `git diff vitest.config.ts` vazio. `grep -rnE "v8 ignore\|istanbul ignore\|c8 ignore" src tests` (fora de `src/generated`) → vazio |
| `eslint-disable` | `grep -rn eslint-disable src tests eslint.config.mjs` (fora de `src/generated`) → vazio |
| Testes desligados | `grep -rnE "\.(skip\|only\|todo)\(" src tests` → vazio |
| Asserções vazias | varredura dos `it(`/`test(` de todos os arquivos de teste novos ou alterados: todos têm `expect`/`rejects`/`toThrow` no corpo ou num auxiliar com asserções (ex.: `rodada()` do CA-21) |
| CI | `grep -cE "secrets\.\|_ADAPTER" .github/workflows/ci.yml` → 0. Workflow sem mudança |
| `NEXT_PUBLIC_` | `grep -rn NEXT_PUBLIC_ src` → vazio |
| RN-21 | `grep -rnE "\b7900\b" src` (fora de testes) → só `src/config/plano.ts:4`. `DIAS_TESTE`/`PRECO_MENSAL_CENTAVOS` são importados por `mercadopago/simulado.ts` e `checkout-simulado.ts` |
| `console.*` nos adaptadores | `grep -rn "console\." src/server/integrations` (fora de testes) → vazio |

### Verificações manuais pedidas

**CA-1 (processo).** `cp .env.example .env && docker compose up -d --wait` → exit 0; app healthy, worker no ar.
```
app-1     | check-env: ambiente válido (adaptadores: email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)
app-1     | 4 migrations found in prisma/migrations
app-1     | No pending migrations to apply.
worker-1  | check-env: ambiente válido (adaptadores: email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)
worker-1  | {"evento":"worker.adaptadores","email":"simulado","mercadoPago":"simulado","turnstile":"simulado","whatsapp":"simulado"}
```
`docker compose logs app worker | grep -cE "agenda_dev|postgresql://"` → 0.

**CA-2 (processo).**
| Comando | Exit | Saída |
|---|---|---|
| `docker compose run --rm -e EMAIL_ADAPTER=real -e SMTP_HOST= app` | **1** | `check-env: Variáveis de ambiente ausentes ou inválidas: EMAIL_FROM, SMTP_HOST`. `grep -ciE "migrat\|prisma"` → 0 (o `migrate deploy` não rodou) |
| `docker compose run --rm --no-deps -e EMAIL_ADAPTER=real -e SMTP_HOST= worker` | **1** | mesma linha |
| `… --no-deps -e EMAIL_ADAPTER=real -e SMTP_HOST= -e EMAIL_FROM=noreply@exemplo.com.br -e SMTP_USER=u -e SMTP_PASSWORD=SenhaSuperSecreta123 worker` | **1** | `… inválidas: SMTP_HOST` (só a variável que falta; a senha não aparece) |
| `… --no-deps -e TURNSTILE_ADAPTER=real -e TURNSTILE_SECRET_KEY=SegredoTS999 -e MP_ADAPTER=real worker` | **1** | `… inválidas: MP_ADAPTER, TURNSTILE_SITE_KEY` (CA-9 por processo; o segredo não aparece) |

`EMAIL_FROM` aparece junto no 1º caso porque está vazio no `.env.example` e é obrigatório no modo real (RN-13; documentado no README, ajuste A-1 do DevOps).

**CA-19 (navegador, só teclado).** Assinatura criada pela porta do MP simulado (bundle descartável de `criarMercadoPagoSimulado` com `appUrl=http://localhost:3000`, `urlRetorno=http://localhost:3000/retorno-tester?x=1`) na base de dev, servida pelo `app` do compose (`MP_ADAPTER=simulado`). Script Playwright descartável no scratchpad, viewport 375×812, só `keyboard.press`:
- `GET /dev/mp-checkout?assinatura=<id>` → **200**. Texto: "Assinatura Agenda Beleza / R$ 79,00 por mês / 30 dias grátis… / Ambiente simulado: nenhum dado de cartão é pedido. / Autorizar assinatura / Desistir". `html[lang=pt-BR]`. Campos visíveis (`input` não oculto, `select`, `textarea`): **0**.
- Foco inicial em "Autorizar assinatura" (`autoFocus`), `:focus-visible` = true, contorno `auto 1px rgb(16,16,16)`. Tab → "Desistir" (`:focus-visible`, mesmo contorno) → corpo do documento → "Autorizar" → "Desistir": ordem lógica, sem armadilha de foco. Captura de tela com o anel de foco visível em "Autorizar assinatura" (scratchpad `ca19-foco.png`).
- Enter em "Autorizar assinatura" → `POST /dev/mp-checkout/decisao` **303**, `Location: http://localhost:3000/retorno-tester?x=1&preapproval_id=<id>` (a `urlRetorno` gravada, com a query preservada). No banco: `estado = autorizada`, `proxima_cobranca_em − autorizada_em = 30 days`.
- Reabrir a página → "Esta assinatura já foi autorizada." (`role=status`) e só o botão "Voltar ao Agenda Beleza", com foco visível.
- `curl` com URL forjada (`urlRetorno=https://evil.example/x` e `location=…` no corpo, e `?urlRetorno=…&redirect=…` na query) → 303 para a `urlRetorno` gravada; assinatura autorizada. "Desistir" → 303 para a gravada; continua `pendente`. Decisão inválida (`cancelar`) → 404. Corpo JSON → 404. ID inexistente (GET e POST) → 404.
- `MP_ADAPTER=real`: `next start -p 3001` com `env -i`, `MP_ADAPTER=real` e `DATABASE_URL` apontando para uma porta fechada (`127.0.0.1:1`) → GET da assinatura existente **404** e POST `autorizar` **404**, sem nenhum erro de conexão no log (o banco não foi consultado); a assinatura alvo continuou `pendente`.

**CA-21 (laço de 10, independente).**
- `for i in $(seq 10); do npx vitest run --project integration tests/integration/integracoes/whatsapp-concorrencia.test.ts; done` → **10/10 verdes** (3 testes cada: N = 12 com 1, 5 e 20 falhas forçadas).
- Prova adicional entre **processos** (não só conexões): bundle descartável do WhatsApp simulado sobre a base de dev; em cada rodada, 1 processo força 3 falhas e 10 processos `node` disparam `enviarModelo` em paralelo com a mesma chave. **10/10 rodadas** com exatamente 3 falhas na saída, `{"total":10,"falhas":3}` no registro e `sim_whatsapp_falha_forcada` vazia no fim. Linhas apagadas depois.

**CA-22 (lint manual).** Arquivos temporários:
- `src/server/tester-tmp-nodemailer.ts` (`import nodemailer from 'nodemailer'`) → `no-restricted-imports` (RN-16);
- `src/app/tester-tmp-url.ts` (literal `https://challenges.cloudflare.com/turnstile/v0/siteverify`) → `no-restricted-syntax` (RN-16);
- `src/server/tester-tmp-real.ts` (`@/server/integrations/email/real`) → `no-restricted-imports`.

`npm run lint` → **exit 1**. Arquivos removidos → `npm run lint` exit 0. Variantes extras: import relativo `../integrations/email/real` → erro; reexportação `export … from '../integrations/mercadopago/simulado'` → erro; host em template com interpolação e `graph.facebook.com` em string → erro; `import('nodemailer')` dinâmico → **sem erro** (ver OBS-1).

**CA-12 (segredos nos logs).** `npx vitest run --project unit src/server/integrations/email/real.test.ts src/server/integrations/turnstile/real.test.ts --reporter=verbose --silent=false` (56 testes, exit 0) com toda a saída capturada: `grep -cF` de `SMTP_PASSWORD` do teste, da forma base64 `\0usuario\0senha`, da base64 só da senha, do `TURNSTILE_SECRET_KEY` e do token Turnstile → **0** nos cinco. Logs do compose (CA-1) e saídas do CA-2 com senha e segredo definidos: nenhum valor aparece.

**CA-14.** `grep -rn NEXT_PUBLIC_ src` → vazio.

### Mutações (os testes têm de falhar)
| # | Mutação | Resultado |
|---|---|---|
| M1 | `sim-whatsapp.ts`: tirar `FOR UPDATE SKIP LOCKED` do consumo da falha forçada | **mata**: `whatsapp-concorrencia.test.ts` "5 falhas forçadas… exatamente 5" (`expected length 5 but got 2`) e o de 20 falhas |
| M1b | `sim-mercadopago.ts`: tirar `FOR UPDATE SKIP LOCKED` do erro forçado do MP | **mata**: `mp-simulado.test.ts` "5 erros forçados e 12 consultas simultâneas" e "operações concorrentes…" |
| M2 | `webhook-simulado.ts`: remover a comparação HMAC (`timingSafeEqual`) | **mata**: 6 testes do CA-16 (`data.id`, `x-request-id`, `ts`, `v1` adulterados, outro segredo) |
| M3 | `registry.ts`: `validarEnv(process.env)` no nível do módulo | **mata**: `registry.test.ts` "CA-10: importar o registro… num processo sem ambiente não lança" |
| M4 | `email/real.ts`: repassar o erro do nodemailer como `cause` | **mata**: "CA-11/CA-12: autenticação recusada… sem segredo" |
| M4b | `email/real.ts`: `logger: true` | **mata**: 2 testes (opções do transporte e CA-12) |
| M5 | `checkout-simulado.ts`: ignorar `MP_ADAPTER` (sempre ativo) | **mata**: 3 testes do CA-19 no modo real (página, carregamento e POST sem banco) |
| M6 | `checkout-simulado.ts`: redirecionar para a `urlRetorno` do formulário | **mata**: 2 testes do CA-19 ("ignorando a URL forjada", "desistir") |
| M7 | `mercadopago/simulado.ts`: preço `7990` fixo no lugar de `PRECO_MENSAL_CENTAVOS` | **mata**: CA-15 "valor de plano.ts" e 2 do CA-19 ("R$ 79,00") |
| M7b | `mercadopago/simulado.ts`: literal `7900` (mesmo valor) no lugar de `PRECO_MENSAL_CENTAVOS` | **sobrevive** aos 1016 testes. É pego pelo `grep 7900` manual (previsto no design §8) e, por acaso, pelo `npm run lint` (import não usado). Ver OBS-2 |

Todas revertidas; `md5sum -c` dos 8 arquivos → `SUCESSO`.

### Resultado por CA
| CA | Estado | Evidência |
|---|---|---|
| CA-1 | **passou** | `registry.test.ts`, `registro.test.ts`, `check-env.test.ts`, `stub.test.ts`; processo: logs do compose com os 4 `simulado` |
| CA-2 | **passou** | `check-env.test.ts`, `src/scripts/check-env.test.ts`, `stub.test.ts`; processo: app e worker exit 1 com `SMTP_HOST`, sem `migrate deploy` |
| CA-3 | **passou** | `email-simulado.test.ts`, `registro.test.ts` (pela porta do registro, link extraído do `email_log`) |
| CA-4 | **passou** | `turnstile/simulado.test.ts`, `documentacao.test.ts` (token do README = `TOKEN_TURNSTILE_SIMULADO` = `XXXX.DUMMY.TOKEN.XXXX`) |
| CA-5 | **passou** | `turnstile/real.test.ts` (stub HTTP, `success:false` → `token_invalido`; `secret`, `response`, `remoteip` no POST) |
| CA-6 | **passou** | build com `env -i` sem `.env` e com `EMAIL_ADAPTER=real`/`TURNSTILE_ADAPTER=real` → 0; `build:node` → 0; `docker compose build app` → 0; rotas `/dev/*` como `ƒ`; M3 |
| CA-7 | **passou** | `plano.test.ts` (7900, 30, sem imports) |
| CA-8 | **passou** | `check-env.test.ts`, `email/ambiente.test.ts`, `turnstile/ambiente.test.ts`; processo: CA-2 com senha definida não a mostra |
| CA-9 | **passou** | `check-env.test.ts`, `mercadopago/real.test.ts`, `whatsapp/real.test.ts`, `registry.test.ts`; processo: worker com `MP_ADAPTER=real` → exit 1 nomeando `MP_ADAPTER` |
| CA-10 | **passou** | `registry.test.ts`; M3 |
| CA-11 | **passou** | `email/real.test.ts` (stub SMTP: envelope, `Subject`, corpo, AUTH; recusa de AUTH e de RCPT; porta fechada com tempo-limite) |
| CA-12 | **passou** | `email/real.test.ts`, `turnstile/real.test.ts`; grep da saída capturada = 0; M4, M4b |
| CA-13 | **passou** | `turnstile/real.test.ts` (500, não JSON, silêncio, rede → `indisponivel`; token vazio sem requisição) |
| CA-14 | **passou** | `turnstile/real.test.ts`, `registry.test.ts`; `grep NEXT_PUBLIC_` vazio |
| CA-15 | **passou** | `mp-simulado.test.ts` (inclusive leitura por outro cliente de banco); M7 |
| CA-16 | **passou** | `webhook-simulado.test.ts`, `mp-simulado.test.ts`; M2 |
| CA-17 | **passou** | `mp-simulado.test.ts` (adiamento) |
| CA-18 | **passou** | `mp-simulado.test.ts` (erro forçado em `cancelarAssinatura`); M1b |
| CA-19 | **passou** | `checkout.test.ts` (17); manual no navegador só pelo teclado; 404 no modo real sem banco; M5, M6 |
| CA-20 | **passou** | `whatsapp-simulado.test.ts` |
| CA-21 | **passou** | `whatsapp-concorrencia.test.ts`; laço 10/10; prova multiprocesso 10/10; M1 |
| CA-22 | **passou** | `importacao-integracoes.test.ts`, `importacao-prisma.test.ts`; manual: `npm run lint` exit 1 com os violadores e 0 sem eles |
| CA-23 | **passou** | `email/port.test.ts`, `email/real.test.ts` (o stub não recebe `MAIL FROM`), `email-simulado.test.ts` (sem linha nova) |
| CA-24 | **passou** | `drift.test.ts` (bloco D-007); `migrate deploy` em base limpa + diff sem diferença; nenhuma coluna `sim_*` com cartão, segredo, token ou senha (consulta ao `information_schema` → vazio) |
| CA-25 | **passou** | `.env.example` (4 seletores `simulado`, 8 variáveis vazias), `env.test.ts` (paridade), `documentacao.test.ts`, README (seções de integrações e credenciais), CI sem `secrets.`/`_ADAPTER`, gates acima |

### Invariantes tocadas (regressão)
- **Adaptadores atrás de portas:** lint RN-16 e testes de importação verdes; nenhum `real`/`simulado` importado fora de `src/server/integrations/**`, `src/app/dev/**` e testes.
- **Isolamento entre salões:** as tabelas `sim_*` não têm `salao_id` nem são expostas por ação de tenant; a suíte de isolamento das D-004/D-005 continua verde (`npm run test:integration`).
- **Idempotência de mensagens:** o simulado não deduplica (RN-19, por desenho) e registra cada chamada; o consumo de falhas é atômico (CA-21).
- **Assinatura:** redirecionamento só para a `urlRetorno` gravada; origem do webhook simulado provada por HMAC (M2).
- **Sem dado de cartão:** checkout sem campos; nenhuma coluna de cartão.
- **UTC:** datas do MP simulado em `timestamptz`; +30 dias conferido no banco.

### Defeitos
Nenhum.

### Observações (não são defeitos desta demanda)
- **OBS-1 (baixa):** `no-restricted-imports` não cobre `import('nodemailer')` dinâmico nem `require()`. Limitação já registrada na D-005 (`dev.md:55`, `testes.md:136`) e aceita na RN-16 ("a revisão de código cobre o resto"). O CA-22 lista só imports estáticos, que estão cobertos.
- **OBS-2 (baixa):** a RN-21 ("nenhum outro arquivo de produção codifica 7900/30") não tem guarda automática: o mutante M7b (literal `7900` igual ao da fonte) passa nos 1016 testes. O design (§8) atribui essa checagem ao `grep` manual do tester, que passou. Sugestão para uma demanda futura: um teste estático, no padrão do `documentacao.test.ts`, que procure `7900` fora de `src/config/plano.ts`.
- **OBS-3 (processo):** a CI verde no PR (R-T8-1) só pode ser conferida depois do commit e do PR. O líder deve confirmar os checks antes do merge.
- **R-7/D-5:** sem verificação de `Origin` no `POST /dev/mp-checkout/decisao`. Por decisão, fica para a etapa de publicação; o README traz o aviso. Nenhum CA é violado.

### Veredito
**APROVADO.** Os 25 CAs passaram, com evidência. Todos os gates passaram: typecheck, lint, build (sem `.env` e com modo real sem credencial), build:node, unidade sem banco, integração, cobertura de 100% das linhas (limiar 90%) e E2E. A migração aplica em banco limpo, sem drift. As mutações pedidas foram mortas, exceto M7b, que o grep manual previsto pega. Não há defeito crítico, alto, médio nem baixo em aberto.
