# D-022 — Especificação: clientes por salão com telefone E.164, busca e edição (issue #29, E5.1)

Fontes, por precedência: `docs/trinks-alinhamento.md` (§7.4 consentimento por finalidade e anonimização; DT-7/DT-8 em `:21-22`), `PLAN.md` ("Clientes e privacidade (LGPD)" `:58-64`), corpo da issue #29 (RN-1..RN-7 e CA-1..CA-6, mantidos e refinados), `docs/demandas/D-001/spec.md` (S8 `:81`; E5.1 `:1105-1118`), `CLAUDE.md` (invariantes "Clients", "Tenant isolation", "Soft deletes"; padrões D-013..D-021) e o código citado.

Ajuste à issue: a issue pede `libphonenumber-js`; não se adiciona dependência. O normalizador `src/lib/telefone.ts` existe desde a D-020 e cobre CA-1/CA-2 (ver §1 e D-1).

## 1. Problema

A manutenção de clientes é **inexistente** (não há serviço, página nem ação). Evidências do que existe:

- **Esquema**: `model Cliente` (`prisma/schema.prisma:409-425`): `nome`/`telefone_e164` anuláveis, `anonimizada_em`, `@@unique([salaoId, telefoneE164])` e `@@unique([salaoId, id])`. A migração `20261118000200_restricoes_sql` (`:45-57`) já tem `cliente_anonimizacao_chk` (ativa: nome e telefone NOT NULL; anonimizada: ambos NULL e `anonimizada_em` preenchido, irreversível por construção) e `cliente_telefone_e164_chk` (`^\+55[1-9][0-9]{9,10}$`). O UNIQUE tem NULLS DISTINCT: anonimizadas coexistem e o número de uma anonimizada fica livre para nova cliente. `reserva.cliente_id` e `consentimento.cliente_id` referenciam `(salao_id, id)` (`:437`, `:471`); há `@@index([salaoId, clienteId, inicio])` em `reserva` (`:479`).
- **Telefone**: `src/lib/telefone.ts` (D-020) já tem `normalizarTelefoneBr` (aceita `(11) 98765-4321`, `11987654321`, `+55 11 98765-4321`, `5511...`; recusa outro país, DDD fora da lista de 67, 0800/0300/4004, tamanho errado, letras, texto acima de 30 caracteres; nunca lança), `ehTelefoneBrE164`, `DDDS_BRASIL`; `formatarTelefone` e `formatarCep` em `src/lib/format.ts:239-247`. O comentário de `telefone.ts:2-3` já reserva a lista de DDDs para a E5.1.
- **Repositório**: `src/server/repos/cliente.ts` tem `RepoCliente` com `buscarPorId` (inclui anonimizadas), `listar` (sem busca nem página, inclui anonimizadas) e `renomear` (só nome, só não anonimizada). **Não há criação/upsert nem troca de telefone.** `ClienteDTO` em `src/server/repos/tipos.ts:82-89`. A fábrica de teste cria uma cliente ativa e uma anonimizada por salão (`tests/support/factories.ts:215-235`).
- **Permissão**: `'cliente.gerir': linha('salao', 'negado', 'negado')` (`src/server/auth/permissoes.ts:48`). Não há operação para o profissional ver a cliente das próprias reservas.
- **Navegação**: `ROTAS.clientes = '/painel/clientes'` e o item "Clientes" existem (`src/config/navegacao.ts:24`, `:80`), mas não há página em `src/app/painel/` (só `bloqueios`, `configuracoes`, `profissionais`, `servicos`).
- **Reservas**: `RepoReserva` (`src/server/repos/reserva.ts`) não tem leitura por cliente. A criação de reserva é da E3.2 (inexistente).
- **Busca**: sem extensão no banco; só `btree_gist` (`20261118000100_reserva_exclusion/migration.sql:26`).
- **Texto**: `normalizarNome(v, {min,max})` (`src/lib/texto.ts:10-16`) recusa controle e colapsa espaços.

## 2. Objetivo

