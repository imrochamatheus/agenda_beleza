# D-024 — Relatório do tester (E7.1, issue #31)

## Rodada 1 — Veredito: REPROVADO (1 defeito alto, gate de testes falhando)

(Estado do DEF-1: **verificado** na Rodada 2, abaixo.)

Ambiente: branch `feat/d-024-mensagens`, árvore sem commit; Node v24.21.0; PostgreSQL do `docker compose` (postgres); pg-boss real e WhatsApp simulado; `npm run db:generate` antes de tudo. Nada de produção foi alterado pelo tester; os testes temporários do exploratório foram apagados.

### Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run lint` (`--max-warnings=0`) | passou |
| `npm run typecheck` | passou |
| `npm run build:node` | passou |
| `npm run build` | passou (executado dentro de `npm run test:e2e`) |
| `npm run test:coverage` | **FALHOU**: 330 arquivos passando, 1 falhando (4125 de 4126 testes). Linhas **99,71%** (≥ 90%), medidas com `--coverage.reportOnFailure=true` (sem isso o Vitest não emite o relatório quando há teste falhando) |
| `npm run test:e2e` | 112 passando |
| `sh docker/smoke.sh` | OK (health 200, `referrer-policy`, sharp/WebP; o worker sobe com os filas `reconciliar-mensagens` e `whatsapp-reserva`, sem pacote faltando) |
| `for i in 1..10`: `tests/integration/mensagens/` inteiro (`--maxWorkers=2`) | 10/10, 137 testes cada |
| `for i in 1..10`: `mensagens/concorrencia` + `idempotencia`, e `worker/retry` + `worker/sigterm` | 10/10 (6 e 4 testes) |
| Unidade (`src/server/mensagens`, `src/lib/format`, `src/worker`, `src/server/integrations`) com `TZ=UTC`, `America/Sao_Paulo`, `Asia/Tokyo` | 520/520 nos três |
| CA-1 de integração (`envio.test.ts -t CA-1`) com os mesmos três `TZ` | passou nos três |

Ao fim: só o postgres no ar; porta 3000 livre.

### Defeito

**DEF-1 — README × teste da D-007 quebrado: `documentacao.test.ts` exige "3 templates aprovados"**   Severidade: **alta** (gate de testes falhando)   Estado: verificado (Rodada 2)
CA relacionado: definição de pronto (testes passando); CA-25 da D-007 (README × `.env.example` × `env.ts`).
Ambiente: branch `feat/d-024-mensagens`, Node 24.21.0, PostgreSQL local.
Passos: 1. `docker compose up -d postgres`; `npm run db:generate`. 2. `npx vitest run --project integration tests/integration/integracoes/documentacao.test.ts` (ou `npm run test:coverage`).
Esperado: README e teste concordam. Observado: `tests/integration/integracoes/documentacao.test.ts:143` falha com `expected '### WhatsApp Business Platform …' to contain '3 templates aprovados'`. A D-024 reescreveu o parágrafo do README ("os **templates aprovados**: confirmação, remarcação e cancelamento e, desde a D-024, o do convite de avaliação") e não ajustou o teste. O `dev.md` registra 4126 testes passando, o que não se reproduz (o README foi editado depois da última execução completa, ou o teste não foi reexecutado).
Classe de falha: documentação × teste (regressão em arquivo de outra demanda).
Correção sugerida (decisão do desenvolvedor, sem mudar o escopo): ajustar a asserção do teste para o novo texto, ou manter a frase "3 templates" e acrescentar o do convite separadamente. O `PLAN.md` fala em "3 templates"; o 4º vem da D-019.

Nenhum defeito crítico ou outro alto/médio/baixo encontrado.

### Critérios de aceitação

CA-1 a CA-27: todos com evidência passando nos testes do desenvolvedor, reexecutados por mim 10 vezes (laços acima) e por 11 cenários exploratórios próprios. Não há CA falhando. O único gate vermelho é o DEF-1; por isso o veredito é REPROVADO, apesar de os CAs funcionais estarem atendidos.

| CA | Status | Evidência |
|---|---|---|
| CA-1, CA-2, CA-3, CA-5, CA-7, CA-13, CA-14, CA-15, CA-17, CA-20, CA-21, CA-27 | passou | `mensagens/envio.test.ts` (worker real, fuso 23:30 local, backoff, reserva idêntica, anonimização, salão suspenso); exploratório: mesmos resultados |
| CA-4, CA-9, CA-25 | passou | `idempotencia`, `concorrencia` ×10; exploratório com 8 execuções simultâneas do mesmo job: 1 chamada, 1 tentativa, `enviada` |
| CA-6, CA-18, CA-22 | passou | `reenvio`, `isolamento`, `leitura` |
| CA-8, CA-10 | passou | `reconciliacao` (reentrega simulada por job real para `enviando` e `falhou/resultado_incerto`; o desenho aceitou isso no lugar de `SIGKILL`) |
| CA-11, CA-12 | passou | `convite.test.ts` e exploratório de vazamento (ver abaixo) |
| CA-16, CA-19 | passou | `registro.test.ts` (inclusive `23P01`) |
| CA-23, CA-24 | passou | `migracao.test.ts`, `db/mensagem-reconciliacao.test.ts`, `drift.test.ts`; o plano usa `mensagem_reconciliacao_idx` sem Seq Scan (o DBA consolidou os dois índices em um índice parcial único, decisão dele no `dba.md`) |
| CA-26 | passou | `estrutura.test.ts` (ESLint real), lint limpo, `.env.example`/`env.ts` sem variável nova (`git status`: ambos intactos) |

