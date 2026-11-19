# D-010 — Desenho: login, sessão em cookie httpOnly e permissões por perfil (issue #12, E1.2)

Autor: arquiteto-software. Entradas: `docs/demandas/D-010/spec.md` (RN-1..RN-25, CA-1..CA-20, D-1..D-14), `issue-12.md`, `PLAN.md` ("Perfis e acesso", "Interface", "Direção técnica"), `CLAUDE.md`, `docs/demandas/D-001/design.md` (sessão própria em tabela, `@node-rs/argon2`), `docs/demandas/D-005/` (camada de escopo), `docs/demandas/D-007/design.md` (critério de idade de dependência: 2 semanas), `docs/demandas/D-009/design.md` (formato, layouts, axe) e o código da branch `feat/d-010-login-sessao` (= `main` em `b37c67e`).

## 0. Verificações feitas antes do desenho

A sonda do argon2 rodou na pasta de rascunho da sessão, fora do repositório. Nada foi instalado nem alterado no repositório.

| Verificação | Resultado |
|---|---|
| `@node-rs/argon2` (hoje: 2026-11-19; corte de 2 semanas: 2026-11-05) | `2.2.2`, publicada em 2026-10-06 (44 dias), licença MIT. **Sem script de instalação** (`npm view … scripts`: só `build`, `bench`, `version`, `artifacts`, `prepublishOnly`): nada a aprovar em `allowScripts`. Binários pré-compilados como `optionalDependencies` por plataforma; `@node-rs/argon2-linux-x64-gnu` declara `os=linux`, `cpu=x64`, `libc=glibc`, compatível com `node:24-trixie-slim` (Debian, glibc) e com o `ubuntu-latest` da CI. |
| Formato e custo | `hash('señha 🙂', { memoryCost: 19456, timeCost: 2, parallelism: 1 })` → `$argon2id$v=19$m=19456,t=2,p=1$…` (o **algoritmo padrão já é argon2id**), ≈ 13 ms; `verify` ≈ 12 ms nesta máquina. |
| `verify` com hash malformado | `verify('hash-de-teste-sem-uso', …)` e `verify('', …)` **lançam** `Error('Decoding failed')`. `senha.ts` precisa capturar e devolver `false` (RN-8, CA-13). |
| `Algorithm` | É `declare const enum` no `index.d.ts`: com `isolatedModules` não deve ser importado. Usar o padrão (argon2id) e provar pelo prefixo no CA-13. |
| Next 16.4.6 `proxy.ts` | `node_modules/next/dist/docs/.../proxy.md:257`: o proxy roda no runtime Node por padrão; `runtime` não é configurável no arquivo. `src/proxy.ts` (ao lado de `src/app`). |
| `forbidden()` / `authInterrupts` | `docs/.../authInterrupts.md`: `version: canary`; `forbidden.md`: `version: experimental`. Ver D-9 (§7.1). |
| `serverExternalPackages` | `@node-rs/argon2` já está na lista padrão do Next (spec §1): o `next.config.ts` não muda. |
| Uso de `buscarSessaoValida` e do tipo `SessaoValida` | Só `src/server/tenant/sessao.ts:26`. Nenhum teste importa o tipo. |
| `senhaHash` fictício | `tests/support/factories.ts:61,98,122` e `tests/support/auth.ts:59`. |
| Testes que dependem de `expira_em` de sessão de teste | `tests/integration/tenant/define-acao.test.ts:74-81`, `contextos.test.ts:54`, `exigir-contexto.test.ts:53`: todos testam expiração (filtrada **antes** de renovar). A renovação (RN-10) não os quebra: só renova sessão ainda válida. |
| `/painel` e `/entrar` sem banco | Sem cookie, nenhum caminho consulta o banco; os módulos importados só abrem conexão sob demanda (`obterPrisma()` lê `DATABASE_URL` na chamada). O E2E sem PostgreSQL continua possível. |
| Job `docker` da CI | Só `docker compose config` e `docker build --target final` (`ci.yml:165-175`). Não executa a imagem. |

## 1. Resumo da solução

- **Núcleo puro em `src/server/auth/`** (sem `next/*`, testável em unidade): `senha.ts` (argon2id), `validade.ts` (constantes e cálculo de expiração), `cookie.ts` (nome e atributos do cookie), `destino.ts` (`proximo` seguro) e `permissoes.ts` (matriz por papel e operação, mais auxiliares de escopo "próprio").
- **Núcleo com banco em `src/server/auth/`** (testável em integração, sem `next/*`): `sessao.ts` (criar, encerrar, revogar todas) e `login.ts` (validação, rate limit, verificação de senha com custo uniforme, regras de status, criação da sessão). O acesso ao banco passa por repositórios novos ou estendidos em `src/server/repos/` (`sessao.ts`, `usuario.ts`, `rate-limit.ts`).
- **Resolução da sessão** (`src/server/tenant/sessao.ts`): passa a renovar a validade no uso (no máximo uma escrita por hora, por `UPDATE` condicional) e a tratar como 401 o profissional com perfil inativo ou ausente (RN-14).
- **Casca Next**: `src/proxy.ts` (otimista: só a presença do cookie em `/painel/**`), `src/server/auth/pagina.ts` (único arquivo de `auth/` que importa `next/navigation`: redireciona 401 para `/entrar?proximo=…` e devolve "negado" para 403), página `/entrar` com formulário de ação de servidor (`useActionState`), ação de logout por POST, `/painel` mínimo com `PanelLayout`, nome do salão, nome do usuário e "Sair".
- **Suporte de teste**: fábricas com hash argon2id real (senha conhecida), opções para profissional desativado com usuário e e-mail não confirmado; auxiliar de login real.

### 1.1 Alternativas descartadas
| Alternativa | Motivo |
|---|---|
| Auth.js / Lucia / iron-session | `D-001/design.md:18` decidiu sessão própria em tabela (revogável, sem JWT). As peças já existem (`sessao`, `hashDoToken`, `resolverTenant`); uma biblioteca traria modelo de sessão próprio a conciliar. |
| `bcrypt` / `argon2` (node-gyp) | `bcrypt` não é argon2id (OWASP prefere argon2id); o pacote `argon2` compila com `node-gyp` e exige script de instalação (`allowScripts`) e toolchain na imagem. `@node-rs/argon2` traz binário pré-compilado sem script. |
| Rate limit "ler, verificar, depois incrementar" | Uma rajada paralela leria o mesmo contador abaixo do limite e verificaria a senha N vezes. Incremento atômico **antes** da verificação (reserva) limita estritamente; o sucesso devolve a reserva (D-3 ajustada, §7.1). |
| `upsert` do Prisma com `increment` para o rate limit | O Prisma só usa `ON CONFLICT` nativo em casos restritos; no caminho genérico faz `SELECT` + `INSERT`, que sob concorrência pode lançar `P2002`. Um `INSERT … ON CONFLICT DO UPDATE … RETURNING` por `$queryRaw` é atômico e usa a PK existente (CA-12). |
| Renovar sessão regravando o cookie | Server Components não gravam cookie. O cookie tem `Max-Age` do teto (30 d) e o servidor decide pela `expira_em` (D-1). |
| Lógica de autorização no proxy | O proxy não deve acessar banco (RN-16; documentação do Next desaconselha autorização só no proxy). A autorização real fica em `defineAcao`/`exigirContexto`/`pagina.ts`. |
| `forbidden()` com `experimental.authInterrupts` | API marcada como experimental/canary; a única fonte de 403 em página nesta demanda é sessão de super admin em `/painel`. Ver D-9. |
| Logout por rota `GET /sair` | Vulnerável a CSRF por link/imagem (RN-12). Ação de servidor por POST, com a checagem de origem do Next. |
| Logout por Route Handler `POST` | Route Handlers não têm a checagem de `Origin` das ações de servidor; a ação já resolve (CSRF por `SameSite=Lax` + `Origin`). |
| Pasta `tests/unit/` | D-12: o projeto `unit` só coleta `src/**/*.test.ts(x)`. Seguir a convenção evita mexer no `vitest.config.ts`. |
| Checar autenticação no `src/app/painel/layout.tsx` | Layouts não re-renderizam na navegação entre páginas filhas; a checagem fica em cada página (via `pagina.ts`), perto do dado. |

