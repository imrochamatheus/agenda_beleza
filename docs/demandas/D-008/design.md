# D-008 — Desenho: fila pg-boss em um worker separado (issue #9, E0.7)

Autor: arquiteto-software. Entradas: `docs/demandas/D-008/spec.md` (RN-1..RN-17, CA-1..CA-18, D-1..D-10), `issue-9.md`, `docs/demandas/D-005/{design,dba}.md` (harness, orçamento de conexões), `docs/demandas/D-007/design.md` (formato, critério de idade das dependências, lint em blocos disjuntos), `CLAUDE.md`, `PLAN.md` e o código da branch `feat/d-008-fila-worker` (= `main` em `d6a96c6`).

## 0. Verificações feitas antes do desenho

Todas as verificações de comportamento foram feitas com o pacote real, numa pasta de rascunho fora do repositório, contra bases descartáveis (`sonda_d008_arq*`) criadas e apagadas no PostgreSQL 17 do compose. Nada foi instalado no repositório.

| Verificação | Resultado |
|---|---|
| `npm view pg-boss time` (hoje: 2026-11-19; corte de 2 semanas, critério da D-007: 2026-11-05) | `latest` = 12.38.2 (2026-11-10) e 12.38.1 (2026-11-05T15:38Z) ficam dentro do corte. **Versão fixada: `12.38.0`** (2026-10-13, 37 dias). O diff de `dist/` entre 12.38.0 e 12.38.2 só toca `groupConcurrency`, `TestClock`, cron com horário de verão (usamos `UTC`) e o registro de instâncias. Nada disso afeta esta demanda. |
| Manifesto de `pg-boss@12.38.0` | `"type": "module"`, `engines.node >=22.12.0`, sem `exports` (então `pg-boss/package.json` pode ser lido), **`pgboss.schema = 46`** (versão do schema). Dependências: `pg ^8.23.1` (já temos 8.23.1), `cron-parser`, `rrule-temporal`, `serialize-error`. Não tem script de instalação, então dispensa `allowScripts`. |
| Peer `@opentelemetry/api ^1.9.0` | **É obrigatório**: `dist/telemetry.js` o importa estaticamente (via `manager.js`). O npm 11 instala o peer sozinho, mas ele fica implícito. **Decisão: declarar `@opentelemetry/api@1.10.0` (2026-10-20, 30 dias) em `dependencies`**, com versão exata (§1.2). |
| `import('pg-boss')` no Node 24.21 | Funciona. `Temporal` não existe no Node 24, mas o `rrule-temporal` só é exercitado por agendamentos RRULE, e esta demanda usa só cron. |
| Unidade do `stop({ timeout })` | **Milissegundos** (padrão 30000, mínimo 1000; `index.js`, `stop`). O `graceful` corre `settleCleanups()` contra o prazo. **Ao estourar o prazo, o `stop()` resolve normalmente**: o `failWip()` falha os jobs ativos com `'pg-boss shut down while active'` (o job vai para `retry`) e aborta o `job.signal`. Sonda: um job de 5 s com `timeout: 2000` fez o `stop` resolver em 2033 ms, com o handler ainda rodando e o job em `retry`. **Consequência: o worker precisa contar os próprios jobs em andamento** para distinguir o encerramento forçado (D-9). |
| Criação de filas | Explícita (`createQueue`). Um `send` para uma fila inexistente lança `Queue X does not exist` com `code = 'PGBOSS_QUEUE_NOT_FOUND'`. `createQueue` é idempotente (`INSERT … ON CONFLICT DO NOTHING`), **mas não atualiza uma fila existente**: a política fica a da criação, e o retry só muda com `updateQueue` (que não aceita `policy`). Confirmado na sonda. |
| Fórmula do backoff (`plans.js`, `failJobsBody`) | Com `retryBackoff = true`, o atraso da k-ésima nova tentativa (k = 1..`retryLimit`) é `max(retryDelay, 1) × 2^(k−1) × (1 + U)`, com `U ~ [0, 1)` e teto `retryDelayMax` (não usado). Ou seja, fica **em [d·2^(k−1), d·2^k]**. Com `false`, o atraso é `retryDelay` constante. Sonda com d = 1: os atrasos agendados foram 1,98 s e 2,66 s (12.38.2) e 1,53 s e 2,62 s (12.38.0). **O jitter permite um Δ1 de parede maior que o Δ2** (§7, R-1). |
| Política que entrega a D-7 | **`exclusive`**: índice único `job_i6 (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'`. Pela ordem do enum, `<= active` cobre `created`, `retry` e `active`. Sonda: a 2ª chamada com a mesma chave devolveu `null`, outra chave criou um job, um `Promise.all` com a mesma chave criou 1 job, e a mesma chave voltou a criar job depois de `complete`. **Atenção**: sem `singletonKey`, a chave vira `''`, ou seja, **um job por fila**. |
| Agendamentos | `schedule(nome, cron, data, { tz, key, ...SendOptions })` faz upsert por `(name, key)` com `tz` padrão `'UTC'`. Chamá-lo duas vezes deixa 1 linha (`getSchedules()` → `[["s","","*/5 * * * *","UTC"]]`). `unschedule(nome)` remove. As opções de envio (retry) ficam gravadas no agendamento. |
| Consulta de falha (CA-3) | `getJobById(fila, id)` devolve `state: 'failed'`, `retryCount`, `retryLimit`, `retryDelay`, `retryBackoff`, `startAfter` e `output` (o erro serializado: `name`, `message`, `stack`). |
| Retry por job | As opções de `send(…, { retryLimit, retryDelay, retryBackoff })` sobrepõem as da fila. Confirmado: o job ficou com 1/9/true numa fila 3/7/false. |
| Cliente sem migração (`migrate: false`) | `start()` numa base sem o schema lança `pg-boss is not installed` (sem `code`). Com uma versão diferente, lança `pg-boss database requires migrations`. |
| Queda das conexões (CA-12) | Depois de `pg_terminate_backend` nas 4 conexões (`application_name` do worker), vieram 4 eventos `error` (`57P01`), o processo continuou, e um job novo foi processado em cerca de 0,4 s. **Sem ouvinte de `error`, o `EventEmitter` derrubaria o processo** (R-11). |
| `application_name` | O `pg` dá precedência aos parâmetros da *connection string* sobre o objeto de configuração. Se a URL trouxer `application_name`, ele vence a opção do pg-boss (R-3). |
| Intervalo de busca | `work(…, { pollingIntervalSeconds })`, mínimo 0,5 s, padrão 2 s. |
| Harness | `tests/support/db.ts:62-63` tem `INICIALIZADORES = [schemaDeProva]`. O `drift.test.ts` só olha `public` e o `migrate diff` usa o datasource (schema `public`), então o schema `pgboss` não gera drift. Os comentários do `drift.test.ts:209` já preveem `pgboss`. |
| Lint | `src/worker/**` está no bloco `ACESSO_AO_BANCO`, junto de `src/server/repos/**` e `prisma/seed.ts` (`eslint.config.mjs:16`). `src/server/queue/**` cairia no bloco geral. |
| Sinais | O stub usa `sinais.once`. **Com `once`, um segundo SIGTERM durante os 25 s de espera não teria ouvinte, e o Node mataria o processo pelo sinal** (sem código 0). Por isso o worker real passa a usar `on` (§3.6). |

## 1. Resumo da solução

