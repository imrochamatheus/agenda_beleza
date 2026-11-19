# D-007: portas e adaptadores de integração, com simulados e reais de e-mail e Turnstile (issue #8, E0.6)

Autor: analista-requisitos. Fontes, da maior para a menor precedência:
1. `docs/demandas/D-007/issue-8.md`: RN-1..RN-8 e CA-1..CA-7 já decididos.
2. `PLAN.md`: "Direção técnica" (`PLAN.md:123`), "Assinatura" (`:61-65`), "Mensagens pelo WhatsApp" (`:76-84`), "Página pública" (`:49`) e critérios de aceite 5, 6, 8 e 10 (`:139-144`).
3. `CLAUDE.md`: invariantes "Integrations sit behind adapters", "Subscriptions" e "WhatsApp messages".
4. `docs/demandas/D-001/{spec,design,dev,devops}.md`, item E0.6 e itens consumidores (E1.1, E1.3, E1.4, E4.2, E6.1–E6.6, E7.1, E7.2, E8.2).
5. D-004 (esquema), D-005 (repositórios, lint e harness) e D-006 (CI).
6. Código da branch `feat/d-007-adaptadores`, com base em `a042410` (main).

Esta especificação não reabre nenhuma decisão da issue. As adições são de três tipos: (a) CAs que tornam verificáveis as RNs e os entregáveis da issue que não têm CA próprio; (b) a fronteira com E0.7, E1.x, E4.2, E6.x e E7.x; (c) decisões não bloqueantes, marcadas como D-n no §9. Cada adição indica a origem.

## 1. Problema

Hoje não existe camada de integração. Evidências:

- `ls src/server/integrations src/config src/app/dev` → "Arquivo ou diretório inexistente" nos três.
- Os seletores existem, mas não selecionam nada: `src/server/env.ts:3` diz "`real` ainda não tem efeito na E0.2", e `src/server/env.ts:13-16` declara `EMAIL_ADAPTER`, `WHATSAPP_ADAPTER`, `MP_ADAPTER` e `TURNSTILE_ADAPTER` como `simulado|real` com padrão `simulado`. O esquema não tem `SMTP_*`, `EMAIL_FROM` nem `TURNSTILE_*`. Ele também não tem nenhuma regra condicional ao modo `real` (`src/server/env.ts:10-17`).
- O `check-env` já roda na inicialização: `docker/entrypoint.sh:7` executa `node /app/dist/scripts/check-env.js` antes de `app` e de `worker`, e `src/worker/stub.ts:17-24` chama `validarEnv` e sai com código 1, registrando os nomes em `variaveis`. A mensagem só nomeia variáveis (`src/server/env.ts:39-41`, `src/server/check-env.ts:11-18`). Falta a regra "modo real exige credencial".
- `nodemailer` não está instalado: `grep -c '"node_modules/nodemailer"' package-lock.json` → `0`. `package.json` também não tem cliente SMTP nem servidor de stub SMTP.
- `email_log` já existe (D-004): `prisma/schema.prisma:579-588` (destinatário, assunto, corpo, `criado_em`, sem `salao_id`; D-004/dba.md:26 o classifica como "dados da plataforma"). Não existe nenhuma tabela de estado do MP simulado nem de chamadas do WhatsApp simulado. Há três migrações (`prisma/migrations/2026111800{0000,0100,0200}_*`).
- O lint só restringe o Prisma (`eslint.config.mjs:8-50`, regra RN-10 da D-005). Nada impede importar um SDK de provedor ou o adaptador simulado a partir da lógica de negócio.
- O preço e os dias de teste não têm fonte única no código. Eles só aparecem em texto (`PLAN.md:61`, R$ 79 e 30 dias).
- `grep -rn NEXT_PUBLIC_ src` → nenhum resultado. A regra RN-3 ainda não foi violada.
- O README só cita as credenciais de forma genérica (`README.md:117-126`: "Elas só serão exigidas quando cada adaptador `real` for implementado").
- A CI não define `*_ADAPTER` nem usa `secrets.` (`.github/workflows/ci.yml:5`; D-006 RN-3).

Consequência: a invariante "Integrations sit behind adapters" do `CLAUDE.md` não tem implementação. Ficam bloqueados E1.1, E1.3, E1.4 (e-mail), E4.2 (Turnstile), E6.x (MP) e E7.x (WhatsApp), além dos critérios de aceite 5, 6, 8 e 10 do PLAN, que dependem de adaptadores locais.

## 2. Objetivo

A lógica de negócio passa a depender só de quatro portas (e-mail, WhatsApp, Mercado Pago e Turnstile), obtidas de um registro que escolhe o adaptador pelo ambiente. O projeto roda e é testado de ponta a ponta sem nenhuma credencial:
- o e-mail simulado grava em `email_log`;
- o MP simulado guarda estado persistente, compartilhado entre app, worker, Vitest e Playwright, com checkout simulado e disparo de eventos;
- o WhatsApp simulado registra as chamadas e aceita falha forçada;
- o Turnstile simulado aceita um token fixo documentado.

Para ligar o e-mail e o Turnstile reais, basta configurar as variáveis. Um modo real sem a credencial obrigatória impede a inicialização, com mensagem que nomeia a variável. O preço do plano e os dias de teste ficam numa fonte única.

## 3. Escopo

### Entra
1. **Portas** (`src/server/integrations/{email,whatsapp,mercadopago,turnstile}/port.ts`): interfaces, tipos de entrada e saída e erros de domínio de cada porta. A superfície mínima está no §4 (RN-9..RN-12). A porta do MP declara toda a superfície da issue: `criarAssinatura`, `consultarAssinatura`, `consultarPagamento`, `cancelarAssinatura`, `adiarProximaCobranca` e `validarWebhook`.
2. **Adaptadores simulados dos quatro**:
   - e-mail: grava em `email_log`;
   - MP: estado em tabelas próprias, disparo de eventos, registro de adiamentos e erro forçável por operação;
   - WhatsApp: registro de chamadas em tabela e falha forçável;
   - Turnstile: token fixo documentado.
