# D-021 — Desenho: fotos do salão com armazenamento por adaptador (issue #76, E2.7)

Entrada: `docs/demandas/D-021/spec.md` (21 RNs, CA-1..CA-18, D-1..D-15, sem dúvida bloqueante). Base: branch `feat/d-021-fotos` (de `main` 791d0a2, que já tem a D-020). DBA e DevOps: **obrigatórios** (§4 e §5).

## 0. Verificações feitas antes do desenho

- `sharp` 0.35.5 já está no lock como dependência **opcional** do Next (`package-lock.json:9055`, `"optional": true`). Não tem script de instalação: o binário vem de pacotes opcionais `@img/sharp-*` (por plataforma), então **não entra em `allowScripts`**. Vira dependência direta com a mesma versão exata (publicada em 2026-09-27, mais de 8 semanas).
- `@aws-sdk/client-s3`: a última é 3.1175.0 (2026-11-21), nova demais. A regra de "mais de duas semanas" (hoje, 2026-11-20) aponta para **3.1163.0** (2026-11-05, 15 dias). O DevOps confirma com `npm view` na hora da instalação e, se a 3.1163.0 tiver problema, desce para a anterior; nunca sobe.
- `defineAcao` (`src/server/tenant/define-acao.ts`): a forma chamável lê o cookie (`next/headers`), serve também em route handler; `executar(credencial, input, deps)` é o núcleo sem Next. O handler recebe o `input` sem transformação.
- O proxy só intercepta `/painel` e `/painel/:path*` com 307 (`src/proxy.ts:34`). Uma rota fora desse matcher não sofre o 307 nem o `proxyClientMaxBodySize`.
- Route handlers do App Router não têm o limite de 1 MB das Server Actions (`serverActions.bodySizeLimit`), e esse limite **não** é alterado aqui (continua valendo para as demais ações).
- `Repos` (`src/server/repos/index.ts`) liga todos os repositórios a um executor; `emTransacao` abre uma transação READ COMMITTED. `RepoSalao.travar` já faz `SELECT fuso FROM salao … FOR NO KEY UPDATE`.
- O lint tem um bloco por pasta (cada arquivo casa com **um** bloco de `no-restricted-imports`): a pasta nova do `sharp` precisa de bloco próprio (§5.3).
- Não há `docs/adr/`. A decisão transversal (primeira mutação por route handler, com checagem de `Origin`) fica registrada aqui (A-3) e no `CLAUDE.md` pelo líder; não crio ADR.

## 1. Resumo da solução

Cinco peças, cada uma testável sozinha:

1. **Porta `PortaArmazenamento`** (`src/server/integrations/armazenamento/`) com adaptador simulado (disco) e real (`@aws-sdk/client-s3`), escolhido por `STORAGE_ADAPTER` e obtido só por `integracoes().armazenamento` (padrão D-007).
2. **Módulo de imagem** (`src/server/imagem/`, único dono do `sharp`): detecta o tipo pelos bytes e reprocessa para WebP ≤ 1600 px sem metadados.
3. **Módulo `src/server/fotos/`**: contratos e validação client-safe, leitura limitada do multipart, serviço (envio, texto alternativo, ordem, remoção), leituras e as ações (`fotos.acao.ts`, quatro `defineAcao`).
4. **Persistência**: tabela `salao_foto` e `RepoFoto` (tenant) + leitura global por id para a rota pública (`foto-publica.ts`, pré-contexto). Toda mudança de lista (limite, ordem, remoção) acontece sob `salao … FOR NO KEY UPDATE`.
5. **Rotas e telas**: `POST /api/painel/fotos` (envio multipart, 303 sempre, fora do matcher do proxy), `GET /api/fotos/[id]` (entrega pública), `/painel/configuracoes/fotos` e a vitrine `/dev/fotos`.

Fluxo do envio (D-2, confirmado): origem → sessão/papel/capacidade (`defineAcao`) → leitura limitada do corpo → validações e processamento em memória → pré-checagem do limite e do token → **gravar objeto** → transação (trava do salão → token → limite → insert) → recusa/duplicata compensa removendo o objeto.

### 1.1 Alternativas descartadas

| Alternativa | Motivo do descarte |
|---|---|
| Server Action com `FormData` | O limite de 1 MB é da app inteira; subir `bodySizeLimit` para 5 MB afrouxaria todas as ações. A checagem de `Origin` e o 303 ficam explícitos no route handler. |
| URL pré-assinada (browser → S3) | Não existe no modo simulado e impede remover EXIF/GPS e validar a imagem antes de gravar (RN-7 exige reprocessar no servidor). |
| Guardar os bytes em `bytea` no PostgreSQL | Contraria o requisito de armazenamento por adaptador (disco/S3) e engorda backups. |
| Remoção do objeto por job do pg-boss (D-9) | A issue só pede "depois do commit, falha não desfaz". Síncrono e de melhor esforço, com log `armazenamento.orfao`, cobre isso sem job novo. Varredura de órfãos exigiria listar o bucket (RN-13 proíbe). |
| `next/image` nas miniaturas | Exigiria `images.remotePatterns` quando houver `S3_URL_PUBLICA` e otimização que não queremos (a imagem já sai ≤ 1600 px WebP). Usa-se `<img>` com `width`/`height` gravados. |
| Arrastar e soltar | Exige JS e alternativa por teclado de qualquer forma (D-7). |
| Envio por `fetch` com resposta JSON | Dobraria a superfície (códigos HTTP × códigos de PRG) sem requisito. Fica só o formulário nativo (A-3). |
| URL pública sempre do bucket | Obriga bucket público e não permite remoção imediata (a rota da app responde 404 pela linha). |

### 1.2 Dependências novas (justificativa)

- `sharp` 0.35.5 (exata): único decodificador/reprocessador robusto para JPEG/PNG/WebP com EXIF/ICC/orientação em Node; já presente no lock (opcional do Next).
- `@aws-sdk/client-s3` 3.1163.0 (exata): cliente oficial compatível com S3/R2/MinIO; só `PutObject`, `GetObject`, `DeleteObject`. Nenhuma outra (multipart parser próprio não é necessário: `Response#formData()` do Node/undici lê o corpo já limitado em memória).

## 2. Decisões

