# D-001 — Desenho do backlog da v1 (arquiteto-software)

Entradas: `PLAN.md`, `CLAUDE.md`, `docs/demandas/D-001/backlog.md` e `docs/demandas/D-001/spec.md` (55 itens: épicos E0..E9 e 45 sub-issues).
Estado do repositório: sem código, sem `package.json`, sem commits. Nesta demanda nada é implementado. O produto são as issues no GitHub (épico = issue pai; sub-issues; relações nativas "blocked by"), geradas a partir do bloco `json backlog` no fim deste documento.

## 1. Resumo da solução

O backlog segue a decomposição do analista (R3 aceita integralmente) e é organizado em **14 ondas** de execução derivadas do grafo "blocked by". A fundação (E0) é ordenada para que o banco e a CI existam cedo. Depois vêm a autenticação e o RBAC, a configuração do salão, o motor de disponibilidade e a criação de reserva com a constraint anti-sobreposição. A página pública é construída sobre esse núcleo. Assinatura, painel do super admin e WhatsApp real correm em paralelo ao núcleo da agenda.

Três decisões de desenho reduzem o retrabalho e mudam dependências em relação ao rascunho do líder:

1. **Wrapper central de ações do servidor com "capacidade" declarada (E0.5).** Toda server action ou rota autenticada é criada com `defineAcao({ papeis, capacidade }, handler)`, em que `capacidade ∈ {'leitura','configurar','agendar','cancelar','assinatura','lgpd'}`. O wrapper resolve o `TenantContext` a partir da sessão, checa o papel e consulta uma **política de operação plugável**, que no início permite tudo. E6.4 só troca a política pela regra real (suspenso/pendente/encerrado) e testa cada ação. Sem isso, E6.4 teria de editar todas as ações já prontas, com alto risco de esquecer alguma.
2. **Registro de mensagens pertence a E7.1, que passa a bloquear E3.2.** A reserva grava o registro `mensagem` na própria transação (outbox, §14) e envia o job à fila depois do commit. Por isso E7.1 entra no caminho crítico (P0). Ele roda em paralelo com E1/E2 (onda 5) e não alonga o caminho.
3. **A constraint anti-sobreposição usa `[inicio, ocupado_ate)`**, em que `ocupado_ate = fim + intervalo vigente no momento da reserva` (snapshot). Sem isso, duas reservas públicas concorrentes adjacentes passariam pela constraint e violariam o intervalo configurado (buffer). Com buffer 0, `ocupado_ate = fim` e o CA-4 de E0.4 (adjacentes aceitas) continua válido.

### Alternativas descartadas
- **Extensão do Prisma Client que injeta `salao_id` automaticamente** (sugestão de E0.5): descartada como mecanismo *único*. Ela não cobre `$queryRaw`, a disponibilidade usa SQL bruto, e o filtro fica implícito, difícil de auditar. Adotados: repositórios por agregado que recebem `TenantContext` explícito, mais uma regra de lint (`no-restricted-imports`) que proíbe importar o cliente Prisma fora de `src/server/repos/**`, `src/worker/**` e `prisma/seed.ts`.
- **Auth.js/NextAuth**: descartado. O provedor de credenciais não usa sessões no banco, e precisamos de sessão revogável (logout, reset de senha, profissional desativado) e de TOTP só para o super admin. Adotada sessão própria: tabela `sessao`, token aleatório com hash no banco e cookie httpOnly.
- **Coluna gerada `periodo tstzrange`**: descartada em favor de expressão na constraint (`tstzrange(inicio, ocupado_ate, '[)')`). O Prisma não modela colunas geradas de tipo `Unsupported` sem fricção, e a expressão dispensa sincronização.
- **Enfileirar a mensagem dentro da transação da reserva (pg-boss com `db` transacional)**: descartado. Uma falha da fila desfaria a reserva, o que viola o invariante "falha no WhatsApp não altera a reserva". Adotado (Revisão 1, proposta A-1 do desenvolvedor): **outbox**. O registro `mensagem` (estado `pendente`) é gravado na transação da reserva; o job pg-boss é enviado depois do commit; um job de reconciliação reenfileira pendentes órfãs. Ver §14.
- **Rate limit em memória ou com Redis**: descartado. Memória não funciona com várias instâncias, e Redis seria serviço novo. Adotada tabela PostgreSQL (E4.2).

### Decisões de ferramentas (nenhuma fora da stack sem justificativa)
| Necessidade | Escolha | Justificativa |
|---|---|---|
| Gerenciador de pacotes / runtime | npm + Node 24 LTS (`engines`) | Vem com o Node, sem ferramenta extra; LTS ativa em nov/2026 |
| Validação no servidor | `zod` | Um schema compartilhado entre formulário e servidor; também valida o `env` |
| Hash de senha | `@node-rs/argon2` | argon2id sem compilação nativa no build Docker |
| TOTP | `otpauth` | RFC 6238 testado; evita implementar criptografia à mão |
| Telefone E.164 | `libphonenumber-js` (metadata `min`) | Valida DDD e número BR (S8) sem tabela manual |
| Datas e fusos | `date-fns` + `@date-fns/tz` | Cálculo em fuso IANA com DST; Temporal ainda não é garantido no Node LTS |
| E-mail real | `nodemailer` (SMTP) | Funciona com qualquer provedor transacional (SES, Resend, Postmark, Brevo) só trocando credenciais |
| A11y E2E | `@axe-core/playwright` | Checagem automática de WCAG AA na suíte já exigida |
| Fila | `pg-boss` | Exigido no CLAUDE.md |
| Diálogos | elemento nativo `<dialog>` (modal) | Prende o foco e fecha com Esc nativamente; sem biblioteca de UI |

## 2. Caminho crítico e ondas

Caminho crítico (14 ondas), calculado do JSON:
`E0.1 → E0.2 → E0.4 → E0.5 → E1.2 → E2.2 → E2.1 → E3.1 → E3.2 → E3.4 → E3.5 → E6.4 → E4.4 → E9.4`

O marco "**reserva pública sem conflito e com isolamento de tenant**" chega na onda 10 (E4.1), e todo o caminho até ele é P0.

| Onda | Itens (podem rodar em paralelo, cada um com arquivos próprios) |
|---|---|
| 1 | E0.1 |
| 2 | E0.2, E0.8 |
| 3 | E0.3, E0.4 |
| 4 | E0.5, E0.6, E0.7 |
| 5 | E1.2, E4.3, E6.3, E6.6, E7.1, E7.2, E8.1, E9.1 |
| 6 | E1.1, E1.3, E1.5, E2.2, E2.5, E5.1 |
| 7 | E2.1, E2.3, E2.4, E5.2, E6.1, E8.2 |
| 8 | E3.1, E3.3, E6.2, E6.5 |
| 9 | E1.4, E3.2, E7.3, E8.3 |
| 10 | E3.4, E4.1, E9.2 |
| 11 | E3.5, E4.2 |
| 12 | E6.4, E9.3 |
| 13 | E4.4 |
| 14 | E9.4 |

Mudanças de dependência em relação ao rascunho do líder (todas refletidas no JSON):
- **E0.2 ← E0.1** e entrega também o *bootstrap* do Prisma (`prisma/schema.prisma` só com datasource/generator, `prisma.config.ts`, passo `prisma migrate deploy` no entrypoint) e um *stub* de `src/worker/main.ts`. Assim o compose sobe os 3 serviços antes de E0.4/E0.7, e a CI já tem banco.
- **E0.3 ← E0.2** (não depende de E0.4). Seu CA-3 usa um teste de integração mínimo (`SELECT 1` via Prisma). Assim o trabalho do DBA (E0.4) já passa pela CI.
- **E0.6 ← E0.4**: o e-mail simulado persiste em tabela (`email_log`), e Playwright e testes leem o link de lá entre processos.
- **E0.7 ← E0.4** (e não E0.2): o worker só precisa do banco. O container já existe pelo stub de E0.2.
- **E1.1 ← E1.2** (ordem invertida): o CA-6 de E1.1 ("gestor não confirmado não entra") exige o login.
- **E1.5 ← E8.1**: login e falha de TOTP são auditados (S14).
- **E3.2 ← E7.1, E5.1**: confirmação pós-commit e upsert de cliente.
- **E3.3 deixa de bloquear E3.4**: o formulário de reserva manual/encaixe tem rota própria (`/painel/agenda/nova`), e E3.3 só aponta para ela (related). Assim E3.4 (CA 3, encaixe sem sobreposição) fica no P0 sem arrastar a visualização.
- **E6.1 ← E6.3** e **E6.2 ← E6.1**: a máquina de estados é a base. Webhooks e retorno do checkout apenas a alimentam.
- **E6.4 ← E3.5, E2.5, E1.4** (além de E6.3): precisa das ações bloqueáveis existentes para testá-las uma a uma (CA-2).
- **Revisão 1:** E3.4 ← E4.3 (consentimento declarado), E6.4 ← E4.1 (página pública indisponível), E9.3 ← E4.2 (variáveis de rate limit e proxy). E9.3 passa da onda 11 para a 12; o caminho crítico não muda.
- **Revisão 1:** a tela de consulta da auditoria sai de E8.1 e vai para E8.3. Ela precisa da guarda do painel admin (E1.5), e E1.5 depende de E8.1: mantê-la em E8.1 criaria o ciclo E8.1 ↔ E1.5.
- **E9.4** passou a ser bloqueada também por E9.1 na Revisão 2 (§15).

