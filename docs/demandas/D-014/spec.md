# D-014 — Gerenciar serviços e definir quais profissionais executam cada um (issue #25, E2.1)

Fontes, por precedência: `docs/demandas/D-014/issue-25.md` (RN-1..RN-6 e CA-1..CA-6 decididos, não reabertos), `PLAN.md` ("Serviços e profissionais", linhas 24-28; "Agenda e atendimento", 34 e 37; "Fora da primeira versão", 131; critérios de aceite 1 e 2, linhas 135-136), `CLAUDE.md` (invariantes "Tenant isolation", "Soft deletes", "Multi-service bookings", "UI conventions"), `docs/demandas/D-001/spec.md` (E2.1 em 596-629; G-1..G-4 em 10-13; S16 em 89; E3.1 RN-1 em 780; E4.1 RN-2 em 965), `docs/demandas/D-013/spec.md` e `design.md` (padrão de ações, casca e telas) e o código citado abaixo.

## 1. Problema

Hoje a funcionalidade não existe.

- Não há páginas de serviços: `src/app/painel/` só contém `page.tsx`, `acoes.ts`, `_componentes/` e `profissionais/`. A rota `servicos: '/painel/servicos'` já está em `src/config/navegacao.ts:25` e no menu do gestor (`src/config/navegacao.ts:66`), mas leva a 404. Não há rotas de criar nem de editar serviço em `ROTAS`.
- Não há `src/server/servicos/`. O repositório `src/server/repos/servico.ts` só tem `buscarPorId`, `listar` (ativos e inativos, por nome) e `renomear`. Não cria, não edita preço/duração, não ativa/desativa e não mexe em vínculos.
- Não há repositório para `servico_profissional`; só as fábricas de teste criam vínculos (`tests/support/factories.ts:174-184`).
- A leitura pública `listarServicosPublicos` (`src/server/repos/publico.ts:49-56`) filtra só `ativo: true`. **Ela ainda devolve serviços sem nenhum profissional ativo vinculado**, o que contraria o escopo da issue e a E4.1 RN-2 (`docs/demandas/D-001/spec.md:965`).
- O que já existe e esta demanda reaproveita:
  - Esquema (`prisma/schema.prisma:267-298`): `servico(id, salao_id, nome, preco_centavos int, duracao_min int, ativo DEFAULT true, criado_em, atualizado_em)`, `UNIQUE (salao_id, id)`; `servico_profissional(salao_id, servico_id, profissional_id, criado_em)` com PK `(salao_id, servico_id, profissional_id)`, índice `(salao_id, profissional_id)` e FKs **compostas** `(salao_id, servico_id)` → `servico` e `(salao_id, profissional_id)` → `profissional`, todas `ON DELETE RESTRICT`. As FKs compostas já impedem, no banco, um vínculo entre salões diferentes.
  - `reserva_item` (`prisma/schema.prisma:417-435`) guarda `preco_centavos` e `duracao_min` próprios (snapshot) e aponta para o serviço com `ON DELETE RESTRICT`.
  - CHECKs (`prisma/migrations/20261118000200_restricoes_sql/migration.sql:113-117`): `servico.preco_centavos >= 0` e `servico.duracao_min > 0`. **Não há** CHECK de múltiplo de 5 nem de teto.
  - Permissões (`src/server/auth/permissoes.ts:43`): `'servico.gerir'` vale `salao` para o gestor e `negado` para o profissional e o super admin. O menu do profissional não tem "Serviços" (`src/config/navegacao.ts:72`).
  - `exigirAcessoAoPainel(caminho, papeis?, operacao?)` (`src/server/auth/pagina.ts:24`) e o padrão de ações da D-013: `src/server/<modulo>/<modulo>.acao.ts` sem `'use server'`, só exportações de `defineAcao`, handler fino que delega a um `servico.ts`; casca `src/app/**/acoes.ts` com `'use server'` que converte `FormData` em input e o resultado em estado de formulário (`src/server/profissionais/profissionais.acao.ts`, `src/app/painel/profissionais/acoes.ts`).
  - `formatarMoeda(centavos)` (`src/lib/format.ts:15`), aritmética inteira, sem float. Não há parser de moeda nem formatador de duração.
  - Fábrica: dois serviços ativos (R$ 90,00/60 min e R$ 55,00/30 min) vinculados ao profissional ativo e ao perfil do gestor, um inativo vinculado só ao profissional inativo, e uma reserva futura com dois itens com snapshot (`tests/support/factories.ts:60-64, 158-184, 228-255`).

