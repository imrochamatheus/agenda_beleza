# D-034 (E1.5) Super admin + TOTP — spec

## 1. Problema (evidência)
- Existe: enum `super_admin` e CHECK `usuario_papel_salao_chk` (init/restricoes_sql); colunas `usuario.totp_segredo_cifrado`, `totp_ativado_em`, `sessao.totp_verificado_em` (schema.prisma ~221/244); `AdminContext`, `resolverAdmin` (exige papel + `totp_verificado_em`, src/server/tenant/sessao.ts), `registrarAuditoria(ctx, e, r)`/`registrarFalhaAuditoria` (D-033), vocabulário já com `login.falha_totp` e `login.falha_senha`; rotas `/admin`, `/admin/entrar` em `ROTAS`/`NAVEGACAO_ADMIN`.
- Não existe: criação do super admin, `SUPERADMIN_*` no env, TOTP, cifra, `src/app/admin/**`, guarda admin. `entrar()` (auth/login.ts) recusa `super_admin` com "credenciais" (de propósito); `proxy.ts` só cobre `/painel`. `/admin` está em `SEGMENTOS_RESERVADOS` (verificar no teste).
- Sessão: `iniciarSessao` usa `expiracaoInicial` (7 d inatividade/30 d teto) e `precisaRenovar/novaExpiracao` renova; cookie único `ab_sessao`.

## 2. Objetivo
Acesso da operação da plataforma só com senha + TOTP, sessão própria e curta, tudo auditado.

## 3. Escopo
Dentro: `garantirSuperAdmin`, `npm run superadmin:criar`, TOTP (RFC 6238), cifra, cadastro obrigatório no 1º login, login em 2 etapas, rate limit, sessão admin separada, guarda, `/admin` mínima, auditoria, `/dev` p/ E2E, migração, env/compose/README.
Fora: cadastro público (proibido), telas de salões/assinatura/mensagens (E8.2+), consulta de auditoria (E8.3), recuperação de senha/TOTP do admin, códigos de recuperação, troca/reset de TOTP (v1: manual via script/DBA, anotar no README), seed (E9.2 chama `garantirSuperAdmin`). Nada conflita com "Fora da primeira versão".

