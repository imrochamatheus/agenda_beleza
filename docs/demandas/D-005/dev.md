# D-005 — Registro do desenvolvedor

## T-2 — Realocar o cliente Prisma e criar a regra de lint

Estado: concluída (sem commit).

### Arquivos alterados
| Arquivo | Mudança |
|---|---|
| `src/server/db.ts` → `src/server/repos/db.ts` (`git mv`) | + `POOL_MAX_PADRAO = 10`, `configurarPool({ max })`, `configuracaoDoAdaptador(url, { max? })` (pura, testável sem banco) e `criarPrisma(url, { max? })`. `max` omitido usa o valor de `configurarPool` (padrão 10); `max` inválido (não inteiro ou < 1) lança. `configurarPool` só afeta clientes criados depois (os do cache mantêm o pool). |
| `src/server/db.test.ts` → `src/server/repos/db.test.ts` (`git mv`) | Testes antigos + pool padrão 10, `configurarPool` e precedência do `max` explícito, cache preservado, `max` inválido recusado. |
| `src/server/repos/saude.ts` (novo) | `bancoDisponivel()`: `verificarBanco(obterPrisma())`; URL ausente ou erro → `false`, nunca lança. |
| `src/server/repos/saude.test.ts` (novo) | Porta fechada (conexão real) → `false`; sem `DATABASE_URL` → `false`. |
| `src/app/api/health/route.ts` | Usa só `bancoDisponivel()` de `@/server/repos/saude` (não importa mais a instância). |
| `src/app/api/health/route.test.ts` | Import de `encerrarPrisma` de `@/server/repos/db`. |
| `tests/integration/health.test.ts` | Import de `@/server/repos/db` + caso `bancoDisponivel()` → `true` contra o PostgreSQL real (harness antigo). |
| `eslint.config.mjs` | Regra core `no-restricted-imports` (`patterns[].regex`, `allowTypeImports: true`) para `**/*.{ts,tsx,mts,js,mjs}`, com `ignores` `src/server/repos/**`, `src/worker/**`, `prisma/seed.ts`, `tests/**`, `**/*.test.{ts,tsx}`. Padrões: `(^\|/)generated/prisma(/\|$)`, `^@prisma/(client\|adapter-pg)(/\|$)`, `^pg(/\|$)`, `(^\|/)repos/db(\.[cm]?[jt]s)?$` (cobre alias e caminhos relativos). |
| `tests/integration/lint/importacao-prisma.test.ts` (novo) | CA-5 via `ESLint#lintText` com a configuração real do projeto. |
| `src/server/health.test.ts` | **Fora da posse** (ver desvios): import `./db` → `./repos/db`. |

### Testes e CAs
- `tests/integration/lint/importacao-prisma.test.ts` (CA-5, RN-10, S-6), 40 casos:
  - `src/app/x.ts`, `src/server/tenant/x.ts` e `src/server/x.ts` importando `@/generated/prisma/client`, `@/generated/prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg` (default e nomeado), `@/server/repos/db` (import e `export … from`) e os relativos (`../repos/db`, `../../generated/prisma/client`, `../server/repos/db`, `../generated/prisma/client`, `./repos/db`) → exatamente 1 erro `no-restricted-imports`.
  - Lint de `src/app/viola.ts` → `errorCount > 0`.
  - Liberados (0 erros da regra): `src/server/repos/x.ts`, `src/server/repos/sub/x.ts`, `src/worker/x.ts`, `prisma/seed.ts`, `tests/x.test.ts`, `tests/support/x.ts`, `src/app/x.test.ts`, `src/app/x.test.tsx`.
  - S-6: `import type` / `import { type … }` do cliente, `import type pg` e `import type` de `repos/db` em `src/server/x.ts` → 0 erros.
  - Sem falso positivo: `@/server/health`, `@/server/repos/saude`, `pg-format`, `prisma/config`.
  - O helper falha se o arquivo simulado estiver ignorado pelo ESLint (evita "0 erros" por engano).
- `src/server/repos/db.test.ts`: pool de produção 10 explícito; `configurarPool` (base do CA-16, que a T-3 prova contra o banco).
- `src/server/repos/saude.test.ts` e `tests/integration/health.test.ts`: `bancoDisponivel` false/true.

Mutações conferidas (revertidas em seguida): regra em `'off'` → 30 dos 40 casos falham; `allowTypeImports: false` → o caso S-6 falha.

### Comandos e resultados (Node v24.21.0, PostgreSQL do compose)
| Comando | Resultado |
|---|---|
| `npm run typecheck` | passou |
| `npm run lint` | passou (0 avisos; nenhum `eslint-disable`) |
| `npm run test:unit` (sem `.env`, sem banco no ambiente) | passou: 12 arquivos, 50 testes |
| `npm run test:integration` | passou: 12 arquivos, 156 testes (harness antigo) |
| `npx vitest run tests/integration/lint` | passou: 40 testes, ~2,8 s |
| `npm run build` | passou (`/api/health` dinâmica) |
| `npm run build:node` | passou |
| `npm run test:coverage` | passou: 24 arquivos, 206 testes; linhas 100%, ramos 96,42% |
| CA-5 manual: `src/app/viola.ts` temporário importando `@/server/repos/db` → `npx eslint src/app/viola.ts` | código 1, erro `no-restricted-imports` (arquivo removido depois) |

Observação de ambiente: o volume local antigo não tinha a base de teste; ela foi criada com o comando documentado (`docker compose exec postgres createdb -U agenda agenda_beleza_test`). As variáveis `DATABASE_URL`/`TEST_DATABASE_URL` foram exportadas no shell com os valores do `.env.example` (nenhum `.env` foi criado).

### Desvios do desenho
1. `src/server/health.test.ts` (não listado na posse da T-2) teve uma linha alterada (`./db` → `./repos/db`). É consequência direta do `git mv` exigido pela T-2: sem isso o `typecheck` e o `test:unit` quebram. Nenhuma outra mudança no arquivo.
2. Acréscimo `configuracaoDoAdaptador(url, { max? })` exportado em `repos/db.ts`: torna o `max` do pool verificável por teste unitário sem abrir conexão (o cliente do Prisma 7 é um proxy que não expõe o adaptador). Não muda a interface prevista (`configurarPool`, `criarPrisma`).
3. Padrão `^pg(/|$)` também cobre subcaminhos (`pg/lib/...`), e `@prisma/client`/`adapter-pg` cobrem subcaminhos; `pg-format` e afins seguem liberados.

### Riscos e pendências
- A regra core `no-restricted-imports` não cobre `import()` dinâmico nem `require()`. Risco baixo (o projeto é ESM/TS com imports estáticos); revisão de código cobre.
- `configurarPool` não recria clientes já em cache: o `setup-arquivo.ts` da T-3 deve chamá-lo antes do primeiro `obterPrisma()` do arquivo (como o design já prevê).
- O `health.test.ts` de integração continua apontando para `urlBancoDeTeste()` do harness antigo; a T-3 o migra para a base do worker.