## 3. Prioridades e tamanhos

- **P0 (21 sub-issues + épicos E0..E5 e E7)**: toda a E0, E1.1, E1.2, E2.1–E2.4, E3.1, E3.2, E3.4, E4.1, E4.3, E5.1, E7.1. Juntos entregam o CA 1 (cadastro e isolamento), o CA 2 (reserva multi-serviço pública) e o CA 3 (sem conflito, inclusive encaixe e concorrência). Nenhum P0 depende de P1 (verificado no JSON).
- **P1**: todo o resto que cobre os CAs 4–11 do PLAN (E1.3–E1.5, E2.5, E3.3, E3.5, E4.2, E4.4, E5.2, E6.*, E7.2, E7.3, E8.*, E9.2–E9.4).
- **P2**: E9.1 (landing). O PLAN exige a página, mas nenhum CA a verifica.
- Prioridade de épico = maior prioridade entre as filhas. Tamanho de épico = soma relativa.
- Tamanhos (relativos): XS < 0,5 dia; S ≈ 1 dia; M ≈ 2–3 dias; L ≈ 4–6 dias; XL > 1 semana (só para épicos).

## 4. Pareceres sobre R3 (mudanças propostas pelo analista)

| Chave | Parecer | Observação técnica |
|---|---|---|
| E0.6 (reescopo) | **Aceito** | A porta do MP já deve declarar toda a superfície usada por E6 (`criarAssinatura`, `consultarAssinatura`, `consultarPagamento`, `cancelarAssinatura`, `adiarProximaCobranca`, `validarWebhook`), para que o simulado sirva E6.1–E6.5 e E8.2 antes de E6.6. Inclui `src/config/plano.ts` (R$ 79,00 = 7900 centavos, 30 dias), fonte única do preço para E6.1 e E9.1. |
| E3.3 (retitulado) | **Aceito** | Só leitura. As ações ficam em E3.4/E3.5. |
| E3.4 (novo) | **Aceito**, P0 | Usa o mesmo serviço `criarReserva` de E3.2 com `origem: 'equipe'` e `confirmarEncaixe`. |
| E3.5 (novo) | **Aceito** | A remarcação é uma única transação: atualiza a reserva, regrava os itens, incrementa `revisao` e recalcula `ocupado_ate`. A constraint protege a troca. |
| E6.6 (novo) | **Aceito** | Inclui spike de sandbox para S12 (ver §5). |
| E7.3 (novo) | **Aceito** | Status exibidos alinhados aos de E7.1 (ver ajustes). |
| E8.2 (reescopo) | **Aceito** | |
| E8.3 (novo) | **Aceito** | O reenvio usa a mesma função de E7.1 (`reenviarMensagem`), em transação com a auditoria. |
| E0.8 (inclui navegação por perfil) | **Aceito** | Os layouts recebem o papel por prop. A integração com a sessão real fica em E1.2. |

## 5. Pareceres sobre as suposições

### S1 — Status que ocupam horário: **aprovada, com ajuste de forma**
`concluido` e `nao_compareceu` precisam continuar ocupando o horário: preservam a integridade histórica e evitam que a equipe "encaixe" no passado sobre um atendimento realizado. A constraint deve usar **lista explícita** (`WHERE (status IN ('confirmado','concluido','nao_compareceu'))`) em vez de `<> 'cancelado'`, para que um status futuro não passe a ocupar horário sem decisão consciente. Adicionar `CHECK (ocupado_ate > inicio AND fim > inicio AND ocupado_ate >= fim)`.

### S3 — Idempotência por revisão: **aprovada tecnicamente; registrar como pergunta ao usuário porque altera o texto literal do invariante**
O texto literal "reserva + tipo de evento" impediria uma segunda remarcação legítima (a cliente ficaria com o horário antigo na última mensagem recebida), contrariando o PLAN ("Remarcação: quando a equipe altera data, horário…"). Com `reserva + tipo + revisão`, uma reentrega ou um job repetido de uma mesma remarcação continua sem duplicar (mesma revisão, mesma chave única), que é o objetivo do invariante. Detalhes que acompanham a aprovação:
- `reserva.revisao int not null default 0` é incrementada **na mesma transação** da remarcação. A chave é `"{reservaId}:{tipo}:{revisao}"`, com `UNIQUE` no banco. Confirmação usa a revisão 0; cancelamento usa a revisão vigente no cancelamento (`cancelado` é final, então há no máximo um).
- **Substituição:** ao enfileirar a remarcação de revisão N, mensagens `pendente` da mesma reserva com revisão < N (confirmação ou remarcação) passam a `substituida` e não são enviadas. Assim a cliente não recebe uma sequência de horários obsoletos se o worker estiver atrasado. Mensagens já `enviada` não mudam.
- Os parâmetros do template são lidos da reserva **no momento do envio**, só se a revisão ainda for a vigente. Caso contrário, a mensagem vira `substituida`.
Recomendação: adotar, e o líder atualiza a frase do invariante no `CLAUDE.md` depois da aprovação do usuário.

