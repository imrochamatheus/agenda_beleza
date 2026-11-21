# D-037 (E6.3) - Máquina de estados da assinatura: design

Entradas: `spec.md` (RN-1..13, CA-1..18), PLAN.md l.73-86, issues #40/#41, código real (schema `Assinatura*`, `repos/publico.ts` `lerEstadoDeAgendamento`, `reserva-publica/agendamento.ts`, `worker/handlers/assinatura-prazos.ts`, `config/plano.ts`, `repos/transacao.ts`, `tenant/context.ts`).

## 1. Resumo, validação das suposições e alternativas

Núcleo em três camadas: (a) domínio puro `src/domain/assinatura/` (decisão de transição, mês civil UTC, tabela de capacidades, estado efetivo; relógio sempre entrada); (b) repositório `repos/assinatura.ts` (único acesso ao Prisma; SQL bruto com UPDATE condicional); (c) serviço `src/server/assinatura/` com `aplicarEventoAssinatura` (ponto único), `processarPrazos` (job) e `estadoEfetivoDoSalao`. O job chama o MESMO ponto único, evento `prazo`, uma assinatura por transação.

Validação do PLAN (o PLAN prevalece onde fala):
- S-1: o PLAN só define carência "a partir da primeira falha notificada" e não trata teste vencido sem pagamento. Não contradiz; mantida (`em_teste` vencido -> `em_carencia` com `primeira_falha_em = teste_fim_em` -> `suspensa`). Registrada como decisão de produto não coberta pelo PLAN.
- S-2: o PLAN só cobre cancelamento em teste (acesso até o fim do teste) e ativa (até o fim do período). Pendente/carência/suspensa não são tratados; mantida (encerra na hora), sem contradição.
- S-3: o PLAN é omisso (reembolso é fora do escopo). Mantida.
Nenhuma divergência do PLAN. Divergências de forma: (i) a issue pede `tests/unit/assinatura/...`; o projeto roda unitários em `src/**/*.test.ts(x)` (vitest `unit`), então os unitários ficam ao lado do domínio; (ii) a trava da assinatura é `FOR NO KEY UPDATE` (a spec diz `FOR UPDATE`): serializa igual (conflita com outro NO KEY UPDATE/UPDATE) e não bloqueia os `FOR KEY SHARE` de FK dos INSERT em `assinatura_pagamento`/`assinatura_transicao`, mesma lição do `salao`.

Alternativas descartadas: máquina com transições espalhadas por webhook/job/ação (viola ponto único); `SELECT … FOR UPDATE SKIP LOCKED` em lote único com todas as linhas travadas por toda a execução (segura travas por muito tempo, risco de impasse com eventos) -> uma transação curta por assinatura; coluna/tabela nova de prazos ou job por assinatura no pg-boss (sem necessidade, cron de 5 min basta); `Date.now()` no domínio (RN-9).

## 2. Componentes (caminhos)

Domínio puro (`src/domain/assinatura/`, sem imports de fora da pasta; coberto pelo bloco ESLint `src/domain/**`; conferir se `tests/integration/lint/importacao-dominio.test.ts` enumera pastas e incluir `assinatura`):
- `maquina-estados.ts`: `decidir(a: AssinaturaBruta, ev: EventoDominio, agora: Date): Decisao`.
- `mes-civil.ts`: `somarUmMesCivilUtc(d: Date): Date` (`Date.UTC` + getters UTC; dia limitado ao último dia do mês destino; preserva hora/ms; nenhum método local).
- `capacidades.ts`: `CAPACIDADES_OPERACIONAIS = ['leitura','configurar','agendar','cancelar','assinatura','lgpd']`, `TABELA_CAPACIDADES` por situação (única fonte para a E6.4).
- `estado-efetivo.ts`: `decidirEstadoEfetivo(bruto, agora)`.
- `index.ts` e `*.test.ts` ao lado (CA-18 exaustivo 7 estados x 6 eventos; CA-10 em dois fusos).
- `src/config/plano.ts`: adicionar `DIAS_CARENCIA = 3`.

