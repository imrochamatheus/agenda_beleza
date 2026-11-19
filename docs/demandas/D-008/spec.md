# D-008: fila de mensagens com pg-boss em um worker separado (issue #9, E0.7)

Autor: analista-requisitos. Fontes, da maior para a menor precedência:
1. `docs/demandas/D-008/issue-9.md`: RN-1..RN-6 e CA-1..CA-4 já decididos (não reabertos aqui).
2. `PLAN.md`: "Mensagens pelo WhatsApp" (`PLAN.md:84`), "Assinatura" (`:65-70`), "Direção técnica" (`:119-127`) e critérios de aceite 5, 6 e 11 (`:139-145`).
3. `CLAUDE.md`: "Required stack" (fila no PostgreSQL, worker separado) e invariante "WhatsApp messages" (enfileirar depois de salvar; idempotência `reserva:tipo:revisao`; falha de envio não altera a reserva).
4. `docs/demandas/D-001/`: `spec.md:345-373` (item E0.7), `dba.md:63-66` e `:164`, `devops.md:50-54`, `:97` e `:112`, `dev.md:21` e `:105`, `design.md:487-516`; itens consumidores E4.2 (`spec.md:984`), E6.3 (`:1236`), E7.1 (`:1392`), E3.2 CA-4 (`:830`).
5. D-003 (stub do worker, compose, entrypoint), D-005 (harness com inicializadores de schema, `dba.md:105-106` sobre o pool do pg-boss), D-006 (CI), D-007 (`env.ts`, `check-env`, lint).
6. Código da branch `feat/d-008-fila-worker`, com base em `d6a96c6` (main).

Esta especificação não reabre nenhuma decisão da issue. As adições são de três tipos: (a) RNs complementares e CAs que tornam verificáveis os entregáveis da issue sem CA próprio; (b) a fronteira com E4.2, E6.3 e E7.1; (c) decisões não bloqueantes, marcadas como D-n no §9, para o arquiteto confirmar. Cada adição indica a origem.

## 1. Problema

Não existe fila nem worker real. Evidências:

- `grep -c 'pg-boss' package-lock.json` → `0`; `package.json` não tem `pg-boss` em `dependencies`.
- `src/worker/stub.ts:3`: "Stub do worker até a E0.7 (pg-boss). Não acessa o banco." O stub só valida o ambiente, registra `worker.adaptadores` (`:28`), emite `worker.heartbeat` a cada 30 s (`:4`, `:33`) e, em SIGTERM/SIGINT, sai com 0 imediatamente (`:40-47`), sem nenhum trabalho em andamento para concluir.
- `src/worker/main.ts` só chama `iniciarWorker` do stub com `process.env`, `console` e `process`.
- `ls src/server/queue src/worker/handlers` → inexistentes.
- `docker-compose.yml:54-62` (serviço `worker`): sem `stop_grace_period` (padrão do Docker: 10 s).
- `src/server/env.ts:18-25` (`esquemaEnv`): não declara `QUEUE_RETRY_LIMIT`, `QUEUE_RETRY_DELAY_SECONDS` nem `QUEUE_RETRY_BACKOFF`; o `.env.example` também não.
- `tests/support/db.ts:62-63`: "A E0.7 acrescenta o do pg-boss." Hoje `INICIALIZADORES = [schemaDeProva]`; o template de teste não tem o schema `pgboss` (D-005 RN-12 e D-1).
- `docker/entrypoint.sh:15-16`: o worker já roda com `exec node /app/dist/worker/main.js` (recebe o SIGTERM diretamente; D-003 RN-8). O `Dockerfile:15-18` faz `npm prune --omit=dev` e o bundle usa `--packages=external` (`package.json`, script `build:node`), então o `pg-boss` precisa estar em `dependencies`.
- A CI (`.github/workflows/ci.yml`, job `testes`) roda `npm ci`, `db:generate`, `db:migrate:deploy` e `test:coverage`. Ela **não** roda `build:node`, o que importa para o teste em processo filho (CA-4).

Consequência: a frase "O envio ocorre depois da gravação da reserva, por uma fila no PostgreSQL […] processada por um worker separado" (`PLAN.md:84`) não tem implementação. Ficam bloqueados E7.1 (mensagens), E6.3 (prazos da assinatura por job agendado) e a limpeza periódica de E4.2, e com eles os critérios 5 e 6 do PLAN.

## 2. Objetivo

Um processo worker, separado do Next.js e ligado ao mesmo banco, consome jobs do pg-boss (schema `pgboss`):
- com novas tentativas e atraso crescente configuráveis por ambiente;
- sem cair quando um job falha;
- com jobs agendados (cron) registrados;
- encerrando de forma graciosa no SIGTERM, dentro do prazo do compose.

A app ganha um cliente de fila para enfileirar jobs (com `singletonKey`) **depois** do commit. Os handlers que E6.3 e E7.1 vão preencher já existem como stubs registrados, e cada demanda futura só edita o próprio arquivo.

## 3. Escopo

### Entra
1. **Dependência** `pg-boss` com versão exata em `dependencies` (D-007/`.npmrc save-exact`; RN-5). A versão é escolhida pelo arquiteto. Referência consultada em 19/11/2026: `npm view pg-boss dist-tags` → `latest: 12.38.2`, `maint-v10: 10.4.2`.
2. **`src/worker/main.ts`** (substitui o stub de E0.2): valida o ambiente, inicia o pg-boss no schema `pgboss`, garante as filas, registra os handlers e os agendamentos, mantém o heartbeat e trata SIGTERM/SIGINT com `stop({ graceful: true })` e timeout de 25 s. A lógica fica testável por injeção de dependências, como no stub atual (`DependenciasWorker`).
3. **`src/worker/handlers/registry.ts`**: a lista fixa de definições de fila de produção. Cada arquivo de handler exporta a própria definição (D-3).
4. **Handlers**:
   - `src/worker/handlers/exemplo.ts`: o job de exemplo (D-4), funcional;
   - `assinatura-prazos.ts`, `whatsapp-reserva.ts` e `reconciliar-mensagens.ts`: stubs registrados, sem acesso a dados de domínio (D-5).
