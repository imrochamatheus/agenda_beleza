# D-045 (E8.3) Assinatura, fila de mensagens e auditoria no painel do admin: web-design

Fonte: `spec.md` (RN-1..15, CA-1..16), `docs/demandas/D-044/web-design.md`. Autor: web-designer. Não altera código.

## 0. Evidências e limites
- Lido: `CascaAdmin.tsx`, `DataList.tsx`/`.module.css`, `Saloes.module.css`, `SeloDeEstado.tsx`, `navegacao.ts:47-128`, `mensagens/rotulos.ts`, `globals.css:14-71`, D-044 web-design.
- Capturas 375/768/1280: NÃO feitas (sem subir servidor; diagnóstico pelo código). O desenvolvedor captura `/dev/admin-mensagens` e `/dev/admin-saloes` nas três larguras.
- Contrastes são os pares já validados em D-042/D-044 (`globals.test.ts`).

## 1. Diagnóstico
1. Menu: `CascaAdmin.tsx` usa `NAVEGACAO_ADMIN_DISPONIVEL`, que filtra por `ROTAS_ADMIN_EXISTENTES = ['adminSaloes']` (`navegacao.ts:123`). Mensagens e Auditoria não aparecem até entrarem na lista (spec §3.4).
2. Quebra do selo em duas linhas (relatada em 768/1280, coluna Assinatura da D-044): `.selo` (`Saloes.module.css:61-74`) é `inline-flex` sem `white-space: nowrap`; o comentário diz que `overflow-wrap: normal` evita partir palavra, mas ainda permite quebrar entre as palavras ("Pagamento não / confirmado"), e a coluna da tabela encolhe. Correção (padrão único para todos os selos): `white-space: nowrap` no `.selo`, texto do rótulo dentro de um `<span>`, e na `DataList` a coluna de selos recebe `min-width: max-content` na célula (ver §4.1). Em 375 px, onde a célula empilha, o selo pode ocupar a largura inteira, sem cortar: manter `max-width: 100%` e `white-space: normal` só abaixo de 48rem (único ponto de quebra).
3. `DataList` tem 5 colunas na lista de salões; mensagens (8 dados) e auditoria (9 dados, mais JSON) estourariam a tabela entre 768 e 1100 px se cada dado fosse uma coluna. Precisa de composição por tela (§5).
4. Não existe padrão para JSON legível: `antes`/`depois`/`payload` em `<pre>` bruto seria a pior leitura e é rolagem horizontal interna em 375 px. A spec exige `<details>` sem JS; proponho diff por campo (§4.4) com o JSON completo como alternativa recolhida.
5. Não há padrão de confirmação em duas etapas para POST sem dado digitado no admin; a D-042 usa `?cancelar=1`, que cabe aqui (CA-14 pede `?confirmar=<id>`).
6. Fuso: tela por salão no fuso do salão; globais em `America/Sao_Paulo` com deslocamento visível. Sem um aviso, duas telas do mesmo admin mostrariam horas diferentes sem explicação.

## 2. Direção visual
Continua o **"livro de registro da plataforma"** da D-044: tabelas sóbrias, filete em vez de cartão, títulos Fraunces, uma coluna de leitura nos detalhes. Três telas, três composições, mesma gramática:
- **Assinatura** (por salão): leitura. Resumo em `dl`, depois duas "linhas do tempo" (transições, eventos) como `DataList`s curtas. Sem ações.
- **Mensagens** (fila global): o que importa é "qual falhou e posso reenviar?". A linha é composta, não uma coluna por dado: **Mensagem** (rótulo do tipo + revisão e, abaixo, salão), **Para** (telefone mascarado), **Situação** (selo) e **Quando**; tentativas e reenvio ficam no detalhe expandido por GET.
- **Auditoria**: leitura cronológica. Linha: **Quando**, **Ação** (rótulo + código pequeno), **Quem/Onde** (ator e salão), **Resultado** (selo); mudanças em `<details>` por linha com diff por campo.
O peso do reenvio é deliberadamente baixo na lista (botão discreto "Reenviar" só em `falhou`) e alto na confirmação (página própria com `Alert aviso` e botão primário nomeado). Sem token novo, sem sombra, sem gradiente, sem cartões repetidos.

