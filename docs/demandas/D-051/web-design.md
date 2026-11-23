# D-051 (issue #113): Web design da página com dia e horário juntos

Autor: web-designer. Data: 23/11/2026. Entrada: `docs/demandas/D-051/spec.md` (RN-1..RN-20, CA-1..CA-18, ND-1..ND-8).
Base visual: `docs/demandas/D-050/web-design.md` ("roteiro do dia"). Tela: fluxo público `/{slug}`, passo do 1º serviço
(índice 0) e vitrine `/dev/reserva`.

**Capturas da tela atual.** Feitas com `next dev -p 3117` (o build em `.next` era de 22/11, anterior à D-050, e por isso
não serviu), na vitrine `/dev/reserva` com Escova, Hidratação e Manicure. O servidor foi derrubado no fim e a porta 3000
não foi usada. As capturas ficam **fora do repositório**, em
`/tmp/claude-1000/-home-cliente--rea-de-Trabalho-agenda-beleza/2e6dae46-31c7-4a7a-9359-044d685683b4/scratchpad/cap/`:
`data-{375,768,1280}.png` (passo `data` atual) e `servico-{375,768,1280}.png` (passo do serviço 0 em 24/11/2026).
Nenhuma tem rolagem horizontal (`scrollWidth` = largura nas três larguras).

Medidas tiradas das capturas, que servem de base para as decisões de largura abaixo:

| Medida | 375 px | 768 px | 1280 px |
|---|---|---|---|
| Topo do cartão `.reserva` (perfil e fotos acima) | 327 px | 258 px | 258 px |
| Largura do cartão `.reserva` | 343 px | 704 px | 1088 px |
| Largura interna (cartão − 2 × 16 px de padding − 2 × 1 px de borda) | **309 px** | 670 px | 1054 px |
| Altura da página no passo `data` | 2670 px | 2545 px | 2545 px |
| Altura da página no passo do serviço 0 | 3355 px | 2662 px | 2506 px |

---

## 1. Diagnóstico

O que já funciona e fica: a paleta terrosa com contraste folgado, a Fraunces nos títulos, o roteiro "Seu dia", o
`SlotGrid` (rádios nativos de 44 px, uma parada de Tab por serviço), o filtro em pílulas e o fluxo inteiro em GET/POST
sem JavaScript.

| # | Problema | Evidência |
|---|---|---|
| P1 | **Uma página inteira só para o dia.** A lista vertical de 14 caixas ocupa cerca de 730 px em 375 px. Para comparar dois dias, a cliente abre a página do serviço 0, volta pela lista e abre outra página: duas navegações e dois recarregamentos por tentativa. | `Passos.tsx:190-225` (`PassoData`); `Salao.module.css` `.dias`/`.dia`; `data-375.png` (14 caixas de 52 px). |
| P2 | **O dia escolhido some depois que a cliente sai da lista.** No passo do serviço só aparece o título "Terça-feira, 24/11/2026" do roteiro, sem a semana em volta, e a única saída é o link de texto "Escolher outro dia", no fim de um cartão de 2000 px. | `Passos.tsx:296-298` (`RoteiroDoDia titulo=rotuloDoDia`) e `:309-311`; `servico-375.png` (o link fica abaixo de 26 linhas de horários). |
| P3 | **Dias sem horário parecem texto quebrado.** O sufixo "(sem horários)" alonga a linha, o único sinal de "não clicável" é a falta de sublinhado, e o rótulo completo repetido 14 vezes torna a lista difícil de escanear. | `Passos.tsx:205-207`; `data-375.png`. |
| P4 | **O dia da semana não é o protagonista.** "Terça-feira, 24/11/2026" põe o dia da semana e a data com o mesmo peso. Quem marca horário pensa em "sábado de manhã", e na lista atual o olho não encontra o sábado sem ler cada linha. | `data-375.png`. |
| P5 | **Recarregar leva ao topo.** Os links de dia não têm âncora, então no celular cada clique recarrega a página 327 px acima do cartão de reserva (perfil e fotos). Num salão com fotos, a distância é ainda maior. | `montarHref(base, { s, data })` em `Passos.tsx:204`; medida "topo do cartão" acima. |
| P6 | **A navegação de período é vaga.** "Dias anteriores" e "Próximos dias" não dizem quantos dias nem quais. | `Passos.tsx:211-220`. |
| P7 | **Em 375 px não cabem 7 caixas separadas de 44 px.** A largura interna é de 309 px. Sete alvos de 44 px (`--alvo-minimo`) com 6 vãos de 4 px somam 332 px. A faixa precisa de outra solução de largura, vista na §3.3. | Medida "largura interna" acima; `--alvo-minimo: 2.75rem` em `globals.css`. |

## 2. Direção visual: a "régua da semana"

**Conceito.** A semana vira uma **régua**: uma faixa fina de sete colunas iguais, separadas por traços finos, com o dia da
semana no alto, o **número do dia em Fraunces** no meio e o mês abaixo. Cada coluna parece uma folha de calendário de
mesa. O dia escolhido fica "carimbado", com fundo `--cor-primaria-forte` e uma barra de 3 px na base. O dia sem horário
fica rente à régua, com o número riscado. Abaixo da régua, separada por um traço, vem a seção de horários, que continua
sendo o "roteiro do dia" da D-050.

