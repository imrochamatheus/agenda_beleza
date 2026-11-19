# D-007 (E0.6): DevOps, T-8 (revisão leve)

Autor: devops. Data: 2026-11-19.
Entradas: `design.md` (T-8, §5, R-6, R-7), `spec.md` (CA-1, CA-2, CA-6, CA-25, D-5) e `dev.md` (pendências da T-8).
Código revisado: árvore de trabalho sem commit. O checkout estava em `docs/d-006-encerramento`, e não em `feat/d-007-adaptadores`, com as mudanças da D-007 não commitadas. As evidências valem para essa árvore.

## 1. O que mudou e por quê

**Nenhum arquivo de infraestrutura mudou.** `Dockerfile`, `docker/entrypoint.sh`, `docker-compose.yml`, `.dockerignore` e `.github/workflows/ci.yml` estão idênticos aos da `main` (`git diff --stat main` sem saída). Cada um continua atendendo à D-007 sem alteração:

- **`docker/entrypoint.sh`:** já roda `node dist/scripts/check-env.js` antes do `case`, nos dois papéis. Com `set -eu`, uma falha do check-env impede o `prisma migrate deploy` (CA-2).
- **`Dockerfile`:** o `nodemailer` está em `dependencies` (`package.json`, versão exata `10.3.1`), por isso sobrevive ao `npm prune --omit=dev`. O Turbopack empacota o pacote no chunk do servidor quando uma rota importa o registro (seção 4.4), e `next.config.ts` não precisou de `serverExternalPackages`.
- **`docker-compose.yml`:** o `.env` é opcional (`required: false`). Os seletores e as variáveis `SMTP_*` e `TURNSTILE_*` chegam pelo `env_file`.
- **CI:** sem mudança (seção 4.5).

Nenhuma ferramenta nova foi adotada.

## 2. Variáveis de ambiente

As variáveis novas são de responsabilidade do T-2/T-7: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM`, `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY`. A revisão está na seção 5. Todas estão vazias no `.env.example`, os quatro seletores estão em `simulado`, e não há nenhum valor secreto versionado.

## 3. Comandos para reproduzir

```bash
# CA-6: build sem .env (o .dockerignore exclui .env) e job docker da CI
docker compose config -q
docker build --target final --tag agenda-beleza:ci .

# CA-1
cp .env.example .env
docker compose build app && docker compose up -d --wait
docker compose logs app worker | grep -E "check-env|worker.adaptadores"

# CA-2 (app já no ar: o worker depende de app healthy; ver R-T8-3)
docker compose run --rm -e EMAIL_ADAPTER=real -e SMTP_HOST= app;    echo $?
docker compose run --rm -e EMAIL_ADAPTER=real -e SMTP_HOST= worker; echo $?

