# D-038 (E6.4) Somente leitura e página indisponível — spec

## 1. Problema (evidência)
- `src/server/tenant/politica.ts`: `politicaDeOperacao = permitirTudo`; `PoliticaOperacao(ctx, capacidade)` não recebe `agora` e é chamada por `defineAcao` (`define-acao.ts`, após papel, antes do handler). Hoje salão suspenso/pendente configura, agenda e remarca.
- `criarReserva` (`reservas/criar-reserva.ts:42,119`): `politicaPadraoDeReserva` passa pela política só com `ctx.tipo==='tenant'`; contexto `sistema` (público) sempre `permitido`. A recusa pública hoje é só pela página e por `agendamentoDisponivel` (`reserva-publica/agendamento.ts`), função pura paralela com sua própria lista de estados.
- D-037 já entrega `estadoEfetivoDoSalao(ctx, agora)` (`server/assinatura/estado-operacional.ts`), `TABELA_CAPACIDADES`/`CAPACIDADES_OPERACIONAIS` (`src/domain/assinatura`), `carenciaAte`/`acessoAte`. Sem UI.
- Registro de ações (`*.acao.ts`, 12 arquivos): capacidades em uso = `configurar` (profissionais, servicos, jornadas, bloqueios [gestor+profissional], configuracoes, perfil, funcionamento, fotos, editarCliente), `agendar` (criar reserva de equipe, remarcar), `cancelar` (cancelar, marcar status), `lgpd` (anonimizar). `leitura` e `assinatura` não têm ação ainda. `denuncias.acao.ts` usa `defineAcaoAdmin` (fora da política de salão).
- Fora de `defineAcao`: route handler `POST /api/painel/fotos` (usa a ação de fotos `configurar` via `envio-http.ts`, herda a política), server actions públicas (`(publico)/[slug]/acoes.ts` reserva, `avaliar/[token]/acoes.ts`, `_denuncia`), auth, `painel/acoes.ts` (Sair).
- Painel: não há `layout.tsx` em `src/app/painel`; 31 páginas renderizam `<PanelLayout>` (`components/layout/PanelLayout.tsx`, sem faixa). Página pública `(publico)/[slug]/page.tsx` já lê perfil/fotos/avaliações sempre e só omite o formulário quando `salao.decisao.disponivel` é falso (D-026); CA-R1 é em grande parte regressão a travar por teste.
- Capacidade `cancelar` já cobre cancelar e marcar status (`reservas-status.acao.ts:16`); remarcar usa `agendar`.

## 2. Objetivo
Salão `pendente`, `suspensa`, `encerrada` (inclui `cancelada` vencida) ou suspenso manualmente fica somente leitura: servidor recusa o que a tabela proíbe; cancelamento continua e notifica; página pública mostra perfil, fotos e avaliações com "agendamento indisponível"; painel mostra faixa de aviso por estado.

## 3. Escopo
Entra: política real em `defineAcao` e no `criarReserva` (inclusive contexto público/sistema); decisão pública derivada da mesma tabela; faixa no painel; testes (tabela, uma verificação por capacidade × estado, varredura do registro, cancelamento com mensagem).
Fora: E6.5 (tela de assinatura, checkout, reativar), E8.2 (suspender/reativar manualmente pelo super admin; aqui só se LÊ `suspenso_manual_em`), E1.4 (convite de profissional não existe), mudança de transições da D-037, novas telas de pagamento, bloqueio de login/leitura, migração. "Fora da primeira versão" do PLAN não é afetado.

## 4. Regras de negócio
- RN-1 (issue): matriz única, servidor, em `src/server/assinatura/politica-operacao.ts` que consome `estadoEfetivoDoSalao` + `TABELA_CAPACIDADES` (D-037); nenhuma tabela duplicada. Substitui `permitirTudo`. `PoliticaOperacao` passa a receber o instante (`agora` da execução, o mesmo de `resolverTenant`).

