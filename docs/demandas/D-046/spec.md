# D-046 (E6.6) — Adaptador real do Mercado Pago: spec

Issue #49. Sem UI. Sem migração provável. Decisão do usuário P2 (opção a): tentar adiar e falhar explicitamente se o provedor não refletir.

## 1. Problema (evidência)
- `src/server/integrations/mercadopago/real.ts:11-25`: todo método rejeita com `NaoImplementado('E6.6')`, inclusive `validarWebhook`.
- `mercadopago/ambiente.ts:8-20`: `CHAVES = []`; `lerConfigReal` devolve sempre `{ ok:false, variaveis:['MP_ADAPTER'] }`, então `MP_ADAPTER=real` é recusado na inicialização (README:412, :825).
- `registry.ts` (`selecionarMercadoPago`): `real` chama `criarMercadoPagoReal()` sem config; `criarIntegracoes` já recebe `env.integracoes.mercadoPago` (tipo `ConfigIntegracao<ConfigMercadoPagoReal>`) mas só repassa `modo`.
- `ProvedorNaoSuportaAdiamento` NÃO existe (grep em `src`: zero). `port.ts:78-126` tem `ErroMercadoPago` (`nao_encontrado` | `operacao_invalida` | `falha_provedor`).
- Consumidores já prontos: D-040 `assinatura/iniciar.ts` (cria/consulta; trata `ErroMercadoPago`), D-041 `assinatura/webhook-http.ts:45-53` (passa `cabecalhos`, `consulta`, `corpoBruto` e `corpo` à porta), D-042 `regularizar.ts`/`cancelar.ts` (aceitam `ErroMercadoPago` e `NaoImplementado`), D-044 `admin/saloes.ts:270-324` (mapeia `e.codigo`; `adiarProximaCobranca` fora de transação).
- Simulado do webhook (`webhook-simulado.ts`): manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, `ts` em ms, `type` `subscription_preapproval` / `subscription_authorized_payment`, sem janela de replay ("é da E6.6", linha ~71).

## 2. Objetivo
Ligar a cobrança real só configurando credenciais: `MP_ADAPTER=real` constrói uma `PortaMercadoPago` completa sobre a API de Assinaturas (preapproval) do MP, validada por testes de contrato com servidor HTTP local. A validação no MP real fica como pendência documentada (E9.3).

## 3. Escopo
Entra: `real.ts` (6 operações + `validarWebhook`), `ambiente.ts` (config e exigências), `ProvedorNaoSuportaAdiamento` em `port.ts`, repasse da config no `registry.ts`, remoção da recusa de `MP_ADAPTER=real`, `.env.example`, compose (repassar as variáveis, como as `S3_*`), README (seção "Credenciais para os serviços reais" e roteiro de sandbox/spike S12), testes de contrato, `webhook` com janela de replay.
Fora: UI, sandbox real, WhatsApp real, mudança de schema/máquina de estados (D-036/D-037), cartão (RN-2). Confronto com "Fora da v1": nada citado é tocado. O bloqueio dos simulados em produção continua fora.

