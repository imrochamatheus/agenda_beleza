# D-045 (E8.3) Design: assinatura, eventos, fila de mensagens e auditoria no painel do super admin

Fontes: `spec.md` (RN-1..15, CA-1..16), `web-design.md`, código de D-024/D-033/D-034/D-041/D-043/D-044.

## 1. Resumo e alternativas descartadas
Três páginas de leitura (`/admin/saloes/[id]/assinatura`, `/admin/mensagens`, `/admin/auditoria`) e UMA escrita (`reenviarMensagemAdmin`). Leituras: repositórios de plataforma pré-contexto (`repos/admin-*.ts`, padrão `admin-saloes.ts`), uma instrução SQL por lista (`count(*) OVER ()`, 20 por página, `LIMIT/OFFSET`, página máx. 500). DTOs sem E.164, sem nome de cliente e sem campos proibidos pela RN-9 (a projeção SQL já não os seleciona).

Decisões dos conflitos do web-designer:
1. **DataList: estender o componente.** Prop opcional e retrocompatível `detalhe?: (linha) => ReactNode | null` (renderiza `<tr><td colSpan>` logo abaixo da linha em >= 48rem; abaixo disso é um bloco do mesmo cartão) e `classeCelula?` em `Coluna` (para `min-width: max-content` do selo). Descartado o fallback `details` na célula Ação: empilha mal em 768 px e duplica CSS. Testes em `DataList.test.tsx` (sem `detalhe`: DOM idêntico ao atual).
2. **Filtro de salão: `Select` até 100 salões, acima disso campo de texto "Código do salão" (UUID).** O repo `listarSaloesParaFiltro(limite=100)` lê 101 linhas (`ORDER BY nome COLLATE "C", id`); se vier 101, o serviço devolve `{ modo: 'codigo' }`. Limite é constante `LIMITE_SELECT_SALOES` injetável no serviço para o teste de integração (cria 3 salões com limite 2). UUID malformado = filtro inválido ignorado (RN-13), não 500.
3. `ROTAS_ADMIN_EXISTENTES` += `adminMensagens`, `adminAuditoria`; o teste existente (`navegacao-admin.test.ts`: cada rota listada tem `page.tsx`) passa a cobri-las; `ROTAS.devAdminMensagens` novo.
4. Rótulos curtos do admin (`rotulosAdmin` em `src/server/admin/rotulos-admin.ts`, client-safe) são intencionalmente distintos de `mensagens/rotulos.ts` (D-043); a frase longa de D-043 aparece no detalhe de tentativas.

Alternativas descartadas: reenvio chamando `reenviarMensagem` e auditando depois (viola CA-2, auditoria fora da transação); keyset em vez de OFFSET (UI é Anterior/Próxima, teto 500 mitiga R-1); busca por nome de salão (fora do escopo).

## 2. Componentes afetados
- `src/server/mensagens/reenviar.ts` (+`tipos.ts`): refatorar (ver 3).
- `src/server/auditoria/tipos.ts`: `ACOES_AUDITAVEIS += 'mensagem.reenviar'`, `ENTIDADES_AUDITAVEIS += 'mensagem'`, `ACOES_COM_ANTES_DEPOIS += 'mensagem.reenviar'`.
- Repos (novos, pré-contexto, só usados depois de `exigirAcessoAoAdmin`/`defineAcaoAdmin`): `src/server/repos/admin-mensagens.ts`, `admin-auditoria.ts`, `admin-assinatura.ts`.
- Serviços (sem `next/*`): `src/server/admin/{mensagens,auditoria,assinatura}.ts`, `*-tipos.ts` (client-safe), `*-validacao.ts` (puro), `rotulos-admin.ts`, `mensagens.acao.ts` (admin).
- `src/lib/format.ts`: `mascararTelefone` (única formatação permitida lá), `formatarDiaCivil`.
- Páginas: `src/app/admin/mensagens/{page.tsx,acoes.ts}`, `src/app/admin/auditoria/page.tsx`, `src/app/admin/saloes/[id]/assinatura/page.tsx` + `_componentes`.
- Compartilhados `src/app/admin/_componentes/{SeloDeEstado,FiltrosGet,AntesDepois,JsonLegivel}.tsx(+css)`; `src/components/ui/DataList*`; `src/config/navegacao.ts`; links em `CabecalhoDoSalao`/`PainelDoSalao`.
- `/dev/admin-mensagens`, E2E, README, seed opcional.

