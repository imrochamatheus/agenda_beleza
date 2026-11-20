# D-013 — Desenho: gerenciar profissionais, incluindo o gestor que também atende, com desativação (issue #16, E2.2)

Entradas: `docs/demandas/D-013/spec.md` (RN-1..RN-12, CA-1..CA-17, D-1..D-12), `issue-16.md`, `CLAUDE.md`, e o código em `src/server/tenant/`, `src/server/repos/`, `src/server/auth/`, `src/config/navegacao.ts`, `src/components/`, `prisma/schema.prisma` e `tests/support/`.

## 0. Verificações feitas antes do desenho

- `defineAcao` (`src/server/tenant/define-acao.ts`) só passa `agora` para `resolverTenant`. O handler não recebe o relógio, então o CA-15 (fronteira de tempo com relógio injetado) não seria testável. Por isso o desenho muda o núcleo (§3.1).
- O registro de ações já existe: `tests/integration/tenant/registro.test.ts` faz `import.meta.glob('/src/**/*.acao.ts', { eager: true })` e exige `verificarAcoes(...) = []`. O lint não trata `*.acao.ts` de forma especial: a regra geral se aplica (nada de Prisma nem `repos/db`), e um `*.acao.ts` pode importar `emTransacao`/`repos` de `src/server/repos`. **O primeiro `*.acao.ts` não precisa de mudança no lint nem no harness.**
- Um `*.acao.ts` não pode ter `'use server'` e ser chamado do cliente, porque o registro exige que **toda** exportação seja produto de `defineAcao` e a forma de chamar com `FormData`/`useActionState` é outra. O padrão do projeto (cadastro, entrar, recuperar senha) é uma **casca** `acoes.ts` com `'use server'` em `src/app/**`. Ela é adotada aqui: a casca converte `FormData` → input, chama a forma chamável da ação (que lê o cookie e passa por `defineAcao`) e converte o resultado no estado do formulário.
- `reserva_item` **não** guarda o nome do serviço (snapshot só de preço e duração). Os nomes da lista de recusa vêm de `servico.nome`, o nome atual (decisão D-13 nova, §7.1).
- O UNIQUE `(salao_id, usuario_id)` é um índice único inferível por `ON CONFLICT (salao_id, usuario_id)`, o mesmo padrão de `src/server/repos/cadastro.ts`.
- Um `SELECT … FOR UPDATE` na linha de `profissional` conflita com o `FOR KEY SHARE` que o PostgreSQL toma na linha referenciada quando alguém insere uma `reserva`, `convite`, `jornada` etc. apontando para ela. **Consequência útil (D-7):** uma desativação espera as inserções de reserva em andamento terminarem e, ao obter a trava, enxerga a reserva recém-confirmada (READ COMMITTED: o próximo comando vê o commit). O sentido inverso (reserva depois da desativação) continua exigindo que E3.2/E3.4/E3.5 confiram `ativo` com `FOR SHARE`. Por isso a desativação **tem de** usar `FOR UPDATE`, nunca `FOR NO KEY UPDATE`.
- `src/config/navegacao.test.ts` confere as rotas com `arrayContaining`: incluir rotas novas não quebra o teste existente.
- `src/server/repos/index.test.ts` enumera os métodos dos repositórios para os casos "ID malformado" e "contexto inválido". Os métodos novos entram nele (T-2).

## 1. Resumo da solução

1. **Núcleo:** `defineAcao` passa a entregar ao handler um terceiro argumento `{ agora }` (o mesmo instante usado em `resolverTenant`). `exigirAcessoAoPainel` ganha um parâmetro opcional `operacao` que aplica `exigirPermissao` no mesmo `try`, transformando a recusa da matriz em "Acesso negado".
2. **Repositórios (únicos que tocam o banco):** `repos/profissional.ts` ganha criar, listar para o painel, buscar para o painel, travar para alteração (`FOR UPDATE`, que já devolve o vínculo e o fuso do salão), atualizar dados, aplicar desativação (UPDATE + revogação de sessões + invalidação de convites, no executor da transação), reativar, listar ativos e garantir o perfil do gestor (`INSERT … ON CONFLICT DO NOTHING`). `repos/reserva.ts` ganha a consulta das reservas que bloqueiam a desativação. `repos/sessao.ts#revogarSessoesDoUsuario` ganha um executor opcional.
3. **Serviço de domínio** `src/server/profissionais/servico.ts`: valida (`validacao.ts`, puro), compõe as transações e devolve **resultados de negócio discriminados**. A recusa da RN-2 é `{ resultado: 'recusado', reservas }` dentro de `{ ok: true, dados }`. `ErroDeDominio`/`ResultadoAcao` não mudam.
4. **Ações** `src/server/profissionais/profissionais.acao.ts`: cinco `defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })`, finas, que chamam o serviço.
5. **Telas** em `src/app/painel/profissionais/`: lista (`page.tsx`), `novo/page.tsx` e `[id]/page.tsx`, com componentes cliente (formulário, controle de ativação com `ConfirmDialog`, botão "Eu também atendo") e a casca `acoes.ts`.

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Novo `ErroDeDominio` (ex.: `Conflito` 409 com carga) para a recusa | `ErroDeDominio` tem corpo constante por desenho (D-005 S-3: "nenhum construtor recebe ID, nome ou valor"). Pôr dados de reservas num erro quebraria essa garantia e o `respostaDeErro`. A recusa é um resultado de negócio previsto, não uma falha de acesso. |
| Validação de entrada como erro de domínio (400) | Mesmo motivo. Erros por campo vêm em `{ resultado: 'invalido', erros }`. |
| `*.acao.ts` com `'use server'` chamado diretamente pelo cliente | O registro proíbe exportações que não venham de `defineAcao`, o formulário sem JS precisa de `(estado, FormData)` e o padrão das demandas anteriores é a casca. |
| Revogar sessões depois do commit, com o cliente global | Abre uma janela em que o perfil está inativo e as sessões ainda valem. Isso é mitigado por `resolverTenant` (401 com perfil inativo), mas a RN-7 pede a mesma transação, e um rollback deixaria sessões revogadas sem desativação. |
| `UPDATE … WHERE NOT EXISTS (reservas)` sem trava | Não lista as reservas e não serializa contra desativar/reativar concorrentes (CA-17). |
| Trava `FOR UPDATE` na linha do usuário gestor para o "eu também atendo" | Conflita com o `FOR SHARE` do login (`criarSessaoSeSenhaVigente`). `ON CONFLICT DO NOTHING` resolve a corrida sem trava extra e sem abortar a transação. |
| Filtro `inicio > agora − duração máxima` para usar o índice por `inicio` | Não existe duração máxima de reserva no esquema (só `duracao_min > 0` por item). Um teto inventado seria incorreto. Ver §4. |
| E2E Playwright com banco | Não existe seed (E9.2) e o job `e2e` roda sem PostgreSQL. A acessibilidade é coberta por jsdom e pelo passo manual (D-11 mantida). |
| Desativar diretamente na lista (D-8 da spec citava "na lista") | Concentrar desativar/reativar na página de edição evita um `ConfirmDialog` por linha e a lista de recusa repetida. A lista leva à edição por um link por linha. |