- **Contratos de fila na camada compartilhada** (`src/server/queue/filas.ts`): nome (constante), política do pg-boss, exigência de `singletonKey` e esquema `zod` estrito do payload de cada fila. A app (cliente) e o worker (handlers) importam daqui. O cliente valida o payload sem importar código do worker.
- **Configuração única** (`src/server/queue/config.ts`): schema `pgboss`, `application_name`, tamanho do pool por papel (worker 4, app 2, instalador 1), opções do construtor por papel e `politicaDeRetry(env)`. Worker, cliente e harness usam as mesmas opções, então o schema instalado no template é idêntico ao que o worker instalaria.
- **Ambiente**: `QUEUE_RETRY_LIMIT`, `QUEUE_RETRY_DELAY_SECONDS` e `QUEUE_RETRY_BACKOFF` em `esquemaEnv`, expostos em `Env.fila`. Assim, `check-env` e o worker passam a recusar valores inválidos sem mudança de código.
- **Cliente da app** (`src/server/queue/client.ts`): `criarClienteFila(fonte?)` cria uma instância sem I/O. `enfileirar()`/`encerrarFila()` usam uma instância padrão por processo, iniciada no primeiro uso com `migrate: false`, `supervise: false`, `schedule: false` e `registerInstance: false`. Cada `send` carrega a política de retry do ambiente. Os erros de infraestrutura viram `ErroFilaIndisponivel`, sem credenciais.
- **Worker** (`src/worker/iniciar.ts`, substitui `stub.ts`): valida o ambiente, registra `worker.adaptadores`, inicia o pg-boss (`migrate: true`, só aqui, D-6), **sincroniza** as filas (`createQueue` → confere a política → `updateQueue` com o retry do ambiente), registra um consumidor por fila com um envoltório que valida o payload, conta os jobs em andamento e registra conclusão e falha. Depois sincroniza os agendamentos (upsert dos crons e remoção dos órfãos), registra `worker.iniciado` e o heartbeat. No sinal, chama `stop({ graceful: true, timeout: 25000 })`, sai com 0 se não sobrou job em andamento e com 1 se sobrou (D-9).
- **Handlers** (`src/worker/handlers/`): um arquivo por fila exporta `definirHandler(FILA.x, { processar, cron? })`. `registry.ts` só lista. O `exemplo` funciona de verdade (espera `esperaMs`, respeitando o `AbortSignal`). Os outros três são stubs.
- **Harness**: o inicializador `filaPgBoss` roda `start()`/`stop()` com as opções do papel `instalador` no template. Assim, toda base de worker do Vitest já nasce com `pgboss` na versão 46 e **sem filas** (as filas são do worker, D-6).
- **Processo filho (CA-4)**: o próprio teste empacota `src/worker/main.ts` com o `esbuild` (dependência de dev já existente), usando **os argumentos do script `build:node` lidos do `package.json`**. Só trocam o `--outdir` e a extensão (`.mjs`), e a saída vai para `node_modules/.cache/agenda-beleza/`. A CI não muda.
- **Script de verificação manual** (D-4): `src/scripts/enfileirar-exemplo.ts`, empacotado pelo `build:node` e exposto como `npm run fila:exemplo -- <esperaMs>` e `docker compose exec worker node dist/scripts/enfileirar-exemplo.js <esperaMs>`.

### 1.1 Alternativas descartadas
| Alternativa | Motivo |
|---|---|
| `pg-boss@12.38.2` (`latest`) | Tem 9 dias, abaixo do critério de 2 semanas adotado na D-007 para dependências novas. O diff para a 12.38.0 não toca nada que usamos (§0). |
| Linha 10.x (`maint-v10`) | Sem política `exclusive` com a semântica verificada, com outra API de filas. Não há motivo para começar numa linha em manutenção. |
| Validador do payload dentro do arquivo do handler (D-3 literal) | O cliente da app teria de importar `src/worker/handlers/*`, que na E7.1 vão importar repositórios e adaptadores. Isso puxaria código do worker para o bundle do Next. O contrato fica em `src/server/queue/filas.ts`, e o handler só tem `processar` e `cron`. |
| Enfileirar dentro da transação de negócio (`fromPrisma` do pg-boss) | Contraria a RN-11 (cliente pós-commit, sem transação) e a arquitetura da E7.1 (outbox `mensagem` + reconciliação), além de levar o pg-boss para `src/server/repos`. |
| Política `standard` + `singletonKey` para `whatsapp-reserva` | No `standard`, a chave não impede duplicata em `created`/`retry`/`active` com a semântica da D-7 (só existe throttle por `singletonSeconds`). Só a `exclusive` entrega exatamente "no máximo um até concluir ou falhar". |
| `tsx` (ou o *strip-types* nativo) para rodar o processo filho | `tsx` seria dependência nova. O *strip-types* do Node não resolve o alias `@/` nem imports sem extensão. O `esbuild` já está no projeto e é o mesmo empacotador da imagem. |
| Passo `build:node` no job `testes` da CI | Acoplaria o teste a um artefato de outro passo e quebraria o `npm test` local sem `build:node` prévio. Execuções simultâneas também disputariam o mesmo `dist/`. O empacotamento por teste, com nome único, não tem nenhum desses problemas. |
| Instalar o schema no template executando `getConstructionPlans()` com `pg` | O SQL de instalação depende da configuração (`installConfig`). Usar `start()` com as mesmas opções do worker garante equivalência, como pede a spec (item 9 do escopo). |
| A app também instalar o schema no primeiro uso (alternativa da D-6) | Teria dois donos do schema e migrações concorrentes em upgrades. Mantida a D-6. |
| Variáveis de ambiente para o pool, o intervalo de busca e o timeout de encerramento | A issue só pede env para o retry (D-2, D-10). Ficam como constantes, injetáveis nos testes. |
| `useListenNotify` | Exigiria uma conexão dedicada a mais por processo. Polling de 2 s basta na v1. |

### 1.2 Dependências novas
- `pg-boss` **12.38.0** em `dependencies`, com versão exata. Precisa sobreviver ao `npm prune --omit=dev` do `Dockerfile`, porque o `build:node` usa `--packages=external`.
- `@opentelemetry/api` **1.10.0** em `dependencies`, com versão exata. É peer obrigatório do pg-boss, importado em tempo de carga. Declarado de forma explícita para (a) fixar a versão no `package.json`, conforme a política `save-exact`, e (b) não depender da instalação automática de peers, que some com `--legacy-peer-deps` ou `--omit=peer`. Nenhum código nosso o importa.
- Nenhuma outra. O `esbuild` e o `pg` já estão instalados.

## 2. Componentes afetados

| Caminho | Mudança |
|---|---|
| `package.json`, `package-lock.json` | +`pg-boss@12.38.0` e +`@opentelemetry/api@1.10.0` (T-1). Depois, o `build:node` ganha a entrada `src/scripts/enfileirar-exemplo.ts` e o script `fila:exemplo` (T-8). |
| `src/server/env.ts` (+ teste) | Três variáveis novas e `Env.fila` (§3.1). |
| `src/server/check-env.test.ts` | Casos do CA-11. O `check-env.ts` não muda. |
| `.env.example` | As três chaves, com comentário de unidade e padrão. |
| `src/server/queue/config.ts` (novo, + teste) | Constantes, opções por papel e `politicaDeRetry` (§3.2). |
| `src/server/queue/erros.ts` (novo, + teste) | `ErroFilaIndisponivel`, `ErroPayloadInvalido`, `descreverErroSeguro` (§3.3). |
| `src/server/queue/filas.ts` (novo, + teste) | Contratos das 4 filas e `validarPayload` (§3.4). |
| `src/server/queue/client.ts` (novo, + teste) | Cliente da app (§3.5). |
| `src/server/queue/enfileirar-exemplo.ts` (novo) | Lógica do script manual (§3.9). |
| `src/scripts/enfileirar-exemplo.ts` (novo, + teste) | Ponto de entrada fino (§3.9). |
| `src/worker/iniciar.ts` (novo, + teste) | Substitui `stub.ts`/`stub.test.ts`, que são **removidos** (§3.6). |
| `src/worker/main.ts`, `main.test.ts` | Passam a importar de `./iniciar` (mesma forma). |
| `src/worker/handlers/{tipos,registry,exemplo,assinatura-prazos,whatsapp-reserva,reconciliar-mensagens}.ts` (novos, + testes) | §3.7. |
| `eslint.config.mjs` | Restrição do `pg-boss` e bloco próprio para `src/server/queue/**` e `src/worker/**` (§3.8). |
| `tests/support/db.ts` | Inicializador `filaPgBoss` em `INICIALIZADORES` (§3.10). |
| `tests/support/fila.ts` (novo) | Auxiliares dos testes de fila (§3.10). |
| `tests/integration/lint/importacao-fila.test.ts` (novo) | CA-17. |
| `tests/integration/fila/*.test.ts`, `tests/integration/worker/*.test.ts` (novos) | §8. |
| `docker-compose.yml` | `stop_grace_period: 30s` no `worker` (DevOps). |
| `README.md`, `CLAUDE.md` | §5 e T-9. |

Nenhuma migração Prisma, nenhuma mudança em `schema.prisma`, `Dockerfile`, `docker/entrypoint.sh` nem em `.github/workflows/ci.yml`.

## 3. Interfaces

### 3.1 Ambiente (`src/server/env.ts`)
- O `esquemaEnv` ganha:
  - `QUEUE_RETRY_LIMIT`: string só de dígitos (`/^\d+$/`) → inteiro entre 0 e 20; padrão `4`;
  - `QUEUE_RETRY_DELAY_SECONDS`: `/^\d+$/` → inteiro entre 1 e 3600; padrão `30`;
  - `QUEUE_RETRY_BACKOFF`: `'true' | 'false'` → boolean; padrão `true`.
- `-1`, `21`, `abc`, `0` (no atraso), `1.5`, ` 4` e `sim` são recusados. Vazio conta como ausente (`semVazias`). O `ErroDeAmbiente` nomeia só a variável, como hoje (`issue.path[0]`).
- `Env` ganha `fila: { retryLimit: number; retryDelaySeconds: number; retryBackoff: boolean }`.
- `chavesDeclaradas()` passa a incluir as três automaticamente, porque estão no `esquemaEnv.shape`. O `.env.example` traz `QUEUE_RETRY_LIMIT=4`, `QUEUE_RETRY_DELAY_SECONDS=30` e `QUEUE_RETRY_BACKOFF=true`, cada um com comentário. O do limite explica: "novas tentativas depois da 1ª execução; 4 = 5 execuções no total".
- Nada é lido no import. `npm run build` e `build:node` continuam sem exigir as variáveis.

