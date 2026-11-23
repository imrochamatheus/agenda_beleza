# D-051 (E4.1b, issue #113): registro do desenvolvedor

Data: 23/11/2026. Branch `feat/d-051-dia-horario-mesma-pagina`. Executei T-1..T-8 em sequência, como único dono dos
arquivos da rodada. Não fiz commit.

## Tarefas e arquivos

### T-1: formatadores curtos
- `src/lib/format.ts`: entraram `formatarDiaDaSemanaCurto` (tabela fixa "Dom".."Sáb", com `RangeError` fora de 0..6) e
  `formatarDiaEMesCurtos` (reusa a validação de `formatarDataCivil`; dia sem zero à esquerda, mês curto minúsculo).
- `src/lib/format.test.ts`: cobre os 7 dias, os 12 meses, o dia sem zero e as chaves inválidas (`2026-02-30`, `x`,
  `2026-13-01`, vazio, `01/12/2026`).

### T-2: componente `FaixaDeDias` e vitrine de componentes
- `src/components/ui/FaixaDeDias.tsx`, `.module.css` e `.test.tsx` (novos). A anatomia segue o web-design §4.1. Pontos
  do componente:
  - `<ol>` com `aria-labelledby` (título + período); `<a>` para dia com horário e `<span>` para dia sem horário.
  - `aria-current="date"` no dia marcado, inclusive quando ele é um `<span>`.
  - `<nav>` presente só quando há anterior ou próxima.
  - Regra C2: quando nenhum dia é link, o invólucro com rolagem recebe `tabIndex=0`, `role=group` e `aria-labelledby`.
  - CSS só com tokens e um único `@media (min-width: 48rem)`. O foco é interno (contorno com `outline-offset`
    negativo); no dia selecionado, o contorno usa `--cor-sobre-primaria`.
- `src/app/dev/componentes/Vitrine.tsx` e `Vitrine.test.tsx`: nova seção "Régua da semana" com 4 exemplos (dia
  selecionado, semana toda sem horário, última semana com 5 dias, marcado sem horário).

### T-3: servidor do fluxo público
- `src/server/reserva-publica/passos.ts`:
  - Entram `DIAS_POR_SEMANA` (no lugar de `DIAS_POR_PAGINA`), `ANCORA_RESERVA`, `Janela`, `inicioDaSemana`,
    `limitesDaSemana`, `hrefDoDia` e `hrefDaSemana`.
  - `hrefOutroDia` ganha `#reservar`.
  - Em `PassoLido`, a variante `'data'` sai e entra `'dia'` (`{ s, semana }`).
- `src/server/reserva-publica/tipos.ts`:
  - Entram `DiaDaFaixa` e `FaixaDaSemana`.
  - Em `VisaoDoPasso`, entra a variante `'dia'`, e a variante `'servico'` ganha `faixa`.
  - `MENSAGENS_PASSO` recebe os textos exatos do web-design §4.3 e §6.
- `src/server/reserva-publica/pagina.ts`:
  - Entram `diasDaFaixa` (DA-2 extraída, sem mudança de regra) e `carregarFaixa` (uma chamada sobre ≤ 7 datas, sem
    `escolhidos`).
  - Passos: `'dia'` = 1 chamada; serviço 0 = chamada da D-050 seguida da régua; dados com o item 0 caído = chamada da
    D-050 seguida da régua.
  - As chamadas são sequenciais. `carregarPassoComLimite` não mudou (só o comentário).
- `src/server/reserva-publica/passos.test.ts`:
  - RN-12 inteira (9 linhas, incluindo a de data inválida).
  - Semanas: janela 60 (9ª semana com 5 dias), janela 1 e janela 7, `de` antes de hoje e além da última data, virada
    de ano.
  - Ida e volta de `hrefDaSemana`/`hrefDoDia`, "Escolher outro dia" (CA-10) e chaves dos `href` só em `s|data|de`
    (CA-16).
- `src/server/reserva-publica/tipos.test.ts`: textos exatos.

### T-4: UI da página pública
- `src/app/(publico)/[slug]/_componentes/faixa.ts` (novo, puro): `ID_TITULO_FAIXA`, `rotuloDoDia` (movido de
  `Passos.tsx`, que o reexporta para `FormularioDados`), `propsDaFaixa` (sufixos ", hoje" e ", sem horários" nessa
  ordem) e `estadoSemDia`. O teste `faixa.test.ts` também é novo.
