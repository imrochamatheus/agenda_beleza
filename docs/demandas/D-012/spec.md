# D-012: recuperar senha por e-mail transacional (issue #14, E1.3)

Autor: analista-requisitos. Fontes, da maior para a menor precedência:
1. `docs/demandas/D-012/issue-14.md`: RN-1..RN-3, CA-1..CA-4, fora do escopo e entregáveis, já decididos. Não são reabertos aqui.
2. `PLAN.md`: "Perfis e acesso" (`:15`, `:17`, `:19`: "Recuperação de senha e convite de profissional usam e-mail transacional"), "Interface" (`:105`), "Direção técnica" (`:119`, validação no servidor e sessões seguras; `:121`, entidade "token de recuperação de senha"), "Fora da primeira versão" (`:131`) e critério de aceite 8 (`:142`).
3. `CLAUDE.md`: invariantes (isolamento no servidor, integrações atrás de adaptadores), "Roles", "UI conventions" e política de cobertura.
4. `docs/demandas/D-001/spec.md`: item E1.3 (`:490-519`) e S15 (`:88`: recuperação 1 h, uso único, hash, senha mínima de 8, "redefinir senha encerra as demais sessões").
5. `docs/demandas/D-010/spec.md` (RN-6 entrada, RN-13 revogação por usuário, RN-22 sigilo, RN-23 hash; `:52` fronteira com a E1.3) e `docs/demandas/D-011/spec.md`, `design.md`, `dev.md` e `testes.md` (padrão de token, reenvio uniforme com limite, envio após o commit, `Referrer-Policy: strict-origin` em vez de `no-referrer` (DEF-1/DEF-2), pendência "a E1.3 deve aceitar usuário não confirmado", observação de canal de tempo).
6. Código da branch `feat/d-012-recuperar-senha` (= `main` em `ded2afa`).

Esta especificação acrescenta: (a) RNs complementares que tornam a issue verificável (RN-4 em diante); (b) a regra para usuário não confirmado, profissional e super admin; (c) as decisões não bloqueantes D-n (§9), que o arquiteto deve confirmar.

## Dúvidas bloqueantes

Nenhuma. Todas as dúvidas encontradas têm um padrão razoável e foram resolvidas como decisões no §9.

## 1. Problema

A funcionalidade não existe. Quem esquece a senha não tem como voltar a entrar.

- `ls "src/app/(publico)"` lista apenas `cadastro/`, `confirmar-email/` e `entrar/`. Não há `recuperar-senha/` nem `redefinir-senha/`, e `src/server/auth/` não tem `recuperacao-senha.ts`.
- `src/app/(publico)/entrar/FormularioEntrar.tsx:61` aponta o link "Esqueci minha senha" para `ROTAS.recuperarSenha` (`/recuperar-senha`), que hoje responde 404, como previsto pela D-010 (`docs/demandas/D-010/spec.md:52`).
- `src/config/navegacao.ts:14-15` já declara `ROTAS.recuperarSenha = '/recuperar-senha'` e `ROTAS.redefinirSenha = '/redefinir-senha'`, e os dois segmentos já estão em `SEGMENTOS_RESERVADOS` (`navegacao.test.ts:136-137`). Nenhuma rota nova é necessária.
- O schema já comporta a funcionalidade:
  - `prisma/schema.prisma:35-40`: `enum TipoToken { confirmacao_email, recuperacao_senha }`.
  - `:219-234`, `model Token`: `token_hash` UNIQUE, `expira_em`, `usado_em`, `invalidado_em`, `criado_em` e índices `(usuario_id, tipo)` e `(expira_em)`.
  - `:174-197`, `model Usuario`: `senha_hash`, `email_confirmado_em` e `atualizado_em`.
- Peças prontas:
  - `src/server/auth/senha.ts:20,25`: `gerarHashSenha` e `verificarSenha` (argon2id, único módulo do algoritmo, D-010 RN-23).
  - `src/server/auth/sessao.ts:16-18`: `gerarToken` (32 bytes CSPRNG, base64url, 43 caracteres).
  - `src/server/auth/sessao.ts:38-41` e `src/server/repos/sessao.ts:116-122`: `revogarSessoesDoUsuario`, que grava `revogada_em` em todas as sessões não revogadas.
  - `src/server/repos/sessao.ts:27-29`: `buscarSessaoValida` exige `revogadaEm: null`, então uma sessão revogada deixa de autenticar.
  - `src/server/tenant/sessao.ts`: `hashDoToken` (SHA-256).
  - `src/server/repos/rate-limit.ts:11-27`: `incrementarJanela` e `decrementarJanela`.
  - `src/server/auth/login.ts:53,63-65`: o esquema de e-mail e `inicioDaJanela`, a janela fixa de 15 min em UTC.
  - `src/server/auth/confirmacao-email.ts`: `FORMATO_TOKEN`, `esquemaEmail`, `registrarLog`, o padrão "envio após o commit, sem relançar" (`:98-133`) e o link montado com `APP_URL` (`:61-65`).
- Comportamento atual relevante:
  - `src/server/auth/login.ts:114-121`: super admin recebe sempre "E-mail ou senha incorretos." no `/entrar`. Gestor não confirmado, mesmo com a senha certa, recebe "Confirme seu e-mail antes de entrar.". Profissional inativo recebe "Seu acesso está desativado…".
  - `src/server/repos/token-confirmacao.ts:59,77`: os fluxos de confirmação já ignoram tokens de outro tipo, então um token `recuperacao_senha` aberto em `/confirmar-email` dá "inválido" (D-011 CA-14).
  - `next.config.ts`: `Referrer-Policy: strict-origin` vale só para `ROTAS.confirmarEmail`.

