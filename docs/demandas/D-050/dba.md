# D-050 (E3.6) — Parecer do DBA (T-1)

Autor: dba. Data: 23/11/2026. Branch `feat/d-050-servicos-independentes`.
Entradas: `spec.md` (RN-1..RN-39, CA-19, CA-46..CA-49), `design.md` (§1.2, §3, §4, §9 T-1), migrações anteriores e
pareceres D-004/D-018/D-024/D-028/D-030/D-043.

Veredito: **desenho aceito**, com 6 ajustes pequenos listados em "Mudanças no desenho" (nenhum muda interface de
serviço; dois mudam a migração e o schema, já entregues; os demais são precisões de SQL para T-2/T-4/T-6/T-7).

---

## 1. Entregáveis

| Arquivo | O quê |
|---|---|
| `prisma/migrations/20261127000000_reserva_item_autonomo/migration.sql` | Migração única: guarda → colunas → cópia (RN-39) → restrições/índices/exclusions → `mensagem.reserva_item_id` → remoções em `reserva`. Reversão no cabeçalho entre `-- REVERSAO-INICIO` / `-- REVERSAO-FIM`. |
| `prisma/schema.prisma` | `Reserva` sem `profissionalId`/`ocupadoAte`/`encaixe`; `ReservaItem` com os campos novos, `profissional`, `mensagens`, 3 `@@unique` e 3 `@@index`; `Profissional.reservas` → `itensDeReserva`; `Mensagem.reservaItemId` + `reservaItem`. `migrate diff` = "No difference detected". |
| `tests/integration/db/reserva-item-exclusion.test.ts` (novo, 28 testes) | CA-19, RN-8/RN-9 no banco, CHECKs, unicidade, FK de mensagem, concorrência de duas transações. |
| `tests/integration/db/migracao-itens.test.ts` (novo, 6 testes) | CA-46, CA-47, CA-48, CA-49 com `prisma migrate deploy` real numa base dedicada. |
| `tests/integration/db/planos-itens.test.ts` (novo, 12 testes) | Q4–Q8 e `substituirNaoVigentes` com volume; planos impressos com `[D-050-plano]`. |
| `tests/integration/db/{drift,reserva-exclusion,isolamento-salao,unicidade,defaults}.test.ts` | Contrato de catálogo atualizado; testes antigos adaptados ao modelo novo (helpers locais: `tests/support/sql.ts` é da T-2). |
| `tests/integration/harness/template.test.ts` | **Fora da posse da T-1**: uma linha (nome da migração na lista `MIGRACOES`). Sem ela o teste do harness falha em qualquer execução; nenhum outro dono previsto. |

## 2. Contrato de nomes (aplicação e testes)

| Nome | Tipo | SQLSTATE | Uso |
|---|---|---|---|
| `reserva_item_sem_sobreposicao` | EXCLUDE gist `(profissional_id =, tstzrange(inicio, ocupado_ate, '[)') &&) WHERE status IN ('confirmado','concluido','nao_compareceu')` | 23P01 | ÚNICA traduzida para `horario_indisponivel` (causa `23P01`). |
| `reserva_item_mesma_reserva_sem_sobreposicao` | EXCLUDE gist `(reserva_id =, tstzrange(inicio, fim, '[)') &&)`, mesmo predicado | 23P01 | NUNCA traduzida (indica falha de `conferirItens`). |
| `reserva_item_ordem_chk` | `fim > inicio AND ocupado_ate >= fim` | 23514 | |
| `reserva_item_fim_chk` | `fim = inicio + make_interval(mins => duracao_min)` | 23514 | Q11. |
| `reserva_item_duracao_teto_chk` | `duracao_min <= 1440` | 23514 | **Novo** (M-2): torna exata a margem de 1 dia da agenda. |
| `reserva_item_revisao_chk` | `revisao >= 0` | 23514 | |
| `reserva_ordem_chk` | recriada: só `fim > inicio` | 23514 | |
| `mensagem_item_tipo_chk` | `reserva_item_id IS NULL OR tipo IN ('remarcacao','cancelamento')` | 23514 | |
| `reserva_item_salao_id_reserva_id_servico_id_key` | UNIQUE (inclui cancelados) | 23505 | RN-2 (Q10). Nunca capturar. |
| `reserva_item_salao_id_reserva_id_id_key` | UNIQUE | — | Alvo da FK de mensagem. |
| `reserva_item_salao_id_profissional_id_fkey` | FK composta → `profissional (salao_id, id)` RESTRICT | 23503 | Isolamento (CA-50). |
| `mensagem_salao_id_reserva_id_reserva_item_id_fkey` | FK 3 colunas → `reserva_item (salao_id, reserva_id, id)` RESTRICT, MATCH SIMPLE | 23503 | Item da MESMA reserva. |
| `reserva_item_salao_id_profissional_id_inicio_idx`, `reserva_item_salao_id_inicio_idx` | btree | — | Agenda/listas. |

