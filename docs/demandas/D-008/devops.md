# D-008 (E0.7): DevOps

Responsável: devops. Parte 1 = T-3 (rodada 1). A parte 2 (T-10: verificação manual do CA-4, `import('pg-boss')` na imagem e CI verde no PR) entra depois do T-8.

## Parte 1 (T-3)

### 1. O que mudou e por quê

| Arquivo | Mudança |
|---|---|
| `docker-compose.yml` | `stop_grace_period: 30s` no serviço `worker`, com um comentário. Depois do SIGTERM, o worker espera até 25 s (`TIMEOUT_ENCERRAMENTO_MS`, RN-4) pelos jobs em andamento. O padrão do Docker é mandar SIGKILL após 10 s, o que cortaria o encerramento gracioso. Com 30 s sobram 5 s para o `stop()` do pg-boss, os logs e a saída (CA-14; o `compose.test.ts` do T-8 compara 30 000 > `TIMEOUT_ENCERRAMENTO_MS`). |

Sem mudança no `Dockerfile` nem no `entrypoint.sh`. O sinal já chega ao Node, porque o compose usa `init: true` (o tini repassa o SIGTERM) e o `entrypoint.sh` faz `exec node /app/dist/worker/main.js`.

Nenhuma ferramenta nova e nenhuma variável de ambiente nova vêm do DevOps. As variáveis de retry da fila (D-2) são do T-1 (desenvolvedor), no `.env.example`.

### 2. Evidência: compose

```
$ docker compose version
Docker Compose version v5.5.1
$ docker compose config >/dev/null && echo CONFIG_OK
CONFIG_OK
$ docker compose config --format json | jq -r '.services.worker.stop_grace_period'
30s
$ docker compose config | awk '/^  worker:/{f=1} f&&/stop_grace_period/{print; exit}'
    stop_grace_period: 30s
# sem .env (o repositório não tem .env nesta máquina; mesma situação do job `docker` da CI)
$ docker compose --env-file /dev/null config -q && echo CONFIG_SEM_ENV_OK
CONFIG_SEM_ENV_OK
```

O job `docker` da CI roda `docker compose config` e `docker build --target final`. A chave nova é válida no schema do Compose, então o primeiro passo continua passando. O build da imagem muda só por causa das dependências novas (T-1), e o T-10 confere isso no PR.

### 3. CI (`.github/workflows/ci.yml`): sem mudança

- **Gates:** os testes novos da D-008 (unidade, integração, `sigterm.test.ts` com processo filho e `compose.test.ts` com leitura de arquivo) estão em `src/**` e `tests/integration/**`. Eles já entram no `npm run test:coverage` do job `testes`, que tem um service `postgres:17`. O `sigterm.test.ts` empacota o worker dentro do próprio teste (design §3.10) e não precisa de um passo `build:node` na CI. Não há serviço, segredo nem passo novo.
- **Tempo do job `testes`:** a última medição registrada é de **1 min 27 s** (D-006, `devops.md`). O design estima 30 a 40 s de parede a mais (R-10: CA-3 de cerca de 2 s, CA-2 até 7 s, CA-4 com job de 5 s, filho e esbuild, em arquivos separados distribuídos pelos 4 workers do runner). Mesmo dobrando a estimativa, o job fica em torno de 3 min, bem abaixo do `timeout-minutes: 20`. O `testTimeout` por teste (30 s; 60 s no CA-4) é o que limita um travamento antes do timeout do job.
- **Limitação:** não consegui consultar os runs recentes (`gh run list` → `dial tcp …:443: i/o timeout`: sem rede para api.github.com nesta sessão). O tempo real do job `testes` com a D-008 será registrado na parte 2, a partir do run do PR.

### 4. Imagem: `pg-boss` e `@opentelemetry/api` depois do `npm prune --omit=dev` (plano para o T-10)

O `build:node` usa `--packages=external`, então `dist/worker/main.js` resolve o `pg-boss` em `node_modules` em tempo de execução. Por isso o pacote precisa sobreviver ao `npm prune --omit=dev` do estágio `build`, que é copiado para a imagem `final`.

Pré-checagem feita agora (árvore de produção do lock, já com o T-1 aplicado: `package.json` tem `"pg-boss": "12.38.0"` e `"@opentelemetry/api": "1.10.0"` em `dependencies`):

