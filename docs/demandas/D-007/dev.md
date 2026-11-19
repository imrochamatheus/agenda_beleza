# D-007 — Desenvolvimento

## T-3 — Lint RN-16

Autor: desenvolvedor. Entradas: `design.md` (§3.8, T-3, R-1), `spec.md` (RN-16, CA-22).

### Tarefa concluída e arquivos
- `eslint.config.mjs`: reestruturado conforme §3.8.
  - Constantes no topo: `PRISMA` (os 4 padrões da RN-10, sem mudança), `SDK_PROVEDOR`, `ADAPTADORES` e `ADAPTADORES_EXCETO_MP_SIMULADO`. As pastas `INTEGRACOES`, `ACESSO_AO_BANCO` e `DEV` e a lista `TESTES` também são constantes.
  - Quatro blocos `no-restricted-imports` com conjuntos de arquivos disjuntos:
    - geral: `PRISMA + SDK_PROVEDOR + ADAPTADORES`;
    - `src/server/integrations/**`: `PRISMA`;
    - `src/server/repos/**`, `src/worker/**` e `prisma/seed.ts`: `SDK_PROVEDOR + ADAPTADORES`;
    - `src/app/dev/**`: `PRISMA + SDK_PROVEDOR + ADAPTADORES_EXCETO_MP_SIMULADO`.
  - Os testes (`tests/**` e `**/*.test.{ts,tsx}`) ficam fora de todos os blocos, como antes.
  - Mais um bloco `no-restricted-syntax` (RN-16 c) com `Literal` e `TemplateElement` para `challenges.cloudflare.com`, `api.mercadopago.com` e `graph.facebook.com`. Ele vale fora de integrations, dos testes e do próprio `eslint.config.mjs`.
  - O `eslint-config-next` não configura `no-restricted-syntax`: conferido com `npx eslint --print-config src/app/page.tsx`, só aparece `no-restricted-imports`.
- `tests/integration/lint/importacao-integracoes.test.ts` (novo, CA-22 e R-1).
- `tests/integration/lint/importacao-prisma.test.ts`: **sem alteração**.

### Testes criados e CA coberto (`importacao-integracoes.test.ts`, 214 casos)
- CA-22 (a): erro com `nodemailer`, `nodemailer/lib/...`, `mercadopago`, `@mercadopago/*`, `@cloudflare/*`, `cloudflare`, `whatsapp`, `@whatsapp/*` e `@meta/*`, e também com `export … from`. Vale para `src/server/x.ts`, `src/app/x.ts`, `src/app/x.tsx` e `src/server/tenant/x.ts`, e também para repos, worker, seed e `src/app/dev/**`.
- CA-22 (b):
  - erro em `src/app/x.ts` e `src/server/x.ts` ao importar `mercadopago/simulado`, `mercadopago/real`, `mercadopago/checkout-simulado`, `email/real`, `email/simulado`, `turnstile/real.ts` e `whatsapp/simulado`, inclusive com `import type` e `export … from`;
  - erro também por caminho relativo, inclusive no worker, e em repos e seed;
  - em `src/app/dev/**`: sem erro com o MP simulado e o checkout simulado (alias e relativo), e erro com o MP real e os demais adaptadores. A RN-10 continua valendo em dev.
- CA-22 (c): erro com a URL do `siteverify` (string e template), com `api.mercadopago.com` em template com expressão, com `graph.facebook.com` e com `fetch('https://api.mercadopago.com/…')`. Vale em app, server, worker e dev.
- R-1: `src/server/integrations/x.ts` e `…/email/simulado.ts` dão erro (RN-10) ao importar `@/generated/prisma/client`, `repos/db`, `pg` e `@prisma/adapter-pg`.
- Sem erro:
  - dentro de integrations: SDKs, hosts, `./simulado`, `checkout-simulado`, repositórios e `import type` do Prisma;
  - nos testes: `tests/x.test.ts`, `tests/support/stubs/http.ts`, `src/app/x.test.ts` e `src/server/integrations/email/real.test.ts`;
  - em app, server e worker: o registro, a porta (`import` e `import type`), `ambiente`, nomes parecidos (`integrations/realidade`, `mercadopago/simulador-ui`, `pg-format`) e `https://cloudflare.com/sobre`.
- `errorCount > 0` no lint inteiro de um arquivo de `src/app` que importa `nodemailer`.
- O auxiliar falha se o arquivo simulado estiver ignorado (`dist/**`, `src/generated/**`).

### Comandos executados e resultados
| Comando | Resultado |
|---|---|
| `npm run lint` | passou (exit 0), com os arquivos em andamento de T-1 e T-2 no working tree |
| `npm run typecheck` | passou |
| `DATABASE_URL=… TEST_DATABASE_URL=…/agenda_beleza_test npx vitest run --project integration tests/integration/lint` | 2 arquivos, 254 testes passaram (40 do CA-5 da D-005 e 214 do CA-22) |
| Arquivo temporário `src/app/zz-viola-temp.ts` com `'https://graph.facebook.com/v21.0'` + `npx eslint` | exit 1 (`no-restricted-syntax`, RN-16); o arquivo foi removido |
| `grep -rn eslint-disable src tests eslint.config.mjs prisma` | só no cliente Prisma gerado (`src/generated/**`, preexistente) |

Não havia `.env` local: as URLs do `.env.example` foram passadas no ambiente do comando. Build, `npm test` completo e a cobertura não foram rodados nesta tarefa, porque a T-3 não tem código de produção em `src/` e esses gates ficam com a T-7.

### Mutações de controle (feitas e revertidas; `cmp` confirma o arquivo restaurado)
| Mutação no `eslint.config.mjs` | Falhas |
|---|---|
| M1: geral sem `SDK_PROVEDOR` | 45 (CA-22 a) |
| M2: geral sem `ADAPTADORES` | 20 (CA-22 b) |
| M3: `no-restricted-syntax` desligado | 20 (CA-22 c) |
| M4: dev com `ADAPTADORES` (sem a exceção) | 6 (exceção de dev) |
| M5: dev sem restrição de adaptadores | 5 (erro em dev fora da exceção) |
| M6: integrations sem `PRISMA` | 8 (R-1) |
| M7: repos/worker/seed sem regra | 13 |
| M8: RN-16 como bloco solto depois da RN-10 (mutação do design) | 30, inclusive o CA-5 de `importacao-prisma.test.ts` |

### Desvios e decisões
- `ADAPTADORES` inclui explicitamente `integrations/mercadopago/checkout-simulado`. O §3.8 diz que ele é proibido fora de `src/app/dev/**`, mas o padrão `[^/]+/(real|simulado)` não casa com esse nome. `ADAPTADORES_EXCETO_MP_SIMULADO` usa lookahead `(?!mercadopago/)` mais o MP real explícito.
- `import type` de adaptador também é barrado: os tipos ficam na porta. Os padrões de RN-16 não têm `allowTypeImports`.
- Os blocos de pastas usam `files` com extensão (`<pasta>/**/*.{ts,tsx,mts,js,mjs}`), para não ampliar o conjunto de arquivos lintados.
- Os repositórios, o worker e o seed passam a ter restrição de import (antes não tinham nenhuma), conforme a tabela do §3.8.

### Pendências e riscos
- Os padrões de SDK cobrem só os nomes da RN-16. Um SDK com outro nome só é barrado se for acrescentado a `SDK_PROVEDOR`.
- A regra (c) pega só literais. Hosts montados por concatenação passam, como a spec admite ("a revisão de código cobre o resto").
- Quando o T-6 criar `src/app/dev/**`, o lint real desses arquivos confirma a exceção. Hoje ela está coberta só por caminho simulado.

## T-2 — Plano, portas, ambiente, check-env e worker

Autor: desenvolvedor. Entradas: `design.md` (§3.1 a §3.5, §3.7, T-2), `spec.md` (RN-5, RN-8, RN-9 a RN-14, CA-1, CA-2, CA-6 a CA-10, CA-23, CA-25, D-1, D-10).

### Tarefa concluída e arquivos
- `src/config/plano.ts` (novo): `PRECO_MENSAL_CENTAVOS = 7900` e `DIAS_TESTE = 30`, sem imports.
- Portas (novas; só importam `zod` ou nada):
  - `src/server/integrations/email/port.ts`: `MensagemEmail`, `PortaEmail`, `ErroValidacaoEmail` (campo + mensagem fixa), `ErroEnvioEmail` (código, `temporario`, mensagem fixa, sem `cause`) e `validarMensagemEmail` (RN-9).
  - `src/server/integrations/turnstile/port.ts`: `ResultadoTurnstile`, `PortaTurnstile`, `TAMANHO_MAXIMO_TOKEN = 2048` e `tokenTurnstileAceitavel`.
  - `src/server/integrations/whatsapp/port.ts`: `MODELOS_WHATSAPP`, `EnvioModelo`, `PortaWhatsApp`, `ErroEnvioTemporario`, `ErroEnvioPermanente`, `E164_BR`, `CODIGOS_ENTRADA_INVALIDA` e `validarEnvioModelo`.
  - `src/server/integrations/mercadopago/port.ts`: tipos do §3.5, `PortaMercadoPago`, `OPERACOES_MP`, `ErroMercadoPago` (abstrata) com `RecursoNaoEncontradoNoProvedor`, `OperacaoInvalidaNoProvedor` e `ErroProvedor`, e `validarCriacaoAssinatura`.
- Ambiente por integração (novos; `email` importa só `zod`, os outros três não importam nada):
  - `email/ambiente.ts`: `SELETOR`, `CHAVES` (6), `ConfigSmtp`, `PORTA_PADRAO = 587`, `PORTA_PADRAO_SEGURA = 465` e `lerConfigReal` (RN-13 com o ajuste do D-10).
  - `turnstile/ambiente.ts`: `CHAVES` (2), `ConfigTurnstile = { segredo }` e `lerConfigReal`, que exige as duas chaves.
  - `mercadopago/ambiente.ts` e `whatsapp/ambiente.ts`: `CHAVES = []` e `lerConfigReal()`, que sempre recusa nomeando o seletor (D-1).
