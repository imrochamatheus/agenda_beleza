# D-046 (E6.6) — Adaptador real do Mercado Pago: design

## 1. Resumo e confirmação na documentação oficial

Solução: `MP_ADAPTER=real` constrói uma `PortaMercadoPago` completa em `src/server/integrations/mercadopago/`, com tudo o que depende de formato do provedor isolado em UM módulo (`mapeamento.ts`, funções puras). Sem migração, sem dependência nova (`fetch` e `node:crypto` nativos; o SDK `mercadopago` é descartado: esconde o corpo, dificulta o stub local e o tempo limite).

Confirmação (consultas de 2026-11-22, só documentação oficial `mercadopago.com.br/developers`):

| Ponto | Veredito | Fonte |
|---|---|---|
| D-2 manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, HMAC-SHA256 em hex com o segredo do app, `data.id` da QUERY, `ts`/`v1` no `x-signature`, comparação em tempo constante, 401 no erro; par ausente é omitido do manifest | CONFIRMADO | `.../developers/en/docs/checkout-pro-preferences/additional-content/notifications` e `.../your-integrations/notifications/webhooks` |
| D-2 `data.id` alfanumérico em minúsculas | NÃO CONFIRMADO (a página não cita) | idem |
| D-2 unidade de `ts` | REFUTADO como "sempre ms": os exemplos oficiais trazem 13 dígitos (`1742505638683`) e 10 dígitos (`1781009491`) | idem |
| Janela de replay | NÃO existe na documentação (decisão nossa, 5 min) | idem |
| Tipos de notificação `subscription_preapproval`, `subscription_authorized_payment` (e `subscription_preapproval_plan`) | CONFIRMADO | `.../your-integrations/notifications/webhooks` |
| Notificações de assinatura não se configuram no painel "Suas integrações"; são definidas na criação | CONFIRMADO (avisar no README; ver §7 R-5) | idem |
| D-1 `POST /preapproval` com `preapproval_plan_id` SEM `card_token_id` devolve `init_point` | REFUTADO pela documentação: "a assinatura deve ser criada com `card_token_id` e status `authorized`" quando há plano | `.../docs/subscriptions/integration-configuration/subscription-associated-plan` |
| `init_point` na criação de assinatura (`.../subscriptions/checkout?preapproval_id=…`) e do plano (`...?preapproval_plan_id=…`, sem `external_reference`) | CONFIRMADO só pelo exemplo de resposta | `.../reference/online-payments/subscriptions/create-preapproval/post`, `.../create-preapproval-plan/post` |
| Sem plano, `status: "pending"` (sem meio de pagamento, pagador conclui no link) com `reason`, `external_reference`, `payer_email`, `auto_recurring {frequency, frequency_type, transaction_amount, currency_id, end_date}`, `back_url` | CONFIRMADO (corpo); `init_point` nesse caso e `free_trial` no preapproval sem plano NÃO CONFIRMADOS | `.../subscription-no-associated-plan/pending-payments` |
| `reason` e `external_reference` obrigatórios só sem plano | CONFIRMADO | referência de create-preapproval |
| `free_trial {frequency, frequency_type}` dentro de `auto_recurring` do PLANO | CONFIRMADO | referência de create-preapproval-plan |
| Erros citados: "transaction_amount must be the same as preapproval_plan", "This app cannot create subscriptions without a plan" | CONFIRMADO só por busca (a página não os lista): sem plano pode ser bloqueado por conta | busca na documentação |
| D-3 `PUT /preapproval/{id}` aceita `next_payment_date` | NÃO CONFIRMADO (não é parâmetro documentado; PUT documenta `reason`, `external_reference`, `back_url`, `auto_recurring`, `status`) | `.../update-preapproval/put` |
| `status` aceitos no PUT (`cancelled`) | NÃO CONFIRMADO na página (só `pending` no exemplo) | idem |
| `GET /authorized_payments/{id}`: `preapproval_id`, `status` (exemplo `scheduled`), `payment.status` (exemplo `approved`), `debit_date`, `transaction_amount` string | CONFIRMADO os campos; enumerações (`processed`, `recycling`, `cancelled`, `rejected`) NÃO CONFIRMADAS | `.../get-authorized-payment/get` |
| `transaction_amount` volta como string (`"24.50"`) | CONFIRMADO no exemplo; parser aceita número ou string | referência de create-preapproval |
| `X-Idempotency-Key` em `/preapproval` | NÃO CONFIRMADO (nenhuma página cita) | referência de create-preapproval |
| D-4 `date_created`/`last_modified`/`next_payment_date` no preapproval | CONFIRMADO só pelo exemplo de resposta; semântica NÃO CONFIRMADA | idem |

