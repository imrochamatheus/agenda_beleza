# D-032 (E4.5) Avaliações verificadas — design

Entradas lidas: `spec.md`; `mensagens/envio.ts` (`produzirLink`, `GeradorLinkAvaliacao` = `(ctx: SistemaContext, reservaId) => Promise<string>`); `worker/handlers/whatsapp-reserva.ts` (`gerarLink: deps.gerarLink`, hoje indefinido); `clientes/anonimizar.ts` (`AoAnonimizar(ctx, {clienteId, agora}, r)`, dentro da transação, depois de `mensagens.anonimizarDaCliente`); `protecao/limite.ts` (`limitarPorIp(ip,'avaliacao',agora)`), `protecao/turnstile.ts` (`verificarHumano`); `reserva-publica` e `(publico)/[slug]` (`resolverSalaoPorSlug` devolve `{contexto, slugAtual, historico}`); `config/termos.ts` (`FINALIDADES` já tem `publicacao_avaliacao`, `TEXTOS_CONSENTIMENTO.publicacao_avaliacao` já existe); `env.ts`/`protecao/config.ts` (padrão `RATE_LIMIT_SEGREDO`).

## 1. Solução e alternativas
Convite com link individual: o gerador (injetado em `whatsapp-reserva.ts`) deriva o token por HMAC, grava só o hash em `avaliacao_convite` e devolve o link. A rota pública `/{slug}/avaliar/[token]` verifica em tempo de uso (reserva `concluido`, cliente não anonimizada, não usado, não invalidado, não vencido) e a Server Action grava a `avaliacao` em uma transação que trava o convite `FOR UPDATE`. A leitura pública usa um único predicado de visibilidade.
Descartadas: (a) token aleatório gravado: reenvio geraria links diferentes e exigiria guardar o claro; (b) autenticar por reserva+telefone: proibido (RN-1); (c) invalidar o convite ao mudar o status em `alterar-status.ts`: acoplamento novo, a verificação em tempo de uso basta (RN-6); (d) captura de 23505 para a unicidade: troca por trava de linha + `UPDATE … WHERE usado_em IS NULL` (§3.3); (e) rota `/avaliar/<token>` sem slug: o spec fixa `/{slug}/avaliar/<token>`.

## 2. Componentes
- `src/server/avaliacoes/` (sem `next/*`, sem `'use server'`, sem `*.acao.ts`: não há ação de equipe): `tipos.ts` (client-safe: limites, `MENSAGEM_LINK_INVALIDO = 'Link inválido ou expirado.'`, mensagens pt-BR, `ResultadoEnvio`), `token.ts` (HMAC, hash, formato), `validacao.ts` (pura), `nome.ts` (`nomeDeExibicao`), `convite.ts` (`gerarLinkAvaliacao`), `servico.ts` (`verificarLink`, `enviarAvaliacao`), `leitura.ts` (`lerAvaliacoesPublicas`), `anonimizar.ts` (`aoAnonimizarAvaliacoes`), `config.ts` (`segredoDeAvaliacao(fonte)`).
- `src/server/repos/avaliacao.ts` (`Repos.avaliacoes`, escopado) e `src/server/repos/avaliacao-publica.ts` (pré-contexto/público: `buscarConvitePorHash`, `lerPublicas`; usa `ContextoPublico`). Único lugar com Prisma (regra de lint). Predicado único `ondeAvaliacaoVisivel(salaoId)` em `repos/avaliacao-publica.ts` (SQL `$queryRaw` com fragmento compartilhado `VISIVEL`: `a.retirada_em IS NULL AND r.status = 'concluido' AND c.anonimizada_em IS NULL`, joins `reserva r` e `cliente c` por `(salao_id, id)`), usado por média, contagem e lista (1 instrução com `count(*)`, `avg(nota)` e a lista via `LATERAL`/CTE; ou 2 instruções fixas).
- Rota: `src/app/(publico)/[slug]/avaliar/[token]/page.tsx` (dinâmica, `generateMetadata` com `robots: noindex`), `acoes.ts` (shell `'use server'`: IP, `agora = new Date()`, converte FormData), `FormularioAvaliacao.tsx` (client; um `useActionState`), `formulario.ts` (puro: FormData → entrada, `paraEstado`). `ROTAS.avaliar(slug, token)` e `ROTAS.devAvaliacao` em `src/config/navegacao.ts`. `SEGMENTOS_RESERVADOS` inalterado (sub-rota).
- Cabeçalhos em `next.config.ts` para `/:slug/avaliar/:token`: `Referrer-Policy: strict-origin` (nunca `no-referrer`, que quebra POST sem JS), `Cache-Control: no-store`, `X-Robots-Tag: noindex`. Verificar que a regra do `[slug]` genérico não prevaleça (testar o cabeçalho real no E2E, CA-16).
- Seção na E4.1: `src/app/(publico)/[slug]/_componentes/SecaoAvaliacoes.tsx` (server component, recebe DTO pronto), chamada em `PaginaDoSalao`/`page.tsx` via `lerAvaliacoesPublicas(r.contexto)`; não é lida para slug histórico (esse caso redireciona 308).
- Worker: `whatsapp-reserva.ts` passa `gerarLink: deps.gerarLink ?? gerarLinkAvaliacao` (uma linha).
- Gancho: `anonimizarCliente` usa `aoAnonimizarPadrao`; mudar o padrão em `clientes/anonimizar.ts` para `aoAnonimizarAvaliacoes` cria import de `clientes` → `avaliacoes`. Decisão: `aoAnonimizarPadrao` passa a chamar `r.avaliacoes.anonimizarDaCliente` diretamente (sem importar o serviço), mantendo `deps.aoAnonimizar` para testes. Arquivo `anonimizar.ts` do módulo de avaliações fica só como a função chamada.
- `/dev/avaliacao` (`src/app/dev/avaliacao/`, 404 sem `VITRINE_COMPONENTES=true`/`next dev`): mesmo `FormularioAvaliacao` com ação só de validação (sem banco); `?vista=invalido` mostra a resposta uniforme.

