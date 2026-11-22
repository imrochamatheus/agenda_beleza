# D-043 (E7.3) Situação de envio das mensagens: web-design

Fonte: `spec.md` (RN-1..14, CA-1..15). Autor: web-designer. Não altera código.

## 0. Evidências e limites
- Lido: `src/app/painel/agenda/reservas/[id]/page.tsx`, `_componentes/{DetalheDaReserva,GradeDoDia,ListaDaSemana,Eventos}.tsx`, `_componentes/Agenda.module.css`, `:root` de `globals.css` (linhas 14-72), `docs/demandas/D-042/web-design.md`.
- Capturas 375/768/1280: NÃO feitas (diagnóstico pelo código; a porta 3000 é do usuário). O desenvolvedor captura `/dev/agenda` (marca) e a vitrine nova do bloco em 375/768/1280 na revisão.

## 1. Diagnóstico
1. `DetalheDaReserva.tsx:12` declara "sem mensagens"; não há seção de mensagens. A equipe não vê se o WhatsApp saiu.
2. Blocos da grade do dia (`Agenda.module.css` `.evento`) têm altura fixa `0,1 rem/min` (`GradeDoDia.tsx:15`): 15 min = 1,5 rem, uma linha, `overflow: hidden`. Qualquer texto novo visível no bloco seria cortado ou mudaria a altura. A marca precisa ser sobreposta, de tamanho fixo e fora do fluxo do texto.
3. O significado do bloco já usa cor (info/sucesso/erro) mais texto de status; a falha não pode ser mais uma cor: seria confundida com `nao_compareceu` (`--cor-erro-*`). Precisa de FORMA própria (triângulo com "!") e texto.
4. Não existe utilitário de texto só para leitor de tela no projeto (grep em `src`): criar um `.somenteLeitor` local no CSS Module da agenda (sem cor, sem token novo).
5. `ListaDaSemana` mostra a reserva numa linha de texto corrido em `.item`; ali cabe texto visível curto.

## 2. Direção visual
Bloco do detalhe como o "extrato" da D-042: uma seção `h2` "Mensagens de WhatsApp" depois de "Serviços", lista cronológica SEM cartões: cada mensagem é um `<li>` separado só por filete `--cor-borda-sutil`; o estado é a frase (texto); só a falha ganha destaque (fundo `--cor-erro-fundo`, texto `--cor-erro-texto`, prefixo de forma "⚠" em SVG, `role` não de alerta pois é leitura estática). Enviada em `--cor-sucesso-texto`, demais neutros. Na grade, uma etiqueta triangular de 1,125 rem no canto superior direito do bloco (sobreposta, não altera o tamanho) e, na lista da semana, a mesma forma mais o texto visível "Falha ao enviar mensagem".
Descartadas: ponto vermelho (só cor); faixa lateral colorida no bloco (cor como único sinal e mexe na largura); texto visível "Falha..." dentro do bloco da grade (corta a 15 min a 375 px); tabela (rótulos longos estouram 375 px).

## 3. Sistema
Tokens novos: NENHUM. Pares (razão WCAG, valores do :root):
| Uso | Par | Razão |
|---|---|---|
| Texto da falha | `--cor-erro-texto` #842a1b / `--cor-erro-fundo` #f6e2da | 7,22 |
| Marca da grade (fundo do triângulo) | `--cor-erro-texto` sobre bloco `confirmado` (`--cor-info-fundo`), `concluido`, `nao_compareceu` (`--cor-erro-fundo`), `cancelado` (`--cor-superficie`) | ≥ 6,2 (não-texto exige 3) |
| "!" dentro do triângulo | `--cor-sobre-perigo` #fffaf5 / `--cor-erro-texto` | 9,5 |
| Enviada | `--cor-sucesso-texto` / `--cor-superficie` | 9,24 |
| Neutros (aguardando, não enviada, substituída), data e motivo | `--cor-texto` ou `--cor-texto-suave` / `--cor-superficie` | 15,47 / 7,22 |
Tipografia: `h2` Fraunces `--texto-xl` (padrão global). Frase da mensagem `--texto-base`, peso 600 só para o rótulo; data/tentativas/motivo `--texto-sm` `--cor-texto-suave`. Espaços `--espaco-2` dentro do item, `--espaco-4` entre seções; raio `--raio`; sem sombra.