### 1.2 Dependências novas

Nenhuma (nem pacote nem ferramenta). Usa `zod` (já usado em `confirmacao-email.ts`), `next/cache` (`revalidatePath`, que faz parte do Next) e `next/navigation` (`notFound`, `redirect`).

## 2. Componentes afetados

| Caminho | Mudança |
|---|---|
| `src/server/tenant/define-acao.ts` | handler recebe `exec: { agora: Date }` (§3.1) |
| `src/server/auth/pagina.ts` | `exigirAcessoAoPainel(caminho, papeis?, operacao?)` (§3.1) |
| `src/config/navegacao.ts` | `ROTAS.novoProfissional`, `ROTAS.profissional(id)` (§3.6) |
| `src/lib/texto.ts` (novo) | `normalizarNome` extraído de `cadastro.ts` (§3.3) |
| `src/server/auth/cadastro.ts` | passa a usar `normalizarNome` de `src/lib/texto.ts` (sem mudança de comportamento) |
| `src/server/repos/sessao.ts` | `revogarSessoesDoUsuario(usuarioId, agora, db?)` |
| `src/server/repos/profissional.ts` | métodos novos (§3.2) |
| `src/server/repos/reserva.ts` | `listarBloqueantesDeDesativacao` (§3.2) |
| `src/server/repos/tipos.ts` | DTOs `ProfissionalPainelDTO`, `TravaProfissional`, `ReservaBloqueanteDTO` |
| `src/server/profissionais/tipos.ts` (novo) | contratos de entrada e resultado, mensagens pt-BR, `ROTULO_CLIENTE_REMOVIDA` (sem import de servidor) |
| `src/server/profissionais/validacao.ts` (novo) | validação pura (RN-9) |
| `src/server/profissionais/servico.ts` (novo) | regras RN-1..RN-10, RN-12 |
| `src/server/profissionais/profissionais.acao.ts` (novo) | 5 ações `defineAcao` |
| `src/app/painel/profissionais/**` (novo) | páginas, componentes cliente e casca |
| `README.md` | seção curta "Profissionais" |

Nada muda em `prisma/**`, `.env.example`, `docker-compose.yml`, `.github/**`, `src/proxy.ts`, `src/server/auth/permissoes.ts` (a operação `profissional.gerir` já existe) nem em `tests/support/**`.

## 3. Interfaces

### 3.1 Núcleo (`define-acao.ts`, `pagina.ts`)

```ts
// define-acao.ts
export type ExecucaoAcao = { readonly agora: Date };
export function defineAcao<I, O>(
  config: ConfigAcao,
  handler: (ctx: TenantContext, input: I, exec: ExecucaoAcao) => Promise<O>,
): Acao<I, O>;
```
- Em `executar`: `const agora = deps.agora ?? new Date()` é calculado **uma vez**, passado a `resolverTenant(c, agora)` e ao handler. Handlers de 2 parâmetros continuam válidos (compatível com os testes existentes).
- Nada mais muda: ordem do núcleo, `ResultadoAcao`, `ErroDeDominio`, metadados.

```ts
// pagina.ts
export async function exigirAcessoAoPainel(
  caminho: string,
  papeis?: readonly PapelDeSalao[],
  operacao?: Operacao,
): Promise<AcessoPainel>;
```
- Com `operacao`, chama `exigirPermissao(ctx, operacao)` dentro do mesmo `try`: o `AcessoNegado` vira `{ tipo: 'negado' }`. O `redirect` continua fora do `try`.

### 3.2 Repositórios

Todos os métodos recebem `ContextoEscopado` e chamam `exigirEscopo` antes de qualquer consulta. Um ID que não é UUID dá `NaoEncontrado` antes da consulta. Nenhum usa `now()` do banco em regra: `agora` vem do chamador.

```ts
// repos/tipos.ts
export type VinculoProfissional = { papel: 'gestor' | 'profissional'; emailLogin: string };
export type ProfissionalPainelDTO = ProfissionalDTO & { vinculo: VinculoProfissional | null };
/** Resultado da trava FOR UPDATE: estado atual + dados para as regras, numa só consulta. */
export type TravaProfissional = {
  id: string; usuarioId: string | null; ativo: boolean; email: string | null;
  papelUsuario: 'gestor' | 'profissional' | null; fusoSalao: string;
};
export type ReservaBloqueanteDTO = {
  id: string; inicio: Date; fim: Date;
  /** null = cliente anonimizada. */
  clienteNome: string | null;
  /** Nomes atuais dos serviços, na ordem dos itens. */
  servicos: string[];
};
```

