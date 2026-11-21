# D-023 — Desenho: Termos, Privacidade e consentimento versionado por finalidade (issue #33, E4.3)

Entradas: `docs/demandas/D-023/spec.md` (RN-1..RN-21, CA-1..CA-21, D-1..D-11), `CLAUDE.md`, `docs/trinks-alinhamento.md` (§7.4, §8), `docs/demandas/D-022/design.md` (formato, ordem de travas, trava da cliente) e `D-020/design.md`. Código lido: `prisma/schema.prisma` (`Consentimento`, `Cliente`), migração `20261118000000_init` (`:17`, `:186-195`, `:431`, `:560-563`), `src/server/tenant/context.ts`, `src/server/repos/{index,cliente,servico,transacao}.ts`, `src/components/ui/Checkbox.tsx`, `src/components/layout/PublicLayout.tsx`, `src/app/(publico)/entrar/page.tsx`, `src/config/navegacao.ts`, `src/lib/site.ts`, `tests/support/factories.ts`, `tests/integration/db/{drift,isolamento-salao}.test.ts`.

## 0. Verificações feitas antes do desenho

- **Sem consumidor do consentimento hoje.** Nenhum código de produção lê ou grava `consentimento` (só o schema, o cliente gerado, a vitrine `Vitrine.tsx` e o `Checkbox` mencionam o termo). A mudança de coluna é segura para o código.
- **Testes existentes que quebram com a migração (D-2: retirar o DEFAULT):** `tests/integration/db/isolamento-salao.test.ts:168-175` insere `consentimento` sem `finalidade` e espera `23503`; sem o padrão passaria a dar `23502`. `tests/integration/db/drift.test.ts` lista tabelas, enums (`:74`), FKs (`:167`) e índices (`:144-146`) e precisa conhecer o enum novo, o índice novo e a saída do índice antigo. Ambos ficam sob posse do DBA (T-1).
- **FK composta `(salao_id, cliente_id)` → `cliente(salao_id, id)`** (init `:563`, `RESTRICT`): a inserção toma `FOR KEY SHARE` na linha da cliente. `upsert` da cliente é `NO KEY UPDATE` (compatível); edição de telefone é `FOR UPDATE` (serializa; `telefone_e164` está em índice único, logo é atualização de chave); a anonimização (E5.2) também altera `telefone_e164`, logo também é `FOR UPDATE`. Isso decide o desenho de RN-12 (A-4).
- **Contextos:** `ContextoEscopado = TenantContext | SistemaContext` (`context.ts:54`); `exigirEscopo` rejeita `publico`/`admin`. A reserva pública (E4.2) usará `contextoDeSistema(salaoId, origem)`; o discriminante é `ctx.tipo` (`'tenant' | 'sistema'`).
- **`ROTAS.termos`/`ROTAS.privacidade` e `SEGMENTOS_RESERVADOS`** já existem; não mudam. `ROTAS.devConsentimento` é novo.
- **Mensagem de erro que não vaza:** `NaoEncontrado` (`src/server/tenant/erros`) já é o erro 404 padrão do repositório.

## 1. Resumo da solução

1. **Migração aditiva (DBA obrigatório):** enum `finalidade_consentimento`, coluna `consentimento.finalidade` (backfill `mensagens_reserva`, depois sem DEFAULT), `CHECK` origem × finalidade, `CHECK` de `versao_termos`, índice de vigente. **DevOps dispensado** (§5).
2. **Fonte única `src/config/termos.ts`** (`VERSAO_TERMOS`, `VIGENCIA_TERMOS`, textos das três caixas como partes com links tipados) e `src/config/termos-documentos.ts` (seções de Termos e Privacidade como dados). Um teste de guarda por hash (A-6) amarra qualquer mudança de texto à mudança de versão.
3. **Servidor `src/server/consentimento/`:** `tipos.ts` (client-safe), `validacao.ts` (puro), `formulario.ts` (leitura de `FormData`), `servico.ts` (`registrarConsentimento`, `registrarConsentimentoDaReserva`), `leitura.ts` (`consentimentoVigente`, `temConsentimentoDeMensagens`). Repositório `src/server/repos/consentimento.ts` (`Repos.consentimentos`).
4. **UI:** páginas estáticas `/termos` e `/privacidade`, componente `CaixasConsentimento`, vitrine `/dev/consentimento`.
5. Sem ação pública, sem `'use server'` no servidor de consentimento, sem chamada na reserva (E3.2/E3.4/E4.1 usam o contrato da §3.5).

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Uma linha por (cliente, finalidade) com `UPDATE` ao reaceitar | Perde a trilha por aceite e a prova da versão aceita; contraria RN-4 e D-4. |
| `UNIQUE (salao_id, cliente_id, finalidade, versao_termos)` com `ON CONFLICT DO NOTHING` | Perde a data de cada aceite; a RN-4 pede uma linha por reserva. Sem UNIQUE não há 23505 a tratar. |
| Coluna `reserva_id` em `consentimento` | Reserva e consentimento são gravados na mesma transação, mas o vínculo não é exigido por nenhum CA; a E3.2 ainda não existe. Aditiva depois, se a E3.2 quiser provar "aceito nesta reserva". Fica anotado (R-5), não feito. |
| Equipe declara `convite_avaliacao` | DT-7 exige consentimento específico **da cliente**; declaração de terceiro não prova isso (D-3). `CHECK` no banco impede. |
| Origem derivada só do tipo de contexto, sem parâmetro | Esconderia a intenção no chamador e impediria o teste CA-9 de ver o erro de programação. O chamador **informa** a origem e o serviço a **valida** contra `ctx.tipo` (RN-11). |
| Verificar a cliente anonimizada só pela aplicação (`SELECT` simples, depois `INSERT`) | Corrida com a anonimização (E5.2): ela poderia confirmar entre o `SELECT` e o `INSERT`. `SELECT … FOR KEY SHARE` + `INSERT` na mesma transação fecha a janela (A-4). |
| Gatilho de imutabilidade (`UPDATE`/`DELETE`) | D-9: não é CA, e fábricas/limpezas de teste e a anonimização futura podem precisar mexer. Fica com o DBA como recomendação **não incluída** (§4). |
| Versões separadas (Termos, Privacidade, cada caixa) | Complexidade sem ganho na v1 (D-5). |
| Revogação de consentimento por tela | Fora do escopo (D-8); "vigente" = existência. |
| Armazenar os textos dos documentos em Markdown/MDX | Dependência nova sem necessidade; dados tipados em TS permitem o hash e o teste por termo (CA-6). |