## 2. Objetivo

Gestor e profissional que esqueceram a senha pedem, em `/recuperar-senha`, um link enviado ao e-mail cadastrado. O link vale 1 hora e é de uso único. Ao abri-lo, a pessoa define uma nova senha em `/redefinir-senha`. A partir daí, só a nova senha funciona, e todas as sessões abertas do usuário são encerradas. A tela de solicitação nunca revela se o e-mail existe. Isso atende à metade "recuperação de senha" do critério de aceite 8 do PLAN.

## 3. Escopo

### Entra
1. Página `/recuperar-senha`: formulário com o e-mail e resposta uniforme.
2. Página `/redefinir-senha?token=…`: valida o link sem consumi-lo, mostra o formulário de nova senha e trata os estados recusados.
3. Serviço `src/server/auth/recuperacao-senha.ts`: solicitar (emitir o token, invalidar os anteriores, aplicar o limite, enviar o e-mail) e redefinir (consumo atômico, troca do hash, revogação das sessões).
4. Funções de repositório pré-contexto em `src/server/repos/`, porque só os repositórios importam o Prisma.
5. Cabeçalho `Referrer-Policy: strict-origin` também em `/redefinir-senha` (RN-14).
6. Testes: `tests/integration/auth/recuperacao-senha.test.ts` (CA-1..CA-4 e os complementares), unitários de expiração e de validação, e testes de componente dos formulários.
7. README: seção sobre a recuperação de senha, incluindo como ler o link em `email_log` no modo simulado.

### Fica fora
- **Super admin** (a issue o exclui; E1.5). O pedido feito com o e-mail de um super admin recebe a resposta uniforme e não envia nada (RN-6).
- **Troca de senha estando logado** (no "meu perfil"): não consta da issue nem do PLAN para a E1.3.
- **E-mail de aviso "sua senha foi alterada"** (D-10).
- **Login automático** após redefinir (D-7).
- **Turnstile e rate limit por IP**: o PLAN exige captcha e limite por IP só na página pública (`PLAN.md:47-49`, critério 10). Aqui há apenas o limite por e-mail (RN-8), como no reenvio da D-011 (D-011 D-5).
- **Limpeza de tokens vencidos**: sem job, igual à D-011 D-10.
- **E2E com banco**: o job `e2e` da CI não tem PostgreSQL (D-010 D-13, D-011 D-11). Ver D-13.
- Conferência com "Fora da primeira versão" (`PLAN.md:131`): nada aqui cria conta de cliente, gestor adicional nem estrutura fora do escopo.

## 4. Regras de negócio

RN-1..RN-3 vêm da issue e estão decididas. As demais as detalham ou complementam, com a origem indicada.

- **RN-1** (issue; D-010 RN-2): a resposta à solicitação é a mesma para e-mail existente ou não.
- **RN-2** (issue; S15): o token é aleatório, armazenado como hash, expira em 1 h e é de uso único. Uma nova solicitação invalida os tokens anteriores.
- **RN-3** (issue; S15; D-010 RN-13): ao redefinir, **todas** as sessões do usuário são encerradas, inclusive a do navegador em uso, se houver.

- **RN-4 — Entrada da solicitação** (`PLAN.md:119`; D-010 RN-6):
  - O e-mail é aparado e convertido para minúsculas, precisa ter formato de e-mail e tem no máximo 254 caracteres. É o mesmo esquema do login e do cadastro (`login.ts:53`, `confirmacao-email.ts:49`).
  - E-mail vazio ou inválido recebe, no campo, a mensagem "Informe um e-mail válido.", sem consulta ao banco e sem contar no limite.
  - Essa validação depende só do formato, então não revela existência.

- **RN-5 — Token de recuperação** (RN-2; S15; padrão da D-011 RN-12):
  - Valor de 32 bytes de CSPRNG em base64url (`gerarToken`). Em `token.token_hash` vai só o SHA-256 (`hashDoToken`). O valor em claro existe apenas no link.
  - `tipo = 'recuperacao_senha'` e `expira_em` = emissão + 1 h. O relógio é o do servidor, injetável nos testes, e a gravação é em UTC.
  - O token é válido se e somente se: `tipo = 'recuperacao_senha'`, `usado_em IS NULL`, `invalidado_em IS NULL` e `agora < expira_em`. Exatamente 1 h após a emissão ele já está expirado.
  - O link é `APP_URL + ROTAS.redefinirSenha + '?token=' + token`, montado com `APP_URL` (`env.ts`), **nunca** com o cabeçalho `Host` da requisição.

- **RN-6 — Quem pode recuperar** (issue: "gestor e profissional"; S17; D-010 RN-7; pendência da D-011, `design.md:488`). O token só é emitido se o usuário existir e atender a uma destas condições (D-2):
  - **gestor**, com o e-mail confirmado ou não (ver RN-11);
  - **profissional** com perfil vinculado e `ativo = true`.

  Em qualquer outro caso nada é gravado nem enviado, e a resposta é a uniforme da RN-7: e-mail inexistente, **super admin**, profissional inativo e profissional sem perfil.

