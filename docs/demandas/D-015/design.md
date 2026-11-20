# D-015 — Desenho: jornada semanal de cada profissional com pausas (issue #18, E2.3)

Entradas: `docs/demandas/D-015/spec.md` (RN-1..RN-15, CA-1..CA-20, D-1..D-10), `issue-18.md`, `CLAUDE.md`, `docs/demandas/D-013/design.md` (padrão de ações, trava `FOR UPDATE` da desativação) e `docs/demandas/D-014/design.md` (§3.2, ordem canônica de travas). Código lido: `src/server/auth/{permissoes,pagina}.ts`, `src/server/repos/{index,transacao,profissional}.ts`, `src/server/tenant/context.ts`, `src/server/profissionais/profissionais.acao.ts`, `src/app/painel/{page.tsx,profissionais/[id]/page.tsx,servicos/acoes.ts}`, `src/app/dev/componentes/page.tsx`, `src/components/ui/{Field,Alert}.tsx`, `src/config/navegacao.ts`, `src/lib/format.ts`, `prisma/schema.prisma` (modelo `Jornada`), `prisma/migrations/20261118000200_restricoes_sql/migration.sql:91-108`, `tests/support/factories.ts`, `playwright.config.ts`, `e2e/suporte/vitrine.ts` e o job `e2e` da CI.

## 0. Verificações feitas antes do desenho

- **O esquema basta.** Já existem a tabela `jornada`, a FK composta `(salao_id, profissional_id)`, `jornada_dia_semana_chk`, `jornada_faixa_chk` (`0 <= inicio < fim <= 1440`) e a exclusion `jornada_sem_sobreposicao` (`[início, fim)`, então intervalos contíguos não a violam). Nenhuma migração.
- **O núcleo não muda.** `defineAcao` entrega `{ agora }` e `exigirAcessoAoPainel(caminho, papeis, operacao)` aceita a operação. O registro `tests/integration/tenant/registro.test.ts` usa `import.meta.glob('/src/**/*.acao.ts')`, então enxerga o novo `jornadas.acao.ts` sem mudança.
- **Travas (PostgreSQL, READ COMMITTED):** `FOR NO KEY UPDATE` conflita com `FOR SHARE`, `FOR NO KEY UPDATE` e `FOR UPDATE`, mas **não** com `FOR KEY SHARE`. O `FOR KEY SHARE` é a trava que o PostgreSQL toma na linha de `profissional` quando alguém insere `reserva`, `jornada`, `convite` ou `servico_profissional` apontando para ela. A desativação (D-013) usa `FOR UPDATE`, e a E3.2 vai usar `FOR SHARE` (D-014 §11).
- **Exclusion e DELETE na mesma transação:** a verificação de exclusão (assim como a de unicidade) ignora as tuplas que a própria transação apagou. Por isso, `DELETE` seguido de `INSERT` de um intervalo sobreposto ao apagado não dá 23P01. Isso é provado por teste em T-2.
- **A fábrica já serve:** `criarSalaoCompleto` cria a jornada padrão (segunda a sábado, `(540,720)` e `(780,1080)`) para o profissional ativo e o perfil do gestor, devolve `jornadaIds` e aceita `salao.fuso` e `reserva.inicio`. O profissional inativo não tem jornada. **`tests/support/**` não muda**: os testes inserem ou apagam linhas por `conectar()` (SQL) no `apoio.ts` da demanda.
- **A matriz não tem leitura de jornada.** `'jornada.editar'` vale `salao`/`negado`/`negado`, e `permissoes.test.ts:21` enumera a matriz inteira, que precisa ser atualizada junto.
- **`ContextoEscopado` = `TenantContext | SistemaContext`.** O `PublicoContext` só é aceito em `repos/publico.ts`. A leitura para a E3.1 é desenhada sobre `ContextoEscopado`, e a variante pública fica como obrigação da E3.1 (§11).
- **O job `e2e` roda sem PostgreSQL** e não há seed (E9.2). Nenhum E2E existente usa sessão real. A vitrine `/dev/componentes` é contada por Tab em `a11y-base.spec.ts`, então mexer nela muda contagens já validadas.
- **`<input type="time">` não aceita `24:00`** (D-10). Por isso o campo é de texto.
- A convenção de testes unitários é `src/**/*.test.ts(x)`, que é o glob do projeto `unit`. O caminho `tests/unit/jornadas/intervalos.test.ts` citado na issue **não seria coletado**. O equivalente fica em `src/server/jornadas/validacao.test.ts`.

## 1. Resumo da solução

1. **Permissão:** nova operação `'jornada.ver'` na matriz: gestor `salao`, profissional `proprio`, super admin `negado` (D-8).
2. **Repositório** `src/server/repos/jornada.ts` (novo, ligado em `repos/index.ts`): listar as linhas de um profissional, travar a linha do profissional com `FOR NO KEY UPDATE` e aplicar uma diferença (apagar ids e inserir intervalos) no executor da transação.
3. **Domínio puro** `src/server/jornadas/{tipos,validacao,semana}.ts`: converte "HH:MM" para minutos, valida (formato, faixa, granularidade, início < fim, sobreposição, teto de 6), canoniza (ordena e une contíguos) e monta a semana com as pausas.
4. **Serviço** `src/server/jornadas/servico.ts`: `obter` (leitura com a regra 404/403 da RN-1) e `salvar` (substituição atômica da semana por **diferença**, sob a trava do profissional). `leitura.ts` expõe `lerSemana` sem checagem de papel, para a E3.1.
5. **Ação** `src/server/jornadas/jornadas.acao.ts`: `salvarJornada = defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })`.
6. **Tela** `src/app/painel/profissionais/[id]/jornada/`: o gestor vê o formulário de 7 dias, cada um num `<details>` com 6 linhas fixas de início/fim em campos de texto com `pattern`. O profissional dono vê a visão somente leitura. A casca `acoes.ts` faz PRG: depois de salvar, `redirect` para `?salva=1`.
7. **Acessos:** link "Jornada" na página do profissional (gestor) e "Minha jornada" em `/painel` para quem tem perfil de profissional (D-9).
8. **E2E sem banco:** a página de desenvolvimento `/dev/jornada` (desligada sem `VITRINE_COMPONENTES=true`) renderiza os **mesmos** componentes com uma ação de demonstração que só roda a validação pura. Teclado, axe e o caso sem JS rodam no job `e2e` atual (D-11).
9. **Formatação** em `src/lib/format.ts`: `formatarMinutosDoDia`, `formatarFaixaDeMinutos` e `formatarDiaDaSemana`.

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Sem trava; DELETE + INSERT direto | Duas gravações simultâneas intercalam: a segunda pode inserir enquanto a primeira ainda tem linhas, e o resultado é 23P01 (5xx) ou uma semana misturada. Isso viola o CA-13. |
| `FOR UPDATE` na linha do profissional | Também conflita com o `FOR KEY SHARE` de **toda** inserção de reserva, convite ou vínculo daquele profissional. Salvar a jornada passaria a atrasar reservas sem ganho. Para serializar com outros editores, com a desativação (`FOR UPDATE`) e com a E3.2 (`FOR SHARE`), `FOR NO KEY UPDATE` basta. É o mesmo raciocínio da D-014 D-15. |
| `pg_advisory_xact_lock(hash(profissional))` | É um mecanismo novo no projeto, fica fora da ordem canônica (linha → linha) e não serializa com a desativação. A trava de linha resolve. |
| Trava em linhas de `jornada` | Um profissional sem jornada não tem linha para travar, e duas primeiras gravações corriam livres. |
| DELETE de tudo + INSERT de tudo | Funciona, mas troca os ids a cada gravação, inclusive sem mudança (spec §6, "salvar sem mudança: idempotente"), e gera gravações inúteis. A **diferença** calculada sob a trava preserva os ids dos intervalos mantidos e não grava nada quando a semana não mudou. |
| CHECK `inicio_min % 5 = 0 AND fim_min % 5 = 0` e forma canônica no banco | Há um único escritor validado, e a granularidade é uma suposição (D-1) que pode mudar. É o mesmo critério da D-014 §1.1. O banco já garante a faixa e a não sobreposição (spec §8 b). |
| Gravar dia a dia (um formulário por dia) | A spec D-3 pede uma substituição atômica, e um único formulário funciona sem JS. |
| `<input type="time">` | Não aceita `24:00` (D-10), e o seletor varia por navegador e locale (12 h/24 h). |
| Linhas adicionadas por JS ("Adicionar intervalo") | Não funciona sem JS (CA-18). As 6 linhas fixas por dia dentro de `<details>` funcionam sem JS e mantêm a navegação por Tab curta: com os dias fechados, Tab passa por 7 `summary` + salvar. |
| Recusar intervalos contíguos | A spec D-2 manda unir. |
| E2E com banco (serviço `postgres` no job `e2e`, migração e semente de gestor) | Exige DevOps, uma semente que ainda não existe (E9.2) e uma sessão real no Playwright. É desproporcional para esta demanda. A borda real (página e casca) é coberta por integração com PostgreSQL real e pelo passo manual (D-11). |
| Seção nova na vitrine `/dev/componentes` | Mudaria as contagens de Tab e de axe já validadas em `a11y-base.spec.ts` (D-009). Uma página própria isola o efeito. |
| Item "Minha jornada" em `NAVEGACAO_PAINEL` | `NAVEGACAO_PAINEL` só aceita rotas sem parâmetro (spec D-9). |
| Rota própria para o profissional (`/painel/minha-jornada`) | Criaria uma segunda página para o mesmo conteúdo. `ROTAS.jornada(id)` com a regra 404/403 já atende o CA-12. |

