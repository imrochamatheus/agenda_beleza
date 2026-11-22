# D-040 (E6.1) Dev: assinatura, início e teste após autorização

## Tarefas e arquivos
- T-1: `src/domain/assinatura/{tipos,maquina-estados}.ts` (+test: `teste_iniciado` com `iniciadoEm?`; sem ele, `agora`, D-037 intacta), `src/server/assinatura/{tipos,servico}.ts` (repassa `iniciadoEm`), `iniciar-tipos.ts`, `rotulos.ts`.
- T-2: `src/server/repos/assinatura.ts` (`criarPendenteSeNaoHouver`, `lerVigente`, `trocarProvedor` CAS, `confirmarProvedor` `FOR NO KEY UPDATE`), `tests/integration/assinatura/repo-iniciar.test.ts`.
- T-3: `iniciar.ts`, `retorno.ts`, `assinatura.acao.ts` (`defineAcao({ papeis:['gestor'], capacidade:'assinatura' })`); testes `iniciar`, `concorrencia-iniciar`, `seguranca-iniciar` (+ `apoio-iniciar.ts`) e unitários `iniciar-tipos.test.ts`.
- T-4: `src/app/painel/assinatura/{page,acoes,FormularioAssinar,Resumo,estado,plano,Assinatura.module.css}` e `retorno/page.tsx`; vitrine `src/app/dev/assinatura/`; `ROTAS.devAssinatura`; link "Assinar agora" na faixa `pendente` do gestor (`aviso.ts`, `FaixaDoPlano.tsx`); `e2e/assinatura.spec.ts`, `e2e/assinatura-sem-js.spec.ts`. O item "Assinatura" do menu do gestor já existia.
- T-5: README (seção "Assinatura"); CLAUDE.md fica com o líder.
- Ajuste de teste existente: `tests/integration/politica/varredura.test.ts` tira da varredura as ações de capacidade `assinatura` (o handler criaria a `pendente` e mudaria a situação do salão compartilhado) e confere na tabela que a capacidade vale em toda situação.

## Testes por CA
CA-1, 2, 3, 6, 7, 8, 10, 11: `iniciar.test.ts`; CA-9: `concorrencia-iniciar.test.ts` (10 iniciar, 10 retornos, misto); CA-4 e CA-5: `seguranca-iniciar.test.ts` (sem coluna cart/card/cvv/pan; sem 13-19 dígitos em `webhook_evento.payload`/simulado; 403/401; salão B intocado); CA-12: E2E (`/dev/assinatura` com e sem JS, teclado, axe, 375×812, en-US; redirecionamento sem sessão).

## Desvios e riscos
- Nenhum DDL. `sem_assinatura` mantém todas as capacidades (decisão do líder).
- `ctx.usuarioId` existe em `TenantContext`; operação da matriz de páginas: `assinatura.gerir` (gestor).
- O `external_reference` do provedor é o `salaoId`; valor divergente só gera log `assinatura.valor_divergente`.
- Sem PRG no retorno: GET com efeito idempotente derivado só do provedor (R-4).
- Porta 3000 ocupada por processo do usuário: E2E rodado em porta alternativa (ver gates).

## Gates
- `npm run lint`, `npm run typecheck`, `npm run build`: passaram.
- `npm run test:coverage`: 505 arquivos, 5955 testes passando; linhas 98,83% (limiar 90%).
- E2E completo: 237 passaram, 1 falhou (`admin-entrar.spec.ts:90`), por artefato da porta alternativa: o spec fixa `http://127.0.0.1:3000` ao filtrar requisições externas (a 3000 estava ocupada por processo do usuário, que não foi encerrado; usei config temporária em 3100, já removida). Specs da D-040 passaram. Reexecutar `npm run test:e2e` com a 3000 livre fecha o gate.
- Fusos UTC e America/Sao_Paulo (unit + `iniciar.test.ts`): 130 testes passando em ambos. Concorrência (`concorrencia-iniciar.test.ts`) 10 execuções seguidas: 10 passaram.
