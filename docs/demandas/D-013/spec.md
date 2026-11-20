# D-013 — Gerenciar profissionais, incluindo o gestor que também atende, com desativação (issue #16, E2.2)

Fontes, por precedência: `docs/demandas/D-013/issue-16.md` (RN e CA decididos, não reabertos), `PLAN.md` ("Perfis e acesso", "Serviços e profissionais", "Fora da primeira versão"), `CLAUDE.md` (invariantes), `docs/demandas/D-001/spec.md` (E2.2 em 631-656; S15 e S16 em 88-89; G-1, G-2 e G-4 em 10-13; fronteiras E1.4 em 528-542, E3.3 CA-6 em 861), `docs/demandas/D-010/spec.md` (RN-13, RN-14) e o código citado abaixo.

## 1. Problema

Hoje a funcionalidade não existe.

- Não há rota `/painel/profissionais`. `src/app/painel/` contém só `page.tsx`, `acoes.ts` e `_componentes/`. A rota já está declarada em `src/config/navegacao.ts:26` (`profissionais: '/painel/profissionais'`) e aparece na navegação do gestor em `src/config/navegacao.ts:62`, mas leva a uma página inexistente (404).
- Não há `src/server/profissionais/` e nenhum arquivo `*.acao.ts` (`find src -name "*.acao.ts"` não retorna nada).
- O repositório `src/server/repos/profissional.ts` só tem `buscarPorId`, `listar` (ativos e inativos) e `renomear`. Não tem criar, ativar, desativar nem o vínculo com o usuário.
- O cadastro do gestor (D-011) não cria perfil de profissional: não há referência a `profissional` em `src/server/repos/cadastro.ts`. As fábricas de teste criam esse perfil por padrão (`tests/support/factories.ts:28-30`, opção `gestor.comPerfil`).
- O que já existe e esta demanda reaproveita:
  - Esquema (`prisma/schema.prisma:240-265`): `profissional(id, salao_id, usuario_id NULL, nome, email NULL, ativo DEFAULT true, criado_em, atualizado_em)`, `UNIQUE (salao_id, usuario_id)` (um perfil por usuário) e FK composta para `usuario`. Reservas, jornadas, bloqueios, `servico_profissional` e `convite` apontam para o profissional com `ON DELETE RESTRICT`. Não há CHECK de minúsculas em `profissional.email`; esse CHECK só existe em `usuario` e `convite` (`prisma/migrations/20261118000200_restricoes_sql/migration.sql:77,87`).
  - Matriz de permissões (`src/server/auth/permissoes.ts:46`): `'profissional.gerir'` vale `salao` para o gestor e `negado` para o profissional e o super admin.
  - Revogação: `revogarSessoesDoUsuario(usuarioId, agora)` (`src/server/repos/sessao.ts:154-160`, reexportada em `src/server/auth/sessao.ts:60`) usa o cliente global (`obterPrisma()`), não um executor de transação.
  - Defesa em profundidade: `resolverTenant` devolve 401 para o papel `profissional` com perfil inativo ou ausente (`src/server/tenant/sessao.ts:55-57`). O gestor com perfil inativo continua entrando como gestor (D-010 RN-14).
  - Página pública: `listarProfissionaisPublicos` já filtra `ativo: true` (`src/server/repos/publico.ts:58-66`).
  - `defineAcao` (`src/server/tenant/define-acao.ts`) só transporta erros de domínio como código (`nao_autenticado`/`acesso_negado`/`nao_encontrado`; `src/server/tenant/erros.ts:5`). Não existe erro de negócio com conteúdo, como a lista de reservas que bloqueia a desativação.
  - A política por capacidade é `permitirTudo` (`src/server/tenant/politica.ts:20`) até a E6.4.

## 2. Objetivo

