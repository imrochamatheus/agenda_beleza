# D-004 — Especificação: esquema Prisma base e constraint anti-sobreposição (issue #6, E0.4)

Autor: analista-requisitos. Fontes, por precedência: `docs/demandas/D-004/issue-6.md` (issue aprovada), `docs/demandas/D-001/dba.md` §1/E0.4, `docs/demandas/D-001/design.md` (§1.3, §5/S1, JSON `E0.4`), `docs/demandas/D-001/spec.md` (E0.4, convenções e Gate padrão), `PLAN.md`, `CLAUDE.md`, `docs/demandas/D-003/{dba,dev}.md` (notas para a E0.4).
Nada aqui reabre decisões: as RN-1..RN-11 e os CA-1..CA-13 são os da issue. As adições são (a) CAs que tornam verificáveis RNs da issue que não tinham CA e (b) a fronteira de infraestrutura de teste com a E0.5. Cada adição está marcada com a origem.

## 1. Problema

O banco não tem modelo de domínio. Evidências na branch `feat/d-004-esquema-prisma` (base: `189f178`, main):
- `prisma/schema.prisma:1-11`: só `generator client` (saída `../src/generated/prisma`) e `datasource db`; nenhum `model`.
- `prisma/migrations/` não existe (`ls prisma` → só `schema.prisma`). O `migrate deploy` atual só cria `_prisma_migrations` (D-003/dba.md §4).
- `src/generated/prisma/models/` está vazio.
- Infraestrutura de teste existente: projeto Vitest `integration` (`vitest.config.ts:47-54`, `tests/integration/**/*.test.ts`), sem `globalSetup`; guarda `urlBancoDeTeste()` em `tests/integration/support/banco.ts:14-29` (exige `TEST_DATABASE_URL` e recusa a mesma base de `DATABASE_URL` pelo nome); único teste de integração: `tests/integration/health.test.ts` (`SELECT 1`).
- O cliente é criado por `criarPrisma(url)` / `obterPrisma(url)` em `src/server/db.ts:19-41` (Prisma 7.10.1 + `@prisma/adapter-pg`).
- Não há CI de testes: `.github/workflows/` só tem `claude.yml` e `claude-code-review.yml`; a issue #5 (E0.3, CI) está aberta.

Consequência: nenhuma das invariantes "No double booking is guaranteed by the database", "Tenant isolation" (defesa no banco), "Soft deletes" e "Clients … E.164" do `CLAUDE.md` tem hoje garantia física.

## 2. Objetivo

Entregar o esquema de dados da v1 (Prisma + migrações SQL) em que o próprio PostgreSQL rejeita: reserva ativa sobreposta do mesmo profissional, referência cruzada entre salões, cliente com anonimização incoerente ou telefone fora do E.164 BR, slug duplicado, jornada sobreposta, alteração da auditoria; e que o Prisma não acuse drift sobre esses objetos. É a base de que dependem E0.5, E0.6 e E0.7.

## 3. Escopo

### Entra
1. `prisma/schema.prisma` com os models abaixo, nomes físicos em snake_case via `@@map`/`@map` (D-001/dba.md item 11). Lista mínima de tabelas (o nome físico pode ser ajustado pelo DBA desde que registrado em `dba.md`; o CA-1 usa a lista final):
   `salao`, `salao_slug`, `usuario`, `sessao`, `profissional`, `servico`, `servico_profissional`, `jornada`, `bloqueio`, `cliente`, `consentimento`, `reserva`, `reserva_item`, `assinatura`, `assinatura_pagamento`, `assinatura_transicao`, `webhook_evento`, `mensagem`, `mensagem_tentativa`, `email_log`, `rate_limit_janela`, `convite`, `token`, `auditoria`.
