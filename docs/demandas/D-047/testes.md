# D-047 (E7.2) — testes (Rodada 1)

Veredito: **APROVADO** (sem defeito aberto). Ambiente: branch feat/d-047-adaptador-whatsapp-real (não commitada), Node 24, PostgreSQL do compose, adaptador simulado/stub HTTP local.

## Comandos
- `npm run lint`: ok. `npm run typecheck`: ok (também depois do teste do tester).
- `npm run test:coverage`: exit 0, linhas 98,93% (limiar 90%); sem exclusões novas.
- Teste independente `src/server/integrations/whatsapp/tester-d047.test.ts` (21 casos, servidor `node:http` local): passa.
- Build/E2E/smoke: não executados (porta 3000 do usuário; ficam para a CI).

## CAs
- CA-1/2/3: POST `/v25.0/123456/messages`, Bearer, `messaging_product`, `to` só dígitos, `type:template`, nome/idioma por env nos 4 modelos, parâmetros na ordem, `profissional` vazio = `-`, id `messages[0].id` devolvido; `reserva:tipo:revisao` ausente do corpo. OK.
- CA-4/5: 500/502/429/130429/conexão recusada/200 sem id/401+190/131031/131057/3xx/lixo = temporário; 131026/132001/131049/código desconhecido em 400 = permanente; 5xx e 429 vencem o código. 3xx não seguido (1 só chamada ao servidor). OK.
- CA-6: servidor mudo, timeout 300 ms injetado: `timeout` em < 1,5 s, 1 chamada (sem retentativa). Padrão 10 s < 25 s (guarda do dev). OK.
- CA-7: telefone não BR, chave vazia, modelo desconhecido, parâmetro ausente: permanente, 0 requisições. OK.
- CA-8: token, link e telefone sentinelas ausentes de message/stack/JSON/cause e de console em todos os erros (corpo de erro do servidor continha o token). README/docs/.env.example sem segredo. OK.
- CA-9/10/11: `lerConfigReal({})` nomeia as 6 obrigatórias ordenadas; padrões v25.0/pt_BR; versão `abc` recusada; testes de env/check-env/worker/registry atualizados e verdes na suíte (a recusa antiga removida; sem testes enfraquecidos, conforme diff). OK.
- CA-12: `tests/integration/integracoes/whatsapp-real.test.ts` (pipeline D-024 + PostgreSQL) verde na cobertura; D-024/D-046 sem alteração.
- CA-13: `.env.example` com as variáveis; `docs/whatsapp-templates.md` com os 4 textos UTILITY, variáveis, exemplos sem PII; README com PENDENTE DE VALIDAÇÃO NA META (corpo, 1024/`-`, HTTP por código, idempotência por silêncio, 131030, `to` só dígitos). OK.
- CA-14: lint/typecheck/cobertura ok; build e smoke pendentes na CI.

## Risco aceito
Duplicidade em timeout pós-aceite (e 2xx malformado): inevitável sem idempotência na Meta; adaptador não retenta, pipeline reenvia; documentado. Aceitável (baixo, raro); mitigação futura é webhook de status.
Observação baixa (sem defeito): 401/403 com `error.code` 100 viram permanente (código conhecido vence o HTTP); improvável.

## NÃO validado (sem credencial real)
Formato real do corpo de template, regra de parâmetros e limite 1024, HTTP por `error.code`, comportamento de 131030/131047/132012, idempotência real, aprovação UTILITY do convite, versão v25.0 e a entrega efetiva. Tudo depende do spike E9.3.

Defeitos: nenhum.