5. **Política de retry** (`retryLimit`, `retryDelay`, `retryBackoff`) lida de `QUEUE_RETRY_LIMIT`, `QUEUE_RETRY_DELAY_SECONDS` e `QUEUE_RETRY_BACKOFF`, numa função única usada pelo worker e pelo cliente.
6. **`src/server/queue/client.ts`**: o cliente de fila da app. Ele enfileira com `singletonKey` opcional, valida o payload por fila, é usado só depois do commit e não instala nem migra o schema (D-6).
7. **Validação de ambiente**: as três variáveis em `src/server/env.ts` (e, portanto, em `check-env` e no início do worker), com padrões (D-1) e faixas (RN-10). Também entram no `.env.example`, comentadas.
8. **Compose**: `stop_grace_period: 30s` no serviço `worker`.
9. **Harness de teste**: o inicializador `pgboss` em `tests/support/db.ts` (`INICIALIZADORES`), que roda `start()`/`stop()` do pg-boss no template com todas as conexões fechadas (D-005 D-1).
10. **Lint**: `pg-boss` só pode ser importado em `src/server/queue/**` e `src/worker/**` (D-8), com teste pela API do ESLint no padrão de `tests/integration/lint/`.
11. **Testes**:
    - integração com PostgreSQL real e pg-boss real (`tests/integration/worker/*.test.ts`): CA-1..CA-3 e os complementares;
    - teste em processo filho com SIGTERM real (CA-4);
    - unitários do ambiente, da política de retry e do encerramento.
12. **README**: o papel do worker, as variáveis de retry, como enfileirar o job de exemplo e como conferir o CA-4 com `docker compose stop worker`; o orçamento de conexões com o pool do pg-boss. `CLAUDE.md` ("Project status" e "Comandos e cobertura", se surgir comando novo).

### Fica fora
- Tabelas `mensagem`/`mensagem_tentativa`, outbox, reivindicação atômica, substituição por revisão, consentimento e envio pelo adaptador: **E7.1**. O histórico de tentativas exigido pelo PLAN **não** é o do pg-boss (RN-5).
- Máquina de estados da assinatura e a lógica do job de prazos: **E6.3**.
- Tabela `rate_limit_janela` e o job de limpeza: **E4.2**.
- Reenvio manual pelo painel e visualização da fila: **E8.3** (E7.3 mostra a situação de envio).
- Endpoint HTTP ou healthcheck do worker (RN-6).
- Lembretes e mensagens promocionais (`PLAN.md:131`): nenhuma fila, agendamento ou handler para esses temas.
- Mais de uma instância de worker: não há requisito na v1. O desenho não pode *depender* de instância única, porque o pg-boss coordena os agendamentos e a idempotência dos handlers é de cada consumidor (E6.3 RN-8, E7.1 CA-9).
- Painel do pg-boss, métricas e alertas.

### Fronteira com outras demandas
| Tema | E0.7 (esta demanda) | Demanda futura |
|---|---|---|
| Envio de WhatsApp | Fila `whatsapp-reserva` criada; handler stub registrado; cliente com `singletonKey`; payload só com IDs | **E7.1**: preenche `whatsapp-reserva.ts`; define o payload (ex.: `{ mensagemId }`), a `singletonKey` `reserva:tipo:revisao`, o outbox na transação, `boss.send` após o commit, o registro de cada tentativa e o estado `falhou` |
| Reconciliação | Fila `reconciliar-mensagens` agendada; handler stub | **E7.1** (RN-9, CA-8, CA-10): lógica e, se precisar, outro cron, no próprio arquivo |
| Prazos da assinatura | Fila `assinatura-prazos` agendada; handler stub | **E6.3** (RN-3, RN-8, CA-3, CA-7): lógica idempotente, relógio injetável, cron no próprio arquivo |
| Limpeza do rate limit | Mecanismo de agendamento genérico; **sem** stub (a issue não o pede) | **E4.2** (onda 11): cria `limpar-rate-limit.ts` e acrescenta **uma linha** em `registry.ts` (D-3). Não há conflito, porque E6.3/E7.1 (onda 5) não editam o registro |
| Fila indisponível no commit | O cliente lança um erro tipado quando não consegue enfileirar (RN-12) | **E3.2 CA-4 / E7.1 CA-8**: a reserva continua salva e a reconciliação reenfileira |
| Contexto de tenant no handler | O handler recebe só IDs; o worker não abre contexto | **E6.3/E7.1**: usam `contextoDeSistema(salaoId, origem)` (`src/server/tenant/context.ts:104-111`) e os repositórios |
| Timeout HTTP dos adaptadores | Encerramento gracioso de 25 s | **E7.2** (RN-5): timeout HTTP menor que 25 s |
| Fila no painel | — | **E8.3** (lê `mensagem`, não as tabelas do pg-boss) |

## 4. Regras de negócio

