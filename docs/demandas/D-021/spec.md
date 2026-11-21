# D-021 — Especificação: fotos do salão com armazenamento por adaptador (issue #76, E2.7)

Fontes, por precedência (`docs/trinks-alinhamento.md` §1.2): `docs/trinks-alinhamento.md` (DT-4 e DT-5 em `:18-19`; §7.2 em `:259-264`; §8.1 `salao_foto` em `:298-300`; §8.2 "Fotos" em `:317-321`; §8.3 em `:325-332`; §8.4 em `:334-354`), `PLAN.md` revisado ("Perfil público do salão" `:30-34`; suspensão `:81`; "Interface" `:122-124`; "Fora da primeira versão" `:146-148`), corpo da issue #76 (CA-1..CA-6, mantidos e refinados abaixo), `CLAUDE.md` (invariantes "Tenant isolation" e "Integrations sit behind adapters", padrões D-007, D-013..D-017 e D-020), decisões do líder na transferência e o código citado. A base de código é a branch `feat/d-020-perfil-funcionamento` (PR #80, D-020 ainda sem merge).

Adições desta especificação à issue: RNs que tornam verificáveis o processamento da imagem, o texto alternativo, a ordem, a entrega pública e a proteção da rota de upload; CAs complementares (CA-7 em diante); e decisões não bloqueantes D-n (§9), incluindo as duas que o líder pediu (entrega pública e upload sem JavaScript).

## 1. Problema

Hoje a funcionalidade é **inexistente**. Evidências:

- Nenhuma ocorrência de `foto`, `armazenamento`, `STORAGE_ADAPTER`, `sharp` ou `multipart` (exceto num teste de e-mail) em `src/`, `prisma/`, `docker/`, `docker-compose.yml`, `Dockerfile`, `.env.example` e `README.md` (`grep -rniI "foto\|armazenamento\|STORAGE_ADAPTER\|sharp\|multipart"`).
- Esquema: `model Salao` (`prisma/schema.prisma:125-183`) tem o perfil da D-020, sem fotos. As migrações são `init`, `reserva_exclusion`, `restricoes_sql`, `simuladores_integracao` e `perfil_funcionamento` (`prisma/migrations/`). Não há `salao_foto`.
- O que existe e esta demanda reaproveita ou estende:
  - **Registro de integrações** (D-007): `Integracoes` tem só `email`, `whatsapp`, `mercadoPago` e `turnstile` (`src/server/integrations/registry.ts:25-31`). `criarIntegracoes` valida o ambiente e constrói as portas (`:77-92`), e `integracoes()` memoiza no primeiro uso (`:101-104`). O import não lê o ambiente (`:18-21`).
  - **Modelo de par real + simulado**: `turnstile/ambiente.ts` (seletor, `CHAVES` e `lerConfigReal`, sem imports, porque entra no bundle do check-env, `:1-23`); `turnstile/port.ts` (porta sem provedor, Prisma nem `process.env`, `:1-16`); `email/real.ts` (SMTP real com `nodemailer`).
  - **Ambiente**: `esquemaEnv` com os quatro seletores (`src/server/env.ts:27-44`); `Seletor` é a união dos quatro nomes (`:62`); `MODULOS` (`:73-78`); `chavesDeclaradas()` alimenta o teste que confere o `.env.example` (`:89-96`); `validarEnv` junta todas as variáveis inválidas num único `ErroDeAmbiente` sem valores (`:153-178`); `modosAtivos` (`:180-192`). As variáveis de provedor só são lidas no modo `real` (`:21-26`). Ainda não há variável exclusiva do modo simulado.
  - **check-env**: `descreverModos` imprime os quatro modos (`src/server/check-env.ts:9-16`). O entrypoint roda o check-env nos papéis app e worker (`docker/entrypoint.sh:6-7`).
  - **Lint RN-16**: SDKs de provedor só em `src/server/integrations/**` (`eslint.config.mjs:52-61`). Os adaptadores `integrations/*/(real|simulado)` não são importados diretamente (`:63-72`).
  - **Dependências**: não há `sharp` nem `@aws-sdk/client-s3` em `dependencies` (`package.json:26-38`). O `sharp` 0.35.5 está no lock só como dependência **opcional** do Next (`package-lock.json:9055-9060`, `"optional": true`), então não pode ser usado como está.
  - **Docker**: o serviço `app` não tem volume (`docker-compose.yml:35-52`); o único volume é `pgdata` (`:67-68`). O estágio final roda como `node` (`Dockerfile:27-49`). O smoke confere `/api/health` e o `Referrer-Policy` (`docker/smoke.sh:22-31`).
  - **Upload**: não há route handler de mutação. O único route handler é `GET /api/health` (`src/app/api/health/route.ts`). Ações de servidor (`defineAcao`) têm o limite de corpo padrão do Next (1 MB, segundo a transferência do líder). `defineAcao` expõe `executar(credencial, input, deps)` sem `next/headers` (`src/server/tenant/define-acao.ts:33-38`), e `lerCredencialDoCookie` lê o cookie (`src/server/tenant/next.ts:11-14`). Um route handler pode, portanto, passar pelo mesmo núcleo de sessão, papel e capacidade.
  - **Proxy**: intercepta `/painel` e `/painel/:path*` e redireciona com **307** para `/entrar?proximo=` sem cookie (`src/proxy.ts:24-28`). Um 307 preserva o método: um POST sem sessão sob `/painel` chegaria como POST em `/entrar`. O `proxyClientMaxBodySize` padrão do Next é 10 MB (`node_modules/next/dist/server/config-shared.js:289`).
  - **Trava do salão**: `RepoSalao.travar` faz `SELECT fuso FROM salao … FOR NO KEY UPDATE` (`src/server/repos/salao.ts:110-119`; justificativa em `:13-17`: nunca `FOR UPDATE`).
  - **Leitura pública**: `lerPerfilPublico(ctx: PublicoContext)` (`src/server/repos/publico.ts:139-163`) não filtra suspensão e ainda não devolve fotos.
  - **Permissão**: `'salao.configurar': linha('salao', 'negado', 'negado')` (`src/server/auth/permissoes.ts:49`).
  - **Rotas**: `/painel/configuracoes` já lista links para "Perfil público" e "Horário de funcionamento" (`src/app/painel/configuracoes/page.tsx:40-51`). Não há rota de fotos (`src/config/navegacao.ts:34-36`). `SEGMENTOS_RESERVADOS` já contém `api` e `_next` (`:131-148`), então uma rota pública sob `/api/` não reserva nenhum slug novo.
  - **PRG por parâmetro de busca**: `/painel/bloqueios` lê `?remocao=` (`src/app/painel/bloqueios/page.tsx:37-47`, D-016).

## 2. Objetivo

O gestor envia, descreve, ordena e remove até 12 fotos do salão pelo painel. As imagens ficam limpas de metadados, em tamanho controlado, gravadas por um adaptador de armazenamento trocável (disco em desenvolvimento e testes, compatível com S3 em produção). A página pública (E4.1) passa a ter uma leitura ordenada das fotos, com texto alternativo e URLs servidas sem listagem.

## 3. Escopo

