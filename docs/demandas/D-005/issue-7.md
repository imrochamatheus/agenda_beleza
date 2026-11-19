## Objetivo
Garantir que toda consulta e mutação autenticada seja limitada ao salão do usuário, com testes de integração reutilizáveis contra PostgreSQL real.

## Origem e contexto
PLAN.md, "Perfis e acesso" (escopo do salão no servidor); CLAUDE.md, invariante "Tenant isolation is enforced on the server". Atual: inexistente.

## Escopo
- `defineAcao({ papeis, capacidade }, handler)`: valida sessão e papel, monta o `TenantContext` e consulta uma política de operação por capacidade, plugável (padrão: permite; a política real é de E6.4). Mantém o registro de todas as ações.
- Repositórios que exigem `TenantContext` e aplicam `salao_id` em toda leitura e escrita; regra de lint `no-restricted-imports` que impede importar o cliente Prisma fora dos repositórios.
- Infra de testes: banco por worker do Vitest criado a partir de um template database (`CREATE DATABASE … TEMPLATE`), incluindo o schema `pgboss`; reset entre arquivos por recriação a partir do template (sem TRUNCATE); pool de conexões ≥ número de requisições paralelas dos testes de concorrência; fábricas para dois salões completos; criação de contexto autenticado.

## Especificação
Decidido:
- RN-1: o `salao_id` vem sempre da sessão no servidor, nunca de parâmetro do cliente.
- RN-2: acesso a recurso de outro salão responde como inexistente (`NaoEncontrado`/404), sem revelar existência.
- RN-3: rotas públicas resolvem o salão pelo slug e expõem apenas dados públicos (serviços e profissionais ativos, horários).
- RN-4: o super admin usa um contexto próprio, explícito e auditado (E8.1).
- RN-5: toda ação mutável declara uma capacidade: `configurar`, `agendar`, `cancelar`, `assinatura` ou `lgpd`.

## Critérios de aceite
- [ ] CA-1: Dado o gestor do salão A autenticado, quando ele requisita por ID um serviço, profissional, cliente ou agendamento do salão B, então recebe 404 e nenhum dado de B.
- [ ] CA-2: Dado o gestor do salão A, quando tenta alterar um recurso do salão B informando o ID, então a alteração não ocorre e o registro de B permanece igual no banco.
- [ ] CA-3: Dado um teste de integração novo, quando ele usa as fábricas, então obtém dois salões completos sem SQL manual.
- [ ] CA-4: Dado o registro de ações, quando o teste percorre todas as ações mutáveis, então cada uma declara capacidade; uma ação sem capacidade faz o teste falhar.
- [ ] CA-5: Dado um arquivo fora dos repositórios que importa o cliente Prisma, quando se executa o lint, então ele falha.
- [ ] CA-6: Dado dois arquivos de teste de concorrência executando em workers paralelos, quando rodam juntos, então nenhum vê dados do outro e ambos passam de forma determinística em 10 execuções seguidas.

## Validação
Testes de integração com PostgreSQL real (isolamento é exigido pelo CA 11 do PLAN). Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #2 (E0)
- Bloqueada por: #6 (E0.4)
- Bloqueia: #12 (E1.2), #33 (E4.3), #40 (E6.3), #23 (E8.1)

## Entregáveis
- src/server/tenant/context.ts (TenantContext: usuário, papel, salaoId, profissionalId)
- src/server/tenant/define-acao.ts (defineAcao com papeis, capacidade e política de operação plugável, padrão permitir)
- src/server/repos/** limitado aos agregados do CA-1 (repositórios exigem TenantContext; recurso de outro salão → NaoEncontrado)
- Regra ESLint no-restricted-imports para o cliente Prisma fora de src/server/repos, src/worker e prisma/seed.ts
- tests/support/db.ts evolui o harness de E0.4 para banco por worker do Vitest via template (com schema pgboss); tests/support/factories.ts (dois salões completos), tests/support/auth.ts
- tests/integration/tenant/isolamento.test.ts (CA-1..CA-3)
- Contextos TenantContext, PublicoContext (slug), SistemaContext e AdminContext; erros AcessoNegado/NaoEncontrado
- src/server/repos/transacao.ts (unidade de trabalho compartilhada entre repositórios)
- Núcleo de defineAcao testável sem next/headers e exigirContexto() para Server Components
- Convenção de arquivos de ação *.acao.ts carregados por import.meta.glob no teste de registro; lint libera tests/**

## Papel responsável
- Desenvolvedor
- Apoio/revisão: Arquiteto de software, DBA, Tester

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E0.5`. Prioridade P0, tamanho L (Project #3)._
<!-- agenda-beleza-backlog:E0.5 -->
