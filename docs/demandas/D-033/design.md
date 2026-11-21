# D-033 (E8.1) — Design: log de auditoria

## 1. Solução
Serviço somente-escrita em `src/server/auditoria/` + `src/server/repos/auditoria.ts` (único que toca a tabela). Sem migração. Descartado: redação silenciosa de chaves (esconde bug; RN-5 manda falhar); `r?` opcional (abriria transação própria e quebraria RN-2); trigger no banco para gravar auditoria (acopla ao SQL e não conhece o ator).

## 2. Componentes
- `src/server/tenant/context.ts`: `exigirAdmin(ctx: unknown): AdminContext` — lança `Error` se `ctx` não for objeto congelado com `tipo==='admin'` e `usuarioId` UUID (mesmo estilo de `exigirEscopo`).
- `src/server/repos/auditoria.ts`: `RepoAuditoria { inserir(e: EntradaAuditoriaValidada): Promise<{id:string}> }`, `criarRepoAuditoria(db: Executor)`; INSERT via `db.auditoria.create` (Prisma, sem SQL). `Repos.auditoria` em `repos/index.ts`. Exporta também `inserirAuditoriaIndependente(e)` = `criarRepoAuditoria(obterPrisma()).inserir(e)` (cliente global, fora de qualquer transação do chamador). Só esse arquivo menciona `auditoria`.
- `src/server/auditoria/tipos.ts` (client-safe): `ACOES_AUDITAVEIS`, `ENTIDADES_AUDITAVEIS` (`as const`), tipos `AcaoAuditavel`/`EntidadeAuditavel`/`JsonObjeto`, `ACOES_COM_ANTES_DEPOIS` (`avaliacao.retirar|restaurar`, `salao.renomear`), classes `ErroAuditoriaEntrada` e `ErroAuditoriaSegredo` (mensagem só com o caminho da chave), limites (`MAX_BYTES=16384`, `MAX_PROFUNDIDADE=6`, `MAX_ACAO=64`, `MAX_ENTIDADE_ID=64`, `MAX_EMAIL=254`).
- `src/server/auditoria/sanitizar.ts` (puro): `validarJson(v, caminho)` (JSON puro, profundidade, ciclos via WeakSet, `Buffer.byteLength(JSON.stringify)` UTF-8) e `rejeitarSegredos(v)`.
- `src/server/auditoria/registrar.ts` (sem `next/*`, sem Prisma): `registrarAuditoria`, `registrarFalhaAuditoria`, `montarEntrada` (validação comum: vocabulário, regex RN-7, UUIDs, antes/depois obrigatórios, e-mail minúsculo sem controle).

## 3. Interfaces
```ts
registrarAuditoria(ctx: AdminContext, e: { acao; entidade; entidadeId: string; salaoId?: string|null;
  antes?: JsonObjeto|null; depois?: JsonObjeto|null }, r: Repos): Promise<{ id: string }>
registrarFalhaAuditoria(e: { acao; entidade?; entidadeId?; salaoId?; atorId?: string|null;
  atorEmailInformado?: string|null; antes?; depois? }): Promise<void>
```
`registrarAuditoria`: `exigirAdmin(ctx)` → `montarEntrada` (ator = `ctx.usuarioId`, resultado fixo `sucesso`) → `r.auditoria.inserir`. Qualquer erro propaga e desfaz a transação do chamador (RN-2). FK 23503 (salão inexistente) propaga como erro de banco: é o "falha forçada" de CA-2.
`registrarFalhaAuditoria`: mesma validação, `resultado` fixo `falha`, grava com `inserirAuditoriaIndependente` (conexão própria do pool, INSERT atômico implícito). Contrato: chamar no `catch`, DEPOIS do rollback. Risco de self-wait: o INSERT só toma `FOR KEY SHARE` em `usuario`/`salao`; só bloqueia se a transação do chamador ainda segurar `FOR UPDATE` nessas linhas (docs na JSDoc; CA-4 cobre o caso seguro). Falha de gravação propaga (E1.5 nega o acesso do mesmo jeito).

## 4. Sanitização (RN-5) — decisão sobre falso positivo
Chave normalizada = minúsculas, só `[a-z0-9]`. Duas listas:
- Substring (termos longos, sem palavra comum que os contenha): `senha, password, passwd, hash, totp, token, secret, segredo, cookie, authorization, apikey, chaveapi, credencial, cvv, cartao, cardnumber`.
- Igualdade exata (curtos, com falso positivo em substring: `panorama`, `capital`, `hotpot`, `footprint`): `pan`, `otp`, `pin`.
Efeito colateral aceito: `tokenHash`, `totpSecret` continuam pegos pelas substrings; `otpCode` não é pego por `otp` exato, mas entra via nova entrada `otpcode`/`codigootp` na lista exata. Teste de tabela cobre cada termo (substring, exata, e negativos `panorama`, `capital`, `nome`, `slug`, `ocultaEm`, `motivo`). Varredura recursiva em objetos e arrays, caminho no erro (`depois.a[2].senha`), valores nunca lidos nem citados. Valores livres (R-2) ficam por convenção.

