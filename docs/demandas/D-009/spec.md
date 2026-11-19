# D-009: base visual e de navegação (issue #10, E0.8)

Autor: analista-requisitos. Fontes, da maior para a menor precedência:
1. `docs/demandas/D-009/issue-10.md`: RN-1..RN-4, CA-1..CA-4 e a lista de entregáveis, já decididos (não reabertos aqui).
2. `PLAN.md`: "Interface" (`PLAN.md:99-115`: telas mínimas, estados claros, celular e computador, teclado, marca provisória e direção visual), "Perfis e acesso" (`:13-22`), idioma e moeda (`:9`), "Fora da primeira versão" (`:129-131`) e os critérios de aceite 2 e 4 (`:136` e `:138`).
3. `CLAUDE.md`: "UI conventions" (pt-BR, BRL, terrosos e nude, títulos com serifa e corpo sem serifa, espaço em branco, sem rosa genérico, responsiva, operável só pelo teclado, sem copiar AppBarber/AppBeleza), "Roles", "Out of scope for v1" e a invariante "Time".
4. `docs/demandas/D-001/`: `spec.md:375-410` (item E0.8), `spec.md:44` e `:60` (lacuna 7: o layout do painel por perfil passa a ser da E0.8), `design.md:96` (os layouts recebem o papel por prop; a sessão real fica na E1.2), `design.md:136` (formatadores com fuso), `design.md:176`, `:184` e `:186` (testes de componente, unitários dos formatadores e Playwright de teclado e a11y), `design.md:517-541` (entregáveis), e as rotas planejadas pelos consumidores (`design.md:583`, `:610`, `:632`, `:657`, `:683`, `:723-1022`, `:1078`, `:1218-1319`, `:1519-1547`).
5. Itens consumidores: E1.2 (`spec.md:461-489`), E4.3 (`:1018-1043`), E9.1 (`:1617-1641`), E4.1 (`:948-983`), E3.3 (`:837-865`) e E2.5 (`:714-748`).
6. Código da branch `feat/d-009-base-visual`, a partir de `27d5c2b` (main).

Esta especificação não reabre nenhuma decisão da issue. As adições são de três tipos: (a) RNs complementares e CAs que tornam verificável cada entregável da issue; (b) a fronteira com E1.2, E4.1, E4.3, E9.1, E3.x e E1.1/E2.5; (c) decisões não bloqueantes, marcadas como D-n no §9, para o arquiteto confirmar. Cada adição indica a origem.

## 1. Problema

Não há base visual nem de navegação. Cada tela futura teria de inventar cores, tipografia, componentes, formatação e navegação. Evidências:

- `ls src/components` → inexistente. `ls src/app/*.css` → inexistente (não há `globals.css`).
- `src/app/layout.tsx:1-16`: o layout raiz só define `lang` e `metadata`. Não importa CSS nem fontes (`next/font`).
- `src/app/page.tsx:3-9`: a página inicial é provisória (h1 e um parágrafo, sem estilo). Ela pertence à E9.1.
- `src/lib/` tem só `site.ts` (marca, `locale`, descrição). Não há `format.ts`. O único formatador de moeda do código é local: `src/app/dev/mp-checkout/page.tsx:17` (`new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`), usado em `:68` com `dados.valorCentavos / 100`. A mesma página fixa cores e fontes em estilos inline (`:21-53`: `#3b2f2a`, `#7a5c4a`, `Georgia`, `system-ui`).
- `src/config/` tem só `plano.ts` (preço em centavos e dias de teste). Não há `navegacao.ts`.
- `e2e/` tem só `smoke.spec.ts`. `package.json` não tem `@axe-core/playwright`, e `ls node_modules/@axe-core` → inexistente. `npm view @axe-core/playwright version` → `4.14.0` (consulta em 19/11/2026).
- `playwright.config.ts:17-34`: há um único projeto (`mobile-chromium`, 375×812, `isMobile`, `hasTouch`), e o `webServer` sobe `npm run start`, ou seja, `next start` sobre o build de **produção** (`NODE_ENV=production`). Por isso a vitrine não pode usar `NODE_ENV` para decidir se responde 404 (RN-17).
- `node_modules/jsdom/lib/jsdom/living/nodes/HTMLDialogElement-impl.js` (jsdom 31.0.1, 9 linhas) declara a interface `HTMLDialogElement`, mas não implementa `showModal()` nem `close()`. Os testes de componente do `ConfirmDialog` em jsdom não reproduzem o modal nativo (impacto em §8).
- `node_modules/eslint-config-next/dist/index.js:7` e `:122`: o `eslint-plugin-jsx-a11y` já está ativo pelo `eslint-config-next` (`npm run lint` vale como verificação estática parcial).
- Saídas do `Intl` no Node do projeto (`node -v` → v24.21.0; ICU 78.3; tzdata 2026c; fuso da máquina `America/Fortaleza`):
  - `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(79)` → `"R$ 79,00"`, com os bytes `52 24 a0 37 39 2c 30 30`: o separador entre `R$` e o número é U+00A0 (NBSP), não um espaço comum. Negativo: `"-R$ 79,00"`. Milhar: `"R$ 1.234.567,89"`.
  - `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day, month, year, hour, minute })` em `2026-03-10T13:00:00Z` → `"10/03/2026, 10:00"`, **com vírgula**. O CA-2 da issue exige `10/03/2026 10:00`, sem vírgula. O formato padrão do `Intl` não serve diretamente (RN-11).
  - Horário de verão histórico de `America/Sao_Paulo`: `2018-11-04T02:59:00Z` → `03/11/2018, 23:59` e `2018-11-04T03:00:00Z` → `04/11/2018, 01:00` (a meia-noite local de 04/11/2018 não existiu); `2019-02-17T01:59:00Z` → `16/02/2019, 23:59` e `2019-02-17T02:00:00Z` → `16/02/2019, 23:00` (a hora 23 local de 16/02/2019 se repetiu).
  - Fuso inválido: `timeZone: 'America/Inexistente'` → `RangeError: Invalid time zone specified: America/Inexistente`.
  - Ponto flutuante: `Intl.NumberFormat(…BRL).format(Number.MAX_SAFE_INTEGER / 100)` → `"R$ 90.071.992.547.409,90"`, mas o valor correto de `9007199254740991` centavos é `…409,91`. Dividir por 100 antes de formatar (como em `src/app/dev/mp-checkout/page.tsx:68`) perde precisão em valores grandes (RN-11: aritmética inteira).
- `prisma/schema.prisma:128-129`: `salao.fuso` é um `String` com padrão `"America/Sao_Paulo"` (IANA).
- `src/server/tenant/context.ts:12-13`: `Papel = 'gestor' | 'profissional' | 'super_admin'` e `PapelDeSalao = Exclude<Papel, 'super_admin'>` já existem.
- `docs/demandas/D-001/`: nenhuma demanda reserva os segmentos de rota de primeiro nível contra o slug público `/[slug]` (`design.md:1022`). `grep -in reservad docs/demandas/D-001/*.md` não encontra regra de slug reservado. E1.1 RN-2 (`spec.md:443`) gera slugs `[a-z0-9-]`, então um salão chamado "Painel" geraria `painel` (caso limite em §6; RN-15).

Consequência: E1.2, E4.3, E9.1, E4.1 e E3.x não têm componentes, layouts, navegação nem formatadores comuns, e a exigência "acessível por teclado, celular e computador" (`PLAN.md:113`) não tem verificação automatizada.

## 2. Objetivo

Entregar uma base reutilizável e verificada:
- tema terroso e nude em `globals.css`, com contraste WCAG AA, títulos com serifa, corpo sem serifa e escala de espaçamentos;
- componentes de UI acessíveis por teclado (botão, campo, select, checkbox, diálogo de confirmação, alerta, estado vazio, estado de erro, lista/tabela e grade de horários);
- três layouts (público, painel por papel e super admin) com menu móvel;
- formatadores pt-BR determinísticos (BRL a partir de centavos; data, hora e data e hora no fuso do salão);
- a lista única das rotas da v1 em `src/config/navegacao.ts`;
- a vitrine `/dev/componentes`, que existe para o E2E e responde 404 em produção;
- um E2E com teclado, viewport de 375 px e axe.

As telas consumidoras só compõem essas peças.

## 3. Escopo

### Entra
1. **`src/app/globals.css`**: tokens de cor, tipografia, espaçamento, raio, foco e quebra de layout (RN-5..RN-7). O layout raiz (`src/app/layout.tsx`) importa o CSS e aplica as duas famílias de `next/font` (RN-6). `lang="pt-BR"` e `metadata` continuam iguais (o teste `src/app/layout.test.tsx` continua passando).
2. **`src/components/ui/**`**: `Button`, `Field`, `Select`, `Checkbox`, `ConfirmDialog` (com `<dialog>` nativo), `Alert`, `EmptyState`, `ErrorState`, `DataList` e `SlotGrid` (RN-8..RN-10, RN-18..RN-22), cada um com teste de componente (Vitest + Testing Library, jsdom).
3. **`src/components/layout/{PublicLayout,PanelLayout,AdminLayout}.tsx`**: navegação a partir de `navegacao.ts`, papel recebido por prop, menu móvel, link "Pular para o conteúdo" e landmarks (RN-12..RN-14).
4. **`src/lib/format.ts`**: `formatarMoeda`, `formatarData`, `formatarHora`, `formatarDataHora` e a constante do fuso padrão (RN-11), com testes unitários.
5. **`src/config/navegacao.ts`**: todas as rotas da v1, os itens de navegação por papel e os segmentos reservados (RN-15, RN-16).
6. **`src/app/dev/componentes/page.tsx`**: a vitrine de todos os componentes e layouts, habilitada por variável de ambiente lida na requisição e com 404 fora dela (RN-17).
7. **`e2e/a11y-base.spec.ts`**: teclado, foco do diálogo, menu móvel, 375 px sem rolagem horizontal e axe sem violações (CA-3, CA-4, CA-13..CA-16).
8. **Dependência de desenvolvimento** `@axe-core/playwright`, com versão exata (RN-23).
9. **`/dev/mp-checkout`** passa a usar `formatarMoeda` em vez do `Intl` local (RN-11, último item). O visual da página pode continuar como está (D-11).
10. **`.env.example`, `src/server/env.ts` e o teste de chaves**: a variável da vitrine (D-1).
11. **README** (seção nova "Interface e acessibilidade": tokens, componentes, vitrine, como rodar o E2E de acessibilidade, variável da vitrine) e **`CLAUDE.md`** ("Project status"; "Comandos e cobertura" se surgir comando novo).

