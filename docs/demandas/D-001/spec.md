# D-001 — Especificação do backlog da v1 (analista-requisitos)

Fonte: `PLAN.md` (spec aprovada da v1), `CLAUDE.md` (invariantes, gate de cobertura) e `docs/demandas/D-001/backlog.md` (rascunho do líder).
Estado atual do repositório (evidência: `find . -path ./.git -prune -o -type f -print` lista apenas `CLAUDE.md`, `PLAN.md`, `.claude/**` e `docs/demandas/**`; `git log` informa "does not have any commits yet"): não há código de aplicação. **O comportamento atual de todos os itens é "inexistente".**

Convenções deste documento:
- RN-n e CA-n são numerados localmente em cada item.
- "Seção X do PLAN" refere-se aos títulos de `PLAN.md`; "invariante Y" refere-se a "Architectural invariants" de `CLAUDE.md`.
- "Gate padrão" = testes unitários de toda lógica pura nova e testes de integração com PostgreSQL real de toda persistência nova (sem mocks de banco), todos passando; build, lint e typecheck passando; cobertura global de linhas ≥ 90% no comando oficial (Vitest + `@vitest/coverage-v8`, unidade + integração somadas); veredito APROVADO do tester.
- 403 e 404 (G-1): em CAs de ações do servidor, significam o erro tipado `AcessoNegado`/`NaoEncontrado` devolvido por `defineAcao` (E0.5); em rotas HTTP e páginas, o status HTTP correspondente.
- "Recusado" (G-3): a ação devolve erro tipado (`ErroValidacao{campo}` ou `ErroNegocio{codigo}`) com mensagem pt-BR, e nenhuma linha é criada ou alterada no banco (verificado no teste).
- Isolamento por item (G-4): todo item que cria leitura ou mutação de entidade de tenant inclui teste de integração A×B (o gestor de A recebe `NaoEncontrado` para ID de B, e o registro de B fica inalterado).
- Capacidade declarada (G-2): toda ação mutável declara uma capacidade (`configurar`, `agendar`, `cancelar`, `assinatura`, `lgpd`) em `defineAcao` (E0.5); o bloqueio por estado do salão é verificado em E6.4.
- "Pendência de decisão do usuário" marca os itens afetados por P1 e P2 (R4); até a resposta, vale a recomendação do arquiteto.

# Revisão da decomposição

## R1. Rastreabilidade dos 11 critérios de aceite do PLAN

| CA do PLAN | Resumo | Itens que o atendem |
|---|---|---|
| 1 | Dois salões se cadastram e configuram serviços e profissionais sem acessar dados um do outro | E1.1, E1.2, E0.5, E2.1, E2.2, E9.2 |
| 2 | Cliente reserva vários serviços consecutivos com um profissional, sem conta, pelo celular; só profissionais que fazem todos os serviços | E0.8, E3.1, E3.2, E4.1, E4.3, E4.4 |
| 3 | Horários fora da jornada, bloqueados ou ocupados não aparecem; concorrência e encaixes sem sobreposição | E0.4, E2.3, E2.4, E2.5, E3.1, E3.2, E3.4, E3.5, E4.2 |
| 4 | Gestor e profissional veem só agendas permitidas e alteram/cancelam/marcam status dos atendimentos autorizados | E1.2, E3.3, E3.4, E3.5 |
| 5 | Teste grátis, cobrança, falha, carência, suspensão, regularização e cancelamento com adaptador local; webhooks repetidos sem efeito duplicado | E0.6, E6.1, E6.2, E6.3, E6.4, E6.5, E6.6 |
| 6 | Confirmação, remarcação e cancelamento por WhatsApp registrados, enviados pelo adaptador e repetíveis sem duplicar | E0.6, E0.7, E3.2, E3.5, E4.3, E7.1, E7.2, E7.3, E8.3 |
| 7 | Cliente anonimizada some das buscas e o histórico continua íntegro | E3.3, E5.1, E5.2 |
| 8 | Recuperação de senha e convite de profissional com e-mail simulado | E0.6, E1.3, E1.4 |
| 9 | Super admin estende teste, suspende/reativa salão e reenvia mensagem, tudo no log de auditoria (consulta em E8.3) | E0.4, E1.5, E6.6, E8.1, E8.2, E8.3 |
| 10 | Página pública com rate limit, limite de reservas por número e captcha simulado | E0.6, E4.2, E4.4 |
| 11 | Projeto inicia pelo README, com testes de isolamento, concorrência, permissões e eventos de assinatura | E0.1, E0.2, E0.3, E0.4, E0.5, E1.2, E3.2, E6.2, E6.3, E9.3, E9.4 |

Requisitos da seção "Interface" do PLAN com "estados claros": horário indisponível (E4.1), encaixe fora da jornada (E3.4), assinatura pendente ou suspensa (E6.4, E6.5), salão indisponível na página pública (E4.1 com a política de E6.4), erro de pagamento (E6.5), falha de envio de mensagem (E7.3). Slug antigo com redirecionamento ("Perfis e acesso"): E2.5 (histórico) e E4.1 (redirecionamento permanente 301/308).

## R2. Lacunas encontradas no rascunho

1. **Adaptador real do Mercado Pago sem item.** E0.6 mistura portas e adaptadores reais; E7.2 já isola o real do WhatsApp, mas o real do MP (assinatura recorrente, consulta de preapproval, extensão de teste) não tem item próprio.
2. **Exibição de falha de envio de mensagem** (estado exigido na seção "Interface") não está em nenhum item.
3. **Super admin: assinatura/eventos e fila/reenvio** estão espremidos em E8.2 junto com gestão de salões.
4. **Agenda da equipe (E3.3)** concentra visualização, reserva manual, encaixe, remarcação, cancelamento, status e permissões: grande demais para uma sub-issue.
5. Comportamento do salão com **assinatura ainda não autorizada** (conta provisória) e após **cancelamento da assinatura** não estava descrito; tratado em E6.3/E6.4 com suposições (R4).
6. Gatilhos de mensagem para **reservas manuais** e para **remarcações sucessivas** da mesma reserva não estavam descritos; tratados em E7.1 (R4).
7. Layout do painel (navegação por perfil) não tinha dono; incluído em E0.8.

Nenhum item do rascunho está fora do escopo do PLAN. Conferido contra "Fora da primeira versão": nenhum item cria caixa, estoque, comissões, relatórios financeiros, fidelidade, pagamentos de clientes, apps nativos, agendamento por WhatsApp, lembretes, promoções, conta de cliente, múltiplos gestores ou preço/duração por profissional.

## R3. Mudanças propostas

| Chave | Mudança | Motivo |
|---|---|---|
| E0.6 | Reescopado: portas, adaptadores simulados, seleção por env e adaptadores reais de **e-mail e Turnstile** (clientes HTTP simples). Reais do MP e WhatsApp ficam em E6.6 e E7.2 | Lacuna 1; separar integrações complexas |
| E3.3 | Retitulado: **visualização da agenda da equipe com permissões** (gestor × profissional) | Lacuna 4 |
| E3.4 | **Novo:** reserva manual e encaixe com aviso explícito | Divisão de E3.3 |
| E3.5 | **Novo:** remarcação, cancelamento e marcação de status | Divisão de E3.3 |
| E6.6 | **Novo:** adaptador real do Mercado Pago (Assinaturas) | Lacuna 1 |
| E7.3 | **Novo:** situação de envio de mensagens visível à equipe | Lacuna 2 |
| E8.2 | Reescopado: salões (lista, ver/editar, suspender/reativar, estender teste) | Lacuna 3 |
| E8.3 | **Novo:** assinatura e eventos do MP, fila de mensagens e reenvio no painel | Divisão de E8.2 |
| E0.8 | Inclui o layout/navegação do painel por perfil | Lacuna 7 |

Nenhum item foi removido. E4.4 (E2E) foi mantido como item próprio porque comprova o CA 2 do PLAN de ponta a ponta; isso não dispensa testes unitários/integração dentro de E4.1–E4.3.

## R4. Dúvidas

### Bloqueantes
Nenhuma para a publicação do backlog.

### Pendências de decisão do usuário (registradas nos itens afetados)
- **P1 — Chave de idempotência das mensagens (S3; E0.4, E3.5, E7.1).** O `CLAUDE.md` diz "reserva + tipo de evento". Opções: (a) **recomendada pelo arquiteto:** `reserva + tipo + revisão`, uma mensagem por remarcação legítima, sem duplicar repetições; o líder atualiza a frase do invariante após aprovação; (b) literal: no máximo uma mensagem de remarcação por reserva; (c) literal com sobrescrita da mesma linha, perdendo o histórico por remarcação.
- **P2 — Extensão de teste no Mercado Pago real (S12; E6.6, E8.2).** Opções: (a) **recomendada pelo arquiteto:** o adaptador real tenta adiar a próxima cobrança e falha explicitamente se o provedor não refletir; o simulado cumpre o CA 9 do PLAN; validar em sandbox quando houver credenciais; (b) no modo real, só a data local muda e o MP pode cobrar durante o "teste estendido" (não recomendada); (c) desabilitar a extensão no modo real até confirmação do MP.

### Não bloqueantes (suposições adotadas)
- **S1 — Status que ocupam horário (aprovada):** lista explícita `status IN ('confirmado','concluido','nao_compareceu')` sobre `tstzrange(inicio, ocupado_ate, '[)')`, com `ocupado_ate = fim + intervalo vigente` (snapshot); só `cancelado` libera o horário. (E0.4, E3.1, E3.2)
- **S2 — Transições de status:** `confirmado → cancelado` só antes do fim do atendimento; `confirmado → concluido | nao_compareceu` só após o início; troca entre `concluido` e `nao_compareceu` permitida para correção; `cancelado` é final. (E3.5)
- **S3 — Idempotência de remarcações sucessivas (aprovada tecnicamente; pendente do usuário como P1):** chave `reserva:tipo:revisao`, com `UNIQUE(reserva_id, tipo, revisao)`; a revisão incrementa na transação da remarcação; pendentes obsoletas viram `substituida`. Confirmação usa revisão 0; cancelamento, a revisão vigente. (E0.4, E3.5, E7.1)
- **S4 — Reservas manuais da equipe** também geram confirmação, desde que a cliente tenha consentimento registrado de qualquer origem (página pública ou declarado pela equipe, origem `equipe`). Sem consentimento, o registro fica `nao_enviada`. (E3.4, E7.1)
- **S5 — Regras de horário para a equipe:** antecedência mínima e janela máxima valem só para a página pública; a equipe não pode criar reserva com início no passado. (E3.4)
- **S6 — Limite de 3 reservas futuras por número** vale só para a página pública. (E4.2)
- **S7 — Valores iniciais de rate limit:** 10 requisições/min por IP e 5 tentativas de reserva/hora por número, configuráveis por env; IP lido de `X-Forwarded-For` só com `TRUSTED_PROXY_HOPS > 0`. (E4.2)
- **S8 — Telefone:** aceito número brasileiro com DDD válido e 10 ou 11 dígitos nacionais (com ou sem `+55`, máscara, espaços); armazenado como E.164 (`+55DDDNNNNNNNN[N]`). Números de outros países são rejeitados. (E5.1)
- **S9 — Conta provisória (antes da autorização do MP):** o gestor pode entrar e configurar o salão, mas a página pública mostra "agendamento indisponível" até o teste começar. (E6.1, E6.4)
- **S10 — Fim do período após cancelamento da assinatura:** o salão passa ao estado `encerrada`, com o mesmo comportamento somente leitura do suspenso. O gestor pode iniciar nova assinatura pela tela de assinatura, sem novo período grátis. (E6.3, E6.5)
- **S11 — Suspensão manual** pelo super admin é um indicador independente do estado da assinatura; o salão fica efetivamente suspenso se qualquer um dos dois indicar suspensão. Reativar manualmente remove só o indicador manual. (E6.3, E8.2)
- **S12 — Extensão de teste (aprovada como comportamento; pendente do usuário como P2):** atualiza a data local de fim do teste e, via `adiarProximaCobranca`, adia a primeira cobrança no MP. Se o provedor não refletir o adiamento, o adaptador falha com `ProvedorNaoSuportaAdiamento` e a ação não é concluída. A documentação do MP não confirma o suporte. (E6.6, E8.2)
- **S13 — Operações por estado do salão (aprovada com complemento):** modelo de capacidades (`configurar`, `agendar`, `cancelar`, `assinatura`, `lgpd`) com a tabela de E6.4. Suspenso/encerrado: só leitura, `cancelar` (com aviso à cliente), `assinatura` e `lgpd`. Complemento: em `pendente`, `configurar` é permitido e `agendar` (público e equipe) é bloqueado. (E6.4)
- **S14 — Auditoria do super admin** registra login (sucesso e falha de TOTP) e toda mutação; leituras não são auditadas. (E8.1)
- **S15 — Validade de tokens:** confirmação de e-mail 24 h, recuperação de senha 1 h, convite 7 dias; todos de uso único e armazenados como hash. Senha mínima de 8 caracteres. Redefinir senha encerra as demais sessões do usuário. (E1.1, E1.3, E1.4)
- **S16 — Desativação de profissional com reservas futuras confirmadas** é recusada, com a lista dessas reservas, até que sejam remarcadas ou canceladas. Profissional desativado perde o acesso. Desativar serviço não afeta reservas existentes. (E2.1, E2.2)
- **S17 — Gestor sem e-mail confirmado** não consegue entrar; a tela oferece reenviar o link. (E1.1)
- **S18 — TOTP do super admin:** no primeiro login, o cadastro do TOTP (QR code) é obrigatório antes de acessar o painel. (E1.5)

## R5. Revisão 1 (pareceres da squad)
Fontes, por precedência: `design.md` §14 e §11, `dba.md` §2, `devops.md` §2, `dev.md` §2. Principais decisões incorporadas: outbox de mensagens com estado `enviando` (E3.2, E3.5, E7.1); `salao_slug` com o redirecionamento movido de E2.5 para E4.1; tela de auditoria movida de E8.1 para E8.3; `garantirSuperAdmin()` (E1.5, E9.2); constraint `tstzrange(inicio, ocupado_ate, '[)')` com lista explícita de status (E0.4); `chave_requisicao` única por salão (E3.2); modelo de capacidades por estado do salão (E0.5, E6.4); convenções G-1 e G-2. Chaves e quantidade de itens inalteradas (55).

---

### ITEM E0 | Fundação técnica do projeto

#### Objetivo
Entregar a base executável (projeto, banco, fila, adaptadores, CI e UI base) sobre a qual todas as funcionalidades da v1 serão construídas.

#### Origem e contexto
PLAN.md, "Direção técnica"; CLAUDE.md, "Required stack", "Architectural invariants" e "Comandos e cobertura". Comportamento atual: inexistente.

#### Escopo
E0.1, E0.2, E0.3, E0.4, E0.5, E0.6, E0.7, E0.8.

#### Critérios de aceite
- [ ] CA-1: Dado que todas as sub-issues E0.1–E0.8 estão concluídas e aprovadas pelo tester, quando o épico é revisado, então ele pode ser fechado.
- [ ] CA-2: Dado um clone limpo, quando se seguem os passos de execução local, então app, worker e postgres sobem e a suíte de testes roda com o gate de cobertura (base do CA 11 do PLAN).

### ITEM E0.1 | Criar o projeto Next.js + TypeScript com lint, typecheck, Vitest com cobertura e Playwright

#### Objetivo
Ter o esqueleto do projeto com os comandos oficiais de desenvolvimento, qualidade e testes.

#### Origem e contexto
PLAN.md, "Direção técnica" e "Testes"; CLAUDE.md, "Comandos e cobertura" (Vitest + `@vitest/coverage-v8`, `coverage.thresholds.lines = 90`, escopo `src/**`). Atual: inexistente; não há `package.json`.

#### Escopo
- Projeto Next.js (App Router) com TypeScript estrito, ESLint (`lint` = `eslint .`) e script de typecheck.
- `.nvmrc` com Node 24, fonte única da versão para local, Docker e CI.
- Vitest com projetos `unit` e `integration` e cobertura v8; ambiente de teste de componente (`@testing-library/react` + `jsdom`) para `*.test.tsx`; `passWithNoTests` no projeto `integration`.
- Playwright só com Chromium, viewport 375×812 com `isMobile` e `hasTouch`, e `webServer` com `next start`.
- Atualização do bloco "Comandos e cobertura" do `CLAUDE.md` com os comandos reais.

#### Fora do escopo
Docker e bootstrap do Prisma (E0.2), CI (E0.3), esquema de dados (E0.4).

#### Especificação
Decidido:
- RN-1: `vitest.config.ts` com `coverage.provider = 'v8'`, `coverage.include = ['src/**']`, `coverage.thresholds.lines = 90`.
- RN-2: exclusões permitidas só para código gerado (cliente Prisma), arquivos só de tipos, configuração e migrações, cada uma com comentário justificando.
- RN-3: Playwright fora da métrica de cobertura.
- RN-4: gerenciador npm (`npm ci`); scripts mínimos `dev`, `build`, `lint`, `typecheck`, `test`, teste único, `test:coverage`, `test:e2e`.
- RN-5: `test:coverage` roda `unit` e `integration` numa única execução do Vitest, com um só relatório e um só limiar.
Arquivos prováveis: `package.json`, `.nvmrc`, `tsconfig.json`, `next.config.*`, `eslint.config.*`, `vitest.config.ts`, `playwright.config.ts`, `src/app/**`, `CLAUDE.md`.

