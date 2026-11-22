# D-039 (E1.4) — Convite de profissional: implementação

## 1. Tarefas e arquivos
- **T-1 (núcleo):** `src/server/auth/convite.ts` (+`.test.ts`); `src/server/convites/{tipos,servico,convites.acao}.ts`; `src/server/repos/{convite,convite-publico}.ts`, `repos/index.ts`; `src/server/profissionais/{servico,profissionais.acao}.ts` (editar invalida convites pendentes se o e-mail mudou, `agora` do `defineAcao`); `src/config/navegacao.ts` (`ROTAS.devConvite`).
- **T-2 (DBA, já feita):** migração `20261125000000_convite_pendente_unico`.
- **T-3/T-4 (testes de integração):** `tests/support/convites.ts`; `tests/integration/convites/{envio,aceite,concorrencia,paginas}.test.ts`. Ajustes em testes existentes: `tests/integration/politica/varredura.test.ts` (nova ação `convidarProfissional`), `tests/integration/auth/recuperacao-senha-paginas.test.ts` (nova regra de `headers()`).
- **T-5 (UI):** `src/app/(publico)/convite/[token]/{page,FormularioConvite(.test).tsx,.module.css,acoes,estado}`; `src/app/painel/profissionais/{ConviteProfissional(.test).tsx,acoes.ts,estado.ts,ListaProfissionais(.test).tsx,page.tsx,[id]/page.tsx}`; `src/app/dev/convite/{page(.test).tsx,acoes(.test).ts}`.
- **T-6:** `next.config.ts` (`/convite/:token`: `strict-origin`, `no-store`, `noindex`), `e2e/convite.spec.ts`, `e2e/convite-sem-js.spec.ts`, `docker/smoke.sh` (`/convite/x`), `README.md` (seção "Convite de profissional"). `CLAUDE.md` fica com o líder.

## 2. Gates (UTC, Node 24, PostgreSQL local)
- `npm run lint` e `npm run typecheck`: limpos. `npm run build`: ok (`/convite/[token]` e `/dev/convite` dinâmicas).
- `npm run test:coverage`: 498 arquivos, 5908 testes passando; **linhas 99,15%** (limiar 90%). `src/server/convites` 97,9%; `auth/convite.ts` 92%.
- Concorrência (10 repetições de `tests/integration/convites/concorrencia.test.ts`): 10/10 verdes. Fuso: `TZ=UTC` e `TZ=America/Sao_Paulo` em `src/server/auth/convite.test.ts` + `tests/integration/convites`: 56/56 em ambos.
- E2E dos specs sem banco (`e2e/convite*.spec.ts`), **sem `.env` e sem `DATABASE_URL`/`TEST_DATABASE_URL`**: 8/8. - E2E completo (todos os specs, `next start` na porta 3100 com config temporária, banco `_e2e` preparado): **231 passaram, 1 falhou por artefato da porta**: `e2e/admin-entrar.spec.ts:90` compara as requisições com a origem fixa `http://127.0.0.1:3000/` (não relacionado à D-039; precisa da porta 3000 para passar).

## 3. Testes e CAs
- Unidade: `convite.test.ts` (CA-3 limites, CA-13, CA-1 token/link/e-mail/chave), `FormularioConvite`/`ConviteProfissional`/`ListaProfissionais`/`/dev/convite` (CA-15, CA-16).
- Integração: `envio` (CA-1, 4, 5, 9, 10, 11, 12, 14), `aceite` (CA-2 incl. login real e agenda só do próprio, CA-3, 8, 9, 13, salão suspenso, GET não grava, sem PII em log), `concorrencia` (CA-6 com 2 e 10, CA-7, desativação × aceite, edição de e-mail × aceite, CA-8 com INSERT concorrente, ordem de travas por `pg_stat_activity`), `paginas` (CA-3/15/16 e a casca do painel).
- E2E: `/dev/convite` e `/convite/<token malformado>` (375×812, teclado, axe 4.14.0, cabeçalhos, locale en-US sem campo de data, sem JS).

## 4. Desvios e riscos
- `convidar` recebe `agora` do `defineAcao` (igual ao desativar) e a invalidação por troca de e-mail está em `profissionais/servico.ts#editar` (via `t.convites.invalidarPendentes`), não dentro de `atualizarDados`: mesma transação e mesma trava.
- Um bug achado pelo teste: `linkDeConvite` com APP_URL inválida lançava fora do `try` de `enviarConvite`; corrigido (vira `emailEnviado: false`).
- Textos e tipos client-safe do convite ficam em `src/server/convites/tipos.ts` (reexportados por `auth/convite.ts`).
- A data do estado "pendente até" usa `formatarData` (dd/mm/aaaa), não só DD/MM.
- A porta 3000 estava ocupada por um `next-server` do usuário (não encerrado): o E2E completo rodou com config temporária na porta 3100 (`playwright.tmp-d039.config.ts`, removida ao final).
- Risco aceito (spec §6): o gestor sabe que um e-mail está em uso (sondagem limitada por 3 envios/15 min e por ser autenticado).

## 5. Pendências
- `sh docker/smoke.sh` NÃO foi executado: o compose publica a porta 3000, ocupada por um `next-server` do usuário (não encerrado). A linha nova só repete o laço existente (`/convite/x` → `referrer-policy: strict-origin`), e o cabeçalho foi verificado no E2E (`request.get('/convite/x')`). Rodar com a 3000 livre e depois `docker compose down`.
- Rodar `npm run test:e2e` com a 3000 livre para fechar o `admin-entrar.spec.ts:90`.
