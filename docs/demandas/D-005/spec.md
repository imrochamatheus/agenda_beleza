# D-005 — Escopo de salão no servidor e infraestrutura de testes de integração (issue #7, E0.5)

Autor: analista-requisitos. Fontes, em ordem de precedência: `docs/demandas/D-005/issue-7.md` (RN-1..RN-5 e CA-1..CA-6 decididos), `PLAN.md` ("Perfis e acesso", critérios de aceite 1, 4 e 11), `CLAUDE.md` (invariantes "Tenant isolation", "Super admin", "Subscriptions"), `docs/demandas/D-001/{design,dba}.md` (E0.5, E0.7, E6.4, S13), `docs/demandas/D-004/{spec,design,dev}.md` (esquema entregue e a tabela "Fronteira com a E0.5"), código da branch `feat/d-005-escopo-salao` (base `1906605`, main).

Nada aqui reabre decisões da issue. As adições são (a) CAs que tornam verificáveis RNs e entregáveis da issue sem CA próprio e (b) a fronteira com E1.2, E4.1, E6.4, E7.x, E8.1 e E0.7. Cada adição está marcada com a origem.

## 1. Problema

Não existe camada de escopo de salão no servidor, e o harness de testes é de base única. Evidências:

- `src/server/tenant/`, `src/server/repos/` e `tests/support/` não existem (`ls` → "Arquivo ou diretório inexistente").
- O cliente Prisma é importável de qualquer lugar: `src/server/db.ts:3` importa `@/generated/prisma/client`; `src/app/api/health/route.ts:1` importa `obterPrisma` de `@/server/db`; `src/server/health.ts:1` importa o tipo `PrismaClient`. `eslint.config.mjs` (22 linhas) não tem `no-restricted-imports`.
- O pool do Prisma usa o padrão do driver: `src/server/db.ts:20` cria `new PrismaPg({ connectionString, connectionTimeoutMillis })` sem `max` (padrão do `pg`: 10 conexões).
- Banco de teste único: `tests/integration/support/db.ts:39-58` (`prepararBancoDeTeste`) faz `DROP SCHEMA public CASCADE` + `prisma migrate deploy` uma vez por execução, chamado pelo `globalSetup` (`vitest.config.ts:57`, `tests/integration/support/global-setup.ts`). Não há reset entre arquivos nem base por worker.
- Os helpers de dados são SQL manual e mínimos: `tests/integration/support/sql.ts:8` ("As fábricas completas de dois salões são da E0.5").
- Limitação documentada: `README.md:64` ("Não rode duas execuções de testes de integração ao mesmo tempo sobre a mesma base"); D-004/dev.md R-4.
- pg-boss não está instalado (`package.json` sem `pg-boss`; `src/worker/stub.ts:3`: "Stub do worker até a E0.7 (pg-boss). Não acessa o banco.").
- A defesa no banco já existe (D-004 CA-9): FKs compostas `(salao_id, x_id)` em todas as tabelas filhas (`prisma/schema.prisma`, p.ex. `Reserva` com `@@unique([salaoId, id])` e relações compostas). Ela impede **gravar** referência cruzada, mas não impede **ler** ou **alterar** por ID uma linha de outro salão.

Consequência: a invariante "Tenant isolation is enforced on the server" do `CLAUDE.md` e o critério 11 do `PLAN.md` ("testes automatizados para isolamento entre salões") não têm garantia nem teste na camada de aplicação.

## 2. Objetivo

Toda leitura e escrita autenticada passa por um wrapper (`defineAcao`) que obtém o salão **da sessão no servidor**, e por repositórios que só operam com um contexto e aplicam `salao_id` em cada consulta. Um recurso de outro salão é indistinguível de um inexistente. O lint impede contornar os repositórios. Os testes de integração de todas as demandas seguintes ganham fábricas de dois salões completos, contexto autenticado e uma base isolada por worker, recriada por arquivo a partir de um template, apta a testes de concorrência reais.

## 3. Escopo