| ID | Decisão |
|---|---|
| A-1 | **D-1 confirmada.** `GET /api/fotos/[id]` é a URL padrão. Com `STORAGE_ADAPTER=real` e `S3_URL_PUBLICA`, a leitura pública devolve `S3_URL_PUBLICA + '/' + chave`. A rota nunca recebe chave. |
| A-2 | **D-2 confirmada.** Objeto gravado antes da transação; a trava nunca é mantida durante a E/S. Compensação em recusa, duplicata e falha da transação. |
| A-3 | **D-11 ajustada.** (a) Rota `POST /api/painel/fotos` (fora do matcher do proxy); (b) `Origin` ausente, `null` ou diferente da origem de `APP_URL` → **403 sem ler o corpo** (único caso fora do 303: é requisição forjada, não navegação do gestor); (c) todos os demais desfechos → **303** para `/painel/configuracoes/fotos?envio=<código>`; sem sessão, 303 para `/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Ffotos`; (d) **sem melhoria por `fetch`** nesta demanda: o formulário nativo é o único caminho (D-11 permitia opcional). Leitura do CA-4: "o envio responde 403 (sem JS: 303 negado)" fica **303 `envio=negado`** para o profissional; o 403 puro é só para `Origin` inválido. |
| A-4 | **Uma só barreira de autorização.** O handler HTTP chama `enviarFoto` (um `defineAcao` com `papeis: ['gestor']`, `capacidade: 'configurar'`). Como o corpo só pode ser lido **depois** de a sessão passar, o `input` da ação é uma **função de leitura adiada** (`obterCorpo`): o handler da ação a chama só depois de sessão, papel e capacidade. Nada de política duplicada. |
| A-5 | **D-3 confirmada.** Arquivo ≤ 5.242.880 bytes; corpo ≤ arquivo + 64 KiB de folga (`LIMITE_CORPO_BYTES`). |
| A-6 | **D-4 confirmada**, com `failOn: 'truncated'` (JPEG truncado falha; avisos benignos de câmeras não), qualidade WebP 82 em constante única, `limitInputPixels: 50_000_000`, `.rotate()` sem argumentos, `.toColourspace('srgb')`, sem `withMetadata` (descarta EXIF/XMP/IPTC/ICC), primeiro quadro (padrão do `sharp`), `fit: 'inside'` com `withoutEnlargement`. O desenvolvedor prova a conversão de cor com um teste Display-P3 e CMYK; se `failOn: 'truncated'` não reprovar o JPEG truncado do CA-2, sobe para `'error'` e depois `'warning'`, nessa ordem. |
| A-7 | **Concorrência do processamento.** Um semáforo em processo (máx. 2 decodificações simultâneas) em `imagem/processar.ts` e `sharp.cache(false)`: 50 MP decodificados ocupam centenas de MB. Excedentes esperam (sem fila persistente). |
| A-8 | **D-5, D-6, D-7, D-10, D-12, D-14 confirmadas** sem alteração. |
| A-9 | **D-8 confirmada.** `sharp` só em `src/server/imagem/**`; `@aws-sdk/*` só em `src/server/integrations/**`. Bloco de lint novo (§5.3). |
| A-10 | **D-9 confirmada**: sem fila; remoção pós-commit síncrona, melhor esforço. |
| A-11 | **D-13 ajustada.** `S3_ENDPOINT` obrigatório no real; novo `S3_FORCE_PATH_STYLE` (`true`/`false`, opcional, **padrão `true`**, compatível com MinIO e R2). A AWS aceita `false`. O cliente usa `requestChecksumCalculation: 'WHEN_REQUIRED'` e `responseChecksumValidation: 'WHEN_REQUIRED'` (os valores padrão do SDK recente enviam checksums que alguns S3-compatíveis recusam). |
| A-12 | **D-15 ajustada.** A página do gestor **não** consulta o armazenamento (custaria até 12 leituras por render). Um objeto ausente aparece como imagem quebrada (o `alt` fica visível) e o botão "Remover" continua disponível; a rota pública responde 404 e loga `armazenamento.objeto_ausente`. |
| A-13 | **Leitura pública em duas camadas.** O repositório (`repos/publico.ts`) devolve linhas com `chave` (tipo interno); o serviço `src/server/fotos/leitura.ts` monta o DTO `{ id, url, alt, largura, altura }` (única parte que conhece a porta e `ROTAS`). A E4.1 importa o serviço, não o repositório. Ajusta a RN-15, que citava só `repos/publico.ts`: o repositório não pode conhecer o armazenamento. |
| A-14 | **Idempotência sob a trava, sem capturar 23505** (convenção D-017): na transação, "token já existe?" → `ok`; "contagem ≥ 12?" → `limite`; só então insere. O `UNIQUE (salao_id, envio)` é a rede de segurança. A posição nova é `contagem + 1`. |
| A-15 | **Salão não é "tocado".** Fotos não alteram `salao.atualizado_em` (a trava é só de serialização). Recusas não escrevem nada, nem em `salao`. |
| A-16 | **Entrega sem `fs` público.** `ARMAZENAMENTO_DIR` fica fora de `public/`; a rota lê pela porta e devolve bytes (≤ ~1 MB). `ETag` forte `"<fotoId>"`; `If-None-Match` com lista, `*` e prefixo `W/` tratados. |

## 3. Componentes e interfaces

### 3.1 Porta e adaptadores (`src/server/integrations/armazenamento/`)

```ts
// port.ts — sem provedor, Prisma nem process.env
export type TipoObjeto = 'image/webp';
export interface PortaArmazenamento {
  gravar(chave: string, bytes: Uint8Array, tipo: TipoObjeto): Promise<void>;
  /** null = objeto inexistente (NoSuchKey / ENOENT). Outras falhas lançam. */
  ler(chave: string): Promise<Uint8Array | null>;
  /** Remover o que não existe não é erro. */
  remover(chave: string): Promise<void>;
  /** URL pública do bucket/CDN, ou null (usa-se a rota da app). */
  urlPublica(chave: string): string | null;
}
export class ErroDeArmazenamento extends Error {}      // falha tratável pelo serviço (rede, disco, 5xx)
export class ChaveInvalida extends Error {}            // chave fora do formato (bug de chamada)
```
- `chave.ts` (só `node:crypto`): `CHAVE_REGEX = /^fotos\/[A-Za-z0-9_-]{22,}\.webp$/`, `ehChaveValida(c)`, `gerarChave()` = `fotos/` + `randomBytes(16).toString('base64url')` (22 caracteres, 128 bits) + `.webp`. Nome do arquivo, id do salão e dados do usuário nunca entram.
- `ambiente.ts` (**sem imports**; entra no bundle do check-env): `SELETOR = 'STORAGE_ADAPTER'`; `CHAVES = ['ARMAZENAMENTO_DIR','S3_ENDPOINT','S3_REGIAO','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_URL_PUBLICA','S3_FORCE_PATH_STYLE']`; `ConfigS3 = { endpoint, regiao, bucket, accessKeyId, secretAccessKey, urlPublica: string | null, pathStyle: boolean }`; `lerConfigReal(fonte)` exige as cinco primeiras `S3_*` (não vazias), `S3_ENDPOINT` URL `http`/`https`, `S3_URL_PUBLICA` (se presente) `https` ou `http` com host `localhost`/`127.0.0.1`, normalizada sem `/` final, `S3_FORCE_PATH_STYLE` ∈ {`true`,`false`}. Devolve **todas** as variáveis inválidas, ordenadas, sem valores. `DIRETORIO_PADRAO = '.armazenamento'`.
- `simulado.ts`: `criarArmazenamentoSimulado({ diretorio })`. Valida a chave com `ehChaveValida` **antes** de qualquer acesso a disco (`ChaveInvalida`), resolve `join(diretorio, chave)` e confere que continua dentro do diretório (defesa em profundidade). Gravação atômica: arquivo temporário no mesmo diretório (`<chave>.tmp-<aleatório>`, fora do formato, nunca listável pela rota) + `rename`. `ler`: `ENOENT` → `null`. `remover`: `ENOENT` ignorado. `urlPublica` → `null`. Erros de E/S (disco cheio, permissão) viram `ErroDeArmazenamento`.
- `real.ts`: `criarArmazenamentoReal(config, { cliente? })`. `cliente` injetável (`{ send(comando) }`) para os testes; por padrão `new S3Client({ endpoint, region, credentials, forcePathStyle: pathStyle, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' })`. `PutObjectCommand({ Bucket, Key, Body, ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' })` **sem `ACL`**. `GetObjectCommand` com `NoSuchKey`/404 → `null`; corpo por `transformToByteArray()`. `DeleteObjectCommand` (S3 devolve 204 para ausente; 404 também é ignorado). Falha de rede/5xx → `ErroDeArmazenamento` (sem credenciais na mensagem). **Nunca** `ListObjects*`. `urlPublica(chave)` = `urlPublica + '/' + chave` ou `null`.
- `registry.ts`: `Integracoes` ganha `armazenamento: PortaArmazenamento` e `modos.armazenamento`; `selecionarArmazenamento(c: ConfigIntegracao<ConfigS3>, fonte)` (simulado lê `fonte.ARMAZENAMENTO_DIR` com o padrão; ignora `S3_*`). O import continua sem ler ambiente.

### 3.2 Ambiente (`src/server/env.ts`, `check-env.ts`, `.env.example`)

