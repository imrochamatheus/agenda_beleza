# D-024 — Desenho: outbox, envio, tentativas e backoff das mensagens de WhatsApp (issue #31, E7.1)

Entradas: `docs/demandas/D-024/spec.md` (RN-1..RN-24, CA-1..CA-27, D-1..D-13), `CLAUDE.md`, `docs/demandas/D-023/design.md` e `D-018/design.md` (formato), `docs/trinks-alinhamento.md` (§7.4, linhas 274-314). Código lido: `prisma/schema.prisma` (`Mensagem`, `MensagemTentativa`, `Reserva`), migração `20261118000000_init`, `src/server/integrations/{registry.ts,whatsapp/*}`, `src/server/queue/{filas,client,config}.ts`, `src/worker/{iniciar,main}.ts` e `handlers/*`, `src/server/repos/{index,transacao,servico,reserva,token-confirmacao}.ts`, `src/server/consentimento/leitura.ts`, `src/server/tenant/context.ts`, `eslint.config.mjs`, `tests/support/fila.ts`, `tests/integration/worker/ponta-a-ponta.test.ts`, pg-boss 12 (`plans.js`: índice único `job_i6` da política `exclusive`).

## 0. Verificações feitas antes do desenho

- **`exclusive` do pg-boss** é o índice único `(name, COALESCE(singleton_key,''))` onde `state <= 'active'` (`created < retry < active`). Um job em retry **continua** bloqueando a mesma chave; depois de `completed`/`failed` a chave é liberada. É o que sustenta `chave_em_uso` (RN-9) e a idempotência do enfileiramento.
- **Contradição da spec (RN-5 × CA-10 × RN-18):** a RN-5 deixa o job reivindicar `pendente` **e `falhou`**, mas a CA-10 exige que a reentrega de job perdido encontre `falhou` (`resultado_incerto`) e **não envie**. Reivindicar `falhou` num job reentregue reenviaria exatamente o que pode ter saído. Como o reenvio manual (RN-18) já devolve a linha a `pendente` **antes** de enfileirar, o job só precisa reivindicar `pendente`. Decisão A-3.
- **Contradição RN-16 × RN-17:** a RN-16 fala em "reserva travada em leitura"; a RN-17 diz que o envio trava só `mensagem`. Travar a reserva depois da `mensagem` inverte a ordem canônica (o chamador do evento segura a reserva e faz `UPDATE mensagem` na substituição): impasse. Decisão A-5: leitura **sem trava**, em um único comando.
- **Não existe CHECK** em `mensagem.revisao` nem em `destinatario_e164` (init `:300`, `:302`). `cliente.telefone_e164` já tem `cliente_telefone_e164_chk`, logo `destinatario_e164` copiado dela já é válido; não se acrescenta CHECK (a anonimização anula o campo e o teste de entrada inválida usa um dublê da porta).
- **Limite do bundle do worker:** `build:node` usa `--packages=external`; o `registry.ts` importa nodemailer e o cliente S3. Já são `dependencies` (a app usa) e permanecem na imagem após `npm prune --omit=dev`. Verificação obrigatória na T-5 (`build:node` e `sh docker/smoke.sh`).
- **`JobWithMetadata` traz `retryLimit` e `retryCount`.** O limite de tentativas vem do próprio job, não do ambiente (A-6).
- **Lint:** `src/server/mensagens/**` cai no bloco geral (sem Prisma, SDK, adaptador ou pg-boss; o `registry.ts` é permitido). `src/worker/**` pode importar `@/server/repos` e `@/server/queue/client`. O relógio injetável segue o padrão `deps.agora ?? new Date()` de `src/server/auth/*` (a regra de relógio só vale para `src/domain/**`).

## 1. Resumo da solução

1. **Migrações (DBA obrigatório):** (a) `…_tipo_mensagem_convite_avaliacao`: só `ALTER TYPE tipo_mensagem ADD VALUE IF NOT EXISTS 'convite_avaliacao'`, sozinha no arquivo; (b) `…_mensagem_reconciliacao`: dois índices parciais por `atualizado_em` e `CHECK (revisao >= 0)`. **DevOps dispensado** (§5).
2. **Porta:** `MODELOS_WHATSAPP` ganha o 4º modelo; igualdade com o enum do banco por asserção de tipo e por teste contra `pg_enum`.
3. **Outbox:** `registrarMensagem` (dentro da transação do evento; `INSERT … ON CONFLICT DO NOTHING`; substituição de pendentes; elegibilidade) e `enfileirarMensagens` (depois do commit; nunca lança).
4. **Envio:** handler `whatsapp-reserva` em três tempos curtos: **T1** transação (reivindica `pendente → enviando`, lê o contexto em um comando, decide, insere a tentativa); **fora de transação** (link do convite em memória, `enviarModelo`); **T2** transação (fecha a tentativa e o estado). Falha temporária com retentativas volta a `pendente` e o handler lança um erro fixo para o pg-boss reagendar.
5. **Reconciliação:** cron de 1 min mantido; reenfileira `pendente` antigas com a mesma chave (`chave_em_uso` = já há job) e fecha `enviando` presas como `falhou/resultado_incerto`, sem reenvio.
6. **Contratos para outras demandas:** `reenviarMensagem`, `mensagensDaReserva`, `GeradorLinkAvaliacao`.

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Reivindicar também `falhou` no job (RN-5 literal) | Reentrega de job perdido reenviaria `resultado_incerto` (viola CA-10/RN-10 no espírito). O reenvio manual passa por `pendente` (A-3). |
| Gravar `parametros` no registro e enviar o gravado | Congela nomes/horário antigos e guarda dado pessoal sem necessidade; a RN-11 manda ler no envio. |
| Ler o schema `pgboss` para saber se há job | Acopla ao esquema interno e o lint isola o pg-boss; `singletonKey` + `chave_em_uso` basta (D-11). |
| Novo estado `aguardando_retry` | Exige migração de enum e muda E7.3/E5.2; `pendente` + `atualizado_em` basta (D-12). |
| Segurar transação e `FOR UPDATE` na reserva durante o HTTP | Proibido (RN-17); o custo seria impasse com o chamador do evento. |
| Job `failed` na última tentativa | Duplica no pg-boss o que já está em `mensagem.estado` e polui alertas (D-6 confirmado). |
| Prazos como variáveis de ambiente | Superfície e DevOps sem necessidade; o prazo depende do timeout do adaptador (E7.2), que é código (D-3 confirmado). |
| `registrarMensagem` recebendo a revisão do chamador | Fonte de erro (chave errada = duplicata silenciosa). A função **deriva** a revisão de `reserva.revisao` na própria transação (A-2). |
| Um único índice parcial `WHERE estado IN ('pendente','enviando')` | Funciona, mas dois índices dão `EXPLAIN` objetivo para CA-24 e varreduras mínimas; custo de escrita desprezível. Decisão final do DBA. |
| Substituir `mensagem` antiga apagando a linha | Perde histórico; `substituida` preserva (RN-7). |

### 1.2 Dependências novas

