# D-012 — Desenho: recuperar senha por e-mail transacional (issue #14, E1.3)

Autor: arquiteto-software. Entradas: `docs/demandas/D-012/issue-14.md` (RN-1..RN-3, CA-1..CA-4), `docs/demandas/D-012/spec.md` (RN-4..RN-18, CA-5..CA-21, D-1..D-16), `CLAUDE.md`, `docs/demandas/D-011/{design,dev,testes}.md` (padrão de token, ordem de travas, `ON CONFLICT`, DEF-1/DEF-2) e o código da branch `feat/d-012-recuperar-senha` (= `main` em `ded2afa`).

## 0. Verificações feitas antes do desenho

| Verificação | Resultado |
|---|---|
| Schema | **Nenhuma migração.** `enum TipoToken` já tem `recuperacao_senha`; `token` tem `token_hash` UNIQUE, `expira_em`, `usado_em`, `invalidado_em`, índice `(usuario_id, tipo)`; `usuario.senha_hash`, `email_confirmado_em`, `atualizado_em`; `profissional.usuario_id` (UNIQUE por salão, FK composta para `usuario`); `rate_limit_janela` PK `(chave, janela_inicio)`; `sessao.revogada_em`. |
| Reaproveitável sem alterar a D-011 | `confirmacao-email.ts` exporta `FORMATO_TOKEN`, `esquemaEmail`, `enviarEmailDeConfirmacao(porta, m)` (genérico: captura qualquer erro e devolve `'enviado' \| 'falhou'`). `registrarLog` tem o tipo de `campos` fechado (`resultado`, `salaoId?`, `usuarioId?`, `detalhe?`) e não aceita `sessoesRevogadas`; por isso o serviço novo tem o próprio registrador (5 linhas), e `confirmacao-email.ts` **não muda**. `login.ts` exporta `chaveDeLogin`, `inicioDaJanela`, `JANELA_MS`. `sessao.ts` exporta `gerarToken`; `tenant/sessao.ts`, `hashDoToken`. |
| `token-confirmacao.ts` | As consultas filtram por `tipo = 'confirmacao_email'`; a regra de elegibilidade (só gestor não confirmado) e o efeito do consumo (confirmar e-mail) são diferentes dos da recuperação. Generalizar por tipo exigiria parametrizar regra e efeito e reabrir os testes da D-011. **Decisão:** repositório novo `token-recuperacao.ts` (§3.1); `token-confirmacao.ts` não muda. O token de recuperação aberto em `/confirmar-email` já dá "inválido" (`consumirTokenConfirmacao`, passo 1). |
| Login (D-11) | `login.ts`: incremento da janela → `buscarUsuarioParaLogin` (devolve `senhaHash`) → `verificar` (injetável por `deps.verificarSenha`) → `decrementarJanela` → `iniciarSessao` → `criarSessao` (Prisma `create`, sem trava em `usuario`). A FK `sessao.usuario_id` só toma `FOR KEY SHARE`, que **não** conflita com o `UPDATE` de `senha_hash`: hoje a corrida da RN-13 existe. |
| `after()` (D-4) | Next 16.4.6. `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`: suportado em Server Functions (ações) e Server Components; executa mesmo se a resposta falhar. `02-guides/self-hosting.md:267-271`: "fully supported when self-hosting with `next start`"; no SIGTERM o servidor termina as requisições e executa os `after()` pendentes. `dist/server/after/after.js`: fora do escopo de requisição **lança** ("`after` was called outside a request scope") — logo, os serviços não podem chamá-lo; a casca injeta. A imagem roda `exec node …/next start` com `init: true` (`docker/entrypoint.sh`), então o SIGTERM chega ao Next. |
| Re-render da página no POST sem JS | `e2e/cadastro-sem-js.spec.ts`: o POST da Server Action sem JS re-renderiza a página inteira (o Server Component roda de novo com os mesmos `searchParams`). Consequência para `/redefinir-senha`: após o sucesso, a re-renderização veria o token já usado. Tratado no §3.4 (estado da ação prevalece). |
| `next.config.ts` | `headers()` devolve uma entrada (`ROTAS.confirmarEmail`). Nenhum teste de integração lê `next.config.ts`; o cabeçalho é provado no E2E (`e2e/cadastro.spec.ts:85-101`). |
| Referências existentes às rotas | `FormularioEntrar.tsx:61` e `e2e/entrar.spec.ts:31` já apontam "Esqueci minha senha" para `/recuperar-senha`; `navegacao.ts`/`SEGMENTOS_RESERVADOS` já têm as duas rotas. Nada a mudar neles. |
| Job `e2e` da CI | Sem PostgreSQL. `/recuperar-senha` com e-mail inválido e `/redefinir-senha` sem token ou com token malformado não tocam o banco (§3.3) e cabem no job. |

## 1. Resumo da solução

- **Repositório pré-contexto novo** `src/server/repos/token-recuperacao.ts`: busca do alvo por e-mail, leitura do token por hash (sem trava, sem escrita), emissão com substituição e a transação de redefinição. Ordem de travas igual à da D-011: `usuario` (`FOR UPDATE`) → `token` → `sessao` → `rate_limit_janela`.
- **Serviço sem `next/*`** `src/server/auth/recuperacao-senha.ts`: funções puras (validade, elegibilidade, link, e-mail, chave, validação de senha) e três operações: `solicitarRecuperacao`, `verificarLinkDeRedefinicao`, `redefinirSenha`.
- **D-4 adotada, ampliada:** na solicitação, o caminho síncrono é idêntico para qualquer e-mail válido (validação + incremento do limite). Tudo o que depende de o e-mail existir — busca, emissão do token e envio — vai para uma tarefa adiada por `deps.agendar`. A casca injeta `after` de `next/server`; o padrão (testes, sem casca) executa a tarefa inline e aguarda. Isso fecha o canal de tempo da D-011 neste fluxo, não só o do SMTP.
- **D-11 adotada:** o login só cria a sessão se `usuario.senha_hash` ainda for o hash verificado, com `SELECT … FOR SHARE` na mesma transação do `INSERT` (§3.2). O CA-16 vale.
- **Casca Next:** `/recuperar-senha` (formulário com resposta uniforme) e `/redefinir-senha` (Server Component que só verifica; um único componente cliente decide entre formulário, recusa e sucesso, com o estado da ação prevalecendo sobre o veredito da página). `Referrer-Policy: strict-origin` por cabeçalho em `/redefinir-senha`.
- **Testes:** unitários (puros, componentes jsdom), integração com PostgreSQL real (repositório, serviço, concorrência, casca, login) e E2E sem banco (teclado, axe, sem JS, cabeçalho).

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Generalizar `token-confirmacao.ts` por `tipo` | Regras de elegibilidade e efeitos do consumo diferentes; mexeria em código e testes estáveis da D-011 sem ganho real (o código comum são dois `UPDATE`/`INSERT` de poucas linhas). |
| Envio síncrono após o commit (padrão D-011 D-3) | Canal de tempo de enumeração (SMTP real até ~30 s só para e-mails elegíveis), já observado pelo tester na D-011. |
| `after()` só para o envio, com busca e emissão síncronas | Ainda haveria diferença de alguns ms (transação com trava + `INSERT`) entre elegível e não elegível. Adiar a tarefa inteira custa o mesmo e elimina a diferença. |
| Fila pg-boss para o e-mail | O payload só aceita IDs (`filas.ts`); o token em claro não pode ir para a fila, então o worker teria de emitir o token, o que muda o contrato e o processo responsável. `after()` resolve sem infraestrutura nova. |
| Chamar `after()` dentro do serviço | Lança fora do escopo de requisição (testes de integração, worker) e acoplaria `src/server/auth` a `next/*`. Injeção por `deps.agendar`. |
| `redirect` para `/redefinir-senha?concluido=1` (ou `/entrar?senha=redefinida`) após o sucesso | Parâmetro forjável que mostra "senha alterada" a qualquer um e exige estado na URL; o estado da ação já resolve a re-renderização sem JS (§3.4). |
| Consumir o token no GET | Contraria D-1 (scanners de e-mail queimariam o link) e a necessidade de formulário. |
| Recheque de senha na sessão a cada requisição (`senha_alterada_em` na sessão) | Exigiria migração e custo em toda requisição autenticada; a condição no `INSERT` da sessão + a revogação na mesma transação da troca bastam. |
| Índice parcial "um token pendente por usuário e tipo" | Migração; a trava do usuário já garante a propriedade (mesma decisão da D-011). |

