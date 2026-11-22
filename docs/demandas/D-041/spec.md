# D-041 (E6.2) - Webhooks do Mercado Pago - spec

## 1. Problema (evidencia)
- Nao existe rota de webhook: `src/app/api` so tem `fotos`, `health`, `painel`. Nenhum codigo le/grava `webhook_evento` (grep em `src/server/repos`: nada).
- JA existem: tabela `webhook_evento` (`prisma/schema.prisma:~586`: provedor, chave_dedupe, tipo, recurso_id, payload jsonb, origem_valida, resultado enum `recebido|processado|ignorado|rejeitado|erro`, salao_id, erro, recebido_em, processado_em) e o indice `webhook_evento_dedupe_uniq (provedor, chave_dedupe) WHERE origem_valida` (migration `20261118000200_restricoes_sql`); `assinatura_transicao.evento_id` -> `webhook_evento`; `assinatura_pagamento.pagamento_id UNIQUE`.
- Porta: `validarWebhook(n: {cabecalhos, consulta, corpo parseado})` devolve `{valida:false}` ou `{valida:true, tipo:'assinatura'|'pagamento', recursoId}` e nunca lanca; `consultarAssinatura(id)`, `consultarPagamento(id)` (-> `{assinaturaId, status aprovado|recusado, valorCentavos, ocorridoEm}`) e erros tipados (`RecursoNaoEncontradoNoProvedor`, `ErroProvedor`). Simulado: `webhook-simulado.ts` (`notificacaoSimulada`, `x-request-id` + `x-signature ts=,v1=` HMAC; segredo fixo; o corpo NAO traz status, so `type`/`action`/`data.id`). Real: stub `NaoImplementado` (E6.6).
- `aplicarEventoAssinatura(ctx, ev, agora, {r?, assinaturaId?, log?})` (`src/server/assinatura/servico.ts:26`): eventos `teste_iniciado | cobranca_aprovada{pagamentoId,valorCentavos,pagoEm} | cobranca_falhou{pagamentoId?,valorCentavos?,falhouEm} | cancelamento | prazo`; trava `assinatura FOR UPDATE`, idempotente por `pagamento_id`; nao verifica papel. `processarAutorizada`/`consultarRetorno` (`retorno.ts`) aplicam `teste_iniciado` com CAS em `provedor_assinatura_id`.
- Proxy so intercepta `/painel`, `/admin` (`src/proxy.ts:50`): `/api/webhooks/**` ja fica fora (sem cookie/CSRF).

## 2. Objetivo
Receber notificacoes do MP com origem validada, registrar todas, dedupe, consultar o provedor e aplicar o efeito uma unica vez, sem nunca bloquear por estado do salao.

## 3. Escopo
Entra: `POST /api/webhooks/mercadopago`; `src/server/assinatura/webhook.ts`; repo de sistema para `webhook_evento` (pre-contexto) e busca de assinatura por `provedor_assinatura_id`; testes; README (secao assinatura/MP) e CLAUDE.md.
Fora: tela de eventos (E8.3), adaptador real/segredo real/`MP_WEBHOOK_SECRET` (E6.6), tela da assinatura (E6.5), bloqueio por estado (E6.4), reenvio manual, job de reprocesso. Nada de "Fora da primeira versao" do PLAN e tocado (nenhum pagamento de cliente, nenhum dado de cartao).