| Estado efetivo | leitura | configurar | agendar | cancelar | assinatura | lgpd |
|---|---|---|---|---|---|---|
| pendente | sim | sim | não | sim | sim | sim |
| em_teste, ativa, em_carencia, cancelada vigente, sem_assinatura (legado/seed) | sim | sim | sim | sim | sim | sim |
| suspensa, encerrada, manual | sim | não | não | sim | sim | sim |
- RN-2: `cancelar` = cancelar reserva futura (grava `cancelamento` no outbox, E7.1, enfileira após commit, notifica a cliente) e marcar status de atendimento passado (concluído/não compareceu). `remarcar` é `agendar` (recusado).
- RN-3: falha fechada. Estado ilegível/erro de leitura, capacidade desconhecida ou ação sem capacidade válida: recusa (403 `AcessoNegado`, nunca 500 vazando). Teste que percorre `import.meta.glob('/src/**/*.acao.ts')` e, para cada ação de salão, executa com salão `suspenso` e `pendente` e confirma que o resultado segue a tabela para a capacidade declarada (nenhuma ação escapa; uma ação nova sem capacidade reprova o registro, já existente em `registro.test.ts`). `defineAcaoAdmin` fica fora (RN-9).
- RN-4: `criarReserva` aplica `agendar` também ao contexto público/sistema (o público devolve `salao_indisponivel`; equipe, `AcessoNegado`), usando o mesmo predicado da tabela; a leitura do estado e a decisão ocorrem antes do início das travas/inserts. `agendamentoDisponivel` mantém os motivos `suspenso_manual`/`assinatura`/`sem_servico`, mas o critério "assinatura/manual" passa a derivar de `capacidades.agendar` (uma única fonte); o motivo `sem_servico` continua só na página/público.
- RN-5: rota de upload de fotos e qualquer futuro route handler de mutação herdam a política por usar `defineAcao`; não pode haver mutação de equipe fora de `defineAcao`. Teste estático: nenhum `route.ts` de `/api/painel/**` ou `'use server'` em `src/app/painel/**` toca repositório de escrita sem passar por ação (as cascas só convertem).
- RN-6: leitura sempre permitida (agenda, clientes, configurações, jornada, bloqueios, perfil, fotos): páginas do painel não consultam a política de escrita; botões/formulários de escrita ficam desabilitados ou ocultos no salão não operável como conveniência, nunca como controle (o servidor recusa). Mensagem de recusa pt-BR clara e distinta (sem revelar estados internos a não-gestor).
- RN-7: troca de senha, login/logout, recuperação e perfil próprio fora da política (D-038 RN-3 da issue).
- RN-8: envio de avaliação por link (D-032) e denúncia pública continuam permitidos com salão suspenso (não são ações de equipe; não passam por `defineAcao`).
- RN-9: super admin (`defineAcaoAdmin`) não sofre a política de salão.
- RN-10: página pública (D-019 CA-R1): salão não operável mostra perfil, fotos, avaliações, serviços/equipe como informação, a mensagem "agendamento indisponível" e NENHUM formulário de reserva; HTTP 200 (não 404); ignora suspensão para perfil/fotos/avaliações (já é o contrato de `lerPerfilPublico`/`lerFotosPublicas`/avaliações). Em `em_carencia` e `cancelada` vigente a reserva segue disponível.
- RN-11: faixa no painel, para gestor e profissional (texto de ação só ao gestor), no `PanelLayout` (prop opcional de aviso preenchida por um componente servidor compartilhado que chama `estadoEfetivoDoSalao`, em vez de editar 31 páginas à mão se o arquiteto achar viável, p.ex. via `exigirAcessoAoPainel`). Textos (pt-BR, `role="status"`, contraste AA, sem cor como único sinal):
  - pendente: "Assinatura pendente. Você já pode configurar o salão, mas o agendamento fica indisponível até a assinatura ser ativada."
  - em_carencia: "Pagamento não confirmado. Seu acesso continua normal até {data limite no fuso do salão}; regularize para evitar a suspensão." (data de `carenciaAte` via `src/lib/format.ts`)
  - cancelada vigente: "Assinatura cancelada. Você pode usar o painel até {acessoAte}." (extra, sem prazo vira só aviso)
  - suspensa: "Assinatura suspensa. O painel está somente leitura e o agendamento está indisponível. Você ainda pode cancelar reservas futuras."
  - encerrada (inclui cancelada vencida): "Assinatura encerrada. Painel somente leitura; o agendamento está indisponível."
  - suspensão manual: "Salão suspenso pela administração. Painel somente leitura; você ainda pode cancelar reservas futuras. Entre em contato com o suporte."
  Sem faixa em `em_teste`, `ativa`, `sem_assinatura`. Link "Assinatura" só se a rota existir (E6.5 não existe; sem link).