### 3.2 Configuração (`src/server/queue/config.ts`)
```ts
import type { ConstructorOptions } from 'pg-boss';
import type { Env } from '@/server/env';

export const SCHEMA_FILA = 'pgboss';
export const POOL_FILA = { worker: 4, app: 2, instalador: 1 } as const;          // D-2 (DBA confirma)
export const APLICACAO_FILA = { worker: 'agenda-beleza:worker', app: 'agenda-beleza:app', instalador: 'agenda-beleza:instalador' } as const;
export type PapelFila = keyof typeof POOL_FILA;

/** Opções do construtor por papel. Só o 'worker' migra, supervisiona e agenda (D-6). */
export function opcoesPgBoss(url: string, papel: PapelFila): ConstructorOptions;
//  comum: { connectionString: url, schema: SCHEMA_FILA, max: POOL_FILA[papel], application_name: APLICACAO_FILA[papel] }
//  worker:     migrate: true,  supervise: true,  schedule: true,  registerInstance: true, instanceName: 'worker'
//  app:        migrate: false, supervise: false, schedule: false, registerInstance: false
//  instalador: migrate: true,  supervise: false, schedule: false, registerInstance: false

export type PoliticaRetry = { retryLimit: number; retryDelay: number; retryBackoff: boolean };
/** RN-9: a única fonte da política de retry (cliente, filas e agendamentos). */
export function politicaDeRetry(env: Env): PoliticaRetry;
```
- `import type` de `pg-boss` é permitido pelo lint neste diretório (§3.8).

### 3.3 Erros (`src/server/queue/erros.ts`)
```ts
export class ErroFilaIndisponivel extends Error {      // name = 'ErroFilaIndisponivel'
  readonly fila: string;
  readonly codigo: string | null;                       // SQLSTATE, código do Node (ECONNREFUSED) ou do pg-boss; nunca a URL
  // cause = { nome, codigo } (objeto simples, NUNCA o erro original)
}
export class ErroPayloadInvalido extends Error {        // name = 'ErroPayloadInvalido'
  readonly fila: string;
  readonly campos: string[];                            // caminhos (ex.: ['telefone'], ['mensagemId'], ['(raiz)']), sem valores
}
/** Para logs: { nome, codigo, mensagem } com a URL, o usuário:senha e a senha de `url` substituídos por '***'. Corta em 300 caracteres. */
export function descreverErroSeguro(erro: unknown, url?: string): { nome: string; codigo: string | null; mensagem: string };
```
- Mensagem do `ErroFilaIndisponivel`: `Fila "<fila>" indisponível (<motivo>)`, com `motivo` entre `schema_ausente` ("pg-boss is not installed" ou "requires migrations"), `fila_inexistente` (`PGBOSS_QUEUE_NOT_FOUND`) e `conexao` (demais). Nada derivado da URL.

### 3.4 Contratos (`src/server/queue/filas.ts`)
```ts
export const FILA = {
  exemplo: 'exemplo',
  assinaturaPrazos: 'assinatura-prazos',
  whatsappReserva: 'whatsapp-reserva',
  reconciliarMensagens: 'reconciliar-mensagens',
} as const;
export type NomeFila = (typeof FILA)[keyof typeof FILA];

export type ContratoFila = {
  politica: 'standard' | 'exclusive';
  chave: 'obrigatoria' | 'opcional';
  payload: z.ZodType;                       // sempre z.strictObject
};
export const CONTRATOS = {
  'exemplo':               { politica: 'standard',  chave: 'opcional',    payload: z.strictObject({ esperaMs: z.int().min(0).max(60_000).optional() }) },
  'assinatura-prazos':     { politica: 'exclusive', chave: 'opcional',    payload: z.strictObject({}) },
  'whatsapp-reserva':      { politica: 'exclusive', chave: 'obrigatoria', payload: z.strictObject({ mensagemId: z.uuid() }) },
  'reconciliar-mensagens': { politica: 'exclusive', chave: 'opcional',    payload: z.strictObject({}) },
} as const satisfies Record<NomeFila, ContratoFila>;
export type PayloadDe<F extends NomeFila> = z.infer<(typeof CONTRATOS)[F]['payload']>;

/** Valida sem I/O. Lança ErroPayloadInvalido (campos sem valores). Fila desconhecida → ErroPayloadInvalido(campos: ['(fila)']). */
export function validarPayload<F extends NomeFila>(fila: F, dados: unknown): PayloadDe<F>;
```
- **Políticas** (D-7):
  - `whatsapp-reserva` usa `exclusive` com chave **obrigatória**, porque sem chave a deduplicação seria por fila inteira (§0). A E7.1 usa `reserva:tipo:revisao`.
  - Os dois crons usam `exclusive` sem chave: no máximo um job de varredura pendente ou ativo por vez. Um disparo que cai enquanto o anterior ainda roda é descartado (`send` devolve `null`). Isso é desejável para varreduras idempotentes (E6.3 RN-8, E7.1 RN-9).
  - `exemplo` usa `standard`.
- A política é imutável depois que a fila é criada (§0). O worker recusa iniciar se encontrar divergência (§3.6). Trocar a política de uma fila existente é tarefa de uma demanda própria, com plano de migração (R-2).
- A E7.1 pode trocar o payload de `whatsapp-reserva` nesta linha. A E4.2 acrescenta uma linha.

### 3.5 Cliente da app (`src/server/queue/client.ts`)
```ts
export type ResultadoEnfileirar = { criado: true; id: string } | { criado: false; motivo: 'chave_em_uso' };
export type OpcoesEnfileirar = { chave?: string };   // vira singletonKey

export interface ClienteFila {
  /**
   * Use SOMENTE depois do commit da transação de negócio: o cliente tem conexão própria e não
   * participa de transação (RN-11). Valida o payload antes de qualquer I/O. Não tenta de novo.
   */
  enfileirar<F extends NomeFila>(fila: F, payload: PayloadDe<F>, opcoes?: OpcoesEnfileirar): Promise<ResultadoEnfileirar>;
  /** Fecha o pool (idempotente). */
  encerrar(): Promise<void>;
}
/** Não lê o ambiente nem conecta: o 1º enfileirar valida `fonte` (padrão process.env) e inicia o pg-boss. */
export function criarClienteFila(fonte?: Record<string, string | undefined>): ClienteFila;
/** Atalhos da instância padrão do processo (criada no 1º uso, sobre process.env). */
export function enfileirar<F extends NomeFila>(fila: F, payload: PayloadDe<F>, opcoes?: OpcoesEnfileirar): Promise<ResultadoEnfileirar>;
export function encerrarFila(): Promise<void>;
```
Fluxo de `enfileirar`:
1. `validarPayload(fila, payload)`. Se a chave for obrigatória e faltar, lança `ErroPayloadInvalido(campos: ['(chave)'])`. Nenhum I/O antes daqui (CA-10).
2. No 1º uso: `validarEnv(fonte)`. Um `ErroDeAmbiente` sobe sem embrulho, porque é falha de configuração e não da fila.
3. Obtém a instância: `new PgBoss(opcoesPgBoss(env.DATABASE_URL, 'app'))`, com `on('error')` e `on('warning')` ligados **antes** do `start()`. O ouvinte registra `{"evento":"fila.erro",…descreverErroSeguro}` com `console.error`. A promessa de `start()` é memorizada. Se falhar, a memória é limpa (a próxima chamada tenta de novo), `stop({ graceful: false })` é chamado sem propagar erro, e a falha vira `ErroFilaIndisponivel`.
4. `boss.send(fila, payload, { ...politicaDeRetry(env), singletonKey: opcoes?.chave })`. O resultado `null` vira `{ criado: false, motivo: 'chave_em_uso' }`. Erros viram `ErroFilaIndisponivel`.
- O módulo não tem efeito no import. Os testes usam `criarClienteFila(fonte)` e fecham com `encerrar()` no `afterAll`. O Vitest isola módulos por arquivo, mas um pool esquecido seguraria conexões até o `DROP … WITH (FORCE)` (R-9).
- O módulo é server-only por construção: o lint impede o import de `pg-boss` fora de `src/server/queue/**`/`src/worker/**`. Nenhuma rota o importa nesta demanda (R-4).

