# D-011 — Desenho: cadastro de gestor e salão com confirmação de e-mail e slug gerado (issue #13, E1.1)

Autor: arquiteto-software. Entradas: `docs/demandas/D-011/issue-13.md` (RN-1..RN-6, CA-1..CA-6), `docs/demandas/D-011/spec.md` (RN-7..RN-20, CA-7..CA-21, D-1..D-13), `PLAN.md` ("Perfis e acesso", "Assinatura"), `CLAUDE.md`, `docs/demandas/D-010/design.md` (padrão de login/sessão) e o código da branch `feat/d-011-cadastro-gestor` (= `main` em `68ce771`).

## 0. Verificações feitas antes do desenho

| Verificação | Resultado |
|---|---|
| Schema (spec §8: "nenhuma migração") | **Confirmado.** `salao` tem os defaults da RN-3 (`schema.prisma:129-133`); `salao_slug.slug` é PK (unicidade global, atual + histórico) com CHECK `salao_slug_formato_chk` e `salao_slug_atual_uniq` (`20261118000200_restricoes_sql/migration.sql:67-71`); `usuario.email` UNIQUE (`usuario_email_key`) com CHECK de minúsculas, `usuario_papel_salao_chk` e `usuario_gestor_por_salao_uniq` (`:76-84`); `token` com `tipo_token` (`confirmacao_email`), `token_hash` UNIQUE, `expira_em`, `usado_em`, `invalidado_em` e índice `(usuario_id, tipo)`; `rate_limit_janela` com PK `(chave, janela_inicio)`. Nenhum CHECK em `token`. |
| Tratamento de violação de unicidade no código | Não existe nenhum (`grep 23505\|P2002 src/server` vazio). O formato do erro do Prisma 7 com `@prisma/adapter-pg` para violação de constraint não é usado em lugar nenhum. **Decisão:** o desenho evita depender dele usando `INSERT … ON CONFLICT … DO NOTHING RETURNING` (§3.2), como o rate limit da D-010 já faz. |
| E-mail | `integracoes().email` (`registry.ts:96`) devolve a porta; o simulado grava em `email_log` fora da transação de quem chama (`email/simulado.ts`). Falhas: `ErroEnvioEmail` / `ErroValidacaoEmail` (`email/port.ts`). Timeouts SMTP reais: 10 s por etapa (`email/real.ts:18-23`). |
| `APP_URL` | `esquemaEnv` (`env.ts:29`), padrão `http://localhost:3000`; obtido por `validarEnv(process.env).APP_URL`. Não há getter memoizado; o serviço aceita `deps.appUrl`. |
| Login | `login.ts:112-114` recusa "não confirmado" depois de provar a senha; conta como falha no rate limit. `inicioDaJanela`, `JANELA_MS` e `chaveDeLogin` exportados. |
| Rotas | `ROTAS.cadastro`, `ROTAS.confirmarEmail` existem; `SEGMENTOS_RESERVADOS` (`navegacao.ts:120-131`) = `_next, admin, api, cadastro, confirmar-email, convite, dev, entrar, painel, privacidade, recuperar-senha, redefinir-senha, termos`. `_next` não satisfaz o formato de slug (nunca seria gerado). Nenhuma rota nova é criada nesta demanda. |
| Next 16 metadata `referrer` | `node_modules/next/dist/lib/metadata/types/metadata-interface.d.ts:143-148`: `referrer` gera `<meta name="referrer" content="…">`. `next.config.ts` não muda. |
| Harness de integração | Base por worker recriada no início de cada arquivo (`tests/support/setup-arquivo.ts`); slugs das fábricas são aleatórios (`slugNovo`), então não colidem com `studio-bela`. `email_log` é gravado na base do worker (`obterPrisma()` lê a `DATABASE_URL` do worker). |
| Testes sensíveis ao formato de `EstadoEntrar` | `tests/integration/auth/paginas.test.ts` e `FormularioEntrar.test.tsx` usam o estado de `/entrar`; mudam junto com ele (posse no §9). |
| Job `e2e` da CI | Sem PostgreSQL (`ci.yml`: só o job `testes` tem o serviço). `/cadastro` (render e erros de validação) e `/confirmar-email` sem `token` não acessam banco (§3.6), então cabem no job atual. |

## 1. Resumo da solução

- **Slug puro** (`src/lib/slug.ts`): `slugBase(nome)` (RN-8) e `escolherSlugLivre(base, ocupados)` (RN-9/RN-10), que pula `SEGMENTOS_RESERVADOS` (importado de `src/config/navegacao.ts`, fonte única) e os slugs ocupados.
- **Repositórios pré-contexto** (exceções documentadas à RN-8 da D-005, como `sessao.ts`/`rate-limit.ts`):
  - `src/server/repos/cadastro.ts`: verificação prévia de e-mail e **uma transação** que grava salão → usuário gestor (`ON CONFLICT (email) DO NOTHING`; sem linha → aborta tudo) → `salao_slug` (laço de candidatos com `ON CONFLICT (slug) DO NOTHING`) → token.
  - `src/server/repos/token-confirmacao.ts`: consumo atômico do token e substituição (reenvio), ambos com **trava da linha do usuário primeiro** (ordem de travas fixa: `usuario` → `token`), e a busca do alvo do reenvio por e-mail ou por `token_hash`.
- **Serviços sem `next/*`** em `src/server/auth/`:
  - `confirmacao-email.ts`: geração do token (32 bytes, SHA-256, 24 h), link a partir de `APP_URL`, montagem do e-mail, `confirmarEmail(token)` e `reenviarConfirmacao({ email } | { token })` com resposta uniforme e limite de 3/15 min em `rate_limit_janela`.
  - `cadastro.ts`: validação (RN-7), verificação prévia de e-mail, hash argon2id **antes** da transação, transação do repositório, envio **síncrono depois do commit** pela porta do registro; falha de envio não desfaz.
  - `login.ts`: só acrescenta `reenvioDisponivel: true` ao resultado "não confirmado".
- **Casca Next**: `/cadastro` (formulário com `useActionState`; o sucesso troca o formulário pelo painel "verifique seu e-mail"), `/confirmar-email` (Server Component que consome o token ao abrir, com `referrer: no-referrer`; sem `token` mostra só o formulário de reenvio), componente cliente `FormularioReenvio` reaproveitado por `/confirmar-email` e por `/entrar`.
- **Testes**: unitários (slug, validação, montagem do link/e-mail, componentes jsdom), integração com PostgreSQL real (serviços, concorrência, casca) e um E2E sem banco (teclado + axe) de `/cadastro` e `/confirmar-email`.

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Capturar a violação de `usuario_email_key` / `salao_slug_pkey` e mapear o erro | Em PostgreSQL a violação aborta a transação (exigiria savepoint ou repetir tudo) e o formato do erro do Prisma 7 + adapter-pg não está estabelecido no projeto. `ON CONFLICT … DO NOTHING RETURNING` não aborta, espera a transação concorrente decidir e é garantido pelo próprio índice único. |
| `SELECT … FOR UPDATE`/advisory lock no nome do salão para escolher o slug | Serializa cadastros com nomes iguais sem necessidade; o `ON CONFLICT` na PK já resolve a corrida com o próximo candidato. |
| Repetir a transação inteira a cada colisão de slug | Recalcularia o hash/ID e duplicaria trabalho; o laço com `ON CONFLICT` dentro da mesma transação é suficiente. |
| Índice parcial único "um token pendente por usuário e tipo" | Exigiria migração e afetaria a E1.3 (`recuperacao_senha`). A trava da linha do usuário (§3.2) garante a mesma propriedade no código e é testada (CA-14/CA-15 e a corrida reenvio × consumo). |
| Fila `email-confirmacao` (D-3, alternativa) | O token em claro não é persistido e o payload da fila só aceita IDs (`filas.ts:6-7`); o worker teria de emitir o token, mudando o contrato. Ver D-3 (§7.1). |
| Consumir o token por POST (botão "Confirmar") | Contraria a letra do CA-4 ("quando é aberto"). Mantido o GET (D-6) com mitigação na mensagem. |
| `route.ts` em `/confirmar-email` que consome e redireciona para uma URL sem token | Um segmento não pode ter `page.tsx` e `route.ts`; exigiria rota nova em `ROTAS` (e mais um segmento reservado) e um estado transportado na URL, que qualquer um pode forjar. `metadata.referrer = 'no-referrer'` + página sem recursos de terceiros resolve o vazamento por `Referer` (RN-13). |
| Rota própria para o formulário de reenvio (`/reenviar-confirmacao`) | Mudaria `ROTAS`/`SEGMENTOS_RESERVADOS` e o teste que fixa o conjunto (`navegacao.test.ts:178-192`); `/confirmar-email` sem `token` já serve. |
| `prisma.$transaction` via `emTransacao` | `emTransacao` entrega repositórios de tenant; o cadastro é pré-contexto. Os repositórios novos abrem `obterPrisma().$transaction(…, { isolationLevel: ReadCommitted })` diretamente. |

