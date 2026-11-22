# D-043 — E7.3 Situação de envio das mensagens (spec)

## 1. Problema
- A equipe não vê se a mensagem de WhatsApp da reserva saiu. `lerReservaDaAgenda` diz "Sem mensagens" (`src/server/agenda/consultar.ts`, doc do detalhe) e `src/app/painel/agenda/reservas/[id]/page.tsx` não lê `mensagem`.
- `mensagensDaReserva` (`src/server/mensagens/leitura.ts`) existe, mas só escopa por salão: `listarDaReserva` (`repos/mensagem.ts:268`) não filtra por profissional. Usá-la direto vazaria mensagens de reserva alheia a um profissional (CA-3).
- A grade da agenda (`consultarAgenda`, 6 SQL constantes, CA-16 da D-028) não tem indicação de falha. `LinhaAgenda`/`COLUNAS` em `repos/agenda.ts:64` não trazem mensagem.
- PLAN.md "Interface": estado claro de falha de envio. Hoje: inexistente.

## 2. Objetivo
A equipe que pode ver a reserva vê a situação de cada mensagem dela e percebe na grade, sem abrir, quando há falha de envio. Somente leitura.

## 3. Escopo
Entra: lista de mensagens no detalhe `/painel/agenda/reservas/[id]`; marca de falha nos blocos da grade (dia e semana); `src/server/mensagens/consultar-por-reserva.ts` (escopo de quem vê a reserva); `src/components/agenda/SituacaoMensagens.tsx`; rótulos pt-BR em módulo client-safe.
Fora: reenvio (E8.3, super admin; não há botão nem ação); alterar pipeline, estados ou migração; exibir destinatário, parâmetros, link, id do provedor ou `erro_detalhe`; lembretes e promoções (PLAN.md "Fora da primeira versão"); notificação ativa (e-mail/alerta) de falha.

## 4. Regras de negócio
- RN-1 (issue): quem vê a reserva vê as mensagens: operação `agenda.ver` (`salao` gestor, `proprio` profissional). Profissional só das reservas do próprio perfil. Reserva de outro profissional, de outro salão, inexistente ou id malformado: `NaoEncontrado` → 404, igual em todos os casos. 403 só sem `agenda.ver` (já tratado pela página).
- RN-2 (issue): falha não bloqueia nem desabilita nenhuma ação da reserva (remarcar, cancelar, marcar resultado). A leitura das mensagens não altera `acoesPermitidas`.
- RN-3 (issue): `nao_enviada` mostra motivo; `substituida` mostra "substituída por remarcação posterior".
- RN-4: leitura sempre permitida, inclusive salão suspenso (D-038/D-028 RN-4); nenhuma checagem de assinatura.
- RN-5 (D-024 RN-23): só `tipo`, `revisao`, `estado`, `erroCodigo` (mapeado), nº de tentativas e data/hora da última tentativa chegam à UI. Nunca telefone, parâmetros, link, `provedor_mensagem_id`, `erro_detalhe`. `erroCodigo` bruto não é exibido: só mapeado numa lista fechada, código desconhecido → sem motivo.
- RN-6: mostrar TODAS as mensagens da reserva (todas as revisões e tipos), ordem cronológica de criação (`criado_em, id`), a mais recente primeiro destacada não; ordem crescente como `listarDaReserva`. A revisão aparece no rótulo só para `remarcacao` ("Remarcação 1", "Remarcação 2"…). Sem paginação (poucas por reserva).
- RN-7: data da última tentativa (`ultimaTentativaEm`) formatada no fuso do salão via `src/lib/format.ts` (formatador existente de data e hora; nenhum `Intl`/`toLocale*` fora dele). Sem tentativa (0): sem data. Mostrar também "N tentativas" quando N ≥ 2.
- RN-8 (rótulos; tipos: Confirmação, Remarcação, Cancelamento, Convite de avaliação; em minúsculas na frase):
  - Emenda de gênero (design §0): Confirmação e Remarcação concordam no feminino ("enviada", "não enviada", "substituída", "sendo enviada"); Cancelamento e Convite de avaliação no masculino ("enviado", "não enviado", "substituído", "sendo enviado"). Remarcação leva a revisão ("Remarcação 1"). Onde abaixo está "enviada/não enviada/substituída/sendo enviada", vale a concordância.
  - `enviada`: "{Tipo} enviada" (ex. "Confirmação enviada", "Cancelamento enviado", "Convite de avaliação enviado").
  - `falhou`: "Falha ao enviar {tipo} por WhatsApp" (convite: "Falha ao enviar convite de avaliação por WhatsApp") + data da última tentativa. Motivo opcional: `resultado_incerto` → "Não foi possível confirmar se a mensagem foi entregue."; `link_indisponivel` → "Link de avaliação indisponível."; demais: sem motivo.
  - `pendente`: "{Tipo} aguardando envio". `enviando`: "{Tipo} sendo enviada" (convite: "enviado").
  - `nao_enviada`: "{Tipo} não enviada" + motivo: `sem_consentimento` → "A cliente não autorizou receber mensagens."; outro código → sem motivo.
  - `cancelada_anonimizacao`: "{Tipo} não enviada" + "Cliente removida; a mensagem foi cancelada." (texto da cliente via `TEXTO_CLIENTE_REMOVIDA` de `src/server/clientes/tipos.ts`, nunca copiado; capitalizado na frase).
  - `substituida`: "{Tipo} substituída por remarcação posterior" (para `erroCodigo` `obsoleta`: "{Tipo} não enviada: a reserva mudou antes do envio").
  - Estado desconhecido não ocorre (união fechada, tipada); `switch` exaustivo, com teste que percorre tipo × estado.
