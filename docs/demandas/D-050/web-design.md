# D-050 (E3.6, issue #111) — Web design: profissional e horário por serviço

Autor: web-designer. Data: 23/11/2026. Entrada: `docs/demandas/D-050/spec.md` (RN-1..RN-39, CA-1..CA-52, DA-1..DA-20).
Telas: fluxo público `/{slug}`, `/painel/agenda/nova`, `/painel/agenda` (dia e semana), `/painel/agenda/reservas/[id]`.

Capturas das telas atuais (build de produção existente, `next start -p 3107` com `VITRINE_COMPONENTES=true`, servidor
derrubado no fim; porta 3000 não foi tocada). Ficam **fora do repositório**, em
`/tmp/claude-1000/-home-cliente--rea-de-Trabalho-agenda-beleza/0981b645-ff19-4016-836e-cec5d272d26c/scratchpad/cap/`:
`servicos|profissional|data|horario|dados|novaReserva|agenda|acoes-{375,768,1280}.png`. Nenhuma tem rolagem
horizontal hoje (`scrollWidth` = largura nas três larguras).

---

## 1. Diagnóstico

O que funciona e deve ser mantido: paleta terrosa com contraste folgado, Fraunces nos títulos, `SlotGrid` com rádios
nativos de 44 px e uma parada de Tab, fluxo 100% GET/POST sem JS, aviso de encaixe e resumo de erros com foco
programático. Os problemas abaixo são os que a D-050 torna graves ou cria.

| # | Problema | Evidência |
|---|---|---|
| D1 | **O resumo da escolha é uma frase única de serviços**, sem horário nem profissional por serviço. Com itens independentes ele deixa de responder "o que vou fazer, com quem e quando". | `Passos.tsx:39-58` (`ResumoDaSelecao`: `servicos.map(nome).join(', ')` + "Profissional:" + "Quando:" únicos); captura `dados-1280.png` (bloco bege "Corte feminino, Escova / Profissional: Ana / Quando: 26/11/2026 09:00"). |
| D2 | **Texto que se torna falso**: "Eles são feitos em sequência, com o mesmo profissional." (público) e "atendidos em sequência pelo mesmo profissional" (equipe). | `Passos.tsx:65`; `FormularioReservaManual.tsx:117`; captura `novaReserva-375.png`. |
| D3 | **O passo de profissional isolado** ("Sem preferência" + nomes) não tem lugar: a escolha passa a ser por serviço e a spec remove "qualquer profissional". O link "Alterar profissional" no passo de data também. | `Passos.tsx:87-120`, `Passos.tsx:151-153`; `passos.ts:114` (`QUALQUER`). |
| D4 | **A duração total e "Quando" únicos** deixam de existir: a soma de durações não descreve um dia com intervalos entre itens (ex.: 09:00 e 15:00). | `Passos.tsx:53-55` (`duracaoTotalMin`), `FormularioDados.tsx:87-93` (confirmação "Duração: … · Total"). |
| D5 | **A confirmação lista serviços numa lista de caixas e, separado, um bloco com profissional/quando**: duas leituras para uma informação que agora é uma por linha. Caixas repetidas (`.item` com borda + fundo) também são usadas na lista de serviços do perfil logo abaixo, então a confirmação se confunde com o cardápio. | `FormularioDados.tsx:76-94`; `Salao.module.css:57-66`; capturas `horario-375.png` (seção "Serviços" em caixas idênticas). |
| D6 | **Reescolha aponta "o horário", não um serviço**: o aviso "Este horário não está mais disponível" e o título "Escolha o horário" não dizem qual item caiu. | `tipos.ts:16` (`MENSAGENS_AVISO.horario_indisponivel`); `FormularioDados.tsx:123-128`. |
| D7 | **Detalhe da reserva é uma `dl` de reserva única** (Profissional, Início, Fim, Situação) e a lista de serviços só tem nome, preço e duração. As ações (situação, remarcar, cancelar) ficam no fim da página e valem para a reserva inteira; em 375 px o formulário de remarcar ocupa ~45% da altura e aparece sempre aberto. | `DetalheDaReserva.tsx:22-62`; `AcoesDaReserva.tsx:71-215`; captura `acoes-375.png` (1718 px de altura, "Remarcar" com caixas de serviço e data sempre visíveis). |
| D8 | **Bloco da agenda descreve a reserva** ("serviços em lista · Confirmada"), com rótulo de status no feminino (da reserva). Com um bloco por item, o bloco deve dizer o serviço do item e o status do item. | `Eventos.tsx:21-30`; captura `agenda-1280.png` ("15:00–16:30 Joana Lima · Corte feminino e Escova · Concluída"). |
| D9 | **O formulário da equipe tem um único conjunto serviço/profissional/hora** e não permite linhas; a hora é um campo de texto HH:MM (decisão D-029 que mantemos). | `FormularioReservaManual.tsx:115-169`. |
| D10 | **Hierarquia do passo de horário**: o título "Escolha o horário" e a legenda do grupo repetem a mesma informação; não há indicação de progresso. Num fluxo com 3 serviços, a cliente não sabe em que serviço está nem quantos faltam. | `Passos.tsx:162-179`; captura `horario-375.png`. |

## 2. Direção visual recomendada: "roteiro do dia"

**Conceito.** Um agendamento vira o **roteiro de um dia**: uma coluna estreita de horários à esquerda, em números
tabulares, e, à direita, cada serviço como uma parada ("09:00 · Escova · com Ana"). Uma linha vertical fina liga as
paradas. É o mesmo desenho na escolha (o que já está decidido e o que falta), nos dados, na confirmação, na resposta de
reescolha e no detalhe da equipe, onde cada parada ganha seu status e suas ações.

**Por que serve.** A cliente pensa o dia pelo relógio ("escova de manhã, unha à tarde"); a gestora pensa pela pessoa que
atende. O roteiro responde as duas leituras numa linha (hora → serviço → profissional) e funciona igual em 375 px, onde
uma tabela quebraria. Ele substitui caixas repetidas por linhas com régua fina, o que reduz ruído e diferencia a
reserva do cardápio de serviços do perfil.

**O que muda na identidade.** Nada na paleta e nas fontes. Entra um elemento próprio (a régua do roteiro com pontos) e
um uso mais deliberado da Fraunces: o **horário de cada parada** em Fraunces 500, `--texto-lg`, com
`font-variant-numeric: tabular-nums` — o número vira o protagonista discreto do bloco, coerente com a direção
"elegante e quente". Corpo e rótulos continuam em Source Sans 3.

**Alternativas descartadas.**
- *Uma tela com todos os serviços e todas as grades ao mesmo tempo*: sem JS não há como descontar, na mesma
  renderização, os horários de B pelo que a cliente marca em A (RN-10); obrigaria validações tardias e reescolhas.
