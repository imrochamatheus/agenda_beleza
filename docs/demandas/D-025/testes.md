# D-025 — Relatório do tester (E3.2: criar reserva)

## Rodada 1

Ambiente: branch `feat/d-025-criar-reserva` (árvore sem commit), Node 24, PostgreSQL 17 do compose, adaptadores simulados, 8 CPUs.

**Veredito: REPROVADO** (1 defeito alto aberto: DEF-1, deadlock `40P01` na criação concorrente do mesmo horário).

### 1. Gates (reexecutados por mim)

| Comando | Resultado |
|---|---|
| `npm run lint` | exit 0, 0 avisos |
| `npm run typecheck` | exit 0 |
| `npm run build` / `npm run build:node` | exit 0 / exit 0 |
| `npm run test:coverage` (completo) | exit 0; **344 arquivos, 4245 testes, todos passaram**; linhas **99,57%** (stmts 99,06, branches 97,35, funções 99,36). **Coincide com o `dev.md`** (sem diferença de total, ao contrário da D-024) |
| `npm run test:e2e` | 1ª tentativa inválida: a porta 3000 estava ocupada pelo container `app` do compose e o Playwright reaproveitou o servidor (83 falhas, ruído do ambiente). Com `app` e `worker` parados: **112 passaram**, exit 0 |
| `sh docker/smoke.sh` | exit 0, `smoke: OK` |
| `concorrencia` + `idempotencia` ×10 (ambiente quieto) | 10/10 verdes (18 testes por rodada) |
| `TZ=UTC`, `America/Sao_Paulo`, `Asia/Tokyo` em `src/server/reservas` + `fuso.test.ts` | 5 arquivos, 44 testes verdes nos três |
| Testes de documentação | nenhum teste fixa texto de README/CLAUDE.md relativo à D-025 (`documentacao.test.ts` é da D-007 e não foi afetado; passou na cobertura completa) |

Ao fim: só o `postgres` no ar, porta 3000 livre, testes temporários apagados.

### 2. Exploratório independente (testes temporários, apagados)

Passaram: CA-1 (A+B 10:00–11:15, snapshots, intervalo, revisão 0, snapshot imutável); 20 rodadas de 10 telefones distintos (com e sem barreira `aposRevalidar`; 1 criada, 9 `horario_indisponivel`, `causa 23P01` nas variantes com barreira, 1 reserva/1 item/1 consentimento/1 mensagem); recusas sem gravar nada (fora do funcionamento, 17:45 que ultrapassa o fechamento, fora da grade, antes da antecedência, após a janela, dia fechado, bloqueio, ocupado, profissional inativo/não vinculado, serviço inativo, ids de outro salão ou malformados; o outro salão ficou idêntico); aceitos em 10:00 e 17:30; idempotência (sequencial `criada`/`repetida` com o mesmo id, `chave_reutilizada` para outro horário e outros serviços, chave não UUID `invalido`, 10 em paralelo com a mesma chave: 1 `criada` + 9 `repetida` com 1 só id, mesma chave em outro salão cria reserva independente); atomicidade por trigger em reserva, item, consentimento e mensagem (rollback total, nome "Ana" e `atualizado_em` da cliente inalterados, contagens idênticas); `consentimento_ausente` para 6 formas de `aceites` (público e equipe) e `invalido` para telefone/nome ruins, sem linhas; encaixe da equipe (fora da jornada, `encaixe = true`, 2º sobreposto `23P01`, passado `invalido`) e `RangeError` no público; política que nega (`salao_indisponivel` no público, `AcessoNegado` na equipe); `antesDaReserva` recusando (`recusado`, nada persiste); fila que falha (reserva `criada`, mensagem `pendente`). Plano sem Seq Scan: coberto pelo teste existente `tests/integration/disponibilidade/plano.test.ts` (passou na cobertura completa). `'confirmado'` literal conferido no SQL de `repos/reserva.ts`; ordem de travas documentada no cabeçalho de `repos/servico.ts`.

Mix paralelo (reserva × reserva × desativar/reativar profissional × editar serviço × editar telefone × salvar regras do salão, 15 rodadas): sem impasse nem erro em ambiente quieto.

### 3. Defeito

