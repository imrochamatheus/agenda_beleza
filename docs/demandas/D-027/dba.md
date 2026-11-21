# D-027 — Parecer do DBA (T-1)

**Sem migração.** Medido em banco descartável com todas as migrações aplicadas (300 mil reservas, 500 mil linhas de `rate_limit_janela`).

## (a) `contarFuturasPorTelefone`
O índice parcial `reserva_cliente_confirmada_idx (salao_id, cliente_id, inicio) WHERE status = 'confirmado'` já existe. Consulta: `WHERE salao_id=$ AND cliente_id=$ AND status='confirmado' AND inicio > $agora AND chave_requisicao IS DISTINCT FROM $chave`. Mantenha o literal `'confirmado'`, senão o índice parcial não se aplica. EXPLAIN: Index Scan nesse índice, 3 buffers, 0,02 ms; `chave_requisicao` entra só como filtro. A `reserva_sem_sobreposicao` não é usada nem afetada (a contagem não é por profissional).

## (b) Limpeza em lote
O índice `rate_limit_janela_janela_inicio_idx` já existe. Forma recomendada: `WITH l AS (SELECT chave, janela_inicio FROM rate_limit_janela WHERE janela_inicio < $corte ORDER BY janela_inicio LIMIT 1000 FOR UPDATE SKIP LOCKED) DELETE FROM rate_limit_janela r USING l WHERE r.chave=l.chave AND r.janela_inicio=l.janela_inicio`. EXPLAIN: Index Scan nos dois índices, 1000 linhas em ~5 ms. Lote de 1000 está bom (curta duração de lock, pouco WAL); repita até apagar 0 linhas. Use `corte` injetado (UTC). Não exige tabela nova nem VACUUM manual.

## (c) Concorrência de `incrementarJanela`
`INSERT … ON CONFLICT (chave, janela_inicio) DO UPDATE SET contador = contador + 1` é atômico e não perde incremento; transações concorrentes na mesma chave serializam na linha. O DELETE só toca linhas com `janela_inicio < agora - (maior janela + 1 h)`, que nunca são incrementadas (a janela corrente é maior), então não há conflito; `SKIP LOCKED` evita espera mesmo assim. Sem risco de impasse: cada comando toca uma única linha de `rate_limit_janela`. Não chame `incrementarJanela` dentro da transação da reserva (preserva a ordem de locks).

## Teste sugerido
Integração: N incrementos paralelos da mesma chave resultam em contador N; limpeza ×2 em paralelo apaga cada linha uma vez e não toca janelas vigentes.
