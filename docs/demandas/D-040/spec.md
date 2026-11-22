# D-040 (E6.1) Assinatura: início e teste após autorização

## 1. Problema
- Não existe fluxo para criar assinatura: `src/app/painel/assinatura/` não existe (só `ROTAS.assinatura` e `ROTAS.assinaturaRetorno` em `src/config/navegacao.ts:45-46`, item "Assinatura" do gestor em `:104`).
- Não há repositório que insira em `assinatura` (`src/server/repos/assinatura.ts` só tem `travar`, `aplicarPasso`, pagamentos, transições, `lerEstadoBruto`); só o seed grava direto.
- Cadastro (D-011) não cria assinatura. Sem linha, `decidirEstadoEfetivo` devolve `sem_assinatura` (`src/domain/assinatura/estado-efetivo.ts:27`); com `pendente` a capacidade é `leitura/configurar/cancelar/assinatura/lgpd` (`capacidades.ts:18`), sem `agendar`.
- A máquina tem `teste_iniciado`: `pendente → em_teste`, `testeFimEm = agora + DIAS_TESTE` (`maquina-estados.ts:125-133`); em `em_teste` é `sem_efeito`; em outro estado, `ignorado`. O `agora` do evento é o instante da decisão, não o da autorização.
- Porta MP (`port.ts`): `criarAssinatura({salaoId,emailPagador,urlRetorno}) → {assinaturaId,urlCheckout}` (valida UUID/e-mail/URL antes de efeito) e `consultarAssinatura(id) → {estado: pendente|autorizada|cancelada, salaoId, autorizadaEm,…}`. A porta não devolve a URL de checkout numa consulta. Simulado: `/dev/mp-checkout?assinatura=<id>`; real = `NaoImplementado` (E6.6).
- Schema `assinatura`: `provedor_assinatura_id` UNIQUE anulável, `UNIQUE(salao_id) WHERE estado <> 'encerrada'` (`restricoes_sql:141`). Não há coluna `referencia_externa`: a referência é o `salaoId`, gravado no provedor e devolvido em `AssinaturaProvedor.salaoId`.
- `sem_assinatura` tem TODAS as capacidades (`capacidades.ts:26`, `TUDO`) e `aviso.ts:11` não mostra aviso nesse caso; só `pendente` restringe `agendar`. Portanto o salão recém-cadastrado sem linha opera normalmente e nunca é levado a assinar (lacuna vs. S9; fora do escopo se mudar a política D-038).

## 2. Objetivo
O gestor inicia a assinatura, é levado ao checkout do provedor e, ao voltar, o sistema consulta o provedor; só uma autorização confirmada por ele inicia o teste de 30 dias (R$ 79,00/mês, `src/config/plano.ts`).

## 3. Escopo
Entra: ação `iniciarAssinatura`; serviço `src/server/assinatura/iniciar.ts`; serviço de retorno (consulta + evento); repositório de criação/reutilização de `pendente` e gravação do `provedor_assinatura_id`; página `/painel/assinatura` mínima (botão "Assinar" + estado) e `/painel/assinatura/retorno`; link do aviso "pendente" (D-038) para `/painel/assinatura`; README/env.
Fora (confronto com "Fora da primeira versão" e com as demandas seguintes): webhooks (E6.2), tela completa da assinatura, cancelamento e histórico (E6.5), adaptador real (E6.6), cobrança/falha (E6.3 já feita), pagamento de cliente. Nenhum item fora do v1 é tocado. Web-designer dispensado: tela mínima com os componentes de `src/components/ui/`.

