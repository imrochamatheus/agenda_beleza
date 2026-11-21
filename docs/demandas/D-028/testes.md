# D-028 (E3.3) - Testes

## Rodada 1 (tester, reexecução independente)
Ambiente: branch feat/d-028-agenda-equipe (não commitada), Node 24, PostgreSQL do compose, Chromium 375x812.

| Gate | Comando | Resultado |
|---|---|---|
| Lint | `npm run lint` | limpo |
| Typecheck | `npm run typecheck` | limpo |
| Build | `npm run build` | ok (rotas da agenda dinâmicas) |
| Cobertura | `npm run test:coverage` | verde; linhas 99,47% (statements 98,89%) |
| E2E | `npm run test:e2e` | 139 passaram |
| Fuso | `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/agenda tests/integration/agenda` | 86/86 em cada |

## CA
CA-1..CA-17 atendidos, cobertos por consultar/isolamento/paginas/repo/fuso/estatico (integração), faixas/montagem/periodo (unidade) e e2e/agenda*.spec.ts (axe, 375px, sem JS). Conferido por leitura: repo filtra `salao_id` em todos os joins, detalhe de profissional filtra `profissional_id` (404 uniforme), telefone nunca lido na grade (só `lerContatoDaCliente` no detalhe), 6 instruções constantes, sem checagem de suspensão, página pública não importa a agenda.
Desvios do dev.md (`listarJornadas` + `montarSemana` no lugar de `lerSemana`; hora repetida de DST) aceitos: cobertos por testes e sem violar CA.

## Defeitos
Nenhum.

## Veredito: APROVADO