2. Colunas exigidas explicitamente pela issue e pelo DBA (D-001/dba.md E0.4, E4.2, E6.2, E6.3, E7.1, E8.1): `salao.suspenso_manual_em`, configurações do salão com `DEFAULT` no banco (`fuso 'America/Sao_Paulo'`, `grade_min 15`, `antecedencia_min 120`, `janela_dias 60`, `intervalo_min 0`); `reserva.revisao`, `reserva.ocupado_ate`, `reserva.chave_requisicao` (anulável), `reserva.atualizado_em`; `cliente.anonimizada_em`; `profissional.ativo`, `servico.ativo`; snapshot de preço (centavos `int`) e duração (min) em `reserva_item`; estados de `mensagem` incluindo `enviando`; estados de `assinatura` (`pendente`, `em_teste`, `ativa`, `em_carencia`, `suspensa`, `cancelada`, `encerrada`); `rate_limit_janela(chave, janela_inicio, contador)` com PK composta.
3. Migração `*_init` (gerada pelo Prisma) e migração(ões) SQL bruta(s) com: `CREATE EXTENSION IF NOT EXISTS btree_gist`; `reserva_sem_sobreposicao`; CHECK de ordem da reserva; exclusion `int4range` da jornada; CHECKs (cliente, E.164, slug, e-mail minúsculo, papel × salão, faixas de jornada, dinheiro/duração, bloqueio); índices parciais/únicos que o Prisma não expressa; função e triggers append-only.
4. Infraestrutura de teste **mínima** para provar os CAs desta demanda (ver RN-13 e §3 "Fronteira com a E0.5").
5. `docs/demandas/D-004/dba.md` com o parecer do DBA (entregável da issue).