3. **Adaptadores reais**: e-mail por SMTP (`nodemailer`, versão exata) e Turnstile (`siteverify` via `fetch`). O endereço do servidor (host/porta SMTP e URL do `siteverify`) é injetável pelo construtor (RN-6).
4. **Stubs reais** `src/server/integrations/mercadopago/real.ts` e `src/server/integrations/whatsapp/real.ts`. Eles implementam a porta, e todo método falha com o erro `NaoImplementado`. Ficam ligados ao `registry.ts`, e E6.6 e E7.2 os substituem sem editar o registro.
5. **`src/server/integrations/registry.ts`**: seleção por `EMAIL_ADAPTER`, `WHATSAPP_ADAPTER`, `MP_ADAPTER` e `TURNSTILE_ADAPTER`. A construção é preguiçosa: o import não lê nem valida o ambiente.
6. **Validação de ambiente** (`src/server/env.ts` e `src/server/check-env.ts`): variáveis novas da RN-8 e exigências condicionais ao modo `real` (RN-13). Ela continua rodando só no entrypoint e no início do worker.
7. **`src/config/plano.ts`**: `7900` centavos por mês e `30` dias de teste, sem dependências (importável por componentes cliente, E9.1).
8. **Migração** (Prisma e SQL) com as tabelas de estado do MP simulado e de chamadas e falhas forçadas do WhatsApp simulado. O acesso a elas, e a `email_log`, passa por `src/server/repos/**` (RN-10 da D-005).
9. **Rota `/dev/mp-checkout`**: checkout simulado do MP. Fica ativa só com `MP_ADAPTER=simulado` e responde 404 no modo real.
10. **Regra de lint** para a RN-1 (ver RN-16) e teste da regra pela API do ESLint, no padrão de D-005 CA-5.
11. **`.env.example`** com as variáveis da RN-8, comentadas e com as credenciais vazias. O teste "chaves do `.env.example` × `env.ts`" (`src/server/env.test.ts:23-37`) continua passando.
12. **README**: seção "Credenciais para os serviços reais" (`README.md:117-126`) com as variáveis concretas de e-mail e Turnstile, o token simulado do Turnstile, o comando para ler `email_log` e os outros recursos dos simulados (checkout `/dev/mp-checkout`, falha forçada). MP e WhatsApp ficam marcados como "adaptador real: E6.6/E7.2".
13. **Testes**: unitários de cada adaptador, da seleção e da validação de ambiente; integração com PostgreSQL real para os simulados que persistem; servidores locais de stub (HTTP para o Turnstile, SMTP para o e-mail) para os reais.

### Fica fora
- Adaptador real do Mercado Pago (E6.6) e do WhatsApp (E7.2), conforme a issue, "Fora do escopo".
- Tudo de "Fora da primeira versão" do `PLAN.md:131` e "Out of scope for v1" do `CLAUDE.md`. Isso inclui pagamento da cliente, lembretes, mensagens promocionais e agendamento por WhatsApp. Nenhuma porta ganha operação para esses temas: a porta do WhatsApp só conhece os 3 modelos.
- Conteúdo e textos dos e-mails (confirmação, convite, recuperação) e dos modelos de WhatsApp: E1.1, E1.3, E1.4 e E7.2.
- Widget do Turnstile (real ou simulado) e o uso da validação no fluxo público: E4.2 (RN-6 de E4.2: o widget simulado entrega o token documentado e gera um token inválido).
- Fila, jobs e retry/backoff: E0.7 e E7.1. Aqui o adaptador só é chamado de forma síncrona por quem o usa.
- Endpoint de webhook do MP, persistência em `webhook_evento` e máquina de estados da assinatura: E6.2 e E6.3. O simulado **produz** a notificação, mas não a entrega a nenhum endpoint (D-3).
- Interface de desenvolvedor para disparar eventos do MP ou forçar falhas (botões, painel). Os disparos são funções do simulado, usadas pelos testes e pelo `/dev/mp-checkout` (autorizar). Uma interface extra pode ser criada por E6.x se for útil.
- Persistência de dados de cartão: proibida (`CLAUDE.md`). O checkout simulado não pede dados de cartão.

### Fronteira com outras demandas
| Tema | E0.6 (esta demanda) | Demanda futura |
|---|---|---|
| MP real | Stub `mercadopago/real.ts` (`NaoImplementado`) ligado ao registro; `MP_ADAPTER=real` recusado na inicialização (D-1) | **E6.6**: implementação real, variáveis `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` e `MP_PREAPPROVAL_PLAN_ID`, `APP_URL` https, HMAC do `x-signature`, `ProvedorNaoSuportaAdiamento`; troca a recusa pelas exigências próprias |
| Uso do MP | Porta completa e simulado com estado, checkout e eventos | **E6.1** (iniciar assinatura e retorno), **E6.2** (webhook e dedupe), **E6.3** (prazos), **E6.5** (cancelar), **E8.2** (adiar o teste) |
| WhatsApp real | Stub `whatsapp/real.ts` (`NaoImplementado`); `WHATSAPP_ADAPTER=real` recusado na inicialização (D-1) | **E7.2**: Cloud API, variáveis `WHATSAPP_*`, timeout, erro temporário × permanente |
| Fila e envio | Porta e simulado chamados de forma síncrona; registro de cada chamada | **E7.1**: outbox, `mensagem`/`mensagem_tentativa`, idempotência `reserva:tipo:revisao`, retry. **E0.7**: pg-boss e worker real |
| E-mail | Porta, simulado (`email_log`) e real SMTP | **E1.1/E1.3/E1.4**: conteúdo, links e momento do envio (depois do commit) |
| Turnstile | Porta (validação + chave do site em runtime), simulado e real | **E4.2**: widget, chamada antes de criar a reserva, mensagem de captcha inválido; **E4.4**: E2E |
| Preço | `src/config/plano.ts` | **E6.1/E6.6** (valor do plano), **E9.1** (landing page) |
| README | Variáveis concretas de e-mail e Turnstile | **E9.3**: documentação final e pendências de sandbox |
| CI | Sem mudança esperada (simulados por padrão) | — |

## 4. Regras de negócio