- RN-9: estado visível por texto, não só por cor/ícone (acessibilidade, teclado, leitor de tela). A falha é destacada (`role`/texto próprio), os demais estados ficam neutros ou de sucesso.
- RN-10: reserva sem mensagens (ex. criada antes da E7.1): "Nenhuma mensagem de WhatsApp para esta reserva."
- RN-11 (grade): bloco de reserva com falha exibe marca com texto acessível ("Falha ao enviar mensagem") na grade do dia e na lista da semana. "Tem falha" = existe mensagem `falhou` VIGENTE da reserva, mesma regra de coerência do envio (D-024 RN-16): `confirmacao`/`remarcacao` com `revisao = reserva.revisao` e status `confirmado`; `cancelamento` com `revisao = reserva.revisao` e status `cancelado`; `convite_avaliacao` com status `concluido`. Falha obsoleta (reserva remarcada depois, ou confirmação falha de reserva depois cancelada) aparece no detalhe, mas não marca a grade.
- RN-12 (grade): obtida no MESMO comando de `listarAgenda`/`detalhe` por `EXISTS (SELECT 1 FROM mensagem m WHERE m.salao_id = r.salao_id AND m.reserva_id = r.id AND m.estado = 'falhou' AND …)` ou agregado equivalente: nº de instruções da `consultarAgenda` continua 6, constante com N reservas. A grade nunca lê telefone, destinatário nem `erro_*`. O literal `'falhou'` fica no SQL.
- RN-13: o detalhe usa 1 chamada nova (escopo + lista); o detalhe pode somar instruções (sem teto de CA-16, que vale para `consultarAgenda`). Preferível uma só leitura que valide reserva+profissional e liste.
- RN-14: cliente anonimizada: mensagens continuam listadas (estado e data); nenhuma referência a nome/telefone; `cancelada_anonimizacao` conforme RN-8.

## 5. Critérios de aceitação
- CA-1 (issue CA-1): Dado reserva com `confirmacao` em `falhou` (≥1 tentativa), Quando gestor ou o profissional dono abre `/painel/agenda/reservas/[id]`, Então vê "Falha ao enviar confirmação por WhatsApp" e a data/hora da última tentativa no fuso do salão (conferir com salão em fuso ≠ do processo, `TZ=UTC` e `America/Sao_Paulo`).
- CA-2 (issue CA-2): Dado mensagem `enviada`, Quando abre, Então mostra "Confirmação enviada".
- CA-3 (issue CA-3): Dado profissional A e reserva do profissional B (mesmo salão), Quando A consulta a situação das mensagens (função e página), Então `NaoEncontrado`/404, idêntico a id inexistente, malformado ou de outro salão (não distingue). Gestor de outro salão: 404.
- CA-4 (RN-8): Para cada tipo × estado, o rótulo é o da RN-8 (teste de componente/unidade tabular); `nao_enviada/sem_consentimento` mostra o motivo; `substituida/substituida` mostra "substituída por remarcação posterior"; `cancelada_anonimizacao` mostra o motivo da cliente removida.
- CA-5 (RN-5): Dado mensagens com `destinatario_e164`, `parametros`, `provedor_mensagem_id` e `erro_detalhe` preenchidos, Então o DTO/HTML não contém nenhum desses valores (asserção por valor sentinela no HTML e no JSON serializado) nem o `erroCodigo` bruto.
- CA-6 (RN-6): Dado reserva remarcada 2 vezes (confirmacao 0 `substituida`, remarcacao 1, remarcacao 2), Então as 3 aparecem em ordem de criação, com "Remarcação 1" e "Remarcação 2".
- CA-7 (RN-2): Dado mensagem `falhou`, Então os botões remarcar/cancelar/marcar resultado seguem os mesmos de `acoesPermitidas` e as server actions funcionam (reserva continua `confirmado` após a falha).
- CA-8 (RN-11/12): Dado agenda com reservas, uma com `confirmacao falhou` vigente, Quando `consultarAgenda` roda, Então o bloco dessa reserva traz `temFalhaDeMensagem = true` e as demais `false`, e a contagem de instruções SQL continua 6 com 1 e com 50 reservas (reutilizar o contador do teste CA-16 da D-028).
- CA-9 (RN-11): Dado falha obsoleta (reserva remarcada depois ou cancelada com a confirmação falha), Então a grade não marca e o detalhe a lista.
- CA-10 (RN-1, RN-12): Dado profissional A, Então a grade de A não marca nem expõe falha de reserva de B (a agenda já filtra por profissional; teste de regressão).
- CA-11 (RN-4): Dado salão suspenso, Então detalhe e grade mostram as mensagens normalmente.
- CA-12 (RN-14): Dado cliente anonimizada com `confirmacao` `cancelada_anonimizacao`, Então o detalhe mostra o rótulo e "Cliente removida", sem nome/telefone.
- CA-13 (RN-10): Reserva sem mensagens mostra o texto vazio.
- CA-14 (RN-9): A marca na grade e a lista têm texto acessível; axe sem violações (`/dev` demo se o designer criar; senão teste de componente) e navegação por teclado inalterada.
- CA-15: Nenhum import novo de `next/*` em `src/server/mensagens/`; rótulos em módulo client-safe; cobertura global ≥ 90%.

