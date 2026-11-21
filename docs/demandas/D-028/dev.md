# D-028 (E3.3): dev

## Tarefas e arquivos
- T-1: `src/server/agenda/{tipos,validacao,periodo,faixas,rotulos,montagem}.ts` (+ testes). `montagem.ts` (puro, não previsto no design) monta a vista e é usado pelo serviço e pela vitrine.
- T-2: `src/server/repos/agenda.ts` (`consultaAgenda`, `listarAgenda`, `detalhe`, `listarJornadas`), registro em `repos/index.ts`.
- T-3: `src/server/agenda/consultar.ts` (`consultarAgenda`, `lerReservaDaAgenda`).
- T-4: `src/app/painel/agenda/{page.tsx,reservas/[id]/page.tsx,_componentes/*}`, `ROTAS.agendaReserva`/`devAgenda` em `src/config/navegacao.ts`.
- T-5: `src/app/dev/agenda/{page.tsx,demonstracao.ts}`, `e2e/agenda.spec.ts`, `e2e/agenda-sem-js.spec.ts`.
- T-6/T-7: `tests/integration/agenda/{apoio,repo,consultar,isolamento,fuso,estatico,paginas}`; README (seção "Agenda da equipe").

## Gates
- lint e typecheck: limpos. `npm run build`: ok (`/painel/agenda`, `/painel/agenda/reservas/[id]`, `/dev/agenda` dinâmicas).
- `npm run test:coverage`: verde, linhas 99,47%. `npm run test:e2e`: 139 passaram (inclui 15 novos).
- Unitários e `fuso.test.ts` em `TZ=UTC` e `TZ=America/Sao_Paulo`: verdes (38 + 47).
- CA-16: 6 instruções SQL por `consultarAgenda` (dia, semana, filtro; 1 reserva/1 prof. e 50 reservas/5 prof.); `listarAgenda`/`detalhe`/`listarJornadas`: 1 cada.
- Plano (60.000 reservas, 2.000 clientes, 10 profissionais): `Index Scan using reserva_salao_id_profissional_id_inicio_idx`, `Index Cond` com `inicio <` e `inicio >=` (margem de 7 dias), sem Seq Scan em `reserva`, 0,6–1,4 ms.

## CA -> teste
CA-1 consultar/paginas; CA-2 consultar; CA-3 fuso/paginas; CA-4 e2e/agenda; CA-5 consultar/repo/paginas; CA-6 consultar/repo; CA-7/8 faixas.test, consultar, e2e; CA-9 consultar; CA-10 consultar/paginas; CA-11 isolamento/paginas; CA-12 consultar, componentes, e2e; CA-13 repo, fuso, faixas.test; CA-14 e2e sem-js; CA-15 validacao, consultar, paginas; CA-16 repo/consultar; CA-17 estatico, consultar, componentes.

## Desvios e riscos
- `lerSemana` não é usado: seria N+1 (CA-16). Uma leitura única `listarJornadas` + `montarSemana`. Bloqueios e funcionamento reutilizam `lerBloqueios`/`lerFuncionamento`.
- Hora de parede repetida (recuo de DST): fim <= início em parede; `recortarNoDia` usa a duração real (01:30 EDT a 01:30 EST aparece 01:30–02:30). Dia de 23 h mostra a parede (01:30–03:30).
- Colunas do gestor: ativo com jornada/reserva/bloqueio próprio; inativo só com reserva/bloqueio; filtro e profissional sempre mostram a coluna.
- Plano: com poucos clientes o planejador faz Seq Scan em `cliente` (tabela pequena); sem pedido de índice ao DBA.
- Sem pendências nem TODO. Não editei `CLAUDE.md`; nada commitado.