- `Passos.tsx`:
  - Sai `PassoData`.
  - Entram `CabecalhoDoPasso` (indicador, `h2#reservar`, detalhe e aviso), `ResumoEFaixa` e `PassoDia` (`<section>`
    sem `<form>`, D6).
  - `PassoServico` com `faixa` mostra o resumo e a régua, depois `<div class="horarios">` com o conteúdo da D-050. Nesse
    caso não há "Escolher outro dia".
  - Com `faixa === null`, o passo fica igual ao da D-050.
- `PaginaDoSalao.tsx`: `case "data"` vira `case "dia"`.
- `Salao.module.css`:
  - Saem `.dias` e `.dia` (inclusive no `@media`).
  - Entram `.faixaNoCartao`, `.horarios` e `scroll-margin-block-start` em `.indicador + h2`.
- `PaginaDoSalao.test.tsx`:
  - O teste do passo `data` vira dois testes do passo `dia` (CA-1, CA-2, CA-4, CA-12 e o aviso antes da régua).
  - Entram o serviço 0 com dia (CA-5, CA-11: ordem no DOM; CA-7: href sem `h*`) e o "marcado sem horário" (C5).
  - No passo k ≥ 1, confere que não há régua e que "Escolher outro dia" tem âncora.

### T-5: vitrine `/dev/reserva`
- `dados.ts`:
  - Entra `faixaDemo`, que usa `limitesDaSemana` real e a mesma DA-2 sem itens.
  - Passo `'dia'`; `faixa` no serviço 0 e no recuo dos dados.
  - Entra `visaoDaSemanaVazia`.
- `page.tsx`: entra `?vista=semana-vazia` e o comentário do cabeçalho foi atualizado.
- `dados.test.ts` e `page.test.tsx`: cobrem as 3 vistas do CA-17 e a última semana (`de` = hoje + 60 → 5 dias).

### T-6: testes de integração
- `tests/integration/reserva-publica/faixa.test.ts` (novo):
  - CA-14: contagens exatas na matriz 1/3/10 serviços × 1/8 profissionais × com e sem itens. Valores: `'dia'` = 6,
    semana navegada = 6, serviço 0 = 12 (com e sem `alterar=0`), serviço k ≥ 1 = 6, dados = 6, dados com o item 0
    caído = 12 e com o item k ≥ 1 caído = 6.
  - Uma cota por carregamento nos 4 formatos; limitado = 1 comando.
  - CA-12: semana bloqueada inteira = 6 instruções, sem salto.
  - CA-8: as linhas da RN-12 em `carregarPasso`.
  - Fluxo pela régua: CA-5, CA-7, CA-9, CA-10 e CA-11 (`sem_selecao`).
  - CA-15: `America/Manaus` e `America/Noronha`, 5 min antes e 5 min depois da meia-noite local.
  - Isolamento: a vaga ocupada no salão A não afeta a régua do B; `s` de outro salão volta aos serviços.
- `passos.test.ts`: o teste DA-2 migrou para `'dia'` com 7 dias (semana 0, semana 1, `de` no meio da semana, a 8ª e a
  9ª semana). As demais asserções da D-050 ficaram iguais.
- `fluxo-itens.test.ts`: a navegação até o dia passa pela régua (semana 0, "Próxima semana", link do dia). O restante
  ficou igual.
- `tests/integration/protecao/pagina-limite.test.ts`:
  - Novo caso: `'dia'` e semana navegada consomem uma cota cada, e limitado = 1 comando.
  - O HTML limitado não tem "Escolha o dia".

### T-7: E2E
- `e2e/suporte/publico.ts`:
  - Entram `reguaDaSemana` e `linkDoDia` (lista `/^Escolha o dia/`, nome que contém `dd/mm/aaaa`).
  - Entra `irParaSemanaDoDia(page, iso, { teclado? })`, que avança por "Próxima semana" até 10 vezes e falha se o dia
    aparece sem horários (R-3).
  - `escolherDia` usa o helper e confere `aria-current`.