### 1.2 Dependências novas

Nenhuma. O desenho usa `zod` (já presente), `next/cache`, `next/navigation` e os componentes de `src/components/ui/` (`Field`, `ErroDoCampo`, `Alert`, `Button`).

## 2. Componentes afetados

| Caminho | Mudança |
|---|---|
| `src/server/auth/permissoes.ts` (+ `.test.ts`) | `'jornada.ver'` em `OPERACOES` e em `MATRIZ`: `linha('salao', 'proprio', 'negado')` |
| `src/config/navegacao.ts` (+ `.test.ts`) | `ROTAS.devJornada = '/dev/jornada'` (o primeiro segmento `dev` já é reservado) |
| `src/lib/format.ts` (+ `format.test.ts`) | `formatarMinutosDoDia`, `formatarFaixaDeMinutos`, `formatarDiaDaSemana` (§3.4) |
| `src/server/jornadas/tipos.ts` (novo) | contratos, limites, mensagens e ordem de exibição, sem import de runtime de `@/server/**` |
| `src/server/jornadas/validacao.ts` (+ `.test.ts`) (novo) | conversão de horário e validação e canonização da semana (puro) |
| `src/server/jornadas/semana.ts` (+ `.test.ts`) (novo) | `montarSemana(linhas)`, `pausasDe(intervalos)` e `diferenca(existentes, desejados)` (puro) |
| `src/server/repos/jornada.ts` (novo), `repos/index.ts`, `repos/tipos.ts`, `repos/index.test.ts` | `RepoJornada` (§3.2) |
| `src/server/jornadas/servico.ts` (novo) | `obter` e `salvar` (§3.5) |
| `src/server/jornadas/leitura.ts` (novo) | `lerSemana(ctx, profissionalId)` para a E3.1 |
| `src/server/jornadas/jornadas.acao.ts` (novo) | `salvarJornada` |
| `src/app/painel/profissionais/[id]/jornada/**` (novo) | página, formulário, visão somente leitura, estado e casca |
| `src/app/painel/profissionais/[id]/page.tsx` | seção "Jornada" com link para `ROTAS.jornada(id)` |
| `src/app/painel/page.tsx` | link "Minha jornada" quando `ctx.profissionalId !== null` |
| `src/app/dev/jornada/**` (novo) | página e ação de demonstração para o E2E (D-11) |
| `e2e/jornada.spec.ts`, `e2e/jornada-sem-js.spec.ts` (novos) | CA-17, CA-18 (parte de UI) |
| `README.md` | seção curta "Jornada" |

Nada muda em `prisma/**`, `.env.example`, `docker-compose.yml`, `.github/**`, `src/proxy.ts`, `src/server/tenant/**`, `src/server/auth/pagina.ts`, `src/components/**`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts` nem `tests/support/**`.

## 3. Interfaces

### 3.1 Contratos (`src/server/jornadas/tipos.ts`)

O cliente importa este arquivo, então ele não pode ter import de runtime de `@/server/**`.

```ts
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;                // RN-15: 0 = domingo
export const DIAS_SEMANA: readonly DiaSemana[] = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
export const ORDEM_EXIBICAO_DIAS: readonly DiaSemana[] = Object.freeze([1, 2, 3, 4, 5, 6, 0]); // segunda primeiro

export const LIMITES_JORNADA = Object.freeze({
  intervalosPorDia: 6,          // RN-7 (D-4)
  linhasPorDia: 6,              // linhas fixas do formulário (= intervalosPorDia)
  linhasRecebidasMax: 20,       // teto do array por dia na ação (anti-payload); acima → formulario
  passoMin: 5,                  // RN-4 (D-1)
  fimMax: 1440,                 // RN-3: 24:00
  horarioMaxCaracteres: 10,     // texto bruto antes da regex
});

export type IntervaloMin = { inicioMin: number; fimMin: number };
export type DiaJornada = { diaSemana: DiaSemana; intervalos: IntervaloMin[]; pausas: IntervaloMin[] };
/** Sempre 7 itens, índice = diaSemana (0..6); intervalos canônicos (RN-5). */
export type SemanaJornada = readonly DiaJornada[];

export type ErroIntervalo = { inicio?: string; fim?: string; intervalo?: string };
export type ErrosDia = { dia?: string; intervalos?: Partial<Record<number, ErroIntervalo>> };
export type ErrosJornada = { formulario?: string; dias?: Partial<Record<DiaSemana, ErrosDia>> };

/** Linha bruta: textos "HH:MM" (vazios permitidos). Índice da linha = posição no array. */
export type LinhaEntrada = { inicio?: string; fim?: string };
export type DiaEntrada = { diaSemana: number; intervalos: LinhaEntrada[] };
export type EntradaSalvarJornada = { profissionalId: unknown; dias: unknown };

export type ResultadoSalvarJornada =
  | { resultado: 'salvo'; semana: SemanaJornada; inseridos: number; removidos: number }
  | { resultado: 'invalido'; erros: ErrosJornada };

export type JornadaVisao = {
  profissional: { id: string; nome: string; ativo: boolean };
  semana: SemanaJornada;
  semIntervalos: boolean;      // RN-8 / CA-15
  editavel: boolean;           // pode(ctx.papel, 'jornada.editar') === 'salao'
};

export const MENSAGENS_JORNADA = Object.freeze({
  formato: 'Use o formato HH:MM, de 00:00 a 24:00 (ex.: 09:00).',
  granularidade: 'Use minutos múltiplos de 5 (ex.: 09:05).',
  inicio24: 'O início vai até 23:55. 24:00 só pode ser fim.',
  faltaInicio: 'Informe também o início.',
  faltaFim: 'Informe também o fim.',
  ordem: 'O fim precisa ser depois do início. Para passar da meia-noite, termine às 24:00 e continue no dia seguinte a partir de 00:00.',
  sobreposicao: 'Este intervalo se sobrepõe a outro do mesmo dia.',
  limite: 'Use no máximo 6 intervalos por dia.',
  formulario: 'Não foi possível ler os dados enviados. Recarregue a página e tente de novo.',
  resumoErros: 'Corrija os campos indicados para salvar a jornada.',
  ajudaHorario: 'Horário local do salão, no formato HH:MM, em múltiplos de 5 minutos. Use 24:00 para meia-noite no fim do dia. Linhas vazias são ignoradas.',
  salva: 'Jornada salva.',
  semIntervalos: 'Sem nenhum intervalo na semana, este profissional não terá horários disponíveis para reserva.',
  inativo: 'Profissional inativo: esta jornada só passa a valer quando ele for reativado.',
  somenteLeitura: 'Só o gestor do salão altera a jornada.',
  folga: 'Folga',
  naoEncontrado: 'Profissional não encontrado.',
  acessoNegado: 'Acesso negado.',
});
```

### 3.2 Repositório (`src/server/repos/jornada.ts`, `tipos.ts`, `index.ts`)

Todo método chama `exigirEscopo(ctx)` antes de consultar. Um id que não é UUID dá `NaoEncontrado` sem consulta.

```ts
// repos/tipos.ts
export type JornadaLinhaDTO = { id: string; diaSemana: number; inicioMin: number; fimMin: number };
export type TravaJornada = { id: string; nome: string; ativo: boolean };

