# D-031 (E5.2) — Desenho: anonimizar cliente

## 1. Resumo e alternativas
Serviço `anonimizarCliente` em uma transação READ COMMITTED: `saloes.travar` (FOR NO KEY UPDATE) → `RepoCliente.anonimizar` (cliente `FOR UPDATE`, UPDATE da cliente) → `RepoMensagem.anonimizarDaCliente` (mensagens e tentativas, em lote, por último) → `aoAnonimizar` (hook, default no-op). Resultado discriminado; ação `anonimizarCliente` com `defineAcao({ papeis:['gestor'], capacidade:'lgpd' })`; confirmação em página própria `/painel/clientes/[id]/excluir` (GET mostra, POST executa, PRG ao detalhe).
Descartadas: (a) diálogo/`<dialog>` (exige JS); (b) mover `enviando` para `cancelada_anonimizacao` (apagaria o resultado de uma chamada em curso; viola RN-5); (c) coluna espelho de "oculta" para avaliações (E4.5 filtra `cliente.anonimizada_em IS NULL`); (d) NOT VALID/trigger no banco (CHECK já existe).

## 2. Verificações no código real (sem hipótese)
- `CAPACIDADES` em `src/server/tenant/context.ts` já contém `'lgpd'`; nada a criar em permissões. A matriz usa `cliente.gerir` (`salao/negado/negado`) na página; sem nova operação.
- `concluirEnvio` (`repos/mensagem-sistema.ts`): sucesso grava `erro_detalhe = NULL`; falha grava só `DETALHE.permanente/temporaria` (texto fixo, sem telefone); WHERE exige `estado = 'enviando'`. NÃO regrava `destinatario_e164`/`parametros`. Suposição RN-5 confirmada: **nenhuma mudança em `concluirEnvio`**; vira teste de regressão (CA-7).
- T1 (`iniciarEnvio`) lê o telefone de `cliente` sem trava: corrida envio × anonimização é aceita e inevitável (o telefone já está em memória; o provedor pode receber a mensagem). Mitigação: T1 que ocorra depois do commit vê `anonimizada_em` e termina `cancelada_anonimizacao`; a que ocorreu antes fecha por T2 sem dado pessoal. Documentar como risco aceito R-1.
- `expirarEnviandoPresas` só escreve `'resultado incerto'`: sem dado pessoal. `reenviarMensagem` já tem motivo `cliente_anonimizada`; cobrir em teste.
- Índices existentes: `reserva_salao_id_cliente_id_inicio_idx (salao_id, cliente_id, inicio)`; `mensagem_salao_id_reserva_id_idx`; `mensagem_tentativa UNIQUE(mensagem_id, numero)` (cobre `mensagem_id`).

## 3. Componentes e interfaces
- `src/server/repos/cliente.ts` (estender; cabeçalho de travas atualizado):
  `anonimizar(ctx, id, agora): Promise<{ resultado:'ok'; cliente: ClienteDTO } | { resultado:'ja_anonimizada' }>`. `ehUuid` → senão `NaoEncontrado`. `SELECT id, anonimizada_em FROM cliente WHERE id=$1 AND salao_id=$2 FOR UPDATE` (inclui anonimizadas); 0 linhas → `NaoEncontrado`; `anonimizada_em` não nulo → `ja_anonimizada` sem escrever; senão `UPDATE cliente SET nome=NULL, telefone_e164=NULL, anonimizada_em=$agora, atualizado_em=$agora`.
- `src/server/repos/mensagem.ts` (`RepoMensagem`, escopado): `anonimizarDaCliente(ctx, clienteId, agora): Promise<{ canceladas:number; limpas:number }>` em 2 comandos, constante:
  1. `UPDATE mensagem m SET estado = CASE WHEN m.estado IN ('pendente','falhou') THEN 'cancelada_anonimizacao'::estado_mensagem ELSE m.estado END, destinatario_e164=NULL, parametros=NULL, atualizado_em=$agora FROM reserva r WHERE m.reserva_id=r.id AND r.salao_id=$s AND m.salao_id=$s AND r.cliente_id=$c` (estado `enviando` preservado; os demais mantidos). Retornar contagens com `RETURNING`/CTE. Não alterar `erro_codigo`, `provedor_mensagem_id`.
  2. `UPDATE mensagem_tentativa t SET erro_detalhe=NULL FROM mensagem m JOIN reserva r ON r.id=m.reserva_id WHERE t.mensagem_id=m.id AND m.salao_id=$s AND r.salao_id=$s AND r.cliente_id=$c AND t.erro_detalhe IS NOT NULL`.
  Ordem fixa mensagem → tentativa (mesma de `concluirEnvio`, evita impasse). Dev confirma no `tipos`/CHECK de `mensagem` que estado `cancelada_anonimizacao` com destinatário nulo é aceito (`mensagem_revisao_chk` etc.) e que a limpeza em `enviada` não viola nenhum CHECK; se violar, DBA.
