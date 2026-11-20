# D-016 — Registrar bloqueios do profissional e do salão inteiro (issue #19, E2.4)

Fontes, por precedência: `docs/demandas/D-016/issue-19.md` (RN-1..RN-4 e CA-1..CA-4 decididos, não reabertos), `PLAN.md` ("Perfis e acesso", linhas 15-16; "Agenda e atendimento", linhas 33, 39-40; "Interface", linhas 106-107), `CLAUDE.md` (invariantes "Tenant isolation", "Time", "Soft deletes", "Subscriptions"; "UI conventions"; padrão de ações D-013..D-015), `docs/demandas/D-001/spec.md` (convenções G-1, G-2 e G-4, linhas 10-13; E2.4 em 687-713; E3.1 RN-3/CA-5 em 782/794; E3.3 em 840-857; E3.4 RN-2/CA-6 em 880/893; E6.4 CA-2 em 1308), `docs/demandas/D-015/spec.md` e `design.md` (padrão de página, travas, formatação) e o código citado abaixo.

## 1. Problema

Hoje a funcionalidade não existe.

- Não há página: `ls src/app/painel` mostra só `acoes.ts`, `_componentes`, `page.tsx`, `profissionais`, `servicos`. A rota `bloqueios: '/painel/bloqueios'` já existe (`src/config/navegacao.ts:32`) e já é item de navegação do gestor (`:71`) e do profissional (`:75`); hoje leva a 404.
- Não há `src/server/bloqueios/` nem repositório de bloqueio (`ls src/server/repos`: nenhum `bloqueio.ts`). A única escrita na tabela é a fábrica de teste (`tests/support/factories.ts:203-212`: um bloqueio do profissional, `instanteFuturo(8, 13)`–`instanteFuturo(8, 15)`, motivo "Curso").
- O que já existe e esta demanda reaproveita:
  - Esquema (`prisma/schema.prisma:318-333`): `bloqueio(id uuid, salao_id, profissional_id NULL = salão inteiro, inicio timestamptz, fim timestamptz, motivo text NULL, criado_em)`; FK composta `(salao_id, profissional_id)` → `profissional` (`ON DELETE RESTRICT`); índice `(salao_id, profissional_id)`. Comentário do esquema: "Removível (não é histórico protegido)". Não há `atualizado_em`.
  - Restrições SQL (`prisma/migrations/20261118000200_restricoes_sql/migration.sql:129-135`): `bloqueio_ordem_chk CHECK (fim > inicio)` e o índice GiST `bloqueio_periodo_idx (salao_id, tstzrange(inicio, fim, '[)'))`, pensado para a E3.1. **Não há** exclusion entre bloqueios (sobreposição é permitida pelo banco).
  - Permissões (`src/server/auth/permissoes.ts:41-42`): `'bloqueio_profissional.gerir'` = gestor `salao`, profissional `proprio`, super admin `negado`; `'bloqueio_salao.gerir'` = gestor `salao`, profissional e super admin `negado`. Não há operação de leitura separada.
  - Reservas: status `confirmado | cancelado | concluido | nao_compareceu` (`prisma/schema.prisma:42-49`); a exclusion de reservas considera ocupantes `confirmado`, `concluido`, `nao_compareceu` (`prisma/migrations/20261118000100_reserva_exclusion/migration.sql:38`). `src/server/repos/reserva.ts` tem `listarPorPeriodo` (por `inicio` em `[de, ate)`) e `listarBloqueantesDeDesativacao` (DTO com nome da cliente, `null` se anonimizada, telefone nunca lido; `src/server/repos/tipos.ts:71`), mas nada que liste reservas que **intersectam** um intervalo.
  - Fuso: `salao.fuso` (IANA, padrão `America/Sao_Paulo`) em `prisma/schema.prisma:128`; `src/lib/format.ts` exporta `formatarData`, `formatarHora`, `formatarDataHora` e `formatarDeslocamentoUtc` com fuso (linhas 173-194). **Não há** função de conversão de data/hora local do salão → instante UTC.
  - Padrão de ações (D-013..D-015): `src/server/<modulo>/<modulo>.acao.ts` só com exportações de `defineAcao({ papeis, capacidade })`, serviço em `servico.ts`, casca `src/app/**/acoes.ts` com `'use server'`; `politicaDeOperacao = permitirTudo` até a E6.4.

