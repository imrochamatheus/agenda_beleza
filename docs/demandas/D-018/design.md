# D-018 — Desenho: horários disponíveis para um ou mais serviços em sequência (issue #27, E3.1)

Entradas: `docs/demandas/D-018/spec.md` (RN-1..RN-19, CA-1..CA-27, D-1..D-12), `issue-27.md` (com as obrigações herdadas de D-014, D-015 e D-016), `CLAUDE.md`, `docs/demandas/D-001/dba.md` (§ E3.1/E3.2, consulta de ocupação) e o código em `main` 7a69cdf (`src/server/tempo/fuso.ts`, `src/server/repos/{publico,jornada,bloqueio,reserva,index,transacao}.ts`, `src/server/tenant/context.ts`, `eslint.config.mjs`, `vitest.config.ts`, migrações `20261118000100`/`20261118000200`).

As decisões D-1..D-12 do spec estão **confirmadas**. As decisões novas ou alteradas deste desenho são numeradas A-n (§1.2).

**Revisão 1 (D-019/D-020, horário de funcionamento).** Fontes adicionais: `spec.md` §10 (RN-20..RN-27, CA-28..CA-44, D-13..D-16) e o código de `main` após a D-020 (`src/server/repos/funcionamento.ts` com `COLUNAS_FUNCIONAMENTO` e `funcionamentoDaLinha`, `src/server/salao/funcionamento-leitura.ts`, `src/server/repos/publico.ts:144-175`, `src/server/semana/`). A revisão mantém A-1..A-8 e T-0..T-5; acrescenta A-9..A-13, o módulo de interseção, a extensão de `lerRegras` e novos CAs. As seções alteradas trazem a marca **[Rev.1]**.

## 1. Resumo da solução

Há três camadas, cada uma com uma única responsabilidade:

1. **Domínio puro** em `src/domain/disponibilidade/`, sem banco, sem `next/*`, sem relógio implícito e sem métodos de data em hora local. Recebe o relógio, as regras do salão, **[Rev.1] o funcionamento do salão (`{ definido: false } | { definido: true, semana }`)**, a duração total, as datas e, para cada profissional, as linhas de jornada, os bloqueios e as ocupações `[inicio, ocupado_ate)`. Devolve, para cada profissional e data, os inícios válidos com o instante UTC e as partes locais. A conversão de hora de parede usa **só** `@/server/tempo/fuso.ts` (RN-9), e essa é a única importação permitida fora da pasta. Uma regra de lint garante isso.
2. **Repositório de leitura de agenda** `src/server/repos/disponibilidade.ts` (`repos().disponibilidade`). Tem seis leituras, **uma instrução SQL cada**, todas em lote por lista de profissionais. Aceita um contexto novo de leitura, `ContextoDeLeituraDeAgenda = PublicoContext | TenantContext | SistemaContext`, e recusa o `AdminContext`. A regra de "serviço ofertável" passa a ser um predicado único exportado por `publico.ts` e usado tanto por `listarServicosPublicos` quanto por este repositório (D-014).
3. **Serviço** `src/server/disponibilidade/servico.ts`. Valida a entrada, faz no máximo seis consultas (constante, CA-26), monta a entrada do domínio e devolve um resultado discriminado (`ok` | `servico_indisponivel` | `entrada_invalida`). Para id de profissional estranho ao salão, lança `NaoEncontrado`. O leitor é injetável (padrão `repos().disponibilidade`), o que permite que a E3.2 o use dentro de `emTransacao` (`r.disponibilidade`) e que o teste do CA-26 conte as consultas.

Não há migração, rota, ação nem UI.

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Reutilizar `lerSemana`/`lerBloqueios` em laço por profissional | O número de consultas cresceria com N (viola RN-19/CA-26). Além disso, elas exigem `ContextoEscopado` e não servem à página pública. |
| Converter cada candidato com `instanteDeHoraLocal` por profissional | Medido localmente (Node 24, scratchpad): 10 prof. × 61 datas × grade 5 leva **2,9 s**, contra **0,32 s** com a grade do dia calculada uma vez e compartilhada. O CA-27 (< 2 s) cairia. A memoização por data é **obrigatória** (§3.1). |
| Segunda implementação de fuso (deslocamento por aritmética própria) no domínio | Proibida pela RN-9 e pela obrigação da D-016: a conversão é só por `fuso.ts`. |
| Mover `fuso.ts` para `src/domain/` ou `src/lib/` | Mexeria em importadores de D-016/D-017 sem ganho funcional. `fuso.ts` já é puro (cabeçalho: "sem next/*, sem Prisma e sem @/server/**"). A exceção de importação é explícita e garantida por lint. |
| `profissional_id = ANY($ids)` direto no GiST de reserva (forma de `dba.md` D-001) | **Correção do DBA (D-018/dba.md):** o `= ANY` direto é equivalente e usa o índice por Bitmap Index Scan (o GiST não tem busca por array nativa, mas o planejador expande o array). A forma `unnest + CROSS JOIN LATERAL` foi mantida pelo **determinismo do plano** (Index Scan por profissional com as duas colunas do índice), não por incapacidade do GiST. O `= ANY` fica registrado como alternativa mais barata neste volume. |
| Criar um `SistemaContext` a partir do `PublicoContext` para reaproveitar os repositórios de tenant | `contextoDeSistema` é reservado ao worker (`context.ts:9`), e isso ampliaria o que a página pública pode fazer (mutações). Uma leitura específica e com projeção mínima é mais estreita. |
| Lançar erro para "serviço indisponível" / validação | `ErroDeDominio` é só 401/403/404 (`erros.ts`). Pela convenção da D-015, resultados de negócio são discriminados por `resultado`. Só o id de profissional estranho vira `NaoEncontrado` (RN-16). |
| Pasta `src/domain/availability/` e testes em `tests/unit/availability/` (issue) | O projeto nomeia em português (`jornadas`, `bloqueios`) e o projeto `unit` só coleta `src/**` (D-9). Usamos `src/domain/disponibilidade/` com testes ao lado. |

### 1.2 Decisões deste desenho

