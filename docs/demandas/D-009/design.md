# D-009 — Desenho: base visual e de navegação (issue #10, E0.8)

Autor: arquiteto-software. Entradas: `docs/demandas/D-009/spec.md` (RN-1..RN-24, CA-1..CA-21, D-1..D-25), `issue-10.md`, `PLAN.md` ("Interface", "Perfis e acesso"), `CLAUDE.md`, `docs/demandas/D-001/design.md` (E0.8, rotas dos consumidores), `docs/demandas/D-007/design.md` (critério de idade das dependências), `docs/demandas/D-008/design.md` (formato) e o código da branch `feat/d-009-base-visual` (= `main` em `27d5c2b`).

## 0. Verificações feitas antes do desenho

As sondas rodaram numa cópia do repositório na pasta de rascunho da sessão, fora do repositório, e já foram apagadas. Nada foi instalado nem alterado no repositório.

| Verificação | Resultado |
|---|---|
| `next/font/local` no Next 16.4.6 (Turbopack) | `next build` compila com dois `.woff2` variáveis locais, sem rede. O CSS gerado usa o **nome da constante JS** como família (`font-family: fonteTitulo`, `fonteTitulo Fallback`) e define `--fonte-titulo: "fonteTitulo", "fonteTitulo Fallback", Georgia, serif` na classe `variable`. O `<html>` recebe `class="<hash>_variable <hash>_variable"`. Os arquivos vão para `.next/static/media/`. |
| `next/font/local` fora do Next | `node_modules/next/font/local/index.js` tem **0 bytes**: no Vitest, a chamada `localFont(...)` falha (`default` indefinido), porque é uma macro de compilação. Os testes que importam o layout raiz precisam de `vi.mock('next/font/local', …)` (R-3). |
| Vitrine lida na requisição (sonda com `force-dynamic`) | Com o mesmo build, `next start` **sem** `VITRINE_COMPONENTES` → `GET /dev/componentes` = **404**. Com `VITRINE_COMPONENTES=true` no processo → **200**, `?layout=x` → 200, `<meta name="robots" content="noindex, nofollow"/>`. O `next build` não exige a variável. |
| Playwright `webServer.env` (1.65.1) | O processo do servidor recebe `{ ...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env, ...webServer.env }`: a variável do config **prevalece** sobre o ambiente. O `next start` também lê o `.env` local, mas não sobrescreve variáveis já definidas no processo. |
| `Date` de Server Component para Client Component | Um `Date` passado como prop chega intacto ao componente cliente (React 19 Flight). |
| `usePathname()` | No `next start`, devolve `/dev/componentes`. **No jsdom, fora do App Router, devolve `null` sem lançar.** `useRouter()` lança fora do App Router, então os componentes não o usam. |
| `<dialog>` no Chromium do Playwright | (a) **Sem trava de foco própria, o Tab sai do diálogo modal para a interface do navegador** (`activeElement` = `BODY` depois do último botão). A trava explícita da RN-10 é obrigatória. (b) **`preventDefault()` só no evento `cancel` não impede o fechamento**: o *close watcher* do Chromium fechou o diálogo no 1º Esc. (c) **`preventDefault()` no `keydown` de `Escape`** mantém o diálogo aberto em 3 Esc seguidos e não dispara `cancel`. (d) Ao fechar, o Chromium devolve o foco ao elemento de origem (o componente faz isso de forma explícita do mesmo jeito). |
| jsdom 31.0.1 | `HTMLDialogElement.prototype.showModal` é `undefined`, e a propriedade `open` existe. O dublê de teste só precisa de `showModal`/`close`. |
| `TZ` em tempo de execução no Vitest 5 (pool padrão) | `vi.stubEnv('TZ', 'Asia/Tokyo')` muda `Date#getTimezoneOffset()` (−540) e o fuso padrão do `Intl` (13:00Z → `22`), e `'UTC'` volta a 0. **O teste do CA-9 pode trocar o `TZ` no próprio processo**, com uma autoverificação (D-23). |
| `Intl` (Node 24.21, ICU 78.3) | `timeZone: ''` → `RangeError`. `hourCycle: 'h23'` + `numberingSystem: 'latn'` dá `00` à meia-noite. `formatToParts` separa data e hora com o literal `", "` (por isso a montagem é por partes). `timeZoneName: 'longOffset'` dá `GMT-02:00`/`GMT-03:00` para 2019-02-17T01:00Z/02:00Z em `America/Sao_Paulo`, e `GMT+00:00` em UTC (alguns ICU dão só `GMT`). Fuso em caixa diferente (`america/sao_paulo`) é aceito e normalizado. |
| CSS Modules no Vitest | Sem processamento de CSS (padrão), `import s from './x.module.css'` devolve um proxy com nomes de classe estáveis. Não precisa de configuração. |
| `@axe-core/playwright` (hoje: 2026-11-19; corte de 2 semanas da D-007: 2026-11-05) | **4.14.0** (2026-10-15, 35 dias) é a última estável. Licença MPL-2.0. Depende de `axe-core ~4.14.0`, o que hoje resolveria **4.14.1 (2026-11-16, 3 dias, abaixo do corte)**. `axe-core@4.14.0` (2026-10-05) não tem script de instalação. Peer: `playwright-core >= 1.0.0` (já presente). |
| `@testing-library/user-event` | 14.6.13 (ontem), com 6 versões em 10 dias. A mais nova acima do corte é 14.6.8. Não será adotada (D-24). |
| Fontes (tarballs do npm baixados com `npm pack`, sem instalar) | `@fontsource-variable/fraunces@5.3.0` (2026-07-19, OFL-1.1): `files/fraunces-latin-opsz-normal.woff2`, 67 304 bytes, eixos `wght` 100–900 e `opsz` 9–144, sha256 `7234ed860a9cc83045413c4faee63c960a8f2d1917adcf728119307d56e0d783`. `@fontsource-variable/source-sans-3@5.3.1` (2026-10-11, OFL-1.1): `files/source-sans-3-latin-wght-normal.woff2`, 28 872 bytes, `wght` 200–900, sha256 `19143dca075972bc84e3fd9eab7416dd40cc565dccb2435a044bdfabe060c7d5`. Os dois começam com a assinatura `wOF2`, e o `LICENSE` de cada pacote traz o texto da OFL 1.1 com o copyright. O subconjunto `latin` cobre U+0000–00FF (acentos do pt-BR e NBSP), U+2000–206F (`…`) e **U+2212** (sinal de menos da D-21). |
| Paleta (script de contraste WCAG 2.x e HSL) | Todos os pares da RN-5 passam (tabela da §3.1). Nenhum token tem matiz em [290°, 360°) com saturação ≥ 20%: os matizes ficam entre 8° e 188°. |
| Usos de `Intl`/`toLocale*` em `src/` hoje | Só `src/app/dev/mp-checkout/page.tsx:17`. O teste `tests/integration/integracoes/checkout.test.ts:112` espera `'R$ 79,00'` (NBSP), o que continua valendo com `formatarMoeda`. |
| Pastas de primeiro nível de `src/app` | `api` e `dev`. A pasta de fontes desta demanda usa o prefixo `_` (pasta privada do App Router, fora do roteamento): `src/app/_fontes/`. |

## 1. Resumo da solução

- **Tema** em `src/app/globals.css`: tokens em `:root` (cores `#rrggbb`, tipografia, espaçamento, raio, foco, alvo mínimo), base de elementos (`body`, `h1`..`h3`, links, `:focus-visible`), utilitária `.visualmente-oculto`, `color-scheme: light` e `prefers-reduced-motion`. Os componentes usam CSS Modules (`*.module.css`), que só referenciam `var(--…)`. Um único ponto de quebra, `@media (min-width: 48rem)`, mobile-first.
- **Fontes** com `next/font/local` em `src/app/fontes.ts`: **Fraunces** (serifada, títulos) e **Source Sans 3** (sem serifa, corpo e controles), as duas OFL 1.1. Os `.woff2` e as licenças ficam versionados em `src/app/_fontes/`. O layout raiz importa o CSS e põe as duas classes `variable` no `<html>`.
- **Formatadores** em `src/lib/format.ts`, puros e sem dependência do ambiente. A moeda é montada por **texto e aritmética inteira** (sem `Intl`), e data e hora usam `Intl.DateTimeFormat#formatToParts` com `timeZone` explícito, `hourCycle: 'h23'` e `numberingSystem: 'latn'`, montadas com separadores fixos. Também há um auxiliar de deslocamento UTC para a `SlotGrid` (D-21).
- **Rotas e navegação** em `src/config/navegacao.ts`: `ROTAS` (constantes e funções que codificam parâmetros), `NAVEGACAO_PAINEL` por papel, `NAVEGACAO_ADMIN`, `SEGMENTOS_RESERVADOS`, `itensDoPainel(papel)` (falha fechada) e `itemAtivo(itens, caminho)`.
- **Componentes** em `src/components/ui/`: um arquivo por componente, com módulo CSS e teste próprios, sem barril (`index.ts`), para que cada arquivo tenha um único dono.
- **Layouts** em `src/components/layout/`: uma estrutura comum (link de pular, `header`, `nav`, `main#conteudo`, `footer`) e o menu móvel `MenuNavegacao` (cliente, *disclosure*). O papel e o caminho atual chegam por prop, com `usePathname` como padrão.
- **Vitrine** `/dev/componentes`: `page.tsx` (servidor, `force-dynamic`, `notFound()` sem a habilitação) + `Vitrine.tsx` (cliente, exemplos e contadores) + `opcoes.ts` (lê `?layout`, `?papel` e `?caminho`). A habilitação é `vitrineHabilitada(process.env)` (em `src/server/env.ts`): só o texto exato `VITRINE_COMPONENTES=true` ou `NODE_ENV=development` habilita.
- **E2E** `e2e/a11y-base.spec.ts`: teclado, diálogo, menu, larguras de 320, 375 e 1280 px, fontes e axe (`@axe-core/playwright@4.14.0`, com `axe-core@4.14.0` fixado). O `playwright.config.ts` liga a vitrine no `webServer.env`.
- **Conformidade por varredura** (testes unitários que leem os arquivos): sem cor literal fora de `globals.css`, um só ponto de quebra, formatação de exibição só em `format.ts`, sem `@/server` em tempo de execução nos componentes e sem `dangerouslySetInnerHTML`.