## 4. Regras de negócio
- RN-1 (issue): com `MP_ADAPTER=real`, ausência/vazio de `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` ou `MP_PREAPPROVAL_PLAN_ID`, ou `APP_URL` sem `https://`, falha na inicialização (check-env e worker) nomeando as variáveis, nunca valores. Todas as inválidas num único `ErroDeAmbiente`. No simulado, as `MP_*` e `APP_URL` http são ignoradas (CA-8 da D-007 preservado).
- RN-2: nenhum dado de cartão é recebido, enviado ou gravado; o pagador informa o cartão no checkout do MP (`init_point`).
- RN-3: todo erro do provedor vira erro da porta (tabela §6); nenhum corpo/cabeçalho do MP, URL com id sensível nem token aparece em mensagem, `cause` ou log. Mensagens fixas em pt-BR.
- RN-4 (P2): `adiarProximaCobranca` valida a data (`Date` válida e futura, senão `OperacaoInvalidaNoProvedor`), faz o PUT, relê com GET e compara `proximaCobrancaEm` com `novaData`; diferença > 60 s, ou PUT recusado pelo MP por 400/422 em campo de data, resulta em `ProvedorNaoSuportaAdiamento`. A classe estende `ErroMercadoPago` com `codigo = 'adiamento_nao_suportado'` (novo membro de `CodigoErroMercadoPago`; o arquiteto confere os `switch`/mapeamentos de `e.codigo` em `admin/saloes.ts`).
- RN-5: `validarWebhook` nunca lança e é determinística: valida a assinatura HMAC-SHA256 do manifest com `MP_WEBHOOK_SECRET`, em tempo constante, e a janela de replay de `ts` (RN-6).
- RN-6: janela de replay: `|agora − ts| ≤ 5 min` (constante em `real.ts`, não é variável de ambiente; relógio injetável nos testes). `ts` fora da janela, no passado ou no futuro, é inválido.
- RN-7: o `id` do manifest é `data.id` da query string (não do corpo); se o `data.id` for alfanumérico, entra em minúsculas (regra documentada do MP). Corpo e query que discordam (`data.id`, `type`) rejeitam, como no simulado. `type` desconhecido rejeita. O `corpoBruto` NÃO entra no manifest do MP; o JSON parseado só serve à consistência. (Ver dúvida D-2.)
- RN-8: toda chamada HTTP tem timeout de 10 s (`AbortSignal.timeout`), cabeçalho `Authorization: Bearer <token>`, `Content-Type: application/json` nos corpos. `POST` de criação envia `X-Idempotency-Key` (UUID por chamada de `criarAssinatura`) e pode repetir 1 vez após falha de rede/5xx/429 com a MESMA chave. `GET` repete até 2 vezes (espera 200 ms e 400 ms) em 429/5xx/rede. `PUT` não é repetido automaticamente.
- RN-9: `criarAssinatura` mantém a validação comum (`validarCriacaoAssinatura`) antes de qualquer HTTP; envia `preapproval_plan_id` (config), `payer_email`, `external_reference = salaoId`, `back_url = urlRetorno`, `reason` fixo ("Assinatura Agenda Beleza") e `status: "pending"`; sem `card_token_id`. O valor R$ 79,00 e os 30 dias grátis vêm do PLANO do MP, que deve ser criado com `free_trial {frequency:30, frequency_type:"days"}`, `transaction_amount:79`, `currency_id:"BRL"`, `frequency:1`, `frequency_type:"months"` (roteiro no README; o código não os duplica nem os reenvia). Devolve `assinaturaId = id` e `urlCheckout = init_point` (HTTPS, senão `ErroProvedor`).
- RN-10: mapeamento de status do preapproval: `pending`→`pendente`, `authorized`→`autorizada`, `cancelled`→`cancelada`; `paused`, `finished` ou desconhecido→`ErroProvedor` (não inventa estado). `valorCentavos` por `Math.round(transaction_amount × 100)`; datas ISO com offset→`Date` UTC; ausente→`null`.
- RN-11: `consultarPagamento` usa `GET /authorized_payments/{id}`: `status processed` + `payment.status approved`→`aprovado`; `payment.status rejected`/`status recycling`/`cancelled`→`recusado`; `scheduled` ou desconhecido→`ErroProvedor` (a notificação será reentregue; não decide). `assinaturaId = preapproval_id`.
- RN-12: `cancelarAssinatura` = `PUT /preapproval/{id}` `{ status: "cancelled" }`; idempotente: se o MP responde 400/422/409 e um GET mostra `cancelled`, retorna sem erro; um 404 é `RecursoNaoEncontradoNoProvedor`.
- RN-13: `urlAtualizarMeioPagamento` = GET do preapproval e devolve `init_point` (HTTPS); assinatura `cancelled`→`OperacaoInvalidaNoProvedor`; `init_point` ausente→`ErroProvedor`. Sem efeito local.
- RN-14: ids de recurso são validados antes do HTTP (`^[A-Za-z0-9_-]{1,64}$`, senão `RecursoNaoEncontradoNoProvedor`) e passados com `encodeURIComponent`.
- RN-15: o token e o segredo existem só na config em memória do adaptador; nunca em log, erro, `JSON` de teste ou URL.