Consequências de desenho:
1. D-1 refutado: o corpo `preapproval_plan_id + status:"pending"` sem cartão é arriscado. Decisão: o corpo de criação vira uma estratégia isolada, `ESTRATEGIA_CRIACAO` em `mapeamento.ts`:
   - `com_plano` (padrão; é o que a issue e a CA-1 pedem): `{ preapproval_plan_id, payer_email, external_reference, back_url, reason, status:"pending" }`.
   - `sem_plano` (fallback documentado): `{ reason, external_reference, payer_email, back_url, status:"pending", auto_recurring:{ frequency:1, frequency_type:"months", transaction_amount: PRECO_MENSAL_CENTAVOS/100, currency_id:"BRL", free_trial:{ frequency: DIAS_TESTE, frequency_type:"days" } } }`, com os valores lidos de `src/config/plano.ts` (nunca copiados).
   A troca é editar UMA constante; ambos os montadores têm teste de contrato. O README registra como pendência de validação no sandbox (E9.3) qual dos dois o MP aceita e devolve `init_point`. Se `com_plano` falhar sem `card_token_id`, o spike muda a constante.
2. Webhook: `ts` aceito em ms OU segundos (`< 1e11` ⇒ segundos, ×1000) para a janela; o manifest usa o `ts` BRUTO do cabeçalho. Para a minúscula do `data.id`: a validação tenta o `data.id` como recebido e, se contiver letras maiúsculas, também a versão minúscula; aceita se qualquer uma conferir (ambas em tempo constante). Isso cobre as duas leituras sem afrouxar nada (HMAC sobre mensagem diferente).
3. POST não é repetido em 5xx/timeout (idempotência no MP não confirmada: repetir poderia duplicar a assinatura). Repete 1 vez, com a MESMA `X-Idempotency-Key`, só em 429 ou falha de conexão antes de qualquer resposta. A spec RN-8/CA-8 fica ajustada assim (CA-8 testa com 429 e com conexão recusada na 1ª tentativa).
4. Enumerações de `authorized_payments` não confirmadas: o mapeamento é uma tabela única em `mapeamento.ts`; desconhecido → `ErroProvedor` (RN-11), nunca decide.

Alternativas descartadas: SDK oficial `mercadopago` (dependência nova sem ganho, mascara o HTTP); exigir cartão no nosso formulário (RN-2/PCI); decidir o salão pelo adaptador (D-041 já cruza o vínculo).

## 2. Componentes (todos em `src/server/integrations/mercadopago/`, salvo indicação)