#### Critérios de aceite
- [ ] CA-1: Dado um clone limpo, quando se executa `npm ci` e depois o build, então ambos terminam com código 0.
- [ ] CA-2: Dado o projeto, quando se executam lint e typecheck, então ambos terminam com código 0.
- [ ] CA-3: Dado uma alteração descartável (não commitada) que reduz a cobertura global de linhas para menos de 90% (ex.: arquivo novo em `src/` sem teste), quando se executa `npm run test:coverage`, então ele termina com código diferente de 0 e informa o limiar de linhas.
- [ ] CA-4: Dado um teste E2E de fumaça, quando se executa o comando E2E, então o Playwright abre a página inicial no Chromium em 375×812 e o teste passa.
- [ ] CA-5: Dado o `CLAUDE.md`, quando se lê o bloco de comandos, então ele lista os comandos reais de instalar, dev, build, lint, typecheck, teste, teste único, cobertura e E2E.
- [ ] CA-6: Dado testes nos projetos `unit` e `integration`, quando se executa `npm run test:coverage`, então é gerado um único relatório de cobertura que soma os dois.
- [ ] CA-7: Dado um `*.test.tsx` que renderiza `src/app/page.tsx`, quando `npm run test:coverage` roda, então o teste passa e o arquivo aparece coberto no relatório único.

#### Validação
Teste unitário de fumaça; verificação manual da falha do gate (CA-3) registrada pelo tester com a saída do comando. Gate padrão.

### ITEM E0.2 | Subir app, worker e PostgreSQL com docker-compose e documentar variáveis em .env.example

#### Objetivo
Permitir rodar o produto localmente com um único comando de containers.

#### Origem e contexto
PLAN.md, "Direção técnica" (docker-compose com aplicação, worker e PostgreSQL; arquivo de exemplo de variáveis); CLAUDE.md, "Required stack". Atual: inexistente.

#### Escopo
- `Dockerfile` multi-stage para app e worker: imagem não root, `TZ=UTC`, worker compilado para JS.
- `docker-compose.yml`: `postgres` (volume, healthcheck, porta `${POSTGRES_PORT:-5432}`); `app` com healthcheck em `GET /api/health` (executa `SELECT 1`); `worker` com `depends_on: app: service_healthy`; entrypoints com `exec` e `init: true`; o compose sobrescreve `DATABASE_URL`.
- Bootstrap do Prisma: `prisma/schema.prisma` só com datasource e generator, `prisma.config.ts`, script `db:generate`; cliente gerado excluído, com comentário, de lint, cobertura e `.gitignore`.
- Só o `app` executa `prisma migrate deploy` no entrypoint.
- Stub de `src/worker/main.ts` (substituído em E0.7).
- Validação do env com zod em `src/server/env.ts`.
- `.env.example` com todas as variáveis, incluindo `APP_URL`, `TEST_DATABASE_URL` e os seletores de adaptadores.
- README inicial com "Executar com Docker" e "Testes" (completado em E9.3).

#### Fora do escopo
Publicação em VPS, proxy reverso e TLS (PLAN: "A publicação na internet fica para uma etapa posterior").

#### Especificação
Decidido:
- RN-1: por padrão, `.env.example` seleciona os adaptadores simulados; o projeto sobe sem nenhuma credencial real.
- RN-2: o app aguarda o postgres saudável e aplica as migrações; o worker só sobe com o app saudável; reiniciar sem apagar o volume não gera erro de migração.
- RN-3: nenhum segredo real versionado.
- RN-4: a major do PostgreSQL é a mesma no compose e na CI (E0.3).
Casos limite: porta 5432 ocupada no host (`POSTGRES_PORT`); variável obrigatória ausente (falha nomeando a variável, E0.6).

#### Critérios de aceite
- [ ] CA-1: Dado `cp .env.example .env` sem alterações, quando se executa `docker compose up -d --wait`, então o comando termina com código 0, `docker compose ps` mostra postgres e app `healthy` e worker `running`, e `curl -fsS localhost:3000/` responde 200.
- [ ] CA-2: Dado o compose em execução, quando se inspecionam os containers, então o worker roda em container separado do app e nenhum dos dois roda como root.
- [ ] CA-3: Dado `src/server/env.ts` e `.env.example`, quando o teste unitário compara as chaves dos dois, então elas coincidem.
- [ ] CA-4: Dado o compose em execução, quando se executa `docker compose down` e depois `docker compose up -d --wait` (sem `-v`), então tudo sobe sem erro de migração.
- [ ] CA-5: Dado o postgres indisponível, quando se chama `GET /api/health`, então responde 503.

#### Validação
Testes unitários de CA-3 e do endpoint de health; verificação manual objetiva dos demais pelo tester, com comandos e saídas registrados. Gate padrão.

### ITEM E0.3 | Configurar CI no GitHub Actions com lint, typecheck, build, testes com Postgres, gate de cobertura e E2E

#### Objetivo
Garantir que todo push/PR execute os mesmos gates da definição de pronto.

#### Origem e contexto
CLAUDE.md, "Comandos e cobertura" ("A CI executa o mesmo comando") e "Definição de pronto". Atual: inexistente.

#### Escopo
Workflow `.github/workflows/ci.yml` com os gates na ordem `npm ci → prisma generate → typecheck → lint → build → migrate deploy → test:coverage → e2e`, PostgreSQL de serviço (mesma major do compose, com `btree_gist` do contrib), e job de `docker build` (sem push) com `docker compose config`.

#### Fora do escopo
Push de imagem, deploy e alteração dos workflows do Claude já existentes no repositório. A proteção da branch `main` exigindo os checks é passo manual do dono do repositório (pendência registrada, não CA).

#### Especificação
Decidido:
- RN-1: a CI usa o mesmo comando de cobertura do desenvolvimento local; falha abaixo de 90% de linhas.
- RN-2: os testes de integração rodam contra PostgreSQL real com as migrações aplicadas; nenhum mock de banco.
- RN-3: a CI usa adaptadores simulados; nenhum segredo real é necessário.
- RN-4: `node-version-file: .nvmrc`; `permissions: contents: read`; `concurrency` cancela execuções antigas do mesmo ref.
- RN-5: relatório de cobertura e traces do Playwright publicados como artefatos.

#### Critérios de aceite
- [ ] CA-1: Dado um PR, quando o workflow roda, então lint, typecheck, build, testes com cobertura e E2E são executados e o PR mostra o status de cada um.
- [ ] CA-2: Dado um PR descartável (fechado sem merge) que reduz a cobertura de linhas abaixo de 90%, quando o workflow roda, então o job de testes falha.
- [ ] CA-3: Dado um teste de integração mínimo (conexão e `SELECT 1`), quando o workflow roda, então ele se conecta ao serviço postgres da CI e passa.
- [ ] CA-4: Dado um PR, quando o workflow roda, então o job de `docker build` e `docker compose config` termina verde sem publicar imagem.

#### Validação
Execução real do workflow em PRs de teste, com links dos runs registrados pelo tester.

### ITEM E0.4 | Criar o esquema Prisma base e a migração SQL da constraint anti-sobreposição

#### Objetivo
Modelar as entidades centrais e garantir, no banco, que nenhuma reserva ativa se sobreponha a outra do mesmo profissional.

#### Origem e contexto
PLAN.md, "Direção técnica" (entidades sugeridas) e "Agenda e atendimento" (constraint de exclusão); CLAUDE.md, invariante "No double booking is guaranteed by the database". Atual: inexistente.

#### Escopo
- Esquema Prisma: salão (com `suspenso_manual_em`), `salao_slug` (tabela única de slugs atuais e históricos), usuário, `sessao`, profissional, serviço, vínculo serviço-profissional, jornada, bloqueio (profissional e salão), cliente, consentimento, reserva (com `revisao`, `ocupado_ate`, `chave_requisicao`), item da reserva, assinatura, `assinatura_pagamento`, `assinatura_transicao`, evento de webhook, mensagem e tentativas, `email_log`, `rate_limit_janela`, convite, tokens, auditoria.
- Migrações SQL brutas: `CREATE EXTENSION btree_gist`; constraint `reserva_sem_sobreposicao`; exclusion `int4range` da jornada; CHECKs; índices parciais; trigger append-only.

#### Fora do escopo
Tabelas para funcionalidades de "Fora da primeira versão".

#### Especificação
Decidido:
- RN-1: instantes em `timestamptz` (UTC); jornada em hora local (`dia_semana`, `inicio_min`, `fim_min`) com exclusion `int4range` por profissional e dia; o salão guarda o fuso IANA (padrão `America/Sao_Paulo`).
- RN-2: `salao_id` não nulo em toda entidade de tenant, `UNIQUE(salao_id, id)` e FKs compostas `(salao_id, <fk>)` entre entidades do mesmo salão; índices escopados começam por `salao_id`.
- RN-3: todas as FKs com `ON DELETE RESTRICT` explícito (nenhum CASCADE ou SET NULL); IDs `uuid` e `criado_em` com default no banco.
- RN-4: profissional e serviço têm `ativo` (soft delete); não há exclusão física via aplicação.
- RN-5: item da reserva guarda snapshot de preço (centavos, `int`) e duração (minutos).
- RN-6: cliente com `UNIQUE(salao_id, telefone_e164)` e NULLS DISTINCT (anonimizadas coexistem); CHECK de anonimização coerente (nome e telefone nulos com `anonimizada_em` preenchido, ou nenhum nulo sem ele); CHECK de formato E.164 BR.
- RN-7: `EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, ocupado_ate, '[)') WITH &&) WHERE (status IN ('confirmado','concluido','nao_compareceu'))`, com nome `reserva_sem_sobreposicao`; `ocupado_ate = fim + intervalo vigente` gravado na reserva (snapshot); `CHECK (fim > inicio AND ocupado_ate >= fim)`. Com intervalo 0, reservas adjacentes não conflitam.
- RN-8: mensagem com `UNIQUE(reserva_id, tipo, revisao)` (ver P1); webhook com `UNIQUE(provedor, chave_dedupe) WHERE origem_valida`; `assinatura_pagamento.pagamento_id UNIQUE`; assinatura com `UNIQUE(salao_id) WHERE estado <> 'encerrada'`; reserva com `UNIQUE(salao_id, chave_requisicao)`.
- RN-9: `salao_slug` com `UNIQUE(slug)` global, `UNIQUE(salao_id) WHERE atual` e CHECK de formato.
- RN-10: `auditoria` e `assinatura_transicao` são somente inserção, garantido por trigger que rejeita UPDATE e DELETE (por linha) e TRUNCATE (por instrução).
- RN-11: `prisma migrate dev` não pode gerar drift sobre os objetos criados em SQL bruto.
Pendência de decisão do usuário: P1 (chave `reserva:tipo:revisao`, que diverge do texto literal do CLAUDE.md). Até a resposta, vale a recomendação do arquiteto (opção a).
Impacto em dados: alto; parecer do DBA em `docs/demandas/D-001/dba.md`.

#### Critérios de aceite
- [ ] CA-1: Dado um banco vazio, quando se aplicam as migrações, então existem as tabelas, a extensão `btree_gist`, a constraint `reserva_sem_sobreposicao`, os CHECKs e os triggers; e, em seguida, `prisma migrate dev` não gera migração nem acusa drift.
- [ ] CA-2: Dado um profissional com reserva `confirmado` de 10:00 a 11:00 UTC com `ocupado_ate` 11:00, quando se insere via SQL outra reserva ativa do mesmo profissional de 10:30 a 11:30, então o banco rejeita com SQLSTATE `23P01` e constraint `reserva_sem_sobreposicao`.
- [ ] CA-3: Dado o mesmo cenário com a primeira reserva `cancelado`, quando se insere a segunda, então a inserção é aceita.
- [ ] CA-4: Dado intervalo 0 e reservas de 10:00–11:00 e 11:00–12:00 do mesmo profissional, quando ambas são inseridas, então ambas são aceitas.
- [ ] CA-5: Dado dois profissionais distintos, quando se inserem reservas sobrepostas, uma para cada, então ambas são aceitas.
- [ ] CA-6: Dado intervalo de 15 min e reserva 10:00–10:30 (`ocupado_ate` 10:45), quando se insere 10:30–11:00 do mesmo profissional, então é rejeitada.
- [ ] CA-7: Dado uma reserva `cancelado` 10:00–11:00 e outra `confirmado` 10:30–11:30 do mesmo profissional, quando se faz UPDATE da primeira para `confirmado`, então o banco rejeita com `23P01`.
- [ ] CA-8: Dado uma reserva com `fim <= inicio` ou `ocupado_ate < fim`, quando inserida, então o CHECK rejeita.
- [ ] CA-9: Dado `salao_id` do salão A e `profissional_id`, `cliente_id` ou `servico_id` do salão B, quando se insere a reserva ou o item via SQL, então a FK composta rejeita.
- [ ] CA-10: Dado o mesmo telefone em salões diferentes, quando inserido, então é aceito; no mesmo salão, o segundo é rejeitado; duas clientes anonimizadas no mesmo salão são aceitas; cliente com `anonimizada_em` preenchido e nome não nulo é rejeitada pelo CHECK.
- [ ] CA-11: Dado um slug atual ou histórico de um salão, quando outro salão insere o mesmo slug em `salao_slug`, então é rejeitado; um salão com dois slugs atuais é rejeitado.
- [ ] CA-12: Dado um registro em `auditoria`, quando se executa UPDATE, DELETE ou TRUNCATE via SQL, então o banco rejeita; INSERT é aceito.
- [ ] CA-13: Dado dois intervalos de jornada sobrepostos do mesmo profissional no mesmo dia, quando inseridos via SQL, então o segundo é rejeitado.

#### Validação
Testes de integração com PostgreSQL real, por conexão direta (`pg` ou Prisma) contra o banco do compose ou da CI; migram para o harness compartilhado quando E0.5 existir. Gate padrão.

### ITEM E0.5 | Aplicar escopo de salão no servidor e montar a infraestrutura de testes de integração

#### Objetivo
Garantir que toda consulta e mutação autenticada seja limitada ao salão do usuário, com testes de integração reutilizáveis contra PostgreSQL real.

#### Origem e contexto
PLAN.md, "Perfis e acesso" (escopo do salão no servidor); CLAUDE.md, invariante "Tenant isolation is enforced on the server". Atual: inexistente.

#### Escopo
- `defineAcao({ papeis, capacidade }, handler)`: valida sessão e papel, monta o `TenantContext` e consulta uma política de operação por capacidade, plugável (padrão: permite; a política real é de E6.4). Mantém o registro de todas as ações.
- Repositórios que exigem `TenantContext` e aplicam `salao_id` em toda leitura e escrita; regra de lint `no-restricted-imports` que impede importar o cliente Prisma fora dos repositórios.
- Infra de testes: banco por worker do Vitest criado a partir de um template database (`CREATE DATABASE … TEMPLATE`), incluindo o schema `pgboss`; reset entre arquivos por recriação a partir do template (sem TRUNCATE); pool de conexões ≥ número de requisições paralelas dos testes de concorrência; fábricas para dois salões completos; criação de contexto autenticado.

#### Especificação
Decidido:
- RN-1: o `salao_id` vem sempre da sessão no servidor, nunca de parâmetro do cliente.
- RN-2: acesso a recurso de outro salão responde como inexistente (`NaoEncontrado`/404), sem revelar existência.
- RN-3: rotas públicas resolvem o salão pelo slug e expõem apenas dados públicos (serviços e profissionais ativos, horários).
- RN-4: o super admin usa um contexto próprio, explícito e auditado (E8.1).
- RN-5: toda ação mutável declara uma capacidade: `configurar`, `agendar`, `cancelar`, `assinatura` ou `lgpd`.

#### Critérios de aceite
- [ ] CA-1: Dado o gestor do salão A autenticado, quando ele requisita por ID um serviço, profissional, cliente ou agendamento do salão B, então recebe 404 e nenhum dado de B.
- [ ] CA-2: Dado o gestor do salão A, quando tenta alterar um recurso do salão B informando o ID, então a alteração não ocorre e o registro de B permanece igual no banco.
- [ ] CA-3: Dado um teste de integração novo, quando ele usa as fábricas, então obtém dois salões completos sem SQL manual.
- [ ] CA-4: Dado o registro de ações, quando o teste percorre todas as ações mutáveis, então cada uma declara capacidade; uma ação sem capacidade faz o teste falhar.
- [ ] CA-5: Dado um arquivo fora dos repositórios que importa o cliente Prisma, quando se executa o lint, então ele falha.
- [ ] CA-6: Dado dois arquivos de teste de concorrência executando em workers paralelos, quando rodam juntos, então nenhum vê dados do outro e ambos passam de forma determinística em 10 execuções seguidas.

#### Validação
Testes de integração com PostgreSQL real (isolamento é exigido pelo CA 11 do PLAN). Gate padrão.

### ITEM E0.6 | Definir portas e adaptadores de integração com simulados e reais de e-mail e Turnstile

#### Objetivo
Isolar integrações externas da lógica de negócio, permitindo rodar e testar tudo localmente.

#### Origem e contexto
PLAN.md, "Direção técnica" (adaptadores reais e simulados por env); CLAUDE.md, invariante "Integrations sit behind adapters". Atual: inexistente.

#### Escopo
- Portas: e-mail; WhatsApp; Mercado Pago (`criarAssinatura`, `consultarAssinatura`, `consultarPagamento`, `cancelarAssinatura`, `adiarProximaCobranca`, `validarWebhook`); Turnstile.
- Adaptadores simulados dos quatro.
- Seleção por env: `EMAIL_ADAPTER`, `WHATSAPP_ADAPTER`, `MP_ADAPTER`, `TURNSTILE_ADAPTER` (`simulado|real`, padrão `simulado`).
- Adaptadores reais de e-mail transacional via SMTP (`nodemailer`) e de Turnstile (`siteverify`).
- `src/config/plano.ts`: fonte única do preço (7900 centavos) e dos dias de teste (30).
- Passo `check-env` de validação na inicialização.

