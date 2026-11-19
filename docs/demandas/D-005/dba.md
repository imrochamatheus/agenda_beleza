# D-005 — Parecer do DBA (T-1): bases de teste por execução/worker, pool e predicados de escopo

Autor: dba. Entradas: `docs/demandas/D-005/design.md` (§0, §3.2, §3.4, §3.6, §4, §5, §7, T-1), `spec.md` (RN-12..RN-16, CA-6, CA-15..CA-17, D-1, S-8), `docs/demandas/D-004/dba.md`, `prisma/schema.prisma`, `prisma/migrations/**`, `tests/integration/support/**`, `tests/integration/db/drift.test.ts`, `docker/postgres/initdb/10-base-de-teste.sh`, `docker-compose.yml`, `.env.example`, `src/server/db.ts` (base `1906605`).

**Veredito: aceito com ajustes (A-1..A-10), nenhum bloqueante.** Nenhum ajuste muda interfaces do §3.4 nem exige nova rodada do arquiteto. Todos cabem no T-3 (harness) e no T-4 (repositórios). Nenhuma migração, nenhum arquivo em `prisma/` alterado.

Todas as provas foram feitas em um `postgres:17` descartável (17.12, `docker run --rm`, portas 55805/55806, removido no fim). Os testes de privilégio usaram um papel `teste LOGIN CREATEDB` **sem** superusuário, para não depender do superusuário da imagem. A base de dev e o compose do projeto não foram tocados. A seção 9 traz os comandos e as saídas.

## 1. Avaliação de impacto e compatibilidade

- **Dados existentes:** nenhum. A base de `TEST_DATABASE_URL` vira só administrativa: o harness não lê, não grava e não apaga nada nela. As tabelas da D-004 que já estão lá são inofensivas (ver §8). A base de dev não é tocada.
- **Locks:** `CREATE DATABASE … TEMPLATE tpl` pega `ShareLock` no template e exige que ele não tenha nenhuma outra sessão. Quatro cópias simultâneas convivem (medido). `DROP DATABASE … WITH (FORCE)` só afeta as sessões da própria base (medido).
- **Tempo:** medido com o template real (3 migrações + schema de prova, 9,3 MB):

| Operação | Tempo |
|---|---|
| Reset isolado (`DROP … FORCE` + `CREATE … TEMPLATE`, padrão `WAL_LOG`) | 112 ms |
| 4 resets simultâneos com `WAL_LOG` | 119, 196 e 175 ms |
| 4 resets simultâneos com `FILE_COPY` | 1011, 1024 e 1090 ms |
| `migrate deploy` no template | 1,26 s |

- **Migração / reversão:** não se aplica, porque não há DDL de produto. Para reverter o harness, basta voltar o código do T-3. As bases `*_r*` que sobrarem são apagadas pela varredura ou à mão, com o `DROP DATABASE … WITH (FORCE)` da §9.

## 2. Decisões por item do §4 do desenho

### 2.1 Parâmetros do `CREATE DATABASE` (item 1)

| Parâmetro | Template da execução | Base do worker |
|---|---|---|
| Template de origem | **`template0`** | o template da execução |
| `ENCODING` | **`'UTF8'`** explícito | omitido (herda) |
| `LOCALE` / `LC_COLLATE` / `LC_CTYPE` / `LOCALE_PROVIDER` | **omitidos**: herdam o locale do cluster (na imagem, `en_US.utf8`, provider `libc`, o mesmo da base de dev) | omitidos |
| `STRATEGY` | **omitido** (padrão `WAL_LOG` no PG ≥ 15) | omitido |
| `IS_TEMPLATE` | **não** marcar (fica `false`) | — |
| `OWNER` | omitido: o dono é o papel de `TEST_DATABASE_URL` | omitido |
| `ALLOW_CONNECTIONS` | **`ALTER DATABASE … ALLOW_CONNECTIONS false`** depois dos inicializadores e da conferência de sessões (A-2) | padrão (`true`). Medido: a opção não é herdada pela cópia. |

Justificativas:
- **`template0`, e não `template1`.**
  - (a) Uma sessão qualquer em `template1` (psql, IDE, outra ferramenta) faz o `CREATE DATABASE` padrão esperar 5 s e falhar com `55006` (medido: 5,04 s). O `template0` tem `datallowconn = false`, então ninguém consegue se conectar a ele (medido: `FATAL … not currently accepting connections`).
  - (b) O `template1` pode ter sido modificado. Com `btree_gist` e uma tabela criadas nele, a cópia herdou as duas (medido). Isso esconderia, por exemplo, a falta do `CREATE EXTENSION` numa migração futura. O `template0` reproduz uma base de produção recém-criada.