- `esquemaEnv` + `STORAGE_ADAPTER: z.enum(ADAPTADORES).default('simulado')`; `Seletor` ganha `'STORAGE_ADAPTER'`; `Env.integracoes.armazenamento: ConfigIntegracao<ConfigS3>`; `MODULOS.armazenamento`; `lerIntegracao` já cobre; `modosAtivos` ganha `armazenamento` (ordem alfabética: `armazenamento` primeiro, no evento `worker.adaptadores`).
- `check-env`: linha de modos com `armazenamento=<modo>`.
- `.env.example`: bloco "Armazenamento de fotos" com `STORAGE_ADAPTER=simulado` e as `ARMAZENAMENTO_DIR`/`S3_*` comentadas como "só com real" (o teste `chavesDeclaradas` exige todas as chaves).
- O **worker** valida o mesmo ambiente (todos os modos): `STORAGE_ADAPTER=real` incompleto também derruba o worker; é o comportamento dos outros adaptadores. Registrado como R-6.

### 3.3 Imagem (`src/server/imagem/`)

```ts
// detectar.ts — puro, sem sharp
export type TipoImagem = 'jpeg' | 'png' | 'webp';
export function detectarTipo(bytes: Uint8Array): TipoImagem | null;   // RN-5, só bytes iniciais

// processar.ts — único import de 'sharp'
export const MAIOR_LADO = 1600; export const QUALIDADE_WEBP = 82; export const LIMITE_PIXELS = 50_000_000;
export type ImagemProcessada = { bytes: Uint8Array; largura: number; altura: number };
export type ResultadoProcessamento =
  | { ok: true; imagem: ImagemProcessada }
  | { ok: false; erro: 'ilegivel' | 'resolucao' };
export function processarImagem(bytes: Uint8Array, tipo: TipoImagem): Promise<ResultadoProcessamento>;
```
`resolucao` quando o erro do `sharp` é o de limite de pixels ("exceeds pixel limit"); qualquer outro erro do `sharp` → `ilegivel` (CA-18). Além da checagem do cabeçalho, confere que o formato decodificado (`metadata().format`) é o mesmo do `tipo` detectado (RN-6: "formato real difere do cabeçalho" → `ilegivel`). Saída: `largura`/`altura` vindas do `info` do `toBuffer({ resolveWithObject: true })`.

### 3.4 Módulo de fotos (`src/server/fotos/`)

| Arquivo | Conteúdo |
|---|---|
| `tipos.ts` (client-safe) | `LIMITES_FOTO = { maxFotos: 12, maxBytes: 5_242_880, folgaCorpo: 65_536, maxAlt: 150 }`; `CODIGOS_ENVIO` (lista fechada da RN-17) e `ehCodigoEnvio`; `MENSAGENS_FOTO` (todas as mensagens pt-BR da spec, por código); `FotoDoPainel = { id, posicao, alt, largura, altura }`; `FotoPublica = { id, url, alt, largura, altura }`; resultados abaixo. |
| `validacao.ts` | `validarAlt(texto)` (usa `normalizarNome` de `src/lib/texto.ts`; 1–150 UTF-16; controle recusado), `validarEnvioToken(valor)` (UUID), `validarPosicaoEsperada`. Puro. |
| `multipart.ts` | `lerCorpoEnvio(request): Promise<CorpoLido>`: confere `Content-Type` `multipart/form-data`; `Content-Length` > `maxBytes + folgaCorpo` → `{ erro: 'tamanho' }` **sem ler** (cancela o corpo); sem `Content-Length`, conta enquanto lê pelo `ReadableStream` e aborta ao passar o limite; depois `new Response(bytes, { headers: { 'content-type': ct } }).formData()` (qualquer exceção → `falha`). Mais de um campo `foto` → `falha`; `foto` ausente ou 0 bytes → `sem_arquivo`; `foto.size > maxBytes` → `tamanho`. Devolve `{ ok: true, arquivo: Uint8Array, alt: string, envio: string }` ou `{ ok: false, codigo }`. Sem `next/*`. |
| `servico.ts` | `enviar`, `editarAlt`, `mover`, `remover` (abaixo). Dependências injetáveis: `{ armazenamento = integracoes().armazenamento, processar = processarImagem, log }`. |
| `leitura.ts` | `listarFotosDoPainel(ctx)` (exige `salao.configurar`; `FotoDoPainel[]` por posição) e `lerFotosPublicas(ctx: PublicoContext): Promise<FotoPublica[]>` (A-13; sem papel, não filtra suspensão; `url = armazenamento.urlPublica(chave) ?? ROTAS.fotoPublica(id)`; sem `chave`, `bytes`, `salaoId`, `criadoEm`). |
| `entrega.ts` | `servirFoto(id, request, deps)` → `Response` (RN-14): UUID inválido/inexistente → 404 (corpo vazio); objeto ausente → 404 + log `armazenamento.objeto_ausente`; falha do armazenamento → 502 sem detalhes (log); 200 com `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: public, max-age=3600`, `ETag: "<id>"`, `Content-Length`; 304 com `If-None-Match` casando. Sem sessão, sem filtro de suspensão. |
| `envio-http.ts` | `tratarEnvio(request, { executar, appUrl })` → `Response` (A-3). `executar: (input: EntradaEnvio) => Promise<ResultadoAcao<ResultadoEnvio>>` (em produção `enviarFoto`; nos testes `(i) => enviarFoto.executar(credencial, i, deps)`). Ordem: método/`Origin` (403) → `executar({ obterCorpo: () => lerCorpoEnvio(request) })` → traduz para 303. Sem `next/*` (usa só `Response`). |
| `fotos.acao.ts` | Sem `'use server'`; todo export é `defineAcao({ papeis: ['gestor'], capacidade: 'configurar' }, …)`. |

Contratos do serviço (resultados discriminados dentro de `{ ok: true, dados }`; `ErroDeDominio` continua 401/403/404):

```ts
export type EntradaEnvio = { obterCorpo: () => Promise<CorpoLido> };
export type ResultadoEnvio =
  | { resultado: 'ok'; fotoId: string; duplicado: boolean }
  | { resultado: 'recusado'; codigo: Exclude<CodigoEnvio, 'ok' | 'negado'> };
export const enviarFoto: Acao<EntradaEnvio, ResultadoEnvio>;

export type EntradaAlt = { fotoId: string; alt: string };
export type ResultadoAlt = { resultado: 'salvo' | 'invalido'; erro?: string };    // invalido: mensagem RN-9
export const editarAltDaFoto: Acao<EntradaAlt, ResultadoAlt>;

export type EntradaMover = { fotoId: string; direcao: 'cima' | 'baixo'; posicaoEsperada: number };
export type ResultadoMover = { resultado: 'movida' | 'ordem_mudou' | 'na_ponta' };
export const moverFoto: Acao<EntradaMover, ResultadoMover>;

export type EntradaRemover = { fotoId: string };
export const removerFoto: Acao<EntradaRemover, { resultado: 'removida' }>;  // inexistente/outro salão: NaoEncontrado (404)
```

`enviar` (ordem exata, RN-16/RN-18/A-14):
1. `exigirPermissao(ctx, 'salao.configurar')` (segunda barreira, padrão D-020).
2. `corpo = await obterCorpo()`; erro → `recusado(codigo)` (nada gravado).
3. `validarAlt` → `alt_vazio`/`alt_longo`; `validarEnvioToken` → `falha`. **Antes** de processar a imagem.
4. `detectarTipo` → `tipo`; `processar` → `ilegivel`/`resolucao`.
   (Texto antes do tipo: a spec manda o texto inválido recusar "antes de processar"; tipo/decodificação vêm depois.)
5. `repos().fotos.prechecar(ctx, envio)` (sem trava): token já existe → `ok` duplicado, **sem gravar**; contagem ≥ 12 → `limite`, sem gravar.
6. `chave = gerarChave()`; `armazenamento.gravar(chave, bytes, 'image/webp')`; falha → log + `falha` (sem linha).
7. `emTransacao`: `r.saloes.travar(ctx)` → `r.fotos.inserirNoFim(ctx, { chave, alt, largura, altura, bytes, envio })` que, sob a trava, faz (a) token existente → `{ duplicado }`, (b) `contagem >= 12` → `{ limite }`, (c) `INSERT` na posição `contagem + 1`.
8. `duplicado`/`limite`/qualquer exceção → `armazenamento.remover(chave)` (compensação; falha → log `armazenamento.orfao` com a chave) e devolve `ok` (duplicado) / `limite` / relança.
9. Log `foto.enviada { salaoId, fotoId, bytes, largura, altura }`. Nunca `alt`, nome do arquivo ou bytes (CA-18).