### 1.2 Dependências novas
Nenhuma. Usa `zod`, `node:crypto`, `@node-rs/argon2` (via `senha.ts`) e os componentes de `src/components/ui/`.

## 2. Componentes afetados

| Caminho | Situação | Papel |
|---|---|---|
| `src/lib/slug.ts` (+ `slug.test.ts`) | novo | RN-8..RN-10, puro |
| `src/server/repos/cadastro.ts` | novo | verificação prévia de e-mail; transação de criação |
| `src/server/repos/token-confirmacao.ts` | novo | consumo, substituição e alvo do reenvio |
| `src/server/auth/confirmacao-email.ts` (+ `confirmacao-email.test.ts`) | novo | token, link, e-mail, confirmar, reenviar |
| `src/server/auth/cadastro.ts` (+ `cadastro.test.ts`) | novo | validação e orquestração do cadastro |
| `src/server/auth/login.ts` | alterado | `reenvioDisponivel` no "não confirmado" |
| `src/app/(publico)/cadastro/{page.tsx, acoes.ts, estado.ts, FormularioCadastro.tsx, FormularioCadastro.module.css, FormularioCadastro.test.tsx}` | novos | tela de cadastro |
| `src/app/(publico)/confirmar-email/{page.tsx, acoes.ts, estado.ts, FormularioReenvio.tsx, FormularioReenvio.module.css, FormularioReenvio.test.tsx}` | novos | resultado do link e reenvio |
| `src/app/(publico)/entrar/{estado.ts, FormularioEntrar.tsx, FormularioEntrar.test.tsx, acoes.ts, page.tsx}` | alterados | botão de reenvio no caso não confirmado |
| `tests/integration/auth/{cadastro, cadastro-concorrencia, confirmacao-email, repos-cadastro, cadastro-paginas}.test.ts` | novos | integração |
| `tests/integration/auth/{login, paginas}.test.ts` | alterados | novo campo do resultado/estado |
| `e2e/cadastro.spec.ts` | novo | teclado + axe, sem banco |
| `README.md` | alterado | seção "Cadastro do salão e confirmação de e-mail" |

Não mudam: `prisma/**`, `src/server/env.ts`, `.env.example`, `next.config.ts`, `src/proxy.ts`, `src/config/navegacao.ts`, `tests/support/**`, `.github/**`, `Dockerfile`, `docker-compose.yml`, `vitest.config.ts`, `playwright.config.ts`. Nenhum arquivo `*.acao.ts` novo (o teste de registro da D-005 continua igual): cadastro, confirmação e reenvio são pré-autenticação, como o login.

## 3. Interfaces

### 3.1 `src/lib/slug.ts` (RN-8, RN-9, RN-10; CA-2, CA-7, CA-8)

```ts
import { SEGMENTOS_RESERVADOS } from '@/config/navegacao';

export const SLUG_FALLBACK = 'salao';
export const SLUG_BASE_MAX = 50;
/** Mesmo padrão do CHECK salao_slug_formato_chk. */
export const FORMATO_SLUG: RegExp; // /^[a-z0-9]+(-[a-z0-9]+)*$/

/** RN-8: NFD sem diacríticos → minúsculas → [^a-z0-9]+ vira '-' → apara hífens → corta em 50
 *  no último hífen anterior ao limite (se houver) e apara → vazio vira 'salao'. Sempre casa FORMATO_SLUG. */
export function slugBase(nome: string): string;

/** RN-9/RN-10: primeiro de base, base-2, base-3… que não está em `reservados` nem em `ocupados`.
 *  Lança Error se `base` não casar FORMATO_SLUG (erro de programação). Termina sempre (conjuntos finitos). */
export function escolherSlugLivre(
  base: string,
  ocupados: ReadonlySet<string>,
  reservados: ReadonlySet<string> = SEGMENTOS_RESERVADOS,
): string;
```

Regras: o corte em 50 é aplicado **antes** do sufixo; a ordem do NFD é `normalize('NFD')` seguido de remoção de `\p{M}` (marcas), e só então `toLowerCase()` (ou o inverso; o resultado é o mesmo para `[a-z]`). Uma base que termina em número não recebe tratamento especial (RN-10). O parâmetro `reservados` existe só para os testes; produção usa o padrão.

### 3.2 Repositórios (`src/server/repos/`; pré-contexto, exceção documentada à RN-8)

Todos recebem `agora` explícito (relógio injetado) e nunca usam `now()` do banco para regras. Todo SQL bruto é parametrizado (`$queryRaw` com template), com casts explícitos (`::papel_usuario`, `::tipo_token`, `::timestamptz`, `::uuid`). Nenhum DTO devolve `senha_hash` nem `token_hash`.

**`src/server/repos/cadastro.ts`**
```ts
export async function emailJaCadastrado(email: string): Promise<boolean>;

export type NovoCadastro = {
  nomeSalao: string;
  slugBase: string;          // já validado por FORMATO_SLUG
  nomeGestor: string;
  email: string;             // já minúsculo
  senhaHash: string;         // calculado fora da transação
  tokenHash: string;
  expiraEm: Date;
  agora: Date;
  /** Rodadas do laço de slug (padrão 5, RN-11). Só os testes informam (0 cobre `slug_esgotado`). */
  maxRodadasSlug?: number;
};
export type ResultadoCriacao =
  | { ok: true; salaoId: string; usuarioId: string; slug: string }
  | { ok: false; motivo: 'email_existente' | 'slug_esgotado' };

/** CA-1, CA-2, CA-3, CA-7, CA-11..CA-13. Uma transação READ COMMITTED; qualquer erro desfaz tudo e é relançado. */
export async function criarSalaoComGestor(d: NovoCadastro): Promise<ResultadoCriacao>;
```
Passos dentro de `obterPrisma().$transaction(async (tx) => …, { isolationLevel: ReadCommitted })`:
1. `INSERT INTO salao (nome) VALUES ($nome) RETURNING id` (defaults da RN-3 vêm do banco; nenhum valor de configuração é passado).
2. `INSERT INTO usuario (salao_id, papel, email, nome, senha_hash) VALUES (…, 'gestor', …) ON CONFLICT (email) DO NOTHING RETURNING id`. **Sem linha** → lança um sentinela interno (`class EmailExistente`), que desfaz o salão; fora da transação vira `{ ok: false, motivo: 'email_existente' }`. Com duplo envio, a segunda transação espera a primeira no índice único e, após o commit dela, recebe "nenhuma linha" (CA-11). `email_confirmado_em` fica nulo.
3. Laço de até **5 rodadas** (RN-11): `SELECT slug FROM salao_slug WHERE slug = $base OR slug LIKE $base || '-%'` → conjunto `ocupados` → `candidato = escolherSlugLivre(base, ocupados)` → `INSERT INTO salao_slug (slug, salao_id, atual) VALUES ($candidato, $salaoId, true) ON CONFLICT (slug) DO NOTHING RETURNING slug`. Com linha → fim; sem linha (outro cadastro gravou o mesmo candidato entre o `SELECT` e o `INSERT`) → nova rodada (o novo `SELECT`, em READ COMMITTED, enxerga o commit concorrente). Esgotadas as 5 → sentinela `SlugEsgotado` → `{ ok: false, motivo: 'slug_esgotado' }`. O `LIKE` não precisa de escape: `base` casa `FORMATO_SLUG` (sem `_`/`%`); slugs como `base-salon` também voltam e só aumentam o conjunto `ocupados`, sem efeito na escolha.
4. `INSERT INTO token (usuario_id, tipo, token_hash, expira_em, criado_em) VALUES (…, 'confirmacao_email', …, $expiraEm, $agora)`.
5. Devolve `{ ok: true, salaoId, usuarioId, slug }`.