- **`ENCODING 'UTF8'` explícito sem fixar o locale.** Fixar um locale (`pt_BR.utf8`, por exemplo) quebra em clusters que não o têm, como em alguns runners de CI. Herdar o locale do cluster mantém a ordenação dos testes igual à da base de dev. Se o cluster não for UTF-8, o `CREATE` falha cedo e com uma mensagem clara (medido com `LATIN1`: `encoding "LATIN1" does not match locale "en_US.utf8"`), e isso é desejável. Depois de criar o template, o harness confere `pg_encoding_to_char(encoding) = 'UTF8'` (A-1).
- **`STRATEGY` padrão.** Com 4 workers, o `WAL_LOG` é cerca de 6 vezes mais rápido que o `FILE_COPY`, que força checkpoints (tabela da §1). Omitir o parâmetro também evita erro de sintaxe num servidor anterior ao 15. O custo do `WAL_LOG` é escrever cerca de 9 MB de WAL por reset, o que é irrelevante localmente.
- **Sem `IS_TEMPLATE`.**
  - O dono copia a própria base sem essa marca (medido). Outro papel com `CREATEDB` recebe `permission denied to copy database` (medido), e isso também protege o template.
  - Com `IS_TEMPLATE true`, `DROP DATABASE … WITH (FORCE)` falha com `cannot drop a template database` (medido). O teardown e a varredura precisariam de um `ALTER … IS_TEMPLATE false` antes, ou seja, um passo a mais sem nenhum ganho.
- **`ALLOW_CONNECTIONS false` no template.** Um teste ou helper que, por bug, se conecte ao template passa a falhar na hora (`FATAL … not currently accepting connections`), em vez de segurar a base e derrubar **todas** as cópias seguintes com `55006` depois de 5 s. O dono pode executar o `ALTER`, e o `DROP` continua funcionando (os dois foram medidos). Atenção: a opção **não** derruba sessões já abertas (medido: a cópia falhou com 1 sessão aberta antes do `ALTER`). A conferência do passo 6 do `globalSetup` continua necessária, e o `ALTER` vem **depois** dela.

### 2.2 `DROP DATABASE … WITH (FORCE)` no reset e no teardown (item 2)

**Decisão: aceito**, com `IF EXISTS` sempre (A-3).
- **Permissão:** basta ser dono da base. O papel `CREATEDB`, sem superusuário, criou e apagou com `FORCE` as próprias bases (medido). Uma base de outro dono dá `must be owner of database` (medido com a base de dev do probe). Isso é uma defesa adicional à guarda de nomes, mas **só vale fora do compose**: no compose, o usuário é superusuário (§0 do desenho), e a guarda é a única proteção.
- **Efeito sobre os outros workers:** nenhum. Com sessões abertas em `_w1` e em `_w2` (esta dentro de `BEGIN`), o `DROP _w1 WITH (FORCE)` levou 0,43 s. A sessão de `_w1` recebeu `FATAL: terminating connection due to administrator command`, e a de `_w2` terminou a transação e fez `COMMIT` normalmente (medido).
- **Limites do `FORCE`:**
  - Ele **falha** se houver na base uma sessão de superusuário e quem executa não for superusuário (medido: `permission denied to terminate process`).
  - Pela documentação do PG 17, ele também falha se houver transação preparada, slot de replicação lógica ou subscrição na base.
  - Consequência: localmente o papel é superusuário, então não há efeito. Num ambiente com papel restrito, um `psql` de superusuário aberto numa base de worker durante a execução faz o reset desse worker falhar. Isso deve ir para o README (T-6).
- **Não pode rodar dentro de transação** (medido: `DROP DATABASE cannot run inside a transaction block`). As duas instruções vão em chamadas `query` separadas, com autocommit, pela conexão administrativa.
- **Conexão vazada de um arquivo anterior:** o `FORCE` a encerra. Se o processo dono dessa conexão ainda estiver vivo, o `pg.Pool`/`pg.Client` dele recebe o erro `57P01`. O `afterAll(encerrarPrisma)` do `setup-arquivo` evita o caso. Não é preciso mais nada.

### 2.3 Nomes, limite de 63 bytes e varredura de órfãs (item 3)

**Decisão: aceito com ajustes A-4 a A-6.**
- **Limite.** O PostgreSQL **trunca em silêncio** um identificador acima de 63 bytes: só emite um `NOTICE` e cria a base com o nome truncado (medido com 70 caracteres → 63). Por isso a validação antes de qualquer `CREATE`/`DROP` é obrigatória. `NOME_VALIDO = /^[a-z0-9_]{1,63}$/` é só ASCII, então caracteres e bytes coincidem.
- **Comprimento máximo da base de teste: 46.** O sufixo mais largo que o padrão de órfã aceita é `_r` + 10 + `_w999` = 17 caracteres, e o do template é `_r` + 10 + `_tpl` = 16. A validação deve usar o **sufixo mais largo aceito pelo padrão** (`_w999`), e não `maxWorkers` (A-4): assim um `VITEST_POOL_ID` acima do previsto (R-3) nunca gera um nome truncado. A base atual, `agenda_beleza_test`, tem 18 caracteres, e os nomes ficam com 34 a 35. O initdb aceita até 63. A diferença é inofensiva: o harness recusa uma base com mais de 46 caracteres e nomeia `TEST_DATABASE_URL`.
- **`exec`.**
  - `Date.now().toString(36)` tem 8 caracteres de 1973 até 2059. O desenho pede 8 fixos. **Use `padStart(8, '0')` e confira o comprimento 10** (A-5). Se o formato mudar, a varredura falha "para o lado seguro": nada casa e nada é apagado.
  - A idade é `agora − parseInt(exec.slice(0, 8), 36)`, e os 2 caracteres aleatórios ficam fora da conta. A colisão entre duas execuções no mesmo milissegundo tem probabilidade de 1/1296, o que é aceitável.