- *Tabela serviço × profissional × hora*: ilegível em 375 px e repete o modelo de "planilha" das referências.
- *Um cartão por serviço com sombra*: repete o padrão de cartões que já pesa na página (D5) e não comunica sequência.
- *Agrupar a grade por horário ("10:00: Ana, Bia")*: compacto, mas esconde quem atende, e a cliente costuma ter
  preferência de pessoa; o filtro por profissional (DA-2) cobre o caso de lista longa.

## 3. Sistema

### 3.1 Cores — nenhum token novo
Todos os pares abaixo foram medidos (WCAG 2.x, cálculo de luminância relativa) com os valores atuais de
`src/app/globals.css`.

| Uso nesta demanda | Texto / elemento | Fundo | Razão | Mínimo |
|---|---|---|---|---|
| Texto do roteiro, nome do serviço | `--cor-texto` | `--cor-superficie` | 15,47 | 4,5 |
| Idem, roteiro dentro de bloco `--cor-superficie-alt` | `--cor-texto` | `--cor-superficie-alt` | 13,29 | 4,5 |
| Profissional, duração, preço, "Serviço 2 de 3" | `--cor-texto-suave` | `--cor-superficie` | 7,22 | 4,5 |
| Idem sobre `--cor-superficie-alt` | `--cor-texto-suave` | `--cor-superficie-alt` | 6,21 | 4,5 |
| Link "Alterar", filtro de profissional | `--cor-primaria-forte` | `--cor-superficie` / `--cor-superficie-alt` | 7,79 / 6,69 | 4,5 |
| Filtro ativo (pílula) | `--cor-sobre-primaria` | `--cor-primaria-forte` | 7,62 | 4,5 |
| Horário marcado no `SlotGrid` (já existe) | `--cor-sobre-primaria` | `--cor-primaria` | 4,92 | 4,5 |
| Ponto "escolhido" do roteiro (gráfico) | `--cor-primaria` | `--cor-superficie` | 5,02 | 3,0 |
| Ponto "a escolher" (anel 2 px) | `--cor-borda-controle` | `--cor-superficie` / `--cor-superficie-alt` | 4,39 / 3,77 | 3,0 |
| Item com problema na reescolha (faixa) | `--cor-aviso-texto` | `--cor-aviso-fundo` | 7,25 | 4,5 |
| Etiqueta "Cancelado" | `--cor-texto-suave` | `--cor-superficie` | 7,22 | 4,5 |
| Etiqueta "Concluído" | `--cor-sucesso-texto` | `--cor-sucesso-fundo` | 7,78 | 4,5 |
| Etiqueta "Não compareceu" | `--cor-erro-texto` | `--cor-erro-fundo` | 7,22 | 4,5 |
| Etiqueta "Confirmado" | `--cor-info-texto` | `--cor-info-fundo` | 8,71 | 4,5 |
| Etiqueta "Encaixe" | `--cor-aviso-texto` | `--cor-aviso-fundo` | 7,25 | 4,5 |
| Foco | `--cor-foco` | `--cor-superficie` / `--cor-superficie-alt` | 18,45 / 15,85 | 3,0 |

**Proibido nesta demanda:** `--cor-primaria` como cor de **texto** sobre `--cor-superficie-alt` (4,31 < 4,5). A régua
vertical usa `--cor-borda-sutil` (1,38) por ser **decorativa**: nenhuma informação depende dela (estado vem em texto e
no ponto).

### 3.2 Tipografia (famílias já carregadas)
| Papel | Família | Tamanho | Peso | Entrelinha |
|---|---|---|---|---|
| Título do passo / seção (`h2`) | `--fonte-titulo` | `--texto-2xl` (1,75 rem) | 500 | `--altura-linha-titulo` |
| Data do roteiro ("Quinta-feira, 26/11/2026") | `--fonte-titulo` | `--texto-xl` (1,375 rem) | 500 | 1,2 |
| Horário de cada parada | `--fonte-titulo` | `--texto-lg` (1,125 rem) | 500, `tabular-nums` | 1,2 |
| Nome do serviço na parada | `--fonte-corpo` | `--texto-base` | 600 | `--altura-linha` |
| Profissional, duração, preço | `--fonte-corpo` | `--texto-sm` (0,875 rem) | 400, cor suave | 1,4 |
| Indicador "Serviço 2 de 3" | `--fonte-corpo` | `--texto-sm` | 600, cor suave, sem caixa-alta | 1,4 |
| Etiquetas de status | `--fonte-corpo` | `--texto-sm` | 600 | 1,2 |
| Total | `--fonte-corpo` | `--texto-lg` | 600 | 1,4 |

### 3.3 Grade, larguras, espaçamento, forma
- Ponto de quebra único `@media (min-width: 48rem)`. Mobile primeiro.
- Fluxo público: o contêiner `.reserva` atual (borda sutil, `--raio-grande`, `--espaco-4` de respiro) é mantido; no
  desktop o roteiro ocupa no máximo **36rem** (mesma ordem de grandeza do `.formulario` de 32rem) para o olho não
  atravessar 1000 px entre hora e preço.
- Roteiro: coluna de horários de **4,5rem** fixa (cabe "23:55" em `--texto-lg` e o rótulo de horário de verão
  "01:30 (−03)" quebra em duas linhas sem estourar), régua de 2 px a `--espaco-3` dela, conteúdo em `1fr`. Paradas
  separadas por `--espaco-4`; nenhuma borda em volta de cada parada.
- Painel: formulário e detalhe continuam em `max-width: 40rem`.
- Raios: `--raio` para pílulas de filtro e etiquetas; nenhum raio novo. Sombras: nenhuma.

## 4. Componentes

### 4.1 `RoteiroDoDia` (novo, `src/components/ui/RoteiroDoDia.tsx` + `.module.css`)
Componente de servidor (sem hooks, sem funções em props), usado no público e no painel.

**Anatomia**
```
<section aria-labelledby=…>            (ou <div role="group" aria-label="Seu dia"> quando dentro de outra seção)
  [titulo opcional: data em Fraunces]
  <ol class=roteiro>
    <li class="parada [escolhida|pendente|cancelada|destaque]">
      <span class=ponto aria-hidden>          (círculo 0,75rem)
      <p class=hora>09:00<span class=fim>–10:00</span></p>   (fim só no painel e na confirmação)
      <div class=corpo>
        <p class=servico>Escova</p>
        <p class=meta>com Ana · 1 h · R$ 90,00</p>
        [etiquetas: status, encaixe, inativo]
        [slot "acoes" (ReactNode) — link "Alterar" ou formulários do painel]
      </div>
    </li>
    <li class="parada pendente">  hora: "—"  servico: "Manicure"  meta: "a escolher" </li>
  </ol>
  [slot "rodape": total]
</section>
```