**Por que serve.** A cliente pensa na semana pelo nome do dia ("sábado") e pelo número ("dia 5"). A régua põe as duas
coisas numa linha só e cabe inteira em 375 px, sem rolagem interna (§3.3). O traço fino retoma a linguagem do roteiro
(régua vertical com pontos), então dia e horário parecem uma peça só, e não dois componentes empilhados. O número em
Fraunces repete o uso do horário em Fraunces das paradas do roteiro (D-050 §2), e com isso os números do dia e da hora
passam a ter a mesma voz.

**O que muda na identidade.** Nenhum token novo e nenhuma fonte nova. Entram um elemento próprio (a régua) e dois
formatos curtos de data em `src/lib/format.ts`.

**Alternativas descartadas.**
- *Sete caixas soltas com bordas e vãos* (como as pílulas do filtro): não cabem em 375 px com alvos de 44 px (P7) e
  repetiriam o padrão de caixas que já pesa no cartão.
- *Carrossel com rolagem horizontal fixa e setas*: corta dias em 375 px e exige JavaScript para as setas.
- *Calendário mensal*: está fora do escopo (spec §3) e é ilegível sem JavaScript em 375 px.
- *Lista vertical de 7 dias acima dos horários*: empurraria a grade 360 px para baixo e manteria P3 e P4.
- *Duas colunas no desktop (dias à esquerda, horários à direita)*: a spec pede a faixa horizontal com os horários abaixo,
  e a grade de horários perderia a largura que hoje mostra 11 horários por linha (`servico-1280.png`).

## 3. Sistema

### 3.1 Cores: nenhum token novo

As razões abaixo foram calculadas com a luminância relativa da WCAG 2.x e os valores atuais do `:root` de
`src/app/globals.css`.

| Uso | Texto ou elemento | Fundo | Razão | Mínimo |
|---|---|---|---|---|
| Número de um dia disponível | `--cor-primaria-forte` | `--cor-superficie` | 7,79 | 4,5 (texto grande: 3,0) |
| Dia da semana e mês de um dia disponível | `--cor-texto-suave` | `--cor-superficie` | 7,22 | 4,5 |
| Texto de um dia sem horário (número riscado, dia da semana, mês) | `--cor-texto-suave` | `--cor-superficie-alt` | 6,21 | 4,5 (inativo é isento; mantido) |
| Todo o texto do dia selecionado | `--cor-sobre-primaria` | `--cor-primaria-forte` | 7,62 | 4,5 |
| Dia selecionado em relação ao vizinho disponível (forma, 1.4.11) | `--cor-primaria-forte` | `--cor-superficie` | 7,79 | 3,0 |
| Dia selecionado em relação ao vizinho sem horário | `--cor-primaria-forte` | `--cor-superficie-alt` | 6,69 | 3,0 |
| Barra de hover na base de um dia disponível | `--cor-borda-controle` | `--cor-superficie` | 4,39 | 3,0 |
| Contorno de "marcado sem horário" (RN-8) | `--cor-primaria-forte` | `--cor-superficie-alt` | 6,69 | 3,0 |
| Foco em um dia não selecionado | `--cor-foco` | `--cor-superficie` / `--cor-superficie-alt` | 18,45 / 15,85 | 3,0 |
| Foco no dia selecionado (anel interno claro) | `--cor-sobre-primaria` | `--cor-primaria-forte` | 7,62 | 3,0 |
| Período "29/11/2026 a 05/12/2026" | `--cor-texto-suave` | `--cor-superficie` | 7,22 | 4,5 |
| Links "Semana anterior" e "Próxima semana" | `--cor-primaria-forte` | `--cor-superficie` | 7,79 | 4,5 |
| Traços da régua (divisórias e bordas) | `--cor-borda-sutil` | `--cor-superficie` | decorativo | (não se aplica: a forma de cada dia é dada pelo fundo e pelo texto) |

### 3.2 Tipografia

| Elemento | Família | Tamanho | Peso | Entrelinha | Observação |
|---|---|---|---|---|---|
| `h3` "Escolha o dia" | `--fonte-titulo` (Fraunces) | `--texto-xl` | 500 | `--altura-linha-titulo` | regra global de `h3` |
| Período da semana | `--fonte-corpo` | `--texto-sm` | 400 | 1.4 | `font-variant-numeric: tabular-nums` |
| Dia da semana curto ("Ter", ou "Hoje") | `--fonte-corpo` | `--texto-sm` | 600 | 1.3 | sem caixa alta |
| Número do dia ("1", "29") | `--fonte-titulo` | `--texto-xl` | 500 (600 no selecionado) | 1.1 | `tabular-nums`; `font-optical-sizing: auto` |
| Mês curto ("dez") | `--fonte-corpo` | `--texto-sm` | 400 | 1.3 | minúsculo |
| Links de semana | `--fonte-corpo` | `--texto-base` | 600 | `--altura-linha` | |