Nenhuma biblioteca, ferramenta ou framework.

## 2. Decisões

| ID | Decisão | Justificativa |
|---|---|---|
| A-1 (D-1) | **Confirmada.** Elegibilidade por finalidade (`mensagens_reserva` para os 3 eventos; `convite_avaliacao` só pela própria finalidade), avaliada no registro (nasce `nao_enviada`/`cancelada_anonimizacao`, sem job) e de novo em T1. Uma função pura `decidirElegibilidade(entrada)` em `src/server/mensagens/elegibilidade.ts` é a única implementação, usada nos dois pontos. No registro `nao_enviada` guarda `destinatario_e164 = null` (só `pendente` guarda o telefone, RN-15). | Duas avaliações cobrem a anonimização entre registro e envio sem duplicar regra. |
| A-2 (D-2, RN-2) | **Fronteira e revisão derivada.** `registrarMensagem(ctx, { reservaId, tipo }, agora, r)` lê `reserva.revisao` na transação do chamador: `confirmacao` e `convite_avaliacao` = 0; `remarcacao` = `reserva.revisao` (exige ≥ 1, senão `RangeError`); `cancelamento` = `reserva.revisao`. Não valida `status` no registro (o chamador pode estar no meio do fluxo; a coerência é conferida no envio, RN-16). O chamador incrementa `reserva.revisao` **antes** de registrar a remarcação (obrigação da E3.4). | Elimina chave errada por parâmetro; testes fabricam a reserva com a revisão desejada. |
| A-3 (RN-5 ajustada) | **A reivindicação só aceita `pendente`:** `UPDATE mensagem SET estado='enviando', atualizado_em=$agora WHERE id=$1 AND salao_id=$2 AND estado='pendente'`. `falhou` só volta a `pendente` por `reenviarMensagem` (RN-18) ou por nada. `enviada` e demais estados finais nunca. | CA-10, CA-19, RN-10: reentrega nunca reenvia. |
| A-4 (RN-12 refinada) | **A tentativa só nasce quando haverá chamada ao adaptador.** Em T1, se a decisão for terminal (`obsoleta`, `nao_enviada`, `cancelada_anonimizacao`) a linha é fechada **na mesma T1** e nenhuma `mensagem_tentativa` é inserida. `mensagem_tentativa` passa a significar "chamada ao adaptador" (ou falha do gerador do link, que também a abre). | Satisfaz CA-13 ("sem tentativa de sucesso") com menos escrita e histórico fiel; E7.3 conta tentativas reais. |
| A-5 (RN-16/RN-17) | **Leitura sem trava, em um comando, depois da reivindicação e na mesma T1.** A linha de `mensagem` é a única travada. Uma remarcação gravada depois dessa leitura gera **outra** `mensagem` (própria) e é enviada à parte; a mensagem já `enviando` segue (RN-7 só toca `pendente`). O `UPDATE` de substituição do chamador que cai sobre uma linha reivindicada espera o commit de T1 e, relendo o predicado (READ COMMITTED), não a encontra mais `pendente`. | Sem impasse; janela residual conhecida e aceita. |
| A-6 (RN-6, D-6, D-10) | **Retentativas e fim.** Limite = `job.retryLimit + 1` do próprio job, entregue ao handler em `ContextoJob.tentativasMaximas`. Falha temporária (`ErroEnvioTemporario`, `NaoImplementado`, qualquer erro desconhecido, `erro_codigo = 'erro_desconhecido'` nos dois últimos): se `ctx.tentativa < tentativasMaximas` → T2 grava a tentativa `falha`, estado `pendente`, `erro_codigo`, e o handler lança `ErroReenvioAgendado` (mensagem fixa, sem causa); senão estado `falhou` e o handler **retorna** (job `completed`). Permanente: `falhou`, retorna. `numero` da tentativa é `MAX(numero)+1` por mensagem, calculado em T1 com a linha já reivindicada (sem corrida, sem 23505). | Confirma D-6/D-10. |
| A-7 (D-7, RN-7) | **Substituição estendida confirmada.** Executada **só quando a linha foi criada** (`RETURNING` do `ON CONFLICT DO NOTHING` não vazio), depois do `INSERT`, para não esperar nada além da própria chave: `remarcacao N` substitui `pendente` de `confirmacao` e `remarcacao` com `revisao < N`; `cancelamento` substitui `pendente` de `confirmacao` e `remarcacao` de qualquer revisão. Escopo: mesmo `salao_id` e `reserva_id`. `erro_codigo = 'substituida'`, `atualizado_em = $agora`. Mensagens `enviando`/`enviada`/`falhou`/`convite_avaliacao` nunca. | Evita "confirmada" depois de "cancelada"; ordem INSERT → UPDATE impede ciclos (§6, travas). |
| A-8 (D-3, RN-21) | **Prazos como constantes** em `src/server/mensagens/config.ts`: `PRAZO_PENDENTE_MS = 120_000`, `PRAZO_ENVIANDO_MS = 300_000`, `LOTE_RECONCILIACAO = 100`. Teste unitário: `PRAZO_ENVIANDO_MS` > `TIMEOUT_MAXIMO_ENVIO_MS` (constante declarada ali, 60 s, que a E7.2 deve respeitar no adaptador) e < `EXPIRACAO_PADRAO_JOB_MS` (900 000, padrão `expireInSeconds` do pg-boss, documentado). | Sem env; DevOps dispensado. |
| A-9 (D-4, RN-14) | **Gerador do link.** `type GeradorLinkAvaliacao = (ctx: SistemaContext, reservaId: string) => Promise<string>`, injetado em `criarWhatsappReserva(deps)`. Padrão de produção: ausente → `ErroEnvioPermanente('link_indisponivel')` na própria etapa de montagem (tentativa aberta e fechada com `falha`, estado `falhou`). O link só existe em variável local entre o gerador e `enviarModelo`; nunca é argumento de log, de `ErroEnvio*` nem de função que grave. Orientação à E4.5 na §3.9. | Mantém RN-14; sem implementação de produção. |
| A-10 (D-11) | **Reconciliação** em duas funções de repositório de sistema, cada uma em uma transação curta, e o handler chama `enfileirar` fora delas. (a) `listarPendentesAntigas(antesDe, limite)`: `WHERE estado='pendente' AND atualizado_em < $1 ORDER BY atualizado_em, id LIMIT $2` (sem trava, é só leitura); para cada uma, `enfileirar(..., { chave })`; `chave_em_uso` = nada; `ErroFilaIndisponivel` = log e interrompe o lote (a fila está fora). (b) `expirarEnviandoPresas(antesDe, limite)`: CTE `SELECT id … WHERE estado='enviando' AND atualizado_em < $1 ORDER BY atualizado_em LIMIT $2 FOR UPDATE SKIP LOCKED` → `UPDATE mensagem` para `falhou/resultado_incerto` → `UPDATE mensagem_tentativa SET resultado='falha', erro_codigo='resultado_incerto', finalizada_em=$agora WHERE resultado IS NULL AND mensagem_id IN (…)`. Referência de tempo = relógio injetado (`agora - PRAZO`). Os dois contados em log (`mensagem.reconciliacao`, só números). | `SKIP LOCKED` não espera sender em curso; mensagem → tentativa é a mesma ordem de T2. |
| A-11 | **Sucesso vence a reconciliação.** T2 de sucesso aceita `estado = 'enviando'` **ou** (`estado = 'falhou' AND erro_codigo = 'resultado_incerto'`) e corrige para `enviada`; as demais saídas de T2 só agem sobre `enviando`. Linha fora desses estados: T2 não escreve e o handler registra `mensagem.fechamento_ignorado`. | Se o adaptador demorou mais que `PRAZO_ENVIANDO`, o fato real (enviada) prevalece sobre o palpite. |
| A-12 (D-8) | `cancelamento` leva `salao`, `servicos`, `data`, `horario`; `convite_avaliacao` leva `salao` e `link`. Os nomes são o contrato entre `parametros.ts` e a E7.2, que os mapeia à posição do template. | Confirmada. |
| A-13 (D-9) | O telefone é lido em T1 e gravado em `destinatario_e164`. Telefone nulo (anonimizada) → `cancelada_anonimizacao`. | Confirmada. |
| A-14 | **Contexto do worker:** `contextoDeSistema(salaoId, 'worker-mensagens')`, com `salaoId` da linha da mensagem (busca por `id` em repositório pré-contexto, que devolve só `salaoId` e `estado`). Todas as demais leituras e escritas usam `ContextoEscopado`. | RN-13. |
| A-15 | **Relógio injetado.** Serviços e handlers recebem `agora: () => Date` (padrão `() => new Date()`); todo `atualizado_em`, `iniciada_em`, `finalizada_em`, `enviada_em` vem dele, nunca de `now()` do banco, para que testes com relógio fixo e a reconciliação concordem. | RN-24 e CA-8/CA-10. |
| A-16 | **`ContextoJob` ganha `tentativasMaximas: number`** (`job.retryLimit + 1`, definido em `iniciar.ts`). Campo obrigatório; testes unitários do worker são ajustados. | O handler não lê ambiente. |
| A-17 | **Cliente da fila no worker:** a reconciliação e o reenfileiramento usam o `enfileirar` de `@/server/queue/client` (papel `app`: sem migração, sem supervisão) injetável por `deps`. O harness chama `encerrarFila()` ao final dos testes. Em produção o processo sai por `process.exit`. | Reaproveita o contrato único (chave obrigatória, validação, `chave_em_uso`). |
| A-18 | **Nenhuma ação `*.acao.ts`, nenhum `'use server'`, nenhum arquivo em `src/app/**`.** `reenviarMensagem` e `mensagensDaReserva` são funções de serviço sem papel. | RN-24; E7.3/E8.3 decidem quem pode. |

