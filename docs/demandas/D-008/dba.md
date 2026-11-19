# D-008 — Parecer de dados (T-4, DBA)

Autor: dba. Entradas: `docs/demandas/D-008/{issue-9,spec,design}.md` (design §4, itens 1 a 8), `docs/demandas/D-005/dba.md` §2.4 (orçamento de conexões) e §2.6 (contrato dos inicializadores), `tests/support/db.ts`, `tests/integration/db/drift.test.ts`, `prisma/migrations/`.

**Resumo:** nenhuma migração Prisma, nenhuma mudança em `prisma/`. Os oito itens foram aceitos. Três deles têm ajustes de documentação ou de teste (itens 2, 6 e 7), e há uma observação nova para os testes do T-7/T-8 (§2, "fila interna"). Nenhuma constante da §3.2 ou da §3.6 muda.

## 1. Como validei

Instalei `pg-boss@12.38.0` e `@opentelemetry/api@1.10.0` numa pasta de rascunho fora do repositório (Node 24.21.0) e rodei sondas contra o PostgreSQL 17.12 do compose (`max_connections = 100`, `superuser_reserved_connections = 3`, `reserved_connections = 0`). Usei só bases e papéis descartáveis (`sonda_d008_dba_*`, `sonda_d008_worker`, `sonda_d008_app`), todos apagados no fim (`SELECT count(*) FROM pg_database WHERE datname LIKE 'sonda%'` → 0). Nada foi instalado no repositório.

| Sonda | Resultado |
|---|---|
| Instalação com as opções do papel `instalador` (`max: 1`, `migrate: true`, `supervise/schedule/registerInstance: false`) numa base `TEMPLATE template0` | 46 ms. Durante o `start()`, uma sessão `harness:pgboss`. **Logo depois de `stop({ graceful: false, close: true })`, zero sessões** (a conferência A-9 não precisou esperar: 0 ms). `pgboss.version` = 46. |
| Objetos criados | Só no schema `pgboss`: tabelas `bam`, `instance`, `job` (particionada por `name`), `job_common`, `job_dependency`, `queue`, `queue_stats` (particionada por dia: `queue_stats_<hoje>` e `_<amanhã>`, em UTC), `schedule`, `subscription`, `version` e `warning`; funções `create_queue`, `delete_queue`, `job_now`, `job_table_format`, `job_table_run` e `job_table_run_async`, nenhuma `SECURITY DEFINER`. Nenhuma extensão nova (só `plpgsql`), nenhum trigger ou event trigger, nenhum objeto fora de `pgboss`. Template sem filas, jobs nem agendamentos. |
| Dependência do nome da base | Nenhuma: o nome do template não aparece em `prosrc` de função, em default de coluna nem em dado. O `current_database()` só é usado em tempo de execução (chave de advisory lock e filtros em `pg_locks`/`pg_stat_activity`), então é avaliado na cópia. |
| `CREATE DATABASE … TEMPLATE` (com `ALLOW_CONNECTIONS false`) | 35 ms. O worker (`migrate: true`) iniciou na cópia sem migrar nada: versão continuou 46. |
| Pico de conexões (amostra de `pg_stat_activity` a cada 50 ms, 80 `send` concorrentes na app e 4 consumidores no worker) | `agenda-beleza:worker` = **4**, `agenda-beleza:app` = **2**. O `max` é respeitado e o pool abre sob demanda. |
| Política `exclusive` | Mesma `singletonKey`: 2º `send` devolve `null`. Sem chave: 2º `send` devolve `null` (um job por fila). Índice: `CREATE UNIQUE INDEX job_common_i6 ON pgboss.job_common (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'`. |
| Drift | Base com as 4 migrações + `pgboss` instalado + fila e job: `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` → `No difference detected.`, código 0. `prisma migrate status` → `Database schema is up to date!`. |
| Privilégios | Ver §2, item 7. |

## 2. Vereditos

### Item 1 — Pools e fórmula de produção: **aceito**