**Props (proposta; o arquiteto fixa os tipos):** `titulo?: string` (já formatado por `format.ts`), `nivelTitulo?: 2|3`,
`paradas: { chave: string; hora: string | null; fim?: string; servico: string; profissional?: string;
detalhe: string; estado: 'escolhida'|'pendente'|'cancelada'|'destaque'; etiquetas?: {texto: string; variante:
'confirmado'|'concluido'|'nao_compareceu'|'cancelado'|'encaixe'|'neutra'}[]; acoes?: ReactNode }[]`,
`rodape?: ReactNode`, `rotulo: string` (nome acessível da lista).
Todos os textos chegam prontos (datas e moeda pelo `src/lib/format.ts`, no chamador).

**Variantes de parada**
- `escolhida`: ponto cheio `--cor-primaria`.
- `pendente`: ponto vazado (anel 2 px `--cor-borda-controle`), hora "—" com texto oculto "horário a escolher",
  `meta` = "a escolher".
- `destaque` (serviço em edição ou indisponível na reescolha): faixa `--cor-aviso-fundo` atrás da parada inteira,
  borda esquerda 3 px `--cor-aviso-texto` (forma além da cor), texto `--cor-aviso-texto`.
- `cancelada`: nome e preço com `line-through`, cor `--cor-texto-suave`, etiqueta textual "Cancelado" (a etiqueta
  NÃO é riscada: fica num `inline-flex`, mesmo truque da D-043).

**Semântica.** `<ol>` (ordem temporal importa). Cada `<li>` lê em sequência "09:00 a 10:00, Escova, com Ana, 1 h,
R$ 90,00, Confirmado". O ponto e a régua são `aria-hidden`. O "–10:00" vem com texto oculto " até " antes (lido "09:00
até 10:00"). Nenhum elemento interativo próprio: as paradas de Tab vêm só do slot `acoes`.

**Estados de interação:** o componente não tem hover. Os links/botões do slot usam os estilos existentes (foco global
`:focus-visible`, 3 px `--cor-foco`).

**Celular x desktop.** Idêntico em estrutura; em ≥ 48rem `meta` e etiquetas ficam na mesma linha que o serviço quando
cabem (`flex-wrap`), e o slot `acoes` alinha à direita da parada (`margin-inline-start: auto`). Em 375 px tudo empilha
sob o nome do serviço.

### 4.2 `SlotGrid` (alterado, `src/components/ui/SlotGrid.tsx`)
Precisa servir a vários profissionais **num único grupo de rádios** por serviço (uma escolha por serviço), e voltar
pré-selecionado quando a cliente usa "Alterar".
- Nova prop opcional `prefixoDoValor?: string` (texto, serializável): `value = prefixoDoValor + iso`. A identidade do
  horário continua sendo o instante (D-21); o prefixo identifica o profissional. Formato exato do valor: arquiteto
  (sugestão `"<profissionalId>_<iso>"`, sem caracteres que exijam escape na URL além do `:` já usado).
- Nova prop opcional `nivelLegenda?: 'forte'|'discreta'`: a legenda "Horários de Ana" fica visível mas em
  `--texto-sm`/600 quando o nome do profissional já é o título do grupo.
- `selecionadoInicial` já existe; precisa casar com o prefixo (comparar o valor completo).
- Sem mudança visual dos botões. Comportamento por teclado: **todas as grades do mesmo serviço partilham o `name`**,
  então há UMA parada de Tab por serviço; as setas percorrem os horários de Ana e seguem para os de Bia (o leitor de
  tela anuncia a troca de `fieldset`). O filtro por profissional (4.3) existe para encurtar esse percurso.

### 4.3 `FiltroDeProfissional` (novo, local: `src/app/(publico)/[slug]/_componentes/`)
Barra de links GET: "Todos (3)", "Ana", "Bia", "Carla". Só aparece com 2+ profissionais elegíveis para o serviço.
- `<nav aria-label="Filtrar por profissional">` com `<ul>` de links; o atual tem `aria-current="true"` e visual de
  pílula preenchida `--cor-primaria-forte`/`--cor-sobre-primaria`; os demais, pílula com borda `--cor-borda-controle`
  e texto `--cor-primaria-forte`. Alvo mínimo `--alvo-minimo`. Reaproveitar o padrão `.botaoLink` da agenda
  (`Agenda.module.css:26-59`) copiado para o módulo do público só com tokens (ou extraído para `ui/` se o arquiteto
  preferir; ver §8).
- O link preserva toda a query (serviços, data, itens já escolhidos) e acrescenta o filtro do serviço atual.
- Profissional sem horário no dia continua listado no filtro (com "sem horários" no grupo), para a cliente entender
  por que não o vê.

### 4.4 `LinhaDeItem` do formulário da equipe (novo, local: `src/app/painel/agenda/nova/`)
Um `fieldset` por item: legenda "Serviço 1", `Select` de serviço (reaproveita `ui/Select`), `Select` de profissional
(gestor) ou texto fixo "Profissional: Bia (você)" + `hidden` (profissional), `Field` "Hora (HH:MM)" (mesmo padrão D-029,
`inputMode="numeric"`), e, a partir de 2 linhas, botão `Button variante="discreta"` "Remover serviço 1" (texto visível
"Remover"; o número vai em texto oculto). Erros por campo com `ErroDoCampo`; ids `item-<n>-servico`,
`item-<n>-profissional`, `item-<n>-hora` para os links do resumo de erros.

### 4.5 Etiqueta de status do item
Pequena etiqueta textual (`--texto-sm`, 600, `--raio`, `padding: var(--espaco-1) var(--espaco-2)`), cores da tabela
§3.1. Rótulos **masculinos** (concordam com "serviço"): "Confirmado", "Concluído", "Não compareceu", "Cancelado",
"Encaixe". Os rótulos femininos da reserva (`rotuloDoStatus`: "Confirmada"…) continuam para o status derivado da
reserva. Uma função nova `rotuloDoStatusDoItem` mora ao lado de `src/server/agenda/rotulos.ts` (decisão de posse do
arquiteto); o texto nunca é copiado nos componentes.

## 5. Especificação por tela

Exemplo usado em todos os wireframes: Studio Bela, quinta-feira 26/11/2026; Escova (1 h, R$ 90,00) com Ana às 09:00;
Hidratação (40 min, R$ 75,00) com Bia às 10:00; Manicure (45 min, R$ 40,00) com Carla às 15:00. Total R$ 205,00.

### 5.1 Público — passo "Serviços"
Igual ao atual, com o texto corrigido (D2):
- `h2` "Serviços".
- Parágrafo: **"Escolha um ou mais serviços (até 10). Depois você escolhe o dia e, para cada serviço, o profissional
  e o horário."**
- Lista de caixas de seleção (inalterada), botão "Continuar".
- Avisos (Alert aviso, mesmos códigos): `sem_profissional` deixa de existir no fluxo novo (CA-2); manter
  `servico_indisponivel`. Novo aviso **"Algum serviço não tem profissional disponível no momento. Escolha outra
  combinação."** só se o arquiteto mantiver um código para "serviço sem nenhum profissional ativo" (caso raro, pois
  `listarServicosPublicos` já filtra).