### Entra
1. **Contextos** (`src/server/tenant/context.ts`): `TenantContext` (usuarioId, papel, salaoId, profissionalId opcional), `PublicoContext` (salão resolvido por slug), `SistemaContext` (processos sem usuário, p.ex. worker, com salaoId explícito) e `AdminContext` (super admin). Erros de domínio `NaoEncontrado` e `AcessoNegado` (mais `NaoAutenticado`, ver S-3) e o mapeamento erro → status HTTP.
2. **`defineAcao({ papeis, capacidade }, handler)`** (`src/server/tenant/define-acao.ts`): núcleo testável sem `next/headers` (recebe a sessão/credencial resolvida por injeção), validação de sessão e papel, montagem do `TenantContext`, consulta à **política de operação plugável** por capacidade (padrão: permitir), metadados de registro (papeis e capacidade legíveis em tempo de execução). Adaptador `exigirContexto()` para Server Components, que lê o cookie de sessão por `next/headers`.
3. **Resolução de sessão** a partir da tabela `sessao` existente: token do cookie → hash → linha válida (não expirada, não revogada) → usuário e papel → salão. Ver a fronteira com E1.2.
4. **Repositórios** (`src/server/repos/**`) dos agregados do CA-1: `servico`, `profissional`, `cliente`, `reserva`. Cada operação exige contexto; leitura por ID, listagem e ao menos uma mutação por ID por agregado (a escolha da mutação é do arquiteto, sem antecipar regra de negócio de E2/E3/E5). Recurso de outro salão → `NaoEncontrado`.
5. **Leituras públicas mínimas** por `PublicoContext`: resolver o salão pelo slug e listar serviços e profissionais **ativos** com campos públicos (RN-3).
6. **Unidade de trabalho** (`src/server/repos/transacao.ts`): uma transação compartilhada entre repositórios.
7. **Regra ESLint `no-restricted-imports`**: proíbe importar o cliente Prisma fora de `src/server/repos/**`, `src/worker/**` e `prisma/seed.ts`; `tests/**` liberado. Os importadores atuais fora dessas pastas (`src/server/db.ts`, `src/server/health.ts`, `src/app/api/health/route.ts`) são realocados ou adaptados para que o lint passe sem `eslint-disable` dessa regra.
8. **Convenção `*.acao.ts`** e teste de registro que as carrega por `import.meta.glob` e falha se alguma exportação não declarar capacidade válida.
9. **Infraestrutura de testes** (evolui o harness da E0.4):
   - `tests/support/db.ts`: template database criado uma vez por execução (migrações aplicadas; ponto de extensão para o schema `pgboss`, ver RN-12), uma base por worker do Vitest por `CREATE DATABASE … TEMPLATE`, reset entre arquivos por recriação a partir do template (sem `TRUNCATE`), pool configurável ≥ requisições paralelas, guarda contra a base de desenvolvimento e bases de sistema.
   - `tests/support/factories.ts`: dois salões completos via Prisma, sem SQL manual no teste.
   - `tests/support/auth.ts`: cria usuário + sessão real e devolve o contexto/credencial autenticado de gestor, profissional e super admin.
   - Migração dos testes de integração existentes (`tests/integration/**`) para a base do worker.
10. **Testes**: `tests/integration/tenant/isolamento.test.ts` (CA-1..CA-3), teste de registro de ações (CA-4), teste do lint (CA-5), dois arquivos de concorrência (CA-6) e os CAs complementares abaixo.
11. **README**: nova estratégia de banco de teste (template, base por worker, privilégio `CREATEDB`), remoção/atualização da limitação de `README.md:64` se deixar de valer, e a convenção `*.acao.ts`.

### Fica fora
- Tudo de "Fora da primeira versão" do `PLAN.md` / "Out of scope for v1" do `CLAUDE.md`. Nenhuma tabela ou coluna nova é esperada (ver §8).
- RLS no PostgreSQL (descartado na v1, D-001/dba.md E0.5 "Defesa em profundidade").
- Extensão do Prisma que injeta `salao_id` automaticamente como mecanismo único (descartada, D-001/design.md:17).
- Telas, formulários e server actions de produto (cadastros de E2.x, agenda de E3.x, página pública de E4.1).

