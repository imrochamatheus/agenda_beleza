# D-023 — Especificação: Termos, Privacidade e consentimento versionado por finalidade (issue #33, E4.3)

Fontes, por precedência: `docs/trinks-alinhamento.md` (DT-7 e DT-8 em `:21-22`; §3.2 passo 5 em `:133`; §7.4 em `:274-290`; §8.1 em `:301`; §8.2 em `:312-316`; linha da issue #33 em `:198`), `PLAN.md` ("Clientes e privacidade (LGPD)" `:58-64`, "Mensagens pelo WhatsApp" `:95-97`, "Avaliações verificadas" `:66-71`), corpo da issue #33 (RN-1..RN-4, CA-1..CA-3 e a "Revisão D-019" com CA-R1..CA-R3), `docs/demandas/D-001/spec.md` (S4 em `:77`), `CLAUDE.md` e o código citado. Onde a issue e a revisão D-019 divergem (consentimento único vs. por finalidade), prevalece a revisão.

## 1. Problema

Hoje **não existe** página de Termos nem de Privacidade, nem registro de consentimento. Evidências:

- **Links quebrados**: o rodapé do `PublicLayout` já aponta para `ROTAS.termos` e `ROTAS.privacidade` (`src/components/layout/PublicLayout.tsx:13-24`), mas não há `src/app/(publico)/termos` nem `…/privacidade` (a pasta `src/app/(publico)/` só tem `cadastro`, `confirmar-email`, `entrar`, `recuperar-senha`, `redefinir-senha`). Os dois links levam a 404.
- **Rotas já reservadas**: `ROTAS.termos = '/termos'` e `ROTAS.privacidade = '/privacidade'` existem (`src/config/navegacao.ts:16-17`) e `SEGMENTOS_RESERVADOS` é derivado de `ROTAS` (`:139-149`), logo os dois segmentos já estão reservados contra slug. Falta só a prova por teste desta demanda.
- **Esquema**: `model Consentimento` (`prisma/schema.prisma:427-441`) tem `origem` (`publico|equipe`), `versao_termos` e `criado_em`, com FK composta `(salao_id, cliente_id)` para `cliente` (`:437`, `onDelete: Restrict`) e índice `(salao_id, cliente_id)` (`:439`). **Não tem finalidade**: não distingue "mensagens da reserva", "convite de avaliação" e "publicação da avaliação". Migração de origem: `prisma/migrations/20261118000000_init/migration.sql:186-195`, índice `:431`, FKs `:560-563`. Nenhuma tabela tem linhas em produção (a reserva pública ainda não existe).
- **Código**: não há `src/config/termos.ts`, `src/server/consentimento/` nem repositório de consentimento (`src/server/repos/` não tem `consentimento.ts`); `tests/support/factories.ts` não cria consentimentos.
- **Componente**: `Checkbox` (`src/components/ui/Checkbox.tsx:11`) já aceita rótulo com links "(ex.: consentimento com /termos e /privacidade, E4.3)" e `erro`/`obrigatorio`; falta o conjunto de caixas de consentimento com os textos.
- **Cliente**: `upsert` em `src/server/repos/cliente.ts:53-` é o ponto de criação da cliente (D-022); a reserva (E3.2) o chama e gravará o consentimento na mesma transação.

## 2. Objetivo

1. A cliente (e qualquer visitante) lê Termos de Uso e Política de Privacidade provisórios, claramente identificados como tais e com versão, incluindo como as avaliações são publicadas, retiradas e denunciadas.
2. A reserva pública só é aceita no servidor quando a cliente aceita o consentimento obrigatório das mensagens da reserva; o convite de avaliação é opcional, desmarcado por padrão e é a única autorização para o convite da E4.5.
3. Cada aceite fica registrado com **finalidade, data UTC, versão do texto e origem**, de forma a provar o que foi aceito e permitir ao gatilho do convite (E3.5/E4.5) e às mensagens (E3.4/E7.1) consultar o consentimento vigente.

## 3. Escopo

### Entra

- Páginas públicas estáticas `/termos` e `/privacidade` (`src/app/(publico)/termos/page.tsx`, `…/privacidade/page.tsx`).
- `src/config/termos.ts`: versão vigente única e textos das caixas de consentimento (fonte única, lida pelas páginas, pelo componente e pelo registro).
- Migração aditiva: enum `finalidade_consentimento` (`mensagens_reserva`, `convite_avaliacao`, `publicacao_avaliacao`), coluna `consentimento.finalidade`, índice de consulta (DBA).
- Servidor: validador puro e `registrarConsentimento` (`src/server/consentimento/registrar.ts`), consulta `consentimentoVigente`/`temConsentimentoDeMensagens`, repositório `src/server/repos/consentimento.ts` (`Repos.consentimentos`), contrato para a equipe (origem `equipe`).
- Componente reutilizável das caixas (`src/components/consentimento/`), com textos, links e erro por caixa; leitura de `FormData` (nomes de campo fixos).
- Vitrine `/dev/consentimento` (para E2E e axe do componente, sem banco).
- Fábrica de teste de consentimento; documentação.

### Fica fora

- **Formulário público de reserva, Turnstile, rate limit e a página `/{slug}`**: E4.1/E4.2. Esta demanda entrega o componente e os contratos; a E4.1 monta o formulário e a E3.2 chama o registro dentro da transação da reserva.
- **Reserva** (E3.2/E3.4), **gatilho do convite** (E3.5), **página e fluxo de avaliação** (E4.5): usam o que se entrega aqui. A **gravação** de `publicacao_avaliacao` é chamada pela E4.5 (CA-R3 da issue é cumprido por ela, com a função daqui); esta demanda só garante o enum, o texto e a função.
- **Revogação/retirada do consentimento** pela cliente por tela ou ação (v1: pedido ao salão/plataforma; ver D-8) e a **anonimização** (E5.2).
- **Aceite de Termos pelo gestor** no cadastro do salão (E1.1 não muda; D-10).
- Texto jurídico definitivo: os textos são provisórios por definição do `PLAN.md` e da issue (RN-4).
- Confronto com "Fora da primeira versão" do `PLAN.md`: nada de mensagens promocionais, lembretes ou contas de cliente é criado; o consentimento cobre só confirmação, remarcação, cancelamento e convite de avaliação.

## 4. Regras de negócio

- **RN-1** (issue RN-1; PLAN `:64`): sem o consentimento obrigatório `mensagens_reserva` marcado, a reserva pública é **recusada no servidor**; a validação do navegador (`required`) é só conveniência.
- **RN-2** (issue RN-2): o aceite de `mensagens_reserva` cobre Termos de Uso, Política de Privacidade e as mensagens de WhatsApp da reserva (confirmação, remarcação, cancelamento). O texto da caixa diz isso e contém os links para `/termos` e `/privacidade`.
- **RN-3** (DT-7; PLAN `:64`, `:97`): `convite_avaliacao` é **opcional e desmarcada por padrão**; só um registro dessa finalidade autoriza o convite de avaliação (E4.5). Não marcar não impede a reserva e **não grava linha** (a ausência de linha é a ausência de consentimento).
- **RN-4** (issue RN-3, refinada): cada reserva pública grava **uma linha nova por finalidade aceita** (histórico por aceite, nunca atualização de linha anterior).
- **RN-5**: cada linha guarda `finalidade`, `origem` (`publico|equipe`), `versao_termos` (a vigente de `src/config/termos.ts` no momento do aceite, **lida pelo servidor, nunca informada pelo chamador**), `criado_em` (instante UTC) e `cliente_id`/`salao_id`.
- **RN-6** (DT-7, CA-R3): a finalidade `publicacao_avaliacao` existe desde esta demanda e só é aceita com origem `publico` (a cliente age sozinha pelo link). A E4.5 a registra pela mesma função.
- **RN-7**: `origem = equipe` é válida **apenas** para `mensagens_reserva` (D-001 S4: consentimento declarado pela equipe). A equipe não declara `convite_avaliacao` nem `publicacao_avaliacao` em nome da cliente (D-3).
- **RN-8** (D-001 S4; E3.4/E7.1): a mensagem de confirmação da reserva manual só é enviada se a cliente tiver consentimento `mensagens_reserva` **de qualquer origem**; caso contrário o registro fica `nao_enviada`. Esta demanda fornece a consulta; a decisão e o status são da E3.4/E7.1.
- **RN-9**: o registro roda **na transação da reserva** (E3.2/E3.4/E4.5), no mesmo executor: reserva recusada ou desfeita (inclusive por `23P01`) não deixa consentimento; consentimento não existe sem a cliente nem fora do salão dela.
- **RN-10** (invariante de isolamento): a gravação e a consulta usam `ContextoEscopado`; a cliente precisa ser do salão do contexto (FK composta e verificação explícita); a cliente de outro salão é `NaoEncontrado`. `salao_id` nunca vem da entrada.
- **RN-11**: a origem não pode ser forjada. Com contexto de sistema da reserva pública, só `publico`; com contexto autenticado de equipe (`TenantContext`), só `equipe`. O combinar contrário é erro de programação (exceção), não resultado de negócio.
- **RN-12** (D-022 RN-17; CLAUDE.md "Clients"): cliente anonimizada não recebe consentimento novo (`registrar` recusa com `NaoEncontrado`/erro de escopo definido pelo arquiteto) e a consulta de vigente devolve `null` para ela.
- **RN-13** (mudança de versão): os registros existentes **permanecem com a versão que a cliente aceitou** (nunca reescritos); toda nova reserva grava a versão vigente no momento; a troca de versão não invalida consentimento anterior nem exige novo aceite retroativo (D-6).
- **RN-14**: "consentimento vigente" de (salão, cliente, finalidade) é a linha **mais recente** (`criado_em` e `id` decrescentes) ou `null`; não há revogação na v1, logo existência equivale a vigência (D-8). A consulta é por `cliente_id` + `finalidade`, dentro de uma transação quando o chamador a tem (E3.5 cria o convite na transação da conclusão).
- **RN-15**: o texto exibido de cada caixa vem de `src/config/termos.ts` (um texto por finalidade: `mensagens_reserva`, `convite_avaliacao`, `publicacao_avaliacao`); **mudar qualquer texto exige mudar a versão** (teste de guarda; D-5).
- **RN-16** (issue RN-4; CA-R2): `/termos` e `/privacidade` são públicas, mostram a versão de `src/config/termos.ts`, um aviso destacado de que o texto é **provisório** e uma data de vigência; sem JavaScript, sem login, sem consulta ao banco. Os textos são **próprios** (não copiados de terceiros).
- **RN-17** (CA-R2; DT-8; PLAN `:71`): a Política de Privacidade tem uma seção de avaliações com âncora estável `#avaliacoes` que descreve: dados publicados (nota, comentário, **primeiro nome + inicial**); só reserva concluída é avaliada, por link individual; **retirada** (reserva passa a "não compareceu", anonimização da cliente, moderação da plataforma); **denúncia** por qualquer visitante; que o gestor não edita nem apaga avaliações. Também descreve quais dados são coletados (nome, WhatsApp), finalidades, mensagens por WhatsApp e como pedir a remoção/anonimização.
- **RN-18**: o componente `CaixasConsentimento` mostra sempre as duas caixas da reserva, nesta ordem: obrigatória (`mensagens_reserva`) e opcional **desmarcada** (`convite_avaliacao`); nomes de campo fixos exportados de uma constante; erro por caixa em pt-BR; preserva o estado marcado ao reexibir após erro; funciona sem JavaScript.
- **RN-19**: o aceite é lido como **estrito**: só `true` (objeto) ou `'on'` (FormData de uma caixa nativa) vale; ausente, `false`, `'false'`, texto qualquer, número, array e objeto não valem. Entrada que não é objeto → inválido, nunca exceção.
- **RN-20** (CLAUDE.md "Time"): `criado_em` é UTC, informado pelo chamador como `agora` (o mesmo instante da reserva/`defineAcao`), para o registro e a reserva coincidirem e os testes controlarem o relógio.
- **RN-21** (padrão D-013): sem formulário nem ação pública nesta demanda; nada em `src/app/**` toca repositório; o repositório só é importado por `src/server/**` (lint existente).

## 5. Critérios de aceitação

Mapa para a issue: CA-1 → issue CA-1; CA-2 → issue CA-2; CA-3 e CA-4 → issue CA-3; CA-5 → CA-R1; CA-6 → CA-R2; CA-7 → CA-R3 (parte desta demanda).

- **CA-1** (RN-1, RN-19; issue CA-1): Dado um payload público sem o aceite de `mensagens_reserva` (ausente, `false`, `'false'`, `''`, `0`, `1`, `'yes'`, `null`, array, objeto; ou a entrada inteira `undefined`/texto/número), quando passa por `validarConsentimentoDaReserva` ou por `registrarConsentimentoDaReserva`, então devolve `{ ok: false, erros: { mensagensReserva: <pt-BR> } }` sem lançar e **nenhuma linha** é criada em `consentimento`. Unidade (validador, tabela de entradas) + integração (contagem de linhas inalterada).
- **CA-2** (RN-4, RN-5, RN-20; issue CA-2): Dado uma cliente da fábrica e `agora` fixo, quando `registrarConsentimentoDaReserva` roda com `mensagens_reserva` aceita e origem `publico`, então há exatamente 1 linha com `finalidade='mensagens_reserva'`, `origem='publico'`, `versao_termos` igual a `VERSAO_TERMOS` de `src/config/termos.ts` (e à versão mostrada em `/termos`), `criado_em` = `agora` em UTC, `salao_id` e `cliente_id` corretos. Integração (PostgreSQL real).
- **CA-3** (RN-16; issue CA-3): Dado `/termos` e `/privacidade` abertas sem JavaScript, quando renderizadas, então cada uma tem um `h1`, mostra "Versão" com o valor de `VERSAO_TERMOS`, um aviso visível de texto provisório, e o link do rodapé do `PublicLayout` (`/termos`, `/privacidade`) responde 200 (hoje 404). Unidade (componente da página, `@vitest-environment jsdom`) + E2E (status 200 e conteúdo, sem banco).
- **CA-4** (RN-16): Dado `src/config/termos.ts`, quando `VERSAO_TERMOS` é alterada em um teste de unidade que renderiza as páginas e o componente, então os três lugares mostram o novo valor (nenhuma cópia literal da versão fora do config). Unidade + teste estático (grep de literal).
- **CA-5** (RN-3, RN-18, RN-19; CA-R1): Dado o componente `CaixasConsentimento` e o formulário na vitrine, quando exibido, então há a caixa obrigatória de mensagens (com links para `/termos` e `/privacidade`) e a caixa de convite **desmarcada**; marcar só a obrigatória e enviar grava só `mensagens_reserva`; marcar as duas grava duas linhas (`mensagens_reserva` e `convite_avaliacao`), cada uma com finalidade, `criado_em` e versão; marcar só o convite devolve o erro da obrigatória e **não grava nada**. Unidade (componente e leitura de `FormData`) + integração (linhas).
- **CA-6** (RN-17; CA-R2): Dado `/privacidade`, quando lida, então existe a seção com âncora `#avaliacoes` que cita: nota, comentário, primeiro nome + inicial, retirada por "não compareceu", por anonimização e por moderação, e denúncia; e cita o pedido de anonimização/remoção. Unidade (texto por seção, asserção por termo) + E2E (a âncora é alcançável por link e por teclado).
- **CA-7** (RN-6; CA-R3): Dado uma cliente e `registrarConsentimento` com `finalidade='publicacao_avaliacao'`, origem `publico` e contexto de sistema do salão, quando chamada, então grava 1 linha com data UTC e a versão vigente; com origem `equipe` (RN-6/RN-7) é recusada, sem linha. Integração.
- **CA-8** (RN-7, RN-8; D-001 S4): Dado o contexto de equipe (gestor e profissional) e uma cliente, quando registra `mensagens_reserva` com origem `equipe`, então grava 1 linha `origem='equipe'`; com `convite_avaliacao` ou `publicacao_avaliacao` e origem `equipe`, recusa sem linha; `temConsentimentoDeMensagens` é verdadeiro depois de **qualquer** origem e falso sem linha. Integração.
- **CA-9** (RN-11): Dado um `TenantContext` de equipe pedindo origem `publico`, e um `SistemaContext` pedindo `equipe`, quando chamados, então a função lança erro de programação e não grava. Unidade/integração.
- **CA-10** (RN-10, invariante de isolamento): Dado os salões S1 e S2 e a cliente C1 de S1, quando o gestor de S2 (ou um contexto de sistema de S2) registra ou consulta consentimento de C1, então recebe `NaoEncontrado`, nenhuma linha é criada e as linhas de S1 permanecem idênticas; a consulta de vigente de S2 para a cliente de S2 não enxerga linhas de S1 mesmo com o mesmo telefone em ambos os salões. Integração (duas fábricas de salão).
- **CA-11** (RN-12): Dado uma cliente anonimizada (fábrica), quando se tenta registrar, então recusa sem linha; e `consentimentoVigente` devolve `null` mesmo havendo linhas antigas. Integração.
- **CA-12** (RN-9): Dado uma transação que chama o registro e depois falha (rollback forçado, inclusive por violação de `reserva_sem_sobreposicao`), quando termina, então nenhuma linha de consentimento permanece; numa transação confirmada, a linha e a cliente aparecem juntas. Integração.
- **CA-13** (RN-13): Dado uma linha gravada com a versão `V1` e a versão vigente alterada para `V2` (config injetável no teste), quando nova reserva registra o aceite, então existem duas linhas (`V1` intacta, `V2` nova) e `consentimentoVigente` devolve a de `V2`; a linha `V1` continua sem alteração em nenhum campo. Integração.
- **CA-14** (RN-14): Dado três aceites da mesma cliente e finalidade em instantes distintos (e dois com o mesmo `criado_em`), quando `consentimentoVigente` é chamado, então devolve a linha mais recente de forma determinística (desempate por `id`); finalidades diferentes não se misturam; cliente sem linha → `null`. Integração.
- **CA-15** (RN-4, concorrência): Dado a mesma cliente com 10 reservas/registros em paralelo (e em paralelo com `upsert` da mesma cliente e com edição de telefone), quando terminam, então todas as chamadas concluem sem impasse nem `23505` e cada uma gravou exatamente uma linha por finalidade aceita. Integração; comando de estabilidade (§8).
- **CA-16** (RN-5, banco): Dado o banco migrado, quando inserida uma linha com `finalidade` fora do enum, `versao_termos` vazia, ou `publicacao_avaliacao`/`convite_avaliacao` com origem `equipe`, então o banco recusa (`22P02`/`23514`); e as linhas existentes antes da migração aparecem com `finalidade='mensagens_reserva'`. Integração (SQL direto) + verificação da migração no template.
- **CA-17** (RN-15): Dado os textos das três finalidades e a versão, quando o teste de guarda compara o resumo (hash) dos textos de `src/config/termos.ts` com o registrado junto à versão, então falha se um texto mudou sem mudança de `VERSAO_TERMOS`. Unidade.
- **CA-18** (RN-17, RN-18; acessibilidade): Dado `/termos`, `/privacidade` e a vitrine `/dev/consentimento` (estado normal, com erro e após reexibição), quando percorridos só pelo teclado, então toda caixa e todo link são alcançáveis com foco visível, o rótulo inteiro é clicável, o erro é anunciado e associado à caixa; o axe 4.14.0 não acusa violações; no viewport 375×812 não há rolagem horizontal. E2E (Playwright, sem banco).
- **CA-19** (RN-18, RN-21; sem JS): Dado a vitrine com JavaScript desativado, quando o envio é feito sem a obrigatória, então a página volta com o erro em pt-BR e as caixas no estado em que foram enviadas (a opcional marcada permanece marcada); com a obrigatória marcada, o resultado de sucesso é exibido. E2E.
- **CA-20** (RN-1..RN-3): Dado `SEGMENTOS_RESERVADOS`, quando `escolherSlugLivre`/`validarNovoSlug` recebem `termos` ou `privacidade`, então recusam/pulam (e `ROTAS.termos`/`ROTAS.privacidade` continuam derivando dele). Unidade (já coberto em parte por `navegacao.test.ts`; acrescentar a asserção nominal).
- **CA-21** (RN-21): `src/server/consentimento/` não tem `'use server'`, o componente e as páginas não importam repositórios, o lint existente (repositório só em `src/server/repos/`) passa e as páginas `/termos` e `/privacidade` são estáticas no `next build` (marcadas `○` na saída). Unidade/lint/build.

## 6. Casos limite

- **Fuso e virada de dia**: `criado_em` é instante UTC; a página não exibe a hora do aceite. A data de vigência dos textos é uma data de calendário fixa no config (sem fuso). Teste com `TZ=UTC` e `TZ=America/Sao_Paulo` (resultado igual).
- **Concorrência**: dois registros simultâneos da mesma cliente são independentes (sem UNIQUE); a inserção toma `FOR KEY SHARE` na cliente (FK composta), compatível com o `NO KEY UPDATE` do `upsert` e serializada com a edição de telefone (`FOR UPDATE`) sem impasse. Ordem de travas (a registrar no cabeçalho de `src/server/repos/servico.ts`): salão → profissional(is) → serviço(s) → cliente → consentimento → reserva/reserva_item. O arquiteto confirma.
- **Isolamento**: CA-10; consultas sempre com `salao_id` do contexto.
- **Salão suspenso**: a reserva pública fica indisponível (E6.4), logo não há consentimento novo pela página; o registro da equipe e da publicação de avaliação (permitida por link com salão suspenso, `trinks-alinhamento.md:284`) não pode depender do estado do salão: a função não verifica assinatura.
- **Cliente anonimizada**: RN-12, CA-11. As linhas de consentimento existentes **permanecem** (comprovam o que foi aceito) e a anonimização (E5.2) não as apaga; a consulta devolve `null`.
- **Entradas inválidas**: RN-19 (tipos errados, objeto prototype-poisoned como `{__proto__: …}`, `constructor`, chaves extras ignoradas); `clienteId` não UUID → `NaoEncontrado`; lista de finalidades vazia, duplicada (deduplicar) ou com valor fora do enum → inválido; telefone não brasileiro não se aplica (o registro recebe `clienteId`, a normalização é da D-022/E4.2).
- **Permissões por perfil**: o registro **não é uma ação pública autenticada**; o profissional e o gestor o acionam só indiretamente pela criação de reserva (E3.4), que tem as próprias regras. Super admin e cliente não têm tela aqui. Páginas `/termos` e `/privacidade`: qualquer visitante, inclusive autenticado, sem redirecionamento.
- **Mudança de versão**: RN-13, CA-13.
- **Duplicidade**: aceitar o mesmo consentimento em reservas sucessivas cria linhas sucessivas (RN-4); o crescimento é linear por reserva (aceito na v1; D-4).
- **Mensagem de erro**: não revela se a cliente existe nem dados de outra cliente.
- **Âncoras e links**: o link do consentimento abre `/termos` e `/privacidade` em **nova aba** (`target="_blank"` com `rel="noopener"` e aviso "abre em nova aba") para não perder o formulário preenchido, inclusive sem JavaScript.

## 7. Dependências

- **Entregues**: D-005 (contextos, `ContextoEscopado`, `contextoDeSistema`, repositórios), D-009 (`Checkbox`, `PublicLayout`, `Alert`, `ROTAS`, `SEGMENTOS_RESERVADOS`, padrão de vitrine), D-022 (cliente, `upsert`, fábrica de cliente anonimizada), fábricas de dois salões, harness de integração.
- **Bloqueia**: E3.2 (#34) e E3.4 (#35) (chamam `registrarConsentimentoDaReserva`), E4.1 (#37) (usa `CaixasConsentimento`), E3.5 (#36) e E4.5 (leem `consentimentoVigente` e registram `publicacao_avaliacao`), E7.1 (`temConsentimentoDeMensagens`), E5.2 (anonimização mantém as linhas).
- **Integrações**: nenhuma (Mercado Pago, WhatsApp, e-mail e Turnstile não participam; o Turnstile da reserva pública é da E4.2).
- **Infraestrutura**: nenhuma.

## 8. Impactos prováveis

- **Dados (DBA obrigatório)**: migração aditiva `…_consentimento_finalidade` em SQL revisado: `CREATE TYPE finalidade_consentimento AS ENUM ('mensagens_reserva','convite_avaliacao','publicacao_avaliacao')`; `ALTER TABLE consentimento ADD COLUMN finalidade … NOT NULL DEFAULT 'mensagens_reserva'` (preenche as linhas existentes) e em seguida **retirar o padrão** para obrigar o código a informar a finalidade (D-2); `CHECK` de `versao_termos` não vazia e `CHECK` de origem × finalidade (`finalidade <> 'mensagens_reserva'` ⇒ `origem = 'publico'`); índice `(salao_id, cliente_id, finalidade, criado_em DESC, id DESC)` para a consulta de vigente (o índice `(salao_id, cliente_id)` existente pode ser substituído, decisão do DBA); `schema.prisma` e cliente Prisma regenerado. Verificar se o enum e a coluna entram no template de teste sem ajuste. Avaliar com o DBA a imutabilidade da trilha (gatilho que recusa `UPDATE`/`DELETE`), sem torná-la requisito (D-9).
- **Código**: `src/config/termos.ts`; `src/server/consentimento/` (`tipos.ts` client-safe, `validacao.ts`, `registrar.ts`, `leitura.ts`, `formulario.ts` para `FormData`); `src/server/repos/consentimento.ts`, `Repos.consentimentos` em `src/server/repos/index.ts`, `tipos.ts`; `src/components/consentimento/CaixasConsentimento.tsx` (+ estilos e teste); páginas `src/app/(publico)/termos` e `…/privacidade`; vitrine `src/app/dev/consentimento/**` e `ROTAS.devConsentimento`; `tests/support/factories.ts` (fábrica de consentimento).
- **CI/infra**: nenhuma mudança; os E2E novos entram no job `e2e` (páginas estáticas e vitrine sob `VITRINE_COMPONENTES=true`). **DevOps dispensável** (sem container, variável ou workflow novos).
- **Documentação**: README (páginas, versão dos textos e como mudá-la) e `CLAUDE.md` (resumo da D-023 e comandos): E2E `npx playwright test e2e/termos-privacidade.spec.ts e e2e/consentimento.spec.ts e2e/consentimento-sem-js.spec.ts`; estabilidade `for i in $(seq 10); do npx vitest run --project integration tests/integration/consentimento/concorrencia.test.ts || break; done` (CA-15); fuso `for tz in UTC America/Sao_Paulo; do TZ=$tz npx vitest run src/server/consentimento src/config/termos.test.ts || break; done`.

## 9. Dúvidas

### Bloqueantes

Nenhuma.

### Não bloqueantes (suposições adotadas)

| ID | Decisão | Motivo |
|---|---|---|
| D-1 | **Fronteira desta demanda × E4.1/E3.2/E3.4/E4.5**: aqui ficam o config de versão e textos, as páginas, o enum/coluna, o repositório, validador, `registrarConsentimento`, `registrarConsentimentoDaReserva` (valida e grava as finalidades aceitas, chamada pela E3.2/E3.4 na transação), `consentimentoVigente`, `temConsentimentoDeMensagens`, o componente `CaixasConsentimento` com a leitura de `FormData` e a vitrine. Ficam fora: o formulário completo, a ação pública, Turnstile/rate limit e a chamada na reserva (E4.1/E4.2/E3.2), a reserva da equipe (E3.4), o gatilho do convite (E3.5), a tela e a ação da avaliação (E4.5). | Separação pedida pela issue; evita duas demandas editando o mesmo arquivo. |
| D-2 | A migração preenche as linhas existentes com `mensagens_reserva` e **retira o padrão** da coluna; o código sempre informa a finalidade. | Padrão silencioso poderia gravar a finalidade errada no futuro; backfill é seguro porque o único consentimento antigo é o da reserva. |
| D-3 | A equipe só declara `mensagens_reserva` (origem `equipe`); `convite_avaliacao` e `publicacao_avaliacao` só existem com origem `publico`. A E3.4 não mostra caixa de convite. | DT-7 pede consentimento **específico** da cliente para o convite; declaração de terceiro não prova isso. Se o produto quiser permitir o convite declarado pela equipe, relaxar a RN-7 (e o `CHECK`) em demanda posterior. |
| D-4 | Uma linha nova por aceite e por finalidade, sem UNIQUE e sem deduplicar por versão; sem `reserva_id` na linha. | Cumpre a RN-3 da issue e mantém trilha por reserva; o volume é linear e pequeno. Vincular `reserva_id` (coluna anulável aditiva) é possível, se o arquiteto/DBA quiser provar "aceito nesta reserva". |
| D-5 | Uma única `VERSAO_TERMOS` cobre Termos, Privacidade e todos os textos de consentimento (formato `AAAA-MM-DD-provisorio`, valor inicial `2026-11-21-provisorio`, ≤ 40 caracteres, `[a-z0-9._-]`); o teste de guarda (CA-17) compara o hash dos textos. | Simples e rastreável; o hash impede mudar texto sem nova versão. |
| D-6 | A troca de versão não invalida consentimentos anteriores nem pede novo aceite retroativo; vale a versão aceita em cada linha. | Sem revogação e sem texto definitivo na v1; exigir reaceite exigiria tela própria. Revisar quando o texto jurídico definitivo substituir o provisório. |
| D-7 | `registrarConsentimento` recebe `agora` do chamador e a versão vigente é lida do config (não do chamador); a origem é validada contra o tipo de contexto (RN-11). | Determinismo de testes, coerência com a reserva e prevenção de falsificação de versão/origem. |
| D-8 | Não há revogação na v1: a cliente pede ao salão (contato exibido na página do salão) ou à plataforma, e a equipe/super admin atende fora do sistema; a Política informa isso. "Vigente" = linha mais recente existente. Se uma tela de revogação vier, ela exigirá nova coluna/linha de retirada. | Fora de escopo declarado; evita schema especulativo. |
| D-9 | Trilha imutável (gatilho contra `UPDATE`/`DELETE`) fica a critério do DBA, não é critério de aceitação. | A aplicação nunca atualiza linhas; a FK `Restrict` já impede apagar cliente/salão com consentimento. |
| D-10 | O cadastro do gestor (E1.1) não ganha aceite de Termos nesta demanda. | A issue trata da cliente; o gestor aceitar Termos é outra demanda, se necessária. |
| D-11 | As páginas usam o `PublicLayout` (variante plataforma), conteúdo estático, texto próprio e provisório, controlador de dados descrito de forma genérica (o salão decide a finalidade do atendimento; a plataforma opera o sistema), sem canal de contato específico inventado (usa "o contato informado na página do salão" e o canal da plataforma já presente em `siteConfig`, se existir). | Texto jurídico definitivo e contato oficial dependem do titular do produto; o aviso "provisório" cobre o risco. Registrar como pendência de revisão jurídica antes de produção. |
