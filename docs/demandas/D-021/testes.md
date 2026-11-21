# D-021 — Testes: fotos do salão com armazenamento por adaptador (issue #76, E2.7)

## Rodada 1 (2026-11-20) — veredito: **APROVADO**

### Ambiente

- Branch `feat/d-021-fotos`, árvore sem commit. Node 24 (`nvm use`), PostgreSQL do compose, adaptadores `simulado`, Chromium `mobile-chromium` (375×812). `npm run db:generate` antes de tudo.

### Gates (reexecutados pelo tester)

| Comando | Resultado |
|---|---|
| `npm run lint` | exit 0, 0 avisos |
| `npm run typecheck` | exit 0 |
| `npm run build` e `npm run build:node` | exit 0 |
| `npm run test:coverage` | exit 0. **262 arquivos, 3.341 testes verdes.** Linhas **99,88%**, statements 99,42%, branches 98,09%, funções 99,46% (limiar 90%) |
| `npm run test:e2e` (build + todos os specs) | exit 0, **93 passed** (inclui `fotos.spec.ts` e `fotos-sem-js.spec.ts`; axe 4.14.0 sem violações) |
| laço ×10 de `tests/integration/fotos/concorrencia.test.ts` | 10/10 com 6 testes verdes |
| `sh docker/smoke.sh` | `smoke: OK` (health 200, `referrer-policy`, `sharp` converte para WebP, `ARMAZENAMENTO_DIR` gravável) |
| check-env (`dist/scripts/check-env.js`) | `STORAGE_ADAPTER=real` sem `S3_*` nomeia `S3_ACCESS_KEY_ID, S3_BUCKET, S3_ENDPOINT, S3_REGIAO, S3_SECRET_ACCESS_KEY` (ordenadas, sem `S3_URL_PUBLICA`); `STORAGE_ADAPTER=REAL` nomeia `STORAGE_ADAPTER`; `S3_ENDPOINT=ftp://x` e `S3_URL_PUBLICA=nao-e-url` são nomeadas (`DATABASE_URL` aparece só porque o `node` direto não lê o `.env`) |
| `package.json` | `sharp` 0.35.5 e `@aws-sdk/client-s3` 3.1163.0, exatos, em `dependencies`, sem `^`/`~` |

Cobertura: nenhuma exclusão nova foi vista no `vitest.config.ts`; os testes novos de fotos verificam comportamento (linha, objeto, `xmin`, contagem de arquivos, ordem das posições).

### Exploratório independente (teste temporário, apagado ao final)

Escrito por mim em `tests/integration/fotos/` (removido), usando `tratarEnvio` + `enviarFoto.executar` com banco e armazenamento simulado reais. 22 de 23 casos passaram; a única falha foi um erro de ordenação no meu próprio `expect` (`sort()` com lista escrita fora de ordem), não do produto; o conteúdo das chaves `alt, altura, id, largura, url` estava correto.

- Recusados com 303 e o código esperado, sem linha no banco e sem objeto gravado: PDF, GIF, SVG e texto com nome `.jpg`; HEIC (`ftypheic`); JPEG, PNG e WebP com cabeçalho forjado e lixo (`ilegivel`); JPEG e PNG truncados (`ilegivel`); arquivo vazio (`sem_arquivo`); 5.242.881 bytes (`tamanho`); PNG 10000×10000 de poucos KB (`resolucao`); `alt` vazio, só espaços e com 151 caracteres; a 13ª foto (`limite`).
- Aceitos: `alt` com 150 caracteres e PNG 7000×7000 (49 MP), que sai com maior lado 1600.
- EXIF/GPS: JPEG 4000×3000 com GPS, Copyright e orientação 6 sai 1200×1600, WebP (`RIFF`), sem `exif`, `xmp` nem `icc` no `sharp.metadata()` e sem as strings `Exif`, `GPS`, `segredo-exif`, `xmp` nem `ICC_PROFILE` nos bytes; a chave casa com `^fotos/[A-Za-z0-9_-]{22,}\.webp$` e não contém o id do salão.
- Isolamento: com `salaoId` de S2 forjado no formulário, a foto entra em S1 e S2 fica com zero fotos. S1 remove, edita e move foto de S2 (com `salaoId` forjado): 404 nas três, e a fotografia de S2 (inclusive `xmin`) é idêntica.
- Perfis: profissional → 303 `envio=negado`; visitante → 303 para `/entrar?proximo=%2Fpainel%2Fconfiguracoes%2Ffotos`, nada gravado. `Origin` ausente, `null` e de outro host → 403.
- Duplo envio (mesmo token, 3 em paralelo): três respostas `ok`, uma linha, um objeto.
- Remoções concorrentes (duas da mesma foto mais outra): duas aplicadas, posições compactadas em `[1, 2]`; a entrega da removida responde 404.
- Reordenação: C para cima com posição esperada 3 resulta em A, C, B; a leitura pública vem na mesma ordem.
- Cobertos pela suíte do desenvolvedor (lidos, não repetidos por mim): ETag/304, `nosniff`, `GET /api/fotos` 404, salão suspenso servindo, remoção antes da limpeza do objeto e falha de `remover`, falha de `gravar`.
- A rota real (`src/app/api/painel/fotos/route.ts`) lê `APP_URL` e a ação roda sessão, papel e capacidade antes de ler o corpo; GET/PUT/etc. devolvem 405.

### CAs

CA-1 a CA-14 e CA-16 a CA-18: **passaram** (suíte de integração e unidade verdes; ver acima). CA-15 (E2E 375×812, teclado, sem JS, axe, sem rolagem horizontal): **passou** nos 93 E2E. CA-17: smoke OK e `package.json` exato; a persistência do volume depois de `down`/`up` foi demonstrada pelo DevOps em `devops.md` e **não repeti à mão**. CA-11: o adaptador S3 real passou só nos testes de contrato (cliente injetado e servidor S3 falso local). **O adaptador S3 real não está validado contra um provedor de verdade** (faltam credenciais), como a spec e o README dizem.

### Avaliação dos desvios (`dev.md` §4)

Os desvios 1 a 9 não contradizem a spec: nomes acessíveis ("Remover a foto N") identificam a foto como o CA-15 pede; remoção sem confirmação extra é segura pelo `NaoEncontrado` da RN-18; a origem da vitrine afeta só `/dev/fotos`, e a rota real usa `APP_URL`; `e2e/**` em `TESTES` no ESLint é o menor relaxamento possível.

### Defeitos

Nenhum aberto. Observações sem severidade (não bloqueiam): o teste de memória de 50 MP não foi medido pelo desenvolvedor, mas o caso de 49 MP passou no meu teste; acessar o painel por outro host que não o de `APP_URL` dá 403 no envio (documentado, R-4); órfãos de objeto só vão para log (dívida do design §10).

### Estado final

Só o `postgres` no ar, porta 3000 livre, nenhum teste temporário restante.