### Fica fora
- Telas de negócio: página inicial (E9.1), login e logout (E1.2), cadastro (E1.1), Termos e Privacidade (E4.3), página pública do salão (E4.1), agenda (E3.3/E3.4), painéis de configuração (E2.x), assinatura (E6.5) e painel do super admin (E8.x). Esta demanda não cria nenhuma página fora de `/dev/componentes`, e os links de navegação podem apontar para rotas que ainda respondem 404 (D-7).
- Sessão real, guarda de rotas e redirecionamento por papel: **E1.2** (`D-001/design.md:96`). Os layouts recebem o papel por prop e não leem cookie.
- Componente de calendário próprio: a escolha de data usa `<input type="date">` nativo dentro de `Field` (D-4). A agenda diária/semanal (E3.3) não é a `SlotGrid`.
- Visão de agenda por profissional em colunas, arrastar e soltar, impressão.
- Modo escuro e temas por salão (marca do salão, cor personalizada).
- Formatadores além dos quatro da RN-11 (dia da semana por extenso, duração "1 h 30 min", telefone E.164 → exibição). Os consumidores que precisarem deles os acrescentam em `format.ts`, com testes (telefone é da E5.1).
- Internacionalização além do pt-BR, e moedas além do BRL.
- Itens fora da v1 (`PLAN.md:129-131`; `CLAUDE.md`, "Out of scope for v1"): nenhuma rota, item de navegação, componente ou texto para caixa, estoque, comissões, relatórios financeiros, fidelidade, pagamento pela cliente, apps nativos, agendamento por WhatsApp, lembretes, mensagens promocionais, conta de cliente, vários gestores por salão ou preço/duração por profissional (RN-16, CA-11).
- Copiar visual ou textos de AppBarber/AppBeleza.

### Fronteira com outras demandas
| Tema | E0.8 (esta demanda) | Demanda futura |
|---|---|---|
| Papel do usuário no layout | `PanelLayout` recebe `papel: PapelDeSalao` por prop | **E1.2**: lê a sessão no servidor e passa o papel; guarda as rotas (403/redirecionamento) |
| "Sair" e nome do usuário | Os layouts de painel e admin têm um espaço para a área do usuário (D-6), vazio por padrão | **E1.2**: preenche com o nome e a ação de logout; **E1.5**: no admin |
| Item ativo da navegação | O layout marca `aria-current="page"` a partir do caminho atual (D-5) | — |
| Rotas e páginas | `navegacao.ts` lista todas as rotas da v1 | Cada consumidor cria a própria página **no caminho já listado**. Se precisar de outro caminho, edita `navegacao.ts` na própria demanda |
| Slugs reservados | `SEGMENTOS_RESERVADOS` exportado (RN-15) | **E1.1** (geração) e **E2.5** (edição) recusam ou desviam slugs reservados. Recomendação registrada aqui, sem CA nesta demanda |
| Página inicial | O layout raiz aplica o tema e as fontes; `/` continua provisória | **E9.1**: monta `/` com `PublicLayout` e o preço de `src/config/plano.ts` formatado por `formatarMoeda` |
| Termos e Privacidade | `PublicLayout` tem os links para `/termos` e `/privacidade` no rodapé | **E4.3**: cria as páginas |
| Página pública do salão | `PublicLayout` na variante de salão (RN-12); `SlotGrid`; `Field`, `Checkbox` e `Alert` | **E4.1**: fluxo, dados e estados ("horário indisponível", "agendamento indisponível") |
| Agenda | `formatarHora`/`formatarData` no fuso do salão; `ConfirmDialog` (encaixe, cancelamento) | **E3.3/E3.4/E3.5**: visões, encaixe e ações |
| Anonimização | `ConfirmDialog` na variante de perigo | **E5.2** |
| Estados do PLAN (`PLAN.md:111`) | `Alert`, `EmptyState` e `ErrorState` genéricos, com exemplos na vitrine | Cada consumidor escreve o texto do seu estado |

## 4. Regras de negócio

Da issue (decididas):
- **RN-1**: todos os componentes interativos são alcançáveis e operáveis por teclado, com foco visível.
- **RN-2**: diálogos prendem o foco e fecham com Esc.
- **RN-3**: contraste de texto mínimo WCAG AA.
- **RN-4**: valores monetários exibidos como `R$ 79,00`; datas em `dd/mm/aaaa`; horas em `HH:mm`.

Complementares (derivadas da issue, do PLAN, do CLAUDE.md e da D-001):

- **RN-5 (tokens de cor)** (issue "Escopo"; `CLAUDE.md` "UI conventions"; RN-3):
  - as cores são propriedades CSS customizadas em `:root` de `src/app/globals.css`, cada uma em hexadecimal de 6 dígitos (`#rrggbb`), para que o teste de contraste as leia sem ambiguidade. Componentes e layouts usam só os tokens: nenhum hexadecimal, `rgb()` ou nome de cor fora de `globals.css` em `src/components/**` e `src/app/dev/componentes/**` (verificação por teste que lê os arquivos; D-8);
  - conjunto mínimo de papéis de cor (os nomes ficam com o arquiteto): fundo da página; superfície (cartões, diálogo); texto principal; texto secundário; borda de controle; ação primária e o texto sobre ela; ação de perigo e o texto sobre ela; indicador de foco; e, para `Alert`, os pares fundo/texto de informação, sucesso, aviso e erro;
  - pares obrigatórios e limiares (WCAG 2.1, 1.4.3 e 1.4.11), calculados pela fórmula de luminância relativa da WCAG:
    - texto principal e secundário sobre fundo e sobre superfície: ≥ 4,5:1;
    - texto sobre ação primária e texto sobre ação de perigo: ≥ 4,5:1;
    - texto de cada variante de `Alert` sobre o próprio fundo: ≥ 4,5:1;
    - borda de controle (campo, select, checkbox) sobre fundo e sobre superfície: ≥ 3:1;
    - indicador de foco sobre fundo, sobre superfície e sobre a cor da ação primária: ≥ 3:1;
  - paleta terrosa e nude, sem rosa genérico. Critério objetivo: nenhum token de cor tem matiz HSL no intervalo [290°, 360°) com saturação ≥ 20% (D-9). Cores de perigo/erro ficam em vermelho-terroso ou terracota (matiz < 290° ou < 20°, segundo o mesmo critério);
  - só tema claro (modo escuro fora do escopo). `color-scheme: light`.
- **RN-6 (tipografia)** (issue "Escopo" e "Entregáveis"; `PLAN.md:115`):
  - duas famílias carregadas por `next/font`: uma serifada para títulos (`h1`..`h3` e títulos de diálogo, estado vazio e estado de erro) e uma sem serifa para o corpo e os controles. Elas são expostas como variáveis CSS (`--fonte-titulo`, `--fonte-corpo` ou nomes equivalentes) e aplicadas no layout raiz;
  - fontes com licença livre (SIL OFL ou Apache 2.0), sem requisição em tempo de execução a terceiros (o `next/font` hospeda os arquivos junto com a app). A forma de obtenção (`next/font/google` ou `next/font/local`) é a D-2;
  - `font-display: swap` (padrão do `next/font`) e fontes de fallback declaradas;
  - tamanho do corpo ≥ 16 px, e controles de formulário com fonte ≥ 16 px (o iOS não amplia a página ao focar);
  - unidades relativas (`rem`): ampliar o texto do navegador para 200% não esconde conteúdo nem cria rolagem horizontal em 1280 px.
- **RN-7 (espaçamento e quebra)** (issue "Escopo"; `PLAN.md:113`, `:115`):
  - escala de espaçamento em tokens (base de 4 px ou 0,25 rem; os passos ficam com o arquiteto), usada pelos componentes, e um raio de borda padrão em token;
  - um único ponto de quebra para "móvel × computador", com valor padrão de 48 rem (768 px) (D-3), documentado em `globals.css`. Abaixo dele, os layouts usam o menu móvel (RN-13);
  - nenhuma página da vitrine produz rolagem horizontal do documento em 320 px, 375 px ou 1280 px de largura (critério: `document.documentElement.scrollWidth ≤ document.documentElement.clientWidth`);
  - `prefers-reduced-motion: reduce` desliga transições e animações dos componentes.
