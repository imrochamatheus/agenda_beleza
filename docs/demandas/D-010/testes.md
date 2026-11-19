# D-010 — Testes: login, sessão em cookie httpOnly e permissões por perfil (issue #12, E1.2)

Autor: tester. Entradas: `spec.md` (CA-1..CA-20), `design.md` (§3, §7.2 R-1..R-12, §9), `dev.md` e `issue-12.md`.

## Rodada 1 — 2026-11-19

### Ambiente
- Branch `feat/d-010-login-sessao` (HEAD `b37c67e` + mudanças não commitadas do desenvolvedor; nada foi alterado pelo tester no repositório além deste arquivo).
- Node v24.21.0; PostgreSQL 17 (`docker compose`, serviço `postgres`); adaptadores `simulado`; Playwright Chromium, viewport 375×812.
- Testes exploratórios descartáveis na pasta de rascunho da sessão, fora do repositório (config Vitest própria apontando para o harness de `tests/support/`; script Playwright contra a app do Docker).

### Gates (reexecutados pelo tester)

| Comando | Resultado |
|---|---|
| `npm ci` | ok, 0 vulnerabilidades, sem aviso de script bloqueado |
| `npm run db:generate` | ok |
| `npm run lint` | ok, 0 erros, 0 avisos |
| `npm run typecheck` | ok |
| `npm run build` | ok; `ƒ /entrar`, `ƒ /painel`, `ƒ Proxy (Middleware)` |
| `npm test` | **126 arquivos, 1706 testes, todos passaram** |
| `npm run test:coverage` | passou; **linhas 99,86% (1468/1470)**, statements 99,14%, ramos 97,95%, funções 99,51% |
| `npm run test:e2e` | **30/30 passaram** (inclui os 5 de `e2e/entrar.spec.ts`) |
| `for i in 1 2 3; do npx vitest run --project integration tests/integration/auth tests/integration/tenant/registro.test.ts; done` | 3/3 execuções, 72/72 testes |
| Prova Docker: `docker compose up -d --wait --build` | postgres e app `healthy`, worker no ar (`worker.iniciado`); `GET /entrar` → **200**; `GET /painel` sem cookie → **307** `/entrar?proximo=%2Fpainel`; `GET /painel` com `Cookie: ab_sessao=adulterado` → **307** para o mesmo destino (página, não proxy); `GET /entrar?proximo=//evil.com` → 200 sem campo oculto `proximo`. Depois `docker compose down` e `docker compose up -d postgres --wait` (estado anterior restaurado) |

Exclusões de cobertura: `vitest.config.ts` não mudou (só testes, `.d.ts` e `src/generated/**`). Nenhum `v8 ignore`/`istanbul ignore` em `src/`. Arquivos da demanda com < 100% de linhas: só `src/server/auth/destino.ts` (92,3%, linha 22).

### Critérios de aceitação

