# D-005 — Desenho: escopo de salão no servidor e infraestrutura de testes de integração (issue #7, E0.5)

Autor: arquiteto-software. Entradas: `docs/demandas/D-005/spec.md` (RN-1..RN-16, CA-1..CA-19, S-1..S-9, D-1), `issue-7.md`, `docs/demandas/D-001/{design,dba}.md` (E0.5, E0.7, S13), `docs/demandas/D-004/{design,dev,testes}.md`, `CLAUDE.md`, `PLAN.md` e o código da branch `feat/d-005-escopo-salao` (base `1906605`).

## 0. Sonda executada antes do desenho

Feita num container descartável `postgres:17` (`docker run --rm`, porta 55791, removido no final), fora do compose do projeto e sem tocar em nenhum arquivo do repositório.

| Verificação | Resultado |
|---|---|
| 6 `CREATE DATABASE wN TEMPLATE tpl` **simultâneos** (sessões distintas) | Todos aceitos, entre 94 e 137 ms cada. Workers paralelos podem copiar o mesmo template ao mesmo tempo. |
| Schema extra (`pgboss` com uma tabela) e extensão `btree_gist` no template | Copiados para a base nova. Isso confirma a RN-12 e o ponto de extensão da D-1. |
| `STRATEGY FILE_COPY` × padrão (`WAL_LOG`, PG 15+) numa base pequena | 153 ms × 28 ms. Fica o padrão (`WAL_LOG`). |
| `DROP DATABASE … WITH (FORCE)` com uma sessão ativa na base | Aceito: a sessão é encerrada. Fica sem efeito sobre outras bases. |
| `CREATE DATABASE … TEMPLATE tpl` com **uma** sessão aberta no template | O PostgreSQL **espera até 5 s** a sessão sair. Se ela continua, a cópia falha com `source database "tpl" is being accessed by other users` (SQLSTATE `55006`). Uma conexão esquecida custa 5 s e depois derruba a suíte inteira, e não só um teste. |
| Papel do `POSTGRES_USER` da imagem oficial | `rolsuper = t`, `rolcreatedb = t`: o ambiente local atende ao requisito `CREATEDB`. |

Ferramentas: `maxWorkers` é opção válida por projeto no Vitest 5.1.1 (não consta de `NonProjectOptions`). `VITEST_POOL_ID` vai de 1 a `maxWorkers`. Com `isolate: true` (o padrão), cada arquivo roda num processo novo. A regra **core** `no-restricted-imports` do ESLint 9.39.5 aceita `patterns[].regex` e `allowTypeImports`, então não é preciso usar a variante do typescript-eslint, e o CA-5 cita o id `no-restricted-imports` exatamente. O `pg-pool` usa `max = 10` por padrão.

## 1. Resumo da solução

- **Contextos e erros** (`src/server/tenant/`): `TenantContext`, `SistemaContext`, `PublicoContext` e `AdminContext` são tipos com discriminante `tipo` e marca nominal (`unique symbol` não exportado), criados só por fábricas do próprio módulo. Os erros de domínio `NaoAutenticado` (401), `AcessoNegado` (403) e `NaoEncontrado` (404) têm mensagem e corpo **constantes**, sem nenhum dado do recurso.
- **Sessão**: o cookie `ab_sessao` traz um token opaco, que é procurado na tabela `sessao` pelo hash SHA-256 (hex). A sessão é válida se `expira_em > agora` e `revogada_em IS NULL`. Daí sai `TenantContext` (gestor ou profissional, com `profissionalId` do perfil vinculado) ou `AdminContext` (super admin com `totp_verificado_em`). A consulta fica num repositório de autenticação (`src/server/repos/sessao.ts`). A camada `tenant` nunca importa o Prisma.
- **`defineAcao(config, handler)`** devolve uma ação com dois pontos de entrada: `executar(credencial, input, deps?)` (núcleo puro, sem `next/headers`, com política injetável) e a forma chamável `acao(input)`, usada pelo Next, que lê o cookie e chama o núcleo. A ordem é a da RN-7. O resultado é `ResultadoAcao<O>`: `{ ok: true, dados }` ou `{ ok: false, erro, status }`. Os metadados (`papeis`, `capacidade`) ficam numa propriedade de símbolo legível pelo teste de registro.
- **Repositórios** (`src/server/repos/`): uma fábrica por agregado (`servico`, `profissional`, `cliente`, `reserva`) ligada a um executor (cliente Prisma ou transação). `repos()` devolve o conjunto ligado ao cliente padrão, e `emTransacao(fn)` entrega a `fn` o conjunto ligado a uma transação interativa. Toda operação recebe `ContextoEscopado` (`TenantContext | SistemaContext`) como 1º argumento e põe `salaoId: ctx.salaoId` no `where` da própria consulta. As mutações usam `updateMany({ where: { id, salaoId } })`, e 0 linhas vira `NaoEncontrado`. Um ID que não é UUID dá `NaoEncontrado` **antes** de consultar o banco (CA-8).
- **Leituras públicas** (`src/server/repos/publico.ts`): o slug (atual ou histórico) é resolvido para `PublicoContext`, e os serviços e profissionais **ativos** são listados com campos públicos.
- **Lint**: `no-restricted-imports` (core) proíbe, fora de `src/server/repos/**`, `src/worker/**`, `prisma/seed.ts`, `tests/**` e `**/*.test.{ts,tsx}`, importar `@/generated/prisma/**`, `@prisma/client`, `@prisma/adapter-pg`, `pg` e o módulo da instância (`src/server/repos/db.ts`), também por caminho relativo. `allowTypeImports: true` (S-6).
- **Realocação**: `src/server/db.ts` vai para `src/server/repos/db.ts` (com `configurarPool`). A rota de health passa a usar `bancoDisponivel()` de `src/server/repos/saude.ts`. O `src/server/health.ts` fica onde está (só `import type`).
- **Harness** (`tests/support/`): o `globalSetup` valida as URLs e os nomes derivados (CA-17), apaga bases órfãs de execuções antigas, cria o **template da execução**, aplica `migrate deploy`, roda os **inicializadores de schema** (o ponto de extensão da D-1) e confere que não sobrou conexão no template. O `setupFiles` do projeto `integration` recria, **no início de cada arquivo**, a base do worker (`DROP … WITH (FORCE)` + `CREATE … TEMPLATE`), aponta `DATABASE_URL` do processo de teste para ela e configura o pool (16). O teardown apaga as bases da execução. Os nomes são por execução (S-8), então duas execuções simultâneas não colidem, e a limitação do `README.md:64` deixa de valer.
- **Fábricas e autenticação** de teste via Prisma: dois salões completos (CA-3) e sessões reais de gestor, profissional e super admin.

