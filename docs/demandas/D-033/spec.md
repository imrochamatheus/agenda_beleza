# D-033 (E8.1, issue #23): Log de auditoria

## 1. Problema
- A tabela `auditoria` (colunas: `id`, `ator_id` nulo, `ator_email_informado`, `acao`, `entidade`, `entidade_id`, `salao_id`, `antes`/`depois` JSONB, `resultado` sucesso|falha, `ocorrido_em` timestamptz default now()), o enum `resultado_auditoria` e os triggers somente-inserção existem desde a E0.4 (`prisma/schema.prisma` ~l.705; `prisma/migrations/20261118000200_restricoes_sql/migration.sql:161-180`: UPDATE/DELETE por linha, TRUNCATE por instrução, `P0001`).
- Não existe serviço de escrita: `grep -il auditoria src` só acha o cliente Prisma gerado e `config/navegacao.ts`. `AdminContext` e `criarAdminContext` existem (`src/server/tenant/context.ts:51,92`), mas nenhum repositório os aceita ainda e não há guarda `exigirAdmin` (grep `exigirAdmin` vazio). `Repos` (`repos/index.ts`) só tem repositórios de tenant.
- Consequência: nenhuma ação de super admin (E1.5, E8.2, E8.4) pode ser auditada.

## 2. Objetivo
Serviço genérico, somente-escrita, de auditoria: quem, quando, o quê, entidade, salão, valores antes/depois, resultado. Mutação e auditoria atômicas; falhas sem mutação auditadas em transação própria. Genérico o bastante para a moderação (E8.4: `avaliacao.retirar`/`avaliacao.restaurar`, CA-R1 da revisão D-019).

## 3. Escopo
Entra: `src/server/auditoria/` (`tipos.ts` vocabulário e contratos; `sanitizar.ts` puro; `registrar.ts`), `src/server/repos/auditoria.ts` (único lugar que escreve na tabela), `exigirAdmin` em `tenant/context.ts`, testes de unidade e integração, nota do cabeçalho da ordem de travas.
Fora: tela/consulta (E8.3; nenhum método de leitura público nesta demanda, os testes leem via Prisma em `tests/support`), login/TOTP (E1.5), ações de moderação e de gestão de salão (E8.4/E8.2), migração (nenhuma necessária: colunas, índices e triggers bastam), retenção/expurgo, UI. Nada em "Fora da primeira versão" do PLAN.md é tocado.

## 4. Regras de negócio
- RN-1 (issue RN-1): registro com ator (`ator_id`), data UTC (`ocorrido_em`, default do banco), ação, entidade e id, salão opcional, `antes`/`depois` JSON, resultado.
- RN-2 (issue RN-2): `registrarAuditoria` roda na transação da mutação; se ela falha, a mutação é desfeita. `registrarFalhaAuditoria` usa transação própria (outra conexão) e persiste mesmo com rollback da principal.
- RN-3: somente inserção. Garantido pelos triggers (provados na E0.4); nesta demanda nenhum código emite UPDATE/DELETE/TRUNCATE em `auditoria`, e nenhuma rota/`defineAcao` expõe edição ou remoção.
- RN-4: só `AdminContext` registra com sucesso; o ator é `ctx.usuarioId`, nunca vindo do chamador. `registrarFalhaAuditoria` não exige contexto (login falho não tem ator): aceita `atorId?` e `atorEmailInformado?` (e-mail em minúsculas, máx. 254 caracteres; senhas nunca).
- RN-5 (issue RN-5): segredos nunca entram em `antes`/`depois`. Lista de chaves proibidas aplicada recursivamente (objetos e arrays) sobre a chave normalizada (minúsculas, só `[a-z0-9]`), por substring: `senha`, `password`, `passwd`, `hash`, `totp`, `otp`, `token`, `secret`, `segredo`, `cookie`, `authorization`, `apikey`, `chaveapi`, `credencial`, `cvv`, `cartao`, `cardnumber`, `pan`. Chave suspeita: a gravação FALHA (`ErroAuditoriaSegredo`, informa só o caminho da chave, nunca o valor); não há redação silenciosa. Em `registrar`, isso desfaz a mutação (RN-2). Auditoria registra apenas campos de negócio escolhidos pelo chamador (ex.: `{ ocultaEm }`), nunca linhas inteiras.
- RN-6 (limites): `antes` e `depois` aceitam só JSON puro (objeto/array/string/número/boolean/null; `undefined`, `Date`, `bigint`, função, ciclo recusados), profundidade ≤ 6, serializado ≤ 16 KiB (UTF-8) cada; `acao` ≤ 64, `entidadeId` ≤ 64. Excesso é recusado (`ErroAuditoriaEntrada`), nunca truncado.
- RN-7 (vocabulário): `acao` = `entidade.verbo` em snake_case (`^[a-z][a-z_]*\.[a-z][a-z_]*$`) e pertence a lista fechada tipada `ACOES_AUDITAVEIS` em `tipos.ts`; `entidade` pertence a `ENTIDADES_AUDITAVEIS`. Valores iniciais: ações `avaliacao.retirar`, `avaliacao.restaurar`, `salao.renomear` (reservada a E8.2; usada nos testes), `login.falha_totp`, `login.falha_senha`; entidades `avaliacao`, `salao`, `usuario`. Novas demandas acrescentam ao vocabulário (teste garante formato e ausência de duplicata). Para ações do tipo "mutação com valor anterior e novo" (`avaliacao.*`, `salao.renomear`), `antes` e `depois` são obrigatórios em `sucesso`.
- RN-8: `resultado` é `sucesso` em `registrarAuditoria` e `falha` em `registrarFalhaAuditoria`; o chamador não escolhe.
- RN-9: `salaoId`, se informado, é UUID de salão existente (FK); `entidadeId` é texto (UUID ou outro).
- RN-10 (ordem de travas): `auditoria` é a ÚLTIMA no cabeçalho de `repos/servico.ts` (insere só; FK toma `FOR KEY SHARE` em `usuario`/`salao`, que não conflita com `FOR NO KEY UPDATE`).