### 1.2 Dependência nova
- `@node-rs/argon2` **2.2.2** em `dependencies` (usada em tempo de execução pela app), versão exata (`.npmrc` `save-exact=true`). Justificativa: `D-001/design.md:28` e RN-23. Licença MIT. Sem script de instalação. Os binários de plataforma entram no `package-lock.json` como opcionais; `npm ci` instala só o da plataforma.

## 2. Componentes afetados

| Caminho | Tipo | O que muda |
|---|---|---|
| `package.json`, `package-lock.json` | config | `@node-rs/argon2@2.2.2` |
| `src/server/auth/senha.ts` (+ `.test.ts`) | novo, puro | hash/verificação argon2id; hash fictício para custo uniforme |
| `src/server/auth/validade.ts` (+ teste) | novo, puro | 7 d / 30 d / 1 h; cálculos de expiração |
| `src/server/auth/cookie.ts` (+ teste) | novo, puro | `NOME_COOKIE_SESSAO` (movido), atributos de gravação e de apagamento |
| `src/server/auth/destino.ts` (+ teste) | novo, puro | `destinoAposLogin(proximo)` |
| `src/server/auth/permissoes.ts` (+ teste) | novo, puro | matriz, `pode`, `exigirPermissao`, `filtroDeProfissional` |
| `src/server/repos/sessao.ts` | alterado | leitura com `profissional.ativo`, `criadoEm`, `ultimoUsoEm`, `id`; criar, renovar, revogar |
| `src/server/repos/usuario.ts` | novo | usuário para login (pré-contexto); identidade do painel (escopada) |
| `src/server/repos/rate-limit.ts` | novo | incremento/decremento atômico de `rate_limit_janela` |
| `src/server/tenant/sessao.ts` (+ `.test.ts`) | alterado | renovação; RN-14; `NOME_COOKIE_SESSAO` reexportado de `auth/cookie.ts` |
| `src/server/auth/sessao.ts` | novo | `gerarToken`, `iniciarSessao`, `encerrarSessao`, `revogarSessoesDoUsuario` |
| `src/server/auth/login.ts` | novo | serviço de login (`entrar`) e mensagens |
| `src/server/auth/pagina.ts` | novo | `exigirAcessoAoPainel`, `destinoSeJaAutenticado` (usa `next/navigation`) |
| `src/proxy.ts` (+ `src/proxy.test.ts`) | novo | proxy otimista de `/painel/**` |
| `src/app/(publico)/entrar/estado.ts` | novo | tipo e estado inicial do formulário (sem import de servidor) |
| `src/app/(publico)/entrar/FormularioEntrar.tsx` (+ `.module.css`, `.test.tsx`) | novo, cliente | formulário com `useActionState` |
| `src/app/(publico)/entrar/page.tsx` | novo | página `/entrar` (`PublicLayout`) |
| `src/app/(publico)/entrar/acoes.ts` | novo, `'use server'` | `entrarAcao` (grava cookie e redireciona) |
| `src/app/painel/page.tsx` | novo | painel mínimo |
| `src/app/painel/acoes.ts` | novo, `'use server'` | `sairAcao` |
| `src/app/painel/_componentes/AreaUsuario.tsx`, `AcessoNegado.tsx` (+ `.module.css` se preciso) | novos | área do usuário com "Sair"; tela de acesso negado |
| `tests/support/factories.ts` | alterado | hash real, `SENHA_DE_TESTE`, opções de inativo/não confirmado |
| `tests/support/auth.ts` | alterado | super admin com hash real; `entrarDeVerdade` |
| `tests/integration/auth/*.test.ts` | novos | CA-1..CA-5, CA-10, CA-12, CA-14..CA-17, CA-19 |
| `e2e/entrar.spec.ts` | novo | CA-18 (e proxy real, CA-9) |
| `README.md` | alterado | seção de login |

Não mudam: `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `playwright.config.ts`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`, `src/server/env.ts`, `prisma/**`, `src/components/**`, `src/config/navegacao.ts`, `src/server/tenant/define-acao.ts`, `next.ts`, `erros.ts`, `context.ts`.

## 3. Interfaces

### 3.1 `src/server/auth/senha.ts` (RN-8, RN-23; CA-13)
```ts
/** Parâmetros OWASP mínimos (D-4). O algoritmo é o padrão do @node-rs/argon2 (argon2id). */
export const PARAMETROS_ARGON2 = Object.freeze({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
export async function gerarHashSenha(senha: string): Promise<string>;           // PHC "$argon2id$v=19$m=19456,t=2,p=1$…"
export async function verificarSenha(hash: string, senha: string): Promise<boolean>; // malformado/vazio → false, nunca lança
/** Hash PHC fixo (literal no código) de um valor aleatório, com os MESMOS parâmetros. */
export const HASH_FICTICIO: string;
export type VerificadorSenha = (hash: string, senha: string) => Promise<boolean>;
```
- Único arquivo que importa `@node-rs/argon2` (o desenvolvedor gera o `HASH_FICTICIO` uma vez com `gerarHashSenha` de um valor aleatório descartado e cola o literal). O teste exige que `HASH_FICTICIO` comece com `$argon2id$v=19$m=19456,t=2,p=1$` (mesmo custo da verificação real) e que nenhuma senha usada nos testes o verifique.
- Não importar `Algorithm` (const enum). Não aparar nem normalizar a senha (RN-6).

### 3.2 `src/server/auth/validade.ts` (RN-10; D-1)
```ts
export const INATIVIDADE_MS = 7 * DIA_MS;
export const TETO_MS = 30 * DIA_MS;
export const INTERVALO_RENOVACAO_MS = 60 * 60 * 1000;
export function expiracaoInicial(agora: Date): Date;                        // agora + 7 d
export function precisaRenovar(ultimoUsoEm: Date | null, agora: Date): boolean; // null ou < agora − 1 h
export function novaExpiracao(criadoEm: Date, agora: Date): Date;           // min(agora + 7 d, criadoEm + 30 d)
```
Sem imports.

### 3.3 `src/server/auth/cookie.ts` (RN-11; CA-7)
```ts
export const NOME_COOKIE_SESSAO = 'ab_sessao';
export type AtributosCookie = { httpOnly: true; sameSite: 'lax'; path: '/'; secure: boolean; maxAge: number };
export function atributosCookieSessao(nodeEnv: string | undefined = process.env.NODE_ENV): AtributosCookie; // maxAge = TETO_MS / 1000
export function atributosCookieApagado(nodeEnv?: string | undefined): AtributosCookie;                     // mesmos, maxAge 0
```
- `secure = nodeEnv === 'production'` (D-2). Sem `domain`, sem `expires`. Único import permitido: `./validade`.
- `src/server/tenant/sessao.ts` passa a fazer `export { NOME_COOKIE_SESSAO } from '@/server/auth/cookie'` (os testes existentes continuam importando de lá). O proxy importa de `auth/cookie.ts` para não puxar Prisma para o bundle do proxy.

