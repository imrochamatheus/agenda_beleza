# D-017 — Desenvolvimento: configurar fuso, regras de horário e troca de slug com histórico (issue #26, E2.5)

Responsável: desenvolvedor. Tarefas T-1 a T-10 de `design.md`, nas rodadas previstas. Branch `feat/d-017-config-salao` (base `main` 9f687ec), sem commit. Nada em `prisma/**`, `tests/support/**`, `src/server/auth/**` (inclusive `permissoes.ts`), `src/server/tenant/**`, `src/lib/**`, `src/components/**`, `src/server/repos/{publico,cadastro,usuario,bloqueio}.ts`, `.env.example`, `docker-compose.yml`, `.github/**`, `eslint.config.mjs`, `vitest.config.ts` nem `playwright.config.ts`. Sem migração, variável de ambiente ou dependência nova.

## 1. Tarefas concluídas e arquivos

| Tarefa | Arquivos |
|---|---|
| T-1 Fuso estrito | `src/server/tempo/fuso.ts` (acréscimo: `fusosCanonicos`, `ehFusoCanonico`, cache congelado; comentário que distingue de `validarFuso`, que não muda), `fuso.test.ts` (+5 casos) |
| T-2 Contratos e rotas | `src/server/salao/tipos.ts` (novo, client-safe; `CAMPOS_REGRAS` acrescentado à §3.2), `src/config/navegacao.ts` (`ROTAS.devConfiguracoes`), `navegacao.test.ts` |
| T-3 Repositório | `src/server/repos/salao.ts` (novo, `RepoSalao`; cabeçalho com a trava `FOR NO KEY UPDATE`, os passos 1–3, a análise de ciclos e a nota do comando separado), `repos/index.ts` (`Repos.saloes`), `repos/tipos.ts` (DTOs), `repos/index.test.ts`, `tests/integration/salao/repos.test.ts` |
| T-4 Validação e fusos | `src/server/salao/validacao.ts` (`validarRegras`, `normalizarSlug`, `validarNovoSlug`, `valoresDoSalao`), `fusos.ts` (`FUSOS_BRASIL`, `opcoesDeFuso`) e os testes |
| T-5 Serviço e ações | `src/server/salao/configuracoes.ts` (`obter`, `salvarRegras`, `trocarSlug`), `configuracoes.acao.ts` (`salvarConfiguracoes`, `trocarSlugDoSalao`); `tests/integration/salao/{apoio.ts, configuracoes.test.ts, slug-historico.test.ts}` |
| T-6 Concorrência | `tests/integration/salao/concorrencia.test.ts` |
| T-7 Componentes | `src/app/painel/configuracoes/{estado.ts, FormularioRegras.tsx, FormularioSlug.tsx, Configuracoes.module.css}` e os dois `*.test.tsx` |
| T-8 Página e casca | `src/app/painel/configuracoes/{page.tsx, acoes.ts}`, `tests/integration/salao/paginas.test.ts` |
| T-9 Demonstração e E2E | `src/app/dev/configuracoes/{page.tsx, page.test.tsx, acoes.ts, acoes.test.ts, demonstracao.ts}`, `e2e/configuracoes.spec.ts`, `e2e/configuracoes-sem-js.spec.ts` |
| T-10 Documentação e gates | `README.md` (seção "Configurações do salão"), este arquivo |

## 2. Comandos executados e resultados

Node 24.21.0, PostgreSQL do compose no ar.

