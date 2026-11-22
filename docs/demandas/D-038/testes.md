# D-038 (E6.4) — testes

## Rodada 1 — veredito: APROVADO
Ambiente: branch feat/d-038-somente-leitura (não commitada), Node 24, postgres 17 (compose), Chromium 375x812.

Gates reexecutados (independentes do dev.md):
- `npm run lint`, `npm run typecheck`, `npm run build`: passaram.
- `npm run test:coverage`: exit 0; linhas 99,18% (limiar 90%), sem exclusões novas.
- Unit/domínio/componentes/reservas em `TZ=UTC` e `TZ=America/Sao_Paulo`: 81 arquivos, 665 testes, passaram nos dois.
- E2E: porta 3000 ocupada por `next dev` do usuário (intocado). Rodado `aviso-plano` + `a11y-base` em config temporária na 3100 (removida): 42 passaram (axe sem violações por estado). Suíte completa na 3100 não reexecutada por mim (dev.md: 223 ok, 1 falha conhecida admin-entrar.spec.ts:90, artefato da porta). `npm run test:e2e` oficial fica para a CI.

CAs: CA-1..CA-11, CA-R1, CA-R2 atendidos (suítes `tests/integration/politica/*`, `politica-operacao.test.ts`, `aviso.test.ts`, `FaixaDoPlano.test.tsx`, `reservas/criar.test.ts`, todas dentro do coverage verde).

Revisão de código:
- Política única `politica-operacao.ts` consumindo `estadoEfetivoDoSalao` + `TABELA_CAPACIDADES`; capacidade desconhecida/não booleana e erro de leitura negam (falha fechada, log só com salaoId).
- Aplicada em `defineAcao`, `criarReserva` (tenant -> 403; público/sistema -> `salao_indisponivel`), remarcar (`agendar`) e status/cancelar (`cancelar`, permitido suspenso); fotos herda por `defineAcao`.
- Leitura do estado sem trava (`lerEstadoBruto`, sem FOR), antes das travas: sem risco de deadlock. TOCTOU aceito e documentado; risco baixo (uma reserva em curso pode concluir).
- `agendamentoDisponivel` deriva de `capacidades.agendar`/manual (sem lista paralela); `lerEstadoDeAgendamento` removido sem consumidores (grep limpo).
- Desvios (AvisoDoPlano em `src/app/painel/_aviso`, Suspense, política com `ContextoEscopado`) aceitáveis.
- Teste antigo CA-21 de `reservas/criar.test.ts` foi invertido para o novo contrato (mais forte: 403, `salao_indisponivel`, contagem 0), não enfraquecido.
- D-026/D-030/D-032/D-037: nenhum arquivo de `src/domain`, repos de assinatura, avaliações ou denúncias alterado.

Defeitos: nenhum.
Observações (não bloqueiam): botões de escrita não são ocultados no painel suspenso (decisão do design; servidor recusa); criar/remarcar leem o estado duas vezes.
