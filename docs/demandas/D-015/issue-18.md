# Issue #18 — Definir a jornada semanal de cada profissional com pausas

## Objetivo
Permitir ao gestor configurar os horários de trabalho que alimentam a disponibilidade.

## Origem e contexto
PLAN.md, "Agenda e atendimento" (jornada semanal com pausas; só o gestor edita). Atual: inexistente.

## Escopo
Para cada dia da semana: trabalha ou não, um ou mais intervalos de trabalho (pausas = lacunas entre intervalos), em horário local do salão.

## Especificação
Decidido:
- RN-1: só o gestor edita jornadas; o profissional apenas visualiza a própria.
- RN-2: intervalos no mesmo dia não se sobrepõem (garantido também pela exclusion `int4range` de E0.4) e início < fim; horários em minutos do dia (`inicio_min`, `fim_min`) no fuso do salão.
- RN-3: alterar a jornada não altera reservas existentes, que podem ficar fora da jornada.
- RN-4: capacidade declarada: `configurar`; o bloqueio por estado do salão é verificado em E6.4.
- RN-5: a jornada não atravessa a meia-noite (`fim ≤ 24:00`); o servidor recusa o contrário.
Casos limite: dia sem intervalos = folga.

## Critérios de aceite
- [ ] CA-1: Dado o gestor, quando salva segunda 09:00–12:00 e 13:00–18:00, então a jornada fica registrada com a pausa 12:00–13:00.
- [ ] CA-2: Dado intervalos sobrepostos (09:00–12:00 e 11:00–14:00), quando salva, então o servidor recusa.
- [ ] CA-3: Dado um profissional autenticado, quando tenta alterar a própria jornada, então recebe 403.
- [ ] CA-4: Dado um intervalo 22:00–02:00, quando o gestor salva, então o servidor recusa.

## Validação
Unitários (validação de intervalos); integração com PostgreSQL real (permissão; isolamento conforme G-4). Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #15 (E2)
- Bloqueada por: #16 (E2.2)
- Bloqueia: #27 (E3.1), #20 (E3.3)
- Relacionadas: #27 (E3.1)

## Entregáveis
- src/app/painel/profissionais/[id]/jornada/** (edição por dia, múltiplos intervalos)
- src/server/jornadas/*.ts (validação de intervalos em minutos locais)
- tests/unit/jornadas/intervalos.test.ts e tests/integration/jornadas/*.test.ts (CA-1..CA-3)

## Papel responsável
- Desenvolvedor
- Apoio/revisão: Tester

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E2.3`. Prioridade P0, tamanho M (Project #3)._
<!-- agenda-beleza-backlog:E2.3 -->