## 4. Regras de negócio
- RN-1 Nenhuma rota/ação pública cria super admin; só `garantirSuperAdmin` (script/seed).
- RN-2 `garantirSuperAdmin({email,senha})` (env `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD`; e-mail minúsculo; senha ≥ 12 caracteres, mesmo hash argon2id de senha.ts) é idempotente: `INSERT … ON CONFLICT (email) DO NOTHING`; `papel='super_admin'`, `salao_id NULL`, `email_confirmado_em=now()`. Se o e-mail já existe com outro papel: erro e nada muda. Se já é super admin: não altera senha nem TOTP (rodar de novo nunca "reseta"); devolve `criado|existente`. Corrida de duas execuções = uma conta. Sem log da senha.
- RN-3 TOTP: HMAC-SHA1, 6 dígitos, passo 30 s, segredo 20 bytes aleatórios (base32 RFC 4648 sem padding para exibição), tolerância ±1 janela, comparação em tempo constante, `node:crypto` (sem dependência nova). Vetores RFC 6238 SHA-1 nos testes. Relógio injetado.
- RN-4 Anti-replay: um contador de passo aceito nunca é aceito de novo (nem anterior): nova coluna `usuario.totp_ultimo_passo bigint`, atualizada por `UPDATE … WHERE totp_ultimo_passo IS NULL OR totp_ultimo_passo < $passo` (0 linhas = recusa; atômico sob concorrência).
- RN-5 Segredo cifrado com AES-256-GCM, IV 12 B aleatório por gravação, formato `v1:<iv>:<tag>:<cifra>` base64url; AAD = id do usuário; chave `ADMIN_TOTP_CHAVE` (32 bytes em base64 ou 64 hex; validar tamanho no `check-env`; obrigatória em produção e quando existir super admin; `.env.example` com campo vazio e instrução de geração `openssl rand -base64 32`; compose repassa a app; README na seção de segredos, com aviso: perder/trocar a chave exige reset manual do TOTP). Segredo em claro nunca em log, auditoria, banco, URL, cookie ou erro.
- RN-6 Primeiro login (senha certa, sem `totp_ativado_em`): sessão de pré-autenticação; única tela permitida é o cadastro do TOTP (gera segredo, mostra QR `otpauth://totp/Agenda%20Beleza:<email>?secret=…&issuer=Agenda%20Beleza&algorithm=SHA1&digits=6&period=30`, renderizado no servidor como SVG sem serviço externo e sem JS; fallback: chave em texto agrupada). O segredo só é gravado/ativado (`totp_ativado_em`) após confirmar um código válido; o segredo pendente fica numa cifra na própria pré-sessão ou é regerado se a página for recarregada (decisão do arquiteto: não persistir em claro; sem JS o segredo precisa sobreviver ao POST, p.ex. cifrado em campo oculto assinado/ou coluna cifrada ainda sem `totp_ativado_em`; esta última é a suposição S-1). Se `totp_ativado_em` já existe, o cadastro é recusado.
- RN-7 Login em 2 etapas: (1) e-mail+senha (custo uniforme com hash fictício, mensagem única "E-mail ou senha incorretos." para inexistente/senha errada/não-admin); (2) código TOTP. Sessão nasce após a senha com `totp_verificado_em NULL` e expiração de 10 min (pré-auth); só vira sessão admin quando o código valida (`totp_verificado_em=now()`, token rotacionado: novo token, antiga revogada, sem fixação).
- RN-8 Sessão admin separada: cookie próprio `ab_admin` (httpOnly, SameSite=Strict, Path `/admin`, Secure em produção), nunca `ab_sessao`. Validade: 30 min de inatividade e teto absoluto de 8 h, sem a renovação de 7/30 d (`validade.ts` do salão intocado: nova política admin). Sessão de salão não vale no admin e vice-versa. Sair revoga.
- RN-9 Rate limit TOTP: 5 falhas por usuário por janela fixa de 15 min em `rate_limit_janela` (chave `admin-totp:`+SHA-256 do usuarioId); a 6ª tentativa é recusada sem verificar o código, também após sucesso do código certo (limite vem antes). Login admin: reaproveita a mecânica de `login:` com chave própria `admin-login:`+hash do e-mail (10/15 min). Mensagem de limite genérica.
- RN-10 Guarda `exigirAcessoAoAdmin`: sem `ab_admin` → se há `ab_sessao` de gestor/profissional válida: 403 "Acesso negado" (sem redirecionar); senão 401 → redirect `/admin/entrar`. Sessão admin sem TOTP verificado → redirect à etapa 2/cadastro; nunca renderiza conteúdo. Autorização na página/ação (resolverAdmin), proxy só confere presença de cookie em `/admin/**` exceto `/admin/entrar` (otimista, como D-010).
- RN-11 Auditoria (S14), vocabulário `ACOES_AUDITAVEIS` estendido por esta demanda: `login.sucesso` (entidade `usuario`, id do admin; `depois` sem segredo), `totp.cadastrar`; já existem `login.falha_senha`/`login.falha_totp` (falha: `registrarFalhaAuditoria`, conexão própria, chamada após rollback, `atorEmailInformado` truncado como a D-033 faz; nunca senha nem código). Sucesso na mesma transação da criação da sessão admin (`registrarAuditoria` com `r`).
- RN-12 `resolverTenant` já recusa super admin; `resolverAdmin` já exige TOTP; repositórios de tenant continuam recusando AdminContext.

