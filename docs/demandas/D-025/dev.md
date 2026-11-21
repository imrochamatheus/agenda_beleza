# D-025 — Registro do desenvolvedor (E3.2: criar reserva)

## 1. Tarefas concluídas e arquivos

| Tarefa | Arquivos |
|---|---|
| T-2 | `src/server/reservas/{tipos,validacao,montar-itens,erros-banco}.ts` e `{validacao,montar-itens,erros-banco}.test.ts` |
| T-3 | `src/server/repos/{salao,profissional,servico,reserva}.ts` (métodos novos e cabeçalhos; os tipos novos ficaram nos próprios arquivos, `repos/tipos.ts` não mudou) |
| T-4 | `src/server/reservas/criar-reserva.ts`, `criar-reserva.test.ts` |
| T-5 | `tests/support/reservas.ts` (`criarCenarioReserva`, `entradaReserva`, `contarLinhas`, `instalarFalhaPorTrigger`, `esperarTrava`, `criarBarreira`, `instalarContadorDeComandos`, `inserirReservaDireta`) |
| T-6a/b/c | `tests/integration/reservas/{criar,revalidacao,encaixe,concorrencia,idempotencia,atomicidade,fuso,isolamento,estrutura}.test.ts` |
| T-7 | `README.md` (seção "Criação de reserva"), `CLAUDE.md` (status D-025 e 2 linhas de comando), este arquivo |

Nenhuma migração, variável de ambiente, workflow ou dependência. `factories.ts` e `mensagens.ts` intactos.

## 2. Experimento do erro `23P01` (Prisma 7)

INSERT bruto sobreposto em `$executeRaw`, `$queryRaw` e dentro de `$transaction`: `PrismaClientKnownRequestError`, `code = 'P2010'`, **sem `cause`**, `meta.driverAdapterError.cause = { originalCode: '23P01', code: '23P01', kind: 'postgres', originalMessage/message: 'conflicting key value violates exclusion constraint "reserva_sem_sobreposicao"', detail }`. Não há campo `constraint`: o nome só aparece nesses textos. `ehConflitoDeSobreposicao` exige SQLSTATE `23P01` **e** o nome entre aspas (e também reconhece o erro cru do `pg` com `code`+`constraint`). O CA-27 reconhece o erro real, e a fixture de unidade é a forma capturada.

## 3. Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` | passou, 0 avisos |
| `npm run typecheck` | passou |
| `npm run build` e `npm run build:node` | passaram |
| `npm run test:coverage` (completo) | exit 0; **344 arquivos, 4245 testes, todos passaram**; linhas **99,57%** (statements 99,06, branches 97,35, funções 99,36); `criar-reserva.ts`: 92,3% statements, 95,91% linhas (sobra: ramos de defesa `NaoEncontrado`/`servico_indisponivel` da consulta, `chave_repetida` sem reserva) |
| Só os novos | unidade `src/server/reservas`: 4 arquivos, 40 testes; integração `tests/integration/reservas`: 9 arquivos, 79 testes |
| Estabilidade ×10 (`concorrencia` + `idempotencia`) | 10/10 verdes (18 testes por rodada), sem `40P01`, `23505` nem 5xx |
| Fuso: `TZ=UTC`, `America/Sao_Paulo`, `Asia/Tokyo` em `src/server/reservas` + `fuso.test.ts` | 44 testes verdes nos três; `fuso`+`revalidacao` de integração verdes em UTC e America/Sao_Paulo |
| `npm run test:e2e` | 112 passaram |
| `sh docker/smoke.sh` | `smoke: OK` |

## 4. Mapa CA → teste

