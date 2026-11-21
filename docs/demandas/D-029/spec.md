# D-029 (E3.4, issue #35): Reserva manual e encaixe

## 1. Problema
- `criarReserva` (src/server/reservas/criar-reserva.ts:152-200) já tem `modo: 'encaixe'` (pula revalidação, exige `inicio >= agora`, mantém locks e constraint), mas grava `encaixe = (modo === 'encaixe')` (l.200): hoje o flag significa "modo", não "saiu da jornada/bloqueio/funcionamento".
- Não existe detecção do motivo, `confirmarEncaixe`, ação da equipe nem tela. `ROTAS.novaReserva` = `/painel/agenda/nova` (src/config/navegacao.ts:23) está declarada sem página. `reserva.encaixe Boolean @default(false)` existe (prisma/schema.prisma:471), e a agenda E3.3 já mostra o rótulo "Encaixe" (src/server/agenda/tipos.ts:25,43,112). Não há migração.
- Permissão `reserva.criar` já existe (`salao`/`proprio`/`negado`, permissoes.ts:40).

## 2. Objetivo
Gestor e profissional registram reservas na agenda, inclusive fora da jornada, sobre bloqueio ou fora do funcionamento do salão, com aviso explícito, sem nunca sobrepor reserva ativa.

## 3. Escopo
Entra: `src/server/reservas/reserva-equipe.ts` (detecção + orquestração sobre `criarReserva`), `reservas-equipe.acao.ts` (`defineAcao`), shell `src/app/painel/agenda/nova/acoes.ts`, página `/painel/agenda/nova` (+ link "Nova reserva" na agenda E3.3 com profissional/data/hora pré-preenchidos por query), demo `/dev/reserva-nova` (vitrine, E2E sem banco), unitários e integração, E2E.
Fora (PLAN "Fora da v1"): pagamento, lembretes, pacotes, preço/duração por profissional, remarcar/cancelar (E3.5), cliente com conta. Não limita 3 futuras por número, nem antecedência/janela (RN-4/5).

## 4. Regras de negócio
- RN-1 Gestor cria para qualquer profissional ativo do salão; profissional só para si (`profissionalId` = o seu; outro = 403 via matriz/`filtroDeProfissional`, nunca 404 revelador de existência em outro salão: outro salão = 404).
- RN-2 Motivos de encaixe (todos computados no servidor, na mesma transação das travas, não confiar no cliente): `fora_da_jornada` (o atendimento `[inicio,fim)` inteiro não cabe em UM intervalo da jornada do dia local, via `lerSemana` + `fuso.ts`, sem jornada = fora), `bloqueado` (cruza bloqueio próprio ou do salão, `lerBloqueios`, interseção semiaberta), `fora_do_funcionamento` (`lerFuncionamento`; `definido:false` nunca é motivo; dia vazio = fechado). Podem coexistir; a resposta lista todos.
- RN-3 Havendo ≥ 1 motivo e `confirmarEncaixe !== true` (só `true`/`'on'`): nada é gravado; resposta `encaixe_requer_confirmacao` com a lista de motivos e textos pt-BR ("fora da jornada", "horário bloqueado", "fora do funcionamento do salão"). Com confirmação: grava `encaixe = true`. Sem motivo: grava `encaixe = false`, mesmo se `confirmarEncaixe` vier marcado (flag = realidade, não pedido). Mudança mínima em `criarReserva`: aceitar o flag/modo "equipe" que pula a revalidação de disponibilidade (grade, antecedência, janela, já ocupado) mas grava o `encaixe` informado; D-018 intocada.
- RN-4 Sobreposição com reserva ativa é sempre recusada, com ou sem encaixe, só pela constraint `reserva_sem_sobreposicao` (`horario_indisponivel`/`23P01`, mensagem sem revelar quem ocupa). Bloqueio não é coberto pela constraint (risco aceito D-025); a detecção RN-2 corre sob o lock do profissional.
- RN-5 Início no passado (`< agora`) recusado (`inicio`: "não pode estar no passado"), mesmo com confirmação. Início em minutos cheios; não precisa estar na grade. Instante vem de data+hora locais do salão via `instanteDeHoraLocal` (hora inexistente/repetida pela regra do fuso).
- RN-6 Profissional deve executar todos os serviços (`profissional_indisponivel`); serviço/profissional inativo recusado; ids de outro salão = inexistentes.
- RN-7 Cliente por telefone (`normalizarTelefoneBr`) + nome via `upsertCliente` na mesma transação; telefone não brasileiro = erro de campo, nunca 500.
- RN-8 Consentimento declarado pela equipe: checkboxes `CaixasConsentimento` (origem `equipe`, `registrarConsentimentoDaReserva`); `mensagens_reserva` marcado → confirmação nasce `pendente` e é enfileirada após commit; desmarcado → `nao_enviada`, sem envio. Versão lida da config.
- RN-9 Capacidade `agendar` (política `politicaDeOperacao`: salão suspenso/estado → `AcessoNegado` 403 como já faz `criarReserva`); E6.4 troca a política depois.
- RN-10 Mensagem de confirmação registrada na transação (`registrarMensagem`), `enfileirarMensagens` só após commit; falha de envio nunca altera a reserva.
- RN-11 Idempotência: `chaveRequisicao` UUID gerado ao renderizar o formulário (duplo envio = `repetida`, não duplica). Resposta ao reenvio com a mesma chave devolve o mesmo resultado.
- RN-12 Estado visual: a agenda E3.3 já exibe "Encaixe" a partir de `reserva.encaixe`; esta demanda só garante o valor correto (RN-3) e que o rótulo apareça na grade e no detalhe sem depender só de cor.