### 1.1 Alternativas descartadas
| Alternativa | Motivo |
|---|---|
| `next/font/google` | O `next build` baixa as fontes da rede nos jobs `build`, `e2e` e `docker` da CI e no `docker build`, o que dá build não determinístico e falhas por rede. Com `next/font/local`, o build fica igual sem rede (§0). |
| Instalar `@fontsource-variable/*` como dependência e importar o CSS | Traz um CSS de terceiros com `font-family` própria e sem as variáveis/fallback ajustado do `next/font`, e põe pacotes de fonte no `package.json` só para copiar arquivos. Os `.woff2` são extraídos do tarball uma vez e versionados (procedimento no T-3). |
| Playfair Display / Cormorant Garamond (títulos) | Playfair é muito associada a produtos de beleza genéricos. Cormorant tem altura-x baixa e hastes finas, frágil em `h3` de 20 px. A Fraunces tem eixo óptico (`opsz`), fica elegante em tamanhos grandes e legível em `h3`, e é quente sem ser rebuscada. |
| Inter (corpo) | Neutra demais para a direção "quente". A Source Sans 3 é humanista, legível a 16 px e tem subconjunto latino de 29 KB. |
| Tailwind, Radix, shadcn, MUI, biblioteca de ícones | D-25 confirmada. Os componentes são poucos, e o comportamento de foco é exigido em detalhe (RN-10, RN-13), então uma biblioteca acrescentaria peso e comportamento a sobrepor. CSS global com CSS Modules já vem com o Next. |
| `@testing-library/user-event` | D-24: não adotado (§0 e §7.1). |
| Vitrine decidida por `NODE_ENV` | O E2E roda sobre o build de produção (`NODE_ENV=production`), então não distinguiria E2E de produção (§0). |
| Subrotas da vitrine (`/dev/componentes/painel`) | A issue lista uma única `page.tsx`. Com parâmetros de busca, há um só ponto de 404 (D-19). |
| Regra de ESLint (`no-restricted-syntax`) para `Intl`/`toLocale*` e cores | O bloco `no-restricted-syntax` existente (RN-16 c da D-007) teria de ser mesclado, e cor literal em CSS não é alcançável pelo ESLint. A varredura por teste cobre TS, TSX e CSS de uma vez (D-8). |
| Trava de foco com biblioteca (`focus-trap`) | Dependência nova para cerca de 20 linhas. O ciclo explícito no `keydown` é testável no jsdom com o dublê. |
| Fechar o diálogo por `preventDefault` no evento `cancel` | Não funciona no Chromium por causa do *close watcher* (§0). O Esc é tratado no `keydown`. |
| `<details>/<summary>` para o menu móvel | Sem controle de Esc nem de devolução de foco (D-17). |
| Duas marcações no `DataList` (tabela e lista) | Duplica o conteúdo, e a cópia escondida precisaria ficar fora da árvore de acessibilidade em cada largura. Uma tabela com CSS empilhado basta (D-20). |
| `button` + `aria-pressed` na `SlotGrid` | Seria uma parada de Tab por horário (dezenas na página pública). Rádios nativos dão uma parada por grupo, setas e "marcado" anunciado de graça (D-21). |

### 1.2 Dependências novas (todas em `devDependencies`, com versão exata)
- `@axe-core/playwright` **4.14.0**: integrador oficial (Deque) do axe-core com o Playwright, exigido pela RN-23. Fica fora da imagem (`npm prune --omit=dev`, `Dockerfile:19`).
- `axe-core` **4.14.0**: declarado de forma explícita para **fixar o motor de regras** que define o gate. O `~4.14.0` do integrador resolveria a 4.14.1, de 3 dias (abaixo do critério de 2 semanas da D-007), e uma versão nova do axe-core pode acrescentar regras e reprovar o gate sem nenhuma mudança nossa. Atualizar o `axe-core` vira uma decisão explícita. O lock deve ter uma única cópia, `node_modules/axe-core` = 4.14.0, sem cópia aninhada sob `@axe-core/playwright`. Nenhum código nosso o importa diretamente.
- Nenhuma outra. As fontes são arquivos versionados, não pacotes.

### 1.3 Fontes (D-2)
| Papel | Família | Arquivo em `src/app/_fontes/` | Origem | Licença |
|---|---|---|---|---|
| Títulos (`h1`..`h3`, títulos de diálogo, estado vazio e erro) | Fraunces (variável, `wght` 100–900 + `opsz`) | `fraunces-latin-opsz-normal.woff2` | `npm pack @fontsource-variable/fraunces@5.3.0` → `package/files/fraunces-latin-opsz-normal.woff2` (sha256 na §0) | SIL OFL 1.1 → `OFL-Fraunces.txt` (cópia de `package/LICENSE`) |
| Corpo e controles | Source Sans 3 (variável, `wght` 200–900) | `source-sans-3-latin-wght-normal.woff2` | `npm pack @fontsource-variable/source-sans-3@5.3.1` → `package/files/source-sans-3-latin-wght-normal.woff2` (sha256 na §0) | SIL OFL 1.1 → `OFL-SourceSans3.txt` |

- Só o estilo normal, porque nenhum componente usa itálico. Tamanho total: cerca de 96 KB, com *preload* pelo `next/font`.
- Fallbacks: títulos `Georgia, 'Times New Roman', serif` com `adjustFontFallback: 'Times New Roman'`; corpo `system-ui, 'Segoe UI', Arial, sans-serif` com `adjustFontFallback: 'Arial'`.
- O tester faz a revisão visual de que nenhuma das duas lembra AppBarber ou AppBeleza (RN-22, fora da automação).

## 2. Componentes afetados

| Caminho | Mudança | Tarefa |
|---|---|---|
| `src/lib/format.ts` (novo, + `format.test.ts`) | Formatadores e `FUSO_PADRAO` (§3.3) | T-1 |
| `src/lib/format.fonte-unica.test.ts` (novo) | CA-10 (varredura) | T-1 |
| `src/app/dev/mp-checkout/page.tsx` | `formatarMoeda(dados.valorCentavos)` no lugar do `Intl` local; estilos inline mantidos (D-11) | T-1 |
| `src/config/navegacao.ts` (novo, + teste) | §3.4 | T-2 |
| `src/app/globals.css` (novo, + `globals.test.ts`) | §3.1 | T-3 |
| `src/app/fontes.ts` (novo, + teste), `src/app/_fontes/*` (novos) | §1.3, §3.2 | T-3 |
| `src/app/layout.tsx`, `src/app/layout.test.tsx` | Importa `./globals.css` e põe as classes das fontes no `<html>` (§3.2) | T-3 |
| `package.json`, `package-lock.json` | `@axe-core/playwright@4.14.0` e `axe-core@4.14.0` em `devDependencies` | T-4 |
| `src/server/env.ts` (+ teste), `.env.example` | `VITRINE_COMPONENTES` e `vitrineHabilitada` (§3.10) | T-4 |
| `playwright.config.ts` | `webServer.env: { VITRINE_COMPONENTES: 'true' }` | T-4 |
| `src/lib/dependencias-e2e.test.ts` (novo) | CA-15 (versões exatas no `package.json` e no lock) | T-4 |
| `src/components/ui/{Button,Field,Select,Checkbox,Alert,EmptyState,ErrorState,DataList}.tsx` (+ `.module.css`, `.test.tsx`), `src/components/ui/campo.ts` (+ teste) | §3.5, §3.8 | T-5 |
| `src/components/ui/{ConfirmDialog,SlotGrid}.tsx` (+ `.module.css`, `.test.tsx`), `tests/support/dialogo.ts` | §3.6, §3.7 | T-6 |
| `src/components/layout/{Estrutura,PublicLayout,PanelLayout,AdminLayout,MenuNavegacao}.tsx`, `Layout.module.css` (+ testes) | §3.9 | T-7 |
| `src/app/dev/componentes/{page.tsx,Vitrine.tsx,opcoes.ts,Vitrine.module.css}` (+ testes) | §3.10 | T-8 |
| `src/components/conformidade.test.ts` (novo) | CA-20 e varreduras da §3.12 | T-9 |
| `e2e/a11y-base.spec.ts`, `e2e/suporte/vitrine.ts` (novos) | §3.11 | T-10 |
| `README.md`, `CLAUDE.md` | Seção "Interface e acessibilidade"; "Project status" e "Comandos e cobertura" | T-11 |

**Nenhuma** mudança em `prisma/**`, migrações, `src/server/repos/**`, `src/server/tenant/**`, `src/worker/**`, `eslint.config.mjs`, `vitest.config.ts`, `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `.dockerignore` nem `.github/workflows/ci.yml`. O `src/app/page.tsx` não muda (é da E9.1) e herda o tema pelo layout raiz.

## 3. Interfaces

### 3.1 Tokens (`src/app/globals.css`)

Nomes em pt-BR, com o prefixo da categoria. Todo token de cor é `#rrggbb` e fica **só** dentro do bloco `:root`. Fora dele, o arquivo não tem nenhum literal de cor (o teste do CA-13 confere).

| Token | Valor | Uso |
|---|---|---|
| `--cor-fundo` | `#faf6f1` | fundo da página (linho) |
| `--cor-superficie` | `#fffdfa` | cartões, diálogo, campos, menu aberto |
| `--cor-superficie-alt` | `#f2ebe3` | barra lateral, cabeçalho de tabela, linhas alternadas |
| `--cor-texto` | `#2b211c` | texto principal |
| `--cor-texto-suave` | `#665247` | texto secundário, ajuda |
| `--cor-borda-controle` | `#8a7363` | borda de campo, select, checkbox, horário, botão secundário |
| `--cor-borda-sutil` | `#e3d8cc` | divisores decorativos (não identificam controle; fora da 1.4.11) |
| `--cor-primaria` | `#9a603f` | ação primária (terracota), horário selecionado |
| `--cor-primaria-forte` | `#74462d` | *hover* da primária (só fora de `:focus-visible`), cor de link |
| `--cor-sobre-primaria` | `#fffaf5` | texto sobre a primária e a primária forte |
| `--cor-perigo` | `#ab4330` | ação de perigo (vermelho-terroso) |
| `--cor-perigo-forte` | `#86301f` | *hover* do perigo (só fora de `:focus-visible`) |
| `--cor-sobre-perigo` | `#fffaf5` | texto sobre o perigo |
| `--cor-foco` | `#16110f` | indicador de foco |
| `--cor-info-fundo` / `--cor-info-texto` | `#e5ecea` / `#284448` | `Alert` informação (sálvia) |
| `--cor-sucesso-fundo` / `--cor-sucesso-texto` | `#e7ecdc` / `#364d20` | `Alert` sucesso (oliva) |
| `--cor-aviso-fundo` / `--cor-aviso-texto` | `#f5e8cf` / `#634510` | `Alert` aviso (ocre) |
| `--cor-erro-fundo` / `--cor-erro-texto` | `#f6e2da` / `#842a1b` | `Alert` erro e texto de erro dos campos |

Pares conferidos pelo `globals.test.ts` (CA-13), com a razão calculada na sonda:

| Par (texto/indicador sobre fundo) | Mínimo | Razão |
|---|---|---|
| `texto` / `fundo`, `superficie`, `superficie-alt` | 4,5 | 14,60 / 15,47 / 13,29 |
| `texto-suave` / `fundo`, `superficie`, `superficie-alt` | 4,5 | 6,82 / 7,22 / 6,21 |
| `primaria-forte` (link) / `fundo`, `superficie`, `superficie-alt` | 4,5 | 7,35 / 7,79 / 6,69 |
| `erro-texto` / `fundo`, `superficie` (erro de campo) | 4,5 | 8,38 / 8,88 |
| `sobre-primaria` / `primaria`, `primaria-forte` | 4,5 | 4,92 / 7,62 |
| `sobre-perigo` / `perigo`, `perigo-forte` | 4,5 | 5,66 / 8,24 |
| `info-texto`/`info-fundo`, `sucesso-texto`/`sucesso-fundo`, `aviso-texto`/`aviso-fundo`, `erro-texto`/`erro-fundo` | 4,5 | 8,71 / 7,78 / 7,25 / 7,22 |
| `borda-controle` / `fundo`, `superficie`, `superficie-alt` | 3 | 4,14 / 4,39 / 3,77 |
| `foco` / `fundo`, `superficie`, `superficie-alt`, `primaria`, `perigo` | 3 | 17,41 / 18,45 / 15,85 / 3,67 / 3,19 |
| `primaria` / `fundo`, `superficie` (borda do horário selecionado) | 3 | 4,74 / 5,02 |