## 5. Critérios de aceitação (testes de contrato com `node:http` local via `urlBase`, como a D-021)
- CA-1 (issue): Dado o servidor local, quando criar, consultar e cancelar, então o servidor recebe método, caminho (`POST /preapproval`, `GET /preapproval/{id}`, `PUT /preapproval/{id}`), `Authorization: Bearer`, `X-Idempotency-Key` no POST, corpo com `preapproval_plan_id` configurado, `external_reference`, `payer_email`, `back_url`, e o retorno é mapeado (`id`, `init_point`, estado, valor em centavos, datas UTC, `salaoId`).
- CA-1b: Dado `consultarPagamento`, quando o stub devolve `processed/approved`, `rejected` e `scheduled`, então `aprovado`, `recusado` e `ErroProvedor`.
- CA-2 (issue): Dado `x-signature` calculado com o segredo correto e `ts` dentro de 5 min, então `{ valida:true, tipo, recursoId }`; com segredo errado, `v1` alterado, manifest com outro `data.id` ou `x-request-id`, rejeita.
- CA-2b (replay): `ts` 5 min + 1 s no passado e no futuro rejeita; exatamente 5 min aceita (relógio injetado).
- CA-2c (malformado): sem `x-signature`/`x-request-id`/`data.id`, `ts` não numérico, `v1` não hex ou de tamanho errado, `type` desconhecido e corpo discordante retornam `{ valida:false }` sem lançar.
- CA-2d (corpo bruto): a validação independe de `corpoBruto` e de reserialização do corpo (mesmo resultado com `corpoBruto` ausente, presente ou espaçado de outro modo).
- CA-3 (issue): Dado `MP_ADAPTER=real` sem `MP_ACCESS_TOKEN`, quando `validarEnv`/`check-env` roda, então falha nomeando `MP_ACCESS_TOKEN`; idem `MP_WEBHOOK_SECRET` e `MP_PREAPPROVAL_PLAN_ID` (todas ausentes nomeadas juntas, ordenadas); valores vazios contam como ausentes; a saída nunca contém os valores.
- CA-4 (issue): `MP_ADAPTER=real` com `APP_URL=http://…` falha nomeando `APP_URL`; com `https://` e as três variáveis, passa. Com `MP_ADAPTER=simulado`, nada disso é exigido.
- CA-5 (issue): Dado o stub que aceita o PUT (200) mas devolve a data antiga no GET, `adiarProximaCobranca` lança `ProvedorNaoSuportaAdiamento` (`instanceof ErroMercadoPago`, `codigo` `adiamento_nao_suportado`). Com o GET refletindo a data (±60 s), resolve; com PUT 400 de data, lança `ProvedorNaoSuportaAdiamento`; data passada/inválida lança `OperacaoInvalidaNoProvedor` sem HTTP.
- CA-6 (URL de atualização): preapproval `authorized`→devolve o `init_point`; `cancelled`→`OperacaoInvalidaNoProvedor`; sem `init_point` ou `http://`→`ErroProvedor`.
- CA-7 (erros): 404→`RecursoNaoEncontradoNoProvedor`; 400/422→`OperacaoInvalidaNoProvedor`; 401/403/5xx/429, timeout, conexão recusada e corpo não JSON→`ErroProvedor`; nenhuma mensagem/`cause` contém o token, o corpo da resposta ou o segredo (asserção por busca de texto).
- CA-8 (retry/idempotência): GET com 503, 503, 200 resolve (3 requisições); GET com 503 ×3 falha; POST com falha na 1ª tentativa repete com o MESMO `X-Idempotency-Key`; PUT não repete; duas chamadas de `criarAssinatura` usam chaves distintas.
- CA-9 (cancelamento idempotente): PUT 400 + GET `cancelled` resolve; PUT 400 + GET `authorized` lança `OperacaoInvalidaNoProvedor`.
- CA-10 (registry): `criarIntegracoes` com `MP_ADAPTER=real` e config válida devolve o adaptador real (sem `NaoImplementado`); `modos.mercadoPago='real'`; o lint de importação via registry continua passando.
- CA-11 (ids): id com `/`, `..`, espaço ou >64 caracteres→`RecursoNaoEncontradoNoProvedor` sem requisição ao servidor.
- CA-12: `.env.example` declara `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PREAPPROVAL_PLAN_ID` (teste CA-25 da D-003 `chavesDeclaradas`); compose repassa as três; README atualizado (variáveis, roteiro de sandbox, S12, avisos); cobertura ≥ 90%.
- CA-13 (integração D-041): um webhook real assinado (HMAC do segredo configurado) postado em `POST /api/webhooks/mercadopago` com o adaptador real, apontando o `urlBase` ao stub local para o `GET` de consulta, é aceito e processado; com segredo errado, rejeitado (rejeição persistida como já faz a D-041).

## 6. Mapeamento de erros HTTP → porta
| Situação | Erro |
|---|---|
| 404 | `RecursoNaoEncontradoNoProvedor` |
| 400, 409, 422 | `OperacaoInvalidaNoProvedor` (adiar: `ProvedorNaoSuportaAdiamento`) |
| 401, 403 (credencial), 429, 5xx, timeout, rede, JSON inválido, estado desconhecido | `ErroProvedor` (transitório do ponto de vista do chamador; as camadas já tratam `falha_provedor`) |

