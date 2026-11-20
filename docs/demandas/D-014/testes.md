# D-014 — Testes (T-8, tester)

## Rodada 1 — 2026-11-20

**Ambiente:** branch `feat/d-014-servicos` (base `main` 3184d91, mudanças não commitadas), Node v24.21.0, PostgreSQL 17 (compose), adaptadores `simulado`, Chromium do Playwright, viewport 375×812. Evidências brutas no scratchpad da sessão (logs `gates.txt`, `test1..5.log`, `cov.log`, `conc1..10.log`, `e2e.log`, roteiro `manual.cjs`).

### Gates (reexecutados, sem aproveitar a evidência do desenvolvedor)

| Comando | Resultado |
|---|---|
| `npm run db:generate` | exit 0 |
| `npm run lint` | exit 0, 0 avisos (repetido com o arquivo de regressão do tester: `npx eslint … --max-warnings=0` ok) |
| `npm run typecheck` | exit 0 (repetido com o arquivo do tester: ok) |
| `npm run build` | exit 0; rotas `ƒ /painel/servicos`, `ƒ /painel/servicos/[id]`, `ƒ /painel/servicos/novo` |
| `npm test` ×5 seguidas | 5/5 verdes: rodadas 1-2 com 172 arquivos/2251 testes; rodadas 3-5 (com o arquivo do tester) 173 arquivos/2269 testes |
| `npm run test:coverage` | exit 0; **linhas 99,87 %**, statements 99,35 %, branches 98,2 %, functions 99,68 %; `src/server/servicos` e `src/app/painel/servicos/**` 100 % de linhas. `vitest.config.ts` inalterado (nenhuma exclusão nova) |
| `npm run test:e2e` | 48/48 passaram |
| Laço `for i in $(seq 10); do npx vitest run --project integration tests/integration/servicos/concorrencia.test.ts \|\| break; done` | 10/10 verdes, 5 testes cada; `deadlock`, `23505` e `duplicate key` ausentes nos 10 logs |
| Migrações | nenhuma migração nova; o harness aplica todas as migrações numa base limpa a cada execução (verde) e o compose subiu com `migrate deploy` (`/api/health` 200) |

### Teste de regressão adicionado pelo tester

`tests/integration/servicos/tester-regressao.test.ts` (18 testes, verdes):
- Preço pela ação: aceitos `"80"`→8000, `"80,5"`→8050, `"1.234,56"`→123456, `"R$ 0,00"`→0, `"R$ 80,00"`→8000, `"R$80"`, `"  0,10  "`→10, `"99.999,99"`→9999999, `"1234"`; recusados (erro `preco`, nada gravado) `"80.00"`, `"80,001"`, `"-1,00"`, `"100.000,00"`, `"abc"`, vazio, só espaços, `"12.34"`, `"1.23,00"`, `"1.2345"`, `"R$ -1"`, `"80,"`, `",50"`, `"1e3"`, `"0x10"`, dígitos de largura total, `80` (number), `null`, `undefined`, array. Ida e volta `formatarMoeda`/`formatarMoedaSemSimbolo` para 13 valores-limite; 10.000.000 recusado.
- Duração: 5 e 720 aceitos; `0`, `-5`, `7`, `725`, `"45.5"`, vazio, `"1e2"`, `45.5`, `"abc"`, `"-5"`, `null` recusados.
- Vínculos: ids repetidos e em maiúsculas deduplicados sem violação de PK; perfil do gestor vinculável (ofertável e na leitura pública); serviço inativo editável sem voltar à leitura pública; `[]` remove só ativos e preserva o inativo.
- Isolamento: editar serviço de B com profissional de B → `invalido` sem revelar existência; com conjunto vazio → 404; desativar/reativar → 404; serviço e vínculos de B iguais. Profissional recebe 403 (antes de 404) com id de A, de B, inexistente e `abc`.

### Prova manual (compose `docker compose up -d --build --wait`, teclado, 375 px)

