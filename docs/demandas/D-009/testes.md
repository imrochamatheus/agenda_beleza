# D-009 — Testes (T-12, tester)

## Rodada 1 — 19/11/2026

### Ambiente
- Branch `feat/d-009-base-visual` (conferida no início e no fim), árvore de trabalho sem commit sobre `27d5c2b`. Node 24.21.0 (`nvm use`), PostgreSQL 17 (`postgres:17` do compose), Chromium do Playwright 1.65.1 (projeto `mobile-chromium`, 375×812), `@axe-core/playwright` 4.14.0 e `axe-core` 4.14.0. Adaptadores: os quatro em `simulado`.
- Instalação limpa: `npm ci && npm run db:generate` → exit 0, `found 0 vulnerabilities`.
- Antes de começar, salvei no scratchpad o `.env` local, a saída de `git status --porcelain` e a de `git diff`. O `.env` local não tinha `VITRINE_COMPONENTES` (é anterior à demanda). Para o CA-18 de processo, ele foi trocado por `cp .env.example .env` e restaurado no fim (`diff` com a cópia: idêntico).
- **Imagem Docker:** o `docker compose up -d --wait --build` ficou parado mais de 14 min em `RUN npm ci`. A causa é do ambiente local: contêineres na rede *bridge* não têm saída (`docker run --rm node:24-trixie-slim node -e "fetch('https://registry.npmjs.org/')…"` → `UND_ERR_CONNECT_TIMEOUT`; com `--network host` → `status 200`). Interrompi o compose e construí a mesma imagem com o mesmo `Dockerfile` usando `docker build --network=host -t agenda-beleza:dev .` (exit 0; a lista de rotas do build inclui `ƒ /dev/componentes`). Depois rodei `docker compose up -d --wait` sem `--build`. Nada no repositório muda por isso, e nada do compose ou do Dockerfile entra nesta demanda.
- Estado final: `postgres` no ar; `app` e `worker` parados (como no início); portas 3000 e 3100 livres; `git status --porcelain` e `git diff` idênticos aos iniciais, mais este arquivo.