```ts
// repos/profissional.ts — além de buscarPorId, listar e renomear (inalterados)
criar(ctx, d: { nome: string; email: string | null }): Promise<ProfissionalDTO>;
/** D-9: ativos primeiro, depois nome, depois id. Inclui o vínculo (papel e e-mail do usuário). */
listarParaPainel(ctx): Promise<ProfissionalPainelDTO[]>;
buscarParaPainel(ctx, id): Promise<ProfissionalPainelDTO>;          // NaoEncontrado
/** Só ativos, por nome (CA-4: "consulta de ativos do salão"). */
listarAtivos(ctx): Promise<ProfissionalDTO[]>;
/**
 * SELECT p.id, p.usuario_id, p.ativo, p.email, u.papel, s.fuso
 *   FROM profissional p JOIN salao s ON s.id = p.salao_id
 *   LEFT JOIN usuario u ON u.id = p.usuario_id
 *  WHERE p.id = $id AND p.salao_id = $salao
 *  FOR UPDATE OF p          -- nunca NO KEY UPDATE (§0)
 * Sem linha → NaoEncontrado. Só tem sentido dentro de emTransacao.
 */
travarParaAlteracao(ctx, id): Promise<TravaProfissional>;
atualizarDados(ctx, id, d: { nome: string; email: string | null }): Promise<ProfissionalDTO>;
/**
 * Na MESMA transação/executor: (1) UPDATE ativo=false; (2) se revogarSessoesDe ≠ null,
 * revogarSessoesDoUsuario(revogarSessoesDe, agora, db); (3) convite: aceito_em IS NULL AND
 * invalidado_em IS NULL → invalidado_em = agora (só deste profissional e salão).
 */
aplicarDesativacao(ctx, id, d: { agora: Date; revogarSessoesDe: string | null }):
  Promise<{ sessoesRevogadas: number; convitesInvalidados: number }>;
reativar(ctx, id): Promise<void>;                                   // UPDATE ativo=true
/**
 * Exige TenantContext (como buscarIdentidadeDoPainel). Em SQL bruto:
 *   INSERT INTO profissional (salao_id, usuario_id, nome)
 *   SELECT u.salao_id, u.id, u.nome FROM usuario u
 *    WHERE u.id = ctx.usuarioId AND u.salao_id = $salao AND u.papel = 'gestor'
 *   ON CONFLICT (salao_id, usuario_id) DO NOTHING RETURNING id;
 * depois SELECT id, ativo … WHERE salao_id AND usuario_id = ctx.usuarioId FOR UPDATE;
 * inativo → UPDATE ativo = true. Usuário inexistente/não gestor → NaoEncontrado.
 */
garantirPerfilDoGestor(ctx: TenantContext): Promise<{ id: string; resultado: 'criado' | 'reativado' | 'ja_atende' }>;
```

```ts
// repos/reserva.ts
/**
 * status = 'confirmado' AND fim > agora (D-1), do profissional, no salão do contexto.
 * Ordem: inicio, id. Inclui cliente (nome) e itens→servico(nome) por ordem.
 */
listarBloqueantesDeDesativacao(ctx, profissionalId: string, agora: Date): Promise<ReservaBloqueanteDTO[]>;
```

```ts
// repos/sessao.ts
export async function revogarSessoesDoUsuario(
  usuarioId: string, agora: Date, db: Executor = obterPrisma(),
): Promise<number>;
```
`src/server/auth/sessao.ts` (reexportação) não muda: continua chamando com 2 argumentos.

**Ordem de travas** (documentar no cabeçalho de `repos/profissional.ts`; obrigação para E1.4/E3.x): `profissional` (FOR UPDATE) → leitura de `reserva` → `profissional` (UPDATE) → `sessao` → `convite`. Ninguém trava `usuario` nesta demanda.

### 3.3 Validação (`src/lib/texto.ts`, `src/server/profissionais/validacao.ts`)

```ts
// src/lib/texto.ts (extraído de cadastro.ts, mesmo comportamento)
/** Trim + colapso de espaços; null se não for texto, tiver caractere de controle ou ficar fora de [min,max]. */
export function normalizarNome(v: unknown, limite: { min: number; max: number }): string | null;
```

```ts
// validacao.ts (puro, sem banco)
export const LIMITES_PROFISSIONAL = { nome: { min: 2, max: 100 }, email: { max: 254 } } as const;
export function validarDadosProfissional(e: unknown):
  | { ok: true; dados: { nome: string; email: string | null } }
  | { ok: false; erros: ErrosProfissional };
```
- Entrada: `z.object({ nome: z.unknown(), email: z.unknown().optional() }).strict()`. Um objeto que não passa (não é objeto ou tem campos extras) dá `erros.formulario`.
- `nome`: `normalizarNome(..., {2,100})`, senão `erros.nome`.
- `email`: ausente, `''` ou só espaços → `null`. Senão `esquemaEmail` (de `src/server/auth/confirmacao-email.ts`: trim, lowercase, máx. 254, formato), senão `erros.email`.
- Todos os erros são devolvidos juntos.

### 3.4 Contratos de domínio (`src/server/profissionais/tipos.ts`)

Arquivo **sem imports de servidor** (o cliente o importa): só tipos e constantes.

```ts
export type CampoProfissional = 'nome' | 'email' | 'formulario';
export type ErrosProfissional = Partial<Record<CampoProfissional, string>>;
export type AcessoProfissional = 'voce' | 'com_acesso' | 'sem_acesso';

export type ProfissionalVisao = {
  id: string; nome: string; email: string | null; ativo: boolean;
  acesso: AcessoProfissional;
  /** E-mail de login (somente leitura) quando há usuário vinculado. */
  emailLogin: string | null;
  /** true se o e-mail do perfil não pode ser editado (RN-9: há usuário vinculado). */
  emailBloqueado: boolean;
};

export type EntradaCriar = { nome: unknown; email?: unknown };
export type EntradaEditar = { id: unknown; nome: unknown; email?: unknown };
export type EntradaId = { id: unknown };

export type ResultadoSalvar =
  | { resultado: 'salvo'; profissional: ProfissionalVisao }
  | { resultado: 'invalido'; erros: ErrosProfissional };

export type ReservaBloqueante = {
  id: string;
  inicio: string;            // ISO UTC (serializável)
  inicioLocal: string;       // formatarDataHora(inicio, fuso do salão) — src/lib/format.ts
  servicos: string[];
  cliente: string;           // nome, ou ROTULO_CLIENTE_REMOVIDA
};
export type ResultadoDesativar =
  | { resultado: 'desativado' }
  | { resultado: 'recusado'; reservas: ReservaBloqueante[] };
export type ResultadoReativar = { resultado: 'reativado' };
export type ResultadoEuTambemAtendo = { resultado: 'criado' | 'reativado' | 'ja_atende'; profissionalId: string };

export const ROTULO_CLIENTE_REMOVIDA = 'cliente removida';
export const MENSAGENS_PROFISSIONAL = Object.freeze({
  nome: 'Informe o nome (de 2 a 100 caracteres).',
  email: 'Informe um e-mail válido ou deixe em branco.',
  emailBloqueado: 'O e-mail de quem já tem acesso não pode ser alterado aqui.',
  formulario: 'Não foi possível ler os dados enviados. Tente de novo.',
  recusaDesativacao: 'Não é possível desativar: há reservas futuras confirmadas. Remarque ou cancele antes.',
  jaAtende: 'Você já atende neste salão.',
  naoEncontrado: 'Profissional não encontrado.',
  acessoNegado: 'Acesso negado.',
});
```

### 3.5 Serviço (`servico.ts`) e ações (`profissionais.acao.ts`)

Serviço (sem `next/*`; os testes de integração o exercitam pelas ações):

