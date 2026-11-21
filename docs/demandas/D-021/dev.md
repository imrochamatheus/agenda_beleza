# D-021 — Desenvolvimento: fotos do salão com armazenamento por adaptador (issue #76, E2.7)

Entradas: `spec.md`, `design.md`, `dba.md` (T-0, migração `20261121000000_salao_foto`, `schema.prisma`, `drift.test.ts`, `db/salao-foto.test.ts`) e `devops.md` (T-1, dependências exatas, Dockerfile, compose, smoke). Esses arquivos não foram editados aqui.

## 1. Tarefas concluídas e arquivos

| Tarefa | Arquivos |
|---|---|
| T-5 contratos, validação, multipart, rotas | `src/server/fotos/{tipos,validacao,multipart}.ts` e `{validacao,multipart}.test.ts`; `src/config/navegacao.ts` e `navegacao.test.ts` (`configuracoesFotos`, `envioFotos`, `fotoPublica(id)`, `devFotos`, `devFotosEnvio`; `SEGMENTOS_RESERVADOS` não mudou) |
| T-2 porta e adaptadores | `src/server/integrations/armazenamento/{ambiente,chave,port,simulado,real,contrato}.ts` e os `*.test.ts`; `tests/integration/armazenamento/real-s3-falso.test.ts` |
| T-4 imagem | `src/server/imagem/{detectar,processar}.ts` e `*.test.ts`; `tests/support/imagens.ts` |
| T-3 ambiente, registro, lint | `src/server/env.ts` (+ teste), `check-env.ts` (+ testes, inclusive `src/scripts/check-env.test.ts`), `integrations/registry.ts` (+ teste), `src/worker/iniciar.test.ts` (modos), `.env.example`, `eslint.config.mjs`, `tests/integration/integracoes/registro.test.ts`, `tests/integration/lint/importacao-imagem-armazenamento.test.ts` |
| T-6 repositórios | `src/server/repos/{foto,foto-publica,publico,index,servico}.ts` (`servico.ts` só comentário), `repos/index.test.ts`; `tests/integration/fotos/{apoio,repos-fotos.test}.ts` |
| T-7 serviço, ações, entrega, envio HTTP | `src/server/fotos/{servico,leitura,entrega,envio-http,fotos.acao}.ts`; `tests/integration/fotos/{apoio-servico,envio,envio-recusas,origem,idempotencia,remocao,ordem,edicao-alt,entrega,leitura-publica,isolamento,falhas}` |
| T-8 concorrência | `tests/integration/fotos/concorrencia.test.ts` |
| T-9 componentes | `src/app/painel/configuracoes/fotos/{estado.ts,Resultado.tsx,FormularioEnvio.tsx,ListaFotos.tsx,Fotos.module.css}` e `{FormularioEnvio,ListaFotos}.test.tsx` |
| T-10 páginas e rotas | `src/app/painel/configuracoes/fotos/{page.tsx,acoes.ts}`, `configuracoes/page.tsx` (link), `src/app/api/painel/fotos/route.ts`, `src/app/api/fotos/[id]/route.ts`, `tests/integration/fotos/paginas.test.ts` |
| T-11 vitrine e E2E | `src/app/dev/fotos/{page.tsx,acoes.ts,demonstracao.ts,enviar/route.ts}` e testes, `public/dev-fotos/exemplo.svg`, `e2e/{fotos,fotos-sem-js}.spec.ts`, `e2e/suporte/imagens.ts` |
| T-12 documentação | `README.md` (seção "Fotos do salão", tabela de adaptadores, credenciais S3, comandos), `CLAUDE.md` (status e duas linhas de comandos, a pedido do líder), este arquivo |

## 2. Comandos e resultados (2026-11-20/21, PostgreSQL do compose)