- Worker 4, app 2 e instalador 1 ficam como estão (`POOL_FILA`). O pico medido bate com o `max`.
- O pool do pg-boss usa conexões do mesmo cluster que o Prisma, então entra na conta. Fórmula para o README (o T-9 copia):

  ```
  instâncias_app × (10 + 2) + worker × (10 + 4) + 3 ≤ max_connections − superuser_reserved_connections − reserved_connections
  ```

  - `10` é o pool do Prisma por processo (D-005). O Prisma do worker ainda não abre conexões, mas entra na conta, porque a E6.3/E7.1 vão usá-lo.
  - `2` e `4` são os pools do pg-boss na app e no worker. `3` cobre `migrate deploy`, psql e administração.
  - Com o compose (100 − 3 − 0 = 97): 1 app + 1 worker = 29. O limite permite até 6 instâncias da app com 1 worker (6 × 12 + 14 + 3 = 89).
  - Se no futuro alguém ligar `useListenNotify`, some 1 conexão dedicada por processo que o use. Hoje está descartado (design §1.1).
- Só existe **um** worker por banco nesta versão. Mais workers somam `14` cada e exigem rever a política `exclusive` dos crons (que já impede sobreposição entre eles).

### Item 2 — Orçamento dos testes: **aceito com ajuste A-1 (documentação)**

Conta por worker do Vitest (os arquivos de fila não saturam o pool do Prisma):

| Arquivo | Conexões de pico |
|---|---|
| Arquivos atuais (D-005) | ≈ 18 (Prisma 16 + admin 2), inalterado |
| Fila/worker em processo (`retry`, `agendamentos`, `resiliencia`, `ponta-a-ponta`…) | worker 4 + cliente 2 + `abrirBossDeTeste` 2 + Prisma/pg ≈ 2 + admin 1 ≈ **11** |
| `sigterm.test.ts` (processo filho) | filho 4 + `abrirBossDeTeste` 2 + cliente 2 + admin 1 ≈ **9** |
| `globalSetup` (instalador no template) | 1, transitória, antes de qualquer arquivo |

- O pico por worker continua **18**, e o pico por execução continua **4 × 18 = 72**. A regra "um arquivo não satura dois pools ao mesmo tempo" continua valendo: nenhum arquivo de fila usa mais que 2 conexões do Prisma.
- **O que muda é o compose.** O worker do compose agora segura até 4 conexões de forma contínua (busca a cada 2 s), em vez de nenhuma. A parcela "compose" passa de ≈ 2–3 para **≈ 7** (app ≈ 2 + worker 4 + folga). Uma execução: 72 + 7 + 5 (psql/IDE) ≈ **84 de 97**. Duas execuções simultâneas: ≈ 96 + 7 + 5 ≈ **108**, ou seja, **acima do limite** quando os picos coincidirem (antes já estava no limite).
- **Ajuste A-1 (T-9, README "Banco de teste"):**
  - atualizar a fórmula para `execuções × maxWorkers × (POOL_MAX_TESTES + 2) + compose (≈ 7 com o worker no ar) + 5 ≤ max_connections − superuser_reserved_connections`;
  - escrever explicitamente: "duas execuções simultâneas exigem `docker compose stop app worker`". A mensagem do `53300` em `tests/support/db.ts` já diz isso e não muda.
- `maxWorkers: 4` e `POOL_MAX_TESTES: 16` continuam. O `max_connections=200` no compose continua sendo a correção definitiva (DevOps). Não é pedido nesta demanda.
- **Obrigação dos testes (reforça o R-9):** todo arquivo fecha worker, cliente e `abrirBossDeTeste` no `afterAll`. Um pool do pg-boss esquecido segura até 4 conexões até o `DROP … WITH (FORCE)` do próximo arquivo. O tester confere com `SELECT application_name, count(*) FROM pg_stat_activity WHERE datname LIKE '%_w%' GROUP BY 1` no fim de um arquivo.

### Item 3 — Instalação no template e sessões abertas: **aceito**

