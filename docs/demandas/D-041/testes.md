# D-041 (E6.2) - testes - Rodada 1

Ambiente: branch feat/d-041-webhooks-mp (nao commitado), Node 24, postgres:17 (compose), MP simulado.

## Gates (reexecutados pelo tester)
- lint 0 avisos; typecheck ok; build ok (rota dinamica).
- npm run test:coverage: 510 arquivos / 6014 testes passando; linhas 98,76% (limiar 90%).
- Estabilidade x10 (webhook.test, webhook-concorrencia.test, webhook-repo.test): 10/10 verdes (36 testes), sem 23505/40P01.
- E2E: nao reexecutado (sem UI nova; porta 3000 ocupada, nao encerrada). docker/smoke.sh nao rodado, por instrucao.

## CAs (por teste e leitura do codigo)
CA-1 (webhook.test:26), CA-2 (:105,:122), CA-3 (:134), CA-4 (:70), CA-5 (:54 e webhook-repo), CA-6 (:147), CA-7 (:214,:231), CA-8 (:266), CA-9 (:159), CA-10 (:332,:348), CA-11 (webhook-concorrencia), CA-12/CA-13 (unit + webhook-estatico): todos PASSARAM.

## Foco de seguranca
- Invalido: origem_valida=false, 401, sem consulta/efeito; dedupe so no indice parcial (WHERE origem_valida): forjado nao bloqueia legitimo.
- Consulta ao provedor fora de transacao; persistencia antes; resultado gravado por CAS em `recebido`.
- Limite de invalidos so conta/barra invalidos (sem persistir acima de 120/min); eventos validos nao passam por ele: atacante nao trava legitimos (apenas perde-se o registro de invalidos acima do limite, aceitavel).
- Rota so chama tratarWebhook; repos unicos a tocar Prisma (lint). retorno.ts: so eventoId opcional.

## Observacoes (nao bloqueantes)
- OBS-1 (baixa): lease: entrega concorrente sobre `recebido` recente responde 200 sem processar. Se o processo da primeira entrega cair, a conexao dela cai e o MP reentrega; apos 2 min a reentrega reivindica. Risco residual pequeno; aceitavel.
- OBS-2 (baixa): redacao `\d{13,}` e recurso_id NULL com 13+ digitos: mais estrito que 13-19, aceitavel (um id numerico real do MP com 13+ digitos nao seria gravado em recurso_id, mas o processamento usa o id do corpo parseado, nao a coluna).
- OBS-3 (baixa): invalidos 413/400 e tipos desconhecidos legitimos compartilham o contador global.

Defeitos: nenhum.

## Veredito: APROVADO