#### Fora do escopo
Adaptador real do Mercado Pago (E6.6) e do WhatsApp (E7.2).

#### Especificação
Decidido:
- RN-1: a lógica de negócio depende só das portas; importar SDK/HTTP de provedor fora dos adaptadores é proibido.
- RN-2: o e-mail simulado grava destinatário, assunto e corpo em `email_log`, consultável por testes e pela pessoa desenvolvedora (links de confirmação, convite e recuperação).
- RN-3: Turnstile simulado aceita um token fixo documentado e rejeita os demais; o real valida no `siteverify` da Cloudflare. A chave pública é lida no servidor em runtime (`TURNSTILE_SITE_KEY`) e passada ao widget por props, sem variável `NEXT_PUBLIC_*`.
- RN-4: MP simulado permite disparar eventos (autorização, cobrança aprovada, falha, cancelamento) e registra adiamentos; WhatsApp simulado permite forçar falha.
- RN-5: a validação do env roda na inicialização (`check-env` no entrypoint do app e no início do worker), nunca no import nem no `next build`; modo real sem credencial obrigatória faz o processo sair com código diferente de 0 nomeando a variável.
- RN-6: a URL base de cada adaptador real é injetável pelo construtor (testes usam servidor HTTP local de stub).
- RN-7: nenhum adaptador registra token ou senha em log.
- RN-8: variáveis no `.env.example`: os 4 seletores; `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM`; `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`. Credenciais reais vazias.

#### Critérios de aceite
- [ ] CA-1: Dado o `.env` padrão, quando o app inicia, então os quatro adaptadores ativos são os simulados.
- [ ] CA-2: Dado `EMAIL_ADAPTER=real` sem `SMTP_HOST`, quando o container `app` (ou o `worker`) inicia, então sai com código diferente de 0 e o log contém `SMTP_HOST`.
- [ ] CA-3: Dado o adaptador de e-mail simulado, quando o sistema envia um e-mail, então o teste lê em `email_log` destinatário, assunto e link do corpo.
- [ ] CA-4: Dado o Turnstile simulado, quando se valida o token documentado, então retorna válido; com outro token, retorna inválido.
- [ ] CA-5: Dado o adaptador real do Turnstile apontado para um servidor HTTP local de stub, quando o `siteverify` retorna `success:false`, então a porta retorna inválido.
- [ ] CA-6: Dado um ambiente sem `.env`, quando se executa o build, então ele termina com código 0 (a validação não roda no build).
- [ ] CA-7: Dado `src/config/plano.ts`, quando lido pelo teste, então expõe preço 7900 centavos e 30 dias de teste.

#### Validação
Testes unitários de cada adaptador e da seleção por env; para os reais, servidor HTTP local de stub (não é mock de banco). Gate padrão.

### ITEM E0.7 | Executar a fila de mensagens com pg-boss em um worker separado

#### Objetivo
Ter um processo worker independente que consome jobs do PostgreSQL com novas tentativas e backoff.

#### Origem e contexto
PLAN.md, "Mensagens pelo WhatsApp" (fila no PostgreSQL processada por worker separado); CLAUDE.md, "Required stack". Atual: inexistente.

#### Escopo
`src/worker/main.ts` (substitui o stub de E0.2): registro de handlers, retry por env (`QUEUE_RETRY_LIMIT`, `QUEUE_RETRY_DELAY_SECONDS`, `QUEUE_RETRY_BACKOFF`), encerramento gracioso, jobs agendados (usados por E6.3, E7.1 e E4.2), heartbeat em log, job de exemplo.

#### Especificação
Decidido:
- RN-1: o worker é um processo separado do servidor Next.js e usa o mesmo banco; o pg-boss fica no schema `pgboss`, separado do `public` gerido pelo Prisma.
- RN-2: número de tentativas, atraso e backoff configuráveis por env; os testes usam atraso de cerca de 1 s.
- RN-3: falha de um job não derruba o worker.
- RN-4: SIGTERM chama `stop({ graceful: true })` com timeout (25 s) menor que o `stop_grace_period` do compose (30 s).
- RN-5: versão do pg-boss fixada; payload do job contém apenas IDs (sem dados pessoais); as tabelas do pg-boss não são fonte do histórico de tentativas.
- RN-6: o worker não expõe HTTP nem healthcheck; o heartbeat em log basta na v1.
Sugestão (não decidida): padrões de 5 tentativas e atraso inicial de 30 s.

#### Critérios de aceite
- [ ] CA-1: Dado um job enfileirado pelo app, quando o worker está em execução, então o handler correspondente o processa.
- [ ] CA-2: Dado um handler que falha nas 2 primeiras execuções, quando o job é processado, então ocorrem 3 tentativas com intervalos crescentes e o job termina concluído.
- [ ] CA-3: Dado um handler que sempre falha, quando se esgotam as tentativas, então o job fica em estado de falha consultável e o worker continua processando outros jobs.
- [ ] CA-4: Dado um job longo em andamento, quando o worker recebe SIGTERM (`docker compose stop worker` ou sinal no processo filho em teste de integração), então o job conclui e o processo sai com código 0 antes de 30 s.

#### Validação
Testes de integração com PostgreSQL real (pg-boss real, processo filho para CA-4). Gate padrão.

### ITEM E0.8 | Criar a base visual e de navegação: tema terroso, tipografia, layout responsivo e acessível

#### Objetivo
Oferecer componentes e layout reutilizáveis que atendam à direção visual, pt-BR/BRL, responsividade e uso por teclado.

#### Origem e contexto
PLAN.md, "Interface" (direção visual, celular e computador, teclado, marca Agenda Beleza); CLAUDE.md, "UI conventions". Atual: inexistente.

#### Escopo
- Tokens de cor (terrosos e nude, sem rosa genérico), tipografia serifada nos títulos e sem serifa no corpo, espaçamentos.
- Componentes base: botão, campo, select, checkbox, diálogo de confirmação, alerta/estado vazio/estado de erro, tabela/lista, calendário/grade de horários.
- Layouts: público, painel (navegação por perfil: gestor, profissional) e super admin.
- Utilitários de formatação pt-BR: moeda BRL, data/hora no fuso do salão.

#### Fora do escopo
Copiar visual ou textos de AppBarber/AppBeleza.

#### Especificação
Decidido:
- RN-1: todos os componentes interativos são alcançáveis e operáveis por teclado, com foco visível.
- RN-2: diálogos prendem o foco e fecham com Esc.
- RN-3: contraste de texto mínimo WCAG AA.
- RN-4: valores monetários exibidos como `R$ 79,00`; datas em `dd/mm/aaaa` e horas em `HH:mm`.
Sugestão (não decidida): checagem automática de acessibilidade com axe no Playwright.

#### Critérios de aceite
- [ ] CA-1: Dado o valor 7900 centavos, quando formatado, então exibe `R$ 79,00`.
- [ ] CA-2: Dado um instante UTC `2026-03-10T13:00:00Z` e fuso `America/Sao_Paulo`, quando formatado, então exibe `10/03/2026 10:00`.
- [ ] CA-3: Dado o layout do painel em viewport de 375 px, quando a página carrega, então não há rolagem horizontal e a navegação é acessível por um botão de menu.
- [ ] CA-4: Dado um diálogo de confirmação aberto, quando se navega só com Tab/Shift+Tab/Enter/Esc, então é possível confirmar, cancelar e o foco volta ao elemento de origem.

#### Validação
Testes unitários dos formatadores e componentes; teste Playwright de teclado e viewport móvel. Gate padrão.

---

### ITEM E1 | Autenticação, cadastro e perfis de acesso

#### Objetivo
Permitir que gestor, profissional e super admin acessem o sistema com segurança e permissões por perfil.

#### Origem e contexto
PLAN.md, "Perfis e acesso" e "Interface" (cadastro, confirmação de e-mail, login, recuperação, convite); CLAUDE.md, "Roles". Atual: inexistente.

#### Escopo
E1.1, E1.2, E1.3, E1.4, E1.5.

#### Critérios de aceite
- [ ] CA-1: Dado que E1.1–E1.5 estão concluídas e aprovadas, quando o épico é revisado, então ele pode ser fechado.
- [ ] CA-2: Dado as sub-issues fechadas, quando o tester reexecuta o CA 8 do PLAN e a parte de cadastro do CA 1 do PLAN, então ambos têm evidência aprovada em `testes.md`.

### ITEM E1.1 | Cadastrar gestor e salão com confirmação de e-mail e slug gerado

#### Objetivo
Permitir que um novo gestor crie sua conta e seu salão e confirme o e-mail.

#### Origem e contexto
PLAN.md, "Perfis e acesso" (gestor cria o salão; confirma o e-mail; slug gerado do nome). Atual: inexistente.

#### Escopo
Formulário de cadastro (nome do gestor, e-mail, senha, nome do salão), criação de usuário gestor + salão (conta provisória, S9), geração do slug, envio e consumo do link de confirmação, reenvio do link.

#### Fora do escopo
Fluxo de assinatura (E6.1); edição do slug (E2.5).

#### Especificação
Decidido:
- RN-1: e-mail único entre usuários da plataforma; um gestor por salão.
- RN-2: slug derivado do nome: minúsculas, sem acentos, espaços → hífen, apenas `[a-z0-9-]`; em colisão, sufixo numérico (`-2`, `-3`…).
- RN-3: salão nasce com fuso `America/Sao_Paulo`, grade 15 min, antecedência 2 h, janela 60 dias, intervalo 0 min.
- RN-4: senha armazenada com hash forte (ex.: argon2/bcrypt); mínimo 8 caracteres (S15).
- RN-5: gestor sem e-mail confirmado não entra (S17); link de confirmação expira em 24 h e é de uso único.
- RN-6: validação no servidor de todos os campos; mensagens em pt-BR.
Casos limite: nome do salão só com caracteres especiais (gera slug de fallback não vazio); e-mail com maiúsculas (normalizar para minúsculas); duplo envio do formulário (não cria dois salões).

#### Critérios de aceite
- [ ] CA-1: Dado dados válidos, quando o formulário é enviado, então são criados um usuário gestor não confirmado e um salão com slug derivado do nome e configurações padrão, e o e-mail simulado contém um link de confirmação.
- [ ] CA-2: Dado um salão "Studio Bela" existente, quando outro salão "Studio Bela" é cadastrado, então seu slug é `studio-bela-2`.
- [ ] CA-3: Dado um e-mail já cadastrado, quando se envia o formulário, então o cadastro é recusado com mensagem e nenhum salão é criado.
- [ ] CA-4: Dado um link de confirmação válido, quando é aberto, então o usuário fica confirmado; quando reaberto, então é recusado como já utilizado.
- [ ] CA-5: Dado um link com mais de 24 h, quando é aberto, então é recusado e a tela oferece reenvio.
- [ ] CA-6: Dado um gestor não confirmado, quando tenta entrar com senha correta, então o acesso é negado com opção de reenviar o link.

#### Validação
Unitários (slug, validações); integração com PostgreSQL real (criação, unicidade, tokens); E2E opcional do cadastro. Gate padrão.

### ITEM E1.2 | Implementar login, sessão em cookie httpOnly e permissões por perfil

#### Objetivo
Autenticar a equipe com e-mail e senha e aplicar permissões por perfil em todas as rotas e ações do servidor.

#### Origem e contexto
PLAN.md, "Perfis e acesso" (sessões seguras com cookie httpOnly e permissões por perfil); CLAUDE.md, "Roles". Atual: inexistente.

#### Escopo
Login, logout, sessão persistida no servidor, cookie httpOnly/Secure/SameSite, middleware de autorização por papel (gestor, profissional, super admin), redirecionamento pós-login por perfil.

#### Especificação
Decidido:
- RN-1: cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção; sessão revogável no servidor.
- RN-2: mensagem de erro de login não revela se o e-mail existe.
- RN-3: matriz de permissões: gestor administra todo o salão; profissional só a própria agenda, os próprios bloqueios e as próprias reservas; super admin só o painel da plataforma (exige TOTP, E1.5).
- RN-4: profissional desativado não entra e suas sessões são revogadas (S16).
- RN-5: toda ação do servidor verifica papel e escopo via `defineAcao` (E0.5), não apenas a UI.

#### Critérios de aceite
- [ ] CA-1: Dado credenciais válidas de gestor, quando faz login, então recebe cookie httpOnly e é redirecionado para `/painel`.
- [ ] CA-2: Dado senha errada ou e-mail inexistente, quando tenta entrar, então recebe a mesma mensagem genérica.
- [ ] CA-3: Dado um profissional autenticado, quando chama diretamente uma ação registrada com `papeis: ['gestor']` (ação de teste do registro de E0.5), então recebe 403 e nada é alterado.
- [ ] CA-4: Dado um usuário que fez logout, quando reutiliza o cookie antigo, então é tratado como não autenticado.
- [ ] CA-5: Dado um profissional com `ativo = false` (fábrica), quando tenta entrar, então o acesso é negado.

#### Validação
Unitários (matriz de permissões); integração com PostgreSQL real (sessões, 403 por papel — exigido pelo CA 11 do PLAN). Gate padrão.

### ITEM E1.3 | Recuperar senha por e-mail transacional

#### Objetivo
Permitir que gestor e profissional redefinam a senha com um link enviado por e-mail.

#### Origem e contexto
PLAN.md, "Perfis e acesso" e CA 8 do PLAN. Atual: inexistente.

#### Escopo
Solicitação por e-mail, token de uso único, tela de nova senha, invalidação das demais sessões.

#### Fora do escopo
Recuperação de senha do super admin (gerido por seed/env, E1.5).

#### Especificação
Decidido:
- RN-1: a resposta à solicitação é a mesma para e-mail existente ou não.
- RN-2: token aleatório, armazenado como hash, expira em 1 h, uso único; nova solicitação invalida tokens anteriores (S15).
- RN-3: ao redefinir, todas as sessões do usuário são encerradas.

#### Critérios de aceite
- [ ] CA-1: Dado um e-mail cadastrado, quando solicita recuperação, então o e-mail simulado recebe um link com token.
- [ ] CA-2: Dado um e-mail não cadastrado, quando solicita recuperação, então a tela mostra a mesma mensagem e nenhum e-mail é enviado.
- [ ] CA-3: Dado um link válido, quando define nova senha, então consegue entrar com a nova senha e não com a antiga, e sessões anteriores são invalidadas.
- [ ] CA-4: Dado um link usado, expirado ou substituído por solicitação posterior, quando é aberto, então é recusado.

#### Validação
Integração com PostgreSQL real e e-mail simulado; unitários de expiração. Gate padrão.

### ITEM E1.4 | Convidar profissional por e-mail e aceitar o convite definindo a senha

#### Objetivo
Permitir que o gestor dê acesso a um profissional por convite.

#### Origem e contexto
PLAN.md, "Perfis e acesso" (profissional recebe convite e define a própria senha) e CA 8 do PLAN. Atual: inexistente.

#### Escopo
Envio de convite a partir do cadastro do profissional (E2.2), reenvio, tela de aceite com definição de senha, vínculo do usuário ao profissional e ao salão.

#### Especificação
Decidido:
- RN-1: só o gestor convida, e apenas para profissionais do próprio salão.
- RN-2: convite expira em 7 dias, uso único; reenviar invalida o anterior (S15).
- RN-3: e-mail já usado por outro usuário da plataforma não pode ser convidado (um usuário pertence a um salão).
- RN-4: no aceite, o e-mail é considerado confirmado.
- RN-5: capacidade declarada: `configurar`; o bloqueio por estado do salão é verificado em E6.4.

#### Critérios de aceite
- [ ] CA-1: Dado um profissional cadastrado com e-mail, quando o gestor envia o convite, então o e-mail simulado recebe o link.
- [ ] CA-2: Dado um link válido, quando o profissional define a senha, então consegue entrar e vê apenas a própria agenda.
- [ ] CA-3: Dado um link reutilizado, expirado ou substituído, quando é aberto, então é recusado.
- [ ] CA-4: Dado um e-mail que já pertence a usuário de outro salão, quando o gestor tenta convidar, então o convite é recusado com mensagem.

#### Validação
Integração com PostgreSQL real e e-mail simulado. Gate padrão.

### ITEM E1.5 | Criar super admin por seed ou variável de ambiente com login protegido por TOTP

#### Objetivo
Permitir o acesso da operação da plataforma com segundo fator obrigatório.

#### Origem e contexto
PLAN.md, "Perfis e acesso" (super admin por seed/env, exige TOTP); CLAUDE.md, invariante "Super admin". Atual: inexistente.

#### Escopo
Função idempotente `garantirSuperAdmin()`, a partir de `SUPERADMIN_EMAIL` e `SUPERADMIN_PASSWORD`, usada pelo script `npm run superadmin:criar` e pelo seed (E9.2); cadastro obrigatório de TOTP no primeiro login (S18); login em duas etapas; sessão separada do painel do salão.

#### Fora do escopo
Cadastro público de super admin (proibido); tela de consulta da auditoria (E8.3).

#### Especificação
Decidido:
- RN-1: não há rota pública que crie super admin.
- RN-2: sem TOTP válido, nenhuma rota do painel administrativo é acessível.
- RN-3: segredo TOTP gravado cifrado (AES-256-GCM, chave por env), nunca em claro; códigos RFC 6238 de 30 s com tolerância de ±1 janela.
- RN-4: login e falhas de TOTP são auditados (S14); a falha é registrada em transação própria, confirmada mesmo com o acesso recusado (E8.1).
- RN-5: executar `garantirSuperAdmin()` duas vezes não duplica a conta.