### 1.1 Alternativas descartadas
| Alternativa | Motivo |
|---|---|
| Transação ambiente por `AsyncLocalStorage` (os repositórios pegam a transação implícita) | Esquecer de estar "dentro" da transação passa em silêncio, e uma promessa que escapa do callback roda fora dela. A fábrica `emTransacao((r) => …)` só entrega repositórios já ligados à transação, então o erro não tem como acontecer. |
| Executor como último parâmetro opcional de cada função de repositório | Fica fácil omitir o `tx` dentro de uma transação. Mesma falha da linha anterior. |
| Extensão do Prisma que injeta `salao_id` | Descartada em D-001/design.md:17: não cobre `$queryRaw` e deixa o filtro implícito. |
| RLS | Descartado em D-001/dba.md (custo de `SET LOCAL` por transação com o pool). |
| `prisma.update({ where: { salaoId_id } })` + tradução do `P2025` | Funciona, mas depende do formato do erro do Prisma 7 (o proxy do cliente já causou problema, D-003/dev.md). `updateMany` + `count` é direto e não toca `atualizado_em` quando 0 linhas casam (CA-2). |
| Validar `id` com `z.uuid()` na entrada da ação | Devolveria 400 para um ID malformado, o que viola o CA-8 (resposta idêntica a 404). A validação fica no repositório e responde `NaoEncontrado`. |
| Nomes fixos por worker (`<base>_w1`…) | Mais simples, mas mantém a limitação de execuções simultâneas (D-004 R-4), e o tester costuma rodar laços longos (CA-6) enquanto o desenvolvedor trabalha. O custo dos nomes por execução é uma varredura de órfãs (§3.6). |
| Usar a própria base de `TEST_DATABASE_URL` como template | O harness precisa de uma conexão administrativa para emitir `CREATE/DROP DATABASE`, e ela não pode estar no template (`55006`, §0). A base de `TEST_DATABASE_URL` vira a **base administrativa**. Nada é criado dentro dela. |
| Reset por `TRUNCATE` ou transação com rollback | É proibido (RN-14). |
| `@typescript-eslint/no-restricted-imports` | Desnecessário: a regra core 9.39.5 já tem `allowTypeImports` e `regex` (§0). |
| Variável de ambiente `DATABASE_POOL_MAX` | Mudaria o esquema de env, o `.env.example` e o teste de chaves da D-003, e envolveria o DevOps sem necessidade. O tamanho do pool é configurado por código: `configurarPool({ max })` nos testes e a constante de produção. |
| Instalar `pg-boss` agora | É a D-1, decidida pelo líder: fica para a E0.7. |

### 1.2 Dependências novas
Nenhuma. `zod`, `pg`, `@types/pg` e `vite` (transitivo do Vitest, para os tipos de `import.meta.glob`) já existem. Os tipos do `import.meta.glob` vêm de `/// <reference types="vite/client" />` no arquivo de teste. Se o `typecheck` não resolver `vite/client` pela árvore atual, o desenvolvedor declara o tipo mínimo localmente e **não** instala pacote.

## 2. Componentes afetados

| Caminho | Mudança | Tarefa |
|---|---|---|
| `src/server/db.ts`, `src/server/db.test.ts` | **Movidos** (`git mv`) para `src/server/repos/db.ts` e `db.test.ts` | T-2 |
| `src/server/repos/db.ts` | + `configurarPool`, `criarPrisma(url, { max })` | T-2 |
| `src/server/repos/saude.ts` (+ teste) | Novo: `bancoDisponivel()` | T-2 |
| `src/app/api/health/route.ts`, `route.test.ts` | Passam a usar `@/server/repos/saude` e `@/server/repos/db` (o teste é liberado pelo padrão `*.test.ts`) | T-2 |
| `tests/integration/health.test.ts` | Import de `@/server/repos/db` (T-2); URL da base do worker (T-3) | T-2 → T-3 |
| `eslint.config.mjs` | Regra `no-restricted-imports` | T-2 |
| `tests/integration/lint/importacao-prisma.test.ts` | Novo (CA-5) | T-2 |
| `tests/integration/support/*` | **Movidos** para `tests/support/` (os testes do harness vão para `tests/integration/harness/`) | T-3 |
| `tests/support/{banco,db,global-setup,setup-arquivo,sql}.ts` | Harness novo/evoluído | T-3 |
| `tests/integration/harness/*.test.ts` | CA-15, CA-16, CA-17 e o CA-21 da D-004 adaptado | T-3 |
| `tests/integration/db/*.test.ts` | Imports de `../../support/…`; `drift.test.ts` usa `urlDoWorker()` | T-3 |
| `vitest.config.ts` | `globalSetup`, `setupFiles` e `maxWorkers` do projeto `integration` | T-3 |
| `src/server/tenant/{context,erros,sessao,politica,define-acao,registro,next}.ts` (+ testes unitários) | Novos | T-4 |
| `src/server/repos/{tipos,ids,transacao,index,servico,profissional,cliente,reserva,sessao,publico}.ts` | Novos | T-4 |
| `tests/support/{factories,auth}.ts` | Novos | T-5 |
| `tests/integration/tenant/**`, `tests/integration/concorrencia/**` | Novos (CA-1..CA-4, CA-6..CA-14, CA-18) | T-5 |
| `README.md`, `CLAUDE.md` (tabela "Comandos e cobertura"), `docs/demandas/D-005/dev.md` | Documentação e evidências | T-6 |

Não mudam: `prisma/**` (nenhuma migração), `docker-compose.yml`, `Dockerfile`, `docker/**`, `.env.example`, `src/server/env.ts`, `src/worker/**`, `src/server/health.ts`, `.github/**`.

## 3. Interfaces

