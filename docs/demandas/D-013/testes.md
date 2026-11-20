# D-013 — Testes (T-8, tester)

## Rodada 1 — 2026-11-20

**Veredito: APROVADO.** Nenhum defeito crítico, alto, médio ou baixo aberto. Há 4 observações sem defeito (§5).

### 1. Ambiente

- Branch `feat/d-013-profissionais`, base `3a3bd1b`, com as mudanças não commitadas do desenvolvedor (nada commitado pelo tester).
- Node v24.21.0, PostgreSQL 17 (`docker compose`, só o serviço `postgres`), adaptadores `simulado`, Chromium do Playwright em 375×812.
- Ao final, só o `postgres` estava no ar e a porta 3000 estava livre. O `next start` usado na prova manual foi iniciado e encerrado pelo tester.

### 2. Gates (reexecutados pelo tester)

| Comando | Resultado |
|---|---|
| `npm run db:generate` | ok (Prisma Client 7.10.1) |
| `npm run lint` | ok, 0 avisos (inclui o teste novo do tester) |
| `npm run typecheck` | ok |
| `npm run build` | ok; rotas `ƒ /painel/profissionais`, `/painel/profissionais/[id]`, `/painel/profissionais/novo` |
| `npm test` 5× seguidas | 5/5 verdes. Rodada 1: 159 arquivos e 2065 testes. Rodadas 2 a 5 (já com o teste do tester): 160 arquivos e 2069 testes |
| `npm run test:coverage` | verde. **Linhas 99,86 %** (2140/2143), statements 99,31 %, branches 98,23 %, funções 99,64 % |
| `npm run test:e2e` | 48/48 (sem E2E novo, conforme D-11) |
| Laço 10× `npx vitest run --project integration tests/integration/profissionais/concorrencia.test.ts tests/integration/profissionais/regressao-tester.test.ts` | 10/10 verdes (8 testes por execução); a palavra `deadlock` não aparece em nenhum log |
| `npm run db:migrate:deploy` (base de dev) | "No pending migrations" (a demanda não tem migração) |

**Cobertura, revisão:** `vitest.config.ts` não mudou: as exclusões continuam sendo só testes, `.d.ts` e o código gerado, cada uma justificada. A única linha nova sem cobertura é `src/server/profissionais/servico.ts:164` (`if (ctx.papel !== 'gestor') throw new AcessoNegado(...)`). Ela é inalcançável, porque a `exigirPermissao(ctx, 'profissional.gerir')` da linha anterior já recusa os papéis `profissional` e `super_admin` (a matriz dá `negado` para os dois), e o desenho (§3.5) a pediu. Aceito como defesa em profundidade, não como código morto: ela protege o serviço caso a matriz mude. Os testes novos verificam comportamento (estado do banco, resultado discriminado, `role="alert"`, foco). Não encontrei teste que só executa linhas.

### 3. Critérios de aceitação

| CA | Status | Evidência |
|---|---|---|
| CA-1 | passou | `criar-editar.test.ts`, `repos.test.ts`, `paginas.test.ts`. Manual: "Ana Tester" foi criada com `salao_id` do gestor, `usuario_id` nulo e `ativo` true |
| CA-2 | passou | `eu-tambem-atendo.test.ts`, `repos.test.ts`. Manual: com o teclado (Tab até "Eu também atendo", depois Enter), o gestor fica com exatamente 1 perfil e a lista mostra "Você" |
| CA-3 | passou | `desativar.test.ts` (02:30Z aparece como 23:30 do dia anterior; "cliente removida"). Manual: reserva em 2026-11-22T02:30Z aparece como "21/11/2026 23:30 — Corte Manual — Clara Manual" dentro de `role="alert"`, e `ativo` continua true |
| CA-4 | passou | `desativar.test.ts`. Manual: depois de desativar e reativar, a contagem de profissionais do salão não muda |
| CA-5 | passou | `desativar.test.ts` (login real). Manual: o usuário `profissional` tinha 2 sessões; o gestor desativou o perfil pela UI; as 2 sessões ficaram com `revogada_em`; a próxima requisição de cada uma redireciona para `/entrar?proximo=%2Fpainel`; o novo login é recusado com "Seu acesso está desativado"; as 2 sessões do gestor continuam válidas |
| CA-6 | passou | `eu-tambem-atendo.test.ts`, `desativar.test.ts`, `paginas.test.ts`. Manual: com JS desligado, o perfil inativo do gestor é reativado pelo mesmo id |
| CA-7 | passou | `desativar.test.ts`, `repos.test.ts` |
| CA-8 | passou | `desativar.test.ts` |
| CA-9 | passou | `isolamento-permissoes.test.ts`, `paginas.test.ts`, mais o teste do tester (o gestor de A edita, desativa e reativa o profissional, o perfil do gestor e o inativo de B: 404 nos três, e a fotografia de B fica igual). Manual: o id de outro salão e `abc` respondem HTTP 404 |
| CA-10 | passou | `isolamento-permissoes.test.ts`, `repos.test.ts`, mais o teste do tester ("eu também atendo" e criar em A não mudam B) |
| CA-11 | passou | `isolamento-permissoes.test.ts`, `pagina-operacao.test.ts`, `paginas.test.ts`, `tenant/registro.test.ts`. Manual: um `profissional` real vê "Acesso negado" na lista, em `/novo`, no próprio perfil e num UUID inexistente (o 403 vem antes do 404); sem sessão, o redirecionamento leva `proximo` |
| CA-12 | passou | `validacao.test.ts`, `texto.test.ts`, `criar-editar.test.ts`. Teste do tester: `null`, texto, array, tipos errados, campos extras (`salaoId`, `usuarioId`, `ativo`) e NUL no nome devolvem `invalido` sem gravar e sem exceção. Manual: `"  ANA.Tester@Exemplo.COM "` foi gravado como `ana.tester@exemplo.com`; sem JS, `BIA@Exemplo.com` foi gravado como `bia@exemplo.com` |
| CA-13 | passou | `criar-editar.test.ts`. Manual: o perfil vinculado mostra o e-mail de login e o campo e-mail com `readonly` |
| CA-14 | passou | `concorrencia.test.ts` (10×10 no laço: sempre 1 criado e 9 "já atende") |
| CA-15 | passou | `desativar.test.ts`, `define-acao.test.ts`. O ajuste de intervalo do item (b) feito pelo dev é correto: os intervalos do desenho se sobrepunham e a exclusion constraint os recusaria |
| CA-16 | passou | testes jsdom, mais a prova manual em 375 px com o teclado (§4). O axe (wcag2a/aa, 21a/aa) deu 0 violações na lista, em `/novo`, na edição, no diálogo aberto e com a recusa exibida. `scrollWidth` da lista = 375 |
| CA-17 | passou | `concorrencia.test.ts` (laço 10×) |