## 3. Interfaces

### 3.1 Porta (`src/server/integrations/whatsapp/port.ts`)

```ts
export const MODELOS_WHATSAPP = ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'] as const;
```

`validarEnvioModelo`, o simulado e o stub real não mudam de lógica; testes ganham o 4º modelo (CA-23). `real.ts` continua `NaoImplementado('E7.2')`.

### 3.2 Tipos e chave (`src/server/mensagens/{tipos,chave,config}.ts`, client-safe)

```ts
export type TipoMensagem = ModeloWhatsApp;              // == enum do banco (asserção de tipo contra o Prisma)
export type EstadoMensagem = 'pendente' | 'enviando' | 'enviada' | 'falhou' | 'nao_enviada' | 'substituida' | 'cancelada_anonimizacao';
export const ESTADOS_FINAIS: readonly EstadoMensagem[] = ['enviada', 'nao_enviada', 'substituida', 'cancelada_anonimizacao'];
export const CODIGOS_ERRO = { semConsentimento: 'sem_consentimento', obsoleta: 'obsoleta', substituida: 'substituida',
  resultadoIncerto: 'resultado_incerto', linkIndisponivel: 'link_indisponivel', erroDesconhecido: 'erro_desconhecido' } as const;

export function chaveDaMensagem(reservaId: string, tipo: TipoMensagem, revisao: number): string; // `${reservaId}:${tipo}:${revisao}`

export type ResultadoRegistro = {
  criada: boolean; mensagemId: string; tipo: TipoMensagem; revisao: number; estado: EstadoMensagem;
  chave: string; precisaEnfileirar: boolean;             // criada && estado === 'pendente'
};
export type ResultadoReenvio =
  | { resultado: 'reenfileirada'; mensagemId: string; chave: string }
  | { resultado: 'recusada'; motivo: 'nao_falhou' | 'obsoleta' | 'cliente_anonimizada' };
export type MensagemDaReservaDTO = { id: string; tipo: TipoMensagem; revisao: number; estado: EstadoMensagem;
  enviadaEm: Date | null; erroCodigo: string | null; tentativas: number; ultimaTentativaEm: Date | null };
export type GeradorLinkAvaliacao = (ctx: SistemaContext, reservaId: string) => Promise<string>;
export class ErroReenvioAgendado extends Error {}        // mensagem fixa; nunca carrega a causa
```

`config.ts`: `PRAZO_PENDENTE_MS`, `PRAZO_ENVIANDO_MS`, `LOTE_RECONCILIACAO`, `TIMEOUT_MAXIMO_ENVIO_MS`, `EXPIRACAO_PADRAO_JOB_MS` (A-8).

### 3.3 Elegibilidade e parâmetros (puros, sem I/O)

```ts
// elegibilidade.ts
export type EntradaElegibilidade = { tipo: TipoMensagem; clienteAnonimizada: boolean; telefone: string | null;
  consentimentoMensagens: boolean; consentimentoConvite: boolean };
export type Decisao = { acao: 'enviar' } | { acao: 'terminal'; estado: 'nao_enviada' | 'cancelada_anonimizacao'; erroCodigo: string | null };
export function decidirElegibilidade(e: EntradaElegibilidade): Decisao;
// parametros.ts
export type DadosDeParametros = { salaoNome: string; fuso: string; inicio: Date; servicos: string[]; profissionalNome: string | null };
export function montarParametros(tipo: Exclude<TipoMensagem, 'convite_avaliacao'>, d: DadosDeParametros): Record<string, string>;
export function montarParametrosConvite(salaoNome: string, link: string): Record<string, string>; // { salao, link }
// coerência (RN-16)
export function conferirVigencia(tipo: TipoMensagem, m: { revisao: number }, r: { revisao: number; status: StatusReserva }): 'vigente' | 'obsoleta';
```

`servicos` sai de `formatarLista(nomes: string[])` ("A", "A e B", "A, B e C"), formatador novo em `src/lib/format.ts`; `data`/`horario` de `formatarData`/`formatarHora(inicio, fuso)`. Regras de decisão: anonimizada ou telefone nulo → `cancelada_anonimizacao`; senão `convite_avaliacao` exige `consentimentoConvite`, os demais `consentimentoMensagens`; falta → `nao_enviada/sem_consentimento`.