### 3.1 Contextos e erros (`src/server/tenant/context.ts`, `erros.ts`)
```ts
export type Papel = 'gestor' | 'profissional' | 'super_admin';
export type PapelDeSalao = Exclude<Papel, 'super_admin'>;
export const CAPACIDADES = ['leitura', 'configurar', 'agendar', 'cancelar', 'assinatura', 'lgpd'] as const;
export type Capacidade = (typeof CAPACIDADES)[number];

declare const marca: unique symbol;               // não exportado: impede montar contexto por literal
type Marcado<T> = T & { readonly [marca]: true };

export type TenantContext  = Marcado<{ tipo: 'tenant'; usuarioId: string; papel: PapelDeSalao; salaoId: string; profissionalId: string | null }>;
export type SistemaContext = Marcado<{ tipo: 'sistema'; salaoId: string; origem: string }>;   // worker (E7.x)
export type PublicoContext = Marcado<{ tipo: 'publico'; salaoId: string; slugAtual: string }>;
export type AdminContext   = Marcado<{ tipo: 'admin'; usuarioId: string }>;                  // E8.1
export type ContextoEscopado = TenantContext | SistemaContext;   // único aceito pelos repositórios de tenant

// Fábricas (objetos congelados). Só são chamadas em: tenant/sessao.ts (tenant, admin),
// repos/publico.ts (publico) e no worker (sistema). Revisão de código garante isso.
export function criarTenantContext(d: {...}): TenantContext;
export function criarAdminContext(usuarioId: string): AdminContext;
export function criarPublicoContext(salaoId: string, slugAtual: string): PublicoContext;
export function contextoDeSistema(salaoId: string, origem: string): SistemaContext; // valida UUID; senão lança Error
/** Guarda em tempo de execução (defesa além do tipo): lança Error de programação se ctx.tipo ∉ {tenant, sistema}. */
export function exigirEscopo(ctx: ContextoEscopado): string; // devolve salaoId
```
```ts
export type CodigoErro = 'nao_autenticado' | 'acesso_negado' | 'nao_encontrado';
export abstract class ErroDeDominio extends Error { abstract readonly codigo: CodigoErro; abstract readonly status: 401 | 403 | 404; }
export class NaoAutenticado extends ErroDeDominio {}  // 401, mensagem fixa
export class AcessoNegado  extends ErroDeDominio {}   // 403, mensagem fixa (motivo interno opcional, nunca no corpo)
export class NaoEncontrado extends ErroDeDominio {}   // 404, mensagem fixa "Recurso não encontrado"; construtor SEM argumentos
export function respostaDeErro(e: ErroDeDominio): { status: 401 | 403 | 404; corpo: { erro: CodigoErro } };
```
Nenhum construtor de erro recebe ID, nome ou qualquer valor do recurso. Isso cobre o CA-1 ("nenhum dado de B") e o CA-8 ("mesmo corpo").

### 3.2 Sessão (`src/server/tenant/sessao.ts` + `src/server/repos/sessao.ts`)
```ts
// tenant/sessao.ts
export const NOME_COOKIE_SESSAO = 'ab_sessao';
export function hashDoToken(token: string): string;          // SHA-256 hex (node:crypto)
export type Credencial = { token: string } | null;            // token em claro vindo do cookie
export async function resolverTenant(c: Credencial, agora?: Date): Promise<TenantContext>;  // NaoAutenticado | AcessoNegado(super_admin)
export async function resolverAdmin(c: Credencial, agora?: Date): Promise<AdminContext>;    // NaoAutenticado | AcessoNegado(papel ≠ super_admin ou sem TOTP)

// repos/sessao.ts — exceção documentada à RN-8: é pré-contexto (autenticação), recebe só o hash.
export type SessaoValida = { usuarioId: string; papel: Papel; salaoId: string | null; profissionalId: string | null; totpVerificadoEm: Date | null };
export async function buscarSessaoValida(tokenHash: string, agora: Date): Promise<SessaoValida | null>;
// WHERE token_hash = $1 AND expira_em > $agora AND revogada_em IS NULL (expira_em = agora ⇒ expirada)
```
- `profissionalId` é o `profissional.id` em que `usuario_id` é o usuário (UNIQUE `(salao_id, usuario_id)`), sem filtrar `ativo`. O efeito de desativar um profissional com usuário sobre o login fica com a E2.4/E1.2.
- Fora desta demanda (E1.2): criar, renovar e revogar sessão, `ultimo_uso_em`, exigência de `email_confirmado_em` e o atributo do cookie (`Secure`, prefixo `__Host-`). O nome e o hash ficam **só** nessas constantes.

### 3.3 Política e `defineAcao` (`politica.ts`, `define-acao.ts`, `registro.ts`, `next.ts`)
```ts
// politica.ts
export type DecisaoPolitica = { permitido: true } | { permitido: false; motivo: string };
export type PoliticaOperacao = (ctx: TenantContext, capacidade: Capacidade) => DecisaoPolitica | Promise<DecisaoPolitica>;
export const permitirTudo: PoliticaOperacao;
export const politicaDeOperacao: PoliticaOperacao = permitirTudo;   // E6.4 troca esta linha pela política real

// define-acao.ts
export const METADADOS_ACAO: unique symbol;
export type ConfigAcao = { papeis: readonly [PapelDeSalao, ...PapelDeSalao[]]; capacidade: Capacidade }; // ambos obrigatórios (RN-6)
export type ResultadoAcao<O> = { ok: true; dados: O } | { ok: false; erro: CodigoErro; status: 401 | 403 | 404 };
export type DepsAcao = { politica?: PoliticaOperacao; agora?: Date };
export interface Acao<I, O> {
  (input: I): Promise<ResultadoAcao<O>>;                                          // Next: lê o cookie (next.ts) e chama executar
  executar(c: Credencial, input: I, deps?: DepsAcao): Promise<ResultadoAcao<O>>;  // núcleo, sem next/headers
  readonly [METADADOS_ACAO]: Readonly<ConfigAcao>;
}
export function defineAcao<I, O>(config: ConfigAcao, handler: (ctx: TenantContext, input: I) => Promise<O>): Acao<I, O>;
```
Ordem do `executar` (RN-7): `resolverTenant(c, agora)` → `papeis.includes(ctx.papel)` (senão `AcessoNegado`) → `await politica(ctx, capacidade)` (negado → `AcessoNegado`) → `handler(ctx, input)`. Um `ErroDeDominio` lançado em qualquer etapa, **inclusive pelo handler** (p.ex. o `NaoEncontrado` do repositório), vira `{ ok: false, erro, status }`. Qualquer outro erro é relançado (500 no Next). O `input` vai ao handler sem passar por nenhuma transformação. O `salaoId` vem **só** do `ctx` (RN-1). Validar o formato do input fica para a primeira ação real (E2.x), que acrescenta `entrada` (zod) e um erro 400 ao `ConfigAcao`. A E0.5 não antecipa isso.

```ts
// registro.ts
export type ProblemaRegistro = { arquivo: string; exportacao: string; motivo: 'nao_e_acao' | 'sem_capacidade' | 'capacidade_invalida' | 'sem_papeis' };
export function verificarAcoes(modulos: Record<string, Record<string, unknown>>): ProblemaRegistro[];

// next.ts — único arquivo da camada que importa next/headers
export async function lerCredencialDoCookie(): Promise<Credencial>;
export async function exigirContexto(papeis?: readonly PapelDeSalao[]): Promise<TenantContext>; // Server Components; lança NaoAutenticado/AcessoNegado
```
**Convenção `*.acao.ts`**: arquivo com `'use server'` em que **toda** exportação é `export const x = defineAcao(...)`. O teste de registro carrega `import.meta.glob('/src/**/*.acao.ts', { eager: true })` e exige `verificarAcoes(...)` vazio. A E0.5 não cria ações de produto (S-4).