`remover`: `emTransacao { travar → r.fotos.removerCompactando(ctx, fotoId) }` devolve a `chave`; **depois do commit**, `armazenamento.remover(chave)`; falha → log `armazenamento.orfao { chave, motivo }` e sucesso (CA-6). `mover` e `editarAlt` usam `travar` + o repositório (`editarAlt`: `UPDATE … WHERE salao_id AND id AND alt IS DISTINCT FROM $alt`; zero linhas atualizadas e linha existente = no-op; linha inexistente = `NaoEncontrado`).

### 3.5 Repositórios (`src/server/repos/`)

- `foto.ts` — `RepoFoto` (em `Repos.fotos`; todo método começa por `exigirEscopo(ctx)` e filtra `salao_id`):
  - `listar(ctx): Promise<FotoDoPainel[]>` (`ORDER BY posicao`, colunas explícitas, sem `chave`).
  - `prechecar(ctx, envio): Promise<{ contagem: number; tokenExiste: boolean }>` (um comando).
  - `inserirNoFim(ctx, d): Promise<{ resultado: 'criada'; id; posicao } | { resultado: 'duplicado' } | { resultado: 'limite' }>` — **exige estar dentro de transação sob `travar`** (documentado no cabeçalho; mesmo padrão de `jornada.ts`).
  - `editarAlt(ctx, fotoId, alt): Promise<'alterada' | 'igual'>` (`NaoEncontrado` se não existe no salão).
  - `trocarComVizinha(ctx, fotoId, direcao, posicaoEsperada): Promise<'movida' | 'ordem_mudou' | 'na_ponta'>`: `SELECT id, posicao … WHERE salao_id AND id` → posição ≠ esperada → `ordem_mudou`; vizinho = `posicao ± 1`, inexistente → `na_ponta`; troca em **um** `UPDATE … SET posicao = CASE … WHERE salao_id AND id IN (a, b)` (a constraint de posição é adiada, §4).
  - `removerCompactando(ctx, fotoId): Promise<{ chave: string }>`: `DELETE … RETURNING chave, posicao` (`NaoEncontrado` se 0) e `UPDATE salao_foto SET posicao = posicao - 1 WHERE salao_id AND posicao > $p`.
- `foto-publica.ts` — **pré-contexto** (padrão `cadastro.ts`/`token-*`): `buscarChaveDaFoto(id: string): Promise<string | null>`: valida UUID antes de consultar (`SELECT chave FROM salao_foto WHERE id = $1::uuid`). Não filtra suspensão. Não é exposto em `Repos`.
- `publico.ts` + `lerFotosPublicasDoSalao(ctx: PublicoContext): Promise<LinhaFotoPublica[]>` (`select` explícito: `id, chave, alt, largura, altura`; `ORDER BY posicao`; `[]` sem fotos).
- `index.ts`/`tipos.ts`: `Repos.fotos`; `index.test.ts` atualizado. Cabeçalho de `servico.ts` (ordem canônica de travas) passa a citar `salao (FOR NO KEY UPDATE) → salao_foto`.

### 3.6 Rotas, telas e navegação

- `ROTAS` (`src/config/navegacao.ts`): `configuracoesFotos: '/painel/configuracoes/fotos'`, `envioFotos: '/api/painel/fotos'`, `fotoPublica: (id) => '/api/fotos/${seg(id)}'`, `devFotos: '/dev/fotos'`, `devFotosEnvio: '/dev/fotos/enviar'`. `SEGMENTOS_RESERVADOS` **não muda** (`painel`, `api`, `dev` já constam). "Configurações" continua ativo na subpágina (a navegação já usa prefixo; o teste de CA-16 confirma).
- `src/app/api/painel/fotos/route.ts`: `export const dynamic = 'force-dynamic'`, `runtime = 'nodejs'`; `POST` chama `tratarEnvio(request, { executar: enviarFoto, appUrl })` (`appUrl = validarEnv(process.env).APP_URL`, como `confirmacao-email.ts`). Demais métodos: 405.
- `src/app/api/fotos/[id]/route.ts`: `GET` chama `servirFoto((await params).id, request)`. Não há `route.ts` em `/api/fotos` (GET → 404 do Next).
- `src/app/painel/configuracoes/fotos/page.tsx`: `exigirAcessoAoPainel(ROTAS.configuracoesFotos, ['gestor'], 'salao.configurar')`; lê `?envio=` por `ehCodigoEnvio` (valor desconhecido: nada); gera `crypto.randomUUID()` como token por renderização; mostra "N de 12 fotos", o formulário (ou o aviso de limite), a lista e o aviso de privacidade. `acoes.ts` (`'use server'`, só converte `FormData`) para texto alternativo, mover e remover; PRG por `?acao=` com lista fechada (`alt_ok`, `movida`, `ordem_mudou`, `na_ponta`, `removida`, `alt_invalido`) ou estado de ação (padrão D-016: um `useActionState` por ação em ordem fixa).
- Componentes (`FormularioEnvio`, `ListaFotos`, `CartaoFoto`), CSS Module só com tokens, `estado.ts` client-safe. Anúncio por região viva e foco no resultado; `aria-describedby` nos campos; "Mover para cima da foto 3", "Remover a foto 3" etc.; botões das pontas desabilitados com `aria-disabled` e sem escrita.
- `<img>` nas miniaturas: o ESLint `@next/next/no-img-element` (`--max-warnings=0`) é desativado **na linha**, com comentário justificando (A-1, §1.1).
- `/painel/configuracoes/page.tsx`: link "Fotos do salão" com a ajuda da RN-21.
- Vitrine `/dev/fotos` (404 sem `VITRINE_COMPONENTES=true`/`next dev`) com os mesmos componentes e fotos de exemplo (URLs `data:`/arquivo estático pequeno em `public/` apenas na vitrine); `src/app/dev/fotos/enviar/route.ts` valida origem, lê o corpo (`lerCorpoEnvio`), valida e **processa em memória** (`detectarTipo` + `processarImagem`), não grava e responde com o mesmo 303 para `/dev/fotos?envio=<código>`. As ações da vitrine só validam (padrão `/dev/perfil`).

## 4. Dados: **DBA obrigatório**

Migração aditiva `prisma/migrations/<ts>_salao_foto/migration.sql` (parte 1 gerada por `prisma migrate diff`; parte 2 SQL bruto; cabeçalho com impacto e reversão manual, padrão D-007).

**`schema.prisma`** — `model SalaoFoto @@map("salao_foto")`: `id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`; `salaoId @map("salao_id") @db.Uuid`; `chave String @unique`; `alt String`; `posicao Int`; `largura Int`; `altura Int`; `bytes Int`; `envio String @db.Uuid`; `criadoEm DateTime @default(now()) @map("criado_em") @db.Timestamptz(6)`; `salao Salao @relation(fields: [salaoId], references: [id], onDelete: Restrict, onUpdate: Restrict)`; `@@unique([salaoId, envio])`. `Salao` ganha `fotos SalaoFoto[]`. O `@@index([salaoId, posicao])` **não é declarado**: a unicidade de posição (abaixo) já cria esse índice (parecer do DBA).