## 3. Interfaces
**Reenvio (RN-6).**
```ts
// mensagens/reenviar.ts
export async function reenviarNoRepos(r: Repos, ctx: ContextoEscopado, id: string, agora: Date): Promise<ResultadoReenvioRepo>; // r.mensagens.reenviar com conferirVigencia
export async function enfileirarReenvio(r: ResultadoReenvioRepo & {resultado:'reenfileirada'}, deps?: DependenciasEnfileirar): Promise<ResultadoReenvio>; // pós-commit, enfileirarUma, nunca lança
export async function reenviarMensagem(ctx, id, agora, deps?) // contrato INALTERADO = emTransacao(reenviarNoRepos) + enfileirarReenvio
```
```ts
// admin/mensagens.ts
reenviarMensagemAdmin(ctx: ContextoAdmin, id: string, agora: Date, deps?): Promise<
  | { resultado: 'reenfileirada'; mensagemId: string; filaIndisponivel: boolean }
  | { resultado: 'recusada'; motivo: 'nao_falhou' | 'obsoleta' | 'cliente_anonimizada' }>
```
Fluxo: `ehUuid` senão `NaoEncontrado`; `repos/admin-mensagens.salaoDaMensagem(id)` (pré-contexto; ausente → `NaoEncontrado`, igual ao malformado); `contextoDeSistema(salaoId)`; UMA `emTransacao`: `mensagem FOR UPDATE` (dentro de `reenviar`) → transição → `registrarAuditoria('mensagem.reenviar', entidade 'mensagem', entidadeId = id, salaoId, antes {estado:'falhou'}, depois {estado:'pendente', tipo, revisao})` com o MESMO executor/`Repos` (dev confirma que `registrarAuditoria` aceita o executor da transação; se não aceitar, estender a assinatura com parâmetro opcional `db`, mantendo chamadas atuais). Em `recusada/cliente_anonimizada` audita com `depois.estado='cancelada_anonimizacao'` (RN-7); `nao_falhou`/`obsoleta` não auditam. Falha na auditoria lança e desfaz a volta a `pendente` (CA-2). Após commit: `enfileirarReenvio`. Chamado exatamente uma vez ao adaptador: só o worker (`enviarMensagem`).
Ação: `reenviarMensagemAcao = defineAcaoAdmin(async (ctx, {mensagemId}, {agora}) => reenviarMensagemAdmin(...))` em `src/server/admin/mensagens.acao.ts`; shell `src/app/admin/mensagens/acoes.ts` (`'use server'`): lê `FormData`, chama, `redirect` PRG para `?reenvio=ok|ok_fila|recusada|obsoleta|anonimizada` (lista fechada; mapa resultado→código em `mensagens-tipos.ts`; 401/403/404 propagam como nas ações da D-044).

