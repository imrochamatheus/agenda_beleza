# D-007 — Desenho: portas e adaptadores de integração, com simulados e reais de e-mail e Turnstile (issue #8, E0.6)

Autor: arquiteto-software. Entradas: `docs/demandas/D-007/spec.md` (RN-1..RN-22, CA-1..CA-25, D-1..D-11), `issue-8.md`, `docs/demandas/D-001/{design,devops}.md` (E0.6, E6.x, E7.x), `docs/demandas/D-004/dba.md` (contrato de nomes), `docs/demandas/D-005/design.md` (repositórios, lint RN-10, harness), `CLAUDE.md`, `PLAN.md` e o código de `main` em `a042410` (igual a `feat/d-007-adaptadores`).

## 0. Verificações feitas antes do desenho

| Verificação | Resultado |
|---|---|
| `npm view nodemailer time` (hoje: 2026-11-19; corte de 2 semanas: 2026-11-05) | `latest` = 10.6.0 (2026-11-15), recente demais. As versões 10.4.0 (11-07), 10.4.1 e 10.5.0 (11-10) também ficam depois do corte. A versão mais nova com pelo menos 2 semanas é a **10.3.1, publicada em 2026-10-29T12:31Z** (21 dias). |
| Tarball `nodemailer@10.3.1` (`npm pack`, só inspeção) | Licença `MIT-0`. **Sem `dependencies`**, sem `install`/`postinstall` (só `prepare`, que não roda para pacotes do registro): não precisa de `allowScripts`. `"type": "module"`, `exports` com `import`/`require`. **Traz os próprios tipos** (`dist/esm/nodemailer.d.ts` ao lado do `.js`, que a resolução `bundler` do `tsconfig.json` encontra) e o CHANGELOG da 10.0.0 diz "keep the @types/nodemailer type layout working". Desde a 10.2.0, os erros SMTP trazem `err.permanent`. |
| `@types/nodemailer` | O último é o 8.0.2 (2026-09-15), escrito para a API antiga. **Não será instalado**, porque o pacote já tem tipos e duas definições entrariam em conflito. |
| `smtp-server` (stub SMTP de teste) | 3.21.3 (2026-10-29) teria idade suficiente, mas **não será usado** (§1.1): o stub será feito com `node:net`, sem dependência nova. |
| `node_modules/next/dist/lib/server-external-packages.jsonc` | Não lista `nodemailer`, então o Next 16 o empacota no bundle do servidor. Nenhuma rota desta demanda importa o adaptador real de e-mail. O risco R-6 trata do primeiro import (E1.1). |
| Testes que fixam o catálogo do banco | `tests/integration/db/drift.test.ts` fixa as 24 tabelas, os enums, a contagem de 35 FKs, a regra "todo `id` é `uuid` com `gen_random_uuid()`", a regra "todo `criado_em` tem `now()`" e a lista de migrações (CA-22 da D-004). `tests/integration/harness/template.test.ts` fixa `MIGRACOES`. **Os dois mudam com a migração nova** e ficam com o DBA (T-1). |
| Regra `no-restricted-imports` (flat config) | Dois blocos que configuram a mesma regra para o mesmo arquivo **não se somam**: o último substitui o anterior. A RN-16 não pode ser um bloco solto ao lado do bloco da RN-10 da D-005 (§3.8). |
| CI, job `e2e` | Não tem PostgreSQL. Um E2E do `/dev/mp-checkout` (que lê o banco) não roda nele, então o CA-19 fica com integração mais verificação manual (§8). |

## 1. Resumo da solução

- **Portas** (`src/server/integrations/<x>/port.ts`): interfaces, DTOs e erros de domínio. Todas as operações são assíncronas. Nenhuma porta importa provedor, Prisma ou `process.env`. A validação de entrada que vale para todos os adaptadores (e-mail: RN-9; WhatsApp: E.164) fica numa função exportada pela própria porta, chamada por simulado e real antes de qualquer efeito.
- **Exigências de ambiente junto de cada integração** (`src/server/integrations/<x>/ambiente.ts`, sugestão do D-1 adotada): cada módulo declara suas chaves e uma função pura `lerConfigReal(fonte)`. O `env.ts` só compõe esses módulos. Assim, a E6.6 e a E7.2 trocam a recusa do D-1 pelas próprias exigências editando só `mercadopago/ambiente.ts` e `whatsapp/ambiente.ts`, sem disputar trechos de `env.ts`. Os módulos `ambiente.ts` só importam `zod`, o que mantém o bundle do `check-env` livre de `nodemailer` e do Prisma.
- **`validarEnv`** continua sendo a única validação. Ela devolve a base (`DATABASE_URL`, `APP_URL`) e, por integração, `{ modo: 'simulado' }` ou `{ modo: 'real', config }`. O `ErroDeAmbiente` lista todas as variáveis inválidas, ordenadas, sem valores. No modo simulado, as variáveis do provedor são ignoradas. O `check-env` e o worker registram os quatro modos ao iniciar.
- **Registro** (`src/server/integrations/registry.ts`): `criarIntegracoes(fonte, deps?)` valida (via `validarEnv`) e constrói. `integracoes()` faz o mesmo sobre `process.env` no **primeiro uso**, com memoização. O import não lê o ambiente. As funções de seleção puras (`selecionarMercadoPago(modo)` e as demais) mapeiam `real` para `mercadopago/real.ts` e `whatsapp/real.ts` (stubs `NaoImplementado`), o que prova a ligação do CA-9 enquanto o `validarEnv` recusa esses modos (D-1).
- **Simulados com estado no PostgreSQL**: o e-mail grava em `email_log`. O MP e o WhatsApp gravam em tabelas novas, com prefixo `sim_` (migração do DBA, T-1). O acesso passa por repositórios de plataforma novos em `src/server/repos/`, que usam o cliente padrão (`obterPrisma()`), **fora** de qualquer transação do chamador (RN-15). O consumo de falha ou erro forçado é atômico: `DELETE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`, na mesma transação que registra a chamada.
- **Reais**: e-mail por SMTP com `nodemailer@10.3.1` (host e porta injetados pelo construtor, tempos-limite fixos, log e debug desligados, erros traduzidos sem `cause`). Turnstile por `fetch` ao `siteverify`, com URL injetável e `AbortSignal.timeout`. Testes com stubs locais em `tests/support/stubs/` (`node:http` e `node:net`).
- **Checkout simulado**: `src/app/dev/mp-checkout/page.tsx` (GET) e `src/app/dev/mp-checkout/decisao/route.ts` (POST de formulário) são finos. A lógica fica em `mercadopago/checkout-simulado.ts`, que lê `MP_ADAPTER` na requisição: fora de `simulado`, devolve 404 sem tocar o banco. O redirecionamento vai só para a `urlRetorno` gravada.
- **Lint RN-16**: a configuração de `no-restricted-imports` passa a ser montada por conjuntos de arquivos **disjuntos**, cada um com a soma das restrições que lhe cabem (RN-10 + RN-16). As URLs de provedor ficam proibidas por `no-restricted-syntax`.
- **`src/config/plano.ts`**: `PRECO_MENSAL_CENTAVOS = 7900` e `DIAS_TESTE = 30`, sem nenhum import.

### 1.1 Alternativas descartadas
| Alternativa | Motivo |
|---|---|
| Simulados em memória | O app, o worker, o Vitest e o Playwright são processos distintos (RN-15). O estado precisa ser compartilhado. |
| Tabelas dos simulados num schema separado (`simulado.*`) | Exigiria `multiSchema` no Prisma 7, mudaria o `migrate diff` do teste de drift e o harness (que só olha `public`). O prefixo `sim_` em `public` dá a mesma separação visual a custo zero. O DBA pode rever (T-1). |
| IDs de provedor em `text` nas tabelas `sim_` | Quebraria o contrato "todo `id` é `uuid` + `gen_random_uuid()`" da D-004, conferido pelo `drift.test.ts`. A porta trata IDs como `string` opaca, então o simulado usa `uuid` e o real (E6.6) usa o formato do MP, sem diferença para a lógica de negócio. |
| Aceitar `MP_ADAPTER=real`/`WHATSAPP_ADAPTER=real` e falhar só na chamada | O D-1 da spec, aceito pelo líder: falhar cedo na inicialização. |
| Exigências do modo real codificadas dentro de `env.ts` | A E6.6 e a E7.2 editariam o mesmo trecho em paralelo. Com `ambiente.ts` por integração, cada uma tem o seu arquivo. |
| Registro que valida no import | Quebra o `next build` sem `.env` (CA-6; D-001/devops.md R5). |
| `smtp-server` (dev) como stub SMTP | É uma dependência nova (e ela própria depende de `nodemailer`) para algo que o teste cobre com cerca de 120 linhas de `node:net`: `EHLO`, `AUTH PLAIN/LOGIN`, `MAIL`, `RCPT`, `DATA` e `QUIT`, sem `STARTTLS`. Um stub próprio também deixa forçar recusa de autenticação, recusa de destinatário e silêncio (tempo-limite) sem configuração de terceiros. |
| `@types/nodemailer` | O pacote 10.x já traz os tipos (§0). |
| Server Action para autorizar no checkout | O `redirect()` de Server Action é difícil de testar fora do Next. Um Route Handler `POST` devolve `Response` 303, testável diretamente em integração (CA-19). |
| E2E (Playwright) do checkout | O job `e2e` da CI não tem PostgreSQL (§0). O CA-19 fica com integração (handler e página renderizada com `react-dom/server`) mais verificação manual do tester. O E2E entra com a E6.1 ou a E4.4, que vão precisar de banco no job. |
| Variáveis de ambiente para os tempos-limite | A RN-8 não as lista (D-11). Ficam como constantes, injetáveis no construtor. |
| Deduplicar por chave de idempotência no WhatsApp simulado | Proibido pela RN-19: a deduplicação é da E7.1, e o simulado só registra. |