### 1.2 Dependências novas
Nenhuma. `after` faz parte do `next` já instalado (16.4.6).

## 2. Componentes afetados

| Caminho | Situação | Papel |
|---|---|---|
| `src/server/repos/token-recuperacao.ts` | novo | alvo, leitura do token, emissão, redefinição (§3.1) |
| `src/server/repos/sessao.ts` | alterado | + `criarSessaoSeSenhaVigente` (§3.2) |
| `src/server/auth/sessao.ts` | alterado | + `iniciarSessaoSeSenhaVigente` (§3.2) |
| `src/server/auth/login.ts` | alterado | usa a função acima; decremento só após sessão criada (§3.2) |
| `src/server/auth/recuperacao-senha.ts` (+ `recuperacao-senha.test.ts`) | novo | serviço (§3.3) |
| `src/app/(publico)/recuperar-senha/{page.tsx, acoes.ts, estado.ts, FormularioRecuperar.tsx, FormularioRecuperar.module.css, FormularioRecuperar.test.tsx}` | novos | §3.4 |
| `src/app/(publico)/redefinir-senha/{page.tsx, acoes.ts, estado.ts, FormularioRedefinir.tsx, FormularioRedefinir.module.css, FormularioRedefinir.test.tsx}` | novos | §3.4 |
| `next.config.ts` | alterado | segunda entrada em `headers()` (RN-14) |
| `tests/integration/auth/repos-recuperacao.test.ts` | novo | repositório |
| `tests/integration/auth/sessao-senha-vigente.test.ts` | novo | D-11 no repositório e no login |
| `tests/integration/auth/recuperacao-senha.test.ts` | novo | arquivo da issue: serviço |
| `tests/integration/auth/recuperacao-senha-concorrencia.test.ts` | novo | CA-11, CA-16 |
| `tests/integration/auth/recuperacao-senha-paginas.test.ts` | novo | casca, `after`, `headers()` |
| `e2e/recuperar-senha.spec.ts` | novo | E2E sem banco |
| `README.md` | alterado | seção nova |

Não mudam: `prisma/**`, `src/server/env.ts`, `.env.example`, `src/proxy.ts`, `src/config/navegacao.ts`, `src/server/auth/confirmacao-email.ts`, `src/server/repos/token-confirmacao.ts`, `src/server/repos/rate-limit.ts`, `src/app/(publico)/entrar/**`, `tests/support/**`, `.github/**`, `Dockerfile`, `docker-compose.yml`, `docker/**`, `vitest.config.ts`, `playwright.config.ts`. Nenhum `*.acao.ts` novo (pré-autenticação, D-010 RN-24).

## 3. Interfaces

### 3.1 `src/server/repos/token-recuperacao.ts` (pré-contexto; exceção documentada à RN-8 da D-005)

Mesmas regras da D-011 §3.2: SQL bruto parametrizado com casts explícitos; `agora` sempre recebido (nunca `now()` do banco em regra); recebe só o **hash** do token; nenhum DTO devolve `token_hash` nem `senha_hash`; transações `ReadCommitted`; ordem de travas `usuario` → `token` → `sessao` → `rate_limit_janela`.

```ts
import type { Papel } from '@/server/tenant/context';

/** Dados de elegibilidade (RN-6). profissionalAtivo: `ativo` do perfil vinculado; null = sem perfil. */
export type PerfilElegibilidade = { papel: Papel; profissionalAtivo: boolean | null };
export type Elegibilidade = (u: PerfilElegibilidade) => boolean;

export type AlvoRecuperacao = PerfilElegibilidade & { usuarioId: string; email: string; nome: string };
/** Usuário (qualquer papel) pelo e-mail normalizado; LEFT JOIN profissional ON usuario_id. */
export async function buscarAlvoRecuperacao(email: string): Promise<AlvoRecuperacao | null>;

export type TokenRecuperacao = AlvoRecuperacao & { usadoEm: Date | null; invalidadoEm: Date | null; expiraEm: Date };
/** Só leitura, sem trava. Só tipo 'recuperacao_senha' (outro tipo → null). */
export async function buscarTokenRecuperacao(tokenHash: string): Promise<TokenRecuperacao | null>;

/** RN-9, RN-12. Uma transação. */
export async function emitirTokenRecuperacao(d: {
  usuarioId: string; tokenHash: string; expiraEm: Date; agora: Date; elegivel: Elegibilidade;
}): Promise<'emitido' | 'nao_aplicavel'>;

export type ResultadoRedefinicaoRepo =
  | { resultado: 'redefinido'; usuarioId: string; sessoesRevogadas: number }
  | { resultado: 'invalido' | 'ja_utilizado' | 'expirado_ou_substituido' | 'inelegivel' };

/** RN-11, RN-12, D-3, D-8. Uma transação; qualquer erro desfaz tudo e é relançado. */
export async function redefinirSenhaComToken(d: {
  tokenHash: string;
  senhaHash: string;          // calculado FORA da transação
  agora: Date;
  chaveLogin: string;         // chaveDeLogin(email) — calculada pelo serviço
  janelaLogin: Date;          // inicioDaJanela(agora)
  elegivel: Elegibilidade;
}): Promise<ResultadoRedefinicaoRepo>;
```

A regra de elegibilidade fica no serviço (função pura, testada por unidade) e chega ao repositório como predicado, para que a mesma regra valha na solicitação, na verificação e no recheque dentro da transação (repositório não importa de `src/server/auth`).