**SQL bruto (propostas):**
- `salao_foto_posicao_unica UNIQUE (salao_id, posicao) DEFERRABLE INITIALLY DEFERRED`: a troca de vizinhas e a compactação atualizam duas ou mais linhas num só comando e passam por estados intermediários repetidos; a verificação adiada ao commit evita colisão sem estratégia de posição temporária. Prisma não expressa `DEFERRABLE`, então a constraint é só SQL (o drift test a conhece).
- CHECKs de defesa: `salao_foto_posicao_chk (posicao BETWEEN 1 AND 12)`, `salao_foto_dimensoes_chk (largura BETWEEN 1 AND 1600 AND altura BETWEEN 1 AND 1600)`, `salao_foto_bytes_chk (bytes > 0)`, `salao_foto_alt_chk (char_length(alt) BETWEEN 1 AND 150 AND alt = btrim(alt))`, `salao_foto_chave_chk (chave ~ '^fotos/[A-Za-z0-9_-]{22,}\.webp$')`. O limite de 12 **não** é CHECK (contagem entre linhas), é a trava. (`posicao ≤ 12` já impede a 13ª linha mesmo sem a trava, como defesa extra.)
- FK `ON DELETE RESTRICT`/`ON UPDATE RESTRICT` (padrão do esquema).
- Sem trigger. Impacto: tabela nova e vazia; nenhuma trava longa em tabela existente (só `FOR KEY SHARE` na FK de `salao` durante os INSERT, compatível com `FOR NO KEY UPDATE`).
- `tests/integration/db/drift.test.ts` conhece a tabela e as constraints (incluindo `condeferrable`/`condeferred` em `pg_constraint`).

### Transferência para o DBA

```
DEMANDA: D-021 — fotos do salão com armazenamento por adaptador (E2.7, issue #76)
DE: arquiteto-software  PARA: dba
OBJETIVO: produzir e revisar a migração aditiva da tabela salao_foto e os testes de catálogo, com parecer em docs/demandas/D-021/dba.md
CONTEXTO NECESSÁRIO: design.md §3.4 (ordem do envio; limite de 12 sob salao FOR NO KEY UPDATE; token único), §3.5 (RepoFoto: inserirNoFim, trocarComVizinha com um UPDATE ... CASE, removerCompactando com posicao = posicao - 1), §4 (esquema e SQL propostos). Ordem de travas: salao (FOR NO KEY UPDATE) → salao_foto. Escritor único: RepoFoto, sempre sob a trava, exceto a leitura pública por id (SELECT chave).
CRITÉRIOS DE ACEITAÇÃO: CA-3 (12 fotos, posições 1..12), CA-6 (compactação), CA-8 (reordenação), CA-13 (token único por salão), CA-1 (formato da chave)
DECISÕES JÁ TOMADAS: uma linha por foto; chave única e gerada pelo servidor; (salao_id, envio) único; limite de 12 por trava (não CHECK); posições 1..n sem repetição; FK Restrict; nenhuma coluna para nome do arquivo; nada em salao.
ARQUIVOS ENVOLVIDOS (posse do DBA, T-0): prisma/schema.prisma; prisma/migrations/<ts>_salao_foto/migration.sql; tests/integration/db/drift.test.ts; tests/integration/db/salao-foto.test.ts (novo); docs/demandas/D-021/dba.md.
EVIDÊNCIAS: docs/demandas/D-021/design.md; npx prisma migrate diff; npm run db:generate; npx vitest run --project integration tests/integration/db
PENDÊNCIAS:
  1. Unicidade de (salao_id, posicao): DEFERRABLE INITIALLY DEFERRED (proposta) × estratégia sem diferimento. Conferir que a troca (um UPDATE ... CASE) e a compactação (posicao - 1 em N linhas) passam, e que ON CONFLICT em (salao_id, envio) não depende dela (não depende; o desenho não usa ON CONFLICT).
  2. Aprovar, ajustar ou recusar cada CHECK (posição 1..12, dimensões 1..1600, bytes > 0, alt de 1..150 e sem espaços nas pontas, formato da chave). Motivo de cada decisão. Dúvida: bytes com teto de 5.242.880 ou só > 0 (a saída WebP é menor que a entrada na prática, mas não por garantia).
  3. Índices: o da unicidade de posição basta para WHERE salao_id AND ORDER BY posicao e para o MAX/COUNT por salão? A unicidade de chave e a de (salao_id, envio) bastam para as buscas por chave/token? Confirmar com EXPLAIN (listar, prechecar, trocarComVizinha, removerCompactando, buscarChaveDaFoto por id).
  4. Confirmar que um DELETE seguido de UPDATE posicao - 1 na mesma transação, com a constraint adiada, não gera 23505 no commit; e que dois INSERT concorrentes em salões diferentes não se bloqueiam.
  5. Ausência de ciclo de espera: salao FOR NO KEY UPDATE → salao_foto; o INSERT toma FOR KEY SHARE em salao (a mesma transação já tem NO KEY UPDATE).
  6. Testes de banco: UNIQUE de chave, de (salao_id, envio) e de posição (23505 no commit com a constraint adiada); cada CHECK (aceita e recusa); FK Restrict; contagem 12 posições aceitas e a 13ª recusada por CHECK; drift atualizado.
  7. Cabeçalho com impacto (tabela vazia, sem trava relevante) e reversão manual (DROP TABLE, DELETE em _prisma_migrations), padrão D-007.
PRÓXIMA AÇÃO: T-0 (§9). Ao concluir, avisar o líder para liberar T-6.
```

## 5. Infraestrutura: **DevOps obrigatório**

### 5.1 Dependências, Docker e compose
- `package.json`/lock: `sharp` 0.35.5 e `@aws-sdk/client-s3` 3.1163.0 em `dependencies`, exatas (`.npmrc save-exact`). Conferir que `npm ci` instala `@img/sharp-linux-x64` e `@img/sharp-libvips-linux-x64` (glibc, `node:24-trixie-slim`) no estágio de build e que `npm prune --omit=dev` os mantém no estágio final. Sem `allowScripts` novo (sharp 0.35 não tem `install`); registrar a conferência.
- `Dockerfile` (final): criar `ARMAZENAMENTO_DIR` com dono `node` **antes** de `USER node` (`mkdir -p /app/.armazenamento && chown node:node`), para que o volume nomeado herde o dono.
- `docker-compose.yml`: volume nomeado `armazenamento` montado no `app` em `/app/.armazenamento`; `ARMAZENAMENTO_DIR` explícita. Cuidado: `environment` no serviço substitui o mapa da âncora (`<<` é raso); repetir `DATABASE_URL` ou pôr `ARMAZENAMENTO_DIR` na própria âncora. O worker não monta o volume (não grava fotos).
- `docker/smoke.sh`: depois do `/api/health`, provar (sem endpoint novo) com `docker compose exec -T app node -e` que (a) `require('sharp')` carrega e converte uma imagem mínima para WebP e (b) `ARMAZENAMENTO_DIR` é gravável pelo usuário `node` (cria e apaga um arquivo). O arquivo de teste usa nome fora do formato de chave.
- Persistência (CA-17): evidência manual objetiva em `devops.md` (gravar marcador, `docker compose down`, `up`, marcador presente). O DevOps decide se vira um segundo script.

### 5.2 CI
- Jobs `testes` e `e2e`: o `npm ci` já instala os binários do `sharp`; **sem job novo**. Integração usa `ARMAZENAMENTO_DIR` temporário por arquivo de teste (criado pelo helper do dev, não pela CI). Conferir que nenhum passo da CI define `STORAGE_ADAPTER=real`. O job `docker` passa a rodar o smoke estendido (já roda `sh docker/smoke.sh`).
- `.gitignore`: `.armazenamento/`.

### 5.3 Lint (posse do desenvolvedor T-3, parecer do DevOps)
`eslint.config.mjs`: (a) `@aws-sdk/*` entra em `SDK_PROVEDOR`; (b) `^sharp$` vira um padrão novo `IMAGEM_SHARP`, barrado em todos os blocos exceto num bloco novo `src/server/imagem/**` (e `TESTES`), que restringe PRISMA, SDK_PROVEDOR, ADAPTADORES e PG_BOSS como o bloco geral; `src/server/imagem/**` entra nos `ignores` do bloco geral para não casar com dois blocos. O padrão `integrations/[^/]+/(real|simulado)` já cobre `armazenamento/`.

### Transferência para o DevOps

