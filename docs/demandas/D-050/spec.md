# D-050 (E3.6, issue #111) — Agendar cada serviço com profissional e horário próprios

Autor: analista-requisitos. Data: 22/11/2026. Branch: `feat/d-050-servicos-independentes`.

Fontes: issue #111 (escopo, decisões do usuário e CA-1..CA-12 iniciais), `PLAN.md`, `CLAUDE.md` (parágrafos D-013,
D-016, D-018, D-022, D-024, D-025, D-026, D-027, D-028, D-029, D-030, D-031, D-032, D-036, D-038, D-043, D-045,
D-047), código e migrações citados abaixo.

---

## 1. Problema (comportamento atual, com evidência)

Hoje uma reserva com vários serviços é **um único atendimento sequencial com um único profissional**:

- **Esquema.** `reserva` tem um só `profissional_id`, `inicio`, `fim`, `ocupado_ate`, `status` e `encaixe`
  (`prisma/schema.prisma:466-501`). `reserva_item` só tem `servico_id`, `ordem`, `preco_centavos` e `duracao_min`
  (`prisma/schema.prisma:504-522`): o item não tem profissional, horário nem status.
- **Anti-sobreposição na reserva.** `reserva_sem_sobreposicao` é `EXCLUDE USING gist (profissional_id WITH =,
  tstzrange(inicio, ocupado_ate, '[)') WITH &&) WHERE (status IN ('confirmado','concluido','nao_compareceu'))` sobre a
  tabela `reserva` (`prisma/migrations/20261118000100_reserva_exclusion/migration.sql:32-38`).
- **Itens em sequência.** `montarItens` encadeia os itens a partir de `inicio`, na ordem dada; `fim` = fim do último;
  `ocupadoAte` = `fim + intervaloMin` (`src/server/reservas/montar-itens.ts:16-40`).
- **Disponibilidade exige profissional comum.** `candidatos` conta os vínculos do profissional com TODOS os serviços
  pedidos (`src/server/repos/disponibilidade.ts:128-144`); o domínio só oferece um início em que a duração total cabe
  num intervalo (CLAUDE.md, D-018).
- **Fluxo público com um profissional.** Os passos são `servicos → profissional (UUID ou 'qualquer') → data → horario →
  dados`, todos derivados da query `s`/`p`/`data`/`h` (`src/server/reserva-publica/passos.ts:72-97`).