Da issue (decididas):
- **RN-1**: o worker é um processo separado do servidor Next.js e usa o mesmo banco. O pg-boss fica no schema `pgboss`, separado do `public` gerido pelo Prisma.
- **RN-2**: número de tentativas, atraso e backoff são configuráveis por env. Os testes usam atraso de cerca de 1 s.
- **RN-3**: a falha de um job não derruba o worker.
- **RN-4**: SIGTERM chama `stop({ graceful: true })` com timeout de 25 s, menor que o `stop_grace_period` do compose (30 s).
- **RN-5**: a versão do pg-boss é fixada. O payload do job contém apenas IDs, sem dados pessoais. As tabelas do pg-boss não são fonte do histórico de tentativas.
- **RN-6**: o worker não expõe HTTP nem healthcheck. O heartbeat em log basta na v1.

Complementares (derivadas da issue, do PLAN, do CLAUDE.md e de D-001/D-005):
- **RN-7 (schema e instalação)** (RN-1; D-001/dba.md:64; D-6):
  - o pg-boss é configurado com `schema: 'pgboss'`. Nenhuma migração Prisma cria, altera ou referencia objetos de `pgboss`, e o `schema.prisma` não ganha `multiSchema`;
  - só o worker instala ou migra o schema `pgboss` (no `start()`) e cria as filas. A app nunca o faz: o cliente usa o modo sem migração e sem supervisão;
  - o entrypoint continua sem rodar `prisma migrate` no worker (`docker/entrypoint.sh:11`). A instalação do `pgboss` pelo pg-boss não é migração Prisma;
  - `prisma migrate diff`/drift (o teste `tests/integration/db/drift.test.ts`) continua sem diferença com o schema `pgboss` presente.
- **RN-8 (filas e registro)** (issue "Entregáveis"; D-001/dev.md:21):
  - cada handler de produção é um arquivo em `src/worker/handlers/` que exporta uma definição com: nome da fila, validador do payload, função de processamento e, opcionalmente, um cron (D-3);
  - `registry.ts` lista as definições. Em produção, a lista é exatamente: `exemplo`, `assinatura-prazos`, `whatsapp-reserva` e `reconciliar-mensagens`;
  - no início, o worker garante que cada fila existe (criação idempotente, com a política de retry da RN-9) e registra um consumidor por fila;
  - os nomes de fila são constantes exportadas, e o cliente (RN-11) as usa. Nenhum nome de fila fica duplicado como texto solto.
- **RN-9 (política de retry)** (RN-2; D-001/devops.md:52; D-1):
  - `retryLimit` = `QUEUE_RETRY_LIMIT` = número de **novas** tentativas depois da primeira execução (mesma semântica do pg-boss). Total de execuções = `QUEUE_RETRY_LIMIT + 1`;
  - `retryDelay` = `QUEUE_RETRY_DELAY_SECONDS` = atraso, em segundos, antes da primeira nova tentativa;
  - `retryBackoff` = `QUEUE_RETRY_BACKOFF`. Com `true`, o atraso cresce a cada nova tentativa (fórmula do pg-boss na versão fixada; o arquiteto a registra no design). Com `false`, o atraso é constante;
  - a política vem de uma única função que lê o `Env` validado. Ela vale para todo job criado pelo cliente ou pelo agendamento, salvo quando uma definição de fila declara outra política explicitamente (nenhuma declara nesta demanda);
  - os jobs agendados (cron) seguem a mesma política.
- **RN-10 (validação das variáveis de fila)** (D-007 RN-5; `src/server/env.ts:18-25`):
  - `QUEUE_RETRY_LIMIT`: inteiro de 0 a 20; padrão 4;
  - `QUEUE_RETRY_DELAY_SECONDS`: inteiro de 1 a 3600; padrão 30;
  - `QUEUE_RETRY_BACKOFF`: `true` ou `false`; padrão `true`;
  - vazia conta como ausente (regra vigente de `semVazias`). Valor fora da faixa ou do formato faz `validarEnv` lançar `ErroDeAmbiente` nomeando a variável, sem o valor. A app (`check-env`) e o worker falham na inicialização (o worker com `worker.ambiente_invalido` e saída 1, como hoje);
  - as três chaves entram no `.env.example`, comentadas, e passam pelo teste "chaves do `.env.example` × `env.ts`" (`src/server/env.test.ts:30-38`);
  - `npm run build` e `npm run build:node` continuam sem exigir essas variáveis.
- **RN-11 (cliente de fila)** (issue "Entregáveis": "enfileirar com singletonKey, uso pós-commit, jobs agendados"; RN-5):
  - a função de enfileirar recebe a fila (constante da RN-8), o payload e, opcionalmente, a `singletonKey`, e devolve o id do job, ou a indicação de que nenhum job foi criado por causa da `singletonKey`;
  - o payload é validado pelo validador da fila **antes** de qualquer acesso ao banco. Ele é um objeto estrito só com identificadores (UUID). Campo extra, campo que não é UUID ou payload não-objeto é recusado com erro de validação e não cria job. O job de exemplo é a única exceção (D-4);
  - `singletonKey`: enquanto houver um job da mesma fila com a mesma chave em estado criado, em nova tentativa ou ativo, um novo `enfileirar` com essa chave não cria outro job. Depois que esse job termina (concluído ou falho), um novo `enfileirar` com a mesma chave cria um novo job. Isso é exigido pelo reenvio manual de E7.1 RN-10, que reutiliza a chave (D-7);
  - o cliente usa conexão própria. A assinatura **não** aceita transação nem cliente Prisma, e por isso não pode participar da transação de negócio: chamá-lo depois do commit é responsabilidade do chamador, como documentado no módulo (D-001/design.md:20 e :244-246);
  - o cliente não registra handlers, não executa jobs e não agenda crons;
  - em `next build` e no import, o cliente não abre conexão. A conexão é preguiçosa, no primeiro uso, com uma instância por processo.
