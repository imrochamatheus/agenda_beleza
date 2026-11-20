# D-011 — Desenvolvimento: cadastro de gestor e salão com confirmação de e-mail e slug gerado (issue #13, E1.1)

Autor: desenvolvedor. Branch `feat/d-011-cadastro-gestor` (base `main` em `68ce771`), sem commit. Entradas: `issue-13.md`, `spec.md`, `design.md` (D-1..D-16).

## 1. Tarefas concluídas e arquivos

| Tarefa | Arquivos |
|---|---|
| T-1 slug puro | `src/lib/slug.ts`, `src/lib/slug.test.ts` (novos) |
| T-2 repositórios pré-contexto | `src/server/repos/cadastro.ts`, `src/server/repos/token-confirmacao.ts`, `tests/integration/auth/repos-cadastro.test.ts` (novos) |
| T-3 confirmação e reenvio | `src/server/auth/confirmacao-email.ts`, `src/server/auth/confirmacao-email.test.ts`, `tests/integration/auth/confirmacao-email.test.ts` (novos) |
| T-4 cadastro | `src/server/auth/cadastro.ts`, `src/server/auth/cadastro.test.ts`, `tests/integration/auth/cadastro.test.ts`, `tests/integration/auth/cadastro-concorrencia.test.ts` (novos) |
| T-5 login | `src/server/auth/login.ts`, `tests/integration/auth/login.test.ts` (alterados) |
| T-6 componentes e estados | novos: `src/app/(publico)/cadastro/{estado.ts, FormularioCadastro.tsx, FormularioCadastro.module.css, FormularioCadastro.test.tsx}`, `src/app/(publico)/confirmar-email/{estado.ts, FormularioReenvio.tsx, FormularioReenvio.module.css, FormularioReenvio.test.tsx}`; alterados: `src/app/(publico)/entrar/{estado.ts, FormularioEntrar.tsx, FormularioEntrar.module.css, FormularioEntrar.test.tsx}` |
| T-7 casca Next | novos: `src/app/(publico)/cadastro/{page.tsx, acoes.ts}`, `src/app/(publico)/confirmar-email/{page.tsx, acoes.ts}`, `tests/integration/auth/cadastro-paginas.test.ts`; alterados: `src/app/(publico)/entrar/{page.tsx, acoes.ts}`, `tests/integration/auth/paginas.test.ts` |
| T-8 E2E e documentação | `e2e/cadastro.spec.ts` (novo), `README.md` (seção "Cadastro do salão e confirmação de e-mail" e ajuste de "Usuário de exemplo"), este `dev.md` |

Não mudaram: `prisma/**`, `src/config/navegacao.ts`, `tests/support/**`, `src/server/env.ts`, `.env.example`, `next.config.ts`, `src/proxy.ts`, infraestrutura e CI. Nenhuma dependência nova. Nenhum `*.acao.ts` novo.

## 2. Comandos e resultados (Node 24.21.0, PostgreSQL do compose)

| Comando | Resultado |
|---|---|
| `npm run db:generate` | passou (Prisma Client 7.10.1) |
| `npm run lint` | passou, 0 avisos |
| `npm run typecheck` | passou |
| `npm run build` | passou. Rotas: `○ /`, `○ /_not-found`, `ƒ /api/health`, `○ /cadastro`, **`ƒ /confirmar-email`**, `ƒ /dev/componentes`, `ƒ /dev/mp-checkout`, `ƒ /dev/mp-checkout/decisao`, `ƒ /entrar`, `ƒ /painel`; `ƒ Proxy (Middleware)` |
| `npm test` | passou: 136 arquivos, 1879 testes |
| `npm run test:coverage` | passou: **linhas 99,88% (1704/1706)**, statements 99,26%, branches 98,11%, funções 99,55% |
| `npx playwright test e2e/cadastro.spec.ts e2e/entrar.spec.ts e2e/a11y-base.spec.ts` (após build, porta 3000 livre) | 33 passaram |
| `npm run test:e2e` (build + todos os specs) | 34 passaram |
| Laço 10× `npx vitest run --project integration tests/integration/auth/repos-cadastro.test.ts` (T-2) | 10/10 verdes (17 testes cada) |
| Laço 10× `npx vitest run --project integration tests/integration/auth/cadastro-concorrencia.test.ts` (T-4; cada execução já repete cada cenário 10×) | 10/10 verdes (4 testes cada) |
| Laço 10× `npx vitest run --project integration tests/integration/auth/login.test.ts tests/integration/auth/sessao-rbac.test.ts` (T-5, laço da D-010) | 10/10 verdes (36 testes cada) |
| Varreduras do desenho | `grep -rnE "integrations/email/(real\|simulado)" src/server/auth` vazio; `grep -n "'painel'" src/lib/slug.ts` vazio; nenhum `now()` do banco em regra de validade nos repositórios novos (só no comentário) |

