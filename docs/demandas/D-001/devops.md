# D-001 — Parecer DevOps sobre o backlog da v1

Entradas: `PLAN.md`, `CLAUDE.md`, `docs/demandas/D-001/spec.md` (itens `### ITEM`) e `docs/demandas/D-001/design.md` (prosa e bloco `json backlog`).
Nesta demanda nada é implementado: não há `package.json`, Dockerfile, compose nem CI de aplicação. Este parecer só ajusta o texto das issues. Nenhuma ferramenta nova foi adotada aqui; as sugestões abaixo usam a stack já decidida (Node 24 LTS + npm, Next.js, Prisma, pg-boss, Vitest, Playwright, Docker Compose, GitHub Actions).

Evidência do estado do remoto (somente leitura):
- `git ls-remote origin` → `refs/heads/main` em `7be485e` (merge do PR #1).
- `git show origin/main --stat` → só `.github/workflows/claude-code-review.yml` (revisão automática em `pull_request`) e `.github/workflows/claude.yml` (responde a `@claude` em issues e comentários). Nenhum workflow de build ou teste existe, então E0.3 não duplica nada. Os dois arquivos ficam fora do backlog. A CI nova deve usar outro nome de arquivo (`ci.yml`) e não pode alterar esses dois.

## 1. Parecer por item

### E0.1 — Scaffolding: **aprovado, com ajustes**
- Fixar a versão do Node para local, Docker e CI a partir de uma fonte única: `.nvmrc` (ou `.node-version`) com `24`, `engines.node` em `>=24 <25`, e `actions/setup-node` com `node-version-file`. Hoje só `engines` está previsto, e a CI não o lê.
- O script `lint` deve chamar `eslint .` direto. `next lint` foi descontinuado, e o `next build` atual não roda lint, então o gate de lint precisa ser um passo próprio.
- Usar um **único** comando de cobertura que rode os projetos `unit` e `integration` do Vitest **na mesma execução**, gerando um só relatório e um só limiar. Rodar os dois separadamente e somar os resultados não é o que o `CLAUDE.md` decidiu. A partir de E0.3/E0.4, `test:coverage` depende de um PostgreSQL acessível; o CA precisa dizer isso.
- Playwright: projeto `mobile` em **Chromium** com `viewport 375×812`, `isMobile` e `hasTouch`. Não instalar WebKit nem Firefox (CI mais rápida, menos dependências de sistema). O `webServer` do Playwright usa `next start` sobre o build, não `next dev`, para o resultado ser determinístico. A instalação do navegador (`npx playwright install --with-deps chromium`) entra no bloco de comandos.
- Saída do cliente Prisma gerado (Prisma 7 gera código TS no caminho configurado; sugestão `src/generated/prisma`): fica no `.gitignore`, no `ignores` do ESLint e na exclusão comentada da cobertura. Como E0.1 vem antes do Prisma, a exclusão pode entrar já em E0.1 ou em E0.2. O importante é que algum item a declare (ver ajustes).
- CA-1 deve partir de uma **instalação limpa** (`npm ci`), não de "dependências instaladas".
- CA-3 (gate falhando abaixo de 90%) é verificado numa alteração descartável, que não é commitada. Deixar isso explícito para ninguém commitar código sem teste só para provar o gate.

### E0.2 — docker-compose, Dockerfile, `.env.example`, bootstrap do Prisma e stub do worker: **aprovado, com ajustes importantes**
1. **Migrações sem corrida e sem quarto serviço.** O deliverable diz `docker/entrypoint.sh aplicando prisma migrate deploy`, mas não diz em qual container. Se app e worker migram juntos, as migrações disputam a mesma tabela. Proposta, mantendo os 3 serviços exigidos: só o `app` roda `prisma migrate deploy` no entrypoint. O `app` tem healthcheck HTTP em `GET /api/health` (faz `SELECT 1` e responde 200), e o `worker` usa `depends_on: app: condition: service_healthy`. Com isso, o worker só sobe com o esquema migrado.
2. **Sinais e PID 1.** O entrypoint termina com `exec node …`. O `CMD` não pode ser `npm run …`, porque o npm não repassa SIGTERM de forma confiável. Também vale `init: true` no compose. Sem isso, o SIGTERM gracioso de E0.7 não é testável no container.
3. **Execução do worker em produção.** O `src/worker/main.ts` precisa ser compilado no estágio de build da imagem (bundle JS em `dist/worker/main.js`). Rodar TS em runtime é frágil: a remoção de tipos nativa do Node não resolve aliases do `tsconfig` nem código TS não apagável. A ferramenta de bundle escolhida deve ser justificada no `devops.md` da demanda de implementação. O mesmo vale para `prisma/seed.ts` (E9.2), que precisa rodar dentro do container (`docker compose exec app npm run db:seed`) ou ter um comando documentado equivalente.
4. **Imagem.** Multi-stage com usuário não root, `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1` e `TZ=UTC`. O estágio final precisa do CLI do Prisma, de `prisma/migrations` e de `prisma.config.ts`. Se for usado `output: 'standalone'` do Next, esses arquivos não vêm por padrão e precisam ser copiados à parte.
5. **`DATABASE_URL` local × compose.** O mesmo `.env` serve aos dois modos: o `.env.example` aponta para `localhost:${POSTGRES_PORT}`, e o compose sobrescreve `DATABASE_URL` em `environment:` com o host `postgres`. Porta no host: `${POSTGRES_PORT:-5432}:5432`, o que resolve o caso "porta 5432 ocupada" já previsto na spec.
6. **Banco de testes separado.** Criar `TEST_DATABASE_URL` (base diferente da de desenvolvimento) para que testes de integração e E2E não apaguem os dados semeados de quem desenvolve. A estratégia de template por worker do Vitest (DBA, E0.5) exige um usuário com `CREATEDB`. O superusuário da imagem oficial serve para desenvolvimento e CI; isso precisa estar documentado.
7. **`APP_URL` não aparece em nenhum item.** Os links de confirmação de e-mail, recuperação e convite (E0.6 CA-3, E1.1, E1.3, E1.4) e a `notification_url` do Mercado Pago (E6.6) precisam da URL base pública. Incluir `APP_URL` no `env.ts` e no `.env.example` (padrão `http://localhost:3000`).
8. **Versão do PostgreSQL.** Fixar uma major (sugestão `postgres:17`) e usar a **mesma** no compose e no serviço da CI. "≥ 16" deixa as duas divergirem.
9. **README inicial.** O CA-2 do épico E0 ("dado um clone limpo, quando se seguem os passos de execução local") só é verificável se existir README antes de E9.3. E0.2 entrega a seção mínima "Executar com Docker" e "Testes". E9.3 consolida.
10. **CAs observáveis.** CA-1 deve virar: `cp .env.example .env && docker compose up -d --wait` termina com código 0; `docker compose ps` mostra `postgres` e `app` como `healthy` e `worker` como `running`; `curl -fsS http://localhost:3000/` responde 200. Acrescentar um CA de idempotência: `docker compose down && docker compose up -d --wait` sem `-v` sobe de novo, sem erro de migração. O CA-3 (toda variável lida está documentada) passa a ser **automático**: um teste unitário compara as chaves do schema zod de `src/server/env.ts` com as chaves do `.env.example` e falha se houver diferença.

### E0.3 — CI no GitHub Actions: **aprovado, com ajustes**
- Ordem dos gates no `ci.yml`: `npm ci` → `prisma generate` → typecheck → lint → build → `prisma migrate deploy` no serviço postgres → `test:coverage` (limiar de 90%) → E2E. Jobs paralelos são permitidos, mas cada job que roda typecheck, lint, build ou testes precisa do `prisma generate` antes (o cliente gerado não é versionado). Qualquer falha reprova o workflow.
- O serviço postgres usa a mesma imagem e versão do compose, com healthcheck (`pg_isready`). A extensão `btree_gist` vem com o contrib da imagem oficial, como o arquiteto já anotou.
- Incluir um job **`docker build`** (sem push) e `docker compose config`, para que o Dockerfile "preparado para VPS" não quebre sem ninguém ver. Push para registry fica fora (publicação é etapa posterior e exigiria segredos).
- `permissions: contents: read`, `concurrency` com `cancel-in-progress` por ref, `timeout-minutes` por job, cache do npm (`setup-node`) e dos navegadores do Playwright. Gatilhos: `pull_request` e `push` em `main`.
- Artefatos: relatório de cobertura (sempre) e traces e vídeos do Playwright (só em falha).
- **Pendência manual (fora do alcance dos agentes):** para que "qualquer falha reprova" bloqueie o merge, o dono do repositório precisa configurar a proteção da branch `main` exigindo os checks da CI. Registrar como passo manual na issue. Mudar configurações do repositório é ação externa e precisa de autorização explícita do usuário.
- CA-2 (PR com cobertura < 90% falha) usa um PR descartável, fechado sem merge. Deixar isso escrito.
- Dependência `E0.3 ← E0.2` com teste mínimo `SELECT 1`: **correta**.

### E0.6 — Portas, adaptadores e seleção por env: **aprovado, com ajustes**
- **Onde a validação roda.** Se o `env.ts`/`registry.ts` validar no momento do import, o `next build` (na CI e no `docker build`, que não têm `.env`) quebra, ou passa a exigir variáveis falsas no build. A validação precisa rodar **na inicialização**: um passo `check-env` executado pelo entrypoint antes de `next start` e no início do `src/worker/main.ts`, saindo com código ≠ 0. O `instrumentation.ts` do Next não garante que o processo morra.
- CA-2 observável: `EMAIL_ADAPTER=real` sem `SMTP_HOST` → `docker compose up app` deixa o container `app` em `exited (1)` e o log contém `SMTP_HOST`. O mesmo vale para o worker.
- **Chave pública do Turnstile.** Não usar `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Variáveis `NEXT_PUBLIC_*` são fixadas no bundle durante o build, e trocar a chave exigiria reconstruir a imagem. A chave deve ser lida no servidor em runtime (`TURNSTILE_SITE_KEY`) e passada ao widget por props.
- A URL base de cada adaptador real (SMTP host, `siteverify`, API do MP, Graph API) deve ser **injetável pelo construtor**, para os testes usarem o servidor HTTP local de stub sem env especial.
- Variáveis mínimas para o `.env.example`: `EMAIL_ADAPTER`, `WHATSAPP_ADAPTER`, `MP_ADAPTER`, `TURNSTILE_ADAPTER` (valores `simulado|real`, padrão `simulado`); `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM`; `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`. As credenciais reais ficam vazias. Nenhum adaptador registra token ou senha em log.

### E0.7 — Worker pg-boss e SIGTERM: **aprovado, com ajustes**
- Encerramento gracioso exige três coisas: `exec` no entrypoint (E0.2), `pg-boss.stop({ graceful: true, timeout })` e `stop_grace_period` do compose **maior** que o timeout de encerramento (sugestão: 30 s no compose, 25 s no worker). Os timeouts HTTP dos adaptadores (E7.2) ficam abaixo disso.
- Novo CA observável: com um job longo em andamento, `docker compose stop worker` faz o log mostrar o job concluído e o container sair com código 0 antes do `stop_grace_period`. O teste de integração equivalente envia SIGTERM ao processo filho do worker.
- Política de retry por env (`QUEUE_RETRY_LIMIT`, `QUEUE_RETRY_DELAY_SECONDS`, `QUEUE_RETRY_BACKOFF`), documentada no `.env.example`. Os testes do CA-2 sobrescrevem o atraso para ~1 s. Com o padrão sugerido (30 s e backoff), o teste ficaria lento ou instável na CI.
- O worker não expõe HTTP. O heartbeat em log basta para a v1; não é preciso healthcheck no compose.

### E4.2 — `TRUSTED_PROXY_HOPS` e rate limit: **aprovado, com ajustes**
- Regra a fixar na spec (hoje só o design cita `TRUSTED_PROXY_HOPS`; o RN-5 da spec ainda diz `TRUSTED_PROXY`, "não decidida"): com `TRUSTED_PROXY_HOPS=0` (padrão), o `X-Forwarded-For` enviado pelo cliente é **ignorado**. Com `N > 0`, o IP do cliente é a N-ésima entrada contada da direita. O implementador deve conferir como o servidor do Next.js preenche o endereço remoto (a API de rotas não expõe o socket) e registrar a regra exata no `dev.md`.
- Novo CA (anti-falsificação): com `TRUSTED_PROXY_HOPS=0`, N+1 requisições que trocam o `X-Forwarded-For` a cada vez recebem 429 na última. Com `TRUSTED_PROXY_HOPS=1` e `X-Forwarded-For: <forjado>, <cliente>`, o limite é contado para `<cliente>`.
- Limites por env: `RATE_LIMIT_IP_MAX`, `RATE_LIMIT_IP_JANELA_SEGUNDOS`, `RATE_LIMIT_TELEFONE_MAX`, `RATE_LIMIT_TELEFONE_JANELA_SEGUNDOS` (nomes sugeridos), no `.env.example` com os padrões de S7.
- Preparado para VPS: atrás de um proxy reverso, o operador define `TRUSTED_PROXY_HOPS=1`. Isso é documentado no README (E9.3). O proxy em si fica fora do escopo.

### E4.4 — E2E na CI: **aprovado, com ajustes**
- Todas as requisições do E2E saem do mesmo IP (127.0.0.1). Com 10 requisições por minuto por IP (S7), rodar a suíte duas vezes seguidas (CA-3) vai receber 429. O job de E2E deve definir limites altos por env. O cenário que testa o 429 fica na integração (E4.2), não no E2E.
- O E2E usa banco próprio (`TEST_DATABASE_URL`, ou uma base `e2e`), reiniciado e semeado no `globalSetup` (`e2e/support/reset-db.ts`), nunca a base de desenvolvimento. Os adaptadores são simulados, com o token fixo do Turnstile simulado.
- Na CI: serviço postgres → `migrate deploy` → seed → `npm run build` → Playwright com `webServer` `next start`. O worker não é necessário para as asserções de UI listadas. Se algum cenário passar a verificar a mensagem enviada, o worker tem de subir no job.
- `retries: 0` na CI, para que uma instabilidade apareça como falha e não seja mascarada (coerente com o CA-3).
- O salão suspenso do CA-2 pode ser preparado por fixture do E2E (atualização direta no banco de teste), sem exigir um terceiro salão no seed de E9.2.
- E4.4 atualiza a seção de E2E do README (pré-requisito `playwright install`, banco de E2E).

### E6.6 — Variáveis do Mercado Pago real: **aprovado, com ajustes**
- Variáveis: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PREAPPROVAL_PLAN_ID` (se for adotado o plano criado uma vez), todas vazias no `.env.example`. Ausentes com `MP_ADAPTER=real` → falha na inicialização (já está no CA-3).
- Com `MP_ADAPTER=real`, exigir `APP_URL` em `https://`: o MP precisa de URL pública para `notification_url` e `back_url`. Sem isso, falhar na inicialização com mensagem clara (novo CA).
- **Pendência manual:** a validação em sandbox (incluindo o spike de S12) precisa de uma URL pública HTTPS recebendo webhooks, seja por publicação ou por túnel. As duas coisas estão fora da v1 e exigem autorização do usuário. Registrar na issue como passo pendente, não como CA.

### E7.2 — Variáveis do WhatsApp real: **aprovado, com ajustes**
- Variáveis: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` (com padrão fixado), `WHATSAPP_TEMPLATE_CONFIRMACAO`, `WHATSAPP_TEMPLATE_REMARCACAO`, `WHATSAPP_TEMPLATE_CANCELAMENTO`, `WHATSAPP_TEMPLATE_IDIOMA` (padrão `pt_BR`).
- Timeout HTTP explícito, menor que o encerramento gracioso do worker (ver E0.7).
- Webhook de status de entrega da Meta: fora do escopo (o PLAN não exige). Deixar isso no "Fora do escopo" da issue, para não exigir URL pública.

### E9.3 — README: **aprovado, com ajustes**
- Dependências: o RN-2 ("as variáveis citadas batem com `.env.example`") exige que todas as variáveis existam quando o README for consolidado. As de E4.2 (rate limit, `TRUSTED_PROXY_HOPS`) não chegam a E9.3 por nenhuma cadeia atual. Incluir `E4.2` em `blocked_by` de E9.3. Isso não muda o caminho crítico: E9.3 passa da onda 11 para a 12, e E9.4 continua na 14.
- Conteúdo adicional: tabela de variáveis (nome, obrigatória em qual modo, padrão), instrução de proxy reverso (`TRUSTED_PROXY_HOPS`), `APP_URL`, comando do seed no container, instalação do navegador do Playwright, banco de testes separado e os passos manuais pendentes (proteção de branch, URL pública para webhooks do MP).
- O CA-1 deve listar os comandos executados pelo tester: `npm ci`, `docker compose up -d --wait`, `npm run test:coverage`, `npm run test:e2e`, cada um com código 0.
- Publicação em VPS: só "a imagem e o compose estão prontos; publicação é etapa posterior". Sem roteiro de deploy, TLS ou proxy, para respeitar o escopo.

### E6.6, E7.2 e E0.6 em conjunto (seleção por env)
Estão coerentes: cada adaptador real falha na inicialização sem a credencial, e o padrão é sempre simulado. A CI não precisa de nenhum segredo real, porque os workflows existentes do Claude são os únicos que usam `secrets`.

## 2. Ajustes pedidos ao analista

| chave | mudança concreta |
|---|---|
| E0.1 | CA-1: "Dado um clone limpo, quando se executa `npm ci` e depois o build, então ambos terminam com código 0". Escopo: `.nvmrc` com Node 24 como fonte única da versão; `lint` = `eslint .`; Playwright só com Chromium (375×812, `isMobile`, `hasTouch`) e `webServer` com `next start`. CA-3: verificado em alteração descartável, não commitada. RN: `test:coverage` roda `unit` e `integration` numa única execução do Vitest, com um só relatório e limiar. |
| E0.2 | Escopo: só o `app` roda `prisma migrate deploy`; `GET /api/health` (com `SELECT 1`) como healthcheck do app; `worker` com `depends_on: app: service_healthy`; entrypoint com `exec` e `init: true`; worker compilado para JS na imagem; imagem não root com `TZ=UTC`; `${POSTGRES_PORT:-5432}`; o compose sobrescreve `DATABASE_URL`; novas variáveis `APP_URL` e `TEST_DATABASE_URL`; mesma major do Postgres na CI; README inicial ("Executar com Docker" e "Testes"); exclusão comentada do cliente Prisma gerado (lint, cobertura, `.gitignore`); script `db:generate`. CA-1: `cp .env.example .env && docker compose up -d --wait` termina com código 0, `docker compose ps` mostra postgres e app `healthy` e worker `running`, `curl -fsS localhost:3000/` responde 200. Novo CA: `down` seguido de `up -d --wait` (sem `-v`) sobe sem erro de migração. CA-3: verificado por teste unitário que compara as chaves do schema de `src/server/env.ts` com as do `.env.example`. |
| E0.3 | Especificação: ordem dos gates `npm ci → prisma generate → typecheck → lint → build → migrate deploy → test:coverage → e2e`; job `docker build` (sem push) e `docker compose config`; `node-version-file: .nvmrc`; `permissions: contents: read`; `concurrency`; artefatos. Pendência manual: proteção da branch `main` exigindo os checks (feita pelo dono do repositório). CA-2: o PR de teste é descartável e fechado sem merge. Fora do escopo: push de imagem, deploy, alteração dos workflows do Claude existentes. |
| E0.6 | RN-5: a validação roda na inicialização (passo `check-env` no entrypoint do app e no início do worker), nunca no import nem no `next build`. CA-2: "o container sai com código ≠ 0 e o log nomeia `SMTP_HOST`". Novo RN: a chave pública do Turnstile é lida em runtime no servidor (`TURNSTILE_SITE_KEY`), sem `NEXT_PUBLIC_*`. Novo RN: a URL base dos adaptadores reais é injetável pelo construtor. Listar as variáveis da seção 1 (E0.6). Nenhum token em log. |
| E0.7 | Novo CA: com um job longo em andamento, `docker compose stop worker` termina o job e sai com código 0 antes do `stop_grace_period` (30 s). Especificação: `stop({ graceful: true })` com timeout menor que o grace period; retry por env (`QUEUE_RETRY_LIMIT`, `QUEUE_RETRY_DELAY_SECONDS`, `QUEUE_RETRY_BACKOFF`), com atraso de cerca de 1 s nos testes. |
| E4.2 | RN-5 decidido: `TRUSTED_PROXY_HOPS` (padrão 0 = ignora `X-Forwarded-For`; N > 0 = N-ésima entrada a partir da direita). Novo CA anti-falsificação (seção 1, E4.2). Variáveis de limite nomeadas no `.env.example`. |
| E4.4 | Especificação: banco de E2E separado, reiniciado e semeado no `globalSetup`; limites de rate limit elevados por env no E2E (o 429 é testado em E4.2); `retries: 0` na CI; salão suspenso via fixture; worker fora do E2E enquanto nenhum cenário verificar o envio. Atualizar a seção de E2E do README. |
| E6.6 | Variáveis `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PREAPPROVAL_PLAN_ID`. Novo CA: `MP_ADAPTER=real` com `APP_URL` sem `https://` → falha na inicialização nomeando `APP_URL`. Pendência (não é CA): validação em sandbox exige URL pública HTTPS e autorização do usuário. |
| E7.2 | Listar as variáveis da seção 1 (E7.2); timeout HTTP explícito menor que o encerramento do worker; "Fora do escopo": webhook de status de entrega da Meta. |
| E9.3 | Escopo: tabela de variáveis (nome, modo em que é obrigatória, padrão), `TRUSTED_PROXY_HOPS` atrás de proxy, `APP_URL`, seed no container, `playwright install`, banco de testes, passos manuais pendentes. CA-1 com os comandos explícitos (`npm ci`, `docker compose up -d --wait`, `npm run test:coverage`, `npm run test:e2e`, todos com código 0). Fora do escopo: roteiro de deploy, TLS e proxy reverso. |

## 3. Ajustes pedidos ao arquiteto

| chave | mudança no JSON |
|---|---|
| E9.3 | `blocked_by`: acrescentar `"E4.2"` (variáveis de rate limit e de proxy). Não muda o caminho crítico. |
| E0.1 | `deliverables`: acrescentar `".nvmrc (Node 24) como fonte única da versão para Docker e CI"`; trocar o item do Playwright por `"playwright.config.ts com projeto mobile Chromium 375x812 (isMobile, hasTouch) e webServer via next start"`. |
| E0.2 | `deliverables`: trocar `"docker/entrypoint.sh aplicando prisma migrate deploy"` por `"docker/entrypoint.sh (exec; check-env; prisma migrate deploy só no app) e GET /api/health com SELECT 1; worker com depends_on app service_healthy"`; acrescentar `"Worker compilado para JS no build da imagem; imagem não root com TZ=UTC"`, `"Variáveis APP_URL, TEST_DATABASE_URL e POSTGRES_PORT"`, `"README.md inicial: Executar com Docker e Testes"` e `"Teste unitário que confere .env.example contra o schema de src/server/env.ts"`. |
| E0.3 | `deliverables`: acrescentar `"Job docker build (sem push) e docker compose config"` e `"Pendência manual registrada: proteção da branch main exigindo os checks"`. |
| E0.7 | `deliverables`: acrescentar `"stop_grace_period 30s no serviço worker do compose e teste de SIGTERM com job em andamento"`. |
| E4.4 | `deliverables`: acrescentar `"Job de E2E na CI com banco próprio e rate limit elevado por env"` e `"README: seção de E2E"`. |
| E0.8 | Texto: `@axe-core/playwright` aparece sem crase num deliverable. Ao publicar, colocar o nome do pacote entre crases (ver risco R4). |

## 4. Riscos

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R1 | `.github/workflows/claude.yml` no `main` reage a `issues: opened` quando título ou corpo contém `@claude` | Publicar as 55 issues poderia disparar dezenas de execuções e consumir o token do Claude | Hoje nenhum texto de spec ou design contém `@claude` (conferido com `grep -n "@"`). O script de publicação (T-5) deve verificar a ausência de `@claude` antes de criar cada issue. |
| R2 | `.github/workflows/claude-code-review.yml` roda em todo PR, inclusive nos PRs descartáveis de E0.3 CA-2 | Custo e ruído nos PRs de teste | Aceitável. Registrar na issue E0.3 que esse workflow não faz parte dos gates exigidos. |
| R3 | Sem proteção de branch, a CI vermelha não impede o merge | A definição de pronto pode ser burlada | Pendência manual em E0.3, executada pelo dono do repositório com autorização. |
| R4 | `@pacote` sem crase no corpo da issue vira menção a uma conta ou organização do GitHub | Notificação indevida a terceiros | Envolver em crases todo identificador iniciado por `@` ao gerar os corpos (E0.8 hoje). |
| R5 | Validação de env no import quebra `next build` e `docker build` | CI e imagem falham sem `.env` | RN de E0.6: validação só na inicialização. |
| R6 | `NEXT_PUBLIC_*` fixado no build | Trocar a chave do Turnstile exige rebuild da imagem | Chave lida em runtime (E0.6). |
| R7 | Rate limit por IP no E2E (todas as requisições de 127.0.0.1) | E2E instável ou falhando na segunda execução | Limites elevados por env no job E2E (E4.4). |
| R8 | Corrida de migração entre app e worker | Falha intermitente ao subir | Só o app migra; o worker espera o app ficar `healthy` (E0.2). |
| R9 | Testes de integração ou E2E apontando para a base de desenvolvimento | Perda dos dados de demonstração locais | `TEST_DATABASE_URL` separado (E0.2, E4.4). |
| R10 | Webhooks do MP e validação em sandbox exigem URL pública | CA real de E6.6 não verificável localmente | Fica como pendência documentada. Publicação ou túnel só com autorização do usuário (etapa posterior). |
| R11 | Divergência de versões (Node, Postgres) entre local, Docker e CI | "Passa local, falha na CI" | `.nvmrc` e a mesma imagem do Postgres nos três ambientes (E0.1, E0.2, E0.3). |