```ts
listarParaPainel(ctx: TenantContext): Promise<ProfissionalVisao[]>;
obterParaEdicao(ctx: TenantContext, id: unknown): Promise<ProfissionalVisao>;        // NaoEncontrado
criar(ctx, e: unknown): Promise<ResultadoSalvar>;
editar(ctx, e: unknown): Promise<ResultadoSalvar>;
desativar(ctx, e: unknown, agora: Date): Promise<ResultadoDesativar>;
reativar(ctx, e: unknown): Promise<ResultadoReativar>;
euTambemAtendo(ctx): Promise<ResultadoEuTambemAtendo>;
```
Regras:
- Toda função começa com `exigirPermissao(ctx, 'profissional.gerir')` (defesa em profundidade, além de `papeis: ['gestor']`).
- **id:** `typeof id === 'string'`, senão `NaoEncontrado`. Malformado, inexistente ou de outro salão dá o mesmo `NaoEncontrado` (o repositório filtra por `salao_id`).
- **acesso:** `usuarioId === ctx.usuarioId` → `voce`; com vínculo → `com_acesso`; sem → `sem_acesso`. Depende só do vínculo; o estado aparece separado.
- **criar:** valida, depois `repos().profissionais.criar` com `usuario_id` nulo (RN-12). Sem transação explícita (um INSERT).
- **editar:** valida, depois `emTransacao`: `travarParaAlteracao`; se `usuarioId ≠ null` e o e-mail normalizado for diferente de `trava.email` (com `null` == vazio), devolve `invalido` com `erros.email = emailBloqueado` sem gravar (CA-13). Senão `atualizarDados`. Com vínculo, o e-mail gravado continua `trava.email` (o nome muda; `usuario.email` nunca é tocado).
- **desativar:** uma transação `emTransacao` (READ COMMITTED):
  1. `trava = travarParaAlteracao(ctx, id)`;
  2. `bloq = reservas.listarBloqueantesDeDesativacao(ctx, id, agora)`; se não vazio, devolve `recusado` com as reservas mapeadas (`inicioLocal = formatarDataHora(inicio, trava.fusoSalao)`, `cliente = clienteNome ?? ROTULO_CLIENTE_REMOVIDA`), **sem escrita**;
  3. `aplicarDesativacao(ctx, id, { agora, revogarSessoesDe: trava.papelUsuario === 'profissional' ? trava.usuarioId : null })` (RN-7: o perfil do gestor não revoga sessões);
  4. devolve `desativado`. Já inativo: os passos 3 e 4 rodam do mesmo jeito (idempotente; garante "inativo ⇒ nenhuma sessão viva").
  Log estruturado `console.info(JSON.stringify({ evento: 'profissional.desativado', salaoId, profissionalId, sessoesRevogadas, convitesInvalidados }))` e, na recusa, `profissional.desativacao_recusada` com `quantidade`. Sem nomes, e-mails ou telefones.
- **reativar:** `emTransacao`: `travarParaAlteracao` e depois `reativar`. Não restaura sessões nem convites (RN-8, RN-10).
- **euTambemAtendo:** exige `ctx.papel === 'gestor'` (senão `AcessoNegado`); `emTransacao(r => r.profissionais.garantirPerfilDoGestor(ctx))`. A corrida é resolvida por `ON CONFLICT`: dez chamadas paralelas dão 1 `criado` e 9 `ja_atende`, nunca 5xx (CA-14).

Ações (o padrão para os próximos `*.acao.ts`: arquivo em `src/server/<modulo>/`, sem `'use server'`, toda exportação é `defineAcao`, handler fino que delega ao serviço):

```ts
const GESTOR = { papeis: ['gestor'], capacidade: 'configurar' } as const satisfies ConfigAcao;
export const criarProfissional    = defineAcao<EntradaCriar, ResultadoSalvar>(GESTOR, (ctx, e) => criar(ctx, e));
export const editarProfissional   = defineAcao<EntradaEditar, ResultadoSalvar>(GESTOR, (ctx, e) => editar(ctx, e));
export const desativarProfissional = defineAcao<EntradaId, ResultadoDesativar>(GESTOR, (ctx, e, { agora }) => desativar(ctx, e, agora));
export const reativarProfissional = defineAcao<EntradaId, ResultadoReativar>(GESTOR, (ctx, e) => reativar(ctx, e));
export const euTambemAtendo       = defineAcao<Record<string, never>, ResultadoEuTambemAtendo>(GESTOR, (ctx) => euTambemAtendoSrv(ctx));
```
(Atenção: `papeis` precisa ser uma tupla não vazia; se `as const` atrapalhar a inferência de `ConfigAcao`, declare o literal em cada chamada.)

### 3.6 Rotas e telas (`src/app/painel/profissionais/`)

`ROTAS`: `novoProfissional: '/painel/profissionais/novo'` e `profissional: (id) => '/painel/profissionais/${seg(id)}'`. Nenhum primeiro segmento novo (`painel` já é reservado). A rota estática `novo` vence `[id]` no Next, e `novo` não é UUID.

| Arquivo | Conteúdo |
|---|---|
| `page.tsx` | `exigirAcessoAoPainel(ROTAS.profissionais, ['gestor'], 'profissional.gerir')`; negado → `<AcessoNegado />`. `listarParaPainel(ctx)` + `buscarIdentidadeDoPainel(ctx)`. `PanelLayout caminhoAtual=ROTAS.profissionais`. `h1` "Profissionais", link "Cadastrar profissional", `<EuTambemAtendo>` só se não houver perfil `voce` ativo, `<ListaProfissionais>` |
| `novo/page.tsx` | mesma guarda (`caminho = ROTAS.novoProfissional`); `<FormularioProfissional modo="criar" acao={criarProfissionalAcao} />` |
| `[id]/page.tsx` | mesma guarda (`ROTAS.profissional(id)`), **antes** da busca (o profissional vê 403, não 404). `obterParaEdicao`; `NaoEncontrado` → `notFound()` (fora do `try`). Mostra o formulário (`modo="editar"`, id oculto, e-mail somente leitura se `emailBloqueado`), a seção "Acesso" (Você / e-mail de login / Sem acesso: é aqui que a E1.4 coloca "Enviar convite") e `<ControleAtivacao>` |
| `estado.ts` | `EstadoFormularioProfissional`, `EstadoEuTambemAtendo`, `EstadoDesativacao` e iniciais; só `import type` de `@/server/profissionais/tipos` + constantes desse arquivo |
| `FormularioProfissional.tsx` (+ `.module.css`, `.test.tsx`) | `'use client'`, `useActionState`, `Field` (rótulo e `erro` → `aria-describedby`), `Alert` para `erros.formulario`, `Button` |
| `ListaProfissionais.tsx` (+ `.test.tsx`) | `DataList` com colunas Nome (link para `ROTAS.profissional(id)`), Estado ("Ativo"/"Inativo"), Acesso ("Você"/"Com acesso"/"Sem acesso"). Vazio: `EmptyState` com chamada "Cadastrar profissional". Componente de servidor (sem estado) |
| `ControleAtivacao.tsx` (+ `.test.tsx`) | `'use client'`. Ativo: botão "Desativar" → `ConfirmDialog variante="perigo"`; `onConfirmar` chama `desativarProfissionalAcao(id)`; recusa → fecha o diálogo e mostra `Alert variante="erro"` (role=alert) com `MENSAGENS_PROFISSIONAL.recusaDesativacao` e `<ul>` com `inicioLocal — servicos.join(', ') — cliente`; sucesso → `router.refresh()`. Inativo: `<form action={reativarProfissionalAcao}>` com id oculto e botão "Reativar" (funciona sem JS) |
| `EuTambemAtendo.tsx` (+ `.test.tsx`) | `'use client'`, `<form>` + `useActionState(euTambemAtendoAcao)`; mostra `Alert` status com "Você já atende neste salão." quando `ja_atende` |
| `Profissionais.module.css` | layout das páginas (só `var(--…)`, breakpoint único `48rem`) |
| `acoes.ts` | `'use server'`; casca (abaixo) |

