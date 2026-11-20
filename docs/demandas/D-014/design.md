# D-014 — Desenho: gerenciar serviços e definir quais profissionais executam cada um (issue #25, E2.1)

Entradas: `docs/demandas/D-014/spec.md` (RN-1..RN-13, CA-1..CA-15, D-1..D-13), `issue-25.md`, `CLAUDE.md`, `docs/demandas/D-013/design.md` (padrões reaproveitados) e o código em `src/server/repos/{servico,publico,profissional,ids,transacao,index}.ts`, `src/server/profissionais/`, `src/app/painel/profissionais/`, `src/lib/{format,texto}.ts`, `src/config/navegacao.ts`, `src/components/ui/{Field,Checkbox}.tsx`, `prisma/schema.prisma` e `tests/support/`.

## 0. Verificações feitas antes do desenho

- **O núcleo não muda.** `defineAcao` já entrega `{ agora }` ao handler (D-013 D-15), e `exigirAcessoAoPainel(caminho, papeis, operacao)` já aceita a operação. A operação `'servico.gerir'` já existe na matriz (`permissoes.ts:43`): `salao` para o gestor e `negado` para os demais. O registro `tests/integration/tenant/registro.test.ts` faz `import.meta.glob('/src/**/*.acao.ts')`, então enxerga o novo `servicos.acao.ts` sem nenhuma mudança.
- **Isolamento dos vínculos no banco:** `servico_profissional` tem FKs compostas `(salao_id, servico_id)` e `(salao_id, profissional_id)`. Um vínculo entre salões é impossível no banco. Mesmo assim, a aplicação recusa antes, com um erro de campo (RN-4); a FK é só a segunda barreira, e um 23503 seria 5xx.
- **Travas implícitas:** um INSERT em `servico_profissional` toma `FOR KEY SHARE` nas linhas referenciadas de `servico` e de `profissional`. Um `UPDATE servico SET nome/preco/duracao/ativo` (colunas que não são chave) toma `FOR NO KEY UPDATE`, que **não** conflita com `FOR KEY SHARE`. A desativação de profissional da D-013 toma `FOR UPDATE` na linha do profissional, e esse modo conflita com `FOR KEY SHARE` e com `FOR SHARE`.
- **READ COMMITTED + `FOR SHARE`:** se a linha travada foi alterada e confirmada por outra transação durante a espera, o PostgreSQL reavalia o `WHERE` sobre a versão nova (EvalPlanQual). Assim, `... AND ativo FOR SHARE` sobre um profissional que acabou de ser desativado **não devolve a linha**. Isso garante que um vínculo novo nunca nasce para um profissional cuja desativação foi confirmada antes da trava (§3.2).
- A fábrica vincula os dois serviços ativos ao profissional ativo **e** ao perfil do gestor. O serviço inativo fica vinculado só ao profissional inativo. Com a RN-7, `tests/integration/tenant/publico.test.ts` continua passando sem mudança: os dois serviços ativos têm profissional ativo.
- `criarSalaoCompleto({ servicos: { ativos: [{ precoCentavos: 8000 }] } })` cria o serviço a R$ 80,00 e a reserva com item de snapshot de 8000. Isso basta para o CA-2, sem mexer em `tests/support/**`.
- `Field` repassa `inputMode` e os demais atributos (`...resto`). `Checkbox` aceita `rotulo`, `name`, `value` e `defaultChecked`. Não há componente `fieldset`; ele é escrito na própria tela.
- `src/lib/format.fonte-unica.test.ts` proíbe `toLocale*`/`Intl.NumberFormat` fora de `format.ts`. O parser de preço (texto → centavos) não formata nada para exibição e fica na validação do servidor. Já o valor do campo de preço na edição ("80,00") é formatação de exibição e vai para `format.ts` (§3.4).
- `repos().servicos.listar` e `renomear` são usados por testes existentes (`cadastro-paginas`, `define-acao`, `transacao`, `index.test.ts`) e **ficam como estão**.

## 1. Resumo da solução

1. **Repositório** `src/server/repos/servico.ts`: métodos novos para criar, travar, atualizar, ativar/desativar, listar e buscar para o painel (com a contagem de profissionais ativos), listar os profissionais para vínculo, travar os profissionais elegíveis (`FOR SHARE`) e substituir o conjunto de vínculos com ativos (DELETE + `INSERT … ON CONFLICT DO NOTHING`). `src/server/repos/publico.ts#listarServicosPublicos` passa a exigir um vínculo com profissional ativo (RN-7).
2. **Validação pura** `src/server/servicos/validacao.ts`: nome, preço pt-BR → centavos (texto e inteiros), duração e a lista de ids de profissionais (formato, deduplicação e teto).
3. **Serviço de domínio** `src/server/servicos/servico.ts`: compõe as transações na ordem canônica de travas (§3.2) e devolve resultados discriminados (`salvo | invalido`, `desativado | reativado`), no padrão D-14 da D-013.
4. **Ações** `src/server/servicos/servicos.acao.ts`: `criarServico`, `editarServico`, `desativarServico` e `reativarServico`, todas `defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })`.
5. **Telas** em `src/app/painel/servicos/`: lista, `novo` e `[id]` (dados + vínculos + situação), com a casca `acoes.ts` (`'use server'`). Os quatro formulários usam `<form action>` e funcionam sem JS.
6. **Formatação:** `formatarDuracao` e `formatarMoedaSemSimbolo` em `src/lib/format.ts`. **Rotas:** `ROTAS.novoServico` e `ROTAS.servico(id)`.

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| CHECKs no banco (`duracao_min % 5 = 0`, `duracao_min <= 720`, `preco_centavos <= 9999999`) | Há um único caminho de escrita (este serviço, validado), e os tetos são suposições não bloqueantes da spec (D-2, D-3) que podem mudar: no banco, cada ajuste viraria migração. A proteção contra estouro de `int4` em somas (E3.1) é de quem soma: `SUM(int4)` no PostgreSQL já devolve `bigint`, e em JS os valores cabem em `Number` com folga. O mesmo critério da D-013 §4 (c). Fica como pendência opcional (§10). |
| Vínculos por "diferença" enviada pelo cliente (adicionar/remover) | O formulário sem JS só envia as caixas marcadas. O conjunto final é o contrato natural, e a substituição sob a trava do serviço é determinística (CA-15). |
| Substituir **todos** os vínculos pelo conjunto enviado | Apagaria os vínculos com profissionais inativos, que a RN-9/RN-10 manda preservar. |
| Trava `FOR UPDATE` na linha do serviço | Também esperaria os `FOR KEY SHARE` de inserções de `reserva_item` e de vínculos de outras transações, sem ganho: a serialização entre editores e com a E3.2 (`FOR SHARE`) já vem do `FOR NO KEY UPDATE`. |
| Travar o serviço antes dos profissionais | Com a E3.2 travando profissional → serviço (ordem natural da reserva: profissional escolhido, depois os serviços), a ordem inversa permite um ciclo de espera entre uma edição, uma reserva e uma desativação de profissional na fila de travas da linha (§3.2). A ordem canônica única é **profissional → serviço**. |
| Capturar violação de PK (P2002) na corrida de vínculos | Abortaria a transação (5xx). `ON CONFLICT DO NOTHING` não aborta. Na prática, a trava do serviço já serializa os editores. |
| Repositório separado `repos/vinculo.ts` | O vínculo só é manipulado pela tela do serviço (D-6). Ele fica no `RepoServico`, e `repos/index.ts` não muda. |
| Desativar com `ConfirmDialog` (como a D-013) | A spec D-9: a ação é reversível e sem efeito em reservas. Um formulário POST simples funciona sem JS (corrige a OBS-2 da D-013 neste módulo). |
| E2E Playwright | O job `e2e` roda sem PostgreSQL e não há seed (E9.2). Valem os testes jsdom, os de página com `renderToStaticMarkup` e o passo manual com e sem JS (D-12 mantida). |
| `type="number"` no preço | Usa ponto e float no navegador. O campo é texto com `inputMode="decimal"` (D-1). |

