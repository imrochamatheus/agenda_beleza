# D-012: testes (issue #14, E1.3, recuperar senha por e-mail transacional)

Autor: tester. Entradas: `issue-14.md`, `spec.md` (CA-1..CA-21), `design.md` (D-1..D-20, riscos do §7.2 e T-8), `dev.md` (desvios 1-4, roteiro §2.1), `devops.md` (correção R-A) e o código da branch `feat/d-012-recuperar-senha` (base `main` `ded2afa`, mudanças não commitadas).

## Rodada 1 (2026-11-20)

### Ambiente
- Branch `feat/d-012-recuperar-senha`, `HEAD` `ded2afa` + árvore de trabalho (sem commit). Node v24.21.0. PostgreSQL `postgres:17` do compose. Adaptadores simulados (`.env` de exemplo, `APP_URL=http://localhost:3000`).
- Porta 3000 livre no início. Nenhum processo do usuário foi encerrado (o Chrome do usuário ficou intocado).
- Prova manual: imagem `agenda-beleza:dev` construída por `sh docker/smoke.sh` (`next start`, `init: true`), viewport 375×812, Chromium do Playwright, com e sem JS.

### Gates

| Comando | Resultado |
|---|---|
| `npm run db:generate` | ok (Prisma Client 7.10.1) |
| `npm run lint` | ok, 0 avisos (também depois do teste novo do tester) |
| `npm run typecheck` | ok (idem) |
| `npm run build` | ok; `○ /recuperar-senha`, `ƒ /redefinir-senha` |
| `npm test` | **intermitente: 3 de 7 execuções falharam** (ver DEF-1). Execuções 1, 3 e 5 de 7: `1 failed`, `2 failed`, `1 failed` de 1976; as demais: 144 arquivos, 1976 testes ok |
| `npm run test:coverage` | exit 0 nesta execução; 145 arquivos, 1978 testes (inclui os 2 do tester). **Linhas 99,89% (1886/1888)**, statements 99,32%, branches 98,3%, funções 99,59% |
| `npm run test:e2e` | 48 passaram (inclui os 9 de `e2e/recuperar-senha.spec.ts`) |
| `DATABASE_URL=postgresql://ninguem:x@127.0.0.1:1/nada npx playwright test e2e/recuperar-senha.spec.ts` | 9/9: o E2E novo não depende de banco (cabe no job `e2e` da CI) |
| Laço concorrência: `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/recuperacao-senha-concorrencia.test.ts \|\| break; done` | 10/10 (isolado); 0 ocorrências de `deadlock` nos 10 logs |
| Laço login: `… login.test.ts sessao-rbac.test.ts sessao-senha-vigente.test.ts` ×10 | 10/10 (42 testes) |
| Laço cadastro D-011: `… repos-cadastro.test.ts cadastro-concorrencia.test.ts` ×10 | 10/10 (21 testes) |
| Laço do teste do tester `recuperacao-senha-tester.test.ts` ×10 | 10/10 |
| `sh docker/smoke.sh` | exit 0: postgres, app e worker `Healthy`; `/api/health` 200; `referrer-policy: strict-origin` em `/confirmar-email` e `/redefinir-senha`; `/app` sem `src/` e sem `next.config.ts` (só `next.config.mjs`) |
| Regressão R-A: `git show HEAD:Dockerfile` → `docker build --target final` → `docker run … app` | exit 1, `Error: Cannot find module './src/config/navegacao'` (defeito reproduzido sem a correção; imagem temporária removida) |

Cobertura: nenhuma exclusão nova (`vitest.config.ts` inalterado). 100% de linhas e de branches em todos os arquivos novos ou alterados: `token-recuperacao.ts`, `recuperacao-senha.ts`, `repos/sessao.ts`, `auth/sessao.ts`, `login.ts` e os oito de `recuperar-senha/` e `redefinir-senha/`. Os testes novos verificam comportamento (estado do banco, logs, hash, sessões), não só executam linhas.

### Prova manual com a imagem Docker (roteiro do tester, Playwright + `pg`, fora do repositório)