Ordem 1 → 2 → 3 escolhida de propósito: o conflito de e-mail (duplo envio) é decidido antes de tocar em `salao_slug`, então a transação perdedora não segura nem consome slug. Qualquer outro erro (por exemplo, `token_hash` duplicado no CA-13) é relançado sem tratamento e desfaz tudo.

**`src/server/repos/token-confirmacao.ts`**
```ts
export type AlvoReenvio = {
  usuarioId: string;
  email: string;
  nome: string;
  nomeSalao: string | null;
  papel: Papel;
  confirmado: boolean;
};
export async function buscarAlvoPorEmail(email: string): Promise<AlvoReenvio | null>;
/** Dono de um token `confirmacao_email` (em qualquer estado: usado, expirado, invalidado). Outro tipo → null. */
export async function buscarAlvoPorTokenHash(tokenHash: string): Promise<AlvoReenvio | null>;

export type ResultadoConsumo = 'confirmado' | 'ja_utilizado' | 'expirado_ou_substituido' | 'invalido';
/** RN-13; CA-4, CA-5, CA-14. Uma transação. */
export async function consumirTokenConfirmacao(tokenHash: string, agora: Date): Promise<ResultadoConsumo>;

/** RN-14; CA-5, CA-15. Uma transação. 'nao_aplicavel' = já confirmado ou não é gestor (corrida com o consumo). */
export async function substituirTokenConfirmacao(d: {
  usuarioId: string; tokenHash: string; expiraEm: Date; agora: Date;
}): Promise<'emitido' | 'nao_aplicavel'>;
```

`consumirTokenConfirmacao` (ordem de travas: **usuário, depois token**):
1. `SELECT usuario_id, tipo FROM token WHERE token_hash = $h` (sem trava). Ausente ou `tipo <> 'confirmacao_email'` → `'invalido'`.
2. `SELECT papel FROM usuario WHERE id = $u FOR UPDATE`. `papel <> 'gestor'` → `'invalido'` (D-8).
3. `UPDATE token SET usado_em = $agora WHERE token_hash = $h AND usado_em IS NULL AND invalidado_em IS NULL AND expira_em > $agora RETURNING id`. Sem linha → reler `usado_em`: preenchido → `'ja_utilizado'`; senão → `'expirado_ou_substituido'`.
4. `UPDATE usuario SET email_confirmado_em = $agora WHERE id = $u AND email_confirmado_em IS NULL`.
5. `UPDATE token SET invalidado_em = $agora WHERE usuario_id = $u AND tipo = 'confirmacao_email' AND usado_em IS NULL AND invalidado_em IS NULL`.
6. `'confirmado'`.

`substituirTokenConfirmacao` (mesma ordem de travas):
1. `SELECT papel, email_confirmado_em FROM usuario WHERE id = $u FOR UPDATE`. Confirmado ou não gestor → `'nao_aplicavel'`.
2. `UPDATE token SET invalidado_em = $agora WHERE usuario_id = $u AND tipo = 'confirmacao_email' AND usado_em IS NULL AND invalidado_em IS NULL` (inclui pendentes já vencidos).
3. `INSERT INTO token (…) VALUES (…, 'confirmacao_email', $tokenHash, $expiraEm, $agora)`.
4. `'emitido'`.

Consequências (spec §6, "Concorrência"): duas aberturas simultâneas serializam no passo 2 do consumo (a segunda vê `usado_em` → "já utilizado"); consumo × reenvio serializam na linha do usuário, então vale o primeiro: consumo primeiro → reenvio vê confirmado (`nao_aplicavel`, sem e-mail); reenvio primeiro → o `UPDATE` condicional do consumo não acha linha (`invalidado_em`) → "expirado ou substituído". Nunca há dois tokens válidos nem usuário confirmado com token pendente utilizável. A ordem de travas idêntica impede impasse (deadlock).

### 3.3 `src/server/auth/confirmacao-email.ts` (RN-12..RN-15, RN-19; CA-4, CA-5, CA-14..CA-16)

```ts
export const VALIDADE_CONFIRMACAO_MS = 24 * 60 * 60 * 1000;
export const LIMITE_REENVIO = 3;                         // por janela fixa de 15 min (JANELA_MS do login)
export const FORMATO_TOKEN: RegExp;                      // /^[A-Za-z0-9_-]{43}$/ (32 bytes base64url)
export const ASSUNTO_CONFIRMACAO = 'Confirme seu e-mail no Agenda Beleza';
export const MENSAGENS_CONFIRMACAO = Object.freeze({
  confirmado: 'E-mail confirmado. Agora você já pode entrar.',
  jaUtilizado: 'Este link já foi utilizado. Seu e-mail já está confirmado: você pode entrar.',
  expirado: 'Este link expirou ou foi substituído por um mais recente.',
  invalido: 'Link de confirmação inválido.',
  reenvioUniforme: 'Se houver um cadastro aguardando confirmação para este e-mail, enviamos um novo link. Ele vale por 24 horas.',
  reenvioLimite: 'Muitas solicitações. Aguarde alguns minutos e tente de novo.',
  emailInvalido: 'Informe um e-mail válido.',
});

/** Token novo (gerarToken de auth/sessao.ts), hash (hashDoToken de tenant/sessao.ts) e expira_em = agora + 24 h. */
export function novoTokenDeConfirmacao(agora: Date, gerar?: () => string): { token: string; tokenHash: string; expiraEm: Date };
/** new URL(ROTAS.confirmarEmail, appUrl) com searchParams token. Nunca usa o Host da requisição. */
export function linkDeConfirmacao(appUrl: string, token: string): string;
/** Texto puro pt-BR com nome do gestor, nome do salão, link e "24 horas". Sem html. */
export function montarEmailConfirmacao(d: { para: string; nomeGestor: string; nomeSalao: string | null; link: string }): MensagemEmail;
/** 'reenvio-confirmacao:' + SHA-256 hex do e-mail normalizado. */
export function chaveDeReenvio(emailNormalizado: string): string;

export type DepsConfirmacao = {
  agora?: Date;
  email?: PortaEmail;             // padrão integracoes().email
  appUrl?: string;                // padrão validarEnv(process.env).APP_URL
  gerarToken?: () => string;      // padrão gerarToken de auth/sessao.ts
  log?: (linha: string) => void;  // padrão console.info
};

/** RN-13. Token não-string, vazio ou fora de FORMATO_TOKEN → 'invalido' SEM consultar o banco (CA-14, 10 KB). */
export async function confirmarEmail(token: unknown, deps?: Pick<DepsConfirmacao, 'agora' | 'log'>): Promise<ResultadoConsumo>;

export type ResultadoReenvio =
  | { ok: true; mensagem: string }                                    // sempre reenvioUniforme
  | { ok: false; motivo: 'validacao'; erros: { email: string } }
  | { ok: false; motivo: 'limite'; mensagem: string };

/** RN-14. */
export async function reenviarConfirmacao(alvo: { email: unknown } | { token: unknown }, deps?: DepsConfirmacao): Promise<ResultadoReenvio>;

/** Usado por cadastro.ts e reenviarConfirmacao: envia e devolve 'enviado' | 'falhou'; captura ErroEnvioEmail/ErroValidacaoEmail e QUALQUER outro erro do adaptador, sem relançar. */
export async function enviarEmailDeConfirmacao(porta: PortaEmail, m: MensagemEmail): Promise<'enviado' | 'falhou'>;
```