- **Varredura (simulação real contra o catálogo, §9.7).** O filtro do §3.6, com os ajustes:
  - **Manteve:**
    - a base de dev (`agenda_beleza`), a administrativa (`agenda_beleza_test`), `postgres` e os templates de sistema;
    - `agenda_beleza_test2_r…_w1` (outra base de teste com prefixo parecido) e `x…` (prefixo antes);
    - `…_w1_copia` (sufixo depois) e um `exec` com 9 caracteres;
    - as bases da própria execução (idade 0 h), uma execução com 5 h e um `exec` "do futuro" (relógio voltou: idade negativa);
    - uma base que casa com o padrão e tem 7 h, mas pertence a **outro dono**.
  - **Apagou** só `_tpl`, `_w1` e `_w12` com 7 h e o próprio papel como dono.
- **Ajuste A-6 (varredura):**
  - Liste com `SELECT datname FROM pg_database WHERE NOT datistemplate AND datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user)`. Sem o filtro de dono, uma base alheia que casa com o padrão faria o `DROP` lançar `must be owner` e abortaria o `globalSetup`.
  - Aplique o regex ancorado no Node. A base vem de `[a-z0-9_]`, que não tem metacaracteres, mas monte o regex com a base já validada.
  - Revalide cada nome pela guarda: não é a base de dev, não é de sistema e não é a administrativa.
  - Apague com `DROP DATABASE IF EXISTS … WITH (FORCE)`. O `IF EXISTS` cobre duas execuções que comecem juntas e varram a mesma órfã.
  - Uma falha ao apagar **uma** órfã gera aviso (`console.warn`, só com o nome) e não aborta a suíte, porque a órfã não atrapalha a execução atual.
- **Garantia de não alcançar uma execução em curso:** com 6 h de idade mínima, só é apagada uma execução que dure mais de 6 h. Uma sessão de depuração parada por mais tempo que isso (R-5) pode perder a base, o que é aceitável e deve ir para o README. O relógio do `exec` e o da varredura são o mesmo, o do cliente, porque o servidor é local. Num servidor compartilhado entre máquinas (fora do escopo), uma diferença de relógio maior que 6 h seria um problema.

### 2.4 Orçamento de conexões e pool de produção (item 4)

Servidor do compose (medido): `max_connections = 100`, `superuser_reserved_connections = 3`, `reserved_connections = 0`. O papel local é superusuário e pode usar as 100. Um papel comum usa 97.

| Consumidor (por worker) | Conexões |
|---|---|
| Pool do Prisma (`POOL_MAX_TESTES`), aberto sob demanda | ≤ 16 (o CA-16 usa 12) |
| `criarPoolPg` dos testes de concorrência | 12 (CA-6) |
| `conectar()` e observador de `pg_stat_activity` | 1–2 |
| Conexão administrativa do reset | 1, **transitória** (fechada antes dos testes do arquivo) |

- **Pior caso teórico se um arquivo saturar os dois pools ao mesmo tempo:** 4 × (16 + 16 + 2) = 136, acima de 100. Por isso valem a **regra** e o **ajuste A-7**:
  - O padrão de `criarPoolPg` é **12**, e não `POOL_MAX_TESTES`.
  - Um arquivo não satura dois pools ao mesmo tempo. As fábricas do CA-6 rodam antes do disparo e usam 1–2 conexões do Prisma.
- **Pico por worker com a regra:** cerca de 16 + 2 = 18. Por execução: 4 × 18 = **72**. Somando app e worker do compose (≈ 2 a 3, o health a cada 5 s mantém uma conexão) e psql/IDE (≈ 5), dá **≈ 80 de 100**. **`maxWorkers: 4` e `POOL_MAX_TESTES: 16` confirmados.**
- **Duas execuções simultâneas (critério do T-3).** O pico realista é de 3 arquivos pesados ao mesmo tempo por execução (`pool`, `reserva-paralela-a` e `-b`, com cerca de 15 cada) mais um leve: ≈ 48 por execução, ≈ 96 nas duas mais o compose. Funciona, mas **sem folga** quando os picos coincidem.
  - Se aparecer `53300 too many clients already`, a primeira providência é `docker compose stop app worker` durante o teste.
  - A correção definitiva seria `max_connections=200` no compose (`command: ["postgres", "-c", "max_connections=200"]`). Isso é infraestrutura (DevOps) e **não** é pedido agora.
  - O T-6 registra no README a fórmula `execuções × maxWorkers × (POOL_MAX_TESTES + 2) + compose + 5 ≤ max_connections`.
- **Pool de produção: 10 por processo, explícito, confirmado.**
  - Para a E0.7 e a implantação, registro a fórmula: `instâncias_app × 10 + worker (Prisma 10 + pool do pg-boss) + 3 (migrate/admin) ≤ max_connections − superuser_reserved_connections`.
  - O pg-boss tem pool próprio (padrão `max: 10`). A E0.7 deve reduzi-lo, por exemplo para 4, e somá-lo nessa conta.
  - O `connectionTimeoutMillis = 3000` atual fica como está.

### 2.5 Predicados × índices e `READ COMMITTED` (item 5)