**DEF-1 — Deadlock `40P01` no INSERT da reserva quando várias requisições disputam o mesmo horário**   Severidade: **alta**   Estado: aberto
CA relacionado: CA-2 ("nenhum erro lançado"), CA-2b, CA-15 ("não há impasse `40P01`"), CA-28 (estabilidade); RN-3/RN-13.
Ambiente: branch `feat/d-025-criar-reserva`, Node 24, PostgreSQL 17 (compose), pool de testes 16, 8 CPUs.
Passos para reproduzir:
1. `docker compose up -d postgres`; `npm run db:generate`.
2. Criar um teste de integração temporário que, por rodada, cria `criarCenarioReserva()` e dispara `Promise.all` de 10 `criarReserva(ctxSistema, entradaReserva(cen, { chaveRequisicao: randomUUID() }), { enfileirar, aposRevalidar: criarBarreira(10) })` (10 telefones distintos, mesmo profissional e horário), 40 rodadas por arquivo.
3. Executar 4 a 5 cópias do arquivo ao mesmo tempo (carga de CPU/banco): `npx vitest run --project integration <arquivo> --silent=false`.
Resultado esperado: por rodada, 1 `criada` e 9 `horario_indisponivel`; nenhuma exceção.
Resultado observado: em ambiente quieto 0 falhas em 400 e em 12 execuções do teste de exploração; sob carga, em 5 execuções simultâneas de 400 requisições: 0, 0, 0, 7 e 25 requisições **rejeitadas** com `PrismaClientKnownRequestError` P2010 `Raw query failed. Code: 40P01. Message: deadlock detected` em `src/server/repos/reserva.ts:153` (`RepoReserva.criar`, o `INSERT … ON CONFLICT … DO NOTHING RETURNING`), chamada de `criar-reserva.ts:201`; numa delas também um `P2028` em `reservaItem.createMany` (transação já encerrada pelo deadlock). A 3ª rodada de uma bateria anterior, executada enquanto o `test:coverage` rodava, também falhou assim. O erro sai de `criarReserva` como exceção (5xx para o usuário) em vez de `horario_indisponivel`.
Análise: as 10 transações inserem tuplas de `reserva` com faixas sobrepostas; a `reserva_sem_sobreposicao` (exclusion) verifica o conflito depois de inserir a entrada no índice, então duas ou mais transações que inserem quase ao mesmo tempo veem a tupla ainda não confirmada da outra e esperam uma pela outra (ciclo). O detector de impasse aborta uma com `40P01`. O experimento do DBA (§1, 25 rodadas com 2 reservas) e as 10 concorrentes com barreira em ambiente quieto não expõem a janela, mas ela é real e cresce com a concorrência. O `ehConflitoDeSobreposicao` só reconhece `23P01`, então o `40P01` sobe sem tradução. Isto não viola a integridade (nenhuma sobreposição, nada parcial persiste), mas descumpre o contrato "perdedoras = `horario_indisponivel`, sem erro lançado" no caso de uso central da demanda.
Classe de falha: concorrência / ordem de travas entre INSERTs com exclusion constraint.
Sugestões (decisão do arquiteto e do DBA, não implementadas por mim): (a) serializar as criações por profissional antes do INSERT (por exemplo `pg_advisory_xact_lock` no profissional, ou `FOR NO KEY UPDATE` na linha do profissional no lugar de `FOR SHARE`, mantendo a ordem de travas), o que elimina o ciclo e deixa a perdedora ver o conflito como `23P01`; (b) alternativa: tratar `40P01` no INSERT como transitório e repetir a transação uma vez (reavaliando a revalidação). Em qualquer caso, acrescentar teste de concorrência que passe sob carga (por exemplo, rodadas repetidas com dois arquivos em paralelo) e rever o texto do CA-15/CA-28 do `dev.md`, que afirma ausência de `40P01` apenas com medição em ambiente quieto.

### 4. Status por critério de aceitação

CA-1, CA-3..CA-14, CA-16..CA-27: **passaram** (testes do desenvolvedor reexecutados na cobertura completa e conferidos pelo exploratório acima; o CA-27 foi conferido sobre o erro real do Prisma 7, P2010, em `criar.test.ts`).
CA-2, CA-2b, CA-15, CA-28: **falham sob carga** (DEF-1); passam em ambiente quieto.

Cobertura medida: 99,57% de linhas (limiar 90%); exclusões não alteradas; testes novos verificam comportamento (contagens por tabela, estados, ids, esperas por `pg_stat_activity`).

### 5. Pendências

- Alto: DEF-1 (aberto).
- Sem defeitos críticos. Sem divergência entre o total declarado no `dev.md` e o medido.
- Riscos aceitos pelo líder e não reabertos: sem `lock_timeout`, D-5 rejeitada, exclusion não cobre `bloqueio`.

Próxima ação: líder aciona o arquiteto (e o DBA) para decidir a serialização por profissional ou a repetição em `40P01`; o desenvolvedor implementa e o tester refaz a rodada, incluindo a bateria sob carga descrita no DEF-1.

### 6. Observações (complemento do líder; não são defeitos)

- **Upsert da cliente:** o desenvolvedor manteve o da D-022 (`repos/cliente.ts`: `DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now()`), e não só `atualizado_em` como o DBA sugeriu. Verificado (teste temporário, apagado): reserva criada para cliente existente "Ana" com o nome "Ana Souza" grava o nome novo, avança `atualizado_em` e mantém 1 só cliente; com rollback (`23P01` e falha forçada em cada etapa) o nome e o `atualizado_em` permanecem os anteriores (CA-6, também em `atomicidade.test.ts`). Comportamento correto; a divergência com a sugestão do DBA é só de redação, e o nome sobrescrito é o comportamento aceito pela spec (RN-12).
- **Documentação:** o `design.md` não registra a correção do vínculo lido em 2º comando (A-3/§3.4); ela consta só no `dev.md` (§5, item 3b) e no `dba.md` §9. Sugere-se um adendo no `design.md`.
- **`dev.md`** foi editado depois da bateria do desenvolvedor sem reexecução; os números válidos são os da seção 1 deste relatório (reexecutados pelo tester).