- **RN-8 (teclado e foco)** (RN-1, RN-2; WCAG 2.1.1, 2.4.3, 2.4.7):
  - todo elemento interativo usa o elemento nativo adequado (`button`, `a[href]`, `input`, `select`) ou tem `role` e tratamento de teclado equivalentes. Não existe `div`/`span` clicável;
  - nenhum `tabindex` positivo. A ordem de foco segue a ordem visual;
  - foco visível via `:focus-visible`: contorno de pelo menos 2 px na cor do token de foco (RN-5), com afastamento que o mantém visível sobre a ação primária. Nenhuma regra remove o contorno sem substituí-lo (`outline: none`/`0` só junto de um substituto visível no mesmo seletor);
  - área de toque e de clique de `Button`, do botão do menu móvel, dos itens de navegação e de cada horário da `SlotGrid`: pelo menos 44 × 44 px CSS. `Checkbox`: o rótulo inteiro é clicável;
  - elementos desabilitados usam `disabled` (ou `aria-disabled` com o clique bloqueado, quando precisarem continuar focáveis, D-10) e não dependem só da cor para indicar o estado.
- **RN-9 (componentes de formulário)** (issue "Escopo"; WCAG 1.3.1, 3.3.1, 3.3.2, 4.1.2):
  - `Button`: variantes primária, secundária, perigo e discreta. O `type` padrão é `"button"` (só envia formulário com `type="submit"` explícito). No estado "ocupado", fica desabilitado, expõe `aria-busy="true"` e mantém o rótulo legível (ex.: "Salvando…"). Ícone sem texto exige `aria-label`;
  - `Field` (texto, e-mail, senha, telefone, número, data): `<label>` associado ao controle; texto de ajuda opcional ligado por `aria-describedby`; erro em texto, ligado por `aria-describedby`, com `aria-invalid="true"` no controle e sem depender só da cor; obrigatório marcado no rótulo de forma textual ("obrigatório", não só `*`) e com `required`/`aria-required`. Repassa `name`, `autoComplete` e `inputMode` ao `<input>`;
  - `Select`: `<select>` nativo, com as mesmas regras de rótulo, ajuda e erro do `Field`;
  - `Checkbox`: `<input type="checkbox">` nativo com `<label>` clicável, e as mesmas regras de ajuda e erro (é o componente do consentimento de E4.3, cujo rótulo pode conter links para `/termos` e `/privacidade`);
  - os componentes funcionam controlados e não controlados, aceitam `ref` (React 19) e repassam os atributos nativos restantes.
- **RN-10 (`ConfirmDialog`)** (RN-2; issue "Entregáveis": `<dialog>` nativo; CA-4):
  - usa `<dialog>` aberto com `showModal()`: o resto da página fica inerte e não recebe foco nem clique;
  - tem `aria-labelledby` (título, com fonte serifada) e `aria-describedby` (descrição). Botões: confirmar (rótulo configurável, variante primária ou de perigo) e cancelar (rótulo padrão "Cancelar");
  - ao abrir, o foco vai para o botão cancelar (D-12);
  - **ciclo de foco explícito**: Tab no último elemento focável do diálogo vai para o primeiro, e Shift+Tab no primeiro vai para o último. O foco nunca sai do diálogo, nem para a interface do navegador, enquanto ele estiver aberto (não depende do comportamento do navegador);
  - Esc equivale a cancelar: fecha, chama `onCancelar` uma vez e não chama `onConfirmar`. Enter ou Espaço no botão focado o aciona (comportamento nativo do `button`). Enter com o foco no cancelar **não** confirma;
  - clicar no fundo (backdrop) não fecha o diálogo (D-12). Fechar só ocorre por cancelar, Esc ou confirmar;
  - ao fechar por qualquer caminho, o foco volta ao elemento que o tinha antes de abrir. Se esse elemento não existir mais ou não for focável, o foco vai para o `main` do layout (com `tabindex="-1"`);
  - confirmação assíncrona: se `onConfirmar` devolver uma Promise, os dois botões ficam desabilitados e o confirmar fica "ocupado" (RN-9) até ela terminar. Esc é ignorado nesse intervalo. Se resolver, o diálogo fecha. Se rejeitar, o diálogo continua aberto, mostra a mensagem de erro com `role="alert"` dentro dele e devolve o foco ao botão confirmar;
  - duplo clique ou Enter repetido no confirmar chama `onConfirmar` uma única vez por abertura.
- **RN-11 (formatadores)** (RN-4; CA-1, CA-2; `CLAUDE.md` invariante "Time"; `D-001/design.md:136`):
  - **`formatarMoeda(centavos: number): string`**:
    - formato: `R$` + U+00A0 (NBSP) + parte inteira com separador de milhar `.` + `,` + exatamente 2 casas decimais. Exemplos: `7900` → `"R$ 79,00"`; `0` → `"R$ 0,00"`; `5` → `"R$ 0,05"`; `1999` → `"R$ 19,99"`; `123456789` → `"R$ 1.234.567,89"`;
    - o separador é sempre U+00A0, nunca U+0020 nem U+202F, independentemente da versão do ICU (o resultado é montado a partir de `formatToParts` ou de aritmética inteira, e não copiado do `format`). O `R$ 79,00` da RN-4 e do CA-1 é lido com esse NBSP, e os testes comparam com ` ` explícito;
    - aritmética só com inteiros (sem `centavos / 100` em ponto flutuante para montar os dígitos);
    - entrada inválida lança `RangeError` com mensagem em pt-BR que cita o motivo, sem formatar nada: não inteiro (`79.5`), `NaN`, `±Infinity`, fora de `Number.isSafeInteger`, negativo (D-13). Tipos não numéricos são barrados pelo TypeScript e, em tempo de execução, também lançam `TypeError`/`RangeError`;
  - **`formatarData(instante: Date, fuso?: string): string`** → `dd/mm/aaaa`: dia e mês com 2 dígitos, ano com 4 dígitos, separador `/`;
  - **`formatarHora(instante: Date, fuso?: string): string`** → `HH:mm`, relógio de 24 h (`00`..`23`; meia-noite é `00:00`, nunca `24:00`), sem segundos;
  - **`formatarDataHora(instante: Date, fuso?: string): string`** → `dd/mm/aaaa HH:mm`, com **um único espaço U+0020** entre data e hora, sem vírgula (difere do `Intl`, §1);
  - `fuso`: identificador IANA. Se omitido (`undefined`), vale a constante exportada `FUSO_PADRAO = 'America/Sao_Paulo'`, igual ao padrão de `salao.fuso` (`prisma/schema.prisma:129`) (D-14). String vazia não é "omitido": lança `RangeError`. Fuso inexistente (ex.: `America/Inexistente`) lança `RangeError`, sem cair silenciosamente no padrão;
  - `Date` inválido (`new Date('x')`) lança `RangeError`. As funções recebem `Date`, não string (D-15);
  - as quatro funções são puras, não dependem do fuso do processo (`TZ`) nem do locale padrão do ambiente, e dão o mesmo resultado no servidor e no navegador (sem divergência de hidratação). A saída só contém dígitos ASCII, `/`, `:`, U+0020 e, na moeda, `R$` e U+00A0;
  - o horário de verão histórico é respeitado pelo banco de fusos do `Intl` (casos em §6 e CA-8);
  - `format.ts` não importa nada do servidor (é usável em componente cliente) e não lê o ambiente;
  - nenhum outro arquivo de `src/` (fora de `src/lib/format.ts` e dos testes) usa `Intl.NumberFormat` com `currency` nem formata data/hora para exibição com `Intl.DateTimeFormat`/`toLocale*String`. O `/dev/mp-checkout` passa a usar `formatarMoeda` (verificação por teste que lê os arquivos; D-8).
- **RN-12 (layouts)** (issue "Escopo"; `D-001/design.md:96`; `PLAN.md:113`):
  - os três layouts têm a mesma estrutura de marcos: link "Pular para o conteúdo" como primeiro elemento focável (visível ao receber foco, leva o foco ao `main`); `header` com a marca "Agenda Beleza" (de `src/lib/site.ts`); `nav` com `aria-label` próprio; um único `main` com `id` e `tabindex="-1"`; `footer` quando houver;
  - **`PublicLayout`**: duas variantes (D-6):
    - plataforma: a marca leva a `/`, com links "Entrar" (`/entrar`) e "Criar conta" (`/cadastro`);
    - salão: mostra o nome do salão recebido por prop, sem links de equipe (a cliente não tem conta);
    - nas duas, o rodapé tem "Termos de Uso" (`/termos`) e "Política de Privacidade" (`/privacidade`);
  - **`PanelLayout`**: recebe `papel: PapelDeSalao` (`'gestor' | 'profissional'`), o nome do salão e o caminho atual (D-5). A navegação mostra exatamente os itens de `navegacao.ts` para aquele papel (RN-16). O tipo vem de `src/server/tenant/context.ts:13` por `import type` ou é redefinido igual em `navegacao.ts` com teste de equivalência (D-16). Um papel fora do tipo, em tempo de execução, não mostra nenhum item (falha fechada) e não lança;
  - **`AdminLayout`**: navegação do super admin (RN-16), com a mesma estrutura e o mesmo menu móvel, e um rótulo visível que distingue o painel da plataforma ("Administração da plataforma" ou texto equivalente);
  - o layout não esconde dados nem decide permissão: a navegação por papel é só de interface. A autorização continua no servidor (`CLAUDE.md`, "Tenant isolation"; E1.2 RN-5).