### 3.6 Worker (`src/worker/iniciar.ts`)
```ts
export const INTERVALO_HEARTBEAT_MS = 30_000;
export const TIMEOUT_ENCERRAMENTO_MS = 25_000;    // RN-4; o compose usa 30s (teste do CA-14 compara)

/** O subconjunto do PgBoss usado pelo worker (permite o dublê do CA-14). */
export type FilaWorker = Pick<PgBoss, 'on' | 'start' | 'stop' | 'createQueue' | 'getQueue' | 'updateQueue'
  | 'work' | 'schedule' | 'unschedule' | 'getSchedules'>;

export interface DependenciasWorker {
  env: Record<string, string | undefined>;
  log: (linha: string) => void;
  erro: (linha: string) => void;
  /** `on`, e não `once`: o 2º sinal precisa de ouvinte para ser ignorado (§0). */
  sinais: { on(evento: 'SIGTERM' | 'SIGINT', fn: () => void): unknown };
  sair: (codigo: number) => void;
  intervaloMs?: number;                                  // heartbeat
  definicoes?: readonly DefinicaoFila[];                 // padrão: REGISTRO
  criarFila?: (opcoes: ConstructorOptions) => FilaWorker; // padrão: (o) => new PgBoss(o)
  intervaloBuscaSegundos?: number;                       // D-10: padrão undefined (2 s da biblioteca); testes 0.5
  timeoutEncerramentoMs?: number;                        // padrão TIMEOUT_ENCERRAMENTO_MS
}
export interface ControleWorker {
  /** Resolve quando o início termina (sucesso ou falha já tratada). */
  pronto: Promise<void>;
  /** Mesmo caminho do sinal; devolve o código de saída. Idempotente. */
  encerrar(origem?: 'SIGTERM' | 'SIGINT' | 'teste'): Promise<number>;
}
export function iniciarWorker(deps: DependenciasWorker): ControleWorker;
```
Sequência (RN-14):
1. `validarEnv`. Se falhar: `worker.ambiente_invalido {variaveis}` em `erro`, `sair(1)` e **nenhuma** chamada a `criarFila` (CA-13).
2. `worker.adaptadores` (inalterado, mais `em`).
3. Liga `sinais.on('SIGTERM'|'SIGINT')` **antes** do `start()`. Um sinal durante o início também encerra (o `stop()` do pg-boss espera o `start()` em andamento).
4. `fila = criarFila(opcoesPgBoss(env.DATABASE_URL, 'worker'))`, com `on('error')` → `worker.erro_fila {nome, codigo, mensagem}` (via `descreverErroSeguro`, com a URL) e `on('warning')` → `worker.aviso_fila {tipo}`. `await fila.start()`.
5. Para cada definição: `createQueue(nome, { policy, ...retry })` e depois `getQueue(nome)`. Se `policy` divergir: `worker.falha_inicio {motivo: 'politica_divergente', fila, esperada, atual}`, então `stop` e `sair(1)`. Senão, `updateQueue(nome, retry)`, porque o `createQueue` não atualiza uma fila existente (§0).
6. `work(nome, { includeMetadata: true, pollingIntervalSeconds? }, envoltorio(def))` para cada definição.
7. Agendamentos: `schedule(nome, cron, {}, { tz: 'UTC', ...retry })` para cada definição com `cron`. Depois, `getSchedules()` e `unschedule(name, key)` de todo agendamento cujo `(name, key)` não seja `(def.fila, '')` de uma definição com cron (RN-16).
8. `worker.iniciado {filas: [nomes ordenados]}`, heartbeat imediato e `setInterval`.
9. Qualquer exceção nos passos 4 a 7: `worker.falha_inicio {nome, codigo, mensagem}` (sem a senha), `stop({ graceful: false })` (sem propagar erro) e `sair(1)`.

Envoltório de cada job (RN-13), com `[job] = jobs` e `batchSize` 1:
- `emAndamento++`;
- `ctx = { id: job.id, fila, tentativa: job.retryCount + 1, agendadoPara: job.startAfter, sinal: job.signal, log }`;
- `payload = def.validarPayload(job.data)`, depois `await def.processar(payload, ctx)` e `worker.job_concluido {fila, id, tentativa}`;
- num erro: `worker.job_falhou {fila, id, tentativa, erro: {nome, mensagem}}` (mensagem cortada em 300 caracteres e **nunca** o payload), depois `throw` de novo para o pg-boss contar a tentativa;
- `finally`: `emAndamento--`.

Encerramento (RN-15, D-9):
- **1º sinal:** `parado = true`, para o heartbeat, registra `worker.encerrando {sinal}` e chama `await fila.stop({ graceful: true, timeout: timeoutEncerramentoMs })`.
  - Se `emAndamento === 0`: `worker.encerrado` e `sair(0)`.
  - Se ainda houver job em andamento: `worker.encerramento_forcado {emAndamento}` e `sair(1)`.
  - Se o `stop` lançar: `worker.erro_encerramento` e `sair(1)`.
- **Sinais seguintes:** ignorados, porque `parado` já é verdadeiro.

Todos os eventos são `JSON.stringify({ evento, em: new Date().toISOString(), ...campos })`. O `em` passa a existir em todo evento (RN-14). Os testes de `worker.adaptadores` da D-007 mudam para conferir `em` com regex e os modos com igualdade.

`src/worker/main.ts` continua com uma linha: `iniciarWorker({ env: process.env, log: console.log, erro: console.error, sinais: process, sair: (c) => process.exit(c) })`.

### 3.7 Handlers (`src/worker/handlers/`)
```ts
// tipos.ts
export interface ContextoJob { id: string; fila: string; tentativa: number; agendadoPara: Date; sinal: AbortSignal; log(evento: string, campos?: Record<string, unknown>): void }
export interface DefinicaoFila<P = unknown> {
  fila: string; politica: 'standard' | 'exclusive';
  validarPayload(dados: unknown): P;
  processar(payload: P, ctx: ContextoJob): Promise<void>;
  cron?: string;
}
/** Liga o contrato de src/server/queue/filas.ts ao processamento. */
export function definirHandler<F extends NomeFila>(fila: F, h: { processar(p: PayloadDe<F>, ctx: ContextoJob): Promise<void>; cron?: string }): DefinicaoFila<PayloadDe<F>>;
```
- `exemplo.ts`: `definirHandler(FILA.exemplo, { processar })`. Registra `worker.exemplo_iniciado {id, esperaMs}` e espera `esperaMs` (padrão 0). Se `ctx.sinal` abortar, rejeita com `Error('exemplo interrompido')`. **Ajuste da D-4:** a conclusão é o `worker.job_concluido` genérico, sem `worker.exemplo_concluido`.
- `assinatura-prazos.ts`: `cron: '*/5 * * * *'`. `processar` vazio, que só resolve.
- `reconciliar-mensagens.ts`: `cron: '* * * * *'`. `processar` vazio.
- `whatsapp-reserva.ts`: sem cron. `processar` vazio, com o payload `{ mensagemId }` já validado.
- `registry.ts`: `export const REGISTRO: readonly DefinicaoFila[] = [exemplo, assinaturaPrazos, whatsappReserva, reconciliarMensagens]`.
- Os stubs não importam repositórios, Prisma nem integrações (RN-17).

### 3.8 Lint (`eslint.config.mjs`)
- Novo padrão: `PG_BOSS = [{ regex: '^pg-boss(/|$)', message: 'D-8: enfileire pelo cliente de src/server/queue (pg-boss só em src/server/queue e src/worker).' }]`, **sem** `allowTypeImports`.
- Os blocos ficam disjuntos (R-1 da D-007):
  - `ACESSO_AO_BANCO` = `src/server/repos/**` e `prisma/seed.ts` (sai `src/worker/**`): `SDK_PROVEDOR` + `ADAPTADORES` + `PG_BOSS`;
  - **novo** `WORKER` = `src/worker/**`: `SDK_PROVEDOR` + `ADAPTADORES`, as mesmas permissões de hoje;
  - **novo** `FILA` = `src/server/queue/**`: `PRISMA` + `SDK_PROVEDOR` + `ADAPTADORES`;
  - geral (ignora também `FILA` e `WORKER`): soma `PG_BOSS`;
  - `INTEGRACOES` e `DEV`: somam `PG_BOSS`.
- `importacao-prisma.test.ts` e `importacao-integracoes.test.ts` continuam verdes **sem mudança de asserção**.

### 3.9 Script de verificação manual (D-4)
- `src/server/queue/enfileirar-exemplo.ts`: `executarEnfileirarExemplo(args: string[], fonte, saida: { log; error }, cliente = criarClienteFila(fonte)): Promise<0 | 1>`.
  - `args[0]` é opcional, inteiro de 0 a 60000. Um valor inválido dá 1 e uma mensagem.
  - Enfileira `exemplo`, imprime `{"evento":"fila.enfileirado","fila":"exemplo","id":…}`, chama `encerrar()` e devolve 0.
  - `ErroFilaIndisponivel` ou `ErroDeAmbiente` dão 1, com a mensagem (já sem credenciais).
