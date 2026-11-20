# D-012 — Desenvolvimento: recuperar senha por e-mail transacional (issue #14, E1.3)

Autor: desenvolvedor. Entradas: `issue-14.md`, `spec.md`, `design.md` (D-1..D-20), `CLAUDE.md`, `docs/demandas/D-011/dev.md`. Branch `feat/d-012-recuperar-senha` (base `main` `ded2afa`), sem commit.

## 1. Tarefas concluídas e arquivos

| Tarefa | Arquivos |
|---|---|
| T-1 Repositório | `src/server/repos/token-recuperacao.ts` (novo), `tests/integration/auth/repos-recuperacao.test.ts` (novo) |
| T-2 Sessão condicionada ao hash (D-11, D-19) | `src/server/repos/sessao.ts` (+ `criarSessaoSeSenhaVigente`), `src/server/auth/sessao.ts` (+ `iniciarSessaoSeSenhaVigente`), `src/server/auth/login.ts` (só o ramo de sucesso), `tests/integration/auth/sessao-senha-vigente.test.ts` (novo) |
| T-3 Serviço | `src/server/auth/recuperacao-senha.ts` (novo), `src/server/auth/recuperacao-senha.test.ts` (novo, unidade), `tests/integration/auth/recuperacao-senha.test.ts` (novo) |
| T-4 Concorrência | `tests/integration/auth/recuperacao-senha-concorrencia.test.ts` (novo) |
| T-5 Componentes e estados | `src/app/(publico)/recuperar-senha/{estado.ts, FormularioRecuperar.tsx, FormularioRecuperar.module.css, FormularioRecuperar.test.tsx}`, `src/app/(publico)/redefinir-senha/{estado.ts, FormularioRedefinir.tsx, FormularioRedefinir.module.css, FormularioRedefinir.test.tsx}` (novos) |
| T-6 Casca e cabeçalho | `src/app/(publico)/recuperar-senha/{page.tsx, acoes.ts}`, `src/app/(publico)/redefinir-senha/{page.tsx, acoes.ts}` (novos), `next.config.ts`, `tests/integration/auth/recuperacao-senha-paginas.test.ts` (novo) |
| T-7 E2E, docs e gates | `e2e/recuperar-senha.spec.ts` (novo), `README.md` (seção "Recuperação de senha" + linha do E2E em "Testes"), este `dev.md` |

Sem migração, sem variável de ambiente nova, sem dependência nova, sem `*.acao.ts`. Não foram tocados: `prisma/**`, `src/config/navegacao.ts`, `tests/support/**`, `confirmacao-email.ts`, `token-confirmacao.ts`, `rate-limit.ts`, `entrar/**`, `Dockerfile`, `docker-compose.yml`, `.github/**`, `.env.example`, `env.ts` (conferido com `git status`).

## 2. Comandos e resultados

Ambiente: Node v24.21.0, PostgreSQL do compose (`postgres:17`).

| Comando | Resultado |
|---|---|
| `npm run db:generate` | ok (Prisma Client 7.10.1) |
| `npm run lint` | ok, 0 avisos |
| `npm run typecheck` | ok |
| `npm run build` | ok. `○ /recuperar-senha` (estática), `ƒ /redefinir-senha` (dinâmica) |
| `npm test` | 144 arquivos, **1976 testes passaram** |
| `npm run test:coverage` | 144 arquivos, 1976 testes, exit 0. **Linhas 99,89% (1886/1888)**, statements 99,32%, branches 98,3%, funções 99,59% |
| `npm run test:e2e` (porta 3000 livre) | build + Playwright: **48 passaram** (inclui os 10 novos de `e2e/recuperar-senha.spec.ts`) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/recuperacao-senha-concorrencia.test.ts \|\| break; done` | **10/10** (4 testes, cada um com 10 repetições internas); nenhum `deadlock` nos logs |
| Laço do login: `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/login.test.ts tests/integration/auth/sessao-rbac.test.ts tests/integration/auth/sessao-senha-vigente.test.ts \|\| break; done` | **10/10** (42 testes) |
| Laço do cadastro da D-011: `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/repos-cadastro.test.ts tests/integration/auth/cadastro-concorrencia.test.ts \|\| break; done` | **10/10** (21 testes) |
| T-1: `repos-recuperacao.test.ts` 10× seguidas | **10/10** |
| `npx vitest run --project integration tests/integration/auth tests/integration/tenant/registro.test.ts` | 15 arquivos, 200 testes ok (antes da adição do teste da corrida busca × emissão) |

Cobertura por arquivo novo ou alterado (`coverage/coverage-summary.json`): **100% de linhas e 100% de branches** em `token-recuperacao.ts`, `recuperacao-senha.ts`, `repos/sessao.ts`, `auth/sessao.ts`, `login.ts` e nos oito arquivos de `recuperar-senha/` e `redefinir-senha/` (`page.tsx`, `acoes.ts`, `estado.ts`, `Formulario*.tsx`). Nenhuma exclusão nova.

Prova de que o CA-16 detecta a corrida: com o `login.ts` de `HEAD` (sessão incondicional) restaurado temporariamente, os 4 testes de CA-16 (2 em `sessao-senha-vigente.test.ts`, 2 em `recuperacao-senha-concorrencia.test.ts`, inclusive o disparo simultâneo **sem** portão) falharam; com a mudança da T-2, passam. O `login.ts` novo foi restaurado em seguida.

### 2.1 Prova manual com Docker

Script fora do repositório (Playwright + `pg`) contra `docker compose up -d --build --wait` (app em `next start`, `init: true`). Dois contornos, **só nesta prova**, por um override de compose fora do repositório:
- porta da app publicada na **3100** (`ports: !override`, `APP_URL=http://localhost:3100`): a 3000 estava ocupada por um `npm run dev` aberto num terminal do VS Code do usuário, que não encerrei;
- montagem só leitura de `src/config` em `/app/src/config`: **defeito preexistente em `main`** (ver §4, R-A), a app não sobe sem isso.

