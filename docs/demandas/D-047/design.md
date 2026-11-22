# D-047 (E7.2) — Adaptador real do WhatsApp Cloud API: design

## 1. Resumo e confirmação na documentação oficial

Solução: `WHATSAPP_ADAPTER=real` constrói uma `PortaWhatsApp` completa em `src/server/integrations/whatsapp/`, no padrão da D-046: tudo que depende de formato do provedor fica em UM módulo puro (`mapeamento.ts`); `http.ts` com `fetch` injetável e timeout; `real.ts` compõe. Sem migração, sem dependência nova (`fetch` nativo; SDK da Meta descartado: esconde corpo/timeout e dificulta o servidor local). `provedor_mensagem_id` já existe em `mensagem_tentativa`/`mensagem` e `envio.ts:130/159` já grava `r.provedorMensagemId`: o contrato da porta NÃO muda. DBA dispensado (sem tabela, coluna ou índice).

Consultas de 2026-11-22. Atenção: a documentação nova da Meta (`developers.facebook.com/documentation/business-messaging/whatsapp/...`) não pôde ser lida por inteiro (a página de templates mudou de endereço e uma busca foi bloqueada); o que consta como "terceiros" vem de fóruns/guias de outros provedores e vale como NÃO CONFIRMADO oficial.

| Ponto | Veredito | Fonte |
|---|---|---|
| `POST https://graph.facebook.com/{versão}/{phone-number-id}/messages` | CONFIRMADO | `developers.facebook.com/docs/whatsapp/cloud-api/reference/messages` |
| Campos `messaging_product`, `recipient_type` (`individual`/`group`), `to`, `type` obrigatórios | CONFIRMADO | idem |
| Resposta com `messages[].id` (string), `contacts[]` (`input`, `wa_id`), `messaging_product`; `message_status` opcional (`accepted`, `held_for_quality_assessment`, `paused`) | CONFIRMADO | idem |
| `type:"template"`, `template.name`, `language.code`, `components[{type:"body",parameters:[{type:"text",text}]}]` | NÃO CONFIRMADO na doc oficial lida (seção vazia); CONFIRMADO por exemplos de terceiros (Telnyx, Rocket.Chat) e pela guia "Send message templates" (que só diz "o número de strings deve igualar o de parâmetros do modelo") | `developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates` (movida para `.../documentation/business-messaging/whatsapp/templates/overview`) |
| `to` com ou sem `+` | CONFIRMADO que `+`, `-`, `(`, `)` e espaços são aceitos em envio (guia de números de telefone); a página de mensagens não diz. Decisão: enviar SÓ DÍGITOS (forma sem ambiguidade, e o `wa_id` volta assim) | `developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers` |
| Parâmetro de texto sem `\n`, `\t` e sem mais de 4 espaços seguidos | NÃO CONFIRMADO oficialmente; consistente em vários terceiros (Clickatell, Make, Pabbly: erro "Param text cannot have new-line/tab characters", código reportado 131009 ou 100, não 132012). Mantida a normalização | busca |
| Limite de 1024 caracteres por parâmetro | NÃO CONFIRMADO (nenhuma fonte; o corpo de template tem limite próprio). Mantido como constante defensiva em `mapeamento.ts` | busca |
| Parâmetro vazio é rejeitado (`132012`) | NÃO CONFIRMADO (132012 = "valores de parâmetro formatados incorretamente"; vazio→`-` fica como defesa) | `.../support/error-codes` |
| Ausência de chave de idempotência em `/messages` | CONFIRMADO só por ausência (nenhum campo/cabeçalho documentado; a página de mensagens não menciona) | referência de mensagens |
| Códigos (significado): 0, 1, 2, 4, 10, 100, 190, 200-299, 368, 80007, 130429, 131000, 131005, 131008, 131009, 131016, 131021, 131026, 131031, 131037, 131042, 131045, 131047, 131048, 131049, 131051, 131056, 131057, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133004, 135000 | CONFIRMADOS (significado) | `https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes` (e `.../docs/whatsapp/cloud-api/support/error-codes`) |
| `131030` | REFUTADO como "destinatário recusado genérico": a página oficial NÃO o lista; só fonte secundária (busca, citando a referência da Meta) diz que ocorre só com número de teste público (destinatário fora da lista permitida). Continua permanente `destinatario_recusado` | busca |
| `131047` ("mais de 24 h desde a última resposta") | CONFIRMADO o significado; NÃO se aplica a template (template é o remédio). Permanente, improvável | `.../support/error-codes` |
| HTTP associado a cada código | NÃO CONFIRMADO (a página só dá HTTP para a API de Marketing: 100 e 131009 = 400). A classificação usa `error.code` primeiro; o HTTP só é reserva | idem |
| Formato do erro `{error:{message,type,code,error_data{details},fbtrace_id}}`; `error_subcode` descontinuado (v16+) | CONFIRMADO | idem |
| HTTP 429 / 5xx | NÃO CONFIRMADO nominalmente; tratados pelo padrão HTTP (temporário) | — |
| Versão da Graph API | v26.0 é a mais recente (29/07/2026); v23.0 vigente até 08/10/2027, v24.0 até 18/02/2028, v25.0 até 29/07/2028, v20 removida em 24/09/2026 | `developers.facebook.com/docs/graph-api/changelog/versions` e `.../blog/post/2026/07/29/introducing-graph-api-v26-and-marketing-api-v26/` |