### 5.2 Público — passo "Escolha o dia"
```
┌ Escolha o dia ─────────────────────────────┐   h2
│ Escova · Hidratação · Manicure              │   p.servico (600), separador " · "
│ 3 serviços · R$ 205,00                      │   p.suave
│                                             │
│ [Quinta-feira, 26/11/2026            ]      │   link (linha .dia atual)
│  Sexta-feira, 27/11/2026 (sem horários)     │   texto suave, não link
│ …14 dias…                                   │
│ Próximos dias   Alterar serviços            │   .navegacao
└─────────────────────────────────────────────┘
```
- "Alterar profissional" **sai** (D3).
- "(sem horários)" quando **algum** serviço não tem nenhum início livre no dia (DA-2). Texto de apoio abaixo da
  lista, `--texto-sm` suave: **"Um dia aparece disponível quando cada serviço tem ao menos um horário livre nele."**
- Desktop: igual, com a lista em `max-width: 36rem`.

### 5.3 Público — passo "Serviço k de N" (novo; um por serviço, na ordem escolhida)
```
Celular (375)                                        Desktop (≥ 768): mesma ordem, roteiro em 36rem
┌───────────────────────────────────────────┐
│ Serviço 2 de 3                             │  p, --texto-sm 600 suave (id usado no aria-describedby do h2)
│ Hidratação                                 │  h2 Fraunces 2xl
│ 40 min · R$ 75,00                          │  p suave
│                                            │
│ Quinta-feira, 26/11/2026                   │  RoteiroDoDia titulo (h3)
│  09:00 ● Escova                  Alterar   │  escolhida, acao = link "Alterar"
│        com Ana · 1 h · R$ 90,00            │
│    —   ◐ Hidratação                        │  destaque (em escolha) — meta "escolhendo agora"
│    —   ○ Manicure                          │  pendente — meta "a escolher"
│                                            │
│ Filtrar por profissional                   │  (visualmente-oculto no nav)
│ (Todos (2)) (Bia) (Carla)                  │  FiltroDeProfissional
│                                            │
│ Bia                                        │  h3 --texto-xl
│ Horários de Bia                            │  legenda discreta do SlotGrid
│ [10:00][10:15][10:30][11:00] …             │
│ Carla                                      │
│ Horários de Carla                          │
│ [08:00][11:00] …                           │
│ Daniela                                    │
│ Sem horários livres neste dia.             │  p suave (profissional elegível sem início)
│                                            │
│ [Continuar]                                │  Button primária
│ Escolher outro dia   Alterar serviços      │  .navegacao
└───────────────────────────────────────────┘
```
Regras de composição:
- Ordem de leitura e de Tab: indicador → `h2` → roteiro (links "Alterar" dos já escolhidos) → filtro → grade única do
  serviço → "Continuar" → links de navegação.
- O roteiro em ordem de início (RN-6); serviços ainda sem horário ficam no fim, na ordem escolhida.
- O `h2` tem `aria-describedby` apontando para "Serviço 2 de 3" (o indicador é lido junto com o título).
- O botão do último serviço diz **"Continuar para seus dados"**; os demais, **"Continuar"**.
- Ao voltar por "Alterar", a grade vem com o horário atual do item pré-selecionado (`selecionadoInicial`), e o roteiro
  mostra esse serviço como `destaque`, com meta **"alterando"**; ao continuar, a cliente volta direto ao passo de dados
  se todos os outros itens continuam válidos (passo mais avançado válido, CA-9).
- Profissionais na ordem do salão (a mesma de "Equipe"); quem não tem horário aparece por último com "Sem horários
  livres neste dia." (nada some: a cliente entende que a profissional existe).
- Os horários já descontam os demais itens (RN-10). Nada visual marca horário "bloqueado pela sua própria escolha":
  ele simplesmente não é oferecido (sem rádios desabilitados, que custariam paradas de seta e ruído).
- Sem JS: um `<form method="get">` com os ocultos de todos os itens já escolhidos; o rádio escolhido entra como o item
  k. Botão "Continuar" com nenhum rádio marcado: o servidor volta ao mesmo passo com o Alert aviso
  **"Escolha um horário para Hidratação."** (texto com o nome do serviço).

### 5.4 Público — passo "Seus dados"
```
┌ Seus dados ────────────────────────────────┐ h2
│ Quinta-feira, 26/11/2026                   │ RoteiroDoDia (h3)
│ 09:00 ● Escova                   Alterar   │
│        com Ana · 1 h · R$ 90,00            │
│ 10:00 ● Hidratação               Alterar   │
│        com Bia · 40 min · R$ 75,00         │
│ 15:00 ● Manicure                 Alterar   │
│        com Carla · 45 min · R$ 40,00       │
│ ─────────────────────────────────────────  │ borda superior sutil do rodapé
│ Total                          R$ 205,00   │ --texto-lg 600
│ 3 serviços                                  │ suave
│                                            │
│ Nome (obrigatório)            [__________] │ inalterado
│ Telefone (com DDD)            [__________] │
│ [ ] consentimentos…                        │
│ (widget de verificação)                    │
│ [Confirmar reserva]                        │
└────────────────────────────────────────────┘
```
- O link "Alterar" de cada parada tem nome acessível completo: **"Alterar Escova (09:00 com Ana)"** (visível
  "Alterar"; o resto em `visualmente-oculto`). Não usar `aria-label` que substitua o texto visível de forma diferente
  (o nome deve começar pelo texto visível).
- "Escolher outro horário" (atual) sai: substituído pelos "Alterar" por item. Entra **"Alterar serviços"** na
  `.navegacao`, abaixo do total (volta ao primeiro passo mantendo os serviços marcados, se o arquiteto conseguir; senão
  lista vazia, como hoje).
- O total é a soma dos itens (RN-35). Não mostrar duração total (D4).

### 5.5 Público — confirmação (estado da ação)
```
Sua reserva                                   h2
┌ Reserva confirmada! ─────────────────────┐  Alert sucesso, recebe foco (tabIndex -1)
Quinta-feira, 26/11/2026                      RoteiroDoDia (h3), paradas com hora "09:00–10:00"
09:00–10:00 ● Escova · com Ana · R$ 90,00
10:00–10:40 ● Hidratação · com Bia · R$ 75,00
15:00–15:45 ● Manicure · com Carla · R$ 40,00
Total R$ 205,00 · 3 serviços
Você receberá a confirmação por WhatsApp, com todos os horários.
Entre um serviço e outro você pode sair do salão: chegue alguns minutos antes de cada horário.   (só se houver
                                                                    intervalo ≥ 30 min entre paradas; ver ND-4)
```
- `repetida`: mesmo layout; o Alert diz **"Esta reserva já estava confirmada."**
- Sem "Alterar" (a reserva está gravada; alterações são com o salão).