### 1.2 Dependências novas

Nenhuma biblioteca, ferramenta ou framework. `node:crypto` só no teste de guarda.

## 2. Decisões

| ID | Decisão | Justificativa |
|---|---|---|
| A-1 (D-1) | **Fronteira confirmada.** Aqui: config/versão/textos, páginas, migração, repositório, validador, `registrarConsentimento`, `registrarConsentimentoDaReserva`, `consentimentoVigente`, `temConsentimentoDeMensagens`, `CaixasConsentimento` + leitura de `FormData`, vitrine, fábrica. Fora: formulário público completo, Turnstile/rate limit, ação pública (E4.1/E4.2), chamada na reserva (E3.2/E3.4), gatilho do convite (E3.5), gravação de `publicacao_avaliacao` e tela da avaliação (E4.5, que chama `registrarConsentimento`). | Um arquivo por demanda. O contrato que a E3.2 chama está na §3.5. |
| A-2 (D-2) | **Confirmada.** `ADD COLUMN finalidade … NOT NULL DEFAULT 'mensagens_reserva'` (backfill) e `ALTER COLUMN finalidade DROP DEFAULT` na mesma migração. O código sempre informa. Backfill seguro: não há linhas em produção e o único consentimento antigo é o da reserva. | Padrão silencioso gravaria a finalidade errada no futuro. |
| A-3 (D-3) | **Confirmada**, reforçada no banco: `CONSTRAINT consentimento_origem_finalidade_chk CHECK (finalidade = 'mensagens_reserva' OR origem = 'publico')`. Aplicação recusa antes (`RangeError`, A-5) e o banco é a última defesa (CA-16). | Nenhuma tela ou chamada futura consegue gravar convite por equipe. |
| A-4 (RN-9, RN-12) | `RepoConsentimento.registrar` roda **dentro da transação do chamador** (mesmo `Executor`) em dois comandos: (1) `SELECT anonimizada_em FROM cliente WHERE id=$1 AND salao_id=$2 FOR KEY SHARE` (0 linhas → `NaoEncontrado`; `anonimizada_em` não nulo → `NaoEncontrado`); (2) `INSERT INTO consentimento (salao_id, cliente_id, finalidade, origem, versao_termos, criado_em) VALUES … RETURNING …`. Ordem de travas: … → **cliente** (`FOR KEY SHARE`, pelo `SELECT`, e de novo pela FK) → **consentimento** → `reserva`/`reserva_item`. | `FOR KEY SHARE` é compatível com o `NO KEY UPDATE` do `upsert` e com outros registros (10 paralelos sem espera) e conflita com o `FOR UPDATE` da edição de telefone e da anonimização, que então esperam a transação da reserva (curta) ou, se vierem antes, a releitura em READ COMMITTED enxerga a cliente já anonimizada. Sem impasse: consentimento nunca toma `salao` nem espera por linha de `cliente` já travada em modo mais forte do que a ordem global permite. A E3.2 deve travar `salao` **primeiro** quando precisar dele (obrigação da D-022 A-6, reafirmada). |
| A-5 (RN-11) | Erro de programação = `RangeError` (500), nunca resultado de negócio: origem × `ctx.tipo` (`tenant` ⇒ `equipe`; `sistema` ⇒ `publico`), origem × finalidade (RN-6/RN-7), finalidade fora do enum, `agora` não `Date` válida. Cliente inexistente, de outro salão, id não UUID ou anonimizada ⇒ `NaoEncontrado` (404), sem distinguir os casos. Entrada de **aceite** inválida (RN-1/RN-19) ⇒ resultado `{ ok:false, erros }`, nunca exceção. | Separa bug do chamador de erro do usuário; CA-9 e CA-10. |
| A-6 (D-5, RN-15) | `VERSAO_TERMOS = '2026-11-21-provisorio'` (regex `^[a-z0-9._-]{1,40}$`, teste de unidade). Teste de guarda em `src/config/termos.test.ts`: um mapa literal `HASHES_POR_VERSAO: Record<string,string>` (SHA-256 hex do JSON canônico de `TEXTOS_CONSENTIMENTO` + `DOCUMENTOS`); falha se `HASHES_POR_VERSAO[VERSAO_TERMOS]` não existe ou difere do hash calculado, e se alguma versão antiga do mapa foi removida (impossível checar sem histórico: o teste só exige que o mapa tenha ao menos a vigente e que as chaves sejam únicas e válidas). Mudar texto exige nova versão **e** nova entrada. | Imutabilidade textual por versão sem tabela de textos. |
| A-7 (D-7, RN-20) | `registrarConsentimento` recebe `agora: Date` do chamador (mesmo instante de `defineAcao`/reserva) e lê `VERSAO_TERMOS` do config; para o CA-13 o último parâmetro opcional `deps?: { versaoVigente?: () => string }` (somente testes; o chamador de produção nunca o passa). | Determinismo e anti-falsificação. |
| A-8 (D-4, RN-14) | Sem UNIQUE. Índice `consentimento_vigente_idx (salao_id, cliente_id, finalidade, criado_em DESC, id DESC)` **substitui** `consentimento_salao_id_cliente_id_idx` (o prefixo `(salao_id, cliente_id)` do novo cobre a FK e as consultas). Decisão final do DBA. Vigente = `ORDER BY criado_em DESC, id DESC LIMIT 1` em um só comando com a cliente (A-9). | Uma consulta indexada por reserva/convite. |
| A-9 | `consentimentoVigente` num comando: `SELECT c.anonimizada_em, k.* FROM cliente c LEFT JOIN LATERAL (SELECT … FROM consentimento k WHERE k.salao_id = c.salao_id AND k.cliente_id = c.id AND k.finalidade = $3::finalidade_consentimento ORDER BY k.criado_em DESC, k.id DESC LIMIT 1) k ON true WHERE c.id = $1::uuid AND c.salao_id = $2::uuid`. Zero linhas ⇒ `NaoEncontrado`; `anonimizada_em` não nulo ⇒ `null`; sem consentimento ⇒ `null`. Sem trava (leitura). | CA-10, CA-11, CA-14 num comando consistente. |
| A-10 (RN-19) | `ehAceite(v) = v === true \|\| v === 'on'`. A entrada de aceites é lida por `Object.hasOwn` e só se `typeof === 'object' && !== null && !Array.isArray`; chaves extras ignoradas; nunca lança. `FormData` → `lerConsentimentoDoFormulario(fd)` devolve `{ mensagensReserva: FormDataEntryValue \| null, conviteAvaliacao: … }` lidos de nomes fixos (`CAMPOS_CONSENTIMENTO`). | CA-1, CA-5, prototype pollution. |
| A-11 (RN-16) | Páginas `export const dynamic = 'force-static'`, sem `searchParams`, sem `cookies`/`headers`; conteúdo de `termos-documentos.ts`; `PublicLayout` variante plataforma. O `PublicLayout` já é estático (D-009). Se o build marcar `ƒ`, é defeito (CA-21). | Páginas legais públicas e cacheáveis. |
| A-12 (D-11) | Contato do salão/plataforma citado sem inventar e-mail: "o contato informado na página do salão" e "o canal de contato da Agenda Beleza" (nome de `siteConfig.name`). Pendência de revisão jurídica registrada na seção 7 (R-6) e no rodapé do aviso provisório. | Texto jurídico definitivo é decisão do titular. |
| A-13 (D-6, RN-13) | Troca de versão não reescreve nem invalida. Vigente devolve a linha com a **versão aceita** (`versaoTermos` no DTO). Nenhuma consulta compara a versão com a atual. | CA-13. |
| A-14 (D-9) | Gatilho de imutabilidade: **recomendado ao DBA, não requisito**. Se adotado, deve permitir o harness (bases descartadas, sem `DELETE`/`TRUNCATE` de teste) e a futura anonimização (que não apaga). | Não vira CA; evita travar E5.2. |
| A-15 (D-10) | Cadastro do gestor (E1.1) não muda. | Confirmada. |