- **RN-13 (menu móvel)** (CA-3; issue "Entregáveis": "menu móvel"):
  - abaixo do ponto de quebra (RN-7), a navegação de `PanelLayout` e de `AdminLayout` fica recolhida atrás de um `button` com nome acessível "Menu" (ou "Abrir menu"), `aria-expanded` e `aria-controls` apontando para a `nav`. No `PublicLayout`, os links da plataforma cabem sem menu em 320 px ou usam o mesmo padrão (decisão do arquiteto, coberta pelo CA-3 e pelo CA-14);
  - Enter ou Espaço no botão abre o menu, e o foco vai para o primeiro item. Acionar de novo, Esc dentro do menu ou acionar um item fecha o menu. Ao fechar por Esc ou pelo botão, o foco volta ao botão do menu;
  - o menu é um *disclosure*, não um diálogo: não prende o foco. Tab depois do último item segue para o conteúdo seguinte, e o menu continua aberto;
  - fechado, os itens não recebem foco (`hidden` ou `display: none`, não só fora da tela);
  - a partir do ponto de quebra, o botão de menu não aparece e a navegação fica sempre visível;
  - funciona sem JavaScript? Não é exigido: o menu é um componente cliente (D-17).
- **RN-14 (item ativo)** (WCAG 2.4.8, boa prática): o item da navegação cujo `href` é igual ao caminho atual, ou é prefixo dele por segmento (ex.: `/painel/agenda` ativo em `/painel/agenda/nova`), recebe `aria-current="page"` e um destaque visual que não depende só da cor. No máximo um item fica ativo (vence o prefixo mais longo).
- **RN-15 (rotas da v1 em `navegacao.ts`)** (issue "Entregáveis"; rotas dos consumidores em `D-001/design.md`):
  - `navegacao.ts` é a fonte única dos caminhos. Os layouts e as páginas futuras não escrevem caminho como texto solto. Rotas com parâmetro são funções que codificam o parâmetro (`encodeURIComponent`);
  - rotas da v1 (fonte: `D-001/design.md`, linhas citadas no topo). Nomes de chave a critério do arquiteto:
    - públicas: `/`, `/entrar`, `/cadastro`, `/confirmar-email`, `/recuperar-senha`, `/redefinir-senha`, `/convite/[token]`, `/termos`, `/privacidade`, `/[slug]` (página pública do salão);
    - painel: `/painel`, `/painel/agenda`, `/painel/agenda/nova`, `/painel/clientes`, `/painel/servicos`, `/painel/profissionais`, `/painel/profissionais/[id]/jornada`, `/painel/bloqueios`, `/painel/configuracoes`, `/painel/assinatura`, `/painel/assinatura/retorno`;
    - super admin: `/admin`, `/admin/entrar`, `/admin/saloes`, `/admin/saloes/[id]`, `/admin/saloes/[id]/assinatura`, `/admin/mensagens`, `/admin/auditoria`;
    - de desenvolvimento (fora da navegação): `/dev/componentes`, `/dev/mp-checkout`;
  - `SEGMENTOS_RESERVADOS`: o conjunto dos primeiros segmentos de todas as rotas acima, mais `api` e `_next` (ex.: `painel`, `admin`, `entrar`, `cadastro`, `confirmar-email`, `recuperar-senha`, `redefinir-senha`, `convite`, `termos`, `privacidade`, `dev`, `api`, `_next`). Ele existe para E1.1 e E2.5 impedirem que um slug de salão colida com uma rota (§6). Esta demanda só o exporta e o testa (CA-12).
- **RN-16 (navegação por papel)** (`PLAN.md:15-20`, `:101-108`; `CLAUDE.md` "Roles"):
  - gestor, nesta ordem: Agenda (`/painel/agenda`), Clientes (`/painel/clientes`), Serviços (`/painel/servicos`), Profissionais (`/painel/profissionais`), Bloqueios (`/painel/bloqueios`), Configurações (`/painel/configuracoes`), Assinatura (`/painel/assinatura`) (D-18). As jornadas são editadas por profissional, a partir de Profissionais (`D-001/design.md:770`), sem item próprio;
  - profissional: Agenda (`/painel/agenda`) e Bloqueios (`/painel/bloqueios`). Não vê Clientes, Serviços, Profissionais, Configurações nem Assinatura (`PLAN.md:16`: "Vê sua agenda… Gerencia apenas os próprios bloqueios");
  - o gestor que também atende continua com o papel `gestor` e a navegação de gestor (`PLAN.md:15`);
  - super admin: Salões (`/admin/saloes`), Mensagens (`/admin/mensagens`), Auditoria (`/admin/auditoria`);
  - os rótulos são textos próprios em pt-BR;
  - nenhum item, rota ou rótulo para os temas fora da v1 (§3, "Fica fora"). Termos vetados para a verificação (CA-11), em minúsculas e sem acentos, em `href` e rótulo: `caixa`, `estoque`, `comiss`, `relatorio`, `financeir`, `fidelidade`, `pagamento` (exceto o vocabulário da assinatura do salão, que não usa essa palavra em rota), `app`, `whatsapp`, `lembrete`, `promoc`, `minha-conta`/`conta-cliente`, `gestores`, `preco-por-profissional`.
- **RN-17 (vitrine `/dev/componentes`)** (issue "Entregáveis": "vitrine para E2E, 404 em produção"):
  - mostra cada componente da `src/components/ui/**` em todas as variantes e estados relevantes (desabilitado, ocupado, com erro, vazio), um `ConfirmDialog` de cada variante disparável por botão, a `SlotGrid` com horários de um dia de exemplo (inclusive uma lista vazia), e os três layouts. O layout é escolhido por parâmetro de busca (ex.: `?layout=publico|publico-salao|painel|admin` e `&papel=gestor|profissional`; D-19). Parâmetro desconhecido usa o padrão (público), sem erro;
  - **habilitação**: a página só responde quando a variável de ambiente da vitrine (D-1, ex.: `VITRINE_COMPONENTES=true`) estiver ativa no **processo** em execução, lida na requisição (`dynamic = 'force-dynamic'`, como `src/app/dev/mp-checkout/page.tsx:10`). Assim, o mesmo build serve as duas situações: o E2E liga a variável no `webServer` do Playwright, e a imagem Docker e o `next start` sem a variável respondem 404. Em `next dev` (`NODE_ENV=development`), a vitrine também fica habilitada sem a variável (D-1);
  - **produção** = qualquer processo com `NODE_ENV=production` e a variável ausente, vazia ou diferente de `true`: `GET /dev/componentes` (com ou sem parâmetros) responde **404** pelo `notFound()` do Next, com o corpo padrão de "não encontrado". Nenhum componente da vitrine é renderizado;
  - **teste/E2E**: com a variável `true`, responde 200 com `<meta name="robots" content="noindex, nofollow">` (como o `mp-checkout`, `:12-15`);
  - a vitrine não acessa banco, sessão, adaptadores nem rede, e não aparece em nenhum link ou na navegação;
  - os dados de exemplo são fictícios, em pt-BR, sem nomes de pessoas reais.
- **RN-18 (`Alert`)** (`PLAN.md:111`):
  - variantes informação, sucesso, aviso e erro, com título opcional e texto;
  - `erro` usa `role="alert"`; as demais usam `role="status"`. Quando o alerta já está na página no carregamento, ele não precisa ser anunciado (o papel vale para os que surgem depois);
  - a variante é indicada também por texto ou ícone com nome acessível (não só pela cor).
- **RN-19 (`EmptyState` e `ErrorState`)** (`PLAN.md:111`):
  - `EmptyState`: título (serifado), descrição e ação opcional (um `Button` ou link);
  - `ErrorState`: título, descrição e, opcionalmente, "Tentar novamente" (callback) e/ou um link de saída. O conteúdo é anunciado com `role="alert"` quando aparece depois da carga;
  - nenhum dos dois mostra detalhe técnico (stack, código interno).
- **RN-20 (`DataList`)** (issue "Escopo": "tabela/lista"; RN-7):
  - recebe colunas (rótulo e função de renderização) e linhas (com chave estável), além de um nome acessível (`caption` visível ou `aria-label`);
  - no ponto de quebra ou acima dele, renderiza um `<table>` semântico (`th` com `scope="col"`). Abaixo dele, cada linha aparece empilhada, com o rótulo de cada coluna visível ao lado do valor, sem rolagem horizontal do documento. A semântica para leitores de tela continua sendo de tabela ou de lista com pares rótulo/valor (D-20);
  - sem linhas, mostra o `EmptyState` recebido por prop (ou um padrão "Nada por aqui ainda.");
  - textos longos (nome de cliente, e-mail) quebram a linha (`overflow-wrap: anywhere`) em vez de alargar a página;
  - ordenação, filtros e paginação ficam com os consumidores (E5.1, E8.x).
- **RN-21 (`SlotGrid`)** (issue "Escopo": "calendário/grade de horários"; `PLAN.md:34-35`; `CLAUDE.md` invariante "Time"):
  - recebe os instantes de início disponíveis (`Date[]`, em UTC), o fuso do salão, o selecionado (opcional), o callback de seleção e um rótulo do grupo (ex.: "Horários de terça-feira, 10/03/2026", montado pelo consumidor);
  - mostra **só** os instantes recebidos, em ordem crescente, com a hora em `HH:mm` no fuso do salão (via `formatarHora`). Não calcula disponibilidade, que é da E3.1. Instantes repetidos aparecem uma vez;
  - a identidade de cada horário é o instante (ISO 8601 UTC), nunca o rótulo. Se dois instantes distintos tiverem o mesmo rótulo (hora repetida no fim de um horário de verão, §6), o nome acessível e o texto visível de cada um incluem o deslocamento UTC (ex.: `23:00 (UTC−02:00)` e `23:00 (UTC−03:00)`) (D-21);
  - semântica de grupo de opções exclusivas: `fieldset` com `legend` (o rótulo do grupo) e `input type="radio"` nativos estilizados (D-21). Tab entra e sai do grupo; as setas mudam a seleção; Espaço seleciona. O selecionado é anunciado como marcado e destacado também por forma ou borda, não só pela cor;
  - lista vazia: mostra um `EmptyState` com o texto padrão "Nenhum horário disponível nesta data." (sobrescrevível);
  - colunas com largura automática que se ajustam à tela, sem rolagem horizontal em 320 px. Cada horário tem pelo menos 44 × 44 px (RN-8);
  - a escolha de data (o "calendário" da issue) usa `Field` com `type="date"` nativo (D-4).