### 1.2 Dependências novas

Nenhuma. O desenho usa `zod` (já presente), `next/cache`, `next/navigation` e os componentes de `src/components/ui/`.

## 2. Componentes afetados

| Caminho | Mudança |
|---|---|
| `src/config/navegacao.ts` (+ `.test.ts`) | `ROTAS.novoServico = '/painel/servicos/novo'`, `ROTAS.servico(id) = '/painel/servicos/${seg(id)}'` |
| `src/lib/format.ts` (+ `format.test.ts`) | `formatarDuracao(min)` e `formatarMoedaSemSimbolo(centavos)` (§3.4) |
| `src/server/repos/tipos.ts` | `DadosServico`, `ServicoPainelDTO`, `ProfissionalVinculoDTO` |
| `src/server/repos/servico.ts` | métodos novos (§3.2) e cabeçalho com a ordem de travas |
| `src/server/repos/publico.ts` | `listarServicosPublicos` com RN-7 |
| `src/server/repos/index.test.ts` | métodos novos nos casos "ID malformado" e "contexto inválido" |
| `src/server/servicos/tipos.ts` (novo) | contratos, limites, mensagens (sem import de servidor de runtime) |
| `src/server/servicos/validacao.ts` (+ `.test.ts`) (novo) | validação pura e parser de preço |
| `src/server/servicos/servico.ts` (novo) | regras RN-1..RN-13 |
| `src/server/servicos/servicos.acao.ts` (novo) | 4 ações |
| `src/app/painel/servicos/**` (novo) | páginas, componentes, casca |
| `README.md` | seção curta "Serviços" |

Nada muda em `prisma/**`, `.env.example`, `docker-compose.yml`, `.github/**`, `src/proxy.ts`, `src/server/auth/**`, `src/server/tenant/**`, `src/components/**`, `eslint.config.mjs`, `vitest.config.ts` nem `tests/support/**`.

## 3. Interfaces

### 3.1 Contratos de domínio (`src/server/servicos/tipos.ts`)

Sem imports de runtime de `@/server/**`: o cliente importa este arquivo.

```ts
export const LIMITES_SERVICO = Object.freeze({
  nome: Object.freeze({ min: 2, max: 100 }),
  precoMaxCentavos: 9_999_999,                 // R$ 99.999,99 (D-2)
  duracao: Object.freeze({ min: 5, max: 720, passo: 5 }), // D-3
  profissionaisMax: 200,                       // teto da lista recebida, antes da deduplicação
  precoMaxCaracteres: 20,                      // teto do texto do preço (casca e campo)
});

export type CampoServico = 'nome' | 'preco' | 'duracao' | 'profissionais' | 'formulario';
export type ErrosServico = Partial<Record<CampoServico, string>>;

/** Linha da lista do painel. */
export type ServicoResumo = {
  id: string; nome: string; precoCentavos: number; duracaoMin: number; ativo: boolean;
  /** Só profissionais ATIVOS do salão vinculados (CA-10). */
  profissionaisAtivos: number;
  /** ativo && profissionaisAtivos > 0 (RN-7): false + ativo → aviso do CA-14. */
  ofertavel: boolean;
};
export type ProfissionalOpcao = { id: string; nome: string; ativo: boolean; vinculado: boolean };
/** Página de edição: ativos (todos, marcados se vinculados) + inativos vinculados (D-5). */
export type ServicoEdicao = Omit<ServicoResumo, 'profissionaisAtivos'> & { profissionais: ProfissionalOpcao[] };

export type EntradaCriarServico = { nome: unknown; preco: unknown; duracao: unknown; profissionais: unknown };
export type EntradaEditarServico = EntradaCriarServico & { id: unknown };
export type EntradaIdServico = { id: unknown };

export type ResultadoSalvarServico =
  | { resultado: 'salvo'; servico: ServicoResumo }
  | { resultado: 'invalido'; erros: ErrosServico };
export type ResultadoSituacaoServico = { resultado: 'desativado' | 'reativado'; ofertavel: boolean };

export const MENSAGENS_SERVICO = Object.freeze({
  nome: 'Informe o nome (de 2 a 100 caracteres).',
  preco: 'Informe o preço em reais, de 0,00 a 99.999,99 (ex.: 80,00).',
  duracao: 'Informe a duração em minutos: múltiplo de 5, de 5 a 720.',
  profissionais: 'Escolha só profissionais ativos deste salão. Recarregue a página e tente de novo.',
  formulario: 'Não foi possível ler os dados enviados. Tente de novo.',
  ajudaPreco: 'Ex.: 80,00',
  semProfissional: 'Não aparece na página pública: nenhum profissional ativo executa este serviço.',
  desativado: 'Serviço desativado. Ele não aparece mais na página pública.',
  reativado: 'Serviço reativado.',
  naoEncontrado: 'Serviço não encontrado.',
  acessoNegado: 'Acesso negado.',
});
```

A mensagem `profissionais` é **a mesma** para profissional de outro salão, inexistente, malformado, inativo e lista acima do teto (RN-4, RN-10, CA-4, CA-7). Ela não revela se o id existe em outro salão.

### 3.2 Repositório (`src/server/repos/servico.ts`, `tipos.ts`, `publico.ts`)

Todos os métodos chamam `exigirEscopo(ctx)` antes de qualquer consulta, e um id que não é UUID dá `NaoEncontrado` sem consultar. SQL bruto (`$queryRaw`/`$executeRaw`) só onde o Prisma não expressa a trava ou o `ON CONFLICT`.

```ts
// repos/tipos.ts
export type DadosServico = { nome: string; precoCentavos: number; duracaoMin: number };
export type ServicoPainelDTO = ServicoDTO & { profissionaisAtivos: number };
export type ProfissionalVinculoDTO = { id: string; nome: string; ativo: boolean; vinculado: boolean };
```