```
$ npm ls --omit=dev pg-boss @opentelemetry/api
├── @opentelemetry/api@1.10.0
├─┬ next@16.4.6
│ └── @opentelemetry/api@1.10.0 deduped
└─┬ pg-boss@12.38.0
  └── @opentelemetry/api@1.10.0 deduped
```

Os dois pacotes estão na árvore de produção, e o peer do pg-boss (`@opentelemetry/api ^1.9.0`) é satisfeito pela versão declarada.

Verificação na imagem (T-10, depois do T-8, para incluir `dist/scripts/enfileirar-exemplo.js`):

```
docker compose build
docker run --rm --entrypoint node agenda-beleza:dev -e "import('pg-boss').then(()=>console.log('ok'))"
docker run --rm --entrypoint node agenda-beleza:dev -e "import('@opentelemetry/api').then(()=>console.log('ok'))"
docker run --rm --entrypoint ls agenda-beleza:dev -l dist/worker/main.js dist/scripts/enfileirar-exemplo.js
```

Esperado: `ok`, `ok` e os dois arquivos listados. O `import` direto do pg-boss carrega `dist/telemetry.js`, que importa o `@opentelemetry/api` estaticamente, então a primeira linha já cobre o peer. A segunda deixa a evidência explícita.

### 5. Política `restart` para o worker (design §5, item 5): recomendação, não aplicada

**Recomendação: não adotar no compose local nesta demanda.** Se for adotada no futuro, usar `restart: on-failure:5`, nunca `always`/`unless-stopped`.

Motivos:
- No compose local, uma falha de início (`worker.falha_inicio`, saída 1: base inacessível, política de fila divergente) ou de `check-env` é um erro de configuração. Reiniciar repetiria o mesmo erro e esconderia a causa num laço de logs. Com a saída 1 e sem reinício, `docker compose ps -a worker` mostra `Exited (1)` e a causa fica clara.
- `docker compose stop` não dispara a política `restart` (parada manual). Então a política não interfere no CA-4, nem quando o encerramento forçado sai com 1. O ganho real seria só contra quedas em execução, como a perda de conexão com o PostgreSQL, o que é cenário de implantação e não de ambiente local.
- O `depends_on: app: service_healthy` já evita a falha de início mais comum, que é a corrida com as migrações.

Ponto para a preparação de implantação (fora da v1 local): lá a reinicialização automática é desejável, com limite (`on-failure` com um teto ou o equivalente do orquestrador) e um alerta em `worker.falha_inicio`. Como o design não pede, não muda o compose nem o README nesta rodada.

### 6. Comandos para reproduzir

```
docker compose config --format json | jq -r '.services.worker.stop_grace_period'   # 30s
docker compose --env-file /dev/null config -q                                       # exit 0
npm ls --omit=dev pg-boss @opentelemetry/api
```

### 7. Riscos e pendências

- **Pendência (T-10):** verificação manual do CA-4 (`time docker compose stop worker`, `Exited (0)` em menos de 30 s), a checagem da imagem do §4 e o tempo real do job `testes` no run do PR.
- **Risco baixo:** se o `TIMEOUT_ENCERRAMENTO_MS` subir no futuro, o `stop_grace_period` precisa subir junto. O `compose.test.ts` (T-8) falha se a relação 30 s > timeout quebrar.
- **README:** nenhuma mudança pedida pelo DevOps nesta rodada. Se o T-9 documentar o encerramento do worker, vale citar que `docker compose stop worker` pode levar até 30 s.
- Nenhum segredo ou credencial foi tocado.

## Parte 2 (T-10)

### 1. O que mudou e por quê

Nada mudou na infraestrutura. Nenhum arquivo além deste foi alterado: o `docker-compose.yml` e o `Dockerfile` ficaram como na parte 1, e a política `restart` continua não adotada (parte 1, §5). O T-10 é só verificação. Nenhuma ferramenta e nenhuma variável nova.

### 2. Evidência: build e imagem (pendência da parte 1, §4)

Executado em 2026-11-19 na branch `feat/d-008-fila-worker` (código do T-1..T-9 não commitado), com o `.env` local (adaptadores `simulado`).