- O par foco/`primaria-forte` (2,37) **não** acontece: a cor forte só se aplica em `:hover:not(:focus-visible)`, então o anel de foco sempre fica ao lado da `primaria`/`perigo` ou do fundo.
- **Tipografia:** `--fonte-titulo` e `--fonte-corpo` (definidas pelo `next/font`, §3.2), `--texto-sm: 0.875rem` (só ajuda e legenda), `--texto-base: 1rem`, `--texto-lg: 1.125rem`, `--texto-xl: 1.375rem`, `--texto-2xl: 1.75rem`, `--texto-3xl: 2.25rem`, `--altura-linha: 1.6`, `--altura-linha-titulo: 1.2`. O `body` usa `--texto-base` (16 px). `input`, `select`, `textarea` e `button` herdam `font: inherit` com `font-size: max(1rem, …)`, para ficarem com pelo menos 16 px.
- **Espaçamento** (base 0,25 rem): `--espaco-1` 0.25rem, `--espaco-2` 0.5rem, `--espaco-3` 0.75rem, `--espaco-4` 1rem, `--espaco-6` 1.5rem, `--espaco-8` 2rem, `--espaco-12` 3rem, `--espaco-16` 4rem.
- **Forma:** `--raio: 0.5rem`, `--raio-grande: 1rem`, `--largura-conteudo: 72rem`, `--largura-lateral: 15rem`.
- **Foco e alvo:** `--foco-largura: 3px` (≥ 2 px), `--foco-afastamento: 2px`, `--alvo-minimo: 2.75rem` (44 px).
- **Movimento:** `--duracao: 150ms`.
- **Base** (fora do `:root`, sem cores literais):
  - `:root { color-scheme: light }`;
  - `body` com fundo `--cor-fundo`, cor `--cor-texto`, família `var(--fonte-corpo)` e `overflow-wrap: anywhere` em textos longos;
  - `h1, h2, h3` com `var(--fonte-titulo)` e `font-optical-sizing: auto`;
  - `a` com `--cor-primaria-forte` e sublinhado;
  - `:focus-visible { outline: var(--foco-largura) solid var(--cor-foco); outline-offset: var(--foco-afastamento); }`;
  - `.visualmente-oculto` (*clip pattern*);
  - `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }`.
- **Ponto de quebra (D-3):** um comentário no topo documenta `48rem` (768 px). Variáveis CSS não funcionam em `@media`, então **toda** media query de largura em `src/**/*.css` é exatamente `@media (min-width: 48rem)` (mobile-first). O teste de conformidade confere isso (§3.12).
- **Proibido:** `outline: none`/`outline: 0` sem um substituto visível no mesmo seletor (a varredura recusa `outline:\s*(none|0)` em qualquer CSS). Nenhum componente precisa disso.

### 3.2 Fontes e layout raiz
```ts
// src/app/fontes.ts — só o layout raiz importa este módulo.
import localFont from 'next/font/local';
export const fonteTitulo = localFont({
  src: './_fontes/fraunces-latin-opsz-normal.woff2', weight: '100 900', style: 'normal',
  display: 'swap', variable: '--fonte-titulo',
  fallback: ['Georgia', 'Times New Roman', 'serif'], adjustFontFallback: 'Times New Roman',
});
export const fonteCorpo = localFont({
  src: './_fontes/source-sans-3-latin-wght-normal.woff2', weight: '200 900', style: 'normal',
  display: 'swap', variable: '--fonte-corpo',
  fallback: ['system-ui', 'Segoe UI', 'Arial', 'sans-serif'], adjustFontFallback: 'Arial',
});
```
- Os nomes das constantes (`fonteTitulo`, `fonteCorpo`) viram as famílias no CSS gerado (§0). O E2E do CA-19 compara a família computada com o primeiro nome de `--fonte-titulo`/`--fonte-corpo` lido do `<html>`, sem fixar o nome.
- `src/app/layout.tsx`: `import './globals.css'` e `<html lang={siteConfig.locale} className={`${fonteTitulo.variable} ${fonteCorpo.variable}`}>`. `metadata`, `<body>{children}</body>` e a assinatura não mudam.
- Nos testes, `vi.mock('next/font/local', () => ({ default: (o) => ({ className: `cls${o.variable}`, variable: `var${o.variable}`, style: { fontFamily: 'x' } }) }))` em `layout.test.tsx` e `fontes.test.ts`. É um dublê de uma macro de compilação, não de banco. Assim, o `fontes.ts` executa e entra na cobertura.

### 3.3 Formatadores (`src/lib/format.ts`)
```ts
/** Igual ao @default de salao.fuso (prisma/schema.prisma:129); um teste compara os dois (D-14). */
export const FUSO_PADRAO = 'America/Sao_Paulo';

/** `R$` + U+00A0 + milhar com '.' + ',' + 2 casas. Só inteiros seguros ≥ 0 (D-13). */
export function formatarMoeda(centavos: number): string;
/** dd/mm/aaaa no fuso (IANA). `fuso` omitido → FUSO_PADRAO; '' ou inexistente → RangeError. */
export function formatarData(instante: Date, fuso?: string): string;
/** HH:mm, 00..23. */
export function formatarHora(instante: Date, fuso?: string): string;
/** 'dd/mm/aaaa HH:mm' com um único U+0020, sem vírgula. */
export function formatarDataHora(instante: Date, fuso?: string): string;
/** Deslocamento do fuso no instante: 'UTC−03:00' (U+2212), 'UTC+05:30', 'UTC+00:00'. Usado pela SlotGrid (D-21). */
export function formatarDeslocamentoUtc(instante: Date, fuso?: string): string;
```
- **Moeda, por texto e aritmética inteira (sem `Intl`):**
  - `typeof centavos !== 'number'` → `TypeError('formatarMoeda: o valor deve ser um número inteiro de centavos')`;
  - `!Number.isSafeInteger(centavos)` (cobre `NaN`, `±Infinity`, fração e acima de 2^53−1) → `RangeError('formatarMoeda: centavos deve ser um inteiro seguro (recebido: …)')`;
  - `centavos < 0` → `RangeError('… não pode ser negativo')`;
  - `const d = String(centavos).padStart(3, '0')`, `inteiro = d.slice(0, -2)`, `fracao = d.slice(-2)`, milhar por `inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')`, e o resultado é `` `R$ ${inteiro},${fracao}` ``.
  - Assim não há ICU (nem divergência U+00A0/U+202F entre servidor e navegador) nem ponto flutuante.
- **Data e hora:**
  - um `Intl.DateTimeFormat('pt-BR', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', numberingSystem: 'latn' })` por fuso, em cache num `Map` do módulo;
  - `formatToParts` → `{ day, month, year, hour, minute }`, montados com `/`, `:` e U+0020. Nunca se copia o literal do `Intl`;
  - garantia extra: `hour === '24'` vira `'00'` (alguns motores antigos; inofensivo);
  - validações: `!(instante instanceof Date)` → `TypeError`; `Number.isNaN(instante.getTime())` → `RangeError('… data inválida')`; `fuso === ''` → `RangeError`; um fuso inexistente faz o construtor do `Intl` lançar `RangeError`, que é relançado com mensagem em pt-BR (`Fuso horário inválido: "…"`) e `cause`.
- **Deslocamento:** `Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })` → `GMT-03:00`. `GMT` sozinho vira `+00:00`, e `-` vira U+2212. Resultado: `UTC` + sinal + `HH:MM`.
- **Restrições:** o módulo não tem imports nem lê `process.env`, e é usável em componente cliente. Nada é calculado no import além das constantes.

### 3.4 Rotas e navegação (`src/config/navegacao.ts`)
```ts
import type { PapelDeSalao } from '@/server/tenant/context';   // só tipo: apagado no bundle (D-16)

const seg = (v: string) => encodeURIComponent(v);
export const ROTAS = {
  // públicas
  inicio: '/', entrar: '/entrar', cadastro: '/cadastro', confirmarEmail: '/confirmar-email',
  recuperarSenha: '/recuperar-senha', redefinirSenha: '/redefinir-senha',
  convite: (token: string) => `/convite/${seg(token)}`,
  termos: '/termos', privacidade: '/privacidade',
  salaoPublico: (slug: string) => `/${seg(slug)}`,
  // painel
  painel: '/painel', agenda: '/painel/agenda', novaReserva: '/painel/agenda/nova',
  clientes: '/painel/clientes', servicos: '/painel/servicos', profissionais: '/painel/profissionais',
  jornada: (id: string) => `/painel/profissionais/${seg(id)}/jornada`,
  bloqueios: '/painel/bloqueios', configuracoes: '/painel/configuracoes',
  assinatura: '/painel/assinatura', assinaturaRetorno: '/painel/assinatura/retorno',
  // super admin
  admin: '/admin', adminEntrar: '/admin/entrar', adminSaloes: '/admin/saloes',
  adminSalao: (id: string) => `/admin/saloes/${seg(id)}`,
  adminSalaoAssinatura: (id: string) => `/admin/saloes/${seg(id)}/assinatura`,
  adminMensagens: '/admin/mensagens', adminAuditoria: '/admin/auditoria',
  // desenvolvimento (fora de qualquer navegação)
  devComponentes: '/dev/componentes', devMpCheckout: '/dev/mp-checkout',
} as const;

export type ItemNavegacao = { readonly chave: string; readonly rotulo: string; readonly href: string };

export const NAVEGACAO_PAINEL = {
  gestor: [ /* agenda 'Agenda', clientes 'Clientes', servicos 'Serviços', profissionais 'Profissionais',
              bloqueios 'Bloqueios', configuracoes 'Configurações', assinatura 'Assinatura' */ ],
  profissional: [ /* agenda 'Agenda', bloqueios 'Bloqueios' */ ],
} as const satisfies Record<PapelDeSalao, readonly ItemNavegacao[]>;

export const NAVEGACAO_ADMIN: readonly ItemNavegacao[];   // adminSaloes 'Salões', adminMensagens 'Mensagens', adminAuditoria 'Auditoria'

/** Falha fechada: papel fora do tipo (inclusive 'super_admin', 'toString', undefined) → []. Usa Object.hasOwn. */
export function itensDoPainel(papel: unknown): readonly ItemNavegacao[];

/** href do item ativo: igual ao caminho ou prefixo por segmento; vence o mais longo; null se nenhum (RN-14). */
export function itemAtivo(itens: readonly ItemNavegacao[], caminho: string | null | undefined): string | null;

/** Primeiros segmentos de todas as rotas (exceto /[slug]) + 'api' + '_next' (RN-15). */
export const SEGMENTOS_RESERVADOS: ReadonlySet<string>;
```
- Os `href` vêm sempre de `ROTAS`, nunca de texto solto. `SEGMENTOS_RESERVADOS` é calculado a partir de `ROTAS`: as funções são chamadas com `'x'`, `salaoPublico` fica de fora e o `'/'` puro é ignorado. Hoje o conjunto é `entrar, cadastro, confirmar-email, recuperar-senha, redefinir-senha, convite, termos, privacidade, painel, admin, dev, api, _next`.
- `itemAtivo` normaliza a barra final (`/painel/agenda/` = `/painel/agenda`) e ignora `?`/`#`. `'/painel/agendamento'` **não** ativa `/painel/agenda`, porque o prefixo é por segmento.

### 3.5 Componentes de formulário e estado (`src/components/ui/`)
Todos repassam os atributos nativos restantes e aceitam `ref` como prop (React 19). Os textos padrão ficam em pt-BR, como props com valor padrão. Ícones, se houver, são SVG inline com `aria-hidden="true"` e texto ao lado. `'use client'` só onde há hook ou manipulador interno (indicado abaixo).

```ts
// Button.tsx ('use client')
type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  type?: 'button' | 'submit' | 'reset';                 // padrão 'button'
  variante?: 'primaria' | 'secundaria' | 'perigo' | 'discreta';   // padrão 'primaria'
  ocupado?: boolean;            // → disabled + aria-busy="true" + rotuloOcupado
  rotuloOcupado?: string;       // padrão 'Aguarde…'
  desabilitadoFocavel?: boolean;// D-10: aria-disabled="true", continua focável; clique/submit bloqueados (preventDefault, sem onClick)
  ref?: Ref<HTMLButtonElement>;
};
```
- Altura e largura mínimas de `--alvo-minimo`. O estado desabilitado tem opacidade **e** cursor `not-allowed`, e o `aria-disabled` tem borda tracejada (não depende só da cor). Um ícone sem texto exige `aria-label` (garantido pelo tipo: `children` ou `aria-label` obrigatório numa sobrecarga simples, ou por teste).