### 3.4 Repositórios (`src/server/repos/`)
```ts
// transacao.ts
export type Executor = PrismaClient | Prisma.TransactionClient;   // tipo interno a repos/**
export async function emTransacao<T>(fn: (r: Repos) => Promise<T>): Promise<T>; // $transaction interativa, READ COMMITTED; qualquer throw → rollback

// index.ts
export interface Repos { servicos: RepoServico; profissionais: RepoProfissional; clientes: RepoCliente; reservas: RepoReserva }
export function repos(): Repos;                     // ligado a obterPrisma()
export function criarRepos(db: Executor): Repos;    // uso interno (emTransacao)

// ids.ts
export function ehUuid(v: unknown): v is string;   // regex 8-4-4-4-12 hex, qualquer versão

// tipos.ts — DTOs e uniões literais; inclui uma asserção de tipo de que StatusReserva (união) ≡ enum do Prisma
export type StatusReserva = 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
export type ServicoDTO = { id; nome; precoCentavos; duracaoMin; ativo; criadoEm; atualizadoEm };
export type ProfissionalDTO = { id; nome; email: string | null; usuarioId: string | null; ativo; ... };
export type ClienteDTO = { id; nome: string | null; telefoneE164: string | null; anonimizadaEm: Date | null; ... };
export type ReservaDTO = { id; profissionalId; clienteId; inicio; fim; ocupadoAte; status; origem; encaixe; revisao; itens: { servicoId; ordem; precoCentavos; duracaoMin }[] };
```
| Repositório | Leitura por ID | Listagem | Mutação por ID (S-9) |
|---|---|---|---|
| `RepoServico` | `buscarPorId(ctx, id)` | `listar(ctx)`: ativos e inativos, por nome | `renomear(ctx, id, nome)` |
| `RepoProfissional` | `buscarPorId(ctx, id)` | `listar(ctx)`: ativos e inativos | `renomear(ctx, id, nome)` |
| `RepoCliente` | `buscarPorId(ctx, id)`: inclui anonimizadas (nome/telefone nulos) | `listar(ctx)`: inclui anonimizadas | `renomear(ctx, id, nome)`, com predicado `anonimizada_em IS NULL` (anonimizada → `NaoEncontrado`) |
| `RepoReserva` | `buscarPorId(ctx, id)` com itens | `listarPorPeriodo(ctx, { de, ate })`: `inicio ∈ [de, ate)` (usa o índice `(salao_id, inicio)`) | `atualizarStatus(ctx, id, { de, para })`, com predicado `status = de` (**primitiva de persistência**: sem ação de produto, sem `cancelada_em`, sem mensagem. A E3.5 compõe cancelar e remarcar sobre ela, com a mensagem na mesma transação) |

Contrato comum (RN-8, RN-9):
1. A 1ª instrução é `const salaoId = exigirEscopo(ctx)`.
2. `!ehUuid(id)` → `throw new NaoEncontrado()` sem consultar.
3. Leitura: `findFirst({ where: { id, salaoId } })`, e `null` vira `NaoEncontrado`.
4. Mutação: `updateMany({ where: { id, salaoId, ...predicado }, data })`. `count === 0` vira `NaoEncontrado`. Depois relê pelo mesmo predicado de salão e devolve o DTO. É proibido "ler, conferir o salão e depois atualizar por `id`".
5. Nenhuma assinatura aceita `salaoId` solto. Os DTOs não expõem `salaoId`, porque o chamador já o conhece pelo contexto.

### 3.5 Leituras públicas (`src/server/repos/publico.ts`) e saúde (`saude.ts`)
```ts
export type ResolucaoSlug = { contexto: PublicoContext; slugAtual: string; historico: boolean };
export async function resolverSalaoPorSlug(slug: string): Promise<ResolucaoSlug>;     // comparação exata; inexistente → NaoEncontrado
export async function listarServicosPublicos(ctx: PublicoContext): Promise<{ id; nome; precoCentavos; duracaoMin }[]>; // ativo = true
export async function listarProfissionaisPublicos(ctx: PublicoContext): Promise<{ id; nome }[]>;                     // ativo = true
// saude.ts
export async function bancoDisponivel(): Promise<boolean>;  // verificarBanco(obterPrisma()); URL ausente → false
```
As consultas públicas usam `select` explícito: nunca `email`, `usuario_id` nem dados de cliente ou reserva (CA-12).

### 3.6 Harness de testes (`tests/support/`)
**Nomes** (RN-13). `base` é o nome da base de `TEST_DATABASE_URL`, e `exec` = `Date.now()` em base 36 (8 caracteres) + 2 caracteres aleatórios em base 36.
- Template: `${base}_r${exec}_tpl`. Base do worker: `${base}_r${exec}_w${VITEST_POOL_ID}`.
- Padrão de órfã: `^${base}_r([0-9a-z]{10})_(tpl|w[0-9]{1,3})$`.
- A URL derivada troca **só** o caminho da URL de teste e preserva usuário, senha, host, porta e query.

```ts
// banco.ts (evolui tests/integration/support/banco.ts; mantém nomeDaBase e urlBancoDeTeste)
export const BASES_DE_SISTEMA = ['postgres', 'template0', 'template1'] as const;
export const NOME_VALIDO = /^[a-z0-9_]{1,63}$/;
export function nomesDaExecucao(base: string, exec: string, maxWorkers: number): { template: string; worker(n: number): string; padraoOrfa: RegExp };
/** Lança Error nomeando a variável (sem valores): TEST_DATABASE_URL ausente; base de teste = base de DATABASE_URL;
 *  base de teste de sistema ou inválida; qualquer nome derivado (até o worker maxWorkers) inválido, > 63, de sistema ou = base de DATABASE_URL. */
export function validarPlanoDeBases(env: { TEST_DATABASE_URL?: string; DATABASE_URL?: string }, exec: string, maxWorkers: number): PlanoDeBases;
export function urlComBase(url: string, nome: string): string;

// db.ts (evolui tests/integration/support/db.ts)
export type InicializadorDeSchema = { nome: string; executar(urlTemplate: string): Promise<void> }; // deve fechar as próprias conexões
export const INICIALIZADORES: InicializadorDeSchema[];  // E0.5: [schemaDeProva] (cria schema harness_extensao + tabela marcador). E0.7 acrescenta pg-boss.
export async function prepararTemplate(plano, inicializadores = INICIALIZADORES): Promise<void>;
export async function recriarBaseDoWorker(): Promise<string>;  // DROP DATABASE IF EXISTS … WITH (FORCE); CREATE DATABASE … TEMPLATE …; devolve a URL
export function urlDoWorker(): string;                         // a partir de inject('bancoDeTeste') + VITEST_POOL_ID
export async function apagarBasesDaExecucao(plano): Promise<void>;
export async function apagarOrfas(plano, agora = Date.now()): Promise<string[]>; // só nomes do padrão com exec mais velho que IDADE_ORFA_MS (6 h)
export const POOL_MAX_TESTES = 16;   // ≥ 12 (CA-2 da E3.2); a soma por execução está em §5
export function binarioPrisma(): string;
export function executarPrisma(args: string[], url: string): { status; stdout; stderr };  // inalterado

// sql.ts (movido; os helpers da D-004 ficam como estão): conectar() passa a usar urlDoWorker();
// + criarPoolPg(max = POOL_MAX_TESTES): pg.Pool na base do worker (para o err.code/err.constraint dos testes de concorrência).
```
**`global-setup.ts`** (projeto `integration`). Faz, em ordem:
1. `validarPlanoDeBases(process.env, exec, maxWorkers)` como **1ª instrução**, antes de qualquer conexão (CA-17).
2. `apagarOrfas`.
3. `CREATE DATABASE template` (pela conexão administrativa à base de `TEST_DATABASE_URL`, com os parâmetros do parecer do DBA).
4. `executarPrisma(['migrate','deploy'], urlTemplate)`.
5. Cada inicializador, em sequência.
6. Confere `pg_stat_activity` sem sessões no template. Se houver, falha nomeando o inicializador, em vez de esperar o `55006`.
7. `project.provide('bancoDeTeste', { urlAdmin, exec, nomes })` e `provide('inicioDoReset', …)`, que é mantido para o CA-22 da D-004.