`emitirTokenRecuperacao`:
1. `SELECT u.papel::text, p.ativo FROM usuario u LEFT JOIN profissional p ON p.usuario_id = u.id WHERE u.id = $u FOR UPDATE OF u`. Ausente ou `!elegivel(…)` → `'nao_aplicavel'` (nada gravado).
2. `UPDATE token SET invalidado_em = $agora WHERE usuario_id = $u AND tipo = 'recuperacao_senha' AND usado_em IS NULL AND invalidado_em IS NULL` (inclui vencidos). Tokens `confirmacao_email` intocados.
3. `INSERT INTO token (usuario_id, tipo, token_hash, expira_em, criado_em) VALUES (…, 'recuperacao_senha', …)`.
4. `'emitido'`.

`redefinirSenhaComToken`:
1. `SELECT usuario_id, tipo FROM token WHERE token_hash = $h` (sem trava). Ausente ou `tipo <> 'recuperacao_senha'` → `'invalido'`.
2. `SELECT … FROM usuario u LEFT JOIN profissional p … WHERE u.id = $u FOR UPDATE OF u`. `!elegivel` → `'inelegivel'` (nada gravado; a checagem vem **antes** do consumo, então não há o que desfazer).
3. `UPDATE token SET usado_em = $agora WHERE token_hash = $h AND tipo = 'recuperacao_senha' AND usado_em IS NULL AND invalidado_em IS NULL AND expira_em > $agora`. 0 linhas → reler `usado_em`: preenchido → `'ja_utilizado'`, senão `'expirado_ou_substituido'`.
4. `UPDATE usuario SET senha_hash = $hash, atualizado_em = $agora, email_confirmado_em = COALESCE(email_confirmado_em, $agora) WHERE id = $u` (D-3; para quem já confirmou, nada muda nessa coluna).
5. `UPDATE token SET invalidado_em = $agora WHERE usuario_id = $u AND tipo IN ('recuperacao_senha','confirmacao_email') AND usado_em IS NULL AND invalidado_em IS NULL` (demais pendentes de recuperação + confirmação pendente, D-3).
6. `UPDATE sessao SET revogada_em = $agora WHERE usuario_id = $u AND revogada_em IS NULL` → `sessoesRevogadas` (contagem de linhas).
7. `DELETE FROM rate_limit_janela WHERE chave = $chaveLogin AND janela_inicio = $janelaLogin` (D-8).
8. `{ resultado: 'redefinido', usuarioId, sessoesRevogadas }`.

Consequências: dois envios do mesmo token serializam no passo 2; o segundo cai em `ja_utilizado` (CA-11a). Solicitação × redefinição serializam no usuário; vale a primeira (CA-11b): se a solicitação vence, o passo 3 da redefinição não acha linha (`invalidado_em`); se a redefinição vence, o passo 5 nada invalida do token futuro, que nasce depois e continua válido. Nunca há dois tokens `recuperacao_senha` válidos. A ordem de travas é a mesma em todas as funções que escrevem em `token` (D-011 inclusive), o que evita impasse.

### 3.2 Corrida login × redefinição (RN-13, D-11; CA-16)

`src/server/repos/sessao.ts`:
```ts
/**
 * Cria a sessão SOMENTE se `usuario.senha_hash` ainda é `senhaHash` (o hash verificado pelo login).
 * Transação: SELECT 1 FROM usuario WHERE id = $u AND senha_hash = $h FOR SHARE → sem linha: false
 * (nada gravado); com linha: INSERT da sessão (mesmos campos de criarSessao) → true.
 */
export async function criarSessaoSeSenhaVigente(d: {
  usuarioId: string; tokenHash: string; agora: Date; expiraEm: Date; senhaHash: string;
}): Promise<boolean>;
```
`src/server/auth/sessao.ts`:
```ts
/** Como iniciarSessao, mas condicionada ao hash verificado. null = a senha mudou desde a verificação. */
export async function iniciarSessaoSeSenhaVigente(usuarioId: string, senhaHash: string, agora: Date): Promise<{ token: string } | null>;
```
`src/server/auth/login.ts` (única mudança de comportamento): no ramo de sucesso, `iniciarSessaoSeSenhaVigente(usuario.id, usuario.senhaHash, agora)`. `null` → `registrar('credenciais')` e `recusa(MENSAGENS_LOGIN.credenciais)` **sem** decremento (conta como falha). Sucesso → `decrementarJanela` e depois devolve o token (o decremento passa a vir depois da sessão criada; a mensagem, a ordem das verificações e o CA-12 da D-010 continuam iguais). `iniciarSessao`/`criarSessao` continuam existindo (usados por testes e suporte).

Por que funciona (PostgreSQL, READ COMMITTED):
- `FOR SHARE` conflita com o `FOR UPDATE` e com o `UPDATE` da redefinição (a FK sozinha só toma `FOR KEY SHARE`, que não conflita).
- Redefinição trava antes: o login espera; após o commit, o PostgreSQL reavalia o `WHERE` sobre a versão nova da linha, `senha_hash` difere, sem linha → sem sessão.
- Login trava antes: a redefinição espera o commit do login no passo 2; o `UPDATE sessao` (passo 6) é um comando posterior, com instantâneo novo, e enxerga a sessão recém-criada → revogada.
- Sem impasse: a transação do login toca só `usuario` (share) e `sessao` (insert); o incremento/decremento do limite são comandos autônomos fora dela.

### 3.3 `src/server/auth/recuperacao-senha.ts` (RN-1..RN-17)