- **A-1** Pasta do domínio: `src/domain/disponibilidade/`. A única importação de fora da pasta é `@/server/tempo/fuso` (tipos e funções). A regra de lint (T-2) proíbe `@/server/**` (exceto `fuso`), `@/app/**`, `@/components/**`, `next`, `react`, Prisma, `pg`, `pg-boss`, SDKs e adaptadores, além de `Date.now()`, `new Date()` sem argumento e os métodos de data em hora local (`getDay`, `getHours`, `setHours` etc.).
- **A-2** (D-11) Contexto `ContextoDeLeituraDeAgenda` e guarda `exigirLeituraDeAgenda` em `context.ts`. O repositório `disponibilidade` é o **único** que aceita `PublicoContext` além de `publico.ts`, e devolve só campos necessários ao cálculo: nunca cliente, status, id de reserva ou `motivo` de bloqueio.
- **A-3** (D-014) Predicado único `ondeServicoOfertavel(salaoId)`, exportado por `publico.ts` e usado por `listarServicosPublicos` (sem mudar o comportamento) e por `repos().disponibilidade.servicosOfertaveis`.
- **A-4** (RN-19) No máximo **6 instruções SQL** por chamada do serviço, independente do número de datas e de profissionais. Com ao menos um elegível e ao menos uma data na janela, são **exatamente 6**. Os curtos-circuitos (entrada inválida, serviço indisponível, nenhum elegível, período fora da janela) emitem menos e **nunca** consultam `reserva`.
- **A-5** Ocupação por `unnest + CROSS JOIN LATERAL`, com o literal de status e a expressão da constraint no texto (§3.3), sujeita ao parecer do DBA.
- **A-6** (CA-26) A instrumentação é o evento `query` do Prisma (`log: [{ emit: 'event', level: 'query' }]`) num cliente criado pelo teste e injetado no serviço por `criarRepos(cliente).disponibilidade`. Verificado no Prisma 7.10.1 + `@prisma/adapter-pg`: o evento dispara para `$queryRaw` (sonda no scratchpad, fora do repositório).
- **A-7** O período de leitura de bloqueios e ocupações vai de `00:00 local de d1'` a `00:00 local de (d2'+1) + intervalo_min`, em que `[d1', d2']` é o período pedido recortado à janela `[hoje, hoje + janela_dias]`. O acréscimo do intervalo cobre a RN-3c no último dia.
- **A-8** O resultado traz **todas** as datas pedidas, inclusive as fora da janela, com `horarios: []` (CA-21, CA-22).
- **A-9 [Rev.1]** (D-13, RN-26) O funcionamento é lido **na mesma instrução** de `lerRegras`, projetando `COLUNAS_FUNCIONAMENTO` (alias `s` para `salao`). Como o fragmento é uma subconsulta escalar (`json_agg` sobre `salao_funcionamento`) dentro do `SELECT … FROM salao s`, a contagem continua **exatamente 6** (A-4 inalterada). Não se chama `lerFuncionamento` (somaria uma instrução e, para `PublicoContext`, exigiria outro caminho). **Consequência:** `lerRegras` deixa de usar `salao.findUnique` do Prisma Client e passa a `$queryRaw` (precedente: `lerPerfilPublico`/`lerFuncionamentoPublico` em `publico.ts`), porque o fragmento é `Prisma.Sql`. A forma bruta tem uma única instrução, filtro `WHERE s.id = ${salaoId}::uuid`, e usa `funcionamentoDaLinha` + `montarSemana` (importados, nunca copiados). Sem linha → `NaoEncontrado`. `COLUNAS_FUNCIONAMENTO` já só agrega linhas quando `funcionamento_definido` (CA-31, linhas residuais).
- **A-10 [Rev.1]** (D-14, RN-21) Módulo de domínio `src/domain/disponibilidade/funcionamento.ts` com a interseção **em minutos de parede**, par a par, antes de qualquer conversão: `janelasDoDia(jornadaDoDia, funcionamentoDoDia | null): IntervaloMin[]`. Ambas as listas são canônicas (ordenadas, sem sobreposição), então a interseção é uma varredura de dois ponteiros, O(a+b), descartando vazios; o resultado é ordenado e disjunto. A conversão dos limites das janelas em instantes continua só por `fuso.ts` (cache por `(d, minuto)`, A-1/RN-9); o módulo novo não faz aritmética de fuso.
- **A-11 [Rev.1]** (D-15, RN-20) O discriminador é **só** `definido`. `{ definido: false }` → `funcionamentoDoDia = null` → `janelasDoDia` devolve a jornada inalterada (mesma referência de valores, saída idêntica à anterior, CA-31). `{ definido: true }` com os 7 dias sem intervalos → `[]` em todo dia (CA-32). Nunca inferir "não informado" de semana vazia.
- **A-12 [Rev.1]** (RN-27) Tipo de domínio próprio, sem importar `@/server/semana`: `FuncionamentoDeAgenda = { definido: false } | { definido: true; dias: readonly (readonly { inicioMin: number; fimMin: number }[])[] }` (7 itens, índice = dia da semana). É estruturalmente compatível com `SemanaHoraria` (`DiaSemanaHoraria.intervalos`); o **serviço** faz o mapeamento `semana.map(d => d.intervalos)`. O domínio valida: `dias.length === 7`, cada intervalo `0 ≤ ini < fim ≤ 1440` inteiros; senão `RangeError`. Mantém a única importação externa permitida (`fuso`).
- **A-13 [Rev.1]** (RN-24, RN-25) Sem cache: o funcionamento é lido a cada chamada, do salão do contexto (o `WHERE s.id` do `lerRegras` já escopa). Troca de fuso não recalcula nada: minutos de parede são reinterpretados no fuso vigente (CA-39). O encaixe da equipe (E3.4) e `lerFuncionamento` ficam fora (D-16); nenhum arquivo de D-020 é alterado, exceto o consumo de `COLUNAS_FUNCIONAMENTO`/`funcionamentoDaLinha`, que já são exportados.

## 2. Componentes afetados

| Caminho | Mudança |
|---|---|
| `src/domain/disponibilidade/tipos.ts` | novo: tipos da entrada e da saída do cálculo |
| `src/domain/disponibilidade/calendario.ts` | novo: `diaDaSemana`, `datasDoPeriodo`, `limitesDaJanela`, `periodoDeLeitura`, `gradeDoDia` |
| `src/domain/disponibilidade/intervalos.ts` | novo: normalização (ordenar e unir) e teste de intersecção por busca binária |
| `src/domain/disponibilidade/funcionamento.ts` | **[Rev.1]** novo: `FuncionamentoDeAgenda`, `validarFuncionamento`, `janelasDoDia` (A-10..A-12) |
| `src/domain/disponibilidade/calcular.ts` | novo: `calcularDisponibilidade` |
| `src/domain/disponibilidade/index.ts` | novo: reexportações públicas |
| `src/domain/disponibilidade/*.test.ts` | novos: unitários (§8) |
| `eslint.config.mjs` | bloco do domínio (A-1); o bloco geral e o de hosts passam a ignorar `src/domain/**` (cada arquivo casa com um só bloco por regra, R-1 da D-007) |
| `tests/integration/lint/importacao-dominio.test.ts` | novo: prova a regra de camada |
| `src/server/tenant/context.ts` (+ `context.test.ts`) | `ContextoDeLeituraDeAgenda`, `exigirLeituraDeAgenda` |
| `src/server/repos/publico.ts` | extrai `ondeServicoOfertavel` (sem mudar o comportamento) |
| `src/server/repos/disponibilidade.ts` | novo repositório (§3.3) e `consultaOcupacoes` exportada para o teste de plano. **[Rev.1]** `lerRegras` em `$queryRaw` com `COLUNAS_FUNCIONAMENTO` e devolve também o funcionamento (A-9); importa `COLUNAS_FUNCIONAMENTO`, `funcionamentoDaLinha` e `ColunasFuncionamento` de `./funcionamento` |
| `src/server/repos/index.ts` | `Repos.disponibilidade` |
| `src/server/disponibilidade/tipos.ts` | novo: contratos do serviço |
| `src/server/disponibilidade/validacao.ts` (+ `.test.ts`) | novo: validação estrutural pura (RN-15) |
| `src/server/disponibilidade/servico.ts` | novo: `consultarDisponibilidade`, `listarProfissionaisElegiveis`. **[Rev.1]** converte o funcionamento do repositório em `FuncionamentoDeAgenda` (`montarSemana` → `dias`) e o passa ao domínio |
| `tests/integration/disponibilidade/**` | novos: apoio, repositório, plano/volume, serviço, isolamento e contagem de consultas |
| `CLAUDE.md` (status e tabela de comandos), `docs/demandas/D-018/dev.md` | documentação e evidências |

**[Rev.1]** Não se altera `src/server/repos/funcionamento.ts`, `src/server/salao/**`, `src/server/semana/**` nem a tela de configuração (RN-26, D-16).

