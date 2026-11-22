# D-047 (E7.2) — Adaptador real do WhatsApp Cloud API

## 1. Problema
Hoje `criarWhatsAppReal` é stub: `enviarModelo` rejeita com `NaoImplementado('E7.2')` (`src/server/integrations/whatsapp/real.ts`) e `whatsapp/ambiente.ts` devolve sempre `{ ok:false, variaveis:['WHATSAPP_ADAPTER'] }` (startup recusa o modo real, `CHAVES = []`). O pipeline D-024 (`src/server/mensagens/envio.ts:66-71`) trata `ErroEnvioPermanente` como definitivo e todo o resto (`ErroEnvioTemporario`, desconhecido, `NaoImplementado`) como temporário com backoff. README (linha ~409/412/540) e `.env.example:46` dizem "real recusado". Não existem `docs/whatsapp-templates.md` nem variáveis `WHATSAPP_*`.

## 2. Objetivo
Enviar as 4 mensagens (confirmação, remarcação, cancelamento, convite de avaliação) pelo número central apenas configurando credenciais, com erros classificados corretamente e validação por testes de contrato (sem credencial real).

## 3. Escopo
Entra: `whatsapp/real.ts` (HTTP via `fetch`, sem SDK), `whatsapp/ambiente.ts` (config + validação), ligação em `registry.ts` (`criarWhatsAppReal(c.config)`), `.env.example`, README ("Credenciais para os serviços reais", tabela de adaptadores, check-env), `docs/whatsapp-templates.md`, testes unit (servidor HTTP local) e de startup (check-env/worker).
Fora: webhook de status da Meta; sandbox/número real; UI; migração (nenhuma: `mensagem_tentativa.provedor_mensagem_id` já existe — confirmar com o arquiteto); mensagens fora dos 4 modelos; mídia, botões, mensagens de sessão (texto livre). Confronto com "Fora da primeira versão" do PLAN: nada conflita (lembretes/promocionais continuam fora).

