# Issue #26 — Configurar fuso, regras de horário e troca de slug com histórico

## Objetivo
Permitir ao gestor ajustar os dados e as regras operacionais do salão.

## Origem e contexto
PLAN.md, "Perfis e acesso" (slug editável, antigo redireciona), "Agenda e atendimento" (regras configuráveis) e "Interface" (configurações do salão); CLAUDE.md, invariante "Time". Atual: inexistente.

## Escopo
Editar nome, fuso (IANA), grade (min), antecedência mínima (h), janela máxima (dias), intervalo entre atendimentos (min) e slug; troca de slug registrando o anterior como histórico em `salao_slug`.

## Fora do escopo
Resposta HTTP de redirecionamento do slug antigo (E4.1); efeito da grade na disponibilidade (E3.1).

## Especificação
Decidido:
- RN-1: os padrões do PLAN (15 min, 2 h, 60 dias, 0 min) são obrigatórios na criação do salão.
- RN-2: fuso deve ser IANA válido.
- RN-3: slug segue as regras de E1.1 e é único entre slugs atuais e históricos de todos os salões (`salao_slug`).
- RN-4: ao trocar o slug, o anterior vira histórico do mesmo salão e o novo passa a ser o atual, na mesma transação; o redirecionamento permanente (301 ou 308) é servido por E4.1.
- RN-5: mudanças valem para disponibilidades futuras; reservas existentes não mudam (o `ocupado_ate` já gravado é mantido).
- RN-6: capacidade declarada: `configurar`; o bloqueio por estado do salão é verificado em E6.4.
Sugestão (não decidida): grade ∈ {5, 10, 15, 20, 30, 60}; antecedência 0–72 h; janela 1–365 dias; intervalo 0–120 min.

## Critérios de aceite
- [ ] CA-1: Dado o salão com slug `studio-bela`, quando o gestor muda para `bela-studio`, então `salao_slug` registra `studio-bela` como histórico do salão e `bela-studio` como atual.
- [ ] CA-2: Dado um slug já usado (atual ou histórico) por outro salão, quando o gestor tenta usá-lo, então é recusado.
- [ ] CA-3: Dado fuso inválido "America/Inexistente", quando salva, então o servidor recusa.
- [ ] CA-4: Dado um valor de grade fora da lista permitida, quando salva, então o servidor recusa; dado 30 min, então o valor é persistido e exibido na tela.

## Validação
Unitários (validação); integração com PostgreSQL real (slugs; isolamento conforme G-4). Gate padrão.

---

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #15 (E2)
- Bloqueada por: #12 (E1.2)
- Bloqueia: #41 (E6.4), #52 (E8.2)
- Relacionadas: #27 (E3.1), #37 (E4.1)

## Entregáveis
- src/app/painel/configuracoes/** (nome, fuso IANA, grade, antecedência, janela, intervalo, slug)
- src/server/salao/configuracoes.ts e troca de slug em salao_slug (atual + histórico, unicidade global)
- tests/integration/salao/configuracoes.test.ts e slug-historico.test.ts

## Papel responsável
- Desenvolvedor
- Apoio/revisão: DBA, Tester

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E2.5`. Prioridade P1, tamanho M (Project #3)._
<!-- agenda-beleza-backlog:E2.5 -->
