# D-039 (E1.4) — Convite de profissional: especificação

## 1. Problema
Hoje o gestor cadastra o profissional (D-013) mas não há como dar acesso: nenhum código envia convite nem aceita. Evidência:
- `grep convite src/server/profissionais src/app` só mostra o texto de `servico.ts:112` e o bloco de `repos/profissional.ts:240` (`db.convite.updateMany` invalida pendentes ao desativar).
- Já existem: tabela `convite` (`prisma/schema.prisma:689`: `salao_id`, `profissional_id` com FK composta, `email` minúsculo por CHECK `convite_email_minusculo_chk`, `token_hash` UNIQUE, `expira_em`, `aceito_em`, `invalidado_em`), `Profissional.usuarioId` (FK composta, UNIQUE por usuário) e `Profissional.email` (opcional), `ROTAS.convite(token)` = `/convite/<token>` (`src/config/navegacao.ts:16`, portanto `convite` já está em `SEGMENTOS_RESERVADOS`).
- Não existe: serviço, ação, página `/convite/[token]`, e-mail, `Referrer-Policy` para a rota (`next.config.ts:14-17` cobre só `confirmarEmail` e `redefinirSenha`).

## 2. Objetivo
O gestor convida por e-mail um profissional cadastrado; o profissional abre o link, define a senha, passa a ter usuário (`papel=profissional`) vinculado ao seu perfil e ao salão e entra vendo só a própria agenda (PLAN "Perfis e acesso"; critério de aceite 8; S15).

## 3. Escopo
Entra: serviço de convite (`src/server/auth/convite.ts`, sem `next/*`), repositório pré-contexto para o aceite, ação autenticada de convidar/reenviar, página pública `/convite/[token]` (aceite), e-mail (porta de e-mail existente), controles no `/painel/profissionais/[id]`, `Referrer-Policy: strict-origin` na rota, testes, README (fluxo e teste).
Fica fora: login automático após o aceite, convite de gestor/super admin, troca do e-mail de login, convite por WhatsApp, revogar convite sem reenviar (o desativar já invalida), auditoria (só super admin audita). Nada conflita com "Fora da primeira versão" do PLAN.
Visual: web-designer dispensado; reutilizar os componentes de `/redefinir-senha` (cartão, campo de senha, mensagens, estado único com `useActionState`, funciona sem JS).

## 4. Regras de negócio
- RN-1 (issue): só o gestor convida, só profissional do próprio salão. Outro salão ou id malformado = `NaoEncontrado` (404). Profissional logado recebe 403.
- RN-2: expira em 7 dias (`expira_em = agora + 7d`), uso único; reenviar invalida o pendente anterior (`invalidado_em`) e cria um novo, na mesma transação.
- RN-3: convite exige `profissional.email` preenchido. O e-mail do convite é uma cópia do e-mail do perfil, em minúsculas, tirada no envio.
- RN-4: recusa o convite se já existe `usuario.email` igual (qualquer salão, qualquer papel, inclusive o do gestor do próprio salão). Verificado no envio e de novo no aceite. Mensagem ao gestor: "Este e-mail já está em uso por um usuário do Agenda Beleza e não pode ser convidado. Use outro e-mail." (CA-4; igual para outro salão ou o mesmo, para não vazar em qual salão está).
- RN-5: recusa se o profissional já tem usuário vinculado (inclui "eu também atendo" do gestor): "Este profissional já tem acesso."
- RN-6: recusa convidar profissional inativo ("Reative o profissional para convidar"). No aceite, profissional inativo = link recusado. Reativar não restaura convites.
- RN-7: alterar o e-mail do perfil (D-013) invalida convites pendentes do profissional na mesma transação; o aceite sempre confere `convite.email` e a vigência. A edição já é bloqueada com usuário vinculado.
- RN-8: aceite define a senha (política da D-012: 8 a 1024 caracteres, sem aparar, `validarNovaSenha`; hash argon2id por `src/server/auth/senha.ts` antes da transação). Numa única transação READ COMMITTED: trava profissional → trava convite → confere validade, e-mail e vínculo → cria `usuario` (`papel=profissional`, `salao_id`, `nome` = nome do perfil, `email` do convite, `email_confirmado_em = agora`, via `ON CONFLICT (email) DO NOTHING`) → grava `profissional.usuario_id` → marca `aceito_em`. Qualquer falha desfaz tudo (RN-4 do issue: e-mail confirmado).
- RN-9: aceite não cria sessão; mostra "Senha definida. Entre com o seu e-mail." com link para `/entrar`. O login usa o fluxo existente (profissional ativo vê só a própria agenda por `filtroDeProfissional`).
- RN-10: token de 32 bytes (`gerarToken`), só o SHA-256 em `convite.token_hash`; link montado com `APP_URL`, nunca com o Host. O GET da página só verifica (não consome, não grava). Recusa única para "inválido, expirado, usado ou substituído" (mensagem como a da D-012, sem distinguir ao visitante; o motivo só vai ao log sem dados pessoais).
- RN-11: capacidade `configurar` (`defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })`; a trava por estado do salão é da D-038: salão somente leitura não convida). O aceite é pré-autenticação, fora da política de estado; salão suspenso: o aceite é permitido (a profissional só entra para ler). Suposição.
- RN-12: limite de reenvios: 3 por profissional numa janela fixa de 15 min, via `rate_limit_janela` (chave `convite:` + SHA-256 do id do profissional, sem e-mail em claro). Acima: "Muitos envios. Aguarde alguns minutos."
- RN-13: o e-mail é enviado de forma síncrona após o commit (padrão D-011). Falha no envio não desfaz o convite: resultado `criado` com `emailEnviado: false` e aviso "Convite criado, mas o e-mail não foi enviado. Use Reenviar." Nunca registra o token em log.
- RN-14: `Referrer-Policy: strict-origin` (nunca `no-referrer`) em `/convite/:token` no `next.config.ts`.
- RN-15: o convite não altera reservas, jornada nem vínculo de serviços.

