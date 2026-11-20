# D-011 — Testes: cadastro de gestor e salão com confirmação de e-mail e slug gerado (issue #13, E1.1)

Autor: tester. Entradas: `issue-13.md`, `spec.md` (RN-1..RN-20, CA-1..CA-21; RN-9/CA-7 corrigidas pelo líder: "Confirmar Email" → `confirmar-email-2`), `design.md` (D-1..D-16, R-1..R-13), `dev.md` (§2..§6).

## Rodada 1

### Ambiente

| Item | Valor |
|---|---|
| Branch / commit | `feat/d-011-cadastro-gestor`, base `68ce771` + mudanças não commitadas do desenvolvedor |
| Node | 24.21.0 |
| PostgreSQL | `postgres:17` do `docker compose` (serviço `postgres`) |
| Next / React | 16.4.6 / 19.3.1 |
| Playwright | 1.65.1, Chromium, projeto `mobile-chromium` (375×812) |
| Adaptadores | todos `simulado` (`.env` de `.env.example`) |
| Banco limpo para a prova manual | `agenda_tester_d011`, criado do zero, `npm run db:migrate:deploy` (todas as migrações aplicaram), `next start` do build sobre ele |

### Gates (reexecutados pelo tester)

| Comando | Resultado |
|---|---|
| `npm run db:generate` | passou (Prisma Client 7.10.1) |
| `npm run lint` | passou, 0 avisos |
| `npm run typecheck` | passou |
| `npm run build` | passou; `○ /cadastro`, **`ƒ /confirmar-email`** (dinâmica, R-6), `ƒ /entrar`, `ƒ /painel` |
| `npm test` | passou: 136 arquivos, 1879 testes |
| `npm run test:coverage` | passou: **linhas 99,88% (1704/1706)**; statements 99,26%, branches 98,11%, funções 99,55% |
| `npm run test:e2e` (porta 3000 livre) | passou: 34 testes (antes do spec novo do tester) |
| `npx playwright test e2e/cadastro-sem-js.spec.ts` (spec novo do tester) | **2 falharam, 1 passou** (DEF-2) |
| `npm run db:migrate:deploy` em banco vazio (`agenda_tester_d011`) | passou: todas as migrações aplicadas |
| Laços 10× | ver "Estabilidade" abaixo |

Cobertura: `vitest.config.ts` sem alteração (nenhuma exclusão nova). Arquivos novos com 100% de linhas; único branch não coberto relevante em `cadastro.ts:129` (`'desconhecido'` para erro que não é `Error`), aceitável. Os testes novos verificam comportamento (contagens de linhas nas 5 tabelas, `token_hash` = SHA-256 do link, relógio injetado nos limites de 24 h, logs capturados e inspecionados), não apenas executam linhas.

### Estabilidade (10×)

| Laço | Resultado |
|---|---|
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/repos-cadastro.test.ts tests/integration/auth/cadastro-concorrencia.test.ts \|\| break; done` (dev.md §5; CA-11, CA-12, CA-14, corrida reenvio × consumo, cada cenário já repetido 10× no arquivo) | 10/10 verdes |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/login.test.ts tests/integration/auth/sessao-rbac.test.ts \|\| break; done` (CLAUDE.md, D-010) | 10/10 verdes |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/concorrencia --maxWorkers=2 \|\| break; done` (CLAUDE.md, D-005 CA-6) | 10/10 verdes |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/cadastro.test.ts tests/integration/auth/confirmacao-email.test.ts tests/integration/auth/cadastro-paginas.test.ts \|\| break; done` (extra do tester: gatilhos de falha forçada e relógio injetado) | 10/10 verdes |

### Prova manual independente (navegador real contra o build + banco limpo)

Roteiro Playwright próprio (fora do repositório, `node` + `pg`) contra `next start` com `DATABASE_URL` de `agenda_tester_d011`:

| Verificação | Resultado |
|---|---|
| Cadastro pela UI com `  Ana.Tester@Exemplo.COM ` / "Studio Bela" | PASS: e-mail gravado minúsculo, não confirmado, slug `studio-bela`, fuso/grade/antecedência/janela/intervalo = `America/Sao_Paulo`/15/120/60/0 (CA-1, CA-9) |
| Login antes de confirmar (senha certa, e-mail em maiúsculas) | PASS: "Confirme seu e-mail antes de entrar.", botão "Reenviar link de confirmação", nenhum cookie `ab_sessao`; o botão gera 2º e-mail (CA-6) |
| Login com senha errada | PASS: "E-mail ou senha incorretos.", sem botão de reenvio (CA-6 contraprova) |
| Link do e-mail | PASS: começa com `APP_URL` (`http://localhost:3000/confirmar-email?token=`) |
| **Uma** abertura do link (GET único, sem dupla renderização) | PASS: h1 "E-mail confirmado"; `usado_em` gravado 1 vez (CA-4, R-5) |
| Reabertura | PASS: "Link já utilizado" (CA-4) |
| Login após confirmar | PASS: vai para `/painel` com "Studio Bela" (CA-6, CA-9) |
| "Studio Bela", "Painel", "Confirmar Email", "!!! ★★★" pela UI | PASS: `studio-bela-2`, `painel-2`, `confirmar-email-2`, `salao` (CA-2, CA-7, CA-8) |
| E-mail existente `B@T.com` | PASS: mensagem de e-mail cadastrado, nenhum salão criado (CA-3) |
| Duplo clique em "Criar conta" | PASS: 1 salão (CA-11) |
| Cadastro **sem JS** | PASS (CA-20) |
| Link vencido (`expira_em` no passado) | PASS: "Link expirado" com botão de reenvio (CA-5) |
| Reenvio na tela de link vencido **com JS** | PASS: mensagem uniforme, novo e-mail, novo link confirma (CA-5) |
| Reenvio em `/confirmar-email` (qualquer estado) **sem JS** | **FAIL: HTTP 500** (DEF-2) |
| `token` de 10 KB, repetido (`?token=a&token=b`), vazio | PASS: 200, "Link inválido" (CA-14) |
| Log do servidor durante toda a prova | PASS: só linhas `auth.*` com `resultado`, `salaoId`, `usuarioId`, `em`; nenhum e-mail, senha, token ou hash (`grep` por `senha`, `token_hash`, domínios dos e-mails = 0) (CA-19) |
| Recursos de terceiros em `/confirmar-email` | PASS: nenhum URL externo no HTML |
| `Referer` das sub-requisições de `/confirmar-email?token=…` | 10 de 11 requisições de mesma origem levam a URL com o token (DEF-1) |

### Critérios de aceitação

| CA | Estado | Evidência |
|---|---|---|
| CA-1 | passou | `tests/integration/auth/cadastro.test.ts` "CA-1"; `repos-cadastro.test.ts`; `cadastro-paginas.test.ts`; prova manual |
| CA-2 | passou | `slug.test.ts`, `cadastro.test.ts` "CA-2" (incl. slug só histórico); prova manual `studio-bela-2` |
| CA-3 | passou | `cadastro.test.ts` "CA-3" (3 papéis, 5 tabelas sem mudança); prova manual |
| CA-4 | passou | `confirmacao-email.test.ts`, `cadastro-paginas.test.ts`; prova manual (GET único confirma; reabertura "já utilizado") |
| CA-5 | passou (com JS) | `confirmacao-email.test.ts` (T+24h−1s/T+24h/T+24h+1s); prova manual com JS. Sem JS o reenvio falha: ver DEF-2 (classificado em CA-20) |
| CA-6 | passou | `login.test.ts`, `cadastro.test.ts` "CA-6", `FormularioEntrar.test.tsx`; prova manual (o reenvio pelo `/entrar` não tem a meta `no-referrer` e funciona com e sem JS) |
| CA-7 | passou | `slug.test.ts` (todo `SEGMENTOS_RESERVADOS` → `-2`); prova manual `painel-2`, `confirmar-email-2`. Desvio 1 do dev.md resolvido pelo líder |
| CA-8 | passou | `slug.test.ts`; integração `salao`/`salao-2`; prova manual `salao` |
| CA-9 | passou | `cadastro.test.ts` "CA-9"; prova manual (cadastro e login com maiúsculas) |
| CA-10 | passou | `src/server/auth/cadastro.test.ts`; `cadastro.test.ts` "CA-10" (sem efeitos, hash e porta não chamados) |
| CA-11 | passou | `cadastro-concorrencia.test.ts` (10× no arquivo, laço 10× do tester); prova manual (duplo clique) |
| CA-12 | passou | `cadastro-concorrencia.test.ts` (10× no arquivo, laço 10×) |
| CA-13 | passou | `cadastro.test.ts` "CA-13"/"RN-11/RN-17" (gatilho no PostgreSQL, sem resíduos, sem e-mail) |
| CA-14 | passou | `cadastro-concorrencia.test.ts` (dupla abertura 10×); `confirmacao-email.test.ts`; prova manual (10 KB, repetido, vazio) |
| CA-15 | passou | `confirmacao-email.test.ts` "CA-15"; corrida reenvio × consumo 10× |
| CA-16 | passou | `confirmacao-email.test.ts` "CA-16"; `cadastro-paginas.test.ts` |
| CA-17 | passou | `cadastro.test.ts` "CA-17"; `cadastro-paginas.test.ts` (`EMAIL_ADAPTER=real` sem SMTP) |
| CA-18 | passou | `cadastro-paginas.test.ts` "CA-18" (A e B criados pelo fluxo; `NaoEncontrado` cruzado; `/painel` de B só mostra B) |
| CA-19 | passou | `cadastro.test.ts`/`confirmacao-email.test.ts` "CA-19"; log do servidor da prova manual sem dados pessoais |
| CA-20 | **falhou** | `/cadastro` sem JS ok; **formulário de reenvio de `/confirmar-email` sem JS → 500** (DEF-2). Teclado, `aria-describedby`, axe zero: `e2e/cadastro.spec.ts` passou |
| CA-21 | **falhou** | gates passam, mas o E2E pertinente novo (`e2e/cadastro-sem-js.spec.ts`) falha por DEF-2 |

