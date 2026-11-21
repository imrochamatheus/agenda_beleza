# D-018 (E3.1) — Implementação (desenvolvedor)

Branch `feat/d-018-disponibilidade-funcionamento`. Sem commit. Sem migração, rota, ação nem UI.

## 1. Tarefas concluídas e arquivos

**T-1 Domínio puro** — `src/domain/disponibilidade/`: `tipos.ts`, `calendario.ts` (`diaDaSemana`, `datasDoPeriodo`, `limitesDaJanela`, `periodoDeLeitura`, `gradeDoDia`), `intervalos.ts` (união e busca binária), `funcionamento.ts` (`validarFuncionamento`, `janelasDoDia`), `calcular.ts` (`calcularDisponibilidade`), `index.ts`. Testes: `calcular.test.ts`, `calcular-funcionamento.test.ts`, `funcionamento.test.ts`, `dst.test.ts`, `determinismo.test.ts`, `desempenho.test.ts`, `calendario.test.ts`, `intervalos.test.ts`; apoio dos testes em `apoio.ts` (só os `*.test.ts` o importam).

**T-2 Regra de camada** — `eslint.config.mjs` (bloco `DOMINIO`; o bloco geral e o de hosts passam a ignorar `src/domain/**`) e `tests/integration/lint/importacao-dominio.test.ts`.

**T-3 Contexto, predicado e repositório** — `src/server/tenant/context.ts` (+ `context.test.ts`): `ContextoDeLeituraDeAgenda`, `exigirLeituraDeAgenda`; `src/server/repos/publico.ts`: `ondeServicoOfertavel` (usado por `listarServicosPublicos`, comportamento inalterado); `src/server/repos/disponibilidade.ts` (seis leituras, `consultaOcupacoes` exportada; `lerRegras` em `$queryRaw` com `COLUNAS_FUNCIONAMENTO`); `src/server/repos/index.ts` (`Repos.disponibilidade`); testes `tests/integration/disponibilidade/{apoio.ts,repo.test.ts,plano.test.ts}`.

**T-4 Serviço** — `src/server/disponibilidade/{tipos,validacao,servico}.ts`, `validacao.test.ts`; `tests/integration/disponibilidade/{servico,isolamento,consultas}.test.ts`.

**T-5 Documentação** — `CLAUDE.md` (parágrafo D-018, obrigação da D-020 substituída, duas linhas na tabela de comandos) e este arquivo. README não alterado (sem comando de usuário novo).

## 2. Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` | verde (0 avisos) |
| `npm run typecheck` | verde |
| `npm run build` | verde |
| `npm run test:coverage` | **277 arquivos, 3536 testes passaram**; linhas **99,89%** (limiar 90%) |
| `TZ=UTC npx vitest run --project unit src/domain/disponibilidade` | 8 arquivos, 85 testes verdes |
| `TZ=America/Sao_Paulo npx vitest run --project unit src/domain/disponibilidade` | 8 arquivos, 85 testes verdes |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/disponibilidade/plano.test.ts \|\| break; done` | 10/10 verdes (9 testes, ~8,5 s cada) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/disponibilidade/consultas.test.ts \|\| break; done` | 10/10 verdes (10 testes) |
| `npx vitest run --project integration tests/integration/lint` | 5 arquivos, 374 testes verdes (os três `importacao-*` antigos, o de imagem e o novo) |
| `npx vitest run src/server/tenant/context.test.ts tests/integration/tenant` | 118 testes verdes (`publico.test.ts` e `contextos.test.ts` inalterados) |

Cobertura por arquivo novo (linhas): `calcular.ts`, `calendario.ts`, `funcionamento.ts`, `intervalos.ts`, `servico.ts`, `validacao.ts`, `repos/disponibilidade.ts`, `context.ts`, `publico.ts`: 100%. `index.ts` e `tipos.ts` (reexportações e tipos) não têm linhas executáveis. Nenhuma exclusão de cobertura nova.

E2E: não se aplica (sem UI); nenhum arquivo de `src/app/**` foi alterado.

## 3. Evidências

**CA-27 (desempenho do domínio)**, 10 profissionais × 61 datas, grade 5, 500 ocupações cada, aquecimento antes: `[CA-27] sem funcionamento: ms=430` e `[CA-27] com funcionamento: ms=198` (limite 2000 ms). Contador estrutural: o número de chamadas a `instanteDeHoraLocal` é igual com 1 e com 10 profissionais, com e sem funcionamento.

**CA-26/CA-41 (consultas SQL)**: `consultas.test.ts`, evento `query` do Prisma. 1 profissional × 1 data e 10 profissionais × 61 datas, com e sem funcionamento: **6 instruções** nos quatro cenários. Curtos-circuitos: entrada inválida 0; período longo 1; serviço indisponível 2; nenhum elegível 3; período fora da janela 3; `listarProfissionaisElegiveis` 2. Nenhum deles toca `reserva`.