- `src/scripts/enfileirar-exemplo.ts`: `process.exitCode = await executarEnfileirarExemplo(process.argv.slice(2), process.env, console)`.
- `package.json`:
  - `build:node` ganha a entrada `src/scripts/enfileirar-exemplo.ts`;
  - novo script `"fila:exemplo": "npm run build:node && node --env-file-if-exists=.env dist/scripts/enfileirar-exemplo.js"`;
  - no compose: `docker compose exec worker node dist/scripts/enfileirar-exemplo.js 20000`.

### 3.10 Harness e auxiliares de teste
- `tests/support/db.ts`:
  ```ts
  export const filaPgBoss: InicializadorDeSchema = {
    nome: 'pgboss',
    async executar(urlTemplate) {
      const boss = new PgBoss(opcoesPgBoss(urlTemplate, 'instalador'));
      boss.on('error', () => undefined);   // o erro relevante chega pela rejeição de start()
      try { await boss.start(); } finally { await boss.stop({ graceful: false, close: true }); }
    },
  };
  export const INICIALIZADORES = [schemaDeProva, filaPgBoss];
  ```
  O import de `opcoesPgBoss` usa caminho relativo (`../../src/server/queue/config`), porque o `globalSetup` é carregado antes dos `setupFiles` e não convém depender do alias ali. O `stop` fecha o pool (`pool.end`), e a conferência A-9 (até 2 s) cobre a liberação tardia de sockets.
- `tests/support/fila.ts` (só para testes):
  - `abrirBossDeTeste(url = urlDoWorker())`: um `PgBoss` com `migrate: false`, `supervise: false`, `schedule: false`, `registerInstance: false`, `max: 2` e `application_name: 'agenda-beleza:teste'`, para inspecionar e manipular (`getJobById`, `fetch`, `fail`, `createQueue`, `getSchedules`);
  - `esperarEstado(boss, fila, id, estados, prazoMs = 15_000)`: polling de 50 ms com prazo;
  - `esperar(condicao, prazoMs)`: genérico;
  - `capturarLog()`: devolve `{ log, erro, eventos(): object[] }`;
  - `envDeTeste(extra?)`: `{ ...process.env, DATABASE_URL: urlDoWorker(), QUEUE_RETRY_DELAY_SECONDS: '1', ...extra }`;
  - `empacotarWorker()`: lê `scripts['build:node']` do `package.json` e roda o binário do `esbuild` (sem shell; o caminho tem espaço e acento) com os mesmos argumentos, trocando `--outdir=dist` por `--outdir=node_modules/.cache/agenda-beleza/worker-<exec>-<VITEST_POOL_ID>-<pid>` e acrescentando `--out-extension:.js=.mjs`. A extensão `.mjs` é necessária porque o Node não sobe além de `node_modules/` para achar o `"type": "module"`. Os pacotes externos resolvem pelo `node_modules` da raiz. Devolve `{ arquivo, limpar() }`.

## 4. Dados (DBA: **acionado, revisão leve, sem posse de migração**)

Não há tabela, coluna nem migração Prisma. O schema `pgboss` (versão 46) é criado e migrado só pelo `start()` do worker.

Itens para o DBA avaliar e registrar em `docs/demandas/D-008/dba.md`:
1. **Pools:** worker 4, app 2, instalador do harness 1 (D-2). Atualizar a fórmula de produção da D-005: `instâncias_app × (10 + 2) + worker (10 + 4) + 3 ≤ max_connections − superuser_reserved_connections`. O Prisma do worker ainda não abre conexões (nenhum handler usa repositórios), mas entra na fórmula.
2. **Orçamento dos testes:** por worker do Vitest, cerca de 16 (Prisma, pouco usado nesses arquivos) + 2 (admin) + 4 (worker em teste) + 2 (cliente) + 2 (`abrirBossDeTeste`) + 4 (processo filho do CA-4, só naquele arquivo). Confirmar que a regra "um arquivo não satura dois pools" continua valendo e que o pico de 4 × 18 = 72 não muda de forma material. Se mudar, propor o ajuste.
3. **Instalação no template:** `start()`/`stop()` com o papel `instalador` (§3.10), seguidos da conferência A-9. Confirmar que nada em `pgboss` depende do nome da base (cópia por `CREATE DATABASE … TEMPLATE`).
4. **Drift:** `pgboss` fica fora do `migrate diff` (datasource em `public`) e das consultas do `drift.test.ts`. Confirmar e, se quiser, acrescentar a conferência do CA-6 ao `drift.test.ts` (não é exigida).
5. **Políticas e índices:** `exclusive` para `whatsapp-reserva` e os crons (índice `job_i6`), mais o comportamento sem chave (§3.4). Confirmar que atende a D-7 e que a deduplicação definitiva continua no `UNIQUE(reserva_id, tipo, revisao)` da E7.1.
6. **Retenção:** padrões do pg-boss: `deleteAfterSeconds` 7 dias depois de concluído ou falho, `retentionSeconds` 14 dias em `created`/`retry`, `expireInSeconds` 15 min em `active`. Confirmar ou propor valores, que entrariam no `createQueue`/`updateQueue` da §3.6 como constantes de `config.ts`.
7. **Privilégio:** o papel do worker precisa de `CREATE` no database (para o schema `pgboss`). O cliente precisa de `USAGE` e DML em `pgboss` (insere em `pgboss.job`). Registrar isso para a implantação.
8. **Upgrade futuro do pg-boss:** muda o schema `pgboss` por migração própria da biblioteca. Toda atualização é uma demanda revisada pelo DBA, com conferência de `schemaVersion()`.

O desenvolvedor não espera o parecer para começar. Um ajuste do DBA que mude constantes da §3.2 ou §3.6 volta como "aceito com ajuste X", e o T-6/T-7 o aplicam.

## 5. Infraestrutura (DevOps: **acionado, revisão leve**)

1. **Compose:** `stop_grace_period: 30s` no serviço `worker` (dono: DevOps, T-3). O `init: true` (tini) já repassa o SIGTERM, e o `entrypoint.sh` usa `exec`.
2. **CI:** sem mudança. O CA-4 empacota o worker dentro do teste (§3.10). Conferir o tempo extra do job `testes`: estimado em 30 a 40 s de parede, distribuídos em 4 workers, dentro do `timeout-minutes: 20`.
3. **Imagem:** `pg-boss` e `@opentelemetry/api` em `dependencies` sobrevivem ao `npm prune --omit=dev`. Conferir com `docker run --rm --entrypoint node agenda-beleza:dev -e "import('pg-boss').then(()=>console.log('ok'))"` e confirmar que `dist/scripts/enfileirar-exemplo.js` está na imagem.
4. **Verificação de processo do CA-4** (manual, T-10): `docker compose up -d --wait`, `docker compose exec worker node dist/scripts/enfileirar-exemplo.js 20000`, esperar `worker.exemplo_iniciado` em `docker compose logs -f worker`, depois `time docker compose stop worker`. Esperado: `worker.job_concluido`, `worker.encerrado`, `docker compose ps -a worker` com `Exited (0)` e tempo abaixo de 30 s.
5. **Avaliar (não obrigatório):** uma política `restart` para o worker. Hoje, uma falha de início sai com 1 e não volta. Se o DevOps propuser, a mudança fica no compose e no README e é justificada no `devops.md`.
6. **Observabilidade:** eventos JSON em stdout (§3.6). Nenhum endpoint (RN-6).

## 6. Verificação das invariantes

| Invariante | Aplica? | Como foi atendida |
|---|---|---|
| Escopo por salão no servidor | Indiretamente | O payload só tem IDs. O worker não abre contexto de tenant. Os handlers reais (E6.3/E7.1) vão usar `contextoDeSistema` e os repositórios. Nenhum handler desta demanda lê `public` (CA-7 confere as contagens). |
| Exclusion constraint anti-sobreposição | Não | Nenhuma escrita em `reserva`. |
| UTC + fuso do salão | Sim | Crons com `tz: 'UTC'` explícito. Logs com `em` ISO em `Z`. Os testes não dependem do fuso da máquina (CA-8 roda igual com `TZ=America/Sao_Paulo`). |
| Adaptadores de integração | Sim (sem uso) | O worker continua registrando `worker.adaptadores`. Os handlers não chamam adaptadores. O lint mantém SDKs e adaptadores proibidos em `src/worker/**` e `src/server/queue/**`. |
| Soft delete / anonimização | Indiretamente | Sem dado pessoal no payload (`strictObject` + UUID). Uma anonimização não deixa rastro em `pgboss`. |
| Salão suspenso somente leitura | Indiretamente | A fila não filtra por suspensão, porque o cancelamento feito por salão suspenso precisa notificar (E7.1/E6.4). Nada nesta demanda bloqueia ou libera escrita de domínio. |
| Idempotência de webhooks e mensagens | Sim (base) | `singletonKey` com política `exclusive` (CA-9) e chave obrigatória em `whatsapp-reserva`. Retry com backoff, falha isolada e histórico **não** no pg-boss (RN-5). A deduplicação definitiva fica no banco da E7.1. Uma falha de envio não altera a reserva (os handlers não escrevem em `public`). |
| Auditoria do super admin | Não | Nenhuma ação de super admin. |

