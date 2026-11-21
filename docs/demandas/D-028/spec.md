# D-028 (E3.3, issue #20): Agenda da equipe

## 1. Problema
Inexistente: `/painel/agenda` não existe (`src/app/painel/` tem só bloqueios, clientes, configuracoes, profissionais, servicos). Já existem as leituras reaproveitáveis: `listarPorPeriodo`/`buscarPorId` em `src/server/repos/reserva.ts` (ReservaDTO com itens snapshot, sem cliente/nome), `lerBloqueios` (`src/server/bloqueios/leitura.ts`, inclui `motivo`), `lerSemana` (`jornadas/leitura.ts`), `lerFuncionamento` (`salao/funcionamento-leitura.ts`), `lerContatoDaCliente` (`clientes/leitura.ts`, operação `cliente.contato`), operações `agenda.ver` (salao/proprio/negado) em `src/server/auth/permissoes.ts:39`. `grep suspens` em `src/server/tenant` e `src/server/auth`: nenhum bloqueio de salão suspenso implementado (só mensagem em teste); logo a leitura já não é barrada hoje.

## 2. Objetivo
Gestor e profissional veem a agenda por dia e por semana (reservas, bloqueios, jornada, funcionamento do salão como faixa de fundo) e o detalhe da reserva, somente leitura.

## 3. Escopo
Entra: `/painel/agenda` (dia e semana, navegação por GET: `?data=YYYY-MM-DD&visao=dia|semana&profissional=<id>`), `/painel/agenda/reservas/[id]` (detalhe), `src/server/agenda/consultar.ts`, link na navegação/`/painel`, `/dev/agenda` (vitrine, E2E sem banco).
Fora: remarcar/cancelar/mudar status (E3.5), reserva manual/encaixe (E3.4), anonimização (E5.2), envio/situação de mensagens (E7.3), convite de profissional (E1.4), arrastar/soltar, qualquer `*.acao.ts`. Nada contradiz "Fora da primeira versão" do PLAN.

## 4. Regras de negócio
- RN-1: gestor vê todos os profissionais (ativos e inativos); profissional vê só a própria agenda. Operação `agenda.ver` (`exigirAcessoAoPainel('/painel/agenda', ['gestor','profissional'], 'agenda.ver')`). Profissional sem perfil ativo = 401 (já em `resolverTenant`).
- RN-2: horários no fuso do salão via `src/lib/format.ts` e `src/server/tempo/fuso.ts` (nunca `Date` local). Dia = [00:00, 24:00) local convertido por `intervaloDeDiasInteiros`; semana = 7 dias a partir do domingo (padrão `dia_semana` 0 = domingo, igual à jornada) contendo a data; dia de 23/25 h (DST) renderiza sem erro.
- RN-3: cliente anonimizada aparece como `TEXTO_CLIENTE_REMOVIDA` (importar, nunca copiar), com itens e preços snapshot.
- RN-4: leitura funciona com salão suspenso (não adicionar checagem de suspensão; futuro E6.x mantém `agenda.ver` liberada).
- RN-5: reservas de todos os status aparecem (confirmado, concluido, nao_compareceu, cancelada) com rótulo textual do status; canceladas visualmente distintas (sem depender só de cor) e não contam como ocupação.
- RN-6: consulta de reservas por sobreposição ao período (`inicio < ate AND fim > de`), não só por `inicio` (reserva que cruza a meia-noite aparece nos dois dias); nova leitura no repo, ou ajuste de `listarPorPeriodo` sem quebrar chamadores existentes (decisão do arquiteto).
- RN-7: profissional inativo: gestor vê o nome e a reserva passada (CA-6) e pode filtrar por ele; marcado "inativo".
- RN-8: bloqueios próprios e do salão inteiro (`profissional_id` nulo) aparecem na coluna de cada profissional; `motivo` visível a gestor e ao profissional (é só da equipe).
- RN-9: faixa de fundo (D-019): horários fora do funcionamento do salão e fora da jornada do profissional aparecem distintos (padrão/rótulo além da cor, ex.: hachura + texto "Fechado"/"Fora da jornada"). `funcionamento.definido=false` não pinta nada; `definido` com dia vazio = dia fechado. Reserva/encaixe fora do funcionamento continua visível (encaixe não é limitado).
- RN-10: detalhe da reserva: profissional (nome), cliente (nome; telefone via `lerContatoDaCliente` conforme `cliente.contato`), itens com preço e duração snapshot, total, início/fim no fuso do salão, status, origem, encaixe. Sem mensagens/parâmetros do WhatsApp.
- RN-11: reserva de outro profissional ou de outro salão ou id malformado: `NaoEncontrado` (404) igual para todos os casos, nunca 403 (CA-1).
- RN-12: o filtro `profissional` só vale para gestor; para profissional é ignorado (sempre o próprio). `profissional` inválido/de outro salão = 404; `data`/`visao` inválidos caem no padrão (hoje no fuso do salão, dia) sem 500. Sem filtro, o gestor vê uma coluna por profissional com reserva, bloqueio ou jornada no período (inativos sem nada no período omitidos).
- RN-13: somente leitura: nenhum POST/ação; navegação por links GET.

