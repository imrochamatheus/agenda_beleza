# D-008 — Desenvolvimento (T-1, T-2, T-5, T-6, T-7, T-8, T-9)

Autor: desenvolvedor. Entradas: `issue-9.md`, `spec.md`, `design.md`, `dba.md` (parecer recebido durante a T-6; ajustes A-1..A-4 aplicados) e `devops.md` (parte 1; `stop_grace_period: 30s` já no compose). Branch `feat/d-008-fila-worker`, Node 24.21.0, PostgreSQL 17 do compose. Nada foi commitado.

## 1. Tarefas e arquivos

| Tarefa | Arquivos |
|---|---|
| T-1 | `package.json`, `package-lock.json` (+`pg-boss@12.38.0`, +`@opentelemetry/api@1.10.0`, exatos, em `dependencies`); `src/server/env.ts` (+`QUEUE_RETRY_LIMIT`, `QUEUE_RETRY_DELAY_SECONDS`, `QUEUE_RETRY_BACKOFF`; `Env.fila`); `src/server/env.test.ts`; `src/server/check-env.test.ts`; `.env.example`; `src/server/queue/{config,erros,filas}.ts` (+ testes) |
| T-2 | `eslint.config.mjs` (padrão `PG_BOSS`; blocos disjuntos `WORKER` e `FILA`; `src/worker/**` saiu de `ACESSO_AO_BANCO`); `tests/integration/lint/importacao-fila.test.ts` |
| T-5 | `tests/support/db.ts` (`filaPgBoss` em `INICIALIZADORES`, com `opcoesPgBoss(url, 'instalador')`); `tests/support/fila.ts` (`abrirBossDeTeste`, `fecharBoss`, `esperar`, `esperarEstado`, `capturarLog`, `envDeTeste`, `empacotarWorker`, `iniciarWorkerDeTeste`); `tests/integration/worker/schema.test.ts` |
| T-6 | `src/server/queue/client.ts` (+ `client.test.ts`); `tests/integration/fila/{cliente,indisponivel}.test.ts` |
| T-7 | `src/worker/iniciar.ts` (+ teste); `src/worker/stub.ts` e `stub.test.ts` **removidos** (comportamentos migrados para `iniciar.test.ts`); `src/worker/main.ts`, `main.test.ts`; `src/worker/handlers/{tipos,registry,exemplo,assinatura-prazos,whatsapp-reserva,reconciliar-mensagens}.ts` + `handlers.test.ts`; `tests/integration/worker/{retry,agendamentos,resiliencia,inicio-encerramento}.test.ts` |
| T-8 | `package.json` (`build:node` com `src/scripts/enfileirar-exemplo.ts`; script `fila:exemplo`); `src/server/queue/enfileirar-exemplo.ts`; `src/scripts/enfileirar-exemplo.ts` (+ teste); `tests/integration/fila/enfileirar-exemplo.test.ts`; `tests/integration/worker/{ponta-a-ponta,sigterm,compose}.test.ts` |
| T-9 | `README.md` (tabela do compose; `fila:exemplo`; seção nova "Fila de jobs e worker" com filas, enfileirar pós-commit, `exclusive`/`singletonKey`, retry e esperas reais, encerramento, eventos, R-3, R-7, retenção (A-2), verificação manual do CA-4, fórmula de conexões de produção, privilégios (A-3), upgrade; "Banco de teste" com o inicializador `pgboss`, orçamento A-1 e o laço de estabilidade; lint do `pg-boss`); este `dev.md`. **`CLAUDE.md` não foi editado** (ver §5, P-1) |

## 2. Gates (comandos e resultados)

