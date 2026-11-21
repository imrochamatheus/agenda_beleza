# D-030 (E3.5) — testes.md

## Rodada 1 (tester, independente)
Ambiente: branch feat/d-030-remarcar-cancelar (não commitado), Node 24, PostgreSQL via compose, adaptadores simulados.

Comandos e resultados (reexecutados):
- `npm run lint`: limpo. `npm run typecheck`: limpo. `npm run build`: OK.
- `npm run test:coverage`: exit 0; linhas 99,49% (6725/6759), limiar 90.
- `npm run test:e2e`: 156/156 (inclui reserva-acoes e reserva-acoes-sem-js).
- Fuso (`TZ=UTC` e `TZ=America/Sao_Paulo`; src/server/reservas, página de reservas, alteracao/fuso): 102/102 em cada.
- Concorrência de alteracao/concorrencia.test.ts 5x: 7/7 em todas, sem 5xx nem impasse.

CAs (testes em tests/integration/reservas/alteracao/, status.test.ts, AcoesDaReserva.test.tsx, e2e): CA-1..CA-14, CA-R1..R3 passam. Guarda estático da agenda isenta só agenda/reservas/[id]/ (estatico.test.ts verde). Ordem de travas e ausência de deadlock cobertas pelos testes de concorrência (troca cruzada, pg_stat_activity).

Observações (sem defeito): remarcar × desativar profissional sem teste de corrida próprio (risco do dev, aceito); falha do adaptador WhatsApp (CA-R3) coberta pelo contrato D-024.

Defeitos: nenhum.

## Veredito: APROVADO