## 3. Interfaces

### 3.1 Config (`src/config/termos.ts`, client-safe, sem imports de servidor)

```ts
export const VERSAO_TERMOS = '2026-11-21-provisorio';
export const VIGENCIA_TERMOS = '2026-11-21';            // data de calendário (YYYY-MM-DD), sem fuso
export const FINALIDADES = ['mensagens_reserva', 'convite_avaliacao', 'publicacao_avaliacao'] as const;
export type Finalidade = (typeof FINALIDADES)[number];
export type ParteDeTexto = string | { readonly link: 'termos' | 'privacidade'; readonly texto: string };
export const TEXTOS_CONSENTIMENTO: Record<Finalidade, readonly ParteDeTexto[]>;
```

`link` é resolvido para `ROTAS.termos`/`ROTAS.privacidade` pelo componente (config não importa `navegacao`). `src/config/termos-documentos.ts` exporta `DOCUMENTOS: { termos: Documento; privacidade: Documento }` com `Documento = { titulo: string; secoes: { id: string; titulo: string; paragrafos: readonly string[] }[] }`; a seção de avaliações da Privacidade tem `id: 'avaliacoes'` (âncora `#avaliacoes`, CA-6) e cita: nota, comentário, primeiro nome + inicial, só reserva concluída por link individual, retirada ("não compareceu", anonimização da cliente, moderação da plataforma), denúncia por qualquer visitante, gestor não edita nem apaga, pedido de anonimização/remoção. Texto próprio, provisório.