| Comando | Resultado |
|---|---|
| `npm ci` + `npm run db:generate` | ok, `found 0 vulnerabilities`; pg-boss sem install script (nada novo em `allowScripts`) |
| `npm run lint` | ok, 0 avisos |
| `npm run typecheck` | ok |
| `npm run build` (sem `.env`, sem `DATABASE_URL`/`QUEUE_*`) | ok, rc=0 (CA-15) |
| `npm run build:node` (sem `DATABASE_URL`) | ok: `dist/worker/main.js` 17.7kb, `dist/scripts/enfileirar-exemplo.js` 13.9kb, `dist/scripts/check-env.js` 7.1kb |
| `npm test` | `Test Files 91 passed (91)`, `Tests 1228 passed (1228)` |
| `npm run test:coverage` | rc=0; **linhas 100% (941/941)**; statements 99.16%, branches 98.08%, funções 99.62%. `server/queue` 100% linhas; `worker` 100% linhas. Nenhuma exclusão nova no `vitest.config.ts` |
| `npm run test:e2e` | `1 passed` (smoke em viewport móvel) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/worker/retry.test.ts …` | 10/10 ok (CA-2/CA-3) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/worker/sigterm.test.ts …` | 10/10 ok (CA-4) |
| `TZ=America/Sao_Paulo npx vitest run --project integration tests/integration/worker/agendamentos.test.ts` | `Tests 3 passed` |
| `tests/integration/fila` 3 vezes seguidas (critério da T-6) | 3/3 ok (15 testes) |
| `grep -rn "repos\|integrations\|generated/prisma" src/worker/handlers` | vazio (RN-17) |
| `grep -rn "from 'pg-boss'" src` | só `src/server/queue/{config,client}.ts` e `src/worker/iniciar.ts` (+ testes). `filas.ts`/`erros.ts` não importam o pg-boss; `config.ts` só com `import type` |

Verificação manual (T-8), com a base de desenvolvimento:
```
$ npm run worker   # outro terminal: npm run fila:exemplo -- 3000
{"evento":"fila.enfileirado","fila":"exemplo","id":"68a88d03-…","esperaMs":3000}
{"evento":"worker.iniciado",…,"filas":["assinatura-prazos","exemplo","reconciliar-mensagens","whatsapp-reserva"]}
{"evento":"worker.exemplo_iniciado",…,"esperaMs":3000}
{"evento":"worker.job_concluido",…,"fila":"exemplo","tentativa":1}
{"evento":"worker.encerrando",…,"sinal":"SIGINT"}
{"evento":"worker.encerrado",…}
```
Repetição com SIGINT durante o job e SIGTERM 1 s depois (2º sinal ignorado): `worker.encerrando (SIGINT)` → `worker.job_concluido` → `worker.encerrado`, **código de saída 0**.

## 3. Testes e CAs

