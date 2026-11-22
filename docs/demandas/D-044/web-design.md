# D-044 (E8.2) Salões no painel do super admin: web-design

Fonte: `spec.md` (RN-1..8, CA-1..14, §11). Autor: web-designer. Não altera código.

## 0. Evidências e limites
- Lido: `src/app/admin/{page.tsx,_componentes/CascaAdmin.tsx}`, `avaliacoes/_componentes/{FilaDeAvaliacoes,DetalheDaModeracao}.tsx` e `Moderacao.module.css`, `AdminLayout.tsx`, `NAVEGACAO_ADMIN` (`navegacao.ts:112`), `ui/{Alert,Button,DataList}`, `globals.css:14-71`, `assinatura/rotulos.ts`, D-042 `web-design.md`.
- Capturas 375/768/1280: NÃO feitas (diagnóstico pelo código; sem subir servidor). O desenvolvedor captura `/dev/admin-saloes` nas três larguras.
- Contrastes calculados (WCAG) com o :root; os pares são os já validados em D-042.

## 1. Diagnóstico
1. `/admin/saloes` não existe; a navegação admin já aponta para ela (`navegacao.ts:113`), mas `CascaAdmin.tsx:11` usa `semNavegacao`: o menu some em todo o admin. Sem menu, a lista seria inacessível exceto por URL.
2. A fila de avaliações usa cartão por item (`Moderacao.module.css:19-28`) com selos de borda `1px --cor-borda-controle` sem forma própria por estado (`:44-49`). Para salões (nome, slug, estado, suspensão, gestor) isso repete cartões; `DataList` já empilha em 375 px (`DataList.tsx`) e entrega semântica de tabela em 1280 px.
3. Selo só por texto e borda: dois sinais independentes (estado da assinatura, suspensão manual) ficariam indistinguíveis. Precisam de forma/ícone distinto, não só cor.
4. `DetalheDaModeracao.tsx:42-111` usa `h2` genérico e `section` com cartão; sem hierarquia entre ação reversível (arquivar) e destrutiva. Aqui há três ações de pesos diferentes (suspender/reativar: reversível; editar e-mail: derruba sessões; estender teste: efeito no provedor, irreversível pela porta).
5. Não há padrão de confirmação em duas etapas para POST: a D-042 usa `?cancelar=1` (GET), adequado sem dados digitados. Motivo digitado não pode ir em query (histórico, logs, Referer).
6. `FilaDeAvaliacoes.tsx:62` mostra datas em UTC rotuladas; aqui D (fim do teste) deve ir no fuso do salão com data e hora (spec §6).

## 2. Direção visual
**Conceito: "livro de registro da plataforma".** Lista como tabela densa e sóbria (`DataList`) com dois selos de forma distinta; detalhe em uma coluna de leitura (40rem), seções separadas por filete e título Fraunces, cada seção com seu próprio formulário e seu próprio botão. O peso visual da ação cresce com a consequência: editar (secundária), suspender (secundária + etapa de confirmação com `Alert aviso`), reativar (primária), estender teste (primária, mas só após prévia D → D+N em bloco realçado e botão com o efeito escrito no rótulo). Sem cartões repetidos, sem sombra, sem gradiente. Nenhum token novo.

Alternativas descartadas: cartões por salão (repetição, ver diagnóstico 2); `ConfirmDialog` (proibido sem JS); confirmação por GET com motivo na URL (vazamento); abas na página de detalhe (exigem JS ou fragmentos e escondem ações de risco).

