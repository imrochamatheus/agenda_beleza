# D-020 — Desenho: perfil público e horário de funcionamento do salão (issue #75, E2.6)

Entradas: `docs/demandas/D-020/spec.md` (RN-1..RN-19, CA-1..CA-20, D-1..D-15), `CLAUDE.md`, `docs/trinks-alinhamento.md` (§7.1, §7.3, §8.1), `docs/demandas/D-015/design.md` (núcleo da semana, diferença sob trava), `docs/demandas/D-017/design.md` (trava do salão, padrão de tela sem PRG, `/dev/*`) e `docs/demandas/D-018/design.md` (consumidor futuro: `ContextoDeLeituraDeAgenda`, ainda não implementado). Código lido: `src/server/jornadas/{tipos,validacao,semana,servico,leitura}.ts`, `src/server/repos/{salao,jornada,publico,servico,index,tipos,transacao}.ts`, `src/server/salao/{tipos,configuracoes}.ts`, `src/server/tenant/context.ts`, `src/server/auth/permissoes.ts`, `src/config/navegacao.ts`, `src/lib/{texto,format}.ts`, `src/lib/format.fonte-unica.test.ts`, `src/app/painel/configuracoes/{page,acoes}.tsx/ts`, `src/app/painel/profissionais/[id]/jornada/{estado,FormularioJornada,VisaoJornada,acoes}.ts(x)`, `src/app/dev/jornada/{page,acoes}.ts(x)`, `prisma/schema.prisma` (`Salao`, `Jornada`), `prisma/migrations/20261118000200_restricoes_sql/migration.sql` (`jornada_*`, `cliente_telefone_e164_chk`), `tests/integration/db/drift.test.ts`, `eslint.config.mjs` e `src/components/conformidade.test.ts`.

## 0. Verificações feitas antes do desenho

- **Defaults bastam para os escritores atuais de `salao`.** `INSERT INTO salao (nome)` em `repos/cadastro.ts:57` e `tests/support/sql.ts:67`, e `db.salao.create` em `tests/support/factories.ts:84`, continuam válidos com colunas novas anuláveis ou com default constante (`'{}'`, `false`). **`tests/support/**` não muda.** No PostgreSQL 17 (`docker-compose.yml`), `ADD COLUMN … NOT NULL DEFAULT <constante>` não reescreve a tabela.
- **`ContextoEscopado = TenantContext | SistemaContext`** (`context.ts:54`). O `PublicoContext` só é aceito em `repos/publico.ts` (`exigirPublico`). A D-018 planeja um `ContextoDeLeituraDeAgenda` em `context.ts`, mas ele não existe em `main`. Esta demanda **não** mexe em `src/server/tenant/**`: a leitura sem papel despacha por `ctx.tipo` para dois pontos de entrada já guardados (§3.6).
- **`src/components/**` não pode importar `@/server` em tempo de execução** (`src/components/conformidade.test.ts:146`). Por isso o editor de semana compartilhado fica em `src/app/painel/_componentes/semana/`, ao lado de `AcessoNegado`, e não em `src/components/`.
- **`FOR NO KEY UPDATE` em `salao` já é a trava de serialização por salão** (D-017 D-18, `repos/salao.ts:86-95`). Ele conflita com `FOR SHARE`, `FOR NO KEY UPDATE` e `FOR UPDATE`, mas não com o `FOR KEY SHARE` que todo `INSERT` com FK para `salao` toma, inclusive o `INSERT` em `salao_funcionamento` feito pela própria transação. O `UPDATE salao SET <colunas que não são chave>` toma a mesma trava implicitamente.
- **Trava de linha e `xmin`:** `SELECT … FOR NO KEY UPDATE` grava o locker em `xmax` e não cria uma versão nova da tupla. `xmin` e `atualizado_em` só mudam com `UPDATE`. A idempotência do CA-4 depende de **não** emitir `UPDATE salao` quando o estado não muda (§3.4).
- **`@updatedAt` do Prisma é do cliente**: um `UPDATE` por `$executeRaw` não atualiza `atualizado_em`. O SQL bruto que muda `funcionamento_definido` precisa definir `atualizado_em = now()` explicitamente (§3.4).
- **Exclusion e DELETE na mesma transação:** a checagem ignora tuplas apagadas pela própria transação (D-015 §0, provado na T-2 da D-015). O padrão "DELETE dos removidos → INSERT dos novos" também vale aqui.
- **A jornada é consumida por import de `@/server/jornadas/{tipos,validacao,semana}`** em 7 arquivos de produção (`src/app/dev/jornada/*`, `src/app/painel/profissionais/[id]/jornada/*`) e em vários testes. A extração mantém esses três módulos como **fachadas** que reexportam os mesmos nomes, com os mesmos valores (CA-19).
- **`drift.test.ts`** confere tabelas e constraints de SQL bruto pelo nome. A tabela nova e as constraints novas entram nas listas dele (tarefa do DBA).
- `tests/integration/tenant/registro.test.ts` usa `import.meta.glob('/src/**/*.acao.ts')`, então os novos `*.acao.ts` entram sem mudança. `'salao.configurar'` já existe na matriz: **`permissoes.ts` não muda**.
- `itemAtivo` casa por prefixo de segmento, então `/painel/configuracoes/perfil` já marca "Configurações". Os primeiros segmentos das rotas novas (`painel`, `dev`) já são reservados: **`SEGMENTOS_RESERVADOS` não muda**.

## 1. Resumo da solução

1. **Migração aditiva** (DBA): colunas de perfil e `funcionamento_definido` em `salao`, e a tabela `salao_funcionamento` com o mesmo desenho da `jornada` (CHECKs de dia e faixa e exclusion por salão e dia), mais os CHECKs de defesa do perfil que o DBA aprovar (§4).
2. **Núcleo da semana extraído** para `src/server/semana/` (tipos, mensagens genéricas de intervalo, `converterHorario`, `validarDias`, `montarSemana`, `pausasDe` e `diferenca`). `src/server/jornadas/{tipos,validacao,semana}.ts` passam a ser fachadas com a mesma API e os mesmos textos.
3. **Telefone e formatação** em `src/lib/`: `telefone.ts` (lista única de DDDs, `normalizarTelefoneBr` → E.164) e, em `format.ts`, `formatarTelefone` e `formatarCep`.
4. **Domínio puro do perfil** (`src/server/salao/perfil-tipos.ts`, client-safe, e `perfil-validacao.ts`) e **do funcionamento** (`funcionamento-tipos.ts` e `funcionamento-validacao.ts`, sobre o núcleo da semana).
5. **Repositórios:** `RepoSalao` ganha `obterPerfil` e `atualizarPerfil` (um `UPDATE` só com as colunas do perfil). O novo `RepoFuncionamento` (`repos().funcionamento`) faz trava, listagem, diferença, troca do estado e leitura consistente. `repos/publico.ts` ganha `lerPerfilPublico` e `lerFuncionamentoPublico`, com projeção mínima.
6. **Serviços e ações:** `perfil.ts` + `perfil.acao.ts` (`salvarPerfilDoSalao`), `funcionamento.ts` + `funcionamento.acao.ts` (`salvarFuncionamentoDoSalao`), todos com `papeis: ['gestor']` e `capacidade: 'configurar'`. `funcionamento-leitura.ts` exporta `lerFuncionamento(ctx)` sem papel, para a E3.1.
7. **Editor de semana compartilhado** em `src/app/painel/_componentes/semana/`, extraído do `FormularioJornada`, que passa a usá-lo sem mudar o DOM.
8. **Telas:** `/painel/configuracoes/perfil` e `/painel/configuracoes/funcionamento` (estado na resposta, sem PRG, como a D-017), com links em `/painel/configuracoes`.
9. **E2E sem banco** em `/dev/perfil` e `/dev/funcionamento`, com os mesmos componentes e ações que só validam.

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Endereço, contatos e listas numa coluna `jsonb` | Sem CHECKs por campo, sem tipos no Prisma e com projeção pública mais frágil. O §8.1 do alinhamento pede "colunas de perfil anuláveis". |
| Tabela `salao_perfil` 1:1 | Uma junção a mais em toda leitura pública e uma segunda linha para serializar. As colunas cabem em `salao` e herdam a trava da D-017. |
| Contar linhas de `salao_funcionamento` para saber se o funcionamento foi informado | Não representa "fechado a semana inteira" (spec D-10). |
| Reaproveitar `validarSemana` da jornada passando um `profissionalId` falso | Acopla o salão à jornada e mantém o esquema estrito com um campo sem sentido. A extração do núcleo é o pedido da spec (§8). |
| Copiar o `FormularioJornada` para o funcionamento | São cerca de 170 linhas de JSX e regras de acessibilidade duplicadas, que divergiriam. A extração tem rede de proteção: os testes da jornada sem mudança e o E2E da jornada (A-7, R-2). |
| Leitura do funcionamento em dois comandos (estado e depois linhas) | Fora de transação, uma gravação concorrente de "não informar" entre os dois comandos produziria `{ definido: true }` com 7 dias fechados (página pública "sem horários"). Um único comando lê tudo do mesmo snapshot (A-5). |
| Novo contexto de leitura em `context.ts` (como o `ContextoDeLeituraDeAgenda` da D-018) | Mexe no núcleo de tenant numa demanda de cadastro. Despachar por `ctx.tipo` para `exigirEscopo`/`exigirPublico` dá o mesmo isolamento sem tocar `src/server/tenant/**` (A-6). A E3.1 pode unificar depois. |
| PRG (`redirect ?salvo=1`) depois de salvar | O padrão da família de configurações (D-017 D-23) é o estado na resposta, que funciona sem JS. Os valores canônicos voltam no estado. |
| `travar()` existente da D-017 estendido para devolver `funcionamento_definido` | Muda o contrato e os testes da D-017. Um método novo no repositório do funcionamento evita a regressão. |
| Advisory lock por salão | É um segundo mecanismo de trava. A linha de `salao` já serializa regras, slug e funcionamento. |

### 1.2 Dependências novas

Nenhuma. Usa `zod` (já usado pela jornada), `next/cache` e `next/navigation`, e os componentes de `src/components/ui/`.

## 2. Componentes afetados