## 7. Riscos e decisões

### 7.1 Decisões D-1..D-10 da spec
| Decisão | Veredito | Justificativa / ajuste |
|---|---|---|
| D-1 (4 / 30 s / backoff) | **Confirmada, com a conta corrigida** | Pela fórmula (§0), as esperas ficam em [30,60], [60,120], [120,240] e [240,480] s: **de 7,5 a 15 min no total** (a spec estimava ≈7,5). Continua aceitável para a confirmação de reserva. Sem `retryDelayMax`. |
| D-2 (pool 4 / 2) | **Confirmada**, sujeita ao DBA | Mais o instalador do harness com 1. |
| D-3 (definição por arquivo, crons) | **Confirmada com ajuste** | O contrato (nome, política, chave, payload) fica em `src/server/queue/filas.ts`, e o arquivo do handler exporta `processar` e `cron` via `definirHandler`, para que o cliente valide sem importar o worker (§1.1). Os crons ficam como na spec. |
| D-4 (job de exemplo) | **Confirmada com ajuste** | Eventos `worker.exemplo_iniciado` + `worker.job_concluido` (sem `worker.exemplo_concluido`). A espera é interrompível pelo `AbortSignal`. Comando: `npm run fila:exemplo -- <ms>` / `docker compose exec worker node dist/scripts/enfileirar-exemplo.js <ms>`. |
| D-5 (stubs) | **Confirmada** | Validam pelo contrato e concluem. A conclusão é registrada pelo envoltório. |
| D-6 (só o worker instala) | **Confirmada** | O cliente usa `migrate: false`. A ausência do schema ou da fila vira `ErroFilaIndisponivel`. |
| D-7 (`singletonKey`) | **Confirmada com a política `exclusive`** (verificada) | Ajuste: chave **obrigatória** em `whatsapp-reserva`. Os crons também usam `exclusive` (sem sobreposição). A política é imutável e o worker confere a divergência. |
| D-8 (lint) | **Confirmada** | Blocos disjuntos (§3.8). |
| D-9 (saída 1 no forçado) | **Confirmada** | A detecção usa o contador `emAndamento`, porque o `stop()` resolve mesmo com o prazo estourado (§0). O job interrompido vai para `retry` pelo `failWip` e **consome uma tentativa**. Com `QUEUE_RETRY_LIMIT=0`, ele fica `failed`. |
| D-10 (intervalo de busca injetável) | **Confirmada** | `intervaloBuscaSegundos`: o padrão da biblioteca (2 s) em produção e 0,5 s nos testes. |

### 7.2 Riscos
| ID | Risco | Mitigação |
|---|---|---|
| R-1 | **CA-2 instável:** o jitter do backoff põe o 1º atraso em [1, 2] s e o 2º em [2, 4] s (d = 1). Somada a granularidade do polling (0,5 s), o Δ1 medido na parede pode igualar ou passar o Δ2 em cerca de 0,5% das execuções. | **Ajuste de verificação do CA-2** (mantendo o CA): (a) na parede, Δ1 ≥ 1 s e Δ2 ≥ 2 s, o que vale sempre, porque o atraso agendado já é ≥ d·2^(k−1); (b) "intervalos crescentes" sobre os **atrasos agendados**: `ctx.agendadoPara` da execução k+1 menos o instante da falha k, gravado pelo handler antes do `throw`. Exige atraso2 > atraso1 e atraso1 ≥ 0,95 s. A probabilidade de empate fica na ordem de 10⁻⁴. O laço de 10 execuções do arquivo entra na conclusão do T-7. |
| R-2 | Política de fila imutável: mudar de `exclusive` para outra exige recriar a fila. | O worker recusa iniciar com divergência (`worker.falha_inicio`, `motivo: politica_divergente`). A troca vira uma demanda própria, com `deleteQueue` planejado. |
| R-3 | Um `application_name` na URL sobrepõe o do pg-boss, o CA-12 deixaria de achar as conexões e o diagnóstico em produção ficaria confuso. | Documentar no README. O CA-12 também confere, antes de derrubar as conexões, que existe sessão com `agenda-beleza:worker`. |
| R-4 | Quando a E7.1 importar o cliente numa rota, o Turbopack vai empacotar o `pg-boss` (que tem `import … with { type: 'json' }` e o peer OTel). | Fica fora desta demanda, porque nenhuma rota importa o cliente. Fica registrado para a E7.1: incluir `serverExternalPackages: ['pg-boss']` no `next.config.ts` se o build reclamar. |
| R-5 | Atualizar o pg-boss migra `pgboss` sozinho no `start()` do worker. | Versão exata. Toda atualização é uma demanda com revisão do DBA (§4.8). O CA-5 trava a versão no `package.json` e no lock. |
| R-6 | O inicializador deixar sessão aberta no template (SQLSTATE 55006). | `stop({ close: true })` em `finally`, mais a conferência A-9. O CA-6 roda em toda execução. |
| R-7 | Um encerramento forçado consome uma tentativa e o job reaparece. | É o comportamento da biblioteca. Os handlers reais precisam ser idempotentes (E7.1 CA-9, E6.3 RN-8). Documentado no README. |
| R-8 | Um processo filho órfão se o teste do CA-4 falhar no meio. | `afterAll` com `kill('SIGKILL')` se o filho ainda estiver vivo e remoção do arquivo empacotado. O `DROP … WITH (FORCE)` do próximo arquivo encerra sessões que sobrarem. |
| R-9 | Pools do cliente ou do worker esquecidos entre testes. | Todo teste fecha `encerrar()`/`stop()` no `afterAll`. O `abrirBossDeTeste` é fechado pelo próprio arquivo. A conferência de sessões não roda nas bases de worker, então a disciplina fica no T-11 (o tester confere com `pg_stat_activity` no fim de um arquivo). |
| R-10 | Tempo da suíte: retries de 1 s, jobs de 5 s e o filho. | CA-3 com `QUEUE_RETRY_BACKOFF=false` (cerca de 2 s), CA-2 com backoff (≤ 7 s), polling de 0,5 s e arquivos separados para paralelizar nos 4 workers. `testTimeout` por teste: 30 s (60 s no CA-4). |
| R-11 | Um evento `error` sem ouvinte derruba o processo, inclusive o servidor Next, pelo cliente. | O ouvinte é ligado antes do `start()` no worker, no cliente, no instalador e no `abrirBossDeTeste`. Teste unitário do cliente: o pg-boss é construído com o ouvinte já ligado. |
| R-12 | pg-boss 12.x tem lançamentos frequentes (8 versões entre setembro e novembro de 2026). | Versão exata, critério de idade de 2 semanas e diff revisado (§0). |

## 8. Estratégia de testes

Convenções da spec (§5): sem mock de banco nem do pg-boss nos testes de integração; espera por polling com prazo; `QUEUE_RETRY_DELAY_SECONDS=1` e `intervaloBuscaSegundos: 0.5`. Todo arquivo de integração fecha worker, cliente e boss de inspeção no `afterAll`.

