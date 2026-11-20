# D-015 — Desenvolvimento (T-1 a T-8)

Branch `feat/d-015-jornada` (base `main` 96bd348), sem commit. Sem migração, variável de ambiente nem dependência nova; `prisma/**`, `tests/support/**`, `tests/integration/{tenant,profissionais,auth}/**`, `src/components/**`, `e2e/suporte/**` e as configurações não foram tocados.

## 1. Tarefas concluídas e arquivos

| Tarefa | Arquivos |
|---|---|
| T-1 | `src/server/auth/permissoes.ts` (+ `.test.ts`): `'jornada.ver'` = `salao`/`proprio`/`negado`. `src/config/navegacao.ts` (+ `.test.ts`): `ROTAS.devJornada`. `src/lib/format.ts` (+ `format.test.ts`): `formatarMinutosDoDia`, `formatarFaixaDeMinutos`, `formatarDiaDaSemana`. Novos: `src/server/jornadas/tipos.ts`, `validacao.ts` (+ `.test.ts`), `semana.ts` (+ `.test.ts`) |
| T-2 | Novo `src/server/repos/jornada.ts` (cabeçalho com a ordem canônica de travas, marcador `FOR NO KEY UPDATE OF pj`); `repos/index.ts` (`Repos.jornadas`), `repos/tipos.ts` (`JornadaLinhaDTO`, `TravaJornada`), `repos/index.test.ts`; `tests/integration/jornadas/repos.test.ts` |
| T-3 | Novos `src/server/jornadas/servico.ts` (`obter`, `salvar`), `leitura.ts` (`lerSemana`, para a E3.1), `jornadas.acao.ts` (`salvarJornada`); `tests/integration/jornadas/apoio.ts`, `salvar.test.ts`, `isolamento-permissoes.test.ts` |
| T-4 | `tests/integration/jornadas/concorrencia.test.ts` |
| T-5 | Novos em `src/app/painel/profissionais/[id]/jornada/`: `estado.ts`, `FormularioJornada.tsx` (+ `.test.tsx`), `VisaoJornada.tsx` (+ `.test.tsx`), `Jornada.module.css` |
| T-6 | Novos `src/app/painel/profissionais/[id]/jornada/page.tsx` e `acoes.ts`; seção "Jornada" em `src/app/painel/profissionais/[id]/page.tsx`; "Minha jornada" em `src/app/painel/page.tsx`; `tests/integration/jornadas/paginas.test.ts` |
| T-7 | Novos `src/app/dev/jornada/page.tsx` (+ `page.test.tsx`), `acoes.ts` (+ `acoes.test.ts`); `e2e/jornada.spec.ts`, `e2e/jornada-sem-js.spec.ts` |
| T-8 | `README.md` (seção "Jornada"); este arquivo |

## 2. Comandos e resultados

Todos os números são da versão final (depois da correção do aviso "Jornada salva.", §4, desvio 1).