| Caminho | Mudança |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/<ts>_perfil_funcionamento/migration.sql` (novo) | colunas em `Salao`, modelo `SalaoFuncionamento` e SQL bruto (DBA) |
| `tests/integration/db/drift.test.ts`, `tests/integration/db/perfil-funcionamento.test.ts` (novo) | catálogo e restrições (DBA) |
| `src/server/semana/{tipos,validacao,montagem}.ts` (+ testes) (novos) | núcleo da semana (§3.1) |
| `src/server/jornadas/{tipos,validacao,semana}.ts` | fachadas sobre o núcleo, com a mesma API (CA-19) |
| `src/lib/telefone.ts` (+ teste) (novo), `src/lib/format.ts` (+ `format.test.ts`) | normalizador e formatadores (§3.2) |
| `src/config/navegacao.ts` (+ teste) | `configuracoesPerfil`, `configuracoesFuncionamento`, `devPerfil` e `devFuncionamento` |
| `src/server/salao/perfil-tipos.ts`, `perfil-validacao.ts` (+ teste) (novos) | contratos, listas e validação do perfil (§3.3) |
| `src/server/salao/funcionamento-tipos.ts`, `funcionamento-validacao.ts` (+ teste) (novos) | contratos e validação do funcionamento (§3.4) |
| `src/server/repos/funcionamento.ts` (novo), `repos/salao.ts`, `repos/publico.ts`, `repos/index.ts`, `repos/tipos.ts`, `repos/index.test.ts` | repositórios (§3.5) |
| `src/server/repos/servico.ts`, `repos/jornada.ts` | **só o comentário** da ordem canônica de travas, com `salao` no topo |
| `src/server/salao/{perfil,funcionamento,funcionamento-leitura}.ts`, `perfil.acao.ts`, `funcionamento.acao.ts` (novos) | serviços, leitura sem papel e ações (§3.6) |
| `src/app/painel/_componentes/semana/**` (novo) | editor de semana compartilhado (§3.7) |
| `src/app/painel/profissionais/[id]/jornada/{FormularioJornada.tsx,estado.ts,Jornada.module.css}` | passam a usar o editor compartilhado, sem mudar o DOM |
| `src/app/painel/configuracoes/perfil/**`, `src/app/painel/configuracoes/funcionamento/**` (novos), `src/app/painel/configuracoes/page.tsx`, `Configuracoes.module.css` | telas (§3.8) |
| `src/app/dev/perfil/**`, `src/app/dev/funcionamento/**` (novos) | demonstrações (§3.9) |
| `tests/integration/salao/*` (arquivos novos, §10) | integração |
| `e2e/{perfil,perfil-sem-js,funcionamento,funcionamento-sem-js}.spec.ts` (novos) | CA-5 |
| `README.md` | seção "Perfil público e funcionamento" |

Nada muda em `src/server/tenant/**`, `src/server/auth/**`, `src/proxy.ts`, `src/components/**`, `tests/support/**`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`, `docker-compose.yml`, `Dockerfile` nem `.github/**`.

## 3. Interfaces

### 3.1 Núcleo da semana (`src/server/semana/`)

Arquivos puros, sem banco nem import de runtime de `@/server/**`. `tipos.ts` é client-safe.

```ts
// tipos.ts — movido de jornadas/tipos.ts, com nomes neutros
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const DIAS_SEMANA: readonly DiaSemana[];          // [0..6], congelado
export const ORDEM_EXIBICAO_DIAS: readonly DiaSemana[];  // [1..6, 0]
export const LIMITES_SEMANA: Readonly<{ intervalosPorDia: 6; linhasPorDia: 6; linhasRecebidasMax: 20; passoMin: 5; fimMax: 1440; horarioMaxCaracteres: 10 }>;
export type IntervaloMin = { inicioMin: number; fimMin: number };
export type DiaSemanaHoraria = { diaSemana: DiaSemana; intervalos: IntervaloMin[]; pausas: IntervaloMin[] };
/** Sempre 7 itens, índice = diaSemana; intervalos canônicos (ordenados, sem sobreposição nem contiguidade). */
export type SemanaHoraria = readonly DiaSemanaHoraria[];
export type ErroIntervalo = { inicio?: string; fim?: string; intervalo?: string };
export type ErrosDia = { dia?: string; intervalos?: Partial<Record<number, ErroIntervalo>> };
export type ErrosSemana = { formulario?: string; dias?: Partial<Record<DiaSemana, ErrosDia>> };
export type LinhaEntrada = { inicio?: string; fim?: string };
export type DiaEntrada = { diaSemana: number; intervalos: LinhaEntrada[] };
/** Textos genéricos de intervalo (iguais, caractere a caractere, aos de MENSAGENS_JORNADA hoje). */
export const MENSAGENS_INTERVALO: Readonly<{
  formato; granularidade; inicio24; faltaInicio; faltaFim; ordem; sobreposicao; limite; formulario; ajudaHorario;
}>;
```

```ts
// validacao.ts — corpo movido de jornadas/validacao.ts, sem mudança de regra
export type IntervaloDoDia = { diaSemana: DiaSemana; inicioMin: number; fimMin: number };
export function converterHorario(v: unknown): { ok: true; min: number } | { ok: false; erro: 'formato' | 'granularidade' };
/**
 * Regras 1..4 da D-015 sobre os 7 dias: array de exatamente 7 { diaSemana 0..6 distintos, intervalos[≤ 20] }
 * com objetos estritos. Forma inválida → { ok: false, erros: { formulario } }. Erros de campo todos juntos.
 * Sem erros: intervalos canônicos ordenados por (diaSemana, inicioMin).
 */
export function validarDias(dias: unknown): { ok: true; intervalos: IntervaloDoDia[] } | { ok: false; erros: ErrosSemana };
```

```ts
// montagem.ts — movido de jornadas/semana.ts
export function pausasDe(intervalos: readonly IntervaloMin[]): IntervaloMin[];
export function montarSemana(linhas: readonly { diaSemana: number; inicioMin: number; fimMin: number }[]): SemanaHoraria;
export function diferenca(
  existentes: readonly { id: string; diaSemana: number; inicioMin: number; fimMin: number }[],
  desejados: readonly { diaSemana: number; inicioMin: number; fimMin: number }[],
): { remover: string[]; inserir: { diaSemana: number; inicioMin: number; fimMin: number }[] };
```

**Fachadas da jornada (CA-19):**
- `jornadas/tipos.ts` reexporta `DiaSemana`, `DIAS_SEMANA`, `ORDEM_EXIBICAO_DIAS`, `IntervaloMin`, `ErroIntervalo`, `ErrosDia` e `LinhaEntrada`, e define os aliases `DiaJornada = DiaSemanaHoraria`, `SemanaJornada = SemanaHoraria`, `ErrosJornada = ErrosSemana`, `DiaEntrada` e `LIMITES_JORNADA = LIMITES_SEMANA` (mesmo objeto). `MENSAGENS_JORNADA = Object.freeze({ ...MENSAGENS_INTERVALO, resumoErros, salva, demonstracao, semIntervalos, inativo, somenteLeitura, folga, naoEncontrado, acessoNegado })`, com **o mesmo conjunto de chaves e os mesmos textos** de hoje (o teste do T-1 compara com uma cópia literal).
- `jornadas/validacao.ts` reexporta `converterHorario` e `IntervaloDoDia`. `validarSemana(e)` passa a ser `z.strictObject({ profissionalId: z.string(), dias: z.unknown() })` → falha devolve o mesmo objeto `FORMULARIO` congelado; depois `validarDias(dias)`; e por fim `{ ok, profissionalId, intervalos }`. O comportamento é idêntico para toda entrada: ausência de `dias` → `formulario`, como hoje.
- `jornadas/semana.ts` reexporta `pausasDe`, `montarSemana` e `diferenca`. O tipo de `existentes` aceita `JornadaLinhaDTO`, que é estruturalmente compatível.

### 3.2 Telefone e formatação (`src/lib/`)

```ts
// telefone.ts — puro, sem imports de servidor; a E5.1 reaproveita (sem copiar a lista)
/** 67 DDDs brasileiros válidos (Anatel): 11–19, 21, 22, 24, 27, 28, 31–35, 37, 38, 41–49, 51, 53–55, 61–69, 71, 73–75, 77, 79, 81–89, 91–99. */
export const DDDS_BRASIL: ReadonlySet<string>;
export const TELEFONE_MAX_CARACTERES = 30;
/**
 * RN-7. Não-string ou acima de TELEFONE_MAX_CARACTERES → null. Depois de aparar:
 * 1) só [0-9 ()\-.+]; o '+' só na posição 0 e seguido de "55" (depois de remover os separadores);
 * 2) remove ' ', '(', ')', '-', '.'; com '+55' → retira; sem '+', 12 ou 13 dígitos começando por "55" → retira;
 * 3) sobram 10 (DDD ∈ DDDS_BRASIL e 3º dígito 2–5) ou 11 (DDD ∈ DDDS_BRASIL e 3º dígito 9) dígitos;
 * → "+55" + dígitos. Qualquer outra coisa → null. Nunca lança.
 */
export function normalizarTelefoneBr(v: unknown): string | null;
/** true se `v` casa /^\+55\d{10,11}$/ com DDD da lista e a regra do 3º dígito (usado pelo formatador). */
export function ehTelefoneBrE164(v: unknown): v is string;
```

`0800 123 4567` → `08001234567` (DDD `08` inexistente) → `null`; `4004-1234` → 8 dígitos → `null`; `+1 212…` → `+` não seguido de 55 → `null`; `(11) 88765-4321` → 11 dígitos com 3º dígito 8 → `null`.

```ts
// format.ts (acréscimo) — a única formatação de exibição
/** '+551134567890' → '(11) 3456-7890'; '+5511987654321' → '(11) 98765-4321'. Fora do formato gravado (ehTelefoneBrE164) → RangeError. */
export function formatarTelefone(e164: string): string;
/** '01310100' → '01310-100'. Fora de /^\d{8}$/ → RangeError. */
export function formatarCep(cep: string): string;
```

`format.ts` importa `ehTelefoneBrE164` de `./telefone` (mesma pasta, pura).

### 3.3 Perfil: contratos e validação (`src/server/salao/perfil-tipos.ts`, `perfil-validacao.ts`)

`perfil-tipos.ts` é client-safe (sem import de runtime de `@/server/**`).

```ts
export const MEIOS_PAGAMENTO = Object.freeze([
  { chave: 'dinheiro', rotulo: 'Dinheiro' }, { chave: 'pix', rotulo: 'Pix' },
  { chave: 'cartao_credito', rotulo: 'Cartão de crédito' }, { chave: 'cartao_debito', rotulo: 'Cartão de débito' },
  { chave: 'carteira_digital', rotulo: 'Carteira digital por aproximação' }, { chave: 'vale_presente', rotulo: 'Vale-presente do salão' },
] as const);
export const COMODIDADES = Object.freeze([
  { chave: 'wifi', rotulo: 'Wi-Fi para clientes' }, { chave: 'estacionamento', rotulo: 'Estacionamento' },
  { chave: 'acessibilidade', rotulo: 'Acesso para cadeira de rodas' }, { chave: 'bebidas', rotulo: 'Café e bebidas' },
  { chave: 'criancas', rotulo: 'Atende crianças' }, { chave: 'ar_condicionado', rotulo: 'Ar-condicionado' },
  { chave: 'animais', rotulo: 'Aceita animais de estimação' },
] as const);
export type ChaveMeioPagamento = (typeof MEIOS_PAGAMENTO)[number]['chave'];
export type ChaveComodidade = (typeof COMODIDADES)[number]['chave'];
export const UFS = Object.freeze(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const);
export type Uf = (typeof UFS)[number];

export const LIMITES_PERFIL = Object.freeze({
  descricao: 1000,          // unidades UTF-16 depois de normalizar (D-4)
  descricaoMaxBruta: 2000,  // acima disso → erro de descrição sem processar (anti-payload)
  logradouro: 120, numero: 10, complemento: 60, bairro: 80, cidade: 80,
  textoMaxBruto: 200,       // campos de uma linha: acima disso → erro do campo sem processar
  instagram: 30, instagramMaxBruto: 200,
  itensListaMax: 20,        // lista com mais itens → erro da lista
  ecoMaxCaracteres: 200, ecoDescricaoMaxCaracteres: 2000,
});

/** Mantém só chaves conhecidas, sem repetição, na ordem da lista. Puro; também usado pela leitura pública. */
export function filtrarChaves<T extends string>(lista: readonly { chave: T }[], valores: readonly string[]): T[];

export type CampoPerfil = 'descricao' | 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf' | 'cep'
  | 'telefone' | 'whatsapp' | 'instagram' | 'meiosPagamento' | 'comodidades';
export type CampoTextoPerfil = Exclude<CampoPerfil, 'meiosPagamento' | 'comodidades'>;
export type ErrosPerfil = Partial<Record<CampoPerfil, string>> & { formulario?: string };
export type ValoresPerfil = Record<CampoTextoPerfil, string> & { meiosPagamento: string[]; comodidades: string[] };
export type EntradaPerfil = Partial<Record<CampoPerfil, unknown>>; // chaves extras (salaoId…) ignoradas