- Specs adaptados só na navegação até o dia (CA-18): `publico-reserva-teclado`, `reserva-publica` (também a URL
  malformada, que agora cai no passo 0 sem dia) e `tester-d050`. `publico-reserva`, `publico-conflito-captcha` e
  `reserva-publica-sem-js` passaram sem mudança, porque usam `escolherDia`.
- `e2e/reserva-publica-faixa.spec.ts` (novo, vitrine): critérios visuais 1–19 do §9, em 375, 320, 768 e 1280 px, sem
  JS e com axe nos 3 estados. Cobre também CA-3, CA-4, CA-7, CA-10, CA-11, CA-12, CA-13 (b, c, d) e CA-17.
- `e2e/publico-faixa-dias.spec.ts` (novo, banco, `/e2e-reservas-5`, só leitura):
  - Cobre CA-5, CA-6, CA-7, CA-9, CA-10, CA-13 (d) e CA-16 (varredura das URLs visitadas).
  - CA-8: as linhas da RN-12 com HTTP 200; `de` no meio da semana mostra o mesmo período da semana inteira.

### T-8: documentação
- `CLAUDE.md`: entra o parágrafo D-051 no "Project status" e duas linhas na tabela (laço de fuso e laço de
  estabilidade da régua). O README não descreve o passo `data` e por isso não mudou.

## Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` | verde (0 avisos) |
| `npm run typecheck` | verde |
| `npm run test:coverage` (1ª rodada) | 1 falha fora da demanda: `tests/integration/auditoria/auditoria.test.ts` CA-8 (ordem de duas linhas de auditoria no mesmo `emTransacao`; `linhasDeAuditoria` ordena por `ocorrido_em, id` e o `id` é aleatório). Rodei o arquivo isolado 5× e passou nas 5. É instabilidade preexistente (D-033), não tocada aqui |
| `npm run test:coverage` (2ª rodada) | **604 arquivos e 7350 testes verdes; linhas 99,04%** (stmts 98,4%, branches 96,34%, funcs 99,32%) |
| `npm run test:e2e` (build + preparar banco + Playwright, porta 3000 livre, uma execução) | `next build` compilou; 385 passaram e 2 falharam, ambos nos specs novos, por asserção errada do teste: filtrei as paradas do roteiro por "a escolher", mas toda parada sem hora tem o texto oculto "horário a escolher". Corrigi para filtrar por `data-estado` |
| `npx playwright test e2e/publico-faixa-dias.spec.ts e2e/reserva-publica-faixa.spec.ts` (mesmo build) | 13/13 verdes |
| `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/reserva-publica "src/app/(publico)/[slug]/_componentes/faixa.test.ts" src/lib/format.test.ts \|\| break; done` | 226/226 nos dois fusos |
| laço ×10 de `tests/integration/reserva-publica/{concorrencia,faixa,passos}.test.ts` e `tests/integration/protecao/pagina-limite.test.ts` | 10/10 rodadas verdes (38 testes cada) |
| `npx vitest run --project integration tests/integration/reserva-publica tests/integration/protecao` | 14 arquivos, 137 testes verdes |

## Testes por CA