Servidor:
- `src/server/repos/assinatura.ts` + registro em `repos/index.ts` (`Repos.assinaturas`) e `repoAssinaturaSistema()` para o job (listagem sem contexto de salão).
- `src/server/assinatura/tipos.ts` (client-safe: eventos, resultados, `EstadoEfetivo`), `servico.ts` (`aplicarEventoAssinatura`), `prazos.ts` (`processarPrazos`), `estado-operacional.ts` (`estadoEfetivoDoSalao`), `config.ts` (`LOTE_PRAZOS = 100`, `MAX_LOTES_POR_EXECUCAO = 20`). Sem `next/*`, sem `'use server'`, sem `*.acao.ts`.
- `src/worker/handlers/assinatura-prazos.ts`: `criarAssinaturaPrazos(deps)` + export `assinaturaPrazos` (cron `*/5 * * * *` mantido, payload vazio, `agora` injetado só aqui). Remover o comentário "Stub/RN-17"; ajustar `handlers.test.ts` se afirmar que é stub.
- NÃO alterar `agendamentoDisponivel`, `lerEstadoDeAgendamento`, `politicaDeOperacao` (E6.4).

## 3. Interfaces

```ts
type EstadoAssinatura = 'pendente'|'em_teste'|'ativa'|'em_carencia'|'suspensa'|'cancelada'|'encerrada';
type EventoAssinatura =
  | { tipo: 'teste_iniciado' }
  | { tipo: 'cobranca_aprovada'; pagamentoId: string; valorCentavos: number; pagoEm: Date }
  | { tipo: 'cobranca_falhou'; pagamentoId?: string; valorCentavos?: number; falhouEm: Date }
  | { tipo: 'cancelamento' }
  | { tipo: 'prazo' };
type Origem = 'pagamento_aprovado'|'pagamento_recusado'|'cancelamento_gestor'|'prazo_carencia'|'prazo_acesso'|'prazo_teste'|'teste_iniciado';
type Decisao =
  | { tipo: 'transicoes'; passos: { de; para; origem; campos: Partial<CamposAssinatura> }[] }   // >= 1 (prazo pode ter 2)
  | { tipo: 'atualiza'; campos: { periodoPagoAte: Date } }       // ativa + aprovada: sem mudança de estado, sem linha de transição
  | { tipo: 'sem_efeito' } | { tipo: 'ignorado'; motivo: MotivoIgnorado };
type ResultadoAssinatura =
  | { resultado: 'aplicado'; de; para; transicoes: number; pagoAte: Date | null }
  | { resultado: 'sem_efeito'; motivo?: 'pagamento_duplicado' }
  | { resultado: 'ignorado'; motivo: MotivoIgnorado }
  | { resultado: 'sem_assinatura' } | { resultado: 'ocupada' };   // 'ocupada': só no job (SKIP LOCKED)

aplicarEventoAssinatura(ctx: ContextoEscopado, ev: EventoAssinatura, agora: Date,
  opcoes?: { assinaturaId?: string; eventoId?: string; r?: Repos; pularTravada?: boolean;
             aposRegistrarPagamento?: () => Promise<void> /* hook só de teste */ }): Promise<ResultadoAssinatura>
processarPrazos(agora: Date, deps?: { sistema?; log? }): Promise<{ examinadas; transitadas; ignoradas; falhas }>
estadoEfetivoDoSalao(ctx: ContextoDeLeituraDeAgenda, agora: Date): Promise<EstadoEfetivo>
type EstadoEfetivo = { estado: EstadoAssinatura | 'manual' | 'sem_assinatura';
  motivo: 'manual'|'assinatura'|'cancelada_vencida'|'sem_assinatura';
  capacidades: Record<CapacidadeOperacional, boolean>; carenciaAte?: Date; acessoAte?: Date }
```

