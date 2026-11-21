# D-025 — Desenho: criar reserva com snapshot, revalidação no servidor, tradução do `23P01` e idempotência (issue #34, E3.2)

Entradas: `docs/demandas/D-025/spec.md` (RN-1..RN-22, CA-1..CA-28, D-1..D-13), `CLAUDE.md`, `docs/demandas/D-024/design.md` e `D-018/design.md` (formato). Código lido: `src/server/repos/{reserva,profissional,servico,salao,cliente,consentimento,mensagem,transacao,disponibilidade}.ts`, `src/server/disponibilidade/{servico,tipos}.ts`, `src/domain/disponibilidade/tipos.ts`, `src/server/clientes/{servico,erros-banco,validacao}.ts`, `src/server/consentimento/{servico,validacao}.ts`, `src/server/mensagens/{registrar,enfileirar}.ts`, `src/server/tenant/{context,politica,erros}.ts`, `src/server/tempo/fuso.ts`, `prisma/schema.prisma` (Reserva, ReservaItem), `tests/support/{factories,mensagens,db}.ts`.

## 0. Verificações feitas antes do desenho

- **Nenhuma migração.** `reserva` tem `UNIQUE(salao_id, chave_requisicao)`, `UNIQUE(salao_id, reserva_id, ordem)` em `reserva_item`, `reserva_ordem_chk` e a exclusion `reserva_sem_sobreposicao`. Confirmado.
- **O `intervalo_min` está na própria linha de `salao`** (`schema.prisma:142`). A trava de leitura do salão (A-2) pode devolvê-lo junto com o fuso, sob a mesma trava. Isso torna desnecessário o aditivo na D-018 (D-5 da spec rejeitada, A-4) e serve também ao `encaixe`, que não chama `consultarDisponibilidade`.
- **`consultarDisponibilidade` lança `NaoEncontrado`** quando `profissionalId` é informado e não há candidato (`servico.ts:68`). Como a reserva trava e confere o profissional antes (A-3), esse ramo não é alcançável; mesmo assim o serviço o traduz para `profissional_indisponivel` (defesa).
- **`HorarioOferecido.inicio` é `Date`** (`domain/disponibilidade/tipos.ts:57`): a comparação é por `getTime()`.
- **`PoliticaOperacao` é tipada para `TenantContext`** (`politica.ts:9`). Para o público é preciso um tipo próprio (A-9).
- **`tests/support/mensagens.ts` já tem fábricas de reserva com itens** (D-024 T-6). A D-025 não edita `factories.ts` nem `mensagens.ts`: cria `tests/support/reservas.ts` e reutiliza as existentes.
- **A ordem de travas do cabeçalho de `repos/servico.ts` põe cliente → consentimento antes de reserva/itens.** A RN-10 da spec põe a reserva antes do consentimento. Não há conflito: consentimento, `reserva` e `reserva_item` só tomam `FOR KEY SHARE` em linhas que a transação já segura por travas mais fortes (cliente `NO KEY UPDATE` pelo upsert, profissional/serviço/salão `FOR SHARE`). Cabeçalho atualizado na T-3.
- **Formato real do erro do `23P01` com o Prisma 7.** `ehViolacaoDeTelefoneUnico` aceita `P2002` e `P2010` (`meta.code`); o `23P01` no INSERT bruto deve chegar como `P2010`, mas a forma exata (inclusive `meta.driverAdapterError`/`cause`) deve ser capturada de um erro real, não suposta. A T-2 começa por um experimento descartável contra o PostgreSQL de teste, e o CA-27 passa a afirmar o reconhecimento sobre o erro **real** (A-8).

## 1. Resumo da solução

Um serviço de domínio `criarReserva(ctx, entrada, deps?)` em `src/server/reservas/` (sem `'use server'`, sem `next/*`), composto por:

1. **Fase pura (sem banco):** valida a entrada, a política e o consentimento; o resultado `invalido`/`consentimento_ausente` nunca toca o banco.
2. **Pré-leitura de idempotência (fora de transação):** com `chaveRequisicao`, `buscarPorChave`; se existe, devolve `repetida` (ou `chave_reutilizada`) sem revalidar.
3. **Uma `emTransacao` (READ COMMITTED):** salão `FOR SHARE` → profissional `FOR SHARE` → serviços `FOR SHARE` por `id` → (modo normal) `consultarDisponibilidade` com o leitor da transação → gancho `aposRevalidar` → `upsertCliente` → gancho `antesDaReserva` → `INSERT reserva … ON CONFLICT (salao_id, chave_requisicao) DO NOTHING RETURNING` → itens → consentimento → `registrarMensagem('confirmacao')`. Todo desfecho que não seja `criada` é sinalizado por uma exceção-sentinela interna que desfaz a transação inteira (RN-13).
4. **Fora da transação:** o `23P01` (já com rollback feito) é reconhecido por SQLSTATE **e** nome da constraint e vira `horario_indisponivel` com `causa: '23P01'`; com chave, relê-se por chave antes de concluir (a vencedora com a mesma chave é `repetida`, não conflito). Depois do commit, `enfileirarMensagens` (nunca lança).

Um conjunto de métodos novos de repositório (travas de leitura, `criar`, `criarItens`, `buscarPorChave`) e quatro módulos puros (`tipos`, `validacao`, `montar-itens`, `erros-banco`).

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Salão `FOR NO KEY UPDATE` na reserva | Serializa todas as reservas do salão e elimina o `23P01` como caminho de concorrência (CA-2b não teria perdedoras `23P01`). `FOR SHARE` basta: conflita só com quem grava regras/slug/perfil/funcionamento (`NO KEY UPDATE`). |
| Salão lido sem trava (alternativa do analista em D-1) | A revalidação poderia usar regras/fuso que mudam entre a leitura e o commit; a trava custa uma linha e dá regras estáveis até o commit (CA-15c). |
| `intervaloMin` no resultado `ok` da D-018 (D-5 da spec) | Obriga a mexer em `disponibilidade/{tipos,servico}.ts` sem necessidade: o `intervalo_min` sai da mesma linha de salão já travada (A-2). Mantém a D-018 intocada, sem risco para os testes dela. |
| Snapshot dos itens a partir do resultado da consulta (RN-8) | O `encaixe` não consulta; ter dois caminhos para o snapshot é pior. O snapshot sai das linhas de serviço travadas (A-3), idênticas às da consulta sob a trava. A consulta passa a servir só de veredito de horário. |
| Capturar `23505`/`23P01` dentro da transação com savepoint | Aborta ou complica a transação; o projeto usa `ON CONFLICT DO NOTHING` + releitura. O `23P01` é traduzido fora (RN-3). |
| Revalidar por reimplementação da regra | Divergiria de `calcularDisponibilidade`. Reutiliza-se a D-018 com o leitor da transação (RN-8). |
| `modo: 'encaixe'` adiado à E3.4 (D-6) | O contrato (campo `encaixe`, mesmo caminho de dados, constraint no encaixe, PLAN CA 3) cabe em um ramo curto e fica testável agora. Mantido. |
| Gancho de barreira por `pg_advisory_lock` no teste | Exige SQL auxiliar e conexão extra por teste; um `deps.aposRevalidar` opcional é mais simples e determinístico (A-6). |
| Exceção tipada `HorarioIndisponivel` | A convenção D-015 é resultado discriminado; só 401/403/404 são `ErroDeDominio`. |
| Falha injetada por dependências em cada etapa (CA-23) | Polui o contrato de produção. Os testes injetam a falha por **trigger no banco da suíte** (`BEFORE INSERT … RAISE EXCEPTION`) por tabela. |

### 1.2 Dependências novas

Nenhuma biblioteca, ferramenta ou framework. Nenhuma variável de ambiente.

## 2. Decisões