### 3.4 `src/server/auth/destino.ts` (RN-15; CA-8)
```ts
export function destinoAposLogin(proximo: unknown): string; // sempre um caminho interno; padrão ROTAS.painel
```
Algoritmo (falha fechada para `/painel`):
1. Não é `string`, vazio ou com mais de 2048 caracteres → `/painel`.
2. Não começa com `/`, começa com `//`, contém `\` ou caractere de controle (`[\u0000-\u001F\u007F]`) → `/painel`.
3. `const u = new URL(proximo, 'http://destino.invalid')`; se `u.origin !== 'http://destino.invalid'` → `/painel`. O parser WHATWG resolve `..`, `.`, `%2e%2e` etc.
4. Se `u.pathname !== '/painel'` e não começa com `/painel/` → `/painel`.
5. Devolve `u.pathname + u.search` (sem `hash`).
Assim `/painel/../admin` e `/painel/%2e%2e/admin` viram `/admin` no passo 3 e são recusados no 4. Importa só `ROTAS` (`@/config/navegacao`).

### 3.5 `src/server/auth/permissoes.ts` (RN-3, RN-18; CA-11)
```ts
export const OPERACOES = [
  'painel.acessar', 'agenda.ver', 'reserva.criar', 'reserva.alterar',
  'bloqueio_profissional.gerir', 'bloqueio_salao.gerir', 'jornada.editar',
  'servico.gerir', 'profissional.gerir', 'cliente.gerir',
  'salao.configurar', 'assinatura.gerir', 'plataforma.administrar',
] as const;
export type Operacao = (typeof OPERACOES)[number];
export type Escopo = 'salao' | 'proprio' | 'plataforma' | 'negado';
/** Congelada em profundidade. Tabela exatamente a da RN-18 (spec §4), com os nomes acima. */
export const MATRIZ: Readonly<Record<Operacao, Readonly<Record<Papel, Escopo>>>>;
/** Falha fechada: papel ou operação fora dos conjuntos (inclusive 'toString', '__proto__', undefined) → 'negado'. Usa Object.hasOwn. */
export function pode(papel: unknown, operacao: unknown): Escopo;
/**
 * Lança AcessoNegado se: escopo 'negado'/'plataforma'; ou 'proprio' e ctx.profissionalId é null;
 * ou 'proprio', `alvo` informado e alvo.profissionalId !== ctx.profissionalId.
 * 'proprio' sem `alvo` = checagem de operação (o chamador restringe a consulta com filtroDeProfissional).
 */
export function exigirPermissao(ctx: TenantContext, operacao: Operacao, alvo?: { profissionalId: string | null }): void;
/** Para listagens: 'salao' → { todos: true }; 'proprio' → { profissionalId: ctx.profissionalId } (null → AcessoNegado); demais → AcessoNegado. */
export function filtroDeProfissional(ctx: TenantContext, operacao: Operacao): { todos: true } | { profissionalId: string };
```
- Linhas da RN-18 → operações: acessar o painel → `painel.acessar`; ver agenda → `agenda.ver`; criar reserva manual/encaixe → `reserva.criar`; remarcar/cancelar/marcar status → `reserva.alterar`; bloqueios de profissional → `bloqueio_profissional.gerir`; bloqueios do salão → `bloqueio_salao.gerir`; jornada → `jornada.editar`; serviços → `servico.gerir`; profissionais e convites → `profissional.gerir`; clientes → `cliente.gerir`; configurações → `salao.configurar`; assinatura → `assinatura.gerir`; painel da plataforma → `plataforma.administrar` (super_admin: `plataforma`; demais: `negado`).
- A matriz é por papel; o estado do salão continua na `capacidade` de `defineAcao` (E6.4). `defineAcao` não muda nesta demanda: os consumidores (E2.x, E3.x) chamam `exigirPermissao` no handler. Recurso de outro salão continua 404 (o repositório filtra antes, D-5).

### 3.6 Repositórios (`src/server/repos/`)
`sessao.ts` (pré-contexto, recebe só hash/ids; exceção documentada à RN-8 da D-005, como hoje):
```ts
export type SessaoValida = {
  sessaoId: string; usuarioId: string; papel: Papel; salaoId: string | null;
  profissionalId: string | null; profissionalAtivo: boolean | null; // null = sem perfil vinculado
  totpVerificadoEm: Date | null; criadoEm: Date; ultimoUsoEm: Date | null;
};
export async function buscarSessaoValida(tokenHash: string, agora: Date): Promise<SessaoValida | null>; // filtro atual inalterado
export async function criarSessao(d: { usuarioId: string; tokenHash: string; agora: Date; expiraEm: Date }): Promise<void>;
  // grava criadoEm = agora e ultimoUsoEm = agora EXPLICITAMENTE (não o default now() do banco: CA-14 injeta o relógio)
export async function renovarSessao(d: { sessaoId: string; agora: Date; expiraEm: Date; usoAnteriorA: Date }): Promise<boolean>;
  // updateMany WHERE id AND revogada_em IS NULL AND expira_em > agora AND (ultimo_uso_em IS NULL OR ultimo_uso_em < usoAnteriorA)
  // SET ultimo_uso_em = agora, expira_em = expiraEm → count === 1. Condicional: concorrentes geram no máximo uma escrita.
export async function revogarSessaoPorHash(tokenHash: string, agora: Date): Promise<number>;   // WHERE token_hash AND revogada_em IS NULL
export async function revogarSessoesDoUsuario(usuarioId: string, agora: Date): Promise<number>; // WHERE usuario_id AND revogada_em IS NULL
```
`usuario.ts`:
```ts
/** Pré-contexto (login): busca por e-mail já normalizado. Exceção documentada à RN-8 (como sessao.ts). */
export type UsuarioParaLogin = { id: string; papel: Papel; senhaHash: string; emailConfirmado: boolean; profissionalAtivo: boolean | null };
export async function buscarUsuarioParaLogin(email: string): Promise<UsuarioParaLogin | null>;
/** Escopada: WHERE id = ctx.usuarioId AND salao_id = exigirEscopo(ctx); exige ctx.tipo === 'tenant'; ausente → NaoEncontrado. */
export type IdentidadePainel = { nomeUsuario: string; nomeSalao: string };
export async function buscarIdentidadeDoPainel(ctx: TenantContext): Promise<IdentidadePainel>;
```
`rate-limit.ts` (genérico; a E4.2 reaproveita):
```ts
/** INSERT … VALUES (chave, janela, 1) ON CONFLICT (chave, janela_inicio) DO UPDATE SET contador = rate_limit_janela.contador + 1 RETURNING contador. */
export async function incrementarJanela(chave: string, janelaInicio: Date): Promise<number>;
/** UPDATE … SET contador = GREATEST(contador - 1, 0) WHERE chave AND janela_inicio. */
export async function decrementarJanela(chave: string, janelaInicio: Date): Promise<void>;
```
`$queryRaw`/`$executeRaw` em template marcado (parâmetros vinculados), como `sim-whatsapp.ts`. Nenhum DTO expõe `senhaHash` fora de `UsuarioParaLogin`, que só o `login.ts` consome.

### 3.7 `src/server/tenant/sessao.ts` (RN-10, RN-14; CA-5, CA-14)
`sessaoDaCredencial(c, agora)`:
1. Sem token → `NaoAutenticado` (sem banco, como hoje).
2. `buscarSessaoValida(hashDoToken(token), agora)`; nula → `NaoAutenticado`.
3. Se `precisaRenovar(s.ultimoUsoEm, agora)` → `renovarSessao({ sessaoId, agora, expiraEm: novaExpiracao(s.criadoEm, agora), usoAnteriorA: agora − 1 h })` (resultado ignorado; vale para sessões de salão e de admin; a E1.5 pode especializar o admin).

`resolverTenant`: depois da checagem atual de papel de salão, se `papel === 'profissional'` e `profissionalAtivo !== true` → `NaoAutenticado` (RN-14; 401, não 403). Gestor com perfil inativo continua resolvendo, com o `profissionalId` do perfil. `resolverAdmin` inalterado (além da renovação).

Ordem de imports: `tenant/sessao.ts` → `auth/validade.ts`, `auth/cookie.ts` (puros, sem ciclo). `auth/sessao.ts` → `tenant/sessao.ts` (`hashDoToken`) e repos. Nenhum arquivo de `tenant/` importa `auth/sessao.ts` ou `auth/login.ts`.

### 3.8 `src/server/auth/sessao.ts` (RN-9, RN-12, RN-13)
```ts
export function gerarToken(): string; // randomBytes(32).toString('base64url') — 43 caracteres
export async function iniciarSessao(usuarioId: string, agora: Date): Promise<{ token: string }>;
  // criarSessao({ usuarioId, tokenHash: hashDoToken(token), agora, expiraEm: expiracaoInicial(agora) })
