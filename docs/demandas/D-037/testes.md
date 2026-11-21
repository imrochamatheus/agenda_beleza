# D-037 (E6.3) - testes.md

## Rodada 1 (tester, independente)
Ambiente: branch feat/d-037-assinatura-estados (não commitada), Node 24, postgres do compose.

| Gate | Resultado |
|---|---|
| lint (`--max-warnings=0`), typecheck, build | passam |
| `npm run test:coverage` | 479 arquivos / 5383 testes passam; linhas 99,17% (domínio assinatura 100%; server/assinatura 93,15%) |
| Domínio em TZ=UTC e America/Sao_Paulo | 29/29 em ambos |
| Concorrência (job x evento, mesmo pagamento_id) x5 | 17/17 em todas as execuções, sem 40P01 |
| `npm run test:e2e` | NÃO EXECUTADO (BLOQUEIO EXTERNO): a porta 3000 é reocupada por `npm run dev` de um terminal do VS Code do usuário (pid 1424965); playwright.config exige porta livre (`reuseExistingServer:false`). Não encerrei o terminal do usuário. D-037 não tem UI nem toca e2e/ (git status limpo em e2e, prisma, reserva-publica, tenant, seed). |

CAs: CA-1..CA-18 cobertos pelos testes em `tests/integration/assinatura/` e unitários do domínio (todos verdes); regras PLAN (carência a partir da 1a falha sem reinício, +1 mês civil UTC, bissexto, teste não encurtado, regularização, cancelamento com acesso) verificadas na leitura de `maquina-estados.ts` e nos testes.
Achado do dev (resolver alvo sem trava, travar por id, reler): correto; a vigente é única por salão e `encerrada` é terminal, a releitura sob trava vê o commit anterior. Domínio sem imports proibidos (só `@/config/plano`), sem `Date.now`; relógio só na borda do handler. `agendamentoDisponivel`/`politicaDeOperacao` intactos.
S-1/S-2/S-3 documentadas em spec.md e design.md (não no README). Risco: S-1 médio-baixo (salão em teste sem cobrança fica 3 dias extras antes de suspender; reversível por constante), S-2 baixo, S-3 baixo (pagamento tardio sem reembolso, fica rastreável com aplicado_em nulo).

Defeitos: nenhum. Observação (baixa): ativa com `periodo_pago_ate` vencido sem evento de falha não transita; depende da E6.1/E6.2 enviarem `cobranca_falhou`.

Veredito: APROVADO condicionado a rodar `npm run test:e2e` com a porta 3000 livre (bloqueio de ambiente, não defeito).
