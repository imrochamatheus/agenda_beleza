# D-048 — devops

**Mudou:** `APP_PORT` (docker-compose `"${APP_PORT:-3000}:3000"`; `docker/smoke.sh` deriva `SMOKE_URL_BASE` de `APP_PORT` do ambiente ou do `.env`) e `E2E_PORT` (`e2e/suporte/ambiente.ts`: `portaE2E`/`origemE2E`, usados por `playwright.config.ts` (baseURL, `PORT` e `APP_URL` do servidor) e pelos specs que fixavam `127.0.0.1:3000`). Padrão 3000: a CI não muda. Ambas no `.env.example` e em `CHAVES_FORA_DO_RUNTIME` (`src/server/env.ts`). README reorganizado (índice, pré-requisitos, início rápido, tabela de variáveis, comandos, riscos, não validado). Teste CA-4/CA-2/CA-3 em `tests/integration/integracoes/documentacao.test.ts`. Nenhuma ferramenta nova.

**Evidência:** lint e typecheck limpos; documentacao.test.ts (17) e env.test.ts (67) passam; Playwright (smoke, entrar, admin-entrar) com `E2E_PORT=3110` numa cópia buildada: 13 passed; `APP_PORT=3110 sh docker/smoke.sh`: OK (app/worker derrubados, só o postgres no ar).

**Pendências:** CA-1 (clone limpo) fica com o tester; sem segredos novos. O smoke não tem checagem de "porta livre" própria (o compose falha ao publicar porta ocupada).
