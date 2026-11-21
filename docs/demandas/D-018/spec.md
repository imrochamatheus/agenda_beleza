# D-018 — Especificação: calcular horários disponíveis para um ou mais serviços em sequência (issue #27, E3.1)

Fontes, por precedência: `docs/demandas/D-018/issue-27.md` (RN-1..RN-6 e CA-1..CA-9 decididos, não reabertos; comentários com obrigações herdadas de D-014, D-015 e D-016), `PLAN.md` ("Agenda e atendimento" `:34-41`; "Fora da primeira versão" `:131`; critérios de aceite 2 e 3), `CLAUDE.md` (invariantes "Time", "Multi-service bookings", "No double booking", "Tenant isolation"), `docs/demandas/D-001/spec.md` (S1 `:74`, S5 `:78`; item E3.1 `:764`), `docs/demandas/D-001/dev.md:33,80` (ajustes do CA-3 e da RN-3 já incorporados na issue), `docs/demandas/D-001/dba.md:78-84,168` (consulta de ocupação), `docs/demandas/D-001/testes.md:41` (DEF-A10), specs de D-014 (RN-7, D-3), D-015 (RN-3..RN-5, RN-8, RN-10, RN-13, RN-15), D-016 (RN-1..RN-3, RN-16, D-7), D-017 (RN-5, RN-10, RN-16, RN-17) e o código citado.

Adições desta especificação à issue: RNs complementares (RN-7 em diante), CAs complementares (CA-10 em diante), refinamentos de redação de CAs da issue sem mudar o sentido (CA-7) e decisões não bloqueantes D-n (§9) para o arquiteto confirmar.

## 1. Problema

Hoje a funcionalidade é **inexistente**. Evidências:

- Não existe `src/domain/` (`ls src/domain` → "Arquivo ou diretório inexistente") nem `src/server/disponibilidade/`. Nenhum código calcula horários oferecíveis.
- Peças prontas que esta demanda consome:
  - `src/server/tempo/fuso.ts`: `instanteDeHoraLocal(data, minutosDoDia 0..1439, fuso)` (hora inexistente → instante da transição; repetida → primeira ocorrência), `partesLocais`, `somarDias`, `diferencaEmDias`, `compararDatas`, `ehDataCivilValida`, `validarFuso`. Aceita só minutos 0..1439 (`:156-158`): o fim de jornada `1440` precisa ser convertido como 00:00 do dia seguinte.
  - `src/server/jornadas/leitura.ts:19` `lerSemana(ctx: ContextoEscopado, profissionalId)`: jornada em forma canônica (D-015 RN-5), hora de parede, 0 = domingo. Uma consulta por profissional.
  - `src/server/bloqueios/leitura.ts:19` `lerBloqueios(ctx: ContextoEscopado, periodo, { profissionalId? })`: bloqueios do profissional **mais** os do salão (`profissional_id IS NULL`), intersecção semiaberta (`src/server/repos/bloqueio.ts:214,222-223`), usa o predicado `tstzrange(inicio, fim, '[)') && …` compatível com `bloqueio_periodo_idx` (`prisma/migrations/20261118000200_restricoes_sql/migration.sql:134-135`).
  - `src/server/repos/publico.ts:53` `listarServicosPublicos(ctx: PublicoContext)`: serviços ativos com ao menos um profissional ativo vinculado (D-014 RN-7), "a ÚNICA leitura de serviços ofertáveis para E3.1" (`:49-51`). Recebe `PublicoContext`, enquanto `lerSemana`/`lerBloqueios` recebem `ContextoEscopado` (`TenantContext | SistemaContext`, `src/server/tenant/context.ts:54`).
- (Revisão D-020) O horário de funcionamento já está em `main`: `src/server/salao/funcionamento-leitura.ts:22` `lerFuncionamento(ctx)` devolve `{ definido: false }` ou `{ definido: true, semana }` (7 dias, índice = `diaSemana`, 0 = domingo, dia sem intervalos = fechado, intervalos canônicos de hora de parede); `COLUNAS_FUNCIONAMENTO` (`src/server/repos/funcionamento.ts:54`) é o fragmento SQL de leitura em um único comando, já reutilizado por `repos/publico.ts:144,169`.
- Esquema relevante (`prisma/schema.prisma`): `salao` (`fuso`, `grade_min` 15, `antecedencia_min` 120 **em minutos**, `janela_dias` 60, `intervalo_min` 0; `:125-133`), `servico_profissional` (`:285-298`), `jornada` (`:302-316`; `CHECK 0 <= inicio_min < fim_min <= 1440`, migração `20261118000200`, `:100`), `bloqueio` (`:319-333`), `reserva` (`inicio`, `fim`, `ocupado_ate`, `status`, `encaixe`; `:381-414`).
- Constraint de não sobreposição (`prisma/migrations/20261118000100_reserva_exclusion/migration.sql:32-37`):
  `EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, ocupado_ate, '[)') WITH &&) WHERE (status IN ('confirmado', 'concluido', 'nao_compareceu'))`, e `reserva_ordem_chk`: `fim > inicio AND ocupado_ate >= fim`.
- Precedente de consulta casada com o índice parcial: `consultaReservasQueCruzam` (`src/server/repos/reserva.ts`, comentário sobre manter o literal de status e o predicado `tstzrange(r.inicio, r.ocupado_ate, '[)') && …` no texto para o planejador usar `reserva_sem_sobreposicao`), e o teste de plano em `tests/integration/bloqueios/repos.test.ts:340`.
- Conversões verificadas com `fuso.ts` (Node 24, script no scratchpad, somente leitura): `America/Sao_Paulo`, 01/12/2026 09:00 → `2026-12-01T12:00:00Z`; `America/New_York`, 08/03/2026 (salto): 00:00 → 05:00Z, 02:00 e 02:15 (inexistentes) → 07:00Z (= 03:00 local), 04:00 → 08:00Z; 01/11/2026 (recuo): 01:00 → 05:00Z (1ª ocorrência), 01:45 → 05:45Z, 02:00 → 07:00Z, 04:00 → 09:00Z.