| CA | Testes |
|---|---|
| CA-1 | `tests/integration/worker/ponta-a-ponta.test.ts` (cliente enfileira `exemplo` e `whatsapp-reserva`; ambos `completed`; `job_concluido` das duas filas; job em `pgboss.job`) |
| CA-2 | `tests/integration/worker/retry.test.ts` (3 execuções, `completed`, `retryCount` 2; Δ1 ≥ 1 s, Δ2 ≥ 2 s; atrasos agendados `atraso1 ≥ 0,95 s` e `atraso2 > atraso1`, ajuste R-1) |
| CA-3 | `retry.test.ts` (3 execuções; `failed` por `getJobById` com `output.message` da 3ª; 3 `worker.job_falhou` com tentativas 1, 2, 3 e sem o payload; job de outra fila e da mesma fila `completed` sem reiniciar) |
| CA-4 | `tests/integration/worker/sigterm.test.ts` (processo filho empacotado com os argumentos do `build:node`; SIGTERM com o job `active`, 2º SIGTERM ignorado; saída 0, sem sinal, < 30 s; job `completed`; ordem `encerrando` → `job_concluido` → `encerrado`) |
| CA-5 | `src/server/queue/config.test.ts` (versões exatas em `dependencies` e no lock; nada com `^`/`~`) |
| CA-6 | `tests/integration/worker/schema.test.ts` (schema e versão 46 = `pgboss.schema` do pacote; 0 filas; `start()` do worker na cópia sem migração nem tabela nova; template só com o inicializador do pg-boss sem sessões abertas) |
| CA-7 | `handlers.test.ts` (`REGISTRO`), `ponta-a-ponta.test.ts` (`worker.iniciado` com as 4 filas; 4 filas no pg-boss excluindo `__pgboss__%`; um job por stub `completed`; tabelas e contagens de `public` iguais antes e depois), `agendamentos.test.ts` (políticas) |
| CA-8 | `agendamentos.test.ts` (iniciar/parar/iniciar → 2 agendamentos UTC sem duplicata; sem cron → removido; volta quando o cron volta; órfão de fila fora do registro removido) e `iniciar.test.ts` (ordem e filtro do `unschedule`) |
| CA-9 | `tests/integration/fila/cliente.test.ts` (2 jobs + `chave_em_uso`; `Promise.all` de 8 = 1 job; nova criação depois de `complete` e de `fail` com `QUEUE_RETRY_LIMIT=0`) |
| CA-10 | `filas.test.ts` (unitário) e `cliente.test.ts` (contagem em `pgboss.job` inalterada; chave ausente) e `client.test.ts` (nenhum I/O antes da validação) |
| CA-11 | `env.test.ts` (padrões, vazias, extremos, 10 valores inválidos nomeando só a variável, comentário do `.env.example`), `check-env.test.ts`, `iniciar.test.ts` (worker sai com 1 sem construir o pg-boss), `cliente.test.ts` (colunas 3/7/false e 4/30/true) |
| CA-12 | `tests/integration/worker/resiliencia.test.ts` (sessões `agenda-beleza:worker` conferidas antes; `pg_terminate_backend`; `worker.erro_fila` sem senha nem URL; job seguinte `completed`; nenhuma saída) |
| CA-13 | `iniciar.test.ts` (relógio falso: `adaptadores` → `iniciado` → `heartbeat` a cada 30 s, `em` UTC; ambiente inválido) e `inicio-encerramento.test.ts` (base inexistente: `falha_inicio` com `3D000`, saída 1, sem senha). D-007 CA-1/CA-2/CA-9 migrados do `stub.test.ts` |
| CA-14 | `iniciar.test.ts` (`stop` uma vez com `{ graceful: true, timeout: 25000 }`; 2º sinal e SIGINT ignorados; forçado → 1; `stop` que lança → 1), `inicio-encerramento.test.ts` (prazo 2 s + job 5 s → `encerramento_forcado`, saída 1, job em `retry` com `pg-boss shut down while active`), `compose.test.ts` (`stop_grace_period: 30s` > 25 000 ms; `init: true`) |
| CA-15 | `client.test.ts` (import sem construir o pg-boss nem logar; `criarClienteFila` não lê a fonte) + build/build:node sem ambiente |
| CA-16 | `tests/integration/fila/indisponivel.test.ts` (`fila_inexistente`, `conexao`/`ECONNREFUSED` na porta 1, `schema_ausente` após `DROP SCHEMA`; mensagem, `cause`, `JSON.stringify` e `stack` sem a senha) + `erros.test.ts` |
| CA-17 | `tests/integration/lint/importacao-fila.test.ts` (erro em 10 caminhos fora das pastas liberadas, inclusive `import type`; aceito em queue/worker/testes; D-007 e RN-10 continuam valendo; o cliente é importável pela app). `importacao-prisma` e `importacao-integracoes` verdes sem alteração |
| CA-18 | §2 |

Script manual: `src/scripts/enfileirar-exemplo.test.ts` (ponto de entrada sem banco) e `tests/integration/fila/enfileirar-exemplo.test.ts` (sem fila → 1; 5 argumentos inválidos → 1; 0 com job `esperaMs` gravado; padrão 0; erro inesperado propagado com o cliente encerrado).

## 4. Desvios do design e decisões de implementação

