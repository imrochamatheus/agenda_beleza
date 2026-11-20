# D-011: cadastro de gestor e salão com confirmação de e-mail e slug gerado (issue #13, E1.1)

Autor: analista-requisitos. Fontes, da maior para a menor precedência:
1. `docs/demandas/D-011/issue-13.md`: RN-1..RN-6, CA-1..CA-6, casos limite e entregáveis, já decididos (não reabertos aqui).
2. `PLAN.md`: "Perfis e acesso" (`:15`, `:18`, `:20`, `:22`), "Assinatura" (`:61-63`, conta provisória), "Clientes e privacidade" (`:47-49`, captcha só na página pública), "Interface" (`:104`, `:113`), "Direção técnica" (`:119`, validação no servidor), "Fora da primeira versão" (`:131`) e os critérios de aceite 1 e 11 (`:135`, `:145`).
3. `CLAUDE.md`: invariantes (isolamento no servidor, integrações atrás de adaptadores), "Roles", "UI conventions", política de cobertura.
4. `docs/demandas/D-001/spec.md`: item E1.1 (`:426-458`), S9, S13, S15 e S17 (`:82-90`), E6.1 (`:1176-1200`, fronteira da assinatura).
5. `docs/demandas/D-010/spec.md` e `design.md` (login existente: RN-6, RN-7, RN-8, RN-22, CA-15; fronteira "o reenvio é da E1.1", `spec.md:51`, `:163`).
6. Código da branch `feat/d-011-cadastro-gestor` (a partir de `68ce771`, main).

As adições a esta especificação são: (a) RNs complementares que tornam a issue verificável (RN-7 em diante); (b) a regra nova e obrigatória dos slugs reservados (RN-9); (c) a integração com o login existente (RN-16); (d) decisões não bloqueantes D-n (§9), para o arquiteto confirmar.

## Dúvidas bloqueantes

Nenhuma. Todas as dúvidas encontradas têm um padrão razoável e foram resolvidas como decisões registradas no §9.

## 1. Problema

Hoje não é possível criar um salão nem um gestor pelo produto; a funcionalidade é inexistente. O login já recusa quem não confirmou o e-mail, mas não há como confirmar nem pedir o link.

- `ls "src/app/(publico)"` → só `entrar/`. Não existem `cadastro/` nem `confirmar-email/`. `ls src/server/auth` → não existem `cadastro.ts` nem `confirmacao-email.ts`. `ls src/lib` → não existe `slug.ts`.
- `src/config/navegacao.ts:12-13`: as rotas `ROTAS.cadastro = '/cadastro'` e `ROTAS.confirmarEmail = '/confirmar-email'` já estão declaradas. `src/app/(publico)/entrar/FormularioEntrar.tsx:58`: o link "Criar conta do salão" aponta para `/cadastro`, que hoje responde 404.
- `src/config/navegacao.ts:120-131`: `SEGMENTOS_RESERVADOS` (o primeiro segmento de cada rota, mais `api` e `_next`) foi criado "para E1.1/E2.5 recusarem slugs de salão que colidiriam com uma rota". Conjunto atual, fixado por `src/config/navegacao.test.ts:178-192`: `entrar`, `cadastro`, `confirmar-email`, `recuperar-senha`, `redefinir-senha`, `convite`, `termos`, `privacidade`, `painel`, `admin`, `dev`, `api`, `_next`.
- `src/server/auth/login.ts:19` e `:112-114`: com a senha correta e `email_confirmado_em` nulo, o login responde "Confirme seu e-mail antes de entrar." e não cria sessão (D-010 RN-7, CA-15). Não há opção de reenvio, que a D-010 deixou para a E1.1 (`docs/demandas/D-010/spec.md:51`, `:163`).
- Schema pronto, sem migração necessária a princípio (§8):
  - `prisma/schema.prisma`, `model Salao`: os defaults `fuso = 'America/Sao_Paulo'`, `grade_min = 15`, `antecedencia_min = 120`, `janela_dias = 60` e `intervalo_min = 0` já são os da RN-3.
  - `model SalaoSlug`: a PK `slug` dá unicidade global entre slugs atuais e históricos. `migration.sql:67-71` (em `20261118000200_restricoes_sql`): CHECK `^[a-z0-9]+(-[a-z0-9]+)*$` e um slug atual por salão.
  - `model Usuario`: `email` único, `email_confirmado_em`, `senha_hash`. `migration.sql:76-84`: e-mail minúsculo, `(papel = 'super_admin') = (salao_id IS NULL)` e um gestor por salão (`usuario_gestor_por_salao_uniq`).
  - `model Token`: `tipo = confirmacao_email`, `token_hash` único, `expira_em`, `usado_em` e `invalidado_em`.
  - `model RateLimitJanela`: contador por janela fixa, já usado pelo login.
- E-mail: a porta `src/server/integrations/email/port.ts` (`enviar({ para, assunto, texto, html? })`) é obtida só por `registry.ts`. O simulado (`simulado.ts`) grava destinatário, assunto e texto em `email_log`, fora da transação de quem chama. `docs/demandas/D-007/design.md:481` (R-11): "Hoje o e-mail é enviado de forma síncrona pela app (E1.x). Se a E1.x enfileirar, revisa."
- Fila: `src/server/queue/filas.ts:6-7` exige payload só com identificadores (UUID). Não há fila de e-mail.
- `src/server/env.ts:29`: `APP_URL` já existe (padrão `http://localhost:3000`).
- `src/server/tenant/politica.ts:16`: a política de operação ainda é `permitirTudo`. A E6.4 implementa os estados; um salão sem assinatura será tratado como `pendente` (D-001 S13).

## 2. Objetivo