Fiz duas verificações:
- Registrei o SQL **realmente gerado pelo Prisma 7** para as formas do §3.2 e do §3.4, usando o cliente gerado do repositório e o log de query, com um script de sonda fora do repo.
- Rodei `EXPLAIN (ANALYZE)` com **plano genérico** (`plan_cache_mode = force_generic_plan`, que é o pior caso das instruções preparadas do driver) numa base de worker com volume: 200 salões, 1.000 profissionais, 100 mil clientes, 200 mil reservas e itens, e 5 mil sessões.

| Consulta (forma gerada pelo Prisma) | Plano | Ok? |
|---|---|---|
| Sessão: `token_hash = $1 AND expira_em > $2 AND revogada_em IS NULL` | `Index Scan sessao_token_hash_key` + `usuario_pkey` | sim |
| Profissional da sessão via `include: { usuario: { include: { profissional } } }` → `salao_id IN ($1) AND usuario_id IN ($2)` | `Index Scan profissional_salao_id_usuario_id_key` | sim |
| O mesmo **só** por `usuario_id = $1` | `Seq Scan` (999 linhas descartadas) | **não**: ver A-8 |
| `buscarPorId`: `id = $1 AND salao_id = $2` | `Index Scan reserva_salao_id_id_key` | sim |
| `atualizarStatus`: `UPDATE … WHERE id AND salao_id AND status = $de` | `Index Scan reserva_salao_id_id_key` + `Filter status` | sim |
| `listarPorPeriodo`: `salao_id = $1 AND inicio >= $2 AND inicio < $3 ORDER BY inicio` | `Bitmap Index Scan reserva_salao_id_inicio_idx` (120 linhas) | sim |
| Itens via `include: { itens }` → `salao_id IN (…) AND reserva_id IN (…)` | `Index Scan reserva_item_salao_id_reserva_id_ordem_key` | sim |
| Itens **só** por `reserva_id IN (…)` | `Seq Scan` (199.999 linhas descartadas) | **não**: ver A-8 |
| `listar` de clientes: `salao_id = $1 ORDER BY nome` | `Bitmap Index Scan cliente_salao_id_id_key` + sort de 500 linhas (67 kB) | sim (ver nota) |
| Slug: `slug = $1` | `salao_slug_pkey` | sim |
| Slug atual: `salao_id = $1 AND atual = $2` (genérico) | `salao_slug_salao_id_idx` + `Filter`. Com parâmetro, o plano genérico não usa o parcial `salao_slug_atual_uniq` | sim (2 linhas por salão) |
| Serviços públicos: `salao_id = $1 AND ativo = true ORDER BY nome` | `servico_salao_id_id_key` + `Filter ativo` | sim |

- **Conclusão:** os índices existentes cobrem todas as consultas do desenho, e **nenhum índice novo é necessário**. Só há risco se a relação for consultada por uma única coluna da FK composta (A-8).
- **Nota (não bloqueante, E5):** a listagem de clientes ordena em memória (sem índice `(salao_id, nome)`). Isso é aceitável para centenas ou alguns milhares de clientes por salão. A paginação e um índice ficam para a demanda da tela de clientes, se o volume pedir, e passam pelo DBA.
- **`READ COMMITTED` em `emTransacao`: confirmado.**
  - Já é o padrão do servidor (`SHOW transaction_isolation` → `read committed`, medido). Passar `isolationLevel: 'ReadCommitted'` explicitamente no `$transaction` documenta a intenção, e o Prisma o aceita (medido).
  - Não há motivo para `REPEATABLE READ`/`SERIALIZABLE`: a sobreposição é garantida pela exclusion, e as mutações são *compare-and-set* num único `UPDATE`.
  - **CAS sob RC (medido):** T1 e T2 fazem `UPDATE … WHERE id AND salao_id AND status = 'confirmado'` na mesma reserva. T2 espera o lock de T1 (1,5 s), reavalia o predicado depois do `COMMIT` de T1 e devolve `UPDATE 0`. Portanto `count === 0 → NaoEncontrado` também cobre a corrida: não há atualização perdida.
  - **Releitura fora de transação:** com `repos()`, o `updateMany` e a releitura são duas instruções. A releitura pode refletir uma escrita concorrente posterior. É aceitável para a E0.5, porque o DTO devolvido é o estado atual e o escopo de salão continua no predicado. Uma composição que precise do estado exato pós-escrita deve rodar em `emTransacao` (E3.5).
  - **Interactive transaction:** os padrões do Prisma são `maxWait` de 2 s e `timeout` de 5 s. Quando o pool estiver disputado (E3.x), a ação que usar `emTransacao` sob concorrência deve definir os dois explicitamente. Isso não afeta a E0.5, porque o CA-6 usa `pg` direto.

### 2.6 Inicializadores de schema e efeito no drift (item 6)