- RN-12: o estado é lido por requisição, sem cache entre requisições (mudança vale na próxima chamada). Um único `estadoEfetivoDoSalao` por execução de ação.

## 5. Critérios de aceitação
- CA-1: Dado salão suspenso (assinatura `suspensa` e também manual), Quando a cliente abre `/{slug}`, Então vê "agendamento indisponível" e a server action/`criarReserva` de contexto público devolve `salao_indisponivel` sem criar reserva (contagem de `reserva` inalterada).
- CA-2: Dado salão suspenso, Quando a equipe executa criar reserva (inclui encaixe), remarcar, criar/editar/desativar serviço, profissional, salvar jornada, criar/editar/remover bloqueio (gestor e profissional) e salvar regras/slug, Então cada ação devolve `{ok:false, erro:'acesso_negado', status:403}` e nada muda no banco. Uma verificação por ação.
- CA-3: Dado salão suspenso e reserva `confirmado` futura, Quando a equipe cancela, Então a reserva fica `cancelado` e há `mensagem` tipo `cancelamento` com a chave `reserva:cancelamento:revisao` (e o job enfileirado após commit); marcar `concluido`/`nao_compareceu` de reserva passada também é aceito; anonimizar cliente (`lgpd`) é aceito.
- CA-4: Dado salão suspenso, Quando o gestor abre agenda, clientes, serviços, profissionais, jornada, bloqueios e configurações/perfil/funcionamento/fotos, Então os dados aparecem (status 200) com a faixa de suspensa.
- CA-5: Dado salão em carência com `carenciaAte` X, Quando o gestor abre o painel, Então a faixa mostra X formatada no fuso do salão (teste em `TZ=UTC` e `America/Sao_Paulo`, data de virada de dia) e todas as ações seguem aceitas.
- CA-6: Dado salão `pendente`, Quando a equipe cria reserva, Então é recusada; Quando o gestor cria um serviço, Então é aceito.
- CA-R1: Dado salão suspenso, Quando a página pública abre, Então perfil, fotos e avaliações aparecem, não há formulário de reserva e a resposta é 200.
- CA-R2: Dado salão suspenso, Quando o gestor altera perfil, funcionamento ou fotos (incluindo `POST /api/painel/fotos`, que responde 303 com código de recusa e não grava objeto nem linha), Então é bloqueado (`configurar`).
- CA-7: Teste de tabela unitário: 3 linhas de estado × 6 capacidades (e `em_carencia`, `cancelada` vigente/vencida, `sem_assinatura`, manual sobre `ativa`) idêntico a `TABELA_CAPACIDADES`; capacidade inválida e falha de leitura → negado.
- CA-8: Varredura do registro (RN-3): toda exportação de `*.acao.ts` de salão, em salão suspenso, é negada se e somente se sua capacidade é `configurar`/`agendar`; nova ação com capacidade `agendar|configurar` não vira exceção.
- CA-9: Dado salão suspenso, envio de avaliação por link e denúncia pública continuam funcionando; login, troca/recuperação de senha e Sair funcionam.
- CA-10: Dado salão em `em_teste`/`ativa`/sem assinatura, nenhuma ação existente muda de comportamento (regressão: suítes D-013..D-030 verdes).
- CA-11: Cada texto de faixa da RN-11 aparece no estado certo e some nos demais; axe sem violações em 375x812 (E2E na vitrine/`/dev` sem banco, se houver; senão integração de renderização).