- `src/server/env.ts`: `esquemaEnv` continua com a base e os 4 seletores. `validarEnv` compõe os quatro `ambiente.ts` e devolve `{ DATABASE_URL, APP_URL, integracoes: { email, turnstile, mercadoPago, whatsapp } }`, cada um `{ modo: 'simulado' }` ou `{ modo: 'real', config }`. Um único `ErroDeAmbiente` lista, sem repetição e ordenadas, todas as variáveis da base e das integrações em `real`. Novos: `Modo`, `ConfigIntegracao`, `ModosAtivos`, `modosAtivos`, `modoSelecionado` e `Seletor`. `chavesDeclaradas` inclui as `CHAVES` das quatro integrações.
- `src/server/check-env.ts`: a linha de sucesso passa a ser `check-env: ambiente válido (adaptadores: email=…, mp=…, turnstile=…, whatsapp=…)`. Novo `descreverModos`.
- `src/worker/stub.ts`: depois de validar e antes do primeiro heartbeat, emite `{"evento":"worker.adaptadores","email":…,"mercadoPago":…,"turnstile":…,"whatsapp":…}`.
- `.env.example`: as 8 variáveis da RN-8, comentadas e vazias. Os comentários de `MP_ADAPTER` e `WHATSAPP_ADAPTER` avisam que `real` é recusado até a E6.6/E7.2.

### Testes criados ou alterados e CA coberto
| Arquivo | Cobre |
|---|---|
| `src/config/plano.test.ts` (novo) | CA-7 (valores e ausência de imports) |
| `src/server/integrations/email/port.test.ts` (novo) | CA-23/RN-9: destinatário inválido, vazio, vários (`,` `;`), `Nome <…>`, CR/LF; assunto com CR, LF, CRLF, vazio ou só espaços; texto vazio; tipos errados; mensagem fixa sem eco do valor; `ErroEnvioEmail` sem `cause` |
| `src/server/integrations/turnstile/port.test.ts` (novo) | RN-10: token ausente, nulo, vazio, só espaços e com 2049 caracteres não é aceitável; com 2048 é |
| `src/server/integrations/whatsapp/port.test.ts` (novo) | RN-11: `E164_BR` (aceita e rejeita, inclusive `+12025550123`), modelo, chave vazia ou ausente → `ErroEnvioPermanente` com código; mensagens fixas |
| `src/server/integrations/mercadopago/port.test.ts` (novo) | RN-12: hierarquia e códigos dos erros; `validarCriacaoAssinatura` (UUID, e-mail, URL http/https; campos nomeados sem valores) |
| `src/server/integrations/email/ambiente.test.ts` (novo) | CA-8 e D-10: 587/465, porta explícita prevalece, limites 1 e 65535, `SMTP_PORT` e `SMTP_SECURE` malformados, par usuário/senha nos dois sentidos, `EMAIL_FROM` válido e inválido (inclusive CR/LF e dois endereços), lista completa ordenada sem valores, só importa `zod` |
| `src/server/integrations/turnstile/ambiente.test.ts` (novo) | CA-8: chaves ausentes nomeadas; a config só leva o segredo (CA-14); sem imports |
| `src/server/integrations/{mercadopago,whatsapp}/ambiente.test.ts` (novos) | CA-9: recusa nomeando o seletor; sem imports |
| `src/server/env.test.ts` (alterado) | Paridade `.env.example` × `env.ts` (mantida); CA-25 (RN-8 vazias e seletores em `simulado`); CA-1 (`.env.example` → 4 simulados); CA-2; CA-9; agregação de todas as variáveis num único erro; CA-8 (simulado ignora as variáveis do provedor); seletor inválido; `ErroDeAmbiente` sem repetição; `modoSelecionado` (6 casos); `modosAtivos` sem valores. O antigo caso "aceita o adaptador real" virou o caso do e-mail real completo, porque `EMAIL_ADAPTER=real` sem SMTP agora falha de propósito (RN-13) |
| `src/server/check-env.test.ts` (alterado) | CA-1 (linha dos modos); CA-2; CA-9; CA-8: as 7 combinações com as variáveis nomeadas exatamente, "nenhum valor na saída" em cada uma, tudo satisfeito → 0 sem valores, seletores simulados com `SMTP_PORT=abc` → 0 |
| `src/scripts/check-env.test.ts` (alterado) | Linha nova de sucesso; CA-2 pelo ponto de entrada (`exitCode` 1, `SMTP_HOST`) |
| `src/worker/stub.test.ts` (alterado) | CA-1: `worker.adaptadores` antes do primeiro heartbeat, com a linha JSON exata e sem valores; CA-2 (`sair(1)`, `variaveis: ['SMTP_HOST']`); CA-9. Contagens de eventos dos testes antigos ajustadas (+1 evento) |

### Comandos executados e resultados
Node 24.21.0 (`nvm use`). Sem `.env`: para os testes, as variáveis do `.env.example` foram exportadas com `set -a; . ./.env.example; set +a`. Com T-1 e T-3 em andamento no mesmo working tree.

| Comando | Resultado |
|---|---|
| `npm run typecheck` | passou |
| `npm run lint` | passou (0 avisos) |
| `npm run build` sem `.env` e sem as variáveis no ambiente | exit 0 |
| `env -u SMTP_HOST EMAIL_ADAPTER=real npm run build` | exit 0 (CA-6, variante) |
| `npm run build:node` | exit 0; `grep -E "^import" dist/scripts/check-env.js` só mostra `zod` (e `dist/worker/main.js` também); nenhuma ocorrência de `nodemailer` ou `prisma` |
| `node dist/scripts/check-env.js` (`.env.example` exportado) | exit 0: `check-env: ambiente válido (adaptadores: email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)` |
| idem com `EMAIL_ADAPTER=real SMTP_HOST=` | exit 1: `…: EMAIL_FROM, SMTP_HOST` |
| idem com `MP_ADAPTER=real` | exit 1: `…: MP_ADAPTER` |
| `node dist/worker/main.js` (SIGINT depois de 2 s) | `worker.adaptadores` (4 × simulado), heartbeat e `worker.encerrando` |
| `EMAIL_ADAPTER=real node dist/worker/main.js` | exit 1: `{"evento":"worker.ambiente_invalido","variaveis":["EMAIL_FROM","SMTP_HOST"]}` |
| `npm run test:unit` | 31 arquivos, 236 testes passaram |
| `npm test` (PostgreSQL do compose no ar) | 57 arquivos, 781 testes passaram |
| `npm run test:coverage` | passou; "All files" com 100% de linhas (a única linha de ramo não coberta é a preexistente `stub.ts:21`, erro que não é `ErroDeAmbiente`) |
| `grep -rn eslint-disable` nos arquivos da T-2 | vazio |
| `grep -rnE "\b7900\b" src` (sem testes) | só `src/config/plano.ts` |

Nenhuma dependência nova. `package.json` e `package-lock.json` não foram tocados.

### Desvios e acréscimos ao desenho
- `turnstile/port.ts` exporta também `tokenTurnstileAceitavel(token)`: a regra "vazio, só espaços ou > 2048 → `token_invalido` sem rede" vale para simulado e real, e fica na porta, como o §1 pede para as validações comuns. A T-4 deve usá-la nos dois adaptadores.
- `mercadopago/port.ts` exporta também `validarCriacaoAssinatura(e): OperacaoInvalidaNoProvedor | null`, pelo mesmo motivo (regra do §3.5, comum a simulado e real). A T-5 deve usá-la antes de gravar.
- `whatsapp/port.ts` exporta `CODIGOS_ENTRADA_INVALIDA` (`destinatario_invalido`, `modelo_invalido`, `chave_idempotencia_vazia`), os códigos dos erros de `validarEnvioModelo`.
- Os erros do MP têm mensagem padrão, mas aceitam uma mensagem opcional (que a porta não usa para ecoar valores). Os erros de e-mail e WhatsApp têm mensagem fixa, sem parâmetro.
- `mercadopago/ambiente.ts` e `whatsapp/ambiente.ts` declaram `lerConfigReal()` sem parâmetro: o tipo continua compatível com o contrato comum (`ModuloAmbiente` em `env.ts`, conferido por `satisfies`), e assim não há parâmetro não usado nem `void`. A E6.6/E7.2 acrescentam o parâmetro.
- `ConfigMercadoPagoReal` e `ConfigWhatsAppReal` são `Readonly<Record<string, never>>` até a E6.6/E7.2.
- `ModosAtivos` e o evento `worker.adaptadores` usam a ordem alfabética das chaves (`email`, `mercadoPago`, `turnstile`, `whatsapp`), a mesma do §3.7.
- `ErroDeAmbiente` passou a remover nomes repetidos (antes só ordenava). Isso não muda nenhum caso existente.
- `ConfigSmtp.remetente` guarda `EMAIL_FROM` sem espaços nas pontas, no formato informado (`email` ou `Nome <email>`).

### Pendências e riscos
- A T-6 precisa construir o registro sobre `validarEnv(fonte).integracoes` e `modoSelecionado`. A T-4 consome `ConfigSmtp` (inclusive `seguro`) e deve ligar `requireTLS` quando houver autenticação sem `seguro` (R-3).
- A cobertura acima foi medida com os arquivos em andamento de T-1 e T-3. A medição oficial fica com a T-7.
- O CA-2 por processo (`docker compose run`) fica com a T-8 e o tester. Aqui ele foi provado pelo bundle `dist/` executado diretamente.

## T-4 — Adaptadores reais, Turnstile simulado e stubs

Autor: desenvolvedor. Entradas: `design.md` (§1.2, §3.3, §3.6, §3.9, R-2, R-3, T-4), `spec.md` (RN-6, RN-7, RN-9, RN-10, RN-22, CA-4, CA-5, CA-9, CA-11 a CA-14, CA-23), a T-2 deste arquivo.