| Arquivo | Tipo | CAs |
|---|---|---|
| `src/server/env.test.ts` | Unitário | CA-11 (padrões, inválidos, paridade com o `.env.example`, comentário com unidade e padrão) |
| `src/server/check-env.test.ts` | Unitário | CA-11 (devolve 1 nomeando a variável) |
| `src/server/queue/config.test.ts` | Unitário | CA-5 (`pg-boss` e `@opentelemetry/api` exatos em `dependencies` e iguais no lock); `opcoesPgBoss` por papel (D-6, D-2); `politicaDeRetry` |
| `src/server/queue/erros.test.ts` | Unitário | `descreverErroSeguro` remove URL, `usuario:senha` e senha (CA-13, CA-16) |
| `src/server/queue/filas.test.ts` | Unitário | CA-10 (campo extra, não UUID, não objeto, chave obrigatória, `esperaMs` fora da faixa) e RN-8 (nomes únicos, `CONTRATOS` × `FILA`) |
| `src/server/queue/client.test.ts` | Unitário | CA-15 (`vi.resetModules` + import sem ambiente: nada lançado, construtor do pg-boss não chamado). Payload inválido lança antes de construir. `ErroDeAmbiente` no 1º uso. Ouvinte de `error` ligado antes do `start` (R-11). O pg-boss é substituído por espião **só nestes casos sem I/O**. |
| `src/worker/iniciar.test.ts` | Unitário (dublê de `FilaWorker`, relógio falso) | CA-13 (ordem `adaptadores` → `iniciado` → `heartbeat` a cada 30 s, `em` em UTC; ambiente inválido sem `criarFila`); CA-14 (`stop` uma única vez com `{ graceful: true, timeout: 25000 }`, 2º sinal e SIGINT ignorados, saída 0; `emAndamento > 0` dá saída 1; `stop` que lança dá saída 1); D-007 CA-1/CA-2/CA-9 (`worker.adaptadores`); política divergente; agendamento órfão removido (ordem das chamadas) |
| `src/worker/main.test.ts` | Unitário | Liga `process.env`, `console` e `process` (inalterado, mudando `./stub` para `./iniciar`) |
| `src/worker/handlers/*.test.ts` | Unitário | `exemplo` (espera, abort, `esperaMs` padrão); stubs resolvem; `REGISTRO` tem exatamente as 4 filas com os crons do §3.7 |
| `src/scripts/enfileirar-exemplo.test.ts` | Unitário | Ponto de entrada (padrão de `src/scripts/check-env.test.ts`) |
| `tests/integration/lint/importacao-fila.test.ts` | Integração (API do ESLint) | CA-17: erro em `src/server/tenant/x.ts`, `src/app/x.ts`, `src/server/repos/x.ts`, `src/server/integrations/x.ts`, `src/app/dev/x.ts` e `src/scripts/x.ts` com `pg-boss`; aceito em `src/server/queue/x.ts`, `src/worker/x.ts`, `tests/x.test.ts`; `src/worker/x.ts` continua recusando `nodemailer` e `…/email/real`; `src/server/queue/x.ts` recusa `@/generated/prisma/client` |
| `tests/integration/worker/schema.test.ts` | Integração | CA-6 (schema `pgboss` na base; `SELECT version FROM pgboss.version` = `pgboss.schema` do `node_modules/pg-boss/package.json`; nenhuma fila; um `start()` do worker numa base copiada não muda a versão; nenhuma tabela nova em `public`) |
| `tests/integration/fila/cliente.test.ts` | Integração | CA-9 (com as filas criadas pelo `abrirBossDeTeste` com a política do contrato: 2 jobs, 2º `chave_em_uso`; `Promise.all` com a mesma chave = 1; recriação depois de `complete` e de `fail` com `QUEUE_RETRY_LIMIT=0`); CA-10 (contagem em `pgboss.job` inalterada); CA-11 (job com 3/7/false nas colunas `retry_limit`, `retry_delay`, `retry_backoff`) |
| `tests/integration/fila/indisponivel.test.ts` | Integração | CA-16: base sem `pgboss` (`DROP SCHEMA pgboss CASCADE` na base do worker do Vitest), fila inexistente (base nova do template, sem worker) e porta fechada (`localhost:1`). Erro tipado, com `motivo`, e mensagem e `JSON.stringify(cause)` sem a senha |
| `tests/integration/fila/enfileirar-exemplo.test.ts` | Integração | §3.9: 0 com job criado, 1 com argumento inválido, 1 sem fila |
| `tests/integration/worker/retry.test.ts` | Integração | CA-2 (com o ajuste R-1) e CA-3 (`failed` por `getJobById`, `output` com a mensagem da última tentativa, 3 linhas `job_falhou` com tentativas 1, 2 e 3 e sem payload; outro job da outra fila e outro da mesma fila chegam a `completed` sem reiniciar) |
| `tests/integration/worker/agendamentos.test.ts` | Integração | CA-8 (iniciar → parar → iniciar: exatamente 2 agendamentos, `tz` UTC, sem duplicata; registro de teste sem cron → órfão removido) |
| `tests/integration/worker/resiliencia.test.ts` | Integração | CA-12 (`pg_terminate_backend` filtrado por `agenda-beleza:worker`; `worker.erro_fila` sem senha; job seguinte `completed`) |
| `tests/integration/worker/inicio-encerramento.test.ts` | Integração (em processo) | CA-13 (base inexistente: `falha_inicio`, saída 1, sem senha); CA-14 (`timeoutEncerramentoMs: 2000` + `exemplo` de 5 s: `encerramento_forcado`, saída 1, job em `retry`); política divergente com uma fila pré-criada como `standard` |
| `tests/integration/worker/ponta-a-ponta.test.ts` | Integração | CA-1 (registro de produção; cliente enfileira `exemplo` e `whatsapp-reserva`; ambos `completed`; `job_concluido` das duas filas; nenhuma tabela nova em `public`); CA-7 (`worker.iniciado` com as 4 filas ordenadas; 4 filas no pg-boss; um job por stub concluído; contagem de linhas de todas as tabelas de `public` igual antes e depois) |
| `tests/integration/worker/sigterm.test.ts` | Integração (processo filho) | CA-4 (`empacotarWorker()`; filho com `envDeTeste()`; `exemplo` com `esperaMs: 5000`; SIGTERM quando `active`; código 0 em menos de 30 s; job `completed`; stdout na ordem `worker.encerrando` → `worker.job_concluido` → `worker.encerrado`) |
| `tests/integration/worker/compose.test.ts` | Integração (leitura de arquivo) | CA-14: o bloco `worker:` do `docker-compose.yml` tem `stop_grace_period: 30s`, e 30 000 > `TIMEOUT_ENCERRAMENTO_MS` |