```ts
// campo.ts — auxiliar comum de Field/Select/Checkbox (puro)
export function idsDoCampo(base: string): { controle: string; ajuda: string; erro: string };
export function descritoPor(ids, temAjuda: boolean, temErro: boolean): string | undefined;   // 'ajuda erro' na ordem

// Field.tsx ('use client', useId)
type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> & {
  rotulo: string;
  tipo?: 'text' | 'email' | 'password' | 'tel' | 'number' | 'date';   // padrão 'text'
  ajuda?: ReactNode; erro?: string; obrigatorio?: boolean;
  textoObrigatorio?: string;    // padrão 'obrigatório' → rótulo "Nome (obrigatório)"
  ref?: Ref<HTMLInputElement>;
};
// Select.tsx ('use client')
type Opcao = { valor: string; rotulo: string; desabilitada?: boolean };
type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  rotulo: string; opcoes: readonly Opcao[]; textoVazio?: string;   // 1ª opção value="" quando informado
  ajuda?: ReactNode; erro?: string; obrigatorio?: boolean; ref?: Ref<HTMLSelectElement>;
};
// Checkbox.tsx ('use client')
type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  rotulo: ReactNode;            // pode conter links (/termos, /privacidade — E4.3)
  ajuda?: ReactNode; erro?: string; obrigatorio?: boolean; ref?: Ref<HTMLInputElement>;
};
```
- Regras comuns:
  - o `<label htmlFor>` fica associado;
  - `aria-describedby` usa `descritoPor`;
  - com `erro`, o controle recebe `aria-invalid="true"`, e o texto do erro aparece com o prefixo visível "Erro:" (em `--cor-erro-texto`) e o ícone `aria-hidden`;
  - obrigatório significa `required` + o texto no rótulo;
  - `id` é aceito e, se ausente, vem de `useId`.
- `Checkbox`: o input nativo fica visível (com `accent-color: var(--cor-primaria)`, 1,25 rem) e o `label` envolve a linha inteira (o rótulo todo é clicável) com `min-height: --alvo-minimo`.

```ts
// Alert.tsx (servidor ou cliente; sem hooks)
type AlertProps = { variante: 'info' | 'sucesso' | 'aviso' | 'erro'; titulo?: string; children: ReactNode;
                    rotulosVariante?: Partial<Record<…, string>> };  // padrão: 'Informação', 'Sucesso', 'Atenção', 'Erro'
```
- `erro` usa `role="alert"` e as demais variantes, `role="status"`. O rótulo da variante é texto visível no início ("Atenção:"), em negrito, além da cor de fundo e da borda esquerda.

```ts
// EmptyState.tsx (sem hooks)
type EmptyStateProps = { titulo: string; descricao?: ReactNode; acao?: ReactNode; nivelTitulo?: 2 | 3 };   // padrão h2
// ErrorState.tsx ('use client')
type ErrorStateProps = { titulo: string; descricao?: ReactNode; onTentarNovamente?: () => void;
                         rotuloTentarNovamente?: string /* 'Tentar novamente' */; saida?: ReactNode; nivelTitulo?: 2 | 3 };
```
- `ErrorState` usa `role="alert"` no contêiner (anunciado quando aparece). Nenhum dos dois recebe `Error`, só texto, o que impede vazar *stack* ou código interno por construção.

### 3.6 `ConfirmDialog` (`'use client'`)
```ts
type ConfirmDialogProps = {
  aberto: boolean;                              // controlado pelo pai
  titulo: string;
  descricao: ReactNode;
  rotuloConfirmar: string;
  variante?: 'primaria' | 'perigo';             // padrão 'primaria' (botão confirmar)
  rotuloCancelar?: string;                      // 'Cancelar'
  rotuloOcupado?: string;                       // 'Aguarde…'
  mensagemErro?: string;                        // 'Não foi possível concluir. Tente novamente.'
  onConfirmar: () => void | Promise<void>;      // a ação
  onCancelar?: () => void;                      // aviso de cancelamento (Cancelar ou Esc)
  onFechar: () => void;                         // pedido de fechamento: o pai põe aberto=false
};
```
Comportamento (RN-10, D-12):
- **Abrir** (`aberto` passa a `true`):
  - guarda `document.activeElement` como origem e zera o estado de erro e de ocupado;
  - chama `dialogRef.current.showModal()` e foca **Cancelar**;
  - marcação: `<dialog aria-labelledby={idTitulo} aria-describedby={idDescricao} tabIndex={-1}>` com `h2` (serifado), a descrição, a área de erro e os botões na ordem DOM **Cancelar, Confirmar**.
- **Trava de foco** (`onKeyDown` no `dialog`):
  - Tab no último focável → foca o primeiro; Shift+Tab no primeiro (ou no próprio `dialog`) → foca o último; os dois com `preventDefault`;
  - sem focáveis (ocupado), `preventDefault` e o foco fica no `dialog`;
  - "focáveis" = `button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])` dentro do diálogo.
- **Esc** (`onKeyDown`, `key === 'Escape'`): **sempre** `preventDefault()` (o *close watcher* não fecha sozinho, §0). Se não estiver ocupado, segue o caminho de cancelar. O `onCancel` nativo também faz `preventDefault` (redundância).
- **Cancelar** (botão ou Esc): `onCancelar?.()` e depois `onFechar()`, uma vez.
- **Confirmar:**
  - uma *ref* `emAndamento` barra a 2ª chamada (duplo clique ou Enter repetido) enquanto a 1ª não terminou;
  - `r = onConfirmar()`. Se `r` não for *thenable*: `onFechar()`;
  - se for: `ocupado = true`, os dois botões ficam `disabled`, o confirmar mostra `rotuloOcupado` com `aria-busy`, o foco vai para o próprio `dialog` (`tabIndex=-1`, para não cair no `body` quando o botão focado fica desabilitado) e o Esc é ignorado;
  - resolvida: `onFechar()`. Rejeitada: `ocupado = false`, a mensagem fica num `<p role="alert">` dentro do diálogo, o foco volta ao confirmar e uma nova tentativa é permitida.
  - O erro original **não** é exibido.
- **Fechar** (`aberto` passa a `false`): `dialog.close()` se estiver aberto, e o foco volta à origem se ela ainda estiver no documento (`isConnected`), não estiver desabilitada e for focável. Senão, vai para `document.querySelector('main')` (que tem `tabIndex=-1` nos layouts) e, por último, para o `body`.
- **Fundo (backdrop):** sem manipulador de clique. O `<dialog>` modal não fecha por clique fora (D-12).
- **`close` nativo inesperado** (o navegador fechou com `aberto` ainda `true`): fora do estado ocupado, é tratado como cancelamento; ocupado, chama `showModal()` de novo. É uma defesa, coberta por teste unitário.
- **Dublê de teste** (`tests/support/dialogo.ts`): `instalarDialogoFalso()` define `HTMLDialogElement.prototype.showModal` (põe `open = true`) e `close` (põe `open = false` e dispara `close`), e devolve `restaurar()`. Os testes o chamam em `beforeEach`/`afterEach`. No jsdom, a inércia do fundo não existe: ela é comprovada no E2E (CA-4, passo 6).

### 3.7 `SlotGrid` (`'use client'`)
```ts
type SlotGridProps = {
  instantes: readonly Date[];            // inícios disponíveis (UTC), já calculados (E3.1)
  fuso?: string;                         // padrão FUSO_PADRAO
  rotuloGrupo: string;                   // legend, ex.: 'Horários de terça-feira, 10/03/2026'
  selecionado?: Date | null;             // controlado (com onSelecionar)
  selecionadoInicial?: Date | null;      // não controlado
  onSelecionar?: (instante: Date) => void;
  name?: string;                         // padrão useId()
  vazio?: ReactNode;                     // padrão <EmptyState titulo="Nenhum horário disponível nesta data." />
  disabled?: boolean;
};
```
- **Processamento:**
  - deduplica por `getTime()`, ordena de forma crescente e calcula `formatarHora(i, fuso)`;
  - os rótulos que se repetem recebem o sufixo `` ` (${formatarDeslocamentoUtc(i, fuso)})` `` em **todos** os instantes do grupo repetido (ex.: `23:00 (UTC−02:00)` e `23:00 (UTC−03:00)`);
  - o `value` de cada rádio é `instante.toISOString()`, que é a identidade;
  - `onSelecionar` recebe um `Date` novo, criado a partir do ISO;
  - um `Date` inválido em `instantes` faz `formatarHora` lançar `RangeError` (erro de programação do consumidor; não é filtrado em silêncio).
- **Marcação:**
  ```
  <fieldset><legend>{rotuloGrupo}</legend>
    <div class=grade>
      <label class=horario><input type=radio class=controle name value checked onChange/><span class=texto>10:00</span></label>…
  ```
- **Estilo** (D-21, ajuste):
  - o próprio `input` é a caixa visível: `appearance: none; position: absolute; inset: 0; margin: 0; border: 1px solid var(--cor-borda-controle); border-radius: var(--raio); background: var(--cor-superficie)`;
  - o `span` fica por cima, com `pointer-events: none`, e o `label` com `position: relative; min-width/min-height: var(--alvo-minimo)`;
  - **por isso o elemento focado (o `input`) recebe o contorno do `:focus-visible` e tem 44 × 44 px**, que é o que o CA-14 mede;
  - marcado: fundo `--cor-primaria`, borda de 3 px (forma, não só cor), e o texto em `--cor-sobre-primaria` com peso 600;
  - grade: `display: grid; grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr)); gap: var(--espaco-2)`, sem rolagem horizontal em 320 px. Com o sufixo de deslocamento, o rótulo quebra a linha dentro da célula.
- **Teclado:** nativo (uma parada de Tab no grupo, setas mudam e marcam, Espaço marca).

### 3.8 `DataList` (sem hooks)
```ts
type Coluna<T> = { chave: string; rotulo: string; renderizar: (linha: T) => ReactNode };
type DataListProps<T> = {
  legenda: string; legendaVisivel?: boolean;      // <caption>, visualmente oculta se false (sempre nome acessível)
  colunas: readonly Coluna<T>[];
  linhas: readonly T[];
  chaveDaLinha: (linha: T) => string;
  vazio?: ReactNode;                              // padrão <EmptyState titulo="Nada por aqui ainda." />
};
```
- Marcação: `<table>` com `<caption>`, `<thead>` com `<th scope="col">` e `<tbody>`. Cada `<td>` começa com `<span class=rotuloCelula aria-hidden="true">{rotulo}</span>` (D-20, ajuste: um elemento e não `::before`/`attr()`, porque o conteúdo gerado entra no nome acessível da célula no Chromium).
- Abaixo de 48 rem:
  - `thead` com `.visualmente-oculto` (continua na árvore de acessibilidade);
  - `tr` com `display: block` e borda de cartão;
  - `td` com `display: grid; grid-template-columns: minmax(6rem, 35%) 1fr`;
  - `.rotuloCelula` visível.
- A partir de 48 rem: a tabela comum, com `.rotuloCelula { display: none }`.
- Todo o conteúdo usa `overflow-wrap: anywhere`. Sem linhas, renderiza só `vazio` (sem `table`).