Casca `acoes.ts` (todas leem o cookie pela forma chamável da ação):
```ts
criarProfissionalAcao(anterior: EstadoFormularioProfissional, fd: FormData): Promise<EstadoFormularioProfissional>
editarProfissionalAcao(anterior: EstadoFormularioProfissional, fd: FormData): Promise<EstadoFormularioProfissional>
desativarProfissionalAcao(id: string): Promise<EstadoDesativacao>
reativarProfissionalAcao(fd: FormData): Promise<void>
euTambemAtendoAcao(anterior: EstadoEuTambemAtendo, fd: FormData): Promise<EstadoEuTambemAtendo>
```
- `FormData` → objeto só com os campos conhecidos (`nome`, `email`, `id`), valores `string` ou ausentes.
- Mapa do `ResultadoAcao`: `nao_autenticado` → `redirect(ROTAS.entrar + '?proximo=' + encodeURIComponent(rota))`; `acesso_negado` → mensagem `acessoNegado`; `nao_encontrado` → mensagem `naoEncontrado`. Sucesso de criar ou editar → `revalidatePath(ROTAS.profissionais)` e `redirect(ROTAS.profissionais)`; desativar, reativar e eu-também-atendo → `revalidatePath(ROTAS.profissionais)` e `revalidatePath(ROTAS.profissional(id))`. `redirect` sempre fora de `try`.
- Os valores devolvidos ao formulário são aparados e cortados nos tetos, como no cadastro.

## 4. Dados — DBA **dispensado**

Sem migração, sem índice novo, sem constraint nova. Motivos:
- **Esquema suficiente:** `profissional.ativo`, `usuario_id` com UNIQUE `(salao_id, usuario_id)`, `email` nulo, `convite.invalidado_em` e `sessao.revogada_em` já existem.
- **(a) revogação na transação:** é uma mudança de assinatura em `repos/sessao.ts` (executor opcional). Não muda dados.
- **(b) índice para `fim > agora`:** `reserva_salao_id_profissional_id_inicio_idx` atende pelo prefixo `(salao_id, profissional_id)`, e `status`/`fim` são filtrados sobre as linhas desse profissional. O volume é de algumas centenas a poucos milhares de linhas por profissional, numa operação rara (desativar). Não há duração máxima de reserva no esquema, então um limite inferior em `inicio` seria incorreto. Se o histórico crescer muito (anos), um índice parcial `(salao_id, profissional_id, fim) WHERE status = 'confirmado'` fica como evolução registrada, sem urgência.
- **(c) CHECK de minúsculas em `profissional.email`:** fica fora (D-6 mantida). A única escrita é pelo serviço, que normaliza. O destino do e-mail é o convite (E1.4), que já tem `convite_email_minusculo_chk`: um valor fora do padrão falharia ali, não em silêncio. Uma migração só por simetria acionaria o DBA sem ganho de comportamento. Registrado como pendência opcional para a E1.4.
- O `INSERT … ON CONFLICT` e o `FOR UPDATE OF p` seguem padrões já revisados pelo DBA (D-011, D-012).

## 5. Infraestrutura — DevOps **dispensado**

Sem variável de ambiente, serviço, container, job de CI, script ou dependência nova. A CI existente roda os testes novos (globs `src/**/*.test.ts(x)` e `tests/integration/**`). O `next build` passa a incluir as rotas `ƒ /painel/profissionais`, `/novo` e `/[id]`, que são dinâmicas por cookie. A observabilidade se resume a dois eventos de log JSON (§3.5), no padrão dos logs existentes.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como |
|---|---|---|
| Escopo por salão no servidor | Sim | `salao_id` só de `ctx` (`exigirEscopo`); todo SQL tem `p.salao_id = $salao`; `garantirPerfilDoGestor` filtra `u.salao_id`; o id de outro salão, inexistente ou malformado dá o mesmo `NaoEncontrado` (CA-9, CA-10). As páginas guardam por permissão antes da busca. |
| Exclusion constraint anti-sobreposição | Indireto | Não cria reservas. A desativação lê reservas sob `FOR UPDATE` do profissional, que serializa com inserções de reserva pela trava de FK (§0). Obrigação de E3.2/E3.4/E3.5: `FOR SHARE` + conferir `ativo` (§7.3). |
| UTC + fuso do salão | Sim | Comparação `fim > agora` em UTC (instantes); `inicioLocal` formatado por `src/lib/format.ts` com `salao.fuso` lido na trava (CA-3 com 02:30Z → dia anterior em São Paulo). |
| Adaptadores de integração | Não | Nenhuma integração (nem e-mail: o convite é da E1.4). |
| Soft delete / anonimização | Sim | Nunca `DELETE`; desativar = `ativo=false`; reservas, itens, jornadas, vínculos e convites mantêm o `profissional_id` (CA-4); cliente anonimizada aparece como "cliente removida" e o telefone nunca é lido (CA-3). |
| Somente leitura do salão suspenso | Declarado | `capacidade: 'configurar'` em todas as ações; a regra real é da E6.4 (`politicaDeOperacao`). As páginas são leitura. |
| Idempotência de webhooks/mensagens | Não | Sem webhook e sem mensagem. As operações são idempotentes por construção (desativar/reativar repetidos, `ON CONFLICT`). |
| Auditoria do super admin | Não | Só o gestor age; o super admin recebe 403 pela matriz (`profissional.gerir` negado). D-10 mantida. |
| Sessões (D-010 RN-14) | Sim | Revogação na mesma transação só para usuário `profissional`; o perfil do gestor nunca revoga as sessões do gestor (CA-5, CA-6). |