Nenhuma mudança em `prisma/**`, `docker-compose*`, `.env.example`, `.github/**`, `tests/support/**` ou `vitest.config.ts`.

## 3. Interfaces

### 3.1 Domínio (`src/domain/disponibilidade`)

```ts
import type { DataCivil } from '@/server/tempo/fuso';

/** Semiaberto [inicio, fim), instantes UTC. */
export type Intervalo = { readonly inicio: Date; readonly fim: Date };

export type RegrasDeAgenda = {
  readonly fuso: string;            // validarFuso (aceita alias antigo; nunca ehFusoCanonico)
  readonly gradeMin: number;        // inteiro 1..1440
  readonly antecedenciaMin: number; // inteiro ≥ 0 (minutos, D-017 RN-10)
  readonly janelaDias: number;      // inteiro ≥ 0
  readonly intervaloMin: number;    // inteiro ≥ 0
};

export type LinhaDeJornada = { readonly diaSemana: number; readonly inicioMin: number; readonly fimMin: number }; // 0=dom; 0 ≤ ini < fim ≤ 1440

export type AgendaDoProfissional = {
  readonly profissionalId: string;
  readonly jornada: readonly LinhaDeJornada[];
  readonly bloqueios: readonly Intervalo[]; // só os do profissional
  readonly ocupacoes: readonly Intervalo[]; // [r.inicio, r.ocupado_ate) das reservas ativas
};

/** [Rev.1] Hora de parede local, minutos do dia, 0=dom. `definido:false` = não limita (A-11). */
export type FuncionamentoDeAgenda =
  | { readonly definido: false }
  | { readonly definido: true; readonly dias: readonly (readonly { readonly inicioMin: number; readonly fimMin: number }[])[] }; // 7 itens

export type EntradaDeCalculo = {
  readonly agora: Date;
  readonly regras: RegrasDeAgenda;
  readonly funcionamento: FuncionamentoDeAgenda; // [Rev.1] obrigatório (sem padrão: o chamador decide)
  readonly duracaoMin: number;               // inteiro > 0 (soma, RN-2)
  readonly datas: readonly DataCivil[];      // em ordem crescente, sem repetição
  readonly bloqueiosDoSalao: readonly Intervalo[]; // profissional_id nulo: valem para todos
  readonly profissionais: readonly AgendaDoProfissional[];
};

export type HorarioOferecido = {
  readonly inicio: Date;
  readonly fim: Date; // inicio + duracaoMin (tempo real)
  readonly local: { readonly data: DataCivil; readonly minutosDoDia: number };
};
export type DiaDeDisponibilidade = { readonly data: DataCivil; readonly horarios: readonly HorarioOferecido[] };
export type DisponibilidadeCalculada = ReadonlyArray<{ readonly profissionalId: string; readonly dias: readonly DiaDeDisponibilidade[] }>;

// calendario.ts
export function diaDaSemana(d: DataCivil): 0 | 1 | 2 | 3 | 4 | 5 | 6;     // via Date.UTC(...).getUTCDay()
export function datasDoPeriodo(de: DataCivil, ate: DataCivil): DataCivil[]; // inclusive; ate < de → RangeError
export function limitesDaJanela(agora: Date, regras: RegrasDeAgenda): { hoje: DataCivil; ultima: DataCivil }; // hoje = partesLocais(agora).data; ultima = hoje + janelaDias
export function periodoDeLeitura(de: DataCivil, ate: DataCivil, regras: RegrasDeAgenda): { de: Date; ate: Date }; // A-7
// funcionamento.ts [Rev.1]
export function validarFuncionamento(f: FuncionamentoDeAgenda): void; // RangeError se forma inválida (A-12)
/** jornada ∩ funcionamento do dia, em minutos; `funcionamentoDoDia === null` (não informado) devolve a jornada. Entradas canônicas; saída ordenada e disjunta, sem vazios. */
export function janelasDoDia(jornadaDoDia: readonly { inicioMin: number; fimMin: number }[], funcionamentoDoDia: readonly { inicioMin: number; fimMin: number }[] | null): { inicioMin: number; fimMin: number }[];
// calcular.ts
export function calcularDisponibilidade(e: EntradaDeCalculo): DisponibilidadeCalculada;
```

**Algoritmo obrigatório de `calcularDisponibilidade`** (correção e CA-27):

1. Valida as regras e a duração (inteiros nas faixas acima; caso contrário, `RangeError`, que é erro de programação), `agora` (um `Date` válido) e **[Rev.1]** o funcionamento (`validarFuncionamento`). Calcula `limiteAntecedencia = agora + antecedenciaMin·60 000` e `{hoje, ultima}`.
2. Normaliza cada lista de intervalos: copia, ordena por `(inicio, fim)` e une os que se sobrepõem ou encostam, porque para a busca a união é equivalente. Os bloqueios de cada profissional são unidos **com** `bloqueiosDoSalao`. A ordem da entrada é irrelevante (CA-24).
3. Para cada data `d` dentro de `[hoje, ultima]`: monta **uma vez**, compartilhada por todos os profissionais, a `gradeDoDia(d)`. Para cada `m = 0, g, 2g, … < 1440`, calcula `t = instanteDeHoraLocal(d, m)` e só o mantém se `partesLocais(t)` devolve exatamente `(d, m)` (RN-10: descarta a hora inexistente; a hora repetida dá só a 1ª ocorrência). Pode restringir `m` ao intervalo `[min início, máx fim)` das **janelas** (passo 4) do dia da semana entre os profissionais. **[Rev.1]** A grade continua contada a partir de 00:00 (RN-22), nunca do início da interseção. As conversões dos limites de jornada (`fim = 1440` → `instanteDeHoraLocal(d+1, 0)`, RN-9) ficam em cache por `(d, minuto)`. **Nenhuma chamada a `fuso.ts` por (candidato × profissional).**
4. **[Rev.1]** Para cada profissional, as janelas do dia da semana `w` são `janelasDoDia(jornada(P, w), funcionamento.definido ? funcionamento.dias[w] : null)`, calculadas **uma vez por (profissional, dia da semana)** e reaproveitadas pelas datas do mesmo `w` (a interseção é em minutos de parede, A-10, e os limites só viram instantes depois, pelo cache do passo 3). Para cada janela `[J0, J1)` (instantes), varre os candidatos da grade com `J0 ≤ t` e `t + dur ≤ J1` (RN-3a, RN-11), `t ≥ limiteAntecedencia` (RN-5) e:
   - `[t, t+dur)` não intersecta a união de bloqueios: busca binária pelo último bloqueio com `inicio < t+dur` e verifica `fim > t` (RN-3b);
   - `[t, t+dur+intervalo)` não intersecta a união de ocupações, pelo mesmo teste (RN-3c, D-7).
5. Datas fora de `[hoje, ultima]` → `horarios: []`. A saída segue a ordem de `profissionais` e de `datas`, com os horários em ordem crescente de instante. Os rótulos locais vêm da grade (sem nova conversão).

Complexidade: `O(D·G)` conversões de fuso + `O(P·D·G·log B)` comparações + **[Rev.1]** `O(P·7·(a+b))` para as interseções, desprezível; o funcionamento não adiciona conversão por (candidato × profissional). Para o CA-27, são 17.568 conversões (~0,32 s medidos); o teste de desempenho passa a rodar também com funcionamento informado (com pausas) e o contador estrutural independe de P nos dois estados.

### 3.2 Contexto (`src/server/tenant/context.ts`)