**Contrato aceito, com A-2, A-9 e A-10:**
1. Os inicializadores rodam **depois** do `migrate deploy`, em sequência e na ordem de `INICIALIZADORES`, recebendo a `urlTemplate`. Um inicializador que lança aborta o `globalSetup`, e a mensagem traz o `nome` dele.
2. Cada inicializador **aguarda o fechamento** de todas as conexões que abriu (`await client.end()`/`pool.end()`. Na E0.7: `await boss.stop({ graceful: true, wait: true })`, a ser confirmado pela versão fixada).
3. Cada inicializador conecta com **`application_name=harness:<nome>`** na URL (A-9). Para um papel comum, `pg_stat_activity` mostra `usename` e `application_name` das próprias sessões, mas **esconde `backend_type` e `query`** das sessões de outros papéis e dos processos de fundo (medido: `<insufficient privilege>`, `backend_type` nulo). Por isso a conferência não pode se apoiar em `backend_type`.
4. **Só cria objetos fora de `public`**, em schema próprio (`harness_extensao` hoje, `pgboss` na E0.7). Um objeto em `public` faz o `migrate diff` sair com 2 (medido com uma tabela extra em `public`). Um inicializador não deixa transação preparada, slot nem subscrição, porque isso impediria o `DROP … FORCE`.
5. **Conferência (passo 6 do `globalSetup`):** `SELECT pid, usename, application_name FROM pg_stat_activity WHERE datname = $tpl AND pid <> pg_backend_pid()`, repetida por até 2 s antes de falhar. O próprio `CREATE DATABASE` encerra um autovacuum, mas ele aparece na consulta e um papel comum não o distingue. Se a falha persistir, a mensagem lista os `application_name` encontrados. Depois vem o `ALTER DATABASE tpl ALLOW_CONNECTIONS false` (A-2).
6. O schema de prova **não precisa** de idempotência (o template é novo a cada execução). Ele deve ser **mínimo**: `CREATE SCHEMA harness_extensao; CREATE TABLE harness_extensao.marcador (id int PRIMARY KEY); INSERT … (1)`, **sem trigger nem função**.