### 3.3 Larguras e grade da régua

- **Celular (< 48rem).** A régua **sangra até a borda interna do cartão**: `margin-inline: calc(-1 * var(--espaco-4))`,
  sem padding lateral. Em 375 px a largura útil é 309 + 32 = **341 px**, e cada coluna tem 341 / 7 = **48,7 px**
  (≥ 44 px). Em 360 px, que é comum em Android, são 326 / 7 = 46,6 px. A régua não tem vão. As colunas são separadas
  por `border-inline-start: 1px solid var(--cor-borda-sutil)` (com `box-sizing: border-box`, o traço fica dentro da
  coluna). Em cima e embaixo há `border-block: 1px solid var(--cor-borda-sutil)`, e não há borda lateral nem raio,
  porque a régua encosta na borda do cartão.
- **Colunas:** `grid-template-columns: repeat(7, minmax(var(--alvo-minimo), 1fr))`, **sempre 7**, mesmo na última
  semana com menos dias (ND-5): as colunas que sobram ficam vazias, sem elemento nem fundo, entre os dois traços da
  régua. Assim, cada dia da semana tem sempre a mesma largura.
- **Rolagem interna só como salvaguarda (RN-18):** o invólucro da régua tem `overflow-x: auto` e
  `scroll-snap-type: x proximity`, e cada dia tem `scroll-snap-align: start`. Em 375 px e 360 px **não há rolagem**. Ela
  só aparece abaixo de cerca de 340 px (por exemplo 320 px, onde a largura útil é de 286 px, menor que 7 × 44 = 308 px)
  ou com o texto ampliado. O documento nunca rola na horizontal.
- **Desktop (≥ 48rem):** sem sangria (`margin-inline: 0`), `max-width: 36rem` (576 px, cerca de 82 px por coluna), com
  borda de 1 px nos quatro lados, `border-radius: var(--raio)` e `overflow: hidden` no invólucro. A régua fica alinhada
  à esquerda, com a mesma largura de `.apoio`.
- **Altura de cada dia:** `padding-block: var(--espaco-2)`, com três linhas. O resultado fica em torno de 76 px, sempre
  maior que `--alvo-minimo`.

### 3.4 Espaçamento, raios, sombras

- Bloco do dia: `gap: var(--espaco-3)` entre o cabeçalho (título e período), a régua, a navegação de semanas e o texto
  de apoio.
- Separação entre o bloco do dia e o bloco de horários: `border-block-start: 1px solid var(--cor-borda-sutil)` e
  `padding-block-start: var(--espaco-4)` no bloco de horários. A função do traço é separar a decisão "qual dia" da
  decisão "qual horário".
- Nenhuma sombra. O único raio novo é o da régua no desktop (`--raio`).

## 4. Componentes

### 4.1 `FaixaDeDias` (novo, `src/components/ui/FaixaDeDias.tsx` + `FaixaDeDias.module.css`)

O componente fica genérico: recebe **só texto e dados serializáveis**, sem funções e sem `@/server`, porque o teste de
conformidade proíbe `@/server` em `src/components`. A página monta os textos com `src/lib/format.ts`. É um componente de
servidor, sem `'use client'`.

Props propostas (os nomes finais ficam com o arquiteto):
```
idTitulo: string                 // id do h3, ex. "reservar-dia"
titulo: string                   // "Escolha o dia"
periodo: string                  // "29/11/2026 a 05/12/2026" (já formatado)
dias: {
  chave: string                  // 'AAAA-MM-DD'
  semana: string                 // "Ter" ou "Hoje"
  dia: string                    // "1"
  mes: string                    // "dez"
  rotulo: string                 // nome acessível completo (§4.1, semântica)
  href: string | null            // null = sem horário (não é link)
  atual: boolean                 // aria-current="date"
}[]
anterior: string | null          // href ou null (link ausente)
proxima: string | null
apoio?: string                   // MENSAGENS_PASSO.diaComHorarios
```

**Anatomia (ordem do DOM = ordem visual = ordem de Tab):**
```
<div class="faixa">
  <div class="cabecalho">
    <h3 id="reservar-dia">Escolha o dia</h3>
    <p id="reservar-periodo" class="periodo">29/11/2026 a 05/12/2026</p>
  </div>
  <div class="rolagem">
    <ol class="regua" aria-labelledby="reservar-dia reservar-periodo">
      <li>                                     <!-- dia disponível -->
        <a href="…#reservar" class="dia" [aria-current="date"]>
          <span aria-hidden="true" class="semana">Ter</span>
          <span aria-hidden="true" class="numero">1</span>
          <span aria-hidden="true" class="mes">dez</span>
          <span class="visualmente-oculto">Terça-feira, 01/12/2026</span>
        </a>
      </li>
      <li>                                     <!-- dia sem horário -->
        <span class="dia semHorario" [aria-current="date"]>
          … mesmas três linhas aria-hidden …
          <span class="visualmente-oculto">Domingo, 29/11/2026, sem horários</span>
        </span>
      </li>
    </ol>
  </div>
  <nav aria-label="Semanas" class="semanas">
    <ul>
      <li class="anterior"><a href="…#reservar"><span aria-hidden="true">←</span> Semana anterior</a></li>
      <li class="proxima"><a href="…#reservar">Próxima semana <span aria-hidden="true">→</span></a></li>
    </ul>
  </nav>
  <p class="apoio">Um dia aparece disponível quando cada serviço tem ao menos um horário livre nele.</p>
</div>
```