#### Critérios de aceite
- [ ] CA-1: Dado `SUPERADMIN_EMAIL` e `SUPERADMIN_PASSWORD`, quando `garantirSuperAdmin()` (ou `npm run superadmin:criar`) roda duas vezes, então existe exatamente uma conta super admin.
- [ ] CA-2: Dado o primeiro login com senha correta, quando o super admin ainda não tem TOTP, então é obrigado a cadastrá-lo antes de ver o painel.
- [ ] CA-3: Dado senha correta e código TOTP inválido, quando tenta entrar, então o acesso é negado e a falha é registrada na auditoria.
- [ ] CA-4: Dado uma sessão de gestor, quando acessa uma rota do painel administrativo, então recebe 403.
- [ ] CA-5: Dado um super admin com TOTP cadastrado, quando se lê a coluna do segredo no banco, então o valor não é o segredo em claro.

#### Validação
Unitários (TOTP com relógio controlado, cifragem); integração com PostgreSQL real. Gate padrão.

---

### ITEM E2 | Configuração do salão

#### Objetivo
Permitir ao gestor cadastrar serviços, profissionais, jornadas, bloqueios e regras do salão.

#### Origem e contexto
PLAN.md, "Serviços e profissionais", "Agenda e atendimento" e "Interface" (painel do gestor). Atual: inexistente.

#### Escopo
E2.1, E2.2, E2.3, E2.4, E2.5.

#### Critérios de aceite
- [ ] CA-1: Dado que E2.1–E2.5 estão concluídas e aprovadas, quando o épico é revisado, então ele pode ser fechado.
- [ ] CA-2: Dado as sub-issues fechadas, quando o tester reexecuta a parte de configuração do CA 1 do PLAN, então ela tem evidência aprovada em `testes.md`.

### ITEM E2.1 | Gerenciar serviços e definir quais profissionais executam cada um

#### Objetivo
Permitir ao gestor manter o catálogo de serviços e seus profissionais habilitados.

#### Origem e contexto
PLAN.md, "Serviços e profissionais"; CLAUDE.md, invariante "Soft deletes". Atual: inexistente.

#### Escopo
Listar, criar, editar, ativar/desativar serviço; vincular/desvincular profissionais; função de leitura de serviços públicos do salão (ativos e com ao menos um profissional ativo vinculado), usada por E3.1 e E4.1.

#### Fora do escopo
Preço ou duração por profissional (fora da v1).

#### Especificação
Decidido:
- RN-1: campos: nome (obrigatório), preço fixo em BRL (≥ 0, centavos), duração em minutos (> 0, múltiplo de 5), situação.
- RN-2: serviço nunca é apagado; desativar o remove da página pública e de novas reservas, sem alterar reservas existentes (snapshot).
- RN-3: alterar preço/duração não altera itens de reservas já criadas.
- RN-4: vínculo só com profissionais do mesmo salão.
- RN-5: capacidade declarada: `configurar`; o bloqueio por estado do salão é verificado em E6.4.
- RN-6: nome duplicado no salão é permitido, sem aviso.
Casos limite: serviço sem profissional vinculado não aparece na página pública.

#### Critérios de aceite
- [ ] CA-1: Dado o gestor, quando cria o serviço "Corte" a R$ 80,00 com 45 min, então ele aparece na lista como ativo.
- [ ] CA-2: Dado um serviço de R$ 80,00 com itens de reserva criados pela fábrica, quando o gestor altera o preço para R$ 90,00, então esses itens mantêm `preco_centavos = 8000` no banco.
- [ ] CA-3: Dado um serviço ativo, quando o gestor o desativa, então ele continua no banco com `ativo = false`, a função de leitura de serviços públicos do salão não o retorna e os itens de reserva existentes ficam inalterados.
- [ ] CA-4: Dado o gestor do salão A, quando tenta vincular um profissional do salão B, então a operação é recusada.
- [ ] CA-5: Dado duração 0 ou preço negativo, quando salva, então o servidor recusa com mensagem de validação.
- [ ] CA-6: Dado um profissional ativo do mesmo salão (fábrica), quando o gestor o vincula ao serviço, então o vínculo é persistido e aparece na edição do serviço.

#### Validação
Unitários (validação); integração com PostgreSQL real (soft delete, snapshot, isolamento conforme G-4). Gate padrão.

### ITEM E2.2 | Gerenciar profissionais, incluindo o gestor que também atende, com desativação

#### Objetivo
Permitir ao gestor cadastrar e desativar profissionais e criar um perfil de profissional vinculado a si mesmo.

#### Origem e contexto
PLAN.md, "Perfis e acesso" (gestor pode ter perfil de profissional) e "Serviços e profissionais". Atual: inexistente.

#### Escopo
Listar, criar (nome, e-mail opcional para convite), editar, ativar/desativar; ação "eu também atendo" para o gestor; ponto de entrada do convite (E1.4).

#### Especificação
Decidido:
- RN-1: profissional nunca é apagado; desativado some da página pública e não recebe novas reservas.
- RN-2: desativação recusada se houver reservas futuras confirmadas, listando-as (S16).
- RN-3: o gestor pode ter no máximo um perfil de profissional vinculado; esse perfil não exige convite.
- RN-4: capacidade declarada: `configurar`; o bloqueio por estado do salão é verificado em E6.4.

#### Critérios de aceite
- [ ] CA-1: Dado o gestor, quando cria o profissional "Ana", então ele aparece ativo na lista e `profissional.ativo = true` no banco.
- [ ] CA-2: Dado o gestor, quando ativa "eu também atendo", então existe um profissional ligado ao usuário gestor com agenda própria; uma segunda ativação não cria outro.
- [ ] CA-3: Dado um profissional com reserva futura confirmada, quando o gestor tenta desativá-lo, então a operação é recusada e a reserva é listada.
- [ ] CA-4: Dado um profissional sem reservas futuras, quando é desativado, então permanece no banco com `ativo = false`, a consulta de profissionais ativos do salão não o retorna e as reservas passadas da fábrica continuam com o `profissional_id` dele.

#### Validação
Integração com PostgreSQL real, com isolamento conforme G-4. Gate padrão.

### ITEM E2.3 | Definir a jornada semanal de cada profissional com pausas

#### Objetivo
Permitir ao gestor configurar os horários de trabalho que alimentam a disponibilidade.

#### Origem e contexto
PLAN.md, "Agenda e atendimento" (jornada semanal com pausas; só o gestor edita). Atual: inexistente.

#### Escopo
Para cada dia da semana: trabalha ou não, um ou mais intervalos de trabalho (pausas = lacunas entre intervalos), em horário local do salão.

#### Especificação
Decidido:
- RN-1: só o gestor edita jornadas; o profissional apenas visualiza a própria.
- RN-2: intervalos no mesmo dia não se sobrepõem (garantido também pela exclusion `int4range` de E0.4) e início < fim; horários em minutos do dia (`inicio_min`, `fim_min`) no fuso do salão.
- RN-3: alterar a jornada não altera reservas existentes, que podem ficar fora da jornada.
- RN-4: capacidade declarada: `configurar`; o bloqueio por estado do salão é verificado em E6.4.
- RN-5: a jornada não atravessa a meia-noite (`fim ≤ 24:00`); o servidor recusa o contrário.
Casos limite: dia sem intervalos = folga.

#### Critérios de aceite
- [ ] CA-1: Dado o gestor, quando salva segunda 09:00–12:00 e 13:00–18:00, então a jornada fica registrada com a pausa 12:00–13:00.
- [ ] CA-2: Dado intervalos sobrepostos (09:00–12:00 e 11:00–14:00), quando salva, então o servidor recusa.
- [ ] CA-3: Dado um profissional autenticado, quando tenta alterar a própria jornada, então recebe 403.
- [ ] CA-4: Dado um intervalo 22:00–02:00, quando o gestor salva, então o servidor recusa.

#### Validação
Unitários (validação de intervalos); integração com PostgreSQL real (permissão; isolamento conforme G-4). Gate padrão.

### ITEM E2.4 | Registrar bloqueios do profissional e do salão inteiro

#### Objetivo
Permitir marcar períodos indisponíveis (folga, compromisso, feriado, reforma).

#### Origem e contexto
PLAN.md, "Agenda e atendimento" (bloqueios por profissional e para o salão) e "Perfis e acesso" (profissional gerencia apenas os próprios bloqueios). Atual: inexistente.

#### Escopo
CRUD de bloqueios de profissional (gestor: qualquer profissional; profissional: só os próprios) e de salão (só gestor), com início/fim e motivo opcional; exibição na agenda.

#### Especificação
Decidido:
- RN-1: bloqueio é um intervalo `[inicio, fim)` em UTC, informado no fuso do salão; permite dia inteiro.
- RN-2: criar bloqueio sobre reservas existentes é permitido, com aviso listando-as; as reservas não são alteradas.
- RN-3: bloqueios são removíveis (não fazem parte do histórico protegido por soft delete).
- RN-4: capacidade declarada: `configurar`; o bloqueio por estado do salão é verificado em E6.4.

#### Critérios de aceite
- [ ] CA-1: Dado um profissional autenticado, quando cria um bloqueio na própria agenda, então ele é salvo.
- [ ] CA-2: Dado um profissional autenticado, quando tenta criar ou remover bloqueio de outro profissional ou do salão, então recebe 403.
- [ ] CA-3: Dado um salão em `America/Sao_Paulo`, quando o gestor cria um bloqueio de salão de dia inteiro para 25/12, então ele é persistido como `[25/12 03:00Z, 26/12 03:00Z)` (00:00–24:00 local); o efeito na disponibilidade é verificado em E3.1 (CA-5).
- [ ] CA-4: Dado uma reserva existente (fábrica), quando um bloqueio a cobre, então a resposta da ação contém a lista com o ID da reserva afetada e a reserva continua `confirmado`.

#### Validação
Unitários da conversão de dia inteiro local para UTC (incluindo fuso com horário de verão); integração com PostgreSQL real (permissões; isolamento conforme G-4). Gate padrão.

### ITEM E2.5 | Configurar fuso, regras de horário e troca de slug com histórico

#### Objetivo
Permitir ao gestor ajustar os dados e as regras operacionais do salão.

#### Origem e contexto
PLAN.md, "Perfis e acesso" (slug editável, antigo redireciona), "Agenda e atendimento" (regras configuráveis) e "Interface" (configurações do salão); CLAUDE.md, invariante "Time". Atual: inexistente.

#### Escopo
Editar nome, fuso (IANA), grade (min), antecedência mínima (h), janela máxima (dias), intervalo entre atendimentos (min) e slug; troca de slug registrando o anterior como histórico em `salao_slug`.

#### Fora do escopo
Resposta HTTP de redirecionamento do slug antigo (E4.1); efeito da grade na disponibilidade (E3.1).

#### Especificação
Decidido:
- RN-1: os padrões do PLAN (15 min, 2 h, 60 dias, 0 min) são obrigatórios na criação do salão.
- RN-2: fuso deve ser IANA válido.
- RN-3: slug segue as regras de E1.1 e é único entre slugs atuais e históricos de todos os salões (`salao_slug`).
- RN-4: ao trocar o slug, o anterior vira histórico do mesmo salão e o novo passa a ser o atual, na mesma transação; o redirecionamento permanente (301 ou 308) é servido por E4.1.
- RN-5: mudanças valem para disponibilidades futuras; reservas existentes não mudam (o `ocupado_ate` já gravado é mantido).
- RN-6: capacidade declarada: `configurar`; o bloqueio por estado do salão é verificado em E6.4.
Sugestão (não decidida): grade ∈ {5, 10, 15, 20, 30, 60}; antecedência 0–72 h; janela 1–365 dias; intervalo 0–120 min.

#### Critérios de aceite
- [ ] CA-1: Dado o salão com slug `studio-bela`, quando o gestor muda para `bela-studio`, então `salao_slug` registra `studio-bela` como histórico do salão e `bela-studio` como atual.
- [ ] CA-2: Dado um slug já usado (atual ou histórico) por outro salão, quando o gestor tenta usá-lo, então é recusado.
- [ ] CA-3: Dado fuso inválido "America/Inexistente", quando salva, então o servidor recusa.
- [ ] CA-4: Dado um valor de grade fora da lista permitida, quando salva, então o servidor recusa; dado 30 min, então o valor é persistido e exibido na tela.

#### Validação
Unitários (validação); integração com PostgreSQL real (slugs; isolamento conforme G-4). Gate padrão.

---

### ITEM E3 | Agenda e reservas

#### Objetivo
Calcular disponibilidade e permitir criar, visualizar e operar reservas sem sobreposição.

#### Origem e contexto
PLAN.md, "Agenda e atendimento"; CLAUDE.md, invariantes "No double booking", "Time" e "Multi-service bookings". Atual: inexistente.

#### Escopo
E3.1, E3.2, E3.3, E3.4, E3.5.

#### Critérios de aceite
- [ ] CA-1: Dado que E3.1–E3.5 estão concluídas e aprovadas, quando o épico é revisado, então ele pode ser fechado.
- [ ] CA-2: Dado as sub-issues fechadas, quando o tester reexecuta os CAs 3 e 4 do PLAN, então todos têm evidência aprovada em `testes.md`.

### ITEM E3.1 | Calcular horários disponíveis para um ou mais serviços em sequência

#### Objetivo
Oferecer apenas horários em que todo o atendimento, executado em sequência por um profissional, cabe na disponibilidade.

#### Origem e contexto
PLAN.md, "Agenda e atendimento" (fluxo público, regras de horário, fuso); CLAUDE.md, invariantes "Time" e "Multi-service bookings". Atual: inexistente.

#### Escopo
Função de domínio pura + consulta ao banco que, dado salão, serviços, profissional (ou lista de elegíveis) e data, devolve inícios disponíveis; listagem de profissionais elegíveis.

#### Fora do escopo
Bloqueio por estado do salão (salão não operável): tratado em E6.4.

#### Especificação
Decidido:
- RN-1: profissionais elegíveis = ativos e vinculados a **todos** os serviços escolhidos (todos ativos).
- RN-2: duração total = soma das durações; preço total = soma dos preços.
- RN-3: um início é válido se `[inicio, fim)` está inteiramente dentro de um intervalo de jornada do dia e não intersecta bloqueio do profissional nem do salão; e se `[inicio, fim + intervalo vigente)` não intersecta `[inicio, ocupado_ate)` de nenhuma reserva com status ativo do profissional (mesma expressão e predicado da constraint de E0.4).
- RN-4: inícios alinhados à grade a partir da meia-noite local do salão.
- RN-5: início ≥ agora + antecedência mínima; data local do início ≤ hoje local + janela máxima.
- RN-6: cálculo no fuso do salão; entradas e saídas em UTC com rótulo local.
Casos limite: virada de dia (atendimento que terminaria após o fim da jornada não é oferecido); fuso com horário de verão (testar com `America/New_York` na data de transição); antecedência atravessando a meia-noite; serviço ou profissional inativo.
Componentes prováveis: `src/domain/availability/**`, `src/server/disponibilidade/**`.

#### Critérios de aceite
- [ ] CA-1: Dado serviços A (30 min) e B (45 min), Ana faz A e B e Bia faz só A, quando se listam profissionais para A+B, então só Ana aparece.
- [ ] CA-2: Dado Ana com jornada 09:00–12:00, grade 15, intervalo 0, sem reservas, quando se pede A+B (75 min), então o último horário oferecido é 10:45.
- [ ] CA-3: Dado intervalo vigente de 15 min e uma reserva de Ana 10:00–10:30 criada com intervalo 15 (`ocupado_ate` 10:45), quando se pede A (30 min), então 09:30 e 10:30 não são oferecidos e 09:15 e 10:45 são; dado intervalo vigente 0 e a reserva criada com intervalo 0 (`ocupado_ate` 10:30), então 09:30 e 10:30 são oferecidos.
- [ ] CA-4: Dado uma pausa 12:00–13:00, quando se pede um serviço de 60 min, então 11:30 não é oferecido.
- [ ] CA-5: Dado bloqueio de salão no dia, quando se consulta esse dia, então não há horários.
- [ ] CA-6: Dado agora = 08:00 local e antecedência 2 h, quando se consulta hoje, então o primeiro horário é ≥ 10:00.
- [ ] CA-7: Dado janela de 60 dias, quando se consulta o 61º dia local, então não há horários.
- [ ] CA-8: Dado fuso `America/Sao_Paulo` e jornada 09:00, quando o horário é calculado, então o instante UTC retornado é 12:00Z.
- [ ] CA-9: Dado a grade do salão alterada para 30 min, quando se consulta a disponibilidade, então todos os inícios oferecidos são múltiplos de 30 min no horário local.

#### Validação
Unitários extensivos da função pura (relógio controlado); integração com PostgreSQL real para a consulta; `EXPLAIN (ANALYZE)` da consulta de ocupação com volume gerado por fábrica no teste (ex.: 2 salões × 10 profissionais × 5.000 reservas) anexado à issue, sem `Seq Scan` em `reserva`. Gate padrão.

### ITEM E3.2 | Criar reserva com snapshot dos itens e tratar conflito da constraint, com teste de concorrência

#### Objetivo
Persistir a reserva de forma atômica e garantir que tentativas simultâneas não gerem sobreposição.

#### Origem e contexto
PLAN.md, "Agenda e atendimento" (reserva confirmada, snapshot, proteção no banco); CLAUDE.md, invariantes "No double booking" e "Multi-service bookings"; CA 3 e CA 11 do PLAN. Atual: inexistente.