## 4. Regras de negócio
- RN-1 (issue RN-1): uma assinatura vigente por salão (UNIQUE parcial). Criar é `INSERT … ON CONFLICT DO NOTHING` seguido de leitura da vigente, nunca capturando 23505.
- RN-2: `iniciarAssinatura` = `defineAcao({ papeis:['gestor'], capacidade:'assinatura' })`, permitida em qualquer estado em que a capacidade exista; o `salaoId` vem só da sessão. Gestor com e-mail não confirmado não loga (D-011), então "confirmado" é garantido pelo login.
- RN-3: só cria se não houver vigente, ou se a vigente for `pendente`. Com vigente `em_teste/ativa/em_carencia/cancelada/suspensa`, resultado `recusado/ja_existe` (renovação/reativação é E6.5). Salão com suspensão manual: a política decide (não contornar).
- RN-4: a chamada à porta NUNCA ocorre com transação aberta. Sequência: T1 cria/reutiliza `pendente` (trava da linha) e comita; porta `criarAssinatura` com `salaoId` (referência externa), e-mail do gestor da sessão e `urlRetorno = APP_URL + ROTAS.assinaturaRetorno` (sem parâmetros de estado); T2 grava `provedor_assinatura_id`. Falha da porta: `pendente` fica sem provedor, resultado `provedor_indisponivel` com mensagem pt-BR, estado inalterado; nova tentativa reutiliza a linha.
- RN-5 (reutilização): se a `pendente` já tem `provedor_assinatura_id`, consulta-se o provedor antes: `autorizada` → processa como retorno (não cria outra); `pendente` → cria nova assinatura no provedor, troca o `provedor_assinatura_id` e cancela a antiga no provedor (melhor esforço, falha só registrada em log sem dado pessoal); `cancelada` → cria nova e troca. O `provedor_assinatura_id` antigo deixa de pertencer à linha.
- RN-6 (issue RN-2): o retorno do navegador só dispara consulta. A página `/painel/assinatura/retorno` ignora toda query string; usa o salão da sessão, lê a assinatura vigente e consulta o provedor por `provedor_assinatura_id`. Exige sessão de gestor (redirect a `/entrar?proximo=` no 401). Conferir `AssinaturaProvedor.salaoId === ctx.salaoId`; divergência = recusa, sem evento (vínculo inequívoco).
- RN-7 (mapeamento): `autorizada` → `aplicarEventoAssinatura({tipo:'teste_iniciado'})`; `pendente` → nada, mensagem "aguardando confirmação"; `cancelada` → nada no estado (a assinatura fica `pendente`, a mensagem oferece tentar de novo, que cai em RN-5). `cobranca_*` e `cancelamento` do provedor pertencem à E6.2.
- RN-8 (issue RN-3): `testeFimEm = autorizadaEm + 30 dias`, onde `autorizadaEm` vem do provedor. Hoje a máquina usa o `agora` do evento (ver §9, decisão D-1). Valor R$ 79,00: se `valorCentavos` do provedor divergir de `PRECO_MENSAL_CENTAVOS`, registrar log `assinatura.valor_divergente` e seguir.
- RN-9: o retorno é idempotente: segunda execução com a assinatura já `em_teste` é `sem_efeito` (nenhuma transição nova, `testeFimEm` inalterado). `ocupada`/`sem_assinatura` do `aplicarEventoAssinatura` viram mensagem neutra, sem 500.
- RN-10 (issue RN-4): nenhum dado de cartão trafega ou é gravado. O checkout é do provedor; nenhum campo, coluna, log ou corpo guarda PAN/CVV.
- RN-11 (issue RN-5/PLAN): conta provisória = salão sem assinatura ou com `pendente`: pode configurar, não agenda (capacidades vigentes). Nada de novo no cadastro.
- RN-12 (issue RN-6): toda mudança de estado passa por `aplicarEventoAssinatura`. A criação da linha `pendente` é a única escrita de estado fora dele (estado inicial, sem transição de domínio); o arquiteto decide se registra `assinatura_transicao` (`de` nulo).
- RN-13: concorrência: iniciar × iniciar e retorno × retorno serializam pela trava do salão/linha; retorno × webhook (E6.2) é seguro porque ambos usam `aplicarEventoAssinatura` (trava `FOR UPDATE`, `teste_iniciado` idempotente).

## 5. Critérios de aceitação
- CA-1 (issue CA-1): Dado gestor sem assinatura e `MP_ADAPTER=simulado`, quando executa `iniciarAssinatura`, então existe uma `assinatura` `pendente` do salão, com `provedor_assinatura_id` igual ao da `sim_mp_assinatura` cuja referência é o `salaoId`, e a resposta traz `urlCheckout` do `/dev/mp-checkout`.
- CA-2 (issue CA-2): Dado `pendente` e o simulado ainda não autorizado, quando se acessa `/painel/assinatura/retorno?status=approved&assinatura=<id>&collection_status=approved` (parâmetros forjados), então a assinatura segue `pendente`, `testeFimEm` nulo, nenhuma `assinatura_transicao` criada e o estado efetivo não oferece `agendar`.
- CA-3 (issue CA-3): Dado o simulado autorizado (`autorizar(id,{em})`), quando o retorno é processado, então a assinatura é `em_teste`, `testeFimEm = em + 30 dias` (exato, em UTC) e `estadoEfetivoDoSalao` oferece `agendar`; reprocessar não altera nada (RN-9).
- CA-4 (issue CA-4): Dado o banco migrado, quando se consulta `information_schema.columns`, então nenhuma coluna casa `%cart%`, `%card%`, `%cvv%` ou `%pan%` (e a consulta não pega falso positivo conhecido, ex.: `expansao`, que o teste deve tratar com padrão revisado); nenhum `webhook_evento.corpo` (e nenhum corpo/log gravado pelo fluxo) contém sequência de 13 a 19 dígitos.
- CA-5: Dado gestor do salão A, quando inicia, então só o salão A recebe linha; o salão B nunca é lido/alterado. Dado `profissional` ou anônimo, a ação responde 403/401 sem efeito.
- CA-6: Dado `forcarErro('criarAssinatura')`, quando inicia, então resultado `provedor_indisponivel`, a assinatura continua sem `provedor_assinatura_id` (ou inalterada), nenhuma transição; a nova tentativa funciona e reutiliza a mesma linha (uma só vigente).
- CA-7: Dado `forcarErro('consultarAssinatura')`, quando o retorno é processado, então estado inalterado e mensagem de indisponibilidade, sem 500.
- CA-8: Dado `pendente` com provedor `pendente`, quando inicia de novo, então continua 1 vigente, `provedor_assinatura_id` novo e a antiga cancelada no simulado; dado provedor `autorizada`, não cria outra e inicia o teste (RN-5).
- CA-9: Dado 10 `iniciarAssinatura` em paralelo no mesmo salão, então 1 linha vigente, sem 23505 e sem impasse; 10 retornos em paralelo após a autorização, então 1 transição `pendente → em_teste`.
- CA-10: Dado assinatura vigente em `em_teste/ativa/…`, quando inicia, então `recusado/ja_existe` sem chamar a porta.
- CA-11: Dado a assinatura do provedor com `salaoId` de outro salão, quando o retorno processa, então recusa e o estado não muda.
- CA-12: Retorno e `/painel/assinatura` sem sessão redirecionam a `/entrar?proximo=`; a tela mínima funciona sem JS (formulário POST) e por teclado; "Assinar" só aparece sem vigente ou com `pendente`.

