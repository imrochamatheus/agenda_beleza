# D-010 — Desenvolvimento: login, sessão em cookie httpOnly e permissões por perfil (issue #12, E1.2)

Autor: desenvolvedor. Entradas: `spec.md`, `design.md` (D-1..D-14, DD-1..DD-4, T-1..T-7), `issue-12.md`, `CLAUDE.md`.
Branch `feat/d-010-login-sessao` (de `main` em `b37c67e`). Sem commit nem push.

## 1. Tarefas concluídas e arquivos

Ordem executada: T-1, T-5, T-2, T-4, T-3, T-6, T-7.

| Tarefa | Estado | Arquivos |
|---|---|---|
| T-1 | concluída | `package.json`, `package-lock.json` (`@node-rs/argon2` 2.2.2 exato); `src/server/auth/{senha,validade,cookie,destino,permissoes}.ts` + `.test.ts` |
| T-5 | concluída | `src/app/(publico)/entrar/{estado.ts,FormularioEntrar.tsx,FormularioEntrar.module.css,FormularioEntrar.test.tsx}` |
| T-2 | concluída | `src/server/repos/sessao.ts` (alterado), `src/server/repos/usuario.ts`, `src/server/repos/rate-limit.ts` (novos), `src/server/tenant/sessao.ts` e `sessao.test.ts` (alterados), `tests/support/factories.ts`, `tests/integration/tenant/fabricas.test.ts` (alterados), `tests/integration/auth/resolucao.test.ts` (novo) |
| T-4 | concluída | `src/proxy.ts`, `src/proxy.test.ts` |
| T-3 | concluída | `src/server/auth/sessao.ts`, `src/server/auth/login.ts`, `tests/support/auth.ts` (alterado), `tests/integration/auth/login.test.ts`, `tests/integration/auth/sessao-rbac.test.ts` |
| T-6 | concluída | `src/server/auth/pagina.ts`, `src/app/(publico)/entrar/{page.tsx,acoes.ts}`, `src/app/painel/{page.tsx,acoes.ts}`, `src/app/painel/_componentes/{AreaUsuario.tsx,AcessoNegado.tsx,Painel.module.css}`, `tests/integration/auth/paginas.test.ts` |
| T-7 | concluída | `e2e/entrar.spec.ts`, `README.md` (seção "Entrar no painel (login e sessão)" e linha do E2E em "Testes"), este `dev.md` |

Não foram alterados: `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `playwright.config.ts`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`, `src/server/env.ts`, `prisma/**`, `src/components/**`, `src/config/navegacao.ts`, `define-acao.ts`, `next.ts`, `erros.ts`, `context.ts`, `tests/integration/tenant/fixtures/registro/**`, `allowScripts`. Nenhum `*.acao.ts` novo.

### Notas por tarefa
- **T-1:** `HASH_FICTICIO` gerado uma vez com `hash(randomBytes(32).toString('base64url'), PARAMETROS_ARGON2)` e colado como literal (`$argon2id$v=19$m=19456,t=2,p=1$…`). `verificarSenha` captura o erro de `verify` e devolve `false`. O `const enum Algorithm` não é importado (o teste confere). `pode` usa `Object.hasOwn` (falha fechada para `toString`/`__proto__`).
- **T-2:** `buscarSessaoValida` devolve também `sessaoId`, `profissionalAtivo`, `criadoEm` e `ultimoUsoEm`. `criarSessao` grava `criado_em`/`ultimo_uso_em` com o relógio injetado. `renovarSessao` é um `updateMany` condicional (no máximo uma escrita por hora, mesmo com requisições concorrentes). `resolverTenant` renova e trata o profissional com perfil inativo ou ausente como 401 (RN-14). `NOME_COOKIE_SESSAO` mora em `auth/cookie.ts` e é reexportado por `tenant/sessao.ts` (DD-1). As fábricas usam o hash argon2id real de `SENHA_DE_TESTE`, memoizado por processo, e aceitam `gestor.emailConfirmado`, `profissional.emailConfirmado` e `profissional.ativo`.
- **T-3:** `entrar` segue o §3.9: validação (zod) → reserva atômica `INSERT … ON CONFLICT … RETURNING` → busca → exatamente uma verificação argon2 (contra `HASH_FICTICIO` se o e-mail não existe) → mensagem genérica (inexistente, senha errada, super admin) → não confirmado / desativado → no sucesso, `decrementarJanela` e `iniciarSessao`. O log tem uma linha JSON `auth.login` por tentativa validada, com `usuarioId` só em `ok`.
- **T-6:** `exigirAcessoAoPainel` chama `redirect` fora do `try/catch` (R-9). A tela "Acesso negado" é renderizada pela página (D-9 opção b, status 200, `robots: noindex` no painel). `sairAcao` revoga, apaga o cookie (`maxAge: 0`), registra `auth.logout` e redireciona.