| CA | Estado | Evidência |
|---|---|---|
| CA-1 | passou | `tests/integration/auth/sessao-rbac.test.ts` "CA-1: linha nova em sessao…" (linha completa de `sessao` comparada com `toEqual`, `token_hash = hashDoToken(token)`, `expira_em = agora + 7 d`, `resolverTenant` → gestor de A); `paginas.test.ts` "CA-1 (casca)" (atributos exatos `{httpOnly, sameSite:'lax', path:'/', secure:false, maxAge:2592000}`, sem `domain`, redirect `/painel`). Navegador real contra o Docker: cookie `ab_sessao` 43 caracteres, `httpOnly:true`, `secure:true` (produção), `sameSite:Lax`, `path:/`, expira em 30 d |
| CA-2 | passou | `login.test.ts` "CA-2: senha errada, e-mail inexistente, super admin e profissional inativo…": `toEqual` do mesmo objeto nos 4 casos, verificador real instrumentado chamado 1× em cada, total de sessões inalterado; "RN-8" prova que o inexistente verifica contra `HASH_FICTICIO`. Exploratório R-3 (40 pares, janelas distintas): mediana existente 15,73 ms × inexistente 15,35 ms |
| CA-3 | passou | `sessao-rbac.test.ts` "CA-3": com o token do login real do profissional, `acaoValida` → 403; ação gestor-only que renomeia → `{ok:false, erro:'acesso_negado', status:403}`, handler não chamado, nome no banco igual; controle com o gestor → `ok:true` e nome alterado |
| CA-4 | passou | `sessao-rbac.test.ts` "CA-4": X revogada; `resolverTenant`, `defineAcao` (401) e `exigirContexto` recusam X; Y continua válida; logout idempotente. `paginas.test.ts`: `sairAcao` grava `ab_sessao=''` com `maxAge:0` e os mesmos atributos, redirect `/entrar`, painel com X redireciona. Navegador real: após "Sair", cookie removido; cookie antigo reinjetado em outro contexto → `/entrar?proximo=%2Fpainel` |
| CA-5 | passou | `login.test.ts` "CA-5" (senha correta → mensagem de desativado, sem sessão; sem perfil → desativado; gestor com perfil inativo entra). `sessao-rbac.test.ts`: sessão anterior à desativação → `NaoAutenticado` e ação 401 com `revogada_em` nulo (RN-14); `revogarSessoesDoUsuario` → 2 (contagem), linhas preservadas, outro usuário intacto. Exploratório: reativar não ressuscita sessão revogada; novo login funciona |
| CA-6 | passou | `paginas.test.ts` "CA-6": painel do profissional com Agenda e Bloqueios, sem itens de gestor, nome do salão, "Olá, <nome>" e botão "Sair" num `<form>`; destino `/painel` |
| CA-7 | passou | `src/server/auth/cookie.test.ts` (produção → `secure:true`; development/test → false; apagamento com os mesmos atributos e `maxAge 0`) |
| CA-8 | passou | `src/server/auth/destino.test.ts` (tabela da spec + extras). Exploratório com 17 vetores (`/painel/.%2e/admin`, `/painel%2f..%2fadmin`, `/%09/evil.com`, `\\evil.com`, `https:/evil.com`, `/painel@evil.com`, `/painel;//evil.com`, U+2028, barras largas `／／`, `%0d%0a` etc.): todos resultam num caminho de mesma origem sob `/painel`. Navegador real: campo oculto `proximo` adulterado para `//evil.com` → destino `http://localhost:3000/painel` |
| CA-9 | passou | `src/proxy.test.ts` (307 com `proximo` codificado, cookie vazio redireciona, rotas não interceptadas, matcher) e `e2e/entrar.spec.ts` (proxy real). Proxy sem Prisma: teste de varredura de imports em `proxy.test.ts` e conferência do bundle `.next/server/middleware.js` + chunks (0 ocorrências de `prisma`/`argon2`) |
| CA-10 | passou | `paginas.test.ts` "CA-10": sem cookie, token desconhecido, expirada e revogada → `/entrar?proximo=%2Fpainel`; super admin → "Acesso negado" sem nome de salão, "Sair" nem navegação; gestor → contexto; `/entrar` com sessão → `/painel` (ou `proximo` válido). Navegador real: `/entrar` com sessão → `/painel` |
| CA-11 | passou | `src/server/auth/permissoes.test.ts` (13 × 3 células, falha fechada para `cliente`, `undefined`, `toString`, `__proto__`, `exigirPermissao`/`filtroDeProfissional` em todos os ramos) |
| CA-12 | passou | `login.test.ts` "CA-12" (11ª com senha correta → limite, verificador 0×, sem sessão; outro e-mail entra; janela seguinte entra; inexistente; chave `login:<sha256>` sem e-mail em claro; 10ª e 11ª em paralelo → contador 11). Exploratório: 30 tentativas paralelas → exatamente 10 verificações, 20 limites, contador 30; 9 falhas + 5 logins corretos em paralelo → 1 entra; variantes de caixa/espaço do e-mail somam na mesma chave |
| CA-13 | passou | `src/server/auth/senha.test.ts` (prefixo `$argon2id$v=19$m=19456,t=2,p=1$`, sal aleatório, malformado/vazio → false, acentos/emoji, só `senha.ts` importa o argon2) |
| CA-14 | passou | `tests/integration/auth/resolucao.test.ts` "CA-14" (T0+6 d → T0+13 d; < 1 h sem escrita; 7 d sem uso; teto 30 d; instante exato; concorrência). Exploratório: com uso a cada 5 d, `expira_em` fica em T0+30 d; T0+30 d−1 ms válido, T0+30 d → `NaoAutenticado` |
| CA-15 | passou | `login.test.ts` "CA-15" (gestor e profissional; senha certa → "Confirme seu e-mail…", errada → genérica; sem sessão) |
| CA-16 | passou | `login.test.ts` "CA-16" (normalização; 9 casos de validação com banco inacessível, verificador e log 0×; não conta no rate limit; senha não aparada). Exploratório: `"\t EMAIL.MAIÚSCULO\n"` entra; navegador real com `"  EXPLOR.d010@Exemplo.com "` entra |
| CA-17 | passou | `sessao-rbac.test.ts` "CA-17" (login real de A; leitura e alteração por ID de B → 404, B intacto; controle em A) e `paginas.test.ts` (painel de A sem nome de B) |
| CA-18 | passou | `e2e/entrar.spec.ts` (200, sem rolagem horizontal, Tab E-mail → Senha → Entrar na ordem visual, atributos, axe zero violações) e `FormularioEntrar.test.tsx` (Alert, e-mail preservado, senha vazia). Navegador real: após erro, alerta "E-mail ou senha incorretos.", e-mail preservado, senha `""`; envio com Enter |
| CA-19 | passou | `login.test.ts` "CA-19" (console, stdout e stderr capturados: sem senha, token, `token_hash`, e-mail, chave nem hash de senha; `usuarioId` só em `ok`) e `paginas.test.ts` "RN-22" (log do logout). `docker compose logs app` da sessão de navegador: 0 ocorrências da senha usada |
| CA-20 | passou | `tests/integration/tenant/registro.test.ts` passa sem exceção nova (nenhum `*.acao.ts` novo); gates acima |