### 3.2 Contratos do domínio (`src/server/consentimento/tipos.ts`, client-safe)

```ts
export type OrigemConsentimento = 'publico' | 'equipe';
export const CAMPOS_CONSENTIMENTO = { mensagensReserva: 'consentimento_mensagens', conviteAvaliacao: 'consentimento_convite' } as const;
export const MENSAGENS_CONSENTIMENTO = { mensagensReserva: 'Para reservar, aceite os Termos, a Política de Privacidade e o recebimento das mensagens da reserva.' } as const;
export type ErrosConsentimento = { mensagensReserva?: string };
export type ValoresConsentimento = { mensagensReserva: boolean; conviteAvaliacao: boolean };   // para reexibir
export type ConsentimentoVisao = { id: string; finalidade: Finalidade; origem: OrigemConsentimento; versaoTermos: string; criadoEm: Date };
export type ResultadoConsentimentoDaReserva =
  | { ok: true; registrados: { id: string; finalidade: Finalidade }[] }
  | { ok: false; erros: ErrosConsentimento };
```

`validacao.ts` (puro): `ehAceite(v: unknown): boolean`; `validarConsentimentoDaReserva(entrada: unknown): { ok: true; finalidades: Finalidade[] } | { ok: false; erros: ErrosConsentimento }` (a finalidade obrigatória primeiro; `convite_avaliacao` só quando aceita; deduplicado); `validarFinalidade(v: unknown): v is Finalidade`; `validarOrigemParaContexto(ctx, origem)` e `validarOrigemParaFinalidade(origem, finalidade)` (lançam `RangeError`).

`formulario.ts` (client-safe): `lerConsentimentoDoFormulario(fd: FormData): { mensagensReserva: unknown; conviteAvaliacao: unknown }` e `valoresDoFormulario(fd): ValoresConsentimento` (para reexibir sem JS).

### 3.3 Repositório (`src/server/repos/consentimento.ts`, DTOs em `repos/tipos.ts`, `Repos.consentimentos`)

```ts
export interface RepoConsentimento {
  /** A-4: FOR KEY SHARE na cliente; NaoEncontrado se de outro salão, inexistente, id não UUID ou anonimizada. Não valida origem × finalidade (CHECK do banco é a última). */
  registrar(ctx: ContextoEscopado, v: { clienteId: string; finalidade: Finalidade; origem: OrigemConsentimento; versaoTermos: string; criadoEm: Date }): Promise<ConsentimentoDTO>;
  /** A-9: null se anonimizada ou sem aceite; NaoEncontrado se a cliente não for do salão. */
  vigente(ctx: ContextoEscopado, clienteId: string, finalidade: Finalidade): Promise<ConsentimentoDTO | null>;
}
```

`exigirEscopo(ctx)` em todo método; `salao_id` nunca vem da entrada; `ehUuid` antes de tocar o banco. Cabeçalho de `repos/consentimento.ts` repete a ordem canônica (a ordem em `repos/servico.ts` ganha **uma linha** `→ cliente → consentimento` na posição certa; ver T-3 para a posse do arquivo).

### 3.4 Serviço e leitura (`src/server/consentimento/{servico,leitura}.ts`, sem `next/*`, sem `'use server'`)

```ts
export function registrarConsentimento(
  ctx: ContextoEscopado,
  e: { clienteId: string; finalidade: Finalidade; origem: OrigemConsentimento; agora: Date },
  r?: Repos,                                   // sem r: abre emTransacao (uma linha, atômica)
  deps?: { versaoVigente?: () => string },     // só testes (A-7)
): Promise<ConsentimentoVisao>;

// leitura.ts (leitura sem verificação de papel, como lerBloqueios; uso interno de E3.4/E3.5/E7.1)
export function consentimentoVigente(ctx: ContextoEscopado, clienteId: string, finalidade: Finalidade, r?: Repos): Promise<ConsentimentoVisao | null>;
export function temConsentimentoDeMensagens(ctx: ContextoEscopado, clienteId: string, r?: Repos): Promise<boolean>;  // vigente(mensagens_reserva) !== null, qualquer origem
```

Validações de `registrarConsentimento`, nesta ordem, antes de tocar o banco: `exigirEscopo`, `validarFinalidade`, `validarOrigemParaContexto`, `validarOrigemParaFinalidade`, `agora` válida; depois `r.consentimentos.registrar`. Log estruturado só com ids (nenhum dado pessoal).

### 3.5 Contrato para a E3.2/E3.4/E4.2 (a ser chamado **dentro** da transação da reserva)

```ts
export function registrarConsentimentoDaReserva(
  ctx: ContextoEscopado,
  e: { clienteId: string; aceites: unknown; origem: OrigemConsentimento; agora: Date },
  r?: Repos,
): Promise<ResultadoConsentimentoDaReserva>;
```