### 5.6 Público — reescolha (CA-10; resposta do POST, sem redirecionar, também sem JS)
```
Escolha outro horário para Hidratação         h2 (nome do serviço que caiu; se forem 2+: "Escolha outros horários")
┌ Atenção: ────────────────────────────────┐  Alert aviso, recebe foco
│ O horário das 10:00 de Hidratação com Bia │
│ acabou de ser reservado. Escolha outro    │
│ horário para este serviço. Os outros      │
│ serviços e os seus dados continuam aqui.  │
└───────────────────────────────────────────┘
Quinta-feira, 26/11/2026                      Roteiro: Escova (escolhida), Hidratação (destaque, meta "escolha
09:00 ● Escova · com Ana                       um novo horário abaixo"), Manicure (escolhida). Sem links "Alterar".
  —   ◐ Hidratação · escolha um novo horário abaixo
15:00 ● Manicure · com Carla
Bia / Horários de Bia [10:40][11:00]…         grade(s) do item, agrupadas por profissional, MESMO name do POST
Carla / Horários de Carla […]                 (sem filtro: o filtro é GET e perderia os dados digitados)
Nome [Maria Souza]   Telefone [(11) 9…]       valores preservados
[x] consentimentos (preservados)
(widget)
[Confirmar reserva]
```
- Vários itens indisponíveis ao mesmo tempo: uma parada `destaque` e um bloco de grades por item, cada bloco com `h3`
  "Novo horário para Hidratação"; o Alert lista os serviços: **"Os horários de Hidratação (10:00) e Manicure (15:00)
  acabaram de ser reservados. Escolha novos horários para eles. Os outros serviços e os seus dados continuam aqui."**
- Sem horário restante para o item: no lugar da grade, `EmptyState` nível 3 **"Não há mais horários para Hidratação
  neste dia."** e o texto **"Você pode escolher outro dia ou seguir sem este serviço. Nos dois casos será preciso
  informar seus dados de novo."** com dois links: "Escolher outro dia" e "Seguir sem Hidratação" (GET para o passo de
  dados sem esse serviço, mantendo os demais itens). Nenhum dado pessoal vai para a URL.
- Sem JS: idêntico (estado da ação). O `FormularioDados` continua com **um** `useActionState`.

### 5.7 Público — estados do passo por serviço
| Estado | Texto exato |
|---|---|
| Nenhum profissional com horário no dia, e o motivo é só o calendário | `EmptyState` nível 3: **"Nenhum horário para Hidratação neste dia."** + p **"Escolha outro dia ou altere os serviços."** Botão "Continuar" some; ficam os links. |
| Nenhum horário porque todos coincidem com os itens já escolhidos (conflito) | `EmptyState` nível 3: **"Os horários de Hidratação neste dia coincidem com os serviços que você já escolheu."** + p **"Altere o horário de outro serviço acima ou escolha outro dia."** (os "Alterar" do roteiro ficam logo acima). Ver Conflito C3 se o servidor não puder distinguir. |
| Profissional elegível sem horário | p suave sob o nome: **"Sem horários livres neste dia."** |
| Parâmetro inválido/fora de ordem | Volta ao passo válido mais avançado (CA-8), sem Alert novo. |
| Item escolhido que deixou de estar livre ao abrir a página (GET) | O passo desse serviço abre com Alert aviso **"O horário das 10:00 de Hidratação não está mais disponível. Escolha outro."** |
| Limitado por IP | Inalterado (`MENSAGENS_PROTECAO.limitado`). |
| Salão suspenso | Inalterado ("Agendamento indisponível"). |

### 5.8 Painel — `/painel/agenda/nova`
```
Nova reserva                                       h1
[resumo de erros | aviso de encaixe | criada]      (topo, como hoje, com foco)
Data   [26/11/2026]                                Field date (uma vez, RN-3). Ajuda: "Todos os serviços ficam neste dia."
┌ Serviço 1 ─────────────────────────────────┐    fieldset LinhaDeItem
│ Serviço       [Escova · 1 h · R$ 90,00 ▾]  │
│ Profissional  [Ana ▾]                       │    (profissional logado: "Profissional: Bia (você)")
│ Hora (HH:MM)  [09:00]          [Remover]    │    Remover só com 2+ linhas
└─────────────────────────────────────────────┘
┌ Serviço 2 ─ … ┐
[+ Adicionar outro serviço]                        Button secundária, submit name="linha" value="adicionar"
                                                   some com 10 linhas; ajuda: "Até 10 serviços."
Nome da cliente  […]   Telefone (WhatsApp) […]
Mensagens da reserva (fieldset atual, inalterado)
[ ] Confirmo o encaixe                             só com motivos
[Registrar reserva]
```
- Ordem dos campos: Data primeiro (vale para todos), depois as linhas, depois cliente. No desktop, dentro de cada
  linha, Serviço ocupa a linha inteira e Profissional + Hora dividem a linha seguinte (`grid-template-columns: 1fr
  10rem`); no celular, tudo empilhado (Hora com largura total). Data em celular: largura total.
- Texto de ajuda acima das linhas (substitui D2): **"Escolha o serviço, o profissional e a hora de cada um. Os
  horários de uma mesma cliente não podem se sobrepor."**
- "Adicionar outro serviço" e "Remover" são **botões de envio** do mesmo formulário com `name="linha"` (ação do
  servidor devolve o estado com uma linha a mais/a menos e todos os valores preservados, sem gravar). Remover não
  reordena silenciosamente: as linhas restantes são renumeradas e o foco vai para a legenda da linha anterior (com JS);
  sem JS a página volta no topo do formulário, com um `role="status"` **"Serviço 2 removido."** / **"Linha de serviço
  adicionada."** antes da Data.
- Enter implícito: num campo de texto, Enter deve **registrar** a reserva, nunca adicionar ou remover linha. Como o
  navegador aciona o primeiro botão de envio do formulário, ver §10 C5 (botão padrão oculto no início do `<form>`).
- Aviso de encaixe (RN-17), um só bloco:
  ```
  Atenção: encaixe
  Alguns serviços estão fora das regras de agenda. Confira e confirme para registrar.
  • Serviço 2 — Hidratação com Bia às 19:00: fora da jornada.
  • Serviço 3 — Manicure com Carla às 13:00: horário bloqueado; fora do funcionamento.
  [ ] Confirmo o encaixe destes serviços
  ```
  Cada linha citada também ganha, dentro do seu `fieldset`, a etiqueta "Encaixe" e o texto do motivo sob a hora.
- Resumo de erros: itens no formato **"Serviço 2 — Hora: Informe a hora no formato HH:MM."**, cada um com link para
  `#item-2-hora`. Sobreposição entre itens: erro no campo Hora do item posterior: **"Este horário se sobrepõe ao
  Serviço 1 (Escova, 09:00–10:00)."** Serviço repetido: no campo Serviço: **"Este serviço já está no Serviço 1."**