Decisões de desenho:
1. **Versão padrão = `v25.0`** (constante única `VERSAO_API_PADRAO` em `ambiente.ts`), não `v23.0` da spec: ambas vigentes; v25.0 vive até 07/2028 (v23.0 morre em 10/2027, o que forçaria troca no meio da vida do produto). Nenhuma está validada contra a Meta; o operador sobrescreve por `WHATSAPP_API_VERSION`. S-1 resolvida assim.
2. Classificação por `error.code` (tabela em §3.1); HTTP só quando não há `error.code` legível. Tudo isolado em `mapeamento.ts`.
3. 401/403/190/0/10/200-299/131005/368/131031/131037/131042/131045 = TEMPORÁRIO `configuracao_invalida` (falha do operador, não da mensagem; ao esgotar vira `falhou`, reenviável pelo admin, D-045). 132001/132015/132016 = permanente (spec §4.1 mantida).
4. **Resultado incerto** (timeout/queda depois do envio, 2xx sem id/JSON ilegível): temporário, o pipeline reenvia; duplicidade rara ACEITA (R-1/R-2). O adaptador NUNCA retenta sozinho (zero repetição interna, nem em 429). `reserva:tipo:revisao` não vai à Meta (não há campo) e não entra no corpo; `chaveIdempotencia` só é validada (não vazia).
5. `redirect: 'manual'` (a D-046 usa `'error'`; aqui `manual` para classificar 3xx como `resposta_inesperada` temporário sem lançar `TypeError` opaco); o token nunca segue a outro host.
6. 2xx com `messages[0].id` string não vazia ⇒ sucesso (ignora `message_status`; `held_for_quality_assessment`/`paused` continuam "aceito": o id existe).

Alternativas descartadas: SDK/biblioteca de WhatsApp (dependência nova, sem ganho); permanente para 401/403 (a mensagem não é defeituosa e o pipeline não reenvia permanentes); retentativa interna (agravaria duplicidade sem idempotência).

## 2. Componentes (`src/server/integrations/whatsapp/`, salvo indicação)