```ts
/** Leituras de agenda (disponibilidade): página pública, equipe e sistema. Nunca admin. */
export type ContextoDeLeituraDeAgenda = PublicoContext | ContextoEscopado;
/** Só 'publico' | 'tenant' | 'sistema' com salaoId UUID; senão Error('leitura de agenda exige PublicoContext, TenantContext ou SistemaContext'). Devolve o salaoId. */
export function exigirLeituraDeAgenda(ctx: ContextoDeLeituraDeAgenda): string;
```

### 3.3 Repositório (`src/server/repos/disponibilidade.ts`)

```ts
export type RegrasDoSalao = { fuso: string; gradeMin: number; antecedenciaMin: number; janelaDias: number; intervaloMin: number };
/** [Rev.1] Regras + funcionamento vindos da MESMA instrução (A-9). `funcionamento` é o FuncionamentoDTO de repos/tipos (linhas brutas), convertido pelo serviço. */
export type RegrasEFuncionamento = { regras: RegrasDoSalao; funcionamento: FuncionamentoDTO };
export type ServicoOfertavel = { id: string; nome: string; precoCentavos: number; duracaoMin: number };
export type CandidatoProfissional = { id: string; nome: string; ativo: boolean; vinculos: number };
export type LinhaJornadaDeAgenda = { profissionalId: string; diaSemana: number; inicioMin: number; fimMin: number };
export type BloqueioDeAgenda = { profissionalId: string | null; inicio: Date; fim: Date };   // sem motivo
export type OcupacaoDeAgenda = { profissionalId: string; inicio: Date; ocupadoAte: Date };   // sem id, cliente, status

export interface RepoDisponibilidade {
  /** 1 SQL ([Rev.1] $queryRaw sobre `salao s` com COLUNAS_FUNCIONAMENTO). Salão do contexto; sem linha → NaoEncontrado. */
  lerRegras(ctx: ContextoDeLeituraDeAgenda): Promise<RegrasEFuncionamento>;
  /** 1 SQL (Prisma findMany com ondeServicoOfertavel + id IN). Ids não-UUID são descartados antes; lista resultante vazia → [] sem SQL. */
  servicosOfertaveis(ctx: ContextoDeLeituraDeAgenda, ids: readonly string[]): Promise<ServicoOfertavel[]>;
  /** 1 SQL. profissionalId null → ativos do salão; senão só ele (ativo ou não). Ordem nome, id. vinculos = nº de servicoIds vinculados. profissionalId malformado → NaoEncontrado sem SQL. */
  candidatos(ctx: ContextoDeLeituraDeAgenda, servicoIds: readonly string[], profissionalId: string | null): Promise<CandidatoProfissional[]>;
  /** 1 SQL; lista vazia → [] sem SQL. Ordem profissional, dia, início. */
  jornadas(ctx: ContextoDeLeituraDeAgenda, profissionalIds: readonly string[]): Promise<LinhaJornadaDeAgenda[]>;
  /** 1 SQL: do salão (profissional_id nulo) + dos informados, que intersectam [de, ate). */
  bloqueios(ctx: ContextoDeLeituraDeAgenda, profissionalIds: readonly string[], periodo: Periodo): Promise<BloqueioDeAgenda[]>;
  /** 1 SQL (consultaOcupacoes); lista vazia → [] sem SQL. */
  ocupacoes(ctx: ContextoDeLeituraDeAgenda, profissionalIds: readonly string[], periodo: Periodo): Promise<OcupacaoDeAgenda[]>;
}
export function criarRepoDisponibilidade(db: Executor): RepoDisponibilidade;
/** Exportada só para o teste de plano (CA-25). */
export function consultaOcupacoes(salaoId: string, profissionalIds: readonly string[], periodo: Periodo): Prisma.Sql;
```

Todo método começa com `exigirLeituraDeAgenda(ctx)` e filtra por `salao_id`. Os ids de profissional passados a `jornadas`/`bloqueios`/`ocupacoes` vêm de `candidatos` (já do salão), mas o filtro por `salao_id` continua obrigatório (defesa em profundidade).

SQL proposto (o DBA revisa em T-0; **não** troque os literais por parâmetros nem junte variantes com `$p IS NULL OR …`, lição da D-016):

```sql
-- ocupacoes (consultaOcupacoes)
SELECT x.pid::text AS profissional_id, o.inicio, o.ocupado_ate
  FROM unnest(${ids}::uuid[]) AS x(pid)
  CROSS JOIN LATERAL (
    SELECT r.id, r.inicio, r.ocupado_ate
      FROM reserva r
     WHERE r.profissional_id = x.pid
       AND r.salao_id = ${salaoId}::uuid
       AND r.status IN ('confirmado', 'concluido', 'nao_compareceu')
       AND tstzrange(r.inicio, r.ocupado_ate, '[)') && tstzrange(${de}::timestamptz, ${ate}::timestamptz, '[)')
  ) o
 ORDER BY x.pid, o.inicio, o.id;

-- bloqueios (usa bloqueio_periodo_idx: salao_id + tstzrange)
SELECT b.profissional_id::text AS profissional_id, b.inicio, b.fim
  FROM bloqueio b
 WHERE b.salao_id = ${salaoId}::uuid
   AND tstzrange(b.inicio, b.fim, '[)') && tstzrange(${de}::timestamptz, ${ate}::timestamptz, '[)')
   AND (b.profissional_id IS NULL OR b.profissional_id = ANY(${ids}::uuid[]))
 ORDER BY b.inicio, b.id;

-- candidatos (variante sem profissional; a outra troca "AND p.ativo" por "AND p.id = ${pid}::uuid")
SELECT p.id::text AS id, p.nome, p.ativo,
       (SELECT count(*)::int FROM servico_profissional sp
         WHERE sp.salao_id = p.salao_id AND sp.profissional_id = p.id
           AND sp.servico_id = ANY(${servicoIds}::uuid[])) AS vinculos
  FROM profissional p
 WHERE p.salao_id = ${salaoId}::uuid AND p.ativo
 ORDER BY p.nome, p.id;
```

`jornadas` usa o Prisma Client (`jornada.findMany` com `profissionalId: { in }`), uma instrução. **[Rev.1]** `lerRegras` passa a SQL bruto (A-9):

```sql
-- lerRegras
SELECT s.fuso, s.grade_min, s.antecedencia_min, s.janela_dias, s.intervalo_min, ${COLUNAS_FUNCIONAMENTO}
  FROM salao s
 WHERE s.id = ${salaoId}::uuid;
```

Os nomes das colunas de regras são os de `schema.prisma` (`@map`); o desenvolvedor confere. O texto exato de `COLUNAS_FUNCIONAMENTO` não é copiado nem alterado. Plano esperado: *Index Scan* em `salao_pkey` e, para a subconsulta, acesso a `salao_funcionamento` por `salao_id` (só executada quando `funcionamento_definido`); o DBA confirma (T-0, pendência 6). O precedente de `uuid[]` em `$queryRaw` está em `servico.ts:182`.

### 3.4 Serviço (`src/server/disponibilidade`)