**Leitura.**
```ts
listarMensagens(ctx, filtrosBrutos, agora): { itens: MensagemAdminDTO[]; total; pagina; paginas; filtros; ignorados: boolean; salaoSelect: {modo:'select'; opcoes:{id,nome}[]} | {modo:'codigo'} }
detalheDeTentativas(ctx, id): { mensagem: MensagemAdminDTO; tentativas: TentativaAdminDTO[] }   // 404 se ausente/malformado
confirmacaoDeReenvio(ctx, id): MensagemAdminDTO | null
listarAuditoria(ctx, filtrosBrutos): { itens: RegistroAuditoriaDTO[]; total; ...; erros: {de?: string; ate?: string; ator?: string} }
lerAssinaturaDoSalao(ctx, salaoId): { salao:{id,nome,fuso}; assinatura: ResumoAssinaturaDTO | null; transicoes: TransicaoDTO[]; eventos: EventoDTO[]; maisEventos: boolean }  // salão inexistente/malformado → NaoEncontrado
```
`MensagemAdminDTO = { id; salaoId; salaoNome; tipo; revisao; estado; erroCodigo: string|null (já filtrado por ^[a-z0-9_]{1,40}$); paraMascarado: string ('Cliente removida' | '+55 (71) 9****-1234' | '—'); criadaEm; atualizadaEm; enviadaEm }`. Máscara aplicada no serviço (o repo devolve `destinatario_e164` e `anonimizada_em` só ao serviço; DTO público não tem o campo; teste de tipo/chaves do DTO). `mascararTelefone(v: unknown): string` pura: E.164 BR 13 dígitos → `+55 (DD) 9****-NNNN`, 12 → `+55 (DD) ****-NNNN`, resto/null → `—`, nunca lança.
Filtros (`*-validacao.ts`, puros): UUID via `ehUuid`; estado/tipo/ação/resultado por lista fechada; ator = e-mail minúsculo exato (<= 254); datas `YYYY-MM-DD` ou `dd/mm/aaaa`; `de > ate` → erro de campo e período ignorado; `pagina` `^[1-9]\d{0,6}$` senão 1, teto 500. Período: `intervaloDeDiasInteiros('America/Sao_Paulo', de, ate)` de `src/server/tempo/fuso.ts` (`>= inicio AND < fim`, meio-aberto; nunca `Date` local).
SQL: filtros com `(${x}::text IS NULL OR col = ${x})`; `estado`/`tipo` comparados como `m.estado::text = ${x}` (a fila global não usa índice parcial, então parâmetro é ok); ordem `ORDER BY criado_em DESC, id DESC` / `ocorrido_em DESC, id DESC`. Filtro de ator: `a.ator_id IN (SELECT id FROM usuario WHERE email = ${e}) OR a.ator_email_informado = ${e}` (DBA avalia o plano). Tentativas: `ORDER BY numero`, projeção sem `erro_detalhe`. Assinatura: transições `JOIN assinatura WHERE salao_id` `ORDER BY ocorrida_em DESC, id DESC LIMIT 50`; eventos `WHERE salao_id ORDER BY recebido_em DESC, id DESC LIMIT 51` (51 → `maisEventos`); resumo mostra `vinculada` boolean (`provedor_assinatura_id IS NOT NULL`), nunca o id; `causa` truncada em 80; `erro` do webhook só se pertencer a `CodigoErroWebhook`; `payload` como gravado. Eventos sem `salao_id` não aparecem (suposição 1 do spec).
Fuso: assinatura usa o fuso do salão (`format.ts`); mensagens/auditoria `America/Sao_Paulo` fixo com `formatarDeslocamentoUtc`.

## 4. Dados
Sem coluna nova (`auditoria.acao` é TEXT). **DBA: SIM** (`docs/demandas/D-045/dba.md`): parecer de plano com 100 mil mensagens e 200 mil auditorias (`EXPLAIN` das consultas reais, com `count(*) OVER ()`) para: `mensagem (criado_em DESC, id DESC)`, `mensagem (estado, criado_em DESC, id DESC)` e `(tipo, ...)` se justificado; `auditoria (acao, ocorrido_em DESC, id DESC)` e, se preciso, trocar/estender `ocorrido_em DESC` por `(ocorrido_em DESC, id DESC)` para evitar Sort; filtro de e-mail do ator (`ator_email_informado`, `usuario.email` já tem unique). Também avaliar se `count(*) OVER ()` é aceitável ou se o total deve ser consulta separada. Migração só se justificada (SQL revisado, `CREATE INDEX` simples; nunca `CONCURRENTLY` dentro de migração Prisma sem decisão do DBA). Se o DBA dispensar, a tarefa T-1 registra o parecer e as consultas ficam como estão.

## 5. Infraestrutura
Sem variável de ambiente, container ou job de CI novo. **DevOps: dispensado** (E2E novos entram no `npm run test:e2e` existente; README é do desenvolvedor).