## 3. Sistema
Tokens novos: **nenhum**. Pares (razão):
| Uso | Texto / fundo | Razão |
|---|---|---|
| Corpo, nome, valores | `--cor-texto` / `--cor-superficie` | 15,47 |
| `dt`, apoio, slug na lista | `--cor-texto-suave` / `--cor-superficie` | 7,22 |
| Selo de estado (neutro, com ícone) | `--cor-texto` / `--cor-superficie-alt`, borda `--cor-borda-controle` | 13,29 |
| Selo "Suspenso manualmente" | `--cor-erro-texto` / `--cor-erro-fundo` | 7,22 |
| Selo "Em carência"/"Pendente" (atenção) | `--cor-aviso-texto` / `--cor-aviso-fundo` | 7,25 |
| Selo "Ativa" | `--cor-sucesso-texto` / `--cor-sucesso-fundo` | 7,78 |
| Prévia D → D+N (bloco) | `--cor-texto` / `--cor-superficie-alt` | 13,29 |
| Links | `--cor-primaria-forte` / `--cor-superficie` | 7,79 |
| Primária / perigo | `--cor-sobre-primaria` / `--cor-primaria` (≥ 4,5); `--cor-sobre-perigo` / `--cor-perigo` (≥ 4,5, já em `Button`) | usar `Button` |
Escala: `h1` global (2xl celular, 3xl ≥ 48rem); `h2` de seção Fraunces `--texto-xl`; D e D+N: `--texto-lg` peso 600; rótulos `dt` e ajuda `--texto-sm`. Espaços: `--espaco-8` entre seções, `--espaco-4` dentro; seções com `border-top: 1px solid var(--cor-borda-sutil)` e `padding-top: var(--espaco-6)`. Raio `--raio`. Larguras: detalhe `max-width: 40rem`; lista usa `--largura-conteudo`. Cada estado de selo leva ícone SVG inline `aria-hidden` (círculo cheio = ativa; relógio = em teste; triângulo = atenção; traço = sem assinatura/cancelada/encerrada; cadeado = suspenso manual) usando `currentColor`, mais o rótulo em texto: cor nunca é o único sinal.

## 4. Componentes
Novos, em `src/app/admin/saloes/_componentes/` (específicos da tela; nada em `ui/`), reaproveitando `DataList`, `Field`, `Select`, `Button`, `Alert`, `EmptyState`:
1. **`ListaDeSaloes`**: `<form method="get">` (campo `q` com rótulo "Buscar por nome, endereço ou e-mail do gestor", `Select` "Assinatura" com Todas + 9 rótulos de `rotulos.ts`, `Select` "Suspensão manual" Todas/Sim/Não, botão "Filtrar", link "Limpar filtros" se houver filtro); contagem em `aria-live="polite"` ("42 salões"); `DataList` colunas Salão (nome como link ao detalhe, `aria-label` "Abrir <nome>"), Endereço (`/slug`), Assinatura (selo), Suspensão (selo ou "-"), Gestor (e-mail). Paginação `nav aria-label="Paginação"` Anterior/Próxima preservando `q`, `estado`, `suspenso` (padrão de `FilaDeAvaliacoes`). Em 375 px a DataList empilha linhas; nome em linha própria, sem rolagem horizontal (`overflow-wrap: anywhere` em e-mail/slug).
2. **`SeloDeEstado`**: `<span>` com ícone + rótulo; variantes `neutro|sucesso|aviso|erro` por estado (ativa: sucesso; em teste: neutro; pendente, em carência: aviso; suspensa, cancelada: erro? não, neutro com traço; "Sem assinatura": neutro). Suspensão manual: variante erro + cadeado. Sem estados interativos.
3. **`CabecalhoDoSalao`**: `h1` nome, linha `/slug` + selos (`ul aria-label="Situação"`), link "Voltar à lista" acima (preservando filtros por `?voltar` opcional; padrão: `/admin/saloes`).
4. **`SecaoDoSalao`**: `<section aria-labelledby>` com `h2` e filete; contém um `<form method="post">` próprio. Seções, nesta ordem: Dados do salão (nome, slug, fuso `Select` canônico), Regras da agenda (grade `Select`, antecedência em horas, janela em dias, buffer em minutos; botão único "Salvar dados do salão" cobre as duas seções: um só form para evitar estado parcial, com dois `h2` por fieldset/legend), Gestor (nome, e-mail; `Alert aviso` fixo acima do campo: "Trocar o e-mail desfaz a confirmação, encerra as sessões do gestor e envia um link de confirmação ao novo endereço. A senha não é alterada."), Assinatura (leitura: selo, plano, D se em teste; link "Ver assinatura" só se a rota existir), Suspensão, Teste gratuito.
5. **`SuspensaoManual`** e **`EstenderTeste`**: formulários em duas etapas (ver §5). Um só POST com campo oculto `etapa` (`previa` | `confirmar`); a etapa 1 devolve a página com a etapa 2 renderizada na resposta (sem PRG, sem query), repassando motivo/N/D em `<input type="hidden">`. Com JS: `useActionState`, um por ação, em ordem fixa (regra do projeto). Etapa 2: `<section role="group" aria-labelledby>` com `Alert aviso`, bloco de prévia, botão de confirmação e link "Voltar" (`<a>` para a própria página).
Estados dos botões: padrão/hover/foco/desabilitado herdados de `Button` (foco `--foco-largura` + `--cor-foco`, nenhum `outline:none`). Erro de campo: `Field` com `erro` (mensagem ligada por `aria-describedby`, `aria-invalid`).