// repos/jornada.ts
export interface RepoJornada {
  /** Linhas do profissional NO SALÃO do contexto, ordenadas por dia_semana, inicio_min, id.
   *  Não verifica a existência do profissional (o chamador já o buscou/travou). */
  listarDoProfissional(ctx: ContextoEscopado, profissionalId: string): Promise<JornadaLinhaDTO[]>;
  /** SELECT pj.id, pj.nome, pj.ativo FROM profissional pj
   *   WHERE pj.id = $id::uuid AND pj.salao_id = $salao::uuid
   *   FOR NO KEY UPDATE OF pj
   *  Sem linha → NaoEncontrado. NÃO filtra `ativo` (RN-13). Só dentro de emTransacao.
   *  O texto "FOR NO KEY UPDATE OF pj" é o marcador procurado em pg_stat_activity por T-4. */
  travarProfissional(ctx: ContextoEscopado, profissionalId: string): Promise<TravaJornada>;
  /** Busca sem trava (leitura da página): mesma projeção; NaoEncontrado se não é do salão. */
  buscarProfissional(ctx: ContextoEscopado, profissionalId: string): Promise<TravaJornada>;
  /** No MESMO executor e nesta ordem: (1) deleteMany { id ∈ remover, salaoId, profissionalId };
   *  (2) createMany de `inserir` com salaoId do contexto. Listas vazias pulam o comando.
   *  Pré-condição: o chamador tem a trava do profissional. */
  aplicarDiferenca(
    ctx: ContextoEscopado,
    profissionalId: string,
    d: { remover: readonly string[]; inserir: readonly { diaSemana: number; inicioMin: number; fimMin: number }[] },
  ): Promise<{ removidos: number; inseridos: number }>;
}
```

- `Repos` ganha `jornadas: RepoJornada`, e `criarRepos` liga `criarRepoJornada(db)`.
- A busca e a trava de profissional ficam em `repos/jornada.ts`, e não em `repos/profissional.ts` (que é da D-013), para manter a posse separada. O alias `pj` torna o marcador único: nenhum teste existente procura `%OF pj%`.

**Ordem canônica de travas** (D-014 §3.2, estendida; vai no cabeçalho de `repos/jornada.ts`):

```
profissional (FOR UPDATE | FOR NO KEY UPDATE | FOR SHARE, por id)
  → servico(s)  → servico_profissional / jornada / reserva / reserva_item
```

- **Salvar a jornada:** `profissional FOR NO KEY UPDATE OF pj` → leitura de `jornada` → DELETE/INSERT em `jornada`. Não toca `servico`, `reserva`, `sessao` nem `convite`. O INSERT em `jornada` toma `FOR KEY SHARE` na mesma linha de `profissional`, o que é compatível com a trava que a própria transação já tem.
- **Desativar profissional (D-013):** `FOR UPDATE` no mesmo profissional, que conflita com o `FOR NO KEY UPDATE`. As duas operações se serializam e nenhuma toma uma segunda trava que a outra tenha, então não há ciclo (CA-13).
- **Reserva (E3.2, futura):** a inserção toma `FOR KEY SHARE`, que **não** conflita com a gravação da jornada. A conferência com `FOR SHARE` (D-014 §11) **conflita** e serializa com a gravação. Isso é desejado: a reserva lê a jornada já confirmada. As duas tomam o profissional primeiro, então não há ciclo.

### 3.3 Validação e semana (puras)

```ts
// validacao.ts
/** "H:MM" ou "HH:MM" (trim; ≤ 10 caracteres; regex ^(\d{1,2}):(\d{2})$; h ≤ 24, m ≤ 59, 24 só com :00).
 *  Fora disso → 'formato'; m % 5 ≠ 0 → 'granularidade'. */
export function converterHorario(v: unknown): { ok: true; min: number } | { ok: false; erro: 'formato' | 'granularidade' };

export function validarSemana(e: unknown):
  | { ok: true; profissionalId: string; intervalos: { diaSemana: DiaSemana; inicioMin: number; fimMin: number }[] } // canônicos, ordenados
  | { ok: false; erros: ErrosJornada };
```

Regras de `validarSemana`, nesta ordem:

1. **Forma** (qualquer falha dá `erros.formulario`, sem erros de campo): `z.strictObject({ profissionalId: z.string(), dias: z.array(z.strictObject({ diaSemana: z.number().int().min(0).max(6), intervalos: z.array(z.strictObject({ inicio: z.string().optional(), fim: z.string().optional() })).max(20) })).length(7) })` e os 7 `diaSemana` distintos. O `profissionalId` não é validado como UUID aqui: o repositório responde 404 para o malformado (CA-11). Campos extras (`salaoId`) dão `formulario`, sem efeito (CA-11).
2. **Por linha** (índice = posição): os dois campos vazios depois do `trim` → a linha é ignorada. Só um preenchido → `faltaInicio`/`faltaFim` no campo vazio. Cada campo preenchido passa por `converterHorario` (`formato`/`granularidade` no campo). Início `1440` dá `inicio24` no campo `inicio`. Com os dois campos válidos e `fim <= inicio`, a linha recebe `ordem` (`intervalo`) (CA-4).
3. **Por dia:** mais de 6 linhas não vazias dá `dias[d].dia = limite` (CA-9). As linhas válidas são ordenadas por `(inicio, fim)`. Para cada par consecutivo com `ant.fim > atual.inicio`, as **duas** linhas recebem `sobreposicao` (`intervalo`) (CA-2). Isso inclui intervalos idênticos.
4. Todos os erros voltam juntos. Se não houver erros, a canonização **une** pares com `ant.fim === atual.inicio` (RN-5, CA-7), e o resultado vem ordenado por `(diaSemana, inicioMin)`.

```ts
// semana.ts
export function pausasDe(intervalos: readonly IntervaloMin[]): IntervaloMin[];      // lacunas > 0 entre consecutivos
export function montarSemana(linhas: readonly { diaSemana: number; inicioMin: number; fimMin: number }[]): SemanaJornada;
/** Diferença por (dia, início, fim): remover = ids existentes sem par em desejados;
 *  inserir = desejados sem par em existentes. Igualdade total → { remover: [], inserir: [] }. */
export function diferenca(existentes: readonly JornadaLinhaDTO[], desejados: readonly { diaSemana: number; inicioMin: number; fimMin: number }[]): {
  remover: string[]; inserir: { diaSemana: number; inicioMin: number; fimMin: number }[] };
