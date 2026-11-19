# D-008 — Testes (T-11, tester)

## Rodada 1 — 19/11/2026

### Ambiente
- Branch `feat/d-008-fila-worker` (conferida no início e no fim), árvore de trabalho sem commit sobre `d6a96c6`. Node 24.21.0 (`nvm use`), pg-boss 12.38.0, @opentelemetry/api 1.10.0, PostgreSQL 17 (`postgres:17` do compose), Chromium do Playwright (viewport 375×812), imagem `agenda-beleza:dev` de 11:51:45 (nenhum arquivo de `src/`, `package*.json`, `Dockerfile` ou `docker/` mais novo que ela: `find … -newermt` vazio).
- Adaptadores: os quatro em `simulado`.
- Instalação limpa: `npm ci && npm run db:generate` → exit 0, `found 0 vulnerabilities`.
- Para o build sem ambiente (CA-15), o `.env` foi movido para o scratchpad durante `npm run build`/`build:node` e restaurado (`diff` com a cópia: idêntico).
- Arquivos temporários do tester (sondas da R-9 em `tests/integration/r9tmp/`) foram removidos depois do uso. O job de exploração deixado em `retry` na base de dev foi apagado (`DELETE 1`). No fim: `postgres` no ar, `app` e `worker` parados, porta 3000 livre, nenhuma base `agenda_beleza_test_*` órfã, nenhum bundle em `node_modules/.cache/agenda-beleza`. `git status` igual ao inicial, exceto por este arquivo.