(a) Um único ponto atômico de criação/atualização de cliente por salão + telefone, para a E3.2/E3.4/E4.2 reservarem sem duplicar cliente. (b) O gestor lista, busca, consulta (com histórico de agendamentos) e corrige nome e telefone das clientes do próprio salão, com isolamento entre salões garantido no servidor. (c) Contratos prontos para a E5.2 (anonimização) e para a E3.3/E3.5 (profissional vê a cliente das próprias reservas).

## 3. Escopo

**Entra:**
- Normalização do nome da cliente (puro) e reuso do normalizador de telefone (sem mudança).
- `upsertCliente` (repositório + função de serviço): único ponto de criação; contrato em RN-6.
- Lista paginada com busca por nome/telefone, só clientes não anonimizadas.
- Detalhe com histórico de agendamentos (leitura sobre `reserva`/`reserva_item`, vazia até a E3.2) e edição de nome e telefone.
- Leitura de contato da cliente para o profissional restrita às próprias reservas (serviço, sem tela).
- Páginas `/painel/clientes` e `/painel/clientes/[id]`; ações `defineAcao`; vitrines `/dev/clientes` para E2E sem banco.
- Testes de unidade, integração (PostgreSQL real, isolamento, concorrência) e E2E (teclado, axe, sem JS).

