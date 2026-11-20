# D-017 — Testes: configurar fuso, regras de horário e troca de slug com histórico (issue #26, E2.5)

Responsável: tester (T-11). Validação independente: todos os comandos foram reexecutados; a evidência do desenvolvedor não foi aproveitada.

## Rodada 1 — 2026-11-20

### Ambiente

- Branch `feat/d-017-config-salao` (base `main` 9f687ec), mudanças não commitadas.
- Node 24.21.0; PostgreSQL 17.12 (container `postgres` do compose); adaptadores `simulado`; Chromium do Playwright, viewport 375×812.
- A porta 3000 estava ocupada pelo `next dev` do usuário, que não foi encerrado. Por isso:
  - o build e o E2E rodaram numa **cópia** do repositório em `scratchpad/t11c` (fontes copiadas com `rsync` e `node_modules` por hardlink), para não reescrever o `.next` do servidor do usuário;
  - o E2E usou uma configuração temporária fora do repositório (`t11c/pw-t11.config.ts`), que importa o `playwright.config.ts` sem mudança e só troca a porta para **3005**, com `reuseExistingServer: false`. A CI roda o comando oficial (`npm run test:e2e`);
  - a prova manual com Docker publicou a app na porta **3006**, com um override de compose fora do repositório (`ports: !override`).

### Gates

| Comando | Resultado |
|---|---|
| `npm run db:generate` | ok |
| `npm run lint` | ok, 0 avisos (também com o teste novo do tester) |
| `npm run typecheck` | ok (também com o teste novo do tester) |
| `npm run build` (na cópia) | ok; lista `ƒ /dev/configuracoes` e `ƒ /painel/configuracoes` |
| `npm test`, 5× seguidas | 5/5 verdes. Execuções 1 a 3: 209 arquivos e 2719 testes. Execuções 4 e 5, já com o arquivo do tester: 210 arquivos e 2728 testes |
| `npm run test:coverage` | verde (saída 0): **linhas 99,88% (3403/3407)**; statements 99,41%, branches 98,02%, funções 99,77%. `vitest.config.ts` não foi alterado, e não há exclusão nova |
| E2E completo (`npx playwright test -c pw-t11.config.ts`, porta 3005, build da cópia) | **69/69 verdes**, incluindo os 6 novos (`configuracoes.spec.ts` e `configuracoes-sem-js.spec.ts`) e todos os anteriores |
| `for i in $(seq 10); do npx vitest run --project integration tests/integration/salao/concorrencia.test.ts tests/integration/salao/regressao-tester.test.ts \|\| break; done` | **10/10 verdes**, 16 testes por execução; nenhuma ocorrência de `deadlock` ou `23505` nos logs |
| Migrações | nenhuma nova (nada em `prisma/**`); a app do compose aplicou o `migrate deploy` ao iniciar |
| `.env.example`, CI e dependências | sem mudança, o que é coerente com o desenho (nenhuma variável, job ou pacote novo). O README ganhou a seção "Configurações do salão" |

### Testes de regressão adicionados pelo tester

`tests/integration/salao/regressao-tester.test.ts`, com 9 testes contra PostgreSQL real e dois salões, todos verdes:
- **D-17:** pela ação, `Asia/Katmandu` é gravado e `Asia/Kathmandu` é recusado, com a linha de `salao` idêntica.
- **Fuso fora da lista:** `Brazil/East`, gravado por SQL, é aceito enquanto for o atual. `US/Eastern` é recusado. O alias atual de A é recusado para B. Depois da troca para `America/Manaus`, `Brazil/East` passa a ser recusado.
- **Coerência nas bordas:** com janela 1, antecedência 24 é recusada e 23 é aceita. Com janela 3, antecedência 72 é recusada. Com janela 4, 72 é aceita e gravada como 4320.
- **Tipos errados:** número em vez de texto, dígitos `３０`, `0x1E`, `null` e array são recusados sem 5xx e sem gravar. ` 30 ` e ` 120 ` são aceitos.
- **POST forjado:** `salaoId`, `salao_id` e `id` de B nas duas ações. Só A muda; a linha e os slugs de B ficam idênticos.
- **Slug:** 60 caracteres é aceito (em maiúsculas, normalizado) e 61 é recusado. ` PAINEL `, `Admin`, `api` e `entrar` recebem a mensagem de reservado; `_next` recebe a de formato.
- **Mesmo slug novo em paralelo no mesmo salão (×10):** sempre um `trocado` e um `sem_efeito`, com um único atual.
- **INSERT pendente do mesmo slug por outra transação:** a troca espera. Com `COMMIT` do outro lado, ela recebe "em uso" sem gravar nada; com `ROLLBACK`, ela é trocada.
- **Travas:** um INSERT de `reserva` pendente (FOR KEY SHARE) não bloqueia a troca de slug nem a gravação das regras, ambas concluídas em menos de 3 s. Com `FOR NO KEY UPDATE` segurado em `salao`, um INSERT de `reserva` passa com `lock_timeout` de 2 s, e a troca de slug espera essa trava.