## 2. Comandos executados e resultados

PostgreSQL local: `docker compose up -d postgres` (já estava no ar).

| Comando | Resultado |
|---|---|
| `npm install --save-exact @node-rs/argon2@2.2.2` | `"@node-rs/argon2": "2.2.2"` em `dependencies`; sem `^`/`~`; `allowScripts` inalterado |
| `npm ci` (depois de tudo) | limpo, 581 pacotes, 0 vulnerabilidades, nenhum aviso de script bloqueado (só o aviso preexistente de depreciação do eslint 9) |
| `npm run db:generate` | ok (Prisma Client 7.10.1) |
| `npm run test:unit -- src/server/auth` (T-1) | 5 arquivos, 94 testes, passou |
| `npm run test:unit -- "src/app/(publico)/entrar"` (T-5) | 1 arquivo, 7 testes, passou |
| `npx vitest run --project integration tests/integration/auth/resolucao.test.ts tests/integration/tenant` (T-2) | 9 arquivos, 121 testes, passou |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/login.test.ts tests/integration/auth/sessao-rbac.test.ts \|\| break; done` (T-3) | 10/10 execuções com 35/35 testes |
| `npx vitest run --project integration tests/integration/tenant/registro.test.ts` | 6/6, passou (CA-4 da D-005 sem exceções novas) |
| `npx vitest run --project unit src/proxy.test.ts` (T-4) | 12/12, passou |
| `npx vitest run --project integration tests/integration/auth` (T-6) | 4 arquivos, 67 testes, passou |
| `npm run lint` | 0 erros, 0 avisos |
| `npm run typecheck` | ok |
| `npm run build` | ok; rotas `ƒ /entrar` e `ƒ /painel` (dinâmicas) e `ƒ Proxy (Middleware)` no relatório |
| `npm test` | **126 arquivos, 1706 testes, passou** (unit: 77 arquivos / 874 testes; integration: 49 arquivos / 832 testes) |
| `npm run test:coverage` | **passou; linhas 99,86% (1468/1470)**, statements 99,14%, ramos 97,95%, funções 99,51% |
| `npm run test:e2e` | **30/30 passou** (inclui os 5 novos de `e2e/entrar.spec.ts`) |
| `DATABASE_URL=postgresql://x:y@127.0.0.1:1/z npx playwright test e2e/entrar.spec.ts` | 5/5: prova de que `/entrar` sem cookie e o proxy não precisam do banco (como no job `e2e` da CI) |
| Prova Docker (T-7): `docker compose up -d --wait --build` | postgres, app e worker `Healthy`; `curl http://localhost:3000/entrar` → **200**; `curl /painel` → **307** para `/entrar?proximo=%2Fpainel`; `docker compose exec app node -e "import('@node-rs/argon2')…hash…"` → `$argon2id$v=19$m=19456,t=2,p=1$`; `docker compose logs app` sem nenhum "error"; depois `docker compose down` (e `up -d postgres` de novo, o estado anterior) |

Cobertura de linhas dos arquivos novos ou alterados (relatório `coverage/coverage-summary.json`):