#### Escopo
Serviço de domínio "criar reserva" reutilizado pela página pública (E4.1) e pela equipe (E3.4): revalida a disponibilidade no servidor, faz upsert da cliente (E5.1), cria a reserva `confirmado` e os itens em sequência numa transação, grava `ocupado_ate` e `chave_requisicao`, traduz a violação de exclusão em erro de negócio e grava o registro da mensagem de confirmação na mesma transação (outbox, E7.1), com envio à fila após o commit.

#### Especificação
Decidido:
- RN-1: itens com ordem, início/fim individuais consecutivos, snapshot de preço e duração.
- RN-2: a reserva cobre `[inicio do primeiro item, fim do último)`; `ocupado_ate = fim + intervalo vigente`.
- RN-3: violação identificada por SQLSTATE `23P01` e nome `reserva_sem_sobreposicao` vira o erro tipado `HorarioIndisponivel`, que expõe a causa (`23P01`) e é exibido como "horário indisponível", sem reserva parcial.
- RN-4: a reserva nasce `confirmado`.
- RN-5 (outbox): o registro `pendente` da mensagem é gravado na transação da reserva; o job vai à fila só após o commit; falha ao enfileirar não desfaz a reserva e a reconciliação de E7.1 reenfileira.
- RN-6: a chave de requisição (UUID gerado ao renderizar o formulário) é gravada em `reserva.chave_requisicao`, com `UNIQUE(salao_id, chave_requisicao)`; `23505` nessa chave devolve a reserva existente.
- RN-7: transação `READ COMMITTED` na ordem: upsert da cliente → contagem de reservas futuras (E4.2, só público) → reserva → itens → consentimento → registro da mensagem.
- RN-8: capacidade declarada: `agendar`; o bloqueio por estado do salão é verificado em E6.4.

#### Critérios de aceite
- [ ] CA-1: Dado A (R$ 50, 30 min) e B (R$ 70, 45 min) às 10:00, quando a reserva é criada, então há 1 reserva 10:00–11:15 e 2 itens (10:00–10:30 e 10:30–11:15) com os snapshots.
- [ ] CA-2: Dado 10 requisições simultâneas com o mesmo telefone, para o mesmo profissional e horário, com pool de conexões ≥ 10, quando executadas em paralelo contra o PostgreSQL real, então exatamente 1 reserva é criada e as 9 recusas são `HorarioIndisponivel`.
- [ ] CA-2b: Dado 10 requisições simultâneas com 10 telefones distintos, para o mesmo profissional e horário, com pool de conexões ≥ 10, quando executadas em paralelo, então exatamente 1 reserva é criada, há 9 erros `HorarioIndisponivel` com causa `23P01` e nenhuma cliente, item ou mensagem de reserva parcial persiste.
- [ ] CA-3: Dado um horário que deixou de ser válido entre a consulta e o envio, quando a reserva é enviada, então é recusada pelo servidor.
- [ ] CA-4: Dado a fila indisponível no momento do commit, quando a reserva é criada, então ela permanece salva, existe a mensagem `pendente` registrada e ela é enviada depois pela reconciliação.
- [ ] CA-5: Dado dois envios com a mesma chave de requisição, quando processados, então existe 1 reserva e ambos recebem a mesma reserva.
- [ ] CA-6: Dado uma reserva que falha por `23P01` com nome de cliente diferente do cadastrado, quando a transação é desfeita, então o nome da cliente não muda e não existe item nem mensagem órfãos.

#### Validação
Unitários (montagem dos itens); integração com PostgreSQL real, incluindo o teste de concorrência (CA 11 do PLAN). Gate padrão.

### ITEM E3.3 | Exibir a agenda da equipe com permissões de gestor e profissional

#### Objetivo
Mostrar a agenda por dia/semana com reservas, bloqueios e jornadas, respeitando quem pode ver o quê.

#### Origem e contexto
PLAN.md, "Perfis e acesso", "Interface" (agenda do gestor; agenda individual do profissional) e CA 4 do PLAN. Atual: inexistente.

#### Escopo
Visão diária e semanal; filtro por profissional (gestor); detalhe da reserva (cliente, itens, preços snapshot, status); exibição de bloqueios e fora da jornada.

#### Especificação
Decidido:
- RN-1: gestor vê as agendas de todos os profissionais do salão; profissional vê só a própria.
- RN-2: horários exibidos no fuso do salão.
- RN-3: cliente anonimizada aparece como "cliente removida" (E5.2).
- RN-4: leitura disponível também com salão suspenso.

#### Critérios de aceite
- [ ] CA-1: Dado um profissional autenticado, quando abre a agenda ou requisita por ID uma reserva de outro profissional, então não vê a reserva (404).
- [ ] CA-2: Dado o gestor, quando filtra por "Ana", então vê só as reservas e bloqueios de Ana.
- [ ] CA-3: Dado uma reserva às 12:00Z num salão em `America/Sao_Paulo`, quando exibida, então aparece às 09:00.
- [ ] CA-4: Dado viewport de celular, quando a agenda carrega, então é navegável por teclado e sem rolagem horizontal da página.
- [ ] CA-5: Dado uma reserva de cliente anonimizada (fábrica), quando a agenda e o detalhe são abertos, então mostram "cliente removida", os itens e os preços snapshot.
- [ ] CA-6: Dado uma reserva passada de um profissional desativado (fábrica), quando o gestor abre a agenda daquele dia, então a reserva aparece com o nome do profissional.

#### Validação
Integração com PostgreSQL real (permissões, CA 11 do PLAN; isolamento conforme G-4); teste de componente para CA-3, CA-5 e CA-6; Playwright para CA-4. Gate padrão.

### ITEM E3.4 | Criar reserva manual e encaixe pela equipe com aviso explícito

#### Objetivo
Permitir que gestor e profissional registrem reservas, inclusive fora da jornada ou sobre bloqueio, sem nunca sobrepor outra reserva.

#### Origem e contexto
PLAN.md, "Perfis e acesso" (profissional cria reservas manuais na própria agenda) e "Agenda e atendimento" (encaixe com aviso explícito); CLAUDE.md, invariante "No double booking" (vale para encaixes); CA 3 do PLAN. Atual: inexistente.

#### Escopo
Rota própria `/painel/agenda/nova` com formulário de reserva manual (serviços, profissional, início, cliente por telefone/nome, consentimento declarado S4) usando E3.2; detecção de encaixe e diálogo de confirmação; estado visual de encaixe.

#### Especificação
Decidido:
- RN-1: gestor cria para qualquer profissional; profissional só para si.
- RN-2: se o atendimento sair da jornada ou intersectar bloqueio, o servidor exige `confirmarEncaixe = true`; sem isso responde com o motivo.
- RN-3: sobreposição com reserva ativa é sempre recusada, com ou sem encaixe (constraint).
- RN-4: antecedência e janela não se aplicam; início no passado é recusado (S5).
- RN-5: limite de 3 reservas futuras por número não se aplica (S6).
- RN-6: profissional deve executar todos os serviços escolhidos.
- RN-7: capacidade declarada: `agendar`; o bloqueio por estado do salão é verificado em E6.4.

#### Critérios de aceite
- [ ] CA-1: Dado Ana com jornada até 18:00, quando o gestor cria reserva às 18:30 sem confirmar encaixe, então o servidor recusa informando "fora da jornada".
- [ ] CA-2: Dado o mesmo pedido com confirmação de encaixe, quando enviado, então a reserva é criada `confirmado`.
- [ ] CA-3: Dado uma reserva de Ana 18:30–19:00, quando a equipe tenta encaixe 18:45–19:15 com confirmação, então é recusado por sobreposição.
- [ ] CA-4: Dado um profissional autenticado, quando tenta criar reserva para outro profissional, então recebe 403.
- [ ] CA-5: Dado uma cliente sem consentimento e a equipe sem declarar consentimento, quando a reserva é criada, então nenhum envio ocorre e o registro de mensagem fica `nao_enviada`.
- [ ] CA-6: Dado um bloqueio de Ana 14:00–15:00, quando a equipe cria reserva às 14:00 sem confirmar encaixe, então o servidor recusa informando "horário bloqueado"; com confirmação, a reserva é criada.

#### Validação
Integração com PostgreSQL real (encaixe, sobreposição, permissões); unitários da detecção de encaixe. Gate padrão.

### ITEM E3.5 | Remarcar, cancelar e marcar status de atendimentos

#### Objetivo
Permitir que a equipe altere reservas e registre o resultado do atendimento.

#### Origem e contexto
PLAN.md, "Agenda e atendimento" (status; equipe remarca e cancela) e "Mensagens pelo WhatsApp" (remarcação e cancelamento disparam mensagem); CA 4 do PLAN. Atual: inexistente.

#### Escopo
Remarcar (data, horário, profissional e/ou serviços), cancelar, marcar `concluido` / `nao_compareceu`; gravação dos registros de mensagem na mesma transação (outbox, E7.1).

#### Especificação
Decidido:
- RN-1: permissões: gestor em qualquer reserva do salão; profissional só nas próprias, e remarca apenas dentro da própria agenda.
- RN-2: a remarcação é um UPDATE da mesma reserva numa única transação: revalida no servidor com as regras de E3.4 (encaixe com aviso; sem sobreposição), regrava os itens, mantém o snapshot dos serviços inalterados, grava snapshot novo só para serviços adicionados e recalcula `ocupado_ate` com o intervalo vigente.
- RN-3: a remarcação incrementa `revisao` e grava o registro `remarcacao` dessa revisão na mesma transação, substituindo pendentes obsoletas (E7.1); o cancelamento grava o registro `cancelamento`.
- RN-4: transições de status conforme S2.
- RN-5: capacidades declaradas: remarcar = `agendar`; cancelar e marcar status = `cancelar`. O bloqueio por estado do salão é verificado em E6.4.
- RN-6: cliente anonimizada: operações permitidas, sem mensagem.
Pendência de decisão do usuário: P1 (uma mensagem por remarcação, via chave `reserva:tipo:revisao`). Até a resposta, vale a recomendação do arquiteto (opção a).

#### Critérios de aceite
- [ ] CA-1: Dado uma reserva confirmada de Ana, quando o gestor a remarca para Bia (que faz todos os serviços) num horário livre, então a reserva passa para Bia, `revisao` é incrementada e existe registro `remarcacao` `pendente` dessa revisão.
- [ ] CA-2: Dado a remarcação para horário ocupado, quando enviada, então é recusada e a reserva original fica intacta.
- [ ] CA-3: Dado uma reserva futura, quando cancelada, então fica `cancelado`, o horário volta a ficar disponível e existe registro `cancelamento` `pendente`.
- [ ] CA-4: Dado uma reserva que ainda não começou, quando a equipe tenta marcar `concluido`, então é recusado.
- [ ] CA-5: Dado uma reserva 10:00–11:00, quando remarcada para 10:30–11:30 do mesmo profissional (sobrepondo a própria posição antiga), então é aceita como UPDATE da mesma reserva.
- [ ] CA-6: Dado um profissional, quando tenta cancelar reserva de outro profissional, então recebe 403.
- [ ] CA-7: Dado uma reserva `cancelado`, quando a equipe tenta qualquer transição, então é recusada; dado uma reserva `confirmado` já terminada, quando a equipe tenta cancelar, então é recusado; dado `concluido`, quando corrigida para `nao_compareceu` (e o inverso), então é aceita.

#### Validação
Unitários (máquina de status); integração com PostgreSQL real (permissões, outbox, sobreposição). O comportamento com salão suspenso é verificado em E6.4 (CAs 2 e 3). Gate padrão.

---

### ITEM E4 | Página pública de agendamento

#### Objetivo
Permitir que a cliente reserve pelo celular, sem conta, com proteções contra abuso.

#### Origem e contexto
PLAN.md, "Agenda e atendimento" (fluxo público), "Proteção da página pública", "Clientes e privacidade" e "Interface". Atual: inexistente.

#### Escopo
E4.1, E4.2, E4.3, E4.4.

#### Critérios de aceite
- [ ] CA-1: Dado que E4.1–E4.4 estão concluídas e aprovadas, quando o épico é revisado, então ele pode ser fechado.
- [ ] CA-2: Dado as sub-issues fechadas, quando o tester reexecuta os CAs 2 e 10 do PLAN, então todos têm evidência aprovada em `testes.md`.

### ITEM E4.1 | Reservar pela página pública: serviços, profissional, horário, dados e confirmação

#### Objetivo
Oferecer o fluxo público completo e mobile-first, na ordem definida no PLAN.

#### Origem e contexto
PLAN.md, "Perfis e acesso" (slug antigo redireciona), "Agenda e atendimento" (ordem do fluxo, reserva confirmada) e "Interface" (página pública, estados claros); CA 2 do PLAN. Atual: inexistente.

#### Escopo
Resolução do slug atual e histórico (`salao_slug`) com redirecionamento permanente. Página `/<slug>`: etapa 1 seleção múltipla de serviços com total de preço e duração; etapa 2 profissionais elegíveis; etapa 3 dias e horários (fuso do salão); etapa 4 nome, WhatsApp, consentimento (E4.3), captcha (E4.2); etapa 5 tela de confirmação com resumo. Estado "agendamento indisponível".

#### Fora do escopo
Portal da cliente para remarcar/cancelar (PLAN: clientes solicitam ao salão).

#### Especificação
Decidido:
- RN-1: a ordem das etapas é fixa: serviços → profissional → horário → dados.
- RN-2: só serviços ativos com ao menos um profissional ativo; só profissionais que fazem todos os escolhidos.
- RN-3: reserva criada via E3.2, `confirmado`; capacidade declarada: `agendar` (público), verificada em E6.4.
- RN-4: estado "horário indisponível" quando o horário é tomado entre a escolha e o envio, voltando à etapa de horário sem perder serviços e dados.
- RN-5: salão cujo estado efetivo não permite `agendar` mostra "agendamento indisponível" (política de E6.4).
- RN-6: slug inexistente → 404; slug histórico → redirecionamento permanente (301 ou 308) para o slug atual.
Casos limite: nenhum profissional elegível para a combinação (mensagem orientando a reduzir serviços); dia sem horários; telefone inválido (E5.1).

#### Critérios de aceite
- [ ] CA-1: Dado a etapa de serviços, quando a cliente escolhe dois serviços, então vê o total de preço e duração somados.
- [ ] CA-2: Dado a escolha de serviços, quando avança, então só aparecem profissionais que executam todos.
- [ ] CA-3: Dado dados válidos, quando confirma, então vê a tela de confirmação com salão, serviços, profissional, data e horário locais, e a reserva existe `confirmado`.
- [ ] CA-4: Dado que outra reserva tomou o horário, quando a cliente confirma, então vê "horário indisponível" e volta à escolha de horário com os dados preservados.
- [ ] CA-5: Dado um envio sem o aceite de consentimento, quando chega ao servidor, então é recusado e nenhuma reserva ou cliente é criado.
- [ ] CA-6: Dado um slug histórico, quando acessado, então redireciona permanentemente para o slug atual; dado um slug inexistente, então responde 404.
- [ ] CA-7: Dado uma reserva pública concluída, quando se consulta `consentimento`, então existe registro com origem `publico`, data UTC e a mesma versão exibida nas páginas de Termos e Privacidade.

#### Validação
Unitários do estado do assistente (preservar dados ao voltar de etapa); integração com PostgreSQL real das ações do servidor e da resolução de slug; viewport de celular e uso só por teclado comprovados por Playwright em E4.4 (CA-7). Gate padrão.

### ITEM E4.2 | Proteger a página pública com rate limit, limite de reservas por número e Turnstile

#### Objetivo
Reduzir abuso e mensagens a terceiros na página pública.

#### Origem e contexto
PLAN.md, "Proteção da página pública"; CA 10 do PLAN. Atual: inexistente.

#### Escopo
Limite de requisições por IP (envio de reserva e consulta de disponibilidade, com limites próprios) e por número; máximo de 3 reservas futuras por número no mesmo salão; validação Turnstile no servidor via porta (E0.6); widget na etapa de dados; limpeza periódica das janelas no worker.

#### Especificação
Decidido:
- RN-1: janelas persistidas em `rate_limit_janela` (funciona com múltiplas instâncias), com upsert atômico `ON CONFLICT … RETURNING contador`; a chave por número é HMAC-SHA256 do E.164; limites por env com os padrões de S7, nomeados no `.env.example`.
- RN-2: reservas futuras = status `confirmado` com início > agora, no mesmo salão e mesmo telefone E.164 (S6); contagem feita na transação de criação (E3.2), depois do upsert que trava a linha da cliente.
- RN-3: token Turnstile validado no servidor antes de criar a reserva; inválido → recusa sem criar reserva.
- RN-4: respostas de limite com HTTP 429 e mensagem pt-BR; não revelam dados de reservas existentes.
- RN-5: `TRUSTED_PROXY_HOPS` (padrão 0 = `X-Forwarded-For` ignorado; N > 0 = N-ésima entrada contada da direita).
- RN-6: com `TURNSTILE_ADAPTER=simulado`, o widget é um componente local que entrega o token documentado e permite gerar um token inválido (usado em E4.4).