Removidos: `reserva_sem_sobreposicao`, `reserva_salao_id_profissional_id_fkey`,
`reserva_salao_id_profissional_id_inicio_idx`, colunas `reserva.profissional_id/ocupado_ate/encaixe`.
FKs de `public`: 46 → 47.

---

## 3. Mudanças no desenho (para o arquiteto revisar antes da T-2)

- **M-1 Sem `UNIQUE (salao_id, id)` em `reserva_item`.** Nenhuma FK aponta para ele (a de mensagem usa
  `(salao_id, reserva_id, id)`); seria um índice a mais em toda escrita. §4.1 do design deve perder esse item.
- **M-2 CHECK `reserva_item_duracao_teto_chk (duracao_min <= 1440)` e margem da agenda = `interval '1 day'`** (Q4).
  Sem teto no banco a margem de 1 dia só valeria pelo limite de 720 min da aplicação. A guarda conta itens > 1440.
- **M-3 Guarda com 4 contagens** (não 2): reservas sem itens, `fim <> inicio + soma`, serviço repetido na mesma
  reserva (a UNIQUE nova falharia no meio da migração) e itens > 1440 min. Mensagem exata (o teste a confere):
  `D-050: migração abortada sem alterar nada: <a> reserva(s) sem itens, <b> com fim <> inicio + soma das durações,
  <c> com serviço repetido, <d> item(ns) com mais de 1440 min`.
- **M-4 `PREDICADO_VIGENTE` concreto** (T-4; usado por `substituirNaoVigentes` e pelo EXISTS da agenda) — não usa
  `reserva_item_id`, olha só `revisao`/`status` dos itens, e `confirmacao` deixa de comparar a revisão (R-4):
  ```sql
  ((m.tipo = 'confirmacao' AND r.status = 'confirmado')
   OR (m.tipo = 'convite_avaliacao' AND r.status = 'concluido')
   OR (m.tipo = 'remarcacao' AND EXISTS (SELECT 1 FROM reserva_item vi
         WHERE vi.salao_id = m.salao_id AND vi.reserva_id = m.reserva_id AND vi.revisao = m.revisao AND vi.status = 'confirmado'))
   OR (m.tipo = 'cancelamento' AND EXISTS (SELECT 1 FROM reserva_item vi
         WHERE vi.salao_id = m.salao_id AND vi.reserva_id = m.reserva_id AND vi.revisao = m.revisao AND vi.status = 'cancelado')))
  ```
  Literais de tipo/estado/status no texto, nunca parâmetros. Paridade com `conferirVigencia` obrigatória (teste T-4).
- **M-5 `servico_repetido` na remarcação considera TAMBÉM itens cancelados** (Q10): a UNIQUE inclui cancelados; se a
  checagem pura ignorar cancelados, um 23505 escapa (e 23505 nunca é capturado).
- **M-6 Ordem de disparo das duas exclusions** (Q2): a por profissional tem OID menor e é verificada primeiro. Um
  conflito de mesmo profissional dentro da mesma reserva aparece como `reserva_item_sem_sobreposicao` (traduzido para
  `horario_indisponivel`); por isso `conferirItens` (RN-8/RN-9) TEM de rodar antes do INSERT, como o design já pede.
  O drift test fixa essa ordem.

Nenhuma resposta abaixo muda interface pública do §3 do design.

---

## 4. Respostas Q1–Q15

