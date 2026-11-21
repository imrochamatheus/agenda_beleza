# D-036 — Design: seed (E9.2), home (E9.1) e E2E do fluxo público (E4.4)

## 1. Resumo e alternativas descartadas
- **Seed**: `prisma/seed.ts` (já na allowlist `ACESSO_AO_BANCO` do eslint, linha 15; sem exceção nova). Exporta `semear(deps, opcoes)` e `CREDENCIAIS_DEMO`; a casca CLI só roda quando o arquivo é o ponto de entrada (`import.meta.url === pathToFileURL(process.argv[1])`). Dados em módulos irmãos `prisma/seed/*.ts` (`dados.ts` UUIDs/constantes, `fotos.ts`, `salao-a.ts`, `salao-b.ts`). Chamam `garantirSuperAdmin`, `normalizarTelefoneBr`, `instanteDeHoraLocal`/`intervaloDeDiasInteiros` (`src/server/tempo/fuso.ts`), `processarImagem`, `integracoes().armazenamento`, `VERSAO_TERMOS`, `DIAS_TESTE`.
  - Descartado: importar `tests/support/factories.ts` (fora do bundle, instantes não idempotentes); `src/server/seed/**` (precisaria alterar a allowlist de lint sem ganho); tsx no Docker (imagem final não tem).
- **Bundle**: `build:node` ganha a entrada `prisma/seed.ts` e `e2e/suporte/preparar-banco.ts` (`--outbase=.` não serve para `src/*`; usar uma segunda chamada esbuild no mesmo script: `esbuild prisma/seed.ts e2e/suporte/preparar-banco.ts --bundle ... --outdir=dist/prisma`/`dist/e2e`). `npm run db:seed` = `build:node && node --env-file-if-exists=.env dist/prisma/seed.js`. Docker: o estágio final já copia `dist/` e `prisma/` → `docker compose exec app node dist/prisma/seed.js` (sem npm run build). Verificar que `prisma/` copiado não colide com `dist/prisma`.
- **E2E com banco (R-2)**: ordem Playwright é webServer → globalSetup, então NÃO usar globalSetup para criar banco. `test:e2e` = `next build && npm run build:node && node --env-file-if-exists=.env dist/e2e/preparar-banco.js && playwright test`. O preparar-banco: lê `E2E_DATABASE_URL` ou deriva de `TEST_DATABASE_URL` (nome `<base>_e2e`, ≤ 63 chars, falha se faltar), `DROP DATABASE IF EXISTS … WITH (FORCE)` + `CREATE`, `prisma migrate deploy` (via `executarPrisma`-equivalente com `DATABASE_URL` da base E2E), `semear()` + complemento E2E, `ARMAZENAMENTO_DIR` = `.armazenamento-e2e` (apagado e recriado). O `playwright.config.ts` calcula a MESMA URL com função pura compartilhada `e2e/suporte/ambiente.ts` (sem I/O) e a injeta no `webServer.env`. `reuseExistingServer: false` sempre (porta 3000 ocupada falha, evita banco errado). Descartado: webServer como array com comando shell composto (frágil, sem tipagem).
- **Isolamento**: sem restaurar estado global. Cada teste cria seus dados (telefone/e-mail únicos por `crypto.randomUUID`), via fixture `e2e/suporte/fixtures.ts` usando `pg` direto (e2e é tratado como teste pelo lint; sem Prisma). Testes que mutam usam horário "primeiro disponível" em dia distinto do de outros testes OU profissional próprio do complemento (sec. 4) para não disputar vaga; a ordem não importa. Suspensão e convites só no 3º salão/complemento.

## 2. Componentes
- `prisma/seed.ts`, `prisma/seed/{dados,fotos,salao-a,salao-b,complemento-e2e}.ts` (o complemento é exportado separado e NÃO é chamado pelo CLI).
- `src/app/page.tsx` + `src/app/page.test.tsx` (reescrito); usa `PRECO_MENSAL_CENTAVOS`, `DIAS_TESTE` de `src/config/plano.ts`, `formatarMoeda`, `ROTAS`, componentes de `src/components/ui`/layout. Estático. Sem literais "79"/"30" (teste estático em `src/app/page.test.tsx` lê o fonte).
- `e2e/suporte/{ambiente,preparar-banco,fixtures,axe,link-avaliacao}.ts`; specs `e2e/landing.spec.ts`, `e2e/publico-*.spec.ts` (`publico-reserva`, `publico-reserva-teclado`, `publico-conflito-captcha`, `publico-suspenso`, `publico-avaliacao-denuncia`). Mesmo projeto Playwright `mobile-chromium` (specs existentes `/dev/*` continuam; servidor passa a ter banco, compatível).
- `playwright.config.ts` (retries 0, env do webServer, `reuseExistingServer:false`), `package.json`, `.github/workflows/ci.yml`, `README.md`, `CLAUDE.md`, `docker-compose.yml` (nenhuma mudança esperada).

