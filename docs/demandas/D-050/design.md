# D-050 (E3.6, issue #111) — Desenho técnico: profissional e horário por serviço

Autor: arquiteto-software. Data: 23/11/2026. Branch: `feat/d-050-servicos-independentes`.
Entradas: `spec.md` (RN-1..RN-39, CA-1..CA-52, DA-1..DA-20), `web-design.md` (direção "roteiro do dia", C1–C6,
ND-1..ND-5), `CLAUDE.md`, `prisma/schema.prisma`, migrações e o código citado em cada seção.

Participação: **DBA obrigatório** (T-1, perguntas no §4.9). **DevOps dispensado** (motivo no §5). **Web-designer** já
participou (`web-design.md`); os conflitos dele estão decididos no §1.3.

---

## 1. Resumo da solução

### 1.1 Ideia central
O **item** (`reserva_item`) passa a ser a unidade de agenda: tem profissional, início, fim, ocupado-até, status,
encaixe e uma revisão própria. A **reserva** passa a ser o agendamento da cliente (cliente, origem, chave de
requisição, revisão, consentimentos, mensagens, avaliação) e guarda **três colunas derivadas** dos itens —
`status`, `inicio`, `fim` — recalculadas pela aplicação na mesma transação de toda mudança de item, a partir de UMA
função pura (`derivarReserva`). `profissional_id`, `ocupado_ate` e `encaixe` saem de `reserva`.

- Anti-sobreposição por profissional: nova exclusion `reserva_item_sem_sobreposicao` em `reserva_item`, idêntica em
  forma à antiga (literais de status no predicado). A antiga `reserva_sem_sobreposicao` é removida.
- Itens da mesma reserva não se cruzam (RN-8): checagem pura no servidor **e** uma segunda exclusion
  `reserva_item_mesma_reserva_sem_sobreposicao` como defesa em profundidade (nunca traduzida: se disparar, é bug).
- Disponibilidade por serviço: nova `consultarDisponibilidadePorServico`, ainda com **6 instruções SQL constantes**;
  os itens já escolhidos entram no domínio puro como ocupações extras do profissional e como "ocupações da cliente".
- Mensagens: chave `reserva:tipo:revisao` inalterada; `reserva.revisao` sobe em remarcar item, cancelar item e
  cancelar todos; `reserva_item.revisao` guarda a revisão da última mudança do item; a vigência de
  `remarcacao`/`cancelamento` é "existe item com `revisao = m.revisao` e status coerente"; `mensagem.reserva_item_id`
  (nulo para confirmação, convite, "cancelar todos" e mensagens antigas) só serve para exibição e filtro por papel.
- A confirmação é consolidada (`salao`, `data`, `itens`), montada no envio com o estado atual.

### 1.2 Decisões principais e alternativas descartadas

| # | Decisão | Alternativas descartadas e motivo |
|---|---|---|
| A-1 | **Manter `reserva.status`, `inicio`, `fim` como derivados armazenados**; remover `profissional_id`, `ocupado_ate`, `encaixe` | (a) Remover tudo de `reserva`: obrigaria reescrever todos os leitores de `reserva.status = 'concluido'` (avaliação D-032, denúncia D-035, vigência D-024, histórico D-022, admin D-045), que continuam corretos com o status derivado. (b) Manter as 6 colunas: `profissional_id`/`ocupado_ate`/`encaixe` não têm significado com N profissionais e virariam armadilha. (c) Trigger que recalcula `reserva`: esconde escrita e ordem de travas (item → reserva) no banco; preferimos a escrita explícita sob `reserva FOR UPDATE`, com verificador de consistência nos testes (R-2). Pergunta Q1 ao DBA. |
| A-2 | Envelope: `inicio = min(inicio)`, `fim = max(fim)` dos itens **não cancelados**; se todos cancelados, de todos; `cancelada_em` = instante em que o último item não cancelado foi cancelado (nulo caso contrário) | Envelope sobre todos os itens: uma remarcação de data do único item ativo (RN-22) deixaria a reserva "em dois dias". |
| A-3 | `reserva_item.revisao` (revisão da reserva na última mudança do item que gerou mensagem) como base da vigência | Vigência por `mensagem.reserva_item_id` exigiria consultar outras mensagens para saber se houve remarcação posterior; com a revisão do item basta olhar o item. |
| A-4 | `mensagem.reserva_item_id` nulo/opcional, FK composta de 3 colunas para o item da MESMA reserva | Sem referência: o profissional (RN-37) e a substituição por item perderiam o vínculo depois de nova mudança no item. |
| A-5 | Substituição = "pendente que deixou de ser vigente" (um UPDATE com o mesmo predicado da vigência) | Regras por tipo (D-024 RN-7) multiplicadas por item/cancelar todos/cancelamento total: mais casos, mais divergência. |
| A-6 | Nova API `consultarDisponibilidadePorServico`; `consultarDisponibilidade` e `listarProfissionaisElegiveis` (regra de profissional comum) são **removidas** | Manter as duas APIs: código morto com regra revogada, confundiria E3.x futuras. |
| A-7 | Domínio puro ganha só um campo opcional: `ocupacoesDaCliente` | Segunda implementação de regras na camada de serviço (proibido pela D-018 RN-12/spec RN-12). |
| A-8 | Remarcar é UPDATE **do item** (troca hora, profissional e, opcionalmente, serviço com novo snapshot); itens nunca são apagados | `substituirItens` da D-030 (apaga/reinsere) quebraria a FK de `mensagem.reserva_item_id` e o histórico. |
| A-9 | Cancelar item, cancelar todos e marcar status **não travam profissional** (nenhuma dessas transições torna um item ocupante) | Travar `FOR NO KEY UPDATE` todos os profissionais em "cancelar todos" sem necessidade aumenta contenção. Pergunta Q13 ao DBA. |
| A-10 | Profissionais travados num laço em ordem de id (`travarParaReserva`, ≤ 10 comandos), igual à D-030 | Um `SELECT … ORDER BY id FOR NO KEY UPDATE` único: ordem de travamento correta na prática, mas não provada no projeto; o laço já tem prova com `pg_stat_activity` (D-030). Pergunta Q12. |
| A-11 | Encaixe da equipe decidido em LOTE: jornadas, bloqueios e funcionamento de todos os itens em 3 instruções | Decisor da D-029 por item: até 30 instruções em 10 itens. |
| A-12 | Estado do fluxo público na query com `h0..h9` posicionais (índice em `s`) e valor `<profissionalId>_<isoUTC>` | Chave por id de serviço: URL ~40% maior sem ganho; um `name` por profissional (C1 alternativa): permite duas marcações. |
| A-13 | Uma migração única (DDL + DML + guarda) | Expandir/contrair em duas migrações: exigiria escrita dupla durante o desenvolvimento; não há produção a migrar sem parada. |
| A-14 | "Cancelar todos" só do gestor, por uma operação nova da matriz `reserva.cancelar_todos` (`salao`/`negado`/`negado`) | Permitir ao profissional quando todos os itens canceláveis são dele: regra condicional, sem ganho de produto (ND-3 aceito). |

### 1.3 Conflitos e não-decisões do web-design

| Item | Decisão |
|---|---|
| C1 (valor do rádio) | Aceito: `SlotGrid` ganha `prefixoDoValor` (texto) e `nivelLegenda`; valor = `<profissionalId>_<iso>`. |
| C2 (`useActionState` com N itens) | Aceito com abertura por GET: `?remarcar=<itemId>#remarcar`, `?cancelar=<itemId>#cancelar`, `?cancelar=todos#cancelar-todos`; na página há **4** `useActionState` em ordem fixa (remarcar, cancelar, marcarStatus, cancelarTodos), e o estado de cada um carrega `itemId` para a mensagem aparecer na parada certa. Os botões de situação são POST com `itemId` oculto. |
| C3 (vazio por conflito) | Aceito sem SQL a mais: o serviço roda o domínio puro uma segunda vez **sem** os itens escolhidos (mesmos dados lidos) apenas quando o resultado com desconto é vazio, e devolve `vazioPorConflito`. Textos distintos do §5.7 valem. |
| C4 (marcador "1 de 3") | Aceito: só para o gestor; o DTO do profissional nem carrega `posicao` (null). |
| C5 (Enter implícito) | Aceito: primeiro filho do `<form>` é `<button type="submit" hidden>` sem `name`; E2E do critério 24 verifica. Plano B (botão visível no topo) só se o tester reprovar. |
| C6 (sem filtro na reescolha) | Aceito. |
| ND-1 "Seguir sem {serviço}" | Aceito (GET sem PII). |
| ND-2 frase do profissional | Exibida **sempre** para o papel profissional (não revela se há itens de outros). |
| ND-3 "Cancelar todos" só gestor | Aceito (A-14). |
| ND-4 frase do intervalo ≥ 30 min | Aceito; helper puro no componente da confirmação (sem texto copiado). |
| ND-5 ordem dos profissionais | Nome, id (mesma ordem de `candidatos`/"Equipe"). |

---

## 2. Componentes afetados (por área; posse no §9)

- **Banco**: nova migração `prisma/migrations/20261127000000_reserva_item_autonomo/migration.sql`; `prisma/schema.prisma`.
- **Repos**: `src/server/repos/{tipos,reserva,reserva-alteracao,disponibilidade,agenda,mensagem,mensagem-sistema,cliente,publico,servico,profissional}.ts`.
- **Puros novos**: `src/server/reservas/itens.ts` (derivação), `src/server/reservas/decisor-encaixe.ts`,
  `src/server/reservas/cancelar-todos.ts`.
- **Domínio**: `src/domain/disponibilidade/{tipos,calcular}.ts`.
- **Serviços**: `src/server/disponibilidade/*`, `src/server/reservas/*`, `src/server/mensagens/*`,
  `src/server/agenda/*`, `src/server/reserva-publica/*`, `src/server/clientes/{servico,tipos}.ts`,
  `src/server/protecao/futuras.ts`, `src/server/auth/permissoes.ts`.