- `aceites` é a saída bruta de `lerConsentimentoDoFormulario` (ou o objeto da API); **validado primeiro** (`validarConsentimentoDaReserva`): inválido ⇒ `{ ok:false, erros }` sem consultar o banco, sem lançar e sem linha (CA-1). O chamador, ao receber `ok:false`, **não cria a reserva** e devolve o erro de campo (a validação deve ocorrer também antes de abrir a transação, para não segurar travas à toa; esta função repete a verificação por defesa).
- `origem = 'publico'` ⇒ grava `mensagens_reserva` e, se `conviteAvaliacao` aceito, `convite_avaliacao` (duas linhas, mesmo `agora`). `origem = 'equipe'` ⇒ lê **só** `mensagensReserva` (o convite é ignorado por construção, A-3) e grava só `mensagens_reserva`.
- Sem `r`: envolve em `emTransacao` (todas as linhas ou nenhuma). Com `r`: usa o executor do chamador; falha posterior do chamador (inclusive `23P01`) desfaz o consentimento (CA-12).
- Quem chama precisa já ter o `clienteId` (retorno de `upsertCliente`). Ordem na transação: `salao` (se usado) → profissional(is) → serviço(s) → `upsertCliente` → `registrarConsentimentoDaReserva` → `reserva`/`reserva_item`.

### 3.6 Componente (`src/components/consentimento/CaixasConsentimento.tsx`)

```ts
type Props = { erros?: ErrosConsentimento; valores?: Partial<ValoresConsentimento>; idPrefixo?: string };
```

Duas `Checkbox` na ordem da RN-18: obrigatória (`name={CAMPOS_CONSENTIMENTO.mensagensReserva}`, `obrigatorio`, `erro={erros?.mensagensReserva}`, `defaultChecked={valores?.mensagensReserva}`) e opcional desmarcada (`conviteAvaliacao`, `defaultChecked` só se `valores` o trouxer). Rótulos montados de `TEXTOS_CONSENTIMENTO`; partes `{link}` viram `<a href={ROTAS[...]} target="_blank" rel="noopener">texto<span className="so-leitor"> (abre em nova aba)</span></a>`. Sem `useState`; funciona sem JavaScript (o `required` nativo é conveniência). Sem cores literais (tokens de `globals.css`).

### 3.7 Páginas e vitrine

- `src/app/(publico)/termos/page.tsx`, `src/app/(publico)/privacidade/page.tsx`: `metadata.title`, `PublicLayout`, componente compartilhado `src/app/(publico)/_documento/Documento.tsx` (`h1`, "Versão {VERSAO_TERMOS}", aviso provisório destacado com `Alert`, "Vigência {formatarData(VIGENCIA_TERMOS)}", índice por âncoras, seções com `id`). Data de vigência formatada por `src/lib/format.ts` (única fonte; se faltar formatador para data civil sem fuso, o desenvolvedor acrescenta `formatarDataCivil` lá e testa com `TZ=UTC` e `America/Sao_Paulo`).
- `src/app/dev/consentimento/{page.tsx,acoes.ts,demonstracao.ts}` (404 sem `VITRINE_COMPONENTES=true`/`next dev`, padrão `/dev/clientes`): formulário `method=post` com `CaixasConsentimento` e botão; a ação `'use server'` só lê o `FormData` (`lerConsentimentoDoFormulario`), valida (`validarConsentimentoDaReserva`) e devolve estado (erros + valores, sem PRG, `useActionState` e resposta sem JS); sucesso mostra as finalidades que seriam gravadas. **Sem banco e sem repositório.** `src/config/navegacao.ts`: `devConsentimento: '/dev/consentimento'`.

## 4. Dados: DBA obrigatório

Migração `prisma/migrations/20261121100000_consentimento_finalidade/migration.sql` (nome final do DBA; mais recente atual: `20261121000000_salao_foto`), SQL revisado:

1. `CREATE TYPE "finalidade_consentimento" AS ENUM ('mensagens_reserva','convite_avaliacao','publicacao_avaliacao');`
2. `ALTER TABLE "consentimento" ADD COLUMN "finalidade" "finalidade_consentimento" NOT NULL DEFAULT 'mensagens_reserva';` (tipo novo na mesma transação é permitido) e em seguida `ALTER TABLE … ALTER COLUMN "finalidade" DROP DEFAULT;`.
3. `CHECK consentimento_origem_finalidade_chk (finalidade = 'mensagens_reserva' OR origem = 'publico')`; `CHECK consentimento_versao_termos_chk (versao_termos ~ '^[a-z0-9._-]{1,40}$')` (garante o "não vazia" e o formato da D-5; confirmar com o DBA se as linhas pré-existentes cumprem; não há linhas em produção, e se houver `NOT VALID` + `VALIDATE` separado).
4. Índice `consentimento_vigente_idx` em `("salao_id","cliente_id","finalidade","criado_em" DESC,"id" DESC)`; remover `consentimento_salao_id_cliente_id_idx` (redundante com o prefixo; decisão do DBA: manter se a medição mostrar necessidade para a FK).
5. `prisma/schema.prisma`: `enum FinalidadeConsentimento { … @@map("finalidade_consentimento") }`, `finalidade FinalidadeConsentimento` **sem `@default`**, `@@index([salaoId, clienteId, finalidade, criadoEm(sort: Desc), id(sort: Desc)], map: "consentimento_vigente_idx")` no lugar do índice antigo; `npm run db:generate`.