- Criada: bloco atual "Reserva registrada." + `RoteiroDoDia` compacto (horas e profissionais) + "Ver na agenda".
  Encaixe: "Reserva registrada com encaixe em 1 serviço."
- Profissional logado: as linhas não têm Select de profissional; cada linha mostra "Profissional: Bia (você)".

### 5.9 Painel — `/painel/agenda` (dia e semana)
- **Um bloco por item** na coluna do profissional do item (RN-36). Conteúdo do bloco (substitui D8):
  `<strong>09:00–10:00</strong> Maria Souza · Escova · Confirmado` + `· Encaixe` quando houver.
- Gestor vê, ao fim do texto, **"· 1 de 3"** quando o agendamento tem 2+ itens não cancelados, com texto para leitor
  de tela **"serviço 1 de 3 do agendamento"** (visível "1 de 3"). Ordem = ordem de início. Profissional **não** vê esse
  marcador (CA-33: o bloco dela não sugere serviços de outras pessoas).
- Cor e borda do bloco pelo **status do item** (classes atuais `.confirmado`, `.concluido`, `.nao_compareceu`,
  `.cancelado`); a geometria (top/height pela duração do item) segue a régua de 0,1 rem/min.
- Indicador de falha (D-043): em **todos** os blocos visíveis da reserva; nenhuma mudança de geometria.
- Todos os blocos do mesmo agendamento levam ao mesmo detalhe; o link do bloco ganha a âncora do item
  (`…/reservas/<id>#item-<itemId>`) para o detalhe abrir na parada certa (com e sem JS).
- Semana: uma linha por item, mesmo texto; "Falha ao enviar mensagem" visível como hoje.
- Aviso de limite: **"Mostrando os primeiros 200 serviços deste período. Use o filtro de profissional ou a visão por
  dia para ver o restante."** (substitui o texto de 200 reservas; o arquiteto aponta o texto atual em
  `MENSAGENS_AGENDA`).

### 5.10 Painel — `/painel/agenda/reservas/[id]`
```
Celular (375)                                   Desktop (≥ 48rem): mesma ordem, coluna 40rem
Reserva                                         h1 (mantido)
Voltar para a agenda
[resultado do PRG: "Escova (09:00) foi cancelado. A cliente será avisada…"]  role=status, foco
Cliente     Maria Souza                         dl (dt suave); desktop 12rem | 1fr
Telefone    (11) 98765-4321
Data        Quinta-feira, 26/11/2026            NOVO (substitui Início/Fim)
Situação    Confirmada                          status derivado (RN-21), rótulo feminino
Origem      Página do salão
                                                 (Profissional/Início/Fim saem da dl e vão para cada serviço)
Serviços                                        h2
09:00–10:00 ● Escova                [Confirmado]           id="item-<id>"
            com Ana · 1 h · R$ 90,00
            [Marcar como concluído] [Não compareceu]        só se a máquina permitir (RN-20)
            Remarcar · Cancelar                             links (GET) — ações deste serviço
10:00–10:40 ● Hidratação            [Cancelado]            riscado, sem ações
            com Bia · 40 min · R$ 75,00
15:00–15:45 ● Manicure      [Confirmado] [Encaixe]
            com Carla (inativa) · 45 min · R$ 40,00
            Remarcar · Cancelar
───────────────────────────────
Total  R$ 130,00 · 2 serviços                    não cancelados (RN-35)
Itens cancelados não entram no total.            suave, só se houver cancelado
[Cancelar todos os serviços]                     Button perigo (link GET ?cancelar=todos) — só gestor, só se 2+ canceláveis
Mensagens de WhatsApp                            SituacaoMensagens (inalterado; filtrado por papel no servidor)
```
Ações por item, sem diálogo e sem JS obrigatório:
- **Situação**: botões de envio (POST) dentro da parada, como hoje; nomes acessíveis completos: "Marcar Escova como
  concluído", "Marcar Escova como não compareceu" (visível: "Concluído" / "Não compareceu"; verbo e serviço em texto
  oculto). Texto visível em 375 px cabe em uma linha cada.
- **Remarcar**: link GET `?remarcar=<itemId>#remarcar` abre, **logo abaixo da parada**, o formulário do item:
  ```
  Remarcar Escova                                    h3 (id="remarcar", recebe foco via âncora)
  Serviço       [Escova ▾]
  Profissional  [Ana ▾]          (profissional logado: texto fixo)
  Data          26/11/2026 — a mesma dos outros serviços.   (texto, quando há outro item não cancelado; RN-22)
                [date]           (campo, só quando é o único item não cancelado)
  Hora (HH:MM)  [09:00]
  [aviso de encaixe deste item] [ ] Confirmo o encaixe
  [Remarcar serviço]   Fechar    (Fechar = link para a página sem ?remarcar)
  ```
  Só um formulário de remarcar aberto por vez. Ele aparece no lugar certo também na resposta do POST com erro.
- **Cancelar um serviço**: link GET `?cancelar=<itemId>#cancelar` mostra, sob a parada, a caixa de confirmação atual
  (`.confirmacao`, aviso) com o texto **"Cancelar Escova (09:00 com Ana)? O horário será liberado e a cliente será
  avisada, se tiver aceitado as mensagens. Os outros serviços continuam marcados."** e os botões POST **"Sim, cancelar
  este serviço"** (perigo) e o link **"Manter serviço"**.
- **Cancelar todos**: link GET `?cancelar=todos#cancelar-todos` abre, sob o total, **"Cancelar os 2 serviços que
  ainda podem ser cancelados (Escova 09:00, Manicure 15:00)? Serviços concluídos ou já terminados ficam como estão. A
  cliente recebe uma única mensagem."** e **"Sim, cancelar todos"** (perigo) / **"Manter serviços"**. O botão inicial
  só aparece com 2+ itens canceláveis (com 1, "Cancelar" do item já resolve; caso limite 11 da spec).
- Resultado (PRG `?resultado=`; lista fechada, o nome do serviço vem da leitura do item pela página):
  "Escova (09:00) foi remarcado para 10:30 com Bia." · "Escova (09:00) foi cancelado. A cliente será avisada se tiver
  aceitado as mensagens." · "2 serviços cancelados. A cliente receberá uma única mensagem." · "Escova marcado como
  concluído." · "Escova marcado como não compareceu."
- Recusas (estado da ação, Alert erro dentro da parada do item): "Este serviço já terminou e não pode mais ser
  cancelado." · "Só é possível marcar o resultado depois do início do serviço." · "Este serviço está cancelado." ·
  "Os outros serviços desta reserva estão em 26/11/2026; a data não pode mudar." · "Nenhum serviço desta reserva
  pode ser cancelado agora."
