# D-015 — Testes (T-9, tester)

## Rodada 1 — 2026-11-20

### Ambiente

- Branch `feat/d-015-jornada` (base `main` 96bd348), mudanças do desenvolvedor não commitadas; Node v24.21.0; PostgreSQL do `docker compose` (container `postgres`); adaptadores `simulado`; Chromium do Playwright, viewport 375×812.
- Código de produção não foi alterado pelo tester. Único arquivo acrescentado ao repositório: `tests/integration/jornadas/regressao-tester.test.ts` (21 casos).

### Gates (reexecutados pelo tester)

| Comando | Resultado |
|---|---|
| `npm run db:generate` | ok (Prisma Client 7.10.1) |
| `npm run lint` | passou, 0 avisos (inclusive com o teste novo do tester) |
| `npm run typecheck` | passou |
| `npm run build` | passou; rotas `ƒ /painel/profissionais/[id]/jornada` e `ƒ /dev/jornada` |
| `npm test` ×5 seguidas | 5/5 verdes. 1ª: 184 arquivos / 2412 testes (antes do teste do tester); 2ª–5ª: 185 / 2433 |
| `npm run test:coverage` | verde; **linhas 99,88 %** (2677/2680); statements 99,35 %, branches 98 %, functions 99,72 %. `src/server/jornadas` 100 % de linhas; `[id]/jornada` 100 % de linhas |
| `npm run test:e2e` | **54 passaram** (inclui `e2e/jornada.spec.ts` e `e2e/jornada-sem-js.spec.ts`) |
| Laço 10× `npx vitest run --project integration tests/integration/jornadas/concorrencia.test.ts --silent=false` | 10/10 verdes (6 testes cada); `deadlock` e `23P01` ausentes no log |
| `sh docker/smoke.sh` | OK (app, worker e postgres saudáveis; `/api/health` 200; Referrer-Policy) |

Exclusões de cobertura: `vitest.config.ts` sem mudança (só testes, `.d.ts` e `src/generated/**`, todas justificadas). Os testes novos do desenvolvedor verificam comportamento (banco antes/depois, ids, mensagens, `to_jsonb` das reservas), não só executam linhas.

### Prova manual com a imagem Docker (com e sem JavaScript)

Imagem reconstruída por `sh docker/smoke.sh`. Sem `VITRINE_COMPONENTES`: `GET /dev/jornada` → 404 e `POST /dev/jornada` → 404. Dados criados por SQL na base de desenvolvimento (salões "Tester A/B"; gestora com perfil; Bia, profissional com usuário e jornada seg–sex 09:00–17:00; Ana sem jornada; Clara inativa; Zed no salão B com jornada), senha argon2id real; removidos ao final. Roteiro Playwright descartável (fora do repositório), toda interação de formulário por teclado (Tab/Shift+Tab, digitação, Enter em links, `summary` e envio), com checagem de contorno de foco em cada parada.

- **Com JS: 37/37**; **sem JS: 33/33** (axe e foco no resumo só no modo com JS; o axe precisa injetar script).
- Verificado: login → `/painel` → "Minha jornada" (gestora que atende) com aviso de sem horários (CA-15); link "Ver e editar a jornada" na página do profissional; sem rolagem horizontal a 375 px; axe sem violações em edição vazia, edição com erro e somente leitura; CA-1 (PRG `?salva=1`, "Jornada salva.", resumo com "Pausa 12:00–13:00", banco `[[1,540,720],[1,780,1080]]`, demais dias "Folga"); envio com segunda alterada + sexta 22:00–02:00 + sábado 22:00–24:05 + domingo `9h`/`12:60` → banco intacto (atomicidade), "Jornada salva." não aparece, valores preservados, erros ligados por `aria-describedby`, foco no resumo (com JS); correção → banco `[[1,540,720],[1,780,1080],[2,540,780],[6,1320,1440]]` e sábado exibido `22:00–24:00` (CA-5, CA-7); Clara inativa: aviso e gravação aceita (CA-14); gestor com id de B, UUID inexistente e `abc` → 404 e B intacto (CA-11); Bia: própria jornada somente leitura sem `input`/`button`, com intervalos e folga; Ana e gestora → "Acesso negado"; Zed (B) → 404 (CA-12); sem sessão → `/entrar?proximo=`.
- Observação do roteiro (não é defeito): sem JS, depois de um envio com erro, só os dias com erro voltam abertos (`details`); os valores digitados nos outros dias continuam nos campos e são reenviados. Comportamento previsto no desenho (§3.6).

Estado final: só o container `postgres` no ar (`docker compose stop app worker`); porta 3000 livre.

### Teste de regressão do tester

