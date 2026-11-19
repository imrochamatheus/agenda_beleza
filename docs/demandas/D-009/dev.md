# D-009 — Desenvolvimento (T-1 a T-11)

Autor: desenvolvedor. Entradas: `issue-10.md`, `spec.md` (RN-1..RN-24, CA-1..CA-21) e `design.md` (D-1..D-25, §3, §8, §9). Branch `feat/d-009-base-visual` (base `main` 27d5c2b), Node 24.21.0, PostgreSQL 17 do compose. Nada foi commitado. DBA e DevOps foram dispensados pelo design. Nenhum arquivo de infraestrutura mudou (`Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `eslint.config.mjs`, `vitest.config.ts` e `next.config.ts` estão intactos).

## 1. Tarefas e arquivos

| Tarefa | Estado | Arquivos |
|---|---|---|
| T-1 | concluída | `src/lib/format.ts` (novo, sem nenhum `import`), `src/lib/format.test.ts`, `src/lib/format.fonte-unica.test.ts`, `src/app/dev/mp-checkout/page.tsx` (`formatarMoeda(dados.valorCentavos)`; estilos inline mantidos, D-11) |
| T-2 | concluída | `src/config/navegacao.ts` (único import de `@/server` é `import type`), `src/config/navegacao.test.ts` |
| T-3 | concluída | `src/app/globals.css`, `src/app/globals.test.ts`, `src/app/fontes.ts`, `src/app/fontes.test.ts`, `src/app/_fontes/{fraunces-latin-opsz-normal.woff2, source-sans-3-latin-wght-normal.woff2, OFL-Fraunces.txt, OFL-SourceSans3.txt}`, `src/app/layout.tsx`, `src/app/layout.test.tsx` |
| T-4 | concluída | `package.json`, `package-lock.json` (`@axe-core/playwright@4.14.0` e `axe-core@4.14.0` exatos, em `devDependencies`), `src/server/env.ts` (`VITRINE_COMPONENTES` no `esquemaEnv` e `vitrineHabilitada`; o `Env` não mudou), `src/server/env.test.ts`, `.env.example`, `playwright.config.ts` (`webServer.env`), `src/lib/dependencias-e2e.test.ts` |
| T-5 | concluída | `src/components/ui/{Button,Field,Select,Checkbox,Alert,EmptyState,ErrorState,DataList}.{tsx,module.css,test.tsx}`, `src/components/ui/campo.ts`, `campo.test.ts` |
| T-6 | concluída | `src/components/ui/{ConfirmDialog,SlotGrid}.{tsx,module.css,test.tsx}`, `tests/support/dialogo.ts` |
| T-7 | concluída | `src/components/layout/{Estrutura,PublicLayout,PanelLayout,AdminLayout,MenuNavegacao}.tsx`, `Layout.module.css`, `Layouts.test.tsx`, `MenuNavegacao.test.tsx` |
| T-8 | concluída | `src/app/dev/componentes/{page.tsx,Vitrine.tsx,opcoes.ts,Vitrine.module.css}`, `page.test.tsx`, `Vitrine.test.tsx`, `opcoes.test.ts` |
| T-9 | concluída | `src/components/conformidade.test.ts` |
| T-10 | concluída | `e2e/a11y-base.spec.ts`, `e2e/suporte/vitrine.ts` |
| T-11 | concluída, exceto o `CLAUDE.md` (P-1) e a CI do PR (P-2) | `README.md` (comando do E2E de acessibilidade em "Testes" e seção nova "Interface e acessibilidade"); este `dev.md` |

## 2. Gates (comandos e resultados, máquina local)

| Comando | Resultado |
|---|---|
| `npm ci` + `npm run db:generate` | ok, `found 0 vulnerabilities`, sem aviso novo de `allowScripts` (axe sem script de instalação) |
| `npm run lint` | ok, 0 avisos (inclui `jsx-a11y`) |
| `npm run typecheck` | ok (inclui o `satisfies Record<PapelDeSalao, …>` exaustivo) |
| `npm run build` | ok; lista `ƒ /dev/componentes`. Também ok **sem `.env`** e com `env -u DATABASE_URL -u VITRINE_COMPONENTES`. As fontes saem em `.next/static/media/*.woff2`, sem `googleapis`/`gstatic` |
| `npm test` | `Test Files 114 passed (114)`, `Tests 1513 passed (1513)` |
| `npm run test:coverage` | rc=0; **linhas 99,92% (1286/1287)**; statements 99,1%, branches 97,74%, funções 99,45%. Arquivos novos com 100% de linhas, exceto `Vitrine.tsx` (97,14%). Nenhuma exclusão nova |
| `npm run test:e2e` | `25 passed (9.4s)` (24 do `a11y-base` + `smoke`); 14 s com o build |
| `npx playwright test e2e/a11y-base.spec.ts --repeat-each=3` | `72 passed (26.4s)` |
| `TZ=Asia/Tokyo npx vitest run src/lib/format.test.ts` | `Tests 53 passed (53)`, o arquivo inteiro (o próprio arquivo também troca o `TZ` no processo, D-23) |
| `npx vitest run --project integration tests/integration/integracoes/checkout.test.ts` | `Tests 17 passed` (`R$ 79,00` do `mp-checkout`, CA-10) |
| `grep -n "Intl\|/ 100" src/app/dev/mp-checkout/page.tsx` | vazio |
| `grep -E '"(@axe-core/playwright\|axe-core)": "[\^~]' package.json` | vazio. Lock: só `node_modules/@axe-core/playwright` e `node_modules/axe-core`, os dois em 4.14.0 |
| `grep -n 'href="/' src/components/layout`; `cookies\|headers()\|process.env` em layouts | vazios |
| `next start` **sem** `VITRINE_COMPONENTES` → `curl …/dev/componentes` e `?layout=painel` | `404 404` |
| `VITRINE_COMPONENTES=true next start` → `curl …/dev/componentes` e `?layout=x` | `200 200`, `<meta name="robots" content="noindex, nofollow"/>` |

Mutações conferidas (todas restauradas depois):
- T-6 (unitário): sem o `preventDefault` do Tab → 1 falha; sem o `emAndamento` → 2; sem o foco no `dialog` durante a espera → 1; sem o `preventDefault` do Esc → 2.
- T-6 (E2E): sem a trava de Tab → `CA-4 … ciclo de foco` falha em "Tab #1".
- T-9: `color: #fff`, `@media (min-width: 600px)` e `outline: none` num `.module.css` → 1 falha cada.
- Nenhum `setTimeout` na lógica do diálogo. A única espera é a promessa de 1,5 s da vitrine.

Tempo do job `e2e` na CI: **não medido** (sem PR; P-2). Localmente, o arquivo leva cerca de 9 s com 7 workers, longe do gatilho de 10 min do DevOps.

## 3. Testes e CAs

| CA | Testes |
|---|---|
| CA-1, CA-2, CA-5..CA-8 | `src/lib/format.test.ts` (NBSP explícito e `!==` com U+0020; fuso omitido; valores do CA-5, inclusive `MAX_SAFE_INTEGER`; recusas `RangeError`/`TypeError`; virada de dia e de ano; Manaus, Noronha, UTC e Rio Branco; horário de verão de 2018/2019) |
| CA-9 | `format.test.ts`: `vi.stubEnv('TZ')` com `UTC`, `America/Fortaleza` e `Asia/Tokyo`, com autoverificação do `getTimezoneOffset` (0/180/−540); `Date` inválido; fuso inexistente ou vazio nas 4 funções (com `cause`); regex `dd/mm/aaaa HH:mm` em 240 combinações |
| D-14, D-21 | `format.test.ts` (lê `prisma/schema.prisma`; `UTC−02:00`/`UTC−03:00`/`UTC+00:00`/`UTC+05:30`) |
| CA-10 | `format.fonte-unica.test.ts` (sem `toLocale*`/`Intl.NumberFormat` em `src/`, nem `Intl.DateTimeFormat` em app, components, lib e config; o `mp-checkout` usa `formatarMoeda(dados.valorCentavos)`) + `checkout.test.ts` existente |
| CA-11 | `navegacao.test.ts` (7/2/3 itens na ordem, `href` em `ROTAS` com o prefixo e sem repetição, termos vetados, `itensDoPainel` falha fechada, chaves = `PAPEIS_DE_SALAO`) + `Layouts.test.tsx` (profissional sem os 5 links; `super_admin`/`toString`/`undefined`/`x` → nenhum item, sem lançar) |
| CA-12 | `navegacao.test.ts` (codificação `a b/c` em 5 rotas; `SEGMENTOS_RESERVADOS` recalculado; pastas de `src/app` fora de `(…)`, `[…]` e `_…` estão no conjunto) |
| RN-14 | `navegacao.test.ts` (`itemAtivo`) + `MenuNavegacao.test.tsx` + E2E `CA-14: item ativo…` |
| CA-13 | `globals.test.ts` (todos os pares da §3.1 pela fórmula WCAG, `#rrggbb`, matiz/saturação, sem cor fora do `:root`, tokens de espaço, foco, alvo, `color-scheme`, `prefers-reduced-motion`) + `color-contrast` do axe no E2E |
| CA-15 | `dependencias-e2e.test.ts` + axe nas 5 variantes (375 e 1280 px), com o menu aberto (3 variantes) e com cada diálogo aberto (4 variantes + diálogo com erro) |
| CA-3 | `MenuNavegacao.test.tsx` (jsdom) + E2E `CA-3` × 3 (gestor 7, profissional 2, admin 3; Tab até "Menu", Enter, foco no 1º item, Tab sai sem fechar, Esc devolve o foco, Espaço abre) |
| CA-4 | `ConfirmDialog.test.tsx` (com o dublê) + E2E `CA-4` (passos 1 a 6 só por teclado, clique no fundo fora do retângulo do diálogo; R-1: 3 Esc durante a confirmação demorada; diálogo que falha) |
| CA-14 | E2E `CA-14/CA-15` × 5 (320/375/1280 sem rolagem; menu oculto e itens visíveis em 1280; 1º Tab = "Pular" visível → `main` focado; percurso por Tab com contorno ≥ 2 px e todos os interativos alcançados), `CA-14: item ativo`, `CA-14: alvos ≥ 44 × 44`, `RN-6: texto a 200%`, `RN-7: movimento reduzido` |
| CA-16 | E2E `CA-16` (SlotGrid por setas e Tab, grade vazia; Field com erro e `toHaveAccessibleDescription`; Checkbox por Espaço e rótulo; DataList empilhado em 375 e tabela em 1280) |
| CA-17 | `src/components/ui/*.test.tsx`, `campo.test.ts`, `src/components/layout/*.test.tsx` |
| CA-18 | `env.test.ts` (`vitrineHabilitada` e `validarEnv` recusando `TRUE`/`1`/`sim`/`yes`; `.env.example`), `page.test.tsx` (`production` com ausente/vazia/`false`/`1`/`TRUE` → digest `NEXT_HTTP_ERROR_FALLBACK;404` **sem ler** `searchParams`; `true` e `development` renderizam; `dynamic` e `robots`), E2E `CA-18` (200 + `noindex, nofollow`) e o `curl` 404/200 acima. O compose → 404 é do tester (T-12) |
| CA-19 | `layout.test.tsx` (classes `variable`, `lang`, `title`, `description` e import do `globals.css`), `fontes.test.ts` (opções, `wOF2`, sha256, OFL), E2E `CA-19` (família do `h1`/`p` = 1º nome de `--fonte-titulo`/`--fonte-corpo`, fontes com `status === 'loaded'`) e `smoke.spec.ts` |
| CA-20 | `conformidade.test.ts` (cor literal por hex, função ou 148 nomes; `@media` só `(min-width: 48rem)`; sem `outline: none\|0`; `globals.css` com cor só no `:root`; sem `dangerouslySetInnerHTML`; sem import de `@/server` em tempo de execução, salvo `vitrineHabilitada` na página; sem `tabIndex` positivo) |
| CA-21 | §2 (CI pendente: P-2) |

## 4. Desvios do design e decisões de implementação

- **D-A (lock do `axe-core`):** o lock **já tinha** `axe-core@4.14.1` como transitiva do `eslint-plugin-jsx-a11y` (`^4.x`), o que a §0 do design não registrou. A instalação exata trocou a cópia única para 4.14.0, que o `jsx-a11y` aceita. O lint continua verde.
- **D-B (`campo.ts`):** além de `idsDoCampo`/`descritoPor`, `descritoPor` aceita um 4º argumento (o `aria-describedby` do consumidor, que é juntado no fim), e há um auxiliar `classes(...)`. `Field.tsx` exporta `ErroDoCampo`, `AjudaDoCampo`, `TextoDoRotulo` e `temConteudo`, reutilizados por `Select`/`Checkbox`. Os três compartilham `Field.module.css`. `Select.module.css` e `Checkbox.module.css` ficam só com o que é próprio.
- **D-C (`EmptyState` embutido):** o vazio padrão de `DataList` e `SlotGrid` usa `nivelTitulo={3}`, para não criar um `h2` dentro de uma seção que já tem `h2`. O design não fixava o nível.
- **D-D (`ConfirmDialog`):**
  - uma exceção síncrona de `onConfirmar` é tratada como rejeição (alerta genérico, foco no confirmar);
  - um 2º pedido de fechamento é barrado por *ref* (`fechando`);
  - uma Promise que termine depois de o pai fechar não pede outro fechamento nem mostra erro;
  - o "último recurso: body" é feito com `blur()` do elemento ativo, porque `body.focus()` não tira o foco de um botão no jsdom;
  - o estado de erro/ocupado é zerado a cada abertura por ajuste de estado na renderização (sem `setState` em efeito).
- **D-E (`MenuNavegacao`):** sem itens (papel inválido), não renderiza nada (nem o botão "Menu" nem uma `nav` vazia). O teste do menu usa `vi.mock('next/navigation')` só para simular a troca de rota que fecha o menu. Os testes dos layouts usam o `usePathname` real (`null` no jsdom).
- **D-F (`SlotGrid`):** `montarHorarios` exportado (testado direto). O vazio substitui o `fieldset` inteiro (sem legenda), como no design.
- **D-G (vitrine):** a 1ª grade é controlada e mostra "Horário escolhido: dd/mm/aaaa HH:mm" (`data-testid="horario-escolhido"`). O "Tentar novamente" tem o contador `data-testid="contador-tentativas"`. `ESPERA_DEMORADA_MS` é exportado para o teste com relógio falso.
- **D-H (E2E):**
  - o passo 6 do CA-4 clica num controle do fundo cujo centro fica **fora do retângulo do diálogo**: em 375 px, o diálogo cobre os botões da seção de diálogos, e `elementFromPoint` sobre o backdrop devolve o próprio `<dialog>`;
  - o percurso por Tab dá a volta pelo fim do documento, porque o ponto de partida do Tab fica no `main` depois do link de pular;
  - o limiar de sanidade é de mais de 25 interativos por variante (medidos: 28 a 29);
  - no `ErrorState.test.tsx`, os links de exemplo usam `/termos` em vez de `/`, porque `@next/next/no-html-link-for-pages` acusa `<a href="/">` literal.
- **D-I (`CLAUDE.md` não editado):** ver P-1.

## 5. Pendências e riscos

- **P-1 (`CLAUDE.md`):** não editei o `CLAUDE.md`. Uma mensagem de agente não autoriza mudar esse arquivo (mesmo procedimento da D-008). Texto proposto para o líder aplicar com autorização do usuário:
  - "Project status", depois da frase da D-008: `D-009 (E0.8) added the visual and navigation base: theme tokens in `src/app/globals.css` (colors only there; single breakpoint `@media (min-width: 48rem)`), local fonts (Fraunces and Source Sans 3, OFL, in `src/app/_fontes/` via `next/font/local`), display formatters in `src/lib/format.ts` (the only place allowed to format currency/dates, enforced by tests), routes and role navigation in `src/config/navegacao.ts` (incl. `SEGMENTOS_RESERVADOS`), UI components in `src/components/ui/` and layouts in `src/components/layout/` (role by prop), and the `/dev/componentes` showcase (404 unless `VITRINE_COMPONENTES=true` or `next dev`).`
  - Tabela "Comandos e cobertura", linha nova: `| E2E de acessibilidade (D-009) | \`npx playwright test e2e/a11y-base.spec.ts\` | exige build prévio e porta 3000 livre; o \`webServer\` liga \`VITRINE_COMPONENTES=true\`; axe 4.14.0 fixado, zero violações |`.
- **P-2:** os seis jobs da CI e o tempo do job `e2e` só podem ser conferidos no PR, que é do líder.
- **R-a (processos órfãos):** encerrar o `npx next start` (ou o `npm run start`) com `kill` pode deixar o `next-server` na porta 3000. O `reuseExistingServer` local o reaproveitaria. Se ele não tiver a variável, o E2E falha com a mensagem do CA-18. Confira `ss -ltnp | grep :3000` antes do E2E.
- **R-b (Safari, R-4):** a limitação do `DataList` está documentada no README. O E2E é só Chromium.
- **R-c:** a revisão visual (320/375/1280 px, R-12), o uso só com teclado num navegador real e o compose → 404 ficam com o tester (T-12).
- Sem TODO no código.

## 6. Rodada 2: correção do DEF-1 e do DEF-2 (`testes.md`, veredito APROVADO com 2 defeitos baixos)

### Arquivos
- `README.md` (DEF-1): `mkdir -p fraunces sourcesans` antes dos `tar`, e o `sha256sum` restrito aos dois arquivos usados.
- `src/app/dev/componentes/page.tsx` (DEF-2): a `metadata` estática virou `generateMetadata()`, que devolve o título e `robots` só quando `vitrineHabilitada(process.env)`. Desligada, devolve `{}`.
- `src/app/dev/mp-checkout/page.tsx` (DEF-2): o mesmo padrão, condicionado a `modoSelecionado(process.env, 'MP_ADAPTER') === 'simulado'`, que é a mesma condição do `carregarCheckoutSimulado`.
- `src/app/dev/componentes/page.test.tsx`: metadados com a vitrine habilitada (`true` e `development`) e `{}` com ausente, vazia, `false`, `1` e `TRUE`.
- `src/app/dev/mp-checkout/page.test.ts` (novo, unitário, sem banco): `simulado`/ausente/vazio → título e `robots`; `real`/`x` → `{}`.
- `tests/integration/integracoes/checkout.test.ts`: importava a `metadata` estática que deixou de existir. Agora confere `generateMetadata().robots` no modo simulado. Esse arquivo é da D-007 e foi alterado por consequência direta do DEF-2.

### Evidências
- **DEF-1:** o bloco do README, extraído do próprio arquivo e executado com `bash -e` numa pasta vazia do rascunho, termina com rc=0 e imprime os dois sha256 esperados (`7234ed86…e0d783` e `19143dca…60c7d5`).
- **DEF-2, sem a variável** (`next start` com `VITRINE_COMPONENTES` ausente e `MP_ADAPTER=real`):
  - `GET /dev/componentes` → 404, com 0 ocorrências de "Vitrine";
  - `GET /dev/mp-checkout?assinatura=x` → 404, com 0 ocorrências de "Checkout simulado";
  - uma rota inexistente também tem 0 ocorrências.
- **DEF-2, com a variável** (`VITRINE_COMPONENTES=true`, `MP_ADAPTER=simulado`): `GET /dev/componentes` → 200, com `<title>Vitrine de componentes · Agenda Beleza</title>` e `<meta name="robots" content="noindex, nofollow"/>`.
- **Observação O-R2:** com `generateMetadata`, o `<title>` do documento no 404 dessas duas rotas passa a ser "Agenda Beleza" (do layout raiz). Numa rota inexistente, o Next ainda acrescenta `<title>404: This page could not be found.</title>`. O corpo de "não encontrado" (o texto "This page could not be found.") e o status 404 continuam iguais.
  - Testei chamar `notFound()` dentro do `generateMetadata`. O resultado foi o mesmo, então mantive a forma `{}` pedida.
  - Nada da vitrine nem do checkout aparece.
  - Também fica registrado: no modo simulado, um ID inválido ainda dá 404 com o título do checkout. É a condição pedida, e a rota só existe em desenvolvimento.

### Gates da rodada 2
| Comando | Resultado |
|---|---|
| `npm run lint` | ok |
| `npm run typecheck` | ok |
| `npm run build` | ok (`ƒ /dev/componentes`) |
| `npm run test:coverage` | rc=0; `Test Files 115 passed`, `Tests 1524 passed`; **linhas 99,92% (1288/1289)**; branches 97,75% |
| `npx vitest run --project integration tests/integration/integracoes/checkout.test.ts` | `Tests 17 passed` |
| `npm run test:e2e` | `25 passed (10.0s)` |