| CA | Teste |
|---|---|
| CA-1 | `criar.test.ts` (CA-1: A+B, intervalo 10, snapshot imutável); unidade `montar-itens.test.ts` |
| CA-2, CA-2b | `concorrencia.test.ts` (10 mesmo telefone; 10 telefones sem e com barreira `aposRevalidar`: 9× `23P01`; contagens por tabela) |
| CA-3 | `revalidacao.test.ts` (ocupado, bloqueio, serviço, profissional, antecedência) |
| CA-4 | `atomicidade.test.ts` (enfileirar falha + reconciliação D-024; cliente real da fila sem conexão) |
| CA-5, CA-14, CA-24 | `idempotencia.test.ts` |
| CA-6 | `atomicidade.test.ts` |
| CA-7, CA-8, CA-9 | `revalidacao.test.ts` (inclui paridade com `consultarDisponibilidade` em 57 horários) |
| CA-10 | `revalidacao.test.ts`, `isolamento.test.ts` (fotografia dos dois salões idêntica) |
| CA-11 | unidade `criar-reserva.test.ts`; `criar.test.ts` |
| CA-12 | `criar.test.ts` (o `enfileirar` vê a reserva já confirmada; rollback não enfileira) |
| CA-13 | `criar.test.ts`, `isolamento.test.ts` |
| CA-15 | `concorrencia.test.ts` (a, b, c, d, e; esperas por `pg_stat_activity`) |
| CA-16 | `encaixe.test.ts` |
| CA-17, CA-18, CA-19 | unidade `montar-itens`, `erros-banco`, `validacao` |
| CA-20 | `atomicidade.test.ts` |
| CA-21 | unidade `criar-reserva.test.ts`; `criar.test.ts` |
| CA-22 | `fuso.test.ts` (São Paulo, Manaus, meia-noite, horário de verão em New York) |
| CA-23 | `atomicidade.test.ts` (triggers por tabela, falha do gancho, falha pós-commit) |
| CA-25 | `estrutura.test.ts` (mesmo número de comandos com 1 e 3 serviços); plano: `tests/integration/disponibilidade/plano.test.ts` (existente, DBA §5) |
| CA-26 | `estrutura.test.ts` (log; imports; nada em `src/app`/`src/worker`) |
| CA-27 | `criar.test.ts` |
| CA-28 | laço ×10 acima |

## 5. Desvios do desenho e riscos

1. **`servicos.travarParaReserva` usa dois comandos**, não um: a trava (`ORDER BY s.id FOR SHARE OF s`) e, depois dela, a leitura dos vínculos. Um `EXISTS` no mesmo `SELECT` usaria o snapshot anterior à espera da trava (a reavaliação só rebusca a linha travada) e poderia ver um vínculo já removido. Há teste determinístico (`concorrencia.test.ts`, vínculo removido durante a espera → `profissional_indisponivel`). O CA-25 passou a afirmar "constante em relação ao nº de serviços" (igualdade entre 1 e 3 serviços), não um número fixo.
2. Tipos novos dos repositórios (`NovaReserva`, `NovoItemDeReserva`, `ServicoTravado`) ficaram nos arquivos de repositório, não em `repos/tipos.ts`.
3. **`lock_timeout`**: o DBA recomenda `SET LOCAL lock_timeout = '5s'` com `55P03` como erro transitório. Decisão do líder: manter a A-18 (sem `lock_timeout`, sem variável de ambiente, DevOps dispensado). **Não implementado**; fica como recomendação futura.
3b. **Texto do design afetado (A-3 e §3.4, só aqui):** `ServicoTravado.vinculado` não sai de `EXISTS` no `SELECT … FOR SHARE OF s`; sai de um 2º comando depois da trava (DBA §9 confirmou por experimento que o `EXISTS` devolve vínculo obsoleto após a espera). Regra: tudo que vem de outra tabela (vínculo, `ativo` do profissional, gancho de revalidação) é lido depois da trava, em comando novo; campos da própria linha travada são seguros. O cabeçalho de `repos/servico.ts` e o JSDoc de `travarParaReserva` registram isso e a posição do salão `FOR SHARE`.
3c. O upsert da cliente é o da D-022 (`DO UPDATE SET nome`), inalterado: serializa por telefone e o nome só muda se a transação confirmar (CA-6).
4. O reconhecimento do `23P01` depende do texto do driver (`originalMessage`), único lugar onde o nome da constraint aparece no Prisma 7. Se o adaptador mudar a forma, o CA-27 (sobre o erro real) quebra.
5. Risco aceito (R-1): a exclusion não cobre `bloqueio` (documentado no README).
6. Nenhum TODO pendente. Nada foi commitado.

## 6. Correção do DEF-1 (`40P01` sob carga) e Revisão 2 do design