Regras da função `decidir` (todas com `<=` para vencer; UTC; `agora` e datas do evento são entradas):
- `teste_iniciado`: `pendente` -> `em_teste`, `teste_fim_em = agora + DIAS_TESTE*86_400_000` ms (UTC, sem DST); `em_teste` -> `sem_efeito`; outros -> `ignorado('estado_incompativel')`.
- `cobranca_aprovada`: `em_teste` -> `ativa`, `pago_ate = max(coalesce(pago_ate, teste_fim_em), pagoEm) + 1 mês`; `ativa` -> `atualiza`, `max(pago_ate, pagoEm) + 1 mês` (pago_ate nulo: `pagoEm + 1 mês`); `em_carencia`/`suspensa` -> `ativa`, `pagoEm + 1 mês`, limpa `primeira_falha_em`/`carencia_ate`; `pendente` -> `ignorado('assinatura_pendente')`; `cancelada`/`encerrada` -> `ignorado('assinatura_encerrada')` (S-3: o serviço ainda registra o pagamento com `aplicado_em` nulo; ver §3.1).
- `cobranca_falhou`: `ativa`/`em_teste` -> `em_carencia` (`primeira_falha_em = falhouEm`, `carencia_ate = falhouEm + 3 d`); `em_carencia`/`suspensa`/`encerrada` -> `sem_efeito`; `pendente`/`cancelada` -> `ignorado`.
- `cancelamento`: `em_teste` -> `cancelada` (`acesso_ate = teste_fim_em`, `cancelada_em = agora`); `ativa` -> `cancelada` (`acesso_ate = pago_ate ?? agora`); `pendente`/`em_carencia`/`suspensa` -> `encerrada` (`cancelada_em = agora`); `cancelada`/`encerrada` -> `sem_efeito`.
- `prazo`: laço de ponto fixo (máx. 2 passos): `em_teste` com `teste_fim_em <= agora` -> `em_carencia` (`prazo_teste`, `primeira_falha_em = teste_fim_em`, `carencia_ate = teste_fim_em + 3 d`); `em_carencia` com `carencia_ate <= agora` -> `suspensa` (`prazo_carencia`); `cancelada` com `acesso_ate <= agora` (ou nulo) -> `encerrada` (`prazo_acesso`); senão `sem_efeito`.
- Desconhecidos (estado ou evento fora do tipo) -> `ignorado('desconhecido')`, nunca lançam (CA-18). Valor diferente de `PRECO_MENSAL_CENTAVOS` só vira log de contagem/`valor_divergente` (sem dados pessoais).

### 3.1 Serviço `aplicarEventoAssinatura` (uma transação READ COMMITTED, via `emTransacao`, ou a de `opcoes.r`)
1. Alvo: `RepoAssinatura.travar(ctx, { assinaturaId?, pularTravada })`: `SELECT … FROM assinatura WHERE salao_id = $ctx AND (id = $id OR (estado <> 'encerrada' AND $id IS NULL)) … FOR NO KEY UPDATE [SKIP LOCKED]`; sem `assinaturaId` e sem vigente, para `cobranca_aprovada`/`cobranca_falhou` com `pagamentoId` usa a mais recente (por `criado_em DESC, id DESC`) para poder registrar S-3; senão `sem_assinatura`. `assinaturaId` de outro salão -> `sem_assinatura` (CA-16). Sem linha com SKIP LOCKED travada -> `ocupada`.
2. Se o evento traz `pagamentoId`: `INSERT INTO assinatura_pagamento (assinatura_id, pagamento_id, status, valor_centavos, aplicado_em) … ON CONFLICT (pagamento_id) DO NOTHING RETURNING id`. Sem linha retornada -> `sem_efeito/pagamento_duplicado`, nada mais escrito (CA-12). Status `aprovado`/`recusado` (constantes na aplicação). `valor_centavos` da falha sem valor = `PRECO_MENSAL_CENTAVOS`. Hook `aposRegistrarPagamento` roda aqui (CA-12: falha desfaz ambos).
3. `decidir(...)`. Para cada passo: `UPDATE assinatura SET estado=$para, <campos>, atualizado_em=$agora WHERE id=$id AND estado=$de::estado_assinatura` (literais/cast, `atualizado_em` do relógio injetado; 0 linhas sob trava = defensivo, trata como `sem_efeito` e loga `assinatura.transicao_perdida`), depois `INSERT INTO assinatura_transicao (assinatura_id, de, para, causa, evento_id, ocorrida_em = $agora)`. `atualiza` faz só o UPDATE de `periodo_pago_ate`. Se o pagamento foi inserido e o efeito foi aplicado: `UPDATE assinatura_pagamento SET aplicado_em = $agora`; em `ignorado` o pagamento fica com `aplicado_em` nulo (S-3). Falha recusada sem transição (em_carencia): `aplicado_em` nulo.
4. Retorna o resultado; nunca lança por regra de negócio. Erros de banco propagam (rollback total).
Isso resolve a tensão da spec §6 x RN-11: "ignorado sem escrita" vale para o ESTADO da assinatura; o registro do pagamento (S-3) é a única escrita permitida.