```ts
export const VALIDADE_RECUPERACAO_MS = 60 * 60 * 1000;
export const LIMITE_SOLICITACOES = 3; // por e-mail, janela fixa de 15 min (JANELA_MS do login)
export const ASSUNTO_RECUPERACAO = 'Redefinição de senha no Agenda Beleza';
export const MENSAGENS_RECUPERACAO = Object.freeze({
  uniforme: 'Se houver uma conta com este e-mail, enviamos um link para redefinir a senha. Ele vale por 1 hora.',
  limite: 'Muitas solicitações. Aguarde alguns minutos e tente de novo.',
  emailInvalido: 'Informe um e-mail válido.',
  recusado: 'Este link de redefinição é inválido, expirou ou já foi usado. Peça um novo link.',
  sucesso: 'Sua senha foi alterada. Entre com a nova senha.',
  senhaCurta: 'A senha precisa ter pelo menos 8 caracteres.',
  senhaLonga: 'A senha pode ter no máximo 1024 caracteres.',
  falha: 'Não foi possível redefinir a senha. Tente de novo.',
});

// Puras (unidade)
export function elegivelParaRecuperacao(u: PerfilElegibilidade): boolean; // gestor (qualquer confirmação) | profissional com perfil ativo
export function estadoDoToken(t: { usadoEm: Date | null; invalidadoEm: Date | null; expiraEm: Date }, agora: Date):
  'valido' | 'ja_utilizado' | 'expirado_ou_substituido'; // válido sse usado e invalidado nulos e agora < expiraEm
export function novoTokenDeRecuperacao(agora: Date, gerar?: () => string): { token: string; tokenHash: string; expiraEm: Date };
export function linkDeRedefinicao(appUrl: string, token: string): string;     // new URL(ROTAS.redefinirSenha, appUrl) + searchParams token
export function montarEmailRecuperacao(d: { para: string; nome: string; link: string }): MensagemEmail; // texto puro, sem html
export function chaveDeRecuperacao(emailNormalizado: string): string;        // 'recuperacao-senha:' + SHA-256 hex
export function validarNovaSenha(v: unknown): { ok: true; senha: string } | { ok: false; erro: string }; // não apara; 8..1024

export type DepsRecuperacao = {
  agora?: Date;
  email?: PortaEmail;                 // padrão integracoes().email (resolvido DENTRO da tarefa, com try)
  appUrl?: string;                    // padrão validarEnv(process.env).APP_URL (idem)
  gerarToken?: () => string;
  hashSenha?: (senha: string) => Promise<string>; // padrão gerarHashSenha
  log?: (linha: string) => void;      // padrão console.info
  /** D-4. Recebe a tarefa adiada; padrão: executa e aguarda inline. A casca passa `after`. */
  agendar?: (tarefa: () => Promise<void>) => void | Promise<void>;
};

export type ResultadoSolicitacao =
  | { ok: true; mensagem: string }                                   // sempre `uniforme`
  | { ok: false; motivo: 'validacao'; erros: { email: string } }
  | { ok: false; motivo: 'limite'; mensagem: string };
export async function solicitarRecuperacao(entrada: { email: unknown }, deps?: DepsRecuperacao): Promise<ResultadoSolicitacao>;

export type MotivoRecusa = 'invalido' | 'ja_utilizado' | 'expirado_ou_substituido' | 'inelegivel';
export type ResultadoVerificacao = { ok: true } | { ok: false; motivo: MotivoRecusa };
export async function verificarLinkDeRedefinicao(token: unknown, deps?: Pick<DepsRecuperacao, 'agora' | 'log'>): Promise<ResultadoVerificacao>;

export type ResultadoRedefinicao =
  | { ok: true; mensagem: string }
  | { ok: false; motivo: 'validacao'; erros: { senha: string } }
  | { ok: false; motivo: 'recusado'; detalhe: MotivoRecusa; mensagem: string }
  | { ok: false; motivo: 'falha'; mensagem: string };
export async function redefinirSenha(entrada: { token: unknown; senha: unknown }, deps?: DepsRecuperacao): Promise<ResultadoRedefinicao>;
```

Reaproveita de `confirmacao-email.ts` (import, sem alterar o arquivo): `esquemaEmail`, `FORMATO_TOKEN`, `enviarEmailDeConfirmacao` (envio genérico que nunca lança). De `login.ts`: `chaveDeLogin`, `inicioDaJanela`. De `sessao.ts`: `gerarToken`. De `tenant/sessao.ts`: `hashDoToken`. De `senha.ts`: `gerarHashSenha`. Registrador local: `JSON.stringify({ evento, resultado, detalhe?, usuarioId?, sessoesRevogadas?, em })`, nunca com e-mail, senha, token ou hash.

**`solicitarRecuperacao`** — caminho síncrono idêntico para todo e-mail válido:
1. `esquemaEmail.safeParse` → falha: log `validacao`, `{ motivo: 'validacao' }` (sem banco, não conta).
2. `incrementarJanela(chaveDeRecuperacao(email), inicioDaJanela(agora))` > 3 → log `limite`, `{ motivo: 'limite' }`.
3. `await agendar(tarefa)` e devolve `{ ok: true, mensagem: uniforme }`.

`tarefa` (nunca lança; envolve tudo em `try/catch`):
- `buscarAlvoRecuperacao(email)`; nulo ou `!elegivelParaRecuperacao` → log `ignorado`.
- `novoTokenDeRecuperacao` → `emitirTokenRecuperacao({ …, elegivel: elegivelParaRecuperacao })`; `nao_aplicavel` → log `ignorado` (com `usuarioId`).
- Resolve porta e `APP_URL` (erro → `envio_falhou`), monta o e-mail, `enviarEmailDeConfirmacao` → log `enviado` | `envio_falhou` (com `usuarioId`).
- Exceção inesperada (banco) → log `falha`, sem relançar.

Resultados de log de `auth.recuperacao_senha`: `enviado | envio_falhou | ignorado | limite | validacao | falha` (`falha` é acréscimo ao RN-15, para a tarefa adiada não morrer em silêncio).

**`verificarLinkDeRedefinicao`** (GET; só leitura): token não-string ou fora de `FORMATO_TOKEN` → `invalido` sem banco. Senão `buscarTokenRecuperacao(hashDoToken(token))`: nulo → `invalido`; `estadoDoToken` ≠ `valido` → esse motivo; `!elegivel` → `inelegivel`; senão `{ ok: true }`. Log `{ evento: 'auth.redefinicao_senha_link', resultado: 'valido' | 'recusado', detalhe? }` (acréscimo ao RN-15; sem `usuarioId`).

**`redefinirSenha`**:
1. Token não-string ou fora de `FORMATO_TOKEN` → `recusado/invalido` (sem banco, sem hash).
2. `validarNovaSenha` → erro → `validacao` (sem banco, sem hash; o token não é tocado).
3. `buscarTokenRecuperacao` + mesmas regras da verificação → recusa sem hash.
4. `hashSenha(senha)` fora da transação.
5. `redefinirSenhaComToken({ …, chaveLogin: chaveDeLogin(t.email), janelaLogin: inicioDaJanela(agora), elegivel })`. Recusa do repositório (corrida) → `recusado`. Exceção → log `falha`, `{ motivo: 'falha' }` (nada muda: a transação foi desfeita).
6. Log `{ evento: 'auth.redefinicao_senha', resultado: 'ok', usuarioId, sessoesRevogadas }`; `{ ok: true, mensagem: sucesso }`.

O `agora` é capturado uma vez por chamada. Expiração entre o GET e o POST: rechecada no passo 3 e no `UPDATE` condicional.

### 3.4 Telas e ações (`src/app/(publico)/`)

Padrão da D-010/D-011: `estado.ts` sem imports de servidor; componente cliente com a ação por prop (testável em jsdom); `acoes.ts` com `'use server'`, fora de `*.acao.ts`; `PublicLayout`; `Field`, `Button`, `Alert`; caminhos só por `ROTAS`; CSS só com `var(--…)`; `<form action noValidate>`.

**`/recuperar-senha`**
- `estado.ts`: `EstadoRecuperar = { mensagem: string | null; variante: 'sucesso' | 'erro' | null; erroEmail: string | null; email: string }`, `ESTADO_INICIAL_RECUPERAR` congelado.
- `acoes.ts`: `solicitarRecuperacaoAcao(anterior, formData)`: lê `email` (não-string → `''`), chama `solicitarRecuperacao({ email }, { agendar: (t) => after(t) })` com `after` de `next/server`. `ok` → `variante: 'sucesso'`; `limite` → `erro`; `validacao` → `erroEmail`. `email` devolvido aparado e cortado em 254. **A estrutura do estado é a mesma para e-mail existente ou não** (CA-2).
- `FormularioRecuperar.tsx`: `Field` "E-mail" (`type="email"`, `autoComplete="email"`), `Button` "Enviar link" com `ocupado`, `Alert` anunciado, link "Voltar para entrar" (`ROTAS.entrar`).
- `page.tsx`: `metadata.title = 'Recuperar senha'`; `h1` "Recuperar senha" e texto curto. Não consulta banco nem sessão.