Alternativas descartadas: uma coluna por campo (estoura 768 px); cartão por mensagem (repetição, e 20 por página alongam a rolagem); `ConfirmDialog` (proibido sem JS); modal de detalhe (idem); JSON bruto à mostra (ilegível e vaza ruído).

## 3. Sistema
Tokens novos: **nenhum**. Todo selo usa o `SeloDeEstado` existente, generalizado (ver §4.1). Pares:
| Uso | Texto / fundo | Razão |
|---|---|---|
| Corpo, valores | `--cor-texto` / `--cor-superficie` | 15,47 |
| Apoio (salão sob o tipo, código da ação, deslocamento UTC, `dt`) | `--cor-texto-suave` / `--cor-superficie` | 7,22 |
| Selo neutro | `--cor-texto` / `--cor-superficie-alt` | 13,29 |
| Selo falha/rejeitado/erro | `--cor-erro-texto` / `--cor-erro-fundo` | 7,22 |
| Selo atenção (pendente, enviando, recebido, ignorado) | `--cor-aviso-texto` / `--cor-aviso-fundo` | 7,25 |
| Selo sucesso (enviada, processado, sucesso) | `--cor-sucesso-texto` / `--cor-sucesso-fundo` | 7,78 |
| Diff "antes" / "depois" | `--cor-texto` / `--cor-superficie-alt`, rótulos de texto "Antes" e "Depois" (sem depender de cor) | 13,29 |
| Links | `--cor-primaria-forte` / `--cor-superficie` | 7,79 |
| Botão primário / perigo | via `Button` (≥ 4,5) | |
Escala: `h1` global; `h2` de seção `--texto-xl` Fraunces; valores principais `--texto-base`; apoio e `dt` `--texto-sm`; JSON em `font-family: ui-monospace, monospace` `--texto-sm`. Espaços `--espaco-3/4/6/8`; seções com filete `--cor-borda-sutil`. Larguras: listas `--largura-conteudo`; detalhe de assinatura `max-width: 56rem`; confirmação do reenvio `40rem`.

Mapa de selos (ícones de D-044; cada estado tem forma própria, nunca só cor):
- Mensagem: `enviada` círculo/sucesso "Enviada"; `pendente` relógio/aviso "Aguardando envio"; `enviando` relógio/aviso "Enviando"; `falhou` triângulo/erro "Falhou"; `nao_enviada` traço/neutro "Não enviada"; `cancelada_anonimizacao` traço/neutro "Cancelada (cliente removida)"; `substituida` traço/neutro "Substituída". Rótulos curtos próprios do admin; a frase longa de `rotuloDaMensagem` (D-043) fica no detalhe.
- Webhook: `processado` círculo/sucesso "Processado"; `recebido` relógio/aviso "Recebido"; `ignorado` traço/neutro "Ignorado"; `rejeitado` triângulo/erro "Rejeitado"; `erro` triângulo/erro "Erro".
- Auditoria: `sucesso` círculo/sucesso "Sucesso"; falha/recusa conforme o enum existente: triângulo/erro, rótulo textual do resultado.

## 4. Componentes
Em `src/app/admin/_componentes/` (compartilhados pelas 3 telas e por saloes); nada em `ui/`.

### 4.1 `SeloDeEstado` (generalizado, move de `saloes/_componentes`)
Props: `forma`, `variante`, `children` (texto). Markup: `<span class=selo><svg aria-hidden/><span>texto</span></span>`. CSS: `white-space: nowrap` em ≥ 48rem; abaixo, `white-space: normal` com `max-width: 100%`. Corrige o diagnóstico 2. Na `DataList`, a célula que contém selo ganha classe `.celulaSelo { min-width: max-content }` em ≥ 48rem. Sem estados interativos.