## 6. Verificação das invariantes
- Escopo por salão no servidor: não se aplica ao admin (sem salão), mas o reenvio usa `salao_id` lido da linha, nunca do formulário; `NaoEncontrado` igual para malformado/inexistente; páginas e ação exigem admin com TOTP (`exigirAcessoAoAdmin`, `defineAcaoAdmin`); teste CA-6 com sessão de salão e admin sem TOTP.
- Exclusion constraint: não toca `reserva`; não se aplica.
- UTC/fuso: armazenado em UTC; exibição por `format.ts`; filtro de período por `fuso.ts`; testes em `TZ=UTC` e `America/Sao_Paulo`.
- Adaptadores: reenvio só enfileira; adaptador chamado só pelo worker; testes com WhatsApp simulado.
- Soft delete/anonimização: cliente anonimizada = "Cliente removida", nunca dígitos; `cancelada_anonimizacao` auditado.
- Suspenso somente leitura: o reenvio vale também para salão suspenso (RN-8; é operação de plataforma sobre o pipeline); teste explícito.
- Idempotência: `singletonKey` = `reserva:tipo:revisao`; reenviar x reenviar → 1 `reenfileirada`, 1 `nao_falhou`, 1 auditoria, 1 job, 1 envio; PRG evita repetição ao recarregar.
- Auditoria do super admin: `mensagem.reenviar` na mesma transação; leituras NÃO auditam (RN-3, teste de contagem).
- Ordem de travas: reenvio trava só `mensagem` (sem cliente, como D-024); `reconciliar-mensagens` usa `SKIP LOCKED` em `pendente/enviando`, a linha `falhou` do reenvio não conflita: sem impasse. Registrar no cabeçalho de `repos/servico.ts` que `auditoria` vem depois de `mensagem`.

## 7. Riscos e decisões
- R-2 regressão D-024/E7.3: `reenviarMensagem` mantém assinatura; rodar `tests/integration/mensagens` inteira.
- R-3/R-4 vazamento: projeção SQL sem campos proibidos + teste de chaves do DTO + varredura do HTML por E.164 e 9 dígitos de celular (CA-5/CA-8). Sem E.164 em atributo, `title`, `aria-label`, `data-*`.
- OFFSET profundo: teto 500 e parecer do DBA.
- `registrarAuditoria` com executor da transação: verificar cedo (T-3); se exigir mudança, ela fica em T-2.
- Corrida `?confirmar=` obsoleta: página mostra "não está mais com falha" (sem botão); POST direto cai em `recusada`.
- Correção da quebra de selo (nowrap >= 48rem, `min-width: max-content` na célula, `SeloDeEstado` movido para `admin/_componentes`): teste de CSS em `Saloes.test.tsx` e E2E de altura do selo em 768/1280.

## 8. Estratégia de testes
- Unitários (Vitest): `mascararTelefone` (CA-5, nulos/inválidos), validação de filtros/páginas/datas (CA-9/12/13), `rotulosAdmin`, filtro de `erro_codigo`, DataList `detalhe`, `SeloDeEstado`, componentes (`FiltrosGet`, `AntesDepois` com 16 KB e chaves longas), `navegacao-admin` (CA-16), DTO sem chaves proibidas.
- Integração (PostgreSQL real): CA-1 (3 eventos, 1 rejeitado, outro salão não aparece), CA-2 (worker real + sim_*; falha forçada na auditoria desfaz), CA-3 (cada estado ≠ `falhou`, POST direto), CA-4, CA-6 (401/403 via `defineAcaoAdmin`), CA-7 (zero linhas em `auditoria` após leituras), CA-9, CA-10, CA-11 (concorrência x10 e reenvio x reconciliação, `pg_stat_activity`), CA-12 (virada de dia 02:30 UTC; dois fusos), CA-13, CA-15 (plano com volume, impresso `[CA-15]`).
- Playwright via `/dev/admin-mensagens` (sem banco): CA-14 (GET `?confirmar`, POST, PRG `?reenvio=` para cada código), teclado, axe 4.14.0 em 375x812 em todos os estados do web-design §9.12, sem JS, sem rolagem horizontal, selo de uma linha em 768/1280. Vitrine usa as mesmas funções puras e ação validate-only.
- Cobertura >= 90% de linhas mantida porque todo código novo tem testes de unidade ou integração; páginas finas são exercidas por integração/E2E dos serviços.

## 9. Tarefas
Posse sem sobreposição entre tarefas paralelas.