```

`JornadaLinhaDTO` é importado de `repos/tipos` só com `import type`, o que mantém o arquivo puro.

### 3.4 Formatação (`src/lib/format.ts`)

```ts
/** 0 → '00:00'; 545 → '09:05'; 1440 → '24:00'. Não inteiro, NaN, < 0 ou > 1440 → RangeError/TypeError (CA-20). */
export function formatarMinutosDoDia(min: number): string;
/** (720, 780) → '12:00–13:00' (meia-risca U+2013). Valida as duas pontas e exige inicio < fim. */
export function formatarFaixaDeMinutos(inicioMin: number, fimMin: number): string;
/** 0 → 'Domingo', 1 → 'Segunda-feira' … 6 → 'Sábado'; fora de 0..6 inteiro → RangeError. Tabela fixa (sem Intl). */
export function formatarDiaDaSemana(dia: number): string;
```

- A conversão em sentido inverso (texto → minutos) é validação e fica em `validacao.ts`.
- `validacao.test.ts` testa a ida e a volta `converterHorario(formatarMinutosDoDia(m)).min === m` para `m ∈ {0, 5, 545, 1435, 1440}`.

### 3.5 Serviço, leitura e ação

Sem `next/*`.

```ts
// servico.ts
export async function obter(ctx: TenantContext, profissionalId: unknown): Promise<JornadaVisao>;
export async function salvar(ctx: TenantContext, e: unknown): Promise<ResultadoSalvarJornada>;
// leitura.ts — SEM checagem de papel (uso interno: E3.1 com SistemaContext/TenantContext)
export async function lerSemana(ctx: ContextoEscopado, profissionalId: string): Promise<SemanaJornada>;
```

- **`obter`:**
  1. `exigirPermissao(ctx, 'jornada.ver')`. O super admin nunca chega aqui, e o profissional sem perfil já é 401 por `resolverTenant`.
  2. Id que não é `string` → `NaoEncontrado`.
  3. `repos().jornadas.buscarProfissional`: B, inexistente ou malformado → `NaoEncontrado` (404).
  4. `exigirPermissao(ctx, 'jornada.ver', { profissionalId: id })`: outro profissional do **mesmo** salão → `AcessoNegado` (403, CA-12). O 404 vem antes do 403 **só** para a leitura, porque a spec (CA-12) pede 404 para outro salão mesmo para o profissional.
  5. `listarDoProfissional` → `montarSemana`. O resultado é `semIntervalos = todos os dias vazios` e `editavel = pode(ctx.papel, 'jornada.editar') === 'salao'`.
- **`salvar`:**
  1. `exigirPermissao(ctx, 'jornada.editar')` (defesa em profundidade; `defineAcao` já barra o profissional e o super admin com 403 antes de tudo, CA-3).
  2. `validarSemana(e)`: inválido → `invalido`, sem tocar o banco.
  3. `emTransacao(async (t) => { const p = await t.jornadas.travarProfissional(ctx, id); const atuais = await t.jornadas.listarDoProfissional(ctx, id); const d = diferenca(atuais, intervalos); const r = await t.jornadas.aplicarDiferenca(ctx, id, d); return … })`.
  4. A resposta é `salvo` com `montarSemana(intervalos)` e as contagens.
  - A precedência é validação → 404, a mesma da D-014 D-18: entrada inválida com o id de B dá `invalido`, sem vazar nada. O CA-11 usa entrada válida.
  - Nenhuma escrita em `reserva`, `reserva_item` ou `mensagem` e nenhum enfileiramento (RN-9, CA-10).
  - Log JSON numa linha: `jornada.salva { salaoId, profissionalId, inseridos, removidos, intervalos }`, só com ids e contagens.
- **`lerSemana`:** `montarSemana(await repos().jornadas.listarDoProfissional(ctx, id))`. Um profissional inexistente ou de outro salão dá a semana vazia, e quem chama confere o profissional. O docstring registra RN-15, RN-10 e a obrigação de DST da E3.1.

```ts
// jornadas.acao.ts — sem 'use server'; só exportações de defineAcao
export const salvarJornada = defineAcao<EntradaSalvarJornada, ResultadoSalvarJornada>(
  { papeis: ['gestor'], capacidade: 'configurar' },
  (ctx, e) => servico.salvar(ctx, e),
);
```

A leitura não é uma ação (a página chama `servico.obter`), então só existe um `*.acao.ts` exportado (CA-19).

### 3.6 Telas (`src/app/painel/profissionais/[id]/jornada/`)

| Arquivo | Conteúdo |
|---|---|
| `estado.ts` | `ValoresJornada = Record<DiaSemana, { inicio: string; fim: string }[]>` (6 linhas por dia); `EstadoFormularioJornada = { mensagem: string \| null; erros: ErrosJornada; valores: ValoresJornada \| null }` e o estado inicial. Funções puras: `nomeDoCampo(dia, n, 'inicio' \| 'fim')` → `inicio-<dia>-<n>`/`fim-<dia>-<n>`; `idDoCampo(...)` → `jornada-<dia>-<n>-inicio`; `valoresDaSemana(semana)` (formata com `formatarMinutosDoDia` e completa com linhas vazias até 6); `lerFormularioJornada(fd)` → `{ entrada: { profissionalId, dias }, valores }` (lê só os 7×6×2 nomes conhecidos e ignora extras e arquivos; cada valor é cortado em 10 caracteres em `valores`). Só `import type` + constantes de `@/server/jornadas/tipos` e `@/lib/format`. |
| `FormularioJornada.tsx` (+ `.test.tsx`, `Jornada.module.css`) | `'use client'`; `useActionState(acao, inicial)`; `<form action noValidate>` com o `profissionalId` oculto; um parágrafo `id="jornada-ajuda"` com `ajudaHorario`. Para cada dia em `ORDEM_EXIBICAO_DIAS`: `<details open={diaComErro \|\| undefined}>`, cujo `<summary>` traz o nome do dia e o resumo ("09:00–12:00, 13:00–18:00 · Pausa 12:00–13:00" ou "Folga"), calculado sobre a semana gravada (prop `semana`); dentro, `<fieldset aria-describedby={erroDoDia?}>` + `<legend>Intervalos de <dia></legend>` e 6 linhas, cada uma com dois `Field` (`rotulo` "Início do intervalo n"/"Fim do intervalo n", `id`/`name` determinísticos, `maxLength={5}`, `autoComplete="off"`, `pattern="([01]?[0-9]\|2[0-4]):[0-5][0-9]"`, `defaultValue` vindo de `estado.valores ?? valoresDaSemana(semana)`, `erro` do campo e `aria-describedby="jornada-ajuda <id do erro da linha>"`); o erro da linha usa `ErroDoCampo` com o id `jornada-<dia>-<n>-erro`. Com erros, um **resumo de erros** no topo (`<div tabIndex={-1} ref>` com o título `resumoErros` e uma lista de links `href="#<id do primeiro campo com erro>"`), focado por `useEffect` quando o estado muda com erros (CA-17). `mensagem` (403/404/formulario) vai em `Alert` de erro. Botão "Salvar jornada". A prop `aposSalvar?: string` (mensagem de status) mostra `Alert` sucesso. |
| `VisaoJornada.tsx` (+ `.test.tsx`) | Componente de servidor, sem campos nem botão: `<dl>` em `ORDEM_EXIBICAO_DIAS`, com `dt` = `formatarDiaDaSemana` e `dd` = os intervalos (`formatarFaixaDeMinutos`) e as pausas, ou "Folga" (CA-12 somente leitura, CA-15). |
| `page.tsx` | Detalhado abaixo da tabela. |
| `acoes.ts` | `'use server'`; `salvarJornadaAcao(anterior, fd)`, detalhada abaixo da tabela. |

Fluxo de `page.tsx`:
1. Guarda: `exigirAcessoAoPainel(ROTAS.jornada(id), ['gestor', 'profissional'], 'jornada.ver')`. Negado → `<AcessoNegado />`.
2. `try { visao = await obter(ctx, id) } catch`: `NaoEncontrado` → `visao = null`; `AcessoNegado` → `negado = true`; outros erros são relançados. `notFound()` e o `return <AcessoNegado/>` ficam **fora** do `try`.
3. `PanelLayout caminhoAtual=ROTAS.jornada(id)` e `h1` "Jornada de <nome>".
4. Para o gestor, um link "Voltar para <nome>" (`ROTAS.profissional(id)`). Os alertas são o aviso `inativo` (`!ativo`, CA-14), o aviso `semIntervalos` (CA-15) e `salva` (`searchParams.salva === '1'` e `editavel`).
5. Com `editavel`, `<FormularioJornada acao={salvarJornadaAcao} profissionalId semana />`. Sem `editavel`, `<p>{somenteLeitura}</p>` + `<VisaoJornada semana />`.

Fluxo de `acoes.ts` (`salvarJornadaAcao`):
1. `lerFormularioJornada(fd)` → `salvarJornada(entrada)`, na forma chamável de `defineAcao`, que lê o cookie.
2. `nao_autenticado` → `redirect('/entrar?proximo=' + encodeURIComponent(ROTAS.jornada(id) ou ROTAS.profissionais))`.
3. `acesso_negado`/`nao_encontrado` → `mensagem`.
4. `invalido` → `{ erros, valores }`, que preserva o que foi digitado (RN-6).
5. `salvo` → `revalidatePath(ROTAS.jornada(id))` e `redirect(ROTAS.jornada(id) + '?salva=1')`, no padrão PRG: o formulário renasce a partir do banco já na forma canônica, com e sem JS.
6. `redirect` fica sempre **fora** de `try`, e a casca não importa `@/server/repos`.

Mudanças em telas existentes:
- `[id]/page.tsx`: seção `<section aria-labelledby="jornada-profissional">` com `h2` "Jornada" e o link "Ver e editar a jornada" (`ROTAS.jornada(id)`), entre "Acesso" e o controle de ativação.
- `src/app/painel/page.tsx`: com `acesso.ctx.profissionalId !== null`, um parágrafo com o link "Minha jornada" (`ROTAS.jornada(profissionalId)`). Isso vale para o profissional e para o gestor que atende (D-9).

### 3.7 Página de demonstração para o E2E (`src/app/dev/jornada/`)

- `page.tsx`: `dynamic = 'force-dynamic'` e `notFound()` sem `vitrineHabilitada(process.env)`, chamado antes de ler qualquer parâmetro. Metadados `noindex` só quando está habilitada, como em `/dev/componentes` (D-009 DEF-2).
- Conteúdo, em `PanelLayout papel="gestor"`, pelo parâmetro `?modo=`:
  - `edicao` (padrão): `FormularioJornada` com a semana da fábrica (segunda a sábado, 09:00–12:00 e 13:00–18:00) e `acao={demonstrarJornadaAcao}`.
  - `leitura`: `VisaoJornada` + `somenteLeitura`, em `PanelLayout papel="profissional"`.
  - `vazia`: `VisaoJornada` de uma semana vazia + `semIntervalos`.
  - Um valor desconhecido cai em `edicao`.
- `acoes.ts`: `'use server'`; `demonstrarJornadaAcao(anterior, fd)`. Desligada a vitrine, devolve o estado inicial e não processa nada. Ligada, roda `lerFormularioJornada` → `validarSemana`: inválido → `{ erros, valores }`; válido → `{ mensagem: 'Jornada válida (demonstração: nada foi gravado).', erros: {}, valores: valoresDaSemana(montarSemana(intervalos)) }`. Não usa banco, sessão nem rede. O `profissionalId` oculto é um UUID fixo de demonstração.
- Para que a mensagem de sucesso da demonstração apareça, o `FormularioJornada` mostra `estado.mensagem` como `Alert` **sucesso** quando `erros` está vazio e `mensagem` existe, e como **erro** caso contrário. Na página real, o sucesso vem por `?salva=1`, então os dois caminhos são cobertos.

## 4. Dados: DBA **dispensado**

Motivos:
- **Nenhuma DDL:** a tabela, as CHECKs de dia e de faixa, a FK composta e a exclusion já existem (D-004) e cobrem RN-2/RN-3 no banco.
- **CHECK de múltiplo de 5 e forma canônica:** não adotados (§1.1). O critério é o mesmo da D-014 §4, e a escolha está registrada como opcional em §11.
- **Trava:** `FOR NO KEY UPDATE OF <alias>` numa linha por id é um padrão já revisado (D-014, `FOR NO KEY UPDATE OF s`). A compatibilidade com `FOR KEY SHARE` e o conflito com `FOR UPDATE`/`FOR SHARE` são semântica documentada do PostgreSQL, **verificada por teste** em T-4 (R-1, R-2, R-3).
- **DELETE + INSERT com exclusion na mesma transação:** coberto por teste de repositório em T-2 (spec §8 c).
- **Índices:** `listarDoProfissional` usa o índice `(salao_id, profissional_id, dia_semana)`, a trava usa a PK de `profissional` e o volume é de no máximo 42 linhas por profissional.

Se o líder ou o tester encontrarem `deadlock detected` ou 23P01 em T-4, o DBA é acionado com a transferência abaixo (não é necessária agora):

```
DEMANDA: D-015 — jornada semanal
DE: arquiteto-software  PARA: dba
OBJETIVO: revisar a trava FOR NO KEY UPDATE OF pj em profissional e a gravação por diferença em jornada
CONTEXTO NECESSÁRIO: design.md §3.2 (ordem canônica) e §8 (R-1..R-3); falha observada em tests/integration/jornadas/concorrencia.test.ts
CRITÉRIOS DE ACEITAÇÃO: CA-13
DECISÕES JÁ TOMADAS: sem migração; sem CHECK de múltiplo de 5
ARQUIVOS ENVOLVIDOS: src/server/repos/jornada.ts (leitura; posse continua do desenvolvedor)
EVIDÊNCIAS: saída do laço ×10 com o erro
PENDÊNCIAS: —
PRÓXIMA AÇÃO: parecer em docs/demandas/D-015/dba.md
```

## 5. Infraestrutura: DevOps **dispensado**

- Nenhuma variável, container, script, dependência ou job novo. O E2E novo usa `/dev/jornada`, ligado pela `VITRINE_COMPONENTES=true` que o `webServer` do Playwright já define. Ele cai no glob `e2e/**/*.spec.ts` do job `e2e` atual, sem banco.
- O `next build` passa a listar `ƒ /painel/profissionais/[id]/jornada` e `ƒ /dev/jornada`.
- Observabilidade: o evento de log `jornada.salva` (§3.5).

## 6. Verificação das invariantes

| Invariante | Aplica? | Como |
|---|---|---|
| Escopo por salão no servidor | Sim | `salao_id` vem só de `ctx` (`exigirEscopo`). A trava, a busca, a listagem e o `deleteMany` filtram `salao_id`, e o `createMany` usa o salão do contexto. A FK composta é a segunda barreira. Id de B, inexistente ou malformado dá o mesmo 404 (CA-11). Campos extras na entrada dão `formulario`, e a casca ignora campos desconhecidos do `FormData`. A página aplica a permissão de operação antes da busca e a de alvo (`proprio`) depois, o que dá 404 para outro salão e 403 para outro profissional do mesmo salão (CA-12). Testes com dois salões em T-3/T-6. |
| Exclusion constraint anti-sobreposição | Sim (jornada) | `jornada_sem_sobreposicao` (`int4range`) é a garantia final. A validação recusa antes, e a trava + diferença impede 23P01 em gravações concorrentes (CA-13). `reserva_sem_sobreposicao` não é tocada (CA-10). |
| UTC + fuso do salão | Sim (hora de parede) | A jornada é hora local de parede, sem conversão ao gravar nem ao exibir (RN-10, CA-16). A interpretação em UTC, inclusive com DST, é da E3.1 (§11). |
| Adaptadores de integração | Não | Nenhuma integração e nenhuma mensagem enfileirada (CA-10). |
| Soft delete / anonimização | Sim (profissional) | O profissional não é apagado. A jornada de um inativo é preservada e editável (RN-13, CA-14). O DELETE afeta só as linhas de `jornada`, que não são histórico protegido e que nenhuma reserva referencia. Não há dados de cliente. |
| Somente leitura do salão suspenso | Declarado | A ação declara `capacidade: 'configurar'` (CA-19, registro). A regra efetiva é da E6.4. A leitura não é uma ação. |
| Idempotência de webhooks/mensagens | Não | Não há webhook nem mensagem. Salvar a mesma semana é idempotente por construção (a diferença é vazia, então nenhuma escrita acontece e os ids se mantêm). |
| Auditoria do super admin | Não | O super admin recebe 403 na ação (CA-3) e é negado na matriz para `jornada.ver`. |

## 7. Decisões

| ID | Decisão |
|---|---|
| D-1..D-7 | **Confirmadas**, só na aplicação (sem CHECK nova). |
| D-8 | **Confirmada:** `'jornada.ver'` = `salao`/`proprio`/`negado`. Na leitura, o 404 de outro salão vem antes do 403 de outro profissional do mesmo salão. Na escrita, `defineAcao` dá 403 ao profissional antes de qualquer consulta. |
| D-9 | **Confirmada:** "Minha jornada" em `/painel` para quem tem `profissionalId`, inclusive o gestor que atende. Sem item em `NAVEGACAO_PAINEL`. |
| D-10 | **Confirmada:** campo de texto, `maxLength=5`, `pattern` `([01]?[0-9]\|2[0-4]):[0-5][0-9]`, sem `inputMode` (os teclados numéricos móveis não têm ":"), `autoComplete="off"`. O formulário tem `noValidate`, e o servidor é a autoridade. Aceita `H:MM` e `HH:MM`. |
| D-11 (nova) | O E2E (CA-17, CA-18 na UI) roda em `/dev/jornada`, com os mesmos componentes e uma ação de demonstração que só valida. A página real (guarda, casca, banco) é coberta por integração com `renderToStaticMarkup` (T-6) e pelo passo manual com Docker (T-8/T-9). **Desvio consciente do texto do CA-17 ("salva"):** no E2E, "salvar" exercita a validação do servidor sem gravar. |
| D-12 (nova) | Trava `FOR NO KEY UPDATE OF pj` na linha do profissional (§3.2); a ordem canônica passa a ser profissional → serviço → associações/jornada/reservas. |
| D-13 (nova) | Gravação por **diferença** sob a trava (preserva ids, e salvar sem mudança não grava nada). A semântica continua a de substituição da semana inteira (RN-6). |
| D-14 (nova) | 6 linhas fixas por dia dentro de `<details>` (aberto quando o dia tem erro). Uma linha vazia é ignorada, e uma linha com só um campo dá erro no campo vazio. |
| D-15 (nova) | A entrada da ação exige os **7 dias**, distintos e explícitos: um dia de folga é `intervalos: []`. Chamador que omite um dia recebe `formulario` e nunca apaga um dia por acidente (mesmo espírito da D-014 D-16). |
| D-16 (nova) | Na sobreposição, o erro é marcado nas duas linhas envolvidas. O teto de 6 é um erro do dia, conferido antes da união dos contíguos. |
| D-17 (nova) | Sucesso pela página real: PRG para `?salva=1` com `Alert` de status. |
| D-18 (nova) | Teste unitário da validação em `src/server/jornadas/validacao.test.ts`, e não em `tests/unit/...` (fora do glob do projeto `unit`). |
| D-19 (nova) | A lista de profissionais **não** ganha link para a jornada. O acesso é pela página do profissional, o que mantém `ListaProfissionais` e os seus testes da D-013 intactos. |

## 8. Riscos

| Risco | Mitigação |
|---|---|
| R-1: CA-13 instável (ordem de chegada) | (a) Teste determinístico: uma conexão `pg` faz `BEGIN; SELECT 1 FROM profissional WHERE id=$1 FOR UPDATE`. Dispara a gravação S1 e espera, por `pg_stat_activity` (`wait_event_type='Lock' AND query LIKE '%FOR NO KEY UPDATE OF pj%'`), contar 1; dispara S2 e espera contar 2; faz `ROLLBACK`. O final tem de ser exatamente S2. (b) `Promise.all(S1, S2)` ×10: as duas `ok` e o final ∈ {S1, S2}, comparado linha a linha (sem mistura). `timeout` explícito (30 s) em cada `it`. |
| R-2: gravação × desativação (impasse ou 5xx) | `Promise.all(salvar, desativar)` ×10: as duas terminam `ok`, sem `deadlock detected`, com o profissional inativo e a jornada igual à semana salva. Mais um caso determinístico: a conexão `pg` segura a desativação (`BEGIN; UPDATE profissional SET ativo=false`); a gravação espera; depois do `COMMIT`, a gravação é aceita (RN-13). |
| R-3: a gravação travar reservas à toa | Teste de compatibilidade: com a conexão 1 em `BEGIN; SELECT … FOR NO KEY UPDATE`, a conexão 2 consegue `SELECT … FOR KEY SHARE NOWAIT` (é a trava de uma inserção de reserva) e falha com 55P03 em `FOR SHARE NOWAIT`. Isso documenta D-12 para a E3.2. |
| R-4: 23P01 no DELETE + INSERT | Teste de repositório: a linha `(1, 540, 720)` existe, e `aplicarDiferenca` remove essa linha e insere `(1, 600, 780)` na mesma transação → aceito. |
| R-5: `24:00` e fronteiras | Unitário com 00:00, 23:55, 24:00 (fim aceito, início recusado), 24:05, 25:00, 12:60, 9h, `9:00`, ` 09:00 `, `09:00:00`, vazio, só um campo, número em vez de texto (→ `formulario`). |
| R-6: 403 × 404 na página do profissional | `paginas.test.ts`: o profissional de A com o seu id vê a visão sem `<input>` nem botão; com o id do gestor de A vê "Acesso negado"; com o id do profissional de B, um UUID inexistente ou `abc`, `notFound`. O gestor com o id de B → `notFound`. |
| R-7: valores perdidos depois de um erro (o React 19 reinicia o formulário) | `defaultValue` vem de `estado.valores` (o mesmo padrão da D-013/D-014). O teste jsdom confere os valores e o `details` aberto depois do estado de erro. O E2E sem JS confere os valores preservados. |
| R-8: foco no resumo de erros só com JS | Com JS: `useEffect` foca o resumo (E2E CA-17). Sem JS: o resumo aparece no topo, e os links levam aos campos dentro de `details` abertos (E2E sem JS). |
| R-9: mudanças em `[id]/page.tsx` e `/painel/page.tsx` quebram testes da D-013/D-010 | T-6 exige `tests/integration/profissionais/paginas.test.ts` e `tests/integration/auth/paginas.test.ts` verdes **sem mudança**. |
| R-10: `permissoes.test.ts` exaustivo | T-1 atualiza a tabela esperada e acrescenta um caso para `jornada.ver` (gestor `salao`, profissional `proprio` com e sem alvo, super admin `negado`). |
| R-11: ação de demonstração exposta em produção | A ação recusa (estado inicial) sem `vitrineHabilitada`, não tem efeito colateral e não acessa o banco. Um unitário cobre os dois ramos. |
| R-12: lint `@next/next/no-html-link-for-pages` com `href` literal | Testes e componentes usam `ROTAS.*`. Os links do resumo de erros são `#âncoras`. |
| R-13: cobertura de `.tsx` e da casca | jsdom (T-5), `renderToStaticMarkup` com sessão real (T-6) e unitário da página e da ação de demonstração (T-7), sem exclusões. |