## 7. Riscos e decisões

### 7.1 Decisões D-1..D-12 da spec (e novas)

| ID | Decisão |
|---|---|
| D-1 | **Confirmada.** `status='confirmado' AND fim > agora`. |
| D-2 | **Confirmada.** Sem limite. |
| D-3 | **Confirmada**, com as chaves `ROTAS.novoProfissional` e `ROTAS.profissional(id)`. |
| D-4, D-5, D-6 | **Confirmadas** (D-6: ver §4 c). |
| D-7 | **Confirmada e reforçada:** `FOR UPDATE` (não `NO KEY UPDATE`), o que também espera inserções de reserva em andamento (§0). Obrigação para E3.x em §7.3. |
| D-8 | **Alterada no local:** "eu também atendo" só cria ou reativa; deixar de atender é desativar o próprio perfil **na página de edição** (não na lista). |
| D-9 | **Confirmada**, ordenada no SQL de `listarParaPainel` (`ativo desc, nome, id`); `listar` existente não muda. |
| D-10, D-11, D-12 | **Confirmadas.** |
| D-13 (nova) | Nomes dos serviços na lista de recusa = `servico.nome` atual (não há snapshot de nome em `reserva_item`). |
| D-14 (nova) | Contrato de recusa e validação: resultado de sucesso discriminado (`resultado: 'recusado' | 'invalido' | …`). `ErroDeDominio`/`ResultadoAcao` intocados. Padrão para as próximas ações com regra de negócio. |
| D-15 (nova) | `defineAcao` injeta `{ agora }` no handler (relógio único por execução). |
| D-16 (nova) | Padrão de ação: `src/server/<modulo>/<modulo>.acao.ts` (sem `'use server'`) + casca `src/app/**/acoes.ts` (`'use server'`) que só converte `FormData` e resultado, sem acessar repositórios. |
| D-17 (nova) | Editar um profissional **com** vínculo: o campo e-mail é ignorado se igual ao atual e recusado se diferente; `usuario.email` nunca é tocado. |
| D-18 (nova) | Desativar um profissional já inativo reaplica os efeitos (idempotente) em vez de devolver erro. |

### 7.2 Riscos

| Risco | Mitigação |
|---|---|
| R-1: mudança em `defineAcao` afeta todo handler futuro | Parâmetro adicional e opcional para o handler; `define-acao.test.ts` (unidade) e `tests/integration/tenant/define-acao.test.ts` continuam verdes; um caso novo prova que `exec.agora === deps.agora`. |
| R-2: transação abortada por violação de UNIQUE no "eu também atendo" (5xx) | `ON CONFLICT DO NOTHING` em vez de capturar P2002 dentro da transação; CA-14 com 10 chamadas, ×10 no laço. |
| R-3: CA-17 instável (ordem de obtenção da trava) | O teste segura a trava por uma conexão `pg` própria e espera, por `pg_stat_activity` (`wait_event_type = 'Lock'`), a primeira ação ficar bloqueada antes de disparar a segunda. A fila de travas de linha do PostgreSQL é FIFO para o mesmo modo, então a ordem de término é determinística. `timeout` explícito por `it` (30 s) e laço ×10. |
| R-4: impasse entre desativação e login/renovação | A desativação trava só `profissional` e atualiza `sessao`/`convite` por UPDATE simples; login e renovação não travam `profissional`. Ordem documentada (§3.2). Verificar `deadlock detected` ausente nos laços. |
| R-5: casca com `redirect` dentro de `try` engole `NEXT_REDIRECT` | Regra do projeto (R-9 da D-010): `redirect`/`notFound` sempre fora de `try`; o teste da casca confere o destino. |
| R-6: página de edição vaza existência (404 × 403) | Guarda de permissão antes da busca; teste: o profissional com o id de A vê "Acesso negado", e o gestor com o id de B recebe `notFound`. |
| R-7: cobertura dos componentes cliente | Testes jsdom de todos os `.tsx` cliente e teste de integração das páginas e da casca. |
| R-8: fábrica cria reserva futura para `s.profissional` | CA-4, CA-5, CA-7, CA-8 e CA-17 precisam de um profissional sem reservas futuras: cancelar a reserva da fábrica por SQL no `beforeEach` do arquivo, ou usar um profissional criado pela ação. Para o CA-5/CA-8 (usuário real com login), cancelar a reserva da fábrica (`UPDATE reserva SET status='cancelado'`). |
| R-9: CA-15 colide com a exclusion constraint | Reservas (b) `[agora−30min, agora+1min)` e (c) `[agora+1min, agora+31min)` são adjacentes (intervalo semiaberto, `ocupado_ate = fim`); (a) `[agora−61min, agora−1min)`. Usar um profissional criado no teste (sem a reserva da fábrica). |

### 7.3 Obrigações registradas para as próximas demandas

- **E3.2/E3.4/E3.5:** na transação que cria, encaixa ou remarca, `SELECT ativo FROM profissional WHERE id AND salao_id FOR SHARE` (ou mais forte) e recusar se `ativo = false`, **antes** do INSERT/UPDATE da reserva.
- **E1.4:** recusar convite para profissional inativo ou com `usuario_id`; ordem de travas `profissional` → `convite`; decidir se a troca de `profissional.email` invalida convites pendentes (aqui não invalida); avaliar o CHECK de minúsculas em `profissional.email` (§4 c).
- **E2.1:** a página pública e a escolha de profissional usam só ativos (`listarAtivos`/`listarProfissionaisPublicos`).

## 8. Estratégia de testes