| Arquivo | Linhas | Ramos |
|---|---|---|
| `src/server/auth/cookie.ts`, `login.ts`, `pagina.ts`, `permissoes.ts`, `senha.ts`, `sessao.ts`, `validade.ts` | 100% | 100% |
| `src/server/auth/destino.ts` | 92,3% (linha 22) | 94,11% |
| `src/proxy.ts` | 100% | 100% |
| `src/app/(publico)/entrar/{FormularioEntrar.tsx,acoes.ts,estado.ts,page.tsx}` | 100% | 100% |
| `src/app/painel/{page.tsx,acoes.ts}`, `_componentes/{AcessoNegado.tsx,AreaUsuario.tsx}` | 100% | 100% |
| `src/server/repos/{sessao.ts,usuario.ts,rate-limit.ts}` | 100% | 100% |
| `src/server/tenant/sessao.ts` | 100% | 100% |

A linha 22 de `destino.ts` é a defesa `url.origin !== BASE` do passo 3 do §3.4. Ela é inalcançável depois do passo 2: o caminho começa com uma única `/` e não tem `\` nem caracteres de controle. Foi mantida como defesa em profundidade, como pede o desenho, e sem nenhuma exclusão de cobertura.

## 3. Testes criados ou alterados × CA

| Arquivo | Tipo | CAs |
|---|---|---|
| `src/server/auth/senha.test.ts` | unit | CA-13 (prefixo/parâmetros, sal, certa/errada, malformado/vazio → false, acentos/emoji, `HASH_FICTICIO`, só `senha.ts` importa o argon2, sem `Algorithm`) |
| `src/server/auth/validade.test.ts` | unit | RN-10 (limites de 1 h, 7 d, 30 d) |
| `src/server/auth/cookie.test.ts` | unit | CA-7 |
| `src/server/auth/destino.test.ts` | unit | CA-8 (tabela da spec + `%2e%2e`, `#`, 2048/2049 caracteres, tab/DEL) |
| `src/server/auth/permissoes.test.ts` | unit | CA-11 (matriz inteira 13 × 3, falha fechada, congelamento, `exigirPermissao` e `filtroDeProfissional` em todos os ramos). É o `tests/unit/auth/permissoes.test.ts` da issue (D-12) |
| `src/proxy.test.ts` | unit | CA-9 (`NextRequest` real; varredura de imports, R-6) |
| `src/server/tenant/sessao.test.ts` | unit | DD-1 (reexport do nome do cookie) |
| `src/app/(publico)/entrar/FormularioEntrar.test.tsx` | jsdom | CA-18, parte de componente (rótulos, `type`/`autocomplete`, `Alert` com `role=alert`, e-mail preservado, senha vazia, `proximo` oculto, links, sem `@/server` em runtime) |
| `tests/integration/auth/resolucao.test.ts` | integração | CA-14, CA-5/RN-14 na resolução, repositórios `usuario.ts` e `rate-limit.ts` (CA-12: 20 incrementos concorrentes exatos) |
| `tests/integration/auth/login.test.ts` | integração | CA-2 (verificador instrumentado: 1 chamada por caso; `HASH_FICTICIO` para inexistente), CA-5, CA-12 (inclui 10ª e 11ª em paralelo), CA-15, CA-16 (banco inacessível para provar que a validação não consulta o banco), CA-19 (console, stdout e stderr capturados) |
| `tests/integration/auth/sessao-rbac.test.ts` | integração | CA-1 (núcleo), CA-3 (`acaoValida` + ação inline gestor-only que renomeia; controle com o gestor), CA-4 (núcleo + `exigirContexto`), CA-5 (sessão antiga, `revogarSessoesDoUsuario` com contagem), CA-17 (ações por ID de B → 404) |
| `tests/integration/auth/paginas.test.ts` | integração | CA-1 e CA-4 (casca), CA-6, CA-10 (painel e `/entrar`), CA-17 (painel de A), estado de erro de `entrarAcao` sem senha |
| `tests/integration/tenant/fabricas.test.ts` | integração | §3.13 (hash real, novas opções das fábricas) |
| `e2e/entrar.spec.ts` | E2E | CA-18 (200, sem rolagem horizontal, Tab E-mail → Senha → Entrar na ordem visual, atributos, axe zero violações) e CA-9 com o proxy real (307 e destino com `proximo`) |
| Gates | — | CA-20 |

