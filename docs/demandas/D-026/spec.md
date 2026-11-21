# D-026 (E4.1) — Página pública do salão e fluxo de reserva

## 1. Problema
Inexistente: `src/app/` não tem rota `/<slug>` (só `(publico)/{cadastro,confirmar-email,entrar,privacidade,recuperar-senha,redefinir-senha,termos}`). Já existem os blocos: `resolverSalaoPorSlug` (`src/server/repos/publico.ts:29`, devolve `historico`/`slugAtual`; o comentário prevê o redirecionamento da E4.1), `listarServicosPublicos`, `lerPerfilPublico`, `lerFuncionamentoPublico`/`lerFuncionamento`, `lerFotosPublicas`, `listarProfissionaisElegiveis`/`consultarDisponibilidade` (D-018), `criarReserva` com `antesDaReserva` (`criar-reserva.ts:194`), `CaixasConsentimento` (D-023), `upsertCliente`, `normalizarTelefoneBr`. `ROTAS.salaoPublico` existe em `navegacao.ts:19` e é excluída de `SEGMENTOS_RESERVADOS` (linha 143).
Estado de suspensão: só existe `salao.suspenso_manual_em` (`schema.prisma:144`) e `assinatura.estado` (`pendente`, `suspensa`…). Não há política efetiva (E6.4).

## 2. Objetivo
A cliente (sem conta) abre `/<slug>` no celular, vê o perfil completo (DT-4) e reserva um ou mais serviços com um profissional em um horário, informando nome e telefone, e recebe a confirmação. Salão sem condição de receber reservas mostra o perfil e "agendamento indisponível".

## 3. Escopo
Entra: página `/<slug>` (perfil: descrição, endereço, contato, funcionamento, meios de pagamento, comodidades, fotos, serviços, equipe); fluxo serviços → profissional → horário → dados → confirmação; consentimento (D-023); Server Action pública que chama `criarReserva`; 308 para slug histórico; 404 para slug inexistente; estado "indisponível"; gancho `antesDaReserva`/`politica` para E4.2/E6.4.
Fora: avaliações (E4.5; não renderizar seção, ou renderizar vazia sem schema), Turnstile e rate limit (E4.2, só ponto de extensão), política de assinatura (E6.4), cancelamento/remarcação pela cliente, pagamento da cliente, contas de cliente (todos "Fora da primeira versão" do PLAN). Nada de migração prevista.

## 4. Regras de negócio
- RN-1 Slug resolvido só por `resolverSalaoPorSlug` (atual ou histórico). Histórico → redirecionamento **308** para `/<slugAtual>` (preserva os parâmetros do fluxo, se houver). Inexistente, reservado ou malformado → 404 (D-017, `SEGMENTOS_RESERVADOS`).
- RN-2 A rota dinâmica nunca captura segmentos reservados (rotas estáticas têm precedência no Next; teste estático garante que cada `SEGMENTOS_RESERVADOS` tem rota/handler próprio ou 404 sem consultar o banco).
- RN-3 O perfil usa só `lerPerfilPublico`, `lerFuncionamento`/`lerFuncionamentoPublico` (`definido:false` → não mostrar o horário; dia vazio → "Fechado") e `lerFotosPublicas`. Campos vazios omitem a seção; nenhum dado interno (e-mail do gestor, ids internos além dos necessários) é exposto. Perfil e fotos aparecem mesmo com agendamento indisponível.
- RN-4 Serviços: só `listarServicosPublicos` (preço em BRL e duração via `src/lib/format.ts`). Equipe: só profissionais ativos (`listarProfissionaisPublicos`).
- RN-5 Estado efetivo "agendamento indisponível" (função pura única `agendamentoDisponivel`, gancho da E6.4): indisponível se `salao.suspenso_manual_em` não nulo, ou assinatura vigente em `pendente`/`suspensa`/`encerrada`/`cancelada` sem acesso (suposição, ver Dúvidas), ou nenhum serviço ofertável. Nesse estado não há formulário de reserva e a Server Action recusa (`salao_indisponivel`).
- RN-6 Seleção de serviços: 1–10 itens ofertáveis; ordem escolhida = ordem do atendimento (back to back). Profissionais oferecidos = `listarProfissionaisElegiveis` (executam todos os serviços); opção "sem preferência" escolhe um profissional com o horário (suposição).
- RN-7 Horários vêm só de `consultarDisponibilidade` (fuso do salão, grade, antecedência, janela, funcionamento ∩ jornada, bloqueios); a UI nunca recalcula. Dias na janela, no fuso do salão (não do navegador).
- RN-8 Dados da cliente: nome (2–100) e telefone brasileiro via `normalizarTelefoneBr`; erros de campo em pt-BR, sem 500.
- RN-9 Consentimento: caixa obrigatória `mensagens_reserva` (e termos/privacidade) via `CaixasConsentimento`; texto/versão só da config (`src/config/termos.ts`). Sem aceite → `consentimento_ausente`, nada gravado.
- RN-10 Criação: `criarReserva` com contexto público/sistema, `modo: 'normal'` (nunca encaixe), `chaveRequisicao` gerada no servidor ao abrir a confirmação e reenviada no formulário (idempotência contra duplo clique/reenvio). Todos os resultados de `criarReserva` mapeiam para mensagem pt-BR: `horario_indisponivel` → volta ao passo de horário com horários atualizados; `repetida` → mesma confirmação que `criada`.
- RN-11 Tela de confirmação mostra serviços, profissional, data/hora no fuso do salão, total e duração, sem expor dados de outras clientes. Não cria conta.
- RN-12 Isolamento: toda leitura/escrita escopada ao salão do slug; ids de outro salão tratados como inexistentes.
- RN-13 Ponto de extensão para E4.2: a ação aceita `antesDaReserva`/verificação prévia injetável (Turnstile/rate limit) sem alterar o fluxo; nesta demanda não é exigido.
- RN-14 Mobile-first (375×812, breakpoint único de `globals.css`), teclado, axe sem violações, pt-BR, tokens/componentes existentes; `Referrer-Policy: strict-origin` (como `/cadastro`) caso a ação seja Server Action sem JS.
- RN-15 Progressivo: o fluxo funciona sem JS (cada passo é GET com query string `?s=…&p=…&data=…&h=…`, e o POST final é Server Action), com melhoria com JS opcional. Se o arquiteto julgar inviável, registrar a exceção (suposição: viável).