| ID | Decisão | Justificativa |
|---|---|---|
| A-1 (D-1) | **Ordem de travas confirmada:** salão `FOR SHARE` → profissional `FOR SHARE` → serviços `FOR SHARE` ordenados por `id` → cliente (upsert, `NO KEY UPDATE` se já existe) → `reserva` → `reserva_item` → consentimento → `mensagem`. Sem ciclo (§6.1). | Consistente com o cabeçalho de `repos/servico.ts` (salão primeiro, profissional, serviço) e com D-022 A-6. |
| A-2 | **`RepoSalao.travarParaLeitura(ctx): Promise<{ fuso: string; intervaloMin: number }>`:** `SELECT fuso, intervalo_min FROM salao sa WHERE sa.id = $1::uuid FOR SHARE OF sa`. Sem linha → `NaoEncontrado`. O marcador `FOR SHARE OF sa` é procurado em `pg_stat_activity` pelos testes. | Uma linha de salão dá fuso e intervalo sob trava. |
| A-3 | **`RepoProfissional.travarParaReserva(ctx, id): Promise<{ ativo: boolean } \| null>`** (`SELECT ativo FROM profissional p WHERE p.id = $1 AND p.salao_id = $2 FOR SHARE OF p`; id malformado ou sem linha → `null`, sem consultar o malformado) e **`RepoServico.travarParaReserva(ctx, ids, profissionalId): Promise<ServicoTravado[]>`**: um comando `SELECT s.id, s.nome, s.ativo, s.preco_centavos, s.duracao_min, EXISTS (SELECT 1 FROM servico_profissional sp WHERE sp.salao_id = s.salao_id AND sp.servico_id = s.id AND sp.profissional_id = $p) AS vinculado FROM servico s WHERE s.salao_id = $1 AND s.id = ANY($ids::uuid[]) ORDER BY s.id FOR SHARE OF s`, ids não-UUID descartados antes. O serviço compara a contagem retornada com a pedida (diferença → `servico_indisponivel`), exige `ativo` e `vinculado` de todos. **O snapshot dos itens vem destas linhas**, na ordem de `servicoIds`. Vínculo é lido sem trava própria: só muda sob `FOR NO KEY UPDATE` do serviço (D-014), que a nossa `FOR SHARE` bloqueia. | Corrige D-8 do `repos/profissional.ts:17`/`servico.ts:12-19`: `ativo` conferido sob a trava. Sem `NaoEncontrado` para ids de outro salão (RN-14). |
| A-4 (D-5 rejeitada) | **D-018 intocada.** `ocupado_ate = fim + intervaloMin` com o `intervaloMin` de A-2. | §1.1. |
| A-5 | **`RepoReserva.criar(ctx, d): Promise<{ criada: true; id: string } \| { criada: false }>`:** INSERT bruto com literal `'confirmado'`, `revisao 0`, cast de `origem` para o enum `origem_reserva`, `ON CONFLICT (salao_id, chave_requisicao) DO NOTHING RETURNING id`. **`criarItens(ctx, reservaId, itens)`:** um `createMany` (um comando). **`buscarPorChave(ctx, chave): Promise<ReservaDTO \| null>`** (Prisma `findFirst` com `CAMPOS`; chave não UUID → `null` sem consultar). O `23P01` não é capturado nos repositórios. | Padrão do projeto; constante de comandos (CA-25). |
| A-6 (D-4) | **Gancho `deps.aposRevalidar?: () => Promise<void>`**, chamado só no modo normal, depois de a revalidação passar e antes do upsert. Documentado como "só teste", padrão ausente; nada em produção o define. | Torna o CA-2b determinístico sem `sleep`; custo zero em produção. |
| A-7 | **Sentinela interna** `class DesfazerReserva extends Error { constructor(readonly saida: SaidaInterna) }` (não exportada de `reservas/index`): toda saída que não seja `criada`, depois do primeiro acesso, é lançada de dentro de `fn` para o `emTransacao` desfazer, e capturada **fora**. Saídas antes de qualquer escrita (travas) usam o mesmo mecanismo por uniformidade. | RN-13 com um só mecanismo. |
| A-8 (RN-3) | `erros-banco.ts`: `ehConflitoDeSobreposicao(e: unknown): boolean`, `RESTRICAO_SOBREPOSICAO = 'reserva_sem_sobreposicao'`. Reconhece **SQLSTATE `23P01` e o nome da constraint**, em `P2010` (`meta.code`/mensagem/`cause`) e em erro cru do `pg` (`code`, `constraint`). Fixtures de unidade baseadas no erro real capturado na T-2; o CA-27 reconhece o erro real do INSERT direto. | A forma do erro do adaptador não é suposta. |
| A-9 (RN-20, D-11) | `tipos.ts`: `type PoliticaDeReserva = (ctx: ContextoEscopado, capacidade: 'agendar') => DecisaoPolitica \| Promise<DecisaoPolitica>`. Padrão `politicaPadraoDeReserva`: para `tenant` chama `politicaDeOperacao(ctx, 'agendar')`; para `sistema` devolve `{ permitido: true }` (E6.4 o troca). Chamada **antes da transação**. Negação: equipe → `AcessoNegado`; público → `salao_indisponivel`. | Evita passar `SistemaContext` à `PoliticaOperacao` (tipo de `TenantContext`). Ponto único para a E6.4. |
| A-10 (RN-6/RN-7) | **Idempotência.** (a) Pré-leitura `buscarPorChave` (fora da transação; só se há chave). Achou: `conferirCompativel(existente, pedido)` (profissional, `inicio.getTime()`, lista de `servicoId` na ordem) → `repetida` ou `chave_reutilizada`. (b) INSERT com `ON CONFLICT DO NOTHING`: 0 linhas → sentinela `chave_repetida`. (c) **Qualquer** `horario_indisponivel` (causa `23P01` **ou** `revalidacao`) com chave faz uma releitura por chave **fora** da transação antes de concluir: se achou, passa pela mesma conferência; senão devolve `horario_indisponivel`. Ampliação do item (c) da RN-6: uma requisição que chegou depois do commit da vencedora enxerga o horário ocupado na revalidação (não no INSERT), e o CA-24 exige `repetida`. | Garante 1 `criada` + N-1 `repetida` com o mesmo `id`, sem capturar `23505`. |
| A-11 (D-6) | **`encaixe` implementado agora** (só `TenantContext`; público → `RangeError`): não chama `consultarDisponibilidade`; mantém travas, `ativo`/vínculo, `inicio >= agora` (senão `invalido`/`inicio`), `intervaloMin` de A-2, `encaixe = true` e a constraint. | RN-17. A tela e o aviso são da E3.4. |
| A-12 (D-13) | **`ReservaCriada`** é derivada de `ReservaDTO` por `paraReservaCriada(dto)` pura (recalcula `inicio`/`fim` de cada item por soma consecutiva). **Sem nomes de serviço** (diverge do rascunho da spec "…nomes na ordem…"): `repetida` vem de `buscarPorChave` sem serviços travados e os nomes já estão com o chamador (a consulta que ele fez). Sem nome/telefone da cliente. `criada` é montada **em memória** (sem releitura). | Um só formato para `criada` e `repetida`; menos comandos; menos dado pessoal. |
| A-13 (RN-16) | `deps.antesDaReserva?: (ctx, r: Repos, d: { clienteId: string; inicio: Date }) => Promise<{ permitido: true } \| { permitido: false; motivo: string }>`, entre o upsert e o INSERT da reserva; recusa → sentinela `recusado`. | E4.2 define os motivos. |
| A-14 | **Ordem dos desfechos da fase pura:** `RangeError` (agora/contexto/encaixe no público) → `invalido` (campos) → `consentimento_ausente` → política → pré-leitura por chave. Com campos inválidos **e** consentimento ausente, vence `invalido`. | Determinismo para a E3.4/E4.2 e os testes. |
| A-15 | **Ids malformados:** `profissionalId`/`servicoIds` que não são UUID não são `invalido`: são `profissional_indisponivel`/`servico_indisponivel` sem tocar o banco (RN-14). Estrutura da lista (vazia, repetida, mais de 10) é `invalido`/`servicos`, reutilizando `validarServicos` da D-018. Chave não UUID → `invalido`/`chave`. | RN-14, CA-10, CA-14, CA-19. |
| A-16 (RN-21) | Log estruturado (`console.info(JSON.stringify(...))`, padrão `clientes/servico.ts`) em `reserva.criar` com `reservaId`, `salaoId`, `profissionalId`, `origem`, `modo`, `resultado`, `causa`, `repetida`. Nunca nome, telefone, chave, aceites nem mensagem do banco. | RN-21, CA-26. |
| A-17 | **Falha na camada de mensagem dentro da transação** (`contextoDeRegistro`, `inserir`) desfaz a reserva e sobe como erro inesperado (5xx). Isso respeita D-024 RN-3 (outbox na mesma transação); "falha de envio nunca muda a reserva" vale para a fila e o envio, pós-commit. | Sem reserva sem registro da mensagem. |
| A-18 (D-3) | **Sem `lock_timeout`/`statement_timeout` novo** (DBA avalia, §4). Espera máxima de uma concorrente = duração da transação da vencedora. | Sem infraestrutura; DevOps dispensado. |
| A-19 | **`inicio`:** `Date` válida com segundos e ms zero; no modo normal, a antecedência e a janela vêm da consulta; `agora` é obrigatório e inválido lança `RangeError` antes de tudo. A data da consulta é `partesLocais(inicio, fuso).data` com o fuso de A-2. | RN-15, CA-22. |