### 1.2 Dependências novas
- `nodemailer` **10.3.1** em `dependencies`, com versão exata (sem `^`). Ela precisa sobreviver ao `npm prune --omit=dev` do `Dockerfile`. Não precisa de `allowScripts`.
- Nenhuma outra: nem `@types/nodemailer`, nem stub SMTP de terceiros.

## 2. Componentes afetados

| Caminho | Mudança | Tarefa |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261119000000_simuladores_integracao/migration.sql` | Modelos e enums dos simulados (§4) | T-1 |
| `tests/integration/db/drift.test.ts`, `tests/integration/harness/template.test.ts` | Listas do contrato: tabelas, enums, contagem de FKs e migrações | T-1 |
| `src/config/plano.ts` (+ `plano.test.ts`) | Novo (CA-7) | T-2 |
| `src/server/integrations/{email,whatsapp,mercadopago,turnstile}/port.ts` (+ `port.test.ts`) | Novos: portas, DTOs, erros e validação de entrada | T-2 |
| `src/server/integrations/{email,whatsapp,mercadopago,turnstile}/ambiente.ts` (+ `ambiente.test.ts`) | Novos: chaves e `lerConfigReal` | T-2 |
| `src/server/env.ts`, `env.test.ts`, `src/server/check-env.ts`, `check-env.test.ts`, `src/scripts/check-env.test.ts` | Composição das integrações, `modosAtivos`, linha de modos no check-env | T-2 |
| `src/worker/stub.ts`, `stub.test.ts` | Evento `worker.adaptadores` ao iniciar | T-2 |
| `.env.example` | Variáveis da RN-8 | T-2 |
| `eslint.config.mjs`, `tests/integration/lint/importacao-integracoes.test.ts`, `tests/integration/lint/importacao-prisma.test.ts` | RN-16, com reestruturação dos blocos (§3.8) | T-3 |
| `src/server/integrations/email/real.ts`, `turnstile/real.ts`, `turnstile/simulado.ts`, `mercadopago/real.ts`, `whatsapp/real.ts` (+ testes unitários) | Novos | T-4 |
| `tests/support/stubs/{http,smtp}.ts` | Stubs locais | T-4 |
| `package.json`, `package-lock.json` | `nodemailer@10.3.1` | T-4 |
| `src/server/repos/{email-log,sim-mercadopago,sim-whatsapp}.ts` | Repositórios de plataforma | T-5 |
| `src/server/integrations/email/simulado.ts`, `mercadopago/{simulado,datas,webhook-simulado}.ts`, `whatsapp/simulado.ts` (+ testes unitários das partes puras) | Novos | T-5 |
| `tests/integration/integracoes/{email-simulado,mp-simulado,whatsapp-simulado,whatsapp-concorrencia}.test.ts` | CA-3, CA-15..CA-18, CA-20, CA-21, CA-23 | T-5 |
| `src/server/integrations/registry.ts` (+ `registry.test.ts`), `mercadopago/checkout-simulado.ts` | Novos | T-6 |
| `src/app/dev/mp-checkout/page.tsx`, `src/app/dev/mp-checkout/decisao/route.ts` | Novos | T-6 |
| `tests/integration/integracoes/{registro,checkout}.test.ts` | CA-1, CA-3 (pelo registro), CA-19 | T-6 |
| `next.config.ts` | Só se a verificação do R-6 exigir `serverExternalPackages: ['nodemailer']` | T-6 |
| `README.md`, `tests/integration/integracoes/documentacao.test.ts`, `docs/demandas/D-007/dev.md` | Documentação, teste README × constantes, gates | T-7 |
| `docs/demandas/D-007/devops.md` (e, só se necessário, `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`) | Revisão e evidências de processo | T-8 |

Não mudam: `docker/entrypoint.sh` (já roda o check-env nos dois papéis), `tests/support/{banco,db,global-setup,setup-arquivo,sql,factories,auth}.ts`, `vitest.config.ts`, `playwright.config.ts`, os repositórios de tenant da D-005 e `CLAUDE.md` (nenhum comando novo).

## 3. Interfaces

### 3.1 Plano (`src/config/plano.ts`)
```ts
// Fonte única (RN-21). Sem imports: usável em componente cliente (E9.1).
export const PRECO_MENSAL_CENTAVOS = 7900;
export const DIAS_TESTE = 30;
```
Nenhum outro arquivo de produção escreve `7900` ou `30` com o sentido de preço ou de dias de teste. O MP simulado importa daqui. A revisão do tester confere com `grep -rnE "\b7900\b" src --include=*.ts --include=*.tsx` (só `plano.ts`).

### 3.2 Porta de e-mail (`email/port.ts`)
```ts
export type MensagemEmail = { para: string; assunto: string; texto: string; html?: string };
export type ResultadoEnvioEmail = { provedorId: string };   // simulado: id do email_log; real: messageId
export interface PortaEmail { enviar(m: MensagemEmail): Promise<ResultadoEnvioEmail> }

export class ErroValidacaoEmail extends Error {          // mensagem fixa + campo: 'para' | 'assunto' | 'texto'
  readonly campo: 'para' | 'assunto' | 'texto';
}
export class ErroEnvioEmail extends Error {              // mensagem fixa por código; SEM cause
  readonly codigo: 'conexao' | 'autenticacao' | 'recusado' | 'outro';
  readonly temporario: boolean;
}
/** RN-9: lança ErroValidacaoEmail; chamada por simulado e real ANTES de qualquer efeito. */
export function validarMensagemEmail(m: MensagemEmail): void;
```
- `para`: um único endereço (`z.email()`), sem `,`, `;`, `<`, `>`, CR nem LF.
- `assunto`: não vazio (depois de `trim`), sem CR nem LF.
- `texto`: não vazio. O `html` é opcional e só o real o envia (D-8).
- As mensagens de erro são constantes e não ecoam valores.

### 3.3 Porta do Turnstile (`turnstile/port.ts`)
```ts
export type ResultadoTurnstile = { valido: true } | { valido: false; motivo: 'token_invalido' | 'indisponivel' };
export interface PortaTurnstile {
  validar(e: { token: string | null | undefined; ip?: string }): Promise<ResultadoTurnstile>; // nunca lança por causa do provedor
  chaveDoSite(): string;                                   // lida na chamada (CA-14)
}
export const TAMANHO_MAXIMO_TOKEN = 2048;                  // limite documentado pela Cloudflare
```
- Um token vazio, só com espaços ou maior que 2048 vira `token_invalido` sem rede.
- `turnstile/simulado.ts` exporta `TOKEN_TURNSTILE_SIMULADO = 'XXXX.DUMMY.TOKEN.XXXX'` e `CHAVE_SITE_TURNSTILE_SIMULADA = '1x00000000000000000000AA'`. São os valores de teste que a própria Cloudflare documenta (D-7 confirmada). O token é aceito quantas vezes for apresentado.
- `turnstile/real.ts`:
```ts
export const URL_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TIMEOUT_TURNSTILE_MS = 5000;
export function criarTurnstileReal(o: {
  segredo: string;
  lerChaveDoSite: () => string;          // registro: () => process.env.TURNSTILE_SITE_KEY (vazio → ErroDeAmbiente ['TURNSTILE_SITE_KEY'])
  urlSiteverify?: string;                // RN-6
  timeoutMs?: number;
  fetch?: typeof fetch;                  // padrão: globalThis.fetch
}): PortaTurnstile;
```
  - Requisição: `POST` `application/x-www-form-urlencoded` com `secret`, `response` e `remoteip` (este só quando informado), `signal: AbortSignal.timeout(timeoutMs)`.
  - `success === true` (estrito) → válido.
  - JSON com `success: false` → `token_invalido`.
  - Qualquer outra coisa (erro de rede, abort, status não 2xx, corpo não JSON, `success` ausente) → `indisponivel`.
  - Nenhum `console.*`. O erro capturado é descartado, sem log e sem propagação.

### 3.4 Porta do WhatsApp (`whatsapp/port.ts`)
```ts
export const MODELOS_WHATSAPP = ['confirmacao', 'remarcacao', 'cancelamento'] as const;   // = enum tipo_mensagem
export type ModeloWhatsApp = (typeof MODELOS_WHATSAPP)[number];
export type EnvioModelo = {
  destinatarioE164: string;
  modelo: ModeloWhatsApp;
  parametros: Readonly<Record<string, string>>;   // nomeados; a E7.2 mapeia para a ordem do template
  chaveIdempotencia: string;                      // 'reserva:tipo:revisao' (formato da E7.1; aqui só não vazio)
};
export interface PortaWhatsApp { enviarModelo(e: EnvioModelo): Promise<{ provedorMensagemId: string }> }
export class ErroEnvioTemporario extends Error { readonly codigo: string }   // mensagem fixa
export class ErroEnvioPermanente extends Error { readonly codigo: string }
/** Mesmo padrão de cliente_telefone_e164_chk (D-004). A E5.1 pode movê-lo para o módulo de telefone. */
export const E164_BR = /^\+55[1-9][0-9]{9,10}$/;
export function validarEnvioModelo(e: EnvioModelo): ErroEnvioPermanente | null;  // destinatário, modelo, chave
```

### 3.5 Porta do Mercado Pago (`mercadopago/port.ts`)
```ts
export type EstadoAssinaturaProvedor = 'pendente' | 'autorizada' | 'cancelada';
export type StatusPagamentoProvedor = 'aprovado' | 'recusado';
export type AssinaturaProvedor = {
  id: string; salaoId: string; estado: EstadoAssinaturaProvedor; valorCentavos: number;
  autorizadaEm: Date | null; proximaCobrancaEm: Date | null; canceladaEm: Date | null;
};
export type PagamentoProvedor = { id: string; assinaturaId: string; status: StatusPagamentoProvedor; valorCentavos: number; ocorridoEm: Date };
export type NotificacaoWebhook = {
  cabecalhos: Readonly<Record<string, string>>;   // nomes em minúsculas
  consulta: Readonly<Record<string, string>>;     // query string ('data.id', 'type')
  corpo: unknown;                                 // JSON já parseado
};
export type ResultadoValidacaoWebhook =
  | { valida: false }
  | { valida: true; tipo: 'assinatura' | 'pagamento'; recursoId: string };