export type Endereco = { logradouro: string; numero: string; complemento: string | null; bairro: string; cidade: string; uf: Uf; cep: string };
/** Perfil validado e normalizado (o que é gravado). */
export type PerfilSalao = {
  descricao: string | null; endereco: Endereco | null; telefoneE164: string | null; whatsappE164: string | null;
  instagram: string | null; meiosPagamento: ChaveMeioPagamento[]; comodidades: ChaveComodidade[];
};
export type ResultadoSalvarPerfil =
  | { resultado: 'salvo'; valores: ValoresPerfil }
  | { resultado: 'invalido'; erros: ErrosPerfil };

export const MENSAGENS_PERFIL = Object.freeze({
  descricao: 'Use no máximo 1.000 caracteres na descrição.',
  descricaoCaracteres: 'A descrição tem caracteres não permitidos.',
  enderecoObrigatorio: 'Preencha este campo ou deixe o endereço todo em branco.',
  logradouro: 'Use até 120 caracteres, sem quebras de linha.',
  numero: 'Use até 10 caracteres, sem quebras de linha (ex.: 123, 123A ou s/n).',
  complemento: 'Use até 60 caracteres, sem quebras de linha.',
  bairro: 'Use até 80 caracteres, sem quebras de linha.',
  cidade: 'Use até 80 caracteres, sem quebras de linha.',
  uf: 'Escolha uma UF da lista.',
  cep: 'Informe o CEP com 8 dígitos (ex.: 01310-100).',
  telefone: 'Informe um telefone brasileiro com DDD (ex.: (11) 3456-7890 ou (11) 98765-4321).',
  instagram: 'Informe o perfil do Instagram (ex.: @meusalao).',
  lista: 'Escolha opções da lista.',
  resumoErros: 'Corrija os campos indicados para salvar o perfil.',
  salvo: 'Perfil público salvo.',
  demonstracao: 'Perfil válido (demonstração: nada foi gravado).',
  ajudaPublico: 'Tudo o que você preencher aqui aparece na página pública do salão, inclusive os telefones.',
  ajudaDescricao: 'Texto simples, sem formatação. As quebras de linha são mantidas.',
  formulario: 'Não foi possível ler os dados enviados. Recarregue a página e tente de novo.',
  acessoNegado: 'Acesso negado.',
});
```

```ts
// perfil-validacao.ts — puro; só import type de repos/tipos. Reutilizável pela E8.2.
/** RN-4..RN-9. Todos os erros juntos. Entrada que não é objeto → { formulario }. */
export function validarPerfil(e: unknown): { ok: true; perfil: PerfilSalao } | { ok: false; erros: ErrosPerfil };
export function normalizarDescricao(v: unknown): { ok: true; valor: string | null } | { ok: false; erro: string };
export function normalizarCep(v: string): string | null;        // '' tratado antes; inválido → null
export function normalizarInstagram(v: string): string | null;  // '' tratado antes; inválido → null
/** PerfilDTO (banco) → valores do formulário: telefone por formatarTelefone, CEP por formatarCep e listas por filtrarChaves. */
export function valoresDoPerfil(p: PerfilDTO): ValoresPerfil;
/** PerfilSalao → PerfilDTO (colunas). */
export function perfilParaColunas(p: PerfilSalao): PerfilDTO;
```

Regras de `validarPerfil`:
- **Tipos:** campo de texto ausente equivale a `''`. Campo de texto não-string → erro **do campo** (mensagem do campo). Lista ausente → `[]`. Lista não-array, com item não-string ou com mais de `itensListaMax` itens → `lista`.
- **Descrição:** acima de `descricaoMaxBruta` → `descricao`. Depois `\r\n|\r` → `\n` e `\t` → ` `. Se restar caractere `\p{Cc}` diferente de `\n` → `descricaoCaracteres`. Apara; vazio → `null`; `length > 1000` → `descricao`.
- **Campos de uma linha** (logradouro, número, complemento, bairro, cidade): acima de `textoMaxBruto` → erro do campo. Aparar a string vazia dá "ausente". Senão, `normalizarNome(v, { min: 1, max })` de `src/lib/texto.ts`, e `null` → erro do campo. Número: `/^s\/n$/i` → `s/n`.
- **UF:** `trim().toUpperCase()` ∈ `UFS`; `''` = ausente.
- **CEP:** `trim()`; `''` = ausente; `/^\d{5}-?\d{3}$/`, sem o hífen e diferente de `00000000`.
- **Bloco do endereço (D-5):** "preenchido" = algum dos 7 campos com texto depois de aparar. Se estiver preenchido, cada um dos 6 obrigatórios ausente recebe `enderecoObrigatorio`. Os erros de formato prevalecem sobre a obrigatoriedade no mesmo campo. Se não estiver preenchido, `endereco: null`.
- **Telefone/WhatsApp:** `''` (depois de aparar) = ausente; senão `normalizarTelefoneBr`, e `null` → `telefone` no respectivo campo.
- **Instagram:** acima de `instagramMaxBruto` → erro. `''` = ausente. Se casar `/^(https?:\/\/)?(www\.)?instagram\.com(\/|$)/i`: descarta `?…` e `#…`, separa o caminho por `/` sem os segmentos vazios, e só aceita exatamente 1 segmento (host `instagram.com` ou `www.instagram.com`, sem porta nem credencial). Senão, remove um `@` inicial. Depois `toLowerCase()`, `/^[a-z0-9._]{1,30}$/`, sem ponto inicial ou final e sem `..`. Implementação por regex e `split`, **sem `new URL`** (nada lança).
- **Listas:** só chaves conhecidas. Uma chave desconhecida → `lista` (nada é gravado). Repetições são ignoradas; a saída é `filtrarChaves`.

### 3.4 Funcionamento: contratos e validação (`src/server/salao/funcionamento-tipos.ts`, `funcionamento-validacao.ts`)

```ts
// funcionamento-tipos.ts — client-safe
export type ModoFuncionamento = 'informar' | 'nao_informar';
export const MODOS_FUNCIONAMENTO: readonly ModoFuncionamento[];
/** RN-13/RN-17. Com definido true: 7 dias (índice = diaSemana), dia sem intervalos = fechado. */
export type Funcionamento = { definido: false } | { definido: true; semana: SemanaHoraria };
export type ErrosFuncionamento = ErrosSemana & { modo?: string };
export type EntradaFuncionamento = { modo?: unknown; dias?: unknown };
export type ResultadoSalvarFuncionamento =
  | { resultado: 'salvo'; funcionamento: Funcionamento; alterado: boolean }
  | { resultado: 'invalido'; erros: ErrosFuncionamento };
export const MENSAGENS_FUNCIONAMENTO = Object.freeze({
  ...MENSAGENS_INTERVALO,                    // as mesmas mensagens por intervalo da jornada (RN-12)
  modo: 'Escolha se o horário de funcionamento será informado.',
  opcaoNaoInformar: 'Não informar (a disponibilidade segue só a jornada de cada profissional)',
  opcaoInformar: 'Informar o horário abaixo',
  ajudaNaoInformar: 'Com "Não informar", os horários digitados abaixo são descartados ao salvar.',
  ajudaFeriados: 'Para feriados e fechamentos em datas específicas, use um bloqueio do salão inteiro.',
  fechado: 'Fechado',
  naoInformado: 'Horário de funcionamento não informado: os horários oferecidos seguem só a jornada de cada profissional.',
  todosFechados: 'Todos os dias estão fechados: o salão não terá horários disponíveis para reserva.',
  resumoErros: 'Corrija os campos indicados para salvar o horário de funcionamento.',
  salvo: 'Horário de funcionamento salvo.',
  demonstracao: 'Horário válido (demonstração: nada foi gravado).',
  acessoNegado: 'Acesso negado.',
});
```

```ts
// funcionamento-validacao.ts — puro
/**
 * Entrada que não é objeto → { formulario }. `modo` ∉ MODOS_FUNCIONAMENTO → { modo } (e nada mais).
 * 'nao_informar' → ok SEM olhar `dias` (RN-14). 'informar' → validarDias(e.dias).
 */
export function validarFuncionamento(e: unknown):
  | { ok: true; modo: 'nao_informar' }
  | { ok: true; modo: 'informar'; intervalos: IntervaloDoDia[] }
  | { ok: false; erros: ErrosFuncionamento };
```

### 3.5 Repositórios

Tipos em `repos/tipos.ts`:

```ts
export type PerfilDTO = {
  descricao: string | null; enderecoLogradouro: string | null; enderecoNumero: string | null; enderecoComplemento: string | null;
  enderecoBairro: string | null; enderecoCidade: string | null; enderecoUf: string | null; enderecoCep: string | null;
  telefoneE164: string | null; whatsappE164: string | null; instagram: string | null;
  meiosPagamento: string[]; comodidades: string[];   // cru do banco (pode ter chave fora da lista)
};
export type FuncionamentoLinhaDTO = { id: string; diaSemana: number; inicioMin: number; fimMin: number };
/** Leitura consistente (um comando). `linhas` é sempre [] quando definido = false (RN-13, defesa no SQL). */
export type FuncionamentoDTO = { definido: boolean; linhas: { diaSemana: number; inicioMin: number; fimMin: number }[] };
```

**`RepoSalao` (acréscimos em `repos/salao.ts`):**

```ts
/** select explícito das 13 colunas do perfil; sem linha → NaoEncontrado. */
obterPerfil(ctx: ContextoEscopado): Promise<PerfilDTO>;
/** updateMany { id } SÓ com as 13 colunas do perfil (@updatedAt atualiza atualizado_em); 0 linhas → NaoEncontrado.
 *  Um comando, sem trava explícita: o UPDATE toma FOR NO KEY UPDATE e serializa com regras, slug e funcionamento. */
atualizarPerfil(ctx: ContextoEscopado, d: PerfilDTO): Promise<void>;
```

**`RepoFuncionamento` (`repos/funcionamento.ts`, novo, em `Repos.funcionamento`):**

```ts
export interface RepoFuncionamento {
  /** `SELECT funcionamento_definido FROM salao WHERE id = $1::uuid FOR NO KEY UPDATE` → { definido }; sem linha → NaoEncontrado.
   *  Só dentro de emTransacao. Mesmo texto-marcador "FOR NO KEY UPDATE" da D-017. */
  travar(ctx: ContextoEscopado): Promise<{ definido: boolean }>;
  /** Linhas do salão (em COMANDO SEPARADO da trava), por dia_semana, inicio_min, id. */
  listar(ctx: ContextoEscopado): Promise<FuncionamentoLinhaDTO[]>;
  /** (1) DELETE dos ids de `remover` do salão; (2) createMany de `inserir`. Listas vazias pulam o comando. */
  aplicarDiferenca(ctx: ContextoEscopado, d: { remover: readonly string[]; inserir: readonly { diaSemana: number; inicioMin: number; fimMin: number }[] }):
    Promise<{ removidos: number; inseridos: number }>;
  /** `UPDATE salao SET funcionamento_definido = $2, atualizado_em = now() WHERE id = $1 AND funcionamento_definido IS DISTINCT FROM $2`.
   *  Devolve true se escreveu. Pré-condição: trava tomada. */
  definirEstado(ctx: ContextoEscopado, definido: boolean): Promise<boolean>;
  /** Leitura consistente para ContextoEscopado (um comando, CONSULTA_FUNCIONAMENTO); salão inexistente → NaoEncontrado. */
  ler(ctx: ContextoEscopado): Promise<FuncionamentoDTO>;
}

/**
 * Fragmento único (Prisma.sql) usado por `ler`, `lerFuncionamentoPublico` e `lerPerfilPublico` e, na E3.1, pelo
 * repositório de disponibilidade. Supõe o alias `s` para salao:
 *   s.funcionamento_definido AS funcionamento_definido,
 *   COALESCE((SELECT json_agg(json_build_object('diaSemana', f.dia_semana, 'inicioMin', f.inicio_min, 'fimMin', f.fim_min)
 *                              ORDER BY f.dia_semana, f.inicio_min)
 *               FROM salao_funcionamento f
 *              WHERE f.salao_id = s.id AND s.funcionamento_definido), '[]'::json) AS funcionamento_linhas
 */
export const COLUNAS_FUNCIONAMENTO: Prisma.Sql;
/** Converte as duas colunas acima em FuncionamentoDTO (valida números inteiros; lança Error em forma inesperada). */
export function funcionamentoDaLinha(l: { funcionamento_definido: boolean; funcionamento_linhas: unknown }): FuncionamentoDTO;
```