## 3. Componentes e interfaces

### 3.1 Estrutura de arquivos

```
src/server/reservas/
  tipos.ts          client-safe: entrada, resultado, causas, mensagens pt-BR, PoliticaDeReserva
  validacao.ts      pura: validarEntradaReserva
  montar-itens.ts   pura: montarItens, paraReservaCriada
  erros-banco.ts    pura: ehConflitoDeSobreposicao
  criar-reserva.ts  criarReserva (único ponto de entrada de produção)
```

`src/server/reservas/**` só importa `@/server/repos` (e `@/server/repos/transacao`), `@/server/clientes`, `@/server/consentimento`, `@/server/mensagens`, `@/server/disponibilidade`, `@/server/tenant/*`, `@/server/tempo/fuso`. Nada de Prisma, `pg-boss` ou adaptadores; nada em `src/app/**` o importa. Nenhuma `*.acao.ts`.

### 3.2 Tipos (`tipos.ts`)

```ts
export type ModoReserva = 'normal' | 'encaixe';
export type EntradaCriarReserva = {
  servicoIds: readonly string[];            // 1..10, sem repetição; ordem = ordem dos itens
  profissionalId: string;
  inicio: Date;                             // UTC, segundos e ms zero
  cliente: { nome: unknown; telefone: unknown };
  aceites: unknown;
  chaveRequisicao?: string | null;
  modo?: ModoReserva;
  agora: Date;
};
export type CausaIndisponibilidade = '23P01' | 'revalidacao';
export type CampoInvalidoReserva = 'servicos' | 'inicio' | 'nome' | 'telefone' | 'chave';
export type ErrosReserva = Partial<Record<CampoInvalidoReserva, string>>;   // pt-BR

export type ItemDeReservaCriada = { servicoId: string; ordem: number; precoCentavos: number; duracaoMin: number; inicio: Date; fim: Date };
export type ReservaCriada = {
  id: string; profissionalId: string; clienteId: string;
  inicio: Date; fim: Date; ocupadoAte: Date;
  status: StatusReserva; origem: 'publico' | 'equipe'; encaixe: boolean; revisao: number;
  itens: ItemDeReservaCriada[];
};
export type ResultadoCriarReserva =
  | { resultado: 'criada'; reserva: ReservaCriada; confirmacao: { mensagemId: string; estado: 'pendente' | 'nao_enviada' } }
  | { resultado: 'repetida'; reserva: ReservaCriada }
  | { resultado: 'horario_indisponivel'; causa: CausaIndisponibilidade }
  | { resultado: 'servico_indisponivel' } | { resultado: 'profissional_indisponivel' }
  | { resultado: 'invalido'; erros: ErrosReserva }
  | { resultado: 'consentimento_ausente'; erros: ErrosConsentimento }   // tipo da D-023
  | { resultado: 'chave_reutilizada' } | { resultado: 'recusado'; motivo: string } | { resultado: 'salao_indisponivel' };

export type DependenciasCriarReserva = {
  enfileirar?: DependenciasEnfileirar['enfileirar'];
  antesDaReserva?: (ctx: ContextoEscopado, r: Repos, d: { clienteId: string; inicio: Date }) =>
    Promise<{ permitido: true } | { permitido: false; motivo: string }>;
  politica?: PoliticaDeReserva;
  /** SÓ TESTE (A-6). */
  aposRevalidar?: () => Promise<void>;
};
export const MENSAGEM_HORARIO_INDISPONIVEL = '…';   // pt-BR, sem revelar quem ocupa o horário
```

`ErrosConsentimento` e `DecisaoPolitica` são importados dos módulos da D-023 e `tenant/politica`.

### 3.3 Funções puras

```ts
// validacao.ts
validarEntradaReserva(e: EntradaCriarReserva, ctx: ContextoEscopado):
  | { ok: true; servicoIds: string[]; profissionalId: string; inicio: Date; nome: string; telefoneE164: string;
      chave: string | null; modo: ModoReserva; idsMalformados: { profissional: boolean; servicos: boolean } }
  | { ok: false; erros: ErrosReserva };
// montar-itens.ts
montarItens(inicio: Date, servicos: { servicoId: string; precoCentavos: number; duracaoMin: number }[], intervaloMin: number):
  | { ok: true; itens: ItemDeReservaCriada[]; fim: Date; ocupadoAte: Date } | { ok: false; motivo: 'servicos_vazio' | 'servicos_repetidos' | 'servicos_demais' | 'duracao_invalida' };
paraReservaCriada(dto: ReservaDTO): ReservaCriada;
conferirCompativel(existente: ReservaDTO, pedido: { profissionalId: string; inicio: Date; servicoIds: readonly string[] }): boolean;
// erros-banco.ts
ehConflitoDeSobreposicao(e: unknown): boolean;
```

`validarEntradaReserva` reutiliza `validarEntradaCliente` (nome, telefone E.164 BR), `validarServicos` (D-018) e `ehUuid`. `agora`, contexto de tipo errado e `encaixe` no público lançam `RangeError`/`Error` (`exigirEscopo`). A aritmética de `montarItens` é em milissegundos UTC (sem `Intl`).

### 3.4 Repositórios (T-3)

```ts
// repos/salao.ts
travarParaLeitura(ctx): Promise<{ fuso: string; intervaloMin: number }>;
// repos/profissional.ts
travarParaReserva(ctx, id): Promise<{ ativo: boolean } | null>;
// repos/servico.ts
type ServicoTravado = { id: string; nome: string; ativo: boolean; precoCentavos: number; duracaoMin: number; vinculado: boolean };
travarParaReserva(ctx, ids: readonly string[], profissionalId: string): Promise<ServicoTravado[]>;
// repos/reserva.ts
criar(ctx, d: { profissionalId: string; clienteId: string; inicio: Date; fim: Date; ocupadoAte: Date;
                origem: 'publico' | 'equipe'; encaixe: boolean; chaveRequisicao: string | null }): Promise<{ criada: true; id: string } | { criada: false }>;
criarItens(ctx, reservaId: string, itens: { servicoId: string; ordem: number; precoCentavos: number; duracaoMin: number }[]): Promise<void>;
buscarPorChave(ctx, chave: string): Promise<ReservaDTO | null>;
```

Todos filtram por `salao_id` do contexto (`exigirEscopo`), com SQL parametrizado. O `INSERT` de `criar` mantém o literal `'confirmado'`. Os cabeçalhos de `repos/servico.ts` (ordem de travas: posição de "salão `FOR SHARE` (reserva)" e a reserva antes do consentimento) e de `repos/profissional.ts` são atualizados.

### 3.5 Serviço (`criar-reserva.ts`), sequência

