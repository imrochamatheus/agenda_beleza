# D-016 — Desenho: bloqueios do profissional e do salão inteiro (issue #19, E2.4)

Entradas: `docs/demandas/D-016/spec.md` (RN-1..RN-19, CA-1..CA-23, D-1..D-14), `issue-19.md`, `CLAUDE.md`, `docs/demandas/D-015/design.md` (padrão de módulo, página de demonstração para o E2E sem banco, travas) e `docs/demandas/D-014/design.md` §3.2 (ordem canônica de travas). Código lido: `src/server/auth/{permissoes,pagina}.ts`, `src/server/repos/{index,transacao,reserva,jornada,tipos}.ts`, `src/server/tenant/{context,define-acao}.ts`, `src/server/jornadas/jornadas.acao.ts`, `src/server/profissionais/tipos.ts` (`ROTULO_CLIENTE_REMOVIDA`), `src/app/painel/profissionais/[id]/jornada/acoes.ts`, `src/app/dev/jornada/page.tsx`, `src/lib/{format.ts,format.fonte-unica.test.ts}`, `src/config/navegacao.ts`, `prisma/schema.prisma` (`Bloqueio`, `Reserva`, `Cliente`), `prisma/migrations/20261118000100_reserva_exclusion/migration.sql`, `prisma/migrations/20261118000200_restricoes_sql/migration.sql:129-135` e `tests/support/factories.ts`.

## 0. Verificações feitas antes do desenho

- **O esquema basta.** A tabela `bloqueio`, a FK composta `(salao_id, profissional_id)`, a CHECK `bloqueio_ordem_chk (fim > inicio)` e o índice GiST `bloqueio_periodo_idx (salao_id, tstzrange(inicio, fim, '[)'))` já existem (D-004). Nenhuma migração.
- **Índices para a consulta de reservas cobertas (spec §8 a), conferidos com `EXPLAIN` somente leitura na base local** (`BEGIN READ ONLY`, `enable_seqscan=off`, `plan_cache_mode=force_generic_plan`):
  - Bloqueio de profissional: `WHERE r.salao_id=$1 AND r.profissional_id=$2 AND r.status='confirmado' AND tstzrange(r.inicio, r.ocupado_ate,'[)') && tstzrange($3,$4,'[)') AND r.inicio < $4 AND r.fim > $3` → `Index Scan using reserva_sem_sobreposicao` (o índice parcial da exclusion constraint) com `Index Cond: (profissional_id = $2) AND (tstzrange(...) && ...)`. O planejador prova que `status = 'confirmado'` implica o predicado `status IN ('confirmado','concluido','nao_compareceu')` do índice, **desde que o literal `'confirmado'` esteja no texto do SQL** (não como parâmetro).
  - Bloqueio de salão: `profissional p JOIN reserva r ON (r.salao_id, r.profissional_id) = (p.salao_id, p.id)` com o mesmo predicado → também usa `reserva_sem_sobreposicao` (condição de intervalo) e `profissional_salao_id_id_key`.
  - O predicado `tstzrange(inicio, ocupado_ate) && periodo` é um **superconjunto** do exato (`fim <= ocupado_ate`), por isso o filtro exato `r.inicio < $fim AND r.fim > $inicio` (sem `ocupado_ate`, spec D-7) fica junto.
  - Leitura de bloqueios por período (`tstzrange(b.inicio, b.fim,'[)') && tstzrange($de,$ate,'[)')`) → `Index Scan using bloqueio_periodo_idx`.
- **Fuso do salão não está no contexto.** `TenantContext` só traz ids. É preciso ler `salao.fuso` por um repositório (não há repositório de salão para isso hoje).
- **`Intl.DateTimeFormat` é proibido em `src/lib/` (exceto `format.ts`), `app/`, `components/` e `config/`** (`format.fonte-unica.test.ts`), mas permitido em `src/server/` "para cálculo". Por isso a conversão hora local → UTC fica em `src/server/`, e não em `src/lib/`.
- **Prova de conceito da conversão** (Node 24, só `Intl`): o algoritmo de §3.1 produziu exatamente os seis resultados do CA-6 e os do CA-3/CA-5 (`2026-12-25T03:00Z/2026-12-26T03:00Z`; `2018-11-04T03:00Z/2018-11-05T02:00Z`; `2018-02-17T02:00Z/2018-02-18T03:00Z`; NY `07:00Z` e `05:30Z`; 22:00 SP → `2026-12-26T01:00Z`; Manaus 10:00 → `14:00Z`; `Foo/Bar` → `RangeError`).
- **Travas:** `INSERT` em `bloqueio` com `profissional_id` toma `FOR KEY SHARE` na linha do profissional (FK), que conflita com o `FOR UPDATE` da desativação (D-013) e serializa as duas, sem ciclo (a desativação não toca `bloqueio`). `UPDATE` de `inicio/fim/motivo` (colunas que não são chave) e `DELETE` em `bloqueio` não travam `profissional`.
- **Registro de ações:** `tests/integration/tenant/registro.test.ts` usa `import.meta.glob('/src/**/*.acao.ts')`, então enxerga `bloqueios.acao.ts` sem mudança. A matriz de permissões já tem `bloqueio_profissional.gerir` e `bloqueio_salao.gerir` com os escopos da RN-12: **`permissoes.ts` não muda**.
- **A fábrica** cria um bloqueio do profissional ativo por salão (`instanteFuturo(8, 13..15)`, motivo "Curso") e uma reserva `confirmado` em `instanteFuturo(7, 13)`. Os testes contam com essas linhas (listas e aviso) ou as apagam por SQL no `apoio.ts` da demanda. **`tests/support/**` não muda.**
- **O job `e2e` roda sem PostgreSQL** e sem sessão real; o padrão é a página de demonstração (D-015 D-11).
- `ROTAS.bloqueios` e os itens de navegação do gestor e do profissional já existem.

## 1. Resumo da solução

1. **Utilitário de domínio de fuso** `src/server/tempo/fuso.ts` (puro, só `Intl`, sem dependência nova): `instanteDeHoraLocal`, `intervaloDeDiasInteiros`, `partesLocais`, `ehDiaInteiro`, aritmética de data civil. Reutilizável pela E3.1.
2. **Repositório** `src/server/repos/bloqueio.ts` (novo, em `Repos.bloqueios`): fuso do salão, profissionais do salão (para o alvo), CRUD com `FOR UPDATE OF b` na edição e remoção, lista vigente e leitura por período (GiST). Em `repos/reserva.ts`, `listarConfirmadasQueCruzam` (GiST da exclusion; nome da cliente, nunca o telefone).
3. **Domínio puro** `src/server/bloqueios/{tipos,validacao,apresentacao}.ts`: lê e valida os campos (datas `dd/mm/aaaa`, horas `HH:MM`, modo, motivo), converte no fuso e aplica RN-4..RN-7; monta itens de lista e valores de edição.
4. **Serviço** `src/server/bloqueios/servico.ts`: `listar`, `obterParaEdicao`, `opcoesDeAlvo`, `criar`, `editar`, `remover`. **Leitura** `leitura.ts`: `lerBloqueios` sem checagem de papel, para E3.1/E3.3.
5. **Ações** `src/server/bloqueios/bloqueios.acao.ts`: `criarBloqueio`, `editarBloqueio`, `removerBloqueio`, todas `{ papeis: ['gestor', 'profissional'], capacidade: 'configurar' }`.
6. **Telas** `src/app/painel/bloqueios/` (lista + formulário de criação) e `src/app/painel/bloqueios/[id]/` (edição). Criação e edição devolvem o **aviso de reservas cobertas no estado da ação** (sem PRG), o que funciona sem JS. A remoção é um `<form>` por item com PRG.
7. **Formatação** em `src/lib/format.ts`: `formatarPeriodoBloqueio`.
8. **E2E sem banco:** página `/dev/bloqueios` (desligada sem `VITRINE_COMPONENTES=true`) com os mesmos componentes e ações de demonstração que só validam (padrão D-015 D-11).

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Conversão em `src/lib/` | `format.fonte-unica.test.ts` proíbe `Intl.DateTimeFormat` em `src/lib/` fora de `format.ts`; abrir exceção enfraquece a regra da D-009. `src/server/tempo/` é domínio de servidor, que é onde a E3.1 vai usar. |
| Conversão dentro de `format.ts` | `format.ts` é só exibição (spec §8). |
| Dependência nova (`date-fns-tz`, `luxon`, `@js-temporal/polyfill`) | `Intl` resolve, provado pela PoC (§0). Além disso, o "compatible" do Temporal/luxon leva 02:30 inexistente a **03:30**, e a spec (RN-3, CA-6 d) exige **03:00** (primeiro instante válido); precisaríamos de código próprio de qualquer jeito. |
| Conversão por soma de 24 h por dia | Quebra nos dias de 23/25 h (RN-2, CA-6 b/c). |
| Índice novo em `reserva` para a intersecção | O GiST parcial da exclusion já atende (§0). Sem DDL, sem DBA. |
| Consulta de reservas cobertas via Prisma (`inicio: { lt }, fim: { gt }`) | Usa o btree `(salao_id, profissional_id, inicio)` só pelo lado `inicio < fim`, varrendo todo o passado do profissional. O SQL bruto com `&&` usa o GiST. |
| Status como parâmetro (`${'confirmado'}`) no SQL | Com plano genérico o planejador não prova a implicação com o predicado do índice parcial. O literal fica no texto. |
| Aviso **antes** de gravar (confirmação em dois passos) | A spec D-7 decide que o aviso é posterior. Dois passos sem JS exigiriam estado intermediário. |
| PRG (`redirect`) após criar/editar, como na jornada | O aviso lista reservas e precisaria ir pela URL ou por cookie. O estado de `useActionState` funciona sem JS (aprimoramento progressivo: a página é renderizada na mesma resposta do POST, com a lista já atualizada) e carrega o aviso. |
| `<input type="date">`/`type="time"` | O seletor varia por navegador e locale, o teclado no Playwright é frágil em campos segmentados e a D-015 já adotou texto com `pattern`. O formato `dd/mm/aaaa` é o mesmo de `formatarData`, o que permite preencher a edição com `format.ts`. |
| Dois conjuntos de campos (um por modo) mostrados/ocultados por JS | Não funciona sem JS. Um único conjunto (data/hora de início, data/hora de fim) + rádio de modo; no modo dia inteiro as horas são ignoradas (spec §6). |
| Trava explícita no profissional ao criar bloqueio | O `FOR KEY SHARE` implícito da FK já serializa com a desativação; nenhuma regra depende do estado `ativo` (RN-14). |
| Sem trava na edição/remoção (só `updateMany`/`deleteMany`) | A decisão 403 × 404 exige ler o dono antes; sem `FOR UPDATE` a leitura e a escrita poderiam ver linhas diferentes. Com `FOR UPDATE OF b` a segunda remoção concorrente espera e vê 0 linhas → 404 (CA-20). |
| Página de confirmação para remover | Bloqueio é removível e recriável (RN-3 da issue); um passo extra sem JS dobra o fluxo do CA-21/22. |
| Coluna `dia_inteiro` em `bloqueio` | Seria DDL e redundante: `ehDiaInteiro` deriva do instante e do fuso (spec §6: indiferente para o banco). |