## 4. Desvios do desenho e riscos conhecidos

Desvios (pequenos, todos dentro dos arquivos sob minha posse):
1. **`destino.ts`:** não envolvi `new URL` num `try/catch`. Com o prefixo `/` já validado, o parser WHATWG não falha, e o bloco seria código morto. A checagem de origem (passo 3) ficou, como defesa (ver §2).
2. **`FormularioEntrar`:** o `<form>` tem `noValidate`. Assim as mensagens de validação em pt-BR vêm do servidor (RN-6), e não do balão nativo do navegador. Os campos continuam `required` (semântica e leitores de tela).
3. **`buscarIdentidadeDoPainel`:** além de `exigirEscopo`, recusa com `Error` um contexto que não seja `tenant` (o tipo já exige; isso é a guarda em tempo de execução, testada).
4. **`criarSuperAdmin`** (`tests/support/auth.ts`) também devolve o `email`, para o CA-2 testar o super admin com a senha correta.
5. **Componentes do painel:** criei `src/app/painel/_componentes/Painel.module.css` (o desenho previa "+ `.module.css` se preciso"), só com tokens.
6. **Proxy × host:** o `NextURL` do Next normaliza `127.0.0.1` para `localhost` no `Location` do redirecionamento. Por isso o teste unitário confere a mesma origem e `pathname + search`. No servidor real, o E2E e o Docker confirmaram o destino `/entrar?proximo=…`.
7. **Prova Docker:** usei `docker compose up -d --wait --build`, porque a imagem existente era anterior à demanda. Nenhum arquivo de infraestrutura foi alterado.

Riscos e pendências (já registrados no desenho, fora desta demanda): limpeza de `sessao`/`rate_limit_janela` (D-10), `serverActions.allowedOrigins` atrás de proxy reverso (R-7, documentado no README), HMAC na chave de rate limit (D-3, E4.2) e E2E de login com banco (D-13). R-4 (bloqueio de 15 min de um e-mail conhecido por terceiro) foi aceito. Nenhum TODO no código.

## 5. Texto sugerido para o `CLAUDE.md` (o líder edita)

Acrescentar ao fim do parágrafo de "Project status":

> D-010 (E1.2) added staff login and sessions: `src/server/auth/` (`senha.ts` is the only place that imports `@node-rs/argon2` 2.2.2, argon2id m=19456/t=2/p=1; `login.ts` with uniform cost against a dummy hash and a per-e-mail rate limit of 10 failures per fixed 15-min window in `rate_limit_janela`; `sessao.ts` to create, end and revoke sessions; `cookie.ts`, the `ab_sessao` cookie, httpOnly, SameSite=Lax, Max-Age 30 d, Secure only when `NODE_ENV=production`; `validade.ts`, 7-day inactivity renewed at most once per hour with a 30-day cap; `permissoes.ts`, the role × operation matrix with `pode`/`exigirPermissao`/`filtroDeProfissional`; `pagina.ts`, `exigirAcessoAoPainel`, which redirects to `/entrar?proximo=` on 401 and renders "Acesso negado" on 403). Also added: `src/proxy.ts`, which only checks that the cookie is present on `/painel/**`; `/entrar` (server action, not `*.acao.ts`) and a minimal `/painel` with "Sair" (POST); and `resolverTenant` now treats a professional with an inactive or missing profile as 401. Test factories use a real argon2id hash of `SENHA_DE_TESTE`; `entrarDeVerdade` in `tests/support/auth.ts` performs a real login.

Acrescentar à tabela "Comandos e cobertura":

> | E2E de login (D-010) | `npx playwright test e2e/entrar.spec.ts` | exige build prévio e porta 3000 livre; sem banco (`/entrar` e o proxy, CA-9/CA-18) |
> | Estabilidade do login (D-010) | `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/login.test.ts tests/integration/auth/sessao-rbac.test.ts \|\| break; done` | inclui o teste concorrente do rate limit (CA-12) |