**`repos/publico.ts` (acréscimos), só `PublicoContext` (`exigirPublico`), um comando cada:**

```ts
export type EnderecoPublico = { logradouro: string; numero: string; complemento: string | null; bairro: string; cidade: string; uf: string; cep: string };
export type PerfilPublico = {
  nome: string; descricao: string | null; endereco: EnderecoPublico | null;
  telefoneE164: string | null; whatsappE164: string | null; instagram: string | null;
  meiosPagamento: ChaveMeioPagamento[]; comodidades: ChaveComodidade[];
  funcionamento: SemanaHoraria | null;   // null = não informado
};
/** SELECT s.nome, s.descricao, s.endereco_*, s.telefone_e164, s.whatsapp_e164, s.instagram, s.meios_pagamento, s.comodidades,
 *  ${COLUNAS_FUNCIONAMENTO} FROM salao s WHERE s.id = $1. Sem linha → NaoEncontrado. Não filtra suspensão (RN-18).
 *  endereco = null se algum dos 6 obrigatórios for NULL; listas por filtrarChaves; funcionamento por montarSemana. */
export async function lerPerfilPublico(ctx: PublicoContext): Promise<PerfilPublico>;
/** Mesmo fragmento, só o funcionamento (para a leitura sem papel quando o contexto é público). */
export async function lerFuncionamentoPublico(ctx: PublicoContext): Promise<FuncionamentoDTO>;
```

`publico.ts` passa a importar `filtrarChaves`/`MEIOS_PAGAMENTO`/`COMODIDADES` de `@/server/salao/perfil-tipos` (puro), `montarSemana` de `@/server/semana/montagem` (puro) e `COLUNAS_FUNCIONAMENTO`/`funcionamentoDaLinha` de `./funcionamento`.

**Ordem canônica de travas (comentário em `repos/servico.ts`, `repos/jornada.ts` e no cabeçalho de `repos/funcionamento.ts`):**
```
salao (FOR NO KEY UPDATE: regras, slug, perfil por UPDATE, funcionamento)
  → profissional (FOR UPDATE | FOR NO KEY UPDATE | FOR SHARE)
    → servico(s) → servico_profissional / jornada / salao_funcionamento / reserva / reserva_item
```
Nenhuma transação existente trava `profissional` antes de `salao` com uma trava que conflite com `FOR NO KEY UPDATE`. Os `INSERT` com FK só tomam `FOR KEY SHARE` em `salao`, que não conflita. Logo, não há ciclo.

### 3.6 Serviços, leitura sem papel e ações

Sem `next/*`. Cada função de serviço começa com `exigirPermissao(ctx, 'salao.configurar')`.

```ts
// perfil.ts
export async function obterPerfil(ctx: TenantContext): Promise<{ valores: ValoresPerfil }>;
/** validarPerfil (antes de qualquer acesso) → inválido: nada gravado; válido: repos().saloes.atualizarPerfil (um UPDATE).
 *  → salvo com valoresDoPerfil(perfilParaColunas(perfil)). Prevalece a última gravação (D-13). */
export async function salvarPerfil(ctx: TenantContext, e: unknown): Promise<ResultadoSalvarPerfil>;
```

```ts
// funcionamento.ts
export async function obterFuncionamento(ctx: TenantContext): Promise<Funcionamento>; // via lerFuncionamento(ctx)
/**
 * v = validarFuncionamento(e); inválido → nada (nem trava).
 * emTransacao(t => {
 *   { definido } = t.funcionamento.travar(ctx)          // 404 se o salão não existe
 *   atuais = t.funcionamento.listar(ctx)                // comando separado
 *   nao_informar: d = { remover: atuais.map(id), inserir: [] }; estado = false
 *   informar:     d = diferenca(atuais, v.intervalos);  estado = true
 *   r = t.funcionamento.aplicarDiferenca(ctx, d)        // listas vazias → nenhum comando
 *   mudouEstado = definido !== estado ? t.funcionamento.definirEstado(ctx, estado) : false
 * })
 * → salvo { funcionamento: estado ? { definido: true, semana: montarSemana(v.intervalos) } : { definido: false },
 *           alterado: r.removidos + r.inseridos > 0 || mudouEstado }
 */
export async function salvarFuncionamento(ctx: TenantContext, e: unknown): Promise<ResultadoSalvarFuncionamento>;
```

Mesmo estado e mesma semana → `travar` + `listar` + nenhuma escrita: os ids, `xmin` e `atualizado_em` ficam iguais (CA-4, CA-8). Não toca reserva, jornada, bloqueio nem `mensagem`, e não enfileira nada (RN-15).

```ts
// funcionamento-leitura.ts — SEM checagem de papel (RN-17; para a E3.1, análoga a lerSemana)
/**
 * Aceita TenantContext, SistemaContext ou PublicoContext; despacha por ctx.tipo:
 *   'publico' → lerFuncionamentoPublico(ctx) (exigirPublico); qualquer outro → repos().funcionamento.ler(ctx) (exigirEscopo,
 *   que recusa AdminContext e objetos forjados com Error 500).
 * Devolve { definido: false } ou { definido: true, semana: montarSemana(linhas) } (7 dias, canônicos, com pausas).
 * Obrigações de quem consome: iguais às de lerSemana (0 = domingo; minutos de parede no salao.fuso; conversão em
 * instantes, inclusive horário de verão, com src/server/tempo/fuso.ts); definido false → NÃO limita; dia vazio → fechado.
 */
export async function lerFuncionamento(ctx: ContextoEscopado | PublicoContext): Promise<Funcionamento>;
```

```ts
// perfil.acao.ts / funcionamento.acao.ts — sem 'use server'; só exportações de defineAcao
export const salvarPerfilDoSalao = defineAcao<EntradaPerfil, ResultadoSalvarPerfil>(
  { papeis: ['gestor'], capacidade: 'configurar' }, (ctx, e) => perfil.salvarPerfil(ctx, e));
export const salvarFuncionamentoDoSalao = defineAcao<EntradaFuncionamento, ResultadoSalvarFuncionamento>(
  { papeis: ['gestor'], capacidade: 'configurar' }, (ctx, e) => funcionamento.salvarFuncionamento(ctx, e));
```

Logs JSON em uma linha, **só com ids e contagens** (nunca telefone, endereço ou descrição): `salao.perfil_salvo { salaoId }` e `salao.funcionamento_salvo { salaoId, definido, inseridos, removidos, mudouEstado }`.

### 3.7 Editor de semana compartilhado (`src/app/painel/_componentes/semana/`)

Extraído do `FormularioJornada`/`estado.ts` da jornada **sem mudar o DOM gerado** (ids, nomes, rótulos, classes visíveis, `aria-*` e ordem).

| Arquivo | Conteúdo |
|---|---|
| `formulario.ts` (+ `.test.ts`) | `ValorLinha`, `ValoresSemana`; `nomeDoCampo(dia, n, campo)` → `inicio-<dia>-<n>`; `idDoCampo(prefixo, dia, n, campo)` → `<prefixo>-<dia>-<n>-<campo>`; `idDoErroDaLinha(prefixo, dia, n)`; `idDoErroDoDia(prefixo, dia)`; `valoresDaSemana(semana)`; `lerSemanaDoFormulario(fd)` → `{ dias: DiaEntrada[]; valores }` (só os 7 × 6 × 2 nomes, eco cortado em `horarioMaxCaracteres`); `textoDosIntervalos(dia, textoVazio)`; `textoDasPausas(dia)`; `resumoDoDia(dia, textoVazio)`; `itensDoResumo(prefixo, erros: ErrosSemana)` → `{ href, texto }[]`. Importa só `@/lib/format` e tipos e constantes de `@/server/semana/tipos`. |
| `CamposDaSemana.tsx` (+ `.test.tsx`) | `'use client'`-compatível, sem estado. Props: `prefixoId`, `idAjuda`, `semana`, `valores`, `erros: ErrosSemana`, `textoDiaVazio`. Renderiza os 7 `<details>` (segunda → domingo), com o `<summary>` (`resumoDoDia`), `<fieldset>` com `<legend>Intervalos de <dia></legend>`, o erro do dia e as 6 linhas. |
| `ResumoDeErros.tsx` | `forwardRef` do `<div role="alert" tabIndex={-1}>` com título e links (`itensDoResumo`). |
| `Semana.module.css` | As classes de dia e de linha movidas de `Jornada.module.css` (só `var(--…)` e o breakpoint `48rem`). |

A jornada continua com o prefixo `jornada` e o texto `Folga`. `estado.ts` da jornada mantém **todas** as exportações atuais (`nomeDoCampo`, `idDoCampo(dia, n, campo)`, `idDoErroDaLinha`, `idDoErroDoDia`, `valoresDaSemana`, `lerFormularioJornada`, `textoDosIntervalos`, `textoDasPausas`, `resumoDoDia`, `ESTADO_INICIAL_FORMULARIO_JORNADA` e os tipos) como fachadas que fixam o prefixo `jornada` e `MENSAGENS_JORNADA.folga`.

### 3.8 Telas

**`/painel/configuracoes` (`page.tsx`):** depois do `h1`, uma `<nav aria-label="Outras configurações">` com dois links (`ROTAS.configuracoesPerfil` "Perfil público" e `ROTAS.configuracoesFuncionamento` "Horário de funcionamento"), cada um com uma linha de descrição.

**`/painel/configuracoes/perfil/`**

| Arquivo | Conteúdo |
|---|---|
| `estado.ts` | `EstadoPerfil = { mensagem: string \| null; sucesso: string \| null; erros: ErrosPerfil; valores: ValoresPerfil }`; `estadoPerfilInicial(valores)`; `lerFormularioPerfil(fd)` lê **só** os 11 nomes de texto (`fd.get`) e as duas listas (`fd.getAll('meiosPagamento')`, `fd.getAll('comodidades')`, ignorando arquivos) → `{ entrada, valores }` (eco cortado); `idDoCampo(campo)` → `perfil-<campo>`. Só tipos e constantes de `perfil-tipos.ts`. |
| `FormularioPerfil.tsx` (+ `.test.tsx`) | `'use client'`; um `useActionState`; `<form action noValidate>`. Ajuda `ajudaPublico` no topo. Seções: **Descrição** (`<textarea maxLength={1000}>`, contador "N de 1.000" em `aria-live="polite"` só com JS, `aria-describedby` com a ajuda, o contador e o erro); **Endereço** (`<fieldset><legend>`; logradouro `autoComplete="address-line1"`, número, complemento `address-line2`, bairro, cidade `address-level2`, UF em `<select>` nativo com a opção vazia "—" e as 27 siglas, CEP `inputMode="numeric"` `autoComplete="postal-code"` `maxLength` 9); **Contato** (telefone e WhatsApp `type="tel"` `autoComplete="tel"`, Instagram com prefixo visual "@" e `autoCapitalize="none"`); **Meios de pagamento** e **Comodidades** (`<fieldset>` de caixas com `name` repetido e `value` = chave, rótulos da lista, `aria-describedby` com o erro da lista). Resumo de erros focado; sucesso em `Alert` focável; `mensagem` em `Alert` de erro. Botão "Salvar perfil". |
| `Perfil.module.css` | Só tokens; campos a 100% da largura a 375 px; duas colunas a partir de `48rem` para número/complemento e cidade/UF/CEP. |
| `page.tsx` | `exigirAcessoAoPainel(ROTAS.configuracoesPerfil, ['gestor'], 'salao.configurar')`; negado → `<AcessoNegado />` sem ler dados; `obterPerfil` e `buscarIdentidadeDoPainel` em paralelo; `PanelLayout caminhoAtual={ROTAS.configuracoesPerfil}`; link de volta para `ROTAS.configuracoes`; `h1` "Perfil público". |
| `acoes.ts` | `'use server'`. `salvarPerfilAcao(anterior, fd)`: `nao_autenticado` → `redirect(entrar?proximo=encodeURIComponent(ROTAS.configuracoesPerfil))` fora de `try`; `acesso_negado`/`nao_encontrado` → `mensagem` com os valores digitados; `invalido` → erros com os valores; `salvo` → `revalidatePath(ROTAS.configuracoesPerfil)` e estado com `sucesso` e os valores **normalizados** do servidor. Não importa `@/server/repos`. |