Da issue (decididas):
- **RN-1**: a lógica de negócio depende só das portas. Importar SDK ou HTTP de provedor fora dos adaptadores é proibido.
- **RN-2**: o e-mail simulado grava destinatário, assunto e corpo em `email_log`, consultável por testes e pela pessoa desenvolvedora (links de confirmação, convite e recuperação).
- **RN-3**: o Turnstile simulado aceita um token fixo documentado e rejeita os demais. O real valida no `siteverify` da Cloudflare. A chave pública é lida no servidor em runtime (`TURNSTILE_SITE_KEY`) e passada ao widget por props, sem variável `NEXT_PUBLIC_*`.
- **RN-4**: o MP simulado permite disparar eventos (autorização, cobrança aprovada, falha, cancelamento) e registra adiamentos. O WhatsApp simulado permite forçar falha.
- **RN-5**: a validação do env roda na inicialização (`check-env` no entrypoint do app e no início do worker), nunca no import nem no `next build`. Um modo real sem credencial obrigatória faz o processo sair com código diferente de 0, nomeando a variável.
- **RN-6**: a URL base de cada adaptador real é injetável pelo construtor (os testes usam um servidor local de stub).
- **RN-7**: nenhum adaptador registra token ou senha em log.
- **RN-8**: variáveis no `.env.example`: os 4 seletores; `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM`; `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`. Credenciais reais vazias.

Complementares (derivadas da issue, do PLAN, do CLAUDE.md e de D-001):
- **RN-9 (porta de e-mail)** (RN-2; D-001 E1.1/E1.3/E1.4):
  - `enviar({ para, assunto, texto, html? })`;
  - `para` é um endereço único válido; `assunto` não pode conter CR nem LF; `texto` é obrigatório e é o que `email_log.corpo` guarda;
  - entrada inválida falha com erro de validação da porta antes de qualquer efeito;
  - falha do servidor SMTP vira um erro de envio da porta, sem detalhes de credencial.
- **RN-10 (porta do Turnstile)** (RN-3; D-001 E4.2):
  - `validar({ token, ip? })` devolve `{ valido: true }` ou `{ valido: false, motivo }`, com `motivo` ∈ `token_invalido` | `indisponivel`;
  - token vazio ou ausente → `token_invalido`, sem chamada de rede;
  - no real, `success:false` → `token_invalido`; erro de rede, timeout, HTTP não 2xx ou corpo não JSON → `indisponivel`;
  - a porta nunca lança por causa do provedor. A política diante de `indisponivel` (recusar, por padrão) é de E4.2;
  - `chaveDoSite()` devolve a chave pública lida na chamada (o real lê `TURNSTILE_SITE_KEY`; o simulado devolve uma chave fixa documentada).
- **RN-11 (porta do WhatsApp)** (`PLAN.md:76-84`; D-001 E7.1 e E7.2):
  - `enviarModelo({ destinatarioE164, modelo, parametros, chaveIdempotencia })`, com `modelo` ∈ `confirmacao` | `remarcacao` | `cancelamento`;
  - sucesso devolve `{ provedorMensagemId }`; falha lança `ErroEnvioTemporario` ou `ErroEnvioPermanente`;
  - destinatário fora do E.164 brasileiro → `ErroEnvioPermanente`.
- **RN-12 (porta do MP)** (issue "Escopo"; `PLAN.md:61-65`; D-001 E6.x e S12):
  - `criarAssinatura({ salaoId, emailPagador, urlRetorno })` → `{ assinaturaId, urlCheckout }`. A assinatura nasce pendente e vinculada ao salão por referência externa (`salaoId`), conforme "Vincular cada assinatura de forma inequívoca ao salão";
  - `consultarAssinatura(id)` → estado (`pendente` | `autorizada` | `cancelada`, na nomenclatura da porta, independente da do provedor), `salaoId`, valor em centavos, data de autorização e data da próxima cobrança;
  - `consultarPagamento(id)` → status (`aprovado` | `recusado`), valor em centavos, `assinaturaId` e data;
  - `cancelarAssinatura(id)`, idempotente para uma assinatura já cancelada;
  - `adiarProximaCobranca(id, novaData)`;
  - `validarWebhook({ cabecalhos, corpo, consulta })` → `{ valida: false }` ou `{ valida: true, tipo, recursoId }`;
  - identificador desconhecido → erro "não encontrado no provedor";
  - falha do provedor → erro da porta (`ErroProvedor`). Erros do provedor nunca vazam para a lógica de negócio (E6.6 RN-3).
- **RN-13 (exigências do modo real)** (RN-5, RN-8):
  - `EMAIL_ADAPTER=real` exige `SMTP_HOST` e `EMAIL_FROM` (endereço válido, aceito também na forma `Nome <email>`);
  - `SMTP_PORT` é opcional, inteiro de 1 a 65535, padrão 587;
  - `SMTP_SECURE` é opcional, `true` ou `false`, padrão `false`;
  - `SMTP_USER` e `SMTP_PASSWORD` vêm juntos ou nenhum dos dois (a falta de um nomeia o ausente);
  - `TURNSTILE_ADAPTER=real` exige `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY`;
  - `MP_ADAPTER=real` e `WHATSAPP_ADAPTER=real` são recusados nesta demanda, e a mensagem nomeia o seletor (D-1);
  - string vazia conta como ausente (regra vigente em `src/server/env.ts:47-56`);
  - no modo `simulado`, as variáveis do provedor são ignoradas: nem obrigatórias nem validadas;
  - a mensagem lista **todas** as variáveis inválidas, ordenadas, e nunca os valores.
- **RN-14 (seleção e registro)** (issue "Entregáveis"; RN-5):
  - o registro devolve uma instância por porta, conforme o seletor, e expõe o modo ativo de cada uma (`simulado` | `real`);
  - importar o registro não lê o ambiente. A construção acontece no primeiro uso, e um modo real sem credencial lança o mesmo erro de ambiente, que nomeia a variável (proteção para `npm run dev` e `npm run start`, que não passam pelo entrypoint);
  - o `check-env` e o worker registram, ao iniciar com sucesso, o modo ativo dos quatro adaptadores, sem nenhum valor de credencial (base de verificação do CA-1).