### 3.2 Job
`processarPrazos(agora)`: laço de até `MAX_LOTES_POR_EXECUCAO` lotes; cada lote lê, SEM trava e com cursor por `id`, até 100 `(id, salao_id)` candidatas em um comando: `estado='em_teste' AND teste_fim_em <= $agora` OR `estado='em_carencia' AND carencia_ate <= $agora` OR `estado='cancelada' AND (acesso_ate <= $agora OR acesso_ate IS NULL)` (literais de estado; nunca parâmetro). Para cada uma: `contextoDeSistema(salaoId, 'assinatura-prazos')` + `aplicarEventoAssinatura(..., {tipo:'prazo'}, agora, {assinaturaId, pularTravada:true})`; `try/catch` por assinatura (falha logada com ids, lote segue, CA-17); `ocupada` conta como adiada (o evento em curso ou a próxima execução resolve). Ao reler sob trava `decidir` reaplica a condição, então job x evento é seguro. Log só com ids/contagens (`assinatura.prazos`).

### 3.3 Estado efetivo
`RepoAssinatura.lerEstadoBruto(ctx: ContextoDeLeituraDeAgenda)` (`exigirLeituraDeAgenda`, recusa admin): um comando, mesma forma de `lerEstadoDeAgendamento` mais `carencia_ate`; só o salão do contexto. `decidirEstadoEfetivo`: manual prevalece (`estado:'manual'`, só `leitura/cancelar/assinatura/lgpd` = true); sem linha -> tudo true (`sem_assinatura`, compatibilidade D-026); `cancelada` com `acesso_ate` nulo ou `<= agora` -> `estado:'encerrada'`, `motivo:'cancelada_vencida'`; tabela: `pendente` {leitura, configurar, cancelar, assinatura, lgpd}; `em_teste|ativa|em_carencia|cancelada(vigente)` todas; `suspensa|encerrada` {leitura, cancelar, assinatura, lgpd}. `carenciaAte` só em `em_carencia`; `acessoAte` só em `cancelada`.

## 4. Dados
Sem migração (colunas, enum, índice `assinatura_vigente_por_salao_uniq` e triggers de somente-inserção existem; o INSERT de `ocorrida_em` explícito é permitido). DBA: SIM, parecer curto em `docs/demandas/D-037/dba.md` (não é entrega de migração): (a) confirmar que `FOR NO KEY UPDATE` + `SKIP LOCKED` na linha e o INSERT filho com `FOR KEY SHARE` não geram espera/impasse; (b) volume do varrimento do job (tabela com no máximo 1 linha vigente por salão: seq scan aceitável; índices parciais por prazo só se o DBA ver ganho); (c) decidir se o CHECK `assinatura_estado_datas_chk` entra agora (recomendo NÃO: seeds e `tests/support/reserva-publica.ts` gravam estados diretos e o domínio já garante os campos; se o DBA insistir, `NOT VALID` não serve a dados de teste, então fica para depois). Status de pagamento permanece TEXT validado na aplicação.

## 5. Infraestrutura
DevOps: NÃO. Nenhuma variável de ambiente (carência e preço em `config/plano.ts`), nenhum container, fila ou CI novos; o cron `*/5 * * * *` e a fila `assinatura-prazos` (exclusive, payload vazio) já existem; o handler importa repositório como `reconciliar-mensagens` já faz (bundle esbuild do worker sem mudança). Observabilidade: logs `assinatura.prazos` e `assinatura.transicao_perdida` só com ids e contagens.