## 5. Critérios de aceitação
- CA-1 Dado salão com perfil completo, fotos, funcionamento, serviços e equipe, quando GET `/<slug>`, então a página mostra todas as seções do DT-4 (exceto avaliações) e `<h1>` com o nome (#37).
- CA-2 Dado perfil sem campos opcionais / `funcionamento_definido=false`, então as seções vazias são omitidas e não há "undefined"/"null".
- CA-3 Dado slug histórico, quando GET, então 308 com `Location: /<slugAtual>`; slug inexistente → 404; cada segmento de `SEGMENTOS_RESERVADOS` nunca resolve como salão.
- CA-4 Dado salão com `suspenso_manual_em` preenchido, ou sem serviço ofertável, ou assinatura `pendente`/`suspensa`, então perfil e fotos aparecem, "Agendamento indisponível" aparece e não há formulário; POST direto à ação devolve `salao_indisponivel` e não cria reserva.
- CA-5 Dado serviços escolhidos, então só profissionais que fazem todos aparecem; nenhum → mensagem e volta à seleção.
- CA-6 Dado profissional e data, então os horários exibidos são iguais ao resultado de `consultarDisponibilidade` (fuso do salão, com processo em `UTC` e `America/Sao_Paulo`).
- CA-7 Dado dados válidos e consentimento, quando confirma, então existe uma `reserva` `confirmado`, itens com snapshot, cliente por salão+E.164, consentimento `mensagens_reserva` com a versão vigente, mensagem `confirmacao` na outbox, e a confirmação é exibida.
- CA-8 Dado envio duplicado com a mesma chave, então uma só reserva e a mesma tela de confirmação.
- CA-9 Dado dois envios simultâneos para o mesmo horário/profissional, então um `criada` e outro volta ao passo de horário com a mensagem "horário indisponível", sem 500.
- CA-10 Dado telefone não brasileiro/inválido, nome curto ou sem consentimento, então erros por campo em pt-BR, nenhum dado gravado, valores digitados preservados (também sem JS).
- CA-11 Dado serviço/profissional de outro salão, desativado depois da escolha, ou antecedência já vencida, então resultado tratado (indisponível), sem 500 nem vazamento.
- CA-12 E2E Playwright 375×812: perfil → reserva completa com teclado, sem rolagem horizontal, axe 4.14.0 zero violações em cada passo; variante sem JS cobre o fluxo.
- CA-13 Isolamento: dois salões, a página de um nunca mostra serviços, equipe, fotos ou horários do outro.
- CA-14 `next build` mantém `/termos` e `/privacidade` estáticas; `/<slug>` é dinâmica; `tests` existentes (lint de imports, `format.ts` único formatador) continuam verdes.

## 6. Casos limite
Virada de dia/DST no fuso do salão; data fora da janela; "hoje" após o último horário; slug com maiúsculas/caracteres especiais/muito longo (404 sem erro); slug trocado durante o fluxo (a ação resolve de novo, 308 no GET); cliente anonimizada com o mesmo telefone (D-022: `upsertCliente` segue regra existente, sem reutilizar o registro anonimizado se for o caso, arquiteto confirma); profissional desativado ou serviço desvinculado entre passos; duplo clique; JS desligado; fotos ausentes/removidas (404 de `/api/fotos/[id]` não quebra a página); descrições com HTML (escapar); salão suspenso não permite nem o POST direto.

## 7. Dependências
E3.1/E3.2 (D-018/D-025), E4.3 (D-023), E2.6/E2.7 (D-020/D-021), E5.1 (D-022), E7.1 (mensagens). Futuras: E4.2 (Turnstile/rate limit), E4.5 (avaliações), E6.4 (política de suspensão), E4.4 (E2E completo). Integrações: nenhuma obrigatória; WhatsApp simulado/outbox já cobertos.

## 8. Impactos prováveis
Dados: nenhum schema novo previsto (DBA só se o arquiteto precisar de leitura de assinatura pública, mas sem migração). Infra/CI: nenhum; E2E novos entram no job `e2e` (precisam de banco ou de uma demo `/dev/...` na vitrine). Atenção para E2E "sem banco": se não houver banco no job, usar vitrine `/dev/reserva` com dados em memória, como nas demandas anteriores. Risco: leitura de assinatura em rota pública (isolar numa função única).

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposição):
- D-1 "Pendente" = assinatura vigente em `pendente`; `em_teste`, `ativa` e `em_carencia` permitem reserva; `suspensa`/`encerrada`/`cancelada` (após `acesso_ate`) e `suspenso_manual_em` bloqueiam. Se não houver assinatura (salões legados/seed), considerar disponível. E6.4 poderá refinar via a função única.
- D-2 Escolha "sem preferência" de profissional incluída.
- D-3 Sem seção de avaliações até a E4.5.
- D-4 Slug histórico preserva o caminho/query no 308.