**Efeito sobre o drift (R-9):**
- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` saiu com **0** com o schema de prova (tabela e também trigger e função em `harness_extensao`), porque o Prisma inspeciona só `public` (medido).
- **Achado:** a consulta de triggers de `tests/integration/db/drift.test.ts:190-192` (`FROM pg_trigger WHERE NOT tgisinternal`) **não filtra por schema**. Com um trigger em `harness_extensao`, ela devolveu um 5º trigger, `marcador_t | harness_extensao.marcador` (medido), e o teste do CA-1 da D-004 quebraria. Pode acontecer o mesmo com o `pgboss` da E0.7, se a versão escolhida criar triggers.
- **A-10 (T-3, que é dono desse arquivo):** filtrar por `public` com `… FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace` (medido: devolve exatamente os 4 do contrato).
- As demais consultas de catálogo do `drift.test.ts` já filtram por `connamespace`/`typnamespace`/`table_schema = 'public'` ou por nome exato, então não mudam. A contagem do CA-15 ("3 migrações") vem de `_prisma_migrations` e não é afetada.

### 2.7 `CREATEDB` na E0.3 e o novo papel da base de `TEST_DATABASE_URL` (item 7)

**Privilégio mínimo do papel de teste: `LOGIN CREATEDB`. Não precisa de superusuário (provado).** Com `teste LOGIN CREATEDB`, o papel:
- cria o template a partir de `template0`;
- aplica as 3 migrações (inclusive o `CREATE EXTENSION btree_gist`, que é extensão *trusted* desde o PG 13);
- cria o schema de prova;
- copia o próprio template;
- apaga com `FORCE`.

**Requisitos que a E0.3 (CI) herda (para o README/T-6 e para o DevOps quando a E0.3 abrir):**
1. O papel de `TEST_DATABASE_URL` tem `CREATEDB`. Com o service `postgres:17` e `POSTGRES_USER`, isso já vale (é superusuário).
2. A base de `TEST_DATABASE_URL` **precisa existir** (é a conexão administrativa). Na CI, o mais simples é `POSTGRES_DB=<base de teste>` no service. O initdb do projeto só roda no compose.
3. Na CI, `DATABASE_URL` pode estar vazia ou apontar para outra base. A guarda só exige nomes diferentes.
4. `max_connections ≥ 100` (o padrão) para 4 workers.
5. O nome da base de teste tem no máximo **46** caracteres em `[a-z0-9_]` (A-4).

**Base de `TEST_DATABASE_URL`, agora só administrativa:**
- O harness só se conecta a ela para emitir `CREATE`/`DROP DATABASE` e consultar `pg_database`/`pg_stat_activity`. **Nunca** a apaga, recria, migra ou trunca (ela já não é derivada nem casa com o padrão de órfã: medido).
- As tabelas da D-004 que já estão nela são inofensivas: nada as lê, e nenhum `CREATE DATABASE` a usa como origem.
- Quem quiser recuperar os ~9 MB pode fazer `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` **à mão, nessa base**. Não é necessário, e o harness não deve fazer isso.

## 3. Ajustes requeridos (para o T-3 e o T-4)

| # | Tarefa | Ajuste | Tipo |
|---|---|---|---|
| A-1 | T-3 | Template: `CREATE DATABASE "<tpl>" TEMPLATE template0 ENCODING 'UTF8'` (sem `LOCALE`, `STRATEGY`, `IS_TEMPLATE` nem `OWNER`) e conferência de `pg_encoding_to_char(encoding) = 'UTF8'`. Worker: `CREATE DATABASE "<w>" TEMPLATE "<tpl>"`, sem outras opções. Identificadores por `escapeIdentifier` do `pg`, **depois** da validação de nome. | obrigatório |
| A-2 | T-3 | Depois dos inicializadores e da conferência de sessões: `ALTER DATABASE "<tpl>" ALLOW_CONNECTIONS false`. | obrigatório |
| A-3 | T-3 | Todo `DROP DATABASE` do harness é `DROP DATABASE IF EXISTS "<nome>" WITH (FORCE)`, fora de transação. O teardown **lista as bases da execução no catálogo** (regex `^<base>_r<exec>_(tpl\|w[0-9]{1,3})$`, dono = `current_user`) em vez de iterar de 1 a `maxWorkers`, apaga os workers antes do template e cobre um `VITEST_POOL_ID` inesperado. Se o `globalSetup` falhar depois de criar o template, faz um `try/catch` que apaga o template antes de relançar. | obrigatório |
| A-4 | T-3 | `validarPlanoDeBases` valida o pior sufixo aceito pelo padrão (`_w999`): base ≤ 46 caracteres. `recriarBaseDoWorker` revalida o próprio nome (`NOME_VALIDO`, ≠ dev, ≠ sistema) **comparando com o nome da base de dev capturado no `globalSetup`** (via `provide`), e não com `process.env.DATABASE_URL`, que o `setup-arquivo` sobrescreve com a URL do worker. Nos testes do CA-17, `validarPlanoDeBases` recebe um objeto de env explícito. | obrigatório |
| A-5 | T-3 | `exec = Date.now().toString(36).padStart(8, '0') + 2 caracteres aleatórios [0-9a-z]`, com asserção de comprimento 10. A idade sai de `parseInt(exec.slice(0, 8), 36)`. | obrigatório |
| A-6 | T-3 | A varredura filtra `NOT datistemplate AND datdba = <oid de current_user>`, aplica o regex ancorado, revalida pela guarda e exige idade ≥ 6 h (idade negativa → mantém). Usa `DROP … IF EXISTS … WITH (FORCE)`. Uma falha individual vira aviso, sem abortar a suíte. Teste puro com os casos da §9.7. | obrigatório |
| A-7 | T-3 | `criarPoolPg(max = 12)` (e não `POOL_MAX_TESTES`). Regra no comentário do helper: um arquivo não satura o pool do Prisma e o do `pg` ao mesmo tempo. `maxWorkers: 4` e `POOL_MAX_TESTES = 16` mantidos. | obrigatório |
| A-8 | T-4 | Toda consulta por relação de FK composta usa **as duas colunas**. O `profissionalId` da sessão vem do `include` da relação `usuario.profissional` (que gera `salao_id IN … AND usuario_id IN …`) ou de um `where: { salaoId, usuarioId }`. **Nunca** de `where: { usuarioId }` sozinho (seq scan medido). Os itens da reserva vêm de `include: { itens }` ou de `where: { salaoId, reservaId }`, **nunca** só de `reservaId` (seq scan em 200 mil linhas, medido). `emTransacao` passa `isolationLevel: 'ReadCommitted'` explícito. | obrigatório |
| A-9 | T-3 | Inicializadores conectam com `application_name=harness:<nome>`. A conferência usa `datname = $tpl AND pid <> pg_backend_pid()`, repetida por até 2 s, e a falha lista os `application_name`. Não filtra por `backend_type`. | obrigatório |
| A-10 | T-3 | `tests/integration/db/drift.test.ts:190-192`: filtrar os triggers por `relnamespace = 'public'::regnamespace`. O schema de prova não tem trigger nem função. | obrigatório |

Recomendações não bloqueantes, que ficam para o T-6 e demandas futuras:
- **README (T-6):**
  - fórmula de conexões e o caso de duas execuções simultâneas (`docker compose stop app worker` se aparecer `53300`);
  - limite de 46 caracteres;
  - `CREATEDB`;
  - uma sessão de superusuário numa base de worker impede o reset quando o papel é restrito;
  - uma depuração parada por mais de 6 h pode perder a base para a varredura.
- **E0.7:** reduzir o pool do pg-boss e somá-lo na fórmula de produção. Se o `pgboss` criar triggers, o A-10 já cobre.
- **E3.x:** `maxWait`/`timeout` explícitos em `emTransacao` quando houver concorrência.
- **E5:** paginação e índice da listagem de clientes, se o volume pedir.

## 4. Consultas verificadas

Ver a tabela da §2.5. As saídas completas do `EXPLAIN` estão na §9.8.

## 5. Testes de integridade sugeridos

Complementam os do desenho e cabem no T-3/T-5.
- `harness/banco.test.ts` (puro):
  - base de 47 caracteres → erro nomeando `TEST_DATABASE_URL`;
  - `exec` sem 10 caracteres → erro;
  - filtro de órfãs com os 13 casos da §9.7 (inclusive "outro dono" e "idade negativa").
- `harness/template.test.ts`: depois do `globalSetup`, conectar ao template falha com `55000`/"not currently accepting connections". Se o driver expuser só a mensagem, comparar a mensagem.
- Mutação sugerida ao tester (T-7): remover o `ALTER … ALLOW_CONNECTIONS false` e conectar ao template num teste. As cópias seguintes falham com `55006` depois de 5 s, o que prova o valor do A-2.

## 6. Orientações ao desenvolvedor

- Erros que o harness deve traduzir com mensagem própria, sem credenciais:
  - `55006` (template em uso);
  - `42501` (`permission denied to terminate process` / `must be owner`);
  - `53300` (conexões esgotadas);
  - `3D000` (base administrativa inexistente: "crie a base de `TEST_DATABASE_URL`").
- Monte a URL do worker com `new URL(urlTeste)`, trocando só `pathname` (`urlComBase`). Usuário, senha, host, porta e query ficam preservados.
- Nenhuma operação do harness roda dentro de `BEGIN`.

## 7. Reversão

Não se aplica a esquema de produto: o T-1 não cria migração. As bases criadas pelo harness são descartáveis. Para limpar à mão (só a base local ou a de teste):
`psql "$TEST_DATABASE_URL" -Atc "SELECT datname FROM pg_database WHERE datname ~ '^agenda_beleza_test_r[0-9a-z]{10}_(tpl|w[0-9]{1,3})$'"` e, para cada nome, `DROP DATABASE IF EXISTS "<nome>" WITH (FORCE)`.

## 8. Critérios de conclusão do DBA

- `migrate deploy` aplicado sem erro num template limpo (`template0`) por um papel não superusuário: sim (§9.3).
- Reversão: documentada (§7).
- Testes de integração: os do harness são entregáveis do T-3. Este parecer fornece os casos (§5).

## 9. Evidências (comandos e saídas resumidas)

Container: `docker run -d --rm --name dba-d005-probe -e POSTGRES_USER=agenda -e POSTGRES_PASSWORD=… -e POSTGRES_DB=agenda_beleza -p 55805:5432 postgres:17`, mais o papel `CREATE ROLE teste LOGIN CREATEDB` e `CREATE DATABASE agenda_beleza_test OWNER teste`. Removido no fim com `docker rm -f` (`docker ps -a --filter name=dba-d005-probe` → 0). Uma segunda instância curta (porta 55806) serviu só para a §9.5b e também foi removida.

**9.1 Servidor**
```
PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1)
max_connections=100 superuser_reserved_connections=3 reserved_connections=0
template0|UTF8|en_US.utf8|en_US.utf8|c|datistemplate=t|datallowconn=f
template1|UTF8|en_US.utf8|en_US.utf8|c|t|t
agenda(rolsuper,rolcreatedb) = t|t
```
**9.2 `template1` × `template0`**
```
(sessão aberta em template1) CREATE DATABASE a_padrao
  ERROR: source database "template1" is being accessed by other users   real 0m5,043s
