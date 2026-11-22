# D-048 — testes (Rodada 1)

Ambiente: clone limpo em /tmp (cópia de `git ls-files -co`, sem node_modules/.next/dist/coverage), Node v24.21.0 (.nvmrc), `COMPOSE_PROJECT_NAME=d048clone`, `.env` copiado de `.env.example` com `POSTGRES_PORT=5433` (e as URLs), `APP_PORT=3110`, `APP_URL=http://localhost:3110`, `E2E_PORT=3120` (a 3000 e a 5432 estavam ocupadas). Clone derrubado (`down -v`) e apagado; o postgres original continua no ar.

| Comando (no clone, seguindo o README) | Resultado | Código |
|---|---|---|
| `nvm use` | Node 24.21.0 | 0 |
| `npm ci` | ok | 0 |
| `npm run db:generate` | ok | 0 |
| `cp .env.example .env` (+ portas) | ok | 0 |
| `docker compose up -d --wait` | imagem construída do clone; app, worker e postgres healthy (3110, 5433) | 0 |
| `docker compose exec -e SEED_PERMITIR_PRODUCAO=true app node dist/prisma/seed.js` | "seed: ok (2 salões…)" | 0 |
| `npm run superadmin:criar` (2x, com SUPERADMIN_* no .env) | `criado` / `existente` | 0 |
| `npm run test:coverage` (com SUPERADMIN_* no .env) | 3 falhas (DEF-1 + 2 timeouts de carga), 569/572 arquivos | 1 |
| `npm run test:coverage` (SUPERADMIN_* vazios) | 572 arquivos, 6827 testes passam; linhas 98,24% | 0 |
| `npx playwright install chromium` | ok | 0 |
| `npm run test:e2e` (E2E_PORT=3120, suíte completa) | 345 passed | 0 |
| `sh docker/smoke.sh` (APP_PORT do .env) | smoke: OK | 0 |
| documentacao.test.ts com `VARIAVEL_FICTICIA` no .env.example | falha apontando a variável | 1 (esperado) |
| idem após remover; e removendo `PROTECAO_LIMITE_NUMERO` do README | passa (17) / falha apontando a variável | 0 / 1 (esperado) |
| `npm run lint` (repo, sem build) | limpo | 0 |
| `npm run typecheck` (repo) | limpo | 0 |

CAs: CA-1 atendido, com a ressalva do DEF-1. CA-2 OK (subseções E-mail, Turnstile, S3, Mercado Pago, WhatsApp com 4 modelos, com as variáveis exigidas). CA-3 OK (custo por mensagem da Meta em "Riscos"). CA-4 OK (teste automatizado; falha provada nos dois sentidos). Pendências de MP e WhatsApp visíveis (negrito e seção "O que não foi validado"). Nenhuma credencial real (grep de padrões). Portas: padrão 3000, CI inalterada (`.github` sem diff), specs sem 3000 fixo, `retries: 0` e `reuseExistingServer: false` mantidos.

## DEF-1 — Início rápido derruba o gate de cobertura   Severidade: alta   Estado: aberto
CA relacionado: CA-1
Passos: seguir o início rápido: definir `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` no `.env` e rodar `npm run superadmin:criar`; depois `npm run test:coverage`.
Esperado: exit 0. Observado: exit 1; `tests/integration/seed/seed.test.ts` (CA-6) falha (`antes` undefined), porque o seed lê `SUPERADMIN_*` do ambiente carregado do `.env` e cria outro e-mail. Com as variáveis vazias passa. Contorno: deixar as variáveis vazias nos testes ou passá-las só por `docker compose exec -e …`.
Classe de falha: isolamento de ambiente do teste. Correção sugerida: o teste zerar `SUPERADMIN_*` e/ou o README ordenar (superadmin:criar depois do coverage, ou via `exec -e`).

Observação (não é defeito): na primeira execução, `admin-saloes/suspensao` CA-3 e `reservas/concorrencia` CA-15(d) estouraram o timeout de 5 s por carga da máquina; passaram isolados e na execução completa seguinte (flaky sob carga).

## Veredito: REPROVADO (DEF-1 alta). Todo o restante passou; após corrigir DEF-1, basta reteste do passo de cobertura com SUPERADMIN_* no .env.

---

# Rodada 2 (reteste do DEF-1)

Clone limpo novo (`COMPOSE_PROJECT_NAME=d048clone2`, portas 5433/3110/3120), README literal, COM `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` no `.env` e `superadmin:criar` ANTES do gate. Demais variáveis opcionais que o README manda preencher: nenhuma outra; os `*_ADAPTER` ficam `simulado`.

| Comando | Resultado | Código |
|---|---|---|
| `npm ci`, `db:generate`, `docker compose up -d --wait` | ok | 0 |
| seed no container; `npm run superadmin:criar` (2x) | seed ok; `existente` nas duas (o seed no container já criou o super admin do `.env`) | 0 |
| `npm run test:coverage` (tentativa 1) | 1 timeout de 5 s (`admin-saloes/lista` CA-1), passa isolado | 1 |
| idem (tentativa 2) | 1 timeout de 5 s (`reservas/alteracao/concorrencia`), 3 execuções isoladas passam | 1 |
| idem (tentativa 3) | 572 arquivos, 6827 testes passam; linhas 98,22% | 0 |
| `npm run lint` / `npm run typecheck` (repo) | limpos | 0 / 0 |

`tests/integration/seed` passou nas 3 tentativas (DEF-1 verificado). Os testes que estouram o timeout padrão de 5 s mudam a cada execução, só com a máquina sob carga (load ~6; docker + 4 workers); não têm relação com a D-048 (é flaky pré-existente de teste de concorrência; recomenda-se tratar fora desta demanda). Clone derrubado e apagado; só o postgres original no ar.

DEF-1: verificado. **Veredito final: APROVADO** (ressalva: flakes de timeout sob carga no gate completo, não ligados à demanda).