- `src/server/clientes/anonimizar.ts` (sem `next/*`, sem `'use server'`):
  `anonimizarCliente(ctx: ContextoEscopado, { clienteId }, agora: Date, deps?: { aoAnonimizar?: AoAnonimizar; aposTravar?: ...(teste) }): Promise<ResultadoAnonimizar>`; `type AoAnonimizar = (ctx, { clienteId, agora }, r: Repos) => Promise<void>`; `export const aoAnonimizarPadrao: AoAnonimizar = async () => {}`. `ResultadoAnonimizar = { resultado:'anonimizada'; canceladas:number } | { resultado:'recusado'; motivo:'ja_anonimizada' }`. Usa `emTransacao`; `NaoEncontrado` propaga; nenhum 23505 capturado. Sem retry.
- `src/server/clientes/clientes.acao.ts`: `anonimizarCliente = defineAcao({ papeis:['gestor'], capacidade:'lgpd' }, handler)` (validar `clienteId` string; handler fino chama o serviço com `{ agora }`).
- `src/server/clientes/tipos.ts`: tipos client-safe do resultado e mensagens pt-BR (`TEXTO_CONFIRMACAO_EXCLUSAO`, sucesso, `ja_anonimizada`).
- `src/app/painel/clientes/acoes.ts`: shell `excluirClienteAcao(formData)` (lê `clienteId`, chama a ação, `redirect` PRG para `/painel/clientes/[id]?exclusao=ok` ou `ja_anonimizada`).
- Páginas: `[id]/page.tsx` mostra link "Excluir cliente" (GET para `/painel/clientes/[id]/excluir`) só se não anonimizada, e aviso por `?exclusao=`; `[id]/excluir/page.tsx` (`exigirAcessoAoPainel(..., ['gestor'], 'cliente.gerir')`; anonimizada ou inexistente redireciona/404) com nome, texto do que acontece, irreversível, "não receberá mais avisos"; form POST com "Confirmar exclusão" (server action) e link "Cancelar"; foco inicial no título (`tabIndex=-1`+autofocus por ref em componente cliente mínimo, ou `<h1 id>` com `autoFocus` no botão Cancelar — decisão do dev, deve passar teclado/axe). Componente `ConfirmarExclusaoCliente.tsx` recebe só texto/ids (nunca função do servidor). `ROTAS.excluirCliente(id)` e `ROTAS.devClientes` variante.
- `/dev/clientes`: vista `?vista=excluir` (confirmação) com ação só-de-validação em memória (anonimiza item da lista em memória); `?vista=anonimizada` já existe.
- Listas/buscas: `buscar` já exclui anonimizadas; sem mudança (só teste CA-2).

## 4. Dados
Sem migração. DBA: **sim, parecer breve** (leve): confirmar com EXPLAIN que o UPDATE 1 usa `reserva_salao_id_cliente_id_inicio_idx` (via `salao_id, cliente_id`) + `mensagem_salao_id_reserva_id_idx` com cliente de 5 mil reservas, e que não há necessidade de índice em `mensagem(reserva_id)` (UNIQUE `(reserva_id, tipo, revisao)` já cobre). Registrar em `docs/demandas/D-031/dba.md`; migração só se o plano for Seq Scan em volume realista.

## 5. Infraestrutura
DevOps: **não**. Sem variável, container, CI ou observabilidade nova (log `cliente.anonimizada` apenas com ids de cliente/salão e contagens, sem nome/telefone). README e CLAUDE.md: documentar ação, hook, travas.

## 6. Invariantes
- Escopo por salão: `exigirEscopo`, `salao_id` em todos os SQL; outro salão/id malformado = `NaoEncontrado` (CA-9).
- Exclusion anti-sobreposição: não aplicável (reservas inalteradas, nenhuma escrita em `reserva`).
- UTC: `anonimizada_em`/`atualizado_em` do relógio injetado; histórico segue o fuso do salão.
- Adaptadores: não aplicável (nenhuma chamada a integração); `email_log`/`sim_*` fora do escopo.
- Soft delete/anonimização: é o núcleo (RN-1..7). Reservas, itens e consentimentos mantidos.
- Salão suspenso: capacidade `lgpd` permitida em qualquer estado (CA-15; teste).
- Idempotência: repetição = `recusado/ja_anonimizada`, sem escrita; jobs na fila já terminais.
- Auditoria super admin: não aplicável (ação do gestor; anonimização por admin é E8).