## 9. Estratégia de testes

| Camada | O quê |
|---|---|
| Unitário (`node`) | `src/lib/format.test.ts`: CA-20 (0, 5, 545, 1435, 1440; −5, 1445, 1.5, `NaN`, `'540'` lançam), `formatarFaixaDeMinutos` (inclusive `inicio >= fim` lança) e `formatarDiaDaSemana` (0..6; 7, −1 e 1.5 lançam). `format.fonte-unica.test.ts` verde sem mudança. `src/server/jornadas/validacao.test.ts`: `converterHorario` (R-5, ida e volta) e `validarSemana` (CA-2, CA-4, CA-5, CA-6, CA-7, CA-9: sobreposição nas duas linhas, idênticos, contíguos unidos, fora de ordem ordenados, 6 válidos aceitos, 7 recusados, linha vazia ignorada, só início ou só fim, `profissionalId` ausente, 6 ou 8 dias, dia repetido, dia 7, `salaoId` extra, mais de 20 linhas → `formulario`, todos os erros juntos). `src/server/jornadas/semana.test.ts`: `pausasDe`, `montarSemana` (7 dias, vazio), `diferenca` (igual → vazio; parcial). `src/server/auth/permissoes.test.ts`: `jornada.ver` (R-10). `src/config/navegacao.test.ts`: `devJornada`; `SEGMENTOS_RESERVADOS` inalterado. `src/server/repos/index.test.ts`: os métodos de `jornadas` com id malformado → `NaoEncontrado` sem consulta, e contexto inválido → `Error`. `src/app/dev/jornada/acoes.test.ts` e `page.test.tsx`: desligada → estado inicial/`notFound`; ligada → erros ou mensagem; os três modos. |
| Unitário (`jsdom`) | `FormularioJornada.test.tsx`: 7 `details` na ordem segunda → domingo, 6×2 campos por dia com rótulo e `fieldset`/`legend`, `aria-describedby` com a ajuda e o erro, `aria-invalid`, resumo de erros com links e focado, `details` aberto no dia com erro, valores preservados, resumo "Folga" e pausa no `summary`, alerta de sucesso/erro. `VisaoJornada.test.tsx`: sem `input`/`button`, "Folga", faixas e pausas formatadas. |
| Integração (PostgreSQL real) | `tests/integration/jornadas/`: `repos.test.ts` (T-2: listar ordenado só de A; trava 404 para B/inexistente; trava não filtra inativo; `aplicarDiferenca` com R-4; `deleteMany` não toca B), `salvar.test.ts` (CA-1, CA-2 com ids iguais, CA-4..CA-10, CA-14, CA-16, idempotência com ids preservados), `isolamento-permissoes.test.ts` (CA-3 profissional próprio/outro e super admin → 403 e banco igual; sem credencial → 401; CA-11 B/inexistente/`abc` → 404 com as linhas de B iguais e `salaoId` extra sem efeito; CA-12 gestor que atende salva a própria; CA-19 metadados explícitos; `obter`/`lerSemana`), `concorrencia.test.ts` (CA-13, R-1..R-3), `paginas.test.ts` (página e casca via `renderToStaticMarkup`, com `next/headers`/`next/navigation`/`next/cache` substituídos, sem mock de banco: CA-1, CA-11, CA-12, CA-14, CA-15, CA-16; `?salva=1`; casca válida → `revalidatePath` + redirect `?salva=1`; inválida → erros e valores; extras ignorados; `nao_autenticado` → `/entrar?proximo=…%2Fjornada`; link "Jornada" em `/painel/profissionais/[id]`; "Minha jornada" em `/painel` para o profissional e o gestor com perfil, ausente para o gestor sem perfil). `tests/integration/tenant/registro.test.ts` verde sem mudança. |
| E2E (Playwright, 375×812, sem banco) | `e2e/jornada.spec.ts` (CA-17): em `/dev/jornada`, só com teclado (Tab/Shift+Tab/Enter/Espaço), abre a segunda, preenche, envia com Enter; foco visível (outline > 0) em cada parada; com um erro, o foco vai ao resumo e o link leva ao campo; `aria-describedby` aponta para o texto do erro; axe 4.14.0 sem violações em `edicao`, em `edicao` com erro, em `leitura` e em `vazia`; sem rolagem horizontal. `e2e/jornada-sem-js.spec.ts` (CA-18): `javaScriptEnabled: false`; 6 intervalos num dia → POST 200 e a mensagem de demonstração; um inválido → erros do servidor e valores preservados; `?modo=leitura` mostra a jornada. Reaproveita `e2e/suporte/vitrine.ts` (só leitura). |
| Manual | T-8 (dev) e T-9 (tester) com Docker: o gestor salva pela página real, com e sem JS, a 375 px e só com o teclado; o profissional abre "Minha jornada"; o gestor tenta 22:00–02:00. |