`reenviarConfirmacao`:
- Por **e-mail**: valida com o mesmo esquema do login (`trim().toLowerCase().max(254).pipe(z.email())`); inválido → `validacao`. Incrementa `rate_limit_janela` com `chaveDeReenvio(email)` e `inicioDaJanela(agora)` (importados/reaproveitados de `login.ts`) **antes** de buscar; contador > 3 → `limite` (sem decremento: todo pedido conta). Depois `buscarAlvoPorEmail`.
- Por **token**: string em `FORMATO_TOKEN`, senão resposta uniforme sem efeito; `buscarAlvoPorTokenHash(hashDoToken(token))`; inexistente → resposta uniforme sem contar (não há e-mail para a chave); existente → incrementa a chave **do e-mail do alvo** (mesmo limite).
- Alvo gestor não confirmado → `substituirTokenConfirmacao`; `'emitido'` → envia **depois do commit**. Em qualquer outro caso nada é gravado nem enviado. Resposta: sempre `reenvioUniforme` (inclusive se o envio falhou; o log registra).
- Log: `{ evento: 'auth.reenvio_confirmacao', resultado: 'enviado' | 'envio_falhou' | 'ignorado' | 'limite' | 'validacao', usuarioId?, em }`. `confirmarEmail` loga `{ evento: 'auth.confirmacao_email', resultado, em }`.

### 3.4 `src/server/auth/cadastro.ts` (RN-1..RN-7, RN-11, RN-15, RN-17, RN-19; CA-1..CA-3, CA-9..CA-13, CA-17)

```ts
export const MENSAGENS_CADASTRO = Object.freeze({
  nome: 'Informe seu nome (de 2 a 100 caracteres).',
  email: 'Informe um e-mail válido.',
  senhaCurta: 'A senha precisa ter pelo menos 8 caracteres.',
  senhaLonga: 'A senha pode ter no máximo 1024 caracteres.',
  nomeSalao: 'Informe o nome do salão (de 2 a 80 caracteres).',
  emailExistente: 'Este e-mail já está cadastrado. Entre ou, se ainda não confirmou o e-mail, peça um novo link.',
  falha: 'Não foi possível concluir o cadastro. Tente de novo.',
  avisoEnvio: "Não conseguimos enviar o e-mail agora. Use 'Reenviar link' em alguns minutos.",
});

export type CampoCadastro = 'nome' | 'email' | 'senha' | 'nomeSalao';
export type DadosCadastro = { nome: string; email: string; senha: string; nomeSalao: string };
/** Puro (unidade). Todos os erros juntos. Nomes: trim + colapso de espaços; recusa \p{Cc}. Senha não aparada. */
export function validarCadastro(e: Record<CampoCadastro, unknown>):
  | { ok: true; dados: DadosCadastro }
  | { ok: false; erros: Partial<Record<CampoCadastro, string>> };

export type ResultadoCadastro =
  | { ok: true; email: string; envio: 'enviado' | 'falhou' }
  | { ok: false; motivo: 'validacao'; erros: Partial<Record<CampoCadastro, string>> }
  | { ok: false; motivo: 'email_existente'; erros: { email: string } }
  | { ok: false; motivo: 'falha'; mensagem: string };

export type DepsCadastro = DepsConfirmacao & { hashSenha?: (senha: string) => Promise<string> }; // padrão gerarHashSenha

export async function cadastrar(e: Record<CampoCadastro, unknown>, deps?: DepsCadastro): Promise<ResultadoCadastro>;
```
Ordem: `validarCadastro` (falha → retorna sem banco, sem hash, sem e-mail) → `emailJaCadastrado` (sim → `email_existente`, sem hash) → `hashSenha` → `novoTokenDeConfirmacao` → `criarSalaoComGestor` (`email_existente` → idem; `slug_esgotado` ou exceção → `falha`, detalhe só no log sem dados pessoais) → `enviarEmailDeConfirmacao` (após o commit) → `{ ok: true, envio }`. Log `{ evento: 'auth.cadastro', resultado: 'ok' | 'ok_envio_falhou' | 'email_existente' | 'validacao' | 'falha', salaoId?, usuarioId?, em }`. A senha volta vazia em qualquer estado da tela (a casca nunca a ecoa).

O e-mail de super admin ou de profissional recai no `email_existente` (RN-1; D-2). O papel nunca vem do formulário.

### 3.5 `src/server/auth/login.ts` (RN-16; CA-6)
Única mudança: `ResultadoLogin` recusado ganha `reenvioDisponivel?: true`, preenchido **só** no ramo `!usuario.emailConfirmado` (depois da senha conferida). Os outros ramos, a ordem, as mensagens e o rate limit não mudam. Teste novo em `login.test.ts`: senha errada / e-mail inexistente / super admin **sem** `reenvioDisponivel`; não confirmado **com**.

### 3.6 Telas e ações (`src/app/(publico)/`)

Padrão da D-010: estado em `estado.ts` sem imports de servidor; componente cliente recebe a ação por prop (testável em jsdom); ação em `acoes.ts` com `'use server'`, nome fora de `*.acao.ts`; páginas compõem `PublicLayout`. Caminhos só via `ROTAS`. CSS só com `var(--…)`.

**`/cadastro`**
- `estado.ts`: `EstadoCadastro = { status: 'editando' | 'sucesso'; mensagem: string | null; erros: Partial<Record<'nome'|'email'|'senha'|'nomeSalao', string>>; valores: { nome: string; email: string; nomeSalao: string }; avisoEnvio: string | null }` e `ESTADO_INICIAL_CADASTRO` congelado. Nunca contém senha.
- `acoes.ts`: `cadastrarAcao(anterior, formData)` lê os 4 campos (não-string → `''`), chama `cadastrar`, devolve o estado (valores aparados e cortados nos tetos de RN-7 para não ecoar 10 KB). Sucesso → `status: 'sucesso'` com o e-mail normalizado e `avisoEnvio` quando `envio = 'falhou'`. Sem `redirect`, sem cookie.
- `FormularioCadastro.tsx`: `useActionState`; `<form action noValidate>` com `Field`s "Seu nome" (`autoComplete="name"`), "E-mail" (`type="email"`, `autoComplete="email"`), "Senha" (`type="password"`, `autoComplete="new-password"`, ajuda "Mínimo de 8 caracteres"), "Nome do salão" (`autoComplete="organization"`); `Button` com `ocupado={pendente}`; `Alert` para `mensagem` (`email_existente` também aparece no campo e-mail, com links para `ROTAS.entrar` e `ROTAS.confirmarEmail`); link "Já tenho conta". Em `sucesso`: substitui o formulário por `h2` "Verifique seu e-mail", texto com o e-mail e a validade de 24 h, `Alert` de aviso se `avisoEnvio`, link "Reenviar link" para `ROTAS.confirmarEmail`.
- `page.tsx`: `metadata.title = 'Criar conta do salão'`; `h1`; não consulta banco nem sessão.

**`/confirmar-email`**
- `page.tsx`: `export const metadata = { title: 'Confirmar e-mail', referrer: 'no-referrer' }`. Lê `searchParams.token`:
  - **ausente** (`undefined`): não chama serviço; `h1` "Reenviar link de confirmação" + `FormularioReenvio` modo `email` (sem banco; usado pelo E2E).
  - **presente** (string, inclusive vazia, ou array → tratado como inválido): `await confirmarEmail(token)` e renderiza por resultado: `confirmado` → `Alert` sucesso + link `ROTAS.entrar`; `ja_utilizado` → texto + link `ROTAS.entrar`, sem reenvio; `expirado_ou_substituido` → texto + `FormularioReenvio` modo `token` (o token vai em `<input type="hidden">`, enviado por POST, nunca em URL nova); `invalido` → texto + `FormularioReenvio` modo `email`.
  - O token nunca é logado nem ecoado em texto visível. A página não carrega recursos de terceiros (fontes locais).