Uma pessoa acessa `/cadastro`, informa o próprio nome, e-mail, senha e o nome do salão, e o sistema cria, de forma atômica, o salão (com os padrões de horário e um slug público derivado do nome) e o usuário gestor ainda não confirmado. Em seguida envia, pelo adaptador de e-mail, um link de confirmação válido por 24 h e de uso único. Ao abrir o link, o gestor fica confirmado e passa a conseguir entrar em `/entrar`. Quem perdeu o link ou o deixou expirar pode pedir outro, inclusive a partir do login recusado. Isso abre a primeira metade do critério de aceite 1 do PLAN ("dois salões conseguem se cadastrar").

## 3. Escopo

### Entra
1. Página `/cadastro` com formulário (nome do gestor, e-mail, senha, nome do salão), validação no servidor e tela de "verifique seu e-mail".
2. Serviço `src/server/auth/cadastro.ts`, que cria salão, slug atual, usuário gestor e token de confirmação numa única transação e envia o e-mail após o commit.
3. `src/lib/slug.ts`, com a geração do slug base (normalização, fallback e limite de tamanho) e a escolha do candidato livre (sufixo, segmentos reservados), mais testes unitários.
4. Serviço `src/server/auth/confirmacao-email.ts`: emitir o token (hash SHA-256, 24 h), consumir (uso único, concorrência segura), reenviar (invalida os anteriores, com rate limit por e-mail).
5. Página `/confirmar-email`, com os estados do link (confirmado, já utilizado, expirado ou substituído, inválido) e o formulário de reenvio.
6. Integração com o login (RN-16): o "e-mail não confirmado" passa a oferecer o reenvio.
7. Testes de unidade e integração (`tests/integration/auth/cadastro.test.ts`, CA-1..CA-6 e os CAs complementares).

### Fica fora
- **Assinatura (E6.1)**: nenhuma linha em `assinatura` é criada aqui; levar o gestor a "assinar" depois da confirmação é da E6.1 (`D-001/spec.md:1185`). O efeito da conta provisória sobre a página pública (S9, "agendamento indisponível") é da E4.1/E6.4.
- **Edição de slug e histórico (E2.5)** e **redirecionamento de slug antigo (E4.1)**.
- **Recuperação de senha (E1.3)**, **convite de profissional (E1.4)** e **super admin (E1.5)**.
- **Perfil de profissional do gestor**: o cadastro não cria `profissional` vinculado; o gestor que também atende cria o próprio perfil depois (E2.2). (D-9)
- **Turnstile e rate limit por IP no cadastro**: o PLAN exige captcha e limite por IP só na página pública de reservas (`PLAN.md:47-49`, critério 10). Nesta demanda há apenas o limite por e-mail no reenvio (RN-14). (D-5)
- **Limpeza de contas nunca confirmadas** e de tokens expirados (sem job; ver D-10).
- **Alterar e-mail** de uma conta não confirmada.
- **Login automático** após confirmar o e-mail (D-7).
- **E2E com banco**: o job `e2e` da CI não tem PostgreSQL (D-010 D-13). (D-11)
- Conferência com "Fora da primeira versão" (`PLAN.md:131`): nada aqui cria conta de cliente nem múltiplos gestores por salão (o índice `usuario_gestor_por_salao_uniq` continua garantindo um gestor por salão).

## 4. Regras de negócio

RN-1..RN-6 são da issue (decididas). RN-7 em diante as detalham ou complementam; a origem de cada uma está indicada.

- **RN-1** (issue; `PLAN.md:15`): e-mail único entre **todos** os usuários da plataforma (gestor, profissional e super admin; `usuario.email UNIQUE`). Um gestor por salão.
- **RN-2** (issue; `PLAN.md:22`): slug derivado do nome: minúsculas, sem acentos, espaços → hífen, apenas `[a-z0-9-]`; em colisão, sufixo numérico (`-2`, `-3`…). Detalhada em RN-8 e RN-9.
- **RN-3** (issue; `PLAN.md:35`, `:41`): o salão nasce com fuso `America/Sao_Paulo`, grade de 15 min, antecedência de 2 h (120 min), janela de 60 dias e intervalo de 0 min (os defaults do schema).
- **RN-4** (issue; S15): a senha é gravada com `src/server/auth/senha.ts` (argon2id, único módulo que conhece o algoritmo, D-010 RN-23); mínimo de 8 caracteres.
- **RN-5** (issue; S15, S17): gestor sem e-mail confirmado não entra. O link de confirmação expira em 24 h e é de uso único.
- **RN-6** (issue; `PLAN.md:119`): todos os campos são validados no servidor e as mensagens são em pt-BR. A validação no navegador (atributos HTML) é só conveniência.

- **RN-7 — Campos do cadastro** (RN-6; alinhada à D-010 RN-6):
  - **Nome do gestor**: aparado (`trim`), espaços internos repetidos colapsados; de 2 a 100 caracteres; sem caracteres de controle. Mensagem: "Informe seu nome (de 2 a 100 caracteres)."
  - **E-mail**: aparado e convertido para minúsculas antes de qualquer uso (o CHECK `usuario_email_minusculo_chk` exige); formato de e-mail; até 254 caracteres. É o mesmo esquema do login (`login.ts:47`). Mensagem: "Informe um e-mail válido."
  - **Senha**: não é aparada nem normalizada (igual ao login); de 8 a 1024 caracteres, contados como `string.length` do JavaScript. O teto é o mesmo do login (`login.ts:49`), para que toda senha aceita no cadastro também seja aceita no login. Mensagem: "A senha precisa ter pelo menos 8 caracteres." (ou "no máximo 1024").
  - **Nome do salão**: aparado e com espaços colapsados; de 2 a 80 caracteres; sem caracteres de controle. Qualquer outro caractere é aceito, inclusive um nome feito só de símbolos (o slug cai no fallback, RN-8). Mensagem: "Informe o nome do salão (de 2 a 80 caracteres)."
  - Todos os erros de campo são devolvidos juntos, sem consultar o banco e sem calcular o hash. O formulário devolvido mantém nome, e-mail e nome do salão; a senha volta sempre vazia.