## 4. Componentes
Reaproveita: `DataList`/`EmptyState` NÃO (lista simples basta); `Agenda.module.css` (`.lista`, `.etiqueta`).
1. `SituacaoMensagens` (`src/components/agenda/SituacaoMensagens.tsx`, server-safe, sem JS): `<section aria-labelledby="reserva-mensagens"><h2 id="reserva-mensagens">Mensagens de WhatsApp</h2><ul>`; cada `<li>` com: linha 1 rótulo (RN-8) em `<strong>`; linha 2 (`<p>` pequeno) "Última tentativa: {formatarDataHora}" quando há data, " · {N} tentativas" se N ≥ 2; linha 3 motivo quando houver. Variantes por estado: `falhou` (fundo `--cor-erro-fundo`, `--raio`, padding `--espaco-3`, ícone triângulo SVG `aria-hidden` antes do rótulo; o texto "Falha ao enviar…" é o sinal); `enviada` (rótulo em `--cor-sucesso-texto`); `pendente`/`enviando` (neutro; sem spinner animado); `nao_enviada`/`cancelada_anonimizacao`/`substituida` (neutro, rótulo em `--cor-texto-suave` + motivo). Sem estados interativos (não há link, botão nem foco próprio); lista não focável. Vazio: `<p>` "Nenhuma mensagem de WhatsApp para esta reserva." (RN-10) sob o `h2`.
2. `MarcaDeFalha` (em `Eventos.tsx`, exportada): `<span class="marcaFalha"><svg aria-hidden="true" focusable="false" …/><span class="somenteLeitor">Falha ao enviar mensagem</span></span>`. Na grade do dia: posicionada `position:absolute; top:0.125rem; right:0.125rem; width:1.125rem; height:1.125rem`, triângulo SVG `fill: var(--cor-erro-texto)` com "!" `fill: var(--cor-sobre-perigo)`; o `.evento` com falha ganha `padding-right: 1.5rem` (o `height` fixo e `box-sizing: border-box` ficam: o tamanho do bloco NÃO muda). Na lista da semana: a mesma forma inline antes do texto, mais o texto visível "Falha ao enviar mensagem" (`--texto-sm`, `--cor-erro-texto`, peso 600) em nova linha dentro do `<a>`. Em `GradeDoDia`/`EventoDeReserva` o texto acessível vem primeiro no conteúdo do link ("Falha ao enviar mensagem. 09:00 a 10:00 …") para o leitor anunciar antes do horário; fica DENTRO do `<a>`, sem novo item tabulável.
3. `.somenteLeitor` (novo, `Agenda.module.css`): `position:absolute; width:1px; height:1px; overflow:hidden; clip-path: inset(50%); white-space:nowrap;` (sem cor literal).

## 5. Telas
Detalhe `/painel/agenda/reservas/[id]` (ordem): h1 Reserva; link Voltar; dl; Serviços/Total; **Mensagens de WhatsApp**; ações (remarcar/cancelar/marcar). Mensagens ficam ANTES das ações e nunca as desabilitam (RN-2); a falha não altera nenhum botão.
Celular 375: coluna única; item: `Confirmação enviada` / `Última tentativa: 22/11/2026 14:32`. Desktop ≥ 48rem: mesma coluna, `.pagina` mantém largura da agenda; data e motivo na mesma linha quando couberem (`flex-wrap`).
Exemplos (texto exato): 
- "Confirmação enviada" · "Última tentativa: 22/11/2026 14:32"
- "Falha ao enviar confirmação por WhatsApp" · "Última tentativa: 22/11/2026 14:35 · 3 tentativas" · "Não foi possível confirmar se a mensagem foi entregue."
- "Remarcação 1 aguardando envio"; "Remarcação 2 sendo enviada"
- "Confirmação substituída por remarcação posterior"; "Remarcação 1 não enviada: a reserva mudou antes do envio"
- "Confirmação não enviada" · "A cliente não autorizou receber mensagens."
- "Cancelamento não enviada"? NÃO: concordância: usar a forma de gênero do tipo, resolvida no módulo de rótulos (Confirmação/Remarcação/Cancelamento: feminino "enviada" exceto Cancelamento e convite: masculino "enviado/não enviado/substituído"). Testes percorrem tipo × estado (CA-4). A spec escreve "{Tipo} enviada"; o designer recomenda concordar em gênero para Cancelamento ("Cancelamento enviado") e Convite ("não enviado", "substituído"); fora disso mantém a spec. (Ver §10.)
- "Convite de avaliação enviado"; "Falha ao enviar convite de avaliação por WhatsApp" · "Link de avaliação indisponível."
- "Confirmação não enviada" · "Cliente removida; a mensagem foi cancelada."
Grade dia 375: blocos inalterados em posição e altura; o triângulo vermelho de 1,125 rem no canto superior direito dos blocos com falha vigente; o texto do bloco quebra com `padding-right` maior. Semana 375: item da lista com a linha de texto atual e, abaixo, "▲ Falha ao enviar mensagem" (SVG + texto). Nenhuma barra de rolagem horizontal.