**Q1 — Derivados armazenados sem trigger: aceito.** Trigger de verificação `DEFERRABLE` (constraint trigger) pagaria
uma leitura dos itens por linha alterada em toda transação de reserva, e esconderia no banco uma regra que já tem uma
única fonte (`derivarReserva`). As escritas de item acontecem todas sob `reserva FOR UPDATE` (operações) ou na
transação que cria a reserva, então não há corrida entre duas derivações. Mantenha o verificador `conferirDerivados`
(R-2) em todo teste de alteração/concorrência. Condição: nenhuma escrita em `reserva_item` fora de `repos/reserva.ts` e
`repos/reserva-alteracao.ts` (seed e fixtures E2E devem gravar derivados coerentes).

**Q2 — Manter `reserva_item_mesma_reserva_sem_sobreposicao`: sim.** Custo medido: +1,2 s na construção a 96 mil
itens e um GiST pequeno (chave `reserva_id`, ≤ 10 linhas por chave); a escrita é rara (criação/remarcação). INSERT de
N linhas num só comando: cada linha é verificada contra o índice incluindo as anteriores do mesmo comando — provado
(`reserva-item-exclusion.test.ts`: dois itens cruzados num `INSERT … SELECT FROM unnest` → 23P01 com o nome dela e 0
linhas gravadas). Não há risco de impasse adicional: duas transações diferentes nunca têm o mesmo `reserva_id`
(a reserva é criada na própria transação ou está travada `FOR UPDATE`). Ver M-6.

**Q3 — FK de 3 colunas MATCH SIMPLE: ok; sem índice novo.** Com `reserva_item_id` nulo a FK não é conferida
(provado). O índice do lado referenciador só serviria a DELETE/UPDATE de chave em `reserva_item`, que não existem
(itens nunca apagados, chave imutável). Leituras de mensagens por item partem da reserva
(`mensagem_salao_id_reserva_id_idx`/`mensagem_reserva_id_tipo_revisao_key`, ≤ dezenas de linhas). A FK garante que o
item é do MESMO salão e da MESMA reserva (provado: item de outra reserva do mesmo salão → 23503).

**Q4 — Índices de agenda e margem.** Manter `(salao_id, profissional_id, inicio)` e `(salao_id, inicio)`. Medido a
60 mil itens (2 salões): o planejador itera os profissionais do salão e usa
`reserva_item_salao_id_profissional_id_inicio_idx` em todos os 4 cenários (semana/dia × com/sem filtro), custom e
genérico; `(salao_id, inicio)` é usado pelo `listarConfirmadasQueCruzam` genérico sem filtro (BitmapAnd com o GiST).
Margem: `interval '1 day'` com o teto M-2. Tempos (custom/genérico): semana sem filtro 3,8/2,4 ms; semana 1 prof.
0,4/0,4 ms; dia sem filtro 0,5/0,5 ms (com 7 dias: 2,4 ms custom); dia 1 prof. 0,15 ms.

**Q5 — `reserva_cliente_confirmada_idx` continua útil.** O status derivado `confirmado` ⇔ existe item confirmado,
logo `r.status = 'confirmado'` é condição necessária de RN-18 e casa com o índice parcial. Plano (cliente com 50
reservas): Index Scan em `reserva_cliente_confirmada_idx` + Semi Join com Index Scan em
`reserva_item_salao_id_reserva_id_servico_id_key` por reserva, 0,13 ms. SQL recomendado (literais nos dois níveis):
```sql
SELECT count(*) FROM reserva r
 WHERE r.salao_id = $1 AND r.cliente_id = $2 AND r.status = 'confirmado'
   AND (r.chave_requisicao IS DISTINCT FROM $4 OR $4 IS NULL)
   AND EXISTS (SELECT 1 FROM reserva_item i WHERE i.salao_id = r.salao_id AND i.reserva_id = r.id
                  AND i.status = 'confirmado' AND i.inicio > $3)
```
Nada melhor justificaria um índice novo.