### Prova manual (imagem Docker, porta 3006, 375×812, só teclado, com e sem JavaScript)

`docker compose -f docker-compose.yml -f <override 3006> up -d --build --wait`: app, worker e postgres saudáveis, com a imagem construída a partir do código atual. Os dados foram criados por SQL na base de desenvolvimento, com o sufixo `t11mwpch3ad` e senha argon2id real:
- **A:** gestora com perfil de profissional, profissional Bia, jornada, cliente, reserva confirmada e bloqueio do salão.
- **B:** slug atual e um slug histórico.
- **C:** fuso gravado `Brazil/East`.

O roteiro de verificação (Playwright com `@axe-core/playwright`) ficou fora do repositório, em `scratchpad/t11m/roteiro.mjs`.

- **Com JavaScript (33/33):**
  - sem sessão, a página redireciona para `/entrar?proximo=%2Fpainel%2Fconfiguracoes`; `/dev/configuracoes` responde 404 na imagem;
  - o login é feito por teclado; a página mostra os padrões (CA-17);
  - **axe sem violações na página real** nos estados inicial, com erro e com sucesso; sem rolagem horizontal a 375 px nos três estados;
  - antecedência 48 com janela 2 e intervalo 121: resumo de erros focado, erro de coerência no campo antecedência, `aria-invalid`, valores preservados e linha de `salao` idêntica (inclusive `atualizado_em`);
  - correção feita por teclado: nome com espaços, fuso "Manaus" por digitação no `select`, grade 30 por setas, antecedência 47. Mesmo com um input oculto `salaoId` de B injetado nos dois formulários, o resultado é sucesso focado, o banco fica com `Studio T11 Nova`, `America/Manaus`, 30, 2820 e 2, e B fica idêntico;
  - slug histórico de B: "em uso", sem revelar B; `Painel`: reservado; os slugs de A ficam inalterados;
  - novo slug em maiúsculas com espaços: trocado, com o atual e o anterior exibidos e o banco com um único atual. Os slugs de B ficam intactos;
  - jornada, bloqueio, reserva e itens idênticos por `to_jsonb`; `/painel/bloqueios` mostra o novo nome no cabeçalho e o bloqueio em 13:00–15:00;
  - a profissional Bia vê "Acesso negado" sem dados do salão;
  - foco visível em todas as paradas.
- **Sem JavaScript (18/18):**
  - a opção `Brazil/East (atual)` aparece selecionada;
  - salvar sem mudar dá sucesso e mantém o alias;
  - nome `X` e antecedência `2,5` geram os erros do servidor, com os valores preservados e nada gravado;
  - slug `bela studio`: erro de formato, com o valor preservado. O atual de B dá "em uso". O próprio slug atual, em maiúsculas e com espaços, dá "Nada foi alterado". Um novo slug é trocado, com o atual e o anterior exibidos na resposta do POST e o banco com 2 linhas e 1 atual.

Limpeza: as linhas dos três salões e as três linhas de `rate_limit_janela` dos logins foram apagadas. Restam 0 slugs e 0 usuários com o sufixo. `docker compose stop app worker`: só o `postgres` está no ar, e o `next dev` do usuário não foi tocado.

### Critérios de aceitação