### Revisão dos testes
- Os testes novos verificam comportamento com asserções sobre o banco real (linhas de `sessao`, `rate_limit_janela`, nome do profissional) e não só executam linhas. Não encontrei teste sem asserção.
- O CA-2 compara o objeto inteiro (`toEqual`) e conta as chamadas do verificador real (injeção, não mock de banco). O tempo constante decorre de uma verificação argon2 com os mesmos parâmetros em todos os casos; a medição exploratória confirma isso.
- `next/headers` e `next/navigation` são substituídos só nos testes da casca, como permite a spec; o banco nunca é simulado.

### Desvio avaliado: linha 22 de `src/server/auth/destino.ts`
Concordo que ela é inalcançável: os passos anteriores garantem um caminho que começa com uma única `/`, sem `\` nem caracteres de controle (o parser WHATWG remove tab/LF/CR, mas eles já foram recusados antes). Assim, `new URL(proximo, BASE)` sempre mantém a origem de `BASE`; os 17 vetores exploratórios confirmaram isso. A linha é defesa em profundidade pedida pelo desenho (§3.4, passo 3), não tem exclusão de cobertura e o gate continua em 99,86%. **Aceitável; não é defeito.**

### Defeitos
Nenhum defeito aberto nesta rodada.

### Observações (não bloqueantes, sem severidade)
- O-1: `sessaoDaCredencial` (`src/server/tenant/sessao.ts:33-40`) renova a sessão antes de `resolverTenant` aplicar a RN-14. A sessão de um profissional inativo ainda pode receber uma escrita de `ultimo_uso_em`/`expira_em` antes do 401. Isso é inofensivo, porque o 401 continua e a revogação explícita é da E2.2. Fica registrado para a E2.2.
- O-2: o painel é servido com status 200 para "Acesso negado" (D-9 opção b, decisão tomada); ações e rotas continuam com 403.
- O-3: as pendências do desenho continuam fora desta demanda: limpeza de `sessao`/`rate_limit_janela`, `serverActions.allowedOrigins` atrás de proxy reverso, HMAC na chave do rate limit e E2E de login com banco na CI. Uma sessão de navegador real contra o Docker (`NODE_ENV=production`, Chromium, `http://localhost`) cobriu manualmente o fluxo completo: erro, login, cookie `Secure` aceito, painel, `/entrar` → painel, "Sair", cookie antigo recusado e `proximo` adulterado. Os dados temporários (salão, usuário, sessões e janela de rate limit) foram apagados depois.

### Veredito: **APROVADO**
Os 20 CAs passaram, todos os gates passaram, a cobertura de linhas está em 99,86% (≥ 90%) e não há defeito crítico nem alto em aberto.