- **RN-7 — Resposta da solicitação** (RN-1):
  - Em todos os casos da RN-6, e também quando o envio falha (RN-9), a tela mostra a mesma mensagem: "Se houver uma conta com este e-mail, enviamos um link para redefinir a senha. Ele vale por 1 hora." O mesmo vale para o código de status e a estrutura do estado devolvido.
  - O e-mail digitado não é reexibido como confirmação de existência; pode ser mantido no campo, como na D-011.

- **RN-8 — Limite de solicitações** (D-011 RN-14 e D-4; D-5 aqui):
  - No máximo 3 solicitações por e-mail normalizado por janela fixa de 15 min em UTC (`inicioDaJanela`).
  - O contador fica em `rate_limit_janela`, com a chave `recuperacao-senha:` + SHA-256 do e-mail. A chave é própria, independente de `login:` e de `reenvio-confirmacao:`.
  - Contam todas as solicitações válidas pela RN-4, exista o e-mail ou não. Não há decremento.
  - A 4ª solicitação da janela não grava token nem envia e-mail e recebe "Muitas solicitações. Aguarde alguns minutos e tente de novo.". Como o limite vale para qualquer e-mail, essa resposta também não revela existência.

- **RN-9 — Emissão e envio** (RN-2; CLAUDE.md, integrações atrás de adaptadores; D-011 RN-15):
  - Para um usuário elegível, numa transação com a linha de `usuario` travada (`FOR UPDATE`, mesma ordem de travas da D-011, usuário antes do token): invalida (`invalidado_em = agora`) todos os tokens `recuperacao_senha` pendentes do usuário, vencidos ou não, e insere o novo.
  - Tokens `confirmacao_email` não são afetados na emissão.
  - O e-mail sai pela porta de `integracoes().email` **depois do commit**.
  - Conteúdo mínimo:
    - Assunto: "Redefinição de senha no Agenda Beleza".
    - Texto puro em pt-BR, com o nome do usuário, o link (RN-5), a validade de 1 hora e o uso único.
    - Aviso de que, ao definir a nova senha, a pessoa sai de todos os dispositivos.
    - "Se você não pediu, ignore esta mensagem: sua senha atual continua valendo."
  - A falha no envio (qualquer erro do adaptador ou do ambiente) **não desfaz** o token gravado e **não muda a resposta** (RN-7). É uma diferença intencional em relação ao cadastro, que avisa a falha, e evita enumeração. A falha vai para o log (RN-15).
  - Quando o e-mail é enviado em relação à resposta: D-4.

- **RN-10 — Abertura do link** (issue CA-4; D-1): `GET /redefinir-senha?token=…` **apenas verifica** o token, sem consumi-lo e sem gravar nada.
  - Token **válido** → formulário de nova senha.
  - Token **ausente, vazio, malformado** (fora de `FORMATO_TOKEN`; sem consulta ao banco), **inexistente, de outro tipo, já utilizado, expirado, substituído (invalidado)** ou de **usuário que deixou de ser elegível** (RN-6, por exemplo profissional desativado depois do pedido) → tela de recusa com uma única mensagem: "Este link de redefinição é inválido, expirou ou já foi usado. Peça um novo link." Ela traz um link para `/recuperar-senha` e não mostra o formulário (D-6).
  - O motivo interno é distinguido só no retorno do serviço e no log.

- **RN-11 — Redefinição** (RN-2, RN-3; S15; D-010 RN-23):
  - **Nova senha**: não é aparada nem normalizada, tem de 8 a 1024 caracteres (`string.length`) e segue os mesmos limites do cadastro (D-011 RN-7). Mensagens: "A senha precisa ter pelo menos 8 caracteres." / "A senha pode ter no máximo 1024 caracteres.". Erro de validação não consome o token: o formulário volta com a mensagem, o token preservado (campo oculto) e a senha vazia.
  - **Ordem**:
    1. Valida o formato do token e a senha, sem banco.
    2. Verifica o token por leitura. Se for recusado, responde sem calcular o hash, o que evita custo de argon2 com token inválido.
    3. Calcula `gerarHashSenha` **fora** da transação.
    4. Executa a transação.
  - **Transação única** (usuário `FOR UPDATE` → token):
    1. Consome o token com `UPDATE` condicional (`usado_em = agora WHERE token_hash = ? AND tipo = 'recuperacao_senha' AND usado_em IS NULL AND invalidado_em IS NULL AND expira_em > agora`). Se 0 linhas forem afetadas, o resultado é a recusa da RN-10 e nada mais é gravado.
    2. Rechecagem da elegibilidade (RN-6). Se o usuário não for mais elegível, desfaz e recusa.
    3. `usuario.senha_hash` = novo hash e `atualizado_em = agora`.
    4. Invalida os demais tokens `recuperacao_senha` pendentes do usuário.
    5. **Gestor não confirmado**: preenche `email_confirmado_em = agora` e invalida os tokens `confirmacao_email` pendentes (D-3). O link prova o controle da caixa de e-mail, a mesma prova da confirmação.
    6. Revoga todas as sessões do usuário (`revogada_em = agora` em todas as não revogadas), dentro da mesma transação. Assim não existe instante em que a senha nova já vale e uma sessão antiga ainda autentica.
    7. Zera o contador de falhas de login (`login:` + SHA-256 do e-mail) da janela vigente (D-8).
  - **Resultado**: tela "Senha alterada" com a mensagem "Sua senha foi alterada. Entre com a nova senha." e um link para `/entrar` (D-7). O cookie `ab_sessao` do navegador, se existir, não precisa ser apagado: a sessão já está revogada e o próximo acesso a `/painel` redireciona para `/entrar`.
  - A senha nova pode ser igual à anterior (D-16).