```ts
export type EntradaDisponibilidade = {
  servicoIds: readonly string[];     // 1..10, sem repetição (D-4)
  profissionalId?: string | null;    // opcional (D-3)
  de: DataCivil; ate: DataCivil;     // inclusive (D-1)
  agora: Date;                       // obrigatório (D-6)
};
export type MotivoEntradaInvalida =
  | 'servicos_vazio' | 'servicos_repetidos' | 'servicos_demais'
  | 'data_invalida' | 'periodo_invertido' | 'periodo_longo';
export type ServicoEscolhido = { id: string; nome: string; duracaoMin: number; precoCentavos: number };
export type DisponibilidadeDeProfissional = { profissionalId: string; nome: string; dias: DiaDeDisponibilidade[] };
export type ResultadoDisponibilidade =
  | { resultado: 'ok'; fuso: string; duracaoTotalMin: number; precoTotalCentavos: number;
      servicos: ServicoEscolhido[];                 // na ordem de servicoIds
      profissionais: DisponibilidadeDeProfissional[] } // ordem nome, id (RN-17)
  | { resultado: 'servico_indisponivel' }
  | { resultado: 'entrada_invalida'; motivo: MotivoEntradaInvalida };

export async function consultarDisponibilidade(
  ctx: ContextoDeLeituraDeAgenda, entrada: EntradaDisponibilidade,
  leitor?: RepoDisponibilidade,   // padrão repos().disponibilidade; E3.2: r.disponibilidade de emTransacao
): Promise<ResultadoDisponibilidade>;   // lança NaoEncontrado (RN-16) e RangeError para `agora` inválido

export async function listarProfissionaisElegiveis(
  ctx: ContextoDeLeituraDeAgenda, servicoIds: readonly string[], leitor?: RepoDisponibilidade,
): Promise<{ resultado: 'ok'; profissionais: { id: string; nome: string }[] }
         | { resultado: 'servico_indisponivel' }
         | { resultado: 'entrada_invalida'; motivo: 'servicos_vazio' | 'servicos_repetidos' | 'servicos_demais' }>;
```

Sequência de `consultarDisponibilidade` (A-4):

| Passo | SQL | Saída antecipada |
|---|---|---|
| 1. `validarEntrada` (pura): lista 1..10, sem repetição; datas com `ehDataCivilValida`; `ate ≥ de` | 0 | `entrada_invalida` |
| 2. `profissionalId` informado e não UUID | 0 | `NaoEncontrado` |
| 3. `lerRegras` ([Rev.1] regras **e** funcionamento) | 1 | — |
| 4. `datasDoPeriodo(de, ate).length > janelaDias + 1` | — | `entrada_invalida/periodo_longo` |
| 5. `servicosOfertaveis` (se algum id não volta → indisponível) | 2 | `servico_indisponivel` |
| 6. `candidatos`; com `profissionalId` e nenhuma linha → `NaoEncontrado`; elegível = `ativo && vinculos === n` | 3 | — |
| 7. Recorta `[de, ate]` à janela; sem elegíveis ou recorte vazio → resultado `ok` com dias vazios | — | `ok` sem as leituras 4–6 |
| 8. `jornadas`, `bloqueios`, `ocupacoes` (`Promise.all`) no `periodoDeLeitura` do recorte | 4, 5, 6 | — |
| 9. `calcularDisponibilidade` com as datas pedidas e o `FuncionamentoDeAgenda` ([Rev.1]: `definido ? { definido: true, dias: semana.map(d => d.intervalos) } : { definido: false }`) | — | `ok` |

**[Rev.1]** O funcionamento não muda nenhum curto-circuito: com o salão fechado em todos os dias (CA-32) o resultado é `ok` com dias vazios e as leituras 4–6 **continuam** emitidas (a economia seria uma ramificação nova sem ganho; a contagem permanece 6). `servico_indisponivel` vem antes de `NaoEncontrado` (passo 5 antes do 6). `listarProfissionaisElegiveis` = passos 1, 5 e 6 (com `profissionalId` nulo), em 2 instruções SQL.

## 4. Dados

- **Sem migração, sem mudança de esquema.** Índices usados: `reserva_sem_sobreposicao` (GiST parcial `profissional_id, tstzrange(inicio, ocupado_ate)`, status ativos), `bloqueio_periodo_idx` (GiST `salao_id, tstzrange(inicio, fim)`), `jornada_salao_id_profissional_id_dia_semana_idx` e as PKs/índices de `servico_profissional` e `profissional`.
- **[Rev.1]** `salao_funcionamento`: sem migração. Acesso pela subconsulta de `COLUNAS_FUNCIONAMENTO` (`WHERE f.salao_id = s.id AND s.funcionamento_definido`), 1 linha de `salao` e no máximo ~42 de `salao_funcionamento`. A EXCLUDE `salao_funcionamento_sem_sobreposicao` (GiST com `salao_id` por igualdade via `btree_gist`) é o índice candidato; o DBA confirma se atende ou se falta índice btree em `salao_id`.
- **DBA acionado (T-0)** para revisar a forma da consulta de ocupação (LATERAL × `ANY`), o plano com volume, a distribuição dos dados de volume e a consulta de bloqueios. Se o parecer exigir um índice novo, ele vira a tarefa T-0b (dba: migração própria) antes de T-3, e este desenho ganha uma "Revisão 1".

### Transferência para o DBA

```
DEMANDA: D-018 — horários disponíveis (E3.1)
DE: arquiteto-software  PARA: dba
OBJETIVO: aprovar (ou corrigir) as consultas de leitura de agenda e o método do teste de plano antes da implementação do repositório.
CONTEXTO NECESSÁRIO: design.md §3.3 (6 leituras, 1 SQL cada, em lote por profissionais; contexto público, de tenant ou de sistema; projeção mínima). A ocupação deve usar a mesma expressão e o mesmo predicado literal de status da exclusion reserva_sem_sobreposicao (migração 20261118000100). Propus unnest + CROSS JOIN LATERAL porque o GiST não usa "= ANY(array)" como condição de índice; dba.md da D-001 (§E3.1/E3.2) sugeria "= ANY".
CRITÉRIOS DE ACEITAÇÃO: CA-41 (a leitura do funcionamento não soma instrução), CA-25 (EXPLAIN (ANALYZE) com 2 salões × 10 profissionais × 5.000 reservas, sem Seq Scan em reserva, com uso de reserva_sem_sobreposicao ou outro índice), CA-26 (número constante de consultas), RN-19.
DECISÕES JÁ TOMADAS: sem migração prevista; literal de status no texto (lição D-016); período [00:00 local d1, 00:00 local d2+1 + intervalo); filtro por salao_id em toda consulta; sem transação/snapshot (D-10).
ARQUIVOS ENVOLVIDOS: só docs/demandas/D-018/dba.md (parecer). Leitura: design.md §3.3/§8.3, src/server/repos/funcionamento.ts (COLUNAS_FUNCIONAMENTO), migração 20261120000000_perfil_funcionamento, src/server/repos/reserva.ts (consultaReservasQueCruzam), tests/integration/bloqueios/repos.test.ts:320-370 (método do plano genérico), migrações 20261118000100/20261118000200.
EVIDÊNCIAS: design.md; medida do domínio (0,32 s com grade compartilhada).
PENDÊNCIAS: (0) [Rev.1] ver a pendência 6 abaixo; (1) LATERAL × ANY: qual usar, e se o plano genérico (force_generic_plan) mantém o índice; (2) distribuição do volume (§8.3: 5.000 reservas/prof. espalhadas em ~4 anos, ~10% canceladas, consulta de 61 dias), se torna o plano estável com ANALYZE, sem DROP INDEX nem enable_seqscan=off; (3) se a consulta de bloqueios com "profissional_id IS NULL OR = ANY" usa bloqueio_periodo_idx; (4) se precisa de índice novo (ex.: jornada já coberta); (5) asserções do teste: proibir "Seq Scan on reserva" e exigir "Index Scan|Bitmap Index Scan … on reserva_*"; (6) [Rev.1] `lerRegras` agora é `SELECT s.fuso, …, ${COLUNAS_FUNCIONAMENTO} FROM salao s WHERE s.id = $1` (§3.3, `COLUNAS_FUNCIONAMENTO` em `src/server/repos/funcionamento.ts`): confirmar plano estável (PK de `salao` + acesso a `salao_funcionamento` por `salao_id`), se a EXCLUDE GiST atende `f.salao_id = s.id` ou se é preciso índice, sem migração se possível; com 1 salão de 7 dias × 6 intervalos e com 2.000 salões; `EXPLAIN` com `funcionamento_definido` verdadeiro e falso (a subconsulta não deve executar no falso).
PRÓXIMA AÇÃO: T-0 → parecer em dba.md; o desenvolvedor só começa T-3 depois dele.
```

