# D-018 (E3.1) — Parecer do DBA (T-0)

Parecer: **aprovado, sem migração** (nenhum índice novo; T-0b não abre). Banco: PostgreSQL 17 (docker-compose), base descartável `dba_d018_scratch` (migrações aplicadas com `prisma migrate deploy` num banco limpo; base apagada ao final).

## Volume medido
2.000 salões (1.000 com `funcionamento_definido`, 42 linhas de funcionamento cada); 2 salões × 10 profissionais × 5.000 reservas = 100.000 reservas, `inicio = 2026-06-01 + g·7 h` (~4 anos, 30 min, sem sobreposição), 10% `cancelado`, resto `confirmado`/`concluido`/`nao_compareceu`; 1.501 bloqueios num salão. `ANALYZE` depois da carga. Consulta de 61 dias (2028-01-01..2028-03-02): ~188 reservas por profissional (~3,8%).

## Pendências 1–5 (ocupação e bloqueios)

**1. LATERAL × ANY.** O desenho justificou o LATERAL dizendo que o GiST não aceita `= ANY(array)`. Isso é impreciso: em *Bitmap Index Scan* o executor expande o array e o GiST é usado com as duas colunas (medido abaixo). Ambas as formas usam `reserva_sem_sobreposicao`. Decisão: **manter o LATERAL** (SQL do §3.3, sem alteração): ordenação e agrupamento por profissional naturais, um acesso por profissional independentemente da forma do plano. `= ANY($ids)` é equivalente e até mais barato neste volume (194 buffers contra 922; 0,8 ms contra 3,3 ms, por ler cada bloco do heap uma vez), e é alternativa aceitável se o desenvolvedor preferir; o literal de status e a expressão `tstzrange(r.inicio, r.ocupado_ate, '[)')` são obrigatórios nas duas. A justificativa do desenho no §1 deve dizer "determinismo do plano", não "GiST não aceita ANY".

SQL final aprovado (`consultaOcupacoes`):
```sql
SELECT x.pid::text AS profissional_id, o.inicio, o.ocupado_ate
  FROM unnest(${ids}::uuid[]) AS x(pid)
  CROSS JOIN LATERAL (
    SELECT r.id, r.inicio, r.ocupado_ate
      FROM reserva r
     WHERE r.profissional_id = x.pid
       AND r.salao_id = ${salaoId}::uuid
       AND r.status IN ('confirmado', 'concluido', 'nao_compareceu')
       AND tstzrange(r.inicio, r.ocupado_ate, '[)') && tstzrange(${de}::timestamptz, ${ate}::timestamptz, '[)')
  ) o
 ORDER BY x.pid, o.inicio, o.id;
```
Plano (10 profissionais × 61 dias, custom): `Nested Loop` → `Function Scan on unnest` + `Bitmap Heap Scan on reserva r` (loops=10, 188 linhas cada) → `Bitmap Index Scan on reserva_sem_sobreposicao`, `Index Cond: (profissional_id = x.pid) AND (tstzrange(...) && ...)`; `salao_id` é só Filter (defesa em profundidade, custo nulo). 928 buffers, 3,3 ms. Sem `Seq Scan on reserva`.
1 profissional × 1 dia: mesmo plano, 6 buffers, 0,05 ms.

**2. Plano genérico** (`PREPARE` com `uuid[], uuid, timestamptz, timestamptz` + `plan_cache_mode = force_generic_plan`): mesmo plano (`Bitmap Index Scan on reserva_sem_sobreposicao`, `tstzrange($3, $4, '[)')` na Index Cond), 922 buffers, 3,8 ms. Estável com `ANALYZE` só; não foi preciso `DROP INDEX` nem `enable_seqscan=off`. Distribuição aprovada como no §8.3 (inclusive `7 hours` e os 10% cancelados). Observação para o teste: reservas `cancelado` ficam fora do índice parcial; o predicado literal é o que o torna aplicável, por isso nunca parametrizar o status.

**3. Bloqueios.** `salao_id = $1 AND tstzrange(inicio, fim,'[)') && … AND (profissional_id IS NULL OR profissional_id = ANY($ids))` usa `Bitmap Index Scan on bloqueio_periodo_idx` (`salao_id` + `&&`), o `profissional_id` fica como Filter sobre as linhas do salão que cruzam o período (61 linhas, 5 buffers, 0,06 ms). SQL do §3.3 aprovado sem alteração.

**4. Índice novo:** não. `jornada` já coberta pela exclusion (`salao_id`/`profissional_id` + dia) e pela leitura por `profissional_id IN`; volume por profissional é de ≤ 6 linhas por dia.

**5. Asserções do teste de plano (CA-25):** proibir `/Seq Scan on reserva\b/`; exigir `/(Index Scan|Bitmap Index Scan) (using|on) reserva_sem_sobreposicao/` (o texto do plano é `Bitmap Index Scan on reserva_sem_sobreposicao`; `Index Scan using` só aparece em outras formas). Fazer o mesmo no plano genérico. Não exigir um tipo de nó além do índice: o Planner pode alternar Bitmap/Index Scan.

## Pendência 6 — `lerRegras` com `COLUNAS_FUNCIONAMENTO`
Sem migração; sem índice novo. `salao_funcionamento_sem_sobreposicao` (GiST `salao_id, dia_semana, int4range`) atende `f.salao_id = s.id` (documentado na D-020):
- `funcionamento_definido = true` (42 linhas): `Index Scan using salao_pkey on salao s`; subplano `Bitmap Index Scan on salao_funcionamento_sem_sobreposicao` (`Index Cond: salao_id = s.id`), `Sort` por `dia_semana, inicio_min`, `Aggregate`; 0,19 ms, 24 buffers, com 2.000 salões e 35.000 linhas na tabela.
- `funcionamento_definido = false`: `One-Time Filter: s.funcionamento_definido` e o scan de `salao_funcionamento` aparece como **`(never executed)`**; 0,04 ms. A subconsulta não executa no falso.
Estabilidade: o plano independe do número de salões (acesso por PK e por `salao_id`). SQL do §3.3 aprovado sem alteração; `COLUNAS_FUNCIONAMENTO` não deve ser copiado nem alterado.

## Impacto e reversão
Nenhuma mudança de esquema, migração, lock ou dado; reversão não se aplica. Todas as leituras são `SELECT` sem lock, sem ciclo de espera possível.

## Orientações ao desenvolvedor (T-3)
- Manter o texto literal `('confirmado', 'concluido', 'nao_compareceu')` e a expressão `tstzrange(r.inicio, r.ocupado_ate, '[)')`; `de`/`ate` como parâmetros de `timestamptz` são seguros.
- Lista de ids vazia → `[]` sem SQL (como no design). Ids como `uuid[]` por `Prisma.sql` (precedente `servico.ts:182`).
- Base de volume do teste: usar `INSERT … SELECT generate_series` e `ANALYZE reserva` antes do `EXPLAIN`. Os valores de `origem_reserva` são `publico|equipe` (não `cliente`); `cliente` exige `telefone_e164` válido (`^\+55[1-9][0-9]{9,10}$`); `salao_funcionamento_faixa_chk` exige `fim_min <= 1440`.
- `auditoria` é somente inserção: o teste não pode `TRUNCATE salao CASCADE` (a base por arquivo do harness é recriada, então não é preciso).

## Arquivos
Somente este `dba.md`. Nenhum arquivo de código alterado; sem teste existente quebrado.