- **Integração**: `src/server/integrations/whatsapp/mapeamento.ts` (ordem da `confirmacao`), testes do real e do
  simulado; `docs/whatsapp-templates.md`.
- **UI**: `src/components/ui/{RoteiroDoDia,SlotGrid}.*`; `src/app/(publico)/[slug]/**` (exceto `avaliar/`,
  `_denuncia/`); `src/app/painel/agenda/**`; `src/app/painel/clientes/[id]/**` (texto do histórico); vitrines
  `src/app/dev/{componentes,reserva,reserva-nova,agenda,reserva-acoes,mensagens-reserva}/`.
- **Seed/E2E**: `prisma/seed.ts`, `prisma/seed/*`, `e2e/suporte/*`, `e2e/*.spec.ts` citados no §8.
- **Sem mudança de código** (só testes revisados): avaliação (`repos/avaliacao*.ts`, `avaliacoes/servico.ts` leem
  `reserva.status`, agora derivado), denúncia (`repos/denuncia.ts`), admin de mensagens (`repos/admin-mensagens.ts`
  só usa `reserva.cliente_id`; a lista NÃO passa a mostrar serviço/item, para não expor dado novo), anonimização
  (`RepoMensagem.anonimizarDaCliente`, `concluirEnvio`).

---

## 3. Interfaces

### 3.1 Tipos de repositório (`src/server/repos/tipos.ts`, posse de T-2)

```ts
export type ItemDeReservaDTO = {
  id: string; servicoId: string; profissionalId: string; ordem: number;
  inicio: Date; fim: Date; ocupadoAte: Date; status: StatusReserva; encaixe: boolean;
  /** Revisão da reserva na última mudança do item que gerou mensagem (0 ao criar). */
  revisao: number; precoCentavos: number; duracaoMin: number;
};
/** status/inicio/fim DERIVADOS dos itens (A-1/A-2). Itens por (inicio, id). */
export type ReservaDTO = {
  id: string; clienteId: string; inicio: Date; fim: Date; status: StatusReserva;
  origem: OrigemReserva; revisao: number; canceladaEm: Date | null; itens: ItemDeReservaDTO[];
};
/** Uma linha por ITEM (D-013/RN-38): id = reserva; itemId = item; servicos = [serviço do item]. */
export type ReservaBloqueanteDTO = { id: string; itemId: string; inicio: Date; fim: Date; clienteNome: string | null; servicos: string[] };
/** Uma linha por ITEM (D-016/RN-38). */
export type ReservaCobertaDTO = { id: string; itemId: string; profissionalId: string; profissionalNome: string; inicio: Date; fim: Date; clienteNome: string | null };
/** Histórico (D-022/RN-35): por reserva, itens com profissional e status; total calculado no serviço. */
export type ReservaHistoricoDTO = {
  id: string; inicio: Date; status: StatusReserva;
  itens: { servicoNome: string; profissionalNome: string; status: StatusReserva; inicio: Date; precoCentavos: number; duracaoMin: number }[];
};
/** Registro de mensagem: inalterado + `reservaStatus` (derivado), já existente. */
export type ContextoDeRegistroDTO = { /* … campos atuais … */ };
/** Envio (D-024): sai `profissionalNome`/`servicos`/`reserva.inicio`; entram os itens. */
export type ContextoDeEnvio = {
  tipo: TipoMensagemDTO; mensagemRevisao: number; reservaId: string;
  reserva: { revisao: number; status: StatusReserva };
  itens: { inicio: Date; fim: Date; status: StatusReserva; revisao: number; servicoNome: string; profissionalNome: string }[];
  salaoNome: string; fuso: string; clienteAnonimizada: boolean; telefone: string | null;
  consentimentoMensagens: boolean; consentimentoConvite: boolean;
};
```

### 3.2 Derivação pura (`src/server/reservas/itens.ts`, T-2)

```ts
/** RN-21: confirmado > concluido > nao_compareceu > cancelado. Lista vazia → RangeError. */
export function derivarStatus(itens: readonly { status: StatusReserva }[]): StatusReserva;
/** A-2: envelope sobre não cancelados (ou todos, se todos cancelados). */
export function envelope(itens: readonly { status: StatusReserva; inicio: Date; fim: Date }[]): { inicio: Date; fim: Date };
/** status, inicio, fim e canceladaEm (agora se passou a cancelado; mantém a anterior se já era; null senão). */
export function derivarReserva(itens: readonly { status: StatusReserva; inicio: Date; fim: Date }[],
  anterior: { status: StatusReserva; canceladaEm: Date | null } | null, agora: Date):
  { status: StatusReserva; inicio: Date; fim: Date; canceladaEm: Date | null };
```

### 3.3 `RepoReserva` (`src/server/repos/reserva.ts`, T-2)

```ts
criar(ctx, d: { clienteId; origem; chaveRequisicao: string | null; inicio: Date; fim: Date }):
  Promise<{ criada: true; id: string } | { criada: false }>;   // status 'confirmado' LITERAL, revisao 0, ON CONFLICT (salao_id, chave_requisicao) DO NOTHING
criarItens(ctx, reservaId, itens: readonly NovoItemDeReserva[]): Promise<{ id: string; ordem: number }[]>;
  // UM INSERT … SELECT FROM unnest(...) com status 'confirmado' LITERAL; pode lançar 23P01 (não captura)
type NovoItemDeReserva = { servicoId; profissionalId; ordem; inicio; fim; ocupadoAte; precoCentavos; duracaoMin; encaixe };
buscarPorChave(ctx, chave): Promise<ReservaDTO | null>;
buscarPorId(ctx, id): Promise<ReservaDTO>;
listarPorPeriodo(ctx, periodo): Promise<ReservaDTO[]>;   // pelo envelope `reserva.inicio`
contarFuturasDaCliente(ctx, { clienteId, agora, ignorarChave }): Promise<number>;
  // RN-18: reservas com r.status = 'confirmado' (literal; índice reserva_cliente_confirmada_idx) E EXISTS item
  // i.status = 'confirmado' (literal) AND i.inicio > agora
listarBloqueantesDeDesativacao(ctx, profissionalId, agora): Promise<ReservaBloqueanteDTO[]>;  // itens confirmado, fim > agora
listarConfirmadasQueCruzam(ctx, periodo, profissionalId | null, limite): Promise<{ reservas: ReservaCobertaDTO[]; total }>;
  // sobre reserva_item; mantém literal 'confirmado' e o predicado redundante tstzrange(i.inicio, i.ocupado_ate, '[)') && …
```
`atualizarStatus` (primitiva S-9) **sai** de `RepoReserva` (as transições são por item, em `RepoReservaAlteracao`);
`src/server/repos/index.test.ts` é ajustado.

`src/server/reservas/erros-banco.ts` (T-2): `ehConflitoDeSobreposicao` reconhece SQLSTATE 23P01 **e** o nome
`reserva_item_sem_sobreposicao` (o nome antigo deixa de ser aceito). `reserva_item_mesma_reserva_sem_sobreposicao`
NÃO é reconhecido (vira erro: indica falha da checagem pura).

### 3.4 Disponibilidade

Domínio (`src/domain/disponibilidade/tipos.ts`, T-3):
```ts
export type EntradaDeCalculo = { /* atuais */ ;
  /** [inicio, fim) dos itens já escolhidos da mesma reserva (RN-8): vale para TODOS os profissionais;
   *  o início t é recusado se [t, t + duracaoMin) cruzar algum. Ausente = []. */
  readonly ocupacoesDaCliente?: readonly Intervalo[];
};
```
`duracaoMin` passa a ser a duração **do serviço**. As ocupações extras do mesmo profissional (RN-9) são somadas pelo
chamador às `ocupacoes` do profissional como `[inicio, fim + intervalo)`; a regra existente
`[t, t + dur + intervalo)` × ocupações dá exatamente o CA-4.

Repositório (`src/server/repos/disponibilidade.ts`, T-3): `candidatos` vira
```ts
candidatos(ctx, servicoIds, profissionalIds: readonly string[] | null):
  Promise<{ id: string; nome: string; ativo: boolean; servicos: string[] }[]>;
// null → ativos do salão; lista → só eles (ativos ou não; malformado → NaoEncontrado sem SQL).
// `servicos` = ids de servicoIds que ele executa (array_agg), ordem nome, id. 1 SQL.
```
`consultaOcupacoes` lê `reserva_item i` com o mesmo formato (`unnest` + `CROSS JOIN LATERAL`, literal
`i.status IN ('confirmado', 'concluido', 'nao_compareceu')`, `tstzrange(i.inicio, i.ocupado_ate, '[)')`). As demais
leituras não mudam. Continua projeção mínima (sem id de reserva, cliente nem status).

Serviço (`src/server/disponibilidade/{servico,tipos}.ts`, T-3):
```ts
export type ItemJaEscolhido = { servicoId: string; profissionalId: string; inicio: Date };
export type EntradaDisponibilidadePorServico = {
  servicoIds: readonly string[];          // 1..10, sem repetição (validarServicos)
  de: DataCivil; ate: DataCivil; agora: Date;
  /** Itens da MESMA reserva ainda não gravados. Para o serviço k contam os de servicoId ≠ k. */
  escolhidos?: readonly ItemJaEscolhido[];
  /** Subconjunto de servicoIds a calcular (padrão todos). Não muda o número de SQL. */
  calcular?: readonly string[];
  /** Revalidação: limita o candidato de cada serviço a um profissional. Malformado → NaoEncontrado. */
  profissionalPorServico?: Readonly<Record<string, string>>;
};
export type DisponibilidadeDoServico = {
  servicoId: string; nome: string; duracaoMin: number; precoCentavos: number;
  /** Ativos vinculados AO serviço (RN-7), ordem nome, id. */
  profissionais: { profissionalId: string; nome: string; dias: DiaDeDisponibilidade[] }[];
  /** C3: nenhum horário no período COM desconto dos escolhidos, mas haveria sem ele. */
  vazioPorConflito: boolean;
};
export type ResultadoDisponibilidadePorServico =
  | { resultado: 'ok'; fuso: string; intervaloMin: number; servicos: DisponibilidadeDoServico[] }   // ordem de servicoIds
  | { resultado: 'servico_indisponivel' }
  | { resultado: 'entrada_invalida'; motivo: MotivoEntradaInvalida };
export function consultarDisponibilidadePorServico(ctx: ContextoDeLeituraDeAgenda,
  e: EntradaDisponibilidadePorServico, leitor?: RepoDisponibilidade): Promise<ResultadoDisponibilidadePorServico>;
```
Leituras: `lerRegras`, `servicosOfertaveis`, `candidatos`, e — se houver candidato e recorte — `jornadas`,
`bloqueios`, `ocupacoes` para a **união** dos candidatos: no máximo 6 instruções, sempre as mesmas (CA-3). O domínio
roda uma vez por serviço calculado (≤ 10), com os profissionais elegíveis dele.

