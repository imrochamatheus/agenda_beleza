# D-042 (E6.5) Assinatura no painel — spec

## 1. Problema (evidência)
- `/painel/assinatura` (`src/app/painel/assinatura/page.tsx`) mostra só o rótulo da situação (`rotulos.ts`) e o botão "Assinar" para `sem_assinatura`/`pendente`. Não há datas, valor, histórico, cancelamento, regularização nem nova assinatura após `encerrada`.
- `/painel/assinatura/retorno` (D-040) consulta o provedor e mostra uma mensagem; mantém-se como está.
- Porta MP (`integrations/mercadopago/port.ts`): já tem `cancelarAssinatura` (idempotente; o simulado lança `ErroProvedor` se `forcarErro('cancelarAssinatura')`) e `consultarAssinatura`. NÃO tem como obter uma URL para o gestor atualizar o meio de pagamento. O adaptador real só lança `NaoImplementado('E6.6')`.
- `aplicarEventoAssinatura` já trata o evento `cancelamento` (`maquina-estados.ts:69`): `em_teste` → `cancelada` com `acessoAte = testeFimEm`; `ativa` → `cancelada` com `acessoAte = periodoPagoAte`; `pendente`/`em_carencia`/`suspensa` → `encerrada`; os demais → `sem_efeito`. O webhook (`webhook-decisao.ts:103`) emite o mesmo evento, o que torna cancelar × webhook idempotente.
- `lerVigente` considera vigente tudo o que não é `encerrada`, e `iniciarAssinatura` recusa com `ja_existe` se a vigente não é `pendente`. Uma `cancelada` com `acesso_ate` vencido é "encerrada" só no estado efetivo (`estado-efetivo.ts`) até o job `prazo` rodar. Lacuna: a S10 (nova assinatura) ficaria bloqueada nessa janela.
- A capacidade `assinatura` é permitida em todos os estados, inclusive `suspensa`, `encerrada` e `manual` (`capacidades.ts`). `assinatura.gerir` = gestor `salao`; profissional `negado` (`permissoes.ts:53`).

## 2. Objetivo
O gestor entende a situação da assinatura (estado, datas, valor) e consegue regularizar, cancelar ou assinar de novo, sem nunca ver um estado local que o provedor não confirmou.

## 3. Escopo
Entra:
- Tela completa em `/painel/assinatura`.
- `src/server/assinatura/cancelar.ts` e a ação `cancelarAssinatura` (`defineAcao`, `papeis: ['gestor']`, `capacidade: 'assinatura'`).
- Ação "Regularizar / atualizar meio de pagamento".
- Nova assinatura após `encerrada` (S10).
- Leitura dos dados da tela e histórico de pagamentos.
- Extensão da porta MP e do simulado.

Fora:
- Adaptador MP real (E6.6).
- Telas e ações de admin (E8.2/E8.3).
- Reativar uma `cancelada` dentro do prazo (decisão: não oferecer na v1; no fim do acesso o gestor assina de novo).
- Emissão de nota ou recibo, troca de plano, cupom.
- Mudança de preço. Nada disso consta em "Fora da primeira versão"; é limite de v1.

## 4. Regras de negócio
- RN-1: só o gestor acessa. Profissional recebe 403 ("Acesso negado"); sem sessão, redireciona para `/entrar`. Isolamento: tudo é lido pelo `ctx.salaoId`, e a tela nunca recebe ids de assinatura do cliente.
- RN-2: o estado local só muda após confirmação do provedor. Cancelar = `mp.cancelarAssinatura(id)` FORA de transação; se ok, `aplicarEventoAssinatura({tipo:'cancelamento'})` (ponto único, RN-5 da issue). O estado nunca é escrito diretamente.
- RN-3: falha do provedor (`ErroMercadoPago`, inclusive `NaoImplementado`) → resultado `provedor_indisponivel`, mensagem "erro de pagamento", estado e datas intactos, nenhuma transição.
- RN-4: cancelar exige confirmação em duas etapas, sem dialog e sem JS.
  - Etapa 1: botão "Cancelar assinatura" (GET `?cancelar=1` ou formulário) mostra o aviso do que acontece e as datas.
  - Etapa 2: botão "Sim, cancelar assinatura" (POST) e link "Manter assinatura".
- RN-5: cancelar é idempotente. Uma segunda tentativa, ou uma `cancelada` pelo webhook, vira mensagem "já cancelada" com a data de acesso, sem erro e sem novo registro de transição.
- RN-6: pode cancelar em `pendente`, `em_teste`, `ativa`, `em_carencia` e `suspensa`.
  - `pendente`/`em_carencia`/`suspensa` → `encerrada` (regra da máquina).
  - Não há ação em `cancelada`, `encerrada`, `sem_assinatura` ou `manual`.
  - Sem `provedorAssinaturaId` (pendente que nunca chegou ao checkout), cancela só localmente, pois não há o que o provedor confirmar.