**Regressão D-7 (desativação × inserção de reserva)**, teste novo `tests/integration/profissionais/regressao-tester.test.ts`. Uma conexão `pg` insere uma reserva `confirmado` futura e não faz commit. A desativação **espera** pela trava (comprovado em `pg_stat_activity`, `wait_event_type = 'Lock'`). Com COMMIT, a desativação devolve `recusado` com 1 reserva e `ativo` continua true. Com ROLLBACK, ela devolve `desativado`. Esse teste confirma a escolha de `FOR UPDATE` (e não `FOR NO KEY UPDATE`). Passou 10/10 no laço.

### 4. Prova manual (navegador real contra `next start` e a base de dev)

Scripts descartáveis, fora do repositório: `/tmp/claude-1000/-home-cliente--rea-de-Trabalho-agenda-beleza/a38ad171-2133-4b71-9022-799f08c3285b/scratchpad/manual.cjs` e `manual2.cjs`. O gestor foi criado pelo fluxo real: `/cadastro`, depois o link do `email_log` (adaptador simulado), depois `/entrar`.

- **Com JS e só com o teclado (375×812):** estado vazio; Tab até "Eu também atendo" e Enter; em `/novo`, Enter com o nome vazio dá `aria-invalid=true` e `aria-describedby` apontando para o erro; criar; editar com Enter; "Desativar" com Enter abre o diálogo com o foco em "Cancelar"; Esc fecha o diálogo e devolve o foco para "Desativar"; Espaço reabre; Tab e Enter confirmam; a recusa aparece em `role="alert"`; depois de cancelar a reserva, a desativação é aceita e a página passa a mostrar "Reativar"; Espaço em "Reativar" reativa.
- **Sem JS:** criar com nome inválido mostra o erro do servidor; criar válido redireciona para a lista; editar redireciona para a lista com o nome gravado; "Reativar" (formulário POST) funciona; "Eu também atendo" funciona. "Desativar" é `type="button"` e precisa de JS (veja OBS-2).
- **Logs do servidor:** só os eventos `profissional.desativado` e `profissional.desativacao_recusada`, com ids e contagens, sem nomes nem e-mails; nenhum erro.
- A base de dev guarda o salão "Salão Tester …" e os usuários `tester-…@exemplo.com.br` e `prof-…@exemplo.com.br`. Eles não afetam os testes.

### 5. Observações (sem defeito, para o líder decidir)

- **OBS-1:** `servico.ts:164` é inalcançável (§2). Mantida por desenho.
- **OBS-2:** a desativação não funciona sem JS (é um `ConfirmDialog` acionado no cliente). A spec não exige caminho sem JS para ela. A reativação, a criação, a edição e o "Eu também atendo" funcionam sem JS.
- **OBS-3:** quando "Eu também atendo" dá certo, a revalidação faz o componente sumir (o gestor passa a ter perfil ativo) e a mensagem de sucesso não chega a aparecer. A lista mostra o perfil "Você", que serve de confirmação. Cosmético.
- **OBS-4:** a página "Acesso negado" responde HTTP 200. É o padrão já adotado na D-010 (D-9, opção b), e a spec pede só que a página a renderize.

### 6. Defeitos

Nenhum.

### 7. Arquivos do tester

- `tests/integration/profissionais/regressao-tester.test.ts` (novo, 4 testes): D-7 com commit e com rollback, isolamento ampliado A×B e entradas hostis.
- `docs/demandas/D-013/testes.md` (este arquivo).