## Rodada 2 (reteste do DEF-1)

**Veredito: APROVADO.** DEF-1 **verificado (fechado)**. Nenhum defeito aberto.

Mudanças testadas: `FOR NO KEY UPDATE OF p` em `RepoProfissional.travarParaReserva` (A-20, dba.md "Revisão 2"), `tests/integration/reservas/carga.test.ts`, ajustes de CA-15/CA-2/CA-2b.

### Gates (reexecutados)

| Comando | Resultado |
|---|---|
| `npm run lint`, `typecheck`, `build`, `build:node` | exit 0 (do próprio npm, sem pipe) |
| `npm run test:coverage` completo | 3 execuções: **2 verdes** (345 arquivos, **4248 testes**, linhas **99,57%**; números idênticos ao `dev.md`) e **1 vermelha** (exit 1: 5 arquivos, 8 testes; ver observação O-1). Pico de conexões na execução monitorada: 52 de 100 |
| `npm run test:e2e` (app/worker parados, porta livre) | 112 passaram, exit 0 |
| `sh docker/smoke.sh` | `smoke: OK` |
| `concorrencia` + `idempotencia` + `carga` ×10, `--maxWorkers=2` | 10/10 (21 testes; ~17 s por execução) |

### Bateria de carga que reprovou a Rodada 1, reexecutada

Teste temporário (apagado): 30 rodadas por tamanho, N transações simultâneas no mesmo profissional/horário, 10 telefones distintos, largada simultânea por barreira antes de chamar `criarReserva` (o gancho `aposRevalidar` não serve mais de barreira: depois da correção a trava do profissional serializa e a barreira dentro dela nunca completaria; é o desenho, o `carga.test.ts` já a coloca fora da trava).

| Cenário | Requisições | `40P01` | `P2028`/outros erros | Rodadas com exatamente 1 reserva e 1 `criada` |
|---|---|---|---|---|
| 1 cópia, N=10 e N=16 | 780 | 0 | 0 | todas |
| 5 cópias simultâneas, N=10 (300 cada) e N=16 (480 cada) | 3900 | 0 | 0 | todas |
| 8 cópias simultâneas, N=10 | 2400 | 0 | 0 | todas |

Latência por reserva sob carga: 1 cópia p50 71–89 ms, p99 175–188 ms; 5 cópias p50 102–197 ms, p99 até 376 ms, máx. 396 ms; 8 cópias p50 94–110 ms, p99 até 540 ms, máx. 612 ms. Razoável. Na Rodada 1 a mesma carga produzia até 25 `40P01` por 400 requisições.

Mix sob carga (8 reservas em 2 horários × desativar/reativar profissional × editar serviço × editar telefone da cliente × salvar regras do salão, 25 rodadas, 5 cópias simultâneas): 0 erros, 0 impasse, exatamente 2 `criada` por rodada. A integridade contra sobreposição segue garantida pela exclusion (1 reserva por horário em todas as rodadas).

### Status por critério

CA-1..CA-28 e CA-2b: **passaram**; CA-2, CA-2b, CA-15 e CA-28 agora também sob carga. O novo CA-29 (carga) passou nas execuções acima.

### Observações (não bloqueiam)

- **O-1 (risco de flakiness do gate por conexões):** na 1ª execução do `test:coverage` da rodada falharam 8 testes em 5 arquivos (`carga.test.ts` com `P2037 sorry, too many clients already` e `53300`, `prisma migrate deploy no template falhou`, `harness/pool`, `harness/db`, `mensagens/envio`, `recuperacao-senha-concorrencia`). É esgotamento do `max_connections = 100`. Havia outros agentes usando o mesmo PostgreSQL na ocasião e não consigo excluir essa causa; em execução isolada o pico é 52. Mas o `carga.test.ts` abre um pool próprio de 24 além dos pools de até 16 por worker, e a CI e o README permitem execuções simultâneas; sob outra carga no mesmo servidor o gate pode oscilar. Recomendação: reduzir o pool do `carga.test.ts` ou marcá-lo para rodar sozinho; reavaliar se a oscilação reaparecer na CI. Não reprova (2 de 3 execuções verdes, falha atribuível ao ambiente compartilhado).
- Observações da Rodada 1 (upsert da cliente, adendo do design sobre o vínculo em 2º comando) permanecem como estão.

Estado final: só o `postgres` no ar, porta 3000 livre, testes temporários apagados.
