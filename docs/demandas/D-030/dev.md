# D-030 (E3.5) — dev.md

## Tarefas concluídas
- **T-1** `src/server/reservas/status.ts` (+ `.test.ts`), `tipos-alteracao.ts`.
- **T-2** `src/server/repos/reserva-alteracao.ts` (`Repos.reservasAlteracao`: `travarParaAlterar`, `travarCliente`, `atualizarPosicao`, `atualizarStatus`, `lerItens`, `substituirItens`); `repos/index.ts`, `repos/index.test.ts` (guardas de ID/contexto). `RepoMensagem.substituirPendentes` já servia (tipos `['convite_avaliacao']`, `revisaoMenorQue: null`): sem mudança.
- **T-3** `alteracao-comum.ts`, `alterar-status.ts`, `remarcar.ts`, `cancelar.ts`, `marcar-status.ts`, `reservas-status.acao.ts` (3 `defineAcao`); `reserva-equipe.ts` ganhou `criarDecisorDeEncaixe` (extraído, comportamento da D-029 intacto).
- **T-4** `src/app/painel/agenda/reservas/[id]/{acoes.ts,AcoesDaReserva.tsx(+css),estado.ts,page.tsx}`, vitrine `src/app/dev/reserva-acoes/`, `ROTAS.devReservaAcoes`, `e2e/reserva-acoes{,-sem-js}.spec.ts`.
- **T-5** README (seção "Remarcar, cancelar e marcar o resultado"). CLAUDE.md NÃO editado (a cargo do líder).

## Correções ao desenho (conferidas no código real)
- Leitura prévia por `repos().reservas.buscarPorId` (já existia); não precisou de método novo.
- `substituirPendentes` existente atende ao convite; `registrarMensagem` já faz a volta a `concluido` virar no-op pela chave única.
- Cliente `FOR KEY SHARE` é tomada explicitamente ANTES da reserva (`travarCliente`): `registrarMensagem` a tomaria depois da reserva `FOR UPDATE`, invertendo a ordem com a anonimização futura (cliente `FOR UPDATE` → reserva). Ordem efetiva: salão SHARE → profissional(is) NO KEY UPDATE por id → serviços SHARE → cliente KEY SHARE → reserva UPDATE → itens → mensagem.
- Cancelar e marcar status também travam o profissional com `FOR NO KEY UPDATE` (via `travarParaReserva`), sem `FOR SHARE`, para nunca haver promoção de trava.
- Se outra remarcação trocou o profissional entre a leitura prévia e a trava da reserva, o antigo não fica travado (não é preciso: a reserva é a última trava, sem ciclo) e a permissão é reconferida com o profissional real.
- Itens: mantidos na ordem existente, acrescentados ao fim (spec "ordem relativa"); a ordem do checkbox não reordena.
- Como na D-029, remarcar da equipe não aplica grade/antecedência/janela (só `decidirEncaixe` + constraint).
- Teste D-028 `tests/integration/agenda/estatico.test.ts` (agenda somente leitura) passou a isentar `agenda/reservas/[id]/` (as ações da D-030 são ali, como já se fez com `agenda/nova`).

## Gates
- `npm run lint`, `npm run typecheck`: limpos. `npm run build`/`npm run test:e2e`: build OK; Playwright 156/156 (inclui `reserva-acoes` e `-sem-js`).
- `npm run test:coverage`: 410 arquivos, 4769 testes passando; linhas 99,49% (limiar 90).
- Concorrência (`tests/integration/reservas/alteracao/concorrencia.test.ts`) 10×: 10/10 verdes. Fuso: `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/reservas`, `src/app/painel/agenda/reservas` e `alteracao/fuso.test.ts`: verdes.

## Testes e CAs
- `status.test.ts`: CA-4, CA-7 (tabela e fronteiras). `alteracao.test.ts` (PostgreSQL real): CA-1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, R1, R2, R3 (falha de fila; falha do adaptador é o contrato D-024: a reserva nunca é tocada pelo envio). `concorrencia.test.ts`: remarcar×remarcar (10 reservas → mesmo slot; mesma reserva ×10), troca cruzada Ana↔Bia (5 rodadas e determinístico com `pg_stat_activity`), cancelar×remarcar, concluir×cancelar, cancelar×cancelar. `fuso.test.ts`: 3 fusos e virada de dia. `paginas.test.ts`: página, casca das ações, 401/403/404. Unit/UI: `AcoesDaReserva.test.tsx`, `estado.test.ts`, `dev/reserva-acoes/*`. E2E: CA-13 (teclado, axe, 375×812 sem rolagem, sem JS).

## Riscos / pendências
- Remarcar × desativar profissional não tem teste de corrida próprio (a trava `FOR NO KEY UPDATE` e o `ativo` sob a trava são cobertos de forma determinística; a desativação já recusa com reserva `confirmado` futura).
- Bloqueio continua fora da constraint (risco aceito da D-025).
- CLAUDE.md pendente (líder).

## Correção pós-CI (PR #91, e2e)
O `DATABASE_URL não definida` do log é ruído pré-existente de `/confirmar-email` (aparece também em execução limpa, sem `.env`, e todos os 156 E2E passam assim). A falha real de `reserva-acoes.spec.ts:48` era digitar a data como `ddmmyyyy` no `<input type="date">`, que depende do locale do navegador (en-US na CI lê mês/dia). O teste agora usa `fill(dia)` (ISO, independente de locale). Verificado sem `.env`/`DATABASE_URL`, com `CI=1 npm run test:e2e` (156/156) e com locales en-US e pt-BR nos dois specs de `reserva-acoes`.