## T-4 — Núcleo tenant e repositórios

Estado: concluída (sem commit). Executada em paralelo com a T-3, sem tocar em arquivos dela.

### Arquivos criados
| Arquivo | Conteúdo |
|---|---|
| `src/server/tenant/erros.ts` | `ErroDeDominio` + `NaoAutenticado` (401), `AcessoNegado` (403, `motivo` só interno), `NaoEncontrado` (404, construtor sem argumentos); mensagens constantes; `respostaDeErro` → `{ status, corpo: { erro: codigo } }`; `ehErroDeDominio`. |
| `src/server/tenant/context.ts` | `Papel`, `PapelDeSalao`, `PAPEIS_DE_SALAO`, `CAPACIDADES` (6, S-5), contextos com marca nominal (`unique symbol` só de tipo, não exportado), fábricas congeladas que validam UUID, `exigirEscopo` (só tenant/sistema com salaoId UUID; senão `Error`), `exigirPublico`, `ehPapelDeSalao`, `ehCapacidade`. Não importa o Prisma (nem tipo). |
| `src/server/tenant/sessao.ts` | `NOME_COOKIE_SESSAO = 'ab_sessao'`, `hashDoToken` (SHA-256 hex), `Credencial`, `resolverTenant`, `resolverAdmin`. Credencial nula/token vazio → 401 sem consultar. |
| `src/server/tenant/politica.ts` | `DecisaoPolitica`, `PoliticaOperacao`, `permitirTudo`, `politicaDeOperacao` (= permitirTudo; E6.4 troca). |
| `src/server/tenant/define-acao.ts` | `METADADOS_ACAO` (`Symbol.for`), `ConfigAcao`, `ResultadoAcao`, `DepsAcao`, `Acao`, `defineAcao` (ordem RN-7; erros de domínio → `{ ok: false }`, demais relançados), `metadadosDaAcao`. |
| `src/server/tenant/registro.ts` | `verificarAcoes(modulos)` → `ProblemaRegistro[]` ordenados (`nao_e_acao`, `sem_capacidade`, `capacidade_invalida`, `sem_papeis`). |
| `src/server/tenant/next.ts` | Único importador de `next/headers`: `lerCredencialDoCookie`, `exigirContexto(papeis?)`. |
| `src/server/repos/ids.ts` | `ehUuid`. |
| `src/server/repos/tipos.ts` | DTOs sem `salaoId`, `StatusReserva`/`OrigemReserva` como uniões e asserções de tipo de equivalência com os enums do Prisma (`StatusReserva`, `OrigemReserva` e `Papel`). |
| `src/server/repos/transacao.ts` | `Executor`, `emTransacao(fn)` com `isolationLevel: ReadCommitted` explícito. |
| `src/server/repos/index.ts` | `Repos`, `criarRepos(db)`, `repos()`. |
| `src/server/repos/{servico,profissional,cliente,reserva}.ts` | Contrato do §3.4: `exigirEscopo` como 1ª instrução; ID não UUID → `NaoEncontrado` sem consulta; `findFirst({ where: { id, salaoId } })`; mutação por `updateMany({ where: { id, salaoId, ...predicado } })`, `count === 0` → `NaoEncontrado`, releitura escopada. `cliente.renomear` com `anonimizadaEm: null`; `reserva.atualizarStatus` com `status: de` (primitiva, comentário de contrato R-8). Listagens: equipe vê inativos e anonimizadas (RN-16). |
| `src/server/repos/sessao.ts` | `SessaoValida`, `buscarSessaoValida(tokenHash, agora)` (`token_hash`, `expira_em > agora`, `revogada_em IS NULL`). |
| `src/server/repos/publico.ts` | `resolverSalaoPorSlug` (exato; histórico → slug atual + `historico: true`; inexistente/vazio → `NaoEncontrado`), `listarServicosPublicos`, `listarProfissionaisPublicos` (só ativos, `select` explícito). |

Testes unitários (sem PostgreSQL; quando há `DATABASE_URL`, ela aponta para porta fechada, de modo que qualquer consulta indevida apareceria como erro de conexão):
| Arquivo | O que verifica |
|---|---|
| `tenant/erros.test.ts` | Mapeamento 401/403/404, corpo e mensagens constantes, `motivo` fora do corpo (CA-1/CA-8). |
| `tenant/context.test.ts` | Fábricas, congelamento, UUID inválido, `exigirEscopo` recusando admin/publico/forjados (CA-13 em tempo de execução), `exigirPublico`, capacidades. |
| `tenant/sessao.test.ts` | Cookie `ab_sessao`, vetor SHA-256, 401 sem credencial sem consultar, erro de infraestrutura não vira 401. |
| `tenant/politica.test.ts` | Política padrão permite as 6 capacidades (base do CA-11). |
| `tenant/define-acao.test.ts` | CA-9a sem tocar o banco (handler e política não chamados), forma chamável sem cookie (next/headers substituído), erro não de domínio relançado, metadados congelados/não enumeráveis, config inválida recusa executar. |
| `tenant/next.test.ts` | `lerCredencialDoCookie` só lê `ab_sessao`; `exigirContexto` sem cookie → `NaoAutenticado` (CA-18, parte sem banco). |
| `tenant/registro.test.ts` | `verificarAcoes` com ações em memória: válidas, e cada inválida acusada por arquivo, nome e motivo (base do CA-4). |
| `repos/ids.test.ts` | `ehUuid`. |
| `repos/index.test.ts` | Os 4 repositórios: ID malformado → `NaoEncontrado` sem consulta (CA-8); contexto admin/publico/forjado → `Error` antes da consulta (CA-13); `SistemaContext` aceito. |
| `repos/publico.test.ts` | Slug vazio → `NaoEncontrado`; listagens públicas recusam contexto não público. |

### Parecer do DBA (A-8) aplicado
- `profissionalId` da sessão: `select` aninhado na relação `usuario.profissional`. `itens` da reserva: `select` aninhado na relação `itens`. Nenhuma consulta por uma só coluna da FK composta.
- SQL conferido com `log_statement = 'all'` numa base descartável: `profissional … WHERE salao_id IN ($1) AND usuario_id IN ($2)` e `reserva_item … WHERE salao_id IN ($1) AND reserva_id IN ($2) ORDER BY ordem`, que são as formas que o DBA mediu com índice.
- `emTransacao` passa `Prisma.TransactionIsolationLevel.ReadCommitted` explicitamente.