### Gates
| Comando | Resultado |
|---|---|
| `npm run lint` (`--max-warnings=0`, inclui `jsx-a11y`) | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build`, sem `.env` e com `env -u DATABASE_URL -u VITRINE_COMPONENTES` | exit 0. A lista de rotas mostra `ƒ /dev/componentes`. Fontes em `.next/static/media/{fraunces_latin_opsz_normal…,source_sans_3_latin_wght_normal…}.woff2`. `grep -rl "googleapis\|gstatic" .next/static` vazio |
| `npm test` | exit 0: **114 arquivos, 1513 testes**, 39,9 s |
| `npm run test:coverage` | exit 0, com 114 arquivos e 1513 testes. **Linhas: 99,92% (1286/1287)**; statements 99,1%, ramos 97,74%, funções 99,45%. Todo arquivo novo tem 100% de linhas, exceto `src/app/dev/componentes/Vitrine.tsx` (97,14%, 34/35). `format.ts`, `navegacao.ts`, `page.tsx` e `src/components/**` são medidos |
| `npm run test:e2e` (porta 3000 livre) | exit 0: **25 passaram** (24 do `a11y-base` e o `smoke`), 10,3 s. Repetido no fim, depois das mutações, com novo build: 25 passaram |
| `npx playwright test e2e/a11y-base.spec.ts --repeat-each=3` | **72 de 72 passaram** (27,9 s) |
| `npx playwright test e2e/a11y-base.spec.ts --repeat-each=2 --workers=2` (com menos paralelismo) | **48 de 48 passaram** |
| `TZ=<fuso> npx vitest run src/lib/format.test.ts src/components/ui/SlotGrid.test.tsx` com `UTC`, `America/Fortaleza`, `Asia/Tokyo`, `Pacific/Kiritimati` (UTC+14) e `America/Sao_Paulo` | 65 de 65 passaram em cada fuso. `LC_ALL=C` em `format.test.ts`: 53 de 53 |
| Exclusões de cobertura | `git diff vitest.config.ts` vazio. `grep -rnE "v8 ignore\|istanbul ignore\|c8 ignore" src tests e2e` vazio |
| Testes desligados ou `eslint-disable` | `grep -rnE "\.(skip\|only\|todo\|fixme)\(" src tests e2e` vazio. `eslint-disable` só no código gerado do Prisma |
| Infraestrutura intocada | `git diff --stat` de `vitest.config.ts`, `eslint.config.mjs`, `next.config.ts`, `Dockerfile`, `docker-compose.yml` e `.github` vazio |
| Dependências | `package.json`: `@axe-core/playwright` e `axe-core` com `4.14.0` exato em `devDependencies`. No lock, só `node_modules/@axe-core/playwright` 4.14.0 e `node_modules/axe-core` 4.14.0 (dev), sem cópia aninhada. O `eslint-plugin-jsx-a11y` pede `axe-core ^4.10.0`, então a cópia única é compatível |
| Migrações | nenhuma (RN-24). O `drift.test.ts` passa dentro do `npm test` |
| CI | `.github/workflows/ci.yml` sem mudança. Os seis jobs só podem ser conferidos no PR, pelo líder |

### Verificações independentes (além dos testes do desenvolvedor)

**CA-18 por processo (compose).** Rodei `cp .env.example .env` (`VITRINE_COMPONENTES=false`), a imagem com o código atual e `docker compose up -d --wait` → `up=0` (`app` healthy). Respostas:
```
/dev/componentes                              404
/dev/componentes?layout=painel&papel=gestor   404
/dev/componentes?layout=x                     404
/api/health                                   200
/                                             200
docker compose exec app printenv VITRINE_COMPONENTES NODE_ENV  →  false / production
```
O HTML do 404 traz o corpo padrão do Next ("This page could not be found.") e nenhum componente da vitrine é renderizado. Mas a carga RSC embutida no 404 ainda traz o título da metadata da página, "Vitrine de componentes · Agenda Beleza" (ver DEF-2, baixa). Na mesma imagem, o `check-env` (`docker run --rm --network none -e VITRINE_COMPONENTES=<v> … node dist/scripts/check-env.js`) recusa `TRUE` e `1` ("Variáveis de ambiente ausentes ou inválidas: VITRINE_COMPONENTES") e aceita `true` e `false`. Isso confirma o ajuste da D-1 e a R-15. `@axe-core/*` não está na imagem final: `node_modules/@axe-core` existe, mas vazio, e não há `node_modules/axe-core`.

**Contraste e paleta, conferidos com um script próprio** (fórmula WCAG 2.x e HSL, lendo `globals.css`, sem reaproveitar o `globals.test.ts`): os 22 pares da RN-5 passam. Exemplos: `sobre-primaria/primaria` 4,92; `foco/perigo` 3,19; `borda-controle/superficie-alt` 3,77; `erro-texto/erro-fundo` 7,22. Dos 22 tokens, nenhum tem matiz em [290°, 360°) com saturação ≥ 20%. Os matizes vão de 9° (perigo e erro, vermelho-terroso) a 188° (texto de informação, sálvia).

**Revisão visual (R-12).** Usei Chromium real, headless, com `VITRINE_COMPONENTES=true next start -p 3100`, nas 5 variantes e em 320, 375 e 1280 px. As capturas foram salvas no scratchpad da sessão (`…/scratchpad/capturas/*.png`, 24 arquivos, inclusive páginas inteiras em 320, 375 e 1280 e o diálogo de perigo e o menu aberto em 375). Elas não ficam versionadas.
- Paleta: fundo linho (`rgb(250, 246, 241)`), primária terracota, perigo vermelho-terroso, alertas em sálvia, oliva, ocre e argila. Não há rosa nem lilás. A direção é quente e sóbria, com bastante espaço em branco. O visual não lembra AppBarber nem AppBeleza.
- Títulos em Fraunces serifada (`h1` computado: `fonteTitulo, "fonteTitulo Fallback", Georgia, …`) e corpo em Source Sans 3 (`fonteCorpo, …`) em todas as variantes.
- Rolagem horizontal: `scrollWidth = clientWidth` nas 15 combinações. Em 375 px, os textos longos do `DataList` (e-mail longo) quebram a linha.
- Em 1280 px, o painel tem a barra lateral com o item ativo destacado por barra e peso. Em 375 px, o menu móvel mostra o foco visível (contorno escuro de 3 px) no 1º item. O diálogo de perigo tem o fundo escurecido e o foco em "Cancelar".
- Os botões desabilitados ("Indisponível", "Salvando…", "Agendar") têm baixo contraste (texto claro sobre terracota clara). A WCAG 1.4.3 isenta componentes inativos, e o axe passa. "Agendar" (focável, `aria-disabled`) tem borda tracejada, então o estado não depende só da cor. Fica só como nota.

**Percurso só com teclado (1280 px, `painel&papel=gestor`, Chromium real).** São 37 paradas por volta: "Pular para o conteúdo", os 7 itens do menu, 5 botões (o "Agendar" focável incluído e os `disabled` fora), 6 campos, `select` ×2, 2 checkboxes, os links Termos e Privacidade, "Cadastrar serviço", "Tentar novamente", 1 parada por grade de horários e os 4 "Abrir confirmação…". Depois o foco vai ao `body` e a volta recomeça no "Pular". Todas as paradas têm `outline` sólido de 3 px, exceto a 4ª parada interna do `input type="date"` (o botão nativo do calendário, no shadow DOM). Nela, o `input` fica com `outline: none` e `:focus-visible` falso, mas o próprio Chromium desenha um anel no ícone do calendário (`capturas/data-1280-4.png`). O foco continua visível. Ver a observação O-1 sobre o E2E. Em 375 px, os percursos de menu, diálogo, `SlotGrid` e `Checkbox` foram cobertos pelo E2E e repetidos nas capturas.

### Mutações (todas revertidas; a restauração foi conferida com `cmp` em cada uma e com `git status`/`git diff` no fim)
| # | Mutação | Resultado |
|---|---|---|
| 1 | `format.ts`: moeda por `Intl.NumberFormat(…).format(centavos / 100)` | **Reprova**: `CA-5: 9007199254740991 → R$ 90.071.992.547.409,91` (recebido `…409,90`) |
| 1b | `format.ts`: `(centavos / 100).toFixed(2)` | Passa. O `toFixed` arredonda certo no `MAX_SAFE_INTEGER`, e o teste só vê a saída. A RN-11 ("só inteiros") é garantida pelo código, não pelo teste. Sem impacto: saída correta |
| 2 | `format.ts`: `hour12: false` no lugar de `hourCycle: 'h23'` (com e sem a guarda `'24' → '00'`) | Passa (65 de 65), como o design previu. No ICU 78.3, `pt-BR` + `hour12: false` resolve `h23` (`00:00` à meia-noite). A guarda cobre motores que devolvem `24` |
| 3 | `#fff` num `Button.module.css` | **Reprova**: CA-20 "nenhum literal de cor" |
| 4 | `--cor-primaria: #c08060` | **Reprova**: CA-13 `sobre-primaria sobre primaria ≥ 4.5:1` (3,12) |
| 4b | `--cor-borda-sutil: #f0c8dc` (rosa) | **Reprova**: CA-13 D-9 (`h=330.0 s=0.57`) |
| 5 | `vitrineHabilitada` aceitar `'1'` | **Reprova**: `env.test.ts` "production com a variável 1 → desabilitada" e `page.test.tsx` "… → notFound (404)" |
| 6 | Esc tratado no evento `cancel` em vez do `keydown` (build + E2E) | **E2E passa** (6 de 6 do CA-4, inclusive o R-1), mas o unitário **reprova** (3 falhas: Esc com `preventDefault`, Esc ignorado quando ocupado, `cancel` nativo). O E2E não falha porque a defesa do `close` inesperado (`aoFecharNativo` reabre com `showModal()` quando ocupado) mantém o comportamento visível correto. A mutação é coberta, mas pelo unitário, e não pelo E2E, como o design supunha |
| 7 | Sem a trava de Tab no diálogo (build + E2E) | **Reprova**: `CA-4 … ciclo de foco` (`Expected: true / Received: false`, o foco sai do diálogo) |
| 8 | Menu fechado com `display: block` em vez de `none` (build + E2E) | **Reprova**: `CA-3` × 3 variantes (`toBeHidden` → `visible`) |

### Critérios de aceitação
| CA | Resultado | Evidência |
|---|---|---|
| CA-1 | **passou** | `format.test.ts` (NBSP explícito e `!==` com U+0020); byte `c2 a0` conferido em `format.ts`; mutação 1 |
| CA-2 | **passou** | `format.test.ts` (com o fuso explícito e com o fuso omitido; `formatarData`/`formatarHora`); vitrine: "Horário escolhido: 10/03/2026 10:00" no E2E |
| CA-3 | **passou** | E2E `CA-3` × 3 (gestor 7, profissional 2, admin 3; Tab até "Menu", Enter, foco no 1º item, Tab sai sem fechar, Esc devolve o foco, Espaço abre); `MenuNavegacao.test.tsx`; mutação 8 |
| CA-4 | **passou** | E2E (passos 1 a 6, 4 voltas de Tab e de Shift+Tab, clique no fundo e no canto sem efeito, R-1, falha); `ConfirmDialog.test.tsx`; mutações 6 e 7 |
| CA-5 | **passou** | `format.test.ts` (valores, recusas `RangeError`/`TypeError`, regex); mutação 1 |
| CA-6 | **passou** | `format.test.ts` (meia-noite `00:00`, virada de dia e de ano, zeros); mutação 2 documentada |
| CA-7 | **passou** | `format.test.ts` (Manaus, Noronha, UTC, Rio Branco) |
| CA-8 | **passou** | `format.test.ts` (2018/2019); `SlotGrid` mostra `23:00 (UTC−02:00)` e `23:00 (UTC−03:00)` (E2E e captura) |
| CA-9 | **passou** | 5 valores de `TZ` (inclusive `Asia/Tokyo` e UTC+14), 65 de 65 cada; `LC_ALL=C`; autoverificação do `getTimezoneOffset` no próprio teste |
| CA-10 | **passou** | `format.fonte-unica.test.ts`; diff do `mp-checkout` (`formatarMoeda(dados.valorCentavos)`, sem `Intl`); `checkout.test.ts` verde dentro do `npm test` |
| CA-11 | **passou** | `navegacao.test.ts`, `Layouts.test.tsx`, `page.test.tsx` (profissional com 2 links); código: `itensDoPainel` com `Object.hasOwn` (falha fechada) |
| CA-12 | **passou** | `navegacao.test.ts` (codificação, `SEGMENTOS_RESERVADOS` recalculado, pastas de `src/app`) |
| CA-13 | **passou** | `globals.test.ts`; script próprio (22 pares, 0 rosa); axe `color-contrast` no E2E; mutações 4 e 4b |
| CA-14 | **passou** | E2E `CA-14/CA-15` × 5 (320/375/1280, menu em 1280, "Pular" → `main`, contorno ≥ 2 px, todos os interativos alcançados), item ativo, alvos 44 × 44, texto a 200%, movimento reduzido; percurso manual; ver O-1 |
| CA-15 | **passou** | axe (WCAG 2.0/2.1 A e AA, nenhuma regra desligada nem `exclude`) nas 5 variantes em 375 e 1280, com o menu aberto (×3) e com cada diálogo (×4, mais o diálogo com erro); `dependencias-e2e.test.ts`; lock conferido |
| CA-16 | **passou** | E2E `CA-16` (SlotGrid por setas e Tab, grade vazia, Field com erro e `toHaveAccessibleDescription`, Checkbox, DataList 375/1280) |
| CA-17 | **passou** | `src/components/ui/*.test.tsx`, `campo.test.ts`, `src/components/layout/*.test.tsx`; mutação 6 (o unitário pega o Esc) |
| CA-18 | **passou** (com DEF-2, baixa) | `env.test.ts`, `page.test.tsx` (`production` + ausente/vazia/`false`/`1`/`TRUE` → 404 sem ler `searchParams`), E2E 200 + `noindex, nofollow`, compose → 404 nas 3 URLs, `check-env` da imagem recusa `TRUE`/`1`; mutação 5 |
| CA-19 | **passou** | `layout.test.tsx`, `fontes.test.ts`, E2E `CA-19` (famílias computadas e `status === 'loaded'`), `smoke.spec.ts`; capturas |
| CA-20 | **passou** | `conformidade.test.ts`; mutação 3 |
| CA-21 | **passou localmente** | todos os gates acima, com cobertura de 99,92% de linhas e build sem `DATABASE_URL` nem a variável. **Pendente:** os seis jobs da CI no PR (líder) |

### Desvios do desenvolvedor (`dev.md` §4)
| Desvio | Avaliação |
|---|---|
| D-A (cópia única do `axe-core` em 4.14.0) | **Aceito.** É o que o design pedia (§1.2: cópia única, sem aninhar). O `jsx-a11y` declara `^4.10.0`, o lint está verde e o lock só tem as duas entradas em 4.14.0 |
| D-B (`campo.ts` com 4º argumento e `classes`; `Field.module.css` compartilhado) | **Aceito.** Reaproveitamento interno, sem mudança de contrato público. 100% de linhas e lint verde |
| D-C (`nivelTitulo={3}` no vazio embutido) | **Aceito.** Melhora a hierarquia de títulos, e o axe passa |
| D-D (robustez do `ConfirmDialog`: exceção síncrona, *ref* `fechando`, Promise tardia, `blur`, reinício por renderização) | **Aceito.** Todos os casos estão cobertos no unitário. A defesa do `close` inesperado ainda mascara a mutação 6 no E2E, e o comportamento continua correto |
| D-E (sem itens → nada renderizado; `vi.mock('next/navigation')` só no teste do menu) | **Aceito.** Falha fechada coerente com a RN-12. O mock é de roteamento, não de banco |
| D-F (`montarHorarios` exportado; o vazio substitui o `fieldset`) | **Aceito**, como no design |
| D-G (grade controlada com "Horário escolhido", contador de tentativas, `ESPERA_DEMORADA_MS` exportado) | **Aceito.** Só a vitrine é afetada, e isso torna o E2E verificável |
| D-H (alvo do clique fora do retângulo do diálogo; percurso dando a volta; limiar > 25; `/termos` no teste) | **Aceito.** O clique fora do retângulo é a forma correta de atingir o *backdrop*, e o canto (5, 5) também é clicado. O limiar foi conferido: são 37 paradas no painel do gestor em 1280. Ver O-1 sobre a deduplicação de paradas |
| D-I / P-1 (texto proposto para o `CLAUDE.md`, §5) | **Correto.** A habilitação (`VITRINE_COMPONENTES=true` ou `next dev`), os caminhos, as famílias, a licença, o ponto de quebra único `@media (min-width: 48rem)` e o comando `npx playwright test e2e/a11y-base.spec.ts` (exige build e porta 3000 livre; o `webServer` liga a variável; axe 4.14.0) conferem com o código e com as execuções acima. Sugestão opcional: citar que valores diferentes de `true`/`false` derrubam o `check-env` |

### Defeitos

```
DEF-1 — Procedimento de extração das fontes no README falha como escrito   Severidade: baixa   Estado: verificado (rodada 2)
CA relacionado: — (RN-6/R-9: rastreabilidade das fontes; T-11)
Ambiente: feat/d-009-base-visual sem commit sobre 27d5c2b, README.md, seção "Interface e acessibilidade" > "Fontes"
Passos para reproduzir:
  1. Numa pasta temporária vazia, seguir o bloco: npm pack …; tar -xzf fontsource-variable-fraunces-5.3.0.tgz -C fraunces
  2. Observar a saída do tar.
Resultado esperado: os arquivos extraídos em fraunces/ e sourcesans/.
Resultado observado: "tar: fraunces: Cannot open: No such file or directory". O `-C` exige a pasta existente,
e o bloco não tem `mkdir -p fraunces sourcesans`.
Classe de falha: documentação
Correção sugerida: acrescentar `mkdir -p fraunces sourcesans` antes dos `tar`.
```

```
DEF-2 — O 404 da vitrine ainda expõe o título da página na carga RSC   Severidade: baixa   Estado: verificado (rodada 2)
CA relacionado: CA-18 / RN-17 ("corpo padrão de 'não encontrado'"); não reprova o CA (o status é 404 e nenhum componente é renderizado)
Ambiente: imagem agenda-beleza:dev construída do código atual, compose com .env = .env.example (VITRINE_COMPONENTES=false)
Passos para reproduzir:
  1. docker compose up -d --wait
  2. curl -s http://localhost:3000/dev/componentes | grep -c "Vitrine de componentes"
Resultado esperado: o corpo idêntico ao de uma rota inexistente, sem menção à vitrine.
Resultado observado: 404 com o corpo padrão de "não encontrado", mas o payload RSC embutido
contém {"children":"Vitrine de componentes · Agenda Beleza"} (a `metadata` estática da página é resolvida mesmo com
notFound()). Uma rota inexistente não traz esse texto. O /dev/mp-checkout (D-007) segue o mesmo padrão.
Classe de falha: exposição de informação (mínima: só revela que a rota existe)
Correção sugerida (sem urgência): trocar a `metadata` estática por `generateMetadata` que só devolve o título quando
`vitrineHabilitada(process.env)`; aplicar o mesmo ao mp-checkout numa manutenção.
```

Nenhum defeito crítico, alto ou médio.

### Observações (não são defeitos)
- **O-1 (E2E do percurso por Tab):** `percorrerComTab` agrupa paradas consecutivas com a mesma chave ("o date input tem vários segmentos internos: conta uma vez"). Por isso, só o contorno do 1º segmento do `input type="date"` é verificado. A parada do botão do calendário (o `input` sem `outline` e com `:focus-visible` falso) fica fora da asserção. Na inspeção manual, o Chromium desenha o próprio anel de foco no ícone, então hoje não há falha de foco visível. Se o estilo do `input[type=date]` mudar (por exemplo, `::-webkit-calendar-picker-indicator`), o E2E não perceberia.
- **O-2 (mutação 6):** a troca do Esc para o evento `cancel` é pega pelo unitário, não pelo E2E. A defesa em profundidade do `ConfirmDialog` mantém o comportamento correto no navegador.
- **O-3 (mutação 1b):** a "aritmética só com inteiros" da RN-11 vale pelo código (`String(centavos)` + fatias), não pelo teste. Um `toFixed(2)` daria a mesma saída para todo inteiro seguro testado.
- **O-4 (ambiente local):** neste computador, os contêineres Docker na rede *bridge* estão sem saída para a internet, e o `docker compose up --build` fica parado em `npm ci`. O problema é da máquina, não do projeto. A CI não é afetada.
- **O-5 (CI):** a conferência dos seis jobs, inclusive o tempo do job `e2e` (localmente cerca de 10 s de teste mais o build), fica para o PR (P-2 do `dev.md`).

### Veredito da rodada 1
**APROVADO.** Os CAs 1 a 21 passaram, com o CA-21 local completo e a CI pendente de conferência no PR pelo líder. Todos os gates passaram: lint, typecheck, build sem ambiente, `npm test` (1513), cobertura de **99,92% das linhas** (1286/1287, sem exclusão nova), E2E (25 de 25; `--repeat-each=3`: 72 de 72) e CA-18 por processo (compose → 404). Das 10 mutações, as que deveriam reprovar reprovaram; a 1b e a 2 passam com saída correta, e a 6 só é pega pelo unitário (detalhes acima). Não há defeito crítico, alto ou médio aberto. Os abertos são o DEF-1 e o DEF-2, ambos de severidade baixa.

## Rodada 2 — 19/11/2026 (reteste do DEF-1 e do DEF-2)

### Ambiente
- Mesma branch e base, mesmo Node e mesmo PostgreSQL da rodada 1. Entrega descrita no `dev.md` §6.
- Arquivos alterados nesta rodada:
  - `README.md`;
  - `src/app/dev/componentes/page.tsx` e `page.test.tsx`;
  - `src/app/dev/mp-checkout/page.tsx` e `page.test.ts` (novo);
  - `tests/integration/integracoes/checkout.test.ts` (D-007). A troca de `metadata` por `generateMetadata().robots` é consequência direta do DEF-2. O `vi.stubEnv` novo é desfeito pelo `vi.unstubAllEnvs()` do `afterEach` que já existia no arquivo.
- Antes de começar, salvei `git status`, `git diff` e o `.env`. Durante as sondas, o `.env` foi movido para o scratchpad e depois restaurado (`diff` idêntico).
- Estado final: portas 3000 e 3100 livres. A árvore está igual à entregue pelo desenvolvedor, mais este arquivo.

### Correção de registro da rodada 1
Na rodada 1, escrevi que o título do documento no 404 da vitrine era "404: This page could not be found.". Está errado. A saída da própria rodada 1 (`grep -o "<title>…"`) já mostrava `<title>Agenda Beleza</title>` para `/dev/componentes`. O título "404: …" só aparece em rotas que não existem. As frases da rodada 1 foram corrigidas. A O-R2 do desenvolvedor, portanto, **não é uma regressão** da rodada 2: o 404 dessas rotas sempre teve esse título.

### DEF-1: verificado
O bloco `bash` da seção "Fontes" foi extraído do próprio `README.md` com `awk` e rodado com `bash -e` numa pasta vazia do scratchpad. Resultado:
- rc=0;
- `7234ed860a9c…e0d783  fraunces/package/files/fraunces-latin-opsz-normal.woff2`;
- `19143dca0759…60c7d5  sourcesans/package/files/source-sans-3-latin-wght-normal.woff2`.

Os dois valores são iguais ao `sha256sum` dos arquivos em `src/app/_fontes/`. Os `package/LICENSE` extraídos também são idênticos (`cmp`) a `OFL-Fraunces.txt` e `OFL-SourceSans3.txt`.

### DEF-2: verificado
Para as sondas, fiz o build sem `.env` e sem `DATABASE_URL`/`VITRINE_COMPONENTES` (exit 0). Depois subi `next start -p 3100` com `env -u VITRINE_COMPONENTES -u MP_ADAPTER -u NODE_ENV`, mais o que cada cenário pede, e o `.env` fora do lugar. Em cada resposta, contei as ocorrências de três textos: "Vitrine de componentes", "Checkout simulado" e "This page could not be found".

| Cenário | Rota | Status | `<title>` | robots | "Vitrine" | "Checkout simulado" |
|---|---|---|---|---|---|---|
| sem variáveis, `MP_ADAPTER=real` | `/dev/componentes` (com e sem `?layout=painel`) | 404 | Agenda Beleza | `noindex` | 0 | 0 |
| | `/dev/mp-checkout` (com e sem `?assinatura=x`) | 404 | Agenda Beleza | `noindex` | 0 | **0** |
| | `/rota-inexistente` | 404 | Agenda Beleza + "404: This page could not be found." | `noindex` | 0 | 0 |
| sem variáveis (MP padrão = simulado) | `/dev/componentes` | 404 | Agenda Beleza | `noindex` | **0** | 0 |
| | `/dev/mp-checkout?assinatura=x` | 404 | Agenda Beleza | `noindex` | 0 | 1 (limite aceito, abaixo) |
| `VITRINE_COMPONENTES=true`, `MP_ADAPTER=simulado` | `/dev/componentes` (com e sem `?layout=painel`) | **200** | Vitrine de componentes · Agenda Beleza | `noindex, nofollow` | 3 | 0 |

Em todos os 404 das duas rotas aparece o texto padrão "This page could not be found.". Na rodada 1, o mesmo `/dev/componentes` desligado tinha "Vitrine de componentes" no payload. Agora tem 0.

Mutações, revertidas e conferidas com `cmp`:
- `generateMetadata` da vitrine devolvendo sempre os metadados: **5 falhas** em `page.test.tsx` ("DEF-2: desligada (…) não expõe título…", com a variável ausente, vazia, `false`, `1` e `TRUE`);
- o mesmo no `mp-checkout`: **2 falhas** em `page.test.ts` (`MP_ADAPTER=real` e `x`).

### Avaliações pedidas
- **O-R2: aceito, não é defeito.** No 404 das duas rotas, o `<title>` é "Agenda Beleza" (do layout raiz), e não "404: This page could not be found.". Motivos:
  - o comportamento é o mesmo da rodada 1 (ver a correção de registro acima) e vem do Next quando a página chama `notFound()`, e não da correção;
  - o status é 404, o corpo é o padrão de "não encontrado", o robots é `noindex` e nada da vitrine ou do checkout aparece;
  - a RN-17 exige o 404 pelo `notFound()` com o corpo padrão, não um título específico.
- **Limite do `mp-checkout` no modo simulado: aceito, não é defeito.** Com `MP_ADAPTER` simulado (o padrão), um ID inválido responde 404 com "Checkout simulado" no payload. Motivos:
  - nesse modo, a rota existe de propósito (é a página de checkout do adaptador simulado, D-007);
  - revelar o título dela não expõe nada que já não esteja acessível;
  - o modo real, o de produção, não tem nenhuma ocorrência;
  - fechar esse caso exigiria ler o banco no `generateMetadata`, sem ganho de segurança.

### Gates (regressão)
| Comando | Resultado |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` (sem `.env`, `env -u DATABASE_URL -u VITRINE_COMPONENTES`) | exit 0 (`ƒ /dev/componentes`, `ƒ /dev/mp-checkout`) |
| `npm run test:coverage` | exit 0: **115 arquivos, 1524 testes**. **Linhas 99,92% (1288/1289)**; ramos 97,75%. `componentes/page.tsx` e `mp-checkout/page.tsx` com 100% de linhas. Nenhuma exclusão nova (`git diff vitest.config.ts` vazio; nenhum `v8/istanbul/c8 ignore`) |
| `npm run test:e2e` (porta 3000 livre) | exit 0: **25 passaram** (9,5 s) |
| `checkout.test.ts` (D-007) | verde dentro do `test:coverage` |

### Veredito da rodada 2
**APROVADO.**
- DEF-1 e DEF-2 estão verificados, por processo e por mutação.
- A O-R2 e o limite do `mp-checkout` no modo simulado foram avaliados e aceitos.
- A regressão passou: lint, typecheck, build, cobertura de 99,92% das linhas e E2E 25 de 25.
- Os CAs da rodada 1 continuam atendidos.
- Não há defeito aberto.
- Continua pendente a CI dos seis jobs no PR, que fica com o líder.
