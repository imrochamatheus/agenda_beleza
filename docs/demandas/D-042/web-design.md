# D-042 (E6.5) Assinatura no painel — web-design

Fonte: `spec.md` (RN-1..12, CA-1..15, tabela §5). Autor: web-designer. Não altera código.

## 0. Evidências e limites do exame
- Lido: `src/app/painel/assinatura/{page.tsx,Resumo.tsx,Assinatura.module.css,FormularioAssinar.tsx,plano.ts}`, `src/app/dev/assinatura/page.tsx`, `src/components/layout/FaixaDoPlano.tsx`, `src/components/ui/{Alert,DataList,Button}.tsx`, `src/app/globals.css` (:root, linhas 14-72), `src/lib/format.ts`.
- Capturas 375/768/1280: NÃO feitas (diagnóstico baseado no código; a porta 3000 pertence ao usuário). O desenvolvedor deve capturar `/dev/assinatura` em 375, 768 e 1280 px na revisão.
- Razões de contraste calculadas (WCAG) com os valores do :root.

## 1. Diagnóstico
1. **Hierarquia inexistente.** `Resumo.tsx:9-15` mostra `h1` + um único `Alert info` com o rótulo da situação. O estado (a decisão principal) tem o mesmo peso de um aviso qualquer; "Informação:" é prefixo de ruído para algo que é o conteúdo central.
2. **Alert usado como título.** `Alert variante="info" titulo={situacao}` com `detalhe` vazio (`page.tsx:38`) renderiza "Informação: Em teste" e um bloco de texto vazio (`Alert.tsx:32`). Não informa data, valor ou próximo passo.
3. **Informação ausente.** Nenhuma data (`teste_fim_em`, `periodo_pago_ate`, `carencia_ate`, `acesso_ate`), nenhum valor, nenhum histórico, nenhuma ação além de "Assinar" (`page.tsx:30`).
4. **Ação sem contexto.** `FormularioAssinar.tsx:23` coloca um parágrafo longo ("R$ 79,00 por mês, com 30 dias de teste a partir da autorização no provedor de pagamento.") acima do botão, sem destacar o valor.
5. **Tipografia sem escala.** A tela só usa `h1` global; não há título de seção (`h2`), nem número/data em destaque. Fraunces (títulos) não é usada para o estado.
6. **Vitrine insuficiente.** `/dev/assinatura` só cobre `sem_assinatura`, `pendente` e `em_teste` (`page.tsx:30`); faltam os 9 estados e o histórico.
7. **Largura.** `.pagina {max-width: 40rem}` serve a texto, mas o histórico (tabela) e as datas precisam do mesmo eixo de leitura: manter 40rem para tudo (uma coluna só) evita rolagem horizontal em 375 px e mantém coerência com `/painel/profissionais`.

## 2. Direção visual
**Conceito: "extrato de conta", não "painel de métricas".** Uma coluna de leitura (40rem) em que o estado é uma frase em Fraunces, a data decisiva vem logo abaixo em corpo grande, os dados de apoio ficam em lista de definição sem moldura, e as ações ficam juntas, depois dos dados. Hierarquia por tipografia, espaço e uma única superfície de realce (a "frase de estado"), sem cartões repetidos, ícones ou gradientes. A gestora decide em segundos: "está tudo certo?", "até quando?", "o que faço?".

Muda em relação ao atual: o rótulo deixa de ser `Alert info`; o `Alert` fica só para resultado de ação (sucesso, informação, erro de pagamento) e para o aviso da etapa 2 do cancelamento, onde o rótulo textual "Atenção:" tem função.

Alternativas descartadas:
- *Cartão de plano com selo colorido por estado*: repete a forma "cartão" e a cor viraria o único sinal; descartada (acessibilidade e identidade).
- *Linha do tempo (trial → cobrança → carência)*: bonita, mas exige ícones e largura; só 1 a 3 datas existem por estado. Descartada por não ajudar a decidir.
- *Modal de cancelamento*: proibido (sem dialog, sem JS).