Cobertura dos arquivos novos/alterados (linhas / branches): `src/lib/slug.ts` 100/100; `src/server/repos/cadastro.ts` 100/100; `src/server/repos/token-confirmacao.ts` 100/100; `src/server/auth/cadastro.ts` 100/97,7; `src/server/auth/confirmacao-email.ts` 100/100; `src/server/auth/login.ts` 100/100; `src/app/(publico)/cadastro/**` 100/100; `src/app/(publico)/confirmar-email/**` 100 (branches de `page.tsx` 87,5: o ramo `''` do `token` não-string no estado "expirado" é inalcançável, porque array sempre dá "inválido"); `src/app/(publico)/entrar/**` 100/100. Nenhuma exclusão nova em `vitest.config.ts`.

**Prova manual com Docker** (`docker compose up -d --build --wait`, depois um roteiro Playwright no navegador contra `http://127.0.0.1:3000`): cadastro em `/cadastro` → "Verifique seu e-mail"; slug gravado `studio-prova-docker-2` (a primeira execução do roteiro gravou `studio-prova-docker`); link lido de `email_log` por `docker compose exec -T postgres psql -U agenda agenda_beleza`; login antes de confirmar → "Confirme seu e-mail antes de entrar." com o botão "Reenviar link de confirmação"; `/confirmar-email?token=…` → 200 "E-mail confirmado"; reabrir → "Link já utilizado"; login → `/painel` com o nome do salão. Depois: `docker compose stop app worker` para liberar a porta 3000.

## 3. Testes e CAs cobertos