### S12 — Extensão de teste no Mercado Pago real: **aprovada como comportamento; viabilidade real não confirmada**
A referência pública de `PUT /preapproval/{id}` lista `next_payment_date` e `auto_recurring.free_trial`, mas a documentação **não confirma** que um PUT numa assinatura `authorized` altera a data da próxima cobrança ([referência do update](https://www.mercadopago.com.br/developers/en/reference/online-payments/subscriptions/update-preapproval/put)). Decisão: a porta expõe `adiarProximaCobranca(assinaturaId, novaData)`. O adaptador simulado implementa e registra o adiamento (o CA 9 do PLAN só exige o adaptador local). O adaptador real tenta o PUT e, se a consulta subsequente não refletir a nova data, falha com `ProvedorNaoSuportaAdiamento` (comportamento de S12). E6.6 inclui um **spike documentado em sandbox** quando houver credenciais. Pergunta ao usuário P2 abaixo (não bloqueia).

### S13 — Operações no modo suspenso: **aprovada, com complemento para `pendente`**
A lista de S13 está coerente com o PLAN e o CLAUDE.md. A anonimização permitida em suspensão está correta (direito do titular, LGPD). Marcar o status de atendimentos passados não cria nem move ocupação, então é aceitável. O complemento vem do modelo de capacidades:

| Estado efetivo | leitura | configurar | agendar (público e equipe) | cancelar futura | assinatura | lgpd |
|---|---|---|---|---|---|---|
| `pendente` (S9) | sim | **sim** | **não** | sim | sim | sim |
| `em_teste`, `ativa`, `em_carencia`, `cancelada` dentro do prazo | sim | sim | sim | sim | sim | sim |
| `suspensa`, `encerrada` ou suspensão manual | sim | não | não | sim (notifica) | sim | sim |

Em `pendente`, **reservas da equipe também ficam bloqueadas**. Isso evita custo de mensagem da Meta para salão sem assinatura autorizada e mantém a regra simples: só agenda quem tem assinatura em vigor. Marcar status passado conta como `cancelar` (permitido). Troca de senha e perfil próprio ficam fora da política (não são operação do salão). Ajuste pedido em E6.4.

### Demais suposições
S2, S4–S11 e S14–S18: sem objeção técnica. Observações:
- S7: os limites ficam por env com os padrões propostos. O IP vem de `X-Forwarded-For` só quando `TRUSTED_PROXY_HOPS > 0` (decisão de E4.2; impacto DevOps).
- S11: modelado como coluna `salao.suspenso_manual_em timestamptz null`, separada do estado da assinatura.
- S14: aprovada. A auditoria é append-only também no banco (ver DBA).

## 6. Verificação das invariantes (onde cada uma é garantida no backlog)

| Invariante | Aplica-se | Como é atendida | Itens |
|---|---|---|---|
| Escopo por salão no servidor | Sim | `TenantContext` vindo da sessão; repositórios exigem contexto; lint proíbe Prisma fora dos repositórios; outro salão → 404; fábricas de dois salões | E0.5 (base), E1.2, E2.*, E3.*, E5.1, E7.3; testes de isolamento em cada item |
| Exclusion constraint | Sim | `btree_gist` + `EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, ocupado_ate,'[)') WITH &&) WHERE status IN (...)` em migração SQL; violação `23P01` traduzida em "horário indisponível" | E0.4, E3.2 (concorrência), E3.4 (encaixe), E3.5 (remarcação) |
| UTC + fuso do salão | Sim | `timestamptz`; fuso IANA no salão; disponibilidade calculada no fuso local com teste de DST; formatadores com fuso | E0.4, E0.8, E3.1, E3.3, E2.5 |
| Adaptadores de integração | Sim | Portas + simulados (E0.6); reais: e-mail/Turnstile (E0.6), MP (E6.6), WhatsApp (E7.2); seleção por env com falha na inicialização; nenhum dado de cartão | E0.6, E6.6, E7.2 |
| Soft delete / anonimização | Sim | `ativo` em serviço e profissional; anonimização com nome e telefone nulos, `anonimizada_em`, limpeza de destinatário/payload no log de mensagens | E0.4, E2.1, E2.2, E5.2 |
| Salão suspenso somente leitura | Sim | Capacidade declarada em `defineAcao` (E0.5); política real em E6.4; exceção de cancelamento com aviso | E0.5, E6.3, E6.4 |
| Idempotência de webhooks e mensagens | Sim | `webhook_evento` com chave de dedupe única e efeito idempotente por recurso do provedor; mensagem com chave única `reserva:tipo:revisao` | E6.2, E6.3, E7.1, E8.3 |
| Auditoria do super admin | Sim | `registrarAuditoria` na mesma transação da mutação; tabela append-only (trigger/REVOKE) | E8.1, E1.5, E8.2, E8.3 |
| Clientes sem conta, E.164 | Sim | `UNIQUE(salao_id, telefone_e164)`; `libphonenumber-js` | E0.4, E5.1 |
| Snapshot multi-serviço | Sim | Itens com preço/duração snapshot; elegibilidade = faz todos os serviços | E3.1, E3.2, E3.5 |

## 7. Dados e infraestrutura: acionar DBA e DevOps

**DBA: impacto alto, acionar.** Revisar:
- **E0.4** (principal): modelo completo; constraint de exclusão com expressão e lista explícita de status; `ocupado_ate` com snapshot do buffer; CHECKs; `reserva.revisao`; `UNIQUE(salao_id, telefone_e164)` com anonimização (telefone nulo não conflita); tabelas `sessao`, `email_log`, `rate_limit_janela`, `salao_slug` (tabela única de slugs atuais e históricos, unicidade global); índices por `salao_id`; dinheiro em centavos `int`; enums.
- **E0.5**: estratégia de banco de teste por worker do Vitest (template database + `CREATE DATABASE … TEMPLATE`) para testes paralelos de concorrência.
- **E0.7**: schema `pgboss` separado do `public` gerido pelo Prisma (sem drift em `migrate dev`).
- **E3.2**: tradução de `23P01` e nível de isolamento da transação; índice para a consulta de disponibilidade (`profissional_id, inicio`).
- **E4.2**: tabela de janelas de rate limit, upsert atômico e limpeza periódica.
- **E5.2**: anonimização e limpeza do log de mensagens.
- **E6.2/E6.3**: chave de dedupe de `webhook_evento` e idempotência de efeitos por `pagamento_id`.
- **E7.1**: `UNIQUE(chave_idempotencia)` e índice de mensagens pendentes.
- **E8.1**: append-only no banco (trigger que rejeita UPDATE/DELETE em `auditoria`).
- **E9.2**: seed idempotente (upsert por chaves naturais).

**DevOps: impacto alto, acionar.** Revisar:
- **E0.1** (scripts e configuração de Vitest/Playwright), **E0.2** (Dockerfile multi-stage, compose, entrypoint de migração, stub do worker, `.env.example`), **E0.3** (CI com Postgres de serviço com `btree_gist` (a imagem oficial já inclui contrib), cobertura, Playwright com app + worker + banco migrado e semeado).
- **E0.6, E6.6, E7.2**: variáveis de ambiente e falha na inicialização no modo real.
- **E0.7**: SIGTERM e encerramento gracioso no container do worker.
- **E4.2**: `TRUSTED_PROXY_HOPS` e origem do IP atrás de proxy.
- **E4.4**: execução do E2E na CI.
- **E9.3**: README (principal responsável).

## 8. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Adiamento de cobrança não suportado pelo MP (S12) | CA 9 no modo real | Simulado cobre o CA; falha explícita no real; spike em sandbox (E6.6); pergunta P2 |
| Formato de notificação do MP sem ID único de evento | Webhook duplicado aplica efeito 2× | Dedupe por `x-request-id`/`id` da notificação **e** idempotência do efeito por recurso (`pagamento_id` aplicado uma vez) (ajuste E6.2) |
| Validação de origem do MP (`x-signature`, HMAC com `data.id`, `x-request-id`, `ts`) | Eventos forjados | E6.6 implementa e testa com segredo certo/errado; E6.2 sempre consulta o provedor (RN-4) |
| Buffer violado sob concorrência | Reserva sem intervalo | `ocupado_ate` na constraint (decisão §1.3) |
| Teste de concorrência instável na CI | Gate intermitente | Banco isolado por worker; `Promise.all` com N conexões reais; assertiva exata de 1 sucesso |
| Cobertura ≥ 90% com UI | Gate | Lógica em `src/server/**` e `src/domain/**` (testável); componentes com teste de componente (Vitest + Testing Library); páginas finas |
| Custo por mensagem da Meta | Financeiro | `pendente` não agenda (S13 ajustada); limite por número (E4.2); registro em README (E9.3) |
| Esquecer a guarda de suspensão numa ação nova | Salão suspenso opera | `defineAcao` exige `capacidade` (tipo obrigatório); E6.4 tem teste que percorre o registro de ações e falha se alguma mutação não declarar capacidade |
| Mensagem perdida por falha da fila pós-commit | Cliente sem confirmação | Outbox: registro `pendente` gravado com a reserva; reconciliação reenfileira (E7.1) |
| Envio duplicado após queda do worker durante a chamada ao provedor | Mensagem em dobro | Estado `enviando` com reivindicação atômica; `enviando` vencido vira `falhou` (`resultado_incerto`), sem reenvio automático (E7.1, parecer DBA) |

## 9. Estratégia de testes (aplicada a todas as issues)

- **Unitários (Vitest):** funções puras de disponibilidade (E3.1), slug (E1.1), telefone (E5.1), máquina de status (E3.5), máquina de assinatura (E6.3), formatadores (E0.8), permissões (E1.2), detecção de encaixe (E3.4), adaptadores reais contra servidor HTTP local de stub (E0.6, E6.6, E7.2).
- **Integração com PostgreSQL real:** isolamento entre salões (E0.5 e cada item com dados de tenant), constraint e concorrência (E0.4, E3.2, E3.4, E3.5), permissões por papel (E1.2, E2.3, E2.4, E3.3–E3.5, E5.1, E6.5), webhooks e máquina de assinatura (E6.1–E6.4), fila e worker com pg-boss real (E0.7, E7.1), auditoria (E8.1–E8.3), seed (E9.2).
- **Playwright (viewport 375×812):** fluxo público (E4.4), teclado e a11y (E0.8, E4.1, E9.1).
- **Cobertura:** cada issue mantém ≥ 90% de linhas no comando oficial (gate padrão). Componentes React com lógica recebem teste de componente. Exclusões só as do `CLAUDE.md`, com comentário.

## 10. Perguntas ao usuário (não bloqueiam a publicação; registrar como pendência nas issues indicadas)

**P1 — Chave de idempotência das mensagens (S3; issues E7.1, E3.5, E0.4).** O `CLAUDE.md` diz "reserva + tipo de evento".
- (a) **Recomendado:** `reserva + tipo + revisão`. Cada remarcação legítima gera uma mensagem; repetições não duplicam; mensagens pendentes obsoletas são substituídas. O líder atualiza a frase do invariante.
- (b) Literal: no máximo uma mensagem de remarcação por reserva; remarcações seguintes não notificam a cliente.
- (c) Literal com sobrescrita: uma linha por reserva+tipo, reaproveitada a cada remarcação. Perde o histórico de tentativas por remarcação e complica a auditoria.

**P2 — Extensão de teste no Mercado Pago real (S12; issues E6.6, E8.2).**
- (a) **Recomendado:** o adaptador real tenta adiar a próxima cobrança e falha explicitamente se o provedor não refletir a mudança; o simulado cumpre o CA 9; validar em sandbox quando houver credenciais.
- (b) No modo real, a extensão altera só a data local e a cobrança do MP segue o calendário original (o salão pode ser cobrado durante o "teste estendido"). Não recomendado.
- (c) Remover a extensão de teste do modo real até haver confirmação do MP.

## 11. Ajustes pedidos ao analista (conteúdo do spec.md)

| Chave | Mudança pedida |
|---|---|
| E0.2 | Incluir no escopo: bootstrap do Prisma (`prisma/schema.prisma` só com datasource/generator, `prisma.config.ts`), passo `prisma migrate deploy` no entrypoint e stub de `src/worker/main.ts` (substituído em E0.7). Validação do env com zod em `src/server/env.ts`. |
| E0.3 | CA-3 passa a usar um teste de integração mínimo (conexão + `SELECT 1`); não depende de E0.4. |
| E0.4 | (1) Constraint por expressão `tstzrange(inicio, ocupado_ate, '[)')`, com lista explícita de status ativos; `ocupado_ate = fim + intervalo vigente` (snapshot); CHECKs de ordem. (2) Adicionar `reserva.revisao`, `reserva.chave_requisicao` (único por salão; idempotência de duplo envio, E3.2 RN-6), `salao.suspenso_manual_em`, tabelas `sessao`, `email_log`, `rate_limit_janela`; slug em tabela única `salao_slug` (atuais + históricos), conforme o DBA. (3) RN-8: chave de mensagem = `reserva:tipo:revisao`; webhook com chave de dedupe + `pagamento_id` aplicado único. (4) Auditoria append-only também no banco. (5) Incluir um CA: com intervalo de 15 min, reserva 10:00–10:30 (`ocupado_ate` 10:45) e outra 10:30–11:00 do mesmo profissional → rejeitada. |
| E0.5 | Incluir `defineAcao({ papeis, capacidade }, handler)` com política de operação plugável (padrão: permite) e um CA: "toda ação mutável registrada declara capacidade" (teste que percorre o registro). Incluir lint `no-restricted-imports` do cliente Prisma. |
| E0.6 | Listar a superfície completa da porta MP (inclui `adiarProximaCobranca`, `consultarPagamento`, `validarWebhook`); e-mail simulado grava em `email_log`; criar `src/config/plano.ts` como fonte única de preço e dias de teste. Fixar o real de e-mail como SMTP (`nodemailer`). |
| E1.1 | Dependência explícita de E1.2 (CA-6 usa o login). |
| E2.4 | CA-3 depende do motor de disponibilidade: mover para E3.1 (já coberto por E3.1 CA-5) ou reescrever como "o bloqueio de salão é persistido cobrindo 00:00–24:00 local em UTC". |
| E2.5 | CA-4 (grade 30 min refletida na disponibilidade) mover para E3.1 ou reescrever como persistência e validação da grade. Ver também o ajuste de slug abaixo. |
| E3.2 | RN-6 decidida: chave de requisição (UUID gerado ao renderizar o formulário) gravada em `reserva.chave_requisicao`, com `UNIQUE(salao_id, chave_requisicao)`; reenvio retorna a mesma reserva. Grava `ocupado_ate` com o intervalo vigente. Adicionar CA: duplo envio com a mesma chave → 1 reserva. RN-5 (A-1): o registro da mensagem é gravado na transação da reserva e o job vai à fila após o commit; CA-4 passa a "fila indisponível → reserva salva e mensagem `pendente` registrada, enviada depois pela reconciliação". |
| E3.4 | Rota própria `/painel/agenda/nova` (sem depender de E3.3). Dependências: E3.2 e E4.3 (consentimento declarado). |
| E3.5 | RN-2: decidido manter o snapshot dos serviços inalterados e gravar snapshot novo só para serviços adicionados; `ocupado_ate` recalculado com o intervalo vigente. |
| E6.2 | RN-2/RN-6: dedupe por identificador da notificação (`id` do corpo ou `x-request-id`) **e** efeito idempotente por recurso (um `pagamento_id` aprovado estende o período uma única vez, ainda que chegue em notificações diferentes). |
| E6.4 | Dependência de E4.1 (estado "agendamento indisponível" da página pública). Substituir a regra binária pela tabela de capacidades do §5 (S13): em `pendente`, configuração permitida e reservas (públicas e da equipe) bloqueadas. CA novo: salão `pendente` → equipe não cria reserva. |
| E7.1 | Estados: `pendente`, `enviada`, `falhou`, `nao_enviada` (sem consentimento ou anonimizada), `substituida`, `cancelada_anonimizacao`. Regra de substituição (§5, S3). Parâmetros do template lidos no envio. Estado intermediário `enviando` (reivindicação atômica; vencido → `falhou` com `resultado_incerto`). Outbox (A-1): registro `pendente` com chave única (`ON CONFLICT DO NOTHING`) gravado **na transação** da reserva, remarcação ou cancelamento, junto com a substituição de pendentes obsoletas; job pg-boss enviado após o commit. Reconciliação periódica reenfileira `pendente` sem job ativo há mais de N min (não deriva eventos do estado das reservas). RN-4 inalterada: o envio e suas falhas nunca alteram a reserva. CA novo: remarcação N+1 antes do envio da N → só a N+1 é enviada. CA novo: fila indisponível no commit → mensagem `pendente` existe e é enviada após a reconciliação. |
| E3.5 | RN-3: o registro da mensagem de remarcação/cancelamento é gravado na mesma transação da alteração (outbox, E7.1). |
| E2.5 | Remover do escopo a resposta 301 do slug antigo (passa a E4.1); E2.5 mantém a troca de slug e o histórico em `salao_slug`. CA-1 reescrito: "o slug antigo fica registrado como histórico e o novo como atual". |
| E4.1 | RN-6: incluir no escopo a resolução de slug atual/histórico com 301 (vinda de E2.5) e o CA correspondente. |
| E8.1 | Remover do escopo a tela de consulta da auditoria (passa a E8.3); E8.1 fica com serviço, transação e append-only. |
| E8.3 | Incluir no escopo a tela de consulta da auditoria com filtros (salão, ator, ação, período) e o CA: "o super admin filtra por salão e vê as ações de suspensão e reenvio". |
| E1.5 | Escopo: criação do super admin por `garantirSuperAdmin()` + script `superadmin:criar`, reutilizado pelo seed (E9.2). |
| E7.3 | Alinhar rótulos aos estados de E7.1 (incluir "substituída" ou ocultá-la). |
| E9.1 | Preço lido de `src/config/plano.ts` (E0.6). |

## 12. Tarefas desta demanda (D-001)

| Tarefa | Responsável | Depende de | Arquivos sob posse | Entregável / critério de conclusão |
|---|---|---|---|---|
| T-1 | analista | — | `docs/demandas/D-001/spec.md` | Ajustes do §11 aplicados; chaves inalteradas |
| T-2 | dba | — (paralela a T-1, T-3) | `docs/demandas/D-001/dba.md` | Parecer sobre os itens do §7 (DBA); divergências que mudem o JSON devolvidas ao arquiteto |
| T-3 | devops | — (paralela a T-1, T-2) | `docs/demandas/D-001/devops.md` | Parecer sobre os itens do §7 (DevOps) |
| T-4 | tester | T-1 | `docs/demandas/D-001/testes.md` | Todo CA de cada item é verificável; mapa CA do PLAN → item (R1) confere com o JSON |
| T-5 | líder | T-1..T-4 | script de publicação (fora do repo de produção) | Issues, sub-issues, "blocked by", labels e campos do Project #3 criados a partir do JSON; perguntas P1/P2 registradas como pendência em E7.1/E3.5/E0.4 e E6.6/E8.2 |

O desenvolvedor não tem tarefa nesta demanda (nada é implementado). Pode revisar, de forma opcional, os tamanhos de E3.1, E3.2, E6.3 e E7.1, os maiores fora da fundação.

## 14. Revisão 1 — consolidação dos pareceres (DBA, DevOps, desenvolvedor)

Fontes: `dba.md` §3, `devops.md` §3 "Ajustes pedidos ao arquiteto", `dev.md` §3. **Todos os ajustes ao JSON foram aceitos**, sem alterar prioridades nem o caminho crítico.

**A-1 (outbox) — aceito.** O §1 descartava "enfileirar no pg-boss dentro da transação" porque uma falha da *fila* desfaria a reserva. A-1 é diferente: na transação entra só um `INSERT` na nossa tabela `mensagem` (`ON CONFLICT DO NOTHING` na chave `reserva:tipo:revisao`), e o `boss.send` acontece depois do commit. Conferência do invariante:
- "Enfileirada depois de salvar a reserva": o job só existe após o commit. O registro `pendente` é o log da intenção, não o envio.
- "Falha de envio nunca altera a reserva": o worker, o adaptador e as tentativas atualizam só `mensagem`/tentativas, nunca `reserva`. Uma falha do `boss.send` após o commit só é registrada; a reconciliação reenfileira.
- Risco residual: um erro no `INSERT` da mensagem desfaria a reserva. Mitigação: o insert não tem conflito possível (`ON CONFLICT DO NOTHING`), só depende de FKs já validadas na mesma transação. Ele ainda é coberto por teste de integração. A substituição das pendentes obsoletas (S3) fica atômica com a remarcação.
- Ganhos: nenhuma confirmação é perdida; a reconciliação não precisa derivar eventos do estado das reservas (o que geraria mensagens para reservas do seed e antigas).

**Ciclo E8.1 ↔ E1.5:** resolvido movendo `src/app/admin/auditoria/**` para E8.3 (que já depende de E1.5).

**Mudanças de dependência:** E3.4 +E4.3; E6.4 +E4.1; E9.3 +E4.2. Related: E4.2 +E3.2; E8.1 +E8.3. Support: E3.1 e E3.5 +dba.

**Revalidação:** 55 chaves = itens do spec; sem ciclos; nenhum P0 bloqueado por P1; caminho crítico mantido em 14 ondas; todo `@` em deliverables está entre crases.

## 15. Revisão 2 — pedidos do tester (T-4, `testes.md`)

**Dependências acrescentadas (todas aceitas):**
- E3.2 += E4.3 (DEF-M4). O consentimento é gravado na transação da reserva, e `registrar.ts` vem de E4.3. E4.3 é P0, então P0 → P0.
- E9.4 += E9.1 (DEF-M12). A validação final cobre a página inicial exigida em "Interface". Isso deixa um P1 bloqueado por um P2. É aceito porque E9.4 é o fechamento da v1; E9.1 é pequeno (S) e roda desde a onda 5. Sai de `related`.
- E8.3 += E8.2 (DEF-M11). CA-4 consulta a auditoria das suspensões. P1 → P1.
- E1.4 += E3.3 (DEF-M5). CA-2 "vê apenas a própria agenda". P1 → P1.

Efeito no grafo: E1.4 passa para a onda 9; E6.4 continua na 12 (já esperava E3.5, da onda 11). E8.3 continua na onda 9 sem efeito no caminho crítico. O caminho crítico continua em 14 ondas, e E3.2 continua na onda 9, porque E4.3 está na 5.

**Parecer sobre E6.3 RN-6 (`pago_ate = max(pago_ate, data_pagamento) + 1 mês`, uma vez por `pagamento_id`): confirmada, com quatro esclarecimentos para o analista.**
1. Na primeira cobrança após o teste, `pago_ate` ainda é nulo. A base passa a ser `max(coalesce(pago_ate, fim_teste), data_pagamento)`. Assim, um pagamento antecipado não encurta o período grátis.
2. "+1 mês" é mês civil calculado em UTC (`addMonths`, com o dia limitado ao fim do mês: 31/01 → 28 ou 29/02). Isso evita dias perdidos ou duplicados.
3. O `max` torna seguros os eventos fora de ordem e os pagamentos de regularização. Um pagamento em carência ou suspensão (data > `pago_ate`) reinicia o ciclo a partir do pagamento. Isso pode dar ao salão alguns dias a mais do que o calendário do MP. A divergência é aceita porque favorece o cliente, e o MP continua sendo a fonte da cobrança.
4. A idempotência fica no banco: `pagamento_id` único na tabela de pagamentos aplicados (ou em `assinatura_transicao`), dentro da mesma transação que atualiza `pago_ate`. Isso alinha o RN com E6.2 e o parecer do DBA.

Revalidação: 55 chaves batem com o spec; sem ciclos; nenhum P0 bloqueado por P1.

## 13. Backlog estruturado

## §16 Ajuste do líder (pós-Rodada 2)

- E9.1 passa de P2 para P1, acatando a observação O-7 do tester: E9.4 (P1) depende de E9.1, e a página inicial está na lista mínima de telas do PLAN (seção Interface).

```json backlog
{
  "E0": {
    "blocked_by": [],
    "roles": [
      "arquiteto"
    ],
    "support": [
      "devops",
      "dba",
      "desenvolvedor"
    ],
    "priority": "P0",
    "size": "XL",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "Sub-issues E0.1–E0.8 concluídas e aprovadas pelo tester",
      "Clone limpo sobe app, worker e postgres via docker compose e roda a suíte com o gate de cobertura de linhas ≥ 90%"
    ]
  },
  "E0.1": {
    "parent": "E0",
    "blocked_by": [],
    "roles": [
      "devops"
    ],
    "support": [
      "desenvolvedor",
      "arquiteto"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement",
      "documentation"
    ],
    "deliverables": [
      "package.json (npm, engines Node 24 LTS, scripts dev/build/lint/typecheck/test/test:unit/test:integration/test:coverage/test:e2e) e package-lock.json",
      "tsconfig.json estrito, next.config.ts (App Router), eslint.config.mjs",
      "vitest.config.ts com projetos unit e integration, coverage.provider v8, include src/**, thresholds.lines 90 e exclusões comentadas",
      "playwright.config.ts com projeto mobile Chromium 375x812 (isMobile, hasTouch) e webServer via next start",
      "src/app/page.tsx provisória, teste unitário de fumaça e e2e/smoke.spec.ts",
      "CLAUDE.md: bloco 'Comandos e cobertura' com os comandos reais",
      ".nvmrc (Node 24) como fonte única da versão para Docker e CI",
      "`@testing-library/react` + jsdom para *.test.tsx; projeto integration com passWithNoTests até existir teste de banco"
    ]
  },
  "E0.2": {
    "parent": "E0",
    "blocked_by": [
      "E0.1"
    ],
    "roles": [
      "devops"
    ],
    "support": [
      "dba",
      "desenvolvedor"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement",
      "documentation"
    ],
    "deliverables": [
      "Dockerfile multi-stage usado por app e worker",
      "docker-compose.yml com app, worker e postgres (imagem oficial ≥ 16, volume, healthcheck, depends_on healthy)",
      "docker/entrypoint.sh (exec; check-env; prisma migrate deploy só no app) e GET /api/health com SELECT 1; worker com depends_on app service_healthy",
      "prisma/schema.prisma (datasource e generator) e prisma.config.ts (bootstrap do Prisma)",
      "src/worker/main.ts stub (heartbeat) e script npm worker",
      "src/server/env.ts com validação zod do ambiente",
      ".env.example comentado, com adaptadores simulados por padrão e credenciais reais vazias",
      "Worker compilado para JS no build da imagem; imagem não root com TZ=UTC",
      "Variáveis APP_URL, TEST_DATABASE_URL e POSTGRES_PORT",
      "README.md inicial: Executar com Docker e Testes",
      "Teste unitário que confere .env.example contra o schema de src/server/env.ts"
    ]
  },
  "E0.3": {
    "parent": "E0",
    "blocked_by": [
      "E0.2"
    ],
    "roles": [
      "devops"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      ".github/workflows/ci.yml com jobs lint, typecheck, build, test:coverage (serviço postgres + migrate deploy) e test:e2e",
      "Artefatos: relatório de cobertura e traces do Playwright",
      "tests/integration/smoke-db.test.ts (SELECT 1)",
      "Links de runs (PR verde e PR com cobertura < 90% falhando) registrados pelo tester",
      "Job docker build (sem push) e docker compose config",
      "Pendência manual registrada: proteção da branch main exigindo os checks"
    ]
  },
  "E0.4": {
    "parent": "E0",
    "blocked_by": [
      "E0.2"
    ],
    "related": [
      "E3.2",
      "E7.1",
      "E6.2"
    ],
    "roles": [
      "dba"
    ],
    "support": [
      "arquiteto",
      "desenvolvedor"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "prisma/schema.prisma com as entidades centrais do PLAN mais sessao, email_log, rate_limit_janela, salao_slug (atuais + históricos), reserva.revisao, reserva.ocupado_ate, reserva.chave_requisicao, salao.suspenso_manual_em",
      "prisma/migrations/*_init/migration.sql",
      "prisma/migrations/*_reserva_exclusion/migration.sql: CREATE EXTENSION btree_gist; EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, ocupado_ate, '[)') WITH &&) WHERE status IN ('confirmado','concluido','nao_compareceu'); CHECKs de ordem",
      "Triggers append-only em auditoria (UPDATE/DELETE por linha, TRUNCATE por instrução)",
      "tests/integration/db/reserva-exclusion.test.ts e tests/integration/db/cliente-unicidade.test.ts (CA-2..CA-6 e caso com intervalo)",
      "docs/demandas/D-NNN/dba.md com parecer do DBA",
      "FKs compostas (salao_id, id) e onDelete: Restrict explícito em todas as relações",
      "Exclusion int4range da jornada (profissional_id, dia_semana, int4range(inicio_min, fim_min))",
      "CHECKs de cliente anonimizada e de formato E.164",
      "Índices parciais únicos: gestor por salão, slug atual, assinatura vigente, webhook com origem válida",
      "Teste de ausência de drift (migrate dev sem gerar nova migração)",
      "tests/support/db.ts mínimo (globalSetup: base de teste, migrate deploy, limpeza)",
      "Schema da v1 congelado após aprovação; migrações posteriores são próprias de cada item e serializadas pelo líder"
    ]
  },
  "E0.5": {
    "parent": "E0",
    "blocked_by": [
      "E0.4"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "arquiteto",
      "dba",
      "tester"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/tenant/context.ts (TenantContext: usuário, papel, salaoId, profissionalId)",
      "src/server/tenant/define-acao.ts (defineAcao com papeis, capacidade e política de operação plugável, padrão permitir)",
      "src/server/repos/** limitado aos agregados do CA-1 (repositórios exigem TenantContext; recurso de outro salão → NaoEncontrado)",
      "Regra ESLint no-restricted-imports para o cliente Prisma fora de src/server/repos, src/worker e prisma/seed.ts",
      "tests/support/db.ts evolui o harness de E0.4 para banco por worker do Vitest via template (com schema pgboss); tests/support/factories.ts (dois salões completos), tests/support/auth.ts",
      "tests/integration/tenant/isolamento.test.ts (CA-1..CA-3)",
      "Contextos TenantContext, PublicoContext (slug), SistemaContext e AdminContext; erros AcessoNegado/NaoEncontrado",
      "src/server/repos/transacao.ts (unidade de trabalho compartilhada entre repositórios)",
      "Núcleo de defineAcao testável sem next/headers e exigirContexto() para Server Components",
      "Convenção de arquivos de ação *.acao.ts carregados por import.meta.glob no teste de registro; lint libera tests/**"
    ]
  },
  "E0.6": {
    "parent": "E0",
    "blocked_by": [
      "E0.4"
    ],
    "related": [
      "E6.6",
      "E7.2"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "devops"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/integrations/{email,whatsapp,mercadopago,turnstile}/port.ts",
      "Adaptadores simulados dos quatro (e-mail grava em email_log; MP com disparo de eventos e adiamento; WhatsApp com falha forçável; Turnstile com token fixo documentado)",
      "Adaptadores reais: e-mail SMTP (nodemailer) e Turnstile (siteverify via fetch)",
      "src/server/integrations/registry.ts (seleção por EMAIL_ADAPTER, WHATSAPP_ADAPTER, MP_ADAPTER, TURNSTILE_ADAPTER; falha na inicialização nomeando a variável ausente)",
      "src/config/plano.ts (7900 centavos/mês, 30 dias de teste)",
      ".env.example atualizado; testes com servidor HTTP local de stub",
      "MP simulado com estado em tabela própria (migração do item) e rota /dev/mp-checkout inativa no modo real",
      "WhatsApp simulado registra as chamadas em tabela e permite falha forçada",
      "src/server/integrations/mercadopago/real.ts e whatsapp/real.ts criados como stubs NaoImplementado ligados ao registry.ts (E6.6 e E7.2 os substituem)"
    ]
  },
  "E0.7": {
    "parent": "E0",
    "blocked_by": [
      "E0.4"
    ],
    "related": [
      "E7.1",
      "E6.3"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "devops",
      "dba"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/worker/main.ts (substitui o stub: bootstrap pg-boss no schema pgboss, registro de handlers, SIGTERM gracioso)",
      "src/server/queue/client.ts (enfileirar com singletonKey, uso pós-commit, jobs agendados)",
      "src/worker/handlers/registry.ts e política de retry (retryLimit, retryDelay, retryBackoff) por env",
      "tests/integration/worker/*.test.ts com pg-boss real (CA-1..CA-3)",
      "stop_grace_period 30s no serviço worker do compose e teste de SIGTERM com job em andamento",
      "Handlers assinatura-prazos.ts, whatsapp-reserva.ts e reconciliar-mensagens.ts criados como stubs registrados (E6.3 e E7.1 os preenchem)"
    ]
  },
  "E0.8": {
    "parent": "E0",
    "blocked_by": [
      "E0.1"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement",
      "accessibility"
    ],
    "deliverables": [
      "src/app/globals.css com tokens terrosos/nude e contraste WCAG AA; fontes serifada e sem serifa via next/font",
      "src/components/ui/** (Button, Field, Select, Checkbox, ConfirmDialog com <dialog> nativo, Alert, EmptyState, DataList, SlotGrid)",
      "src/components/layout/{PublicLayout,PanelLayout,AdminLayout}.tsx com navegação por papel e menu móvel",
      "src/lib/format.ts (BRL, data e hora no fuso do salão) com testes unitários",
      "e2e/a11y-base.spec.ts (teclado, foco do diálogo, 375 px sem rolagem horizontal, `@axe-core/playwright`)",
      "src/app/dev/componentes/page.tsx (vitrine para E2E, 404 em produção)",
      "src/config/navegacao.ts com todas as rotas da v1"
    ]
  },
  "E1": {
    "blocked_by": [],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "Sub-issues E1.1–E1.5 concluídas e aprovadas",
      "CA 8 do PLAN (recuperação e convite com e-mail simulado) evidenciado"
    ]
  },
  "E1.1": {
    "parent": "E1",
    "blocked_by": [
      "E1.2",
      "E0.6"
    ],
    "related": [
      "E6.1"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/(publico)/cadastro/** e src/app/(publico)/confirmar-email/**",
      "src/server/auth/cadastro.ts e src/server/auth/confirmacao-email.ts (token com hash, 24 h, uso único, reenvio)",
      "src/lib/slug.ts com testes unitários (acentos, colisão -2/-3, fallback)",
      "tests/integration/auth/cadastro.test.ts (CA-1..CA-6)"
    ]
  },
  "E1.2": {
    "parent": "E1",
    "blocked_by": [
      "E0.5",
      "E0.8"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "arquiteto",
      "tester"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/auth/{sessao.ts,senha.ts,permissoes.ts} (sessão em tabela, cookie httpOnly/SameSite=Lax/Secure, argon2id)",
      "src/proxy.ts (Next 16; ou middleware.ts conforme a versão fixada em E0.1) só com verificação otimista; autorização em defineAcao/exigirContexto",
      "src/app/(publico)/entrar/** e logout; redirecionamento por papel",
      "tests/unit/auth/permissoes.test.ts (matriz) e tests/integration/auth/sessao-rbac.test.ts (CA-1..CA-5, 403 por papel)"
    ]
  },
  "E1.3": {
    "parent": "E1",
    "blocked_by": [
      "E1.2",
      "E0.6"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P1",
    "size": "S",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/(publico)/recuperar-senha/** e src/app/(publico)/redefinir-senha/**",
      "src/server/auth/recuperacao-senha.ts (token com hash, 1 h, uso único, invalida anteriores, encerra sessões)",
      "tests/integration/auth/recuperacao-senha.test.ts (CA-1..CA-4)"
    ]
  },
  "E1.4": {
    "parent": "E1",
    "blocked_by": [
      "E2.2",
      "E0.6",
      "E3.3"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/auth/convite.ts (7 dias, uso único, reenvio invalida anterior, capacidade configurar)",
      "src/app/(publico)/convite/[token]/** (aceite com definição de senha)",
      "Ação de convidar/reenviar no cadastro do profissional",
      "tests/integration/auth/convite.test.ts (CA-1..CA-4)"
    ]
  },
  "E1.5": {
    "parent": "E1",
    "blocked_by": [
      "E1.2",
      "E8.1"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "devops",
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/auth/superadmin.ts (garantirSuperAdmin() idempotente por SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD) e script npm superadmin:criar; chamado pelo seed em E9.2",
      "src/server/auth/totp.ts (otpauth, segredo cifrado com chave de env, janela ±1) e cadastro obrigatório no primeiro login",
      "src/app/admin/entrar/** (login em duas etapas) e guarda do painel admin",
      "Auditoria de login e falha de TOTP via E8.1",
      "tests/unit/auth/totp.test.ts (relógio controlado) e tests/integration/auth/superadmin.test.ts (CA-1..CA-4)"
    ]
  },
  "E2": {
    "blocked_by": [],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "Sub-issues E2.1–E2.5 concluídas e aprovadas",
      "CA 1 do PLAN (configuração sem acesso cruzado) evidenciado por testes de isolamento"
    ]
  },
  "E2.1": {
    "parent": "E2",
    "blocked_by": [
      "E2.2"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/painel/servicos/** (lista, criar, editar, ativar/desativar, vínculo com profissionais)",
      "src/server/servicos/*.ts com schemas zod (preço em centavos ≥ 0, duração > 0 múltipla de 5)",
      "tests/integration/servicos/*.test.ts (CA-1..CA-5, soft delete, snapshot, isolamento)"
    ]
  },
  "E2.2": {
    "parent": "E2",
    "blocked_by": [
      "E1.2"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/painel/profissionais/** (lista, criar, editar, desativar, 'eu também atendo')",
      "src/server/profissionais/*.ts (recusa de desativação com reservas futuras, revogação de sessões ao desativar)",
      "tests/integration/profissionais/*.test.ts (CA-1..CA-4)"
    ]
  },
  "E2.3": {
    "parent": "E2",
    "blocked_by": [
      "E2.2"
    ],
    "related": [
      "E3.1"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/painel/profissionais/[id]/jornada/** (edição por dia, múltiplos intervalos)",
      "src/server/jornadas/*.ts (validação de intervalos em minutos locais)",
      "tests/unit/jornadas/intervalos.test.ts e tests/integration/jornadas/*.test.ts (CA-1..CA-3)"
    ]
  },
  "E2.4": {
    "parent": "E2",
    "blocked_by": [
      "E2.2"
    ],
    "related": [
      "E3.1"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/painel/bloqueios/** (salão e profissional; profissional só os próprios)",
      "src/server/bloqueios/*.ts (intervalo UTC informado no fuso do salão, aviso de reservas cobertas)",
      "tests/integration/bloqueios/*.test.ts (permissões, escopo, aviso)"
    ]
  },
  "E2.5": {
    "parent": "E2",
    "blocked_by": [
      "E1.2"
    ],
    "related": [
      "E3.1",
      "E4.1"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "dba",
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/painel/configuracoes/** (nome, fuso IANA, grade, antecedência, janela, intervalo, slug)",
      "src/server/salao/configuracoes.ts e troca de slug em salao_slug (atual + histórico, unicidade global)",
      "tests/integration/salao/configuracoes.test.ts e slug-historico.test.ts"
    ]
  },
  "E3": {
    "blocked_by": [],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "arquiteto",
      "dba",
      "tester"
    ],
    "priority": "P0",
    "size": "XL",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "Sub-issues E3.1–E3.5 concluídas e aprovadas",
      "CAs 3 e 4 do PLAN evidenciados (concorrência, encaixe sem sobreposição, permissões)"
    ]
  },
  "E3.1": {
    "parent": "E3",
    "blocked_by": [
      "E2.1",
      "E2.3",
      "E2.4"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "arquiteto",
      "tester",
      "dba"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/domain/availability/** (função pura: grade, antecedência, janela, intervalo, fuso com DST, multi-serviço em sequência)",
      "src/server/disponibilidade/*.ts (consulta de jornadas, bloqueios e ocupação [inicio, ocupado_ate); profissionais elegíveis)",
      "tests/unit/availability/*.test.ts (CA-1..CA-8, DST em America/New_York, relógio controlado)",
      "tests/integration/disponibilidade/*.test.ts (bloqueio de salão no dia, grade alterada)"
    ]
  },
  "E3.2": {
    "parent": "E3",
    "blocked_by": [
      "E3.1",
      "E5.1",
      "E7.1",
      "E4.3"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "dba",
      "tester"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/reservas/criar-reserva.ts (revalidação, upsert de cliente, itens com snapshot, ocupado_ate, chave_requisicao, tradução de 23P01 pelo nome reserva_sem_sobreposicao, registro da mensagem na transação via E7.1 e envio à fila pós-commit)",
      "tests/unit/reservas/montar-itens.test.ts",
      "tests/integration/reservas/criar-reserva.test.ts e concorrencia.test.ts (10 requisições paralelas → exatamente 1 reserva)"
    ]
  },
  "E3.3": {
    "parent": "E3",
    "blocked_by": [
      "E2.3",
      "E2.4"
    ],
    "related": [
      "E3.4",
      "E5.2",
      "E7.3"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P1",
    "size": "L",
    "labels": [
      "enhancement",
      "accessibility"
    ],
    "deliverables": [
      "src/app/painel/agenda/** (visão diária e semanal, filtro por profissional, detalhe da reserva)",
      "src/server/agenda/consultar.ts (gestor: todos; profissional: só a própria; fuso do salão)",
      "tests/integration/agenda/permissoes.test.ts (CA-1..CA-3) e teste de componente/e2e de teclado e 375 px (CA-4)"
    ]
  },
  "E3.4": {
    "parent": "E3",
    "blocked_by": [
      "E3.2",
      "E4.3"
    ],
    "related": [
      "E3.3"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/painel/agenda/nova/** (formulário de reserva manual com diálogo de encaixe)",
      "src/server/reservas/reserva-equipe.ts (detecção de encaixe, confirmarEncaixe, consentimento declarado, início no passado recusado)",
      "tests/unit/reservas/encaixe.test.ts e tests/integration/reservas/reserva-equipe.test.ts (CA-1..CA-5)"
    ]
  },
  "E3.5": {
    "parent": "E3",
    "blocked_by": [
      "E3.3",
      "E3.4"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester",
      "dba"
    ],
    "priority": "P1",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/reservas/{remarcar,cancelar,marcar-status}.ts (revisao++, ocupado_ate recalculado, transições S2, capacidade cancelar)",
      "Ações no detalhe da reserva em src/app/painel/agenda/**",
      "tests/unit/reservas/status.test.ts e tests/integration/reservas/{remarcar,cancelar,status}.test.ts (CA-1..CA-6)"
    ]
  },
  "E4": {
    "blocked_by": [],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement",
      "accessibility"
    ],
    "deliverables": [
      "Sub-issues E4.1–E4.4 concluídas e aprovadas",
      "CAs 2 e 10 do PLAN evidenciados"
    ]
  },
  "E4.1": {
    "parent": "E4",
    "blocked_by": [
      "E3.2",
      "E4.3"
    ],
    "related": [
      "E2.5",
      "E4.2",
      "E6.4"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement",
      "accessibility"
    ],
    "deliverables": [
      "src/app/[slug]/** (etapas serviços → profissional → horário → dados → confirmação, mobile-first)",
      "src/server/publico/*.ts (dados públicos por slug, reserva pública via criarReserva, estado 'horário indisponível' preservando dados)",
      "tests/integration/publico/*.test.ts (ações do servidor) e teste de teclado",
      "Resolução de slug atual/histórico com redirecionamento permanente (usa salao_slug)"
    ]
  },
  "E4.2": {
    "parent": "E4",
    "blocked_by": [
      "E4.1"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "dba",
      "devops",
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/protecao/rate-limit.ts (janelas em rate_limit_janela, upsert atômico, limites por env, 429)",
      "Limite de 3 reservas futuras por número/salão na reserva pública",
      "Widget Turnstile na etapa de dados e validação no servidor via porta; IP por TRUSTED_PROXY_HOPS",
      "tests/integration/protecao/*.test.ts (CA-1..CA-5)",
      "Contagem de reservas futuras dentro da transação de criar-reserva, após o lock da cliente",
      "Job de limpeza de rate_limit_janela no worker"
    ],
    "related": [
      "E3.2"
    ]
  },
  "E4.3": {
    "parent": "E4",
    "blocked_by": [
      "E0.5",
      "E0.8"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "analista",
      "tester"
    ],
    "priority": "P0",
    "size": "S",
    "labels": [
      "enhancement",
      "documentation"
    ],
    "deliverables": [
      "src/app/termos/page.tsx e src/app/privacidade/page.tsx com texto provisório versionado",
      "src/config/termos.ts (versão vigente) e src/server/consentimento/registrar.ts (origem publico|equipe, data UTC, versão)",
      "tests/integration/consentimento/*.test.ts (CA-1..CA-3)"
    ]
  },
  "E4.4": {
    "parent": "E4",
    "blocked_by": [
      "E4.2",
      "E6.4",
      "E9.2"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester",
      "devops"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement",
      "accessibility"
    ],
    "deliverables": [
      "e2e/reserva-publica.spec.ts (multi-serviço, filtragem de profissionais, horário indisponível, captcha inválido, salão suspenso)",
      "e2e/support/reset-db.ts (banco re-semeado por execução)",
      "Execução verde local e na CI, duas vezes seguidas",
      "Job de E2E na CI com banco próprio e rate limit elevado por env",
      "README: seção de E2E"
    ]
  },
  "E5": {
    "blocked_by": [],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "Sub-issues E5.1 e E5.2 concluídas e aprovadas",
      "CA 7 do PLAN evidenciado"
    ]
  },
  "E5.1": {
    "parent": "E5",
    "blocked_by": [
      "E1.2"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P0",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/lib/telefone.ts (libphonenumber-js, só BR, E.164) com testes unitários extensivos",
      "src/server/clientes/{upsert,buscar,editar}.ts",
      "src/app/painel/clientes/** (lista com busca, detalhe com histórico, edição)",
      "tests/integration/clientes/*.test.ts (CA-1..CA-5, isolamento)"
    ]
  },
  "E5.2": {
    "parent": "E5",
    "blocked_by": [
      "E5.1",
      "E7.1"
    ],
    "related": [
      "E3.3"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "dba",
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/clientes/anonimizar.ts (nome e telefone nulos, anonimizada_em, mensagens pendentes → cancelada_anonimizacao, limpeza de destinatário/payload no log; capacidade lgpd)",
      "Ação com diálogo de confirmação em src/app/painel/clientes/**",
      "tests/integration/clientes/anonimizar.test.ts (CA-1..CA-4)"
    ]
  },
  "E6": {
    "blocked_by": [],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "arquiteto",
      "dba",
      "tester"
    ],
    "priority": "P1",
    "size": "XL",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "Sub-issues E6.1–E6.6 concluídas e aprovadas",
      "CA 5 do PLAN e testes de eventos de assinatura (CA 11) evidenciados com o adaptador local"
    ]
  },
  "E6.1": {
    "parent": "E6",
    "blocked_by": [
      "E1.1",
      "E6.3"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/assinatura/iniciar.ts (assinatura pendente, external_reference = salaoId, redirecionamento ao checkout)",
      "src/app/painel/assinatura/retorno/page.tsx (só dispara consulta ao provedor)",
      "tests/integration/assinatura/iniciar.test.ts (CA-1..CA-4, retorno forjado não muda estado)"
    ]
  },
  "E6.2": {
    "parent": "E6",
    "blocked_by": [
      "E6.1"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "dba",
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/api/webhooks/mercadopago/route.ts",
      "src/server/assinatura/webhook.ts (validação de origem via porta, persistência antes do processamento, dedupe, consulta ao provedor, efeito idempotente por pagamento_id)",
      "tests/integration/assinatura/webhook.test.ts (CA-1..CA-4, 3 entregas em paralelo)"
    ]
  },
  "E6.3": {
    "parent": "E6",
    "blocked_by": [
      "E0.5",
      "E0.7"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "arquiteto",
      "dba",
      "tester"
    ],
    "priority": "P1",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/domain/assinatura/maquina-estados.ts (pendente, em_teste, ativa, em_carencia, suspensa, cancelada, encerrada; relógio injetável)",
      "src/server/assinatura/estado-operacional.ts (estado efetivo com suspensão manual)",
      "src/worker/handlers/assinatura-prazos.ts (job agendado de carência e fim de acesso, idempotente)",
      "tests/unit/assinatura/maquina-estados.test.ts e tests/integration/assinatura/prazos.test.ts (CA-1..CA-6)",
      "Tabela assinatura_transicao (somente inserção) registrando cada transição"
    ]
  },
  "E6.4": {
    "parent": "E6",
    "blocked_by": [
      "E6.3",
      "E3.5",
      "E2.5",
      "E1.4",
      "E4.1"
    ],
    "related": [
      "E4.1",
      "E0.5"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P1",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/assinatura/politica-operacao.ts (tabela de capacidades por estado, plugada em defineAcao)",
      "Página pública 'agendamento indisponível' e faixa de aviso no painel (pendente, em carência com prazo, suspensa, encerrada)",
      "tests/integration/assinatura/modo-suspenso.test.ts (uma verificação por ação bloqueada; teste que percorre o registro de ações; exceção de cancelamento com mensagem enfileirada)"
    ]
  },
  "E6.5": {
    "parent": "E6",
    "blocked_by": [
      "E6.1"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/painel/assinatura/page.tsx (estado, datas, valor, regularizar, cancelar, nova assinatura após encerrada, erro de pagamento)",
      "src/server/assinatura/cancelar.ts (estado só muda após confirmação do provedor)",
      "tests/integration/assinatura/painel.test.ts (CA-1..CA-4)"
    ]
  },
  "E6.6": {
    "parent": "E6",
    "blocked_by": [
      "E0.6"
    ],
    "related": [
      "E6.1",
      "E6.2",
      "E8.2"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "devops",
      "arquiteto"
    ],
    "priority": "P1",
    "size": "L",
    "labels": [
      "enhancement",
      "documentation"
    ],
    "deliverables": [
      "src/server/integrations/mercadopago/real.ts (preapproval: criar com free_trial 30 dias e 79.00 BRL, consultar, cancelar, adiarProximaCobranca com falha explícita, consultar pagamento)",
      "Validação de x-signature (HMAC-SHA256 com data.id, x-request-id e ts) com MP_WEBHOOK_SECRET",
      "tests/unit/integrations/mercadopago-real.test.ts contra servidor HTTP local de stub (CA-1..CA-3)",
      "Roteiro de validação em sandbox (incluindo o spike de S12) documentado para quando houver credenciais"
    ]
  },
  "E7": {
    "blocked_by": [],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "dba",
      "tester"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "Sub-issues E7.1–E7.3 concluídas e aprovadas",
      "CA 6 do PLAN evidenciado"
    ]
  },
  "E7.1": {
    "parent": "E7",
    "blocked_by": [
      "E0.6",
      "E0.7"
    ],
    "related": [
      "E3.2",
      "E3.5",
      "E5.2",
      "E8.3"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "dba",
      "tester"
    ],
    "priority": "P0",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/mensagens/registrar.ts: registro mensagem (estado pendente, chave reserva:tipo:revisao única, ON CONFLICT DO NOTHING) gravado na transação da reserva/remarcação/cancelamento, com substituição de pendentes obsoletas na mesma transação; boss.send com singletonKey após o commit, falha da fila só registrada",
      "src/server/mensagens/reenviar.ts (reenvio de falhou reutilizando registro e chave)",
      "src/worker/handlers/whatsapp-reserva.ts (parâmetros lidos no envio, tentativas registradas, backoff, nao_enviada sem consentimento/anonimizada)",
      "src/worker/handlers/reconciliar-mensagens.ts: reenfileira pendente sem job ativo há mais de N min; marca enviando vencido como falhou (resultado_incerto)",
      "tests/integration/mensagens/*.test.ts (CA-1..CA-6 e substituição)",
      "Estado enviando com reivindicação atômica antes de chamar o adaptador"
    ]
  },
  "E7.2": {
    "parent": "E7",
    "blocked_by": [
      "E0.6"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "devops"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement",
      "documentation"
    ],
    "deliverables": [
      "src/server/integrations/whatsapp/real.ts (Cloud API, template + idioma pt_BR por env, erros temporário × permanente, id da Meta gravado)",
      "docs/whatsapp-templates.md (texto sugerido dos 3 modelos para aprovação)",
      "tests/unit/integrations/whatsapp-real.test.ts contra servidor HTTP local de stub (CA-1..CA-3)"
    ]
  },
  "E7.3": {
    "parent": "E7",
    "blocked_by": [
      "E7.1",
      "E3.3"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P1",
    "size": "S",
    "labels": [
      "enhancement",
      "accessibility"
    ],
    "deliverables": [
      "src/components/agenda/SituacaoMensagens.tsx e indicação de falha na agenda",
      "src/server/mensagens/consultar-por-reserva.ts (escopo de quem vê a reserva)",
      "Teste de componente e tests/integration/mensagens/visibilidade.test.ts (CA-1..CA-3)"
    ]
  },
  "E8": {
    "blocked_by": [],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "dba",
      "tester"
    ],
    "priority": "P1",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "Sub-issues E8.1–E8.3 concluídas e aprovadas",
      "CA 9 do PLAN evidenciado com registros de auditoria"
    ]
  },
  "E8.1": {
    "parent": "E8",
    "blocked_by": [
      "E0.5"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "dba",
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/server/auditoria/registrar.ts (mesma transação da mutação, sem segredos)",
      "tests/integration/auditoria/*.test.ts (CA-1..CA-3, falha forçada desfaz a mutação, append-only no banco)"
    ],
    "related": [
      "E8.3"
    ]
  },
  "E8.2": {
    "parent": "E8",
    "blocked_by": [
      "E1.5",
      "E6.3",
      "E2.5"
    ],
    "related": [
      "E6.6"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P1",
    "size": "L",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/admin/saloes/** (lista com estado, detalhe e edição, suspender/reativar, estender teste)",
      "src/server/admin/saloes.ts (suspenso_manual_em, adiarProximaCobranca via porta, auditoria em cada ação)",
      "tests/integration/admin/saloes.test.ts (CA-1..CA-4)"
    ]
  },
  "E8.3": {
    "parent": "E8",
    "blocked_by": [
      "E1.5",
      "E6.2",
      "E7.1",
      "E8.2"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "src/app/admin/saloes/[id]/assinatura/** (assinatura e eventos de webhook)",
      "src/app/admin/mensagens/** (fila com filtros, tentativas, reenviar falhou; telefone mascarado)",
      "tests/integration/admin/integracoes.test.ts (CA-1..CA-3)",
      "src/app/admin/auditoria/** (consulta do log de auditoria com filtros)"
    ]
  },
  "E9": {
    "blocked_by": [],
    "roles": [
      "tester"
    ],
    "support": [
      "devops",
      "desenvolvedor"
    ],
    "priority": "P1",
    "size": "L",
    "labels": [
      "enhancement",
      "documentation"
    ],
    "deliverables": [
      "Sub-issues E9.1–E9.4 concluídas e aprovadas",
      "CA 11 do PLAN e verificação dos CAs 1–10 com evidências"
    ]
  },
  "E9.1": {
    "parent": "E9",
    "blocked_by": [
      "E0.8",
      "E0.6"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "tester"
    ],
    "priority": "P1",
    "size": "S",
    "labels": [
      "enhancement",
      "accessibility"
    ],
    "deliverables": [
      "src/app/page.tsx (proposta, preço de src/config/plano.ts, 30 dias grátis, cadastro, login, links legais)",
      "Teste de componente e e2e/landing.spec.ts (teclado, 375 px)"
    ]
  },
  "E9.2": {
    "parent": "E9",
    "blocked_by": [
      "E1.5",
      "E6.3",
      "E3.2"
    ],
    "roles": [
      "desenvolvedor"
    ],
    "support": [
      "dba",
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "enhancement"
    ],
    "deliverables": [
      "prisma/seed.ts idempotente (2 salões, um com fuso diferente; gestores confirmados; gestor que atende; vínculos parciais; jornadas com pausas; bloqueios; clientes fictícios E.164; reservas em vários status; assinaturas em estados diferentes; super admin)",
      "tests/integration/seed/seed.test.ts (CA-1..CA-3)"
    ]
  },
  "E9.3": {
    "parent": "E9",
    "blocked_by": [
      "E9.2",
      "E6.6",
      "E7.2",
      "E0.3",
      "E4.2"
    ],
    "roles": [
      "devops"
    ],
    "support": [
      "desenvolvedor",
      "tester"
    ],
    "priority": "P1",
    "size": "M",
    "labels": [
      "documentation"
    ],
    "deliverables": [
      "README.md (pré-requisitos, Docker e sem Docker, migrações e seed, todos os comandos, credenciais de demonstração)",
      "README.md: seção de serviços reais (Mercado Pago, WhatsApp Business Platform com conta, número e 3 modelos, e-mail transacional, Cloudflare Turnstile) com variáveis",
      "README.md: seção de riscos com o custo por mensagem da Meta",
      "Execução em clone limpo registrada pelo tester"
    ]
  },
  "E9.4": {
    "parent": "E9",
    "blocked_by": [
      "E9.3",
      "E4.4",
      "E8.2",
      "E8.3",
      "E5.2",
      "E6.5",
      "E7.3",
      "E1.3",
      "E9.1"
    ],
    "roles": [
      "tester"
    ],
    "priority": "P1",
    "size": "L",
    "labels": [
      "documentation"
    ],
    "deliverables": [
      "docs/demandas/D-NNN/testes.md com evidência de cada um dos 11 CAs do PLAN (teste, comando, saída)",
      "Saída do comando oficial de cobertura com ≥ 90% de linhas e código 0",
      "Link da CI verde no commit final e veredito APROVADO"
    ]
  }
}
```