export interface PortaMercadoPago {
  criarAssinatura(e: { salaoId: string; emailPagador: string; urlRetorno: string }): Promise<{ assinaturaId: string; urlCheckout: string }>;
  consultarAssinatura(id: string): Promise<AssinaturaProvedor>;
  consultarPagamento(id: string): Promise<PagamentoProvedor>;
  cancelarAssinatura(id: string): Promise<void>;                 // idempotente se já cancelada
  adiarProximaCobranca(id: string, novaData: Date): Promise<void>;
  validarWebhook(n: NotificacaoWebhook): Promise<ResultadoValidacaoWebhook>;   // nunca lança
}
export const OPERACOES_MP = ['criarAssinatura', 'consultarAssinatura', 'consultarPagamento', 'cancelarAssinatura', 'adiarProximaCobranca'] as const;
export type OperacaoMp = (typeof OPERACOES_MP)[number];

export abstract class ErroMercadoPago extends Error { abstract readonly codigo: 'nao_encontrado' | 'operacao_invalida' | 'falha_provedor' }
export class RecursoNaoEncontradoNoProvedor extends ErroMercadoPago {}   // 'nao_encontrado'
export class OperacaoInvalidaNoProvedor extends ErroMercadoPago {}       // 'operacao_invalida' (estado ou data inválidos)
export class ErroProvedor extends ErroMercadoPago {}                     // 'falha_provedor' (inclui o erro forçado)
```
- `criarAssinatura` valida `salaoId` (UUID), `emailPagador` (e-mail) e `urlRetorno` (URL absoluta http/https). Uma entrada inválida gera `OperacaoInvalidaNoProvedor` sem efeito.
- Um ID desconhecido gera `RecursoNaoEncontradoNoProvedor`. No simulado, um ID que não é UUID também, sem consultar o banco (como na D-005).
- A E6.6 acrescenta `ProvedorNaoSuportaAdiamento` (D-001 S12) como subclasse de `ErroMercadoPago`. Não é criada agora.

### 3.6 Stubs `NaoImplementado` (`mercadopago/real.ts`, `whatsapp/real.ts`)
```ts
// src/server/integrations/nao-implementado.ts (T-4)
export class NaoImplementado extends Error { constructor(item: 'E6.6' | 'E7.2') }  // "Adaptador real ainda não implementado (E6.6)"
// mercadopago/real.ts
export function criarMercadoPagoReal(_o?: { urlBase?: string }): PortaMercadoPago; // todo método: Promise.reject(new NaoImplementado('E6.6'))
// whatsapp/real.ts
export function criarWhatsAppReal(_o?: { urlBase?: string }): PortaWhatsApp;       // rejeita com NaoImplementado('E7.2')
```
A E6.6 e a E7.2 substituem o **corpo** desses arquivos e o `ambiente.ts` correspondente. A assinatura `criarXReal(opcoes)` pode ganhar campos, e o registro passa a repassar a `config`. Essa é a única linha do registro que a E6.6 e a E7.2 tocam.

### 3.7 Ambiente (`<x>/ambiente.ts` e `src/server/env.ts`)
```ts
// Contrato comum de cada <x>/ambiente.ts (só importa zod)
export const SELETOR: 'EMAIL_ADAPTER' | 'WHATSAPP_ADAPTER' | 'MP_ADAPTER' | 'TURNSTILE_ADAPTER';
export const CHAVES: readonly string[];            // variáveis do provedor, declaradas no .env.example
export type ConfigReal = …;
export function lerConfigReal(fonte: Record<string, string | undefined>):
  { ok: true; config: ConfigReal } | { ok: false; variaveis: string[] };   // fonte já com '' → undefined