**O que o DBA decide e registra em `dba.md`:** (a) manter ou remover o índice antigo; (b) o `CHECK` de `versao_termos` (regex da D-5 ou só `btrim <> ''`/tamanho); (c) gatilho de imutabilidade (A-14/D-9): recomendar ou não, e custo para o harness; (d) `ADD COLUMN` com `DEFAULT` + `DROP DEFAULT` (sem reescrita da tabela no PostgreSQL 17) e ordem das instruções; (e) `consentimento_vigente_idx` cobre `FOR KEY SHARE` da FK (índice de suporte da FK composta; a referência é `cliente`, o índice relevante é o do referenciado, já existente); (f) revisão do template de teste e do `drift.test.ts`; (g) se `reserva_id` anulável (R-5) vale já agora ou depois.

Impactos em testes sob posse do DBA: `tests/integration/db/isolamento-salao.test.ts:168-175` passa a informar `finalidade` (`'mensagens_reserva'`) no `INSERT` e continua esperando `23503`; `tests/integration/db/drift.test.ts` ganha o enum `finalidade_consentimento`, o índice novo e as duas constraints (`consentimento_origem_finalidade_chk`, `consentimento_versao_termos_chk`). CA-16 (SQL direto) mora em `tests/integration/consentimento/banco.test.ts` (T-5).

## 5. Infraestrutura: DevOps dispensado

Sem variável de ambiente, container, workflow, dependência ou observabilidade nova. Os E2E entram no job `e2e` existente (as páginas são estáticas; a vitrine liga pelo `VITRINE_COMPONENTES=true` do `webServer`).

## 6. Verificação das invariantes

| Invariante | Aplica? | Como |
|---|---|---|
| Escopo por salão no servidor | Sim | `exigirEscopo` em todo método; `salao_id` do contexto em todo `SELECT`/`INSERT`; FK composta; cliente de outro salão ⇒ `NaoEncontrado` (CA-10); consulta de S2 não enxerga linhas de S1 mesmo com o mesmo telefone. |
| Exclusion anti-sobreposição | Indireta | Não grava reserva. Roda na transação da reserva: `23P01` desfaz o consentimento (CA-12). |
| UTC + fuso | Sim | `criado_em` `timestamptz` informado como `agora` (UTC). Nenhuma exibição de data do aceite; a vigência é data civil sem fuso, testada com `TZ=UTC`/`America/Sao_Paulo`. |
| Adaptadores de integração | Não | Nenhuma integração; sem WhatsApp aqui (só a consulta de consentimento para E3.4/E7.1). |
| Soft delete / anonimização | Sim | Anonimizada não recebe aceite e a vigente é `null` (RN-12); linhas antigas permanecem; a FK `RESTRICT` impede apagar cliente/salão com consentimento. |
| Salão suspenso somente leitura | Sim, por omissão | O serviço não consulta a assinatura (registro da equipe e `publicacao_avaliacao` valem com salão suspenso); o bloqueio da reserva pública é da E6.4. Sem ação própria, nada a classificar em `capacidade`. |
| Idempotência de webhooks/mensagens | Não | Sem webhook nem fila. Duas chamadas = duas linhas (RN-4, por desenho). |
| Auditoria do super admin | Não | Super admin sem acesso (contexto `admin` rejeitado por `exigirEscopo`). |
| Dados pessoais | Sim | Nenhum nome/telefone em log nem em erro; `NaoEncontrado` uniforme. |
| Fora da v1 | Conferido | Sem promoções, lembretes, conta de cliente nem revogação. |

## 7. Riscos e decisões

| ID | Risco | Mitigação |
|---|---|---|
| R-1 | Corrida registro × anonimização (E5.2) | A-4 (`FOR KEY SHARE` + `INSERT` na mesma transação); E5.2 deve tomar `FOR UPDATE` da cliente (obrigação D-022 §11, reafirmada). Teste CA-11 e teste de concorrência com `pg_stat_activity` mostrando a espera. |
| R-2 | Impasse da E3.2 se ela travar `salao` depois da cliente | Obrigação §10: salão primeiro; cabeçalho de `repos/consentimento.ts` e de `repos/servico.ts` (linha acrescentada na T-3). |
| R-3 | Crescimento linear (uma linha por reserva e finalidade) | Aceito (D-4); índice cobre a consulta; reavaliar com volume real. |
| R-4 | Chamador passa `origem` incoerente com o contexto | `RangeError` imediato (A-5) e testado (CA-9); o CHECK barra a combinação finalidade × origem no banco. |
| R-5 | Falta de `reserva_id` impede provar "aceito nesta reserva" | Registrado; migração aditiva anulável possível na E3.2. Não bloqueia a v1. |
| R-6 | Texto jurídico provisório (D-11) | Aviso destacado nas páginas, versão `-provisorio` e pendência de revisão jurídica antes de produção; a troca por texto definitivo exige nova versão (guarda por hash). |
| R-7 | `target="_blank"` em link dentro de `label` | `rel="noopener"` e aviso "abre em nova aba" para leitor de tela; teste de teclado (CA-18). |
| R-8 | Hash do guarda quebra por reformatação sem mudança de texto | Hash calculado sobre JSON canônico dos dados, não sobre o arquivo; mensagem de falha instrui o procedimento (nova versão + nova entrada). |
| R-9 | Páginas viram dinâmicas por engano | `dynamic = 'force-static'` e CA-21 (saída do `next build`). |