Roteiro Playwright descartável (`manual.cjs` no scratchpad): cadastro do salão em `/cadastro`, confirmação pelo link de `email_log`, login, profissionais Ana/Bia/Clara cadastradas pela tela; depois o fluxo de serviços com JavaScript e com `javaScriptEnabled: false`. Toda interação após o `goto` é por Tab, digitação, Espaço e Enter. **42/44 verificações OK; as 2 "falhas" são do roteiro** (comparava `ativo` com `t`, mas `boolean || text` dá `true`): conferido por SQL que os serviços foram gravados (`123456/45/true` antes da edição, confirmado pela verificação "erro não gravou", e `8050/45/true` no fim).
Verificado nos dois modos: erros de preço/duração vindos do servidor, erro de preço ligado por `aria-describedby`, nome preservado; criação com `1.234,56`/45 e duas caixas → lista "R$ 1.234,56 / 45 min / 2"; edição com Ana marcada e Clara (desativada) como "Inativo, vínculo mantido" sem caixa; troca Ana→Bia; tudo desmarcado (nenhuma caixa no FormData) → só o vínculo inativo fica e a lista mostra o aviso "Não aparece na página pública…"; erro com caixa marcada preservada e nada gravado; `R$ 80,5` → 8050; desativar → `role=status` "Serviço desativado…", reativar → "Serviço reativado.", vínculos intactos; sem rolagem horizontal. Com JS: axe (wcag2a/aa, 21a/aa) sem violações na lista, no cadastro com erros e na edição (antes e depois de reativar).
Ao final: `docker compose stop app worker`; só o postgres no ar; porta 3000 livre.

### Critérios de aceitação

| CA | Situação | Evidência |
|---|---|---|
| CA-1 | passou | `criar-editar.test.ts`, `ListaServicos.test.tsx`, manual |
| CA-2 | passou | `criar-editar.test.ts` (snapshot por `to_jsonb`) |
| CA-3 | passou | `situacao.test.ts`, `publico.test.ts`, manual (vínculos intactos) |
| CA-4 | passou | `vinculos.test.ts`, `tester-regressao.test.ts` |
| CA-5 | passou | `validacao.test.ts`, `criar-editar.test.ts`, `tester-regressao.test.ts`, manual |
| CA-6 | passou | `vinculos.test.ts`, `paginas.test.ts`, manual com e sem JS |
| CA-7 | passou | `vinculos.test.ts`, `tester-regressao.test.ts`, manual |
| CA-8 | passou | `servicos/publico.test.ts`; `tenant/publico.test.ts` sem mudança, verde |
| CA-9 | passou | `isolamento-permissoes.test.ts`, `tester-regressao.test.ts`, `paginas.test.ts` |
| CA-10 | passou | `repos.test.ts`, `isolamento-permissoes.test.ts` |
| CA-11 | passou | `isolamento-permissoes.test.ts`, `paginas.test.ts`, `tenant/registro.test.ts`, `tester-regressao.test.ts` (403 antes de 404) |
| CA-12 | passou | `criar-editar.test.ts`, `vinculos.test.ts` |
| CA-13 | passou | `criar-editar.test.ts` |
| CA-14 | passou | testes jsdom, `paginas.test.ts`, manual com/sem JS e axe |
| CA-15 | passou | `concorrencia.test.ts` ×10 (inclui R-2 e R-3 com a desativação de profissional da D-013) |

### Revisão de código (invariantes)

- Isolamento: `salao_id` só do contexto; repositório filtra por salão em todas as consultas; FKs compostas como segunda barreira.
- Ordem de travas: profissionais `FOR SHARE` (ordenados por id) → serviço `FOR NO KEY UPDATE` → vínculos; a desativação de profissional da D-013 só trava `profissional` (`FOR UPDATE`) e reservas/sessões, sem tocar `servico`: sem ciclo possível.
- Preço: regex + inteiros pequenos (≤ 5 dígitos inteiros), sem `parseFloat`.
- Soft delete: não há ação de exclusão. Snapshot de `reserva_item` intocado.
- Desvio 4 (`EmptyState.test.tsx`): só troca o `href` literal por âncora; o teste continua verificando título, descrição e link.

### Observação (não é defeito; registrada para o líder)

- **OBS-1 (baixa, decisão de produto):** formulário de edição aberto quando P2 está inativo (vínculo mantido, sem caixa); P2 é reativado em outra aba; o formulário antigo é salvo → P2 está ativo e fora do conjunto enviado, então o vínculo é removido. Coerente com RN-10/D-5 (o conjunto substitui os vínculos com ativos no momento do salvamento), mas a gestora nunca viu a caixa de P2. Contorno: reabrir o formulário. Não bloqueia.

### Defeitos

Nenhum aberto.

### Veredito

**APROVADO.** 15/15 CAs, todos os gates verdes, cobertura de linhas 99,87 %, nenhum defeito crítico ou alto.