- **RN-12 — Concorrência** (padrão D-011 RN-13/CA-14):
  - Dois envios do mesmo token válido em paralelo: exatamente um redefine; o outro recebe a recusa da RN-10. O `senha_hash` final é o do vencedor.
  - Uma solicitação nova em paralelo com a redefinição: vale a primeira a travar o usuário. Se a redefinição vencer, o token novo é emitido depois e continua válido. Se a solicitação vencer, o token antigo fica invalidado e a redefinição é recusada.
  - Nenhuma combinação deixa dois tokens `recuperacao_senha` válidos para o mesmo usuário.

- **RN-13 — Corrida login × redefinição** (RN-3; D-11): um login com a senha **antiga** que verificou o hash antes do commit da redefinição e cria a sessão depois dela não pode resultar em sessão válida. Mecanismo sugerido: a criação da sessão do login fica condicionada a que `usuario.senha_hash` ainda seja o hash verificado. O arquiteto escolhe o mecanismo ou registra o risco residual (D-11).

- **RN-14 — Sigilo do token na página** (D-011 DEF-1/DEF-2, revisão da D-15):
  - `/redefinir-senha` recebe o cabeçalho HTTP `Referrer-Policy: strict-origin`, via `headers()` em `next.config.ts` com `source: ROTAS.redefinirSenha`. **Nunca** `no-referrer`, nem por meta nem por cabeçalho: ele faz o POST sem JS sair com `Origin: null` e a Server Action falhar com 500.
  - A página não carrega recursos de terceiros.
  - O token vai no POST como campo oculto. Não aparece em texto visível, não é ecoado em URL nova e não vai para log.

- **RN-15 — Sigilo e logs** (D-010 RN-22; D-011 RN-19): senha, token em claro, `token_hash`, `senha_hash` e e-mail em claro nunca aparecem em log, em mensagem de erro, em URL (exceto o token no link, por necessidade) nem em payload de fila. Cada operação gera uma linha JSON:
  - `{ evento: 'auth.recuperacao_senha', resultado: 'enviado' | 'envio_falhou' | 'ignorado' | 'limite' | 'validacao', usuarioId?, em }`;
  - `{ evento: 'auth.redefinicao_senha', resultado: 'ok' | 'recusado' | 'validacao', detalhe?: 'invalido' | 'ja_utilizado' | 'expirado_ou_substituido' | 'inelegivel', usuarioId?, sessoesRevogadas?, em }`.

  O adaptador simulado grava o corpo com o link em `email_log`, por desenho da D-007. Isso só acontece no modo simulado.

- **RN-16 — Isolamento e pré-autenticação** (CLAUDE.md, isolamento no servidor; D-011 §6):
  - Os dois fluxos são pré-autenticação e operam sobre tabelas globais (`usuario`, `token`, `sessao`, `rate_limit_janela`) por funções de repositório pré-contexto, documentadas como exceção, como `buscarUsuarioParaLogin`.
  - O usuário é identificado **só** pelo e-mail (único na plataforma) ou pelo `token_hash`. Nenhuma entrada permite escolher `salao_id` ou `usuario_id`.
  - Redefinir altera apenas o usuário dono do token. As sessões e os dados de outros usuários e de outros salões ficam intocados.

- **RN-17 — Salão suspenso** (S13): a recuperação de senha não é uma operação de salão. Funciona para gestor e profissional de salão em qualquer estado (pendente, suspenso, encerrado). Hoje a política é `permitirTudo` (`src/server/tenant/politica.ts`). A E6.4 não deve bloquear este fluxo.

- **RN-18 — UI** (CLAUDE.md "UI conventions"; D-009; mesmo padrão de `/entrar` e `/cadastro`):
  - Requisitos comuns:
    - pt-BR, `PublicLayout` e componentes de `src/components/ui/` (`Field`, `Button`, `Alert`);
    - ação de servidor com `useActionState`, que funciona **sem JS** (`<form action>`);
    - erro por campo ligado por `aria-describedby`, `Alert` anunciado e botão com estado ocupado;
    - operável só pelo teclado, sem violações axe, sem cor fora dos tokens;
    - caminhos só via `ROTAS`;
    - ações em arquivos de casca (`acoes.ts`), não em `*.acao.ts` (pré-autenticação, D-010 RN-24).
  - `/recuperar-senha`:
    - `h1` "Recuperar senha" e um texto curto explicando o envio do link.
    - Campo "E-mail" (`type="email"`, `autoComplete="email"`) e botão "Enviar link".
    - Depois do envio, mostra a mensagem uniforme num `Alert`.
    - Link "Voltar para entrar" (`ROTAS.entrar`).
  - `/redefinir-senha` (token válido):
    - `h1` "Definir nova senha".
    - Campo "Nova senha" (`type="password"`, `autoComplete="new-password"`, dica "Mínimo de 8 caracteres").
    - Campo oculto `token` e botão "Salvar nova senha".
    - Sem campo "confirmar senha" (D-9).
  - Recusa e sucesso conforme RN-10 e RN-11.

## 5. Critérios de aceitação