| CA | Testes |
|---|---|
| CA-1 | `cadastro.test.ts` "CA-1: salão com defaults…"; `repos-cadastro.test.ts` "CA-1: grava salão…"; `cadastro-paginas.test.ts` "CA-1 (casca)" |
| CA-2 | `slug.test.ts` "CA-2 (lógica)"; `cadastro.test.ts` "CA-2" (`studio-bela-2`, `-3` e slug só histórico → `espaco-nobre-2`); `repos-cadastro.test.ts` "CA-2 (repositório)" |
| CA-3 | `cadastro.test.ts` "CA-3" (gestor confirmado, não confirmado e profissional; 5 tabelas sem mudança; hash não chamado); `repos-cadastro.test.ts`; `cadastro-paginas.test.ts` "CA-3 (casca)"; `FormularioCadastro.test.tsx` (links) |
| CA-4 | `cadastro.test.ts` "CA-4"; `repos-cadastro.test.ts`; `cadastro-paginas.test.ts` "CA-4 (tela)" |
| CA-5 | `confirmacao-email.test.ts` (T+24h−1s, T+24h, T+24h+1s, reenvio pelo token); `repos-cadastro.test.ts` (limite em ms); `cadastro.test.ts` "CA-5"; `cadastro-paginas.test.ts` "CA-5 (tela)" |
| CA-6 | `login.test.ts` (CA-15 da D-010 atualizado + "D-011 CA-6/RN-16"); `cadastro.test.ts` "CA-6" (inclui login → `/painel` após confirmar); `cadastro-paginas.test.ts` "CA-6 (casca)"; `FormularioEntrar.test.tsx` (botão só com `reenvioDisponivel`, formulário irmão não aninhado) |
| CA-7 | `slug.test.ts` "CA-7 (unidade)" (todo item de `SEGMENTOS_RESERVADOS` no formato → `-2`); `confirmacao-email.test.ts` e `repos-cadastro.test.ts` ("Painel" → `painel-2` gravado) |
| CA-8 | `slug.test.ts` "CA-8"; `confirmacao-email.test.ts` ("!!!", "@@" → `salao`, `salao-2`) |
| CA-9 | `cadastro.test.ts` "CA-9"; `cadastro.test.ts` (unidade) normalização |
| CA-10 | `src/server/auth/cadastro.test.ts` (validação, sem banco); `tests/integration/auth/cadastro.test.ts` "CA-10" (sem efeitos, hash e porta não chamados; senha de 8 espaços entra) |
| CA-11 | `cadastro-concorrencia.test.ts` (10×); `repos-cadastro.test.ts` |
| CA-12 | `cadastro-concorrencia.test.ts` (10×); `repos-cadastro.test.ts` (nova rodada com transação concorrente real) |
| CA-13 | `cadastro.test.ts` "CA-13" (`token_hash` duplicado), "RN-11/RN-17" (5 rodadas perdidas, gatilho no PostgreSQL), corrida no e-mail dentro da transação, hash que lança; `repos-cadastro.test.ts`; `cadastro-paginas.test.ts` "RN-17 (casca)" (gatilho que faz o INSERT do token falhar) |
| CA-14 | `confirmacao-email.test.ts` (unidade e integração: outro tipo, ausente, vazio, 10 KB, desconhecido, profissional); `cadastro-concorrencia.test.ts` (dupla abertura 10×); `cadastro-paginas.test.ts` "CA-14 (tela)" |
| CA-15 | `confirmacao-email.test.ts` "CA-15"; corrida reenvio × consumo em `cadastro-concorrencia.test.ts` (10×) |
| CA-16 | `confirmacao-email.test.ts` "CA-16" (existente e inexistente; janela seguinte; contador 5); `cadastro-paginas.test.ts` (4º pedido pela ação) |
| CA-17 | `cadastro.test.ts` "CA-17" (`ErroEnvioEmail`); `cadastro-paginas.test.ts` "CA-17 (casca)" (`EMAIL_ADAPTER=real` sem SMTP); `confirmacao-email.test.ts` "RN-15" (reenvio) |
| CA-18 | `cadastro-paginas.test.ts` "CA-18" (dois salões criados e confirmados pelo fluxo; `/painel` de B só mostra B; `buscarPorId`/`renomear` de serviço de A → `NaoEncontrado`; serviço de A intacto) |
| CA-19 | `cadastro.test.ts` "CA-19", "CA-13"; `confirmacao-email.test.ts` "CA-19"; `confirmacao-email.test.ts` (unidade, token 10 KB não logado) |
| CA-20 | `FormularioCadastro.test.tsx`, `FormularioReenvio.test.tsx`, `FormularioEntrar.test.tsx`; `e2e/cadastro.spec.ts` (Tab, erros com `aria-describedby`, sem rolagem horizontal, axe zero; `/confirmar-email` sem token com `meta referrer=no-referrer`) |
| CA-21 | gates do §2 |

## 4. Desvios do desenho e riscos

Desvios (todos pequenos e aditivos):
1. **Exemplo da spec "Confirmar E-mail" → `confirmar-email-2` (CA-7/RN-9) contradiz a RN-8.** Pela RN-8, o hífen de "E-mail" vira hífen e a base é `confirmar-e-mail`, que não é reservada; o algoritmo não foi alterado. Os testes usam "Confirmar Email" → `confirmar-email-2` e registram "Confirmar E-mail" → `confirmar-e-mail`. **Para o líder/analista confirmar.**
2. `EstadoCadastro` ganhou `emailExistente: boolean`: o componente precisa saber quando mostrar os links "Entrar" e "Pedir um novo link de confirmação" junto do alerta (o desenho só dizia que eles aparecem).
3. `confirmacao-email.ts` exporta também `enviarLinkDeConfirmacao` (usado por cadastro e reenvio), `esquemaEmail` e `registrarLog`. O primeiro captura **também** falha ao obter a porta ou a `APP_URL` do ambiente (por exemplo, `EMAIL_ADAPTER=real` sem SMTP), para que nada lance depois do commit (RN-15).
4. `cadastro.ts` exporta `LIMITES_CADASTRO` (tetos da RN-7), usado pela ação para cortar os valores devolvidos. O log de `auth.cadastro` com `resultado: 'falha'` traz `detalhe` (`slug_esgotado` ou o nome da classe do erro, nunca a mensagem do driver).
5. `FormularioReenvio`, nos modos ocultos (`email-oculto`, `token`), mostra o erro de validação do e-mail num `Alert`, porque não há campo visível.
6. Validação: tabulação e quebra de linha no nome/nome do salão são recusadas (`\p{Cc}`) antes do colapso de espaços; espaços comuns e ` ` são colapsados.