- RN-7: regularizar/atualizar meio de pagamento é oferecido em `pendente` (volta ao checkout, reaproveitando `iniciarAssinatura`), `em_carencia`, `suspensa` e `ativa` (atualizar cartão).
  - Em `em_teste`: não (a autorização já foi dada).
  - Extensão da porta: `urlAtualizarMeioPagamento(id: string): Promise<string>`. O simulado devolve uma URL de `/dev/mp-checkout`; o real (E6.6) usa o link do provedor.
  - O navegador volta pelo retorno (D-040), que só consulta. Qualquer mudança de estado vem de webhook ou consulta ao provedor. Falha → "erro de pagamento".
- RN-8: nova assinatura (S10) quando o estado efetivo é `encerrada` ou `sem_assinatura`: botão "Assinar novamente", que usa `iniciarAssinatura` e cria nova linha `pendente`. A assinatura `encerrada` antiga é mantida como histórico. Ajuste obrigatório em `iniciarAssinatura`/`lerVigente`: uma `cancelada` com `acesso_ate <= agora` deve ser encerrada (via `aplicarEventoAssinatura({tipo:'prazo'})` sob a trava) antes de criar a nova, sem esperar o job.
- RN-9: o valor exibido vem de `PRECO_MENSAL_CENTAVOS` (R$ 79,00/mês) e `DIAS_TESTE` (30), via `formatarMoeda`. Datas via `formatarData` no fuso do salão (nunca outro formatador). Os campos mostrados são `teste_fim_em`, `periodo_pago_ate` (próxima cobrança), `carencia_ate` e `acesso_ate`.
- RN-10: histórico de pagamentos (`assinatura_pagamento`) é mostrado, somente leitura: até 12 mais recentes, com data, valor e "Aprovado"/"Recusado". Sem ids do provedor nem de pagamento. Lista vazia → "Nenhum pagamento registrado."
- RN-11: a tela e a ação funcionam sem JavaScript e por teclado (`useActionState`; resultado no estado da resposta). A ação não faz PRG de sucesso silencioso: o estado atualizado é lido de novo na renderização.
- RN-12: o estado efetivo e a faixa `AvisoDoPlano` seguem como estão. A tela mostra uma versão detalhada, sem duplicar a lógica: usa `estadoEfetivoDoSalao`.

## 5. Conteúdo e estados da tela (pt-BR; o web-designer define o visual)
Blocos comuns: título "Assinatura"; situação (rótulo de `rotulos.ts`); plano "R$ 79,00/mês"; datas aplicáveis; ações; histórico; mensagem de resultado (sucesso, informação, "erro de pagamento").

| Estado efetivo | Mensagem principal | Datas | Ações |
|---|---|---|---|
| sem_assinatura | "Você ainda não assinou. Teste por 30 dias e depois R$ 79,00/mês." | n/a | Assinar |
| pendente | "Assinatura pendente de autorização no provedor. O agendamento fica indisponível até lá." | n/a | Continuar assinatura (checkout); Cancelar |
| em_teste | "Período de teste até dd/mm/aaaa" + "R$ 79,00/mês" (CA-1) | fim do teste = primeira cobrança | Cancelar |
| ativa | "Assinatura ativa. Próxima cobrança em dd/mm/aaaa." | próxima cobrança | Atualizar meio de pagamento; Cancelar |
| em_carencia | "Pagamento não confirmado. Seu acesso continua até dd/mm/aaaa." | carência até | Regularizar pagamento; Cancelar |
| suspensa | "Assinatura suspensa por falta de pagamento. Painel somente leitura." | n/a | Regularizar pagamento; Cancelar |
| cancelada | "Assinatura cancelada. Você pode usar o painel até dd/mm/aaaa" (CA-2) | acesso até | nenhuma (informativo) |
| encerrada | "Assinatura encerrada. Painel somente leitura." | n/a | Assinar novamente |
| manual | "Salão suspenso pela administração. Entre em contato com o suporte." | n/a | nenhuma (a assinatura não resolve) |

Mensagens de resultado: "Assinatura cancelada. Acesso até dd/mm/aaaa."; "Sua assinatura já estava cancelada."; "Erro de pagamento: não foi possível concluir agora. Nada foi alterado; tente novamente."; "A assinatura mudou. Atualizamos as informações." (quando o estado mudou entre a confirmação e o POST).