export async function encerrarSessao(token: string | null | undefined, agora?: Date): Promise<void>;
  // token vazio/ausente → nada; senão revogarSessaoPorHash. Idempotente, nunca lança por sessão inexistente.
export async function revogarSessoesDoUsuario(usuarioId: string, agora?: Date): Promise<number>;
```
Nunca aceita token vindo do cliente para criar sessão (sem fixação).

### 3.9 `src/server/auth/login.ts` (RN-2, RN-6..RN-8, RN-19, RN-22, RN-25; CA-1, CA-2, CA-5, CA-12, CA-15, CA-16, CA-19)
```ts
export const MENSAGENS_LOGIN = Object.freeze({
  credenciais: 'E-mail ou senha incorretos.',
  naoConfirmado: 'Confirme seu e-mail antes de entrar.',
  desativado: 'Seu acesso está desativado. Fale com a gestão do salão.',
  limite: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  emailVazio: 'Informe seu e-mail.',
  senhaVazia: 'Informe sua senha.',
});
export const LIMITE_FALHAS = 10;
export const JANELA_MS = 15 * 60 * 1000;
export type ResultadoLogin =
  | { ok: true; token: string; destino: string }
  | { ok: false; motivo: 'validacao'; erros: { email?: string; senha?: string } }
  | { ok: false; motivo: 'recusado'; mensagem: string };
export type DepsLogin = { agora?: Date; verificarSenha?: VerificadorSenha; log?: (linha: string) => void };
export function chaveDeLogin(emailNormalizado: string): string;   // 'login:' + sha256hex(email)
export function inicioDaJanela(agora: Date): Date;                // floor(agora / 15 min) * 15 min (UTC)
export async function entrar(
  entrada: { email: unknown; senha: unknown; proximo?: unknown },
  deps?: DepsLogin,
): Promise<ResultadoLogin>;
```
Fluxo (RN-7, com a D-3 ajustada):
1. **Validação** (zod, já dependência): e-mail `trim` + minúsculas, ≤ 254, formato de e-mail; senha string de 1..1024, sem `trim`. Falha → `{ motivo: 'validacao', erros }` (vazio **ou** inválido → `emailVazio`; senha vazia ou longa → `senhaVazia`). Sem banco, sem argon2, sem rate limit.
2. **Rate limit (reserva)**: `n = incrementarJanela(chaveDeLogin(email), inicioDaJanela(agora))`. `n > LIMITE_FALHAS` → recusado `limite` (sem buscar usuário, sem argon2).
3. `u = buscarUsuarioParaLogin(email)`.
4. `ok = await verificar(u?.senhaHash ?? HASH_FICTICIO, senha)` — **exatamente uma vez** por tentativa que passou de 1 e 2.
5. `!u || !ok || u.papel === 'super_admin'` → recusado `credenciais` (objeto idêntico nos quatro casos do CA-2).
6. `!u.emailConfirmado` → `naoConfirmado`; `u.papel === 'profissional' && u.profissionalAtivo !== true` → `desativado`.
7. Sucesso: `decrementarJanela(mesma chave, mesma janela)` (devolve a reserva: sucesso não conta como falha nem zera a janela), `iniciarSessao(u.id, agora)`, `{ ok: true, token, destino: destinoAposLogin(entrada.proximo) }`.

Semântica do contador (CA-12): `contador` = tentativas que passaram da validação na janela, menos as bem-sucedidas. Com 10 falhas, a 11ª (inclusive com senha certa ou e-mail inexistente) recebe `limite`. Duas tentativas paralelas no limiar terminam com o contador exato (um `INSERT … ON CONFLICT` por tentativa).

Logs (RN-22, CA-19): uma linha JSON por tentativa que passou da validação, via `deps.log ?? console.info`: `{ evento: 'auth.login', resultado: 'ok'|'credenciais'|'nao_confirmado'|'desativado'|'limite', em }`, com `usuarioId` **só** em `ok`. Nunca e-mail, senha, token, hash ou chave. O resultado detalhado existe só no log; a resposta ao cliente é a da RN-7.

### 3.10 `src/server/auth/pagina.ts` (RN-15, RN-17, RN-21; CA-10)
```ts
export type AcessoPainel = { tipo: 'permitido'; ctx: TenantContext } | { tipo: 'negado' };
/**
 * exigirContexto(papeis) + exigirPermissao(ctx, 'painel.acessar').
 * NaoAutenticado → redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(caminho)}`);
 * AcessoNegado → { tipo: 'negado' }; outros erros são relançados.
 * `redirect` é chamado FORA do catch (ele lança NEXT_REDIRECT).
 */
