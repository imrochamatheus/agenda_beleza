# Issue #10 — Criar a base visual e de navegação: tema terroso, tipografia, layout responsivo e acessível

## Objetivo
Oferecer componentes e layout reutilizáveis que atendam à direção visual, pt-BR/BRL, responsividade e uso por teclado.

## Origem e contexto
PLAN.md, "Interface" (direção visual, celular e computador, teclado, marca Agenda Beleza); CLAUDE.md, "UI conventions". Atual: inexistente.

## Escopo
- Tokens de cor (terrosos e nude, sem rosa genérico), tipografia serifada nos títulos e sem serifa no corpo, espaçamentos.
- Componentes base: botão, campo, select, checkbox, diálogo de confirmação, alerta/estado vazio/estado de erro, tabela/lista, calendário/grade de horários.
- Layouts: público, painel (navegação por perfil: gestor, profissional) e super admin.
- Utilitários de formatação pt-BR: moeda BRL, data/hora no fuso do salão.

## Fora do escopo
Copiar visual ou textos de AppBarber/AppBeleza.

## Especificação
Decidido:
- RN-1: todos os componentes interativos são alcançáveis e operáveis por teclado, com foco visível.
- RN-2: diálogos prendem o foco e fecham com Esc.
- RN-3: contraste de texto mínimo WCAG AA.
- RN-4: valores monetários exibidos como `R$ 79,00`; datas em `dd/mm/aaaa` e horas em `HH:mm`.
Sugestão (não decidida): checagem automática de acessibilidade com axe no Playwright.

## Critérios de aceite
- [ ] CA-1: Dado o valor 7900 centavos, quando formatado, então exibe `R$ 79,00`.
- [ ] CA-2: Dado um instante UTC `2026-03-10T13:00:00Z` e fuso `America/Sao_Paulo`, quando formatado, então exibe `10/03/2026 10:00`.
- [ ] CA-3: Dado o layout do painel em viewport de 375 px, quando a página carrega, então não há rolagem horizontal e a navegação é acessível por um botão de menu.
- [ ] CA-4: Dado um diálogo de confirmação aberto, quando se navega só com Tab/Shift+Tab/Enter/Esc, então é possível confirmar, cancelar e o foco volta ao elemento de origem.

## Validação
Testes unitários dos formatadores e componentes; teste Playwright de teclado e viewport móvel. Gate padrão.

---

> **Gate padrão:** cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração com PostgreSQL real, sem mocks de banco), build, lint e typecheck passando, e veredito APROVADO do tester.

## Dependências
- Issue pai (épico): #2 (E0)
- Bloqueada por: #3 (E0.1)
- Bloqueia: #12 (E1.2), #33 (E4.3), #54 (E9.1)

## Entregáveis
- src/app/globals.css com tokens terrosos/nude e contraste WCAG AA; fontes serifada e sem serifa via next/font
- src/components/ui/** (Button, Field, Select, Checkbox, ConfirmDialog com <dialog> nativo, Alert, EmptyState, DataList, SlotGrid)
- src/components/layout/{PublicLayout,PanelLayout,AdminLayout}.tsx com navegação por papel e menu móvel
- src/lib/format.ts (BRL, data e hora no fuso do salão) com testes unitários
- e2e/a11y-base.spec.ts (teclado, foco do diálogo, 375 px sem rolagem horizontal, `@axe-core/playwright`)
- src/app/dev/componentes/page.tsx (vitrine para E2E, 404 em produção)
- src/config/navegacao.ts com todas as rotas da v1

## Papel responsável
- Desenvolvedor
- Apoio/revisão: Tester

---
_Origem: demanda D-001 (backlog do PLAN.md), chave `E0.8`. Prioridade P0, tamanho L (Project #3)._
<!-- agenda-beleza-backlog:E0.8 -->
