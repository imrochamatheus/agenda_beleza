# D-030 (E3.5, issue #36) — Remarcar, cancelar e marcar status

## 1. Problema
Inexistente. O detalhe da reserva (`src/app/painel/agenda/reservas/[id]/page.tsx`, `DetalheDaReserva.tsx`) é somente leitura (D-028 RN-10). Já existem: `criarReservaDaEquipe` + `detectarMotivos` (encaixe, D-029), `registrarMensagem` (D-024; `remarcacao` exige `reserva.revisao >= 1` e usa `revisao = reserva.revisao`; `cancelamento` usa `reserva.revisao`; `confirmacao`/`convite_avaliacao` revisão 0, `src/server/mensagens/registrar.ts:19-40`), `conferirVigencia` (`elegibilidade.ts:45`: `convite_avaliacao` só é vigente com `status = 'concluido'`, caso contrário o worker o fecha como `substituida`), `politicaPadraoDeReserva(ctx, capacidade)` (`criar-reserva.ts:42`, gancho da E6.4), capacidades `agendar`/`cancelar` (`tenant/context.ts:20`), operações `reserva.criar`/`reserva.alterar` (`permissoes.ts:40`: salão/próprio/negado). `reserva` tem `revisao`, `cancelada_em`, `ocupado_ate` (`schema.prisma:458-475`). S2 (D-001 spec:75).

## 2. Objetivo
A equipe remarca, cancela e registra o resultado do atendimento, com as mensagens na mesma transação (outbox) e a conclusão criando o convite de avaliação (D-019).

## 3. Escopo
Entra: `src/server/reservas/{remarcar,cancelar,marcar-status}.ts` + `reservas-status.acao.ts` (`defineAcao`, sem `'use server'`), shell `acoes.ts` em `src/app/painel/agenda/reservas/[id]/`, formulários POST no detalhe (sem JS, 375×812, teclado), `status.ts` puro (máquina S2). Fora: tela/schema de avaliação e link (E4.5; só o gancho, §6), bloqueio por estado do salão além de passar por `politica` (E6.4), anonimização (E5.2), status de envio (E7.3), cancelar pelo cliente (fora da v1). Nenhum conflito com "Fora da primeira versão".