## 4. Regras de negocio
- RN-1 (issue): origem invalida -> grava `origem_valida=false`, `resultado=rejeitado`, sem efeito; resposta 401 (assinatura) ou 400 (corpo >limite/JSON invalido; 413 acima do limite, ver RN-9).
- RN-2 (issue): persistir ANTES de consultar o provedor ou aplicar; so IDs no payload (RN-10).
- RN-3 (issue): chave de dedupe = `x-request-id` (cabecalho assinado; presente em toda notificacao valida, pois o simulado o exige); fallback do `id` do corpo nao e usado para evento valido. Para evento invalido sem cabecalho: SHA-256 do corpo (coluna e NOT NULL; invalido nao deduplica). Dedupe so entre `origem_valida=true` (INSERT ... ON CONFLICT (provedor, chave_dedupe) WHERE origem_valida DO NOTHING; sem capturar 23505).
- RN-4 (issue): efeito vem do estado CONSULTADO (nunca do payload). Pagamento: `consultarPagamento(recursoId)` -> `aprovado` => `cobranca_aprovada{pagamentoId, valorCentavos, pagoEm=ocorridoEm}`; `recusado` => `cobranca_falhou{pagamentoId, valorCentavos, falhouEm=ocorridoEm}`. Assinatura: `consultarAssinatura` -> `autorizada` => `teste_iniciado{iniciadoEm=autorizadaEm}` (mesmo CAS/`processarAutorizada` de D-040; so se o id consultado for o `provedor_assinatura_id` da assinatura vigente do salao); `cancelada` => `cancelamento`; `pendente` => ignorado.
- RN-5 (issue): assinatura desconhecida e registrada e ignorada: id sem `assinatura` local com esse `provedor_assinatura_id` (inclui assinatura antiga trocada em D-040, encerrada, ou `RecursoNaoEncontradoNoProvedor`) -> `resultado=ignorado`, 200, `erro` com codigo fechado (`assinatura_desconhecida`, `recurso_inexistente`). Divergencia `p.salaoId` x `assinatura.salao_id` -> ignorado `vinculo_invalido`, log com ids.
- RN-6 (issue): idempotencia por recurso, delegada a `aplicarEventoAssinatura` (`pagamento_id UNIQUE` + `FOR UPDATE`); nao reimplementar.
- RN-7 Resolucao do salao: busca de sistema por `provedor_assinatura_id` (sem tenant; fora de `src/server/repos` e proibido); `salao_id` do evento gravado ao resolver; `ctx = contextoDeSistema(salaoId, 'webhook-mp')`. O webhook NUNCA e bloqueado por salao suspenso/estado da assinatura (D-038: e do sistema). Sem papel/auditoria de super admin.
- RN-8 Sincrono (decisao): processar na propria requisicao depois de persistir (sem pg-boss): a consulta + 1 transacao curta cabem no prazo do MP; ha reentrega nativa do MP. Transacao de `aplicarEventoAssinatura` NUNCA envolve a chamada ao provedor (consulta fora de transacao, como em D-040 RN-4). Resposta: 200 quando `processado`/`ignorado`/repetido; falha transitoria do provedor (`ErroProvedor` ou desconhecido) ou `ocupada` -> evento `resultado=erro` e resposta 503 (+`Retry-After`) para o MP reenviar. Reentrega com a mesma chave sobre linha `erro` (ou `recebido` ha mais de 2 min, processo caido) REPROCESSA: reivindica por UPDATE condicional (CAS em `resultado`), depois consulta/aplica; linha `processado`/`ignorado` -> 200 sem reaplicar; `recebido` recente (outra entrega em andamento) -> 200 sem processar.
- RN-9 Limite: corpo <= 16 KiB contado em streaming (acima: 413, sem parsear nem gravar o corpo; grava so metadados invalidos). Rate limit global de invalidos (ex.: 120 por janela fixa de 1 min em `rate_limit_janela`, chave constante): acima, responde 401 sem persistir linha (so log com contagem). Eventos validos nao tem limite. Sem cookie, sem checagem de `Origin`.
- RN-10 Sanitizacao: `payload` guarda so lista branca (`id`, `type`, `action`, `live_mode`, `data.id`, `date_created`), strings truncadas a 200 e qualquer sequencia de 13-19 digitos trocada por `[redigido]` (D-040 CA-4); cabecalhos e query nao sao gravados (exceto `x-request-id` como chave). Resposta do provedor nunca gravada. `recurso_id` so se casar `^[A-Za-z0-9_-]{1,64}$`.
- RN-11 Resposta ao MP nunca vaza o motivo (corpos fixos `{ok:true}`/`{erro:'nao_autorizado'}`).
- RN-12 Retencao: v1 sem expurgo (decisao registrada); volume limitado por RN-9/RN-10; E8.3 decide a politica.

