# D-012: DevOps, correção paralela R-A (imagem Docker)

Autor: devops. Branch `feat/d-012-recuperar-senha` (base `ded2afa`), sem commit. Arquivos do desenvolvedor intocados (inclusive `next.config.ts`).

## 1. O que mudou e por quê

**Causa.** Desde a D-011, `next.config.ts` importa `./src/config/navegacao` (para `ROTAS` em `headers()`). O `next start` transpila o `next.config.ts` em tempo de execução (`/app/next.config.compiled.js`) e resolve esse import, mas o estágio `final` do `Dockerfile` não copia `src/` (decisão da D-003). Resultado: `Error: Cannot find module './src/config/navegacao'` e a app sai com código 1; o worker nunca sobe (depende da app saudável). O job `docker` da CI só fazia `compose config` e `docker build`, então passava.

**Correção escolhida: compilar o `next.config.ts` num `next.config.mjs` autocontido no estágio `build` e copiar só ele para o estágio `final`.**

| Opção | Avaliação |
|---|---|
| Copiar `src/config` (ou `src/` inteiro) no estágio final | Conserta hoje, mas o próximo import do config (outro arquivo de `src/`, ou um import transitivo de `navegacao.ts`) quebra de novo. Copiar `src/` inteiro contraria a decisão da D-003 (imagem só com artefatos). |
| Tirar de `next.config.ts` o import de `src/` | Duplica as rotas (perde a fonte única de `ROTAS`, D-009 RN-15) e não impede que alguém volte a importar. Mexe em arquivo do desenvolvedor. |
| `output: 'standalone'` | Embute o config no `server.js`, mas muda o entrypoint, a cópia de estáticos e o layout da imagem: grande demais para uma correção. |
| **Bundle do config com esbuild (escolhida)** | Tudo o que o config importa de `src/` entra no bundle; só pacotes ficam externos (`--packages=external`, resolvidos no `node_modules` de produção). Import futuro não exige mexer no `Dockerfile`. Sem dependência nova (esbuild 0.28.2 já é usado por `build:node`). `next.config.ts` fica como está. |

O bundle atual (3,2 kB) não tem nenhum `import`: o `import type` de `@/server/tenant/context` em `navegacao.ts` é apagado.

| Arquivo | Mudança |
|---|---|
| `Dockerfile` | Estágio `build`: após `build:node`, `npx esbuild next.config.ts --bundle --platform=node --format=esm --target=node24 --packages=external --outfile=dist/next.config.mjs` (antes do `npm prune`). Estágio `final`: deixa de copiar `next.config.ts`; copia `dist/next.config.mjs` para `/app/next.config.mjs`. |
| `docker/smoke.sh` | **Novo.** `docker compose up -d --build --wait --wait-timeout 180`; exige `GET /api/health` = 200 e `referrer-policy: strict-origin` em `/confirmar-email` e `/redefinir-senha`; em falha imprime `docker compose ps -a` e as últimas 80 linhas de log de app e worker e sai com 1. Não derruba nada (seguro localmente). `SMOKE_URL_BASE` e `SMOKE_WAIT_TIMEOUT` opcionais. |
| `.github/workflows/ci.yml` | Job `docker`: mantém `docker compose config` e `docker build --target final`; acrescenta o passo `Smoke do compose (build, up --wait, health)` (`sh docker/smoke.sh`) e `Derrubar o compose` (`docker compose down -v --remove-orphans`, `if: always()`). Nome do job inalterado; os outros cinco jobs intocados. Sem segredo, sem `.env` (padrões de `src/server/env.ts`, adaptadores simulados). |
| `README.md` | "Executar com Docker": `--build` depois de mudar o código, o smoke e a nota sobre o `next.config.mjs` na imagem. "CI": linha do job `docker` atualizada. |

Ferramenta nova: nenhuma. `curl` (host/runner) e esbuild já existentes.

## 2. Variáveis de ambiente
Nenhuma nova. `SMOKE_URL_BASE`/`SMOKE_WAIT_TIMEOUT` são opcionais do script, não da app.

## 3. Como reproduzir localmente
```bash
# porta 3000 livre (docker compose stop app, sem npm run dev/start)
sh docker/smoke.sh
docker compose stop app worker      # opcional: deixa só o postgres
# simulação exata da CI (sem .env, volume novo, sem tocar no volume local):
#   cópia limpa: git ls-files -co --exclude-standard | cópia para uma pasta fora do repo
#   COMPOSE_PROJECT_NAME=d012ci POSTGRES_PORT=55432 docker compose config && sh docker/smoke.sh
#   docker compose down -v --remove-orphans
```

## 4. Evidências (2026-11-20)

