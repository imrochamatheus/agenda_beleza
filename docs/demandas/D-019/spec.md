# D-019 — Alinhamento à Trinks (documentação e backlog)

Demanda só de documentação e backlog, conduzida pelo líder. Não altera código.

## Entregas

- `docs/trinks-alinhamento.md`: decisões DT-1..DT-10 e precedência, fontes classificadas (observado/ajuda/proposta), jornadas, comparação, matriz dos 55 itens do Project #3 + 4 novos, roteiro posterior, critérios verificáveis, impactos e ordem de execução.
- `PLAN.md`: perfil público, funcionamento ∩ jornada, avaliações verificadas, quarto modelo de WhatsApp, moderação, armazenamento S3, novo critério de aceite 11 (agora são 12).
- `CLAUDE.md`: referência ao documento e atualização dos requisitos do README (4 modelos, S3).
- `docs/demandas/D-018/`: especificação e desenho da disponibilidade preservados sem alteração (commit 56832d4); a revisão do funcionamento é feita na própria D-018, antes da implementação.
- GitHub, em 20/11/2026:
  - Novas issues #75 (E2.6), #76 (E2.7), #77 (E4.5) e #78 (E8.4). Cada uma está no Project #3 com Status Backlog, Priority e Size definidos, e vinculada como sub-issue de #15, #15, #32 e #22, respectivamente.
  - Seção "Revisão D-019" acrescentada a #15, #17, #20, #22, #23, #24, #27, #28, #30, #31, #32, #33, #34, #35, #36, #37, #38, #39, #41, #42, #43, #44, #45, #46, #48, #50, #54, #55 e #56.
  - O título de #56 passou a dizer "12 critérios".
  - As issues concluídas não foram alteradas.

## Verificação

- Project #3, antes das mudanças: 55 itens (16 Closed/Done, 39 Open/Backlog). Fonte: consulta GraphQL `user.projectV2(number:3).items`.
- Depois das mudanças: 59 itens.
- As chaves E2.6, E2.7, E4.5 e E8.4 estavam livres. A busca percorreu `docs/`, `PLAN.md`, `CLAUDE.md` e os marcadores `agenda-beleza-backlog` das issues.