### Comandos e resultados (Node v24.21.0, PostgreSQL do compose, `DATABASE_URL`/`TEST_DATABASE_URL` do `.env.example` exportadas; sem `.env`)
| Comando | Resultado |
|---|---|
| `npm run typecheck` | passou |
| `npm run lint` | passou (0 avisos; nenhum `eslint-disable`) |
| `npm run build` | passou |
| `env -u DATABASE_URL -u TEST_DATABASE_URL npm run test:unit` | passou: 22 arquivos, 83 testes |
| `npm run test:integration` | passou: 12 arquivos, 156 testes (harness antigo; T-3 ainda não aplicada no momento) |
| `npm run test:coverage` | testes passam (34 arquivos, 239); **gate reprova: linhas 78,45%**. `src/server/repos` 64,2% e `src/server/tenant` 81,7% só com os testes unitários: as linhas restantes são os caminhos com dados reais, que são da T-5 (design §8: cobertos pela integração). |
| `grep -rn "prisma" src/server/tenant/*.ts` (fora de testes) | vazio |
| `grep -n "salaoId" src/server/repos/{servico,profissional,cliente,reserva}.ts` | só `const salaoId = exigirEscopo(ctx)` e `where` derivados dele |
| Mutação: `StatusReserva` e `Papel` com valor extra | `typecheck` falha em `repos/tipos.ts` (asserções efetivas); revertido |
| Sanidade manual descartável (base `t4_scratch` criada, migrada e apagada; script fora do repositório) | passou: `resolverTenant` com `profissionalId`, isolamento de leitura, CA-2 (linha de B idêntica), `renomear` nos 3 agregados, anonimizada recusada, itens com snapshot, `listarPorPeriodo`, `atualizarStatus` com predicado, `emTransacao` com rollback e commit, slug atual/histórico/inexistente, listas públicas só com ativos, `defineAcao` com `salaoId` injetado ignorado (CA-7), política negando → 403, `NaoEncontrado` do handler → 404, `agora` após a expiração → 401 |

### Desvios do desenho
1. Acréscimos de apoio, sem mudança das interfaces do §3: `PAPEIS_DE_SALAO`, `ehPapelDeSalao`, `ehCapacidade` e `exigirPublico` (guarda das leituras públicas) em `context.ts`; `ehErroDeDominio` e `StatusErro` em `erros.ts`; `metadadosDaAcao` em `define-acao.ts`; tipos `Periodo`, `ReservaItemDTO`, `OrigemReserva`, `ServicoPublico` e `ProfissionalPublico`.
2. A asserção `Papel ≡ PapelUsuario` fica em `repos/tipos.ts`, e não em `tenant/context.ts`, para que nenhum arquivo de `tenant/**` importe o Prisma, nem mesmo como tipo (critério da T-4).
3. As fábricas de contexto também validam UUID de `usuarioId`/`profissionalId` e o papel (o design pedia só o `salaoId` do `contextoDeSistema`). `exigirEscopo` também exige `salaoId` UUID.
4. `defineAcao` não lança erro na definição se a config for inválida em tempo de execução (JS ou `@ts-expect-error`): registra a ação, para que `verificarAcoes` a acuse pelo nome (CA-4), e `executar` lança `Error` (fail closed) antes de ler a sessão.
5. Os DTOs de serviço, profissional e cliente incluem `criadoEm`/`atualizadoEm`; o de reserva segue o §3.4 exatamente.

### Pendências e riscos para a T-5
- **Cobertura:** o gate de 90% só fecha com os testes de integração da T-5. Linhas descobertas hoje: caminhos de sucesso e `NaoEncontrado` com dados em `servico/profissional/cliente/reserva.ts`, `publico.ts` (resolução por slug), `repos/sessao.ts`, `transacao.ts`, `tenant/sessao.ts` (sessão real: 401 expirada/revogada, 403 super_admin, TOTP), `define-acao.ts` (papel, política, handler) e `next.ts` (`exigirContexto` com papel).
- **Teste do CA-13:** use as fábricas reais de contexto; um objeto montado à mão com `as` é recusado por `exigirEscopo` (esse é o comportamento pretendido).
- **Fixtures do CA-4:** importar `defineAcao` de `@/server/tenant/define-acao`; um fixture sem capacidade carrega sem erro e é acusado com `sem_capacidade`.
- **Credenciais de teste:** `criarSessao` deve gravar `hashDoToken(token)` de `@/server/tenant/sessao`.
- **`atualizarStatus`** voltando uma reserva para `confirmado` sobre um horário ocupado faz a exclusion constraint lançar o erro do driver (23P01), que não é traduzido para "horário indisponível". Hoje nenhuma ação usa essa primitiva. A tradução fica com a E3.5, que compõe cancelar e remarcar.
- **`renomear`** não valida o nome (vazio etc.). A validação de entrada (zod e 400) fica com a primeira ação real (E2.x), conforme o §3.3.
- A releitura depois do `updateMany` fora de `emTransacao` pode refletir uma escrita concorrente posterior (DBA §2.5). Isso é aceito na E0.5.

## T-3 — Harness por worker

Estado: concluída (sem commit).

