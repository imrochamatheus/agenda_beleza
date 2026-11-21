# D-036 — dev (T-1, T-2, T-5, T-6)

## Tarefas e arquivos
- **T-1/T-2 (seed):** `prisma/seed.ts` (`semear`, `semearComplementoE2E`, `recusarProducao`, `CREDENCIAIS_DEMO`, casca CLI), `prisma/seed/{dados,plano,fotos,salao-a,salao-b,complemento-e2e}.ts` (puros; só `seed.ts` acessa o banco, pela allowlist existente do lint). Ids determinísticos (`idDemo`: UUID v4 derivado de SHA-256 de espaço+chave). Cada salão é uma transação ancorada em `salao ... ON CONFLICT DO NOTHING` (count 0 = já existe, pula tudo); `salao_foto` entra sem `skipDuplicates` (a unique de posição é DEFERRABLE e não serve de árbitro). `assinatura` não tem CHECK: A `em_teste` (+30 dias), B `ativa` (período pago +30 dias).
- **E2E com banco:** `e2e/suporte/preparar-banco.ts` (DROP/CREATE `_e2e`, `prisma migrate deploy`, seed + complemento: 8 salões `e2e-reservas-N` com Ana/Bia/Cris e vínculos parciais, 1 `e2e-suspenso`), `e2e/suporte/{fixtures,publico,link-avaliacao}.ts`, specs `e2e/publico-{reserva,reserva-teclado,conflito-captcha,suspenso,avaliacao-denuncia}.spec.ts`.
- **Testes de integração:** `tests/integration/seed/{plano,seed,producao}.test.ts`, `apoio.ts`.
- **T-6:** README (seção "Seed de demonstração", E2E com banco, CI, usuário de exemplo). CLAUDE.md não editado (líder).
- **Fora da posse, ajuste mínimo:** `e2e/suporte/ambiente.ts` ganhou `ADMIN_TOTP_CHAVE` (público, só E2E): sem ela o `next start` (NODE_ENV=production) respondia 500 em `/<slug>` (`ErroDeAmbiente`).

## Testes e CAs
- `plano.test.ts`: CA-7 (puro: telefones, sem sobreposição, passado/futuro, snapshot, fuso Manaus ≠ São Paulo; rodado em TZ=UTC e TZ=America/Sao_Paulo).
- `seed.test.ts`: CA-1, CA-2 (duas execuções em paralelo + terceira em série: contagens e ids iguais; dado editado sobrevive), CA-3 (login real dos dois gestores, `listar` tenant-scoped), CA-5 (perfil, funcionamento, objeto no armazenamento, `servirFoto` 200 `image/webp`, avaliações de reservas concluídas), CA-6, CA-7 (SQL + exclusão 23P01), CA-8 (README × `CREDENCIAIS_DEMO`).
- `producao.test.ts`: CA-4 (bundle esbuild do CLI em processo filho: production sem flag sai 1 sem gravar, sem `DATABASE_URL` nomeia a variável, com a flag roda e repetir não duplica).
- E2E: CA-14/15 (`publico-reserva`), CA-19 (`publico-reserva-teclado`), CA-16/17 (`publico-conflito-captcha`), CA-18 (`publico-suspenso`), CA-20/21 (`publico-avaliacao-denuncia`); CA-22: `verificarTela` (axe 4.14.0 + sem rolagem horizontal) em cada tela.

## Gates
- `npm run lint`, `npm run typecheck`: OK. `npm run test:e2e` completo **2 vezes seguidas**: 205/205 nas duas (~47 s de Playwright cada), 0 falhas, 0 `ENOENT` em `test-results/.playwright-artifacts-*`: as 4 falhas relatadas vinham de execuções concorrentes do Playwright (confirmado com a suíte sozinha e a porta 3000 livre).
- `npm run test:coverage`: 470 arquivos / 5294 testes passando, linhas **99,25%** (limiar 90%); `prisma/` está fora de `src/**` (não entra na métrica; coberto por `tests/integration/seed/`, sem exclusão nova). `npm run build`: OK (feito antes das últimas mudanças só em testes/README).
- `build:node` voltou a ser **um único comando esbuild** (entradas `prisma/seed=prisma/seed.ts` e `e2e/preparar-banco=e2e/suporte/preparar-banco.ts`): `tests/support/fila.ts` e `tests/integration/auth/admin/apoio.ts` leem o script e o executam sem shell, e a versão encadeada com `&&` (T-4) quebrava `sigterm` e `garantir`.
- Container: `sh docker/smoke.sh` OK; `docker compose exec -e SEED_PERMITIR_PRODUCAO=true app node dist/prisma/seed.js` ×2 -> ok, sem duplicar (a app roda com NODE_ENV=production, então a flag é exigida; sem ela o seed recusa, como previsto), fotos gravadas e `/studio-aurora` 200. Compose derrubado depois.

## Desvios e riscos
- **DEF-1 corrigido (antes era o desvio 4):** horário tomado não redireciona mais. `reservarAcao` devolve na resposta `status: 'horario_indisponivel'` com `reescolha` (fuso e horários atualizados do dia, via `src/server/reserva-publica/reescolha.ts`, que reusa `lerPasso`/`carregarPassoComLimite`), a mensagem e os `valores` (nome, telefone, aceites); nada de PII na URL. `FormularioDados` mostra "Escolha o horário" com `SlotGrid` e os campos preservados; o reenvio leva `reescolha=1` e o servidor resolve o profissional do horário (Sem preferência). Sem JS o POST volta à página no passo horário (aviso `horario_indisponivel`): `PaginaDoSalao` monta `FormularioDados` com `alternativa` (o passo horário do GET) e o estado da ação assume; erro na reescolha recalcula os horários (o estado anterior não viaja sem JS). Testes: `acao.test.ts` (3 casos, o antigo "redirecionamento" foi substituído), `FormularioDados.test.tsx`, `formulario.test.ts`, E2E `publico-conflito-captcha` CA-16 com e sem JS (nome, telefone e aceite preenchidos, URL sem PII, reescolha confirma; sem JS só rolagem, o axe exige JS).
- Home: frase "Sem limite de profissionais" (RN-10) em `page.tsx`, `page.test.tsx`, `landing.spec.ts`.
- `playwright.config.ts`: sem `TEST_DATABASE_URL`/`.env` o servidor recebe uma URL inalcançável, para os E2E sem banco antigos rodarem sem ambiente (verificado: 38 specs sem `.env`).
- Reexecução: lint, typecheck, build OK; coverage 5301 testes, 99,21% de linhas; `test:e2e` completo 206/206 em 3 execuções seguidas.
- Fotos: a chave segue `fotos/<22+ chars>.webp` (CHECK `salao_foto_chave_chk`), `fotos/demo-<salaoId>-<n>.webp`, não `demo/...` do desenho.
- Imagem gerada como PNG por `zlib` (não SVG): `detectarTipo` só aceita jpeg/png/webp e `sharp` só pode ser importado em `src/server/imagem`.
- O servidor do E2E registra `mensagem.fila_indisponivel` no log (sem worker/pg-boss no E2E, como previsto): ruído, não falha.
- Ids em `IDS_DEMO` não foi exportado como um record: há `ids(spec)` em `prisma/seed/plano.ts`.
