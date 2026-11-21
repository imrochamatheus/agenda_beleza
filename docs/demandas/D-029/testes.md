# D-029 (E3.4) — Testes

## Rodada 1 (tester, independente)
Ambiente: branch feat/d-029-reserva-manual (alterações não commitadas), Node 24, PostgreSQL do compose, adaptadores simulados.

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | 0 avisos |
| Typecheck | `npm run typecheck` | passou |
| Build | `npm run build` | passou (`/painel/agenda/nova` e `/dev/reserva-nova` dinâmicas) |
| Cobertura | `npm run test:coverage` | passou; linhas 99,47% (limiar 90); criar-reserva.ts 96,29%, encaixe.ts 100%, reserva-equipe.ts 100% |
| E2E | `npm run test:e2e` | 147 passaram (inclui reserva-nova*.spec.ts) |
| Fuso | `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/reservas` + `tests/integration/reservas/equipe` | 111/111 em ambos |

## CAs
CA-1..CA-14, CA-17, CA-18: `tests/integration/reservas/equipe/equipe.test.ts` (PostgreSQL real, revisado: asserta estado gravado, ausência de cliente/mensagem órfã, 403/404, flag encaixe real, consentimento opcional e nao_enviada, Manaus/virada de dia/DST) e `concorrencia.test.ts` (CA-14). CA-15/16: `paginas.test.ts`, `e2e/reserva-nova*.spec.ts`. Todos PASSARAM.

## Revisões
- Fluxo público e D-025 inalterados: `decidirEncaixe`/`consentimentoOpcional` só ativam com a dep (RangeError fora do contexto); flag gravado segue `modo === 'encaixe'` sem a dep; suítes D-025 e públicas verdes na cobertura completa.
- Desvios do dev.md §5: D-1 (consentimentoOpcional, só equipe), D-2 (leitura com `r` da transação, sob lock do profissional; lock order preservado), D-3, D-4 aceitáveis. D-5: guardas estáticos afrouxados apenas no necessário (`@/server/reservas/criar-reserva` e `aposRevalidar` seguem proibidos em src/app e src/worker; agenda/nova excluída só da regra de somente leitura, agenda em si segue sem ação). Sem enfraquecimento indevido.
- Sobreposição só pela constraint, sempre recusada com encaixe (CA-3 e variante "ocupado dentro do horário").
- Não repeti o loop de estabilidade 10x; confio na evidência do dev, mais a execução completa verde.

## Defeitos
Nenhum.

## Veredito: APROVADO