### Arquivos alterados
| Arquivo | Mudança |
|---|---|
| `tests/integration/support/{banco,db,global-setup,sql}.ts` → `tests/support/` (`git mv`) | Diretório `tests/integration/support/` removido. |
| `tests/support/banco.ts` | Guarda e nomes (puro): `BASES_DE_SISTEMA`, `NOME_VALIDO`, `MAX_BASE_DE_TESTE = 46` (A-4), `IDADE_ORFA_MS` (6 h), `novoExec` (padStart 8 + 2 aleatórios, asserção de 10, A-5), `instanteDoExec`, `nomesDaExecucao` (`template`, `worker(n)`, `padraoOrfa`, `padraoDaExecucao`), `validarPlanoDeBases(env, exec, maxWorkers)` (valida até `_w999`), `validarNomeDerivado`, `selecionarOrfas` (filtro puro da varredura), `urlComBase`, `urlComAplicacao`. `nomeDaBase` e `urlBancoDeTeste(env?)` mantidos; URL malformada falha nomeando a variável, sem ecoar o valor. |
| `tests/support/db.ts` | `POOL_MAX_TESTES = 16`; `InicializadorDeSchema`, `schemaDeProva` (`harness_extensao.marcador`, sem trigger/função), `INICIALIZADORES`; `prepararTemplate` (`TEMPLATE template0 ENCODING 'UTF8'` + conferência de encoding, `migrate deploy`, inicializadores com `application_name=harness:<nome>`, conferência de `pg_stat_activity` por até 2 s listando os `application_name`, `ALLOW_CONNECTIONS false`; `try/catch` apaga o template em qualquer falha); `apagarBasesDaExecucao` (lista o catálogo, dono = `current_user`, workers antes do template); `apagarOrfas` (catálogo com `NOT datistemplate` e dono, `selecionarOrfas`, falha individual vira `console.warn`); `planoDaExecucao`, `nomeDoWorker`, `urlDoWorker`, `recriarBaseDoWorker` (revalida com a base de dev capturada no `globalSetup`); `traduzirErroPg` (55006, 42501, 53300, 3D000 com mensagem própria e `code` preservado). Todo `DROP` é `DROP DATABASE IF EXISTS … WITH (FORCE)` em `query` separada, sem `BEGIN`; identificadores por `escapeIdentifier` depois da validação. `binarioPrisma`/`executarPrisma` inalterados. |
| `tests/support/global-setup.ts` | `prepararExecucao(env, maxWorkers, inicializadores?)` (guarda como 1ª instrução → órfãs → template) exportada para o teste do CA-17; `setup` lê `project.config.maxWorkers`, faz `provide('bancoDeTeste', plano)` e `provide('inicioDoReset', …)` e devolve o teardown (`apagarBasesDaExecucao`). |
| `tests/support/setup-arquivo.ts` (novo) | Top-level `await recriarBaseDoWorker()` → `process.env.DATABASE_URL`; `configurarPool({ max: POOL_MAX_TESTES })`; `afterAll(encerrarPrisma)`. |
| `tests/support/sql.ts` | `conectar()` usa `urlDoWorker()`; + `POOL_PG_PADRAO = 12` e `criarPoolPg(max = 12)` com a regra dos dois pools no comentário (A-7). |
| `tests/integration/db/*.test.ts` | Imports `../../support/…`. `drift.test.ts`: `migrate diff` em `urlDoWorker()`; triggers filtrados por `relnamespace = 'public'::regnamespace` (A-10); `inject('inicioDoReset')` preservado (CA-22 da D-004). |
| `tests/integration/health.test.ts` | Usa a base do worker (`urlDoWorker()`; confere que `DATABASE_URL` do processo já é a do worker) em vez de `urlBancoDeTeste()`. |
| `tests/integration/harness/banco.test.ts` (movido + reescrito) | Testes puros: ver abaixo. |
| `tests/integration/harness/db.test.ts` (movido + reescrito) | Inicializadores, teardown, órfãs e tradução de erros contra o PostgreSQL real; `executarPrisma`. |
| `tests/integration/harness/template.test.ts`, `pool.test.ts` (novos) | CA-17 com porta fechada, CA-15, A-1/A-2; CA-16. |
| `vitest.config.ts` | Projeto `integration`: `globalSetup` e `setupFiles` de `tests/support/`, `maxWorkers: 4`, `fileParallelism: true`, `sequence: { groupOrder: 1 }`. |

### Testes e CAs
- `harness/banco.test.ts` (46 casos, puros): **CA-17** — ausente, igual à base de dev (localhost × 127.0.0.1, `?schema`, outro host), base de sistema (3), nome inválido (maiúscula, hífen, acento, vazio), 46 aceito × 47 recusado (derivado `_w999` com 63), derivado `_wN` e `_tpl` iguais à base de dev, URL malformada sem ecoar o valor, nenhuma mensagem com a senha; `exec`/`maxWorkers` inválidos; `validarNomeDerivado` (inválido, 64 caracteres, sistema, dev, administrativa); **filtro de órfãs** com os casos da dba.md §9.7 (7 h, exatamente 6 h, 5 h, idade negativa, execução corrente, `_copia`, `test2`, prefixo antes, `exec` de 9, `w1000`, dev, administrativa, sistema) e órfã que colide com a dev mantida; `novoExec` (padStart, 10 caracteres, overflow), `urlComBase` preserva usuário/senha/host/porta/query.
- `harness/template.test.ts`: **CA-17** "antes de qualquer conexão" — `prepararExecucao` com porta 1 falha com a mensagem da guarda (ausente, igual à dev, sistema, 47 caracteres) e o controle válido dá `ECONNREFUSED` (CA-21 da D-004 adaptado). **CA-15** — no início do arquivo `current_database()` = `<base>_r<exec>_w<VITEST_POOL_ID>`, `salao` = 0, as 3 migrações e `harness_extensao.marcador = [1]`; depois de inserir um salão, `recriarBaseDoWorker()` volta a base ao estado do template. **R-3** — `1 ≤ VITEST_POOL_ID ≤ maxWorkers`. **A-2** — conectar ao template falha com "not currently accepting connections". **A-1** — template UTF8, `datistemplate = false`, `datallowconn = false`.
- `harness/pool.test.ts`: **CA-16** — `obterPrisma()` aponta para a base do worker; 12 `pg_sleep(1)` simultâneos → observador independente mede 12 backends distintos ativos ao mesmo tempo, em < 2 s. Controle: `configurarPool({ max: 2 })` + `criarPrisma` → no máximo 2 ativos e ≥ 2,9 s.
- `harness/db.test.ts`: template avulso com `schemaDeProva` copiado para um worker `w7` (VITEST_POOL_ID inesperado) e teardown na ordem `[w7, tpl]` com catálogo vazio depois (A-3, D-1); **R-1** — inicializador que deixa a conexão aberta falha com `application_name: harness:vazador` e o template é apagado; inicializador que lança falha nomeando-o; **varredura real** apaga a base de 7 h e mantém a de 5 h e as da execução atual (A-6); base administrativa inexistente → mensagem própria `SQLSTATE 3D000` sem a senha; tradução de 55006/42501/53300 e passagem intacta dos demais.
- D-004 (**CA-19 parcial**): os 8 arquivos de `tests/integration/db/**` e `health.test.ts` passam na base do worker.

Mutações conferidas (revertidas em seguida): `POOL_MAX_TESTES = 1` → o CA-16 falha; remover o `ALTER … ALLOW_CONNECTIONS false` → A-2 e A-1 falham.

### Comandos e resultados (Node v24.21.0, PostgreSQL do compose; `DATABASE_URL`/`TEST_DATABASE_URL` exportadas com os valores do `.env.example`, sem `.env`)
| Comando | Resultado |
|---|---|
| `npm run typecheck` | passou |
| `npm run lint` | passou (0 avisos; nenhum `eslint-disable`) |
| `npm run build` | passou |
| `env -u DATABASE_URL -u TEST_DATABASE_URL npm run test:unit` | passou: 22 arquivos, 83 testes (sem banco) |
| `npm run test:integration` (duas vezes seguidas) | passou nas duas: 14 arquivos, 211 testes, ~10 s |
| Duas execuções **simultâneas** de `npm run test:integration` | as duas com código 0 (211/211 cada); nenhum `53300` |
| Observador de `pg_database` durante uma execução | bases `…_r<exec>_tpl` e `…_w1`…`_w4` (R-3: `maxWorkers: 4` vale para o projeto); `_w7` só a do teste avulso |
| `SELECT count(*) FROM pg_database WHERE datname ~ '_r[0-9a-z]{10}_'` após cada execução | 0 |
| `grep -rnE "TRUNCATE\|migrate reset\|db push" tests/support` | vazio |
| `npm run test:coverage` | 36 arquivos e 294 testes passam (`unit` e `integration` juntos, prova de que o `groupOrder` resolve a convivência dos projetos); **gate reprovado: linhas 78,45%**. Todos os arquivos não-100% são da T-4 (`src/server/repos/{cliente,profissional,publico,reserva,servico,sessao,transacao}.ts`, `src/server/tenant/{define-acao,next,sessao}.ts`), sem testes de integração até a T-5. Os demais arquivos de `src/` ficam em 100%. |