### 3.5 Criação (`src/server/reservas/tipos.ts`, `criar-reserva.ts`, `validacao.ts`, T-5)

```ts
export type ItemPedido = { servicoId: string; profissionalId: string; inicio: Date };
export type EntradaCriarReserva = {
  /** 1..10, servicoId sem repetição; a posição é a `ordem` gravada. */
  itens: readonly ItemPedido[];
  cliente: { nome: unknown; telefone: unknown }; aceites: unknown;
  chaveRequisicao?: string | null; modo?: ModoReserva; agora: Date;
};
export type ItemDeReservaCriada = { id; servicoId; profissionalId; ordem; inicio; fim; ocupadoAte; precoCentavos; duracaoMin; encaixe; status };
export type ReservaCriada = { id; clienteId; inicio; fim; status; origem; revisao; itens: ItemDeReservaCriada[] /* por inicio */ };
export type CausaIndisponibilidade = '23P01' | 'revalidacao' | 'entre_itens';
export type ErrosReserva = Partial<Record<'itens' | 'nome' | 'telefone' | 'chave', string>> & {
  /** Por índice do item pedido. */
  porItem?: Record<number, Partial<Record<'servico' | 'profissional' | 'inicio', string>>>;
};
// ResultadoCriarReserva: mesmos desfechos; mudam:
  | { resultado: 'horario_indisponivel'; causa: CausaIndisponibilidade;
      /** Índices dos itens que falharam (vazio quando o 23P01 não identifica o item). */
      itens: readonly number[];
      /** Só em 'entre_itens': índice do item com que cada um conflita. */
      conflitos?: Readonly<Record<number, number>> }
  | { resultado: 'profissional_indisponivel'; itens: readonly number[] }
  | { resultado: 'encaixe_requer_confirmacao'; motivos: { indice: number; motivos: MotivoEncaixe[] }[] }
// DependenciasCriarReserva: decidirEncaixe muda de forma (abaixo); antesDaReserva recebe { clienteId, inicio: envelope.inicio } (inalterado).
decidirEncaixe?: (ctx, r: Repos, d: { fuso: string; itens: { inicio: Date; fim: Date; profissionalId: string }[] })
  => Promise<{ encaixes: boolean[] } | { motivos: { indice: number; motivos: MotivoEncaixe[] }[] }>;
```

Algoritmo de `criarReserva` (uma `emTransacao` READ COMMITTED; desfechos não-`criada` por sentinela, como hoje):
1. Fase pura: `validarEntradaReserva` (1..10 itens, `servicoId` distintos, UUIDs, `inicio` em minuto cheio; ids
   malformados → `servico_indisponivel`/`profissional_indisponivel` com os índices), consentimento, política
   (`agendar`), prévia por chave (`conferirCompativel` compara o **conjunto** {servicoId, profissionalId, inicio}).
2. `saloes.travarParaLeitura` (FOR SHARE; devolve fuso e intervalo).
3. Profissionais distintos dos itens, em ordem de id, `profissionais.travarParaReserva` (FOR NO KEY UPDATE) um a um;
   inativo/inexistente → `profissional_indisponivel` com os índices afetados.
4. `servicos.travarParaItens(ctx, servicoIds, pares)` (§3.8): 1 comando de trava FOR SHARE por id + 1 comando de
   vínculos dos pares; serviço ausente/inativo → `servico_indisponivel`; par sem vínculo →
   `profissional_indisponivel` com o índice.
5. Monta os itens com snapshot (`montar-itens.ts` reescrito: `fim = inicio + duracao`, `ocupadoAte = fim + intervalo`,
   sem encadeamento).
6. `conferirItens` (puro, `validacao.ts`): todos na mesma data local do 1º item → senão `invalido` com
   `porItem[k].inicio = MENSAGENS_RESERVA.dataDiferente`; pares não cancelados com `[inicio, fim)` cruzados (RN-8) ou
   do mesmo profissional com `[inicio, ocupadoAte)` cruzados (RN-9) → `horario_indisponivel` causa `entre_itens`
   (o item de maior índice é o que falha; `conflitos[k] = j`).
7. `modo: 'normal'`: UMA chamada `consultarDisponibilidadePorServico(ctx, { servicoIds, de: dia, ate: dia, agora,
   escolhidos: todos os itens, profissionalPorServico }, r.disponibilidade)`; item cujo início não é oferecido ao seu
   profissional → `horario_indisponivel` causa `revalidacao` com TODOS os índices que falharam. Depois,
   `deps.aposRevalidar?.()`.
   `modo: 'encaixe'`: `inicio < agora` em qualquer item → `invalido`; `decidirEncaixe` em lote (3 leituras).
8. `upsertCliente` → `antesDaReserva` → `reservas.criar` (envelope de `envelope()`) → `reservas.criarItens` →
   consentimento (um por finalidade por reserva) → `registrarMensagem('confirmacao')`.
9. Fora: 23P01 de `reserva_item_sem_sobreposicao` → `horario_indisponivel` causa `23P01`, `itens: []`; releitura por
   chave como hoje. `enfileirarMensagens` só depois do commit.

### 3.6 Operações por item (`src/server/reservas/*`, T-6)

```ts
// tipos-alteracao.ts
export type EntradaRemarcarItem = { reservaId: unknown; itemId: unknown; servicoId: unknown; profissionalId: unknown;
  data: unknown /* só aceita outra data se o item for o único não cancelado */; hora: unknown; confirmarEncaixe: unknown };
export type ResultadoRemarcarItem =
  | { resultado: 'atualizada'; itemId: string; revisao: number; encaixe: boolean; mensagem: { mensagemId: string; estado: EstadoMensagem } }
  | { resultado: 'invalido'; erros: Partial<Record<'servico' | 'inicio' | 'data', string>> }
  | { resultado: 'horario_indisponivel'; causa: '23P01' | 'entre_itens' }
  | { resultado: 'servico_indisponivel' } | { resultado: 'profissional_indisponivel' }
  | { resultado: 'encaixe_requer_confirmacao'; motivos: MotivoEncaixe[] }
  | { resultado: 'recusado'; motivo: 'item_final' | 'transicao_invalida' | 'sem_alteracao' | 'data_diferente' | 'servico_repetido' };
export type ResultadoStatusItem =
  | { resultado: 'atualizada'; itemId: string; status: StatusReserva; statusReserva: StatusReserva; revisao: number;
      mensagens: { mensagemId: string; estado: EstadoMensagem }[] }
  | { resultado: 'recusado'; motivo: MotivoRecusaDeStatus };
export type ResultadoCancelarTodos =
  | { resultado: 'atualizada'; itemIds: string[]; revisao: number; mensagens: { mensagemId: string; estado: EstadoMensagem }[] }
  | { resultado: 'recusado'; motivo: 'nenhum_cancelavel' };

remarcarItem(ctx: TenantContext, e: EntradaRemarcarItem, agora, deps?): Promise<ResultadoRemarcarItem>;
cancelarItem(ctx, { reservaId, itemId }, agora, deps?): Promise<ResultadoStatusItem>;
marcarStatusDoItem(ctx, { reservaId, itemId, destino }, agora, deps?): Promise<ResultadoStatusItem>;
cancelarTodos(ctx, { reservaId }, agora, deps?): Promise<ResultadoCancelarTodos>;
```
`reservas-status.acao.ts`: `remarcarItem` (capacidade `agendar`), `cancelarItem`, `marcarStatusDoItem`,
`cancelarTodos` (capacidade `cancelar`), todas `defineAcao({ papeis: ['gestor','profissional'] })`; `cancelarTodos`
exige a nova operação `reserva.cancelar_todos` (gestor `salao`, profissional `negado`). As ações antigas
(`remarcarReserva`, `cancelarReserva`, `marcarStatus`) saem.

`RepoReservaAlteracao` (`src/server/repos/reserva-alteracao.ts`, T-6):
```ts
travarParaAlterar(ctx, reservaId): Promise<{ id; clienteId; origem; status; revisao; canceladaEm }>;  // FOR UPDATE OF r
travarCliente(ctx, clienteId): Promise<void>;                                                       // FOR KEY SHARE OF c (inalterado)
lerItens(ctx, reservaId): Promise<ItemDeReservaDTO[]>;   // depois da trava da reserva; sem trava própria
atualizarItem(ctx, itemId, d: { servicoId; profissionalId; inicio; fim; ocupadoAte; precoCentavos; duracaoMin; encaixe; revisao; agora }): Promise<void>;
  // WHERE … AND status = 'confirmado' (LITERAL); pode lançar 23P01
atualizarStatusDosItens(ctx, reservaId, d: { itemIds: string[]; de: StatusReserva[]; para: StatusReserva; revisao: number | null; agora }): Promise<number>;
  // revisao null = não mexe (marcar status); devolve linhas afetadas
gravarDerivados(ctx, reservaId, d: { status; inicio; fim; canceladaEm; revisao; agora }): Promise<void>;
```