## 6. Casos limite
- Fuso/virada de dia: data da tentativa em 23:50 local formata no dia local do salão, não UTC.
- Concorrência: a leitura não trava (sem `FOR`); o estado mostrado pode estar defasado de um envio em curso (`enviando`→`enviada`); aceitável, a página é `force-dynamic`.
- `falhou` com tentativas = 0 (não ocorre pelo pipeline, mas `link_indisponivel` fecha sem chamar o adaptador e sem abrir tentativa): mostrar "Falha…" sem data. Assumir `ultimaTentativaEm = null` ⇒ sem data; não usar `atualizado_em` (não está no DTO).
- `enviando` preso: aparece até a reconciliação (5 min) fechar como `falhou`; não é erro de UI.
- Isolamento: mensagens e reservas filtradas por `salao_id` e, para profissional, por `profissional_id`; `listarDaReserva` isolada não basta.
- Profissional desativado/gestor sem perfil: gestor vê todas; profissional inativo já recebe 401 na sessão.
- Telefone não brasileiro: não se aplica (cliente exige telefone BR).
- Convite de avaliação: só reserva `concluido`; `link_indisponivel` até a E4.5 injetar o gerador, então mostrar "Falha ao enviar convite de avaliação por WhatsApp" + "Link de avaliação indisponível." é esperado.
- Muitas mensagens: sem limite prático; se > 50, truncar não é necessário na v1.

## 7. Dependências
E7.1/D-024 (`mensagem`, `mensagem_tentativa`, `listarDaReserva`), E3.3/D-028 (detalhe e grade), D-038 (leitura liberada), `format.ts`, `TEXTO_CLIENTE_REMOVIDA`. Bloqueia E9.4. Sem integração externa. O designer entra depois (conteúdo/estados acima; visual fora desta spec): estados a desenhar = lista vazia, enviada, aguardando/enviando, falha (com data e motivo), não enviada (com motivo), substituída, marca de falha na grade (dia/semana, 375 px).

## 8. Impactos
- Dados: nenhuma migração prevista (FK composta e `UNIQUE(reserva_id,tipo,revisao)` já indexam a busca por `reserva_id`). Arquiteto confirma com `EXPLAIN` do `EXISTS` na grade; só então acionar DBA.
- Env: nenhuma. CI/infra: nenhum. README: sem credencial nova; atualizar CLAUDE.md (D-043) e, se o README descrever a agenda, uma linha.
- Código: `LinhaAgenda`, `ReservaDaAgenda` e `DetalheDaReserva` ganham campo; `VistaDaAgenda`/`GradeDoDia`/`ListaDaSemana` mostram a marca.

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposição):
- Mostrar histórico de todas as revisões (RN-6) em vez de só a vigente: adotado todas, ordem crescente.
- "Falha na grade" só quando vigente (RN-11): adotado; alternativa mais simples (qualquer `falhou`) gera alarme falso em reservas já canceladas. Arquiteto pode simplificar se o custo do predicado for relevante.
- Motivos de `falhou` mapeados só para `resultado_incerto` e `link_indisponivel`; códigos da porta (ex. `limite_de_taxa`) não são exibidos.
