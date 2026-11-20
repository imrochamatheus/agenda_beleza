# Issue #27 — Calcular horários disponíveis para um ou mais serviços em sequência

## Objetivo
Oferecer apenas horários em que todo o atendimento, executado em sequência por um profissional, cabe na disponibilidade.

## Origem e contexto
PLAN.md, "Agenda e atendimento" (fluxo público, regras de horário, fuso); CLAUDE.md, invariantes "Time" e "Multi-service bookings". Atual: inexistente.

## Escopo
Função de domínio pura + consulta ao banco que, dado salão, serviços, profissional (ou lista de elegíveis) e data, devolve inícios disponíveis; listagem de profissionais elegíveis.

## Fora do escopo
Bloqueio por estado do salão (salão não operável): tratado em E6.4.

## Especificação
Decidido:
- RN-1: profissionais elegíveis = ativos e vinculados a **todos** os serviços escolhidos (todos ativos).
- RN-2: duração total = soma das durações; preço total = soma dos preços.
- RN-3: um início é válido se `[inicio, fim)` está inteiramente dentro de um intervalo de jornada do dia e não intersecta bloqueio do profissional nem do salão; e se `[inicio, fim + intervalo vigente)` não intersecta `[inicio, ocupado_ate)` de nenhuma reserva com status ativo do profissional (mesma expressão e predicado da constraint de E0.4).
- RN-4: inícios alinhados à grade a partir da meia-noite local do salão.
- RN-5: início ≥ agora + antecedência mínima; data local do início ≤ hoje local + janela máxima.
- RN-6: cálculo no fuso do salão; entradas e saídas em UTC com rótulo local.
Casos limite: virada de dia (atendimento que terminaria após o fim da jornada não é oferecido); fuso com horário de verão (testar com `America/New_York` na data de transição); antecedência atravessando a meia-noite; serviço ou profissional inativo.
Componentes prováveis: `src/domain/availability/**`, `src/server/disponibilidade/**`.

## Critérios de aceite
- [ ] CA-1: Dado serviços A (30 min) e B (45 min), Ana faz A e B e Bia faz só A, quando se listam profissionais para A+B, então só Ana aparece.
- [ ] CA-2: Dado Ana com jornada 09:00–12:00, grade 15, intervalo 0, sem reservas, quando se pede A+B (75 min), então o último horário oferecido é 10:45.
- [ ] CA-3: Dado intervalo vigente de 15 min e uma reserva de Ana 10:00–10:30 criada com intervalo 15 (`ocupado_ate` 10:45), quando se pede A (30 min), então 09:30 e 10:30 não são oferecidos e 09:15 e 10:45 são; dado intervalo vigente 0 e a reserva criada com intervalo 0 (`ocupado_ate` 10:30), então 09:30 e 10:30 são oferecidos.
- [ ] CA-4: Dado uma pausa 12:00–13:00, quando se pede um serviço de 60 min, então 11:30 não é oferecido.
- [ ] CA-5: Dado bloqueio de salão no dia, quando se consulta esse dia, então não há horários.
- [ ] CA-6: Dado agora = 08:00 local e antecedência 2 h, quando se consulta hoje, então o primeiro horário é ≥ 10:00.
- [ ] CA-7: Dado janela de 60 dias, quando se consulta o 61º dia local, então não há horários.
- [ ] CA-8: Dado fuso `America/Sao_Paulo` e jornada 09:00, quando o horário é calculado, então o instante UTC retornado é 12:00Z.
- [ ] CA-9: Dado a grade do salão alterada para 30 min, quando se consulta a disponibilidade, então todos os inícios oferecidos são múltiplos de 30 min no horário local.

## Validação
Unitários extensivos da função pura (relógio controlado); integração com PostgreSQL real para a consulta; `EXPLAIN (ANALYZE)` da consulta de ocupação com volume gerado por fábrica no teste (ex.: 2 salões × 10 profissionais × 5.000 reservas) anexado à issue, sem `Seq Scan` em `reserva`. Gate padrão.

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #17 (E3)
- Bloqueada por: #25 (E2.1), #18 (E2.3), #19 (E2.4)
- Bloqueia: #34 (E3.2)

## Entregáveis
- src/domain/availability/** (função pura: grade, antecedência, janela, intervalo, fuso com DST, multi-serviço em sequência)
- src/server/disponibilidade/*.ts (consulta de jornadas, bloqueios e ocupação [inicio, ocupado_ate); profissionais elegíveis)
- tests/unit/availability/*.test.ts (CA-1..CA-8, DST em America/New_York, relógio controlado)
- tests/integration/disponibilidade/*.test.ts (bloqueio de salão no dia, grade alterada)

## Papel responsável
- Desenvolvedor
- Apoio/revisão: Arquiteto de software, Tester, DBA

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E3.1`. Prioridade P0, tamanho L (Project #3)._
<!-- agenda-beleza-backlog:E3.1 -->

## Comentários (obrigações herdadas)
Obrigação herdada da D-014 (E2.1, PR #71): usar a leitura pública corrigida (`listarServicosPublicos` só lista serviço ativo com ao menos um profissional ativo vinculado).

Obrigação herdada da D-015 (E2.3, PR #72): a jornada é hora de parede (minutos 0..1440, 0 = domingo) no fuso do salão; a E3.1 converte para UTC no fuso do salão, tratando horas inexistentes ou repetidas em horário de verão. Detalhes: docs/demandas/D-015/spec.md.

Obrigação herdada da D-016 (E2.4, PR #73): reutilizar a conversão hora local → UTC de `src/server/tempo/fuso.ts` (DST: inexistente avança, repetida usa a 1ª ocorrência) e descontar bloqueios do profissional e do salão (`[inicio, fim)` semiaberto).