CREATE DATABASE a_tpl0 TEMPLATE template0 ENCODING 'UTF8'   → CREATE DATABASE   real 0m0,110s
psql -d template0 → FATAL: database "template0" is not currently accepting connections
(template1 com btree_gist + tabela) b_padrao: plpgsql,btree_gist | tabelas: 1 ; b_tpl0: plpgsql | tabelas: 0
CREATE DATABASE x TEMPLATE template0 ENCODING 'LATIN1' → ERROR: encoding "LATIN1" does not match locale "en_US.utf8"
```
**9.3 Template como papel `CREATEDB` (não superusuário)**
```
CREATE DATABASE "agenda_beleza_test_rmwmoo9v7ab_tpl" TEMPLATE template0 ENCODING 'UTF8'   (34 caracteres)
DATABASE_URL=…/<tpl> prisma migrate deploy → All migrations have been successfully applied.  real 1,26 s
CREATE SCHEMA harness_extensao; CREATE TABLE harness_extensao.marcador …; tabelas public = 25 (24 + _prisma_migrations); tamanho 9326 kB
CREATE DATABASE <…_w1> TEMPLATE <tpl>  → marcador=1, extensões plpgsql,btree_gist, _prisma_migrations=3
(papel intruso CREATEDB) CREATE DATABASE furto TEMPLATE <tpl> → ERROR: permission denied to copy database
```
**9.4 `IS_TEMPLATE` e `ALLOW_CONNECTIONS`**
```
ALTER DATABASE d_tpl IS_TEMPLATE true; DROP DATABASE d_tpl WITH (FORCE) → ERROR: cannot drop a template database
ALTER DATABASE <tpl> ALLOW_CONNECTIONS false; psql -d <tpl> → FATAL: … is not currently accepting connections
CREATE DATABASE <…_w2> TEMPLATE <tpl> → CREATE DATABASE; datallowconn(_w2) = t
(sessão harness:esquecido aberta ANTES do ALTER) pg_stat_activity → teste|harness:esquecido;
  CREATE DATABASE sonda_copia TEMPLATE <tpl> → ERROR: source database … is being accessed by other users
```
**9.5 `DROP … WITH (FORCE)`**
```
sessões em _w1 e _w2 (esta em BEGIN); DROP DATABASE IF EXISTS _w1 WITH (FORCE) → DROP DATABASE  real 0m0,427s
  _w1: FATAL: terminating connection due to administrator command
  _w2: BEGIN / w2 viva: …_w2 / COMMIT
sessão de superusuário em _w2; DROP … WITH (FORCE) como teste → ERROR: permission denied to terminate process
  DETAIL: Only roles with the SUPERUSER attribute may terminate processes of roles with the SUPERUSER attribute.