// email/ambiente.ts
export const CHAVES = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_SECURE', 'EMAIL_FROM'] as const;
export type ConfigSmtp = { host: string; porta: number; seguro: boolean; autenticacao: { usuario: string; senha: string } | null; remetente: string };
// turnstile/ambiente.ts
export const CHAVES = ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'] as const;
export type ConfigTurnstile = { segredo: string };  // a chave do site NÃO entra: é lida em cada chamada (CA-14)
// mercadopago/ambiente.ts e whatsapp/ambiente.ts (E0.6, D-1)
export const CHAVES = [] as const;
export function lerConfigReal() { return { ok: false, variaveis: ['MP_ADAPTER'] } }   // ou ['WHATSAPP_ADAPTER']
```
Regras de `email/ambiente.ts` (RN-13, D-10, com um ajuste):
- `SMTP_HOST` é obrigatório.
- `EMAIL_FROM` é obrigatório. Aceita `email` ou `Nome <email>`, sem CR nem LF, e o e-mail interno passa por `z.email()`.
- `SMTP_SECURE` aceita `true` ou `false` e o padrão é `false`. Outro valor nomeia `SMTP_SECURE`.
- `SMTP_PORT` é um inteiro entre 1 e 65535. Outro valor nomeia `SMTP_PORT`. **Ajuste ao D-10:** o padrão é **587**, ou **465** quando `SMTP_SECURE=true`. TLS implícito em 587 falharia no handshake, e a porta explícita continua prevalecendo.
- `SMTP_USER` e `SMTP_PASSWORD` vêm em par. Se só um estiver presente, a mensagem nomeia o ausente.

```ts
// src/server/env.ts
export type ConfigIntegracao<C> = { modo: 'simulado' } | { modo: 'real'; config: C };
export type Env = {
  DATABASE_URL: string; APP_URL: string;
  integracoes: {
    email: ConfigIntegracao<ConfigSmtp>; turnstile: ConfigIntegracao<ConfigTurnstile>;
    mercadoPago: ConfigIntegracao<ConfigMercadoPagoReal>; whatsapp: ConfigIntegracao<ConfigWhatsAppReal>;
  };
};
export function validarEnv(fonte): Env;      // base (zod) + seletores + lerConfigReal dos que estão em 'real'; um único ErroDeAmbiente com TODOS os nomes
export function modosAtivos(env: Env): { email: Modo; whatsapp: Modo; mercadoPago: Modo; turnstile: Modo };
export function modoSelecionado(fonte, seletor): 'simulado' | 'real' | null;   // sem validar o resto; '' ou ausente → 'simulado'; inválido → null
export function chavesDeclaradas(): string[]; // base + CHAVES das 4 integrações + CHAVES_FORA_DO_RUNTIME
```
- O `esquemaEnv` continua com os 4 seletores (enum, padrão `simulado`). As chaves das integrações não entram no `esquemaEnv`: são lidas por `lerConfigReal` só no modo `real`. Por isso, `SMTP_PORT=abc` com o seletor em `simulado` não falha (CA-8).
- `check-env`: em caso de sucesso, imprime **uma** linha: `check-env: ambiente válido (adaptadores: email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado)`. A falha continua como hoje, só com nomes.
- `worker/stub.ts`: depois de validar, emite `{"evento":"worker.adaptadores","email":"simulado","mercadoPago":"simulado","turnstile":"simulado","whatsapp":"simulado"}` antes do primeiro heartbeat.

### 3.8 Lint (`eslint.config.mjs`)
Grupos de padrões (constantes no topo do arquivo):
- `PRISMA`: os 4 padrões atuais da RN-10, sem nenhuma mudança.
- `SDK_PROVEDOR`: `^nodemailer(/|$)`, `^mercadopago(/|$)`, `^@mercadopago/`, `^@cloudflare/`, `^cloudflare(/|$)`, `^(whatsapp|@whatsapp|@meta)` (com a mensagem "RN-16: use a porta ou o registro de src/server/integrations").
- `ADAPTADORES`: `(^|/)integrations/[^/]+/(real|simulado)(\.[cm]?[jt]s)?$`.
- `ADAPTADORES_EXCETO_MP_SIMULADO`: igual a `ADAPTADORES`, só que sem o MP simulado. Também proíbe `checkout-simulado` fora de `src/app/dev/**`.

Blocos com conjuntos de arquivos **disjuntos** (`files` + `ignores`). Cada arquivo casa com um só bloco que configura `no-restricted-imports`:

| Bloco | Arquivos | `no-restricted-imports` |
|---|---|---|
| Geral | `**/*.{ts,tsx,mts,js,mjs}` menos os de baixo, `tests/**` e `**/*.test.{ts,tsx}` | `PRISMA + SDK_PROVEDOR + ADAPTADORES` |
| Integrações | `src/server/integrations/**` (menos testes) | `PRISMA` (os adaptadores acessam o banco só via `repos`) |
| Repos/worker/seed | `src/server/repos/**`, `src/worker/**`, `prisma/seed.ts` (menos testes) | `SDK_PROVEDOR + ADAPTADORES` |
| Dev | `src/app/dev/**` (menos testes) | `PRISMA + SDK_PROVEDOR + ADAPTADORES_EXCETO_MP_SIMULADO` |

Mais um bloco `no-restricted-syntax` (RN-16 c), para `**/*.{ts,tsx,mts,js,mjs}` menos `src/server/integrations/**`, `tests/**`, `**/*.test.{ts,tsx}` e `eslint.config.mjs`, com os seletores `Literal[value=/challenges\.cloudflare\.com|api\.mercadopago\.com|graph\.facebook\.com/]` e `TemplateElement[value.raw=/…mesmo padrão…/]`. O `eslint-config-next` não usa `no-restricted-syntax`. Se passar a usar, o T-3 registra e mescla.

O teste `importacao-prisma.test.ts` (CA-5 da D-005) **tem de continuar passando sem mudar as asserções**. Ele só ganha casos se a reestruturação exigir, por exemplo provar que `src/server/integrations/x.ts` continua proibido de importar o Prisma.

### 3.9 Adaptador real de e-mail (`email/real.ts`)
```ts
export const TIMEOUTS_SMTP_MS = { conexao: 10_000, saudacao: 10_000, socket: 10_000, dns: 10_000 } as const;
export type OpcoesEmailReal = ConfigSmtp & { exigirTls?: boolean; timeouts?: Partial<typeof TIMEOUTS_SMTP_MS> };
/** Pura (unidade): opções entregues ao createTransport. */
export function opcoesDoTransporte(o: OpcoesEmailReal): SMTPTransport.Options;
export function criarEmailReal(o: OpcoesEmailReal): PortaEmail;
```
- `opcoesDoTransporte`:
  - `host`, `port` e `secure` vêm da config, que o registro monta a partir do ambiente. Os testes passam `127.0.0.1` e a porta do stub (RN-6).
  - `auth` só quando há credenciais.
  - `requireTLS` vale `exigirTls ?? (!secure && auth !== null)`. Isso evita enviar a senha em texto claro a um servidor sem STARTTLS. Os testes com o stub passam `exigirTls: false`.
  - Tempos-limite: os da tabela acima.
  - `logger: false`, `debug: false` (RN-22).
  - `disableFileAccess: true`, `disableUrlAccess: true`.
- `enviar`:
  - chama `validarMensagemEmail`;
  - em seguida, `sendMail({ from: remetente, to: para, subject: assunto, text: texto, html })`;
  - devolve `{ provedorId: info.messageId }`.
- Tradução de erros: `EAUTH` → `autenticacao`; `EENVELOPE`, ou `responseCode` 5xx em `RCPT`/`MAIL` → `recusado`; `ECONNECTION`, `ETIMEDOUT`, `ESOCKET`, `EDNS` ou `ECONNREFUSED` → `conexao`; o resto → `outro`. `temporario` = `err.permanent !== true`.
- O novo `ErroEnvioEmail` **não** recebe `cause`, `response`, `command` nem qualquer propriedade do erro original. O `command` do `nodemailer` pode conter o `AUTH PLAIN <base64>` (CA-12).
- O transporte é criado uma vez por instância e fechado por `fechar()` (só para testes, fora da porta).

### 3.10 Simulados persistentes
Repositórios de plataforma (`src/server/repos/`). Eles não recebem `ContextoEscopado`, uma exceção documentada como `sessao.ts` (D-005), porque os dados são da plataforma e não pertencem a um salão. Cada fábrica recebe um `Executor` opcional, e o padrão é `obterPrisma()` resolvido **na chamada**. Assim, o CA-15 e o CA-20 provam o acesso "entre processos" com um segundo cliente (`criarPrisma(urlDoWorker())`).
```ts
// email-log.ts
export function repoEmailLog(db?: Executor): {
  registrar(e: { destinatario: string; assunto: string; corpo: string }): Promise<{ id: string }>;
  listarPorDestinatario(destinatario: string): Promise<{ id; destinatario; assunto; corpo; criadoEm: Date }[]>;  // criado_em DESC (índice existente)
};
// sim-mercadopago.ts: operações com transição atômica (UPDATE … WHERE estado = $esperado; count 0 → reler e distinguir não encontrado × estado inválido)
export function repoSimMercadoPago(db?: Executor): {
  criarAssinatura(…): Promise<LinhaAssinatura>; buscarAssinatura(id): Promise<LinhaAssinatura | null>;
  autorizar(id, em: Date, proximaCobrancaEm: Date): Promise<'ok' | 'nao_encontrada' | 'estado_invalido'>;
  registrarCobranca(id, status, valorCentavos, em: Date): Promise<{ pagamentoId } | 'nao_encontrada' | 'estado_invalido'>; // SELECT … FOR UPDATE da assinatura + INSERT pagamento + avanço da próxima cobrança se aprovado, numa transação
  cancelar(id, em: Date): Promise<'ok' | 'ja_cancelada' | 'nao_encontrada'>;
  adiar(id, novaData: Date, agora: Date): Promise<'ok' | 'nao_encontrada' | 'estado_invalido' | 'data_invalida'>; // grava sim_mp_adiamento + atualiza, numa transação
  buscarPagamento(id): Promise<LinhaPagamento | null>;
  listarAdiamentos(assinaturaId): Promise<LinhaAdiamento[]>;
  forcarErro(operacao: OperacaoMp): Promise<void>;
  consumirErroForcado(operacao: OperacaoMp): Promise<boolean>;   // DELETE … (SELECT … FOR UPDATE SKIP LOCKED) RETURNING
};
// sim-whatsapp.ts
export function repoSimWhatsApp(db?: Executor): {
  forcarFalhas(n: number, tipo: 'temporaria' | 'permanente'): Promise<void>;    // n ≥ 1 linhas
  /** Uma transação: consome no máximo 1 falha forçada (SKIP LOCKED) e insere a chamada com o resultado. */
  registrarChamada(e: EnvioModelo & { invalida: boolean }, gerarId: () => string): Promise<{ resultado: 'sucesso'; provedorMensagemId: string } | { resultado: 'falha'; tipo: 'temporaria' | 'permanente' }>;
  listarChamadas(filtro?: { chaveIdempotencia?: string }): Promise<LinhaChamada[]>;
};
```
O `$queryRaw` com template marcado fica restrito a esses repositórios (permitido pela RN-10). O DBA valida o SQL de consumo (T-1, item 4).

Adaptadores (`src/server/integrations/`):
```ts
// email/simulado.ts
export function criarEmailSimulado(o?: { repo?: ReturnType<typeof repoEmailLog> }): PortaEmail;
//   validarMensagemEmail → repo.registrar({ destinatario: para, assunto, corpo: texto }) → { provedorId: id }

// mercadopago/datas.ts (pura, unidade)
export function somarDias(d: Date, n: number): Date;     // n × 86 400 000 ms (UTC; não há DST em UTC)
export function somarUmMes(d: Date): Date;               // mês civil UTC; dia limitado ao último do mês (31/jan → 28 ou 29/fev; 31/mar → 30/abr), hora preservada

// mercadopago/webhook-simulado.ts (pura, unidade)
export const SEGREDO_WEBHOOK_SIMULADO = 'segredo-do-webhook-simulado';   // não é segredo: documentado
export function notificacaoSimulada(tipo: 'assinatura' | 'pagamento', recursoId: string, em: Date, requestId?: string): NotificacaoWebhook;
export function validarNotificacaoSimulada(n: NotificacaoWebhook): ResultadoValidacaoWebhook;

// mercadopago/simulado.ts
export interface ControleMpSimulado {
  autorizar(id: string, o?: { em?: Date }): Promise<NotificacaoWebhook>;
  aprovarCobranca(id: string, o?: { em?: Date }): Promise<{ pagamentoId: string; notificacao: NotificacaoWebhook }>;
  falharCobranca(id: string, o?: { em?: Date }): Promise<{ pagamentoId: string; notificacao: NotificacaoWebhook }>;
  cancelar(id: string, o?: { em?: Date }): Promise<NotificacaoWebhook>;
  forcarErro(operacao: OperacaoMp): Promise<void>;
  listarAdiamentos(id: string): Promise<{ dataAnterior: Date | null; novaData: Date; criadoEm: Date }[]>;
}
export function criarMercadoPagoSimulado(o: { appUrl: string; agora?: () => Date; repo?: … }): PortaMercadoPago & ControleMpSimulado;

// whatsapp/simulado.ts
export interface ControleWhatsAppSimulado {
  forcarFalhas(n: number, tipo: 'temporaria' | 'permanente'): Promise<void>;
  listarChamadas(filtro?: { chaveIdempotencia?: string }): Promise<LinhaChamada[]>;
}
export function criarWhatsAppSimulado(o?: { repo?: … }): PortaWhatsApp & ControleWhatsAppSimulado;
```
Regras do MP simulado (RN-17, RN-18):
- `urlCheckout` = `${appUrl}/dev/mp-checkout?assinatura=<id>`.
- O valor é sempre `PRECO_MENSAL_CENTAVOS`.
- **Autorizar**: `pendente → autorizada`, com `proximaCobrancaEm = somarDias(em, DIAS_TESTE)`.
- **Aprovar cobrança**: só em `autorizada`. Cria um pagamento `aprovado` e faz `proximaCobrancaEm = somarUmMes(proximaCobrancaEm)`.
- **Falhar cobrança**: só em `autorizada`. Cria um pagamento `recusado`. O estado e a data não mudam.
- **Cancelar** (evento): `pendente|autorizada → cancelada`. Numa assinatura já cancelada, o evento dá erro. `cancelarAssinatura` (porta) é idempotente.
- Um disparo inválido lança `OperacaoInvalidaNoProvedor`, sem efeito.
- **Adiar**: só em `autorizada` e com `novaData > agora()`. Grava `(data_anterior, nova_data)`.
- **Erro forçado**: cada operação da porta chama `consumirErroForcado(op)` **antes** de qualquer efeito. Se houver erro forçado, lança `ErroProvedor` sem alterar nada.
- Notificação:
  - assinatura: `consulta = { 'data.id': id, type: 'subscription_preapproval' }`, `corpo = { type: 'subscription_preapproval', action: 'updated', data: { id } }`;
  - pagamento: `type: 'subscription_authorized_payment'`, `data.id` = pagamento.
  - Cabeçalhos no formato do MP: `x-request-id` (UUID novo) e `x-signature: ts=<ms>,v1=<hex>`, com HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` sob `SEGREDO_WEBHOOK_SIMULADO`.