## 3. Interfaces
```ts
export const CREDENCIAIS_DEMO: { senha: 'Demo@12345'; gestorA; gestorB; profissionalA?; admin: {email:'admin@agendabeleza.example'; senha:string} };
export const IDS_DEMO: Record<string,string>; // UUIDs fixos (v4 literais), todos ids semeados
export type DepsSemente = { prisma: PrismaClient; agora?: Date; armazenamento: PortaArmazenamento; env?: NodeJS.ProcessEnv };
export async function semear(deps: DepsSemente, opcoes?: { admin?: {email:string;senha:string} }): Promise<{ salaoIds: string[] }>;
export function recusarProducao(env): void; // lança Error claro; CLI → exit 1
export async function semearComplementoE2E(deps): Promise<{ salaoSuspensoSlug: string }>;
```
- **Idempotência (RN-1)**: SQL bruto/`createMany({skipDuplicates})`/`upsert` por id fixo; nenhum DELETE/UPDATE de dado existente. Cada bloco é uma transação; datas relativas calculadas só se o id não existir (consulta prévia `findUnique` do salão: se existe, os blocos de reservas/avaliações/bloqueios são pulados inteiros, pois dependem de `agora`). Duas execuções paralelas: `ON CONFLICT (id) DO NOTHING` por linha.
- **Ordem (FK/exclusão)**: salao → usuario gestor (senha argon2 via `senha.ts`) → profissional → servico → servico_profissional → jornada → salao_funcionamento (+ `funcionamento_definido=true`) → bloqueio → cliente → consentimento → reserva (futuras a ≥ 1 dia e passadas, horários distintos por profissional, sem sobreposição; `ocupado_ate` = fim + buffer) → reserva_item (snapshot) → fotos → avaliacao (só de `concluido`, `criado_em` > fim da reserva, `publicacao_aceita_em`, `versao_termos`) → assinatura (A `em_teste`, B `ativa`; DBA dispensado, mas o dev confere as CHECKs lendo a migração de assinatura; se exigirem campo ausente, ambos `em_teste` e registrar em `dev.md`) → `garantirSuperAdmin` (sem TOTP; `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` ou par de demo).
- **Fotos**: SVG em código (gradiente nas cores de `globals.css`, texto-livre) → `processarImagem` → `armazenamento.gravar(chave determinística 'demo/<salaoId>/<n>.webp')` (reescrever o mesmo conteúdo é idempotente) → `salao_foto` com ids fixos e `envio` fixo. O CLI usa `integracoes().armazenamento` (env). Em teste de integração, injeta-se a porta simulada com diretório temporário.
- **Guarda**: `NODE_ENV=production` sem `SEED_PERMITIR_PRODUCAO=true` → erro antes de abrir conexão. `DATABASE_URL` ausente → erro nomeando a variável.
- **Complemento E2E**: cria o 3º salão (slug `e2e-suspenso`, `suspenso_manual_em=now`, perfil, 1 foto, 1 avaliação publicada), salão E2E isolado de mutação (`e2e-reservas` com 2 profissionais e vínculos parciais A+B ≠ C, para CA-14/15/16/19) e clientes/reservas `concluido` sob demanda via fixture (`criarReservaConcluida`). Salões A/B ficam só para leitura/login.
- **Link de avaliação**: `e2e/suporte/link-avaliacao.ts` chama `criarGeradorLink({ segredo: () => AVALIACAO_SEGREDO, appUrl })` com leitor/repos contra a base E2E. Como e2e não pode importar repos além do permitido pelo lint dos testes, o helper abre `obterPrisma` apenas se o lint de testes permitir; senão, usa `repos()` via `src/server/repos` (único import legítimo). O dev confirma com o lint; sem `eslint-disable`.
- **Variáveis do servidor E2E** (somente em `ambiente.ts`): `DATABASE_URL`, adaptadores `simulado`, `PROTECAO_LIMITE_IP_*`/`NUMERO=100000`, `RATE_LIMIT_SEGREDO`, `AVALIACAO_SEGREDO` (constante pública), `APP_URL=http://127.0.0.1:3000`, `VITRINE_COMPONENTES=true`, `ARMAZENAMENTO_DIR`, `STORAGE_ADAPTER=simulado`. `check-env` do servidor deve passar; o dev confere o schema de `src/server/env.ts`.
- **Captcha inválido (RN-17)**: ler a constante do widget simulado em `src/server/integrations/turnstile` (token considerado inválido) e importá-la em `e2e` (nunca copiar o literal).