Formato Dado/Quando/Então.
- "Integração": Vitest contra PostgreSQL real, em `tests/integration/auth/recuperacao-senha.test.ts`, salvo indicação. E-mail pelo adaptador simulado (`email_log`) e relógio injetado.
- "Unidade": `src/**/*.test.ts(x)`.
- Correspondência com o PLAN: CA-1..CA-4 sustentam o critério 8. CA-13 e CA-14 sustentam o critério 11 (permissões e isolamento).

### Da issue, refinados

- **CA-1** (issue CA-1; RN-5, RN-6, RN-9): Dado um gestor confirmado com e-mail `ana@exemplo.com`, quando a recuperação é solicitada com `  ANA@Exemplo.com `, então:
  - a resposta é a mensagem uniforme da RN-7;
  - existe 1 `token` `recuperacao_senha` do usuário com `expira_em` = relógio + 1 h, e `usado_em` e `invalidado_em` nulos;
  - `email_log` tem 1 linha para `ana@exemplo.com`, com o assunto da RN-9, cujo `corpo` contém `APP_URL + '/redefinir-senha?token='` seguido de um token cujo SHA-256 é o `token_hash` gravado (e que difere dele);
  - nenhuma sessão é criada nem revogada e `senha_hash` não muda.

  O mesmo vale para um profissional ativo.
- **CA-2** (issue CA-2; RN-1, RN-7): Dado um e-mail não cadastrado, quando a recuperação é solicitada, então:
  - a resposta (mensagem, variante e estrutura do estado devolvido pela ação) é **idêntica** à do CA-1;
  - nenhuma linha nova aparece em `token` nem em `email_log`.

  O mesmo resultado vale para o e-mail de um super admin, de um profissional inativo e de um profissional sem perfil (RN-6).
- **CA-3** (issue CA-3; RN-3, RN-11): Dado o link do CA-1 e o usuário com 2 sessões abertas (criadas por `entrarDeVerdade` ou `iniciarSessao`), quando a nova senha `nova-senha-9` é definida, então:
  - o resultado é "Senha alterada";
  - `token.usado_em` = relógio;
  - `entrar` com `nova-senha-9` cria a sessão, e com a senha antiga devolve "E-mail ou senha incorretos.";
  - as 2 sessões anteriores têm `revogada_em` preenchido e `buscarSessaoValida`/`resolverTenant` as tratam como inexistentes (401);
  - o hash gravado é `$argon2id$` e `verificarSenha` o aceita para `nova-senha-9`.
- **CA-4** (issue CA-4; RN-2, RN-5, RN-10): o link é recusado, tanto na abertura (GET, sem gravar nada) quanto no envio do formulário (sem alterar `senha_hash` nem sessões), com a mensagem única da RN-10, quando:
  - **(a) usado**: o link do CA-3 é reaberto;
  - **(b) expirado**: o token foi emitido em T e é usado em T + 1 h e em T + 1 h + 1 s. Contraprova: em T + 1 h − 1 s ele é aceito;
  - **(c) substituído**: depois de uma segunda solicitação, o primeiro token tem `invalidado_em` preenchido e é recusado, enquanto o segundo funciona.

  Unidade: a função de validade decide os limites de expiração em milissegundos (T + 1 h − 1 ms válido, T + 1 h inválido).

### Complementares

- **CA-5** (RN-10; D-1): Dado um token válido, quando `/redefinir-senha?token=…` é aberto 3 vezes (GET), então o token continua válido (`usado_em` nulo), nenhuma linha é gravada e o formulário aparece nas 3 vezes. Integração da página/serviço.
- **CA-6** (RN-10): `/redefinir-senha` recusa, com a mensagem única, sem formulário e sem erro 500, cada um destes casos: token ausente, vazio, com 10 KB, fora de `FORMATO_TOKEN`, com formato válido mas sem registro, e token `confirmacao_email` válido de um gestor não confirmado. Os quatro primeiros não consultam o banco. Contraprova: um token `recuperacao_senha` aberto em `/confirmar-email` dá "Link de confirmação inválido." e não confirma nada. Integração e unidade.
- **CA-7** (RN-11, validação): Dado um token válido, quando é enviada uma senha de 7 caracteres, uma de 1025 ou o campo ausente ou de tipo errado no `FormData`, então:
  - a resposta traz a mensagem do campo;
  - `gerarHashSenha` não é chamado;
  - o token continua válido, o formulário devolvido mantém o token oculto e a senha volta vazia.

  Contraprova: uma senha de 8 espaços é aceita, porque a senha não é aparada. Unidade (validação) e integração (sem efeitos).
- **CA-8** (RN-6, RN-11; D-3): Dado um gestor **não confirmado**, com um token `confirmacao_email` pendente A, quando ele solicita a recuperação e redefine a senha pelo link, então:
  - `email_confirmado_em` = relógio e A tem `invalidado_em` preenchido;
  - o login com a nova senha cria a sessão e leva a `/painel`, em vez de "Confirme seu e-mail antes de entrar.".