| Arquivo | Conteúdo |
|---|---|
| `port.ts` (edita) | `CodigoErroMercadoPago` ganha `'adiamento_nao_suportado'`; nova `ProvedorNaoSuportaAdiamento extends ErroMercadoPago` (`codigo='adiamento_nao_suportado'`, mensagem fixa pt-BR). |
| `ambiente.ts` (edita) | `CHAVES = ['MP_ACCESS_TOKEN','MP_WEBHOOK_SECRET','MP_PREAPPROVAL_PLAN_ID']`; `ConfigMercadoPagoReal = { accessToken, webhookSecret, planoId }`; `lerConfigReal(fonte)`: ausentes/vazias nomeadas ordenadas; `APP_URL` sem `https://` nomeia `APP_URL` (a fonte chega a `lerConfigReal(fonte)`, então a regra fica aqui, sem imports; `APP_URL` ausente no real conta como inválida porque o padrão `http://localhost` não é https). `env.ts` não muda de lógica (já repassa `lerConfigReal(fonte)`); só o tipo vem do módulo. |
| `mapeamento.ts` (novo, puro, sem rede/ambiente) | `ESTRATEGIA_CRIACAO`; `montarCorpoCriacao(e, planoId)`; `mapearPreapproval(json)` → `AssinaturaProvedor`; `mapearPagamento(json)` → `PagamentoProvedor`; `lerInitPoint(json)` (HTTPS obrigatório); `extrairProximaCobranca`; tabelas de status; `MANIFESTO_WEBHOOK`. Único lugar com nomes de campos do MP. Valida com zod `.passthrough()` (campos desconhecidos ignorados). `valorCentavos = Math.round(Number(transaction_amount)*100)`. D-4: `autorizadaEm = date_created` se `authorized`, senão null; `canceladaEm = last_modified` se `cancelled`; `proximaCobrancaEm = next_payment_date`. |
| `http.ts` (novo) | `criarClienteHttp({ urlBase = 'https://api.mercadopago.com', token, fetchImpl = fetch, esperar })` → `requisitar({metodo, caminho, corpo?, idempotencia?, tentativas})`. `AbortSignal.timeout(10_000)`, `Authorization: Bearer`, `Content-Type` só com corpo, GET com até 2 repetições (200/400 ms) em 429/5xx/rede, POST conforme item 3 acima, PUT sem repetição. Resposta lida como texto e `JSON.parse` com try; qualquer falha vira erro da porta por `traduzirStatus` (§6 da spec). Nunca anexa corpo, cabeçalho, URL ou token a mensagem/`cause`. Ids validados `^[A-Za-z0-9_-]{1,64}$` + `encodeURIComponent` antes do HTTP. |
| `webhook.ts` (novo) | `validarWebhookReal(n, { segredo, agora })`: nunca lança; reaproveita o formato do simulado (extrair `lerAssinatura` e `TIPOS_MP` para um módulo comum SEM tocar o comportamento do simulado: criar `webhook-comum.ts` e fazer o simulado importá-lo, ou duplicar o mínimo se o risco de regressão for maior; decisão do dev, testes do simulado inalterados). Passos: cabeçalhos → `ts` dígitos → janela `|agora−ts| ≤ 300_000 ms` (inclusive) → manifest → HMAC → `timingSafeEqual` com comprimentos iguais → consistência corpo×query → `type` conhecido. `corpoBruto` ignorado (CA-2d). |
| `real.ts` (reescreve) | `criarMercadoPagoReal(config, opcoes?: { urlBase?, fetchImpl?, agora?, esperar?, gerarChave? })`: as 7 operações. `adiarProximaCobranca`: valida `Date` futura (senão `OperacaoInvalidaNoProvedor`, sem HTTP) → `PUT {auto_recurring? não} {next_payment_date}` (o corpo exato `{ next_payment_date: iso }` mora em `mapeamento.ts`) → GET → compara com tolerância 60 s; 400/422 no PUT ou data não refletida ⇒ `ProvedorNaoSuportaAdiamento`; 404 ⇒ `RecursoNaoEncontradoNoProvedor`; demais erros seguem a tabela. `cancelarAssinatura` conforme RN-12 (PUT `{status:"cancelled"}`; 400/409/422 + GET `cancelled` ⇒ ok). |
| `registry.ts` (edita) | `selecionarMercadoPago(c: ConfigIntegracao<ConfigMercadoPagoReal>, o: {appUrl})`: real → `criarMercadoPagoReal(c.config)`; `criarIntegracoes` passa `mercadoPago` inteiro. Teste atual do registry atualizado. |
| `nao-implementado`/stub | `NaoImplementado('E6.6')` some do MP; `NaoImplementado` continua importado por `regularizar.ts`, `cancelar.ts`, `admin/saloes.ts` (WhatsApp E7.2) e fica. |