```
agoraValido(entrada.agora) → exigirEscopo(ctx) → v = validarEntradaReserva
  v.ok = false  → invalido
validarConsentimentoDaReserva(aceites) falhou → consentimento_ausente
política (A-9) negada → AcessoNegado | salao_indisponivel
idsMalformados.profissional → profissional_indisponivel ; .servicos → servico_indisponivel   (sem banco)
chave ≠ null → existente = repos().reservas.buscarPorChave → conferir → repetida | chave_reutilizada (sem revalidar)
try {
  saida = emTransacao(async r => {
    {fuso, intervaloMin} = r.saloes.travarParaLeitura(ctx)
    prof = r.profissionais.travarParaReserva(ctx, id);  se !prof?.ativo → desfazer(profissional_indisponivel)
    linhas = r.servicos.travarParaReserva(ctx, ids, prof)
      se contagem ≠ pedida → servico_indisponivel ; algum !ativo → servico_indisponivel ; algum !vinculado → profissional_indisponivel
    modo normal:
      d = partesLocais(inicio, fuso).data
      res = consultarDisponibilidade(ctx, {servicoIds, profissionalId, de: d, ate: d, agora}, r.disponibilidade)
        (NaoEncontrado → profissional_indisponivel) ; servico_indisponivel → idem ; entrada_invalida → invalido/inicio
        profissional ausente ou inicio ∉ horarios → horario_indisponivel('revalidacao')
      await deps.aposRevalidar?.()
    modo encaixe: inicio < agora → invalido/inicio
    m = montarItens(inicio, linhas na ordem de servicoIds, intervaloMin)
    {cliente} = upsertCliente(ctx, {nome, telefone}, r)            (resultado 'invalido' aqui = bug → Error)
    antesDaReserva?.(…) negado → desfazer(recusado)
    ins = r.reservas.criar(ctx, …) ; !ins.criada → desfazer(chave_repetida)
    r.reservas.criarItens(ctx, ins.id, m.itens)
    registrarConsentimentoDaReserva(ctx, {clienteId, aceites, origem, agora}, r)
    reg = registrarMensagem(ctx, {reservaId, tipo: 'confirmacao'}, agora, r)
    return { reserva em memória, reg }
  })
} catch (e) {
  DesfazerReserva → saida = e.saida
  ehConflitoDeSobreposicao(e) → saida = horario_indisponivel('23P01')
  senão → relança
}
saída horario_indisponivel | chave_repetida, com chave → relê por chave → conferir → repetida | chave_reutilizada
saída 'criada' → enfileirarMensagens([reg], { enfileirar: deps.enfileirar }) → resultado criada
log RN-21
```

Origem: `tenant` → `equipe`, `sistema` → `publico` (derivada do contexto; a entrada não tem campo de origem). A entrada não tem `clienteId`.

## 4. Dados (DBA: revisão, sem migração)

Nenhuma migração, índice ou constraint novo. **Acionar o DBA só para parecer** (`docs/demandas/D-025/dba.md`), antes da T-3:

1. **Ordem de travas** da §6.1 e ausência de ciclo contra `saloes.travar` (`NO KEY UPDATE`), `profissionais.travarParaAlteracao` (`FOR UPDATE`), `servicos.travarParaAlteracao` (`NO KEY UPDATE`), `clientes.atualizar` (D-022: salão `NO KEY UPDATE` → cliente `FOR UPDATE`) e os desenhos futuros da E3.5.
2. **`INSERT … ON CONFLICT (salao_id, chave_requisicao) DO NOTHING` convivendo com a exclusion `reserva_sem_sobreposicao`**: confirmar que o árbitro é só o `UNIQUE`, que uma requisição com a mesma chave espera o commit da vencedora e depois não insere, e que a exclusion pode esperar a vencedora e então falhar `23P01`.
3. **`SELECT … ORDER BY s.id FOR SHARE OF s`**: confirmar que as linhas são travadas na ordem do `ORDER BY` (nó `LockRows` acima do `Sort`) e que a ordem por `id` torna duas reservas com serviços em ordens diferentes livres de ciclo.
4. **Teste de concorrência com pool de 16** (`POOL_MAX_TESTES`): 10 requisições esperando no upsert e no INSERT, segurando uma conexão cada, sem esgotar o pool; opinião sobre `lock_timeout`/`statement_timeout` (A-18; se o DBA quiser, vira variável e o DevOps entra).
5. Planos: `consultaOcupacoes` continua usando o índice da exclusion (teste de plano existente) e `buscarPorChave` usa o `UNIQUE (salao_id, chave_requisicao)`.

## 5. Infraestrutura: DevOps dispensado

Sem variável de ambiente, container, workflow ou observabilidade novos. O pool de produção é 10 (`repos/db.ts:15`); concorrentes com o mesmo telefone esperam o commit da vencedora (milissegundos) segurando uma conexão; o limite por rate limit é da E4.2. Só voltaria ao DevOps se o DBA pedir `lock_timeout` configurável.

## 6. Verificação das invariantes

### 6.1 Ausência de ciclo de espera (ordem global)

Níveis: (1) salão, (2) profissional, (3) serviço, (4) cliente, (5) reserva/itens/consentimento/mensagem. Cada transação adquire em ordem não decrescente de nível; dentro do nível 3 por `id` crescente.

| Concorrente | Trava | Contra a reserva |
|---|---|---|
| Regras/slug/perfil/funcionamento (`saloes.travar`) | salão `NO KEY UPDATE` | espera a nossa `FOR SHARE` (ou nós esperamos ele); nenhum dos dois segura nível posterior antes do salão: sem ciclo. |
| Edição de telefone (D-022) | salão `NO KEY UPDATE` → cliente `FOR UPDATE` | serializada no salão, antes de qualquer cliente: sem ciclo. |
| Desativar profissional (D-013) | profissional `FOR UPDATE` (não toca o salão) → lê `reserva` → `UPDATE` | espera nossa `FOR SHARE` do profissional; ou nós esperamos e vemos `ativo = false`. Nós seguramos salão `FOR SHARE`, que ele nunca pede. |
| Editar serviço (D-014) | profissionais `FOR SHARE` → serviço `FOR NO KEY UPDATE` | mesmos níveis e ordem; `FOR SHARE` × `FOR SHARE` não conflita. |
| Duas reservas | `FOR SHARE` × `FOR SHARE`; o upsert da cliente do mesmo telefone espera o commit da primeira; o INSERT conflitante na exclusion espera o commit da primeira | só a primeira avança; a segunda não segura nada que a primeira precise. |
| Cancelar/remarcar (E3.5, futura) | obrigação: salão `FOR SHARE` → profissional → reserva `FOR UPDATE` → itens → mensagem | mesma ordem. |

`FOR KEY SHARE` das FKs (reserva→cliente/profissional/serviço/salão, consentimento→cliente, mensagem→reserva) não conflita com `FOR SHARE` nem entre si, e conflita só com `FOR UPDATE`, que ninguém pede depois de já segurar nível maior em nossa transação.

### 6.2 Invariantes do `CLAUDE.md`

| Invariante | Aplica | Como |
|---|---|---|
| Escopo por salão no servidor | sim | Todo método de repositório usa `exigirEscopo(ctx)`; `PublicoContext`/`AdminContext` → `Error`; ids de outro salão = indisponível (A-15, CA-10, CA-13). `chave_requisicao` é por salão (RN-7). |
| Exclusion constraint | sim | É a garantia final (RN-3, CA-2b, CA-16, CA-27). A revalidação é só otimização/UX. Vale também no `encaixe`. |
| UTC e fuso do salão | sim | Gravação em UTC; data local via `partesLocais` com o fuso sob trava; sem `Intl` novo (CA-22). |
| Adaptadores de integração | parcial | Nenhuma integração nova; WhatsApp só pela fila da D-024 depois do commit. |
| Soft delete e anonimização | sim | Profissional/serviço inativos nunca recebem reserva, conferido sob `FOR SHARE`; cliente anonimizada nunca é reutilizada (telefone nulo, upsert cria nova linha). |
| Salão suspenso | ponto de extensão | `politica` (A-9); hoje `permitirTudo`, E6.4 decide. Cancelamento é da E3.5. |
| Idempotência de webhooks e mensagens | sim (mensagens) | Mensagem `reserva:confirmacao:0` por `UNIQUE(reserva_id, tipo, revisao)` (D-024); reserva por `chave_requisicao` (A-10). |
| Auditoria do super admin | não se aplica | Sem ação de super admin. |
| Sem cartão | não se aplica | |
| Multi-serviço com um profissional e snapshot | sim | `montarItens` (RN-1), snapshot das linhas travadas (A-3). |