Roteiro e resultado (gestor confirmado criado por SQL com senha argon2id):
1. Login com a senha antiga (com JS) → `/painel` (sessão S1).
2. `/recuperar-senha` com JS → POST 200, `status` com a mensagem uniforme. O e-mail apareceu em `email_log` **36 ms** depois de a resposta chegar (rodada 2: 30 ms). Log da app: `auth.recuperacao_senha` `enviado` com `usuarioId`, sem e-mail.
3. Link aberto **sem JS** → GET 200, `referrer-policy: strict-origin`, h1 "Definir nova senha". Nova senha enviada sem JS → POST 200 com `referrer-policy: strict-origin`, h1 **"Senha alterada"** e "Sua senha foi alterada. Entre com a nova senha.". O log mostra, logo depois, `auth.redefinicao_senha_link` `recusado`/`ja_utilizado`: é a re-renderização da página no POST sem JS, e a tela ainda assim mostrou o sucesso (D-18 confirmada no navegador).
4. Sessões do usuário: 0 ativas de 1 (`sessoesRevogadas: 1` no log). S1 em `/painel` → redirecionada para `/entrar?proximo=%2Fpainel`.
5. Login com a senha antiga → "E-mail ou senha incorretos."; com a nova → `/painel`. Reabrir o link usado → "Link inválido".
6. Rodada 2, tudo **com JS**: novo pedido, redefinição → "Senha alterada"; login com a segunda senha → `/painel`. Tokens: 2 `recuperacao_senha`, ambos usados.
7. E-mail inexistente → mesma mensagem uniforme; 0 linhas em `email_log`; log `ignorado`.
8. Nenhuma linha do log da app contém e-mail ou senha (`grep` com 0 ocorrências).

Ao final: `app` e `worker` parados e removidos; só o `postgres` no ar; portas 3000 e 3100 livres. O usuário e o salão da prova ficaram na base de desenvolvimento `agenda_beleza` (e-mail `prova-d012-…@exemplo.com`).

## 3. Testes e CAs

