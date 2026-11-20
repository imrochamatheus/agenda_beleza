# D-014 — Desenvolvimento (T-1 a T-7)

Branch `feat/d-014-servicos` (base `main` 3184d91). Nada commitado. Sem migração, variável de ambiente nem dependência nova; `prisma/**` e `tests/support/**` intocados.

## 1. Tarefas concluídas e arquivos

| Tarefa | Arquivos |
|---|---|
| T-1 rotas, formatação, contratos e validação | `src/config/navegacao.ts` (`novoServico`, `servico(id)`) + `navegacao.test.ts`; `src/lib/format.ts` (`formatarMoedaSemSimbolo`, `formatarDuracao`; `formatarMoeda` = `R$` + NBSP + `formatarMoedaSemSimbolo`, mesmo comportamento) + `format.test.ts`; `src/server/servicos/tipos.ts` (novo, sem imports); `src/server/servicos/validacao.ts` + `validacao.test.ts` (novos) |
| T-2 repositórios e leitura pública | `src/server/repos/servico.ts` (criar, listarParaPainel/buscarParaPainel com `_count` de profissionais **ativos**, listarProfissionaisParaVinculo, travarProfissionaisParaVinculo `FOR SHARE OF p`, travarParaAlteracao `FOR NO KEY UPDATE OF s`, atualizarDados, definirAtivo, substituirVinculosAtivos `DELETE … USING` + `INSERT … unnest … ON CONFLICT DO NOTHING`; cabeçalho com a ordem canônica de travas), `src/server/repos/publico.ts` (RN-7), `src/server/repos/tipos.ts`, `src/server/repos/index.test.ts`, `tests/integration/servicos/{repos,publico}.test.ts` |
| T-3 serviço de domínio e ações | `src/server/servicos/{servico.ts, servicos.acao.ts}`, `tests/integration/servicos/apoio.ts`, `tests/integration/servicos/{criar-editar,situacao,vinculos,isolamento-permissoes}.test.ts` |
| T-4 concorrência | `tests/integration/servicos/concorrencia.test.ts` |
| T-5 componentes | `src/app/painel/servicos/{estado.ts, FormularioServico.tsx/.module.css/.test.tsx, ListaServicos.tsx/.test.tsx, ControleSituacao.tsx/.test.tsx, Servicos.module.css}` |
| T-6 páginas e casca | `src/app/painel/servicos/{page.tsx, acoes.ts}`, `novo/page.tsx`, `[id]/page.tsx`, `tests/integration/servicos/paginas.test.ts` |
| T-7 documentação e gates | `README.md` (seção "Serviços"; `formatarMoedaSemSimbolo`/`formatarDuracao` em "Formatação"), este arquivo |

## 2. Comandos e resultados

Todos os números abaixo são da versão final, depois da correção do `ControleSituacao` (§4, desvio 1).