**Cobertura ≥ 90%:** todo arquivo novo de `src/` tem teste direto. `page.tsx` e `acoes.ts` da jornada são cobertos por `paginas.test.ts`; os de `/dev/jornada`, por unitário. A medição é `npm run test:coverage` em T-8. Abaixo do limiar, a tarefa dona completa os testes, sem exclusões.

Comando de estabilidade (registrar no `dev.md` e sugerir para o `CLAUDE.md`):
```
for i in $(seq 10); do npx vitest run --project integration tests/integration/jornadas/concorrencia.test.ts || break; done
```

## 10. Tarefas

DBA e DevOps dispensados (§4, §5). Implementação: `desenvolvedor`.

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | desenvolvedor | — | T-2 | `src/server/auth/permissoes.ts`, `src/server/auth/permissoes.test.ts`, `src/config/navegacao.ts`, `src/config/navegacao.test.ts`, `src/lib/format.ts`, `src/lib/format.test.ts`, `src/server/jornadas/tipos.ts`, `src/server/jornadas/validacao.ts`, `src/server/jornadas/validacao.test.ts`, `src/server/jornadas/semana.ts`, `src/server/jornadas/semana.test.ts` |
| T-2 | desenvolvedor | — | T-1 | `src/server/repos/jornada.ts`, `src/server/repos/index.ts`, `src/server/repos/tipos.ts`, `src/server/repos/index.test.ts`, `tests/integration/jornadas/repos.test.ts` |
| T-3 | desenvolvedor | T-1, T-2 | T-5 | `src/server/jornadas/servico.ts`, `src/server/jornadas/leitura.ts`, `src/server/jornadas/jornadas.acao.ts`, `tests/integration/jornadas/apoio.ts`, `tests/integration/jornadas/salvar.test.ts`, `tests/integration/jornadas/isolamento-permissoes.test.ts` |
| T-4 | desenvolvedor | T-3 | T-6, T-7 | `tests/integration/jornadas/concorrencia.test.ts` |
| T-5 | desenvolvedor | T-1 | T-2, T-3 | `src/app/painel/profissionais/[id]/jornada/{estado.ts, FormularioJornada.tsx, FormularioJornada.test.tsx, VisaoJornada.tsx, VisaoJornada.test.tsx, Jornada.module.css}` |
| T-6 | desenvolvedor | T-3, T-5 | T-4, T-7 | `src/app/painel/profissionais/[id]/jornada/page.tsx`, `src/app/painel/profissionais/[id]/jornada/acoes.ts`, `src/app/painel/profissionais/[id]/page.tsx`, `src/app/painel/page.tsx`, `tests/integration/jornadas/paginas.test.ts` |
| T-7 | desenvolvedor | T-1, T-5 | T-4, T-6 | `src/app/dev/jornada/{page.tsx, page.test.tsx, acoes.ts, acoes.test.ts}`, `e2e/jornada.spec.ts`, `e2e/jornada-sem-js.spec.ts` |
| T-8 | desenvolvedor | T-4, T-6, T-7 | — | `README.md`, `docs/demandas/D-015/dev.md` |
| T-9 | tester | T-8 | — | `docs/demandas/D-015/testes.md` |