## 5. Infraestrutura

Sem variável de ambiente nova, sem container, sem mudança de CI (os testes novos entram nos jobs `lint`, `typecheck` e `testes` existentes), sem observabilidade nova. **DevOps dispensado.** Restrição de orçamento: o arquivo de volume (CA-25) deve rodar em menos de ~15 s locais. A geração do volume é feita por um único `INSERT … SELECT generate_series` por salão, não por fábrica linha a linha.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como |
|---|---|---|
| Escopo por salão no servidor | Sim | **[Rev.1]** O funcionamento vem da mesma linha `salao s` do contexto (CA-40). Toda leitura começa com `exigirLeituraDeAgenda` e filtra `salao_id`. Ids estranhos ao salão: serviço → `servico_indisponivel`, profissional → `NaoEncontrado`. `AdminContext` é recusado no tipo e em execução. Testes de isolamento: CA-20 e bloqueio de salão de S2 sem efeito em S1. |
| Exclusion constraint anti-sobreposição | Sim (leitura) | A ocupação repete `tstzrange(inicio, ocupado_ate, '[)')` e o literal de status da constraint (RN-19). O cálculo é só experiência do usuário: a E3.2 revalida e a constraint garante. |
| UTC com fuso do salão | Sim | **[Rev.1]** O funcionamento é hora de parede: interseção em minutos e conversão só por `fuso.ts` (A-10); troca de fuso reinterpreta os mesmos minutos (CA-39). Entradas e saídas em `Date` UTC com partes locais. Conversão só por `fuso.ts`; fuso lido do salão a cada chamada (RN-13). Lint proíbe métodos de data em hora local no domínio; unitários rodados com `TZ=UTC` e `TZ=America/Sao_Paulo`. |
| Adaptadores de integração | Não | Nenhuma integração é chamada. |
| Soft delete e anonimização | Sim | Profissional e serviço inativos ficam fora (RN-1, RN-16). Reservas de cliente anonimizada e de serviço desativado continuam ocupando (RN-7, CA-12), porque a consulta não junta `cliente` nem `servico`. |
| Salão suspenso somente leitura | Não nesta demanda | E6.4 (fora do escopo). O cálculo é leitura e não muda estado. Quem chama aplica a política. |
| Idempotência de webhooks e mensagens | Não | Sem escrita e sem fila. |
| Auditoria do super admin | Não | `AdminContext` é recusado. Não há ação de admin. |
| Multisserviço com um profissional | Sim | Elegível = vinculado a todos (RN-1). A duração total é a soma, executada em sequência (RN-2). O snapshot fica para a E3.2. |
| Encaixe da equipe | Não (Rev.1) | O funcionamento só limita a oferta pública; E3.4 segue permitindo encaixe fora dele (D-16). Reservas de encaixe continuam ocupando (CA-38). |
| Fora da v1 | Sim | Nada de preço/duração por profissional nem de "qualquer profissional" (D-3). |

## 7. Riscos e decisões

| Risco | Impacto | Mitigação |
|---|---|---|
| R-1 Custo de `Intl` em `fuso.ts` | CA-27 > 2 s | Grade do dia memoizada e compartilhada (§3.1, passo 3): 0,32 s medidos contra 2,9 s. Teste estrutural determinístico: o nº de chamadas a `instanteDeHoraLocal` independe do nº de profissionais (§8.1). |
| R-2 Planejador escolhe Seq Scan no volume | CA-25 instável | LATERAL por profissional. Volume espalhado no tempo (seletividade de ~4%). `ANALYZE` antes do `EXPLAIN`. Plano custom **e** genérico. Parecer do DBA (T-0). |
| R-3 Ampliar o que o `PublicoContext` alcança | Vazamento | Repositório próprio com projeção mínima (sem cliente, status, motivo). Teste que lista as chaves exatas de cada DTO. Guarda que recusa admin. Os demais repositórios continuam recusando o público (CA-13 da D-005 inalterado). |
| R-4 Divergência da regra de "ofertável" | Página e cálculo discordam | Predicado único (A-3). Teste de equivalência: para cada serviço do salão, `listarServicosPublicos` o lista ⇔ `servicosOfertaveis` o devolve. |
| R-5 Fim de jornada 1440 e DST | Horários errados nas viradas | RN-9 no passo 3. CA-16, CA-17 e CA-18 como unitários com valores exatos. |
| R-6 Teste de tempo flaky na CI | Falso vermelho | Aquecimento antes da medida; limite de 2 s (~6× o medido); `it` com timeout de 30 s; tempo registrado em `dev.md`. A garantia principal é estrutural (R-1). |
| R-7 Contagem de SQL depender de detalhe do Prisma | CA-26 frágil | Evento `query` verificado no Prisma 7.10.1. O teste conta só instruções que não são de controle de transação e exige igualdade entre os dois cenários **e** `=== 6`. |
| R-8 Leituras não atômicas | Horário recém-tomado ainda oferecido | Aceito (D-10). A E3.2 revalida dentro da transação, e a constraint é a garantia final. |
| R-9 Fuso local da máquina contaminar o cálculo | Erro só em produção | Lint (A-1) e execução dos unitários com dois `TZ`. |
| R-11 [Rev.1] `lerRegras` em SQL bruto perde a tipagem do Prisma | Coluna renomeada quebra só em execução | Teste de repositório que lê um salão real; `funcionamentoDaLinha` já valida a forma; nomes conferidos com `schema.prisma`. |
| R-12 [Rev.1] Salão `definido:true` sem intervalos tratado como "não informado" | Oferta indevida | A-11 (só `definido`); CA-32 e CA-31 (linhas residuais). |
| R-13 [Rev.1] Interseção feita em instantes duplica conversões | CA-27 | A-10: minutos de parede, par a par, conversão pelo cache; desempenho medido com funcionamento. |
| R-14 [Rev.1] Cobertura do módulo novo | Gate 90% | `funcionamento.ts` ≥ 95% por unidade (§8.1). |
| R-10 Desvio dos caminhos citados na issue | Revisor procura no lugar errado | Registrado em §1.1. `dev.md` lista os caminhos reais. |

## 8. Estratégia de testes

Convenções: relógio sempre injetado; `it` com timeout explícito em laços, volume e processos (30 s nos unitários de carga, 60–120 s no volume); integração com `npm test` (4 workers) e base própria por arquivo; nenhum mock de banco.

### 8.1 Unidade (`src/domain/disponibilidade/*.test.ts`, `src/server/disponibilidade/validacao.test.ts`, `src/server/tenant/context.test.ts`)