```ts
// RepoServico — além de buscarPorId, listar e renomear (inalterados)
criar(ctx, d: DadosServico): Promise<ServicoDTO>;                       // ativo = true (default)
/** D-10: ativo desc, nome, id. _count de vínculos com profissional.ativo = true. */
listarParaPainel(ctx): Promise<ServicoPainelDTO[]>;
buscarParaPainel(ctx, id): Promise<ServicoPainelDTO>;                  // NaoEncontrado
/**
 * Profissionais ativos do salão (vinculado true/false) + inativos VINCULADOS a este serviço.
 * Ordem: ativo desc, nome, id. Não verifica a existência do serviço (o chamador já buscou).
 */
listarProfissionaisParaVinculo(ctx, servicoId): Promise<ProfissionalVinculoDTO[]>;
/**
 * SELECT p.id FROM profissional p
 *  WHERE p.salao_id = $salao AND p.id = ANY($ids::uuid[]) AND p.ativo
 *  ORDER BY p.id FOR SHARE OF p
 * Devolve os ids encontrados. Ids que não são UUID são descartados antes (nunca 22P02);
 * lista vazia → [] sem consulta. Só faz sentido dentro de emTransacao.
 */
travarProfissionaisParaVinculo(ctx, ids: readonly string[]): Promise<string[]>;
/**
 * SELECT s.id, s.ativo FROM servico s WHERE s.id = $id AND s.salao_id = $salao
 *  FOR NO KEY UPDATE OF s
 * Sem linha → NaoEncontrado. O texto "FOR NO KEY UPDATE OF s" é o marcador que o teste de
 * concorrência procura em pg_stat_activity (não alterar sem ajustar T-4).
 */
travarParaAlteracao(ctx, id): Promise<{ id: string; ativo: boolean }>;
atualizarDados(ctx, id, d: DadosServico): Promise<ServicoDTO>;          // updateMany salao_id; 0 → NaoEncontrado
/** updateMany { id, salaoId } → { ativo }; 0 → NaoEncontrado (linha de B nunca é tocada, CA-9). */
definirAtivo(ctx, id, ativo: boolean): Promise<ServicoDTO>;
/**
 * Pré-condições: o chamador tem a trava do serviço e validou `ids` com
 * travarProfissionaisParaVinculo (todos ativos e do salão). No MESMO executor:
 *   DELETE FROM servico_profissional sp USING profissional p
 *    WHERE sp.salao_id = $salao AND sp.servico_id = $servico
 *      AND p.salao_id = sp.salao_id AND p.id = sp.profissional_id AND p.ativo
 *      AND sp.profissional_id <> ALL($ids::uuid[]);
 *   INSERT INTO servico_profissional (salao_id, servico_id, profissional_id)
 *   SELECT $salao, $servico, x FROM unnest($ids::uuid[]) AS x
 *   ON CONFLICT (salao_id, servico_id, profissional_id) DO NOTHING;
 * Vínculos com profissionais INATIVOS nunca são apagados (RN-9, RN-10).
 */
substituirVinculosAtivos(ctx, servicoId, ids: readonly string[]): Promise<{ adicionados: number; removidos: number }>;
```

```ts
// repos/publico.ts — RN-7 (assinatura e tipo inalterados)
listarServicosPublicos(ctx: PublicoContext): Promise<ServicoPublico[]>;
// where: { salaoId, ativo: true, profissionais: { some: { profissional: { ativo: true } } } }
// select: { id, nome, precoCentavos, duracaoMin }; orderBy: nome, id.
```
A relação `ServicoProfissional → Profissional` é pela FK composta `(salao_id, profissional_id)`, então o `some` só enxerga profissionais do mesmo salão. O `EXISTS` gerado usa o prefixo `(salao_id, servico_id)` da PK. O docstring do arquivo passa a citar a RN-7 da D-014 e diz que esta é a **única** leitura de serviços ofertáveis para E3.1/E4.1.

**Ordem canônica de travas** (vai no cabeçalho de `repos/servico.ts`; é obrigação para E3.1/E3.2/E3.4/E3.5):

```
profissional(is) (FOR SHARE ou FOR UPDATE, por id)  →  servico(s) (FOR SHARE / FOR NO KEY UPDATE, por id)
  →  servico_profissional / reserva / reserva_item
```

- Editar serviço: profissionais escolhidos `FOR SHARE` → serviço `FOR NO KEY UPDATE` → UPDATE do serviço → DELETE/INSERT de vínculos.
- Criar serviço: profissionais escolhidos `FOR SHARE` → INSERT do serviço (linha nova, sem disputa) → INSERT de vínculos.
- Desativar/reativar serviço: só a linha do serviço (UPDATE, `FOR NO KEY UPDATE` implícito).
- Desativar profissional (D-013): só a linha do profissional `FOR UPDATE`. Não toca serviço nem vínculos, então não há ciclo com esta demanda.
- Ninguém nesta demanda trava `reserva`, `usuario` ou `sessao`.

Efeitos desejados:
- **CA-15:** duas edições do mesmo serviço se serializam na trava do serviço. A segunda roda o DELETE/INSERT com um snapshot novo (READ COMMITTED), que já enxerga os vínculos da primeira. O conjunto final é exatamente o da segunda. Os `FOR SHARE` sobre profissionais em comum são compatíveis entre si.
- **Vínculo × desativação de profissional:** se a desativação confirma antes, o `FOR SHARE … AND ativo` não devolve a linha (EvalPlanQual) e a edição recusa com erro de campo. Se a edição trava antes, a desativação espera o commit, e o vínculo novo fica preservado como "vínculo com inativo" (RN-9). Os dois desfechos são válidos e nenhum dá 5xx.
- **E3.2 (futura):** se ela travar o profissional `FOR SHARE` e depois os serviços `FOR SHARE`, ela serializa com a edição e a desativação do serviço sem ciclo.

### 3.3 Validação (`src/server/servicos/validacao.ts`, pura)

```ts
export type DadosServicoValidos = { nome: string; precoCentavos: number; duracaoMin: number; profissionais: string[] };

/** D-1. Texto → centavos inteiros, ou null. Nunca parseFloat/Number sobre texto com decimais. */
export function converterPrecoParaCentavos(v: unknown): number | null;
/** Inteiro de minutos (string só de dígitos ou number inteiro), ou null. Sem verificar faixa. */
export function converterDuracao(v: unknown): number | null;
/** Array de strings UUID, ≤ profissionaisMax itens; devolve os ids deduplicados (minúsculos) ou null. */
export function validarListaDeProfissionais(v: unknown): string[] | null;

export function validarDadosServico(e: unknown):
  | { ok: true; dados: DadosServicoValidos }
  | { ok: false; erros: ErrosServico };
```

- **Entrada:** `z.strictObject({ nome: z.unknown(), preco: z.unknown(), duracao: z.unknown(), profissionais: z.unknown() })`. Uma entrada que não é objeto, que tem campo extra ou que **não tem** `profissionais` produz `erros.formulario`. A chave `profissionais` é obrigatória, e o conjunto vazio é `[]` explícito: um chamador que esquece o campo nunca apaga vínculos por acidente. A casca sempre envia `fd.getAll('profissionais')`.
- **nome:** `normalizarNome(v, LIMITES_SERVICO.nome)` de `src/lib/texto.ts`; null → `erros.nome`.
- **preço** (`converterPrecoParaCentavos`):
  1. Só `string`; `trim()`; comprimento ≤ `precoMaxCaracteres`.
  2. `^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$`. O `\s` inclui U+00A0, então o texto de `formatarMoeda` é aceito.
  3. `inteiro = g1.replaceAll('.', '').replace(/^0+(?=\d)/, '')`; se `inteiro.length > 5`, devolve null (acima do teto, sem converter números grandes).
  4. `centavos = Number(inteiro) * 100 + Number((g2 ?? '').padEnd(2, '0'))`, somando apenas inteiros pequenos.
  5. Se `centavos > precoMaxCentavos`, devolve null.
  - Aceitos (CA-5): `"80"` → 8000, `"80,5"` → 8050, `"1.234,56"` → 123456, `"R$ 0,00"` → 0, `"0,10"` → 10, `"99.999,99"` → 9999999, `"R$80"` → 8000, `"R$ 80,00"` → 8000, `"1.234"` → 123400.
  - Recusados: `"-1,00"`, `"abc"`, `"80,001"`, `"80.00"`, `"100.000,00"`, `""`, `"   "`, `"1.23,00"`, `"1,234.56"`, `"80,"`, `",50"`, `80` (number), `null`.