## 5. Criterios de aceitacao
- CA-1 Dado webhook com assinatura invalida, quando recebido, entao 401, 1 linha `origem_valida=false, resultado=rejeitado, salao_id NULL`, e `assinatura`/`assinatura_transicao`/`assinatura_pagamento` inalterados (e o provedor nao foi consultado).
- CA-2 Dado webhook valido de pagamento aprovado, quando recebido 3 vezes (sequencial e 3 em paralelo, mesma chave), entao 200 nas 3, 1 linha `processado`, 1 `assinatura_pagamento`, `periodo_pago_ate` estendido uma vez, 1 transicao.
- CA-3 Dado payload "aprovado"/`action: payment.updated` mas `consultarPagamento` = recusado, entao vale o consultado (`cobranca_falhou`), nunca `cobranca_aprovada`.
- CA-4 Dado qualquer webhook (valido, invalido, ignorado, erro), entao ha linha com `recebido_em`, `tipo`, `payload`, `resultado` e `processado_em` (quando terminal); nenhum `payload`/`erro` contem 13-19 digitos seguidos (teste com corpo malicioso com 16 digitos).
- CA-5 Dado evento forjado (invalido) com a mesma `x-request-id` de um legitimo recebido depois, entao o legitimo e persistido e processado normalmente (dedupe so entre validos).
- CA-6 Dadas duas notificacoes distintas (request-ids diferentes) do mesmo `pagamento_id` aprovado, entao 2 eventos `processado` (o 2o com motivo `pagamento_duplicado`) e periodo estendido uma vez.
- CA-7 Dado id de assinatura desconhecido/antiga trocada ou inexistente no provedor, entao 200, `ignorado`, sem efeito.
- CA-8 Dado `ErroProvedor` na consulta, entao 503, linha `erro`, sem efeito; a reentrega com a mesma chave, com o provedor ok, reprocessa a mesma linha (nao cria outra) e aplica uma vez.
- CA-9 Dado salao suspenso (assinatura `suspensa`/`em_carencia`), quando chega pagamento aprovado, entao e aplicado (regulariza) conforme `aplicarEventoAssinatura`; o webhook nao consulta politica de operacao.
- CA-10 Dado corpo > 16 KiB ou JSON invalido, entao 413/400 sem lancar e sem consultar o provedor; corpo grande nunca vai inteiro ao banco.
- CA-11 Concorrencia: webhook x retorno (D-040) x job de prazo sobre a mesma assinatura, e 10 entregas distintas em paralelo, sem 5xx por 23505, sem impasse (`40P01`), uma unica extensao de periodo.
- CA-12 Unitarios: extracao da chave de dedupe (cabecalho ausente/vazio/com espacos/muito longo >128 -> invalido), sanitizador (digitos, truncamento, lista branca), mapeamento consultado -> evento, e rota sem acesso a `repos`/Prisma.
- CA-13 Estatico: rota fora do matcher do proxy; unica importacao do segredo e da validacao via `integracoes().mercadoPago`.

## 6. Casos limite
Fuso: tudo UTC; `pagoEm=ocorridoEm` do provedor (nao `agora`). Notificacao fora de ordem (pagamento antes da autorizacao): resolvida pelo estado consultado e pela maquina (D-037). Pagamento de assinatura `cancelada`/`encerrada`: registrado sem efeito (D-037 S-3). `valorCentavos` divergente de R$ 79: aplica e loga `assinatura.valor_divergente`. Isolamento: salao resolvido so pelo vinculo `provedor_assinatura_id`; vinculo de outro salao -> `vinculo_invalido`. Cliente anonimizada: n/a. Telefone: n/a. Replay antigo de notificacao valida: dedupe por chave e idempotencia por recurso; sem janela de `ts` (simulado nao tem; E6.6 decide). Tipos de notificacao desconhecidos (ex.: `payment` de outro produto): `validarWebhook` devolve invalido -> 401.

## 7. Dependencias
E6.1 (D-040), E6.3 (D-037), porta MP (E0.6). Bloqueia E8.3. E6.6 plugara o segredo real.

## 8. Impactos
Dados: nenhuma migracao necessaria (tabela, enum, indice e FKs prontos); DBA so para revisar a reivindicacao por CAS e o indice (consultar `recebido`/`erro` por chave usa o indice parcial; para a linha rejeitada nao ha busca). Infra/CI: nenhum. Env: nenhuma variavel nova nesta demanda (segredo do simulado fixo; `MP_WEBHOOK_SECRET` e da E6.6). README: documentar URL do webhook a cadastrar no MP, codigos de resposta, e o comando de estabilidade (3 entregas em paralelo). CLAUDE.md: registrar D-041.

## 9. Duvidas
Bloqueantes: nenhuma.
Nao bloqueantes (suposicoes): (S-1) sincrono, sem fila, 503 para reentrega do MP; (S-2) chave = `x-request-id`; (S-3) limite 16 KiB e 120 invalidos/min globais sao valores de partida, ajustaveis no design; (S-4) a porta recebe corpo parseado: se a E6.6 precisar do corpo bruto para o HMAC real, ela estende a porta; aqui o handler le o corpo em texto (limite) e o parseia; (S-5) sem retencao/expurgo na v1; (S-6) `teste_iniciado` por webhook reutiliza `processarAutorizada`.
Riscos: R-1 `recebido` preso se o processo cai (mitigado: reivindicacao apos 2 min); R-2 crescimento da tabela por invalidos (RN-9); R-3 cegueira do corpo bruto no HMAC real (S-4).
