# Issue #19 — Registrar bloqueios do profissional e do salão inteiro

## Objetivo
Permitir marcar períodos indisponíveis (folga, compromisso, feriado, reforma).

## Origem e contexto
PLAN.md, "Agenda e atendimento" (bloqueios por profissional e para o salão) e "Perfis e acesso" (profissional gerencia apenas os próprios bloqueios). Atual: inexistente.

## Escopo
CRUD de bloqueios de profissional (gestor: qualquer profissional; profissional: só os próprios) e de salão (só gestor), com início/fim e motivo opcional; exibição na agenda.

## Especificação
Decidido:
- RN-1: bloqueio é um intervalo `[inicio, fim)` em UTC, informado no fuso do salão; permite dia inteiro.
- RN-2: criar bloqueio sobre reservas existentes é permitido, com aviso listando-as; as reservas não são alteradas.
- RN-3: bloqueios são removíveis (não fazem parte do histórico protegido por soft delete).
- RN-4: capacidade declarada: `configurar`; o bloqueio por estado do salão é verificado em E6.4.

## Critérios de aceite
- [ ] CA-1: Dado um profissional autenticado, quando cria um bloqueio na própria agenda, então ele é salvo.
- [ ] CA-2: Dado um profissional autenticado, quando tenta criar ou remover bloqueio de outro profissional ou do salão, então recebe 403.
- [ ] CA-3: Dado um salão em `America/Sao_Paulo`, quando o gestor cria um bloqueio de salão de dia inteiro para 25/12, então ele é persistido como `[25/12 03:00Z, 26/12 03:00Z)` (00:00–24:00 local); o efeito na disponibilidade é verificado em E3.1 (CA-5).
- [ ] CA-4: Dado uma reserva existente (fábrica), quando um bloqueio a cobre, então a resposta da ação contém a lista com o ID da reserva afetada e a reserva continua `confirmado`.

## Validação
Unitários da conversão de dia inteiro local para UTC (incluindo fuso com horário de verão); integração com PostgreSQL real (permissões; isolamento conforme G-4). Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #15 (E2)
- Bloqueada por: #16 (E2.2)
- Bloqueia: #27 (E3.1), #20 (E3.3)
- Relacionadas: #27 (E3.1)

## Entregáveis
- src/app/painel/bloqueios/** (salão e profissional; profissional só os próprios)
- src/server/bloqueios/*.ts (intervalo UTC informado no fuso do salão, aviso de reservas cobertas)
- tests/integration/bloqueios/*.test.ts (permissões, escopo, aviso)

## Papel responsável
- Desenvolvedor
- Apoio/revisão: Tester

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E2.4`. Prioridade P0, tamanho M (Project #3)._
<!-- agenda-beleza-backlog:E2.4 -->