## 5. Especificação por tela
### 5.1 `/admin/saloes` (celular e desktop)
```
[menu admin: Salões | Mensagens | Auditoria]  (ver §10: remover semNavegacao)
h1  Salões
form GET:  [Buscar........] [Assinatura v] [Suspensão manual v] [Filtrar] Limpar filtros
p   42 salões                                         (aria-live)
DataList (legenda visível "Salões da plataforma")
 Salão            Endereço    Assinatura          Suspensão               Gestor
 Studio Aurora    /aurora     (relógio) Em período de teste   -             ana@exemplo.com.br
 Espaço Lume      /lume       (atenção) Pagamento não confirmado  (cadeado) Suspenso manualmente   bia@...
nav Paginação:  Anterior   Página 2 de 3   Próxima
```
Celular: cada linha empilha (rótulo da coluna + valor, comportamento da `DataList`); filtros em coluna, largura total; botões ≥ `--alvo-minimo`. Desktop (≥ 48rem): tabela, filtros em linha (`flex-wrap`, `align-items:flex-end`). Ordem de tabulação: menu → busca → 2 selects → Filtrar → (Limpar) → links dos salões → Anterior/Próxima.

### 5.2 `/admin/saloes/[id]` (uma coluna, 40rem)
```
a   Voltar à lista
h1  Studio Aurora
p   /aurora   [(relógio) Em período de teste] [(cadeado) Suspenso manualmente]
[Alert de resultado]
h2 Dados do salão     Nome | Endereço do salão (slug) com ajuda "O endereço anterior continua levando a este salão." | Fuso horário
h2 Regras da agenda   Intervalo da grade (min) | Antecedência mínima (h) | Janela de reserva (dias) | Intervalo entre atendimentos (min)
h2 Gestor             [Alert aviso] Nome | E-mail          [Salvar alterações]
h2 Assinatura         dl: Situação; Plano R$ 79,00/mês; Fim do teste 30/11/2026 às 14:00 (fuso do salão)
h2 Suspensão          
h2 Teste gratuito     
```
Um só botão "Salvar alterações" ao fim do formulário de edição (Dados + Regras + Gestor), antes das seções Assinatura, Suspensão e Teste gratuito, que são formulários independentes.

