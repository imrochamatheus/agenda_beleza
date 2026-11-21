# D-030 (E3.5) — Design: remarcar, cancelar e marcar status

## 1. Resumo e alternativas
Três serviços em `src/server/reservas/` (`remarcar.ts`, `cancelar.ts`, `marcar-status.ts`), uma máquina pura `status.ts`, um repositório `src/server/repos/reserva-alteracao.ts` (único com SQL), `reservas-status.acao.ts` com `defineAcao`, shell `acoes.ts` e formulários POST no detalhe da reserva. Sem migração.
Descartado: (a) cancelar+recriar reserva (perde id/histórico, contradiz CA-1); (b) `FOR UPDATE` do profissional (bloquearia FK; mantém-se `FOR NO KEY UPDATE`, DEF-1 da D-025); (c) incrementar `revisao` no cancelamento (spec RN-6); (d) novo modelo de status/estado (colunas existem).
Suposições do analista validadas: "terminada" = `agora >= fim`; só `confirmado` remarca; cancelar não incrementa `revisao`; `concluido→nao_compareceu` marca convite `pendente` como `substituida`; a volta não recria o convite (chave única).

## 2. Componentes
- `src/server/reservas/status.ts` (puro, sem I/O): `decidirTransicao({ de, para, inicio, fim, agora }) → { ok: true } | { ok: false, motivo: 'transicao_invalida'|'ainda_nao_iniciada'|'ja_terminada'|'reserva_final' }`. Regras: `cancelado` origem ⇒ `reserva_final`; `de===para` ⇒ `transicao_invalida`; `confirmado→cancelado` exige `agora < fim` (senão `ja_terminada`); `confirmado→concluido|nao_compareceu` exige `agora >= inicio` (senão `ainda_nao_iniciada`); `concluido↔nao_compareceu` ok; `concluido|nao_compareceu→cancelado` ⇒ `transicao_invalida`. `podeRemarcar(status)`.
- `src/server/reservas/remarcar.ts`, `cancelar.ts`, `marcar-status.ts` (sem `next/*`, sem `'use server'`).
- `src/server/repos/reserva-alteracao.ts`, ligado em `Repos.reservasAlteracao`: `travarParaAlterar(ctx,id)` (`SELECT … FROM reserva … FOR UPDATE`, escopo salão; devolve status, inicio, fim, profissional, cliente, revisao, encaixe), `atualizarPosicao`, `atualizarStatus`, `substituirItens` (diff por servico_id), `lerItens`.
- `src/server/reservas/reservas-status.acao.ts`: `remarcarReserva`, `cancelarReserva`, `marcarStatusReserva`, cada uma `defineAcao({ papeis: ['gestor','profissional'], capacidade: ... })`; só delegam ao serviço.
- UI: `src/app/painel/agenda/reservas/[id]/` — `acoes.ts` (shell `'use server'`, converte `FormData`), `AcoesDaReserva.tsx`, `FormularioRemarcar.tsx`, `estado.ts`; edição de `page.tsx`/`DetalheDaReserva.tsx` (só mostra ações que a máquina permite). Vitrine `/dev/reserva-acoes` (404 sem `VITRINE_COMPONENTES=true`/`next dev`; `ROTAS.devReservaAcoes`) para o E2E sem banco.

## 3. Interfaces
```ts
type Dependencias = Pick<DependenciasCriarReserva, 'enfileirar'|'politica'|'aposRevalidar'>;
remarcarReserva(ctx: TenantContext, e: { reservaId; data; hora; profissionalId; servicoIds: string[]; confirmarEncaixe? }, agora, deps?): Promise<ResultadoRemarcar>
cancelarReserva(ctx, { reservaId }, agora, deps?): Promise<ResultadoStatus>
marcarStatusReserva(ctx, { reservaId, para: 'concluido'|'nao_compareceu' }, agora, deps?): Promise<ResultadoStatus>
```
Resultados (`tipos.ts`): `atualizada{reserva}` | `invalido{erros}` | `recusado{motivo: transicao_invalida|ainda_nao_iniciada|ja_terminada|sem_alteracao|reserva_final}` | `horario_indisponivel{causa}` | `servico_indisponivel` | `profissional_indisponivel` | `encaixe_requer_confirmacao{motivos}`. 401/403/404 só por `ErroDeDominio`.
Reutiliza `lerData`/`lerHora`, `detectarMotivos`, `montarItens`, `ehConflitoDeSobreposicao`, `registrarMensagem`, `enfileirarMensagens`, `politicaPadraoDeReserva`.