Dados criados por SQL na base de desenvolvimento `agenda_beleza` (prefixo `t8-…@exemplo.com`): gestor confirmado e profissional ativo com senha argon2id, 20 gestores, 20 super admins. Resultado: **33 verificações OK, 0 falhas**.

1. Duas sessões (S1, S2) com a senha antiga → `/painel`; 2 sessões ativas no banco.
2. Pedido **com JS** pela UI, e-mail em maiúsculas e com espaços → 200 e mensagem uniforme. O e-mail aparece em `email_log` 6 ms após a resposta (rodadas anteriores: 26 ms). O corpo tem `APP_URL/redefinir-senha?token=`. O token em claro não está em `token.token_hash`.
3. Link aberto **com JS**: `referrer-policy: strict-origin`, `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`, sem `meta name="referrer"`. Nenhuma das 10 sub-requisições leva o token no `Referer` (todas com o caminho `/`). O GET não consome o token.
4. **Sem JS**:
   - GET com `strict-origin`.
   - Senha curta → POST 200 com o erro do campo e `strict-origin`. O token oculto é preservado e a senha volta vazia.
   - Senha válida → POST 200 com `strict-origin`, h1 **"Senha alterada"** e "Sua senha foi alterada. Entre com a nova senha." (risco R-2/D-18 conferido no navegador).
5. 0 sessões ativas. S1 e S2 em `/painel` → `/entrar?proximo=%2Fpainel`. Log: `sessoesRevogadas: 2`.
6. Senha antiga → "E-mail ou senha incorretos."; a nova → `/painel`. Link usado reaberto → "Link inválido".
7. Com JS: dois pedidos → dois links. O 1º (substituído) → "Link inválido". O 2º redefine ("Senha alterada", sem token novo na URL) e o login com a 2ª senha entra. O 4º pedido da janela → "Muitas solicitações. Aguarde alguns minutos e tente de novo.".
8. Profissional ativo redefine sem JS e entra com a nova senha.
9. **Canal de tempo** (POST da Server Action sem JS, n = 20 por classe, ordem embaralhada, após aquecimento):

   | Classe | Mediana | Média | Mín | Máx |
   |---|---|---|---|---|
   | existente (gestor) | 6,9 ms | 7,4 ms | 6,5 ms | 10,4 ms |
   | inexistente | 6,9 ms | 7,2 ms | 6,4 ms | 9,4 ms |
   | super admin | 7,0 ms | 7,1 ms | 6,6 ms | 8,0 ms |

   O corpo da resposta, com o e-mail digitado substituído, é idêntico nas três classes (1 único corpo, 12 707 bytes). Inexistente e super admin: 0 e-mails, 0 tokens. Existente: o e-mail é gravado 3 a 5 ms **depois** do fim da resposta (`after()` funcionando sob `next start`).
10. Logs de `app` e `worker`: 334 linhas, **0** ocorrências dos 18 segredos usados (senhas, tokens, e-mails) e 0 de `@` ou `argon2`. Eventos: `auth.recuperacao_senha` (`enviado`, `ignorado`, `limite`), `auth.redefinicao_senha_link`, `auth.redefinicao_senha` (`ok`, `validacao`) e `auth.login`. As 65 linhas `Invalid Server Actions request` vieram de uma rodada intermediária do meu roteiro, que enviava os campos `$ACTION_*` sem decodificar as entidades HTML (erro do roteiro, não da app). Na rodada final houve 0.

### Teste de regressão adicionado pelo tester

`tests/integration/auth/recuperacao-senha-tester.test.ts` (2 testes; 10/10 no laço):
- **Risco "falha na transação desfaz tudo e mantém o token válido"**: o teste do desenvolvedor só faz a transação falhar no `UPDATE usuario` (passo 4), antes da invalidação dos tokens, da revogação das sessões e do `DELETE` da janela. O teste novo faz a **última** instrução (`DELETE FROM rate_limit_janela`) falhar por gatilho no PostgreSQL. Cenário: gestor não confirmado, com token de confirmação pendente, 2 sessões e janela de login com 4 falhas. Resultado:
  - a resposta é `falha`;
  - o usuário (`senha_hash`, `email_confirmado_em`, `atualizado_em`), os tokens, as sessões e a janela ficam idênticos ao retrato anterior;
  - o link continua válido e, sem o gatilho, o mesmo link redefine tudo de uma vez.