## 5. Critérios de aceitação
- CA-1 (issue CA-1) Dado SUPERADMIN_*, quando `garantirSuperAdmin()` roda 2× (e 10 em paralelo), então 1 conta `super_admin` com `salao_id` nulo e hash argon2id; 2ª chamada não altera hash/TOTP. E-mail de gestor existente → erro, nada alterado. `npm run superadmin:criar` (build:node) sai 0 nas duas execuções, sem imprimir senha.
- CA-2 (issue CA-2) Dado primeiro login com senha correta sem TOTP, então /admin redireciona ao cadastro; painel inacessível até confirmar código válido; QR (SVG, sem requisição externa) e chave em texto presentes, também sem JS; após confirmar, `totp_ativado_em` preenchido.
- CA-3 (issue CA-3) Dado senha certa e código inválido, então recusa com mensagem genérica, nenhuma sessão admin válida e uma linha `login.falha_totp` (resultado falha) persistida; idem `login.falha_senha` para senha errada, e e-mail informado sem senha/código.
- CA-4 (issue CA-4) Dada sessão de gestor (e de profissional), GET em /admin e em ação admin → 403; sem sessão → redirect 307 `/admin/entrar`.
- CA-5 (issue CA-5) Com TOTP ativo, `totp_segredo_cifrado` ≠ segredo base32 e não o contém; decifra com a chave correta e falha (tag) com chave errada ou AAD de outro usuário.
- CA-6 TOTP: vetores RFC 6238 (SHA-1, 8 dígitos truncados a 6 conferidos), aceita t-30/t/t+30 s e recusa t±60 s; formato não numérico/≠6 dígitos recusado sem consulta ao banco.
- CA-7 Replay: o mesmo código aceito 2× (sequencial e 2 em paralelo) → exatamente 1 sucesso; código de passo anterior ao último aceito recusado.
- CA-8 Rate limit: 5 falhas → 6ª recusada mesmo com código correto; janela seguinte libera; dois usuários independentes.
- CA-9 Cookie `ab_admin`: atributos (httpOnly, SameSite=Strict, Path=/admin); sessão de pré-auth expira em 10 min e não acessa /admin; admin válido expira após 30 min de inatividade e 8 h absolutas (relógio injetado); logout revoga; token de pré-auth rotacionado (token antigo inválido).
- CA-10 Sucesso grava `login.sucesso` na mesma transação (falha na auditoria desfaz a sessão); nenhuma linha de auditoria ou log contém senha, código, segredo ou chave.
- CA-11 `check-env` falha nomeando `ADMIN_TOTP_CHAVE` se ausente (quando exigida) ou com tamanho ≠ 32 bytes; `.env.example`, compose e README atualizados; app e worker sobem com compose.
- CA-12 `/admin` (mínima) mostra nome do admin e "Sair"; sem links para telas inexistentes; `Cache-Control: no-store`.
- CA-13 E2E sem banco em `/dev/admin-entrar` (vitrine; só validação de formato/teclado/axe/sem JS/375×812); `/admin/entrar` retorna 200 sem banco com envio vazio mostrando erros.
- CA-14 Isolamento: sessão admin não resolve em `resolverTenant`; sessão de salão em `resolverAdmin` → `AcessoNegado`.

## 6. Casos limite
Fuso: passos TOTP em epoch UTC, independente de TZ do processo (rodar unit em UTC e America/Sao_Paulo); virada de janela de 15 min do rate limit; relógio do servidor sempre injetado. Concorrência: dois cadastros de TOTP simultâneos (um vence, `UPDATE … WHERE totp_ativado_em IS NULL`); replay paralelo; duas execuções do script. Salão suspenso: irrelevante (admin sem salão). Cliente anonimizada: n/a. Entradas: e-mail inválido, senha > 1024, código com espaços (aparar espaços/hífen), unicode. Admin sem TOTP não acessa nada. Perfis: gestor/profissional 403; cliente sem conta 401. Admin cuja senha mudou: n/a (sem recuperação).

## 7. Dependências
D-010 (login/sessão/cookie), D-033 (auditoria), D-005 (contextos). Nenhuma integração externa (QR local, sem Turnstile, e-mail ou WhatsApp). Pré-requisito de E8.2/E8.3/E9.2/E8.4. QR: gerar SVG sem biblioteca (encoder QR próprio é custoso) ou dependência exata nova (ex. `qrcode-generator`, MIT, sem I/O); decisão do arquiteto, com lint de importação única.

## 8. Impactos prováveis
- DBA: migração `usuario.totp_ultimo_passo bigint` (+ possivelmente coluna/estado de segredo pendente, ver RN-6) e CHECK `totp_ativado_em IS NOT NULL → totp_segredo_cifrado IS NOT NULL`; sessão: tipo/limite admin sem coluna nova se possível (expiração já existe) — arquiteto decide como impedir a renovação do salão em sessões de super admin.
- DevOps/CI: `ADMIN_TOTP_CHAVE` e `SUPERADMIN_*` no `.env.example`, compose, check-env, README; script `superadmin:criar` via esbuild em `dist/scripts`; CI precisa da chave de teste (valor fixo só de teste); novo spec E2E.
- Cobertura ≥ 90% mantida.

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposições):
- S-1 Segredo pendente do cadastro guardado cifrado em `totp_segredo_cifrado` com `totp_ativado_em` NULL (regerado ao recarregar); só ativa com código válido.
- S-2 Sem códigos de recuperação nem reset de TOTP na v1 (reset manual via DBA/script futuro).
- S-3 Senha mínima do admin 12 caracteres (vs. regra do salão) e e-mail em `SUPERADMIN_EMAIL` já em minúsculas após normalização.
- S-4 Cookie `ab_admin` com Path `/admin` e Server Actions do admin sob `/admin/**` (nenhuma ação em outra rota).
- S-5 Janela de 30 min/8 h da sessão admin é decisão desta spec (a issue só diz "curta").