### 3.4 Repositório de tenant (`src/server/repos/mensagem.ts`, `Repos.mensagens`; DTOs em `repos/tipos.ts`)

```ts
export interface RepoMensagem {
  /** Cliente FOR KEY SHARE OF c + consentimentos por finalidade + reserva (sem trava), num comando. NaoEncontrado se reserva/cliente não forem do salão. */
  contextoDeRegistro(ctx: ContextoEscopado, reservaId: string): Promise<ContextoDeRegistroDTO>;
  /** INSERT … ON CONFLICT (reserva_id, tipo, revisao) DO NOTHING RETURNING; se vazio, SELECT da existente. */
  inserir(ctx: ContextoEscopado, d: NovaMensagem, agora: Date): Promise<{ criada: boolean; mensagem: MensagemLinhaDTO }>;
  substituirPendentes(ctx: ContextoEscopado, d: { reservaId: string; tipos: TipoMensagem[]; revisaoMenorQue: number | null }, agora: Date): Promise<number>;
  /** Reenvio: linha FOR UPDATE, confere vigência/cliente, devolve a decisão e aplica a transição. */
  reenviar(ctx: ContextoEscopado, mensagemId: string, agora: Date): Promise<ResultadoReenvioRepo>;
  listarDaReserva(ctx: ContextoEscopado, reservaId: string): Promise<MensagemDaReservaDTO[]>; // nunca lê destinatário, parâmetros, provedor
}
```

`ContextoDeRegistroDTO = { reservaRevisao, reservaStatus, clienteAnonimizada, telefone, consentimentoMensagens, consentimentoConvite }`. SQL do contexto: `SELECT … FROM reserva r JOIN cliente c ON (c.salao_id, c.id) = (r.salao_id, r.cliente_id) LEFT JOIN LATERAL (SELECT bool_or(finalidade='mensagens_reserva') …, bool_or(finalidade='convite_avaliacao') … FROM consentimento k WHERE k.salao_id=c.salao_id AND k.cliente_id=c.id) k ON true WHERE r.id=$1 AND r.salao_id=$2 FOR KEY SHARE OF c`. Id que não é UUID → `NaoEncontrado` sem consultar (`ehUuid`).

### 3.5 Repositório de sistema (`src/server/repos/mensagem-sistema.ts`, pré-contexto, padrão `token-confirmacao.ts`; recebe `Executor`/usa `obterPrisma`)

Única exceção ao escopo prévio é `localizar`. Todo método devolve só o necessário e nunca `parametros`, `provedor_mensagem_id` nem telefone, exceto `iniciarEnvio`.

```ts
export interface RepoMensagemSistema {
  localizar(id: string): Promise<{ salaoId: string; estado: EstadoMensagem } | null>;            // id não UUID → null
  /** T1: reivindica pendente→enviando, lê o contexto, decide e (se for enviar) insere a tentativa. Uma transação. */
  iniciarEnvio(salaoId: string, id: string, agora: Date, decidir: (c: ContextoDeEnvio) => DecisaoDeEnvio): Promise<ResultadoInicio>;
  /** T2: fecha tentativa e estado (A-11). */
  concluirEnvio(salaoId: string, id: string, tentativaId: string, r: ConclusaoEnvio, agora: Date): Promise<boolean>;
  listarPendentesAntigas(antesDe: Date, limite: number): Promise<{ id: string; salaoId: string; reservaId: string; tipo: TipoMensagem; revisao: number }[]>;
  expirarEnviandoPresas(antesDe: Date, limite: number, agora: Date): Promise<number>;
}
```

Como `iniciarEnvio` precisa da decisão pura dentro da mesma transação, ela é recebida por callback (puro, sem I/O): o repositório só importa tipos. `ResultadoInicio = { resultado: 'nao_reivindicada' } | { resultado: 'terminal'; estado; erroCodigo } | { resultado: 'enviar'; tentativaId; numero; destinatarioE164; tipo; chave; contexto: ContextoDeEnvio }`. `ContextoDeEnvio` traz `reserva` (revisão, status, início), `salaoNome`, `fuso`, `profissionalNome`, `servicos` (nomes na ordem dos itens), `clienteAnonimizada`, `telefone`, os dois consentimentos, `mensagemRevisao`, `tipo`. O `salao_id` está em **todo** predicado (`WHERE m.id=$1 AND m.salao_id=$2` e nos JOIN).

Ordem de comandos de T1 (READ COMMITTED): (1) `UPDATE … WHERE estado='pendente' RETURNING tipo, revisao, reserva_id` (trava `mensagem`; 0 linhas → `nao_reivindicada`); (2) uma consulta de contexto sem travas; (3) callback `decidir`; (4a) terminal → `UPDATE mensagem SET estado=$, erro_codigo=$, destinatario_e164=NULL, parametros=NULL, atualizado_em=$agora`; ou (4b) enviar → `INSERT mensagem_tentativa (numero = COALESCE(MAX)+1, iniciada_em=$agora)` e `UPDATE mensagem SET destinatario_e164=$tel`.

### 3.6 Serviços (`src/server/mensagens/`, sem `next/*`, sem `'use server'`)

```ts
// registrar.ts — chamado DENTRO da transação do evento
export async function registrarMensagem(ctx: ContextoEscopado, e: { reservaId: string; tipo: TipoMensagem }, agora: Date, r: Repos): Promise<ResultadoRegistro>;
// enfileirar.ts — chamado DEPOIS do commit; nunca lança
export async function enfileirarMensagens(registros: readonly ResultadoRegistro[], deps?: { enfileirar?: typeof enfileirar; log?: (l: string) => void }): Promise<void>;
// reenviar.ts (E8.3/E7.3)
export async function reenviarMensagem(ctx: ContextoEscopado, mensagemId: string, agora: Date, deps?: { enfileirar?: typeof enfileirar }): Promise<ResultadoReenvio>;
// leitura.ts (E7.3)
export async function mensagensDaReserva(ctx: ContextoEscopado, reservaId: string, r?: Repos): Promise<MensagemDaReservaDTO[]>;
```

`registrarMensagem`: `contextoDeRegistro` → `decidirElegibilidade` → `inserir` (estado inicial conforme a decisão: `pendente`, `nao_enviada`, `cancelada_anonimizacao`; `destinatario_e164` só se `pendente`) → se `criada` e o tipo for `remarcacao`/`cancelamento`, `substituirPendentes` → `ResultadoRegistro`. `enfileirarMensagens` filtra `precisaEnfileirar` e chama `enfileirar('whatsapp-reserva', { mensagemId }, { chave })`; `ErroFilaIndisponivel` e qualquer outro erro viram `console.error` de `{ evento: 'mensagem.fila_indisponivel', mensagemId, tipo, revisao }`. `reenviarMensagem`: `emTransacao(r => r.mensagens.reenviar(...))`; se `reenfileirada`, `enfileirar` com a mesma chave **depois** do commit, com o mesmo tratamento de falha (a linha já está `pendente`; a reconciliação recupera). Resultados do repositório: `falhou` + vigente + cliente ok → `pendente` (`erro_codigo = NULL`, `atualizado_em = $agora`); estado ≠ `falhou` → `nao_falhou`; revisão/status divergentes → `obsoleta` (a linha **permanece** `falhou`); cliente anonimizada → a linha vira `cancelada_anonimizacao` (campos pessoais anulados) e devolve `cliente_anonimizada`. Mensagem de outro salão ou id inválido → `NaoEncontrado`.