| CA | Testes |
|---|---|
| CA-1 | `PaginaDoSalao.test.tsx` (dia), `faixa.test.ts` (unit), `reserva-publica-faixa.spec.ts` (passo 0 sem dia), `publico-faixa-dias.spec.ts` |
| CA-2 | `FaixaDeDias.test.tsx`, `PaginaDoSalao.test.tsx`, integração `passos.test.ts` (DA-2), E2E vitrine (span fora do Tab) |
| CA-3 | `passos.test.ts` (unit: semanas), `dados.test.ts`, E2E vitrine (CA-3) |
| CA-4 | `PaginaDoSalao.test.tsx`, E2E vitrine e banco |
| CA-5 | `passos.test.ts` (`hrefDoDia`), integração `faixa.test.ts` (fluxo), E2E banco |
| CA-6 | `fluxo-itens.test.ts`, `PaginaDoSalao.test.tsx` (k ≥ 1), E2E banco, `publico-reserva.spec.ts` |
| CA-7 | `faixa.test.ts` (unit, hrefs), `PaginaDoSalao.test.tsx`, integração (troca de dia), E2E vitrine e banco |
| CA-8 | `passos.test.ts` (tabela RN-12), integração `faixa.test.ts`, E2E banco (HTTP 200) |
| CA-9 | integração `faixa.test.ts`, E2E banco |
| CA-10 | `passos.test.ts` (unit), integração, E2E vitrine e banco |
| CA-11 | `PaginaDoSalao.test.tsx` (aviso antes da régua), integração (`sem_selecao` e item 0 caído), E2E vitrine; o caminho da alternativa do `FormularioDados` (D-036 DEF-1) segue em `publico-conflito-captcha.spec.ts`, verde |
| CA-12 | `faixa.test.ts` (unit: `estadoSemDia`), `PaginaDoSalao.test.tsx`, integração (6 instruções), E2E `?vista=semana-vazia` com axe |
| CA-13 | (a) `reserva-publica-sem-js.spec.ts` (vitrine) e o cenário sem JS de `publico-reserva.spec.ts` (banco), ambos verdes com a régua; (b) teclado nos 3 specs adaptados e na ordem de Tab do spec novo; (c) 375×812 `isMobile`/`hasTouch` e 320 px; (d) axe nos 3 estados |
| CA-14 | integração `faixa.test.ts` e `pagina-limite.test.ts` |
| CA-15 | unit em dois `TZ`; integração com Manaus e Noronha |
| CA-16 | `passos.test.ts`, `faixa.test.ts` (unit), E2E banco (varredura das URLs) |
| CA-17 | `dados.test.ts`, `page.test.tsx`, `Vitrine.test.tsx`, E2E vitrine |
| CA-18 | suíte inteira verde (unit, integração e E2E) |

## Desvios do desenho

1. **Sangria da régua (C1) por variável CSS.** O desenho põe a margem negativa no invólucro externo. Isso levaria
   junto o título, o período, as semanas e o apoio, que pelo web-design §5.2 ficam no padding do cartão. Por isso
   `.faixaNoCartao` só define `--faixa-sangria: calc(-1 * var(--espaco-4))` (0 a partir de 48rem), e o componente
   aplica `margin-inline: var(--faixa-sangria, 0)` apenas no invólucro da régua. O resultado é o mesmo do desenho
   (`className` no invólucro externo, sangria pelo contexto, vitrine sem sangria), mas só a régua sangra.
2. **`FormularioDados.test.tsx` alterado.** O desenho diz que ele "segue verde sem alteração", mas a D4 põe `#reservar`
   em `hrefOutroDia`, e esse teste comparava o href exato do "Escolher outro dia" da reescolha. Só acrescentei
   `#reservar` ao valor esperado: o teste não foi enfraquecido. `FormularioDados.tsx`, `formulario.ts`,
   `reescolha.ts`, `acoes.ts` e `page.tsx` da rota não foram tocados.
3. **O spec de banco não grava reserva.** Os 8 salões `e2e-reservas-N` já estão em uso e criar um 9º exigiria mexer no
   `prisma/seed`, que está fora da minha posse. Por isso `publico-faixa-dias.spec.ts` só navega por GET, em
   `/e2e-reservas-5`, cujo spec só cria reservas concluídas no passado. O fluxo completo até a confirmação sem JS
   (CA-13 a) fica coberto por `publico-reserva.spec.ts` (banco, cenário sem JS) e por `reserva-publica-sem-js.spec.ts`
   (vitrine), que agora passam pela régua.
4. **Helper `ResumoEFaixa`.** Ele foi extraído em `Passos.tsx` para não repetir o resumo e a régua entre `PassoDia` e
   `PassoServico`. Não muda nenhuma interface.

## Riscos e pendências
- Os riscos R-1..R-8 do desenho ficam como estão; R-3 está mitigado pelo `irParaSemanaDoDia`.
- Instabilidade **preexistente** fora da demanda: `tests/integration/auditoria/auditoria.test.ts` > "CA-8: retirar
  seguido de restaurar". `linhasDeAuditoria` ordena por `ocorrido_em, id`; quando as duas linhas têm o mesmo
  `ocorrido_em`, o desempate pelo UUID aleatório troca a ordem. Falhou 1 vez em 1 rodada sob carga. Sugiro abrir uma
  demanda curta (ordenar por uma coluna sequencial ou usar `clock_timestamp()`).
- `AGENTS.md`, que não é rastreado, não foi tocado.