**Q6 — `consultaOcupacoes` sobre itens: aprovado, mesma forma da D-018** (`unnest` + `CROSS JOIN LATERAL`,
`i.status IN ('confirmado', 'concluido', 'nao_compareceu')` literal, `tstzrange(i.inicio, i.ocupado_ate, '[)')`
literal). Plano custom e genérico: Bitmap Index Scan em `reserva_item_sem_sobreposicao` por profissional, sem Seq Scan;
10 prof. × 61 dias 2,5 ms; 1 × 1 dia 0,04 ms. Volume: 60 mil itens (≥ 10 mil por salão).

**Q7 — EXISTS da falha com `PREDICADO_VIGENTE`: aprovado.** O EXISTS roda só para as ≤ 201 linhas do resultado
(SubPlan após o Sort/Limit), por índice de mensagem que começa pela reserva; as subconsultas em `reserva_item` usam o
UNIQUE `(salao_id, reserva_id, …)`; nenhuma varredura de `mensagem` ou `reserva_item`. Mesmo comportamento para as
duas subconsultas correlacionadas de "n de N" (só gestor). A agenda segue numa única instrução.

**Q8 — `listarConfirmadasQueCruzam` sobre itens: aprovado.** `i.status = 'confirmado'` (literal) implica o predicado
`status IN (…)` do índice parcial (o planejador expande o IN e prova a implicação), e o predicado redundante
`tstzrange(i.inicio, i.ocupado_ate, '[)') && tstzrange($de, $ate, '[)')` permite o GiST. Custom e genérico, com e
sem profissional: GiST usado (sem filtro genérico: BitmapAnd GiST × `(salao_id, inicio)`, 1,7 ms). Mantenha o filtro
exato `i.inicio < ate AND i.fim > de`. Não junte as variantes num `$p IS NULL OR …`.

**Q9 — Transação, guarda e locks.** O `prisma migrate deploy` envia o arquivo como um lote único (transação
implícita): provado no teste — com dados inválidos o deploy sai ≠ 0 com a mensagem da guarda, o catálogo e os dados
ficam idênticos, e a linha em `_prisma_migrations` fica com `finished_at` nulo (o deploy seguinte responde P3009). A
guarda roda antes de qualquer DDL, então "não aplica nada" vale mesmo sem a transação. Recuperação (testada):
corrigir dados → `prisma migrate resolve --rolled-back 20261127000000_reserva_item_autonomo` → `migrate deploy`.
Locks: ACCESS EXCLUSIVE em `reserva`, `reserva_item` e `mensagem` até o COMMIT. Tempo medido (60 mil reservas,
96 mil itens, 108 mil mensagens): UPDATE 3,3 s, exclusion por profissional 3,4 s, exclusion da mesma reserva 1,2 s,
demais < 1 s; `migrate deploy` total ~8 s. Volume real v1 é ordens de grandeza menor. Operar com app e worker parados.

**Q10 — `UNIQUE (salao_id, reserva_id, servico_id)` com cancelados: ok.** Coerente com RN-2 (um serviço por reserva)
e com DA-12 (acrescentar serviço = outra reserva). Consequência para RN-22: remarcar trocando para um serviço que já
existe na reserva, mesmo cancelado, é recusado → ver M-5. Provado: segundo item com o mesmo serviço (primeiro
cancelado) → 23505 com o nome.

**Q11 — `fim = inicio + make_interval(mins => duracao_min)`: seguro.** `timestamptz + interval` só depende do
TimeZone da sessão para unidades de dia/mês; um intervalo só de minutos é aritmética absoluta em UTC. Provado com a
sessão em `America/New_York` atravessando o fim do horário de verão (01/11/2026 06:00 UTC): item de 90 min aceito e
conferido. A aplicação deve gravar `fim` exatamente assim (minutos inteiros; nada de "hora de parede + duração").

**Q12 — Laço em ordem de id: manter (A-10).** Um único `SELECT … WHERE id = ANY($1) ORDER BY id FOR NO KEY UPDATE`
também trava na ordem do Sort (o LockRows fica acima dele), mas a prova do projeto (D-025/D-030 com
`pg_stat_activity`) é do laço, e ≤ 10 comandos curtos são irrelevantes. Regra: ids distintos, ordenados por `id`
(comparação de uuid do PostgreSQL = ordem lexicográfica dos bytes; ordene no JS pela string minúscula canônica, que
dá a mesma ordem).