- **RN-15 (estado persistente dos simulados)** (D-001/dev.md:20, "app, worker, Vitest e Playwright são processos distintos"):
  - o estado do MP simulado (assinaturas, pagamentos, adiamentos, cancelamentos, erros forçados) e do WhatsApp simulado (chamadas e falhas forçadas) fica em tabelas próprias do PostgreSQL, criadas pela migração desta demanda;
  - o estado é lido e escrito só por `src/server/repos/**`;
  - um efeito gravado por um processo é visto por outro;
  - os simulados gravam fora da transação de quem os chama, como um provedor real.
- **RN-16 (regra de lint da RN-1)** (RN-1; D-005 RN-10 como precedente). Fora de `src/server/integrations/**` (e de `tests/**` e `*.test.ts(x)`), o lint proíbe:
  - (a) importar `nodemailer` e SDKs de provedor (`mercadopago`, SDKs do WhatsApp/Meta e da Cloudflare, se algum for adotado);
  - (b) importar diretamente os módulos de adaptador (`integrations/*/real` e `integrations/*/simulado`) em vez da porta ou do registro. A exceção é `src/app/dev/**`, que pode usar as funções específicas do MP simulado;
  - (c) literais de string com os hosts dos provedores (`challenges.cloudflare.com`, `api.mercadopago.com`, `graph.facebook.com`).

  O `fetch` global não é importável, e o item (c) é a defesa contra chamadas HTTP diretas. A revisão de código cobre o resto.
- **RN-17 (MP simulado: regras dos eventos)** (RN-4; `PLAN.md:61-65`; D-001 E6.1/E6.3/E6.5/E8.2):
  - **autorização**: `pendente` → `autorizada`; próxima cobrança = autorização + `DIAS_TESTE` (de `plano.ts`);
  - **cobrança aprovada**: cria um pagamento `aprovado` com o valor de `plano.ts` (7900) e avança a próxima cobrança em 1 mês;
  - **falha de cobrança**: cria um pagamento `recusado`; a assinatura continua `autorizada`, porque o MP tenta de novo;
  - **cancelamento** (evento ou `cancelarAssinatura`): estado `cancelada`;
  - evento inválido para o estado atual (cobrar uma pendente ou cancelada, autorizar uma cancelada) → erro, sem efeito;
  - cada disparo aceita um instante opcional (padrão: agora), para os testes de prazo com relógio controlado (E6.3);
  - cada disparo devolve a notificação de webhook que o MP enviaria (tipo + `data.id` + cabeçalhos de origem). Essa notificação é válida para o `validarWebhook` do simulado. A forma da notificação imita a do MP, para que E6.2 trate simulado e real do mesmo jeito.
- **RN-18 (MP simulado: adiamento e erro forçado)** (RN-4; S12; D-001 E6.5 CA-3):
  - `adiarProximaCobranca` grava um registro de adiamento (assinatura, data anterior, nova data, quando);
  - `consultarAssinatura` reflete a nova data;
  - nova data não posterior ao instante atual, ou assinatura não `autorizada` → erro, sem efeito;
  - o simulado permite forçar erro na próxima chamada de uma operação nomeada. A chamada seguinte volta ao normal, e a operação com erro forçado não altera o estado.
- **RN-19 (WhatsApp simulado)** (RN-4; D-001 E7.1 CA-2/CA-3/CA-4/CA-9; E8.3 CA-2):
  - toda chamada a `enviarModelo` é registrada (destinatário, modelo, parâmetros, chave de idempotência, resultado `sucesso`/`falha`, tipo do erro, instante), inclusive as que falham;
  - a falha forçada é configurada como "as próximas N chamadas falham com erro temporário ou permanente" (N ≥ 1);
  - o consumo de cada falha é atômico entre processos e conexões: N falhas forçadas produzem exatamente N chamadas com falha, mesmo com chamadas concorrentes;
  - o simulado **não** deduplica por chave de idempotência. Ele só registra, e a deduplicação é responsabilidade de E7.1 (o teste "uma única chamada" conta as linhas).
- **RN-20 (checkout simulado)** (D-001/dev.md:20; E6.1 CA-1..CA-3):
  - `urlCheckout` do simulado = `${APP_URL}/dev/mp-checkout?…` com o identificador da assinatura simulada;
  - a página mostra a assinatura pendente (valor em BRL, "30 dias grátis") e permite autorizar (efeito da RN-17) ou desistir;
  - nos dois casos, redireciona só para a `urlRetorno` gravada em `criarAssinatura`, nunca para uma URL vinda da requisição;
  - a página não pede dados de cartão, é pt-BR e operável só pelo teclado;
  - com `MP_ADAPTER=real`, ou com identificador inexistente, responde 404;
  - a rota é dinâmica: não é pré-renderizada no build e não lê o ambiente no build.
- **RN-21 (fonte única do plano)** (issue "Escopo"; D-001/design.md:88):
  - `src/config/plano.ts` exporta o preço mensal em centavos (`7900`) e os dias de teste (`30`);
  - nenhum outro arquivo de produção codifica esses números para o plano; o MP simulado e, no futuro, E6.1, E6.6 e E9.1 os importam;
  - o arquivo não importa nada de servidor (pode ser usado em componente cliente).
- **RN-22 (sem segredo em log nem em erro)** (RN-7; `src/server/env.ts:46-50`):
  - além de não registrar em log, mensagens de erro, `cause` e propriedades de erro lançadas pelos adaptadores não contêm `SMTP_PASSWORD`, `TURNSTILE_SECRET_KEY` nem o token Turnstile recebido, nem a codificação base64 do `AUTH` SMTP;
  - os modos de depuração/log do `nodemailer` ficam desligados.

## 5. Critérios de aceitação

Convenções:
- "stub HTTP" ou "stub SMTP" é um servidor local que escuta em `127.0.0.1` numa porta efêmera, aberto no próprio teste. Isso não é mock de banco.
- "check-env" é `executarCheckEnv` (unidade) ou `node dist/scripts/check-env.js` (processo).
- Os simulados que persistem são testados contra PostgreSQL real, pelo harness da D-005 (`tests/support/`).

### CAs da issue (CA-1..CA-7), com o modo de verificação
- **CA-1** (RN-14; D-001 E0.1 RN-1): Dado o `.env` padrão, quando o app inicia, então os quatro adaptadores ativos são os simulados.
  - Verificação, teste unitário: o registro construído a partir do `.env.example` sem alterações informa `simulado` nas quatro portas, e cada instância é a do simulado.
  - Verificação, processo: `docker compose up -d --wait` com `.env` copiado do exemplo. O log do `app` (linha do check-env) e o do `worker` mostram os quatro modos `simulado`, e nenhum valor de credencial.