| Comando | Resultado |
|---|---|
| `npm run db:generate` | ok (Prisma Client 7.10.1) |
| `npm run lint` | ok, 0 avisos (com `/painel/configuracoes` e `/dev/configuracoes` presentes) |
| `npm run typecheck` | ok |
| `npm run build` | ok; lista `ƒ /painel/configuracoes` e `ƒ /dev/configuracoes` |
| `npm test` (3× seguidas) | 3/3 verdes: 209 arquivos, **2719 testes** cada |
| `npm run test:coverage` | verde (saída 0): **linhas 99,88%** (statements 99,41%, branches 98,02%, funções 99,77%). Arquivos novos com 100% de linhas, exceto `repos/salao.ts` (97,67%: a linha 146 é o `throw` de invariante "promovidos ≠ 1", inalcançável com o índice parcial e a trava; ver §4) |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/salao/concorrencia.test.ts \|\| break; done` | **10/10 verdes** (7 testes cada); `deadlock` e `23505` ausentes em todas as saídas |
| `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run src/server/salao src/server/tempo src/app/painel/configuracoes src/app/dev/configuracoes tests/integration/salao` | verdes nos dois fusos (12 arquivos, 136 testes) |
| `npx vitest run --project integration tests/integration/salao/paginas.test.ts tests/integration/auth/paginas.test.ts` | verde (27); `auth/paginas.test.ts` sem mudança |
| `tests/integration/tenant/registro.test.ts` | verde sem mudança (enxerga as duas ações) |
| `npx playwright test e2e/configuracoes.spec.ts e2e/configuracoes-sem-js.spec.ts` (porta 3000 livre naquele momento, servidor próprio) | 6/6 verdes |
| `npm run test:e2e` | **inválido nesta máquina**: durante a execução, a porta 3000 passou a ser ocupada pelo `npm run dev` do usuário (terminal do VS Code, iniciado às 15:43). O Playwright reaproveitou esse servidor (`reuseExistingServer`) e o `next build` do script reescreveu `.next` com ele no ar: 21 testes que dependem de hidratação falharam, inclusive os existentes (`a11y-base`, `bloqueios`, `jornada`). Não encerrei o processo do usuário |
| `npm run build` + `npx playwright test -c scratchpad/pw3001.config.ts` (a configuração do repositório, importada sem mudança, só com `baseURL`/`webServer` na porta **3001** e `reuseExistingServer: false`) | **69/69 verdes** (6 novos; todos os existentes sem mudança) |

Estado final: só o container `postgres` no ar (`app` e `worker` parados); a porta 3000 continua com o `next dev` do usuário (não iniciado nem encerrado por mim); os dados do passo manual foram apagados da base de desenvolvimento (0 salões e 0 slugs com o sufixo do roteiro).

### Passo manual (Docker, 375×812, só teclado, com e sem JavaScript)

`docker compose -f docker-compose.yml -f scratchpad/compose-3002.yml up -d --build --wait` (o arquivo extra só troca a porta publicada da app para 3002 com `ports: !override`, porque a 3000 do host estava com o `next dev` do usuário). App, worker e postgres saudáveis, com a imagem do código final. Dois salões criados por SQL na base de desenvolvimento (A: gestora confirmada com perfil de profissional, Bia profissional com usuário, jornada, cliente, reserva confirmada e bloqueio do salão 14:00–16:00 de São Paulo; B: slug atual e um histórico), senha argon2id real. Roteiro descartável com Chromium (Playwright), fora do repositório (`scratchpad/manual17/roteiro.mjs`), executado com JavaScript e com `javaScriptEnabled: false`. Depois de cada `goto`, toda a interação é por teclado (Tab/Shift+Tab, digitação e setas nos `select`, Enter para enviar), e o foco visível (contorno > 0) é conferido em cada parada. Resultado: **51/51 verificações**:
- `/dev/configuracoes` → 404 na imagem (vitrine desligada);
- login por teclado; página sem rolagem horizontal a 375 px; padrões exibidos (CA-17);
- nome com espaços, fuso "Manaus" por digitação no `select`, grade 30 por setas, antecedência 99 → resumo focado (com JS), `aria-invalid`, valores preservados, nada gravado; corrigida para 3 → sucesso focado (com JS); banco com `Studio Bela N`, `America/Manaus`, 30, 180 min (CA-3, CA-4, CA-5, CA-7);
- jornada, bloqueio e reserva idênticos por `to_jsonb`; o bloqueio passa a ser exibido 13:00–15:00 em `/painel/bloqueios`, cujo cabeçalho mostra o novo nome (CA-7, CA-16); B intacto (CA-15);
- slug histórico de B → "em uso" (CA-2); "Painel" → reservado (CA-9); novo slug em maiúsculas com espaços → trocado; endereço atual e anterior exibidos como texto; banco com o novo atual e o anterior histórico; slugs de B intactos (CA-1, CA-8);
- profissional Bia → "Acesso negado" sem dados (CA-14).

## 3. Testes criados ou alterados × CA

| Arquivo | Casos | CA / risco |
|---|---|---|
| `src/server/tempo/fuso.test.ts` (+1 describe) | 5 | CA-3 (aceitos e recusados, inclusive não-string), D-17 (`Asia/Katmandu`×`Asia/Kathmandu` e `Asia/Calcutta`×`Asia/Kolkata` derivados da lista do runtime, sem fixar a versão do ICU), todo canônico passa em `validarFuso`, `validarFuso` inalterado (UTC, alias), lista congelada e estável |
| `src/config/navegacao.test.ts` | +3 asserções | `ROTAS.devConfiguracoes`, "Configurações" ativo; `SEGMENTOS_RESERVADOS` inalterado |
| `src/server/repos/index.test.ts` | +6 chamadas | contexto admin/público/forjado → `Error` antes da consulta em todo método de `saloes` |
| `src/server/salao/validacao.test.ts` | 25 | CA-3..CA-9 em unidade (todos os casos da spec), exceção do fuso atual, dois erros juntos, tipos errados, 10 000 caracteres, CA-9 iterando o próprio `SEGMENTOS_RESERVADOS` filtrado por `FORMATO_SLUG`, D-21 (reservado antes do tamanho), `valoresDoSalao` (120 → "2"; 90 → "1.5" reprova), igualdade com `LIMITES_CADASTRO`/`MENSAGENS_CADASTRO` |
| `src/server/salao/fusos.test.ts` | 4 | 16 do Brasil na lista do runtime, São Paulo primeiro, nenhum do Brasil em "Outros", `atualForaDaLista` só para não canônico, cópias |
| `.../configuracoes/FormularioRegras.test.tsx` | 6 | CA-19 (rótulos com unidade, `optgroup` Brasil/Outros, opção "(atual)", `aria-describedby` com ajuda e erro, `aria-invalid`, resumo e sucesso focados), valores preservados/normalizados; `estado.ts` (só seis nomes, extras e arquivos ignorados, eco em 200) |
| `.../configuracoes/FormularioSlug.test.tsx` | 4 | endereço atual e anteriores como texto sem `<a>`, lista vazia, erro ligado ao campo, resumo e sucesso focados, campo vazio após trocar |
| `src/app/dev/configuracoes/page.test.tsx` | 7 | 404 sem a variável sem ler parâmetros, metadados, valores padrão, `?fuso=alias` |
| `src/app/dev/configuracoes/acoes.test.ts` | 11 | desligada → estado anterior; regras inválidas/válidas; slug sem efeito, histórico próprio, trocado, reservado, em uso, formato, eco cortado |
| `tests/integration/salao/repos.test.ts` | 10 | escopo das leituras, 404 com salão inexistente, ordem dos anteriores, `atualizarConfiguracoes` com B intacto, CA-1, CA-10 (sem linha nova, mesmos `criado_em`), CA-2 (`em_uso` sem escrita), invariante quebrada desfaz o INSERT |
| `tests/integration/salao/configuracoes.test.ts` | 16 | CA-3 (inclusive alias gravado aceito e outro alias recusado), CA-4, CA-5 (amostra + dois erros sem mudar a linha nem `atualizado_em`), CA-6, CA-7, CA-14 (profissional nas duas ações e no serviço; gestor com e sem perfil), super admin 403, sem credencial 401, CA-15 (`salaoId`/`salao_id`/`id` de B forjados), CA-16 (fotografia de jornada, bloqueio, reserva e reserva_item; lista 13:00–15:00), CA-17 (salão de `criarSalaoComGestor`), CA-18 (metadados), log sem valores |
| `tests/integration/salao/slug-historico.test.ts` | 7 | CA-1 (com `resolverSalaoPorSlug` → `historico`/`slugAtual`; linha de `salao` intacta), CA-10, CA-2 (atual, histórico e variação de caixa; sem dados de B), CA-8 (amostra + entradas não-texto/ausentes), CA-9 (`painel`, `admin`; `painel-2` aceito), CA-11 (`x`/`" X "`), CA-15, log |
| `tests/integration/salao/concorrencia.test.ts` | 7 | CA-12 ×10, troca cruzada ×10 (as duas "em uso"), CA-13 ×10, regras × slug ×10, R-2 determinístico (dois casos, `pg_stat_activity` com `FOR NO KEY UPDATE` e `wait_event_type = 'Lock'`), R-3 (INSERT em `bloqueio` com a trava segurada, `lock_timeout` 2 s); `timeout` 30 s por `it` |
| `tests/integration/salao/paginas.test.ts` | 11 | CA-3/CA-4 exibição após salvar, revalidação do layout, CA-7 (cabeçalho desta e de `/painel/bloqueios`), CA-17, CA-15 (página de A), CA-14 (profissional sem dados, gestor com perfil, sem sessão → `/entrar?proximo=%2Fpainel%2Fconfiguracoes`, super admin), CA-20 casca (inválido com valores, `salaoId` descartado; slug trocado/sem efeito/reservado/em uso; 403 e 401 fora de `try`; 404 → mensagem genérica) |
| `e2e/configuracoes.spec.ts` | 4 | CA-19: teclado (Tab/Shift+Tab/Enter, setas nos dois `select`), foco visível, resumo e sucesso focados, link → campo, `aria-describedby`; axe em inicial, `?fuso=alias`, erro e sucesso; sem rolagem horizontal |
| `e2e/configuracoes-sem-js.spec.ts` | 2 | CA-20: regras com erros e valores preservados e depois sucesso; slug com formato inválido, em uso e sucesso |

## 4. Desvios do desenho e riscos

Desvios:
1. **`src/app/dev/configuracoes/demonstracao.ts` (arquivo novo, fora da lista da T-9).** O desenho põe as constantes do salão de exemplo (`SLUG_EM_USO_DEMONSTRACAO` etc.) em `acoes.ts`, mas um módulo `'use server'` só pode exportar funções assíncronas (o build recusa). As constantes foram para esse arquivo, na mesma pasta e sob a mesma tarefa.
2. **`CAMPOS_REGRAS` em `tipos.ts`.** É uma constante acrescentada à §3.2 para que `estado.ts` leia só os seis nomes conhecidos sem repetir a lista.
3. **Grade com o componente `Select`** (`src/components/ui/Select.tsx`, sem alteração), com rótulos "N minutos". O fuso é um `<select>` nativo na própria tela, porque o `Select` não tem `optgroup`. O campo de slug também é marcado na tela, para mostrar o prefixo visual "/" (o `Field` não tem prefixo). Os dois seguem o mesmo padrão de rótulo, ajuda e erro (`ErroDoCampo`).
4. **`npm run test:e2e` validado na porta 3001**, com a configuração do repositório importada sem mudança (§2), porque a 3000 estava com o `next dev` do usuário. O passo manual com Docker usou a porta 3002 pelo mesmo motivo. **Pendência:** o líder ou o tester deve rodar `npm run test:e2e` com a porta 3000 livre. Observação: o `next build` do script rodou enquanto o `next dev` do usuário estava no ar. Se o servidor de desenvolvimento do usuário apresentar erro, reiniciá-lo resolve.

Riscos:
- O `throw` "promovidos ≠ 1" de `RepoSalao.trocarSlug` (linha 146) não é coberto, porque não há como chegar a ele sem violar o índice parcial ou a trava. O ramo irmão (rebaixados ≠ 1) é coberto e prova que a transação é desfeita.
- R-4/D-17: a lista de fusos depende do ICU do Node 24 (o mesmo na CI, na imagem e no `.nvmrc`). Os testes não fixam o tamanho da lista nem os nomes dependentes de versão; os recusados exigidos pela spec (`UTC`, aliases, offsets) estão fixos, como pede o CA-3.
- R-9 (acúmulo de slugs, D-24): sem limite na v1, como decidido.
- Nenhum `deadlock detected`, 23505 vazado nem intermitência: o DBA não precisou ser acionado (§4 do desenho).

## 5. Texto sugerido para o CLAUDE.md

**Project status** (acrescentar ao fim do parágrafo): "D-017 (E2.5) added the salon settings at `/painel/configuracoes` (gestor only; two independent forms, both working without JS): `src/server/salao/` (`tipos.ts` client-safe; `validacao.ts` with `validarRegras`/`normalizarSlug`/`validarNovoSlug`, which E8.2 must reuse because there are no CHECKs on the rules; `fusos.ts`; `configuracoes.ts` and `configuracoes.acao.ts`, capability `configurar`). Rules: grade ∈ {5,10,15,20,30,60} min, lead time 0–72 h (stored ×60 in `antecedencia_min`), window 1–365 days, buffer 0–120 min, lead time < window. Time zone input must be canonical: `ehFusoCanonico` in `src/server/tempo/fuso.ts` (exact member of `Intl.supportedValuesOf('timeZone')`, or the value already stored); `validarFuso` is unchanged and stays the calculation check. Changing the time zone recalculates nothing. `RepoSalao` (`Repos.saloes`) serializes per salon with `SELECT … FROM salao … FOR NO KEY UPDATE` (never `FOR UPDATE`, which would block FK inserts), and `trocarSlug` runs insert-as-history `ON CONFLICT (slug) DO NOTHING` → demote current → promote new, never catching 23505. A previous slug stays the salon's history forever (redirect is E4.1), and reserved segments are refused. E2E runs on `/dev/configuracoes` (vitrine only)."

Linhas da tabela "Comandos e cobertura":

| Estabilidade das configurações (D-017) | `for i in $(seq 10); do npx vitest run --project integration tests/integration/salao/concorrencia.test.ts \|\| break; done` | CA-12/CA-13 (disputa de slug entre salões, trocas no mesmo salão, troca cruzada, regras × slug) e os casos determinísticos com `pg_stat_activity` |
| E2E das configurações (D-017) | `npx playwright test e2e/configuracoes.spec.ts e2e/configuracoes-sem-js.spec.ts` | exige build prévio e porta 3000 livre; sem banco (`/dev/configuracoes`); teclado, axe 4.14.0 e sem JS |