### Tarefa concluída e arquivos
- `package.json` / `package-lock.json`: `npm install --save-exact nodemailer@10.3.1`, que ficou em `dependencies` como `"nodemailer": "10.3.1"`. O lock ganhou só a entrada `node_modules/nodemailer` (licença MIT-0, sem dependências). Não foi instalado `@types/nodemailer`: o pacote traz os próprios tipos, e `SMTPTransportOptions` é importado de `nodemailer`. Não há `^` nem `~` no `package.json`.
- `src/server/integrations/nao-implementado.ts` (novo): `NaoImplementado(item: 'E6.6' | 'E7.2')`, com `item` e a mensagem "Adaptador real ainda não implementado (E6.6)." (ou E7.2).
- `src/server/integrations/mercadopago/real.ts` (novo): `criarMercadoPagoReal(opcoes?: { urlBase? })`. Os 6 métodos da porta, inclusive `validarWebhook`, rejeitam com `NaoImplementado('E6.6')`.
- `src/server/integrations/whatsapp/real.ts` (novo): `criarWhatsAppReal(opcoes?: { urlBase? })`. `enviarModelo` rejeita com `NaoImplementado('E7.2')`.
- `src/server/integrations/turnstile/simulado.ts` (novo): `TOKEN_TURNSTILE_SIMULADO = 'XXXX.DUMMY.TOKEN.XXXX'`, `CHAVE_SITE_TURNSTILE_SIMULADA = '1x00000000000000000000AA'` e `criarTurnstileSimulado()`. Usa `tokenTurnstileAceitavel` e depois a igualdade estrita com o token. O token é reutilizável e não há rede.
- `src/server/integrations/turnstile/real.ts` (novo): `URL_SITEVERIFY`, `TIMEOUT_TURNSTILE_MS = 5000` e `criarTurnstileReal({ segredo, lerChaveDoSite, urlSiteverify?, timeoutMs?, fetch? })`, conforme o §3.3.
  - `tokenTurnstileAceitavel` é chamado antes da rede.
  - A requisição é um `POST` form-urlencoded com `secret`, `response` e `remoteip` (este só quando informado), com `AbortSignal.timeout`. O tempo-limite também cobre a leitura do corpo.
  - `success === true` dá válido, `success === false` dá `token_invalido` e qualquer outro caso dá `indisponivel`. O `catch` descarta o erro, sem log.
  - `chaveDoSite()` chama `lerChaveDoSite()` a cada vez.
- `src/server/integrations/email/real.ts` (novo): `TIMEOUTS_SMTP_MS` (10 s por fase), `OpcoesEmailReal`, `opcoesDoTransporte` (pura), `traduzirErroSmtp` (pura) e `criarEmailReal`, que devolve `PortaEmail & { fechar() }`, conforme o §3.9.
  - `requireTLS = exigirTls ?? (!seguro && autenticacao !== null)`.
  - `logger: false`, `debug: false`, `disableFileAccess` e `disableUrlAccess`.
  - `validarMensagemEmail` roda antes de qualquer conexão.
  - O erro do nodemailer é traduzido num `ErroEnvioEmail` novo, sem `cause`, `command`, `response` nem `message` do original.
- `tests/support/stubs/http.ts` (novo): `iniciarStubHttp({ modo?, resposta? })` em `127.0.0.1:0`, que registra método, caminho, cabeçalhos e corpo de cada requisição. Tem os modos `aceitar`, `status500`, `naoJson` e `silencioso`, mais `definirModo`, `definirResposta` e `fechar()` (que derruba as conexões pendentes). Também exporta `portaFechada()`.
- `tests/support/stubs/smtp.ts` (novo): stub SMTP com `node:net` em `127.0.0.1:0`, que implementa EHLO/HELO, AUTH PLAIN e AUTH LOGIN (com credenciais esperadas opcionais), MAIL, RCPT, DATA (com dot-unstuffing), RSET, NOOP e QUIT, com códigos reais. Não anuncia STARTTLS.
  - Modos: `aceitar`, `recusarAuth` (535), `recusarRcpt` (550), `adiarRcpt` (451) e `silencioso` (sem saudação).
  - Registra as mensagens (`mailFrom`, `rcptTo`, `dados`, `autenticacao`), os comandos e o número de conexões.

### Testes criados e CA coberto
| Arquivo | Cobre |
|---|---|
| `src/server/integrations/email/real.test.ts` (36) | `opcoesDoTransporte`: objeto completo, R-3 (`requireTLS` com autenticação sem `secure`; falso com 465 ou sem autenticação; `exigirTls` prevalece), tempos-limite padrão e substituíveis, `logger`/`debug` desligados. `traduzirErroSmtp`: tabela de 14 casos de código e `temporario`, e o erro novo sem `cause` e só com as chaves `codigo`, `name` e `temporario`. **CA-11**: entrega ao stub com `MAIL FROM` = remetente, `RCPT TO` = destinatário, `Subject`, `From`, `To`, corpo, `Message-ID` = `provedorId` e autenticação com usuário e senha; `EMAIL_FROM` com nome (o envelope leva só o endereço); `html` como `multipart/alternative`; envio sem AUTH quando não há credenciais; o padrão de produção (`requireTLS`) recusa autenticar num servidor sem STARTTLS e não envia `AUTH`. **CA-11/CA-12**: autenticação recusada (`autenticacao`, permanente), RCPT 550 (`recusado`, permanente), RCPT 451 (`recusado`, temporário), porta fechada e servidor silencioso (`conexao`, temporário, abaixo de 2 s). Nos cenários de falha, a serialização do erro e a saída capturada (`console.*`, `stdout` e `stderr`) não contêm a senha, o base64 do `AUTH PLAIN` nem o base64 da senha. **CA-23 (real)**: destinatário inválido, vários destinatários (`,` e `;`), assunto com CR/LF e texto vazio dão `ErroValidacaoEmail` com o campo certo, e o stub não recebe nem conexão |
| `src/server/integrations/turnstile/real.test.ts` (20) | **CA-13**: `success:true` dá válido, com `POST`, caminho, `content-type` e corpo (`secret`, `response` e `remoteip`; sem `remoteip` quando não há ip). **CA-5**: `success:false` dá `token_invalido`. `success` ausente ou não booleano e JSON que não é objeto ou é nulo dão `indisponivel`. **CA-13/CA-12**: HTTP 500, corpo não JSON, stub silencioso (entre 180 ms e 2 s com tempo-limite de 200 ms), porta fechada e `fetch` que rejeita com um erro que contém o segredo e o token dão `indisponivel`, sem lançar e sem o segredo nem o token na saída capturada. **CA-13**: token ausente, nulo, vazio, só com espaços ou acima de 2048 dá `token_invalido`, e o stub não recebe requisição. URL padrão = `URL_SITEVERIFY`. **CA-14**: `chaveDoSite()` devolve o valor vigente de `TURNSTILE_SITE_KEY` em duas chamadas, com troca entre elas |
| `src/server/integrations/turnstile/simulado.test.ts` (12) | **CA-4**: o token documentado é válido, inclusive reapresentado; outro token, o documentado com espaço ou em minúsculas, vazio, nulo, ausente ou grande demais dão `token_invalido`. Constantes de D-7. **CA-14** (simulado): devolve a chave documentada mesmo com `TURNSTILE_SITE_KEY` definido. Sem `fetch` |
| `src/server/integrations/mercadopago/real.test.ts` (7) | **CA-9**: a instância tem exatamente os métodos da porta (`OPERACOES_MP` + `validarWebhook`), e cada um rejeita com `NaoImplementado`, `item` E6.6 e a mensagem exata. O `Record<keyof PortaMercadoPago, …>` faz o typecheck falhar se a porta ganhar um método sem caso |
| `src/server/integrations/whatsapp/real.test.ts` (2) | **CA-9**: exatamente `enviarModelo`, que rejeita com `NaoImplementado` E7.2 |
| `src/server/integrations/nao-implementado.test.ts` (2) | CA-9: nome, `item` e mensagem para E6.6 e E7.2 |

Os testes de tempo-limite usam tempos injetados de 200 a 300 ms. Medido: SMTP silencioso 306 ms, porta fechada 12 ms, Turnstile silencioso 203 ms (todos abaixo de 2 s).

### Mutações de controle (feitas e revertidas; `cmp` confirma os arquivos restaurados)
| Mutação | Resultado |
|---|---|
| E1: `traduzirErroSmtp` repassa `cause: erro` (mutação pedida para o CA-12) | 2 falhas: o caso puro do CA-12 e "autenticação recusada" (o stub ecoa o `AUTH PLAIN` na resposta 535, que vai parar em `cause.response`) |
| E2: `logger: true` e `debug: true` | 2 falhas: `opcoesDoTransporte` e "autenticação recusada" (o base64 aparece na saída capturada) |
| E3: copiar o `response` do original para o erro novo | 3 falhas (CA-12) |
| T1: `console.error` do erro e do corpo no `catch` do Turnstile | 4 falhas (CA-12) |
| T2: sem `AbortSignal.timeout` | 1 falha (tempo-limite do stub silencioso) |
| T3: só testar `typeof token` antes da rede | 3 falhas (CA-13: o stub recebeu requisição) |

### Comandos executados e resultados
Node 24.21.0 (`nvm use`). Sem `.env`: as variáveis do `.env.example` foram exportadas com `set -a; . ./.env.example; set +a`. O working tree tinha arquivos em andamento da T-1 e da T-5.

| Comando | Resultado |
|---|---|
| `npm install --save-exact nodemailer@10.3.1` | 1 pacote adicionado, 0 vulnerabilidades |
| `npm ci` numa cópia isolada de `package.json`, `package-lock.json` e `.npmrc` (para não reinstalar o `node_modules` usado em paralelo pela T-5) | exit 0, sem aviso de `allowScripts`. O único aviso é a depreciação do `eslint@9.39.5`, que já existia. `nodemailer` 10.3.1 instalado |
| `npm run lint` | passou (0 avisos) |
| `npm run typecheck` | passou |
| `npm run build` (sem `.env` e sem variáveis) | exit 0 |
| `npm run build:node` | exit 0. `grep -E "^import" dist/scripts/check-env.js` só mostra `zod`, e `grep -c nodemailer` dá 0 no `check-env.js` e no `worker/main.js` |
| `npm run test:unit` | 39 arquivos, 356 testes passaram |
| Testes do e-mail real e do Turnstile, 5 execuções seguidas | 82/82 nas 5 |
| Cobertura (informativa, só unidade) dos 6 arquivos de produção da T-4 | 100% de linhas, ramos, funções e statements |
| `grep -rn "console\." src/server/integrations` (fora dos testes) | vazio |
| `grep -rn eslint-disable src/server/integrations tests/support/stubs` | vazio |
| `grep -rn NEXT_PUBLIC_ src` (fora de `src/generated`) | vazio |

