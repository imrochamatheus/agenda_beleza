# D-033 (E8.1) — testes.md

## Rodada 1 — VEREDITO: APROVADO
Ambiente: branch feat/d-033-auditoria (não commitado), Node 24, PostgreSQL do compose, adaptadores simulados.

## Gates (reexecutados pelo tester)
- `npm run lint` 0 avisos; `npm run typecheck` ok; `npm run build` ok.
- `npm run test:coverage`: 436 arquivos / 5069 testes passando; linhas 99,46% (>= 90%).
- `npm run test:e2e`: 171 passed, com `.env` e sem `.env` (porta 3000 livre).
- Unidade em `TZ=UTC` e `TZ=America/Sao_Paulo` (auditoria + tenant): 88 passed em cada.

## CAs
CA-1..CA-12 passam (testes do dev em `tests/integration/auditoria/{auditoria,estatico}.test.ts` e `src/server/auditoria/*.test.ts`), reexecutados.
Sonda independente (`tests/integration/auditoria/sonda-tester.test.ts`, 3 testes passando):
- sanitização: `panorama`, `capital`, `hotpot`, `footprint`, `spinner`, `nome`, `slug`, `ocultaEm`, `motivo` passam; `PAN`, `pin`, `otp`, `senhaNova`, `x-api-key`, `Authorization`, `tokenHash`, `cartão`, `refreshToken`, `set-cookie`, `client_secret` recusados;
- caminho aninhado em array (`depois.l[1].y.Token`) no erro, valor nunca na mensagem; nada gravado;
- contexto forjado (objeto não congelado com tipo admin) recusado; `Date` em JSON, ação fora do vocabulário, e-mail > 254 e atorId não UUID recusados, sem linha;
- mutação + auditoria na mesma transação (falha por FK/16 KiB/segredo reverte); `registrarFalhaAuditoria` persiste após rollback, dentro ou no catch; triggers P0001 para UPDATE/DELETE/TRUNCATE; estático: só `repos/auditoria.ts` toca a tabela e nenhuma ação/rota a referencia.

## Desvios do dev.md avaliados
Aceitáveis: `exigirAdmin` exige objeto congelado (reforça CA-6); `login.*` usa entidade `usuario`; `otpcode`/`codigootp` na lista exata (conforme design). Observação (sem defeito): chamar `registrarFalhaAuditoria` dentro de transação que segura `FOR UPDATE` em usuario/salao referenciados pode esperar; contrato documentado (chamar no catch).

## Defeitos
Nenhum (crítico/alto/médio/baixo: 0).