## 3. Interfaces
### 3.1 Token (`token.ts`)
```ts
export function gerarToken(segredo: string, salaoId: string, reservaId: string): string; // base64url(HMAC-SHA256(segredo, `convite-avaliacao:${salaoId}:${reservaId}`)) = 43 chars
export function hashDoToken(token: string): string;       // sha256 hex
export function tokenPlausivel(t: unknown): t is string;  // /^[A-Za-z0-9_-]{43}$/ antes de qualquer consulta
```
Segredo: `segredoDeAvaliacao(env)`: ≥ 32; ausente em produção lança; fora de produção padrão fixo explícito (D-2, igual `protecao/config.ts`). Comparação: o token nunca é comparado; busca-se por igualdade do `token_hash` (índice UNIQUE, valor derivado do que o cliente enviou), e a validade é lida da linha. Quando o código precisar comparar hashes em memória usa `timingSafeEqual` sobre buffers do mesmo tamanho. Token só em memória até a chamada ao adaptador (RN-2/RN-15).

### 3.2 Gerador (`convite.ts`)
`gerarLinkAvaliacao: GeradorLinkAvaliacao`. Em uma transação (`emTransacao`, ctx de sistema): `SELECT r.status, s.slug FROM reserva r JOIN salao s … WHERE r.salao_id=$ctx AND r.id=$id` (sem trava; só leitura); se não `concluido` → lança `Error` (vira `link_indisponivel` permanente em `produzirLink`). `INSERT INTO avaliacao_convite (salao_id, reserva_id, token_hash, expira_em, …) VALUES (…, $agora + interval '30 days') ON CONFLICT (reserva_id) DO NOTHING` (não renova). Retorna `${APP_URL}/${slug}/avaliar/${token}` (slug atual; `APP_URL` sem barra final). Relógio: `agora` injetado como segundo parâmetro opcional `deps` (o tipo `GeradorLinkAvaliacao` fica; fábrica `criarGeradorLink({ agora, segredo })` para testes).