- **RN-22 (texto e idioma)** (`CLAUDE.md` "UI conventions"; `PLAN.md:7`, `:9`, `:113`):
  - todo texto fixo dos componentes e layouts está em pt-BR (rótulos padrão, nomes acessíveis, mensagens), sem trechos copiados de AppBarber/AppBeleza;
  - a marca é "Agenda Beleza" e vem de `siteConfig.name`;
  - os textos padrão sobrescrevíveis ficam como props com valor padrão (sem biblioteca de i18n).
- **RN-23 (axe no Playwright)** (issue: "Sugestão (não decidida): checagem automática… com axe" × entregável `e2e/a11y-base.spec.ts (…, @axe-core/playwright)`):
  - **decisão**: a lista de entregáveis da issue já inclui o `@axe-core/playwright`, então a checagem é **obrigatória** nesta demanda. A sugestão foi resolvida pelo entregável, e esta RN a torna verificável (CA-15). Se o líder entender que a sugestão prevalece sobre o entregável, a mudança é só remover o CA-15 e esta RN (D-22);
  - `@axe-core/playwright` fica em `devDependencies`, com versão exata (sem `^`/`~`, `.npmrc save-exact`), e o `package-lock.json` resolve exatamente essa versão. Justificativa da dependência nova: é o integrador oficial do axe-core para Playwright, mantido pela Deque, e não entra na imagem de produção (`npm prune --omit=dev`, `Dockerfile:18`);
  - regras avaliadas: as etiquetas `wcag2a`, `wcag2aa`, `wcag21a` e `wcag21aa`. Resultado exigido: **zero violações**, de qualquer impacto. Nenhuma regra é desligada nem excluída por seletor, salvo uma exceção justificada no próprio teste e aprovada pelo tester (D-22);
  - o axe complementa os testes de teclado e de contraste. Ele não os substitui (RN-5, CA-4, CA-13).
- **RN-24 (sem efeito em dados e em segurança)**: nenhum código desta demanda acessa o banco, a sessão, os adaptadores ou a fila. Nenhuma migração. Os componentes não usam `dangerouslySetInnerHTML`.

## 5. Critérios de aceitação

Convenções:
- "Unitário" = Vitest, projeto `unit`; os arquivos `*.test.tsx` começam com `/** @vitest-environment jsdom */` (`CLAUDE.md`).
- "E2E" = Playwright, projeto `mobile-chromium` (375×812), contra `next start` do build de produção com a variável da vitrine ligada no `webServer` (RN-17). Quando um CA pede outra largura, o teste usa `page.setViewportSize`.
- "Sem rolagem horizontal" = `document.documentElement.scrollWidth <= document.documentElement.clientWidth`, medido depois da carga e das fontes (`document.fonts.ready`).
- Os testes de formatação não podem depender do fuso da máquina: o resultado é o mesmo com `TZ=UTC`, `TZ=America/Fortaleza` e `TZ=Asia/Tokyo` (CA-9).

### CAs da issue (CA-1..CA-4), com o modo de verificação
- **CA-1** (RN-4, RN-11): Dado o valor 7900 centavos, quando formatado, então exibe `R$ 79,00`.
  - Verificação, unitário: `formatarMoeda(7900) === 'R$ 79,00'` (comparação com o NBSP explícito, e `!== 'R$ 79,00'` com U+0020, para documentar a escolha).
- **CA-2** (RN-4, RN-11): Dado um instante UTC `2026-03-10T13:00:00Z` e fuso `America/Sao_Paulo`, quando formatado, então exibe `10/03/2026 10:00`.
  - Verificação, unitário: `formatarDataHora(new Date('2026-03-10T13:00:00Z'), 'America/Sao_Paulo') === '10/03/2026 10:00'` (U+0020, sem vírgula); o mesmo resultado com o fuso omitido (`FUSO_PADRAO`); `formatarData` → `10/03/2026`; `formatarHora` → `10:00`.
- **CA-3** (RN-7, RN-12, RN-13): Dado o layout do painel em viewport de 375 px, quando a página carrega, então não há rolagem horizontal e a navegação é acessível por um botão de menu.
  - Verificação, E2E: `/dev/componentes?layout=painel&papel=gestor`. Sem rolagem horizontal. Os itens de navegação não estão visíveis nem focáveis. Existe um `button` com nome "Menu" e `aria-expanded="false"`. Só pelo teclado (Tab até o botão, Enter): `aria-expanded="true"`, os 7 itens do gestor aparecem na ordem da RN-16 e o foco está no primeiro. Esc fecha, e o foco volta ao botão. Repetir com `papel=profissional` (2 itens) e com `layout=admin` (3 itens).
- **CA-4** (RN-2, RN-10): Dado um diálogo de confirmação aberto, quando se navega só com Tab/Shift+Tab/Enter/Esc, então é possível confirmar, cancelar e o foco volta ao elemento de origem.
  - Verificação, E2E, na vitrine, só com `page.keyboard`:
    1. focar o botão que abre o diálogo por Tab e abrir com Enter. O diálogo está aberto (`dialog[open]`), e o foco está em "Cancelar";
    2. Tab e Shift+Tab repetidos (pelo menos 2 voltas completas nos dois sentidos): o elemento focado está sempre dentro do `dialog`;
    3. Esc: o diálogo fecha, o contador de "cancelado" da vitrine incrementa, o de "confirmado" não muda, e o foco está no botão de origem;
    4. reabrir com Enter, Tab até "Cancelar" e Enter: fecha como cancelado, e o foco volta à origem;
    5. reabrir, Tab até o confirmar e Enter: fecha, "confirmado" incrementa uma vez, e o foco volta à origem;
    6. com o diálogo aberto, o conteúdo fora dele não recebe foco por Tab e não reage a clique (o `inert` do modal).
  - Verificação, unitário (complementar; o jsdom não implementa `showModal`, §1): com `showModal`/`close` fornecidos ao `HTMLDialogElement.prototype` só no teste, o ciclo de foco (último → primeiro e primeiro → último), Esc → `onCancelar` (sem `onConfirmar`), a devolução do foco e a chamada única de `onConfirmar` com duplo clique.

### CAs complementares (tornam verificáveis as RNs e os entregáveis sem CA próprio)
- **CA-5** (RN-11; moeda e entradas inválidas): Dado `formatarMoeda`, então:
  - `0` → `R$ 0,00`; `5` → `R$ 0,05`; `99` → `R$ 0,99`; `100` → `R$ 1,00`; `1999` → `R$ 19,99`; `100000` → `R$ 1.000,00`; `123456789` → `R$ 1.234.567,89`; `Number.MAX_SAFE_INTEGER` → `R$ 90.071.992.547.409,91`;
  - `79.5`, `NaN`, `Infinity`, `-Infinity`, `Number.MAX_SAFE_INTEGER + 1`, `-1` e `-7900` lançam `RangeError` (D-13); `'7900'` (forçado com `as never`) lança `TypeError` ou `RangeError`;
  - nenhum resultado contém U+0020, U+202F ou U+2009, e todo resultado casa com `/^R\$ \d{1,3}(\.\d{3})*,\d{2}$/`.
  Verificação: unitário.
- **CA-6** (RN-11; data, hora e virada de dia): Dado o fuso `America/Sao_Paulo`, então:
  - `2026-03-10T03:00:00Z` → `formatarDataHora` `10/03/2026 00:00` e `formatarHora` `00:00` (meia-noite local, nunca `24:00`);
  - `2026-03-11T02:30:00Z` → `10/03/2026 23:30` (ainda dia 10 no salão; dia 11 em UTC);
  - `2026-01-01T02:59:00Z` → `31/12/2025 23:59` (virada de ano);
  - `2026-01-05T12:05:00Z` → `05/01/2026 09:05` (zeros à esquerda em dia, mês e minuto).
  Verificação: unitário.
- **CA-7** (RN-11; outros fusos): Dado `2026-03-10T13:00:00Z`, então `America/Manaus` → `10/03/2026 09:00`, `America/Noronha` → `10/03/2026 11:00`, `UTC` → `10/03/2026 13:00`; e `2026-01-01T00:00:00Z` em `America/Rio_Branco` → `31/12/2025 19:00`. Verificação: unitário.
- **CA-8** (RN-11; horário de verão histórico de `America/Sao_Paulo`):
  - início em 04/11/2018 (a meia-noite local não existiu): `2018-11-04T02:59:00Z` → `03/11/2018 23:59`; `2018-11-04T03:00:00Z` → `04/11/2018 01:00`;
  - fim em 17/02/2019 (a hora 23 local de 16/02 se repetiu): `2019-02-17T01:59:00Z` → `16/02/2019 23:59`; `2019-02-17T02:00:00Z` → `16/02/2019 23:00`; `2019-02-17T01:00:00Z` → `16/02/2019 23:00` (dois instantes distintos com o mesmo rótulo);
  - fora do horário de verão: `2019-03-10T13:00:00Z` → `10/03/2019 10:00`; dentro dele: `2019-01-10T13:00:00Z` → `10/01/2019 11:00`.
  Verificação: unitário. Os valores esperados foram conferidos com o `Intl` do Node 24.21.0 (ICU 78.3, tzdata 2026c), §1.