Rodadas, sem arquivo em comum:
- **Rodada 1:** T-1 ‖ T-2.
- **Rodada 2:** T-3 ‖ T-5. T-5 pode começar assim que T-1 terminar.
- **Rodada 3:** T-4 ‖ T-6 ‖ T-7. T-7 só depende de T-1 e T-5 e pode começar antes.
- **Rodada 4:** T-8.
- **Rodada 5:** T-9.

Regras de posse:
- Um defeito num arquivo reabre a tarefa dona. Arquivos de outras tarefas são só lidos: T-4 e T-6 importam `tests/integration/jornadas/apoio.ts` (de T-3); T-6 e T-7 importam `estado.ts`, `FormularioJornada.tsx` e `VisaoJornada.tsx` (de T-5); T-4 pode importar `tests/integration/profissionais/apoio.ts`; T-7 importa `e2e/suporte/vitrine.ts`.
- Ninguém edita `prisma/**`, `tests/support/**`, `tests/integration/tenant/**`, `tests/integration/profissionais/**`, `tests/integration/auth/**`, `src/server/tenant/**`, `src/server/auth/pagina.ts`, `src/server/repos/profissional.ts`, `src/server/profissionais/**`, `src/components/**`, `src/app/dev/componentes/**`, `e2e/suporte/**`, `e2e/a11y-base.spec.ts`, `playwright.config.ts`, `eslint.config.mjs` nem `vitest.config.ts`. O `CLAUDE.md` é do líder.

**T-1 — Permissão, rota, formatação, contratos e domínio puro.**
- Entregável: §3.1, §3.3 e §3.4; `'jornada.ver'` na matriz; `ROTAS.devJornada`.
- Conclusão: `npm run test:unit -- src/lib src/config src/server/auth/permissoes src/server/jornadas` verde com os casos de §9 (CA-2, CA-4..CA-7, CA-9, CA-20 e R-5); `format.fonte-unica.test.ts` verde; `tipos.ts`, `validacao.ts` e `semana.ts` sem import de runtime de `@/server/**`; lint e typecheck verdes.

**T-2 — Repositório.**
- Entregável: §3.2 com o cabeçalho da ordem canônica de travas e o marcador literal `FOR NO KEY UPDATE OF pj`; `Repos.jornadas`.
- Conclusão: `repos.test.ts` cobre a listagem ordenada só de A, a trava e a busca com 404 para B, inexistente e malformado, a trava que devolve um profissional inativo, `aplicarDiferenca` (remoção, inserção, listas vazias sem comando, R-4, linhas de B intactas) e uma violação proposital da exclusion por SQL direto (23P01), que prova que a garantia final está ativa. `index.test.ts` atualizado; os testes existentes de `tests/integration/servicos`/`profissionais` verdes; lint e typecheck verdes.