## 7. Casos limite
- Relógio: `ts` em ms (como o simulado); se o MP enviar em segundos, a janela rejeitaria tudo — ver D-2 (roteiro de sandbox confirma).
- Isolamento entre salões: `external_reference = salaoId` devolvido em `salaoId`; o adaptador não decide o salão (D-041 já cruza vínculo).
- Salão suspenso / cliente anonimizada: não se aplica ao adaptador.
- Entradas inválidas: e-mail/URL/UUID inválidos recusados antes do HTTP; `urlRetorno` http em produção é recusado no startup por `APP_URL` https, não pela porta (a validação comum aceita http).
- Concorrência: webhook em duplicidade é idempotente na D-041; `criarAssinatura` repetida por retry usa a mesma chave.
- Resposta com `transaction_amount` ≠ 79,00: o adaptador devolve o valor lido; quem decide é o domínio (não valida aqui).
- `MP_ACCESS_TOKEN` de teste (prefixo `TEST-`) e de produção: não distingue.

## 8. Dependências
E0.6 (porta), D-040/D-041/D-042/D-044 (consumidores), E9.3 (sandbox, bloqueada por esta). Infra: variáveis em compose e README; URL pública HTTPS e cadastro `<APP_URL>/api/webhooks/mercadopago` no painel do MP (README). Sem rede nos testes.

## 9. Impactos
Env: `ambiente.ts` (`CHAVES` + `lerConfigReal`, sem imports, entra no bundle do check-env), `env.ts` (tipo `ConfigMercadoPagoReal`, `APP_URL` https condicional ao modo), `registry.ts`, `.env.example`, `docker-compose.yml` (DevOps: três variáveis repassadas, sem default secreto), README (remover "ainda recusado", linhas 408, 412, 630, 639, 825, 373), `docker/smoke.sh` e CI inalterados. Dados: nenhum (nenhuma migração; DBA dispensável). Código de produção novo só em `src/server/integrations/mercadopago/` e `port.ts`.

## 10. Dúvidas
Bloqueantes: nenhuma.

Não bloqueantes (suposição adotada; o spike de sandbox confirma):
- D-1 (RISCO ALTO): se `POST /preapproval` com `preapproval_plan_id` e SEM `card_token_id` devolve `init_point` e aceita `external_reference`/`back_url`. A documentação que consegui lembrar indica que, com plano associado, o fluxo usual é redirecionar ao `init_point` do plano ou enviar `card_token_id`; sem plano, `status:"pending"` + `auto_recurring` devolve `init_point`. Suposição: enviar `preapproval_plan_id` + `status:"pending"` conforme a issue (RN-1 exige `MP_PREAPPROVAL_PLAN_ID`). Mitigação: o montador do corpo fica em função pura isolada; fallback sem plano (com `auto_recurring` e `free_trial`) é trocável sem mexer no resto.
- D-2: formato/unidade de `ts` (ms vs s) e se o `id` do manifest é o de `data.id` da query. Suposição: ms, query. Mitigação: aceitar também `ts` em segundos (< 1e11 → ×1000)? Não adotado; registrar no roteiro.
- D-3: se o MP aceita atualizar `next_payment_date` por PUT (restrições conhecidas: pode ser ignorado ou recusado). Coberto por RN-4/CA-5 por desenho (P2).
- D-4: `autorizadaEm` não tem campo equivalente certo; suposição: `date_created` do preapproval quando `authorized`, `null` caso contrário; `canceladaEm` = `last_modified` quando `cancelled`. Os consumidores reais (`maquina-estados.ts`) usam o relógio do evento, não estes campos (grep).
- D-5: `paused` não existe na porta; tratado como erro visível (RN-10).

## 11. Fontes
Sem acesso a ferramentas de web/Context7 nesta execução: nada foi consultado ao vivo. Baseado em conhecimento prévio da documentação oficial do MP (developers.mercadopago.com: "Assinaturas", `POST /preapproval`, `GET/PUT /preapproval/{id}`, `GET /authorized_payments/{id}`, "Notificações Webhooks" com `x-signature`) e no simulado do repositório. Tudo marcado D-1..D-5 é NÃO confirmado; o arquiteto/desenvolvedor deve revalidar com a documentação oficial antes de fixar os campos.
