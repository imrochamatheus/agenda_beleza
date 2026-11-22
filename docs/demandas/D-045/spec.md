# D-045 (E8.3) — Assinatura, eventos e fila no painel do super admin

Issue #53. Origem: PLAN.md "Painel do administrador da plataforma" (CA 6 e CA 9); `docs/trinks-alinhamento.md` não altera o escopo.

## 1. Problema
Hoje o super admin não vê assinatura, transições, eventos de webhook, fila de mensagens nem auditoria. Evidência:
- `src/config/navegacao.ts:50-55` já define `adminSalaoAssinatura`, `adminMensagens`, `adminAuditoria`, mas `ROTAS_ADMIN_EXISTENTES` (linha 123) lista só `adminSaloes`; as três páginas não existem (`src/app/admin/` tem `avaliacoes`, `entrar`, `saloes`).
- `reenviarMensagem` (`src/server/mensagens/reenviar.ts`) abre a própria `emTransacao`, não checa papel e não audita; só a equipe/E8.3 poderiam chamá-la, e nenhuma tela o faz.
- `auditoria` só tem escrita (`src/server/auditoria/registrar.ts`); não há leitura. `ACOES_AUDITAVEIS`/`ENTIDADES_AUDITAVEIS` (`auditoria/tipos.ts`) não têm `mensagem.reenviar` nem a entidade `mensagem`.

## 2. Objetivo
Dar ao super admin (sessão com TOTP) três telas somente leitura (assinatura/eventos por salão, fila global de mensagens, auditoria) e uma única ação de escrita: reenviar mensagem `falhou`, auditada.

## 3. Escopo
Entra:
1. `/admin/saloes/[id]/assinatura`: resumo da assinatura, transições (`assinatura_transicao`) e eventos de webhook do salão.
2. `/admin/mensagens`: lista paginada (20) com filtros estado, salão, tipo; detalhe das tentativas; ação "Reenviar" só para `falhou`.
3. `/admin/auditoria`: consulta paginada (20) com filtros salão, ator, ação, período (e resultado); antes/depois.
4. Navegação: acrescentar `adminMensagens` e `adminAuditoria` a `ROTAS_ADMIN_EXISTENTES`; links "Assinatura e eventos" e "Auditoria deste salão" no detalhe do salão (D-044); links de volta.
5. `ACOES_AUDITAVEIS += 'mensagem.reenviar'`, `ENTIDADES_AUDITAVEIS += 'mensagem'`, `ACOES_COM_ANTES_DEPOIS += 'mensagem.reenviar'`.
6. Demo `/dev/admin-mensagens` (vitrine, `VITRINE_COMPONENTES`) para E2E sem banco, no padrão `/dev/admin-saloes`.

Fica fora (PLAN "Fora da primeira versão" e decisões): reenvio pela equipe do salão (E7.3 só mostra a situação), exportação da auditoria (CSV/JSON), expurgo/retenção de log/eventos/auditoria, tela global de eventos de webhook (só por salão), reprocessar/reenviar webhook, ações sobre assinatura, edição/exclusão de auditoria, busca por texto livre no corpo, filtros por cliente/telefone, qualquer envio promocional.