- **Cobertura (CA-18):** todo o código de `src/worker/**` e `src/server/queue/**` roda no processo do Vitest, pelos unitários e pelas integrações em processo. O processo filho só reexecuta o que já é coberto. `main.ts` e `src/scripts/enfileirar-exemplo.ts` têm testes de ponto de entrada. Sem exclusão nova no `vitest.config.ts`.
- **E2E (Playwright):** não se aplica, porque não há tela.
- **Execução repetida:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/worker/retry.test.ts tests/integration/worker/sigterm.test.ts || break; done` termina com 0 (T-7/T-8).

## 9. Tarefas

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | desenvolvedor | — | T-2, T-3, T-4 | `package.json`, `package-lock.json`, `src/server/env.ts`, `src/server/env.test.ts`, `src/server/check-env.test.ts`, `.env.example`, `src/server/queue/{config,erros,filas}.ts` (+ `*.test.ts`) |
| T-2 | desenvolvedor | — | T-1, T-3, T-4 | `eslint.config.mjs`, `tests/integration/lint/importacao-fila.test.ts` |
| T-3 | devops | — | T-1, T-2, T-4 | `docker-compose.yml`, `docs/demandas/D-008/devops.md` |
| T-4 | dba | — | T-1, T-2, T-3 | `docs/demandas/D-008/dba.md` |
| T-5 | desenvolvedor | T-1 | — | `tests/support/db.ts`, `tests/support/fila.ts`, `tests/integration/worker/schema.test.ts` |
| T-6 | desenvolvedor | T-2, T-5 | T-7 | `src/server/queue/client.ts`, `src/server/queue/client.test.ts`, `tests/integration/fila/cliente.test.ts`, `tests/integration/fila/indisponivel.test.ts` |
| T-7 | desenvolvedor | T-2, T-5 | T-6 | `src/worker/iniciar.ts`, `src/worker/iniciar.test.ts`, `src/worker/stub.ts` e `src/worker/stub.test.ts` (remoção), `src/worker/main.ts`, `src/worker/main.test.ts`, `src/worker/handlers/**`, `tests/integration/worker/{retry,agendamentos,resiliencia,inicio-encerramento}.test.ts` |
| T-8 | desenvolvedor | T-3, T-6, T-7 | — | `package.json` (só `build:node` e `fila:exemplo`), `src/server/queue/enfileirar-exemplo.ts`, `src/scripts/enfileirar-exemplo.ts`, `src/scripts/enfileirar-exemplo.test.ts`, `tests/integration/fila/enfileirar-exemplo.test.ts`, `tests/integration/worker/{ponta-a-ponta,sigterm,compose}.test.ts` |
| T-9 | desenvolvedor | T-4, T-8 | T-10 | `README.md`, `CLAUDE.md`, `docs/demandas/D-008/dev.md` |
| T-10 | devops | T-8 | T-9 | `docs/demandas/D-008/devops.md` (e `docker-compose.yml` só se o item 5 do §5 for adotado) |
| T-11 | tester | T-9, T-10 | — | `docs/demandas/D-008/testes.md` |

Rodadas sem arquivo em comum:
- **Rodada 1:** T-1 ‖ T-2 ‖ T-3 ‖ T-4.
- **Rodada 2:** T-5.
- **Rodada 3:** T-6 ‖ T-7. Os dois compartilham só leituras (`filas.ts`, `config.ts`, `tests/support/fila.ts`) e nenhuma escrita. O T-7 não usa o cliente.
- **Rodada 4:** T-8.
- **Rodada 5:** T-9 ‖ T-10.
- **Rodada 6:** T-11.

Observações sobre a posse:
- O `package.json` é do T-1 na rodada 1 e do T-8 na rodada 4.
- O `devops.md` é do T-3 na rodada 1 e do T-10 na rodada 5.
- Pedidos de mudança no README feitos pelo DBA ou pelo DevOps vão ao T-9, sem edição direta.
- O T-6 e o T-7 dependem do T-2 para o `npm run lint` passar com o import de `pg-boss` nas pastas novas.

**T-1 — Dependências, ambiente e núcleo da fila.**
- Entregável:
  - `npm install --save-exact pg-boss@12.38.0 @opentelemetry/api@1.10.0` (lock regenerado pelo `npm`, sem `--force`/`--legacy-peer-deps`);
  - §3.1, §3.2, §3.3 e §3.4, com os testes unitários correspondentes da §8 (CA-5, CA-10 unitário, CA-11 unitário);
  - `.env.example` com as três chaves comentadas.
- Critério de conclusão:
  - `npm ci` limpo, sem aviso de `allowScripts`;
  - `npm run db:generate`, `lint`, `typecheck`, `build`, `build:node` e `test:unit` passam;
  - `grep -E '"(pg-boss|@opentelemetry/api)": "[\^~]' package.json` vazio;
  - `filas.ts` e `erros.ts` não importam `pg-boss` (só `config.ts`, e com `import type`);
  - o `stub.ts` atual continua compilando com o `Env` novo.

**T-2 — Lint D-8.**
- Entregável: §3.8 e `importacao-fila.test.ts` com os casos da §8.
- Critério de conclusão:
  - `importacao-prisma.test.ts` e `importacao-integracoes.test.ts` verdes **sem alteração**;
  - `npm run lint` verde;
  - nenhum `eslint-disable`.

**T-3 — Compose (DevOps).**
- Entregável: `stop_grace_period: 30s` no `worker` e um `devops.md` (parte 1) com os itens 1, 2 e 6 do §5 avaliados.
- Critério de conclusão: `docker compose config` mostra `stop_grace_period: 30s` no `worker`, e o job `docker` continua verde.

**T-4 — Parecer de dados (DBA).**
- Entregável: o `dba.md` com os itens 1 a 8 do §4, cada um com veredito ("confirmado" ou "ajuste X"), e a fórmula de conexões atualizada (o texto vai ao T-9 para o README).
- Critério de conclusão: todos os itens com veredito. Ajustes de constantes viram instruções explícitas para o T-6/T-7.

**T-5 — Harness e auxiliares de teste.**
- Entregável: §3.10 (inicializador, `tests/support/fila.ts`, inclusive `empacotarWorker`) e `schema.test.ts` (CA-6).
- Critério de conclusão:
  - `npm run test:integration` inteiro verde, inclusive `drift.test.ts`, `harness/*.test.ts` e o CA-6;
  - nenhuma sessão `harness:pgboss` ou `agenda-beleza:instalador` aparece na conferência A-9;
  - `empacotarWorker()` gera um `.mjs` que `node --check` aceita, e `limpar()` o remove.

**T-6 — Cliente da app.**
- Entregável: §3.5, `client.test.ts` (CA-15 e R-11), `cliente.test.ts` (CA-9, CA-10, CA-11 integração) e `indisponivel.test.ts` (CA-16).
- Critério de conclusão:
  - os testes passam 3 vezes seguidas;
  - `grep -rn "pg-boss" src --include=*.ts` só lista `src/server/queue/**` e `src/worker/**`;
  - nenhum `console.*` no cliente além do ouvinte `fila.erro`.

**T-7 — Worker e handlers.**
- Entregável: §3.6 e §3.7, remoção de `stub.ts`/`stub.test.ts` (com os comportamentos migrados para `iniciar.test.ts`), e os testes de integração `retry`, `agendamentos`, `resiliencia` e `inicio-encerramento` (CA-2 com o ajuste R-1, CA-3, CA-8, CA-12, CA-13, CA-14).
- Critério de conclusão:
  - `lint`, `typecheck`, `build:node` e `npm test` passam;
  - o laço de 10 execuções do `retry.test.ts` termina com 0;
  - `TZ=America/Sao_Paulo npx vitest run --project integration tests/integration/worker/agendamentos.test.ts` passa;
  - `grep -rn "repos\|integrations\|generated/prisma" src/worker/handlers` vazio (RN-17).

**T-8 — Ponta a ponta, SIGTERM e script manual.**
- Entregável: §3.9, `ponta-a-ponta.test.ts` (CA-1, CA-7), `sigterm.test.ts` (CA-4), `compose.test.ts` (CA-14, compose) e os testes do script.
- Critério de conclusão:
  - `npm run build:node` gera `dist/worker/main.js`, `dist/scripts/check-env.js` e `dist/scripts/enfileirar-exemplo.js`;
  - o laço de 10 execuções do `sigterm.test.ts` termina com 0;
  - `npm run worker` seguido de `npm run fila:exemplo -- 3000` em outro terminal mostra `worker.job_concluido`, e Ctrl-C sai com 0.

**T-9 — Documentação e gates.**
- Entregável:
  - README:
    - papel do worker;
    - variáveis de retry com a fórmula e as esperas reais da D-1;
    - política `exclusive`/`singletonKey` e "enfileirar só depois do commit";
    - `npm run fila:exemplo` e o procedimento manual do CA-4 com `docker compose stop worker`;
    - eventos de log;
    - a fórmula de conexões do DBA;
    - R-3 e R-7;
  - `CLAUDE.md`: "Project status" (D-008) e "Comandos e cobertura" (`fila:exemplo` e o laço de repetição);
  - `dev.md` com os gates e as evidências.
- Critério de conclusão: `lint`, `typecheck`, `build`, `npm test`, `npm run test:coverage` (≥ 90% de linhas, sem exclusão nova) e `npm run test:e2e` passam, e os seis jobs da CI ficam verdes no PR.

**T-10 — Verificação de infraestrutura (DevOps).**
- Entregável: o `devops.md` (parte 2) com os itens 3, 4 e 5 do §5, as saídas de `docker compose ps -a worker` e de `time docker compose stop worker`, a conferência do `import('pg-boss')` na imagem e a CI verde no PR.
- Critério de conclusão: cada item tem um veredito, e o CA-4 de processo foi comprovado. Mudanças no README são pedidas ao T-9.

**T-11 — Validação independente (tester).**
- Entregável: o `testes.md` com o veredito.
- Critério de conclusão: todos os CAs com evidência, mais a verificação manual do CA-4 no compose. Mutações sugeridas:
  - trocar `sinais.on` por `once` → o 2º SIGTERM no filho mata o processo (código de sinal, não 0);
  - remover o contador `emAndamento` → o CA-14 forçado sai com 0;
  - política `standard` em `whatsapp-reserva` → o CA-9 falha;
  - remover `updateQueue` → o CA-11 (retry da fila depois de mudar o env) e o CA-8 falham;
  - tirar o ouvinte de `error` → o CA-12 derruba o processo;
  - remover o `unschedule` de órfãos → o CA-8 falha;
  - incluir o payload no `job_falhou` → o CA-3 falha;
  - `migrate: true` no papel `app` → o teste de `opcoesPgBoss` falha.
  - O tester também confere `pg_stat_activity` no fim de um arquivo de worker (R-9).

### Mapa CA → tarefa → tipo de teste
| CA | Tarefa | Tipo |
|---|---|---|
| CA-1 | T-8 (`ponta-a-ponta`) | Integração |
| CA-2 | T-7 (`retry`, ajuste R-1) | Integração + execução repetida |
| CA-3 | T-7 (`retry`) | Integração |
| CA-4 | T-8 (`sigterm`), T-10 (compose), T-11 | Integração (processo filho) + processo manual |
| CA-5 | T-1 (`config.test.ts`), T-3/T-10 (job `docker`) | Unitário + CI |
| CA-6 | T-5 (`schema.test.ts`), T-4 (parecer) | Integração |
| CA-7 | T-7 (`REGISTRO`), T-8 (`ponta-a-ponta`) | Unitário + integração |
| CA-8 | T-7 (`agendamentos`, `iniciar.test.ts`) | Integração + unitário |
| CA-9 | T-6 (`cliente.test.ts`) | Integração |
| CA-10 | T-1 (`filas.test.ts`), T-6 (`cliente.test.ts`) | Unitário + integração |
| CA-11 | T-1 (`env.test.ts`, `check-env.test.ts`, `.env.example`), T-6 (colunas de retry), T-7 (worker com env inválido) | Unitário + integração |
| CA-12 | T-7 (`resiliencia`) | Integração |
| CA-13 | T-7 (`iniciar.test.ts`, `inicio-encerramento`) | Unitário + integração |
| CA-14 | T-7 (`iniciar.test.ts`, `inicio-encerramento`), T-3 (compose), T-8 (`compose.test.ts`) | Unitário + integração + leitura de arquivo |
| CA-15 | T-6 (`client.test.ts`), T-1/T-9 (`build` e `build:node` sem env) | Unitário + gate |
| CA-16 | T-6 (`indisponivel.test.ts`), T-1 (`erros.test.ts`) | Integração + unitário |
| CA-17 | T-2 (`importacao-fila.test.ts`) | Integração (API do ESLint) |
| CA-18 | T-9 (gates), T-11 | Gates + CI |