O teardown devolvido executa `apagarBasesDaExecucao`. O `maxWorkers` lido aqui é o do projeto `integration` (`project.config.maxWorkers`).

**`setup-arquivo.ts`** (`setupFiles` do projeto `integration`; roda antes de cada arquivo):
- Com `await` no nível do módulo: `const url = await recriarBaseDoWorker(); process.env.DATABASE_URL = url; configurarPool({ max: POOL_MAX_TESTES });`.
- `afterAll(encerrarPrisma)`.
- Sobrescrever `DATABASE_URL` no processo de teste é intencional. Todo código de produção chamado pelos testes (`obterPrisma()`) cai na base do worker, e nenhum teste alcança a base de desenvolvimento.

**`vitest.config.ts`** (projeto `integration`): `globalSetup: ['./tests/support/global-setup.ts']`, `setupFiles: ['./tests/support/setup-arquivo.ts']` (somado ao `vitest.setup.ts` da raiz), `maxWorkers: 4` e `fileParallelism: true` (explícito). O projeto `unit` não muda e continua sem exigir banco.

### 3.7 Fábricas e autenticação de teste (`tests/support/factories.ts`, `auth.ts`)
```ts
export type SalaoCompleto = {
  salaoId; slugAtual; slugHistorico;
  gestor: { usuarioId; profissionalId };            // gestor confirmado com perfil de profissional
  profissional: { usuarioId; profissionalId };      // papel profissional
  profissionalInativoId;
  servicos: { ativos: [string, string]; inativoId: string };   // vínculos em servico_profissional
  jornadaIds: string[]; bloqueioId;
  clientes: { ativaId; anonimizadaId };
  reserva: { id; itemIds: string[] };               // confirmado, no futuro (relógio + 7 dias, UTC), itens com snapshot
};
export async function criarSalaoCompleto(sobrescritas?: DeepPartial<...>): Promise<SalaoCompleto>;
export async function criarDoisSaloes(): Promise<{ a: SalaoCompleto; b: SalaoCompleto }>;
// auth.ts
export async function criarSessao(usuarioId: string, o?: { expiraEm?: Date; revogadaEm?: Date | null; totpVerificadoEm?: Date | null }): Promise<{ token: string; credencial: Credencial }>;
export async function credencialDoGestor(s: SalaoCompleto): Promise<Credencial>;
export async function credencialDoProfissional(s: SalaoCompleto): Promise<Credencial>;
export async function criarSuperAdmin(o?: { totpVerificado?: boolean }): Promise<{ usuarioId: string; credencial: Credencial }>;
```
- Tudo é feito via Prisma (`obterPrisma(urlDoWorker())`), sem SQL manual. Valores únicos por chamada: slug, e-mail minúsculo e E.164 BR válido.
- Os clientes Prisma nunca são passados a `expect` (D-003/dev.md:67).
- `criarSessao` gera o token com `randomBytes(32).toString('base64url')` e grava `hashDoToken(token)` (a função de produção).

## 4. Dados

- **Nenhuma** migração, tabela, coluna ou índice novo. As consultas novas usam índices já existentes: `sessao.token_hash` UNIQUE, `@@unique([salaoId, id])` (prefixo `salao_id`) nos quatro agregados, `reserva (salao_id, inicio)`, PK de `salao_slug` e `salao_slug (salao_id)`.
- **DBA acionado só para revisão** (T-1), sem posse de nada em `prisma/`. Ele deve avaliar e registrar em `docs/demandas/D-005/dba.md`:
  1. Os parâmetros do `CREATE DATABASE` do template e das bases de worker. Padrão `template1` × `TEMPLATE template0 ENCODING 'UTF8'` (com locale coerente com o cluster); `STRATEGY` padrão (`WAL_LOG`, §0); se o template deve ser marcado `IS_TEMPLATE`. O dono é o próprio usuário do teste.
  2. `DROP DATABASE … WITH (FORCE)` no reset e no teardown: permissão (mesmo papel, sem superusuário) e efeito sobre outros workers.
  3. O esquema de nomes (§3.6), o limite de 63 bytes, a validação e a **varredura de órfãs** (padrão ancorado, idade mínima de 6 h). Confirmar que ela não alcança a base de desenvolvimento, a administrativa nem as de outra execução em curso.
  4. O orçamento de conexões: `maxWorkers 4 × POOL_MAX_TESTES 16` + 1 conexão administrativa por worker + clientes `pg` dos testes × `max_connections` padrão (100) − reservadas. Confirmar ou ajustar 4 e 16 e o pool de produção (10, o padrão do `pg`).
  5. Os predicados dos repositórios (§3.4) e da sessão (§3.2) frente aos índices existentes (se preciso, com `EXPLAIN` sobre as fábricas). Isolamento `READ COMMITTED` em `emTransacao`.
  6. O contrato dos inicializadores de schema (D-1): rodam depois do `migrate deploy`, cada um fecha as próprias conexões e o harness confere `pg_stat_activity` antes da primeira cópia. O schema de prova (`harness_extensao`) não afeta o diff do Prisma (só `public`).
  7. O requisito `CREATEDB` para a E0.3 (CI) e o papel da base de `TEST_DATABASE_URL`, que passa a ser só administrativa. Os dados antigos da D-004 nela são inofensivos.