## 6. Invariantes
- Escopo por salão no servidor: aplica (todas as consultas filtram `salao_id` do contexto; `assinaturaId` alheio -> `sem_assinatura`; CA-16). O job usa contexto de sistema por assinatura.
- Exclusion anti-sobreposição: não se aplica (nenhuma reserva é tocada).
- UTC com fuso do salão: aplica; todo cálculo em UTC puro, nenhuma conversão local; exibição local é da E6.5.
- Adaptadores: aplica; nenhum código de MP aqui (E6.1/E6.2 chamam `aplicarEventoAssinatura`); CA-5 só lê `sim_mp_*`.
- Soft delete/anonimização: não se aplica.
- Somente leitura do suspenso: esta demanda produz a tabela e o estado efetivo; a aplicação em `defineAcao`/página pública é da E6.4 (não alterada aqui).
- Idempotência: aplica; `pagamento_id` UNIQUE + `ON CONFLICT DO NOTHING` na mesma transação do UPDATE; transições por UPDATE condicional; job sem candidatas não escreve.
- Auditoria do super admin: não se aplica (ações de super admin são da E8.2; `assinatura_transicao` é o registro de domínio).
- Cobertura >= 90% sem exclusões.

## 7. Ordem de travas (documentar no cabeçalho de `repos/servico.ts` e no cabeçalho de `repos/assinatura.ts`)
`salao` (quando usado) -> `assinatura` (FOR NO KEY UPDATE) -> profissional(is) -> servico(s) -> cliente -> reserva ... Dentro da assinatura: `assinatura_pagamento` -> `assinatura_transicao`. Hoje nenhum caminho segura profissional/salão e depois assinatura; E6.1 grava `webhook_evento` (linha nova) antes, sem conflito. O job trava só a linha da assinatura; `aplicarEventoAssinatura` nunca toma `salao` nem profissional. Sem ciclo possível.

## 8. Riscos e decisões
- R-1 S-2 em `em_carencia` com `pago_ate` ainda futuro: encerra na hora e perde período pago; aceito (PLAN omisso). Mitigação: nota no texto da E6.5.
- R-2 Pagamento tardio sem `assinaturaId`: cai na vigente (que pode ser uma nova assinatura). Mitigação: E6.1/E6.2 devem passar `assinaturaId` resolvido por `provedor_assinatura_id` (documentar nos tipos).
- R-3 `SKIP LOCKED` atrasa a transição do job até 5 min se o evento segurar a linha; seguro porque o evento reaplica `prazo` implícito não: o evento muda o estado e o job reavalia no ciclo seguinte. Teste CA-7 nas duas ordens.
- R-4 `em_teste` vencido -> carência: se o MP cobrar com atraso, regularização `pagoEm + 1 mês` (RN-6) pode ser maior que `teste_fim + 1 mês`; aceito e coberto por CA-15.
- R-5 Testes de integração que sobem o worker real com crons ativos passam a poder mexer em linhas de assinatura vencidas dos fixtures; mitigação: fixtures com datas futuras ou o handler isolado com relógio injetado (revisar `tests/support/reserva-publica.ts`, `tests/integration/mensagens`).
- R-6 Seed (`prisma/seed.ts`): conferir que as datas da demo não vencem em minutos (se vencerem, o job as moverá; ajustar na T-4, só leitura do seed, alteração fora do escopo = avisar o líder).
- R-7 Nomes `Capacidade` já existem em `tenant/context.ts` (matriz de papéis); o novo tipo se chama `CapacidadeOperacional` para não colidir.