### 3.9 Layouts (`src/components/layout/`)
```ts
// Estrutura.tsx (sem hooks): esqueleto comum
type EstruturaProps = { rotuloNav: string; marca: ReactNode; complementoCabecalho?: ReactNode;
  navegacao?: ReactNode; rodape?: ReactNode; children: ReactNode; variante: 'publico' | 'painel' };
//  <a class=pular href="#conteudo">Pular para o conteúdo</a>
//  <header>{marca}{complementoCabecalho}</header>
//  {navegacao}
//  <main id="conteudo" tabIndex={-1}>{children}</main>
//  {rodape && <footer>{rodape}</footer>}
export const ID_CONTEUDO = 'conteudo';

// PublicLayout.tsx (sem hooks)
type PublicLayoutProps =
  | { variante?: 'plataforma'; children: ReactNode }
  | { variante: 'salao'; nomeSalao: string; children: ReactNode };
//  plataforma: marca = link para ROTAS.inicio; nav aria-label="Acesso" com 'Entrar' (ROTAS.entrar) e 'Criar conta' (ROTAS.cadastro)
//  salao: marca + nome do salão (h-p, não link de equipe); sem nav de acesso
//  rodapé (as duas): nav aria-label="Informações legais" com 'Termos de Uso' e 'Política de Privacidade'
//  RN-13: sem menu móvel; os dois links quebram linha (flex-wrap) e cabem em 320 px

// PanelLayout.tsx (sem hooks)
type PanelLayoutProps = { papel: PapelDeSalao; nomeSalao: string; caminhoAtual?: string;
  areaUsuario?: ReactNode; children: ReactNode };
//  itens = itensDoPainel(papel); <MenuNavegacao itens rotulo="Navegação do painel" caminhoAtual />

// AdminLayout.tsx (sem hooks)
type AdminLayoutProps = { caminhoAtual?: string; areaUsuario?: ReactNode; children: ReactNode;
  rotuloArea?: string /* 'Administração da plataforma' */ };
//  itens = NAVEGACAO_ADMIN; <MenuNavegacao itens rotulo="Navegação da administração" … />

// MenuNavegacao.tsx ('use client')
type MenuNavegacaoProps = { itens: readonly ItemNavegacao[]; rotulo: string; caminhoAtual?: string;
  rotuloBotao?: string /* 'Menu' */ };
```
- **Marcos:** um `banner`, uma `navigation` com nome próprio por `nav`, um `main` e um `contentinfo` (público). O painel e o admin não têm rodapé. O link de pular é o 1º focável: oculto acima da página com `transform` e visível em `:focus` (sem causar rolagem horizontal).
- **`MenuNavegacao`:**
  - `<button type="button" class=botaoMenu aria-expanded aria-controls={idNav}>Menu</button>`, seguido de `<nav id={idNav} aria-label={rotulo} data-aberto>` com `<ul>` de `<a href>`;
  - CSS abaixo de 48 rem: `.nav[data-aberto="false"] { display: none }` (fechado não recebe foco), e o menu aberto aparece sob o cabeçalho, em coluna, com itens de `min-height: --alvo-minimo`;
  - a partir de 48 rem: `.botaoMenu { display: none }` e `.nav { display: block }` como barra lateral de `--largura-lateral` (grid de duas colunas no painel e no admin);
  - abrir (Enter/Espaço nativos no `button`): `aberto = true` e, depois da renderização, foca o 1º link;
  - fechar: o botão de novo (o foco já está nele); Esc dentro da `nav` (`onKeyDown`) fecha e foca o botão; clicar ou acionar um item fecha sem mover o foco (a navegação segue). Uma mudança do caminho (`usePathname`) também fecha;
  - não prende o foco: o Tab depois do último item segue para o `main`, e o menu continua aberto;
  - item ativo: `href === itemAtivo(itens, caminhoAtual ?? usePathname())` → `aria-current="page"`, mais um indicador **não cromático** (barra lateral de 4 px e peso 600).
- **Área do usuário (D-6):** `areaUsuario` é renderizado no `header`, vazio por padrão. Nenhum layout lê cookie, sessão nem ambiente.
- A marca vem de `siteConfig.name`. O nome do salão quebra linha (`overflow-wrap: anywhere`).

### 3.10 Vitrine e habilitação
**Ambiente (`src/server/env.ts`)**:
- `esquemaEnv` ganha `VITRINE_COMPONENTES: z.enum(['true', 'false']).default('false')`. Assim, ele entra em `chavesDeclaradas()` (teste de paridade com o `.env.example`), e `validarEnv`/`check-env` recusam `TRUE`, `1` e `sim` na inicialização (falha cedo, como `QUEUE_RETRY_BACKOFF`). O `Env` **não** ganha campo novo.
- Função nova:
  ```ts
  /** D-1: só o texto exato 'true' habilita; NODE_ENV=development habilita sem a variável. Não valida o resto do ambiente. */
  export function vitrineHabilitada(fonte: Record<string, string | undefined>): boolean;
  ```
- `.env.example`: `VITRINE_COMPONENTES=false`, com o comentário "Vitrine /dev/componentes (true | false; padrão false). Só para o E2E e o desenvolvimento local; nunca true em produção. Com next dev ela já fica ligada."

**Página** (`src/app/dev/componentes/page.tsx`, servidor):
```ts
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Vitrine de componentes · Agenda Beleza', robots: { index: false, follow: false } };
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
export default async function VitrineDeComponentes({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();     // antes de ler qualquer parâmetro
  const opcoes = lerOpcoesVitrine(await searchParams);
  // escolhe PublicLayout (plataforma | salao 'Salão Exemplo'), PanelLayout (papel, 'Salão Exemplo', caminho) ou AdminLayout(caminho)
  return <Layout …><Vitrine /></Layout>;
}
```
- `opcoes.ts`:
  ```ts
  export type OpcoesVitrine = { layout: 'publico' | 'publico-salao' | 'painel' | 'admin'; papel: PapelDeSalao; caminho?: string };
  /** Desconhecido/ausente/repetido (array) → padrão ('publico', 'gestor', sem caminho). */
  export function lerOpcoesVitrine(busca: Record<string, string | string[] | undefined>): OpcoesVitrine;
  ```
  O `caminho` só é aceito se casar com `^/[a-z0-9/-]{0,120}$`. Ele só alimenta o `aria-current`, nunca vira link nem texto.
- `Vitrine.tsx` (`'use client'`): `h1` "Vitrine de componentes" e seções com `h2`.
  - **Botões:** as 4 variantes, desabilitado, ocupado e `desabilitadoFocavel`.
  - **Campos:** texto, e-mail com ajuda, telefone (`inputMode="tel"`), senha, número, data (`type="date"`), um obrigatório e **"E-mail de contato" com erro** "Informe um e-mail válido.".
  - **Seleção:** `Select` normal e com erro.
  - **Caixas de seleção:** comum e de consentimento com links para `ROTAS.termos`/`ROTAS.privacidade`.
  - **Alertas:** as 4 variantes.
  - **Estados:** `EmptyState` com ação e `ErrorState` com "Tentar novamente" (contador visível).
  - **Lista de dados:** serviços fictícios ("Corte e escova", "Coloração com mechas e tratamento de reconstrução capilar completa", com e-mail longo `contato.muito.longo.para.testar.quebra@exemplo.com.br`), duração e preço por `formatarMoeda`, e mais um `DataList` vazio.
  - **Grade de horários:**
    - "Horários de terça-feira, 10/03/2026": 09:00–11:30 de 30 em 30 min, em `America/Sao_Paulo`, criados de ISO fixo;
    - "Horários de sábado, 16/02/2019": `2019-02-17T01:00Z` e `02:00Z`, com o rótulo repetido;
    - uma grade vazia.
  - **Diálogos:**
    - botões "Abrir confirmação" (primária, confirmar "Confirmar"), "Abrir confirmação de perigo" (perigo, "Excluir"), "Abrir confirmação demorada" (Promise de 1,5 s) e "Abrir confirmação que falha" (Promise rejeitada);
    - contadores visíveis "Confirmações: N" e "Cancelamentos: N", com `data-testid="contador-confirmado"`/`"contador-cancelado"`.
  - Dados fictícios, sem nomes de pessoas.
- A vitrine não importa nada de `@/server` além de `vitrineHabilitada` (na página) e do `import type` de `PapelDeSalao`. Ela não acessa banco, sessão, adaptadores nem rede.

### 3.11 E2E (`e2e/a11y-base.spec.ts`) e configuração
- `playwright.config.ts`: `webServer.env = { VITRINE_COMPONENTES: 'true' }` (comentário: CA-18). Nada mais muda.
- `e2e/suporte/vitrine.ts` (não é coletado, porque o `testMatch` é `**/*.spec.ts`):
  - `abrirVitrine(page, busca)`: `page.goto('/dev/componentes?…')`. Se o status for diferente de 200, lança `Error('A vitrine respondeu <status>: ligue VITRINE_COMPONENTES=true no servidor ou libere a porta 3000 (reuseExistingServer).')`. Depois espera `document.fonts.ready`;
  - `semRolagemHorizontal(page)`;
  - `analisarComAxe(page, contexto)`: `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()`, que espera `violations` igual a `[]` e mostra `id`, `nodes[].target` e o contexto na falha;
  - `percorrerComTab(page, limite)`: coleta `{ seletor, outlineStyle, outlineWidth }` de cada `activeElement` até voltar ao início ou atingir o limite.
- `test.describe.configure({ mode: 'parallel' })`: os testes do arquivo rodam em paralelo nos workers do Playwright.
- Variantes: `publico`, `publico-salao`, `painel&papel=gestor`, `painel&papel=profissional` e `admin`.
- Conjunto de "interativos esperados" do CA-14: `a[href], button:not(:disabled), input:not(:disabled):not([type=radio]), select:not(:disabled), [tabindex="0"]` visíveis, mais **um** por grupo de rádios (o grupo é uma parada de Tab), excluindo o conteúdo de `dialog` fechado e da `nav` recolhida.

### 3.12 Varreduras (testes unitários que leem arquivos)
- **CA-10** (`src/lib/format.fonte-unica.test.ts`), em `src/**/*.{ts,tsx}`, excluindo `src/lib/format.ts`, `**/*.test.*` e `src/generated/**`:
  - em todo o `src/`: nenhum `toLocaleString`, `toLocaleDateString` ou `toLocaleTimeString`, e nenhum `Intl.NumberFormat`;
  - em `src/app/**`, `src/components/**`, `src/lib/**` e `src/config/**` (camadas de exibição): nenhum `Intl.DateTimeFormat`. **Ajuste da D-8:** `src/server/**` pode usar `Intl.DateTimeFormat` para *cálculo* (a E3.1 vai precisar disso para converter jornadas no fuso), não para exibição;
  - mais a asserção de que `src/app/dev/mp-checkout/page.tsx` contém `formatarMoeda(dados.valorCentavos)` e não contém `/ 100`.
- **CA-20 e afins** (`src/components/conformidade.test.ts`), em `src/components/**` e `src/app/dev/componentes/**` (`.ts`, `.tsx`, `.css`; testes excluídos):
  - nenhum `#[0-9a-fA-F]{3,8}\b` em contexto de cor, nenhum `\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(` e nenhum dos 148 nomes de cor CSS (lista no teste) como valor de propriedade (`:\s*<nome>\b`). Permitidos: `transparent`, `currentColor`, `inherit` e `var(--…)`;
  - em todo `src/**/*.css`: toda `@media` com largura é exatamente `(min-width: 48rem)`, e não há `outline:\s*(none|0)`;
  - `globals.css`: os literais de cor só aparecem dentro de `:root`;
  - nenhum `dangerouslySetInnerHTML` (RN-24);
  - nenhum import de `@/server/` que não seja `import type` (RN-24);
  - nenhum `tabIndex={n}` com n > 0 (RN-8).

## 4. Dados (DBA: **dispensado**)

Motivo: a demanda não cria nem altera tabela, coluna, índice, constraint, migração, consulta ou repositório (RN-24). O único contato com dados é **textual**: o teste da D-14 lê `prisma/schema.prisma` para comparar o `@default("America/Sao_Paulo")` de `salao.fuso` com `FUSO_PADRAO`, sem conexão. O harness de integração não muda, e nenhum teste novo é de integração. Se uma revisão passar a exigir persistência (por exemplo, guardar preferência de tema), o DBA volta a ser acionado.