O gestor mantém, pelo painel, o quadro de profissionais do próprio salão: cadastra, edita, desativa e reativa. Também pode declarar que atende ("eu também atendo") e passa a ter um perfil de profissional com agenda própria. Nada é apagado: o histórico de reservas é preservado. Profissional desativado sai da página pública, não recebe novas reservas e perde o acesso.

## 3. Escopo

**Entra:**
- Lista de profissionais do salão (ativos e inativos), com estado e indicação de acesso.
- Criar profissional (nome; e-mail opcional, guardado para o convite).
- Editar nome e e-mail, com as restrições da RN-9.
- Desativar (com a recusa da RN-2) e reativar.
- Ação "Eu também atendo" para o gestor (cria o perfil vinculado ou reativa o existente).
- Efeitos colaterais da desativação: revogação de sessões e invalidação de convites pendentes.
- Ponto de entrada do convite: o e-mail fica guardado e a tela de edição reserva o lugar onde a E1.4 colocará "Enviar convite". **O envio não entra.**
- Testes de integração com dois salões (G-4), testes de permissão, testes unitários de validação e testes de componente da UI.

**Fica fora (com dono):**
- Envio e reenvio de convite, aceite e definição de senha: E1.4 (#21).
- Vínculo serviço × profissional: E2.1 (#25).
- Jornada semanal: E2.3. Bloqueios: E2.4. Agenda: E3.3. Reserva manual e encaixe: E3.4. Remarcação e cancelamento (inclusive para liberar um profissional antes de desativá-lo): E3.5.
- Bloqueio por estado do salão (suspenso, etc.): E6.4 (RN-4 da issue).
- Exclusão física de profissional: nunca (PLAN, "Serviços e profissionais").
- Conferido contra "Fora da primeira versão" do `PLAN.md:131`: nada aqui cria comissões, preço ou duração por profissional, nem múltiplos gestores. O perfil do gestor é um profissional, não um segundo gestor.

## 4. Regras de negócio

- **RN-1** (issue RN-1; PLAN "Serviços e profissionais"): o profissional nunca é apagado. Desativar grava `ativo = false`. O profissional desativado some da página pública (`listarProfissionaisPublicos`) e de toda consulta de "profissionais ativos" do salão, e não pode receber novas reservas, remarcações nem encaixes (obrigação das E3.2, E3.4 e E3.5, ver §7). Reservas, itens, jornadas, bloqueios, vínculos `servico_profissional` e convites existentes continuam apontando para ele.
- **RN-2** (issue RN-2; S16): a desativação é recusada se o profissional tiver ao menos uma **reserva futura confirmada** (definição na D-1). A resposta lista **todas** essas reservas, ordenadas por início, cada uma com a data e o horário de início no fuso do salão, os nomes dos serviços (do snapshot dos itens) e o nome da cliente, ou "cliente removida" se ela foi anonimizada. Nenhuma alteração é gravada na recusa.
- **RN-3** (issue RN-3; PLAN "Perfis e acesso"): o gestor tem no máximo um perfil de profissional vinculado (`usuario_id` = id do gestor), e esse perfil não exige convite. "Eu também atendo":
  - sem perfil vinculado: cria um perfil ativo, com `nome` = nome do usuário gestor, `usuario_id` = gestor e `email` nulo;
  - com perfil inativo: reativa esse perfil;
  - com perfil ativo: não faz nada e informa que o gestor já atende.
  Em todos os casos o salão fica com exatamente um perfil vinculado ao gestor. A garantia final é `UNIQUE (salao_id, usuario_id)`.
- **RN-4** (issue RN-4; G-2): toda ação mutável desta demanda é declarada com `defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })`. A leitura (lista e página de edição) usa `exigirAcessoAoPainel` mais `exigirPermissao(ctx, 'profissional.gerir')`. O bloqueio por estado do salão é da E6.4.
- **RN-5** (CLAUDE.md "Tenant isolation"; G-1, G-4): o `salao_id` vem só da sessão. Um ID de profissional de outro salão, inexistente ou malformado resulta em `NaoEncontrado` (404), com corpo idêntico nos três casos. O registro do outro salão fica inalterado. A lista só traz profissionais do salão da sessão.
- **RN-6** (matriz D-010; PLAN "Perfis e acesso"): só o gestor gerencia profissionais. O papel `profissional` recebe `AcessoNegado` (403) em toda ação desta demanda, inclusive sobre o próprio perfil, e a página mostra "Acesso negado". Sem sessão válida: 401 nas ações e redirecionamento para `/entrar?proximo=/painel/profissionais` nas páginas.
- **RN-7** (S16; D-010 RN-13 e RN-14): desativar um profissional **vinculado a um usuário de papel `profissional`** revoga, na mesma transação da desativação, todas as sessões não revogadas desse usuário (grava `revogada_em`, nunca apaga). Desativar o perfil do **gestor** não revoga as sessões do gestor: ele continua entrando como gestor (D-010 RN-14). Desativar um profissional sem usuário vinculado não mexe em sessões.
- **RN-8** (S15; E1.4 RN-2): a desativação invalida, na mesma transação, os convites pendentes do profissional (`aceito_em` e `invalidado_em` nulos → `invalidado_em = agora`). Reativar não restaura convites nem sessões.
- **RN-9** (issue, escopo "editar"): campos editáveis:
  - `nome`: obrigatório; aparado e com espaços internos repetidos colapsados; de 2 a 100 caracteres (mesmo limite do nome no cadastro, `src/server/auth/cadastro.ts:25`).
  - `email`: opcional. Vazio ou só espaços vira `NULL`. Se informado, é aparado, convertido para minúsculas e validado com o mesmo `esquemaEmail` do cadastro (`src/server/auth/confirmacao-email.ts`; máximo de 254 caracteres).
  - Se o profissional já tem usuário vinculado (convite aceito ou perfil do gestor), o e-mail **não** é editável: a tela mostra o e-mail de login como somente leitura e o servidor recusa a alteração com erro de campo. Trocar o e-mail de login está fora do escopo.
  - Toda validação ocorre no servidor. A validação no cliente é só conveniência.
- **RN-10** (soft delete): reativar (`ativo = true`) não tem pré-condição além da permissão. O profissional reativado volta à lista de ativos e à página pública, sujeito às regras de E2.1/E4.1 (por exemplo, ter serviço vinculado). Se ele tem usuário, volta a conseguir entrar com uma nova sessão.
- **RN-11** (CLAUDE.md "UI conventions"; D-009): a interface é em pt-BR, usa os componentes de `src/components/ui/` e o `PanelLayout`, e funciona só com o teclado. A desativação pede confirmação por `ConfirmDialog`. A lista de reservas que bloqueiam a desativação aparece como alerta acessível (anunciado por leitor de tela). Datas são formatadas só por `src/lib/format.ts`.
- **RN-12** (PLAN "Perfis e acesso"): o vínculo `usuario_id` não é editável por estas telas. Ele só nasce pelo "eu também atendo" (gestor) ou pelo aceite de convite (E1.4).

## 5. Critérios de aceitação

Os CA-1 a CA-4 são os da issue, refinados. Do CA-5 em diante são complementares. Salvo indicação, a verificação é por teste de integração em `tests/integration/profissionais/` contra PostgreSQL real, com `criarDoisSaloes()`, e as ações são chamadas por `acao.executar(credencial, input, { agora })`. Correspondência com o PLAN: CA-1, CA-9 e CA-10 sustentam o critério 1 do PLAN; CA-4 e CA-6 sustentam o critério 4.

- **CA-1** (issue CA-1): Dado o gestor do salão A, quando cria o profissional "Ana" sem e-mail, então a ação devolve sucesso, `listar` do salão A inclui "Ana" com `ativo = true`, a linha no banco tem `salao_id = A`, `ativo = true`, `usuario_id IS NULL` e `email IS NULL`, e a lista do salão B não a contém.
- **CA-2** (issue CA-2; RN-3): Dado o gestor do salão A sem perfil de profissional (fábrica `gestor.comPerfil: false`), quando aciona "eu também atendo", então passa a existir exatamente um `profissional` com `usuario_id` = gestor e `ativo = true`, e uma nova sessão do gestor resolve um `TenantContext` com `profissionalId` igual ao id desse perfil (agenda própria, `exigirPermissao(ctx, 'agenda.ver', { profissionalId })` não lança). Quando aciona de novo, então a contagem continua 1 e a resposta indica "já atende".
- **CA-3** (issue CA-3; RN-2): Dado um profissional com duas reservas `confirmado` futuras (uma delas com cliente anonimizada) e uma `cancelado` futura, quando o gestor tenta desativá-lo, então a operação é recusada, a resposta lista exatamente as duas confirmadas em ordem de início (início no fuso do salão, serviços e cliente, com "cliente removida" na anonimizada), a cancelada não aparece, `ativo` continua `true` e nenhuma sessão nem convite é alterado.
- **CA-4** (issue CA-4; RN-1): Dado um profissional sem reservas futuras confirmadas e com uma reserva **passada** criada no teste (a fábrica só cria uma reserva futura, `tests/support/factories.ts:37`), quando é desativado, então a linha permanece com `ativo = false`, `listarProfissionaisPublicos` e a consulta de ativos do salão não o retornam, `listar` (painel) o retorna como inativo, e a reserva passada, os itens, as jornadas e os vínculos `servico_profissional` dele continuam com o mesmo `profissional_id`. Nenhuma linha de `profissional` é apagada (contagem antes = depois).
- **CA-5** (RN-7, S16): Dado o usuário de papel `profissional` do salão A com duas sessões abertas (login real com `entrarDeVerdade`) e sem reservas futuras confirmadas, quando o gestor o desativa, então as duas sessões ficam com `revogada_em` preenchido, uma requisição com qualquer dos cookies resulta em `NaoAutenticado` (401), e uma tentativa de login com a senha correta é recusada com "Seu acesso está desativado. Fale com a gestão do salão." (D-010 RN-7). As sessões de outros usuários (o gestor e os usuários do salão B) continuam válidas.
- **CA-6** (RN-7; D-010 RN-14): Dado o gestor com perfil vinculado e sem reservas futuras confirmadas nele, quando desativa o próprio perfil, então `ativo = false`, a sessão atual do gestor continua válida, ele continua acessando `/painel/profissionais`, e "eu também atendo" reativa o **mesmo** perfil (mesmo id, contagem 1).
- **CA-7** (RN-8): Dado um profissional com um convite pendente, um aceito e um já invalidado (inseridos no teste), quando é desativado, então só o pendente ganha `invalidado_em = agora`, e os outros dois ficam inalterados.
- **CA-8** (RN-10): Dado um profissional desativado com usuário vinculado, quando o gestor o reativa, então `ativo = true`, ele volta em `listarProfissionaisPublicos`, as sessões revogadas continuam revogadas e um novo login com a senha correta cria uma sessão que resolve contexto.
- **CA-9** (RN-5, G-4): Dado o gestor do salão A e o id de um profissional do salão B, quando chama editar, desativar e reativar com esse id, então cada chamada devolve `{ ok: false, erro: 'nao_encontrado', status: 404 }`, a linha de B fica byte a byte igual (nome, e-mail, `ativo`, `atualizado_em`) e nenhuma sessão nem convite de B muda. O mesmo resultado vale para um UUID inexistente e para um id malformado (`'abc'`). A página de edição com o id de B responde 404.
- **CA-10** (RN-5, G-4): Dado que os salões A e B têm profissionais, quando o gestor de A lista, então só vê os de A, e "eu também atendo" do gestor de A nunca cria nem altera perfil em B.
- **CA-11** (RN-6): Dado o usuário de papel `profissional` (ativo), quando chama criar, editar (inclusive o próprio perfil), desativar, reativar ou "eu também atendo", então cada uma devolve `acesso_negado` (403) sem alterar o banco, e `GET /painel/profissionais` renderiza "Acesso negado". Sem cookie, as ações devolvem `nao_autenticado` (401) e a página redireciona para `/entrar?proximo=%2Fpainel%2Fprofissionais`. Teste de registro: todo `*.acao.ts` novo passa em `verificarAcoes` com capacidade `configurar` e `papeis: ['gestor']` (unitário).
- **CA-12** (RN-9): Dadas entradas inválidas (nome vazio, só espaços, 1 caractere, 101 caracteres; e-mail `ana@`, e-mail com 255 caracteres), quando criar ou editar é chamado, então a ação devolve erro por campo em pt-BR e nada é gravado. Dado `"  ANA@Exemplo.COM "`, então o valor gravado é `ana@exemplo.com`. Dado e-mail vazio, então o valor gravado é `NULL`. Os casos de normalização e de limite são cobertos por teste unitário do validador.
- **CA-13** (RN-9, RN-12): Dado um profissional com usuário vinculado, quando o gestor tenta alterar o e-mail, então a ação devolve erro de campo e `profissional.email` e `usuario.email` ficam inalterados. A alteração só do nome é aceita.
- **CA-14** (RN-3, concorrência): Dado o gestor sem perfil, quando dez chamadas de "eu também atendo" rodam em paralelo (`Promise.all`), então todas terminam sem erro 5xx e existe exatamente um perfil vinculado ao gestor.
- **CA-15** (RN-2, D-1, fronteira de tempo): Com o relógio injetado em `agora`, dadas reservas `confirmado` com (a) `fim` = `agora` − 1 min, (b) `inicio` < `agora` < `fim` (em andamento) e (c) `inicio` = `agora` + 1 min: quando o gestor tenta desativar, então (b) e (c) bloqueiam e são listadas, e (a) não bloqueia. Com só (a), a desativação é aceita.
- **CA-16** (RN-11; teste de componente jsdom e conferência manual): a lista mostra nome, estado ("Ativo"/"Inativo") e acesso ("Você", "Com acesso", "Sem acesso"), e tem estado vazio com chamada para cadastrar. O formulário tem rótulos associados aos campos e erros ligados por `aria-describedby`. A desativação abre o `ConfirmDialog`, que prende o foco e fecha com Esc. A recusa aparece em região anunciada (`role="alert"`) com a lista de reservas. Todos os controles são alcançáveis por Tab e acionáveis por Enter/Espaço. Passo manual: percorrer criar → editar → desativar → reativar só com o teclado na viewport de 375 px.
- **CA-17** (RN-1 e RN-2; ver também a D-7): a desativação e a verificação de reservas ocorrem numa única transação com bloqueio da linha do profissional (`SELECT … FOR UPDATE`). Teste: com a transação de desativação parada depois do bloqueio, uma segunda desativação ou reativação concorrente do mesmo profissional espera e termina num estado consistente (sem erro 5xx; `ativo` final é o da última a terminar; sessões revogadas se o estado final for inativo).

## 6. Casos limite

- **Fuso e virada de dia:** "futura" compara instantes UTC (`fim > agora`). O fuso só entra na exibição das reservas listadas (RN-2), feita por `src/lib/format.ts` com o fuso do salão. Uma reserva às 23h30 de São Paulo aparece no dia local correto, não no dia UTC (verificar no CA-3 com início às 02:30Z, que é 23:30 do dia anterior em `America/Sao_Paulo`).
- **Reserva em andamento:** bloqueia (D-1, CA-15).
- **Reserva passada ainda `confirmado`** (status não marcado): não bloqueia; a marcação de status é da E3.5.
- **Status `concluido`/`nao_compareceu`/`cancelado` no futuro:** não bloqueiam.
- **Concorrência:** "eu também atendo" em paralelo (CA-14; a UNIQUE garante, e a violação vira "já atende", não 5xx). Desativar e reativar concorrentes (CA-17). Desativação concorrente com a criação de uma reserva: ver a D-7 e §7.
- **Isolamento entre salões:** CA-9 e CA-10. Também o 404 uniforme para ID malformado ou inexistente.
- **Salão suspenso / estado da assinatura:** a capacidade `configurar` está declarada. Até a E6.4 a política permite tudo, e o comportamento sob suspensão é testado na E6.4.
- **Cliente anonimizada:** aparece como "cliente removida" na lista de recusa (CA-3). Nunca expor o telefone.
- **Gestor com perfil inativo:** continua gestor e vê a lista. Seu perfil aparece como inativo, com acesso "Você".
- **Profissional com sessão em uso no momento da desativação:** a próxima requisição dá 401 (revogação mais D-010 RN-14).
- **Nomes duplicados no salão:** permitidos (D-4).
- **E-mail de outro salão, ou já usado por algum usuário:** aceito no cadastro do profissional. A recusa acontece no convite (E1.4 RN-3, D-5).
- **Entradas inválidas:** tipos errados ou campos extras no input da ação resultam em erro de validação, sem 5xx. O ID vem só da rota ou do campo oculto e é revalidado no servidor.
- **Telefone:** não se aplica (o profissional não tem telefone no esquema).
- **Perfil do gestor sem e-mail:** a coluna fica nula. O e-mail de login aparece só como leitura (vem do usuário).

## 7. Dependências

- **Já entregues:** E0.4 (esquema), E0.5 (`defineAcao`, repositórios escopados, harness com dois salões), E0.8 (componentes e layout), E1.2/D-010 (sessões, `revogarSessoesDoUsuario`, matriz, `exigirAcessoAoPainel`, RN-14), E1.1/D-011 (validador de e-mail `esquemaEmail`).
- **Integrações:** nenhuma. Não há e-mail, WhatsApp, Mercado Pago nem Turnstile nesta demanda.
- **Obrigações que esta demanda cria para as próximas** (registrar nas issues correspondentes):
  - E3.2, E3.4 e E3.5: ao criar, encaixar ou remarcar uma reserva para um profissional, conferir `ativo = true` **dentro da transação**, com bloqueio compartilhado da linha do profissional (`FOR SHARE`), para não correr contra a desativação (D-7).
  - E1.4: recusar convite para profissional inativo e para profissional com usuário vinculado. O convite usa `profissional.email`.
  - E2.1: a leitura pública de serviços considera só profissionais ativos (já previsto em D-001 `spec.md:605`).
  - E3.3 CA-6: reserva passada de profissional desativado aparece com o nome dele (garantido aqui pela RN-1).
- **Bloqueia:** #21 (E1.4), #25 (E2.1), #18 (E2.3), #19 (E2.4), conforme a issue.

## 8. Impactos prováveis

- **Dados:** a princípio nenhuma migração. O esquema já tem `ativo`, `usuario_id` (UNIQUE), `email` e `convite.invalidado_em`. Pontos para o arquiteto e, se ele julgar necessário, o DBA:
  - (a) `revogarSessoesDoUsuario` usa o cliente global. Para a RN-7 (mesma transação), é preciso uma variante que receba o `Executor` da transação.
  - (b) A consulta de reservas futuras por profissional usa o índice existente `(salao_id, profissional_id, inicio)`. Avaliar se `fim > agora` com `inicio` como prefixo atende, e se cabe filtrar por `inicio > agora − duração máxima`.
  - (c) Opcional: CHECK de minúsculas em `profissional.email`, por simetria com `usuario` e `convite`. Hoje a normalização seria só na aplicação (D-6).
- **Repositórios:** ampliar `src/server/repos/profissional.ts` (criar, atualizar, ativar/desativar com bloqueio, perfil do gestor, listar ativos) e criar uma consulta de reservas futuras confirmadas com itens e cliente, que pode ficar em `repos/reserva.ts`.
- **Contrato de ação:** a recusa da RN-2 é um resultado de negócio com conteúdo (a lista de reservas). `ResultadoAcao` só carrega códigos 401/403/404. O arquiteto deve definir a forma, por exemplo `{ ok: true, dados: { resultado: 'recusado', reservas } }` ou um novo tipo de erro. Recomendação: resultado de sucesso discriminado, sem alterar `ErroDeDominio`.
- **Rotas:** `ROTAS` só tem `profissionais` e `jornada(id)`. Serão necessárias rotas para criar e editar (D-3).
- **Infra/CI:** nenhum impacto esperado (sem env nova, serviço, job ou script). O DevOps pode ser dispensado.
- **Cobertura:** novos arquivos em `src/server/profissionais/` e `src/app/painel/profissionais/` entram no gate de 90%.

## 9. Dúvidas

### Bloqueantes
Nenhuma.

### Não bloqueantes (suposições adotadas)
- **D-1 — "Reserva futura confirmada"** = `status = 'confirmado'` e `fim > agora` (inclui a reserva em andamento). Motivo: desativar no meio de um atendimento deixaria uma reserva ativa de um profissional sem acesso, que não poderia marcar o status. Alternativa descartada: `inicio > agora`.
- **D-2 — Lista de recusa sem limite:** traz todas as reservas que bloqueiam, ordenadas. Na v1, um profissional tem no máximo cerca de 60 dias de agenda futura (janela máxima), então o volume é pequeno.
- **D-3 — Rotas:** `/painel/profissionais` (lista, com a ação "Eu também atendo" visível só para o gestor sem perfil ativo), `/painel/profissionais/novo` e `/painel/profissionais/[id]` (editar, desativar/reativar e o lugar do convite da E1.4). O arquiteto pode consolidar, desde que todas fiquem em `ROTAS` e nenhum segmento conflite com `SEGMENTOS_RESERVADOS`.
- **D-4 — Nomes duplicados permitidos** no mesmo salão. Não há restrição no PLAN, e duas "Ana" são comuns. A lista desempata pelo e-mail ou pelo estado.
- **D-5 — Sem unicidade de e-mail no cadastro do profissional.** A regra "e-mail já usado por outro usuário não pode ser convidado" é da E1.4 e se aplica no envio do convite.
- **D-6 — E-mail normalizado na aplicação** (minúsculas, aparado). O CHECK no banco fica a critério do DBA (§8 c).
- **D-7 — Corrida entre desativação e nova reserva:** a desativação bloqueia a linha do profissional (`FOR UPDATE`) e verifica as reservas na mesma transação. A garantia completa depende de E3.2/E3.4/E3.5 tomarem `FOR SHARE` na mesma linha (obrigação registrada em §7). Nesta demanda, o teste cobre só a concorrência entre ações de profissionais (CA-17).
- **D-8 — "Eu também atendo" não é um interruptor:** só cria ou reativa. Para deixar de atender, o gestor desativa o próprio perfil na lista (sujeito à RN-2).
- **D-9 — Ordenação da lista:** ativos primeiro, depois inativos, cada grupo por nome (o `listar` atual ordena só por nome; o arquiteto escolhe onde ordenar).
- **D-10 — Sem auditoria:** o log de auditoria do PLAN é obrigatório só para ações de super admin. Ações do gestor sobre profissionais não geram `auditoria`.
- **D-11 — Sem E2E Playwright obrigatório:** o PLAN exige Playwright para o fluxo público. A acessibilidade é coberta por testes de componente (CA-16) e um passo manual. Um E2E com banco fica a critério do arquiteto.
- **D-12 — Nome inicial do perfil do gestor** = `usuario.nome`, editável depois pela tela de edição. Mudar o nome do perfil não altera `usuario.nome`.