### Revisão de código (segurança e invariantes)

- **Token:** 32 bytes CSPRNG (`gerarToken`), só o SHA-256 no banco; formato validado (`/^[A-Za-z0-9_-]{43}$/`) antes de qualquer consulta; link montado com `APP_URL` (`new URL`), nunca com `Host`. Consumo por `UPDATE` condicional com `usado_em IS NULL AND invalidado_em IS NULL AND expira_em > agora`; ordem de travas `usuario FOR UPDATE` → `token` nas duas funções (sem impasse; laço 10× da corrida verde).
- **Unicidade sob concorrência:** `INSERT … ON CONFLICT (email) DO NOTHING RETURNING` e `ON CONFLICT (slug)` com até 5 rodadas; sentinelas internos desfazem a transação; nada de captura de erro de constraint. Slug reservado nunca é gravado (`escolherSlugLivre` importa `SEGMENTOS_RESERVADOS`, sem cópia).
- **Enumeração:** cadastro revela existência (exigido pelo CA-3, D-2); reenvio com resposta uniforme e limite 3/15 min contando também e-mails inexistentes; login só oferece reenvio após a senha correta. Observação (não é defeito, fora dos CAs): o reenvio para gestor não confirmado envia o e-mail de forma síncrona, então o tempo de resposta pode diferenciar "existe e não confirmado" de "não existe" (canal de tempo). Registrado para o arquiteto; o mesmo vale para o padrão D-3.
- **Validação no servidor:** RN-7 completa em `validarCadastro` (controle `\p{Cc}`, trim, colapso, tetos, e-mail via zod); a ação corta os valores devolvidos aos tetos; o papel e o salão nunca vêm do formulário.
- **Logs:** só `evento`, `resultado`, `salaoId`, `usuarioId`, `detalhe` (nome da classe do erro) e `em`.
- **Isolamento:** repositórios pré-contexto documentados como exceção; nenhum `salao_id` vem do chamador; após o login vale `resolverTenant` (CA-18).
- **Invariantes não tocadas:** reservas, fuso de disponibilidade, webhooks, mensagens WhatsApp, anonimização e auditoria de super admin não foram alteradas. Salão suspenso: não se aplica (política `permitirTudo`, spec §6).
- **Documentação:** README com a seção "Cadastro do salão e confirmação de e-mail" (inclui leitura do link em `email_log`). Sem migração, sem variável nova, sem mudança de CI (coerente com o desenho). O texto sugerido para o `CLAUDE.md` (dev.md §5) fica para o líder; se o DEF-2 for corrigido, a linha "E2E do cadastro" deve incluir `e2e/cadastro-sem-js.spec.ts`.

Desvios 2..6 do `dev.md`: avaliados; nenhum fere CA (2 e 5 são de UI coerentes com RN-17/RN-20; 3 e 4 reforçam a RN-15/RN-19; 6 aplica a RN-7, que já manda recusar caracteres de controle). Risco do dev.md (`reenvioDisponivel` para profissional não confirmado): aceitável, o reenvio não envia nada a profissional (D-8) e o estado não ocorre hoje.

### Defeitos