**Nome acessível de cada dia** (RN-2, CA-1, CA-2): `rotuloDoDia(chave)`, ou seja, "Terça-feira, 01/12/2026". Recebe o
sufixo ", hoje" quando o dia é hoje e o sufixo ", sem horários" quando não é link. Exemplo: "Domingo, 29/11/2026, hoje,
sem horários". As três linhas visíveis ficam `aria-hidden`, para o leitor não repetir "Ter 1 dez". Veja a ressalva de
"rótulo no nome" no §10.

**Estados de um dia:**

| Estado | Elemento | Fundo | Texto | Forma (além da cor) |
|---|---|---|---|---|
| Disponível | `<a>` | `--cor-superficie` | número `--cor-primaria-forte`; semana e mês `--cor-texto-suave` | sem risco; cursor de link |
| Hover (disponível, não selecionado) | | igual | número sublinhado (`text-underline-offset: 0.15em`) | barra interna de 3 px na base em `--cor-borda-controle` (`box-shadow: inset 0 -3px 0 var(--cor-borda-controle)`) |
| Foco (`:focus-visible`) | | igual | igual | `outline: var(--foco-largura) solid var(--cor-foco)` com `outline-offset: calc(-1 * var(--foco-largura))`. O contorno fica **interno**, porque o invólucro com `overflow` cortaria um contorno externo, e os dias são colados |
| Selecionado (`[aria-current='date']`) | `<a>` | `--cor-primaria-forte` | tudo `--cor-sobre-primaria`; número em peso 600 | barra interna de 3 px na base em `--cor-sobre-primaria` (`box-shadow: inset 0 -3px 0 var(--cor-sobre-primaria)`). O sinal combina luminância (≥ 6,69:1 contra os vizinhos), peso e barra, e não depende só do matiz |
| Selecionado com foco | | igual | igual | contorno interno em `--cor-sobre-primaria` (7,62:1), porque `--cor-foco` sobre `--cor-primaria-forte` não contrasta |
| Ativo (`:active`) | | `--cor-superficie-alt` | igual | (resposta tátil) |
| Sem horário | `<span>` | `--cor-superficie-alt` | tudo `--cor-texto-suave`; número com `text-decoration: line-through` (1px) | sem link, fora do Tab, `cursor: default` |
| Marcado e sem horário (RN-8, ND-6) | `<span aria-current="date">` | `--cor-superficie-alt` | `--cor-texto-suave`, número riscado | contorno interno de 3 px em `--cor-primaria-forte` (`box-shadow: inset 0 0 0 3px var(--cor-primaria-forte)`) |
| Desabilitado (formulário) | não se aplica | | | |

**Hoje:** a linha de cima mostra "Hoje" no lugar do dia da semana curto. Ela aparece só na semana 0, e o dia mantém
todas as regras do seu estado.

**Navegação de semanas (RN-5):** dois links de texto em `--cor-primaria-forte`, peso 600, sublinhados, com
`min-height: var(--alvo-minimo)` e `display: inline-flex; align-items: center`. A lista usa
`display: flex; flex-wrap: wrap; gap: var(--espaco-2) var(--espaco-6)`, e "Próxima semana" leva
`margin-inline-start: auto`, para ficar à direita mesmo sem "Semana anterior". **Nos limites, o link é omitido**: nada é
renderizado, nem um texto inerte. Se os dois faltarem (janela de 1 dia), o `<nav>` não é renderizado. Os textos
visíveis e os nomes acessíveis são exatamente "Semana anterior" e "Próxima semana", e as setas ficam `aria-hidden`.

**Teclado:** Tab percorre os dias disponíveis, inclusive o selecionado, da esquerda para a direita, e depois "Semana
anterior" e "Próxima semana". Os dias sem horário não recebem foco. Não há setas nem roving tabindex: são links comuns,
sem JavaScript. Ao receber foco dentro do invólucro com rolagem (< 340 px), o navegador rola o dia até a área visível.

**Reaproveita:** `.visualmente-oculto` de `globals.css`, os tokens existentes e o `rotuloDoDia` (`Passos.tsx`), que monta
o nome acessível.

### 4.2 Formatadores novos em `src/lib/format.ts` (único lugar que formata datas)

- `formatarDiaDaSemanaCurto(dia: 0..6)`: "Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb". Lança `RangeError` como
  `formatarDiaDaSemana`. O dia da semana continua saindo de `diaDaSemana` (domínio, RN-20).