### 4.2 `FiltrosGet`
`<form method="get" role="search" aria-label="Filtrar …">`, campos com rótulo visível; botão "Filtrar" (`Button`, secundário) e, se houver qualquer filtro ativo, link "Limpar filtros" (para a rota sem query, alvo ≥ `--alvo-minimo`). Abaixo, uma linha `aria-live="polite"` com a contagem e os filtros ativos em texto ("20 de 134 mensagens · Situação: Falhou · Salão: Studio Aurora"). Filtro inválido ignorado: `Alert info` "Filtro inválido ignorado." acima da lista. Celular: coluna única, largura total; ≥ 48rem: `flex-wrap`, `align-items: flex-end`. Paginação `nav aria-label="Paginação"`: Anterior / "Página 2 de 7" / Próxima preservando todos os filtros; além do fim: `EmptyState` com link "Ir para a primeira página".

### 4.3 `ListaDeMensagens`, `ConfirmarReenvio`, `TentativasDaMensagem`
- `ListaDeMensagens`: `DataList` (legenda "Fila de mensagens") com 4 colunas: **Mensagem** (rótulo do tipo, "Remarcação 2" quando houver revisão; linha de apoio: nome do salão, link para `/admin/saloes/[id]`), **Para** (telefone mascarado ou "Cliente removida" ou "—"), **Situação** (selo + `erro_codigo` válido em apoio "código: resultado_incerto"), **Quando** (`Criada em 21/11/2026 14:05 (UTC-03:00)`; "Enviada em …" como apoio quando existir). Última ação da linha: link "Tentativas" (`?detalhe=<id>`, âncora `#m-<id>`) e, só em `falhou`, botão-link "Reenviar" (`?confirmar=<id>`, `Button variante="discreta"` renderizado como `<a>`). No celular as 4 colunas empilham como a `DataList` já faz (rótulo + valor), sem rolagem horizontal.
- Detalhe das tentativas (`?detalhe=<id>`): bloco expandido sob a lista (ou página irmã no mesmo path), `h2` "Tentativas de <rótulo>" e `DataList` "Tentativas" colunas **Nº**, **Início**, **Fim**, **Resultado** (selo), **Código**. Vazio: `EmptyState` "Nenhuma tentativa registrada". `<details>` não serve (precisa funcionar linkável); por isso GET.
- `ConfirmarReenvio` (`?confirmar=<id>`): uma coluna 40rem acima da lista. `h2` "Reenviar esta mensagem?"; `dl`: Mensagem (rótulo do tipo), Salão, Para (mascarado), Situação (selo Falhou). `Alert aviso`: "Será enviada uma nova mensagem por WhatsApp para esta cliente. Se a anterior chegou, ela receberá duas." Ações: `Button primaria` "Confirmar reenvio" (POST, `<form method="post">`, campo oculto só com o id) e link "Cancelar" (volta à lista com os mesmos filtros). Id de outra situação/inexistente: mostra `Alert info` "Esta mensagem não está mais com falha." e a lista, sem botão. O reenvio não pede motivo (spec não exige; evita texto livre sensível).
- Resultado (PRG `?reenvio=`): `Alert` no topo, `role="status"`:
  - `ok` (sucesso): "Reenvio solicitado. A mensagem volta para a fila e o envio é feito em instantes."
  - `ok` com fila indisponível (info): "Reenvio registrado. A fila está lenta; o envio será retomado automaticamente."
  - `recusada` (info): "Nada foi reenviado: esta mensagem não está mais com falha."
  - `obsoleta` (aviso): "Nada foi reenviado: a reserva mudou e a mensagem perdeu a validade."
  - `anonimizada` (info): "A cliente foi removida; a mensagem foi cancelada e nada foi enviado."
  - Código fora da lista: nenhum alerta.
- Duplo clique: segundo POST cai em `recusada`; o botão não precisa de `aria-disabled`.