- **CA-9** (RN-11; independência do ambiente e entradas inválidas):
  - o mesmo arquivo de teste passa com `TZ=UTC`, `TZ=America/Fortaleza` e `TZ=Asia/Tokyo` (o teste roda os casos do CA-2 e do CA-8 num processo filho com cada `TZ`, ou o tester executa `TZ=… npx vitest run src/lib/format.test.ts` três vezes; D-23);
  - `formatarData(new Date('x'))`, `formatarHora(new Date(NaN))` e `formatarDataHora(new Date('x'), 'UTC')` lançam `RangeError`;
  - `fuso = 'America/Inexistente'` e `fuso = ''` lançam `RangeError` nas três funções de data; `fuso = undefined` usa `FUSO_PADRAO`;
  - toda saída de `formatarDataHora` casa com `/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/`.
  Verificação: unitário.
- **CA-10** (RN-11; fonte única de formatação): Dado o código de `src/` (exceto `src/lib/format.ts`, os testes e `src/generated/**`), quando um teste o lê, então não há `Intl.NumberFormat` com `currency`, nem `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString` ou `Intl.DateTimeFormat` para exibição. `src/app/dev/mp-checkout/page.tsx` usa `formatarMoeda(dados.valorCentavos)`, e o teste da página (ou o E2E existente da D-007, se houver) continua passando. Verificação: unitário que varre os arquivos (D-8).
- **CA-11** (RN-15, RN-16; navegação por papel e fora da v1): Dado `navegacao.ts`, então:
  - a navegação do gestor é exatamente a lista ordenada da RN-16 (7 itens), a do profissional tem 2 itens e a do super admin tem 3;
  - todo `href` de navegação está entre as rotas da v1 (RN-15), começa com `/painel/` ou `/admin/` (conforme o layout) e não se repete;
  - nenhum `href`, rótulo ou chave de rota, em minúsculas e sem acentos, contém um termo vetado da RN-16;
  - `PanelLayout` renderizado com `papel="profissional"` não contém links para `/painel/clientes`, `/painel/servicos`, `/painel/profissionais`, `/painel/configuracoes` nem `/painel/assinatura`; com um papel inválido (forçado com `as never`), não renderiza nenhum item e não lança.
  Verificação: unitário (dados) e teste de componente (layout).
- **CA-12** (RN-15; rotas e segmentos reservados): Dado `navegacao.ts`, então:
  - as rotas listadas na RN-15 existem como constantes ou funções. `rotas.convite('a b/c')` (ou nome equivalente) devolve `/convite/a%20b%2Fc`, e o mesmo vale para `jornada(id)`, `salaoPublico(slug)` e `adminSalao(id)`;
  - `SEGMENTOS_RESERVADOS` contém o primeiro segmento de cada rota estática (calculado no teste a partir das próprias rotas, para não ficar desatualizado), mais `api` e `_next`, e não contém `[slug]`;
  - cada pasta de primeiro nível existente em `src/app` (exceto grupos `(…)` e segmentos dinâmicos `[…]`) está em `SEGMENTOS_RESERVADOS` (hoje: `api` e `dev`). Assim, uma página criada no futuro fora da lista quebra o teste.
  Verificação: unitário.
- **CA-13** (RN-3, RN-5; contraste e paleta): Dado `src/app/globals.css`, quando um teste o lê, extrai os tokens de cor de `:root` e calcula a razão de contraste WCAG de cada par da RN-5, então todos atingem o limiar (4,5:1 para texto; 3:1 para bordas de controle e foco). Nenhum token tem matiz em [290°, 360°) com saturação ≥ 20% (D-9). Todo token de cor é `#rrggbb`. Verificação: unitário. Complemento: no E2E, a regra `color-contrast` do axe (CA-15) passa em todas as variantes da vitrine.
- **CA-14** (RN-1, RN-7, RN-8, RN-12; teclado e responsividade dos layouts): Dado cada layout da vitrine (`publico`, `publico-salao`, `painel` com `gestor` e `profissional`, `admin`), então:
  - em 320 px, 375 px e 1280 px não há rolagem horizontal;
  - em 1280 px, o botão de menu não existe ou não está visível, e os itens de navegação estão visíveis e focáveis;
  - o primeiro Tab foca "Pular para o conteúdo", que está visível; Enter leva o foco ao `main`;
  - percorrendo a página só com Tab, todo elemento focado tem contorno visível (`outline-style` diferente de `none` e `outline-width` ≥ 2 px, pelo estilo computado) e todo elemento interativo da vitrine é alcançado;
  - com `?layout=painel&papel=gestor` e o caminho atual simulado como `/painel/agenda/nova` (D-5), o item "Agenda" tem `aria-current="page"` e nenhum outro tem;
  - `Button`, o botão de menu, os itens de navegação no menu aberto e os horários da `SlotGrid` têm caixa de pelo menos 44 × 44 px (`boundingBox`) em 375 px.
  Verificação: E2E.
- **CA-15** (RN-23; axe): Dado `@axe-core/playwright` em `devDependencies` com versão exata, quando o E2E roda o `AxeBuilder` com as etiquetas `wcag2a`, `wcag2aa`, `wcag21a` e `wcag21aa` em cada variante de layout da vitrine, com o menu móvel fechado e aberto, e com o `ConfirmDialog` aberto (cada variante), então o resultado tem **zero violações**. Um teste lê `package.json`/`package-lock.json` e confere a versão exata. Verificação: E2E e unitário (versão).
- **CA-16** (RN-9, RN-20, RN-21; componentes no navegador): Dado a vitrine em 375 px, então:
  - na `SlotGrid`, Tab entra no grupo, as setas mudam o horário selecionado, a seleção fica anunciada como marcada (`checked`) e Tab sai do grupo; a grade vazia mostra "Nenhum horário disponível nesta data.";
  - no exemplo de `Field` com erro, o `input` tem `aria-invalid="true"` e `aria-describedby` aponta para o texto do erro, que está visível;
  - o `Checkbox` alterna com Espaço e com clique no rótulo;
  - o `DataList` de exemplo não causa rolagem horizontal em 375 px, e cada valor aparece com o rótulo da coluna; em 1280 px, é uma `table` com cabeçalhos de coluna.
  Verificação: E2E.
- **CA-17** (RN-9..RN-10, RN-18..RN-21; testes de componente): Dado cada componente de `src/components/ui/**` e cada layout, quando renderizado em jsdom, então os testes conferem pelo menos:
  - `Button`: `type="button"` por padrão; o estado ocupado tem `disabled` e `aria-busy="true"`; clique desabilitado não chama `onClick`;
  - `Field`/`Select`/`Checkbox`: rótulo associado (`getByLabelText`), ajuda e erro em `aria-describedby`, `aria-invalid`, obrigatório textual;
  - `Alert`: `role="alert"` em erro e `role="status"` nas demais variantes, com a variante em texto acessível;
  - `EmptyState`/`ErrorState`: título e ação; "Tentar novamente" chama o callback;
  - `DataList`: `caption`/nome acessível, `th scope="col"`, `EmptyState` sem linhas;
  - `SlotGrid`: ordem crescente, rótulos `HH:mm` no fuso recebido (ex.: `2026-03-10T13:00:00Z` em `America/Sao_Paulo` → `10:00`), deduplicação, identidade por instante, o deslocamento UTC quando dois instantes têm o mesmo rótulo (CA-8: `2019-02-17T01:00:00Z` e `2019-02-17T02:00:00Z`), e o callback com o `Date` correto;
  - `ConfirmDialog`: o complemento do CA-4, a confirmação assíncrona (botões desabilitados durante a Promise; rejeição mantém aberto com `role="alert"`) e o Esc ignorado durante a confirmação;
  - layouts: marcos (`banner`, `navigation` com nome, `main`, `contentinfo` onde houver), link de pular, marca "Agenda Beleza", a variante de salão do `PublicLayout` sem "Entrar"/"Criar conta" e com o nome do salão, e os links de Termos e Privacidade;
  - menu móvel: `aria-expanded` e `aria-controls`; Esc fecha e devolve o foco ao botão.
  Verificação: unitário.
- **CA-18** (RN-17; vitrine em produção e em teste):
  - unitário: o componente da página, com a fonte de ambiente injetada (como `carregarCheckoutSimulado(…, fonte)` em `src/server/integrations/mercadopago/checkout-simulado.ts:31-34`), chama `notFound()` quando `NODE_ENV=production` e a variável está ausente, vazia, `false`, `1` ou `TRUE` (só o texto exato `true` habilita; D-1), e renderiza quando ela é `true` ou quando `NODE_ENV=development`. A página exporta `dynamic = 'force-dynamic'` e `robots: { index: false, follow: false }`;
  - E2E: com a variável ligada no `webServer`, `GET /dev/componentes` → 200; o teste falha com mensagem clara ("ligue <variável> ou libere a porta 3000") se receber 404, o que cobre o `reuseExistingServer` local com um servidor sem a variável;
  - processo (tester, manual): `docker compose up -d --wait` com o `.env` copiado do `.env.example` (variável em `false`), e então `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/dev/componentes` → `404`.