Fluxo comum (1 transação READ COMMITTED; resultado não `atualizada` = sentinela `DesfazerReserva` lançada dentro e capturada fora, como D-025):
1. Fora da tx: `exigirPermissao(ctx,'reserva.alterar')`; `ehUuid` senão 404; leitura prévia só para descobrir o `profissionalId` da reserva (escopo salão; ausente = 404); `exigirPermissao(ctx,'reserva.alterar',{profissionalId})` (outro profissional = 403). Em remarcar, o profissional-alvo também passa por `exigirPermissao` (profissional não troca de profissional = 403).
2. `politica(ctx, 'agendar'|'cancelar')` antes de abrir a tx (CA-12: nega ⇒ 403, nada gravado).
3. Tx: salão `FOR SHARE` (`travarParaLeitura`, devolve `intervalo_min`) → profissional(is) `FOR NO KEY UPDATE` em ordem de id (o antigo e, se diferente, o novo; `ativo` verificado só no novo) → serviços `FOR SHARE` por id (`RepoServico.travarParaReserva`) → cliente (`FOR KEY SHARE` implícito pelo consentimento; sem alterar linha) → reserva `FOR UPDATE` → releitura do estado e decisão pela máquina com o `agora` de `defineAcao`.
4. Remarcar: exige `status==='confirmado'` (senão `transicao_invalida`/`reserva_final`), `inicio_novo >= agora`; itens: mantidos conservam snapshot e ordem relativa, acrescentados usam o cadastro travado, removidos apagados; `fim` = início + soma do snapshot, `ocupado_ate` = fim + `intervalo_min`; igual ao atual ⇒ `recusado/sem_alteracao` (nada gravado). Validação de horário: `decidirEncaixe` (jornada/bloqueios/funcionamento lidos na tx, como D-029) em vez de reinvocar `consultarDisponibilidade`; a própria reserva não é conflito porque a única verificação de sobreposição com reservas é a exclusion constraint, e o `UPDATE` da própria linha a reavalia contra as demais (CA-5). Sem confirmação com motivos ⇒ `encaixe_requer_confirmacao`; `encaixe` recalculado. `UPDATE reserva SET inicio, fim, ocupado_ate, profissional_id, encaixe, revisao = revisao + 1, atualizado_em = $agora` com literal `'confirmado'` na cláusula `WHERE`; depois `registrarMensagem(ctx,{reservaId,tipo:'remarcacao'},agora,r)` (revisão derivada de `reserva.revisao` já incrementada; substitui `pendente` anteriores). 23P01 (SQLSTATE + nome) capturado FORA da tx ⇒ `horario_indisponivel{causa:'23P01'}`; tx revertida, reserva e mensagens intactas.
5. Cancelar: máquina; `UPDATE status='cancelado', cancelada_em=$agora, atualizado_em`; `registrarMensagem('cancelamento')` (revisão = `reserva.revisao`, sem incremento). O horário volta pois a constraint é parcial em status ativos.
6. Status: máquina; `UPDATE status`; `concluido` (de `confirmado`) ⇒ `registrarMensagem('convite_avaliacao')` (rev 0; no-op por chave única na volta); `concluido→nao_compareceu` ⇒ `RepoMensagem.substituirPendentes` para `convite_avaliacao` da reserva (`pendente`→`substituida`; `enviada` intacta). Gancho E4.5 (comentário em `marcar-status.ts`, sem schema): link só vale com `status='concluido'`; avaliações filtradas por `reserva.status='concluido'` nas listagens/médias; ao voltar a `concluido` reaparecem.
7. Pós-commit: `enfileirarMensagens` (nunca lança; falha só loga `mensagem.fila_indisponivel`). Cliente anonimizada: `registrarMensagem` já nasce `cancelada_anonimizacao` sem fila; nenhuma operação é bloqueada.
Ponto `politica`: `deps.politica` (padrão `politicaPadraoDeReserva`); E6.4 troca para suspenso/readonly (cancelar continua liberado).

## 4. Dados
Sem migração e sem enum novo (`substituida` existe). Colunas usadas: `reserva.{inicio,fim,ocupado_ate,profissional_id,encaixe,status,revisao,cancelada_em,atualizado_em}`, `reserva_item`. `reserva … FOR UPDATE` é por PK; diff de `reserva_item` por `reserva_id` (índice FK já existe). DBA: **dispensado** (justificativa: sem DDL, sem índice novo; as consultas novas são por PK/FK e a constraint parcial permanece; o literal `'confirmado'` mantido no UPDATE de remarcar). Se o desenvolvedor encontrar plano suspeito no `UPDATE`, abrir parecer.

## 5. Infraestrutura
Nenhuma variável de ambiente, container ou CI novos; E2E entra nos jobs existentes. DevOps: **dispensado**. README/CLAUDE.md atualizados pelo desenvolvedor.