## 7. Riscos e decisões

| ID | Risco | Mitigação |
|---|---|---|
| R-1 | **Bloqueio criado em paralelo** coexiste com a reserva: a exclusion não cobre `bloqueio` e a criação de bloqueio só toma `FOR KEY SHARE` no profissional (D-016). **Risco aceito.** | Documentar no README; a tela de bloqueios já mostra as reservas cobertas (D-016 RN-8). Não se trava para não serializar a agenda. |
| R-2 | Forma do erro `23P01` no Prisma 7 | A-8: captura de erro real na T-2, teste sobre o erro real no CA-27. Se o adaptador mudar a forma, o teste quebra. |
| R-3 | Esgotamento do pool (10) com muitas requisições do mesmo telefone esperando | Esperas curtas; E4.2 limita; teste com 16 conexões (DBA, §4.4). |
| R-4 | Fila serializada atrás de uma gravação longa de regras do salão (`FOR SHARE` espera `NO KEY UPDATE`) | Gravações de regras são curtas (D-017); sem `lock_timeout` novo (A-18). |
| R-5 | Nome da cliente existente sobrescrito pelo formulário público | Comportamento da D-022, aceito (spec §6); E4.2 limita. |
| R-6 | `repetida` devolve reserva com status atual (inclusive cancelada) | `status` está em `ReservaCriada`; a E4.1 decide a exibição. |
| R-7 | Divergência entre o snapshot e o veredito da consulta | Impossível sob as travas `FOR SHARE` (serviço, salão); coberto pelo teste de paridade (CA-8) e pelo CA-15b. |
| R-8 | Gancho `aposRevalidar` ativo em produção por engano | Opcional e sem valor padrão; o teste estático (CA-26) confirma que nada em `src/app/**` ou `src/worker/**` o passa. |

## 8. Estratégia de testes

- **Unidade (`src/server/reservas/*.test.ts`):** `montar-itens` (CA-17), `erros-banco` (CA-18), `validacao` (CA-19), `criar-reserva.test.ts` para os desfechos que não tocam o banco (`invalido`, `consentimento_ausente`, `RangeError`, `encaixe` no público, política negada, ids malformados), com o módulo de repositórios espionado para provar que não foi chamado. Rodar também com `TZ=UTC` e `TZ=America/Sao_Paulo`.
- **Integração (`tests/integration/reservas/`, PostgreSQL real, `criarDoisSaloes`, pool 16, relógio injetado):** arquivos abaixo.
- **Falhas por etapa (CA-23):** triggers `BEFORE INSERT … RAISE EXCEPTION` criados e removidos no próprio teste, por tabela (`cliente`, `reserva`, `reserva_item`, `consentimento`, `mensagem`) e por `antesDaReserva`; fila indisponível por `deps.enfileirar` e por `tests/support/fila.ts` (CA-4).
- **Esperas de trava (CA-15):** por `pg_stat_activity` no estilo da D-017, procurando os marcadores `FOR SHARE OF sa`, `FOR SHARE OF p`, `FOR SHARE OF s`; sem `sleep` fixo.
- **Playwright:** nenhum (sem tela nem rota).
- **Cobertura ≥ 90% de linhas:** o código novo é coberto por unidade (puros) e integração (repositórios e serviço). A T-7 roda `npm run test:coverage` e eleva o que ficar abaixo, sem exclusão nova.
- **Estabilidade (CA-28):** `for i in $(seq 10); do npx vitest run --project integration tests/integration/reservas/concorrencia.test.ts tests/integration/reservas/idempotencia.test.ts || break; done`; fuso: `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/reservas tests/integration/reservas/fuso.test.ts || break; done`.

### Mapa CA → tarefa → teste

| CA | Tarefa | Teste |
|---|---|---|
| CA-1 | T-2, T-3, T-4, T-6a | `criar.test.ts` (+ unidade `montar-itens`) |
| CA-2 | T-3, T-4, T-6b | `concorrencia.test.ts` (10 em paralelo, mesmo telefone) |
| CA-2b | T-3, T-4, T-6b | `concorrencia.test.ts` (barreira `aposRevalidar`; contagens por tabela) |
| CA-3 | T-4, T-6a | `revalidacao.test.ts` (um caso por causa) |
| CA-4 | T-4, T-6c | `atomicidade.test.ts` (fila falha; `tests/support/fila.ts`; reconciliação D-024) |
| CA-5 | T-3, T-4, T-6b | `idempotencia.test.ts` |
| CA-6 | T-4, T-6c | `atomicidade.test.ts` (nome e `atualizado_em` preservados) |
| CA-7 | T-4, T-6a | `revalidacao.test.ts` (funcionamento × jornada) |
| CA-8 | T-4, T-6a | `revalidacao.test.ts` (inclui paridade com `consultarDisponibilidade`) |
| CA-9 | T-4, T-6a | `revalidacao.test.ts` (intervalo 15) |
| CA-10 | T-3, T-4, T-6a | `revalidacao.test.ts` + `isolamento.test.ts` |
| CA-11 | T-2, T-4, T-6a | unidade `criar-reserva` + `criar.test.ts` |
| CA-12 | T-4, T-6a | `criar.test.ts` (ordem do `enfileirar` após o commit; rollback não enfileira) |
| CA-13 | T-4, T-6a | `criar.test.ts` + `isolamento.test.ts` |
| CA-14 | T-4, T-6b | `idempotencia.test.ts` |
| CA-15 | T-3, T-4, T-6b | `concorrencia.test.ts` (a..e; `pg_stat_activity`) |
| CA-16 | T-4, T-6a | `encaixe.test.ts` |
| CA-17 | T-2 | unidade `montar-itens.test.ts` |
| CA-18 | T-2 | unidade `erros-banco.test.ts` |
| CA-19 | T-2 | unidade `validacao.test.ts` |
| CA-20 | T-4, T-6c | `atomicidade.test.ts` |
| CA-21 | T-4, T-6a | unidade `criar-reserva.test.ts` + `criar.test.ts` |
| CA-22 | T-4, T-6c | `fuso.test.ts` (e comando com `TZ`) |
| CA-23 | T-4, T-6c | `atomicidade.test.ts` (triggers) |
| CA-24 | T-4, T-6b | `idempotencia.test.ts` (10 em paralelo) |
| CA-25 | T-3, T-4, T-6c | `estrutura.test.ts` (contador de comandos) + teste de plano existente |
| CA-26 | T-4, T-6c | `estrutura.test.ts` (log, imports) + `npm run lint` |
| CA-27 | T-6a | `criar.test.ts` (INSERT direto `23P01` com `ehConflitoDeSobreposicao` sobre o erro real; profissionais distintos) |
| CA-28 | T-6b, T-7 | comando de estabilidade ×10 |

## 9. Tarefas

Rodada 1 (paralelas, sem arquivo em comum): T-1, T-2, T-5. Rodada 2: T-3. Rodada 3: T-4. Rodada 4 (paralelas): T-6a, T-6b, T-6c. Rodada 5: T-7.

### T-1 — Parecer do DBA (dba)

- **Dependências:** nenhuma. Antes da T-3.
- **Arquivos sob posse:** `docs/demandas/D-025/dba.md`.
- **Entregável:** parecer sobre os itens 1 a 5 da §4; decisão sobre `lock_timeout`; confirmação de "sem migração" (ou migração justificada, caso em que volta ao arquiteto).
- **Conclusão:** parecer com evidência (por exemplo, experimento com duas sessões `psql`/`pg_stat_activity` para a ordem de travas e o `ON CONFLICT` com a exclusion), e veredito para a T-3.

### T-2 — Módulos puros e experimento do erro (desenvolvedor)