| CA | Teste(s) |
|---|---|
| CA-1 | `recuperacao-senha.test.ts` "CA-1" (gestor com `  ANA@Exemplo.com `, profissional ativo); `repos-recuperacao.test.ts` (emissão) |
| CA-2 | `recuperacao-senha.test.ts` "CA-2" (inexistente, super admin, profissional inativo, sem perfil); `recuperacao-senha-paginas.test.ts` "CA-2 (casca) e D-4 (b)" (estado idêntico) |
| CA-3 | `recuperacao-senha.test.ts` "CA-3" (2 sessões por `entrarDeVerdade`, `resolverTenant` 401, `$argon2id$`, logins); `repos-recuperacao.test.ts`; `recuperacao-senha-paginas.test.ts` "CA-3 (casca)" |
| CA-4 | unidade `estadoDoToken` (T+1h−1ms/T+1h/T+1h+1s); integração CA-4a/b/c (GET e POST); `repos-recuperacao.test.ts` (limite exato) |
| CA-5 | `recuperacao-senha-paginas.test.ts` (3 GETs na página, tabela `token` idêntica); `recuperacao-senha.test.ts` (serviço) |
| CA-6 | unidade (formatos, sem banco); integração (sem registro, token de confirmação, contraprova em `confirmarEmail`); página (ausente, vazio, 10 KB, malformado, repetido com `DATABASE_URL` inválida; usado/expirado/substituído/inelegível); E2E |
| CA-7 | unidade `validarNovaSenha`; integração (7, 1025, ausente, número; `hashSenha` com contador = 0; token continua válido; 8 espaços aceitos); casca (Blob, campo ausente) |
| CA-8 | `recuperacao-senha.test.ts` "CA-8"; `repos-recuperacao.test.ts` (COALESCE) |
| CA-9 | `recuperacao-senha.test.ts` "CA-9" (+ contraprova); página (inelegível) |
| CA-10 | `recuperacao-senha.test.ts` "CA-10" (existente × inexistente, janela seguinte, chaves `login:`/`reenvio-confirmacao:` intactas, e-mail inválido não conta); casca (limite) |
| CA-11 | `recuperacao-senha-concorrencia.test.ts` CA-11a e CA-11b (×10 internas, laço ×10) |
| CA-12 | `recuperacao-senha.test.ts` "CA-12" (porta que lança `ErroEnvioEmail`; `EMAIL_ADAPTER=real` sem SMTP; `APP_URL` inválida; novo pedido invalida e envia) |
| CA-13 | `recuperacao-senha.test.ts` "CA-13"; `repos-recuperacao.test.ts`; casca: campos extras `salaoId`/`usuarioId` ignorados nas duas ações |
| CA-14 | `recuperacao-senha.test.ts` "CA-2" (pedido) e "CA-14" (token inserido para super admin) |
| CA-15 | `recuperacao-senha.test.ts` "CA-15"; `repos-recuperacao.test.ts` (DELETE só da janela/chave certas) |
| CA-16 | `sessao-senha-vigente.test.ts` (hash trocado entre verificação e sessão); `recuperacao-senha-concorrencia.test.ts` (portão de promessa e disparo simultâneo) |
| CA-17 | `recuperacao-senha.test.ts` "CA-17" (todas as linhas de log do arquivo × senhas, tokens, hashes de token, `senha_hash`, e-mails; sem `@` nem `argon2`); CA-3 com `sessoesRevogadas: 2` |
| CA-18 | `recuperacao-senha-paginas.test.ts` (`headers()` do `next.config.ts`; metadata sem `referrer`); E2E (GET com e sem token, POST, ausente em `/recuperar-senha` e `/entrar`, sub-requisições sem token no `Referer`) |
| CA-19 | `FormularioRecuperar.test.tsx`, `FormularioRedefinir.test.tsx` (inclui D-18: prop `recusado` + estado `sucesso` → sucesso); E2E (Tab, axe, sem rolagem, sem JS, "Esqueci minha senha" → 200) |
| CA-20 | `recuperacao-senha.test.ts` "CA-20" (`suspenso_manual_em`) |
| CA-21 | §2 |
| D-4 | (a) serviço com `agendar` capturando: nada gravado antes de executar a tarefa; (b) casca com `next/server` substituído por fila; (c) padrão inline nos demais testes |
| R-4 | erro de banco dentro da tarefa (token_hash repetido) → log `falha`, sem exceção; corrida busca × emissão → `ignorado` com `usuarioId` (gancho síncrono em `gerarToken`) |

## 4. Desvios, decisões e riscos

Desvios do desenho (nenhum muda interface ou comportamento previsto):
- **Montagem do e-mail dentro do `try` do ambiente** (`recuperacao-senha.ts`): o desenho só envolvia a resolução da porta e de `APP_URL`; com `APP_URL` inválida o `new URL` lançaria fora dele e o log seria `falha`, não `envio_falhou` como pede o R-4. O link e a mensagem agora são montados dentro do mesmo `try`.
- **Teste de "falha" na tarefa adiada:** o desenho sugeria `gerarToken` com `\u0000`, mas o banco só recebe o SHA-256 (hex), então isso não gera erro. Usei `gerarToken` devolvendo um token já emitido (violação do UNIQUE de `token_hash`), que prova o mesmo (log `falha`, transação desfeita).
- **Falha na redefinição pela casca:** provada com um gatilho temporário no PostgreSQL (padrão do `cadastro-paginas.test.ts` da D-011), porque a ação não recebe `deps`.
- **Texto do e-mail:** "Ao definir a nova senha, você sai de todos os dispositivos em que a sua conta estiver aberta." (redação livre, spec §9).