## 8. Estratégia de testes

- **Unidade:** `validacao.test.ts` (tabela de CA-1: ausente, `false`, `'false'`, `''`, `0`, `1`, `'yes'`, `null`, array, objeto, entrada inteira `undefined`/texto/número, `{__proto__:…}`, `constructor`); `formulario.test.ts`; `servico.test.ts` das guardas que não tocam o banco (origem × contexto, origem × finalidade, `agora` inválida; CA-9); `termos.test.ts` (versão, regex, hash, CA-17, CA-4 com versão trocada por `vi.doMock` e re-render, grep estático de literal da versão fora do config via `import.meta.glob`); `*.test.tsx` das páginas (jsdom: `h1`, versão, aviso, âncora `#avaliacoes`, termos de CA-6) e do componente (ordem, convite desmarcado, links em nova aba, erro associado, estado preservado); `navegacao.test.ts` e `slug.test.ts` (CA-20 nominal); teste estático de CA-21 (sem `'use server'` em `src/server/consentimento/`).
- **Integração (PostgreSQL real, `tests/integration/consentimento/`):** `registro.test.ts` (CA-1 contagem inalterada, CA-2, CA-5, CA-7, CA-8, CA-9 integrado), `isolamento.test.ts` (CA-10 com `criarDoisSaloes`, mesmo telefone), `anonimizada.test.ts` (CA-11), `transacao.test.ts` (CA-12 com rollback forçado e `23P01` forçado), `versao.test.ts` (CA-13), `vigente.test.ts` (CA-14 incl. empate de `criado_em`), `banco.test.ts` (CA-16: enum, origem × finalidade, versão, backfill verificado por SQL na migração, `22P02`/`23514`), `concorrencia.test.ts` (CA-15: 10 paralelos, junto com `upsert` e edição de telefone, e caso determinístico por `pg_stat_activity`).
- **E2E (Playwright, 375×812, sem banco):** `e2e/termos-privacidade.spec.ts` (CA-3, CA-6, CA-18: 200 pelo rodapé, âncora por link e teclado, axe 4.14.0, sem rolagem horizontal), `e2e/consentimento.spec.ts` (CA-5, CA-18: teclado, foco, erro anunciado, axe), `e2e/consentimento-sem-js.spec.ts` (CA-19).
- **Cobertura:** todo arquivo novo de `src/**` tem teste; unidade + integração mantêm ≥ 90% no `npm run test:coverage`.

## 9. Tarefas

| Tarefa | Responsável | Dependências | Paralela com |
|---|---|---|---|
| T-1 migração, schema, drift | dba | — | T-2 |
| T-2 config, documentos e páginas | desenvolvedor | — | T-1 |
| T-3 domínio, repositório, serviço, leitura e fábrica | desenvolvedor | T-1, T-2 | — |
| T-4 componente, vitrine e rotas | desenvolvedor | T-3 | T-5 |
| T-5 testes de integração | desenvolvedor | T-3 | T-4 |
| T-6 E2E | desenvolvedor | T-2, T-4 | — |
| T-7 documentação e fechamento | desenvolvedor | T-5, T-6 | — |

### T-1 — Migração, schema e drift (DBA)
- **Arquivos:** `prisma/migrations/<timestamp>_consentimento_finalidade/migration.sql`, `prisma/schema.prisma`, `tests/integration/db/drift.test.ts`, `tests/integration/db/isolamento-salao.test.ts`, `docs/demandas/D-023/dba.md`.
- **Entregável:** §4 (itens 1-5) e as decisões (a)-(g) em `dba.md`.
- **Conclusão:** `npm run db:generate`, `npm run typecheck`; `npx vitest run --project integration tests/integration/db` verde (drift e isolamento); `migrate deploy` num banco limpo e no template do harness sem ajuste; backfill comprovado com uma linha pré-existente simulada.

### T-2 — Config, documentos e páginas
- **Arquivos:** `src/config/termos.ts`, `src/config/termos-documentos.ts`, `src/config/termos.test.ts`, `src/app/(publico)/termos/**`, `src/app/(publico)/privacidade/**`, `src/app/(publico)/_documento/**` (componente, CSS e teste), `src/lib/format.ts` (+ `format.test.ts`) só se faltar formatador de data civil, `src/lib/slug.test.ts` e `src/config/navegacao.test.ts` (asserção nominal de CA-20).
- **Entregável:** §3.1 e §3.7 (páginas).
- **Conclusão:** `npm run test:unit` (CA-3, CA-4, CA-6, CA-17, CA-20); `npm run build` com `/termos` e `/privacidade` marcadas `○` (CA-21); lint e typecheck; `TZ=UTC` e `TZ=America/Sao_Paulo` iguais.

### T-3 — Domínio, repositório, serviço, leitura e fábrica
- **Arquivos:** `src/server/consentimento/{tipos,validacao,formulario,servico,leitura}.ts` (+ testes unitários), `src/server/repos/consentimento.ts`, `src/server/repos/tipos.ts` (acrescentar `ConsentimentoDTO`), `src/server/repos/index.ts` e `index.test.ts` (`Repos.consentimentos`, contratos de escopo), `src/server/repos/servico.ts` (**apenas** acrescentar `→ cliente → consentimento` ao cabeçalho de ordem de travas), `tests/support/factories.ts` (`criarConsentimento(salaoId, clienteId, sobrescritas)`).
- **Entregável:** §3.2 a §3.5.
- **Conclusão:** typecheck e lint verdes (inclui a regra "repositório só em `src/server/repos`"); `npm run test:unit` verde; `src/server/consentimento/**` sem `next/*` nem `'use server'`; o teste `index.test.ts` exige `exigirEscopo` nos métodos novos.