- `calcular.test.ts`: CA-2, CA-3 (unidade), CA-4, CA-6, CA-7, CA-8, CA-10, CA-13, CA-14, CA-15, CA-16, CA-22, mais casos limite (duração maior que a jornada, antecedência 0 com início = `agora`, duração fora da grade, jornada 09:05 com grade 15).
- `dst.test.ts`: CA-17 e CA-18 (`America/New_York`, valores exatos de rótulo e instante; ausência de rótulos duplicados) e `America/Sao_Paulo` 04/11/2018 (opcional).
- `determinismo.test.ts`: CA-24 (entrada embaralhada → `toEqual`; `vi.useFakeTimers({ now: <outra data> })` não altera o resultado).
- `desempenho.test.ts`: CA-27 (aquecimento, `performance.now()`, `< 2000` ms, imprime `[CA-27] ms=…`) e o contador estrutural (`vi.mock('@/server/tempo/fuso', importOriginal)` envolvendo as funções; com 1 e com 10 profissionais o nº de chamadas é igual). Esse módulo é puro, sem banco, então não conta como mock de banco.
- **[Rev.1]** `funcionamento.test.ts` (interseção e validação: pares, vazios, bordas encostadas, 1440, não informado devolve a jornada, 7 dias sem intervalos, `RangeError`) e `calcular-funcionamento.test.ts`: CA-28, CA-29 (parte unidade), CA-30, CA-31 (parte unidade, `toEqual` contra o cálculo sem funcionamento), CA-32, CA-33, CA-34, CA-35, CA-37, CA-38 (unidade), CA-42, CA-43, CA-44. `dst.test.ts` acrescenta CA-36. `desempenho.test.ts` acrescenta o caso com funcionamento (CA-27) e o contador estrutural nos dois estados.
- `calendario.test.ts`, `intervalos.test.ts`: limites (`fim = 1440`, `datasDoPeriodo` atravessando mês e ano bissexto, união de bloqueios sobrepostos e encostados, busca binária nas bordas).
- `validacao.test.ts`: CA-21 (todos os motivos).
- `context.test.ts`: `exigirLeituraDeAgenda` aceita publico, tenant e sistema e recusa admin, objeto forjado e salaoId não UUID.
- Execução extra (evidência em `dev.md`): `TZ=UTC npx vitest run --project unit src/domain/disponibilidade` e `TZ=America/Sao_Paulo npx vitest run --project unit src/domain/disponibilidade`.

### 8.2 Integração (`tests/integration/disponibilidade/`)

- `apoio.ts`: monta cenários sobre `criarSalaoCompleto` com as fábricas existentes e SQL direto (`tests/support/sql.ts`): serviços A (30 min, R$ 50) e B (45 min, R$ 80), Ana e Bia, jornadas, bloqueios, reservas com `status`/`encaixe`/`ocupado_ate` e cliente anonimizada. **Não** altera `tests/support/**`.
- `repo.test.ts` (T-3): cada método emite 1 SQL; chaves exatas dos DTOs (sem dados de cliente nem `motivo`); `AdminContext` recusado (`@ts-expect-error` + Error); equivalência de ofertáveis com `listarServicosPublicos` (R-4); filtro por salão em cada método.
- `plano.test.ts` (T-3, CA-25): 2 salões × 10 profissionais × 5.000 reservas (§8.3); `EXPLAIN (ANALYZE, BUFFERS)` da `consultaOcupacoes` com 10 profissionais × 61 dias e com 1 × 1; plano genérico por `PREPARE` + `plan_cache_mode = force_generic_plan`. Asserções: sem `Seq Scan on reserva`; com `Index Scan`/`Bitmap Index Scan` em índice de `reserva` (`reserva_sem_sobreposicao` esperado). Imprime o plano com o prefixo `[CA-25]` para a evidência.
- **[Rev.1]** `servico.test.ts` (T-4) também cobre CA-29, CA-31, CA-32, CA-38 (parte integração) e CA-39 (troca de fuso); `isolamento.test.ts`, CA-40; `consultas.test.ts`, CA-41 (4 cenários: 1×1 e 10×61, com e sem funcionamento, todos `=== 6`); `repo.test.ts` (T-3): `lerRegras` devolve regras e funcionamento numa instrução, `definido:false` com linhas residuais → `linhas: []`, salão de S2 não vaza. Estado alternado entre duas consultas (sem cache, RN-24) em `servico.test.ts`.
- `servico.test.ts` (T-4): CA-1, CA-3 (integração), CA-5, CA-9, CA-11, CA-12, CA-19, CA-22 (integração), CA-23 e datas fora da janela (CA-21, parte "sem erro").
- `isolamento.test.ts` (T-4): CA-20 (resultado de S1 igual com e sem os dados de S2, comparando contra uma base sem S2 pela mesma fábrica, ou com os dados de S2 inseridos entre duas consultas idênticas de S1; serviço de S2 → `servico_indisponivel`; profissional de S2 → `NaoEncontrado`), bloqueio de salão de S2 sem efeito em S1, `PublicoContext` resolvido pelo slug dá o mesmo resultado que o `TenantContext` do gestor.
- `consultas.test.ts` (T-4): CA-26 (cliente com `log` de evento → `criarRepos(cliente).disponibilidade`; 1×1 e 10×61 → mesma contagem, igual a 6) e CA-21 (entradas inválidas → nenhuma instrução com `FROM reserva` / `reserva r`).
- `tests/integration/lint/importacao-dominio.test.ts` (T-2): proibidos em `src/domain/x.ts` (`@/server/repos`, `@/server/tenant/context`, `next/headers`, `react`, Prisma, `pg-boss`, relativo `../server/repos/db`) e permitidos (`@/server/tempo/fuso`, `./tipos`); `Date.now()`, `new Date()` e `d.getDay()` acusados; `new Date(0)` e `d.getUTCDay()` aceitos; as regras gerais continuam valendo fora do domínio.

### 8.3 Volume (CA-25)

Por salão: 10 profissionais e uma cliente. Um `INSERT … SELECT` com `generate_series(0, 4999)` por profissional, `inicio = base + g · interval '7 hours'` (≈ 4 anos, sem sobreposição), `fim = inicio + 30 min`, `ocupado_ate = fim`, status `cancelado` quando `g % 10 = 0`, e o restante distribuído entre `confirmado`, `concluido` e `nao_compareceu`. Depois, `ANALYZE reserva`. A consulta cobre 61 dias dentro do intervalo (~210 reservas por profissional, ~4%). Timeout: `beforeAll` 120 s, cada `it` 60 s. O DBA pode ajustar a distribuição em T-0.

### 8.4 E2E

Não se aplica (sem tela).

### 8.5 Cobertura

Os módulos novos são cobertos por unidade (domínio e validação) e integração (repositório e serviço). Não há exclusão nova. O desenvolvedor anexa o resumo de `npm run test:coverage` (≥ 90% de linhas) e a cobertura por arquivo dos novos módulos (alvo ≥ 95%).

### 8.6 Mapa CA → tarefa → teste

