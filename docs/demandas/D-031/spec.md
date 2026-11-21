# D-031 — E5.2 Anonimizar cliente (issue #45)

## 1. Problema
Inexistente: não há `anonimizar` nem ação "excluir cliente". Evidência: `src/server/clientes/clientes.acao.ts` só tem `editarCliente`; `RepoCliente` (`src/server/repos/cliente.ts`) não tem escrita de anonimização. Já existem: CHECK `cliente_anonimizacao_chk` (nome e telefone nulos ⇔ `anonimizada_em`, migração `20261118000200_restricoes_sql`), UNIQUE `(salao_id, telefone_e164)` NULLS DISTINCT, estado `cancelada_anonimizacao`, `mensagem.destinatario_e164`/`parametros`, `mensagem_tentativa.erro_detalhe` anuláveis, worker/T1 que já recusa cliente anonimizada (`mensagens/envio.ts`, `mensagem-sistema.ts`), `buscar`/`atualizar` que ignoram anonimizadas, página `/painel/clientes/[id]` que já mostra "Cliente removida" e capacidade `lgpd` declarada em `tenant/context.ts`.

## 2. Objetivo
O gestor atende pedido de exclusão de dados pessoais (LGPD) anonimizando a cliente de forma irreversível, mantendo reservas e histórico, sem dado pessoal remanescente em cliente/mensagem/tentativa, e deixando o contrato pronto para a E4.5 retirar a avaliação.

## 3. Escopo
Entra: serviço `src/server/clientes/anonimizar.ts`; `RepoCliente.anonimizar`; ação `anonimizarCliente` em `clientes.acao.ts` (`papeis: ['gestor']`, `capacidade: 'lgpd'`); casca `acoes.ts`; confirmação em duas etapas na página de detalhe; testes. Fora: avaliação (E4.5, sem schema), exibição na agenda (E3.3), `email_log`/`sim_*` (decisão D-4 da D-020/simuladores), revogação/reversão, anonimização em lote, perfil profissional, anonimização por super admin (E8). Não está em "Fora da primeira versão" do PLAN (é o CA 7 do PLAN).

## 4. Regras de negócio
- RN-1: `nome` e `telefone_e164` viram NULL e `anonimizada_em = agora` (relógio injetado por `defineAcao`), numa única transação (issue RN-1).
- RN-2: reservas, itens e consentimentos permanecem, ligados à cliente anonimizada (RN-2/RN-4 da issue; consentimento é prova, mantido).
- RN-3: a anonimizada não aparece em busca/lista (já garantido por `buscar`; o detalhe segue acessível por id com "Cliente removida", histórico e sem formulário).
- RN-4: na mesma transação, mensagens da cliente em `pendente` e `falhou` passam a `cancelada_anonimizacao` (inclui `convite_avaliacao` pendente, D-019). Mensagens `enviada`/`nao_enviada`/`substituida`/`cancelada_anonimizacao` mantêm o estado. `destinatario_e164`, `parametros` e `mensagem_tentativa.erro_detalhe` ficam NULL em TODAS as mensagens/tentativas da cliente (via `reserva.cliente_id`); `atualizado_em` vem do relógio injetado. `erro_codigo`, `provedor_mensagem_id` e a contagem de tentativas ficam.
- RN-5 (mensagem `enviando`): não é alterada de estado (a chamada ao provedor pode estar em curso; o T2 fecha o resultado). Só `destinatario_e164`/`parametros` são limpos. Suposição: o T2 (`concluirEnvio`) não regrava esses campos nem `erro_detalhe` com telefone depois da limpeza; o dev confirma e, se regravar, o T2 deve gravar `erro_detalhe` nulo quando a cliente estiver anonimizada. A reconciliação (`enviando` > 5 min → `falhou/resultado_incerto`) não reenvia; o `falhou` resultante já está limpo e não é reenviável (`reenviarMensagem` recusa cliente anonimizada — verificar/cobrir em teste).
- RN-6: nova reserva com o mesmo número cria nova cliente sem ligação (UNIQUE NULLS DISTINCT; `upsertCliente` não muda).
- RN-7: operação irreversível; sem ação de desfazer; o CHECK impede repreencher nome/telefone com `anonimizada_em` preenchido (e o inverso).
- RN-8: permissão: só gestor; capacidade `lgpd` (permitida em qualquer estado do salão, E6.4). Profissional: negado (403). Cliente de outro salão ou id malformado: 404 (`NaoEncontrado`), sem revelar existência. Operação de matriz: usar `cliente.gerir` na página (já existe); sem nova operação.
- RN-9 (travas): `saloes.travar` (`FOR NO KEY UPDATE`) → cliente `FOR UPDATE` → mensagens/tentativas por último (ordem do cabeçalho de `repos/cliente.ts`/`repos/servico.ts`). Sem captura de 23505. Já anonimizada → resultado `recusado/ja_anonimizada` (idempotente: nada é gravado; não é 500 nem 404 para o gestor do salão).
- RN-10 (gancho E4.5, sem schema): exportar de `src/server/clientes/anonimizar.ts` um ponto de extensão `aoAnonimizar?: (ctx, { clienteId, agora }, r: Repos) => Promise<void>` chamado DENTRO da transação, depois da limpeza de mensagens, default no-op. Contrato para a E4.5: (a) a avaliação publicada deixa de aparecer na página (a leitura pública da E4.5 deve filtrar `cliente.anonimizada_em IS NULL` — fonte da verdade — ou o hook marca a avaliação como oculta); (b) o nome de exibição ("Primeiro nome + inicial") nunca é persistido sem vínculo à cliente, ou é anulado pelo hook; (c) o link de convite pendente é recusado pela resposta uniforme "link inválido ou expirado" quando a cliente estiver anonimizada (a mensagem já está `cancelada_anonimizacao`). Recomendação: filtro na leitura da E4.5 em vez de coluna espelho.
- RN-11: a confirmação é obrigatória e em duas etapas, sem JS e sem `<dialog>`: etapa 1 (botão "Excluir cliente" → GET/POST que mostra a página de confirmação com o texto do que acontece e que é irreversível, nome da cliente, botões "Confirmar exclusão" e "Cancelar"); etapa 2 executa. Anonimização nunca ocorre por um único clique.