| Comando | Resultado |
|---|---|
| `npm run db:generate` | ok (Prisma Client 7.10.1) |
| `npm run lint` | passou, 0 avisos (com as rotas novas presentes) |
| `npm run typecheck` | passou |
| `npm run build` | passou; rotas novas `ƒ /painel/profissionais/[id]/jornada` e `ƒ /dev/jornada` |
| `npm test` ×3 seguidas | 3× verde: 184 arquivos, 2412 testes (4 workers) |
| `npm run test:coverage` | verde; **linhas 99,88 %** (2677/2680); statements 99,35 %, branches 98 %, functions 99,72 %. Todos os arquivos novos de `src/` com 100 % de linhas, sem exclusão nova |
| `npm run test:e2e` | 54 passaram (6 novos: `jornada.spec.ts` e `jornada-sem-js.spec.ts`; `a11y-base.spec.ts` e os demais sem mudança) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/jornadas/concorrencia.test.ts \|\| break; done` | 10/10 verdes (6 testes cada), rodado duas vezes (antes e depois da correção do desvio 1); `deadlock` e `23P01` ausentes nos logs |
| `npx vitest run --project integration tests/integration/jornadas/paginas.test.ts tests/integration/profissionais/paginas.test.ts tests/integration/auth/paginas.test.ts` | verdes; os dois últimos **sem mudança** |
| `tests/integration/tenant/registro.test.ts` | verde sem mudança (enxerga `salvarJornada`) |

Estado final: só o container `postgres` no ar (`docker compose stop app worker`); porta 3000 livre.

### Passo manual (Docker, 375×812, só teclado, com e sem JavaScript)

`docker compose up -d --build --wait` (app, worker e postgres saudáveis; a app aplicou as migrações e serviu o build com o código final). Salão criado por SQL na base de desenvolvimento (gestora confirmada com perfil de profissional; Bia, profissional com usuário e jornada de segunda a sexta; Ana, ativa sem jornada; Clara, inativa), senha argon2id real. Roteiro descartável com Chromium (Playwright) fora do repositório (`scratchpad/manual/roteiro.mjs`), executado duas vezes: com JavaScript e com `javaScriptEnabled: false`. Depois do `goto`, toda a interação é por teclado (Tab/Shift+Tab, digitação, **Enter** em links, `summary` e para enviar), com a conferência de foco visível (contorno > 0) em cada parada. Resultado: **40/40 verificações** (20 por modo):
- login por teclado → `/painel`; Tab até "Minha jornada" → Enter abre a jornada da gestora (que atende), com o aviso de sem horários (CA-15);
- página da Ana → Tab até "Ver e editar a jornada" → Enter; sem rolagem horizontal a 375 px;
- Enter no `summary` "Segunda-feira", 09:00/12:00/13:00/18:00 → Enter: PRG `?salva=1`, "Jornada salva.", resumo "09:00–12:00, 13:00–18:00 · Pausa 12:00–13:00"; banco `(1,540,720)` e `(1,780,1080)` (CA-1);
- sexta 22:00–02:00 → Enter: erro do servidor ligado ao campo por `aria-describedby`, valor preservado, banco inalterado (CA-4); com JS o foco vai ao resumo de erros (CA-17); o aviso antigo "Jornada salva." some;
- Tab até o link do resumo → Enter → o Tab seguinte cai no campo de fim do intervalo; 24:00; terça 12:00–13:00 + 9:00–12:00 → banco `(2,540,780)` e `(5,1320,1440)`, exibido `22:00–24:00` (CA-5, CA-7);
- Clara (inativa): aviso de inativo (CA-14);
- profissional Bia: "Minha jornada" → somente leitura, sem campos nem botão, com intervalos, pausa e folga; a jornada da Ana → "Acesso negado"; id inexistente → 404 (CA-12).

O passo encontrou um defeito, já corrigido (§4, desvio 1).

## 3. Testes criados ou alterados × CA

| Arquivo | Casos | CA / risco |
|---|---|---|
| `src/lib/format.test.ts` (+3 describes) | 6 novos | CA-20 (0/5/545/1435/1440; −5, 1441, 1.5, NaN, ∞ e texto lançam), faixa com U+2013 e `inicio ≥ fim` lança, dia da semana 0..6 |
| `src/lib/format.fonte-unica.test.ts` | sem mudança, verde | CA-20 |
| `src/server/auth/permissoes.test.ts` | matriz + 1 caso | CA-12 (R-10): `jornada.ver` gestor/profissional próprio e outro/sem perfil/super admin; ver não dá editar |
| `src/config/navegacao.test.ts` | +3 asserções | `devJornada`, `jornada(id)` ativa "Profissionais"; `SEGMENTOS_RESERVADOS` inalterado |
| `src/server/repos/index.test.ts` | +1 caso, +8 chamadas | id malformado → `NaoEncontrado` sem consulta; contexto inválido → `Error`; listas vazias sem consulta |
| `src/server/jornadas/validacao.test.ts` | 23 (35 com `each`) | CA-2 (duas linhas, idênticos, não vizinhos), CA-4, CA-5, CA-6, CA-7, CA-9 (6 aceitos, 7 recusados, antes da união), R-5 (fronteiras, ida e volta), forma (6/8 dias, repetido, dia 7, `salaoId` extra, > 20 linhas, número) |
| `src/server/jornadas/semana.test.ts` | 8 | CA-1 (pausa), CA-15 (semana vazia), `diferenca` (igual/parcial/outro dia/vazia) |
| `.../jornada/FormularioJornada.test.tsx` | 10 | CA-1 (resumo/pausa/folga), CA-17 (fieldset/legend, rótulos, `pattern`, ajuda e erro em `aria-describedby`, `aria-invalid`, resumo focado com links na ordem de exibição, `details` aberto), R-7 (valores preservados), alertas, aviso pós-PRG que some no envio seguinte (desvio 1), `estado.ts` (leitura do FormData, cortes, imports) |
| `.../jornada/VisaoJornada.test.tsx` | 2 | CA-12 (sem campos), CA-15 (tudo folga), 24:00 |
| `src/app/dev/jornada/page.test.tsx` | 5 (12 com `each`) | 404 sem a variável sem ler parâmetros, metadados, três modos (R-11) |
| `src/app/dev/jornada/acoes.test.ts` | 3 (6 com `each`) | desligada → estado inicial; inválido/válido (R-11) |
| `tests/integration/jornadas/repos.test.ts` | 10 | CA-11 (listar só A; busca e trava 404 para B/inexistente/`abc`; `deleteMany` não toca B; FK composta), RN-13 (trava não filtra inativo), R-4 (DELETE + INSERT sobreposto na mesma transação), 23P01 e 23514 por SQL direto |
| `tests/integration/jornadas/salvar.test.ts` | 17 | CA-1 (+ log `jornada.salva`), CA-2 (ids iguais), CA-4, CA-5, CA-6, CA-7, CA-8 (dois cenários), CA-9, CA-10 (reserva byte a byte e `mensagem`), CA-14 (desativar/reativar pela D-013), CA-16 (Manaus e São Paulo), idempotência (D-13) |
| `tests/integration/jornadas/isolamento-permissoes.test.ts` | 11 | CA-3 (profissional própria/outra, super admin, 401), CA-11 (B/inexistente/`abc`, extras, precedência validação → 404), CA-12 (gestor que atende; `obter` 403/404), CA-15, CA-19 (metadados), `lerSemana` |
| `tests/integration/jornadas/concorrencia.test.ts` | 6 | CA-13: R-1 (a) fila determinística, (b) `Promise.all` ×10 (vazio e com jornada existente); R-2 `Promise.all(salvar, desativar)` ×10 e determinístico; R-3 (`FOR KEY SHARE NOWAIT` passa; `FOR SHARE`/`FOR UPDATE NOWAIT` → 55P03) |
| `tests/integration/jornadas/paginas.test.ts` | 15 | CA-1, CA-5, CA-11, CA-12, CA-14, CA-15, CA-16, CA-18 (casca com 6 intervalos), `?salva=1`, casca (PRG, `revalidatePath`, erros e valores, extras ignorados, 404/403/401), links "Jornada" e "Minha jornada" (D-9) |
| `e2e/jornada.spec.ts` | 3 | CA-17: teclado (Enter no `summary`, Tab/Shift+Tab, Enter envia), foco visível, resumo focado, link → campo, `aria-describedby`; axe em edição, edição com erro, leitura e vazia; sem rolagem horizontal |
| `e2e/jornada-sem-js.spec.ts` | 3 | CA-18: 6 intervalos → POST 200; inválido → erros e valores; leitura |

## 4. Desvios do desenho e riscos

Desvios (todos locais aos arquivos da demanda):
1. **Defeito achado no passo manual, corrigido com teste antes:** depois de um salvamento (`?salva=1`), um envio com erro mostrava "Jornada salva." junto do resumo de erros (com e sem JS). Agora o `aposSalvar` só aparece enquanto o formulário não tem resultado novo. O caso novo de `FormularioJornada.test.tsx` falha sem a correção (conferido revertendo-a) e passa com ela.
2. **`EstadoFormularioJornada.sucesso?: boolean`:** o §3.7 dizia "`mensagem` com `erros` vazio → Alert de sucesso", mas a casca devolve `mensagem` com `erros` vazio também para 403/404, que apareceriam como sucesso. A variante de sucesso agora exige `sucesso: true` (só a ação de demonstração o usa).
3. **`MENSAGENS_JORNADA.demonstracao`:** um arquivo `'use server'` só pode exportar funções assíncronas, e `page.tsx` só pode exportar os campos do Next; a mensagem da demonstração foi para `tipos.ts`, e `lerModo`/o UUID da demonstração ficaram internos a `page.tsx`.
4. **Sobreposição (regra 3):** além do par consecutivo, a linha que "alcança mais longe" também é marcada, para não perder sobreposições com uma linha anterior não vizinha (08:00–18:00, 09:00–10:00, 12:00–13:00 marca as três). Mais estrito que o texto, mesmo efeito para o par do CA-2.
5. **Resumo de erros:** um link por erro (dia ou linha), em vez de um por dia, com `role="alert"`; os textos de resumo do dia (`resumoDoDia`, `textoDosIntervalos`, `textoDasPausas`) e os ids de erro ficaram em `estado.ts` para o formulário e a visão usarem a mesma montagem.
6. **`aplicarDiferenca`** descarta ids malformados em `remover` antes do `DELETE` (defesa; nunca acontece pelo serviço).

Riscos conhecidos:
- **E3.1 (obrigação, §11 do desenho):** `lerSemana` devolve hora de parede; a conversão para instantes (inclusive a hora inexistente ou repetida em fusos com horário de verão) e a variante pública ficam com a E3.1. O docstring de `leitura.ts` registra RN-15, RN-10 e a forma canônica.
- **E3.2:** a conferência `profissional … FOR SHARE` vai serializar com a gravação da jornada (desejado, D-12); a inserção de reserva (`FOR KEY SHARE`) não espera (R-3, provado).
- Sem JavaScript, o foco não vai ao resumo de erros (ele aparece no topo e os links levam aos campos; R-8).
- Os rótulos "Início do intervalo n" se repetem entre os dias; o contexto vem do `fieldset`/`legend` "Intervalos de <dia>" (axe sem violações).
- `/dev/jornada` usa a mesma `VITRINE_COMPONENTES`; desligada, a página dá 404 e a ação devolve o estado inicial sem processar nada.

Sem TODO pendente no código.

## 5. Texto sugerido para o `CLAUDE.md` (líder)

**Project status** (acrescentar ao fim do parágrafo): "D-015 (E2.3) added the weekly schedule (jornada) per professional: `src/server/jornadas/` (`tipos.ts`, client-safe contracts and pt-BR messages; `validacao.ts`, pure validation of the whole week: 7 explicit days (`dia_semana` 0 = Sunday), `HH:MM`/`H:MM` text in minutes of the salon's local wall-clock day, multiples of 5, `0 ≤ start < end ≤ 1440` (24:00 only as an end; no crossing midnight), at most 6 intervals per day, overlaps refused, contiguous intervals merged into canonical form; `semana.ts`; `servico.ts` with `obter`/`salvar`; `leitura.ts`, `lerSemana` for E3.1 with no role check; `jornadas.acao.ts`, `salvarJornada = defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })`), `src/server/repos/jornada.ts` and the page `/painel/profissionais/[id]/jornada` (gestor edits, including inactive professionals and their own profile; a professional sees only their own, read-only, via "Minha jornada" on `/painel`; another professional of the salon gets "Acesso negado" and another salon 404). New operation `'jornada.ver'` (`salao`/`proprio`/`negado`). Saving replaces the week atomically as a diff (kept intervals keep their ids; saving the same week writes nothing) under `SELECT … FROM profissional pj … FOR NO KEY UPDATE OF pj`; the canonical lock order is now profissional (`FOR UPDATE`/`FOR NO KEY UPDATE`/`FOR SHARE`) → servico(s) → `servico_profissional`/`jornada`/`reserva`/`reserva_item`. Changing a schedule never touches bookings or messages. Formatters `formatarMinutosDoDia`, `formatarFaixaDeMinutos` and `formatarDiaDaSemana` in `src/lib/format.ts`. `/dev/jornada` (behind `VITRINE_COMPONENTES=true`, like `/dev/componentes`) renders the same components with a validate-only action for the DB-less E2E."

**Comandos** (novas linhas da tabela):

| Estabilidade da jornada (D-015) | `for i in $(seq 10); do npx vitest run --project integration tests/integration/jornadas/concorrencia.test.ts \|\| break; done` | CA-13: duas gravações da mesma jornada (em fila e em paralelo) e gravação × desativação, sem impasse nem 23P01; R-3 (a trava não conflita com `FOR KEY SHARE`) |
| E2E da jornada (D-015) | `npx playwright test e2e/jornada.spec.ts e2e/jornada-sem-js.spec.ts` | exige build prévio e porta 3000 livre; sem banco (`/dev/jornada`), teclado, axe e sem JavaScript (CA-17/CA-18) |