- **CA-2** (RN-5, RN-13): Dado `EMAIL_ADAPTER=real` sem `SMTP_HOST`, quando o container `app` (ou o `worker`) inicia, então sai com código diferente de 0 e o log contém `SMTP_HOST`.
  - Verificação, teste unitário: `executarCheckEnv` devolve 1 e a saída de erro contém `SMTP_HOST`. O mesmo vale para `iniciarWorker`, que chama `sair(1)` com `SMTP_HOST` em `variaveis`.
  - Verificação, processo (tester): `docker compose run --rm -e EMAIL_ADAPTER=real -e SMTP_HOST= app` e o mesmo com `worker`. Ambos terminam com código ≠ 0 e a saída contém `SMTP_HOST`. O `app` não executa `migrate deploy`.
- **CA-3** (RN-2, RN-9): Dado o adaptador de e-mail simulado, quando o sistema envia um e-mail, então o teste lê em `email_log` destinatário, assunto e o link do corpo.
  - Verificação, integração: enviar pela **porta obtida do registro** um e-mail com um link `${APP_URL}/…?token=…`. A linha de `email_log` tem o destinatário, o assunto e um corpo do qual o link é extraído igual ao enviado.
- **CA-4** (RN-3): Dado o Turnstile simulado, quando se valida o token documentado, então retorna válido; com outro token, retorna inválido.
  - Verificação: o token documentado no README é a constante exportada pelo simulado (o teste confere os dois). Outro token e o token vazio → `{ valido: false, motivo: 'token_invalido' }`.
- **CA-5** (RN-3, RN-6, RN-10): Dado o adaptador real do Turnstile apontado para um servidor HTTP local de stub, quando o `siteverify` retorna `success:false`, então a porta retorna inválido.
  - Verificação: o resultado é `{ valido: false, motivo: 'token_invalido' }`. O stub recebeu um `POST` com `secret`, `response` e, quando informado, `remoteip`.
- **CA-6** (RN-5, RN-14, RN-20): Dado um ambiente sem `.env`, quando se executa o build, então ele termina com código 0 (a validação não roda no build).
  - Verificação: com `.env` renomeado e sem `*_ADAPTER`, `SMTP_*` e `TURNSTILE_*` no ambiente, `npm run build` e `npm run build:node` terminam com 0. O job `docker` da CI (`docker build --target final .`) continua verde. A saída do build lista `/dev/mp-checkout` como dinâmica.
  - Verificação, variante: o build também termina com 0 com `EMAIL_ADAPTER=real` sem `SMTP_HOST` no ambiente, o que prova que nada valida no import.
- **CA-7** (RN-21): Dado `src/config/plano.ts`, quando lido pelo teste, então expõe preço 7900 centavos e 30 dias de teste.

### CAs complementares (tornam verificáveis as RNs e os entregáveis da issue sem CA próprio)
- **CA-8** (RN-13; origem: RN-5 e RN-8): Dado o check-env, quando executado com cada combinação abaixo, então o código e as variáveis nomeadas são os esperados, e nenhum valor aparece na saída.
  - `TURNSTILE_ADAPTER=real` sem as duas chaves → 1, nomeia `TURNSTILE_SECRET_KEY` e `TURNSTILE_SITE_KEY`.
  - `EMAIL_ADAPTER=real` sem `SMTP_HOST` e sem `EMAIL_FROM` → 1, nomeia as duas.
  - `SMTP_PORT=abc` ou `70000` → nomeia `SMTP_PORT`.
  - `SMTP_SECURE=talvez` → nomeia `SMTP_SECURE`.
  - `SMTP_USER` sem `SMTP_PASSWORD` → nomeia `SMTP_PASSWORD`.
  - `EMAIL_FROM` inválido → nomeia `EMAIL_FROM`.
  - Todas as exigências satisfeitas → 0.
  - Os quatro seletores `simulado` com `SMTP_PORT=abc` e as chaves vazias → 0 (modo simulado ignora as variáveis do provedor).
- **CA-9** (D-1; origem: entregável "stubs `NaoImplementado` ligados ao registry.ts"): Dado `MP_ADAPTER=real` ou `WHATSAPP_ADAPTER=real`, quando o check-env roda, então devolve 1 nomeando o seletor. Dado o registro, quando se seleciona o modo `real` dessas portas pela função de seleção, então a instância é a de `mercadopago/real.ts` ou `whatsapp/real.ts`, e **todo** método da porta rejeita com `NaoImplementado`, cuja mensagem cita E6.6 ou E7.2.
- **CA-10** (RN-14; origem: RN-5): Dado um processo sem nenhuma variável de ambiente, quando se importa `registry.ts` (e os módulos das portas e adaptadores), então nada é lançado. Dado `EMAIL_ADAPTER=real` sem `SMTP_HOST`, quando se pede a porta de e-mail ao registro, então é lançado o erro de ambiente, nomeando `SMTP_HOST`.
- **CA-11** (RN-6, RN-9; origem: entregável "e-mail SMTP (nodemailer)"):
  - Dado o adaptador real de e-mail apontado para um stub SMTP local com autenticação, quando a porta envia, então o stub recebe `MAIL FROM` igual a `EMAIL_FROM`, `RCPT TO` igual ao destinatário, o cabeçalho `Subject` e o corpo de texto, autenticado com `SMTP_USER`/`SMTP_PASSWORD`.
  - Dado o stub recusando a autenticação ou o destinatário, quando a porta envia, então ela lança o erro de envio da porta.
  - Dado o stub inacessível (porta fechada), quando a porta envia, então ela lança o mesmo erro dentro de um tempo-limite definido.