## 4. Dados / DBA: NÃO acionar
Sem DDL, sem índice. Motivo: todas as tabelas existem; o seed usa as constraints existentes (exclusão `reserva_sem_sobreposicao`) como prova. Conferência das CHECKs de `assinatura` é tarefa do desenvolvedor (T-2).

## 5. Infraestrutura / DevOps: SIM
- CI job `e2e` (nome preservado): `services.postgres` (mesma imagem do compose, `POSTGRES_USER/PASSWORD/DB`, health check), `TEST_DATABASE_URL` apontando à base administrativa (papel com `CREATEDB`), `retries: 0` (já no config), `npm run test:e2e`; manter `timeout-minutes: 20` e medir. Garantir que `playwright install` continue no job. Upload do `playwright-report` em falha (opcional).
- `docker/` e `docker-compose.yml`: apenas documentar `docker compose exec app node dist/prisma/seed.js`; DevOps confirma que `dist/prisma/seed.js` existe na imagem e roda `sh docker/smoke.sh` (acrescentar a execução do seed ao smoke é opcional; recomendado: rodar duas vezes e conferir exit 0).
- `.gitignore`: `.armazenamento-e2e`.

## 6. Invariantes
- Escopo por salão: seed grava `salao_id` em tudo; CA-3 prova com `entrarDeVerdade` + `listar` tenant-scoped. E2E só usa rotas públicas, que já resolvem pelo slug.
- Exclusão anti-sobreposição: seed e fixtures inserem reservas reais; CA-16 usa a constraint como árbitro (inserção por fixture, nunca contornando).
- UTC e fuso: instantes via `fuso.ts`; B em `America/Manaus`; testes com `TZ=UTC` e `TZ=America/Sao_Paulo`.
- Adaptadores: tudo simulado; armazenamento só pela porta; sem credenciais reais.
- Soft delete/anonimização: seed inclui 1 cliente anonimizada com reserva (nome/telefone nulos, avaliação sem nome).
- Suspenso somente leitura: 3º salão via `suspenso_manual_em`; só tela.
- Idempotência: ids fixos e `ON CONFLICT`; mensagens/webhooks não se aplicam (sem worker; seed não enfileira nem registra `mensagem`).
- Auditoria do super admin: `garantirSuperAdmin` é bootstrap (sem ação auditada, como D-034); não se aplica nada além disso.

## 7. Riscos e decisões
- R-1 flakiness com retries 0: web-first assertions, `waitForTimeout` proibido (grep estático no lint de e2e ou teste), horários escolhidos dinamicamente, vagas separadas por teste. Rodar a suíte 2× local antes de entregar (CA-23).
- R-2 ordem webServer/globalSetup: resolvido pelo passo prévio (sec. 1); `test:e2e` falha explicitamente sem `TEST_DATABASE_URL`/`E2E_DATABASE_URL`. Consequência: `npx playwright test` isolado exige o banco preparado antes (documentar; o CLAUDE.md "Teste único (Playwright)" ganha o passo `node dist/e2e/preparar-banco.js`). Specs sem banco continuam funcionando contra a base preparada.
- R-3 fotos em disco compartilhadas: `ARMAZENAMENTO_DIR` absoluto único, derivado em `ambiente.ts`, usado pelo preparar-banco e pelo servidor.
- R-4 `src/generated/prisma` no bundle: `--packages=external` mantém `@prisma/client`; o cliente gerado em `src/` é bundlado (como o worker); verificar o seed rodando em container.
- R-5 estado temporal: o seed usa `agora` da primeira execução; o E2E recria a base a cada rodada, então a janela de 60 dias e a antecedência nunca expiram. Em demo longa, a disponibilidade futura pode esgotar (aceito; reexecutar em base nova).
- R-6 A home estática nova não usa banco, mas `src/app/page.test.tsx` muda; E2E existente `smoke.spec.ts` que dependa do texto "Em breve" deve ser atualizado (T-4).
- Dependência nova: nenhuma (esbuild, pg, sharp já presentes).