| CA | Situação | Evidência |
|---|---|---|
| CA-1 | passou | `slug-historico.test.ts` (com `resolverSalaoPorSlug`), `repos.test.ts`; manual |
| CA-2 | passou | `slug-historico.test.ts`; manual (histórico de B com JS, atual de B sem JS) |
| CA-3 | passou | `fuso.test.ts`, `validacao.test.ts`, `configuracoes.test.ts`, `regressao-tester.test.ts` (D-17, alias só se atual); manual (Manaus e `Brazil/East`) |
| CA-4 | passou | `validacao.test.ts`, `configuracoes.test.ts`, `paginas.test.ts`; manual (30 por setas, exibido e gravado) |
| CA-5 | passou | `validacao.test.ts`, `configuracoes.test.ts`, `regressao-tester.test.ts`; manual (dois erros, nada gravado) |
| CA-6 | passou | `validacao.test.ts`, `configuracoes.test.ts`, bordas em `regressao-tester.test.ts`; manual (48 × 2 recusado, 47 aceito) |
| CA-7 | passou | `configuracoes.test.ts`, `paginas.test.ts`; manual (nome normalizado e cabeçalho em `/painel/bloqueios`) |
| CA-8 | passou | `validacao.test.ts`, `slug-historico.test.ts`, 60/61 em `regressao-tester.test.ts` |
| CA-9 | passou | `validacao.test.ts` (iterando `SEGMENTOS_RESERVADOS`), `slug-historico.test.ts`, `regressao-tester.test.ts`; manual (`Painel`) |
| CA-10 | passou | `slug-historico.test.ts`, `repos.test.ts` (sem linha nova, mesmo `criado_em`) |
| CA-11 | passou | `slug-historico.test.ts` (`x` e `" X "`, `criado_em` idêntico); manual sem JS ("Nada foi alterado") |
| CA-12 | passou | `concorrencia.test.ts`, laço 10/10 |
| CA-13 | passou | `concorrencia.test.ts`, laço 10/10, mais o mesmo slug em paralelo (×10) do tester |
| CA-14 | passou | `configuracoes.test.ts`, `paginas.test.ts`; manual (profissional e sem sessão) |
| CA-15 | passou | `configuracoes.test.ts`, `slug-historico.test.ts`, `paginas.test.ts`, POST forjado do tester; manual com input oculto `salaoId` de B |
| CA-16 | passou | `configuracoes.test.ts` (fotografia `to_jsonb` e lista 13:00–15:00); manual |
| CA-17 | passou | `configuracoes.test.ts`, `paginas.test.ts`; manual |
| CA-18 | passou | `configuracoes.test.ts` (metadados) e `tenant/registro.test.ts` verde sem mudança |
| CA-19 | passou | `configuracoes.spec.ts` (E2E 69/69) e jsdom; manual na página real (teclado, foco visível, axe em 3 estados, 375 px) |
| CA-20 | passou | `configuracoes-sem-js.spec.ts`, casca em `paginas.test.ts`; manual sem JS na imagem |

### Invariantes de regressão

- **Isolamento entre salões:** verificado (CA-2, CA-15, POST forjado, mensagem de "em uso" sem dados do dono).
- **Concorrência e travas:** verificadas, sem impasse, 5xx ou 23505 vazado. `FOR NO KEY UPDATE` não bloqueia INSERT com FK (`bloqueio`, pelo desenvolvedor; `reserva`, pelo tester).
- **Fuso e UTC:** a troca de fuso não recalcula nada; a exibição segue o novo fuso.
- **Permissões por perfil:** verificadas (gestor, gestor com perfil de profissional, profissional, super admin, sem sessão).
- **Fora do escopo desta demanda:** salão suspenso (a capacidade `configurar` está declarada; o comportamento é da E6.4), webhooks e mensagens, anonimização e auditoria do super admin.

### Revisão dos testes e da cobertura

- Não há exclusão nova de cobertura. A única linha não coberta em `repos/salao.ts:146` é o `throw` de invariante "promovidos ≠ 1", inalcançável com o índice parcial e a trava. O ramo irmão (rebaixados ≠ 1) é coberto.
- Os testes novos verificam comportamento: estado do banco por `to_jsonb`, `criado_em` exato, resultados tipados e `pg_stat_activity` nos casos de trava. Não há teste sem asserção.

### Observações (não são defeitos)

- O-1: um `antecedencia_min` que não seja múltiplo de 60, gravado por SQL, aparece como fração (por exemplo, "1.5"). Para salvar, o gestor precisa informar horas inteiras. Isso é coerente com a RN-10/D-2, já está registrado pelo desenvolvedor e só ocorre por SQL direto (não há seed ainda).
- O-2: o `npm run test:e2e` oficial, na porta 3000, não rodou nesta máquina porque a porta estava ocupada pelo usuário. Ele roda na CI (job `e2e`).

### Defeitos

Nenhum.

### Veredito

**APROVADO.** Os 20 CAs passaram com evidência, todos os gates estão verdes, a cobertura de linhas é de 99,88% (≥ 90%) e não há defeito aberto.
