# D-016 — Testes: bloqueios do profissional e do salão inteiro (issue #19, E2.4)

Responsável: tester (T-11). Validação independente: todos os comandos foram reexecutados; a evidência do `dev.md` não foi aproveitada sem reprodução.

## Rodada 1 — 2026-11-20

### Ambiente
- Branch `feat/d-016-bloqueios`, base `c93a4db`, mudanças não commitadas (árvore do desenvolvedor, sem alteração de produção pelo tester).
- Node v24.21.0; PostgreSQL 17 (compose); Prisma Client 7.10.1; adaptadores `simulado`; Playwright Chromium 375×812.
- Docker: `docker compose up -d --build --wait` (imagem reconstruída com o código da branch; `VITRINE_COMPONENTES` ausente no container `app`).

### Gates

| Comando | Resultado |
|---|---|
| `npm run db:generate` | ok (saída 0) |
| `npm run lint` | ok, 0 avisos |
| `npm run typecheck` | ok |
| `npm run build` | ok; rotas `ƒ /painel/bloqueios`, `ƒ /painel/bloqueios/[id]`, `ƒ /dev/bloqueios` |
| `npm test` ×5 seguidas | 5/5 verdes: 198 arquivos, **2606 testes** cada (4 workers, inclui o teste R-3) |
| `npm run test:coverage` | verde (saída 0): **linhas 99,9%**, statements 99,4%, branches 97,91%, funções 99,75%. Novos: `painel/bloqueios` 100% linhas, `bloqueios/[id]` 100% linhas, `server/bloqueios` 100%, `repos/bloqueio.ts` 100%, `tempo/fuso.ts` 100%, `format.ts` 100% |
| `npm run test:e2e` | **63 passaram** (inclui `bloqueios.spec.ts` e `bloqueios-sem-js.spec.ts`; axe 4.14.0 sem violações) |
| Concorrência ×10: `for i in $(seq 10); do npx vitest run --project integration tests/integration/bloqueios/concorrencia.test.ts \|\| break; done` | **10/10** verdes (4 testes cada); `deadlock` e `23P01` ausentes de todas as saídas |
| Fuso: `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run src/server/tempo src/server/bloqueios src/lib/format.test.ts src/lib/format.fonte-unica.test.ts src/app/painel/bloqueios src/app/dev/bloqueios` | verdes nos dois: 175 testes |
| Fuso: `TZ=UTC` e `TZ=America/Sao_Paulo` `npx vitest run --project integration tests/integration/bloqueios` | verdes nos dois: 79 testes |
| Migrações | nenhuma migração nova (`git status` sem `prisma/**`); a app do Docker aplicou `migrate deploy` e subiu saudável |

Exclusões de cobertura: `vitest.config.ts` sem mudança (nenhuma exclusão nova). Testes novos conferem comportamento (valores gravados no banco, fotografia `to_jsonb` das reservas, contagem de `mensagem`, mensagens e atributos de acessibilidade), não só execução de linhas.

### Desvio 1 do dev (teste R-3 com `DROP INDEX` em transação desfeita) — avaliação
- Roda numa conexão `pg` própria na **base do worker** (`conectar()` → `urlDoWorker()`), não na base administrativa nem na de desenvolvimento; cada worker tem a sua base, então o `ACCESS EXCLUSIVE` do `DROP INDEX` não disputa com outros arquivos. Dentro do arquivo os testes são sequenciais.
- `finally` faz `ROLLBACK` e `DEALLOCATE ALL` (o `PREPARE` não é transacional); o próprio teste confere que `reserva_salao_id_inicio_idx` voltou.
- Estabilidade: 10 execuções seguidas de `tests/integration/bloqueios tests/integration/profissionais --maxWorkers=4` (139 testes cada) verdes, mais as 5 execuções do `npm test` completo e a de cobertura.
- Sem efeito residual: após todas as execuções, `pg_database` só tem `agenda_beleza`, `agenda_beleza_test`, `postgres` e templates (bases de teste apagadas), e a base de desenvolvimento mantém os 9 índices de `reserva`, inclusive os três btree e `reserva_sem_sobreposicao`.
- O controle negativo (status parametrizado → sem o índice) torna o teste discriminante. **Aceito**; não vejo necessidade de DBA.