**`/redefinir-senha`**
- `estado.ts`: `EstadoRedefinir = { status: 'inicial' | 'formulario' | 'recusado' | 'sucesso'; mensagem: string | null; erroSenha: string | null }`. **Nunca** contém senha nem token. `ESTADO_INICIAL_REDEFINIR` com `status: 'inicial'`.
- `acoes.ts`: `redefinirSenhaAcao(anterior, formData)`: lê `token` e `senha` (não-string → `''`/`undefined` conforme a validação), ignora qualquer outro campo, chama `redefinirSenha`. Mapeamento: `ok` → `sucesso` + `mensagem`; `validacao` → `formulario` + `erroSenha`; `recusado` → `recusado` + `MENSAGENS_RECUPERACAO.recusado`; `falha` → `formulario` + `mensagem: falha`. Sem `redirect`, sem cookie.
- `page.tsx`: `metadata.title = 'Definir nova senha'`, **sem** `referrer`. Lê `searchParams.token` (array → inválido), chama `verificarLinkDeRedefinicao` e renderiza **sempre** `<PublicLayout><FormularioRedefinir acao={redefinirSenhaAcao} token={tokenOuVazio} verificacao={ok ? 'valido' : 'recusado'} mensagemRecusa={MENSAGENS_RECUPERACAO.recusado} /></PublicLayout>`. Página dinâmica (lê `searchParams`).
- `FormularioRedefinir.tsx` (cliente): `useActionState(acao, ESTADO_INICIAL_REDEFINIR)`. Visão efetiva = `estado.status` se ≠ `inicial`, senão a prop `verificacao`. **Regra-chave:** o estado da ação prevalece sobre a prop. Isso cobre o POST sem JS, em que o Server Component re-renderiza depois do sucesso e veria o token já usado (`verificacao = 'recusado'`), mas o `formState` traz `sucesso`. O componente fica na mesma posição da árvore em todos os casos, para o React casar o `formState`.
  - `formulario`: `h1` "Definir nova senha", `Field` "Nova senha" (`type="password"`, `autoComplete="new-password"`, ajuda "Mínimo de 8 caracteres", sempre vazio, `erro` ligado por `aria-describedby`), `<input type="hidden" name="token">` com a prop, `Alert` de `mensagem` se houver (falha), `Button` "Salvar nova senha".
  - `recusado`: `h1` "Link inválido", `Alert` erro com a mensagem, link "Pedir um novo link" (`ROTAS.recuperarSenha`). Sem formulário.
  - `sucesso`: `h1` "Senha alterada", `Alert` sucesso, link "Entrar" (`ROTAS.entrar`). Sem formulário.

**`next.config.ts`**: `headers()` passa a devolver também `{ source: ROTAS.redefinirSenha, headers: [{ key: 'Referrer-Policy', value: 'strict-origin' }] }`, com o comentário da D-011 estendido. Nunca `no-referrer`, nem meta.

### 3.5 Suporte de teste
Sem mudança em `tests/support/**`. Os testes usam `deps.agora`, `deps.gerarToken` (token conhecido), `deps.hashSenha` (contador; valor com `\u0000` para forçar erro do PostgreSQL e provar o desfazer da transação), `deps.email` (porta que lança `ErroEnvioEmail`), `deps.log` (captura), `deps.appUrl`, `deps.agendar` (captura para provar o adiamento), `deps.verificarSenha` do login (atrasado por uma promessa, CA-16). O token do link é extraído de `email_log.corpo` por regex sobre `APP_URL + '/redefinir-senha?token='`. Profissional inativo: `UPDATE profissional SET ativo = false` via Prisma do teste (fábricas). Super admin: `criarSuperAdmin` de `tests/support/auth.ts`. Na casca: `vi.mock('next/server', () => ({ after: (t) => fila.push(t) }))`, mais os mocks de `next/headers`/`next/navigation` já usados em `cadastro-paginas.test.ts`, se necessários.

## 4. Dados (DBA: **dispensado**)

Motivo: nenhuma migração, tabela, coluna, enum, índice ou constraint muda (§0). Pontos avaliados:
1. **Invalidação por usuário e tipo**: usa `token_usuario_id_tipo_idx`; busca por hash usa o UNIQUE.
2. **Um token válido por usuário**: garantido pela trava `FOR UPDATE` no usuário em todas as escritas de `token` (sem índice parcial; igual à D-011).
3. **`FOR SHARE` no login**: trava de linha curta (duração de um `INSERT`), só em logins bem-sucedidos; não muda isolamento. Análise de conflito no §3.2.
4. **`DELETE` em `rate_limit_janela`**: por PK, dentro da transação da redefinição; um login concorrente que incrementa a mesma chave espera o commit e recria a linha com 1.
5. **Erro de NUL em texto** (técnica de teste): `\u0000` em parâmetro `text` faz o PostgreSQL rejeitar o comando; é só um gatilho de teste para o desfazer.

Gatilho para acionar o DBA: necessidade de migração (por exemplo, índice parcial se o tester encontrar dois tokens válidos), mudança de isolamento, impasse observado nos laços de concorrência ou SQL além do descrito no §3.1/§3.2.

## 5. Infraestrutura (DevOps: **dispensado**)

1. Nenhuma variável nova; `APP_URL` já existe (monta o link; o README destaca isso).
2. Nenhum arquivo de infraestrutura muda. `next.config.ts` é configuração da app (uma entrada a mais em `headers()`), como na D-011.
3. `after()`: suportado por `next start`. A imagem já usa `exec … next start` com `init: true`, então o SIGTERM chega ao Next, que executa os `after()` pendentes antes de sair. O serviço `app` do compose não define `stop_grace_period` (padrão 10 s); um envio SMTP lento no instante exato de um `docker compose stop` pode ser cortado (R-5). Isso não muda nenhum CA: o token fica gravado e a pessoa pede de novo. Ajustar o `stop_grace_period` da app fica como pendência para a implantação (E9.x), não para esta demanda.
4. Testes novos de integração entram no job `testes`; `e2e/recuperar-senha.spec.ts` não usa banco e cabe no job `e2e` atual.
5. Observabilidade: linhas JSON `auth.recuperacao_senha`, `auth.redefinicao_senha_link` e `auth.redefinicao_senha` no stdout.