# Encerrar sem apagar o volume
docker compose rm -sf app worker      # ou: docker compose down (sem -v)
```

## 4. Evidências (2026-11-19, Docker 29.8.1, Compose v5.5.1)

### 4.1 CA-6: build sem `.env`
A prova roda dentro de imagens, porque o `.dockerignore` exclui `.env`, `.next` e `dist`. Assim não há concorrência com o `.next/` do T-7.

- **`docker compose build --progress=plain app` (sem `.env` no host):** exit 0. No passo `RUN npm run db:generate && npm run build && npm run build:node && npm prune --omit=dev`, o build não emitiu nenhum aviso nem erro:
  ```
  ✓ Compiled successfully
  Route (app)
  ┌ ○ /
  ├ ○ /_not-found
  ├ ƒ /api/health
  ├ ƒ /dev/mp-checkout
  └ ƒ /dev/mp-checkout/decisao
  dist/worker/main.js 7.2kb   dist/scripts/check-env.js 6.6kb
  removed 381 packages, and audited 188 packages
  ```
- **Imagem descartável antes do prune** (`node:24-trixie-slim` + `npm ci` + `db:generate`, com `test ! -e .env`), sem `DATABASE_URL`, `SMTP_*` nem `TURNSTILE_*` no ambiente:

  | Ambiente | `npm run build` | `npm run build:node` | Rotas `/dev/*` |
  |---|---|---|---|
  | sem seletores | 0, sem aviso | 0 | `ƒ` e `ƒ` |
  | `EMAIL_ADAPTER=real SMTP_HOST= TURNSTILE_ADAPTER=real` | 0, sem aviso | 0 | `ƒ` e `ƒ` |
  | os quatro seletores `real` | 0, sem aviso | não rodado | não aplicável |
- **Equivalente do job `docker` da CI:** `docker compose config -q` deu exit 0, e `docker build --target final --tag agenda-beleza:ci .` também deu exit 0.

### 4.2 CA-1: `docker compose up -d --wait` com `.env` copiado do exemplo
Primeiro `docker compose build app`, depois `cp .env.example .env` e `docker compose up -d --wait`. Resultado: exit 0, e `app`, `worker` e `postgres` ficaram healthy ou em execução.
```
# app
check-env: ambiente válido (adaptadores: email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)
4 migrations found in prisma/migrations
Applying migration `20261119000000_simuladores_integracao`
All migrations have been successfully applied.
✓ Ready in 136ms
# worker
check-env: ambiente válido (adaptadores: email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)
{"evento":"worker.adaptadores","email":"simulado","mercadoPago":"simulado","turnstile":"simulado","whatsapp":"simulado"}
{"evento":"worker.heartbeat","em":"2026-11-19T09:18:36.398Z"}
```
- **Nenhum segredo no log:** `docker compose logs app worker | grep -cE 'agenda_dev|postgresql://'` retornou `0`.
- **Sondagem, com a stack no ar:**
  - `GET /api/health` → 200;
  - `GET /dev/mp-checkout` → 404 (sem ID), com `<meta name="robots" content="noindex"/>`;
  - `GET /dev/mp-checkout?assinatura=nao-existe` → 404;
  - `POST /dev/mp-checkout/decisao` com `Origin: https://evil.example` e ID inexistente → 404.

### 4.3 CA-2: modo real sem `SMTP_HOST`
Com o `.env` do exemplo, `docker compose run --rm -e EMAIL_ADAPTER=real -e SMTP_HOST=` deu o mesmo resultado nos dois serviços:

| Serviço | Exit | Saída | Linhas com `migrat`/`prisma` |
|---|---|---|---|
| `app` | **1** | `check-env: Variáveis de ambiente ausentes ou inválidas: EMAIL_FROM, SMTP_HOST` | **0** (o `migrate deploy` não rodou) |
| `worker` | **1** | `check-env: Variáveis de ambiente ausentes ou inválidas: EMAIL_FROM, SMTP_HOST` | 0 |

`EMAIL_FROM` também aparece porque está vazio no `.env.example` e é obrigatório no modo real (RN-13). A saída nomeia só as variáveis, nunca os valores.

### 4.4 `nodemailer` na imagem e no bundle (R-6)
- **Imagem final `agenda-beleza:dev`:** usuário `node`, `NODE_ENV=production`, `require('/app/node_modules/nodemailer/package.json').version` → `10.3.1`, com 143 pacotes em `node_modules`. Os bundles `dist/scripts/check-env.js` e `dist/worker/main.js` só importam `zod` como pacote externo, ou seja, o check-env não carrega o `nodemailer`.
- **Build atual:** nenhuma rota do Next importa o registro, então nenhum chunk contém fonte de `node_modules/nodemailer` (os `.map` só mencionam o nome em `sourcesContent`). Isso é esperado. O registro entra no bundle a partir da E1.1.
- **Prova descartável, dentro do container e sem tocar na árvore:**
  - criei a rota `src/app/prova-t8/route.ts` (`force-dynamic`), que devolve `integracoes().modos`;
  - `npm run build` deu exit 0, sem aviso, com `ƒ /prova-t8`. O chunk `.next/server/chunks/[root-of-the-server]__…js.map` tem **39 fontes de `node_modules/nodemailer/`**, e não há `require("nodemailer")` externo;
  - depois de `npm prune --omit=dev`, o `node_modules/nodemailer` continua presente (10.3.1);
  - em seguida, **removi `node_modules/nodemailer`** e subi `next start` com `EMAIL_ADAPTER=real SMTP_HOST=127.0.0.1 EMAIL_FROM=…`. `GET /prova-t8` → `200 {"modos":{"email":"real",…}}`. Conclusão: o pacote está de fato empacotado no chunk do servidor. A cópia em `node_modules` serve de redundância (e aos testes).
  - Isso confirma o R-6 do `dev.md`: `serverExternalPackages` não é necessário.

### 4.5 CI (`.github/workflows/ci.yml`)
- **Sem segredos:** `grep -c 'secrets\.'` → 0 e `grep -c '_ADAPTER'` → 0. Os adaptadores ficam no padrão `simulado`.
- **Stubs:** `tests/support/stubs/http.ts` e `smtp.ts` usam `listen(0, '127.0.0.1')`, ou seja, porta efêmera no loopback. Isso funciona no `ubuntu-latest` sem `services` nem portas publicadas. Nenhum teste chama a rede externa: a única URL real (`challenges.cloudflare.com`) aparece só como asserção de constante em `turnstile/real.test.ts`.
- **Jobs:**
  - `testes` aplica a nova migração com `npm run db:migrate:deploy` antes do `test:coverage`;
  - `build` e `docker` não precisam de `.env` (seção 4.1);
  - `e2e` não acessa `/dev/mp-checkout`.
- **Conclusão:** o workflow não precisa mudar. **Pendente:** o run verde no PR, porque ainda não há commit nem PR da D-007 (ver seção 6).

### 4.6 Encerramento do ambiente
- Rodei `docker compose rm -sf app worker`: app e worker foram removidos, e a porta 3000 ficou livre (`ss -ltn | grep -c ':3000 '` → 0).
- O volume `agenda_beleza_pgdata` foi mantido, e o `postgres` continua no ar, como estava antes da T-8 (o T-7 depende dele para `npm test`).
- Removi o `.env` temporário, porque ele não existia antes. Também removi as imagens descartáveis (`agenda-beleza:t8-build`, `agenda-beleza:t8-ca6` e `agenda-beleza:ci`). A `agenda-beleza:dev` foi reconstruída com o código da D-007.
- Efeito colateral: a base de desenvolvimento (`agenda_beleza`, não a de testes) agora tem a migração `20261119000000_simuladores_integracao` aplicada (ver R-T8-4).

## 5. Revisão do `.env.example` e do README: ajustes pedidos ao T-7

O `.env.example` está **aprovado sem ajuste**:
- as chaves batem com `chavesDeclaradas()`;
- as credenciais estão vazias e os seletores em `simulado`;
- vazio conta como ausente (`semVazias`), então `SMTP_PORT=` e `SMTP_SECURE=` não quebram o modo simulado. Isso foi provado no CA-1, com o `.env` copiado sem alterações.

O README (seções "Integrações (adaptadores)" e "Credenciais para os serviços reais") cobre o CA-25: `SMTP_*`, `EMAIL_FROM`, `TURNSTILE_*`, o token simulado, o `psql` do `email_log`, `/dev/mp-checkout`, a marcação E6.6/E7.2 e o aviso do R-7. Os ajustes pedidos não bloqueiam:

1. **A-1 (baixa).** No exemplo "`EMAIL_ADAPTER=real` sem `SMTP_HOST` nomeia `SMTP_HOST`", acrescentar que, com o `.env.example` sem alterações, a saída real é `EMAIL_FROM, SMTP_HOST`, porque `EMAIL_FROM` também é obrigatório. Assim ninguém estranha a linha.
2. **A-2 (baixa).** No aviso do modo simulado, acrescentar que o `POST /dev/mp-checkout/decisao` não verifica a origem (não tem proteção CSRF própria). Hoje o texto só cita "quem souber o ID".
3. **A-3 (média, processo).** O `.vitest/json/output.json` está como não rastreado na raiz. É saída de algum reporter JSON (provavelmente o laço do CA-21) e não pode entrar no commit. Apagar o diretório, ou pedir ao líder que inclua `.vitest/` no `.gitignore`. Esse arquivo não pertence a nenhuma tarefa. Ele também entra no contexto do `docker build`, porque não está no `.dockerignore`, mas é inofensivo.

## 6. Riscos e passos manuais pendentes

- **R-7 / D-5: simulados num ambiente publicado (alto, para a etapa de publicação).**
  - **Risco:** com `MP_ADAPTER=simulado`, `/dev/mp-checkout` e `POST /dev/mp-checkout/decisao` ficam acessíveis sem sessão. Quem tiver o ID de uma assinatura consegue autorizá-la. O handler não verifica `Origin`/`Referer` nem usa token CSRF (conferido em `src/app/dev/mp-checkout/decisao/route.ts`), então um formulário de outra origem também consegue postar. O redirecionamento usa só a `urlRetorno` gravada, então não há open redirect. Os demais simulados fazem os e-mails e as mensagens de WhatsApp "sumirem" em silêncio, e o Turnstile simulado aceita um token público.
  - **Mitigação atual:** a rota responde 404 fora do modo simulado (sem consultar o banco) e tem `noindex`. O README traz o aviso.
  - **Recomendações para a etapa de publicação (`PLAN.md:147`):**
    - (a) uma variável explícita, por exemplo `AMBIENTE=publicado`, que faça o check-env **recusar qualquer seletor `simulado`**, com exit ≠ 0. Essa variável deve ser definida no provedor, nunca no `.env.example`;
    - (b) o pipeline de deploy deve conferir que os quatro seletores estão em `real` antes de promover a imagem;
    - (c) como defesa em profundidade, bloquear `/dev/*` no proxy ou CDN do ambiente publicado;
    - (d) se o checkout simulado for mantido em homologação pública, verificar `Origin` contra `APP_URL` no handler.
  - **Observação:** `NODE_ENV=production` sozinho **não** serve de critério, porque a imagem local já roda assim (D-5).
- **R-T8-1 (médio): CI verde ainda não comprovada.** Não há commit nem PR da D-007. O líder ou o tester devem confirmar os 6 checks verdes no PR antes do encerramento. Os comandos foram reproduzidos localmente nas seções 4.1 e 4.5 (só o job `docker` foi executado de forma integral).
- **R-T8-2 (baixo): branch.** A árvore com a D-007 está em `docs/d-006-encerramento`, e não em `feat/d-007-adaptadores`. Confira a branch antes do commit.
- **R-T8-3 (baixo, para o tester):** `docker compose run … worker` sobe o `app` como dependência (`depends_on: app: service_healthy`), e com isso **ocupa a porta 3000** se o app não estiver no ar. Para o CA-2 do worker sem subir o app, use `docker compose run --rm --no-deps -e EMAIL_ADAPTER=real -e SMTP_HOST= worker`. Como o check-env falha antes, o resultado é o mesmo. Depois, libere a porta 3000 antes do E2E.
- **R-T8-4 (baixo):** a migração da D-007 já está aplicada no volume de desenvolvimento. Se o SQL dela mudar antes do merge, o `migrate deploy` vai acusar migração alterada. Nesse caso, recrie só a base de desenvolvimento (`docker compose down -v`, com autorização do usuário, porque apaga os dados locais) ou use `prisma migrate resolve`.
- **Nenhum segredo real foi criado, alterado ou versionado. Nenhum deploy remoto foi feito.**

## 7. Veredito da revisão

**APROVADO, sem mudança de infraestrutura.** CA-1, CA-2 e CA-6 foram comprovados por processo. O `nodemailer` está na imagem final e empacotado no chunk do servidor quando importado. A CI não precisa de alteração e continua sem segredos. Pendências não bloqueantes: os ajustes A-1 a A-3 do T-7 e o run verde no PR (R-T8-1).