## 5. Critérios de aceitação
- CA-1 (issue CA-1; PLAN 8): Dado profissional ativo, sem usuário, com e-mail livre, quando o gestor envia, então existe 1 `convite` pendente com `expira_em` = agora + 7 d, o `email_log` simulado tem 1 mensagem para esse e-mail com o link `APP_URL/convite/<token>`, e o banco guarda só o hash.
- CA-2 (issue CA-2): Dado link válido, quando o profissional envia a senha correta, então existe `usuario` `profissional` do salão com e-mail confirmado, `profissional.usuario_id` preenchido, convite `aceito_em` preenchido; ele entra por `/entrar` e a agenda/leitura mostra só reservas dele (teste de isolamento: não vê as de outro profissional nem de outro salão).
- CA-3 (issue CA-3): Dado link já usado, expirado (agora ≥ expira_em, com relógio injetado), substituído por reenvio, invalidado pela desativação, ou token inexistente/malformado, quando aberto (GET) ou enviado (POST), então é recusado com a mesma mensagem e nada é criado.
- CA-4 (issue CA-4): Dado e-mail já pertencente a `usuario` de outro salão, quando o gestor tenta convidar, então recusa com a mensagem da RN-4, sem convite nem e-mail. Idem para e-mail do próprio gestor/outro usuário do mesmo salão.
- CA-5: Dado convite pendente, quando o gestor reenvia, então o anterior fica `invalidado_em`, há exatamente 1 pendente, o link antigo é recusado e o novo funciona.
- CA-6: Dado dois aceites simultâneos do mesmo link (e dois POSTs sem JS), então exatamente um sucede; o outro recebe a recusa; 1 só `usuario`; sem 5xx nem impasse (10 repetições).
- CA-7: Dado reenvio × aceite em paralelo, então ou o aceite vence (reenvio recusa "já tem acesso") ou o reenvio vence (aceite do link antigo recusado); nunca dois pendentes nem usuário criado por link invalidado.
- CA-8: Dado e-mail registrado como `usuario` entre o envio e o aceite, então o aceite é recusado sem criar usuário nem 500 (`ON CONFLICT`, sem capturar 23505).
- CA-9: Dado profissional inativo ou já com usuário, então convidar é recusado (RN-5/RN-6); dado desativação depois do convite, então o link é recusado (RN-6) e as sessões seguem as regras da D-013.
- CA-10: Dado edição do e-mail do perfil com convite pendente, então o convite fica invalidado; dado profissional sem e-mail, convidar mostra erro de campo.
- CA-11: Dado profissional logado, ou gestor de outro salão com o id, então 403/404 sem efeito (isolamento entre salões: nenhum convite em outro salão).
- CA-12: Dado o 4º envio em 15 min para o mesmo profissional, então recusa por limite, sem e-mail.
- CA-13: Dado senha com menos de 8 ou mais de 1024 caracteres, então erro de campo e o convite continua pendente.
- CA-14: Dado falha da porta de e-mail, então o convite existe e a resposta traz o aviso da RN-13.
- CA-15: Dado `GET /convite/<token>`, então o cabeçalho é `referrer-policy: strict-origin` e o GET não escreve no banco; a página tem formulário que funciona sem JavaScript, teclado e zero violações axe (E2E sem banco, 375×812).
- CA-16: A listagem/detalhe do gestor mostra o estado do convite (sem convite, pendente até DD/MM, expirado, aceito) sem expor token nem hash.