**CA-25 (plano, volume 2 salões × 10 profissionais × 5.000 reservas, só `ANALYZE`, sem `DROP INDEX` nem `enable_seqscan = off`)**. Consulta de 61 dias, 10 profissionais, plano custom (1,9 ms; o genérico, 2,4 ms, é idêntico com `tstzrange($3, $4, '[)')`):

```
Sort  (actual time=1.714..1.771 rows=1880 loops=1)
  Sort Key: x.pid, r.inicio, r.id
  Buffers: shared hit=120
  ->  Nested Loop  (actual time=0.052..0.873 rows=1880 loops=1)
        ->  Function Scan on unnest x  (rows=10 loops=1)
        ->  Bitmap Heap Scan on reserva r  (actual time=0.042..0.060 rows=188 loops=10)
              Recheck Cond: ((x.pid = profissional_id) AND (tstzrange(inicio, ocupado_ate, '[)') && '["2028-01-01 00:00:00+00","2028-03-02 00:00:00+00")'::tstzrange) AND (status = ANY ('{confirmado,concluido,nao_compareceu}'::status_reserva[])))
              Filter: (salao_id = '2acc5d54-…'::uuid)
              ->  Bitmap Index Scan on reserva_sem_sobreposicao  (actual time=0.040..0.040 rows=188 loops=10)
                    Index Cond: ((profissional_id = x.pid) AND (tstzrange(inicio, ocupado_ate, '[)') && '["2028-01-01 00:00:00+00","2028-03-02 00:00:00+00")'::tstzrange))
Planning Time: 0.206 ms
Execution Time: 1.882 ms
```
1 profissional × 1 dia: mesmo plano, 5 buffers, 0,056 ms. Sem `Seq Scan on reserva` em nenhum dos quatro planos (asserção do teste, junto com `Index Scan|Bitmap Index Scan … reserva_sem_sobreposicao`). Cada execução do teste imprime os planos com o prefixo `[CA-25]` (`--silent=false`).

`lerRegras` com `COLUNAS_FUNCIONAMENTO` (1.000 salões de carga, metade com funcionamento): funcionamento informado → `Index Scan using salao_pkey on salao s` com subplano `Bitmap Index Scan on salao_funcionamento_sem_sobreposicao (salao_id = s.id)`, 0,198 ms; não informado → mesmo acesso a `salao`, e o subplano `Bitmap Heap Scan on salao_funcionamento` aparece `(never executed)`, 0,040 ms.

## 4. Testes e CA cobertos

| CA | Teste |
|---|---|
| CA-1, CA-11, CA-23 | `servico.test.ts` (elegibilidade) |
| CA-2, CA-4, CA-6, CA-7, CA-8, CA-10, CA-13, CA-14, CA-15, CA-16, CA-22 | `calcular.test.ts` |
| CA-3 | `calcular.test.ts` e `servico.test.ts` |
| CA-5, CA-9, CA-12, CA-19 | `servico.test.ts` |
| CA-17, CA-18, CA-36 | `dst.test.ts` |
| CA-20, CA-40 | `isolamento.test.ts` (e `repo.test.ts` para o funcionamento) |
| CA-21 | `validacao.test.ts`, `servico.test.ts`, `consultas.test.ts` |
| CA-24, CA-42 | `determinismo.test.ts`, `calcular-funcionamento.test.ts` |
| CA-25 | `plano.test.ts` |
| CA-26, CA-41 | `consultas.test.ts`, `repo.test.ts` (uma instrução por método) |
| CA-27 | `desempenho.test.ts` |
| CA-28, CA-30, CA-33, CA-34, CA-35, CA-37, CA-43, CA-44 | `calcular-funcionamento.test.ts`, `funcionamento.test.ts` |
| CA-29, CA-31, CA-32, CA-38 | `calcular-funcionamento.test.ts` e `servico.test.ts` |
| CA-39 | `servico.test.ts` |
| lint de camada (A-1) | `importacao-dominio.test.ts` |

## 5. Desvios do desenho e riscos

- **Sem desvio funcional.** Decisões de detalhe: (a) `calcular` também une (`unirMinutos`) jornada e funcionamento recebidos, por robustez (a forma canônica já vem do banco); (b) quando não há elegível ou o recorte à janela é vazio, o serviço chama `calcularDisponibilidade` com agendas vazias em vez de montar os dias à mão (as leituras 4–6 não são emitidas); (c) `agora` inválido lança `RangeError` antes de qualquer SQL; (d) o teste de volume carrega 100.000 reservas em ~6 s por `INSERT … SELECT generate_series`.
- Nota do DBA acatada: a justificativa do LATERAL é determinismo do plano (o GiST em `Bitmap Index Scan` aceita `= ANY`); o comentário de `repos/disponibilidade.ts` não afirma o contrário.
- Regra de lint de camada: a regex `^@/server/(?!tempo/fuso$)` proíbe também `@/server/tempo/fuso.ts` com extensão; nenhum arquivo do domínio a usa.
- `apoio.ts` dentro de `src/domain/disponibilidade/` entra na métrica de cobertura (100%) por estar em `src/`; só testes o importam.
- Sem TODO pendente.