### Desvios do desenho
1. `sequence: { groupOrder: 1 }` no projeto `integration` (não previsto no §3.6). O Vitest 5.1.1 recusa projetos com `maxWorkers` diferentes no mesmo `groupOrder` (`Projects "unit" and "integration" have different 'maxWorkers' but same 'sequence.groupOrder'`). Efeito: em `npm test`/`test:coverage` o `unit` roda antes do `integration`, e cada grupo numera `VITEST_POOL_ID` a partir de 1 (reforça a R-3). O `maxWorkers` continua por projeto (não subiu para a raiz).
2. `nomesDaExecucao(base, exec)` sem o parâmetro `maxWorkers` (era só para validar; a validação usa `_w999` pelo A-4) e com o acréscimo `padraoDaExecucao` (teardown do A-3). `PlanoDeBases` é serializável (`urlTeste`, `base`, `baseDev`, `exec`, `maxWorkers`), porque `provide` não transporta funções; os nomes são recalculados no worker.
3. Acréscimos não previstos e necessários aos ajustes: `prepararExecucao` exportada de `global-setup.ts` (teste do CA-17 com porta fechada), `selecionarOrfas`/`validarNomeDerivado`/`novoExec`/`urlComAplicacao` em `banco.ts`, `traduzirErroPg`/`planoDaExecucao`/`nomeDoWorker`/`schemaDeProva` em `db.ts`, `POOL_PG_PADRAO` em `sql.ts`.
4. `urlBancoDeTeste(env = process.env)`: recebe o env explícito (A-4: nos testes do CA-17 o `DATABASE_URL` do processo já é o do worker).

### Riscos e pendências para a T-5
- **Gate de cobertura** (78,45%) depende dos testes de integração da T-5 sobre `src/server/repos/**` e `src/server/tenant/**`.
- Use `urlDoWorker()`/`obterPrisma()` (o `DATABASE_URL` do processo já é o do worker) e `criarPoolPg()` (padrão 12) nos testes de concorrência; não sature o pool do Prisma e o do `pg` ao mesmo tempo (A-7). Feche todo `pg.Client`/`pg.Pool` aberto no arquivo: o `setup-arquivo` só encerra os clientes Prisma.
- Para registrar o CA-6: `process.env.VITEST_POOL_ID` e `nomeDoWorker()` (ou `SELECT current_database()`).
- Um teste que chame `recriarBaseDoWorker()` no meio do arquivo deve fechar antes as conexões abertas na base (o `FORCE` as encerra; um `pg.Client` sem listener de `error` derruba o processo).
- Duas execuções simultâneas passaram, mas o orçamento fica sem folga quando os picos coincidirem (dba.md §2.4); com `53300`, `docker compose stop app worker`. README fica com a T-6.

## T-5 — Fábricas, autenticação e testes dos CAs

Estado: concluída (sem commit).

### Arquivos criados
| Arquivo | Conteúdo |
|---|---|
| `tests/support/factories.ts` | `criarSalaoCompleto(sobrescritas?)` e `criarDoisSaloes()` via Prisma (`obterPrisma()`, base do worker), sem SQL manual. Por salão: slug atual + histórico; gestor confirmado com perfil de profissional (ou sem, com `gestor.comPerfil: false`); profissional com usuário próprio; profissional inativo; 2 serviços ativos + 1 inativo com vínculos em `servico_profissional`; jornada seg–sáb (2 faixas) para quem atende; 1 bloqueio; cliente ativa + anonimizada; reserva `confirmado` em relógio + 7 dias (UTC) com 2 itens (snapshot de preço e duração). Sobrescritas: salão (nome, fuso, grade, intervalo), slugs, gestor, profissional, serviços, cliente, início da reserva. `instanteFuturo(dias, hora, minuto)`. |
| `tests/support/auth.ts` | `criarSessao(usuarioId, { expiraEm, revogadaEm, totpVerificadoEm })` (token `randomBytes(32)` base64url, grava `hashDoToken(token)` de produção), `credencialDoGestor`, `credencialDoProfissional`, `criarSuperAdmin({ totpVerificado })`. |
| `tests/integration/tenant/fabricas.test.ts` | CA-3 (17 testes). |
| `tests/integration/tenant/isolamento.test.ts` | CA-1, CA-2, CA-7, CA-8 (38 testes), só com fábricas. |
| `tests/integration/tenant/define-acao.test.ts` | CA-9 (a–f), CA-10, CA-11 e a forma chamável com `next/headers` substituído (18 testes). |
| `tests/integration/tenant/exigir-contexto.test.ts` | CA-18 (4 testes). |
| `tests/integration/tenant/publico.test.ts` | CA-12 (7 testes). |
| `tests/integration/tenant/contextos.test.ts` | CA-13 (10 testes; 6 `@ts-expect-error`). |
| `tests/integration/tenant/transacao.test.ts` | CA-14 (4 testes). |
| `tests/integration/tenant/registro.test.ts` + `fixtures/registro/{valida,sem-capacidade,sem-define-acao,capacidade-invalida}.acao.ts` | CA-4 (6 testes; 2 `@ts-expect-error` nos fixtures). |
| `tests/integration/concorrencia/disputa.ts` | Apoio do CA-6 (não é teste): N conexões do `criarPoolPg(N)`, N `BEGIN`, disparo simultâneo de `INSERT reserva` + `INSERT reserva_item`, `COMMIT`/`ROLLBACK`; `registroDoWorker` (`VITEST_POOL_ID` e `nomeDoWorker()`). Fecha todos os clientes e o pool. |
| `tests/integration/concorrencia/reserva-paralela-a.test.ts`, `-b.test.ts` | CA-6 (3 + 5 testes). |

Nenhum arquivo de `src/` foi alterado na T-5: nenhum teste revelou defeito no código da T-3/T-4.

