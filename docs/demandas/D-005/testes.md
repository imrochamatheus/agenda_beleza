# D-005 — Testes (T-7, tester)

## Rodada 1 — 18/11/2026

### Ambiente
- Branch `feat/d-005-escopo-salao`, árvore de trabalho sem commit (base `1906605`). Node 24.21.0, Prisma 7.10.1, PostgreSQL 17.12 (`postgres:17` do compose), Vitest 5.1.1, Chromium do Playwright (viewport 375×812). Adaptadores: não se aplica.
- Preparação: `npm ci` + `npm run db:generate` (instalação limpa); `docker compose up -d --wait postgres` (só o postgres; app e worker parados, porta 3000 livre). **Sem `.env`**: `DATABASE_URL` e `TEST_DATABASE_URL` exportadas no shell com os valores do `.env.example`.
- Base de desenvolvimento (`agenda_beleza`): estava vazia; para o CA-17 ter o que proteger, rodei `npm run db:migrate:deploy` (3 migrações) e criei a tabela sentinela `tester_sentinela` com 1 linha. A sentinela foi apagada no fim; as 3 migrações ficaram aplicadas (estado normal de uso).
- Mutações: cópia do repositório no scratchpad (fora do repo; `node_modules` por link simbólico), mesmo PostgreSQL. Cada mutação foi revertida por cópia do original e conferida com `cmp`/`diff -rq` (sem diferenças). O repositório não foi alterado, exceto por este arquivo: `git status --short` final idêntico ao inicial.

### Gates
| Comando | Resultado |
|---|---|
| `npm run typecheck` | exit 0 (inclui os `@ts-expect-error` do CA-13 e dos fixtures do CA-4) |
| `npm run lint` | exit 0, 0 avisos |
| `npm run build` | exit 0 (`/api/health` dinâmica) |
| `npm run build:node` | exit 0 |
| `npm run test:unit` com o PostgreSQL **parado** e `env -u DATABASE_URL -u TEST_DATABASE_URL` | exit 0: 22 arquivos, 83 testes |
| `npm run test:integration` | exit 0: 24 arquivos, 323 testes (12,2 s) |
| `npm test` | exit 0: 46 arquivos, 406 testes |
| `npm run test:coverage` | exit 0: 46 arquivos, 406 testes. **Linhas 100% (297/297)**, statements 100% (305/305), funções 100% (84/84), ramos 99,33% (150/151) |
| `npm run test:e2e` (porta 3000 livre) | exit 0: 1 teste (`smoke.spec.ts`, mobile-chromium) |
| Exclusões de cobertura | Sem mudança: o diff do `vitest.config.ts` só troca `globalSetup`, acrescenta `setupFiles`, `maxWorkers: 4`, `fileParallelism` e `sequence.groupOrder`. Limiar `lines: 90` intacto. `grep -rnE "v8 ignore\|istanbul ignore\|c8 ignore\|eslint-disable" src tests eslint.config.mjs vitest.config.ts --exclude-dir=generated` → vazio |
| Testes desligados | `grep -rnE "\.(skip\|only\|todo)\(\|\.fails" tests src` → vazio |
| Asserções vazias | Varredura de todos os `it(`/`test(` de `tests/integration/**` e `src/server/**`: todos têm `expect`; nenhum `expect(x);` sem matcher; nenhum `toBeDefined()`/`toBeTruthy()` nos testes novos |
| Migrações | Nenhuma nova (esperado, spec §8). As 3 existentes aplicam no template de cada execução e na base de dev |
| `.env.example`, `docker-compose.yml`, `package.json` | Sem mudança (nenhuma variável nova). CI: inexistente (E0.3) |

### Verificações manuais pedidas
**CA-5 (lint):** criei `src/app/viola.ts` (`import { PrismaClient } from '@/generated/prisma/client'`) e `src/server/tenant/viola2.ts` (`import { obterPrisma } from '../repos/db'`) → `npm run lint` exit 1, 2 erros `no-restricted-imports` com as mensagens da RN-10. Arquivos removidos; `npm run lint` exit 0 de novo.

**CA-6 (laço de 10):** `for i in $(seq 10); do npx vitest run --project integration tests/integration/concorrencia --maxWorkers=2 --silent=false; done` → **10/10 exit 0**, 8/8 testes em cada execução, 3,7 a 10,0 s.