export async function exigirAcessoAoPainel(caminho: string, papeis?: readonly PapelDeSalao[]): Promise<AcessoPainel>;
/** Para /entrar: cookie com sessão de salão válida → destinoAposLogin(proximo); sem cookie, inválida ou super admin → null. */
export async function destinoSeJaAutenticado(proximo: unknown): Promise<string | null>;
```
`caminho` é a rota da própria página (`ROTAS.painel` etc.); a query original só é preservada pelo proxy (caso sem cookie).

### 3.11 `src/proxy.ts` (RN-16; CA-9)
```ts
export function proxy(request: NextRequest): NextResponse; // NextResponse.next() ou redirect 307
export const config = { matcher: ['/painel', '/painel/:path*'] };
```
- A função também confere `pathname === '/painel' || pathname.startsWith('/painel/')` (defesa se o `matcher` mudar; o CA-9 testa a função com `/`, `/entrar`, `/api/health`, `/salao-x`).
- Sem cookie ou valor vazio → `NextResponse.redirect(new URL(`${ROTAS.entrar}?proximo=${encodeURIComponent(pathname + search)}`, request.url), 307)`.
- Imports permitidos: `next/server`, `@/server/auth/cookie`, `@/config/navegacao`. O teste unitário inclui uma varredura do texto de `src/proxy.ts` que falha se aparecer outro import (garante que Prisma/argon2 não entram no proxy).

### 3.12 Telas e ações
**`src/app/(publico)/entrar/estado.ts`** (sem imports de servidor; usado pelo cliente e pela ação):
```ts
export type EstadoEntrar = { mensagem: string | null; erros: { email?: string; senha?: string }; email: string };
export const ESTADO_INICIAL_ENTRAR: EstadoEntrar;
```
**`FormularioEntrar.tsx`** (`'use client'`): props `{ acao: (e: EstadoEntrar, f: FormData) => Promise<EstadoEntrar>; proximo: string | null }`. `useActionState(acao, ESTADO_INICIAL_ENTRAR)`; `<form action={…}>` (funciona sem JS); `h1` "Entrar" fica na página. Campos com `Field`: "E-mail" (`type="email"`, `autoComplete="username"`, `name="email"`, `defaultValue={estado.email}`, `required`), "Senha" (`type="password"`, `autoComplete="current-password"`, `name="senha"`, sempre vazia), erro por campo; `<input type="hidden" name="proximo">` só se houver; `Alert variante="erro"` com `estado.mensagem` (anunciado); `Button type="submit"` "Entrar" com `ocupado={pendente}`; links "Esqueci minha senha" (`ROTAS.recuperarSenha`) e "Criar conta do salão" (`ROTAS.cadastro`). Sem cor literal (só tokens em CSS Module).

**`acoes.ts`** (`'use server'`, fora de `*.acao.ts`, RN-24):
```ts
export async function entrarAcao(anterior: EstadoEntrar, formData: FormData): Promise<EstadoEntrar>;
// lê email/senha/proximo (valores não-string → ''), chama entrar(); sucesso: (await cookies()).set(NOME_COOKIE_SESSAO, token, atributosCookieSessao()); redirect(destino).
// falha: { mensagem (recusado) | null, erros (validacao) | {}, email: e-mail digitado aparado, cortado em 254 }.
```
**`page.tsx`**: `metadata` com título "Entrar"; `searchParams` (Promise no Next 16) → `proximo`; `destinoSeJaAutenticado(proximo)` não nulo → `redirect`; renderiza `PublicLayout` + `h1` + `FormularioEntrar acao={entrarAcao} proximo={proximo válido ou null}` (o valor é revalidado na ação por `destinoAposLogin`).

**`src/app/painel/acoes.ts`** (`'use server'`):
```ts
export async function sairAcao(): Promise<void>;
// token do cookie → encerrarSessao(token); cookies().set(NOME_COOKIE_SESSAO, '', atributosCookieApagado()); log { evento: 'auth.logout', em }; redirect(ROTAS.entrar).
```
**`src/app/painel/page.tsx`**: `metadata` com `robots: { index: false }`; `exigirAcessoAoPainel(ROTAS.painel)`; `negado` → `<AcessoNegado />`; senão `buscarIdentidadeDoPainel(ctx)` e `PanelLayout papel={ctx.papel} nomeSalao caminhoAtual={ROTAS.painel} areaUsuario={<AreaUsuario nome={nomeUsuario} />}` com `h1` "Olá, <nome>". Sem redirecionar para `/painel/agenda` (RN-21).

**`_componentes/AreaUsuario.tsx`** (servidor): `<form action={sairAcao}>` com o nome e `Button type="submit" variante="discreta"` "Sair" (D-14). **`AcessoNegado.tsx`**: `PublicLayout` (plataforma) + `h1` "Acesso negado" + texto fixo + link "Entrar com outra conta" (`ROTAS.entrar`); nenhum dado de salão ou usuário.

### 3.13 Suporte de teste
**`tests/support/factories.ts`**:
- `export const SENHA_DE_TESTE = 'Senha de teste 123'` e `hashDaSenhaDeTeste()`: `gerarHashSenha(SENHA_DE_TESTE)` memoizado por processo (um argon2 por worker). Todos os usuários criados passam a usar esse hash (inclusive super admin em `auth.ts`).
- Novas sobrescritas: `gestor.emailConfirmado?: boolean` (padrão `true`), `profissional.emailConfirmado?: boolean`, `profissional.ativo?: boolean` (padrão `true`: o perfil do **usuário** profissional fica inativo; o `profissionalInativoId` sem usuário continua igual).
- `fabricas.test.ts` ajustado ao que mudar (hash real; novas opções).

**`tests/support/auth.ts`**: super admin com hash real; novo
```ts
export async function entrarDeVerdade(email: string, o?: { senha?: string; agora?: Date }): Promise<{ token: string; credencial: Credencial }>;
// chama entrar() (login real); lança se não for ok. criarSessao() continua para os cenários de expiração/revogação forjada.
```

## 4. Dados (DBA: **dispensado**)

Motivo: nenhuma migração, tabela, coluna, índice ou constraint muda. Cada ponto que o analista pediu para avaliar:
1. **Incremento atômico em `rate_limit_janela`**: `INSERT … ON CONFLICT (chave, janela_inicio) DO UPDATE … RETURNING` sobre a PK existente (`rate_limit_janela_pkey`, `migration.sql:344`). É uma instrução única, atômica em READ COMMITTED; não há leitura prévia. O decremento é `UPDATE` por PK. Padrão já usado com SQL bruto parametrizado em `src/server/repos/sim-whatsapp.ts`.
2. **Consultas de sessão**: `token_hash` (UNIQUE), `usuario_id` (índice `sessao_usuario_id_idx`) e `id` (PK) cobrem leitura, revogação por hash, revogação por usuário e renovação. A renovação é no máximo uma escrita por sessão por hora.
3. **Login por e-mail**: `usuario.email` UNIQUE; o e-mail já chega minúsculo (CHECK `usuario_email_minusculo_chk`).
4. **Crescimento sem limpeza** (`sessao` e `rate_limit_janela`): uma linha por login e uma por e-mail × janela de 15 min com tentativas. Volume baixo na v1; a limpeza fica como pendência registrada (D-10): job diário no worker na E4.2 (que também usa `rate_limit_janela`) ou na E9.x. O índice `sessao_expira_em_idx` e `rate_limit_janela_janela_inicio_idx` já existem para essa limpeza.

Gatilho para acionar o DBA: qualquer necessidade de migração, de mudar o `isolationLevel` ou de SQL além dos três acima.

## 5. Infraestrutura (DevOps: **dispensado**)

Motivo, item a item da "revisão leve" sugerida:
1. **Binário nativo**: sem script de instalação (§0), então `allowScripts` não muda. `npm ci` no estágio `build` do `Dockerfile` (`node:24-trixie-slim`, glibc) instala `@node-rs/argon2-linux-<arch>-gnu`; `npm prune --omit=dev` mantém (é dependência de produção) e o estágio `final` copia `node_modules`. O Next o carrega como pacote externo (lista padrão). O runner `ubuntu-latest` (glibc x64) recebe o mesmo binário nos jobs `lint`/`typecheck`/`build`/`testes`/`e2e`.
2. **Nenhum arquivo de infraestrutura muda**: `Dockerfile`, `docker-compose.yml`, `ci.yml`, `.env.example`, `env.ts`. As constantes (D-1, D-3, D-4) ficam no código, sem variável de ambiente.
3. **E2E**: `e2e/entrar.spec.ts` não precisa de banco (§0), cabe no job `e2e` atual.
4. **Lacuna aceita**: o job `docker` só compila a imagem. A prova de que o binário carrega **na imagem** é manual, no T-7 (`docker compose up -d --wait` e `curl -fsS -o /dev/null -w '%{http_code}' http://localhost:3000/entrar` → `200`; a página importa a cadeia ação → `login.ts` → `senha.ts` → `@node-rs/argon2`), e o tester repete. Se falhar, aciona-se o DevOps.
5. **Observabilidade**: logs JSON `auth.login`/`auth.logout` no stdout (§3.9), no padrão do `queue/client.ts`.

Gatilho para acionar o DevOps: falha do item 4, necessidade de PostgreSQL no job `e2e` (D-13, futuro) ou de `serverActions.allowedOrigins` atrás de proxy reverso (R-7).

## 6. Verificação das invariantes

| Invariante | Aplica? | Como foi atendida |
|---|---|---|
| Escopo por salão no servidor | **Sim** | O `salaoId` vem só da sessão (`resolverTenant`); o login não aceita salão (e-mail global único). `buscarIdentidadeDoPainel` filtra por `ctx.usuarioId` **e** `salao_id`. CA-17 prova com login real que o token de A recebe 404 em recursos de B e que o painel de A só mostra A. O proxy não decide nada; páginas e ações autorizam no servidor (RN-17). |
| Exclusion constraint anti-sobreposição | Não | Nenhuma escrita em `reserva`. A matriz só declara quem pode criar/alterar (E3.x aplica). |
| UTC + fuso do salão | Parcial | Todos os instantes de sessão e rate limit são `timestamptz` em UTC, com relógio injetável. O fuso do salão não se aplica (spec §6). A janela é alinhada a múltiplos de 15 min em UTC. |
| Adaptadores de integração | Não | Login não envia e-mail nem usa Turnstile. `@node-rs/argon2` não é integração externa (biblioteca local), restrito a `senha.ts`. |
| Soft delete / anonimização | **Sim** | Profissional desativado (`ativo=false`) não entra e não resolve contexto (RN-14); revogar sessão grava `revogada_em` e nunca apaga linhas (RN-13). |
| Salão suspenso somente leitura | Indiretamente | Login funciona com salão suspenso (spec §3). A política por estado continua na `capacidade` de `defineAcao` (E6.4); a matriz não a substitui. |
| Idempotência de webhooks e mensagens | Não (análogo) | Logout idempotente; `revogarSessoesDoUsuario` idempotente (segunda chamada devolve 0); renovação condicional não duplica escrita. |
| Auditoria do super admin | Não nesta demanda | Super admin recusado em `/entrar` (RN-25), sem sessão. Login do admin e auditoria são da E1.5/E8.1, que reaproveitam `senha.ts` e `iniciarSessao`. |
| Sigilo (RN-22) | **Sim** | Banco guarda só `hashDoToken(token)`; chave de rate limit é SHA-256 do e-mail; logs sem e-mail/senha/token/hash (CA-19); mensagens fixas. |

