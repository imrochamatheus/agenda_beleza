# D-016 — Desenvolvimento: bloqueios do profissional e do salão inteiro (issue #19, E2.4)

Responsável: desenvolvedor. Tarefas T-1 a T-10 de `design.md`, nas rodadas previstas. Branch `feat/d-016-bloqueios` (base `main` c93a4db), sem commit. Nada em `prisma/**`, `tests/support/**`, `src/server/auth/**` (inclusive `permissoes.ts`), `src/server/tenant/**`, `src/components/**`, `.env.example`, `docker-compose.yml`, `.github/**`, `eslint.config.mjs`, `vitest.config.ts` nem `playwright.config.ts`. Sem migração, variável de ambiente ou dependência nova.

## 1. Tarefas concluídas e arquivos

| Tarefa | Arquivos |
|---|---|
| T-1 Fuso | `src/server/tempo/fuso.ts` (novo: `validarFuso`, `ehDataCivilValida`, `somarDias`, `diferencaEmDias`, `compararDatas`, `instanteDeHoraLocal`, `intervaloDeDiasInteiros`, `partesLocais`, `ehDiaInteiro`; só `Intl`, cache de formatadores por fuso), `fuso.test.ts` |
| T-2 Formatação, rotas, contratos | `src/lib/format.ts` (`formatarPeriodoBloqueio`), `format.test.ts`; `src/config/navegacao.ts` (`ROTAS.bloqueio(id)`, `ROTAS.devBloqueios`), `navegacao.test.ts`; `src/server/bloqueios/tipos.ts` (novo; client-safe; `MENSAGENS_BLOQUEIO.propriaAgenda` acrescentada) |
| T-3 Repositórios | `src/server/repos/bloqueio.ts` (novo, `RepoBloqueio`, cabeçalho com a ordem de travas e o marcador `FOR UPDATE OF b`), `repos/reserva.ts` (`listarConfirmadasQueCruzam` + `consultaReservasQueCruzam`, SQL com o literal `'confirmado'`), `repos/index.ts` (`Repos.bloqueios`), `repos/tipos.ts` (DTOs), `repos/index.test.ts`, `tests/integration/bloqueios/repos.test.ts` |
| T-4 Validação e apresentação | `src/server/bloqueios/validacao.ts` (`lerData`, `lerHora`, `lerMotivo`, `resolverPeriodo`), `apresentacao.ts` (`paraItem`, `paraAviso`, `valoresDeEdicao`, `opcoesDeAlvo`) e os testes |
| T-5 Serviço, leitura, ações | `src/server/bloqueios/servico.ts`, `leitura.ts` (`lerBloqueios`), `bloqueios.acao.ts`; `tests/integration/bloqueios/apoio.ts`, `criar-editar-remover.test.ts`, `isolamento-permissoes.test.ts` |
| T-6 Concorrência | `tests/integration/bloqueios/concorrencia.test.ts` |
| T-7 Componentes | `src/app/painel/bloqueios/{estado.ts, FormularioBloqueio.tsx, AvisoReservasCobertas.tsx, ListaBloqueios.tsx, Bloqueios.module.css}` e os três `*.test.tsx` |
| T-8 Páginas e casca | `src/app/painel/bloqueios/{page.tsx, acoes.ts}`, `src/app/painel/bloqueios/[id]/page.tsx`, `tests/integration/bloqueios/paginas.test.ts` |
| T-9 Demonstração e E2E | `src/app/dev/bloqueios/{page.tsx, page.test.tsx, acoes.ts, acoes.test.ts}`, `e2e/bloqueios.spec.ts`, `e2e/bloqueios-sem-js.spec.ts` |
| T-10 Documentação e gates | `README.md` (seção "Bloqueios"), este arquivo |

## 2. Comandos executados e resultados

Node 24, PostgreSQL do compose no ar, porta 3000 livre antes dos E2E.