## 5. Infraestrutura (DevOps: **dispensado**)

Motivo, item a item do que o analista marcou como "revisão leve":
1. **`playwright.config.ts` (`webServer.env`):** é configuração de teste, sem mudança de comando nem de job. O desenvolvedor a altera no T-4, e o CA-18 E2E prova que vale. A CI continua com `npm run test:e2e`.
2. **Variável da vitrine em `env.ts`/`.env.example`:** é código de aplicação (padrão da D-007/D-008). O compose lê o `.env` (`false`) pelo `env_file`, e a imagem não traz `.env` (`.dockerignore`). **Nenhum arquivo de infraestrutura muda.** A prova de processo (`docker compose up` + `curl` → 404) é do tester (CA-18, T-12).
3. **Rede no build:** com `next/font/local` (D-2), o build não acessa servidor de fontes (§0). `Dockerfile`, `.dockerignore` (não exclui `src/` nem `.woff2`) e os jobs `build`/`docker` ficam como estão. A conferência do job `docker` verde no PR entra nos gates do T-11.
4. **Tempo do job `e2e`:** estimado em +60 a 120 s (cerca de 15 análises do axe, varredura por Tab em 5 variantes e 3 larguras), com paralelismo dentro do arquivo, longe do `timeout-minutes: 20`. O T-11 registra o tempo medido do job no `dev.md`. **Gatilho para acionar o DevOps:** o job `e2e` passar de 10 min ou precisar de mudança no workflow (por exemplo, *sharding* ou artefato novo).
5. **`@axe-core/playwright`/`axe-core` em `devDependencies`:** são removidos pelo `npm prune --omit=dev` (`Dockerfile:19`) e não têm script de instalação (sem `allowScripts`).
6. **Observabilidade:** não se aplica.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como foi atendida |
|---|---|---|
| Escopo por salão no servidor | Indiretamente | Nenhum componente consulta dados. O nome do salão e o papel chegam por prop (vindos, na E1.2, do contexto de tenant). A navegação por papel é só interface (RN-12) e não substitui a autorização do servidor. A varredura proíbe import de `@/server` em tempo de execução nos componentes. |
| Exclusion constraint anti-sobreposição | Não | Nenhuma escrita em `reserva`. A `SlotGrid` só mostra instantes recebidos e não decide disponibilidade. |
| UTC + fuso do salão | **Sim** | Os formatadores recebem `Date` (UTC) e o fuso IANA do salão, sem depender do `TZ` do processo (CA-9, com autoverificação). O `FUSO_PADRAO` é igual ao padrão do schema (D-14). O horário de verão histórico é coberto (CA-8). A `SlotGrid` identifica cada horário pelo instante ISO e desambigua rótulos repetidos pelo deslocamento. O resultado é igual no servidor e no navegador (sem divergência de hidratação). |
| Adaptadores de integração | Não | Nada toca integrações. O `mp-checkout` só troca o formatador. |
| Soft delete / anonimização | Indiretamente | O `ConfirmDialog` de perigo serve à E5.2. O texto "cliente removida" é do consumidor. O `DataList` não infere nada. |
| Salão suspenso somente leitura | Indiretamente | `Button` com `desabilitadoFocavel` (D-10) e `Alert` para o aviso da E6.4. Os layouts não mudam a navegação por estado da assinatura. |
| Idempotência de webhooks e mensagens | Não (análogo na UI) | Na UI, o `ConfirmDialog` chama `onConfirmar` uma vez por tentativa (duplo clique e Enter repetido barrados), o que complementa a idempotência do servidor sem substituí-la. |
| Auditoria do super admin | Não | O `AdminLayout` é só estrutura. As ações auditadas são da E8.x. |

## 7. Riscos e decisões

### 7.1 Decisões D-1..D-25 da spec
| Decisão | Veredito | Justificativa / ajuste |
|---|---|---|
| D-1 (vitrine por variável) | **Confirmada, com ajuste** | Nome `VITRINE_COMPONENTES`. A página usa `vitrineHabilitada(process.env)`: só `'true'` exato ou `NODE_ENV=development`. **Ajuste:** a chave entra no `esquemaEnv` como `enum('true','false')`, então um valor como `TRUE` também faz o `check-env` falhar na inicialização da imagem (falha cedo). A página continua respondendo 404 para esses valores (CA-18). Comprovado por sonda (§0). |
| D-2 (fontes locais) | **Confirmada** | `next/font/local` com **Fraunces** (títulos) e **Source Sans 3** (corpo), OFL 1.1, extraídas dos tarballs do Fontsource por `npm pack` e versionadas em `src/app/_fontes/` com as licenças e o sha256 (§1.3). A pasta usa o prefixo `_` (privada no App Router). |
| D-3 (48 rem) | **Confirmada** | Mobile-first, só `@media (min-width: 48rem)`, com conferência por varredura. |
| D-4 (data nativa) | **Confirmada** | `Field tipo="date"`. |
| D-5 (caminho atual) | **Confirmada** | Prop `caminhoAtual?`, com `usePathname()` como padrão. No jsdom ele devolve `null` (nenhum item ativo), comprovado por sonda. A vitrine injeta pelo parâmetro `?caminho=` validado. |
| D-6 (slot do usuário, variantes) | **Confirmada** | Prop `areaUsuario?: ReactNode`. `PublicLayout` é uma união discriminada (`variante: 'salao'` exige `nomeSalao`). |
| D-7 (links para rotas futuras) | **Confirmada** | |
| D-8 (varreduras por teste) | **Confirmada, com ajuste** | O `Intl.DateTimeFormat` só é proibido nas camadas de exibição (`src/app`, `src/components`, `src/lib`, `src/config`). `src/server/**` pode usá-lo para cálculo (E3.1). As varreduras também cobrem o ponto de quebra único, `outline: none`, `dangerouslySetInnerHTML`, import de `@/server` e `tabIndex` positivo (§3.12). |
| D-9 (sem rosa) | **Confirmada** | A faixa não muda. A paleta escolhida tem matizes de 8° a 188° (§3.1). |
| D-10 (desabilitado focável) | **Confirmada** | Prop `desabilitadoFocavel` no `Button`. |
| D-11 (estilo do mp-checkout) | **Confirmada: não migrar** | A página imita o checkout do provedor, não usa os layouts e fica fora do CA-20. Só troca o formatador. |
| D-12 (foco inicial, backdrop) | **Confirmada, com ajuste técnico** | O Esc é tratado no `keydown` com `preventDefault`, e não no evento `cancel` (o *close watcher* do Chromium fecha mesmo com `cancel` cancelado, §0). Há também a defesa do `close` inesperado (§3.6). |
| D-13 (negativo recusado) | **Confirmada** | |
| D-14 (`FUSO_PADRAO`) | **Confirmada** | Fica em `src/lib/format.ts`, com o teste que lê o `schema.prisma`. |
| D-15 (só `Date`) | **Confirmada** | Uma entrada que não é `Date` lança `TypeError`. |
| D-16 (tipo do papel) | **Confirmada: `import type`** | `NAVEGACAO_PAINEL` usa `satisfies Record<PapelDeSalao, …>` (exaustivo em compilação). O teste compara as chaves com `PAPEIS_DE_SALAO` (importado só no teste, porque o valor puxaria `@/server/repos/ids` para o bundle do cliente). |
| D-17 (JS obrigatório) | **Confirmada** | |
| D-18 (ordem do gestor) | **Confirmada** | |
| D-19 (parâmetros de busca) | **Confirmada** | `?layout=publico\|publico-salao\|painel\|admin&papel=gestor\|profissional&caminho=/…`. |
| D-20 (`DataList` empilhado) | **Confirmada, com ajuste** | O rótulo da coluna no celular é um `span aria-hidden` dentro do `td`, não `::before` com `attr()`. Motivo: o conteúdo gerado entra no nome acessível da célula. |
| D-21 (rádios, deslocamento) | **Confirmada, com ajuste** | Sinal **U+2212** (coberto pelo subconjunto das fontes) e formato `23:00 (UTC−02:00)`. **Ajuste:** o `input` com `appearance: none` é a própria caixa visível de 44 × 44 px (o rádio não fica escondido), para o foco visível e a área de toque ficarem no elemento focado (CA-14). Auxiliar `formatarDeslocamentoUtc` em `format.ts`. |
| D-22 (axe) | **Confirmada, com acréscimo** | Etiquetas `wcag2a/wcag2aa/wcag21a/wcag21aa`, zero violações, sem `best-practice`. Acréscimo: `axe-core@4.14.0` fixado diretamente (§1.2). |
| D-23 (outro `TZ`) | **Alterada** | No próprio processo do Vitest: para `UTC`, `America/Fortaleza` e `Asia/Tokyo`, `vi.stubEnv('TZ', …)` roda os casos do CA-2 e do CA-8, **com autoverificação** de que o ambiente mudou (`new Date('2026-03-10T13:00:00Z').getTimezoneOffset()` = 0 / 180 / −540) e `vi.unstubAllEnvs()` no `afterEach`. Assim, a CI cobre o caso sem processo filho (que exigiria executar TS fora do Vitest). Comprovado por sonda (§0). O tester também roda `TZ=Asia/Tokyo npx vitest run src/lib/format.test.ts` uma vez como evidência. |
| D-24 (`user-event`) | **Rejeitada** | A trava de foco e o Esc são lógica nossa no `keydown`, exercitada com `fireEvent.keyDown` (com o dublê). Setas em rádios, Tab real e inércia são comportamento do navegador e já ficam no E2E. O pacote teve 6 versões em 10 dias (§0). Sem dependência nova. |
| D-25 (sem biblioteca de estilo) | **Confirmada** | CSS global + CSS Modules. |