- **D-A (detecção do encerramento forçado):** além do contador `emAndamento` (§3.6), o worker conta `interrompidos`: jobs cujo `signal` abortou com o handler ainda rodando depois do pedido de encerramento. Motivo: no código do pg-boss 12.38.0, o `failWip()` aborta o sinal antes de o `stop()` resolver, e um handler que respeita o sinal (o `exemplo`) pode rejeitar e decrementar `emAndamento` antes da checagem, o que daria saída 0 num encerramento forçado. O sinal também fica abortado em toda conclusão normal (comentário do `manager.js`), por isso o ouvinte é removido no `finally` e só conta com `parado`. Saída 1 se `emAndamento > 0 || interrompidos > 0`; o evento traz os dois números. Coberto em `iniciar.test.ts` (inclusive "abort depois da conclusão não conta").
- **D-B (`ErroFilaIndisponivel.motivo`):** campo `motivo` (`schema_ausente` | `fila_inexistente` | `conexao`) exposto além de `fila` e `codigo`; `3F000`/`42P01` também contam como `schema_ausente` (schema apagado depois do `start()` do cliente).
- **D-C (`criarClienteFila(fonte, criar?)`):** segundo parâmetro opcional para injetar o construtor do pg-boss, usado só nos unitários sem I/O (o design previa um espião; a injeção evita `vi.mock` de módulo nesses casos). O teste de import (CA-15) usa `vi.doMock('pg-boss')`, sem I/O.
- **D-D (`ehNomeFila`):** exportada de `filas.ts` para recusar nomes como `toString` (`Object.hasOwn`).
- **D-E (`worker.aviso_fila`):** registra a mensagem do aviso (sanitizada) em vez de um campo `tipo`, porque o evento `warning` da 12.38.0 entrega `{ message, data }`, sem o tipo.
- **D-F (falha de início):** o worker sinaliza "encerrado durante o início" por uma exceção interna quando um sinal chega no meio da sincronização, sem registrar `falha_inicio` (o encerramento cuida da saída). Agendamentos com nome `__pgboss__*` são ignorados na remoção de órfãos (A-4 do DBA).
- **D-G (`iniciarWorkerDeTeste`, `fecharBoss`):** auxiliares a mais em `tests/support/fila.ts`, para não repetir a montagem do worker em processo.
- **A-4 do DBA aplicado:** contagens de filas excluem `name LIKE '\_\_pgboss\_\_%'` (`ponta-a-ponta`, `agendamentos`). O `schema.test.ts` não conta filas depois do `start()` do worker. A sincronização só itera o registro.
- Política `restart` (devops §5): não adotada, conforme a recomendação do DevOps.

## 5. Pendências e riscos

- **P-1 (`CLAUDE.md`):** não editei o `CLAUDE.md`. Uma mensagem de agente não autoriza mudar esse arquivo. Texto proposto para o líder aplicar com autorização do usuário:
  - "Project status", depois da frase da D-007: `D-008 (E0.7) added the pg-boss queue (pinned 12.38.0, schema `pgboss`, installed and migrated only by the worker): queue contracts and the app client in `src/server/queue/` (enqueue only after commit; the only place besides `src/worker/**` allowed to import `pg-boss`, enforced by lint), the real worker in `src/worker/iniciar.ts` (handlers in `src/worker/handlers/`, retry from `QUEUE_RETRY_LIMIT`/`QUEUE_RETRY_DELAY_SECONDS`/`QUEUE_RETRY_BACKOFF`, UTC crons, graceful SIGTERM within 25 s; compose `stop_grace_period: 30s`) and the `pgboss` schema initializer in the test template.` E remover "There is no queue yet (E0.7)."
  - Tabela "Comandos e cobertura", duas linhas novas: `| Enfileirar job de exemplo | \`npm run fila:exemplo -- 3000\` | \`build:node\` + enfileira um job \`exemplo\` de 3 s (0 a 60000 ms); com \`npm run worker\` no ar, o log mostra \`worker.job_concluido\`. No compose: \`docker compose exec worker node dist/scripts/enfileirar-exemplo.js 20000\` |` e `| Estabilidade da fila (D-008) | \`for i in $(seq 10); do npx vitest run --project integration tests/integration/worker/retry.test.ts tests/integration/worker/sigterm.test.ts \|\| break; done\` | CA-2 (backoff) e CA-4 (SIGTERM em processo filho) |`. Na linha "Worker local", trocar "Ctrl-C encerra com 0" por "Ctrl-C espera os jobs em andamento (até 25 s) e sai com 0".
- **R-a (verificação manual com bash):** num shell não interativo, `cmd &` dentro de uma lista `a && b &` põe um subshell entre o sinal e o Node, e o SIGINT é ignorado. Isso não afeta o compose nem o Ctrl-C num terminal. Só afeta quem automatizar a verificação: mande o sinal ao PID do Node.
- **R-b:** a T-10 (DevOps) ainda precisa conferir a imagem (`import('pg-boss')`, `dist/scripts/enfileirar-exemplo.js`) e o CA-4 no compose. Os seis jobs da CI só podem ser conferidos no PR.
- **R-c:** o `.env` local foi criado com `cp .env.example .env` para rodar os testes de integração (arquivo ignorado pelo git).
- Sem TODO no código.