- **RN-12 (falha ao enfileirar)** (E3.2 RN-5; D-001/design.md:246):
  - se o banco ou o schema `pgboss` estiver indisponível, ou se a fila não existir (o worker nunca rodou), o cliente lança um erro tipado da fila (ex.: `ErroFilaIndisponivel`), sem `DATABASE_URL` nem credencial na mensagem ou na `cause` serializada;
  - o cliente não tenta de novo de forma síncrona. Quem decide o que fazer é o chamador (E7.1: registrar e deixar para a reconciliação).
- **RN-13 (isolamento de falhas)** (RN-3):
  - um handler que lança ou rejeita marca só aquele job como falho naquela tentativa. Os demais jobs e filas continuam sendo processados;
  - o worker escuta o evento `error` do pg-boss. Erros de conexão ou de manutenção são registrados (`worker.erro_fila`) e não derrubam o processo. O pg-boss volta a buscar jobs quando o banco reaparece;
  - cada falha de job gera um log JSON `worker.job_falhou` com fila, id do job, número da tentativa e nome e mensagem do erro. O log **nunca** inclui o payload, a `DATABASE_URL` nem credenciais;
  - esgotadas as tentativas, o job fica no estado de falha do pg-boss, consultável por id (`getJobById` ou equivalente) até a retenção do pg-boss o arquivar. A fonte de verdade do histórico de mensagens continua sendo de E7.1 (RN-5).
- **RN-14 (inicialização e logs)** (D-003 S-7; D-007 RN-14; `src/worker/stub.ts:28-33`):
  - ordem no início: validar o ambiente (falha → `worker.ambiente_invalido`, saída 1, sem tocar no banco); `worker.adaptadores` (inalterado); `start()` do pg-boss; criação das filas; registro dos consumidores e dos agendamentos; `worker.iniciado`, com a lista de filas (só nomes); depois o primeiro `worker.heartbeat` e um a cada 30 s;
  - se o `start()` falhar (banco fora do ar, sem permissão de `CREATE` no database), o worker registra `worker.falha_inicio` com o código ou nome do erro, sem URL nem senha, e sai com 1;
  - todos os eventos são uma linha JSON com timestamps em UTC (ISO 8601 com `Z`);
  - o pool de conexões do pg-boss no worker é limitado explicitamente (D-2), e o do cliente da app também.
- **RN-15 (encerramento gracioso)** (RN-4; D-001/devops.md:51-53; `docker/entrypoint.sh:3`):
  - no primeiro SIGTERM ou SIGINT: o heartbeat para, o worker registra `worker.encerrando` com o sinal e chama `stop({ graceful: true, timeout: 25 s })`. Nenhum job novo é buscado, e os jobs em andamento podem terminar;
  - quando o `stop` termina com os jobs em andamento concluídos: `worker.encerrado` e saída com código 0;
  - se o prazo de 25 s se esgotar com job ainda ativo: `worker.encerramento_forcado` e saída com código 1 (D-9). O job interrompido volta a ser processado pela expiração/retry do pg-boss, e o efeito duplicado é evitado pela idempotência dos handlers (E7.1 RN-5, E6.3 RN-8);
  - um segundo sinal durante o encerramento é ignorado (comportamento atual, `src/worker/stub.test.ts`, "ignora o segundo sinal");
  - o compose define `stop_grace_period: 30s` no `worker`, maior que os 25 s.
- **RN-16 (agendamentos)** (issue "Escopo": "jobs agendados (usados por E6.3, E7.1 e E4.2)"):
  - as definições com cron são registradas como agendamentos do pg-boss no início do worker, de forma idempotente: reiniciar o worker não duplica o agendamento. O fuso do cron é `UTC`;
  - crons padrão: `assinatura-prazos` a cada 5 minutos (`*/5 * * * *`) e `reconciliar-mensagens` a cada minuto (`* * * * *`) (D-3). E6.3 e E7.1 podem mudá-los no próprio arquivo;
  - o job criado pelo agendamento tem payload vazio (`{}`) e segue a RN-9;
  - uma definição que perde o cron (ou some do registro) tem o agendamento removido no próximo início (sem agendamento órfão).
- **RN-17 (sem dados pessoais e sem efeito na reserva)** (CLAUDE.md "WhatsApp messages"; RN-5):
  - os handlers stub não leem nem gravam nenhuma tabela de `public`;
  - nenhum código desta demanda altera `reserva`, `cliente` ou qualquer tabela de domínio.

## 5. Critérios de aceitação

Convenções:
- "Integração" = Vitest, projeto `integration`, contra o PostgreSQL real pelo harness da D-005, com pg-boss real no schema `pgboss` da base do worker do Vitest. Nada de mock de banco ou do pg-boss.
- "Worker em teste" = `iniciarWorker` (ou nome equivalente) chamado no processo do teste com dependências injetadas: env com `QUEUE_RETRY_DELAY_SECONDS=1`, intervalo de busca curto (D-10), log capturado e, quando o CA pedir, definições de fila de teste no lugar do registro de produção.
- "Processo filho" = um processo Node do sistema operacional que executa o mesmo ponto de entrada de produção (`src/worker/main.ts`, empacotado ou transpilado pelo próprio teste) e recebe um sinal real com `process.kill(pid, 'SIGTERM')`.
- Toda espera por estado é por polling com prazo (ex.: até 15 s), nunca `sleep` fixo.