- **D-2**: gestor com perfil de profissional **inativo** continua elegível; redefine e entra, e a senha antiga é recusada.

### Critérios de aceitação

| CA | Situação | Evidência |
|---|---|---|
| CA-1 | passou | `recuperacao-senha.test.ts` "CA-1" (gestor com `  ANA@Exemplo.com `, profissional); prova manual 2 e 8 |
| CA-2 | passou | integração (inexistente, super admin, profissional inativo e sem perfil); casca (estado idêntico); prova manual 9 (corpo idêntico, 0 e-mails, 0 tokens) |
| CA-3 | passou | integração "CA-3"; prova manual 4-6 (sem JS, 2 sessões revogadas, senha antiga recusada) |
| CA-4 | passou | unidade `estadoDoToken` (limites em ms); integração CA-4a/b/c; prova manual 6 (usado) e 7 (substituído) |
| CA-5 | passou | `recuperacao-senha-paginas.test.ts` (3 GETs, tabela intacta); prova manual 3 |
| CA-6 | passou | unidade, integração e página; E2E (sem token e malformado, também sem JS) |
| CA-7 | passou | unidade e integração; prova manual 4 (sem JS: erro, token preservado, senha vazia) |
| CA-8 | passou | integração "CA-8"; teste do tester (confirmação + rollback) |
| CA-9 | passou | integração "CA-9" |
| CA-10 | passou | integração "CA-10"; prova manual 7 (4º pedido → limite) |
| CA-11 | **passou no laço isolado (10/10), mas o arquivo falha por timeout na suíte completa** | ver DEF-1 (a lógica está correta; a falha é de orçamento de tempo do teste) |
| CA-12 | passou | integração "CA-12" |
| CA-13 | passou | integração (dois salões) e casca (campos extras ignorados) |
| CA-14 | passou | integração; prova manual 9 (20 super admins: 0 tokens, 0 e-mails) |
| CA-15 | passou | integração "CA-15"; teste do tester (janela apagada só no sucesso) |
| CA-16 | passou no laço isolado (10/10); mesmo arquivo do DEF-1 | `sessao-senha-vigente.test.ts`, concorrência |
| CA-17 | passou | integração (todas as linhas × segredos); prova manual 10 |
| CA-18 | passou | integração `headers()`; E2E; prova manual 3-4 (GET com token válido e sem JS, POST de erro e de sucesso; sub-requisições da página **com token válido**) |
| CA-19 | passou | jsdom; E2E (teclado, axe, sem JS, "Esqueci minha senha" → 200) |
| CA-20 | passou | integração "CA-20" |
| CA-21 | **falhou** | `npm test` intermitente (DEF-1); os demais gates passaram; README documentado |
| R-A (devops) | passou | smoke OK; regressão reproduzida com o `Dockerfile` de `HEAD`; imagem sem `src/`; CI com o passo de smoke e `down -v` em `always()` |

### Riscos do arquiteto conferidos
- Redefinição sem JS com banco real mostra "Senha alterada": **sim** (prova 4 e 8).
- Laços 10× sem deadlock: **sim** (concorrência, login, cadastro).
- Tempo equivalente para existente, inexistente e super admin: **sim** (mediana 6,9 / 6,9 / 7,0 ms; corpo idêntico).
- `strict-origin` só em `/confirmar-email` e `/redefinir-senha` (GET com e sem token, POST), sem meta e sem token no Referer: **sim** (E2E + prova manual; ausente em `/recuperar-senha` e `/entrar`).
- Falha na transação desfaz tudo e mantém o token: **sim**, inclusive com falha na última instrução (teste do tester).
- `next start` no Docker: e-mail em `email_log` logo após a resposta: **sim** (3 a 26 ms depois).
- Sessões antigas revogadas: **sim**.
- Regressão do login (D-010) e do cadastro (D-011): laços 10/10 e suíte completa sem falhas fora do DEF-1.