## 5. Critérios de aceitação
- CA-1: Dado profissional A autenticado, quando abre a agenda ou `/painel/agenda/reservas/<id>` de reserva do profissional B, então não vê a reserva (agenda) e o detalhe responde 404.
- CA-2: Dado o gestor, quando filtra por "Ana", então só reservas e bloqueios de Ana (e os do salão inteiro) aparecem; sem filtro vê todos.
- CA-3: Dado reserva às 12:00Z em `America/Sao_Paulo`, quando exibida (agenda e detalhe), então 09:00; e o resultado é igual com `TZ=UTC` e `TZ=America/Sao_Paulo` no processo.
- CA-4: Dado viewport 375×812, quando a agenda (dia e semana) e o detalhe carregam, então `scrollWidth <= clientWidth` da página, tudo navegável por Tab com foco visível, zero violações axe 4.14.0.
- CA-5: Dado reserva de cliente anonimizada (fábrica), quando agenda e detalhe abrem, então "cliente removida", itens e preços snapshot, sem nome/telefone.
- CA-6: Dado reserva passada de profissional inativo, quando o gestor abre o dia, então ela aparece com o nome do profissional.
- CA-7 (CA-R1): Dado funcionamento cadastrado (ex.: 09-18), quando a agenda do dia abre, então 00-09 e 18-24 têm marcação distinta com texto acessível "Fora do funcionamento"; com `definido=false` não há marcação; dia fechado inteiro marcado.
- CA-8: Dado profissional com jornada 09-12/14-18, quando o dia abre, então 12-14 e fora de 09-18 marcados "Fora da jornada" (distinto do fechado do salão).
- CA-9: Dado bloqueio do profissional e bloqueio do salão no dia, então ambos aparecem na coluna do profissional, com o motivo; bloqueio fora do período não aparece; encostar na fronteira (fim = 00:00 do dia) não aparece.
- CA-10: Dado salão suspenso (fábrica), então a agenda e o detalhe abrem normalmente.
- CA-11: Dado reservas do salão X e Y, então a agenda e o detalhe de X nunca mostram dados de Y (404 no detalhe cruzado).
- CA-12: Dado reserva cancelada, nao_compareceu e concluido, então cada uma mostra rótulo textual do status.
- CA-13: Dado reserva 23:00–01:00 local, então aparece no dia anterior e no seguinte; dia DST (23 ou 25 h, ex.: salão com fuso de DST em data de transição) renderiza sem erro e com horários corretos.
- CA-14: Sem JavaScript, navegação de dia anterior/próximo/hoje, dia↔semana, filtro (GET) e abrir/voltar do detalhe funcionam.
- CA-15: Dado `data`/`visao`/`profissional` malformados, então sem 500 (padrão ou 404 conforme RN-12).
- CA-16: Constante de consultas: número de instruções SQL independente do número de reservas/profissionais (sem N+1 para cliente, profissional e itens).
- CA-17: Cliente com nome nunca exibe telefone na grade (só no detalhe, conforme `cliente.contato`); página pública nunca importa a leitura da agenda.

## 6. Casos limite
Virada de dia e DST (CA-13); semana cruzando mês/ano; salão com fuso diferente do processo; profissional sem jornada (tudo "fora da jornada"); gestor também profissional (vê todas; "minha agenda" via filtro); profissional desativado depois de logado (sessões revogadas: 401); reservas sobrepostas de encaixe no mesmo profissional (lado a lado, sem esconder); muitas reservas num dia (limite de renderização, ex.: 200 por período com aviso, risco R-1); data muito distante (aceitar qualquer data válida, limitar a ±5 anos para não gerar 500); nome longo/quebra de linha em 375 px; XSS em motivo/nome (escape do React). Reserva `concluido` de dia futuro: exibida como está.

## 7. Dependências
E2.3 (jornada), E2.4 (bloqueios), E2.6 (funcionamento), D-025 (reservas), D-022 (contato/cliente), permissões D-010, formatadores D-009. Sem integrações externas. Ordem do `docs/trinks-alinhamento.md`: posição 10.

## 8. Impactos prováveis
Dados: nenhuma migração prevista; possível índice para sobreposição (`reserva (salao_id, inicio)` existe; RN-6 pode usar `fim` ou `ocupado_ate`; DBA só se o plano for ruim). Novas leituras em `repos/` (nome do profissional/cliente em JOIN, uma instrução). Sem impacto em infra/CI; E2E novo (`e2e/agenda*.spec.ts`, `/dev/agenda`). Lint: vitrine e página não importam Prisma.

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposição): (a) horário de visualização 00:00–24:00 com rolagem vertical (sem recorte à faixa de funcionamento); (b) semana começa no domingo; (c) canceladas exibidas por padrão (RN-5); (d) semana mostra lista por dia com colunas por profissional em desktop e lista empilhada no celular (sem grade horizontal); (e) filtro de profissional na visão semanal obrigatório quando houver > 1 profissional? Suposição: não, mas a semana sem filtro agrupa por dia e profissional.
Riscos: R-1 volume de reservas por semana sem filtro; R-2 suspensão ainda não implementada (E6.x) pode barrar leitura por engano: manter `agenda.ver` fora do bloqueio; R-3 RN-6 mudando `listarPorPeriodo` pode afetar chamadores (D-025).