Sequências (toda operação: permissão → política → transação; desfecho por sentinela; fila depois do commit):
- **remarcarItem**: prévia (item do salão; profissional só se o item é dele; alvo também passa pela matriz → 403) →
  `salao FOR SHARE` → profissionais {atual do item, alvo} em ordem de id `FOR NO KEY UPDATE` → serviço do item
  (atual ou novo) `FOR SHARE` + vínculo com o alvo → cliente `FOR KEY SHARE` → reserva `FOR UPDATE` → `lerItens` →
  reconfere permissão pelo profissional ATUAL do item → regras (item `confirmado`; `inicio >= agora`; RN-22 data;
  serviço novo não pode já existir na reserva, **inclusive em item cancelado** (M-5; a UNIQUE inclui cancelados e o
  23505 nunca é capturado) → `servico_repetido`; RN-8/RN-9 contra os outros itens não cancelados
  via `conferirItens`) → `decidirEncaixe` (lote de 1) → `atualizarItem` (com `revisao = reserva.revisao + 1`) →
  `gravarDerivados` (revisão + 1) → `registrarMensagem('remarcacao', reservaItemId)` → `substituirNaoVigentes`.
- **cancelarItem / marcarStatusDoItem**: prévia → `salao FOR SHARE` → cliente `FOR KEY SHARE` → reserva `FOR UPDATE` →
  `lerItens` → reconfere permissão → `decidirTransicao` (por item, inalterada) → UPDATE do item (cancelar:
  `revisao = reserva.revisao + 1`) → `derivarReserva` → `gravarDerivados` → mensagens: cancelar →
  `registrarMensagem('cancelamento', reservaItemId)`; se o status derivado passou a `concluido` →
  `registrarMensagem('convite_avaliacao')` (RN-33) → `substituirNaoVigentes`.
- **cancelarTodos**: prévia + `reserva.cancelar_todos` → mesma ordem de travas → itens `confirmado` com
  `agora < fim` (nenhum → `nenhum_cancelavel`) → um UPDATE (todos com a mesma `revisao + 1`) → derivados →
  `registrarMensagem('cancelamento')` SEM item → convite se o derivado virou `concluido` (CA-28) →
  `substituirNaoVigentes`.
- Cliente anonimizada (RN-26): tudo permitido; `registrarMensagem` já faz nascer `cancelada_anonimizacao`.

`status.ts`: `decidirTransicao`/`acoesPermitidas` continuam por item (mesma assinatura); entra
`podeCancelarTodos(itens, agora)`.

### 3.7 Mensagens (`src/server/mensagens/*`, `repos/mensagem*.ts`, T-4)

```ts
registrarMensagem(ctx, e: { reservaId: string; tipo: TipoMensagem; reservaItemId?: string | null }, agora, r): Promise<ResultadoRegistro>;
// revisão: confirmacao/convite = 0; remarcacao/cancelamento = reserva.revisao (≥ 1, senão RangeError);
// reservaItemId só com remarcacao/cancelamento (senão RangeError). NÃO faz mais substituição (sai para o chamador).
r.mensagens.substituirNaoVigentes(ctx, reservaId, agora): Promise<number>;
// UM UPDATE: pendentes da reserva cujo predicado de vigência (PREDICADO_VIGENTE) é falso → 'substituida'.
export function conferirVigencia(tipo: TipoMensagem, m: { revisao: number },
  r: { status: StatusReserva; itens: readonly { revisao: number; status: StatusReserva }[] }): 'vigente' | 'obsoleta';
//  confirmacao: r.status = 'confirmado' | remarcacao: ∃ item revisao = m.revisao ∧ 'confirmado'
//  cancelamento: ∃ item revisao = m.revisao ∧ 'cancelado' | convite_avaliacao: r.status = 'concluido'
export const PREDICADO_VIGENTE: Prisma.Sql;   // em repos/mensagem.ts; aliases fixos `m` (mensagem) e `r` (reserva).
// Fonte ÚNICA em SQL: usada por substituirNaoVigentes e pelo EXISTS da agenda (D-043); teste de paridade com conferirVigencia.
montarParametros(tipo, d: { salaoNome; fuso; itens: ContextoDeEnvio['itens']; revisao: number }): Record<string, string>;
//  confirmacao → { salao, data, itens }: itens não cancelados por inicio, "09:00 Escova com Ana; 10:00 …" (sem quebra)
//  remarcacao  → { salao, servicos, profissional, data, horario } dos itens com revisao = m.revisao ∧ confirmado
//  cancelamento → { salao, servicos, data, horario } dos itens com revisao = m.revisao ∧ cancelado (ordem de inicio)
consultarMensagensDaReserva(ctx, reservaId)   // D-043: profissional vê as sem item e as de itens dele; 404 se não tem item na reserva
```
`ORDEM_PARAMETROS.confirmacao = ['salao', 'data', 'itens']` (`integrations/whatsapp/mapeamento.ts`); os demais
modelos não mudam; o limite de 1024 com `…` da D-047 já se aplica a `itens`. A variável
`WHATSAPP_TEMPLATE_CONFIRMACAO` não muda de nome: passa a apontar para o novo modelo aprovado (sugestão
`agenda_confirmacao_itens`, `docs/whatsapp-templates.md`).

### 3.8 Travas de serviços (`src/server/repos/servico.ts`, T-2)
```ts
travarParaItens(ctx, servicoIds: readonly string[], pares: readonly { servicoId: string; profissionalId: string }[]):
  Promise<{ id; nome; ativo; precoCentavos; duracaoMin }[] & { vinculados: Set<`${servicoId}:${profissionalId}`> }>;
// 1 comando: SELECT … WHERE id = ANY ORDER BY id FOR SHARE OF s; 1 comando: vínculos por unnest dos pares.
```
`travarParaReserva(ctx, ids, profissionalId)` permanece enquanto houver chamador e sai em T-6 quando a remarcação
passar a usar `travarParaItens`.

### 3.9 Agenda (`src/server/repos/agenda.ts`, `src/server/agenda/*`, T-7)
```ts
export type BlocoDaAgenda = {
  itemId: string; reservaId: string; profissionalId: string; inicio: Date; fim: Date;
  status: StatusAgenda /* do item */; origem: OrigemAgenda; encaixe: boolean /* do item */;
  clienteNome: string | null; servicoNome: string; precoCentavos: number; duracaoMin: number;
  temFalhaDeMensagem: boolean /* da reserva */;
  /** "1 de 3" entre itens não cancelados da reserva, por (inicio, id). SÓ gestor; null para profissional. */
  posicao: { n: number; de: number } | null;
};
// ColunaDaAgenda.reservas → ColunaDaAgenda.blocos: BlocoDaAgenda[]
export type DetalheDaReserva = {
  id; clienteId; clienteNome: string | null; data: DataCivil; status: StatusAgenda /* derivado */; origem;
  /** Por (inicio, id); profissional recebe só os itens dele (CA-33). */
  itens: { id; servicoNome; profissionalId; profissionalNome; profissionalAtivo; inicio; fim; status; encaixe;
           precoCentavos; duracaoMin; acoes: AcoesPermitidas }[];
  total: { centavos: number; servicos: number; rotulo: 'reserva' | 'seus_servicos' | 'cancelada' };
  temItemCancelado: boolean; podeCancelarTodos: boolean /* gestor e 2+ canceláveis */; papel: 'gestor' | 'profissional';
};
```
`consultaAgenda`: UM comando sobre `reserva_item i JOIN reserva r JOIN profissional p JOIN cliente c JOIN servico s`,
`i.inicio < ate AND i.fim > de AND i.inicio >= de - <margem>` (margem `interval '1 day'`, confirmada pelo DBA
com o teto M-2), filtro `i.profissional_id` quando houver, `ORDER BY i.inicio, i.id LIMIT 201`;
`tem_falha_mensagem` = `EXISTS (… m.estado = 'falhou' AND ${PREDICADO_VIGENTE})`; `posicao` por subconsultas
correlacionadas só quando o papel é gestor. `consultarAgenda` continua com **exatamente 6 instruções** (CA-34).
`MENSAGENS_AGENDA.truncada` = texto do web-design §5.9; `LIMITES_AGENDA.reservas` renomeado `itens` (200).
`rotulos.ts` ganha `rotuloDoStatusDoItem` (masculino).

### 3.10 Fluxo público (`src/server/reserva-publica/*`, T-10)

Query (GET, sem PII): `s` (repetido, ordem de escolha), `data` (AAAA-MM-DD), `de` (página de dias), `h0..h9`
(`<profissionalId>_<isoUTC>`, índice = posição em `s`), `f` (filtro de profissional do passo atual), `alterar`
(`servicos` | `0..9`), `enviado` (índice; só faz o aviso "Escolha um horário para X" aparecer se o passo continua o
mesmo), `aviso` (lista fechada: `horario_indisponivel`, `servico_indisponivel`, `profissional_indisponivel`,
`sem_selecao`; `sem_profissional` sai).

```ts
export type ItemDaUrl = { profissionalId: string; inicio: Date };
export type PassoLido =
  | { passo: 'servicos'; marcados: string[]; aviso: CodigoAviso | null }
  | { passo: 'data'; s: string[]; de: DataCivil; aviso }
  | { passo: 'servico'; s: string[]; data: DataCivil; indice: number; itens: (ItemDaUrl | null)[];
      preSelecionado: ItemDaUrl | null; filtro: string | null; aviso }
  | { passo: 'dados'; s: string[]; data: DataCivil; itens: ItemDaUrl[] };
export function lerPasso(params, ctx: { hoje; janelaDias }): PassoLido;   // pura; o 1º hk ausente/inválido define o passo
export function montarHref(base: string, q: ConsultaDaUrl): string;        // preserva hk na ordem
```
`carregarPasso` (servidor): `data` → uma consulta para 14 dias sem escolhidos (dia oferecido se **cada** serviço tem
≥ 1 horário, DA-2); `servico` k → uma consulta (dia único, `calcular: [s[k]]`, `escolhidos` = itens válidos ≠ k);
`dados` → uma consulta com todos os itens como escolhidos e `profissionalPorServico` para conferir cada item; o
primeiro item que não está mais oferecido (ou que conflita com outro, `conferirItens`) volta ao passo dele com aviso.
Cada passo que calcula horários consome UMA unidade de `limitarPorIp(ip, 'disponibilidade')` (como hoje).