### 7.2 Riscos
| ID | Risco | Mitigação |
|---|---|---|
| R-1 | O *close watcher* do Chromium fecha o `<dialog>` com Esc mesmo quando o `cancel` é cancelado, o que quebraria "Esc ignorado durante a confirmação" e desincronizaria `aberto`. | Esc tratado no `keydown` com `preventDefault` (comprovado na sonda) e defesa do `close` inesperado (§3.6). E2E: na "confirmação demorada", 3 Esc durante a espera mantêm o diálogo aberto e, ao resolver, "Confirmações" sobe 1. |
| R-2 | Sem trava própria, o Tab sai do modal para a interface do navegador (§0). | Ciclo explícito (§3.6). CA-4 E2E, passo 2, com duas voltas em cada sentido. |
| R-3 | `next/font/local` não funciona fora do compilador do Next, então o teste do layout quebraria. | `vi.mock('next/font/local')` nos dois testes que importam `fontes.ts` (§3.2). |
| R-4 | O Safari remove a semântica de tabela quando `tr`/`td` mudam de `display`. | Chromium e Firefox preservam, e o E2E é só Chromium. Na v1, o `DataList` é usado no painel (equipe), não na página pública. Fica registrado como limitação conhecida no README. Uma demanda futura pode pôr `role` explícitos. |
| R-5 | Uma versão nova do axe-core reprova o gate sem mudança de código. | `axe-core` e o integrador com versão exata, e o teste do CA-15 confere `package.json` e lock (cópia única). |
| R-6 | E2E lento ou instável (fontes, animações, paralelismo). | `document.fonts.ready` antes de medir. `reducedMotion: 'reduce'` só nos testes de medida, com um teste dedicado do RN-7. Paralelismo dentro do arquivo. Esperas por asserção (`expect.poll`/`toHaveAttribute`), nunca por tempo fixo, salvo a promessa de 1,5 s da vitrine. |
| R-7 | Um slug de salão igual a uma rota ("painel", "admin") faria a página pública nunca abrir. | `SEGMENTOS_RESERVADOS` exportado e testado contra as pastas de `src/app` (CA-12). A recusa ou sufixo fica com a E1.1/E2.5 (registrar na transferência dessas demandas). |
| R-8 | Divergência de hidratação por ICU ou `TZ` diferentes entre servidor e navegador. | A moeda não usa `Intl`. Data e hora são montadas por partes, com fuso explícito e `numberingSystem: 'latn'`. A `SlotGrid` recebe o fuso por prop. |
| R-9 | Origem ou licença das fontes não rastreáveis. | Licenças OFL ao lado dos arquivos, sha256 conferido em `fontes.test.ts` e o procedimento de extração no README (seção nova). |
| R-10 | `reuseExistingServer` local com um `next start` sem a variável (404). | Mensagem explícita do `abrirVitrine` (CA-18). Com `next dev`, a vitrine responde (D-1). |
| R-11 | O foco cai no `body` quando o botão focado fica `disabled` (confirmação assíncrona). | O foco vai para o `dialog` (`tabIndex=-1`) durante a espera e volta ao confirmar na rejeição. Há teste unitário do `activeElement`. |
| R-12 | "Sem rosa genérico" e "elegante e quente" são subjetivos. | Critério objetivo de matiz (CA-13) e revisão visual da vitrine pelo tester (320, 375 e 1280 px), registrada com capturas no `testes.md`. |
| R-13 | A varredura do CA-10 bloquear o cálculo de fuso da E3.1. | Escopo por camada (D-8 ajustada). A E3.1 usa `Intl.DateTimeFormat` em `src/server/**`. |
| R-14 | Cobertura de componentes cliente e da vitrine. | Todo componente tem teste em jsdom. O teste da página renderiza as 5 variantes e aciona os demonstradores da `Vitrine.tsx` (contadores, "Tentar novamente", diálogos). CSS não entra na métrica. |
| R-15 | `VITRINE_COMPONENTES=1` (ou `TRUE`) no `.env` de alguém derruba o `check-env`. | É intencional (falha cedo, mensagem nomeia a variável). Fica documentado no `.env.example` e no README. |
| R-16 | Mudança visual nas páginas existentes (`/` e `/dev/mp-checkout`) por herdarem o tema. | `smoke.spec.ts` e `checkout.test.ts` continuam passando (CA-19, CA-10). O `mp-checkout` mantém os estilos inline. |

## 8. Estratégia de testes

Convenções: todo `*.test.tsx` começa com `/** @vitest-environment jsdom */`. Nenhum teste novo usa banco. O E2E roda no projeto `mobile-chromium` (375 × 812) e muda a largura com `page.setViewportSize` quando o CA pede.

| Arquivo | Tipo | CAs |
|---|---|---|
| `src/lib/format.test.ts` | Unitário | CA-1 (NBSP explícito e `!==` com U+0020), CA-2 (inclusive com o fuso omitido), CA-5, CA-6, CA-7, CA-8, CA-9 (D-23 com autoverificação; entradas inválidas; regex de formato), D-14 (lê `prisma/schema.prisma`), `formatarDeslocamentoUtc` (`UTC−02:00`/`UTC−03:00`/`UTC+00:00`/`Asia/Kolkata` `UTC+05:30`) |
| `src/lib/format.fonte-unica.test.ts` | Unitário (varredura) | CA-10 |
| `tests/integration/integracoes/checkout.test.ts` (existente, sem mudança) | Integração | CA-10: `R$ 79,00` continua no HTML do `mp-checkout` |
| `src/config/navegacao.test.ts` | Unitário | CA-11 (dados: 7/2/3 itens na ordem, `href` em `ROTAS` com prefixo `/painel/` ou `/admin/` e sem repetição, termos vetados em `href`/rótulo/chave sem acentos; `itensDoPainel` com `'super_admin'`, `'toString'`, `undefined` e `'x' as never` → `[]`; chaves = `PAPEIS_DE_SALAO`); CA-12 (`ROTAS.convite('a b/c')` → `/convite/a%20b%2Fc`, idem `jornada`, `salaoPublico`, `adminSalao`, `adminSalaoAssinatura`; `SEGMENTOS_RESERVADOS` recalculado a partir de `ROTAS` + `api` + `_next`, sem `[slug]`; cada pasta de `src/app` fora de `(…)`, `[…]` e `_…` pertence ao conjunto); RN-14 (`itemAtivo`: igual, prefixo por segmento, mais longo, `/painel/agendamento` não ativa, barra final, `null`) |
| `src/app/globals.test.ts` | Unitário (leitura de CSS) | CA-13 (extrai `:root`, todo `--cor-*` é `#rrggbb`, pares e limiares da §3.1 pela fórmula WCAG, matiz/saturação da D-9, nenhum literal de cor fora do `:root`); RN-6/RN-7 (tokens de espaçamento, `--alvo-minimo` = 2.75rem, `--foco-largura` ≥ 2px, `prefers-reduced-motion`, `color-scheme: light`) |
| `src/app/fontes.test.ts` | Unitário | RN-6 (opções do `localFont`: `display: 'swap'`, `variable` `--fonte-titulo`/`--fonte-corpo`, fallbacks; arquivos com assinatura `wOF2` e sha256 da §0; licença OFL 1.1 ao lado) |
| `src/app/layout.test.tsx` | Unitário | CA-19 (as duas classes `variable` no `<html>`, `lang`, `title` e `description` inalterados; testes atuais mantidos) |
| `src/server/env.test.ts` | Unitário | CA-18 (unitário de `vitrineHabilitada`: `production` + ausente, `''`, `false`, `1`, `TRUE` → false; `true` → true; `development` sem a variável → true; `test` sem a variável → false); paridade de chaves com o `.env.example` (`VITRINE_COMPONENTES=false`); `validarEnv` recusa `TRUE`/`1` nomeando a variável |
| `src/lib/dependencias-e2e.test.ts` | Unitário | CA-15 (versão): `@axe-core/playwright` e `axe-core` em `devDependencies` sem `^`/`~`; o lock tem `node_modules/@axe-core/playwright` 4.14.0, `node_modules/axe-core` 4.14.0 e nenhuma entrada `node_modules/@axe-core/playwright/node_modules/axe-core` |
| `src/components/ui/*.test.tsx` (8 + `campo.test.ts`) | Unitário (jsdom) | CA-17: `Button`, `Field`, `Select`, `Checkbox`, `Alert`, `EmptyState`, `ErrorState` e `DataList` como na spec, mais D-10 (`desabilitadoFocavel`: focável, `aria-disabled`, clique sem `onClick`, *submit* bloqueado) |
| `src/components/ui/ConfirmDialog.test.tsx` | Unitário (jsdom + `tests/support/dialogo.ts`) | CA-4 complementar e CA-17: foco inicial em Cancelar; Tab no último → primeiro; Shift+Tab no primeiro → último; Esc → `onCancelar` 1× + `onFechar` 1×, sem `onConfirmar`, com `defaultPrevented`; foco volta à origem e, sem origem, ao `main`; duplo clique → `onConfirmar` 1×; assíncrono: botões `disabled`, `aria-busy`, foco no `dialog`, Esc ignorado, resolve → `onFechar`; rejeita → aberto, `role="alert"` com a mensagem padrão (sem o texto do erro original), foco no confirmar, nova tentativa permitida; `close` inesperado → cancelamento |
| `src/components/ui/SlotGrid.test.tsx` | Unitário | CA-17 (ordem, `10:00`, deduplicação, `value` ISO, sufixo de deslocamento nos dois instantes do CA-8, callback com o `Date` certo, controlado e não controlado, vazio com o texto padrão, `legend`) |
| `src/components/layout/*.test.tsx` | Unitário | CA-17 (marcos, link de pular primeiro e apontando para `#conteudo`, `main` com `tabIndex=-1`, marca, variante de salão sem "Entrar"/"Criar conta", Termos/Privacidade); CA-11 (componente: profissional sem os 5 links; papel inválido → nenhum item, sem lançar); menu (`aria-expanded`, `aria-controls` = id da `nav`, abrir foca o 1º link, Esc fecha e devolve o foco, item fecha, `aria-current` com `caminhoAtual`) |
| `src/app/dev/componentes/*.test.ts(x)` | Unitário | CA-18 (página com `vi.stubEnv`: `production` sem a variável → rejeita com `digest` `NEXT_HTTP_ERROR_FALLBACK;404`; com `true` → renderiza; exporta `dynamic = 'force-dynamic'` e `robots`); `lerOpcoesVitrine` (padrões, desconhecidos, arrays, `caminho` inválido); renderização das 5 variantes e dos demonstradores |
| `src/components/conformidade.test.ts` | Unitário (varredura) | CA-20 e §3.12 |
| `e2e/a11y-base.spec.ts` | E2E | CA-3, CA-4 (passos 1 a 6, mais a confirmação demorada do R-1), CA-14 (+ texto a 200% em 1280 px e movimento reduzido), CA-15, CA-16, CA-18 (200 + `noindex`), CA-19 (família computada do `h1` = 1º nome de `--fonte-titulo`, e do `p` = 1º nome de `--fonte-corpo`) |
| `e2e/smoke.spec.ts` (existente) | E2E | CA-19 (sem regressão) |

- **Cobertura (CA-21):** todo arquivo novo de `src/` tem teste unitário que o executa. As partes que dependem de `showModal` rodam com o dublê. O `fontes.ts` roda com o `vi.mock` da macro. Nenhuma exclusão nova no `vitest.config.ts`. A meta prática por arquivo novo é ≥ 90% de linhas, para não diluir o gate global.
- **Execução repetida:** o T-10 roda `npx playwright test e2e/a11y-base.spec.ts --repeat-each=3` sem falha antes de entregar.

## 9. Tarefas

Todas as tarefas de implementação são do `desenvolvedor`, e podem ser feitas por uma só pessoa em sequência (T-1 → T-11). As rodadas abaixo mostram o que pode correr em paralelo sem arquivo em comum.

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | desenvolvedor | — | T-2, T-3, T-4 | `src/lib/format.ts`, `src/lib/format.test.ts`, `src/lib/format.fonte-unica.test.ts`, `src/app/dev/mp-checkout/page.tsx` |
| T-2 | desenvolvedor | — | T-1, T-3, T-4 | `src/config/navegacao.ts`, `src/config/navegacao.test.ts` |
| T-3 | desenvolvedor | — | T-1, T-2, T-4 | `src/app/globals.css`, `src/app/globals.test.ts`, `src/app/fontes.ts`, `src/app/fontes.test.ts`, `src/app/_fontes/**`, `src/app/layout.tsx`, `src/app/layout.test.tsx` |
| T-4 | desenvolvedor | — | T-1, T-2, T-3 | `package.json`, `package-lock.json`, `src/server/env.ts`, `src/server/env.test.ts`, `.env.example`, `playwright.config.ts`, `src/lib/dependencias-e2e.test.ts` |
| T-5 | desenvolvedor | T-3 | T-7 | `src/components/ui/{Button,Field,Select,Checkbox,Alert,EmptyState,ErrorState,DataList}.{tsx,module.css,test.tsx}`, `src/components/ui/campo.ts`, `src/components/ui/campo.test.ts` |
| T-6 | desenvolvedor | T-1, T-5 | T-7 | `src/components/ui/{ConfirmDialog,SlotGrid}.{tsx,module.css,test.tsx}`, `tests/support/dialogo.ts` |
| T-7 | desenvolvedor | T-2, T-3 | T-5, T-6 | `src/components/layout/**` |
| T-8 | desenvolvedor | T-4, T-5, T-6, T-7 | — | `src/app/dev/componentes/**` |
| T-9 | desenvolvedor | T-8 | T-10 | `src/components/conformidade.test.ts` |
| T-10 | desenvolvedor | T-8 | T-9 | `e2e/a11y-base.spec.ts`, `e2e/suporte/vitrine.ts` |
| T-11 | desenvolvedor | T-9, T-10 | — | `README.md`, `CLAUDE.md`, `docs/demandas/D-009/dev.md` |
| T-12 | tester | T-11 | — | `docs/demandas/D-009/testes.md` |