### 4.4 `AntesDepois` (auditoria) e `JsonLegivel` (payload do webhook)
- `AntesDepois`: `<details>` por linha, `<summary>` "Ver alterações (3 campos)" ou "Sem detalhes" (sem `details`) quando ambos nulos. Dentro, uma `dl` por campo na união das chaves: `dt` = nome do campo (texto gravado, `overflow-wrap:anywhere`); `dd` com duas linhas rotuladas "Antes: <valor>" e "Depois: <valor>"; valor ausente = "(vazio)"; chave só em um lado = só aquela linha; chave igual nos dois lados = "Sem mudança: <valor>" em `--cor-texto-suave`. Valores escalares como texto; objetos/arrays como JSON de uma linha em `<code>` com quebra. Abaixo, segundo `<details>` aninhado "Ver JSON completo" com `<pre>` (`max-height: 20rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere`) para evitar rolagem horizontal da página (a interna é permitida pela spec; com `pre-wrap` nem ela ocorre). Mais de 30 campos: mostra os 30 primeiros + "e mais N campos (veja o JSON completo)". Tudo escapado pelo React.
- `JsonLegivel` (payload do evento): mesma `dl` de campos (um lado só: `dt`/`dd`) + "Ver JSON completo". Chaves e valores como texto; nada interpretado.
Foco: `summary` com o foco padrão do tema (contorno `--foco-largura` `--cor-foco`); abrir/fechar por Enter/Espaço, nativo.

## 5. Especificação por tela

### 5.0 Menu e cascas
`ROTAS_ADMIN_EXISTENTES` += `adminMensagens`, `adminAuditoria`; o menu mostra Salões | Mensagens | Auditoria, com `aria-current="page"` no atual (item "Salões" também marcado em `/admin/saloes/*`). Todas as páginas usam `CascaAdmin`. Cada página: um `h1`, link de volta quando for sub-rota.

### 5.1 `/admin/saloes/[id]/assinatura` (coluna 56rem)
```
a   Voltar ao salão                      (ROTAS.adminSalao)
h1  Assinatura de Studio Aurora
p   Horários no fuso do salão (America/Sao_Paulo, UTC-03:00)          [apoio]
h2  Resumo
 dl  Situação [selo]  | Vinculada ao Mercado Pago  Sim/Não
     Fim do teste 30/11/2026 às 14:00 | Pago até … | Primeira falha … | Carência até … | Cancelada em … | Acesso até …
     (campos nulos omitidos, nunca "null")
h2  Transições      (DataList "Transições da assinatura": Quando | De → Para | Causa | Origem)
 22/11/2026 09:12 | Em período de teste → Ativa | pagamento_aprovado | Origem: evento
h2  Eventos de webhook   [p "Mostrando os 50 mais recentes" quando houver mais]
 (DataList "Eventos recebidos": Recebido em | Tipo | Resultado [selo] | Origem | Processado em/Erro)
 + "Ver payload" (`<details>` JsonLegivel) na célula Tipo, em linha própria
a   Auditoria deste salão                (ROTAS.adminAuditoria?salao=<id>)
```
Origem: coluna "Origem" = "Válida" / "Inválida" (texto; inválida com selo de atenção). "Erro" = código fechado ou "—". Rejeitado distingue-se por selo triângulo "Rejeitado" (CA-1). Desktop: DataList em tabela; transições 4 colunas, eventos 5 colunas (payload sob Tipo, não coluna). Celular: empilha. Causa longa: truncada em 80 e `overflow-wrap:anywhere`.
Vazios: sem assinatura `EmptyState` "Este salão ainda não tem assinatura" (e omite Resumo/Transições/Eventos); sem transições "Nenhuma transição registrada"; sem eventos "Nenhum evento de webhook recebido". Erro de leitura: `ErrorState` existente "Não foi possível carregar a assinatura." + "Tentar novamente" (link para a mesma URL), sem stack.