## 6. Casos limite
- Retorno sem assinatura vigente ou `pendente` sem `provedor_assinatura_id` (usuário abandonou antes da T2): mensagem "inicie a assinatura", sem consulta.
- Autorização anterior ao dia: `autorizadaEm` no passado (o gestor volta horas depois): o fim é contado da autorização (D-1).
- Duas abas: iniciar numa, retorno na outra; usuário fecha o checkout e reinicia.
- Cliente do salão suspenso manualmente: a política (D-038) decide; não contornar.
- Fuso: instantes em UTC; só a exibição usa `src/lib/format.ts` e o fuso do salão.
- `APP_URL` com barra final ou com caminho: normalizar (a porta exige URL absoluta http/https).
- ID do provedor desconhecido (`RecursoNaoEncontradoNoProvedor`): tratar como indisponível/pendente sem 500.
- Erros do provedor nunca vazam texto cru ao usuário.

## 7. Dependências
D-037 (máquina e `aplicarEventoAssinatura`), D-038 (política/aviso), D-011/D-007 (cadastro, porta MP simulada). Bloqueia E6.2 e E6.5. Sem WhatsApp/e-mail/Turnstile. Mercado Pago só pela porta.

## 8. Impactos prováveis
- Dados: provavelmente nenhuma migração (UNIQUE parcial e `provedor_assinatura_id` já existem). DBA só se o arquiteto optar por registrar a criação em `assinatura_transicao` ou índice novo.
- Código: repositório de assinatura ganha criar/reutilizar e gravar `provedor_assinatura_id`; registro de `defineAcao`; `ROTAS` já tem as rotas (conferir `SEGMENTOS_RESERVADOS`, que já inclui `painel`).
- Infra/CI/env: nenhuma variável nova (`APP_URL`, `MP_ADAPTER` existem). README: seção Assinatura e comando de estabilidade. DevOps não necessário.

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposição adotada):
- D-1: o fim do teste deve ser autorização + 30 d, mas `decidir` usa o `agora` do evento. Suposição: o evento `teste_iniciado` passa a carregar `iniciadoEm` opcional (a autorização do provedor) e a máquina o usa quando presente; sem ele mantém `agora` (D-037 intacto). Alternativa mais simples: passar `agora = autorizadaEm`, mas isso também altera `ocorrida_em` da transição. Arquiteto decide.
- D-2: reutilização de `pendente` com provedor `pendente` cria nova assinatura no provedor e cancela a antiga (a porta não devolve URL numa consulta).
- D-3: após o retorno bem-sucedido, redirecionar a `/painel/assinatura` (mensagem de sucesso) ou renderizar na própria página; suposição: renderizar o resultado na própria página de retorno, sem PRG, para o simulado funcionar sem JS.
- D-4: como `sem_assinatura` não avisa nem restringe, o link para assinar fica no item de navegação "Assinatura" e na faixa de `pendente`; mudar `sem_assinatura` para restringir é decisão do líder (impacta D-038/seed). "o gestor é levado a assinar após confirmar o e-mail": suposição mínima, o aviso do painel (faixa pendente/sem assinatura, D-038) linka `/painel/assinatura`; sem mudança no fluxo de `/confirmar-email`.

## 10. Riscos
- R-1: chamada externa fora da transação deixa `pendente` órfã sem provedor (aceito: reutilizável).
- R-2: assinatura antiga no provedor autorizada depois da troca (mitigado por cancelar; E6.2 deve resolver por `provedor_assinatura_id` e ignorar desconhecidos).
- R-3: o simulado autoriza por quem souber o ID (já documentado no README).