### Revisão de código (segurança e invariantes)
- **Enumeração**: o caminho síncrono da solicitação é igual para todo e-mail válido (validação + incremento). Busca, emissão e envio ficam em `after()`. A redefinição só calcula o argon2 com token válido. A validação de formato não revela existência. Ok.
- **Token**: 32 bytes CSPRNG; o banco recebe só o SHA-256; nenhum DTO devolve `token_hash` nem `senha_hash`. O link usa `APP_URL`. O token não entra no estado da ação e só vai para o campo oculto quando o link é válido. Ok.
- **Logs**: só `evento`, `resultado`, `detalhe`, `usuarioId`, `sessoesRevogadas` e `em`. Ok.
- **Validação no servidor**: o e-mail passa por `esquemaEmail`; a senha tem 8..1024 caracteres e não é aparada; o token é checado por `FORMATO_TOKEN`; tudo antes do banco. A ação ignora campos extras. Ok.
- **Revogação de sessões**: na mesma transação da troca do hash. O login cria a sessão com `FOR SHARE` condicionado ao hash vigente (D-11) e, se a senha mudou, responde "credenciais" sem devolver a reserva do limite. Ok.
- **Isolamento**: o alvo vem só do e-mail ou do `token_hash`, e os `UPDATE`s filtram pelo `usuario_id` do token. Ok.
- **Ordem de travas**: `usuario` → `token` → `sessao` → `rate_limit_janela`. Sem deadlock nos laços.
- **Desvios 1-4 do dev.md**: nenhum fere um CA. O desvio 1 melhora o R-4. Os desvios 2 e 3 são técnicas de teste equivalentes. O desvio 4 é de redação.

### Defeitos

```
DEF-1 — npm test / test:coverage intermitentes: recuperacao-senha-concorrencia.test.ts estoura o timeout padrão de 5 s na suíte completa
Severidade: alta   Estado: verificado (Rodada 2)
CA relacionado: CA-21 (gate npm test / test:coverage; job `testes` da CI), CA-11/CA-16 ("repetir 10 vezes sem falha intermitente")
Ambiente: feat/d-012-recuperar-senha (ded2afa + árvore de trabalho), Node v24.21.0, postgres:17 do compose, adaptadores simulados, 4 workers de integração (vitest.config.ts)
Passos para reproduzir:
  1. docker compose up -d postgres
  2. for i in 1 2 3 4 5; do npm test 2>&1 | grep -E "Tests  |TestTimeoutError"; done
Resultado esperado: 1976/1976 em todas as execuções.
Resultado observado: 3 de 7 execuções falharam, sempre neste arquivo:
  × CA-11a: 10× — exatamente 1 sucesso e 1 recusa; … 5004ms   TestTimeoutError: Test timed out in 5000ms.
  × CA-16: 10× — verificador do login atrasado até depois do commit da redefinição → sem sessão 5001ms   TestTimeoutError
  (outra execução: só CA-11a, 5013ms)
  Isolado, o arquivo leva ~2,2 s por `it` (CA-11a 2162 ms, CA-11b 1830 ms, CA-16 1714/1715 ms) e passa 10/10. Na suíte
  completa (4 workers, argon2 em paralelo), cada `it` com 10 repetições internas (2 argon2 + 2 verificações por
  repetição) passa de 5 s. Não é deadlock nem erro de lógica: nenhum assert falhou, só o tempo.
Classe de falha: estabilidade de teste / orçamento de tempo (concorrência)
Sugestão (posse da T-4, só arquivo de teste): timeout explícito e folgado nos `it` do arquivo (ex.: `it(nome, fn, 30_000)`),
  sem mexer no `testTimeout` global nem reduzir as repetições. Reteste: 10 execuções seguidas de `npm test` sem falha.
```

