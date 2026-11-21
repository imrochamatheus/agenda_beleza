# D-022 — Desenvolvimento: clientes por salão com telefone E.164, busca e edição (E5.1)

Responsável: desenvolvedor. Sem migração, sem DBA, sem DevOps (dispensados pelo desenho). Sem commit.

## 1. Tarefas concluídas

| Tarefa | Arquivos |
|---|---|
| T-1 domínio puro, permissão e rotas | `src/server/clientes/{tipos,validacao}.ts` (+ `validacao.test.ts`), `src/server/auth/permissoes.ts` (+ teste de matriz com `cliente.contato`), `src/config/navegacao.ts` (+ teste: `ROTAS.cliente`, `ROTAS.devClientes`) |
| T-2 repositório | `src/server/repos/cliente.ts` (`upsert`, `buscar`, `atualizar`, `buscarPorTelefone`, `historico`, `buscarContato`; cabeçalho de travas A-6; `listar`/`renomear` intactos), `src/server/repos/tipos.ts` (`ReservaHistoricoDTO`), `src/server/repos/index.test.ts` (contratos de escopo dos métodos novos) |
| T-3 serviço, leitura e ação | `src/server/clientes/{servico,leitura,clientes.acao,erros-banco}.ts` (+ `erros-banco.test.ts`) |
| T-4 telas do painel | `src/app/painel/clientes/{page.tsx,[id]/page.tsx,acoes.ts,estado.ts,FormularioCliente,ListaClientes,BuscaClientes,HistoricoCliente,Clientes.module.css}` + testes `*.test.ts(x)` |
| T-5 integração | `tests/integration/clientes/{apoio,upsert,busca-lista,edicao,historico,contato,concorrencia,paginas-permissoes}` |
| T-6 vitrine e E2E | `src/app/dev/clientes/{page.tsx,acoes.ts,demonstracao.ts}` (+ testes), `e2e/clientes.spec.ts`, `e2e/clientes-sem-js.spec.ts` |
| T-7 documentação | `README.md` (seção "Clientes"), `CLAUDE.md` (parágrafo D-022 e três linhas na tabela de comandos), este arquivo |

## 2. Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` | passou (0 avisos) |
| `npm run typecheck` | passou |
| `npm run build` | passou (`/painel/clientes`, `/painel/clientes/[id]`, `/dev/clientes` listadas) |
| `npm run test:coverage` | 292 arquivos, **3747 testes passando**; linhas **99,79%** (limiar 90%); `src/server/clientes` 100% de linhas, `repos/cliente.ts` 92,85% de linhas |
| `npm run test:e2e` | **101 passed** (inclui os 8 novos de clientes) |
| `npx playwright test e2e/clientes.spec.ts e2e/clientes-sem-js.spec.ts` | 8 passed (teclado, axe 4.14.0 sem violações, sem rolagem horizontal, sem JS) |
| Laço ×10 de `tests/integration/clientes/concorrencia.test.ts` | 10 de 10 execuções com 8 testes passando |
| `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/clientes`, `format.test.ts` e `historico.test.ts` | 184 testes passando em cada |

## 3. Testes e CAs cobertos

