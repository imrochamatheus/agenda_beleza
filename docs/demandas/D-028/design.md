# D-028 (E3.3): Design da agenda da equipe

## 1. Solução e alternativas
Leitura pura. Um serviço `src/server/agenda/consultar.ts` monta o período (fuso do salão), chama UMA leitura nova do repo (reservas por sobreposição com JOIN de profissional, cliente e itens agregados) e reutiliza `lerBloqueios`, `lerSemana` (jornada) e `lerFuncionamento`. Páginas Server Component com links GET. Sem `*.acao.ts`, sem migração, sem infra.
Descartado: alterar `listarPorPeriodo` (R-3: chamadores da D-025 dependem de `inicio`); N+1 por cliente/itens (CA-16); grade com JS (CA-14).

## 2. Componentes (caminhos)
- `src/server/repos/agenda.ts` (novo; `Repos.agenda`; único com Prisma): `listarAgenda(ctx, {de, ate, profissionalId?, limite})` e `detalhe(ctx, id)`.
- `src/server/agenda/tipos.ts` (client-safe: DTOs, limites, mensagens), `validacao.ts` (puro: `lerParametros({data, visao, profissional})`, padrões, ±5 anos), `periodo.ts` (puro: dia/semana via `intervaloDeDiasInteiros`/`partesLocais`, domingo = 0), `faixas.ts` (puro: minutos "Fechado"/"Fora da jornada" por dia e profissional), `consultar.ts` (`consultarAgenda`, `lerReservaDaAgenda`), `rotulos.ts` (status → texto).
- Páginas: `src/app/painel/agenda/page.tsx`, `src/app/painel/agenda/reservas/[id]/page.tsx`, `src/app/painel/agenda/_componentes/*` (grade dia, lista semana, barra de navegação por `<a>`; sem `'use client'` salvo necessidade). `ROTAS.agendaReserva(id)`/`ROTAS.devAgenda` em `src/config/navegacao.ts` (item "Agenda" já existe para os dois papéis; só link em `/painel/page.tsx` se faltar).
- Vitrine `src/app/dev/agenda/page.tsx` (404 sem `VITRINE_COMPONENTES=true`/dev; dados em memória, mesmos componentes e funções puras).

## 3. Interfaces
- `consultarAgenda(ctx: TenantContext, entrada: {data?, visao?, profissional?}, agora): Promise<AgendaVista>` onde `AgendaVista = { visao, dias: DiaLocal[], colunas: ColunaProfissional[] (id, nome, ativo, reservas[], bloqueios[], faixas), salaoFechado por dia, truncada: boolean }`. Papel: `exigirPermissao(ctx,'agenda.ver')`; profissional: filtro forçado ao próprio (`filtroDeProfissional`), parâmetro ignorado (RN-12); gestor: `profissional` inválido/estrangeiro → `NaoEncontrado`. `data`/`visao` inválidos → padrão (hoje no fuso, dia).
- `lerReservaDaAgenda(ctx, id)`: `exigirPermissao`, id malformado/outro salão/outro profissional → `NaoEncontrado` único (404 uniforme); contato via `lerContatoDaCliente` (só para quem tem `cliente.contato`; falha dela não vira 500 nem revela motivo); anonimizada → `TEXTO_CLIENTE_REMOVIDA`. Sem mensagens.
- Horários só por `src/lib/format.ts`; sem `Date` local.

## 4. Dados (DBA: NÃO)
Sem migração. Consulta de reservas: `salao_id = $1 AND inicio < $ate AND fim > $de AND inicio >= $de - interval '7 days' [AND profissional_id = $p] ORDER BY inicio, id LIMIT 201`. O limite inferior de 7 dias (máx. 10 serviços × 720 min = 5 dias) permite usar `reserva_salao_id_inicio_idx`/`..._profissional_id_inicio_idx` (já existem) sem varrer o histórico. `reserva_sem_sobreposicao` é parcial (só ocupantes), não serve para canceladas; por isso não depender dele. Itens por `json_agg`/`LEFT JOIN LATERAL` na mesma instrução; profissional e cliente por JOIN. Obrigação do teste de integração (CA-16/plano): `EXPLAIN` com ~5.000 reservas num salão deve mostrar Index Scan em um dos índices acima (sem Seq Scan na `reserva`); se não usar índice, abre-se parecer do DBA (índice `(salao_id, profissional_id, inicio)` já cobre; novo índice só por parecer).
Estático: 200 reservas por período (`limite` 200, busca 201 → `truncada` e aviso).