| Comando | Resultado |
|---|---|
| `npm run db:generate` | ok (Prisma Client 7.10.1); typecheck repetido em seguida, verde |
| `npm run lint` | passou, 0 avisos, depois da correção de `EmptyState.test.tsx` (§4, desvio 4); antes dela falhava só por esse arquivo |
| `npx vitest run src/components/ui/EmptyState.test.tsx` | 2/2 verdes |
| `npm run typecheck` | passou |
| `npm run build` | passou; rotas `ƒ /painel/servicos`, `ƒ /painel/servicos/[id]`, `ƒ /painel/servicos/novo` |
| `npm test` ×3 seguidas | 3× verde: 172 arquivos, 2251 testes |
| `npm run test:coverage` | verde; **linhas 99,87 %** (2380/2383); statements 99,35 %, branches 98,2 %, functions 99,68 %. `src/server/servicos/` e `src/app/painel/servicos/**` com 100 % de linhas; a única linha não coberta perto do tema é `src/server/profissionais/servico.ts:164`, anterior a esta demanda (D-013) |
| `npm run test:e2e` | 48 passaram (sem E2E novo, D-12) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/servicos/concorrencia.test.ts \|\| break; done` | 10/10 verdes (5 testes cada); `deadlock`, `23505` e `duplicate key` ausentes nos 10 logs |
| `npx vitest run --project integration tests/integration/tenant/publico.test.ts tests/integration/auth/cadastro-paginas.test.ts tests/integration/tenant/registro.test.ts` | verdes **sem mudança** nesses arquivos (27 testes; o registro enxerga as 4 ações novas) |

Estado final: só o container `postgres` no ar; porta 3000 livre (o `next start` usado no passo manual foi encerrado).

### Passo manual do CA-14 (375×812, só teclado, com e sem JavaScript)

Executado com Chromium (Playwright, roteiro descartável fora do repositório, em `scratchpad/`) contra `npm run start` + PostgreSQL de desenvolvimento, com um salão criado por SQL (gestora confirmada e três profissionais: Ana e Bia ativas, Clara inativa). Toda a interação depois do `goto` é por teclado: Tab até o elemento, digitação, **Espaço** nas caixas e **Enter** nos botões e links. O mesmo roteiro rodou duas vezes: com JavaScript e com `javaScriptEnabled: false`. Resultado, nos dois modos, 19/19 verificações:
- login por teclado → `/painel/servicos`; lista sem rolagem horizontal em 375 px;
- Tab até "Cadastrar serviço" → Enter → formulário; preço `80.00` e duração `7` → Enter: **erros vindos do servidor** visíveis ("Informe o preço em reais…", "Informe a duração em minutos…"), erro de preço ligado ao campo por `aria-describedby`, nome preservado;
- corrige para `80,00` e `45`, Espaço em "Ana Manual" (marcada) → Enter: volta à lista, que mostra `R$ 80,00` e `45 min`;
- Enter no link do nome → edição com Ana marcada, Clara (inativa sem vínculo) ausente; Espaço desmarca Ana e marca Bia → Enter: lista; reabrindo, Bia marcada e Ana não;
- Enter em "Desativar serviço" → "Serviço desativado. Ele não aparece mais na página pública." e o botão vira "Reativar serviço"; Enter → "Serviço reativado." e o botão volta; edição sem rolagem horizontal.

Esse passo encontrou um defeito, já corrigido (§4, desvio 1): sem JavaScript, a mensagem de desativar/reativar não aparecia.

## 3. Testes criados ou alterados × CA

| CA | Testes |
|---|---|
| CA-1 | `repos.test.ts` (criar no salão do contexto, ativo); `criar-editar.test.ts` ("Corte" 80,00/45 → salvo, linha de A, lista de A com `R$ 80,00`/`45 min`, ausente em B); `ListaServicos.test.tsx`; `paginas.test.ts` (lista renderizada e criar pela casca → redirect) |
| CA-2 | `criar-editar.test.ts`: serviço a 8000 da fábrica, edição para 90,00/30; itens continuam 8000/60; `reserva`/`reserva_item` iguais por `to_jsonb` |
| CA-3 | `situacao.test.ts`: contagem de `servico` igual, `ativo = false`, fora da leitura pública, reservas byte a byte iguais, vínculos mantidos, desativar idempotente, reativar devolve à leitura pública; reativar sem profissional → `ofertavel: false`; `publico.test.ts` (S4) |
| CA-4 | `repos.test.ts` (trava só devolve ativos de A); `vinculos.test.ts` (id de B, inexistente e `'abc'`, no criar e no editar: mesma mensagem, contagens de vínculos de A e B e o serviço inalterados) |
| CA-5 | `validacao.test.ts` (todas as entradas da lista, aceitos da D-1, ida e volta com `formatarMoeda`/`formatarMoedaSemSimbolo`, ausência de `parseFloat`/`Number(texto)`); `criar-editar.test.ts` (pela ação, nada gravado; também na edição); `FormularioServico.test.tsx` (erros ligados); `paginas.test.ts` (casca: erros e valores cortados) |
| CA-6 | `repos.test.ts` (`listarProfissionaisParaVinculo`, `substituirVinculosAtivos`); `vinculos.test.ts` (marca → linha existe e `obterParaEdicao` mostra `vinculado`; desmarca → linha some, reservas iguais); `paginas.test.ts` (caixa marcada no HTML; `FormData` sem `profissionais` remove os vínculos com ativos) |
| CA-7 | `repos.test.ts` (preserva inativo); `vinculos.test.ts` (conjunto vazio remove P1 e preserva P2; vincular P2 recusado no editar e no criar); `paginas.test.ts` ("Inativo, vínculo mantido") |
| CA-8 | `servicos/publico.test.ts` (S1..S4, só os 4 campos, reativar P faz S3 aparecer, A × B); `tests/integration/tenant/publico.test.ts` verde **sem mudança** |
| CA-9 | `repos.test.ts`; `isolamento-permissoes.test.ts` (editar/desativar/reativar com id de B, inativo de B, inexistente, `'abc'`, 42, `undefined` → 404 uniforme; serviços e vínculos de B iguais, inclusive `atualizado_em`; D-18: entrada inválida com id de B → `invalido`); `paginas.test.ts` (`notFound`) |
| CA-10 | `repos.test.ts` (ordem D-10, contagem só de ativos); `isolamento-permissoes.test.ts`; `paginas.test.ts` |
| CA-11 | `isolamento-permissoes.test.ts` (profissional → 403 nas 4 ações sem alterar o banco; serviço de domínio recusa; sem sessão → 401; super admin → 403; metadados `{ papeis: ['gestor'], capacidade: 'configurar' }`); `tests/integration/tenant/registro.test.ts` verde sem mudança; `paginas.test.ts` ("Acesso negado" nas três páginas, inclusive com id de B; redirect para `/entrar?proximo=…`) |
| CA-12 | `criar-editar.test.ts` (criar com dois ativos cria tudo junto; preço/duração inválidos com vínculos → nada muda); `vinculos.test.ts` (profissional inválido → nada muda) |
| CA-13 | `criar-editar.test.ts` (dois "Corte" no mesmo salão) |
| CA-14 | `format.test.ts`; `FormularioServico.test.tsx` (rótulos, `inputMode`, ajuda "Ex.: 80,00", `fieldset`/`legend`, caixas rotuladas, inativo sem caixa, erros ligados por `aria-describedby`, inclusive o do fieldset, valores e caixas preservados); `ListaServicos.test.tsx`; `ControleSituacao.test.tsx` (botão por situação, `role="status"`/`"alert"`, mensagem da última ação); `paginas.test.ts`; passo manual (§2) |
| CA-15 | `concorrencia.test.ts`: (a) determinístico em fila na trava do serviço → conjunto final = o da 2ª; (b) `Promise.all` ×5 → ambos `salvo`, final ∈ {S1, S2}; R-2 com `COMMIT` (recusa sem escrita) e com `ROLLBACK` (aceita); R-3 (10 edições em 2 serviços + desativar/reativar profissional, nenhuma rejeição) |

Também alterados: `src/server/repos/index.test.ts` (métodos novos com ID malformado e contexto inválido, `travarProfissionaisParaVinculo` sem UUID válido → `[]` sem consulta), `src/config/navegacao.test.ts` (rotas novas codificadas e item ativo "Serviços"; `SEGMENTOS_RESERVADOS` inalterado), `src/lib/format.test.ts`.

## 4. Desvios do desenho e riscos

1. **`ControleSituacao` usa dois `useActionState` (um por ação), sempre na mesma ordem**, em vez de um hook com a ação escolhida pela situação (§3.6 diz "cada um com a sua ação", sem fixar a forma). Motivo: o passo manual sem JavaScript mostrou que, com um hook só, a ação muda depois da revalidação (ativo → inativo) e o React descarta o estado devolvido pelo POST: o serviço era desativado, mas a mensagem não aparecia. Com dois hooks fixos, o estado volta ao hook que enviou o formulário. A mensagem mostrada é a da última ação enviada (registrada no `onSubmit`, com JS); sem JS só um hook tem estado. Testes: `ControleSituacao.test.tsx` (sequência desativar → reativar → desativar e erro com prioridade) e o passo manual nos dois modos.
2. **Lint bloqueado por arquivo fora da posse (resolvido no desvio 4).** Ao criar `src/app/painel/servicos/page.tsx`, a regra `@next/next/no-html-link-for-pages` passou a acusar o `href="/painel/servicos"` literal de `src/components/ui/EmptyState.test.tsx:13`.
3. `tests/integration/servicos/apoio.ts` reexporta `ctxDoGestor`/`ctxDoProfissional` de `tests/integration/profissionais/apoio.ts` (só leitura), e `concorrencia.test.ts` importa `cancelarReservasDoSalao` dele, como o design permite.
4. **`src/components/ui/EmptyState.test.tsx` alterado (decisão do líder, posse transferida à D-014 nesta rodada):** na linha 13, `href="/painel/servicos"` virou `href="#cadastrar-servico"`, sem `eslint-disable`. O teste continua verificando título, descrição e link pelo nome. Depois disso, `npm run lint` passou com 0 avisos e `npx vitest run src/components/ui/EmptyState.test.tsx` deu 2/2.
   Reprodução, com a linha 13 ainda literal e sem `.eslintcache` no repositório: `npm run lint` e `npx eslint src/components/ui/EmptyState.test.tsx` saem com 1, com e sem `.next`, e também com o cwd em `src/`. Com `src/app/painel/servicos/` movida para fora, saem com 0. A regra dispara sempre que existe alguma rota em `src/app/painel/servicos/**`; mesmo sem `page.tsx` ela continua disparando por causa de `novo/` e `[id]/`. Um checkout sem essa pasta (que nesta branch ainda não está versionada) não mostra o erro.
5. `ListaServicos` mostra o aviso "Não aparece na página pública…" dentro da célula "Situação" (o design só diz "na linha").
6. Sem E2E Playwright novo (D-12); o job `e2e` segue sem banco.

Riscos conhecidos:
- **E3.2/E3.4/E3.5** precisam seguir a ordem canônica (profissional `FOR SHARE` → serviços `FOR SHARE` → reserva/itens) e conferir `servico.ativo` e o vínculo dentro da transação; registrado no cabeçalho de `src/server/repos/servico.ts` e no design §11.
- Os tetos D-2/D-3 (R$ 99.999,99 e 720 min) existem só na aplicação, sem CHECK no banco (design §1.1).
- O passo manual deixou, na base de **desenvolvimento** (`agenda_beleza`, não a de teste), um salão "Salão Manual mwovudgl" com gestora e serviços de teste. Não foi apagado (FKs `RESTRICT`); é inofensivo e pode ser descartado com `docker compose down -v` se desejado.

## 5. Texto sugerido para o `CLAUDE.md` (líder)

**Project status** (acrescentar ao fim do parágrafo): "D-014 (E2.1) added service management: `src/server/servicos/` (`tipos.ts`, client-safe contracts, limits and pt-BR messages; `validacao.ts`, pure validation with a pt-BR price parser to integer cents by text and integer arithmetic, never `parseFloat`; `servico.ts`; `servicos.acao.ts`, four `defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })`) and `/painel/servicos` (list, `/novo`, `/[id]` with the professional checkboxes and a no-dialog deactivate/reactivate form) with the `acoes.ts` shell; `formatarDuracao` and `formatarMoedaSemSimbolo` in `src/lib/format.ts`. Price is 0 to R$ 99.999,99 and duration a multiple of 5 from 5 to 720 min, enforced in the application only. Services are never deleted; editing price/duration never touches `reserva_item` (snapshot). Saving a service replaces only the links with **active** professionals (links with inactive ones are kept) in one transaction; the `profissionais` input key is mandatory (`[]` means none). `listarServicosPublicos` (`src/server/repos/publico.ts`) now returns only active services with at least one active linked professional and is the single source of offerable services for E3.1/E4.1. Canonical lock order (header of `src/server/repos/servico.ts`, binding for E3.x): professional(s) `FOR SHARE`/`FOR UPDATE` → service(s) `FOR SHARE`/`FOR NO KEY UPDATE` → `servico_profissional`/`reserva`/`reserva_item`. A form whose action changes after revalidation must keep one `useActionState` per action in a fixed order, or the no-JS response state is dropped."

**Comandos** (nova linha da tabela):

| Estabilidade de serviços (D-014) | `for i in $(seq 10); do npx vitest run --project integration tests/integration/servicos/concorrencia.test.ts \|\| break; done` | CA-15 (duas edições do mesmo serviço, em fila e em paralelo) e vínculo × desativação de profissional, sem impasse |