**Fica fora (com dono):**
- Criação de cliente pela tela do gestor (ex.: "nova cliente" sem reserva): a issue não pede; a cliente nasce na reserva (E3.2/E3.4/E4.2).
- Anonimização (ação, texto "cliente removida" na agenda, remoção de consentimentos): E5.2 (#45). Aqui só o contrato (RN-12, RN-13).
- Consentimento por finalidade e páginas de Termos: E4.3. `upsertCliente` não grava consentimento.
- Mesclagem de clientes duplicadas: fora da primeira versão (RN-5 da issue); a edição para telefone existente é recusada.
- Telas de agenda e detalhe de reserva (E3.3/E3.5); criação/limites de reserva (E3.2, E4.2).
- Bloqueio por estado do salão (suspenso): E6.4; aqui só `capacidade: 'configurar'`.
- Exportação de dados da cliente, avaliações, marketing, aniversário, notas internas, tags e etiquetas: não pedidos; "Fora da primeira versão" (`PLAN.md:146`) não é tocado (nenhum caixa, fidelidade, comissão ou conta de cliente).
- Seed de clientes: E9.2.

## 4. Regras de negócio

### Identidade e telefone

- **RN-1 — Só telefone brasileiro** (issue RN-1; S8): a cliente é identificada por salão + telefone E.164 brasileiro (`+55` + 10 ou 11 dígitos). Entrada de outro país, DDD inexistente, número de serviço (0800/0300/4004), tamanho errado ou texto não numérico é recusada com mensagem pt-BR ("Informe um telefone brasileiro com DDD, por exemplo (11) 98765-4321."). A normalização é `normalizarTelefoneBr`, sem alteração (D-1).
- **RN-2 — Nome** : obrigatório, `normalizarNome` com limite 2 a 100 caracteres (trim, colapso de espaços, sem caracteres de controle). Mensagem pt-BR por campo.
- **RN-3 — Isolamento** (issue RN-3; `CLAUDE.md` "Tenant isolation"): o mesmo número em salões diferentes gera clientes independentes, sem compartilhar dado. Toda leitura e escrita usa `ctx.salaoId`; nenhuma entrada carrega id de salão (um `salaoId` forjado é ignorado). Cliente de outro salão em `/painel/clientes/[id]` → 404, indistinguível de inexistente (id que não é UUID também 404).
- **RN-4 — Anonimizadas**: cliente com `anonimizada_em` preenchido não aparece na lista nem na busca, não é editável e seu número está livre para nova cliente (RN-9). O detalhe por id continua acessível ao gestor, como "Cliente removida", com o histórico preservado e sem formulário de edição (contrato para a E5.2; PLAN `:62`).

### Upsert

- **RN-5 — Atualiza o nome** (issue RN-2): nova reserva com o mesmo número no mesmo salão atualiza o nome da cliente existente para o nome informado (já normalizado); não cria segunda cliente.
- **RN-6 — Contrato de `upsertCliente`** (issue RN-7): único ponto de criação de `cliente`, usado por E3.2, E3.4 e E4.2. Entrada: contexto escopado (`ContextoEscopado`; D-3), `{ telefone: unknown, nome: unknown }` (valida RN-1 e RN-2 dentro) e, opcionalmente, o executor da transação do chamador (a cliente é gravada na mesma transação da reserva). Saída: `{ resultado: 'ok', cliente: { id, nome, telefoneE164 }, criada: boolean }` ou `{ resultado: 'invalido', erros: { telefone?, nome? } }`. Atômico por (`salao_id`, `telefone_e164`): `INSERT … ON CONFLICT (salao_id, telefone_e164) DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = now() RETURNING …, (xmax = 0) AS criada`. Nunca captura 23505, nunca faz "SELECT depois INSERT". Dois upserts paralelos do mesmo número: uma única linha, nenhum falha, `criada` verdadeiro em exatamente um.
- **RN-7 — Sem efeito colateral**: o upsert não toca reservas, mensagens nem consentimentos. Número de cliente anonimizada não conflita (telefone NULL na linha antiga): o upsert cria nova cliente.

### Lista e busca

- **RN-8 — Lista** (issue "lista com busca"): só gestor; só clientes do salão com `anonimizada_em IS NULL`; ordenação por nome normalizado (sem acento, minúsculas) ascendente, desempate por `id`; página de 20, parâmetro `?pagina=N` (inteiro ≥ 1; inválido ou ausente → 1; além da última → página vazia com link para a 1); mostra o total de resultados. Cada linha: nome, telefone formatado (`formatarTelefone`) e link para o detalhe.
- **RN-9 — Busca** (`?q=`): `q` é aparado, colapsado e limitado a 80 caracteres (mais que isso é cortado, sem erro). Dois critérios em OU: (a) **nome**: o texto da busca normalizado (NFD sem diacríticos, minúsculas) é substring do nome normalizado; (b) **telefone**: só quando `q` contém apenas dígitos e `( ) - + . espaço` e tem 3 dígitos ou mais, os dígitos de `q` são substring dos dígitos do E.164 gravado (portanto `98765`, `(11) 98765`, `+55 11 9` e `5511987654321` encontram; `987654321` encontra). `%`, `_` e `\` na busca são literais (escapados). Busca vazia = lista completa. Sem extensão nova no banco (D-2).

### Edição

- **RN-10 — Edição** (issue RN-4/RN-6): só o gestor (inclui o gestor com perfil de profissional) edita nome e telefone de uma cliente não anonimizada, com `defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })` e operação `cliente.gerir`. Profissional: 403; sem sessão: redireciona para `/entrar?proximo=`.
- **RN-11 — Telefone já existente** (issue RN-5): editar para um telefone que já pertence a outra cliente do mesmo salão é recusado (`resultado: 'recusado'`, motivo `telefone_em_uso`, mensagem pt-BR sem expor o nome da outra cliente além de um link para ela, que o gestor já pode ver; D-6), sem gravar nada. Colisão com cliente anonimizada não existe (RN-4). Sem mesclagem.
- **RN-12 — Idempotência**: salvar nome e telefone idênticos aos atuais responde sucesso e não escreve (nem `atualizado_em`).
- **RN-13 — Reservas e mensagens preservadas**: editar nome ou telefone nunca altera `reserva`, `reserva_item` nem `mensagem` (o histórico passa a exibir o dado atual da cliente; mensagens já registradas mantêm o `destinatario_e164` gravado). Cliente anonimizada ou de outro salão → `NaoEncontrado` (404), sem escrita.
- **RN-14 — Concorrência na edição**: duas edições da mesma cliente, ou uma edição para um telefone × um upsert desse mesmo telefone (E3.2) ou × outra edição para o mesmo telefone, nunca produzem 5xx, impasse nem dois registros com o mesmo número; quem perde recebe `recusado/telefone_em_uso` (a edição) ou se une à vencedora (o upsert, RN-6). A edição não pode deixar a reserva em curso sem cliente (a FK `(salao_id, id)` não muda; o `id` nunca muda).

### Histórico e leituras para outras demandas

- **RN-15 — Histórico**: o detalhe lista as reservas da cliente do mesmo salão (`reserva.salao_id = ctx.salaoId AND cliente_id = :id`), da mais recente para a mais antiga (`inicio` desc, desempate `id`), até 50, com o total. Cada item: data e hora no fuso do salão (`src/server/tempo/fuso.ts` + formatadores; nunca no fuso do servidor), status em pt-BR (confirmado, cancelado, concluído, não compareceu), profissional (nome atual), serviços na ordem dos itens (nome atual), duração total e preço total a partir do **snapshot** de `reserva_item` (nunca do preço atual do serviço). Vazio até a E3.2: "Nenhum agendamento ainda." Profissional/serviço inativos continuam exibidos. O histórico nunca mostra telefone ou nome de outra cliente.
- **RN-16 — Contato para o profissional** (issue RN-4; E3.3/E3.5): função de serviço `lerContatoDaCliente(ctx, clienteId)` (sem tela aqui). Gestor: qualquer cliente do salão, inclusive anonimizada (nome/telefone `null`, `anonimizada: true`). Profissional: só se existir reserva (qualquer status) com `profissional_id = ctx.profissionalId` e `cliente_id = clienteId` no salão; senão `NaoEncontrado` (não revela a existência). Devolve `{ id, nome, telefoneE164, anonimizada }`. Exige a operação nova `cliente.contato` (D-5).
- **RN-17 — Exibição de anonimizada**: onde uma leitura devolver cliente anonimizada, o DTO traz `nome: null`; a camada de exibição usa o texto "cliente removida" (constante em `src/server/clientes/tipos.ts`, importada pela E5.2/E3.3; nunca copiada).
- **RN-18 — Acesso e formulário**: a página, as ações e as leituras seguem o padrão D-013..D-021: `src/server/clientes/clientes.acao.ts` (sem `'use server'`, tudo por `defineAcao`), serviço sem `next/*`, shell `'use server'` em `src/app/painel/clientes/acoes.ts` só converte `FormData`/resultado e nunca toca repositório; resultados de negócio como união discriminada dentro de `{ ok: true, dados }`. Os repositórios continuam o único lugar que importa o cliente Prisma.

### Interface

- **RN-19 — Telas**: `/painel/clientes` (busca com `<form method="get">` que funciona sem JS, lista, paginação anterior/próxima como links, contagem) e `/painel/clientes/[id]` (dados, formulário de edição, histórico). Linguagem pt-BR; campos rotulados, erro por campo com `aria-describedby`, foco no resumo de erros; operáveis só por teclado; sem JavaScript o formulário de edição e a busca funcionam. `type="tel"` com `autocomplete="off"` no telefone; o valor digitado é preservado após erro. Mobile primeiro (um breakpoint). Nenhuma cor fora de `globals.css`; datas/moeda só por `src/lib/format.ts`.

## 5. Critérios de aceitação

Integração = Vitest com PostgreSQL real e as fábricas de dois salões (`tests/support/`). "Recusado" = resultado `invalido`/`recusado` com mensagem pt-BR e nenhuma linha alterada. Correspondência no `PLAN.md`: critério 1 (isolamento) e a parte de dados do critério 7 (anonimização, contrato); a identidade por salão + número é invariante do `CLAUDE.md`.

- **CA-1** (issue CA-1; RN-1): Dado `(11) 98765-4321`, `11987654321`, `+55 11 98765-4321`, `5511987654321` e `(11)98765.4321`, quando normalizados, então todos resultam em `+5511987654321`; e `(11) 3456-7890` resulta em `+551134567890`. Unidade (já coberto por `src/lib/telefone.test.ts`; a demanda acrescenta o caso pelo caminho do upsert e da edição).
- **CA-2** (issue CA-2; RN-1): Dado `+1 415 555 0100`, `(00) 98765-4321`, `(20) 98765-4321` (DDD inexistente), `0800 123 4567`, `(11) 8765-432`, `(11) 88765-4321`, `abc`, texto de 31 caracteres e não texto, quando informados ao upsert ou à edição, então são recusados com o erro no campo telefone e nada é gravado. Unidade + integração (um recusado por via).
- **CA-3** (issue CA-3; RN-2, RN-5, RN-6): Dado "Maria" com `+5511987654321` no salão A, quando `upsertCliente(ctxA, { telefone: '(11) 98765-4321', nome: '  Maria   S. ' })`, então existe uma única cliente do salão A com esse número, `nome = 'Maria S.'`, mesmo `id`, `criada = false`, `atualizado_em` avançado. Dado número novo, então `criada = true`. Nome vazio, de 1 caractere, de 101 caracteres ou com quebra de linha → `invalido` no campo nome, sem escrita. Integração (+ unidade da validação).
- **CA-4** (issue CA-4; RN-3, RN-8, RN-9, RN-15): Dado o mesmo número em dois salões, cada um com reservas, quando o gestor de A lista, busca por nome e por telefone e abre o detalhe, então vê só a cliente de A e só o histórico de A; o detalhe da cliente de B com o gestor de A responde 404; `upsertCliente(ctxA, mesmo número)` não altera a cliente de B (nome, `atualizado_em`). Integração.
- **CA-5** (issue CA-5; RN-10): Dado um profissional, quando acessa `/painel/clientes` ou `/painel/clientes/[id]`, então vê "Acesso negado" (403); as ações de edição devolvem `AcessoNegado` sem escrita; sem sessão, redireciona para `/entrar?proximo=/painel/clientes`; o item "Clientes" da navegação do profissional continua ausente (confirmar em `src/config/navegacao.ts`). Integração (ações e página) + teste de registro das ações (`papeis`/`capacidade`).
- **CA-6** (issue CA-6; RN-6): Dado 2 e 10 upserts paralelos do mesmo número no mesmo salão (nomes diferentes), quando executados, então todos resolvem, existe 1 cliente, `criada` verdadeiro em exatamente 1 retorno e o nome final é o de um dos envios. Dado upserts paralelos do mesmo número em salões diferentes, então 2 clientes, uma por salão. Integração (repetido 10 vezes, comando de estabilidade da §8).
- **CA-7** (RN-4, RN-8, RN-9): Dado clientes ativas e uma anonimizada, quando lista e busca, então a anonimizada nunca aparece (nem por parte do que seria seu nome ou telefone, já nulos); o total conta só ativas; o detalhe da anonimizada mostra "Cliente removida", o histórico e nenhum formulário, e a edição por ação responde 404. Integração.
- **CA-8** (RN-8, RN-9): Dado clientes "Ana Júlia", "ANA CLARA", "Zélia", "João_%" e telefones variados, quando busca `ana`, `julia`, `JÚLIA`, `zelia`, `a c`, `%`, `_`, `\`, `98765`, `(11) 98765`, `+55 11 9`, `5511987654321` e `xyz`, então os resultados são exatamente os esperados (acento e caixa ignorados; `%`/`_`/`\` literais; só dígitos ativam o telefone; `xyz` vazio com mensagem "Nenhuma cliente encontrada."). Ordenação: "Ana Clara", "Ana Júlia", "João_%", "Zélia" (acento não afeta a ordem). Unidade (normalização da consulta) + integração.
- **CA-9** (RN-8): Dado 45 clientes, quando `pagina` é 1, 2, 3, 4, 0, -1, `abc`, `1.5` e `99999999999999999999`, então 20, 20, 5 itens, página vazia com link para a primeira, e os quatro últimos valores caem em 1 (ou, para o número enorme, na página vazia sem erro); o total é 45; duas páginas consecutivas não repetem nem omitem cliente (inclusive com nomes iguais, pelo desempate por `id`). Integração.
- **CA-10** (RN-10, RN-12, RN-13): Dado o gestor, quando edita nome e telefone de uma cliente com reservas, então a cliente muda, `id` e todas as reservas (`reserva`, `reserva_item`) e mensagens ficam idênticas, e o histórico passa a mostrar o novo nome. Quando salva os mesmos valores, então sucesso e `atualizado_em` inalterado. Entradas inválidas (CA-2, nome) → recusado com todos os erros juntos e valores digitados preservados. Integração.
- **CA-11** (RN-11): Dado o telefone de outra cliente do salão, quando o gestor edita a cliente X para esse número (em qualquer máscara), então `recusado/telefone_em_uso`, X inalterada e a mensagem aponta a cliente existente; dado o mesmo número em outro salão, então a edição é aceita. Dado o número de uma cliente anonimizada, então é aceito. Integração.
- **CA-12** (RN-14): Dado duas edições paralelas de X e Y para o mesmo telefone livre, ou uma edição × um `upsertCliente` do mesmo telefone livre, quando executados (10 repetições), então exatamente um número resulta em uma cliente, sem 5xx nem impasse; a edição perdedora devolve `recusado/telefone_em_uso`; a perdedora do upsert recebe a cliente vencedora. Duas edições paralelas da mesma cliente (nomes distintos) terminam com um dos dois nomes, sem erro. Integração.
- **CA-13** (RN-15): Dado uma cliente com 3 reservas (cancelada, concluída, confirmada futura), cada uma com itens de preço/duração distintos, e o preço do serviço alterado depois, quando o gestor abre o detalhe, então vê as reservas da mais recente à mais antiga, horário no fuso do salão (salão em `America/Sao_Paulo` e outro em `America/Manaus` com a mesma instância UTC mostram horas diferentes; virada de dia respeitada), status em pt-BR, serviços na ordem, e total e duração dos **snapshots**. Dado nenhuma reserva, mostra "Nenhum agendamento ainda."; dado 60 reservas, mostra 50 e o total 60. Integração (+ unidade da formatação).
- **CA-14** (RN-16): Dado o profissional P1 com reserva da cliente C e o profissional P2 sem, quando `lerContatoDaCliente` é chamada, então P1 recebe nome e telefone de C; P2 e um profissional de outro salão recebem `NaoEncontrado`; o gestor recebe C, e uma anonimizada com `nome/telefone null` e `anonimizada: true`; id inválido → `NaoEncontrado`. Integração.
- **CA-15** (RN-3): Dado o gestor do salão S2 com `salaoId` de S1 forjado na entrada de qualquer ação, quando executa upsert/edição, então só S2 é afetado e as linhas de S1 ficam idênticas; contexto de salão inexistente → `NaoEncontrado`/erro de escopo existente, sem criar cliente. Integração.
- **CA-16** (RN-18): `clientes.acao.ts` não tem `'use server'`, todos os exports vêm de `defineAcao` com `papeis: ['gestor']` e `capacidade: 'configurar'` (teste de registro), o shell `acoes.ts` não importa repositório e o lint existente (repositórios só em `src/server/repos/`) passa. Unidade/lint.
- **CA-17** (RN-19): Dado `/dev/clientes` (vitrine, ação que só valida), quando o usuário percorre busca, lista, paginação e edição só pelo teclado, então toda ação é alcançável e o foco é visível; o axe 4.14.0 não acusa violações em lista, lista vazia, detalhe, erro e sucesso; sem JavaScript, a busca (GET) e a edição (POST) funcionam e preservam os valores digitados; viewport móvel 375×812 sem rolagem horizontal. E2E (Playwright, sem banco).
- **CA-18** (RN-1, RN-2): O resumo de erros da edição lista todos os campos inválidos, com link para o campo; mensagens em pt-BR; nenhum texto de erro revela dado de outra cliente. Unidade (componente) + E2E.

## 6. Casos limite

- **Fuso e virada de dia**: o histórico formata no fuso do salão; reserva às 23:30 locais cai no dia local correto mesmo quando o dia UTC é o seguinte (CA-13). Datas de criação da cliente não são exibidas.
- **Concorrência**: upsert × upsert (CA-6), edição × edição, edição × upsert (CA-12). Ordem de travas para a E3.2: profissional(is) → serviço(s) → **cliente (upsert)** → `reserva`/`reserva_item`. O `UPDATE` do upsert que não muda o telefone toma `FOR NO KEY UPDATE` (compatível com o `FOR KEY SHARE` da FK de `reserva`); a edição do telefone altera coluna chave. O arquiteto fixa a trava e confirma a ausência de impasse com a reserva em curso.
- **Isolamento**: CA-4, CA-15; `salao_id` em toda consulta, inclusive no histórico (reservas de outro salão com o mesmo `cliente_id` são impossíveis pela FK composta, mas o filtro de salão é obrigatório).
- **Salão suspenso**: a capacidade `configurar` é declarada; hoje a política é `permitirTudo` (`src/server/tenant/politica.ts`) e o bloqueio real é da E6.4. A lista, a busca, o detalhe e o histórico continuam consultáveis (leitura); a edição será bloqueada pela E6.4. Nenhum teste de suspensão nesta demanda.
- **Cliente anonimizada**: RN-4, RN-16, RN-17, CA-7. O contrato não implementa a ação: os testes criam a anonimizada pela fábrica (`tests/support/factories.ts:221`).
- **Telefone**: formatos da CA-1/CA-2; fixo de 10 dígitos aceito (S8); número com espaços/NBSP: NBSP não está na lista aceita e é recusado (comportamento atual do normalizador, sem mudança). Número de outra cliente em outro formato textual é a mesma cliente (comparação sempre pelo E.164 normalizado).
- **Entradas inválidas**: `q` gigante (cortado), `pagina` absurda, id da rota não UUID (404), campos que não são texto (objeto, array, número) → `invalido`, nunca erro 500; HTML/`<script>` no nome é gravado como texto e escapado na exibição.
- **Nome duplicado**: permitido (duas "Maria" com telefones diferentes); a identidade é o telefone.
- **Mudança de número da cliente**: a próxima reserva com o número novo cria nova cliente se o gestor não corrigiu o cadastro (sem mesclagem na v1); aviso fora do escopo.
- **Permissões por perfil**: gestor (com ou sem perfil de profissional), profissional (403 nas telas; contato só das próprias reservas), super admin (sem acesso ao painel), anônimo (redirecionamento).
- **Volume**: salões de milhares de clientes: busca por substring sequencial dentro do índice `(salao_id, …)`; aceitável na v1 (D-2); o arquiteto confirma com `EXPLAIN` num teste de plano se achar necessário.

## 7. Dependências

- **Já entregues**: E1.2 (sessão e papéis, D-010), `defineAcao` e escopo (D-005), normalizador de telefone e formatadores (D-020), fuso (`src/server/tempo/fuso.ts`, D-016), fábricas de dois salões, vitrines `/dev/*` e o padrão E2E (D-015..D-021).
- **Bloqueia**: E3.2 (#34, reserva pela equipe usa `upsertCliente`), E3.4 (encaixe), E4.2 (reserva pública) e E5.2 (#45, anonimização).
- **Futuras que consomem leituras daqui**: E3.3/E3.5 (`lerContatoDaCliente`), E4.3 (consentimento por cliente).
- **Integrações**: nenhuma (Mercado Pago, WhatsApp, e-mail e Turnstile não participam).
- **Infraestrutura**: nenhuma.

## 8. Impactos prováveis

- **Dados**: nenhuma tabela ou coluna nova; o esquema atual já tem UNIQUE, CHECKs e índice por cliente. Provável **sem migração** (D-2). Se o arquiteto optar por índice funcional ou coluna de busca, aciona o DBA. Verificar com o DBA apenas se o `normalize(…, NFD)` do PostgreSQL funciona na codificação do banco (UTF8) e a consulta do upsert com `xmax`.
- **Código**: novo `src/server/clientes/` (`tipos.ts`, `validacao.ts`, `servico.ts`, `leitura.ts`, `clientes.acao.ts`); `RepoCliente` ganha `upsert`, `buscar` (lista paginada), `atualizar` e a leitura do histórico (`src/server/repos/cliente.ts`, `tipos.ts`); páginas `src/app/painel/clientes/**` e `src/app/dev/clientes/**`; operação `cliente.contato` em `permissoes.ts` (e seu teste de matriz); formatadores/rotas em `navegacao.ts` se necessário. A `listar` atual (sem filtro de anonimizadas, sem página) tem de ser substituída ou renomeada; conferir seus consumidores antes (`grep` em `src/` e `tests/`).
- **CI/infra**: nenhuma mudança; os E2E novos entram no job `e2e` existente (vitrine sob `VITRINE_COMPONENTES=true`). DevOps dispensável (sem container, variável de ambiente ou workflow novos).
- **Documentação**: README (nova tela e comandos de estabilidade) e a tabela "Comandos e cobertura" do `CLAUDE.md`, com o comando de estabilidade: `for i in $(seq 10); do npx vitest run --project integration tests/integration/clientes/concorrencia.test.ts || break; done` (CA-6, CA-12).

## 9. Dúvidas

### Bloqueantes

Nenhuma.

### Não bloqueantes (suposições adotadas)

| ID | Decisão | Motivo |
|---|---|---|
| D-1 | Não usar `libphonenumber-js`; reutilizar `normalizarTelefoneBr` sem alterá-lo. | A issue previa a biblioteca antes da D-020; o normalizador já cobre CA-1/CA-2 e DDDs oficiais, evita dependência e é a fonte única. |
| D-2 | Sem migração nem extensão: busca por nome em SQL com `lower` + `regexp_replace(normalize(nome, NFD), '[̀-ͯ]', '', 'g')` e `position`/`LIKE` com escape, e por telefone nos dígitos do E.164; o texto de busca é normalizado na aplicação com a mesma regra (teste de paridade). | Prefere-se sem `pg_trgm`/`unaccent`; o volume por salão é pequeno e o filtro por `salao_id` usa o índice existente. Se o arquiteto/DBA preferir coluna de busca ou índice, vira migração com DBA. |
| D-3 | `upsertCliente` aceita só `ContextoEscopado`; a E4.2 (pública) o chama com um `SistemaContext` (`origem` de reserva pública) criado depois de resolver o salão pelo slug. | Mantém a regra de que escrita em tenant só entra por contexto escopado; o arquiteto confirma o desenho com a E3.2/E4.2. |
| D-4 | Nome com 2 a 100 caracteres; UI sem máscara no telefone (o servidor normaliza qualquer formato aceito). | Coerente com os demais nomes (D-013/D-014); evita máscara que falha sem JS. |
| D-5 | Nova operação `cliente.contato` (gestor `salao`, profissional `proprio`, super admin `negado`) para RN-16; `cliente.gerir` continua só do gestor. | O profissional não pode ter `cliente.gerir`, mas precisa de leitura mínima das próprias reservas; a matriz é o lugar do dado. |
| D-6 | A mensagem de telefone em uso mostra o nome da cliente existente e um link para ela (o gestor já vê todas as clientes do salão). | Ajuda a corrigir o duplicado sem mesclagem; sem vazamento entre salões. |
| D-7 | O upsert sempre grava (atualiza nome e `atualizado_em`) mesmo com nome igual; a idempotência estrita ("nada escrito") vale só na edição do gestor (RN-12). | O upsert vive na transação da reserva e precisa de uma instrução única atômica com `RETURNING`; o efeito final é o mesmo. |
| D-8 | Histórico limitado às 50 reservas mais recentes, com o total, sem paginação própria. | Suficiente para a v1; paginar depois sem mudar o contrato. |
| D-9 | Anonimizada: detalhe acessível por id (somente leitura, "Cliente removida"), fora da lista. | Preserva a agenda e o histórico (PLAN `:62`); a E5.2 pode refinar. |
| D-10 | Mecanismo de unicidade na edição (trava de aviso ou captura controlada do `23505` na restrição `cliente_salao_id_telefone_e164_key` dentro de savepoint) fica com o arquiteto, desde que o resultado siga RN-14/CA-12. | A regra "nunca capturar 23505" da D-017 era sobre o slug com `ON CONFLICT` disponível; `UPDATE` não tem `ON CONFLICT`. |
