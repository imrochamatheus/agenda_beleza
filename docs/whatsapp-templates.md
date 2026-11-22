# Modelos (templates) do WhatsApp (D-047)

Textos para cadastrar e aprovar na Meta (WhatsApp Business Manager) antes de usar `WHATSAPP_ADAPTER=real`. O código
envia só o **corpo** do modelo (sem cabeçalho, rodapé ou botões), com parâmetros posicionais de texto.

- Categoria: **UTILITY** (risco: a Meta pode reclassificar o convite de avaliação como MARKETING, com custo maior).
- Idioma: **pt_BR** (`WHATSAPP_TEMPLATE_IDIOMA`).
- Nenhum modelo leva nome nem telefone da cliente (menos dados pessoais).
- Uma variável não pode abrir nem fechar o texto, nem haver variáveis adjacentes; os textos abaixo respeitam isso.
- Parâmetros: sem quebra de linha nem tabulação; valor vazio vai como `-`; no máximo 1024 caracteres (truncado com `…`).
  Essas regras de parâmetro **não** foram confirmadas na documentação oficial (README, "Pendente de validação na Meta").

Os nomes abaixo são sugestões; o que valer na Meta vai nas variáveis `WHATSAPP_TEMPLATE_*` (`^[a-z0-9_]{1,512}$`).

## Modelos

### `confirmacao` (`WHATSAPP_TEMPLATE_CONFIRMACAO`, sugestão `agenda_confirmacao`)
Texto: `Olá! Seu horário no {{1}} está confirmado: {{2}} com {{3}}, em {{4}} às {{5}}.`

Ordem das variáveis: confirmacao: salao, servicos, profissional, data, horario

Exemplo: `Studio Aurora`, `Corte feminino e escova`, `Marina`, `12/12/2026`, `14:30`.

### `remarcacao` (`WHATSAPP_TEMPLATE_REMARCACAO`, sugestão `agenda_remarcacao`)
Texto: `Olá! Seu horário no {{1}} foi remarcado: {{2}} com {{3}}, agora em {{4}} às {{5}}.`

Ordem das variáveis: remarcacao: salao, servicos, profissional, data, horario

Exemplo: `Studio Aurora`, `Corte feminino e escova`, `Marina`, `13/12/2026`, `10:00`.

### `cancelamento` (`WHATSAPP_TEMPLATE_CANCELAMENTO`, sugestão `agenda_cancelamento`)
Texto: `Olá! Seu horário no {{1}} foi cancelado: {{2}}, que seria em {{3}} às {{4}}.`

Ordem das variáveis: cancelamento: salao, servicos, data, horario

Exemplo: `Studio Aurora`, `Corte feminino e escova`, `12/12/2026`, `14:30`.

### `convite_avaliacao` (`WHATSAPP_TEMPLATE_CONVITE_AVALIACAO`, sugestão `agenda_convite_avaliacao`)
Texto: `Olá! Obrigado por ter vindo ao {{1}}. Conte como foi sua experiência: {{2}} Agradecemos a sua visita.`

Ordem das variáveis: convite_avaliacao: salao, link

Exemplo: `Studio Aurora`, `https://agenda.exemplo.com.br/studio-aurora/avaliar/EXEMPLO`.

O link é gerado no envio e vive só em memória; nunca é gravado nem registrado em log.

## Códigos de erro do adaptador (`erro_codigo`)

Lista fechada (`CODIGOS_ERRO_WHATSAPP` em `src/server/integrations/whatsapp/mapeamento.ts`).

| Código | Tipo | Quando |
|---|---|---|
| `rede`, `timeout` | temporário | falha de conexão ou tempo limite (10 s) |
| `provedor_indisponivel` | temporário | HTTP 5xx; `error.code` 1, 2, 131000, 131016, 131057, 133004 |
| `limite_de_taxa` | temporário | HTTP 429; `error.code` 4, 80007, 130429, 131048, 131056 |
| `configuracao_invalida` | temporário | HTTP 401/403; `error.code` 0, 10, 190, 200–299, 131005, 368, 131031, 131037, 131042, 131045 (falha do operador: token, permissões, conta) |
| `resposta_inesperada`, `resposta_invalida` | temporário | HTTP 3xx/outros; 2xx sem `messages[0].id` |
| `numero_invalido` | permanente | `error.code` 131026 |
| `destinatario_recusado` | permanente | `error.code` 131030, 131021 |
| `nao_entregue` | permanente | `error.code` 131049, 130472 |
| `modelo_invalido` | permanente | `error.code` 132001, 132015, 132016, 132007 |
| `parametros_invalidos` | permanente | `error.code` 132000, 132005, 132012, 131008, 131009 |
| `requisicao_invalida` | permanente | `error.code` 100, 131047, 131051, 135000 e qualquer outro HTTP 4xx |
| `parametro_ausente` | permanente | parâmetro do modelo ausente (erro de programação, antes de qualquer HTTP) |

Os significados dos `error.code` constam da página oficial de erros da Meta; o HTTP associado a cada um **não**, por isso
o `error.code` vale primeiro e o HTTP só serve de reserva.