- **RN-8 — Slug base** (RN-2; CHECK `salao_slug_formato_chk`): função pura em `src/lib/slug.ts`:
  1. normaliza para NFD e remove as marcas diacríticas (`á→a`, `ç→c`, `ã→a`);
  2. converte para minúsculas;
  3. troca cada sequência de caracteres fora de `[a-z0-9]` por um único hífen (espaços, pontuação, `&`, apóstrofos, emojis e letras sem decomposição ASCII, como `ß` e `ø`);
  4. remove os hífens das pontas;
  5. limita o resultado a 50 caracteres, cortando no último hífen anterior ao limite quando houver um, e remove o hífen final;
  6. se o resultado ficar vazio, usa o fallback `salao`.

  O resultado sempre satisfaz `^[a-z0-9]+(-[a-z0-9]+)*$`. Exemplos: "Studio Bela" → `studio-bela`; "Espaço Ágata & Cia." → `espaco-agata-cia`; "  D'Ávila  Beauty " → `d-avila-beauty`; "!!! ★★★" → `salao`.

- **RN-9 — Slugs reservados (regra nova, obrigatória)** (`src/config/navegacao.ts:116-131`; memória do projeto "E1.1/E2.5 devem recusar slugs de SEGMENTOS_RESERVADOS"): o slug **gravado** nunca pertence a `SEGMENTOS_RESERVADOS`. Um candidato reservado é tratado como **colisão**: o algoritmo passa para o próximo sufixo. Assim, "Painel" → `painel-2`, "Admin" → `admin-2`, "Entrar" → `entrar-2`, "API" → `api-2`, "Confirmar Email" → `confirmar-email-2` (com hífen, "Confirmar E-mail" gera `confirmar-e-mail` pela RN-8, que não é reservado; correção do líder após a implementação). A verificação usa o conjunto exportado (fonte única), sem cópia da lista. Assim, uma rota nova incluída em `ROTAS` passa a valer automaticamente para os cadastros seguintes. O efeito sobre slugs já gravados antes dessa inclusão é da E2.5/E4.1.

- **RN-10 — Escolha do slug livre** (RN-2): os candidatos são, em ordem, `base`, `base-2`, `base-3`, … O escolhido é o primeiro que não é reservado (RN-9) e não existe em `salao_slug` (atual **ou** histórico de qualquer salão; a PK é global). O sufixo é acrescentado ao slug base já limitado a 50 caracteres (RN-8), então o slug final tem no máximo 50 + 1 + dígitos. Uma base que já termina em número não é tratada de forma especial: "Studio Bela 2" gera `studio-bela-2`, e, se esse já existir, `studio-bela-2-2`.

- **RN-11 — Atomicidade e concorrência do cadastro** (issue, caso limite "duplo envio"): salão, `salao_slug` (`atual = true`), usuário gestor (`email_confirmado_em` nulo) e token de confirmação são gravados numa **única transação**. O hash da senha é calculado antes dela, para não segurar a transação durante o argon2. Se uma etapa falhar, nada é gravado.
  - **Mesmo e-mail em paralelo** (duplo clique, duas abas): exatamente um cadastro é efetivado. O outro termina na recusa do CA-3 ("e-mail já cadastrado"), detectada pela violação de `usuario.email UNIQUE` ou por verificação prévia, sem erro 500 e sem salão órfão.
  - **Mesmo nome de salão em paralelo** (e-mails diferentes): os dois cadastros são efetivados, com slugs distintos (`x` e `x-2`). A violação da PK de `salao_slug` provoca nova tentativa com o próximo candidato (até 5 tentativas; depois, a mensagem genérica de RN-17). Nenhum dos dois recebe erro.

- **RN-12 — Token de confirmação** (issue; S15; mesmo padrão da sessão da D-010):
  - Valor aleatório de pelo menos 32 bytes (CSPRNG), em base64url. Em `token.token_hash` vai só o SHA-256; o valor em claro existe apenas no link enviado.
  - `tipo = 'confirmacao_email'`, `expira_em` = emissão + 24 h, calculado com o relógio do servidor (injetável nos testes) e gravado em UTC.
  - O token é válido se e somente se `usado_em IS NULL`, `invalidado_em IS NULL` e `agora < expira_em`. Exatamente 24 h após a emissão ele já está expirado.
  - O link é `APP_URL + '/confirmar-email?token=' + token`, montado com `APP_URL` (`env.ts:29`), **nunca** com o cabeçalho `Host` da requisição (evita injeção de host no link).

- **RN-13 — Consumo do link** (issue RN-5; CA-4, CA-5): abrir `/confirmar-email?token=…` consome o token (D-6) com uma atualização **condicional e atômica** (`UPDATE … WHERE token_hash = ? AND usado_em IS NULL AND invalidado_em IS NULL AND expira_em > agora`). Na mesma transação, preenche `usuario.email_confirmado_em` (se ainda estiver nulo) e invalida (`invalidado_em = agora`) os demais tokens `confirmacao_email` pendentes do usuário. Resultados e telas:
  - **confirmado**: "E-mail confirmado. Agora você já pode entrar." e um botão/link para `/entrar`;
  - **já utilizado** (`usado_em` preenchido): "Este link já foi utilizado." Como o e-mail desse usuário já está confirmado, a tela também diz que a pessoa pode entrar e mostra o link para `/entrar`. Não oferece reenvio;
  - **expirado ou substituído** (`expira_em <= agora` ou `invalidado_em` preenchido, sem `usado_em`): "Este link expirou ou foi substituído por um mais recente." e o reenvio (RN-14);
  - **inválido** (token ausente, malformado ou sem registro): "Link de confirmação inválido." e o reenvio por e-mail (RN-14).

  Duas aberturas simultâneas do mesmo link válido: exatamente uma confirma, e a outra vê "já utilizado". O token em claro nunca vai para log nem para mensagem de erro (D-010 RN-22). A página que recebe o token não carrega recursos de terceiros e não deixa o token vazar por `Referer` (`Referrer-Policy: no-referrer`, ou redirecionamento para uma URL sem o token depois do consumo; o arquiteto escolhe).