| Comando | Exit | Resumo |
|---|---|---|
| `docker compose up -d --build --wait` **antes** da correção | 1 | `dependency failed to start: container agenda_beleza-app-1 exited (1)`; log: `Error: Cannot find module './src/config/navegacao'`, `requireStack: ['/app/next.config.compiled.js', …]` |
| `sh docker/smoke.sh` com a correção (repo) | 0 | imagem `agenda-beleza:dev` construída; postgres, app e worker `Healthy`; `GET /api/health -> 200`; `/confirmar-email` e `/redefinir-senha -> referrer-policy: strict-origin`; `smoke: OK` |
| `curl -i /api/health` | | `HTTP/1.1 200 OK`, `{"status":"ok"}` |
| cabeçalhos | | `/confirmar-email` 200 + `Referrer-Policy: strict-origin`; `/redefinir-senha` 200 + `Referrer-Policy: strict-origin`; `/recuperar-senha` 200 sem o cabeçalho (esperado, RN-14) |
| worker | | `check-env: ambiente válido`, `worker.iniciado` (filas `assinatura-prazos`, `exemplo`, `reconciliar-mensagens`, `whatsapp-reserva`), `worker.heartbeat` |
| `docker compose exec app ls /app` | | `dist next.config.mjs node_modules package.json prisma prisma.config.ts` (sem `src/`, sem `next.config.ts`) |
| **Regressão:** `Dockerfile` de `HEAD` + `sh docker/smoke.sh` | 1 | `smoke: FALHOU: algum serviço não ficou saudável`, log `Error: Cannot find module './src/config/navegacao'`; `Dockerfile` corrigido restaurado em seguida |
| Simulação da CI: cópia limpa sem `.env`, `COMPOSE_PROJECT_NAME=d012ci`, volume novo; `docker compose config` + `sh docker/smoke.sh` + `docker compose down -v --remove-orphans` | 0 / 0 / 0 | migrações aplicadas numa base nova; `smoke: OK`; volume `d012ci_pgdata` e rede removidos |
| `actionlint` 1.7.x (`rhysd/actionlint:latest`, container descartável) em `ci.yml` | 0 | sem erros |
| `npm run lint` | 0 | |
| `npm run typecheck` | 0 | |
| `npm run build` | 0 | rotas incl. `/confirmar-email`, `/recuperar-senha`, `/redefinir-senha`, `/api/health` |
| Estado final | | `docker compose stop app worker`: só o postgres no ar (healthy); porta 3000 livre |

Os testes que verificam os cabeçalhos (`e2e/cadastro.spec.ts`, `e2e/recuperar-senha.spec.ts`, `tests/integration/auth/recuperacao-senha-paginas.test.ts`) não foram afetados: `next.config.ts` não mudou e eles não usam a imagem.

## 5. Riscos e pendências
- O job `docker` fica mais longo (sobe postgres, migra, espera a app): estimativa de 1 a 3 min a mais, dentro do `timeout-minutes: 20`. A primeira execução na CI confirma.
- Se o `next.config.ts` passar a importar em tempo de execução um pacote que só está em `devDependencies`, o `npm prune` o remove e a app não sobe; o smoke pega (falha visível, não silenciosa). Pacotes usados pelo config devem estar em `dependencies`.
- `docker/smoke.sh` usa a porta fixa 3000 do compose; localmente, libere-a antes.
- Nenhum segredo, nenhum deploy, nenhum volume não descartável removido (só o `d012ci_pgdata` da simulação).

## 6. Texto sugerido para o CLAUDE.md (o líder aplica)
1. No parágrafo "Project status", depois da frase da D-006: "D-012 fixed the app image (the final stage has no `src/`; the build stage bundles `next.config.ts` with esbuild into a self-contained `next.config.mjs`) and the `docker` CI job now also runs `sh docker/smoke.sh` (compose `up --build --wait`, `/api/health` 200 and the `Referrer-Policy` headers)."
2. Na tabela "Comandos e cobertura", nova linha depois de "Subir tudo (Docker)":
   `| Smoke da imagem | sh docker/smoke.sh | mesmo comando do job docker da CI: compose up -d --build --wait, /api/health 200 e referrer-policy: strict-origin em /confirmar-email e /redefinir-senha; porta 3000 livre; não derruba nada |`
3. Na linha "Subir tudo (Docker)", acrescentar: "depois de mudar o código use `--build` (sem ele o compose reaproveita a imagem `agenda-beleza:dev`)".
4. Nos invariantes ou nas observações de comandos: "`next.config.ts` pode importar de `src/` (vai empacotado na imagem); pacotes que ele usar em tempo de execução precisam estar em `dependencies`."