| CA | Tarefa | Tipo | Arquivo |
|---|---|---|---|
| CA-1 | T-4 | integração | `servico.test.ts` |
| CA-2, CA-4, CA-6, CA-7, CA-8, CA-10, CA-13, CA-14, CA-15, CA-16 | T-1 | unidade | `calcular.test.ts` |
| CA-3 | T-1, T-4 | unidade + integração | `calcular.test.ts`, `servico.test.ts` |
| CA-5, CA-9, CA-11, CA-12, CA-19, CA-23 | T-4 | integração | `servico.test.ts` |
| CA-17, CA-18 | T-1 | unidade | `dst.test.ts` |
| CA-20 | T-4 | integração | `isolamento.test.ts` |
| CA-21 | T-4 | unidade + integração | `validacao.test.ts`, `consultas.test.ts`, `servico.test.ts` |
| CA-22 | T-1, T-4 | unidade + integração | `calcular.test.ts`, `servico.test.ts` |
| CA-24 | T-1 | unidade | `determinismo.test.ts` |
| CA-25 | T-0, T-3 | integração (plano) | `plano.test.ts` |
| CA-26 | T-4 | integração | `consultas.test.ts` |
| CA-27 | T-1 | unidade | `desempenho.test.ts` |
| CA-28, CA-30, CA-33, CA-34, CA-35, CA-37, CA-42, CA-43, CA-44 | T-1 | unidade | `calcular-funcionamento.test.ts`, `funcionamento.test.ts` |
| CA-29, CA-31, CA-32, CA-38 | T-1, T-4 | unidade + integração | `calcular-funcionamento.test.ts`, `servico.test.ts` |
| CA-36 | T-1 | unidade (DST) | `dst.test.ts` |
| CA-39 | T-4 | integração | `servico.test.ts` |
| CA-40 | T-4 | integração | `isolamento.test.ts` |
| CA-41 | T-3, T-4 | integração | `repo.test.ts`, `consultas.test.ts` |
| CA-25 (lerRegras com funcionamento) | T-0, T-3 | integração (plano, `EXPLAIN` do `lerRegras`) | `plano.test.ts` |

## 9. Tarefas

Ordem (**[Rev.1]** inalterada; o funcionamento estende T-0, T-1, T-3, T-4 sem criar arquivo compartilhado): rodada 1 **T-0 ∥ T-1 ∥ T-2** (arquivos disjuntos: `dba.md` / `src/domain/disponibilidade/**` / `eslint.config.mjs` + teste de lint); rodada 2 **T-3** (depende de T-0; usa só tipos do repositório, não de T-1); rodada 3 **T-4** (depende de T-1 e T-3: importa `FuncionamentoDeAgenda` e `calcularDisponibilidade` de T-1 e `lerRegras` de T-3); rodada 4 **T-5**. Com um único desenvolvedor, a ordem sugerida é T-1 → T-2 → T-3 → T-4 → T-5. As tarefas paralelas não compartilham arquivos.

| Tarefa | Responsável | Depende de | Arquivos sob posse | Entregável | Critério de conclusão |
|---|---|---|---|---|---|
| **T-0** Parecer das consultas | dba | — | `docs/demandas/D-018/dba.md` | parecer sobre §3.3/§8.3 (pendências 1–6 da transferência; **[Rev.1]** inclui o plano do `lerRegras` com `COLUNAS_FUNCIONAMENTO`) | parecer "aprovado" ou "aprovado com mudanças", com o SQL final; se houver índice novo, abre T-0b e pede a revisão do desenho |
| **T-1** Domínio puro | desenvolvedor | — | `src/domain/disponibilidade/**` (inclui os `*.test.ts`) | §3.1 + unitários §8.1 (exceto validação e contexto); **[Rev.1]** `funcionamento.ts` e testes de CA-28..CA-38, CA-42..CA-44 | CAs da tabela §8.6 de T-1 verdes (**[Rev.1]** incluindo `funcionamento.test.ts` com cobertura ≥ 95%); também verdes com `TZ=UTC` e `TZ=America/Sao_Paulo`; CA-27 < 2 s com o tempo registrado; contador estrutural verde; cobertura dos arquivos ≥ 95% |
| **T-2** Regra de camada | desenvolvedor | — (paralela a T-1) | `eslint.config.mjs`, `tests/integration/lint/importacao-dominio.test.ts` | bloco de lint A-1 (sem quebrar os blocos existentes; bloco de hosts mesclado no do domínio) | teste de lint novo e os três existentes (`importacao-*.test.ts`) verdes; `npm run lint` verde com T-1 presente |
| **T-3** Contexto, predicado e repositório | desenvolvedor | T-0 | `src/server/tenant/context.ts`, `src/server/tenant/context.test.ts`, `src/server/repos/publico.ts`, `src/server/repos/disponibilidade.ts`, `src/server/repos/index.ts`, `tests/integration/disponibilidade/apoio.ts`, `tests/integration/disponibilidade/repo.test.ts`, `tests/integration/disponibilidade/plano.test.ts` | §3.2, §3.3 (com o SQL do parecer; **[Rev.1]** `lerRegras` em SQL bruto com `COLUNAS_FUNCIONAMENTO`), testes §8.2 de T-3 | `repo.test.ts` e `plano.test.ts` verdes 10× seguidas (`for i in $(seq 10); do npx vitest run --project integration tests/integration/disponibilidade/plano.test.ts \|\| break; done`); plano `[CA-25]` copiado para `dev.md`; `tests/integration/tenant/publico.test.ts` e `contextos.test.ts` inalterados e verdes |
| **T-4** Serviço | desenvolvedor | T-1, T-3 | `src/server/disponibilidade/**` (inclui `validacao.test.ts`), `tests/integration/disponibilidade/{servico,isolamento,consultas}.test.ts`; `apoio.ts` passa a T-4 após T-3 concluída | §3.4 + testes §8.2 de T-4 | CAs de T-4 verdes; `consultas.test.ts` verde 10× seguidas; `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` verdes |
| **T-5** Documentação e evidências | desenvolvedor | T-4 | `CLAUDE.md` (parágrafo de status: D-018 e camada `src/domain/`; **[Rev.1]** substituir a obrigação registrada pela D-020 ("a E3.1 deve usar `lerFuncionamento` ou `COLUNAS_FUNCIONAMENTO`") por: cumprida por `lerRegras`, que projeta `COLUNAS_FUNCIONAMENTO` na mesma instrução das regras (6 consultas, constante), com a interseção jornada ∩ funcionamento em minutos de parede em `src/domain/disponibilidade/funcionamento.ts`; E3.2/E3.3 reutilizam `consultarDisponibilidade`; E3.4 (encaixe) não é limitada pelo funcionamento; tabela: linhas "Estabilidade da disponibilidade (D-018)" e "Unitários em dois fusos (D-018)"), `docs/demandas/D-018/dev.md` | docs + evidências (plano CA-25, tempos do CA-27, contagem do CA-26, duas execuções de `TZ`, cobertura) | `npm run test:coverage` ≥ 90%; `dev.md` com todos os comandos e saídas; nenhum outro arquivo alterado. README: só se o líder pedir (não há comando de usuário novo) |

Notas para o tester:
- Rodar os unitários do domínio com os dois `TZ`. Repetir `plano.test.ts` e `consultas.test.ts` 10× com `npm test` em paralelo (4 workers) pelo menos uma vez.
- Conferir no texto de `consultaOcupacoes` o literal `status IN ('confirmado', 'concluido', 'nao_compareceu')` e a expressão `tstzrange(r.inicio, r.ocupado_ate, '[)')`.
- Tentar `AdminContext` e `PublicoContext` de outro salão contra o repositório novo, e ids de S2 contra o serviço com contexto de S1.
- Verificar que nenhum DTO do repositório contém `cliente`, `status`, `motivo` ou o id da reserva.
- Casos de DST, `fim = 1440` e antecedência atravessando a meia-noite: comparar os instantes exatos, não só a quantidade.