## 3. Sistema
**Tokens novos: nenhum.** Tudo com os existentes do :root. Pares usados (razão):
| Uso | Texto/fundo | Razão |
|---|---|---|
| Corpo, datas, valor | `--cor-texto` / `--cor-superficie` | 15,47 |
| Rótulos de `dt`, texto de apoio | `--cor-texto-suave` / `--cor-superficie` | 7,22 (sobre `--cor-superficie-alt`: 6,21) |
| Frase de estado (bloco realçado) | `--cor-texto` / `--cor-superficie-alt` | 13,29 |
| Links/ações discretas | `--cor-primaria-forte` / `--cor-superficie` | 7,79 |
| Aviso etapa 2 / resultado | `--cor-aviso-texto`/`--cor-aviso-fundo` 7,25; `--cor-erro-texto`/`--cor-erro-fundo` 7,22; `--cor-sucesso-texto`/`--cor-sucesso-fundo` 7,78; `--cor-info-texto`/`--cor-info-fundo` 8,71 |
| "Recusado" no histórico | `--cor-erro-texto` / `--cor-superficie` | 8,88 |
| "Aprovado" no histórico | `--cor-sucesso-texto` / `--cor-superficie` | 9,24 |
| Divisores | `--cor-borda-sutil` (1,38: decorativo, nunca único sinal) |

Escala tipográfica (existente):
- `h1` "Assinatura": Fraunces, `--texto-2xl` (1,75rem) no celular e `--texto-3xl` (2,25rem) a partir de 48rem (como os demais títulos do painel; manter o que `globals.css` já define para `h1`).
- Frase de estado: `h2`, Fraunces, `--texto-xl`, peso 600, entrelinha `--altura-linha-titulo`.
- Data decisiva (ex. "30/11/2026"): Source Sans 3, `--texto-2xl`, peso 600 (só em `<strong>`).
- Valor "R$ 79,00/mês": `--texto-lg`, peso 600.
- Rótulos `dt`: `--texto-sm`, `--cor-texto-suave`. Corpo: `--texto-base`.
- Títulos de seção ("Pagamentos", "Cancelar assinatura"): `h2` Fraunces `--texto-xl`.

Espaços: `--espaco-8` entre seções; `--espaco-4` dentro; `--espaco-3` entre botões. Raio `--raio` (bloco de estado). Sem sombras. Borda: `1px solid var(--cor-borda-sutil)` no topo das seções.

## 4. Componentes
Reaproveita: `Alert`, `Button` (`primaria`, `secundaria`, `perigo`), `DataList` (histórico), `FaixaDoPlano` (inalterada). Novos (em `src/app/painel/assinatura/`, pois são específicos da tela; nada de `ui/` novo):
1. **`SituacaoDaAssinatura`** (apresentacional, server): `<section aria-labelledby>` com fundo `--cor-superficie-alt`, `--raio`, `padding: var(--espaco-6)`. Contém `h2` (frase de estado, §5), parágrafo de apoio, `<dl>` de datas/valor. Sem cor por estado: o estado é o texto. Sem estados interativos.
2. **`DadosDaAssinatura`**: `<dl>` com pares `dt`/`dd`; em 375 px empilhado (rótulo acima do valor); a partir de 48rem, grade de 2 colunas `max-content 1fr` com `gap var(--espaco-2) var(--espaco-6)`. Linhas: "Plano" → "R$ 79,00/mês"; e as datas do estado (§5).
3. **`AcoesDaAssinatura`**: grupo de botões/formulários. Cada ação é um `<form method="post">` (server action via `useActionState`, um por ação em ordem fixa) ou, na etapa 1 do cancelar, um `<a>` com aparência de botão `secundaria`/`perigo` para `?cancelar=1`. Botão primário único por estado. Em 375 px: botões em coluna, largura total (alvo ≥ `--alvo-minimo`); a partir de 48rem: em linha, `gap --espaco-3`.
4. **`ConfirmarCancelamento`** (etapa 2, na mesma página): `<section aria-labelledby>` com `h2` "Cancelar assinatura?", `Alert variante="aviso"` com o texto do que acontece (§5) e as datas, formulário POST com `Button variante="perigo"` "Sim, cancelar assinatura" e link "Manter assinatura" (volta a `/painel/assinatura`). Foco: ao abrir com `?cancelar=1`, o `h2` leva `tabIndex={-1}` e `autoFocus` não é usado; o link de salto não é necessário (a seção vem logo após o resumo, ordem de leitura curta). Sem JS: é navegação normal; com JS, `useActionState` mostra o resultado.
5. **`HistoricoDePagamentos`**: `DataList` (legenda visível "Pagamentos", `h2` acima), colunas "Data" (`formatarData`), "Valor" (`formatarMoeda`), "Situação" ("Aprovado"/"Recusado", texto, sem ícone). Alinhar valor à direita a partir de 48rem. Vazio: `EmptyState` "Nenhum pagamento registrado." (nível 3). Limite 12, ordem decrescente.