- `estado.ts`: `EstadoReenvio = { mensagem: string | null; variante: 'sucesso' | 'erro' | null; erroEmail: string | null; email: string }` e `ESTADO_INICIAL_REENVIO`.
- `acoes.ts`: `reenviarConfirmacaoAcao(anterior, formData)`: se houver `token` (string) → `reenviarConfirmacao({ token })`, senão `reenviarConfirmacao({ email })`; mapeia para `EstadoReenvio` (uniforme → `sucesso`; limite → `erro`; validação → `erroEmail`).
- `FormularioReenvio.tsx` (cliente): props `{ acao; modo: 'email' | 'email-oculto' | 'token'; email?: string; token?: string }`. `email` → campo "E-mail" visível; `email-oculto` → `<input type="hidden" name="email">` (uso em `/entrar`); `token` → `<input type="hidden" name="token">`. Botão "Reenviar link de confirmação" com estado ocupado; `Alert` anunciado com a mensagem.

**`/entrar`**
- `estado.ts`: `EstadoEntrar` ganha `reenvioDisponivel: boolean` (inicial `false`).
- `acoes.ts`: copia `r.reenvioDisponivel === true` para o estado.
- `FormularioEntrar.tsx`: nova prop `acaoReenvio`; quando `estado.reenvioDisponivel`, renderiza **depois** do `</form>` de login (formulários irmãos, nunca aninhados) um `FormularioReenvio` modo `email-oculto` com `estado.email`.
- `page.tsx`: passa `acaoReenvio={reenviarConfirmacaoAcao}`.

### 3.7 Suporte de teste
Sem mudança em `tests/support/**`. Os testes usam:
- `deps.agora` (relógio), `deps.gerarToken` (token conhecido, CA-13), `deps.hashSenha` (contador de chamadas, CA-10), `deps.email` (adaptador de teste que lança `ErroEnvioEmail('conexao', true)`, CA-17; ou o simulado padrão), `deps.log` (captura, CA-19), `deps.appUrl` (valor fixo nas asserções do link).
- O token do link é extraído do `email_log.corpo` por expressão regular sobre `APP_URL + '/confirmar-email?token='`.
- Nomes de salão com literal esperado (`Studio Bela`, `Painel`, `!!!`) ficam cada um em **um único** arquivo de teste (a base é recriada por arquivo); os demais testes usam nomes únicos.
- `vi.mock('next/headers')`/`vi.mock('next/navigation')` como em `paginas.test.ts` quando a casca de `/entrar` é exercitada.

## 4. Dados (DBA: **dispensado**)

Motivo: nenhuma migração, tabela, coluna, enum, índice ou constraint muda (§0). Os pontos que a spec pediu para avaliar (§8):
1. **Colisão de slug na transação** — resolvida sem abortar a transação: `INSERT … ON CONFLICT (slug) DO NOTHING RETURNING` sobre a PK `salao_slug_pkey`, com nova rodada (até 5). Em READ COMMITTED, a transação concorrente espera o desfecho da outra no índice único e então insere ou não; o `SELECT` da rodada seguinte vê o commit.
2. **Busca dos sufixos** — `slug = $base OR slug LIKE $base || '-%'` na tabela pequena da v1; sem escape necessário (base no formato do CHECK). Em collation não-C o `LIKE` por prefixo pode não usar a PK; aceitável no volume da v1 (registrado como R-8).
3. **Índice parcial em `token`** — desnecessário: a busca por `token_hash` usa o UNIQUE e a invalidação por usuário usa `token_usuario_id_tipo_idx`.
4. **E-mail único sob concorrência** — `ON CONFLICT (email) DO NOTHING` sobre `usuario_email_key` (árbitro existente).
5. **Travas** — `SELECT … FOR UPDATE` na linha de `usuario` antes de qualquer escrita em `token`, nas duas funções que mexem em token existente (ordem única, §3.2).

Gatilho para acionar o DBA: necessidade de migração (por exemplo, se o tester encontrar dois tokens válidos simultâneos e se decidir por índice parcial), mudança de isolamento, ou de SQL além do descrito no §3.2.

## 5. Infraestrutura (DevOps: **dispensado**)

1. Nenhuma variável de ambiente nova: `APP_URL` já existe e o README passa a destacar que, em produção, ela **monta o link de confirmação**. As constantes (24 h, 3/15 min, 5 rodadas, 50 caracteres) ficam no código.
2. Nenhum arquivo de infraestrutura muda (`Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`, `vitest.config.ts`, `playwright.config.ts`, `next.config.ts`).
3. Testes novos de integração entram no job `testes` existente (que tem PostgreSQL); `e2e/cadastro.spec.ts` é coletado pelo `testMatch` atual e **não usa banco** (D-11), cabendo no job `e2e`.
4. Observabilidade: linhas JSON `auth.cadastro`, `auth.confirmacao_email`, `auth.reenvio_confirmacao` no stdout, no mesmo padrão de `auth.login`.

Gatilho para acionar o DevOps: E2E com banco (PostgreSQL no job `e2e`), variável nova, ou SMTP real exigindo ajuste de rede/timeout na implantação.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como foi atendida |
|---|---|---|
| Escopo por salão no servidor | **Sim** | Cadastro, confirmação e reenvio são pré-autenticação sobre tabelas globais (`usuario`, `token`, `salao_slug`, `rate_limit_janela`), por funções pré-contexto documentadas como exceção. Nenhum campo do formulário define `salao_id` ou papel. Após o login vale o isolamento da D-005/D-010; o CA-18 prova com dois salões **criados por este fluxo** que o gestor de B vê só B e recebe `NaoEncontrado` em recurso de A. |
| Exclusion constraint anti-sobreposição | Não | Nenhuma escrita em `reserva`. |
| UTC + fuso do salão | **Sim** (parcial) | `expira_em`, `usado_em`, `invalidado_em`, `email_confirmado_em` e a janela do rate limit são instantes UTC com relógio injetado; a validade de 24 h independe do fuso (CA-5 testa T+24h−1s / T+24h / T+24h+1s). O salão nasce com `fuso = 'America/Sao_Paulo'`, grade 15, antecedência 120, janela 60, intervalo 0 pelos defaults do banco (CA-1). |
| Adaptadores de integração | **Sim** | E-mail só por `integracoes().email` (lint RN-16 da D-007), injetável por `deps.email`. Nada de SMTP no domínio. Falha do adaptador não desfaz o cadastro nem o reenvio (CA-17). Sem Turnstile (D-5). |
| Soft delete / anonimização | Não | Nada é apagado; tokens são invalidados (`invalidado_em`), nunca removidos. |
| Salão suspenso somente leitura | Não | Salão recém-criado sem assinatura (conta provisória, S9); `politica.ts` continua `permitirTudo`; E6.4 trata. Nenhuma linha em `assinatura` é criada (CA-1). |
| Idempotência de webhooks e mensagens | Análogo | Não há webhook nem WhatsApp. Duplo envio do cadastro cria um único salão (CA-11); consumo do link é de uso único e atômico (CA-14); reenvio substitui sem duplicar tokens válidos (CA-15). |
| Auditoria do super admin | Não | O fluxo não é de super admin; o e-mail de um super admin é recusado no cadastro (RN-1). |
| Sigilo (D-010 RN-22) | **Sim** | Banco guarda só SHA-256 do token; link montado com `APP_URL`; chave do rate limit é hash do e-mail; logs sem e-mail/senha/token/hash (CA-19); `referrer: no-referrer` na página do token. O texto completo do e-mail só vai a `email_log` no modo simulado (D-007). |
| Slugs reservados (memória do projeto) | **Sim** | `escolherSlugLivre` usa `SEGMENTOS_RESERVADOS` como colisão (D-1); CA-7 em unidade (todo item do conjunto) e integração. |