`VisaoDoPasso`/`ResumoConfirmacao`/`EntradaReservaPublica` (texto exato e componentes no web-design §5):
```ts
EntradaReservaPublica = { slug; servicoIds: string[]; itens: { servicoId; profissionalId; inicio: string }[];
  nome; telefone; aceites; chaveRequisicao; ip; tokenHumano };
ResumoConfirmacao = { fuso; data: string; itens: { servicoNome; profissionalNome; inicioIso; fimIso; precoCentavos; duracaoMin }[]; totalCentavos };
ResultadoReservaPublica: 'voltar' passa a { passo: 'servicos' | 'servico'; indice?: number; aviso } e entra
  | { resultado: 'reescolher'; itens: number[] }   // a casca monta a reescolha com reescolha.ts (nunca redireciona)
```
`reescolha.ts`: `reescolhaDosItens(slug, { s, data, itens }, agora, ip)` → `{ fuso; itens: { indice; servicoNome;
horarioAnterior; profissionais: { id; nome; horarios: string[] }[] }[] }`; recalcula quais itens caíram (cobre o
23P01 sem índice); se nenhum caiu, devolve o passo de dados com aviso genérico. `lerRotulosDaReserva(ctx,
servicoIds, profissionalIds[])` em `repos/publico.ts`.

### 3.11 Equipe — nova reserva (`src/server/reservas/reserva-equipe.ts`, T-12)
```ts
export type EntradaReservaEquipe = { data: unknown; itens: { servicoId: unknown; profissionalId: unknown; hora: unknown }[];
  nome; telefone; aceites; confirmarEncaixe; chaveRequisicao };
criarReservaDaEquipe(ctx, e, agora, deps?): Promise<ResultadoCriarReserva>;
```
Cada item: profissional malformado/de outro salão → 404; profissional logado com item de outro → 403 (antes de
qualquer escrita, CA-24). Converte data + hora pelo `fuso.ts`, chama `criarReserva` em `modo: 'encaixe'` com
`decidirEncaixe = criarDecisorDeEncaixe(confirmou)` de `decisor-encaixe.ts` e `consentimentoOpcional`. FormData:
`data`, `itens` (contagem), `item-<n>-servico|profissional|hora`, `linha` (`adicionar` | `remover:<n>`): a casca
`acoes.ts` só devolve o estado com uma linha a mais/a menos, sem chamar o serviço.

---

## 4. Dados (para revisão do DBA)

### 4.1 `reserva_item` (novas colunas)
| Coluna | Tipo | Regra |
|---|---|---|
| `profissional_id` | uuid NOT NULL | FK `(salao_id, profissional_id)` → `profissional (salao_id, id)` RESTRICT |
| `inicio`, `fim`, `ocupado_ate` | timestamptz NOT NULL | UTC |
| `status` | status_reserva NOT NULL | sem DEFAULT (a aplicação grava o literal) |
| `encaixe` | boolean NOT NULL DEFAULT false | flag real (D-029) |
| `revisao` | int NOT NULL DEFAULT 0 | revisão da reserva na última mudança com mensagem |
| `atualizado_em` | timestamptz NOT NULL DEFAULT now() | relógio do chamador nas escritas brutas |

Restrições propostas:
- `reserva_item_ordem_chk CHECK (fim > inicio AND ocupado_ate >= fim)`.
- `reserva_item_fim_chk CHECK (fim = inicio + make_interval(mins => duracao_min))` (Q11).
- `reserva_item_revisao_chk CHECK (revisao >= 0)`.
- `reserva_item_sem_sobreposicao EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, ocupado_ate, '[)') WITH &&) WHERE (status IN ('confirmado', 'concluido', 'nao_compareceu'))`.
- `reserva_item_mesma_reserva_sem_sobreposicao EXCLUDE USING gist (reserva_id WITH =, tstzrange(inicio, fim, '[)') WITH &&) WHERE (status IN ('confirmado', 'concluido', 'nao_compareceu'))` (Q2).
- `UNIQUE (salao_id, reserva_id, id)` (alvo da FK de `mensagem`) e `UNIQUE (salao_id, reserva_id, servico_id)` (RN-2, Q10; inclui cancelados). Sem `UNIQUE (salao_id, id)` (M-1).
- `reserva_item_duracao_teto_chk CHECK (duracao_min <= 1440)` (M-2; sustenta a margem de 1 dia da agenda).
- Índices: `(salao_id, profissional_id, inicio)` e `(salao_id, inicio)` (agenda); o `UNIQUE (salao_id, reserva_id, ordem)` existente atende as leituras por reserva.

### 4.2 `reserva`
- Remover: `reserva_sem_sobreposicao`, `reserva_ordem_chk` (recriada como `CHECK (fim > inicio)`), índice
  `reserva_salao_id_profissional_id_inicio_idx`, FK `(salao_id, profissional_id)`, colunas `profissional_id`,
  `ocupado_ate`, `encaixe`.
- Manter: `status` (derivado), `inicio`/`fim` (envelope), `revisao`, `cancelada_em` (instante do cancelamento total),
  índices `(salao_id, inicio)`, `(salao_id, cliente_id, inicio)`, `reserva_cliente_confirmada_idx` (Q5).

### 4.3 `mensagem`
- `reserva_item_id uuid NULL`, FK `(salao_id, reserva_id, reserva_item_id)` → `reserva_item (salao_id, reserva_id, id)`
  RESTRICT (MATCH SIMPLE: nula não é conferida).
- `mensagem_item_tipo_chk CHECK (reserva_item_id IS NULL OR tipo IN ('remarcacao', 'cancelamento'))`.
- `UNIQUE (reserva_id, tipo, revisao)` inalterado.

### 4.4 Migração `20261127000000_reserva_item_autonomo` (ordem)
0. **Guarda antes de qualquer DDL** (`DO $$ … RAISE EXCEPTION`), 4 contagens (M-3): reservas sem itens,
   `fim <> inicio + soma(duracao_min)`, serviço repetido na mesma reserva e itens com mais de 1440 min; aborta com a
   mensagem fixa do `dba.md` §3 (CA-47).
1. `ADD COLUMN` nulos em `reserva_item`; 2. `UPDATE … FROM` com janela por `ordem`: `inicio = r.inicio + soma das
   durações anteriores`, `fim = inicio + duracao`, `ocupado_ate = fim` (não último) ou `r.ocupado_ate` (último),
   `profissional_id/status/encaixe` da reserva, `revisao = r.revisao` (RN-39; mantém vigência das mensagens antigas,
   CA-49); 3. `SET NOT NULL`, CHECKs, UNIQUEs, FKs, índices e as duas exclusions; 4. `mensagem.reserva_item_id` +
   FK + CHECK; 5. remoções em `reserva` (§4.2).
- Cabeçalho com impacto (ACCESS EXCLUSIVE em `reserva`, `reserva_item`, `mensagem` durante a migração; volume v1) e
  a **reversão** entre os marcadores `-- REVERSAO-INICIO` / `-- REVERSAO-FIM` (linhas comentadas `-- `), que o
  teste extrai e executa (CA-48). A reversão primeiro verifica que todo agendamento é representável no modelo
  antigo (itens contíguos por `ordem`, mesmo profissional, mesmo status, encaixe igual) e aborta com a contagem caso
  contrário; depois recria colunas, dados, constraints e índices antigos, anula/remove `mensagem.reserva_item_id`,
  remove as colunas e constraints novas e apaga a linha em `_prisma_migrations`.
- `schema.prisma` acompanha (drift test verde): `Reserva` sem `profissional`/`ocupadoAte`/`encaixe`; `ReservaItem`
  com os campos, `profissional`, `mensagens` e os `@@unique`/`@@index`; `Profissional.reservas` → `itensDeReserva`;
  `Mensagem.reservaItem`.

### 4.5 Regras de SQL obrigatórias (herdadas, agora sobre itens)
- Literais de status nunca viram parâmetro: `consultaOcupacoes`, `listarConfirmadasQueCruzam`, `contarFuturas`,
  `criarItens`, `atualizarItem` (`WHERE status = 'confirmado'`), `PREDICADO_VIGENTE`.
- `tstzrange(i.inicio, i.ocupado_ate, '[)')` repetido literalmente onde se quer o GiST da exclusion.

### 4.6 Ordem canônica de travas (atualiza o cabeçalho de `repos/servico.ts`)
`salao` (FOR SHARE/NO KEY UPDATE, sempre primeiro) → `assinatura` → **profissional(is) FOR NO KEY UPDATE em ordem de
id** (todos os dos itens novos/alvo, sem repetição) → serviço(s) FOR SHARE em ordem de id → cliente → **reserva FOR
UPDATE** (operações por item) → `reserva_item` (UPDATE, nunca trava própria antes da reserva) → `servico_profissional`/
`jornada`/`salao_funcionamento` (leituras) → consentimento → `mensagem`/`mensagem_tentativa` (por último).
Cancelar/status/cancelar todos omitem profissionais e serviços (subconjunto na mesma ordem). Anonimização (D-031):
`salao FOR NO KEY UPDATE` → cliente FOR UPDATE → mensagens: sem ciclo com as operações (todas pegam cliente antes da
reserva).

### 4.7 Planos a medir (DBA, T-1)
| Consulta | Volume | Esperado |
|---|---|---|
| `consultaOcupacoes` (CA-3), custom e genérico | ≥ 10.000 itens, 2 × 10 profissionais | Index/Bitmap scan em `reserva_item_sem_sobreposicao` |
| `consultaAgenda` (D-028) dia/semana, com e sem profissional | 60 k itens | Index Scan em `reserva_item_salao_id_[profissional_id_]inicio_idx`; EXISTS da falha sem Seq Scan em `mensagem` |
| `listarConfirmadasQueCruzam` (D-016), as duas variantes | 60 k itens | GiST da exclusion |
| `contarFuturasDaCliente` | cliente com 50 reservas | `reserva_cliente_confirmada_idx` + acesso por `(salao_id, reserva_id, …)` |
| `substituirNaoVigentes` | reserva com 10 itens e 30 mensagens | sem varredura fora da reserva |