### Fronteira com outras demandas
| Tema | E0.5 (esta demanda) | Demanda futura |
|---|---|---|
| Sessão | Valida uma sessão existente na tabela `sessao` (hash do token, expiração, revogação) e monta o contexto. Define o nome do cookie e o algoritmo de hash como constantes reutilizáveis | **E1.2**: login, logout, criação e renovação da sessão, `ultimo_uso_em`, rate limit de login, confirmação de e-mail, permissões finas por papel |
| Escopo do profissional | `TenantContext.profissionalId` preenchido quando o usuário tem perfil de profissional vinculado | **E1.2 / E3.3–E3.5 / E2.4**: "profissional só vê e altera a própria agenda e os próprios bloqueios" |
| Política de operação | Interface plugável + padrão "permite tudo"; teste de que a política é consultada com a capacidade declarada | **E6.4**: política real por estado da assinatura (tabela S13 de D-001/design.md §5) |
| Super admin | Tipo `AdminContext`, obtido só por sessão de `super_admin` com TOTP verificado; não aceito pelos repositórios de tenant | **E8.1**: ações do painel, `registrarAuditoria` na mesma transação; **E1.5**: login com TOTP |
| Página pública | Resolução do salão por slug (atual ou histórico) e leituras públicas mínimas | **E4.1**: redirecionamento 301 do slug antigo, página; **E3.1**: horários disponíveis |
| Fila | Ponto de extensão no preparo do template para inicializar schemas extras antes da cópia | **E0.7**: instala `pg-boss` (versão exata) e pluga `boss.start()`/`stop()` no preparo do template |
| CI | Comandos inalterados (`npm run test:integration`, `test:coverage`) | **E0.3**: executa na CI com usuário de banco com `CREATEDB` |

## 4. Regras de negócio

Da issue (decididas):
- **RN-1**: o `salao_id` vem sempre da sessão no servidor, nunca de parâmetro do cliente.
- **RN-2**: acesso a recurso de outro salão responde como inexistente (`NaoEncontrado`/404), sem revelar existência.
- **RN-3**: rotas públicas resolvem o salão pelo slug e expõem apenas dados públicos (serviços e profissionais ativos, horários).
- **RN-4**: o super admin usa um contexto próprio, explícito e auditado (E8.1).
- **RN-5**: toda ação mutável declara uma capacidade: `configurar`, `agendar`, `cancelar`, `assinatura` ou `lgpd`.

Complementares (derivadas da issue, do PLAN, do CLAUDE.md e de D-001):
- **RN-6** (issue "Escopo"; D-001/design.md:12): `capacidade` é obrigatória no tipo de `defineAcao` para **toda** ação. Ações só de leitura declaram `leitura` (sexto valor, conforme a tabela S13 de D-001/design.md §5); mutações usam um dos cinco valores da RN-5.
- **RN-7** (issue "Escopo"): `defineAcao` executa, nesta ordem: resolver sessão → verificar papel em `papeis` → montar contexto → consultar a política com (contexto, capacidade) → executar o handler. Qualquer recusa interrompe antes do handler, sem efeito no banco.
- **RN-8** (issue "Escopo"; RN-1): toda operação de repositório recebe um contexto como primeiro argumento e filtra por `contexto.salaoId` na própria consulta (leitura) ou no predicado da escrita (`WHERE salao_id = $ctx AND id = $id`). Nunca recebe `salaoId` solto vindo de entrada.
- **RN-9** (RN-2): "não encontrado" é uma resposta única: ID inexistente, ID de outro salão e ID malformado (não UUID) produzem o mesmo erro, status e corpo.
- **RN-10** (issue "Entregáveis"; D-001/design.md:17): o cliente Prisma (`@/generated/prisma/**`, `@prisma/client`, `@prisma/adapter-pg` e o módulo que expõe a instância) só é importado em `src/server/repos/**`, `src/worker/**`, `prisma/seed.ts` e `tests/**`. Imports só de tipo (`import type`) seguem a S-6.
- **RN-11** (CLAUDE.md "Super admin"; RN-4): `AdminContext` exige papel `super_admin` e sessão com `totp_verificado_em` preenchido; um usuário `super_admin` não obtém `TenantContext` (não tem salão) e um usuário de salão não obtém `AdminContext`.
- **RN-12** (issue "Escopo"; D-001/dba.md E0.5 e E0.7): o template é preparado uma vez por execução, sem conexões abertas no momento da cópia; schemas além de `public` presentes no template (como o futuro `pgboss`) são copiados para cada base de worker. A inicialização efetiva do `pgboss` é plugada pela E0.7 (ver D-1).
- **RN-13** (D-004 RN-9/RN-13a; D-003/dba.md A-2): os testes usam só `TEST_DATABASE_URL` como ponto de partida; nenhuma base criada, recriada ou apagada pelo harness pode ter o nome da base de `DATABASE_URL` nem ser `postgres`, `template0` ou `template1`; nomes derivados respeitam `[a-z0-9_]{1,63}`.
- **RN-14** (D-001/dba.md E0.5 "Reset"): proibidos no harness `TRUNCATE`, `migrate reset`, `db push` e "transação por teste com rollback" (os testes de concorrência precisam de transações confirmadas).
- **RN-15** (issue "Escopo"; D-001/dba.md E0.5 "Pool"): o pool de conexões usado pelos testes de concorrência é configurável e ≥ ao número de requisições paralelas do teste; o padrão do harness atende ao maior teste paralelo previsto (12, CA-2 de E3.2).
- **RN-16** (CLAUDE.md "Soft deletes"; PLAN "Perfis e acesso"): repositórios de equipe enxergam também registros inativos e clientes anonimizadas do próprio salão (histórico); as leituras públicas enxergam só serviços e profissionais ativos.