- **Dependências:** nenhuma. Paralela a T-1 e T-5.
- **Arquivos sob posse:** `src/server/reservas/{tipos,validacao,montar-itens,erros-banco}.ts` e seus `*.test.ts`.
- **Entregável:** §3.2 e §3.3; primeiro um experimento descartável (fora do repositório) com um INSERT bruto que viola `reserva_sem_sobreposicao` para capturar a forma real do erro, cujas fixtures entram no teste de `erros-banco`.
- **Conclusão:** unidade (CA-17, CA-18, CA-19) passando, também em `TZ=UTC` e `TZ=America/Sao_Paulo`; `lint` e `typecheck` limpos; `tipos.ts` sem import de runtime de servidor.

### T-3 — Repositórios (desenvolvedor)

- **Dependências:** T-1 (parecer), T-2 (tipos).
- **Arquivos sob posse:** `src/server/repos/reserva.ts`, `src/server/repos/profissional.ts`, `src/server/repos/servico.ts`, `src/server/repos/salao.ts`, `src/server/repos/tipos.ts`.
- **Entregável:** §3.4; marcadores `FOR SHARE OF sa|p|s` literais no texto SQL; cabeçalhos atualizados (posição da trava do salão e da reserva antes do consentimento).
- **Conclusão:** `typecheck`/`lint` limpos; testes existentes dos repositórios e do harness continuam passando; `ids` não UUID não geram `22P02`.

### T-4 — Serviço `criarReserva` (desenvolvedor)

- **Dependências:** T-2, T-3.
- **Arquivos sob posse:** `src/server/reservas/criar-reserva.ts` e `criar-reserva.test.ts`.
- **Entregável:** §3.5 inteira (A-5..A-19), sem `'use server'`, sem `next/*`; log RN-21.
- **Conclusão:** unidade do serviço passando; um cenário de ponta a ponta manual (CA-1) passando; `lint`, `typecheck` e `build` limpos.

### T-5 — Fábrica de cenário (desenvolvedor)

- **Dependências:** nenhuma (usa `criarDoisSaloes`, `tests/support/mensagens.ts`). Paralela a T-1 e T-2.
- **Arquivos sob posse:** `tests/support/reservas.ts` (novo).
- **Entregável:** cenário com profissional(is), serviços A/B com preço e duração conhecidos, jornada e funcionamento configuráveis, relógio, `ctxEquipe`/`ctxSistema`, ajudantes para contar linhas por tabela, instalar/remover trigger de falha por tabela, esperar uma trava em `pg_stat_activity` e contar comandos SQL.
- **Conclusão:** exportações tipadas, sem alterar `factories.ts` nem `mensagens.ts`; testes existentes continuam passando.

### T-6a — Integração: criação, revalidação, encaixe (desenvolvedor)

- **Dependências:** T-4, T-5.
- **Arquivos sob posse:** `tests/integration/reservas/{criar,revalidacao,encaixe}.test.ts`.
- **Entregável:** CA-1, 3, 7, 8, 9, 10, 11, 12, 13, 16, 21, 27 (conforme o mapa).
- **Conclusão:** `npx vitest run --project integration tests/integration/reservas/criar.test.ts tests/integration/reservas/revalidacao.test.ts tests/integration/reservas/encaixe.test.ts` verde; teste de paridade com a D-018 incluído.

### T-6b — Integração: concorrência e idempotência (desenvolvedor)

- **Dependências:** T-4, T-5.
- **Arquivos sob posse:** `tests/integration/reservas/{concorrencia,idempotencia}.test.ts`.
- **Entregável:** CA-2, 2b, 5, 14, 15, 24; sem `sleep` fixo.
- **Conclusão:** o comando de estabilidade (§8) passa 10 vezes seguidas, sem `40P01`, `23505` nem 5xx.

### T-6c — Integração: atomicidade, fuso e estrutura (desenvolvedor)

- **Dependências:** T-4, T-5.
- **Arquivos sob posse:** `tests/integration/reservas/{atomicidade,fuso,isolamento,estrutura}.test.ts`.
- **Entregável:** CA-4, 6, 10 (outro salão), 13, 20, 22, 23, 25, 26.
- **Conclusão:** verdes, inclusive com `TZ=UTC` e `TZ=America/Sao_Paulo`; contador de comandos constante independente do número de serviços.

### T-7 — Documentação e fechamento (desenvolvedor)

- **Dependências:** T-6a, T-6b, T-6c.
- **Arquivos sob posse:** `README.md` (criação de reserva, risco do bloqueio em paralelo, ordem de travas), `CLAUDE.md` (resumo da D-025 e dois comandos de estabilidade), `docs/demandas/D-025/dev.md`.
- **Entregável:** documentação; `npm run lint`, `typecheck`, `build`, `test:coverage` (≥ 90% de linhas) e `test:e2e` rodados e registrados.
- **Conclusão:** todos os gates da definição de pronto verdes, com evidência em `dev.md`; comando de estabilidade ×10 (CA-28).

## 10. Fronteiras e obrigações para demandas futuras

- **E4.1 (rota pública):** resolve o slug, monta `contextoDeSistema(salaoId, 'publico-reserva')` e chama `criarReserva` com `chaveRequisicao`; traduz os resultados para a tela (`horario_indisponivel` → texto de A-12/`MENSAGEM_HORARIO_INDISPONIVEL`). Não implementar de novo as regras daqui.
- **E4.2:** limite de 3 reservas futuras por número (via `deps.antesDaReserva`, entre upsert e INSERT), rate limit, Turnstile e os motivos de `recusado`.
- **E3.4 (tela da equipe):** `defineAcao({ papeis: ['gestor', 'profissional'], capacidade: 'agendar' })`; "profissional só agenda para si"; aviso e confirmação do `encaixe`; passa `modo: 'encaixe'`.
- **E3.5:** cancelar/remarcar seguem a ordem de §6.1; remarcação incrementa `reserva.revisao` antes de `registrarMensagem('remarcacao')`; a exclusion vale no `UPDATE`.
- **E4.5:** convite de avaliação (D-024 §3.9) usa a mesma reserva; nada aqui.
- **E6.4:** troca `politicaPadraoDeReserva` (e `politicaDeOperacao`) pela política real por estado da assinatura.

---

## Revisão 2 (DEF-1): `40P01 deadlock detected` na criação concorrente

Origem: reprovação do tester (`testes.md`, DEF-1, alta) e parecer do DBA (`dba.md`, "Revisão 2 — DEF-1", protótipo `dba-def1-proto.cjs`). **Decisão do líder: adotar a recomendação do DBA; não reabrir.** Esta revisão acrescenta e, onde houver conflito, **prevalece sobre** as seções 1 a 10 acima (A-3, A-6, §3.4, §6.1, CA-2, CA-2b, CA-15, §8, T-3, T-6b, §10).

### R2.1 Causa raiz no desenho

O desenho original assumia que o `23P01` seria o caminho normal de perda na concorrência e que `FOR SHARE` no profissional bastava (A-1/A-3: `FOR SHARE` × `FOR SHARE` não conflita). Mas o `INSERT … ON CONFLICT (salao_id, chave_requisicao) DO NOTHING` faz inserção especulativa, e a exclusion `reserva_sem_sobreposicao` grava a entrada no índice GiST antes de procurar conflito. Com N transações na mesma faixa, cada uma encontra a tupla especulativa de outra e espera pelo "speculative token": ciclo, `40P01`, que só se resolve após o `deadlock_timeout` (1 s). Com 2 transações a janela é mínima; com 10 ou mais, sob carga, é frequente (até 38% de 400 requisições no baseline do DBA). A falha é de desenho (a trava não serializa quem escreve a mesma faixa), não de implementação.

### R2.2 Decisão A-20 (nova): trava do profissional `FOR NO KEY UPDATE` na criação