- **duração** (`converterDuracao`): `string` aparada que casa `^\d{1,4}$`, ou `number` com `Number.isSafeInteger`. Senão null. Depois, faixa `[5, 720]` e `% 5 === 0`. Qualquer falha dá `erros.duracao`. Recusados (CA-5): `0`, `-5`, `7`, `725`, `"45.5"`, `""`, `"4 5"`, `"1e2"`.
- **profissionais** (`validarListaDeProfissionais`): `Array.isArray`, comprimento ≤ 200, todo item `string` com `ehUuid` (de `@/server/repos/ids`, que é puro). Depois, minúsculas e `new Set`. Qualquer falha dá `erros.profissionais`. Ids repetidos são deduplicados sem erro.
- Todos os erros de campo voltam juntos. A checagem no banco (salão e ativo) acontece em `servico.ts` e só roda quando a validação pura passa.

### 3.4 Formatação (`src/lib/format.ts`)

```ts
/** D-7: 45 → '45 min'; 60 → '1 h'; 90 → '1 h 30 min'; 720 → '12 h'. Inteiro > 0, senão RangeError/TypeError. */
export function formatarDuracao(minutos: number): string;
/** Mesmo texto de formatarMoeda sem 'R$ ': 8000 → '80,00'; 123456 → '1.234,56'; 0 → '0,00'. Usado no valor inicial do campo de preço. */
export function formatarMoedaSemSimbolo(centavos: number): string;
```
`formatarMoeda` passa a ser `R$ + NBSP + formatarMoedaSemSimbolo(c)`, sem mudar o comportamento. Os testes existentes de `formatarMoeda` continuam verdes. A ida e volta `converterPrecoParaCentavos(formatarMoedaSemSimbolo(n)) === n` e `converterPrecoParaCentavos(formatarMoeda(n)) === n` é testada em `validacao.test.ts`, para `n ∈ {0, 10, 8000, 123456, 9999999}`.

### 3.5 Serviço (`src/server/servicos/servico.ts`) e ações (`servicos.acao.ts`)

Sem `next/*`. Toda função começa com `exigirPermissao(ctx, 'servico.gerir')`, em defesa em profundidade.

```ts
listarParaPainel(ctx: TenantContext): Promise<ServicoResumo[]>;
obterParaEdicao(ctx: TenantContext, id: unknown): Promise<ServicoEdicao>;        // NaoEncontrado
listarProfissionaisParaNovo(ctx: TenantContext): Promise<ProfissionalOpcao[]>;   // listarAtivos → vinculado: false
criar(ctx, e: unknown): Promise<ResultadoSalvarServico>;
editar(ctx, e: unknown): Promise<ResultadoSalvarServico>;
desativar(ctx, e: unknown): Promise<ResultadoSituacaoServico>;
reativar(ctx, e: unknown): Promise<ResultadoSituacaoServico>;
```

- **id:** só `string`. Outro tipo, malformado, inexistente ou de outro salão: o mesmo `NaoEncontrado` (o repositório filtra por `salao_id`).
- **criar:** `validarDadosServico` (inválido → `invalido`, sem tocar o banco) → `emTransacao(t => …)`:
  1. `encontrados = t.servicos.travarProfissionaisParaVinculo(ctx, dados.profissionais)`; se `encontrados.length !== dados.profissionais.length`, devolve `invalido` com `erros.profissionais`, **sem nenhuma escrita** (RN-13);
  2. `t.servicos.criar(ctx, …)`;
  3. `t.servicos.substituirVinculosAtivos(ctx, novo.id, dados.profissionais)`;
  4. `t.servicos.buscarParaPainel` → `salvo`.
- **editar:** separa `{ id, ...resto }` (entrada que não é objeto dá `invalido`/`formulario`), `exigirId(id)` → `validarDadosServico(resto)` → `emTransacao`:
  1. a trava dos profissionais, como no criar (recusa sem escrita);
  2. `t.servicos.travarParaAlteracao(ctx, id)` (404 de B, inexistente ou malformado). Com o passo 1 recusado, o 404 não chega a ser avaliado; ver a nota abaixo;
  3. `atualizarDados` → `substituirVinculosAtivos` → `buscarParaPainel` → `salvo`.
  - Nota de precedência: entrada inválida com o id de B devolve `invalido`, igual a um id inexistente, e não vaza nada. Os testes do CA-9 usam entrada válida (com `profissionais: []` ou com ids de A) para observar o 404.
  - Serviço inativo pode ser editado e ter vínculos alterados (spec §6).
- **desativar / reativar:** `exigirId` → `emTransacao(t => t.servicos.definirAtivo(ctx, id, false|true))` e depois `buscarParaPainel` para calcular `ofertavel`. Idempotentes: repetir não é erro. Sem pré-condição (RN-2). Não tocam `reserva`, `reserva_item` nem os vínculos.
- **Logs** (JSON numa linha, só ids e contagens, sem nomes): `servico.salvo` `{ salaoId, servicoId, operacao: 'criar'|'editar', vinculosAdicionados, vinculosRemovidos }`; `servico.situacao_alterada` `{ salaoId, servicoId, ativo }`.

```ts
// servicos.acao.ts — sem 'use server'; toda exportação é defineAcao; handlers finos
export const criarServico     = defineAcao<EntradaCriarServico,  ResultadoSalvarServico>({ papeis: ['gestor'], capacidade: 'configurar' }, (ctx, e) => servico.criar(ctx, e));
export const editarServico    = defineAcao<EntradaEditarServico, ResultadoSalvarServico>({ papeis: ['gestor'], capacidade: 'configurar' }, (ctx, e) => servico.editar(ctx, e));
export const desativarServico = defineAcao<EntradaIdServico, ResultadoSituacaoServico>({ papeis: ['gestor'], capacidade: 'configurar' }, (ctx, e) => servico.desativar(ctx, e));
export const reativarServico  = defineAcao<EntradaIdServico, ResultadoSituacaoServico>({ papeis: ['gestor'], capacidade: 'configurar' }, (ctx, e) => servico.reativar(ctx, e));
```

### 3.6 Rotas, telas e casca (`src/app/painel/servicos/`)