Gatilho para acionar o DevOps: E2E com banco, variável nova ou necessidade de `stop_grace_period` na app.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como foi atendida |
|---|---|---|
| Escopo por salão no servidor | **Sim** | Fluxo pré-autenticação sobre tabelas globais, por funções pré-contexto documentadas. O alvo vem **só** do e-mail (único) ou do `token_hash`; a ação lê apenas `email`, `token` e `senha` (campos extras ignorados). A redefinição altera só o dono do token: `UPDATE`s filtrados por `usuario_id` do token. CA-13 prova com dois salões. |
| Exclusion constraint anti-sobreposição | Não | Nenhuma escrita em `reserva`. |
| UTC + fuso do salão | **Sim** (parcial) | `expira_em`, `usado_em`, `invalidado_em`, `revogada_em`, `email_confirmado_em` e janelas são instantes UTC com relógio injetado; validade de 1 h independe do fuso (CA-4b, unidade em ms). |
| Adaptadores de integração | **Sim** | E-mail só por `integracoes().email` (ou `deps.email`), resolvido dentro da tarefa; falha não desfaz o token nem muda a resposta (CA-12). Sem Turnstile (spec §3). |
| Soft delete / anonimização | Não | Nada é apagado, exceto a linha de contador de `rate_limit_janela` (D-8), que não é entidade de negócio. Tokens são invalidados, nunca removidos; sessões são revogadas. |
| Salão suspenso somente leitura | **Sim** (não bloqueia) | Recuperação não é operação de salão; não passa por `politica.ts`. CA-20 prova com `suspenso_manual_em`. Registrar para a E6.4: não bloquear `/recuperar-senha` nem `/redefinir-senha`. |
| Idempotência de webhooks e mensagens | Análogo | Sem webhook/WhatsApp. Uso único atômico do token (CA-11a); substituição sem dois tokens válidos (CA-11b); um e-mail por solicitação aceita. |
| Auditoria do super admin | Não | Super admin fora do escopo; o e-mail dele recebe a resposta uniforme e nada é gravado (CA-14). |
| Sigilo (D-010 RN-22) | **Sim** | Só SHA-256 do token no banco; link com `APP_URL`; chaves de limite com hash; logs sem dados pessoais (CA-17); `Referrer-Policy: strict-origin` em `/redefinir-senha` (CA-18); token em campo oculto e nunca no estado da ação. |
| Sessões (RN-3) | **Sim** | Revogação na mesma transação da troca do hash; login condicionado ao hash vigente (D-11). |

## 7. Riscos e decisões

### 7.1 Decisões D-1..D-16 da spec

| ID | Situação | Observação |
|---|---|---|
| D-1 | **Confirmada** | GET só verifica; consumo no POST. |
| D-2 | **Confirmada** | Regra em `elegivelParaRecuperacao`, aplicada na solicitação, na verificação e dentro da transação. Gestor com perfil de profissional inativo continua elegível (como no login). |
| D-3 | **Confirmada, ampliada** | `email_confirmado_em = COALESCE(…, agora)` para qualquer papel (o link prova o controle da caixa) e invalidação dos `confirmacao_email` pendentes. |
| D-4 | **Confirmada, ampliada** | `after()` injetado por `deps.agendar`; a tarefa adiada inclui busca, emissão e envio, não só o envio. Prova nos testes: (a) serviço com `agendar` que captura: ao retornar, não há `token` nem `email_log` novos; ao executar a tarefa, aparecem; (b) casca com `vi.mock('next/server')`: idem para `solicitarRecuperacaoAcao`; (c) padrão inline mantém os CA-1/CA-2 diretos. |
| D-5 | **Confirmada** | 3/15 min, chave `recuperacao-senha:`, contando qualquer e-mail válido. |
| D-6 | **Confirmada** | Mensagem única; motivo no retorno do serviço e no log. |
| D-7 | **Confirmada** | Sem login automático. |
| D-8 | **Confirmada** | `DELETE` da janela vigente de `login:` dentro da transação. |
| D-9 | **Confirmada** | Sem "confirmar senha". |
| D-10 | **Confirmada** | Sem e-mail de aviso; pendência de segurança. |
| D-11 | **Confirmada** | Mecanismo `FOR SHARE` + condição no hash (§3.2); CA-16 vale. |
| D-12 | **Confirmada** | Cabeçalho HTTP em `next.config.ts`. |
| D-13 | **Confirmada** | E2E sem banco (§8). |
| D-14 | **Confirmada** | Sem limpeza de tokens. |
| D-15 | **Confirmada** | Falha de envio não muda a resposta; com a D-4 ampliada, a resposta nem espera o envio. |
| D-16 | **Confirmada** | Senha igual à anterior aceita. |
| D-17 | **Nova** | Repositório novo `token-recuperacao.ts`; `token-confirmacao.ts` e `confirmacao-email.ts` não mudam. |
| D-18 | **Nova** | `/redefinir-senha` renderiza sempre o mesmo componente cliente; o estado da ação prevalece sobre o veredito da página (re-render sem JS). |
| D-19 | **Nova** | Login: decremento do limite passa para depois da sessão criada; sessão recusada por hash mudado conta como falha e devolve "E-mail ou senha incorretos.". |
| D-20 | **Nova** | Logs acrescentados: resultado `falha` em `auth.recuperacao_senha` e o evento `auth.redefinicao_senha_link` (GET). |

### 7.2 Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-1 | Impasse entre emissão, redefinição, confirmação (D-011) e login | Ordem única `usuario` → `token` → `sessao` → `rate_limit_janela`; login só `usuario` (share) → `sessao`. Laços ×10 de CA-11 e CA-16. |
| R-2 | Re-render do POST sem JS mostrar "Link inválido" após sucesso | D-18; teste jsdom (prop `recusado` + estado `sucesso` → sucesso) e integração da casca. O tester deve provar sem JS com banco (Docker). |
| R-3 | `after()` lançar fora de requisição | Só a casca o usa; serviço usa `deps.agendar`. Testes da casca mockam `next/server`. |
| R-4 | Tarefa adiada falhar sem ninguém ver | `try/catch` total com log `falha`/`envio_falhou`. Testes: porta que lança → `envio_falhou` (CA-12); `appUrl` inválida ou ambiente sem SMTP → `envio_falhou`; erro de banco dentro da tarefa (por exemplo `gerarToken` devolvendo valor com `\u0000`) → `falha`, sem exceção para quem chamou. |
| R-5 | Envio perdido em parada do container (padrão 10 s) | Token gravado; pessoa pede de novo. Pendência de implantação (§5.3). |
| R-6 | Testes que dependem da ordem decremento/sessão no login | `login.test.ts` CA-12 ("sucesso devolve a reserva") continua valendo; T-2 roda o laço da D-010. |
| R-7 | Scanner abre o link | GET não consome (CA-5). |
| R-8 | Canal de tempo residual | Caminho síncrono igual para todos os e-mails válidos (validação + 1 `INSERT … ON CONFLICT`). Na redefinição, o custo de argon2 só ocorre com token válido (quem tem o token já sabe a conta). |
| R-9 | Argon2 nos testes de concorrência | ~13 ms por hash; 2 por repetição. |
| R-10 | Cobertura das cascas | Integração com `renderToStaticMarkup` e ações chamadas diretamente (padrão D-010/D-011). |
| R-11 | Cabeçalho aplicado a rota errada | Teste de integração de `next.config.ts` `headers()` + E2E (presente em `/redefinir-senha` com e sem token e no POST; ausente em `/recuperar-senha`, `/entrar`). |

## 8. Estratégia de testes