## 2. Objetivo

Dada uma combinação de serviços escolhida pela cliente (ou pela equipe), o sistema sabe quais profissionais podem executar **todos** eles e, para cada profissional elegível, quais inícios cabem inteiros, em sequência, na jornada, fora de bloqueios e sem sobrepor reservas ativas, respeitando grade, antecedência, janela e intervalo do salão, no fuso do salão. É a base da página pública (E4.1) e da revalidação na criação da reserva (E3.2).

## 3. Escopo

Entra:
- **Função de domínio pura** (sem banco, sem `Date.now()`, sem `next/*`): dado o relógio (`agora`), as regras do salão (fuso, grade, antecedência, janela, intervalo), a duração total, as datas civis pedidas e, por profissional, jornada semanal, bloqueios e ocupações `[inicio, ocupado_ate)`, devolve os inícios válidos.
- **Leitura no servidor** (`src/server/disponibilidade/**`): elegibilidade de profissionais para uma lista de serviços; carga de jornadas, bloqueios e ocupações do período com número de consultas constante; montagem da entrada da função pura; resultado com duração e preço totais.
- Testes unitários da função pura (relógio controlado, DST em `America/New_York`) e de integração com PostgreSQL real; evidência `EXPLAIN (ANALYZE)` da consulta de ocupação.

Fica fora:
- Criação de reserva, idempotência e tratamento de corrida (E3.2). Esta demanda é só leitura; o resultado pode ficar desatualizado e a constraint do banco é a garantia final.
- Página pública, rotas HTTP, ações `defineAcao` e qualquer UI (E4.1). Esta demanda não expõe endpoint.
- Encaixe da equipe, que ignora jornada e bloqueio (E3.4); regra "equipe não cria no passado" (S5, E3.4).
- Bloqueio por estado do salão (suspenso, encerrado, pendente): E6.4 (fora do escopo da issue). O cálculo ignora o estado da assinatura.
- Rate limit, captcha e limite de reservas por número (E4.2).
- Atribuição automática de profissional ("qualquer profissional"): não existe no `PLAN.md` (`:34`: a cliente escolhe **um** profissional). Ver D-3.

Confronto com "Fora da primeira versão" (`PLAN.md:131`): nada aqui cria caixa, comissão, conta de cliente, lembretes ou preço/duração por profissional. A duração e o preço vêm do serviço (iguais para todos os profissionais).

## 4. Regras de negócio

Da issue (decididas, refinadas na redação):

- **RN-1** (issue RN-1; `PLAN.md:34`; D-014 obrigação): profissionais elegíveis = `profissional.ativo = true` do salão **e** vinculados (`servico_profissional`) a **todos** os serviços escolhidos, que devem estar todos entre os ofertáveis de `listarServicosPublicos` (ativos e com ao menos um profissional ativo). Ordem da lista: nome, depois id.
- **RN-2** (issue RN-2; `CLAUDE.md` "Multi-service bookings"): duração total = soma de `duracao_min`; preço total = soma de `preco_centavos`, ambos com os valores **vigentes** no momento da consulta. O snapshot é gravado só na E3.2.
- **RN-3** (issue RN-3; D-001 `dev.md:80`): um início `i` com fim `f = i + duração total` (tempo decorrido real, em UTC) é válido para o profissional P se, e somente se:
  - (a) `[i, f)` está inteiramente contido em **um único** intervalo de jornada de P daquela data local, convertido em instantes (RN-9), **e, quando o salão tem funcionamento informado, num único intervalo de jornada ∩ funcionamento (RN-20, RN-21)**;
  - (b) `[i, f)` não intersecta `[b.inicio, b.fim)` de nenhum bloqueio de P nem do salão (encostar não bloqueia);
  - (c) `[i, f + intervalo vigente)` não intersecta `[r.inicio, r.ocupado_ate)` de nenhuma reserva de P com `status IN ('confirmado','concluido','nao_compareceu')` (mesma expressão e predicado da constraint, S1). O intervalo **não** precisa caber na jornada nem fora de bloqueios.
- **RN-4** (issue RN-4): os inícios oferecidos são horas de parede cujo minuto do dia local é múltiplo de `grade_min`, contado a partir de 00:00 local (não a partir do início da jornada). Ex.: jornada 09:05–12:00 com grade 15 → primeiro início 09:15.
- **RN-5** (issue RN-5; D-017 RN-10 "antecedência em minutos"): `i ≥ agora + antecedencia_min` (comparação de instantes); e a data local de `i` ≤ `hoje local + janela_dias`, onde `hoje local = partesLocais(agora, fuso).data`. Ou seja, as datas de `hoje` a `hoje + janela_dias` (inclusive) podem ter horários.
- **RN-6** (issue RN-6; `CLAUDE.md` "Time"): o cálculo é feito no fuso do salão (`salao.fuso`, valor vigente). As saídas trazem o instante UTC (`Date`) de início e de fim e as partes locais estruturadas (data civil e minutos do dia, de `partesLocais`); nenhum texto formatado (formatação só em `src/lib/format.ts`, D-009).

Complementares:

- **RN-7** (D-001 S1; `CLAUDE.md` "No double booking"): ocupam o horário todas as reservas ativas do profissional, inclusive encaixes (`encaixe = true`), reservas fora da jornada atual, de cliente anonimizada e de serviços hoje inativos. Só `cancelado` libera. A ocupação usa o `ocupado_ate` gravado (snapshot), nunca recalcula com o intervalo vigente.
- **RN-8** (D-015 RN-8, RN-13): dia sem intervalo de jornada é folga (sem horários). Profissional inativo não é elegível, ainda que tenha jornada.
- **RN-9** (obrigação D-015/D-016; D-016 RN-3): a jornada é hora de parede (`dia_semana` 0 = domingo, o mesmo de `Date#getDay` sobre a data civil). Para a data local `d`, cada intervalo `[ini_min, fim_min)` vira `[instanteDeHoraLocal(d, ini_min), X)`, com `X = instanteDeHoraLocal(d, fim_min)` se `fim_min < 1440`, ou `instanteDeHoraLocal(d + 1, 0)` se `fim_min = 1440`. A conversão é **só** por `src/server/tempo/fuso.ts` (sem segunda implementação).
- **RN-10** (D-2): candidato em horário de verão. Para cada minuto de parede `m` múltiplo da grade, o instante é `instanteDeHoraLocal(d, m)`. O candidato é descartado se `partesLocais(instante).minutosDoDia ≠ m` (hora inexistente no salto); na hora repetida (recuo) vale só a primeira ocorrência. Não há dois inícios com o mesmo rótulo local nem com o mesmo instante para o mesmo profissional.
- **RN-11** (D-015 RN-3): a jornada não atravessa a meia-noite. Um atendimento que começaria num intervalo e terminaria depois do fim dele não é oferecido, ainda que o dia seguinte tenha jornada a partir de 00:00 (não se une `22:00–24:00` de um dia com `00:00–02:00` do seguinte). Um início sempre pertence à data local pedida.
- **RN-12** (D-017 RN-16; D-016 RN-16): após troca de fuso, a jornada vale com os mesmos minutos de parede no novo fuso; bloqueios e reservas mantêm os instantes UTC.
- **RN-13** (D-017 RN-5, RN-17): grade, antecedência, janela, intervalo e fuso são lidos do salão a cada consulta (valores vigentes). Reservas existentes não são reinterpretadas.
- **RN-14** (`CLAUDE.md` "Tenant isolation"): toda leitura é escopada pelo salão do contexto. Serviço, profissional, jornada, bloqueio ou reserva de outro salão nunca entra no cálculo; ids de outro salão se comportam como inexistentes, sem revelar que existem.
- **RN-15** (D-1, D-4): entrada da consulta: salão (pelo contexto), lista de ids de serviço (1 a 10, sem repetição), profissional opcional e um período de datas civis `[d1, d2]` (inclusive; uma data é `d1 = d2`) com no máximo `janela_dias + 1` datas. Datas fora de `[hoje, hoje + janela_dias]` produzem listas vazias (não erro). Datas civis inválidas, `d2 < d1`, lista de serviços vazia, com repetição ou com mais de 10 itens → erro de validação, sem consulta à reserva.
- **RN-16** (D-5): serviço da lista que não seja ofertável (inexistente, malformado, de outro salão, inativo ou sem profissional ativo) → erro de domínio "serviço indisponível", sem horários. Profissional informado malformado, inexistente ou de outro salão → `NaoEncontrado`; profissional do salão inativo ou não vinculado a todos os serviços → resultado vazio (não é erro).
- **RN-17** (D-3): sem profissional informado, o resultado traz, para cada profissional elegível (ordem da RN-1), seus inícios. Com profissional informado, só os dele. Dentro de cada profissional, inícios em ordem crescente de instante.
- **RN-18** (D-6): determinismo. `agora` é parâmetro obrigatório da função pura e do serviço (relógio injetado); mesma entrada → mesma saída, inclusive a ordem.
- **RN-19** (D-7; `dba.md:78-84`): a consulta de ocupação repete **exatamente** a expressão `tstzrange(inicio, ocupado_ate, '[)')` e o predicado de status literal da constraint, e o número de consultas SQL por chamada é constante, independente do número de datas e de profissionais.

## 5. Critérios de aceitação

Unidade = Vitest em `src/**/*.test.ts` sobre a função pura, com relógio fixo (o projeto `unit` só inclui `src/**`, `vitest.config.ts:46`; a pasta `tests/unit/availability/` citada na issue não é coletada, ver D-9). Integração = `tests/integration/disponibilidade/**` com PostgreSQL real e fábricas de dois salões. Salvo indicação: salão em `America/Sao_Paulo`, grade 15, antecedência 2 h, janela 60, intervalo 0, data consultada futura e dentro da janela, `agora` fixo bem antes dela. Correspondência no `PLAN.md`: critério 2 (CA-1, CA-2, CA-10, CA-11) e critério 3 (os demais).

Da issue:

- **CA-1** (RN-1; integração): Dado serviços A (30 min) e B (45 min), Ana ativa vinculada a A e B e Bia ativa vinculada só a A, quando se listam os profissionais elegíveis para A+B, então só Ana aparece; para A, aparecem Ana e Bia, nessa ordem de nome.
- **CA-2** (RN-3a, RN-4; unidade): Dado Ana com jornada 09:00–12:00, grade 15, intervalo 0, sem reservas, quando se pede A+B (75 min), então os inícios oferecidos são 09:00, 09:15, …, 10:45 (8 inícios) e o último é 10:45.
- **CA-3** (RN-3c, RN-7; unidade e integração): Dado intervalo vigente 15 e uma reserva confirmada de Ana 10:00–10:30 com `ocupado_ate` 10:45, jornada 09:00–12:00, quando se pede A (30 min), então 09:30 e 10:30 não são oferecidos e 09:15 e 10:45 são; dado intervalo vigente 0 e a reserva com `ocupado_ate` 10:30, então 09:30 e 10:30 são oferecidos.
- **CA-4** (RN-3a; unidade): Dado jornada 09:00–12:00 e 13:00–18:00 (pausa 12:00–13:00), quando se pede um serviço de 60 min, então 11:30 e 12:15 não são oferecidos e 11:00 e 13:00 são.
- **CA-5** (RN-3b; integração; D-016 CA-3): Dado um bloqueio de salão de dia inteiro em 25/12 (`[25/12 03:00Z, 26/12 03:00Z)`) e Ana com jornada nesse dia, quando se consulta 25/12, então não há horários para nenhum profissional; 24/12 e 26/12 têm horários.
- **CA-6** (RN-5; unidade): Dado `agora` = 08:00 local de hoje, antecedência 2 h e jornada 08:00–18:00, quando se consulta hoje, então o primeiro início é 10:00; com `agora` = 08:07, o primeiro é 10:15.
- **CA-7** (RN-5; unidade; refinamento: "61º dia" = `hoje + 61`, contando hoje como dia 0, ver D-8): Dado janela de 60 dias e jornada todos os dias, quando se consulta `hoje + 60`, então há horários (inclusive 23:45 se a jornada cobrir); quando se consulta `hoje + 61`, então não há horários.
- **CA-8** (RN-6, RN-9; unidade): Dado fuso `America/Sao_Paulo` e jornada a partir de 09:00 em 01/12/2026, quando o cálculo é feito, então o primeiro início retornado é `2026-12-01T12:00:00Z`, com partes locais `{data: 2026-12-01, minutosDoDia: 540}`.
- **CA-9** (RN-4, RN-13; integração): Dado o salão com `grade_min` alterada de 15 para 30 e jornada 09:05–12:00, quando se consulta a disponibilidade, então todos os inícios têm minutos do dia local múltiplos de 30 e o primeiro é 09:30.