| ID | Decisão | Justificativa |
|---|---|---|
| A-20 | **`RepoProfissional.travarParaReserva`** passa a executar `SELECT ativo FROM profissional p WHERE p.id = $1 AND p.salao_id = $2 FOR NO KEY UPDATE OF p` (em `src/server/repos/profissional.ts`, ~linha 187; assinatura e retorno inalterados). Uma única trava de profissional por transação, **sem promoção** (nunca `FOR SHARE` seguida de `FOR NO KEY UPDATE`: duas promoções simultâneas seriam impasse). O salão segue `FOR SHARE` (A-2); o serviço segue `FOR SHARE` (A-3). Substitui `FOR SHARE OF p` em A-3, §6.1 e §8 (o marcador procurado em `pg_stat_activity` passa a ser `FOR NO KEY UPDATE OF p`). | Serializa a criação de reservas do **mesmo** profissional antes da revalidação e do INSERT; a revalidação (READ COMMITTED) enxerga a vencedora e as perdedoras saem como `horario_indisponivel/revalidacao`, sem especulação concorrente na mesma faixa. Sem migração, sem mudança de plano (o INSERT é o mesmo), profissionais distintos não se bloqueiam. Medido pelo DBA: 0 `40P01` em 100 execuções × 400 requisições (até 12 transações), exatamente 1 reserva por horário; latência p50 14 ms, p95 ~44 ms. |

Alternativas descartadas:
- **`pg_advisory_xact_lock(hashtextextended(profissional_id, 0))`:** resultado equivalente (0 `40P01`, p95 ~35 ms), mas é uma trava fora da ordem canônica, invisível às demais trilhas (jornada, desativação, serviço), que precisariam conhecê-la; e não aparece em `pg_stat_activity` como trava de linha.
- **Retry em `40P01`:** cada tentativa perdida espera 1 s (`deadlock_timeout`) e a nova tentativa repete mensagem/outbox/rótulos de log; mascara a causa. Pode existir no futuro apenas como rede de segurança, nunca como correção.
- **`FOR UPDATE` no profissional:** conflitaria com `FOR KEY SHARE` das FKs (bloqueios, reservas, vínculos), serializando mais do que o necessário e travando inserções filhas que hoje correm em paralelo.

**Ordem canônica de travas: inalterada** (salão `FOR SHARE` → profissional → serviços por `id` → cliente → `reserva`/itens/consentimento/mensagem). Só muda a força da trava do nível 2.

Matriz de compatibilidade da trava do profissional (a linha é quem chega depois; sem ciclo em nenhuma, pois todas vão ao profissional antes de qualquer nível seguinte e nenhuma volta a um nível anterior):

| Concorrente | Trava no profissional | Contra `FOR NO KEY UPDATE` da criação |
|---|---|---|
| Outra criação (D-025) | `FOR NO KEY UPDATE` | conflita: serializa, desejado (é o objetivo). |
| Desativação (D-013) | `FOR UPDATE` | conflita (já conflitava com `FOR SHARE`): serializa; a criação vê `ativo = false` ou a desativação vê a reserva. |
| Jornada (D-015) | `FOR NO KEY UPDATE` | passa a conflitar: espera poucos ms; sem ciclo (mesmo nível, mesma ordem). |
| Edição/criação de serviço (D-014) | `FOR SHARE` (profissionais) → serviço `FOR NO KEY UPDATE` | `FOR SHARE` conflita com `FOR NO KEY UPDATE`: espera a criação; ordem profissional → serviço em ambos; sem ciclo. |
| Serviço × criação no nível 3 | `FOR SHARE` (reserva) × `FOR NO KEY UPDATE` (edição) | inalterado; a criação já tem o profissional quando pede o serviço. |
| Bloqueios (D-016) e INSERTs com FK (reserva, vínculo, jornada) | `FOR KEY SHARE` | não conflita com `FOR NO KEY UPDATE`. |
| Cancelar (E3.5) | `FOR SHARE` (pode manter) | conflita com `FOR NO KEY UPDATE`, só espera a criação; sem ciclo. |

### R2.3 Efeito nos critérios de aceitação

- **CA-2 / CA-2b (concorrência, 10 transações no mesmo horário):** resultado exigido passa a ser exatamente **1 `criada` e 9 `horario_indisponivel` com `causa: 'revalidacao'`**, nenhuma exceção, 1 linha de `reserva`, N de `reserva_item`, 1 consentimento e 1 `mensagem` (contagens por tabela, como antes). A redação "perdedoras com `causa: '23P01'`" é **retirada**: o `23P01` deixa de ocorrer entre criações concorrentes comuns (apenas contra escritor que não usa a trava, ver abaixo).
- **Barreira do teste.** A barreira `aposRevalidar` de 10 **dentro** da trava nunca fecha (só uma transação entra por vez) e trava o teste. Nova regra: a barreira de largada é **fora da trava**, uma barreira de 10 promessas resolvida **antes de chamar `criarReserva`** (todas largam juntas); `aposRevalidar` não é usado para sincronizar concorrentes.
- **Cobertura do ramo `23P01` (CA-27, CA-2b-b, tradução do erro).** Um teste dedicado usa `deps.aposRevalidar` (A-6, mantido) para, **depois da revalidação e antes do INSERT**, gravar numa **outra conexão, com commit**, uma reserva sobreposta direto no banco (sem a trava). O INSERT da `criarReserva` viola a exclusion e o resultado deve ser `horario_indisponivel` com `causa: '23P01'`, sem exceção, sem linhas parciais (itens, consentimento, mensagem, cliente novo desfeitos). Isso substitui o uso de concorrência comum para provocar `23P01`.
- **CA-15 (esperas de trava):** o item do profissional passa a ser `FOR NO KEY UPDATE OF p`; o teste de espera por `pg_stat_activity` procura esse marcador; acrescentar o caso "duas criações do mesmo profissional: a segunda espera a primeira" e "duas criações de profissionais distintos: não esperam". Salão e serviço seguem `FOR SHARE OF sa` / `FOR SHARE OF s`.
- **CA-24 (idempotência, 10 em paralelo):** inalterado em resultado (1 `criada` + 9 `repetida`, mesmo `id`); com a serialização, a pré-leitura/releitura de A-10 continua sendo o que garante `repetida` para quem chega depois do commit.
- **Mapa CA → tarefa → teste (atualizado):**

| CA | Tarefa | Teste |
|---|---|---|
| CA-2 | T-3, T-4, T-6b | `concorrencia.test.ts` (barreira de largada ANTES de `criarReserva`; 1 `criada` + 9 `revalidacao`) |
| CA-2b | T-3, T-4, T-6b | `concorrencia.test.ts` (mesmo cenário; contagens por tabela) e caso do `23P01` por `aposRevalidar` + INSERT direto em outra conexão |
| CA-15 | T-3, T-4, T-6b | `concorrencia.test.ts` (marcadores `FOR SHARE OF sa`, `FOR NO KEY UPDATE OF p`, `FOR SHARE OF s`; mesmo profissional espera, profissionais distintos não) |
| CA-27 | T-6a | `criar.test.ts` (idem: `aposRevalidar` + INSERT direto, `ehConflitoDeSobreposicao` sobre o erro real) |
| CA-29 (novo, DEF-1) | T-6d | `carga.test.ts` (ver R2.4) |
| CA-28 | T-6b, T-6d, T-7 | estabilidade ×10 estendida (R2.4) |

**Divergências com a spec (o analista não será reacionado; o desenvolvedor segue este design):** (i) a spec/CA-2b dá a `causa: '23P01'` como desfecho esperado das perdedoras concorrentes; aqui é `revalidacao`, com `23P01` reservado ao escritor sem trava e ao teste de injeção; (ii) a spec descreve a trava do profissional como de leitura (`FOR SHARE`); aqui é `FOR NO KEY UPDATE`; (iii) CA-29 é um critério novo, de desenho, sem número na spec.

### R2.4 Teste de carga (novo, T-6d)