Consumidores conferidos (grep): `admin/saloes.ts:269-271` `codigoDoErro` devolve `e.codigo` como string (sem switch): `adiamento_nao_suportado` passa a ser gravado em `falha({codigo})` sem mudança de código; `assinatura/iniciar.ts:64,84` só distingue `nao_encontrado` e trata o resto como falha do provedor; `regularizar.ts:59` e `cancelar.ts:42` capturam `ErroMercadoPago` em bloco; nenhum `switch` exaustivo sobre o código. Único ajuste: um teste em `admin` cobrindo o novo código no mapeamento (documentação do valor), e conferir `docs`/README que listam os códigos da auditoria.

## 3. Interfaces
Porta inalterada (`PortaMercadoPago`). Novos exports de `port.ts`: `ProvedorNaoSuportaAdiamento`. `criarMercadoPagoReal(config: ConfigMercadoPagoReal, opcoes?)`. Sem contrato HTTP novo; `POST /api/webhooks/mercadopago` (D-041) inalterado.

## 4. Dados
Nenhum impacto. DBA dispensado (sem tabela, coluna, constraint ou índice; o webhook e as consultas já persistem pela D-041).

## 5. Infraestrutura
`docker-compose.yml` usa `env_file`; conferir se as variáveis chegam a app e worker (o dev ajusta só se a âncora não repassar). `.env.example` ganha as três `MP_*` vazias com comentário (e a observação de `APP_URL` https no modo real). `e2e/suporte/ambiente.ts` já fixa `MP_ADAPTER: 'simulado'` (sem mudança). Sem container, CI ou observabilidade novos (log: só códigos fixos). DevOps dispensado: o dev faz as três edições de configuração junto (T-4), com revisão no tester; justificativa: nenhuma mudança de pipeline, imagem ou job.

## 6. Invariantes
- Escopo por salão no servidor: N/A ao adaptador; `external_reference = salaoId` volta em `salaoId` e a D-041 cruza o vínculo. Exclusion constraint, soft delete/anonimização, UTC (as datas do provedor são convertidas a `Date` UTC; nenhum fuso aqui): N/A.
- Adaptadores: atendida; só `registry.ts` expõe o real e o lint de importação segue valendo (CA-10).
- Salão suspenso (somente leitura): N/A ao adaptador; `cancelarAssinatura`/`adiar` são chamados por consumidores que já aplicam a política.
- Idempotência de webhook: o adaptador só valida origem + replay; a persistência/idempotência dos eventos permanece na D-041. Mensagens: N/A.
- Auditoria do super admin: `adiarProximaCobranca` falho já grava auditoria pela D-044 com o novo código `adiamento_nao_suportado`.
- Cartão nunca é recebido nem enviado (RN-2); token e segredo só na config em memória (RN-15), com teste de busca de texto em erros/`cause`/logs.

