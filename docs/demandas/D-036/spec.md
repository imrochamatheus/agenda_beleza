# D-036 — Seed (E9.2 #43), página inicial (E9.1 #54) e E2E do fluxo público (E4.4 #44): spec

## 1. Problema (evidência)
- Seed: inexistente. Não há `prisma/seed.ts`, nem script `db:seed` (`package.json` só tem `db:generate` e `db:migrate:deploy`), nem `migrations.seed` em `prisma.config.ts`. O README:114 diz "ainda não há seed (E9.2)". Existem `garantirSuperAdmin` (`src/server/auth/admin/garantir-super-admin.ts`; D-034 RN-2 prevê que o seed o chame) e as fábricas de teste `tests/support/factories.ts` (`criarSalaoCompleto`, `criarDoisSaloes`, `SENHA_DE_TESTE`). Elas usam Prisma/`obterPrisma` e instantes relativos a `new Date()`; servem de modelo, mas não podem ser importadas pelo seed (ficam em `tests/**`).
- Home: `src/app/page.tsx` é um placeholder ("Em breve…"), só com `siteConfig.name`. `src/config/plano.ts` JÁ existe (`PRECO_MENSAL_CENTAVOS = 7900`, `DIAS_TESTE = 30`, sem imports), então não é preciso defini-lo. `src/app/page.test.tsx` existe e testa o placeholder.
- E2E: o `playwright.config.ts` sobe `npm run start` só com `VITRINE_COMPONENTES=true`, `retries: CI ? 2 : 0` e sem `globalSetup`. Todos os `e2e/*.spec.ts` rodam em `/dev/*` e em rotas sem banco, por design. O job `e2e` da CI (`ci.yml:122-147`) não tem serviço postgres. Não existe E2E contra a página real `/[slug]` (`src/app/(publico)/[slug]/page.tsx`, `avaliar/[token]`), embora as ações públicas de reserva, avaliação e denúncia já existam (D-026, D-032, D-035).
- "Salão suspenso": `salao.suspenso_manual_em` existe (`schema.prisma:144`) e `PaginaDoSalao.tsx:120` já mostra o aviso "Agendamento indisponível" sem condição de reservar; `criar-reserva.ts` devolve `salao_indisponivel`.
- Migração: nenhuma. Todas as tabelas e colunas necessárias existem (`salao_*`, `salao_foto`, `avaliacao`, `assinatura`, `suspenso_manual_em`). Confirmado pelo schema.

## 2. Objetivo
Banco de demonstração reprodutível (2 salões completos e 1 super admin), uma home que apresenta o produto e leva ao cadastro, e uma suíte E2E mobile contra banco real semeado, que comprova o CA 2 do PLAN (perfil → reserva → conclusão → avaliação → denúncia) e roda na CI.

