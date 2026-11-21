# D-018 (E3.1) — Relatório do tester

## Rodada 1 — Veredito: APROVADO

Ambiente: branch `feat/d-018-disponibilidade-funcionamento` (árvore sem commit), Node 24, PostgreSQL 17 do compose, `npm run db:generate` executado. Sem UI nem rota (E2E não se aplica). Tudo foi reexecutado por mim, sem aceitar a evidência de `dev.md`.

### Gates

| Comando | Resultado |
|---|---|
| `npm run lint` | verde, 0 avisos |
| `npm run typecheck` | verde |
| `npm run build` | verde |
| `npm run test:coverage` | 277 arquivos, 3536 testes verdes; linhas **99,89%** (limiar 90%); branches 98,14% |
| `TZ=UTC` e `TZ=America/Sao_Paulo`, `vitest run --project unit src/domain/disponibilidade` | 8 arquivos, 85 testes verdes nos dois fusos |
| `plano.test.ts` x10 | 10/10 verdes (9 testes cada) |
| `consultas.test.ts` x10 | 10/10 verdes (10 testes cada) |
| `tests/integration/lint` + `tests/integration/tenant` | 13 arquivos, 482 testes verdes (tenant inalterado) |

Exclusões de cobertura: nenhuma nova. `apoio.ts` do domínio entra na métrica por estar em `src/` e só testes o importam (aceitável, 100%).

### Exploratório independente (testes temporários, já apagados)

1. **Oráculo diferencial do domínio**: 600 casos aleatórios com semente fixa (150 em cada um de `America/New_York` com o salto e com o recuo, `America/Sao_Paulo` e `Australia/Lord_Howe`, com DST de 30 min). Variei grade, duração, antecedência, intervalo, funcionamento informado ou não, jornada e funcionamento com vários intervalos, bloqueios e ocupações. A saída de `calcularDisponibilidade` foi igual à de uma implementação de referência escrita por mim, direto sobre `instanteDeHoraLocal` e `partesLocais`. Nenhuma divergência.
2. **Três estados do funcionamento** (integração): `definido=false` com linhas residuais não limita; informado limita (10:00–11:00 gera 10:00..10:30); informado com 7 dias fechados dá lista vazia, com os profissionais presentes e 7 datas no resultado.
3. **DST via banco** (`America/New_York`): no salto de 08/03/2026 nenhum rótulo 02:xx, 03:00 = `07:00Z`, 00:00 = `05:00Z`; no recuo de 01/11/2026 não há rótulos duplicados, 01:00 = `05:00Z` e nenhum início em `[06:00Z, 07:00Z)`.
4. **24:00 e antecedência**: jornada e funcionamento até 24:00 dão 23:15 como último início de 45 min. Com `agora` às 23:00 locais e antecedência de 2 h, o dia seguinte começa às 01:00 e o dia corrente fica vazio.
5. **Multi-serviço e elegibilidade**: A+B só com Ana, duração total 75; id de profissional de outro salão → `NaoEncontrado`; id de serviço de outro salão → `servico_indisponivel`; Bia inativa informada → `profissionais: []`; todas as profissionais inativas → `servico_indisponivel`.
6. **Ocupação**: `cancelado` libera; encaixe de cliente anonimizada e `nao_compareceu` ocupam; `ocupado_ate` gravado (10:45) prevalece sobre o intervalo vigente 0; intervalo vigente 30 bloqueia 09:30 e deixa 09:00.
7. **Bloqueios**: salão de dia inteiro zera os dois profissionais em 25/12 e não afeta 24/12 nem 26/12; bloqueio de Bia não afeta Ana; o `motivo` não aparece no resultado.
8. **Repositório**: as chaves devolvidas são exatamente `profissionalId, inicio, ocupadoAte` (ocupações) e `profissionalId, inicio, fim` (bloqueios): sem cliente, status, id de reserva ou `motivo`. `AdminContext` é recusado em `lerRegras` e em `consultarDisponibilidade`.
9. **Pureza do domínio**: a única importação de fora da pasta é `@/server/tempo/fuso` (`calcular.ts`, `calendario.ts`, `tipos.ts`, `apoio.ts`); nenhum `Date.now()`, `new Date()` sem argumento nem método de data em hora local fora de testes. A regra de lint tem teste próprio (`importacao-dominio.test.ts`, verde).
10. **Consultas SQL e plano**: `consultas.test.ts` asserta exatamente 6 instruções (1 profissional x 1 data e 10 x 61, com e sem funcionamento). `plano.test.ts` proíbe `Seq Scan on reserva` e exige `reserva_sem_sobreposicao` nos planos custom e genérico; os dois verdes 10 vezes. Isolamento entre salões (CA-20, CA-40) coberto por `isolamento.test.ts`, verde.

### Status por CA

CA-1..CA-44: todos atendidos. Cada um tem teste verde reexecutado (mapeamento em `dev.md` §4) e o exploratório acima exercita independentemente CA-1, 3, 5, 6, 8, 10..13, 15..18, 20, 22, 26, 28..32, 34..38, 41. CA-25: plano sem Seq Scan (assertivo, repetido x10). CA-27: coberto por `desempenho.test.ts` (verde nos dois fusos).

### Defeitos

Nenhum aberto (zero críticos, altos, médios ou baixos). Sem classe de falha recorrente.

### Observações (não bloqueiam)

- `README` não foi alterado; sem comando novo para o usuário, coerente. `CLAUDE.md` já documenta D-018.
- Estado final do ambiente: só o postgres no ar, porta 3000 livre, testes temporários removidos.

## Veredito: APROVADO