### 1.2 Dependências novas

Nenhuma. Usa `zod`, `Intl`, `next/cache`, `next/navigation`, `next/link` e `src/components/ui/` (`Field`, `ErroDoCampo`, `Alert`, `Button`, `Select` se servir; senão `<select>` nativo estilizado no CSS do módulo).

## 2. Componentes afetados

| Caminho | Mudança |
|---|---|
| `src/server/tempo/fuso.ts` (+ `fuso.test.ts`) (novo) | conversão hora local ↔ UTC (§3.1) |
| `src/lib/format.ts` (+ `format.test.ts`) | `formatarPeriodoBloqueio` (§3.5) |
| `src/config/navegacao.ts` (+ `.test.ts`) | `ROTAS.bloqueio(id) = /painel/bloqueios/<id>`, `ROTAS.devBloqueios = '/dev/bloqueios'` |
| `src/server/bloqueios/tipos.ts` (novo) | contratos, limites, mensagens; client-safe |
| `src/server/bloqueios/validacao.ts` (+ `.test.ts`) (novo) | leitura dos campos e resolução do período (puro) |
| `src/server/bloqueios/apresentacao.ts` (+ `.test.ts`) (novo) | item de lista, reserva coberta e valores de edição (puro) |
| `src/server/repos/bloqueio.ts` (novo), `repos/reserva.ts`, `repos/index.ts`, `repos/tipos.ts`, `repos/index.test.ts` | `RepoBloqueio`; `RepoReserva.listarConfirmadasQueCruzam` |
| `src/server/bloqueios/servico.ts`, `leitura.ts`, `bloqueios.acao.ts` (novos) | serviço, leitura para E3.1/E3.3, ações |
| `src/app/painel/bloqueios/**` (novo) | lista, formulário, aviso, casca, páginas |
| `src/app/dev/bloqueios/**` (novo) | demonstração para o E2E |
| `e2e/bloqueios.spec.ts`, `e2e/bloqueios-sem-js.spec.ts` (novos) | CA-21, CA-22 |
| `README.md` | seção curta "Bloqueios" |

Nada muda em `prisma/**`, `.env.example`, `docker-compose.yml`, `.github/**`, `src/proxy.ts`, `src/server/tenant/**`, `src/server/auth/**`, `src/components/**`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts` nem `tests/support/**`.

## 3. Interfaces

### 3.1 Fuso (`src/server/tempo/fuso.ts`) — puro, só `Intl`

```ts
/** Data de calendário sem fuso. mes 1..12. */
export type DataCivil = { readonly ano: number; readonly mes: number; readonly dia: number };

/** '' , não-string ou zona desconhecida pelo Intl → RangeError('Fuso horário inválido: "<x>"'). Devolve o próprio fuso. */
export function validarFuso(fuso: unknown): string;
/** Inteiros, ano 1900..2999, mês 1..12, dia válido no mês (bissexto). */
export function ehDataCivilValida(d: DataCivil): boolean;
/** Aritmética de calendário via Date.UTC (n pode ser negativo). */
export function somarDias(d: DataCivil, n: number): DataCivil;
/** d2 − d1 em dias de calendário. */
export function diferencaEmDias(d1: DataCivil, d2: DataCivil): number;
export function compararDatas(a: DataCivil, b: DataCivil): -1 | 0 | 1;

/**
 * Instante UTC da hora de parede `minutosDoDia` (0..1439, inteiro) na data `data` no `fuso`.
 * RN-3: hora inexistente (salto) → primeiro instante válido depois do salto (o instante da transição);
 *       hora repetida (recuo) → PRIMEIRA ocorrência (o menor instante).
 * Data inválida, minutos fora de 0..1439 ou fuso inválido → RangeError.
 */
export function instanteDeHoraLocal(data: DataCivil, minutosDoDia: number, fuso: string): Date;

/** RN-2: [00:00 local de d1, 00:00 local de d2+1), por calendário. d2 < d1 → RangeError. */
export function intervaloDeDiasInteiros(d1: DataCivil, d2: DataCivil, fuso: string): { inicio: Date; fim: Date };

/** Data civil e minutos do dia (0..1439) do instante no fuso. Inversa parcial (para E3.1 e ehDiaInteiro). */
export function partesLocais(instante: Date, fuso: string): { data: DataCivil; minutosDoDia: number };

/**
 * true se inicio === 00:00 local da sua data e fim === 00:00 local da sua data (pela mesma regra RN-3,
 * isto é, inicio === instanteDeHoraLocal(partesLocais(inicio).data, 0)). Usado só para exibição.
 */
export function ehDiaInteiro(inicio: Date, fim: Date, fuso: string): boolean;
```

**Algoritmo de `instanteDeHoraLocal`** (validado na PoC, §0):
1. `W = Date.UTC(ano, mes−1, dia, 0, minutos)` (a hora de parede lida como se fosse UTC).
2. `desloc(t)` = (partes de `t` no fuso, por `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year/month/day/hour/minute/second: 'numeric' }).formatToParts`, remontadas com `Date.UTC`) − `t`. Hora `'24'` vira `0`. Formatadores em cache por fuso (`Map`).
3. Candidatos: os deslocamentos distintos de `desloc(W − 1 dia)` e `desloc(W + 1 dia)`; para cada `o`, `t = W − o` é válido se `desloc(t) === o`.
4. Se houver válido: devolve o **menor** `t` (primeira ocorrência).
5. Se nenhum (salto): `oDepois = desloc(W + 1 dia)`; busca binária com passo de 1 minuto entre `W − oDepois` e `W − desloc(W − 1 dia)` pelo menor `t` com `desloc(t) === oDepois` (o instante da transição).
- Premissa documentada no cabeçalho: no máximo uma transição em ±24 h do instante (verdade para todo o tzdata pós-1970). Testado com SP, NY, Manaus, `UTC` e `Asia/Kolkata` (+05:30).

### 3.2 Contratos (`src/server/bloqueios/tipos.ts`) — client-safe

Sem import de runtime de `@/server/**`.

```ts
export const LIMITES_BLOQUEIO = Object.freeze({
  passoMin: 5,                       // RN-4 (D-3)
  duracaoMaxMs: 366 * 24 * 60 * 60_000, // RN-7, modo com horário (medido em UTC)
  diasInteirosMax: 366,              // RN-7, modo dia inteiro (número de datas)
  antecedenciaMaxMs: 730 * 24 * 60 * 60_000, // RN-7: "2 anos" = 730 × 24 h (D-15)
  motivoMax: 200,                    // RN-15 (UTF-16, igual a maxLength)
  campoMaxCaracteres: 20,            // teto do texto bruto de data/hora antes da regex
  avisoMax: 100,                     // itens do aviso (D-18)
});

export type ModoBloqueio = 'horario' | 'dia_inteiro';
export const ALVO_SALAO = 'salao';

export type CampoBloqueio =
  | 'alvo' | 'modo' | 'dataInicio' | 'horaInicio' | 'dataFim' | 'horaFim' | 'motivo' | 'periodo' | 'formulario';
export type ErrosBloqueio = Partial<Record<CampoBloqueio, string>>;

/** Textos crus do formulário (o que a casca lê e o que volta para o formulário). */
export type ValoresBloqueio = {
  alvo: string; modo: string; dataInicio: string; horaInicio: string; dataFim: string; horaFim: string; motivo: string;
};

export type EntradaPeriodoBloqueio = {
  modo: unknown; dataInicio: unknown; horaInicio?: unknown; dataFim: unknown; horaFim?: unknown; motivo?: unknown;
};
/** alvo: 'salao' | id do profissional. Para o papel profissional, opcional (alvo = próprio perfil). */
export type EntradaCriarBloqueio = EntradaPeriodoBloqueio & { alvo?: unknown };
/** Sem alvo: nível e dono são imutáveis (RN-11). Chave extra (alvo, profissionalId, salaoId) → 'formulario'. */
export type EntradaEditarBloqueio = EntradaPeriodoBloqueio & { id: unknown };
export type EntradaRemoverBloqueio = { id: unknown };