## 4. Regras de negócio
- RN-1 (issue #50 + D-019): variáveis `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` (padrão fixado `v23.0`; formato `^v\d+\.\d+$`), `WHATSAPP_TEMPLATE_CONFIRMACAO`, `_REMARCACAO`, `_CANCELAMENTO`, `_CONVITE_AVALIACAO`, `WHATSAPP_TEMPLATE_IDIOMA` (padrão `pt_BR`). Obrigatórias em modo real: token, phone number id, os 4 nomes de modelo; as demais têm padrão. Valores com `trim`; vazio = ausente. `WHATSAPP_PHONE_NUMBER_ID` só dígitos; nomes de modelo `^[a-z0-9_]{1,512}$`. Todas as inválidas/ausentes são nomeadas juntas, ordenadas, nunca valores. Em modo simulado nenhuma é exigida. A recusa incondicional atual é removida.
- RN-2 (RN-2 da issue): permanente não retenta; temporário retenta (backoff do D-024). Classificação abaixo (seção 4.1).
- RN-3: `messages[0].id` (string não vazia) é devolvido como `provedorMensagemId`; 2xx sem esse campo = `ErroEnvioTemporario('resposta_invalida')`... ver risco R-2.
- RN-4: destinatário validado por `validarEnvioModelo` (E.164 BR) e enviado em `to` sem o `+` (apenas dígitos, como a doc da Meta recomenda; a API também aceita com `+`). Confirmar no teste de contrato que `to` = dígitos.
- RN-5: timeout HTTP explícito por `AbortSignal.timeout`, padrão 10 000 ms, injetável; deve ser < `TIMEOUT_ENCERRAMENTO_MS` (25 s) e coberto por teste de guarda (constante < 25 000).
- RN-6 (D-024 RN-14/RN-22): token e link do convite nunca em log, erro, mensagem de exceção, `codigo`, `erro_detalhe`. Erros usam só as classes fixas da porta; `codigo` vem de lista fechada (`^[a-z0-9_]+$`, já exigido por `codigoDe`); o corpo da resposta da Meta não é propagado, exceto o `error.code` numérico mapeado.
- RN-7: parâmetros nomeados → posicionais (`components:[{type:"body",parameters:[{type:"text",text}]}]`), na ordem fixa:
  - confirmacao/remarcacao: 1 `salao`, 2 `servicos`, 3 `profissional`, 4 `data`, 5 `horario`
  - cancelamento: 1 `salao`, 2 `servicos`, 3 `data`, 4 `horario`
  - convite_avaliacao: 1 `salao`, 2 `link`
  Parâmetro ausente no objeto = `ErroEnvioPermanente('parametro_ausente')`. Valor vazio (ex.: `profissional` = `''`) é substituído por `-` (a Meta rejeita parâmetro vazio, erro 132012). Texto sem `\n`, `\t` nem mais de 4 espaços seguidos (regra da Meta para parâmetros): normalizar para um espaço.
- RN-8: corpo: `{ messaging_product:"whatsapp", recipient_type:"individual", to, type:"template", template:{ name, language:{ code: idioma }, components } }`; cabeçalhos `Authorization: Bearer <token>` e `Content-Type: application/json`; URL `https://graph.facebook.com/{versao}/{phone-number-id}/messages` (base injetável nos testes; fora dos testes, fixa).
- RN-9 (idempotência): a Cloud API não tem chave de idempotência para `/messages`; a chave `reserva:tipo:revisao` NÃO é enviada à Meta (ela é a `singletonKey` e a chave da tentativa). Unicidade é garantida pelo pipeline D-024. O adaptador não reenvia por conta própria (zero retentativas internas).

### 4.1 Mapeamento de erros (decisão)
Ordem: (1) falha de rede/DNS/conexão recusada/timeout/abort → temporário `rede`/`timeout`; (2) HTTP 5xx → temporário `provedor_indisponivel`; (3) HTTP 429 ou `error.code` ∈ {4, 80007, 130429, 131048, 131056} → temporário `limite_de_taxa`; (4) `error.code` ∈ {131000, 131016, 2, 1} → temporário `provedor_indisponivel`; (5) HTTP 401/403 ou `error.code` ∈ {190, 10, 200–299, 131005} → **temporário** `configuracao_invalida` (a mensagem não está defeituosa; o gestor corrige o token e a retentativa ou o reenvio do admin funciona; ao esgotar vira `falhou`, reenviável); (6) permanentes: `131026` (não entrega/sem WhatsApp) `numero_invalido`, `131030` e `131021` destinatário recusado `destinatario_recusado`, `132001` modelo inexistente, `132000`/`132012`/`132005` parâmetros `parametros_invalidos`, `132007` política, `132015`/`132016` modelo pausado/desativado, `131047`/`131051`, `100` e demais HTTP 400 com código não listado `requisicao_invalida`; (7) qualquer outro 4xx → permanente `requisicao_invalida`; 3xx e outros → temporário `resposta_inesperada`. Códigos de `codigo` em lista fechada e documentados no README/`docs/whatsapp-templates.md`.
Nota: 132001/132015/132016 são, na prática, configuração do operador; classificados permanentes porque a retentativa automática não os cura (o admin reenvia após corrigir, D-045).

## 5. Critérios de aceitação
- CA-1 (CA-1 issue): Dado servidor HTTP local que imita a Cloud API, quando `enviarModelo` envia `confirmacao`, então o servidor recebe `POST /{versao}/{phoneId}/messages` com `Authorization: Bearer`, `messaging_product:"whatsapp"`, `to` só dígitos, `template.name` = `WHATSAPP_TEMPLATE_CONFIRMACAO`, `language.code` = `pt_BR` e 5 parâmetros de corpo na ordem da RN-7.
- CA-2: Para os 4 modelos, o nome do template e a ordem/quantidade dos parâmetros seguem a RN-7 (inclui `convite_avaliacao` com `[salao, link]`; CA-R1 da issue). `profissional` vazio vai como `-`.
- CA-3: Dada resposta 200 `{messages:[{id:"wamid.X"}]}`, o resultado é `{provedorMensagemId:"wamid.X"}`; (integração opcional) a tentativa registra esse id (RN-3).
- CA-4 (CA-2 issue): 500/502/503, 429, rede recusada e JSON de rate limit (130429) → `ErroEnvioTemporario`; erro `131026` (HTTP 400) → `ErroEnvioPermanente('numero_invalido')`; `132001`, `132000` → permanente.
- CA-5: HTTP 401 com `error.code` 190 → `ErroEnvioTemporario('configuracao_invalida')`.
- CA-6 (CA-4 issue): Dado servidor que aceita a conexão e não responde, quando a porta envia com timeout configurado de T ms, então rejeita com `ErroEnvioTemporario('timeout')` em ≤ T + margem; a constante padrão é < 25 000 ms.
- CA-7: Entrada inválida (telefone não BR, chave vazia, modelo desconhecido, parâmetro ausente) é recusada por `ErroEnvioPermanente` ANTES de qualquer requisição (servidor não recebe nada).
- CA-8 (RN-6): em todos os cenários de erro, nem `message`, `codigo`, `stack` serializado, nem logs contêm o token, o link do convite ou o corpo da resposta; teste com token/link sentinela.
- CA-9 (CA-3 issue): Dado `WHATSAPP_ADAPTER=real` sem `WHATSAPP_ACCESS_TOKEN`, `check-env` e o worker saem com código ≠ 0 nomeando `WHATSAPP_ACCESS_TOKEN` (e todas as outras faltantes juntas, ex.: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_*`); sem valores na saída. Com tudo preenchido, o ambiente é válido e o log de modos mostra `whatsapp=real`.
- CA-10: Modo simulado não exige nenhuma `WHATSAPP_*`; `WHATSAPP_API_VERSION` inválida (`abc`) ou `PHONE_NUMBER_ID` não numérico em modo real é recusado nomeando a variável.
- CA-11: `registry` com `WHATSAPP_ADAPTER=real` e config válida devolve o adaptador real (não `NaoImplementado`); o lint de registry continua passando (adaptador obtido só por `registry.ts`).
- CA-12 (pipeline): com o real contra o stub, 5xx → `enviarMensagem` devolve mensagem a `pendente` (reagendar); `131026` → `falhou` sem retentativa; sucesso → `enviada` com o id da Meta na tentativa (teste de integração com PostgreSQL real e stub HTTP).
- CA-13: `.env.example` lista as 9 variáveis; README lista as credenciais e os 4 modelos aprovados e a validação real pendente (E9.3); `docs/whatsapp-templates.md` existe com os 4 textos.
- CA-14: Gate padrão (lint, typecheck, build, cobertura ≥ 90%, `docker` smoke inalterado).

## 6. Casos limite
- Timeout/queda DEPOIS de a Meta aceitar o pedido (resultado incerto): o adaptador não consegue distinguir; é classificado temporário (CA-4 da issue) e o pipeline reenvia, com risco raro de mensagem duplicada. Aceito e documentado (R-1). Falha anterior ao envio (DNS, conexão recusada) é segura.
- 2xx sem `messages[0].id` ou JSON ilegível: a mensagem pode ter sido aceita; tratar como temporário `resposta_invalida` com a mesma ressalva (R-2); nunca `sucesso` sem id.
- Cliente anonimizada: já filtrada pelo pipeline antes de chamar a porta; o adaptador não vê PII além do envio.
- Salão suspenso: cancelamento segue sendo enviado (invariante do CLAUDE.md); o adaptador é indiferente.
- Fuso: data/horário já chegam formatados no fuso do salão; o adaptador não formata datas.
- Parâmetros: `salao`/`servicos` longos (nome com 100 caracteres, lista de serviços): a Meta limita parâmetro a 1024 caracteres; truncar com `…` em 1024 code points (sem cortar surrogate).
- Número não brasileiro: barrado por `E164_BR`.
- Redirecionamentos (3xx): `redirect:'manual'`, tratado como inesperado (o token não pode seguir para outro host).
- `WHATSAPP_API_VERSION` descontinuada pela Meta: resposta 4xx/`code 2635`... classifica como `requisicao_invalida`; operador atualiza a variável (risco R-3).
- Isolamento entre salões: credencial é única e central; nenhum dado de salão no estado do adaptador.
- Concorrência: adaptador sem estado mutável compartilhado.

## 7. Dependências
D-007 (porta/registry), D-024 (pipeline), D-032 (link de avaliação, só em memória), D-045 (reenvio admin). Bloqueia E9.3 (README). Integração externa: WhatsApp Cloud API (Meta), conta Business, número e 4 modelos aprovados (fora do repo).

## 8. Impactos prováveis
Dados: nenhum (sem migração). CI/infra: `.env.example`, compose (repassar as `WHATSAPP_*` ao app e ao worker se o compose enumera variáveis; verificar), `check-env`/bundle do worker (`ambiente.ts` sem imports), teste do registry/`env.test` que hoje afirma a recusa do real (atualizar). DevOps: apoio/revisão apenas; DBA dispensável.

## 9. Dúvidas
Bloqueantes: nenhuma.
Não bloqueantes (suposições):
- S-1: versão padrão da Graph API `v23.0` (arquiteto confirma na doc oficial no momento do desenho; o valor deve ser uma constante única).
- S-2: 401/403/190 como temporário (RN em 4.1); alternativa permanente descartada porque a falha é do operador, não da mensagem.
- S-3: sem campo para "idempotência" na Meta; duplicidade em resultado incerto aceita (R-1). Mitigação futura fora do escopo: webhook de status.
- S-4: categoria dos modelos UTILITY (risco: a Meta pode reclassificar `convite_avaliacao` como MARKETING, com custo maior; D-019).
- S-5: `to` sem `+` (a Cloud API aceita ambos; confirmar no desenho).

## 10. Riscos
R-1 duplicidade rara em timeout pós-aceite. R-2 idem para resposta 2xx malformada. R-3 depreciação da versão da API. R-4 adaptador nunca validado contra a Meta real (somente contrato; E9.3/README). R-5 os mapeamentos de códigos vêm da documentação e podem divergir da realidade; a lista fica em um único módulo para ajuste.

## 11. Textos sugeridos dos modelos (para `docs/whatsapp-templates.md`; categoria UTILITY, idioma pt_BR, sem cabeçalho/rodapé/botões)
Nomes sugeridos: `agenda_confirmacao`, `agenda_remarcacao`, `agenda_cancelamento`, `agenda_convite_avaliacao`.
- Confirmação: "Olá! Seu horário no {{1}} está confirmado: {{2}} com {{3}}, em {{4}} às {{5}}."
- Remarcação: "Olá! Seu horário no {{1}} foi remarcado: {{2}} com {{3}}, agora em {{4}} às {{5}}."
- Cancelamento: "Olá! Seu horário no {{1}} foi cancelado: {{2}}, que seria em {{3}} às {{4}}."
- Convite de avaliação: "Olá! Obrigado por ter vindo ao {{1}}. Conte como foi sua experiência: {{2}} Agradecemos a sua visita."
Cada um com exemplos de valores no documento (exigência da Meta). Sem nome da cliente nem telefone (menos PII). Observação: no modelo da Meta, uma variável não pode ser o início/fim do texto nem haver variáveis adjacentes; os textos acima respeitam isso.