## 5. Critérios de aceitação

Convenções: "salão A" e "salão B" vêm das fábricas (CA-3). "Pela ação" = chamada do núcleo de `defineAcao` com a credencial de `tests/support/auth.ts`, sem `next/headers`. "Status HTTP" = resultado do mapeamento erro → status do item 1 do §3. Todos os testes de integração rodam contra PostgreSQL real.

### CAs da issue (CA-1..CA-6), com o modo de verificação
- **CA-1** (PLAN CA 1 e 11; RN-2): Dado o gestor do salão A autenticado, quando ele requisita por ID um serviço, profissional, cliente ou agendamento do salão B, então recebe 404 e nenhum dado de B.
  - Verificação: `tests/integration/tenant/isolamento.test.ts`, um caso por agregado; o erro é `NaoEncontrado`, o status mapeado é 404, e o corpo/mensagem não contém nenhum valor de B (id, nome, telefone).
- **CA-2** (RN-2, RN-8): Dado o gestor do salão A, quando tenta alterar um recurso do salão B informando o ID, então a alteração não ocorre e o registro de B permanece igual no banco.
  - Verificação: um caso por agregado; antes e depois, a linha de B lida por SQL direto é idêntica (todas as colunas, inclusive `atualizado_em`), e a ação devolve `NaoEncontrado`/404.
- **CA-3**: Dado um teste de integração novo, quando ele usa as fábricas, então obtém dois salões completos sem SQL manual.
  - "Completo" = por salão: salão com slug atual; gestor (usuário confirmado) com perfil de profissional vinculado; um profissional com usuário próprio (papel `profissional`); um profissional inativo; ao menos dois serviços ativos e um inativo, com vínculos em `servico_profissional`; jornada semanal; um bloqueio; uma cliente ativa e uma anonimizada; uma reserva `confirmado` com itens (snapshot de preço e duração). A fábrica aceita sobrescrever campos e devolve os IDs.
  - Verificação: o próprio `isolamento.test.ts` usa só as fábricas; um teste das fábricas confere por consulta que cada elemento acima existe e pertence ao salão certo; `grep` em `isolamento.test.ts` não encontra `INSERT`, `$executeRaw` nem `$queryRaw`.