## 6. Casos limite
- Virada de estado entre leitura da política e o commit (TOCTOU): aceito; uma reserva já em andamento pode concluir. Documentar.
- Estado muda por webhook/job durante a requisição: vale a leitura da execução (um `agora`).
- Fuso: `carenciaAte`/`acessoAte` exibidos no fuso do salão; comparação de limite inclusiva/exclusiva conforme D-037 (`acessoAte <= agora` = encerrada).
- Cancelamento com cliente anonimizada ou sem consentimento: segue D-024 (`cancelada_anonimizacao`/`nao_enviada`); só o cancelamento não é bloqueado.
- Profissional (não gestor): bloqueio em salão suspenso é recusado (também `configurar`); vê a faixa sem texto administrativo (entrar em contato com o gestor).
- Salão sem linha de assinatura: tudo permitido (D-037/D-026). Isolamento: política consulta só o salão do contexto; salão A suspenso não afeta B (teste com dois salões).
- Perfil de profissional inativo/sessão inválida: 401 antes da política (ordem inalterada).
- Reserva pública em andamento (formulário aberto) quando o salão suspende: submissão recusada com `salao_indisponivel`.
- Encaixe em salão suspenso: recusado (capacidade `agendar`).
- `cancelada` vencida em carência de relógio: exige `agora` injetado nos testes; nunca relógio implícito no domínio.

## 7. Dependências
D-037 (E6.3 estado efetivo), D-026 (página pública e predicado), D-029/D-030 (reservas de equipe, status), D-024 (outbox), D-021 (fotos), D-032 (avaliação), D-005 (`defineAcao`). Sem integração externa nova. Desbloqueia E4.4 (#44: cenário "salão suspenso" do E2E).

## 8. Impactos prováveis
- Dados: nenhuma migração (usa `suspenso_manual_em`, `assinatura`). DBA dispensável, salvo se o arquiteto quiser um índice para a leitura do estado (a consulta já é por salão + `ORDER BY criado_em DESC LIMIT 1`).
- Infra/CI/env: nenhum. README: documentar a política (tabela) e o comportamento somente leitura; CLAUDE.md: registrar D-038. DevOps dispensável.
- Código: assinatura de `PoliticaOperacao` (testes `define-acao.test.ts`, `politica.test.ts` a adaptar), `criar-reserva.ts`, `agendamento.ts`/`estado.ts`, `PanelLayout`, página pública.
- Riscos: R-1 custo extra de 1 consulta por ação (aceitável; estado em um comando). R-2 31 páginas de painel: faixa precisa ser centralizada para não esquecer páginas (teste que percorre as páginas ou o `PanelLayout`). R-3 dois predicados divergirem (mitigado por RN-4). R-4 regressão em testes que usavam `permitirTudo` ou fábricas sem assinatura (fábricas já criam `em_teste` / sem linha = permitido).

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposição adotada):
- `cancelada` dentro do prazo mostra aviso informativo com `acessoAte` (a issue não pede; mantido por clareza). Suposição: sim.
- Operações de gestor em `leitura`/`assinatura` não têm ação ainda; a política as trata como permitidas (E6.5 usará `assinatura`).
- Suspensão manual: mesmo texto de suspensa com origem administrativa; reativação e motivo ficam na E8.2.
- Ocultar vs. desabilitar controles de escrita no painel suspenso: livre ao arquiteto; o controle real é o servidor.