- **CA-19** (RN-6, RN-12, RN-22; tema aplicado e sem regressão): Dado o layout raiz, então ele importa `globals.css` e aplica as classes ou variáveis das duas fontes no `<html>` ou no `<body>`; `lang="pt-BR"`, `title` e `description` continuam os do `src/app/layout.test.tsx`; `e2e/smoke.spec.ts` continua passando. No E2E, o `h1` da vitrine tem `font-family` computada com a família serifada, e um parágrafo tem a família sem serifa. Verificação: unitário e E2E.
- **CA-20** (RN-5, RN-11; sem cor nem formatação fora do lugar): Dado `src/components/**` e `src/app/dev/componentes/**`, quando um teste os lê, então não há literal de cor (`#hex`, `rgb(`, `hsl(` ou nome de cor CSS em estilo) fora de `globals.css`/CSS que só referencia `var(--…)` (D-8). Verificação: unitário.
- **CA-21** (gate): `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:coverage` (≥ 90% de linhas, com `src/components/**`, `src/lib/format.ts`, `src/config/navegacao.ts` e a página da vitrine medidos) e `npm run test:e2e` passam, e os seis jobs da CI ficam verdes. O `npm run build` continua sem exigir `DATABASE_URL` nem a variável da vitrine.

### Relação com o PLAN
| Critério do PLAN | Contribuição desta demanda |
|---|---|
| 2 (reservar pelo celular) | `SlotGrid`, `Field`, `Checkbox` e `PublicLayout` usáveis em 375 px e por teclado (CA-3, CA-14..CA-16). O critério fecha em E4.1/E4.4 |
| 4 (gestor e profissional veem só o permitido) | Navegação por papel (CA-11). Só interface: a garantia é do servidor (E1.2, E3.3) |
| "Interface" (`PLAN.md:113-115`) | Celular e computador, teclado, marca e direção visual (CA-3, CA-13..CA-15, CA-19) |

## 6. Casos limite
- **Fuso e virada de dia**: um instante UTC do dia seguinte ainda pode ser "hoje" no salão (`2026-03-11T02:30:00Z` → `10/03/2026 23:30`, CA-6). A meia-noite local é `00:00` (CA-6). A virada de ano é coberta (CA-6, CA-7). O fuso da máquina (aqui, `America/Fortaleza`) não afeta o resultado (CA-9).
- **Horário de verão histórico**: hora inexistente no início (04/11/2018) e hora repetida no fim (16/02/2019) (CA-8). Na `SlotGrid`, dois horários com o mesmo rótulo são desambiguados pelo deslocamento UTC (RN-21, CA-17). Hoje o Brasil não adota horário de verão, mas o fuso é IANA e configurável (E2.5), e o banco de fusos do runtime pode mudar. Uma atualização do tzdata que altere regras futuras não muda os testes, porque os casos usam datas históricas.
- **Divergência de ICU entre servidor e navegador**: a moeda e a data são montadas por partes com separadores fixos (RN-11). Nenhum texto depende de um espaço que o ICU possa trocar (U+00A0 × U+202F), o que evita divergência de hidratação.
- **Valores monetários**: zero, centavos menores que 1 real, milhar e o maior inteiro seguro (CA-5). Fração de centavo, negativos e não finitos são recusados (CA-5, D-13). O preço do plano vem de `PRECO_MENSAL_CENTAVOS` (`src/config/plano.ts:4`) e é formatado como `R$ 79,00`.
- **Concorrência**: não se aplica a dados. Na UI, o duplo clique ou o Enter repetido no confirmar do diálogo chama a ação uma vez (RN-10, CA-17).
- **Isolamento entre salões**: não se aplica diretamente: nenhum componente acessa dados. A navegação por papel não é controle de acesso (RN-12). O nome do salão exibido no layout vem do consumidor, que o obtém pelo contexto de tenant (E1.2).
- **Salão suspenso**: não se aplica aqui. Os layouts não mudam a navegação por estado de assinatura. O aviso de "assinatura suspensa" (E6.4/E6.5) usa `Alert`, e o "agendamento indisponível" da página pública (E6.4/E4.1) usa `EmptyState`/`Alert` no `PublicLayout` de salão.
- **Cliente anonimizada**: não se aplica aos componentes. "cliente removida" é um texto dos consumidores (E3.3, E5.2). O `DataList` só exibe o que recebe.
- **Entradas inválidas**: valor monetário (CA-5), `Date` inválido e fuso inválido ou vazio (CA-9), papel inválido no layout (CA-11), parâmetros desconhecidos na vitrine (RN-17), `SlotGrid` vazia ou com instantes repetidos (RN-21). Telefone não brasileiro não se aplica: a validação e a exibição do telefone são da E5.1, e o `Field` só oferece `type="tel"`/`inputMode="tel"`.
- **Permissões por perfil**: a navegação do profissional omite as áreas do gestor (CA-11). O gestor que também atende usa a navegação de gestor. O super admin tem layout próprio. A vitrine não tem sessão e não exige login, mas só existe com a variável ligada (RN-17).
- **Slug de salão igual a uma rota**: um salão chamado "Painel", "Admin", "Termos" ou "Entrar" geraria um slug que colide com `/painel`, `/admin`, `/termos` ou `/entrar`. As rotas estáticas têm precedência sobre `/[slug]` no App Router, então a página pública desse salão nunca abriria. Esta demanda exporta `SEGMENTOS_RESERVADOS` (RN-15, CA-12); a regra de recusa ou sufixo é da E1.1/E2.5 (§3, fronteira; registrar nessas demandas).
- **Texto longo**: nomes de salão, cliente ou serviço longos quebram a linha no layout, no `DataList` e nos títulos, sem rolagem horizontal (RN-7, RN-20).
- **Zoom e fonte ampliada**: texto a 200% em 1280 px não gera rolagem horizontal (RN-6). Em 320 px (reflow WCAG 1.4.10), não há rolagem horizontal (CA-14).
- **Sem JavaScript**: os layouts e os componentes renderizam no servidor, mas o menu móvel, o diálogo e a `SlotGrid` dependem do JavaScript do cliente (D-17).
- **Movimento reduzido**: com `prefers-reduced-motion: reduce`, nenhuma transição (RN-7).
- **Servidor reaproveitado no E2E local**: se um `next dev`/`start` sem a variável estiver na porta 3000, o `reuseExistingServer` o reaproveita. Com `next dev`, a vitrine responde (D-1); com `next start` sem a variável, o teste falha com a mensagem do CA-18.
- **jsdom sem `showModal`**: os testes de componente fornecem `showModal`/`close` só no próprio teste. O comportamento nativo (inércia do fundo, Esc) é comprovado no E2E (CA-4).