## 7. Concorrência (ordem: salão FOR NO KEY UPDATE → cliente FOR UPDATE → mensagem → tentativa)
- × edição de telefone: ambas travam salão primeiro e cliente `FOR UPDATE`; serializam. Edição após anonimização: `atualizar` filtra `anonimizada_em IS NULL` → `NaoEncontrado`.
- × `upsertCliente`: o upsert não trava o salão; faz `ON CONFLICT DO UPDATE` na linha da cliente (NO KEY UPDATE), que conflita com `FOR UPDATE`; espera ou vê a linha pós-commit (telefone NULL ⇒ não é conflito ⇒ cria nova). Risco: upsert que obteve a linha antes e espera o commit reavalia a linha (READ COMMITTED) e, como o telefone mudou, o `ON CONFLICT` recomeça — comportamento aceito pelo PostgreSQL; teste obrigatório sem impasse (CA-11).
- × envio: T1/T2 não travam cliente nem salão; T2 só toca `mensagem`/`mensagem_tentativa` pelo id (lock row-level na mesma ordem mensagem → tentativa, igual ao UPDATE em lote). Sem inversão. Estado `enviando` mantido, T2 fecha sem dado pessoal.
- × reenvio/reconciliação/registrarMensagem: `registrarMensagem` toma `FOR KEY SHARE` da cliente (conflita com `FOR UPDATE`) e depois vê `anonimizada_em` ⇒ nasce `cancelada_anonimizacao`. Reconciliação usa `SKIP LOCKED` (sem espera). `reenviarMensagem` revalida cliente (já recusa).
- Dupla chamada: serializa no salão; as demais veem `anonimizada_em` e recusam.

## 8. Riscos
R-1 mensagem em voo no provedor no instante da anonimização (aceito; documentado). R-2 UPDATE em lote para cliente com muitas reservas (índice, DBA). R-3 hook E4.5 mal usado fora da transação (contrato testado, CA-14). R-4 `convite_avaliacao` com `parametros` contendo link: limpo, vira `cancelada_anonimizacao` (se `enviando`, T2 fecha).

## 9. Testes
- Unidade: serviço puro (ordem, resultado, hook chamado/ignorado), texto da confirmação, componentes `*.test.tsx` (CA-13 parcial), shell.
- Integração (PostgreSQL real, `tests/integration/clientes/anonimizacao*.test.ts`): CA-1, 2, 3 (com worker/adapter simulado), 4, 5 (SELECT por telefone com e sem +55 em cliente/mensagem/parametros/erro_detalhe), 6, 7, 8, 9, 10 (sequencial e 10 em paralelo), 11 (pg_stat_activity), 12 (falha forçada em cada passo via deps), 14, 15.
- Playwright sem banco (`e2e/clientes-excluir*.spec.ts`, `/dev/clientes?vista=excluir`): CA-13 (teclado, axe 4.14.0, 375×812, sem rolagem horizontal, sem JS).
- Cobertura ≥ 90% mantida: todo arquivo novo coberto por unidade ou integração.

## 10. Tarefas
- T-1 (dba, paralela com T-2): EXPLAIN do UPDATE em lote com volume; `docs/demandas/D-031/dba.md`. Arquivos: só esse doc. Conclusão: parecer sem migração ou pedido de índice.
- T-2 (desenvolvedor, base): `repos/cliente.ts` (`anonimizar`), `repos/mensagem.ts` (`anonimizarDaCliente`), `clientes/anonimizar.ts`, `clientes/tipos.ts`, `clientes.acao.ts`, testes de unidade/integração CA-1..12, 14, 15. Depende de nada.
- T-3 (desenvolvedor, depende de T-2 apenas para a assinatura de `ResultadoAnonimizar`; pode começar em paralelo com contrato do §3): `src/app/painel/clientes/acoes.ts`, `[id]/page.tsx`, `[id]/excluir/page.tsx`, `ConfirmarExclusaoCliente*.tsx`, `Clientes.module.css`, `src/config/navegacao.ts` (rota), `src/app/dev/clientes/page.tsx`, `e2e/clientes-excluir*.spec.ts`. Sem arquivos em comum com T-2.
- T-4 (desenvolvedor, depois de T-2 e T-3): README, CLAUDE.md (ação, hook `aoAnonimizar`, ordem de trava), regressão `concluirEnvio` (CA-7), rodada de estabilidade ×10 e cobertura.
- DevOps: dispensado (§5).