BEGIN; DROP DATABASE … → ERROR: DROP DATABASE cannot run inside a transaction block
DROP DATABASE IF EXISTS agenda_beleza WITH (FORCE) (como teste) → ERROR: must be owner of database agenda_beleza
```
**9.5b** `ALTER DATABASE t_tpl ALLOW_CONNECTIONS false; CREATE DATABASE t_w1 TEMPLATE t_tpl; DROP … t_w1 WITH (FORCE); DROP … t_tpl WITH (FORCE)` → todos OK, 2º `DROP IF EXISTS` → `NOTICE … does not exist, skipping`.

**9.6 Tempo e nomes**
```
WAL_LOG   4 resets simultâneos: 119 / 196 / 175 ms
FILE_COPY 4 resets simultâneos: 1011 / 1024 / 1090 ms
1 reset isolado (padrão): 112 ms
CREATE DATABASE <70 × 'a'> → NOTICE: identifier "…" will be truncated to "<63 × 'a'>"; CREATE DATABASE; length = 63
pg_stat_activity (papel teste vendo sessão de agenda): agenda_beleza|agenda|<backend_type nulo>|<insufficient privilege>
backend_type visível ao papel comum: client backend=1 ; nulo=5 (processos de fundo)
```
**9.7 Varredura de órfãs simulada** (script em scratchpad com o filtro do §3.6 + A-6, 6 h, só listagem)
```
APAGA  agenda_beleza_test_rmwm9q3zfaa_tpl   (casa, 7.0 h, dono próprio)
APAGA  agenda_beleza_test_rmwm9q3zfaa_w1    (casa, 7.0 h, dono próprio)
APAGA  agenda_beleza_test_rmwm9q3zfaa_w12   (casa, 7.0 h, dono próprio)
mantém agenda_beleza_test_rmwm9q3zfaa_w7    (casa, 7.0 h, dono = outro papel)
mantém agenda_beleza_test_rmwme0fjfbb_w1    (casa, 5.0 h)
mantém agenda_beleza_test_rmwmqve7fcc_w2    (casa, -1.0 h: relógio no futuro)
mantém agenda_beleza_test_rmwmoo9v7ab_{tpl,w1..w4} (execução corrente, 0.0 h)
mantém agenda_beleza_test_rmwm9q3zfaa_w1_copia | agenda_beleza_test2_r…_w1 | xagenda_beleza_test_r…_w1 | agenda_beleza_test_r<9 caracteres>_w1
mantém agenda_beleza | agenda_beleza_test | postgres | a_tpl0 | b_padrao | b_tpl0
```
**9.8 SQL do Prisma 7 (log de query, cliente gerado do repo) e `EXPLAIN (ANALYZE)` com plano genérico**
```
[sessão] … FROM "sessao" WHERE ("token_hash" = $1 AND "expira_em" > $2 AND "revogada_em" IS NULL)
         … FROM "usuario" WHERE "usuario"."id" IN ($1)
         … FROM "profissional" WHERE ("salao_id" IN ($1) AND "usuario_id" IN ($2))
[buscarPorId] … FROM "reserva" WHERE ("id" = $1 AND "salao_id" = $2) LIMIT $3
              … FROM "reserva_item" WHERE ("salao_id" IN ($1) AND "reserva_id" IN ($2)) ORDER BY "ordem"
[listarPorPeriodo] … WHERE ("salao_id" = $1 AND "inicio" >= $2 AND "inicio" < $3) ORDER BY "inicio"
                   itens: "salao_id" IN ($1..$120) AND "reserva_id" IN ($121..$240)
[atualizarStatus] UPDATE "reserva" SET "status" = …, "atualizado_em" = $2 WHERE ("id" = $3 AND "salao_id" = $4 AND "status" = …)

Q1 sessão          → Index Scan sessao_token_hash_key; Index Scan usuario_pkey
Q2a (salao,usuario) → Index Scan profissional_salao_id_usuario_id_key
Q2b só usuario_id   → Seq Scan on profissional, Rows Removed by Filter: 999
Q3 id+salao        → Index Scan reserva_salao_id_id_key
Q4 UPDATE CAS      → Index Scan reserva_salao_id_id_key, Filter: (status = $4)
Q5 período         → Bitmap Index Scan reserva_salao_id_inicio_idx (120 linhas)
itens (forma Prisma) → Index Scan reserva_item_salao_id_reserva_id_ordem_key, Index Cond: salao_id = ANY … AND reserva_id = ANY …
itens só reserva_id → Seq Scan on reserva_item, Rows Removed by Filter: 199999
Q6 clientes        → Bitmap Index Scan cliente_salao_id_id_key, Sort quicksort 67kB (500 linhas)
Q7a slug           → Index Scan salao_slug_pkey
Q7b slug atual     → Bitmap Index Scan salao_slug_salao_id_idx, Filter: (atual = $2)
Q7c serviços       → Bitmap Index Scan servico_salao_id_id_key, Filter: ativo
```
**9.9 CAS sob `READ COMMITTED`**
```
T1: BEGIN / UPDATE 1 / (pg_sleep 2) / COMMIT
T2: BEGIN / read committed / UPDATE 0 / COMMIT      (T2 esperou 1543 ms)
```
**9.10 Drift com schema extra**
```
migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
  harness_extensao com tabela                  → exit=0
  harness_extensao com tabela + trigger + função → exit=0
  tabela extra em public                       → exit=2
SELECT … FROM pg_trigger WHERE NOT tgisinternal          → 4 do contrato + marcador_t|harness_extensao.marcador
… JOIN pg_class c … AND c.relnamespace = 'public'::regnamespace → só os 4 do contrato
```