## 5. Critérios de aceitação
- CA-1: Dada cliente com 3 reservas, quando o gestor anonimiza, então `nome` e `telefone_e164` são NULL, `anonimizada_em` preenchido e as 3 reservas e itens existem ligados a ela. (issue CA-1)
- CA-2: Dada a anonimizada, quando se busca por nome ou telefone antigos em `/painel/clientes`, então não há resultado. (CA-2)
- CA-3: Dada mensagem `pendente` (e outra `falhou`) da cliente, quando anonimiza e o worker processa o job, então ficam `cancelada_anonimizacao` e o adaptador simulado não recebe envio. (CA-3)
- CA-4: Dada a anonimizada, quando `upsertCliente` recebe o número antigo, então cria cliente nova com id diferente. (CA-4)
- CA-5: Após anonimizar, `SELECT` do telefone antigo (com e sem `+55`) em `cliente`, `mensagem.destinatario_e164`, `mensagem.parametros` e `mensagem_tentativa.erro_detalhe` (inclusive com `erro_detalhe` que ecoava o telefone e mensagem `enviada`) não tem ocorrência. (CA-5)
- CA-6: `UPDATE cliente SET nome='x'` ou telefone em anonimizada viola `cliente_anonimizacao_chk`. (CA-6)
- CA-7: Dada mensagem `enviando` no momento da anonimização, então estado preservado, destinatário/parametros NULL, e após `concluirEnvio`/reconciliação não reaparece dado pessoal nem reenvio.
- CA-8: Dado `convite_avaliacao` pendente, quando anonimiza, então fica `cancelada_anonimizacao` (CA-R2, parte da mensagem; a recusa do link é da E4.5, ver RN-10).
- CA-9: Isolamento: gestor do salão B anonimizando cliente do salão A recebe `NaoEncontrado`/404 e nada muda; id malformado idem. Profissional e anônimo: 403/401. Nenhuma cliente de outro salão tem mensagem alterada.
- CA-10: Dupla chamada (sequencial e 10 em paralelo) deixa uma só anonimização efetiva; as demais `recusado/ja_anonimizacao`; sem 5xx nem impasse (40P01); `anonimizada_em` não muda na repetição.
- CA-11: Concorrência com `upsertCliente`/edição de telefone/`registrarMensagem`/reconciliação sem impasse; uma mensagem registrada depois da anonimização nasce `cancelada_anonimizacao`.
- CA-12: Atomicidade: falha forçada em qualquer passo (mensagens/tentativas/hook) desfaz tudo (cliente continua identificada).
- CA-13: UI: `/painel/clientes/[id]` de cliente ativa mostra "Excluir cliente" que leva à confirmação; sem JS o fluxo de duas etapas funciona; confirmar redireciona (PRG) para o detalhe anonimizado com mensagem de sucesso; cancelar não altera nada; anonimizada não mostra o botão. 375×812 sem rolagem horizontal, só teclado (foco visível, foco na confirmação), axe 4.14.0 zero violações, em pt-BR, `/dev/clientes` ganha a vista de confirmação (E2E sem banco).
- CA-14: Gancho: teste prova que `aoAnonimizar` roda na mesma transação (falha dele desfaz) e que sem ele nada muda.
- CA-15: Salão suspenso: a anonimização é permitida (capacidade `lgpd`).

## 6. Casos limite
Fuso: `anonimizada_em` UTC do relógio injetado; histórico segue no fuso do salão. Anonimizada: já tratada (RN-9). Cliente com reservas futuras `confirmado`: permitido; as reservas permanecem e a agenda (E3.3) mostra "cliente removida"; mensagens futuras (remarcação/cancelamento) nascem `cancelada_anonimizacao`, sem aviso à cliente (registrar no texto da confirmação: "não receberá mais avisos"). Cliente sem reservas/mensagens: funciona. Mensagens com job já na fila: o handler já recusa. Gestor que também é profissional: ação é do gestor. Telefone não brasileiro: não existe (CHECK).

## 7. Dependências
E5.1 (D-022), E7.1 (D-024), E3.5 (D-030, mensagens de cancelamento/remarcação). Bloqueia E4.5 (#77) e E9.4. Sem integrações externas novas.

## 8. Impactos
Dados: nenhuma migração prevista (CHECKs e colunas anuláveis já existem). DBA: opinião breve sobre o `UPDATE … FROM reserva` de mensagens/tentativas (usa `mensagem_salao_id_reserva_id_idx`/índice de `reserva.cliente_id`; confirmar índice em `reserva(cliente_id)`; se faltar, avaliar migração). DevOps: nenhum. README/CLAUDE.md: documentar a ação, o hook e a ordem de trava. Tem de manter `lerContatoDaCliente` coerente (já retorna nulos).

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposições): (1) `enviando` fica como está e só limpa campos (RN-5); (2) cliente já anonimizada → `recusado` e não erro; (3) `falhou` entra em `cancelada_anonimizacao` conforme issue, mesmo estando reenviável, e `parametros` é anulado em todas as mensagens; (4) `email_log`/`sim_*` fora do escopo (D-4); (5) confirmação em página própria (`/painel/clientes/[id]/excluir`) em vez de diálogo, por exigência de funcionar sem JS (o entregável da issue cita "diálogo", substituído).