**Q13 — Cancelar item/todos e marcar status sem travar profissional: sem impasse nem perda.** O UPDATE do item não
toca `profissional_id` (nenhuma checagem de FK, nenhum `FOR KEY SHARE` no profissional) e nenhuma dessas transições
torna um item ocupante (`cancelado` é terminal; `concluido ↔ nao_compareceu` continuam no predicado). A desativação
(D-013: profissional `FOR UPDATE` → leitura dos itens `confirmado` com `fim > agora`) só lê itens; não há ciclo. Com
um cancelamento em voo, a desativação ainda vê o item confirmado e recusa (resultado conservador; nova tentativa passa
depois do COMMIT). A única transição que torna ocupante — remarcar — trava o profissional (atual e alvo) `FOR NO KEY
UPDATE` antes de `reserva FOR UPDATE`, na ordem canônica §4.6. Caso determinístico com `pg_stat_activity` fica na T-6
(R-9).

**Q14 — Confirmações `falhou` com `reserva.revisao > 0`:** 0 na base de desenvolvimento com seed (`agenda_beleza`: 22
reservas, 28 itens, 2 mensagens) e 0 na base E2E (`agenda_beleza_test_e2e`: 41 reservas, 46 itens, 5 mensagens).
Também 0 `pendente/enviando`. R-4 não tem efeito nos dados existentes. Leitura só com SELECT.

**Q15 — Reversão: suficiente, com o critério ampliado.** "Representável" = por reserva, todos os itens com o mesmo
profissional, status e encaixe, contíguos pela `ordem` (`inicio = fim` do anterior) e `ocupado_ate = fim` em todos
menos o último. Isso garante que o envelope e a ocupação antigos `[inicio do 1º, ocupado_ate do último)` são idênticos
aos dos itens, e que `reserva_sem_sobreposicao` recriada não falha. Perde-se apenas `mensagem.reserva_item_id`
(exibição); as linhas de mensagem ficam. Diferenças semânticas aceitas: revisões incrementadas por cancelamentos do
modelo novo permanecem (são coerentes com as mensagens). Provado (CA-48): catálogo das 3 tabelas idêntico ao de
antes (colunas, restrições, índices; só a posição física das colunas recriadas muda), dados de `reserva` e
`reserva_item` idênticos, linha da migração removida, e a migração reaplica em seguida.

---

## 5. Reversão (procedimento)

1. Parar app e worker. Em base que não seja local/teste: autorização explícita do usuário.
2. Extrair o bloco entre `-- REVERSAO-INICIO` e `-- REVERSAO-FIM` tirando o prefixo `-- ` para `reversao.sql`
   (`sed -n '/^-- REVERSAO-INICIO/,/^-- REVERSAO-FIM/p' migration.sql | sed '1d;$d;s/^-- \{0,1\}//' > reversao.sql`).
3. `psql -v ON_ERROR_STOP=1 -f reversao.sql` (o bloco tem `BEGIN`/`COMMIT`; a guarda aborta com 23514 e a contagem
   de reservas não representáveis, sem alterar nada).
4. Reverter `prisma/schema.prisma` e `npm run db:generate`; voltar o código anterior.
Testado em `tests/integration/db/migracao-itens.test.ts` (o teste extrai e executa exatamente esse bloco).

## 6. Orientações ao desenvolvedor

- **T-2 (`repos/reserva.ts`)**: `criar` não grava mais `profissional_id/ocupado_ate/encaixe`; `criarItens` num único
  `INSERT … SELECT FROM unnest(…)` com `'confirmado'` LITERAL e `fim`/`ocupado_ate` calculados pela aplicação
  (`fim = inicio + duracao`); 23P01 só fora da transação, reconhecido por SQLSTATE **e**
  `reserva_item_sem_sobreposicao` (P2010 → `meta.driverAdapterError.cause.{originalCode, originalMessage}`).
  `reserva_item_mesma_reserva_sem_sobreposicao`, 23505 e 23514 nunca são capturados.
