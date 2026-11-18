## Objetivo
Modelar as entidades centrais e garantir, no banco, que nenhuma reserva ativa se sobreponha a outra do mesmo profissional.

## Origem e contexto
PLAN.md, "Direção técnica" (entidades sugeridas) e "Agenda e atendimento" (constraint de exclusão); CLAUDE.md, invariante "No double booking is guaranteed by the database". Atual: inexistente.

## Escopo
- Esquema Prisma: salão (com `suspenso_manual_em`), `salao_slug` (tabela única de slugs atuais e históricos), usuário, `sessao`, profissional, serviço, vínculo serviço-profissional, jornada, bloqueio (profissional e salão), cliente, consentimento, reserva (com `revisao`, `ocupado_ate`, `chave_requisicao`), item da reserva, assinatura, `assinatura_pagamento`, `assinatura_transicao`, evento de webhook, mensagem e tentativas, `email_log`, `rate_limit_janela`, convite, tokens, auditoria.
- Migrações SQL brutas: `CREATE EXTENSION btree_gist`; constraint `reserva_sem_sobreposicao`; exclusion `int4range` da jornada; CHECKs; índices parciais; trigger append-only.

## Fora do escopo
Tabelas para funcionalidades de "Fora da primeira versão".

## Especificação
Decidido:
- RN-1: instantes em `timestamptz` (UTC); jornada em hora local (`dia_semana`, `inicio_min`, `fim_min`) com exclusion `int4range` por profissional e dia; o salão guarda o fuso IANA (padrão `America/Sao_Paulo`).
- RN-2: `salao_id` não nulo em toda entidade de tenant, `UNIQUE(salao_id, id)` e FKs compostas `(salao_id, <fk>)` entre entidades do mesmo salão; índices escopados começam por `salao_id`.
- RN-3: todas as FKs com `ON DELETE RESTRICT` explícito (nenhum CASCADE ou SET NULL); IDs `uuid` e `criado_em` com default no banco.
- RN-4: profissional e serviço têm `ativo` (soft delete); não há exclusão física via aplicação.
- RN-5: item da reserva guarda snapshot de preço (centavos, `int`) e duração (minutos).
- RN-6: cliente com `UNIQUE(salao_id, telefone_e164)` e NULLS DISTINCT (anonimizadas coexistem); CHECK de anonimização coerente (nome e telefone nulos com `anonimizada_em` preenchido, ou nenhum nulo sem ele); CHECK de formato E.164 BR.
- RN-7: `EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, ocupado_ate, '[)') WITH &&) WHERE (status IN ('confirmado','concluido','nao_compareceu'))`, com nome `reserva_sem_sobreposicao`; `ocupado_ate = fim + intervalo vigente` gravado na reserva (snapshot); `CHECK (fim > inicio AND ocupado_ate >= fim)`. Com intervalo 0, reservas adjacentes não conflitam.
- RN-8: mensagem com `UNIQUE(reserva_id, tipo, revisao)` (ver P1); webhook com `UNIQUE(provedor, chave_dedupe) WHERE origem_valida`; `assinatura_pagamento.pagamento_id UNIQUE`; assinatura com `UNIQUE(salao_id) WHERE estado <> 'encerrada'`; reserva com `UNIQUE(salao_id, chave_requisicao)`.
- RN-9: `salao_slug` com `UNIQUE(slug)` global, `UNIQUE(salao_id) WHERE atual` e CHECK de formato.
- RN-10: `auditoria` e `assinatura_transicao` são somente inserção, garantido por trigger que rejeita UPDATE e DELETE (por linha) e TRUNCATE (por instrução).
- RN-11: `prisma migrate dev` não pode gerar drift sobre os objetos criados em SQL bruto.
Decidido pelo usuário em 18/11/2026 (P1, opção a): a chave de idempotência é `reserva:tipo:revisao`, e o CLAUDE.md foi atualizado para refletir essa regra.
Impacto em dados: alto; parecer do DBA em `docs/demandas/D-001/dba.md`.

