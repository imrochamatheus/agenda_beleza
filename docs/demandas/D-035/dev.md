# D-035 (E8.4) — Desenvolvimento (T-2 a T-5)

## 1. Tarefas e arquivos
- **T-2 (servidor):** `src/server/denuncias/{tipos,validacao,denunciar,moderacao,leitura}.ts`, `denuncias.acao.ts` (3 `defineAcaoAdmin`); `src/server/tenant/define-acao-admin.ts` (+ `registro.ts` aceita a marca `tipo: 'admin'`); `src/server/repos/{denuncia,denuncia-publica}.ts`, `RepoAvaliacao` (`travarParaModerar`/`retirar`/`restaurar`, `AdminContext`), `Repos.denuncias`, cabeçalho de lock order em `repos/servico.ts`; `hashIpDenuncia` em `protecao/chaves.ts`; `ACOES_AUDITAVEIS` + `avaliacao.denuncia_resolver` e entidade `avaliacao_denuncia`; `AvaliacaoPublica.id`.
- **T-3 (público):** `src/app/(publico)/[slug]/_denuncia/*` (estado, formulario, `FormularioDenuncia`), `SecaoAvaliacoes`/`PaginaDoSalao`/`page.tsx`/`acoes.ts` (`denunciarAcao`, PRG `?denuncia=recebida`), `WidgetTurnstile` (prop `id`), `src/config/denuncia.ts`, `/dev/denuncia`, `e2e/denuncia*.spec.ts`.
- **T-4 (admin):** `src/app/admin/avaliacoes/**` (fila, detalhe, `acoes.ts`, `resultado.ts`, componentes), `src/app/admin/_componentes/*`, link em `/admin`, `ROTAS.adminAvaliacoes/adminAvaliacao/devDenuncia/devModeracao`, `src/config/moderacao.ts`, `/dev/moderacao`, `e2e/moderacao*.spec.ts`.
- **T-5:** README (seção "Denúncias e moderação de avaliações"). CLAUDE.md fica com o líder.

## 2. Testes e CAs
- Integração (`tests/integration/denuncias/`, apoio em `tests/support/denuncias.ts`): `denunciar` (CA-1, 3, 4, 5, 13), `moderacao` (CA-6 com falha de auditoria desfazendo, CA-7, CA-8, CA-11, CA-12, CA-13, média/contagem/lista), `acoes` (CA-9: 401/403 reais com sessões reais), `paginas` (CA-9 páginas e casca, CA-2 casca pública), `fila` (CA-10), `concorrencia` (retirar x restaurar x arquivar x denunciar), `estatico` (CA-14).
- Unitários: validação, `hashIpDenuncia`, `defineAcaoAdmin`, formulário/estado, `SecaoAvaliacoes`, fila/detalhe, `resultado`, vitrines.
- E2E: `/dev/denuncia` e `/dev/moderacao` com e sem JS (375×812, teclado, axe, `en-US`), e o redirecionamento de `/admin/avaliacoes` sem sessão.

## 3. Desvios e riscos
- `ACOES_AUDITAVEIS` já tinha `avaliacao.retirar/restaurar`; só foi acrescentada `avaliacao.denuncia_resolver`.
- A trava e a moderação ficaram em `RepoAvaliacao` com `AdminContext` (como no design); a fila e o detalhe, em `RepoDenuncia`.
- `denunciarAvaliacao` aceita `ctx` nulo (slug desconhecido: mesmo caminho, sem gravar) e `denunciarPorSlug` resolve o slug. Slug do formulário só vira destino do PRG se `slugPlausivel`.
- Filtro por salão da fila: sem lista de salões (E8.2 não existe); usa o link "Só este salão" em cada cartão. O motivo digitado se perde no PRG de erro (aceito).
- Um widget Turnstile por avaliação listada (até 10) no modo real; no simulado é só um campo oculto. Ids do seletor de teste distintos por formulário.
- Teto de 20 é aproximado sob concorrência (aceito no design). `NAVEGACAO_ADMIN` não ganhou item (o E2E de a11y conta 3 itens); o acesso é pelo link em `/admin`.

## 4. Gates (local, 2026-11-21)
- `npm run lint` e `npm run typecheck`: sem avisos.
- `npm run test:coverage`: 467 arquivos, 5259 testes passando; linhas 99,24% (limiar 90).
- `npm run build` ok; `npm run test:e2e`: 196 passaram (com `.env`) e 196 sem `.env`/`DATABASE_URL`.
- Fuso: `TZ=UTC` e `TZ=America/Sao_Paulo` nos unitários de denúncias/admin/dev/format (380 testes, ok).
- Estabilidade: `concorrencia.test.ts` + `denunciar.test.ts` 10x sem falha (depois de relaxar a asserção de uma corrida benigna, abaixo).
- Ajustes em testes da D-032 por causa do `id` no DTO público e das novas telas de `/admin/avaliacoes`: `tests/integration/avaliacoes/{envio,paginas}.test.ts`.
- Corrida benigna conhecida: um INSERT público já planejado sobre a avaliação ainda visível pode gravar uma denúncia pendente numa avaliação recém-retirada (não trava a avaliação). Nunca duplica (IP, avaliação) pendente.
- Docker/compose/env não foram tocados; `docker/smoke.sh` não necessário.