Riscos e pendências:
- **R-A (defeito preexistente, fora da minha posse, não corrigido):** a imagem Docker não sobe. `next.config.ts` importa `./src/config/navegacao` desde a D-011, e o estágio `final` do `Dockerfile` copia `next.config.ts`, mas não `src/config/`. `next start` falha com `Cannot find module './src/config/navegacao'` e o contêiner sai com 1. `main` tem o mesmo import, então o defeito já existe lá. O job `docker` da CI só faz `docker compose config` e `docker build`, por isso não o pegou. Correção possível (DevOps/arquiteto): copiar `src/config` no estágio final, ou deixar o `next.config.ts` sem import de `src/`. Também vale um smoke de `up --wait` na CI. Esta demanda não piora o quadro: só acrescenta uma entrada em `headers()`.
- R-5 do desenho (envio pendente cortado num `docker compose stop` com SMTP lento) continua como pendência de implantação.
- A redefinição sem JS gera uma linha `auth.redefinicao_senha_link` `recusado`/`ja_utilizado` logo depois do sucesso, por causa da re-renderização da página. É esperado (D-18), mas aparece no log.

## 5. Texto sugerido para o `CLAUDE.md` (líder)

Acrescentar ao fim do parágrafo de "Project status":

> D-012 (E1.3) added password recovery: `/recuperar-senha` (uniform response; per-e-mail limit of 3 per fixed 15-min window, key `recuperacao-senha:` + SHA-256) and `/redefinir-senha?token=…` (GET only verifies; one client component decides between form, refusal and success, and the action state wins over the page verdict so the no-JS POST shows "Senha alterada"). The service is `src/server/auth/recuperacao-senha.ts` (no `next/*`; the lookup, token issue and e-mail run in a deferred task injected through `deps.agendar`, and only `recuperar-senha/acoes.ts` passes `after()` from `next/server`). The pre-context repository is `src/server/repos/token-recuperacao.ts` (lock order `usuario` → `token` → `sessao` → `rate_limit_janela`). The token is valid for 1 h and single use, and a new request invalidates earlier ones. Redefining, in one transaction, sets the new argon2id hash, confirms an unconfirmed e-mail and invalidates pending confirmation tokens, revokes all of the user's sessions, and deletes the current `login:` rate-limit window. Eligible: gestor (confirmed or not) and active profissional. The login now creates the session only if `usuario.senha_hash` is still the verified hash (`criarSessaoSeSenhaVigente`, `SELECT … FOR SHARE`); otherwise it answers "E-mail ou senha incorretos." and the attempt counts as a failure. `Referrer-Policy: strict-origin` is also sent on `/redefinir-senha` (`next.config.ts`).

Novas linhas na tabela "Comandos e cobertura":

| Objetivo | Comando | Observações |
|---|---|---|
| E2E da recuperação de senha (D-012) | `npx playwright test e2e/recuperar-senha.spec.ts` | exige build prévio e porta 3000 livre; sem banco (teclado, axe, sem JS, `Referrer-Policy`) |
| Concorrência da recuperação (D-012) | `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/recuperacao-senha-concorrencia.test.ts \|\| break; done` | CA-11 (duplo envio; pedido × redefinição) e CA-16 (login com a senha antiga × redefinição) |

E atualizar a linha "Estabilidade do login (D-010)" para incluir `tests/integration/auth/sessao-senha-vigente.test.ts` no laço.

## 6. Rodada 2: correção do DEF-1 (testes.md)

**Defeito:** `npm test` falhava de forma intermitente (3 de 7 execuções do tester) com `TestTimeoutError` (5000 ms) em `tests/integration/auth/recuperacao-senha-concorrencia.test.ts`. Cada `it` faz 10 repetições com argon2 e, sob 4 workers, passava do prazo padrão. Não houve falha de asserção nem impasse.

**Correção (T-4):** prazo explícito `PRAZO_MS = 30_000` como terceiro argumento dos 4 `it` do arquivo, com um comentário que remete ao DEF-1. O `testTimeout` global e o número de repetições não mudaram. `recuperacao-senha-tester.test.ts` não foi tocado.

**Outros arquivos novos com laços:** medidos isoladamente, com o teste mais lento de cada um: `recuperacao-senha-concorrencia` 2084 ms; `recuperacao-senha-paginas` 384 ms; `recuperacao-senha` 330 ms; `repos-recuperacao` 309 ms; `sessao-senha-vigente` 224 ms. Só o primeiro passa do critério de ~1,5 s, então os demais não mudaram. Sob a suíte completa, o teste mais lento do arquivo corrigido levou 2349 ms (folga de cerca de 12× em relação a 30 s).

**Evidências:**
- `npm run lint` e `npm run typecheck`: ok.
- `npm test` 10× seguidas: **10/10**, cada uma com 1978 testes passando e nenhum `timed out`.
- `npm run test:coverage` 5× seguidas: **5/5**, 1978 testes, linhas em **99,89% (1886/1888)** e nenhum `timed out`.