```
DEMANDA: D-021 — fotos do salão com armazenamento por adaptador (E2.7, issue #76)
DE: arquiteto-software  PARA: devops
OBJETIVO: dependências exatas, imagem, volume do armazenamento simulado e smoke estendido
CONTEXTO NECESSÁRIO: design.md §0 (sharp já no lock como opcional do Next, sem script de install), §5. O app grava objetos em ARMAZENAMENTO_DIR (padrão .armazenamento, relativo ao cwd /app); o worker não usa o armazenamento nesta demanda. Não existe endpoint de fotos para o smoke usar: as provas são por docker compose exec.
CRITÉRIOS DE ACEITAÇÃO: CA-17 (sharp carrega na imagem; diretório gravável pelo usuário node; objeto persiste após down/up sem -v; versões exatas; npm ci sem --force)
DECISÕES JÁ TOMADAS: sharp 0.35.5 e @aws-sdk/client-s3 3.1163.0 exatas (reverifique com npm view que têm mais de 14 dias; nunca suba); volume nomeado 'armazenamento'; sem job de CI novo; sem allowScripts novo.
ARQUIVOS ENVOLVIDOS (posse do DevOps, T-1): package.json; package-lock.json; Dockerfile; docker-compose.yml; docker/smoke.sh; .gitignore; .github/workflows/ci.yml (só se necessário); docs/demandas/D-021/devops.md.
EVIDÊNCIAS: docs/demandas/D-021/design.md; sh docker/smoke.sh; docker compose down && docker compose up -d --wait (marcador persistido)
PENDÊNCIAS: 1) permissão do volume (dono node) e a âncora YAML (merge raso de environment); 2) confirmar glibc/binários sharp na imagem final; 3) decidir se a persistência vira script; 4) o .env.example e o README são do desenvolvedor (T-3, T-12): sem conflito.
PRÓXIMA AÇÃO: T-1 (§9). Ao concluir, avisar o líder para liberar T-2 e T-4.
```

## 6. Verificação das invariantes

| Invariante | Aplica? | Como é atendida |
|---|---|---|
| Escopo por salão no servidor | Sim | `RepoFoto` filtra `salao_id` do contexto em todo método; `salaoId` de entrada é ignorado (o envio nem tem esse campo); `fotoId` de outro salão → `NaoEncontrado`, sem escrita nem chamada ao armazenamento (a chamada só vem depois de o repositório devolver a chave). A leitura pública usa `PublicoContext`; a rota por id é pública por definição (A-1) e só devolve a imagem. CA-4, CA-10. |
| Exclusion constraint anti-sobreposição | Não se aplica | Fotos não têm intervalo de tempo. A unicidade de `(salao_id, posicao)` é a análoga para a ordem. |
| UTC e fuso do salão | Não se aplica | `criado_em` é `timestamptz` (UTC) e serve só para auditoria. |
| Adaptadores de integração | Sim | Porta + simulado + real, seletor `STORAGE_ADAPTER`, só por `registry.ts`; lint barra `@aws-sdk/*` fora de `integrations/**` e o import direto de `armazenamento/(real\|simulado)`. `sharp` é biblioteca local (A-9). Nenhum dado de cartão. |
| Soft deletes e anonimização | Parcial | Fotos são do estabelecimento, não de pessoa identificada na base: remover a linha é remoção real (RN-16), não soft delete; não há cliente envolvido. Profissionais e serviços não mudam. |
| Salão suspenso somente leitura | Sim (declarado) | As quatro ações declaram `capacidade: 'configurar'`; o bloqueio é da E6.4 (registrada em §10). A rota pública e a leitura pública não filtram suspensão (PLAN:81). |
| Idempotência de webhooks e mensagens | Não se aplica (webhooks/mensagens). Idempotência própria | Token `envio` com `UNIQUE (salao_id, envio)` decidido sob a trava; remoção e reordenação idempotentes por `NaoEncontrado` e posição esperada (RN-18). |
| Auditoria do super admin | Não se aplica | Nenhuma ação do super admin. Moderação é da E8.x. |
| Segurança do upload | Sim | `Origin` exato (A-3), `SameSite=Lax`, tipo por bytes, `limitInputPixels`, limite de corpo lido em fluxo, chave gerada no servidor, reprocessamento (sem EXIF/GPS), `nosniff`, rota sem listagem, logs sem `alt`/nome/bytes. |

## 7. Riscos e decisões

| ID | Risco | Mitigação |
|---|---|---|
| R-1 | Gravar no armazenamento antes da transação pode deixar objeto órfão (compensação falha ou processo morre entre gravar e commitar). | Compensação síncrona + log `armazenamento.orfao { chave }`; a chave é aleatória e sem dado pessoal; a rota pública nunca serve objeto sem linha. Varredura fica registrada como dívida (§10). Aceito (D-9). |
| R-2 | Memória: 50 MP decodificados + corpo em memória por requisição. | Semáforo de 2 decodificações (A-7), `sharp.cache(false)`, corpo ≤ 5 MiB + 64 KiB, `limitInputPixels`. O DevOps registra a memória observada no smoke se houver limite no compose (não definimos limite novo). |
| R-3 | `failOn: 'truncated'` pode aceitar um JPEG corrompido "bonito" ou recusar câmera com aviso. | Teste dedicado (CA-2 truncado; JPEG de câmera com EXIF/ICC aceito); escada `'truncated' → 'error' → 'warning'` (A-6). |
| R-4 | `Origin` × `APP_URL`: o gestor acessando por host diferente do `APP_URL` (ex.: `127.0.0.1` × `localhost`) recebe 403. | Corpo do 403 em texto simples explicando ("Acesse pelo endereço configurado em APP_URL."); README documenta. É o mesmo critério dos links por e-mail (D-011). |
| R-5 | `Referrer-Policy: no-referrer` faria o navegador enviar `Origin: null` em POST de formulário (D-011). | A página de fotos não define `Referrer-Policy`; teste E2E/integra confere ausência de `no-referrer` na rota da página. |
| R-6 | Worker valida todo o ambiente: `STORAGE_ADAPTER=real` incompleto derruba também o worker. | Igual aos outros adaptadores; documentado no README. |
| R-7 | Cache: foto removida pode aparecer por até 1 h (`max-age=3600`) e mais com CDN. | Aviso no README (operador) e na spec (§6); `ETag` e id imutável. |
| R-8 | Mesma renderização reaproveitada (botão Voltar) reenviando o token: o 2º envio vira "ok" sem criar foto. | Comportamento intencional (RN-18). Mensagem `ok` comum; o contador na página mostra o resultado real. |
| R-9 | Disputa de posição sob concorrência (envio × mover × remover). | Tudo sob `salao FOR NO KEY UPDATE`; constraint de posição adiada só como rede de segurança; teste ×10 (CA-3, CA-8). |
| R-10 | `Response#formData()` em corpo malformado ou muito aninhado. | Corpo já limitado a ~5,06 MiB; qualquer exceção → `falha`; teste de multipart malformado e campo repetido. |
| R-11 | Adaptador real não validado com credenciais reais. | Testes de contrato com cliente injetado + servidor S3 falso local (A-17 abaixo); README e `dev.md` dizem "não validado contra provedor real". |

**Como o adaptador real é testado sem rede (A-17).** Dois níveis: (1) **unitário** com cliente injetado (`{ send }`): confere que cada comando é do tipo certo (`PutObjectCommand` etc.), `Bucket`, `Key`, `ContentType: 'image/webp'`, ausência de `ACL`, `NoSuchKey` → `null`, rede → `ErroDeArmazenamento`; (2) **integração** com um servidor HTTP falso em `127.0.0.1:0` (`node:http`, memória) que entende `PUT/GET/DELETE /<bucket>/<chave>` (path-style, `forcePathStyle: true`) e responde `NoSuchKey` em XML 404: prova o formato real na rede local. O teste espiona `dns.lookup` e falha se algum host não loopback for resolvido. O mesmo conjunto de **testes de contrato** (`rodarContratoDaPorta(fabrica)`) roda para o simulado (diretório temporário) e para o real (servidor falso).