## 4. Regras de negócio
- RN-1 Permissão: gestor em qualquer reserva do salão; profissional só nas próprias (`exigirPermissao(ctx,'reserva.alterar',{profissionalId})`). Reserva de outro salão/inexistente/id malformado: 404 uniforme; outro profissional do salão: 403 (CA-6, como `reserva.criar`).
- RN-2 Capacidades: remarcar = `agendar`; cancelar e marcar status = `cancelar`; ambas via `politica` injetável (padrão `politicaPadraoDeReserva`), E6.4 a troca. Salão suspenso hoje não é bloqueado por esta demanda (a política padrão só aplica a capacidade; E6.4 faz o resto).
- RN-3 Máquina (S2), pura e testável: `confirmado→cancelado` só com `agora < fim`; `confirmado→concluido|nao_compareceu` só com `agora >= inicio`; `concluido↔nao_compareceu` permitido; `cancelado` final (toda transição recusada); mesma-para-mesma é recusada (`recusado/transicao_invalida`, sem gravar). "Terminada" = `agora >= fim` (fim do atendimento, não `ocupado_ate`). O `agora` é o de `defineAcao`. Em reserva terminada só `concluido`/`nao_compareceu` são possíveis; remarcar só `confirmado` (decisão: remarcar reserva `concluido`/`nao_compareceu`/`cancelado` é recusado) e, para início novo, vale `inicio >= agora` como em D-029.
- RN-4 Remarcar = UPDATE da MESMA reserva (id inalterado), uma transação READ COMMITTED, travas canônicas (salão `FOR SHARE` → profissional(is) `FOR NO KEY UPDATE`, em ordem de id se dois → serviços `FOR SHARE` → cliente → reserva/itens), `ativo` sob a trava. Entrada: início (data/hora), profissional, serviços (lista completa). Profissional só remarca dentro da própria agenda (não pode trocar para outro profissional). Revalida com as regras de D-029 (`consultarDisponibilidade` excluindo a própria posição, ou encaixe com aviso e `confirmar_encaixe`); a antiga posição da própria reserva não conta como conflito (CA-5: 10:00–11:00 → 10:30–11:30). A restrição `reserva_sem_sobreposicao` continua sendo a garantia final (23P01 reconhecido por SQLSTATE + nome, fora da transação; `horario_indisponivel`, reserva intacta, CA-2). `encaixe` é recalculado para a nova posição.
- RN-5 Itens: serviços mantidos conservam o snapshot (preço/duração) e a ordem relativa; serviços acrescentados ganham snapshot novo do cadastro atual (trava `FOR SHARE`); removidos são apagados; ao menos um serviço; o profissional novo deve fazer TODOS os serviços (vínculo ativo). `fim` = início + soma das durações do snapshot; `ocupado_ate` = fim + `intervalo_min` vigente do salão. Sem alteração efetiva (mesmos início, profissional e serviços) → `recusado/sem_alteracao`, nada gravado, `revisao` intacta.
- RN-6 Revisão e mensagens: remarcação incrementa `reserva.revisao` (+1) ANTES de `registrarMensagem(tipo 'remarcacao')`, tudo na mesma transação; `enfileirarMensagens` só após o commit. Cancelamento NÃO incrementa `revisao`; grava `status='cancelado'`, `cancelada_em=agora` e `registrarMensagem('cancelamento')` (chave `reserva:cancelamento:<revisao>`); repetir o cancelamento é recusado pela máquina (sem 2ª mensagem). Mensagem segue consentimento (D-024); sem consentimento nasce `nao_enviada` e a ação segue.
- RN-7 Cliente anonimizada: todas as operações permitidas; a mensagem nasce `cancelada_anonimizacao` (já tratado por `registrarMensagem`). Nunca lançar 500.
- RN-8 `concluido` (de `confirmado`): grava o status e chama `registrarMensagem('convite_avaliacao')` (revisão 0) na mesma transação; sem consentimento `convite_avaliacao` nasce `nao_enviada`, sem erro. A volta `nao_compareceu→concluido` chama `registrarMensagem` de novo, que é no-op pela chave única (`ON CONFLICT DO NOTHING`, não enfileira): não reenvia (CA-R2).
- RN-9 `concluido→nao_compareceu`: o convite `pendente` da reserva passa a `substituida` (explícito, mesma transação; mensagem já `enviada` não muda) e o gancho de E4.5 (§6) é documentado. Mesmo sem isso o worker já recusa o convite quando `status <> concluido` (`conferirVigencia`).
- RN-10 Falha de fila/WhatsApp nunca altera a reserva (CA-R3): a gravação é a transação; o envio é assíncrono.
- RN-11 Concorrência: duas operações na mesma reserva serializam por trava de linha da reserva (`FOR UPDATE`) após as travas de salão/profissional; a segunda relê o estado e é avaliada pela máquina (cancelar × concluir, cancelar × cancelar, remarcar × remarcar).
- RN-12 Resultados discriminados em `{ ok:true, dados }`: `atualizada`, `invalido`, `recusado` (`transicao_invalida`, `ainda_nao_iniciada`, `ja_terminada`, `sem_alteracao`, `reserva_final`), `horario_indisponivel`, `servico_indisponivel`, `profissional_indisponivel`, `encaixe_requer_confirmacao`; 401/403/404 só por `ErroDeDominio`.