| Arquivo | Conteúdo |
|---|---|
| `ambiente.ts` (reescreve; sem imports, entra no bundle do check-env) | `SELETOR`; `CHAVES = ['WHATSAPP_ACCESS_TOKEN','WHATSAPP_API_VERSION','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_TEMPLATE_CONFIRMACAO','WHATSAPP_TEMPLATE_CANCELAMENTO','WHATSAPP_TEMPLATE_CONVITE_AVALIACAO','WHATSAPP_TEMPLATE_IDIOMA','WHATSAPP_TEMPLATE_REMARCACAO']` (as 9 variáveis do CA-13 menos o seletor = 8; o teste `documentacao.test.ts` concatena `SELETOR` + `CHAVES`); `VERSAO_API_PADRAO='v25.0'`, `IDIOMA_PADRAO='pt_BR'`; tipo `ConfigWhatsAppReal = { accessToken, phoneNumberId, versaoApi, idioma, modelos: Record<ModeloWhatsApp,string> }` (a chave do mapa é o literal da porta, sem importar `port.ts`: usa union local idêntica; um teste compara com `MODELOS_WHATSAPP`); `lerConfigReal(fonte)` (assinatura como a do MP): `trim`, vazio = ausente, token/phone id/4 modelos obrigatórios, `WHATSAPP_PHONE_NUMBER_ID` `^\d+$` (e ≤ 32), modelos `^[a-z0-9_]{1,512}$`, versão `^v\d+\.\d+$`, idioma `^[a-z]{2,3}(_[A-Z]{2})?$` (padrão pt_BR); devolve `{ok:false, variaveis}` ordenadas, só nomes. A recusa incondicional some. `env.ts` NÃO muda de lógica (já passa `fonte` a `lerConfigReal` e tipa por `ConfigWhatsAppReal`). Confirmar no dev que `env.ts` chama `lerConfigReal(fonte)` com a fonte já sem vazios (o MP depende disso). |
| `mapeamento.ts` (novo, PURO: sem rede, sem env, sem imports de `port.ts` além de tipos) | `ORDEM_PARAMETROS` (RN-7), `montarCorpo(config, e)` → `{ corpo, para }`; `normalizarParametro(texto)` (substitui `\r\n\t`, colapsa espaços, `trim`, vazio→`-`, trunca em 1024 code points com `…` sem partir surrogate); `somenteDigitos(e164)`; `classificarResposta({status, texto})` → `{ tipo:'sucesso', id } | { tipo:'temporario', codigo } | { tipo:'permanente', codigo }`; tabela `CODIGOS_META`; lista fechada `CODIGOS_ERRO_WHATSAPP`. Único lugar com nomes de campos/códigos da Meta. Parâmetro ausente no objeto ⇒ `ErroEnvioPermanente('parametro_ausente')`. |
| `http.ts` (novo) | `criarClienteHttp({ urlBase='https://graph.facebook.com', token, fetchImpl=fetch, timeoutMs=TIMEOUT_PADRAO_MS })` → `postar(caminho, corpo)` devolve `{status, texto}`; `AbortSignal.timeout`; cabeçalhos `Authorization: Bearer`, `Content-Type`, `Accept`; `redirect:'manual'`; falha de rede/abort ⇒ erro fixo sem `cause` nem URL. `TIMEOUT_PADRAO_MS = 10_000`. Resposta lida como texto com teto (64 KiB). |
| `real.ts` (reescreve) | `criarWhatsAppReal(config: ConfigWhatsAppReal, opcoes?: { urlBase?, fetchImpl?, timeoutMs? }): PortaWhatsApp`. Fluxo: `validarEnvioModelo` (da porta; falha ⇒ lança ANTES de qualquer HTTP) → `montarCorpo` → `postar` → `classificarResposta` → devolve `{provedorMensagemId}` ou lança `ErroEnvioTemporario`/`ErroEnvioPermanente`. Sem estado mutável. Nenhum log; nada do corpo, token ou link em erro. |
| `registry.ts` (edita) | `selecionarWhatsApp(c: ConfigIntegracao<ConfigWhatsAppReal>)`: real → `criarWhatsAppReal(c.config)`, simulado → `criarWhatsAppSimulado()`; `criarIntegracoes` passa `whatsapp` inteiro (como o MP). `nao-implementado.ts`: só ajustar o comentário (o stub continua usado por outros). |
| `src/worker/handlers/whatsapp-reserva.ts` | sem mudança (usa `integracoes().whatsapp`). |
| `docker-compose.yml` | sem mudança: app e worker usam `env_file` (`.env`) pela âncora `*env-app`, e as `WHATSAPP_*` chegam por ele; o dev CONFERE que o serviço `worker` herda a âncora e só ajusta se não herdar. DevOps dispensado (o desenvolvedor faz env/README). |

## 3. Interfaces

Porta inalterada. Corpo enviado (CA-1/CA-2): `{ messaging_product:"whatsapp", recipient_type:"individual", to:"5511987654321", type:"template", template:{ name, language:{ code }, components:[{ type:"body", parameters:[{ type:"text", text }, …] }] } }`. Ordem: confirmação/remarcação `salao, servicos, profissional, data, horario`; cancelamento `salao, servicos, data, horario`; convite `salao, link`. Chaves extras em `parametros` são ignoradas.