## 3. Escopo
Dentro: `prisma/seed.ts` (lógica em função exportada, com o CLI como casca fina) e `npm run db:seed`; `src/app/page.tsx` e seu teste; `e2e/landing.spec.ts`; infraestrutura E2E com banco (`globalSetup`, helpers em `e2e/suporte/`, job da CI); specs do fluxo público; README; lint/typecheck de `e2e/**`.
Fora: E6.3 (assinatura real por Mercado Pago: o seed grava direto); worker e mensagens no E2E (RN-5 do #44); teste do 429 (E4.2); cadastro de TOTP do super admin; E9.3 e E9.4 (documentação e demais itens). Nada colide com "Fora da primeira versão" do PLAN.

## 4. Regras de negócio
Seed (#43):
- RN-1: idempotente por UUIDs fixos. `INSERT … ON CONFLICT (id) DO NOTHING` ou `upsert` por id/chave natural, sem apagar nada e sem alterar dado existente. Reservas, bloqueios e avaliações usam datas relativas à primeira execução. Um UUID já presente não é recalculado, então a segunda execução não move dados. O número de linhas por tabela não muda.
- RN-2: `NODE_ENV=production` é recusado (exit ≠ 0, mensagem clara) sem a flag explícita `SEED_PERMITIR_PRODUCAO=true`. O seed nunca faz DELETE/TRUNCATE. Sem `DATABASE_URL`, falha nomeando a variável.
- RN-3: credenciais de demonstração são fixas, documentadas no README e nunca reais (e-mails em domínio `.example`, senha de demonstração `Demo@12345`, constante única exportada do seed). Clientes são fictícios, com telefone BR válido em E.164 gerado por `normalizarTelefoneBr` (DDD válido, formato 9XXXXXXXX).
- RN-4 (conteúdo, por salão): 2 salões com nomes, slugs e fusos distintos (A `America/Sao_Paulo`, B diferente do padrão, p. ex. `America/Manaus`); gestor com e-mail confirmado; ≥ 2 profissionais (em um dos salões o gestor atende, com perfil `profissional` vinculado); ≥ 3 serviços com vínculos parciais (há ao menos um par A+B sem profissional em comum com C, e um profissional que faz todos); jornadas com pausa (intervalos); funcionamento semanal definido; bloqueios (um do profissional e um do salão, futuros); clientes com consentimento; reservas passadas e futuras em vários status (`confirmado`, `concluido`, `cancelado`, `nao_compareceu`) com `reserva_item` em snapshot, sem violar a exclusão; perfil completo (endereço, contato, meios de pagamento, comodidades).
- RN-5 (D-019): fotos de demonstração PRÓPRIAS. Geradas em código (placeholder gráfico sólido ou gradiente nas cores do tema, produzidas via `src/server/imagem` ou SVG convertido; nenhum arquivo de terceiros no repositório), gravadas pela porta `integracoes().armazenamento`, e `salao_foto` com chaves determinísticas (idempotente: mesma chave, mesma gravação). ≥ 2 fotos por salão. Avaliações publicadas (`avaliacao` sem `retirada_em`) vinculadas a reservas `concluido` de clientes com `publicacao_aceita_em` e `versao_termos` = `VERSAO_TERMOS`; ≥ 2 por salão, notas variadas, um comentário com `nome_exibicao`.
- RN-6: assinaturas gravadas direto (E6.3 ainda não existe): A `em_teste` (trial de `DIAS_TESTE` a partir da primeira execução); B em outro estado válido do enum (sugestão `ativa`, com `periodo`/datas coerentes com as CHECKs da tabela; o DBA ou o dev confirma as colunas obrigatórias). Sem `assinatura_pagamento` real.
- RN-7: super admin via `garantirSuperAdmin` com `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` do env, ou, quando faltam, o par de demonstração (`admin@agendabeleza.example` + senha de ≥ 12 caracteres, documentados). O seed NÃO cadastra TOTP: o 1º login admin faz o cadastro (D-034 RN-6) e não é automatizado aqui. Já existindo, não altera senha nem TOTP. Sem `ADMIN_TOTP_CHAVE` o seed ainda funciona (a chave só é lida no cadastro do TOTP).
- RN-8: o seed é reutilizável por teste (`semear(prisma|deps, opções)`), com o único contexto de importação permitido (`prisma/seed.ts` já está na allowlist do lint). Gera o link de avaliação (E2E) só nos helpers do E2E, nunca no seed.

Home (#54):
- RN-9: `/` com textos próprios (sem citar Trinks, AppBarber ou AppBeleza), proposta de valor com a página pública do salão (perfil, fotos, avaliações verificadas), preço e dias de teste lidos de `plano.ts` e formatados por `src/lib/format.ts` (`formatarMoeda`; nenhum "79" ou "30" literal no código da página, só nos testes), botão primário "Criar conta" → `ROTAS` cadastro, "Entrar" → login, links para `/termos` e `/privacidade`. Página estática (sem banco), usa o layout e os tokens de E0.8, teclado, 1 `h1`, `lang pt-BR`.
- RN-10: o texto cita "sem limite de profissionais" e "30 dias grátis"; o preço aparece como "R$ 79/mês por salão".

E2E (#44):
- RN-11: Chromium 375×812 (`isMobile`, `hasTouch`) como hoje; `retries: 0` também na CI (alterar `playwright.config.ts`); testes independentes entre si (cada um cria seus dados com e-mail/telefone únicos, ou usa um salão próprio) e a ordem não importa.
- RN-12: `globalSetup` do Playwright (a) lê `E2E_DATABASE_URL`/deriva de `TEST_DATABASE_URL` (mesma conexão administrativa do harness de integração), (b) recria uma base descartável `<base>_e2e` (DROP IF EXISTS + CREATE), (c) roda `prisma migrate deploy` nela, (d) roda `semear()` e o complemento E2E, (e) sobe o servidor `npm run start` apontando para ela. O `webServer` precisa de `DATABASE_URL` da base E2E. O banco reinicia a cada rodada de `playwright test` (CA-3: duas rodadas seguidas passam), e o diretório de fotos é um `ARMAZENAMENTO_DIR` temporário.
- RN-13: variáveis do servidor E2E: adaptadores `simulado` (Turnstile, WhatsApp, e-mail, MP, storage), `PROTECAO_LIMITE_IP_RESERVA`/`_DISPONIBILIDADE`/`_AVALIACAO`/`_DENUNCIA`/`PROTECAO_LIMITE_NUMERO` elevados (p. ex. 100000), `RATE_LIMIT_SEGREDO`, `AVALIACAO_SEGREDO` conhecido pelo teste, `APP_URL=http://127.0.0.1:3000`, `VITRINE_COMPONENTES=true` (mantém os specs `/dev/*`). Valores só no `playwright.config.ts`/globalSetup, nunca segredo real.
- RN-14: sem worker no E2E. O convite de avaliação (RN-5 do #44) é obtido pelo helper que chama `criarGeradorLink({ segredo: () => AVALIACAO_SEGREDO, appUrl })` de `src/server/avaliacoes/convite.ts` contra a base E2E (cria o convite e devolve o link), nunca por mensagem.
- RN-15: conclusão da reserva "via seed": o complemento E2E cria, por reserva, uma reserva `concluido` e a cliente do teste (fixture SQL/Prisma direta no helper), sem passar pelo painel.
- RN-16: suspensão por fixture: um terceiro salão dedicado ao E2E (criado pelo complemento) ou um `UPDATE salao SET suspenso_manual_em = now()` nele, nunca nos salões A e B, para não quebrar os demais testes.
- RN-17: captcha inválido: o teste envia o token que o widget simulado marca como inválido (não `TOKEN_TURNSTILE_SIMULADO`) e espera a mensagem de captcha inválido; confere por consulta ao banco que nenhuma `reserva` nova existe para o telefone usado.
- RN-18: lint e typecheck já incluem `e2e/**` (eslint `TESTES` tem `e2e/**`; confirmar `tsconfig.json#include`). Impedir `any` e `eslint-disable` novos nos helpers.

## 5. Critérios de aceitação
Seed:
- CA-1: Dado banco migrado vazio, quando `semear` roda, então existem 2 salões, cada um com 1 gestor confirmado, ≥ 2 profissionais, ≥ 3 serviços, reservas (≥ 3 status distintos no conjunto) e 1 super admin no total (#43 CA-1).
- CA-2: Dado o seed executado duas vezes, quando se contam as linhas de todas as tabelas semeadas (inclusive `salao_foto`, `avaliacao`, `assinatura`, `reserva_item`), então os totais são idênticos e nenhuma linha muda de id (#43 CA-2, RN-1).
- CA-3: Dado as credenciais do README, quando se faz login (`entrar`/`entrarDeVerdade`) como cada gestor, então ele vê só o próprio salão (um `listar` tenant-scoped não devolve linhas do outro) (#43 CA-3).
- CA-4: Dado `NODE_ENV=production` sem `SEED_PERMITIR_PRODUCAO=true`, então o seed sai com erro e não grava nada; com a flag, roda (RN-2).
- CA-5: Dado o seed, então os dois salões têm perfil completo, funcionamento definido, ≥ 2 fotos próprias (objeto existe no armazenamento e `GET /api/fotos/[id]` responde 200 `image/webp`) e ≥ 2 avaliações publicadas de reservas `concluido`; nenhum arquivo de imagem de terceiros entra no repositório (#43 CA-R1).
- CA-6: Dado o seed, então a assinatura de cada salão existe: A `em_teste`, B em estado distinto, gravadas direto; os dados do super admin existem e `garantirSuperAdmin` rodado de novo devolve `existente` sem alterar o hash (RN-6, RN-7).
- CA-7: Dado o seed, então todo telefone de cliente satisfaz `normalizarTelefoneBr(x) === x` e nenhuma reserva ativa se sobrepõe a outra do mesmo profissional (a constraint não dispara) (RN-3, RN-4).
- CA-8: Dado o README, então lista os comandos, as credenciais de demonstração e o aviso "nunca use em produção"; um teste estático confere que o e-mail e a senha documentados são as constantes do seed.

Home:
- CA-9: Dado `/`, quando carregada, então mostra "Agenda Beleza", "R$ 79" mensais e "30 dias grátis", os três valores vindos de `plano.ts` (teste de componente; teste estático proíbe o literal na página) (#54 CA-1).
- CA-10: Dado `/`, quando o botão de cadastro é acionado por teclado (Tab + Enter), então navega para o cadastro (#54 CA-2).
- CA-11: Dado viewport 375 px, quando carregada, então não há rolagem horizontal e o axe 4.14.0 não encontra violações (#54 CA-3).
- CA-12: Dado `/`, então apresenta a página pública do salão (perfil, fotos, avaliações verificadas), mantém "R$ 79/mês" e "30 dias grátis", e não contém "Trinks" (teste de componente com busca negativa) (#54 CA-R1).
- CA-13: Dado `/`, então há links para `/termos` e `/privacidade` e para login (`/entrar`).

E2E:
- CA-14: Dado o salão A semeado, quando a cliente escolhe 2 serviços, um profissional que faz ambos, dia, horário, preenche dados, aceita os consentimentos e confirma (Turnstile simulado válido), então chega à confirmação e a reserva existe no banco com 2 `reserva_item` back to back e snapshot de preço e duração (#44 CA-1).
- CA-15: Dado serviços com vínculos parciais, quando a cliente escolhe A+B, então só aparecem os profissionais que fazem ambos (#44 CA-5).
- CA-16: Dado o horário escolhido tomado por fixture (reserva inserida no banco) entre a escolha e o envio, quando confirma, então vê "horário indisponível" e volta à etapa do horário com os serviços e os dados preservados; nenhuma reserva duplicada (#44 CA-6).
- CA-17: Dado token de captcha inválido, quando a cliente confirma, então vê a mensagem de captcha inválido e nenhuma reserva é criada (#44 CA-4, RN-17).
- CA-18: Dado o salão suspenso por fixture (`suspenso_manual_em`), quando a página pública é aberta, então o perfil aparece (nome, fotos, avaliações) e vê-se "Agendamento indisponível" sem formulário de reserva (#44 CA-2 e CA-R2).
- CA-19: Dado viewport 375×812 e só teclado (Tab/Space/Enter), quando o fluxo é executado, então a reserva é concluída e nenhuma etapa tem rolagem horizontal (#44 CA-7).
- CA-20: Dado o seed e uma reserva `concluido` fornecida pelo complemento, quando o link de avaliação (RN-14) é aberto, então a cliente envia nota e comentário, a avaliação passa a aparecer no perfil do salão, e o mesmo link não permite uma segunda avaliação (#44 CA-R1).
- CA-21: Dado uma avaliação publicada, quando a visitante a denuncia, então a confirmação aparece e a denúncia existe (`avaliacao_denuncia`); a avaliação continua publicada até a moderação (#44 CA-R1).
- CA-22: Dado o fluxo CA-14..CA-21, então cada tela percorrida (perfil, escolha de serviços, profissional, dia/horário, dados, confirmação, avaliar, denúncia, suspenso) passa pelo axe 4.14.0 sem violações (`analisarComAxe`) e sem rolagem horizontal (#44 CA-R1).
- CA-23: Dado a suíte E2E completa, quando `npm run test:e2e` roda duas vezes seguidas (base recriada a cada rodada), então passa nas duas, com `retries: 0` (#44 CA-3, RN-11).
- CA-24: Dado a CI, então o job `e2e` tem serviço postgres, executa a suíte com base própria e as variáveis de RN-13, e continua com o nome `e2e` (check obrigatório); fica verde.

## 6. Casos limite
- Fuso/virada de dia: B em fuso ≠ padrão; as datas relativas do seed são calculadas por `src/server/tempo/fuso.ts` (não por métodos locais de `Date`), e o teste roda com `TZ=UTC` e `TZ=America/Sao_Paulo`. Horários E2E escolhidos dinamicamente (primeiro disponível), nunca fixos. O dia "hoje" respeita a antecedência (2 h): reservas futuras do seed ficam a ≥ 1 dia.
- Concorrência: duas execuções do seed em paralelo não duplicam (ON CONFLICT por id); CA-16 prova a corrida da reserva (a constraint decide).
- Isolamento: nenhum teste E2E altera dados do salão B de modo que quebre o A; login de cada gestor vê só o seu.
- Suspenso: reserva recusada também se a requisição for forjada (já coberto em D-026; no E2E só a tela).
- Cliente anonimizada: o seed pode incluir uma cliente anonimizada com reserva (cobre a exibição "cliente removida"); avaliações dela não exibem o nome.
- Entradas inválidas: telefone não brasileiro (E2E usa o mensagem de erro do formulário; opcional), captcha inválido.
- Permissões: seed não cria profissional com senha sem convite; se criar usuário de profissional para demo, e-mail confirmado e senha de demonstração (documentados).
- Instante de execução: avaliações e reservas passadas a partir de `agora`; os `criado_em` coerentes (avaliação depois da reserva).

## 7. Dependências
Concluídas: E1.5 (garantirSuperAdmin), E3.2, E4.1/4.2 (D-026), E4.3, E4.5 (D-032 avaliação), E4.6 (denúncia), E8.4 (D-035), E2.6/E2.7 (perfil, fotos). A E6.3 (#40) ainda não existe (assinatura gravada direto) e a E6.4 (#41) é substituída pela suspensão manual. Infra: postgres no job e2e, `playwright.config.ts`. Integrações: todas simuladas.

## 8. Impactos prováveis
- Dados: sem migração. O DBA só opina se quiser conferir as CHECKs de `assinatura` e a ordem de inserção do seed (FK, exclusão); recomendado dispensar, com o motivo "sem DDL", e deixar o parecer ao arquiteto.
- DevOps (acionar): job `e2e` com `services: postgres` (a mesma imagem do compose), `DATABASE_URL`/`TEST_DATABASE_URL` no job, `retries: 0`, migrar e semear dentro do `globalSetup`; docker-compose/README: `docker compose exec app npm run db:seed` ou equivalente. A imagem da app não tem `src/` nem tsx no estágio final: decidir se o seed é empacotado por esbuild em `dist/prisma/seed.js` (como o worker), o que o `docker compose` pode rodar. Recomendação: `build:node` ganha a entrada do seed e `npm run db:seed` = `build:node` + `node --env-file-if-exists=.env dist/prisma/seed.js`.
- CI: tempo do job e2e sobe (build + migração + seed); manter `timeout-minutes: 20` e conferir.
- README: seções "Usuário de exemplo" (substituir o texto de README:114), "E2E" (banco próprio, variáveis, `retries: 0`), credenciais de demonstração. CLAUDE.md: comandos `db:seed` e o E2E com banco.

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposições adotadas):
- S-1: estado da assinatura de B = `ativa` (alternativa: `em_carencia`). Se uma CHECK exigir campo que o seed não tem (ex.: id do Mercado Pago), usar `em_teste` em ambos e registrar o desvio.
- S-2: o seed não cadastra TOTP; o admin faz o cadastro no 1º login. O E2E do admin continua em `/dev/admin-entrar`.
- S-3: fotos geradas por código (SVG → `processarImagem` WebP), não arquivos versionados; se preferir arquivos, só os gerados por nós, com licença registrada no README.
- S-4: o salão suspenso do E2E é um 3º salão do complemento E2E (não do seed padrão), para manter "2 salões" no CA-1.
- S-5: senhas e e-mails de demonstração são fixos e públicos; o seed em produção exige a flag, e o README avisa que não deve ser rodado lá.
- S-6: os specs `/dev/*` existentes ficam como estão (rodam no mesmo servidor, que agora tem banco); o `retries: 0` na CI pode expor flaky existente, e nesse caso o desenvolvedor corrige o teste, não reativa retries.

## 10. Riscos
- R-1: `retries: 0` com 40+ specs: flakiness; mitigação: esperas por estado (web-first), nada de `waitForTimeout`.
- R-2: servidor com `next start` precisa do banco antes de subir (ordem globalSetup → webServer: no Playwright o `webServer` sobe antes do `globalSetup`; arquiteto decide: base criada num script de pré-etapa (`test:e2e` = `next build && node e2e/suporte/preparar-banco && playwright test`) ou `webServer` como array com comando que prepara e inicia).
- R-2b: reuso de servidor local na porta 3000 (`reuseExistingServer`) com o banco errado; mitigar com `reuseExistingServer: false` quando o E2E usa banco.
- R-3: dependência de fotos em disco entre o seed e o servidor (`ARMAZENAMENTO_DIR` compartilhado).