- `start()` com o papel `instalador`, seguido de `stop({ graceful: false, close: true })` em `finally`, deixa **zero** sessões imediatamente. A conferência A-9 (até 2 s) e o `ALLOW_CONNECTIONS false` (A-2) ficam como estão. Atende o contrato do `dba.md` §2.6 da D-005: roda depois do `migrate deploy`, cria objetos só fora de `public` e espera o fechamento das próprias conexões.
- Nada em `pgboss` depende do nome da base (§1). A cópia funciona e o worker não migra nada na cópia.
- **Condições para o T-5:**
  - o inicializador **precisa** usar `opcoesPgBoss(url, 'instalador')`, as mesmas opções de schema do worker. O SQL de instalação depende da configuração (`installConfig`; por exemplo, `noTablePartitioning` muda a forma de `job` e `queue_stats`). Se divergirem, o template não seria equivalente à produção;
  - o `application_name` vem do `urlComAplicacao(…, 'harness:pgboss')` do harness, que vence a opção do pg-boss (R-3). É isso que a conferência A-9 mostra numa falha, e está correto;
  - `boss.on('error', …)` ligado antes do `start()` (R-11).
- As partições diárias de `queue_stats` (hoje e amanhã, em UTC) nascem no template. Isso não importa: só o worker com `supervise: true` grava em `queue_stats`, e ele cria as partições que faltarem a cada ciclo. A app e o instalador não gravam lá.

### Item 4 — Drift do Prisma com `pgboss` presente: **aceito**

- Verificado: `migrate diff --from-config-datasource` sai com 0 com `pgboss` instalado e com dados, porque o datasource só olha o schema `public`. `migrate status` também não reclama.
- As consultas do `drift.test.ts` filtram `table_schema = 'public'`, e o comentário da linha 209 já prevê `pgboss`. **Não é preciso mudar o `drift.test.ts`.** A conferência do CA-6 fica no `tests/integration/worker/schema.test.ts` (T-5), como no desenho.
- Ressalva operacional (não verificada empiricamente): os comandos de reset do Prisma miram o schema do datasource. Não conte com eles para limpar `pgboss`. O procedimento de limpeza local é `docker compose down -v`.

### Item 5 — Política `exclusive` e índice único: **aceito**

- O índice `job_common_i6` (ou `<tabela>_i6` numa fila particionada) é parcial em `state <= 'active'` (cobre `created`, `retry` e `active`) e `policy = 'exclusive'`. A garantia é do banco: inserções concorrentes com a mesma chave criam 1 job (confirmado no desenho e por mim). Isso atende a D-7.
- Chave **obrigatória** em `whatsapp-reserva` (sem chave, a deduplicação vira "um job por fila") e crons `exclusive` sem chave: aceitos.
- A deduplicação **definitiva** continua sendo do domínio, no `UNIQUE (reserva_id, tipo, revisao)` da tabela de mensagens da E7.1. O pg-boss deduplica só enquanto o job está vivo: depois de `completed`/`failed`, a mesma chave cria job novo (verificado). As tabelas do pg-boss não são fonte de histórico (RN-5).
- Consequência que a E7.1 e a E6.3 precisam conhecer: um job `active` cujo worker morreu segura a chave até expirar (`expire_seconds`, 15 min), e depois vai para `retry`. Para os crons, isso significa até cerca de 15 min sem varredura depois de uma queda bruta. É aceitável na v1.

### Item 6 — Retenção: **aceito com ajuste A-2 (só documentação)**

Os padrões medidos em `pgboss.queue` foram `expire_seconds = 900`, `retention_seconds = 1209600` (14 dias em `created`/`retry`) e `deletion_seconds = 604800` (7 dias depois de `completed`/`failed`/`cancelled`). `queue_stats` guarda 7 dias, e `warning` usa o máximo da biblioteca.

- Os padrões ficam como estão, sem constantes novas em `config.ts`:
  - 15 min de `active` é muito mais que o envio de uma mensagem ou uma varredura;
  - 14 dias em espera nunca é atingido com retry de até cerca de 15 min;
  - 7 dias de jobs encerrados basta para diagnóstico, porque o histórico de tentativas fica no domínio (RN-5).