- **RN-14 — Reenvio do link** (issue, escopo "reenvio"; S17; CA-5, CA-6):
  - Um único serviço, `reenviarConfirmacao`, recebe um **e-mail** (formulário de reenvio e botão do login) ou um **token** (botão da tela de link expirado ou substituído; o usuário é identificado pelo `token_hash`, mesmo que o token esteja expirado ou invalidado).
  - Se o usuário existir, for gestor (D-8) e ainda não tiver confirmado o e-mail: invalida os tokens `confirmacao_email` pendentes dele, emite um novo (RN-12) e envia o e-mail. Em qualquer outro caso (e-mail inexistente, já confirmado, outro papel), não envia nada.
  - **Resposta uniforme**: em todos os casos acima a tela mostra a mesma mensagem: "Se houver um cadastro aguardando confirmação para este e-mail, enviamos um novo link. Ele vale por 24 horas." Isso não revela se o e-mail existe (alinhado à D-010 RN-2).
  - **Limite**: no máximo 3 pedidos de reenvio por e-mail normalizado numa janela fixa de 15 min (UTC), contados em `rate_limit_janela` com a chave `reenvio-confirmacao:` + SHA-256 do e-mail. Contam todos os pedidos, exista o e-mail ou não. O 4º pedido da janela não envia e recebe "Muitas solicitações. Aguarde alguns minutos e tente de novo." Como o limite vale para qualquer e-mail, essa mensagem também não revela existência. No reenvio por token, a chave é a do e-mail do usuário dono do token. (D-4)
  - O e-mail do cadastro inicial não consome a cota de reenvio.

- **RN-15 — Envio do e-mail** (CLAUDE.md, integrações atrás de adaptadores; D-007 R-11): o e-mail é enviado pela porta obtida em `registry.ts`, de forma **síncrona e somente depois do commit** (D-3). Conteúdo mínimo: assunto "Confirme seu e-mail no Agenda Beleza" e um texto em pt-BR com o nome do gestor, o nome do salão, o link (RN-12) e a validade de 24 horas. A falha no envio (`ErroEnvioEmail` ou `ErroValidacaoEmail`) **não desfaz** o cadastro nem o reenvio já gravados. No cadastro, a tela de sucesso continua e informa: "Não conseguimos enviar o e-mail agora. Use 'Reenviar link' em alguns minutos." A falha é registrada em log sem e-mail nem token.

- **RN-16 — Integração com o login** (S17; CA-6; D-010 RN-7, RN-8, CA-15): a ordem e as mensagens do login não mudam. A mensagem genérica "E-mail ou senha incorretos." continua idêntica para e-mail inexistente, senha errada e super admin, e a resposta **sem** senha correta nunca oferece reenvio. Só no caso em que a senha confere e `email_confirmado_em` é nulo (hoje `login.ts:112-114`), o resultado passa a indicar que o reenvio pode ser oferecido. A tela de `/entrar` mostra então, junto de "Confirme seu e-mail antes de entrar.", um botão "Reenviar link de confirmação" que envia o e-mail digitado ao serviço da RN-14 (resposta uniforme e limite próprios). O rate limit de login (10 falhas/15 min) não muda: o caso "não confirmado" continua contando como falha (só o sucesso devolve a reserva; `login.ts:117`). Assim, o reenvio só aparece para quem provou a senha, e o próprio serviço de reenvio não revela nada a quem o chama diretamente.

- **RN-17 — Mensagens do cadastro** (RN-6; CA-3):
  - e-mail já cadastrado (qualquer papel, confirmado ou não): "Este e-mail já está cadastrado. Entre ou, se ainda não confirmou o e-mail, peça um novo link." com links para `/entrar` e para o reenvio. Revelar a existência do e-mail neste ponto é exigência da issue (CA-3; D-2);
  - falha inesperada (incluindo as 5 tentativas de slug esgotadas): "Não foi possível concluir o cadastro. Tente de novo." Nada é gravado, e o detalhe técnico fica só no log.

- **RN-18 — Sessão e acesso** (D-010): o cadastro não cria sessão nem cookie, e a confirmação também não (D-7). O gestor confirmado entra por `/entrar` e cai em `/painel`, que mostra o próprio salão (o isolamento é o já garantido por `resolverTenant`/repositórios da D-005). As páginas `/cadastro` e `/confirmar-email` são públicas, ficam fora de `/painel/**` (o proxy não interfere) e não dependem de sessão.

- **RN-19 — Sigilo e logs** (D-010 RN-22): senha, token em claro, hashes e e-mail em claro nunca aparecem em log, em URL (exceto o token no link de confirmação, por necessidade), em mensagem de erro ou em payload de fila. Cada operação gera uma linha JSON de log, sem dados pessoais: `{ evento: 'auth.cadastro' | 'auth.confirmacao_email' | 'auth.reenvio_confirmacao', resultado, salaoId?, usuarioId?, em }`. O adaptador simulado grava o texto do e-mail (com o link) em `email_log` por desenho da D-007 (D-8): isso só ocorre em modo simulado, local ou de teste.