## 6. Critérios de aceitação
- CA-1: Dado `em_teste`, quando o gestor abre a tela, então vê "Período de teste até dd/mm/aaaa" (fuso do salão) e "R$ 79,00/mês".
- CA-2: Dado `ativa`, quando o gestor cancela e confirma, então o simulado registra o cancelamento, a assinatura passa a `cancelada` por `aplicarEventoAssinatura` (uma linha em `assinatura_transicao`, causa `cancelamento_gestor`) e a tela mostra "acesso até dd/mm/aaaa" (= `periodo_pago_ate`).
- CA-3: Dado `forcarErro('cancelarAssinatura')`, quando o gestor confirma, então vê "erro de pagamento" e o estado, as datas e as transições ficam intactos.
- CA-4: Dado um profissional, quando acessa a tela ou invoca a ação, então recebe 403 e nada é gravado ou chamado no provedor.
- CA-5: A etapa 1 não chama o provedor nem muda o estado; só a etapa 2 (POST) cancela. Funciona sem JS (E2E sem JS) e por teclado, com axe sem violações em 375×812.
- CA-6: Cancelar duas vezes (sequencial e 2 em paralelo) deixa uma só transição e `acesso_ate` inalterado; as duas respostas são sem erro.
- CA-7: Concorrência (10 repetições): cancelar × webhook de cancelamento × retorno do checkout, sem impasse, sem 5xx e com estado final `cancelada` ou `encerrada` coerente. Nenhuma transição duplicada e nenhuma chamada ao provedor dentro de transação.
- CA-8: Isolamento: o gestor do salão A nunca vê nem cancela a assinatura do B. O provedor só é chamado com o `provedorAssinaturaId` do salão do contexto. Seed: A `em_teste`, B `ativa`.
- CA-9: Estados `em_carencia`/`suspensa`: mostram "Regularizar pagamento" (URL do simulado via `urlAtualizarMeioPagamento`) e "Cancelar" leva a `encerrada`. Em `suspensa` e `encerrada` a página e a ação continuam acessíveis (capacidade `assinatura`).
- CA-10: Dado `encerrada` (ou `cancelada` com `acesso_ate` vencido, job não executado), quando o gestor clica "Assinar novamente", então é criada nova `pendente` e o checkout é aberto; a antiga permanece no histórico.
- CA-11: Em `cancelada` e `manual` não há botão de cancelar nem de assinar; a ação chamada por POST direto responde `recusado` sem efeito.
- CA-12: Histórico: lista até 12 pagamentos do salão, ordem decrescente, sem ids do provedor; em branco → "Nenhum pagamento registrado."
- CA-13: Falha de `urlAtualizarMeioPagamento` → "erro de pagamento", sem mudança de estado.
- CA-14: Em `UTC` e `America/Sao_Paulo` as datas exibidas são idênticas (virada de dia: 23:30 local não vira o dia seguinte).
- CA-15: Nenhum valor ou formatação fora de `src/lib/format.ts`/`config/plano.ts`; sem migração (teste estático existente).

## 7. Casos limite
- Fuso/virada de dia no "acesso até" e na próxima cobrança.
- Cancelamento pelo webhook entre a etapa 1 e a etapa 2: a etapa 2 relê o estado; se já `cancelada`, "já estava cancelada".
- Provedor cancela e o banco falha em seguida: o estado local fica atrasado até o webhook ou o retorno, que convergem (o provedor é a verdade). Registrar `assinatura.cancelar_pos_provedor_falhou` (log sem dados pessoais) e orientar "tente novamente" (o cancelar é idempotente).
- `provedorAssinaturaId` inexistente no provedor (`nao_encontrado`): tratado como "erro de pagamento", sem alterar o estado.
- Salão `manual` com assinatura `ativa`: exibir só a situação manual; sem ações.
- Dupla submissão e reenvio do POST: idempotente.
- Entrada: a ação não recebe parâmetros (nada do navegador escolhe a assinatura).
- Cliente anonimizada: não se aplica.

## 8. Dependências
D-037 (máquina, `aplicarEventoAssinatura`), D-038 (política/faixa), D-040 (iniciar/retorno), D-041 (webhook). Integração: MP simulado (porta estendida). Bloqueia E9.4.

## 9. Impactos
- Dados: nenhuma migração prevista (colunas e tabelas já existem). Novas leituras no `RepoAssinatura` (detalhe com datas e histórico de pagamentos). O arquiteto confirma com o DBA só se quiser índice em `assinatura_pagamento` por `assinatura_id`, `criado_em`.
- Porta/simulado: `urlAtualizarMeioPagamento` em `port.ts`, `simulado.ts` (com `forcarErro`) e `real.ts` (`NaoImplementado('E6.6')`); atualizar `OPERACOES_MP`, os testes de contrato e `registry`.
- Env: nenhuma. README: seção da assinatura e dos estados; E6.6 documenta a URL real.
- CI: E2E sem banco usa uma vitrine `/dev/assinatura` (padrão do projeto, atrás de `VITRINE_COMPONENTES`).
- `iniciarAssinatura`: ajuste da RN-8.

## 10. Dúvidas
Bloqueantes: nenhuma.
Suposições adotadas:
- Não há "reativar" em `cancelada`.
- O histórico entra (12 itens).
- `pendente` sem vínculo no provedor cancela só localmente.
- `urlAtualizarMeioPagamento` é um novo método da porta.
- `retorno` permanece inalterado.

Riscos:
- Divergência provedor × banco após cancelar (mitigada por idempotência + webhook).
- O real não validado (E6.6).
- Janela `cancelada` vencida × nova assinatura (tratada na RN-8).