| Arquivo | Conteúdo |
|---|---|
| `page.tsx` | `exigirAcessoAoPainel(ROTAS.servicos, ['gestor'], 'servico.gerir')`; negado → `<AcessoNegado />`. `listarParaPainel` + `buscarIdentidadeDoPainel`. `PanelLayout caminhoAtual=ROTAS.servicos`, `h1` "Serviços", link "Cadastrar serviço" (`ROTAS.novoServico`), `<ListaServicos>` |
| `novo/page.tsx` | mesma guarda (`ROTAS.novoServico`); `listarProfissionaisParaNovo`; `<FormularioServico modo="criar" acao={criarServicoAcao} profissionais={…} />` |
| `[id]/page.tsx` | guarda (`ROTAS.servico(id)`) **antes** da busca (o profissional vê 403, nunca 404). `obterParaEdicao`; `NaoEncontrado` → `notFound()`, **fora** do `try`. `h1` com o nome; `Alert` de aviso `semProfissional` se `ativo && !ofertavel`; `<FormularioServico modo="editar" …>`; `<ControleSituacao>` |
| `estado.ts` | `EstadoFormularioServico { mensagem: string \| null; erros: ErrosServico; valores: { nome; preco; duracao: string; profissionais: string[] } }`, `EstadoSituacao { variante: 'sucesso' \| 'erro' \| null; mensagem: string \| null }` e os iniciais. Só `import type` + constantes de `@/server/servicos/tipos` |
| `FormularioServico.tsx` (+ `.module.css`, `.test.tsx`) | `'use client'`, `useActionState`, `<form action noValidate>`; `Field` nome (`maxLength=100`), `Field` preço (`inputMode="decimal"`, `ajuda=MENSAGENS_SERVICO.ajudaPreco`, `maxLength=20`, valor inicial `formatarMoedaSemSimbolo`), `Field` duração (`tipo="number"`, `inputMode="numeric"`, `min=5 max=720 step=5`, rótulo "Duração (minutos)"); `<fieldset aria-describedby={erro?}>` + `<legend>Profissionais que executam</legend>` com um `Checkbox name="profissionais" value={id} rotulo={nome} defaultChecked` por profissional ativo e, à parte, `<ul>` dos inativos vinculados com "Inativo, vínculo mantido" (sem controle). Sem ativos: texto com link para `ROTAS.novoProfissional`. Erro geral em `Alert`; id oculto na edição. Os valores marcados vêm de `estado.valores.profissionais` (preservados depois de um erro, com ou sem JS) |
| `ListaServicos.tsx` (+ `.test.tsx`) | componente de servidor; `DataList` com Nome (link `ROTAS.servico(id)`), Preço (`formatarMoeda`), Duração (`formatarDuracao`), Situação ("Ativo"/"Inativo") e Profissionais ativos (número). Ativo e não ofertável: o texto `semProfissional` na linha. Vazio: `EmptyState` com "Cadastrar serviço" |
| `ControleSituacao.tsx` (+ `.test.tsx`) | `'use client'`; `useActionState`; `<form action>` com id oculto e um único botão: "Desativar serviço" (ativo) ou "Reativar serviço" (inativo), cada um com a sua ação. Mensagem em `Alert` `role="status"` (sucesso) ou `role="alert"` (erro). Sem diálogo (D-9) |
| `Servicos.module.css` | layout (só `var(--…)`, breakpoint `48rem`) |
| `acoes.ts` | `'use server'`; casca (abaixo) |

Casca:
```ts
criarServicoAcao(anterior: EstadoFormularioServico, fd: FormData): Promise<EstadoFormularioServico>
editarServicoAcao(anterior: EstadoFormularioServico, fd: FormData): Promise<EstadoFormularioServico>
desativarServicoAcao(anterior: EstadoSituacao, fd: FormData): Promise<EstadoSituacao>
reativarServicoAcao(anterior: EstadoSituacao, fd: FormData): Promise<EstadoSituacao>
```
- `FormData` → `{ nome, preco, duracao, profissionais: fd.getAll('profissionais').filter(string) }` (+ `id` na edição). Campos extras são ignorados. Nenhuma caixa marcada dá `profissionais: []`.
- `valores` devolvidos: nome e preço aparados e cortados nos tetos (100 e 20), duração cortada em 4, `profissionais` com no máximo 200 itens.
- Mapa do resultado: `nao_autenticado` → `redirect('/entrar?proximo=' + encodeURIComponent(rota))`; `acesso_negado`/`nao_encontrado` → `mensagem`. Criar ou editar com sucesso: `revalidatePath(ROTAS.servicos)` (+ `ROTAS.servico(id)`) e `redirect(ROTAS.servicos)`. Desativar ou reativar: revalida as duas rotas e devolve `{ variante: 'sucesso', mensagem }` (`desativado`/`reativado`; ao reativar um serviço não ofertável, acrescenta `semProfissional`). `redirect` sempre **fora** de `try`. A casca não importa `@/server/repos`.

## 4. Dados — DBA **dispensado**

Sem migração, sem índice novo e sem constraint nova. Motivos:
- **Esquema suficiente:** `servico(ativo, preco_centavos, duracao_min)`, os CHECKs `preco_centavos >= 0` e `duracao_min > 0`, `servico_profissional` com PK e FKs compostas, e `reserva_item` com snapshot próprio.
- **CHECKs opcionais (múltiplo de 5 e tetos):** não adotados (§1.1). Há um único escritor validado, os tetos são suposições ajustáveis e a mudança não traz ganho de comportamento observável nesta demanda.
- **Índices:** a leitura pública (`EXISTS` por `(salao_id, servico_id)` + junção na PK de `profissional`), a contagem do painel e o DELETE de vínculos usam o prefixo da PK de `servico_profissional`. `listarProfissionaisParaVinculo` usa a PK e o índice `(salao_id, profissional_id)`. O volume é de dezenas de linhas por salão.
- **SQL bruto novo** (`FOR SHARE OF p`, `FOR NO KEY UPDATE OF s`, `DELETE … USING`, `INSERT … SELECT unnest … ON CONFLICT DO NOTHING`): segue padrões já revisados (D-011, D-012, D-013). A ordem de travas está em §3.2 e é verificada por T-4.

## 5. Infraestrutura — DevOps **dispensado**

Sem variável de ambiente, serviço, container, script, dependência ou job de CI. Os testes novos caem nos globs existentes (`src/**/*.test.ts(x)`, `tests/integration/**`). O `next build` passa a listar `ƒ /painel/servicos`, `/painel/servicos/novo` e `/painel/servicos/[id]`, todas dinâmicas por cookie. A observabilidade se resume a dois eventos de log JSON (§3.5).

## 6. Verificação das invariantes

| Invariante | Aplica? | Como |
|---|---|---|
| Escopo por salão no servidor | Sim | `salao_id` só de `ctx` (`exigirEscopo`); todo SQL filtra `salao_id`; os profissionais do vínculo são conferidos no salão da sessão sob `FOR SHARE` (RN-4) e a FK composta é a segunda barreira; o id de B, inexistente ou malformado dá o mesmo 404 (CA-9); a lista e a contagem são só de A (CA-10); a leitura pública é por `PublicoContext` (CA-8). As páginas guardam a permissão antes da busca. |
| Exclusion constraint anti-sobreposição | Indireto | Nenhuma reserva é criada ou alterada. Editar a duração não muda `reserva.fim`/`ocupado_ate` (CA-2). Obrigação para E3.2: copiar o snapshot lido sob `FOR SHARE` (§10). |
| UTC + fuso do salão | Não (só carimbos) | O serviço não tem horário; `criado_em`/`atualizado_em` são timestamptz. |
| Adaptadores de integração | Não | Nenhuma integração. |
| Soft delete / anonimização | Sim | Não há DELETE de `servico` (nem ação nem tela); desativar = `ativo = false` (CA-3). O único DELETE é de linhas de associação `servico_profissional` com profissional ativo (RN-8), que nenhuma reserva referencia. Vínculos com inativos são preservados (RN-9/RN-10, CA-7). Nenhum dado de cliente. |
| Somente leitura do salão suspenso | Declarado | `capacidade: 'configurar'` nas 4 ações (CA-11, verificado pelo registro). A regra efetiva é da E6.4. |
| Idempotência de webhooks/mensagens | Não | Sem webhook nem mensagem. Desativar/reativar repetidos e `ON CONFLICT DO NOTHING` são idempotentes. |
| Auditoria do super admin | Não | O super admin recebe 403 pela matriz; ações do gestor não auditam (D-11). |
| Snapshot de reservas (multi-serviço) | Sim | Nenhum caminho escreve em `reserva`/`reserva_item` (CA-2, CA-3: comparação byte a byte via `to_jsonb`). |