## 5. Contratos
- `registrarAuditoria(ctx: AdminContext, e: { acao: AcaoAuditavel; entidade: EntidadeAuditavel; entidadeId: string; salaoId?: string | null; antes?: JsonObjeto | null; depois?: JsonObjeto | null }, r: Repos): Promise<{ id: string }>`. `r` é OBRIGATÓRIO (proposta; o líder sugeriu `r?`, mas sem `r` abriria transação própria e violaria RN-2). Um guarda de execução recusa `ctx` que não seja admin (`Error`, erro de programação, 500).
- `registrarFalhaAuditoria(e: { acao; entidade?; entidadeId?; salaoId?; atorId?: string | null; atorEmailInformado?: string | null; antes?; depois? }): Promise<void>`: abre a própria transação (`obterPrisma()`, fora do `emTransacao` do chamador), mesma sanitização/limites. Erro de banco ou de sanitização propaga (quem chama nega o acesso de qualquer forma; nunca vira sucesso).
- Uso obrigatório de `registrarFalhaAuditoria`: chamar FORA e DEPOIS da transação que falhou (no `catch`), pois dentro dela uma conexão independente poderia esperar travas `FOR UPDATE` do chamador (self-wait). Chamar dentro é suportado quando a principal não segura `FOR UPDATE` em `usuario`/`salao` referenciados (CA-4 cobre este caso).
- `Repos.auditoria: RepoAuditoria` com `inserir(entrada)` (único INSERT; aceita AdminContext via `exigirAdmin`, ou entrada pré-validada pela via de falha). `repos/auditoria.ts` é o único arquivo que menciona a tabela (teste estático).