| Camada | O quê |
|---|---|
| Unitário (`node`) | `src/lib/texto.test.ts` (normalizarNome); `src/server/profissionais/validacao.test.ts` (CA-12: limites 1/2/100/101, só espaços, controle, e-mail `ana@`, 255 caracteres, `"  ANA@Exemplo.COM "`, vazio → null, campos extras → `formulario`); `src/server/tenant/define-acao.test.ts` (`exec.agora`); `src/server/repos/index.test.ts` (métodos novos: ID malformado → NaoEncontrado sem consulta; contexto inválido → Error). |
| Unitário (`jsdom`) | `FormularioProfissional`, `ListaProfissionais`, `ControleAtivacao` (com `instalarDialogoFalso`), `EuTambemAtendo`: rótulos, `aria-describedby`, `role="alert"` na recusa, estado vazio, e-mail somente leitura, foco inicial/ciclo/Esc via `fireEvent` de `@testing-library/react` (já instalado; **sem** `user-event`, que seria dependência nova). Tab real e Enter/Espaço nativos ficam no passo manual (CA-16). |
| Integração (PostgreSQL real, `criarDoisSaloes`) | Repositórios (`repos.test.ts`); ações via `acao.executar(credencial, input, { agora })` para CA-1..CA-15; concorrência CA-14/CA-17; registro (`tests/integration/tenant/registro.test.ts`, que passa a ver as 5 ações reais: CA-11); páginas e casca com `next/headers`, `next/navigation` e `next/cache` substituídos (não é mock de banco), via `renderToStaticMarkup`. |
| E2E | Nenhum novo (D-11). O passo manual de teclado (CA-16) fica em `dev.md` (T-7) e é repetido pelo tester. |

Cobertura ≥ 90%: todo arquivo novo de `src/` tem teste direto (tabela de tarefas). `acoes.ts` e `page.tsx` são cobertos pelo teste de páginas (T-6). Medir com `npm run test:coverage` em T-7; abaixo de 90%, completar testes na tarefa dona do arquivo, sem exclusões.

Comandos de estabilidade (registrar no `dev.md`; sugerir ao líder para o `CLAUDE.md`):
```
for i in $(seq 10); do npx vitest run --project integration tests/integration/profissionais/concorrencia.test.ts || break; done
```

## 9. Tarefas

Responsável por implementação: `desenvolvedor` (DBA e DevOps dispensados, §4 e §5).

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | desenvolvedor | — | T-2 | `src/server/tenant/define-acao.ts`, `src/server/tenant/define-acao.test.ts`, `tests/integration/tenant/define-acao.test.ts`, `src/server/auth/pagina.ts`, `tests/integration/auth/pagina-operacao.test.ts` (novo), `src/config/navegacao.ts`, `src/config/navegacao.test.ts`, `src/lib/texto.ts`, `src/lib/texto.test.ts`, `src/server/auth/cadastro.ts`, `src/server/profissionais/tipos.ts` |
| T-2 | desenvolvedor | — | T-1 | `src/server/repos/profissional.ts`, `src/server/repos/reserva.ts`, `src/server/repos/sessao.ts`, `src/server/repos/tipos.ts`, `src/server/repos/index.test.ts`, `tests/integration/profissionais/repos.test.ts` |
| T-3 | desenvolvedor | T-1, T-2 | T-5 | `src/server/profissionais/validacao.ts`, `validacao.test.ts`, `servico.ts`, `profissionais.acao.ts`, `tests/integration/profissionais/{criar-editar,desativar,eu-tambem-atendo,isolamento-permissoes}.test.ts` |
| T-4 | desenvolvedor | T-3 | T-6 | `tests/integration/profissionais/concorrencia.test.ts` |
| T-5 | desenvolvedor | T-1 | T-3 | `src/app/painel/profissionais/{estado.ts, FormularioProfissional.tsx, FormularioProfissional.module.css, FormularioProfissional.test.tsx, ListaProfissionais.tsx, ListaProfissionais.test.tsx, ControleAtivacao.tsx, ControleAtivacao.test.tsx, EuTambemAtendo.tsx, EuTambemAtendo.test.tsx, Profissionais.module.css}` |
| T-6 | desenvolvedor | T-3, T-5 | T-4 | `src/app/painel/profissionais/{page.tsx, acoes.ts}`, `src/app/painel/profissionais/novo/page.tsx`, `src/app/painel/profissionais/[id]/page.tsx`, `tests/integration/profissionais/paginas.test.ts` |
| T-7 | desenvolvedor | T-4, T-6 | — | `README.md`, `docs/demandas/D-013/dev.md` |
| T-8 | tester | T-7 | — | `docs/demandas/D-013/testes.md` |

Rodadas sem arquivo em comum:
- **Rodada 1:** T-1 ‖ T-2.
- **Rodada 2:** T-3 ‖ T-5.
- **Rodada 3:** T-4 ‖ T-6.
- **Rodada 4:** T-7.
- **Rodada 5:** T-8.

Posse: um defeito num arquivo reabre a tarefa dona. Ninguém edita `prisma/**`, `tests/support/**`, `src/server/auth/permissoes.ts`, `src/server/tenant/{erros,context,sessao,registro,politica}.ts`, `src/components/**`, `src/proxy.ts`, `eslint.config.mjs` nem `vitest.config.ts`. O `CLAUDE.md` é do líder, que o atualiza ao encerrar a partir do texto sugerido em `dev.md`.

**T-1 — Núcleo, rotas, contratos.**
- Entregável: §3.1 (`ExecucaoAcao`; `operacao` em `exigirAcessoAoPainel`), §3.3 (`normalizarNome` extraído; `cadastro.ts` passa a usá-lo), §3.4 (`tipos.ts` completo), `ROTAS.novoProfissional`/`ROTAS.profissional(id)` com testes de codificação e de `SEGMENTOS_RESERVADOS` inalterado.
- Conclusão: unit e integração de `tenant/`, `auth/` (incluindo `cadastro*.test.ts`) e `config/` verdes; teste novo prova `exec.agora` igual ao `deps.agora` e ao instante de `resolverTenant`; `pagina-operacao.test.ts` prova gestor → permitido, profissional com `'profissional.gerir'` → `negado` e sem cookie → redirect; `tipos.ts` sem import de runtime de `@/server/**` fora de si mesmo; lint e typecheck verdes.

**T-2 — Repositórios.**
- Entregável: §3.2 completo, com o cabeçalho documentando a ordem de travas e `FOR UPDATE OF p`.
- Conclusão: `repos.test.ts` cobre: criar com `usuario_id` nulo; `listarParaPainel` na ordem D-9 e com vínculo; `listarAtivos`; `travarParaAlteracao` devolve papel e fuso e dá 404 para o id de B; `aplicarDesativacao` revoga só o usuário indicado e invalida só o convite pendente (pendente, aceito e invalidado inseridos no teste); `garantirPerfilDoGestor` cria, reativa e mantém; `listarBloqueantesDeDesativacao` (status, `fim > agora`, ordem, cliente nula, nomes dos serviços, isolamento); `revogarSessoesDoUsuario` com executor de transação é desfeito por rollback. `index.test.ts` atualizado. `sessao-rbac.test.ts` continua verde sem mudança. Lint e typecheck verdes.

