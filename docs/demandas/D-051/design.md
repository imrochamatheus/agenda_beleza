# D-051 (issue #113, E4.1b): Desenho técnico do dia e do horário na mesma página

Autor: arquiteto-software. Data: 23/11/2026. Entradas: `docs/demandas/D-051/spec.md` (RN-1..RN-20, CA-1..CA-18,
ND-1..ND-8) e `docs/demandas/D-051/web-design.md` (régua da semana, §4 componentes, §6 textos, §9 critérios, §10
conflitos). Base: `main` com a D-050 mesclada.

**Etapas dispensadas.** DBA: não há esquema, migração, índice nem consulta SQL nova. A demanda só reusa
`consultarDisponibilidadePorServico` (6 instruções por chamada, D-018/D-050) com um período menor (7 datas em vez de
14). DevOps: não há variável de ambiente, compose, imagem, job de CI nem script novo. O web-designer já entregou e nada
volta a ele (§1.3).

---

## 1. Resumo da solução

### 1.1 Ideia central

O passo `data` deixa de existir como tela. Ele vira o estado "sem dia" do passo do serviço 0, e os dois compartilham a
mesma área: cabeçalho do passo, resumo da seleção, a régua da semana (`FaixaDeDias`) e, abaixo, o bloco de horários.

- **Derivação (`lerPasso`).** Sem `data` válida, o passo é `'dia'`, que substitui o antigo `'data'`. Ele carrega o
  **início alinhado** da semana, calculado a partir de `de`, ou de hoje quando `de` falta. Com `data` válida, nada muda:
  o passo é `'servico'` (k = primeiro `h` ausente ou `alterar`) ou `'dados'`.
- **Semana.** As semanas são blocos fixos de 7 dias civis a partir de `hoje` no fuso do salão (RN-3). Duas funções
  puras de `passos.ts` cuidam disso: `inicioDaSemana` (limita a data a [hoje, última] e alinha) e `limitesDaSemana`
  (período, anterior e próxima).
- **Carga (`carregarPasso`).** Cada passo com faixa faz uma chamada de disponibilidade para a semana, cobrindo todos os
  serviços e sem itens escolhidos (marcação DA-2, RN-4). O passo do serviço 0 com dia faz, além dela, a mesma chamada
  da D-050 para a grade do dia (com os itens dos outros serviços). O teto é de 2 chamadas, ou 12 instruções SQL, por
  carregamento (RN-16), e a cota de IP continua sendo uma só, consumida em `carregarPassoComLimite` antes de qualquer
  cálculo.
- **UI.** `Passos.tsx` ganha um cabeçalho comum ao passo `'dia'` e ao passo `'servico'` com `indice === 0`. A faixa é
  um componente genérico de `src/components/ui/`, que só recebe texto. Os textos são montados por um módulo puro
  (`_componentes/faixa.ts`) com os formatadores de `src/lib/format.ts`.

### 1.2 Decisões e alternativas descartadas

| # | Decisão | Alternativa descartada e motivo |
|---|---|---|
| D1 | Nova variante `'dia'` em `PassoLido` e `VisaoDoPasso`, no lugar de `'data'`. O nome novo faz o typecheck apontar todos os consumidores antigos. | Representar "sem dia" como `'servico'` com `data: null`: todos os campos da grade (`fuso`, `profissionais`, `consulta`…) viram opcionais e cada leitor ganha checagens de nulo. Manter o nome `'data'`: a semântica de `de` mudou (início alinhado), e um consumidor antigo compilaria com o significado errado. |
| D2 | No passo do serviço 0 com dia, são **sempre 2 chamadas**: uma da semana (todos os serviços, 7 datas, sem `escolhidos`) e uma da grade, idêntica à da D-050. A contagem de SQL fica determinística por forma de URL: `'dia'` = 6, serviço 0 com dia = 12, serviço k ≥ 1 = 6, dados = 6 (ou 12 quando o item 0 caiu). Ela não depende de N, de profissionais nem de itens. | Reaproveitar a chamada da semana como grade quando não há outros itens (6 instruções no caso comum). Foi descartado porque a contagem passaria a variar com os itens e o caso com itens exigiria um ramo diferente. Também porque `horarioOferecido` sobre 7 datas aceitaria um item pré-selecionado de outra data, o que mudaria o aviso `horario_indisponivel` de hoje (teste "item em outra data" da D-050). O custo extra é de 6 leituras curtas, dentro do teto da RN-16. |
| D3 | A marcação DA-2 da semana é extraída para a função pura `diasDaFaixa(resultado, de, ate)` em `pagina.ts`, a mesma regra de `pagina.ts:205-207` sem mudança. | Calcular a marcação no componente: a regra ficaria fora do servidor e a vitrine não teria como reusá-la. |
| D4 | O fragmento é `#reservar` (constante `ANCORA_RESERVA`), o `id` que o `h2` de todos os passos já tem. Ele entra nos links de dia, nos links de semana e também em `hrefOutroDia` (RN-14), porque o destino é a mesma página combinada. | Um `id` novo na faixa: depois de recarregar, o indicador "Serviço 1 de N" e o resumo ficariam acima da dobra. Deixar `hrefOutroDia` sem âncora: a cliente voltaria ao topo (P5 do web-design). |
| D5 | O link de dia leva só `s` + `data` + `#reservar`, **sem `de`**, porque a semana sai de `data` (RN-6). O link de semana leva `s` + `de` (início da semana de destino) + `#reservar`. | Pôr `de` também no link do dia: seria um parâmetro redundante, ignorado pela RN-6. |
| D6 | O passo 0 sem dia é renderizado como `<section aria-labelledby="reservar">`, **sem `<form>`** e sem `CamposOcultos`. Com dia, continua `<form method="get">` como na D-050. | Um `<form>` sem botão e sem `data`: um envio por Enter num campo inexistente não acontece, mas o formulário ficaria sem função e com campos ocultos incompletos. |
| D7 | Os textos da faixa ficam num módulo puro `src/app/(publico)/[slug]/_componentes/faixa.ts` (`propsDaFaixa`, `estadoSemDia`), testável sem DOM. | Montar tudo dentro de `Passos.tsx`: a regra dos sufixos, dos estados vazios e dos `href` ficaria testável só por renderização. |
| D8 | `destinoDoRedirecionamento` (`formulario.ts`) e `reescolha.ts` ficam sem mudança. O redirecionamento 303 continua sem âncora. | Pôr `#reservar` no `Location`: funciona, mas está fora do escopo e mexeria nos testes da D-036. Fica como melhoria futura. |