A T-4 não tem teste de integração: pelo §8, os adaptadores reais são testados em unidade contra os stubs locais, sem banco. A cobertura oficial (`npm run test:coverage`) e o `npm test` completo ficam com a T-7.

### Desvios e acréscimos ao desenho
- `email/real.ts` exporta também `traduzirErroSmtp(erro)`, a tradução pura do §3.9. Assim os ramos de código e `temporario` (inclusive `outro`) são testados sem forçar cada falha no stub. O `criarEmailReal` a usa.
- O `criarEmailReal` devolve o tipo `EmailReal = PortaEmail & { fechar(): void }`. O `fechar()` fica fora da porta, como o §3.9 pede.
- `OpcoesEmailReal.timeouts` é `Partial<Record<…, number>>` (e não `Partial<typeof TIMEOUTS_SMTP_MS>`, cujo tipo literal `10000` impediria injetar tempos curtos).
- `traduzirErroSmtp`: com `responseCode` 5xx, `RCPT`/`MAIL` vira `recusado`. Um 4xx em `RCPT` que não vem como `EENVELOPE` cai em `outro` (temporário). Pela regra do §3.9, só o `EENVELOPE` cobre o 4xx.
- `criarMercadoPagoReal` e `criarWhatsAppReal` recebem `opcoes = {}` e fazem `void opcoes`. O `@typescript-eslint/no-unused-vars` do projeto não tem `argsIgnorePattern`, então `_o` geraria aviso e reprovaria o lint (`--max-warnings=0`). A E6.6 e a E7.2 passam a usar o parâmetro.
- O `validarWebhook` do stub do MP também rejeita, porque o CA-9 exige que "todo método" rejeite. A regra "nunca lança" da porta vale para o adaptador implementado (E6.6).
- No modo `recusarAuth`, o stub SMTP ecoa na resposta 535 a credencial recebida. É de propósito: torna detectável qualquer repasse de `response`/`cause` (mutação E1).
- Os testes importam os stubs por caminho relativo (`../../../../tests/support/stubs/…`), porque o alias `@/` aponta só para `src/`.

### Pendências e riscos
- A T-6 deve montar o Turnstile real com `lerChaveDoSite: () => process.env.TURNSTILE_SITE_KEY` e tratar o vazio (`ErroDeAmbiente ['TURNSTILE_SITE_KEY']`). Também deve repassar ao `criarEmailReal` a `ConfigSmtp` de `validarEnv` **sem** `exigirTls` (só os testes o passam).
- O R-6 (`nodemailer` no bundle do Turbopack) só aparece quando uma rota importar o registro. A prova descartável fica com a T-6.
- O stub SMTP não implementa STARTTLS. O caminho TLS real (465 ou STARTTLS em 587) não tem teste automatizado: o que o cobre é o teste de `opcoesDoTransporte` mais o teste de que o padrão de produção recusa um servidor sem STARTTLS.

## T-5 — Repositórios de plataforma e simulados persistentes

Autor: desenvolvedor. Entradas: `design.md` (§3.5, §3.10, T-5), `spec.md` (RN-2, RN-4, RN-15, RN-17 a RN-21, CA-3, CA-15 a CA-18, CA-20, CA-21, CA-23), `dba.md` (§3, §4, §7, §8, A-1 a A-7).

### Tarefa concluída e arquivos (todos novos)
- Repositórios de plataforma (`src/server/repos/`). Não recebem `ContextoEscopado`: é uma exceção documentada, como `sessao.ts`. Recebem um `PrismaClient` opcional, e o padrão é `obterPrisma()`, resolvido em cada chamada:
  - `email-log.ts`: `repoEmailLog` (`registrar` e `listarPorDestinatario`, este com `criado_em DESC`).
  - `sim-mercadopago.ts`: `repoSimMercadoPago`. Usa os SQL da §4.2 e da §4.3 do `dba.md`:
    - `autorizar` e `cancelar` com `UPDATE` condicional e releitura do estado;
    - `registrarCobranca` e `adiar` em `$transaction` `READ COMMITTED`, com `SELECT … FOR UPDATE`;
    - `consumirErroForcado` com `DELETE … (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`.
  - `sim-whatsapp.ts`: `repoSimWhatsApp`.
    - `registrarChamada` é uma instrução única com CTE (§4.1).
    - Uma chamada inválida é um `INSERT` simples, sem o CTE, e não consome falha forçada.
    - `forcarFalhas` usa `generate_series`.
    - `listarChamadas` aceita filtro por chave.
- Adaptadores (`src/server/integrations/`):
  - `email/simulado.ts`: `criarEmailSimulado`. Chama `validarMensagemEmail`, grava em `email_log` (o corpo é o `texto`, D-8) e devolve `{ provedorId: id }`.
  - `mercadopago/datas.ts`: `somarDias` e `somarUmMes` (UTC; o dia é limitado ao último dia do mês).
  - `mercadopago/webhook-simulado.ts`: `SEGREDO_WEBHOOK_SIMULADO`, `TIPOS_MP`, `notificacaoSimulada` e `validarNotificacaoSimulada`. Usa HMAC-SHA256 do manifesto `id:…;request-id:…;ts:…;`, comparado com `timingSafeEqual`, e nunca lança.
  - `mercadopago/simulado.ts`: `criarMercadoPagoSimulado({ appUrl, agora?, repo? })`, que implementa `PortaMercadoPago` e `ControleMpSimulado`.
  - `whatsapp/simulado.ts`: `criarWhatsAppSimulado({ repo? })`, que implementa `PortaWhatsApp` e `ControleWhatsAppSimulado`. Exporta também `CODIGO_FALHA_FORCADA = 'falha_forcada'` e `PREFIXO_ID_MENSAGEM_SIMULADA = 'wamid.SIM.'`.
- Ajustes do DBA aplicados:
  - A-1: o repositório expõe `cobradoEm`, e a porta o devolve como `ocorridoEm`.
  - A-2: `modelo` é gravado como texto, inclusive um modelo inválido.
  - A-3: todo `UPDATE` bruto grava `atualizado_em = now()`.
  - Cast explícito em todo parâmetro de SQL bruto (`::uuid`, `::timestamptz`, `::int`, `::jsonb`, `::text` e os enums `sim_*`), e `::text` na saída de enum.
  - Um ID que não é UUID devolve `nao_encontrada`/`null`/`[]` no repositório e `RecursoNaoEncontradoNoProvedor` na porta, **antes** do SQL.
  - O valor vem de `PRECO_MENSAL_CENTAVOS`, e os dias de teste vêm de `DIAS_TESTE`.
  - Um erro `23514` de CHECK não é traduzido.
- Ordem dentro de cada operação da porta do MP:
  1. validação de entrada (`validarCriacaoAssinatura`, UUID, data válida);
  2. `consumirErroForcado(op)`;
  3. o efeito.

  Por isso uma entrada inválida não consome o erro forçado (teste "ID que não é UUID … erro forçado pendente não é consumido").

### Testes criados e CA coberto
| Arquivo | Cobre |
|---|---|
| `src/server/integrations/mercadopago/datas.test.ts` (unitário, 14) | R-10: 31/jan → 28/fev e 29/fev (ano bissexto), 30/jan, 29/fev → 29/mar, 31/mar → 30/abr, 31/ago → 30/set, 31/dez → 31/jan, hora preservada, `somarDias` em UTC, a data recebida não é alterada |
| `src/server/integrations/mercadopago/webhook-simulado.test.ts` (unitário, 27) | CA-16 (parte pura): HMAC exato do manifesto sob o segredo documentado; válida em ordem trocada e com corpo sem `data`; 20 adulterações (`data.id` na consulta ou no corpo, `x-request-id`, `ts`, `v1`, outro segredo, cabeçalhos ausentes ou malformados, `type` desconhecido ou divergente) → `{ valida: false }`; entrada malformada sem lançar |
| `tests/integration/integracoes/email-simulado.test.ts` (15) | CA-3: destinatário, assunto e o link (com `token`) extraído do corpo, conferidos por SQL direto; `html` não gravado (D-8); `listarPorDestinatario` em ordem DESC. RN-15: o rollback do chamador (`emTransacao`) não apaga a linha; o que outro `PrismaClient` grava é lido pela aplicação. CA-23: 10 entradas inválidas (inclusive injeção de cabeçalho por CR/LF) → `ErroValidacaoEmail` com o campo e `email_log` sem linha nova, mais o controle positivo |
| `tests/integration/integracoes/mp-simulado.test.ts` (33) | CA-15: criar (pendente, `salaoId`, 7900, `urlCheckout`, linha bruta), autorizar em T → T + 30 dias com `atualizado_em` avançando, aprovada (+1 mês, 31/dez → 31/jan → 28/fev), recusada (estado e data intactos), cancelamento, cobrar pendente ou cancelada sem novo pagamento, transições inválidas sem efeito, cancelamento idempotente, ID desconhecido ou não UUID em todas as operações, entrada inválida sem gravar, leitura e escrita por instância sobre outro cliente (`criarPrisma(urlDoWorker())`), RN-15 (rollback do chamador). CA-16 ponta a ponta: autorização, cancelamento, aprovada e falha validadas, com o recurso consultável; adulterações → inválida. CA-17: adiamento registrado (anterior, D) e refletido; segundo adiamento; D no passado, igual a agora ou inválida, e assinatura pendente ou cancelada → erro, sem mudança. CA-18 e RN-18: erro forçado em `cancelarAssinatura`, isolamento por operação, uma linha por chamada, as 5 operações sem efeito, configurado por um cliente e consumido por outro. Concorrência: 2 aprovações → 2 pagamentos e +2 meses; 6 aprovações → +6 meses; 8 `autorizar` → 1 sucesso e 7 `OperacaoInvalidaNoProvedor`; 5 erros forçados e 12 consultas → exatamente 5, em 3 rodadas; operações mistas sem erro de banco |
| `tests/integration/integracoes/whatsapp-simulado.test.ts` (12) | CA-20: sucesso com tudo registrado (inclusive por SQL direto); 2 temporárias em 3 envios; permanente; `+12025550123` → `ErroEnvioPermanente`, registrada como falha **sem** consumir a falha forçada pendente; falha configurada por um cliente e consumida por outro. RN-19: FIFO (temporária, temporária, permanente, sucesso); modelo inválido e chave vazia registrados; entrada malformada em runtime registrada sem erro de banco; sem deduplicação; `forcarFalhas` recusa `n` inválido e tipo desconhecido. RN-15: rollback do chamador |
| `tests/integration/integracoes/whatsapp-concorrencia.test.ts` (3) | CA-21: N = 12 com 1 falha (3 rodadas), N = 12 com 5 falhas (3 rodadas, o caso que detecta a retirada do `SKIP LOCKED`), e 20 falhas com 12 envios (12 falhas e 8 pendentes). O pool do Prisma (16) é aquecido antes do disparo |