- **CA-12** (RN-7, RN-22): Dado os cenários de falha do CA-11 e do CA-13, executados com o console capturado, quando terminam, então nem a saída capturada nem a serialização do erro lançado (`message`, `stack`, `cause` e propriedades) contém o valor de `SMTP_PASSWORD`, sua forma base64, o valor de `TURNSTILE_SECRET_KEY` ou o token Turnstile enviado.
- **CA-13** (RN-6, RN-10): Dado o Turnstile real apontado para o stub HTTP:
  - quando o stub responde `success:true`, então a porta retorna `{ valido: true }`;
  - quando responde 500, corpo não JSON, ou não responde dentro do tempo-limite, então retorna `{ valido: false, motivo: 'indisponivel' }`, sem lançar e dentro do tempo-limite configurado;
  - com token vazio, retorna `token_invalido` e o stub não recebe nenhuma requisição.
- **CA-14** (RN-3, RN-10): Dado `TURNSTILE_ADAPTER=real`, quando `chaveDoSite()` é chamada duas vezes, com `TURNSTILE_SITE_KEY` trocado entre as chamadas, então devolve o valor vigente em cada chamada (lido em runtime, não no build). No modo simulado, devolve a chave documentada. `grep -rn NEXT_PUBLIC_ src` continua sem resultados.
- **CA-15** (RN-12, RN-15, RN-17; origem: E6.1, E6.3 CA-5 e PLAN CA 5): Dado o MP simulado, contra PostgreSQL real:
  - quando se cria uma assinatura para o salão A, então `consultarAssinatura` devolve `pendente`, `salaoId` = A, valor 7900, e `urlCheckout` começa com `${APP_URL}/dev/mp-checkout`;
  - ao disparar a autorização no instante T, então fica `autorizada`, com próxima cobrança = T + 30 dias;
  - com a cobrança aprovada, então `consultarPagamento` devolve `aprovado`, 7900 e a assinatura certa;
  - com a falha, então surge um pagamento `recusado` e a assinatura continua `autorizada`;
  - com o cancelamento, então fica `cancelada`;
  - cobrar uma assinatura `pendente` ou `cancelada` → erro, sem novo pagamento;
  - o estado gravado é lido por uma instância nova do adaptador, criada sobre outro cliente de banco (prova entre processos).
- **CA-16** (RN-12, RN-17; origem: E6.2 e "Subscriptions" do CLAUDE.md): Dado a notificação devolvida por um disparo do MP simulado, quando passada a `validarWebhook`, então resulta `{ valida: true, tipo, recursoId }` com o recurso do disparo. Com o `data.id` ou o cabeçalho de origem adulterado, ou sem o cabeçalho, resulta `{ valida: false }`.
- **CA-17** (RN-18; origem: S12, E8.2): Dado uma assinatura simulada `autorizada`, quando `adiarProximaCobranca(id, D)` é chamada com D futura, então existe um registro de adiamento (data anterior, D) e `consultarAssinatura` devolve próxima cobrança = D. Com D no passado, ou numa assinatura `pendente`, a chamada falha e nada muda.
- **CA-18** (RN-18; origem: E6.5 CA-3): Dado um erro forçado em `cancelarAssinatura` no MP simulado, quando se cancela, então a porta lança `ErroProvedor` e o estado continua `autorizada`. A chamada seguinte cancela normalmente.
- **CA-19** (RN-20; origem: entregável "rota /dev/mp-checkout inativa no modo real"):
  - Dado `MP_ADAPTER=simulado` e uma assinatura simulada pendente, quando se acessa `/dev/mp-checkout` com o seu identificador, então a resposta é 200 e mostra "R$ 79,00" e a ação de autorizar.
  - Ao autorizar, a assinatura fica `autorizada` e a resposta redireciona para a `urlRetorno` gravada, mesmo se a requisição trouxer outra URL.
  - Com identificador inexistente → 404.
  - Com `MP_ADAPTER=real` → 404, sem consultar o banco.
  - Verificação: teste de integração do handler ou da ação, com banco real. O tester confere manualmente no navegador o fluxo e o uso só pelo teclado.
- **CA-20** (RN-11, RN-19; origem: E7.1 CA-2/CA-3, E8.3 CA-2):
  - Dado o WhatsApp simulado, quando envia um modelo `confirmacao`, então devolve um `provedorMensagemId` e há 1 chamada registrada com `sucesso`, o destinatário, o modelo, os parâmetros e a chave.
  - Dado "próximas 2 falham, temporário", quando se enviam 3, então as 2 primeiras lançam `ErroEnvioTemporario`, a terceira tem sucesso e há 3 chamadas registradas, 1 com `sucesso`.
  - Dado "próxima falha, permanente", então a chamada lança `ErroEnvioPermanente`.
  - Dado o destinatário `+12025550123` (não brasileiro), então a chamada lança `ErroEnvioPermanente` e é registrada como falha.
  - A falha forçada configurada por um cliente de banco é consumida por uma instância sobre outro cliente.
- **CA-21** (RN-19; origem: E7.1 CA-9, concorrência): Dado 1 falha forçada e N ≥ 10 envios concorrentes, quando terminam, então exatamente 1 falhou e N−1 tiveram sucesso, com N linhas registradas.
- **CA-22** (RN-1, RN-16): Dado o lint, quando aplicado pela API do ESLint (`lintText` com `filePath` simulado, padrão de D-005 CA-5), então:
  - há erro em `src/server/x.ts` e em `src/app/x.ts` que importam `nodemailer`;
  - há erro em `src/app/x.ts` que importa `@/server/integrations/mercadopago/simulado` ou `…/email/real`, ou que contém o literal `https://challenges.cloudflare.com/turnstile/v0/siteverify`;
  - não há erro em `src/server/integrations/email/real.ts` importando `nodemailer`, em `src/app/dev/mp-checkout/page.tsx` importando o MP simulado, em `tests/x.test.ts`, nem em `src/app/x.ts` importando a porta ou o registro;
  - o auxiliar falha se o arquivo simulado estiver ignorado pelo ESLint;
  - verificação manual (tester): um arquivo temporário violando a regra faz `npm run lint` terminar com código ≠ 0.
- **CA-23** (RN-9): Dado o e-mail simulado (e o real, com o stub), quando se envia com destinatário inválido, vários destinatários, assunto com CR/LF ou texto vazio, então a porta lança o erro de validação, `email_log` não ganha linha e o stub SMTP não recebe nenhuma mensagem.
- **CA-24** (RN-15; origem: entregável "migração do item"):
  - Dado o banco migrado do zero, quando se executa `npm run db:migrate:deploy`, então as tabelas dos simulados existem.
  - O teste de drift da D-004 (`tests/integration/db/drift.test.ts`) continua passando.
  - Nenhuma tabela nova tem dados de cartão, nem guarda segredo ou token de provedor.