- **RN-20 — UI** (CLAUDE.md, "UI conventions"; D-009): pt-BR; componentes de `src/components/ui/` (`Field`, `Button`, `Alert`) com os mesmos padrões de `/entrar`: ação de servidor com `useActionState`, funcionando sem JS, erro por campo associado ao input, `Alert` anunciado e botão com estado ocupado durante o envio (reduz o duplo envio, sem substituir a RN-11). O formulário é operável só pelo teclado, sem violações axe e sem cor literal fora dos tokens. Campos: "Seu nome" (`autoComplete="name"`), "E-mail" (`type="email"`, `autoComplete="email"`), "Senha" (`type="password"`, `autoComplete="new-password"`, com dica "Mínimo de 8 caracteres"), "Nome do salão" (`autoComplete="organization"`). A página tem link para `/entrar` ("Já tenho conta"). Caminhos só via `ROTAS` (D-009 RN-15).

## 5. Critérios de aceitação

Formato Dado/Quando/Então. "Integração" = Vitest contra PostgreSQL real (`tests/integration/auth/cadastro.test.ts`, salvo indicação); "Unidade" = `src/**/*.test.ts`. Correspondência com o PLAN: CA-1, CA-2, CA-7, CA-8 e CA-18 sustentam o critério 1 ("dois salões conseguem se cadastrar…"); CA-6, CA-16 e CA-18 sustentam o critério 11 (testes de permissões e de isolamento).

### Da issue, refinados

- **CA-1** (issue CA-1; RN-1, RN-3, RN-4, RN-11, RN-12, RN-15): Dado um banco sem o e-mail `ana@exemplo.com`, quando o cadastro é enviado com nome "Ana Souza", e-mail `ana@exemplo.com`, senha `senha-forte-1` e salão "Studio Bela", então, numa única execução:
  - existe 1 `salao` com nome "Studio Bela", `fuso = 'America/Sao_Paulo'`, `grade_min = 15`, `antecedencia_min = 120`, `janela_dias = 60`, `intervalo_min = 0` e `suspenso_manual_em` nulo;
  - existe 1 `salao_slug` com `slug = 'studio-bela'`, `atual = true`, ligado a esse salão;
  - existe 1 `usuario` com `papel = 'gestor'`, `salao_id` desse salão, `email = 'ana@exemplo.com'`, `email_confirmado_em` nulo e `senha_hash` no formato `$argon2id$` que `verificarSenha` aceita para `senha-forte-1`;
  - existe 1 `token` `confirmacao_email` do usuário, com `expira_em` = relógio injetado + 24 h, `usado_em` e `invalidado_em` nulos, e `token_hash` diferente do valor do link;
  - nenhuma linha em `assinatura`, `profissional` ou `sessao` foi criada para esse salão ou usuário;
  - `email_log` tem 1 linha para `ana@exemplo.com`, cujo `corpo` contém `APP_URL + '/confirmar-email?token='` seguido de um token cujo SHA-256 é o `token_hash` gravado.
- **CA-2** (issue CA-2; RN-10): Dado um salão "Studio Bela" com slug `studio-bela`, quando outro salão "Studio Bela" é cadastrado (outro e-mail), então o slug do novo é `studio-bela-2`; e um terceiro "Studio Bela" recebe `studio-bela-3`. Também: dado `studio-bela` existente **apenas como slug histórico** (`atual = false`) de outro salão, o novo recebe `studio-bela-2`. Integração.
- **CA-3** (issue CA-3; RN-1, RN-17): Dado um usuário com e-mail `ana@exemplo.com` (casos: gestor confirmado, gestor não confirmado e profissional), quando o cadastro é enviado com `ANA@Exemplo.com ` e qualquer nome de salão, então a resposta é a recusa da RN-17, associada ao campo e-mail, e o número de linhas em `salao`, `salao_slug`, `usuario`, `token` e `email_log` não muda. Integração.
- **CA-4** (issue CA-4; RN-13): Dado o link do CA-1, quando ele é aberto, então o resultado é "confirmado", `usuario.email_confirmado_em` fica preenchido com o relógio injetado e `token.usado_em` também. Quando o mesmo link é aberto de novo, então o resultado é "já utilizado", `email_confirmado_em` não muda e nenhum e-mail é enviado. Integração (serviço) e unidade/integração da página (os textos da RN-13 por resultado).
- **CA-5** (issue CA-5; RN-12, RN-13, RN-14): Dado um token emitido no instante T, quando o link é aberto em T + 24 h (e também em T + 24 h + 1 s), então o resultado é "expirado ou substituído", `email_confirmado_em` continua nulo, a tela oferece o botão de reenvio, e acioná-lo grava 1 novo token (o antigo fica com `invalidado_em` preenchido) e 1 novo e-mail com um link que, aberto em seguida, confirma. Contraprova: aberto em T + 24 h − 1 s, ele confirma. Integração com relógio injetado.
- **CA-6** (issue CA-6; RN-16): Dado um gestor não confirmado criado pelo cadastro, quando ele tenta entrar com a senha correta, então nenhuma sessão é criada, nenhum cookie é emitido, a mensagem é "Confirme seu e-mail antes de entrar." e o resultado indica que o reenvio pode ser oferecido. Na tela, aparece o botão "Reenviar link de confirmação", e acioná-lo grava um novo token e um novo e-mail. Contraprova: com senha errada, o resultado é idêntico ao de e-mail inexistente ("E-mail ou senha incorretos."), sem indicação de reenvio. Depois de confirmar (CA-4), o login com a senha correta cria a sessão e leva a `/painel`. Integração (serviço de login e ação de reenvio) e unidade do formulário (o botão só aparece no caso não confirmado).

### Complementares