| Exec | `reserva-paralela-a` | `reserva-paralela-b` |
|---|---|---|
| 1 | `VITEST_POOL_ID=2`, `agenda_beleza_test_rmwmq4e9zc8_w2` | `VITEST_POOL_ID=1`, `agenda_beleza_test_rmwmq4e9zc8_w1` |
| 2 | 2, `…_rmwmq4kaqqu_w2` | 1, `…_rmwmq4kaqqu_w1` |
| 3 | 2, `…_rmwmq4qglvd_w2` | 1, `…_rmwmq4qglvd_w1` |
| 4 | 2, `…_rmwmq4x0ldj_w2` | 1, `…_rmwmq4x0ldj_w1` |
| 5 | 2, `…_rmwmq53y7g9_w2` | 1, `…_rmwmq53y7g9_w1` |
| 6 | 2, `…_rmwmq5at6ye_w2` | 1, `…_rmwmq5at6ye_w1` |
| 7 | 2, `…_rmwmq5hkyn2_w2` | 1, `…_rmwmq5hkyn2_w1` |
| 8 | 2, `…_rmwmq5khby9_w2` | 1, `…_rmwmq5khby9_w1` |
| 9 | 2, `…_rmwmq5r6evl_w2` | 1, `…_rmwmq5r6evl_w1` |
| 10 | 2, `…_rmwmq5yualk_w2` | 1, `…_rmwmq5yualk_w1` |

**CA-17 (guarda, base de dev intacta):** foto antes e depois de cada caso: `pg_database` = `agenda_beleza, agenda_beleza_test, postgres, template0, template1`; na dev, `_prisma_migrations` = 3, `tester_sentinela` = 1, OID 16384. Igual em todas as fotos.

| Caso | Resultado |
|---|---|
| `TEST_DATABASE_URL` ausente | exit 1, "TEST_DATABASE_URL não definida…" |
| `TEST_DATABASE_URL` = `DATABASE_URL` | exit 1, "TEST_DATABASE_URL aponta para a mesma base de DATABASE_URL…" |
| mesma base com `127.0.0.1` × `localhost` | exit 1, mesma mensagem |
| `TEST_DATABASE_URL` → `postgres` | exit 1, "…não pode ser uma base de sistema…" |
| `DATABASE_URL` = `agenda_beleza_test_tpl` (nome parecido com um derivado) | exit 0: não colide, porque os derivados levam `_r<exec>_` |

Nenhuma saída contém a senha (`grep -c agenda_dev` = 0 nas 5). Os casos de colisão de nome derivado e de 47 caracteres estão em `harness/banco.test.ts` e passaram na suíte.

**Execuções simultâneas:** duas `npm run test:integration` disparadas juntas → as duas com exit 0, 24 arquivos e 323 testes cada, nenhum `53300`. Durante a execução: `…_rmwmq6pfqja_{tpl,w1..w4}` e `…_rmwmq6pfquy_{tpl,w1..w4}` (mais os `_w7` avulsos do `harness/db.test.ts`), 42 sessões. Depois: só as 5 bases originais. A dev ficou intacta (3 migrações, sentinela = 1). Observação: os dois `exec` têm o mesmo prefixo de relógio (`mwmq6pfq`), ou seja, foram gerados no mesmo milissegundo e só os 2 caracteres aleatórios os separaram (ver DEF-1).