**`/painel/configuracoes/funcionamento/`**

| Arquivo | Conteúdo |
|---|---|
| `estado.ts` | `EstadoFuncionamento = { mensagem; sucesso; erros: ErrosFuncionamento; modo: ModoFuncionamento; valores: ValoresSemana }`; `estadoFuncionamentoInicial(f: Funcionamento)` (`modo` por `definido`); `lerFormularioFuncionamento(fd)` → `{ entrada: { modo, dias }, modo, valores }` (usa `lerSemanaDoFormulario`). Prefixo de ids `funcionamento`. |
| `FormularioFuncionamento.tsx` (+ `.test.tsx`) | `'use client'`; um `useActionState`. `<fieldset><legend>Horário de funcionamento</legend>` com dois `<input type="radio" name="modo">` (`opcaoNaoInformar`, `opcaoInformar`), `defaultChecked` pelo estado. Ajudas `ajudaNaoInformar`, `ajudaHorario` e `ajudaFeriados` (esta com link para `ROTAS.bloqueios`). `ResumoDeErros` (`MENSAGENS_FUNCIONAMENTO.resumoErros`, inclui o erro de `modo` ligado ao primeiro rádio). `CamposDaSemana prefixoId="funcionamento" textoDiaVazio="Fechado"`. As linhas ficam sempre visíveis e habilitadas (funciona sem JS). Botão "Salvar horário". Props: `acao`, `funcionamento` (gravado: alimenta os resumos dos dias). |
| `Funcionamento.module.css` | Só tokens (rádios, avisos). |
| `page.tsx` | Mesma guarda com `ROTAS.configuracoesFuncionamento`; `obterFuncionamento`; `h1` "Horário de funcionamento"; `Alert` informativo `naoInformado` quando `definido: false`; `Alert` de aviso `todosFechados` quando `definido: true` e os 7 dias estão vazios (CA-7); formulário. |
| `acoes.ts` | Igual ao perfil: `salvo` → `revalidatePath(ROTAS.configuracoesFuncionamento)` e estado com `sucesso`, `modo` gravado e `valores = valoresDaSemana(semana canônica)` (ou as linhas vazias com `nao_informar`). |

Depois do sucesso, o `<form>` recebe `key` derivada do estado, para que os campos não controlados renasçam dos valores canônicos com JS (reset automático do React 19 nas ações de formulário). Sem JS, a resposta do POST já renderiza a página com o estado.

### 3.9 Demonstrações (`src/app/dev/perfil/`, `src/app/dev/funcionamento/`)

Como `/dev/configuracoes`: `dynamic = 'force-dynamic'`; `notFound()` sem `vitrineHabilitada(process.env)`; metadados `noindex` só com a vitrine; `PanelLayout papel="gestor"` com `caminhoAtual` igual à rota real; mesmos formulários.
- `/dev/perfil`: perfil de exemplo preenchido ("Studio Exemplo", endereço em SP, `+5511987654321`, `pix`/`dinheiro`, `wifi`). `?vazio=1` mostra o perfil vazio. A ação, `lerFormularioPerfil` → `validarPerfil` → erros ou sucesso (`MENSAGENS_PERFIL.demonstracao`) com `valoresDoPerfil(perfilParaColunas(perfil))`.
- `/dev/funcionamento`: semana de exemplo (segunda a sexta 09:00–19:00, sábado 09:00–14:00, domingo fechado). `?modo=nao-informado` e `?modo=fechado` mostram os dois avisos. A ação, `lerFormularioFuncionamento` → `validarFuncionamento` → erros ou sucesso com a semana canônica (`montarSemana`).
- Sem banco, sessão nem rede. Desligada a vitrine, a ação devolve o estado recebido sem processar nada.

## 4. Dados: **DBA obrigatório**

Migração nova `prisma/migrations/<AAAAMMDDhhmmss>_perfil_funcionamento/migration.sql`, no padrão da D-007 (parte 1 gerada pelo `prisma migrate diff`, sem edição; parte 2 em SQL bruto; cabeçalho com impacto e reversão manual).

**Esquema proposto (`schema.prisma`):**
- `Salao` + `descricao String?`, `enderecoLogradouro String? @map("endereco_logradouro")`, `enderecoNumero`, `enderecoComplemento`, `enderecoBairro`, `enderecoCidade`, `enderecoUf`, `enderecoCep`, `telefoneE164 @map("telefone_e164")`, `whatsappE164 @map("whatsapp_e164")`, `instagram` (todos `String?`), `meiosPagamento String[] @default([]) @map("meios_pagamento")`, `comodidades String[] @default([])`, `funcionamentoDefinido Boolean @default(false) @map("funcionamento_definido")` e a relação `funcionamento SalaoFuncionamento[]`.
- `SalaoFuncionamento` (`salao_funcionamento`): `id uuid` (default `gen_random_uuid()`), `salaoId`, `diaSemana SmallInt`, `inicioMin Int`, `fimMin Int`, `criadoEm Timestamptz(6)` (default `now()`); FK para `salao` com `Restrict`/`Restrict`; `@@index([salaoId, diaSemana])` (sujeito ao parecer).

**SQL bruto (parte 2):**
- `salao_funcionamento_dia_semana_chk CHECK (dia_semana BETWEEN 0 AND 6)`.
- `salao_funcionamento_faixa_chk CHECK (0 <= inicio_min AND inicio_min < fim_min AND fim_min <= 1440)`.
- `salao_funcionamento_sem_sobreposicao EXCLUDE USING gist (salao_id WITH =, dia_semana WITH =, int4range(inicio_min, fim_min) WITH &&)`. `btree_gist` já está instalado; `int4range` é `[)`, então intervalos contíguos não colidem.
- CHECKs de defesa do perfil, **recomendados** (o escritor é um só, mas a E8.2 também vai escrever, e os formatos são definições estáveis, não faixas de produto): `salao_cep_chk` (`endereco_cep ~ '^[0-9]{8}$' AND endereco_cep <> '00000000'`), `salao_uf_chk` (`endereco_uf IN (…27…)`), `salao_telefone_e164_chk` e `salao_whatsapp_e164_chk` (mesma expressão de `cliente_telefone_e164_chk`: `'^\+55[1-9][0-9]{9,10}$'`), `salao_instagram_chk` (`'^[a-z0-9._]{1,30}$'`), `salao_descricao_chk` (`char_length(descricao) BETWEEN 1 AND 1000`, porque o limite da aplicação em UTF-16 é mais estrito que o de code points), `salao_endereco_completo_chk` (`num_nonnulls(logradouro, numero, bairro, cidade, uf, cep) IN (0, 6) AND (complemento IS NULL OR logradouro IS NOT NULL)`), e "nunca `''`" nos textos (`btrim(x) <> ''`, ou embutido nos anteriores). **Listas sem CHECK de valores** (D-8: lista nova = mudança de código, sem migração); no máximo, nenhum elemento `NULL` e `cardinality ≤ 20`.
- `drift.test.ts` passa a conhecer a tabela e as constraints novas.

Invariante "`funcionamento_definido = false` ⇒ zero linhas": garantida pela aplicação (única via de escrita, sob trava) e neutralizada na leitura pelo predicado `AND s.funcionamento_definido` do fragmento único (A-5). **Sem trigger** (proposta; o DBA confirma).

### Transferência para o DBA

```
DEMANDA: D-020 — perfil público e horário de funcionamento do salão (E2.6, issue #75)
DE: arquiteto-software  PARA: dba
OBJETIVO: produzir e revisar a migração aditiva (colunas de perfil e funcionamento_definido em salao; tabela salao_funcionamento) e os testes de catálogo, com parecer em docs/demandas/D-020/dba.md
CONTEXTO NECESSÁRIO: design.md §0 (defaults e escritores atuais de salao; travas FOR NO KEY UPDATE × FOR KEY SHARE; xmin), §3.5 (RepoFuncionamento, fragmento COLUNAS_FUNCIONAMENTO, UPDATE bruto de funcionamento_definido com atualizado_em = now()), §4 (esquema e SQL propostos). salao_funcionamento espelha jornada (migração 20261118000200, linhas 91-108). A gravação é: salao FOR NO KEY UPDATE → SELECT das linhas → DELETE por ids → INSERT (createMany) → UPDATE salao só se o estado mudar.
CRITÉRIOS DE ACEITAÇÃO: CA-3 (faixa e sobreposição no banco), CA-4 (idempotência: nenhuma escrita e xmin igual), CA-6 (salão novo/legado: false, sem linhas, perfil vazio), CA-12 (sem impasse entre perfil, regras, slug e funcionamento), CA-14 (NULL e não '', listas vazias), CA-16 (projeção pública)
DECISÕES JÁ TOMADAS: colunas em salao (sem jsonb nem tabela 1:1); listas text[] NOT NULL DEFAULT '{}' sem CHECK de valores; estado explícito funcionamento_definido boolean NOT NULL DEFAULT false; mesma forma da jornada em minutos de parede; FK Restrict/Restrict; nenhum toque em tenant, reservas ou jornada; leitura em um comando com json_agg.
ARQUIVOS ENVOLVIDOS (posse do DBA, T-0): prisma/schema.prisma; prisma/migrations/<ts>_perfil_funcionamento/migration.sql; tests/integration/db/drift.test.ts; tests/integration/db/perfil-funcionamento.test.ts (novo); docs/demandas/D-020/dba.md. Só leitura: src/server/repos/{salao,funcionamento,publico}.ts (posse do desenvolvedor, T-5).
EVIDÊNCIAS: docs/demandas/D-020/design.md; npx prisma migrate diff; npm run db:generate; npx vitest run --project integration tests/integration/db
PENDÊNCIAS:
  1. CHECKs de defesa do perfil (§4): aprovar, ajustar ou recusar cada um (CEP, UF, E.164 ×2, Instagram, descrição ≤ 1000 em char_length, endereço tudo ou nada com num_nonnulls, textos não vazios) e os da lista (sem NULL, cardinality ≤ 20). Registrar o motivo de cada decisão.
  2. Forma de aplicar os CHECKs em salao: direto ou NOT VALID + VALIDATE CONSTRAINT (as colunas são novas e NULL em todo o legado; avaliar o tempo de ACCESS EXCLUSIVE).
  3. Índice btree (salao_id, dia_semana): manter (paridade com a jornada) ou dispensar, porque a GiST da exclusion já atende WHERE salao_id = $1. Conferir com EXPLAIN nas três leituras (fragmento, listar, DELETE por ids).
  4. Exclusion: confirmar (salao_id =, dia_semana =, int4range &&) com btree_gist, e o nome salao_funcionamento_sem_sobreposicao.
  5. Invariante definido=false ⇒ sem linhas: confirmar "aplicação + predicado na leitura, sem trigger", ou propor outra garantia.
  6. Revisar o fragmento COLUNAS_FUNCIONAMENTO (subconsulta json_agg com ORDER BY e COALESCE '[]'::json) quanto à consistência de snapshot e ao plano.
  7. Confirmar o UPDATE bruto de funcionamento_definido (IS DISTINCT FROM, atualizado_em = now()) e a ausência de ciclo de espera na ordem salao → salao_funcionamento com os INSERT que tomam FOR KEY SHARE (§3.5, ordem canônica).
  8. Testes de banco: 23P01 de sobreposição no mesmo salão e dia; contíguos aceitos; mesmo intervalo em salões distintos aceito; CHECKs de faixa e dia; CHECKs de perfil aprovados (aceita e recusa); defaults num salão inserido só com nome; drift atualizado.
  9. Cabeçalho da migração com impacto (tempo e trava) e reversão manual (DROP TABLE, DROP CONSTRAINT, DROP COLUMN, DELETE em _prisma_migrations), no padrão da D-007.
PRÓXIMA AÇÃO: T-0 (§10). Ao concluir, avisar o líder para liberar T-5; o parecer aprovado em CHECKs muda só os testes de banco, sem alterar as interfaces de §3.
```