- **CA-7** (RN-9; regra nova): Dado o cadastro de salões chamados "Painel", "Admin", "Entrar", "API", "Cadastro" e "Confirmar Email", então os slugs gravados são `painel-2`, `admin-2`, `entrar-2`, `api-2`, `cadastro-2` e `confirmar-email-2`. Unidade: para **todo** item de `SEGMENTOS_RESERVADOS` que satisfaça o formato de slug, a escolha com nenhum slug ocupado devolve `<item>-2`, e nenhuma escolha devolve um item do conjunto. Integração: ao menos "Painel" → `painel-2` gravado.
- **CA-8** (RN-8, caso limite "nome só com caracteres especiais"): Unidade de `slug.ts`. "Studio Bela" → `studio-bela`; "Espaço Ágata & Cia." → `espaco-agata-cia`; "  D'Ávila  Beauty " → `d-avila-beauty`; "SALÃO--Ç" → `salao-c`; "!!! ★★★" → `salao`; "ßø" → `salao`; um nome de 80 caracteres → no máximo 50 caracteres, sem hífen final. Toda saída satisfaz `^[a-z0-9]+(-[a-z0-9]+)*$`. Integração: dois cadastros "!!!" e "@@" → `salao` e `salao-2`.
- **CA-9** (RN-7, caso limite "e-mail com maiúsculas"): Dado o cadastro com e-mail `  Ana.Souza@Exemplo.COM `, então `usuario.email = 'ana.souza@exemplo.com'`, o e-mail vai para o endereço minúsculo, e o login com `ANA.SOUZA@exemplo.com` (após a confirmação) funciona. Integração.
- **CA-10** (RN-7, RN-6): Dado cada entrada inválida (nome do gestor vazio, com 1 caractere ou com 101; e-mail sem `@` ou com 255 caracteres; senha com 7 caracteres ou com 1025; nome do salão vazio, só espaços ou com 81 caracteres; campos ausentes ou de tipo errado no `FormData`), quando o cadastro é enviado, então a resposta traz a mensagem pt-BR do campo, nada é gravado, `hashSenha` não é chamado e nenhum e-mail é enviado. Contraprova: uma senha de 8 espaços é aceita, porque a senha não é aparada. Unidade (validação) e integração (sem efeitos).
- **CA-11** (RN-11, caso limite "duplo envio"): Dado o mesmo formulário válido enviado 2 vezes em paralelo (`Promise.all`), então existe exatamente 1 salão, 1 gestor, 1 token e 1 e-mail para aquele endereço. Uma resposta é sucesso e a outra é a recusa do CA-3, sem exceção não tratada. Repetir 10 vezes sem falha intermitente. Integração.
- **CA-12** (RN-10, RN-11): Dado 2 cadastros em paralelo com e-mails diferentes e o mesmo nome "Studio Bela", então ambos são efetivados, com slugs `{studio-bela, studio-bela-2}`. Repetir 10 vezes. Integração.
- **CA-13** (RN-11): Dado uma falha forçada depois de inserir o salão e antes do commit (por exemplo, um gestor já existente para o salão ou um erro injetado pelo teste), então não restam `salao`, `salao_slug`, `usuario` nem `token` do cadastro, e nenhum e-mail é enviado. Integração.
- **CA-14** (RN-13): Dado o mesmo link válido aberto 2 vezes em paralelo, então exatamente um resultado é "confirmado" e o outro é "já utilizado"; `usado_em` é gravado uma vez. Dado um token de **outro tipo** (`recuperacao_senha`) usado em `/confirmar-email`, então o resultado é "inválido". Dado `token` ausente, vazio ou com 10 KB, então o resultado é "inválido", sem consulta custosa nem erro 500. Integração.
- **CA-15** (RN-14): Dado um gestor não confirmado com token pendente A, quando pede reenvio por e-mail, então A recebe `invalidado_em`, existe um token B válido e 1 novo e-mail; abrir A dá "expirado ou substituído" e abrir B confirma. Depois da confirmação, um novo pedido de reenvio responde com a mesma mensagem uniforme e não grava token nem e-mail. Para um e-mail inexistente e para o e-mail de um profissional, a mensagem é idêntica e nada é gravado. Integração.
- **CA-16** (RN-14, limite): Dado um mesmo e-mail (existente ou não), quando são feitos 4 pedidos de reenvio na mesma janela de 15 min, então os 3 primeiros recebem a mensagem uniforme (com envio só para o existente não confirmado) e o 4º recebe "Muitas solicitações. Aguarde alguns minutos e tente de novo.", sem novo token nem e-mail. Na janela seguinte (relógio injetado), volta a enviar. Integração.
- **CA-17** (RN-15): Dado o adaptador de e-mail configurado para falhar (adaptador de teste que lança `ErroEnvioEmail`), quando o cadastro válido é enviado, então salão, gestor e token ficam gravados, a resposta é sucesso com o aviso da RN-15 e um reenvio posterior com o adaptador normal envia o link. Integração.
- **CA-18** (RN-18; isolamento, PLAN critério 1): Dado dois salões A e B cadastrados e confirmados por este fluxo, quando o gestor de B entra, então `/painel` mostra o nome do salão B, e um `TenantContext` do gestor B não lê nem altera dados de A (reaproveitando um teste existente de isolamento da D-005 com usuários criados pelo cadastro). Integração.
- **CA-19** (RN-19): Dado as execuções dos CA-1, CA-4, CA-5, CA-15 e CA-17 com o `log` capturado, então nenhuma linha de log contém a senha, o token em claro, o `token_hash`, o `senha_hash` nem o e-mail; cada operação emite a linha `auth.*` da RN-19. Unidade/integração.
- **CA-20** (RN-20): `/cadastro` e `/confirmar-email` (estado de reenvio) renderizam com `h1`, rótulos associados aos campos, erros ligados por `aria-describedby`, `Alert` com papel de anúncio, e o formulário funciona com `<form action>` sem JS. Teste de componente (jsdom). Se o arquiteto incluir E2E sem banco (D-11), ele usa navegação só por teclado e axe com zero violações.
- **CA-21** (gate): build, lint, typecheck, `npm test` e `npm run test:coverage` (≥ 90% de linhas) passando; o README documenta o fluxo de cadastro e confirmação, inclusive como ler o link em `email_log` no modo simulado.