## 6. Critérios de aceitação (Dado/Quando/Então)
- CA-1 (issue CA-1): Dado super admin e salão "A", quando uma mutação que renomeia para "B" chama `registrarAuditoria` na mesma `emTransacao`, então existe 1 linha com `ator_id` = admin, `acao` `salao.renomear`, `entidade_id` = salão, `salao_id`, `antes {nome:"A"}`, `depois {nome:"B"}`, `resultado` sucesso e `ocorrido_em` dentro da janela do teste (UTC).
- CA-2 (issue CA-2): Dado falha forçada na gravação (salaoId inexistente → FK 23503; e `depois` acima de 16 KiB), quando a ação roda, então a mutação NÃO persiste e nenhuma linha de sucesso existe.
- CA-3 (issue CA-3): Dado o registro de ações (`registro.ts`) e a árvore `src/app/api`, quando o teste os percorre, então nenhuma ação/rota se refere a `auditoria` com operação de edição/remoção; busca estática: UPDATE/DELETE/TRUNCATE sobre `auditoria` só em testes. Um UPDATE/DELETE/TRUNCATE direto via SQL é rejeitado (`P0001`) e a contagem não muda (reconfirma E0.4).
- CA-4 (issue CA-4): Dado `registrarFalhaAuditoria` chamada dentro de uma `emTransacao` que depois sofre rollback, quando desfeita, então a linha `resultado=falha` persiste. Idem chamada no `catch` após o rollback.
- CA-5: Dado `antes`/`depois` com chave proibida (`senha`, `totpSecret`, `tokenHash`, `Authorization`, aninhada em objeto e em array), então a gravação falha com `ErroAuditoriaSegredo` sem conter o valor na mensagem, e nada é gravado (em `registrar`, a mutação é desfeita). Um conjunto de chaves legítimas (`nome`, `slug`, `ocultaEm`, `motivo`) passa; teste de tabela cobre toda a lista.
- CA-6: Dado contexto que não seja `admin` (tenant, sistema, público, objeto forjado) ou `usuarioId` não UUID, então `registrarAuditoria` lança erro e nada é gravado; um `salaoId` de outro salão é aceito (ação de plataforma), e é só o admin quem o informa.
- CA-7: Dado ação ou entidade fora do vocabulário, JSON não puro, profundidade > 6, `acao` > 64, então `ErroAuditoriaEntrada`, nada gravado. Ação de mutação sem `antes`/`depois` em sucesso é recusada.
- CA-8 (CA-R1 da D-019): Dado `avaliacao.retirar` seguido de `avaliacao.restaurar` com `antes`/`depois` do estado de ocultação, então cada chamada gera uma linha com ator, data, ação, entidade `avaliacao`, id, antes e depois, na ordem, no mesmo `emTransacao`.
- CA-9: Dado `registrarFalhaAuditoria` sem ator e com `atorEmailInformado` "X@Y.com", então `ator_id` nulo, e-mail em minúsculas, `resultado=falha`; com `atorId` de usuário inexistente, falha de FK propaga.
- CA-10: Dado 20 `registrarAuditoria` paralelas (transações distintas, mesmo admin e mesmo salão) e uma mutação com `FOR NO KEY UPDATE` no salão, então todas completam, sem impasse nem 23505, 20 linhas.
- CA-11: Dado o código-fonte, então `repos/auditoria.ts` é o único arquivo de produção com a tabela `auditoria` em SQL/Prisma (`prisma.auditoria`), e o domínio/serviço não importa Prisma nem `next/*`.
- CA-12: `TZ=UTC` e `TZ=America/Sao_Paulo`: o resultado não depende do fuso do processo.
- Gate padrão: cobertura ≥ 90%, build, lint, typecheck.

## 7. Casos limite
- Fuso/virada de dia: `ocorrido_em` é `now()` do banco (UTC); dentro de transação longa é o início da transação. Aceito; E8.3 exibe no fuso da exibição.
- Concorrência: inserção sem trava de linha; falha em conexão separada pode esgotar o pool se muitos paralelos (pool 10); mitigado por inserção curta.
- Isolamento entre salões: `salao_id` é só dimensão de consulta; a leitura admin é E8.3. Tenant nunca lê/escreve `auditoria` (nenhum método em repos de tenant; `exigirEscopo` não é usado aqui).
- Salão suspenso: auditoria é gravável (ação de plataforma, sem relação com a suspensão).
- Cliente anonimizada: `antes`/`depois` não podem carregar nome/telefone de cliente (convenção, sem varredura de valores; ver risco R-2).
- Entradas inválidas: e-mail informado > 254 ou com controle é recusado; UUIDs mal formados viram `ErroAuditoriaEntrada`, nunca 500 do Postgres.
- Sessão do admin revogada durante a ação: fora do escopo (o contexto já foi resolvido).

## 8. Dependências
Bloqueada por E0.5 (pronta, D-005) e E0.4. Bloqueia E1.5 (TOTP: usa `registrarFalhaAuditoria`) e E8.4 (moderação). Relacionada: E8.2, E8.3. Sem integrações externas. Infra: nenhuma.

## 9. Impactos prováveis
- Dados: nenhuma migração (DBA dispensável; confirmar apenas que índices atuais bastam para E8.3 e que inserção em `auditoria` com FK não conflita com travas existentes).
- Infra/CI: nada; testes de integração usam o harness atual. Documentação: README/CLAUDE.md (seção do módulo) e cabeçalho de ordem de travas.
- Riscos: R-1 chaves por substring podem gerar falso positivo (ex.: `panorama` contém `pan`) -> recusa; arquiteto avalia limitar `pan`/`otp` a chave exata ou aceitar. R-2 só chaves são verificadas, não valores (PII/segredo em valor de campo livre como `motivo`). R-3 dono do banco pode desligar triggers (limitação já registrada na E0.4).

## 10. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposição adotada):
- `r` obrigatório em `registrarAuditoria` (divergência do `r?` pedido; recomendado).
- Recusar (não redigir) chave suspeita, conforme RN-5 da issue ("falha ao gravar").
- Vocabulário inicial incluindo `login.falha_senha`/`login.falha_totp` já para a E1.5.
- Sem leitura pública do log até a E8.3.