### 4.8 Ação requerida do DBA
DBA **solicitado**: parecer `docs/demandas/D-050/dba.md` respondendo Q1–Q15, escrever a migração e os testes de
esquema/migração (T-1) e medir os planos do §4.7.

### 4.9 Perguntas ao DBA
- **Q1** Derivados armazenados em `reserva` (status/inicio/fim) com escrita explícita da aplicação: aceita, ou prefere
  trigger `DEFERRABLE` só de verificação? (Nossa proposta: sem trigger; verificador em teste.)
- **Q2** Vale manter `reserva_item_mesma_reserva_sem_sobreposicao` (defesa em profundidade de RN-8) dado o custo de
  um segundo GiST? Algum risco com INSERT de N linhas num só comando?
- **Q3** FK de 3 colunas `mensagem (salao_id, reserva_id, reserva_item_id)` com MATCH SIMPLE: ok? Índice necessário?
- **Q4** Índices de agenda em `reserva_item` e margem do limite inferior (`1 day` vs `7 days`).
- **Q5** `reserva_cliente_confirmada_idx` continua útil para RN-18 com o EXISTS nos itens? Algo melhor?
- **Q6** Plano de `consultaOcupacoes` (genérico/custom) com ≥ 10 k itens (CA-3, impresso no teste).
- **Q7** EXISTS da falha de mensagem com `PREDICADO_VIGENTE` (subconsulta em `reserva_item` por revisão) a 60 k.
- **Q8** `listarConfirmadasQueCruzam` sobre itens: implicação do literal `'confirmado'` com o predicado da exclusion.
- **Q9** `prisma migrate deploy` aplica o arquivo numa transação? A guarda com `RAISE` antes de qualquer DDL basta para
  "aborta sem aplicar nada" mesmo que não aplique? Duração dos locks e da varredura de criação das exclusions.
- **Q10** `UNIQUE (salao_id, reserva_id, servico_id)` (também com itens cancelados): ok com RN-2/RN-22?
- **Q11** `CHECK (fim = inicio + make_interval(mins => duracao_min))` é seguro (timestamptz em UTC, sem DST)?
- **Q12** Laço de `travarParaReserva` em ordem de id (≤ 10 comandos) versus um único `ORDER BY id FOR NO KEY UPDATE`.
- **Q13** Cancelar item/todos e marcar status sem travar profissional: algum impasse ou perda com a desativação
  (D-013, `FOR UPDATE` no profissional e checagem de itens confirmados futuros)?
- **Q14** Quantas `confirmacao` em `falhou` com `reserva.revisao > 0` existem nas bases de seed/E2E (R-4)?
- **Q15** Reversão: o critério "representável no modelo antigo" e a anulação de `mensagem.reserva_item_id` são
  suficientes para "esquema anterior com dados equivalentes" (CA-48)?

---

## 5. Infraestrutura

Nenhuma variável de ambiente, container, serviço do compose ou job de CI novo. `WHATSAPP_TEMPLATE_CONFIRMACAO` mantém o
nome e passa a apontar para o novo modelo (operacional, documentado no README e em `docs/whatsapp-templates.md`). O
job `e2e` ganha specs (tempo maior, dentro do atual). **DevOps dispensado**: não há impacto em imagem, compose, CI,
observabilidade ou segredos; os logs continuam só com ids e enumerados (o evento `reserva.criar` troca
`profissionalId` por `itens: n`).

---

## 6. Verificação das invariantes

| Invariante | Aplica? | Como |
|---|---|---|
| Escopo por salão no servidor | Sim | Toda consulta nova filtra `salao_id`; FKs compostas com `salao_id` em `reserva_item.profissional_id` e `mensagem.reserva_item_id`; ids de outro salão = inexistentes (público: `servico_indisponivel`/`profissional_indisponivel`; equipe: 404). CA-50 em integração por módulo. |
| Exclusion anti-sobreposição | Sim | `reserva_item_sem_sobreposicao` (SQL bruto, literais), inclusive encaixes; 23P01 reconhecido por SQLSTATE + nome, só fora da transação; 23505 nunca capturado. CA-19. |
| UTC + fuso do salão | Sim | Itens em UTC; data única e horários pelo `fuso.ts`; mensagens e telas por `format.ts`; testes em `TZ=UTC` e `TZ=America/Sao_Paulo`. |
| Multi-serviço | **Revogada e substituída** | Novo texto do CLAUDE.md (T-16): "cada serviço é um item com profissional e horário próprios, na mesma data local; itens da mesma reserva não se sobrepõem; só profissionais vinculados ao serviço; snapshot por item". |
| Adaptadores de integração | Sim | Só a ordem de parâmetros da `confirmacao` muda em `mapeamento.ts`; simulado sem mudança de contrato; nada de integração no domínio. |
| Soft delete / anonimização | Sim | Itens nunca apagados (A-8); profissional/serviço desativados mantêm itens; anonimização inalterada, testada com N itens. |
| Salão suspenso somente leitura | Sim | Criar/remarcar → `agendar` (403/`salao_indisponivel`); cancelar item/todos e status → `cancelar`; leitura livre. CA-14, CA-31. |
| Idempotência de webhooks/mensagens | Sim | Chave `reserva:tipo:revisao` inalterada; revisão sobe em todo evento com mensagem (CA-38, CA-41); `chave_requisicao` por reserva (CA-11). |
| Auditoria do super admin | Não se aplica | Nenhuma ação de admin muda; a reenvio D-045 continua com o mesmo contrato (vigência nova via `conferirVigencia`). |
| Mensagens após commit, falha não altera reserva | Sim | `enfileirarMensagens` sempre depois do commit em todas as operações novas. |

---

## 7. Riscos e decisões

| # | Risco | Mitigação |
|---|---|---|
| R-1 | Mudança de esquema quebra a compilação de muitos módulos ao mesmo tempo | Rodadas sequenciais (§9); critério por tarefa = testes listados verdes + `npx tsc --noEmit` sem erro nos arquivos sob posse; a T-17 exige tudo verde. Vitest não depende do typecheck global. |
| R-2 | Derivados de `reserva` divergirem dos itens | Uma só função pura (`derivarReserva`); escrita sob `reserva FOR UPDATE`; `tests/support/reservas.ts` ganha `conferirDerivados(reservaId)` (SQL de verificação, só teste) chamado em todo teste de alteração e nos de concorrência. |
| R-3 | Modelo `confirmacao` novo precisa de aprovação na Meta; com o modelo antigo o envio real falha | Falha permanente `parametros_invalidos` → `falhou`, nunca altera a reserva; README e `docs/whatsapp-templates.md` avisam; simulado cobre os testes. |
| R-4 | Confirmação antiga `falhou` de reserva remarcada passa a ser vigente (regra nova) | Comportamento aceito e documentado; DBA conta os casos (Q14). |
| R-5 | Regressão de plano (D-016/D-018/D-028/D-043) | EXPLAIN nos testes de plano reescritos (T-1 mede; T-3/T-7 mantêm os testes). |
| R-6 | 23P01 não diz qual item caiu | `reescolha.ts` recalcula a disponibilidade de cada item fora da transação. |
| R-7 | URL longa com 10 itens (~1,6 KB) | Abaixo de qualquer limite prático; CA-8 cobre 11+ itens (volta a serviços). |
| R-8 | Mensagem `remarcacao` antiga pendente (sem item) após operação em item de reserva migrada | Janela de minutos (reconciliação); efeito: lista só os itens ainda na revisão; aceito. |
| R-9 | Cancelar sem travar profissional × desativação | Desativação só fica mais permissiva; caso determinístico com `pg_stat_activity` em T-6 (Q13). |
| R-10 | Exclusion não cobre bloqueio | Risco aceito da D-025, inalterado; aviso de bloqueio lista itens. |
| R-11 | Lock longo da migração | Volume v1; DBA mede (Q9). |
| R-12 | Muitas tarefas tocam testes de outros módulos | Posse por arquivo; compatibilidade em `tests/support` (`inserirReserva` antigo continua aceito e cria 1 item com serviço do salão), reduzindo a reescrita. |

---

## 8. Estratégia de testes

Tipos: **U** unidade (`src/**`), **I** integração com PostgreSQL real, **C** concorrência ×10 (laço do CLAUDE.md),
**E** Playwright (axe 4.14.0, 375×812 com toque, teclado, sem JS, sem rolagem horizontal), **M** migração em base
dedicada.