- **Profissional logado**: vê só as próprias paradas; acima da lista, p suave **"Você vê apenas os seus serviços
  nesta reserva."** (só quando a reserva tem itens de outras pessoas — se o servidor não puder informar isso sem
  vazar, a frase aparece sempre para o papel profissional; ver ND-2). Total = soma só dos itens visíveis, rotulado
  **"Total dos seus serviços"**. Sem "Cancelar todos".
- Situação totalmente cancelada: dl "Situação: Cancelada"; todas as paradas riscadas; total "Total (cancelada):
  R$ 205,00".

## 6. Estados (resumo com textos exatos)

| Tela | Estado | Texto / comportamento |
|---|---|---|
| Público, passo serviço | vazio por calendário | "Nenhum horário para {serviço} neste dia." / "Escolha outro dia ou altere os serviços." |
| | vazio por conflito com item escolhido | "Os horários de {serviço} neste dia coincidem com os serviços que você já escolheu." / "Altere o horário de outro serviço acima ou escolha outro dia." |
| | sem seleção ao continuar | Alert aviso "Escolha um horário para {serviço}." |
| | carregamento | Sem estado intermediário (GET de página inteira); nada de skeleton. |
| Público, dados | enviando | Botão "Reservando…" (atual, `ocupado`). |
| | erro de campo | Inalterado (Field + mensagem no topo com foco). |
| | reescolha | §5.6. |
| | sucesso | §5.5 "Reserva confirmada!" / repetida "Esta reserva já estava confirmada." |
| Equipe, nova | linha adicionada/removida | status "Linha de serviço adicionada." / "Serviço {n} removido." |
| | encaixe | §5.8. |
| | criada | "Reserva registrada." / "Reserva registrada com encaixe em {n} serviço(s)." (plural por regra, não por "(s)": "1 serviço", "2 serviços") |
| Detalhe | cancelamento parcial | parada riscada + etiqueta "Cancelado"; total recalculado; "Itens cancelados não entram no total." |
| | cancelar todos | §5.10. |
| | foco | Resultado PRG recebe foco (como hoje); âncoras `#remarcar`, `#cancelar`, `#cancelar-todos`, `#item-<id>` levam o foco do navegador ao alvo (alvo com `tabIndex={-1}`). |

## 7. Interação e movimento
- Nenhuma animação nova. Transições existentes (`--duracao` 150 ms em botões e rádios) continuam e já são zeradas por
  `prefers-reduced-motion` em `globals.css`.
- Sem JS tudo funciona: passos por GET (estado inteiro na query), filtro por GET, reserva por POST com estado na
  resposta, linhas da equipe por POST com estado na resposta, ações por item por GET (abrir) + POST (executar) + PRG.
  Nenhum `<dialog>`.
- Com JS, só melhorias: foco no Alert/resumo/resultado (padrão atual) e foco na legenda da linha após remover.
- `scroll-margin-top: var(--espaco-4)` nos alvos de âncora para não colar no topo.

## 8. Arquivos afetados (para o arquiteto distribuir a posse)
Componentes compartilhados
- `src/components/ui/RoteiroDoDia.tsx`, `RoteiroDoDia.module.css`, `RoteiroDoDia.test.tsx` (novo).
- `src/components/ui/SlotGrid.tsx`, `SlotGrid.module.css`, `SlotGrid.test.tsx` (`prefixoDoValor`, `nivelLegenda`).
- `src/app/dev/componentes/` (exemplo do `RoteiroDoDia` nos quatro estados e do `SlotGrid` com prefixo).

Público
- `src/app/(publico)/[slug]/_componentes/Passos.tsx` (passos de data e por serviço; remove `PassoProfissional`),
  `FormularioDados.tsx` (roteiro, reescolha por item), `PaginaDoSalao.tsx`, `Salao.module.css`, novo
  `FiltroDeProfissional.tsx`; testes `PaginaDoSalao.test.tsx`, `FormularioDados.test.tsx`.
- `src/server/reserva-publica/tipos.ts` (mensagens novas, `VisaoDoPasso`), `passos.ts`, `reescolha.ts` (contrato:
  arquiteto).
- Vitrine `src/app/dev/reserva/` (`dados.ts` com 3 profissionais e os 3 serviços do exemplo; vistas `?vista=reescolha`,
  `?vista=confirmada`, `?vista=conflito`).

Painel
- `src/app/painel/agenda/nova/FormularioReservaManual.tsx`, `NovaReserva.module.css`, `estado.ts`, `page.tsx`,
  novo `LinhaDeItem.tsx`; vitrine `src/app/dev/reserva-nova/` (`?vista=encaixe`, `?vista=erros`, 3 linhas).
- `src/app/painel/agenda/_componentes/Eventos.tsx`, `GradeDoDia.tsx`, `ListaDaSemana.tsx`, `DetalheDaReserva.tsx`,
  `Agenda.module.css`; `src/server/agenda/rotulos.ts` (`rotuloDoStatusDoItem`); vitrine `src/app/dev/agenda/`
  (reserva de 3 itens em 3 colunas, um cancelado, um com falha).
- `src/app/painel/agenda/reservas/[id]/AcoesDaReserva.tsx` (vira ações por item + "Cancelar todos"),
  `AcoesDaReserva.module.css`, `estado.ts` (códigos de PRG), `page.tsx`; vitrine `src/app/dev/reserva-acoes/`
  (`?vista=profissional`, `?remarcar=`, `?cancelar=`, `?cancelar=todos`, totalmente cancelada).

E2E (axe 4.14.0, 375×812, teclado, sem JS, sem rolagem horizontal)
- `e2e/reserva-publica*.spec.ts`, `e2e/publico-*.spec.ts` (cenário do exemplo), `e2e/reserva-nova*.spec.ts`,
  `e2e/agenda*.spec.ts`, `e2e/reserva-acoes*.spec.ts`.

## 9. Critérios de revisão visual (verificáveis)
Gerais
1. Nenhum literal de cor fora do `:root` de `src/app/globals.css` (teste de conformidade existente passa); nenhum token
   novo criado nesta demanda.
2. Toda media query de largura nos CSS tocados é exatamente `(min-width: 48rem)`.
3. Em 375×812, `document.documentElement.scrollWidth === 375` em: cada passo público (serviços, dia, serviço 1/2/3,
   dados, confirmação, reescolha), nova reserva com 3 linhas e com aviso de encaixe, agenda dia/semana, detalhe com 3
   itens e com `?remarcar=` aberto.
4. axe 4.14.0 sem violações em todas as telas do item 3.
5. Todos os alvos interativos novos (pílulas de filtro, "Alterar", "Remover", "Adicionar outro serviço", botões de
   situação por item, "Remarcar", "Cancelar") têm altura ≥ 2,75 rem (44 px) medida por `boundingBox`.
6. Foco visível (contorno 3 px `--cor-foco`) em todo elemento focável novo; nenhum `outline: none` sem substituto.