## 5. Infraestrutura: DevOps **dispensado**

Nenhuma variável, container, script, dependência ou job novo. A migração é aplicada pelo `migrate deploy` que a app já roda ao iniciar, e o job `testes` da CI já sobe o PostgreSQL. Os E2E novos usam `/dev/perfil` e `/dev/funcionamento`, ligadas pela `VITRINE_COMPONENTES=true` que o `webServer` do Playwright já define, e entram no glob do job `e2e`, que roda sem banco. O smoke do Docker (`docker/smoke.sh`) não muda, e a migração nova é exercitada pela subida do compose nele. Observabilidade: os eventos `salao.perfil_salvo` e `salao.funcionamento_salvo` (§3.6). Gatilho para acionar o DevOps: se o smoke falhar na aplicação da migração dentro da imagem.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como |
|---|---|---|
| Escopo por salão no servidor | Sim | `salao_id` só de `exigirEscopo(ctx)`/`exigirPublico(ctx)`. A casca lê só os nomes conhecidos (`salaoId` forjado é descartado) e a validação ignora chaves extras. Não há id na rota. A leitura sem papel despacha para guardas existentes e recusa `AdminContext`. Testes com dois salões: CA-1, CA-17 e CA-16. |
| Exclusion anti-sobreposição | Indireta | `reserva_sem_sobreposicao` não é tocada, e reservas ficam idênticas (CA-10). Nova exclusion `salao_funcionamento_sem_sobreposicao` como garantia final da forma canônica. |
| UTC + fuso do salão | Sim | O funcionamento é hora de parede em minutos, sem conversão (RN-16, CA-11). A interpretação em instantes é da E3.1 com `src/server/tempo/fuso.ts` (§11). |
| Adaptadores de integração | Não | Nenhuma integração; CEP sem consulta externa (D-9). |
| Soft delete / anonimização | Não | Não toca profissionais, serviços nem clientes. O telefone de contato do salão não é dado de cliente. |
| Somente leitura do salão suspenso | Declarado | As duas ações têm `capacidade: 'configurar'` (CA-13). O efeito é da E6.4. As leituras pública e sem papel não filtram suspensão (RN-18, CA-16). |
| Idempotência de webhooks/mensagens | Não (sem mensagens) | Nenhuma mensagem é enfileirada (CA-10). A gravação do funcionamento é idempotente por construção (CA-4). |
| Auditoria do super admin | Não (aqui) | O super admin não acessa o painel. A E8.2 reutiliza `validarPerfil`, `validarFuncionamento` e os repositórios, com auditoria própria (§11). |

## 7. Decisões

| ID | Decisão |
|---|---|
| D-1..D-15 | **Confirmadas** como na spec. |
| A-1 | Núcleo da semana em `src/server/semana/`; `jornadas/{tipos,validacao,semana}.ts` viram fachadas com a mesma API e os mesmos textos (CA-19). |
| A-2 | Perfil em colunas de `salao`; listas `text[]` validadas na aplicação; CHECKs de formato a critério do DBA (§4). |
| A-3 | Gravação do perfil: um `UPDATE` só com as 13 colunas, sem trava explícita nem comparação prévia (D-13). Serializa com as demais gravações pela trava implícita da linha e não sobrescreve colunas alheias (CA-12). |
| A-4 | Gravação do funcionamento: `salao FOR NO KEY UPDATE` (método novo `RepoFuncionamento.travar`) → listar em comando separado → diferença → `UPDATE` do estado **só se mudou**, com `atualizado_em = now()`. Mudar só a semana não toca a linha de `salao`. |
| A-5 | Toda leitura do funcionamento usa **um único comando** com o fragmento `COLUNAS_FUNCIONAMENTO`, que só agrega linhas quando `funcionamento_definido` é verdadeiro. É a única fonte da semântica "não informado" para a E3.1 e a E4.1. |
| A-6 | `lerFuncionamento(ctx: ContextoEscopado \| PublicoContext)` despacha por `ctx.tipo` para `repos().funcionamento.ler` ou `lerFuncionamentoPublico`. Sem mudança em `src/server/tenant/**`. |
| A-7 | Editor de semana compartilhado em `src/app/painel/_componentes/semana/`, extraído do `FormularioJornada` sem mudar o DOM. Plano B (R-2): se algum teste existente da jornada precisar de mudança de asserção, o `FormularioJornada` fica intacto e só o funcionamento usa o editor compartilhado; a decisão é registrada no `dev.md`. |
| A-8 | Duas ações em dois arquivos (`perfil.acao.ts`, `funcionamento.acao.ts`), ambas `{ papeis: ['gestor'], capacidade: 'configurar' }`. |
| A-9 | Telas sem PRG (estado na resposta, D-017 D-23), com os valores canônicos no estado de sucesso e `key` no formulário. |
| A-10 | Telefone: `src/lib/telefone.ts` com `DDDS_BRASIL` (67) e `normalizarTelefoneBr`. O prefixo `55` sem `+` só é retirado com 12 ou 13 dígitos. A E5.1 importa daqui. |
| A-11 | Instagram por regex e `split` (sem `new URL`); só `instagram.com`/`www.instagram.com`, com exatamente 1 segmento de caminho. |
| A-12 | Modo ausente ou inválido no funcionamento → erro de campo `modo` (não `formulario`), para o gestor ver o que falta sem JS. |
| A-13 | O funcionamento não tem tela de leitura para o profissional (D-15); não há operação nova na matriz. |

## 8. Riscos

| Risco | Mitigação |
|---|---|
| R-1: regressão da jornada pela extração do núcleo | Fachadas com os mesmos nomes. Teste do T-1 compara `MENSAGENS_JORNADA` com uma cópia literal de hoje e `LIMITES_JORNADA` com os valores atuais. Gate: `src/server/jornadas/*.test.ts`, `tests/integration/jornadas/**`, `src/app/dev/jornada/*.test.*` e os E2E `jornada*.spec.ts` verdes **sem mudança de arquivo de teste** (o `git diff --stat` desses caminhos fica vazio). |
| R-2: refatorar o `FormularioJornada` muda o DOM | Rede: `FormularioJornada.test.tsx`, `VisaoJornada.test.tsx`, `tests/integration/jornadas/paginas*.test.ts` e o E2E da jornada sem mudança. Plano B na A-7. |
| R-3: leitura inconsistente (estado × linhas) | Um único comando (A-5). Teste em T-11: um laço de gravações alternando "informar" e "não informar" em paralelo com leituras públicas, que nunca podem ver `{ definido: true }` com 7 dias vazios quando nenhuma gravação usou semana vazia. |
| R-4: perda de atualização entre perfil e regras/slug | Cada `UPDATE` só escreve as próprias colunas; a trava de linha serializa (CA-12, laço ×10). |
| R-5: impasse por trava em `salao` | Ordem canônica (§3.5); `FOR NO KEY UPDATE` não conflita com `FOR KEY SHARE`. T-11: funcionamento × funcionamento, × perfil, × regras, × slug, e × criação de bloqueio do mesmo salão (o bloqueio conclui sem esperar a trava, conferido por `pg_stat_activity`). `timeout` explícito por `it`. |
| R-6: idempotência quebrada (xmin ou atualizado_em mudam) | `definirEstado` com `IS DISTINCT FROM` e só chamado quando o estado muda; listas vazias pulam comandos. CA-4/CA-8 conferem `xmin`, `atualizado_em` e ids. |
| R-7: ambiguidades do telefone | Regras fechadas em §3.2, com testes de tabela (todos os casos do CA-2, DDD 55 com 10 e 11 dígitos, `55` + 10/11 dígitos, `+` no meio, `++55`, 0800, 4004, 31 caracteres). |
| R-8: vazamento na leitura pública | `select`/SQL com colunas explícitas; teste do conjunto exato de chaves (CA-16), inclusive com `suspenso_manual_em` preenchido. |
| R-9: dado pessoal em log | Logs só com ids e contagens (§3.6); teste do serviço captura `console.info` e confere que o telefone e o CEP não aparecem. |
| R-10: divergência entre CHECK e validação | Teste do DBA com os mesmos casos-limite (1.000 caracteres, CEP `00000000`, DDD sem 9). Limite da aplicação mais estrito que o do banco onde as contagens diferem (UTF-16 × code points). |
| R-11: E3.1 (D-018) desenhada antes do funcionamento | Obrigação registrada (§11): usar `lerFuncionamento` ou o fragmento `COLUNAS_FUNCIONAMENTO`, nunca uma leitura própria das linhas. |
| R-12: valores antigos nos campos depois de salvar com JS | Estado de sucesso com os valores canônicos e `key` no `<form>` (A-9); teste jsdom e E2E conferem os campos depois do sucesso. |
| R-13: rolagem horizontal a 375 px (endereço, rádios longos) | CSS a 100% de largura; E2E confere `scrollWidth <= clientWidth` nas telas inicial, com erro e com sucesso. |
| R-14: cobertura de `.tsx` e cascas | jsdom (T-7, T-8, T-9), `renderToStaticMarkup` (T-10) e unitários das demonstrações (T-12), sem exclusões. |

## 9. Estratégia de testes