| CA | Tipo | Tarefa / arquivo |
|---|---|---|
| CA-1, CA-2 | U+I | T-3 `src/domain/disponibilidade/escolhidos.test.ts`, `tests/integration/disponibilidade/por-servico.test.ts` |
| CA-3 | I | T-3 `tests/integration/disponibilidade/{consultas,plano}.test.ts` (contagem de SQL nos cenários 1/3/10 × 1/8 × 1/14; EXPLAIN ≥ 10 k itens, `[CA-3]`) |
| CA-4 | U+I | T-3 (domínio e serviço) |
| CA-5, CA-7 | U+I | T-5 `src/server/reservas/validacao.test.ts`, `tests/integration/reservas/itens.test.ts` |
| CA-6 | I+E | T-5 (criação), T-10 `tests/integration/reserva-publica/fluxo-itens.test.ts`, T-15 `e2e/publico-reserva.spec.ts` |
| CA-8, CA-9 | U+I | T-10 `src/server/reserva-publica/passos.test.ts`, `tests/integration/reserva-publica/` |
| CA-10 | I+E | T-10 `reescolha`, T-15 `e2e/publico-conflito-captcha.spec.ts` (com e sem JS) |
| CA-11, CA-17, CA-18, CA-22 | C | T-5 `tests/integration/reservas/{idempotencia,concorrencia,travas}.test.ts` (`pg_stat_activity` no caso determinístico) |
| CA-12, CA-13 | E | T-15 `e2e/publico-reserva-teclado.spec.ts`, `e2e/reserva-publica-sem-js.spec.ts` |
| CA-14, CA-31 | I+E | T-5/T-6 (`tests/integration/politica/` por T-8), T-15 `e2e/publico-suspenso.spec.ts` |
| CA-15, CA-16 | I | T-5 `tests/integration/protecao/futuras.test.ts`; T-10 (Turnstile/IP) |
| CA-19, CA-20 | I | T-1 `tests/integration/db/reserva-item-exclusion.test.ts`; T-5 (CA-20 pelo serviço) |
| CA-21 | C | T-6 `tests/integration/reservas/alteracao/concorrencia-itens.test.ts` |
| CA-23, CA-24 | I+E | T-12 `tests/integration/reservas/equipe/itens.test.ts`; T-15 `e2e/reserva-nova*.spec.ts` |
| CA-25..CA-30 | U+I | T-6 `src/server/reservas/status.test.ts`, `tests/integration/reservas/alteracao/{remarcar,cancelar,cancelar-todos,status,permissoes}-itens.test.ts` |
| CA-32..CA-35 | I+E | T-7 `tests/integration/agenda/{itens,visibilidade,limite,consultas}.test.ts`; T-13 vitrines; T-15 `e2e/agenda*.spec.ts` |
| CA-36 | U+E | T-12/T-13 testes de componente; T-15 `e2e/reserva-nova-sem-js.spec.ts`, `e2e/reserva-acoes-sem-js.spec.ts` |
| CA-37..CA-42 | U+I | T-4 `src/server/mensagens/{parametros,elegibilidade}.test.ts`, `tests/integration/mensagens/{itens,vigencia,substituicao}.test.ts` (worker pg-boss real, simulado) |
| CA-43 | U+I | T-4 `src/server/integrations/whatsapp/real.test.ts`, `tests/integration/integracoes/whatsapp-real.test.ts` |
| CA-44 | I | T-6 `tests/integration/reservas/alteracao/convite-itens.test.ts` |
| CA-45 | I | T-8 `tests/integration/avaliacoes/status-derivado.test.ts` |
| CA-46..CA-49 | M | T-1 `tests/integration/db/migracao-itens.test.ts` (base dedicada: aplica as migrações anteriores, insere dados antigos de 1 e 3 itens em todos os status, com encaixe e remarcada, aplica a nova, compara uniões de ocupação e contagens, testa a guarda, executa a reversão extraída do cabeçalho e compara com o retrato inicial; mensagens antigas vigentes) |
| CA-50 | I | cada tarefa de servidor no seu diretório (T-3, T-5, T-6, T-7, T-10, T-12) |
| CA-51 | I+E | T-14 `tests/integration/seed/`, T-15 `e2e/publico-reserva.spec.ts` |
| CA-52 | gate | T-17 |
| Critérios visuais 1–25 do web-design | U+E | T-9/T-11/T-12/T-13 (componentes e vitrines `/dev/*` com axe), T-15 |

Cobertura ≥ 90%: todo módulo puro novo (`itens.ts`, `decisor-encaixe.ts` via integração, `cancelar-todos.ts`,
`passos.ts`, `parametros.ts`, `RoteiroDoDia`) nasce com teste; código removido (APIs antigas) sai junto com seus
testes; nenhuma exclusão nova em `vitest.config.ts`. Medição na T-17; abaixo de 90% vira trabalho da própria T-17.

Fuso: `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/domain/disponibilidade src/server/reservas src/server/mensagens src/server/reserva-publica || break; done`.

Laços de estabilidade (adicionar à tabela do CLAUDE.md, T-16):
`for i in $(seq 10); do npx vitest run --project integration tests/integration/reservas/concorrencia.test.ts tests/integration/reservas/idempotencia.test.ts tests/integration/reservas/travas.test.ts tests/integration/reservas/alteracao/concorrencia-itens.test.ts || break; done`.

---

## 9. Tarefas

Convenção: "posse" = únicos arquivos que a tarefa cria ou altera; arquivos de teste novos listados explicitamente.
Critério comum a toda tarefa de código: testes listados verdes, `npx eslint <arquivos sob posse> --max-warnings=0`
e `npx tsc --noEmit 2>&1 | grep -F -f <lista de arquivos sob posse>` vazio (R-1).

### Rodadas e paralelismo
| Rodada | Tarefas (paralelas entre si) |
|---|---|
| A | T-1 (dba) ∥ T-9 |
| B | T-2 |
| C | T-3 ∥ T-4 ∥ T-8 ∥ T-14 |
| D | T-5 ∥ T-7 |
| E | T-6 ∥ T-10 ∥ T-12 |
| F | T-11 ∥ T-13 |
| G | T-15 → T-16 → T-17 |

### T-1 — Parecer, migração e esquema (dba)
- Dependências: nenhuma.
- Posse: `docs/demandas/D-050/dba.md`; `prisma/migrations/20261127000000_reserva_item_autonomo/migration.sql`;
  `prisma/schema.prisma`; `tests/integration/harness/template.test.ts` (nome da migração em `MIGRACOES`, registrado
  depois da entrega); `tests/integration/db/{reserva-exclusion,isolamento-salao,unicidade,defaults,drift}.test.ts`;
  novos `tests/integration/db/reserva-item-exclusion.test.ts`, `tests/integration/db/migracao-itens.test.ts`,
  `tests/integration/db/planos-itens.test.ts`.
- Entregável: respostas Q1–Q15; migração do §4.4 com guarda e reversão no cabeçalho; schema sem drift; planos do §4.7
  medidos e impressos.
- Conclusão: `npm run db:generate` ok; `npx vitest run --project integration tests/integration/db` verde; CA-19,
  CA-46..CA-49 comprovados; qualquer mudança no desenho volta ao arquiteto antes da T-2.

### T-2 — Núcleo de dados e suporte de teste (desenvolvedor)
- Dependências: T-1.
- Posse: `src/server/repos/{tipos,reserva,servico,profissional}.ts`, `src/server/repos/index.test.ts`;
  `src/server/reservas/itens.ts` + `itens.test.ts` (novo); `src/server/reservas/erros-banco.ts` + `.test.ts`;
  `tests/support/{sql,reservas,factories,mensagens,banco}.ts`.
- Entregável: §3.1, §3.2, §3.3, §3.8; `erros-banco` pelo nome novo; suporte: `inserirReserva` compatível (cria
  reserva + 1 item) e novos `inserirReservaComItens`, `conferirDerivados`; fábricas com itens.
- Conclusão: `npx vitest run src/server/reservas/itens.test.ts src/server/reservas/erros-banco.test.ts src/server/repos/index.test.ts`
  e `npx vitest run --project integration tests/integration/db tests/integration/harness` verdes (inclui
  `tests/integration/db/mensagem-reconciliacao.test.ts`, que volta a verde com o `inserirReserva` compatível).
  `repos/reserva.ts` e (na T-6) `repos/reserva-alteracao.ts` são os ÚNICOS escritores de `reserva_item` no código de
  produção (condição do Q1); `travarParaReserva` em laço com ids distintos ordenados pela string minúscula (Q12).

### T-3 — Disponibilidade por serviço (desenvolvedor)
- Dependências: T-2.
- Posse: `src/domain/disponibilidade/{tipos,calcular}.ts` + testes da pasta (novo `escolhidos.test.ts`);
  `src/server/disponibilidade/{servico,tipos,validacao}.ts` + testes; `src/server/repos/disponibilidade.ts`;
  `tests/integration/disponibilidade/**`.
- Entregável: §3.4, remoção de `consultarDisponibilidade`/`listarProfissionaisElegiveis` (e chamadores ficam para
  T-5/T-10), C3 (`vazioPorConflito`).
- Conclusão: CA-1..CA-4 e CA-50 (disponibilidade) verdes; contagem de 6 SQL; domínio verde nos dois fusos.

### T-4 — Mensagens e WhatsApp (desenvolvedor)
- Dependências: T-2.
- Posse: `src/server/mensagens/**`; `src/server/repos/{mensagem,mensagem-sistema}.ts`;
  `src/server/integrations/whatsapp/{mapeamento,real,simulado}.ts` e seus testes;
  `tests/integration/mensagens/**`, `tests/integration/integracoes/whatsapp-real.test.ts`; `docs/whatsapp-templates.md`;
  `src/worker/handlers/whatsapp-reserva.ts` (só se o contexto exigir).
- Entregável: §3.7 (registro com item, vigência, `PREDICADO_VIGENTE`, `substituirNaoVigentes`, parâmetros,
  `consultarMensagensDaReserva` por item), novo texto sugerido do modelo `confirmacao`.
- Conclusão: CA-37..CA-43 e paridade SQL × pura verdes; `npx vitest run --project integration tests/integration/mensagens` verde.

### T-5 — Criação atômica com N itens (desenvolvedor)
- Dependências: T-3, T-4.
- Posse: `src/server/reservas/{criar-reserva,tipos,validacao,montar-itens}.ts` + testes;
  `src/server/reservas/decisor-encaixe.ts` (novo) + teste; `src/server/reservas/encaixe.ts` (se preciso);
  `src/server/protecao/futuras.ts`; `tests/integration/reservas/*.test.ts` (raiz, inclui novos `itens.test.ts`,
  `travas.test.ts`); `tests/integration/protecao/**`.
- Entregável: §3.5 e §4.6 na criação.
- Conclusão: CA-5, CA-7, CA-11, CA-15, CA-17, CA-18, CA-20, CA-22, CA-50 (criação) verdes; laço ×10 sem falha.

### T-6 — Operações por item (desenvolvedor)
- Dependências: T-4, T-5.
- Posse: `src/server/repos/reserva-alteracao.ts`; `src/server/reservas/{remarcar,cancelar,marcar-status,alterar-status,alteracao-comum,status,tipos-alteracao,reservas-status.acao}.ts` + testes;
  `src/server/reservas/cancelar-todos.ts` (novo); `src/server/auth/permissoes.ts` + teste (operação
  `reserva.cancelar_todos`); `tests/integration/reservas/alteracao/**`.