### 3.7 Envio e handlers

```ts
// src/server/mensagens/envio.ts (núcleo testável sem pg-boss)
export type DependenciasEnvio = { whatsapp: () => PortaWhatsApp; gerarLink?: GeradorLinkAvaliacao; agora: () => Date;
  sistema?: RepoMensagemSistema; log: (evento: string, campos: Record<string, string | number | null>) => void };
export async function enviarMensagem(mensagemId: string, tentativa: { atual: number; maxima: number }, deps: DependenciasEnvio): Promise<'concluida' | 'reagendar'>;
// src/worker/handlers/whatsapp-reserva.ts
export function criarWhatsappReserva(deps?: Partial<DependenciasEnvio>): DefinicaoFila<{ mensagemId: string }>;
export const whatsappReserva = criarWhatsappReserva();  // produção: integracoes().whatsapp, sem gerador (A-9)
// src/worker/handlers/reconciliar-mensagens.ts
export function criarReconciliarMensagens(deps?: { enfileirar?; agora?; sistema?; log? }): DefinicaoFila<Record<string, never>>;
export const reconciliarMensagens = criarReconciliarMensagens();  // cron '* * * * *'
```

`enviarMensagem` (passos): `localizar` (null → `mensagem.nao_encontrada`, `'concluida'`); `iniciarEnvio` (`nao_reivindicada` → `'concluida'` com log `mensagem.nao_reivindicada`); `terminal` → `'concluida'`; `enviar`: se `convite_avaliacao`, `gerarLink` (ausente ou lançou → `ErroEnvioPermanente('link_indisponivel')`); `parametros` de `montarParametros*`; `whatsapp().enviarModelo({ destinatarioE164, modelo: tipo, parametros, chaveIdempotencia: chave })` **fora de transação**; sucesso → `concluirEnvio(sucesso)`; erro → classificar (A-6), `concluirEnvio(falha, estadoFinal: 'pendente' | 'falhou', erroCodigo)`; devolve `'reagendar'` quando `pendente`. O handler lança `ErroReenvioAgendado` nesse caso. `erro_detalhe` recebe um texto fixo por classe (`'falha temporária'`, `'falha permanente'`, `'resultado incerto'`), nunca a mensagem do erro. `erro_codigo` vem de `codigo` dos erros da porta (conjunto fechado, validado por regex `^[a-z0-9_]{1,40}$`; fora disso `erro_desconhecido`).

Registro e cliente do pg-boss dos handlers: `registry.ts` continua a exportar as mesmas constantes (sem mudança de assinatura). O harness (`tests/support/fila.ts`) injeta `definicoes: [criarWhatsappReserva({ whatsapp: () => simulado, gerarLink: …, agora }), criarReconciliarMensagens({ … })]`.

### 3.8 Fila (`src/server/queue/filas.ts`)

Contrato `whatsapp-reserva` **inalterado** (`exclusive`, chave obrigatória, `{ mensagemId }`); só o comentário "provisório" é trocado por "definitivo (D-024)". Payload sem dado pessoal nem link (CA-11).

### 3.9 Orientação para a E4.5 (link do convite, não implementado aqui)

Viável e recomendada: token **derivado** `HMAC-SHA256(chave_do_servidor, "convite-avaliacao:" + reservaId)` em base64url, determinístico. O gerador (a) calcula o token, (b) faz `INSERT … ON CONFLICT (reserva_id) DO NOTHING` do `token_hash = SHA-256(token)` com `expira_em` de 30 dias (o desenho da E4.5 já guarda só o hash), (c) devolve `APP_URL/avaliar/<token>`. Reenvio e retentativas geram o **mesmo** link (não invalida um link possivelmente entregue com `resultado_incerto`), o token em claro nunca é gravado e a página valida recalculando o HMAC e comparando o hash com `timingSafeEqual`, mais `usado_em`/`invalidado_em`. Custo: **um segredo novo** (env da E4.5, com DevOps e README). Alternativa descartada: token aleatório por envio (cada reenvio invalidaria o anterior e exigiria gravar antes do envio). Fica como recomendação; a E4.5 decide.

### 3.10 Fronteira com as demais demandas