### CAs da issue (CA-1..CA-4), com o modo de verificação
- **CA-1** (RN-1, RN-8, RN-11): Dado um job enfileirado pelo app, quando o worker está em execução, então o handler correspondente o processa.
  - Verificação, integração: o worker em teste roda com o registro de **produção**. O teste chama o cliente da app (`src/server/queue/client.ts`) para enfileirar `exemplo` e também `whatsapp-reserva` com um UUID qualquer. Os dois jobs chegam a `completed`, e o log tem os eventos de conclusão das duas filas. O job criado está no schema `pgboss` e não existe nenhuma tabela nova em `public`.
- **CA-2** (RN-2, RN-9): Dado um handler que falha nas 2 primeiras execuções, quando o job é processado, então ocorrem 3 tentativas com intervalos crescentes e o job termina concluído.
  - Verificação, integração: com `QUEUE_RETRY_LIMIT=4`, `QUEUE_RETRY_DELAY_SECONDS=1` e `QUEUE_RETRY_BACKOFF=true`, um handler de teste registra o instante de cada execução e falha nas 2 primeiras. Exatamente 3 execuções; estado final `completed`. Com Δ1 = t2 − t1 e Δ2 = t3 − t2: Δ1 ≥ 1 s e Δ2 > Δ1.
- **CA-3** (RN-3, RN-13): Dado um handler que sempre falha, quando se esgotam as tentativas, então o job fica em estado de falha consultável e o worker continua processando outros jobs.
  - Verificação, integração: com `QUEUE_RETRY_LIMIT=2` e atraso de 1 s, o handler executa exatamente 3 vezes, e o job fica em `failed`, consultável pelo id com o erro da última tentativa. Depois disso, um job de outra fila (e outro da mesma fila, com um handler que passa a ter sucesso) chega a `completed` sem reiniciar o worker. Há 3 linhas `worker.job_falhou` (tentativas 1, 2 e 3), e nenhuma contém o payload.
- **CA-4** (RN-4, RN-15): Dado um job longo em andamento, quando o worker recebe SIGTERM (`docker compose stop worker` ou sinal no processo filho em teste de integração), então o job conclui e o processo sai com código 0 antes de 30 s.
  - Verificação, integração (obrigatória, roda na CI): o teste enfileira `exemplo` com `esperaMs: 5000` e inicia o processo filho apontado para a base do worker do Vitest. Quando o job fica `active`, envia SIGTERM. O processo sai com código 0 em menos de 30 s desde o sinal, o job está `completed`, e a saída do processo contém, nesta ordem, `worker.encerrando`, a conclusão do job e `worker.encerrado`.
  - Verificação, processo (tester, manual): `docker compose up -d --wait`; enfileirar `exemplo` com `esperaMs: 20000` pelo comando documentado no README (D-4); assim que o log mostrar o job em andamento, `time docker compose stop worker`. O log mostra a conclusão do job e `worker.encerrado`, `docker compose ps -a worker` mostra `Exited (0)`, e o tempo fica abaixo de 30 s.

### CAs complementares (tornam verificáveis as RNs e os entregáveis sem CA próprio)
- **CA-5** (RN-5; entregável "versão fixada"): Dado o repositório, quando se lê `package.json`, então `pg-boss` está em `dependencies` (não em `devDependencies`), com versão exata (sem `^`/`~`), e o `package-lock.json` resolve exatamente essa versão. Verificação: teste unitário ou de integração que lê os dois arquivos. O job `docker` da CI continua verde.
- **CA-6** (RN-1, RN-7; schema `pgboss`): Dado o template de teste preparado pelo harness, quando um arquivo de integração começa, então a base do worker do Vitest já tem o schema `pgboss` na versão da dependência fixada, e o teste de drift (`tests/integration/db/drift.test.ts`) continua passando. Verificação: integração. Consulta ao catálogo (`pg_namespace`) e à versão gravada pelo pg-boss. O `start()` do worker numa base copiada do template não aplica migração de `pgboss` (versão já atual). O preparo do template termina sem sessões abertas (a conferência A-9 da D-005 não falha).
- **CA-7** (RN-8; stubs registrados): Dado o registro de produção, quando o worker inicia, então `worker.iniciado` lista exatamente `assinatura-prazos`, `exemplo`, `reconciliar-mensagens` e `whatsapp-reserva`, e as quatro filas existem no pg-boss. Verificação: integração. Um job enfileirado em cada stub chega a `completed`, e a contagem de linhas de todas as tabelas de `public` é a mesma antes e depois (RN-17).
- **CA-8** (RN-16; jobs agendados): Dado o worker iniciado duas vezes seguidas (iniciar, parar, iniciar), quando se consultam os agendamentos do pg-boss, então existem exatamente dois, `assinatura-prazos` (`*/5 * * * *`) e `reconciliar-mensagens` (`* * * * *`), ambos com fuso `UTC` e sem duplicata. Dado um registro de teste em que uma definição perdeu o cron, quando o worker reinicia, então o agendamento dela não existe mais. Verificação: integração (API de agendamentos do pg-boss ou consulta ao schema `pgboss`). O disparo real pelo relógio não é exigido em teste automatizado (granularidade de 1 minuto).
- **CA-9** (RN-11; `singletonKey`): Dada a fila `whatsapp-reserva` sem worker consumindo, quando se enfileira duas vezes com a mesma `singletonKey` (e uma terceira com chave diferente), então existem 2 jobs, e o segundo `enfileirar` informa que não criou job. Dado que o job da chave repetida termina (concluído, e em outro caso falho, com `QUEUE_RETRY_LIMIT=0`), quando se enfileira de novo com a mesma chave, então um novo job é criado. Verificação: integração.
- **CA-10** (RN-5, RN-11; payload só com IDs): Dado `enfileirar('whatsapp-reserva', …)` com um campo extra (ex.: `telefone`), com um id que não é UUID ou com um payload que não é objeto, então a chamada é recusada com erro de validação e nenhum job é criado (contagem no schema `pgboss` inalterada). Verificação: integração (a contagem precisa do banco) e unitário do validador.
- **CA-11** (RN-9, RN-10; retry por env no `.env.example` e no `check-env`):
  - unitário de `validarEnv`: sem as três variáveis (ou vazias), os padrões são 4, 30 e `true`. Valores inválidos (`QUEUE_RETRY_LIMIT=-1`, `21` ou `abc`; `QUEUE_RETRY_DELAY_SECONDS=0` ou `1.5`; `QUEUE_RETRY_BACKOFF=sim`) lançam `ErroDeAmbiente` cuja lista `variaveis` é exatamente a variável inválida, sem o valor na mensagem;
  - `executarCheckEnv` devolve 1 nomeando a variável; o worker sai com 1 e `worker.ambiente_invalido`, sem tocar no banco;
  - o teste "chaves do `.env.example` × `env.ts`" passa com as três chaves; o `.env.example` traz cada uma com comentário explicando unidade e padrão;
  - integração: um job criado pelo cliente com `QUEUE_RETRY_LIMIT=3`, `QUEUE_RETRY_DELAY_SECONDS=7` e `QUEUE_RETRY_BACKOFF=false` tem esses três valores nas colunas de retry do job no pg-boss.