- **CA-4** (RN-5, RN-6): Dado o registro de ações, quando o teste percorre todas as ações mutáveis, então cada uma declara capacidade; uma ação sem capacidade faz o teste falhar.
  - Verificação: o teste carrega `src/**/*.acao.ts` por `import.meta.glob` e exige que toda exportação seja produto de `defineAcao` com capacidade no conjunto válido. A função verificadora também é exercitada contra fixtures de teste (uma ação válida, uma sem capacidade, uma exportação que não passou por `defineAcao`, uma com capacidade fora do conjunto), e acusa as três inválidas pelo nome. Isso evita o teste vacuamente verde enquanto não houver ações de produto (S-4).
- **CA-5** (RN-10): Dado um arquivo fora dos repositórios que importa o cliente Prisma, quando se executa o lint, então ele falha.
  - Verificação automatizada: teste com a API do ESLint (`lintText` com `filePath` simulado) mostra erro `no-restricted-imports` para `src/app/x.ts` e `src/server/tenant/x.ts` importando `@/generated/prisma/client`, `@prisma/client`, o módulo da instância e um caminho relativo equivalente; e nenhum erro para `src/server/repos/x.ts`, `src/worker/x.ts`, `prisma/seed.ts` e `tests/x.test.ts`.
  - Verificação manual (tester): criar temporariamente `src/app/viola.ts` com o import → `npm run lint` termina com código ≠ 0 citando a regra; remover o arquivo.
- **CA-6** (RN-12..RN-15): Dado dois arquivos de teste de concorrência executando em workers paralelos, quando rodam juntos, então nenhum vê dados do outro e ambos passam de forma determinística em 10 execuções seguidas.
  - Verificação: dois arquivos em `tests/integration/` que, cada um, criam o próprio cenário, disparam N ≥ 10 transações concorrentes sobre o mesmo profissional e horário (exatamente 1 aceita, N−1 recusadas por `23P01`/`reserva_sem_sobreposicao`), e conferem que `salao` contém só os salões criados pelo próprio arquivo. Registro do tester em `testes.md`: laço de 10 execuções de `npm run test:integration` (ou só desses dois arquivos com ≥ 2 workers), todas com código 0, e evidência de que os dois arquivos rodaram em workers distintos (p.ex. `VITEST_POOL_ID` ou nome da base registrados).