| Demanda | Recebe |
|---|---|
| E3.2 (#34), E3.4, E3.5 | Chamam `registrarMensagem(ctx, { reservaId, tipo }, agora, r)` **dentro** de `emTransacao`, depois de gravar a reserva (e de incrementar `revisao` na remarcação), e `enfileirarMensagens([...])` **depois** do `emTransacao`. Não conhecem estados, tentativas nem chave. E3.5 registra `convite_avaliacao` ao concluir. Para o cancelamento por equipe em salão suspenso, vale o mesmo (RN-20). |
| E4.5 | Implementa `GeradorLinkAvaliacao` (§3.9) e o injeta no handler de produção (`whatsappReserva` passa a receber o gerador por `criarWhatsappReserva({ gerarLink })`; a troca é uma linha em `handlers/whatsapp-reserva.ts`, de posse da E4.5 naquele momento). |
| E5.2 (#45) | Anonimiza: `UPDATE mensagem SET estado='cancelada_anonimizacao', destinatario_e164=NULL, parametros=NULL WHERE estado IN ('pendente')` da cliente e anula `erro_detalhe` das tentativas. O estado e a regra de envio (A-4, `decidirElegibilidade`) já existem aqui; deve tomar `FOR UPDATE` na cliente para estreitar a janela (D-5). Ordem de travas: cliente → … → mensagem. |
| E7.2 | Adaptador real: mapeia `parametros` nomeados à posição do template, timeout ≤ `TIMEOUT_MAXIMO_ENVIO_MS`, lança `ErroEnvioTemporario`/`Permanente` com código do conjunto fechado. |
| E7.3 (#51) | `mensagensDaReserva(ctx, reservaId)` (§3.6); papéis e tela são dela. |
| E8.3 (#53) | `reenviarMensagem` (§3.6); papel super admin e auditoria são dela, fora do serviço. |

## 4. Dados: DBA obrigatório

Entregáveis do DBA (T-1, `dba.md`):

1. **Migração `…_tipo_mensagem_convite_avaliacao`:** arquivo com **um único comando**, `ALTER TYPE "tipo_mensagem" ADD VALUE IF NOT EXISTS 'convite_avaliacao';`. O valor novo não pode ser usado na transação em que nasce: nada nesta migração nem na seguinte o referencia (os índices usam só `estado_mensagem`). O DBA confirma a forma segura com o Prisma 7 (execução em autocommit de um único comando; PostgreSQL 17 já permite `ADD VALUE` em transação, mas não o uso) e valida `migrate deploy` do zero e a partir da migração `20261121100000`, e o template de teste. Reversão: enum não remove valor; documentar (recriar o tipo, só antes de existir linha com o valor).
2. **Migração `…_mensagem_reconciliacao`:** `CREATE INDEX "mensagem_pendente_atualizado_em_idx" ON "mensagem"("atualizado_em") WHERE "estado" = 'pendente'` e `"mensagem_enviando_atualizado_em_idx" … WHERE "estado" = 'enviando'` (a consulta usa o literal, nunca parâmetro, para o plano parcial valer: o repositório escreve `'pendente'`/`'enviando'` como literais, como o `'confirmado'` da D-016); `ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_revisao_chk" CHECK ("revisao" >= 0)`. Avaliar se um índice único `IN (…)` basta (decisão final do DBA) e confirmar com `EXPLAIN` sem `Seq Scan` com volume de teste (CA-24). Prisma não expressa índice parcial: fica só no SQL; `drift.test.ts` ganha os dois índices e o CHECK.
3. **Cobertura já existente:** `mensagensDaReserva` e o reenvio usam `(salao_id, reserva_id)` e o `UNIQUE (reserva_id, tipo, revisao)` (confirmar no `EXPLAIN`). A busca por id usa a PK. A inserção da tentativa e o `MAX(numero)` usam `UNIQUE (mensagem_id, numero)`.
4. **Não adicionar:** CHECK de `destinatario_e164` (A-§0), coluna nova em `mensagem`, estado novo. `parametros` jsonb permanece (usado só como `NULL` aqui).
5. `schema.prisma`: valor `convite_avaliacao` em `TipoMensagem`; `@@index` com `where` não existe, então os índices parciais e o CHECK ficam fora do schema (como o `reserva_sem_sobreposicao`); `npm run db:generate`.
6. Testes sob posse do DBA: `tests/integration/db/drift.test.ts` (`:78` enum `tipo_mensagem`, índices, CHECK, lista de migrações) e `tests/integration/harness/template.test.ts` (lista de migrações); CA-24.

## 5. Infraestrutura: DevOps dispensado

Sem variável de ambiente (RN-21; os prazos são constantes), sem container, sem alteração de `docker-compose.yml`, workflow ou `.env.example`. Condição de reabertura: se a T-5 mostrar que `sh docker/smoke.sh` ou `npm run build:node` falha porque o worker passou a carregar um pacote que a imagem não contém, aciona-se o DevOps; pelo levantamento (§0) isso não ocorre. Observabilidade: logs JSON do worker com os campos da RN-22 (`mensagemId`, `tipo`, `revisao`, `tentativa`, `estado`, `erroCodigo`).

## 6. Verificação das invariantes

| Invariante | Aplica? | Como é atendida |
|---|---|---|
| Escopo por salão no servidor | Sim | `ContextoEscopado` em tudo, `salao_id` em todo predicado e JOIN (§3.4/3.5). Única busca sem escopo prévio é `localizar(id)`, devolve `salaoId` e `estado`; dali em diante `contextoDeSistema(salaoId)` com o salão **da linha**. `registrar`, `reenviar` e `listar` recusam outro salão com `NaoEncontrado` (CA-18). |
| Exclusion constraint anti-sobreposição | Não se aplica (nenhuma escrita em `reserva`); a CA-19 prova que o rollback por `23P01` não deixa mensagem. | Mensagem e reserva compartilham a transação do chamador (`registrar` recebe o `Repos` da transação). |
| UTC com fuso do salão | Sim | Tudo em UTC; `data`/`horario` formatados no fuso lido em T1 (`salao.fuso`) por `formatarData/Hora` de `src/lib/format.ts`; fuso novo vale no envio. Teste com `TZ=UTC` e `TZ=America/Sao_Paulo` e reserva às 23:30 local. |
| Adaptadores de integração | Sim | WhatsApp só pela porta via `registry.ts`; lint e teste estático (CA-26). Simulado nos testes, `NaoImplementado` no real. |
| Soft delete e anonimização | Sim | Mensagem não apaga nada; serviço/profissional inativos continuam com nome; cliente anonimizada → `cancelada_anonimizacao` (A-4, RN-12), `destinatario_e164`/`parametros` nulos. Janela durante o HTTP: residual e aceita (D-5; E5.2 estreita com `FOR UPDATE` da cliente). |
| Salão suspenso somente leitura | Sim | Pipeline é de sistema; o handler não consulta assinatura, então `cancelamento` da equipe sai em salão suspenso (CA-20). |
| Idempotência de webhooks e mensagens | Sim | `UNIQUE(reserva_id,tipo,revisao)` + `ON CONFLICT DO NOTHING`; `singletonKey = reserva:tipo:revisao`; reivindicação atômica só de `pendente`; `enviada` nunca reivindicada; mesma chave como `chaveIdempotencia` do adaptador. Webhooks: não se aplica. |
| Auditoria do super admin | Não se aplica aqui. O reenvio por super admin (E8.3) audita no chamador; `reenviarMensagem` não decide papel. |
| Falha de envio não altera a reserva | Sim | O worker só escreve `mensagem` e `mensagem_tentativa`; checksum de `reserva`, `reserva_item`, `cliente`, `consentimento`, `salao` (CA-3, CA-27). |
| Link do convite fora de qualquer registro | Sim | Só em memória entre gerador e porta; nunca em `parametros`, tentativa, log, erro ou payload (CA-11/CA-21). |

**Ordem de travas.** `salao → profissional → serviço → cliente → consentimento → reserva/itens → mensagem` (cabeçalho de `repos/servico.ts` ganha esta posição, T-3). `registrar` toma `FOR KEY SHARE OF c` na cliente (compatível com `NO KEY UPDATE` do upsert; conflita só com `FOR UPDATE` de edição de telefone/anonimização, que esperam a transação curta do evento) e depois `INSERT`/`UPDATE` em `mensagem`, sempre por último. **Substituição** só depois do `INSERT` criado: duas transações com o mesmo evento esperam só na chave (sem ciclo); registros de revisões distintas em paralelo atualizam as mesmas linhas antigas na mesma ordem. **Envio** toma `mensagem` (UPDATE) e lê o resto sem trava; reconciliação usa `FOR UPDATE SKIP LOCKED` em `mensagem` e depois `UPDATE mensagem_tentativa` (a mesma ordem de T2: nunca tentativa antes de mensagem). `reenviar`: `mensagem FOR UPDATE` primeiro e leituras sem trava depois (a reserva/cliente são lidas, não travadas). O reenvio **não** toma a cliente ou a reserva; por isso não invade a ordem.

## 7. Riscos e decisões

| ID | Risco | Mitigação |
|---|---|---|
| R-1 | Adaptador responde depois de `PRAZO_ENVIANDO`: reconciliação marca `falhou` e o envio de fato ocorreu. | A-11 faz o sucesso tardio corrigir para `enviada`; o reenvio manual de `resultado_incerto` é decisão humana (RN-18). E7.2 limita o timeout (< 60 s). |
| R-2 | T2 falha depois do sucesso do adaptador (banco fora): mensagem fica `enviando`. | O job é reentregue, não reivindica e termina; a reconciliação fecha como `falhou/resultado_incerto` (CA-10). Nunca há reenvio automático. |
| R-3 | Reconciliação a cada minuto reexamina até 100 `pendente` antigas cujo job está em retry (cada uma devolve `chave_em_uso`). Se houver mais de 100 assim, as mais novas esperam. | Custo de 1 `send` por mensagem por minuto; volume previsto baixo; aceito. Evolução (se medido): ordenar por `atualizado_em` e saltar quem já foi tentada no ciclo, em demanda própria. |
| R-4 | Janela da anonimização durante a chamada ao adaptador (D-5). | Aceita; E5.2 toma `FOR UPDATE` da cliente. |
| R-5 | Worker passa a carregar o registro de integrações (nodemailer, S3). | Pacotes já em `dependencies`; T-5 roda `build:node` e `docker/smoke.sh`; DevOps só se falhar. |
| R-6 | `ADD VALUE` do enum no Prisma/PG. | Migração isolada de um comando; DBA valida do zero e incremental e o template. |
| R-7 | Handler de produção sem `gerarLink` envia `convite_avaliacao` como `falhou/link_indisponivel`. | Intencional até a E4.5; E3.5 só registra o convite quando a E4.5 existir (spec §3). |
| R-8 | Segundo pool de conexões do cliente `app` dentro do worker. | Pool pequeno (`POOL_FILA.app`); encerrado por `process.exit`; harness chama `encerrarFila()`. |
| R-9 | Remarcação gravada entre a leitura de T1 e a chamada do adaptador: sai texto da revisão antiga. | A nova revisão tem mensagem própria e é enviada em seguida; o cliente recebe as duas, na ordem. Aceito (A-5). |
| R-10 | Ordem de entrega fora de ordem entre a confirmação e a remarcação. | A conferência de vigência (RN-16) substitui a obsoleta; entre vigentes a ordem de fila é a de criação. |

## 8. Estratégia de testes

- **Unidade (Vitest `unit`):** `chave`, `config` (prazos), `elegibilidade` (tabela completa de decisão), `parametros` e `conferirVigencia`; `formatarLista`; `port.test.ts` com o 4º modelo; `enviarMensagem` com repositório de sistema e porta em dublê (classificação de erros, `erro_codigo` fechado, `link_indisponivel`, entrada inválida permanente `destinatario_invalido`, logs sem dado pessoal); `iniciar.test.ts`/`handlers.test.ts` com `tentativasMaximas`; fusos (`TZ=UTC` e `TZ=America/Sao_Paulo`).
- **Integração (PostgreSQL real, `tests/integration/mensagens/`):** `registro.test.ts`, `envio.test.ts` (worker pg-boss real, simulado, `QUEUE_RETRY_DELAY_SECONDS=1`, relógio e gerador injetados), `reconciliacao.test.ts`, `reenvio.test.ts`, `isolamento.test.ts`, `idempotencia.test.ts` e `concorrencia.test.ts` (estabilidade ×10), `convite.test.ts` (vazamento do link em colunas, `pgboss.job.data`, logs), `leitura.test.ts`, `migracao.test.ts` (DBA/CA-24) e `estrutura.test.ts` (CA-26). `ponta-a-ponta.test.ts` é ajustado para permitir `mensagem` e `mensagem_tentativa` (CA-27).
- **Playwright:** nenhum (sem tela, sem rota; `src/app/**` não é tocado).
- **Cobertura ≥ 90% de linhas:** o código novo é quase todo coberto por integração (repositórios e serviços) e unidade (puros); a T-8 roda `npm run test:coverage` e eleva o que ficar abaixo, sem exclusão nova.
- **Estabilidade:** `for i in $(seq 10); do npx vitest run --project integration tests/integration/mensagens/concorrencia.test.ts tests/integration/mensagens/idempotencia.test.ts || break; done` (CA-9, CA-25); fuso: `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/mensagens src/lib/format.test.ts || break; done`.

### Mapa CA → tarefa → teste

| CA | Tarefa | Teste |
|---|---|---|
| CA-1 | T-4, T-5, T-7 | integração `envio.test.ts` (parâmetros, chave, fuso) |
| CA-2 | T-5, T-7 | integração `envio.test.ts` (backoff, intervalos crescentes) |
| CA-3 | T-5, T-7 | integração `envio.test.ts` (esgota; checksum da reserva) |
| CA-4 | T-3, T-4, T-7 | integração `idempotencia.test.ts` (inclui paralelo, sem 23505) |
| CA-5 | T-4, T-5, T-7 | integração `registro.test.ts` + `envio.test.ts` |
| CA-6 | T-3, T-4, T-7 | integração `reenvio.test.ts` |
| CA-7 | T-3, T-4, T-5, T-7 | integração `registro.test.ts` (substituição) + `envio.test.ts` (job já na fila) |
| CA-8 | T-4, T-5, T-7 | integração `reconciliacao.test.ts` |
| CA-9 | T-3, T-5, T-7 | integração `concorrencia.test.ts` (duas chamadas concorrentes; ×10) |
| CA-10 | T-3, T-5, T-7 | integração `reconciliacao.test.ts` (+ `SIGKILL` ou reentrega simulada) |
| CA-11 | T-5, T-7 | integração `convite.test.ts` |
| CA-12 | T-5, T-7 | integração `convite.test.ts` |
| CA-13 | T-4, T-5, T-7 | integração `envio.test.ts` + `registro.test.ts` (anonimização) |
| CA-14 | T-2, T-4, T-7 | unidade `elegibilidade` + integração `registro.test.ts` |
| CA-15 | T-2, T-5, T-7 | unidade `conferirVigencia` + integração `envio.test.ts` |
| CA-16 | T-3, T-4, T-7 | integração `registro.test.ts` |
| CA-17 | T-5, T-7 | integração `envio.test.ts` + unidade `enviarMensagem` (entrada inválida) |
| CA-18 | T-3, T-4, T-7 | integração `isolamento.test.ts` |
| CA-19 | T-4, T-7 | integração `registro.test.ts` (rollback, `23P01`) |
| CA-20 | T-5, T-7 | integração `envio.test.ts` (salão suspenso) |
| CA-21 | T-5, T-7 | integração (log capturado em todos os cenários) + unidade |
| CA-22 | T-3, T-4, T-7 | integração `leitura.test.ts` |
| CA-23 | T-1, T-2 | unidade `port.test.ts` + integração `migracao.test.ts` (`pg_enum`) |
| CA-24 | T-1, T-7 | integração `migracao.test.ts` (`EXPLAIN`, enum, UNIQUE) |
| CA-25 | T-3, T-4, T-5, T-7 | integração `concorrencia.test.ts` (×10) |
| CA-26 | T-7 | `estrutura.test.ts` + `npm run lint` |
| CA-27 | T-7 | `ponta-a-ponta.test.ts` ajustado + checksum por tabela |

## 9. Tarefas

Rodada 1: T-1. Rodada 2 (paralelas, sem arquivo em comum): T-2, T-3, T-6. Rodada 3 (paralelas): T-4, T-5. Rodada 4: T-7. Rodada 5: T-8.

### T-1 — Migrações, schema e testes de esquema (dba)

- **Dependências:** nenhuma. Parecer `docs/demandas/D-024/dba.md`.
- **Arquivos sob posse:** `prisma/schema.prisma`, `prisma/migrations/<ts>_tipo_mensagem_convite_avaliacao/migration.sql`, `prisma/migrations/<ts>_mensagem_reconciliacao/migration.sql` (timestamps posteriores a `20261121100000`), `tests/integration/db/drift.test.ts`, `tests/integration/harness/template.test.ts`, `docs/demandas/D-024/dba.md`.
- **Entregável:** §4 itens 1, 2, 5, 6 e decisão sobre os índices; cliente Prisma regenerado (`npm run db:generate`).
- **Conclusão:** `migrate deploy` do zero e incremental; `migrate diff … --exit-code` sem diferença; `npx vitest run --project integration tests/integration/db tests/integration/harness` passando; `EXPLAIN` sem `Seq Scan` nas duas consultas de reconciliação com volume de teste.

### T-2 — Porta, formatador e módulo puro (desenvolvedor)

- **Dependências:** T-1 (precisa do cliente regenerado para a asserção de tipo).
- **Arquivos sob posse:** `src/server/integrations/whatsapp/{port,simulado,real}.ts` e seus testes; `src/lib/format.ts` e `src/lib/format.test.ts` (`formatarLista`); `src/server/mensagens/{tipos,chave,config,elegibilidade,parametros}.ts` e os `*.test.ts` correspondentes.
- **Entregável:** §3.1, §3.2, §3.3.
- **Conclusão:** unidade passando (inclusive em `TZ=UTC` e `TZ=America/Sao_Paulo`); `lint` e `typecheck` limpos; o teste que compara `MODELOS_WHATSAPP` ao enum Prisma passa.

### T-3 — Repositórios (desenvolvedor)

- **Dependências:** T-1. Paralela a T-2 e T-6 (DTOs em `repos/tipos.ts`, sem importar de `src/server/mensagens`).
- **Arquivos sob posse:** `src/server/repos/mensagem.ts`, `src/server/repos/mensagem-sistema.ts`, `src/server/repos/index.ts` (`Repos.mensagens`), `src/server/repos/tipos.ts` (DTOs, `ContextoDeEnvio`, `ResultadoInicio`, `ConclusaoEnvio`), cabeçalho de `src/server/repos/servico.ts` (posição da `mensagem` na ordem de travas), `src/server/repos/index.test.ts`.
- **Entregável:** §3.4 e §3.5, com SQL parametrizado, literais `'pendente'`/`'enviando'` nas consultas dos índices parciais, `salao_id` em todo predicado.
- **Conclusão:** testes de repositório (integração rápida) cobrem reivindicação atômica (dois executores, uma vitória), numeração de tentativa, `expirarEnviandoPresas` com `SKIP LOCKED`, escopo por salão; sem `23505` não tratado.

### T-4 — Serviços de registro, enfileiramento, reenvio e leitura (desenvolvedor)

- **Dependências:** T-2, T-3. Paralela a T-5.
- **Arquivos sob posse:** `src/server/mensagens/{registrar,enfileirar,reenviar,leitura}.ts` e `*.test.ts`.
- **Entregável:** §3.6, §3.10; nenhum `'use server'`, nenhum import de Prisma/SDK/adaptador.
- **Conclusão:** unidade com `Repos` e fila dublados para ramos de erro; `lint` e `typecheck` limpos.

### T-5 — Envio, handlers e contexto do job (desenvolvedor)

- **Dependências:** T-2, T-3. Paralela a T-4.
- **Arquivos sob posse:** `src/server/mensagens/envio.ts` (+ `.test.ts`), `src/worker/handlers/{whatsapp-reserva,reconciliar-mensagens,tipos,registry}.ts`, `src/worker/handlers/handlers.test.ts`, `src/worker/iniciar.ts` e `iniciar.test.ts` (campo `tentativasMaximas`), `src/server/queue/filas.ts` (só o comentário do contrato) e `filas.test.ts` se citar o comentário.
- **Entregável:** §3.7, §3.8, A-3, A-4, A-6, A-10, A-11, A-16, A-17.
- **Conclusão:** unidade passando; `npm run build:node` gera o worker; `sh docker/smoke.sh` verde (R-5); log do worker sem dado pessoal.

### T-6 — Fábricas de teste (desenvolvedor)

- **Dependências:** T-1. Paralela a T-2/T-3.
- **Arquivos sob posse:** `tests/support/factories.ts`, `tests/support/mensagens.ts` (novo).
- **Entregável:** fábricas de reserva com itens e profissional, de cliente com consentimento por finalidade, de `mensagem` em qualquer estado/tentativa, captura de logs, leitura de checksum por tabela e do `sim_whatsapp_chamada`.
- **Conclusão:** usadas por T-7; testes existentes que importam `factories.ts` continuam passando.

### T-7 — Testes de integração e de estrutura (desenvolvedor; pode ser dividida por arquivo)

- **Dependências:** T-4, T-5, T-6.
- **Arquivos sob posse:** `tests/integration/mensagens/*.test.ts` (novos), `tests/integration/worker/ponta-a-ponta.test.ts`, `tests/support/fila.ts` (só se precisar de `encerrarFila()` ou de injeção de `definicoes`).
- **Entregável:** mapa CA → teste (§8), incluindo `SIGKILL`/reentrega do CA-10 e os checksums do CA-27.
- **Conclusão:** `npm run test:integration` passando; estabilidade ×10 dos dois comandos da §8 sem falha; nenhum `sleep` fixo (polling com prazo).

### T-8 — Documentação e fechamento (desenvolvedor)

- **Dependências:** T-7.
- **Arquivos sob posse:** `README.md` (pipeline, estados, prazos, reenvio, link do convite), `CLAUDE.md` (resumo da D-024 e dos comandos de estabilidade), `docs/demandas/D-024/dev.md`.
- **Entregável:** documentação; `npm run lint`, `typecheck`, `build`, `test:coverage` (≥ 90% de linhas), e `test:e2e` rodados e registrados.
- **Conclusão:** todos os gates da definição de pronto verdes, com evidência em `dev.md`.

## 10. Transferências e obrigações

- **Ao DBA (T-1):** §4 inteiro; foco no `ADD VALUE` isolado, nos dois índices parciais com literais e no `CHECK (revisao >= 0)`; devolve `dba.md` antes da T-2.
- **Ao DevOps:** nada agora (dispensado, §5); só se a T-5 falhar no `docker/smoke.sh`.
- **Às demandas futuras:** E3.2/E3.4/E3.5 seguem §3.10 e a ordem de travas (a posição da `mensagem` é a última); E4.5 segue §3.9 e acrescenta o segredo do HMAC com DevOps; E5.2 e E8.3 conforme §3.10; E7.2 respeita o timeout e o conjunto fechado de códigos.