### 5.2 `/admin/mensagens`
```
h1  Mensagens
p   Horários em America/Sao_Paulo (UTC-03:00).
form GET (Filtrar mensagens):  Situação [Todas v]  Salão [Todos v]  Tipo [Todos v]  [Filtrar]  Limpar filtros
p   20 de 134 mensagens · Situação: Falhou                            (aria-live)
[Alert resultado ?reenvio=]
[ConfirmarReenvio ?confirmar=]  [Tentativas ?detalhe=]
DataList "Fila de mensagens" (§4.3)
nav Paginação
```
"Salão" é `Select` com os salões (limite a 100 por ordem alfabética; acima disso, campo de texto "Código do salão" preenchido pelos links, validado como UUID; decisão do arquiteto, suposição: Select até 100). Situação: 7 estados com os rótulos curtos de §3. Tipo: 4 tipos. Ordem de tabulação: menu → Situação → Salão → Tipo → Filtrar → Limpar → (por linha: link do salão, Tentativas, Reenviar) → Anterior → Próxima.
Vazio (filtro ou fila): `EmptyState` "Nenhuma mensagem encontrada" + link "Limpar filtros" (se houver filtro); sem filtro "A fila está vazia.". Máscara: `+55 (71) 9****-1234` ou fixo `+55 (71) ****-1234`; anonimizada "Cliente removida" em `--cor-texto-suave` itálico; nulo/ inválido "—". Nenhum E.164 em atributos, `title`, `aria-label` ou `data-*`.

### 5.3 `/admin/auditoria`
```
h1  Auditoria
p   Horários em America/Sao_Paulo (UTC-03:00). Somente leitura.
form GET: Salão [Todos v] | Ator (e-mail) [.....] | Ação [Todas v] | Resultado [Todos v] | De [dd/mm/aaaa] | Até [dd/mm/aaaa] | [Filtrar] Limpar filtros
p   20 de 87 registros · Ação: Mensagem reenviada · De 01/11/2026
DataList "Registros de auditoria": Quando | Ação | Quem e onde | Resultado
 22/11/2026 09:12 (UTC-03:00) | Mensagem reenviada · mensagem.reenviar | admin@plataforma.com.br · Studio Aurora (link) | [Sucesso]
   └ <details> Ver alterações (2 campos)   (linha em largura total sob a linha, colSpan)
nav Paginação
```
Datas `De`/`Até`: `<input type="date">` com rótulo (nativo; sem JS funciona; fallback texto aceito `dd/mm/aaaa` do servidor); erro de campo (`De` maior que `Até`, data inválida): `Field` com `erro` "A data inicial é depois da final." / "Data inválida.", resultado ignora o filtro e mostra o aviso. Ator: texto, `autocomplete="off"`, ajuda "E-mail exato." Entidade aparece como apoio sob a ação ("Entidade: mensagem"). O `<details>` ocupa uma segunda linha da tabela (`<tr>` com `<td colSpan>`) em ≥ 48rem e dentro da célula "Resultado" abaixo de 48rem (a DataList é a responsável; se o `colSpan` não for suportado pela `DataList`, renderizar o `details` na célula "Ação"). Ações sem antes/depois: nada. Vazio: "Nenhum registro encontrado" + "Limpar filtros".

### 5.4 Desktop x celular (todas)
Mesma ordem; filtros em linha ≥ 48rem; abaixo, coluna; tabelas empilham (rótulo + valor por linha da `DataList`). Nada exige rolagem horizontal da página; JSON/código quebram linha (`overflow-wrap:anywhere`) ou rolam dentro de `<pre>` com `max-width:100%`.

## 6. Estados
- Vazio, sucesso e erro: textos exatos em §4.3 e §5. Carregamento: renderização no servidor (sem esqueleto); `loading.tsx` não necessário.
- Erro de leitura das listas: `ErrorState` "Não foi possível carregar as mensagens." / "…os registros." com "Tentar novamente" (link para a URL atual); sem stack.
- Acesso: 401 redireciona para `/admin/entrar?proximo=…`; 403 `AcessoNegado`; id malformado/inexistente de salão 404.
- Foco: após PRG a página recarrega no topo; o `Alert` (`role="status"` ou `alert` para erro) vem antes do formulário; com JS pode receber `tabIndex={-1}` e foco. Ao abrir `?confirmar=`, o bloco de confirmação traz `id` e a URL leva `#confirmar` para o navegador posicionar a leitura.

## 7. Interação e movimento
Sem animação própria; `details` nativo; `transition` de `Button` (150 ms) já respeita `prefers-reduced-motion`. Sem JS: filtros (GET), paginação (links), tentativas (GET), reenvio (GET → POST → PRG), `details` (nativo). Com JS nada é obrigatório; nenhuma melhoria necessária nesta demanda.