- **CA-12** (RN-13; erro do pg-boss não derruba o worker): Dado o worker em teste processando, quando as conexões do pg-boss são encerradas por `pg_terminate_backend` (filtradas pelo `application_name` do pg-boss ou do worker), então o worker registra `worker.erro_fila` sem URL nem senha, o processo continua de pé e um job enfileirado depois disso chega a `completed` no prazo. Verificação: integração.
- **CA-13** (RN-14; heartbeat e inicialização):
  - unitário com relógio falso: a sequência de eventos é `worker.adaptadores`, `worker.iniciado` e `worker.heartbeat`, que se repete a cada 30 s (padrão), com `em` em UTC;
  - com ambiente inválido: `worker.ambiente_invalido`, saída 1 e nenhum `start()` do pg-boss;
  - com falha no `start()` (base inexistente na URL, em integração): `worker.falha_inicio`, saída 1 e uma linha de log que não contém a senha da URL.
  - Os CAs do stub de D-003 e D-007 sobre `worker.adaptadores` (D-007 CA-1, CA-2, CA-9) continuam válidos e testados.
- **CA-14** (RN-15; prazo e segundo sinal):
  - unitário com o pg-boss substituído por um dublê de `stop` (não é mock de banco: testa só a orquestração do sinal): `stop` é chamado uma única vez com `{ graceful: true, timeout: 25000 }` (ou a unidade da versão fixada, equivalente a 25 s); um segundo sinal é ignorado; ao fim, a saída é 0;
  - integração ou processo filho: um job com `esperaMs` maior que o timeout (configurável no teste, ex.: timeout de 2 s e job de 5 s) termina com `worker.encerramento_forcado` e código 1;
  - o compose: `docker compose config` mostra `stop_grace_period: 30s` no `worker`, e um teste que lê `docker-compose.yml` confere que o valor do compose é maior que a constante de 25 s do worker.
- **CA-15** (RN-11; o cliente não conecta no build nem no import): Dado o build sem `DATABASE_URL` e sem as variáveis de fila, quando se roda `npm run build` e `npm run build:node`, então os dois terminam com 0. Um teste unitário confere que importar `src/server/queue/client.ts` não abre conexão nem lê o ambiente.
- **CA-16** (RN-12; fila indisponível): Dado o cliente apontado para uma base sem o schema `pgboss` (o worker nunca rodou) ou para um servidor fora do ar, quando enfileira, então lança o erro tipado da fila, cuja mensagem e `cause` serializada não contêm a senha da URL. Verificação: integração.
- **CA-17** (D-8; lint): Dado um arquivo fora de `src/server/queue/**`, `src/worker/**` e dos testes (ex.: `src/server/tenant/x.ts` ou `src/app/x.ts`), quando importa `pg-boss`, então `npm run lint` acusa erro. Dentro dessas pastas, o import é aceito. As restrições da D-005 (Prisma) e da D-007 (SDKs e adaptadores) continuam valendo para `src/worker/**`. Verificação: teste pela API do ESLint em `tests/integration/lint/`, no padrão de `importacao-integracoes.test.ts`.
- **CA-18** (gate): `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` e `npm run test:coverage` (≥ 90% de linhas) passam, e os seis jobs da CI ficam verdes. O código executado só no processo filho também é coberto por testes no mesmo processo (a cobertura v8 do Vitest não mede o filho).

### Relação com o PLAN
| Critério do PLAN | Contribuição desta demanda |
|---|---|
| 6 (WhatsApp repetível sem duplicar) | Fila, retry com backoff, `singletonKey` e falha isolada (CA-1..CA-3, CA-9). O critério fecha em E7.1/E7.2 |
| 5 (assinatura: carência, suspensão por tempo) | Agendamento `assinatura-prazos` (CA-8). Fecha em E6.3 |
| 11 (o projeto inicia pelo README, com testes) | Worker real no compose, encerramento gracioso e README (CA-4, CA-18) |