## 2. Objetivo

A equipe registra períodos em que não atende: o profissional, as próprias folgas e compromissos; o gestor, os de qualquer profissional e os do salão inteiro (feriado, reforma). Os períodos são informados no horário local do salão, gravados em UTC e listados de volta no horário local. Ao criar um bloqueio sobre reservas existentes, quem cria é avisado de quais reservas ficaram sob o bloqueio, sem que elas mudem. A E3.1 usa esses bloqueios para não oferecer horários.

## 3. Escopo

**Entra:**
- Página `/painel/bloqueios`: lista dos bloqueios vigentes e futuros visíveis ao usuário (RN-12) e formulário de criação; edição e remoção de cada bloqueio que o usuário pode gerir.
- Dois modos de entrada: **intervalo com horário** (data e hora de início, data e hora de fim) e **dia inteiro** (data inicial e data final, inclusivas).
- Ações de servidor: criar, editar e remover bloqueio; resposta de criação/edição com a lista de reservas cobertas (aviso).
- Conversão hora local do salão → UTC (com regra para horário de verão) e exibição de volta no fuso do salão.
- Função de leitura de bloqueios por período (do profissional e do salão), sem checagem de papel, para a E3.1 e a E3.3.
- Testes unitários (conversão, validação), de integração com PostgreSQL real (CA, permissões, isolamento G-4, aviso, concorrência) e E2E (teclado, axe, sem JS).