**Unitário** (`src/**/*.test.ts(x)`):
- `src/server/auth/recuperacao-senha.test.ts`: `estadoDoToken` (T+1h−1ms válido, T+1h expirado, T+1h+1s expirado; usado; invalidado; usado tem precedência no motivo), `elegivelParaRecuperacao` (tabela: gestor com/sem confirmação e com perfil inativo → sim; profissional ativo → sim; inativo / sem perfil / super admin → não), `validarNovaSenha` (7, 8 espaços aceita, 1024, 1025, não-string, ausente), `linkDeRedefinicao` (barra final em `APP_URL`), `montarEmailRecuperacao` (assunto, nome, link, "1 hora", uso único, "sai de todos os dispositivos", "ignore", sem `html`), `chaveDeRecuperacao` (sem e-mail em claro), `novoTokenDeRecuperacao` (43 caracteres, hash, +1 h).
- jsdom: `FormularioRecuperar.test.tsx` e `FormularioRedefinir.test.tsx` (CA-19 componente): `h1`, rótulos, `aria-describedby`, `Alert` anunciado, `autoComplete="new-password"`, `input type="hidden" name="token"`, senha nunca preenchida, `<form action>`, as três visões, **prop `recusado` com estado `sucesso` → sucesso** (D-18).

**Integração** (PostgreSQL real):
- `repos-recuperacao.test.ts` (T-1): todos os resultados de `emitirTokenRecuperacao` e `redefinirSenhaComToken`, invalidações por tipo, `COALESCE`, revogação só do dono, `DELETE` da janela certa (outras chaves e janelas intactas), desfazer em erro (`\u0000`), DTOs sem hash.
- `sessao-senha-vigente.test.ts` (T-2): `criarSessaoSeSenhaVigente` true/false; login com `verificarSenha` instrumentado que troca o hash no meio → "E-mail ou senha incorretos." e nenhuma sessão; contraprova login normal.
- `recuperacao-senha.test.ts` (T-3, arquivo da issue): CA-1..CA-4, CA-6 (serviço; inclusive contraprova em `/confirmar-email` via `confirmarEmail`), CA-7, CA-8, CA-9, CA-10, CA-12, CA-13, CA-14, CA-15, CA-17, CA-20; D-4 (a) com `agendar` capturando; `falha` da redefinição com `\u0000`.
- `recuperacao-senha-concorrencia.test.ts` (T-4): CA-11a, CA-11b, CA-16 (com gate de promessa), cada um ×10 no próprio teste ou pelo laço.
- `recuperacao-senha-paginas.test.ts` (T-6): `solicitarRecuperacaoAcao` (estrutura idêntica existente/inexistente; adiamento via `after` mockado; limite; validação), `PaginaRedefinirSenha` por `renderToStaticMarkup` (válido mostra formulário; CA-5 três GETs sem gravar; CA-6 casos; usado/expirado/substituído/inelegível → recusa), `redefinirSenhaAcao` (sucesso, validação mantém token válido, recusa, campos extras ignorados), `PaginaRecuperarSenha`, `next.config.ts` `headers()` (CA-18).

**E2E** (`e2e/recuperar-senha.spec.ts`, 375×812, sem banco): Tab em `/recuperar-senha` (E-mail → Enviar link → Voltar para entrar) e axe zero; `/redefinir-senha?token=malformado` e sem token: recusa, link para `/recuperar-senha`, axe zero; bloco sem JS: `/recuperar-senha` com e-mail inválido → 200 com "Informe um e-mail válido."; `/redefinir-senha?token=x` sem JS → recusa; cabeçalho `referrer-policy: strict-origin` em `/redefinir-senha` e `/redefinir-senha?token=x`, ausente em `/recuperar-senha`; nenhuma sub-requisição de `/redefinir-senha?token=…` leva o token no `Referer`; "Esqueci minha senha" em `/entrar` → `/recuperar-senha` 200.

**Cobertura ≥ 90%**: todo arquivo novo de `src/` tem teste direto; nenhuma exclusão nova. T-7 registra no `dev.md` o percentual global e por arquivo novo/alterado.

**Gates (CA-21)**: `npm run lint`, `typecheck`, `build` (`ƒ /redefinir-senha` dinâmica), `npm test`, `npm run test:coverage`, `npm run test:e2e`; laços: `for i in $(seq 10); do npx vitest run --project integration tests/integration/auth/recuperacao-senha-concorrencia.test.ts || break; done` e o laço de estabilidade do login da D-010 (por causa do T-2).

## 9. Tarefas

DBA e DevOps dispensados (§4, §5). Implementação: `desenvolvedor`.

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | desenvolvedor | — | T-2, T-5 | `src/server/repos/token-recuperacao.ts`, `tests/integration/auth/repos-recuperacao.test.ts` |
| T-2 | desenvolvedor | — | T-1, T-3, T-5 | `src/server/repos/sessao.ts`, `src/server/auth/sessao.ts`, `src/server/auth/login.ts`, `tests/integration/auth/sessao-senha-vigente.test.ts` |
| T-3 | desenvolvedor | T-1 | T-2, T-5 | `src/server/auth/recuperacao-senha.ts`, `src/server/auth/recuperacao-senha.test.ts`, `tests/integration/auth/recuperacao-senha.test.ts` |
| T-4 | desenvolvedor | T-2, T-3 | T-5, T-6 | `tests/integration/auth/recuperacao-senha-concorrencia.test.ts` |
| T-5 | desenvolvedor | — | T-1..T-4 | `src/app/(publico)/recuperar-senha/{estado.ts, FormularioRecuperar.tsx, FormularioRecuperar.module.css, FormularioRecuperar.test.tsx}`, `src/app/(publico)/redefinir-senha/{estado.ts, FormularioRedefinir.tsx, FormularioRedefinir.module.css, FormularioRedefinir.test.tsx}` |
| T-6 | desenvolvedor | T-3, T-5 | T-4 | `src/app/(publico)/recuperar-senha/{page.tsx, acoes.ts}`, `src/app/(publico)/redefinir-senha/{page.tsx, acoes.ts}`, `next.config.ts`, `tests/integration/auth/recuperacao-senha-paginas.test.ts` |
| T-7 | desenvolvedor | T-4, T-6 | — | `e2e/recuperar-senha.spec.ts`, `README.md`, `docs/demandas/D-012/dev.md` |
| T-8 | tester | T-7 | — | `docs/demandas/D-012/testes.md` |

Rodadas sem arquivo em comum:
- **Rodada 1:** T-1 ‖ T-2 ‖ T-5.
- **Rodada 2:** T-3 (‖ T-2/T-5 remanescentes).
- **Rodada 3:** T-4 ‖ T-6.
- **Rodada 4:** T-7.
- **Rodada 5:** T-8.

Posse: defeito em arquivo de outra tarefa reabre a tarefa dona. `CLAUDE.md` é do líder ao encerrar (T-7 entrega o texto sugerido no `dev.md`, incluindo a linha do E2E e do laço de concorrência). Ninguém edita `src/config/navegacao.ts`, `tests/support/**`, `prisma/**`, `src/server/auth/confirmacao-email.ts`, `src/server/repos/token-confirmacao.ts`, `src/server/repos/rate-limit.ts` nem `src/app/(publico)/entrar/**`.