**Entra:**
- Porta `ArmazenamentoPort` em `src/server/integrations/armazenamento/`, com os adaptadores `simulado` (disco) e `real` (compatível com S3, `@aws-sdk/client-s3`), escolhidos por `STORAGE_ADAPTER` e obtidos só pelo `registry.ts`.
- As variáveis `STORAGE_ADAPTER`, `ARMAZENAMENTO_DIR` e `S3_*` em `env.ts`, no check-env, no `.env.example` e no README.
- A migração aditiva com a tabela `salao_foto`.
- Validação e processamento da imagem: detecção pelos bytes iniciais e reprocessamento com `sharp`.
- O route handler de upload (multipart, até 5 MB) e as ações de texto alternativo, de ordem e de remoção.
- A página `/painel/configuracoes/fotos`, com link em `/painel/configuracoes`.
- A rota pública de entrega das imagens e a leitura pública ordenada para a E4.1.
- A vitrine `/dev/fotos` para os E2E sem banco.
- Docker: `sharp` no runtime, o volume do armazenamento simulado e o smoke.
- Testes de unidade, de integração (PostgreSQL real; S3 falso local ou cliente injetado) e E2E.

**Fica fora (com dono):**
- Fotos de profissionais e logotipo separado: roteiro posterior (issue #76; `docs/trinks-alinhamento.md:144`, `:247`).
- A exibição das fotos na página pública (galeria, carrossel): E4.1 (#37). Aqui só se entrega a leitura e a URL.
- O bloqueio de escrita com o salão suspenso: E6.4 (#41: "o gestor não altera o perfil nem as fotos"). Aqui só se declara a capacidade `configurar`.
- Moderação de fotos pela plataforma e edição pelo super admin: E8.x.
- Seed com fotos: E9.2 (#43).
- Recorte, filtros, edição de imagem no navegador e envio de vários arquivos de uma vez (D-12).
- Varredura periódica de objetos órfãos (D-9).
- Validação do adaptador real contra um provedor de verdade: depende de credenciais do usuário (§7).

Conferido contra "Fora da primeira versão" (`PLAN.md:146-148`): nada aqui cria conta de cliente, pagamento, aplicativo ou funções de marketing. As fotos são as do estabelecimento, previstas no `PLAN.md:33`.

## 4. Regras de negócio

### Acesso e escopo

- **RN-1 — Permissão** (issue CA-4; `permissoes.ts:49`): só o gestor vê a página de fotos e executa o envio, a edição do texto alternativo, a reordenação e a remoção, com a operação `salao.configurar` e `papeis: ['gestor']`. O profissional vê "Acesso negado" na página. No envio, recebe 403 (ou o PRG equivalente, RN-17), e nas ações recebe `AcessoNegado`, sem escrita. Sem sessão, a página redireciona para `/entrar?proximo=<rota>`. O envio sem sessão segue a RN-17. O super admin não acessa o painel. O gestor que também tem perfil de profissional tem o mesmo acesso do gestor.
- **RN-2 — Escopo do salão** (`CLAUDE.md`, "Tenant isolation"; issue CA-4): toda operação usa `ctx.salaoId`. Qualquer `salaoId` enviado na entrada é ignorado. Uma operação sobre `fotoId` de outro salão (ou inexistente) resulta em `NaoEncontrado` (404), sem escrita em nenhum dos dois salões e sem chamar o armazenamento.
- **RN-3 — Capacidade** (G-2; `PLAN.md:79-81`): o envio e as três ações declaram `capacidade: 'configurar'`. O bloqueio com o salão suspenso fica com a E6.4. As leituras continuam liberadas.

### Imagem

- **RN-4 — Tamanho do arquivo** (DT-5; issue CA-2; D-3): o arquivo enviado tem no máximo **5 MB = 5.242.880 bytes**. O servidor nunca lê mais que o limite do corpo (o arquivo mais uma folga fixa para os campos do multipart). Ao passar do limite, interrompe a leitura e responde "A foto deve ter no máximo 5 MB.", sem gravar nada. Um `Content-Length` declarado acima do limite é recusado antes de ler o corpo. Um corpo sem `Content-Length` (chunked) é contado enquanto é lido. Arquivo vazio (0 bytes) ou ausente: "Escolha uma foto para enviar.".
- **RN-5 — Tipo pelos bytes iniciais** (§8.2; issue CA-2): o tipo é decidido só pelos bytes iniciais, nunca pela extensão, pelo nome ou pelo `Content-Type`:
  - JPEG: `FF D8 FF`;
  - PNG: `89 50 4E 47 0D 0A 1A 0A`;
  - WebP: `52 49 46 46` (`RIFF`) + 4 bytes + `57 45 42 50` (`WEBP`).

  Qualquer outro conteúdo (GIF, HEIC, AVIF, SVG, PDF, texto, executável) com nome `.jpg` é recusado com "Envie uma foto em JPEG, PNG ou WebP.". A detecção é uma função pura com testes de unidade.
- **RN-6 — Decodificação e limites** (issue CA-2; D-4): os bytes aceitos pela RN-5 têm de ser decodificáveis pelo `sharp` como o tipo detectado. Arquivo truncado, corrompido ou cujo formato real difere do cabeçalho gera "Não foi possível ler esta imagem. Tente outro arquivo.". Para se proteger de bombas de descompressão, a imagem de entrada tem no máximo **50 megapixels** (`limitInputPixels`). Acima disso, a resposta é "A foto tem resolução grande demais (máximo de 50 megapixels).". Não há tamanho mínimo.
- **RN-7 — Reprocessamento** (DT-5; §8.2; issue CA-1; D-4): toda imagem aceita é reprocessada, nunca gravada como foi enviada:
  1. aplica a orientação EXIF (rotaciona os pixels), para que a foto do celular apareça em pé;
  2. reduz para que o **maior lado tenha no máximo 1600 px**, mantendo a proporção. Nunca amplia;
  3. converte para sRGB e descarta **todos** os metadados: EXIF (inclusive GPS), XMP, IPTC e o perfil ICC de entrada;
  4. em imagem animada (WebP ou PNG animados), usa só o primeiro quadro;
  5. preserva a transparência (o WebP com alfa é aceito);
  6. codifica em **WebP** com qualidade fixa (constante única no código; sugestão 82).

  A largura, a altura e os bytes **da saída** são gravados em `salao_foto`.
- **RN-8 — Chave gerada pelo servidor** (§8.2; D-5): a chave do objeto é gerada pelo servidor com ao menos 128 bits aleatórios, no formato `fotos/<aleatório>.webp`. Ela não contém o nome do arquivo enviado, o id ou o slug do salão, nem dados do usuário. O nome original do arquivo não é gravado em lugar nenhum. A chave nunca vem da entrada do cliente, nem no envio nem na entrega (RN-14).

### Texto alternativo, limite e ordem

- **RN-9 — Texto alternativo** (issue; `PLAN.md:33`; D-6): obrigatório no envio e na edição. É aparado, os espaços internos são colapsados e caracteres de controle (inclusive quebra de linha) são recusados, com a mesma regra de `normalizarNome` (`src/lib/texto.ts`). Depois de normalizado, tem de 1 a **150** caracteres, contados em unidades UTF-16 (`String#length`, igual ao `maxlength`). Mensagens: vazio, "Descreva a foto (texto alternativo para quem usa leitor de tela)."; longo demais, "Use no máximo 150 caracteres na descrição da foto.". No envio, o texto inválido recusa o envio inteiro, antes de processar a imagem e sem gravar nada.
- **RN-10 — Limite de 12** (issue CA-2/CA-3; §8.1): um salão tem no máximo **12** fotos. A 13ª é recusada com "O salão já tem 12 fotos. Remova uma para enviar outra.". O limite é garantido no servidor, sob a trava `SELECT … FROM salao … FOR NO KEY UPDATE` (a mesma da D-017/D-020, nunca `FOR UPDATE`): na mesma transação, contar e inserir. Uma checagem prévia sem trava, antes de processar e gravar o objeto, evita trabalho e gravação no armazenamento no caso sequencial (CA-2). A checagem sob trava é a que decide (CA-3).
- **RN-11 — Ordem** (issue; `PLAN.md:33`; D-7): as fotos do salão têm as posições `1..n`, contíguas e sem repetição. Uma foto nova entra no fim (`n+1`). A remoção compacta as posições. A reordenação move uma foto uma posição para cima ou para baixo: a ação recebe `fotoId`, a direção e a **posição esperada** (a que a página exibia). Se a foto não estiver mais nessa posição (outra aba mudou a ordem), nada é alterado e a resposta é "A ordem das fotos mudou. Confira e tente de novo.". Mover a primeira para cima ou a última para baixo é recusado sem escrita. Toda alteração de ordem acontece sob a trava do salão, numa transação.
- **RN-12 — Edição do texto alternativo**: muda só `alt` da foto do contexto. Não altera a imagem, a chave, a ordem nem os outros campos. Gravar o mesmo texto não escreve nada.

### Armazenamento e consistência

- **RN-13 — Porta e adaptadores** (`CLAUDE.md`, "Integrations sit behind adapters"; D-007; decisão do líder):
  - `ArmazenamentoPort` em `src/server/integrations/armazenamento/port.ts` não importa provedor, Prisma nem `process.env`. Ela tem, no mínimo: gravar (chave, bytes, tipo `image/webp`), ler (chave → bytes ou "não encontrado"), remover (chave; remover o que não existe não é erro) e a URL pública opcional (RN-14);
  - **simulado**: grava arquivos em `ARMAZENAMENTO_DIR`. Recusa qualquer chave fora do formato da RN-8, o que impede sair do diretório (`..`, `/` inicial, `\`, bytes nulos). A gravação é atômica (arquivo temporário e renomeação), para que uma leitura nunca veja um arquivo parcial;
  - **real**: compatível com S3 via `@aws-sdk/client-s3` (PutObject, GetObject e DeleteObject), com `S3_ENDPOINT`, `S3_REGIAO`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` e `S3_URL_PUBLICA` (opcional). Grava com `Content-Type: image/webp` e sem ACL pública por objeto. Nunca lista o bucket;
  - a lógica de negócio obtém a porta só por `integracoes().armazenamento`. O lint RN-16 passa a barrar `@aws-sdk/*` e `sharp` fora de `src/server/integrations/**` e de um único módulo de processamento de imagem (D-8). Também barra o import direto de `armazenamento/(real|simulado)`.
- **RN-14 — Entrega pública sem listagem** (§8.2; D-1): a imagem de uma foto é servida por uma rota da app, `GET /api/fotos/<fotoId>`. A rota:
  - resolve `fotoId` (UUID) em `salao_foto` e lê o objeto pela porta. Um id malformado ou inexistente, ou uma foto removida, responde 404 sem corpo útil, mesmo que o objeto ainda exista no armazenamento (limpeza que falhou, RN-16). A rota nunca recebe chave nem caminho;
  - responde 200 com `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: public, max-age=3600` e um `ETag` estável (o conteúdo de um `fotoId` nunca muda). Também responde 304 a um `If-None-Match` igual;
  - é pública e não exige sessão. Não filtra suspensão nem estado da assinatura (`PLAN.md:81`: a página pública mantém as fotos);
  - não existe nenhuma rota, prefixo ou diretório que liste fotos ou objetos. `GET /api/fotos` e `GET /api/fotos/` respondem 404 ou 405. No modo simulado, `ARMAZENAMENTO_DIR` fica fora de `public/` e nunca é servido como estático;
  - com `STORAGE_ADAPTER=real` e `S3_URL_PUBLICA` definida, a leitura pública (RN-15) devolve `S3_URL_PUBLICA` + `/` + chave em vez da rota da app. O bucket ou a CDN não podem listar; essa configuração é do operador e fica documentada no README. A rota da app continua respondendo nesse modo.
- **RN-15 — Leitura pública ordenada** (E4.1; DT-4): uma função em `src/server/repos/publico.ts`, com `PublicoContext` e `select` explícito, devolve as fotos do salão do contexto em ordem crescente de posição, cada uma com `{ id, url, alt, largura, altura }`. Ela não devolve a chave (exceto embutida na URL pública do bucket, RN-14), `bytes`, `salao_id`, `criado_em` nem dados de quem enviou. Não filtra suspensão. Um salão sem fotos devolve lista vazia. Para o painel, há uma leitura escopada equivalente (com a posição), sob `salao.configurar`.
- **RN-16 — Consistência entre banco e armazenamento** (issue CA-2/CA-6; decisão do líder; D-2):
  - **envio**: valida o texto, o tamanho, o tipo e a decodificação, processa a imagem em memória e faz a checagem prévia do limite, tudo **antes** de gravar qualquer coisa. Depois grava o objeto e então, numa transação sob a trava do salão, confere o limite e insere a linha. Se a transação recusar ou falhar, o objeto recém-gravado é removido (compensação). Se a compensação falhar, o erro é registrado em log (`armazenamento.orfao`, com a chave e sem dados pessoais) e a resposta ao gestor continua sendo a recusa original. A trava do salão nunca é mantida durante a gravação no armazenamento;
  - **remoção**: numa transação sob a trava do salão, apaga a linha e compacta as posições. **Depois do commit**, remove o objeto. Uma falha nessa remoção é registrada (`armazenamento.orfao`) e não desfaz nada: a foto continua removida, a resposta é de sucesso e a rota pública responde 404 para ela;
  - uma falha do armazenamento ao gravar (antes da transação) responde "Não foi possível salvar a foto agora. Tente de novo em instantes." (503 ou o PRG equivalente), sem linha no banco.
- **RN-17 — Envio por route handler, com e sem JavaScript** (decisão do líder; D-2, D-10, D-11):
  - o envio é um `POST` `multipart/form-data` com os campos `foto` (arquivo) e `alt` (texto) para um route handler. A rota fica fora do matcher do proxy (sugestão: `/api/painel/fotos`; o caminho exato é do arquivo `ROTAS`), para evitar o 307 que repetiria o POST em `/entrar` (`src/proxy.ts:24-25`);
  - autenticação, papel e capacidade passam pelo mesmo núcleo de `defineAcao` (`executar` com a credencial do cookie), para que a ação conste no teste de registro (CA-13 da D-020);
  - **proteção contra CSRF**: o handler exige o cabeçalho `Origin` igual à origem de `APP_URL`. `Origin` ausente, `null` ou diferente → 403, sem ler o arquivo e sem escrita. Isso se soma ao cookie `SameSite=Lax`;
  - **sem JavaScript** (formulário nativo `<form method="post" enctype="multipart/form-data">`): o handler sempre responde **303** para `/painel/configuracoes/fotos?envio=<codigo>`. O código vem de uma lista fechada (`ok`, `tamanho`, `tipo`, `ilegivel`, `resolucao`, `limite`, `alt_vazio`, `alt_longo`, `sem_arquivo`, `falha`, `negado`). Valores fora da lista são ignorados pela página, que traduz o código na mensagem pt-BR e a anuncia (região viva e foco). Sem sessão, o 303 vai para `/entrar?proximo=` + a página de fotos, codificada;
  - **com JavaScript**: a mesma rota e o mesmo formulário; o envio por `fetch` é uma melhoria opcional. Se for feita, preserva o texto alternativo digitado em caso de erro. O comportamento do servidor é o mesmo.
- **RN-18 — Idempotência e duplo envio** (D-11):
  - **envio**: a página gera, a cada renderização, um token de envio (hidden `envio`, UUID), gravado na linha como `(salao_id, envio)` único. Um segundo POST com o mesmo token (clique duplo, reenvio do navegador) não cria outra foto: responde como sucesso (`ok`) e não grava outro objeto, ou remove o que gravou, pela compensação da RN-16. A unicidade garantida pelo banco decide a corrida. Um POST sem token, ou com token malformado, é recusado como `falha`;
  - **remoção**: remover uma foto que já não existe responde `NaoEncontrado` ("A foto não foi encontrada; ela pode já ter sido removida."), sem escrita e sem chamar o armazenamento. Assim, o duplo clique é seguro;
  - **reordenação**: a posição esperada (RN-11) torna o segundo clique idêntico um no-op com aviso;
  - **texto alternativo**: gravar o mesmo valor não escreve (RN-12).

### Ambiente e infraestrutura

- **RN-19 — Variáveis** (decisão do líder; D-007; D-13):
  - `STORAGE_ADAPTER`: `simulado` | `real`, padrão `simulado`, como os outros seletores (vazio = ausente; outro valor falha nomeando a variável). Entra em `Seletor`, `MODULOS`, `modosAtivos` e no check-env (`armazenamento=<modo>` na linha de modos);
  - `ARMAZENAMENTO_DIR`: só no modo simulado. Opcional, com padrão `.armazenamento` (relativo ao diretório de trabalho; entra no `.gitignore`). No compose, aponta para o volume. Ignorada no modo real;
  - modo `real`: exige `S3_ENDPOINT` (URL `http`/`https`), `S3_REGIAO`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` (não vazias). `S3_URL_PUBLICA` é opcional; se presente, tem de ser uma URL `https` (ou `http` com host `localhost`) sem barra final obrigatória. Faltando ou inválidas, o check-env falha nomeando **todas** elas, ordenadas, sem valores (`validarEnv`, `src/server/env.ts:153-178`). Todas as chaves entram em `.env.example` e em `chavesDeclaradas()`;
  - o adaptador real **não é declarado validado** sem credenciais reais. Os testes usam um cliente S3 injetado ou um servidor S3 falso local, nunca a rede.
- **RN-20 — Docker** (§8.3; D-012): `sharp` e `@aws-sdk/client-s3` entram em `dependencies` com versão exata (`.npmrc` `save-exact`). O `sharp` vira dependência direta, não mais só a opcional do Next. A imagem final carrega o binário nativo do `sharp` para a plataforma dela. O serviço `app` monta um volume nomeado em `ARMAZENAMENTO_DIR`, gravável pelo usuário `node`. O worker não precisa do volume nesta demanda. O smoke (`docker/smoke.sh`) passa a provar, sem banco de fotos pré-existente, que o `sharp` carrega na imagem (por exemplo, um caminho de verificação ou o processamento de uma imagem mínima) e que `ARMAZENAMENTO_DIR` é gravável.

### Interface

- **RN-21 — Tela** (`CLAUDE.md`, "UI conventions"; D-009; padrões D-013..D-020):
  - `/painel/configuracoes` ganha o link "Fotos do salão" (com ajuda: "Até 12 fotos exibidas na página pública."). O item "Configurações" da navegação continua ativo na subpágina;
  - `/painel/configuracoes/fotos` mostra o contador "N de 12 fotos" e o formulário de envio: `<input type="file" accept="image/jpeg,image/png,image/webp">` (o `accept` é só conveniência) e o texto alternativo com `maxlength="150"`, rótulo e ajuda explicando para que serve. Quando houver 12 fotos, o formulário é substituído pelo aviso do limite. A página também avisa que as fotos ficam públicas e que os metadados (inclusive a localização) são removidos;
  - a lista das fotos, na ordem, mostra para cada uma a miniatura (`<img>` com o próprio `alt`, `width`/`height` gravados), a posição, o formulário de edição do texto alternativo, os botões "Mover para cima" e "Mover para baixo" (ausentes ou desabilitados nas pontas) e o botão "Remover" com confirmação sem diálogo (padrão D-014/D-016), com nomes acessíveis que identificam a foto ("Remover a foto 3");
  - todos os formulários funcionam sem JavaScript: o envio pela RN-17 e as ações por formulários de ação de servidor, com PRG ou estado de ação (padrão D-016). Os erros ficam associados aos campos (`aria-describedby`), o resultado é anunciado e focado, tudo é utilizável só com o teclado, há zero violações axe 4.14.0 e nenhuma rolagem horizontal em 375×812. As cores vêm só de tokens e os caminhos só de `ROTAS`;
  - a vitrine `/dev/fotos` (404 a menos que `VITRINE_COMPONENTES=true` ou `next dev`) renderiza os mesmos componentes com fotos de exemplo, e o envio vai para um handler de vitrine que só valida e processa em memória (RN-4..RN-9) e responde com o mesmo 303 (D-10).

## 5. Critérios de aceitação

Integração = Vitest com PostgreSQL real, as fábricas de dois salões (`tests/support/`) e o armazenamento simulado num diretório temporário por arquivo de teste (ou o real com cliente injetado, quando indicado). "Recusado" quer dizer: código ou mensagem pt-BR da RN correspondente, nenhuma linha nova ou alterada em `salao_foto` e `salao` (inclusive `atualizado_em`) e **nenhum arquivo novo** em `ARMAZENAMENTO_DIR` (contagem de arquivos antes e depois). As imagens de teste são geradas nos próprios testes com `sharp` (inclusive com EXIF/GPS e orientação), sem binários opacos versionados, a menos que o arquiteto decida por fixtures pequenas. Correspondência no `PLAN.md`: critério 1 (isolamento) e critério 11 (perfil completo na página pública, parte das fotos).

- **CA-1** (issue CA-1; RN-5, RN-7, RN-8, RN-15): Dado o gestor de S1 e, em casos separados, um JPEG 4000×3000 com EXIF (incluindo GPS) e orientação 6, um PNG com transparência e um WebP 800×600, cada um com até 5 MB e um texto alternativo válido, quando os envia, então cada envio resulta em sucesso e em uma linha em `salao_foto`, na posição seguinte. O objeto gravado é WebP (bytes iniciais `RIFF…WEBP`), com maior lado ≤ 1600 (o JPEG sai 1600×1200 depois de rotacionado, ou seja, **1200×1600**), sem EXIF, XMP nem ICC (`sharp(saida).metadata()` sem `exif`, `xmp` nem `icc`; os bytes de saída não contêm a string `Exif`), com a transparência preservada no PNG e sem ampliação no WebP (continua 800×600). `largura`, `altura` e `bytes` da linha batem com a saída. A chave casa com `^fotos/[A-Za-z0-9_-]{22,}\.webp$` e não contém o nome do arquivo nem o id do salão. A leitura pública devolve as três na ordem de envio. Unidade (processamento e detecção) + integração.
- **CA-2** (issue CA-2; RN-4..RN-6, RN-9, RN-10): Dado o gestor de S1, quando envia cada um dos casos abaixo, então é recusado (com a mensagem da RN) e nada é gravado, nem no banco nem no armazenamento:
  - arquivo de 5.242.881 bytes (e o de 5.242.880 bytes, válido, é aceito);
  - `Content-Length` declarado de 50 MB (a recusa acontece sem ler o corpo; o teste confere que a resposta chega antes de o cliente terminar de enviar, ou que o handler não consome mais que o limite);
  - um PDF, um GIF, um SVG e um texto, cada um com o nome `foto.jpg` e `Content-Type: image/jpeg`;
  - um JPEG truncado na metade e um arquivo com cabeçalho PNG seguido de lixo;
  - uma imagem de 10000×10000 (100 MP);
  - texto alternativo vazio, só com espaços, com 151 caracteres e com quebra de linha (e o de 150 é aceito);
  - campo `foto` ausente ou com 0 bytes;
  - a 13ª foto, com 12 já gravadas: recusada **sem nenhuma chamada de gravação ao armazenamento** (espião no adaptador ou contagem de arquivos).

  Unidade (detecção, limites e texto) + integração (um caso por linha pelo handler).
- **CA-3** (issue CA-3; RN-10, RN-16): Dado S1 com 11 fotos, quando dois envios válidos e diferentes são processados em paralelo (`Promise.all`, laço ×10 com o banco recriado a cada rodada), então exatamente um é aceito e o outro é recusado pelo limite. S1 termina com 12 linhas, nas posições 1..12 sem repetição, e com exatamente 12 objetos no armazenamento (o objeto do perdedor foi compensado). Nenhum termina com 5xx ou impasse. Também: dado S1 com 11 fotos e S2 com 11, envios simultâneos em S1 e S2 são ambos aceitos (a trava é por salão). Integração.
- **CA-4** (issue CA-4; RN-1, RN-2): Dado uma foto F2 de S2, quando o gestor de S1 tenta remover F2, editar o texto de F2 ou movê-la, então recebe `NaoEncontrado` (404) e F2, a ordem de S2 e o objeto de F2 ficam idênticos, sem chamada ao armazenamento. Um `salaoId` de S2 forjado no envio de S1 é ignorado: a foto entra em S1. Dado um profissional de S1, então a página `/painel/configuracoes/fotos` mostra "Acesso negado", o envio responde 403 (sem JS: 303 com `envio=negado`) e as ações devolvem `AcessoNegado`, sem escrita e sem gravação no armazenamento. Sem sessão, a página redireciona para `/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Ffotos` e o envio responde 303 para o mesmo destino, sem ler o arquivo. O gestor com perfil de profissional tem acesso. Integração.
- **CA-5** (issue CA-5; RN-19): Dado `STORAGE_ADAPTER=real` sem nenhuma `S3_*`, quando o check-env roda, então sai com código 1 e a mensagem nomeia `S3_ACCESS_KEY_ID, S3_BUCKET, S3_ENDPOINT, S3_REGIAO, S3_SECRET_ACCESS_KEY` (ordenadas), sem `S3_URL_PUBLICA` e sem valores. Faltando só uma, só ela é nomeada. `S3_ENDPOINT=ftp://x` ou `S3_URL_PUBLICA=nao-e-url` também são nomeadas. `STORAGE_ADAPTER=REAL` nomeia `STORAGE_ADAPTER`. Com `simulado` (ou ausente), as `S3_*` são ignoradas e a linha de sucesso traz `armazenamento=simulado`. O teste do `.env.example` (`chavesDeclaradas`) continua verde com as chaves novas. Unidade.
- **CA-6** (issue CA-6; RN-16): Dado S1 com 3 fotos (posições 1, 2 e 3), quando o gestor remove a da posição 2, então a linha some, as outras ficam nas posições 1 e 2 (na ordem relativa anterior), o objeto é removido do armazenamento **depois do commit** (o teste confere que, no momento da chamada `remover` do adaptador, a linha já não é visível numa conexão separada) e a rota pública da foto removida responde 404. Dado um adaptador cuja `remover` lança erro, quando o gestor remove uma foto, então a resposta é de sucesso, a linha continua removida, as posições compactadas, o log tem `armazenamento.orfao` com a chave (sem nome, telefone nem e-mail) e a rota pública responde 404. Integração.
- **CA-7** (RN-9, RN-12): Dado uma foto de S1, quando o gestor edita o texto alternativo para um valor válido, então só `alt` muda (chave, posição, dimensões e objeto ficam iguais) e a leitura pública devolve o novo texto. Gravar o mesmo texto não altera a linha (`xmin` igual). Texto vazio, com 151 caracteres ou com caractere de controle é recusado sem escrita. `"  Fachada   do  salão "` é gravado como `"Fachada do salão"`. Unidade + integração.
- **CA-8** (RN-11): Dado S1 com as fotos A, B e C (posições 1, 2 e 3), quando o gestor move C para cima com posição esperada 3, então a ordem fica A, C, B. Mover A para cima, ou C (agora na 2) para cima com posição esperada 3, é recusado sem escrita, com a mensagem da RN-11. Dado duas reordenações concorrentes da mesma foto com a mesma posição esperada (`Promise.all`, laço ×10), então exatamente uma é aplicada, as posições continuam contíguas e sem repetição, e nenhuma termina com 5xx ou impasse. Dado reordenação × remoção × envio em paralelo no mesmo salão, então o estado final tem posições `1..n` contíguas. Integração.
- **CA-9** (RN-14): Dado uma foto de S1, quando se faz `GET` na URL devolvida pela leitura pública (modo simulado), sem sessão, então a resposta é 200 com `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=3600` e um `ETag`; os bytes são os do objeto; `If-None-Match` com o mesmo ETag dá 304. `GET` com id inexistente, malformado (`..%2F..%2Fetc%2Fpasswd`, `abc`), de foto removida ou de uma chave em vez do id dá 404. `GET /api/fotos` e `GET /api/fotos/` não listam nada (404 ou 405). Com `suspenso_manual_em` preenchido em S1, a foto continua sendo servida. Integração (route handler chamado diretamente) + unidade (adaptador simulado recusando chaves fora do formato).
- **CA-10** (RN-15): Dado S1 com 3 fotos e S2 com 1, então a leitura pública de S1 devolve exatamente 3 itens na ordem das posições, cada um com exatamente as chaves `id`, `url`, `alt`, `largura` e `altura` (teste que compara o conjunto de chaves), e nenhum item de S2. Um salão sem fotos devolve `[]`. Com `STORAGE_ADAPTER=real` e `S3_URL_PUBLICA=https://cdn.exemplo.test` (cliente injetado), a `url` é `https://cdn.exemplo.test/fotos/<…>.webp`; sem ela, `url` é a rota da app. Integração.
- **CA-11** (RN-13, RN-19; adaptador real sem rede): com um cliente S3 injetado (ou um servidor S3 falso em `127.0.0.1`), o adaptador real envia `PutObject` com o bucket configurado, a chave recebida e `ContentType: image/webp`, sem ACL pública. `GetObject` de chave inexistente (`NoSuchKey`) vira "não encontrado". `DeleteObject` de chave inexistente não é erro. Uma falha de rede vira erro tratável pelo serviço (RN-16). Nenhum teste acessa a internet: o teste falha se houver tentativa de resolver um host externo. O adaptador simulado passa pelo mesmo conjunto de testes de contrato da porta. Unidade/integração.
- **CA-12** (RN-17): Dado um POST de envio válido com `Origin: https://atacante.test`, `Origin: null` ou sem `Origin`, então a resposta é 403, nada é lido além dos cabeçalhos e nada é gravado. Com `Origin` igual a `APP_URL`, o envio segue normalmente. Sem JavaScript, cada código de `envio=` da RN-17 resulta na mensagem pt-BR correspondente na página, e um `envio=<valor desconhecido>` não exibe nada nem quebra a página. Integração (handler) + unidade (tradução dos códigos).
- **CA-13** (RN-18): Dado um envio válido aceito com o token `envio=T`, quando o mesmo POST (mesmo token, mesmo arquivo) é repetido, em série e em paralelo (`Promise.all` ×2, laço ×10), então existe exatamente uma linha com esse token. A segunda resposta é sucesso (`ok`) e o armazenamento termina com exatamente um objeto para esse envio (o do perdedor compensado). Um POST sem `envio` ou com valor não UUID é recusado sem escrita. Remover duas vezes a mesma foto: a primeira remove e a segunda devolve `NaoEncontrado`, sem chamar o armazenamento. Integração.
- **CA-14** (RN-1, RN-3, RN-17): as ações exportadas pelo novo `*.acao.ts` (envio, texto alternativo, reordenação e remoção) são produtos de `defineAcao` com `papeis: ['gestor']` e `capacidade: 'configurar'`, verificado pelo teste de registro de ações. O route handler de envio chama o `executar` da ação de envio, sem reimplementar sessão, papel ou capacidade. Unidade/integração.
- **CA-15** (RN-21; E2E Playwright, viewport 375×812, na vitrine `/dev/fotos`): só com o teclado (Tab, Shift+Tab, Enter, Espaço; foco visível), o usuário escolhe um arquivo (`setInputFiles` no campo focado), preenche o texto alternativo e envia. Depois do 303, vê o sucesso anunciado e focado. Ao enviar um arquivo de texto com o nome `.jpg`, vê a mensagem de tipo; sem texto alternativo, vê a mensagem do texto. Usa "Mover para cima/baixo" e "Remover" pelo teclado, com nomes acessíveis que identificam a foto. As telas inicial, com erro, com sucesso e com 12 fotos (formulário substituído pelo aviso) têm zero violações axe 4.14.0 e nenhuma rolagem horizontal. Com JavaScript desligado, o envio multipart nativo funciona (sucesso e um erro), assim como mover e remover. E2E.
- **CA-16** (RN-21; navegação): Dado o gestor em `/painel/configuracoes`, então há o link "Fotos do salão". Em `/painel/configuracoes/fotos`, o item "Configurações" está marcado como atual. As rotas novas vêm de `ROTAS` e `SEGMENTOS_RESERVADOS` não muda (primeiros segmentos `painel`, `api` e `dev`, já reservados). O contador mostra "3 de 12 fotos" com 3 fotos. Unidade (navegação) + integração (página).
- **CA-17** (RN-20; Docker): `sh docker/smoke.sh` passa: a imagem sobe com `STORAGE_ADAPTER=simulado`, o `sharp` carrega dentro do container (sem erro de binário nativo) e `ARMAZENAMENTO_DIR` é gravável pelo usuário `node`. Depois de `docker compose down` (sem `-v`) e `up`, um objeto gravado antes continua lá (volume nomeado). `package.json` tem `sharp` e `@aws-sdk/client-s3` com versão exata e o `npm ci` funciona sem `--force` (se algum pacote tiver script de instalação, ele é aprovado em `allowScripts`). Job `docker` da CI + verificação manual objetiva da persistência.
- **CA-18** (RN-6, RN-16; robustez): Dado o adaptador cuja `gravar` lança erro, quando o gestor envia uma foto válida, então a resposta é a mensagem de falha da RN-16 (sem JS: `envio=falha`), não há linha em `salao_foto` e nenhum 5xx vaza com detalhes internos. Dado uma imagem que faz o `sharp` lançar erro inesperado, então a resposta é `ilegivel`, sem escrita. Os logs do envio têm só ids, códigos e tamanhos, nunca o texto alternativo, o nome original do arquivo ou os bytes. Integração.

## 6. Casos limite

- **Orientação EXIF**: a foto vertical tirada no celular chega com pixels "deitados" e orientação 6/8. Ela precisa ser rotacionada antes de descartar o EXIF (RN-7, CA-1), senão aparece deitada na página.
- **Perfil de cor**: JPEG CMYK ou com perfil ICC amplo (Display P3) é convertido para sRGB antes de descartar o ICC, para não mudar as cores de forma perceptível.
- **Animação**: GIF é recusado (RN-5). WebP ou PNG animado vira estático com o primeiro quadro (RN-7).
- **Imagem minúscula** (1×1) ou muito alongada (5000×10): aceita e nunca ampliada. O maior lado vai a no máximo 1600.
- **Bomba de descompressão**: um PNG pequeno em bytes com 100 MP é recusado pelo `limitInputPixels` (RN-6, CA-2).
- **Nome de arquivo**: nomes com acento, `../`, vazio ou muito longo são irrelevantes, porque o nome nunca é usado (RN-8).
- **Multipart malformado**: corpo que não é multipart, campo `foto` repetido (só o primeiro conta; ou recusa, a critério do arquiteto, sem 5xx), campos extras (ignorados) e `alt` repetido não geram 5xx.
- **Concorrência**: limite de 12 (CA-3), duplo envio (CA-13), reordenação concorrente e reordenação × remoção × envio (CA-8). Envio × gravações de perfil, funcionamento, regras e slug no mesmo salão serializam na trava da linha de `salao`, sem impasse. Inserções de reserva e bloqueio não são bloqueadas (só tomam `FOR KEY SHARE`).
- **Isolamento entre salões**: CA-4 e CA-10. A rota pública por `fotoId` não precisa do slug: o id é global e a foto é pública. Ela não revela a qual salão a foto pertence além do que a página pública já mostra.
- **Salão suspenso**: as fotos continuam visíveis (`PLAN.md:81`; CA-9). A escrita fica liberada até a E6.4 (RN-3).
- **Salão pendente ou sem assinatura**: igual ao suspenso, para a leitura.
- **Cliente anonimizada**: não se aplica, porque a demanda não lê nem altera clientes.
- **Telefone não brasileiro e outras entradas do perfil**: não se aplicam.
- **Fuso e virada de dia**: não se aplicam. `criado_em` é UTC e só serve para auditoria e ordenação técnica.
- **Falhas do armazenamento**: falha ao gravar (CA-18), falha ao remover depois do commit (CA-6), falha na compensação (RN-16, log `armazenamento.orfao`) e objeto ausente para uma linha existente (a rota pública responde 404, registra `armazenamento.objeto_ausente` e a página do gestor mostra a foto como indisponível, permitindo removê-la).
- **Disco cheio no simulado**: tratado como falha ao gravar (CA-18).
- **Cache depois da remoção**: com `max-age=3600`, navegadores e proxies podem exibir a foto removida por até 1 hora. Com `S3_URL_PUBLICA` e CDN, o prazo depende da CDN (D-1). O README avisa o operador.
- **Privacidade (LGPD)**: as fotos podem mostrar pessoas. A tela avisa que são públicas e que a localização e os metadados são removidos (RN-21). O EXIF/GPS nunca chega ao armazenamento (RN-7). Os logs não têm o texto alternativo nem o nome do arquivo (CA-18).
- **Permissões**: CA-4 e CA-14. Um profissional com perfil inativo cai no 401 de `resolverTenant` (D-010).
- **Dados legados**: salões existentes começam com zero fotos. A migração não move nem cria dados.

## 7. Dependências

- **Demandas:** E2.6/D-020 (PR #80, sem merge; esta demanda parte da branch dela: `/painel/configuracoes` com links, `lerPerfilPublico` e o padrão da trava do salão) e E0.6/D-007 (registro de adaptadores e check-env), concluída. Bloqueia a E4.1 (#37, D-026), que exibe as fotos com a leitura da RN-15.
- **Obrigações para a E4.1**: usar a leitura da RN-15 (nunca montar URLs à mão), exibir `alt`, `width` e `height`, e manter as fotos visíveis com o salão suspenso. Se usar `next/image`, conferir a configuração de domínios remotos quando `S3_URL_PUBLICA` estiver definida.
- **Obrigações para a E6.4**: incluir as quatro operações de fotos no bloqueio da capacidade `configurar` com o salão suspenso. A rota pública continua liberada.
- **Integrações:** nova integração de armazenamento (simulado + compatível com S3). Mercado Pago, WhatsApp, e-mail e Turnstile não são usados.
- **Credenciais externas (para validar o modo real, fora do gate desta demanda)**: um bucket compatível com S3 (AWS S3, Cloudflare R2, MinIO etc.), com endpoint, região, nome do bucket, chave de acesso com permissão só de `PutObject`/`GetObject`/`DeleteObject` nesse bucket e, se for o caso, a URL pública ou da CDN sem listagem. Vão para o README, seção "Credenciais para os serviços reais". Sem elas, o adaptador real fica coberto só pelos testes de contrato (CA-11) e **não é declarado validado**.
- **Dados:** nenhum dado de outra demanda.

## 8. Impactos prováveis

- **Dados (DBA, obrigatório):** migração **só aditiva**:
  - tabela `salao_foto(id uuid PK, salao_id uuid NOT NULL FK salao ON DELETE RESTRICT, chave text NOT NULL UNIQUE, alt text NOT NULL, ordem/posicao int NOT NULL, largura int NOT NULL, altura int NOT NULL, bytes int NOT NULL, envio uuid NOT NULL, criado_em timestamptz NOT NULL DEFAULT now())`, como em §8.1 de `trinks-alinhamento.md` (as colunas `envio` e as unicidades vêm da RN-18 e da RN-11);
  - `UNIQUE (salao_id, envio)` para a idempotência (RN-18). Índice `(salao_id, posicao)`;
  - CHECKs de defesa a decidir com o DBA: `posicao BETWEEN 1 AND 12`, `largura`/`altura` entre 1 e 1600, `bytes > 0`, `char_length(alt) BETWEEN 1 AND 150` e o formato da chave;
  - a unicidade de `(salao_id, posicao)` exige uma constraint `DEFERRABLE INITIALLY DEFERRED` ou uma estratégia de troca de posições que nunca colida (o DBA decide). O limite de 12 continua garantido pela trava, não por CHECK, porque contagem entre linhas não é expressável em CHECK;
  - ordem de travas: `salao FOR NO KEY UPDATE` → `salao_foto` (atualizar o cabeçalho de `src/server/repos/servico.ts`, se o arquiteto julgar que a ordem canônica deve citar `salao_foto`).
- **Infraestrutura/CI (DevOps, obrigatório):**
  - `package.json`/lock: `sharp` como dependência direta e `@aws-sdk/client-s3`, com versões exatas. Conferir os binários opcionais `@img/sharp-*` para `linux-x64` (CI e imagem) e a política `allowScripts`;
  - `Dockerfile`: o binário nativo do `sharp` na imagem final (glibc do `node:24-trixie-slim`) e o diretório de `ARMAZENAMENTO_DIR` criado com dono `node`;
  - `docker-compose.yml`: volume nomeado (por exemplo `armazenamento`) montado no `app`, com `ARMAZENAMENTO_DIR` apontando para ele;
  - `docker/smoke.sh`: as provas da RN-20 e da CA-17;
  - `.env.example`, `env.ts`, check-env e README (variáveis, credenciais reais e aviso de bucket sem listagem e de cache). `.gitignore`: `.armazenamento/`;
  - CI: os jobs `testes` e `e2e` precisam do `sharp` funcional no runner (o `npm ci` já instala os binários). O job `e2e` não tem banco: a vitrine `/dev/fotos` cobre o E2E (D-10). Os testes de integração precisam de um `ARMAZENAMENTO_DIR` temporário por worker/arquivo.
  - Next: se a rota de envio ficar sob o matcher do proxy, o `proxyClientMaxBodySize` (10 MB por padrão) entra em jogo. A sugestão (RN-17) é deixá-la fora.
- **Lint:** estender a RN-16 (`eslint.config.mjs`) para `@aws-sdk/*` e `sharp` (D-8) e incluir `armazenamento/(real|simulado)` (já coberto pelo padrão genérico `integrations/[^/]+/(real|simulado)`).
- **Permissões:** nenhuma operação nova (usa `salao.configurar`).
- **Navegação:** novas chaves em `ROTAS` (por exemplo `configuracoesFotos`, `devFotos`, `fotoPublica(id)` e a rota de envio). `SEGMENTOS_RESERVADOS` não muda.
- **Segurança:** a primeira mutação por route handler do projeto. A checagem de `Origin` (RN-17) é obrigatória, porque o Next só faz essa checagem automaticamente em Server Actions.
- **README/CLAUDE.md:** as linhas novas de comandos (estabilidade das fotos, E2E das fotos) e o resumo da D-021 no `CLAUDE.md`, seguindo o padrão.

## 9. Dúvidas

### Bloqueantes

Nenhuma.

### Não bloqueantes (suposições adotadas)

| ID | Decisão | Motivo |
|---|---|---|
| D-1 | **Entrega pública**: rota da app `GET /api/fotos/<fotoId>`, que resolve o id no banco e lê pelo adaptador, com `Cache-Control: public, max-age=3600`, `ETag` e `nosniff`. É sempre disponível e é a URL padrão. Com `STORAGE_ADAPTER=real` **e** `S3_URL_PUBLICA` definida, a leitura pública devolve a URL do bucket/CDN (opção do operador, que garante a ausência de listagem). | Funciona igual nos modos simulado e real, sem exigir bucket público. A remoção vale na hora (404 pela ausência da linha), mesmo que a limpeza do objeto falhe. A listagem é impossível por construção (a rota recebe id, não chave). `api` já é segmento reservado. `max-age` curto limita a exposição de uma foto removida. O id do objeto é imutável, então o `ETag` é estável. |
| D-2 | **Ordem de gravação no envio**: processar em memória → checagem prévia do limite → gravar o objeto → transação (trava, limite, idempotência, insert) → em caso de recusa, compensar removendo o objeto. Nunca segurar a trava do salão durante a E/S do armazenamento. | Segurar a trava durante um PutObject bloquearia perfil, regras e slug por segundos. A checagem prévia garante o "nada gravado" do caso sequencial (CA-2). A compensação garante a CA-3. O risco residual (falha da compensação) fica em log. |
| D-3 | 5 MB = 5.242.880 bytes (MiB) para o arquivo. O corpo inteiro pode ter uma folga fixa (sugestão: +64 KiB) para os cabeçalhos do multipart e o texto alternativo. | A issue diz "5 MB" sem unidade. Usar MiB é o mais permissivo para o gestor e o mais comum na interface. A folga evita recusar um arquivo de exatamente 5 MB por causa do envelope multipart. |
| D-4 | Limite de entrada de 50 MP, qualidade WebP fixa (≈ 82), orientação aplicada, sRGB, primeiro quadro de animações, sem tamanho mínimo e sem ampliação. | Câmeras de celular chegam a 48–50 MP. 50 MP cobre esses casos e barra bombas. Os demais itens são o mínimo para a foto aparecer correta e sem metadados. |
| D-5 | A chave é `fotos/<≥128 bits aleatórios em base64url>.webp`, sem id de salão. | Não expõe o UUID do salão numa URL pública do bucket (D-1, `S3_URL_PUBLICA`) e não permite enumerar. O vínculo com o salão fica no banco. |
| D-6 | O texto alternativo é obrigatório, de 1 a 150 unidades UTF-16, numa linha e normalizado como `normalizarNome`. | É o que a issue pede ("obrigatório, ≤ 150"). Uma linha só basta para um texto alternativo e evita quebras no `alt`. |
| D-7 | A reordenação é feita com "Mover para cima/baixo" e uma posição esperada, em vez de arrastar e soltar ou de enviar a lista inteira. | Funciona sem JS e só com o teclado. A posição esperada dá idempotência e detecta a concorrência. Arrastar e soltar acessível exigiria JS e alternativa de teclado de qualquer forma. |
| D-8 | `sharp` só num módulo de processamento de imagem (sugestão: `src/server/imagem/`), e `@aws-sdk/*` só em `src/server/integrations/armazenamento/`, ambos barrados por lint fora deles. | O `sharp` não é um provedor externo (é biblioteca local), então não precisa de adaptador. Mas concentrar o uso permite trocar ou limitar a dependência e mantém a regra "SDK de provedor só nas integrações" para a AWS. |
| D-9 | Sem fila nem varredura de órfãos nesta demanda: a remoção do objeto depois do commit é síncrona e de melhor esforço, com o log `armazenamento.orfao`. | A issue pede só "após o commit, falha não desfaz". Uma reconciliação periódica (job do worker que lista objetos sem linha) exigiria listar o bucket e pode vir depois. O arquiteto pode optar por enfileirar a remoção no pg-boss (padrão "enfileirar depois do commit" da D-008), se julgar o custo baixo. |
| D-10 | E2E na vitrine `/dev/fotos`, com um handler de vitrine que valida e processa em memória (inclusive com `sharp`), não grava e responde com o mesmo 303. A integração com banco e armazenamento fica nos testes Vitest. | O job `e2e` não tem PostgreSQL (convenção das D-015..D-020). Processar de verdade na vitrine prova que o `sharp` funciona no build de produção e que o multipart sem JS funciona. |
| D-11 | **Upload sem JS**: formulário nativo `multipart/form-data` com POST para o route handler, que responde sempre 303 (PRG) para `/painel/configuracoes/fotos?envio=<código>` de uma lista fechada. A idempotência usa um token `envio` (UUID) por renderização, único por salão no banco. Sem JS, o texto alternativo digitado não é preservado em caso de erro. | O POST multipart nativo funciona em qualquer navegador sem JS. O PRG evita reenvio no F5 e reaproveita o padrão `?remocao=` da D-016. Códigos fechados evitam injetar texto pela URL. O token por renderização resolve o clique duplo sem deduplicar por conteúdo (o gestor pode, se quiser, enviar de novo a mesma foto num envio novo). Perder o texto sem JS é aceitável: são no máximo 150 caracteres e a mensagem explica o erro. |
| D-12 | Um arquivo por envio. Sem recorte, sem pré-visualização obrigatória e sem envio múltiplo. | Mantém o route handler simples e o limite de corpo claro. O envio múltiplo pode vir com a E4.1 ou depois. |
| D-13 | `ARMAZENAMENTO_DIR` é opcional, com padrão `.armazenamento`, e só é lida no modo simulado. `S3_ENDPOINT` é obrigatória no modo real (vale também para a AWS, com o endpoint regional). Sem variável de estilo de caminho: o arquiteto decide `forcePathStyle` (o recomendado é `true`, compatível com MinIO e R2), e, se a AWS exigir o estilo virtual, acrescenta uma variável opcional. | O líder listou as `S3_*` como obrigatórias, exceto a URL pública. O padrão do diretório permite `npm run dev` sem configuração, como os outros adaptadores simulados. |
| D-14 | A página do gestor mostra as miniaturas pela mesma rota pública (D-1). Não há rota privada separada. | As fotos são públicas por natureza. Uma única rota reduz superfície e código. |
| D-15 | Uma linha cujo objeto sumiu do armazenamento continua listada para o gestor como "indisponível", com a opção de remover. Na leitura pública, a rota responde 404 e a E4.1 pode ocultar a imagem quebrada. | Não se apaga dado do banco por causa de uma falha de leitura transitória do armazenamento. |