## 7. Decisões

| ID | Decisão |
|---|---|
| D-1 | **Confirmada**, com a regex de §3.3. Também aceita `R$` seguido de U+00A0 (ida e volta com `formatarMoeda`) e limita o texto a 20 caracteres. |
| D-2, D-3 | **Confirmadas**, só na aplicação (sem CHECK; §1.1). |
| D-4 | **Confirmada:** `ROTAS.novoServico`, `ROTAS.servico(id)`. |
| D-5 | **Confirmada.** A substituição afeta só os vínculos com profissionais ativos (`substituirVinculosAtivos`). |
| D-6, D-7, D-8, D-10, D-11, D-13 | **Confirmadas.** |
| D-9 | **Confirmada:** um formulário por situação, com mensagem de status. |
| D-12 | **Confirmada:** sem E2E (o job `e2e` não tem banco). |
| D-14 (nova) | **Ordem canônica de travas: profissional → serviço → associações/reservas** (§3.2). Obrigação para E3.x. |
| D-15 (nova) | Trava do serviço em `FOR NO KEY UPDATE`, não `FOR UPDATE` (§1.1). |
| D-16 (nova) | `profissionais` é campo **obrigatório** da entrada (array; vazio = `[]`). A casca sempre o envia. |
| D-17 (nova) | Uma mensagem única de erro de campo para qualquer profissional inválido (outro salão, inexistente, malformado, inativo, lista grande demais). |
| D-18 (nova) | Precedência na edição: validação pura → profissionais → 404 do serviço. Entrada inválida com id de outro salão dá `invalido`, sem vazamento (igual a um inexistente). |
| D-19 (nova) | A página de edição também mostra o aviso "Não aparece na página pública…" quando o serviço está ativo e não é ofertável. |

## 8. Riscos

| Risco | Mitigação |
|---|---|
| R-1: CA-15 instável (ordem de chegada à trava) | Dois testes. (a) Determinístico: uma conexão `pg` segura `SELECT … FROM servico WHERE id = $1 FOR UPDATE` dentro de `BEGIN`; dispara a edição 1 e espera, por `pg_stat_activity` (`wait_event_type = 'Lock' AND query LIKE '%FOR NO KEY UPDATE OF s%'`), contar 1; dispara a edição 2 e espera contar 2; faz `ROLLBACK`; o final tem de ser o conjunto da edição 2 (fila FIFO). (b) `Promise.all` de duas edições: final ∈ {S1, S2}, ambas `ok`. `timeout` explícito por `it` (30 s) e laço ×10 (§9). |
| R-2: vínculo × desativação de profissional (corrida) | Teste determinístico em T-4: a conexão `pg` faz `BEGIN; UPDATE profissional SET ativo=false WHERE id=P` (segura a trava); a edição que marca P fica esperando (`query LIKE '%FOR SHARE OF p%'`); `COMMIT` → a edição devolve `invalido`/`profissionais`, sem vínculo nem alteração do serviço. Com `ROLLBACK`, a edição é aceita. |
| R-3: impasse com a desativação de profissional (D-013) | A ordem é única (§3.2), a desativação só trava o profissional e esta demanda não trava `reserva`/`sessao`. T-4 roda 10 edições paralelas em 2 serviços com profissionais em comum, mais desativar/reativar de um deles, e exige que nenhuma termine com 5xx nem `deadlock detected`. |
| R-4: preço com float ou estouro | Parser só por texto (§3.3), com limite de 5 dígitos inteiros antes de converter; unitário com os casos-limite e a ida e volta com `formatarMoeda`. |
| R-5: caixas desmarcadas não chegam no `FormData` | A casca usa `getAll` (vazio → `[]`); um teste da casca envia o `FormData` sem `profissionais` e prova a remoção (CA-6/CA-7). Ausente na **ação** dá `formulario` (D-16). |
| R-6: o React 19 reinicia o formulário depois da ação e perde os valores com erro | Os campos usam `defaultValue`/`defaultChecked` derivados de `estado.valores` (o mesmo padrão da D-013, validado sem JS); o teste jsdom confere os valores e as caixas preservados depois de um estado de erro. |
| R-7: 404 × 403 nas páginas | A guarda vem antes da busca; `paginas.test.ts`: o profissional com o id de A vê "Acesso negado"; o gestor com o id de B, inexistente ou `abc` recebe `notFound`. |
| R-8: `redirect`/`notFound` dentro de `try` | Regra do projeto; teste da casca confere o destino do redirect. |
| R-9: a mudança em `listarServicosPublicos` quebra testes existentes | A fábrica já atende a RN-7; `tests/integration/tenant/publico.test.ts` roda sem mudança em T-2 (critério de conclusão). |
| R-10: cobertura dos `.tsx` cliente e da casca | Testes jsdom (T-5) e de páginas/casca (T-6), sem exclusões. |

## 9. Estratégia de testes

| Camada | O quê |
|---|---|
| Unitário (`node`) | `src/server/servicos/validacao.test.ts`: CA-5 inteiro (cada entrada da lista, aceitos e recusados da D-1, ida e volta com `formatarMoeda`/`formatarMoedaSemSimbolo`, duração, nome 1/2/100/101/só espaços, lista de profissionais: `'abc'`, número, 201 itens, repetidos deduplicados, maiúsculas normalizadas, `profissionais` ausente → `formulario`, campo extra → `formulario`, todos os erros juntos). `src/lib/format.test.ts`: `formatarDuracao` (5, 45, 60, 90, 125, 720; 0, −5, 1.5 e `NaN` lançam) e `formatarMoedaSemSimbolo`. `src/config/navegacao.test.ts`: rotas novas e codificação do id; `SEGMENTOS_RESERVADOS` inalterado. `src/server/repos/index.test.ts`: métodos novos com ID malformado → `NaoEncontrado` sem consulta, contexto inválido → `Error`, e `travarProfissionaisParaVinculo(ctx, [])` → `[]` sem consulta. |
| Unitário (`jsdom`) | `FormularioServico` (rótulos, `aria-describedby` dos erros, `fieldset`/`legend`, caixas rotuladas pelo nome, inativos sem caixa, ajuda "Ex.: 80,00", `inputMode`, valores preservados depois de um erro), `ListaServicos` (colunas, `formatarMoeda`/`formatarDuracao`, "Ativo"/"Inativo", aviso de não ofertável, estado vazio), `ControleSituacao` (botão certo por situação, `role="status"`/`"alert"`). Sem `user-event`. |
| Integração (PostgreSQL real) | `tests/integration/servicos/`: `repos.test.ts`, `publico.test.ts` (CA-8), `criar-editar.test.ts` (CA-1, CA-2, CA-5, CA-12, CA-13), `situacao.test.ts` (CA-3), `vinculos.test.ts` (CA-4, CA-6, CA-7), `isolamento-permissoes.test.ts` (CA-9, CA-10, CA-11), `concorrencia.test.ts` (CA-15, R-2, R-3), `paginas.test.ts` (páginas e casca via `renderToStaticMarkup`, com `next/headers`/`next/navigation`/`next/cache` substituídos, sem mock de banco). Ações por `acao.executar(credencial, input, { agora })`. `tests/integration/tenant/registro.test.ts` e `tenant/publico.test.ts` verdes sem mudança. |
| E2E | Nenhum (D-12). Passo manual (CA-14) com e sem JS, em 375 px e só com o teclado: `dev.md` (T-7) e `testes.md` (T-8). |