Público
7. O texto "com o mesmo profissional" não aparece em nenhuma tela do fluxo público nem em `/painel/agenda/nova`.
8. Não existe a opção "Sem preferência" nem o link "Alterar profissional".
9. No passo do serviço k, o `h2` é o nome do serviço e "Serviço k de N" está no `aria-describedby` dele.
10. Todas as grades de horário do mesmo serviço partilham um único `name` (uma parada de Tab por serviço); com 2+
    profissionais elegíveis há o `nav` "Filtrar por profissional" com o atual em `aria-current="true"`.
11. O horário de cada parada do roteiro usa `--fonte-titulo`, `--texto-lg` (1,125 rem) e `tabular-nums`.
12. O roteiro é um `<ol>` em ordem de início; o passo de dados mostra 1 link "Alterar" por item, cujo nome acessível
    começa por "Alterar" e contém o serviço, a hora e o profissional.
13. O passo de dados e a confirmação mostram o total (soma dos itens) e não mostram duração total.
14. Ordem de Tab no passo de dados: links "Alterar" (em ordem de início) → "Alterar serviços" → Nome → Telefone →
    consentimentos → verificação → "Confirmar reserva".
15. Reescolha: o Alert nomeia o serviço e o horário que caíram; nome, telefone e consentimentos voltam preenchidos;
    a URL não muda; vale com `javaScriptEnabled: false`.
16. Cenário do exemplo completo só por teclado em 375×812 com toque, e sem JS.

Painel
17. Na agenda do dia, a reserva do exemplo gera 3 blocos (colunas Ana, Bia, Carla) com o texto do serviço do item e
    o status no masculino; gestor vê "1 de 3", "2 de 3", "3 de 3"; profissional não vê o marcador e o HTML dela não
    contém "Escova"/"Manicure" quando só tem a Hidratação.
18. A altura de cada bloco = duração do item × 0,1 rem; o indicador de falha aparece em todos os blocos da reserva sem
    mudar a altura (teste de geometria da D-043 estendido).
19. Detalhe: a `dl` não tem mais "Profissional", "Início" nem "Fim"; tem "Data". Cada item tem `id="item-<id>"`,
    hora início–fim, serviço, profissional, etiqueta de status textual e, quando aplicável, "Encaixe".
20. Item cancelado: nome e preço com `text-decoration: line-through`; a etiqueta "Cancelado" não é riscada; o total
    exclui o item e aparece "Itens cancelados não entram no total."
21. "Cancelar todos os serviços" só aparece para o gestor e com 2+ itens canceláveis; abre a confirmação por GET e
    executa por POST; sem `<dialog>`.
22. Com `?remarcar=<itemId>` existe exatamente um formulário de remarcar, logo depois da parada desse item; com outro
    item não cancelado, a data aparece como texto, não como campo.
23. Nova reserva: "Adicionar outro serviço" e "Remover" funcionam sem JS e preservam todos os valores digitados
    (data, linhas, nome, telefone, consentimento); "Adicionar" some com 10 linhas; "Remover" só com 2+ linhas.
24. Pressionar Enter num campo de texto da nova reserva **registra** a reserva (não adiciona nem remove linha).
25. O aviso de encaixe lista "Serviço n — {serviço} com {profissional} às {hh:mm}: {motivos}" para cada item com
    motivo, com uma única caixa "Confirmo o encaixe destes serviços".

## 10. Conflitos e alternativas
- **C1 — Valor do rádio com profissional + instante.** O `SlotGrid` hoje usa o ISO como valor. Proposta: prop de texto
  `prefixoDoValor` (componente cliente não recebe função do servidor, regra do CLAUDE.md). Alternativa, se o
  arquiteto preferir não mexer no `SlotGrid`: um `name` por profissional (`h_<idProf>`) — **descartada por mim**
  porque permite marcar dois profissionais ao mesmo tempo e o servidor teria de desempatar.
- **C2 — Um `useActionState` por ação com N itens.** Ações por item no detalhe reaproveitam os mesmos 3 (+1 para
  "Cancelar todos") `useActionState` em ordem fixa; o estado precisa carregar o `itemId` para a mensagem aparecer na
  parada certa. Abrir remarcar/cancelar por GET (`?remarcar=`, `?cancelar=`) garante um só formulário de cada tipo
  na página, evitando estados cruzados. Se o arquiteto mantiver a confirmação de cancelamento via estado da ação (como
  na D-030) em vez de GET, o visual é o mesmo, mas só um item pode estar em "confirmando" por vez.
- **C3 — Distinguir "sem horários" de "sem horários por conflito".** Exige saber se havia horários antes de descontar
  os itens escolhidos. Se isso aumentar o número de instruções SQL (CA-3), usar só o texto genérico do vazio, com o
  complemento **"Se você já escolheu outros serviços, tente alterar o horário deles."**
- **C4 — Marcador "1 de 3" para o profissional.** Omitido para ela por prudência (CA-33). Se o produto quiser que a
  profissional saiba que a cliente tem outros serviços, mostrar só "Agendamento com outros serviços", sem contagem.
- **C5 — Enter implícito na nova reserva.** O Enter num campo aciona o primeiro botão de envio do formulário em
  ordem de DOM; com "Remover"/"Adicionar outro serviço" antes de "Registrar reserva", um Enter na hora da linha 1
  removeria a linha. Recomendação: primeiro filho do `<form>` = `<button type="submit" hidden>` sem `name` (ou com o
  mesmo `name`/valor do "Registrar"), que vira o botão padrão; `hidden` o tira da tabulação e da árvore de
  acessibilidade (axe não o avalia). Chromium e Firefox acionam o botão padrão oculto na submissão implícita; o E2E
  (critério 24) verifica o resultado. Alternativa, se o tester encontrar navegador que ignore o botão oculto: repetir
  "Registrar reserva" visível no topo do formulário, antes da Data.
- **C6 — Filtro na reescolha.** O filtro é GET e perderia dados pessoais; na resposta de reescolha não há filtro (todas
  as grades do item aparecem). Aceitável: a lista é só de um serviço.

## 11. Dúvidas
Bloqueantes: nenhuma.

Não bloqueantes (suposição adotada)
- **ND-1** "Seguir sem {serviço}" na reescolha sem horário: suposto aceitável perder nome/telefone (GET, sem PII na
  URL). Se o produto não quiser essa saída, fica só "Escolher outro dia".
- **ND-2** Frase "Você vê apenas os seus serviços nesta reserva." para profissional: suposto exibida sempre para o
  papel profissional se o servidor não puder dizer, sem vazar, que há itens de outras pessoas.
- **ND-3** "Cancelar todos" só para o gestor (RN-25 limita a profissional aos próprios itens).
- **ND-4** Frase sobre intervalo entre serviços na confirmação (≥ 30 min entre paradas): suposta útil; pode ser
  retirada sem impacto se o líder preferir menos texto.
- **ND-5** Ordem dos profissionais no passo por serviço = ordem da seção "Equipe" do perfil.