- **T-1 (dba)** — dep.: nenhuma. Arquivos: `docs/demandas/D-045/dba.md`, `prisma/migrations/*_d045_*` e as linhas `@@index` em `prisma/schema.prisma` (só se justificar). Entrega: parecer com planos (100 mil/200 mil) e migração ou dispensa. Conclusão: CA-15 respondido. Paralela a T-2, T-3, T-5.
- **T-2 (desenvolvedor)** — dep.: nenhuma. Arquivos: `src/lib/format.ts`, `src/lib/format.test.ts`, `src/server/auditoria/tipos.ts` (+testes), `src/server/admin/rotulos-admin.ts(+test)`. Entrega: `mascararTelefone`, `formatarDiaCivil`, vocabulário de auditoria, rótulos admin. Conclusão: unitários verdes, `TZ` duplo.
- **T-3 (desenvolvedor)** — dep.: nenhuma. Arquivos: `src/server/mensagens/reenviar.ts`, `reenviar.test.ts`, `tipos.ts` (apenas tipos de reenvio), `src/server/auditoria/registrar.ts` (somente se precisar aceitar o executor). Entrega: `reenviarNoRepos`/`enfileirarReenvio`. Conclusão: suíte `tests/integration/mensagens` inalterada e verde. (Se tocar `registrar.ts`, não sobrepõe T-2: T-2 só edita `tipos.ts` da auditoria.)
- **T-4a (desenvolvedor)** — dep.: T-2. Arquivos: `repos/admin-assinatura.ts`, `src/server/admin/assinatura{,-tipos,-validacao}.ts`, `tests/integration/admin/assinatura.test.ts`. CAs: 1, 13 (parte), 6 (página).
- **T-4b (desenvolvedor)** — dep.: T-2, T-3 (T-1 para o plano). Arquivos: `repos/admin-mensagens.ts`, `src/server/admin/mensagens{,-tipos,-validacao}.ts`, `mensagens.acao.ts`, `tests/integration/admin/mensagens*.test.ts`, `tests/integration/admin/concorrencia-reenvio.test.ts`. CAs: 2, 3, 5, 6, 7, 8, 9, 10, 11, 15.
- **T-4c (desenvolvedor)** — dep.: T-2 (T-1 para o plano). Arquivos: `repos/admin-auditoria.ts`, `src/server/admin/auditoria{,-tipos,-validacao}.ts`, `tests/integration/admin/auditoria*.test.ts`. CAs: 4, 7, 12, 15.
  T-4a/b/c rodam em paralelo.
- **T-5 (desenvolvedor)** — dep.: nenhuma (usa só tipos da T-2 via import estável; se faltar, stubs locais). Arquivos: `src/components/ui/DataList*`, `src/app/admin/_componentes/*`, `src/app/admin/saloes/_componentes/{SeloDeEstado (remover),Saloes.module.css,Saloes.test.tsx,ListaDeSaloes.tsx,CabecalhoDoSalao.tsx,PainelDoSalao.tsx}`, `src/config/navegacao.ts`, `navegacao-admin.test.ts`. Entrega: componentes compartilhados, correção do selo, menu, links. Paralela a T-1..T-4.
- **T-6 (desenvolvedor)** — dep.: T-4a, T-5. Arquivos: `src/app/admin/saloes/[id]/assinatura/**`. CAs: 1, 13.
- **T-7 (desenvolvedor)** — dep.: T-4b, T-5. Arquivos: `src/app/admin/mensagens/**`. CAs: 3, 5, 9, 10, 14.
- **T-8 (desenvolvedor)** — dep.: T-4c, T-5. Arquivos: `src/app/admin/auditoria/**`. CAs: 4, 12.
  T-6/T-7/T-8 em paralelo.
- **T-9 (desenvolvedor)** — dep.: T-6, T-7, T-8. Arquivos: `src/app/dev/admin-mensagens/**`, `e2e/admin-mensagens*.spec.ts`, `e2e/admin-assinatura*.spec.ts`, `e2e/admin-auditoria*.spec.ts`, `README.md`, `.github` (não), seed opcional `prisma/seed*`. Conclusão: E2E verdes, README com telas/reenvio/o que não aparece.
- **T-10 (desenvolvedor)** — dep.: T-9. Gate: lint, typecheck, build, `npm run test:coverage` >= 90%, estabilidade x10 da concorrência, CLAUDE.md atualizado (resumo D-045).

Mapa CA → tarefa: CA-1 T-4a/T-6; CA-2/3/11 T-3/T-4b; CA-4/12 T-4c/T-8; CA-5/8/9/10 T-4b/T-7; CA-6/7 T-4a-c; CA-13 T-4a/T-6; CA-14 T-7/T-9; CA-15 T-1; CA-16 T-5/T-10.