### Comandos executados e resultados
Node 24.21.0 (`nvm use`). Sem `.env`: `set -a; . ./.env.example; set +a`. O PostgreSQL do compose estava no ar. A árvore de trabalho continha os arquivos em andamento da T-4.

| Comando | Resultado |
|---|---|
| `npm run typecheck` | passou |
| `npm run lint` | passou (0 avisos) |
| `npm run test:integration` | 30 arquivos, 608 testes passaram |
| `npx vitest run --project unit src/server/integrations/mercadopago` | 5 arquivos, 61 testes passaram |
| `npx vitest run --project integration tests/integration/integracoes/` repetido | 20 execuções seguidas, todas verdes, depois da correção do teste descrita abaixo |
| Laço do CA-21 (`for i in $(seq 10); do npx vitest run --project integration tests/integration/integracoes/whatsapp-concorrencia.test.ts \|\| break; done`) | 10/10 |
| `npx vitest run --coverage` (com limiar 0 e relatório no scratchpad, só para medir) | 69 arquivos, 964 testes; "All files" com 100% de linhas. Arquivos da T-5: 100% de linhas; ramos com 100%, exceto `sim-mercadopago.ts` (85%) |
| `grep -rn '\$transaction\|\$queryRaw\|\$executeRaw' src/server/integrations` | vazio |
| `grep -rn eslint-disable` nos arquivos da T-5 | vazio |
| `grep -rnE "\b7900\b" src` (fora dos testes) | só `src/config/plano.ts` |

Durante a repetição, apareceu uma intermitência (cerca de 1 em 16 execuções) **no teste**, não no código. O caso "`v1` adulterado" do CA-16 de integração trocava o primeiro dígito por `0`, e quando o dígito já era `0` a notificação ficava intacta. A troca passou a ser sempre por um dígito diferente. A versão unitária já fazia isso.

### Mutações de controle (feitas e revertidas; `cmp` confirma o arquivo restaurado)
| Mutação | Resultado |
|---|---|
| M1: `sim-whatsapp.ts` sem `FOR UPDATE SKIP LOCKED` (subconsulta sem trava) | pega em 3/3 execuções: falham os casos de 5 falhas e de 20 falhas do CA-21. O caso de 1 falha passa, como o DBA previu |
| M2: `sim-whatsapp.ts` com `FOR UPDATE` sem `SKIP LOCKED` | não é pega (3/3 verdes). É uma **mutação equivalente**: com o `LockRows` abaixo do `Limit`, quem espera pula a linha apagada e trava a seguinte. O resultado continua correto, só que serializado. Não é defeito |
| M3: `sim-mercadopago.ts` (`consumirErroForcado`) sem `FOR UPDATE SKIP LOCKED` | pega em 5/5 execuções (5 erros e 12 consultas, 3 rodadas, pool aquecido). A primeira versão do teste, com 3 erros e 10 consultas sem aquecer, só pegava em 1/3 e foi reforçada |
| M4: `webhook-simulado.ts` sem a verificação HMAC | unitário: 5 falhas; integração: o caso de adulteração do CA-16 falha |

### Desvios e decisões
- **Os repositórios recebem `PrismaClient`, não `Executor`.** O §3.10 previa um `Executor` opcional, mas a RN-15 exige gravar fora da transação do chamador, e o `registrarCobranca` e o `adiar` precisam de `$transaction`, que um `TransactionClient` não tem. Com `PrismaClient`, passar uma transação do chamador vira erro de tipo. A prova "entre processos" continua possível com `criarPrisma(urlDoWorker())`.
- **`registrarCobranca` ganhou o 5º parâmetro opcional `avancarProxima(lida)`.** O avanço é calculado sobre a data lida **sob trava**, dentro da transação do repositório. A regra (`somarUmMes`) fica no simulado e não cria dependência de `repos` para `integrations`. O simulado passa a função só para a cobrança aprovada.
- **Os repositórios não importam a porta.** As entradas são tipos estruturais próprios: `EntradaChamada`, com `modelo: string`, compatível com `EnvioModelo`, e `SimMpOperacao`, o enum do Prisma, igual a `OperacaoMp`.
- `forcarErro` (MP) recusa uma operação fora de `OPERACOES_MP`, e `forcarFalhas` (WhatsApp) recusa `n` que não é inteiro ≥ 1 ou tipo desconhecido. Nos dois casos, a recusa é um `RangeError` sem gravar nada.
- `adiarProximaCobranca` com data inválida (`NaN` ou não `Date`) → `OperacaoInvalidaNoProvedor`, antes de consumir o erro forçado. Uma data igual a `agora` é recusada (a regra é estrita: `novaData > agora`).
- O evento `cancelar` sem `em` e `cancelarAssinatura` (porta) gravam `cancelada_em = agora()` do adaptador.
- Uma chamada inválida do WhatsApp em runtime, com campos ausentes, grava `''` e `{}` em vez de falhar no `INSERT`, para que a tentativa fique registrada (RN-19).
- `urlCheckout` remove barras finais de `appUrl`.
- Erros do MP com mensagens fixas mais específicas (estado inválido, data não futura, erro forçado). Nenhuma ecoa valores.
- Os testes unitários de `simulado.ts` com repositório falso não foram escritos: os simulados são cobertos integralmente pela integração com banco real, e um repositório falso seria um mock do banco.

### Pendências para a T-6
- O checkout simulado deve ler a `urlRetorno` **gravada** com `repoSimMercadoPago().buscarAssinatura(id)`. `src/server/integrations/**` pode importar `src/server/repos/sim-mercadopago`, mas não `repos/db`. A autorização deve passar por `criarMercadoPagoSimulado({ appUrl }).autorizar(id)`, que lança `OperacaoInvalidaNoProvedor` fora de `pendente`. O checkout deve tratar isso como "sem efeito, só redireciona".
- `criarMercadoPagoSimulado` exige `appUrl`. O registro deve repassar `APP_URL` de `validarEnv`.
- `criarEmailSimulado()` e `criarWhatsAppSimulado()` dispensam argumentos no registro: `repo` só existe para os testes.
- A cobertura e o laço oficial de 10 execuções do CA-21 ficam com a T-7, e o laço independente fica com o tester.

## T-6 — Registro e checkout simulado

Autor: desenvolvedor. Entradas: `design.md` (§3.11, §3.12, T-6, R-6, R-7, §8), `spec.md` (RN-14, RN-20, CA-1, CA-3, CA-9, CA-10, CA-14, CA-19) e as pendências de T-2 a T-5 acima.

### Tarefa concluída e arquivos (todos novos)
- `src/server/integrations/registry.ts` (§3.11):
  - `criarIntegracoes(fonte)` chama `validarEnv` (um único `ErroDeAmbiente` com todos os nomes) e monta as quatro portas, mais os `modos`.
  - `integracoes()` faz o mesmo sobre `process.env` no **primeiro uso** e memoiza num `let` do módulo. Um erro não é memoizado: corrigido o ambiente, a chamada seguinte constrói. `redefinirIntegracoes()` existe para os testes.
  - Seleções puras:
    - `selecionarEmail` liga o real à `ConfigSmtp` exata, sem `exigirTls`; o simulado é chamado sem argumentos.
    - `selecionarTurnstile(c, lerAmbiente = () => process.env)`: o real lê `TURNSTILE_SITE_KEY` a cada `chaveDoSite()`. Vazia ou ausente vira `ErroDeAmbiente(['TURNSTILE_SITE_KEY'])`.
    - `selecionarMercadoPago(modo, { appUrl })` e `selecionarWhatsApp(modo)`: `real` liga os stubs `NaoImplementado`.
  - O import só declara: nada lê o ambiente nem constrói adaptador.
- `src/server/integrations/mercadopago/checkout-simulado.ts` (§3.12):
  - `carregarCheckoutSimulado(id, fonte = process.env)`;
  - `decidirCheckoutSimulado(form, fonte = process.env)`;
  - `DECISOES_CHECKOUT`.
  - A checagem `modoSelecionado(fonte, 'MP_ADAPTER') === 'simulado'` vem antes de qualquer acesso ao banco. A `urlRetorno` é lida da linha gravada (`repoSimMercadoPago().buscarAssinatura`). A autorização passa por `criarMercadoPagoSimulado(...).autorizar(id)`, e `OperacaoInvalidaNoProvedor` vira "sem efeito, só redireciona".
- `src/app/dev/mp-checkout/page.tsx`:
  - `dynamic = 'force-dynamic'` e `robots: { index: false, follow: false }`;
  - `notFound()` quando `carregar` devolve `null`;
  - mostra "R$ 79,00" (`Intl` pt-BR/BRL a partir do valor gravado), "30 dias grátis" (de `DIAS_TESTE`) e o aviso de que nenhum dado de cartão é pedido;
  - formulário nativo `POST` com `assinatura` oculto e botões `submit name="decisao"`. O primeiro botão tem `autoFocus`, e o contorno de foco do navegador é preservado (nenhum `outline`).
- `src/app/dev/mp-checkout/decisao/route.ts`: `POST` lê `req.formData()` e chama `decidirCheckoutSimulado`. Responde 303 com `Location` ou 404 com corpo vazio, sempre com `Cache-Control: no-store`.
- `next.config.ts`: **não mudou** (o R-6 não exigiu; ver abaixo).