export type AlvoBloqueio = { tipo: 'salao' } | { tipo: 'profissional'; id: string; nome: string; ativo: boolean };

/** Item da lista (RN-18) e cabeçalho da edição. */
export type BloqueioItem = {
  id: string;
  alvo: AlvoBloqueio;
  inicio: string;            // ISO UTC (serializável para o cliente)
  fim: string;
  diaInteiro: boolean;
  periodo: string;           // formatarPeriodoBloqueio no fuso do salão
  motivo: string | null;
  editavel: boolean;         // gestor: sempre; profissional: só os próprios (D-10)
};

export type ReservaCoberta = {
  id: string; profissionalNome: string; inicioLocal: string; fimLocal: string; // formatarDataHora no fuso
  cliente: string;           // nome ou ROTULO_CLIENTE_REMOVIDA
};
export type AvisoReservas = { reservas: ReservaCoberta[]; total: number }; // total pode exceder avisoMax

export type ResultadoSalvarBloqueio =
  | { resultado: 'salvo'; bloqueio: BloqueioItem; aviso: AvisoReservas }
  | { resultado: 'invalido'; erros: ErrosBloqueio };
export type ResultadoRemoverBloqueio = { resultado: 'removido'; id: string };

export type OpcaoAlvo = { valor: string; rotulo: string }; // 'salao' → 'Salão inteiro'; inativo → 'Bia (inativa/o)'

export const MENSAGENS_BLOQUEIO = Object.freeze({
  alvo: 'Escolha o salão inteiro ou um profissional.',
  modo: 'Escolha "Com horário" ou "Dia inteiro".',
  data: 'Informe a data no formato dd/mm/aaaa (ex.: 25/12/2026).',
  dataInexistente: 'Esta data não existe no calendário.',
  hora: 'Informe a hora no formato HH:MM, de 00:00 a 23:55 (ex.: 14:00).',
  granularidade: 'Use minutos múltiplos de 5 (ex.: 14:05).',
  ordem: 'O fim precisa ser depois do início.',
  ordemDias: 'A data final não pode ser anterior à inicial.',
  passado: 'O bloqueio precisa terminar depois de agora.',
  duracao: 'O bloqueio pode durar no máximo 366 dias.',
  antecedencia: 'O início pode estar no máximo 2 anos à frente.',
  motivo: 'Use no máximo 200 caracteres no motivo.',
  formulario: 'Não foi possível ler os dados enviados. Recarregue a página e tente de novo.',
  resumoErros: 'Corrija os campos indicados para salvar o bloqueio.',
  ajudaPeriodo: 'Horário local do salão. Com horário: datas dd/mm/aaaa e horas HH:MM em múltiplos de 5 minutos; pode passar da meia-noite. Dia inteiro: da data de início até o fim da data de fim; as horas são ignoradas.',
  salvo: 'Bloqueio salvo.',
  removido: 'Bloqueio removido.',
  semReservas: 'Nenhuma reserva confirmada fica sob este bloqueio.',
  comReservas: 'Atenção: estas reservas confirmadas ficam sob o bloqueio. Elas não foram alteradas nem canceladas, e as clientes não foram avisadas.',
  maisReservas: (n: number) => `E mais ${n} reserva(s) não listada(s).`,
  salaoInteiro: 'Salão inteiro',
  inativo: '(inativo)',
  somenteLeitura: 'Bloqueio do salão: só o gestor altera.',
  vazio: 'Nenhum bloqueio vigente ou futuro.',
  naoEncontrado: 'Bloqueio não encontrado. Ele pode já ter sido removido.',
  acessoNegado: 'Acesso negado.',
});
```

### 3.3 Repositórios

Todo método chama `exigirEscopo(ctx)`; id que não é UUID → `NaoEncontrado` sem consultar (mesmo padrão `escopoEId` da D-015).

```ts
// repos/tipos.ts
export type BloqueioDTO = {
  id: string; profissionalId: string | null; inicio: Date; fim: Date; motivo: string | null;
  profissional: { id: string; nome: string; ativo: boolean } | null;
};
export type ProfissionalAlvoDTO = { id: string; nome: string; ativo: boolean };
export type ReservaCobertaDTO = {
  id: string; profissionalId: string; profissionalNome: string; inicio: Date; fim: Date;
  clienteNome: string | null;          // null = anonimizada; o telefone NUNCA é selecionado
};
export type DadosBloqueio = { profissionalId: string | null; inicio: Date; fim: Date; motivo: string | null };
export type FiltroBloqueios = { todos: true } | { profissionalId: string }; // proprio = do profissional + do salão
```

```ts
// repos/bloqueio.ts
export interface RepoBloqueio {
  /** SELECT fuso FROM salao WHERE id = salão do contexto. Sem linha → NaoEncontrado. */
  fusoDoSalao(ctx): Promise<string>;
  /** Profissional do salão (ativo OU inativo, RN-14). NaoEncontrado para B/inexistente/malformado. */
  buscarProfissional(ctx, id: string): Promise<ProfissionalAlvoDTO>;
  /** Todos os profissionais do salão: ativo desc, nome, id (opções do alvo, spec §6). */
  listarProfissionais(ctx): Promise<ProfissionalAlvoDTO[]>;
  /** INSERT com salao_id do contexto. Devolve o DTO com o profissional. */
  criar(ctx, d: DadosBloqueio): Promise<BloqueioDTO>;
  /** Sem trava (página de edição). NaoEncontrado se não é do salão. */
  buscar(ctx, id: string): Promise<BloqueioDTO>;
  /**
   * SELECT b.id … FROM bloqueio b WHERE b.id = $id::uuid AND b.salao_id = $salao::uuid FOR UPDATE OF b
   * (+ leitura do profissional sem trava). Sem linha → NaoEncontrado. Só dentro de emTransacao.
   * O texto "FOR UPDATE OF b" é o marcador procurado em pg_stat_activity pela T-6.
   */
  travar(ctx, id: string): Promise<BloqueioDTO>;
  /** updateMany { id, salaoId } → { inicio, fim, motivo }; 0 → NaoEncontrado. Nunca altera profissional_id. */
  atualizarPeriodo(ctx, id: string, d: { inicio: Date; fim: Date; motivo: string | null }): Promise<BloqueioDTO>;
  /** deleteMany { id, salaoId }; 0 → NaoEncontrado. */
  remover(ctx, id: string): Promise<void>;
  /**
   * RN-18: fim > agora; filtro 'todos' → salão inteiro + todos os profissionais; { profissionalId } →
   * profissional_id = $p OR profissional_id IS NULL. Ordem: inicio, id. Prisma findMany (btree
   * (salao_id, profissional_id)); volume por salão pequeno (§4).
   */
  listarVigentes(ctx, agora: Date, filtro: FiltroBloqueios): Promise<BloqueioDTO[]>;
  /**
   * Bloqueios que intersectam [de, ate) — `tstzrange(b.inicio, b.fim,'[)') && tstzrange($de,$ate,'[)')`
   * (usa bloqueio_periodo_idx). opcoes.profissionalId → os dele + os do salão; sem → todos do salão.
   * Ordem: inicio, id. $queryRaw.
   */
  listarNoPeriodo(ctx, periodo: Periodo, opcoes?: { profissionalId?: string }): Promise<BloqueioDTO[]>;
}
```

```ts
// repos/reserva.ts — acréscimo
/**
 * RN-8: reservas `confirmado` do salão com [inicio, fim) && [de, ate) (sem ocupado_ate, spec D-7);
 * profissionalId → só dele; null → de todos os profissionais do salão. Ordem: inicio, id.
 * LIMIT `limite`; `total` = count(*) OVER () (número completo, mesmo acima do limite).
 * SQL bruto: o literal 'confirmado' e o predicado redundante
 *   tstzrange(r.inicio, r.ocupado_ate, '[)') && tstzrange($de, $ate, '[)')
 * ficam NO TEXTO para o planejador usar o índice parcial reserva_sem_sobreposicao (§0). Não trocar por
 * parâmetro. Seleciona c.nome (LEFT JOIN não é necessário: FK obrigatória) e NUNCA c.telefone_e164.
 * profissionalId malformado → NaoEncontrado sem consultar.
 */
listarConfirmadasQueCruzam(
  ctx: ContextoEscopado,
  periodo: Periodo,
  profissionalId: string | null,
  limite: number,
): Promise<{ reservas: ReservaCobertaDTO[]; total: number }>;
```
- Forma da consulta: `FROM reserva r JOIN profissional p ON p.salao_id = r.salao_id AND p.id = r.profissional_id JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id WHERE r.salao_id = $salao AND r.status = 'confirmado' AND tstzrange(...) && ... AND r.inicio < $ate AND r.fim > $de [AND r.profissional_id = $p]`. Duas variantes de texto (com e sem `profissional_id`), nunca `$p IS NULL OR …` (estraga o plano).
- `Repos` ganha `bloqueios: RepoBloqueio`; `criarRepos` liga `criarRepoBloqueio(db)`.

**Ordem de travas** (cabeçalho de `repos/bloqueio.ts`, estendendo D-014 §3.2/D-015 D-12):
```
profissional (FOR UPDATE | FOR NO KEY UPDATE | FOR SHARE | FOR KEY SHARE implícito de FK)
  → servico(s) → servico_profissional / jornada / reserva / reserva_item / bloqueio