- Volume: com 5 filas (as 4 + a interna `__pgboss__send-it`, ver abaixo), crons de 1 e 5 min e 7 dias de retenção, ficam ≈ 12 mil jobs de cron e ≈ 50 mil linhas de `queue_stats` por semana. É desprezível. A limpeza é feita pelo `supervise` do worker, então **um worker parado por dias não apaga nada**, mas também não cresce sem a app enfileirar.
- **Ajuste A-2 (T-9, README):** uma linha registrando os três prazos e que a limpeza depende do worker em execução. A E7.1 reavalia o `expireInSeconds` de `whatsapp-reserva` quando houver um envio real (timeout HTTP < 15 min).

### Item 7 — Privilégios: **aceito com ajuste A-3 (documentação de implantação)**

Testado com papéis sem superusuário (`NOSUPERUSER NOCREATEDB NOCREATEROLE`):

| Caso | Resultado |
|---|---|
| Worker sem `CREATE` no database | `42501 permission denied for database …`: o `start()` falha (vira `worker.falha_inicio`) |
| Worker com `GRANT CREATE ON DATABASE` | Instala, cria filas e agendamentos. Fica **dono** do schema `pgboss` e de tudo dentro dele |
| App sem grant em `pgboss` | `42501 permission denied for schema pgboss` no `start()` (`ErroFilaIndisponivel`, motivo `conexao`) |
| App com `USAGE` + `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss` | `start()` e `send` funcionam, com `exclusive` devolvendo `null` na chave repetida. `EXECUTE` não é necessário (as funções mantêm o `EXECUTE` padrão para `PUBLIC`, e o `send` não as chama) |
| App só com `USAGE` + `SELECT, INSERT` | O `send` funciona. Mesmo assim, recomendo o DML completo, porque `cancel`, `getJobById` e operações futuras da E7.1 precisam de `UPDATE`/`DELETE` |
| Fila nova **não particionada** criada depois do `GRANT` | Funciona (grava em `job_common`, já coberta) |
| Fila nova **particionada** (`partition: true`) criada depois do `GRANT` | `42501 permission denied for table j…`: a partição nova não herda o grant |

**Ajuste A-3 (T-9, README, "Implantação"/"Credenciais"):**
- Com um único papel para app e worker (o caso do compose e da v1), nada a fazer além de o papel ter `CREATE` no database.
- Com papéis separados:
  ```sql
  GRANT CREATE ON DATABASE <base> TO <papel_worker>;
  -- depois do 1º start do worker (o schema precisa existir):
  GRANT USAGE ON SCHEMA pgboss TO <papel_app>;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO <papel_app>;
  ALTER DEFAULT PRIVILEGES FOR ROLE <papel_worker> IN SCHEMA pgboss
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO <papel_app>;
  ```
  O `ALTER DEFAULT PRIVILEGES` cobre tabelas criadas depois (filas particionadas, mudanças de upgrade). Nenhuma fila desta demanda usa `partition: true`. Se alguma passar a usar, isso vira item de revisão do DBA.
- O papel da app **não** precisa de `CREATE` no database nem de ser dono de nada em `pgboss`. Coerente com a D-6: a app nunca migra.

### Item 8 — Upgrade do pg-boss passa pelo DBA: **aceito, com procedimento**

Pelo `contractor.js` da 12.38.0, o cliente com `migrate: false` exige **igualdade exata** de versão: se o schema estiver em outra versão, lança `pg-boss database requires migrations` (o `ErroFilaIndisponivel`, motivo `schema_ausente`). O worker com `migrate: true` migra sozinho no `start()`, sob advisory lock. A biblioteca exporta `getMigrationPlans` e `getRollbackPlans`, mas o downgrade não é automático.