- Entregável: §3.6 (inclui RN-33 convite, substituição, derivados, `travarParaReserva` de serviço removido quando sem uso).
- Conclusão: CA-21, CA-25..CA-31, CA-38 (pelo fluxo), CA-42, CA-44 verdes; `conferirDerivados` em todos; laço ×10.

### T-7 — Agenda (servidor) (desenvolvedor)
- Dependências: T-4 (`PREDICADO_VIGENTE`).
- Posse: `src/server/repos/agenda.ts`; `src/server/agenda/**`; `tests/integration/agenda/**` (exceto arquivos
  `d050-ui-*` da T-13).
- Entregável: §3.9.
- Conclusão: CA-32..CA-35 (servidor), CA-50 (agenda) verdes; 6 instruções; plano da agenda impresso.

### T-8 — Leitores restantes e regressão (desenvolvedor)
- Dependências: T-2.
- Posse: `src/server/repos/cliente.ts`; `src/server/clientes/{servico,tipos}.ts` + testes;
  `src/app/painel/clientes/[id]/**`; `src/app/dev/clientes/**`;
  `tests/integration/{clientes,profissionais,bloqueios,avaliacoes,denuncias,consentimento,convites,tenant,salao,politica,concorrencia,fila,worker}/**`.
- Entregável: histórico por reserva com itens e total RN-35; `cliente.contato` por item (RN-38); testes desses
  módulos no modelo novo; CA-45.
- Conclusão: `npx vitest run --project integration` nesses diretórios verde.

### T-9 — Componentes compartilhados (desenvolvedor)
- Dependências: nenhuma (só o web-design).
- Posse: `src/components/ui/RoteiroDoDia.tsx`, `RoteiroDoDia.module.css`, `RoteiroDoDia.test.tsx` (novos);
  `src/components/ui/SlotGrid.{tsx,module.css,test.tsx}`; `src/app/dev/componentes/**`.
- Entregável: web-design §4.1–4.2, sem `@/server` em `src/components`.
- Conclusão: testes de componente e de conformidade de CSS verdes; `e2e/a11y-base.spec.ts` verde na vitrine.

### T-10 — Fluxo público (servidor) (desenvolvedor)
- Dependências: T-3, T-5.
- Posse: `src/server/reserva-publica/**`; `src/server/repos/publico.ts` (`lerRotulosDaReserva`);
  `tests/integration/reserva-publica/**`; `tests/support/reserva-publica.ts`.
- Entregável: §3.10.
- Conclusão: CA-6 (servidor), CA-8..CA-10, CA-14, CA-16, CA-50 (público) verdes.

### T-11 — Fluxo público (UI) (desenvolvedor)
- Dependências: T-9, T-10.
- Posse: `src/app/(publico)/[slug]/{acoes.ts,estado.ts,formulario.ts,formulario.test.ts,page.tsx}`;
  `src/app/(publico)/[slug]/_componentes/{Passos,FormularioDados,PaginaDoSalao,Salao.module.css,FiltroDeProfissional}*`
  e testes; `src/app/dev/reserva/**`.
- Entregável: web-design §5.1–5.7, critérios 7–16.
- Conclusão: testes de componente/casca verdes; vitrine `/dev/reserva` nas vistas `reescolha`, `confirmada`, `conflito`.

### T-12 — Nova reserva da equipe (desenvolvedor)
- Dependências: T-5, T-9.
- Posse: `src/server/reservas/{reserva-equipe,reservas-equipe.acao}.ts` + testes; `src/app/painel/agenda/nova/**`
  (inclui `LinhaDeItem.tsx` novo); `src/app/dev/reserva-nova/**`; `tests/integration/reservas/equipe/**`.
- Entregável: §3.11, web-design §5.8, critérios 23–25, C5.
- Conclusão: CA-23, CA-24, CA-36 (componente) verdes.

### T-13 — Agenda e detalhe (UI) (desenvolvedor)
- Dependências: T-6, T-7, T-9.
- Posse: `src/app/painel/agenda/{page.tsx,_componentes/**}`; `src/app/painel/agenda/reservas/[id]/**`;
  `src/app/dev/{agenda,reserva-acoes,mensagens-reserva}/**`; novos `tests/integration/agenda/d050-ui-*.test.ts`.
- Entregável: web-design §5.9–5.10, C2, critérios 17–22.
- Conclusão: testes de componente e de páginas verdes; vitrines com axe sem violação.

### T-14 — Seed e suporte do E2E (desenvolvedor)
- Dependências: T-2.
- Posse: `prisma/seed.ts`, `prisma/seed/**` (inclui `plano.ts`, que cita colunas removidas); `e2e/suporte/**` (inclui
  `fixtures.ts`, idem); `tests/integration/seed/**`. Seed e fixtures gravam `reserva.status/inicio/fim` coerentes com
  os itens (mesma regra de `derivarReserva`; condição do Q1) e são verificados com `conferirDerivados`.
- Entregável: reserva de 3 itens em 3 profissionais (manhã e tarde) no salão A; fixtures por item; complemento E2E.
- Conclusão: CA-51 (seed) verde; seed idempotente.

### T-15 — Specs E2E (desenvolvedor)
- Dependências: T-11, T-12, T-13, T-14.
- Posse: `e2e/a11y-base.spec.ts` (linha 296: `toBe(8)` → `toBe(12)`, a vitrine da T-9 ganhou 4 rádios);
  `e2e/{publico-reserva,publico-reserva-teclado,publico-conflito-captcha,publico-suspenso,reserva-publica,reserva-publica-sem-js,reserva-nova,reserva-nova-sem-js,agenda,agenda-sem-js,reserva-acoes,reserva-acoes-sem-js,mensagens-situacao,mensagens-situacao-sem-js}.spec.ts`.
- Conclusão: `npm run test:e2e` verde (uma execução por vez); CA-6, CA-10, CA-12, CA-13, CA-14, CA-36, CA-51 e
  critérios visuais 3–6 comprovados.

### T-16 — Documentação (desenvolvedor)
- Dependências: T-1..T-15.
- Posse: `CLAUDE.md` (invariante "Multi-service bookings…" substituída; parágrafo D-050; linhas de comandos/laços;
  ajustes pontuais nos parágrafos D-018/D-025/D-028/D-030/D-043 que citam APIs removidas); `PLAN.md` (linha 41,
  critério 2); `docs/trinks-alinhamento.md` (se citar o modelo antigo); `README.md` **apenas** nas seções sobre o
  modelo `confirmacao`/WhatsApp e reservas, preservando todo o conteúdo e as alterações locais do usuário (editar com
  Edit pontual, nunca reescrever o arquivo; não tocar `docs/GUIA_TESTES_LOCAIS.md`).
- Conclusão: teste de documentação (`tests/integration/integracoes/documentacao.test.ts`) verde; diff do README
  restrito às seções citadas. O líder confirma a edição do CLAUDE.md.

### T-17 — Gate final (desenvolvedor) → tester
- Dependências: T-16.
- Posse: nenhuma (só correções de cobertura acordadas com o líder).
- Conclusão: `npm run lint`, `npm run typecheck`, `npm run build` (numa cópia se houver `next dev` do usuário),
  `npm run test:coverage` ≥ 90%, `npm run test:e2e`, laços ×10 do §8 e testes em dois fusos verdes; evidências em
  `docs/demandas/D-050/dev.md`.

Todo CA da spec está mapeado no §8 a uma tarefa e a um tipo de teste. Nenhuma tarefa da mesma rodada compartilha
arquivo (os diretórios de teste de módulos estão repartidos por posse; `repos/tipos.ts` é só da T-2). Nenhuma
ferramenta ou dependência nova.

---

## Revisão 1 (23/11/2026) — mudanças do DBA após a T-1

Parecer: `docs/demandas/D-050/dba.md` (Q1–Q15 respondidas; Q14 = 0 casos, R-4 sem efeito nos dados existentes).
Todas as mudanças M-1..M-6 foram **aceitas**; nenhuma altera interface pública do §3.

| Mudança | Decisão | Onde refletiu |
|---|---|---|
| M-1 sem `UNIQUE (salao_id, id)` em `reserva_item` | Aceita (nenhuma FK o usa) | §4.1 |
| M-2 `duracao_min <= 1440` e margem `interval '1 day'` | Aceita | §4.1, §3.9; T-7 usa a margem de 1 dia e mantém o teste de plano |
| M-3 guarda com 4 contagens e mensagem fixa | Aceita | §4.4 |
| M-4 `PREDICADO_VIGENTE` concreto, sem `reserva_item_id`, confirmação sem revisão | Aceita; é exatamente a regra do §3.7. T-4 copia o SQL do `dba.md` §3 para `repos/mensagem.ts` e prova paridade com `conferirVigencia`; T-7 importa o fragmento (nunca copia) | §3.7, T-4, T-7 |
| M-5 `servico_repetido` considera itens cancelados | Aceita | §3.6, T-6 (teste: troca para serviço de item cancelado → `recusado/servico_repetido`, sem 23505) |
| M-6 exclusion por profissional dispara primeiro | Aceita; reforça que `conferirItens` roda antes de qualquer INSERT/UPDATE (T-5 passo 6; T-6 remarcação). Teste em T-5: dois itens do mesmo profissional cruzados na mesma reserva → `horario_indisponivel` causa `entre_itens`, nunca 23P01 | §3.5, T-5, T-6 |

Posse registrada nesta revisão: `tests/integration/harness/template.test.ts` → T-1 (já editado); `e2e/a11y-base.spec.ts`
→ T-15; `prisma/seed/plano.ts` e `e2e/suporte/fixtures.ts` → T-14 (já cobertos por `prisma/seed/**` e
`e2e/suporte/**`). Pendências da T-1 que passam à T-2: `inserirReserva` compatível e typecheck de repos/testes (R-1).

**A T-2 está liberada.**