### Fica fora
- Tudo o que está em "Fora da primeira versão" do `PLAN.md` / "Out of scope for v1" do `CLAUDE.md`: nenhuma tabela ou coluna de caixa, estoque, comissões, relatórios financeiros, fidelidade, pagamento de cliente, conta de cliente, lembretes, mensagens promocionais, agendamento via WhatsApp, vários gestores por salão, preço/duração por profissional. Nenhuma coluna de dados de cartão (D-001/dba.md item 13).
- Lógica de aplicação: tradução de `23P01` para "horário indisponível" (E3.2), cálculo de disponibilidade (E3.1), repositórios e `TenantContext` (E0.5), adaptadores (E0.6), pg-boss e schema `pgboss` (E0.7), seed (E9.2).
- CHECKs de faixa das configurações do salão (aguardam E2.5 RN-1; D-001/dba.md item 8).
- Execução do teste de drift na CI: a CI de testes é a E0.3 (#5, aberta). Esta demanda entrega o teste; a E0.3 o executa.

### Fronteira com a E0.5 (#7)
| Tema | E0.4 (esta demanda) | E0.5 |
|---|---|---|
| Banco de teste | Uma base: a de `TEST_DATABASE_URL`. `globalSetup` do projeto `integration` recria o schema do zero e aplica `prisma migrate deploy` **uma vez por execução** | Template database + uma base por worker (`CREATE DATABASE … TEMPLATE`), schema `pgboss` no template |
| Isolamento entre arquivos | Por dados: cada teste cria o próprio salão/profissional com UUIDs novos; nenhuma asserção depende de contagem global de tabela | Por base (reset por recriação a partir do template) |
| Limpeza | Só no início da execução (reset do schema). Sem `TRUNCATE` (bloqueado pelo trigger de auditoria) e sem limpeza entre arquivos | Reset entre arquivos |
| Dados | Inserção por SQL direto (`pg` ou `$executeRaw`) com helpers locais mínimos | Fábricas de dois salões completos (`tests/support/factories.ts`) |
| Pool / concorrência | Não há teste concorrente nesta demanda | Pool ≥ requisições paralelas (D-003/dba.md N-3, N-6) |

## 4. Regras de negócio

RN-1 a RN-11 são as da issue #6, sem alteração de conteúdo; reproduzidas para rastreio.

- **RN-1** (issue; PLAN "Direção técnica"; CLAUDE.md "Time"): instantes em `timestamptz` (UTC); jornada em hora local (`dia_semana smallint 0–6`, `inicio_min`, `fim_min int`, `CHECK (0 <= inicio_min AND inicio_min < fim_min AND fim_min <= 1440)`) com `EXCLUDE USING gist (profissional_id WITH =, dia_semana WITH =, int4range(inicio_min, fim_min) WITH &&)`; o salão guarda o fuso IANA (padrão `America/Sao_Paulo`).
- **RN-2** (issue; CLAUDE.md "Tenant isolation"): `salao_id NOT NULL` em toda entidade de tenant, `UNIQUE (salao_id, id)` e FKs compostas `(salao_id, <fk>) → (salao_id, id)` entre entidades do mesmo salão. Relações mínimas com FK composta (D-001/dba.md item 1): `reserva.profissional_id`, `reserva.cliente_id`, `reserva_item.reserva_id`, `reserva_item.servico_id`, `servico_profissional` (ambos os lados), `bloqueio.profissional_id`, `jornada.profissional_id`, `mensagem.reserva_id`, `consentimento.cliente_id`. Índices escopados começam por `salao_id`.
- **RN-3** (issue): todas as FKs com `ON DELETE RESTRICT` explícito (`onDelete: Restrict` em toda relação Prisma); nenhum `CASCADE` nem `SET NULL`. IDs `uuid` com `DEFAULT gen_random_uuid()` e `criado_em DEFAULT now()` no banco.
- **RN-4** (issue; CLAUDE.md "Soft deletes"): `profissional.ativo` e `servico.ativo` (`DEFAULT true`).
- **RN-5** (issue; CLAUDE.md "Multi-service"): `reserva_item` guarda `preco_centavos int CHECK (>= 0)` e `duracao_min int CHECK (> 0)` (snapshot).
- **RN-6** (issue; CLAUDE.md "Clients"/"Soft deletes"): `cliente` com `UNIQUE (salao_id, telefone_e164)` em `NULLS DISTINCT` (padrão); `CHECK ((anonimizada_em IS NULL AND nome IS NOT NULL AND telefone_e164 IS NOT NULL) OR (anonimizada_em IS NOT NULL AND nome IS NULL AND telefone_e164 IS NULL))`; `CHECK (telefone_e164 ~ '^\+55[1-9][0-9]{9,10}$')`.
- **RN-7** (issue; PLAN "Agenda e atendimento"; D-001/spec.md S1): `CONSTRAINT reserva_sem_sobreposicao EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, ocupado_ate, '[)') WITH &&) WHERE (status IN ('confirmado','concluido','nao_compareceu'))`; `ocupado_ate = fim + intervalo vigente` gravado na reserva; `CHECK (fim > inicio AND ocupado_ate >= fim)`. Status da reserva: `confirmado`, `cancelado`, `concluido`, `nao_compareceu` (PLAN, "Status do agendamento").
- **RN-8** (issue; decisão P1 do usuário em 18/11/2026): `mensagem UNIQUE (reserva_id, tipo, revisao)`; `webhook_evento UNIQUE (provedor, chave_dedupe) WHERE origem_valida`; `assinatura_pagamento.pagamento_id UNIQUE`; `assinatura UNIQUE (salao_id) WHERE estado <> 'encerrada'`; `reserva UNIQUE (salao_id, chave_requisicao)` (coluna anulável).
- **RN-9** (issue): `salao_slug` com `UNIQUE (slug)` global (PK), `UNIQUE (salao_id) WHERE atual` e `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`.
- **RN-10** (issue): `auditoria` e `assinatura_transicao` são somente inserção: trigger `BEFORE UPDATE OR DELETE … FOR EACH ROW` e `BEFORE TRUNCATE … FOR EACH STATEMENT` que levantam `SQLSTATE 'P0001'` (D-001/dba.md E8.1).
- **RN-11** (issue): o Prisma não pode acusar drift nem gerar migração sobre os objetos criados em SQL bruto.
- **RN-12** (D-001/dba.md item 5; complemento já aprovado, sem CA na issue): `usuario.email` com `CHECK (email = lower(email))` e `UNIQUE (email)`; `UNIQUE (salao_id) WHERE papel = 'gestor'`; `CHECK ((papel = 'super_admin') = (salao_id IS NULL))`; `profissional.usuario_id UNIQUE`, anulável.
- **RN-13** (issue, entregável "tests/support/db.ts mínimo"; fronteira da §3): a infraestrutura de teste desta demanda (a) só opera sobre a base de `TEST_DATABASE_URL`, validada por `urlBancoDeTeste()` antes de qualquer comando destrutivo; (b) recria o schema e aplica `prisma migrate deploy` uma vez por execução do projeto `integration`; (c) não usa `prisma db push` (D-003/dba.md N-5) nem `TRUNCATE`.
- **RN-14** (D-001/dba.md "Reversão"): a migração SQL da constraint traz, em comentário, o SQL inverso (`DROP CONSTRAINT reserva_sem_sobreposicao`, `DROP CONSTRAINT` do CHECK de ordem); a extensão não é removida. Migrações aplicadas não são editadas depois; mudanças futuras criam migração nova.

## 5. Critérios de aceitação

Convenções: "via SQL" = conexão direta (`pg` ou `$executeRaw`/`$queryRaw`) à base de `TEST_DATABASE_URL`; instantes escritos com sufixo `Z` (UTC). "Rejeita" = a instrução falha com o SQLSTATE indicado e nenhuma linha é gravada (verificado por consulta). Todas as reservas "ativas" usam `status = 'confirmado'` salvo indicação.

### CAs da issue (CA-1..CA-13), com o modo de verificação

- **CA-1** (PLAN "Direção técnica"; RN-11): Dado um banco vazio, quando se aplicam as migrações (`prisma migrate deploy`), então existem as tabelas da §3 item 1, a extensão `btree_gist`, a constraint `reserva_sem_sobreposicao`, a exclusion da jornada, os CHECKs e os triggers (verificado por consulta a `pg_extension`, `pg_constraint`, `pg_trigger` e `information_schema.tables`); e, em seguida, o Prisma não gera migração nem acusa drift.
  - Verificação automatizada: depois do `migrate deploy` na base de teste, `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` (com o datasource apontando para a base de teste) termina com código 0 (diff vazio).
  - Verificação manual (tester, saída registrada em `testes.md`): numa base local recém-migrada, `prisma migrate dev --create-only` não cria pasta nova em `prisma/migrations/` e não acusa drift.
- **CA-2** (PLAN CA 3): Dado um profissional com reserva `confirmado` de 10:00 a 11:00 UTC com `ocupado_ate` 11:00, quando se insere via SQL outra reserva ativa do mesmo profissional de 10:30 a 11:30, então o banco rejeita com SQLSTATE `23P01` e `constraint = 'reserva_sem_sobreposicao'` (campo `constraint` do erro do driver).
- **CA-3**: Dado o mesmo cenário com a primeira reserva `cancelado`, quando se insere a segunda, então a inserção é aceita.
- **CA-4**: Dado intervalo 0 e reservas de 10:00–11:00 e 11:00–12:00 do mesmo profissional (`ocupado_ate = fim`), quando ambas são inseridas, então ambas são aceitas.
- **CA-5**: Dado dois profissionais distintos do mesmo salão, quando se inserem reservas sobrepostas, uma para cada, então ambas são aceitas.
- **CA-6**: Dado intervalo de 15 min e reserva 10:00–10:30 (`ocupado_ate` 10:45), quando se insere 10:30–11:00 do mesmo profissional, então é rejeitada com `23P01` / `reserva_sem_sobreposicao`.
- **CA-7**: Dado uma reserva `cancelado` 10:00–11:00 e outra `confirmado` 10:30–11:30 do mesmo profissional, quando se faz UPDATE da primeira para `confirmado`, então o banco rejeita com `23P01` e a primeira continua `cancelado`.
- **CA-8**: Dado uma reserva com `fim <= inicio` (casos `fim = inicio` e `fim < inicio`) ou `ocupado_ate < fim`, quando inserida, então o CHECK rejeita com SQLSTATE `23514`.
- **CA-9** (CLAUDE.md "Tenant isolation"): Dado `salao_id` do salão A e `profissional_id`, `cliente_id` ou `servico_id` do salão B, quando se insere a reserva (profissional ou cliente de B) ou o item (serviço de B) via SQL, então a FK composta rejeita com SQLSTATE `23503` — um caso por coluna.
- **CA-10**: Dado o mesmo telefone em salões diferentes, quando inserido, então é aceito; no mesmo salão, o segundo é rejeitado (`23505`); duas clientes anonimizadas no mesmo salão são aceitas; cliente com `anonimizada_em` preenchido e nome não nulo é rejeitada pelo CHECK (`23514`).
- **CA-11**: Dado um slug atual ou histórico de um salão, quando outro salão insere o mesmo slug em `salao_slug`, então é rejeitado (`23505`); um salão com dois slugs atuais é rejeitado (`23505`).
- **CA-12**: Dado um registro em `auditoria`, quando se executa UPDATE, DELETE ou TRUNCATE via SQL, então o banco rejeita (`P0001`) e o registro continua igual; INSERT é aceito.
- **CA-13**: Dado dois intervalos de jornada sobrepostos do mesmo profissional no mesmo dia, quando inseridos via SQL, então o segundo é rejeitado (`23P01`).

### CAs complementares (tornam verificáveis RNs da issue sem CA próprio)

- **CA-14** (RN-10): Dado um registro em `assinatura_transicao`, quando se executa UPDATE, DELETE ou TRUNCATE via SQL, então o banco rejeita (`P0001`); INSERT é aceito.
- **CA-15** (RN-3; S-1): Dado o banco migrado, quando se consultam todas as FKs do schema `public` em `pg_constraint` (`contype = 'f'`), então todas têm `confdeltype = 'r'` (RESTRICT), nenhuma tem `confupdtype = 'c'` (CASCADE, ver S-1), e nenhuma tem `'c'` ou `'n'` (SET NULL) em `confdeltype`; e toda coluna `id` das tabelas da §3 é `uuid` com default `gen_random_uuid()`, e `criado_em` (onde existir) tem default `now()`.
- **CA-16** (RN-6, E.164): Dado um salão, quando se insere cliente com `+5511987654321` e com `+551133334444`, então ambos são aceitos; com `11987654321`, `+14155550100`, `+5501987654321` ou `+55119876543210`, então o CHECK rejeita (`23514`). Dado uma cliente anonimizada, quando se tenta voltar a preencher nome e telefone mantendo `anonimizada_em`, então o CHECK rejeita.
- **CA-17** (RN-8): via SQL, o segundo INSERT é rejeitado com `23505` em cada caso: (a) `mensagem` com mesmos `reserva_id, tipo, revisao` (com `revisao` diferente é aceito); (b) `webhook_evento` com mesmos `provedor, chave_dedupe` e `origem_valida = true` nos dois (com o primeiro `origem_valida = false`, os dois são aceitos); (c) `assinatura_pagamento` com o mesmo `pagamento_id`; (d) segunda `assinatura` não `encerrada` do mesmo salão (com a primeira `encerrada`, aceita); (e) `reserva` com mesmo `salao_id, chave_requisicao` (duas com `chave_requisicao` nula são aceitas).
- **CA-18** (RN-12): via SQL, é rejeitado: segundo `usuario` com `papel = 'gestor'` no mesmo salão (`23505`); `email` com maiúscula (`23514`); `super_admin` com `salao_id` preenchido e `gestor` sem `salao_id` (`23514`).
- **CA-19** (RN-1): Dado um profissional com jornada 09:00–12:00 (540–720) na segunda, quando se insere 12:00–18:00 na segunda e 09:00–12:00 na terça, então ambos são aceitos; quando se insere `inicio_min >= fim_min`, `fim_min > 1440` ou `dia_semana` fora de 0–6, então o CHECK rejeita (`23514`).
- **CA-20** (RN-4, RN-5): Dado o banco migrado, quando se insere profissional e serviço sem informar `ativo`, então ficam `ativo = true`; quando se insere `reserva_item` com `preco_centavos < 0` ou `duracao_min <= 0`, então o CHECK rejeita (`23514`).

### CAs da infraestrutura de teste (RN-13)

- **CA-21**: Dado `TEST_DATABASE_URL` ausente, ou com o mesmo nome de base de `DATABASE_URL`, quando se executa `npm run test:integration`, então a execução falha antes de qualquer comando destrutivo, com a mensagem de `urlBancoDeTeste()`, e a base de desenvolvimento não é alterada.
- **CA-22**: Dado a base de teste com dados de uma execução anterior (inclusive linhas em `auditoria`), quando se executa `npm run test:integration` duas vezes seguidas, então as duas execuções passam (o reset não depende de `TRUNCATE`), e `tests/integration/health.test.ts` continua passando.

### Relação com o PLAN
CA-2..CA-7 → PLAN CA 3 (sem dupla reserva, garantia no banco). CA-9 → PLAN CA 11 (isolamento; aqui na camada do banco, a camada de servidor é a E0.5). CA-10/CA-16 → "Clientes" (E.164, anonimização). CA-12/CA-14 → "Super admin" (auditoria) e CA 5 do PLAN (evidência de transições).

## 6. Casos limite

- **Fuso e virada de dia:** a constraint compara `tstzrange` de instantes; o resultado não depende do `TimeZone` da sessão. Pelo menos um teste de sobreposição usa instantes que cruzam a meia-noite UTC (ex.: 23:30Z–00:30Z) e a sessão com `SET TIME ZONE 'America/Sao_Paulo'`, com o mesmo resultado esperado. Jornada que atravessa a meia-noite local não é representável (`inicio_min < fim_min`); assumido como fora da v1 (S-3).
- **Limites do intervalo `[)`:** adjacência exata é aceita (CA-4, CA-19 para a jornada); 1 segundo de sobreposição é rejeitado.
- **Concorrência:** o banco decide; nenhum CA concorrente aqui (é o CA-2 de E3.2, com pool adequado). Os testes desta demanda podem rodar em workers paralelos sem interferência porque cada um cria os próprios dados (RN-13).
- **Isolamento entre salões:** FK composta (CA-9). Relação opcional (`bloqueio.profissional_id` nulo = salão inteiro): com `MATCH SIMPLE` (padrão), a FK composta não é verificada quando `profissional_id` é nulo, o que é o comportamento desejado; com valor de outro salão, rejeita (coberto se o desenvolvedor incluir `bloqueio` no CA-9; recomendado, não obrigatório).
- **Salão suspenso:** só existe a coluna `suspenso_manual_em` e o estado da assinatura; a política somente leitura é da E6.4. Não se aplica aqui.
- **Cliente anonimizada:** CA-10 e CA-16 (coexistência e irreversibilidade).
- **Entradas inválidas:** telefone não brasileiro ou sem `+` (CA-16); slug fora do padrão (ex.: `Salao`, `-a`, `a--b`) rejeitado pelo CHECK de RN-9 — recomendado incluir no teste de CA-11; e-mail com maiúsculas (CA-18); valores negativos (CA-20).
- **Permissões por perfil:** não se aplica no banco, exceto RN-12 (papel × salão). Permissões de aplicação são E0.5/E1.2.
- **Enum de status:** renomear um valor quebra o predicado da constraint (risco do DBA); nenhum valor além dos quatro do PLAN.
- **Prisma 7:** `instanceof PrismaClient` é `false` e os matchers do Vitest estouram a pilha ao formatar o cliente (D-003/dev.md:67). Os testes não devem passar o cliente a `expect(...)`.

## 7. Dependências

- E0.2 (#4) concluída na main: compose com `postgres:17` (contrib inclui `btree_gist`), base de teste criada pelo initdb (`docker/postgres/initdb/10-base-de-teste.sh`), `migrate deploy` no entrypoint.
- Bloqueia E0.5 (#7), E0.6 (#8), E0.7 (#9). Relacionadas: E3.2 (#34), E7.1 (#31), E6.2 (#47).
- E0.3 (#5, CI, aberta): executará o teste de drift e os de integração na CI; não bloqueia esta demanda.
- Integrações externas: nenhuma.

## 8. Impactos prováveis

- **Dados: alto.** Primeira migração do projeto; schema congelado após a aprovação (issue). DBA é o responsável principal (issue, "Papel responsável").
- **Infra/CI: baixo.** `vitest.config.ts` ganha `globalSetup` no projeto `integration`. Se o arquiteto optar por `--from-migrations` no teste de drift, será preciso `shadowDatabaseUrl` no `prisma.config.ts` e uma variável em `.env.example` (DevOps); a opção `--from-config-datasource` do CA-1 dispensa isso. A imagem e o Dockerfile já copiam `prisma/` (D-003/dba.md §4).
- **Código:** `npm run db:generate` passa a gerar models; `typecheck` e `build` dependem disso (o cliente gerado é ignorado pelo git, `.gitignore:24-25`). Nenhum código novo em `src/**` é exigido; se surgir (ex.: helper de erro), entra na cobertura ≥ 90%. Código em `tests/**` não entra na métrica.

## 9. Dúvidas e suposições

### Bloqueantes
Nenhuma.

### Não bloqueantes (suposição adotada)
- **S-1 — `onUpdate` das FKs.** Verificado nesta análise: o Prisma 7.10.1 gera `ON UPDATE CASCADE` por padrão (`prisma migrate diff --from-empty --to-schema` sobre um schema de prova no scratchpad produziu `… ON DELETE RESTRICT ON UPDATE CASCADE` para FKs simples e compostas). Com FK composta, um UPDATE de `salao_id` no pai se propagaria aos filhos e moveria reservas entre salões. Suposição: toda relação declara também `onUpdate: Restrict` (ou `NoAction`), e o CA-15 passa a exigir `confupdtype <> 'c'`. Decisão final do DBA, registrada em `dba.md`.
- **S-2 — Relação opcional com FK composta.** Verificado: o Prisma 7.10.1 valida (`prisma validate`) uma relação opcional `fields: [salaoId, profissionalId]` com `salaoId` obrigatório e `profissionalId` anulável, e várias relações compartilhando `salaoId`. Portanto as FKs compostas podem ficar no schema Prisma (sem SQL bruto, sem risco de drift por FK desconhecida).
- **S-3 — Jornada que cruza a meia-noite local** não é suportada (decorre do CHECK `inicio_min < fim_min` decidido pelo DBA).
- **S-4 — Verificação de drift automatizada** pelo `migrate diff --exit-code` sobre a base migrada (CA-1), mais o `migrate dev --create-only` manual do tester. O Prisma 7.10.1 não tem suporte a índices parciais no schema (nenhuma ocorrência de `partialIndexes` em `node_modules/prisma/build`); se o diff acusar os índices parciais ou o índice da exclusion, vale a mitigação do D-001/dba.md ("declarar no schema o que for suportado e manter o resto só em SQL"). Recomendo ao arquiteto uma tarefa inicial curta de prova (T-0) para medir isso antes de escrever todo o schema.
- **S-5 — Localização do harness.** A issue nomeia `tests/support/db.ts`; a guarda atual está em `tests/integration/support/banco.ts`. Suposição: o arquiteto escolhe o local, reaproveitando `urlBancoDeTeste()` sem duplicá-la; os nomes de arquivo de teste da issue (`tests/integration/db/reserva-exclusion.test.ts`, `tests/integration/db/cliente-unicidade.test.ts`) são mínimos, e os demais CAs podem ficar em arquivos adicionais em `tests/integration/db/`.
- **S-6 — Lista de tabelas.** A §3 item 1 traduz as entidades da issue em nomes físicos (ex.: "tokens" → `token` com tipo; "evento de webhook" → `webhook_evento`). O DBA pode renomear, desde que registre em `dba.md`; o CA-1 usa a lista final.