## 7. Riscos e decisões

### 7.1 Decisões D-1..D-14 da spec
| D | Decisão final | Justificativa |
|---|---|---|
| D-1 | **Confirmada**: 7 d de inatividade, renovação no uso com no máximo uma escrita por hora (`UPDATE` condicional), teto de 30 d desde `criado_em`; cookie `Max-Age` = 30 d. | Uso diário da equipe. A escrita condicional atende o CA-14 mesmo com requisições concorrentes. `criado_em` e `ultimo_uso_em` são gravados com o relógio injetado na criação. |
| D-2 | **Confirmada**: `Secure` ⇔ `NODE_ENV === 'production'`; nome `ab_sessao`, sem `__Host-`. | Não depende de `APP_URL` correta em produção (um `APP_URL` errado não pode desligar o `Secure`). Chromium/Firefox aceitam `Secure` em `http://localhost` e `127.0.0.1`; o Safari não (README). Nenhum E2E desta demanda faz login. |
| D-3 | **Ajustada**: 10 falhas por e-mail em janela fixa de 15 min, mas com **reserva antes da verificação** (incremento atômico; acima de 10 → bloqueia) e devolução no sucesso (decremento). | "Ler e depois incrementar" deixa uma rajada paralela verificar a senha muitas vezes acima do limite. A reserva limita estritamente e mantém "sucesso não conta como falha". A chave é `login:` + SHA-256 do e-mail (sem segredo disponível para HMAC; a E4.2 pode trocar por HMAC ao introduzir o segredo). |
| D-4 | **Confirmada**: argon2id m=19456 KiB, t=2, p=1; sem rehash automático. | OWASP; ≈ 13 ms por operação (§0). |
| D-5 | **Confirmada**: outro salão → 404 (repositório); outro profissional do mesmo salão → 403 (`exigirPermissao`). | PLAN CA 11. |
| D-6 | **Confirmada**: `cliente.gerir` só gestor. | `PLAN.md:15`. A E3.4 acrescenta operação se precisar. |
| D-7 | **Confirmada**: mover reserva para outro profissional é do gestor (`reserva.alterar` com `alvo` = profissional de origem **e** de destino; a E3.5 aplica). | — |
| D-8 | **Confirmada**: e-mail não confirmado bloqueia também o profissional. | Falha fechada; fábricas já confirmam. |
| D-9 | **Alterada para (b)**: tela "Acesso negado" renderizada pela página (status 200, `noindex`), sem `authInterrupts`. | `forbidden()` e `authInterrupts` são experimentais/canary no Next 16.4.6 (§0). O 403 do PLAN CA 11 é atendido onde importa: ações (`defineAcao` → 403) e rotas (`respostaDeErro`). A conversão está isolada em `pagina.ts`: trocar por `forbidden()` quando estabilizar é uma linha. Nenhum dado do salão aparece em nenhum dos casos. |
| D-10 | **Confirmada (fora)**: sem limpeza de sessões/rate limit nesta demanda; pendência para a E4.2 (rate limit) ou E9.x. | Volume baixo; índices de limpeza já existem (§4). |
| D-11 | **Confirmada**: ação de servidor + `useActionState`; núcleo em `src/server/auth/login.ts` sem `next/*`; casca em `src/app/(publico)/entrar/acoes.ts`. | Mesma separação `defineAcao` × `next.ts`. |
| D-12 | **Confirmada**: testes unitários em `src/server/auth/*.test.ts` (o da matriz é `src/server/auth/permissoes.test.ts`), não em `tests/unit/`. Desvio de caminho da issue registrado aqui. O de integração mantém o nome da issue: `tests/integration/auth/sessao-rbac.test.ts`. | `vitest.config.ts:46`. |
| D-13 | **Confirmada**: sem E2E de login com banco; o E2E cobre `/entrar` (teclado, axe) e o redirecionamento real do proxy em `/painel` sem cookie. | Job `e2e` sem PostgreSQL. |
| D-14 | **Confirmada**: `<form action={sairAcao}>` na `areaUsuario`, sem confirmação. É ação de servidor (POST com checagem de origem do Next), funciona sem JS. | RN-12. |

Decisões adicionais do desenho:
- **DD-1**: `NOME_COOKIE_SESSAO` passa a morar em `src/server/auth/cookie.ts` (reexportado por `tenant/sessao.ts`), para o proxy não importar a cadeia do Prisma.
- **DD-2**: `exigirPermissao` sem `alvo` em operação `proprio` é checagem de operação; listagens usam `filtroDeProfissional`. `defineAcao` não ganha campo `operacao` nesta demanda (evita mexer no registro de ações e nas fixtures do CA-4 da D-005).
- **DD-3**: e-mail inválido e e-mail vazio recebem a mesma mensagem ("Informe seu e-mail."), conforme a RN-6 literal.
- **DD-4**: a renovação vale também para sessões de super admin; a E1.5 pode impor teto menor.

### 7.2 Riscos
| ID | Risco | Mitigação |
|---|---|---|
| R-1 | Binário nativo do argon2 não carregar na imagem Docker ou na CI | Sem script de instalação; glibc em todos os alvos (§0). Prova manual no T-7 (§5 item 4) e repetida pelo tester. Gatilho para DevOps. |
| R-2 | `verify` lançar com hash malformado e virar 500 | `verificarSenha` captura e devolve `false` (CA-13 cobre `'hash-de-teste-sem-uso'` e vazio). |
| R-3 | Diferença de tempo entre e-mail existente e inexistente | `HASH_FICTICIO` com os mesmos parâmetros, verificado exatamente uma vez (CA-2 instrumentado). Literal fixo: sem custo extra na primeira chamada. |
| R-4 | Bloqueio de 15 min de um e-mail conhecido por terceiro (sem IP até a E4.2) | Aceito (D-3 da spec). Mensagem genérica, sem revelar existência. |
| R-5 | Ciclo de imports `tenant` ↔ `auth` | Só `auth/validade.ts` e `auth/cookie.ts` (puros) são importados por `tenant/`. O critério do T-2/T-3 inclui `npm run build` e `typecheck`. |
| R-6 | Proxy puxar Prisma/argon2 para o bundle do proxy | Imports restritos e varredura no `proxy.test.ts` (§3.11). |
| R-7 | Ações de servidor atrás de proxy reverso com `Host` ≠ `Origin` recusarem o POST | Fora da v1 local; o README registra `serverActions.allowedOrigins` como ajuste de implantação (E9.x/DevOps). |
| R-8 | Custo do argon2 nos testes (4 workers × 19 MiB) | ≈ 13 ms por operação; hash da fábrica memoizado por processo; o CA-12 faz ~12 verificações. Sem mudança de `testTimeout`. |
| R-9 | `redirect()` dentro de `try/catch` engolido | Regra explícita no §3.10; o CA-10 testa o redirecionamento. |
| R-10 | Testes existentes dependentes de `expira_em` mudarem com a renovação | Verificado (§0): todos testam sessão já expirada, filtrada antes de renovar. O T-2 roda a suíte `tests/integration/tenant` inteira. |
| R-11 | Mudança das fábricas (hash real) quebrar `fabricas.test.ts` ou deixar a suíte lenta | Arquivo sob posse do T-2; um hash por processo. |
| R-12 | Cobertura: casca Next (`acoes.ts`, `page.tsx`) sem teste | Testes de integração chamam as funções com `next/headers` e `next/navigation` substituídos e renderizam as páginas com `renderToStaticMarkup` (§8). |

## 8. Estratégia de testes

