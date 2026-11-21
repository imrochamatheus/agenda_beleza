# D-027 (E4.2) — Testes (Rodada 1, tester)

Ambiente: branch feat/d-027-protecao-publica (não commitada), Node 24, Postgres do compose, adaptadores simulados, 375x812.

## Gates (reexecutados)
- lint: ok. typecheck: ok. build: ok.
- `npm run test:coverage`: 375 arquivos / 4465 testes passam; linhas 99,49% (>= 90). Arquivo novo mais fraco: limpar-rate-limit.ts (83% stmts, 100% linhas). Sem exclusões novas.
- `npm run test:e2e`: 124 passam (inclui protecao*.spec.ts). `tests/integration/protecao`: 36 passam.

## CAs
CA-1..CA-2, CA-5, CA-7, CA-9..CA-12, CA-15..CA-17: PASSAM (testes de integração/unidade acima; CA-7 com barreira, 5 e 10 paralelas). CA-13/CA-14: PASSAM (E2E com e sem JS, axe).
CA-3, CA-4, CA-6, CA-8: lógica de limite passa (N+1 negado, IP/número, proxy 0 e 1), MAS sem HTTP 429 (ver DEF-2).

## Segurança
- XFF forjado: hops 0 ignora o cabeçalho; hops>=1 usa a N-ésima da direita. Ok.
- HMAC(salaoId:E.164) e sha256(ip): nenhuma chave em claro (CA-9 verificado por varredura). Ok.
- Turnstile antes de qualquer escrita, falha fechada; token ausente/inválido recusa sem cliente/reserva. Ok.
- Mensagem de futuras não revela reservas. Ok. Rate limit do GET não quebra sem JS (aviso renderizado no servidor).
- Testes alterados: mocks de next/headers e stubEnv apenas isolam IP/limite; asserções preservadas. O teste de 10 envios idênticos da D-026 sobe PROTECAO_LIMITE_NUMERO para 1000, o que mascara DEF-3. Correção da contagem de futuras sem chave coberta por teste.

## Defeitos
DEF-1 — IP indisponível com o padrão TRUSTED_PROXY_HOPS=0: todos os visitantes caem no balde único `desconhecido`.  Severidade: média (alta se o deploy padrão for para produção)  Estado: aberto
CA: CA-3/CA-8 (intenção "por IP"). Observado: com o padrão (compose/.env.example), 10 reservas e 60 consultas por 15 min valem para a plataforma inteira; um atacante esgota a página pública de todos os salões. Documentado no README e no design (R-2), mas o padrão entregue não protege por IP e vira DoS global. Sugestão: ler o IP do socket (route handler/proxy.ts) ou exigir/definir hops no compose e avisar no check-env em produção. Classe: escopo/configuração.

DEF-2 — Sem HTTP 429 (issue #38 CA-3/4/6/8, RN-4).  Severidade: média (desvio documentado: spec S-1, design S-1 e README; mantém-se só aviso pt-BR com status 200)  Estado: aberto, depende de aceite do líder/usuário
Resultado esperado: 429. Observado: 200 com aviso. Se a issue for literal, vira alta (CA não atendido). Recomendo o líder registrar aceite explícito na issue #38.

DEF-3 — Reenvios idênticos simultâneos (mesma chave de requisição) consomem cota do número antes do commit; com 10 envios, os acima de 5 voltam `limitado` em vez de `repetida`.  Severidade: baixa  Estado: aberto (risco já listado no dev.md)
Classe: idempotência/concorrência.

## Veredito: APROVADO COM RESSALVAS — nenhum defeito crítico ou alto aberto, gates e cobertura passam. O líder deve decidir sobre DEF-1 (padrão do proxy) e DEF-2 (aceite do 429) antes de encerrar; se o 429 for exigido, REPROVAR por CA não atendido.