| Camada | O quê |
|---|---|
| Unitário (`node`) | `src/server/semana/validacao.test.ts` e `montagem.test.ts`: os casos da jornada reaplicados a `validarDias` (CA-3: sobreposição, 09:07, 22:00–02:00, fim = início, início 24:00, 7 intervalos, contíguos unidos, 22:00–24:00, forma inválida, mais de 20 linhas → `formulario`). `src/server/jornadas/*.test.ts` **sem mudança** (CA-19), mais um teste novo no T-1 que compara as mensagens. `src/lib/telefone.test.ts` (CA-2 telefone, CA-18: DDDs, regras do 3º dígito, prefixos). `src/lib/format.test.ts` (CA-18: `formatarTelefone`, `formatarCep` e os `RangeError`). `src/config/navegacao.test.ts` (CA-20: rotas novas, `itemAtivo` em `/painel/configuracoes/perfil` → `configuracoes`, `SEGMENTOS_RESERVADOS` igual ao conjunto atual). `src/server/salao/perfil-validacao.test.ts` (CA-2 completo, CA-14 vazio → `null`, CA-15 `filtrarChaves`, tipos errados, 10.000 caracteres, 500 itens, sem lançar). `src/server/salao/funcionamento-validacao.test.ts` (modos, `nao_informar` com `dias` inválido aceito, `modo` ausente → erro de campo). `src/app/painel/_componentes/semana/formulario.test.ts`. `src/server/repos/index.test.ts` (`funcionamento.*` e `saloes.obterPerfil`/`atualizarPerfil` com contexto inválido lançam antes de consultar). `src/app/dev/{perfil,funcionamento}/*.test.ts(x)` (404 sem vitrine, ramos das ações). |
| Unitário (`jsdom`) | `CamposDaSemana.test.tsx`; `FormularioPerfil.test.tsx` (rótulos, `maxLength` 1000, contador, UF `<select>`, `type="tel"`, `inputMode`, caixas marcadas preservadas no erro, `aria-describedby`/`aria-invalid`, resumo focado, sucesso focado, campos com os valores normalizados depois do sucesso); `FormularioFuncionamento.test.tsx` (rádios e padrão por `definido`, "Fechado", erros por dia e intervalo, erro de `modo`, link para bloqueios). `FormularioJornada.test.tsx` e `VisaoJornada.test.tsx` **sem mudança**. |
| Integração (PostgreSQL real) | `tests/integration/db/perfil-funcionamento.test.ts` (DBA). `tests/integration/salao/repos-perfil-funcionamento.test.ts` (T-5: escopo, `atualizarPerfil` não toca nome/fuso/regras, `definirEstado` só escreve quando muda, fragmento com `definido` false e linhas plantadas → `[]`, `lerPerfilPublico` com chave desconhecida, endereço parcial plantado → `null`, `AdminContext` → Error). `perfil.test.ts` (T-6: CA-1 perfil, CA-2 amostra e vários erros, CA-14, CA-15, CA-13 metadados, salão inexistente → 404, log sem dados pessoais). `funcionamento.test.ts` (T-6: CA-1 funcionamento, CA-3, CA-4 sequencial, CA-6 com fábrica e com `cadastrar` da D-011, CA-7, CA-8, CA-9, CA-10, CA-11). `leituras.test.ts` (T-6: CA-16 conjunto de chaves e suspenso, CA-17 sistema/público/tenant, S1 × S2). `concorrencia-perfil-funcionamento.test.ts` (T-11: CA-4 paralelo ×10, CA-12 a/b/c e perfil × perfil ×10, R-3, R-5). `paginas-perfil-funcionamento.test.ts` (T-10: CA-1 páginas, profissional "Acesso negado" sem dados, gestor com perfil de profissional, sem sessão → `/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Fperfil` e `…funcionamento`, CA-6 "Não informar" marcado, CA-7 "Fechado" ×7 e aviso, CA-11 `09:00`, CA-15 duas caixas marcadas e `cheque` ignorado, CA-20 links e item ativo; cascas: `invalido` com valores, `salaoId` extra descartado, sucesso com `revalidatePath`). `tests/integration/tenant/registro.test.ts` e `tests/integration/jornadas/**` verdes sem mudança. |
| E2E (Playwright 375×812, sem banco) | `e2e/perfil.spec.ts` e `e2e/funcionamento.spec.ts` (CA-5, só teclado): Tab/Shift+Tab, Espaço nas caixas e nos rádios, Enter para enviar, erro com resumo focado e link que leva ao campo, correção e sucesso focado, foco visível, axe 4.14.0 sem violações (inicial, erro e sucesso, mais `?vazio=1` e `?modo=nao-informado`/`fechado`), sem rolagem horizontal. `e2e/perfil-sem-js.spec.ts` e `e2e/funcionamento-sem-js.spec.ts` (`javaScriptEnabled: false`): erros do servidor com valores e caixas preservados, sucesso, e 6 intervalos num dia aceitos. Os E2E existentes (`jornada*.spec.ts` incluídos) verdes sem mudança. |
| Manual | T-13 (dev) e T-14 (tester), com Docker e a página real: gestor e profissional, com e sem JS, 375 px, só teclado; consulta direta a `salao` e `salao_funcionamento` depois de cada gravação. |

**Cobertura ≥ 90%:** todo arquivo novo de `src/` tem teste direto; as fachadas da jornada são cobertas pelos testes existentes; páginas e cascas via `renderToStaticMarkup`; demonstrações via unitário. Medição na T-13 com `npm run test:coverage`. Abaixo do limiar, a tarefa dona do arquivo completa os testes.

Comando de estabilidade (registrar no `dev.md` e sugerir para o `CLAUDE.md`):
```
for i in $(seq 10); do npx vitest run --project integration tests/integration/salao/concorrencia-perfil-funcionamento.test.ts || break; done
```

## 10. Tarefas

DBA obrigatório (T-0). DevOps dispensado (§5). Implementação: `desenvolvedor`.

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-0 | dba | — | T-1, T-2 | `prisma/schema.prisma`, `prisma/migrations/<ts>_perfil_funcionamento/migration.sql`, `tests/integration/db/drift.test.ts`, `tests/integration/db/perfil-funcionamento.test.ts`, `docs/demandas/D-020/dba.md` |
| T-1 | desenvolvedor | — | T-0, T-2 | `src/server/semana/{tipos,validacao,validacao.test,montagem,montagem.test}.ts`, `src/server/jornadas/{tipos,validacao,semana}.ts`, `src/server/jornadas/fachada.test.ts` (novo) |
| T-2 | desenvolvedor | — | T-0, T-1 | `src/lib/telefone.ts`, `src/lib/telefone.test.ts`, `src/lib/format.ts`, `src/lib/format.test.ts`, `src/config/navegacao.ts`, `src/config/navegacao.test.ts` |
| T-3 | desenvolvedor | T-2 | T-4, T-7 | `src/server/salao/perfil-tipos.ts`, `src/server/salao/perfil-validacao.ts`, `src/server/salao/perfil-validacao.test.ts` |
| T-4 | desenvolvedor | T-1 | T-3, T-7 | `src/server/salao/funcionamento-tipos.ts`, `src/server/salao/funcionamento-validacao.ts`, `src/server/salao/funcionamento-validacao.test.ts` |
| T-5 | desenvolvedor | T-0, T-1, T-3 | T-7, T-8, T-9 | `src/server/repos/funcionamento.ts`, `src/server/repos/salao.ts`, `src/server/repos/publico.ts`, `src/server/repos/index.ts`, `src/server/repos/tipos.ts`, `src/server/repos/index.test.ts`, `src/server/repos/servico.ts` (só comentário), `src/server/repos/jornada.ts` (só comentário), `tests/integration/salao/repos-perfil-funcionamento.test.ts` |
| T-6 | desenvolvedor | T-4, T-5 | T-8, T-9, T-12 | `src/server/salao/{perfil,funcionamento,funcionamento-leitura}.ts`, `src/server/salao/perfil.acao.ts`, `src/server/salao/funcionamento.acao.ts`, `tests/integration/salao/apoio-perfil.ts`, `tests/integration/salao/{perfil,funcionamento,leituras}.test.ts` |
| T-7 | desenvolvedor | T-1 | T-3, T-4, T-5 | `src/app/painel/_componentes/semana/**`, `src/app/painel/profissionais/[id]/jornada/{FormularioJornada.tsx,estado.ts,Jornada.module.css}` |
| T-8 | desenvolvedor | T-2, T-3 | T-5, T-6, T-9 | `src/app/painel/configuracoes/perfil/{estado.ts,FormularioPerfil.tsx,FormularioPerfil.test.tsx,Perfil.module.css}` |
| T-9 | desenvolvedor | T-4, T-7 | T-5, T-6, T-8 | `src/app/painel/configuracoes/funcionamento/{estado.ts,FormularioFuncionamento.tsx,FormularioFuncionamento.test.tsx,Funcionamento.module.css}` |
| T-10 | desenvolvedor | T-6, T-8, T-9 | T-11, T-12 | `src/app/painel/configuracoes/perfil/{page.tsx,acoes.ts}`, `src/app/painel/configuracoes/funcionamento/{page.tsx,acoes.ts}`, `src/app/painel/configuracoes/page.tsx`, `src/app/painel/configuracoes/Configuracoes.module.css`, `tests/integration/salao/paginas-perfil-funcionamento.test.ts` |
| T-11 | desenvolvedor | T-6 | T-10, T-12 | `tests/integration/salao/concorrencia-perfil-funcionamento.test.ts` |
| T-12 | desenvolvedor | T-3, T-4, T-8, T-9 | T-6, T-10, T-11 | `src/app/dev/perfil/**`, `src/app/dev/funcionamento/**`, `e2e/perfil.spec.ts`, `e2e/perfil-sem-js.spec.ts`, `e2e/funcionamento.spec.ts`, `e2e/funcionamento-sem-js.spec.ts` |
| T-13 | desenvolvedor | T-0..T-12 | — | `README.md`, `docs/demandas/D-020/dev.md` |
| T-14 | tester | T-13 | — | `docs/demandas/D-020/testes.md` |

Rodadas (sem arquivo em comum):
- **Rodada 1:** T-0 (dba) ‖ T-1 ‖ T-2.
- **Rodada 2:** T-3 ‖ T-4 ‖ T-7.
- **Rodada 3:** T-5 (depois de T-0) ‖ T-8 ‖ T-9.
- **Rodada 4:** T-6 ‖ T-12.
- **Rodada 5:** T-10 ‖ T-11.
- **Rodada 6:** T-13. **Rodada 7:** T-14.

Regras de posse:
- Um defeito num arquivo reabre a tarefa dona. Entre tarefas, só leitura. T-5 lê o cliente gerado pela T-0 (`npm run db:generate`). T-6/T-10/T-11 importam `tests/integration/salao/apoio-perfil.ts` (T-6) e podem importar, sem editar, `tests/integration/salao/apoio.ts` (D-017) e `tests/integration/bloqueios/apoio.ts` (`criarReservaEm`, `inserirBloqueio`, `definirFuso`). T-8/T-9/T-10/T-12 importam os componentes das T-7/T-8/T-9.
- `perfil-tipos.ts`, `funcionamento-tipos.ts`, `src/server/semana/tipos.ts` e os `estado.ts` só importam tipos e constantes client-safe.
- Ninguém edita `src/server/tenant/**`, `src/server/auth/**`, `src/components/**`, `tests/support/**`, `tests/integration/{tenant,auth,jornadas,bloqueios,profissionais,servicos}/**`, os arquivos D-017 de `tests/integration/salao/` (`apoio.ts`, `concorrencia.test.ts`, `configuracoes.test.ts`, `paginas.test.ts`, `regressao-tester.test.ts`, `repos.test.ts`, `slug-historico.test.ts`), nenhum `*.test.*` existente da jornada, `src/app/painel/profissionais/[id]/jornada/{page.tsx,acoes.ts,VisaoJornada.tsx}`, `src/app/dev/{componentes,jornada,bloqueios,configuracoes}/**`, `e2e/suporte/**`, os specs E2E existentes, `eslint.config.mjs`, `vitest.config.ts` nem `playwright.config.ts`. O `CLAUDE.md` é do líder.

**T-0 — Migração (dba).** Entregável: §4 e as pendências 1–9 da transferência; `dba.md` com o parecer. Conclusão: `npx prisma migrate diff` da parte 1 sem edição; `npm run db:generate`, `npm run typecheck` e `npx vitest run --project integration tests/integration/db` verdes; uma base limpa aplica as 5 migrações; `docker compose up -d --build --wait` aplica a migração na app.

**T-1 — Núcleo da semana.** Entregável: §3.1 com as fachadas. Conclusão: `npx vitest run src/server/semana src/server/jornadas src/app/dev/jornada src/app/painel/profissionais` verde **sem alteração de arquivo de teste existente**; `fachada.test.ts` compara `MENSAGENS_JORNADA` e `LIMITES_JORNADA` com cópias literais dos valores de hoje; `src/server/semana/**` sem import de runtime de `@/server/**` fora da própria pasta; lint e typecheck verdes.