## 6. Casos limite
- **Fuso e virada de dia**: os crons rodam em `UTC` (RN-16). Os timestamps de log estão em UTC. A interpretação do fuso do salão é de cada handler (E6.3 com relógio injetável). A imagem já roda com `TZ=UTC` (D-003), e o teste não pode depender do fuso da máquina (rodar com `TZ=America/Sao_Paulo` dá o mesmo resultado).
- **Concorrência**:
  - um job é entregue a um único consumidor por vez (pg-boss com `SKIP LOCKED`). Mesmo assim, a entrega pode ser repetida depois de expiração ou de encerramento forçado, e os handlers reais devem ser idempotentes (E7.1 CA-9, E6.3 RN-8);
  - dois `enfileirar` simultâneos com a mesma `singletonKey` criam no máximo 1 job (incluir no CA-9 uma variante com `Promise.all`);
  - testes em paralelo: cada worker do Vitest tem sua base e seu schema `pgboss`, sem interferência entre arquivos.
- **Isolamento entre salões**: o payload só tem IDs. O worker não abre contexto de tenant. Os handlers de E6.3/E7.1 devem carregar os dados com `contextoDeSistema` e os repositórios. Nenhum job processa "todos os salões" sem escopo, salvo os jobs de plataforma (prazos e reconciliação), que iteram por salão nos próprios repositórios.
- **Salão suspenso**: a fila não consulta o estado do salão. A mensagem de cancelamento feita por salão suspenso precisa ser enviada (`PLAN.md:70`), então o worker nunca filtra jobs por suspensão. Essa regra é de E7.1 e E6.4.
- **Cliente anonimizada**: como o payload não tem nome nem telefone, a anonimização não deixa dados pessoais no schema `pgboss`. O tratamento (`cancelada_anonimizacao`) é de E5.2/E7.1.
- **Entradas inválidas**: payload com dado pessoal ou fora do formato é recusado no cliente (CA-10). Fila desconhecida é erro de tipo (TypeScript) e erro em tempo de execução. Variáveis de retry fora da faixa são recusadas (CA-11). `esperaMs` do exemplo fora de 0..60000 é recusado (D-4).
- **Permissões por perfil**: não se aplica diretamente, porque não há rota nem ação de usuário nesta demanda. Quem pode enfileirar é definido pelas ações de negócio de cada consumidor.
- **Banco indisponível**: no início, saída 1 (`worker.falha_inicio`); durante a execução, `worker.erro_fila` e recuperação (CA-12); no cliente, erro tipado (CA-16).
- **Worker nunca iniciado** (instalação nova, app antes do worker): o schema ou as filas não existem, e o cliente lança `ErroFilaIndisponivel` (D-6). No compose, o worker sobe logo depois da app ficar saudável (`depends_on: app: service_healthy`).
- **Job mais longo que a expiração do pg-boss**: fica com o padrão da versão fixada (em minutos). Nesta demanda, só o exemplo é longo (limitado a 60 s). O timeout HTTP de E7.2 fica abaixo de 25 s.
- **Upgrade do pg-boss**: muda o schema `pgboss` por migração própria (D-001/dba.md:65). Por isso a versão é exata, e qualquer atualização é uma demanda revisada pelo DBA.
- **Reinício em sequência**: reiniciar o worker não duplica filas nem agendamentos (CA-8).
- **SIGINT** (Ctrl-C em `npm run worker`): mesmo fluxo do SIGTERM.