### 3.3 Envio (`servico.ts`)
```ts
type EntradaEnvio = { slug: string; token: string; nota: unknown; comentario: unknown; aceite: unknown; ip: string; tokenHumano: string | null };
type ResultadoEnvio =
  | { resultado: 'enviada' }
  | { resultado: 'invalido_campos'; erros: Partial<Record<'nota'|'comentario'|'aceite', string>> }
  | { resultado: 'link_invalido' }        // RN-4
  | { resultado: 'limite_excedido' }      // 429
  | { resultado: 'verificacao_falhou' };
enviarAvaliacao(entrada, agora, deps?): Promise<ResultadoEnvio>
verificarLink(slug, token, ip, agora): Promise<{ ok: true; nomeSalao: string; slugAtual: string; historico: boolean } | { ok: false; motivo: 'invalido' | 'limite' }>
```
Ordem do envio: (1) `limitarPorIp(ip,'avaliacao',agora)` antes de tocar o token (CA-12); (2) `verificarHumano` (CA-13; falha não consome o link); (3) validação pura de campos (nota inteira 1–5 só por `/^[1-5]$/` em string ou inteiro; comentário trim + colapso, ≤ 1000 code points, `\u0000` removido; aceite estrito como `consentimento/validacao.ts`) — erro de campo só é devolvido depois de confirmar que o link é válido, para não virar oráculo; link inválido tem prioridade e é uniforme; (4) `resolverSalaoPorSlug` (atual ou histórico; slug inexistente ou implausível → `link_invalido`, uniforme) → `salaoId`; (5) transação READ COMMITTED:
 1. `SELECT … FROM avaliacao_convite WHERE salao_id=$1 AND token_hash=$2 FOR UPDATE` (ausente → `Desfazer('invalido')`).
 2. Reler em UM comando o contexto sem trava extra: `JOIN reserva r … JOIN cliente c …` com `FOR KEY SHARE OF r, c`? Evitar: ordem canônica é salão → … → cliente → reserva → … → avaliacao; o convite é a última entidade. Decisão: tomar o convite com `FOR UPDATE` primeiro quebra a ordem (convite depois de reserva/cliente). Para respeitar a ordem e não gerar impasse com `alterar-status` (reserva `FOR UPDATE`/`NO KEY UPDATE`) e anonimização (salão `NO KEY UPDATE` → cliente `FOR UPDATE`): ordem do envio = `reserva` e `cliente` lidos com `FOR SHARE` (reserva, depois cliente, por id) ANTES do convite. Como o hash identifica a linha do convite sem trava, passo 0 é uma leitura sem trava `convite → (reserva_id, cliente_id)`; depois `SELECT … FROM reserva … FOR SHARE` → `cliente … FOR SHARE` → `avaliacao_convite … FOR UPDATE` (releitura) → validações RN-5 sobre as linhas travadas → `INSERT INTO avaliacao … ON CONFLICT (reserva_id) DO NOTHING RETURNING id` → `UPDATE avaliacao_convite SET usado_em=$agora WHERE id=$ AND usado_em IS NULL`. Sem `FOR SHARE` na reserva o status poderia mudar entre a verificação e o commit; com ele, status e anonimização ficam congelados até o commit, e `alterar-status`/anonimização esperam (sem ciclo: eles não tomam convite/avaliação antes de reserva/cliente; anonimização toma avaliação por último).
 3. `RETURNING` vazio (o conflito existe) → `Desfazer('invalido')`, mas, como o convite foi travado e `usado_em` verificado antes, só ocorre com dados corrompidos; mesmo assim nunca lança 23505 dentro da transação.
 Resultado: com 10+ envios simultâneos o primeiro obtém `FOR UPDATE`, os demais esperam, releem `usado_em IS NOT NULL` e respondem RN-4: exatamente 1 avaliação, sem 23505. `nome_exibicao` calculado dentro da transação a partir de `cliente.nome` já travado (puro, `nomeDeExibicao`: NFC, split por espaços, 1º nome + inicial por code point do último + `.`; nome único só o nome; vazio/null → recusa como inválido).
 `versao_termos` = `VERSAO_TERMOS` (lido do config, nunca do chamador); `publicacao_aceita_em = agora`.
Sentinela interna `DesfazerAvaliacao` lançada na transação e capturada fora (padrão `DesfazerReserva`). Logs: só `{evento:'avaliacao.enviada'|'avaliacao.recusada', salaoId, avaliacaoId?, motivo}`; nunca token, nome, comentário.