#### Critérios de aceite
- [ ] CA-1: Dado um número com 3 reservas futuras no salão A, quando tenta a 4ª no salão A, então é recusada; no salão B, então é aceita.
- [ ] CA-2: Dado uma das 3 reservas cancelada, quando tenta outra, então é aceita.
- [ ] CA-3: Dado o limite por IP configurado em N, quando o mesmo IP faz N+1 requisições de reserva dentro da janela, então a última recebe 429.
- [ ] CA-4: Dado o limite por número, quando excedido a partir de IPs diferentes, então a requisição recebe 429.
- [ ] CA-5: Dado token Turnstile inválido no adaptador simulado, quando envia a reserva, então é recusada e nenhuma reserva ou cliente é criado.
- [ ] CA-6: Dado `TRUSTED_PROXY_HOPS=0`, quando N+1 requisições trocam o `X-Forwarded-For` a cada vez, então a última recebe 429; dado `TRUSTED_PROXY_HOPS=1` e `X-Forwarded-For: <forjado>, <cliente>`, então o limite é contado para `<cliente>`.
- [ ] CA-7: Dado um número com 2 reservas futuras, quando 5 reservas públicas desse número (horários distintos) são enviadas em paralelo, então exatamente 1 é aceita e o total de futuras é 3.
- [ ] CA-8: Dado o limite de consulta de disponibilidade em M, quando o mesmo IP faz M+1 consultas na janela, então a última recebe 429.
- [ ] CA-9: Dado N tentativas de reserva de um número, quando se consulta `rate_limit_janela`, então nenhuma linha contém o E.164 em claro (a chave é HMAC-SHA256).

#### Validação
Integração com PostgreSQL real (limites, contagem, concorrência); unitários da janela de tempo e da extração do IP. Gate padrão.

### ITEM E4.3 | Publicar Termos e Privacidade e registrar o consentimento versionado da cliente

#### Objetivo
Cumprir LGPD com textos provisórios e registro do consentimento.

#### Origem e contexto
PLAN.md, "Clientes e privacidade (LGPD)" (páginas e consentimento com data e versão) e "Mensagens pelo WhatsApp" (consentimento para mensagens). Atual: inexistente.

#### Escopo
Páginas `/termos` e `/privacidade` (texto provisório com versão), checkbox obrigatório no formulário público, registro de consentimento (cliente, data UTC, versão dos textos, origem `publico` ou `equipe`).

#### Especificação
Decidido:
- RN-1: sem consentimento marcado, a reserva pública é recusada no servidor.
- RN-2: o consentimento cobre Termos, Privacidade e mensagens de WhatsApp da reserva.
- RN-3: cada reserva pública grava um registro de consentimento com a versão vigente.
- RN-4: textos identificados como provisórios.

#### Critérios de aceite
- [ ] CA-1: Dado um payload público sem aceite, quando passa pelo validador ou por `registrarConsentimento`, então devolve erro de validação e nenhuma linha é criada em `consentimento`.
- [ ] CA-2: Dado uma cliente da fábrica, quando `registrarConsentimento(origem='publico')` é chamado, então a linha criada tem data UTC e versão igual à de `src/config/termos.ts`, que é a exibida nas páginas.
- [ ] CA-3: Dado as páginas de Termos e Privacidade, quando acessadas, então exibem a versão de `src/config/termos.ts`.

#### Validação
Unitários do validador; integração com PostgreSQL real; teste de componente das páginas. Gate padrão.

### ITEM E4.4 | Cobrir o fluxo público com E2E Playwright em viewport de celular

#### Objetivo
Comprovar de ponta a ponta o CA 2 do PLAN em tela de celular.

#### Origem e contexto
PLAN.md, "Direção técnica" (Playwright para o fluxo público em tela de celular); CA 2 do PLAN. Atual: inexistente.

#### Escopo
Cenários E2E com adaptadores simulados e banco semeado: reserva multi-serviço; filtragem de profissionais; horário indisponível; captcha inválido; salão suspenso mostra "agendamento indisponível". Atualização da seção de E2E do README.

#### Especificação
Decidido:
- RN-1: Chromium em 375×812 com `isMobile` e `hasTouch`; navegação por toque e teclado.
- RN-2: banco de E2E separado, reiniciado e semeado no `globalSetup`; testes independentes entre si; salão suspenso preparado por fixture.
- RN-3: limites de rate limit elevados por env no E2E (o 429 é testado em E4.2).
- RN-4: rodam na CI (E0.3) com `retries: 0`.
- RN-5: o worker fica fora do E2E enquanto nenhum cenário verificar o envio de mensagem.
- RN-6: lint e typecheck incluem `e2e/**`.

#### Critérios de aceite
- [ ] CA-1: Dado o salão de demonstração, quando o teste executa o fluxo com dois serviços, então chega à tela de confirmação e verifica a reserva criada.
- [ ] CA-2: Dado um salão suspenso, quando o teste abre a página pública, então vê "agendamento indisponível".
- [ ] CA-3: Dado a suíte E2E, quando executada duas vezes seguidas, então passa nas duas.
- [ ] CA-4: Dado um token inválido gerado pelo widget simulado, quando a cliente confirma, então vê a mensagem de captcha inválido e nenhuma reserva é criada.
- [ ] CA-5: Dado serviços com vínculos parciais no banco de E2E, quando a cliente escolhe A+B, então só aparecem os profissionais que fazem ambos.
- [ ] CA-6: Dado o horário escolhido tomado por fixture entre a escolha e o envio, quando a cliente confirma, então vê "horário indisponível" e volta à etapa de horário com serviços e dados preservados.
- [ ] CA-7: Dado viewport 375×812, quando o fluxo é executado só com teclado, então a reserva é concluída e nenhuma etapa tem rolagem horizontal.

#### Validação
Execução Playwright local e na CI (fora da métrica de cobertura). Aprovação do tester.

---

### ITEM E5 | Clientes e privacidade (LGPD)

#### Objetivo
Manter o cadastro de clientes por salão e permitir a anonimização preservando a agenda.

#### Origem e contexto
PLAN.md, "Clientes e privacidade (LGPD)"; CLAUDE.md, invariantes "Clients" e "Soft deletes". Atual: inexistente.

#### Escopo
E5.1, E5.2.

#### Critérios de aceite
- [ ] CA-1: Dado que E5.1 e E5.2 estão concluídas e aprovadas, quando o épico é revisado, então ele pode ser fechado.
- [ ] CA-2: Dado as sub-issues fechadas, quando o tester reexecuta o CA 7 do PLAN, então todos têm evidência aprovada em `testes.md`.

### ITEM E5.1 | Manter clientes por salão com telefone E.164, busca e edição

#### Objetivo
Identificar clientes por salão + telefone e permitir ao gestor consultá-las e corrigi-las.

#### Origem e contexto
PLAN.md, "Clientes e privacidade (LGPD)"; CLAUDE.md, invariante "Clients". Atual: inexistente.

#### Escopo
Normalização de telefone; upsert de cliente na reserva; lista com busca por nome/telefone; detalhe com histórico de agendamentos; edição de nome e telefone pelo gestor.

#### Especificação
Decidido:
- RN-1: só números brasileiros; normalização para E.164 conforme S8; demais rejeitados com mensagem.
- RN-2: nova reserva com o mesmo número no mesmo salão atualiza o nome da cliente existente.
- RN-3: o mesmo número em salões diferentes gera clientes independentes, sem compartilhar dados.
- RN-4: só o gestor vê a lista e edita; profissional vê os dados da cliente apenas nas próprias reservas.
- RN-5: edição para um telefone já existente no salão é recusada (sugestão: oferecer mesclagem fica fora da v1).
- RN-6: edição com capacidade declarada `configurar`; o bloqueio por estado do salão é verificado em E6.4.
- RN-7: upsert atômico por (`salao_id`, `telefone_e164`).

#### Critérios de aceite
- [ ] CA-1: Dado as entradas `(11) 98765-4321`, `11987654321` e `+55 11 98765-4321`, quando normalizadas, então todas resultam em `+5511987654321`.
- [ ] CA-2: Dado `+1 415 555 0100` ou DDD inexistente, quando informado, então é recusado.
- [ ] CA-3: Dado a cliente "Maria" com `+5511987654321` no salão A, quando `upsertCliente(salaoA, '+5511987654321', 'Maria S.')` é chamado, então existe uma única cliente, agora "Maria S.".
- [ ] CA-4: Dado o mesmo número em dois salões, quando o gestor do salão A busca, então só vê a cliente do salão A e o histórico do salão A.
- [ ] CA-5: Dado um profissional, quando acessa a lista de clientes, então recebe 403.
- [ ] CA-6: Dado 2 upserts paralelos do mesmo número no mesmo salão, quando executados, então existe 1 cliente e nenhum dos dois falha.

#### Validação
Unitários extensivos da normalização; integração com PostgreSQL real (upsert, isolamento). Gate padrão.

### ITEM E5.2 | Anonimizar cliente mantendo o histórico da agenda

#### Objetivo
Atender à exclusão de dados pessoais sem perder o histórico.

#### Origem e contexto
PLAN.md, "Clientes e privacidade (LGPD)" (excluir = anonimizar); CLAUDE.md, invariante "Soft deletes"; CA 7 do PLAN. Atual: inexistente.

#### Escopo
Ação "excluir cliente" (gestor) com confirmação; anonimização numa transação; exclusão da cliente da lista e do detalhe de clientes; tratamento das mensagens e tentativas da cliente.

#### Fora do escopo
Exibição de "cliente removida" na agenda (E3.3, RN-3).

#### Especificação
Decidido:
- RN-1: nome e telefone ficam nulos e `anonimizada_em` é preenchido (CHECK de E0.4).
- RN-2: as reservas e itens permanecem.
- RN-3: a cliente anonimizada não aparece em buscas nem listas.
- RN-4: na mesma transação, mensagens `pendente` e `falhou` da cliente passam a `cancelada_anonimizacao`; `destinatario_e164`, `parametros` e `erro_detalhe` ficam nulos em todas as mensagens e tentativas da cliente; os registros de consentimento são mantidos.
- RN-5: nova reserva com o mesmo número cria uma nova cliente, sem ligação com a anonimizada.
- RN-6: operação irreversível; capacidade declarada: `lgpd` (permitida em qualquer estado do salão, E6.4).

#### Critérios de aceite
- [ ] CA-1: Dado uma cliente com 3 reservas, quando o gestor a anonimiza, então nome e telefone ficam nulos no banco e as 3 reservas continuam existindo, ligadas à cliente anonimizada.
- [ ] CA-2: Dado a cliente anonimizada, quando o gestor busca pelo nome ou telefone antigos, então nenhum resultado aparece.
- [ ] CA-3: Dado uma mensagem pendente dessa cliente, quando a anonimização ocorre e o worker processa o job, então ela está `cancelada_anonimizacao` e nada é enviado.
- [ ] CA-4: Dado a cliente anonimizada, quando `upsertCliente` é chamado com o número antigo, então é criada uma nova cliente, sem ligação com a anonimizada.
- [ ] CA-5: Dado a cliente anonimizada, quando se busca o telefone antigo em `cliente`, `mensagem` e `mensagem_tentativa`, então não há ocorrência em claro.
- [ ] CA-6: Dado a cliente anonimizada, quando se tenta voltar a preencher nome ou telefone via SQL, então o CHECK rejeita.

#### Validação
Integração com PostgreSQL real. Gate padrão.

---

### ITEM E6 | Assinatura com Mercado Pago

#### Objetivo
Cobrar R$ 79/mês por salão com 30 dias grátis, carência, suspensão, regularização e cancelamento, de forma confiável.

#### Origem e contexto
PLAN.md, "Assinatura"; CLAUDE.md, invariante "Subscriptions". Atual: inexistente.

#### Escopo
E6.1, E6.2, E6.3, E6.4, E6.5, E6.6.

#### Critérios de aceite
- [ ] CA-1: Dado que E6.1–E6.6 estão concluídas e aprovadas, quando o épico é revisado, então ele pode ser fechado.
- [ ] CA-2: Dado as sub-issues fechadas, quando o tester reexecuta o CA 5 do PLAN (adaptador local) e a parte de eventos de assinatura do CA 11 do PLAN, então todos têm evidência aprovada em `testes.md`.

### ITEM E6.1 | Iniciar o período de teste somente após a autorização confirmada no Mercado Pago

#### Objetivo
Conectar o salão a uma assinatura e começar o teste de 30 dias apenas com confirmação do provedor.

#### Origem e contexto
PLAN.md, "Assinatura" (meio de pagamento ao iniciar o teste; conta provisória; nunca confiar no retorno do navegador; vínculo inequívoco). Atual: inexistente.

#### Escopo
Após confirmar o e-mail, o gestor é levado a "assinar"; criação da assinatura via porta MP com referência externa = ID do salão; redirecionamento para o checkout do provedor; página de retorno que consulta o provedor; estado "pendente" enquanto não confirmado.

#### Especificação
Decidido:
- RN-1: a assinatura guarda o ID do provedor e a referência externa = ID do salão; uma assinatura vigente por salão, garantido por `UNIQUE(salao_id) WHERE estado <> 'encerrada'`; uma `pendente` abandonada é reutilizada.
- RN-2: o retorno do navegador apenas dispara uma consulta ao provedor; o estado só muda com a resposta do provedor ou webhook (E6.2).
- RN-3: teste começa na data da autorização confirmada e dura 30 dias; valor R$ 79,00 mensal.
- RN-4: dados de cartão nunca passam pelo nosso servidor nem são armazenados.
- RN-5: conta provisória conforme S9.
- RN-6: capacidade declarada: `assinatura`; mudanças de estado passam por `aplicarEventoAssinatura` (E6.3).

#### Critérios de aceite
- [ ] CA-1: Dado um gestor confirmado sem assinatura, quando inicia a assinatura com o adaptador simulado, então é criada uma assinatura `pendente` vinculada ao salão.
- [ ] CA-2: Dado a URL de retorno acessada com parâmetros de sucesso forjados e o provedor (simulado) ainda sem autorização, quando a página processa, então a assinatura continua `pendente`.
- [ ] CA-3: Dado o provedor simulado confirmando a autorização, quando a página de retorno é processada, então a assinatura fica `em_teste` com fim = autorização + 30 dias e o estado efetivo do salão permite `agendar`.
- [ ] CA-4: Dado o banco migrado e os eventos gravados nos testes, quando se consulta `information_schema.columns`, então não há coluna com nome `%cart%`, `%card%`, `%cvv%` ou `%pan%`, e nenhum corpo de webhook gravado contém sequência de 13 a 19 dígitos.

#### Validação
Integração com PostgreSQL real e MP simulado. Gate padrão.

### ITEM E6.2 | Processar webhooks do Mercado Pago com validação de origem, registro e idempotência

#### Objetivo
Receber notificações do provedor de forma segura, sem efeitos duplicados.

#### Origem e contexto
PLAN.md, "Assinatura" (webhooks com validação de origem e idempotência; registro de cada evento); CLAUDE.md, invariante "Subscriptions"; CA 5 do PLAN. Atual: inexistente.

#### Escopo
Endpoint de webhook; validação de origem via porta MP (`validarWebhook`); persistência de todo evento recebido (inclusive inválidos, marcados); deduplicação; consulta ao provedor para obter o estado real; aplicação via `aplicarEventoAssinatura` (E6.3).

#### Especificação
Decidido:
- RN-1: evento com origem inválida é registrado com `origem_valida = false` e não gera efeito; resposta 401/400.
- RN-2: o evento é persistido antes do processamento, guardando só o corpo da notificação (não a resposta completa do provedor); chave de dedupe = identificador da notificação (`id` do corpo ou `x-request-id`), única só entre eventos com origem válida.
- RN-3: evento repetido responde 200 e não reaplica efeitos.
- RN-4: o efeito é determinado pelo estado consultado no provedor, não só pelo payload.
- RN-5: evento de assinatura desconhecida é registrado e ignorado.
- RN-6: o efeito é idempotente por recurso: um `pagamento_id` aprovado estende o período uma única vez (`assinatura_pagamento.pagamento_id UNIQUE` + `FOR UPDATE` na assinatura), ainda que chegue em notificações diferentes ou concorrentes.

#### Critérios de aceite
- [ ] CA-1: Dado um webhook com assinatura inválida, quando recebido, então é registrado como rejeitado e o estado da assinatura não muda.
- [ ] CA-2: Dado um webhook válido de cobrança aprovada, quando recebido 3 vezes (inclusive em paralelo), então há 1 evento processado e o período pago é estendido uma única vez.
- [ ] CA-3: Dado um webhook válido cujo payload indica "aprovado" mas o provedor consultado informa "recusado", quando processado, então vale o estado consultado.
- [ ] CA-4: Dado qualquer webhook recebido, quando se consulta a tabela de eventos, então ele está registrado com data, tipo, corpo e resultado do processamento.
- [ ] CA-5: Dado um evento forjado (origem inválida) com o mesmo `id`/`x-request-id` de um evento legítimo, recebido antes dele, quando o legítimo chega, então é processado normalmente.
- [ ] CA-6: Dado duas notificações distintas referentes ao mesmo `pagamento_id` aprovado, quando processadas, então o período é estendido uma vez.

#### Validação
Unitários da extração da chave de dedupe; integração com PostgreSQL real e MP simulado (CA 11 do PLAN: eventos de assinatura). Gate padrão.

### ITEM E6.3 | Aplicar a máquina de estados da assinatura e os jobs de prazo

#### Objetivo
Controlar teste, cobrança, carência, suspensão, regularização e cancelamento.

#### Origem e contexto
PLAN.md, "Assinatura" (30 dias grátis, 3 dias de carência a partir da primeira falha, suspensão, reativação, cancelamento); CLAUDE.md, invariante "Subscriptions". Atual: inexistente.

#### Escopo
Estados `pendente`, `em_teste`, `ativa`, `em_carencia`, `suspensa`, `cancelada` (com acesso até data) e `encerrada` (S10); ponto de entrada único `aplicarEventoAssinatura`, usado por E6.1, E6.2 e E6.5; transições por evento e por tempo (job agendado no worker, E0.7); registro de transições em `assinatura_transicao`; indicador de suspensão manual (S11); função de estado efetivo do salão usada por E6.4.

