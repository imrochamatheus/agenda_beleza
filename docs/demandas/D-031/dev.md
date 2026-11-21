# D-031 (E5.2) — Implementação (desenvolvedor)

## Tarefas concluídas (T-2, T-3, T-4)
- **T-2:** `src/server/repos/cliente.ts` (`anonimizar`), `src/server/repos/mensagem.ts` (`anonimizarDaCliente`, 2 comandos), `src/server/clientes/anonimizar.ts` (serviço, gancho `aoAnonimizar`, pontos de teste `aposTravar`/`aposCliente`/`aposMensagens`), `tipos.ts` (textos, `mensagemDeExclusao`), `clientes.acao.ts` (`anonimizarCliente`, gestor + `lgpd`).
- **T-3:** `src/app/painel/clientes/acoes.ts` (`excluirClienteAcao`, PRG), `[id]/page.tsx` (link e aviso `?exclusao=`), `[id]/excluir/page.tsx`, `ConfirmarExclusaoCliente.tsx`, `Clientes.module.css`, `ROTAS.excluirCliente`, `/dev/clientes?vista=excluir` (+ `demonstrarExclusaoAcao`), `e2e/clientes-excluir*.spec.ts`.
- **T-4:** README (seção "Excluir cliente"); CLAUDE.md fica com o líder.

## Testes e CA
- `tests/integration/clientes/anonimizacao.test.ts` (20): CA-1, 2, 4, 5, 6, 7, 8, 9, 10 (sequencial), 12 (4 pontos de falha), 14, 15, reenvio recusado, isolamento de mensagens.
- `anonimizacao-fila.test.ts`: CA-3 com worker pg-boss real (job criado antes, worker depois; zero chamadas ao WhatsApp simulado).
- `anonimizacao-concorrencia.test.ts` (6): CA-10 (10 em paralelo ×10), CA-11 (anonimizar × edição × upsert × registro × envio × reenvio × reconciliação ×10) e 4 casos com `pg_stat_activity`.
- `anonimizacao-paginas.test.ts` (6): CA-9/CA-13 (página, ação-casca, permissões, 404, PRG).
- Unidade: `ConfirmarExclusaoCliente.test.tsx`, `tipos.test.ts`, `/dev/clientes` (página e ação), `navegacao.test.ts`.
- E2E: `clientes-excluir.spec.ts` (teclado, axe, 375×812, locale en-US) e `clientes-excluir-sem-js.spec.ts`; sem input de data.

## Desvios e decisões
- Nenhum desvio do desenho. Detalhes: o UPDATE de mensagens só toca linhas com algo a mudar (`pendente`/`falhou` ou destinatário/parâmetros preenchidos); `anonimizarCliente` (serviço) chama `exigirPermissao('cliente.gerir')` além da capacidade `lgpd` da ação; `ConfirmarExclusaoCliente` é cliente só para focar o título e recebe a Server Action como `acao`.
- `concluirEnvio` não foi alterado (CA-7 virou teste de regressão).

## Riscos
R-1 (mensagem em voo no provedor) aceito, como no design.