### 3.1 Tabela de erros (em `mapeamento.ts`; ordem de avaliação)
1. Rede/DNS/recusa/timeout/abort (de `http.ts`): temporário `rede` / `timeout`.
2. `error.code` numérico legível (corpo JSON; só esse inteiro é lido): 
   - `limite_de_taxa` (temp): 4, 80007, 130429, 131048, 131056.
   - `provedor_indisponivel` (temp): 1, 2, 131000, 131016, 131057, 133004.
   - `configuracao_invalida` (temp): 0, 10, 190, 200-299, 131005, 368, 131031, 131037, 131042, 131045.
   - `numero_invalido` (perm): 131026. `destinatario_recusado` (perm): 131030, 131021. `nao_entregue` (perm): 131049, 130472.
   - `modelo_invalido` (perm): 132001, 132015, 132016, 132007. `parametros_invalidos` (perm): 132000, 132005, 132012, 131008, 131009.
   - `requisicao_invalida` (perm): 100, 131047, 131051, 135000 e qualquer outro código em resposta 4xx.
3. Sem `error.code` legível: 5xx ⇒ temp `provedor_indisponivel`; 429 ⇒ temp `limite_de_taxa`; 401/403 ⇒ temp `configuracao_invalida`; outro 4xx ⇒ perm `requisicao_invalida`; 3xx e demais ⇒ temp `resposta_inesperada`.
4. 5xx e 429 prevalecem sobre `error.code` (o HTTP de infraestrutura vence; HTTP 5xx com 190 é raríssimo). 2xx: id string não vazia ⇒ sucesso; senão temp `resposta_invalida`.
Todos os `codigo` casam `^[a-z0-9_]+$` (exigência de `codigoDe`); teste garante a lista fechada. `CODIGOS_ERRO_WHATSAPP` é a lista documentada no README e em `docs/whatsapp-templates.md`.

## 4. Dados
Nenhum impacto. DBA dispensado: `provedor_mensagem_id` e `erro_codigo` já existem (D-024).

## 5. Infraestrutura
`.env.example` ganha as 9 variáveis (token vazio como credencial; versão/idioma comentados com o padrão); sem container novo; CI inalterado (os testes de contrato usam `node:http` local, sem rede externa). `check-env` e o worker recusam o modo real nomeando as faltantes (via `env.ts`). DevOps dispensado.

## 6. Verificação das invariantes
- Escopo por salão: não se aplica ao adaptador (credencial única e central, sem estado por salão; o pipeline D-024 já escopa).
- Exclusion constraint / UTC-fuso: não se aplica (datas já chegam formatadas no fuso do salão).
- Adaptadores: ATENDIDA — real só obtido por `registry.ts` (lint existente); `ambiente.ts` sem imports.
- Soft delete/anonimização: o pipeline filtra anonimizadas antes da porta; o adaptador não guarda PII (sem log).
- Salão suspenso: cancelamento segue enviado; adaptador indiferente.
- Idempotência de mensagens: pipeline D-024 (`singletonKey`); adaptador sem retentativa; duplicidade em resultado incerto aceita e documentada.
- Webhooks: não se aplica (webhook de status fora do escopo).
- Auditoria do super admin: não se aplica.
- Segredos: token e link só em memória; erros usam classes fixas; teste com sentinela (CA-8).

## 7. Riscos e decisões
R-1/R-2 duplicidade rara (aceita). R-3 depreciação da versão: padrão v25.0 até 07/2028, variável sobrescreve. R-4 nunca validado contra a Meta real: pendências de validação (E9.3) no README: formato exato do corpo de template, regra de parâmetros (newline/tab/4 espaços), limite de 1024, HTTP por código, 131030/131047 com template, `message_status`, versão padrão, `to` só dígitos, categoria UTILITY do convite (pode virar MARKETING). R-5 mapeamento por documentação: concentrado em `mapeamento.ts`. R-6 `131047` e `132012` com sinal conflitante nas fontes: mapeados, revisáveis em um ponto.