## 7. Riscos e decisões

### 7.1 Decisões D-1..D-13 da spec

| ID | Situação | Observação |
|---|---|---|
| D-1 | **Confirmada** | Reservado = colisão, começa em `-2`. |
| D-2 | **Confirmada** | Consequência: a diferença de tempo do reenvio (envio síncrono só para quem existe e não confirmou) também revela existência; aceito porque o próprio cadastro já revela (R-4). |
| D-3 | **Confirmada** | Envio síncrono após o commit. Pior caso SMTP ≈ 30 s (3 × 10 s de timeout) numa requisição de cadastro; o botão fica ocupado e o resultado é gravado antes do envio. Rever se a E1.3/E1.4 adotarem fila de e-mail. |
| D-4 | **Confirmada** | 3/15 min por e-mail, contando todo pedido (sem decremento). Reenvio por token desconhecido não conta (não há e-mail para chave) e não grava nada. |
| D-5 | **Confirmada** | Sem Turnstile nem limite por IP no cadastro (R-7). |
| D-6 | **Confirmada** | Consumo no GET; a mensagem de "já utilizado" diz que o e-mail está confirmado e oferece `/entrar`. |
| D-7 | **Confirmada** | Sem login automático. |
| D-8 | **Confirmada** | Token de outro papel → "inválido"; reenvio só para gestor. |
| D-9 | **Confirmada** | Sem perfil de profissional. |
| D-10 | **Confirmada** | Sem limpeza (pendência E9.x). |
| D-11 | **Alterada (inclui E2E sem banco)** | `e2e/cadastro.spec.ts`: `/cadastro` (ordem de Tab, envio vazio mostra os erros de validação — a ação retorna antes de qualquer acesso ao banco —, foco/`aria-describedby`, sem rolagem horizontal em 375 px, axe zero violações no estado inicial e com erros) e `/confirmar-email` sem `token` (formulário de reenvio; axe). Sem PostgreSQL no job `e2e`; DevOps segue dispensado. Fluxo completo com banco fica coberto pela integração. |
| D-12 | **Confirmada** | Sem "confirmar senha". |
| D-13 | **Confirmada** | Limites de tamanho. |
| D-14 | **Nova** | `/confirmar-email` **sem** parâmetro `token` mostra o formulário de reenvio (título "Reenviar link de confirmação"), não a mensagem "inválido"; `?token=` vazio, malformado ou desconhecido → "inválido" + reenvio. O serviço `confirmarEmail` continua devolvendo `invalido` para ausente/vazio (CA-14). Motivo: o link "Reenviar link" do sucesso do cadastro e do erro de e-mail existente aponta para essa página. |
| D-15 | **Nova** | Proteção de `Referer` por `metadata.referrer = 'no-referrer'` (sem redirecionamento pós-consumo). |
| D-16 | **Nova** | Unicidade e colisão garantidas por `ON CONFLICT … DO NOTHING RETURNING` (sem captura de erro de constraint) e ordem de travas `usuario` → `token` (§3.2). |

### 7.2 Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-1 | Impasse entre consumo e reenvio | Ordem única de travas (usuário com `FOR UPDATE` antes de tocar `token`); teste de corrida reenvio × consumo repetido 10× (CA-14/CA-15, `cadastro-concorrencia.test.ts`). |
| R-2 | Scanner de e-mail consome o link antes da pessoa | D-6: mensagem de "já utilizado" informa que o e-mail está confirmado e leva a `/entrar`. |
| R-3 | SMTP lento segura a requisição | D-3; timeouts de 10 s do adaptador real; o cadastro já está gravado antes do envio. |
| R-4 | Enumeração de e-mails | Aceita no cadastro (CA-3, D-2); reenvio com resposta uniforme e limite; login inalterado (reenvio só após provar a senha). |
| R-5 | Página com efeito colateral no GET renderizada duas vezes (pré-carregamento) | Consumo idempotente: a segunda renderização mostra "já utilizado" com o e-mail confirmado; nenhuma mudança de estado indevida. `/confirmar-email` não é alvo de `<Link>` com `token`. |
| R-6 | Build tentar pré-renderizar `/confirmar-email` | A página lê `searchParams` antes de qualquer chamada ao serviço (dinâmica); o T-8 confere `ƒ /confirmar-email` no relatório do build. |
| R-7 | Criação em massa de contas com e-mails distintos | D-5; cada endereço recebe no máximo um e-mail de cadastro; reavaliar com a E4.2 (limite por IP). |
| R-8 | `LIKE` por prefixo sem índice em collation não-C | Volume pequeno na v1; se crescer, DBA avalia índice `text_pattern_ops` (pendência). |
| R-9 | Mudança do estado de `/entrar` quebrar `paginas.test.ts`/`FormularioEntrar.test.tsx` | Os dois arquivos estão sob posse das tarefas que mudam o estado (T-6 e T-7). |
| R-10 | Conflitos de slug literal entre testes do mesmo arquivo | Regra do §3.7 (cada literal esperado em um único arquivo; nomes únicos nos demais). |
| R-11 | Custo de argon2 nos testes de concorrência | ≈ 13 ms por hash; o CA-11/CA-12 fazem 2 hashes por repetição. |
| R-12 | Cobertura de cascas (`page.tsx`, `acoes.ts`) | Integração com `renderToStaticMarkup` e ações chamadas diretamente (padrão D-010), em `cadastro-paginas.test.ts`. |
| R-13 | `/confirmar-email` com sessão aberta de outro usuário | A página não lê sessão; confirmar não altera nenhuma sessão (RN-18). |

## 8. Estratégia de testes

**Unitário** (`src/**/*.test.ts(x)`, sem banco):
- `src/lib/slug.test.ts` (CA-8, CA-7 unidade, CA-2 lógica): exemplos da spec; 80 caracteres → ≤ 50 sem hífen final; propriedade "toda saída casa `FORMATO_SLUG`" sobre uma tabela de entradas difíceis (emoji, `ß`, `ø`, controle, só hífens); `escolherSlugLivre` com ocupados `{base, base-2}` → `base-3`; para **todo** item de `SEGMENTOS_RESERVADOS` que casa o formato → `<item>-2`; nenhuma escolha devolve item do conjunto; base inválida lança.
- `src/server/auth/cadastro.test.ts` (CA-10 validação): cada entrada inválida da spec, tipos errados, 10 KB, `\u0000`, quebra de linha no nome, e-mail com quebra de linha; todos os erros juntos; senha de 8 espaços aceita; e-mail normalizado; colapso de espaços.
- `src/server/auth/confirmacao-email.test.ts`: `linkDeConfirmacao` (com e sem barra final em `APP_URL`, token codificado), `montarEmailConfirmacao` (assunto, nome, salão, link, "24 horas", sem `html`), `novoTokenDeConfirmacao` (43 caracteres, hash = `hashDoToken`, `expiraEm` = +24 h), `chaveDeReenvio` (sem e-mail em claro), `FORMATO_TOKEN`; `enviarEmailDeConfirmacao` com porta que lança cada tipo de erro → `'falhou'`.
- jsdom: `FormularioCadastro.test.tsx`, `FormularioReenvio.test.tsx`, `FormularioEntrar.test.tsx` (CA-20 componente; CA-6 botão só quando `reenvioDisponivel`): rótulos associados, `type`/`autocomplete`, `aria-describedby` dos erros, `Alert` anunciado, senha nunca volta, `<form action>` presente, campos ocultos por modo, formulários não aninhados.