## 5. Infraestrutura

- Nenhuma variável de ambiente nova. Não mudam `docker-compose.yml`, `Dockerfile`, initdb nem `.env.example`. O initdb continua criando a base de `TEST_DATABASE_URL`, agora usada como base administrativa.
- O `max_connections` padrão (100) comporta o orçamento do §4, item 4 (no máximo ~4×17 + margem).
- **DevOps dispensado.** Motivo: não há mudança em container, compose, variáveis ou CI, e a CI ainda não existe (E0.3, #5). Os requisitos que a E0.3 herda ficam registrados aqui e no README (T-6):
  - O usuário do banco de teste precisa de `CREATEDB` (com `postgres:17` como service e `POSTGRES_USER`, que é superusuário, isso já vale).
  - `npm run test:integration` roda com até 4 workers, o que exige `max_connections ≥ 100` (o padrão).
  - Nada muda nos comandos.
- Observabilidade: não se aplica.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como é atendida |
|---|---|---|
| Escopo por salão no servidor | **Sim (núcleo da demanda)** | O `salaoId` vem só da sessão (`resolverTenant`). Os repositórios exigem `ContextoEscopado` (tipo + `exigirEscopo` em tempo de execução) e filtram `salao_id` no predicado. O lint impede contornar os repositórios. Os testes de isolamento ficam em CA-1, CA-2, CA-7, CA-8 e CA-12. A defesa no banco (FKs compostas, D-004) continua. |
| Exclusion anti-sobreposição | Sim (teste) | Não muda. O CA-6 a exercita com 12 transações concorrentes reais em workers distintos, e o CA-16 prova que o pool não serializa. |
| UTC + fuso do salão | Parcial | As fábricas gravam instantes UTC no futuro relativo ao relógio. Nenhuma lógica de fuso entra aqui. |
| Adaptadores de integração | Não | Nenhuma integração. |
| Soft deletes / anonimização | **Sim** | Os repositórios de equipe enxergam inativos e anonimizadas (RN-16). O público só vê ativos (CA-12). Não há `delete` em nenhum repositório. `cliente.renomear` recusa anonimizada. |
| Salão suspenso somente leitura | **Viabilizada** | A capacidade é obrigatória no tipo e conferida pelo registro (CA-4). A política plugável é consultada antes do handler (CA-11). A regra real fica com a E6.4, trocando `politicaDeOperacao`. |
| Idempotência de webhooks e mensagens | Não | Fora do escopo. `reserva.atualizarStatus` não gera mensagem e não tem ação: a E3.5 compõe. |
| Auditoria do super admin | Parcial | `AdminContext` exige `super_admin` + TOTP verificado e é recusado pelos repositórios de tenant no tipo (CA-13). `registrarAuditoria` fica com a E8.1. |

## 7. Riscos e decisões

| # | Risco | Mitigação |
|---|---|---|
| R-1 | Uma conexão esquecida no template (inicializador futuro, como o pg-boss) faz toda cópia esperar 5 s e falhar com `55006` (§0). | O contrato do inicializador exige fechar as conexões, e o `globalSetup` confere `pg_stat_activity` e falha **nomeando** o inicializador antes da primeira cópia. |
| R-2 | Esgotar `max_connections` com mais workers ou pools maiores. | `maxWorkers: 4` explícito, pool de 16 e o orçamento revisado pelo DBA (§4.4). As mudanças futuras passam pelo DBA. |
| R-3 | O Vitest ignorar `maxWorkers` por projeto. | O T-3 prova com `VITEST_POOL_ID ≤ 4` registrado. Se não valer, o `maxWorkers` sobe para a raiz (afeta só a velocidade do `unit`) e isso fica registrado no `dev.md`. |
| R-4 | A varredura de órfãs apagar uma base que não deve. | Padrão ancorado com prefixo da base de teste, idade ≥ 6 h codificada no nome, cada nome revalidado pela guarda (nunca o dev nem o de sistema) e teste puro do filtro (CA-17). Revisão do DBA. |
| R-5 | O teardown apaga as bases e os dados somem para depuração. | Aceito. Para depurar, roda-se o arquivo isolado e inspeciona-se a base durante o teste. Fica documentado no README. |
| R-6 | Contexto forjado por literal ou por chamada indevida das fábricas de contexto. | Marca nominal não exportada (um literal não compila), `exigirEscopo` em tempo de execução e fábricas chamadas só nos três módulos do §3.1, conferido em revisão. |
| R-7 | `'use server'` do Next recusar a exportação de função com propriedades. | O Next exige só que a exportação seja função assíncrona, o que ela é. A primeira ação real (E2.x) valida no `build`. O núcleo (`executar`) não depende disso. |
| R-8 | `atualizarStatus` usada para cancelar sem mensagem. | Comentário de contrato no repositório, nenhuma ação a usa nesta demanda e a E3.5 é dona do fluxo. Revisão de código. |
| R-9 | O schema de prova afetar o drift da D-004. | O Prisma inspeciona só `public` (D-001/dba.md E0.7). O `drift.test.ts` roda sobre a base do worker que contém o schema e prova o contrário se falhar. |
| R-10 | Cobertura de `define-acao.ts` (forma chamável) e de `next.ts` depende de `next/headers`. | Testes de integração com `vi.mock('next/headers')` (o cookie é substituído; a sessão vem do PostgreSQL real). Não é mock de banco. |
| R-11 | O teste de lint (ESLint API carregando o `eslint-config-next`) ficar lento. | Instância única de `ESLint` por arquivo e timeout de 60 s. Ele roda no projeto `integration` (fora de `src/**`). |
| R-12 | Um `*.acao.ts` futuro exportar algo que não é ação (tipo, constante). | É o que o CA-4 pega. A convenção diz "só ações" (tipos ficam em outro arquivo). |
| R-13 | O Prisma 7 com `@db.Uuid` lançar erro de driver para ID malformado. | Eliminado pelo `ehUuid` antes da consulta. O CA-8 prova a ausência de `22P02`/500. |

Decisões sobre as suposições da spec:
- **S-1 confirmada**, com ajuste. Todos os helpers vão para `tests/support/`: `banco`, `db`, `global-setup`, `setup-arquivo` e `sql` (o `sql.ts` da D-004 fica para os testes de constraint). Os **testes** do harness ficam em `tests/integration/harness/`, porque o `include` do projeto é `tests/integration/**/*.test.ts`. `tests/integration/support/` deixa de existir.
- **S-2 confirmada**: cookie `ab_sessao` e SHA-256 hex (o token tem 256 bits de entropia, então não precisa de segredo nem de variável nova).
- **S-3 confirmada**: três erros, 401, 403 e 404.
- **S-4 confirmada.**
- **S-5 confirmada**: `leitura` no conjunto `CAPACIDADES`.
- **S-6 confirmada**, com dois acréscimos:
  - (a) `allowTypeImports: true`. Os enums usados como valor fora dos repositórios viram uniões literais (`Papel` em `tenant/context.ts`, `StatusReserva` em `repos/tipos.ts`, com asserção de tipo de equivalência ao enum do Prisma).
  - (b) o pacote `pg` entra na lista restrita, porque também permite consultar sem repositório.
  - Também libera `**/*.test.{ts,tsx}` (testes unitários colocados em `src/`, p.ex. `route.test.ts`), porque teste não é código de produção, o que é coerente com o "`tests/**` liberado".
- **S-7 confirmada.**
- **S-8 resolvida** com nomes por execução, teardown e varredura de órfãs. A limitação do `README.md:64` é removida.
- **S-9 resolvida** conforme a tabela do §3.4.
- **D-1 mantida**: há ponto de extensão e schema de prova, sem pg-boss.

## 8. Estratégia de testes

- **Unitário (`src/**`, sem banco)**:
  - `tenant/erros.test.ts`: mapeamento e corpo constante.
  - `tenant/context.test.ts`: fábricas, congelamento, `exigirEscopo` recusando `admin`/`publico` em tempo de execução, `contextoDeSistema` com UUID inválido.
  - `tenant/registro.test.ts`: `verificarAcoes` com ações criadas em memória.
  - `tenant/define-acao.test.ts`: credencial nula → 401 sem tocar o banco, metadados.
  - `repos/ids.test.ts`.
  - `repos/db.test.ts` (movido + `configurarPool`) e `repos/saude.test.ts` (porta fechada → `false`).
  - `npm run test:unit` continua sem PostgreSQL.
- **Integração (PostgreSQL real)**: todo o restante, conforme o mapa do §9. Cada `it` traz o ID do CA no título.
- **Typecheck como teste**: o CA-13 (`@ts-expect-error`) e o CA-4 (fixture sem capacidade com `@ts-expect-error`) entram no `npm run typecheck`. Se a linha deixar de ser erro, o typecheck falha.
- **Manual (tester)**: o CA-5 (arquivo violador temporário) e o CA-6 (laço de 10 execuções com ≥ 2 workers, registrando `VITEST_POOL_ID` e `current_database()` de cada arquivo).
- **Playwright**: não se aplica (sem UI).
- **Cobertura ≥ 90%**: `src/server/tenant/**` e `src/server/repos/**` entram no gate e são cobertos pelos testes de integração (a medição soma unidade e integração). Sem exclusão nova. Se a medição ficar abaixo, o T-5 e o T-6 acrescentam testes com asserções.

## 9. Tarefas

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | dba | — | T-2, T-4 | `docs/demandas/D-005/dba.md` |
| T-2 | desenvolvedor | — | T-1 | `src/server/db.ts`, `src/server/db.test.ts` (removidos), `src/server/repos/db.ts`, `src/server/repos/db.test.ts`, `src/server/repos/saude.ts`, `src/server/repos/saude.test.ts`, `src/app/api/health/route.ts`, `src/app/api/health/route.test.ts`, `tests/integration/health.test.ts`, `eslint.config.mjs`, `tests/integration/lint/importacao-prisma.test.ts` |
| T-3 | desenvolvedor | T-1, T-2 | T-4 | `tests/integration/support/**` (removidos), `tests/support/{banco,db,global-setup,setup-arquivo,sql}.ts`, `tests/integration/harness/**`, `tests/integration/db/*.test.ts`, `tests/integration/health.test.ts`, `vitest.config.ts` |
| T-4 | desenvolvedor | T-2 | T-3 | `src/server/tenant/**`, `src/server/repos/{tipos,ids,transacao,index,servico,profissional,cliente,reserva,sessao,publico}.ts` (+ `*.test.ts` unitários desses arquivos) |
| T-5 | desenvolvedor | T-3, T-4 | — | `tests/support/{factories,auth}.ts`, `tests/integration/tenant/**`, `tests/integration/concorrencia/**` |
| T-6 | desenvolvedor | T-5 | — | `README.md`, `CLAUDE.md` (só a tabela "Comandos e cobertura" e a nota do banco de teste), `docs/demandas/D-005/dev.md` |
| T-7 | tester | T-6 | — | `docs/demandas/D-005/testes.md` |

O `tests/integration/health.test.ts` passa por T-2 e depois por T-3, que é sequencial (T-3 depende de T-2), então nunca tem dois donos na mesma rodada. O T-3 e o T-4 são paralelos e não compartilham arquivo.

**T-1 — Parecer do DBA.**
- Entregável: o `dba.md` respondendo aos itens 1 a 7 do §4, com os parâmetros finais do `CREATE DATABASE`, os valores de `maxWorkers` e pool e o aceite ou ajuste da varredura de órfãs.
- Critério de conclusão: cada item tem decisão explícita. Ajustes que mudem o §3.6 ou o §3.4 são devolvidos ao arquiteto (Revisão 1) ou registrados como "aceito com ajuste X", que o T-3 e o T-4 aplicam.

**T-2 — Realocar o cliente Prisma e criar a regra de lint.**
- Entregável:
  - §3.5 (`saude.ts`) e `db.ts` movido, com `configurarPool({ max })` e `criarPrisma(url, { max? })` (padrão de produção 10, explícito).
  - A regra do §1, configurada para `**/*.{ts,tsx,mts,js,mjs}` com os `ignores` listados.
  - O CA-5 automatizado: `ESLint#lintText` com `filePath` simulado. Erro `no-restricted-imports` para `src/app/x.ts` e `src/server/tenant/x.ts` importando `@/generated/prisma/client`, `@prisma/client`, `@prisma/adapter-pg`, `pg`, `@/server/repos/db` e `../repos/db`/`../../generated/prisma/client`. Nenhum erro para `src/server/repos/x.ts`, `src/worker/x.ts`, `prisma/seed.ts`, `tests/x.test.ts`, `src/app/x.test.ts` e para `import type { PrismaClient } from '@/generated/prisma/client'` em `src/server/x.ts`.
- Critério de conclusão: `lint` (sem `eslint-disable` dessa regra), `typecheck`, `build`, `test:unit` sem banco e o teste do CA-5 passando. `health.test.ts` verde no harness antigo.

**T-3 — Harness por worker.**
- Entregável: §3.6 completo e a migração dos testes da D-004 (imports, `conectar()`/`drift` na base do worker, `inject('inicioDoReset')` preservado). Testes em `tests/integration/harness/`:
  - `banco.test.ts`: o atual + o CA-17 puro (ausente, igual ao dev, de sistema, derivado > 63, derivado = dev, filtro de órfãs com nomes alheios, recentes e antigos).
  - `template.test.ts`: o CA-17 "antes de qualquer conexão" com porta fechada, como o CA-21 da D-004; o CA-15 (`salao` vazio, 3 migrações, `harness_extensao` presente, `current_database()` = nome do worker; depois insere, chama `recriarBaseDoWorker()` e volta vazio).
  - `pool.test.ts`: o CA-16, com 12 `pg_sleep(1)` via `obterPrisma()` e 12 backends ativos simultâneos em `pg_stat_activity`. Controle: com `configurarPool({ max: 2 })` num cliente novo, no máximo 2.
- Critério de conclusão: `npm run test:integration` passa duas vezes seguidas e **duas execuções simultâneas** passam (em dois terminais). Nenhuma base `*_r*` sobra depois (`SELECT datname FROM pg_database`). `grep -rE "TRUNCATE|migrate reset|db push" tests/support` vazio. `test:unit` sem banco. `lint`/`typecheck` OK. `VITEST_POOL_ID` ≤ 4 registrado (R-3). Os ajustes do T-1 aplicados.

**T-4 — Núcleo tenant e repositórios.**
- Entregável: §3.1 a §3.5 e os testes unitários do §8.
- Critério de conclusão:
  - `lint`, `typecheck`, `build` e `test:unit` passam.
  - Nenhum arquivo de `src/server/tenant/**` importa o Prisma (o lint garante).
  - Nenhuma função de repositório recebe `salaoId` solto (revisão + `grep -n "salaoId:" src/server/repos/*.ts` só em `where` derivados de `exigirEscopo`).
  - Os ajustes do T-1 sobre predicados aplicados.

**T-5 — Fábricas, autenticação e testes dos CAs.**
- Entregável: §3.7 e os arquivos:
  - `tenant/fabricas.test.ts`: o CA-3.
  - `tenant/isolamento.test.ts`: CA-1, CA-2, CA-7 e CA-8, por agregado, **só com fábricas**.
  - `tenant/define-acao.test.ts`: CA-9 (a–f), CA-10, CA-11 e a forma chamável com `next/headers` substituído.
  - `tenant/publico.test.ts`: o CA-12.
  - `tenant/contextos.test.ts`: o CA-13 (com `@ts-expect-error` e `SistemaContext` aceito).
  - `tenant/transacao.test.ts`: o CA-14.
  - `tenant/exigir-contexto.test.ts`: o CA-18.
  - `tenant/registro.test.ts` + `tenant/fixtures/registro/{valida,sem-capacidade,sem-define-acao,capacidade-invalida}.acao.ts`: o CA-4.
  - `concorrencia/reserva-paralela-a.test.ts` e `-b.test.ts`: o CA-6, com `criarPoolPg(12)`, 12 `INSERT` simultâneos, exatamente 1 aceito e 11 `23P01`/`reserva_sem_sobreposicao`, `salao` contendo só os ids do arquivo e registro de `VITEST_POOL_ID` e `current_database()`.
- Critério de conclusão:
  - Todos os testes passam.
  - `grep -nE "INSERT|\$executeRaw|\$queryRaw" tests/integration/tenant/isolamento.test.ts` vazio.
  - O CA-2 compara a linha completa de B por SQL direto (antes e depois).
  - `npm run test:coverage` ≥ 90% de linhas sem exclusão nova.

**T-6 — Documentação e fechamento.**
- Entregável:
  - README: estratégia template/worker/execução, `CREATEDB`, orçamento de conexões, remoção da limitação de execuções simultâneas, convenção `*.acao.ts` e `defineAcao`, regra de lint e como depurar (R-5).
  - `CLAUDE.md`: linhas de `test:integration` e "Teste único" coerentes.
  - `dev.md`: gates e evidências, incluindo o laço de 10 execuções do CA-6 (`for i in $(seq 10); do npx vitest run --project integration tests/integration/concorrencia --maxWorkers=2 || break; done`).
- Critério de conclusão: `lint`, `typecheck`, `build`, `npm test` e `test:coverage` ≥ 90% passam, e o laço de 10 fica com código 0 em todas.

**T-7 — Validação independente (tester).**
- Entregável: o `testes.md` com o veredito.
- Critério de conclusão:
  - Todos os CAs com evidência.
  - O CA-5 manual (`src/app/viola.ts` temporário → `npm run lint` ≠ 0).
  - O CA-6 em 10 execuções com workers distintos comprovados.
  - O CA-17 com a base de dev intacta (contagem de `_prisma_migrations` antes e depois).
  - Duas execuções simultâneas de `test:integration`.
  - Mutações sugeridas:
    - remover `salaoId` do `where` de um repositório → CA-1/CA-2 falham;
    - política que ignora a capacidade → CA-11 falha;
    - `configurarPool({ max: 1 })` → CA-16 falha;
    - inicializador que deixa a conexão aberta → `globalSetup` falha nomeando-o.

### Mapa CA → tarefa → tipo de teste
| CA | Tarefa | Tipo |
|---|---|---|
| CA-1, CA-2, CA-7, CA-8 | T-4 (repos), T-5 (`isolamento.test.ts`) | Integração |
| CA-3 | T-5 (`fabricas.test.ts` + `grep` no `isolamento.test.ts`) | Integração + verificação estática |
| CA-4 | T-4 (`registro.ts`), T-5 (`registro.test.ts` + fixtures) | Integração (pura) + typecheck |
| CA-5 | T-2 (`importacao-prisma.test.ts`), T-7 (manual) | Integração (ESLint API) + manual |
| CA-6 | T-5 (`concorrencia/*`), T-6 e T-7 (laço de 10) | Integração + execução repetida |
| CA-9, CA-10, CA-11 | T-4, T-5 (`define-acao.test.ts`) | Unitário (credencial nula) + integração |
| CA-12 | T-4 (`publico.ts`), T-5 (`publico.test.ts`) | Integração |
| CA-13 | T-4, T-5 (`contextos.test.ts`) | Integração + typecheck + unitário (`exigirEscopo`) |
| CA-14 | T-4 (`transacao.ts`), T-5 (`transacao.test.ts`) | Integração |
| CA-15 | T-3 (`harness/template.test.ts`) | Integração |
| CA-16 | T-2 (`configurarPool`), T-3 (`harness/pool.test.ts`) | Integração |
| CA-17 | T-3 (`harness/banco.test.ts`, `template.test.ts`), T-7 (manual) | Integração (pura e porta fechada) + manual |
| CA-18 | T-4 (`next.ts`), T-5 (`exigir-contexto.test.ts`) | Integração com `next/headers` substituído |
| CA-19 | T-3 (migração dos testes da D-004), T-6 (gates) | Gates completos |