Riscos conhecidos:
- O login devolve `reenvioDisponivel` para **qualquer** usuário não confirmado com a senha certa (o desenho só fala do ramo "não confirmado"). Um profissional não confirmado veria o botão, mas o reenvio não envia nada para ele (D-8, resposta uniforme). Hoje esse estado não ocorre (o profissional é confirmado no aceite do convite, E1.4).
- Concorrência: as provas de CA-11, CA-12, CA-14 e da corrida reenvio × consumo dependem do pool do Prisma do harness; ficaram estáveis em 10 execuções × 10 repetições.
- Os testes de falha forçada (`cadastro.test.ts`, `cadastro-paginas.test.ts`) criam e removem um gatilho na base do worker (no `finally`). A base é recriada a cada arquivo.
- Pendências do desenho mantidas (D-10, D-5/R-7, R-8, E1.3, E1.4, E2E com banco).

Sem TODO no código.

## 5. Texto sugerido para o `CLAUDE.md` (líder)

Em "Project status", depois da frase da D-010:

> D-011 (E1.1) added manager and salon sign-up with e-mail confirmation: `src/lib/slug.ts` (`slugBase`: NFD without diacritics, lowercase, `[^a-z0-9]+` → `-`, at most 50 chars, fallback `salao`; `escolherSlugLivre`: `base`, `base-2`, … skipping occupied slugs and `SEGMENTOS_RESERVADOS`, imported, never copied); pre-context repositories `src/server/repos/cadastro.ts` (one READ COMMITTED transaction: salon → manager via `ON CONFLICT (email) DO NOTHING` → slug loop of up to 5 rounds via `ON CONFLICT (slug) DO NOTHING` → token) and `src/server/repos/token-confirmacao.ts` (lock order `usuario` FOR UPDATE → `token`); `src/server/auth/confirmacao-email.ts` (32-byte token, only SHA-256 stored, 24 h, single use, link built from `APP_URL`, resend with a uniform answer and 3 requests per e-mail per fixed 15-min window in `rate_limit_janela`) and `src/server/auth/cadastro.ts` (server-side validation, argon2 hash before the transaction, e-mail sent synchronously after commit; a send failure never undoes the sign-up). `/cadastro` and `/confirmar-email` (dynamic; HTTP header `Referrer-Policy: strict-origin` set in `next.config.ts`, never `no-referrer`, which makes no-JS Server Action POSTs send `Origin: null` and fail; without `token` it shows the resend form) are public; `/entrar` offers "Reenviar link de confirmação" only after the correct password for an unconfirmed e-mail (`reenvioDisponivel`).

Na tabela "Comandos e cobertura", duas linhas novas:

| Objetivo | Comando | Observações |
|---|---|---|
| E2E do cadastro (D-011) | `npx playwright test e2e/cadastro.spec.ts e2e/cadastro-sem-js.spec.ts` | exige build prévio e porta 3000 livre; sem banco (`/cadastro` com envio vazio, `/confirmar-email` sem token, `Referrer-Policy: strict-origin` e os formulários sem JavaScript) |
| Estabilidade do cadastro (D-011) | `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/repos-cadastro.test.ts tests/integration/auth/cadastro-concorrencia.test.ts \|\| break; done` | CA-11, CA-12, CA-14 e a corrida reenvio × consumo |

## 6. Transferência (líder → tester)