```
- Criar: só o `FOR KEY SHARE` implícito do INSERT no profissional (bloqueio de profissional); a leitura de reservas não trava.
- Editar/remover: só `bloqueio FOR UPDATE OF b`; nenhuma outra trava. Não há ciclo com a desativação (ela não toca `bloqueio`) nem com reservas (que não tocam `bloqueio`).

### 3.4 Validação e apresentação (puras)

```ts
// validacao.ts
/** 'dd/mm/aaaa' (trim; ≤ campoMaxCaracteres; ^(\d{2})\/(\d{2})\/(\d{4})$). Formato → 'data'; inexistente (31/02) → 'dataInexistente'. */
export function lerData(v: unknown): { ok: true; data: DataCivil } | { ok: false; erro: 'data' | 'dataInexistente' };
/** 'H:MM'|'HH:MM' (trim; h 0..23; m 0..59). Formato → 'hora'; m % 5 ≠ 0 → 'granularidade'. 24:00 → 'hora'. */
export function lerHora(v: unknown): { ok: true; min: number } | { ok: false; erro: 'hora' | 'granularidade' };
/** trim; '' → null; > 200 (UTF-16) → erro. Não-string e não-undefined → 'formulario'. */
export function lerMotivo(v: unknown): { ok: true; motivo: string | null } | { ok: false };

/**
 * Valida a forma e os campos e resolve o período no fuso. Ordem:
 * 1. Forma: z.strictObject das chaves de EntradaCriarBloqueio (ou de EntradaEditarBloqueio com `edicao`);
 *    valores string|undefined; chave extra ou tipo errado → erros.formulario (sem erros de campo).
 * 2. Campos: modo ∈ {horario, dia_inteiro} (senão 'modo' e para); datas; no modo 'horario' as horas
 *    (no 'dia_inteiro' as horas são IGNORADAS, inclusive inválidas); motivo. Erros de campo acumulam.
 * 3. Conversão (só sem erros de campo): horario → instanteDeHoraLocal(dataInicio, horaInicio) e
 *    (dataFim, horaFim); dia_inteiro → dataFim < dataInicio → erros.dataFim = ordemDias, senão
 *    intervaloDeDiasInteiros.
 * 4. Regras temporais, em erros.periodo (a primeira que falhar): fim <= inicio → ordem (RN-5);
 *    fim <= agora → passado (RN-6); horario: fim − inicio > duracaoMaxMs → duracao;
 *    dia_inteiro: diferencaEmDias(d1, d2) + 1 > 366 → duracao (RN-7); inicio − agora > antecedenciaMaxMs
 *    → antecedencia. Início no passado é aceito.
 * O alvo NÃO é validado aqui (o serviço resolve, pois depende do papel).
 */
export function resolverPeriodo(
  e: unknown, fuso: string, agora: Date, opcoes: { edicao: boolean },
): | { ok: true; inicio: Date; fim: Date; motivo: string | null; alvo: unknown; id: unknown }
   | { ok: false; erros: ErrosBloqueio };
```

```ts
// apresentacao.ts (usa format.ts e tempo/fuso; import type de repos/tipos)
export function paraItem(dto: BloqueioDTO, fuso: string, ctx: { papel: PapelDeSalao; profissionalId: string | null }): BloqueioItem;
export function paraAviso(r: { reservas: ReservaCobertaDTO[]; total: number }, fuso: string): AvisoReservas;
/** Valores do formulário de edição: dia inteiro → modo dia_inteiro, dataInicio = formatarData(inicio),
 *  dataFim = formatarData(new Date(fim − 1 ms)), horas vazias; senão modo horario com formatarData/formatarHora. */
export function valoresDeEdicao(dto: BloqueioDTO, fuso: string): ValoresBloqueio;
export function opcoesDeAlvo(profissionais: ProfissionalAlvoDTO[]): OpcaoAlvo[]; // 'Salão inteiro' primeiro
```
`fim − 1 ms` dá a última data inclusiva também nos dias de 23/25 h (o instante cai em 23:59:59.999 local da última data).

### 3.5 Formatação (`src/lib/format.ts`)

```ts
/**
 * diaInteiro e mesma data → '25/12/2026 (dia inteiro)';
 * diaInteiro e várias → '24/12/2026 a 26/12/2026' (última data = formatarData(fim − 1 ms));
 * senão → '25/12/2026 22:00 a 26/12/2026 02:00' (formatarDataHora nas duas pontas, CA-5).
 * Instante inválido, fim <= inicio ou fuso inválido → erro (como formatarData).
 */
