# D-046 (E6.6): dev

## Tarefas e arquivos
- T-1: `mercadopago/port.ts` (`ProvedorNaoSuportaAdiamento`, código `adiamento_nao_suportado`), `ambiente.ts` (3 `MP_*` + `APP_URL` https), `registry.ts` (repassa a config; `urlNotificacao` = `APP_URL` + `/api/webhooks/mercadopago`), testes `port`, `ambiente`, `registry`, `env`, `check-env`, `worker/iniciar`.
- T-2: `mapeamento.ts` (único lugar com formato do MP; `ESTRATEGIA_CRIACAO = 'com_plano'`, `sem_plano` testado), `webhook.ts` (+ testes). `webhook-simulado.ts` NÃO foi editado (só importa `TIPOS_MP`).
- T-3: `http.ts`, `real.ts`, `http.test.ts`, `real.test.ts` (servidor `node:http`), `tests/integration/integracoes/mercadopago-real-webhook.test.ts` (CA-13), `admin-saloes/extensao.test.ts` (stub antigo NaoImplementado trocado pelo real com `adiamento_nao_suportado`).
- T-4: `.env.example`, `README.md` (seção Mercado Pago, lista PENDENTE DE VALIDAÇÃO NO SANDBOX, linhas antigas de "recusado"), `documentacao.test.ts`. `docker-compose.yml` sem mudança (o `env_file` já repassa as `MP_*`); `CLAUDE.md` não editado.

## Gates
- lint, typecheck (inclui testes), build: passam.
- `npm run test:coverage`: 567 arquivos, 6682 testes passam; linhas 98,91% (mercadopago: 100%). A 1ª execução teve 1 timeout de 5 s em `salao/configuracoes.test.ts` (carga; passa isolado e na 2ª execução completa), sem relação com a demanda.
- `tests/integration/assinatura`, `admin-saloes` e `integracoes`: verdes (simulado + CA-13 com real).
- E2E e `docker/smoke.sh`: NÃO executados, porta 3000 ocupada por um `next-server` do usuário (não encerrado); sem UI/compose alterados. Ficam para a CI.

## Desvios e riscos
- Mensagem do webhook: `x-request-id` e `data.id` ausentes rejeitam (CA-2c); o montador do manifest omite pares ausentes.
- Corpo `data.id` aceito como texto ou número (comparação sem diferenciar maiúsculas).
- `notification_url` enviada nos dois montadores (NÃO CONFIRMADO, R-5). Adiamento: qualquer 400/409/422 no PUT vira `adiamento_nao_suportado`.
- Nada validado em sandbox real (README lista o que não foi confirmado).