- **CA-25** (RN-8; Definição de pronto):
  - O `.env.example` contém as variáveis da RN-8, com as credenciais vazias e os seletores em `simulado`, e o teste "chaves do `.env.example` × `env.ts`" passa.
  - A seção de credenciais do README lista `SMTP_*`, `EMAIL_FROM`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, o token simulado do Turnstile, o comando para ler `email_log` e o uso de `/dev/mp-checkout`, e marca MP e WhatsApp reais como E6.6/E7.2.
  - A CI segue sem `secrets.` e sem `*_ADAPTER=real`.
  - `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:coverage` (≥ 90% de linhas) e `npm run test:e2e` passam, sem novas exclusões de cobertura e sem `eslint-disable` das regras RN-10 (D-005) e RN-16.

### Relação com o PLAN
| Critério do PLAN | CAs desta demanda | Fechamento |
|---|---|---|
| 5 (assinatura com adaptador local; webhooks repetidos sem efeito duplicado) | CA-15..CA-19 | E6.x |
| 6 (WhatsApp registrado, enviado pelo adaptador, repetível sem duplicar) | CA-20, CA-21 | E7.1 |
| 8 (recuperação e convite com e-mail simulado) | CA-3, CA-23 | E1.3, E1.4 |
| 10 (captcha simulado) | CA-4, CA-13, CA-14 | E4.2, E4.4 |

"Direção técnica" (`PLAN.md:123`, adaptadores reais e simulados por env, sem dado de cartão): CA-1, CA-2, CA-8..CA-10, CA-24.

## 6. Casos limite
- **Fuso horário e virada de dia**:
  - as datas do MP simulado (autorização, próxima cobrança, adiamento) são gravadas em UTC (`timestamptz`);
  - "+30 dias" e "+1 mês" são calculados sobre o instante UTC. A forma de exibir e de contar dias no fuso do salão é de E6.3;
  - virada de mês (31/jan + 1 mês): o simulado adota a regra do `Date`/biblioteca escolhida pelo arquiteto, desde que documentada e testada (não há regra no PLAN).
- **Concorrência**:
  - falha forçada do WhatsApp com envios paralelos (CA-21);
  - dois disparos simultâneos sobre a mesma assinatura simulada: o resultado deve ser consistente, com transição atômica ou erro de estado, nunca dois pagamentos por um disparo;
  - `email_log` aceita inserções concorrentes.
- **Isolamento entre salões**:
  - as tabelas dos simulados e `email_log` são dados de plataforma, sem `salao_id` (como `email_log`, D-004/dba.md:26), exceto a referência externa `salaoId` da assinatura simulada;
  - nenhuma ação de tenant expõe essas tabelas;
  - o vínculo assinatura → salão vem da referência gravada em `criarAssinatura` (CA-15). E6.2 deve resolver o salão por ela, nunca por parâmetro do navegador.
- **Salão suspenso**: não se aplica aos adaptadores. A política de capacidades é de E6.4, e o cancelamento por um salão suspenso continua notificando pelo mesmo adaptador.
- **Cliente anonimizada**:
  - a chamada ao WhatsApp não deve acontecer (decisão de E7.1 RN-8);
  - as chamadas já registradas no simulado guardam o telefone. A anonimização (E5.2) não precisa limpar as tabelas dos simulados, porque elas são artefato de desenvolvimento e teste (D-4).
- **Entradas inválidas**:
  - telefone não brasileiro ou fora do E.164 → `ErroEnvioPermanente` (CA-20);
  - e-mail com destinatário inválido, vários destinatários ou CR/LF no assunto (injeção de cabeçalho) → erro de validação (CA-23);
  - token Turnstile vazio → inválido sem rede (CA-13);
  - `SMTP_PORT` e `SMTP_SECURE` malformados → check-env nomeia a variável (CA-8);
  - identificador de assinatura ou pagamento desconhecido → erro "não encontrado no provedor".
- **Permissões por perfil**: os adaptadores não autorizam ninguém; quem autoriza é o chamador (`defineAcao`, D-005). `/dev/mp-checkout` imita a página pública do provedor e não exige sessão. O risco fica restrito ao modo simulado (D-5).
- **Redirecionamento aberto**: `/dev/mp-checkout` só redireciona para a `urlRetorno` gravada (CA-19).
- **Provedor lento ou fora do ar**:
  - Turnstile → `indisponivel` dentro do tempo-limite (CA-13);
  - SMTP inacessível → erro de envio dentro do tempo-limite (CA-11);
  - os tempos-limite ficam abaixo dos timeouts de requisição e do encerramento gracioso do worker (D-001/devops.md:51).
- **Reuso do token Turnstile**: o token do simulado é aceito quantas vezes for apresentado (documentado). O real depende da Cloudflare (tokens de uso único).
- **`npm run dev`/`npm run start` sem o entrypoint**: o check-env não roda. O registro valida no primeiro uso (RN-14, CA-10).
- **`.env` com valores vazios** (padrão do exemplo): vazio conta como ausente. Com seletor `simulado`, nada falha (CA-8).
- **Caminho com espaço e acento**: os testes de stub e lint não usam shell e resolvem caminhos com `fileURLToPath` (padrão vigente).

## 7. Dependências
- **Bloqueada por**: #6 (E0.4), já mesclada (`email_log` e esquema). Usa a D-005 (repositórios, lint RN-10, harness `tests/support/`) e a D-006 (CI), ambas mescladas em main.
- **Bloqueia**: #13 (E1.1), #14 (E1.3), #21 (E1.4), #49 (E6.6), #31 (E7.1), #50 (E7.2), #54 (E9.1). Relacionadas: #49 e #50.
- **Integrações**:
  - e-mail transacional (SMTP genérico, D-001/design.md:32);
  - Cloudflare Turnstile (`siteverify`);
  - Mercado Pago e WhatsApp, só porta e simulado.
  - Nenhuma credencial real é necessária: todos os reais são testados contra stub local.