## 6. Invariantes
- Escopo por salão: toda leitura/escrita via `repos()` com `ctx`; reserva alheia/inexistente/malformada = 404 uniforme; matriz `reserva.alterar` no servidor (CA-6, CA-14).
- Exclusion constraint: continua a garantia final; remarcar é `UPDATE` da mesma linha e cai na constraint; encaixe também (CA-9).
- UTC/fuso: data+hora locais convertidas só por `tempo/fuso.ts`; testes em dois fusos.
- Adaptadores: nenhuma integração nova; WhatsApp só via outbox/fila.
- Soft delete/anonimização: cancelar nunca apaga; cliente anonimizada operável (RN-7).
- Suspenso/somente leitura: delegado a `politica` (E6.4); cancelar permanecerá permitido e notificando.
- Idempotência: chave `reserva:tipo:revisao`; clique duplo recusado pela máquina; `ON CONFLICT DO NOTHING`.
- Auditoria do super admin: não se aplica (ações da equipe).

## 7. Riscos
- R-1 Deadlock entre dois remarcar com troca cruzada de profissionais: travas em ordem de id + `FOR UPDATE` da reserva por último; teste com `pg_stat_activity`.
- R-2 `FOR NO KEY UPDATE` no profissional serializa remarcações do mesmo profissional (aceito, DEF-1).
- R-3 Reserva `confirmado` já iniciada remarcada para o futuro: permitido (suposição do spec).
- R-4 Convite `pendente` nunca enviado e `substituida`: não é recriado na volta (aceito, spec §9 c).
- R-5 Bloqueio não coberto pela constraint (risco aceito da D-025) ⇒ sem alteração.

## 8. Testes
Unitários: `status.ts` (tabela completa e fronteiras `agora==inicio`, `agora==fim`, `fim-1ms`: CA-4, CA-7), validação de entrada, montagem de itens/snapshot (CA-8), componentes React e estado da UI (CA-13). Integração (PostgreSQL real, `tests/integration/reservas/`): CA-1, 2, 3, 5, 6, 8, 9, 10, 11, 12, 14, R1, R2, R3 (adaptador WhatsApp falhando); concorrência (remarcar × remarcar mesmo slot ×10 com e sem barreira, cancelar × remarcar, status × cancelar, remarcar × desativar profissional) rodada 10 vezes; `TZ=UTC` e `America/Sao_Paulo` (CA fuso/DST). Playwright (`/dev/reserva-acoes`, 375×812, sem JS, teclado, axe 4.14.0, sem rolagem horizontal): CA-13. Cobertura ≥ 90 % mantida com testes das novas unidades.

## 9. Tarefas
- **T-1 (desenvolvedor, sem deps)** `status.ts` + `status.test.ts`, `tipos.ts` (acréscimos de resultados/mensagens pt-BR). Posse: `src/server/reservas/status*.ts`, `src/server/reservas/tipos-alteracao.ts`. Conclusão: tabela da máquina 100 % testada.
- **T-2 (desenvolvedor, dep. T-1)** `src/server/repos/reserva-alteracao.ts` (+ registro em `repos/index.ts`/`transacao`), `RepoMensagem` estendido para substituir só `convite_avaliacao`. Posse: esses arquivos. Conclusão: testes de integração do repositório e escopo de salão.
- **T-3 (desenvolvedor, dep. T-1, T-2)** serviços `remarcar.ts`, `cancelar.ts`, `marcar-status.ts` + `reservas-status.acao.ts` + testes unit/integração e de concorrência (`tests/support/reservas.ts` pode ganhar helpers; posse do arquivo só desta tarefa). Conclusão: CA-1..12, 14, R1..R3 verdes, 10 execuções estáveis.
- **T-4 (desenvolvedor, dep. T-3 para os tipos; pode rodar em paralelo com a parte de testes de T-3 após o contrato de `tipos` congelado em T-1)** UI: `[id]/acoes.ts`, componentes, estado, `page.tsx`, `DetalheDaReserva.tsx`, `/dev/reserva-acoes`, `ROTAS`/`navegacao.ts`, `e2e/reserva-acoes*.spec.ts`. Posse: `src/app/painel/agenda/reservas/**`, `src/app/dev/reserva-acoes/**`, `src/config/navegacao.ts`, `e2e/reserva-acoes*`. Conclusão: CA-13 verde.
- **T-5 (desenvolvedor, dep. T-3, T-4)** README, CLAUDE.md, comandos de estabilidade; cobertura. Posse: `README.md`, `CLAUDE.md`.
T-1 e (após o contrato de tipos) T-2 podem rodar em paralelo; T-3 e T-4 podem rodar em paralelo sem arquivos comuns.
Mapeamento CA → tarefa/teste: CA-4,7 → T-1 (unit); CA-1,2,3,5,6,8,9,10,11,12,14,R1,R2,R3 → T-3 (integração); CA-13 → T-4 (Playwright + unit).