## Critérios de aceite
- [ ] CA-1: Dado um banco vazio, quando se aplicam as migrações, então existem as tabelas, a extensão `btree_gist`, a constraint `reserva_sem_sobreposicao`, os CHECKs e os triggers; e, em seguida, `prisma migrate dev` não gera migração nem acusa drift.
- [ ] CA-2: Dado um profissional com reserva `confirmado` de 10:00 a 11:00 UTC com `ocupado_ate` 11:00, quando se insere via SQL outra reserva ativa do mesmo profissional de 10:30 a 11:30, então o banco rejeita com SQLSTATE `23P01` e constraint `reserva_sem_sobreposicao`.
- [ ] CA-3: Dado o mesmo cenário com a primeira reserva `cancelado`, quando se insere a segunda, então a inserção é aceita.
- [ ] CA-4: Dado intervalo 0 e reservas de 10:00–11:00 e 11:00–12:00 do mesmo profissional, quando ambas são inseridas, então ambas são aceitas.
- [ ] CA-5: Dado dois profissionais distintos, quando se inserem reservas sobrepostas, uma para cada, então ambas são aceitas.
- [ ] CA-6: Dado intervalo de 15 min e reserva 10:00–10:30 (`ocupado_ate` 10:45), quando se insere 10:30–11:00 do mesmo profissional, então é rejeitada.
- [ ] CA-7: Dado uma reserva `cancelado` 10:00–11:00 e outra `confirmado` 10:30–11:30 do mesmo profissional, quando se faz UPDATE da primeira para `confirmado`, então o banco rejeita com `23P01`.
- [ ] CA-8: Dado uma reserva com `fim <= inicio` ou `ocupado_ate < fim`, quando inserida, então o CHECK rejeita.
- [ ] CA-9: Dado `salao_id` do salão A e `profissional_id`, `cliente_id` ou `servico_id` do salão B, quando se insere a reserva ou o item via SQL, então a FK composta rejeita.
- [ ] CA-10: Dado o mesmo telefone em salões diferentes, quando inserido, então é aceito; no mesmo salão, o segundo é rejeitado; duas clientes anonimizadas no mesmo salão são aceitas; cliente com `anonimizada_em` preenchido e nome não nulo é rejeitada pelo CHECK.
- [ ] CA-11: Dado um slug atual ou histórico de um salão, quando outro salão insere o mesmo slug em `salao_slug`, então é rejeitado; um salão com dois slugs atuais é rejeitado.
- [ ] CA-12: Dado um registro em `auditoria`, quando se executa UPDATE, DELETE ou TRUNCATE via SQL, então o banco rejeita; INSERT é aceito.
- [ ] CA-13: Dado dois intervalos de jornada sobrepostos do mesmo profissional no mesmo dia, quando inseridos via SQL, então o segundo é rejeitado.

## Validação
Testes de integração com PostgreSQL real, por conexão direta (`pg` ou Prisma) contra o banco do compose ou da CI; migram para o harness compartilhado quando E0.5 existir. Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #2 (E0)
- Bloqueada por: #4 (E0.2)
- Bloqueia: #7 (E0.5), #8 (E0.6), #9 (E0.7)
- Relacionadas: #34 (E3.2), #31 (E7.1), #47 (E6.2)

## Entregáveis
- prisma/schema.prisma com as entidades centrais do PLAN mais sessao, email_log, rate_limit_janela, salao_slug (atuais + históricos), reserva.revisao, reserva.ocupado_ate, reserva.chave_requisicao, salao.suspenso_manual_em
- prisma/migrations/*_init/migration.sql
- prisma/migrations/*_reserva_exclusion/migration.sql: CREATE EXTENSION btree_gist; EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, ocupado_ate, '[)') WITH &&) WHERE status IN ('confirmado','concluido','nao_compareceu'); CHECKs de ordem
- Triggers append-only em auditoria (UPDATE/DELETE por linha, TRUNCATE por instrução)
- tests/integration/db/reserva-exclusion.test.ts e tests/integration/db/cliente-unicidade.test.ts (CA-2..CA-6 e caso com intervalo)
- docs/demandas/D-NNN/dba.md com parecer do DBA
- FKs compostas (salao_id, id) e onDelete: Restrict explícito em todas as relações
- Exclusion int4range da jornada (profissional_id, dia_semana, int4range(inicio_min, fim_min))
- CHECKs de cliente anonimizada e de formato E.164
- Índices parciais únicos: gestor por salão, slug atual, assinatura vigente, webhook com origem válida
- Teste de ausência de drift (migrate dev sem gerar nova migração)
- tests/support/db.ts mínimo (globalSetup: base de teste, migrate deploy, limpeza)
- Schema da v1 congelado após aprovação; migrações posteriores são próprias de cada item e serializadas pelo líder

## Papel responsável
- DBA
- Apoio/revisão: Arquiteto de software, Desenvolvedor

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E0.4`. Prioridade P0, tamanho L (Project #3)._
<!-- agenda-beleza-backlog:E0.4 -->