**T-3 — Serviço, leitura e ação.**
- Entregável: §3.5; `apoio.ts` (contexto e credenciais, `semana({ 1: [['09:00','12:00'], …] })` que monta os 7 dias, `linhasJornada(salaoId, profissionalId)` com ids, fotografia de `reserva`/`reserva_item` por `to_jsonb`, contagem de `mensagem`).
- Testes pela ação (`acao.executar(credencial, input, { agora })`), cobrindo CA-1..CA-12 (parte de serviço), CA-14, CA-16 e CA-19, conforme §9:
  - CA-8: os dois cenários.
  - CA-10: reserva com `reserva.inicio` numa quinta 18:00 UTC = 15:00 em São Paulo, quinta salva como folga, reserva igual byte a byte e `mensagem` com a mesma contagem.
  - CA-16: o salão com `fuso: 'America/Manaus'` e o padrão.
  - CA-14: desativar e reativar pelas ações da D-013, com as linhas de `jornada` idênticas.
- Conclusão: `npx vitest run --project integration tests/integration/jornadas` verde; `tests/integration/tenant/registro.test.ts` verde com `salvarJornada`; nenhum `next/*` em `src/server/jornadas/**`; lint e typecheck verdes.

**T-4 — Concorrência.**
- Entregável: CA-13 com R-1 (a) e (b), R-2 (`Promise.all` ×10 e o caso determinístico) e R-3 (compatibilidade de travas).
- Conclusão: o laço ×10 de §9 verde; `timeout` explícito em cada `it`; nenhum `deadlock detected`, 23P01 nem 5xx; conexões `pg` fechadas no `afterAll`.

**T-5 — Componentes.**
- Entregável: §3.6 (`estado.ts`, `FormularioJornada`, `VisaoJornada`, CSS) com os testes jsdom de §9.
- Conclusão: `npm run test:unit -- src/app/painel/profissionais/\[id\]/jornada` verde; os `.tsx` e o `estado.ts` não importam runtime de `@/server/**` além de `@/server/jornadas/tipos`; horários só por `src/lib/format.ts`; CSS só com `var(--…)` e o breakpoint `48rem`; todo `*.test.tsx` começa com `/** @vitest-environment jsdom */`; lint e typecheck verdes.

**T-6 — Páginas, casca e acessos.**
- Entregável: §3.6 (`page.tsx`, `acoes.ts`, a seção "Jornada" em `[id]/page.tsx` e "Minha jornada" em `/painel`) e `paginas.test.ts` conforme §9 e R-6.
- Conclusão: `npx vitest run --project integration tests/integration/jornadas/paginas.test.ts tests/integration/profissionais/paginas.test.ts tests/integration/auth/paginas.test.ts` verde (os dois últimos sem mudança); `npm run build` lista `/painel/profissionais/[id]/jornada`; `redirect`/`notFound` fora de `try`; a casca não importa `@/server/repos`; lint e typecheck verdes.

**T-7 — Página de demonstração e E2E.**
- Entregável: §3.7, `e2e/jornada.spec.ts` (CA-17) e `e2e/jornada-sem-js.spec.ts` (CA-18 na UI), com os unitários da página e da ação.
- Conclusão: `npm run test:e2e` verde (inclusive `a11y-base.spec.ts` sem mudança); axe sem violações nos quatro estados; `/dev/jornada` responde 404 sem a variável (unitário de `page.test.tsx`); lint e typecheck verdes.

**T-8 — Documentação e gates.**
- Entregável: a seção "Jornada" do README (formato HH:MM, 24:00, múltiplos de 5, até 6 intervalos por dia, contíguos unidos, sem efeito em reservas, profissional vê a própria em "Minha jornada", hora local do salão); `dev.md` com a evidência de todos os gates, a cobertura, o laço ×10 e o passo manual (375 px, só teclado, com e sem JS, na página real com Docker), mais o texto sugerido para o `CLAUDE.md` (D-015: módulo `src/server/jornadas/`, `'jornada.ver'`, `FOR NO KEY UPDATE OF pj`, ordem canônica estendida, `/dev/jornada`, comando de estabilidade).
- Conclusão: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:coverage` (≥ 90%) e `npm run test:e2e` verdes; o laço da T-4 ×10 verde.

**T-9 — Validação independente (tester).**
- Entregável: `testes.md` com o veredito.
- Escopo: repetir os gates e o laço; conferir o mapa abaixo; prova manual com Docker (gestor por `/cadastro`, profissional criado pela tela; para o CA-12 com profissional autenticado, usar a sessão da fábrica ou o fluxo disponível) cobrindo a página real com e sem JS, só com o teclado e com leitor de tela nos erros.

### Mapa CA → tarefa → tipo de teste

| CA | Tarefa(s) | Tipo | Arquivo |
|---|---|---|---|
| CA-1 | T-3, T-5, T-6 | Integração + jsdom | `salvar.test.ts`, `FormularioJornada.test.tsx`, `paginas.test.ts` |
| CA-2 | T-1, T-3 | Unitário + integração | `validacao.test.ts`, `salvar.test.ts` |
| CA-3 | T-3 | Integração | `isolamento-permissoes.test.ts` |
| CA-4 | T-1, T-3 | Unitário + integração | `validacao.test.ts`, `salvar.test.ts` |
| CA-5 | T-1, T-3, T-6 | Unitário + integração | `validacao.test.ts`, `format.test.ts`, `salvar.test.ts`, `paginas.test.ts` |
| CA-6 | T-1, T-3 | Unitário + integração | `validacao.test.ts`, `salvar.test.ts` |
| CA-7 | T-1, T-3 | Unitário + integração | `validacao.test.ts`, `salvar.test.ts` |
| CA-8 | T-3 | Integração | `salvar.test.ts` |
| CA-9 | T-1, T-3 | Unitário + integração | `validacao.test.ts`, `salvar.test.ts` |
| CA-10 | T-3 | Integração | `salvar.test.ts` |
| CA-11 | T-2, T-3, T-6 | Integração (dois salões) | `repos.test.ts`, `isolamento-permissoes.test.ts`, `paginas.test.ts` |
| CA-12 | T-1, T-3, T-6 | Unitário + integração | `permissoes.test.ts`, `isolamento-permissoes.test.ts`, `paginas.test.ts` |
| CA-13 | T-4 | Integração (concorrência ×10) | `concorrencia.test.ts` |
| CA-14 | T-3, T-6 | Integração | `salvar.test.ts`, `paginas.test.ts` |
| CA-15 | T-5, T-6, T-7 | jsdom + integração + E2E (axe) | `VisaoJornada.test.tsx`, `paginas.test.ts`, `jornada.spec.ts` |
| CA-16 | T-3, T-6 | Integração | `salvar.test.ts`, `paginas.test.ts` |
| CA-17 | T-5, T-7, T-9 | jsdom + E2E + manual | `FormularioJornada.test.tsx`, `jornada.spec.ts`, `testes.md` |
| CA-18 | T-6, T-7, T-9 | Integração (casca) + E2E sem JS + manual | `paginas.test.ts`, `jornada-sem-js.spec.ts`, `testes.md` |
| CA-19 | T-3 | Integração + registro | `isolamento-permissoes.test.ts`, `tenant/registro.test.ts` |
| CA-20 | T-1 | Unitário | `format.test.ts`, `format.fonte-unica.test.ts` |

## 11. Obrigações registradas para as próximas demandas

- **E3.1 (#27):**
  - Ler a jornada por `lerSemana` (`src/server/jornadas/leitura.ts`) ou, no fluxo público, por uma leitura em `repos/publico.ts` que reaproveite `montarSemana` (E3.1 decide; `PublicoContext` não é aceito pelos repositórios de tenant).
  - Interpretar `dia_semana` com RN-15 e os minutos como hora de parede no `salao.fuso`, tratando a hora inexistente ou repetida em DST.
  - Contar com a forma canônica (RN-5): intervalos ordenados, sem sobreposição nem contiguidade.
- **E3.2/E3.4/E3.5:** seguir a ordem canônica estendida (§3.2). A conferência `profissional … FOR SHARE` serializa com a gravação de jornada (D-12). Não usar `FOR UPDATE` no profissional para criar reserva.
- **E3.3/E3.4:** exibir horários de jornada só por `formatarMinutosDoDia`/`formatarFaixaDeMinutos`.
- **Opcional (sem demanda):** CHECK de múltiplo de 5 em `jornada`, se o produto fixar a D-1 (acionaria o DBA).