## 8. Estratégia de testes

Cobertura ≥ 90% de linhas: o código novo é majoritariamente puro ou de serviço/repositório, coberto por unidade e integração; os `route.ts` finos (3 arquivos de ~10 linhas) são exercitados via `tratarEnvio`/`servirFoto` (a lógica está nesses módulos); E2E não conta na métrica.

**Fixtures de imagem:** geradas nos testes com `sharp` (`tests/support/imagens.ts`, T-4): JPEG grande com EXIF (GPS via `withExif`) e orientação 6, PNG com alfa, WebP, JPEG Display-P3/CMYK, PNG 10000×10000 monocromático (bomba), JPEG/PNG truncados, WebP/PNG animados. Sem binários versionados. O arquivo de 5.242.880/5.242.881 bytes é montado com um JPEG válido + preenchimento após o EOI (o `sharp` ignora bytes finais); se o `sharp` recusar, o teste usa um PNG com chunk `tEXt` de tamanho calibrado.

| Camada | Cobre |
|---|---|
| Unidade (`src/**`) | `detectarTipo`; `validarAlt`/token; `lerCorpoEnvio` (Content-Length, fluxo sem Content-Length, campo repetido, malformado, 5.242.880 × 5.242.881); `ehChaveValida`/`gerarChave`; simulado (chave fora do formato, atomicidade, ENOENT); real com cliente injetado; `ambiente.ts` do armazenamento; `env.ts`/`check-env` (CA-5); `servirFoto` (cabeçalhos, 304, ETag); `tratarEnvio` (Origin, 303, códigos); componentes (jsdom); navegação (CA-16); `processarImagem` com `sharp` real (CA-1 parte pura). |
| Integração (PostgreSQL real, `tests/integration/fotos/**`, `…/db/**`) | Repositórios e serviço (CA-1..4, 6..10, 12..14, 18); concorrência ×10 (CA-3, CA-8, CA-13); servidor S3 falso (CA-11); páginas (CA-16). Armazenamento simulado num diretório temporário por arquivo. |
| Playwright (`/dev/fotos`, sem banco) | CA-15 (teclado, axe 4.14.0, 375×812, sem JS, 12 fotos). |
| Docker/CI | CA-17. |

### Mapa CA → tarefa → teste

| CA | Tarefas | Teste |
|---|---|---|
| CA-1 | T-4, T-7 | Unidade `processarImagem`/`detectarTipo`; integração `envio.test.ts` (linha, chave, leitura pública) |
| CA-2 | T-4, T-5, T-7 | Unidade (detecção, limites, texto, multipart); integração `envio-recusas.test.ts` pelo `tratarEnvio` (um caso por linha; contagem de arquivos) |
| CA-3 | T-6, T-7, T-8 | Integração `concorrencia.test.ts` (×10, 11 fotos; S1 × S2) |
| CA-4 | T-6, T-7, T-10 | Integração `isolamento.test.ts` (ações e envio; profissional; sem sessão; página) |
| CA-5 | T-3 | Unidade `env.test.ts`, `check-env.test.ts`, `.env.example` |
| CA-6 | T-6, T-7 | Integração `remocao.test.ts` (ordem commit × `remover`; adaptador que lança; log; 404 público) |
| CA-7 | T-5, T-6, T-7 | Unidade (`validarAlt`) + integração (`xmin`, normalização) |
| CA-8 | T-6, T-7, T-8 | Integração `ordem.test.ts` e `concorrencia.test.ts` |
| CA-9 | T-2, T-7 | Unidade (simulado recusa chave) + integração `entrega.test.ts` (inclui salão suspenso) |
| CA-10 | T-3, T-6, T-7 | Integração `leitura-publica.test.ts` (conjunto exato de chaves; `S3_URL_PUBLICA` com cliente injetado) |
| CA-11 | T-2 | Unidade (cliente injetado) + integração com servidor S3 falso + contrato da porta |
| CA-12 | T-5, T-7 | Integração `origem.test.ts` + unidade (códigos) |
| CA-13 | T-6, T-7, T-8 | Integração `idempotencia.test.ts` e `concorrencia.test.ts` |
| CA-14 | T-7 | `registro.test.ts` existente (glob `*.acao.ts`) + teste que `tratarEnvio` chama `executar` |
| CA-15 | T-9, T-11 | Playwright `fotos.spec.ts`, `fotos-sem-js.spec.ts` |
| CA-16 | T-5, T-10 | Unidade (navegação) + integração `paginas.test.ts` |
| CA-17 | T-1 | `sh docker/smoke.sh`, job `docker`, evidência manual da persistência |
| CA-18 | T-7 | Integração `falhas.test.ts` (gravar lança; sharp lança; logs sem dados) |

## 9. Tarefas

DBA (T-0) e DevOps (T-1) obrigatórios. Implementação: `desenvolvedor`.

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-0 | dba | — | T-1, T-5 | `prisma/schema.prisma`, `prisma/migrations/<ts>_salao_foto/migration.sql`, `tests/integration/db/drift.test.ts`, `tests/integration/db/salao-foto.test.ts`, `docs/demandas/D-021/dba.md` |
| T-1 | devops | — | T-0, T-5 | `package.json`, `package-lock.json`, `Dockerfile`, `docker-compose.yml`, `docker/smoke.sh`, `.gitignore`, `.github/workflows/ci.yml` (se preciso), `docs/demandas/D-021/devops.md` |
| T-2 | desenvolvedor | T-1 | T-4, T-6, T-9 | `src/server/integrations/armazenamento/{ambiente,chave,port,simulado,real}.ts`, `…/{ambiente,chave,port,simulado,real}.test.ts`, `src/server/integrations/armazenamento/contrato.ts` (helper de testes da porta), `tests/integration/armazenamento/{real-s3-falso,contrato}.test.ts` |
| T-3 | desenvolvedor | T-2 | T-6, T-11 | `src/server/env.ts`, `src/server/env.test.ts`, `src/server/check-env.ts`, `src/server/check-env.test.ts`, `src/scripts/check-env.test.ts` (se preciso), `src/server/integrations/registry.ts`, `src/server/integrations/registry.test.ts`, `.env.example`, `eslint.config.mjs`, `src/worker/**` (só testes/log de `worker.adaptadores` que citem os modos) |
| T-4 | desenvolvedor | T-1 | T-2, T-6, T-9 | `src/server/imagem/{detectar,processar}.ts`, `src/server/imagem/{detectar,processar}.test.ts`, `tests/support/imagens.ts` (novo) |
| T-5 | desenvolvedor | — | T-0, T-1 | `src/server/fotos/{tipos,validacao,multipart}.ts`, `src/server/fotos/{validacao,multipart}.test.ts`, `src/config/navegacao.ts`, `src/config/navegacao.test.ts` |
| T-6 | desenvolvedor | T-0, T-5 | T-2, T-3, T-9, T-11 | `src/server/repos/{foto,foto-publica,publico,index,tipos,servico}.ts` (servico.ts só comentário), `src/server/repos/index.test.ts`, `src/server/repos/publico.test.ts`, `tests/integration/fotos/apoio.ts`, `tests/integration/fotos/repos-fotos.test.ts` |
| T-7 | desenvolvedor | T-3, T-4, T-6 | T-9, T-11 | `src/server/fotos/{servico,leitura,entrega,envio-http}.ts`, `src/server/fotos/fotos.acao.ts`, `src/server/fotos/{entrega,envio-http}.test.ts`, `tests/integration/fotos/{apoio-servico,envio,envio-recusas,origem,idempotencia,remocao,ordem,edicao-alt,entrega,leitura-publica,isolamento,falhas}.ts(.test)` |
| T-8 | desenvolvedor | T-7 | T-10 | `tests/integration/fotos/concorrencia.test.ts` |
| T-9 | desenvolvedor | T-5 | T-2, T-4, T-6, T-7 | `src/app/painel/configuracoes/fotos/{estado.ts,FormularioEnvio.tsx,ListaFotos.tsx,Fotos.module.css}`, `…/{FormularioEnvio,ListaFotos}.test.tsx` |
| T-10 | desenvolvedor | T-7, T-9 | T-8 | `src/app/painel/configuracoes/fotos/{page.tsx,acoes.ts}`, `src/app/painel/configuracoes/page.tsx`, `src/app/painel/configuracoes/Configuracoes.module.css`, `src/app/api/painel/fotos/route.ts`, `src/app/api/fotos/[id]/route.ts`, `tests/integration/fotos/paginas.test.ts` |
| T-11 | desenvolvedor | T-4, T-5, T-9 | T-3, T-7, T-8, T-10 | `src/app/dev/fotos/**` (inclui `enviar/route.ts`), `e2e/fotos.spec.ts`, `e2e/fotos-sem-js.spec.ts` |
| T-12 | desenvolvedor | T-0..T-11 | — | `README.md`, `docs/demandas/D-021/dev.md` |
| T-13 | tester | T-12 | — | `docs/demandas/D-021/testes.md` |