- **Unitário** (`src/**/*.test.ts(x)`, sem banco):
  - `senha.test.ts` (CA-13): prefixo e parâmetros; dois hashes diferem; certa/errada; malformado/vazio → `false`; acentos e emoji; `HASH_FICTICIO` com os mesmos parâmetros e que não verifica `SENHA_DE_TESTE` nem `''`.
  - `validade.test.ts`: limites de 1 h, 7 d e 30 d.
  - `cookie.test.ts` (CA-7): `production` → `secure: true`; `development`, `test`, `undefined` → `false`; apagamento com `maxAge: 0` e os mesmos `path`/`sameSite`/`secure`.
  - `destino.test.ts` (CA-8): tabela de casos da spec mais `/painel/%2e%2e/admin`, `/painel#x`, 2049 caracteres.
  - `permissoes.test.ts` (CA-11): enumera `OPERACOES × papéis` contra a tabela esperada escrita no teste; `pode` com `'cliente'`, `undefined`, `'toString'`, `'__proto__'`, operação inexistente → `negado`; matriz congelada; `exigirPermissao` e `filtroDeProfissional` em todos os ramos.
  - `src/proxy.test.ts` (CA-9): `NextRequest` real; varredura de imports.
  - `tenant/sessao.test.ts`: mantém os casos sem banco; `NOME_COOKIE_SESSAO` reexportado igual ao de `auth/cookie.ts`.
  - `FormularioEntrar.test.tsx` (jsdom; CA-18 parte de componente): rótulos associados, `type`/`autocomplete`, `Alert` com a mensagem, e-mail preservado e senha vazia após erro (ação substituída por função assíncrona de teste), campo `proximo` oculto só quando há valor, links.
- **Integração** (PostgreSQL real, harness da D-005; `next/headers` e `next/navigation` substituídos quando a casca é exercitada, como em `exigir-contexto.test.ts`):
  - `tests/integration/auth/resolucao.test.ts` (T-2): CA-14 (relógio injetado; contagem de escritas por `ultimo_uso_em`/consulta direta), RN-14 da resolução (profissional inativo/sem perfil → 401; gestor com perfil inativo → resolve), repositórios `usuario.ts` (inclui `buscarIdentidadeDoPainel` com contexto de outro salão → `NaoEncontrado`) e `rate-limit.ts` (incremento concorrente exato com `Promise.all` de 20).
  - `tests/integration/auth/login.test.ts` (T-3): CA-2 (verificador instrumentado por `deps.verificarSenha`), CA-5 (mensagem de desativado), CA-12, CA-15, CA-16, CA-19 (espiar `console.*` e `process.stdout.write`/`stderr.write`; procurar senha, token e `token_hash`).
  - `tests/integration/auth/sessao-rbac.test.ts` (T-3, nome da issue): CA-1 (núcleo: linha em `sessao`, `token_hash`, `expira_em`, `resolverTenant`), CA-3 (`acaoValida` + ação de teste **inline** `papeis: ['gestor']` que renomeia um profissional; não criar fixture nova em `fixtures/registro/`, que quebraria o CA-4 da D-005), CA-4 (núcleo: `encerrarSessao`, 401 em `resolverTenant`/`defineAcao`/`exigirContexto`, sessão Y intacta, idempotência), CA-5 (sessão antiga deixa de resolver; `revogarSessoesDoUsuario` com contagem), CA-17 (ações por ID de B com o token de A → 404, nada muda em B).
  - `tests/integration/auth/paginas.test.ts` (T-6): CA-1 casca (`entrarAcao` grava o cookie com os atributos e redireciona para `/painel`; `proximo` válido respeitado), CA-4 casca (`sairAcao` apaga com `maxAge: 0` e redireciona; sem cookie também), CA-6 (página `/painel` renderizada com `renderToStaticMarkup(await Pagina())`: navegação do profissional, nome do salão, nome e "Sair"), CA-10 (sem cookie/expirada/revogada → redirect com `proximo`; super admin → "Acesso negado" sem nome do salão; `/entrar` com sessão válida → redirect `/painel`; com sessão de super admin → mostra o formulário), CA-17 (painel de A só com o nome de A), estado de erro devolvido por `entrarAcao` (sem senha).
  - Os testes de integração são `.ts` (o projeto só coleta `*.test.ts`): renderizar com `renderToStaticMarkup` do `react-dom/server` sobre o elemento devolvido pela página, sem JSX no arquivo de teste.
- **E2E** (`e2e/entrar.spec.ts`, Playwright 375×812, sem banco): CA-18 (sem rolagem horizontal, ordem de Tab E-mail → Senha → Entrar, rótulos, atributos, axe zero violações reaproveitando `analisarComAxe` de `e2e/suporte/vitrine.ts` só por import) e o proxy real: `GET /painel/agenda?x=1` sem cookie termina em `/entrar?proximo=%2Fpainel%2Fagenda%3Fx%3D1`.
- **Gates (CA-20)**: `npm run lint`, `typecheck`, `build`, `npm test`, `npm run test:coverage` (≥ 90% de linhas), `npm run test:e2e`; o teste de registro (CA-4 da D-005) continua sem exceções (nenhum `*.acao.ts` novo).
- **Cobertura ≥ 90%**: todo arquivo novo de `src/` tem teste direto: puros por unidade; repositórios, `auth/sessao.ts`, `login.ts`, `pagina.ts`, `acoes.ts` e `page.tsx` por integração; `FormularioEntrar.tsx` por jsdom; `proxy.ts` por unidade. Nenhuma exclusão nova em `vitest.config.ts`. O T-7 registra o percentual medido e a cobertura por arquivo de `src/server/auth/**`, `src/proxy.ts` e `src/app/(publico)/entrar/**`, `src/app/painel/**` no `dev.md`.

## 9. Tarefas

Todas as tarefas de implementação são do `desenvolvedor` (DBA e DevOps dispensados, §4 e §5). Uma pessoa pode fazê-las em sequência (T-1 → T-7); as rodadas mostram o paralelismo sem arquivo em comum.

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | desenvolvedor | — | T-5 | `package.json`, `package-lock.json`, `src/server/auth/{senha,validade,cookie,destino,permissoes}.ts` e os `.test.ts` correspondentes |
| T-2 | desenvolvedor | T-1 | T-4, T-5 | `src/server/repos/sessao.ts`, `src/server/repos/usuario.ts`, `src/server/repos/rate-limit.ts`, `src/server/tenant/sessao.ts`, `src/server/tenant/sessao.test.ts`, `tests/support/factories.ts`, `tests/integration/tenant/fabricas.test.ts`, `tests/integration/auth/resolucao.test.ts` |
| T-3 | desenvolvedor | T-2 | T-4, T-5 | `src/server/auth/sessao.ts`, `src/server/auth/login.ts`, `tests/support/auth.ts`, `tests/integration/auth/login.test.ts`, `tests/integration/auth/sessao-rbac.test.ts` |
| T-4 | desenvolvedor | T-1 | T-2, T-3, T-5 | `src/proxy.ts`, `src/proxy.test.ts` |
| T-5 | desenvolvedor | — | T-1, T-2, T-3, T-4 | `src/app/(publico)/entrar/estado.ts`, `src/app/(publico)/entrar/FormularioEntrar.tsx`, `FormularioEntrar.module.css`, `FormularioEntrar.test.tsx` |
| T-6 | desenvolvedor | T-3, T-5 | — | `src/server/auth/pagina.ts`, `src/app/(publico)/entrar/page.tsx`, `src/app/(publico)/entrar/acoes.ts`, `src/app/painel/**`, `tests/integration/auth/paginas.test.ts` |
| T-7 | desenvolvedor | T-4, T-6 | — | `e2e/entrar.spec.ts`, `README.md`, `docs/demandas/D-010/dev.md` |
| T-8 | tester | T-7 | — | `docs/demandas/D-010/testes.md` |

Rodadas sem arquivo em comum:
- **Rodada 1:** T-1 ‖ T-5.
- **Rodada 2:** T-2 ‖ T-4 (‖ T-5, se não tiver terminado).
- **Rodada 3:** T-3 (‖ T-4/T-5 remanescentes).
- **Rodada 4:** T-6.
- **Rodada 5:** T-7.
- **Rodada 6:** T-8.