Semântica: `main` já vem do `PanelLayout`; um só `h1`; `h2` por seção; resultado em `Alert` (`role=status`; erro de pagamento com `variante="erro"` e `rotulosVariante={{ erro: 'Erro de pagamento' }}` para o rótulo visível ficar "Erro de pagamento:", `role=alert`). Foco: contorno padrão do tema (`--foco-largura`, `--cor-foco`); nenhum `outline: none`. Teclado: ordem de tabulação = menu/painel → (Alert de resultado não focável) → ação primária → ação secundária (Cancelar) → histórico (sem controles).

## 5. Especificação por tela (`/painel/assinatura`)
Ordem (celular e desktop, uma coluna 40rem; desktop só muda a grade do `dl` e a linha de botões):
```
h1  Assinatura
[Alert de resultado, se houver]            (role status/alert)
┌ SituacaoDaAssinatura (superficie-alt) ───────────┐
│ h2  <frase de estado>                             │
│ p   <texto de apoio>                              │
│ dl  Plano ........ R$ 79,00/mês                   │
│     <rótulo data> .. <dd com <strong> dd/mm/aaaa> │
└───────────────────────────────────────────────────┘
AcoesDaAssinatura   [primária] [Cancelar assinatura]
(?cancelar=1) ConfirmarCancelamento
h2  Pagamentos  + DataList/EmptyState
```
Texto por estado (datas por `formatarData(…, fusoDoSalao)`; valor `formatarMoeda(PRECO_MENSAL_CENTAVOS)`; nenhum literal):
| Estado | h2 (frase) | apoio | dl (além de "Plano") | Ações |
|---|---|---|---|---|
| sem_assinatura | Você ainda não assinou. | Teste por 30 dias e depois R$ 79,00/mês. | — | **Assinar** |
| pendente | Assinatura pendente de autorização. | Assinatura pendente de autorização no provedor. O agendamento fica indisponível até lá. | — | **Continuar assinatura**, Cancelar assinatura |
| em_teste | Período de teste até dd/mm/aaaa | A primeira cobrança é nesse dia. | "Primeira cobrança": dd/mm/aaaa | Cancelar assinatura |
| ativa | Assinatura ativa. | Próxima cobrança em dd/mm/aaaa. | "Próxima cobrança": dd/mm/aaaa | **Atualizar meio de pagamento**, Cancelar assinatura |
| em_carencia | Pagamento não confirmado. | Seu acesso continua até dd/mm/aaaa. | "Acesso até": dd/mm/aaaa | **Regularizar pagamento**, Cancelar assinatura |
| suspensa | Assinatura suspensa por falta de pagamento. | Painel somente leitura. | — | **Regularizar pagamento**, Cancelar assinatura |
| cancelada | Assinatura cancelada. | Você pode usar o painel até dd/mm/aaaa. | "Acesso até": dd/mm/aaaa | nenhuma |
| encerrada | Assinatura encerrada. | Painel somente leitura. | — | **Assinar novamente** |
| manual | Salão suspenso pela administração. | Entre em contato com o suporte. | — | nenhuma; sem botões, sem histórico de ações (histórico continua somente leitura) |
Notas: o rótulo da situação (`rotulos.ts`) aparece também como `<span>` pequeno acima do `h2` ("Situação: Em teste", `--texto-sm`, `--cor-texto-suave`) para manter a informação atual. Em `em_teste`/`ativa`, a data decisiva fica em `<strong>` `--texto-2xl`. Botão primário (`Button primaria`) é um só; "Cancelar assinatura" é `secundaria` (a `perigo` só aparece na etapa 2, onde o ato é irreversível).