#### Especificação
Decidido:
- RN-1: `em_teste` → `ativa` na primeira cobrança aprovada.
- RN-2: primeira falha notificada → `em_carencia` com prazo = data da primeira falha + 3 dias; falhas seguintes não reiniciam o prazo.
- RN-3: prazo vencido sem regularização → `suspensa` (job).
- RN-4: cobrança aprovada em `em_carencia` ou `suspensa` → `ativa`, limpando o prazo.
- RN-5: cancelamento pelo gestor: em teste, acesso até o fim do teste sem cobrança; ativa, acesso até `pago_ate`; depois → `encerrada`.
- RN-6: cálculo de `pago_ate` (confirmado pelo arquiteto, `design.md` §15):
  - primeira cobrança: `pago_ate = max(coalesce(pago_ate, fim_teste), data_pagamento) + 1 mês`; pagamento antecipado não encurta o teste;
  - cobrança regular em `ativa`: `pago_ate = max(pago_ate, data_pagamento) + 1 mês`;
  - pagamento de regularização em `em_carencia` ou `suspensa`: reinicia o ciclo, `pago_ate = data_pagamento + 1 mês`;
  - "+1 mês" é mês civil em UTC, limitado ao último dia do mês de destino (31/01 → último dia de fevereiro);
  - idempotência no banco: `pagamento_id` único em `assinatura_pagamento`, gravado na mesma transação que atualiza `pago_ate`.
- RN-7: o estado efetivo do salão combina o estado da assinatura e `suspenso_manual_em` (S11); as capacidades de cada estado estão na tabela de E6.4.
- RN-8: o job de prazo faz UPDATE condicional ao estado esperado; webhook e job serializam pela linha da assinatura; transições idempotentes; cada transição é inserida em `assinatura_transicao` (somente inserção).
- RN-9: tempo controlável nos testes (relógio injetável).

#### Critérios de aceite
- [ ] CA-1: Dado `em_teste` com `fim_teste` 10/03/2027 UTC, quando chega cobrança aprovada em 10/03/2027, então fica `ativa` com `pago_ate` 10/04/2027.
- [ ] CA-2: Dado `ativa`, quando chega a primeira falha em D, então fica `em_carencia` com prazo D+3; uma segunda falha em D+1 não altera o prazo.
- [ ] CA-3: Dado `em_carencia` com prazo vencido, quando o job roda, então fica `suspensa`; rodar o job de novo não muda nada.
- [ ] CA-4: Dado `suspensa`, quando chega cobrança aprovada, então fica `ativa` e o estado efetivo do salão volta a permitir `agendar`.
- [ ] CA-5: Dado cancelamento durante o teste no dia 10, quando consultado no dia 29, então o salão permite `agendar`; no dia 31, `encerrada` e não permite; o MP simulado não registra cobrança e não há linha em `assinatura_pagamento`.
- [ ] CA-6: Dado suspensão manual com assinatura `ativa`, quando se consulta o estado efetivo, então não permite `agendar`.
- [ ] CA-7: Dado `em_carencia` com prazo vencendo, quando o job de suspensão e um webhook de pagamento aprovado são processados em paralelo, então o estado final é `ativa`.
- [ ] CA-8: Dado qualquer transição, quando ocorre, então existe uma linha em `assinatura_transicao` com estado anterior, novo e origem.
- [ ] CA-9: Dado `em_teste` com `fim_teste` 10/03/2027, quando uma cobrança aprovada chega antecipada em 01/03/2027, então `pago_ate` é 10/04/2027.
- [ ] CA-10: Dado a base de cálculo em 31/01/2027, quando uma cobrança aprovada é aplicada, então `pago_ate` é 28/02/2027.
- [ ] CA-11: Dado `suspensa` com `pago_ate` 05/05/2027, quando chega pagamento de regularização em 20/05/2027, então fica `ativa` com `pago_ate` 20/06/2027.
- [ ] CA-12: Dado o mesmo `pagamento_id` aplicado duas vezes (inclusive em paralelo), quando processado, então `pago_ate` avança uma única vez; dado uma falha forçada ao gravar o `pagamento_id`, então `pago_ate` não muda.

#### Validação
Unitários da máquina de estados com relógio controlado; integração com PostgreSQL real e worker. Gate padrão.

### ITEM E6.4 | Aplicar o modo somente leitura do salão suspenso e a página pública indisponível

#### Objetivo
Restringir operações de salões não operáveis, preservando a consulta e a exceção de cancelamento.

#### Origem e contexto
PLAN.md, "Assinatura" (efeitos da suspensão); CLAUDE.md, invariante "Subscriptions" (read-only exceto cancelamentos que notificam). Atual: inexistente.

#### Escopo
Política real de capacidades plugada em `defineAcao` (E0.5) e aplicada à página pública (E4.1); faixa de aviso no painel ("assinatura pendente", "em carência", "suspensa", "encerrada").

#### Especificação
Decidido:
- RN-1: a política é aplicada no servidor, centralizada em `defineAcao`, conforme a tabela:

| Estado efetivo | leitura | configurar | agendar (público e equipe) | cancelar | assinatura | lgpd |
|---|---|---|---|---|---|---|
| `pendente` (S9) | sim | sim | não | sim | sim | sim |
| `em_teste`, `ativa`, `em_carencia`, `cancelada` dentro do prazo | sim | sim | sim | sim | sim | sim |
| `suspensa`, `encerrada` ou suspensão manual | sim | não | não | sim (notifica) | sim | sim |

- RN-2: `cancelar` cobre cancelar reserva futura (grava o aviso de cancelamento, E7.1) e marcar status de atendimento passado.
- RN-3: troca de senha e perfil próprio ficam fora da política.
- RN-4: em `em_carencia`, tudo funciona, mas o painel mostra aviso com o prazo.

#### Critérios de aceite
- [ ] CA-1: Dado um salão suspenso, quando a cliente abre a página pública, então vê "agendamento indisponível" e nenhuma reserva pode ser criada pela API pública.
- [ ] CA-2: Dado um salão suspenso, quando a equipe tenta criar reserva, remarcar, alterar serviço, profissional, jornada, bloqueio ou regras, então cada ação é recusada no servidor.
- [ ] CA-3: Dado um salão suspenso, quando a equipe cancela reserva futura, então ela fica `cancelado` e o registro de mensagem `cancelamento` é gravado.
- [ ] CA-4: Dado um salão suspenso, quando o gestor abre agenda, clientes e configurações, então os dados são exibidos.
- [ ] CA-5: Dado um salão em carência, quando o gestor abre o painel, então vê aviso com a data limite.
- [ ] CA-6: Dado um salão `pendente`, quando a equipe tenta criar reserva, então é recusado; quando o gestor cria um serviço, então é aceito.

#### Validação
Unitários orientados por tabela da política (3 linhas de estado × 6 capacidades); integração com PostgreSQL real (uma verificação por capacidade e estado). Gate padrão.

### ITEM E6.5 | Exibir e gerenciar a assinatura no painel do gestor

#### Objetivo
Permitir ao gestor consultar o estado da assinatura, regularizar e cancelar.

#### Origem e contexto
PLAN.md, "Assinatura" (consultar estado e cancelar) e "Interface" (assinatura no painel; estados de assinatura pendente/suspensa e erro de pagamento). Atual: inexistente.

#### Escopo
Tela com estado, datas (fim do teste, próxima cobrança, prazo de carência, acesso até), valor; ação de atualizar meio de pagamento/regularizar (via checkout do provedor); cancelar com confirmação; nova assinatura após `encerrada` (S10); mensagens de erro de pagamento.

#### Especificação
Decidido:
- RN-1: só o gestor acessa; profissional recebe 403.
- RN-2: cancelar exige confirmação e chama a porta MP; o estado local só muda após confirmação do provedor.
- RN-3: falha do provedor exibe "erro de pagamento" sem alterar o estado.
- RN-4: acessível com salão suspenso ou encerrado; capacidade declarada: `assinatura`.
- RN-5: mudanças de estado passam por `aplicarEventoAssinatura` (E6.3).

#### Critérios de aceite
- [ ] CA-1: Dado `em_teste`, quando o gestor abre a tela, então vê "Período de teste até dd/mm/aaaa" e "R$ 79,00/mês".
- [ ] CA-2: Dado `ativa`, quando o gestor cancela e confirma, então a tela mostra "acesso até dd/mm/aaaa" e o provedor simulado registra o cancelamento.
- [ ] CA-3: Dado o provedor simulado retornando erro ao cancelar, quando o gestor tenta, então vê mensagem de erro e o estado não muda.
- [ ] CA-4: Dado um profissional, quando acessa a tela, então recebe 403.

#### Validação
Integração com PostgreSQL real e MP simulado; isolamento conforme G-4. Gate padrão.

### ITEM E6.6 | Implementar o adaptador real da API de Assinaturas do Mercado Pago

#### Objetivo
Permitir ligar a cobrança real apenas configurando credenciais.

#### Origem e contexto
PLAN.md, "Assinatura" (API de Assinaturas do MP) e "Direção técnica" (adaptadores reais por env); CLAUDE.md, invariante "Integrations sit behind adapters". Atual: inexistente.

#### Escopo
Implementação real da porta MP (E0.6): criar assinatura no plano configurado (30 dias grátis, R$ 79/mês), consultar assinatura e pagamento, cancelar, `adiarProximaCobranca` (S12), validar a origem do webhook (`x-signature`, HMAC com `data.id`, `x-request-id` e `ts`).

#### Especificação
Decidido:
- RN-1: variáveis `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PREAPPROVAL_PLAN_ID`; com `MP_ADAPTER=real`, ausência de qualquer uma ou `APP_URL` sem `https://` faz o processo falhar na inicialização nomeando a variável.
- RN-2: nenhum dado de cartão é recebido ou armazenado; o cartão é informado no checkout do provedor.
- RN-3: erros do provedor são traduzidos em erros da porta, sem vazar para a lógica de negócio.
- RN-4: `adiarProximaCobranca` faz o PUT e confere com uma consulta; se a nova data não for refletida, falha com `ProvedorNaoSuportaAdiamento`.
Pendência de decisão do usuário: P2 (comportamento da extensão de teste no MP real). Até a resposta, vale a recomendação do arquiteto (opção a).
Pendência (não é CA): validação em sandbox, que exige credenciais, URL pública HTTPS e autorização do usuário.

#### Critérios de aceite
- [ ] CA-1: Dado um servidor HTTP local que imita respostas documentadas do MP, quando a porta cria, consulta e cancela uma assinatura, então envia as requisições esperadas (método, caminho, cabeçalho de autorização, plano configurado) e mapeia as respostas.
- [ ] CA-2: Dado um webhook com `x-signature` calculado com o segredo correto, quando validado, então é aceito; com segredo errado, rejeitado.
- [ ] CA-3: Dado `MP_ADAPTER=real` sem `MP_ACCESS_TOKEN`, quando o app inicia, então encerra com mensagem nomeando a variável.
- [ ] CA-4: Dado `MP_ADAPTER=real` com `APP_URL` sem `https://`, quando o app inicia, então encerra nomeando `APP_URL`.
- [ ] CA-5: Dado o stub que aceita o PUT mas devolve a data antiga na consulta, quando `adiarProximaCobranca` é chamada, então falha com `ProvedorNaoSuportaAdiamento`.

#### Validação
Testes com servidor HTTP local de stub (sem credencial real); spike em sandbox documentado como pendência no README (E9.3). Gate padrão.

---

### ITEM E7 | Mensagens pelo WhatsApp

#### Objetivo
Enviar confirmação, remarcação e cancelamento de forma confiável, sem afetar as reservas.

#### Origem e contexto
PLAN.md, "Mensagens pelo WhatsApp"; CLAUDE.md, invariante "WhatsApp messages". Atual: inexistente.

#### Escopo
E7.1, E7.2, E7.3.

#### Critérios de aceite
- [ ] CA-1: Dado que E7.1–E7.3 estão concluídas e aprovadas, quando o épico é revisado, então ele pode ser fechado.
- [ ] CA-2: Dado as sub-issues fechadas, quando o tester reexecuta o CA 6 do PLAN, então todos têm evidência aprovada em `testes.md`.

### ITEM E7.1 | Enfileirar e enviar mensagens após a gravação com idempotência, tentativas e backoff

#### Objetivo
Garantir que cada evento de reserva gere no máximo uma mensagem, com tentativas registradas e sem efeito sobre a reserva.

#### Origem e contexto
PLAN.md, "Mensagens pelo WhatsApp"; CLAUDE.md, invariante "WhatsApp messages"; CA 6 do PLAN. Atual: inexistente.

#### Escopo
Registro de mensagem (reserva, tipo, revisão, estado, tentativas com data, resultado e erro); outbox: função que grava o registro dentro da transação de E3.2, E3.4 e E3.5; envio do job após o commit; handler no worker; reconciliação periódica; reenvio manual (usado por E8.3).

#### Fora do escopo
Lembretes e mensagens promocionais (fora da v1).

#### Especificação
Decidido:
- RN-1: tipos `confirmacao`, `remarcacao`, `cancelamento`; estados `pendente`, `enviando`, `enviada`, `falhou`, `nao_enviada` (sem consentimento ou cliente anonimizada), `substituida`, `cancelada_anonimizacao`.
- RN-2: `UNIQUE(reserva_id, tipo, revisao)`; a string `reserva:tipo:revisao` é a `singletonKey` do pg-boss. Confirmação usa revisão 0; cancelamento usa a revisão vigente.
- RN-3 (outbox): o registro `pendente` é inserido com `ON CONFLICT DO NOTHING` na transação da reserva, remarcação ou cancelamento; o job é enviado ao pg-boss após o commit.
- RN-4: o envio e suas falhas nunca alteram a reserva; o worker atualiza só mensagem e tentativas.
- RN-5: envio só após reivindicação atômica (`UPDATE … WHERE estado IN ('pendente','falhou') … RETURNING`) que passa a mensagem a `enviando`; `enviando` além do prazo vira `falhou` com `resultado_incerto`, sem reenvio automático.
- RN-6: cada tentativa é registrada; backoff crescente (E0.7); esgotadas as tentativas, estado `falhou`.
- RN-7: ao gravar a remarcação de revisão N, mensagens `pendente` da mesma reserva com revisão < N passam a `substituida`; os parâmetros do template são lidos da reserva no envio, e só se a revisão ainda for a vigente.
- RN-8: só há envio se existe consentimento da cliente (qualquer origem) e ela não está anonimizada; caso contrário, `nao_enviada`.
- RN-9: reconciliação periódica reenfileira mensagens `pendente` sem job ativo há mais de N minutos; não deriva eventos do estado das reservas.
- RN-10: mensagem `enviada` nunca é reenviada; o reenvio manual de `falhou` reutiliza o mesmo registro e chave.
- RN-11: conteúdo da confirmação: salão, serviços, profissional, data e horário no fuso do salão.
Pendência de decisão do usuário: P1 (chave `reserva:tipo:revisao`, que diverge do texto literal do CLAUDE.md). Até a resposta, vale a recomendação do arquiteto (opção a).

#### Critérios de aceite
- [ ] CA-1: Dado uma reserva da fábrica e o registro gravado por `registrarMensagem(confirmacao)` numa transação, com o job enviado após o commit, quando o worker processa, então existe 1 mensagem `confirmacao` `enviada` com 1 tentativa registrada.
- [ ] CA-2: Dado o adaptador simulado falhando 2 vezes, quando o worker processa, então há 3 tentativas registradas com intervalos crescentes e o adaptador recebe um único envio bem-sucedido.
- [ ] CA-3: Dado o adaptador sempre falhando, quando esgotam as tentativas, então a mensagem fica `falhou` e a reserva continua `confirmado` e inalterada.
- [ ] CA-4: Dado o mesmo evento gravado duas vezes, quando processado, então o adaptador recebe uma única chamada.
- [ ] CA-5: Dado `registrarMensagem(remarcacao, revisao=1)` processada e enviada, e depois `registrarMensagem(remarcacao, revisao=2)`, quando o worker processa, então há duas mensagens `remarcacao` distintas, uma por revisão, ambas `enviada`.
- [ ] CA-6: Dado uma mensagem `falhou`, quando reenviada manualmente e o adaptador funciona, então fica `enviada` sem criar nova reserva ou novo registro de mensagem.
- [ ] CA-7: Dado `registrarMensagem(remarcacao, revisao=2)` gravada antes do envio da revisão 1, quando o worker processa, então só a revisão 2 é enviada e a revisão 1 fica `substituida`.
- [ ] CA-8: Dado um registro `pendente` sem job (o `boss.send` falhou), quando a reconciliação roda, então o job é criado e a mensagem fica `enviada`. O caso de fila indisponível no commit da reserva é verificado em E3.2 (CA-4).
- [ ] CA-9: Dado o mesmo job entregue a dois workers simultaneamente, quando ambos executam, então o adaptador recebe uma única chamada.
- [ ] CA-10: Dado uma mensagem em `enviando` há mais que o prazo (worker interrompido), quando a reconciliação roda, então ela fica `falhou` com `resultado_incerto` e não é reenviada automaticamente.

#### Validação
Integração com PostgreSQL real, worker pg-boss real e WhatsApp simulado. Gate padrão.

### ITEM E7.2 | Implementar o adaptador real da WhatsApp Cloud API com os três modelos

#### Objetivo
Permitir enviar mensagens reais pelo número central apenas configurando credenciais.

#### Origem e contexto
PLAN.md, "Mensagens pelo WhatsApp" (WhatsApp Business Platform oficial, número central, 3 modelos aprovados); CLAUDE.md, invariante "Integrations sit behind adapters". Atual: inexistente.

#### Escopo
Implementação real da porta WhatsApp via Cloud API: envio de template com parâmetros, mapeamento de erros (temporário × permanente), configuração por env, texto sugerido dos 3 templates documentado para aprovação na Meta.