- **CA-9** (RN-6, RN-10, RN-11): Dado um profissional ativo com um token válido, quando o gestor o desativa antes do uso (`ativo = false` na fábrica), então abrir o link e enviar a nova senha são recusados com a mensagem única, e `senha_hash` não muda. Contraprova: um profissional ativo redefine e entra.
- **CA-10** (RN-8): Dado um mesmo e-mail, quando 4 solicitações são feitas na mesma janela de 15 min, então:
  - as 3 primeiras recebem a mensagem uniforme e a 4ª recebe "Muitas solicitações. Aguarde alguns minutos e tente de novo.", sem token nem e-mail novos;
  - o comportamento é idêntico para e-mail existente e inexistente (só o existente elegível gera token e e-mail);
  - na janela seguinte (relógio injetado), o envio volta a funcionar;
  - a chave é `recuperacao-senha:` + SHA-256 e não afeta os contadores `login:` e `reenvio-confirmacao:` do mesmo e-mail;
  - um e-mail inválido (RN-4) não conta.
- **CA-11** (RN-12, concorrência): repetir 10 vezes sem falha intermitente.
  - (a) Dois envios do mesmo token válido em paralelo (`Promise.all`, senhas diferentes): exatamente 1 "Senha alterada" e 1 recusa; `usado_em` gravado uma vez; o `senha_hash` final corresponde à senha do vencedor.
  - (b) Uma solicitação nova em paralelo com a redefinição: ao final, há no máximo 1 token `recuperacao_senha` válido para o usuário, e o estado é um dos dois descritos na RN-12.
- **CA-12** (RN-9; D-15): Dado o adaptador de e-mail configurado para falhar (lança `ErroEnvioEmail`, ou `EMAIL_ADAPTER=real` sem SMTP), quando a recuperação é solicitada para um e-mail elegível, então:
  - a resposta é a mesma mensagem uniforme, sem aviso de falha;
  - o token fica gravado e o log registra `envio_falhou`;
  - uma nova solicitação com o adaptador normal invalida o anterior e envia o link.
- **CA-13** (RN-16; isolamento): Dado dois salões A e B, cada um com gestor e com sessões abertas, quando o gestor de A redefine a senha, então:
  - só as sessões do gestor de A são revogadas, e as do gestor de B e de um profissional de A continuam válidas;
  - o `senha_hash` dos demais usuários não muda;
  - um token emitido para o gestor de B não altera nenhum dado de A.

  Nenhuma ação aceita `salaoId` ou `usuarioId` vindos do formulário: campos extras no `FormData` são ignorados.
- **CA-14** (RN-6, perfis): Dado um super admin, quando a recuperação é solicitada com o e-mail dele, então nada é gravado nem enviado e a resposta é a uniforme. Dado um token `recuperacao_senha` inserido diretamente para um super admin (fábrica), então `/redefinir-senha` o recusa e o hash não muda.
- **CA-15** (RN-11; D-8): Dado um e-mail com 10 falhas de login na janela vigente (o login seguinte recebe "Muitas tentativas…"), quando a senha é redefinida pelo link, então o login com a nova senha, na mesma janela, cria a sessão.
- **CA-16** (RN-13; D-11; vale se o arquiteto adotar o mecanismo): Dado um login com a senha antiga cujo verificador, injetado, é atrasado até depois do commit de uma redefinição concorrente, então o login não resulta em sessão válida. Se o arquiteto não adotar o mecanismo, este CA é substituído pelo registro do risco residual no `design.md`.
- **CA-17** (RN-15): Dado as execuções dos CA-1, CA-2, CA-3, CA-4, CA-10 e CA-12 com o `log` capturado, então:
  - nenhuma linha contém a senha (antiga ou nova), o token em claro, o `token_hash`, o `senha_hash` nem o e-mail;
  - cada operação emite a linha `auth.recuperacao_senha` ou `auth.redefinicao_senha` da RN-15, e o CA-3 registra `sessoesRevogadas: 2`.
- **CA-18** (RN-14): a resposta de `GET /redefinir-senha` (com e sem token) e a da Server Action `POST` trazem `Referrer-Policy: strict-origin`. Nenhuma `meta name="referrer"` aparece.
  - Sub-requisições da página com token não levam o token no `Referer`.
  - `/recuperar-senha` não recebe esse cabeçalho (não há token na URL).
  - Integração (`next.config.ts` `headers()`) e, opcionalmente, E2E sem banco (D-13).
- **CA-19** (RN-18; sem JS e acessibilidade):
  - Testes de componente (jsdom):
    - `/recuperar-senha` e `/redefinir-senha` (estados formulário, recusa e sucesso) renderizam com `h1`, rótulos associados aos campos, erros ligados por `aria-describedby` e `Alert` com papel de anúncio;
    - o campo de senha tem `autoComplete="new-password"`, o token vai como `input type="hidden"` e a senha nunca vem preenchida.
  - E2E sem banco (D-13), em viewport 375×812:
    - navegação só por teclado em `/recuperar-senha` e `/redefinir-senha?token=<malformado>`, com axe zerado;
    - o envio **sem JavaScript** de `/recuperar-senha` com e-mail inválido devolve o erro do campo (sem 500);
    - `/redefinir-senha` sem JS com token malformado mostra a recusa;
    - o link "Esqueci minha senha" de `/entrar` leva a `/recuperar-senha` (200, não mais 404).
- **CA-20** (RN-17): Dado um gestor de salão com `suspenso_manual_em` preenchido, quando ele recupera e redefine a senha, então o fluxo funciona como no CA-1/CA-3. Integração.
- **CA-21** (gate): build, lint, typecheck, `npm test` e `npm run test:coverage` (≥ 90% de linhas) passando. O E2E pertinente passa. O README documenta o fluxo e como ler o link em `email_log` no modo simulado.