**Suspensão** (salão ativo): texto "Enquanto suspenso, o salão não recebe novas reservas. A assinatura e as sessões não são alteradas. Cancelamentos de reservas futuras continuam permitidos." Campo "Motivo" (obrigatório, `maxLength` 280, ajuda "Não escreva telefone, e-mail ou dados de clientes. O motivo fica só na auditoria."), botão secundário "Continuar". Etapa 2: `Alert aviso` "Suspender Studio Aurora? Ela deixa de aceitar novas reservas agora." + motivo em citação + `Button perigo` "Suspender salão" + link "Voltar". Salão suspenso: texto "Suspenso manualmente em 20/11/2026 às 09:12." + (se a assinatura está `suspensa`) `Alert info` "Reativar o salão não reativa a assinatura." + campo "Motivo (opcional)" + `Button primaria` "Reativar salão" (uma etapa só, reversível sem custo).

**Teste gratuito** (só `em_teste` elegível): "O teste termina em **30/11/2026 às 14:00**." Campo numérico (`inputmode="numeric"`, texto, não `type=number`, para aceitar a validação do servidor) "Dias a acrescentar (1 a 90)", botão secundário "Ver novo fim". Etapa 2: bloco realçado `--cor-superficie-alt`: "30/11/2026 às 14:00 → 10/12/2026 às 14:00 (+10 dias de 24 h)"; `Alert aviso` "Isto altera a próxima cobrança no provedor de pagamento e não pode ser desfeito por aqui."; `Button primaria` "Estender teste em 10 dias"; link "Voltar". Não elegível: parágrafo com o motivo (tabela §6), sem campo.

### 5.3 Celular x desktop
Mesma ordem e coluna; no desktop `dl` em duas colunas `max-content 1fr` e botões em linha; no celular botões em coluna, largura total.

## 6. Estados (texto exato)
- Vazio da lista: `EmptyState` "Nenhum salão encontrado." + "Tente outro nome ou limpe os filtros."
- Sucesso (`Alert sucesso`): "Dados do salão salvos." / "Nada mudou: os valores são os mesmos." (info) / "Salão suspenso." / "Salão reativado." / "Teste estendido até 10/12/2026 às 14:00."
- `sem_efeito` (info): "O salão já estava suspenso. Nada foi alterado." / "O salão não estava suspenso. Nada foi alterado."
- Erro de campo: mensagens da E2.5 reaproveitadas; motivo vazio "Informe o motivo (5 a 280 caracteres)."; N "Informe um número inteiro de 1 a 90."; e-mail em uso "Este e-mail já é usado por outra conta."; resumo de erros no topo (`ResumoDeErros` do painel, `role=alert`, foco no resumo com JS).
- Recusado estender (motivo próprio, `Alert info` no lugar do campo): "O teste só pode ser estendido enquanto a assinatura está em período de teste." / "Este salão não tem assinatura." / "O teste já terminou." / "O teste termina em menos de 5 minutos." / "A assinatura não tem vínculo com o provedor."
- Provedor falhou (`Alert erro`, rótulo "Erro:"): "O provedor não refletiu o adiamento; nada foi alterado. Tente novamente mais tarde." (também para `NaoImplementado`).
- `mudou` (`Alert aviso`): "A assinatura mudou enquanto você decidia. O fim do teste agora é 12/12/2026 às 14:00. Confira e tente de novo."
- `divergencia` (`Alert erro`): "O provedor adiou a cobrança, mas a assinatura mudou aqui. Nada foi gravado. Confira a situação com o provedor."
- 403: `AcessoNegado` existente. 404: página 404 do Next (sem vazar existência). Carregamento: servidor, sem esqueleto; botões com `aria-disabled` não são necessários.
- Foco: após POST sem JS a página recarrega no topo e o `Alert` vem antes dos formulários; com JS, foco no `Alert`/resumo (`tabIndex=-1`).

## 7. Interação e movimento
Sem animações próprias; só `transition` de `Button` (150 ms, já zerada por `prefers-reduced-motion` no tema). Sem JS: tudo por `<form method="post">`/GET; etapa 2 renderizada na resposta do POST (um recarregar reenvia o POST: o navegador avisa, comportamento aceito e igual a D-012). Com JS: melhoria por `useActionState` (sem rolagem automática, sem diálogo).

