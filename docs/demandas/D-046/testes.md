# D-046 (E6.6): testes (Rodada 1)

Veredito: **APROVADO** (sem defeito crítico/alto; 2 observações baixas/médias).

## Gates (reexecutados pelo tester)
- `npm run lint`, `npm run typecheck` (com o teste novo do tester): passam.
- `npm run test:coverage`: 568 arquivos, 6692 testes passam; linhas 98,92% (>= 90%). Módulo mercadopago: `real.ts` 100% de linhas; `webhook.ts` (real) 100%; confirmado o 100% do módulo para linhas.
- Build/E2E/smoke: não executados (sem UI/compose; ficam para a CI; porta 3000 do usuário preservada).

## CAs (evidência: testes do dev reexecutados no coverage + teste do tester)
CA-1/1b/5/6/7/8/9/11 (`real.test.ts`, `http.test.ts`, `mapeamento.test.ts`), CA-2/2b/2c/2d (`webhook.test.ts`), CA-3/4 (`ambiente.test.ts`, `env.test.ts`, `check-env.test.ts`, `worker/iniciar.test.ts`), CA-10 (`registry.test.ts`), CA-12 (`.env.example`, `documentacao.test.ts`), CA-13 (`tests/integration/integracoes/mercadopago-real-webhook.test.ts`): todos passam. Revisão de código do webhook: manifest correto, HMAC-SHA256 hex, `timingSafeEqual` só com tamanhos iguais (v1 validado por regex de 64 hex), janela ±5 min, `ts` em s e ms, campos ausentes rejeitados, nunca lança. Cliente HTTP: Bearer, timeout 10 s, POST só repete em 429/conexão (não em 5xx/timeout), PUT não repete, erros fixos sem corpo do provedor.
Teste independente acrescentado: `src/server/integrations/mercadopago/tester-vazamento.test.ts` (status 400..503 sem token/corpo bruto em message/cause/stack/JSON; webhook com ts s/ms, +-5min, segredo errado, v1 curto/malformado, request-id vazio, data.id divergente): 10 passam.
Token: grep em src/tests/README/.env.example sem token real (só placeholders de teste e nomes de variável).
D-040/041/042/044 e `integracoes`: verdes no coverage (simulado + CA-13 com real); testes antigos atualizados não foram enfraquecidos (apenas trocam a expectativa "recusado/NaoImplementado" pela nova exigência).

## Observações (não bloqueiam)
- OBS-1 (média, desvio avaliado): qualquer 400/409/422 no PUT de adiamento vira `adiamento_nao_suportado`; um 400 por outra causa (ex.: id/estado inválido) fica mascarado. Falha segura (visível, sem efeito), aceitável até o sandbox; recomendável estreitar após conhecer o corpo de erro real.
- OBS-2 (baixa): `ts < 1e11` tratado como segundos (heurística); README já lista ts s/ms como pendente.

## NÃO validável sem credencial real
Tudo o que o README lista como PENDENTE DE VALIDAÇÃO NO SANDBOX: criação com plano sem cartão (D-1, risco alto), PUT `next_payment_date`, enumerações de `authorized_payments`, `X-Idempotency-Key`, unidade de `ts`, `data.id` minúsculo, `notification_url`, semântica de datas. Comportamento real do MP só no spike E9.3. README confirmado honesto (lista presente).