### Tabela CA → evidência
| CA | Teste(s) | Evidência |
|---|---|---|
| CA-1 | `isolamento.test.ts` › "CA-1 (servico\|profissional\|cliente\|reserva)" | Pela ação (núcleo de `defineAcao` + credencial real do gestor de A): ID de B → `{ ok: false, erro: 'nao_encontrado', status: 404 }`; o JSON do resultado e a mensagem do erro não contêm nenhum valor de B (ids, nomes, e-mails, telefone, slug); `respostaDeErro` → 404 `{ erro: 'nao_encontrado' }`. Controle: o próprio recurso de A é lido. |
| CA-2 | `isolamento.test.ts` › "CA-2 (…)" | Por agregado (`servico/profissional/cliente.renomear`, `reserva.atualizarStatus`): 404 e a linha de B lida por `SELECT to_jsonb(t)` (pg direto, todas as colunas, inclusive `atualizado_em`) idêntica antes e depois. Controle: a mesma ação altera A. Extras: cliente anonimizada e `de` divergente → 404 sem alteração. |
| CA-3 | `fabricas.test.ts` | Cada elemento conferido por SQL direto e pertencente ao salão certo (A e B); A e B sem nenhum valor em comum; sobrescritas aplicadas; o teste lê `isolamento.test.ts` e confere que não há `INSERT`/`$executeRaw`/`$queryRaw` (também `grep -nE "INSERT\|\$executeRaw\|\$queryRaw" tests/integration/tenant/isolamento.test.ts` → vazio, código 1). |
| CA-4 | `registro.test.ts` | `import.meta.glob('/src/**/*.acao.ts')` → `verificarAcoes` = `[]`; fixtures carregados pelo mesmo mecanismo → exatamente 3 problemas pelo nome (`acaoCapacidadeInvalida`/`capacidade_invalida`, `acaoSemCapacidade`/`sem_capacidade`, `acaoCrua`/`nao_e_acao`), a válida não é acusada; a união produto+fixtures reprova a asserção; ação sem capacidade recusa executar. Typecheck: os 2 `@ts-expect-error` dos fixtures são usados. |
| CA-5 | (T-2) `lint/importacao-prisma.test.ts` | Inalterado; passa na suíte. |
| CA-6 | `concorrencia/reserva-paralela-{a,b}.test.ts` | 12 transações simultâneas no mesmo profissional: A no mesmo horário, B com inícios a cada 5 min (todas sobrepostas): exatamente 1 aceita e 11 `{ code: '23P01', constraint: 'reserva_sem_sobreposicao' }`; no banco, 1 reserva no intervalo com o seu item; `salao` contém só o salão do arquivo; `current_database()` = `nomeDoWorker()`. Laço de 10 execuções com 2 workers: ver abaixo (10/10, A e B sempre em `VITEST_POOL_ID` distintos). Ver o achado F-1. |
| CA-7 | `isolamento.test.ts` › "CA-7" | `salaoId` de B no input → resultado idêntico ao sem o campo (leitura de A ok; leitura/mutação de B 404, linha de B inalterada); listagens (serviços, profissionais, clientes, reservas) só com os IDs de A (inclui inativos e anonimizada, RN-16), com e sem o campo; período `[de, ate)`. |
| CA-8 | `isolamento.test.ts` › "CA-8" | UUID inexistente, ID de B e malformados (`nao-e-uuid`, vazio, injeção, hex inválido) → resultados idênticos em leitura e mutação, para os 4 agregados; a promessa nunca rejeita (um 22P02 do driver seria relançado e o teste falharia); mesma mensagem e mesmo corpo. |
| CA-9 | `define-acao.test.ts` › "CA-9a..f" | (a) nula, (b) token desconhecido, (c) expirada e no limite `agora = expira_em` (controle 1 ms antes: válida), (d) revogada → 401; (e) profissional e (f) super_admin com e sem TOTP → 403; handler (`vi.fn`) não chamado. |
| CA-10 | `define-acao.test.ts` › "CA-10" | Contexto exato do gestor com perfil, do profissional e do gestor sem perfil (`profissionalId: null`); contexto congelado. |
| CA-11 | `define-acao.test.ts` › "CA-11" | Padrão permite as 6 capacidades; política que nega `agendar` → 403, handler não chamado, linha do serviço inalterada; `cancelar` permitida e grava; a política recebeu `[tipo, salaoId, usuarioId, capacidade]` esperados; política assíncrona aguardada e não consultada quando o papel é recusado; `NaoEncontrado` do handler → 404; erro não de domínio relançado. |
| CA-12 | `publico.test.ts` | Slug atual → `PublicoContext` de A; serviços e profissionais só ativos de A, com chaves exatas (`id,nome,precoCentavos,duracaoMin` / `id,nome`), sem e-mail, usuário, cliente nem reserva; slug de B lista só B; slug histórico → mesmo salão, `slugAtual` e `historico: true`; inexistente, maiúsculas, espaço e vazio → `NaoEncontrado`/404; salão só com slug histórico → `NaoEncontrado`. |
| CA-13 | `contextos.test.ts` | Super admin sem TOTP → `AcessoNegado('TOTP não verificado')`; com TOTP → `{ tipo: 'admin', usuarioId }` congelado; gestor/profissional com TOTP na sessão → `AcessoNegado`; sessão inválida → 401; super admin não obtém `TenantContext`. `AdminContext` e `PublicoContext` **reais** (de `resolverAdmin`/`resolverSalaoPorSlug`) em repositórios de tenant: `@ts-expect-error` (6 no total, incluindo `TenantContext` em leitura pública) e `Error` de programação em execução, sem efeito no banco; `SistemaContext` aceito e escopado. |
| CA-14 | `transacao.test.ts` | Erro lançado após alterar serviço e cliente → nada persiste (todas as colunas iguais); `NaoEncontrado` do repositório de clientes desfaz a alteração do de serviços; sem falha, serviço + profissional + reserva persistem; READ COMMITTED observado. |
| CA-15, CA-16, CA-17 | (T-3) `harness/*.test.ts` | Inalterados; passam na suíte. |
| CA-18 | `exigir-contexto.test.ts` | Cookie válido → `TenantContext` da sessão (também com `papeis`); sem cookie, token desconhecido, expirada, revogada → `NaoAutenticado`; papel fora de `papeis` e super_admin → `AcessoNegado`. |
| CA-19 | gates abaixo | Testes da E0.4 (`tests/integration/db/**`, `health.test.ts`) verdes na base do worker; `grep -rn "eslint-disable" src tests eslint.config.mjs --exclude-dir=generated` vazio; `vitest.config.ts` sem exclusão nova. |

### Mutações conferidas (revertidas, `cmp` com a cópia de segurança)
- `servico.ts` sem `salaoId` no `where` de `findFirst` e `updateMany` → 8 testes do `isolamento.test.ts` falham (CA-1, CA-2, CA-7, CA-8 de serviço).
- `define-acao.ts` consultando a política com `'leitura'` em vez da capacidade declarada → o teste do CA-11 falha.