### Prova descartável do R-6 (`nodemailer` no bundle do Turbopack)
1. Criei a rota temporária `src/app/prova-r6/route.ts` (`force-dynamic`), que importava `integracoes` do registro e `createTransport` de `nodemailer`. Rodei `npm run build` sem `DATABASE_URL`: código 0, **sem aviso nem erro**, e `/prova-r6` saiu como `ƒ`. O Turbopack empacotou o `nodemailer` num chunk de `.next/server/chunks/`.
2. Em seguida, a rota passou a enviar um e-mail por `integracoes().email.enviar(...)`. Novo build (0, sem aviso), depois `next start` com o `.env.example` exportado mais `EMAIL_ADAPTER=real`, `SMTP_HOST=127.0.0.1`, `SMTP_PORT=<porta do stub>` e `EMAIL_FROM`. O stub SMTP de `tests/support/stubs/smtp.ts` rodou num processo à parte.
   - `GET /prova-r6` → 200, com `{"modos":{"email":"real",…},"r":{"provedorId":"<…@exemplo.com.br>"}}`.
   - O stub recebeu `MAIL FROM nao-responda@exemplo.com.br`, `RCPT TO cliente@exemplo.com.br` e `Subject: Prova R-6`.
   - Com o modo simulado, a mesma rota (versão 1) devolveu 200 com os quatro modos `simulado`.
3. A rota de prova foi apagada (`src/app/prova-r6` não existe). O build seguinte regenerou `.next/types` sem ela.
- **Resultado:** o bundle do `nodemailer` funciona no runtime do Next 16.4.6/Turbopack. `serverExternalPackages` **não** é necessário, e `next.config.ts` ficou intacto.

### Testes criados e CA coberto
- `src/server/integrations/registry.test.ts` (unitário, 16 casos). As oito fábricas são espionadas com `vi.mock` + `importOriginal`: o original roda, e o espião só prova qual instância o registro devolveu e com quais argumentos. Não há mock de banco, e nenhum caso grava.
  - CA-1: `criarIntegracoes(.env.example lido por parseEnv)` devolve modos `simulado` e cada porta é a instância da fábrica simulada (`toBe`). O MP recebe `{ appUrl: 'http://localhost:3000' }`, e e-mail e WhatsApp são chamados sem argumentos. Nenhuma fábrica real é chamada. O mesmo vale para `integracoes()` sobre o `process.env` do exemplo.
  - CA-9:
    - `selecionarMercadoPago('real')` é a instância de `mercadopago/real.ts`. Os 6 métodos (contados contra `Object.keys`) rejeitam com `NaoImplementado` citando E6.6.
    - `selecionarWhatsApp('real')` rejeita com E7.2.
    - A seleção `simulado` dá os simulados.
    - D-1: o registro recusa `MP_ADAPTER=real` e `WHATSAPP_ADAPTER=real` nomeando os dois seletores, sem construir nada.
  - CA-10:
    - Com **todas** as variáveis do processo removidas (`vi.stubEnv(k, undefined)`), `vi.resetModules` e import dinâmico do registro e dos 13 módulos de portas e adaptadores (inclusive `checkout-simulado`), nada lança. O primeiro `integracoes()` lança `ErroDeAmbiente(['DATABASE_URL'])`.
    - Com `EMAIL_ADAPTER=real` sem `SMTP_HOST`, `integracoes().email` lança `ErroDeAmbiente(['SMTP_HOST'])`, sem valores na mensagem. Corrigido o ambiente, a chamada seguinte constrói o real.
    - Memoização e `redefinirIntegracoes`.
  - CA-14:
    - `integracoes()` com `TURNSTILE_ADAPTER=real` devolve o `TURNSTILE_SITE_KEY` vigente a cada `chaveDoSite()`, com a mesma instância memoizada.
    - O real recebe o segredo validado e não recebe URL nem `fetch` de teste.
    - Uma chave esvaziada ou removida depois da inicialização vira `ErroDeAmbiente(['TURNSTILE_SITE_KEY'])`, sem o segredo na mensagem.
    - O padrão de `selecionarTurnstile` lê `process.env`, e o simulado devolve a chave documentada.
  - `selecionarEmail`: o real recebe exatamente a `ConfigSmtp`, sem a propriedade `exigirTls`. `criarIntegracoes` com `EMAIL_ADAPTER=real` monta a `ConfigSmtp` do ambiente (porta 587 e autenticação em par).
- `tests/integration/integracoes/registro.test.ts` (integração, 5 casos). A fonte é explícita (R-9).
  - CA-3: o e-mail pela porta do registro grava em `email_log`, e o link é extraído do corpo igual ao enviado.
  - CA-1 pelo efeito no banco:
    - o MP do registro grava `sim_mp_assinatura` pendente com `valor_centavos = PRECO_MENSAL_CENTAVOS` e `urlCheckout = ${APP_URL}/dev/mp-checkout?assinatura=<id>`;
    - o WhatsApp do registro grava `sim_whatsapp_chamada` com `sucesso` e o mesmo `provedor_mensagem_id`;
    - o Turnstile do registro aceita o token documentado e recusa outro.
- `tests/integration/integracoes/checkout.test.ts` (integração, 17 casos, CA-19):
  - Página (`renderToStaticMarkup`; atributos comparados como mapa, porque o React 19 reordena):
    - uma assinatura pendente mostra `R$ 79,00` (com U+00A0, como o `Intl` produz), `30 dias grátis` e o aviso sem cartão;
    - há um único `form` `post` para `/dev/mp-checkout/decisao` e um único `input` (o oculto);
    - os botões são `autorizar` e `desistir`, com `autofocus` só no primeiro, e não há `outline`.
  - Uma assinatura autorizada ou cancelada mostra o estado e só oferece "Voltar ao Agenda Beleza".
  - Um ID inexistente, que não é UUID, ausente ou repetido (array) leva a `notFound()` com o digest `NEXT_HTTP_ERROR_FALLBACK;404`. Com `MP_ADAPTER=real`, a página também chama `notFound()` para um ID existente.
  - `dynamic === 'force-dynamic'` na página e no handler, `robots` com `noindex`.
  - `carregarCheckoutSimulado`: os dados gravados. Com `real` ou um seletor inválido, devolve `null` **com `DATABASE_URL` apontando para `127.0.0.1:1`**. O controle, no modo simulado, falha com essa URL, o que prova que o `null` veio sem consulta. O modo simulado é o padrão (ausente ou vazio).
  - `POST` (corpo `x-www-form-urlencoded`, como o navegador):
    - autorizar com `urlRetorno` e `redirect` forjados → 303, `Location` = `urlRetorno` gravada + `preapproval_id`, `no-store`, corpo vazio, estado `autorizada` e próxima cobrança = autorização + 30 dias;
    - desistir → 303, e a assinatura continua pendente, com as datas nulas;
    - duplo clique ou assinatura cancelada → 303 sem efeito;
    - a query da `urlRetorno` gravada é preservada e o `preapproval_id` não é duplicado;
    - um ID inexistente, inválido ou vazio → 404 sem `Location`;
    - uma decisão ausente ou desconhecida, ou um pedido sem assinatura → 404 sem efeito;
    - um corpo JSON → 404;
    - com `MP_ADAPTER=real` → 404, a assinatura existente continua pendente e, com o banco inalcançável, a resposta segue 404. O controle, no modo simulado, lança.

### Mutações de controle (feitas e revertidas; `cmp` confirma os arquivos restaurados)
| Mutação | Resultado |
|---|---|
| Checkout: `=== 'simulado'` → `!== null` (a checagem do modo real some) | 3 falhas (página real, `carregar` real e `POST` real) |
| Checkout: redirecionar para a `urlRetorno` do formulário | 2 falhas (autorizar e desistir) |
| Registro: validar no import (`let memo = criarIntegracoes(process.env)`) | Sem `.env`, o arquivo inteiro falha no import (`ErroDeAmbiente: DATABASE_URL`). Com o `.env.example` exportado, falha o caso de import do CA-10 |
| Registro: ler `TURNSTILE_SITE_KEY` na construção | 3 falhas do CA-14 |
| Registro: repassar `exigirTls: false` ao e-mail real | 2 falhas de `selecionarEmail` |

### Comandos executados e resultados
O ambiente foi exportado do `.env.example`, só onde foi preciso: na integração, na cobertura e na prova do R-6. Não existe `.env`. O PostgreSQL do compose estava no ar.
| Comando | Resultado |
|---|---|
| `npm run typecheck` | 0 |
| `npm run lint` | 0 (inclui os arquivos reais de `src/app/dev/**`: a exceção do MP simulado e do checkout simulado está confirmada com arquivos de verdade, o que fecha a pendência da T-3) |
| `env -i PATH HOME npm run build` (sem `.env` e sem variáveis) | 0. `ƒ /dev/mp-checkout`, `ƒ /dev/mp-checkout/decisao`, `ƒ /api/health`; `○ /` e `○ /_not-found`. Sem aviso |
| `env -i … EMAIL_ADAPTER=real TURNSTILE_ADAPTER=real MP_ADAPTER=real npm run build` (sem SMTP nem chaves) | 0, com as mesmas rotas dinâmicas |
| `env -i PATH HOME npm run build:node` | 0. `grep -E "^import" dist/scripts/check-env.js` mostra só `zod` |
| `env -i PATH HOME npm run test:unit` | 40 arquivos, 372 testes, 0 falhas |
| `npm run test:integration` | 32 arquivos, 630 testes, 0 falhas |
| `npm run test:coverage` (medição informativa; a oficial fica com a T-7) | 0. Linhas: 100% no total. `registry.ts`, `page.tsx` e `route.ts`: 100% de linhas e ramos. `checkout-simulado.ts`: 100% de linhas e 90,9% de ramos |
| `grep -rn "integrations/.*/\(real\|simulado\)" src --include=*.ts --include=*.tsx`, fora de `src/server/integrations/**`, `src/app/dev/**` e dos testes | vazio |
| `grep -rn NEXT_PUBLIC_ src` | vazio |
| `grep -rn eslint-disable src tests` | só em `src/generated/prisma/**` (código gerado) |

