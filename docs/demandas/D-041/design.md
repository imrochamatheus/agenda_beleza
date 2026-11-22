# D-041 (E6.2) - Webhooks do Mercado Pago - design

Web-designer: dispensado (sem UI). DBA: dispensado (sem migracao; tabela, enum, indice parcial e FKs prontos; o CAS usa PK; a busca por chave usa `webhook_evento_dedupe_uniq` e a busca de assinatura usa o UNIQUE de `provedor_assinatura_id`). DevOps: dispensado (sem env, container ou CI novo; a CI ja roda `npm test`).

## 1. Solucao e alternativas
Rota `POST /api/webhooks/mercadopago` fina -> `tratarWebhook(request, deps)` (`src/server/assinatura/webhook-http.ts`, le o corpo limitado em streaming, monta a notificacao) -> servico `src/server/assinatura/webhook.ts` (orquestracao) + decisao pura `webhook-decisao.ts` (chave, sanitizacao, mapeamento). Sincrono (RN-8).
Descartadas: (a) fila pg-boss: sem ganho, o MP ja reentrega e a consulta + 1 transacao curta cabem no prazo; (b) dedupe por `id` do corpo: nao assinado; (c) captura de 23505: proibido, usa `ON CONFLICT ... WHERE origem_valida DO NOTHING`; (d) job de reprocesso: fora de escopo, vale a reentrega do MP + reivindicacao de `recebido` > 2 min.

## 2. Componentes (posse na secao 9)
- `src/app/api/webhooks/mercadopago/route.ts`: `POST`; `GET/HEAD/PUT/PATCH/DELETE` = 405. `dynamic='force-dynamic'`, `runtime='nodejs'`. Nao importa `repos`/Prisma (CA-12). Fora do matcher do proxy (nada a editar).
- `src/server/assinatura/webhook-decisao.ts` (puro, sem I/O): `extrairChave`, `sanitizarPayload`, `reconhecerRecurso`, `mapearConsultado`.
- `src/server/assinatura/webhook.ts`: `receberWebhook(entrada, agora, deps)`.
- `src/server/assinatura/webhook-http.ts`: leitura de corpo (reaproveita o padrao de contagem em streaming de `fotos/envio-http.ts`, sem importar dele se acoplar; extrair funcao comum so se ja existir exportada), mapeia resultado -> `Response`.
- `src/server/repos/webhook.ts`: `RepoWebhookSistema` (pre-contexto, como `rate-limit.ts`/`cadastro.ts`; so repos importam Prisma). Registrado em `repos/index.ts` como `repoWebhookSistema()` (padrao de `repoAssinaturaSistema`), nao dentro de `Repos` (que e tenant).
- `src/server/repos/assinatura.ts`: acrescenta a `RepoAssinaturaSistema` o metodo `buscarPorProvedor(provedorId): {id, salaoId, estado} | null` (SELECT unico, por `provedor_assinatura_id`, sem filtro de estado; "antiga trocada" ja nao casa pois D-040 sobrescreve o id).

## 3. Interfaces
Porta (contrato que serve ao real sem implementa-lo): `NotificacaoWebhook` ganha o campo opcional `corpoBruto?: string` (texto exato recebido, ate 16 KiB). O handler SEMPRE o preenche; o simulado o ignora; o real (E6.6) o usa se o HMAC exigir. `corpo` continua o JSON parseado (ou `undefined` se invalido: a porta nunca lanca). Alteracao minima e compativel em `src/server/integrations/mercadopago/port.ts` (campo opcional); testes do simulado inalterados. O segredo nunca sai de `integracoes().mercadoPago` (CA-13).

```ts
type EntradaWebhook = { cabecalhos: Record<string,string>; consulta: Record<string,string>; corpoBruto: string | null /* null = acima do limite */ ; jsonInvalido?: boolean };
type RespostaWebhook = { status: 200 | 400 | 401 | 413 | 503; corpo: {ok:true}|{erro:'nao_autorizado'|'invalido'|'indisponivel'}; retryAfter?: number };
receberWebhook(e: EntradaWebhook, agora: Date, deps?: { mp?: PortaMercadoPago; log?: ...; limiteInvalidos?: number }): Promise<RespostaWebhook>
```
Respostas: invalido -> 401 `{erro:'nao_autorizado'}`; corpo > 16 KiB -> 413; JSON invalido -> 400 (ambos registram so metadados, `origem_valida=false`); processado/ignorado/repetido/`recebido` recente -> 200 `{ok:true}`; transitorio -> 503 + `Retry-After: 60`; rate limit de invalidos estourado -> 401 sem persistir. Corpos fixos (RN-11).