### CAs complementares (tornam verificáveis RNs e entregáveis da issue sem CA próprio)
- **CA-7** (RN-1, RN-8): Dado o gestor do salão A, quando chama uma ação passando no input um `salaoId` de B (campo extra), então o resultado é o mesmo que sem o campo: opera só sobre A; e uma listagem (serviços, profissionais, clientes, reservas) devolve apenas registros de A.
- **CA-8** (RN-9): Dado o gestor do salão A, quando requisita por ID (i) um UUID inexistente, (ii) um ID do salão B e (iii) um texto que não é UUID, então os três resultados são idênticos (`NaoEncontrado`, 404, mesmo corpo) e nenhum gera erro 500 ou SQLSTATE do driver (p.ex. `22P02`).
- **CA-9** (RN-7; issue "valida sessão e papel"): Dado uma ação com `papeis: ['gestor']`, quando chamada (a) sem sessão, (b) com token desconhecido, (c) com sessão expirada, (d) com sessão revogada, então responde `NaoAutenticado`/401 e o handler não executa; quando chamada (e) por um usuário `profissional` ou (f) por um `super_admin`, então responde `AcessoNegado`/403 e o handler não executa.
- **CA-10** (RN-7; issue "monta o TenantContext"): Dado o gestor com perfil de profissional vinculado e um profissional com usuário, quando cada um chama uma ação permitida ao seu papel, então o handler recebe `TenantContext` com `usuarioId`, `papel` e `salaoId` da sessão e `profissionalId` do perfil vinculado; para o gestor sem perfil vinculado, `profissionalId` é nulo/ausente.
- **CA-11** (issue "política de operação plugável"; RN-7): Dado a política padrão, quando qualquer ação é chamada, então é permitida; dado uma política de teste que nega a capacidade `agendar`, quando uma ação `agendar` é chamada, então responde `AcessoNegado`/403, o handler não executa e o banco não muda, enquanto uma ação `cancelar` continua permitida; a política recebe o contexto e a capacidade declarada.
- **CA-12** (RN-3, RN-16): Dado o slug atual do salão A, quando se resolve o `PublicoContext` e se listam serviços e profissionais, então vêm só os **ativos** de A, com campos públicos (serviço: id, nome, preço, duração; profissional: id, nome), sem `email`, `usuario_id` nem dado de cliente/reserva; um slug inexistente → `NaoEncontrado`/404; um slug histórico de A resolve o mesmo salão e informa o slug atual (o redirecionamento é da E4.1).
- **CA-13** (RN-4, RN-11): Dado um `super_admin` com sessão sem `totp_verificado_em`, quando se tenta obter `AdminContext`, então é recusado; com TOTP verificado, é obtido; um gestor nunca obtém `AdminContext`. Passar `AdminContext` ou `PublicoContext` a uma operação de repositório de tenant é erro de tipo (verificado por `// @ts-expect-error` num arquivo de teste coberto pelo `npm run typecheck`).
- **CA-14** (entregável `transacao.ts`): Dado uma unidade de trabalho que altera um registro por um repositório e depois falha (erro lançado) numa operação de outro repositório, quando executada, então nenhuma das alterações persiste; sem falha, ambas persistem.
- **CA-15** (RN-12, RN-14; issue "reset entre arquivos"): Dado qualquer arquivo de teste de integração, quando ele começa, então a base do worker não contém dados de arquivos anteriores (p.ex. `salao` vazio) e as migrações estão aplicadas; e um schema extra criado no template pelo ponto de extensão (schema de prova no teste do harness, futuro `pgboss`) existe na base do worker.
- **CA-16** (RN-15): Dado o pool configurado do harness, quando o teste dispara N ≥ 10 consultas simultâneas que seguram a conexão (p.ex. `pg_sleep`), então o PostgreSQL registra N conexões/backends distintos ativos ao mesmo tempo (`pg_stat_activity`), provando que não houve serialização no pool.
- **CA-17** (RN-13): Dado `TEST_DATABASE_URL` ausente, ou com o mesmo nome de base de `DATABASE_URL`, ou um nome derivado que colida com a base de desenvolvimento ou de sistema, quando o harness inicia, então falha antes de criar ou apagar qualquer base, com mensagem que nomeia a variável (sem credenciais).
- **CA-18** (entregável `exigirContexto()`): Dado um Server Component que chama `exigirContexto()`, quando o cookie de sessão é válido, então obtém o `TenantContext`; sem cookie ou com sessão inválida, então recebe `NaoAutenticado`. Verificação por teste unitário com `next/headers` substituído (substituir `next/headers` não é mock de banco; a sessão é lida do PostgreSQL real no teste de integração do núcleo).
- **CA-19** (Definição de pronto): os testes de integração da E0.4 (`tests/integration/db/**`, `health.test.ts`) continuam passando na base do worker; `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` e `npm run test:coverage` (≥ 90% de linhas) passam, sem `eslint-disable` de `no-restricted-imports` e sem novas exclusões de cobertura.

### Relação com o PLAN
- PLAN CA 1 ("sem acessar dados um do outro"): CA-1, CA-2, CA-7, CA-8, CA-12.
- PLAN CA 4 ("veem apenas as agendas permitidas"): base em CA-9 e CA-10; o recorte por profissional é de E1.2/E3.x.
- PLAN CA 11 ("testes automatizados para isolamento entre salões, concorrência"): CA-1..CA-3, CA-6, CA-15, CA-16.
- PLAN "suspenso somente leitura" e CLAUDE.md "Subscriptions": viabilizado por CA-4 e CA-11; regra real em E6.4.