## 7. Dependências
- **Demandas**: E0.1/D-002 (Next, Vitest, Playwright), E0.3/D-006 (CI, job `e2e`), E0.6/D-007 (`env.ts` e o teste de chaves do `.env.example`, `src/config/plano.ts`, `/dev/mp-checkout`). Todas concluídas em `main`.
- **Bloqueia**: E1.2 (#12), E4.3 (#33), E9.1 (#54); e é base de E4.1, E3.x, E2.x, E5.x, E6.5 e E8.x.
- **Integrações**: nenhuma (Mercado Pago, WhatsApp, e-mail e Turnstile não são tocados; o `mp-checkout` só troca o formatador).
- **Bibliotecas**:
  - nova: `@axe-core/playwright` (devDependency, versão exata; RN-23). Referência em 19/11/2026: `4.14.0`;
  - existentes: `next/font` (parte do `next` 16.4.6), React 19.3.1, Testing Library (`@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2), jsdom 31.0.1, `@playwright/test` 1.65.1;
  - opcional, a critério do arquiteto: `@testing-library/user-event` (devDependency, versão exata) para simular Tab/Esc nos testes de componente com mais fidelidade que `fireEvent`. Se não for adotado, os testes usam `fireEvent` e o E2E cobre o teclado real (D-24);
  - nenhuma biblioteca de componentes, CSS (Tailwind etc.), ícones ou i18n (D-25).
- **Fontes**: duas famílias com licença OFL/Apache. Com `next/font/google`, o `next build` baixa as fontes da rede nos jobs `build`, `e2e` e `docker` da CI e no `docker build`. Com `next/font/local`, os arquivos `.woff2` ficam versionados (D-2).
- **Infraestrutura**: nenhuma mudança no compose além de o `.env.example` declarar a variável da vitrine em `false`.

## 8. Impactos prováveis
- **Dados (DBA: não)**: nenhuma migração, tabela, consulta ou repositório (RN-24).
- **Infra/CI (DevOps: sim, revisão leve)**:
  - `playwright.config.ts`: `webServer.env` com a variável da vitrine. A CI não muda de comando (`npm run test:e2e`);
  - tempo do job `e2e`: o novo spec percorre várias variantes e larguras e roda o axe (estimativa: dezenas de segundos);
  - com `next/font/google`, os três jobs que compilam e o `docker build` passam a depender do acesso aos servidores de fontes na compilação (risco de instabilidade). Com `next/font/local`, não (D-2);
  - a imagem Docker não deve ligar a variável da vitrine (CA-18, verificação manual), e o `env_file` do compose (`docker-compose.yml:6-8`) lê o `.env`, que vem do `.env.example` com `false`;
  - `@axe-core/playwright` em `devDependencies` é removido pelo `npm prune --omit=dev` (`Dockerfile:18`).
- **Código existente**:
  - `src/app/layout.tsx` (+ teste): importa o CSS e as fontes;
  - `src/app/dev/mp-checkout/page.tsx`: troca o `Intl` local por `formatarMoeda` (CA-10). O estilo inline pode continuar ou migrar para os tokens (D-11);
  - `src/server/env.ts` e `.env.example` (variável da vitrine; o teste de chaves cobre os dois lados);
  - `playwright.config.ts`, `package.json`/`package-lock.json` (axe), `README.md` e `CLAUDE.md`;
  - `src/app/page.tsx` não muda (E9.1). Ela herda o tema pelo layout raiz.
- **Lint**: `eslint-plugin-jsx-a11y` já roda (§1). Nenhuma regra de import nova é exigida. A regra de "sem cor literal" é um teste (CA-20), não lint (D-8).
- **Cobertura**: `src/components/**`, `src/lib/format.ts`, `src/config/navegacao.ts` e `src/app/dev/componentes/page.tsx` entram no gate de 90% e precisam de testes de componente/unitários. O Playwright não conta para a métrica (`CLAUDE.md`), e as partes que dependem de `showModal` precisam do dublê no teste unitário para serem medidas.

## 9. Dúvidas e suposições

### Bloqueantes
Nenhuma.

### Decisões tomadas (não bloqueantes), para o arquiteto confirmar
- **D-1 — habilitação da vitrine**: uma variável de ambiente booleana (sugestão: `VITRINE_COMPONENTES`, valores `true`/`false`, padrão `false`), declarada em `src/server/env.ts` (esquema, com padrão) e no `.env.example` com `false` e comentário ("só para o E2E e para desenvolvimento; nunca em produção"). Só o texto exato `true` habilita. Ela é lida na requisição, e `next dev` (`NODE_ENV=development`) habilita sem a variável. Motivo: o E2E roda sobre o build de produção (`playwright.config.ts:29-34`), então `NODE_ENV` não distingue E2E de produção; uma variável lida em tempo de execução permite um único build. Alternativas: rota sempre ligada fora de `NODE_ENV=production` (quebra o E2E); um build especial para o E2E (dobra a compilação no job `e2e`).
- **D-2 — origem das fontes**: recomendação `next/font/local`, com os `.woff2` (OFL) versionados em `src/app/fonts/` e a licença ao lado. Motivo: build determinístico e sem rede (três compilações na CI mais o `docker build`); nenhuma requisição a terceiros em tempo de execução. Alternativa: `next/font/google`, mais simples, mas o build depende do acesso aos servidores de fontes. A escolha das famílias (ex.: uma serifada de título elegante e uma sem serifa legível em tamanhos pequenos) é do arquiteto, sem fontes associadas visualmente a AppBarber/AppBeleza.
- **D-3 — ponto de quebra**: 48 rem (768 px), um só para "móvel × computador". Em 375 px, menu móvel; em 1280 px, navegação lateral ou superior visível.
- **D-4 — "calendário"**: a escolha de data usa `<input type="date">` nativo em `Field` (acessível, com o seletor do sistema no celular). Não há componente de calendário próprio. Os limites da janela (antecedência e 60 dias) entram como `min`/`max` no consumidor (E4.1).
- **D-5 — caminho atual**: os layouts recebem o caminho atual por prop (o Server Component da página o conhece) ou usam `usePathname` no componente cliente da navegação. Para a vitrine e os testes, o caminho deve ser injetável (CA-14 usa `/painel/agenda/nova`). Recomendação: prop opcional, com `usePathname` como padrão.
- **D-6 — área do usuário e variantes do `PublicLayout`**: `PanelLayout` e `AdminLayout` aceitam um *slot* (`ReactNode`) para a área do usuário (nome e "Sair"), que a E1.2/E1.5 preenche; vazio por padrão. `PublicLayout` tem as variantes plataforma e salão (RN-12).
- **D-7 — links para rotas ainda inexistentes**: a navegação aponta para as rotas finais da v1, mesmo que respondam 404 até o consumidor existir. O E2E desta demanda não segue esses links.
- **D-8 — verificações por varredura de arquivos**: "sem cor literal" (CA-20) e "formatação só em `format.ts`" (CA-10) são testes unitários que leem os arquivos de `src/` com expressões regulares, não regras de ESLint. Motivo: o `eslint.config.mjs` exige blocos disjuntos para `no-restricted-imports`/`no-restricted-syntax` (`:23-26`, `:155-167`), e acrescentar seletores ao bloco existente de `no-restricted-syntax` mexe numa regra da D-007. Alternativa: `no-restricted-syntax` para `Intl.NumberFormat`/`toLocale*String`, mesclado ao bloco existente.
- **D-9 — critério objetivo de "sem rosa genérico"**: nenhum token de cor com matiz HSL em [290°, 360°) e saturação ≥ 20%. Terracota, caramelo, areia, argila, oliva e marrom ficam fora dessa faixa. O tester também faz uma revisão visual da vitrine. Se o arquiteto quiser um vermelho de erro com matiz entre 345° e 360°, ajuste a faixa no desenho, com justificativa.
- **D-10 — desabilitado focável**: o padrão é `disabled` nativo. `aria-disabled` só onde o consumidor precisar que o controle continue focável para explicar o motivo (ex.: um botão bloqueado por assinatura suspensa, E6.4). Nesse caso, o clique é bloqueado pelo componente.
- **D-11 — estilo do `/dev/mp-checkout`**: só a troca do formatador é obrigatória (CA-10). Migrar os estilos inline para os tokens é opcional. Se não migrar, a página fica fora do CA-20 (que só varre `src/components/**` e `src/app/dev/componentes/**`).
- **D-12 — foco inicial e backdrop do diálogo**: o foco inicial vai para "Cancelar" (ação segura, já que o diálogo confirma operações como cancelar reserva, encaixe e anonimizar), e clicar no backdrop não fecha (evita perder uma decisão por toque acidental no celular). Esc continua fechando (RN-2).
- **D-13 — moeda negativa**: recusada com `RangeError`. Nenhum valor da v1 é negativo (preços de serviço e assinatura; sem caixa nem estorno, `PLAN.md:131`). Se um consumidor precisar, ele define o formato (ex.: `-R$ 10,00`) numa demanda própria.
- **D-14 — onde fica o fuso padrão**: `FUSO_PADRAO` é exportado por `src/lib/format.ts` (ou por `src/config/`, se o arquiteto preferir agrupá-lo com outras configurações), e um teste confere que é igual ao `@default` de `salao.fuso` no `prisma/schema.prisma` (lendo o arquivo), para que os dois não divirjam.
- **D-15 — tipo da entrada de data**: só `Date`. O Prisma devolve `Date`, e os Server Components passam `Date` aos componentes cliente (o React serializa `Date`). Strings ISO são convertidas pelo chamador. Assim, strings sem deslocamento (ambíguas) não entram.
- **D-16 — tipo do papel**: `navegacao.ts` usa `import type { PapelDeSalao } from '@/server/tenant/context'` (só tipo, sem efeito no bundle do cliente), ou declara o mesmo tipo localmente com um teste de equivalência no estilo de `src/server/repos/tipos.ts:23`. A escolha é do arquiteto.
- **D-17 — JavaScript obrigatório para menu, diálogo e grade**: o menu móvel e o diálogo são componentes cliente. Sem JavaScript, a navegação recolhida não abre (aceitável na v1: público-alvo em navegador moderno). Alternativa sem JS: `<details>/<summary>`, com menos controle sobre o Esc e o foco.
- **D-18 — ordem e rótulos da navegação do gestor**: Agenda, Clientes, Serviços, Profissionais, Bloqueios, Configurações, Assinatura (uso diário primeiro, configuração depois). `/painel` (sem item próprio) fica como destino pós-login da E1.2, que decide se redireciona para `/painel/agenda`.
- **D-19 — escolha do layout na vitrine**: parâmetros de busca numa única `page.tsx` (`?layout=…&papel=…&caminho=…`), em vez de subpáginas. Motivo: a issue lista um único arquivo de página. Alternativa: subrotas `/dev/componentes/painel` etc., com a mesma regra de 404.
- **D-20 — `DataList` no celular**: a mesma `<table>` com CSS que empilha as células e mostra o rótulo da coluna (via `data-*` + `::before`, ou um elemento visível só no celular), mantendo a semântica de tabela. Alternativa: duas marcações (tabela e lista) com uma escondida por CSS, desde que a escondida fique fora da árvore de acessibilidade.
- **D-21 — `SlotGrid` com rádios e o rótulo de hora repetida**: `input type="radio"` nativos num `fieldset` (setas mudam a seleção; uma parada de Tab para o grupo inteiro, útil com dezenas de horários). Para a hora repetida, o sufixo é o deslocamento no formato `(UTC−03:00)`, com o sinal U+2212 ou `-`, a critério do arquiteto, e sempre consistente. Alternativa: `button` com `aria-pressed` (uma parada de Tab por horário).
- **D-22 — escopo do axe**: obrigatório (RN-23) e com zero violações nas etiquetas WCAG 2.0/2.1 A e AA. As boas práticas do axe (`best-practice`) ficam de fora para não acoplar o gate a regras não normativas. Se uma regra precisar ser excluída (ex.: falso positivo comprovado), o teste registra o motivo e o tester aprova.
- **D-23 — testes com outro `TZ`**: recomendação: um teste unitário que executa um processo filho do Node com `TZ` diferente e compara a saída (assim a CI cobre o caso). Alternativa: o tester roda o comando três vezes e registra a evidência em `testes.md`.
- **D-24 — `@testing-library/user-event`**: opcional. Se adotado, a versão é exata e fica em `devDependencies`, com a justificativa no `design.md`.
- **D-25 — sem biblioteca de estilo**: CSS global (tokens) mais CSS Modules (já suportado pelo Next, sem dependência nova). Não adotar Tailwind, biblioteca de componentes (Radix, shadcn, MUI) nem de ícones. Se precisar de ícones, eles ficam como SVG inline com `aria-hidden` e texto acessível ao lado.