### 3.4 Verificação (GET)
`verificarLink`: `limitarPorIp` (mesmo escopo; excedido → 429 genérico "Muitas tentativas. Tente novamente em alguns minutos." como E4.2); `tokenPlausivel`; slug; busca única `convite JOIN reserva JOIN cliente` por `(salao_id, token_hash)` com as condições de RN-5 no WHERE (uma instrução, mesma forma para todos os casos de falha: uniforme). Sem trava. Resposta inválida: HTTP 200 uniforme (decisão: mesmo status e mesmo corpo; a diferença 404×200 do slug inexistente seria um oráculo de slugs, mas slugs são públicos; ainda assim `slug` desconhecido também devolve a mesma página). Nada do conteúdo da reserva (serviço, profissional, data) aparece; a página mostra só o nome do salão.

### 3.5 Leitura pública
```ts
lerAvaliacoesPublicas(ctx: PublicoContext, limite = 10): Promise<{ total: number; media: number | null; itens: { nome: string; nota: number; comentario: string | null; mesAno: string }[] }>
```
Arredondamento: `round(avg(nota)::numeric, 1)` no SQL (meio-para-cima do numeric do PostgreSQL), formatado por `formatarNota` novo em `format.ts` (única fonte, "4,3"). Lista `ORDER BY a.criado_em DESC, a.id DESC LIMIT 10` (D-3); `mesAno` por `formatarMesAno(data, fuso)` novo em `format.ts` (fuso do salão). Projeção mínima (nunca `cliente_id`, `reserva_id`, telefone). Ignora suspensão/pendência (RN-11). Índice `(salao_id, criado_em DESC, id)`.

### 3.6 Anonimização (RN-10)
`RepoAvaliacao.anonimizarDaCliente(ctx, clienteId, agora)`: `UPDATE avaliacao SET nome_exibicao = NULL, comentario = NULL WHERE salao_id=$ AND cliente_id=$` e `UPDATE avaliacao_convite SET invalidado_em = $agora WHERE salao_id=$ AND reserva_id IN (SELECT id FROM reserva WHERE salao_id=$ AND cliente_id=$) AND invalidado_em IS NULL`. Roda depois de `mensagens` (avaliação e convite por último). `nome_exibicao` e `comentario` ficam nullable (a filtragem por `anonimizada_em` continua primária). Falha do gancho desfaz a anonimização (já é transação).

### 3.7 Termos (RN-7)
Texto do aceite do formulário: `TEXTOS_CONSENTIMENTO.publicacao_avaliacao` já existe e já cobre o uso. Não se muda o texto existente por si. Mas `CAMPOS_CONSENTIMENTO` e o rótulo do aceite do formulário de avaliação precisam de um campo novo (`aceite_publicacao`) e, se qualquer texto/parte for alterado (ex.: ajuste de redação para o contexto do formulário), a regra do guard é: nova `VERSAO_TERMOS` (`2026-11-22-provisorio`), nova `VIGENCIA_TERMOS` e NOVA entrada em `HASHES_POR_VERSAO` (calculada com o utilitário do `termos.test.ts`); a antiga permanece. Decisão: reaproveitar o texto existente SEM alterá-lo e adicionar só a constante de nome de campo `CAMPOS_AVALIACAO` em `src/config/avaliacao.ts` (fora do hash, que cobre só os textos) ⇒ nenhuma versão nova necessária. Se o desenvolvedor concluir que a Política (`#avaliacoes`) precisa de ajuste para cobrir o convite/link, aí sim: versão nova + hash novo, tarefa T-9 (condicional). `versao_termos` gravada em `avaliacao` é `VERSAO_TERMOS` vigente.