- **T-2 (`tests/support/sql.ts`)**: `inserirReserva` antigo quebra (grava colunas removidas) — hoje só
  `tests/integration/db/mensagem-reconciliacao.test.ts` falha no diretório `db` por isso; a versão compatível
  (reserva + 1 item, derivados coerentes, serviço criado no salão) o deixa verde. Os helpers locais dos testes da T-1
  mostram o INSERT mínimo válido.
- **Toda escrita de item** grava `atualizado_em = $agora` (relógio injetado) e, quando houver mensagem,
  `revisao = reserva.revisao + 1`; os derivados de `reserva` (`status`, `inicio`, `fim`, `cancelada_em`, `revisao`,
  `atualizado_em`) na mesma transação, depois do item.
- **Literais**: `consultaOcupacoes`, `listarConfirmadasQueCruzam`, `contarFuturasDaCliente`, `criarItens`,
  `atualizarItem` (`WHERE status = 'confirmado'`) e `PREDICADO_VIGENTE` mantêm status/tipo/estado literais e a expressão
  `tstzrange(i.inicio, i.ocupado_ate, '[)')` idêntica à da exclusion. Os SQLs de referência estão em
  `tests/integration/db/planos-itens.test.ts`; T-3/T-7 refazem os testes de plano com as funções reais.
- **Agenda (T-7)**: `i.inicio >= de - interval '1 day'` (M-2).
- **Seed/E2E (T-14/T-15)**: `e2e/suporte/fixtures.ts` hoje insere reservas SEM itens (a base E2E atual tem 2); no
  modelo novo toda reserva precisa de ≥ 1 item com derivados coerentes. A base E2E é recriada a cada execução, então
  a guarda não a afeta.

## 7. Evidências

| Comando | Resultado |
|---|---|
| `npx prisma validate` / `npx prisma format` | schema válido |
| `npm run db:generate` | cliente gerado (7.10.1) |
| base limpa `d050_scratch`: `prisma migrate deploy` + `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | 15 migrações aplicadas; "No difference detected" |
| cópia da base com seed (`pg_dump agenda_beleza` → `d050_seed`, só leitura na origem): `migrate deploy` + diff | aplicada; 22 reservas, 28 itens com profissional; diff vazio (exit 0) |
| `d050_mig` (modelo antigo, 60 mil reservas/96 mil itens/108 mil mensagens): migração em `BEGIN … ROLLBACK` com `\timing` e depois `migrate deploy` | ver Q9 (~8 s) |
| `npx vitest run --project integration tests/integration/db tests/integration/harness` (3×) | 18/19 arquivos, 373 testes verdes; único arquivo vermelho: `mensagem-reconciliacao.test.ts` (depende de `tests/support/sql.ts`, T-2) |
| `npx vitest run --project integration tests/integration/db/planos-itens.test.ts --silent=false` | 12/12; tempos nas Q4–Q8 |
| Controle negativo da reversão (linha `CREATE INDEX reserva_salao_id_profissional_id_inicio_idx` removida do bloco, depois restaurada) | CA-48 falha apontando o índice ausente |
| `npx eslint tests/integration/db tests/integration/harness/template.test.ts --max-warnings=0` | ok |
| `npx tsc --noEmit` | nenhum erro em arquivo da T-1; 16 erros em outros (R-1, abaixo) |
| Bases auxiliares `d050_scratch`, `d050_mig`, `d050_seed` | criadas e apagadas no PostgreSQL local |

Typecheck quebrado (R-1, esperado; donos no §9 do design): `src/server/repos/{reserva,reserva-alteracao,cliente}.ts`,
`prisma/seed.ts`, `tests/support/{factories,mensagens}.ts`, `tests/integration/reservas/{criar,encaixe}.test.ts`,
`tests/integration/reservas/alteracao/alteracao.test.ts`, `tests/integration/reservas/equipe/{equipe,concorrencia}.test.ts`,
`tests/integration/mensagens/registro.test.ts`. Quebram só em execução (SQL bruto com as colunas removidas, invisível
ao tsc): `src/server/repos/{agenda,disponibilidade,reserva,reserva-alteracao,mensagem,mensagem-sistema,cliente}.ts`,
`tests/support/{sql,reservas}.ts`, `e2e/suporte/fixtures.ts`, `prisma/seed/plano.ts`.