```
$ docker compose build
...
#20 naming to docker.io/library/agenda-beleza:dev done
 Image agenda-beleza:dev Built

$ docker run --rm --entrypoint node agenda-beleza:dev -e "import('pg-boss').then(()=>console.log('ok'))"
ok
$ docker run --rm --entrypoint node agenda-beleza:dev -e "import('@opentelemetry/api').then(()=>console.log('ok'))"
ok
$ docker run --rm --entrypoint ls agenda-beleza:dev -l dist/worker/main.js dist/scripts/enfileirar-exemplo.js
-rw-r--r-- 1 node node 14268 Nov 19 14:50 dist/scripts/enfileirar-exemplo.js
-rw-r--r-- 1 node node 18097 Nov 19 14:50 dist/worker/main.js
$ docker run --rm --entrypoint sh agenda-beleza:dev -c "grep '\"version\"' node_modules/pg-boss/package.json node_modules/@opentelemetry/api/package.json"
node_modules/pg-boss/package.json:  "version": "12.38.0",
node_modules/@opentelemetry/api/package.json:  "version": "1.10.0",
```

Os dois pacotes sobrevivem ao `npm prune --omit=dev`, nas versões exatas do lock, e o bundle do script de exemplo está na imagem `final`. (Um `require('@opentelemetry/api/package.json')` falha com `ERR_PACKAGE_PATH_NOT_EXPORTED` porque o pacote não exporta esse subcaminho. Isso não é defeito; por isso a versão foi lida com `grep`.)

### 3. Evidência: subida do ambiente

```
$ docker compose up -d --wait
 Container agenda_beleza-worker-1 Healthy
 Container agenda_beleza-postgres-1 Healthy
 Container agenda_beleza-app-1 Healthy

$ docker compose logs worker
worker-1  | check-env: ambiente válido (adaptadores: email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)
worker-1  | {"evento":"worker.adaptadores","em":"2026-11-19T14:52:02.939Z","email":"simulado","mercadoPago":"simulado","turnstile":"simulado","whatsapp":"simulado"}
worker-1  | {"evento":"worker.job_concluido","em":"2026-11-19T14:52:03.028Z","fila":"reconciliar-mensagens","id":"cc639485-…","tentativa":1}
worker-1  | {"evento":"worker.job_concluido","em":"2026-11-19T14:52:03.029Z","fila":"assinatura-prazos","id":"4639b081-…","tentativa":1}
worker-1  | {"evento":"worker.iniciado","em":"2026-11-19T14:52:03.033Z","filas":["assinatura-prazos","exemplo","reconciliar-mensagens","whatsapp-reserva"]}
worker-1  | {"evento":"worker.heartbeat","em":"2026-11-19T14:52:03.033Z"}
```

Logs JSON em stdout, `worker.iniciado` com as quatro filas e o heartbeat. O worker não tem healthcheck (RN-6), então o `--wait` só espera ele ficar `running`.

Observação (não é defeito): os dois `job_concluido` dos crons logo no início vieram de um `__pgboss__send-it` pendente de uma subida anterior às 14:45 (`pgboss.job`, `singleton_on = 14:45:00`), processado assim que o worker voltou. É o comportamento normal do agendador do pg-boss. Os handlers dos crons não fazem nada nesta demanda, então rodar de novo é inofensivo. Os handlers reais (E6.3/E7.1) precisam continuar idempotentes, como o design já exige.

### 4. Evidência: CA-4 manual (encerramento gracioso pelo Docker)