**T-2 — Telefone, formatadores e rotas.** Entregável: §3.2; `ROTAS.configuracoesPerfil`, `configuracoesFuncionamento`, `devPerfil` e `devFuncionamento`. Conclusão: `npm run test:unit -- src/lib src/config` verde, inclusive `format.fonte-unica.test.ts` sem mudança; `telefone.ts` puro; lint e typecheck verdes.

**T-3 — Perfil puro.** Entregável: §3.3. Conclusão: `npx vitest run src/server/salao/perfil-validacao.test.ts` verde com todos os casos do CA-2, CA-14 e CA-15 (unidade) e as entradas inválidas da spec §6; `perfil-tipos.ts` sem import de runtime de `@/server/**`; lint e typecheck verdes.

**T-4 — Funcionamento puro.** Entregável: §3.4. Conclusão: unitários verdes (CA-3 via `validarDias`, modos e erro de `modo`); `MENSAGENS_FUNCIONAMENTO` contém as chaves de `MENSAGENS_INTERVALO` com os mesmos textos (teste); lint e typecheck verdes.

**T-5 — Repositórios.** Entregável: §3.5 (cabeçalho de `funcionamento.ts` com a ordem de travas, o marcador `FOR NO KEY UPDATE` e a nota do comando separado; comentário de ordem atualizado em `servico.ts` e `jornada.ts`). Conclusão: `repos-perfil-funcionamento.test.ts` e `index.test.ts` verdes; `tests/integration/salao/repos.test.ts` e `tests/integration/tenant/**` verdes sem mudança; nenhum `import` de Prisma fora de `src/server/repos/**`; lint e typecheck verdes.

**T-6 — Serviços, leitura e ações.** Entregável: §3.6; `apoio-perfil.ts` (credenciais de gestor, profissional, gestor que atende e super admin; `linhaSalao(id)` com `to_jsonb`, `xmin::text` e `atualizado_em`; `funcionamentoDe(salaoId)` com ids; fotografias de `reserva`, `reserva_item`, `jornada`, `bloqueio` e `mensagem`). Testes pela ação (`acao.executar(credencial, entrada)`). Conclusão: `npx vitest run --project integration tests/integration/salao/perfil.test.ts tests/integration/salao/funcionamento.test.ts tests/integration/salao/leituras.test.ts` verde; `registro.test.ts` verde com as duas ações novas; nenhum `next/*` em `src/server/salao/**`; lint e typecheck verdes.

**T-7 — Editor de semana compartilhado.** Entregável: §3.7, com o `FormularioJornada` e o `estado.ts` da jornada usando o editor. Conclusão: `npx vitest run src/app/painel/_componentes src/app/painel/profissionais src/app/dev/jornada` verde; `tests/integration/jornadas/**` verde; `npx playwright test e2e/jornada.spec.ts e2e/jornada-sem-js.spec.ts` verde; **nenhum arquivo de teste da jornada alterado** (senão, plano B da A-7, registrado); lint e typecheck verdes.

**T-8 — Formulário do perfil.** Entregável: §3.8 (perfil, sem `page`/`acoes`). Conclusão: `npx vitest run src/app/painel/configuracoes/perfil` verde; todo `*.test.tsx` começa com `/** @vitest-environment jsdom */`; CSS só com `var(--…)` e `48rem`; lint e typecheck verdes.

**T-9 — Formulário do funcionamento.** Entregável: §3.8 (funcionamento, sem `page`/`acoes`). Conclusão: igual à T-8, para `src/app/painel/configuracoes/funcionamento`.

**T-10 — Páginas e cascas.** Entregável: §3.8 (`page.tsx`, `acoes.ts`, links em `/painel/configuracoes`) e `paginas-perfil-funcionamento.test.ts`. Conclusão: esse teste e `tests/integration/salao/paginas.test.ts` (sem mudança) verdes; `npm run build` lista as duas rotas; `redirect` fora de `try`; as cascas não importam `@/server/repos`; lint e typecheck verdes.

**T-11 — Concorrência.** Entregável: CA-4 paralelo, CA-12, R-3 e R-5. Conclusão: o laço ×10 da §9 verde; `timeout` explícito em cada `it`; nenhum `deadlock detected`, 23P01 ou exceção não mapeada; conexões `pg` fechadas no `afterAll`.

**T-12 — Demonstrações e E2E.** Entregável: §3.9 e os quatro specs. Conclusão: `npm run test:e2e` verde (os existentes sem mudança); axe sem violações nos estados da §9; `/dev/perfil` e `/dev/funcionamento` dão 404 sem a variável; unitários das páginas e ações verdes; lint e typecheck verdes.

**T-13 — Documentação e gates.** Entregável: seção "Perfil público e funcionamento" no README (campos, formatos aceitos, listas, "não informar" × "fechado", efeito só a partir da E3.1, feriados pelo bloqueio); `dev.md` com a evidência dos gates, a cobertura, o laço ×10, o `git diff --stat` dos testes da jornada (vazio) e o passo manual; texto sugerido para o `CLAUDE.md` (D-020: `src/server/semana/`, `src/lib/telefone.ts`, `RepoFuncionamento` e `COLUNAS_FUNCIONAMENTO`, `lerFuncionamento`, `lerPerfilPublico`, ordem de travas com `salao` no topo, vitrines e os comandos novos). Conclusão: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:coverage` (≥ 90%), `npm run test:e2e` e `sh docker/smoke.sh` verdes; laço da T-11 ×10 verde.

**T-14 — Validação independente (tester).** Entregável: `testes.md` com o veredito. Escopo: repetir os gates e o laço; conferir o mapa abaixo; POST forjado com `salaoId` de outro salão, com chave de lista desconhecida e com `modo` ausente; conferir que os testes da jornada não mudaram; prova manual com Docker na página real.

### Mapa CA → tarefa → tipo de teste

| CA | Tarefa(s) | Tipo | Arquivo(s) |
|---|---|---|---|
| CA-1 | T-5, T-6, T-10 | Integração (dois salões) | `repos-perfil-funcionamento.test.ts`, `perfil.test.ts`, `funcionamento.test.ts`, `paginas-perfil-funcionamento.test.ts` |
| CA-2 | T-2, T-3, T-6 | Unitário (todos) + integração (amostra) | `telefone.test.ts`, `perfil-validacao.test.ts`, `perfil.test.ts` |
| CA-3 | T-0, T-1, T-4, T-6 | Unitário + integração + banco | `semana/validacao.test.ts`, `funcionamento-validacao.test.ts`, `funcionamento.test.ts`, `db/perfil-funcionamento.test.ts` |
| CA-4 | T-6, T-11 | Integração (sequencial + ×10 paralelo) | `funcionamento.test.ts`, `concorrencia-perfil-funcionamento.test.ts` |
| CA-5 | T-7, T-8, T-9, T-12, T-14 | jsdom + E2E + manual | `CamposDaSemana.test.tsx`, `Formulario*.test.tsx`, `e2e/{perfil,funcionamento}*.spec.ts`, `testes.md` |
| CA-6 | T-0, T-6, T-10 | Banco + integração | `db/perfil-funcionamento.test.ts`, `funcionamento.test.ts`, `leituras.test.ts`, `paginas-perfil-funcionamento.test.ts` |
| CA-7 | T-6, T-10 | Integração | `funcionamento.test.ts`, `paginas-perfil-funcionamento.test.ts` |
| CA-8 | T-4, T-6 | Unitário + integração | `funcionamento-validacao.test.ts`, `funcionamento.test.ts` |
| CA-9 | T-6 | Integração | `funcionamento.test.ts` |
| CA-10 | T-6 | Integração | `funcionamento.test.ts` |
| CA-11 | T-6, T-10 | Integração | `funcionamento.test.ts`, `paginas-perfil-funcionamento.test.ts` |
| CA-12 | T-11 | Integração (×10) | `concorrencia-perfil-funcionamento.test.ts` |
| CA-13 | T-6, T-10 | Registro + integração | `perfil.test.ts`, `funcionamento.test.ts`, `tenant/registro.test.ts`, `paginas-perfil-funcionamento.test.ts` |
| CA-14 | T-3, T-5, T-6 | Unitário + integração | `perfil-validacao.test.ts`, `repos-perfil-funcionamento.test.ts`, `perfil.test.ts` |
| CA-15 | T-3, T-5, T-6, T-8, T-10 | Unitário + jsdom + integração | `perfil-validacao.test.ts`, `FormularioPerfil.test.tsx`, `repos-perfil-funcionamento.test.ts`, `perfil.test.ts`, `paginas-perfil-funcionamento.test.ts` |
| CA-16 | T-5, T-6 | Integração | `repos-perfil-funcionamento.test.ts`, `leituras.test.ts` |
| CA-17 | T-5, T-6 | Integração | `repos-perfil-funcionamento.test.ts`, `leituras.test.ts` |
| CA-18 | T-2 | Unitário | `telefone.test.ts`, `format.test.ts`, `format.fonte-unica.test.ts` |
| CA-19 | T-1, T-7, T-14 | Unitário + integração + E2E (existentes, sem mudança) | `src/server/jornadas/*.test.ts`, `tests/integration/jornadas/**`, `e2e/jornada*.spec.ts`, `fachada.test.ts` |
| CA-20 | T-2, T-10 | Unitário + integração | `navegacao.test.ts`, `paginas-perfil-funcionamento.test.ts` |

## 11. Obrigações registradas para as próximas demandas

- **E3.1 (#27, D-018 em revisão):** obter o funcionamento só por `lerFuncionamento(ctx)` ou, numa consulta em lote do repositório de disponibilidade, pelo fragmento `COLUNAS_FUNCIONAMENTO` (nunca uma leitura própria de `salao_funcionamento`). `definido: false` → não limita. `definido: true` → intersectar com a jornada por dia, com dia vazio = sem horários. Os minutos são hora de parede no `salao.fuso`, convertidos com `src/server/tempo/fuso.ts` como a jornada. Se a E3.1 criar o `ContextoDeLeituraDeAgenda`, pode trocar a assinatura de `lerFuncionamento` para ele, sem mudar o comportamento.
- **E3.2/E3.4 (#34, #35):** revalidar o funcionamento no servidor com `lerFuncionamento`, **sem** travar `salao` com `FOR SHARE` (conflitaria com as gravações de configuração). A corrida "reserva × troca de funcionamento" é aceita: o funcionamento não altera reservas existentes (RN-15). O encaixe fora do funcionamento segue com aviso (E3.4).
- **E3.3 (#20):** faixa de fundo da agenda com `lerFuncionamento`; aviso de jornada fora do funcionamento (D-12).
- **E4.1 (#37):** `lerPerfilPublico(ctx)` é a única leitura do perfil. Exibir a descrição como texto (quebras preservadas, sem HTML), o telefone e o CEP por `formatarTelefone`/`formatarCep`, o Instagram como `https://www.instagram.com/<perfil>/`, os rótulos das listas por `MEIOS_PAGAMENTO`/`COMODIDADES`, e omitir as seções vazias e o horário quando `funcionamento === null`.
- **E5.1:** normalizar o telefone da cliente com `normalizarTelefoneBr`/`DDDS_BRASIL` de `src/lib/telefone.ts`, sem duplicar a lista; se a regra precisar mudar, mudar aqui com os testes.
- **E6.4 (#41):** as duas ações já declaram `configurar`; as páginas devem mostrar o estado somente leitura.
- **E8.2 (#52):** reutilizar `validarPerfil`, `validarFuncionamento`, `RepoSalao.atualizarPerfil` e `RepoFuncionamento` dentro de `emTransacao` com o contexto do salão alvo, com a auditoria (valores antigos e novos) na mesma transação.