### Desvios e decisões
- **Chave do site do Turnstile em `criarIntegracoes(fonte)`:** é lida de `fonte` na chamada (`() => fonte`), não de `process.env` fixo. Em `integracoes()`, `fonte` **é** o `process.env`, então o comportamento de produção é o da pendência da T-4 (leitura em runtime). Uma fonte explícita (testes) fica coerente com a validação. O padrão de `selecionarTurnstile`, sem o segundo argumento, continua sendo `process.env`.
- **Estado não pendente na página:** quando a assinatura já está autorizada ou cancelada, a página informa o estado (`role="status"`) e mostra só o botão "Voltar ao Agenda Beleza" (`decisao=desistir`, com `autoFocus`), sem "Autorizar". O handler continua aceitando `autorizar` sem efeito (duplo clique). O §3.12 só descrevia a página da assinatura pendente.
- **404 no handler também para decisão inválida, assinatura ausente e corpo que não é formulário.** O §3.12 tipa a decisão como `404 | 303`. Não foi introduzido 400, e nada é revelado.
- **`robots: { index: false, follow: false }`** (o §3.12 citava só `index: false`).
- **`appUrl` no checkout:** `criarMercadoPagoSimulado({ appUrl: fonte.APP_URL ?? '' })`. O `autorizar` não usa `appUrl`, que só compõe a `urlCheckout` de `criarAssinatura`. Assim o checkout não depende de `validarEnv`, que exigiria `DATABASE_URL` e o resto do ambiente só para redirecionar.
- **`Location`:** é montado com `new URL(urlRetorno gravada)` + `searchParams.set('preapproval_id', id)`. Preserva a query gravada e substitui um `preapproval_id` pré-existente.
- `export const dynamic = 'force-dynamic'` também no handler `POST` (já é dinâmico por natureza, mas o valor fica explícito e testado).

### Pendências e riscos
- **T-7 (README e `documentacao.test.ts`):**
  - documentar `/dev/mp-checkout?assinatura=<id>`, que só existe com `MP_ADAPTER=simulado`, é `noindex` e redireciona para a `urlRetorno` gravada com `preapproval_id`;
  - documentar o token e a chave do Turnstile simulado, o `psql` do `email_log`, os disparos do MP e a falha forçada do WhatsApp pelas funções de controle;
  - registrar o aviso de que o modo simulado não é para publicação (R-7);
  - registrar o resultado do R-6 (não foi preciso `serverExternalPackages`);
  - colher a cobertura oficial e o laço de 10 execuções do CA-21;
  - rodar o `npm run test:e2e` (não rodado aqui; a T-6 não criou E2E).
- **T-8 (DevOps):**
  - na saída do `next build` da imagem, `/dev/mp-checkout` e `/dev/mp-checkout/decisao` devem sair como `ƒ`;
  - o `nodemailer` vai empacotado no chunk do servidor pelo Turbopack (prova do R-6), e o `node_modules/nodemailer` continua na imagem pelo `npm prune --omit=dev`;
  - registrar o R-7/D-5: numa instalação publicada com `MP_ADAPTER=simulado`, qualquer pessoa com o ID pode autorizar uma assinatura simulada. O handler não tem proteção CSRF própria (um formulário de outra origem consegue postar), o que é aceitável só porque a rota existe apenas no modo simulado.
- **Verificação manual do tester (CA-19):** o fluxo no navegador só pelo teclado (Tab, Enter, foco visível) não foi feito aqui. Para reproduzir, crie uma assinatura pelo MP simulado e abra a `urlCheckout`.

## T-7 — Documentação e gates

Autor: desenvolvedor. Entradas: `design.md` (§7 R-6/R-7, §8, T-7), `spec.md` (CA-4, CA-25, D-5, D-7, D-9), `dba.md` §2.7 e as pendências de T-2 a T-6 acima.

### Tarefa concluída e arquivos
- `README.md`:
  - tabela do compose: a app e o worker registram os modos dos adaptadores ao iniciar;
  - seção nova **"Integrações (adaptadores)"**, antes de "CI":
    - portas, registro e tabela "integração × seletor × simulado × real";
    - valores aceitos e padrão `simulado`;
    - validação na inicialização (nomes, nunca valores; MP e WhatsApp reais recusados);
    - linha `check-env: ambiente válido (adaptadores: …)` e evento `worker.adaptadores`;
    - build sem `.env`, lint RN-16 e valores do plano em `src/config/plano.ts`;
  - subseção **"Adaptadores simulados"**:
    - aviso de que o modo simulado não é para publicação (D-5/R-7);
    - Turnstile: token `XXXX.DUMMY.TOKEN.XXXX` e chave `1x00000000000000000000AA` (D-7);
    - e-mail: o comando `psql` do `email_log` (D-9);
    - MP: `urlCheckout`, `/dev/mp-checkout?assinatura=<id>` (só com `MP_ADAPTER=simulado`, `noindex`, 303 para a `urlRetorno` gravada com `preapproval_id`, 404 no modo real e para ID inválido), os disparos e o erro forçado pelas funções de controle e o segredo público do webhook simulado;
    - WhatsApp: falha forçada, listagem de chamadas e "não deduplica";
    - limpeza manual das tabelas `sim_*`, só em base local ou de teste, com o comando do `dba.md` §2.7 em um `psql`;
  - seção **"Credenciais para os serviços reais"** reescrita, com uma subseção por serviço:
    - e-mail: as 6 variáveis, padrão 587/465 e `requireTLS` com autenticação;
    - Turnstile: as 2 chaves, sem `NEXT_PUBLIC_`;
    - MP: "Adaptador real: E6.6", recusado na inicialização;
    - WhatsApp: "Adaptador real: E7.2", com conta, número e 3 templates aprovados.
- `tests/integration/integracoes/documentacao.test.ts` (novo, 14 casos depois da rodada de ajustes do DevOps).
- `CLAUDE.md`, só nos trechos autorizados:
  - "Project status": frase da D-007 (a da D-006 já existia no arquivo);
  - linha "Ambiente" da tabela: os seletores vêm em `simulado`, e o modo `real` exige as variáveis do provedor.
  - Nenhum comando novo. As linhas de migrações e worker já estavam corretas.
- `docs/demandas/D-007/dev.md`: esta seção.

### Testes criados e CA coberto (`documentacao.test.ts`, integração com PostgreSQL real)
O teste lê o `README.md` e o `.env.example` e confronta com as constantes e o comportamento do código. Os comandos SQL são **extraídos do README** e executados na base do worker, sem cópia do SQL no teste.
- CA-25:
  - a seção de credenciais cita os 4 seletores e todas as `CHAVES` dos `ambiente.ts`, e cada uma existe no `.env.example` e em `chavesDeclaradas()`;
  - nenhuma variável `SMTP_|EMAIL_|TURNSTILE_|MP_|WHATSAPP_` citada no README deixou de existir;
  - o `.env.example` tem os seletores em `simulado` e as variáveis dos provedores vazias;
  - as portas padrão do README (`**587**`, `**465**`) são as de `lerConfigReal`, e o `requireTLS` documentado é o de `opcoesDoTransporte` com autenticação;
  - MP e WhatsApp citam "Adaptador real: E6.6/E7.2" (a partir de `NaoImplementado`) e "recusado na inicialização", e o `validarEnv` de fato recusa nomeando `MP_ADAPTER` e `WHATSAPP_ADAPTER`;
  - há uma subseção por serviço do CLAUDE.md, e o WhatsApp cita os 3 templates aprovados;
  - o valor "R$ 79,00" vem do `Intl` sobre `PRECO_MENSAL_CENTAVOS`, e `DIAS_TESTE = 30`.
- CA-4: o token e a chave do parágrafo do Turnstile são `TOKEN_TURNSTILE_SIMULADO` e `CHAVE_SITE_TURNSTILE_SIMULADA`. O token extraído é aceito pelo simulado, um token alterado é recusado e `chaveDoSite()` devolve a chave extraída.
- CA-25 (D-9, CA-3): o comando `psql` do `email_log` usa `POSTGRES_USER` e `POSTGRES_DB` do `.env.example`, e o SQL dele devolve o e-mail recém-enviado pelo simulado (destinatário, assunto e corpo com o link).
- CA-25 (RN-20): o modelo `${APP_URL}/dev/mp-checkout?assinatura=<id>` do README é igual à `urlCheckout` gerada pelo MP simulado. O parágrafo cita `MP_ADAPTER=simulado`, `noindex`, `preapproval_id=<id>`, a `urlRetorno` gravada e o `SEGREDO_WEBHOOK_SIMULADO`.
- CA-25 (RN-4): os métodos chamados nos exemplos (`mp.autorizar`, `aprovarCobranca`, `falharCobranca`, `cancelar`, `forcarErro`, `wa.forcarFalhas`, `listarChamadas`, mais `listarAdiamentos`) existem nos simulados.
- CA-25 (D-5/R-7): o aviso "Não publique" está na seção dos simulados.
- CA-25 (`dba.md` §2.7):
  - as tabelas do `DELETE` documentado são **exatamente** as `sim_%` do catálogo (6);
  - com uma linha em cada uma (assinatura autorizada, pagamento, adiamento, erro forçado, chamada e falha forçada) e um e-mail, o SQL do README esvazia as 6 sem violar FK e não toca `email_log`.

### Mutações de controle no README (feitas e revertidas; `cmp` confirma o README restaurado)
| Mutação | Resultado |
|---|---|
| Tirar `sim_mp_erro_forcado` da limpeza | 1 falha (limpeza) |
| Trocar um caractere do token do Turnstile | 1 falha (CA-4) |
| Porta padrão `**587**` → `**25**` | 1 falha (portas) |
| `SMTP_SECURE=true` → `SMTP_TLS=true` (nome obsoleto) | 1 falha (variável inexistente) |
| Apagar as assinaturas antes dos pagamentos | 1 falha (FK RESTRICT no SQL executado) |
| Coluna `destinatario` → `para` no `psql` do `email_log` | 1 falha (SQL executado) |
| `mp.falharCobranca` → `mp.recusarCobranca` no exemplo | 1 falha (funções de controle) |

### R-6 (resultado da prova descartável da T-6)
O `nodemailer` é empacotado pelo Turbopack sem aviso nem erro e funciona no runtime do Next (envio real ao stub SMTP pela rota de prova, já apagada). `serverExternalPackages` **não** foi necessário, e o `next.config.ts` ficou intacto. Detalhes na seção T-6.