## 6. Casos limite

- **Fuso e virada de dia**: a validade de 24 h é calculada em instantes UTC (`expira_em`), sem depender do fuso do salão nem do horário de verão. O limite exato é testado (CA-5). A janela do rate limit de reenvio é fixa em UTC (como no login).
- **Concorrência**: duplo envio com o mesmo e-mail (CA-11), mesmo nome de salão (CA-12), dupla abertura do link (CA-14) e reenvio concorrente com o consumo. Se o consumo de A e o reenvio que invalida A correrem juntos, vale o primeiro a gravar. Se A for consumido primeiro, o reenvio vê o usuário confirmado e não envia. Se o reenvio vier primeiro, A fica "substituído". Nenhuma combinação deixa o usuário confirmado com um token pendente utilizável nem gera dois tokens válidos.
- **Isolamento entre salões**: o cadastro e a confirmação são pré-autenticação e operam sobre tabelas globais (`usuario`, `token`, `salao_slug`) por funções de repositório pré-contexto, documentadas como exceção, como `buscarUsuarioParaLogin` (`src/server/repos/usuario.ts:7-10`). Nenhuma entrada do formulário permite escolher o `salao_id`. Depois do login vale o isolamento já existente (CA-18).
- **Salão suspenso**: não se aplica. O salão recém-criado não tem assinatura (conta provisória, S9), e a política ainda é `permitirTudo` (`politica.ts:16`); a E6.4 trata os estados.
- **Cliente anonimizada / telefone**: não se aplica (não há cliente nem telefone neste fluxo).
- **Permissões por perfil**: o cadastro só cria `gestor`. Não é possível criar `profissional` nem `super_admin` por ele (o papel não vem do formulário). O reenvio só emite token para gestor (D-8). Um e-mail de super admin no cadastro recebe a recusa do CA-3 (consequência aceita da RN-1; D-2).
- **E-mail de convite pendente**: um endereço que só existe em `convite.email` (sem `usuario`) pode se cadastrar como gestor. Esse conflito é da E1.4 (ao aceitar, o e-mail já existiria em `usuario`). Fica registrado para a E1.4.
- **Conta "sequestrada"**: alguém cadastra o e-mail de outra pessoa. O dono do e-mail não consegue se cadastrar (CA-3), mas pode pedir o link (RN-14). Confirmar não lhe dá a senha, e a saída é a recuperação de senha (E1.3). Registrado como dependência: a E1.3 deve aceitar usuário não confirmado e, ao redefinir pelo link do e-mail, pode marcar o e-mail como confirmado. Decisão da E1.3, não desta demanda.
- **Usuário com sessão aberta acessa `/cadastro`**: a página continua acessível e o cadastro segue as mesmas regras (o e-mail próprio cai no CA-3). Nenhuma sessão é alterada.
- **Entradas extremas**: campos com 10 KB, caracteres de controle, `\u0000` e quebras de linha no nome são recusados pela RN-7 sem chegar ao banco. O e-mail com quebra de linha também é recusado (o esquema de e-mail e a porta, `port.ts`, `validarMensagemEmail`, impedem injeção de cabeçalho). O nome do salão com HTML (`<b>x</b>`) é aceito como texto e escapado na renderização (React). No e-mail, só vai em texto puro (o `html` é opcional e, se usado, precisa ser escapado).
- **Rotas novas no futuro**: um salão já gravado com um slug que depois vire rota fica fora do alcance desta demanda (E2.5/E4.1). A RN-9 garante só os cadastros feitos com o conjunto vigente.
- **Token em claro no `email_log`** (modo simulado): aceito por desenho da D-007; o modo `real` não grava o corpo.

## 7. Dependências