## 6. Casos limite

- **Fuso e virada de dia**: a validade de 1 h é calculada em instantes UTC (`expira_em`), independente do fuso do salão e do horário de verão. Os limites exatos estão nos CA-4(b). A janela do limite é fixa em UTC.
- **Expiração entre abrir e enviar**: o link é aberto em T + 59 min e o formulário é enviado em T + 61 min. O GET mostra o formulário, mas o POST recusa (a validade é rechecada no `UPDATE` condicional).
- **Concorrência**: duplo envio do mesmo token (CA-11a), solicitação × redefinição (CA-11b), login com a senha antiga × redefinição (RN-13, CA-16) e dupla solicitação em paralelo (o contador é atômico, D-010 CA-12; a trava do usuário garante um único token válido).
- **Isolamento entre salões**: RN-16 e CA-13. O e-mail é único na plataforma (`usuario.email UNIQUE`), então não há ambiguidade de salão.
- **Salão suspenso ou encerrado**: o fluxo é permitido (RN-17, CA-20).
- **Cliente anonimizada e telefone**: não se aplica, porque não há cliente nem telefone neste fluxo.
- **Permissões por perfil**:
  - gestor confirmado ou não: sim;
  - profissional ativo: sim;
  - profissional inativo ou sem perfil: não (resposta uniforme);
  - super admin: não (fora do escopo; resposta uniforme).
- **Usuário logado acessa `/recuperar-senha`**: a página continua acessível. Ao redefinir, a sessão em uso também é revogada (RN-3).
- **Usuário com convite pendente** (E1.4): um e-mail que só existe em `convite` não é usuário. Recebe a resposta uniforme e nada é enviado.
- **Scanner de e-mail que abre o link**: só GET, que não consome (D-1). O link continua utilizável.
- **Token de confirmação em `/redefinir-senha` e vice-versa**: são recusados (CA-6).
- **Entradas extremas**: e-mail com quebra de linha ou 10 KB e token com 10 KB são recusados pela validação, sem chegar ao banco nem à porta de e-mail (`validarMensagemEmail` também impede injeção de cabeçalho). Um nome de usuário com HTML vai em texto puro no e-mail.
- **Mesma senha que a anterior**: aceita (D-16).
- **Falha de banco no meio da transação**: nada muda, ou seja, o token não é consumido, o hash não muda e as sessões continuam. A tela mostra "Não foi possível redefinir a senha. Tente de novo.", sem detalhe técnico.
- **Token em claro em `email_log`**: aceito no modo simulado (D-007). O modo real não grava o corpo.

## 7. Dependências

- **Concluídas**:
  - E1.2/D-010: `senha.ts`, `sessao.ts` (`revogarSessoesDoUsuario`), `login.ts`, `rate_limit_janela` e `/entrar` com o link.
  - E1.1/D-011: padrão de token, reenvio, `FORMATO_TOKEN`, `esquemaEmail` e cabeçalho de referrer em `next.config.ts`.
  - E0.6/D-007: porta de e-mail, `registry.ts` e simulado com `email_log`.
  - E0.4/D-004: enum `recuperacao_senha` e tabela `token`.
  - E0.5/D-005: repositórios e harness.
  - E0.8/D-009: `ROTAS` e componentes.