## 4. Dados (DBA: SIM, migração aditiva `20261122000000_avaliacao`)
`avaliacao_convite`: `id uuid pk`, `salao_id`, `reserva_id`, `token_hash text NOT NULL`, `expira_em timestamptz NOT NULL`, `usado_em`, `invalidado_em`, `criado_em`. `UNIQUE (reserva_id)`, `UNIQUE (token_hash)`, FK `(salao_id, reserva_id) → reserva(salao_id, id) RESTRICT`, CHECK `char_length(token_hash) = 64`, CHECK `expira_em > criado_em`.
`avaliacao`: `id`, `salao_id`, `reserva_id UNIQUE`, `cliente_id`, `nota smallint CHECK (nota BETWEEN 1 AND 5)`, `comentario text NULL CHECK (char_length(comentario) <= 1000)`, `nome_exibicao text NULL CHECK (char_length(nome_exibicao) <= 100)`, `publicacao_aceita_em timestamptz NOT NULL`, `versao_termos text NOT NULL` (mesmo CHECK de formato do `consentimento_versao_termos_chk`), `retirada_em`, `retirada_por uuid NULL` (sem FK: E8.4 decide; sem UI), `criado_em`. FKs compostas `(salao_id, reserva_id)` e `(salao_id, cliente_id)`; índice `(salao_id, criado_em DESC, id)`. A FK `cliente_id` precisa ser consistente com a reserva: o serviço grava o `cliente_id` da reserva travada (sem trigger). `tipo_mensagem`/`mensagem` não mudam. Modelos no `schema.prisma`, `drift.test.ts`, template. DBA avalia: ordem das travas §3.3, plano da média/contagem com 10k linhas por salão (índice cobre `ORDER BY`; agregação lê as visíveis do salão) e a necessidade de índice parcial. Dispensa de nova extensão.

## 5. Infraestrutura (DevOps: SIM, leve)
`AVALIACAO_SEGREDO` (≥ 32; obrigatório em produção, como `RATE_LIMIT_SEGREDO`): `src/server/env.ts` + `check-env` + `env.test.ts`, `.env.example` (vazio), `docker-compose.yml` (app e worker, padrão local `${AVALIACAO_SEGREDO:-compose-local-segredo-avaliacao-0123456789}`), CI (`ci.yml`/smoke se listarem variáveis de produção), README (seção de credenciais/segredos). O worker precisa da variável (gerador roda lá). Sem container, sem dependência nova.

## 6. Invariantes
- Escopo por salão: todas as consultas com `salao_id`; HMAC inclui `salaoId`; token de S2 em `/s1/…` = RN-4 (CA-5, CA-11).
- Anti-sobreposição: não se aplica (não escreve `reserva`; só lê com `FOR SHARE`).
- UTC/fuso: timestamps UTC; mês/ano no fuso do salão via `format.ts`; expiração por `agora` injetado, fronteira `<`.
- Adaptadores: link entregue pelo adaptador WhatsApp existente; Turnstile via `verificarHumano`; sem integração nova.
- Soft delete/anonimização: §3.6 e filtro `anonimizada_em IS NULL`.
- Salão suspenso: leitura e envio continuam (nenhum guard de assinatura; CA-9). Sem escrita de equipe.
- Idempotência: gerador `ON CONFLICT DO NOTHING` e token determinístico; envio por trava + `usado_em`.
- Auditoria super admin: não se aplica (E8.4).
- Mensagens: o gerador não altera a mensagem; link nunca em `parametros`/log/erro (teste CA-1 varre tabelas e logs).

## 7. Riscos
- R-1 Impasse envio × `alterar-status`/anonimização: mitigado pela ordem reserva → cliente → convite → avaliação e `FOR SHARE` nas duas primeiras; teste determinístico com `pg_stat_activity` e 10× (CA-10).
- R-2 `Cache-Control`/`Referrer-Policy` do `[slug]` genérico sobrepondo a regra da rota: teste do cabeçalho real no E2E.
- R-3 Oráculo por timing: uma consulta de forma fixa, rate limit antes; aceitar variação residual de rede.
- R-4 Vazamento do token em log do servidor/CDN pelo caminho: aceito (spec); `no-store`, `noindex`, `strict-origin`; o log de acesso do Next não é alterado.
- R-5 Mudar `aoAnonimizarPadrao` altera D-031: manter o contrato de `deps.aoAnonimizar` e rodar os testes de D-031.
- R-6 Rotação de `AVALIACAO_SEGREDO` invalida links não usados (o hash gravado não casa): documentar no README; links já enviados deixam de valer.
- R-7 Slug histórico: `resolverSalaoPorSlug` já resolve; a ação aceita histórico sem redirecionar (D-1).