export function formatarPeriodoBloqueio(inicio: Date, fim: Date, fuso: string, diaInteiro: boolean): string;
```
`diaInteiro` vem do servidor (`ehDiaInteiro`), porque a classificação depende da regra RN-3 e o `format.ts` não converte.

### 3.6 Serviço, leitura e ações

Sem `next/*`. `agora` vem de `defineAcao` (ações) ou do chamador (página).

```ts
// servico.ts
export async function listar(ctx: TenantContext, agora: Date): Promise<{ itens: BloqueioItem[]; fuso: string }>;
export async function opcoesDeAlvo(ctx: TenantContext): Promise<OpcaoAlvo[] | null>; // null para o papel profissional
export async function obterParaEdicao(ctx: TenantContext, id: unknown): Promise<{ item: BloqueioItem; valores: ValoresBloqueio }>;
export async function criar(ctx: TenantContext, e: unknown, agora: Date): Promise<ResultadoSalvarBloqueio>;
export async function editar(ctx: TenantContext, e: unknown, agora: Date): Promise<ResultadoSalvarBloqueio>;
export async function remover(ctx: TenantContext, e: unknown): Promise<ResultadoRemoverBloqueio>;
// leitura.ts — SEM checagem de papel (E3.1/E3.3, com TenantContext ou SistemaContext)
export async function lerBloqueios(ctx: ContextoEscopado, periodo: Periodo, opcoes?: { profissionalId?: string }):
  Promise<{ id: string; profissionalId: string | null; inicio: Date; fim: Date; motivo: string | null }[]>;
```

Regra de permissão (RN-12) num único auxiliar `exigirGestaoDoAlvo(ctx, profissionalId: string | null)`:
`null` → `exigirPermissao(ctx, 'bloqueio_salao.gerir')`; id → `exigirPermissao(ctx, 'bloqueio_profissional.gerir', { profissionalId: id })`.

- **`listar`:** `filtroDeProfissional(ctx, 'bloqueio_profissional.gerir')` → `listarVigentes(ctx, agora, filtro)`; `paraItem` com o fuso lido por `fusoDoSalao`. O profissional vê os seus (editáveis) e os do salão (`editavel: false`), nunca os de colegas (CA-14).
- **`criar`** (precedência: **validação → 403 → 404**, mesma ideia da D-014 D-18):
  1. `fuso = fusoDoSalao(ctx)`; `resolverPeriodo(e, fuso, agora, { edicao: false })` → `invalido`.
  2. Alvo: papel **profissional** → `alvo` ausente/`''`/igual ao próprio id → próprio; qualquer outro valor (inclusive `'salao'` e id de outro salão) → `AcessoNegado` **sem consultar** (CA-2; não revela existência). Papel **gestor** → `alvo` ausente ou `''` → `invalido { alvo }`; `'salao'` → `null`; outro texto → id.
  3. `exigirGestaoDoAlvo`.
  4. `emTransacao(t => { se id: t.bloqueios.buscarProfissional(ctx, id) (404 para B/inexistente/malformado, CA-13); b = t.bloqueios.criar(...); r = t.reservas.listarConfirmadasQueCruzam(ctx, {de: b.inicio, ate: b.fim}, b.profissionalId, avisoMax) })`.
  5. `salvo` com `paraItem` e `paraAviso`.
- **`editar`** (precedência: **validação → 404 → 403**):
  1. `fuso`; `resolverPeriodo(e, fuso, agora, { edicao: true })` → `invalido` (chave `alvo`/`profissionalId`/`salaoId` extra → `formulario`, CA-12 "recusado").
  2. `id` não-string → `NaoEncontrado`.
  3. `emTransacao(t => { b = t.bloqueios.travar(ctx, id) (404); exigirGestaoDoAlvo(ctx, b.profissionalId) (403, nada gravado); b2 = t.bloqueios.atualizarPeriodo(...); aviso como em criar com b.profissionalId })`.
- **`remover`:** `id` não-string → 404; `emTransacao(t => { b = travar (404); exigirGestaoDoAlvo (403); t.bloqueios.remover })`. Bloqueio já encerrado é removível (CA-11).
- Nenhuma escrita em `reserva`, `reserva_item` ou `mensagem` e nenhum enfileiramento (CA-4).
- Log JSON numa linha, só ids e contagens: `bloqueio.criado|editado { salaoId, bloqueioId, nivel: 'salao'|'profissional', reservasCobertas }`, `bloqueio.removido { salaoId, bloqueioId }`. Motivo **não** vai para o log.
- **`obterParaEdicao`:** id não-string → 404; `buscar` (404); `exigirGestaoDoAlvo` (403); `paraItem` + `valoresDeEdicao`.

```ts
// bloqueios.acao.ts — sem 'use server'; só exportações de defineAcao
const CONFIG = { papeis: ['gestor', 'profissional'], capacidade: 'configurar' } as const;
export const criarBloqueio = defineAcao<EntradaCriarBloqueio, ResultadoSalvarBloqueio>(CONFIG, (ctx, e, { agora }) => servico.criar(ctx, e, agora));
export const editarBloqueio = defineAcao<EntradaEditarBloqueio, ResultadoSalvarBloqueio>(CONFIG, (ctx, e, { agora }) => servico.editar(ctx, e, agora));
export const removerBloqueio = defineAcao<EntradaRemoverBloqueio, ResultadoRemoverBloqueio>(CONFIG, (ctx, e) => servico.remover(ctx, e));
```
(Se `defineAcao` exigir o objeto literal por ação para o registro, repetir o literal nas três; o CA-19 confere os metadados.)

### 3.7 Telas

`src/app/painel/bloqueios/`:

| Arquivo | Conteúdo |
|---|---|
| `estado.ts` | `EstadoFormularioBloqueio = { mensagem: string \| null; erros: ErrosBloqueio; valores: ValoresBloqueio; salvo: { periodo: string; aviso: AvisoReservas } \| null }`, `estadoInicial(valores?)`, `VALORES_VAZIOS` (modo `horario`). `lerFormularioBloqueio(fd, modo: 'criar' \| 'editar')` lê só os nomes conhecidos (`alvo` só em criar; `id` só em editar), ignora extras e arquivos, devolve `{ entrada, valores }` (cada valor cortado em 200 caracteres para eco). `idDoCampo(campo)` → `bloqueio-<campo>`. Só `import type`/constantes de `@/server/bloqueios/tipos`. |
| `FormularioBloqueio.tsx` (+ `.test.tsx`, `Bloqueios.module.css`) | `'use client'`; `useActionState(acao, inicial)`; `<form action noValidate>`. Props: `acao`, `opcoesAlvo: OpcaoAlvo[] \| null` (null = profissional: texto "O bloqueio vale para a sua agenda."), `id?` (edição: campo oculto `id` e o alvo mostrado como texto `alvoTexto`), `valoresIniciais?`, `rotuloEnviar`. Campos: `<select name="alvo">` (gestor; primeira opção vazia "Escolha…", depois "Salão inteiro" e os profissionais, inativos com "(inativo)"); `<fieldset aria-describedby="bloqueio-ajuda [erro-periodo]">` + `<legend>Período</legend>` com dois rádios `modo` ("Com horário", "Dia inteiro"), `Field`s de texto `dataInicio`/`horaInicio`/`dataFim`/`horaFim` (`pattern` `\d{2}/\d{2}/\d{4}` e `([01]?[0-9]\|2[0-3]):[0-5][0-9]`, `maxLength` 10/5, `autoComplete="off"`), `motivo` (`maxLength={200}`, opcional). Erros por `Field.erro` (`aria-invalid` + `aria-describedby`). Com erros: **resumo de erros** no topo (`tabIndex=-1`, título `resumoErros`, links `#bloqueio-<campo>`), focado por `useEffect`. Com `salvo`: `<section tabIndex=-1 aria-labelledby>` com `Alert` sucesso "Bloqueio salvo: <periodo>." e `<AvisoReservasCobertas>`, focada por `useEffect` (CA-21). `mensagem` (403/404/formulario) em `Alert` erro. Em criar, depois de `salvo` os campos voltam vazios (`valores` vazios no estado). |
| `AvisoReservasCobertas.tsx` (+ `.test.tsx`) | Sem estado: `semReservas` ou `comReservas` + `<ul>` "<inicioLocal> a <fimLocal> — <profissional> — <cliente>" + `maisReservas(total − n)` quando `total > reservas.length`. |
| `ListaBloqueios.tsx` (+ `.test.tsx`) | Componente de servidor (sem `'use client'`): `vazio` ou `<ul>`; cada item: alvo ("Salão inteiro" ou nome + "(inativo)"), `periodo`, motivo; se `editavel`: `<Link href={ROTAS.bloqueio(id)}>Editar</Link>` e `<form action={acaoRemover}>` com `id` oculto e botão "Remover" com `aria-label="Remover bloqueio: <alvo>, <periodo>"`; senão o texto `somenteLeitura`. `acaoRemover` é prop (página real ou demonstração). |
| `page.tsx` | (1) `exigirAcessoAoPainel(ROTAS.bloqueios, ['gestor', 'profissional'], 'bloqueio_profissional.gerir')`, negado → `<AcessoNegado />`; (2) `agora = new Date()`; `listar` e `opcoesDeAlvo`; (3) `PanelLayout caminhoAtual=ROTAS.bloqueios`, `h1` "Bloqueios"; (4) `searchParams.remocao`: `ok` → `Alert` status `removido`; `nao_encontrado` → `naoEncontrado`; `negado` → `acessoNegado`; (5) seção "Novo bloqueio" com `FormularioBloqueio acao={criarBloqueioAcao}`; (6) seção "Bloqueios vigentes e futuros" com `ListaBloqueios acaoRemover={removerBloqueioAcao}`. |
| `[id]/page.tsx` | Guarda igual; `try { r = await obterParaEdicao(ctx, id) } catch` (`NaoEncontrado` → `null`; `AcessoNegado` → `negado`; outros relançados); `notFound()`/`<AcessoNegado/>` **fora** do `try`. `h1` "Editar bloqueio", link "Voltar para bloqueios" (`ROTAS.bloqueios`), `FormularioBloqueio acao={editarBloqueioAcao} id alvoTexto valoresIniciais`. |
| `acoes.ts` | `'use server'`. `criarBloqueioAcao(anterior, fd)` e `editarBloqueioAcao(anterior, fd)`: `lerFormularioBloqueio` → ação; `nao_autenticado` → `redirect('/entrar?proximo=' + encodeURIComponent(rota))`; `acesso_negado`/`nao_encontrado` → `mensagem` (com `valores`); `invalido` → `{ erros, valores }`; `salvo` → `revalidatePath(ROTAS.bloqueios)` (+ `ROTAS.bloqueio(id)` na edição) e estado `{ salvo: { periodo, aviso }, valores: criar ? VALORES_VAZIOS : valores }`. `removerBloqueioAcao(fd)`: `removido` → `revalidatePath` + `redirect(ROTAS.bloqueios + '?remocao=ok')`; `nao_encontrado` → `?remocao=nao_encontrado`; `acesso_negado` → `?remocao=negado`. `redirect` sempre **fora** de `try`; a casca não importa `@/server/repos`. |

### 3.8 Página de demonstração (`src/app/dev/bloqueios/`)

- `page.tsx`: `dynamic = 'force-dynamic'`; `notFound()` sem `vitrineHabilitada(process.env)` antes de ler parâmetros; metadados `noindex` só habilitada. `?modo=`: `gestor` (padrão: lista de exemplo com um bloqueio do salão de dia inteiro, um de profissional com horário e motivo, um de profissional inativo; formulário com opções de alvo), `profissional` (lista com o próprio editável e o do salão somente leitura; formulário sem alvo), `edicao` (formulário de edição preenchido). Desconhecido → `gestor`. `?remocao=ok` mostra o `Alert` como na real. Instantes de exemplo calculados a partir de `new Date()` (sempre futuros), fuso `America/Sao_Paulo`.
- `acoes.ts`: `'use server'`. Sem vitrine → estado inicial / nenhum efeito. Com vitrine: `demonstrarCriacaoAcao`/`demonstrarEdicaoAcao` rodam `lerFormularioBloqueio` → `resolverPeriodo(entrada, 'America/Sao_Paulo', new Date(), …)` e, para o gestor, exigem `alvo` não vazio; válido → `salvo` com `formatarPeriodoBloqueio` e um aviso fixo com duas reservas de exemplo (uma com "cliente removida"); `demonstrarRemocaoAcao` → `redirect('/dev/bloqueios?remocao=ok&modo=<modo>')` (usar `ROTAS.devBloqueios`). Sem banco, sessão ou rede.

## 4. Dados: DBA **dispensado**

- **Nenhuma DDL.** Tabela, FK composta, `bloqueio_ordem_chk` e `bloqueio_periodo_idx` existem.
- **Consulta de reservas cobertas:** atendida pelo índice parcial `reserva_sem_sobreposicao` (GiST da exclusion), conferido por `EXPLAIN` com plano genérico (§0). Um teste de repositório em T-3 mantém essa prova (R-3).
- **Lista vigente (`fim > agora`)**: `findMany` pelo btree `(salao_id, profissional_id)`; o volume por salão é de dezenas a centenas de linhas. A leitura por período da E3.1 usa `bloqueio_periodo_idx`.
- **CHECK de motivo ≤ 200:** só no servidor (um escritor validado; mesmo critério da D-014 §4 e D-015 §4).
- **Travas:** `FOR UPDATE OF b` numa linha de `bloqueio` por id e o `FOR KEY SHARE` implícito de FK; semântica padrão do PostgreSQL, verificada por teste em T-6.

Se T-3 não conseguir o plano com `reserva_sem_sobreposicao`, ou T-6 encontrar `deadlock detected`, o líder aciona o DBA com:

```
DEMANDA: D-016 — bloqueios
DE: arquiteto-software  PARA: dba
OBJETIVO: avaliar índice/plano da consulta de reservas que cruzam um intervalo (ou o impasse observado)
CONTEXTO NECESSÁRIO: design.md §0 e §3.3 (listarConfirmadasQueCruzam; ordem de travas); EXPLAIN obtido em T-3
CRITÉRIOS DE ACEITAÇÃO: CA-4, CA-13, CA-20
DECISÕES JÁ TOMADAS: sem coluna nova; aviso só de 'confirmado' por [inicio, fim)
ARQUIVOS ENVOLVIDOS: src/server/repos/reserva.ts, src/server/repos/bloqueio.ts (leitura; posse do desenvolvedor)
EVIDÊNCIAS: saída do EXPLAIN / do laço ×10
PENDÊNCIAS: —
PRÓXIMA AÇÃO: parecer em docs/demandas/D-016/dba.md (migração com índice, se necessária)
```

## 5. Infraestrutura: DevOps **dispensado**

Nenhuma variável, container, script, dependência ou job novo. O E2E usa `/dev/bloqueios`, ligado pela `VITRINE_COMPONENTES=true` que o `webServer` do Playwright já define, e cai no glob do job `e2e` sem banco. O tzdata vem do ICU completo do Node 24 (já usado por `format.ts`). Observabilidade: eventos `bloqueio.criado|editado|removido` (§3.6).

## 6. Verificação das invariantes

| Invariante | Aplica? | Como |
|---|---|---|
| Escopo por salão no servidor | Sim | `salao_id` só do `ctx` (`exigirEscopo`) em todo método; criar usa o salão do contexto e confere o profissional do salão antes (404); editar/remover travam por `(id, salao_id)`; a FK composta é a segunda barreira. O aviso filtra `r.salao_id` (bloqueio de salão em A nunca lista reserva de B, CA-13). Chaves extras na entrada → `formulario`; a casca ignora nomes desconhecidos; para o profissional o alvo é sempre o próprio. Testes com dois salões (T-5, T-8). |
| Exclusion constraint anti-sobreposição | Indireta | Bloqueios podem se sobrepor (RN-9). `reserva_sem_sobreposicao` não é tocada; seu índice é só lido. O CA-4 confere que reservas ficam idênticas. |
| UTC + fuso do salão | Sim (central) | Gravação em `timestamptz` UTC; entrada e exibição no `salao.fuso` lido a cada operação; conversão com DST (RN-2/RN-3) em `src/server/tempo/fuso.ts`; troca de fuso não recalcula (RN-16, CA-17). |
| Adaptadores de integração | Não | Nenhuma integração; nenhuma mensagem enfileirada (CA-4). |
| Soft delete / anonimização | Sim | Bloqueio tem DELETE físico (RN-10; não é histórico protegido). Profissional inativo continua gerível (RN-14). Cliente anonimizada aparece como `ROTULO_CLIENTE_REMOVIDA`; o SQL nunca seleciona `telefone_e164`. |
| Somente leitura do salão suspenso | Declarado | As três ações declaram `capacidade: 'configurar'` (CA-19); o efeito é da E6.4. Listar e a página de edição não são ações. |
| Idempotência de webhooks/mensagens | Não | Sem webhook/mensagem. Duplo envio sem JS cria duplicata aceita (RN-9). |
| Auditoria do super admin | Não | Super admin recebe 403 em todas as ações (`defineAcao` papeis) e é negado na matriz. |

## 7. Decisões

| ID | Decisão |
|---|---|
| D-1..D-14 | **Confirmadas** como na spec. |
| D-15 (nova) | "2 anos à frente" (RN-7) = `inicio − agora ≤ 730 × 24 h`. 366 dias exatos no modo com horário = `fim − inicio ≤ 366 × 24 h` em UTC; no modo dia inteiro conta-se **datas** (≤ 366), não horas (um intervalo de 366 datas com recuo de DST tem 366 × 24 h + 1 h e é aceito). |
| D-16 (nova) | Conversão em `src/server/tempo/fuso.ts` (§3.1), só `Intl`; regra RN-3 implementada por candidatos de deslocamento + busca binária do instante da transição. É a função que a E3.1 deve usar. |
| D-17 (nova) | Campos de texto `dd/mm/aaaa` e `HH:MM` (00:00–23:55), rádio de modo; no dia inteiro as horas são ignoradas, mesmo inválidas. |
| D-18 (nova) | Aviso limitado a 100 reservas listadas + total (`count(*) OVER ()`); o resultado da ação traz os ids das listadas (CA-4 usa poucas). |
| D-19 (nova) | Criar/editar devolvem o aviso no estado da ação, sem PRG; remover usa PRG com `?remocao=ok|nao_encontrado|negado`. |
| D-20 (nova) | Precedência: criar = validação → 403 (alvo) → 404; editar = validação → 404 → 403; remover = 404 → 403. Profissional com alvo diferente do próprio recebe 403 **sem consulta** (inclusive id de outro salão). |
| D-21 (nova) | Edição rejeita chave `alvo`/`profissionalId`/`salaoId` com `formulario` (CA-12 "recusado"). |
| D-22 (nova) | Edição/remoção travam a linha com `FOR UPDATE OF b` (marcador para T-6); criar não trava nada explicitamente. |
| D-23 (nova) | `diaInteiro` é derivado na exibição por `ehDiaInteiro`; a edição de um bloqueio de dia inteiro abre no modo dia inteiro. |
| D-24 (nova) | O E2E (CA-21, CA-22) roda em `/dev/bloqueios` com ações de demonstração (padrão D-015 D-11); a página real é coberta por integração com `renderToStaticMarkup` (T-8) e pelo passo manual com Docker (T-10/T-11). Desvio consciente: no E2E "salvar"/"remover" exercitam validação e estado sem gravar. |

## 8. Riscos

| Risco | Mitigação |
|---|---|
| R-1: conversão errada em DST | Unitários CA-6 (a)–(f) + Manaus, `UTC`, `Asia/Kolkata`; ida e volta `partesLocais(instanteDeHoraLocal(d, m)) = (d, m)` para horas válidas; minuto 1439; data inválida, minutos 1440/−1/1.5 → RangeError. O teste não pode depender do fuso da máquina (CI em UTC; rodar também com `TZ=America/Sao_Paulo` localmente no `dev.md`). |
| R-2: `formatarData(fim − 1 ms)` nos dias de 23/25 h | Unitário de `formatarPeriodoBloqueio` e `valoresDeEdicao` com os intervalos do CA-6 (b)/(c). |
| R-3: consulta do aviso deixa de usar o índice (literal virou parâmetro) | Teste de repositório: `EXPLAIN` da mesma consulta (texto exportado como constante interna testável ou repetido no teste) com `SET LOCAL enable_seqscan=off` e `plan_cache_mode=force_generic_plan` contém `reserva_sem_sobreposicao`. |
| R-4: intersecção semiaberta | CA-4: reserva que só encosta (fim = início do bloqueio, e início = fim do bloqueio) não aparece; `cancelado`, `concluido`, `nao_compareceu` não aparecem; outro profissional não aparece no bloqueio de profissional e aparece no de salão. |
| R-5: telefone lido | Teste do repositório confere as chaves exatas do DTO; revisão: o SQL não contém `telefone`. Teste com cliente anonimizada (UPDATE por SQL no `apoio.ts`). |
| R-6: CA-20 instável | Remoções: `Promise.all` ×10 (uma `removido`, outra 404); caso determinístico: conexão `pg` com `BEGIN; SELECT … FOR UPDATE` no bloqueio, dispara remoção, espera em `pg_stat_activity` (`query LIKE '%FOR UPDATE OF b%'` e `wait_event_type='Lock'`), faz `DELETE` e `COMMIT` → a ação dá 404. Criar × desativar ×10: ambas `ok`, sem `deadlock`. Editar × remover ×10: estado final = linha ausente ou linha com o novo período; nunca 5xx. **`timeout` explícito (30 s) em cada `it` com laço.** |
| R-7: `agora` real nos testes | Ações recebem `{ agora }` fixo via `executar(..., { agora })`; instantes de teste em datas fixas de 2026-12 com `agora` fixo antes delas; a fábrica usa `instanteFuturo` (real) e os testes que dependem dela usam `agora = new Date()`. |
| R-8: 403 × 404 | Matriz de casos em `isolamento-permissoes.test.ts` (profissional: alvo de colega/`salao`/B/`abc` → 403 sem efeito; editar/remover de colega/salão → 403; de B/inexistente/`abc` → 404; gestor com B → 404). Páginas: profissional abrindo edição do bloqueio do salão → "Acesso negado"; de B → `notFound`. |
| R-9: estado sem JS e lista desatualizada | E2E sem JS na demonstração confere aviso e erros; `paginas.test.ts` confere que a casca chama `revalidatePath(ROTAS.bloqueios)` e devolve o estado `salvo`; passo manual sem JS na página real com Docker (T-10). |
| R-10: teclado no `<select>` | No E2E, escolher a opção com setas (Chromium) a partir do foco no `select`; se instável, `selectOption` só nesse passo, com o resto por teclado, registrado no `dev.md`. |
| R-11: lint `no-html-link-for-pages` | Todos os `href` por `ROTAS.*` e `next/link`; resumo de erros com `#âncoras`. |
| R-12: ação de demonstração em produção | Sem vitrine devolve estado inicial e não redireciona; unitário cobre os dois ramos. |
| R-13: cobertura de `.tsx`/casca | jsdom (T-7), `renderToStaticMarkup` (T-8), unitários da demonstração (T-9), sem exclusões. |
| R-14: fuso inválido gravado no banco | `validarFuso` lança; a página dá 500. Aceito (E2.5 valida o fuso na escrita). Unitário CA-6 (f). |

## 9. Estratégia de testes

| Camada | O quê |
|---|---|
| Unitário (`node`) | `src/server/tempo/fuso.test.ts`: CA-6 (a)–(f), R-1, `somarDias` (virada de mês/ano, bissexto), `diferencaEmDias`, `ehDataCivilValida` (31/02, 29/02/2027 × 2028), `ehDiaInteiro` (CA-6 b/c verdadeiro; 00:05 falso). `src/lib/format.test.ts`: `formatarPeriodoBloqueio` (CA-23: dia único, vários dias, com horário cruzando a meia-noite, dia de 23 h e 25 h, `fim <= inicio` lança); `format.fonte-unica.test.ts` verde **sem mudança**. `src/server/bloqueios/validacao.test.ts`: `lerData`/`lerHora`/`lerMotivo` e `resolverPeriodo` (CA-5 conversão, CA-7 todos os casos, CA-8 com `agora` fixo, CA-9 limites exatos ±1 min/±1 data e 730 dias, CA-16, modo desconhecido, horas ignoradas no dia inteiro, chave extra → `formulario`, `id` aceito só em edição). `apresentacao.test.ts`: `paraItem` (editavel por papel; "Salão inteiro"; inativo), `paraAviso` (cliente removida, total > listadas), `valoresDeEdicao` (dia inteiro e horário), `opcoesDeAlvo`. `src/config/navegacao.test.ts`: novas rotas; `SEGMENTOS_RESERVADOS` inalterado. `src/server/repos/index.test.ts`: métodos de `bloqueios` e `listarConfirmadasQueCruzam` com id malformado → `NaoEncontrado` sem consulta. `src/app/dev/bloqueios/{page.test.tsx,acoes.test.ts}`. |
| Unitário (`jsdom`) | `FormularioBloqueio.test.tsx` (rótulos, `fieldset/legend`, rádios, `aria-describedby` com ajuda e erro, `aria-invalid`, resumo focado, seção `salvo` focada, valores preservados, campos limpos após salvar na criação, sem `select` para o profissional), `AvisoReservasCobertas.test.tsx`, `ListaBloqueios.test.tsx` (editar/remover só em `editavel`; `aria-label` do remover; vazio). |
| Integração (PostgreSQL real) | `tests/integration/bloqueios/`: `repos.test.ts` (T-3: CRUD com escopo; B intacto; `listarVigentes` por filtro e ordem; `listarNoPeriodo` semiaberto e com/sem profissional; `listarConfirmadasQueCruzam` R-4/R-5, limite/total; EXPLAIN R-3; `travar` 404), `criar-editar-remover.test.ts` (CA-1, CA-3, CA-4 completo com fotografia `to_jsonb` de `reserva`/`reserva_item` e contagem de `mensagem`, CA-5 SP e Manaus, CA-7..CA-12, CA-15, CA-16, CA-17, CA-18), `isolamento-permissoes.test.ts` (CA-2, CA-13, CA-14 via `listar`, super admin 403, sem credencial 401, profissional inativo 401, CA-19 metadados, `lerBloqueios`), `concorrencia.test.ts` (CA-20, R-6), `paginas.test.ts` (página, edição e casca por `renderToStaticMarkup`, com `next/headers`/`next/navigation`/`next/cache` substituídos e sem mock de banco: CA-3/CA-5 exibição, CA-14 gestor × profissional, CA-15 "(inativo)", CA-17 13:00–15:00, CA-18, 403/404 da edição, `?remocao=*`, casca: `salvo` + `revalidatePath`, `invalido` com valores, extras ignorados, remoção → redirect `?remocao=ok|nao_encontrado|negado`, `nao_autenticado` → `/entrar?proximo=%2Fpainel%2Fbloqueios`). `tests/integration/tenant/registro.test.ts` verde sem mudança. |
| E2E (Playwright 375×812, sem banco) | `e2e/bloqueios.spec.ts` (CA-21): em `/dev/bloqueios?modo=profissional` cria um bloqueio só com teclado; em `?modo=gestor` escolhe "Salão inteiro", modo dia inteiro, salva e vê o foco na seção do aviso; com erro, foco no resumo e link leva ao campo; remove um item por teclado e vê `removido`; foco visível em cada parada; axe 4.14.0 sem violações em lista, formulário, erro e aviso (`gestor`, `profissional`, `edicao`); sem rolagem horizontal. `e2e/bloqueios-sem-js.spec.ts` (CA-22): `javaScriptEnabled: false`; gestor cria com horário e dia inteiro (aviso visível), erros do servidor com valores preservados, remove; profissional cria e remove. Datas futuras calculadas no teste. |
| Manual | T-10 (dev) e T-11 (tester) com Docker na página real: gestor e profissional, com e sem JS, 375 px, só teclado; aviso com reserva real; troca de fuso por SQL (CA-17). |

**Cobertura ≥ 90%:** todo arquivo novo de `src/` tem teste direto; páginas e casca por `paginas.test.ts`; demonstração por unitário. Medição em T-10 com `npm run test:coverage`; abaixo do limiar, a tarefa dona completa os testes.

Comando de estabilidade (registrar no `dev.md` e sugerir para o `CLAUDE.md`):
```
for i in $(seq 10); do npx vitest run --project integration tests/integration/bloqueios/concorrencia.test.ts || break; done
```

## 10. Tarefas

DBA e DevOps dispensados (§4, §5). Implementação: `desenvolvedor`.

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | desenvolvedor | — | T-2, T-3 | `src/server/tempo/fuso.ts`, `src/server/tempo/fuso.test.ts` |
| T-2 | desenvolvedor | — | T-1, T-3 | `src/lib/format.ts`, `src/lib/format.test.ts`, `src/config/navegacao.ts`, `src/config/navegacao.test.ts`, `src/server/bloqueios/tipos.ts` |
| T-3 | desenvolvedor | — | T-1, T-2 | `src/server/repos/bloqueio.ts`, `src/server/repos/reserva.ts`, `src/server/repos/index.ts`, `src/server/repos/tipos.ts`, `src/server/repos/index.test.ts`, `tests/integration/bloqueios/repos.test.ts` |
| T-4 | desenvolvedor | T-1, T-2 | T-3, T-7 | `src/server/bloqueios/validacao.ts`, `validacao.test.ts`, `apresentacao.ts`, `apresentacao.test.ts` |
| T-5 | desenvolvedor | T-3, T-4 | T-7 | `src/server/bloqueios/servico.ts`, `leitura.ts`, `bloqueios.acao.ts`, `tests/integration/bloqueios/apoio.ts`, `criar-editar-remover.test.ts`, `isolamento-permissoes.test.ts` |
| T-6 | desenvolvedor | T-5 | T-8, T-9 | `tests/integration/bloqueios/concorrencia.test.ts` |
| T-7 | desenvolvedor | T-2 | T-3, T-4, T-5 | `src/app/painel/bloqueios/{estado.ts, FormularioBloqueio.tsx, FormularioBloqueio.test.tsx, AvisoReservasCobertas.tsx, AvisoReservasCobertas.test.tsx, ListaBloqueios.tsx, ListaBloqueios.test.tsx, Bloqueios.module.css}` |
| T-8 | desenvolvedor | T-5, T-7 | T-6, T-9 | `src/app/painel/bloqueios/page.tsx`, `src/app/painel/bloqueios/acoes.ts`, `src/app/painel/bloqueios/[id]/page.tsx`, `tests/integration/bloqueios/paginas.test.ts` |
| T-9 | desenvolvedor | T-4, T-7 | T-6, T-8 | `src/app/dev/bloqueios/{page.tsx, page.test.tsx, acoes.ts, acoes.test.ts}`, `e2e/bloqueios.spec.ts`, `e2e/bloqueios-sem-js.spec.ts` |
| T-10 | desenvolvedor | T-6, T-8, T-9 | — | `README.md`, `docs/demandas/D-016/dev.md` |
| T-11 | tester | T-10 | — | `docs/demandas/D-016/testes.md` |

Rodadas (sem arquivo em comum):
- **Rodada 1:** T-1 ‖ T-2 ‖ T-3.
- **Rodada 2:** T-4 ‖ T-7 (T-7 só precisa de T-2; T-3 pode seguir em paralelo se ainda não terminou).
- **Rodada 3:** T-5 (‖ T-7, se ainda em curso).
- **Rodada 4:** T-6 ‖ T-8 ‖ T-9 (T-9 pode começar logo após T-4 e T-7).
- **Rodada 5:** T-10. **Rodada 6:** T-11.

Regras de posse:
- Defeito num arquivo reabre a tarefa dona. Só leitura entre tarefas: T-6/T-8 importam `tests/integration/bloqueios/apoio.ts` (T-5); T-8/T-9 importam `estado.ts` e os componentes (T-7); T-6 pode importar `tests/integration/profissionais/apoio.ts`; T-9 importa `e2e/suporte/vitrine.ts`; T-7 importa `src/server/bloqueios/tipos.ts` (T-2).
- `estado.ts` (T-7) só importa tipos/constantes de `tipos.ts`; a demonstração (T-9) importa `validacao.ts` (T-4).
- Ninguém edita `prisma/**`, `tests/support/**`, `tests/integration/{tenant,profissionais,auth,jornadas,servicos}/**`, `src/server/tenant/**`, `src/server/auth/**`, `src/server/profissionais/**`, `src/server/jornadas/**`, `src/components/**`, `src/app/dev/{componentes,jornada}/**`, `e2e/suporte/**`, `e2e/a11y-base.spec.ts`, `playwright.config.ts`, `eslint.config.mjs` nem `vitest.config.ts`. O `CLAUDE.md` é do líder.

**T-1 — Fuso.** Entregável: §3.1 com cabeçalho (RN-2, RN-3, premissa de uma transição em ±24 h, obrigação para a E3.1). Conclusão: `npx vitest run src/server/tempo` verde com CA-6 (a)–(f) e R-1, inclusive com `TZ=UTC` e `TZ=America/Sao_Paulo`; sem import de `@/server/**`, de `next/*` nem do Prisma; lint e typecheck verdes.

**T-2 — Formatação, rotas e contratos.** Entregável: §3.2, §3.5; `ROTAS.bloqueio`, `ROTAS.devBloqueios`. Conclusão: `npm run test:unit -- src/lib src/config` verde (CA-23; `format.fonte-unica.test.ts` sem mudança); `tipos.ts` sem import de runtime de `@/server/**`; lint e typecheck verdes.

**T-3 — Repositórios.** Entregável: §3.3 (cabeçalho com a ordem de travas e o marcador `FOR UPDATE OF b`; docstring do índice parcial em `reserva.ts`). Conclusão: `repos.test.ts` cobre o listado em §9 (inclusive R-3 EXPLAIN, R-4, R-5 e linhas de B intactas); `index.test.ts` atualizado; `tests/integration/{servicos,profissionais,jornadas}` verdes sem mudança; lint e typecheck verdes.

**T-4 — Validação e apresentação.** Entregável: §3.4. Conclusão: `npm run test:unit -- src/server/bloqueios` verde com CA-5 (conversão), CA-7, CA-8, CA-9, CA-16 e R-2; arquivos puros (só `import type` de `repos/tipos`); lint e typecheck verdes.

**T-5 — Serviço, leitura e ações.** Entregável: §3.6; `apoio.ts` (contexto/credenciais do gestor, do profissional, do gestor que atende e do super admin; `linhasBloqueio(salaoId)`; fotografia `to_jsonb` de `reserva`/`reserva_item`; contagem de `mensagem`; `anonimizarCliente(id)`; `criarReservaEm(salao, profissional, inicio, fim, status)` por SQL; `definirFuso(salaoId, fuso)`). Testes pela ação (`acao.executar(credencial, input, { agora })`) cobrindo CA-1..CA-5, CA-7..CA-19 conforme §9 e R-8. Conclusão: `npx vitest run --project integration tests/integration/bloqueios` verde; `registro.test.ts` verde com as três ações; nenhum `next/*` em `src/server/bloqueios/**`; lint e typecheck verdes.

**T-6 — Concorrência.** Entregável: CA-20 com R-6. Conclusão: laço ×10 de §9 verde; `timeout` explícito em cada `it`; nenhum `deadlock detected`, 5xx ou exceção não mapeada; conexões `pg` fechadas no `afterAll`.

**T-7 — Componentes.** Entregável: §3.7 (`estado.ts`, `FormularioBloqueio`, `AvisoReservasCobertas`, `ListaBloqueios`, CSS) com os testes jsdom. Conclusão: `npm run test:unit -- src/app/painel/bloqueios` verde; textos de data/hora só recebidos prontos do servidor (nenhum `Intl`/`toLocale*`); CSS só com `var(--…)` e o breakpoint `48rem`; todo `*.test.tsx` começa com `/** @vitest-environment jsdom */`; lint e typecheck verdes.

**T-8 — Páginas e casca.** Entregável: §3.7 (`page.tsx`, `[id]/page.tsx`, `acoes.ts`) e `paginas.test.ts`. Conclusão: `npx vitest run --project integration tests/integration/bloqueios/paginas.test.ts tests/integration/auth/paginas.test.ts` verde (o segundo sem mudança); `npm run build` lista `/painel/bloqueios` e `/painel/bloqueios/[id]`; `redirect`/`notFound` fora de `try`; a casca não importa `@/server/repos`; lint e typecheck verdes.

**T-9 — Demonstração e E2E.** Entregável: §3.8, `e2e/bloqueios.spec.ts` (CA-21), `e2e/bloqueios-sem-js.spec.ts` (CA-22), unitários da página e das ações. Conclusão: `npm run test:e2e` verde (inclusive `a11y-base.spec.ts` e `jornada*.spec.ts` sem mudança); axe sem violações nos estados de §9; `/dev/bloqueios` 404 sem a variável; lint e typecheck verdes.

**T-10 — Documentação e gates.** Entregável: seção "Bloqueios" do README (horário local do salão, dia inteiro inclusivo, múltiplos de 5, limites, aviso sem alterar reservas, profissional só os próprios, removível); `dev.md` com a evidência dos gates, cobertura, laço ×10, unitários de fuso com `TZ` diferente e passo manual (375 px, só teclado, com e sem JS, página real com Docker, CA-17 por SQL), mais o texto sugerido para o `CLAUDE.md` (D-016: `src/server/tempo/fuso.ts` como única conversão local→UTC, módulo `src/server/bloqueios/`, `lerBloqueios`, `listarConfirmadasQueCruzam` com literal no SQL, `FOR UPDATE OF b`, `/dev/bloqueios`, comando de estabilidade). Conclusão: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:coverage` (≥ 90%) e `npm run test:e2e` verdes; laço da T-6 ×10 verde.