### Exploratório independente (teste temporário, apagado)

Todos passaram (9 casos):
- T2 (erro de banco ao gravar o sucesso): adaptador chamado 1 vez; a reentrega não reivindica; a reconciliação fecha como `falhou/resultado_incerto` com a tentativa `falha`; sucesso tardio corrige para `enviada` (A-11); `enviada` depois recusa reenvio e reentrega sem nova chamada. Nenhum reenvio.
- 8 execuções concorrentes do mesmo job: 1 chamada, 1 tentativa.
- Lote da reconciliação: 120 `pendente` antigas, só 100 processadas, mais antigas primeiro, na ordem.
- Fila indisponível no commit: reserva idêntica, mensagem `pendente`, log sem telefone, reconciliação cria o job e a mensagem é enviada (1 chamada).
- Gerador de link que lança com o link e o telefone na mensagem: `falhou/link_indisponivel`, sem chamada ao adaptador; nada vaza em tentativa, `erro_codigo`, `parametros` e logs; reenvio manual com gerador ok envia (tentativas numeradas 1, 2) e o link só aparece na chamada do simulado.
- Substituição: remarcação rev 2 substitui a rev 1 `pendente`; `enviada`, `falhou`, `enviando` e a mensagem de outra reserva/salão ficam intactas; sem consentimento nasce `nao_enviada` sem job; convite exige consentimento próprio; registro duplicado devolve `criada: false`, `precisaEnfileirar: false`.
- Anonimização antes do envio: `cancelada_anonimizacao`, telefone nulo, zero tentativas, zero chamadas; revisão divergente: `substituida`.
- `mensagensDaReserva`: só os 8 campos de RN-23; cancelamento em salão suspenso é enviado pelo worker real.
- Backoff real: 2 falhas temporárias forçadas, depois sucesso (tentativas `falha, falha, sucesso`, todas finalizadas, com `erro_codigo`), reserva idêntica.
- Nota: o `destinatario_e164` fica gravado em `mensagem` enquanto a linha não é terminal (RN-15, por desenho); o teste só verificou que ele não vaza em log, tentativa e `parametros`.

### Invariantes e revisão

- Isolamento entre salões: `salao_id` em todo predicado dos dois repositórios; `localizar` é a única busca sem escopo e devolve só `salaoId` e `estado`.
- Ordem de travas documentada no cabeçalho de `repos/servico.ts` (`mensagem` por último); sem impasse nas 10 rodadas de concorrência.
- Reconciliação e `listarPendentesAntigas` usam literais `'pendente'`/`'enviando'`.
- `ponta-a-ponta.test.ts` ajustado de forma estreita (só `mensagem`, `mensagem_tentativa`, `sim_whatsapp_*` saem da comparação).
- Cobertura: 99,71% de linhas; nenhuma exclusão nova; os testes novos verificam comportamento (estado, tentativas, chamadas, checksum de tabelas).
- Sem UI nova; E2E existentes verdes.
- O handler de produção sem gerador de link termina `falhou/link_indisponivel` para `convite_avaliacao` (previsto, R-7; não é defeito).

### Pendências e próxima ação

- Abertos: DEF-1 (alta).
- Próxima ação: o desenvolvedor corrige o teste ou o README (DEF-1) e roda `npm run test:coverage` completo, que deve terminar com código 0. Depois, nova rodada do tester: reexecução de `npm run test:coverage` e `documentacao.test.ts` (o resto já está verde e estável).

## Rodada 2 — Veredito: APROVADO

Reteste do DEF-1 e regressão. Ambiente igual ao da Rodada 1.

| Comando | Resultado |
|---|---|
| `npm run lint` | passou |
| `npm run typecheck` | passou |
| `npm run build` (dentro de `test:e2e`) | passou |
| `npm run test:coverage` (completo) | **exit 0**: 331 arquivos e 4126 testes passando; linhas **99,71%** (limiar 90%) |
| `npm run test:e2e` | 112 passando |
| `sh docker/smoke.sh` | OK |

- **DEF-1 verificado:** README agora diz "4 templates aprovados" (confirmação, remarcação, cancelamento e convite de avaliação) e `documentacao.test.ts:143` exige `'4 templates aprovados'`; o teste passa e a asserção continua a checar o conteúdo (não foi afrouxada).
- **Sem mudança em produção:** nenhum arquivo de `src/` tem data posterior ao relatório da Rodada 1; a correção tocou só `README.md`, `tests/integration/integracoes/documentacao.test.ts` e `docs/demandas/D-024/dev.md`. A estabilidade ×10, o exploratório e os `TZ` da Rodada 1 continuam válidos, por não haver alteração de código.
- Defeitos abertos: nenhum.
- Ao fim: só o postgres no ar; porta 3000 livre.