```
DEF-1 — Token de confirmação vai no Referer das sub-requisições de /confirmar-email   Severidade: baixa   Estado: verificado (Rodada 2)
CA relacionado: RN-13 (sigilo do token), D-15
Ambiente: base 68ce771 + mudanças da D-011, Node 24.21.0, postgres:17, adaptadores simulados, next start (build), Chromium 375×812
Passos para reproduzir: 1. npm run build && npx next start -p 3000. 2. Abrir no Chromium http://localhost:3000/confirmar-email?token=<43 caracteres>. 3. Inspecionar o cabeçalho Referer das requisições de CSS, fontes e scripts (/_next/static/...).
Resultado esperado: nenhum Referer com o token (D-15: "no-referrer").
Resultado observado: 10 de 11 sub-requisições levam "referer: http://localhost:3000/confirmar-email?token=…". A <meta name="referrer" content="no-referrer"> aparece no <head> DEPOIS dos <link rel="stylesheet">/<script> e do cabeçalho HTTP "Link: rel=preload" das fontes, então o navegador já as pediu com a política padrão. Todas são de mesma origem (nenhum recurso de terceiros); a navegação para /entrar sai com document.referrer vazio (correto). Impacto: o token aparece em logs de acesso/CDN como Referer de arquivos estáticos (o mesmo servidor já recebe o token na URL principal).
Classe de falha: sigilo de token / política de referrer
Sugestão (para o arquiteto): cabeçalho HTTP Referrer-Policy na rota (headers() do next.config) ou redirecionar para URL sem token após o consumo. Atenção ao DEF-2: a política escolhida precisa manter o Origin dos POSTs de mesma origem (ex.: "same-origin" ou "strict-origin-when-cross-origin"), ou o DEF-2 persiste.
```

```
DEF-2 — Reenvio em /confirmar-email sem JavaScript responde HTTP 500 ("Invalid Server Actions request")   Severidade: alta   Estado: verificado (Rodada 2)
CA relacionado: CA-20 (formulário funciona com <form action> sem JS), RN-20; afeta CA-5 sem JS e o envio antes da hidratação
Ambiente: base 68ce771 + mudanças da D-011, Node 24.21.0, postgres:17, adaptadores simulados, next start (build), Chromium 375×812 com javaScriptEnabled=false
Passos para reproduzir: 1. npm run build (porta 3000 livre). 2. npx playwright test e2e/cadastro-sem-js.spec.ts (sem banco). Manualmente: com JS desligado, abrir /confirmar-email (ou /confirmar-email?token=x, ou um link vencido) e clicar "Reenviar link de confirmação".
Resultado esperado: 200 com a mensagem do servidor (erro de validação, mensagem uniforme ou limite), como em /cadastro e /entrar sem JS.
Resultado observado: POST → 500. Log do servidor: "`x-forwarded-host` header with value `localhost:3000` does not match `origin` header with value `null` from a forwarded Server Actions request. Aborting the action." / "Error: Invalid Server Actions request." O navegador envia "Origin: null" porque a página tem <meta name="referrer" content="no-referrer"> (com no-referrer a origem do POST de navegação é serializada como null) e a checagem CSRF das Server Actions do Next recusa. Comparação: o mesmo POST em /entrar sai com Origin http://localhost:3000 e responde 200. Com JS (fetch) funciona. Em banco real, o reenvio sem JS a partir da tela de link vencido não grava token nem envia e-mail.
Teste de regressão: e2e/cadastro-sem-js.spec.ts (novo, do tester): 2 de 3 falham (Expected 200, Received 500).
Classe de falha: interação política de referrer × proteção CSRF de Server Actions (progressive enhancement)
```

### Testes adicionados pelo tester

- `e2e/cadastro-sem-js.spec.ts` (sem banco, cabe no job `e2e`): `/cadastro` vazio sem JS → 200 com erros; reenvio em `/confirmar-email` e `/confirmar-email?token=invalido` sem JS → 200 com "Informe um e-mail válido.". Lint ok. Hoje falha (DEF-2); deve passar após a correção. Enquanto o DEF-2 estiver aberto, `npm run test:e2e` falha por causa dele (intencional).

### Veredito da Rodada 1

**REPROVADO.** CA-20 (e por consequência CA-21, E2E pertinente) não atendido: DEF-2 (alta) aberto. DEF-1 (baixa) aberto. Demais CAs (CA-1..CA-19) passaram com evidência; lint, typecheck, build, `npm test` (1879) e cobertura (99,88% de linhas) passaram.

## Rodada 2

Entrada: `dev.md` §7 (decisão do líder, revisão da D-15: cabeçalho HTTP `Referrer-Policy: strict-origin` só em `/confirmar-email`, via `headers()` em `next.config.ts` com `source: ROTAS.confirmarEmail`; meta `no-referrer` removida). Arquivos alterados: `next.config.ts`, `src/app/(publico)/confirmar-email/page.tsx`, `tests/integration/auth/cadastro-paginas.test.ts`, `e2e/cadastro.spec.ts`. O `e2e/cadastro-sem-js.spec.ts` do tester não foi alterado (conferido).