## 6. Estados
Vazio, enviada, aguardando/enviando, falha (data e motivo), não enviada (motivo), substituída: ver §5. Carregamento: n/a (server, `force-dynamic`). Erro de leitura: 404 via `NaoEncontrado` (já existente). Sucesso: não há ação. Foco: os blocos da grade são links com `a.evento:focus-visible` existente (contorno 3px `--cor-foco`, offset 2px); a marca fica dentro do link e não cobre o contorno (`z-index` menor que o do foco, 3).

## 7. Interação e movimento
Nenhuma transição ou animação (spinner proibido para `enviando`: a informação é o texto). Sem JS: tudo é HTML renderizado no servidor. `prefers-reduced-motion` irrelevante por não haver movimento.

## 8. Arquivos afetados
`src/components/agenda/SituacaoMensagens.tsx` (+ `.module.css` e `.test.tsx` com `@vitest-environment jsdom`), `src/server/mensagens/rotulos.ts` (client-safe; rótulos tipo × estado), `src/app/painel/agenda/_componentes/{Eventos.tsx,GradeDoDia.tsx,ListaDaSemana.tsx,DetalheDaReserva.tsx,Agenda.module.css}` (+ testes), `src/app/painel/agenda/reservas/[id]/page.tsx`, `src/app/dev/agenda/**` (adicionar reserva com `temFalhaDeMensagem`) e uma vitrine `/dev/mensagens-reserva` (opcional) com todos os tipos × estados; `e2e/` com axe 375×812.

## 9. Critérios de revisão visual
1. Nenhum literal de cor fora do `:root`; nenhum token novo; um só `@media (min-width: 48rem)`.
2. Altura e posição de todo `.evento` idênticas com e sem falha (comparar `getBoundingClientRect` em 375 px).
3. A marca tem ≥ 1,125 rem, forma triangular, contraste ≥ 3:1 contra os 4 fundos de status; texto acessível "Falha ao enviar mensagem" presente no nome acessível do link; sem novo item na ordem de tabulação.
4. Cada estado é distinguível sem cor (texto do rótulo); falha com SVG `aria-hidden` mais texto.
5. Sem rolagem horizontal da página em 375 px na grade do dia, na semana e no detalhe (rótulos longos quebram com `overflow-wrap: anywhere`).
6. Nenhum telefone, parâmetro, link, id do provedor, `erro_detalhe` nem `erroCodigo` bruto no HTML (sentinelas).
7. Datas só via `formatarDataHora` com o fuso do salão; `TZ=UTC` e `America/Sao_Paulo` iguais.
8. `h2` "Mensagens de WhatsApp" único, após "Serviços" e antes das ações; um só `h1`; axe 4.14.0 sem violações a 375×812.
9. Os botões de ação do detalhe não mudam com `falhou` (CA-7).

## 10. Conflitos e alternativas
- Gênero dos rótulos: a spec RN-8 usa "{Tipo} enviada", o que gera "Cancelamento enviada" (erro de concordância). Proposta: concordar (Cancelamento/Convite masculino). Pedir ao arquiteto/analista que ajuste RN-8 e CA-4. Alternativa neutra: "Mensagem de {tipo}: enviada".
- A marca na grade usa SVG inline (sem imagens externas) e `.somenteLeitor` novo em CSS Module (sem token).
- `confirmado` e `cancelado`: o texto do bloco `cancelado` é riscado; a marca NÃO deve herdar `line-through` (`text-decoration: none` na marca).

## 11. Dúvidas
Não bloqueantes: ordem das mensagens crescente (RN-6, adotado). Sem dúvidas bloqueantes.