Observações sobre a posse:
- Um defeito achado numa rodada posterior num arquivo de outra tarefa reabre a tarefa dona (por exemplo, ajuste de `buscarSessaoValida` pedido pelo T-3 volta ao T-2), sem edição cruzada na mesma rodada.
- `CLAUDE.md` ("Project status" e a tabela de comandos com a linha do E2E de login) é do **líder** ao encerrar; o T-7 entrega o texto sugerido no `dev.md`.
- Ninguém edita `tests/integration/tenant/fixtures/registro/**` (CA-4 da D-005 lista os arquivos exatamente).

**T-1 — Dependência e núcleo puro.**
- Entregável: `npm install --save-exact @node-rs/argon2@2.2.2` (sem `--legacy-peer-deps`); §3.1–§3.5 com testes unitários (CA-7, CA-8, CA-11, CA-13).
- Critério de conclusão: `npm run test:unit -- src/server/auth` verde; `grep -n '"@node-rs/argon2": "2.2.2"' package.json` encontra; `git diff package.json` sem `^`/`~`; `allowScripts` inalterado e `npm ci` limpo sem aviso de script bloqueado; `grep -rn "@node-rs/argon2" src` só em `senha.ts`; `validade.ts` e `cookie.ts` sem imports além de `./validade`; lint e typecheck verdes.

**T-2 — Persistência e resolução da sessão.**
- Entregável: §3.6 (repositórios), §3.7 (renovação e RN-14; reexport do nome do cookie), §3.13 (fábricas); `resolucao.test.ts` (CA-14, RN-14, repositórios, incremento concorrente).
- Critério de conclusão: `npx vitest run --project integration tests/integration/auth/resolucao.test.ts tests/integration/tenant` verde (a suíte `tenant` inteira, R-10/R-11); `npm run test:unit -- src/server/tenant` verde; `grep -rn "hash-de-teste-sem-uso" tests/support` vazio; nenhum import de `auth/sessao.ts`/`auth/login.ts` em `src/server/tenant/`; lint, typecheck e build verdes.

**T-3 — Serviço de login e ciclo da sessão.**
- Entregável: §3.8, §3.9, `entrarDeVerdade` e super admin com hash real (§3.13); `login.test.ts` e `sessao-rbac.test.ts` (CA-1 núcleo, CA-2, CA-3, CA-4 núcleo, CA-5, CA-12, CA-15, CA-16, CA-17 ações, CA-19).
- Critério de conclusão: os dois arquivos verdes 10 vezes seguidas (`for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/login.test.ts tests/integration/auth/sessao-rbac.test.ts || break; done`, por causa do teste concorrente do CA-12); `tests/integration/tenant/registro.test.ts` verde; nenhum arquivo `*.acao.ts` novo; `grep -rn "console\." src/server/auth` só no padrão de log do §3.9; lint e typecheck verdes.

**T-4 — Proxy otimista.**
- Entregável: §3.11 com `src/proxy.test.ts` (CA-9).
- Critério de conclusão: teste verde; varredura de imports no teste; `npm run build` verde e o log do build lista o proxy; lint e typecheck verdes.

**T-5 — Formulário de entrada (cliente).**
- Entregável: §3.12 (`estado.ts`, `FormularioEntrar`) com teste jsdom (parte de componente do CA-18).
- Critério de conclusão: `npm run test:unit -- "src/app/(publico)/entrar"` verde; `estado.ts` e `FormularioEntrar.tsx` sem import de `@/server` em tempo de execução; CSS só com `var(--…)` (as varreduras de conformidade da D-009 continuam verdes); lint e typecheck verdes.

**T-6 — Casca Next: páginas, ações e auxiliar de página.**
- Entregável: §3.10 e §3.12 (`page.tsx`, `acoes.ts` de `/entrar`; `/painel` com `AreaUsuario`, `AcessoNegado` e `sairAcao`); `paginas.test.ts` (CA-1 casca, CA-4 casca, CA-6, CA-10, CA-17 painel).
- Critério de conclusão: `npx vitest run --project integration tests/integration/auth` verde; `npm run build` verde com `/entrar` e `/painel` dinâmicos (ƒ) no relatório do build; `next.config.ts` inalterado; nenhum `redirect` dentro de bloco `catch`; lint e typecheck verdes.

**T-7 — E2E, documentação e gates.**
- Entregável: `e2e/entrar.spec.ts` (CA-18 e proxy real); README: seção "Entrar no painel" (fluxo, mensagens, sessão de 7/30 d, rate limit de 10 falhas/15 min, `Secure` só em produção e o comportamento em `http://localhost` no Safari, ausência de usuário de exemplo até E1.1/E9.2, `serverActions.allowedOrigins` atrás de proxy reverso, nenhuma credencial externa nova); `dev.md` com evidências.
- Critério de conclusão: `npm run lint`, `typecheck`, `build`, `npm test`, `npm run test:coverage` (≥ 90%, percentual e cobertura dos arquivos novos registrados), `npm run test:e2e` verdes; prova Docker do §5 item 4 (`docker compose up -d --wait`; `/entrar` → 200; `docker compose logs app` sem erro de carregamento do argon2); texto sugerido para o `CLAUDE.md` no `dev.md`.

**T-8 — Validação independente (tester).**
- Entregável: `testes.md` com veredito; repetir os gates, a prova Docker, o laço de 10 execuções do T-3 e conferir o mapa abaixo.

### Mapa CA → tarefa → tipo de teste
| CA | Tarefa(s) | Tipo de teste | Arquivo |
|---|---|---|---|
| CA-1 | T-3, T-6 | Integração (núcleo + casca) | `sessao-rbac.test.ts`, `paginas.test.ts` |
| CA-2 | T-3 | Integração (verificador instrumentado) | `login.test.ts` |
| CA-3 | T-3 | Integração | `sessao-rbac.test.ts` |
| CA-4 | T-3, T-6 | Integração (núcleo + casca) | `sessao-rbac.test.ts`, `paginas.test.ts` |
| CA-5 | T-2, T-3 | Integração | `resolucao.test.ts`, `login.test.ts`, `sessao-rbac.test.ts` |
| CA-6 | T-6 | Integração (render da página) | `paginas.test.ts` |
| CA-7 | T-1 | Unitário | `src/server/auth/cookie.test.ts` |
| CA-8 | T-1 | Unitário | `src/server/auth/destino.test.ts` |
| CA-9 | T-4 (+ T-7) | Unitário (+ E2E do redirecionamento real) | `src/proxy.test.ts`, `e2e/entrar.spec.ts` |
| CA-10 | T-6 | Integração | `paginas.test.ts` |
| CA-11 | T-1 | Unitário | `src/server/auth/permissoes.test.ts` |
| CA-12 | T-2 (incremento), T-3 | Integração (inclui concorrência) | `resolucao.test.ts`, `login.test.ts` |
| CA-13 | T-1 | Unitário | `src/server/auth/senha.test.ts` |
| CA-14 | T-2 | Integração (relógio injetado) | `resolucao.test.ts` |
| CA-15 | T-3 | Integração | `login.test.ts` |
| CA-16 | T-3 | Integração | `login.test.ts` |
| CA-17 | T-3, T-6 | Integração (login real) | `sessao-rbac.test.ts`, `paginas.test.ts` |
| CA-18 | T-5, T-7 | jsdom + E2E | `FormularioEntrar.test.tsx`, `e2e/entrar.spec.ts` |
| CA-19 | T-3 | Integração | `login.test.ts` |
| CA-20 | T-7, T-8 | Gates | comandos oficiais |

## Pendências registradas (não bloqueantes)
- Limpeza periódica de `sessao` e `rate_limit_janela` (D-10): E4.2 ou E9.x.
- `serverActions.allowedOrigins` na implantação atrás de proxy reverso (R-7): E9.x.
- HMAC na chave de rate limit quando houver segredo de servidor (D-3): E4.2.
- E2E de login de ponta a ponta com PostgreSQL no job `e2e` (D-13): quando o seed (E9.2) existir.
