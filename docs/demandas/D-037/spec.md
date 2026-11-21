# D-037 (E6.3) - Máquina de estados da assinatura: spec

Fonte: issue #40 (RN-1..9, CA-1..12 abaixo, refinados), issue #41 (E6.4), PLAN.md "Assinatura" (l.75-86), CLAUDE.md "Subscriptions".

## 1. Problema (estado atual, com evidência)
- Schema pronto: `assinatura` (`estado` enum com os 7 estados, `teste_fim_em`, `periodo_pago_ate`, `primeira_falha_em`, `carencia_ate`, `cancelada_em`, `acesso_ate`), `assinatura_pagamento` (`pagamento_id` UNIQUE, `valor_centavos`, `aplicado_em`), `assinatura_transicao` (`de`, `para`, `causa` TEXT, `evento_id` FK nulo) - prisma/schema.prisma:528-583. Somente inserção por triggers (migration 20261118000200_restricoes_sql:182-188). Índice parcial `assinatura_vigente_por_salao_uniq (salao_id) WHERE estado <> 'encerrada'` (l.141). `salao.suspenso_manual_em` existe.
- Não existe `aplicarEventoAssinatura`, máquina de estados, cálculo de `pago_ate` nem estado efetivo. O handler `src/worker/handlers/assinatura-prazos.ts` é stub (cron `*/5 * * * *`, fila `assinatura-prazos`, exclusive, payload vazio; src/server/queue/filas.ts:40).
- Predicado atual: `agendamentoDisponivel` (src/server/reserva-publica/agendamento.ts): manual -> assinatura (pendente/suspensa/encerrada indisponível; cancelada só até `acessoAte`) -> sem serviço; sem linha de assinatura = disponível. `lerEstadoDeAgendamento` (repos/publico.ts:216) lê a assinatura mais recente. `politicaDeOperacao = permitirTudo` (tenant/politica.ts:20).
- Seed (`prisma/seed.ts:293`) e `tests/support/reserva-publica.ts:22` gravam assinatura direto; continuam válidos (sem migração de dados).

## 2. Objetivo
Núcleo único, determinístico e idempotente da vida da assinatura (teste, cobrança, carência, suspensão, regularização, cancelamento), com relógio injetável, concorrência segura job x webhook e função de estado efetivo para a E6.4.

## 3. Escopo
Entra: domínio puro `src/domain/assinatura/maquina-estados.ts` (+ cálculo de mês civil); `aplicarEventoAssinatura` em `src/server/assinatura/` (ponto único; sem `next/*`, sem `'use server'`, sem `*.acao.ts`); repositório de assinatura (único acesso ao Prisma; `repos/assinatura.ts`); job `assinatura-prazos` real; `src/server/assinatura/estado-operacional.ts` (`estadoEfetivoDoSalao` + tabela de capacidades); testes.
Fora: webhooks/consulta MP (E6.1/E6.2), tela do gestor (E6.5), bloqueio em `defineAcao`/página pública (E6.4), super admin (E8.2). Nenhum item da seção "Fora da primeira versão" do PLAN.md é tocado.