**Integração** (PostgreSQL real; um arquivo = uma base):
- `tests/integration/auth/repos-cadastro.test.ts` (T-2): `criarSalaoComGestor` (sucesso, `email_existente` sem resíduo, `slug_esgotado` com `maxRodadasSlug: 0` sem resíduo; nova rodada provada fazendo o `ON CONFLICT` perder: outra conexão insere o mesmo candidato numa transação aberta antes e confirma depois, e o cadastro grava `base-2`), `token_hash` duplicado desfaz tudo; `consumirTokenConfirmacao` em todos os resultados; `substituirTokenConfirmacao` (emitido / nao_aplicavel); `buscarAlvoPor*`.
- `tests/integration/auth/confirmacao-email.test.ts` (T-3): CA-5 (limites T+24h−1s, T+24h, T+24h+1s; reenvio pelo token expirado; novo link confirma), CA-7 integração (`Painel` → `painel-2`, via repositório), CA-8 integração (`!!!`, `@@` → `salao`, `salao-2`), CA-14 (outro tipo, ausente, vazio, 10 KB sem consulta — verificado contando consultas ou garantindo que nenhuma linha muda), CA-15, CA-16 (janela seguinte com relógio).
- `tests/integration/auth/cadastro.test.ts` (T-4, arquivo da issue): CA-1, CA-2 (inclui slug histórico `atual = false`), CA-3 (três casos de dono do e-mail; contagem das 5 tabelas), CA-4, CA-5 (fluxo pelo cadastro), CA-6 (núcleo: `entrar` com `reenvioDisponivel`; `reenviarConfirmacao` grava token e e-mail; contraprova senha errada; após confirmar, login cria sessão e destino `/painel`), CA-9, CA-10 (sem efeitos; `hashSenha` instrumentado não chamado), CA-13 (`gerarToken` fixo + token pré-existente com o mesmo hash → nada gravado, nenhum e-mail, resultado `falha`), CA-17, CA-19 (logs capturados).
- `tests/integration/auth/cadastro-concorrencia.test.ts` (T-4): CA-11 (mesmo formulário `Promise.all` ×10 com e-mails distintos por repetição), CA-12 (`Studio Bela <n>` em pares ×10 → `{base, base-2}`), CA-14 paralelo (dupla abertura ×10), corrida reenvio × consumo ×10 (nunca dois tokens válidos; nunca confirmado com pendente válido).
- `tests/integration/auth/login.test.ts` (T-5): `reenvioDisponivel` presente só no não confirmado.
- `tests/integration/auth/cadastro-paginas.test.ts` (T-7): `cadastrarAcao` (sucesso, erro, e-mail existente, aviso de envio; senha nunca no estado), `PaginaConfirmarEmail` renderizada por `renderToStaticMarkup` em cada resultado (CA-4/CA-5 tela, `meta name="referrer" content="no-referrer"` via `metadata` exportado), sem `token` → formulário sem consulta, `reenviarConfirmacaoAcao` (por e-mail, por token, limite), `entrarAcao` devolvendo `reenvioDisponivel` (CA-6 casca), CA-18 (dois salões cadastrados e confirmados por este fluxo; `entrarDeVerdade` do gestor B; `/painel` mostra o nome de B e não o de A; `TenantContext` de B recebe `NaoEncontrado` ao ler um serviço de A criado por `criarServico`).
- `tests/integration/auth/paginas.test.ts` (T-7): ajustes do novo campo `reenvioDisponivel` (`false` nos casos existentes).

**E2E** (`e2e/cadastro.spec.ts`, Playwright 375×812, sem banco): CA-20 (Tab: Seu nome → E-mail → Senha → Nome do salão → Criar conta → Já tenho conta; envio vazio exibe os 4 erros associados; sem rolagem horizontal; axe zero violações com `analisarComAxe` de `e2e/suporte/vitrine.ts`), `/confirmar-email` sem token (axe; campo e botão por teclado).