| Comando | Resultado |
|---|---|
| `npm run db:generate` | ok (Prisma Client 7.10.1) |
| `npm run lint` | ok, 0 avisos (com as rotas novas presentes) |
| `npm run typecheck` | ok |
| `npm run build` | ok; lista `ƒ /painel/bloqueios`, `ƒ /painel/bloqueios/[id]` e `ƒ /dev/bloqueios` |
| `npm test` (3× seguidas) | 3/3 verdes: 198 arquivos, **2606 testes** cada |
| `npm run test:coverage` | verde (saída 0): **linhas 99,9%** (statements 99,4%, branches 97,91%, funções 99,75%); arquivos novos com 100% de linhas (`bloqueios/[id]/page.tsx` 100% linhas, 95% statements) |
| `npm run test:e2e` | **63 passaram** (9 novos em `bloqueios.spec.ts` e `bloqueios-sem-js.spec.ts`; `a11y-base`, `jornada*` e demais sem mudança) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/bloqueios/concorrencia.test.ts \|\| break; done` | **10/10 verdes** (4 testes cada); `deadlock` e `23P01` ausentes em todas as saídas |
| `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run src/server/tempo src/server/bloqueios src/lib/format.test.ts src/app/painel/bloqueios src/app/dev/bloqueios` | verdes nos dois fusos (9 arquivos, 170 testes) |
| `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run --project integration tests/integration/bloqueios` | verdes nos dois fusos (5 arquivos, 79 testes) |
| `npx vitest run --project integration tests/integration/bloqueios tests/integration/auth/paginas.test.ts` | verde; `auth/paginas.test.ts` sem mudança |
| `tests/integration/tenant/registro.test.ts` | verde sem mudança (enxerga as três ações) |
| `src/lib/format.fonte-unica.test.ts` | verde sem mudança |

Estado final: só o container `postgres` no ar (`docker compose stop app worker`); porta 3000 livre; os dados do passo manual foram apagados da base de desenvolvimento.

### Passo manual (Docker, 375×812, só teclado, com e sem JavaScript)

`docker compose up -d --build --wait` (app, worker e postgres saudáveis; imagem com o código final). Salão criado por SQL na base de desenvolvimento (gestora confirmada com perfil de profissional; Bia, profissional com usuário; Clara, inativa; uma cliente; reserva confirmada da Bia), senha argon2id real. Roteiro descartável com Chromium (Playwright) fora do repositório (`scratchpad/manual16/roteiro.mjs`), executado com JavaScript e com `javaScriptEnabled: false`. Depois de cada `goto`, toda a interação é por teclado (Tab/Shift+Tab, setas no `select` e no grupo de rádios, digitação no `select`, Enter em links e para enviar), conferindo o foco visível (contorno > 0) em cada parada. Resultado: **62/62 verificações** (31 por modo):
- login por teclado; `/painel/bloqueios` sem rolagem horizontal a 375 px;
- seta no `select` → "Salão inteiro"; Tab → rádio; seta → "Dia inteiro"; datas; Enter → (com JS) foco na seção do aviso; "Bloqueio salvo: dd/mm/aaaa (dia inteiro)."; aviso com "15:00 a 16:00 — Bia Bloqueio — Joana Cliente"; banco `[03:00Z, 03:00Z do dia seguinte)` e motivo; reserva idêntica por `to_jsonb` (CA-3, CA-4);
- horário 14:07 → resumo de erros focado (com JS), `aria-invalid` + `aria-describedby` com o erro, valor preservado, nada gravado (CA-7);
- digitação "Clara" no `select` → bloqueio da inativa; lista com "(inativo)" (CA-15); "Editar" por Enter → novo fim, mesmo id (CA-12); "Remover" por Enter → PRG `?remocao=ok`, "Bloqueio removido.", linha apagada (CA-11);
- fuso trocado para `America/Manaus` por SQL → 14:00–16:00 exibido 13:00–15:00 (CA-17);
- profissional Bia: sem `select`; vê o do salão "somente leitura" e não vê o da colega (CA-14); cria o próprio por teclado (CA-1) e o remove; edição do bloqueio do salão e da colega → "Acesso negado" (CA-2); id inexistente → 404.

Na primeira execução, 2 verificações falharam por erro do roteiro (o Tab parava no primeiro "Remover bloqueio: Bia…", que era outro bloqueio da Bia inserido pelo próprio roteiro no passo do CA-17). Com o alvo exato, 62/62.

## 3. Testes criados ou alterados × CA

| Arquivo | Casos | CA / risco |
|---|---|---|
| `src/server/tempo/fuso.test.ts` | 23 (com `each`) | CA-6 (a)–(f), CA-3, CA-5 (SP 22:00/02:00, Manaus); R-1 (ida e volta em SP, NY, Manaus, UTC, Kolkata; 1439; inválidos → RangeError; antes de 1970); `somarDias`/`diferencaEmDias`/`compararDatas`/`ehDataCivilValida` (31/02, 29/02/2027 × 2028); `ehDiaInteiro` (dias de 23/25 h; 00:05 falso) |
| `src/lib/format.test.ts` (+1 describe) | 6 | CA-23 (dia único, vários dias, horário cruzando a meia-noite), R-2 (dias de 23/25 h), CA-17 (Manaus), erros |
| `src/config/navegacao.test.ts` | +5 asserções | `ROTAS.bloqueio` codifica e ativa "Bloqueios" (gestor e profissional), `devBloqueios`; `SEGMENTOS_RESERVADOS` inalterado |
| `src/server/repos/index.test.ts` | +1 caso, +21 chamadas | id malformado → `NaoEncontrado` sem consulta; contexto inválido → `Error`; limite inválido → `RangeError` |
| `src/server/bloqueios/validacao.test.ts` | 17 | CA-5 (conversão), CA-7 (todos os casos), CA-8 (`agora` fixo), CA-9 (366 dias/datas e +5 min/+1 data; 730 × 24 h), CA-12 (chaves de edição), CA-16; forma (extras, tipos), modo, horas ignoradas no dia inteiro |
| `src/server/bloqueios/apresentacao.test.ts` | 9 | CA-14 (`editavel` por papel), CA-3, CA-15, CA-17, R-2 (`valoresDeEdicao` nos dias de 23/25 h), "cliente removida", opções do alvo |
| `.../bloqueios/FormularioBloqueio.test.tsx` | 9 | CA-21 (rótulos, `fieldset/legend`, rádios, `pattern`, `aria-describedby` com ajuda e erro, `aria-invalid`, resumo focado com links, seção do aviso focada), valores preservados, campos limpos após salvar; `estado.ts` |
| `.../bloqueios/AvisoReservasCobertas.test.tsx` | 3 | CA-4 (lista, cliente removida), D-18 ("E mais N") |
| `.../bloqueios/ListaBloqueios.test.tsx` | 8 (com `each`) | CA-14/CA-15 (somente leitura, "(inativo)"), `aria-label` de editar/remover, `AlertaDeRemocao` |
| `src/app/dev/bloqueios/page.test.tsx` | 10 (com `each`) | 404 sem a variável sem ler parâmetros, metadados, três modos |
| `src/app/dev/bloqueios/acoes.test.ts` | 8 (com `each`) | R-12: desligada → estado inicial / sem redirect; inválido, alvo, válido, edição, remoção |
| `tests/integration/bloqueios/repos.test.ts` | 21 | CA-11, CA-13 (B intacto; FK composta), CA-18 (`listarVigentes`), `listarNoPeriodo` semiaberto, R-4, R-5 (chaves do DTO, sem telefone), limite/total, **R-3** (ver §4, desvio 1) e controle negativo |
| `tests/integration/bloqueios/criar-editar-remover.test.ts` | 22 | CA-1, CA-3, CA-4 (profissional e salão; fotografia `to_jsonb`; `mensagem`), CA-5 (SP e Manaus), CA-7, CA-8, CA-9, CA-10, CA-11, CA-12, CA-14 (gestor que atende), CA-15, CA-16, CA-17, CA-18 |
| `tests/integration/bloqueios/isolamento-permissoes.test.ts` | 16 | CA-2 (criar/editar/remover de colega/salão/B → 403/404; super admin 403; 401; profissional inativo 401), CA-13 (404 e B intacto; extras; lista; aviso não lista reserva de B), CA-14 (`listar`, `opcoesDeAlvo`, `obterParaEdicao`), CA-19 (metadados), `lerBloqueios` |
| `tests/integration/bloqueios/concorrencia.test.ts` | 4 | CA-20/R-6: remoção × remoção ×10 e determinística (`pg_stat_activity`, marcador `FOR UPDATE OF b`); criação × desativação ×10; edição × remoção ×10; `timeout` 30 s por `it` |
| `tests/integration/bloqueios/paginas.test.ts` | 16 | CA-1, CA-3, CA-4, CA-5, CA-13, CA-14, CA-15, CA-17, CA-18, CA-22 (casca: salvo + `revalidatePath`, inválido com valores, extras ignorados, 401/403/404, remoção `?remocao=ok|nao_encontrado|negado`), edição (403/404), super admin |
| `e2e/bloqueios.spec.ts` | 5 | CA-21: teclado (seta no `select`, setas/Espaço nos rádios, Tab/Shift+Tab, Enter), foco visível, seção do aviso e resumo focados, link → campo, remoção por teclado; axe em gestor, profissional, edição, erro e aviso; sem rolagem horizontal |
| `e2e/bloqueios-sem-js.spec.ts` | 4 | CA-22: gestor cria com horário e dia inteiro (aviso), erros com valores preservados, remove; profissional cria e remove |

## 4. Desvios do desenho e riscos

Desvios:
1. **R-3 (plano da consulta de reservas cobertas).** A premissa de §0 ("Index Scan using `reserva_sem_sobreposicao`" com `enable_seqscan=off` e plano genérico) **não se reproduz em tabelas pequenas**: tanto na base de teste quanto na de desenvolvimento (5 reservas, sem ANALYZE), o plano genérico escolhe os btree `reserva_salao_id_profissional_id_inicio_idx` / `reserva_salao_id_inicio_idx` por custo. Conferi (sem gravar nada; transações desfeitas com ROLLBACK na base de desenvolvimento):
   - sem os três btree de `reserva` por `(salao_id, …, inicio)`, o plano genérico usa `Index Scan using reserva_sem_sobreposicao` com `Index Cond: (profissional_id = $6) AND (tstzrange(inicio, ocupado_ate) && …)`: o índice parcial **é aplicável** (a implicação com o literal `'confirmado'` é provada);
   - com volume realista (58.410 reservas de 10 profissionais em 2 anos, ANALYZE), o plano genérico **escolhe sozinho** `Bitmap Index Scan on reserva_sem_sobreposicao` nas duas variantes (0,12 ms do profissional; 0,63 ms do salão, laço por profissional);
   - com o status como parâmetro (`$n::status_reserva`), o índice deixa de ser aplicável.
   Por isso o teste R-3 em `repos.test.ts` apaga os três btree **dentro de uma transação desfeita** e confere que o plano genérico (`PREPARE` + `EXPLAIN EXECUTE` com `plan_cache_mode=force_generic_plan`) usa `reserva_sem_sobreposicao`, mais um controle negativo (com o status parametrizado, não usa). Isso protege exatamente o que a R-3 pede (o literal no texto). Não considerei "perda do índice" no sentido do §4 (a consulta continua podendo usá-lo e o usa com volume), então **não acionei o DBA**; se o líder preferir o parecer do DBA, a evidência está acima e neste item (consultas de §0 reproduzidas).
2. **Página de demonstração:** `alertaDeRemocao` não pode ser exportado de `page.tsx` (o Next só aceita as exportações de página); virou o componente `AlertaDeRemocao` em `ListaBloqueios.tsx` (T-7), usado pela página real e pela demonstração. `ListaBloqueios` ganhou a prop opcional `rotaEdicao` (a demonstração aponta para `/dev/bloqueios?modo=edicao`).
3. **Remoção na demonstração:** `demonstrarRemocaoAcao(modo)` é ligada ao modo por `.bind` na página (o `FormData` chega como argumento extra), para o PRG `?remocao=ok&modo=<modo>` do desenho.
4. **Edição com campo `id` ausente:** o esquema da edição aceita `id` opcional (`z.unknown().optional()`); ausente ou não-texto → 404 pelo serviço (D-20), em vez de `formulario`.
5. **Rádio de modo:** sem `aria-invalid` nos `input type=radio` (o lint `jsx-a11y/role-supports-aria-props` recusa); o erro do modo é ligado ao `fieldset` "Tipo de bloqueio" por `aria-describedby`.
6. **Campos do formulário com `key` pelo valor:** garante que, depois da ação (com ou sem JS), os campos mostrem os valores devolvidos no estado (limpos após criar; preservados após erro).
7. `MENSAGENS_BLOQUEIO.propriaAgenda` ("O bloqueio vale para a sua agenda.") acrescentada a `tipos.ts` (texto que o desenho cita só na tabela do formulário).

Riscos conhecidos:
- **Testes com datas fixas de 12/2026:** as ações usam `AGORA = 2026-12-01T12:00Z` injetado; as credenciais desses testes nascem com expiração distante (a renovação grava `min(AGORA + 7 d, criado_em + 30 d)`, válida para AGORA). Os testes de página usam o relógio real com datas no ano seguinte. A fábrica cria reserva e bloqueio relativos ao relógio real; os cenários com reservas próprias usam horários fora de 13:00–14:30Z para não colidir com ela.
- **Cobertura de ramos** de `fuso.ts` (94%): linhas 108/143/149 são ramos defensivos (hora `24` do ICU; troca de ordem na busca binária). Linhas em 100%.
- **R-14:** fuso inválido gravado no banco faz a página responder 500 (aceito no desenho; E2.5 valida na escrita).
- Duplo envio do formulário sem JS cria duplicata (aceito, RN-9).

## 5. Texto sugerido para o `CLAUDE.md`

**Project status** (acrescentar ao fim do parágrafo): "D-016 (E2.4) added staff blocks (`bloqueio`) for a professional or the whole salon: `src/server/tempo/fuso.ts` is the only local wall-clock → UTC conversion (`instanteDeHoraLocal`, `intervaloDeDiasInteiros`, `partesLocais`, `ehDiaInteiro`; `Intl` only; a nonexistent DST time resolves to the first valid instant and a repeated one to the first occurrence; E3.1 must convert the weekly schedule with it); the `src/server/bloqueios/` module (`bloqueios.acao.ts` with `criarBloqueio`/`editarBloqueio`/`removerBloqueio`, `{ papeis: ['gestor', 'profissional'], capacidade: 'configurar' }`; `servico.ts`; `leitura.ts` with `lerBloqueios`, the role-free read for E3.1/E3.3/E3.4, half-open intersection, salon-wide blocks apply to everyone, `motivo` is staff-only); `src/server/repos/bloqueio.ts` (edit/remove lock the row with `FOR UPDATE OF b`; create only takes the FK's `FOR KEY SHARE` on the professional) and `listarConfirmadasQueCruzam` in `repos/reserva.ts`, whose SQL keeps the literal `'confirmado'` so the partial GiST index `reserva_sem_sobreposicao` stays applicable (never turn it into a parameter); `/painel/bloqueios` (list of current and future blocks, create form with the covered-reservations warning returned in the action state, without PRG; removal by PRG `?remocao=`) and `/painel/bloqueios/[id]` (edit start, end and reason only); `formatarPeriodoBloqueio` in `src/lib/format.ts`; and the `/dev/bloqueios` demo for the database-free E2E (404 unless `VITRINE_COMPONENTES=true` or `next dev`)."

Linhas da tabela "Comandos e cobertura":

| E2E de bloqueios (D-016) | `npx playwright test e2e/bloqueios.spec.ts e2e/bloqueios-sem-js.spec.ts` | exige build prévio e porta 3000 livre; sem banco (`/dev/bloqueios`, ligada pela `VITRINE_COMPONENTES=true` do `webServer`); axe 4.14.0, zero violações |
| Estabilidade dos bloqueios (D-016) | `for i in $(seq 10); do npx vitest run --project integration tests/integration/bloqueios/concorrencia.test.ts \|\| break; done` | CA-20: remoção × remoção, criação × desativação e edição × remoção, sem 5xx nem impasse |
| Fuso dos bloqueios (D-016) | `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/tempo src/server/bloqueios src/lib/format.test.ts \|\| break; done` | o resultado não pode depender do fuso do processo |

## 6. Correção pós-CI (DEF-CI-1, PR #73)

Falha: run 44787745419, job `testes` (`npm run test:coverage`): `tests/integration/harness/db.test.ts > executarPrisma > sobrescreve DATABASE_URL do ambiente e do .env pela URL recebida` estourou o timeout padrão de 5 s (5038 ms). O teste sobe o Prisma CLI num processo filho; com a suíte inteira e a cobertura ligada, passou de 5 s no runner.

Correção (só testes; asserções inalteradas; sem `testTimeout` global): timeout explícito de `30_000` por `it` nos testes de integração que sobem processo filho e ainda usavam o padrão:
- `tests/integration/harness/db.test.ts`: "sobrescreve DATABASE_URL do ambiente e do .env pela URL recebida" (`executarPrisma`, Prisma CLI).
- `tests/integration/auth/recuperacao-senha.test.ts`: "profissional desativado entre a busca e a trava…" (`execFileSync` do node).

Já tinham timeout explícito (sem mudança): `tests/integration/db/drift.test.ts` (60 s, `executarPrisma`), `tests/integration/worker/sigterm.test.ts` (30 s e 60 s), `tests/integration/worker/schema.test.ts` (30 s e 120 s), demais casos de `prepararTemplate` em `harness/db.test.ts` (60 s).

Evidências:
- `npm run lint` e `npm run typecheck`: passaram.
- `npx vitest run --project integration tests/integration/harness` 5×: 4 arquivos, 72/72 testes nas 5.
- `npm run test:coverage` 3× seguidas: exit 0 nas 3; 198/198 arquivos, 2606/2606 testes; linhas 99,9%.