- **Arquivo:** `tests/integration/reservas/carga.test.ts` (posse da T-6d; nenhum outro arquivo).
- **Objetivo:** reproduzir as condições do DEF-1 e resistir a elas: várias cópias simultâneas, ondas repetidas, pool separado, até 12 transações no mesmo horário. Cobre o que o DBA não mediu (16 transações; 20 simultâneas × 400).
- **Cenário:** um salão (`criarDoisSaloes`, relógio injetado), 2 profissionais (um por cópia, para também afirmar que não se bloqueiam), serviço único vinculado a ambos, 30 horários consecutivos futuros e livres por profissional. Em cada **onda**, cada cópia dispara, para cada horário, **12 `criarReserva` concorrentes** (12 telefones distintos, chaves de requisição distintas) largando juntas por barreira fora da trava; as 2 cópias rodam em paralelo. 3 ondas por execução, com horários diferentes por onda (ou um profissional novo por onda), totalizando 2 × 30 × 12 × 3 = **2160 requisições** por execução. Uma onda extra, menor, com **16 transações** em 5 horários cobre o ponto não medido.
- **Pool:** pool Prisma/`pg` **dedicado ao teste** (não o do harness), `max` 24 (2 cópias × 12), fechado no `afterAll`. Respeito a `max_connections = 100`: 24 desta base + até 3 outros workers de integração × 16 + template/administrativas (~10) ≈ 82; o teste **não** usa mais de 24 e a onda de 16 usa a mesma cota de 24 (não soma pools). Se `max_connections` for menor no ambiente, o teste falha com mensagem que o nomeia, não degrada silenciosamente.
- **Asserções (todas obrigatórias):**
  1. **0 rejeições** (nenhum `Promise` rejeitado) e **0 ocorrências de `40P01`** (afirmar também no resultado capturado, não só pela ausência de exceção; nenhum desfecho de erro inesperado, nem `23505`, nem 5xx);
  2. **exatamente 1 `criada` por horário** e as demais 11 (ou 15) `horario_indisponivel/revalidacao`;
  3. consulta ao banco: exatamente 1 `reserva` `confirmado` por (profissional, horário) e contagem total = horários × ondas × profissionais; `reserva_item`, consentimento e `mensagem` coerentes (1 por reserva criada);
  4. sem espera do `deadlock_timeout`: a duração de cada onda tem teto folgado (por exemplo, 20 s por onda), sinal de que ninguém esperou 1 s repetidamente; não é asserção de latência fina.
- **Tamanho/tempo:** meta de 15 a 30 s por execução (serializado por profissional a ~14 ms p50: ~1080 requisições por profissional); `testTimeout` de 120 s.
- **Critério do laço ×10:** o comando de estabilidade (CA-28) passa a incluir o arquivo, com `--maxWorkers=2` (limite de conexões):
  `for i in $(seq 10); do npx vitest run --project integration tests/integration/reservas/concorrencia.test.ts tests/integration/reservas/idempotencia.test.ts tests/integration/reservas/carga.test.ts --maxWorkers=2 || break; done`
  Critério: 10 execuções seguidas, 0 `40P01`, 0 falhas; `carga.test.ts` fica fora do `npm test` rápido apenas se estourar 60 s (então vira projeto/filtro próprio com justificativa em `dev.md`); caso contrário roda sempre e entra na cobertura.
- **Nova tarefa T-6d (desenvolvedor):** dependências T-3 (com a mudança A-20) e T-5; arquivos: `tests/integration/reservas/carga.test.ts`; **paralela** a T-6a/T-6b/T-6c (nenhum arquivo comum); conclusão: asserções 1 a 4 acima passando e o laço ×10 verde. T-6b reescreve a barreira (R2.3) e o marcador de CA-15; T-3 aplica A-20 (`profissional.ts`) e atualiza os cabeçalhos.

### R2.5 Adendo: vínculo lido em segundo comando após a trava (A-3 e §3.4 corrigidos)

Confirmado pelo DBA (`dba.md` §9) e adotado pelo desenvolvedor (`dev.md` §5 item 3b). **Substitui** o `EXISTS (… ) AS vinculado` no `SELECT … FOR SHARE OF s` descrito em A-3 e §3.4: em READ COMMITTED, quando a trava espera um escritor, o PostgreSQL reavalia (EvalPlanQual) só a versão nova da linha travada; as demais tabelas da consulta (`servico_profissional`) continuam vistas no snapshot do início do comando, e o `EXISTS` devolve vínculo **obsoleto**. Forma correta de `RepoServico.travarParaReserva(ctx, ids, profissionalId)`:
1. comando 1: `SELECT s.id, s.nome, s.ativo, s.preco_centavos, s.duracao_min FROM servico s WHERE s.salao_id = $1 AND s.id = ANY($ids::uuid[]) ORDER BY s.id FOR SHARE OF s` (campos da própria linha travada são reavaliados e seguros);
2. comando 2 (depois da trava, mesma transação): `SELECT servico_id FROM servico_profissional WHERE salao_id = $1 AND profissional_id = $2 AND servico_id = ANY($ids::uuid[])`, que define `vinculado`.
Assinatura e tipo `ServicoTravado` inalterados. **Regra geral:** qualquer dado vindo de OUTRA tabela (vínculo, `ativo` do profissional lido de outra consulta, o gancho de revalidação) é lido depois da trava, em comando novo. O contador de comandos do CA-25 e o teste estrutural contam 1 comando a mais na criação; a T-6c ajusta o limite. O cabeçalho de `repos/servico.ts` e o JSDoc de `travarParaReserva` registram isso e a posição do salão `FOR SHARE`.

### R2.6 Obrigações para demandas futuras (acrescentar à §10)

- **E3.4 e E3.5:** qualquer comando que INSIRA ou ATUALIZE `reserva` para um status ocupante (criar pela equipe, reagendar, voltar a `confirmado`) deve tomar **`FOR NO KEY UPDATE` (ou mais forte) no profissional antes do comando**, uma única vez, sem promoção a partir de `FOR SHARE`. Motivo: a inserção/atualização especulativa na exclusion gera `40P01` entre escritores concorrentes da mesma faixa (DEF-1). **Cancelar** (sai do predicado ocupante) não cria o ciclo e pode manter `FOR SHARE`.
- **Cabeçalho de `src/server/repos/servico.ts` (e o de `profissional.ts`):** o desenvolvedor da T-3 acrescenta o lembrete acima à ordem canônica de travas (nível "profissional": `FOR UPDATE` desativação; `FOR NO KEY UPDATE` jornada **e criação/reagendamento de reserva**; `FOR SHARE` serviço, cancelamento e leituras). Eu só especifico; não edito o arquivo.
- Todo escritor novo de `reserva` ocupante que não use a trava é, por definição, um defeito de desenho; o teste de injeção do R2.3 mostra como o `23P01` aparece nesse caso.

### R2.7 Riscos (acrescentar à §7)

| ID | Risco | Mitigação |
|---|---|---|
| R-9 | **Serialização por profissional:** todas as criações do mesmo profissional passam uma por vez; um profissional muito disputado enfileira requisições. Medido: p50 14 ms, p95 ~44 ms por requisição com 12 concorrentes; esperas = duração da transação da vencedora (A-18, sem `lock_timeout` novo). | Aceito: a agenda de um profissional já é serial por natureza e a trava é por linha. Muitos profissionais não se bloqueiam. Cenário de muitos profissionais com pool de 10: cada transação segura 1 conexão enquanto espera; o limite é o pool (R-3), não o banco; E4.2 limita a taxa. Reavaliar se a latência de cauda crescer (observabilidade da E8). |
| R-10 | O DBA não testou 16 transações nem 20 simultâneas × 400. | O `carga.test.ts` cobre 12 simultâneas × 2 cópias × 3 ondas e uma onda com 16; o laço ×10 acumula 21 600 requisições por rodada de estabilidade. Se aparecer um `40P01`, reabrir com o DBA (não adicionar retry). |
| R-11 | Escritor futuro de `reserva` sem a trava reintroduz o `40P01`. | Obrigação em R2.6 + cabeçalhos de `repos/*.ts`; revisão obrigatória do arquiteto nas E3.4/E3.5. |
| R-12 | A promoção de trava (`FOR SHARE` → `FOR NO KEY UPDATE`) na mesma transação cria impasse. | Regra de uma única trava no profissional, sem promoção (A-20); E3.5 deve segui-la ao ler o profissional para checar `ativo`. |