- **Bloqueia**: E9.4 (#56).
- **Relacionadas**:
  - E1.4 (convite): o profissional só passa a existir pelo aceite. Até lá os testes usam fábricas.
  - E2.2 (desativação de profissional): o CA-9 usa a fábrica.
  - E6.4: não deve bloquear este fluxo (RN-17).
  - E1.5: o super admin fica fora.
- **Integrações**: só e-mail transacional (simulado nos testes; SMTP real já existe). Sem Mercado Pago, WhatsApp ou Turnstile.
- **Infraestrutura**: nenhuma variável nova. `APP_URL` precisa estar correta em produção, porque monta o link.

## 8. Impactos prováveis

- **Dados**: a princípio, **nenhuma migração**. O enum, a tabela `token` e os índices já existem (§1). Pontos para o arquiteto e, se ele julgar necessário, o DBA:
  - (a) novas funções de repositório pré-contexto: emitir ou substituir o token de recuperação, verificar o token por leitura, consumir e redefinir em transação (troca do hash, invalidações, confirmação do e-mail, revogação das sessões e, conforme D-8, o zeramento do contador de login), e buscar o alvo da recuperação com papel, confirmação e `profissional.ativo`;
  - (b) generalizar ou não `token-confirmacao.ts` por tipo (decisão do arquiteto);
  - (c) se o mecanismo da RN-13 exigir mudar `criarSessao` (`INSERT … SELECT … WHERE senha_hash = ?`);
  - (d) uma função para zerar ou apagar a janela em `rate-limit.ts` (D-8).

  O índice `(usuario_id, tipo)` basta para invalidar os pendentes.
- **Infraestrutura/CI**: nenhuma mudança esperada. Os testes novos entram nos jobs existentes e o E2E sem banco no job `e2e`. **DevOps**: provavelmente dispensável. `next.config.ts` muda (uma entrada a mais em `headers()`), o que é código da app, não infraestrutura.
- **Código existente alterado**:
  - `next.config.ts` (RN-14);
  - possivelmente `src/server/auth/login.ts` ou `src/server/repos/sessao.ts` (RN-13, D-11);
  - `src/server/repos/rate-limit.ts` (D-8);
  - README.
  - Opcional: extrair utilitários comuns de `confirmacao-email.ts` (esquema, formato do token, log, envio sem relançar).

## 9. Decisões tomadas (não bloqueantes), para o arquiteto confirmar

| ID | Decisão | Justificativa / alternativa |
|---|---|---|
| D-1 | O GET de `/redefinir-senha` **não consome** o token; o consumo acontece no POST da nova senha. | Ao contrário da confirmação (D-011 D-6), aqui é preciso um formulário. O GET idempotente também protege contra scanners e pré-carregamento. |
| D-2 | Elegíveis: gestor (confirmado ou não) e profissional ativo. Não elegíveis, com resposta uniforme: super admin, profissional inativo ou sem perfil e e-mail inexistente. | Issue ("gestor e profissional"; super admin fora). O profissional inativo não conseguiria entrar (D-010 RN-14). Se for reativado, pede de novo. |
| D-3 | Redefinir pelo link **confirma o e-mail** do gestor não confirmado e invalida os tokens de confirmação pendentes. | Pendência da D-011 (`design.md:488`, spec §6, "conta sequestrada"): o link prova o controle da caixa, a mesma prova da confirmação. Alternativa: não confirmar, e o gestor continuaria barrado no login após redefinir, o que seria confuso. |
| D-4 | **Recomendado:** a casca agenda o envio do e-mail para depois da resposta (`after()` de `next/server`, Next 16). O serviço devolve o envio pendente e a resposta não espera o SMTP. Se o arquiteto mantiver o envio síncrono (padrão D-011 D-3), deve registrar o risco residual de **canal de tempo** (enumeração pelo tempo de resposta), já observado pelo tester na D-011. | RN-1 trata do conteúdo da resposta. O tempo é um vazamento real com SMTP lento (até cerca de 30 s, D-007 R-11). Fila no worker é outra alternativa, mas o token em claro não pode ir no payload (`filas.ts`, só IDs), então o worker teria de emitir o token. |
| D-5 | Limite: 3 solicitações por e-mail por janela fixa de 15 min, chave `recuperacao-senha:` + SHA-256, contando também e-mails inexistentes. | Mesmo critério do reenvio da D-011 (D-4). Constantes no módulo, sem variável de ambiente nova. |
| D-6 | Uma **única** mensagem para todo link recusado (inválido, usado, expirado, substituído, inelegível), com link para pedir outro. | Quem tem o link não ganha nada com o detalhe, e a ação é sempre a mesma: pedir outro. O motivo fica no log e no retorno do serviço, para os testes. |
| D-7 | Sem login automático após redefinir; a tela leva a `/entrar`. | Um único ponto de criação de sessão (login, com rate limit), como na D-011 D-7. |
| D-8 | Redefinir zera o contador de falhas de login da janela vigente do e-mail. | Sem isso, quem se bloqueou com 10 tentativas, que é o cenário típico de quem esqueceu a senha, esperaria até 15 min mesmo depois de redefinir. Quem controla a caixa já poderia redefinir de todo jeito. Alternativa: não zerar (mais simples; o CA-15 sai). |
| D-9 | Sem campo "confirmar senha". | Mesmo critério do cadastro (D-011 D-12). Um erro de digitação se resolve com nova recuperação. Alternativa: adicionar o campo, só de UI e validação. |
| D-10 | Sem e-mail de aviso "sua senha foi alterada". | Não consta da issue nem do PLAN. Fica como pendência de segurança para uma demanda futura. |
| D-11 | Tratar a corrida login com senha antiga × redefinição (RN-13), condicionando a criação da sessão ao hash verificado. | Garante a RN-3 sem exceção. Se o custo for desproporcional, o arquiteto registra o risco residual (janela de milissegundos) e o CA-16 é dispensado. |
| D-12 | `Referrer-Policy: strict-origin` em `/redefinir-senha`, por cabeçalho HTTP em `next.config.ts`. | Lição da D-011 (DEF-1/DEF-2): a meta chega tarde e `no-referrer` quebra o POST sem JS. |
| D-13 | Sem E2E com banco. Há um E2E sem banco para renderização, teclado, axe, envio sem JS com erro de validação, recusa de token malformado e o link "Esqueci minha senha". | O job `e2e` não tem PostgreSQL (D-010 D-13). Pôr PostgreSQL nele seria impacto de DevOps, e o arquiteto decide. |
| D-14 | Sem limpeza de tokens vencidos. | Mesmo critério da D-011 D-10; pendência para a E9.x. |
| D-15 | A falha no envio não muda a resposta da solicitação. | O aviso de falha revelaria a existência do e-mail (RN-1). |
| D-16 | A nova senha pode ser igual à anterior; não há histórico de senhas. | Não consta do PLAN nem da issue. Só vale o mínimo de 8 caracteres (S15). |

### Dúvidas não bloqueantes (com suposição adotada)
- **Redação**: os textos das telas e do e-mail (RN-7..RN-11, RN-18) são provisórios, em pt-BR. O arquiteto ou o desenvolvedor podem ajustar a redação sem mudar o sentido. Os testes devem conferir os textos pelas constantes exportadas, não por cópia literal.
- **Mensagem após redefinir em `/entrar`**: não é exigida. A tela de sucesso de `/redefinir-senha` já orienta e traz o link.