```
DEMANDA: D-011 — cadastro de gestor e salão com confirmação de e-mail e slug gerado (issue #13, E1.1)
DE: desenvolvedor  PARA: tester
OBJETIVO: validar de forma independente CA-1..CA-21.
CONTEXTO NECESSÁRIO: `docker compose up -d postgres`; `npm ci && npm run db:generate`; adaptadores simulados (padrão). Link do e-mail em `email_log` (README, seção "Cadastro do salão e confirmação de e-mail"). Prova Docker: `docker compose up -d --build --wait`, /cadastro → link de email_log → /confirmar-email?token=… → /entrar → /painel; depois `docker compose stop app worker` para liberar a porta 3000.
CRITÉRIOS DE ACEITAÇÃO: CA-1..CA-21 (mapa no §3).
DECISÕES JÁ TOMADAS: desvios 1..6 do §4 (o 1 depende de confirmação: "Confirmar E-mail" gera `confirmar-e-mail` pela RN-8).
ARQUIVOS ENVOLVIDOS: §1.
EVIDÊNCIAS: §2 (lint, typecheck, build com ƒ /confirmar-email, 1879 testes, cobertura 99,88% de linhas, 34 E2E, laços 10×).
PENDÊNCIAS: riscos do §4.
PRÓXIMA AÇÃO: validar CAs (T-9).
```

## 7. Rodada 2 — correção de DEF-2 (alta) e DEF-1 (baixa)

Origem: `testes.md`, Rodada 1 (REPROVADA). Decisão do líder: revisão da D-15.

**Revisão da D-15.** A `<meta name="referrer" content="no-referrer">` (via `metadata.referrer`) foi substituída pelo cabeçalho HTTP `Referrer-Policy: strict-origin` na resposta de `/confirmar-email`.
- DEF-2: com `no-referrer`, o navegador mandava `Origin: null` no POST de formulário sem JS, e a checagem CSRF das Server Actions abortava com 500. Com `strict-origin`, o `Origin` volta a ser o normal.
- DEF-1: a meta chegava depois dos `<link>`/`<script>` e do preload do cabeçalho `Link`. O cabeçalho HTTP vale desde o primeiro byte. Com `strict-origin`, o Referer leva só a origem, sem caminho e sem token, também em mesma origem.

**Mecanismo.** `headers()` em `next.config.ts`, com `source: ROTAS.confirmarEmail`. O caminho vem de `ROTAS`, não de texto solto. Escolhi o mais simples: o proxy só roda em `/painel/**`. Desvio registrado: o desenho listava `next.config.ts` entre os arquivos que não mudam. A mudança foi autorizada pela decisão do líder.

**Arquivos alterados nesta rodada:**
- `next.config.ts`: cabeçalho.
- `src/app/(publico)/confirmar-email/page.tsx`: `metadata` sem `referrer`, comentário atualizado.
- `tests/integration/auth/cadastro-paginas.test.ts`: o teste da D-15 passa a exigir `metadata` sem `referrer`.
- `e2e/cadastro.spec.ts`:
  - A asserção da meta mudou para "nenhuma `meta[name=referrer]`".
  - Novo bloco "DEF-1/D-15": o cabeçalho `referrer-policy: strict-origin` aparece em `/confirmar-email` com e sem token e não aparece em `/cadastro` nem em `/entrar`. Além disso, nenhuma sub-requisição de `/confirmar-email?token=…` leva o token no Referer, só a origem (caminho `/`).

README: não cita a política de referrer, então nada mudou nele. `e2e/cadastro-sem-js.spec.ts` é do tester e não foi alterado.

**Os testes novos reproduzem a falha.** Voltei temporariamente ao `next.config.ts` original e refiz o build: os dois testes do bloco "DEF-1/D-15" falharam ("2 failed"). Com a correção, os dois passam.

**Evidências da regressão completa:**

| Comando | Resultado |
|---|---|
| `npm run lint` | passou, 0 avisos |
| `npm run typecheck` | passou |
| `npm run build` | passou; `○ /cadastro`, `ƒ /confirmar-email` |
| `npx playwright test e2e/cadastro-sem-js.spec.ts e2e/cadastro.spec.ts` | 9 passaram (**`cadastro-sem-js.spec.ts` 3/3**) |
| `npm test` | 136 arquivos, 1879 testes, todos verdes |
| `npm run test:coverage` | linhas **99,88% (1704/1706)** |
| `npm run test:e2e` | 39 passaram |
| Laço 10× `repos-cadastro.test.ts` + `cadastro-concorrencia.test.ts` | 10/10 verdes |
| Laço 10× `login.test.ts` + `sessao-rbac.test.ts` | 10/10 verdes |

Estado: DEF-2 e DEF-1 corrigidos. Aguardo o reteste.