Repo (`RepoWebhookSistema`):
- `registrar({chaveDedupe, tipo, recursoId, payload, origemValida, resultado, agora})` -> `{id, criada:true}` ou, se conflito, `{criada:false, id, resultado, recebidoEm}`: `INSERT ... ON CONFLICT (provedor, chave_dedupe) WHERE origem_valida DO NOTHING RETURNING id`; sem retorno -> `SELECT` por `(provedor, chave_dedupe) AND origem_valida` (1 comando; a linha existe porque o conflito so ocorre com ela). Invalidos entram com `origem_valida=false` (fora do indice, sempre inserem; `resultado='rejeitado'`, `processado_em=agora`). Validos entram `recebido`.
- `reivindicar(id, agora, de: 'erro' | 'recebido_antigo')`: `UPDATE ... SET resultado='processando'`? NAO: o enum nao tem `processando` e nao ha migracao. Decisao: reivindicar mantendo `recebido`: `UPDATE webhook_evento SET resultado='recebido', erro=NULL, recebido_em=$agora WHERE id=$id AND (resultado='erro' OR (resultado='recebido' AND recebido_em < $agora - interval '2 minutes')) RETURNING id`. Reiniciar `recebido_em` faz o relogio de 2 min servir de lease: so uma entrega reivindica (CAS por linha, sem espera). 0 linhas = outra entrega assumiu -> 200 sem processar.
- `concluir(id, {resultado: 'processado'|'ignorado'|'erro', salaoId?, erro?: CodigoFechado, agora})`: `UPDATE ... WHERE id=$id AND resultado='recebido'`, escreve `processado_em` so em `processado|ignorado` (em `erro` fica NULL e o CA-4 exige terminal so quando terminal). Preenche `salao_id` ao resolver (`salvarSalao` no mesmo UPDATE final; tambem exposto como `vincularSalao(id, salaoId)` chamado logo apos resolver, para o `evento_id` de `assinatura_transicao` apontar uma linha ja existente: a linha existe desde o INSERT, entao a FK e satisfeita).
- Rate limit: `incrementarJanela('webhook-mp-invalidos', inicioDaJanela(agora, 60 s))` (reuso de `rate-limit.ts`); so invalidos incrementam; se contador > 120, 401 sem persistir (log `webhook.invalidos_acima_do_limite` com contador).

Fluxo `receberWebhook`:
1. Corpo nulo (limite) ou JSON invalido: contar invalido, registrar metadados (`payload={}`; `chave` = x-request-id valido se houver, senao SHA-256 do corpo bruto truncado), 413/400.
2. `mp.validarWebhook({cabecalhos, consulta, corpo, corpoBruto})`. Invalido -> secao 3 rate limit -> registrar `rejeitado` -> 401. `extrairChave`: `x-request-id` aparado, 1..128 chars, `^[\x21-\x7e]+$`; ausente/vazio/longo = invalido mesmo se a porta validou (evento valido sem chave nao deduplica -> tratado como invalido).
3. Valido: `registrar(origemValida=true, resultado recebido)`. Repetido: `processado|ignorado|rejeitado` -> 200; `recebido` com `recebido_em` < 2 min -> 200 sem processar; `erro` ou `recebido` > 2 min -> `reivindicar`; falhou o CAS -> 200.
4. Consulta FORA de transacao (nunca dentro de `emTransacao`):
   - pagamento: `consultarPagamento(recursoId)` -> `consultarAssinatura(p.assinaturaId)`? Nao precisa: a resolucao do salao usa `buscarPorProvedor(p.assinaturaId)`.
   - assinatura: `consultarAssinatura(recursoId)` -> `buscarPorProvedor(recursoId)`.
   - `RecursoNaoEncontradoNoProvedor` -> `ignorado/recurso_inexistente`; `ErroProvedor`/desconhecido -> `erro`, 503. Assinatura local ausente -> `ignorado/assinatura_desconhecida`; `p.salaoId !== local.salaoId` -> `ignorado/vinculo_invalido` (log com ids). Nunca grava a resposta do provedor.