## 5. Critérios de aceitação (Dado/Quando/Então; automatizáveis)
- CA-1 Reserva confirmada de Ana; gestor remarca para Bia (faz todos os serviços) em horário livre → mesma id, profissional Bia, `revisao` +1, mensagem `remarcacao` `pendente` com essa revisão, anteriores `pendente` `substituida` (PLAN CA 4).
- CA-2 Remarcar para horário ocupado → `horario_indisponivel`; reserva, itens, `revisao` e mensagens intactos; também sob corrida (2 remarcações para o mesmo slot: uma vence, sem 5xx/impasse).
- CA-3 Reserva futura cancelada → `cancelado`, `cancelada_em` preenchido, o horário volta à disponibilidade (E3.1) e há mensagem `cancelamento` `pendente`.
- CA-4 `confirmado` com `inicio > agora` marcada `concluido` ou `nao_compareceu` → `recusado/ainda_nao_iniciada`, nada gravado, nenhuma mensagem; com `inicio <= agora` → aceita (fronteira `agora == inicio` aceita).
- CA-5 10:00–11:00 → 10:30–11:30 do mesmo profissional → aceita, UPDATE da mesma reserva.
- CA-6 Profissional cancelando/remarcando/marcando reserva de outro profissional → 403; remarcando a própria para outro profissional → recusado/403; reserva de outro salão → 404.
- CA-7 `cancelado` + qualquer transição → recusada; `confirmado` com `agora >= fim` → cancelar recusado (`ja_terminada`), fronteira `agora == fim` recusa e `fim - 1 ms` aceita; `concluido↔nao_compareceu` aceitos nos dois sentidos.
- CA-8 Remarcação mantém snapshot dos serviços inalterados mesmo após o cadastro mudar de preço/duração; serviço acrescentado usa snapshot atual; `ocupado_ate` = `fim` + intervalo vigente; sem mudança → `sem_alteracao`.
- CA-9 Encaixe: remarcar para fora da jornada/bloqueio/funcionamento exige confirmação (`encaixe_requer_confirmacao` com motivos), com confirmação grava `encaixe=true`; sem sobreposição mesmo assim (constraint).
- CA-10 Cliente anonimizada: cancelar, remarcar e concluir funcionam; mensagens `cancelada_anonimizacao`, nenhum job.
- CA-11 Atomicidade: se `registrarMensagem` falha, o status/horário não muda; se a fila falha após o commit, a reserva permanece e loga `mensagem.fila_indisponivel`.
- CA-R1 `confirmado→concluido` com consentimento `convite_avaliacao` → uma mensagem `convite_avaliacao` revisão 0 `pendente`, criada na mesma transação, enfileirada após o commit; sem consentimento → `nao_enviada`, sem job.
- CA-R2 `concluido→nao_compareceu` → convite `pendente` fica `substituida` (e o worker recusa o convite mesmo se já enfileirado); `nao_compareceu→concluido` não cria nem reenfileira convite (ainda 1 linha).
- CA-R3 Falha do adaptador WhatsApp não altera a reserva.
- CA-12 Política: com `politica` injetada negando, as três operações lançam 403 e não gravam (gancho da E6.4).
- CA-13 UI: no detalhe, formulários POST (ações permitidas só quando a máquina permite), funcionam sem JavaScript, em 375×812 sem rolagem horizontal, ordem de tab lógica, `axe` sem violações, estado do resultado na resposta (padrão: sem PRG para erros; PRG para sucesso mostrando "Reserva cancelada/atualizada"); cancelar pede confirmação por segundo passo sem diálogo JS; salão sem JS tem mesmo fluxo.
- CA-14 Isolamento: tentativa de operar reserva de outro salão (id adivinhado) não altera nada e responde 404 igual ao inexistente.

## 6. Casos limite
- Fuso/virada de dia: remarcação para outro dia local e atravessando DST; data/hora convertidas só por `tempo/fuso.ts`; testar em `TZ=UTC` e `America/Sao_Paulo`.
- Concorrência: ver RN-11 e CA-2; remarcar × desativar profissional (trava do profissional, `ativo` verificado); `FOR SHARE → NO KEY UPDATE` proibido.
- Salão suspenso: só E6.4 (cancelar continuará permitido e notificando); nada aqui.
- Telefone/consentimento: mensagens seguem D-024; sem telefone válido → `nao_enviada`.
- Clique duplo no cancelar/concluir: o 2º é recusado pela máquina (sem 2ª mensagem). Remarcar duas vezes seguidas gera `revisao` 2 e nova mensagem (decisão do usuário P1).
- Remarcar reserva `confirmado` já iniciada mas não terminada: permitido se o novo início for futuro; (suposição).
- Gancho E4.5 (sem schema agora): ao `nao_compareceu`, E4.5 deve (a) recusar o link porque o status mudou, (b) excluir a avaliação das listagens/médias filtrando por `reserva.status='concluido'`; ao voltar a `concluido` a avaliação reaparece. Documentar em `design.md` e comentário no serviço; nenhuma tabela nova.

## 7. Dependências
D-028 (detalhe), D-029 (encaixe, validação), D-025 (travas), D-024 (outbox/fila), D-023 (consentimento), E6.4 (consumirá `politica`), E4.5 (D-032) e E5.2 (D-031) consumirão os efeitos. Sem integração nova (WhatsApp simulado nos testes).

## 8. Impactos
Dados: nenhuma migração prevista (colunas existem; `substituida` existe no enum). Verificar com o DBA apenas se `reserva … FOR UPDATE` e o diff de `reserva_item` precisam de índice (esperado que não). Infra/CI: nenhuma; E2E novo (`/dev/...` só se precisar de demo sem banco, ou o detalhe real via seed de teste), cobertura ≥ 90%. Novo repositório de leitura/escrita em `src/server/repos/` (único lugar com Prisma); eventual novo `RepoMensagem` para substituir `convite_avaliacao` pendente (reaproveitar `substituirPendentes` com tipos/revisão adequados). Atualizar CLAUDE.md/README.

## 9. Dúvidas
Bloqueantes: nenhuma.
Suposições (não bloqueiam): (a) "terminada" = `agora >= fim`; (b) remarcar só `confirmado`; (c) convite pendente vira `substituida` no `concluido→nao_compareceu` e não é recriado na volta (idempotência), mesmo que nunca tenha sido enviado; (d) profissional não remarca para outro profissional; (e) cancelamento mantém `revisao`; (f) sem motivo de cancelamento (campo fora do schema).