Cobertura ≥ 90%: todo arquivo novo de `src/` tem teste direto (tabela §10). `page.tsx` e `acoes.ts` são cobertos por `paginas.test.ts`. A medição é `npm run test:coverage` em T-7; abaixo do limiar, a tarefa dona do arquivo completa os testes, sem exclusões.

Comando de estabilidade (registrar no `dev.md` e sugerir ao líder para o `CLAUDE.md`):
```
for i in $(seq 10); do npx vitest run --project integration tests/integration/servicos/concorrencia.test.ts || break; done
```

## 10. Tarefas

Responsável pela implementação: `desenvolvedor`. DBA e DevOps dispensados (§4, §5).

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | desenvolvedor | — | T-2 | `src/config/navegacao.ts`, `src/config/navegacao.test.ts`, `src/lib/format.ts`, `src/lib/format.test.ts`, `src/server/servicos/tipos.ts`, `src/server/servicos/validacao.ts`, `src/server/servicos/validacao.test.ts` |
| T-2 | desenvolvedor | — | T-1 | `src/server/repos/servico.ts`, `src/server/repos/publico.ts`, `src/server/repos/tipos.ts`, `src/server/repos/index.test.ts`, `tests/integration/servicos/repos.test.ts`, `tests/integration/servicos/publico.test.ts` |
| T-3 | desenvolvedor | T-1, T-2 | T-5 | `src/server/servicos/servico.ts`, `src/server/servicos/servicos.acao.ts`, `tests/integration/servicos/apoio.ts`, `tests/integration/servicos/{criar-editar,situacao,vinculos,isolamento-permissoes}.test.ts` |
| T-4 | desenvolvedor | T-3 | T-6 | `tests/integration/servicos/concorrencia.test.ts` |
| T-5 | desenvolvedor | T-1 | T-2, T-3 | `src/app/painel/servicos/{estado.ts, FormularioServico.tsx, FormularioServico.module.css, FormularioServico.test.tsx, ListaServicos.tsx, ListaServicos.test.tsx, ControleSituacao.tsx, ControleSituacao.test.tsx, Servicos.module.css}` |
| T-6 | desenvolvedor | T-3, T-5 | T-4 | `src/app/painel/servicos/{page.tsx, acoes.ts}`, `src/app/painel/servicos/novo/page.tsx`, `src/app/painel/servicos/[id]/page.tsx`, `tests/integration/servicos/paginas.test.ts` |
| T-7 | desenvolvedor | T-4, T-6 | — | `README.md`, `docs/demandas/D-014/dev.md` |
| T-8 | tester | T-7 | — | `docs/demandas/D-014/testes.md` |

Rodadas sem arquivo em comum:
- **Rodada 1:** T-1 ‖ T-2.
- **Rodada 2:** T-3 ‖ T-5. T-5 pode começar assim que T-1 terminar.
- **Rodada 3:** T-4 ‖ T-6.
- **Rodada 4:** T-7.
- **Rodada 5:** T-8.

Posse: um defeito num arquivo reabre a tarefa dona. Arquivos de outras tarefas são só lidos (por exemplo, T-4 e T-6 importam `tests/integration/servicos/apoio.ts`, que é de T-3, e podem importar `tests/integration/profissionais/apoio.ts` sem editá-lo). Ninguém edita `prisma/**`, `tests/support/**`, `tests/integration/tenant/**`, `src/server/auth/**`, `src/server/tenant/**`, `src/server/repos/profissional.ts`, `src/components/**`, `src/proxy.ts`, `eslint.config.mjs` nem `vitest.config.ts`. O `CLAUDE.md` é do líder.

**T-1 — Rotas, formatação, contratos e validação.**
- Entregável: §3.1 (`tipos.ts` completo), §3.3 (`validacao.ts`), §3.4 (`format.ts`) e as rotas novas.
- Conclusão: `npm run test:unit -- src/lib src/config src/server/servicos` verde, com os testes de §9 (todos os casos do CA-5); os testes existentes de `formatarMoeda` e `format.fonte-unica.test.ts` verdes; `tipos.ts` sem import de runtime de `@/server/**`; nenhum `parseFloat`/`Number(` sobre texto com vírgula ou ponto em `validacao.ts`; lint e typecheck verdes.

**T-2 — Repositórios e leitura pública.**
- Entregável: §3.2 completo, com o cabeçalho da ordem canônica de travas e os marcadores `FOR SHARE OF p` / `FOR NO KEY UPDATE OF s` literais no SQL.
- Conclusão: `repos.test.ts` cobre `criar` (`ativo = true`, `salao_id` do contexto); `listarParaPainel` na ordem D-10, com a contagem só de **ativos** de A (CA-10); `buscarParaPainel` 404 para B; `listarProfissionaisParaVinculo` (ativos marcados/desmarcados + inativo vinculado; o inativo não vinculado e os de B ausentes); `travarProfissionaisParaVinculo` (devolve só ativos de A; ids de B, inexistentes e inativos ausentes; `'abc'` descartado sem 22P02); `travarParaAlteracao` 404 para B; `atualizarDados`/`definirAtivo` 404 para B com a linha de B intacta (`atualizado_em`); `substituirVinculosAtivos` (adiciona, remove só ativos, preserva o inativo, `[]` remove todos os ativos, contagens). `publico.test.ts` (CA-8): S1..S4, os quatro campos, a reativação de P que faz S3 aparecer, B isolado. `tests/integration/tenant/publico.test.ts` e `cadastro-paginas.test.ts` verdes **sem mudança**; `index.test.ts` atualizado; lint e typecheck verdes.

**T-3 — Serviço de domínio e ações.**
- Entregável: §3.5; `apoio.ts` (contexto do gestor, `fotografia` de `reserva`/`reserva_item` por `to_jsonb`, contagem de vínculos por salão, linha do serviço); testes pelas ações: CA-1, CA-2 (serviço a 8000 via `criarSalaoCompleto`; os itens mantêm 8000 e a duração; `reserva.inicio/fim/ocupado_ate` iguais), CA-3 (contagem de `servico` igual, `ativo = false`, fora da leitura pública, `reserva`/`reserva_item` byte a byte iguais, vínculos mantidos; a reativação o devolve à leitura pública), CA-4 (id de B, UUID inexistente e `'abc'`, no criar e no editar: mesma mensagem, contagens de vínculos de A e B iguais, serviço inalterado), CA-5 (pela ação, nada gravado), CA-6 (marca → linha existe e `obterParaEdicao` o mostra `vinculado`; desmarca → a linha some e as reservas ficam iguais), CA-7, CA-9 (editar/desativar/reativar com id de B, inexistente e `'abc'` → `{ ok: false, erro: 'nao_encontrado', status: 404 }`; linha e vínculos de B iguais, inclusive `atualizado_em`), CA-10, CA-11 (profissional → 403 nas 4 ações, banco igual; sem credencial → 401; metadados `{ papeis: ['gestor'], capacidade: 'configurar' }` conferidos explicitamente), CA-12, CA-13.
- Conclusão: `npx vitest run --project integration tests/integration/servicos` verde; nenhum `next/*` em `src/server/servicos/**`; `tests/integration/tenant/registro.test.ts` verde com as 4 ações; lint e typecheck verdes.