## 8. Estratégia de testes
- Unidade (Vitest): `page.test.tsx` (CA-9, 12, 13), teste estático do literal e de "Trinks", teste estático do README × `CREDENCIAIS_DEMO` (CA-8), `recusarProducao` (CA-4), geradores de dados puros (CA-7 telefones; sem sobreposição calculada), em `TZ=UTC` e `TZ=America/Sao_Paulo`.
- Integração (PostgreSQL real, `tests/integration/seed/`): CA-1, 2 (contagem em todas as tabelas semeadas duas vezes e em paralelo), 3, 5 (objeto no armazenamento; `GET /api/fotos/[id]` via handler), 6, 7 (constraint), CA-4 com CLI em processo filho.
- Playwright: CA-10, 11 (`landing.spec`), 14–22 (`publico-*`), 23 (rodar duas vezes), 24 (CI).
- Cobertura ≥ 90%: `prisma/seed.ts` está fora de `src/**` (não entra na métrica); a lógica pura que ficar em `src/` (home) é coberta. Nada excluído.

## 9. Tarefas
| T | Resp. | Dep. | Arquivos sob posse | Entregável / conclusão |
|---|---|---|---|---|
| T-1 | desenvolvedor | – | `prisma/seed.ts`, `prisma/seed/**`, `tests/integration/seed/**`, `src/**` testes unitários do seed (`prisma/seed/*.test.ts` incluídos no projeto unit se o vitest `include` permitir; senão em `tests/integration/seed/`) | `semear`, CLI, guarda, fotos, super admin; CA-1..7 verdes |
| T-2 | desenvolvedor | T-1 | `prisma/seed/complemento-e2e.ts` | complemento (3º salão suspenso, salão de reservas, helpers SQL de reserva concluída); confere CHECKs de `assinatura` |
| T-3 | desenvolvedor | – (paralela a T-1) | `src/app/page.tsx`, `src/app/page.test.tsx`, `e2e/landing.spec.ts`, `e2e/smoke.spec.ts` (se citar o placeholder) | CA-9..13 |
| T-4 | devops | T-1 | `package.json` (scripts `build:node`, `db:seed`, `test:e2e`), `playwright.config.ts`, `e2e/suporte/{ambiente,preparar-banco}.ts`, `.github/workflows/ci.yml`, `.gitignore`, `docker/smoke.sh`, `Dockerfile` (só se necessário) | passo prévio, banco `_e2e`, retries 0, `reuseExistingServer:false`, job `e2e` com postgres; `docker compose exec app node dist/prisma/seed.js` funcionando |
| T-5 | desenvolvedor | T-2, T-4 | `e2e/suporte/{fixtures,axe,link-avaliacao}.ts`, `e2e/publico-*.spec.ts` | CA-14..22; suíte completa verde 2× |
| T-6 | desenvolvedor | T-1, T-4, T-5 | `README.md`, `CLAUDE.md` | seção "Usuário de exemplo", credenciais, E2E com banco, comandos (CA-8, CA-23) |

Paralelo: T-1 ∥ T-3 ∥ T-4(parte de config/CI, sem depender do conteúdo do seed, mas só valida após T-1). T-4 e T-1 não partilham arquivos (`package.json` é só de T-4; T-1 não o altera). T-5 e T-6 sequenciais após as demais.

## Cobertura CA → tarefa → teste
CA-1..7: T-1/T-2 integração e unidade; CA-8: T-6 unidade estática; CA-9,12,13: T-3 unidade; CA-10,11: T-3 Playwright; CA-14..22: T-5 Playwright; CA-23: T-4/T-5 (2 rodadas); CA-24: T-4 (CI).