## 5. Critérios de aceitação
- CA-1 Dado Ana com jornada até 18:00, quando o gestor cria 18:30 sem confirmar, então nada é gravado e a resposta traz motivo `fora_da_jornada` ("fora da jornada") [issue CA-1].
- CA-2 Dado o mesmo pedido com `confirmarEncaixe`, então reserva `confirmado`, `origem = equipe`, `encaixe = true` [CA-2].
- CA-3 Dada reserva de Ana 18:30–19:00, quando a equipe pede 18:45–19:15 com confirmação, então recusa por sobreposição e nada fica gravado (sem cliente nova órfã, sem mensagem) [CA-3, PLAN CA-3].
- CA-4 Dado profissional autenticado, quando cria para outro profissional do mesmo salão, então 403; para profissional de outro salão, 404 [CA-4].
- CA-5 Dada equipe sem declarar `mensagens_reserva`, então a reserva é criada e a mensagem fica `nao_enviada`, sem job [CA-5].
- CA-6 Dado bloqueio de Ana 14:00–15:00 (ou do salão inteiro), quando cria 14:00 sem confirmar, então recusa com "horário bloqueado"; com confirmação cria [CA-6].
- CA-7 Dado funcionamento definido sem sábado, quando cria no sábado dentro da jornada sem confirmar, então `fora_do_funcionamento`; confirmando cria com `encaixe = true`; com `definido:false` não há motivo [CA-R1].
- CA-8 Dado horário dentro de jornada, funcionamento e sem bloqueio, quando criada (mesmo fora da grade ou da antecedência de 2 h), então `encaixe = false` e sem exigir confirmação (RN-4 do issue).
- CA-9 Dado início no passado, com ou sem confirmação, então `invalido` no campo `inicio`.
- CA-10 Dado salão com 3 reservas futuras do mesmo telefone, então a quarta manual é aceita (RN-5 do issue).
- CA-11 Dado o mesmo formulário enviado duas vezes (mesma chave), então uma única reserva, segunda resposta `repetida`.
- CA-12 Dado serviço que Ana não executa, ou serviço/profissional inativo, então recusa sem gravar.
- CA-13 Dado salão suspenso ou política negando `agendar`, então 403, sem gravar.
- CA-14 Dado 10 pedidos paralelos de encaixe sobrepostos para a mesma profissional, então exatamente 1 criada e 9 `horario_indisponivel`, sem 5xx nem impasse.
- CA-15 Dada a agenda do dia/semana, então reserva com `encaixe = true` mostra rótulo textual "Encaixe" e o link "Nova reserva" (gestor: com profissional da vista; profissional: só a própria) leva a `/painel/agenda/nova` com campos pré-preenchidos.
- CA-16 Sem JavaScript: o envio inicial devolve o aviso (motivos) na própria resposta, com checkbox "Confirmo o encaixe" e dados preservados; reenviar confirmado cria. Em 375×812, sem rolagem horizontal, ordem de tabulação lógica, foco no resumo de erros/aviso, axe sem violações (E2E em `/dev/reserva-nova`).
- CA-17 Isolamento: ids de serviço/profissional/cliente de outro salão nunca são aceitos; nenhum dado de outro salão aparece no formulário.
- CA-18 Resultado independe do fuso do processo (UTC e America/Sao_Paulo), inclusive virada de dia e DST (hora inexistente).

## 6. Casos limite
Atendimento que atravessa a meia-noite local (`fim` no dia seguinte) = fora da jornada (jornada não cruza dia) → encaixe; dia seguinte com funcionamento aberto não "salva". Hora local inexistente/repetida (DST). Cliente anonimizada: o telefone antigo não existe mais no cliente; upsert cria nova (comportamento D-022). Cliente existente com outro nome: `upsertCliente` atualiza o nome. Profissional inativo ou com perfil removido: 401/recusa. Salão suspenso: 403. Telefone não brasileiro: erro de campo. Dois encaixes simultâneos: constraint decide. Bloqueio criado entre a detecção e o INSERT: risco aceito (sem coluna no GiST); detecção sob lock do profissional.

## 7. Dependências
D-025 (criarReserva), D-023 (consentimento), D-022 (upsertCliente), D-024 (mensagens), D-018/D-016/D-020 (leituras), D-028 (agenda), D-015 (jornada). Integrações: WhatsApp só via fila (simulado). Sem Turnstile (rota autenticada). Bloqueia E3.5 (#36).

## 8. Impactos
- Dados: sem migração (`encaixe` já existe). DBA: não necessário, salvo se o arquiteto quiser índice; a consulta de bloqueios usa as leituras existentes.
- Infra/CI: nenhum (E2E novo roda no job existente). `criarReserva`: alteração pequena e retrocompatível (flag de encaixe desacoplado do modo); o fluxo público não muda. Revisar `tests` D-025 que assumem `encaixe === (modo==='encaixe')`.
- Mensagem `confirmacao` já cobre o caso.

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposições): (a) `encaixe` grava o estado real (RN-3), não o pedido; (b) data+hora do formulário em minutos cheios, sem exigir grade; (c) detecção de bloqueio/jornada/funcionamento dentro da transação ou imediatamente antes sob o mesmo lock, decisão do arquiteto; (d) cliente "de balcão" sem consentimento é permitido (CA-5); (e) a página de reserva-manual não oferece slots, apenas data/hora livres (a grade de disponibilidade fica para o fluxo público).