Complementares:

- **CA-10** (RN-3, multi-serviço; unidade): Dado A (30) + B (45) e uma reserva de Ana 10:30–11:00 (`ocupado_ate` 11:00), jornada 09:00–12:00, quando se pede A+B, então 09:15 (fim 10:30) é oferecido, 09:30 (fim 10:45) não é, e 11:00 não é (fim 12:15 após a jornada).
- **CA-11** (RN-2, RN-16, RN-1; integração): Dado A (R$ 50,00, 30 min) e B (R$ 80,00, 45 min), quando se consulta A+B, então o resultado informa duração total 75 e preço total 13000 centavos; dado B desativado, a consulta A+B falha com "serviço indisponível" e não retorna horários; dado Ana desativada, ela não aparece entre os elegíveis e a consulta com `profissionalId` = Ana retorna lista vazia.
- **CA-12** (RN-7; integração): Dado Ana com jornada 09:00–14:00, intervalo 0 e reservas (cada uma com `ocupado_ate = fim`) `cancelado` 09:00–10:00, `concluido` 10:00–11:00, `nao_compareceu` 11:00–12:00, `confirmado` com `encaixe = true` 12:00–13:00 e `confirmado` de cliente anonimizada 13:00–14:00, quando se pede um serviço de 60 min, então o único início oferecido é 09:00.
- **CA-13** (RN-3b; unidade): Dado um bloqueio de Ana 10:00–11:00 e um bloqueio de Bia no mesmo horário, jornada 09:00–12:00, serviço de 30 min, quando se consulta Ana, então 09:30 (fim 10:00, encosta) e 11:00 são oferecidos e 09:45, 10:00 e 10:30 não; o bloqueio de Bia não afeta Ana.
- **CA-14** (RN-3c; unidade): Dado intervalo vigente 15, jornada 09:00–10:00, sem reservas, serviço de 60 min, quando se consulta, então 09:00 é oferecido (o intervalo não precisa caber na jornada); dado um bloqueio 10:00–10:15, 09:00 continua oferecido.
- **CA-15** (RN-5; unidade): Dado `agora` = 23:00 local de D, antecedência 2 h, jornada 00:00–04:00 em D+1 e 20:00–24:00 em D, quando se consultam D e D+1, então D não tem horários e o primeiro de D+1 é 01:00.
- **CA-16** (RN-9, RN-11; unidade): Dado jornada 22:00–24:00 em D e 00:00–02:00 em D+1, serviço de 60 min, quando se consulta D, então o último início é 23:00 (fim às 00:00 local de D+1, instante `instanteDeHoraLocal(D+1, 0)`) e 23:15 não é oferecido.
- **CA-17** (RN-10; unidade, DST salto): Dado fuso `America/New_York`, 08/03/2026, jornada 00:00–04:00, grade 15, serviço de 60 min, `agora` muito anterior, quando se consulta, então os inícios são exatamente 00:00, 00:15, 00:30, 00:45, 01:00, 01:15, 01:30, 01:45 e 03:00 (locais), isto é, 05:00Z … 06:45Z e 07:00Z; nenhum início tem rótulo 02:xx; 01:45 (06:45Z) tem fim 07:45Z (03:45 local).
- **CA-18** (RN-10; unidade, DST recuo): Dado fuso `America/New_York`, 01/11/2026, jornada 00:00–04:00 (`[04:00Z, 09:00Z)`), grade 15, serviço de 60 min, quando se consulta, então são oferecidos 13 inícios, rótulos 00:00 a 03:00 de 15 em 15, com 01:00 → 05:00Z e 02:00 → 07:00Z; nenhum início em 06:00Z–06:45Z; não há rótulos duplicados.
- **CA-19** (RN-12; integração): Dado jornada de Ana 09:00–12:00 e um bloqueio de Ana `[12:00Z, 13:00Z)` criados com o salão em `America/Sao_Paulo`, quando o fuso muda para `America/Manaus` (UTC−4) e se consulta, então o primeiro início é 09:00 local = 13:00Z (o bloqueio, agora 08:00–09:00 local, não afeta) e o rótulo de 13:00Z é 09:00.
- **CA-20** (RN-14; integração): Dado salões S1 e S2 com fábricas equivalentes, uma reserva confirmada e um bloqueio de salão de dia inteiro em S2, quando se consulta S1, então o resultado de S1 é igual ao obtido sem os dados de S2; consultar S1 com id de serviço de S2 falha com "serviço indisponível" e com `profissionalId` de S2 falha com `NaoEncontrado`.
- **CA-21** (RN-15, RN-16; unidade e integração): Dado entradas inválidas (lista de serviços vazia, serviço repetido, 11 serviços, data 31/02, `d2 < d1`, período com mais de `janela_dias + 1` datas), quando se consulta, então há erro de validação e nenhuma consulta a `reserva`; dado uma data no passado ou depois de `hoje + janela_dias`, então a lista daquela data é vazia, sem erro.
- **CA-22** (RN-8; unidade): Dado profissional elegível sem nenhum intervalo de jornada no dia da semana consultado, quando se consulta, então ele aparece no resultado com lista vazia para essa data.
- **CA-23** (RN-17; integração): Dado A com Ana e Bia elegíveis, quando se consulta sem profissional, então o resultado tem uma entrada por profissional elegível, na ordem nome/id, cada uma com seus inícios; com `profissionalId` = Bia, só a entrada de Bia.
- **CA-24** (RN-18; unidade): Dado a mesma entrada (incluindo `agora`) avaliada duas vezes e com os bloqueios e reservas da entrada em ordem embaralhada, quando se calcula, então as saídas são idênticas (`toEqual`), e o módulo de domínio não chama `Date.now()`/`new Date()` sem argumento (verificável por teste com `vi.useFakeTimers` em data distinta de `agora`, que não altera o resultado).
- **CA-25** (RN-19; integração, desempenho): Dado 2 salões × 10 profissionais × 5.000 reservas por profissional (fábrica; `testes.md:41`), quando se roda `EXPLAIN (ANALYZE)` da consulta de ocupação do serviço, então o plano usa `reserva_sem_sobreposicao` (ou outro índice) e não contém `Seq Scan` em `reserva`; o plano é anexado como evidência (`dev.md`/`testes.md` da demanda e comentário na issue).
- **CA-26** (RN-19; integração): Dado uma consulta de 1 profissional × 1 data e outra de 10 profissionais × 61 datas, quando se contam as consultas SQL emitidas (instrumentação definida pelo arquiteto), então as duas emitem o mesmo número de consultas.
- **CA-27** (desempenho da função pura; unidade): Dado 10 profissionais, 61 datas, grade 5, jornada 00:00–24:00 todos os dias e 500 ocupações por profissional, quando se calcula, então o tempo de parede é < 2 s (limite generoso, anti-regressão de complexidade quadrática; registrar o tempo medido local na evidência).