5. Efeito (`mapearConsultado`, puro): pagamento `aprovado` -> `cobranca_aprovada{pagamentoId:p.id, valorCentavos, pagoEm:ocorridoEm}`; `recusado` -> `cobranca_falhou{pagamentoId:p.id, valorCentavos, falhouEm:ocorridoEm}`; assinatura `autorizada` -> `processarAutorizada(ctx, {id:local.id}, p, agora, {log})` (reusa D-040, CAS em `confirmarProvedor`; se `assinatura.id` nao e a vigente: `processarAutorizada` ja exige o id e passa `assinaturaId`); `cancelada` -> `{tipo:'cancelamento'}`; `pendente` -> `ignorado/estado_pendente`. Eventos de dominio via `aplicarEventoAssinatura(ctx, ev, agora, {assinaturaId: local.id, eventoId, log})` com `ctx = contextoDeSistema(local.salaoId, 'webhook-mp')`. Mapeamento resultado: `aplicado` -> `processado`; `sem_efeito`(inclui `pagamento_duplicado`) -> `processado`; `ignorado` -> `ignorado` com o motivo em `erro`; `sem_assinatura` -> `ignorado`; `ocupada` -> `erro`+503. `processarAutorizada` nao recebe `eventoId`: ampliar sua assinatura com opcao `eventoId` repassada a `aplicarEventoAssinatura` (alteracao pequena em `retorno.ts`, posse de T-2).
6. Concluir a linha (CAS `resultado='recebido'`). Excecao inesperada do banco: tenta `concluir(erro)` e responde 503 (nunca 5xx por 23505: nao ha INSERT por conflito possivel fora do ON CONFLICT).

Codigos de `erro` (lista fechada, sem texto livre): `assinatura_desconhecida`, `recurso_inexistente`, `vinculo_invalido`, `estado_pendente`, `provedor_indisponivel`, `ocupada`, `interno`, `pagamento_duplicado`, e os motivos de `MotivoIgnorado` do dominio.

Sanitizacao (`sanitizarPayload`): lista branca `id`, `type`, `action`, `live_mode`, `data.id`, `date_created`; so string/numero/boolean; strings truncadas a 200; `/\d{13,19}/g` -> `[redigido]` (tambem em `erro` e em logs); `recurso_id` so se `^[A-Za-z0-9_-]{1,64}$` senao NULL. Cabecalhos/query nunca gravados.

## 4. Dados
Nenhuma migracao. Sem `processando` no enum: lease por `recebido_em` (acima). `webhook_evento` e plataforma, sem RLS/tenant; repo de sistema documentado como excecao (cabecalho do arquivo). Indice parcial atende a busca; linhas rejeitadas nao sao buscadas. Volume: RN-9/RN-10; sem expurgo (RN-12, E8.3).

## 5. Infraestrutura
Nada novo. URL a cadastrar no MP: `<APP_URL>/api/webhooks/mercadopago` (README). O reverse proxy real deve repassar `x-request-id`/`x-signature` (nota README para E6.6).

## 6. Invariantes
- Escopo por salao: salao so resolvido pelo vinculo `provedor_assinatura_id`; `vinculo_invalido` cobre divergencia; efeito via `ContextoEscopado` de sistema; `webhook_evento` e plataforma (excecao documentada). Teste de isolamento: webhook com id de assinatura de salao A nao toca B.
- Exclusion constraint/UTC: nao se aplica a reservas; tempos vem do provedor (`ocorridoEm` UTC), `agora` injetado.
- Adaptadores: so `integracoes().mercadoPago` (CA-13 estatico); segredo nunca na rota.
- Soft delete/anonimizacao: n/a. Somente leitura: webhook e do sistema (D-038), nunca consulta a politica; CA-9.
- Idempotencia: dedupe por chave (so validos) + `pagamento_id UNIQUE` + `FOR UPDATE` (D-037); CAS no lease.
- Auditoria super admin: n/a (sem ator humano); trilha = `webhook_evento` + `assinatura_transicao.evento_id`.
- Ordem de travas: persistir webhook (INSERT, sem trava de salao) -> consulta fora de transacao -> `aplicarEventoAssinatura` (salao -> assinatura -> pagamento -> transicao, D-037). A UPDATE do webhook roda fora da transacao do efeito (autocommit), entao nunca segura trava de assinatura: sem ciclos. Webhook x retorno x job serializam em `assinatura FOR UPDATE` (job usa `pularTravada` e responde `ocupada` -> reagenda).