Rodadas sem arquivo em comum:
- **Rodada 1:** T-1 ‖ T-2 ‖ T-3 ‖ T-4.
- **Rodada 2:** T-5 ‖ T-7. Os dois só leem `globals.css` (nomes de token e `.visualmente-oculto`) e, o T-7, `navegacao.ts`. O `MenuNavegacao` usa um `button` nativo próprio, não o `Button`.
- **Rodada 3:** T-6 (ainda em paralelo com o T-7, se ele não tiver terminado). Lê `Button`, `EmptyState` e `format.ts`.
- **Rodada 4:** T-8.
- **Rodada 5:** T-9 ‖ T-10.
- **Rodada 6:** T-11.
- **Rodada 7:** T-12.

Observações sobre a posse:
- Um defeito achado numa rodada posterior num arquivo de outra tarefa reabre a tarefa dona (por exemplo, um ajuste de token pedido pelo T-10 volta ao T-3), sem edição cruzada na mesma rodada.
- Não existe barril (`src/components/ui/index.ts`). Os consumidores importam cada componente pelo caminho (`@/components/ui/Button`).

**T-1 — Formatadores e fonte única de formatação.**
- Entregável: §3.3 com `format.test.ts` (CA-1, CA-2, CA-5..CA-9, D-14, deslocamento), a troca no `mp-checkout` e `format.fonte-unica.test.ts` (CA-10, com o escopo por camada da D-8 ajustada).
- Critério de conclusão:
  - `npm run test:unit -- src/lib` verde;
  - `TZ=Asia/Tokyo npx vitest run src/lib/format.test.ts` verde;
  - `npx vitest run --project integration tests/integration/integracoes/checkout.test.ts` verde;
  - `grep -n "Intl\|/ 100" src/app/dev/mp-checkout/page.tsx` vazio;
  - `format.ts` sem nenhum `import`.

**T-2 — Rotas e navegação.**
- Entregável: §3.4 com `navegacao.test.ts` (CA-11 dados, CA-12, RN-14).
- Critério de conclusão:
  - testes verdes;
  - `npm run typecheck` verde (o `satisfies` exaustivo);
  - o único import de `@/server` é `import type`.

**T-3 — Tema, fontes e layout raiz.**
- Entregável:
  - os arquivos de fonte e licença extraídos assim:
    ```
    cd <pasta temporária vazia>
    npm pack @fontsource-variable/fraunces@5.3.0 @fontsource-variable/source-sans-3@5.3.1
    tar -xzf <tgz> -C <pasta própria>
    ```
    Depois, copiar os dois `.woff2` e os dois `LICENSE` (como `OFL-Fraunces.txt` e `OFL-SourceSans3.txt`) para `src/app/_fontes/` e conferir o sha256 da §0;
  - §3.1 e §3.2 completos;
  - `globals.test.ts` (CA-13), `fontes.test.ts` e `layout.test.tsx` (CA-19 unitário).
- Critério de conclusão:
  - `npm run build` verde **sem rede** para fontes (nenhum `fonts.googleapis`/`gstatic` no log nem no código);
  - `npm run lint`, `typecheck` e `test:unit` verdes;
  - `npm run test:e2e -- e2e/smoke.spec.ts` verde;
  - `git ls-files src/app/_fontes` lista os 4 arquivos.

**T-4 — Ambiente da vitrine e dependências do E2E.**
- Entregável:
  - `npm install --save-dev --save-exact @axe-core/playwright@4.14.0 axe-core@4.14.0` (sem `--force`/`--legacy-peer-deps`);
  - §3.10 (parte de ambiente) com `env.test.ts`;
  - `.env.example`;
  - `webServer.env` no `playwright.config.ts`;
  - `dependencias-e2e.test.ts`.
- Critério de conclusão:
  - `npm ci` limpo, sem aviso novo de `allowScripts`;
  - `grep -E '"(@axe-core/playwright|axe-core)": "[\^~]' package.json` vazio;
  - `jq '.packages | keys[] | select(test("axe-core"))' package-lock.json` lista só `node_modules/@axe-core/playwright` e `node_modules/axe-core`;
  - `npm run build` sem `VITRINE_COMPONENTES` nem `DATABASE_URL` verde;
  - `src/scripts/check-env.test.ts` e `src/server/check-env.test.ts` verdes sem mudança.

**T-5 — Componentes de formulário, estado e lista.**
- Entregável: §3.5 e §3.8 com os testes do CA-17 correspondentes.
- Critério de conclusão:
  - testes verdes;
  - nenhum literal de cor nos `.module.css`/`.tsx`;
  - cada arquivo novo com ≥ 90% de linhas em `npx vitest run --coverage src/components/ui` (a leitura pode ignorar o limiar global nessa execução parcial);
  - `npm run lint` verde (inclui `jsx-a11y`).

**T-6 — `ConfirmDialog` e `SlotGrid`.**
- Entregável: §3.6 e §3.7, `tests/support/dialogo.ts` e os testes.
- Critério de conclusão:
  - testes verdes 3 vezes seguidas;
  - mutação manual conferida: remover o `preventDefault` do Tab, o *ref* `emAndamento` ou o foco no `dialog` durante a espera reprova pelo menos um teste;
  - nenhum `setTimeout` na lógica do diálogo.

**T-7 — Layouts e menu móvel.**
- Entregável: §3.9 com os testes (CA-17 layouts e menu, CA-11 componente).
- Critério de conclusão:
  - testes verdes;
  - nenhum layout lê `cookies()`, `headers()` ou `process.env`;
  - todos os `href` vêm de `ROTAS`/`navegacao.ts` (sem string de caminho solta, conferido por `grep -n "href=\"/" src/components/layout` vazio).

**T-8 — Vitrine.**
- Entregável: §3.10 (página, `opcoes.ts`, `Vitrine.tsx`) e os testes.
- Critério de conclusão:
  - testes verdes;
  - `npm run build` lista `ƒ /dev/componentes`;
  - `npm run start` sem a variável → `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/dev/componentes` = `404`; com `VITRINE_COMPONENTES=true` → `200`;
  - revisão visual própria em 320, 375 e 1280 px.

**T-9 — Conformidade por varredura.**
- Entregável: `conformidade.test.ts` (CA-20 e §3.12).
- Critério de conclusão:
  - verde;
  - mutações conferidas: um `color: #fff` num `.module.css`, um `@media (min-width: 600px)` e um `outline: none` reprovam o teste.

**T-10 — E2E de acessibilidade.**
- Entregável: §3.11 com os casos da §8 (CA-3, CA-4, CA-14, CA-15, CA-16, CA-18 E2E, CA-19 E2E).
- Critério de conclusão:
  - `npm run test:e2e` verde (inclui o `smoke`);
  - `--repeat-each=3` verde;
  - zero regras desligadas no axe. Uma exceção só entra com justificativa no próprio teste e aprovação do tester (D-22);
  - o tempo do arquivo fica registrado para o T-11.

**T-11 — Documentação e gates.**
- Entregável:
  - README, seção nova "Interface e acessibilidade":
    - tokens (tabela resumida e regra "só `var(--…)`");
    - fontes (famílias, licença, procedimento do T-3 e sha256);
    - componentes e o caminho de import de cada um;
    - layouts e as props de papel e caminho;
    - `navegacao.ts` e `SEGMENTOS_RESERVADOS` (nota para E1.1/E2.5);
    - vitrine e `VITRINE_COMPONENTES` (o E2E a liga; produção não; `next dev` já liga; valores inválidos derrubam o `check-env`);
    - como rodar `npx playwright test e2e/a11y-base.spec.ts`;
    - a limitação do R-4;
  - `CLAUDE.md`: "Project status" (D-009) e uma linha em "Comandos e cobertura" para o E2E de acessibilidade;
  - `dev.md` com os gates e as evidências, inclusive o tempo do job `e2e` na CI.
- Critério de conclusão: `lint`, `typecheck`, `build`, `npm test`, `npm run test:coverage` (≥ 90% de linhas, sem exclusão nova) e `npm run test:e2e` verdes, e os seis jobs da CI verdes no PR.

**T-12 — Validação independente (tester).**
- Entregável: o `testes.md` com o veredito.
- Critério de conclusão:
  - todos os CAs com evidência;
  - o CA-18 de processo: `cp .env.example .env && docker compose up -d --wait`, e então `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/dev/componentes` = `404`;
  - `TZ=Asia/Tokyo npx vitest run src/lib/format.test.ts` verde;
  - revisão visual (R-12) com capturas em 320, 375 e 1280 px;
  - uso só com teclado da vitrine num navegador real;
  - mutações sugeridas:
    - trocar o Esc do `keydown` por `cancel` → o E2E da confirmação demorada falha;
    - tirar a trava de Tab → o CA-4, passo 2, falha;
    - `hour12: false` sem `hourCycle` → nenhum caso dá `24:00`, e o CA-6 passa (documentar);
    - `centavos / 100` → o CA-5 do `MAX_SAFE_INTEGER` falha;
    - pôr `#fff` num módulo CSS → o CA-20 falha;
    - `primaria` = `#c08060` → o CA-13 falha;
    - remover `hidden`/`display: none` do menu fechado → o CA-3 falha;
    - `vitrineHabilitada` aceitar `'1'` → o CA-18 falha.

### Mapa CA → tarefa → tipo de teste
| CA | Tarefa | Tipo |
|---|---|---|
| CA-1 | T-1 (`format.test.ts`) | Unitário |
| CA-2 | T-1 | Unitário |
| CA-3 | T-7 (menu em jsdom), T-10 (E2E) | Unitário + E2E |
| CA-4 | T-6 (`ConfirmDialog.test.tsx` com dublê), T-10 (E2E, passos 1 a 6) | Unitário + E2E |
| CA-5 | T-1 | Unitário |
| CA-6 | T-1 | Unitário |
| CA-7 | T-1 | Unitário |
| CA-8 | T-1 (formatadores), T-6 (rótulo repetido na `SlotGrid`) | Unitário |
| CA-9 | T-1 (D-23 no processo, com autoverificação), T-12 (`TZ=Asia/Tokyo`) | Unitário + execução manual |
| CA-10 | T-1 (`format.fonte-unica.test.ts` + `checkout.test.ts` existente) | Unitário (varredura) + integração existente |
| CA-11 | T-2 (dados), T-7 (componente) | Unitário |
| CA-12 | T-2 | Unitário |
| CA-13 | T-3 (`globals.test.ts`), T-10 (`color-contrast` do axe) | Unitário + E2E |
| CA-14 | T-10 (com T-3, T-5, T-6, T-7 e T-8 entregando o comportamento) | E2E |
| CA-15 | T-4 (`dependencias-e2e.test.ts`), T-10 (axe) | Unitário + E2E |
| CA-16 | T-10 (com T-5 e T-6) | E2E |
| CA-17 | T-5, T-6, T-7 | Unitário (jsdom) |
| CA-18 | T-4 (`vitrineHabilitada`), T-8 (página), T-10 (200), T-12 (compose → 404) | Unitário + E2E + processo manual |
| CA-19 | T-3 (`layout.test.tsx`), T-10 (família computada), `smoke.spec.ts` | Unitário + E2E |
| CA-20 | T-9 | Unitário (varredura) |
| CA-21 | T-11 (gates), T-12 | Gates + CI |