**Etapa 1 do cancelamento** (`?cancelar=1`, GET, sem chamar provedor): a página é a mesma, com `ConfirmarCancelamento` abaixo das ações, e o botão "Cancelar assinatura" sai (ou vira `aria-current`-ausente, preferir sair). Texto do `Alert aviso`, por estado:
- em_teste: "Se cancelar, você mantém o acesso até dd/mm/aaaa e não será cobrada."
- ativa: "Se cancelar, você mantém o acesso até dd/mm/aaaa (período já pago). Não haverá nova cobrança."
- pendente/em_carencia/suspensa: "Se cancelar, a assinatura é encerrada agora e o painel fica somente leitura." (pendente: "…encerrada agora.")
Botões: "Sim, cancelar assinatura" (perigo, POST) e link "Manter assinatura". Se `?cancelar=1` chegar em estado sem cancelamento, ignorar o parâmetro e mostrar a tela normal.

**Celular (375 px):** coluna única, bloco de estado em largura total com `--espaco-4` de padding; `dl` empilhado; botões empilhados e largos; histórico em `DataList` empilhado (cada linha "Data / Valor / Situação"); sem rolagem horizontal; `overflow-wrap: anywhere` no `h1` e no `h2`.
**Desktop (≥ 48rem):** mesma ordem; `dl` em duas colunas; botões em linha à esquerda; histórico como tabela de 3 colunas; conteúdo limitado a 40rem (coluna à esquerda do `main`, como em `/painel/profissionais`).

## 6. Estados
- **Resultado (Alert acima do bloco, `role` conforme variante):** sucesso "Assinatura cancelada. Acesso até dd/mm/aaaa." (`sucesso`); informação "Sua assinatura já estava cancelada." (`info`, com a data de acesso); informação "A assinatura mudou. Atualizamos as informações." (`info`); erro "Erro de pagamento: não foi possível concluir agora. Nada foi alterado; tente novamente." (`erro`, rótulo "Erro de pagamento"; o texto do corpo é "Não foi possível concluir agora. Nada foi alterado; tente novamente." para não repetir o rótulo). O estado e as datas exibidos vêm sempre da releitura (RN-11).
- **Vazio:** histórico "Nenhum pagamento registrado." (`EmptyState`).
- **Carregamento:** botões com `ocupado` e `rotuloOcupado`: "Abrindo o checkout…" (Assinar, Continuar, Assinar novamente), "Abrindo o provedor…" (Regularizar, Atualizar), "Cancelando…" (Sim, cancelar). Sem JS: navegação do navegador. Não há skeleton (página dinâmica, servidor).
- **Erro de carregamento da página:** reaproveitar o tratamento de erro do painel existente (`ErrorState`), sem texto novo.
- **Foco:** contorno do tema em links e botões; após POST sem JS a página nova começa no topo e o `Alert` é o primeiro conteúdo (leitor de tela lê pelo `role`). Com JS, o `Alert` de erro (`role=alert`) é anunciado sem mover o foco; o foco permanece no botão acionado.
- **Acesso negado / sem sessão:** `AcessoNegado` e redirecionamento existentes.

## 7. Interação e movimento
Nenhuma animação (a única transição existente é `--duracao` em hover de botão, herdada). `prefers-reduced-motion` já zera as transições do tema. Sem JS: tudo funciona — ações são formulários POST, a etapa 1 é link GET `?cancelar=1`, "Manter assinatura" é link, o retorno do checkout é a rota existente. Interação extra: nenhuma.