- `formatarDiaEMesCurtos(chave 'AAAA-MM-DD')`: `{ dia: '1', mes: 'dez' }`. O dia vem sem zero à esquerda, e os meses são
  "jan fev mar abr mai jun jul ago set out nov dez". Lança `RangeError` para uma chave inválida, como
  `formatarDataCivil`.
- O período usa os existentes: `${formatarDataCivil(inicio)} a ${formatarDataCivil(fim)}`.

Os nomes finais ficam com o arquiteto. O que importa é que nenhum dos dois formatos seja montado fora de `format.ts`.

### 4.3 `PassoServico` (alterado, `Passos.tsx`) e textos em `MENSAGENS_PASSO` (`tipos.ts`)

Só o passo com `indice === 0` ganha a régua, o resumo e os estados novos. Os passos k ≥ 1 ficam iguais à D-050.

Textos novos (pt-BR, exatos):

| Chave sugerida | Texto |
|---|---|
| `escolhaODia` (h3 da régua) | Escolha o dia |
| `semanaAnterior` | Semana anterior |
| `proximaSemana` | Próxima semana |
| `semDiaTitulo` | Escolha um dia para ver os horários |
| `semDiaTexto(servico)` | Os horários de {serviço} aparecem aqui, separados por profissional. |
| `semanaVaziaTitulo` | Nenhum dia desta semana tem horário |
| `semanaVaziaComProxima` | Veja a próxima semana ou altere os serviços. |
| `semanaVaziaUltima` (há anterior, não há próxima) | Esta é a última semana aberta para reservas. Volte à semana anterior ou altere os serviços. |
| `semanaVaziaUnica` (nem anterior nem próxima) | Não há dias abertos para reservas agora. Altere os serviços ou tente mais tarde. |
| sufixos do nome acessível | ", hoje" e ", sem horários" |

`diaComHorarios`, `semSelecao`, `horarioPerdido`, `vazioCalendario*`, `vazioConflito*`, `continuar` e
`continuarParaDados` não mudam.

### 4.4 Removidos

`PassoData` (`Passos.tsx:190-225`), as classes `.dias` e `.dia` de `Salao.module.css` (inclusive o `.dias` dentro do
`@media`) e o link "Escolher outro dia" **só no passo 0** (RN-14).

## 5. Especificação da tela: passo do 1º serviço ("Serviço 1 de N")

Exemplo: Escova, Hidratação e Manicure; hoje é domingo, 29/11/2026; Ana e Bia fazem Escova.

### 5.1 Ordem (celular e desktop, igual no DOM)

1. Indicador "Serviço 1 de 3" (`.indicador`, sem mudança)
2. `h2#reservar` "Escova" (com `aria-describedby` do indicador, sem mudança)
3. "1 h · R$ 90,00" (`.suave`)
4. Aviso (`Alert variante="aviso"`), só quando houver (RN-15)
5. `ResumoDaSelecao`: "Escova · Hidratação · Manicure" / "3 serviços · R$ 205,00" (bloco `--cor-superficie-alt`, sem
   mudança)