## 8. Arquivos afetados
`src/config/navegacao.ts` (`ROTAS_ADMIN_EXISTENTES`, `ROTAS.devAdminMensagens`) e `navegacao-admin.test.ts`; `src/app/admin/mensagens/{page.tsx,acoes.ts}` e `_componentes/*` (+ `Mensagens.module.css`); `src/app/admin/auditoria/{page.tsx}` e `_componentes/*`; `src/app/admin/saloes/[id]/assinatura/page.tsx` e `_componentes/*`; `src/app/admin/_componentes/{FiltrosGet,AntesDepois,SeloDeEstado}.tsx` + CSS (mover `SeloDeEstado` e ajustar `Saloes.module.css`/`Saloes.test.tsx`); `src/app/admin/saloes/_componentes/{CabecalhoDoSalao,PainelDoSalao}.tsx` (links "Assinatura e eventos" e "Auditoria deste salão"); `src/components/ui/DataList*` (célula de selo e, se preciso, linha de detalhe); `src/app/dev/admin-mensagens/page.tsx`; `e2e/admin-mensagens.spec.ts`, `e2e/admin-mensagens-sem-js.spec.ts`; `src/app/globals.test.ts` (só roda).

## 9. Critérios de revisão visual
1. Nenhum literal de cor fora do `:root`; nenhum token novo (`globals.test.ts` passa).
2. 375×812: sem rolagem horizontal da página nas três telas, incluindo payload/antes/depois de 16 KB e e-mail de ator longo.
3. 768 e 1280: nenhum selo em duas linhas (altura do selo ≤ 1 linha) em `/admin/saloes`, assinatura, mensagens e auditoria.
4. Um `h1` por página, `DataList` com `<caption>` nomeada, `h2` por seção; `aria-current="page"` no menu.
5. Cada selo = ícone `aria-hidden` + texto; rejeitado/erro/falhou distinguem-se por forma e texto.
6. HTML das telas de mensagens não contém E.164 completo nem 9 dígitos de celular em texto, atributo ou `title`.
7. Reenvio só em `falhou`; "Reenviar" abre `?confirmar=`; confirmação mostra tipo, salão, telefone mascarado, o aviso de §4.3 e os botões "Confirmar reenvio" e "Cancelar"; resultado por PRG com os textos de §4.3.
8. Antes/depois mostram diff por campo, com "Antes"/"Depois" em texto; JSON completo recolhido.
9. Datas pelo `format.ts`; globais com deslocamento `(UTC-03:00)`; assinatura no fuso do salão, informado na tela.
10. Filtros: estado visível na linha de contagem, "Limpar filtros" aparece só com filtro, valores preservados na paginação.
11. Foco visível em todo controle e `summary`; alvo ≥ `--alvo-minimo`; ordem de tabulação conforme §5.2/§5.3.
12. Sem JS completa todos os fluxos; axe 4.14.0 zero violações em 375×812 nos estados: lista, vazio, filtros inválidos, confirmação, cada `?reenvio=`, tentativas, assinatura (com e sem dados), auditoria com `details` aberto.

## 10. Conflitos e alternativas
- `DataList` não tem linha de detalhe em largura total (`colSpan`): se o arquiteto não alterar a `DataList`, usar `AntesDepois` dentro da célula "Ação" (fallback já descrito). 
- A confirmação em duas etapas via GET `?confirmar=<id>` mostra telefone mascarado na página: ok pela RN-2 (máscara no servidor).
- `Select` de salão cresce com a base: Select até 100 salões; acima, campo de código (decisão do arquiteto, ver dúvidas).
- Rótulos curtos de estado do admin (§3) divergem das frases longas da D-043: intencional (lista densa); a frase longa aparece no detalhe de tentativas.

## 11. Dúvidas
Não bloqueantes: (a) Select de salão com até 100 itens (suposição); (b) rótulos curtos dos estados de §3 (suposição, textos fechados); (c) `Resultado` da auditoria usa o enum existente; se houver mais valores além de sucesso/falha, o desenvolvedor mapeia forma/variante pela mesma tabela; (d) reenvio sem campo de motivo.