## 4. Regras de negócio
- RN-1 (issue): reenvio só para `falhou` e vigente (`reenviar` do repo já devolve `recusada` com `nao_falhou`/`obsoleta`/`cliente_anonimizada`); `enviada` e demais estados são recusados sem mudar nada.
- RN-2 (issue): telefone sempre mascarado: `+55 (DDD) 9****-NNNN` (DDD e 4 últimos dígitos; fixo de 8 dígitos: `+55 (DD) ****-NNNN`). Cliente anonimizada: nunca telefone, texto `TEXTO_CLIENTE_REMOVIDA` ("Cliente removida"). Destinatário nulo sem anonimização: "—". O destinatário completo nunca chega ao cliente do navegador (a máscara é feita no servidor; o DTO não carrega o E.164). Máscara pura em `src/lib/` (ou `format.ts`, único lugar de formatação), com testes unitários (formato inválido/nulo não lança 500: devolve "—").
- RN-3 (issue, S14): nenhuma leitura grava auditoria (as três telas, filtros, paginação, detalhe de tentativas).
- RN-4 (issue): toda página e ação exige sessão de super admin com TOTP: páginas por `exigirAcessoAoAdmin` (401 → `/admin/entrar`, 403 → `AcessoNegado`); a ação por `defineAcaoAdmin` (também em POST direto). Nunca passa pela matriz de papéis do salão.
- RN-5: o reenvio é feito pelo servidor do admin sobre `contextoDeSistema(salaoId)` do salão dono da mensagem, descoberto por repositório de plataforma (pré-contexto, como `repos/admin-saloes.ts`; só depois de `defineAcaoAdmin`). Id malformado ou inexistente → `NaoEncontrado` (404) igual nos dois casos.
- RN-6 (ordem, CA-2): em UMA transação: `mensagem FOR UPDATE` → transição `falhou → pendente` (`Repos.mensagens.reenviar`) → `registrarAuditoria('mensagem.reenviar', entidade `mensagem`, `salaoId` da mensagem, `antes {estado:'falhou'}`, `depois {estado:'pendente', tipo, revisao}`, sem destinatário/parâmetros/erro). Só DEPOIS do commit `enfileirarUma` com a chave `reserva:tipo:revisao`. Exige refatorar `reenviarMensagem` em duas partes reaproveitáveis: núcleo que recebe `Repos` (uso dentro da transação do admin) e enfileiramento pós-commit; o `reenviarMensagem` atual continua com o mesmo contrato (E7.3 e testes existentes). Falha ao enfileirar não desfaz nem muda o resultado (a reconciliação recupera; log `mensagem.fila_indisponivel`). O adaptador é chamado exatamente uma vez (pelo worker, via `enviarMensagem`).
- RN-7: recusa (`recusada`) não grava auditoria de sucesso e não altera a linha. Suposição: o desfecho `cliente_anonimizada` (a linha vira `cancelada_anonimizacao`, mudança real) é auditado como `mensagem.reenviar` com `depois.estado = 'cancelada_anonimizacao'` na mesma transação; recusa pura (`nao_falhou`, `obsoleta`) não. Tentativa recusada só gera log sem PII.
- RN-8: o reenvio vale também para salão suspenso (o pipeline de mensagens não depende da suspensão; o admin é plataforma).
- RN-9 (vazamento; a tela admin NÃO mostra mais que a da equipe, exceto salão, filtro e códigos): NUNCA aparecem `parametros`, link do convite de avaliação, `provedor_mensagem_id`, `destinatario_e164` completo, `erro_detalhe`, chave de idempotência, id da reserva/da cliente, nome da cliente, `chave_dedupe`, `provedor_assinatura_id`. Aparecem: salão (nome), tipo (rótulo), revisão, estado (rótulo de `mensagens/rotulos.ts`), `erro_codigo` somente se casar `^[a-z0-9_]{1,40}$` (senão "—"), criada/atualizada/enviada em, e por tentativa: número, iniciada, finalizada, resultado, `erro_codigo` com a mesma regra.
- RN-10: eventos de webhook (por salão): data (`recebido_em`), tipo, resultado (rótulo pt-BR dos 5 valores: recebido, processado, ignorado, rejeitado, erro), `origem_valida`, `erro` só como código fechado (`CodigoErroWebhook`; desconhecido → "—"), `processado_em` e o `payload` JÁ sanitizado gravado pela D-041, exibido como JSON formatado e escapado pelo React (nunca HTML), sem reprocessamento nem enriquecimento. Nada além do gravado.
- RN-11: assinatura (por salão): estado, `teste_fim_em`, `periodo_pago_ate`, `primeira_falha_em`, `carencia_ate`, `cancelada_em`, `acesso_ate`, "vinculada ao Mercado Pago" sim/não (nunca o id). Transições de TODAS as assinaturas do salão (de, para, causa, `ocorrida_em`, marca "origem: evento" quando `evento_id` existe), as 50 mais recentes; eventos: os 50 mais recentes do salão com aviso "Mostrando os 50 mais recentes" quando há mais. `causa` desconhecida aparece como o texto gravado, truncado em 80 caracteres.
- RN-12 (fuso de exibição): páginas por salão (assinatura) usam o fuso do salão, com data e hora (como D-044). Páginas globais (mensagens, auditoria) usam `America/Sao_Paulo` fixo, com o deslocamento visível (`formatarDeslocamentoUtc`), pois misturam salões; o filtro de período da auditoria é por datas civis nesse mesmo fuso, `de` inclusivo 00:00 e `ate` inclusivo até 23:59:59,999 (convertido por `src/server/tempo/fuso.ts`, nunca `Date` local). Tudo armazenado em UTC.
- RN-13: listas com 20 por página, ordem estável `criado_em/ocorrido_em DESC, id DESC`, total e itens em UMA consulta (`count(*) OVER ()`), página inválida → 1, além do fim → vazio com link para a primeira; página máxima 500 (acima, trata como 500). Filtros inválidos (UUID malformado, estado/tipo/ação fora da lista, data inválida ou `de > ate`) NÃO viram 500: filtro ignorado e aviso "Filtro inválido ignorado" ou erro de campo; nunca interpolação (consulta parametrizada, literais para `estado`).
- RN-14: leitura global não filtra por salão do admin (ele não tem), mas só devolve a projeção mínima acima. Salão inexistente na URL de assinatura → 404.
- RN-15 (auditoria): colunas data/hora, ator (e-mail do `usuario` se `ator_id`, senão `ator_email_informado`, senão "Sistema"), ação (rótulo + código), entidade, salão (nome com link, ou "—"), resultado, e antes/depois como JSON formatado (`<details>`, sem JS necessário). Os valores já estão sem segredo; a tela não faz nova sanitização que altere o conteúdo, mas escapa tudo. Filtros: salão (id), ator (e-mail exato, minúsculas, casa `usuario.email` ou `ator_email_informado`), ação (lista fechada de `ACOES_AUDITAVEIS`), resultado, período. Sem exportação, sem ação de escrever/apagar.

## 5. Critérios de aceitação
- CA-1 (PLAN/issue CA-1): Dado salão com 3 `webhook_evento` do próprio `salao_id` (um `rejeitado`), Quando o admin abre `/admin/saloes/[id]/assinatura`, Então vê os 3 com data, tipo e rótulo do resultado, e o rejeitado distinguível por texto (não só cor); eventos de outro salão não aparecem.
- CA-2 (issue CA-2): Dado mensagem `falhou` e WhatsApp simulado funcionando, Quando o admin confirma o reenvio e o worker processa, Então a mensagem fica `enviada`, o adaptador recebeu exatamente 1 envio (contagem em `sim_*`), e existe 1 `auditoria` `mensagem.reenviar`, `sucesso`, com `salao_id` da mensagem, `antes.estado=falhou`, `depois.estado=pendente`, gravada na mesma transação (teste: falha forçada na auditoria desfaz a volta a `pendente`).
- CA-3 (issue CA-3): Dado mensagem `enviada` (e cada estado ≠ `falhou`), Quando o admin tenta reenviar (inclusive por POST direto), Então a ação é recusada com mensagem pt-BR, o estado não muda, nada é enfileirado, nada é auditado como sucesso; a UI não mostra o botão para esses estados.
- CA-4 (issue CA-4): Dado uma suspensão (`salao.suspender`) e um reenvio do mesmo salão e ações de outro salão, Quando o admin filtra a auditoria por esse salão, Então vê só as ações dele, com antes e depois visíveis.
- CA-5 (issue CA-5): Dada a lista da fila, Então todo telefone aparece mascarado (`+55 (71) 9****-1234`); o HTML da página não contém o E.164 completo nem os 9 dígitos do celular; mensagem de cliente anonimizada mostra "Cliente removida" e nenhum dígito.
- CA-6 (RN-4): Sem sessão → 401/redirect para `/admin/entrar?proximo=` nas três páginas; sessão de salão (gestor/profissional) ou admin sem TOTP → "Acesso negado" (403); POST direto da ação nas mesmas condições → 401/403 sem tocar a mensagem.
- CA-7 (RN-3): Abrir cada tela, filtrar e paginar não cria nenhuma linha em `auditoria`.
- CA-8 (RN-9): Nenhuma das três telas contém (teste sobre o HTML e sobre os DTOs) `parametros`, link de convite, `provedor_mensagem_id`, `erro_detalhe`, `chave_dedupe`, `provedor_assinatura_id`, nome de cliente.
- CA-9: Filtros da fila (estado, salão, tipo) combinados devolvem a interseção, total correto, 20 por página, ordem estável; vazio mostra "Nenhuma mensagem encontrada" com "Limpar filtros"; valores inválidos não geram 500.
- CA-10: Detalhe da mensagem lista as tentativas em ordem de `numero` com resultado e código; mensagem sem tentativas mostra "Nenhuma tentativa registrada"; id de outra... inexistente/malformado → 404.
- CA-11 (concorrência): Duas confirmações simultâneas do reenvio da mesma `falhou` → exatamente uma `reenfileirada` e uma recusada `nao_falhou`, 1 auditoria, 1 job (mesmo `singletonKey`), 1 chamada ao adaptador; reenvio × reconciliação (`reconciliar-mensagens`) → 1 chamada ao adaptador, sem impasse nem `23505`.
- CA-12: Auditoria: filtros por ator, ação e período (inclusive virada de dia em `America/Sao_Paulo`: registro às 02:30 UTC do dia seguinte aparece no dia civil anterior), paginação de 20, ordem decrescente estável; testes com `TZ=UTC` e `TZ=America/Sao_Paulo`.
- CA-13: Salão sem assinatura → estado vazio "Este salão ainda não tem assinatura"; sem eventos/transições → mensagens vazias; erro de leitura → estado de erro com "Tentar novamente", sem stack.
- CA-14: Reenvio sem JavaScript em duas etapas: botão "Reenviar" (GET `?confirmar=<id>`) abre a confirmação explícita (mostra tipo, salão, telefone mascarado, aviso de que será enviada uma nova mensagem) com "Confirmar reenvio" (POST) e "Cancelar"; resultado por PRG com código de lista fechada (`?reenvio=ok|recusada|obsoleta|anonimizada`), sem repetir o POST ao recarregar. Funciona só por teclado; axe 4.14.0 sem violações em 375×812.
- CA-15: Plano das listas (DBA): em volume (ex. 100 mil mensagens, 200 mil auditorias) a consulta única usa índice e ordena sem `Sort` completo nos filtros comuns; sem migração se o parecer dispensar; qualquer índice novo é migração SQL revisada.
- CA-16: Gate padrão (lint, typecheck, build, cobertura ≥ 90%, E2E das páginas via `/dev/admin-mensagens`).

## 6. Casos limite
- Fuso/virada de dia: RN-12, CA-12. Salão com fuso diferente de São Paulo: a página do salão usa o dele, a global usa São Paulo.
- Concorrência: CA-11; reenviar × anonimização da cliente: segue a ordem de trava (cliente `FOR UPDATE` antes de mensagem em E5.2; aqui `mensagem FOR UPDATE` só, e o resultado é `cliente_anonimizada`/`nao_falhou`, sem impasse); reenviar × edição de telefone: sem trava de cliente, mantém o contrato D-024.
- Isolamento: reenviar só altera a mensagem do id; id de outra... não há "outro salão" para o admin, mas o contexto de sistema usa o `salao_id` lido da própria linha (nunca do formulário). Eventos aparecem só no salão cujo `salao_id` consta; evento rejeitado sem `salao_id` (origem inválida) NÃO aparece em nenhuma tela (suposição, ver Dúvidas).
- Salão suspenso: telas e reenvio funcionam (RN-8). Cliente anonimizada: RN-2/CA-5; reenvio vira `cancelada_anonimizacao`.
- Mensagem `enviando` há muito tempo ou `pendente`: sem botão; o admin só vê o estado (a reconciliação trata).
- Telefone não brasileiro/ inválido gravado: máscara devolve "—" sem lançar.
- Fila indisponível no reenvio: linha fica `pendente`, resposta `ok` com aviso discreto; reconciliação recupera.
- Payload com texto malicioso, chaves longas ou 16 KB de `antes/depois`: renderizado como texto, em `<pre>` com rolagem interna, sem rolagem horizontal da página em 375 px.
- Id de salão na URL malformado/desconhecido → 404; `?pagina=abc` → 1.
- Duplo clique no "Confirmar reenvio": segundo POST vira recusada, não erro.

## 7. Dependências
D-033 (auditoria), D-034/35 (sessão e `defineAcaoAdmin`), D-041 (webhook e sanitização), D-024 (mensagens), D-043 (rótulos), D-044 (padrões de lista/detalhe/fuso), D-018/E1.5 já entregues. Integrações: WhatsApp simulado nos testes (nenhum real); nenhuma chamada a Mercado Pago, e-mail ou Turnstile. Consome `src/server/tempo/fuso.ts`, `src/lib/format.ts`.

## 8. Impactos prováveis
- Dados: sem coluna nova. Índices candidatos (DBA decide): `mensagem (criado_em DESC, id DESC)` e/ou `(estado, criado_em DESC)` para a fila global (hoje há `mensagem_salao_id_criado_em_idx`, `mensagem_pendentes_idx` só parcial para pendente/enviando/falhou); `auditoria (acao, ocorrido_em DESC)` (já há `ocorrido_em`, `salao_id+ocorrido_em`, `ator_id+ocorrido_em`); para o filtro por e-mail do ator, índice em `ator_email_informado` ou junção por `usuario.email`; busca de eventos já tem `webhook_evento_salao_id_recebido_em_idx` e `assinatura_transicao_assinatura_id_ocorrida_em_idx`. Acionar o DBA para parecer de plano.
- `auditoria.acao` é TEXT sem CHECK: novo valor não exige migração.
- Env: nenhuma variável nova. CI: nenhum job novo; E2E novos entram no `npm run test:e2e`. README: seção do painel do admin (telas, reenvio, o que não aparece). Seed: opcional, 1 mensagem `falhou` e eventos de webhook para a demo local.
- DevOps: não necessário.
- Código: refatorar `reenviarMensagem` em núcleo transacional + enfileiramento; novos repos de plataforma `admin-mensagens.ts`, `admin-auditoria.ts`, `admin-assinatura.ts` (pré-contexto, sem escrita exceto o núcleo do reenvio via `Repos`).

## 9. Dúvidas
Bloqueantes: nenhuma.

Não bloqueantes (suposição adotada):
1. Eventos de webhook rejeitados sem `salao_id` não têm tela (fora de escopo: não há tela global de eventos). CA-1 usa evento rejeitado COM `salao_id` (ex. `vinculo_invalido`). Se o líder quiser ver os sem salão, vira demanda própria.
2. Fuso global: `America/Sao_Paulo` fixo com deslocamento visível (RN-12).
3. Recusa pura do reenvio não é auditada (RN-7); o desfecho `cliente_anonimizada` é auditado por mudar estado.
4. Salão filtrado por UUID (preenchido por links do detalhe do salão e por um `<select>` limitado se o número de salões for pequeno); busca por nome fica para o arquiteto/web-designer decidir sem aumentar o escopo.
5. Reenvio permitido em salão suspenso (RN-8).
6. `erro_detalhe` nunca é exibido, mesmo sendo texto fixo, por coerência com D-043.

## 10. Riscos
- R-1: `OFFSET` profundo em auditoria/mensagens (mitigado pelo teto de 500 páginas; DBA pode propor keyset, mas a UI é Anterior/Próxima).
- R-2: refatorar `reenviarMensagem` pode regredir E7.3/testes D-024: manter o contrato e rodar a suíte `tests/integration/mensagens`.
- R-3: vazamento por `payload`/`antes`/`depois` com valor livre: só exibe o gravado; testes CA-8 sobre HTML.
- R-4: a UI vira "mais um lugar com telefone": a máscara no servidor e o DTO sem E.164 são o controle.