**Gates (CA-21)**: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:coverage` (≥ 90%), `npm run test:e2e`; laço de estabilidade `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/cadastro-concorrencia.test.ts || break; done`.

**Cobertura ≥ 90%**: todo arquivo novo de `src/` tem teste direto (puros por unidade; repositórios, serviços, `acoes.ts` e `page.tsx` por integração; componentes cliente por jsdom). Nenhuma exclusão nova em `vitest.config.ts`. O T-8 registra no `dev.md` o percentual global e a cobertura por arquivo de `src/lib/slug.ts`, `src/server/repos/{cadastro,token-confirmacao}.ts`, `src/server/auth/{cadastro,confirmacao-email,login}.ts` e `src/app/(publico)/{cadastro,confirmar-email,entrar}/**`.

## 9. Tarefas

DBA e DevOps dispensados (§4, §5). Todas as tarefas de implementação são do `desenvolvedor`; uma pessoa pode executá-las em sequência (T-1 → T-8).

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | desenvolvedor | — | T-5, T-6 | `src/lib/slug.ts`, `src/lib/slug.test.ts` |
| T-2 | desenvolvedor | T-1 | T-5, T-6 | `src/server/repos/cadastro.ts`, `src/server/repos/token-confirmacao.ts`, `tests/integration/auth/repos-cadastro.test.ts` |
| T-3 | desenvolvedor | T-2 | T-5, T-6 | `src/server/auth/confirmacao-email.ts`, `src/server/auth/confirmacao-email.test.ts`, `tests/integration/auth/confirmacao-email.test.ts` |
| T-4 | desenvolvedor | T-3, T-5 | T-6 | `src/server/auth/cadastro.ts`, `src/server/auth/cadastro.test.ts`, `tests/integration/auth/cadastro.test.ts`, `tests/integration/auth/cadastro-concorrencia.test.ts` |
| T-5 | desenvolvedor | — | T-1, T-2, T-3, T-6 | `src/server/auth/login.ts`, `tests/integration/auth/login.test.ts` |
| T-6 | desenvolvedor | — | T-1..T-5 | `src/app/(publico)/cadastro/{estado.ts, FormularioCadastro.tsx, FormularioCadastro.module.css, FormularioCadastro.test.tsx}`, `src/app/(publico)/confirmar-email/{estado.ts, FormularioReenvio.tsx, FormularioReenvio.module.css, FormularioReenvio.test.tsx}`, `src/app/(publico)/entrar/{estado.ts, FormularioEntrar.tsx, FormularioEntrar.module.css, FormularioEntrar.test.tsx}` |
| T-7 | desenvolvedor | T-4, T-6 | — | `src/app/(publico)/cadastro/{page.tsx, acoes.ts}`, `src/app/(publico)/confirmar-email/{page.tsx, acoes.ts}`, `src/app/(publico)/entrar/{page.tsx, acoes.ts}`, `tests/integration/auth/cadastro-paginas.test.ts`, `tests/integration/auth/paginas.test.ts` |
| T-8 | desenvolvedor | T-7 | — | `e2e/cadastro.spec.ts`, `README.md`, `docs/demandas/D-011/dev.md` |
| T-9 | tester | T-8 | — | `docs/demandas/D-011/testes.md` |

Rodadas sem arquivo em comum:
- **Rodada 1:** T-1 ‖ T-5 ‖ T-6.
- **Rodada 2:** T-2 (‖ T-5/T-6 remanescentes).
- **Rodada 3:** T-3.
- **Rodada 4:** T-4.
- **Rodada 5:** T-7.
- **Rodada 6:** T-8.
- **Rodada 7:** T-9.

Observações de posse: um defeito achado numa rodada posterior num arquivo de outra tarefa reabre a tarefa dona (sem edição cruzada). `CLAUDE.md` ("Project status" e a linha de comandos do E2E/laço de estabilidade) é do **líder** ao encerrar; o T-8 entrega o texto sugerido no `dev.md`. Ninguém edita `src/config/navegacao.ts`, `tests/support/**`, `prisma/**` nem `tests/integration/tenant/fixtures/registro/**`.

**T-1 — Slug puro.**
- Entregável: §3.1 com testes unitários (CA-7 unidade, CA-8 unidade).
- Conclusão: `npx vitest run src/lib/slug.test.ts` verde; `slug.ts` importa só `@/config/navegacao`; nenhuma cópia literal da lista de reservados (`grep -n "'painel'" src/lib/slug.ts` vazio); lint e typecheck verdes.

**T-2 — Repositórios pré-contexto.**
- Entregável: §3.2 com `repos-cadastro.test.ts` (ON CONFLICT de e-mail e de slug, nova rodada de slug sob concorrência real, desfazer em erro, todos os resultados de consumo/substituição, ordem de travas).
- Conclusão: `npx vitest run --project integration tests/integration/auth/repos-cadastro.test.ts` verde 10× seguidas; nenhum DTO expõe `senha_hash`/`token_hash`; nenhum `now()` do banco em regra de validade; cabeçalho de cada arquivo documenta a exceção à RN-8; lint e typecheck verdes.

**T-3 — Serviço de confirmação e reenvio.**
- Entregável: §3.3; testes unitários e `confirmacao-email.test.ts` (CA-5, CA-7 int., CA-8 int., CA-14, CA-15, CA-16).
- Conclusão: arquivos verdes; `grep -rn "integrations/email/\(real\|simulado\)" src/server/auth` vazio (só `registry.ts` e `email/port` por tipo); `confirmarEmail` com 10 KB não consulta o banco; lint e typecheck verdes.

**T-4 — Serviço de cadastro.**
- Entregável: §3.4; `cadastro.test.ts` (unidade, CA-10), `tests/integration/auth/cadastro.test.ts` (CA-1..CA-6, CA-9, CA-10 efeitos, CA-13, CA-17, CA-19) e `cadastro-concorrencia.test.ts` (CA-11, CA-12, CA-14 paralelo, corrida reenvio × consumo).
- Conclusão: arquivos verdes; `cadastro-concorrencia.test.ts` verde 10× seguidas pelo laço do §8; hash calculado fora da transação (revisão de código); lint e typecheck verdes.

**T-5 — Login com indicação de reenvio.**
- Entregável: §3.5 e o caso novo em `login.test.ts`.
- Conclusão: `npx vitest run --project integration tests/integration/auth/login.test.ts` verde 10× (laço de estabilidade da D-010); mensagens e ordem inalteradas (`git diff src/server/auth/login.ts` restrito ao tipo e ao ramo não confirmado); lint e typecheck verdes.

**T-6 — Componentes cliente e estados.**
- Entregável: §3.6 (estados e formulários de `/cadastro`, `/confirmar-email`, `/entrar`) com testes jsdom (CA-20 componente; botão de reenvio do CA-6).
- Conclusão: `npm run test:unit -- "src/app/(publico)"` verde; nenhum import de `@/server` em tempo de execução nos `estado.ts`/`Formulario*.tsx` (só `import type`); CSS só com `var(--…)` (varreduras da D-009 verdes); lint e typecheck verdes.

**T-7 — Casca Next.**
- Entregável: §3.6 (`page.tsx` e `acoes.ts` das três rotas) e `cadastro-paginas.test.ts` (CA-4/CA-5 tela, CA-6 casca, CA-18, ações), ajustes em `paginas.test.ts`.
- Conclusão: `npx vitest run --project integration tests/integration/auth` verde; `npm run build` verde com `ƒ /confirmar-email` (dinâmica); `tests/integration/tenant/registro.test.ts` verde (nenhum `*.acao.ts` novo); nenhum `redirect` dentro de `catch`; lint e typecheck verdes.

**T-8 — E2E, documentação e gates.**
- Entregável: `e2e/cadastro.spec.ts` (CA-20 E2E); README: seção "Cadastro do salão e confirmação de e-mail" (fluxo, mensagens, validade 24 h, uso único, reenvio 3/15 min, slugs reservados e sufixo, como ler o link em `email_log` no modo simulado — por exemplo `docker compose exec postgres psql -U agenda agenda_beleza -c "select corpo from email_log order by criado_em desc limit 1"` —, `APP_URL` correto em produção, nenhuma credencial nova); `dev.md` com evidências e texto sugerido para o `CLAUDE.md`.
- Conclusão: `npm run lint`, `typecheck`, `build`, `npm test`, `npm run test:coverage` (≥ 90%, percentual e cobertura dos arquivos novos registrados), `npm run test:e2e` verdes; prova manual com Docker (`docker compose up -d --wait`; cadastro em `/cadastro`; link lido de `email_log`; `/confirmar-email?token=…` → confirmado; login → `/painel`) registrada no `dev.md`.

**T-9 — Validação independente (tester).**
- Entregável: `testes.md` com veredito; repetir gates, laços de estabilidade (T-2, T-4, T-5) e a prova Docker; conferir o mapa abaixo.

### Mapa CA → tarefa → tipo de teste

| CA | Tarefa(s) | Tipo de teste | Arquivo |
|---|---|---|---|
| CA-1 | T-2, T-4 | Integração | `repos-cadastro.test.ts`, `cadastro.test.ts` |
| CA-2 | T-1, T-4 | Unitário + integração | `slug.test.ts`, `cadastro.test.ts` |
| CA-3 | T-2, T-4 | Integração | `repos-cadastro.test.ts`, `cadastro.test.ts` |
| CA-4 | T-3, T-4, T-7 | Integração (serviço + página) | `cadastro.test.ts`, `cadastro-paginas.test.ts` |
| CA-5 | T-3, T-4, T-7 | Integração (relógio) | `confirmacao-email.test.ts`, `cadastro.test.ts`, `cadastro-paginas.test.ts` |
| CA-6 | T-5, T-4, T-6, T-7 | Integração + jsdom | `login.test.ts`, `cadastro.test.ts`, `FormularioEntrar.test.tsx`, `cadastro-paginas.test.ts` |
| CA-7 | T-1, T-3 | Unitário + integração | `slug.test.ts`, `confirmacao-email.test.ts` |
| CA-8 | T-1, T-3 | Unitário + integração | `slug.test.ts`, `confirmacao-email.test.ts` |
| CA-9 | T-4 | Integração | `cadastro.test.ts` |
| CA-10 | T-4 | Unitário + integração | `src/server/auth/cadastro.test.ts`, `cadastro.test.ts` |
| CA-11 | T-2, T-4 | Integração (concorrência ×10) | `repos-cadastro.test.ts`, `cadastro-concorrencia.test.ts` |
| CA-12 | T-2, T-4 | Integração (concorrência ×10) | `repos-cadastro.test.ts`, `cadastro-concorrencia.test.ts` |
| CA-13 | T-2, T-4 | Integração | `repos-cadastro.test.ts`, `cadastro.test.ts` |
| CA-14 | T-2, T-3, T-4 | Integração (inclui paralelo) | `repos-cadastro.test.ts`, `confirmacao-email.test.ts`, `cadastro-concorrencia.test.ts` |
| CA-15 | T-3 (+ T-4 corrida) | Integração | `confirmacao-email.test.ts`, `cadastro-concorrencia.test.ts` |
| CA-16 | T-3 | Integração (relógio) | `confirmacao-email.test.ts` |
| CA-17 | T-4, T-7 | Integração | `cadastro.test.ts`, `cadastro-paginas.test.ts` |
| CA-18 | T-7 | Integração (login real) | `cadastro-paginas.test.ts` |
| CA-19 | T-3, T-4 | Integração (log capturado) | `confirmacao-email.test.ts`, `cadastro.test.ts` |
| CA-20 | T-6, T-8 | jsdom + E2E sem banco | `Formulario*.test.tsx`, `e2e/cadastro.spec.ts` |
| CA-21 | T-8, T-9 | Gates | comandos oficiais |

## Pendências registradas (não bloqueantes)
- Limpeza de contas não confirmadas e de tokens vencidos (D-10): E9.x.
- Limite por IP / Turnstile no cadastro (D-5, R-7): reavaliar na E4.2.
- E1.3 deve aceitar usuário não confirmado e pode confirmar o e-mail ao redefinir (spec §6, "conta sequestrada").
- E1.4: conflito de e-mail de convite já usado por um gestor (spec §6).
- Índice `text_pattern_ops` para a busca de sufixos se `salao_slug` crescer (R-8): DBA, quando houver volume.
- E2E de ponta a ponta com banco no job `e2e`: quando o seed (E9.2) existir.
