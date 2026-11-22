# D-040 (E6.1) Testes: Rodada 1

Veredito: APROVADO (sem defeito aberto).

## Gates (reexecutados pelo tester)
- `npm run lint`, `npm run typecheck`, `npm run build`: passaram.
- `npm run test:coverage`: exit 0; linhas 98,83% (limiar 90%).
- `TZ=UTC` e `TZ=America/Sao_Paulo`: `src/server/assinatura src/domain/assinatura tests/integration/assinatura`, 15 arquivos / 187 testes passando nos dois.
- `concorrencia-iniciar.test.ts` x10: 10 de 10 passaram (iniciar x iniciar, retorno x retorno, misto; sem 23505 nem impasse).
- E2E em config temporária na porta 3100 (removida; 3000 do usuário intocada): `assinatura`, `assinatura-sem-js`, `a11y-base`: 30 passaram. `docker/smoke.sh` não rodado (CI).

## CAs
CA-1..CA-3, CA-6..CA-11: cobertos por `iniciar.test.ts`/`concorrencia-iniciar.test.ts` (passam). CA-4, CA-5: `seguranca-iniciar.test.ts` (passam). CA-12: E2E (passam). Revisão de `retorno.ts`: nenhum parâmetro da requisição entra; consulta ao provedor fora de transação; `salaoId` conferido; vínculo confirmado por `confirmarProvedor` sob trava; `iniciadoEm = autorizadaEm`.

## Observações (sem defeito)
- varredura.test.ts: a exclusão da capacidade `assinatura` é justificada (o handler cria `pendente` e mudaria o salão compartilhado); o teste substituto confere a tabela (`assinatura` true em toda situação) e o papel gestor, e o comportamento real em salão suspenso/encerrado está em `iniciar.test.ts`/`seguranca-iniciar.test.ts`. Não enfraquece de forma material; risco baixo: um novo `*.acao.ts` com capacidade `assinatura` fica sem varredura automática.
- GET de retorno com efeito (sem PRG): classificação baixa/aceitável; o efeito é idempotente e derivado só do provedor (query forjada ignorada, CA-2), logo não há CSRF útil.