### Achado F-1 (concorrência real × exclusion constraint): deadlock em vez de 23P01
Com N transações **abertas** inserindo ao mesmo tempo no mesmo profissional, cada `INSERT` grava a própria entrada no índice GiST e espera pelas transações em curso que conflitam com ela. Duas que esperam uma pela outra formam um deadlock. O PostgreSQL o desfaz depois de `deadlock_timeout` (1 s), abortando uma delas com `40P01`. Medições (12 transações; antes de introduzir a trava):
- mesmo horário: 8 de 15 execuções excederam o timeout de 5 s do teste, o que é compatível com ciclos de deadlock de 1 s cada. Os códigos não foram registrados nesse modo;
- horários deslocados (timeout ampliado, resultados impressos): 1 aceita e 11 recusas `40P01`, em cerca de 11 s.

A garantia "nunca duas aceitas" se manteve em todos os casos. O que muda é o **código** da recusa e o **tempo**.

Decisão na T-5: o apoio `disputa.ts` trava a linha do profissional (`SELECT 1 FROM profissional WHERE salao_id = $1 AND id = $2 FOR NO KEY UPDATE`) antes do `INSERT`. As 12 transações continuam simultâneas, e a recusa continua vindo da exclusion (`23P01`), mas sem deadlock. Isso é determinístico: 10/10 no laço e nas suítes completas. O arquivo B mantém um caso **sem trava** (6 transações deslocadas), que assere o que é garantido nesse modo: exatamente 1 aceita, recusas só `23P01`/`reserva_sem_sobreposicao` ou `40P01`, e 1 reserva no banco.

**Impacto para a E3.2/E3.4 (reserva pública e encaixe), a levar ao arquiteto/DBA:** o código de reserva deve (a) travar o profissional na transação antes do `INSERT` (como acima, ou com `pg_advisory_xact_lock` por profissional) **ou** (b) tratar `40P01` também como "horário indisponível" (ou repetir a transação). Sem isso, uma corrida real pode responder 500, ou demorar 1 s ou mais, em vez de "horário indisponível". O CLAUDE.md só menciona a violação da exclusion.

### Comandos e resultados
Ver T-6 (rodados juntos no fechamento).

## T-6 — Documentação e fechamento

Estado: concluída (sem commit).

### Arquivos alterados
| Arquivo | Mudança |
|---|---|
| `README.md` | Seção "Banco de teste e migrações" reescrita como "Banco de teste: template por execução e uma base por worker". Cobre: base administrativa; fluxo `globalSetup` → `setupFiles` → teardown; execuções simultâneas permitidas (removida a limitação antiga "Não rode duas execuções…"); `maxWorkers` 4; `CREATEDB` (e requisitos da CI); limite de 46 caracteres; fórmula de conexões e `53300` → `docker compose stop app worker`; sessão de superusuário bloqueia o reset com papel restrito (`42501`); depuração, varredura de 6 h e limpeza manual; teste único; laço do CA-6; fábricas e `auth.ts`. Nova seção "Escopo de salão no servidor": repositórios, regra de lint, `defineAcao`, `exigirContexto` e convenção `*.acao.ts`. A seção "Migrações" foi mantida. Nota do initdb: o harness exige até 46 caracteres. |
| `CLAUDE.md` (só a tabela "Comandos e cobertura") | "Só o PostgreSQL": a base de `TEST_DATABASE_URL` é só administrativa. "Só integração": template/worker, até 4 workers, limite de 46, `CREATEDB`, execuções simultâneas. "Teste único": exemplo de integração. Nova linha "Concorrência (CA-6 da D-005)" com o laço. |
| `docs/demandas/D-005/dev.md` | Seções T-5 e T-6. |

### Comandos e resultados (Node v24.21.0, PostgreSQL do compose; `DATABASE_URL`/`TEST_DATABASE_URL` exportadas com os valores do `.env.example`, sem `.env`)
| Comando | Resultado |
|---|---|
| `npm run typecheck` | passou (inclui os 8 `@ts-expect-error` do CA-13 e do CA-4) |
| `npm run lint` | passou (0 avisos; nenhum `eslint-disable` fora de `src/generated`) |
| `npm run build` | passou |
| `env -u DATABASE_URL -u TEST_DATABASE_URL npm run test:unit` | passou: 22 arquivos, 83 testes (sem banco) |
| `npm run test:integration` (2 vezes seguidas) | passou nas duas: 24 arquivos, 323 testes (19,8 s e 12,7 s) |
| `SELECT count(*) FROM pg_database WHERE datname ~ '_r[0-9a-z]{10}_'` depois | 0 |
| `npm test` | passou: 46 arquivos, 406 testes |
| `npm run test:coverage` | passou: 46 arquivos, 406 testes. **Linhas 100% (297/297)**, statements 100%, funções 100%, ramos 99,33% (o único ramo não coberto é `src/worker/stub.ts:20`, anterior a esta demanda). Era 78,45%. |
| `npm run test:e2e` (porta 3000 livre; o `app` do compose não estava no ar) | passou: 1 teste (`smoke.spec.ts`, viewport móvel) |
| Laço do CA-6: `for i in $(seq 10); do npx vitest run --project integration tests/integration/concorrencia --maxWorkers=2 --silent=false \|\| break; done` | **10/10 com código 0**, 8/8 testes em cada execução, 2,0 a 7,1 s. A tabela abaixo mostra os workers de cada execução. |

| Execução | `reserva-paralela-a` | `reserva-paralela-b` |
|---|---|---|
| 1 | `VITEST_POOL_ID=2` | `VITEST_POOL_ID=1` |
| 2 | 2 | 1 |
| 3 | 2 | 1 |
| 4 | 2 | 1 |
| 5 | 2 | 1 |
| 6 | 2 | 1 |
| 7 | 2 | 1 |
| 8 | 2 | 1 |
| 9 | 2 | 1 |
| 10 | 2 | 1 |

Bases correspondentes: `agenda_beleza_test_r<exec>_w2` e `_w1`, impressas pela linha `[CA-6] arquivo=… VITEST_POOL_ID=… base=…`. A variação de 2 s a 7 s vem do caso sem trava do arquivo B: quando ocorrem deadlocks, cada um custa cerca de 1 s.