### Gates
| Comando | Resultado |
|---|---|
| `npm run lint` (`--max-warnings=0`) | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` (sem `.env`, `env -u DATABASE_URL -u QUEUE_RETRY_*`) | exit 0 (CA-15) |
| `npm run build:node` (sem `.env` nem `DATABASE_URL`) | exit 0: `dist/worker/main.js` 17.7kb, `dist/scripts/enfileirar-exemplo.js` 13.9kb, `dist/scripts/check-env.js` 7.1kb |
| `npm test` | exit 0: **91 arquivos, 1228 testes**, 44,7 s |
| `npm run test:coverage` | exit 0: 91 arquivos, 1228 testes. **Linhas 100% (941/941)**; statements 99,16% (1065/1074); funções 99,62% (263/264); ramos 98,08% (613/625). `server/queue` 100% linhas; `worker` 100% linhas |
| `npm run test:e2e` (porta 3000 livre) | exit 0: 1 passou (`smoke.spec.ts`, mobile-chromium) |
| Laço de estabilidade: `for i in $(seq 10); do npx vitest run --project integration tests/integration/worker/retry.test.ts tests/integration/worker/sigterm.test.ts \|\| break; done` | **10/10**, `Tests 4 passed (4)` em todas |
| `TZ=America/Sao_Paulo npx vitest run --project integration tests/integration/worker/agendamentos.test.ts tests/integration/worker/retry.test.ts` | exit 0, 5 testes |
| `docker compose config` (worker) | `init: true`, `stop_grace_period: 30s` |
| Exclusões de cobertura | `git diff vitest.config.ts` vazio; `grep -rnE "v8 ignore\|istanbul ignore\|c8 ignore" src tests` vazio |
| Testes desligados / `eslint-disable` | `grep -rnE "\.(skip\|only\|todo)\(" src tests` e `grep -rn eslint-disable src tests eslint.config.mjs` vazios |
| Asserções | todos os `it(` novos (`iniciar.test.ts`, `handlers.test.ts`, `client/config/erros/filas.test.ts`, `enfileirar-exemplo.test.ts`, `tests/integration/{worker,fila}/*`, `importacao-fila.test.ts`) têm `expect`/`rejects` no corpo ou em auxiliar com asserção (`umErro`, `SEM_ERRO`, `semSenha`, `iniciarEParar`) |
| Versões | `package.json#dependencies`: `pg-boss` `12.38.0`, `@opentelemetry/api` `1.10.0`; lock resolve as mesmas versões |
| Migrações | nenhuma migração Prisma nova; o `drift.test.ts` passa com o schema `pgboss` no template (dentro do `npm test`) |
| CI | `.github/workflows/ci.yml` sem mudança; o CA-4 empacota o próprio worker (esbuild no teste). Os seis jobs só podem ser conferidos no PR |

### Verificações independentes (além dos testes do dev)

**R-9 (sessões vazadas no fim de cada arquivo de worker).** Sonda temporária: um arquivo por teste de `tests/integration/worker/*` que registra um `afterAll` e depois faz `await import('../worker/<arquivo>.test')`. Com a ordem `stack` dos hooks, a sonda roda depois do `afterAll` do dev e consulta `pg_stat_activity` da base do worker do Vitest (`backend_type = 'client backend'`, excluindo a própria sessão; polling de até 2 s). `npx vitest run --project integration tests/integration/r9tmp --maxWorkers=1`:
```
[R-9] inicio-encerramento []   [R-9] ponta-a-ponta []   [R-9] agendamentos []   [R-9] resiliencia []
[R-9] sigterm []               [R-9] schema []          [R-9] retry []
Test Files 7 passed (7), Tests 18 passed (18)
```
Controle negativo (um teste que abre `abrirBossDeTeste()` sem fechar): a sonda falha com `[{"application_name":"agenda-beleza:teste","state":"idle"}]`. Ou seja, ela detecta vazamento. **Nenhuma sessão vazada.** Isso importa porque o harness recria a base com `DROP … WITH (FORCE)`, que esconderia o vazamento.

**CA-4 manual no compose** (`docker compose up -d --wait`; `docker compose exec -T worker node dist/scripts/enfileirar-exemplo.js 20000`; espera do `worker.exemplo_iniciado` **daquele id**; `docker compose stop worker`):
```
{"evento":"worker.exemplo_iniciado","em":"…15:01:07.437Z","id":"08edf6d4-…","esperaMs":20000}
{"evento":"worker.encerrando","em":"…15:01:08.097Z","sinal":"SIGTERM"}
{"evento":"worker.job_concluido","em":"…15:01:27.437Z","fila":"exemplo","id":"08edf6d4-…","tentativa":1}
{"evento":"worker.encerrado","em":"…15:01:27.495Z"}
stop levou 19,67 s; docker compose ps -a worker → Exited (0)
```
`docker compose logs worker | grep -cE "agenda_dev|postgresql://"` → 0. Na imagem, `import('pg-boss')` → `function`, versão `12.38.0`.
Nota de procedimento: a 1ª tentativa foi descartada, porque o `grep exemplo_iniciado` casou com o log da execução do DevOps no mesmo contêiner e o `stop` saiu antes de o job ser buscado. O job ficou em `created` e foi processado no reinício seguinte (`91ee6ef0…`, `job_concluido`), o que confirma de quebra que um job pendente sobrevive à parada. Para quem repetir o roteiro do README num contêiner reaproveitado: filtre por `--since` ou pelo id.

**D-A (código de saída do encerramento forçado), por processo real.** O mesmo roteiro com `esperaMs: 40000`:
```
{"evento":"worker.encerrando",…"sinal":"SIGTERM"}
{"evento":"worker.job_falhou",…"tentativa":1,"erro":{"nome":"Error","mensagem":"exemplo interrompido"}}
{"evento":"worker.encerramento_forcado",…"emAndamento":0,"interrompidos":1}
stop levou 25,23 s; Exited (1); job: state=retry, retry_count=0, output "pg-boss shut down while active"
```
**Avaliação do D-A: correto e necessário.** No caso real (handler que respeita o `AbortSignal`, como o `exemplo`), o `failWip()` do pg-boss 12.38.0 aborta o sinal antes de o `stop()` resolver. O handler rejeita e `emAndamento` já está em 0 na checagem. Só com o contador do D-A, `emAndamento 0 / interrompidos 1`, a saída fica em 1, como exigem a RN-15 e a D-9. Sem ele, a saída seria 0 num encerramento forçado. Conferi no código do pacote (`dist/manager.js`, `failWip` e o comentário sobre `resolveWithinSeconds`) que o sinal também é abortado em toda conclusão normal. Por isso o ouvinte é removido no `finally`, antes de o `callback` resolver, e não há falso positivo: o caso de 20 s acima saiu com 0. O unitário "abort depois da conclusão não conta" cobre o mesmo ponto. O D-A não muda nenhum CA. Ele só torna verdadeira a D-9 na versão fixada.

**Ambiente inválido e falha de início por processo** (`dist/worker/main.js`, `dist/scripts/check-env.js`):
- `QUEUE_RETRY_LIMIT=abc` → `{"evento":"worker.ambiente_invalido",…,"variaveis":["QUEUE_RETRY_LIMIT"]}`, rc=1 (antes de `worker.adaptadores`, sem conexão);
- `QUEUE_RETRY_BACKOFF=sim node dist/scripts/check-env.js` → `… inválidas: DATABASE_URL, QUEUE_RETRY_BACKOFF`, rc=1;
- URL com senha errada `SenhaX9` → `worker.falha_inicio` com `codigo 28P01`, sem a senha, rc=1.

**Lint (CA-17), por `eslint --stdin --stdin-filename`.** `import { PgBoss } from 'pg-boss'` dá erro em `src/app/x.ts`, `src/server/tenant/x.ts`, `src/lib/x.ts` e `src/scripts/x.ts`, e é aceito em `src/server/queue/x.ts`, `src/worker/x.ts`, `src/worker/handlers/x.ts` e `tests/integration/x.test.ts`. O Prisma continua aceito em `src/worker/**`, como na `main` (`ACESSO_AO_BANCO` já incluía `src/worker/**`). Já `await import('pg-boss')` em `src/app/z.ts` **passa**: ver DEF-1.

**Backoff (CA-2).** Fórmula do pacote (`dist/plans.js`): `retry_delay · (2^(n+1)/2 + 2^(n+1)/2 · random())`. A 1ª espera fica em [d, 2d] e a 2ª em [2d, 4d]. Então `atraso2 > atraso1` só empata no ponto 2d (probabilidade nula), e a asserção do teste não é instável. O README e o `.env.example` descrevem a mesma faixa.

**Revisão de invariantes.**
- Payload sem dados pessoais: contratos `z.strictObject` só com UUID (exceto `exemplo`, `esperaMs`, conforme a D-4); os logs de falha não levam o payload (CA-3 confere que `4321` não aparece). Ver a observação O-1 sobre a `singletonKey`.
- Isolamento entre salões: não há leitura de domínio nesta demanda. `grep -rn "repos\|integrations\|generated/prisma\|\$queryRaw" src/worker/handlers src/server/queue` (fora de testes) → vazio. O CA-7 confere as tabelas e as contagens de `public` iguais antes e depois.
- `pg-boss` fora das pastas permitidas: `grep -rln pg-boss src` → só `src/server/queue/**` e `src/worker/**` (em `filas.ts`, `erros.ts` e `tipos.ts`, só em comentários).
- Fuso: crons com `tz: 'UTC'`; testes verdes com `TZ=America/Sao_Paulo`.
- Idempotência: `singletonKey` com política `exclusive` (CA-9, inclusive `Promise.all` de 8 → 1 job); a chave é obrigatória em `whatsapp-reserva`, o que impede deduplicar a fila inteira.

### Critérios de aceitação
| CA | Resultado | Evidência |
|---|---|---|
| CA-1 | **passou** | `ponta-a-ponta.test.ts` (registro de produção, cliente da app, `exemplo` e `whatsapp-reserva` em `completed`, job em `pgboss.job`); compose manual (job `08edf6d4…` concluído) |
| CA-2 | **passou** | `retry.test.ts` (3 execuções, `completed`, Δ1 ≥ 1 s, Δ2 ≥ 2 s, atraso agendado crescente); laço 10/10; fórmula conferida no pacote |
| CA-3 | **passou** | `retry.test.ts` (3 execuções, `failed` com `output.message` da 3ª, 3 `job_falhou` com tentativas 1, 2 e 3 e sem o payload, outra fila e a mesma fila concluem sem reinício) |
| CA-4 | **passou** | `sigterm.test.ts` (processo filho, SIGTERM real, 2º sinal ignorado, saída 0 < 30 s, ordem dos eventos); laço 10/10; compose manual: 19,67 s, `Exited (0)` |
| CA-5 | **passou** | `config.test.ts`; lock e `package.json` conferidos; `pg-boss` 12.38.0 na imagem |
| CA-6 | **passou** | `schema.test.ts` (schema e versão 46 = `pgboss.schema` do pacote, 0 filas, `start()` sem migração, template sem sessões); `drift.test.ts` verde |
| CA-7 | **passou** | `ponta-a-ponta.test.ts` (`worker.iniciado` com as 4 filas, 4 filas no pg-boss, um job por stub `completed`, `public` inalterado); `handlers.test.ts` |
| CA-8 | **passou** | `agendamentos.test.ts` (2 agendamentos UTC sem duplicata depois de iniciar/parar/iniciar; remoção ao perder o cron; órfão removido); também com `TZ=America/Sao_Paulo` |
| CA-9 | **passou** | `cliente.test.ts` (2 jobs + `chave_em_uso`; concorrência 8 → 1; reuso depois de `completed` e de `failed` com `QUEUE_RETRY_LIMIT=0`) |
| CA-10 | **passou** | `cliente.test.ts` (5 payloads recusados, contagem de `pgboss.job` inalterada), `filas.test.ts`, `client.test.ts` (sem I/O antes de validar) |
| CA-11 | **passou** | `env.test.ts` (padrões, vazias, extremos, 10 inválidos nomeando só a variável, comentários do `.env.example`), `check-env.test.ts`, `iniciar.test.ts`, `cliente.test.ts` (colunas 3/7/false e 4/30/true); processo: `ambiente_invalido` rc=1 e `check-env` rc=1 |
| CA-12 | **passou** | `resiliencia.test.ts` (`pg_terminate_backend` filtrado por `agenda-beleza:worker`, `worker.erro_fila` sem senha nem URL, job seguinte `completed`, nenhuma saída) |
| CA-13 | **passou** | `iniciar.test.ts` (relógio falso, `em` UTC, ambiente inválido sem `start()`, D-007 CA-1/2/9 migrados), `inicio-encerramento.test.ts` (`3D000`, rc 1, sem senha); processo (`28P01` sem senha) |
| CA-14 | **passou** | `iniciar.test.ts` (`stop` único com `{graceful: true, timeout: 25000}`, 2º sinal ignorado), `inicio-encerramento.test.ts` (prazo 2 s + job 5 s → `encerramento_forcado`, saída 1), `compose.test.ts`, `docker compose config`; compose real: `Exited (1)` em 25,23 s |
| CA-15 | **passou** | `build` e `build:node` com exit 0 sem `.env`, `DATABASE_URL` ou `QUEUE_*`; `client.test.ts` (import sem I/O nem leitura do ambiente) |
| CA-16 | **passou** | `indisponivel.test.ts` (`fila_inexistente`, `conexao`/`ECONNREFUSED`, `schema_ausente`; mensagem, `cause`, `JSON.stringify` e `stack` sem senha) |
| CA-17 | **passou** (com DEF-1, baixa) | `importacao-fila.test.ts`; sondagem `eslint --stdin` acima. O import estático, que é o critério verificado, é barrado. O dinâmico escapa (DEF-1) |
| CA-18 | **passou localmente** | todos os gates acima; cobertura 100% de linhas; a lógica do processo filho está em `iniciar.ts`, coberta no mesmo processo. **Pendente:** os seis jobs da CI só no PR (líder) |

### Defeitos

```
DEF-1 — import dinâmico de pg-boss não é barrado pelo lint   Severidade: baixa   Estado: aberto
CA relacionado: CA-17 (D-8)
Ambiente: feat/d-008-fila-worker sem commit sobre d6a96c6, Node 24.21.0, eslint 9.39.5
Passos para reproduzir:
  1. echo "export const x = await import('pg-boss');" | npx eslint --stdin --stdin-filename src/app/z.ts --max-warnings=0
  2. echo $?
Resultado esperado: erro de lint (pg-boss só em src/server/queue/** e src/worker/**).
Resultado observado: exit 0, nenhuma mensagem. `no-restricted-imports` só vê `import`/`export … from` estáticos.
Classe de falha: regra de lint (fronteira de módulos)
Observação: a lacuna é anterior à demanda e vale igualmente para Prisma, SDKs e adaptadores (D-005/D-007 usam a
mesma regra). O CA-17 é atendido no sentido do teste da spec (import estático). Correção sugerida, sem urgência e
para todas as restrições de uma vez: `no-restricted-syntax` com `ImportExpression[source.value=/^pg-boss/]`
(e equivalentes), numa demanda de manutenção do lint.
```

Nenhum defeito crítico, alto ou médio.

### Observações (não são defeitos)
- **O-1 (`singletonKey` sem formato):** o cliente aceita qualquer texto como `chave`, que é gravado em `pgboss.job.singleton_key`. Hoje só testes o usam. A E7.1 deve fixar e validar o formato `reserva:tipo:revisao` (só IDs e números) no contrato da fila, para que a chave nunca carregue dado pessoal.
- **O-2 (roteiro manual do CA-4):** num contêiner reaproveitado, `docker compose logs` traz as execuções antigas. Sugestão para o README: `docker compose logs -f --since 1m worker` ou esperar pelo id impresso por `enfileirar-exemplo`.
- **O-3 (CI):** a conferência dos seis jobs fica para o PR, como registrado pelo dev (R-b) e pelo DevOps (T-10).

### Veredito da rodada 1
**APROVADO.** Os CAs 1 a 18 passaram, com o CA-18 local completo e a CI pendente de conferência no PR pelo líder. Todos os gates passaram: lint, typecheck, build, build:node, `npm test` (1228), cobertura de **100% das linhas** (941/941), E2E (1/1) e laço de estabilidade 10/10. Não há defeito crítico, alto ou médio aberto. O único aberto é o DEF-1, de severidade baixa e anterior à demanda.