```
$ docker compose exec -T worker node dist/scripts/enfileirar-exemplo.js 20000
{"evento":"fila.enfileirado","fila":"exemplo","id":"c5817b5c-2381-4dea-b508-1c8306406792","esperaMs":20000}
worker-1  | {"evento":"worker.exemplo_iniciado","em":"2026-11-19T14:52:13.033Z","id":"c5817b5c-…","esperaMs":20000}

$ time docker compose stop worker          # iniciado às 14:52:13.52Z
 Container agenda_beleza-worker-1 Stopping
 Container agenda_beleza-worker-1 Stopped
real	0m19,767s

$ docker compose ps -a worker
agenda_beleza-worker-1   ...   Exited (0) Less than a second ago
$ docker inspect -f '{{.State.ExitCode}}' agenda_beleza-worker-1
0

$ docker compose logs worker | tail -4
worker-1  | {"evento":"worker.exemplo_iniciado","em":"2026-11-19T14:52:13.033Z","id":"c5817b5c-…","esperaMs":20000}
worker-1  | {"evento":"worker.encerrando","em":"2026-11-19T14:52:13.589Z","sinal":"SIGTERM"}
worker-1  | {"evento":"worker.job_concluido","em":"2026-11-19T14:52:33.034Z","fila":"exemplo","id":"c5817b5c-…","tentativa":1}
worker-1  | {"evento":"worker.encerrado","em":"2026-11-19T14:52:33.065Z"}
```

Resultado: **atende**. O SIGTERM chegou ao Node pelo tini (`worker.encerrando` 70 ms depois do `stop`). O job de 20 s terminou na **1ª tentativa** (`worker.job_concluido` exatamente 20 s depois do `exemplo_iniciado`), o worker registrou `worker.encerrado` 31 ms depois e saiu com **0**. O `stop` levou **19,8 s**, abaixo dos 30 s do `stop_grace_period` e dos 25 s do `TIMEOUT_ENCERRAMENTO_MS`, sem SIGKILL.

### 5. CI

- **Tempo real do job `testes` com a D-008: pendente.** Só pode ser medido no run do PR, que ainda não existe (código não commitado). Referência atual: 1 min 37 s no último run de `main` (push do merge do PR #64, D-007) e 1 min 28 s no run do PR da D-007. Quem abrir o PR deve registrar o tempo do job `testes` e o resultado dos seis jobs aqui ou no `testes.md`.
- **Achado fora do escopo da D-008 (para o líder):** o último run da CI em `main` (push do merge do PR #64, run 44519813004) está **vermelho**. Os jobs `lint`, `typecheck`, `build`, `testes` e `docker` passaram. O job `e2e` falhou no passo `npx playwright install --with-deps chromium`, após 5 min 39 s, antes do `npm run test:e2e`. O log do passo não pôde ser baixado nesta sessão (`gh run view --log` voltou vazio), então a causa não foi confirmada. O padrão (falha na instalação das dependências do sistema, sem chegar aos testes) é típico de instabilidade do apt no runner. Ação sugerida: re-executar o job (`gh run rerun 44519813004 --failed`) e, se repetir, abrir uma demanda de DevOps. Pela regra de não mesclar com CI vermelha, convém ter `main` verde antes do PR da D-008.

### 6. Comandos para reproduzir

```
docker compose build
docker run --rm --entrypoint node agenda-beleza:dev -e "import('pg-boss').then(()=>console.log('ok'))"
docker run --rm --entrypoint node agenda-beleza:dev -e "import('@opentelemetry/api').then(()=>console.log('ok'))"
docker run --rm --entrypoint ls agenda-beleza:dev -l dist/worker/main.js dist/scripts/enfileirar-exemplo.js
docker compose up -d --wait
docker compose logs worker                     # worker.iniciado + worker.heartbeat
docker compose exec -T worker node dist/scripts/enfileirar-exemplo.js 20000
docker compose logs -f worker                  # esperar worker.exemplo_iniciado; Ctrl-C
time docker compose stop worker                # < 30 s
docker compose ps -a worker                    # Exited (0)
docker compose stop app worker                 # volta ao estado com só o postgres no ar
```

### 7. Riscos e pendências

- **Pendência:** o tempo real do job `testes` e os seis jobs verdes no run do PR da D-008.
- **Pendência (fora da D-008):** CI de `main` vermelha no job `e2e` (§5). Precisa de decisão do líder antes do merge.
- **Observação (não é defeito da D-008):** `docker compose stop app` termina a app com `Exited (143)`, porque o `next start` não trata o SIGTERM com saída 0. Isso é anterior à demanda, não afeta o worker e não está nos CAs.
- Estado final do ambiente: `app` e `worker` parados (`docker compose stop app worker`), `postgres` no ar (healthy), volume preservado. Nenhum segredo foi tocado e nada foi commitado.

**Veredito T-10: ok.** Sem defeito no código nem na infraestrutura da D-008.