## 7. Dependências
- **Demandas**: E0.2/D-003 (compose, entrypoint e stub), E0.4/D-004 (banco), E0.5/D-005 (harness com inicializadores, lint de Prisma), E0.3/D-006 (CI), E0.6/D-007 (`env.ts`, `check-env`, `worker.adaptadores`, lint). Todas concluídas em `main`.
- **Bloqueia**: E7.1 (#31), E6.3 (#40) e, indiretamente, a limpeza de E4.2.
- **Integrações**: nenhuma. Os handlers stub não chamam adaptadores (Mercado Pago, WhatsApp, e-mail ou Turnstile).
- **Biblioteca**: `pg-boss` (versão exata). A versão escolhida define a API (criação explícita de filas, unidade do timeout do `stop`, fórmula do backoff, semântica de `singletonKey` por política de fila). O arquiteto precisa confirmar essas quatro coisas na versão fixada.
- **Infraestrutura**: PostgreSQL 17 do compose e da CI. O papel do banco precisa de `CREATE` no database para o `start()` criar o schema `pgboss` (D-001/dba.md:65). No compose e na CI, o papel é superusuário.

## 8. Impactos prováveis
- **Dados (DBA: sim, revisão leve)**:
  - o schema `pgboss`, gerido pelo pg-boss, sem migração Prisma;
  - o efeito no drift;
  - o inicializador do template (sessões fechadas antes da cópia, D-005 A-9);
  - o pool do pg-boss e o orçamento de conexões (D-005/dba.md:105-106: `instâncias_app × 10 + worker (Prisma 10 + pool do pg-boss) + 3 ≤ max_connections − reservadas`);
  - o efeito dos testes com pg-boss nas 72 conexões por execução do harness (cada worker de teste com pg-boss soma o pool dele);
  - a retenção e o arquivamento padrão do pg-boss.
- **Infra/CI (DevOps: sim)**:
  - `stop_grace_period: 30s` no compose;
  - o processo filho do CA-4 na CI: o job `testes` não roda `build:node`, então o teste precisa produzir o próprio executável (por exemplo, esbuild para uma pasta temporária) ou o job precisa de um passo novo. A decisão é do DevOps e do arquiteto, sem mudar os nomes dos seis jobs;
  - o tempo extra da suíte (retries com 1 s e o job de 5 s);
  - `pg-boss` em `dependencies`, para sobreviver ao `npm prune --omit=dev`;
  - o procedimento manual do CA-4 com `docker compose stop worker`;
  - README.
- **Código existente**:
  - `src/worker/stub.ts` e `src/worker/stub.test.ts` são substituídos (os comportamentos testados migram, CA-13);
  - `src/worker/main.ts` e `main.test.ts` são reescritos;
  - mudam também `src/server/env.ts` (+ teste), `.env.example`, `docker-compose.yml`, `tests/support/db.ts` (`INICIALIZADORES`), `eslint.config.mjs` (D-8), `README.md` e `CLAUDE.md`.
- **Cobertura**: `src/worker/**` e `src/server/queue/**` entram no gate de 90%. O código que só roda no processo filho não conta: a lógica precisa estar em módulos exercitados em processo.

## 9. Dúvidas e suposições

### Bloqueantes
Nenhuma.

### Decisões tomadas (não bloqueantes), para o arquiteto confirmar
- **D-1 — padrões de retry** (sugestão da issue: "5 tentativas e atraso inicial de 30 s"): `QUEUE_RETRY_LIMIT=4` (novas tentativas, semântica do pg-boss; **5 execuções no total**), `QUEUE_RETRY_DELAY_SECONDS=30`, `QUEUE_RETRY_BACKOFF=true`. Motivo: honra o "5 tentativas" da sugestão sem converter a semântica do `retryLimit` (o `.env.example` explica a conta). Com o backoff exponencial de base 30 s, as esperas ficam na ordem de 30 s, 60 s, 120 s e 240 s (≈ 7,5 min no total), aceitável para confirmação de reserva. Alternativa: `QUEUE_RETRY_LIMIT=5` (6 execuções).
- **D-2 — pool do pg-boss**: `max` de 4 conexões no worker (sugestão da D-005/dba.md:106) e 2 no cliente da app. Os valores entram como constantes no código, não como env. O DBA confirma e atualiza a fórmula do README.
- **D-3 — definição por arquivo e crons padrão**: cada handler exporta `{ fila, validarPayload, processar, cron? }`, e `registry.ts` só importa e lista. Assim, E6.3 e E7.1 mudam lógica e cron sem editar o registro, e E4.2 só acrescenta uma linha. Crons: `assinatura-prazos` `*/5 * * * *`; `reconciliar-mensagens` `* * * * *`. Motivo: o prazo de carência é em dias, e 5 minutos é precisão suficiente; a reconciliação precisa de reação rápida (E7.1 RN-9).
- **D-4 — job de exemplo**: fila `exemplo`, registrada também em produção, com payload `{ esperaMs?: number }` (inteiro de 0 a 60000, padrão 0), sem dados pessoais. É a única exceção à regra "só IDs" da RN-11 (o payload não identifica ninguém). O handler espera `esperaMs`, respeitando o encerramento gracioso, e registra `worker.exemplo_concluido`. Existe para o CA-1, o CA-4 e a verificação manual no compose. O arquiteto define o comando de enfileirar documentado no README (ex.: um script em `src/scripts/` empacotado por `build:node`, executado com `docker compose exec worker node dist/scripts/<script>.js 20000`).
- **D-5 — comportamento dos stubs**: validam o payload (os de cron recebem `{}`; `whatsapp-reserva` recebe `{ mensagemId: uuid }`, formato provisório que E7.1 pode trocar no próprio arquivo), não acessam o banco de domínio, concluem com sucesso e registram `worker.job_concluido` com fila e id.
- **D-6 — quem instala o schema `pgboss`**: só o worker (no `start()`) cria e migra o schema e as filas. O cliente da app não migra, não supervisiona e não agenda. Antes do primeiro início do worker, enfileirar falha com `ErroFilaIndisponivel`, que E7.1 trata pela reconciliação. Motivo: espelha a regra "só a app aplica migrações Prisma" com um dono único por schema, e evita duas instâncias migrando o `pgboss` ao mesmo tempo. Alternativa: a app também instalar no primeiro uso.
- **D-7 — semântica da `singletonKey`**: "no máximo um job com a chave em criado, em nova tentativa ou ativo; depois de concluído ou falho, a chave pode ser usada de novo" (CA-9). Se a versão fixada do pg-boss só oferecer isso por uma política de fila específica, o arquiteto a escolhe e a registra no design. Se nenhuma política entregar exatamente isso, a dúvida volta ao analista. A deduplicação definitiva continua no banco de E7.1 (`UNIQUE(reserva_id, tipo, revisao)` + reivindicação atômica).
- **D-8 — lint do `pg-boss`**: o import fica restrito a `src/server/queue/**` e `src/worker/**` (CA-17). Motivo: impede enfileirar por fora do cliente, que valida o payload (RN-5) e não aceita transação (uso pós-commit). Isso respeita a estrutura de blocos disjuntos do `eslint.config.mjs` (comentário em `:9-13`).
- **D-9 — código de saída no encerramento forçado**: se o prazo de 25 s acabar com job ativo, a saída é 1 (`worker.encerramento_forcado`). Motivo: o CA-4 exige 0 só quando o job conclui; um código diferente de 0 sinaliza ao operador um encerramento anormal.
- **D-10 — intervalo de busca**: o intervalo de polling do pg-boss é uma opção injetável do worker (padrão da biblioteca em produção; o mínimo permitido nos testes), não uma variável de ambiente. Motivo: a issue só pede env para o retry, e o CA-2 precisa de folga para Δ2 > Δ1.