Ambiente: o mesmo da Rodada 1 (Node 24.21.0, postgres:17, Next 16.4.6, Playwright 1.65.1, Chromium 375×812, adaptadores simulados). Banco limpo `agenda_tester_d011` recriado do zero (`migrate deploy` ok), `next start` do build novo; removido ao final, porta 3000 liberada.

### Gates

| Comando | Resultado |
|---|---|
| `npm run db:generate` | passou |
| `npm run lint` | passou, 0 avisos |
| `npm run typecheck` | passou |
| `npm run build` | passou; `○ /cadastro`, `ƒ /confirmar-email` |
| `npm test` | passou: 136 arquivos, 1879 testes |
| `npm run test:coverage` | passou: **linhas 99,88% (1704/1706)**; `vitest.config.ts` sem alteração |
| `npm run test:e2e` | passou: **39 testes**, incluindo `e2e/cadastro-sem-js.spec.ts` 3/3 e o bloco novo "DEF-1/D-15" 2/2 |
| Laços 10× (mesmos comandos da Rodada 1) | repos-cadastro + cadastro-concorrencia 10/10; login + sessao-rbac 10/10; concorrencia D-005 (`--maxWorkers=2`) 10/10; cadastro + confirmacao-email + cadastro-paginas 10/10 |

### Reteste dos defeitos (prova manual com banco, roteiro Playwright próprio)

| Verificação | Resultado |
|---|---|
| Cabeçalho por rota (`GET`): `/confirmar-email`, `/confirmar-email?token=x` | `Referrer-Policy: strict-origin` |
| `/cadastro`, `/entrar`, `/`, `/painel` (307), `/api/health`, `/confirmar-email/` (308), `/confirmar-email/abc` (404), `/dev/componentes` (404) | sem `Referrer-Policy`: o cabeçalho vale só para `/confirmar-email` |
| `POST /confirmar-email?token=x` (resposta da Server Action sem JS) | 200 com `Referrer-Policy: strict-origin` |
| DEF-2, sem JS, link **vencido** (banco real) | PASS: POST 200, `Origin: http://localhost:3000`, mensagem uniforme; 1 novo e-mail; exatamente 1 token válido; o novo link confirma |
| DEF-2, sem JS, `/confirmar-email` e `/confirmar-email?token=invalido` com e-mail existente não confirmado (em maiúsculas) | PASS: POST 200, mensagem uniforme, 2 novos e-mails |
| DEF-2, **antes da hidratação** (JS ligado, chunks `/_next/static/chunks/*.js` bloqueados), link vencido | PASS: POST 200, `Origin` correto, novo e-mail gravado |
| DEF-1, link válido com JS | PASS: confirma; 10 sub-requisições, **0** com token no Referer (todas com `Referer: http://localhost:3000/`); `document.referrer` em `/entrar` = `http://localhost:3000/` |
| Regressão: cadastro, login não confirmado → reenvio pelo `/entrar`, confirmar, login → `/painel` com o salão | PASS |
| Log do servidor | 23 linhas `auth.*`; 0 ocorrências de `error`/`Invalid Server Actions`; 0 de senha, `token_hash` ou e-mail |

### Critérios de aceitação

CA-1..CA-19: sem regressão (mesmos testes verdes, prova manual repetida). **CA-20: passou** (formulários de `/cadastro` e `/confirmar-email` funcionam sem JS e antes da hidratação; teclado e axe verdes). **CA-21: passou** (todos os gates, cobertura 99,88%, E2E pertinente verde).

### Defeitos

DEF-1 e DEF-2: **verificados** (fechados). Nenhum defeito novo. Classe de falha não recorrente.

Observação para o líder: o texto sugerido para o `CLAUDE.md` (dev.md §5) deve incluir `e2e/cadastro-sem-js.spec.ts` na linha "E2E do cadastro" e registrar que `/confirmar-email` usa o cabeçalho `Referrer-Policy: strict-origin` (em `next.config.ts`), não a meta. A observação de canal de tempo no reenvio (Rodada 1) segue registrada, sem CA afetado.

### Veredito da Rodada 2

**APROVADO.** Todos os CAs (CA-1..CA-21) atendidos, todos os gates passaram, cobertura de linhas 99,88% (≥ 90%), nenhum defeito crítico ou alto aberto.