**T-3 — Validação, serviço e ações.**
- Entregável: §3.3, §3.5; testes CA-1..CA-13 e CA-15 pelas ações.
- Conclusão: arquivos verdes; nenhum `next/*` em `src/server/profissionais/**`; `tests/integration/tenant/registro.test.ts` verde com as 5 ações reais (metadados `{ papeis: ['gestor'], capacidade: 'configurar' }` conferidos explicitamente em `isolamento-permissoes.test.ts`); CA-3 confere o texto exato de `inicioLocal` para 02:30Z (dia anterior, 23:30, em `America/Sao_Paulo`); CA-9 compara a linha de B (nome, email, ativo, `atualizado_em`) antes e depois; lint e typecheck verdes.

**T-4 — Concorrência.**
- Entregável: CA-14 (10 × "eu também atendo" com `Promise.all`; 1 `criado`, 9 `ja_atende`, contagem 1) e CA-17 (trava segura por `pg`, espera por `pg_stat_activity`, desativar→reativar ⇒ final `true`; reativar→desativar ⇒ final `false` com sessões revogadas; nenhum 5xx).
- Conclusão: laço ×10 do §8 verde; `timeout` explícito em cada `it`; nenhum `deadlock detected`; conexões `pg` fechadas no `afterAll`.

**T-5 — Componentes cliente.**
- Entregável: §3.6 (componentes e `estado.ts`) com testes jsdom (CA-16).
- Conclusão: `npm run test:unit -- src/app/painel/profissionais` verde; `.tsx`/`estado.ts` sem import de runtime de `@/server/**` além de `@/server/profissionais/tipos`; datas exibidas só como `inicioLocal` (sem formatação local); CSS só com `var(--…)`; todo `*.test.tsx` começa com `/** @vitest-environment jsdom */`; lint e typecheck verdes.

**T-6 — Páginas e casca.**
- Entregável: §3.6 (`page.tsx` ×3, `acoes.ts`); `paginas.test.ts`: gestor renderiza a lista (só salão A, CA-10); profissional → "Acesso negado" nas três páginas (CA-11); sem cookie → redirect `/entrar?proximo=%2Fpainel%2Fprofissionais` (CA-11); id de B, inexistente e malformado → `notFound` (CA-9); casca: criar válido → redirect para a lista; inválido → erros por campo; desativar recusado → estado com reservas; `nao_autenticado` → redirect; `FormData` com campos extras ignorados.
- Conclusão: `npx vitest run --project integration tests/integration/profissionais` verde; `npm run build` verde listando as três rotas; `redirect`/`notFound` fora de `try`; a casca não importa `@/server/repos`; lint e typecheck verdes.

**T-7 — Documentação e gates.**
- Entregável: README, seção "Profissionais" (cadastro, desativação com recusa, efeito em sessões e convites, "eu também atendo", convite pela E1.4); `dev.md` com evidências de todos os gates, cobertura, passo manual de teclado em 375 px (criar → editar → desativar com recusa → reativar) e texto sugerido para o `CLAUDE.md` (comando de estabilidade, padrão `*.acao.ts` + casca, `ExecucaoAcao`).
- Conclusão: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:coverage` (≥ 90%) e `npm run test:e2e` verdes; laço da T-4 ×10 verde.

**T-8 — Validação independente (tester).**
- Entregável: `testes.md` com veredito; repetir os gates e o laço; conferir o mapa abaixo; prova manual com Docker (`docker compose up -d --wait`, cadastro de um gestor por `/cadastro`, profissionais criados pela tela) incluindo teclado e leitor de tela na recusa.

### Mapa CA → tarefa → tipo de teste

| CA | Tarefa(s) | Tipo | Arquivo |
|---|---|---|---|
| CA-1 | T-2, T-3, T-6 | Integração | `repos.test.ts`, `criar-editar.test.ts`, `paginas.test.ts` |
| CA-2 | T-2, T-3 | Integração (nova sessão resolve `profissionalId`) | `repos.test.ts`, `eu-tambem-atendo.test.ts` |
| CA-3 | T-2, T-3, T-5, T-6 | Integração + jsdom | `desativar.test.ts`, `ControleAtivacao.test.tsx`, `paginas.test.ts` |
| CA-4 | T-2, T-3 | Integração | `desativar.test.ts` |
| CA-5 | T-2, T-3 | Integração (login real) | `desativar.test.ts` |
| CA-6 | T-3 | Integração | `eu-tambem-atendo.test.ts` |
| CA-7 | T-2, T-3 | Integração | `repos.test.ts`, `desativar.test.ts` |
| CA-8 | T-3 | Integração (login real) | `desativar.test.ts` |
| CA-9 | T-3, T-6 (+ T-2) | Integração (dois salões) | `isolamento-permissoes.test.ts`, `paginas.test.ts`, `repos.test.ts` |
| CA-10 | T-2, T-3, T-6 | Integração (dois salões) | `repos.test.ts`, `isolamento-permissoes.test.ts`, `paginas.test.ts` |
| CA-11 | T-1, T-3, T-6 | Integração + registro | `pagina-operacao.test.ts`, `isolamento-permissoes.test.ts`, `tenant/registro.test.ts`, `paginas.test.ts` |
| CA-12 | T-1, T-3, T-5 | Unitário + integração + jsdom | `texto.test.ts`, `validacao.test.ts`, `criar-editar.test.ts`, `FormularioProfissional.test.tsx` |
| CA-13 | T-3, T-5 | Integração + jsdom | `criar-editar.test.ts`, `FormularioProfissional.test.tsx` |
| CA-14 | T-2, T-4 | Integração (concorrência ×10) | `repos.test.ts`, `concorrencia.test.ts` |
| CA-15 | T-1, T-2, T-3 | Unitário + integração (relógio injetado) | `define-acao.test.ts`, `repos.test.ts`, `desativar.test.ts` |
| CA-16 | T-5, T-7, T-8 | jsdom + manual | `*.test.tsx`, `dev.md`, `testes.md` |
| CA-17 | T-4 | Integração (concorrência ×10) | `concorrencia.test.ts` |

## Pendências registradas (não bloqueantes)

- §7.3: obrigações para E3.2/E3.4/E3.5, E1.4 e E2.1 (o líder registra nas issues).
- Índice parcial por `fim` para reservas confirmadas, se o histórico por profissional crescer (§4 b).
- E2E com banco quando o seed (E9.2) existir.