#### Fora do escopo
Webhook de status de entrega da Meta (o PLAN não exige; dispensaria URL pública).

#### Especificação
Decidido:
- RN-1: variáveis `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` (com padrão fixado), `WHATSAPP_TEMPLATE_CONFIRMACAO`, `WHATSAPP_TEMPLATE_REMARCACAO`, `WHATSAPP_TEMPLATE_CANCELAMENTO`, `WHATSAPP_TEMPLATE_IDIOMA` (padrão `pt_BR`); ausentes em modo real → falha na inicialização.
- RN-2: erros permanentes (ex.: número inválido) não são retentados; temporários (rede, 5xx, rate limit) são.
- RN-3: o identificador de mensagem retornado pela Meta é gravado na tentativa.
- RN-4: telefone enviado em E.164.
- RN-5: timeout HTTP explícito, menor que o encerramento gracioso do worker (E0.7).

#### Critérios de aceite
- [ ] CA-1: Dado um servidor HTTP local que imita a Cloud API, quando a porta envia a confirmação, então a requisição usa o template configurado, idioma `pt_BR` e os parâmetros na ordem documentada.
- [ ] CA-2: Dado resposta 5xx, quando enviada, então a porta sinaliza erro temporário; dado erro de número inválido, então sinaliza erro permanente.
- [ ] CA-3: Dado `WHATSAPP_ADAPTER=real` sem `WHATSAPP_ACCESS_TOKEN`, quando o worker inicia, então encerra com mensagem nomeando a variável.
- [ ] CA-4: Dado um stub que não responde, quando a porta envia, então a chamada termina por timeout dentro do limite configurado e sinaliza erro temporário.

#### Validação
Testes com servidor HTTP local de stub; validação real pendente de credenciais, documentada no README (E9.3). Gate padrão.

### ITEM E7.3 | Mostrar à equipe a situação de envio das mensagens de cada reserva

#### Objetivo
Dar à equipe o estado claro de "falha de envio de mensagem" exigido na interface.

#### Origem e contexto
PLAN.md, "Interface" (estado claro para falha de envio de mensagem). Novo item (R3). Atual: inexistente.

#### Escopo
No detalhe da reserva (E3.3): lista das mensagens (tipo, estado com rótulo pt-BR para `pendente`, `enviando`, `enviada`, `falhou`, `nao_enviada`, `substituida` e `cancelada_anonimizacao`, data da última tentativa) e indicação visual de falha na agenda.

#### Fora do escopo
Reenvio pela equipe do salão (reenvio é ação do super admin, E8.3).

#### Especificação
Decidido:
- RN-1: visível para quem pode ver a reserva (E3.3).
- RN-2: falha não bloqueia nenhuma ação sobre a reserva.
- RN-3: motivo exibido para `nao_enviada` (sem consentimento ou cliente anonimizada); `substituida` aparece como "substituída por remarcação posterior".

#### Critérios de aceite
- [ ] CA-1: Dado uma confirmação `falhou`, quando a equipe abre a reserva, então vê "Falha ao enviar confirmação por WhatsApp" com data da última tentativa.
- [ ] CA-2: Dado uma reserva com mensagem enviada, quando aberta, então mostra "Confirmação enviada".
- [ ] CA-3: Dado um profissional, quando consulta mensagens de reserva de outro profissional, então recebe 404.

#### Validação
Integração com PostgreSQL real (isolamento conforme G-4); teste de componente da exibição. Gate padrão.

---

### ITEM E8 | Painel do administrador da plataforma

#### Objetivo
Permitir operar a plataforma com rastreabilidade total das ações do super admin.

#### Origem e contexto
PLAN.md, "Painel do administrador da plataforma"; CLAUDE.md, invariante "Super admin". Atual: inexistente.

#### Escopo
E8.1, E8.2, E8.3.

#### Critérios de aceite
- [ ] CA-1: Dado que E8.1–E8.3 estão concluídas e aprovadas, quando o épico é revisado, então ele pode ser fechado.
- [ ] CA-2: Dado as sub-issues fechadas, quando o tester reexecuta o CA 9 do PLAN, então todos têm evidência aprovada em `testes.md`.

### ITEM E8.1 | Registrar log de auditoria de toda ação do super admin

#### Objetivo
Garantir rastreabilidade: quem, quando, o quê, valores anteriores e novos.

#### Origem e contexto
PLAN.md, "Painel do administrador da plataforma"; CLAUDE.md, invariante "Super admin". Atual: inexistente.

#### Escopo
Serviço `registrarAuditoria`, usado por todas as ações do super admin, na mesma transação da mutação.

#### Fora do escopo
Tela de consulta da auditoria (E8.3).

#### Especificação
Decidido:
- RN-1: campos: ator, data UTC, ação, entidade e ID, salão (se houver), valores anteriores e novos (JSON), resultado.
- RN-2: mutação e auditoria na mesma transação: sem auditoria, sem mutação. Falhas sem mutação (ex.: TOTP inválido) são auditadas em transação própria, confirmada mesmo com a operação recusada.
- RN-3: log somente inserção, garantido por trigger (UPDATE/DELETE por linha, TRUNCATE por instrução) criado em E0.4; nenhuma rota edita ou apaga.
- RN-4: escopo conforme S14 (login e mutações).
- RN-5: segredos (senha, TOTP, tokens) nunca entram nos valores registrados.

#### Critérios de aceite
- [ ] CA-1: Dado uma mutação de super admin executada com `registrarAuditoria`, que altera o nome de um salão de "A" para "B", quando salva, então há um registro com ator, data, ação, anterior "A" e novo "B".
- [ ] CA-2: Dado uma falha forçada ao gravar a auditoria, quando a ação é executada, então a mutação não é persistida.
- [ ] CA-3: Dado o registro de ações (E0.5), quando o teste o percorre, então nenhuma ação altera ou apaga `auditoria` (o trigger é provado em E0.4, CA-12).
- [ ] CA-4: Dado `registrarFalhaAuditoria` chamada dentro de uma transação principal que sofre rollback, quando a transação é desfeita, então o registro de falha persiste. A falha de TOTP no login é verificada em E1.5 (CA-3).

#### Validação
Integração com PostgreSQL real. Gate padrão.

### ITEM E8.2 | Gerenciar salões no painel: listar, editar, suspender, reativar e estender teste

#### Objetivo
Permitir ao super admin acompanhar e intervir nos salões.

#### Origem e contexto
PLAN.md, "Painel do administrador da plataforma" (listar com situação, ver/editar, suspender/reativar, estender teste); CA 9 do PLAN. Atual: inexistente.

#### Escopo
Lista de salões com estado da assinatura e indicador de suspensão manual; detalhe e edição de dados do salão (nome, slug, fuso, dados do gestor exceto senha); suspender/reativar manualmente (S11); estender teste por N dias (S12).

#### Especificação
Decidido:
- RN-1: todas as ações exigem sessão de super admin com TOTP e geram auditoria (E8.1).
- RN-2: suspender/reativar altera só o indicador manual (S11).
- RN-3: estender teste só para assinatura `em_teste`; usa `adiarProximaCobranca` (E6.6); se o provedor falhar, nada muda e a falha é auditada.
Sugestão (não decidida): N inteiro de 1 a 90 dias.
Pendência de decisão do usuário: P2 (extensão de teste no MP real). Até a resposta, vale a recomendação do arquiteto (opção a).
- RN-4: edição respeita as mesmas validações de E2.5.

#### Critérios de aceite
- [ ] CA-1: Dado salões em estados diferentes, quando o super admin abre a lista, então vê nome, slug e estado de cada um.
- [ ] CA-2: Dado um salão ativo, quando o super admin o suspende, então o estado efetivo do salão não permite `agendar` e há registro de auditoria; quando reativa, volta a permitir e há novo registro.
- [ ] CA-3: Dado um salão `em_teste` com fim em D, quando estende 10 dias, então o fim passa a D+10, o provedor simulado registra o adiamento e a auditoria guarda D e D+10.
- [ ] CA-4: Dado um salão `ativa`, quando tenta estender teste, então é recusado.

#### Validação
Integração com PostgreSQL real e MP simulado. Gate padrão.

### ITEM E8.3 | Consultar assinatura, eventos do Mercado Pago e fila de mensagens com reenvio no painel

#### Objetivo
Dar ao super admin visibilidade das integrações e da auditoria e permitir reenviar mensagens com falha.

#### Origem e contexto
PLAN.md, "Painel do administrador da plataforma" (ver assinatura e eventos; ver fila e reenviar; log de auditoria); CA 6 e CA 9 do PLAN. Atual: inexistente.

#### Escopo
Por salão: assinatura, transições e eventos de webhook (data, tipo, resultado, corpo). Global: fila de mensagens com filtros (estado, salão, tipo), detalhe das tentativas e ação "reenviar" para mensagens `falhou` (E7.1 RN-10). Tela de consulta da auditoria com filtros (salão, ator, ação, período).

#### Especificação
Decidido:
- RN-1: reenvio só para `falhou`; gera auditoria.
- RN-2: telefone exibido mascarado nas listas e nunca exibido para cliente anonimizada.
- RN-3: leitura não gera auditoria (S14).
- RN-4: todas as telas exigem sessão de super admin com TOTP.

#### Critérios de aceite
- [ ] CA-1: Dado um salão com 3 eventos de webhook (um rejeitado), quando o super admin abre a assinatura, então vê os 3 com resultado.
- [ ] CA-2: Dado uma mensagem `falhou`, quando o super admin reenvia com o adaptador funcionando, então ela fica `enviada`, uma única chamada ao adaptador ocorre e a ação aparece na auditoria.
- [ ] CA-3: Dado uma mensagem `enviada`, quando o super admin tenta reenviar, então a ação é recusada.
- [ ] CA-4: Dado ações de suspensão e de reenvio registradas, quando o super admin filtra a auditoria pelo salão, então vê essas ações com valores anteriores e novos.
- [ ] CA-5: Dado a lista da fila, quando exibida, então o telefone aparece mascarado.

#### Validação
Unitários da máscara de telefone; integração com PostgreSQL real e adaptadores simulados; teste de componente das telas. Gate padrão.

---

### ITEM E9 | Entrega da v1

#### Objetivo
Fechar a v1 com página inicial, dados de demonstração, documentação e validação final de todos os critérios.

#### Origem e contexto
PLAN.md, "Interface" (página inicial), "Direção técnica" (seed), último parágrafo (documentação e credenciais reais) e "Critérios de aceite". Atual: inexistente.

#### Escopo
E9.1, E9.2, E9.3, E9.4.

#### Critérios de aceite
- [ ] CA-1: Dado que E9.1–E9.4 estão concluídas e aprovadas, quando o épico é revisado, então ele pode ser fechado.
- [ ] CA-2: Dado as sub-issues fechadas, quando o tester reexecuta o CA 11 do PLAN e os CAs 1–10 do PLAN, então todos têm evidência aprovada em `testes.md`.

### ITEM E9.1 | Publicar a página inicial com proposta, preço e acesso ao cadastro

#### Objetivo
Apresentar o produto e levar o gestor ao cadastro.

#### Origem e contexto
PLAN.md, "Interface" (página inicial curta com proposta, preço e acesso ao cadastro; marca Agenda Beleza; direção visual). Atual: inexistente.

#### Escopo
Página `/` com proposta de valor, preço "R$ 79/mês por salão, 30 dias grátis, sem limite de profissionais", chamadas para cadastro e login, links para Termos e Privacidade.

#### Especificação
Decidido:
- RN-1: textos próprios em pt-BR, sem copiar AppBarber/AppBeleza.
- RN-2: responsiva e navegável por teclado; segue E0.8.
- RN-3: preço e dias de teste lidos de `src/config/plano.ts` (E0.6), sem valor duplicado no código.

#### Critérios de aceite
- [ ] CA-1: Dado a página inicial, quando carregada, então mostra "Agenda Beleza", "R$ 79" mensais e "30 dias grátis".
- [ ] CA-2: Dado a página, quando o botão de cadastro é acionado por teclado, então leva à tela de cadastro.
- [ ] CA-3: Dado viewport de 375 px, quando carregada, então não há rolagem horizontal.

#### Validação
Teste de componente para CA-1; Playwright (`e2e/landing.spec.ts`) para CA-2 e CA-3. Gate padrão.

### ITEM E9.2 | Criar seed com dois salões distintos e uma conta de super admin

#### Objetivo
Disponibilizar dados de demonstração para uso e testes locais.

#### Origem e contexto
PLAN.md, "Direção técnica" (dados de demonstração para dois salões e um super admin); CLAUDE.md, "Required stack". Atual: inexistente.

#### Escopo
Seed idempotente: dois salões com nomes, slugs e fusos (sugestão: um com fuso diferente do padrão para exercitar fuso), gestores confirmados, profissionais (incluindo um gestor que atende), serviços com vínculos parciais (para testar filtragem), jornadas com pausas, bloqueios, clientes, reservas passadas e futuras em vários status, assinaturas em estados diferentes, super admin via `garantirSuperAdmin()` (E1.5).

#### Especificação
Decidido:
- RN-1: idempotência por UUIDs fixos e upsert/`skipDuplicates`; reservas relativas à data da primeira execução; rodar duas vezes não duplica dados.
- RN-4: o seed recusa `NODE_ENV=production` sem flag explícito e nunca apaga dados.
- RN-2: credenciais de demonstração documentadas no README, nunca reais.
- RN-3: dados de clientes fictícios, com telefones brasileiros válidos em E.164.

#### Critérios de aceite
- [ ] CA-1: Dado um banco migrado vazio, quando o seed roda, então existem 2 salões, cada um com gestor, ≥ 2 profissionais, ≥ 3 serviços e reservas, e 1 super admin.
- [ ] CA-2: Dado o seed executado duas vezes, quando se contam os registros, então os totais são iguais aos da primeira execução.
- [ ] CA-3: Dado as credenciais do README, quando se faz login como cada gestor, então cada um vê apenas o próprio salão.

#### Validação
Teste de integração com PostgreSQL real executando o seed. Gate padrão.

### ITEM E9.3 | Documentar no README execução, testes, credenciais reais e o risco de custo da Meta

#### Objetivo
Permitir que qualquer pessoa rode e teste o projeto e saiba o que é preciso para ligar os serviços reais.

#### Origem e contexto
PLAN.md, último parágrafo e "Mensagens pelo WhatsApp" (custo da Meta como risco); CLAUDE.md, "Required stack" (README). Atual: inexistente.

#### Escopo
README com: pré-requisitos; execução com Docker e sem Docker; migrações, seed no container e criação do super admin; banco de testes; `playwright install`; comandos de lint, typecheck, build, testes, teste único, cobertura e E2E; credenciais de demonstração; tabela de variáveis (nome, modo em que é obrigatória, padrão), incluindo `APP_URL` e `TRUSTED_PROXY_HOPS` atrás de proxy; seção separada de credenciais reais (Mercado Pago; WhatsApp Business Platform: conta, número e 3 modelos aprovados com o texto sugerido; e-mail transacional; Cloudflare Turnstile); passos manuais pendentes (proteção da `main`, sandbox do MP); seção de riscos com o custo por mensagem da Meta.

#### Fora do escopo
Roteiro de deploy, TLS e proxy reverso.

#### Especificação
Decidido:
- RN-1: todo comando documentado é executado pelo tester num clone limpo.
- RN-2: as variáveis citadas batem com `.env.example`.

#### Critérios de aceite
- [ ] CA-1: Dado um clone limpo, quando o tester executa `npm ci`, `docker compose up -d --wait`, `npm run test:coverage` e `npm run test:e2e` seguindo apenas o README, então todos terminam com código 0.
- [ ] CA-2: Dado o README, quando se lê a seção de serviços reais, então há uma subseção para cada um dos 4 provedores, com as variáveis exigidas.
- [ ] CA-3: Dado o README, quando se lê a seção de riscos, então o custo por mensagem da Meta está registrado como risco a acompanhar.
- [ ] CA-4: Dado a tabela de variáveis do README, quando comparada ao `.env.example`, então as duas listam as mesmas variáveis.

#### Validação
Verificação manual objetiva pelo tester em clone limpo, com saídas registradas.

### ITEM E9.4 | Validar os 11 critérios de aceite do PLAN e o gate de cobertura

#### Objetivo
Comprovar, com evidência, que a v1 atende ao PLAN.

#### Origem e contexto
PLAN.md, "Critérios de aceite"; CLAUDE.md, "Definição de pronto". Atual: inexistente.

#### Escopo
Execução, pelo tester, de cada um dos 11 CAs do PLAN (testes automatizados e passos manuais), do comando oficial de cobertura, do build/lint/typecheck e da suíte E2E; relatório com evidências e defeitos.

#### Especificação
Decidido:
- RN-1: cada CA do PLAN é ligado às evidências (teste, comando, saída) usando a tabela R1.
- RN-2: defeito crítico ou alto em aberto impede o fechamento.
- RN-3: cobertura de linhas ≥ 90% sem exclusões injustificadas nem testes sem asserções.
- RN-4: cobertura abaixo de 90% reabre o item responsável; nunca se resolve com exclusão.

#### Critérios de aceite
- [ ] CA-1: Dado a v1 completa, quando o tester executa o roteiro, então cada um dos 11 CAs do PLAN tem evidência registrada e resultado aprovado.
- [ ] CA-2: Dado o comando oficial de cobertura, quando executado, então reporta ≥ 90% de linhas e termina com código 0.
- [ ] CA-3: Dado a CI no commit final, quando consultada, então todos os jobs estão verdes.

#### Validação
Relatório do tester com veredito APROVADO.
