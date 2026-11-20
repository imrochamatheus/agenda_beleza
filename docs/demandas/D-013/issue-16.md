# Issue #16 — Gerenciar profissionais, incluindo o gestor que também atende, com desativação

## Objetivo
Permitir ao gestor cadastrar e desativar profissionais e criar um perfil de profissional vinculado a si mesmo.

## Origem e contexto
PLAN.md, "Perfis e acesso" (gestor pode ter perfil de profissional) e "Serviços e profissionais". Atual: inexistente.

## Escopo
Listar, criar (nome, e-mail opcional para convite), editar, ativar/desativar; ação "eu também atendo" para o gestor; ponto de entrada do convite (E1.4).

## Especificação
Decidido:
- RN-1: profissional nunca é apagado; desativado some da página pública e não recebe novas reservas.
- RN-2: desativação recusada se houver reservas futuras confirmadas, listando-as (S16).
- RN-3: o gestor pode ter no máximo um perfil de profissional vinculado; esse perfil não exige convite.
- RN-4: capacidade declarada: `configurar`; o bloqueio por estado do salão é verificado em E6.4.

## Critérios de aceite
- [ ] CA-1: Dado o gestor, quando cria o profissional "Ana", então ele aparece ativo na lista e `profissional.ativo = true` no banco.
- [ ] CA-2: Dado o gestor, quando ativa "eu também atendo", então existe um profissional ligado ao usuário gestor com agenda própria; uma segunda ativação não cria outro.
- [ ] CA-3: Dado um profissional com reserva futura confirmada, quando o gestor tenta desativá-lo, então a operação é recusada e a reserva é listada.
- [ ] CA-4: Dado um profissional sem reservas futuras, quando é desativado, então permanece no banco com `ativo = false`, a consulta de profissionais ativos do salão não o retorna e as reservas passadas da fábrica continuam com o `profissional_id` dele.

## Validação
Integração com PostgreSQL real, com isolamento conforme G-4. Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #15 (E2)
- Bloqueada por: #12 (E1.2)
- Bloqueia: #21 (E1.4), #25 (E2.1), #18 (E2.3), #19 (E2.4)

## Entregáveis
- src/app/painel/profissionais/** (lista, criar, editar, desativar, 'eu também atendo')
- src/server/profissionais/*.ts (recusa de desativação com reservas futuras, revogação de sessões ao desativar)
- tests/integration/profissionais/*.test.ts (CA-1..CA-4)

## Papel responsável
- Desenvolvedor
- Apoio/revisão: Tester

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E2.2`. Prioridade P0, tamanho M (Project #3)._
<!-- agenda-beleza-backlog:E2.2 -->