| CA | Teste |
|---|---|
| CA-1 | `validacao.test.ts` (5 máscaras → `+5511987654321`; fixo) |
| CA-2 | `validacao.test.ts`; `upsert.test.ts` (10 telefones inválidos); `edicao.test.ts` ("entradas inválidas") |
| CA-3 | `upsert.test.ts` (nome atualizado/normalizado, mesmo id, `criada=false`, `atualizado_em` avança; nome inválido sem escrita) |
| CA-4 | `upsert.test.ts` (mesmo número em dois salões); `busca-lista.test.ts`; `historico.test.ts`; `paginas-permissoes.test.ts` |
| CA-5 | `edicao.test.ts` (403/401); `paginas-permissoes.test.ts` (profissional, sem sessão, super admin, navegação); registro em `edicao.test.ts` (CA-16) |
| CA-6 | `concorrencia.test.ts` (2 e 10 paralelos ×10; salões diferentes ×10) |
| CA-7 | `busca-lista.test.ts`; `edicao.test.ts` (anonimizada 404); `historico.test.ts` e `paginas-permissoes.test.ts` (detalhe sem formulário) |
| CA-8 | `validacao.test.ts`; `busca-lista.test.ts` (18 buscas e a ordem); teste de paridade JS × SQL (R-5) |
| CA-9 | `validacao.test.ts` (`lerPagina`); `busca-lista.test.ts` (45 clientes: 20/20/5/vazia, sem repetir nem omitir, ordem estável) |
| CA-10, CA-11 | `edicao.test.ts` (reserva, itens e mensagem idênticos; mesmos valores não escrevem; telefone em uso em qualquer máscara; outro salão e número de anonimizada) |
| CA-12 | `concorrencia.test.ts` (edição × edição, edição × upsert, mesma cliente, cruzada, e o caso determinístico com `pg_stat_activity`) |
| CA-13 | `historico.test.ts` (ordem, fuso SP e Manaus, virada de dia, snapshot com preço alterado, vazio, 60 → 50 e total 60); `format.test.ts` |
| CA-14 | `contato.test.ts` |
| CA-15 | `upsert.test.ts`, `edicao.test.ts`, `paginas-permissoes.test.ts` (`salaoId` forjado ignorado; salão inexistente) |
| CA-16 | `edicao.test.ts` (só `editarCliente`, `gestor`/`configurar`); `src/server/clientes` sem `next/*`; `acoes.ts` sem repositório (lint) |
| CA-17 | `e2e/clientes.spec.ts`, `e2e/clientes-sem-js.spec.ts` |
| CA-18 | `FormularioCliente.test.tsx`; E2E (resumo, links, `aria-describedby`) |

## 4. Decisões e desvios do desenho

- **Desvio do desenho no E2E (prop de componente cliente):** `FormularioCliente` recebe `hrefExistente?: string`, não uma função. Server Component não pode passar função a Client Component (a vitrine respondia 500). O padrão é `ROTAS.cliente(id)`.
- **`buscarPorTelefone` (novo método do repositório):** necessário à releitura da cliente vencedora fora da transação desfeita (A-4). Não estava na lista do §3.3.
- **`obter(ctx, id)` sem o parâmetro `agora`** que o desenho previa: não é usado.
- **Duração sem itens:** `formatarDuracao` recusa 0; se uma reserva vier sem itens (dado externo, impossível pela E3.2), a duração aparece como "—".
- **Ordenação por `COLLATE "C"`** na chave normalizada: determinística entre colações do banco ("Ana Clara" antes de "Anabela").
- **`xmax = 0` estável:** CA-6 ×10 (2 e 10 paralelos) sempre com `criada = true` em exatamente um retorno; plano B do desenho não foi necessário.
- **Forma real do erro 23505** (Prisma 7 + adapter-pg, consulta bruta): `PrismaClientKnownRequestError` `P2010` com `meta.driverAdapterError.cause.originalCode = '23505'` e `constraint.index = 'cliente_salao_id_telefone_e164_key'`. `ehViolacaoDeTelefoneUnico` reconhece essa forma (e a `P2002`); o teste determinístico prova a captura fora da transação.

## 5. Riscos e pendências

- **R-4 (gatilho do DBA atingido, comunicado ao líder):** `EXPLAIN (ANALYZE)` da consulta de lista/busca, num salão sintético, no PostgreSQL 17 do compose (transação com `ROLLBACK`):

  | Clientes no salão | `q` que casa todas | `q` sem resultado |
  |---|---|---|
  | 5.000 | 21 ms | 10 ms |
  | 50.000 | 212 ms | 89 ms |

  O limite do desenho (~50 ms) é ultrapassado só com 50 mil clientes num único salão, cenário irreal na v1. A causa é o Seq Scan com `normalize()` + `regexp_replace()` por linha.

  **Risco aceito pelo líder (decisão registrada):** R-4 fica aceito na v1, sem acionar o DBA e sem alterar o esquema. Caminho futuro, via DBA: coluna `nome_busca` ou índice funcional, se algum salão passar de ~20 mil clientes.
- Suspensão do salão: a edição declara `configurar`; o bloqueio real é da E6.4 (sem teste aqui, como no desenho).
- Nenhum TODO pendente no código.