- **Concluídas**: E1.2/D-010 (`senha.ts`, `login.ts`, `/entrar`, `rate_limit_janela`), E0.6/D-007 (porta de e-mail, `registry.ts`, simulado com `email_log`), E0.4/D-004 (schema e restrições), E0.5/D-005 (repositórios e harness de integração com fábricas), E0.8/D-009 (`ROTAS`, `SEGMENTOS_RESERVADOS`, componentes de UI).
- **Bloqueia**: E6.1 (#46), que parte de "gestor confirmado sem assinatura".
- **Relacionadas**: E1.3 (recuperação e conta não confirmada; ver §6), E1.4 (conflito com e-mail de convite), E2.5/E4.1 (slugs), E6.4 (conta provisória), E9.2 (o seed pode reutilizar `cadastro.ts` ou criar direto; decisão da E9.2).
- **Integrações**: só e-mail transacional (simulado nos testes; real SMTP já existente). Sem Mercado Pago, WhatsApp ou Turnstile.
- **Infraestrutura**: nenhuma variável de ambiente nova obrigatória; `APP_URL` já existe e deve estar correta em produção, porque monta o link.

## 8. Impactos prováveis

- **Dados**: a princípio, **nenhuma migração**: todas as colunas, enums, CHECKs e índices necessários existem (§1). Pontos para o arquiteto e, se julgar necessário, o DBA avaliarem: (a) a nova tentativa em caso de violação da PK de `salao_slug` dentro da transação (savepoint ou nova tentativa da transação inteira); (b) a busca pelo primeiro sufixo livre (`slug = base OR slug LIKE base || '-%'`; o `LIKE` precisa escapar `_`/`%`, que de todo modo não ocorrem no slug); (c) se convém um índice em `token (usuario_id, tipo) WHERE usado_em IS NULL AND invalidado_em IS NULL`. O índice `(usuario_id, tipo)` existente basta para o volume esperado. Novas funções de repositório pré-contexto em `src/server/repos/` (criar salão + gestor + token; consumir e invalidar token; buscar o usuário para reenvio), já que só os repositórios importam o Prisma.
- **Infraestrutura/CI**: nenhuma mudança esperada. Testes novos entram nos jobs `testes` existentes. Um E2E do cadastro com banco não cabe no job `e2e` atual (sem PostgreSQL); ver D-11. **DevOps**: provavelmente dispensável.
- **Código existente alterado**: `src/server/auth/login.ts` (indicar "reenvio disponível" no caso não confirmado), `src/app/(publico)/entrar/` (estado e botão de reenvio) e o README.

## 9. Decisões tomadas (não bloqueantes), para o arquiteto confirmar

| ID | Decisão | Justificativa / alternativa |
|---|---|---|
| D-1 | Slug reservado = colisão; começa em `-2` (RN-9). | Pedido explícito da transferência; coerente com a RN-2 da issue. Alternativa descartada: recusar o cadastro (o nome do salão é livre; o slug é derivado). |
| D-2 | O cadastro revela que o e-mail existe (CA-3 da issue); o reenvio, não (resposta uniforme). | A issue manda recusar com mensagem. Mitigar a enumeração no cadastro exigiria "verifique seu e-mail" sempre, contrariando o CA-3. O login continua sem revelar (D-010 RN-2). |
| D-3 | E-mail **síncrono após o commit**, sem fila. | A D-007 (R-11) já assume envio síncrono pela app na E1.x. A fila exige payload só com IDs (`filas.ts:6-7`), e o token em claro não é persistido, então o worker teria de gerar o token, mudando o desenho. A falha no envio não desfaz o cadastro (RN-15), e o reenvio cobre a recuperação. Alternativa: fila `email-confirmacao` com payload `{ usuarioId }`, em que o worker emite o token e envia. Fica mais robusta a SMTP lento (até ~30 s, R-11), mas exige um contrato novo e a revisão da R-11. |
| D-4 | Reenvio: 3 por e-mail por janela fixa de 15 min, em `rate_limit_janela`. | Impede bombardear uma caixa de terceiros; reutiliza o mecanismo do login. Os valores são constantes do módulo (não há env nova). |
| D-5 | Sem Turnstile e sem rate limit por IP no cadastro. | O PLAN exige captcha e limite por IP só na página pública (`PLAN.md:47-49`, critério 10). O cadastro envia no máximo um e-mail por endereço novo (o e-mail é único), e o reenvio tem limite. Risco residual: criação em massa de contas com e-mails distintos. Recomenda-se reavaliar quando a E4.2 entregar o limite por IP (`TRUSTED_PROXY_HOPS`, S7). |
| D-6 | O link é consumido ao **abrir** (GET), como pede o CA-4. | Se um scanner de e-mail abrir o link antes, a pessoa vê "já utilizado", mas com a informação de que o e-mail está confirmado e o link para entrar (RN-13), sem prejuízo. Alternativa: página com botão "Confirmar" (POST), mais resistente a pré-carregamento, mas contraria a letra do CA-4. |
| D-7 | Sem login automático após a confirmação; a tela leva a `/entrar`. | Mantém um único ponto de criação de sessão (login), com rate limit e prova de senha. O E6.1 decide se, após o login, o gestor é levado a "assinar". |
| D-8 | O reenvio e a confirmação por `/confirmar-email` só valem para `gestor`. | O profissional é confirmado no aceite do convite (E1.4 RN-4). O super admin não usa este fluxo. |
| D-9 | O cadastro não cria perfil de profissional para o gestor. | `PLAN.md:15`: o perfil é opcional ("nesse caso"); quem cria é a E2.2. |
| D-10 | Sem limpeza de contas não confirmadas nem de tokens vencidos. | Mesmo critério da D-010 D-10; o volume é baixo. Fica como pendência para a E9.x. |
| D-11 | Sem E2E com banco nesta demanda; os testes de componente e de integração cobrem a interface e o fluxo. Opcional: um E2E sem banco de `/cadastro` e `/confirmar-email`, limitado à renderização, à navegação por teclado e ao axe. Erros de validação do servidor só entram se a ação os devolver antes de qualquer acesso ao banco (RN-7 garante isso). | A issue diz "E2E opcional"; o job `e2e` não tem PostgreSQL (D-010 D-13). Pôr PostgreSQL no job `e2e` seria impacto de DevOps, e o arquiteto decide. |
| D-12 | Sem campo "confirmar senha". | Não consta da issue (campos: nome, e-mail, senha, nome do salão). O erro de digitação é recuperável pela E1.3. Alternativa: adicionar o campo, só de UI. |
| D-13 | Limites de tamanho: nome do gestor 2..100, nome do salão 2..80, slug base ≤ 50, senha 8..1024. | Não constam do PLAN; são valores razoáveis e a senha segue o teto do login. Nenhum deles exige migração (as colunas são `text`). |

### Dúvidas não bloqueantes (com suposição adotada)
- Texto definitivo dos e-mails e das telas: os da RN-13..RN-17 são provisórios, em pt-BR. O arquiteto ou o desenvolvedor podem ajustar a redação sem mudar o sentido. Os testes devem verificar os textos pelas constantes exportadas, não por cópia literal.
- Rota do reenvio por e-mail: suponho um formulário dentro de `/confirmar-email` (sem token) para não criar rota nova, o que mudaria `ROTAS` e `SEGMENTOS_RESERVADOS`. Se o arquiteto preferir uma rota própria, ela entra em `ROTAS` e passa a ser reservada automaticamente.