## 8. Estratégia de testes
- Unitários (Vitest, sem banco): `mapeamento.test.ts` (corpo dos 4 modelos, CA-1/CA-2; normalização; `-` para vazio; truncamento sem partir surrogate; tabela de erros completa CA-4/CA-5; códigos de lista fechada); `ambiente.test.ts` (CA-9/CA-10, sem imports); `http.test.ts` e `real.test.ts` com servidor `node:http` local: cabeçalhos/URL/`to` só dígitos (CA-1), id (CA-3), 500/502/503/429/conexão recusada/131026/132001/132000/401+190 (CA-4/CA-5), timeout com servidor mudo em ≤ T+margem e guarda `TIMEOUT_PADRAO_MS < 25_000` (CA-6), entrada inválida sem tocar o servidor (CA-7), sentinelas de token/link em message/codigo/stack/console (CA-8), 3xx não seguido, zero retentativa (servidor conta 1 requisição).
- Atualizados (afirmavam a recusa): `src/server/env.test.ts` (:182, :216-229), `src/server/check-env.test.ts` (:67), `src/server/integrations/registry.test.ts` (:150-203, :275), `src/worker/iniciar.test.ts` (:334), `tests/integration/integracoes/documentacao.test.ts` (:136-160, inclui `CHAVES` na lista de variáveis citadas), `src/server/integrations/whatsapp/ambiente.test.ts` e `real.test.ts` (reescritos), `src/scripts/check-env.test.ts` se necessário.
- Integração com PostgreSQL real (CA-12): `tests/integration/integracoes/whatsapp-real.test.ts`: `enviarMensagem` com o real contra stub HTTP: 5xx ⇒ `pendente`; 131026 ⇒ `falhou` sem retentativa; sucesso ⇒ `enviada` com o id na tentativa.
- Playwright: nenhum (sem UI). Cobertura ≥ 90% mantida: todo arquivo novo tem teste direto; sem exclusões.

## 9. Tarefas (responsável: desenvolvedor)

Paralelas: T-1, T-2 (sem arquivos em comum). T-3 depende de T-1 e T-2. T-4 depende de T-1 (códigos/lista) e T-2 (nomes), pode rodar em paralelo a T-3.

- **T-1 — `mapeamento.ts` puro.** Posse: `src/server/integrations/whatsapp/mapeamento.ts`, `mapeamento.test.ts`. Entrega: §2/§3.1. Conclusão: CA-2, CA-4/5 (parte pura) e CA-8 (sem vazamento no módulo) verdes; unitários em `TZ=UTC` e `America/Sao_Paulo`.
- **T-2 — `ambiente.ts` + testes de startup.** Posse: `whatsapp/ambiente.ts`, `whatsapp/ambiente.test.ts`, `src/server/env.test.ts`, `src/server/check-env.test.ts`, `src/scripts/check-env.test.ts`, `src/worker/iniciar.test.ts`. Conclusão: CA-9 (check-env e worker nomeiam todas as faltantes juntas, sem valores; tudo preenchido ⇒ `whatsapp=real`) e CA-10; arquivo sem imports.
- **T-3 — `http.ts`, `real.ts`, registro e integração.** Posse: `whatsapp/http.ts`, `http.test.ts`, `real.ts`, `real.test.ts`, `src/server/integrations/registry.ts`, `registry.test.ts`, `nao-implementado.ts` (comentário), `tests/integration/integracoes/whatsapp-real.test.ts`. Conclusão: CA-1, 3, 4, 5, 6, 7, 8, 11, 12.
- **T-4 — Documentação e exemplo.** Posse: `.env.example`, `README.md` (linha ~409/412/414/540/777/850: tabela de adaptadores, "Credenciais para os serviços reais", pendências de validação da Meta com as confirmações/NÃO CONFIRMADO desta §1, lista de `codigo`), `docs/whatsapp-templates.md` (4 textos da spec §11, UTILITY, pt_BR, exemplos de valores, ordem das variáveis, nomes sugeridos), `tests/integration/integracoes/documentacao.test.ts`. Conclusão: CA-13 e CA-9 (texto) ; `documentacao.test.ts` verde; README sem "recusado na inicialização" para o WhatsApp. O desenvolvedor também confere `docker-compose.yml` (sem mudança esperada) e `e2e/suporte/ambiente.ts` (continua simulado).
- Gate final (CA-14): lint, typecheck, build, `npm run test:coverage` ≥ 90%, `sh docker/smoke.sh` inalterado. O líder atualiza a linha do projeto em `CLAUDE.md` ao encerrar.