## 5. Infra (DevOps: NÃO)
Sem env, container ou CI novos; E2E novos rodam no job `e2e` existente.

## 6. Invariantes
- Escopo por salão: `salao_id` do contexto em todo SQL; testes de isolamento X/Y (CA-11), 404 no detalhe cruzado. Aplica.
- Exclusion constraint: não aplica (leitura); nada de escrita.
- UTC + fuso: aplica (RN-2/CA-3/CA-13; testes em `TZ=UTC` e `America/Sao_Paulo`; fuso de DST com data de transição).
- Adaptadores: não aplica; a vitrine não usa integração.
- Soft delete/anonimização: aplica (inativos visíveis ao gestor; anonimizada = "cliente removida").
- Suspenso: aplica; NENHUMA checagem de suspensão (CA-10, teste com fábrica).
- Idempotência de webhook/mensagem: não aplica.
- Auditoria super admin: não aplica.
- Lint: página e vitrine não importam Prisma; teste estático garante que `src/app/(publico)` e `src/server/**/publico*` não importam `server/agenda` (CA-17).

## 7. Riscos
R-1 volume: limite 200 + aviso e filtro. R-2 plano: EXPLAIN no teste. R-3 vazamento de telefone na grade: DTO da grade não tem telefone (tipo). R-4 semana no celular: lista empilhada por dia, sem grade horizontal. R-5 sem `Date` local: teste estático existente de `format.ts` + `fuso.ts` cobre. Colunas do gestor: profissional com reserva/bloqueio/jornada no período (inativos vazios omitidos); bloqueios do salão replicados em cada coluna.

## 8. Testes
Unitários (Vitest, 2 fusos): validacao, periodo (DST 23/25 h, mês/ano), faixas (CA-7/8/13), rotulos, componentes (jsdom; CA-5, 12, 17). Integração PostgreSQL real: CA-1, 2, 3, 5, 6, 9 (fronteira), 10, 11, 13, 15, 16 (contagem de instruções constante com 1 vs 50 reservas e 1 vs 5 profissionais), EXPLAIN. Playwright em `/dev/agenda`: CA-4 (375×812, axe 4.14.0, Tab), CA-7/8 visuais, CA-14 sem JS (`e2e/agenda.spec.ts`, `agenda-sem-js.spec.ts`). Cobertura ≥ 90% mantida porque lógica fica em módulos puros testados.

## 9. Tarefas
- T-1 (desenvolvedor, sem deps): `src/server/agenda/{tipos,validacao,periodo,faixas,rotulos}.ts` + testes unitários. Critério: unitários verdes em UTC e America/Sao_Paulo.
- T-2 (desenvolvedor, sem deps; paralela a T-1): `src/server/repos/agenda.ts`, registro em `src/server/repos/index.ts`, `tests/integration/agenda/repo.test.ts` (inclui EXPLAIN, contagem). Critério: CA-11, 16, 6, plano com índice.
- T-3 (desenvolvedor, dep T-1, T-2): `src/server/agenda/consultar.ts` + `tests/integration/agenda/consultar.test.ts` (CA-1, 2, 3, 5, 9, 10, 12, 13, 15). Critério: verdes.
- T-4 (desenvolvedor, dep T-3): páginas e componentes em `src/app/painel/agenda/**`, `src/config/navegacao.ts`, `src/app/painel/page.tsx`, testes de componentes. Critério: build/lint/typecheck, CA-5, 12, 17.
- T-5 (desenvolvedor, dep T-4; paralela a T-6 com arquivos distintos): `src/app/dev/agenda/**`, `e2e/agenda*.spec.ts`. Critério: CA-4, 7, 8, 14.
- T-6 (desenvolvedor, dep T-3): `tests/integration/agenda/{isolamento,fuso,estatico}.test.ts`. Critério: CA-3, 11, 17.
- T-7 (desenvolvedor, dep T-1..T-6): README/CLAUDE.md (comandos de estabilidade/fuso/E2E), cobertura `npm run test:coverage`.
Paralelas: T-1 ∥ T-2; T-5 ∥ T-6.