## 6. Casos limite

- **Fuso e virada de dia:** atendimento que terminaria após o fim do intervalo de jornada não é oferecido (CA-2, CA-16); fim de jornada 24:00 = 00:00 local do dia seguinte (RN-9); antecedência atravessando a meia-noite (CA-15); data local do início é a data pedida (RN-11).
- **Horário de verão:** salto e recuo em `America/New_York` (CA-17, CA-18). Atendimento que atravessa o salto dura o tempo real (60 min de 01:30 EST termina 03:30 EDT). Início de jornada em hora inexistente vira o instante da transição (regra de `fuso.ts`). `America/Sao_Paulo` histórico (04/11/2018, 00:00 inexistente) segue a mesma regra; teste opcional.
- **Troca de fuso:** CA-19. O fuso gravado pode ser um alias antigo aceito por `validarFuso`; o cálculo usa `validarFuso` (não `ehFusoCanonico`).
- **Concorrência:** o cálculo é leitura e não trava nada. Entre a consulta e a reserva o horário pode ser tomado; a E3.2 revalida e a constraint garante. Não é exigido snapshot transacional único entre as leituras (D-10).
- **Isolamento entre salões:** CA-20; também bloqueio de salão de S2 não afeta S1.
- **Salão suspenso/pendente/encerrado:** fora (E6.4). O cálculo devolve horários normalmente; quem chama aplica a política.
- **Cliente anonimizada:** a reserva continua ocupando (CA-12).
- **Profissional/serviço inativos:** RN-1, RN-16, CA-11. Serviço desativado depois de reservado não libera a reserva (RN-7).
- **Gestor que atende:** é um profissional como os outros (perfil vinculado); nada específico.
- **Duração não alinhada à grade:** 50 min com grade 15 → inícios na grade, fim em qualquer múltiplo de 5 (D-014 `:94`).
- **Duração total maior que todo intervalo de jornada:** sem horários, sem erro.
- **Jornada com início fora da grade:** RN-4 (CA-9).
- **Antecedência 0:** inícios ≥ `agora` (início exatamente igual a `agora` é válido).
- **Bloqueio de vários dias e sobrepostos:** cada um avaliado; sobreposição entre eles é irrelevante.
- **Reserva começando antes do período consultado** com `ocupado_ate` dentro dele: precisa entrar na leitura (a consulta usa intersecção de intervalos, não "início dentro do período").
- **Entradas inválidas:** CA-21. Telefone não se aplica (não há cliente nesta demanda).
- **Permissões por perfil:** não se aplica nesta demanda: não há ação nem rota. A função de servidor aceita os contextos que E4.1 (público) e E3.2/E3.4 (sistema/equipe) precisarem (D-11); quem expõe aplica permissão.

## 7. Dependências