- **Bibliotecas novas**:
  - `nodemailer` (produção) e os tipos (`@types/nodemailer`, se necessários), em versão exata;
  - opcionalmente, um servidor SMTP de teste (por exemplo, `smtp-server`, dev), também em versão exata, ou um stub SMTP mínimo com `node:net`, à escolha do arquiteto;
  - verificar `allowScripts`, caso alguma delas tenha script de instalação.
- **Dados**: migração nova (tabelas dos simulados). `email_log` já existe.
- **Infraestrutura**: nenhum serviço novo no compose. O entrypoint já roda o check-env nos dois papéis.

## 8. Impactos prováveis
- **Dados (DBA: sim)**:
  - migração com as tabelas do MP simulado (assinatura, pagamento, adiamento, erro forçado) e do WhatsApp simulado (chamada, falhas forçadas);
  - o DBA deve revisar: nomes (prefixo sugerido `sim_` ou `simulado_`), tipos `timestamptz`, chaves (identificadores com formato de provedor, por exemplo texto), consumo atômico da falha forçada (`UPDATE … RETURNING` / `FOR UPDATE SKIP LOCKED`), índices de leitura dos testes, ausência de FK para tabelas de domínio (o simulado imita um sistema externo; ver D-2), drift do Prisma, e o fato de essas tabelas existirem também em produção, vazias.
- **Infra/CI (DevOps: sim, revisão leve)**:
  - `.env.example` e `env.ts` com as variáveis novas;
  - a saída do check-env passa a listar os modos;
  - a evidência do CA-2 é colhida com `docker compose run`;
  - `nodemailer` entra em `dependencies` (sobrevive ao `npm prune --omit=dev` do `Dockerfile:15-19`);
  - o bundle `dist/scripts/check-env.js` (`--packages=external`) continua só com dependências de produção;
  - README atualizado;
  - CI sem mudança esperada (sem segredos), embora o DevOps deva confirmar que os testes com stub (portas efêmeras em `127.0.0.1`) rodam no runner.
- **Código existente**:
  - `src/server/env.ts` (esquema e regras condicionais, `chavesDeclaradas`), `src/server/check-env.ts` (linha dos modos), `src/worker/stub.ts` (log dos modos) e `eslint.config.mjs` (RN-16) mudam;
  - `src/server/repos/**` ganha os repositórios de plataforma (`email_log` e tabelas dos simulados);
  - `prisma/schema.prisma` e a migração nova também mudam.
- **Cobertura**: `src/server/integrations/**`, `src/config/plano.ts`, os repositórios novos e `src/app/dev/**` entram no gate de 90%. Os reais são cobertos pelos stubs.

## 9. Dúvidas e suposições

### Bloqueantes
Nenhuma.

### Decisões tomadas (não bloqueantes), para o arquiteto confirmar
- **D-1: `MP_ADAPTER=real` e `WHATSAPP_ADAPTER=real` nesta demanda.**
  - Decisão: o check-env (e o registro no primeiro uso) **recusa** esses modos e nomeia o seletor (CA-9). Os stubs `NaoImplementado` continuam existindo e ligados ao registro, porque a função de seleção mapeia `real` para eles.
  - Motivo: falhar cedo, na inicialização, em vez de subir um processo cuja primeira cobrança ou mensagem falharia.
  - E6.6 e E7.2 trocam a recusa pelas próprias exigências (`MP_ACCESS_TOKEN` e outras). Sugestão ao arquiteto: declarar as exigências de cada modo real junto do adaptador, para que E6.6 e E7.2 não disputem o mesmo trecho de `env.ts`.
  - Alternativa: aceitar o modo e falhar só na chamada. Não recomendada.
- **D-2: forma das tabelas dos simulados.**
  - A especificação fixa o comportamento (RN-15, RN-17..RN-19). Nomes, colunas e chaves ficam com o arquiteto e o DBA.
  - Sem FK para `salao`: a referência externa é texto, como no provedor real.
- **D-3: entrega da notificação do MP simulado.** O disparo devolve a notificação, sem enviá-la por HTTP, porque o endpoint de webhook é de E6.2. E6.2 pode acrescentar um "entregar ao endpoint" usado nos testes e no E2E.
- **D-4: dados pessoais nas tabelas dos simulados.** Elas guardam telefone e e-mail como o provedor guardaria. Não entram na anonimização (E5.2) nem nas telas de equipe. Elas existem para desenvolvimento e teste, e o README registra que o modo simulado não é para publicação.
- **D-5: simulado fora do desenvolvimento.** O projeto não proíbe `simulado` com `NODE_ENV=production`, porque a imagem Docker local roda assim. O bloqueio dos simulados num ambiente publicado fica para a etapa de publicação (`PLAN.md:147`), registrado como risco, e não como CA.
- **D-6: validação do `validarWebhook` simulado.** A origem é provada por um cabeçalho assinado (por exemplo, HMAC com um segredo fixo do simulado, no mesmo formato `x-signature` do real), para que E6.2 exercite a origem inválida. O formato exato fica com o arquiteto.
- **D-7: token e chave simulados do Turnstile.** Recomenda-se usar o token fictício que a própria Cloudflare documenta para chaves de teste (`XXXX.DUMMY.TOKEN.XXXX`) e uma chave de site simulada fixa. O valor final é do arquiteto, desde que exportado como constante e documentado no README (CA-4).
- **D-8: e-mail só em texto.** `email_log` tem só `corpo`, e a porta exige `texto` (e aceita `html` opcional, enviado só pelo real). Não há migração para guardar o HTML.
- **D-9: leitura do `email_log` pela pessoa desenvolvedora.** É feita por um comando `psql` documentado no README, sem tela nem rota nova.
- **D-10: `SMTP_PORT` e `SMTP_SECURE` opcionais** (padrões 587 e `false`), e `SMTP_USER` e `SMTP_PASSWORD` em par (RN-13). A RN-8 lista as variáveis, mas não diz quais são obrigatórias. O CA-2 exige pelo menos `SMTP_HOST`.
- **D-11: tempo-limite dos reais.** Um valor fixo por adaptador (sugestão: ≤ 5 s para o Turnstile e ≤ 10 s para a conexão SMTP), injetável no construtor para os testes, sem variável de ambiente nova (a RN-8 não as lista).