## 7. Riscos e decisoes
- R-1 `recebido` preso: lease 2 min por `recebido_em` (reivindicacao reinicia o relogio). Mitigado.
- R-2 Corpo bruto no HMAC real: campo `corpoBruto` na porta (opcional); E6.6 so consome. Mitigado sem implementar.
- R-3 Duas notificacoes do mesmo `pagamento_id` (CA-6): ambas `processado`; a 2a `sem_efeito/pagamento_duplicado` registrado em `erro` como codigo informativo; periodo estendido uma vez. 
- R-4 Reivindicacao entre o 503 e a reentrega com `recebido_em` reiniciado: aceitavel; `erro` reivindica sem esperar 2 min.
- R-5 DoS por invalidos: 120/min global, 401 sem persistir; o corpo e lido ate 16 KiB + 1 e descartado. Valor ajustavel por `deps`.
- R-6 `Retry-After` fixo 60 s: valor de partida.
- R-7 Replay de notificacao valida: dedupe + idempotencia por recurso; janela de `ts` fica para E6.6.

## 8. Testes
Unitarios (`src/server/assinatura/webhook-decisao.test.ts`, `webhook-http.test.ts`, estatico `webhook-estatico.test.ts`): CA-12 (chave ausente/vazia/espacos/>128; sanitizador digitos 13-19, truncamento, lista branca; mapeamento; rota sem `repos`/Prisma por grep), CA-13 (fora do matcher; `MP_WEBHOOK`/segredo so por `integracoes().mercadoPago`), CA-10 parte HTTP (413/400 sem consultar).
Integracao PostgreSQL real, `tests/integration/assinatura/webhook*.test.ts` com MP simulado (`notificacaoSimulada`, estado do pagamento via `sim_*`/helpers existentes de D-040): CA-1, CA-2 (sequencial e 3 em paralelo), CA-3, CA-4 (corpo malicioso com 16 digitos), CA-5, CA-6, CA-7, CA-8 (erro forcado do simulado, depois reentrega), CA-9 (`suspensa`/`em_carencia`), CA-10 (linha sem corpo inteiro), CA-11 (`webhook-concorrencia.test.ts`: webhook x retorno x job e 10 distintas em paralelo, sem 23505/40P01, extensao unica). Estabilidade x10 (comando no README/CLAUDE.md). Sem Playwright (sem UI). Cobertura >= 90%: decisao pura e servico cobertos por unit+integracao; rota coberta por teste que invoca `POST` com `Request`.

## 9. Tarefas
- T-1 (desenvolvedor, sem deps): `src/server/repos/webhook.ts`, `src/server/repos/assinatura.ts` (buscarPorProvedor), `src/server/repos/index.ts` (export `repoWebhookSistema`), `src/server/integrations/mercadopago/port.ts` (campo `corpoBruto?`), `tests/integration/assinatura/webhook-repo.test.ts`. Pronto: CAS/dedupe/lease testados contra o banco.
- T-2 (desenvolvedor, paralelo a T-1): `src/server/assinatura/webhook-decisao.ts` + `.test.ts`, `src/server/assinatura/retorno.ts` (opcao `eventoId`), e `src/server/assinatura/webhook-estatico.test.ts`. Pronto: CA-12/CA-13 verdes.
- T-3 (desenvolvedor, depende de T-1 e T-2): `src/server/assinatura/webhook.ts`, `webhook-http.ts`, `src/app/api/webhooks/mercadopago/route.ts` (+ testes de rota), `tests/integration/assinatura/webhook.test.ts`. Pronto: CA-1..CA-10.
- T-4 (desenvolvedor, depende de T-3): `tests/integration/assinatura/webhook-concorrencia.test.ts` (CA-11, x10), `README.md` (URL, codigos de resposta, comando de estabilidade, nota E6.6 de corpo bruto/cabecalhos), `CLAUDE.md` (registrar D-041). Pronto: gates (lint, typecheck, build, test:coverage >= 90%).
T-1 e T-2 nao compartilham arquivos.