## 6. Casos limite
- **ID de outro salão vs. inexistente vs. malformado**: indistinguíveis (CA-8). Inclui tempo de resposta? Não exigido na v1 (S-7).
- **Mutação por ID de outro salão**: o predicado inclui `salao_id`, então 0 linhas afetadas → `NaoEncontrado`; nunca "atualiza e depois verifica" (CA-2).
- **Referências cruzadas no input** (p.ex. reserva de A apontando para profissional de B): a FK composta da E0.4 já rejeita; o repositório deve traduzir para `NaoEncontrado`, não 500. Só se aplica às mutações que a E0.5 expuser.
- **`salaoId` injetado no input**: ignorado (CA-7).
- **Super admin** chamando ação de tenant: `AcessoNegado` (CA-9f); sem TOTP não obtém `AdminContext` (CA-13).
- **Gestor que também é profissional**: `profissionalId` preenchido (CA-10).
- **Sessão expirada no limite** (`expira_em` = agora): tratar como expirada (`expira_em > now()` é a condição de validade).
- **Salão suspenso**: a política padrão permite; nada muda na E0.5 (E6.4).
- **Cliente anonimizada**: o repositório de equipe a devolve com nome/telefone nulos (a exibição "cliente removida" é da UI/E5.2); não aparece nas leituras públicas (que não expõem clientes).
- **Profissional/serviço inativo**: visível à equipe, invisível ao público (RN-16, CA-12).
- **Slug histórico**: resolve o salão atual (CA-12); slug com maiúsculas/espaços: tratado como inexistente se não bater exatamente (normalização é da E1.1/E4.1).
- **Fuso e virada de dia**: não se aplica à lógica desta demanda; as fábricas gravam instantes em UTC (sufixo `Z`) e devem gerar reservas em datas futuras relativas ao relógio para não violar regras futuras de antecedência.
- **Concorrência**: dois arquivos em workers distintos (CA-6); pool insuficiente mascararia o teste (CA-16).
- **Template com conexão aberta**: `CREATE DATABASE … TEMPLATE` falha com `55006`; o harness fecha Prisma/pg (e, na E0.7, o pg-boss) antes da cópia.
- **Base de worker com conexões penduradas no reset**: a recriação precisa encerrá-las (`DROP DATABASE … WITH (FORCE)` ou equivalente) sem afetar outros workers.
- **Execuções simultâneas da suíte no mesmo servidor** (D-004 R-4): ver S-8.
- **Telefone não brasileiro / entradas inválidas**: as fábricas só geram E.164 BR válido (o CHECK da E0.4 rejeita o resto); validação de entrada de telefone é da E5.1.
- **Caminho com espaço e acento**: o harness não usa shell e resolve caminhos com `fileURLToPath` (padrão já adotado em `tests/integration/support/db.ts:9-10`).