## 8. Arquivos afetados
- `src/app/painel/assinatura/page.tsx` (composição, `searchParams.cancelar`), `Resumo.tsx` (substituir por `SituacaoDaAssinatura`/`DadosDaAssinatura`), `Assinatura.module.css` (seções, `dl`, ações, bloco de estado), novos `AcoesDaAssinatura.tsx`, `ConfirmarCancelamento.tsx`, `HistoricoDePagamentos.tsx`, `textos.ts` (frase/apoio/rótulos por estado; datas e valor só via `format.ts`/`config/plano.ts`), `acoes.ts`, `estado.ts`, `FormularioAssinar.tsx` (mantém o funcionamento; sem o parágrafo longo — o valor passa ao `dl`; o texto de `resumoDoPlano` fica só em `sem_assinatura`).
- `src/app/dev/assinatura/page.tsx` e `acoes.ts`: `?situacao=` com os 9 estados, `?cancelar=1`, `?resultado=` e histórico com 0 e 12 itens; mesma composição da página real.
- `src/components/layout/FaixaDoPlano.tsx`: sem mudança. Coerência: os textos do aviso (`server/assinatura/aviso.ts`) devem usar as mesmas frases/datas de §5; o link da faixa já aponta a `/painel/assinatura`.
- Testes: unitários dos componentes, `e2e/assinatura.spec.ts` e `assinatura-sem-js.spec.ts` (axe 4.14.0, 375×812, teclado, sem JS), `src/app/globals.test.ts` (sem mudança) e `conformidade` (sem cor fora do :root).

## 9. Critérios de revisão visual
1. `h1` "Assinatura" é o único `h1`; seções usam `h2` (ordem sem saltos).
2. Frase de estado em `--fonte-titulo`, `--texto-xl`; data decisiva em `--texto-2xl`, peso 600; texto da tabela §5 idêntico ao exato.
3. Nenhum literal de cor, nenhum `px`/`rem` de espaçamento fora de tokens novos (não há tokens novos); um único `@media (min-width: 48rem)`.
4. Contrastes ≥ os valores da §3 (todos ≥ 4,5:1 para texto); botões e campos ≥ 3:1.
5. Sem rolagem horizontal em 375 px nos 9 estados, com e sem a etapa 2, e com 12 pagamentos.
6. Alvos de toque ≥ 2,75 rem de altura; botões em coluna em 375 px.
7. Foco visível em todos os botões/links; ordem de tabulação: ação primária → "Cancelar assinatura" (ou "Sim, cancelar assinatura" → "Manter assinatura").
8. A etapa 1 não envia POST nem chama o provedor (é link GET); só "Sim, cancelar assinatura" é `type=submit`.
9. `Alert` de erro tem `role=alert` e o rótulo visível "Erro de pagamento:"; nenhum estado é sinalizado só por cor.
10. Em `cancelada`/`manual` não existe botão de ação; em `em_teste` não existe "Atualizar meio de pagamento".
11. Tela idêntica e funcional com JavaScript desligado (E2E sem JS).
12. Datas iguais em `TZ=UTC` e `America/Sao_Paulo` (CA-14); nenhum `toLocale*`/`Intl` na tela.
13. axe 4.14.0 sem violações em 375×812 nos estados da vitrine.

## 10. Conflitos e alternativas
1. **`Alert` tem rótulo fixo "Erro:"** (`Alert.tsx:9`); a spec pede "Erro de pagamento". Solução sem mudar `Alert`: `rotulosVariante={{ erro: 'Erro de pagamento' }}` (já suportado). Sem conflito.
2. **`DataList` vira "cartões" abaixo de 48rem** (`DataList.tsx` docstring). Com 12 linhas e 3 campos é aceitável e já é o padrão do projeto; alternativa, se o tester achar longo: manter só o `DataList` e limitar a legibilidade com `--espaco-2` entre linhas (sem criar componente).
3. **`?cancelar=1` com JS** usa navegação completa (sem modal); isso é intencional (RN-4).
4. **Dois formulários na mesma página** (primário e Sim, cancelar) exigem um `useActionState` por ação em ordem fixa (nota do CLAUDE.md D-014), senão o estado do POST sem JS se perde.
5. `FaixaDoPlano` não muda; se as frases de `aviso.ts` divergirem da §5, alinhar `aviso.ts` (arquiteto decide; fora do visual).

## 11. Dúvidas
- Bloqueantes: nenhuma.
- Não bloqueantes: (a) rótulo "Primeira cobrança" no `dl` de `em_teste`: adotado por coerência com "fim do teste = primeira cobrança" (RN-9); (b) capturas de 375/768/1280 ficam para a revisão do desenvolvedor/tester (não feitas aqui).