### Verificações adicionais do tester
1. **Conversão local→UTC por força bruta** (roteiro descartável `scratchpad/fz/check.ts`, empacotado com esbuild e executado com `node`, fora do repositório): para 9 fusos com transições (America/Sao_Paulo, America/New_York, Australia/Lord_Howe — DST de 30 min, Pacific/Apia — dia 30/12/2011 inexistente, America/Santiago, Africa/Casablanca, Europe/Dublin — DST "negativo", America/Havana — transição à meia-noite, Asia/Tehran), 2016–2026, todos os dias de transição ±1 dia, toda hora de parede de 5 em 5 min: `instanteDeHoraLocal` comparado com a varredura de instantes (1ª ocorrência; se inexistente, 1º instante cuja hora de parede passa da pedida) e `ehDiaInteiro(intervaloDeDiasInteiros(d, d))`. `TZ=UTC` e `TZ=America/Sao_Paulo`: **146.880 casos cada, 0 falhas**.
2. **Prova manual na imagem Docker** (roteiro descartável `scratchpad/t11/{semear,roteiro,limpar}.mjs`, Playwright 375×812, login e preenchimento por teclado — foco + digitação, seta/digitação no `select`, Espaço no rádio, Enter para enviar e nos links/botões). Dados: salão A (SP) com gestora com perfil de profissional, Bia (usuária), Clara (inativa), Joana, cliente anonimizada; reservas da Bia em D: 15–16 confirmada (Joana), 17–18 confirmada (anonimizada), 12–13 cancelada, D−1 23:00→D 00:00 confirmada (só encosta); salão B com reserva confirmada 15–16 em D e um bloqueio próprio.
   - **Com JavaScript: 41/41**; **sem JavaScript: 39/39** (os 2 a menos são as checagens de foco, só com JS).
   - Coberto: CA-3 (salão, dia inteiro → `[03:00Z, +24 h)`, "dd/mm/aaaa (dia inteiro)"), CA-4/CA-13 (aviso com a reserva confirmada e "cliente removida"; sem a cancelada, a que só encosta e a de B; sem telefone; `to_jsonb` de todas as reservas de A e B idêntico e nenhuma `mensagem`), **lista atualizada logo após salvar, com e sem JS**, CA-7 (14:07 e 31/02: `aria-invalid`, `aria-describedby`, valor preservado, nada gravado; com JS, foco no resumo), CA-5/CA-15 (Clara inativa 22:00→02:00 cruzando a meia-noite, "(inativo)", data e hora nas duas pontas), CA-12 (edição pelo link: mesmo id, novo fim e motivo, dono igual), CA-11 (remoção PRG, linha apagada; segundo envio pela página antiga → "Bloqueio não encontrado"), CA-13 (`/painel/bloqueios/<id de B>` → 404, lista de A sem o de B, B intacto), CA-14 (gestora cria no próprio perfil; Bia sem `select`, vê o do salão somente leitura sem "Remover", não vê o da gestora), CA-1 (Bia cria 14–16 → `17:00Z`; aviso só com a 15–16), CA-2 (Bia abrindo a edição do bloqueio do salão e da colega → "Acesso negado"), CA-17 (fuso trocado para Manaus por SQL → 08:00–09:00 exibido 07:00–08:00), `/dev/bloqueios` → 404 na imagem (GET e POST).
   - Na 1ª execução sem JS, o roteiro quebrou por erro meu (navegação disparada antes de a resposta da edição terminar); corrigido com espera de `networkidle`, depois 39/39.
3. Revisão de código: `salao_id` sempre do contexto; SQL do aviso sem `telefone`, literal `'confirmado'`, intersecção semiaberta; precedência 403/404 conforme D-20; casca lê só nomes conhecidos do `FormData`.

### Critérios de aceitação

| CA | Situação | Evidência |
|---|---|---|
| CA-1 | passou | `criar-editar-remover.test.ts`, `paginas.test.ts`; Docker (Bia) |
| CA-2 | passou | `isolamento-permissoes.test.ts` (403 sem efeito; super admin 403; 401); Docker |
| CA-3 | passou | integração + Docker com/sem JS |
| CA-4 | passou | integração (fotografia `to_jsonb`, `mensagem`, cancelada/encosta/outro profissional); Docker |
| CA-5 | passou | integração (SP e Manaus); Docker (22:00→02:00) |
| CA-6 | passou | `fuso.test.ts` nos dois `TZ`; força bruta do tester |
| CA-7 | passou | `validacao.test.ts`, integração; Docker |
| CA-8 | passou | `validacao.test.ts` e integração com `agora` fixo |
| CA-9 | passou | `validacao.test.ts` (366 dias/datas, +5 min/+1 data, 730 dias) |
| CA-10 | passou | `criar-editar-remover.test.ts` |
| CA-11 | passou | integração; Docker (segunda remoção → não encontrado) |
| CA-12 | passou | integração (chave de dono recusada); Docker |
| CA-13 | passou | `isolamento-permissoes.test.ts`, `repos.test.ts`; Docker |
| CA-14 | passou | integração e `paginas.test.ts`; Docker |
| CA-15 | passou | integração; Docker |
| CA-16 | passou | `validacao.test.ts`, integração; Docker ("  Feriado  " → `Feriado`) |
| CA-17 | passou | integração; Docker |
| CA-18 | passou | `repos.test.ts`, `criar-editar-remover.test.ts`, `paginas.test.ts` |
| CA-19 | passou | `isolamento-permissoes.test.ts`; `tenant/registro.test.ts` verde |
| CA-20 | passou | laço ×10, sem `deadlock`/`23P01` |
| CA-21 | passou | `e2e/bloqueios.spec.ts` (teclado, foco, axe) + Docker com JS |
| CA-22 | passou | `e2e/bloqueios-sem-js.spec.ts` + Docker sem JS na página real |
| CA-23 | passou | `format.test.ts`; `format.fonte-unica.test.ts` verde sem mudança |

### Invariantes
Isolamento entre salões (servidor, lista, aviso, edição): ok. Sobreposição de reservas: não tocada; reservas intactas. Fuso/UTC e DST: ok. Salão suspenso: só declaração `configurar` (CA-19), efeito na E6.4. Idempotência/mensagens: nenhuma mensagem enfileirada. Anonimização: "cliente removida", telefone nunca lido. Permissões por perfil: ok. Auditoria do super admin: não se aplica (403).

### Documentação
README com a seção "Bloqueios"; sem migração, variável nova, `.env.example` ou CI a atualizar (o job `e2e` já pega os novos specs). Texto sugerido para o `CLAUDE.md` no `dev.md` §5 (cabe ao líder aplicar).

### Defeitos
Nenhum.

### Estado final do ambiente
Só o `postgres` no ar (`docker compose stop app worker`); porta 3000 livre; os dados do tester (salões "Tester A/B", usuários, clientes, reservas, bloqueios, sessões) apagados da base de desenvolvimento (contagem 0 conferida). Nenhum teste de regressão foi adicionado ao repositório.

### Veredito
**APROVADO**.
