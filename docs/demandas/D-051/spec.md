# D-051 — Dia e horário na mesma página (fluxo público de reserva)

Issue: #113 (chave E4.1b). Autor: analista-requisitos. Data: 23/11/2026.
Base: `main` com a D-050 mesclada (PR #112). Dependências funcionais: E4.1/D-026 e E3.6/D-050.

## 1. Problema

Hoje, depois de escolher os serviços, a cliente passa por uma página só para escolher o dia, e só então chega à página de horários.

- `src/server/reserva-publica/passos.ts:151-157`: sem `data` válida, `lerPasso` devolve o passo `data` (lista de dias a partir de `de`).
- `src/server/reserva-publica/passos.ts:24`: `DIAS_POR_PAGINA = 14`.
- `src/server/reserva-publica/pagina.ts:200-222`: o passo `data` faz uma consulta `consultarDisponibilidadePorServico` para até 14 datas e marca `temHorarios` pela regra DA-2 da D-050 (o dia é oferecido se CADA serviço tem ao menos um horário nele).
- `src/app/(publico)/[slug]/_componentes/Passos.tsx:190-225` (`PassoData`): `h2` "Escolha o dia" e uma lista vertical (`ul.dias`), com um link por dia ("Terça-feira, 25/11/2026") ou o texto "(sem horários)", mais os links "Dias anteriores", "Próximos dias" e "Alterar serviços".
- Escolher um dia (`montarHref(base, { s, data })`) leva a outra página: o passo do serviço 0 (`Passos.tsx:262-317`, `PassoServico`), com a grade por profissional e os links "Escolher outro dia" e "Alterar serviços".
- `hrefOutroDia` (`passos.ts:243-244`) volta ao passo `data` com `de = data`.

Para trocar de dia depois de ver os horários, a cliente precisa voltar à lista e abrir outra página. Isso custa duas navegações por tentativa.

## 2. Objetivo

A cliente escolhe o dia e o horário do 1º serviço na mesma página. Uma faixa horizontal mostra 7 dias (dia da semana + data), e a cliente navega entre as semanas. Ao escolher um dia, os horários do 1º serviço aparecem logo abaixo, na mesma página. O resto do fluxo não muda.

## 3. Escopo

### Entra
- Fundir o passo `data` ao passo do 1º serviço (índice 0): faixa de 7 dias, navegação de semanas e, abaixo, a seção de horários do serviço 0.
- O passo `data` isolado deixa de existir. URLs antigas continuam válidas (RN-12).
- Página de dias com 7 dias, alinhada a "hoje" (a semana é de 7 dias corridos a partir de hoje, não a semana do calendário).
- "Escolher outro dia" (passos k ≥ 1 e reescolha) leva à página combinada.
- Vitrine `/dev/reserva` (dados de demonstração e vistas novas) e os testes unitários, de integração e E2E afetados.

### Fica fora
- Os passos dos serviços 2..N continuam iguais à D-050 (sem faixa de dias, com "Escolher outro dia"). É decisão do usuário.
- Passo de dados, confirmação, reescolha (D-036/D-050 CA-10), Turnstile e limite de números futuros: sem mudança de comportamento.
- Agendamento pela equipe (`/painel/agenda/nova`).
- Esquema, migrações, variáveis de ambiente, compose e CI.
- Seletor de calendário mensal, `input type="date"` e escolha de horário sem recarregar (a página não pode depender de JavaScript).
- Pular sozinho para a primeira semana que tem horário (RN-9).

Confronto com "Fora da primeira versão" do `PLAN.md` (linha 148): nada desta demanda toca os itens excluídos. A ordem do fluxo do `PLAN.md` linha 41 ("escolhe o dia; depois, para cada serviço, … o profissional e o horário") continua valendo, porque o dia ainda é escolhido antes dos horários e agora fica na mesma tela do 1º serviço.

## 4. Regras de negócio

Origem: **[D]** pedido do usuário na issue #113, **[U]** decisão do usuário registrada na transferência, **[P]** `PLAN.md`/`CLAUDE.md`, **[A]** decisão desta análise (ver §9).

- **RN-1 [D][U]** Depois de escolher os serviços, a próxima tela é o passo do 1º serviço (índice 0). Ela tem, nesta ordem lógica: o indicador "Serviço 1 de N", o título com o nome do serviço, o resumo dos serviços escolhidos com o total (o `ResumoDaSelecao` que hoje está no passo `data`), a faixa de dias com a navegação de semanas e a seção de horários. O layout fino é do web-designer.
- **RN-2 [D][U]** A faixa mostra os dias de UMA semana, em ordem crescente e da esquerda para a direita. Cada dia exibe o dia da semana e a data. O dia da semana segue `formatarDiaDaSemana`. O web-designer pode usar uma forma curta, como "Ter" e "01/12", mas o nome acessível de cada dia é o rótulo completo de `rotuloDoDia` ("Terça-feira, 01/12/2026"). Toda data e todo dia da semana são formatados por `src/lib/format.ts`.
- **RN-3 [U][A]** Semanas alinhadas a hoje. Sejam `hoje` o dia civil no fuso do salão e `ultima = hoje + janelaDias`. A semana k (k ≥ 0) vai de `hoje + 7k` a `min(hoje + 7k + 6, ultima)`. A última semana pode ter menos de 7 dias. Dias fora de [hoje, ultima] não aparecem na faixa.
- **RN-4 [P][A]** Um dia fica disponível (link) se, e só se, CADA serviço escolhido tem ao menos um horário livre nele (DA-2 da D-050, a mesma regra de hoje). Essa marcação não considera os itens já escolhidos. Um dia sem horário aparece na faixa, mas não é link nem fica no Tab, e o nome acessível dele indica "sem horários". O texto de apoio `MENSAGENS_PASSO.diaComHorarios` continua perto da faixa.
- **RN-5 [D][U]** "Semana anterior" leva à semana k−1 e "Próxima semana" à semana k+1. Na semana 0 não há link "Semana anterior", e na semana que contém `ultima` não há link "Próxima semana". Os dois ou somem ou aparecem como texto não interativo (escolha do web-designer), mas nunca como link.
- **RN-6 [A]** Qual semana aparece:
  - Com `data` válida, aparece a semana que contém `data`, e `de` é ignorado.
  - Sem `data` válida, aparece a semana que contém `de`, com `de` limitado a [hoje, ultima] como hoje. Um `de` desalinhado (links antigos, `hrefOutroDia`) vai para a semana que o contém.
  - Sem `de` válido, aparece a semana 0.
- **RN-7 [D][A]** Nenhum dia vem pré-selecionado. Sem `data`, a seção de horários mostra um estado vazio que pede para escolher um dia, sem grade, sem filtro de profissional e sem o botão "Continuar". Também não aparece o roteiro "Seu dia", que depende de uma data.
- **RN-8 [D]** Com `data` válida, o dia correspondente fica marcado com `aria-current="date"`, e o destaque não pode depender só da cor. Abaixo da faixa, na mesma página, aparece a seção de horários do serviço 0 nesse dia, com o mesmo conteúdo e as mesmas regras do passo do serviço 0 da D-050: roteiro "Seu dia", filtro `f` com 2+ profissionais, `GradesPorProfissional` com `name="h0"`, pré-seleção de "Alterar", estados vazios por calendário ou conflito, avisos e botão "Continuar"/"Continuar para seus dados". Se a `data` está na janela mas o dia não é oferecido (RN-4), por exemplo num link antigo ou com a vaga esgotada, o dia continua marcado e a seção segue as mesmas regras da D-050. Normalmente isso mostra "Nenhum horário para {serviço} neste dia.".
- **RN-9 [A]** Nenhum salto automático de semana. Se nenhum dia da semana exibida tem horário, a página mostra a faixa (todos os dias desabilitados), a navegação de semanas e um texto de estado vazio dizendo que não há dias com horário nesta semana e que a cliente pode ver a próxima. A página não faz consultas extras para achar uma semana com horário.
- **RN-10 [D][A]** Cada link de dia leva a `s` + `data` (e a `de` da semana, opcional pela RN-6), sem `h*`, `f`, `alterar`, `enviado` e `aviso`. Trocar o dia descarta TODOS os horários escolhidos, inclusive quando a cliente veio de "Alterar" do item 0, porque todos os itens precisam cair na mesma data. Cada link de semana leva a `s` + `de` (início da semana de destino), sem `data`, `h*`, `f`, `alterar`, `enviado` e `aviso`. Navegar de semana desmarca o dia escolhido e volta ao estado da RN-7.
- **RN-11 [A]** Os links de dia e de semana terminam num fragmento que posiciona a página na seção da reserva (por exemplo `#reservar`, nome final do arquiteto). Assim, depois do recarregamento sem JavaScript, a cliente vê a faixa e os horários sem rolar desde o topo, que tem perfil e fotos. O fragmento não muda o estado: ele não vai para o servidor.
- **RN-12 [A]** Compatibilidade de URLs. Toda URL válida antes da D-051 continua válida e cai no passo equivalente:

  | URL | Antes (D-050) | Depois (D-051) |
  |---|---|---|
  | `?s=…` | passo `data`, a partir de hoje | passo do serviço 0, semana 0, sem dia |
  | `?s=…&de=X` | passo `data` a partir de X | passo do serviço 0, semana que contém X, sem dia |
  | `?s=…&data=D` | passo do serviço 0 em D | passo do serviço 0, semana de D, D marcado |
  | `?s=…&data=D&de=X` | passo do serviço 0 em D | igual à linha anterior (`de` ignorado) |
  | `?s=…&data=D&h0=…` (e outros `h`) | passo do 1º `h` ausente ou dados | igual (sem mudança) |
  | `?s=…&data=D&…&alterar=0` | passo do serviço 0 com pré-seleção | passo do serviço 0 com faixa (semana de D, D marcado) e pré-seleção |
  | `?s=…&data=D&…&alterar=k` (k ≥ 1) | passo k | igual (sem faixa) |
  | `?s=…&data` fora da janela ou inválida | passo `data` com `de` | passo do serviço 0 sem dia (semana pela RN-6) |

  Nenhuma URL vira 404 ou 500 por causa desta mudança. Parâmetros inválidos continuam degradando para o passo válido mais avançado (`passos.ts:1-3`).
- **RN-13 [A]** "Alterar" do item 0 (no passo de dados ou no roteiro de um passo k ≥ 1) leva, como hoje, a `hrefAlterarItem(…, 0)`. A página mostra a faixa (semana de `data`, dia marcado), a seção do serviço 0 com o item atual pré-selecionado (se ainda for oferecido) e os demais itens no roteiro com "Alterar". Escolher outro horário e "Continuar" funciona como na D-050. Clicar em outro dia ou mudar de semana descarta todos os itens (RN-10).
- **RN-14 [U]** Nos passos k ≥ 1, "Escolher outro dia" continua com o mesmo texto e leva à página combinada: `s` + `de = data`. Pela RN-6, a página mostra a semana que contém a data anterior, sem dia marcado. O mesmo vale para "Escolher outro dia" da reescolha (`FormularioDados.tsx:113`). No passo do serviço 0 o link "Escolher outro dia" sai, porque a faixa cumpre o papel dele. "Alterar serviços" fica em todos os passos.
- **RN-15 [A]** Avisos (`aviso`, lista fechada `CODIGOS_AVISO`) no passo do serviço 0 aparecem no topo da área do passo, antes da faixa, com ou sem dia marcado:
  - `sem_selecao` (`enviado=0` sem `h0`): "Escolha um horário para {serviço}.", com o dia mantido.
  - `horario_indisponivel`/`profissional_indisponivel` vindos do POST (redirecionamento de `destinoDoRedirecionamento` com `data`): o texto da D-050, com o dia marcado. Sem `data` (seleção adulterada, `formulario.ts:105`), o texto genérico de `MENSAGENS_AVISO`, sem dia.
  - `servico_indisponivel` continua levando ao passo de serviços (sem mudança).

  O tratamento de `PaginaDoSalao.tsx:71-72` (o passo com aviso de horário ou profissional vira a alternativa do `FormularioDados`) continua valendo para o passo do serviço 0 com faixa.
- **RN-16 [P]** Limite e custo. Cada carregamento do passo do serviço 0 (com ou sem dia, inclusive a navegação de semanas) consome exatamente UMA cota `limitarPorIp(ip, 'disponibilidade')`, antes de qualquer cálculo. Com o limite excedido, a página mostra o aviso `limitado` sem faixa e sem horários, e nada é calculado (D-027 CA-14). O número de chamadas a `consultarDisponibilidadePorServico` por carregamento é constante: no máximo 2, e portanto no máximo 12 instruções SQL de disponibilidade. Esse número não depende da quantidade de dias, serviços, profissionais ou itens escolhidos. O período de cálculo nunca passa de 7 datas. Horários e dias só saem de `consultarDisponibilidadePorServico`/`horarioOferecido`, sem uma segunda implementação da regra (D-018/D-050).
- **RN-17 [P]** Funciona sem JavaScript: a faixa e a navegação são links GET, e a escolha do horário continua no formulário GET do passo. Por teclado, a ordem de Tab segue a ordem visual (faixa → navegação de semanas → filtro → grades → Continuar → links). A página é responsiva, com um ponto de quebra único (`48rem`), cores só por tokens, foco visível e alvo mínimo `--alvo-minimo` em cada dia.
- **RN-18 [P]** Em 375×812, a página não tem rolagem horizontal. Se os 7 dias não couberem, a faixa rola por dentro do componente, sem cortar nenhum dia de forma inalcançável. Os 7 dias são alcançáveis por teclado, e o dia em foco fica visível.
- **RN-19 [P]** O estado continua inteiro na query GET, sem dado pessoal. Nenhum parâmetro novo é obrigatório. Se o arquiteto criar algum, ele precisa ser opcional e validado de forma defensiva como os demais.
- **RN-20 [P]** Fuso: "hoje", as semanas e os dias são dias civis no fuso do salão (`lerRegrasDaPagina`/`limitesDaJanela`). O dia da semana sai de `diaDaSemana` (domínio), nunca de métodos locais de `Date`. O resultado não depende do fuso do processo.

## 5. Critérios de aceitação

Formato Dado/Quando/Então. "Passo 0" é o passo do 1º serviço com a faixa. A coluna final relaciona cada CA à issue e ao `PLAN.md`.

- **CA-1** (issue CA-1; PLAN critério 2) Dado um salão com serviços ofertáveis, quando a cliente marca um ou mais serviços e envia "Continuar", então a página seguinte tem o indicador "Serviço 1 de N", um `h2` com o nome do 1º serviço, o resumo dos serviços com o total e uma faixa com os dias da semana 0 (de hoje a hoje+6, cortada na janela). Cada dia mostra o dia da semana e a data, e o nome acessível de cada um é o rótulo completo (por exemplo "Terça-feira, 01/12/2026"). Não existe mais o `h2` "Escolha o dia" nem a lista vertical de 14 dias.
- **CA-2** (issue CA-1) Dado um dia da semana exibida em que algum serviço escolhido não tem horário, então esse dia não é link nem recebe foco por Tab, e o nome acessível dele contém "sem horários". Dado um dia em que todos os serviços têm horário, então ele é um link.
- **CA-3** (issue CA-2) Dada a semana 0, então não há link "Semana anterior", e "Próxima semana" leva à semana que começa em hoje+7, sem `data` nem `h*`. Dada a semana que contém `hoje + janelaDias`, então não há link "Próxima semana", e a faixa termina em `hoje + janelaDias`. Com janela de 60 dias, a 9ª semana tem 5 dias. Dada uma semana k intermediária, "Semana anterior" leva a `hoje + 7(k−1)`.
- **CA-4** (issue CA-4) Dado o passo 0 sem `data`, então a seção de horários mostra um estado vazio pedindo para escolher um dia, e não há grade, filtro de profissional, botão "Continuar" nem roteiro "Seu dia". Nenhum dia tem `aria-current`.
- **CA-5** (issue CA-3) Dado o passo 0, quando a cliente ativa um dia disponível, então a página recarrega no próprio passo 0 (mesmo indicador e mesmo `h2`), o dia fica com `aria-current="date"` e um destaque que não depende só da cor, e abaixo da faixa aparecem os horários do 1º serviço nesse dia, agrupados por profissional (mesmos grupos, textos e regras do passo do serviço da D-050, incluindo "Sem horários livres neste dia." e o filtro com 2+ profissionais). A URL de destino tem `s`, `data` e o fragmento da RN-11, sem `h*`.
- **CA-6** (issue CA-3/CA-5) Dado o passo 0 com dia escolhido, quando a cliente escolhe um horário e envia "Continuar", então segue para o passo do serviço 2 (N ≥ 2) ou para "Seus dados" (N = 1), exatamente como na D-050. Os passos dos serviços 2..N não têm faixa de dias e mantêm os links "Escolher outro dia" e "Alterar serviços".
- **CA-7** (issue CA-5) Dado o passo 0 com dia D marcado e um horário de D já escolhido (por exemplo vindo de "Alterar" do item 0 com outros itens na URL), quando a cliente ativa outro dia D', então a URL de destino não tem nenhum `h*`, nem `alterar`, `f`, `enviado` e `aviso`, D' fica marcado e nenhum horário vem pré-selecionado. Quando, em vez disso, a cliente usa "Próxima semana" ou "Semana anterior", então a URL não tem `data` nem `h*`, e a página fica no estado do CA-4.
- **CA-8** (RN-12) Para cada linha da tabela da RN-12, abrir a URL antiga devolve HTTP 200 e o passo indicado na coluna "Depois". `?s=…&de=X`, com X no meio da semana k, mostra a semana k inteira, e não a semana que começa em X. Nenhuma URL da tabela devolve 404 ou 500.
- **CA-9** (RN-13) Dado o passo de dados com 2+ itens, quando a cliente usa "Alterar" do item do 1º serviço, então a página mostra o passo 0 com a faixa na semana de `data`, o dia marcado, o horário atual pré-selecionado (se ainda for oferecido) e os demais itens no roteiro "Seu dia" com "Alterar". Quando ela escolhe outro horário no mesmo dia e envia, os demais itens continuam escolhidos, como na D-050.
- **CA-10** (RN-14) Dado o passo do serviço k ≥ 1 (ou a reescolha) na data D, quando a cliente usa "Escolher outro dia", então chega ao passo 0 sem dia marcado, na semana que contém D, sem `h*`.
- **CA-11** (RN-15) Dado o passo 0 com dia D e sem horário marcado, quando a cliente envia "Continuar", então volta ao passo 0 com D marcado e o aviso "Escolha um horário para {serviço}." antes da faixa. Dado um POST de dados cujo item 0 deixou de ser oferecido, então a página volta ao passo 0 com D marcado e o aviso de horário perdido da D-050. Sem JavaScript, o comportamento da alternativa do `FormularioDados` é o mesmo da D-050 (D-036 DEF-1).
- **CA-12** (RN-9) Dada uma semana sem nenhum dia oferecido, então a faixa mostra todos os dias desabilitados, um texto de estado vazio (sem grade) e o link "Próxima semana" (se houver). O número de consultas é o mesmo de uma semana com horários (CA-14).
- **CA-13** (issue CA-6; RN-17, RN-18) O fluxo serviços → dia → horário do 1º serviço → demais serviços → dados → confirmação se completa:
  - (a) com o JavaScript desligado;
  - (b) só por teclado, com foco visível em cada dia, em cada link de semana e em cada horário;
  - (c) em viewport 375×812 (`isMobile`, `hasTouch`) sem rolagem horizontal da página (`scrollWidth <= clientWidth` do documento) e com os 7 dias alcançáveis;
  - (d) com o axe 4.14.0 sem violações no passo 0 sem dia, no passo 0 com dia e numa semana com dias desabilitados.
- **CA-14** (issue CA-7; RN-16) Dado o passo 0, então cada carregamento (sem dia, com dia, com `alterar=0` e itens, ou navegação de semana) consome exatamente uma cota `limitarPorIp(ip, 'disponibilidade')`. O número de instruções SQL de disponibilidade fica constante para 1, 3 e 10 serviços, para 1 e 8 profissionais e com ou sem itens escolhidos (no máximo 2 chamadas a `consultarDisponibilidadePorServico`, ou seja, no máximo 12 instruções). Com o limite excedido, a página mostra o aviso de limite, sem faixa e sem horários, e nenhuma consulta de disponibilidade é feita. A medição segue `tests/integration/reserva-publica/passos.test.ts`.
- **CA-15** (RN-20) Os testes unitários de derivação do passo, da semana e dos links (`src/server/reserva-publica`) passam com `TZ=UTC` e com `TZ=America/Sao_Paulo`. Para um salão em outro fuso (por exemplo `America/Manaus` ou `America/Noronha`), "hoje" e a semana 0 seguem o dia civil do salão perto da meia-noite.
- **CA-16** (RN-19) Nenhuma URL do fluxo carrega nome, telefone ou consentimento (varredura das URLs geradas nos testes de links e no E2E).
- **CA-17** Vitrine: `/dev/reserva` mostra, sem banco, o passo 0 sem dia, o passo 0 com dia marcado e uma semana com dias desabilitados. As vistas exatas ficam com o arquiteto. Fora do modo vitrine, a página continua 404.
- **CA-18** Regressão: os critérios da D-050 do fluxo público (passos por serviço, filtro, reescolha, confirmação, limite de 3 futuras, Turnstile, salão suspenso sem formulário, slug histórico 308) continuam passando, com testes adaptados só na navegação até o dia e nunca enfraquecidos.

## 6. Casos limite

| Caso | Comportamento esperado |
|---|---|
| Virada de dia entre carregar a página e clicar num dia (a `data` passou a ser < hoje) | `data` fora da janela: passo 0 sem dia, semana 0 (RN-6/RN-12). Sem erro. |
| Hoje sem horário (antecedência já passou) | Hoje aparece desabilitado na semana 0. |
| Janela curta (`janelaDias` = 1) | Semana 0 com 2 dias e nenhum link de semana. |
| Janela múltipla de 7 (`janelaDias` = 7) | A semana 0 tem 7 dias e a semana 1 tem 1 dia (`hoje + 7`). |
| `de` além de `ultima` ou antes de hoje | É limitado a [hoje, ultima] e cai na semana correspondente. |
| Mudança de horário de verão no fuso do salão | Dias civis não mudam. A grade segue a D-018 (hora inexistente some, repetida conta uma vez). |
| Salão em fuso diferente do processo | CA-15. |
| Concorrência: horário tomado entre ver a grade e enviar os dados | Reescolha da D-050 (CA-10), sem mudança. "Escolher outro dia" da reescolha segue a RN-14. |
| Dia marcado deixa de ter horário entre carregamentos | O dia continua marcado. A seção mostra o vazio por calendário ou por conflito (RN-8). |
| Isolamento entre salões: `s` ou `h0` com ids de outro salão | Como hoje: serviços inexistentes → passo de serviços com `servico_indisponivel`; item de profissional desconhecido conta como pendente. |
| Salão suspenso ou sem capacidade `agendar` | Sem formulário de reserva (D-038), sem faixa e sem consumo de cota. Sem mudança. |
| Limite de IP excedido | Aviso de limite, sem faixa (CA-14). |
| Serviço desativado depois da escolha | Passo de serviços com aviso (sem mudança). |
| Parâmetros repetidos ou malformados (`data` repetida, `de=abc`, `h0` inválido) | Degradam como hoje (`primeiro`/`unico`). Nunca 500. |
| `alterar=0` com `data` fora da janela | Passo 0 sem dia. Os `h*` são ignorados porque não há data. |
| Cliente anonimizada, telefone não brasileiro, perfis de equipe | Não se aplica: esta demanda só muda a navegação anterior ao passo de dados. A validação de telefone e o consentimento continuam no passo de dados, sem mudança. |
| Muitos profissionais (8+) no 1º serviço | Filtro `f` como na D-050. Trocar de dia remove `f` (RN-10). |

## 7. Dependências

- D-026 (E4.1): página pública, `lerPasso`, `montarHref`, slug histórico 308 (sem `loading.tsx`).
- D-050 (E3.6): `consultarDisponibilidadePorServico`, `horarioOferecido`, DA-2, `GradesPorProfissional`, `RoteiroDoDia`, `SlotGrid`, reescolha.
- D-027 (E4.2): `limitarPorIp(ip, 'disponibilidade')`.
- D-018: domínio de calendário (`datasDoPeriodo`, `diaDaSemana`, `limitesDaJanela`).
- Integrações (Mercado Pago, WhatsApp, e-mail, Turnstile, S3): nenhuma mudança. O Turnstile continua só no passo de dados.

## 8. Impactos prováveis

- **Dados**: nenhum. Sem migração, sem consulta nova e sem índice novo. O período consultado cai de 14 para no máximo 7 datas. O DBA pode ser dispensado.
- **Infra/CI**: nenhum. Sem env, sem compose, sem job novo. O DevOps pode ser dispensado.
- **Visual**: alto (faixa horizontal, estados selecionado/desabilitado/em foco, navegação de semanas, estado "escolha um dia", 375 px). Precisa do web-designer.
- **Código**:
  - `src/server/reserva-publica/{passos,pagina,tipos}.ts`: o passo `data` some do `PassoLido` e da `VisaoDoPasso`, a semana entra no passo do serviço 0 e entram os helpers de link de dia e de semana.
  - `src/app/(publico)/[slug]/_componentes/{Passos.tsx,PaginaDoSalao.tsx,Salao.module.css}`: `PassoData` sai e entra o componente da faixa.
  - `src/app/dev/reserva/dados.ts`.
  - Testes: `src/server/reserva-publica/passos.test.ts`, `PaginaDoSalao.test.tsx`, `tests/integration/reserva-publica/{passos,fluxo-itens,pagina}.test.ts`, `e2e/suporte/publico.ts` (`escolherDia` espera o `h2` "Escolha o dia", e `diaFuturo` usa dias até +13, que agora pedem a navegação de semana), `e2e/reserva-publica.spec.ts`, `e2e/publico-reserva-teclado.spec.ts`, `e2e/tester-d050.spec.ts` e demais `e2e/publico-*.spec.ts`.
- **Documentação**: parágrafo D-051 no `CLAUDE.md`, e o README só se ele descrever o passo `data`.

## 9. Dúvidas

### Bloqueantes
Nenhuma.

### Não bloqueantes (suposição adotada)
- **ND-1** Dia pré-selecionado ao abrir. Suposição: nenhum (RN-7). O pedido diz "ao clicar em um dia, são exibidos os horários", e a issue (CA-4) prevê o estado sem dia. Pré-selecionar o 1º dia disponível seria uma alternativa, e o custo de SQL seria o mesmo.
- **ND-2** Semana sem nenhum dia com horário. Suposição: sem salto automático, com estado vazio e "Próxima semana" (RN-9). O salto exigiria consultas extras (até a janela inteira) e quebraria o custo constante do CA-14.
- **ND-3** Alinhamento das semanas. Suposição: blocos fixos a partir de hoje (RN-3/RN-6), para que "Escolher outro dia" e os links antigos com `de` caiam numa semana estável que contém a data. A alternativa, uma semana começando exatamente em `de`, deixaria as semanas desalinhadas entre si.
- **ND-4** Navegar de semana com um dia marcado. Suposição: desmarca o dia (RN-10), para nunca mostrar horários de um dia que não está na faixa visível.
- **ND-5** Dias fora da janela na última semana. Suposição: não aparecem (RN-3), como na lista atual. O web-designer pode pedir marcadores visuais vazios, desde que não sejam links nem paradas de Tab.
- **ND-6** Dia marcado que não é oferecido (RN-4 falsa), por link antigo ou manual. Suposição: o dia continua marcado e a seção segue as regras da D-050. Se só outro serviço não tem horário, a grade do 1º serviço aparece, e o passo do serviço seguinte mostra o vazio por calendário com "Escolher outro dia". É o mesmo comportamento da D-050 para uma URL direta.
- **ND-7** Fragmento de âncora (RN-11). Suposição: incluir. Sem ele, no celular, cada clique recarrega no topo (perfil e fotos), e a cliente não vê "os horários abaixo". O nome do alvo fica com o arquiteto e o web-designer.
- **ND-8** Tamanho do `de` na URL depois da navegação. Suposição: `de` = início da semana de destino. O valor é só um dado de navegação e não é obrigatório.