## 6. Casos limite
- Fuso: expiração em UTC por instante (7 × 24 h), exibição no fuso do salão por `format.ts`; sem dependência do fuso do processo (rodar em UTC e America/Sao_Paulo).
- E-mail com maiúsculas/espaços: normalizar (trim, minúsculas) antes de comparar e gravar; usuário existente com e-mail igual ignorando caixa conta como em uso.
- Profissional inativo com perfil antigo; profissional "voce" (gestor): recusados (RN-5/6).
- Anonimização de cliente e telefone não brasileiro: não se aplicam.
- Concorrência: ordem de travas `profissional` (`FOR NO KEY UPDATE` no envio; `FOR UPDATE` no aceite, serializa com desativar) → `convite` → `usuario`/`rate_limit_janela`; nunca travar `usuario` antes do profissional. A aplicação (arquiteto) decide o fino; DBA avalia um índice único parcial `convite(profissional_id) WHERE aceito_em IS NULL AND invalidado_em IS NULL` como cinto de segurança.
- Sem enumeração para quem não é gestor: a página pública nunca confirma e-mail de existência; o aceite recusado é uniforme. O gestor sabe que o e-mail está em uso (exigência do CA-4), o que permite sondar e-mails: mitigado pelo limite RN-12 e por ser autenticado; risco aceito.
- Desativação com convite aceito não é problema (usuário vinculado, tratado pela D-013).

## 7. Dependências
E2.2/D-013 (profissionais), E0.6/D-007 (porta de e-mail simulada e `email_log`), D-011/D-012 (token, `gerarToken`, `hashDoToken`, `validarNovaSenha`, `rate_limit_janela`, padrão de página), D-010 (login, `resolverTenant`), D-038 (capacidade `configurar`). E3.3 (listada na issue) não é necessária para esta entrega: a leitura da agenda própria já existe pela matriz (`filtroDeProfissional`); o CA-2 verifica por repositório/permissão. Sem Mercado Pago, WhatsApp ou Turnstile (suposição: sem Turnstile; o POST é protegido pela posse do token e pelo `Origin` das Server Actions).

## 8. Impactos prováveis
- Dados: nenhuma tabela nova; talvez migração opcional do índice único parcial (DBA decide). Nenhuma coluna nova.
- Infra/CI: nenhuma variável de ambiente nova (usa `APP_URL` e `EMAIL_ADAPTER`); `next.config.ts` ganha o cabeçalho de `/convite/:token`; `docker/smoke.sh` pode incluir `/convite/x` com `referrer-policy`.
- Documentação: README (fluxo de convite, comando de teste), CLAUDE.md (módulo), `docs/trinks-alinhamento.md` (E1.4 sem alteração).
- Nova operação em `permissoes.ts`: reutilizar `'profissional.gerir'` (gestor) em vez de criar outra.

## 9. Dúvidas
Bloqueantes: nenhuma.
Suposições adotadas: (a) aceite sem login automático; (b) mensagem do gestor igual para e-mail de outro salão e do mesmo salão; (c) aceite permitido com salão suspenso; (d) reenvio limitado a 3/15 min por profissional; (e) editar o e-mail do perfil invalida convites pendentes; (f) E3.3 não é pré-requisito real; (g) arquivos: `src/server/auth/convite.ts`, `src/server/repos/convite.ts` (pré-contexto), página em `src/app/(publico)/convite/[token]/`, ação em `profissionais.acao.ts` ou módulo próprio.