- `validarWebhook`: válida só se a assinatura confere (`timingSafeEqual`), o `corpo.data.id` (quando presente) é igual ao `consulta['data.id']` e o `type` é conhecido. Assim, um `data.id` adulterado, um cabeçalho adulterado ou ausente, ou um `ts` trocado dão `{ valida: false }` (CA-16). Não há janela de tempo do `ts` no simulado: os testes de prazo usam instantes fixos. A janela é da E6.6/E6.2. D-6 confirmada.

Regras do WhatsApp simulado (RN-19):
- Quando `validarEnvioModelo` reprova, a chamada é registrada como `falha`/`permanente` **sem consumir** falha forçada, e a porta lança `ErroEnvioPermanente`.
- Nos demais casos, `registrarChamada` consome uma falha forçada, se houver. Com falha, lança o erro do tipo. Sem falha, devolve `provedorMensagemId = 'wamid.SIM.' + randomUUID()`.
- Não há deduplicação.

### 3.11 Registro (`src/server/integrations/registry.ts`)
```ts
export type Modo = 'simulado' | 'real';
export interface Integracoes {
  readonly email: PortaEmail; readonly whatsapp: PortaWhatsApp;
  readonly mercadoPago: PortaMercadoPago; readonly turnstile: PortaTurnstile;
  readonly modos: Readonly<{ email: Modo; whatsapp: Modo; mercadoPago: Modo; turnstile: Modo }>;
}
export function criarIntegracoes(fonte: Record<string, string | undefined>): Integracoes;  // validarEnv(fonte) + seleção
export function integracoes(): Integracoes;      // memoizado sobre process.env; 1º uso lança ErroDeAmbiente (CA-10)
export function redefinirIntegracoes(): void;    // testes
// Seleção pura, por porta (CA-9: 'real' → stubs NaoImplementado mesmo com validarEnv recusando)
export function selecionarEmail(c: ConfigIntegracao<ConfigSmtp>): PortaEmail;
export function selecionarTurnstile(c: ConfigIntegracao<ConfigTurnstile>, lerAmbiente?: () => Record<string, string | undefined>): PortaTurnstile;
export function selecionarMercadoPago(modo: Modo, o: { appUrl: string }): PortaMercadoPago;
export function selecionarWhatsApp(modo: Modo): PortaWhatsApp;
```
- O import não executa nada além de declarações. O estado memoizado fica num `let` do módulo, não em `globalThis`: o objeto é barato e o hot reload pode reconstruí-lo.
- A lógica de negócio (E1.x, E4.2, E6.x, E7.x) importa **só** o `registry.ts` e os tipos das portas. O lint garante isso.

