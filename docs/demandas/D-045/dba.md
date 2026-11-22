# D-045 (T-1) Parecer do DBA: listas globais do super admin

Decisão: **sem migração** (nenhum arquivo em `prisma/` alterado; `schema.prisma`, `drift.test.ts` e `template.test.ts` intactos).

## 1. Método
Banco descartável `d045_scratch` (PostgreSQL 17, todas as migrações aplicadas via `prisma migrate deploy`), apagado ao final. Volume: 102.000 `mensagem` (30 salões, 25.500 reservas, 4 tipos, 7 estados), 200.000 `auditoria` (365 dias, 6 ações, ~10% com ator só por e-mail, ~1/3 sem salão), `ANALYZE`. `EXPLAIN (ANALYZE)` com o `LIMIT 20` real; pior caso com `OFFSET 9980` (página 500).

## 2. Resultados (a) fila de mensagens
| Consulta | Forma | Tempo |
|---|---|---|
| sem filtro, p1 | JOIN salao/reserva/cliente + `count(*) OVER ()` | 81 ms (Seq Scan + WindowAgg de 102 mil) |
| `estado=falhou` | idem | 146 ms |
| `tipo=cancelamento` + `estado=enviada`, p500 | idem | **3.717 ms** (planner junta cliente antes de paginar, 745 mil laços) |
| as mesmas três | **página em CTE (LIMIT/OFFSET só em `mensagem`) + total em CTE `AS MATERIALIZED` (`count(*)` sobre `mensagem` com os mesmos filtros) + JOIN só das 20 linhas** | 20 / 32 / 30 ms |

Conclusão: `count(*) OVER ()` sobre o JOIN completo NÃO é aceitável (plano instável, 3,7 s). O total continua na MESMA instrução SQL, mas calculado só sobre `mensagem`. Os Seq Scan restantes são o `count` (15–20 ms a 100 mil), inevitáveis sem índice por filtro e abaixo de 200 ms; não justificam índice. Teste com `(criado_em DESC, id DESC)` e `(estado, criado_em DESC, id DESC)`: ganho só de 20 para 6 ms (M1) e 32 para 15 ms; custo de escrita na tabela mais quente do worker. Não criados.

Forma obrigatória para o desenvolvedor (T-4b):
```sql
WITH f AS (SELECT m.id, m.salao_id, m.reserva_id, m.tipo, m.estado, m.criado_em, ...
           FROM mensagem m
           WHERE (${estado}::text IS NULL OR m.estado::text = ${estado})
             AND (${tipo}::text IS NULL OR m.tipo::text = ${tipo})
             AND (${salaoId}::uuid IS NULL OR m.salao_id = ${salaoId}::uuid)
           ORDER BY m.criado_em DESC, m.id DESC LIMIT 20 OFFSET ${off}),
     t AS MATERIALIZED (SELECT count(*) AS total FROM mensagem m WHERE <mesmos filtros>)
SELECT f.*, s.nome, c.anonimizada_em, t.total
FROM f JOIN salao s ON s.id = f.salao_id
       JOIN reserva r ON r.salao_id = f.salao_id AND r.id = f.reserva_id
       JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
CROSS JOIN t ORDER BY f.criado_em DESC, f.id DESC
```
Sem `MATERIALIZED` o `t` é reavaliado por linha (loops=20, 280 ms). Se a página passar do último resultado, vem zero linhas e o total some: o serviço faz a leitura do total/páginas e reajusta (ou usa `LEFT JOIN`/segundo `SELECT` de `t`). Usar o `count` do `t` mesmo com a página vazia (`SELECT ... FROM t LEFT JOIN ...`) evita a segunda consulta.

## 3. (b) auditoria (200 mil linhas, `count(*) OVER ()` direto, sem JOIN)
sem filtro 88 ms (Seq Scan de 200 mil: é o `count`); dia civil 0,6 ms (`auditoria_ocorrido_em_idx`); salão 4,5 ms (`auditoria_salao_id_ocorrido_em_idx`); ação (33 mil linhas, p500) 27 ms; ator por e-mail (`ator_id IN (SELECT id FROM usuario WHERE email=…) OR ator_email_informado=…`) 12–46 ms (Seq Scan com `OR`, aceitável); ação + 7 dias 2,2 ms. Todos < 200 ms, ordenação `ocorrido_em DESC, id DESC` por top-N heapsort sobre o resultado filtrado (sem Sort caro: o índice `ocorrido_em DESC` já serve aos filtros seletivos). **Sem migração**; `count(*) OVER ()` aceito para auditoria (sem JOIN). Se a tabela passar de ~1 milhão de linhas, reavaliar (índices `(acao, ocorrido_em DESC)`, `(ator_email_informado)` parcial; total separado). A tabela é somente inserção (triggers), sem efeito sobre os planos.

## 4. (c) eventos de webhook e transições por salão
Índices existentes bastam: `webhook_evento_salao_id_recebido_em_idx (salao_id, recebido_em DESC)` serve `WHERE salao_id ORDER BY recebido_em DESC, id DESC LIMIT 51` (o `id` extra ordena só empates dentro do limite pequeno); transições: `assinatura_salao_id_idx` + `assinatura_transicao_assinatura_id_ocorrida_em_idx` (poucas assinaturas por salão, LIMIT 50). Sem risco de volume por salão. Sem migração.

## 5. (d) reenvio
Ordem: `mensagem WHERE id FOR UPDATE` (dentro de `reenviar`) → `UPDATE estado` → `INSERT auditoria`, mesma transação. `auditoria` é somente inserção, sem FK que trave `mensagem` (FK para `usuario`/`salao` só toma `FOR KEY SHARE` nessas linhas, que nenhum fluxo da D-024 trava em modo conflitante com a ordem acima); portanto `auditoria` vem depois de `mensagem` e não há ciclo. Reconciliação usa `FOR UPDATE SKIP LOCKED` só em `pendente`/`enviando`; a linha reenviada está `falhou` (a reconciliação nem a vê) e, depois do commit, `pendente` com `atualizado_em` novo (só reenfileirada depois de `PRAZO_PENDENTE_MS`). O worker faz claim `pendente → enviando` por UPDATE condicional: se perder a corrida contra o `FOR UPDATE` do reenvio, espera o commit e relê o estado. Dois reenvios simultâneos: o segundo espera a trava, vê `pendente` e responde `nao_falhou` sem auditar. A migração-índice `mensagem_reconciliacao_idx` (D-024) não é afetada. Teste de concorrência (CA-11) deve usar `pg_stat_activity`.

## 6. Reversão e orientações
Nada a reverter (sem migração). Orientações ao desenvolvedor: nunca `count(*) OVER ()` sobre JOIN em `mensagem`; usar a forma da seção 2; filtros enum por `m.estado::text = $x` como no design (não há índice parcial a preservar na fila global); teto de 500 páginas mantido; imprimir `[CA-15]` com tempos medidos em teste de integração com 100 mil mensagens (limiar 200 ms).