## 2. Objetivo

O gestor mantém, pelo painel, o catálogo de serviços do próprio salão (nome, preço fixo em reais, duração e situação) e indica quais profissionais executam cada serviço. Nada é apagado e as reservas já feitas não mudam. A página pública e o cálculo de disponibilidade passam a ter uma leitura única e confiável dos serviços ofertáveis.

## 3. Escopo

**Entra:**
- Lista de serviços do salão (ativos e inativos) com nome, preço, duração, situação e quantidade de profissionais ativos vinculados.
- Criar e editar serviço (nome, preço, duração), já com a escolha dos profissionais que o executam.
- Desativar e reativar serviço.
- Vincular e desvincular profissionais (no formulário do serviço).
- Função de leitura dos serviços públicos do salão (ativos **e** com ao menos um profissional ativo vinculado), usada por E3.1 e E4.1, corrigindo `listarServicosPublicos`.
- Testes unitários (validação e parser de preço), de integração com PostgreSQL real (CA, isolamento G-4, permissões, snapshot) e de componente.

**Fica fora (com dono):**
- Preço ou duração por profissional: fora da v1 (`PLAN.md:131`; issue). Nada de colunas no vínculo.
- Cálculo de disponibilidade e elegibilidade por combinação de serviços: E3.1 (#27).
- Criação de reserva e cópia do snapshot para `reserva_item`: E3.2. Recusa de serviço inativo em nova reserva, reserva manual ou remarcação: E3.2/E3.4/E3.5 (obrigação registrada em §7).
- Exibição pública dos serviços: E4.1.
- Bloqueio por estado do salão (suspenso): E6.4 (RN-5 da issue).
- Edição de vínculos a partir da tela do profissional: fora (D-6).
- Categorias, descrição, foto ou ordem manual de serviços: não pedidos pelo PLAN.
- Conferido contra "Fora da primeira versão" (`PLAN.md:131`): nada aqui cria caixa, estoque, comissões, relatórios financeiros, pagamentos de cliente ou preço/duração por profissional.

## 4. Regras de negócio

- **RN-1** (issue RN-1; PLAN 26): campos do serviço, todos validados no servidor (a validação no cliente é só conveniência):
  - `nome`: obrigatório; aparado, espaços internos repetidos colapsados; de 2 a 100 caracteres (mesma regra do nome do profissional, D-013 RN-9).
  - `preço`: digitado em reais no formato pt-BR e gravado em **centavos inteiros**, ≥ 0 e ≤ R$ 99.999,99 (9.999.999 centavos; D-2). A conversão é feita por texto e aritmética inteira, nunca por `parseFloat`/`Number` com casas decimais (D-1 define os formatos aceitos).
  - `duração`: inteiro de minutos, > 0, múltiplo de 5, ≤ 720 (D-3).
  - `situação`: `ativo` (padrão `true` na criação); muda só por desativar/reativar.
- **RN-2** (issue RN-2; PLAN 28; CLAUDE.md "Soft deletes"; S16): o serviço nunca é apagado (não há ação nem tela de exclusão). Desativar grava `ativo = false`; o serviço sai da leitura pública (RN-7) e não pode entrar em novas reservas (obrigação de E3.2/E3.4/E3.5). Reservas e itens existentes não mudam. Desativar não tem pré-condição: reservas futuras com o serviço continuam válidas (S16, "desativar serviço não afeta reservas existentes"). Reativar também não tem pré-condição.
- **RN-3** (issue RN-3; PLAN 37): editar preço, duração ou nome do serviço não altera nenhuma linha de `reserva_item` (snapshot de preço e duração) nem `reserva.fim`/`ocupado_ate`. A tela de reservas que exibe o nome do serviço (E3.3) mostra o nome atual; isso é aceito (D-8).
- **RN-4** (issue RN-4; CLAUDE.md "Tenant isolation"): só profissionais **do salão da sessão** podem ser vinculados. Um id de profissional de outro salão, inexistente ou malformado faz a operação inteira ser recusada (G-3) com o mesmo erro de campo em pt-BR nos três casos, sem gravar nada. A FK composta do banco é a segunda barreira.
- **RN-5** (issue RN-5; G-2): toda ação mutável é `defineAcao({ papeis: ['gestor'], capacidade: 'configurar' })`. As páginas usam `exigirAcessoAoPainel(rota, ['gestor'], 'servico.gerir')` (ou equivalente com a operação). Só o gestor gerencia serviços: o papel `profissional` recebe `acesso_negado` (403) nas ações e "Acesso negado" nas páginas; sem sessão, 401 nas ações e redirecionamento para `/entrar?proximo=<rota>` nas páginas. O bloqueio por estado do salão é da E6.4.
- **RN-6** (issue RN-6): nome duplicado no mesmo salão é permitido, sem aviso.
- **RN-7** (issue, escopo; E4.1 RN-2; E3.1 RN-1): a leitura pública de serviços do salão devolve só serviços com `ativo = true` **e** com ao menos um vínculo com profissional `ativo = true` do mesmo salão. Campos públicos apenas (`id`, `nome`, `precoCentavos`, `duracaoMin`), ordem por nome e id. É a única função para E3.1 e E4.1 obterem os serviços ofertáveis.
- **RN-8** (PLAN 27; CLAUDE.md "Multi-service bookings"): o vínculo é só um par serviço × profissional, sem preço ou duração próprios. Desvincular apaga a linha de `servico_profissional` (é uma associação, não uma entidade com histórico; nenhuma reserva aponta para ela). Desvincular não altera reservas existentes daquele profissional com aquele serviço.
- **RN-9** (D-013 RN-1; issue RN-2): desativar serviço ou profissional **não** apaga vínculos. Reativar um ou outro restaura a oferta sem reconfigurar. Vínculos com profissional inativo não contam para RN-7.
- **RN-10** (decorrência de RN-4 e D-013 RN-1): só profissionais **ativos** podem ser marcados num novo vínculo. Pedir vínculo novo com profissional inativo do próprio salão é recusado com erro de campo. Ao salvar o formulário, o conjunto enviado substitui apenas os vínculos com profissionais **ativos**; vínculos já existentes com profissionais inativos são preservados (D-5).
- **RN-11** (CLAUDE.md "UI conventions"; D-009): interface em pt-BR, com `PanelLayout` e componentes de `src/components/ui/`, usável só com o teclado e responsiva. Moeda exibida só por `formatarMoeda`; duração por um formatador em `src/lib/format.ts` (D-7). Os formulários (criar, editar com vínculos, desativar, reativar) funcionam sem JavaScript (`<form action>` de server action, progressive enhancement), como na D-013.
- **RN-12** (CLAUDE.md "Tenant isolation"; G-1, G-4): o `salao_id` vem só da sessão. Id de serviço de outro salão, inexistente ou malformado resulta em `nao_encontrado` (404) com corpo idêntico, sem alterar o registro do outro salão. A lista só traz serviços do salão da sessão.
- **RN-13** (atomicidade): salvar o serviço e o conjunto de vínculos ocorre numa única transação; qualquer recusa (validação de campo ou profissional inválido) não grava nem o serviço nem os vínculos.

## 5. Critérios de aceitação

CA-1 a CA-6 são os da issue, refinados; CA-7 em diante são complementares. Salvo indicação, verificação por teste de integração em `tests/integration/servicos/` com PostgreSQL real, `criarDoisSaloes()` e `acao.executar(credencial, input, { agora })`. Correspondência com o PLAN: CA-4, CA-9, CA-10 sustentam o critério 1; CA-3, CA-8 e CA-12 sustentam o critério 2 (só serviços ofertáveis chegam ao fluxo público).

- **CA-1** (issue CA-1): Dado o gestor do salão A, quando cria o serviço "Corte" com preço "80,00" e duração 45, então a ação devolve sucesso, a linha tem `salao_id = A`, `preco_centavos = 8000`, `duracao_min = 45`, `ativo = true`, e a lista do salão A o mostra como "Ativo" com "R$ 80,00" (via `formatarMoeda`) e "45 min"; a lista do salão B não o contém.
- **CA-2** (issue CA-2; RN-3): Dado o serviço da fábrica com itens de reserva (ajustado para R$ 80,00 / `preco_centavos = 8000`), quando o gestor altera o preço para "90,00" e a duração para 30, então o serviço fica com 9000/30 e todos os `reserva_item` desse serviço mantêm `preco_centavos = 8000` e a duração original, e `reserva.inicio`/`fim`/`ocupado_ate` ficam inalterados.
- **CA-3** (issue CA-3; RN-2, RN-7): Dado um serviço ativo com profissional ativo vinculado e itens de reserva, quando o gestor o desativa, então a linha continua no banco com `ativo = false` (contagem de `servico` igual antes e depois), a leitura pública não o retorna, os itens de reserva e a reserva ficam byte a byte iguais e os vínculos dele continuam existindo. Quando o gestor o reativa, então ele volta à leitura pública.
- **CA-4** (issue CA-4; RN-4): Dado o gestor do salão A, quando tenta criar ou editar um serviço de A com um id de profissional do salão B na lista de vínculos, então a ação devolve erro de campo `profissionais` em pt-BR, nenhum vínculo é criado (contagem de `servico_profissional` de A e B igual), e, na edição, nome/preço/duração do serviço não mudam (RN-13). O mesmo resultado (mesma mensagem) vale para um UUID inexistente e para `'abc'`.
- **CA-5** (issue CA-5; RN-1): Dadas as entradas inválidas abaixo, quando criar ou editar é chamado, então a ação devolve erro por campo em pt-BR e nada é gravado: duração `0`, `-5`, `7`, `725`, `"45.5"`, vazia; preço `"-1,00"`, `"abc"`, `"80,001"`, `"80.00"`, `"100.000,00"`, vazio; nome vazio, só espaços, 1 caractere, 101 caracteres. Os mesmos casos, mais os aceitos da D-1 (por exemplo `"80"` → 8000, `"80,5"` → 8050, `"1.234,56"` → 123456, `"R$ 0,00"` → 0, `"0,10"` → 10), são cobertos por teste unitário do validador/parser.
- **CA-6** (issue CA-6): Dado um profissional ativo do salão A (fábrica) não vinculado a um serviço, quando o gestor salva a edição do serviço marcando-o, então existe a linha `servico_profissional(A, servico, profissional)` e a página de edição do serviço o mostra marcado. Quando o gestor salva de novo desmarcando-o, então a linha deixa de existir e as reservas existentes do profissional com esse serviço ficam inalteradas.
- **CA-7** (RN-10, D-5): Dado um serviço vinculado a um profissional ativo P1 e a um profissional inativo P2, quando o gestor salva o formulário com o conjunto vazio, então o vínculo com P1 é removido e o com P2 permanece. Quando tenta vincular P2 (inativo), então recebe erro de campo e nada muda.
- **CA-8** (RN-7, caso limite da issue): Dados no salão A: S1 ativo com profissional ativo; S2 ativo sem vínculo; S3 ativo vinculado só a profissional inativo; S4 inativo com profissional ativo. Quando a leitura pública de A é chamada, então devolve só S1, só com os campos `id`, `nome`, `precoCentavos`, `duracaoMin`. Quando P (de S3) é reativado, então S3 passa a ser devolvido. A leitura pública de B não traz nada de A. O teste existente `tests/integration/tenant/publico.test.ts` continua passando.
- **CA-9** (RN-12, G-4): Dado o gestor de A e o id de um serviço de B, quando chama editar, desativar e reativar, então cada chamada devolve `{ ok: false, erro: 'nao_encontrado', status: 404 }` e a linha de B e os vínculos de B ficam inalterados (inclusive `atualizado_em`). O mesmo para UUID inexistente e `'abc'`. A página de edição com o id de B responde 404.
- **CA-10** (RN-12, G-4): Dado que A e B têm serviços, quando o gestor de A lista, então só vê os de A, e a quantidade de profissionais exibida conta só profissionais ativos de A.
- **CA-11** (RN-5): Dado o usuário de papel `profissional` ativo, quando chama criar, editar, desativar ou reativar, então cada uma devolve `acesso_negado` (403) sem alterar o banco, e `GET /painel/servicos` (e as páginas de criar/editar) renderiza "Acesso negado". Sem cookie: ações devolvem `nao_autenticado` (401) e a página redireciona para `/entrar?proximo=%2Fpainel%2Fservicos`. Unitário: todo `*.acao.ts` novo passa em `verificarAcoes` com `capacidade: 'configurar'` e `papeis: ['gestor']`.
- **CA-12** (RN-13): Dado um serviço existente, quando a edição envia nome válido e um profissional inválido (CA-4) ou preço inválido com vínculos válidos, então nem o serviço nem os vínculos mudam. Dado criar com campos válidos e dois profissionais ativos, então o serviço e os dois vínculos são criados juntos.
- **CA-13** (RN-6): Dado o serviço "Corte" no salão A, quando o gestor cria outro "Corte", então a criação é aceita, sem aviso, e a lista mostra os dois.
- **CA-14** (RN-11; teste de componente jsdom e passo manual): a lista mostra nome, preço, duração, situação ("Ativo"/"Inativo") e profissionais ativos vinculados; serviço ativo sem profissional ativo traz o aviso "Não aparece na página pública: nenhum profissional ativo executa este serviço."; há estado vazio com chamada para cadastrar. O formulário tem rótulos associados, erros ligados por `aria-describedby`, os profissionais num `fieldset` com `legend` e caixas de seleção rotuladas pelo nome; o campo de preço indica o formato ("Ex.: 80,00"). Passo manual: criar → editar vínculos → desativar → reativar só com o teclado em 375 px, e repetir com JavaScript desligado no navegador (os quatro formulários funcionam e mostram os erros de validação vindos do servidor).
- **CA-15** (concorrência): Dado um serviço sem vínculos, quando duas edições salvam em paralelo conjuntos diferentes de profissionais ativos, então ambas terminam sem erro 5xx (inclusive sem violação de PK vazada) e o conjunto final de vínculos é exatamente um dos dois enviados.

## 6. Casos limite

- **Fuso e virada de dia:** não se aplica diretamente; serviço não tem horário. `criado_em`/`atualizado_em` em UTC.
- **Serviço sem profissional, ou só com profissionais inativos:** não aparece na leitura pública (CA-8) e a lista do painel avisa (CA-14).
- **Profissional desativado (D-013):** vínculos preservados (RN-9); some da contagem e da leitura pública; aparece no formulário como inativo, sem caixa marcável (D-5).
- **Serviço inativo:** pode ser editado e ter vínculos alterados (permite reconfigurar antes de reativar).
- **Preço zero:** aceito (R$ 0,00), exibido como "R$ 0,00".
- **Preço com float:** nenhum caminho de servidor usa ponto flutuante (CA-5 com `"0,10"`, `"1.234,56"` e o maior valor `"99.999,99"` → 9999999).
- **Duração não alinhada à grade:** múltiplo de 5 basta (decidido na issue). Uma duração de 50 min com grade de 15 min é válida; os inícios seguem a grade e o fim, a duração (E3.1 RN-3/RN-4).
- **Alteração de duração com reservas futuras:** não muda reservas nem ocupação (RN-3); novas disponibilidades usam a duração nova.
- **Concorrência:** CA-15. Edição concorrente com uma nova reserva: E3.2 lê o serviço e grava o snapshot na própria transação; qualquer das duas ordens é aceitável (preço novo ou antigo), desde que o item reflita o valor lido. Desativação concorrente com nova reserva: a E3.2 deve conferir `servico.ativo` dentro da transação (§7); não há teste nesta demanda.
- **Isolamento entre salões:** CA-4, CA-9, CA-10, CA-8 (leitura pública).
- **Salão suspenso:** capacidade `configurar` declarada; comportamento verificado na E6.4.
- **Cliente anonimizada:** não se aplica (nenhum dado de cliente nesta demanda).
- **Telefone:** não se aplica.
- **Entradas inválidas:** tipos errados, campos extras, lista de profissionais com ids repetidos (deduplicada, sem erro) ou com mais itens que profissionais do salão: erro de validação ou normalização, nunca 5xx. Id do serviço vem da rota/campo oculto e é revalidado no servidor.
- **Permissões:** profissional e super admin negados (CA-11); o gestor que também atende vê e vincula o próprio perfil como qualquer profissional.

## 7. Dependências

- **Já entregues:** E0.4 (esquema e CHECKs), E0.5 (`defineAcao`, repositórios escopados, harness), E0.8 (componentes, `PanelLayout`, `formatarMoeda`), E1.2/D-010 (sessão, matriz `servico.gerir`, `exigirAcessoAoPainel`), E2.2/D-013 (profissionais ativos/inativos, padrão de ações e casca).
- **Integrações:** nenhuma (sem e-mail, WhatsApp, Mercado Pago ou Turnstile).
- **Obrigações criadas para as próximas** (registrar nas issues):
  - E3.1: usar a leitura pública desta demanda e exigir que todos os serviços escolhidos estejam ativos e que o profissional esteja ativo e vinculado a todos.
  - E3.2/E3.4/E3.5: conferir `servico.ativo` e o vínculo serviço × profissional **dentro da transação** que cria, encaixa ou remarca a reserva, e copiar `preco_centavos`/`duracao_min` lidos nessa transação para `reserva_item`.
  - E4.1: exibir preço só por `formatarMoeda`.
- **Bloqueia:** #27 (E3.1).

## 8. Impactos prováveis

- **Dados:** nenhuma migração obrigatória. Opcional, a critério do arquiteto/DBA: CHECKs `servico.duracao_min % 5 = 0`, `duracao_min <= 720` e `preco_centavos <= 9999999` por defesa em profundidade (dados atuais de fábrica são compatíveis: 60, 30, 120). Não aplicar a `reserva_item`. A leitura pública com `EXISTS` em `servico_profissional` usa a PK `(salao_id, servico_id, profissional_id)`; não se espera índice novo.
- **Repositórios:** ampliar `src/server/repos/servico.ts` (criar, atualizar, ativar/desativar, listar com contagem de profissionais ativos, vínculos: ler e substituir conjunto) e alterar `listarServicosPublicos` em `src/server/repos/publico.ts` (RN-7). Validação de que os profissionais pertencem ao salão e estão ativos dentro da transação.
- **Módulo novo:** `src/server/servicos/` (`servicos.acao.ts`, `servico.ts`, `validacao.ts`, `tipos.ts`), seguindo a D-013.
- **Formatação:** parser de preço pt-BR → centavos (servidor, junto à validação) e formatador de duração em `src/lib/format.ts` (D-7); avaliar se o teste que restringe formatação a `format.ts` exige ajustes.
- **Rotas:** acrescentar `novoServico` e `servico(id)` a `ROTAS` (D-4). Sem novo primeiro segmento, sem efeito em `SEGMENTOS_RESERVADOS`.
- **Infra/CI:** nenhum (sem env, serviço, job ou script). DevOps pode ser dispensado.
- **Cobertura:** novos arquivos em `src/server/servicos/` e `src/app/painel/servicos/` entram no gate de 90%.

## 9. Dúvidas

### Bloqueantes
Nenhuma.

### Não bloqueantes (suposições adotadas)
- **D-1 — Formato do preço aceito:** texto aparado; prefixo opcional `R$` com ou sem espaço; parte inteira só com dígitos (`1234`) ou com milhar por ponto em grupos de 3 (`1.234`); vírgula decimal opcional com 1 ou 2 dígitos. Recusados: sinal negativo, ponto como separador decimal (`80.00`), mais de 2 casas, letras, vazio. Conversão por texto e inteiros. O campo é `inputmode="decimal"`, não `type="number"` (que usa ponto e float no navegador).
- **D-2 — Teto do preço:** R$ 99.999,99. Evita estouro de `int4` em somas de vários serviços (E3.1 RN-2) e erro de digitação; não há limite no PLAN.
- **D-3 — Teto da duração:** 720 min (12 h). Um serviço maior não caberia em uma jornada típica; evita erro de digitação. Mínimo 5.
- **D-4 — Rotas:** `/painel/servicos` (lista), `/painel/servicos/novo` e `/painel/servicos/[id]` (editar dados e vínculos, desativar/reativar), como em profissionais (D-013 D-3).
- **D-5 — Vínculos no formulário:** o formulário lista os profissionais **ativos** do salão como caixas de seleção (marcadas as vinculadas) e, à parte, os inativos vinculados como texto informativo ("Inativo, vínculo mantido"), sem controle. O conjunto enviado substitui só os vínculos com ativos (RN-10).
- **D-6 — Vínculos só pela tela do serviço:** a tela do profissional não ganha edição de serviços nesta demanda (a issue lista o vínculo dentro de `src/app/painel/servicos/**`).
- **D-7 — Exibição da duração:** "45 min", "1 h", "1 h 30 min", em `src/lib/format.ts` (único lugar de formatação de exibição).
- **D-8 — Nome do serviço em reservas antigas:** `reserva_item` não guarda o nome; telas de reservas mostram o nome atual do serviço. O PLAN exige snapshot só de preço e duração (PLAN 37; CLAUDE.md). Sem mudança de esquema.
- **D-9 — Desativar sem confirmação:** a ação é reversível e não tem efeito sobre reservas, então é um botão de formulário simples (funciona sem JS), com mensagem de status acessível após a ação. Diferente da D-013, que confirma porque revoga acesso.
- **D-10 — Ordenação da lista:** ativos primeiro, depois inativos, cada grupo por nome e id (como D-013 D-9).
- **D-11 — Sem auditoria:** ações do gestor não geram `auditoria` (obrigatória só para super admin).
- **D-12 — Sem E2E Playwright obrigatório:** o PLAN exige Playwright para o fluxo público; aqui bastam testes de componente e o passo manual (incluindo sem JS) do CA-14. Um E2E fica a critério do arquiteto.
- **D-13 — Vínculo na criação:** o formulário de criação já oferece os profissionais ativos, para o serviço poder nascer ofertável num único passo (CA-12).