### Mutações (aplicadas na cópia; os testes têm de falhar)
| ID | Mutação | Resultado |
|---|---|---|
| M1 | `profissional.ts`: `findFirst` sem `salaoId` | **morta**: 4 falhas (CA-1 ×2, CA-7, CA-8 de profissional) |
| M2 | `cliente.ts`: `updateMany` sem `salaoId` (leitura escopada mantida) | **morta**: CA-2 (cliente), porque a linha de B mudou. O 404 sozinho não teria pegado; a comparação de todas as colunas pegou |
| M3 | `reserva.ts`: `listarPorPeriodo` sem `salaoId` | **morta**: CA-7 ×2 (listagens) |
| M4 | fixture `valida.acao.ts` sem `capacidade` | **morta**: CA-4 ×2 |
| M4b | `src/app/mutacao.acao.ts` (ação "de produto" sem capacidade + exportação crua) | **morta**: CA-4 "todas as ações de produto…" acusa `sem_capacidade` e `nao_e_acao`. Prova que o registro cobre ações reais, não só os fixtures |
| M5 | dba §5: sem `ALTER … ALLOW_CONNECTIONS false` (suíte completa) | **morta**: A-1 e A-2 (`template.test.ts`) |
| M5c | dba §5 completa: sem o `ALTER` + teste que conecta ao template e chama `recriarBaseDoWorker()` | **morta**: a cópia falha depois de 5,9 s com `Harness (reset): o template da execução está em uso por outra sessão… (SQLSTATE 55006)`, causa `source database "…_tpl" is being accessed by other users`. Controle com o `ALTER`: a conexão é recusada na hora ("not currently accepting connections") |
| M6 | `define-acao.ts`: política consultada com `'leitura'` | **morta**: CA-11 |
| M7 | `POOL_MAX_TESTES = 1` | **morta**: CA-16 |
| M8 | `repos/sessao.ts` sem `expiraEm > agora` | **morta**: CA-9c, CA-13, CA-18 |
| M9 | `expiraEm >= agora` (limite) | **morta**: CA-9c (limite `expira_em = agora`) |
| M10 | `resolverAdmin` sem a checagem de TOTP | **morta**: CA-13 |
| M11 | `listarProfissionaisPublicos` sem `ativo: true` | **morta**: CA-12 ×2 |
| M12 | `emTransacao` com repositórios ligados ao cliente padrão, e não ao `tx` | **morta**: CA-14 ×2 |
| M13 | `defineAcao` sem a checagem de papel | **morta**: CA-9e, CA-11 (política não consultada para papel recusado) |
| M14 | inicializador que deixa um `pg.Client` aberto no template | **morta**: o `globalSetup` falha com "Sessões abertas no template… (application_name: harness:vazador-tester)", e o template é apagado (nenhuma base sobra). Sem listener de `error` no cliente vazado, o `DROP … FORCE` derruba o processo antes da mensagem (o dev.md já registra esse risco) |
| M15 | inicializador que remove `reserva_sem_sobreposicao` do template | **morta**: CA-6 ×3 (A, B com trava e B sem trava). Prova que, mesmo com a trava do apoio, a recusa vem da exclusion |
| M16 | reset por arquivo desligado (base reaproveitada, `--isolate=false`) | **morta**: CA-6 "a base deste worker contém só o salão criado por este arquivo" ×2, CA-18 ×4 |

Todas as 18 mutações foram mortas. Depois de cada uma, `pg_database` voltou às 5 bases originais.

### Avaliação do CA-6 com a trava do profissional (F-1)
- A issue pede que dois arquivos de concorrência rodem em workers paralelos, sem que um veja os dados do outro, e passem de forma determinística 10 vezes. O spec acrescenta N ≥ 10 transações concorrentes no mesmo profissional e horário, com exatamente 1 aceita e N−1 recusas `23P01`.
- Com a trava `FOR NO KEY UPDATE`, as 12 transações ficam abertas ao mesmo tempo, mas os `INSERT` passam a ser serializados pela trava da linha do profissional. A recusa continua vindo da exclusion: a M15 remove a constraint e as 11 "recusadas" passam a ser aceitas, e os testes falham. A garantia do banco sob contenção real, sem trava, fica provada pelo caso sem trava do arquivo B (6 transações, exatamente 1 aceita, recusas `23P01` ou `40P01`). Esse caso passou 10/10 no laço e nas suítes completas.
- Conclusão: o CA-6 continua provando o que a issue pede (isolamento por worker, determinismo e a garantia "nunca duas aceitas"). A trava fica só no apoio de teste e não mascara a constraint. O F-1 não invalida nenhum CA desta demanda. Ele é um requisito de desenho para a E3.2/E3.4: o código de reserva deve travar o profissional ou tratar `40P01` como "horário indisponível". Sem isso, a corrida real pode responder 500 ou levar 1 s ou mais. Recomendo registrá-lo na issue da E3.2/E3.4, com o arquiteto e o DBA.