## 4. Regras de negócio
- RN-1 `em_teste` -> `ativa` na primeira cobrança aprovada.
- RN-2 Primeira falha (em `ativa`, ou na `em_teste`) -> `em_carencia`; `primeira_falha_em` = data da falha, `carencia_ate` = falha + 3 dias (instante exato, UTC). Falhas seguintes em `em_carencia` não alteram nada (nenhuma transição, mas o evento é registrado em `assinatura_pagamento` se tiver `pagamento_id`).
- RN-3 `em_carencia` com `carencia_ate <= agora` -> `suspensa` (job).
- RN-4 Cobrança aprovada em `em_carencia`/`suspensa` -> `ativa`; limpa `primeira_falha_em` e `carencia_ate`.
- RN-5 Cancelamento pelo gestor: `em_teste` -> `cancelada`, `acesso_ate = teste_fim_em`; `ativa` -> `cancelada`, `acesso_ate = periodo_pago_ate`; `pendente`, `em_carencia` e `suspensa` -> `encerrada` imediato (suposição S-2). `cancelada` com `acesso_ate <= agora` -> `encerrada` (job). Cancelar de novo é idempotente (sem transição).
- RN-6 `pago_ate` (= coluna `periodo_pago_ate`): primeira cobrança (de `em_teste`): `max(coalesce(pago_ate, teste_fim_em), data_pagamento) + 1 mês`, sem encurtar o teste; cobrança regular em `ativa`: `max(pago_ate, data_pagamento) + 1 mês`; regularização em `em_carencia`/`suspensa`: `data_pagamento + 1 mês`. "+1 mês" = mês civil em UTC, mesmo horário, dia limitado ao último dia do mês de destino. Idempotência: `INSERT INTO assinatura_pagamento ... ON CONFLICT (pagamento_id) DO NOTHING`; se não inseriu, nada muda; a inserção e o UPDATE de `pago_ate` estão na MESMA transação (falha em qualquer um desfaz ambos).
- RN-7 `estadoEfetivoDoSalao(ctx, agora)` combina `salao.suspenso_manual_em` (prevalece: tudo como suspensa, exceto leitura/cancelar/assinatura/lgpd) e assinatura mais recente; devolve `{ estado, motivo, capacidades, carenciaAte?, acessoAte? }`. Tabela (issue #41): `pendente`: leitura sim, configurar sim, agendar não, cancelar sim, assinatura sim, lgpd sim; `em_teste|ativa|em_carencia|cancelada` (dentro de `acesso_ate`, exclusivo): tudo sim; `suspensa|encerrada|manual|cancelada vencida`: configurar não, agendar não, o resto sim (cancelar notifica). Sem linha de assinatura: tudo sim (compatibilidade D-1 do D-026; E6.4 decide se muda). `cancelada` vencida é tratada como `encerrada` mesmo antes do job rodar.
- RN-8 Transições só por UPDATE condicional ao estado esperado (`WHERE id=$1 AND estado=$2`) sob `assinatura ... FOR UPDATE`; cada transição insere uma linha em `assinatura_transicao` (`de`, `para`, `causa` = origem: `pagamento_aprovado|pagamento_recusado|cancelamento_gestor|prazo_carencia|prazo_acesso|prazo_teste`, `evento_id` opcional, `ocorrida_em` = agora injetado) na mesma transação. Evento sem efeito (já no estado alvo) = `{ resultado: 'sem_efeito' }`, sem linha de transição.
- RN-9 Relógio injetável: `agora: Date` é entrada de `aplicarEventoAssinatura`, da função pura e do job (handler injeta `new Date()` só na borda). Nada usa `Date.now()` no domínio.
- RN-10 Ordem canônica de travas: `salao` (se usado) -> `assinatura FOR UPDATE` (nova posição: após salão, antes de profissional; documentar no cabeçalho de `repos/servico.ts`) -> `assinatura_pagamento` -> `assinatura_transicao`. Assinatura alvo = a vigente (`estado <> 'encerrada'`), senão `NaoEncontrado`/resultado `sem_assinatura`.
- RN-11 Eventos do ponto único: `cobranca_aprovada {pagamentoId, valorCentavos, pagoEm}`, `cobranca_falhou {pagamentoId?, falhouEm}`, `cancelamento`, `prazo` (varredura por tempo, sem dados), `teste_iniciado` (`pendente` -> `em_teste`, `teste_fim_em = agora + DIAS_TESTE` dias; para E6.1/E6.2). Retorno discriminado, nunca lança por regra de negócio; estado incompatível (ex.: aprovada em `encerrada`) -> `{resultado:'ignorado', motivo}` sem escrita. A `valorCentavos` diverge de `PRECO_MENSAL_CENTAVOS` apenas é registrado (não bloqueia).
- RN-12 Teste vencido sem pagamento (suposição S-1): job move `em_teste` com `teste_fim_em <= agora` para `em_carencia` com `primeira_falha_em = teste_fim_em`, `carencia_ate = teste_fim_em + 3 dias` (tolerância a atraso do webhook; PLAN: cobrança no fim do teste); vencida a carência -> `suspensa`. Um salão em `em_teste` vencido cuja carência também já passou vai a `em_carencia` e `suspensa` na mesma execução (duas transições registradas).
- RN-13 Job: varre em lotes (100, `FOR UPDATE SKIP LOCKED`), cada assinatura em transação própria que reaplica a condição sob a trava (reler após lock); idempotente; log só com ids e contagens.

## 5. Critérios de aceitação
CA-1..CA-12 da issue #40, com estas precisões:
- CA-1 `em_teste`, `teste_fim_em` 10/03/2027 00:00Z, aprovada em 10/03/2027 -> `ativa`, `pago_ate` 10/04/2027 (mesmo horário).
- CA-2 `ativa`, falha em D -> `em_carencia`, `carencia_ate` D+3d; 2ª falha em D+1 -> `carencia_ate` e `primeira_falha_em` inalterados, sem nova transição.
- CA-3 `em_carencia` vencida, job -> `suspensa` (1 transição); 2ª execução não escreve nada (0 linhas novas, `atualizado_em` igual). Em `carencia_ate == agora` já suspende (limite inclusivo); em `agora-1ms` não.
- CA-4 `suspensa` + aprovada -> `ativa`; `estadoEfetivoDoSalao` `agendar = true`.
- CA-5 Cancelamento no dia 10 do teste: dia 29 -> `agendar` true; dia 31 (após job ou, sem job, pela regra de cancelada vencida) -> `agendar` false/`encerrada` após o job; zero linhas em `assinatura_pagamento` e zero cobranças em `sim_mp_*`.
- CA-6 `ativa` + `suspenso_manual_em` -> `agendar` false, `cancelar` true, `leitura` true, `configurar` false.
- CA-7 Job e aprovada em paralelo (barreira, 10 repetições, ambas as ordens) -> final `ativa`; nunca `suspensa` com pagamento aplicado; sem `40P01`/5xx; se o job vencer, a transição `suspensa -> ativa` (RN-4) ainda ocorre.
- CA-8 Cada transição gera exatamente 1 linha em `assinatura_transicao` com `de`, `para`, `causa`; UPDATE/DELETE nelas é rejeitado (teste do trigger já existente reaproveitado); `sem_efeito` gera 0 linhas.
- CA-9 Teste com `fim` 10/03/2027, aprovada 01/03/2027 -> `pago_ate` 10/04/2027.
- CA-10 Base 31/01/2027 -> 28/02/2027; base 31/03 -> 30/04; 29/01/2028 +1 = 29/02/2028; 31/12 -> 31/01 (virada de ano). Teste unitário nos dois fusos de processo (`TZ=UTC`, `America/Sao_Paulo`): resultado idêntico.
- CA-11 `suspensa`, `pago_ate` 05/05/2027, regularização 20/05/2027 -> `ativa`, `pago_ate` 20/06/2027.
- CA-12 Mesmo `pagamento_id` 2x e 10x em paralelo -> `pago_ate` avança 1 vez, 1 linha em `assinatura_pagamento`, 1 transição; falha forçada após o INSERT do pagamento (hook de teste) -> rollback: `pago_ate`, estado e `assinatura_pagamento` inalterados.
- CA-13 Cancelamento: `ativa` -> `cancelada` com `acesso_ate = pago_ate`; job após `acesso_ate` -> `encerrada` e o salão pode abrir nova assinatura (índice parcial livre).
- CA-14 Estado inválido: aprovada em `encerrada` -> `ignorado`, nada escrito; `cobranca_falhou` em `suspensa` -> `sem_efeito`.
- CA-15 Teste vencido sem pagamento (RN-12): job -> `em_carencia` com `carencia_ate = fim+3d`; aprovada nesse intervalo -> `ativa` com `pago_ate = pagamento + 1 mês` (regularização).
- CA-16 Isolamento: assinatura/pagamento de um salão nunca afeta outro (teste com dois salões); `estadoEfetivoDoSalao` só lê o salão do contexto.
- CA-17 Handler: cron continua exclusivo, sem payload; falha em uma assinatura não impede o lote (as demais transitam; a falha é logada com ids).
- CA-18 Função pura: tabela de transições exaustiva (7 estados x eventos) coberta por unitário; estados/eventos desconhecidos nunca lançam.

## 6. Casos limite
Fuso: todo cálculo em UTC; a exibição local é da E6.5. Virada de dia: `acesso_ate`/`carencia_ate` exclusivos (`<= agora` expira). Concorrência: job x webhook, webhook x webhook (mesmo `pagamento_id`), cancelamento x aprovada (serializados pela trava; se a aprovada chega após `cancelada`, ignorada com motivo, mas o pagamento é registrado em `assinatura_pagamento` com `aplicado_em` nulo - S-3), cancelamento x job. Salão suspenso manual: a máquina continua rodando (estado da assinatura é independente). Dois registros de assinatura por salão: só a vigente é alvo. Salão sem assinatura: eventos -> `sem_assinatura`; estado efetivo permissivo. Cliente anonimizada: não se aplica. Perfis: `aplicarEventoAssinatura` não verifica papel (chamado por sistema; E6.5 aplica `gestor`).

## 7. Dependências
E0.5, E0.7 (pg-boss), D-033 (auditoria; ações de super admin virão na E8.2, não aqui). Consumidores: E6.1, E6.2, E6.4, E6.5, E8.2, E9.2. MP simulado apenas lido no CA-5.

## 8. Impactos prováveis
- Migração: provavelmente nenhuma (colunas, enum, índice e triggers existem). Avaliar com o DBA: (a) CHECK `assinatura_estado_datas_chk` (ex.: `em_carencia` exige `carencia_ate`; `cancelada` exige `acesso_ate`) - opcional; (b) índice parcial para o job (`(carencia_ate) WHERE estado='em_carencia'`, `(acesso_ate) WHERE estado='cancelada'`, `(teste_fim_em) WHERE estado='em_teste'`) - recomendado se o volume justificar, senão seq scan aceitável; (c) `assinatura_pagamento.status` livre (TEXT) - definir valores `aprovado|recusado` na aplicação.
- Env: nenhuma nova (carência 3 dias e plano em `src/config/plano.ts`: adicionar `DIAS_CARENCIA = 3`).
- Worker: preencher o handler (mantém o cron de 5 min; relógio na borda). Sem nova fila.
- README/CLAUDE.md: atualizar a ordem de travas e o comando de estabilidade (concorrência job x webhook). CI: nenhuma mudança.
- E6.4 substituirá `agendamentoDisponivel` e `politicaDeOperacao` consumindo `estadoEfetivoDoSalao`; esta demanda NÃO os altera (CA de regressão: testes do D-026 continuam passando).

## 9. Dúvidas
Bloqueantes: nenhuma.
Suposições (não bloqueantes): S-1 teste vencido sem pagamento -> `em_carencia` (+3d) e depois `suspensa` (alternativa: direto `suspensa`; recomendo a carência para tolerar atraso de webhook). S-2 cancelar em `pendente`/`em_carencia`/`suspensa` encerra de imediato. S-3 pagamento aprovado após `encerrada`/`cancelada` é registrado sem efeito (reembolso fora do escopo v1). S-4 `teste_iniciado` pertence a esta máquina (E6.1 só o chama).
