# D-038 (E6.4) Somente leitura e página indisponível — dev

## Tarefas concluídas
- **T-1** política real: `src/server/assinatura/politica-operacao.ts` (`decidirPolitica` pura, `politicaPorEstado`, falha fechada, log só com `salaoId`); `tenant/politica.ts` (tipo com `agora`, `permitirTudo` só para testes); `define-acao.ts`, `reservas/{criar-reserva,tipos,alteracao-comum,tipos-alteracao,remarcar,alterar-status}.ts` passam `agora`; `criarReserva` aplica a política também ao contexto público/sistema; `reserva-publica/{agendamento,estado}.ts` derivam de `capacidades.agendar`; `lerEstadoDeAgendamento` removido de `repos/publico.ts` (sem outro consumidor).
- **T-2** faixa: `server/assinatura/aviso.ts`, `components/layout/{FaixaDoPlano,PanelLayout}.tsx` (+CSS), `app/painel/_aviso/AvisoDoPlano.tsx`, vitrine `app/dev/aviso-plano/page.tsx`, `ROTAS.devAvisoPlano`; vitrines `/dev/*` passam `aviso={null}`.
- **T-3** `tests/integration/politica/{varredura,reservas,paginas,publicos,fotos-http,estatico}.test.ts`, `tests/support/politica.ts`; ajustados `reservas/criar.test.ts` (CA-21 antigo) e `tenant/define-acao.test.ts`.
- **T-4** `e2e/aviso-plano.spec.ts`. **T-5** README (seção "Somente leitura e página indisponível"); CLAUDE.md fica com o líder.

## Gates
- `npm run lint`, `npm run typecheck`, `npm run build`: passaram.
- `npm run test:coverage`: 488 arquivos, 5812 testes passaram; linhas 99,18% (limiar 90%).
- Regressão: integração completa (222 arquivos) rodou antes dos novos testes, com 1 falha esperada (CA-21 antigo, atualizado); `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/assinatura src/components src/app/dev`: passaram.
- E2E: porta 3000 ocupada por um `next dev` do usuário (não encerrado). Rodei o suíte completo numa config temporária (porta 3100, removida): 223 passaram, 1 falhou (`admin-entrar.spec.ts:90`, "nenhuma requisição externa": o teste só reconhece a origem `:3000`, artefato da porta). Os specs sem banco (`aviso-plano`, `a11y-base`, `entrar`, `jornada`) passaram sem `.env` e sem `DATABASE_URL` (50 testes). `npm run test:e2e` oficial na 3000 NÃO foi executado.

## Testes e CAs
- CA-7: `politica-operacao.test.ts` (tabela 10 situações × 6 capacidades, capacidade inválida, falha de leitura). R-3: `agendamento.test.ts` (equivalência).
- CA-2/CA-6/CA-8/CA-R2/CA-10: `varredura.test.ts` (28 ações × 10 situações, oráculo explícito conferido com a tabela, entrada cadastrada por ação, snapshot md5 do salão, profissional em bloqueios, entrada válida).
- CA-1/CA-3/isolamento: `reservas.test.ts`; CA-4/CA-5/R-2: `paginas.test.ts` (10 páginas, fuso, papel, sem sessão) e `aviso.test.ts`; CA-R1/CA-9/RN-9: `publicos.test.ts`; fotos handler: `fotos-http.test.ts`; RN-5: `estatico.test.ts`; CA-11: `aviso-plano.spec.ts`, `FaixaDoPlano.test.tsx`, `dev/aviso-plano/page.test.tsx`.

## Desvios e riscos
- `AvisoDoPlano` mora em `src/app/painel/_aviso/` (não em `components/layout`): o teste de conformidade proíbe `@/server` em `src/components`. `PanelLayout` o importa de `@/app/...` e o envolve em `Suspense` (fallback nulo), senão os testes `renderToStaticMarkup` das páginas quebram (componente assíncrono).
- `PoliticaOperacao` recebe `ContextoEscopado` (tenant ou sistema); testes que leem `ctx.usuarioId` checam `tipo`.
- Sem alteração em `envio-http.ts` (o código `negado` já existe). Botões de escrita não são ocultados (decisão do design).
- Risco aceito: TOCTOU do estado (reserva em curso pode concluir); criar/remarcar leem o estado duas vezes.