Observações (sem defeito):
- OBS-1: depois do sucesso sem JS, o log ganha uma linha `auth.redefinicao_senha_link` `recusado`/`ja_utilizado`, por causa da re-renderização. É esperado (D-18) e já está no `dev.md`.
- OBS-2: o limite de 3 pedidos por e-mail em 15 min permite que um terceiro atrase a recuperação de uma vítima por até 15 min. É decisão de desenho (D-5), sem revelar existência.
- OBS-3: o E2E de sub-requisições usa só a página de recusa (token malformado, sem banco). A página com formulário (token válido) foi conferida na prova manual: 10 sub-requisições, nenhuma com o token.
- Dados da prova manual ficaram na base de desenvolvimento `agenda_beleza` (usuários `t8-…@exemplo.com`).

### Estado final do ambiente
`docker compose stop app worker`: só o `postgres` no ar (healthy). Porta 3000 livre. Imagem temporária `agenda-beleza:t8-head` removida.

### Veredito da Rodada 1: **REPROVADO**
Todos os CAs funcionais (CA-1..CA-20) e a correção R-A passaram, com evidência. O gate `npm test` (CA-21) falha de forma intermitente (3/7) por DEF-1 (alta, aberto). Corrigir DEF-1 e retestar com 10 execuções seguidas de `npm test` e de `npm run test:coverage`.

## Rodada 2 (2026-11-20): reteste do DEF-1 e regressão

### O que mudou desde a Rodada 1
- Só `tests/integration/auth/recuperacao-senha-concorrencia.test.ts` (e o `dev.md` §6).
  - O `git diff --stat` dos arquivos rastreados é idêntico ao da Rodada 1 (7 arquivos, +112/−8).
  - Nenhum arquivo de `src/`, `e2e/`, `docker/`, `Dockerfile`, `next.config.ts`, `.github/` ou `README.md` é mais recente que o `testes.md` da Rodada 1.
  - Por isso o E2E, o smoke e a prova Docker não foram repetidos (código de produção e infraestrutura intocados).
- Correção conferida:
  - `const PRAZO_MS = 30_000` é passado como 3º argumento a cada um dos 4 `it` (linhas 79, 115, 148 e 168), ou seja, o prazo é **por teste**;
  - `vitest.config.ts` continua sem `testTimeout` (global inalterado);
  - `REPETICOES = 10` também não mudou.

### Comandos e resultados (ambiente igual ao da Rodada 1)

| Comando | Resultado |
|---|---|
| `npm test` 10× seguidas | **10/10**, cada uma com 145 arquivos e 1978 testes ok |
| `npm run test:coverage` 10× seguidas | **10/10**, 1978 testes; linhas **99,89%**, statements 99,32%, branches 98,3%, funções 99,59% em todas |
| `TestTimeoutError` nos 20 logs | 0 |
| `npx vitest run --reporter=verbose` (suíte completa): duração dos 4 `it` do arquivo | 2726, 2765, 1873 e 2277 ms (prazo de 30 s; na Rodada 1 passavam de 5 s) |
| Laço da concorrência isolada ×10 | 10/10; 0 `deadlock` |
| `npm run lint` / `npm run typecheck` | ok / ok |

### Critérios
- DEF-1: **verificado** (fechado).
- CA-11 e CA-16: passaram (lógica já provada na Rodada 1; agora sem intermitência na suíte completa).
- CA-21: **passou** (todos os gates verdes, `npm test` e `test:coverage` estáveis em 10/10).
- Os demais CAs e o R-A seguem como na Rodada 1, porque o código não mudou. A regressão é coberta pelas 20 execuções completas, que incluem os testes da D-010, da D-011 e o `recuperacao-senha-tester.test.ts`.

### Estado final do ambiente
Só o `postgres` no ar; porta 3000 livre.

### Veredito da Rodada 2: **APROVADO**
Todos os CAs passaram e todos os gates passaram. Cobertura de linhas 99,89%. Não há defeito crítico nem alto em aberto.