### Desvios do desenho
1. **CA-6 com trava do profissional** (F-1): o desenho previa "12 `INSERT` simultâneos, exatamente 1 aceito e 11 `23P01`". Sem trava, isso não é determinístico no PostgreSQL 17 (deadlock `40P01`). As transações continuam concorrentes, e a recusa continua sendo da exclusion. O caso sem trava fica documentado e testado com a asserção que o banco garante.
2. `tests/integration/concorrencia/disputa.ts` (apoio, não é teste) está dentro da pasta de posse da T-5.
3. `criarSalaoCompleto` devolve campos além do §3.7 (`nome`, nomes e e-mails do gestor e do profissional, `servicos.nomes`, `clientes.nomeAtiva`/`telefoneAtiva`, `reserva.inicio`/`fim`). Eles servem para as asserções "nenhum dado de B" e para o CA-3. A opção `gestor.comPerfil: false` atende ao CA-10, porque só pode haver um gestor por salão (`usuario_gestor_por_salao_uniq`). `criarSessao` também devolve `sessaoId`.
4. A saída `console.info` dos testes só aparece com `--silent=false`, por isso o laço documentado usa essa opção.

### Riscos e pendências
- **F-1 → E3.2/E3.4** (arquiteto/DBA): definir trava por profissional ou tradução de `40P01` para "horário indisponível" no fluxo de reserva.
- O caso sem trava do CA-6 custa até cerca de 5 s quando há deadlocks. Ele roda em paralelo com o resto da suíte, que leva de 12 a 20 s.
- Fora da posse desta demanda e desatualizado desde a D-004: a seção "Project status" do `CLAUDE.md` ("There is no domain schema…") e a linha "Migrações" da tabela ("ainda não há migrações (E0.4)"). Não alterei.

## DEF-1 — Colisão do `exec` entre execuções iniciadas no mesmo milissegundo

Estado: corrigido (sem commit). Severidade: baixa (aberto pelo tester em `testes.md`).

### Causa
`novoExec` (`tests/support/banco.ts`) gerava 8 caracteres do relógio em ms mais 2 caracteres de `Math.random`, ou seja, 36² = 1.296 sufixos por milissegundo. Duas execuções iniciadas no mesmo ms colidiam com chance de 1 em 1.296, e a segunda falhava no `CREATE DATABASE` do template com `42P04`. Simulação do algoritmo antigo (`node`): 5.000 execs no mesmo instante geraram só 1.270 valores distintos, e houve 67 colisões em 100.000 pares.

### Correção (sem nova tentativa: a entropia basta)
O `exec` continua com **10 caracteres `[0-9a-z]`** (A-5) e casa com o mesmo padrão de órfã (`_r([0-9a-z]{10})_(tpl|w[0-9]{1,3})`). O limite de 46 caracteres do A-4 também não muda. A composição passou a ser:
- **5 caracteres do relógio em minutos**, em base 36 com `padStart`. 36⁵ minutos são cerca de 114 anos desde 1970, o que cobre até 2084; depois disso, `novoExec` lança erro em vez de gerar um nome inválido;
- **5 caracteres aleatórios** vindos de `crypto.randomInt(36⁵)`, uniforme e sem viés de módulo. São 60.466.176 sufixos.

Duas execuções só colidem se começarem no **mesmo minuto** e sortearem o mesmo sufixo: 1 em 60.466.176 por par. Antes eram 1 em 1.296 no mesmo ms.

**Idade derivável:** `instanteDoExec` = `parseInt(exec.slice(0, 5), 36) × 60.000`, ou seja, o minuto de início arredondado para baixo. Essa resolução sobra para a idade mínima de 6 h da varredura (A-6); o filtro `selecionarOrfas` não mudou.

**Transição:** um nome órfão no formato antigo (relógio em ms) decodifica como um instante no futuro, porque seus 5 primeiros caracteres valem cerca de 3,7·10⁷ minutos, contra os cerca de 3,0·10⁷ atuais. A varredura então o mantém (idade negativa), falhando para o lado seguro. Esses nomes saem pela limpeza manual do README. No ambiente local não havia nenhuma base `_r…_` (contagem 0).

Como uso `randomInt`, e não `randomBytes` em base 36 como pedido, `randomInt` evita o viés de módulo. O §2.3 e o A-5 do `dba.md` descrevem o formato antigo (8 + 2); este registro os substitui quanto à composição. O comprimento e o padrão continuam os mesmos.

### Arquivos
- `tests/support/banco.ts`:
  - import de `randomInt`;
  - constantes `DIGITOS_RELOGIO`, `DIGITOS_ALEATORIOS`, `RESOLUCAO_RELOGIO_MS` e `SUFIXOS_POSSIVEIS`;
  - `novoExec(agora, aleatorio)`, em que `aleatorio` devolve um inteiro em `[0, 36⁵)` e um valor fora dessa faixa lança erro;
  - `instanteDoExec` em minutos.
- `tests/integration/harness/banco.test.ts`: os testes de `novoExec`/`instanteDoExec` foram adaptados ao novo formato, e o auxiliar do teste da varredura agora usa 5 + 5 caracteres (os 13 casos da dba.md §9.7 continuam). Testes novos:
  - **DEF-1:** 5.000 execs no mesmo instante geram ≥ 4.990 valores distintos. O algoritmo antigo gera no máximo 1.296; o novo fica abaixo de 4.990 com probabilidade < 1e-20, porque o esperado é ≈ 0,2 colisão. Exigir 5.000 exatos falharia em cerca de 20% das execuções pelo paradoxo do aniversário, como medi numa primeira versão do teste. O teste também confere que dois execs no mesmo instante diferem, que todos compartilham o mesmo relógio e que cada uma das 5 posições aleatórias percorre os 36 símbolos;
  - **DEF-1:** o espaço de sufixos é 36⁵ = 60.466.176, e 5 + 5 = 10 caracteres;
  - **DEF-1:** um nome no formato antigo decodifica no futuro, e a varredura o mantém;
  - zeros à esquerda no relógio e no sufixo, sorteio inválido (−1, 36⁵, 1,5, NaN) recusado, relógio que não cabe em 5 caracteres recusado, e resolução de 1 min.

### Comandos e resultados (mesmo ambiente da T-6)
| Comando | Resultado |
|---|---|
| `npm run typecheck` | passou |
| `npm run lint` | passou (0 avisos) |
| `npx vitest run --project integration tests/integration/harness/banco.test.ts -t "DEF-1"`, 200 vezes seguidas | 200/200 com código 0. Fiz isso depois de a 1ª versão do teste, que exigia 5.000 exatos, falhar com 4.999 numa execução: era o paradoxo do aniversário, não defeito da correção. |
| `npm run test:integration` (3 vezes seguidas) | passou nas três: 24 arquivos, 326 testes (eram 323) |
| `npm run test:coverage` | passou: 46 arquivos, 409 testes; **linhas 100% (297/297)**, ramos 99,33% (inalterado) |
| `env -u DATABASE_URL -u TEST_DATABASE_URL npm run test:unit` | passou: 83 testes |
| `SELECT count(*) FROM pg_database WHERE datname ~ '_r[0-9a-z]{10}_'` depois | 0 |