**T-11 — Validação independente (tester).** Entregável: `testes.md` com o veredito. Escopo: repetir gates e laço; conferir o mapa abaixo; prova manual com Docker na página real (gestor e profissional, com e sem JS, só teclado, leitor de tela nos erros e no aviso).

### Mapa CA → tarefa → tipo de teste

| CA | Tarefa(s) | Tipo | Arquivo |
|---|---|---|---|
| CA-1 | T-5, T-8 | Integração | `criar-editar-remover.test.ts`, `paginas.test.ts` |
| CA-2 | T-5 | Integração | `isolamento-permissoes.test.ts` |
| CA-3 | T-1, T-5, T-8 | Unitário + integração | `fuso.test.ts`, `criar-editar-remover.test.ts`, `paginas.test.ts` |
| CA-4 | T-3, T-5 | Integração | `repos.test.ts`, `criar-editar-remover.test.ts` |
| CA-5 | T-1, T-2, T-4, T-5, T-8 | Unitário + integração | `fuso.test.ts`, `format.test.ts`, `validacao.test.ts`, `criar-editar-remover.test.ts`, `paginas.test.ts` |
| CA-6 | T-1 | Unitário | `fuso.test.ts` |
| CA-7 | T-4, T-5 | Unitário + integração | `validacao.test.ts`, `criar-editar-remover.test.ts` |
| CA-8 | T-4, T-5 | Unitário + integração | idem |
| CA-9 | T-4, T-5 | Unitário + integração | idem |
| CA-10 | T-5 | Integração | `criar-editar-remover.test.ts` |
| CA-11 | T-3, T-5 | Integração | `repos.test.ts`, `criar-editar-remover.test.ts` |
| CA-12 | T-4, T-5 | Unitário + integração | `validacao.test.ts`, `criar-editar-remover.test.ts` |
| CA-13 | T-3, T-5, T-8 | Integração (dois salões) | `repos.test.ts`, `isolamento-permissoes.test.ts`, `paginas.test.ts` |
| CA-14 | T-4, T-5, T-7, T-8 | Unitário + jsdom + integração | `apresentacao.test.ts`, `ListaBloqueios.test.tsx`, `isolamento-permissoes.test.ts`, `paginas.test.ts` |
| CA-15 | T-4, T-5, T-8 | Unitário + integração | `apresentacao.test.ts`, `criar-editar-remover.test.ts`, `paginas.test.ts` |
| CA-16 | T-4, T-5 | Unitário + integração | `validacao.test.ts`, `criar-editar-remover.test.ts` |
| CA-17 | T-5, T-8 | Integração | `criar-editar-remover.test.ts`, `paginas.test.ts` |
| CA-18 | T-3, T-5, T-8 | Integração | `repos.test.ts`, `criar-editar-remover.test.ts`, `paginas.test.ts` |
| CA-19 | T-5 | Integração + registro | `isolamento-permissoes.test.ts`, `tenant/registro.test.ts` |
| CA-20 | T-6 | Integração (concorrência ×10) | `concorrencia.test.ts` |
| CA-21 | T-7, T-9, T-11 | jsdom + E2E + manual | `FormularioBloqueio.test.tsx`, `bloqueios.spec.ts`, `testes.md` |
| CA-22 | T-8, T-9, T-11 | Integração (casca) + E2E sem JS + manual | `paginas.test.ts`, `bloqueios-sem-js.spec.ts`, `testes.md` |
| CA-23 | T-2 | Unitário | `format.test.ts`, `format.fonte-unica.test.ts` |

## 11. Obrigações registradas para as próximas demandas

- **E3.1 (#27):** ler bloqueios por `lerBloqueios` (`src/server/bloqueios/leitura.ts`) ou, no fluxo público, por uma leitura em `repos/publico.ts` com o mesmo predicado `tstzrange(inicio, fim,'[)') && …` (usa `bloqueio_periodo_idx`); bloqueio de salão (`profissional_id IS NULL`) vale para todos; intersecção semiaberta. Converter hora de parede da jornada em instantes **só** por `instanteDeHoraLocal`/`partesLocais` de `src/server/tempo/fuso.ts` (regra RN-3 desta demanda). Nunca expor `motivo` na página pública.
- **E3.3 (#20):** exibir bloqueios na grade com `formatarPeriodoBloqueio` e `ehDiaInteiro`; ler por `lerBloqueios`.
- **E3.4:** encaixe sobre bloqueio lê `lerBloqueios`; não trava `bloqueio`.
- **E6.4:** as três ações já declaram `configurar`; a recusa em salão suspenso entra pela política.
- **E2.5:** validar `salao.fuso` com `validarFuso` antes de gravar; trocar o fuso não recalcula bloqueios (RN-16).