## 8. Testes
Unitário (Vitest): `token`, `validacao`, `nome` (acento, emoji, sobrenome único), `formulario`, `config` (segredo), `format` (`formatarNota`, `formatarMesAno`), estáticos (nenhuma rota por reserva+telefone, CA-5; token fora de logs). Integração (PostgreSQL real): CA-1/2 (worker com WhatsApp simulado + varredura de `mensagem`, `mensagem_tentativa`, logs), CA-3, CA-4 (relógio injetado, fronteira de 30 dias), CA-6, CA-7 (via `alterar-status`), CA-8 (com falha injetada em `deps.aoAnonimizar` e sem), CA-9, CA-10 (10× com e sem barreira; submissão × anonimização × `nao_compareceu`; `pg_stat_activity`), CA-11, CA-12 (429 sem consultar o token), CA-13, CA-14 (leitura retorna texto cru, escape no componente), CA-15 (arredondamento), CA-17 (`drift.test.ts`, TZ=UTC e America/Sao_Paulo). Playwright sem banco (`/dev/avaliacao`, `e2e/avaliacao*.spec.ts`): CA-16 (375×812, teclado, axe 4.14.0, sem JS, cabeçalhos). Cobertura ≥ 90% com testes dos módulos novos; a rota page/shell é coberta pelo que já se faz nas demais (shell fino).

## 9. Tarefas
- T-1 dba: migração `prisma/migrations/20261122000000_avaliacao/migration.sql`, modelos em `prisma/schema.prisma`, `tests/integration/**/drift.test.ts`, parecer `docs/demandas/D-032/dba.md` (ordem de travas, plano da leitura, CHECKs). Sem dependências. Conclusão: aplica do zero e sobre a anterior; drift verde.
- T-2 devops (paralela a T-1): `AVALIACAO_SEGREDO` em `src/server/env.ts`, `env.test.ts`, `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml` (se aplicável), `README.md` (seção de segredos), `docs/demandas/D-032/devops.md`. Conclusão: `check-env` falha em produção sem a variável; compose sobe.
- T-3 desenvolvedor (dep. T-1, T-2): `src/server/avaliacoes/{tipos,token,config,validacao,nome,convite}.ts` + testes, `src/server/repos/avaliacao.ts`, `src/server/repos/index.ts` (registro `avaliacoes`), cabeçalho de travas em `src/server/repos/servico.ts`, `src/worker/handlers/whatsapp-reserva.ts`. Conclusão: CA-1, CA-2.
- T-4 desenvolvedor (dep. T-3): `src/server/avaliacoes/servico.ts`, `src/server/repos/avaliacao-publica.ts`, `leitura.ts`, `src/lib/format.ts` (+ teste), `src/lib/texto.ts` se `nome` for lá. Conclusão: CA-3..CA-6, CA-9..CA-12, CA-15.
- T-5 desenvolvedor (dep. T-3; paralela a T-4 se não tocar `repos/avaliacao.ts`/`format.ts`: T-5 só `clientes/anonimizar.ts` e `tests/integration/clientes`): gancho (§2). Conclusão: CA-7 (parte status) e CA-8. Se precisar de método do repo, ele é de T-3.
- T-6 desenvolvedor (dep. T-4): rota `src/app/(publico)/[slug]/avaliar/[token]/**`, `next.config.ts`, `src/config/navegacao.ts`, `src/config/avaliacao.ts`. Conclusão: CA-4, CA-5, CA-13, CA-14 pela rota; cabeçalhos.
- T-7 desenvolvedor (dep. T-4; paralela a T-6, arquivos distintos): `SecaoAvaliacoes.tsx`, edição mínima de `[slug]/page.tsx` e `PaginaDoSalao.tsx`, `src/app/dev/avaliacao/**`. Conclusão: CA-3 (página), CA-15 (UI), vitrine.
- T-8 desenvolvedor (dep. T-6, T-7): `e2e/avaliacao.spec.ts`, `e2e/avaliacao-sem-js.spec.ts`, testes de integração de concorrência/fuso, `CLAUDE.md`, README (comandos), `docs/demandas/D-032/dev.md`. Conclusão: CA-10, CA-16, CA-17, cobertura ≥ 90%.
- T-9 desenvolvedor (condicional, só se o texto de consentimento/Política mudar): `src/config/termos.ts`, `termos-documentos.ts`, `termos.test.ts` (nova versão + nova entrada, nunca editar antiga). Antes de T-6.

Mapa CA → tarefa: CA-1/2 T-3; CA-3/6/9/10/11/12/15 T-4; CA-4/5/13/14 T-4+T-6; CA-7/8 T-5; CA-16 T-7+T-8; CA-17 T-1+T-8.