### Comandos executados e resultados (gates oficiais)
Ambiente: não existe `.env`. As variáveis do `.env.example` foram exportadas (`set -a; . ./.env.example`) na integração, na cobertura, no laço e no E2E. Os comandos marcados com `env -i` rodaram sem nenhuma variável além de `PATH` e `HOME`. PostgreSQL do compose no ar. `app` e `worker` do compose parados, com a porta 3000 livre no E2E.
| Comando | Resultado |
|---|---|
| `npm run typecheck` | 0 |
| `npm run lint` (`--max-warnings=0`) | 0 |
| `env -i PATH HOME npm run build` (sem `.env`) | 0, sem aviso. `ƒ /api/health`, `ƒ /dev/mp-checkout`, `ƒ /dev/mp-checkout/decisao`; `○ /`, `○ /_not-found` |
| `env -i PATH HOME EMAIL_ADAPTER=real npm run build` (sem SMTP) | 0, mesmas rotas, sem aviso (CA-6) |
| `env -i PATH HOME npm run build:node` | 0. `grep -E "^import" dist/scripts/check-env.js` → só `zod` (2 linhas) |
| `env -i PATH HOME npm run test:unit` (sem banco) | 40 arquivos, 372 testes, 0 falhas |
| `npm run test:integration` | 33 arquivos, 643 testes, 0 falhas (+1 arquivo e +13 testes: `documentacao.test.ts`) |
| `npm run test:coverage` | 0. 73 arquivos, 1015 testes. **Linhas 100% (725/725)**; statements 99,26% (808/814); ramos 98,44% (508/516); funções 100% (202/202) |
| Laço do CA-21: `for i in $(seq 10); do npx vitest run --project integration tests/integration/integracoes/whatsapp-concorrencia.test.ts \|\| break; done` | 10 de 10 execuções verdes (3 testes cada) |
| `npm run test:e2e` | 0. `next build` + Playwright: 1 teste (`smoke.spec.ts`, mobile-chromium), 1 passou |
| `grep -rn eslint-disable src tests` (fora de `src/generated`) | 0 ocorrências |
| `git diff vitest.config.ts` | vazio (nenhuma exclusão de cobertura nova) |
| `grep -rn NEXT_PUBLIC_ src` | vazio (CA-14) |
| `grep -rnE "\b7900\b" src` (fora de testes) | só `src/config/plano.ts` (RN-21) |
| `grep -cE "secrets\.\|_ADAPTER" .github/workflows/ci.yml` | 0 (CA-25) |

### Tabela CA → evidência
| CA | Evidência automatizada | Evidência de processo ou manual |
|---|---|---|
| CA-1 | `registry.test.ts` (`.env.example` → 4 simulados), `registro.test.ts` (efeito no banco), `check-env.test.ts` e `stub.test.ts` (linha de modos e evento `worker.adaptadores`) | T-8: `docker compose up -d --wait` com os logs de modos |
| CA-2 | `check-env.test.ts`, `src/scripts/check-env.test.ts` (bundle `dist/`) e `stub.test.ts`: `EMAIL_ADAPTER=real` sem `SMTP_HOST` → código ≠ 0 com `SMTP_HOST` | T-8: `docker compose run` de app e worker |
| CA-3 | `email-simulado.test.ts`, `registro.test.ts` e `documentacao.test.ts` (o `psql` do README lê o e-mail) | — |
| CA-4 | `turnstile/simulado.test.ts` e `documentacao.test.ts` (token e chave do README) | — |
| CA-5 | `turnstile/real.test.ts` (stub HTTP com `success:false` → inválido) | — |
| CA-6 | Mutação da T-6: validar no import do registro quebra o CA-10 | T-7: `env -i npm run build` 0, com e sem `EMAIL_ADAPTER=real`; T-8: build sem `.env` e `docker build --target final` |
| CA-7 | `plano.test.ts` | `grep 7900` só em `plano.ts` |
| CA-8 | `check-env.test.ts` e `email/ambiente.test.ts`, `turnstile/ambiente.test.ts` (combinações, sem valores na saída) | — |
| CA-9 | `check-env.test.ts` (recusa nomeando o seletor), `mercadopago/real.test.ts`, `whatsapp/real.test.ts` e `registry.test.ts` (seleção `real` → `NaoImplementado` E6.6/E7.2) | — |
| CA-10 | `registry.test.ts` (import sem ambiente; `SMTP_HOST` no 1º uso) | — |
| CA-11 | `email/real.test.ts` (stub SMTP: envelope, assunto e corpo; recusa de autenticação e de destinatário; tempo-limite) | — |
| CA-12 | `email/real.test.ts` e `turnstile/real.test.ts` (console capturado e erro serializado sem senha, base64, segredo nem token) | — |
| CA-13 | `turnstile/real.test.ts` (status 500, não JSON, tempo-limite, rede → `indisponivel`) | — |
| CA-14 | `turnstile/real.test.ts`, `turnstile/simulado.test.ts` e `registry.test.ts` (chave lida a cada chamada) | `grep NEXT_PUBLIC_ src` vazio |
| CA-15 | `mp-simulado.test.ts` (inclusive a leitura por um segundo cliente de banco) e `drift.test.ts` | — |
| CA-16 | `webhook-simulado.test.ts` e `mp-simulado.test.ts` | — |
| CA-17 | `mp-simulado.test.ts` (adiamento) | — |
| CA-18 | `mp-simulado.test.ts` (erro forçado em `cancelarAssinatura`) | — |
| CA-19 | `checkout.test.ts` (17 casos: página, 303 para a `urlRetorno` gravada, 404 no modo real sem banco) e `documentacao.test.ts` (README × `urlCheckout`) | T-9: navegador só pelo teclado (pendente) |
| CA-20 | `whatsapp-simulado.test.ts` | — |
| CA-21 | `whatsapp-concorrencia.test.ts` (N = 12) | Laço de 10 execuções: 10/10 verdes (T-7); laço independente com o T-9 |
| CA-22 | `importacao-integracoes.test.ts` (214 casos) e `importacao-prisma.test.ts` inalterado | `npm run lint` 0; T-9: arquivo violador manual |
| CA-23 | `email/port.test.ts`, `email/real.test.ts` (o stub não recebe `MAIL FROM`) e `email-simulado.test.ts` (sem linha nova) | — |
| CA-24 | `drift.test.ts`, bloco `CA-24 (D-007)` (colunas exatas, sem cartão, segredo ou token) | — |
| CA-25 | `env.test.ts` (paridade com o `.env.example` e RN-8) e `documentacao.test.ts` (13 casos) | Gates acima (lint, typecheck, build, unit, integração, cobertura de 100% das linhas, E2E); CI sem `secrets.` nem `*_ADAPTER` (T-8 confirma o run verde) |

### Desvios e decisões
- **`CLAUDE.md`:** o "Project status" já citava a D-006. Só foi acrescentada a frase da D-007. Na tabela, só a observação da linha "Ambiente" mudou. Nenhum comando novo.
- **README, exemplos de código:** os disparos do MP e a falha forçada do WhatsApp aparecem como trechos TypeScript com `criarMercadoPagoSimulado`/`criarWhatsAppSimulado`, porque não há tela nem script para eles (spec, "Fica fora"). Esses imports são permitidos só em testes e em `src/app/dev/**` (lint RN-16). O teste garante que os nomes dos métodos existem.
- **README, limpeza:** o SQL do `dba.md` §2.7 foi mantido como uma única linha de `psql -c`, na ordem do DBA (pagamentos e adiamentos antes das assinaturas). O teste executa esse SQL.
- **Seção de credenciais do MP e do WhatsApp:** cita as credenciais que serão necessárias (conta, access token, segredo do webhook; conta, número, token e 3 templates), mas não inventa nomes de variáveis: eles são da E6.6 e da E7.2.

### Pendências e riscos
- **T-8 (DevOps, em paralelo):** as evidências de processo do CA-1, do CA-2 e do CA-6 (Docker) e o run verde da CI no PR. Ajustes que o DevOps pedir no README ou no `.env.example` voltam para o desenvolvedor.
- **T-9 (tester):** CA-19 no navegador, só pelo teclado; laço independente do CA-21; CA-22 manual.
- A pasta `.vitest/`, que não estava rastreada, já foi removida pelo líder.
- O README documenta o comando `psql` com `-U agenda -d agenda_beleza`, os valores do `.env.example`. Com outros valores, a pessoa precisa trocá-los (está escrito no README).

### Ajustes pedidos pelo DevOps (T-8, `devops.md`)
- **A-1:** no item "Validação na inicialização", o README agora diz que, com o `.env.example` sem alterações, `EMAIL_ADAPTER=real` produz a saída real `check-env: Variáveis de ambiente ausentes ou inválidas: EMAIL_FROM, SMTP_HOST`, porque `EMAIL_FROM` também está vazio.
- **A-2:** o aviso do modo simulado agora diz que o `POST /dev/mp-checkout/decisao` não verifica a origem (não tem proteção CSRF) e, na mesma frase, que nunca se deve publicar com nenhum seletor em `simulado`.
- `documentacao.test.ts` passou de 13 para 14 casos: um caso novo (A-1) e asserções novas no caso D-5/R-7 que já existia (A-2):
  - CA-25 (CA-2, A-1): `validarEnv({ ...exemplo, EMAIL_ADAPTER: 'real' })` lança `ErroDeAmbiente` com `['EMAIL_FROM', 'SMTP_HOST']`, e o README contém exatamente `check-env: <message>` desse erro;
  - CA-25 (D-5/R-7, A-2): a linha do aviso cita o `POST`, "proteção CSRF" e "nunca publique com nenhum seletor em `simulado`".
- Mutações (revertidas; `cmp` confirma o README restaurado): tirar `EMAIL_FROM` da saída documentada → 1 falha; tirar "(não tem proteção CSRF)" → 1 falha.
- Comandos, com o `.env.example` exportado:
  - `npx vitest run --project integration tests/integration/integracoes/documentacao.test.ts`: 14/14;
  - `npm run lint`: 0;
  - `npm run typecheck`: 0.