`tests/integration/jornadas/regressao-tester.test.ts` (21 casos, pela ação real contra PostgreSQL real):
- 16 entradas recusadas num domingo, com outros dias válidos na mesma semana → `invalido` e jornada anterior idêntica (ids): início `24:00`, `24:05`, `25:00`, `12:60`, `9h`, `09:00:00`, `-1:00`, `0900`, `9:0`, `009:00`, dígitos não ASCII, `12:03`, só início, só fim, texto, `00:00` como fim.
- Sobreposições aninhada, idêntica, não vizinha e cruzando a união → recusadas, nada gravado.
- Aceitos: `00:00–24:00`, `" 9:00 "`, contíguos em cadeia fora de ordem com linha vazia no meio (→ `(2,540,840)`), 6 intervalos com linhas vazias intercaladas.
- 7 intervalos não vazios → limite; reenvio da mesma semana em outra ordem → `inseridos: 0, removidos: 0` e ids iguais; desativar/reativar não muda as linhas.
- Gestor de A com profissional ativo e inativo de B → 404; A e B idênticos.

### Critérios de aceitação

| CA | Status | Evidência |
|---|---|---|
| CA-1 | passou | `salvar.test.ts:64`, `paginas.test.ts:126`, manual |
| CA-2 | passou | `salvar.test.ts:92` (ids iguais), `validacao.test.ts`, regressão do tester |
| CA-3 | passou | `isolamento-permissoes.test.ts` (profissional própria/outra, super admin 403; 401) |
| CA-4 | passou | `salvar.test.ts:101`, manual (22:00–02:00) |
| CA-5 | passou | `salvar.test.ts:109,149`, `paginas.test.ts:173`, regressão do tester, manual |
| CA-6 | passou | `salvar.test.ts:118`, regressão do tester (16 formatos), manual |
| CA-7 | passou | `salvar.test.ts:158`, regressão do tester, manual |
| CA-8 | passou | `salvar.test.ts:168,177`, regressão do tester, manual (atomicidade) |
| CA-9 | passou | `salvar.test.ts:127`, regressão do tester |
| CA-10 | passou | `salvar.test.ts:214` (reserva byte a byte; `mensagem` sem linha nova) |
| CA-11 | passou | `isolamento-permissoes.test.ts`, `repos.test.ts`, `paginas.test.ts:204,301,316`, regressão do tester, manual |
| CA-12 | passou | `isolamento-permissoes.test.ts`, `paginas.test.ts:220,242`, manual |
| CA-13 | passou | `concorrencia.test.ts` (fila determinística, `Promise.all` ×10 com e sem jornada prévia, × desativação ×10, R-3), laço 10× verde |
| CA-14 | passou | `salvar.test.ts:235`, `paginas.test.ts:194`, regressão do tester, manual |
| CA-15 | passou | `isolamento-permissoes.test.ts`, `paginas.test.ts:194,233`, manual |
| CA-16 | passou | `salvar.test.ts:257` (Manaus e São Paulo), `paginas.test.ts:173` |
| CA-17 | passou | `e2e/jornada.spec.ts` (teclado, foco visível, resumo focado, `aria-describedby`, axe 4.14.0), manual com JS |
| CA-18 | passou | `e2e/jornada-sem-js.spec.ts` (6 intervalos, erros, leitura), `paginas.test.ts:160`, manual sem JS |
| CA-19 | passou | `isolamento-permissoes.test.ts` (metadados), `tenant/registro.test.ts` verde |
| CA-20 | passou | `src/lib/format.test.ts`, `format.fonte-unica.test.ts` verde |

Regressões das invariantes tocadas: isolamento entre salões (CA-11, 404 sem efeito); concorrência (sem impasse/23P01); fuso (hora de parede); reservas e `mensagem` intocadas; permissões por papel (matriz `jornada.ver`/`jornada.editar`); `/dev/jornada` 404 sem a variável (GET e POST na imagem; ação sem efeito em `acoes.test.ts`). `tests/integration/profissionais/paginas.test.ts` e `tests/integration/auth/paginas.test.ts` sem alteração (`git diff` vazio em `tests/integration/{profissionais,auth}`, `tests/support`, `prisma`, `.env.example`, `.github`) e verdes. README com a seção "Jornada"; sem migração, variável nova nem mudança de CI necessárias.

### Defeitos

Nenhum defeito aberto. (O defeito "Jornada salva." junto com erros, achado pelo desenvolvedor, foi reconferido no manual com e sem JS: não ocorre.)

Observações sem severidade (não bloqueiam):
- O `pattern` do campo (`([01]?[0-9]|2[0-4]):[0-5][0-9]`) aceita `24:30` e `09:07` no cliente; irrelevante porque o formulário usa `noValidate` e o servidor é a autoridade.
- `converterHorario` testa o limite de 10 caracteres antes do `trim`: `"09:00"` com 6 espaços em volta é recusado como formato. Caso artificial, sem impacto.

### Veredito

**APROVADO** — CA-1..CA-20 passaram; todos os gates verdes; cobertura 99,88 % de linhas; nenhum defeito crítico ou alto aberto.