## 7. Riscos e decisões
- R-1 (alto): `com_plano` sem `card_token_id` provavelmente não aceita (doc de plano exige cartão). Mitigação: constante `ESTRATEGIA_CRIACAO` + montador `sem_plano` pronto e testado; spike E9.3 decide; README marca como PENDENTE DE VALIDAÇÃO NO SANDBOX. Se o MP bloquear criação sem plano na conta, a alternativa é redirecionar ao `init_point` do plano e localizar a assinatura pelo webhook/`payer_email` (sem `external_reference`): exigiria mudança em D-040/D-041, fora desta demanda; registrar no relatório do spike.
- R-2: `PUT next_payment_date` pode ser ignorado: RN-4 (falha explícita, decisão P2).
- R-3: enumerações de `authorized_payments` e `X-Idempotency-Key` não confirmadas: tabela única + desconhecido ⇒ `ErroProvedor`; POST sem repetição em 5xx.
- R-4: `ts` em ms ou s e minúscula: aceitos os dois, testados (CA-2e).
- R-5: notificações de assinatura são configuradas na criação (doc): o README manda cadastrar a URL no painel do MP E conferir no spike se chegam sem `notification_url` no corpo; se não, adicionar `notification_url = APP_URL + /api/webhooks/mercadopago` ao corpo de criação em `mapeamento.ts` (incluir já no montador como campo de `montarCorpoCriacao`; ambos os montadores o enviam, é inofensivo e documentado como campo do preapproval; marcado NÃO CONFIRMADO).
- R-6: `external_reference` e `back_url` ecoados sem validação: `salaoId` validado como UUID na resposta (senão `ErroProvedor`).

## 8. Testes (cobertura ≥ 90% de linhas, tudo sem credencial real)
Unitários (`src/**`): `mapeamento.test.ts` (CA-1 mapeamentos, CA-1b, CA-6 parte pura, corpos `com_plano`/`sem_plano`), `webhook.test.ts` (CA-2, 2b, 2c, 2d, 2e `ts` em s e minúscula, relógio injetado), `ambiente.test.ts` (CA-3, CA-4 sobre `lerConfigReal`), `http.test.ts` com `fetchImpl` injetado (CA-7, CA-8, CA-11, RN-15), `real.test.ts` com servidor `node:http` local por `urlBase`, como a D-021 (CA-1, 1b, 5, 6, 7, 9, 11), `port.test.ts` (novo erro). Integração (`tests/integration/integracoes/`): CA-3/CA-4 por `validarEnv`/`check-env` (processo filho, saída sem valores), CA-10 (`criarIntegracoes`, lint de importação), CA-12 (`documentacao.test.ts`/`chavesDeclaradas`), CA-13 (webhook assinado → `POST /api/webhooks/mercadopago` com adaptador real e stub local para o GET; segredo errado → rejeição persistida). Playwright: nenhum (sem UI).

## 9. Tarefas
| T | Resp. | Dep. | Arquivos sob posse | Entregável / conclusão |
|---|---|---|---|---|
| T-1 | desenvolvedor | - | `port.ts`, `port.test.ts`, `ambiente.ts`, `ambiente.test.ts`, `src/server/integrations/registry.ts`, `registry.test.ts` | Erro novo; `lerConfigReal` completo (3 vars + `APP_URL`); registry repassa config; recusa de startup removida. CA-3, CA-4, CA-10 (parte). |
| T-2 | desenvolvedor | - (paralela a T-1) | `mapeamento.ts`+teste, `webhook.ts`+teste, `webhook-comum.ts` (se criado), edição mínima de `webhook-simulado.ts` | Funções puras e validação do webhook. CA-1/1b/2/2b/2c/2d/2e. |
| T-3 | desenvolvedor | T-1, T-2 | `http.ts`+teste, `real.ts`, `real.test.ts` (servidor local), `tests/integration/integracoes/mercadopago-real*.test.ts` | Adaptador completo. CA-1, 1b, 5..11, 13. |
| T-4 | desenvolvedor (config, sem DevOps) | T-3 | `.env.example`, `docker-compose.yml` (só se preciso), `README.md`, `CLAUDE.md` (parágrafo D-046) | CA-12; README: variáveis, passos do plano no MP (R$ 79, `free_trial` 30 dias, mensal), URL do webhook, avisos e a lista PENDENTE DE VALIDAÇÃO NO SANDBOX (D-1, D-3, enumerações, `X-Idempotency-Key`, `ts`, minúscula, R-5), remoção de "ainda recusado" (README linhas ~373, 408, 412, 630, 639, 825). |
Paralelas: T-1 e T-2 (sem arquivo em comum). T-3 só após ambas; T-4 por último. Cobertura medida por `npm run test:coverage`.