## 9. Estratégia de testes
Unitários (`src/domain/assinatura/*.test.ts`, também `TZ=UTC` e `TZ=America/Sao_Paulo`): CA-9, CA-10, CA-11 (aritmética), CA-18, limites inclusivos de CA-3, tabela de capacidades (CA-6 puro). Integração (`tests/integration/assinatura/`, PostgreSQL real): `transicoes.test.ts` (CA-1, 2, 4, 8, 9, 11, 13, 14, 15), `prazos.test.ts` (CA-3, 5, 13, 15, lote > 100, CA-17), `idempotencia.test.ts` (CA-12 2x e 10x em paralelo + hook de rollback), `concorrencia.test.ts` (CA-7 barreira, 10 repetições, ambas as ordens; cancelamento x aprovada; sem `40P01`), `estado-efetivo.test.ts` (CA-4, 5, 6, 16), `triggers.test.ts` (reuso do teste existente). Handler: `src/worker/handlers/assinatura-prazos.test.ts`. Regressão: testes do D-026 e `handlers.test.ts`. E2E Playwright: nenhum (sem UI). Cobertura >= 90% pelo comando oficial.

| CA | unit | integração | | CA | unit | integração |
|---|---|---|---|---|---|---|
| 1 | x | transicoes | | 10 | x | transicoes |
| 2 | x | transicoes | | 11 | x | transicoes |
| 3 | x | prazos | | 12 | | idempotencia |
| 4 | x | estado-efetivo | | 13 | x | prazos |
| 5 | | prazos + estado-efetivo | | 14 | x | transicoes |
| 6 | x | estado-efetivo | | 15 | x | prazos |
| 7 | | concorrencia | | 16 | | estado-efetivo + transicoes |
| 8 | | transicoes + triggers | | 17 | | handler + prazos |
| 9 | x | transicoes | | 18 | x | |

## 10. Tarefas
- T-1 (desenvolvedor; paralela com T-2): domínio. Posse: `src/domain/assinatura/**`, `src/config/plano.ts`, e o teste de lint do domínio se precisar listar a pasta. Entregável: `decidir`, `somarUmMesCivilUtc`, capacidades, `decidirEstadoEfetivo` + unitários. Conclusão: unitários verdes em dois fusos, CA-9/10/11/18 cobertos.
- T-2 (dba; paralela com T-1): parecer em `docs/demandas/D-037/dba.md` (§4). Conclusão: parecer registrado; migração só se o DBA justificar (e então vira T-2b antes da T-3).
- T-3 (desenvolvedor; depende T-1): `src/server/repos/assinatura.ts`, `src/server/repos/index.ts` (registro), cabeçalho de `src/server/repos/servico.ts` (ordem de travas), `tests/support/assinatura.ts` (fábricas por estado). Conclusão: repositório com métodos `travar`, `inserirPagamento`, `aplicarPasso`, `inserirTransicao`, `marcarAplicado`, `listarVencidas`, `lerEstadoBruto`; typecheck e lint (Prisma só em repos).
- T-4 (desenvolvedor; depende T-1, T-3): `src/server/assinatura/**` (tipos, servico, prazos, estado-operacional, config). Conclusão: `aplicarEventoAssinatura`, `processarPrazos` e `estadoEfetivoDoSalao` funcionando contra o banco real.
- T-5 (desenvolvedor; depende T-4; paralela com T-6): `src/worker/handlers/assinatura-prazos.ts`, `src/worker/handlers/assinatura-prazos.test.ts`, `src/worker/handlers/handlers.test.ts` (ajuste). Conclusão: CA-17 e cron/payload inalterados.
- T-6 (desenvolvedor; depende T-4; paralela com T-5): `tests/integration/assinatura/**` e `tests/support/assinatura.ts` só por T-3 (T-6 apenas importa). Conclusão: CA-1..16 verdes, concorrência estável 10x.
- T-7 (desenvolvedor; depende T-5 e T-6): `CLAUDE.md` (parágrafo D-037, ordem de travas, comandos de estabilidade e fuso) e `README.md` (seção de assinatura/worker). Conclusão: `npm run lint`, `typecheck`, `build`, `npm run test:coverage` >= 90%.
Comandos novos para o CLAUDE.md: estabilidade `for i in $(seq 10); do npx vitest run --project integration tests/integration/assinatura/concorrencia.test.ts tests/integration/assinatura/idempotencia.test.ts || break; done`; fuso `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/domain/assinatura || break; done`.