### 1.3 Conflitos do web-design (§10): decisões

Nenhum dos conflitos colide com um requisito. Nada volta ao web-designer.

- **C1 (alvo de 44 px em 375 px): aceita a régua sangrando até a borda interna do cartão.** No celular,
  `margin-inline: calc(-1 * var(--espaco-4))`, que depende de `.reserva { padding: var(--espaco-4) }`
  (`Salao.module.css:111`). O CSS da régua fica no módulo do componente e é genérico, então a sangria precisa ser
  aplicada pelo **contexto**: `FaixaDeDias` recebe `className` opcional no invólucro e `Salao.module.css` define
  `.faixaNoCartao` com a margem negativa (abaixo de 48rem) e `margin-inline: 0` a partir de 48rem. Na vitrine
  `/dev/componentes`, sem cartão, a régua fica sem sangria. Um E2E de geometria prova 7 colunas de ≥ 44 px em 375 px e
  nenhuma rolagem interna.
- **C2 (axe `scrollable-region-focusable` abaixo de ~340 px): aceita a alternativa condicional.** Quando a semana **não
  tem nenhum dia link**, o invólucro com rolagem recebe `tabIndex={0}`, `role="group"` e `aria-labelledby` (título e
  período), com foco visível pelo mesmo contorno de `--cor-foco`. Quando há pelo menos um link, o invólucro fica sem
  `tabindex`, porque os links já são focáveis e o navegador rola até eles. A regra é decidida dentro do componente
  (`dias.every(d => d.href === null)`), sem prop extra. O custo é uma parada de Tab a mais só nas semanas vazias, e ela
  é anunciada como "Escolha o dia, dd/mm/aaaa a dd/mm/aaaa". O E2E de 320 px roda o axe numa semana vazia.