Regra (o T-9 a copia para o README, seção de dependências):
1. Toda mudança da versão de `pg-boss` no `package.json` é uma demanda própria, com `dba.md`.
2. O DBA confere `pgboss.schema` do `package.json` novo contra o antigo. Se mudar:
   - lê o SQL de migração (`getMigrationPlans(schema, versãoAtual)`, exportado pelo pacote) para conferir locks em `job`/`job_common` e tempo em volume;
   - define a ordem de implantação. App e worker usam a mesma imagem. O worker migra no `start()`, e processos da app iniciados com a versão antiga **antes** da migração continuam rodando, mas os que iniciarem depois falham ao enfileirar até receber a imagem nova. A reconciliação da E7.1 cobre essa janela. O deploy precisa trocar app e worker juntos;
   - documenta a reversão: `getRollbackPlans(schema, versãoNova)` aplicado **antes** de voltar à imagem anterior.
3. Evidência obrigatória: `SELECT version FROM pgboss.version` antes e depois, e o CA-6 (`schema.test.ts`) verde, porque ele compara a versão instalada com `pgboss.schema` do `node_modules`.
4. O CA-5 (versão exata no `package.json` e no lock) impede um upgrade acidental.

## 3. Observação nova para o T-7/T-8: fila interna `__pgboss__send-it`

Com `schedule: true`, o `start()` do worker cria a fila interna **`__pgboss__send-it`** (política `standard`, retry padrão 2/0/false), usada pelo timekeeper para materializar os crons. Medido: depois do worker, `pgboss.queue` tinha **5** linhas, e não 4.

- **CA-7 (`ponta-a-ponta`):** a asserção "4 filas no pg-boss" precisa excluir as filas internas (`name NOT LIKE '\_\_pgboss\_\_%'`, ou filtrar o resultado de `getQueues()`), ou então esperar exatamente `[...FILA, '__pgboss__send-it']`. Recomendo a 1ª forma, mais estável entre versões.
- **CA-6 (`schema.test.ts`):** "nenhuma fila" no template continua valendo, porque o instalador usa `schedule: false` (verificado: 0 filas). Depois de um `start()` do worker na cópia, a fila interna aparece. Se o teste contar filas depois disso, a mesma exclusão vale.
- **Sincronização de filas do worker (§3.6, passos 5 e 7):** só itera o `REGISTRO` e o `getSchedules()`, então não toca na fila interna. Correto. **Não** a trate como órfã nem confira a política dela.

## 4. Migrações e reversão

- Nenhuma migração Prisma, nenhuma mudança em `prisma/schema.prisma`, `prisma/migrations/` ou no seed.
- O schema `pgboss` pertence à biblioteca. A reversão da demanda inteira numa base é `DROP SCHEMA pgboss CASCADE`, que não toca em `public` (nenhuma FK cruza schemas) e só deve rodar com o worker parado. Em produção, isso é comando destrutivo e exige autorização explícita do usuário. Localmente, `docker compose down -v` basta.

## 5. Ajustes para o desenvolvedor (resumo)

| ID | Para | O quê |
|---|---|---|
| A-1 | T-9 (README "Banco de teste") | Fórmula de conexões dos testes com o compose ≈ 7, e "duas execuções simultâneas → `docker compose stop app worker`" |
| A-2 | T-9 (README) | Prazos de retenção (15 min / 14 d / 7 d) e que a limpeza depende do worker no ar |
| A-3 | T-9 (README, implantação) | `CREATE` no database para o worker. Com papéis separados, os `GRANT` + `ALTER DEFAULT PRIVILEGES` do item 7 |
| A-4 | T-7/T-8 (`ponta-a-ponta`, e `schema.test.ts` se contar filas depois do worker) | Excluir `__pgboss__%` das contagens de filas (§3) |
| — | T-9 (README) | Fórmula de produção do item 1 e procedimento de upgrade do item 8 |
| — | T-5 | Condições do item 3 (mesmas opções de schema do worker, `close: true` em `finally`, ouvinte de `error`). Já estão no desenho |

Constantes (`POOL_FILA`, `TIMEOUT_ENCERRAMENTO_MS`, retenção) **sem mudança**.