### 3.12 Checkout simulado
```ts
// mercadopago/checkout-simulado.ts
export type DadosCheckout = { assinaturaId: string; valorCentavos: number; diasTeste: number; estado: EstadoAssinaturaProvedor };
export async function carregarCheckoutSimulado(id: string | undefined, fonte = process.env): Promise<DadosCheckout | null>;
//   modoSelecionado(fonte,'MP_ADAPTER') !== 'simulado' → null SEM consultar o banco; id ausente/inválido/inexistente → null
export async function decidirCheckoutSimulado(form: FormData, fonte = process.env): Promise<{ status: 404 } | { status: 303; location: string }>;
//   campos: assinatura, decisao ∈ {autorizar, desistir}; qualquer outro campo (ex.: urlRetorno) é ignorado.
//   autorizar → controle.autorizar(id) (estado ≠ pendente → sem efeito, só redireciona)
//   location = urlRetorno GRAVADA + parâmetro preapproval_id=<id> (como o MP), sem nada vindo da requisição
```
- `page.tsx`:
  - `export const dynamic = 'force-dynamic'` (como `api/health`), `metadata.robots = { index: false }`;
  - `searchParams` → `carregarCheckoutSimulado`, e `null` → `notFound()`;
  - mostra "Assinatura Agenda Beleza", o valor formatado em BRL (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` → "R$ 79,00"), "30 dias grátis" (de `DIAS_TESTE`) e o aviso "Ambiente simulado: nenhum dado de cartão é pedido";
  - tem um `<form method="post" action="/dev/mp-checkout/decisao">` com `assinatura` oculto e dois `<button type="submit" name="decisao">` ("Autorizar assinatura" e "Desistir"). São nativos e operáveis só pelo teclado. O primeiro tem `autoFocus` e foco visível.
- `decisao/route.ts`: `export async function POST(req)`. Lê `req.formData()` e chama `decidirCheckoutSimulado`. Devolve 404 (corpo vazio) ou `new Response(null, { status: 303, headers: { Location } })` com `Cache-Control: no-store`.

## 4. Dados (DBA: **acionado, com posse da migração**)

Migração nova `20261119000000_simuladores_integracao`, que só cria objetos. Proposta inicial (o DBA decide os nomes finais e registra o contrato em `dba.md`):

| Tabela | Colunas (todas `timestamptz(6)`) | Índices e chaves |
|---|---|---|
| `sim_mp_assinatura` | `id uuid PK default gen_random_uuid()`, `referencia_externa text NOT NULL` (salaoId, **sem FK**), `email_pagador text`, `url_retorno text`, `estado sim_mp_estado_assinatura default 'pendente'`, `valor_centavos int`, `autorizada_em`, `proxima_cobranca_em`, `cancelada_em` (anuláveis), `criado_em default now()`, `atualizado_em default now() @updatedAt` | `(referencia_externa)` |
| `sim_mp_pagamento` | `id`, `assinatura_id uuid FK → sim_mp_assinatura RESTRICT/RESTRICT`, `status sim_mp_status_pagamento`, `valor_centavos int`, `ocorrido_em` (sem default: é o instante do disparo), `criado_em default now()` | `(assinatura_id, ocorrido_em)` |
| `sim_mp_adiamento` | `id`, `assinatura_id FK`, `data_anterior` (anulável), `nova_data`, `criado_em default now()` | `(assinatura_id, criado_em)` |
| `sim_mp_erro_forcado` | `id`, `operacao sim_mp_operacao`, `criado_em default now()` | `(operacao, criado_em)` |
| `sim_whatsapp_chamada` | `id`, `destinatario text`, `modelo tipo_mensagem` (enum existente), `parametros jsonb`, `chave_idempotencia text`, `resultado resultado_tentativa` (enum existente), `tipo_falha sim_whatsapp_tipo_falha NULL`, `provedor_mensagem_id text NULL`, `criado_em default now()` | `(chave_idempotencia)`, `(criado_em)` |
| `sim_whatsapp_falha_forcada` | `id`, `tipo sim_whatsapp_tipo_falha`, `criado_em default now()` | `(criado_em, id)` |

Enums novos: `sim_mp_estado_assinatura (pendente, autorizada, cancelada)`, `sim_mp_status_pagamento (aprovado, recusado)`, `sim_mp_operacao (os 5 de OPERACOES_MP)` e `sim_whatsapp_tipo_falha (temporaria, permanente)`.

O DBA deve avaliar e registrar em `docs/demandas/D-007/dba.md`:
1. **Contrato da D-004**: confirmar que as tabelas novas seguem "id `uuid` + `gen_random_uuid()`", "`criado_em` com `now()`", "FKs RESTRICT/RESTRICT" e "só `timestamptz`". Atualizar `drift.test.ts`: `TABELAS` (24 → 30), `ENUMS` (+4), contagem de FKs (35 → 37), lista de migrações do CA-22; e também `MIGRACOES` de `template.test.ts`. A coluna `ocorrido_em` de `sim_mp_pagamento` **não** tem default, e a asserção "instantes de registro com `now()`" do `drift.test.ts` inclui `ocorrido_em`: renomear a coluna (por exemplo, `cobrado_em`) ou ajustar a asserção. Decisão do DBA.
2. **Ausência de FK para tabelas de domínio** (D-2): `referencia_externa` é texto, como no provedor real.
3. **Enums × `text` + CHECK**: reaproveitar `tipo_mensagem` e `resultado_tentativa` cria acoplamento com o domínio. Aceitar (são exatamente os mesmos valores) ou criar enums `sim_*` próprios.
4. **SQL do consumo atômico** (`DELETE … WHERE id = (SELECT id … ORDER BY criado_em, id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING`) junto com o `INSERT` da chamada, na mesma transação `READ COMMITTED`. Confirmar que N envios concorrentes com 1 falha produzem exatamente 1 falha (CA-21) e que não há deadlock com o `SELECT … FOR UPDATE` da assinatura no MP.
5. **Transições do MP simulado**: `UPDATE … WHERE id AND estado = $esperado` para autorizar e cancelar, e `FOR UPDATE` da assinatura antes de inserir o pagamento (dois disparos simultâneos geram dois pagamentos legítimos, nunca um pagamento duplicado por disparo).
6. **Presença em produção**: as tabelas existem vazias na produção. Avaliar se isso é aceitável ou se vale um comentário de tabela (`COMMENT ON TABLE … 'somente adaptador simulado'`). Confirmar que nenhuma coluna guarda cartão, segredo ou token (CA-24).
7. **Dados pessoais** (D-4): `email_pagador` e `destinatario` ficam fora da anonimização (E5.2). Confirmar ou propor uma limpeza.
8. **Down**: um comentário com o rollback manual (`DROP TABLE` e `DROP TYPE` na ordem), como nas migrações da D-004.

## 5. Infraestrutura (DevOps: **acionado, revisão leve**)

- **Variáveis novas** (RN-8): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM`, `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY`. Ficam vazias no `.env.example`, com comentário. Os seletores continuam em `simulado`. Não há variável nova de tempo-limite.
- O compose não muda: o `env_file` já repassa o `.env` aos dois serviços, e o entrypoint já roda o `check-env` antes de `migrate deploy` (app) e do worker. A linha de modos aparece no log dos dois.
- **Imagem**: `nodemailer` vai para `dependencies` e sobrevive ao `npm prune --omit=dev`. O `dist/scripts/check-env.js` (`--packages=external`) só importa `zod`: os `ambiente.ts` não importam adaptadores (o T-2 confere com `grep import dist/scripts/check-env.js`).
- **CI**: nenhuma mudança esperada (sem `secrets.`, sem `*_ADAPTER`). Os testes com stubs escutam em `127.0.0.1` em portas efêmeras (`listen(0)`), o que funciona no runner `ubuntu-latest`.
- O DevOps deve (T-8):
  1. revisar o `.env.example` e a seção de credenciais do README;
  2. colher as evidências de processo do CA-1 (`docker compose up -d --wait` com os logs de modos), do CA-2 (`docker compose run --rm -e EMAIL_ADAPTER=real -e SMTP_HOST= app` e o mesmo com `worker`, código ≠ 0, `SMTP_HOST` no log, sem `migrate deploy`) e do CA-6 (build com `.env` renomeado e sem as variáveis, com e sem `EMAIL_ADAPTER=real`, mais `docker build --target final`, mais `/dev/mp-checkout` como dinâmica na saída do `next build`);
  3. confirmar `node_modules/nodemailer` na imagem final;
  4. confirmar a CI verde no PR;
  5. registrar no `devops.md` o risco D-5 (simulados em produção) para a etapa de publicação.
- Observabilidade: os modos dos adaptadores aparecem no log de inicialização. Nenhum segredo vai para o log.

## 6. Verificação das invariantes

| Invariante | Aplica? | Como é atendida |
|---|---|---|
| Escopo por salão no servidor | Parcial | As tabelas `sim_*` e `email_log` são de plataforma, sem `salao_id` e sem nenhuma ação de tenant que as exponha. A assinatura simulada guarda a referência externa `salaoId` gravada em `criarAssinatura` (o vínculo inequívoco da E6.2). O `/dev/mp-checkout` não usa sessão e imita a página do provedor (D-5). |
| Exclusion anti-sobreposição | Não | Nada toca em `reserva`. |
| UTC + fuso do salão | Sim (parcial) | Todas as datas dos simulados são `timestamptz`, com cálculo em UTC (`somarDias`, `somarUmMes` com a virada de mês documentada e testada). Exibir datas no fuso do salão fica com a E6.3. |
| Adaptadores de integração | **Sim (núcleo)** | Portas + simulado + real por env. Lint RN-16. Nenhum dado de cartão (o checkout não pede cartão; CA-24). |
| Soft deletes / anonimização | Não (registrado) | A anonimização não alcança as tabelas `sim_*` (D-4, revisão do DBA no item 7). |
| Salão suspenso somente leitura | Não | A política é da E6.4. Os adaptadores não decidem capacidade. |
| Idempotência de webhooks e mensagens | Viabilizada | O simulado do MP produz notificações com `x-request-id` e `x-signature` no formato real. A deduplicação é da E6.2. O WhatsApp simulado registra cada chamada com a chave `reserva:tipo:revisao` e **não** deduplica: a E7.1 prova a idempotência contando as linhas. |
| Auditoria do super admin | Não | A E8.2 vai usar `adiarProximaCobranca` pela porta e auditar no próprio fluxo. |

## 7. Riscos e decisões

| # | Risco | Mitigação |
|---|---|---|
| R-1 | A reestruturação do `no-restricted-imports` afrouxar a RN-10 da D-005 (o último bloco substitui o anterior). | Blocos com arquivos disjuntos (§3.8). O `importacao-prisma.test.ts` continua passando sem mudar asserções, e o novo teste cobre `src/server/integrations/x.ts` importando o Prisma (erro). |
| R-2 | Um segredo vazar por `cause` ou pelas propriedades do erro do `nodemailer` (`command` com `AUTH PLAIN <base64>`, `response`). | O erro da porta é construído do zero, só com código e mensagem fixa. O CA-12 serializa `message`, `stack`, `cause` e todas as propriedades enumeráveis e procura a senha, o base64 de `\0user\0senha`, o segredo e o token. `logger: false`, `debug: false`. |
| R-3 | O stub SMTP próprio divergir do protocolo e o teste passar por engano. | O stub responde com códigos reais (220/250/235/535/550/354/221), aceita `AUTH PLAIN` e `AUTH LOGIN` e grava o envelope e os dados brutos. Os testes conferem `MAIL FROM`, `RCPT TO`, o cabeçalho `Subject` e o corpo. O `exigirTls: false` só existe por opção explícita nos testes. Um teste unitário de `opcoesDoTransporte` prova que o registro liga `requireTLS` quando há autenticação sem `secure`. |
| R-4 | O CA-21 ficar instável (concorrência). | `SKIP LOCKED` revisado pelo DBA. O teste usa N = 12 com `Promise.all` sobre o pool de 16 do harness e roda num laço de 10 execuções (tester). |
| R-5 | O `drift.test.ts` quebrar por causa das listas fixas. | O dono é o T-1 (DBA), na mesma tarefa da migração. |
| R-6 | O `nodemailer` gerar aviso ou erro de bundle no Turbopack quando uma rota importar o registro (a partir da E1.1). | No T-6, o desenvolvedor faz uma prova descartável (rota temporária que importa `integracoes`, sem commit) com `npm run build` e registra o resultado no `dev.md`. Se houver aviso ou erro, acrescenta `serverExternalPackages: ['nodemailer']` ao `next.config.ts` (posse do T-6). O pacote já está em `node_modules` de produção na imagem. |
| R-7 | `/dev/mp-checkout` acessível numa instalação publicada com `MP_ADAPTER=simulado`, o que permite autorizar assinaturas simuladas. | Fica restrito ao modo simulado (404 no real, sem banco), com `noindex`. O bloqueio dos simulados num ambiente publicado fica para a etapa de publicação (D-5), registrado pelo DevOps. |
| R-8 | `validarEnv` com o formato novo de retorno quebrar quem já o consome. | Hoje os consumidores são só `check-env` e `worker/stub`, os dois no T-2. |
| R-9 | Memoização de `integracoes()` com um `.env` local em `real` nos testes. | Os testes de integração usam `criarIntegracoes({ ...process.env, EMAIL_ADAPTER: 'simulado', … })` ou uma fonte explícita. O CA-3 usa uma porta obtida do registro. |
| R-10 | `somarUmMes` diferir da regra do MP real. | Não há regra no PLAN. A regra (limitar ao último dia) fica documentada e testada (31/jan → 28/fev, 29/fev em ano bissexto, 31/mar → 30/abr, 31/dez → 31/jan). A E6.3 usa as datas do provedor, não as recalcula. |
| R-11 | Tempos-limite do SMTP somarem até ~30 s numa conexão lenta. | Os três tempos de 10 s são por fase. Ainda assim ficam abaixo do encerramento gracioso de 25 s do worker por fase. Hoje o e-mail é enviado de forma síncrona pela app (E1.x). Se a E1.x enfileirar, revisa. |
| R-12 | Um teste do registro em unidade importar o `repos/db` e o cliente Prisma sem banco. | Importar não conecta (`obterPrisma` é preguiçoso). O CA-10 roda em unidade, sem ambiente. |

Decisões sobre D-1..D-11 da spec:
- **D-1 confirmada.** As exigências ficam em `<x>/ambiente.ts` (a sugestão foi adotada). O CA-9 é provado pelas funções `selecionar*`.
- **D-2 resolvida**: §4, com prefixo `sim_`, `uuid` e sem FK para o domínio. O DBA finaliza.
- **D-3 confirmada**: o disparo devolve a `NotificacaoWebhook`. A E6.2 pode acrescentar "entregar ao endpoint".
- **D-4 confirmada**, com revisão do DBA (item 7).
- **D-5 confirmada** como risco (R-7), registrado pelo DevOps.
- **D-6 confirmada**: `x-signature` no formato do MP, HMAC-SHA256 com `SEGREDO_WEBHOOK_SIMULADO` (§3.10).
- **D-7 confirmada**: token `XXXX.DUMMY.TOKEN.XXXX` e chave `1x00000000000000000000AA`.
- **D-8 confirmada**: o `email_log.corpo` guarda o `texto`.
- **D-9 confirmada**: comando `psql` no README, por exemplo `docker compose exec postgres psql -U agenda -d agenda_beleza -c "SELECT criado_em, destinatario, assunto, corpo FROM email_log ORDER BY criado_em DESC LIMIT 5"`.
- **D-10 confirmada, com ajuste**: a porta padrão passa a ser 465 quando `SMTP_SECURE=true` (§3.7).
- **D-11 confirmada**: Turnstile 5 s; SMTP 10 s por fase. Os dois são injetáveis.

## 8. Estratégia de testes

- **Unitário** (`src/**`, sem banco):
  - `plano.test.ts`;
  - `port.test.ts` de cada porta (validações e erros com mensagem fixa);
  - `ambiente.test.ts` de cada integração;
  - `env.test.ts`, `check-env.test.ts` e `stub.test.ts` (CA-2, CA-8, CA-9 no check-env e chaves do `.env.example`);
  - `turnstile/simulado.test.ts` (CA-4);
  - `turnstile/real.test.ts` (CA-5, CA-13, CA-14, parte Turnstile do CA-12) com `tests/support/stubs/http.ts`;
  - `email/real.test.ts` (CA-11, a parte real do CA-23, parte SMTP do CA-12, `opcoesDoTransporte`) com `tests/support/stubs/smtp.ts`;
  - `mercadopago/real.test.ts` e `whatsapp/real.test.ts` (CA-9: todo método rejeita com `NaoImplementado`, e a mensagem cita E6.6/E7.2);
  - `mercadopago/datas.test.ts`, `webhook-simulado.test.ts` (CA-16, parte pura);
  - `registry.test.ts` (CA-1 a partir do `.env.example`, CA-9 seleção, CA-10 import sem ambiente e erro no 1º uso).
- **Integração** (PostgreSQL real, harness da D-005):
  - `integracoes/email-simulado.test.ts` (CA-3 pelo adaptador, CA-23 simulado: `email_log` sem linha nova);
  - `mp-simulado.test.ts` (CA-15, CA-16 ponta a ponta, CA-17, CA-18, disparos concorrentes);
  - `whatsapp-simulado.test.ts` (CA-20);
  - `whatsapp-concorrencia.test.ts` (CA-21);
  - `registro.test.ts` (CA-3 pela porta do registro);
  - `checkout.test.ts` (CA-19: `carregarCheckoutSimulado`, `page.tsx` renderizada com `renderToStaticMarkup` contendo "R$ 79,00", `notFound()` com o digest 404, `POST` do route handler com 303 e `Location` = `urlRetorno` gravada, mesmo com `urlRetorno` forjada no form, 404 com id inexistente; com `MP_ADAPTER=real`, 404 e nenhuma consulta, provado por um ID de assinatura existente que não é autorizado);
  - `lint/importacao-integracoes.test.ts` (CA-22);
  - `documentacao.test.ts` (CA-4: README contém `TOKEN_TURNSTILE_SIMULADO` e `CHAVE_SITE_TURNSTILE_SIMULADA`; CA-25: README cita as variáveis, `email_log`, `/dev/mp-checkout`, E6.6/E7.2);
  - `db/drift.test.ts` atualizado (CA-24).
- Cada `it` traz o ID do CA no título.
- **Manual (tester)**:
  - CA-1, CA-2 e CA-6 por processo (com a evidência do DevOps conferida);
  - CA-19 no navegador, só pelo teclado (Tab, Enter, foco visível);
  - CA-22 com um arquivo violador temporário e `npm run lint` ≠ 0;
  - CA-21 num laço de 10 execuções;
  - CA-14 `grep -rn NEXT_PUBLIC_ src` vazio;
  - RN-21 `grep` de `7900`.
- **Playwright**: nenhum novo (§1.1). O `smoke.spec.ts` continua passando (CA-25).
- **Cobertura ≥ 90%**: `src/server/integrations/**`, `src/config/plano.ts`, os repositórios novos e `src/app/dev/**` (página e handler, exercitados em integração) entram no gate. Os reais são cobertos pelos stubs. Não há exclusão nova. Os ramos de erro de rede são cobertos com porta fechada e stub silencioso, com tempo-limite injetado curto (≤ 300 ms). Se a medição ficar abaixo de 90%, o T-7 acrescenta testes com asserções.

## 9. Tarefas

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | dba | — | T-2, T-3 | `prisma/schema.prisma`, `prisma/migrations/20261119000000_simuladores_integracao/**`, `tests/integration/db/drift.test.ts`, `tests/integration/harness/template.test.ts`, `docs/demandas/D-007/dba.md` |
| T-2 | desenvolvedor | — | T-1, T-3 | `src/config/plano.ts` (+ teste), `src/server/integrations/{email,whatsapp,mercadopago,turnstile}/{port,ambiente}.ts` (+ testes), `src/server/env.ts`, `src/server/env.test.ts`, `src/server/check-env.ts`, `src/server/check-env.test.ts`, `src/scripts/check-env.test.ts`, `src/worker/stub.ts`, `src/worker/stub.test.ts`, `.env.example` |
| T-3 | desenvolvedor | — | T-1, T-2 | `eslint.config.mjs`, `tests/integration/lint/importacao-integracoes.test.ts`, `tests/integration/lint/importacao-prisma.test.ts` |
| T-4 | desenvolvedor | T-2 | T-5 | `src/server/integrations/nao-implementado.ts`, `src/server/integrations/email/real.ts`, `src/server/integrations/turnstile/{real,simulado}.ts`, `src/server/integrations/mercadopago/real.ts`, `src/server/integrations/whatsapp/real.ts` (+ `*.test.ts` desses arquivos), `tests/support/stubs/{http,smtp}.ts`, `package.json`, `package-lock.json` |
| T-5 | desenvolvedor | T-1, T-2 | T-4 | `src/server/repos/{email-log,sim-mercadopago,sim-whatsapp}.ts`, `src/server/integrations/email/simulado.ts`, `src/server/integrations/mercadopago/{simulado,datas,webhook-simulado}.ts`, `src/server/integrations/whatsapp/simulado.ts` (+ `*.test.ts` unitários desses arquivos), `tests/integration/integracoes/{email-simulado,mp-simulado,whatsapp-simulado,whatsapp-concorrencia}.test.ts` |
| T-6 | desenvolvedor | T-3, T-4, T-5 | — | `src/server/integrations/registry.ts`, `registry.test.ts`, `src/server/integrations/mercadopago/checkout-simulado.ts`, `src/app/dev/mp-checkout/page.tsx`, `src/app/dev/mp-checkout/decisao/route.ts`, `tests/integration/integracoes/{registro,checkout}.test.ts`, `next.config.ts` |
| T-7 | desenvolvedor | T-6 | T-8 | `README.md`, `tests/integration/integracoes/documentacao.test.ts`, `docs/demandas/D-007/dev.md` |
| T-8 | devops | T-6 | T-7 | `docs/demandas/D-007/devops.md` (e `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml` só se precisar mudar; mudanças no README ou no `.env.example` são pedidas ao T-7 ou registradas como reabertura do T-2) |
| T-9 | tester | T-7, T-8 | — | `docs/demandas/D-007/testes.md` |

Rodadas paralelas sem arquivo em comum:
- Rodada 1: T-1 ‖ T-2 ‖ T-3.
- Rodada 2: T-4 ‖ T-5. O T-4 começa assim que o T-2 termina, e o T-5 espera também o T-1, por causa do cliente Prisma gerado.
- Rodada 3: T-6.
- Rodada 4: T-7 ‖ T-8.
- Rodada 5: T-9.

O `package.json` é só do T-4: o T-5 não instala nada. O T-3 testa caminhos simulados (`filePath`), então não depende dos arquivos reais de T-4 e T-5. O T-6 depende do T-3 porque `src/app/dev/**` precisa passar no lint com a exceção do MP simulado.

**T-1 — Migração dos simulados e parecer (DBA).**
- Entregável:
  - os modelos e enums do §4 no `schema.prisma`, com os nomes finais decididos;
  - a migração gerada por `prisma migrate diff`/`migrate dev --create-only`, revisada e com o comentário de rollback;
  - `drift.test.ts` e `template.test.ts` atualizados;
  - `dba.md` respondendo aos itens 1 a 8 do §4, com o **contrato de nomes** (tabelas, colunas, enums) que o T-5 usa, e o SQL de consumo atômico aprovado.
- Critério de conclusão:
  - `npm run db:generate`, `npm run db:migrate:deploy` num banco zerado e `npm run test:integration` (inclusive o `drift.test.ts`) passam;
  - `prisma migrate diff` não acusa diferença;
  - nenhuma coluna de cartão, segredo ou token.
- Ajustes que mudem o §3.10 voltam ao arquiteto ou ficam registrados como "aceito com ajuste X", que o T-5 aplica.

**T-2 — Plano, portas, ambiente, check-env e worker.**
- Entregável:
  - §3.1 a §3.5 (só portas, tipos, erros e validações; sem adaptadores);
  - §3.7 completo;
  - linha de modos no check-env e evento `worker.adaptadores`;
  - `.env.example` com as 8 variáveis novas comentadas e vazias;
  - testes unitários: CA-7; CA-8 (todos os casos listados, mais "nenhum valor na saída"); CA-2 (`executarCheckEnv` e `iniciarWorker`); CA-9 (check-env recusa `MP_ADAPTER=real` e `WHATSAPP_ADAPTER=real` nomeando o seletor); paridade de chaves; `modoSelecionado`.
- Critério de conclusão:
  - `lint`, `typecheck`, `build` e `test:unit` passam (sem banco);
  - `npm run build:node` gera um `dist/scripts/check-env.js` sem `import` de `nodemailer`/Prisma (`grep -E "^import" dist/scripts/check-env.js` só mostra `zod`);
  - nenhum arquivo `port.ts` ou `ambiente.ts` importa algo além de `zod`, `node:crypto` (se preciso) ou outra porta.

**T-3 — Lint RN-16.**
- Entregável:
  - §3.8;
  - `importacao-integracoes.test.ts` com os casos do CA-22: erro em `src/server/x.ts` e `src/app/x.ts` com `nodemailer`; erro em `src/app/x.ts` com `@/server/integrations/mercadopago/simulado`, com `@/server/integrations/email/real` e com o literal do `siteverify` (string e template); erro em `src/server/integrations/x.ts` com `@/generated/prisma/client`; sem erro em `src/server/integrations/email/real.ts` com `nodemailer`, em `src/app/dev/mp-checkout/page.tsx` com o MP simulado, em `tests/x.test.ts` e em `src/app/x.ts` importando `@/server/integrations/registry` ou `…/email/port`; o auxiliar falha se o arquivo estiver ignorado.
- Critério de conclusão:
  - `importacao-prisma.test.ts` verde **sem alteração de asserções**;
  - `npm run lint` verde no repositório;
  - nenhum `eslint-disable` das regras.

**T-4 — Adaptadores reais, Turnstile simulado e stubs.**
- Entregável:
  - `npm install --save-exact nodemailer@10.3.1` (sem `@types`; o lock é regenerado pelo `npm`, sem `--force`);
  - §3.3 (simulado e real), §3.6 e §3.9;
  - os stubs HTTP e SMTP (`listen(0, '127.0.0.1')`, registro das requisições ou envelopes, modos `aceitar`, `recusarAuth`, `recusarRcpt`, `silencioso` e `status500`/`naoJson`, e `fechar()`);
  - os testes unitários de CA-4, CA-5, CA-9 (stubs), CA-11, CA-12, CA-13, CA-14 e da parte real do CA-23 (o stub não recebe `MAIL FROM`).
- Critério de conclusão:
  - `package.json` com `"nodemailer": "10.3.1"` em `dependencies`;
  - `npm ci` limpo sem aviso de `allowScripts`;
  - `lint`, `typecheck`, `build` e `test:unit` passam;
  - os testes de tempo-limite terminam em menos de 2 s cada;
  - nenhum `console.*` nos adaptadores (`grep`).

**T-5 — Repositórios de plataforma e simulados persistentes.**
- Entregável:
  - §3.10 conforme o contrato de nomes do `dba.md`;
  - unitários de `datas.ts` (viradas de mês do R-10) e `webhook-simulado.ts` (assinatura certa, adulterada e ausente);
  - integrações:
    - CA-3 (pelo adaptador), CA-23 (simulado);
    - CA-15, inclusive a leitura por uma instância nova sobre outro cliente `criarPrisma(urlDoWorker())`, encerrado no fim;
    - CA-16, CA-17 e CA-18;
    - dois `aprovarCobranca` simultâneos → 2 pagamentos e próxima cobrança avançada 2 meses;
    - `autorizar` simultâneo → 1 sucesso e 1 `OperacaoInvalidaNoProvedor`;
    - CA-20, inclusive a falha configurada por um cliente e consumida por outro;
    - CA-21 com N = 12.
- Critério de conclusão:
  - os testes passam 3 vezes seguidas;
  - `npm run lint` passa (os simulados não importam o Prisma);
  - `grep -rn '\$transaction\|\$queryRaw\|\$executeRaw' src/server/integrations` vazio (a transação e o SQL ficam nos repos);
  - nenhum simulado aceita executor do chamador fora dos testes.

**T-6 — Registro e checkout simulado.**
- Entregável:
  - §3.11 e §3.12;
  - unitários do registro: CA-1 com `.env.example` lido por `parseEnv`; CA-9 com a seleção `real` dando as instâncias de `real.ts`; CA-10 com o import em processo sem ambiente (`vi.resetModules` + `vi.unstubAllEnvs` e import dinâmico) e o erro nomeando `SMTP_HOST` no 1º uso; CA-14 pela porta do registro;
  - integrações `registro.test.ts` e `checkout.test.ts` (§8);
  - a prova descartável do R-6, registrada no `dev.md` do T-7 (o T-6 a entrega ao T-7 pela transferência).
- Critério de conclusão:
  - `npm run build` lista `/dev/mp-checkout` e `/dev/mp-checkout/decisao` como dinâmicas (ƒ);
  - `lint`, `typecheck` e `npm test` passam;
  - `grep -rn "integrations/.*/\(real\|simulado\)" src --include=*.ts --include=*.tsx` fora de `src/server/integrations/**`, `src/app/dev/**` e dos testes fica vazio.

**T-7 — Documentação e gates.**
- Entregável:
  - README, seção "Credenciais para os serviços reais": e-mail real (variáveis, padrão 587/465, `requireTLS` com autenticação), Turnstile real, MP e WhatsApp com "adaptador real: E6.6/E7.2" (hoje recusados na inicialização);
  - nova subseção "Adaptadores simulados": token e chave do Turnstile, comando `psql` do `email_log`, `/dev/mp-checkout`, disparos do MP e falha forçada do WhatsApp (pelas funções de controle, nos testes) e o aviso de que o modo simulado não é para publicação;
  - `documentacao.test.ts`;
  - `dev.md` com gates, evidências e o resultado do R-6.
- Critério de conclusão:
  - `lint`, `typecheck`, `build`, `npm test`, `npm run test:coverage` (≥ 90% de linhas, sem exclusão nova) e `npm run test:e2e` passam;
  - o laço de 10 execuções do CA-21 (`for i in $(seq 10); do npx vitest run --project integration tests/integration/integracoes/whatsapp-concorrencia.test.ts || break; done`) termina com 0.

**T-8 — Revisão de infraestrutura (DevOps).**
- Entregável: o `devops.md` com os itens 1 a 5 do §5, as evidências de processo do CA-1, CA-2 e CA-6, a confirmação do `nodemailer` na imagem e a CI verde no PR.
- Critério de conclusão: cada item tem um veredito. Ajustes no README ou no `.env.example` voltam ao T-7 ou ao T-2, sem edição direta. Mudanças em `Dockerfile`, compose ou CI (não esperadas) ficam justificadas.

**T-9 — Validação independente (tester).**
- Entregável: o `testes.md` com o veredito.
- Critério de conclusão: todos os CAs com evidência, mais as verificações manuais do §8. Mutações sugeridas:
  - retirar `logger: false` ou repassar `cause` no e-mail real → o CA-12 falha;
  - trocar `SKIP LOCKED` por leitura sem trava → o CA-21 falha no laço;
  - remover a checagem de `MP_ADAPTER` no checkout → o CA-19 (modo real) falha;
  - mover o bloco RN-16 para depois do da RN-10 como bloco solto → o `importacao-prisma.test.ts` ou o CA-22 falha;
  - validar o ambiente no import do registro → o CA-10 ou o CA-6 falha;
  - redirecionar para a `urlRetorno` do formulário → o CA-19 falha.

### Mapa CA → tarefa → tipo de teste
| CA | Tarefa | Tipo |
|---|---|---|
| CA-1 | T-2 (modos no check-env e no worker), T-6 (`registry.test.ts`), T-8 (compose) | Unitário + processo |
| CA-2 | T-2 (`check-env.test.ts`, `stub.test.ts`), T-8 (`docker compose run`) | Unitário + processo |
| CA-3 | T-5 (`email-simulado.test.ts`), T-6 (`registro.test.ts`) | Integração |
| CA-4 | T-4 (`turnstile/simulado.test.ts`), T-7 (`documentacao.test.ts`) | Unitário + integração (README) |
| CA-5 | T-4 (`turnstile/real.test.ts`, stub HTTP) | Unitário |
| CA-6 | T-2/T-6 (nada valida no import), T-6 (`build` dinâmico), T-8 (build sem `.env` e `docker build`) | Processo |
| CA-7 | T-2 (`plano.test.ts`) | Unitário |
| CA-8 | T-2 (`check-env.test.ts`, `ambiente.test.ts`) | Unitário |
| CA-9 | T-2 (recusa), T-4 (`NaoImplementado`), T-6 (seleção) | Unitário |
| CA-10 | T-6 (`registry.test.ts`) | Unitário |
| CA-11 | T-4 (`email/real.test.ts`, stub SMTP) | Unitário |
| CA-12 | T-4 (e-mail e Turnstile reais) | Unitário |
| CA-13 | T-4 (`turnstile/real.test.ts`) | Unitário |
| CA-14 | T-4 (real), T-6 (pelo registro), T-9 (`grep`) | Unitário + estático |
| CA-15, CA-17, CA-18 | T-1 (tabelas), T-5 (`mp-simulado.test.ts`) | Integração |
| CA-16 | T-5 (`webhook-simulado.test.ts` + `mp-simulado.test.ts`) | Unitário + integração |
| CA-19 | T-6 (`checkout.test.ts`), T-9 (navegador e teclado) | Integração + manual |
| CA-20 | T-5 (`whatsapp-simulado.test.ts`) | Integração |
| CA-21 | T-5 (`whatsapp-concorrencia.test.ts`), T-7 e T-9 (laço de 10) | Integração + execução repetida |
| CA-22 | T-3 (`importacao-integracoes.test.ts`), T-9 (manual) | Integração (API do ESLint) + manual |
| CA-23 | T-2 (`validarMensagemEmail`), T-4 (real + stub), T-5 (simulado + `email_log`) | Unitário + integração |
| CA-24 | T-1 (migração, `drift.test.ts`) | Integração |
| CA-25 | T-2 (`.env.example` + paridade), T-7 (README, `documentacao.test.ts`, gates), T-8 (CI sem segredos) | Unitário + integração + gates |