**T-4 — Concorrência.**
- Entregável: CA-15 (a) determinístico e (b) `Promise.all` (R-1); R-2 (vínculo × desativação de profissional, com `COMMIT` e com `ROLLBACK`); R-3 (10 edições paralelas em 2 serviços com profissionais em comum, mais desativar/reativar de um profissional; nenhum 5xx).
- Conclusão: o laço ×10 de §9 verde; `timeout` explícito em cada `it`; nenhum `deadlock detected` nem violação de PK; conexões `pg` fechadas no `afterAll`.

**T-5 — Componentes.**
- Entregável: §3.6 (componentes, CSS e `estado.ts`) com testes jsdom (CA-14).
- Conclusão: `npm run test:unit -- src/app/painel/servicos` verde; os `.tsx`/`estado.ts` não importam runtime de `@/server/**` além de `@/server/servicos/tipos`; moeda e duração só por `src/lib/format.ts`; CSS só com `var(--…)` e o breakpoint `48rem`; todo `*.test.tsx` começa com `/** @vitest-environment jsdom */`; lint e typecheck verdes.

**T-6 — Páginas e casca.**
- Entregável: §3.6 (`page.tsx` ×3, `acoes.ts`); `paginas.test.ts`: o gestor de A renderiza a lista só com serviços de A, preço e duração formatados e o aviso de não ofertável (CA-1, CA-10, CA-14); o profissional vê "Acesso negado" nas três páginas (CA-11); sem cookie, redirect para `/entrar?proximo=%2Fpainel%2Fservicos` (e o equivalente de `novo`/`[id]`); o id de B, inexistente ou `abc` dá `notFound` (CA-9); a edição mostra o profissional vinculado marcado e o inativo como "Inativo, vínculo mantido" (CA-6, CA-7); a casca cobre: criar válido → redirect para a lista; inválido → erros por campo e valores preservados; `FormData` sem `profissionais` remove os vínculos com ativos; campos extras ignorados; desativar/reativar → estado com a mensagem; `nao_autenticado` → redirect.
- Conclusão: `npx vitest run --project integration tests/integration/servicos/paginas.test.ts` verde; `npm run build` verde listando as três rotas; `redirect`/`notFound` fora de `try`; a casca não importa `@/server/repos`; lint e typecheck verdes.

**T-7 — Documentação e gates.**
- Entregável: README, seção "Serviços" (preço em reais com o formato aceito, duração múltipla de 5, desativação sem efeito em reservas, vínculos e a condição para aparecer na página pública); `dev.md` com a evidência de todos os gates, a cobertura, o laço ×10 e o passo manual do CA-14 (375 px, só teclado: criar → editar vínculos → desativar → reativar, **repetido com JS desligado**, incluindo um erro de validação vindo do servidor), mais o texto sugerido para o `CLAUDE.md` (D-014: módulo `src/server/servicos/`, `listarServicosPublicos` com RN-7, ordem canônica de travas, comando de estabilidade).
- Conclusão: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:coverage` (≥ 90%) e `npm run test:e2e` verdes; o laço da T-4 ×10 verde.

**T-8 — Validação independente (tester).**
- Entregável: `testes.md` com o veredito; repetir os gates e o laço; conferir o mapa abaixo; prova manual com Docker (gestor por `/cadastro`, profissionais e serviços pela tela) com teclado, sem JS e com leitor de tela nos erros.

### Mapa CA → tarefa → tipo de teste

| CA | Tarefa(s) | Tipo | Arquivo |
|---|---|---|---|
| CA-1 | T-2, T-3, T-5, T-6 | Integração + jsdom | `repos.test.ts`, `criar-editar.test.ts`, `ListaServicos.test.tsx`, `paginas.test.ts` |
| CA-2 | T-3 | Integração | `criar-editar.test.ts` |
| CA-3 | T-2, T-3 | Integração | `publico.test.ts`, `situacao.test.ts` |
| CA-4 | T-2, T-3 | Integração | `repos.test.ts`, `vinculos.test.ts` |
| CA-5 | T-1, T-3, T-5 | Unitário + integração + jsdom | `validacao.test.ts`, `criar-editar.test.ts`, `FormularioServico.test.tsx` |
| CA-6 | T-2, T-3, T-6 | Integração | `repos.test.ts`, `vinculos.test.ts`, `paginas.test.ts` |
| CA-7 | T-2, T-3, T-6 | Integração | `repos.test.ts`, `vinculos.test.ts`, `paginas.test.ts` |
| CA-8 | T-2 | Integração | `servicos/publico.test.ts` (+ `tenant/publico.test.ts` sem mudança) |
| CA-9 | T-2, T-3, T-6 | Integração (dois salões) | `repos.test.ts`, `isolamento-permissoes.test.ts`, `paginas.test.ts` |
| CA-10 | T-2, T-3, T-6 | Integração (dois salões) | `repos.test.ts`, `isolamento-permissoes.test.ts`, `paginas.test.ts` |
| CA-11 | T-3, T-6 | Integração + registro | `isolamento-permissoes.test.ts`, `tenant/registro.test.ts`, `paginas.test.ts` |
| CA-12 | T-3 | Integração | `criar-editar.test.ts` |
| CA-13 | T-3 | Integração | `criar-editar.test.ts` |
| CA-14 | T-1, T-5, T-6, T-7, T-8 | Unitário + jsdom + integração + manual | `format.test.ts`, `*.test.tsx`, `paginas.test.ts`, `dev.md`, `testes.md` |
| CA-15 | T-4 | Integração (concorrência ×10) | `concorrencia.test.ts` |

## 11. Obrigações registradas para as próximas demandas

- **E3.1 (#27):** usar `listarServicosPublicos` como a única fonte de serviços ofertáveis. Exigir que todos os serviços escolhidos estejam ativos e que o profissional esteja ativo e vinculado a todos.
- **E3.2/E3.4/E3.5:** na transação que cria, encaixa ou remarca, seguir a **ordem canônica** (§3.2): `profissional … FOR SHARE` (conferir `ativo`) → `servico … WHERE id = ANY(...) ORDER BY id FOR SHARE` (conferir `ativo`, ler `preco_centavos`/`duracao_min`) → conferir os vínculos → INSERT/UPDATE da reserva e dos itens com o snapshot lido nessa transação.
- **E4.1:** exibir o preço só por `formatarMoeda` e a duração por `formatarDuracao`.
- **Opcional (sem demanda):** CHECKs `servico.duracao_min % 5 = 0` e tetos, se o produto fixar D-2/D-3 (acionaria o DBA).