- **PLAN.md** exige o modelo atual: linha 41 ("escolhe **um profissional**, entre os que executam todos os serviços
  escolhidos… executado em sequência") e critério de aceite 2 (linha 153).
- **Mensagens por reserva.** Chave única `(reserva_id, tipo, revisao)` (`prisma/schema.prisma:638`); `cancelamento`
  usa a revisão atual da reserva sem incrementá-la (`src/server/mensagens/registrar.ts:28-36`, CLAUDE.md D-030); a
  vigência compara a revisão e o status **da reserva** (`src/server/mensagens/elegibilidade.ts:45-58`); os parâmetros
  têm um só `profissional`, uma `data` e um `horario` (`src/server/mensagens/parametros.ts:9-34`; textos em
  `docs/whatsapp-templates.md`).
- **Limite de 3 futuras** conta linhas de `reserva` com `status = 'confirmado' AND inicio > agora`
  (`src/server/repos/reserva.ts:173-182`).
- **Status e operações por reserva.** A máquina de status (`src/server/reservas/status.ts`) e remarcar/cancelar/marcar
  status (D-030) operam a reserva inteira; remarcar troca data, hora, profissional e a lista completa de serviços
  (`src/server/reservas/tipos-alteracao.ts:28-39`).
- **Avaliação** é única por reserva (`avaliacao.reserva_id @unique`, `prisma/schema.prisma:898`) e só vale para
  `reserva.status = 'concluido'` (`src/server/repos/avaliacao-publica.ts:21`, `src/server/repos/avaliacao.ts:91`).

Consequência: a cliente não consegue, num só agendamento, fazer escova com P1 às 9h, hidratação com P2 às 10h e
manicure com P3 às 15h.

## 2. Objetivo

A cliente (página pública) e a equipe (`/painel/agenda/nova`) passam a montar **um agendamento** com vários serviços,
escolhendo **profissional e horário para cada serviço**, entre os horários livres de cada profissional elegível
daquele serviço. Cada serviço vira um **item** com vida própria (profissional, horário, status, encaixe), operável
isoladamente pela equipe, mantendo as garantias atuais: anti-sobreposição no banco, atomicidade, idempotência,
isolamento entre salões, uma confirmação de WhatsApp por agendamento e o limite de 3 agendamentos futuros por número.

## 3. Escopo

### 3.1 Entra
1. Esquema e migração (SQL bruto revisado pelo DBA): campos por item, nova exclusion constraint no item, migração das
   reservas existentes, com reversão documentada.
2. Disponibilidade por serviço (cada serviço com seus profissionais elegíveis), mantendo número constante de
   instruções SQL.
3. Fluxo público novo (sem JS, teclado, 375×812, axe), incluindo a reescolha quando um item fica indisponível.
4. Criação atômica com N itens (público e equipe), revalidação de cada item, travas sem impasse, idempotência.
5. Equipe: nova reserva com N itens (encaixe por item); remarcar, cancelar e marcar status **por item**; cancelar
   todos os itens restantes de uma vez; agenda e detalhe por item; profissional só opera os próprios itens.
6. Mensagens: confirmação consolidada (novo formato de parâmetros e novo texto sugerido do modelo `confirmacao`);
   remarcação e cancelamento por item; revisão incrementada na reserva.
7. Convite de avaliação adaptado ao status derivado.
8. Ajuste dos leitores do modelo antigo (lista na seção 9), seed, E2E e documentação (`CLAUDE.md`, `PLAN.md`,
   `docs/whatsapp-templates.md`; README: ver seção 7, item 5).

### 3.2 Fora
- Preço ou duração por profissional (PLAN.md, "Fora da primeira versão", linha 148; decisão do usuário).
- Atendimentos simultâneos da mesma cliente (itens sobrepostos).
- Pacotes/combos (PLAN.md linha 148, "Pacotes da cliente").
- **Acrescentar** um novo serviço a uma reserva já criada (a equipe cria outra reserva). Ver DA-12.
- Itens da mesma reserva em **datas diferentes** (ver DA-1).
- Impedir sobreposição entre itens de **reservas diferentes** da mesma cliente (comportamento atual mantido; ver DA-5).
- Reenvio de mensagem pela equipe, lembretes, mensagens promocionais (fora da v1 / E8.3).
- Avaliação por item (continua por reserva; ver DA-7).

Nada do escopo colide com "Fora da primeira versão" do PLAN.md. O escopo **revoga** a frase do PLAN.md linha 41, o
critério de aceite 2 (linha 153) e o invariante "Multi-service bookings run back to back with a single professional"
do CLAUDE.md, por decisão do usuário (issue #111); esses textos devem ser atualizados na demanda (RF-14).

## 4. Requisitos funcionais

- **RF-1 Item autônomo.** Cada `reserva_item` passa a ter profissional, início, fim, ocupado-até, status e encaixe
  próprios, além do snapshot de preço e duração já existente.
- **RF-2 Disponibilidade por serviço.** Dado um conjunto de serviços e uma data, o sistema devolve, para cada serviço,
  os profissionais elegíveis **daquele** serviço e os inícios livres de cada um, aplicando as regras da D-018 com a
  duração **do serviço** (não a soma).
- **RF-3 Fluxo público.** `serviços → data → (para cada serviço, na ordem escolhida) profissional e horário → dados →
  confirmação`, com resumo das escolhas e link "Alterar" por item.
- **RF-4 Criação atômica.** Uma reserva com N itens é gravada inteira ou nada é gravado.
- **RF-5 Nova reserva da equipe** com N itens (serviço, profissional, hora por item; data única), encaixe por item.
- **RF-6 Operações por item.** Remarcar, cancelar, marcar concluído / não compareceu um item.
- **RF-7 Cancelar todos.** Cancelar de uma vez todos os itens ainda canceláveis da reserva, com uma única mensagem.
- **RF-8 Status derivado** da reserva a partir dos itens.
- **RF-9 Agenda por item.** Cada item aparece como bloco na coluna do seu profissional; o detalhe lista os itens.
- **RF-10 Confirmação consolidada** de WhatsApp por reserva; mensagens de remarcação/cancelamento por item.
- **RF-11 Convite de avaliação** quando a reserva fica concluída (status derivado).
- **RF-12 Migração** das reservas existentes sem perda.
- **RF-13 Seed e E2E** com o cenário do exemplo (3 serviços, 3 profissionais, manhã e tarde).
- **RF-14 Documentação**: `CLAUDE.md` (invariante e parágrafo D-050), `PLAN.md` (linha 41 e critério 2),
  `docs/whatsapp-templates.md` (novo texto da confirmação).

## 5. Regras de negócio

Rastreio: **[U]** decisão do usuário na issue #111; **[P]** PLAN.md/CLAUDE.md; **[A]** decisão do analista (seção 12).

### Modelo e composição
- **RN-1** [U] Um agendamento é 1 `reserva` com 1..N `reserva_item`; cada item tem profissional, início, fim,
  ocupado-até, status e encaixe próprios. A reserva mantém cliente, origem, revisão, chave de requisição e
  consentimentos.
- **RN-2** [A, P] N vai de 1 a 10; cada serviço aparece no máximo uma vez por reserva (mantém
  `validarServicos`: 1..10, sem repetição).
- **RN-3** [A] Todos os itens de uma reserva estão na **mesma data civil local** do salão (fuso do salão). A data de um
  item é a data local do seu início. Um item que começa num dia e termina depois da meia-noite local é aceito se a
  jornada permitir (mesma regra da D-018: só o início define a data).
- **RN-4** [P] Snapshot: `preco_centavos` e `duracao_min` do item são os do serviço no momento da criação (ou da troca
  de serviço na remarcação); `fim = inicio + duracao_min`.
- **RN-5** [A] `ocupado_ate` de cada item = `fim + intervalo_min` vigente do salão no momento da gravação (o
  intervalo passa a valer **por item**, também entre dois itens consecutivos do mesmo profissional).
- **RN-6** [A] Ordem de exibição dos itens: por `inicio` crescente (não há empate, por RN-8).

### Disponibilidade e escolha
- **RN-7** [U, P] Para cada serviço, só são oferecidos profissionais **ativos vinculados àquele serviço** e só
  inícios que satisfazem a D-018 com a duração do serviço: grade, jornada ∩ funcionamento (definido), fora de
  bloqueios (próprios e do salão), `[inicio, inicio + duracao + intervalo)` fora das ocupações ativas dos **itens**
  (`confirmado`/`concluido`/`nao_compareceu`, inclusive encaixes), `inicio ≥ agora + antecedência`, data ≤ hoje +
  janela. Deixa de existir a exigência de profissional comum a todos os serviços.
- **RN-8** [U] Itens da mesma reserva não se sobrepõem no tempo: para quaisquer dois itens não cancelados X e Y da
  mesma reserva, `[X.inicio, X.fim) ∩ [Y.inicio, Y.fim) = ∅` (sem intervalo/buffer, que é do profissional). Itens
  adjacentes (X.fim = Y.inicio) são permitidos.
- **RN-9** [A] Dois itens da mesma reserva com o mesmo profissional respeitam também a ocupação: `[X.inicio,
  X.ocupado_ate)` não cruza `[Y.inicio, Y.ocupado_ate)` (garantido pela constraint do RN-15).
- **RN-10** [A] Durante a escolha, os horários oferecidos para o serviço k já descontam os itens escolhidos para os
  demais serviços (RN-8 e RN-9 aplicados à seleção ainda não gravada). O servidor revalida tudo no envio.

### Criação
- **RN-11** [U, P] Atomicidade: todos os itens, a cliente (upsert D-022), os consentimentos (D-023) e a mensagem de
  confirmação são gravados na mesma transação; qualquer item indisponível desfaz tudo.
- **RN-12** [P] Revalidação na transação de **cada** item com as regras de RN-7..RN-9 (fluxo público, `modo:
  'normal'`), reutilizando o cálculo da D-018 (sem segunda implementação das regras).
- **RN-13** [P] Ordem de travas: salão `FOR SHARE` → **todos** os profissionais dos itens `FOR NO KEY UPDATE`, sem
  repetição, em ordem de id → serviços `FOR SHARE` em ordem de id → cliente → reserva/itens → consentimento →
  mensagem (CLAUDE.md D-025 DEF-1 e D-030). Nunca promover `FOR SHARE` → `NO KEY UPDATE`.
- **RN-14** [P] Idempotência: a `chave_requisicao` identifica a reserva inteira; repetir a mesma chave devolve
  `repetida` com os mesmos itens, sem gravar nada; a mesma chave com conteúdo diferente devolve
  `chave_reutilizada` (D-025).
- **RN-15** [U, P] A anti-sobreposição definitiva passa para `reserva_item`: exclusion constraint `btree_gist` por
  profissional sobre `tstzrange(inicio, ocupado_ate, '[)')`, apenas status ativos, com o literal dos status no SQL,
  criada em migração SQL bruta. O `23P01` é reconhecido por SQLSTATE **e** nome da nova constraint e nunca é capturado
  dentro da transação; `23505` nunca é capturado. Encaixes não têm exceção.
- **RN-16** [P] A equipe (encaixe ou não) também está sujeita a RN-8 e RN-15; o encaixe dispensa só jornada,
  funcionamento e bloqueio (D-029), por item.
- **RN-17** [A] Encaixe por item: cada item com motivo de encaixe (fora da jornada, horário bloqueado, fora do
  funcionamento) é listado com seus motivos; **uma** confirmação do formulário confirma o encaixe de todos os itens
  listados; `encaixe = true` só nos itens que tinham motivo (flag real, D-029).
- **RN-18** [U, P] Limite de 3 futuras (D-027) conta **reservas**: uma reserva é "futura" se tem ao menos um item
  `confirmado` com `inicio > agora`. A requisição repetida (mesma chave) nunca é recusada pelo limite.
- **RN-19** [P] Fluxo público: Turnstile e limite por IP antes de qualquer escrita (D-027), política de operação
  (D-038), consentimentos por finalidade, uma linha de consentimento por finalidade **por reserva** (não por item).

### Status
- **RN-20** [U, P] Cada item segue a máquina da D-030: `confirmado → cancelado` só enquanto `agora < item.fim`;
  `confirmado → concluido | nao_compareceu` só quando `agora ≥ item.inicio`; `concluido ↔ nao_compareceu`;
  `cancelado` é terminal.
- **RN-21** [A] Status derivado da reserva, por prioridade: existe item `confirmado` → `confirmado`; senão existe item
  `concluido` → `concluido`; senão existe item `nao_compareceu` → `nao_compareceu`; senão (todos cancelados) →
  `cancelado`. A reserva fica "totalmente cancelada" quando todos os itens estão `cancelado`; `cancelada_em` (se
  mantido) registra esse instante. Todo lugar que mostra ou filtra o status da reserva usa o status derivado; se o
  status da reserva continuar armazenado, ele é recalculado na mesma transação de toda mudança de item.

### Remarcar e cancelar
- **RN-22** [A] Remarcar um item: só item `confirmado`; pode trocar hora, profissional e o serviço do item (novo
  snapshot só se o serviço mudar); a data só pode mudar se o item for o único item não cancelado da reserva (senão
  RN-3 exige a mesma data). Equipe sem grade/antecedência (D-030); `inicio` no passado recusado; encaixe por RN-17.
- **RN-23** [U] Operar um item não altera nenhum outro item (horário, profissional, status, snapshot).
- **RN-24** [A] Cancelar todos: cancela, numa transação, todos os itens `confirmado` com `agora < fim`; itens já
  concluídos, não compareceu ou já terminados ficam como estão; se nenhum item puder ser cancelado, recusa sem gravar.
- **RN-25** [P] Permissões: gestor opera qualquer item do salão; profissional só os **próprios** itens (403 em item de
  outro profissional, inclusive na remarcação para outro profissional); outro salão, id malformado ou inexistente →
  404 uniforme. Política D-038: remarcar e criar exigem `agendar`; cancelar (item ou todos) e marcar status exigem
  `cancelar` (salão suspenso continua cancelando e notificando).
- **RN-26** [P] Cliente anonimizada: operações permitidas, sem mensagem (D-030/D-031).

### Mensagens
- **RN-27** [U] Uma confirmação por reserva (`confirmacao`, revisão 0), registrada na transação de criação.
  Conteúdo, montado **no envio**: salão, data e a lista dos itens **não cancelados** em ordem de início, cada um com
  hora de início, serviço e profissional (ex.: "09:00 Escova com Ana; 10:00 Hidratação com Bia; 15:00 Manicure com
  Carla"). Novo formato de parâmetros: `salao`, `data`, `itens` (sem quebra de linha; limite de 1024 caracteres da
  D-047).
- **RN-28** [A] Toda operação que gera mensagem para a cliente incrementa `reserva.revisao` em 1 **antes** de
  registrar a mensagem: remarcar item, cancelar item, cancelar todos. Marcar status não incrementa. A chave
  `reserva:tipo:revisao` continua única e nunca colide (dois cancelamentos de itens diferentes têm revisões
  diferentes). Isso muda a D-030 (cancelar não incrementava).
- **RN-29** [A] A mensagem de remarcação/cancelamento de **um item** refere-se a esse item (identificação do item na
  mensagem: mecanismo do arquiteto/DBA). Parâmetros: formato atual dos modelos `remarcacao` (salao, servicos =
  serviço do item, profissional do item, data, horario do item) e `cancelamento` (salao, servicos, data, horario).
  "Cancelar todos" gera **um** `cancelamento` sem item, com `servicos` = serviços cancelados (ordem de início),
  `data` e `horario` = início do primeiro item cancelado. Mensagens sem item (inclusive as antigas, anteriores à
  migração) referem-se à reserva inteira.
- **RN-30** [A] Vigência no envio (substitui D-024 RN-16 para a nova realidade):
  - `confirmacao`: vigente enquanto o status derivado for `confirmado`;
  - `remarcacao` de item: vigente se o item continua `confirmado` e nenhuma remarcação posterior do mesmo item foi
    registrada;
  - `cancelamento` de item: vigente se o item continua `cancelado` e é a última mensagem registrada para o item;
  - `cancelamento` sem item: vigente se o status derivado é `cancelado` ou se os itens que ele cita continuam
    cancelados;
  - `convite_avaliacao`: vigente se o status derivado é `concluido`.
- **RN-31** [A] Substituição (D-024 RN-7 adaptada): uma nova mensagem de item substitui só as `pendente` anteriores
  **do mesmo item**; a `confirmacao` pendente **não** é substituída por mensagem de item (ela é montada no envio com o
  estado atual); quando a reserva fica totalmente cancelada, a `confirmacao` e as remarcações pendentes são
  substituídas.
- **RN-32** [P] Mensagens só são enfileiradas depois do commit; falha de envio nunca altera reserva nem item.

### Avaliação
- **RN-33** [A] O convite de avaliação (`convite_avaliacao`, revisão 0) nasce na transação em que o status derivado
  passa a `concluido` (último item `confirmado` marcado concluído / não compareceu com ao menos um concluído, ou
  cancelamento do último item `confirmado` quando já há item concluído, ou `nao_compareceu → concluido` de um item
  quando nenhum outro estava concluído). Voltar a `concluido` nunca reenvia (chave única).
- **RN-34** [A] A avaliação continua **por reserva** (`UNIQUE(reserva_id)` mantido); "só reservas concluídas" passa a
  ser "status derivado `concluido`" no envio do link, na leitura pública e nas denúncias (D-032, D-035).

### Leitura e exibição
- **RN-35** [A] Valor total exibido = soma dos snapshots dos itens **não cancelados**; numa reserva totalmente
  cancelada, soma de todos os itens com o rótulo de cancelada (mantém o histórico atual). Itens cancelados aparecem
  riscados ou com o rótulo "Cancelado", com seu preço.
- **RN-36** [A] Agenda (D-028): um bloco por item não cancelado (e cancelados como hoje) na coluna do profissional do
  item; o bloco abre o detalhe da reserva. Gestor vê todos os itens; profissional vê na grade e no detalhe **apenas os
  próprios itens** (nem serviço, nem horário, nem preço dos itens de outros profissionais). O limite de 200 passa a
  valer para itens por período, com o mesmo aviso.
- **RN-37** [A] Indicador de falha de mensagem (D-043): aparece em todos os blocos visíveis da reserva quando houver
  falha vigente. No detalhe, gestor vê todas as mensagens; profissional vê as mensagens sem item e as dos próprios
  itens.
- **RN-38** [P] Desativar profissional (D-013) é recusado enquanto houver **item** `confirmado` dele com `fim >
  agora`; o aviso de bloqueio (D-016) lista os **itens** confirmados que cruzam o período; o contato da cliente para o
  profissional (D-022 `cliente.contato`) vale se ela tem item (qualquer status) com ele.

### Migração
- **RN-39** [U] Cada item existente herda `profissional_id`, `status` e `encaixe` da reserva; `inicio` do item k (por
  `ordem`) = `reserva.inicio` + soma das durações dos itens anteriores; `fim = inicio + duracao_min`; `ocupado_ate`
  = `fim` para os itens que não são o último e = `reserva.ocupado_ate` para o último (a união das ocupações é idêntica
  à de antes, e itens consecutivos do mesmo profissional não conflitam). A migração aborta (sem aplicar nada) se
  alguma reserva tiver `fim ≠ inicio + soma das durações`, informando a contagem.

## 6. Critérios de aceitação

Formato Dado/Quando/Então. Entre parênteses: correspondência com o PLAN.md e com os CA da issue.

### Disponibilidade
- **CA-1** (issue CA-2; PLAN CA-3) Dado serviço A vinculado a P1 e P2 (P2 inativo) e serviço B vinculado só a P3,
  quando a disponibilidade é consultada para {A, B} numa data, então A lista só P1 e B lista só P3, cada um com os
  inícios que obedecem jornada ∩ funcionamento, bloqueios, ocupações de itens ativos, antecedência, janela e
  intervalo, calculados com a duração do próprio serviço.
- **CA-2** (RN-7) Dado que nenhum profissional faz A **e** B, quando a cliente escolhe A e B, então a página oferece
  horários para ambos (antes: nenhum profissional).
- **CA-3** (D-018 CA-26/CA-41) Dados 1, 3 e 10 serviços, 1 e 8 profissionais e 1 e 14 datas, quando a disponibilidade
  é consultada, então o número de instruções SQL é o mesmo em todos os cenários (contado no teste), e a consulta de
  ocupação usa o índice GiST da nova constraint (EXPLAIN impresso no teste com ≥ 10.000 itens).
- **CA-4** (RN-10; issue CA-3) Dado A escolhido com P1 às 09:00–10:00 e intervalo de 10 min, quando a página lista os
  horários de B (40 min), então nenhum início no intervalo aberto (08:20, 10:00) é oferecido para nenhum profissional
  (sobreposição com a cliente) e, para P1, nenhum início em (08:10, 10:10) é oferecido (ocupações `[t, t+50)` ×
  `[09:00, 10:10)`); 08:20 e 10:00 são oferecidos para os demais profissionais se livres.
- **CA-5** (RN-8; issue CA-3) Dado um envio forjado (sem passar pela página) com A às 09:00–10:00 e B às 09:30, quando
  chega ao servidor, então nada é gravado e a resposta é de horário indisponível para o item B.

### Fluxo público
- **CA-6** (issue CA-1; PLAN CA-2 revisto) Dados A (P1), B (P2) e C (P3), quando a cliente escolhe A com P1 às 09:00,
  B com P2 às 10:00 e C com P3 às 15:00 na mesma data e confirma com nome, WhatsApp e consentimentos, então existe
  exatamente 1 reserva com 3 itens, cada um com seu profissional, início, fim, snapshot e status `confirmado`, e a
  tela de confirmação mostra os 3 itens em ordem de início, com profissional, horário e preço, e o total.
- **CA-7** (RN-3) Dada a escolha da data D, quando a cliente avança pelos serviços, então todos os horários oferecidos
  são da data D; um envio forjado com um item em outra data é recusado sem gravar.
- **CA-8** (D-026 RN-15) Dada qualquer combinação de parâmetros inválidos, repetidos, de outro salão ou fora de ordem
  na query, quando a página é aberta, então ela volta ao passo válido mais avançado, sem erro 500 e sem consultar
  dados de outro salão.
- **CA-9** (RF-3) Dado o passo de dados com 3 itens escolhidos, quando a cliente usa "Alterar" de um item, então volta
  ao passo daquele serviço com os demais itens preservados, e os horários desse serviço descontam os outros itens
  (CA-4).
- **CA-10** (issue CA-4; D-036) Dado que, entre a escolha e o envio, o horário do item B foi ocupado por outra reserva,
  quando a cliente envia, então nada é gravado (nem cliente nova, nem consentimento, nem mensagem), a resposta (sem
  redirecionar, sem dados na URL, também sem JS) informa qual item ficou indisponível, mostra horários atualizados
  para ele, mantém os outros itens e preserva nome, telefone e consentimentos digitados.
- **CA-11** (RN-14) Dado o mesmo formulário enviado 10 vezes em paralelo com a mesma `chave_requisicao`, então existe
  1 reserva com N itens e as demais respostas são `repetida` com os mesmos itens; nenhum `23505` escapa.
- **CA-12** (issue CA-12; PLAN CA-2) Dado viewport 375×812 com toque, quando o cenário do exemplo (3 serviços, 3
  profissionais, manhã e tarde) é percorrido só pelo teclado, então a reserva é criada; cada tela tem zero violações
  do axe 4.14.0 e não tem rolagem horizontal.
- **CA-13** (D-026) Dado o navegador sem JavaScript, quando o cenário do CA-12 é percorrido, então a reserva é criada;
  o mesmo vale para a reescolha do CA-10.
- **CA-14** (D-038) Dado salão suspenso, quando a página pública é aberta, então não há formulário de agendamento;
  um envio forjado responde `salao_indisponivel` sem gravar.

### Limite e proteção
- **CA-15** (issue CA-9; RN-18; PLAN CA-10) Dado um número com 2 reservas futuras de 3 itens cada (6 itens), quando
  cria a 3ª reserva com 3 itens, então é aceita; quando tenta a 4ª, então é recusada com o aviso do limite e nada é
  gravado. Dada uma reserva cujos itens futuros foram todos cancelados, então ela não conta.
- **CA-16** (D-027) Dado token Turnstile inválido ou limite por IP estourado, então nada é gravado, como hoje.

### Concorrência e banco
- **CA-17** (issue CA-5; PLAN CA-3) Dadas 10 reservas diferentes enviadas em paralelo, cada uma com um item no mesmo
  profissional e horário (e outros itens livres), então exatamente 1 é criada; as outras 9 recebem
  `horario_indisponivel` sem nenhum item gravado; nenhum `23505`, nenhum impasse (`40P01`), nenhum 5xx.
- **CA-18** (RN-13) Dadas duas reservas em paralelo com itens em {P1, P2} e {P2, P1} (ordens de escolha cruzadas),
  repetidas 10 vezes, então nenhuma termina em impasse; a ordem de travas é verificada com `pg_stat_activity` num caso
  determinístico.
- **CA-19** (issue CA-6; RN-15/RN-16) Dado um item ativo de P1 em [10:00, 10:40), quando se tenta gravar diretamente
  no banco (SQL) outro item ativo de P1 que cruze esse intervalo, inclusive com `encaixe = true`, então o banco
  recusa com `23P01` e o nome da nova constraint; um item `cancelado` no mesmo intervalo é aceito.
- **CA-20** (RN-9) Dada uma reserva com A e B no mesmo profissional, A em [09:00, 09:30) e intervalo 10 min, quando B é
  pedido às 09:30, então é recusado; às 09:40, aceito.
- **CA-21** (RN-23/RN-13) Dadas remarcação do item X e cancelamento do item Y da mesma reserva em paralelo (10 vezes),
  então ambas concluem (serializadas), sem impasse, e a revisão final da reserva é a inicial + 2 com duas mensagens de
  chaves diferentes.
- **CA-22** (D-013) Dados a desativação de P1 e a criação de uma reserva com item em P1 em paralelo, então ou a
  reserva é criada e a desativação recusada, ou a desativação ocorre e a reserva recebe `profissional_indisponivel`;
  nunca ambas.

### Equipe
- **CA-23** (issue CA-6; D-029) Dado o gestor em `/painel/agenda/nova`, quando cria uma reserva com 3 itens (serviço,
  profissional e hora por item, mesma data), sendo um fora da jornada, então a resposta lista o motivo de encaixe
  desse item; ao confirmar, a reserva é criada com `encaixe = true` só nesse item. Sem confirmar, nada é gravado
  (nem cliente, nem mensagem).
- **CA-24** (RN-25) Dado um profissional logado, quando cria reserva com item de outro profissional, então 403 e nada
  é gravado; com itens só dele, a criação funciona.
- **CA-25** (issue CA-7; RN-22/RN-23) Dada uma reserva com itens X (P1) e Y (P2), quando o gestor remarca X para outro
  horário e profissional, então só X muda (novo horário, profissional e `ocupado_ate`), Y fica idêntico, a revisão da
  reserva sobe 1 e uma mensagem `remarcacao` de X é registrada com o novo horário de X.
- **CA-26** (RN-22) Dada uma reserva com X e Y não cancelados, quando se tenta remarcar X para outra data, então é
  recusado com mensagem; dada uma reserva com só X não cancelado, a troca de data é aceita.
- **CA-27** (issue CA-7) Quando o gestor cancela X, então X fica `cancelado`, Y continua `confirmado`, o status
  derivado continua `confirmado`, a revisão sobe 1 e uma mensagem `cancelamento` de X é registrada.
- **CA-28** (RN-24) Dada uma reserva com X concluído e Y e Z confirmados futuros, quando o gestor usa "Cancelar todos",
  então Y e Z ficam `cancelado`, X continua `concluido`, a revisão sobe 1 e uma única mensagem `cancelamento` cita Y e
  Z; o status derivado passa a `concluido` e o convite nasce (RN-33).
- **CA-29** (RN-20) Dado item com `agora < inicio`, marcar concluído é recusado; dado item com `agora ≥ fim`, cancelar
  é recusado; item cancelado não aceita nenhuma transição; cada recusa não grava nada.
- **CA-30** (issue CA-7; RN-25) Dado o profissional P2, quando tenta remarcar, cancelar ou marcar status do item de
  P1 na mesma reserva, então 403 e nada muda; quando opera o próprio item, funciona. Dado um usuário do salão B, toda
  operação sobre item ou reserva do salão A responde 404.
- **CA-31** (D-038) Dado salão suspenso, quando a equipe cancela um item futuro, então funciona e a mensagem de
  cancelamento é registrada; remarcar ou criar recebe 403.
- **CA-32** (RN-36; PLAN CA-4) Dada a reserva do CA-6, quando o gestor abre a agenda do dia, então há um bloco por item
  na coluna de P1, P2 e P3, nos horários corretos, todos levando ao mesmo detalhe; o detalhe lista os 3 itens com
  status e ações próprias e o total.
- **CA-33** (RN-36/RN-37) Dado P2 logado, quando abre a agenda e o detalhe da mesma reserva, então vê só o item dele
  (o HTML não contém nome do serviço, horário nem preço dos itens de P1 e P3) e as mensagens sem item ou do próprio
  item.
- **CA-34** (D-043) Dada uma falha vigente de mensagem na reserva, então todos os blocos visíveis dela mostram o
  indicador, e a agenda continua com o mesmo número constante de instruções SQL.
- **CA-35** (RN-36) Dadas 201 linhas de itens no período, então a agenda mostra 200 e o aviso de limite.
- **CA-36** Os formulários de nova reserva e de operações por item funcionam sem JavaScript, por teclado, com axe sem
  violações e sem rolagem horizontal em 375×812; adicionar e remover linhas de item sem JS não perde o que foi
  digitado.

### Mensagens
- **CA-37** (issue CA-8; RN-27; PLAN CA-6) Dada a reserva do CA-6 com consentimento de mensagens, quando o worker
  processa, então exatamente 1 mensagem `confirmacao` é enviada pelo adaptador simulado, com parâmetros `salao`,
  `data` e `itens` listando os 3 itens em ordem de início com hora, serviço e profissional; o parâmetro não tem quebra
  de linha.
- **CA-38** (RN-28; issue CA-8) Dada uma reserva com X e Y, quando X é cancelado e depois Y é cancelado, então há duas
  mensagens `cancelamento` com revisões 1 e 2, nenhuma colisão de chave, cada uma citando o próprio item.
- **CA-39** (RN-31/RN-27) Dada a confirmação ainda `pendente` e o item X remarcado, quando o worker envia, então a
  confirmação continua sendo enviada (não substituída) e lista X com o horário novo; a remarcação de X também é
  enviada. Dado que todos os itens são cancelados com a confirmação pendente, então ela fica `substituida` e não é
  enviada.
- **CA-40** (RN-30) Dado X remarcado duas vezes com a primeira remarcação ainda pendente, então só a segunda é enviada.
- **CA-41** (D-024) Reprocessar o mesmo job ou registrar duas vezes o mesmo evento nunca duplica mensagem (chave
  `reserva:tipo:revisao`).
- **CA-42** (RN-26) Cliente anonimizada: cancelar ou remarcar item funciona e não registra mensagem enviável.
- **CA-43** (D-047) O adaptador real do WhatsApp envia a confirmação no novo formato (ordem `salao`, `data`, `itens`)
  — teste de contrato com servidor local; `docs/whatsapp-templates.md` traz o novo texto sugerido.

### Avaliação
- **CA-44** (RN-33) Dada uma reserva com X e Y confirmados, quando só X é marcado concluído, então nenhum convite nasce;
  quando Y é marcado concluído (ou não compareceu), então nasce 1 convite; voltar Y a confirmado não é possível
  (máquina) e alternar concluído ↔ não compareceu não gera segundo convite.
- **CA-45** (RN-34; PLAN CA-11) Dada uma reserva com todos os itens `nao_compareceu`, então o link de avaliação
  responde "Link inválido ou expirado." e uma avaliação existente não é exibida; com status derivado `concluido`, a
  avaliação (uma por reserva) é aceita e exibida.

### Migração
- **CA-46** (issue CA-10) Dada uma base com reservas da versão anterior (1 e 3 itens, todos os status, encaixe,
  remarcada), quando a migração é aplicada, então cada item tem profissional, status e encaixe da reserva, inícios e
  fins consecutivos pela `ordem`, `ocupado_ate` conforme RN-39; a união das ocupações por profissional é igual à de
  antes; contagens de reservas, itens, mensagens e avaliações não mudam; e a constraint nova recusa uma sobreposição
  nova.
- **CA-47** (RN-39) Dada uma reserva inconsistente (`fim ≠ inicio + soma`), então a migração falha sem aplicar nada e
  informa a contagem.
- **CA-48** A reversão documentada (no cabeçalho da migração) é executada num teste ou passo manual objetivo e devolve
  o esquema anterior com os dados equivalentes.
- **CA-49** Mensagens antigas (sem item) continuam enviáveis e com a vigência correta após a migração.

### Isolamento e gates
- **CA-50** (issue CA-11; PLAN CA-1) Dados salões A e B, quando uma reserva do salão A cita serviço ou profissional do
  salão B (público e equipe), então o resultado é `servico_indisponivel`/`profissional_indisponivel` e nada é gravado;
  a disponibilidade, a agenda, o detalhe e as operações por item nunca leem itens de outro salão (testes de
  integração).
- **CA-51** O seed cria, no salão de demonstração, ao menos uma reserva com 3 itens em 3 profissionais (manhã e tarde)
  e o E2E com banco (D-036) cobre o cenário do exemplo de ponta a ponta, incluindo a confirmação.
- **CA-52** Gate padrão: build, lint, typecheck, testes unitários, de integração e E2E pertinentes passando;
  cobertura de linhas ≥ 90% no `npm run test:coverage`; testes de domínio em `TZ=UTC` e `TZ=America/Sao_Paulo`.

## 7. Casos limite

1. **Fuso e virada de dia.** A data única (RN-3) é a data local do início de cada item; item que começa às 23:00 e
   termina 00:30 (jornada até 24:00 impede, mas encaixe permite) pertence ao dia do início. Horário de verão
   inexistente/repetido: regra da D-018 por item. Testes em dois fusos de processo.
2. **Concorrência.** Mesma vaga em reservas diferentes (CA-17); profissionais cruzados (CA-18); operação em itens
   diferentes da mesma reserva (CA-21); criação × desativação (CA-22); remarcação de item × nova reserva no mesmo
   horário (a constraint decide); "Cancelar todos" × cancelar um item (o segundo recebe recusa ou `sem_efeito`, sem
   duas mensagens para o mesmo item).
3. **Isolamento entre salões.** CA-50; FKs compostas com `salao_id` também nos novos campos de item.
4. **Salão suspenso.** CA-14 e CA-31.
5. **Cliente anonimizada.** CA-42; nome "cliente removida" nos blocos de todos os itens.
6. **Entradas inválidas.** Telefone não brasileiro (normalizador único D-020/D-022); 0 ou 11 serviços; serviço
   repetido; mesmo serviço em dois itens; hora fora da grade (público); item em outra data; UUID malformado → passo
   anterior (público) ou 404/`invalido` (equipe); query enorme (11+ itens) → volta ao passo de serviços.
7. **Permissões.** CA-24, CA-30, CA-33.
8. **Mesmo profissional em vários itens.** Permitido; intervalo entre eles (CA-20).
9. **Item adjacente.** A.fim = B.inicio com profissionais diferentes: permitido (RN-8 semiaberto).
10. **Serviço/profissional desativado depois da reserva.** Itens existentes não mudam; rótulos da confirmação continuam
    (D-026 `lerRotulosDaReserva`); remarcar para profissional inativo → `profissional_indisponivel`.
11. **Reserva com um único item.** Comporta-se como hoje (uma confirmação, remarcação, cancelamento); "Cancelar todos" e
    cancelar o item produzem o mesmo efeito.
12. **Parâmetro `itens` longo.** 10 itens com nomes longos: truncado em 1024 com `…` (regra D-047).
13. **Bloqueio criado depois.** A constraint não cobre bloqueios (risco aceito D-025); o aviso de bloqueio lista itens.

## 8. Dependências

- Demandas: D-018, D-024, D-025, D-026, D-027, D-028, D-029, D-030, D-032, D-035, D-036, D-043, D-045, D-047 (todas
  concluídas). Nenhuma demanda aberta bloqueia.
- Integrações: WhatsApp (modelo `confirmacao` muda de formato: precisa de **nova aprovação na Meta** antes de usar
  `WHATSAPP_ADAPTER=real`; sugerir nome novo, ex. `agenda_confirmacao_itens`, para não conflitar com um modelo já
  aprovado); Turnstile e Mercado Pago sem mudança; e-mail sem mudança.
- Dados: migração de esquema + dados em `reserva`/`reserva_item`, possivelmente em `mensagem` (referência ao item).

## 9. Impacto em demandas anteriores

| Demanda | O que muda |
|---|---|
| D-004 (esquema) | `reserva_sem_sobreposicao` deixa de ser a proteção; nova constraint em `reserva_item`; destino das colunas de `reserva` (DBA/arquiteto) |
| D-013 (profissionais) | Desativação verifica itens confirmados futuros do profissional (RN-38) |
| D-016 (bloqueios) | `listarConfirmadasQueCruzam` lista itens; literal `'confirmado'` e índice da nova constraint |
| D-018 (disponibilidade) | Consulta por serviço; `candidatos` deixa de exigir todos os vínculos; ocupações vêm dos itens; plano/índice e contagem constante revistos |
| D-022 (clientes) | Histórico por reserva com itens (profissional, status) e total (RN-35); `cliente.contato` por item |
| D-024 (mensagens) | Parâmetros da confirmação; referência ao item; vigência (RN-30) e substituição (RN-31); contexto de envio lê itens |
| D-025 (criar reserva) | Entrada com N itens; travas de N profissionais; revalidação por item; `montarItens` sequencial substituído; reconhecimento do novo 23P01 |
| D-026/D-036 (fluxo público) | Novos passos e query; remoção da opção "qualquer"; confirmação com itens; reescolha por item |
| D-027 (proteção) | Contagem de futuras por reserva com item futuro confirmado (RN-18) |
| D-028/D-043 (agenda) | Bloco por item; detalhe com itens; visão do profissional restrita aos próprios itens; limite de 200 itens; indicador de falha |
| D-029 (equipe) | Formulário com N itens; encaixe por item |
| D-030 (alteração) | Operações por item; cancelar incrementa revisão; "Cancelar todos"; máquina por item; status derivado |
| D-031 (anonimização) | Sem mudança de regra; testes revisados com reservas de N itens |
| D-032/D-035 (avaliações) | Convite e verificação pelo status derivado (RN-33/RN-34) |
| D-038 (política) | Mesma matriz; aplicada às operações por item |
| D-045 (admin mensagens) | Exibir a reserva/item da mensagem sem expor dados novos |
| D-047 (WhatsApp real) | Ordem de parâmetros do modelo `confirmacao`; contrato e `docs/whatsapp-templates.md` |
| D-036 (seed/E2E) | Seed e fixtures de E2E no novo modelo |
| PLAN.md / CLAUDE.md | Linha 41 e critério 2 do PLAN; invariante "Multi-service bookings…"; parágrafo D-050 |

## 10. Impactos prováveis (para o arquiteto decidir DBA/DevOps)

- **Dados (DBA obrigatório):** novas colunas e FKs compostas em `reserva_item`; nova exclusion constraint e índices
  (agenda por profissional/período, futuras por cliente); destino de `reserva.profissional_id/inicio/fim/ocupado_ate/
  status/encaixe`; migração de dados com verificação (RN-39) e reversão; possível coluna de item em `mensagem`;
  planos de consulta (D-016, D-018, D-028, D-043) refeitos com o índice novo; lock da migração sobre tabelas com dados.
- **Infraestrutura/CI:** sem nova variável de ambiente obrigatória; o E2E com banco ganha cenários (tempo de job);
  DevOps provavelmente dispensável.
- **Visual (web-designer):** há impacto visual (fluxo público com passos novos, resumo por item, confirmação, agenda
  com blocos por item, detalhe com ações por item, formulário com N linhas).

## 11. Dúvidas

### Dúvidas bloqueantes
Nenhuma.

### Dúvidas não bloqueantes (suposição adotada)
- **ND-1** Exigir a mesma data para todos os itens (DA-1). Suposição: sim. Se o usuário quiser datas diferentes,
  RN-3, CA-7, CA-26 e RN-29 (data única no cancelamento consolidado) precisam ser revistos e o limite de 3 futuras
  perde força (10 itens em 10 dias contariam como 1). **CONFIRMADO pelo usuário em 23/11/2026: mesma data local do
  salão para todos os itens.**
- **ND-2** Sobreposição entre reservas diferentes da mesma cliente: mantida como hoje (não verificada). Suposição
  adotada pela leitura de "mesma reserva/cliente" como "itens do mesmo agendamento".
- **ND-3** Remoção da opção "qualquer profissional" no fluxo público (DA-2). Suposição: o horário escolhido já
  identifica o profissional; filtro opcional por profissional dentro do passo.
- **ND-4** Nome do novo modelo de confirmação na Meta: sugestão, sem impacto no código além da variável existente.

## 12. Decisões do analista

- **DA-1 Data única.** Todos os itens na mesma data local (RN-3). Motivos: o exemplo do usuário é um dia; mantém
  sentido no limite de 3 futuras (D-027), na confirmação consolidada (uma `data`) e no cancelamento consolidado; fluxo
  público mais curto (escolhe a data uma vez).
- **DA-2 Fluxo público.** `serviços → data → por serviço (ordem escolhida): profissionais elegíveis com seus horários
  na mesma tela, filtro opcional por profissional → dados → confirmação`. A data lista os dias da janela; um dia é
  oferecido se cada serviço tem ao menos um horário livre nele (não garante combinação; o resumo permite alterar). Todo
  o estado na query (GET, sem JS), formato a cargo do arquiteto; parâmetro inválido volta ao passo anterior.
- **DA-3 Limite.** 1–10 serviços distintos por reserva (inalterado).
- **DA-4 Intervalo por item** (RN-5/RN-9), inclusive entre itens consecutivos do mesmo profissional.
- **DA-5 Sobreposição da cliente** só dentro da reserva, com `[inicio, fim)` dos itens não cancelados (RN-8).
- **DA-6 Status derivado** por prioridade confirmado > concluído > não compareceu > cancelado (RN-21).
- **DA-7 Avaliação** continua por reserva; convite quando o status derivado vira `concluido` (RN-33/RN-34): evita
  convidar a cliente no meio do dia, com serviços ainda por fazer, e não exige mudança de esquema na avaliação.
- **DA-8 Revisão** incrementa em remarcar item, cancelar item e cancelar todos (RN-28); necessário porque a chave
  `(reserva_id, tipo, revisao)` colidiria no segundo cancelamento parcial.
- **DA-9 Mensagem por item** com referência ao item; sem referência = reserva inteira (inclui as antigas) (RN-29).
- **DA-10 Confirmação** consolidada com parâmetros `salao`, `data`, `itens`, montada no envio com o estado atual e
  não substituída por eventos de item (RN-27/RN-31). Remarcação e cancelamento mantêm os modelos atuais (sem nova
  aprovação na Meta para eles).
- **DA-11 "Cancelar todos"** (RN-24): evita N mensagens de cancelamento quando a cliente desiste do agendamento
  inteiro.
- **DA-12 Remarcar item** troca hora, profissional e serviço do item; data só se for o único item não cancelado;
  acrescentar serviço a reserva existente fica fora (a equipe cria outra reserva). Substitui a remarcação D-030, que
  trocava a lista inteira de serviços.
- **DA-13 Total** = itens não cancelados (RN-35).
- **DA-14 Profissional** vê e opera só os próprios itens; nas mensagens, as sem item e as dos próprios itens
  (RN-36/RN-37).
- **DA-15 Agenda** com bloco por item; indicador de falha em todos os blocos da reserva; limite de 200 por itens.
- **DA-16 Migração** por `ordem` com `ocupado_ate` do último item = o da reserva (RN-39), abortando em inconsistência.
- **DA-17 Formulário da equipe** com data única e linhas de item adicionáveis/removíveis sem JS preservando o digitado.
- **DA-18 Encaixe** por item com uma confirmação para todos os itens listados (RN-17).
- **DA-19 Futuras** = reservas com item confirmado futuro (RN-18).
- **DA-20** Consentimentos continuam um registro por finalidade por reserva.