- **C3 (rótulo no nome, WCAG 2.5.3): aceito como está.** A RN-2 fixa o nome acessível completo ("Terça-feira,
  01/12/2026"). Fica registrado como risco R-5.
- **C4 (sufixo ", hoje"): aceito.** O nome começa por `rotuloDoDia`, que é o que CA-1 e CA-2 exigem. A ordem dos
  sufixos é fixa: `rotulo` + `, hoje` (se for hoje) + `, sem horários` (se não for link). Os testes usam "começa por" e
  "contém", nunca igualdade exata com o rótulo sem sufixo.
- **C5 (dia marcado sem horário): aceito.** `aria-current="date"` vai no `<span>`, com o estado visual do §4.1 do
  web-design (contorno interno de 3 px em `--cor-primaria-forte`).

---

## 2. Componentes afetados

| Área | Arquivo | Mudança |
|---|---|---|
| Formatação | `src/lib/format.ts` (+ teste) | `formatarDiaDaSemanaCurto`, `formatarDiaEMesCurtos` (§3.1) |
| Componente | `src/components/ui/FaixaDeDias.tsx`, `FaixaDeDias.module.css`, `FaixaDeDias.test.tsx` (novos) | régua genérica (§3.5) |
| Vitrine de componentes | `src/app/dev/componentes/Vitrine.tsx` (+ `Vitrine.test.tsx`) | 4 exemplos da faixa (web-design §8) |
| Servidor, puro | `src/server/reserva-publica/passos.ts` (+ teste) | `'dia'`, semanas, `hrefDoDia`, `hrefDaSemana`, âncora (§3.2) |
| Servidor, tipos | `src/server/reserva-publica/tipos.ts` (+ teste) | `FaixaDaSemana`, variante `'dia'`, `faixa` em `'servico'`, textos (§3.3) |
| Servidor, carga | `src/server/reserva-publica/pagina.ts` | `diasDaFaixa`, `carregarFaixa`, passos `'dia'`/`'servico'`/`'dados'` (§3.4) |
| Página pública | `src/app/(publico)/[slug]/_componentes/Passos.tsx`, `faixa.ts` (novo, + `faixa.test.ts`), `PaginaDoSalao.tsx` (+ teste), `Salao.module.css` | sai `PassoData`; entram `PassoDia`, `CabecalhoDoPasso` e o bloco de horários (§3.6) |
| Vitrine da reserva | `src/app/dev/reserva/{dados.ts,dados.test.ts,page.tsx,page.test.tsx}` | variante `'dia'`, faixa fabricada, `?vista=semana-vazia` (§3.7) |
| Testes de integração | `tests/integration/reserva-publica/{passos,fluxo-itens,pagina}.test.ts`, `tests/integration/protecao/pagina-limite.test.ts`, novo `tests/integration/reserva-publica/faixa.test.ts` | §8 |
| E2E | `e2e/suporte/publico.ts`, `e2e/{reserva-publica,reserva-publica-sem-js,publico-reserva,publico-reserva-teclado,publico-conflito-captcha,tester-d050}.spec.ts`, novos `e2e/reserva-publica-faixa.spec.ts` (vitrine) e `e2e/publico-faixa-dias.spec.ts` (banco) | §8 |
| Documentação | `CLAUDE.md` (parágrafo D-051 e 2 linhas na tabela de comandos) | T-8 |

Ficam **sem mudança**: `page.tsx` da rota (já repassa o `PassoLido` e consome a cota em `carregarPassoComLimite`),
`acoes.ts`, `formulario.ts`, `estado.ts`, `reescolha.ts`, `FormularioDados.tsx` (continua usando `hrefOutroDia`, que
ganha a âncora sozinho), `servico.ts`, `consultarDisponibilidadePorServico`, o domínio e os repositórios.

---

## 3. Interfaces

### 3.1 `src/lib/format.ts`

```ts
/** "Dom" | "Seg" | "Ter" | "Qua" | "Qui" | "Sex" | "Sáb". RangeError fora de 0..6 (mesma checagem de formatarDiaDaSemana). */
export function formatarDiaDaSemanaCurto(dia: number): string;
/** 'AAAA-MM-DD' → { dia: '1', mes: 'dez' } (dia sem zero; jan fev mar abr mai jun jul ago set out nov dez). RangeError para chave inválida (mesma validação de formatarDataCivil). */
export function formatarDiaEMesCurtos(chave: string): { dia: string; mes: string };
```
O período da semana é `${formatarDataCivil(inicio)} a ${formatarDataCivil(fim)}`, montado em `faixa.ts` sem formatador
novo. O dia da semana continua vindo de `diaDaSemana` (domínio).

### 3.2 `src/server/reserva-publica/passos.ts` (puro, client-safe; já é importado por `Passos.tsx`/`FormularioDados.tsx`)

```ts
export const DIAS_POR_SEMANA = 7;           // substitui DIAS_POR_PAGINA (removido; nenhum uso restante)
export const ANCORA_RESERVA = 'reservar';   // id do h2 de todos os passos

type Janela = { hoje: DataCivil; janelaDias: number };

/** Limita d a [hoje, hoje + janelaDias] e devolve hoje + 7·floor(diferencaEmDias(hoje, d) / 7). */
export function inicioDaSemana(d: DataCivil, j: Janela): DataCivil;

/** Para um início JÁ alinhado: ate = min(inicio + 6, ultima); anterior = inicio − 7 se inicio > hoje, senão null;
 *  proxima = inicio + 7 se ≤ ultima, senão null. */
export function limitesDaSemana(inicio: DataCivil, j: Janela):
  { de: DataCivil; ate: DataCivil; anterior: DataCivil | null; proxima: DataCivil | null };

/** RN-10: s + data + '#reservar' (sem h*, f, alterar, enviado, aviso, de). */
export const hrefDoDia = (base: string, s: readonly string[], data: string): string;
/** RN-10: s + de (início da semana de destino) + '#reservar'. */
export const hrefDaSemana = (base: string, s: readonly string[], inicio: string): string;
/** RN-14: inalterado no conteúdo (s + de = data); ganha '#reservar' (D4). */
export const hrefOutroDia;
```

`PassoLido`: a variante `'data'` sai e entra a `'dia'`.
```ts
| ({ passo: 'dia'; s: string[]; semana: DataCivil /* início alinhado */ } & Aviso)
```
`lerPasso`: o ramo de `passos.ts:151-157` passa a devolver
`{ passo: 'dia', s, semana: inicioDaSemana(lerData(params.de) ?? ctx.hoje, ctx), aviso }`. Esse ramo cobre: `data`
ausente, inválida ou fora da janela, e também `alterar=k` sem data válida, caso em que os `h*` são ignorados (§6 da
spec). O resto de `lerPasso` não muda. A diferença de dias usa `diferencaEmDias` de `@/server/tempo/fuso`, que é
aritmética de datas civis, sem `Date` local.

**Garantias de teste (unitário, dois fusos):** a tabela inteira da RN-12. `de` no meio da semana k cai em hoje + 7k.
Com janela de 60 há 9 semanas e a 9ª tem 5 dias. Janela 1: 2 dias, sem anterior nem próxima. Janela 7: semana 0 com
7 dias e semana 1 com 1 dia. `de` antes de hoje ou depois da última data é limitado ao intervalo. Ida e volta:
`lerPasso(hrefDaSemana(...))` reproduz a mesma semana e `lerPasso(hrefDoDia(...))` reproduz a mesma data. Nenhum href
tem chave fora de `s|data|de` nem dado pessoal (CA-16).

### 3.3 `src/server/reserva-publica/tipos.ts` (client-safe)

```ts
export type DiaDaFaixa = { data: string /* AAAA-MM-DD */; temHorarios: boolean };
export type FaixaDaSemana = {
  hoje: string;               // para "Hoje" e o sufixo ", hoje"
  inicio: string; fim: string;
  dias: DiaDaFaixa[];         // 1..7, de inicio a fim
  anterior: string | null;    // início da semana anterior
  proxima: string | null;     // início da próxima semana
  selecionado: string | null; // data marcada (aria-current); null no passo 'dia'
};

// VisaoDoPasso: sai { passo: 'data', … } e entra:
| {
    passo: 'dia';
    s: string[];
    selecao: Selecao;
    servico: ServicoDaSelecao;   // selecao.servicos[0]
    total: number;               // s.length
    faixa: FaixaDaSemana;        // selecionado: null
    aviso: CodigoAviso | null;
  }
// e a variante 'servico' ganha:
    /** Só no serviço 0 (indice === 0); null nos passos k ≥ 1. */
    faixa: FaixaDaSemana | null;
```

`MENSAGENS_PASSO` recebe os textos do web-design §4.3 e §6, exatos:
`escolhaODia: 'Escolha o dia'`, `semanaAnterior: 'Semana anterior'`, `proximaSemana: 'Próxima semana'`,
`navegacaoSemanas: 'Semanas'` (o `aria-label` do `<nav>`), `hoje: 'Hoje'`, `sufixoHoje: ', hoje'`,
`sufixoSemHorarios: ', sem horários'`, `semDiaTitulo`, `semDiaTexto(servico)`, `semanaVaziaTitulo`,
`semanaVaziaComProxima`, `semanaVaziaUltima`, `semanaVaziaUnica`. `diaComHorarios` e os demais ficam como estão.

### 3.4 `src/server/reserva-publica/pagina.ts`

```ts
/** DA-2 (sem mudança de regra): dia com horário se CADA serviço tem ≥ 1 horário nele; um item por data de [de, ate]. */
export function diasDaFaixa(servicos: readonly DisponibilidadeDoServico[], de: DataCivil, ate: DataCivil): DiaDaFaixa[];

/** UMA chamada (6 instruções): todos os serviços de s, período da semana de `inicio`, sem `escolhidos`. null se a consulta não é 'ok'. */
async function carregarFaixa(ctx, s: string[], inicio: DataCivil, regras: RegrasDaPagina, agora: Date,
                             selecionado: DataCivil | null): Promise<FaixaDaSemana | null>;
```

Comportamento de `carregarPasso` em cada passo:

| Passo | Chamadas a `consultarDisponibilidadePorServico` | SQL de disponibilidade |
|---|---|---|
| `'dia'` | `carregarFaixa(s, passo.semana, …, null)`; resultado diferente de `'ok'` vira `voltarAosServicos` | 6 |
| `'servico'`, `indice === 0` | a chamada atual da D-050 (`de = ate = data`, `escolhidos` = outros itens, `calcular = [s[0]]`) e depois `carregarFaixa(s, inicioDaSemana(data), …, data)` | 12 |
| `'servico'`, `indice ≥ 1` | só a chamada atual; `faixa: null` | 6 |
| `'dados'`, nenhum item caiu | a chamada atual | 6 |
| `'dados'`, item 0 caiu | a chamada atual e `carregarFaixa(…, data)` para a visão do serviço 0 | 12 |
| `'dados'`, item k ≥ 1 caiu | a chamada atual; `faixa: null` | 6 |

`visaoDoServico` recebe `faixa` como entrada, e não chama o banco. As chamadas são **sequenciais**, fora de qualquer
transação. `Promise.all` não é usado, para não ocupar duas conexões do pool por visitante. `carregarPassoComLimite`
fica igual: `'dia'` é diferente de `'servicos'` e por isso consome exatamente uma cota, antes de tudo (CA-14). Com o
limite excedido, o retorno é `{ passo: 'limitado' }`, sem faixa e sem chamada.

### 3.5 `src/components/ui/FaixaDeDias.tsx` (componente de servidor, sem `'use client'`, sem `@/server`)

```ts
export type DiaDaFaixaDeDias = {
  chave: string;          // 'AAAA-MM-DD' (key do React)
  semana: string;         // "Ter" ou "Hoje"
  dia: string;            // "1"
  mes: string;            // "dez"
  rotulo: string;         // nome acessível completo, com sufixos já aplicados
  href: string | null;    // null = sem horário (<span>, fora do Tab)
  atual: boolean;         // aria-current="date"
};
export type FaixaDeDiasProps = {
  idTitulo: string;       // id do h3; o do período é `${idTitulo}-periodo`
  titulo: string;
  periodo: string;
  dias: readonly DiaDaFaixaDeDias[];
  anterior: { href: string; rotulo: string } | null;
  proxima: { href: string; rotulo: string } | null;
  rotuloNavegacao: string;   // aria-label do <nav>
  apoio?: string;
  className?: string;        // aplicado no invólucro externo (sangria no cartão, C1)
};
```
A anatomia, os estados e o CSS seguem exatamente o web-design §3.3, §4.1 e §5.5. Pontos amarrados aqui:

- `<ol>` com `aria-labelledby="{idTitulo} {idTitulo}-periodo"`. Sempre 7 colunas: as posições sem dia ficam vazias,
  sem `<li>`. Cada dia tem três `<span aria-hidden="true">` e um `<span class="visualmente-oculto">{rotulo}</span>`.
- O `<nav>` só existe se houver anterior ou próxima. Um limite sem link não renderiza nada (RN-5).
- Regra C2 (§1.3) no invólucro de rolagem.
- O título é sempre `h3`, abaixo do `h2` do passo.
- O CSS usa só tokens e um único `@media (min-width: 48rem)`, e não usa `scroll-behavior`.

### 3.6 Página pública (`src/app/(publico)/[slug]/_componentes/`)

- **`faixa.ts` (puro, novo).**
  - `propsDaFaixa(base, s, faixa): FaixaDeDiasProps`. Monta a semana curta (`formatarDiaDaSemanaCurto(diaDaSemana(d))`
    ou `MENSAGENS_PASSO.hoje`), `formatarDiaEMesCurtos`, `rotuloDoDia` mais os sufixos, `href`
    (`hrefDoDia`/`hrefDaSemana`), `atual`, o período e os textos. `rotuloDoDia` sai de `Passos.tsx` e vem para cá, e
    `Passos.tsx` passa a reexportá-lo, porque `FormularioDados.tsx` o importa de `./Passos`.
  - `estadoSemDia(faixa, servico): { titulo; texto }`. Com algum dia disponível, devolve `semDia*`. Sem nenhum,
    devolve `semanaVazia*`, conforme exista próxima ou anterior (web-design §6).
- **`Passos.tsx`.**
  - Sai `PassoData`.
  - Entra `CabecalhoDoPasso` (indicador, `h2#reservar` com `aria-describedby`, detalhe e `Alert` do aviso), usado por
    `PassoDia` e `PassoServico`.
  - `PassoDia` renderiza `<section>` com, em ordem: cabeçalho, `ResumoDaSelecao`, `FaixaDeDias`, um bloco com o
    `EmptyState nivelTitulo={3}` de `estadoSemDia` e a navegação só com "Alterar serviços". O aviso de `'dia'` é sempre
    o texto genérico `MENSAGENS_AVISO[código]` (RN-15).
  - `PassoServico` com `visao.faixa !== null`: depois do cabeçalho vêm `ResumoDaSelecao` e `FaixaDeDias`, e o conteúdo
    da D-050 (roteiro, campos ocultos, filtro, grades e Continuar, ou o `EmptyState`) fica dentro de
    `<div className={estilos.horarios}>`, com o traço no topo. Na navegação final, "Escolher outro dia" **some** e
    "Alterar serviços" fica. Com `faixa === null`, o passo é idêntico ao da D-050.
  - Ordem do DOM: aviso antes da régua (critério 13).
- **`PaginaDoSalao.tsx`.** `case "data"` vira `case "dia"` e renderiza `<PassoDia>`. O tratamento da alternativa
  (`aviso` de horário ou profissional no passo `'servico'`) continua igual e passa a valer também para o serviço 0 com
  faixa (RN-15).
- **`Salao.module.css`.**
  - Saem `.dias`, `.dia` e o `.dias` de dentro do `@media`.
  - Entram `.faixaNoCartao` (C1), `.horarios` (`border-block-start: 1px solid var(--cor-borda-sutil)`,
    `padding-block-start: var(--espaco-4)`, `display: grid`, mesmo `gap` do cartão) e
    `.indicador + h2 { scroll-margin-block-start: var(--espaco-8) }` (web-design §7).

### 3.7 Vitrine `/dev/reserva` (`src/app/dev/reserva/`)

- `dados.ts`:
  - `visaoDemonstracao` trata `'dia'` com a faixa fabricada. A semana sai de `limitesDaSemana` (função real) e
    `temHorarios` sai de `profissionaisDoServico` sem ocupações, a mesma lógica de hoje (`dados.ts:233-237`).
  - O serviço 0 e o recuo de dados do item 0 recebem `faixa` com `selecionado`.
  - `DIAS_POR_PAGINA` sai dos imports.
- `page.tsx` ganha `?vista=semana-vazia`. Ela lê o passo normal da query (precisa de `s`; sem `s`, cai em
  `servicos`), aplica `lerPasso`/`visaoDemonstracao` e, se a visão for `'dia'` ou serviço 0, zera `temHorarios` de todos
  os dias e mantém a navegação (no modelo da `visaoDoConflito`). As vistas pedidas pelo CA-17:
  - passo 0 sem dia: `/dev/reserva?s=<Escova>&s=<Hidratação>&s=<Manicure>`;
  - passo 0 com dia: `…&data=<próximo dia útil>`;
  - semana com todos os dias desabilitados: `…&vista=semana-vazia`;
  - última semana: `…&de=<hoje+60>`.

  O comentário do cabeçalho de `page.tsx` lista a vista nova. Fora do modo vitrine continua 404 (teste existente).

---

## 4. Dados

Não há impacto. Nenhuma entidade, campo, constraint, índice ou migração muda. A única consulta usada é
`consultarDisponibilidadePorServico`, com um período de no máximo 7 datas (antes eram 14) e as mesmas 6 instruções e
planos (D-018 CA-25, D-050 CA-3). DBA dispensado.

## 5. Infraestrutura

Não há impacto. Nenhuma variável de ambiente, container, CI, script ou observabilidade muda: a demanda não cria log
novo, e o limite `disponibilidade` e o `PROTECAO_*` são os mesmos. DevOps dispensado. Os E2E novos entram no
`npm run test:e2e` existente.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como foi atendida |
|---|---|---|
| Escopo por salão no servidor | Sim, só leitura | A faixa usa o mesmo `PublicoContext` do slug e `consultarDisponibilidadePorServico`. `s` de outro salão: `montarSelecao` devolve null e o passo volta aos serviços com `servico_indisponivel`, sem consulta (já coberto). Um teste novo confirma que a faixa de um salão não reflete a agenda de outro. |
| Exclusion constraint anti-sobreposição | Não | Nenhuma escrita nova. A criação continua em `criarReserva`. |
| UTC e fuso do salão | Sim | "Hoje", as semanas e os dias são datas civis do fuso do salão (`lerRegrasDaPagina` → `limitesDaJanela`). A aritmética usa `somarDias`/`diferencaEmDias`/`compararDatas`, o dia da semana sai de `diaDaSemana` e a formatação fica em `format.ts`. CA-15 roda em dois `TZ` e com salões em `America/Manaus` e `America/Noronha` perto da meia-noite. |
| Adaptadores de integração | Não | O Turnstile continua só no passo de dados. |
| Soft delete e anonimização | Não | Profissional ou serviço desativado já cai em `servico_indisponivel` ou fica fora da grade. Não há dado de cliente no passo. |
| Salão suspenso somente leitura | Sim | `page.tsx` só chama `carregarPassoComLimite` se `decisao.disponivel`. Suspenso: sem faixa, sem cota, sem consulta (CA-18, E2E `publico-suspenso` mantido). |
| Idempotência de webhooks e mensagens | Não | Não há mensagem nem webhook. |
| Auditoria do super admin | Não | — |
| Limite por IP (D-027) | Sim | Uma cota por carregamento de `'dia'` e de serviço 0, antes de qualquer cálculo. Com o limite excedido: `limitado` e nenhuma instrução de disponibilidade. |
| Estado na query, sem PII | Sim | Nenhum parâmetro novo. Os links de dia e de semana só usam `s`, `data` e `de` (CA-16). |
| Sem JavaScript obrigatório | Sim | Dias e semanas são `<a href>`, e o horário continua no `<form method="get">`. O componente não tem estado de cliente. |

## 7. Riscos e decisões

| # | Risco | Mitigação |
|---|---|---|
| R-1 | O passo do serviço 0 com dia passa de 6 para 12 instruções SQL. | O teto da RN-16 é respeitado, o período é de 7 datas e as consultas são as mesmas já medidas. O teste de contagem (CA-14) trava o número em 12. O reaproveitamento (D2) fica como otimização futura, se a medição pedir. |
| R-2 | Entre T-3 e T-5 o typecheck quebra, porque a variante `'data'` some antes que a UI e a vitrine sejam adaptadas. | T-3, T-4 e T-5 ficam com o mesmo desenvolvedor, em sequência, e o critério de conclusão de typecheck, lint e build é verificado no fim da T-5. Nenhum commit intermediário vai para a CI. |
| R-3 | E2E perto da meia-noite: "hoje" do teste e do servidor podem divergir. | `escolherDia` não calcula a semana: abre a página, procura o link do dia na faixa e, se não achar, clica em "Próxima semana", até 10 vezes. Com isso fica imune a divergências de um dia. |
| R-4 | A sangria (C1) depende do padding de `.reserva`. | A margem negativa usa o mesmo token (`--espaco-4`). Um E2E de geometria (375 px) prova que não há rolagem interna, que cada coluna tem ≥ 44 px e que `scrollWidth <= clientWidth` do documento. |
| R-5 | WCAG 2.5.3: o texto visível "Ter 1 dez" não está contido no nome "Terça-feira, 01/12/2026". | Aceito pela RN-2 (C3). O axe padrão não acusa. Fica registrado. |
| R-6 | `FaixaDeDias` entra no bundle cliente (via `Passos.tsx`, importado por `FormularioDados.tsx`). | O componente não tem import de servidor. Os testes de conformidade existentes (`@/server` proibido em `src/components`) cobrem isso. `faixa.ts` importa só `passos.ts`/`tipos.ts`, que já são client-safe. |
| R-7 | Links salvos com `de` desalinhado ou fora da janela. | `inicioDaSemana` limita e alinha. Testes da tabela RN-12 (unitário e E2E com HTTP 200). |
| R-8 | A parada de Tab extra no invólucro das semanas vazias (C2) pode surpreender um teste de ordem de Tab. | O teste de ordem de Tab usa uma semana com dias disponíveis. O teste da semana vazia verifica explicitamente a parada do grupo. |

## 8. Estratégia de testes

Nenhum teste existente é enfraquecido. Os da D-050 que passavam por "Escolha o dia" mudam só a navegação até o dia
(CA-18).

| CA | Unitário | Integração (PostgreSQL real) | E2E (Playwright) |
|---|---|---|---|
| CA-1 | `faixa.test.ts` (dia curto, número, mês, rótulo e sufixos); `PaginaDoSalao.test.tsx` (indicador, `h2`, resumo, faixa; não existe `h2` "Escolha o dia" nem `ul.dias`) | `passos.test.ts`: `'dia'` com `faixa.dias` de hoje a hoje+6 | `publico-faixa-dias` |
| CA-2 | `FaixaDeDias.test.tsx` (`<span>` sem `tabindex`, nome contém "sem horários"; link quando disponível) | DA-2 de `diasDaFaixa` (cenário Carla só às quartas, migrado do teste atual do passo `data`) | teclado: dias desabilitados fora do Tab |
| CA-3 | `passos.test.ts` (`inicioDaSemana`/`limitesDaSemana`: janela 60 → 9ª semana com 5 dias; janela 1; janela 7; anterior e próxima) | última semana via `de` | vitrine: sem "Semana anterior" na semana 0 e sem "Próxima semana" na última |
| CA-4 | `PaginaDoSalao.test.tsx` (sem `RoteiroDoDia`, filtro, `radio` nem botão; nenhum `aria-current`) | `'dia'` com `selecionado: null` | vitrine e banco |
| CA-5 | `passos.test.ts` (`hrefDoDia` = `s` + `data` + `#reservar`) | serviço 0 com `faixa.selecionado = data` e a grade idêntica à chamada direta | clique num dia: `aria-current="date"`, horários abaixo |
| CA-6 | — | `fluxo-itens.test.ts` adaptado | `publico-reserva` adaptado |
| CA-7 | `faixa.test.ts`: os `href` dos dias e das semanas não têm `h*`, `alterar`, `f`, `enviado` nem `aviso` | — | a partir de `alterar=0`, clicar em outro dia: a URL não tem `h*` |
| CA-8 | `passos.test.ts`: as 8 linhas da RN-12 em `lerPasso` | as 8 linhas em `carregarPasso` (passo e semana certos) | `publico-faixa-dias`: GET de cada linha com status 200 |
| CA-9 | — | `alterar=0` com 3 itens: faixa marcada, `preSelecionado`, demais em `escolhidos` | `publico-faixa-dias` |
| CA-10 | `hrefOutroDia` (s, de = data, âncora) | `lerPasso({ s, de: D })` → semana de D, sem dia | k ≥ 1 → "Escolher outro dia" |
| CA-11 | `PaginaDoSalao.test.tsx` (`Alert` antes da régua no DOM) | `enviado=0` sem `h0` → `sem_selecao` com faixa; dados com o item 0 caído → serviço 0 com faixa e `horario_indisponivel` | `publico-conflito-captcha` e `reserva-publica-sem-js` adaptados |
| CA-12 | `faixa.test.ts` (`estadoSemDia`: com próxima, última, única) | semana sem nenhum dia oferecido: as mesmas 6 instruções de uma semana com horário | vitrine `?vista=semana-vazia` (axe) |
| CA-13 | — | — | (a) sem JS, fluxo completo; (b) só teclado com foco visível; (c) 375×812 `isMobile`/`hasTouch`; (d) axe nos 3 estados |
| CA-14 | — | `faixa.test.ts` novo: contador `instalarContadorDeComandos` → `'dia'` = 6, serviço 0 = 12 para 1/3/10 serviços × 1/8 profissionais × com e sem itens; semana navegada = 6; limite excedido = 1 comando (o contador) e `limitado`; `pagina-limite.test.ts` com `'dia'` | — |
| CA-15 | `passos.test.ts`/`faixa.test.ts` com `TZ=UTC` e `TZ=America/Sao_Paulo` | `faixa.test.ts`: salão em `America/Manaus` e em `America/Noronha` com `agora` 5 min antes e 5 min depois da meia-noite local | — |
| CA-16 | `passos.test.ts`/`faixa.test.ts`: as chaves dos href são um subconjunto de `s,data,de` | — | varredura das URLs visitadas, sem `nome`/`telefone`/consentimento |
| CA-17 | `dados.test.ts` e `page.test.tsx` (as 3 vistas) | — | `reserva-publica-faixa` (vitrine) |
| CA-18 | suíte atual | suíte atual | suíte `publico-*`, `reserva-publica*`, `tester-d050` adaptada |

**Critérios visuais do web-design §9** (spec nova da vitrine `e2e/reserva-publica-faixa.spec.ts`, sem banco):

| Critério | Verificação |
|---|---|
| 1, 2, 3 | Geometria com `getBoundingClientRect` em 375, 768 e 1280 px. |
| 4 | Em 320 px: Tab até o 7º dia e `toBeInViewport`. Numa semana vazia, o grupo é focável e o axe não acusa nada. |
| 5, 7, 8 | Estilos computados: `font-family` do número, `text-decoration-line`, fundo e `box-shadow`. |
| 6, 11, 12, 18, 19 | Papéis, nomes e textos exatos. |
| 9, 10 | `tabAte` com foco visível e ordem de Tab. |
| 13 | Ordem no DOM. |
| 14 | Todos os `href` terminam em `#reservar`; após a navegação, o `h2` fica `toBeInViewport`. |
| 15 | Testes de conformidade existentes. |
| 16 | axe. |
| 17 | Spec sem JS. |

O critério 7 em escala de cinza é conferido pelo tester na captura.

**Cobertura ≥ 90%.** Todo código novo é puro (`format.ts`, `passos.ts`, `faixa.ts`) ou é renderização com teste jsdom
(`FaixaDeDias`, `Passos`/`PaginaDoSalao`), além de `pagina.ts`, coberto pela integração. O código removido
(`PassoData`, o ramo `'data'`) leva junto os seus testes. Nenhuma exclusão nova. O gate é `npm run test:coverage`.

**Comandos novos (entram no CLAUDE.md, T-8):**
- `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/reserva-publica "src/app/(publico)/[slug]/_componentes/faixa.test.ts" src/lib/format.test.ts || break; done`
- `for i in $(seq 10); do npx vitest run --project integration tests/integration/reserva-publica/faixa.test.ts tests/integration/reserva-publica/passos.test.ts tests/integration/protecao/pagina-limite.test.ts || break; done`

---

## 9. Tarefas

### Rodadas e paralelismo

- **Rodada 1 (paralelas, sem arquivos em comum):** T-1, T-2 e T-3.
- **Rodada 2:** T-4, que depende de T-1, T-2 e T-3. T-5 depende de T-3 e T-4 (renderiza `PaginaDoSalao`). T-6 depende de
  T-3 e pode correr em paralelo com T-4 e T-5.
- **Rodada 3:** T-7, que depende de T-4 e T-5 (precisa do build).
- **Rodada 4:** T-8.

Todas são do **desenvolvedor**. Não há tarefa de DBA nem de DevOps. Por R-2, T-3, T-4 e T-5 são executadas pela mesma
pessoa e só se exige o typecheck verde ao fim da T-5.

### T-1 — Formatadores curtos
- Dependências: nenhuma.
- Posse: `src/lib/format.ts`, `src/lib/format.test.ts`.
- Entregável: `formatarDiaDaSemanaCurto` e `formatarDiaEMesCurtos` (§3.1), com `RangeError` para entradas inválidas.
- Conclusão: testes do formato em `TZ=UTC` e `TZ=America/Sao_Paulo`, cobrindo os 7 dias, os 12 meses, dia sem zero à
  esquerda e chaves inválidas (`2026-02-30`, `x`). `src/lib/format.fonte-unica.test.ts` verde.

### T-2 — Componente `FaixaDeDias` e vitrine de componentes
- Dependências: nenhuma (só recebe texto).
- Posse: `src/components/ui/FaixaDeDias.tsx`, `FaixaDeDias.module.css`, `FaixaDeDias.test.tsx` (novos),
  `src/app/dev/componentes/Vitrine.tsx`, `Vitrine.test.tsx`.
- Entregável:
  - o componente do §3.5, com a anatomia e os estados do web-design §4.1 e o CSS do §3.3/§5.5 (sem a sangria, que é
    do contexto);
  - a regra C2;
  - na vitrine, 4 exemplos: semana com dia selecionado, semana toda sem horário, última semana com 5 dias e "marcado
    sem horário".
- Conclusão:
  - `FaixaDeDias.test.tsx` (jsdom) prova: `<a>` × `<span>`, `aria-current`, nomes acessíveis, nav ausente nos limites,
    `<nav>` ausente sem links, colunas vazias sem `<li>`, `tabindex`/`role="group"` só na semana vazia;
  - o teste de conformidade de `src/components` está verde, sem cor literal e sem outra media query.

### T-3 — Servidor do fluxo público (derivação, tipos e carga)
- Dependências: nenhuma.
- Posse: `src/server/reserva-publica/passos.ts`, `passos.test.ts`, `tipos.ts`, `tipos.test.ts`, `pagina.ts`.
- Entregável: §3.2, §3.3 e §3.4. Sai `'data'`, entra `'dia'`. Entram `inicioDaSemana`, `limitesDaSemana`,
  `hrefDoDia`, `hrefDaSemana`, `ANCORA_RESERVA`, `DIAS_POR_SEMANA` (`DIAS_POR_PAGINA` sai), a âncora em `hrefOutroDia`,
  `diasDaFaixa`, `carregarFaixa`, `faixa` em `'servico'` e os textos novos de `MENSAGENS_PASSO`.
- Conclusão: `passos.test.ts` cobre a RN-12 inteira, as semanas (CA-3), os href (CA-5, CA-7, CA-10, CA-16) e a ida e
  volta, verde em dois `TZ`. `tipos.test.ts` confere os textos exatos do web-design §6.

### T-4 — UI da página pública
- Dependências: T-1, T-2, T-3.
- Posse: `src/app/(publico)/[slug]/_componentes/Passos.tsx`, `faixa.ts` e `faixa.test.ts` (novos), `PaginaDoSalao.tsx`,
  `PaginaDoSalao.test.tsx`, `Salao.module.css`.
- Entregável: §3.6 (`PassoDia`, `CabecalhoDoPasso`, faixa e bloco de horários no serviço 0, sem "Escolher outro dia" no
  passo 0, fim de `PassoData` e das classes `.dias`/`.dia`, `.faixaNoCartao`, `.horarios`, `scroll-margin`).
- Conclusão:
  - `faixa.test.ts` verde em dois `TZ` (CA-1, CA-7, CA-12, CA-16);
  - `PaginaDoSalao.test.tsx` cobre CA-1, CA-4, CA-11 (ordem do `Alert`) e os passos k ≥ 1 sem faixa e com "Escolher
    outro dia" (CA-6, critério 18);
  - `FormularioDados.test.tsx` segue verde sem alteração.

### T-5 — Vitrine `/dev/reserva`
- Dependências: T-3, T-4.
- Posse: `src/app/dev/reserva/dados.ts`, `dados.test.ts`, `page.tsx`, `page.test.tsx`.
- Entregável: §3.7 (`'dia'` fabricado, faixa no serviço 0 e no recuo do item 0, `?vista=semana-vazia`).
- Conclusão:
  - `dados.test.ts` e `page.test.tsx` verdes cobrindo as 3 vistas do CA-17 e a última semana;
  - `npm run typecheck`, `npm run lint` e `npm run build` verdes (fecha R-2);
  - `npm run test:unit` verde.

### T-6 — Testes de integração
- Dependências: T-3 (pode começar em paralelo com T-4 e T-5).
- Posse: `tests/integration/reserva-publica/passos.test.ts`, `fluxo-itens.test.ts`, `pagina.test.ts`,
  `tests/integration/protecao/pagina-limite.test.ts`, novo `tests/integration/reserva-publica/faixa.test.ts`.
- Entregável:
  - o teste "passo `data` (DA-2)" migra para `'dia'` com 7 dias, e o resto de `passos.test.ts` mantém as asserções da
    D-050;
  - `faixa.test.ts` cobre: CA-14 (contagens exatas do §3.4 na matriz 1/3/10 serviços × 1/8 profissionais × com e sem
    itens, e o limite excedido); CA-8 (as 8 linhas em `carregarPasso`); CA-9; CA-11; CA-12; CA-15 (Manaus e Noronha
    perto da meia-noite); isolamento (a faixa do salão A não reflete as reservas do salão B);
  - `pagina-limite.test.ts` ganha o caso `'dia'`, que consome uma cota.
- Conclusão: `npm run test:integration` verde e o laço de 10 rodadas do §8 verde.

### T-7 — E2E
- Dependências: T-4, T-5 (build).
- Posse: `e2e/suporte/publico.ts`, `e2e/reserva-publica.spec.ts`, `e2e/reserva-publica-sem-js.spec.ts`,
  `e2e/publico-reserva.spec.ts`, `e2e/publico-reserva-teclado.spec.ts`, `e2e/publico-conflito-captcha.spec.ts`,
  `e2e/tester-d050.spec.ts`, novos `e2e/reserva-publica-faixa.spec.ts` (vitrine, sem banco) e
  `e2e/publico-faixa-dias.spec.ts` (banco).
- Entregável:
  - Em `publico.ts`:
    - `linkDoDia` passa a usar `getByRole('list', { name: /^Escolha o dia/ })` e um nome que **contém** `dd/mm/aaaa`;
    - `escolherDia` espera o `h2` do 1º serviço e o `h3` "Escolha o dia", e avança "Próxima semana" até achar o dia,
      no máximo 10 vezes (R-3);
    - um helper `irParaSemanaDoDia` serve aos specs de teclado.
  - Os specs existentes adaptam só a navegação até o dia (CA-18), e os `tabAte(linkDoDia)` passam a contar com a
    navegação de semana quando o dia está além de hoje+6.
  - `reserva-publica-faixa.spec.ts` cobre os critérios visuais do §8 e CA-3, CA-4, CA-12, CA-13 (b, c, d) e CA-17.
  - `publico-faixa-dias.spec.ts` (banco, salões `e2e-reservas-N` ainda livres, sem disputar vaga com os outros specs)
    cobre CA-5, CA-7, CA-8 (HTTP 200 das 8 linhas), CA-9, CA-10, CA-13 (a) e CA-16.
- Conclusão: `npm run test:e2e` verde (porta livre, uma execução por vez), com axe sem violações nos 3 estados.

### T-8 — Documentação
- Dependências: T-1 a T-7.
- Posse: `CLAUDE.md`.
- Entregável: parágrafo D-051 no "Project status", com:
  - o passo `'dia'` e a faixa só no serviço 0;
  - as semanas alinhadas a hoje (`inicioDaSemana`/`limitesDaSemana`) e o `#reservar`;
  - a contagem de 6/12 instruções;
  - `FaixaDeDias` e `faixa.ts`, os formatadores curtos e `?vista=semana-vazia`;
  - as URLs antigas compatíveis.

  Mais as 2 linhas de comando do §8 na tabela. O README não descreve o passo `data` (verificado: nenhuma ocorrência de
  "Escolha o dia"), então fica como está.
- Conclusão: o texto do CLAUDE.md bate com o código entregue e nenhum comando citado deixou de existir.

### Mapa CA → tarefa

| CA | Tarefas |
|---|---|
| CA-1 | T-2, T-3, T-4, T-7 |
| CA-2 | T-2, T-4, T-6, T-7 |
| CA-3 | T-3, T-5, T-7 |
| CA-4 | T-4, T-7 |
| CA-5 | T-3, T-6, T-7 |
| CA-6 | T-4, T-6, T-7 |
| CA-7 | T-4, T-7 |
| CA-8 | T-3, T-6, T-7 |
| CA-9 | T-6, T-7 |
| CA-10 | T-3, T-6, T-7 |
| CA-11 | T-4, T-6, T-7 |
| CA-12 | T-4, T-5, T-6, T-7 |
| CA-13 | T-2, T-4, T-7 |
| CA-14 | T-3, T-6 |
| CA-15 | T-1, T-3, T-4, T-6 |
| CA-16 | T-3, T-4, T-7 |
| CA-17 | T-2, T-5, T-7 |
| CA-18 | T-6, T-7 |