| Comando | Resultado |
|---|---|
| `npm run lint` | OK, 0 avisos |
| `npm run typecheck` | OK |
| `npm run build` e `npm run build:node` | OK (`/painel/configuracoes/fotos`, `/dev/fotos` e as rotas de API listadas) |
| `npm run test:coverage` | **262 arquivos, 3.341 testes, todos verdes.** Linhas **99,88%**, statements 99,42%, branches 98,09%, funções 99,46% (limiar 90%) |
| `npx playwright test` (todos os E2E, build prévio) | **93 passed** (16 novos de fotos) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/fotos/concorrencia.test.ts \|\| break; done` | **10/10 verdes** (6 testes por rodada; sem 5xx, impasse ou 23505) |
| `sh docker/smoke.sh` | **OK** (`/api/health` 200; `referrer-policy`; `sharp` converte para WebP; `ARMAZENAMENTO_DIR` gravável) |
| Passo manual com o compose | `GET /api/fotos` 404, `/api/fotos/abc` 404, `GET /api/painel/fotos` 405, `POST` sem `Origin` 403, `POST` com `Origin` e sem sessão 303 para `/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Ffotos`. Depois `docker compose stop app worker` (só o postgres no ar) |

## 3. Testes e os CAs que cobrem

| CA | Testes |
|---|---|
| CA-1 | `imagem/processar.test.ts` (1200×1600, sem EXIF/XMP/ICC, alfa, sem ampliar, primeiro quadro, Display-P3/CMYK); `fotos/envio.test.ts` (linha, chave, objeto WebP, leitura pública na ordem) |
| CA-2 | `imagem/detectar.test.ts`, `fotos/{validacao,multipart}.test.ts`, `fotos/envio-recusas.test.ts` (cada caso: código, nenhuma linha, nenhum objeto, nenhuma chamada de gravação, `salao` idêntico) |
| CA-3 | `fotos/concorrencia.test.ts` (11 fotos, dois envios; S1 × S2; 16 em paralelo) |
| CA-4 | `fotos/isolamento.test.ts`, `fotos/repos-fotos.test.ts`, `fotos/paginas.test.ts` |
| CA-5 | `env.test.ts`, `check-env.test.ts`, `armazenamento/ambiente.test.ts`, `.env.example` (`chavesDeclaradas`) |
| CA-6 | `fotos/remocao.test.ts` (remoção após o commit, conferida em outra conexão; `remover` que lança) |
| CA-7 | `fotos/edicao-alt.test.ts` (`xmin`), `fotos/validacao.test.ts` |
| CA-8 | `fotos/ordem.test.ts`, `fotos/concorrencia.test.ts` |
| CA-9 | `fotos/entrega.test.ts`, `armazenamento/simulado.test.ts` + `contrato.ts` |
| CA-10 | `fotos/leitura-publica.test.ts` (conjunto exato de chaves; `S3_URL_PUBLICA`) |
| CA-11 | `armazenamento/real.test.ts` (cliente injetado), `tests/integration/armazenamento/real-s3-falso.test.ts` (servidor HTTP local; contrato compartilhado com o simulado) |
| CA-12 | `fotos/origem.test.ts`, `fotos/paginas.test.ts` (códigos na página) |
| CA-13 | `fotos/idempotencia.test.ts`, `fotos/concorrencia.test.ts` |
| CA-14 | `tenant/registro.test.ts` (glob `*.acao.ts`) e `fotos/origem.test.ts`/`paginas.test.ts` (a rota chama a ação) |
| CA-15 | `e2e/fotos.spec.ts`, `e2e/fotos-sem-js.spec.ts` |
| CA-16 | `navegacao.test.ts`, `fotos/paginas.test.ts` |
| CA-17 | `sh docker/smoke.sh`; persistência em `devops.md` |
| CA-18 | `fotos/falhas.test.ts` |

## 4. Desvios do desenho e decisões

1. `ResultadoEnvio.fotoId` é `string | null` (null no envio duplicado, que não relê a linha).
2. `CODIGOS_ACAO` (PRG `?acao=`) ficou: `alt_ok`, `movida`, `ordem_mudou`, `na_ponta`, `removida`, `alt_vazio`, `alt_longo`, `nao_encontrada`, `negado` (o desenho só citava `alt_invalido`).
3. **Nomes acessíveis:** o axe (regra `label-content-name-mismatch`) exige que o nome contenha o texto visível; ficaram "Mover para cima: foto N", "Mover para baixo: foto N", "Remover a foto N" e "Salvar descrição da foto N" (não "Mover a foto N para cima").
4. **Remover sem confirmação extra:** botão direto (padrão do `/painel/bloqueios`), um formulário por foto; o duplo clique é seguro (`NaoEncontrado`).
5. **Vitrine:** a origem esperada do envio de demonstração é "protocolo do `Origin` + `Host` da requisição", porque o Next monta `request.url` com o hostname de escuta (`localhost`) e não com o `Host` (o E2E usa `127.0.0.1`). Só vale na vitrine, que responde 404 desligada. A rota real usa `APP_URL`. A foto de exemplo é um arquivo estático (`public/dev-fotos/exemplo.svg`), porque o teste de conformidade proíbe literais de cor em `src/`.
6. `eslint.config.mjs`: `e2e/**` entrou em `TESTES` (o E2E gera imagens com o `sharp`); nada mais foi relaxado.
7. `tests/integration/lint/importacao-imagem-armazenamento.test.ts` (novo) prova o lint de `sharp` e `@aws-sdk` com a configuração real.
8. `servico.enviar`/`remover` aceitam `deps` (armazenamento, processar) para teste; a ação real usa `integracoes().armazenamento`. Os testes de integração apontam `ARMAZENAMENTO_DIR` para um diretório temporário por arquivo e espiam a porta memoizada.
9. `failOn: 'truncated'` bastou (o JPEG truncado do CA-2 falha); a escada para `'error'`/`'warning'` não foi necessária.

## 5. Riscos conhecidos e pendências

- **Adaptador S3 real não validado** contra provedor (R-11): só contrato com cliente injetado e servidor S3 falso local; o README diz isso.
- Objeto órfão se o processo morrer entre gravar e commitar (R-1), ou se a limpeza pós-remoção falhar: só log `armazenamento.orfao`; sem varredura (dívida do design §10).
- `Origin` × `APP_URL`: acessar por outro host (`127.0.0.1` × `localhost`) dá 403 com o texto explicativo (R-4); documentado no README.
- Cache de até 1 h para foto removida (R-7).
- O spec do teste de memória de 50 MP não foi medido (semáforo de 2 decodificações e `sharp.cache(false)` mitigam).
- Obrigações para E4.1 (usar `lerFotosPublicas`, tratar 404 de imagem) e E6.4 (bloquear as quatro ações com o salão suspenso) estão no design §10.
