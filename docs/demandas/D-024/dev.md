# D-024 — Desenvolvimento: outbox, envio, tentativas e backoff das mensagens de WhatsApp (E7.1, issue #31)

Branch `feat/d-024-mensagens`. Sem commit (a pedido do líder). T-1 (DBA) já entregue; aqui T-2 a T-8.

## 1. Tarefas concluídas e arquivos

| Tarefa | Entrega | Arquivos |
|---|---|---|
| T-2 | Porta com o 4º modelo, `formatarLista`, módulo puro | `src/server/integrations/whatsapp/port.ts` (+ `port.test.ts`); `src/lib/format.ts` (+ `format.test.ts`); `src/server/mensagens/{tipos,chave,config,elegibilidade,parametros}.ts` e os `*.test.ts` |
| T-3 | Repositórios de tenant e de sistema | `src/server/repos/mensagem.ts`, `src/server/repos/mensagem-sistema.ts`, `src/server/repos/index.ts` (`Repos.mensagens`), `src/server/repos/tipos.ts` (DTOs), cabeçalho de `src/server/repos/servico.ts` (posição da `mensagem` na ordem de travas) |
| T-4 | Serviços | `src/server/mensagens/{registrar,enfileirar,reenviar,leitura}.ts` e `*.test.ts` |
| T-5 | Envio, handlers, contexto do job | `src/server/mensagens/envio.ts` (+ test); `src/worker/handlers/{whatsapp-reserva,reconciliar-mensagens,tipos}.ts` e testes novos `whatsapp-reserva.test.ts`, `reconciliar-mensagens.test.ts`; `handlers.test.ts`; `src/worker/iniciar.ts` e `iniciar.test.ts` (`tentativasMaximas`); `src/server/queue/filas.ts` (só o comentário do contrato). `registry.ts` não mudou (as constantes exportadas têm o mesmo nome) |
| T-6 | Fábricas | `tests/support/mensagens.ts` (novo); `tests/support/factories.ts` não precisou mudar |
| T-7 | Integração e estrutura | `tests/integration/mensagens/{apoio,repos,registro,envio,reconciliacao,reenvio,isolamento,idempotencia,concorrencia,convite,leitura,migracao,estrutura}`; `tests/integration/worker/ponta-a-ponta.test.ts` ajustado |
| T-8 | Documentação | `README.md` (seção "Mensagens de WhatsApp", tabela de filas, formatadores, credenciais), `CLAUDE.md` (resumo da D-024 e 3 linhas de comandos), este arquivo |

## 2. Comandos e resultados

| Comando | Resultado |
|---|---|
| `npm run db:generate` | cliente Prisma 7.10.1 gerado |
| `npm run typecheck` | passou |
| `npm run lint` (`--max-warnings=0`) | passou |
| `npm run build` | passou |
| `npm run build:node` | passou (`dist/worker/main.js` 311 kb) |
| `sh docker/smoke.sh` (após T-5) | **OK**: compose sobe do zero, `/api/health` 200, `referrer-policy` nas duas páginas, sharp/WebP. O worker com o registry carrega sem pacote faltando na imagem: **DevOps não reaberto** |
| `npm run test:coverage` | 331 arquivos, **4126 testes passando**; cobertura de linhas **99,71%** (limiar 90%) |
| `npm run test:e2e` | 112 passando (nenhum E2E novo: a demanda não toca `src/app/**`) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/mensagens/concorrencia.test.ts tests/integration/mensagens/idempotencia.test.ts \|\| break; done` | 10/10, 6 testes cada |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/worker/retry.test.ts tests/integration/worker/sigterm.test.ts \|\| break; done` | 10/10, 4 testes cada |
| `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/mensagens src/lib/format.test.ts \|\| break; done` | passou nos dois (197 testes); o CA-1 de integração também passou com `TZ=UTC`, `America/Sao_Paulo` e `Asia/Tokyo` |
| `npx vitest run --project integration tests/integration/worker tests/integration/fila` | passou (45) |

Cobertura dos arquivos novos (linhas): `reenviar.ts` 100, `leitura.ts` 100, `enfileirar.ts` 100, `mensagem.ts` 96,15; `mensagem-sistema.ts` 97,77; os demais arquivos novos, 100 (ou fora das linhas não cobertas listadas pelo relatório).

## 3. Testes e CA coberto

| Arquivo | CA |
|---|---|
| `src/server/mensagens/*.test.ts` (unidade) | CA-14, CA-15, CA-17, CA-21 (log), CA-11 (link só em memória), classificação de erros (A-6), RN-21 (prazos), RN-2 (chave) |
| `src/worker/handlers/{whatsapp-reserva,reconciliar-mensagens}.test.ts`, `iniciar.test.ts` | RN-6, RN-9, A-16 |
| `tests/integration/mensagens/repos.test.ts` | CA-9 (reivindicação atômica), CA-10 (`SKIP LOCKED`, fechamento), CA-16, CA-18 (escopo), CA-22, A-3, A-4, A-11 |
| `registro.test.ts` | CA-4, CA-5, CA-13, CA-14, CA-16, CA-19 (rollback e `23P01`) |
| `envio.test.ts` | CA-1 (fuso, 23:30 local), CA-2 (backoff), CA-3, CA-5, CA-7, CA-13, CA-14, CA-15, CA-17, CA-20, CA-21, CA-27 |
| `reconciliacao.test.ts` | CA-8, CA-10 (reentrega simulada com job para `enviando` e `falhou/resultado_incerto`) |
| `reenvio.test.ts` | CA-6 |
| `isolamento.test.ts` | CA-18 (registro, reenvio, leitura e envio com telefones iguais nos dois salões) |
| `idempotencia.test.ts` | CA-4 (10 registros paralelos), CA-9 (6 execuções do mesmo job), RN-10 |
| `concorrencia.test.ts` | CA-25 |
| `convite.test.ts` | CA-11, CA-12 (link ausente de `mensagem`, `mensagem_tentativa`, `pgboss.job`, `pgboss.queue`, logs do worker e console) |
| `leitura.test.ts` | CA-22 |
| `migracao.test.ts` | CA-23 (`pg_enum` = `MODELOS_WHATSAPP`, simulado e real), CA-24 (planos com 6000 linhas) |
| `estrutura.test.ts` | CA-26 (ESLint real, `use server`, SQL só em `mensagem`/`mensagem_tentativa`, sem env) |
| `ponta-a-ponta.test.ts` (ajustado) | CA-27 / D-008 RN-17: a comparação exclui `mensagem`, `mensagem_tentativa` e `sim_whatsapp_*` |