## 5. Dados / infra
Sem migração, sem DBA: colunas, FKs, índices (`ocorrido_em`, `salao_id+ocorrido_em`, `ator_id+ocorrido_em`) e triggers existentes bastam para insert-only; E8.3 consulta pelos índices. Sem DevOps: nenhuma variável, container ou CI.

## 6. Invariantes
- Escopo por salão: não se aplica a tenant (nenhum método em repos de tenant; admin informa `salaoId` como dimensão). Anti-sobreposição, soft delete, suspensão, webhooks: não se aplicam (auditoria grava mesmo com salão suspenso).
- UTC: `ocorrido_em` default `now()` do banco; sem conversão.
- Adaptadores: nenhum. Idempotência: não se aplica (cada ação, uma linha).
- Auditoria do super admin: é o objeto desta demanda; ator nunca vem do chamador.
- Insert-only: nenhum UPDATE/DELETE/TRUNCATE em código de produção; triggers como rede de segurança.

## 7. Riscos
R-1 `registrarFalhaAuditoria` esgota pool se muito concorrente (INSERT curto, pool 10; E1.5 já limita taxa de login). R-2 PII em valor livre (convenção + JSDoc). R-3 dono do banco desliga triggers (já registrado na E0.4). R-4 lista de chaves pode escapar nomes inusitados (aceito; revisar a cada ação nova, entra no vocabulário por PR).

## 8. Testes
Unidade (`src/server/auditoria/*.test.ts`): sanitizar (tabela CA-5, limites CA-7), vocabulário (formato, duplicata), `montarEntrada`, `exigirAdmin` (CA-6), e-mail. Integração (`tests/integration/auditoria/`, PostgreSQL real; leitura por Prisma em `tests/support/auditoria.ts`): CA-1, CA-2 (mutação de `salao.nome` + `salaoId` inexistente → 23503 e `depois` > 16 KiB → mutação revertida, 0 linhas), CA-4 (falha dentro de `emTransacao` que dá `throw` → linha persiste; e no `catch`), CA-8, CA-9, CA-10 (20 paralelas + `FOR NO KEY UPDATE` no salão), CA-3 reconfirma `P0001` via SQL direto. Estático (`tests/integration/auditoria/estatico.test.ts`, sem banco): CA-3 (percorre `import.meta.glob('/src/**/*.acao.ts')` com `verificarAcoes` e a fonte de `src/app/api/**` sem referência a `auditoria`; grep em `src/**` não-teste: `UPDATE|DELETE|TRUNCATE` + `auditoria` zero) e CA-11 (`prisma.auditoria`/`"auditoria"` só em `repos/auditoria.ts`; `src/server/auditoria/**` sem import de `@/generated`, `@/server/repos/db`, `next/*`). Lint: regra existente já restringe Prisma a `repos/**` (confirmar e acrescentar `src/server/auditoria/**` ao bloco se necessário). CA-12: loop `TZ=UTC` e `TZ=America/Sao_Paulo`. Cobertura ≥ 90% por esses testes (módulo pequeno, todos os ramos exercitados).

## 9. Tarefas (responsável: desenvolvedor; sem DBA/DevOps)
- T-1 (sem dependência): `tipos.ts`, `sanitizar.ts`, `exigirAdmin` em `tenant/context.ts` + testes de unidade. Posse: `src/server/auditoria/{tipos,sanitizar}.ts` e `.test.ts`, `src/server/tenant/context.ts` e seu teste.
- T-2 (depende de T-1): `repos/auditoria.ts`, `Repos.auditoria` (`repos/index.ts`), `registrar.ts`, `tests/support/auditoria.ts`. Posse: esses arquivos + `src/server/auditoria/registrar.ts`.
- T-3 (depende de T-2): testes de integração e estático (CA-1..CA-12), ajuste de lint se preciso (`eslint.config.*`). Posse: `tests/integration/auditoria/**`, eslint config.
- T-4 (depende de T-2, paralela a T-3 pois posse disjunta): cabeçalho da ordem de travas em `repos/servico.ts` (RN-10), seção do módulo no CLAUDE.md/README. Posse: `repos/servico.ts` (só o comentário), CLAUDE.md, README.