## 7. Dependências
- **Bloqueada por**: #6 (E0.4), mesclada em `1906605`: esquema, FKs compostas, tabela `sessao`, exclusion constraint.
- **Bloqueia**: #12 (E1.2), #33 (E4.3), #40 (E6.3), #23 (E8.1).
- **Integrações** (Mercado Pago, WhatsApp, e-mail, Turnstile): não se aplicam.
- **pg-boss / E0.7**: não instalado; esta demanda deixa o ponto de extensão (D-1).
- **Infraestrutura**: PostgreSQL do compose; o usuário do banco de teste precisa de `CREATEDB` (local: o `POSTGRES_USER` da imagem oficial é superusuário; CI: E0.3, #5).

## 8. Impactos prováveis
- **Dados**: nenhuma migração nova esperada (sessão, FKs compostas e índices já existem). Se o desenho precisar de índice para a consulta de sessão por `token_hash`, ele já existe (`@unique`). DBA: revisar a estratégia template/base por worker, `WITH (FORCE)`, nomes derivados e o pool (D-001/dba.md E0.5 já aprovou a linha geral).
- **Infra/CI**: sem mudança em `docker-compose.yml` em princípio; `vitest.config.ts` muda (globalSetup, setupFiles do projeto `integration`, paralelismo/workers, possivelmente `include` de `tests/support/**`); `eslint.config.mjs` ganha a regra; README atualizado. A E0.3 precisa de `CREATEDB` e de rodar com ≥ 2 workers. DevOps: avaliar se a CI (ainda inexistente) herda algo; provável dispensa com registro.
- **Código existente**: `src/server/db.ts`, `src/server/health.ts`, `src/app/api/health/route.ts` e `tests/integration/**` (troca de `urlBancoDeTeste()` pela base do worker) mudam; `tests/integration/support/*` evolui ou migra para `tests/support/*`.
- **Cobertura**: `src/server/tenant/**` e `src/server/repos/**` entram no gate de 90%.

## 9. Dúvidas e suposições

### Bloqueantes
Nenhuma.

### Decisões tomadas (não bloqueantes), para o arquiteto confirmar
- **D-1 — schema `pgboss` no template** (pedido da issue; pg-boss não está instalado): a E0.5 **não** instala `pg-boss`. Entrega no preparo do template um ponto de extensão "inicializadores de schema" executados após o `migrate deploy` e antes da cópia, com conexões fechadas, e prova por CA-15 que um schema extra criado ali chega à base de cada worker. A E0.7 registra o inicializador `boss.start()`/`stop()` com a versão exata fixada. Motivo: instalar pg-boss aqui anteciparia decisões da E0.7 (versão, configuração, worker) e criaria dependência sem uso; criar um schema `pgboss` vazio não reproduz o estado real. Alternativa, se o líder/usuário preferir a literalidade da issue: instalar `pg-boss` (versão exata) só como dependência do harness e rodar `start()/stop()` já na E0.5.
- **S-1 — local do harness**: segue a issue, `tests/support/{db,factories,auth}.ts`, absorvendo `tests/integration/support/*` (os helpers `sql.ts` da E0.4 podem permanecer para os testes de constraint). O arquiteto pode manter o local antigo se registrar o motivo.
- **S-2 — sessão**: a E0.5 lê sessões da tabela `sessao` por hash do token do cookie (algoritmo e nome do cookie definidos aqui como constantes); `tests/support/auth.ts` cria usuário + sessão reais. A criação de sessão por login é da E1.2.
- **S-3 — erro sem sessão**: além de `AcessoNegado` e `NaoEncontrado` (issue), um `NaoAutenticado` → 401 para ausência/invalidade de sessão; `AcessoNegado` → 403; `NaoEncontrado` → 404. Se o arquiteto preferir só dois erros, `AcessoNegado` com motivo distinto e o mesmo mapeamento 401/403 atende aos CAs.
- **S-4 — ações de produto**: a E0.5 não cria `*.acao.ts` de produto; CA-1/CA-2 exercitam o núcleo de `defineAcao` com handlers definidos nos testes que chamam os repositórios reais. A verificação do registro é provada contra fixtures (CA-4). As demandas E2.x/E3.x criam as ações reais e o registro passa a cobri-las automaticamente.
- **S-5 — capacidade `leitura`**: adotada como sexto valor para ações só de leitura (D-001/design.md:12 e tabela S13); não altera a RN-5, que trata das mutáveis. A distinção leitura/mutação é declarativa (não há detecção automática de que um handler escreve); revisão de código e E6.4 cobrem o desvio.
- **S-6 — `import type`**: imports só de tipo do cliente Prisma fora dos repositórios são permitidos (não abrem conexão nem permitem consulta). Enums do Prisma usados como valor fora dos repositórios devem ser reexportados por um módulo de tipos/domínio dentro de `src/server/repos/**` ou duplicados como união literal; decisão final do arquiteto.
- **S-7 — canal lateral de tempo**: não se exige tempo de resposta igual entre "inexistente" e "de outro salão" na v1 (IDs são UUID v4 aleatórios).
- **S-8 — execuções simultâneas da suíte**: nomes derivados por execução (com limpeza das bases ao fim) são desejáveis; se o desenho mantiver nomes fixos por worker, a limitação de `README.md:64` permanece documentada. Não bloqueia os CAs (o CA-6 é sobre workers da mesma execução).
- **S-9 — mutação mínima por agregado**: o arquiteto escolhe uma mutação neutra por agregado (p.ex. desativar serviço/profissional, alterar nome de cliente ativa) desde que não implemente regra de negócio de outra demanda (notificação, máquina de status, anonimização). Cancelar ou remarcar reserva **não** é neutro (dispara WhatsApp pela invariante do CLAUDE.md e é da E3.5); para `reserva`, a mutação fica só no repositório (sem ação de produto) e é exercitada pelo teste.