### Resultado por CA
| CA | Estado | Evidência |
|---|---|---|
| CA-1 | passou | `tenant/isolamento.test.ts` (4 agregados, 404, sem dados de B); M1 |
| CA-2 | passou | `isolamento.test.ts` (linha de B idêntica em todas as colunas); M2 |
| CA-3 | passou | `tenant/fabricas.test.ts`; `grep -nE "INSERT\|\$executeRaw\|\$queryRaw" isolamento.test.ts` → vazio; `factories.ts`/`auth.ts` sem SQL manual |
| CA-4 | passou | `tenant/registro.test.ts`; M4, M4b |
| CA-5 | passou | `lint/importacao-prisma.test.ts` + verificação manual (lint exit 1 → 0) |
| CA-6 | passou | laço 10/10 com workers 1 e 2 distintos em todas as execuções; M15, M16 |
| CA-7 | passou | `isolamento.test.ts` CA-7; M3 |
| CA-8 | passou | `isolamento.test.ts` CA-8 (sem `22P02`); M1 |
| CA-9 | passou | `tenant/define-acao.test.ts` CA-9a..f; M8, M9, M13 |
| CA-10 | passou | `define-acao.test.ts` CA-10 |
| CA-11 | passou | `define-acao.test.ts` CA-11; M6, M13 |
| CA-12 | passou | `tenant/publico.test.ts`; M11 |
| CA-13 | passou | `tenant/contextos.test.ts` + typecheck (`@ts-expect-error` usados); M10 |
| CA-14 | passou | `tenant/transacao.test.ts`; M12 |
| CA-15 | passou | `harness/template.test.ts`; M5, M5c, M16 |
| CA-16 | passou | `harness/pool.test.ts`; M7 |
| CA-17 | passou | `harness/banco.test.ts`, `template.test.ts` + verificação manual com a dev intacta |
| CA-18 | passou | `tenant/exigir-contexto.test.ts`, `src/server/tenant/next.test.ts` |
| CA-19 | passou | testes da E0.4 verdes na base do worker; gates acima; sem `eslint-disable` e sem exclusão nova |

### Invariantes tocadas (regressão)
- Isolamento entre salões: CA-1, 2, 7, 8 e 12, mais as mutações M1–M3 e M11.
- Sobreposição e concorrência: CA-6, M15 e os testes de constraint da D-004 (`db/reserva-exclusion.test.ts`), que passaram.
- Super admin: o `AdminContext` exige TOTP (M10). A auditoria é da E8.1.
- Salão suspenso: a política padrão permite. A regra real é da E6.4.
- Fuso, webhooks, mensagens e anonimização: não foram tocados. As fábricas gravam em UTC.

### Defeitos
```
DEF-1 — Execuções simultâneas iniciadas no mesmo milissegundo podem colidir no nome do template   Severidade: baixa   Estado: verificado (Rodada 2)
CA relacionado: CA-17 / S-8 (README "Execuções simultâneas são permitidas")
Ambiente: feat/d-005-escopo-salao (sem commit, base 1906605), Node 24.21.0, PostgreSQL 17.12
Passos para reproduzir: 1. Disparar duas `npm run test:integration` ao mesmo tempo (ex.: `(npm run test:integration &) ; npm run test:integration`). 2. Observar em pg_database os nomes `…_r<exec>_tpl`.
Resultado esperado: nomes de execução distintos com probabilidade desprezível.
Resultado observado: na rodada, os dois exec foram `mwmq6pfqja` e `mwmq6pfquy`: mesmo relógio (8 caracteres) e só 2 caracteres aleatórios de diferença (36² = 1296 combinações). `novoExec` (tests/support/banco.ts:77) usa relógio em ms + 2 caracteres aleatórios. Quando os dois sufixos coincidem (≈ 1/1296 por par iniciado no mesmo ms, cenário comum em CI com jobs paralelos no mesmo servidor), o `CREATE DATABASE …_tpl` da segunda execução falha com 42P04 e ela reprova por motivo espúrio. A primeira não é afetada, porque o CREATE fica fora do try que apaga o template. Não houve falha nesta rodada; o risco foi inferido do código e dos nomes observados.
Classe de falha: harness / concorrência entre execuções
Sugestão: mais entropia no sufixo (o limite de 46 caracteres da base absorveria +2 a 4 caracteres se o A-4 for recalculado) ou nova tentativa com outro exec em 42P04.
```

Nenhum defeito crítico, alto ou médio.

### Observações (não são defeitos desta demanda)
- F-1: ver a avaliação acima (para a E3.2/E3.4).
- A regra `no-restricted-imports` não cobre `import()` dinâmico nem `require()` (risco já registrado pelo dev, T-2).
- O `CLAUDE.md` ("Project status" e a linha "Migrações") segue desatualizado desde a D-004. Está fora da posse desta demanda, mas convém corrigir no fechamento.

### Veredito
**APROVADO.** Os 19 CAs passaram com evidência. Todos os gates passaram, com cobertura de linhas de 100% (≥ 90%), e as 18 mutações foram mortas. O único defeito aberto, DEF-1, é de severidade baixa e não bloqueia.