Causa (dba.md "Revisão 2"; design.md "Revisão 2"): `INSERT … ON CONFLICT DO NOTHING` + exclusion `reserva_sem_sobreposicao` com ≥ 10 transações no mesmo horário formam ciclo nos speculative tokens. **A-20:** `RepoProfissional.travarParaReserva` passou de `FOR SHARE OF p` para `FOR NO KEY UPDATE OF p` (`src/server/repos/profissional.ts`); salão e serviços seguem `FOR SHARE`; sem migração, sem retry, sem advisory lock, sem promoção de trava. Cabeçalhos de `repos/profissional.ts` e `repos/servico.ts`, README e CLAUDE.md dizem que E3.4/E3.5 tomam `FOR NO KEY UPDATE` no profissional antes de qualquer comando que insira/atualize `reserva` para status ocupante; cancelar pode manter `FOR SHARE`.

### Testes alterados e novos
- `concorrencia.test.ts`: CA-2/CA-2b com largada simultânea (barreira ANTES de `criarReserva`) e 9 perdedoras `horario_indisponivel/revalidacao`; ramo `23P01` por reserva sobreposta gravada em OUTRA conexão (commit) dentro de `aposRevalidar`; CA-15 com marcador `FOR NO KEY UPDATE OF p` e novo caso "mesmo profissional espera, profissional distinto não espera" (por `pg_stat_activity`).
- `carga.test.ts` (T-6d, CA-29): 2 cópias (Ana e Bia) × 12 transações × 30 horários × 3 ondas (2160 requisições) + onda de 16 transações em 5 horários; pool Prisma próprio de 24 conexões (`instalarPoolDedicado`); checa `max_connections >= 60`; 0 rejeições, exatamente 1 `criada` por horário, demais `revalidacao`, 1 reserva `confirmado` por (profissional, horário), itens/consentimento/mensagem/clientes coerentes, teto de 20 s por onda. Duração medida: ~16 s por execução.
- CA-25 (`estrutura.test.ts`): compara 1 e 3 serviços (igualdade), não há teto fixo a ajustar; o comando a mais do vínculo em 2º comando já está contido.
- O teste de carga **reproduz** o defeito: com `FOR SHARE` restaurado temporariamente falhou (2 verificações independentes, 3/3 e 1/1); com `FOR NO KEY UPDATE` passa.

### Evidência (executada por mim)
- `npm run lint`, `typecheck`, `build`, `build:node`: passaram (o `dba-def1-proto.cjs` que quebrava o lint já foi removido).
- Laço ×10 de `concorrencia` + `idempotencia` + `carga` com `--maxWorkers=2`: 10/10 verdes (16 a 21 s cada).
- Cópias simultâneas do `carga.test.ts` (cada uma com 2160 requisições, pool de 24): **3 cópias × 3 rodadas = 9/9 verdes** (cerca de 24 s cada). Com **5 cópias** simultâneas, 3 passaram e 2 falharam com `53300 too many clients already` (5 × 24 > `max_connections = 100`): limite do servidor, não deadlock (0 `40P01` em todas as execuções). O design prevê 2 cópias e o teste checa `max_connections`; 5 cópias de 24 conexões não cabem neste compose. A versão anterior do teste (480 requisições por cópia, pool de 16) passou 15/15 com 5 cópias × 3 rodadas.
- `npm run test:coverage` completo: exit 0, **345 arquivos, 4248 testes** passaram, linhas **99,57%**.
- `npm run test:e2e`: 112 passaram (com a porta 3000 livre; um app do docker ligado reaproveitado pelo Playwright derrubou 1 teste e deixou o resto sem rodar: rodar `docker compose stop app worker` antes). `sh docker/smoke.sh`: OK.

### Divergências deliberadas com a spec
1. CA-2/CA-2b: as perdedoras concorrentes são `horario_indisponivel` com `causa: 'revalidacao'` (a spec dizia `23P01` no CA-2b); o `23P01` só aparece contra escritor sem a trava (teste de injeção, CA-27, CA-6, encaixe).
2. A trava do profissional é de escrita (`FOR NO KEY UPDATE`), não de leitura (`FOR SHARE`).
3. CA-29 (carga) é um critério novo, sem número na spec.
4. Vínculo lido em 2º comando (seção 5, item 3b).