- Demandas: D-014/E2.1 (`listarServicosPublicos`), D-013/E2.2 (profissionais e `ativo`), D-015/E2.3 (`lerSemana`), D-016/E2.4 (`lerBloqueios`, `fuso.ts`), D-017/E2.5 (regras e fuso do salão), D-004/E0.4 (constraint e índices), D-005/E0.5 (contextos, repositórios, harness). Todas em `main` (7a69cdf).
- Bloqueia: E3.2 (#34), e por consequência E4.1 e E3.4.
- Integrações: nenhuma (Mercado Pago, WhatsApp, e-mail e Turnstile não participam).
- Dados: fábricas de `tests/support/` precisam gerar volume de reservas (5.000 por profissional) para o CA-25 em tempo razoável (inserção em lote).

## 8. Impactos prováveis

- **Dados:** sem migração prevista. A consulta de ocupação deve usar o GiST parcial `reserva_sem_sobreposicao` (prefixo `profissional_id`), com o literal de status no texto (precedente `consultaReservasQueCruzam`). Leituras em lote por vários profissionais (jornadas, ocupações) provavelmente exigem funções novas em `src/server/repos/` (as atuais são por profissional). **Recomendo acionar o DBA** para revisar a consulta de ocupação e o `EXPLAIN` (CA-25), como prevê `dba.md:168,197`.
- **Contextos:** `listarServicosPublicos` exige `PublicoContext` e `lerSemana`/`lerBloqueios` exigem `ContextoEscopado`; o arquiteto decide como o serviço atende chamadas públicas e de sistema sem duplicar a regra de ofertáveis (D-11).
- **Camadas:** `src/domain/availability/` é pasta nova; a função pura precisa de `fuso.ts`, que está em `src/server/tempo/`. O arquiteto decide se o domínio importa de `@/server/tempo` ou se recebe os conversores, e se há regra de lint para manter o domínio sem Prisma/`next/*`.
- **Infraestrutura/CI:** nenhum impacto esperado; DevOps dispensável. O teste de volume (CA-25) não pode deixar a suíte de integração lenta (alvo: poucos segundos).
- **Cobertura:** novos módulos entram no gate de 90%.

## 9. Dúvidas e decisões

### Bloqueantes

Nenhuma.

### Não bloqueantes (suposições adotadas)

- **D-1** (RN-15): a consulta aceita um período de datas `[d1, d2]`, não só uma data, para a E4.1 poder mostrar quais dias têm horários sem N chamadas; limite `janela_dias + 1` datas. Uma data é o caso `d1 = d2`.
- **D-2** (RN-10): grade por hora de parede a partir de 00:00 local; hora inexistente descartada; hora repetida só na primeira ocorrência (coerente com `fuso.ts`). Consequência aceita: no recuo, a segunda ocorrência da hora repetida não é oferecida (CA-18). O Brasil não tem horário de verão hoje.
- **D-3** (RN-17; `PLAN.md:34`): não há opção "qualquer profissional" com atribuição automática. Sem profissional informado, o resultado vem agrupado por profissional elegível; a UI decide como apresentar.
- **D-4** (RN-15): até 10 serviços por consulta, sem repetição (a sequência é de serviços distintos; o mesmo serviço duas vezes exigiria regra que o `PLAN.md` não traz). A ordem dos serviços não altera a disponibilidade (só a duração total importa); a ordem de execução é gravada na E3.2.
- **D-5** (RN-16): serviço não ofertável → erro "serviço indisponível" (a seleção ficou desatualizada); profissional inativo ou não vinculado → vazio; id de profissional estranho ao salão → `NaoEncontrado`.
- **D-6** (RN-18): `agora` obrigatório também no serviço de servidor; quem chama (página, ação) obtém o relógio.
- **D-7** (RN-3c, RN-19): o intervalo vale só depois de cada atendimento (o novo usa o vigente; os existentes, o `ocupado_ate` gravado). Não há intervalo "antes". O intervalo não é checado contra jornada nem bloqueio (`dev.md:80`).
- **D-8** (CA-7): a issue diz "61º dia local" e a RN-5 diz "≤ hoje + janela". Prevalece a RN-5: `hoje + 60` tem horários e `hoje + 61` não. O CA-7 foi reescrito sem mudar a intenção.
- **D-9** (§5): testes unitários ficam em `src/**` (único padrão coletado pelo projeto `unit`), não em `tests/unit/availability/` como lista a issue.
- **D-10** (§6): sem exigência de transação/snapshot único para as leituras; a inconsistência possível equivale à corrida natural com a E3.2.
- **D-11** (§8): o serviço deve servir ao contexto público (E4.1) e ao de sistema/equipe (E3.2/E3.4), sempre escopado ao salão; a forma (aceitar `PublicoContext` e derivar o escopo, ou variante de leitura de ofertáveis para `ContextoEscopado`) é do arquiteto, mantendo `listarServicosPublicos` como a fonte da regra de ofertáveis (D-014).
- **D-12** (CA-27): limite de 2 s para a função pura, verificável e generoso; a métrica principal de desempenho é estrutural (CA-25, CA-26).

## 10. Revisão D-019/D-020 — horário de funcionamento do salão

Fontes: `docs/trinks-alinhamento.md` (DT-6; §7.3), issue #27 (seção "Revisão D-019": RN-R1, CA-R1..CA-R4), `docs/demandas/D-020/` e o código em `main` (`src/server/salao/funcionamento-leitura.ts:22`, `src/server/repos/funcionamento.ts:54`, `src/server/repos/publico.ts:144,169`). Obrigação registrada no `CLAUDE.md` pela D-020: a E3.1 deve usar `lerFuncionamento` ou `COLUNAS_FUNCIONAMENTO`.

**O que mudou.** Até aqui a validade de um início dependia só da jornada (RN-3a). O funcionamento público passa a limitar em conjunto com a jornada (DT-6). RN-1..RN-19 e CA-1..CA-27 ficam como estão, exceto o texto da RN-3(a) (acima) e o contexto do §1 (acréscimo). Salão sem funcionamento informado se comporta exatamente como antes (CA-1..CA-27 continuam valendo sem alteração).

**Fora do escopo (reafirmado):** o encaixe da equipe (E3.4) não usa esta função e continua permitido fora do funcionamento, com o aviso previsto (DT-6; trinks-alinhamento §7.3 "Encaixe preservado"). Esta demanda não altera `lerFuncionamento`, o repositório de funcionamento nem a tela de configuração.

### Regras de negócio novas

- **RN-20** (DT-6; issue RN-R1): estados do funcionamento. (i) **Não informado** (`definido: false`): não limita; vale só a jornada. (ii) **Informado** com intervalos: para a data local `d` (dia da semana `w`), a janela oferecível de P é jornada(P, w) ∩ funcionamento(w). (iii) **Informado com todos os dias fechados** (`definido: true`, os 7 dias sem intervalos): nenhum horário para nenhum profissional em nenhuma data (não se confunde com "não informado"). Dia fechado no funcionamento = sem horários naquele dia, ainda que haja jornada.
- **RN-21** (DT-6; RN-3a revisada): um início `i` com fim `f` é válido somente se `[i, f)` está inteiramente contido em **um único** intervalo de jornada ∩ funcionamento da data local. A interseção é feita em **minutos de parede** do mesmo dia local e fuso (ambos são hora de parede do `salao.fuso`), par a par, descartando vazios; os intervalos resultantes são convertidos em instantes pela mesma regra da RN-9 (fim 1440 = 00:00 do dia seguinte, só por `src/server/tempo/fuso.ts`, sem segunda implementação). Atendimento que cabe no funcionamento mas cruza a pausa da jornada (ou o contrário) não é oferecido, porque os dois limites valem ao mesmo tempo.
- **RN-22** (RN-4, RN-10 inalteradas): a grade continua contada a partir de 00:00 local, não do início da interseção; o tratamento de horário de verão (RN-10) e a regra de não atravessar a meia-noite (RN-11) valem sobre a interseção. Funcionamento até 24:00 (1440) é fim válido; não une dias.
- **RN-23** (RN-3b, RN-3c, RN-7 inalteradas): bloqueios e reservas continuam sendo avaliados em instantes sobre os inícios que sobraram da RN-21. O intervalo (RN-3c) continua sem precisar caber na jornada nem no funcionamento.
- **RN-24** (RN-12, RN-13 estendidas): o funcionamento é lido do salão a cada consulta (valor vigente) e, como a jornada, é hora de parede: após troca de fuso vale com os mesmos minutos no novo fuso (D-020 e D-017 RN-16); nada é recalculado nem reinterpretado nas reservas existentes.
- **RN-25** (RN-14): o funcionamento lido é sempre o do salão do contexto; funcionamento de outro salão nunca entra no cálculo.
- **RN-26** (RN-19 estendida): o funcionamento entra na leitura **sem aumentar o número de instruções SQL por chamada**. Forma recomendada: na leitura das regras do salão (`lerRegras`, hoje uma instrução sobre `salao`), projetar também `COLUNAS_FUNCIONAMENTO` (alias `s` para `salao`) e converter com `funcionamentoDaLinha`/`montarSemana`, mantendo a contagem constante e igual à de antes da revisão. Não se chama `lerFuncionamento` como leitura extra se isso somar uma instrução (a menos que o arquiteto demonstre que o total continua constante e documentado). A leitura é por salão, não por profissional nem por data.
- **RN-27** (RN-18): a função pura recebe o funcionamento como parâmetro (`{ definido: false } | { definido: true, semana }`) e continua sem banco e sem relógio. Mesma entrada, mesma saída.

### Critérios de aceitação novos

Salvo indicação: `America/Sao_Paulo`, grade 15, antecedência 2 h, janela 60, intervalo 0, data futura dentro da janela, `agora` bem anterior. Unidade = função pura; integração = PostgreSQL real.

- **CA-28** (CA-R1; RN-21; unidade): Dado funcionamento 10:00–18:00 e jornada 09:00–19:00 no dia, quando se pede 60 min, então o primeiro início é 10:00 e o último 17:00 (17:15 não).
- **CA-29** (CA-R2; RN-20; unidade e integração): Dado o dia da semana fechado no funcionamento (informado) e jornada nesse dia, quando se consulta uma data desse dia, então a lista é vazia (o profissional continua no resultado, RN-8); um dia aberto adjacente tem horários.
- **CA-30** (CA-R3; RN-21; unidade): Dado funcionamento 09:00–12:00 e 13:00–18:00 e jornada 08:00–18:00, quando se pedem 90 min, então 11:00 não é oferecido e 13:00 é; 09:00 também é, e 10:30 é o último da manhã.
- **CA-31** (CA-R4; RN-20; unidade e integração): Dado um salão sem funcionamento informado (`definido: false`), quando se consulta, então a saída é idêntica (`toEqual`) à calculada só com a jornada, e idêntica à de antes da revisão (os CA-1..CA-27 passam sem alteração). Dado `definido: false` com linhas residuais em `salao_funcionamento`, o resultado também não limita (a leitura só agrega linhas se `funcionamento_definido`).
- **CA-32** (RN-20; unidade e integração): Dado funcionamento informado com todos os 7 dias fechados e jornada todos os dias, quando se consulta qualquer data da janela, então não há horários para nenhum profissional.
- **CA-33** (RN-21; unidade): Dado jornada 09:00–12:00 e 13:00–18:00 e funcionamento 09:00–18:00 (sem pausa), quando se pede 90 min, então 11:00 não é oferecido (cruza a pausa da jornada) e 13:00 é; dado a pausa só no funcionamento e jornada contínua, o resultado é o mesmo.
- **CA-34** (RN-21; unidade): Dado jornada 08:00–20:00 e funcionamento 09:00–11:00, 12:00–14:00 e 15:00–19:00 (vários intervalos), serviço de 60 min, quando se calcula, então os inícios são 09:00, 09:15, …, 10:00; 12:00, …, 13:00; 15:00, …, 18:00, e nenhum cruza uma pausa; um intervalo de funcionamento sem jornada correspondente (jornada 08:00–10:00 e funcionamento 15:00–19:00) não gera horário.
- **CA-35** (RN-21, RN-22; unidade): Dado funcionamento 18:00–24:00 em D e 00:00–02:00 em D+1 e jornada 18:00–24:00 em D, serviço de 60 min, quando se consulta D, então o último início é 23:00 (fim 00:00 local de D+1, via `instanteDeHoraLocal(D+1, 0)`) e 23:15 não é oferecido, mesmo com funcionamento em D+1 (RN-11); a consulta de D+1 não herda horário de D.
- **CA-36** (RN-21, RN-22, RN-10; unidade, DST): Dado `America/New_York`, 08/03/2026 (salto), jornada 00:00–04:00 e funcionamento 00:00–04:00, serviço de 60 min, então os inícios são os do CA-17 (nenhum rótulo 02:xx; 03:00 incluído); dado funcionamento 01:00–04:00, então os inícios são 01:00, 01:15, 01:30, 01:45 e 03:00. Dado 01/11/2026 (recuo), jornada e funcionamento 00:00–04:00, então os 13 inícios do CA-18; com funcionamento 01:00–04:00, rótulos 01:00 a 03:00, sem duplicados, só a primeira ocorrência de 01:00–01:45.
- **CA-37** (RN-21, RN-9; unidade): Dado jornada 09:00–12:00 e funcionamento 09:05–11:00, grade 15, serviço de 30 min, então o primeiro início é 09:15 e o último 10:30 (grade a partir de 00:00; a interseção `[09:05, 11:00)` limita o fim); os minutos de parede só viram instantes por `fuso.ts` (verificável por teste de análise estática ou por revisão: o módulo de domínio não contém aritmética de fuso própria).
- **CA-38** (RN-23; unidade e integração): Dado funcionamento 09:00–18:00, jornada 09:00–18:00, um bloqueio e uma reserva ativa dentro do funcionamento, então os inícios são os do CA-13/CA-3 sobre a interseção; um bloqueio ou reserva **fora** do funcionamento (por exemplo, encaixe às 08:00–09:00) não afeta os inícios dentro dele, e a reserva de encaixe fora do funcionamento continua ocupando o profissional se invadir a janela (intervalo, RN-3c).
- **CA-39** (RN-24; integração): Dado funcionamento 09:00–12:00 e jornada 09:00–12:00 criados em `America/Sao_Paulo`, quando o fuso muda para `America/Manaus` e se consulta, então o primeiro início é 09:00 local = 13:00Z (mesmos minutos de parede; o instante muda).
- **CA-40** (RN-25; integração): Dado S1 sem funcionamento informado e S2 com todos os dias fechados (ou com funcionamento curto), quando se consulta S1, então o resultado de S1 não muda e é igual ao obtido sem os dados de S2; e quando S1 tem funcionamento informado e S2 não, S2 não é limitado pelo de S1.
- **CA-41** (RN-26; integração): Dado o instrumento de contagem do CA-26, quando se consulta 1 profissional × 1 data e 10 profissionais × 61 datas, em salão com funcionamento informado **e** em salão sem ele, então as quatro chamadas emitem o mesmo número de consultas, igual ao número de antes da revisão; nenhuma consulta é emitida por data nem por profissional para ler o funcionamento.
- **CA-42** (RN-27; unidade): Dado a mesma entrada com funcionamento informado avaliada duas vezes, com bloqueios e reservas em ordem embaralhada, então as saídas são idênticas e `vi.useFakeTimers` em outra data não altera o resultado (extensão do CA-24).
- **CA-43** (RN-20, RN-21; unidade): Dado funcionamento informado cujo único intervalo do dia é menor que a duração total (ex.: 09:00–09:30 e serviço de 60 min), então não há horários e não há erro; funcionamento 09:00–10:00 e serviço de 60 min dá exatamente 09:00.
- **CA-44** (RN-21; unidade): Dado profissional com a janela de jornada ∩ funcionamento vazia num dia (jornada 13:00–18:00, funcionamento 09:00–12:00), então lista vazia para ele e o profissional continua no resultado (RN-8).

Correspondência com a issue: CA-R1 = CA-28; CA-R2 = CA-29; CA-R3 = CA-30; CA-R4 = CA-31. Correspondência com `trinks-alinhamento.md` §7.3: "Funcionamento ∩ jornada" = CA-28, "Dia fechado" = CA-29, "Intervalos parciais" = CA-30, "Encaixe preservado" = fora (E3.4; ver CA-38 para a ocupação).

### Casos limite acrescentados

- Troca de `funcionamento_definido` de verdadeiro para falso (ou o inverso) entre duas consultas: vale o estado vigente na consulta, sem cache (RN-24).
- Funcionamento alterado depois de reservas existentes: as reservas continuam válidas e ocupando (RN-7, RN-24); só novas ofertas mudam.
- Salão suspenso, cliente anonimizada, permissões: sem mudança (§6); o funcionamento é lido sem checagem de papel (API própria para a E3.1).
- Funcionamento e jornada com a mesma pausa em horários diferentes: a interseção pode gerar vários intervalos curtos no mesmo dia (CA-34); cada um é avaliado isoladamente.
- Salão com fuso de DST: a interseção em minutos de parede pode incluir hora inexistente/repetida; vale RN-10 sobre os candidatos (CA-36).

### Dependências e impactos da revisão

- Dependências novas: D-020/E2.6 (`lerFuncionamento`, `COLUNAS_FUNCIONAMENTO`, `salao_funcionamento`, `funcionamento_definido`), em `main`. #75 (E2.6) deixa de bloquear.
- Dados: sem migração. O DBA só precisa confirmar que projetar `COLUNAS_FUNCIONAMENTO` na leitura das regras do salão não altera o plano nem o número de instruções (a subconsulta usa `salao_id`; verificar índice em `salao_funcionamento`). Se `lerRegras` passar de Prisma Client a SQL bruto, o arquiteto documenta.
- Infraestrutura/CI: nenhum.
- Cobertura: o novo módulo de interseção entra no gate de 90%.

### Dúvidas

- **Bloqueantes:** nenhuma.
- **Não bloqueantes (suposições adotadas):**
  - **D-13** (RN-26): o funcionamento é lido na mesma instrução das regras do salão via `COLUNAS_FUNCIONAMENTO`, para manter a contagem de consultas constante; a decisão final de forma é do arquiteto.
  - **D-14** (RN-21): a interseção é feita em minutos de parede, antes da conversão em instantes. É equivalente à interseção em instantes, porque os dois conjuntos são do mesmo dia local e fuso, e evita duas conversões por intervalo.
  - **D-15** (RN-20): "informado com todos os dias fechados" nunca é tratado como "não informado"; o discriminador é só `definido`.
  - **D-16** (§3): o encaixe da equipe fora do funcionamento é preservado e fica fora desta demanda (E3.4).