## Rodada 2 — 18/11/2026 (reteste do DEF-1 + regressão)

### Ambiente
O mesmo da Rodada 1: Node 24.21.0, PostgreSQL 17.12, sem `.env`, variáveis do `.env.example` exportadas. A correção está em `tests/support/banco.ts` (`novoExec`: 5 caracteres de relógio em minutos e 5 aleatórios via `crypto.randomInt`, 36^5 = 60.466.176 sufixos). Os testes novos estão em `tests/integration/harness/banco.test.ts` (`-t "DEF-1"`). O `CLAUDE.md` também mudou ("Project status" e a linha "Migrações"), e conferi que o texto está coerente com o estado do código. As mutações rodaram de novo numa cópia no scratchpad, revertidas e conferidas com `diff -rq` (sem diferenças), e a cópia foi apagada.

### Reteste do DEF-1
| Verificação | Resultado |
|---|---|
| `npx vitest run --project integration tests/integration/harness/banco.test.ts -t "DEF-1"`, 30 vezes seguidas | 30/30 com exit 0 (o limite ≥ 4.990 distintos em 5.000 não oscilou) |
| Duas `npm run test:integration` simultâneas | as duas com exit 0, 326/326 cada, sem `53300`. Templates `…_rht8f27sh6r_tpl` e `…_rht8f27vnkb_tpl`: mesmo minuto (`ht8f2`), sufixos de 5 caracteres distintos. Depois, só as 5 bases originais; a dev continuou com 3 migrações |
| R2-Ma: sorteio padrão reduzido a `randomInt(36 ** 2)` (volta à entropia de 2 caracteres) | **morta**: "DEF-1: 5.000 execs gerados no MESMO instante são (praticamente) todos distintos" falha |
| R2-Mb: algoritmo antigo literal (8 caracteres de relógio em ms + 2 de `Math.random`) | **morta**: 4 falhas no `-t "DEF-1"`/`novoExec`, entre elas o teste de distinção do DEF-1 |

### Varredura de órfãs e limite de 46 caracteres
- O comprimento do `exec` continua 10, e o padrão de órfã continua `^<base>_r([0-9a-z]{10})_(tpl|w[0-9]{1,3})$`. Pior caso: 46 + `_r` (2) + 10 + `_w999` (5) = 63, que segue dentro do limite de identificador.
- `instanteDoExec` arredonda para baixo, para o minuto. Uma base parece até 59 s mais velha do que é, o que é irrelevante para a idade mínima de 6 h. A execução corrente nunca é varrida.
- Nome no formato antigo: decodifica num instante no futuro e é mantido (falha segura). O teste do DEF-1 confere só a decodificação no futuro; a manutenção decorre do filtro `agora − instante ≥ 6 h`, que já é coberto pelos casos de idade negativa.
- R2-Mc (`IDADE_ORFA_MS` = 5 h): **morta**, 3 falhas ("a idade mínima é de 6 h", filtro puro e varredura real contra o catálogo, que testa 7 h × 5 h).
- R2-Md (`MAX_BASE_DE_TESTE` = 47): **morta**, 2 falhas (46 aceito × 47 recusado; guarda antes de conectar).

### Regressão
| Comando | Resultado |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 0 avisos |
| `npm run build` | exit 0 |
| `npm run test:integration` | exit 0: 24 arquivos, 326 testes (eram 323; +3 do DEF-1) |
| `npm run test:coverage` | exit 0: 46 arquivos, 409 testes. **Linhas 100% (297/297)**, statements 100% (305/305), funções 100% (84/84), ramos 99,33% (150/151) |
| Exclusões de cobertura e `eslint-disable`/`v8 ignore` | nenhuma nova (grep vazio; limiar 90 intacto) |
| Duas execuções simultâneas | ver acima: as duas com exit 0 |

O `src/` não mudou nesta rodada (a correção é só do harness de testes), então o `test:unit` e o E2E da Rodada 1 continuam valendo. O `git status --short` ficou igual ao do início da rodada, exceto por este arquivo.

### Defeitos
- DEF-1 (baixa): **verificado**. A correção foi confirmada e as mutações R2-Ma/R2-Mb foram mortas.
- Nenhum defeito aberto.

### Veredito final
**APROVADO.** Os 19 CAs passaram (Rodada 1, sem regressão na Rodada 2), todos os gates passaram, a cobertura de linhas é 100% e não há defeito aberto.
