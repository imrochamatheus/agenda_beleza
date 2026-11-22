# D-044 (E8.2) Salões no painel do super admin: dev

## Tarefas
- **T-2:** vocabulário de auditoria (`src/server/auditoria/tipos.ts`: 5 ações, entidade `assinatura`), `src/server/admin/saloes-tipos.ts`, `saloes-validacao.ts` (`lerFiltros`, `validarMotivo`, `validarDias`, `validarEdicao`, `diferencaDoSalao`, `recusaDaExtensao`), `erros-banco.ts` (23505 de `usuario_email_key`). **R-3 resolvido:** `RepoSalao`/`RepoAssinatura` exigem `ContextoEscopado`; o serviço monta `contextoDeSistema(salaoId, 'admin-saloes')` só para o `salaoId` já validado (UUID e existente) depois de `defineAcaoAdmin`. Nenhuma regra duplicada; `trocarSlug` reutilizado sem alteração.
- **T-3:** `src/server/repos/admin-saloes.ts` (lista em 1 instrução, detalhe, `lerParaExtensao`, `emTransacaoSaloes`), `src/server/admin/saloes.ts` (serviço), `saloes.acao.ts` (4 `defineAcaoAdmin`), `tests/support/admin-saloes.ts`, `tests/integration/admin-saloes/` (lista, suspensão, edição, extensão, ações, páginas, concorrência). Seed: já tinha salão suspenso (sem mudança).
- **T-4:** `src/app/admin/saloes/**` (páginas, `acoes.ts` shell, `estado.ts`, `_componentes/`), `/dev/admin-saloes`, `CascaAdmin` com menu filtrado (`ROTAS_ADMIN_EXISTENTES`, `NAVEGACAO_ADMIN_DISPONIVEL`, `ROTAS.devAdminSaloes`), link em `/admin`, `AdminLayout` ganhou a prop opcional `itensNavegacao`.
- **T-5:** `e2e/admin-saloes.spec.ts`, `e2e/admin-saloes-sem-js.spec.ts`, README. CLAUDE.md: não editado (líder).

## Desvios e decisões
- Resultados de edição: `invalido | conflito_slug | email_em_uso` (todos com `erros`), mais `confirmacao?: 'enviado'|'falhou'` em `editado`.
- Estender NÃO trava `salao` (design/spec RN-8, como webhook/job: `assinaturas.travar` só trava a assinatura); o parecer do DBA citava salão primeiro. Sem ciclo possível; ordem canônica preservada para editar/suspender (`salao → usuario → token/sessao`).
- Entidade de auditoria da extensão (sucesso e falha) é `assinatura`.
- Menu do admin só com "Salões" (Mensagens/Auditoria ainda sem tela; `NAVEGACAO_ADMIN` intocado por ser fixado em teste existente).
- Dois testes existentes ajustados: mocks de `next/navigation` ganharam `usePathname` (menu agora aparece nas páginas admin) e `tests/integration/auth/admin/paginas.test.ts` não proíbe mais o link `/admin/saloes`.
- Visual: capturas 375/768/1280 conferidas; corrigido `overflow-wrap` do selo ("manualmente" partia no meio).
- Porta 3000 ocupada por `next dev` do usuário (não encerrado): E2E rodou com config temporária na porta 3100 (`APP_URL` também), removida ao final.

## Riscos
R-1 divergência provedor × local (auditada como `falha`); real `NaoImplementado` até a E6.6; lista por varredura (DBA: < 200 ms em 50 mil).

## Gates
(preenchidos abaixo)

- `npm run lint`, `npm run typecheck`, `npm run build`: passam.
- `npm run test:coverage`: 543 arquivos, 6400 testes passando; linhas 98,92% (limiar 90%).
- Estabilidade 10x de `tests/integration/admin-saloes/concorrencia.test.ts` (editar×editar, slug e e-mail disputados, suspender×suspender, estender×estender, estender×cobrança, travas): 10/10. Unitários em `TZ=UTC` e `TZ=America/Sao_Paulo`: 96/96.
- E2E completo (config temporária na porta 3100, build + base `_e2e` preparada): 302 passam, 1 falha por artefato da porta: `e2e/admin-entrar.spec.ts:90` filtra requisições por `http://127.0.0.1:3000/` fixo (não é da D-044; passa na 3000). Specs novos (`admin-saloes*.spec.ts`, 33 testes: teclado, axe 4.14.0 zero violações, 375×812, locale en-US, sem JS, sem banco) passam.
- Testes: integração `tests/integration/admin-saloes/` (lista CA-1/13, suspensão CA-2/3, edição CA-8/9, extensão CA-4..7, ações CA-10, páginas, concorrência CA-11), unitários em `src/server/admin`, `src/app/admin/saloes`, `src/app/dev/admin-saloes`, `src/config/navegacao-admin.test.ts`.