Rodadas (sem arquivo em comum):
- **Rodada 1:** T-0 ‖ T-1 ‖ T-5.
- **Rodada 2:** T-2 ‖ T-4 ‖ T-6 (depois de T-0 e T-5) ‖ T-9.
- **Rodada 3:** T-3 (depois de T-2) ‖ T-11.
- **Rodada 4:** T-7.
- **Rodada 5:** T-8 ‖ T-10.
- **Rodada 6:** T-12. **Rodada 7:** T-13.

Regras de posse:
- Entre tarefas, só leitura. T-6 lê o cliente Prisma gerado pela T-0 (`npm run db:generate`); T-7, T-8 e T-10 importam `tests/integration/fotos/apoio.ts` (T-6) e `apoio-servico.ts` (T-7); T-4 entrega `tests/support/imagens.ts`, usado por T-7, T-8 e T-11.
- Ninguém edita `src/server/tenant/**`, `src/server/auth/**`, `src/components/**`, `tests/support/**` (exceto o arquivo novo da T-4), os testes de integração existentes das demais demandas, `src/app/dev/{componentes,jornada,bloqueios,configuracoes,perfil,funcionamento}/**`, os specs E2E existentes, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml` (só o DevOps). O `CLAUDE.md` é do líder.
- `tipos.ts`, `validacao.ts`, `multipart.ts`, `estado.ts` e `ambiente.ts` do armazenamento não importam `next/*`, Prisma nem SDKs (`ambiente.ts` sem nenhum import).

**T-0 — Migração (dba).** Entregável: §4 e as pendências 1–7; `dba.md`. Conclusão: `prisma migrate diff` da parte 1 sem edição; `npm run db:generate`, `typecheck` e `npx vitest run --project integration tests/integration/db` verdes; base limpa aplica todas as migrações.

**T-1 — Dependências e Docker (devops).** Entregável: §5. Conclusão: `npm ci` sem `--force`; `npm run build` e `npm run build:node` verdes; `sh docker/smoke.sh` passa com `sharp` e diretório gravável; persistência após `down`/`up` evidenciada em `devops.md`; sem `^`/`~`.

**T-2 — Porta e adaptadores.** Entregável: §3.1. Conclusão: testes de contrato verdes para simulado e real (servidor falso, sem rede); simulado recusa `..`, `/` inicial, `\`, nulos e chave sem o formato; `ambiente.ts` sem imports.

**T-3 — Ambiente e registro.** Entregável: §3.2, `registry.ts`, lint (§5.3). Conclusão: CA-5 verde (todas as variáveis ordenadas, sem valores; `STORAGE_ADAPTER=REAL` nomeia o seletor); `.env.example` confere; `npm run lint` (`--max-warnings=0`) verde, e um import de `sharp`/`@aws-sdk` fora das pastas permitidas falha no lint (teste de lint ou arquivo temporário de prova, removido).

**T-4 — Imagem.** Entregável: §3.3 e `tests/support/imagens.ts`. Conclusão: CA-1 (parte pura: dimensões, orientação, sem EXIF/XMP/ICC, alfa preservado, sem ampliação, primeiro quadro) e a conversão Display-P3/CMYK para sRGB provadas; 100 MP → `resolucao`; truncado → `ilegivel`; semáforo limita a 2 simultâneas.

**T-5 — Contratos, validação, multipart e rotas nomeadas.** Entregável: §3.4 (`tipos`, `validacao`, `multipart`) e `ROTAS`. Conclusão: unidade verde; `SEGMENTOS_RESERVADOS` inalterado; os testes de navegação/`ROTAS` existentes continuam verdes.

**T-6 — Repositórios.** Entregável: §3.5. Conclusão: integração prova escopo por salão, ordem 1..n, limite sob trava, compactação, troca com posição esperada, leitura pública sem `chave` fora do tipo interno; lint (`repos` é o único com Prisma) verde.

**T-7 — Serviço, ações, entrega e envio HTTP.** Entregável: §3.4. Conclusão: CA-1..4, 6, 7, 9, 10, 12, 13 (serial), 14, 18 verdes; nenhum `alt`, nome ou bytes nos logs; `enviarFoto`, `editarAltDaFoto`, `moverFoto`, `removerFoto` aparecem no teste de registro.

**T-8 — Concorrência.** Entregável: CA-3, CA-8, CA-13 ×10 com banco por rodada. Conclusão: `for i in $(seq 10); do npx vitest run --project integration tests/integration/fotos/concorrencia.test.ts || break; done` verde, sem 5xx nem impasse.

**T-9 — Componentes.** Entregável: §3.6 (componentes e `estado.ts`). Conclusão: testes jsdom (rótulos, `aria-describedby`, nomes acessíveis "Remover a foto N", botões das pontas, região viva); sem cor fora dos tokens; lint sem aviso.

**T-10 — Páginas e rotas.** Entregável: §3.6. Conclusão: CA-4 (página: profissional "Acesso negado"; sem sessão → `/entrar?proximo=`), CA-16 verdes; GET/HEAD em `/api/painel/fotos` → 405; `/api/fotos` e `/api/fotos/` → 404/405.

**T-11 — Vitrine e E2E.** Entregável: §3.6 (vitrine) e CA-15. Conclusão: `npx playwright test e2e/fotos.spec.ts e2e/fotos-sem-js.spec.ts` verde (teclado, axe, 375×812, sem JS, 12 fotos), após `npm run build`.

**T-12 — Documentação.** Entregável: README (variáveis, credenciais reais S3/R2/MinIO, `S3_URL_PUBLICA` sem listagem, cache de 1 h, `Origin` × `APP_URL`, comandos novos: estabilidade das fotos e E2E das fotos) e `dev.md`. Conclusão: README confere com `.env.example`; o adaptador real consta como **não validado contra provedor real**.

**T-13 — Teste independente (tester).** Veredito em `testes.md` com os gates do `CLAUDE.md`.

## 10. Obrigações registradas para as próximas demandas

- **E4.1 (#37):** usar `lerFotosPublicas` (nunca montar URL à mão), exibir `alt`, `width` e `height`, manter as fotos com o salão suspenso, tratar 404 de imagem (A-12) ocultando-a; se usar `next/image`, configurar `images.remotePatterns` para `S3_URL_PUBLICA`.
- **E6.4 (#41):** incluir `enviarFoto`, `editarAltDaFoto`, `moverFoto` e `removerFoto` no bloqueio da capacidade `configurar` com o salão suspenso; a rota pública continua liberada.
- **Dívida:** varredura de objetos órfãos (R-1), envio múltiplo e recorte (D-12), hospedagem do adaptador real validada com credenciais.
- **`CLAUDE.md` (líder):** resumo da D-021 e as linhas de comandos (estabilidade das fotos, E2E das fotos), incluindo "primeira mutação por route handler: `Origin` contra `APP_URL` + `defineAcao` com entrada adiada".