## 4. Defeito achado e corrigido durante o desenvolvimento

Primeira versão de `enviarMensagem` envolvia o fechamento do sucesso (T2) no mesmo `try` da chamada ao adaptador: um erro de banco ao gravar o sucesso seria tratado como falha de envio e a mensagem voltaria a `pendente`, **reenviando o que já saiu**. O teste unitário "falha ao fechar a tentativa propaga" reproduziu a falha antes da correção; agora só a chamada ao adaptador (e a montagem do link) pode virar falha de envio, e o erro de T2 propaga (o job é reentregue, não reivindica e a reconciliação fecha como `resultado_incerto`, R-2 do desenho).

## 5. Desvios e decisões de implementação

- **Sem desvio do desenho.** Detalhes não fixados pelo desenho:
  - `reenviar` do repositório recebe `conferir: ConferirVigenciaFn` (a regra pura de `elegibilidade.ts`), para o repositório não importar `src/server/mensagens`. Ordem das recusas: cliente anonimizada, depois obsoleta.
  - Telefone: `substituida`, terminais e `cancelada_anonimizacao` anulam `destinatario_e164` (só `pendente` o guarda, RN-15).
  - Ordem de decisão no envio (`decidirNoEnvio`): anonimizada > obsoleta > falta de consentimento.
  - `substituirPendentes` seleciona por `ORDER BY id FOR UPDATE` e depois atualiza, para registros concorrentes percorrerem as mesmas linhas na mesma ordem (sem impasse, CA-25).
  - O log do `mensagem.fechamento_ignorado` e o de falha sem escrita usam `estado: null` (o estado real é desconhecido).
  - `profissional` ausente em `montarParametros` vira texto vazio (a reserva sempre tem profissional; é só proteção de tipo).
- **CA-10 sem `SIGKILL`:** o desenho aceita "ou simulando a reentrega". O teste cria jobs reais para uma mensagem `enviando` e outra `falhou/resultado_incerto` e prova que terminam `completed` sem chamar o adaptador.
- **CA-17, entrada inválida:** o telefone fora do padrão não chega à porta pelo banco (CHECK em `cliente` e `mensagem`); o caso é provado em unidade (`envio.test.ts`, com `validarEnvioModelo` real) e o "não consome falha forçada" já era do teste do simulado da D-007.
- **Estabilidade do CA-2:** os intervalos mínimos asseguram o backoff (1 s e 2 s configurados, medidos em `mensagem_tentativa.iniciada_em`); não se compara Δ2 > Δ1 porque o jitter do pg-boss e o polling de 0,5 s tornam isso instável.

## 6. Riscos conhecidos

- R-9 do desenho (remarcação gravada entre a leitura de T1 e a chamada ao adaptador envia texto da revisão antiga; a nova sai em seguida) e a janela da anonimização durante a chamada: aceitos no desenho, sem mudança.
- Um registro de revisão intermediária gravado depois de a maior já ter substituído fica `pendente`; o envio o encerra como `substituida/obsoleta` (RN-16, R-10). O teste de concorrência cobre isso.
- O handler de produção não tem `GeradorLinkAvaliacao`: `convite_avaliacao` termina `falhou/link_indisponivel` até a E4.5 (R-7; a E3.5 só deve registrar o convite depois).
- Nenhum TODO pendente; nenhum arquivo fora da posse atribuída foi alterado (`tests/support/fila.ts` e `factories.ts` ficaram intactos; `tests/support/mensagens.ts` é novo).

## 7. DEF-1 (tester): teste de documentação da D-007

`tests/integration/integracoes/documentacao.test.ts` (CA-25 da D-007) exigia "3 templates aprovados" no README, frase que a D-024 reescreveu. Correção: o README diz agora "4 templates aprovados" (confirmação, remarcação, cancelamento e convite de avaliação) e o teste foi alinhado a essa redação. Busca por `3 templates|três modelos|3 modelos|três templates` em `tests`, `src`, `README.md`, `CLAUDE.md`, `PLAN.md` e `docs/trinks-alinhamento.md`: só sobrou a linha 37 do `trinks-alinhamento.md` ("agora são quatro"), que já está correta.
Reexecução: `npm run lint` e `npm run typecheck` passam; `npm run test:coverage` termina com exit 0: 331 arquivos, 4126 testes passando, 99,71% de linhas. (O número anterior de 4126 do §2 estava errado: na época havia 1 falha e 4125 passando; o 4126 só vale após esta correção.)