6. `FaixaDeDias` (título, período, régua, semanas, apoio)
7. Bloco de horários (com traço no topo): estado "sem dia", estado "semana vazia" ou o conteúdo da D-050 (roteiro "Seu
   dia", filtro, grades, "Continuar")
8. `CamposOcultos`, invisíveis, em qualquer posição do `<form>`
9. Navegação final: só "Alterar serviços"

Ordem de Tab com dia escolhido: dias disponíveis → "Semana anterior" → "Próxima semana" → links "Alterar" do roteiro
(quando houver itens escolhidos) → filtro de profissional → grade de horários (uma parada) → "Continuar" → "Alterar
serviços".

### 5.2 Celular (375 × 812), sem dia escolhido (RN-7, CA-4)

```
┌ cartão .reserva (343 px) ───────────────────────┐
│ Serviço 1 de 3                                  │
│ Escova                               (h2, 1.75) │
│ 1 h · R$ 90,00                                  │
│ ┌ resumo (superficie-alt) ─────────────────────┐│
│ │ Escova · Hidratação · Manicure               ││
│ │ 3 serviços · R$ 205,00                       ││
│ └──────────────────────────────────────────────┘│
│ Escolha o dia                         (h3, 1.375)│
│ 29/11/2026 a 05/12/2026                 (sm suave)│
├─────┬─────┬─────┬─────┬─────┬─────┬─────┤ ← régua sangrando até a borda
│Hoje │ Seg │ Ter │ Qua │ Qui │ Sex │ Sáb │
│ 2̶9̶  │ 30  │  1  │  2  │  3  │  4  │  5  │   (número em Fraunces 1.375)
│ nov │ nov │ dez │ dez │ dez │ dez │ dez │
├─────┴─────┴─────┴─────┴─────┴─────┴─────┤
│                       Próxima semana →     │
│ Um dia aparece disponível quando cada      │
│ serviço tem ao menos um horário livre nele.│ (sm suave)
│ ───────────────────────────────────────────│ (traço borda-sutil)
│ ┌ EmptyState (tracejado) ───────────────────┐│
│ │  Escolha um dia para ver os horários  (h3)││
│ │  Os horários de Escova aparecem aqui,     ││
│ │  separados por profissional.              ││
│ └───────────────────────────────────────────┘│
│ Alterar serviços                            │
└─────────────────────────────────────────────┘
```
Sem filtro, sem grade, sem "Continuar" e sem roteiro. Nenhum dia tem `aria-current`. Na semana 0 não existe "Semana
anterior". A coluna "Hoje" está riscada porque, no exemplo, a antecedência já passou (§6 da spec).

### 5.3 Celular, com dia escolhido (RN-8, CA-5)

Tudo igual a 5.2 até o texto de apoio. A coluna "Ter 1 dez" aparece selecionada (fundo escuro e barra clara na base).
Depois do traço vem exatamente o conteúdo da D-050:
```
│ ───────────────────────────────────────────│
│ Seu dia · Terça-feira, 01/12/2026     (h3) │  RoteiroDoDia (sem mudança)
│  —  ● Escova       escolhendo agora        │
│  —  ○ Hidratação   a escolher              │
│  —  ○ Manicure     a escolher              │
│ [Todos (2)] [Ana] [Bia]                    │  FiltroDeProfissional (2+)
│ Ana                                  (h3)  │
│ Horários de Ana                            │
│ [09:00][09:15][09:30] …                    │  SlotGrid name="h0"
│ Bia …                                      │
│ [Continuar]                                │
│ Alterar serviços                           │
```
Os títulos do bloco de horários continuam em `h3` (o roteiro, cada profissional e os `EmptyState`), irmãos do `h3` "Escolha
o dia" sob o `h2` do serviço. Nenhum nível de título é pulado.

### 5.4 Celular, com aviso (RN-15, CA-11)

O `Alert` de aviso fica entre "1 h · R$ 90,00" e o resumo, antes da régua. Exemplo: "Escolha um horário para Escova.",
com o dia 01/12 continuando selecionado. Com `horario_indisponivel` vindo do POST, vale o texto da D-050 ("O horário das
10:00 de Escova não está mais disponível. Escolha outro.").

### 5.5 Desktop (≥ 48rem; capturas de referência em 768 e 1280 px)

A ordem e o conteúdo são os mesmos. Diferenças:
- O cabeçalho da régua fica numa linha: `h3` "Escolha o dia" à esquerda e o período à direita, alinhados pela linha de
  base (`display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap`), limitado a `36rem`.
- A régua tem `max-width: 36rem`, borda nos quatro lados, `--raio` e nenhuma sangria. Os links de semana e o apoio
  respeitam a mesma largura de 36rem, de modo que "Próxima semana" termina alinhado à borda direita da régua.
- Os horários (roteiro, filtro e grades) seguem com a largura total do cartão, como hoje (11 horários por linha em
  1280 px).
```
Serviço 1 de 3
Escova
1 h · R$ 90,00
[ Escova · Hidratação · Manicure / 3 serviços · R$ 205,00 ]          (resumo, largura total)
Escolha o dia                              29/11/2026 a 05/12/2026   (36rem)
╭──────┬──────┬──────┬──────┬──────┬──────┬──────╮
│ Hoje │ Seg  │ Ter  │ Qua  │ Qui  │ Sex  │ Sáb  │                   (36rem, ~82 px/coluna)
│  29  │  30  │  1   │  2   │  3   │  4   │  5   │
│ nov  │ nov  │ dez  │ dez  │ dez  │ dez  │ dez  │
╰──────┴──────┴──────┴──────┴──────┴──────┴──────╯
← Semana anterior                              Próxima semana →
Um dia aparece disponível quando …
──────────────────────────────────────────────────────────────────── (traço, largura total)
Seu dia · Terça-feira, 01/12/2026 …   (roteiro, filtro, grades, Continuar)
Alterar serviços
```

### 5.6 Última semana (CA-3) e janela curta

- Janela de 60 dias: a 9ª semana tem 5 dias, ocupando as colunas 1 a 5. As colunas 6 e 7 ficam vazias, entre os traços
  da régua (no desktop, dentro da borda). Não há "Próxima semana", e "Semana anterior" fica à esquerda.
- Janela de 1 dia: dois dias, nenhum link de semana e nenhum `<nav>`.

### 5.7 Passos k ≥ 1, dados e reescolha

Ficam sem mudança visual (sem régua). "Escolher outro dia" continua com o mesmo texto e leva ao passo 0 sem dia marcado,
na semana que contém a data (RN-14).

## 6. Estados (texto exato)

| Estado | Onde | Conteúdo |
|---|---|---|
| Sem dia, semana com dias disponíveis | bloco de horários | `EmptyState nivelTitulo={3}`: "Escolha um dia para ver os horários" / "Os horários de Escova aparecem aqui, separados por profissional." |
| Semana sem nenhum dia oferecido, com próxima (RN-9, CA-12) | régua toda no estado "sem horário"; bloco de horários | "Nenhum dia desta semana tem horário" / "Veja a próxima semana ou altere os serviços." Com o link "Próxima semana" na navegação. **Não** se repete um segundo link "Próxima semana" no estado vazio, porque dois links com o mesmo nome confundem o leitor de tela |
| Semana sem dia, sem próxima | idem | "Nenhum dia desta semana tem horário" / "Esta é a última semana aberta para reservas. Volte à semana anterior ou altere os serviços." |
| Semana sem dia, sem anterior nem próxima | idem | "Nenhum dia desta semana tem horário" / "Não há dias abertos para reservas agora. Altere os serviços ou tente mais tarde." |
| Dia escolhido sem horário do 1º serviço (RN-8) | bloco de horários (com o roteiro) | sem mudança da D-050: "Nenhum horário para Escova neste dia." / "Escolha outro dia ou altere os serviços." (ou o vazio por conflito) |
| Profissional sem horário no dia | grade | "Sem horários livres neste dia." (sem mudança) |
| Aviso `sem_selecao` | topo, antes do resumo | "Escolha um horário para Escova." |
| Limite de IP | lugar do passo | aviso `limitado` atual, **sem régua e sem horários** |
| Carregamento | não há | a página é renderizada no servidor, sem esqueleto e sem `loading.tsx` (que é proibido na rota pelo 308) |
| Sucesso, erro do formulário | não se aplica | sem mudança (passo de dados) |

## 7. Interação, movimento e comportamento sem JavaScript

- **Links GET com âncora (RN-11):** todo link de dia e de semana termina em `#reservar` (o `id` que o `h2` do passo já
  tem). Para que o indicador "Serviço 1 de N" não fique escondido acima da dobra, `.indicador + h2` ganha
  `scroll-margin-block-start: var(--espaco-8)`. Ao recarregar em 375 × 812, a cliente vê o indicador, o título, o resumo
  e a régua inteira. Pelas medidas do §3, a régua termina por volta de 420 px abaixo do título e o primeiro horário
  aparece por volta de 700 px.
- **Transições:** só `background-color` e `box-shadow` do dia, em `var(--duracao)` (150 ms), para dar resposta ao hover
  e ao toque. Nada se anima ao carregar e não há `scroll-behavior: smooth`. Com `prefers-reduced-motion: reduce`, a regra
  global de `globals.css` já zera as transições.
- **Sem JavaScript:** dias e semanas são `<a href>`, o horário é escolhido no `<form method="get">` do passo, e
  "Continuar" é `type="submit"`. Nada no componente usa estado de cliente.
- **Rolagem interna (< 340 px):** é nativa (dedo, trackpad, Shift + roda). O foco por Tab traz o dia para a área visível.
  Não há setas nem indicador de rolagem por JavaScript.

## 8. Arquivos afetados (para o arquiteto distribuir a posse)

- `src/components/ui/FaixaDeDias.tsx`, `FaixaDeDias.module.css`, `FaixaDeDias.test.tsx` (novos)
- `src/app/dev/componentes/` (exemplo da `FaixaDeDias`: semana com dia selecionado, semana toda sem horário, última
  semana com 5 dias, "marcado sem horário")
- `src/lib/format.ts` e `src/lib/format.test.ts` (dois formatadores curtos)
- `src/app/(publico)/[slug]/_componentes/Passos.tsx` (remove `PassoData`; `PassoServico` com índice 0 ganha o resumo, a
  régua e os estados; remove "Escolher outro dia" no passo 0)
- `src/app/(publico)/[slug]/_componentes/Salao.module.css` (remove `.dias` e `.dia`; adiciona o bloco de horários com
  traço e o `scroll-margin` do `h2`)
- `src/app/(publico)/[slug]/_componentes/PaginaDoSalao.tsx` (sai o `case "data"`) e `PaginaDoSalao.test.tsx`
- `src/server/reserva-publica/tipos.ts` (`MENSAGENS_PASSO`: textos do §4.3) e `passos.ts`/`pagina.ts` (dados da semana e
  hrefs, com a lógica do arquiteto)
- `src/app/dev/reserva/dados.ts`, `page.tsx` e os testes (vistas: passo 0 sem dia, com dia, semana sem dias, última
  semana)
- E2E: `e2e/suporte/publico.ts`, `e2e/reserva-publica*.spec.ts`, `e2e/publico-*.spec.ts`, `e2e/tester-d050.spec.ts`
  e uma spec nova da régua (axe, teclado, 375 px, sem JS)

## 9. Critérios de revisão visual (objetivos)

1. Em 375 × 812, `document.documentElement.scrollWidth <= clientWidth` no passo 0 sem dia, com dia e na semana vazia.
2. Em 375 × 812, a régua **não rola**: o `scrollWidth` do invólucro é igual ao `clientWidth`, e os 7 dias estão
   inteiros dentro do cartão.
3. Em 375 px, cada dia mede ≥ 44 px de largura e ≥ 44 px de altura (`getBoundingClientRect`). Em 1280 px, a régua mede
   ≤ 576 px (36rem).
4. Em 320 px, a régua rola dentro do invólucro, o documento não rola e Tab até o 7º dia o deixa visível.
5. Cada dia mostra três linhas visíveis: dia da semana curto ("Ter", ou "Hoje" no dia de hoje), número em
   `--fonte-titulo` com `--texto-xl` e mês curto ("dez").
6. O nome acessível de um dia disponível começa por `rotuloDoDia` ("Terça-feira, 01/12/2026"). O de um dia sem horário
   contém "sem horários", ele é `<span>` e não recebe foco por Tab.
7. O dia selecionado tem `aria-current="date"`, fundo `--cor-primaria-forte`, texto `--cor-sobre-primaria` e barra
   interna de 3 px na base. Em escala de cinza, ele continua distinguível dos vizinhos.
8. Um dia sem horário tem o número riscado (`text-decoration-line: line-through`) e fundo `--cor-superficie-alt`.
9. O foco é visível em todo dia disponível (contorno interno de 3 px em `--cor-foco`; no selecionado, em
   `--cor-sobre-primaria`), em "Semana anterior", em "Próxima semana" e na grade. Nenhum contorno é cortado pelo
   invólucro.
10. Ordem de Tab: dias disponíveis (da esquerda para a direita) → "Semana anterior" → "Próxima semana" → links "Alterar"
    do roteiro (se houver) → filtro → grade → "Continuar" → "Alterar serviços".
11. Na semana 0 não existe elemento "Semana anterior", e na última semana não existe "Próxima semana" (nem como texto).
12. Sem dia: há o `EmptyState` "Escolha um dia para ver os horários", e não há `RoteiroDoDia`, filtro, grade nem botão
    "Continuar".
13. O aviso (`Alert`) fica antes da régua no DOM.
14. Todo `href` de dia e de semana termina em `#reservar`. Ao abrir um deles em 375 × 812, o `h2` do passo fica visível
    sem rolar.
15. Contrastes: os pares do §3.1 (≥ 4,5:1 para texto; ≥ 3:1 para formas). Nenhuma cor literal fora do `:root` de
    `globals.css` e nenhuma media query de largura diferente de `(min-width: 48rem)` (os testes de conformidade
    existentes conferem).
16. axe 4.14.0 sem violações (375 × 812) no passo 0 sem dia, no passo 0 com dia e numa semana com todos os dias sem
    horário.
17. Com o JavaScript desligado, o fluxo serviços → dia → horário → … → confirmação se completa.
18. Os passos k ≥ 1 não têm régua e mantêm "Escolher outro dia" e "Alterar serviços". O passo 0 não tem "Escolher outro
    dia".
19. Os textos dos estados correspondem exatamente ao §6.

## 10. Conflitos e alternativas

- **C1: alvo de 44 px × 375 px.** Sete caixas separadas não cabem em 309 px. A solução é a régua sem vão, sangrando até
  a borda do cartão no celular (48,7 px por dia). Se o arquiteto preferir não sangrar, a alternativa é manter a régua
  dentro do padding com rolagem interna em 375 px, o que eu **não recomendo**, porque cortaria o domingo na largura-alvo.
- **C2: axe `scrollable-region-focusable`.** Abaixo de cerca de 340 px, numa semana sem nenhum dia disponível, o
  invólucro rola e não tem elemento focável, o que pode gerar a violação. Isso não afeta o E2E (375 px, sem rolagem).
  Alternativa, se o tester exigir 320 px: `tabindex="0"`, `role="group"` e `aria-labelledby` no invólucro **só quando**
  a semana não tem nenhum dia link. Não recomendo pôr isso sempre, porque criaria uma parada de Tab inútil.
- **C3: "rótulo no nome" (WCAG 2.5.3).** O texto visível "Ter 1 dez" não está contido literalmente no nome "Terça-feira,
  01/12/2026", que a spec RN-2 fixa. Quem usa controle por voz pode dizer "clicar Terça-feira" ou usar números. Aceito
  pela decisão da spec. O axe padrão não acusa (a regra `label-content-name-mismatch` é experimental).
- **C4: sufixo ", hoje".** O sufixo não contraria a spec ("o nome acessível é o rótulo completo"), porque o nome continua
  começando pelo rótulo. Se o arquiteto quiser o nome exato, a alternativa é tirar o sufixo e manter o "Hoje" visível.
- **C5: dia marcado sem horário.** Pela RN-4 ele não é link, mas pela RN-8 tem `aria-current="date"`. A solução é o
  `aria-current` no `<span>` (atributo global, válido para o axe), com o estado visual próprio do §4.1.

## 11. Dúvidas

**Bloqueantes:** nenhuma.

**Não bloqueantes (suposição adotada):**
- Dia sem zero à esquerda ("1", e não "01") e mês por extenso curto ("dez"), em vez do "01/12" de exemplo da spec,
  porque o número curto em Fraunces cabe em 48 px e o mês em linha própria torna as viradas de mês legíveis.
- Na última semana, as colunas sem dia ficam vazias (sem marcador), conforme a ND-5.
- "Hoje" substitui o dia da semana curto só no dia de hoje.