## 8. Arquivos afetados
`src/app/admin/saloes/page.tsx`, `src/app/admin/saloes/[id]/page.tsx`, `src/app/admin/saloes/acoes.ts`, `src/app/admin/saloes/_componentes/*` (+ `Saloes.module.css`, testes `.test.tsx`), `src/app/admin/_componentes/CascaAdmin.tsx` (menu), `src/app/dev/admin-saloes/page.tsx` + `ROTAS.devAdminSaloes` em `src/config/navegacao.ts`, `e2e/admin-saloes.spec.ts`, `e2e/admin-saloes-sem-js.spec.ts`, `src/app/admin/page.tsx` (link para Salões). Contratos de tela dependem de `src/server/admin/` (arquiteto).

## 9. Critérios de revisão visual
1. Nenhum literal de cor fora do `:root` (`src/app/globals.test.ts` passa); nenhum token novo.
2. 375×812: sem rolagem horizontal em `/dev/admin-saloes` (lista e detalhe), e-mail/slug longos quebram linha.
3. Um único `h1` por página; `h2` por seção; `DataList` com `<caption>` "Salões da plataforma".
4. Cada selo tem ícone `aria-hidden` + rótulo textual; suspensão manual nunca se distingue só pela cor; todos os pares ≥ 4,5:1 (tabela §3).
5. Ordem de tabulação da lista: §5.1; do detalhe: Voltar → campos de edição na ordem visual → Salvar → Motivo → Continuar/Reativar → N → Ver novo fim.
6. Foco visível em todo controle (contorno `--foco-largura` `--cor-foco`, sem `outline:none`); alvos ≥ `--alvo-minimo`.
7. Suspender e estender exigem a etapa 2 com o texto de §5.2; a etapa 2 mostra "D → D+N" com data e hora do fuso do salão (via `format.ts`), e o rótulo do botão contém o efeito ("Estender teste em 10 dias").
8. Nenhuma URL carrega motivo, N ou e-mail em query além de `q`, `estado`, `suspenso`, `pagina` na lista.
9. Sem JS: todos os fluxos (filtrar, editar, suspender, reativar, estender) completam e mostram os textos de §6 na resposta.
10. axe 4.14.0 zero violações, 375×812, nos estados: lista, vazio, detalhe, etapa 2 de suspensão, etapa 2 de estender, cada erro/resultado de §6.
11. Datas só por `src/lib/format.ts`; menu admin visível com "Salões" marcado (`aria-current`).

## 10. Conflitos e alternativas
- `CascaAdmin` usa `semNavegacao`: com `adminMensagens` e `adminAuditoria` ainda sem tela, ligar o menu apontaria para 404. Alternativa: `NAVEGACAO_ADMIN` filtrada (só rotas existentes) ou menu ligado só com "Salões" e "Avaliações"; decisão do arquiteto. Padrão mínimo: link "Salões" no `/admin` e na barra do h1 ("Início da administração" ↔ "Salões").
- Etapa 2 via POST (e não GET) por causa do motivo: contradiz o padrão D-042 (`?cancelar=1`), mas é necessária; recarregar a resposta reenvia o POST (inócuo: ação idempotente `sem_efeito`/`mudou`).
- `Field` não tem `type=number` exigido: o N usa texto com `inputmode="numeric"` para que `1e1`/`+5` cheguem ao servidor (CA-6); o desenvolvedor confere se `Field` aceita `inputMode`.

## 11. Dúvidas
Não bloqueantes: (a) filtros "Assinatura" usam os 9 rótulos de `rotulos.ts` (suposição); (b) o link "Ver assinatura" só aparece se `/admin/saloes/[id]/assinatura` existir (E8.3); (c) o fim do teste é mostrado no fuso do salão com a data e a hora, conforme spec §6.