### T-4 — Componente, vitrine e rotas
- **Arquivos:** `src/components/consentimento/**` (`CaixasConsentimento.tsx`, CSS, `*.test.tsx` com `@vitest-environment jsdom`), `src/app/dev/consentimento/**` (+ testes), `src/config/navegacao.ts` e `navegacao.test.ts` (`devConsentimento`).
- **Entregável:** §3.6 e §3.7 (vitrine).
- **Conclusão:** build, lint, typecheck e unidade verdes; a vitrine retorna 404 sem `VITRINE_COMPONENTES=true`; `acoes.ts` não importa repositório; `conformidade.test.ts` (cores só por tokens) e `format.fonte-unica.test.ts` verdes.

### T-5 — Testes de integração
- **Arquivos:** `tests/integration/consentimento/**`.
- **Entregável:** §8 (integração).
- **Conclusão:** CA-1, CA-2, CA-5 (linhas), CA-7..CA-16 verdes; `for i in $(seq 10); do npx vitest run --project integration tests/integration/consentimento/concorrencia.test.ts || break; done` verde; `TZ` iguais.

### T-6 — E2E
- **Arquivos:** `e2e/termos-privacidade.spec.ts`, `e2e/consentimento.spec.ts`, `e2e/consentimento-sem-js.spec.ts`.
- **Conclusão:** CA-3, CA-6, CA-18, CA-19 verdes (com build prévio e porta 3000 livre); axe sem violações.

### T-7 — Documentação e fechamento
- **Arquivos:** `README.md` (páginas, onde mudar `VERSAO_TERMOS` e o hash do guarda, aviso de texto provisório), `CLAUDE.md` (parágrafo D-023 e comandos de E2E, estabilidade e fuso, §8 da spec), `docs/demandas/D-023/dev.md`.
- **Conclusão:** `npm run test:coverage` ≥ 90%; todos os gates da definição de pronto.

### Mapa CA → tarefa → teste

| CA | Tarefa | Tipo |
|---|---|---|
| CA-1 | T-3, T-5 | unidade (tabela) + integração (contagem) |
| CA-2 | T-5 | integração |
| CA-3 | T-2, T-6 | unidade (jsdom) + E2E |
| CA-4 | T-2 | unidade + estático |
| CA-5 | T-3, T-4, T-5, T-6 | unidade (componente, `FormData`) + integração (linhas) + E2E |
| CA-6 | T-2, T-6 | unidade (termos) + E2E |
| CA-7 | T-5 | integração |
| CA-8 | T-5 | integração |
| CA-9 | T-3, T-5 | unidade + integração |
| CA-10 | T-5 | integração (duas fábricas) |
| CA-11 | T-5 | integração |
| CA-12 | T-5 | integração |
| CA-13 | T-5 | integração |
| CA-14 | T-5 | integração |
| CA-15 | T-5 | integração (×10) |
| CA-16 | T-1, T-5 | drift + integração (SQL direto) |
| CA-17 | T-2 | unidade |
| CA-18 | T-4, T-6 | unidade + E2E (axe) |
| CA-19 | T-4, T-6 | E2E sem JS |
| CA-20 | T-2 | unidade |
| CA-21 | T-2, T-3, T-4 | unidade estática + lint + build |

Paralelismo: T-1 ∥ T-2 (sem arquivos em comum); T-4 ∥ T-5 (sem arquivos em comum). `src/config/navegacao.ts` e seu teste pertencem só a T-4 (T-2 toca `navegacao.test.ts` apenas **antes**, e T-4 só depois de T-3; sequenciais, sem sobreposição na mesma rodada).

## 10. Transferências e obrigações

- **DBA (T-1):** acionar com o §4. **DevOps:** dispensado (§5).
- **E3.2/E3.4/E4.2:** validar `aceites` antes de abrir a transação; dentro dela, `upsertCliente` → `registrarConsentimentoDaReserva(ctx, { clienteId, aceites, origem, agora }, r)` → reserva; `ok:false` vira erro de campo, nunca 500; salão travado primeiro quando necessário; E3.4 usa origem `equipe` com `ctx` de equipe, sem caixa de convite.
- **E3.4/E7.1:** `temConsentimentoDeMensagens(ctx, clienteId, r)` decide `nao_enviada` (RN-8).
- **E3.5/E4.5:** `consentimentoVigente(ctx, clienteId, 'convite_avaliacao', r)` dentro da transação da conclusão; E4.5 grava `publicacao_avaliacao` com `registrarConsentimento` (origem `publico`, `contextoDeSistema`).
- **E4.1:** monta o formulário com `CaixasConsentimento` e `lerConsentimentoDoFormulario`.
- **E5.2:** a anonimização toma `salao` (`FOR NO KEY UPDATE`) e `cliente FOR UPDATE`, não apaga `consentimento`.
- **E6.4:** bloqueia a reserva pública do salão suspenso; este módulo não verifica assinatura.