**T-1 — Repositório de recuperação.**
- Entregável: §3.1 e `repos-recuperacao.test.ts`.
- Conclusão: arquivo verde 10× seguidas; cabeçalho documenta a exceção à RN-8; nenhum DTO com `token_hash`/`senha_hash`; nenhum `now()` em regra; ordem de travas conforme §3.1 (revisão); lint e typecheck verdes.

**T-2 — Sessão condicionada ao hash (D-11).**
- Entregável: §3.2 e `sessao-senha-vigente.test.ts`.
- Conclusão: arquivo verde; laço da D-010 (`login.test.ts` + `sessao-rbac.test.ts`) verde 10×; `git diff src/server/auth/login.ts` restrito ao ramo de sucesso; `npx vitest run --project integration tests/integration/auth` verde; lint e typecheck verdes.

**T-3 — Serviço.**
- Entregável: §3.3; testes unitários e `recuperacao-senha.test.ts` (CA-1..CA-4, CA-6..CA-10, CA-12..CA-15, CA-17, CA-20; D-4 (a)).
- Conclusão: arquivos verdes; nenhum import de `next/*` em `src/server/auth/recuperacao-senha.ts`; `grep -rn "integrations/email/\(real\|simulado\)" src/server/auth` vazio; hash fora da transação e não chamado em validação/recusa (contador); lint e typecheck verdes.

**T-4 — Concorrência.**
- Entregável: CA-11a, CA-11b, CA-16.
- Conclusão: laço ×10 do §8 verde; nenhum impasse (`deadlock detected`) nos logs.

**T-5 — Componentes e estados.**
- Entregável: §3.4 (estados e formulários) com testes jsdom (CA-19 componente, D-18).
- Conclusão: `npm run test:unit -- "src/app/(publico)"` verde; `estado.ts`/`Formulario*.tsx` sem import de `@/server` em tempo de execução (só `import type`); CSS só com `var(--…)`; estado nunca contém senha nem token; lint e typecheck verdes.

**T-6 — Casca Next e cabeçalho.**
- Entregável: §3.4 (`page.tsx`, `acoes.ts`), `next.config.ts`, `recuperacao-senha-paginas.test.ts` (CA-2 casca, CA-5, CA-6 página, CA-7 casca, CA-13 campos extras, CA-18 integração, D-4 (b)).
- Conclusão: `npx vitest run --project integration tests/integration/auth` verde; `npm run build` verde com `ƒ /redefinir-senha`; `tests/integration/tenant/registro.test.ts` verde (nenhum `*.acao.ts`); `after` importado só em `recuperar-senha/acoes.ts`; nenhuma `meta name="referrer"`; lint e typecheck verdes.

**T-7 — E2E, documentação e gates.**
- Entregável: `e2e/recuperar-senha.spec.ts` (CA-18, CA-19 E2E); README, seção "Recuperação de senha" (fluxo, validade 1 h, uso único, limite 3/15 min, sessões encerradas, confirmação do e-mail pelo link, envio após a resposta, como ler o link em `email_log` no modo simulado, `APP_URL` em produção, nenhuma credencial nova); `dev.md` com evidências, cobertura e texto sugerido para o `CLAUDE.md`.
- Conclusão: todos os gates do §8 verdes; prova manual com Docker (`docker compose up -d --wait`; pedido em `/recuperar-senha`; link lido de `email_log`; nova senha **com e sem JS**; login com a nova; sessão antiga recusada) registrada no `dev.md`.

**T-8 — Validação independente (tester).**
- Entregável: `testes.md` com veredito; repetir gates, laços, prova Docker com e sem JS (R-2), conferir o canal de tempo da solicitação (existente × inexistente × super admin) e o mapa abaixo.

### Mapa CA → tarefa → tipo de teste

| CA | Tarefa(s) | Tipo | Arquivo |
|---|---|---|---|
| CA-1 | T-1, T-3 | Integração | `repos-recuperacao.test.ts`, `recuperacao-senha.test.ts` |
| CA-2 | T-3, T-6 | Integração (serviço + ação) | `recuperacao-senha.test.ts`, `recuperacao-senha-paginas.test.ts` |
| CA-3 | T-1, T-3 | Integração | `repos-recuperacao.test.ts`, `recuperacao-senha.test.ts` |
| CA-4 | T-3, T-6 (+ unidade) | Unitário + integração | `recuperacao-senha.test.ts` (unit e int), `recuperacao-senha-paginas.test.ts` |
| CA-5 | T-6 | Integração (página) | `recuperacao-senha-paginas.test.ts` |
| CA-6 | T-3, T-6, T-7 | Integração + E2E | `recuperacao-senha.test.ts`, `recuperacao-senha-paginas.test.ts`, `e2e/recuperar-senha.spec.ts` |
| CA-7 | T-3, T-6 | Unitário + integração | `recuperacao-senha.test.ts` (unit e int), `recuperacao-senha-paginas.test.ts` |
| CA-8 | T-1, T-3 | Integração | `repos-recuperacao.test.ts`, `recuperacao-senha.test.ts` |
| CA-9 | T-3 | Unitário + integração | `recuperacao-senha.test.ts` |
| CA-10 | T-3 | Integração (relógio) | `recuperacao-senha.test.ts` |
| CA-11 | T-1, T-4 | Integração (concorrência ×10) | `repos-recuperacao.test.ts`, `recuperacao-senha-concorrencia.test.ts` |
| CA-12 | T-3 | Integração | `recuperacao-senha.test.ts` |
| CA-13 | T-1, T-3, T-6 | Integração (dois salões) | `repos-recuperacao.test.ts`, `recuperacao-senha.test.ts`, `recuperacao-senha-paginas.test.ts` |
| CA-14 | T-3 | Integração | `recuperacao-senha.test.ts` |
| CA-15 | T-1, T-3 | Integração | `repos-recuperacao.test.ts`, `recuperacao-senha.test.ts` |
| CA-16 | T-2, T-4 | Integração (concorrência) | `sessao-senha-vigente.test.ts`, `recuperacao-senha-concorrencia.test.ts` |
| CA-17 | T-3 | Integração (log capturado) | `recuperacao-senha.test.ts` |
| CA-18 | T-6, T-7 | Integração + E2E | `recuperacao-senha-paginas.test.ts`, `e2e/recuperar-senha.spec.ts` |
| CA-19 | T-5, T-7 | jsdom + E2E sem banco | `Formulario*.test.tsx`, `e2e/recuperar-senha.spec.ts` |
| CA-20 | T-3 | Integração | `recuperacao-senha.test.ts` |
| CA-21 | T-7, T-8 | Gates | comandos oficiais |

## Pendências registradas (não bloqueantes)
- E-mail "sua senha foi alterada" (D-10): demanda futura de segurança.
- Limpeza de tokens vencidos (D-14): E9.x.
- `stop_grace_period` da app para os `after()` pendentes (R-5): implantação/E9.x.
- E6.4 não deve bloquear `/recuperar-senha` nem `/redefinir-senha` (RN-17).
- Avaliar levar o adiamento por `after()` ao reenvio de confirmação da D-011 (mesmo canal de tempo), se o líder quiser abrir demanda.
- E2E com banco quando o seed (E9.2) existir.