**Fica fora (com dono):**
- Efeito na disponibilidade pública: E3.1 (#27), CA-5 dela.
- Exibição dos bloqueios dentro da grade da agenda diária/semanal: E3.3 (#20). Nesta demanda, a "exibição" é a lista em `/painel/bloqueios`.
- Encaixe sobre bloqueio com aviso explícito: E3.4.
- Recusa real em salão suspenso: E6.4 (aqui só se declara `capacidade: 'configurar'`).
- Bloqueios recorrentes (toda segunda, todo ano), importação de feriados nacionais, histórico/auditoria de bloqueios removidos: não previstos no `PLAN.md`.
- Cancelar ou notificar reservas cobertas pelo bloqueio: não previsto (issue RN-2).
- Conferido contra "Fora da primeira versão" (`PLAN.md:131`): nada desta demanda toca caixa, estoque, comissões, relatórios, lembretes, mensagens promocionais etc.

## 4. Regras de negócio

- **RN-1** (issue RN-1; `CLAUDE.md` "Time"): bloqueio é um intervalo semiaberto `[inicio, fim)` de instantes UTC (`timestamptz`), informado em hora local do fuso do salão (`salao.fuso`) e exibido de volta nesse fuso. `profissional_id` nulo = bloqueio do salão inteiro (todos os profissionais).
- **RN-2** (issue RN-1; D-1): **dia inteiro** de D1 a D2 (inclusivas, `D1 ≤ D2`) é gravado como `[00:00 local de D1, 00:00 local de D2+1)`. O dia local pode ter 23 ou 25 h em fuso com horário de verão; a conversão é feita por data de calendário, não somando 24 h.
- **RN-3** (D-2): hora local inexistente (salto do horário de verão) é resolvida para o primeiro instante válido depois do salto (ex.: `America/Sao_Paulo` em 04/11/2018, 00:00 inexistente → 01:00 local = 03:00Z); hora local repetida (recuo) é resolvida para a **primeira** ocorrência (o deslocamento anterior ao recuo). A mesma função vale para início e fim, com horário e com dia inteiro.
- **RN-4** (D-3): no modo com horário, início e fim têm minutos múltiplos de 5 e segundos zero; o intervalo pode atravessar a meia-noite local e durar vários dias (ex.: 25/12 22:00 → 26/12 02:00).
- **RN-5** (`bloqueio_ordem_chk`; D-4): `fim > inicio` depois da conversão; validado no servidor antes de gravar (erro de campo), a CHECK do banco é a garantia final.
- **RN-6** (D-5): não se cria nem se edita bloqueio inteiramente no passado: exige `fim > agora`. O início pode estar no passado (ex.: bloquear "hoje, dia inteiro" às 10:30). Remover bloqueio passado é permitido (RN-10).
- **RN-7** (D-6): duração máxima de 366 dias (`fim − inicio ≤ 366 × 24 h`, medido em UTC; para dia inteiro, no máximo 366 datas) e início no máximo 2 anos à frente de agora.
- **RN-8** (issue RN-2; D-7): criar ou editar um bloqueio sobre reservas é permitido. A gravação acontece e a resposta inclui a lista das reservas cobertas: `status = 'confirmado'` e `[reserva.inicio, reserva.fim) && [bloqueio.inicio, bloqueio.fim)`, do mesmo salão; do profissional do bloqueio, ou de qualquer profissional se o bloqueio for do salão. Cada item traz id, profissional, início e fim no fuso do salão e o nome da cliente ("cliente removida" se anonimizada; telefone nunca lido nem exibido). As reservas não mudam (status, instantes, itens, `revisao`, `encaixe`) e nenhuma `mensagem` é enfileirada.
- **RN-9** (D-8): bloqueios podem se sobrepor entre si (mesmo profissional, ou profissional × salão), sem aviso e sem fusão; duplicatas idênticas são aceitas.
- **RN-10** (issue RN-3; `CLAUDE.md` "Soft deletes" vale só para profissionais e serviços): remover apaga a linha de `bloqueio` (DELETE físico), sem auditoria. Remover um bloqueio que não existe mais (ou de outro salão) dá `nao_encontrado` (404), sem efeito.
- **RN-11** (issue escopo, "CRUD"; D-9): editar altera só início, fim e motivo, com as mesmas validações e o mesmo aviso da criação. O nível (salão × profissional) e o profissional de um bloqueio não mudam na edição; para isso, remove-se e cria-se outro.
- **RN-12** (`PLAN.md:15-16`; `permissoes.ts:41-42`; issue CA-2):
  - gestor: cria, edita e remove bloqueios do salão e de qualquer profissional do próprio salão (inclusive do próprio perfil de profissional);
  - profissional: cria, edita e remove só os próprios; tentar fazê-lo em bloqueio de outro profissional do mesmo salão ou do salão inteiro dá `acesso_negado` (403), sem efeito; vê os bloqueios do salão inteiro em modo somente leitura (D-10) e não vê os de outros profissionais;
  - super admin: negado (403);
  - sem sessão: redireciona para `/entrar?proximo=` (páginas) ou 401 (ações); profissional com perfil inativo: 401 (`resolverTenant`, D-010).
- **RN-13** (`CLAUDE.md` "Tenant isolation"; G-4): toda leitura e escrita é filtrada pelo salão da sessão. Bloqueio ou profissional de outro salão, id inexistente ou malformado → `nao_encontrado` (404), sem efeito. `salaoId` e `profissionalId` extras no corpo não alteram o alvo além do que a regra permite; para o profissional, o alvo é sempre o próprio perfil.
- **RN-14** (D-11): o gestor pode criar, editar e remover bloqueio de profissional **inativo**; a lista indica que ele está inativo. Desativar ou reativar o profissional não altera os bloqueios.
- **RN-15** (D-12): `motivo` é opcional, texto aparado, até 200 caracteres; vazio ou só espaços grava `NULL`. É visível só à equipe (nunca na página pública).
- **RN-16** (D-13): mudar o fuso do salão (E2.5) **não** recalcula bloqueios: eles mantêm os instantes UTC e passam a ser exibidos no novo fuso. (Diferente da jornada, que é hora de parede, D-015 RN-10.)
- **RN-17** (issue RN-4; G-2): as ações criar, editar e remover declaram `capacidade: 'configurar'` e `papeis: ['gestor', 'profissional']`; o efeito em salão suspenso é verificado na E6.4. A leitura não é escrita.
- **RN-18** (D-14): a lista mostra os bloqueios com `fim > agora`, ordenados por `inicio` e depois `id`. Bloqueios encerrados não aparecem (sem paginação nesta demanda).
- **RN-19** (`PLAN.md` "Interface"; `CLAUDE.md` "UI conventions"): pt-BR; datas e horas formatadas só por `src/lib/format.ts`; um bloqueio de dia inteiro é exibido como datas (ex.: `25/12/2026 (dia inteiro)` ou `24/12/2026 a 26/12/2026`), os demais com data e hora nas duas pontas; utilizável só com teclado; formulários funcionam sem JavaScript, inclusive o aviso de reservas cobertas e a remoção.

## 5. Critérios de aceitação

Verificáveis por teste de integração com PostgreSQL real, salvo indicação. CA-1..CA-4 são os da issue. Correspondência no `PLAN.md`: critério 3 (horários bloqueados não aparecem: a parte de oferta é da E3.1) e critério 1/4 (isolamento e permissões).

- **CA-1** (issue CA-1; RN-12): Dado um profissional autenticado do salão A, quando cria um bloqueio na própria agenda (ex.: amanhã 14:00–16:00 local, motivo "Dentista"), então existe uma linha em `bloqueio` com `salao_id = A`, `profissional_id` = o próprio, os instantes UTC correspondentes e o motivo, e ela aparece na lista dele.
- **CA-2** (issue CA-2; RN-12): Dado um profissional autenticado, quando tenta criar, editar ou remover bloqueio de outro profissional do mesmo salão, ou criar/editar/remover bloqueio do salão inteiro, então recebe `acesso_negado` (403) e a tabela `bloqueio` fica idêntica. O super admin recebe 403 em todas as ações.
- **CA-3** (issue CA-3; RN-2): Dado um salão em `America/Sao_Paulo`, quando o gestor cria um bloqueio de salão de dia inteiro para 25/12/2026, então a linha tem `profissional_id NULL`, `inicio = 2026-12-25T03:00:00Z` e `fim = 2026-12-26T03:00:00Z`, e a lista exibe `25/12/2026 (dia inteiro)`. O efeito na disponibilidade é verificado na E3.1 (CA-5).
- **CA-4** (issue CA-4; RN-8): Dado uma reserva `confirmado` (fábrica) de um profissional, quando o gestor cria um bloqueio desse profissional (e, em outro caso, um bloqueio do salão) que a intersecta, então a resposta da ação contém a lista com o id da reserva, e a reserva continua `confirmado` com os mesmos `inicio`, `fim`, `ocupado_ate`, `revisao`, `encaixe` e itens; nenhuma linha nova em `mensagem`. Reservas `cancelado`, de outro profissional (no bloqueio de profissional) ou que só encostam no intervalo (fim da reserva = início do bloqueio) não aparecem na lista.
- **CA-5** (RN-1, RN-4, RN-19): Dado o salão em `America/Sao_Paulo`, quando o gestor cria um bloqueio de profissional de 25/12/2026 22:00 a 26/12/2026 02:00, então é gravado `[2026-12-26T01:00Z, 2026-12-26T05:00Z)` e exibido com data e hora nas duas pontas. Dado o salão em `America/Manaus`, um bloqueio 10:00–12:00 do mesmo dia é gravado `[14:00Z, 16:00Z)`.
- **CA-6** (RN-2, RN-3; unitário): a função de conversão produz: (a) `America/Sao_Paulo`, dia inteiro 25/12/2026 → `[03:00Z de 25/12, 03:00Z de 26/12)`; (b) `America/Sao_Paulo`, dia inteiro 04/11/2018 (início do horário de verão à meia-noite, dia de 23 h) → `[2018-11-04T03:00Z, 2018-11-05T02:00Z)`; (c) `America/Sao_Paulo`, dia inteiro 17/02/2018 (fim do horário de verão, dia de 25 h) → `[2018-02-17T02:00Z, 2018-02-18T03:00Z)`; (d) `America/New_York`, 08/03/2026 02:30 (inexistente) → `07:00Z` (03:00 EDT); (e) `America/New_York`, 01/11/2026 01:30 (repetida) → `05:30Z` (primeira ocorrência, EDT); (f) fuso inexistente ou vazio lança erro.
- **CA-7** (RN-5, RN-4, RN-2): Dado fim igual ou anterior ao início (com horário), ou data final anterior à inicial (dia inteiro), quando se tenta salvar, então o servidor recusa com erro de campo e nada é gravado. Horário com minutos fora do múltiplo de 5 (`14:07`), malformado (`9h`, `25:00`, `14:60`), data inexistente (`31/02`), campo obrigatório vazio ou modo desconhecido também são recusados com erro de campo.
- **CA-8** (RN-6): Dado `agora` fixo, quando se cria ou edita um bloqueio com `fim ≤ agora`, então é recusado; com `inicio < agora < fim` (ex.: hoje, dia inteiro), é aceito.
- **CA-9** (RN-7): Dado um bloqueio de 366 dias exatos (ou 366 datas no modo dia inteiro), então é aceito; com 1 minuto (ou 1 data) a mais, recusado. Início além de 2 anos à frente é recusado.
- **CA-10** (RN-9): Dado um bloqueio de Ana 14:00–16:00, quando o gestor cria outro de Ana 15:00–17:00 e um do salão no mesmo dia, então os três são gravados e listados separadamente.
- **CA-11** (RN-10): Dado um bloqueio existente, quando quem tem permissão o remove, então a linha deixa de existir; uma segunda remoção do mesmo id dá `nao_encontrado` (404) sem efeito. Remover um bloqueio já encerrado (fábrica com `fim` no passado) também funciona.
- **CA-12** (RN-11): Dado um bloqueio de Ana, quando o gestor o edita para outro intervalo e motivo, então o mesmo `id` passa a ter os novos `inicio`, `fim` e `motivo`, `profissional_id` não muda, e a resposta traz o aviso de reservas cobertas pelo novo intervalo. Um `profissionalId` diferente enviado na edição é ignorado (ou recusado), sem mudar o dono.
- **CA-13** (RN-13; G-4): Dado o gestor do salão A, quando cria bloqueio para um profissional de B, ou edita/remove um bloqueio de B, ou usa id inexistente ou malformado, então recebe `nao_encontrado` (404) e as linhas de `bloqueio` de B ficam idênticas. A lista de A nunca contém bloqueios de B, e o aviso de A nunca lista reservas de B (bloqueio de salão em A com reserva de B no mesmo horário).
- **CA-14** (RN-12, D-10): Dado um profissional Ana, quando abre `/painel/bloqueios`, então vê os próprios bloqueios (com editar e remover) e os do salão inteiro (sem editar nem remover), e não vê os de Bia. Dado o gestor, vê os do salão e de todos os profissionais, cada um identificado pelo nome do profissional ou "Salão inteiro". O gestor com perfil de profissional cria bloqueio para o próprio perfil.
- **CA-15** (RN-14): Dado um profissional inativo, quando o gestor cria, edita ou remove bloqueio dele, então é aceito, e a lista o marca como inativo. Desativar e reativar o profissional não altera as linhas de `bloqueio`.
- **CA-16** (RN-15): motivo `"  Feriado  "` grava `Feriado`; vazio grava `NULL`; 201 caracteres é recusado com erro de campo.
- **CA-17** (RN-16): Dado um bloqueio criado com o salão em `America/Sao_Paulo` (14:00–16:00 local), quando o fuso do salão muda para `America/Manaus` (direto no banco, pois E2.5 não existe), então os instantes gravados não mudam e a lista exibe 13:00–15:00.
- **CA-18** (RN-18): Dado bloqueios encerrados, em andamento e futuros, quando a lista é aberta, então aparecem só os em andamento e futuros, ordenados por início.
- **CA-19** (RN-17; teste de registro de ações): as ações de criar, editar e remover bloqueio estão registradas com `{ papeis: ['gestor', 'profissional'], capacidade: 'configurar' }`.
- **CA-20** (concorrência): Dado duas remoções simultâneas do mesmo bloqueio (`Promise.all`, laço ×10), então uma remove e a outra dá `nao_encontrado`, sem 5xx. Dado a criação de um bloqueio de um profissional concorrente com a desativação desse profissional (D-013), então ambas terminam sem 5xx nem impasse. Dado edição × remoção simultâneas do mesmo bloqueio, então o resultado é a linha removida ou editada de forma consistente, sem 5xx.
- **CA-21** (RN-19; E2E Playwright, viewport 375×812): o profissional cria um bloqueio e o gestor cria um bloqueio de salão de dia inteiro e remove um bloqueio, só com teclado (Tab/Shift+Tab/Enter/Espaço; foco visível; erros associados por `aria-describedby`; foco levado ao resumo de erros ou ao aviso de reservas cobertas), e as telas (lista, formulário, erro, aviso) têm zero violações do axe 4.14.0.
- **CA-22** (RN-19; E2E com JavaScript desligado): o gestor cria um bloqueio com horário e um de dia inteiro, vê erros de validação, vê o aviso de reservas cobertas após salvar e remove um bloqueio; o profissional cria e remove o próprio.
- **CA-23** (RN-19; unitário): os textos de data/hora da lista e do aviso vêm de `src/lib/format.ts` (`format.fonte-unica.test.ts` continua verde); se for criado formatador de intervalo de bloqueio, ele tem testes para dia inteiro único, vários dias inteiros e intervalo com horário que atravessa a meia-noite.

## 6. Casos limite

- **Fuso e virada de dia:** dia inteiro vai de 00:00 local a 00:00 local do dia seguinte (CA-3); intervalo com horário pode cruzar a meia-noite (CA-5). Um bloqueio com horário que coincide com dias inteiros (00:00 → 00:00) pode ser exibido como dia inteiro; é indiferente para o banco.
- **Horário de verão:** o Brasil não tem DST hoje, mas o fuso é configurável e o tzdata tem o histórico de `America/Sao_Paulo`. Hora inexistente/repetida segue a RN-3 (CA-6). O cálculo de duração máxima é em UTC.
- **Mudança de fuso:** RN-16, CA-17.
- **Passado e presente:** RN-6, CA-8; o "agora" deve ser injetável para teste.
- **Concorrência:** CA-20. A criação de bloqueio de profissional toma `FOR KEY SHARE` na linha do profissional (FK), o que serializa com a desativação (`FOR UPDATE`, D-013) sem bloquear reservas. Bloqueio × reserva simultâneos: não há garantia entre eles nem é preciso (encaixe sobre bloqueio é permitido, E3.4); o aviso reflete o estado visto na transação da gravação.
- **Isolamento:** CA-13, inclusive no aviso de bloqueio de salão.
- **Salão suspenso:** escrita declara `configurar`; o efeito é da E6.4 (D-001 E6.4 CA-2 inclui "bloqueio" na lista de recusas). A leitura segue liberada.
- **Cliente anonimizada:** no aviso, aparece como "cliente removida"; o telefone nunca é lido.
- **Profissional inativo:** RN-14, CA-15. No formulário do gestor, a escolha de profissional lista ativos e inativos (inativos identificados).
- **Entradas inválidas:** CA-7, CA-9, CA-16; também: alvo ausente para o gestor (nem "salão" nem profissional), profissional de outro salão (404), id malformado (404), campos de modo misturados (horas enviadas no modo dia inteiro são ignoradas).
- **Permissões por perfil:** RN-12, CA-2, CA-14; super admin 403; sem sessão, redirecionamento.
- **Reservas sob o bloqueio:** permanecem (RN-8, CA-4); `concluido`/`nao_compareceu` não entram no aviso (D-7).
- **Duplo envio do formulário sem JS:** pode criar dois bloqueios idênticos; aceitável pela RN-9 (removível).

## 7. Dependências

- **Demandas:** E2.2/D-013 (profissionais, concluída). Bloqueia E3.1 (#27) e E3.3 (#20). E2.5 (troca de fuso) é independente (CA-17 altera o fuso direto no banco).
- **Integrações:** nenhuma (Mercado Pago, WhatsApp, e-mail e Turnstile não participam).
- **Dados:** tabela `bloqueio`, `bloqueio_ordem_chk` e `bloqueio_periodo_idx` da D-004, já existentes; tzdata do runtime Node (`Intl`) para a conversão.
- **Obrigações para a E3.1/E3.3:** ler bloqueios pela função de leitura desta demanda (por salão e período, incluindo os do salão inteiro); intersecção semiaberta `[inicio, fim)`.

## 8. Impactos prováveis

- **Dados:** provavelmente nenhuma migração. Pontos para o arquiteto/DBA: (a) a consulta do aviso precisa de intersecção de intervalos em `reserva` (`tstzrange(inicio, fim) &&`), ainda inexistente em `repos/reserva.ts`; avaliar se os índices atuais bastam; (b) a lista por `fim > agora` usa `bloqueio_periodo_idx` ou o índice `(salao_id, profissional_id)`; (c) se a CHECK de motivo ≤ 200 fica só no servidor (sugestão: só no servidor).
- **Código novo:** `src/server/bloqueios/*` (validação, conversão, serviço, ações), `src/server/repos/bloqueio.ts` (único lugar com Prisma), função de conversão local → UTC (local a definir pelo arquiteto: `src/lib/` ou `src/server/bloqueios/`; `format.ts` é só exibição), página `src/app/painel/bloqueios/**`.
- **Permissões:** a matriz atual basta; a leitura usa `'bloqueio_profissional.gerir'` (profissional `proprio`) para os próprios e mostra os do salão somente leitura (D-10). Nenhuma operação nova prevista.
- **Infraestrutura/CI:** nenhum; os novos E2E entram no job `e2e`. DevOps dispensável.
- **README:** sem mudança obrigatória (nenhuma variável nova).

## 9. Dúvidas

### Bloqueantes

Nenhuma.

### Não bloqueantes (suposições adotadas)

- **D-1** (RN-2): dia inteiro aceita intervalo de datas (D1 a D2, inclusivas), para férias e reformas de vários dias.
- **D-2** (RN-3): hora inexistente avança para o primeiro instante válido; hora repetida usa a primeira ocorrência. É a regra mais previsível e cobre `America/Sao_Paulo` histórico.
- **D-3** (RN-4): granularidade de 5 minutos, como jornada (D-015 D-1) e duração dos serviços (D-014), independente da grade do salão.
- **D-4** (RN-5): fim igual ao início é recusado (intervalo vazio).
- **D-5** (RN-6): recusa bloqueio inteiramente no passado; aceita início no passado se o fim for futuro.
- **D-6** (RN-7): limite de 366 dias de duração e início até 2 anos à frente, para evitar erros de digitação (ano errado) sem atrapalhar reformas longas.
- **D-7** (RN-8): o aviso é **posterior** à gravação (a issue CA-4 fala em "resposta da ação"), não uma confirmação prévia; lista só reservas `confirmado` (as `concluido`/`nao_compareceu` são passado consumado), pelo intervalo de atendimento `[inicio, fim)`, sem `ocupado_ate`, coerente com a E3.1 RN-3.
- **D-8** (RN-9): sobreposição entre bloqueios é permitida sem aviso: não causa dano e o banco não a proíbe.
- **D-9** (RN-11): o "CRUD" da issue inclui edição de início, fim e motivo; nível e dono são imutáveis.
- **D-10** (RN-12): o profissional vê os bloqueios do salão inteiro somente leitura, pois afetam a agenda dele; não vê os de colegas.
- **D-11** (RN-14): bloqueio de profissional inativo é gerível, como a jornada (D-015 D-5).
- **D-12** (RN-15): motivo até 200 caracteres.
- **D-13** (RN-16): bloqueios guardam instantes; trocar o fuso muda só a exibição.
- **D-14** (RN-18): a lista omite bloqueios encerrados e não tem paginação; consulta de histórico de bloqueios não é pedida pelo `PLAN.md`.
