# D-001 — Parecer do DBA

Entradas: `PLAN.md`, `CLAUDE.md`, `docs/demandas/D-001/spec.md` (itens E0.4, E0.5, E0.7, E3.2, E4.2, E5.2, E6.2, E6.3, E7.1, E8.1, E9.2) e `docs/demandas/D-001/design.md` (§1, §5, §7, §11 e bloco `json backlog`).
Estado: repositório sem código e sem banco. Nesta demanda não há migração, `EXPLAIN` nem teste executado. Este parecer define regras de dados e critérios de aceite (CAs) verificáveis contra PostgreSQL real, que os itens implementarão.
Base: as decisões do arquiteto em §1.3 (`ocupado_ate`), §5/S1 (lista explícita de status), S3 (`revisao`), S11 (`suspenso_manual_em`) e §11/E0.4 foram **aceitas**. Os pontos abaixo as complementam.

## 1. Parecer por item

### E0.4 — Esquema base e constraint anti-sobreposição (impacto alto): **aprovado, com complementos obrigatórios**

**Constraint (aceita como o arquiteto desenhou):**
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE reserva
  ADD CONSTRAINT reserva_sem_sobreposicao
  EXCLUDE USING gist (profissional_id WITH =, tstzrange(inicio, ocupado_ate, '[)') WITH &&)
  WHERE (status IN ('confirmado','concluido','nao_compareceu'));
ALTER TABLE reserva ADD CONSTRAINT reserva_ordem_chk
  CHECK (fim > inicio AND ocupado_ate >= fim);
```
- Dê nome fixo à constraint (`reserva_sem_sobreposicao`). E3.2 traduz o erro pelo par SQLSTATE `23P01` + nome da constraint, e não por um código genérico do Prisma.
- `tstzrange(...)` é `IMMUTABLE`, então a expressão é válida no índice. Rejeito a coluna gerada, como o arquiteto.
- `btree_gist` é extensão *trusted* desde o PG 13. O dono do banco a cria sem superusuário, inclusive no *shadow database* do `migrate dev`. A imagem oficial ≥ 16 já traz `contrib`.
- A constraint também vale para UPDATE. Voltar `cancelado` para ativo sobre um horário ocupado seria rejeitado, mas `cancelado` é final (S2), então isso não deve ocorrer. Mesmo assim, o CA abaixo prova a regra.

**Complementos ao modelo:**
1. **Integridade de tenant no banco (FK composta).** Toda tabela de salão tem `UNIQUE (salao_id, id)`. As FKs filhas são compostas: `reserva(salao_id, profissional_id) → profissional(salao_id, id)`, e o mesmo vale para `reserva.cliente_id`, `reserva_item.servico_id`, `servico_profissional` (profissional e serviço), `bloqueio.profissional_id`, `jornada.profissional_id`, `mensagem.reserva_id` e `consentimento`. Assim, mesmo um bug no repositório não consegue gravar uma reserva do salão A com profissional, cliente ou serviço do salão B.
2. **Nenhum `ON DELETE CASCADE` nem `SetNull` implícito.** Toda relação declara `onDelete: Restrict` no Prisma, porque nas relações opcionais o Prisma usa `SetNull` por padrão. A única exclusão física prevista é a de `bloqueio` (E2.4 RN-3) e as limpezas de `sessao`, `token` e `rate_limit_janela`.
3. **Cliente.**
   - `UNIQUE (salao_id, telefone_e164)` com o comportamento padrão `NULLS DISTINCT` (não usar `NULLS NOT DISTINCT`), para que várias clientes anonimizadas coexistam no mesmo salão.
   - `CHECK ((anonimizada_em IS NULL AND nome IS NOT NULL AND telefone_e164 IS NOT NULL) OR (anonimizada_em IS NOT NULL AND nome IS NULL AND telefone_e164 IS NULL))`. Com isso, a anonimização fica irreversível no próprio banco.
   - `CHECK (telefone_e164 ~ '^\+55[1-9][0-9]{9,10}$')`.
4. **Slug.** Uma tabela única `salao_slug(slug PK, salao_id FK, atual bool, criado_em)` guarda os slugs atuais e históricos, o que dá unicidade global com uma só constraint. Um índice parcial `UNIQUE (salao_id) WHERE atual` garante um slug atual por salão. Também há `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`. Com duas tabelas (`salao.slug` + `slug_historico`), não haveria como garantir unicidade cruzada no banco. Em uma corrida no cadastro, a violação de unicidade faz a aplicação tentar o próximo sufixo (E1.1).
5. **Usuário.**
   - E-mail gravado já normalizado, com `CHECK (email = lower(email))` e `UNIQUE (email)`.
   - Um gestor por salão: `UNIQUE (salao_id) WHERE papel = 'gestor'`.
   - `CHECK ((papel = 'super_admin') = (salao_id IS NULL))`.
   - `profissional.usuario_id` é `UNIQUE`, anulável.
6. **Hora local × UTC.** RN-1 ("todo timestamp em `timestamptz`") vale para **instantes**. A jornada é uma recorrência na hora local e deve ser guardada como `dia_semana smallint (0–6)` + `inicio_min`/`fim_min int`, com `CHECK (0 <= inicio_min AND inicio_min < fim_min AND fim_min <= 1440)`. Se fosse guardada como `timestamptz`, o horário da jornada mudaria com o DST. A jornada recebe ainda `EXCLUDE USING gist (profissional_id WITH =, dia_semana WITH =, int4range(inicio_min, fim_min) WITH &&)`, que torna o CA-2 de E2.3 também uma garantia do banco.
7. **Bloqueio.** Uma tabela com `profissional_id` anulável (nulo = salão inteiro), `CHECK (fim > inicio)` e índice GiST `(salao_id, tstzrange(inicio, fim, '[)'))`.
8. **Configurações do salão.** Ficam em colunas do salão com `DEFAULT` no banco iguais ao PLAN: `fuso 'America/Sao_Paulo'`, `grade_min 15`, `antecedencia_min 120`, `janela_dias 60`, `intervalo_min 0`. Os `CHECK` de faixa só entram quando E2.5 RN-1 for decidido.
9. **Dinheiro e duração.** `int` em centavos com `CHECK (>= 0)`. Duração em `int` minutos com `CHECK (> 0)`.
10. **IDs e defaults.** IDs em `uuid` com `dbgenerated("gen_random_uuid()")` e `criado_em DEFAULT now()` no banco, não só no cliente Prisma, porque os CAs de E0.4 inserem via SQL direto. `reserva.atualizado_em` é necessário para o job de reconciliação de E7.1.
11. **Nomes.** Use `@@map`/`@map` em snake_case. O SQL bruto (constraint, disponibilidade, triggers) referencia esses nomes.
12. **Índices mínimos de `reserva`.**
    - `(salao_id, inicio)` para a agenda do salão (E3.3).
    - `(profissional_id, inicio)` para a agenda individual.
    - `(cliente_id, inicio) WHERE status = 'confirmado'` para o limite de E4.2 e o histórico da cliente.
    - `UNIQUE (salao_id, chave_requisicao)`, com a coluna anulável, porque a equipe não envia a chave.
    - A busca de ocupação por profissional usa o próprio índice GiST da constraint (ver E3.2).
13. **Fora do modelo.** Coluna de cartão. Mantenho o CA-4 de E6.1.

**Drift do Prisma.** O Prisma não representa constraints `EXCLUDE`, `CHECK`, triggers nem índices parciais ou de expressão. Eles ficam só em migrações SQL. O risco é o `migrate dev` propor removê-los ou acusar drift. Isso vira um CA explícito (abaixo). Se o Prisma acusar drift, a mitigação é declarar os índices parciais suportados no schema e manter o restante só em SQL.

**Reversão.** Ainda não há dados nem produção. A migração `*_reserva_exclusion` deve trazer, em comentário, o SQL inverso: `ALTER TABLE reserva DROP CONSTRAINT reserva_sem_sobreposicao; DROP CONSTRAINT reserva_ordem_chk;`. A extensão não é removida, porque outras constraints usam `btree_gist`. Mudanças futuras na lista de status exigem `DROP` + `ADD` da constraint (varredura completa sob `ACCESS EXCLUSIVE`), o que é aceitável no volume da v1, mas precisa estar documentado.

### E0.5 — Escopo de salão e infraestrutura de testes: **aprovado, com complementos**
- **Um banco por worker do Vitest via template (aceito).** O `globalSetup` cria `agenda_template`, aplica `prisma migrate deploy` e inicializa uma vez o schema `pgboss` (`boss.start()`/`stop()`). Cada worker faz `CREATE DATABASE agenda_test_<n> TEMPLATE agenda_template`. O template não pode ter conexões abertas na hora da cópia: feche o Prisma e o pg-boss antes.
- **Reset entre arquivos.** Recriar o banco a partir do template, e não com `TRUNCATE`. Motivos: o trigger append-only de `auditoria` bloqueia `TRUNCATE` (E8.1), e os testes de concorrência precisam de transações reais confirmadas, portanto não dá para usar "transação por teste com rollback".
- **Pool de conexões.** Os testes de concorrência exigem `connection_limit` ≥ número de requisições paralelas (ex.: 12 para o CA-2 de E3.2). Sem isso, o pool serializa as chamadas e o teste passa sem provar nada.
- **Defesa em profundidade.** As FKs compostas de E0.4 (item 1) já impedem escritas cruzadas entre salões. RLS no PostgreSQL fica descartado na v1: exigiria `SET LOCAL` por transação com o pool do Prisma, um custo desproporcional.

### E0.7 — pg-boss em worker separado: **aprovado, com complementos**
- pg-boss usa o schema `pgboss`, e o Prisma gerencia só o `public` (sem `multiSchema`). O `migrate dev` só inspeciona os schemas do datasource, então não há drift. Depois de um `migrate reset` local, o `start()` do pg-boss recria o próprio schema.
- Fixar a versão exata do `pg-boss` no `package.json`, porque um upgrade altera o schema `pgboss` por migração própria. O usuário do banco precisa de `CREATE` no database.
- **As tabelas do pg-boss são transporte, não registro.** Elas são arquivadas e apagadas pela retenção do pg-boss. O histórico de tentativas exigido pelo PLAN fica nas tabelas próprias de E7.1. O payload do job leva **apenas IDs** (ex.: `mensagemId`), nunca nome nem telefone (ver E5.2).

### E3.2 — Criar reserva e tratar conflito: **aprovado, com complementos**
- **Isolamento `READ COMMITTED`**, o padrão. A constraint resolve o conflito, e `SERIALIZABLE` só acrescentaria falhas `40001` para tratar com nova tentativa.
- **Ordem dentro da transação:**
  1. upsert da cliente (`INSERT … ON CONFLICT (salao_id, telefone_e164) DO UPDATE`), que também trava a linha da cliente;
  2. contagem de E4.2;
  3. `INSERT reserva` com `ocupado_ate`;
  4. `INSERT` dos itens;
  5. consentimento.

  Um `23P01` aborta a transação inteira, sem reserva parcial e sem gravar a troca de nome. A tradução usa SQLSTATE + nome da constraint, e um teste prova o mapeamento.
- **Consulta de ocupação (E3.1/E3.2).** Deve repetir **exatamente** a expressão e o predicado da constraint para usar o índice GiST parcial:
  ```sql
  WHERE profissional_id = ANY($1)
    AND status IN ('confirmado','concluido','nao_compareceu')
    AND tstzrange(inicio, ocupado_ate, '[)') && tstzrange($2, $3, '[)')
  ```
  O `EXPLAIN (ANALYZE)` com o volume do seed deve mostrar o uso de `reserva_sem_sobreposicao` (ou de outro índice) e nenhum `Seq Scan` em `reserva`. Ele entra como evidência em E3.1.
- `chave_requisicao`: em caso de violação de `UNIQUE (salao_id, chave_requisicao)` (`23505`), a aplicação devolve a reserva existente. Não é erro.

### E4.2 — Rate limit e limite por número: **aprovado, com correção de concorrência**
- `rate_limit_janela(chave text, janela_inicio timestamptz, contador int, PRIMARY KEY (chave, janela_inicio))`, com janela fixa e um upsert atômico: `INSERT … ON CONFLICT (chave, janela_inicio) DO UPDATE SET contador = rate_limit_janela.contador + 1 RETURNING contador`.
- **LGPD:** a chave por número guarda um **HMAC-SHA256 do telefone** (segredo do env), nunca o E.164 em claro. A chave por IP pode guardar o IP, com retenção curta.
- Limpeza no worker: um job periódico apaga, em lotes, as janelas com mais de 24 h. Um índice em `janela_inicio` atende esse job.
- **Corrida no limite de 3 reservas futuras.** Uma contagem simples (`SELECT count(*)`) seguida de `INSERT` deixa passar a 4ª e a 5ª reserva quando chegam em paralelo. A contagem deve ocorrer na transação de E3.2, **depois** do upsert que trava a linha da cliente. Sob `READ COMMITTED`, a segunda transação espera o commit da primeira e sua contagem já enxerga a reserva nova. Isso precisa de um CA (ver ajustes).

### E5.2 — Anonimização: **aprovado, com complementos**
Tudo numa única transação:
1. `UPDATE cliente` com nome e telefone nulos e `anonimizada_em = now()`. O CHECK de E0.4 garante que a operação seja irreversível.
2. Mensagens dessa cliente em `pendente` ou `falhou` passam a `cancelada_anonimizacao`.
3. Em **todas** as mensagens da cliente: `destinatario_e164`, `parametros` e o `erro_detalhe` das tentativas ficam nulos. O erro do provedor pode ecoar o telefone.
4. Os consentimentos são mantidos (só têm FK e versão, servem como prova).

Corrida com o worker: o handler reivindica a mensagem com um UPDATE condicional que exige `cliente.anonimizada_em IS NULL` (ver E7.1). Uma mensagem já em `enviando` termina o envio, mas não regrava os dados da cliente. O payload do pg-boss não contém PII (E0.7), então não sobra telefone no arquivo do pg-boss. As chaves de rate limit usam HMAC (E4.2).

### E6.2 — Webhooks do Mercado Pago: **aprovado, com correção de segurança na deduplicação**
- `webhook_evento(id, provedor, chave_dedupe, tipo, recurso_id, payload jsonb, origem_valida bool, resultado enum('recebido','processado','ignorado','rejeitado','erro'), recebido_em, processado_em, erro)`.
- **A unicidade da `chave_dedupe` vale só para eventos com origem válida:** `UNIQUE (provedor, chave_dedupe) WHERE origem_valida`. Se a unicidade fosse total, um evento forjado (assinatura inválida) com o mesmo `x-request-id`/`id` de um evento legítimo, chegando antes dele, faria o legítimo ser descartado como duplicado. Os eventos rejeitados continuam sendo registrados, sem unicidade.
- **Idempotência do efeito:** `assinatura_pagamento(pagamento_id UNIQUE, assinatura_id, status, valor_centavos, aplicado_em)`, com `INSERT … ON CONFLICT DO NOTHING`. Só quem inseriu estende o período, na mesma transação que faz `SELECT … FOR UPDATE` na linha da `assinatura`. Isso cobre notificações diferentes sobre o mesmo pagamento.
- O payload guardado é o corpo da notificação, que traz só IDs. A resposta da consulta ao provedor não é persistida inteira (pode conter e-mail do pagador). Guardam-se apenas os campos usados.
- Volume de eventos rejeitados: o endpoint do webhook entra no rate limit por IP de E4.2. A retenção dos eventos rejeitados fica como pendência, sem CA na v1.

### E6.3 — Máquina de estados da assinatura: **aprovado, com complementos**
- Colunas de `assinatura`: `estado` (enum), `provedor_assinatura_id UNIQUE`, `teste_fim_em`, `periodo_pago_ate`, `primeira_falha_em`, `carencia_ate`, `cancelada_em`, `acesso_ate`.
- Uma assinatura vigente por salão (E6.1 RN-1): `UNIQUE (salao_id) WHERE estado <> 'encerrada'`. Uma `pendente` abandonada deve ser reutilizada ou passar a `encerrada` antes de criar outra (S10).
- O job de prazo usa UPDATE condicional, que é idempotente pelo predicado: `UPDATE assinatura SET estado='suspensa' WHERE estado='em_carencia' AND carencia_ate <= $agora`. Webhook e job serializam pela linha (`FOR UPDATE` ou predicado de estado esperado). Resultado: um pagamento aprovado concorrente com o vencimento termina sempre em `ativa`.
- Recomendado: a tabela `assinatura_transicao` (de, para, causa, evento_id, ocorrida_em), somente inserção, como evidência do CA 5 do PLAN e para o painel de E8.3.
- Volume baixo (uma linha por salão), então não exige índices extras.

### E7.1 — Mensagens: **aprovado, com correção para "nunca duplicar"**
- A garantia no banco é `UNIQUE (reserva_id, tipo, revisao)`, com tipos e FK verificáveis. A string `reserva:tipo:revisao` é derivada e serve de `singletonKey` no pg-boss.
- `mensagem_tentativa(mensagem_id, numero, iniciada_em, finalizada_em, resultado, erro_codigo, erro_detalhe, UNIQUE (mensagem_id, numero))`.
- **Reivindicação atômica:** o handler só envia depois de `UPDATE mensagem SET estado='enviando', … WHERE id=$1 AND estado IN ('pendente','falhou') AND <cliente não anonimizada> RETURNING …`. Se o pg-boss repetir um job (por timeout), a nova execução não reenvia.
- **Estado `enviando` (acrescentar aos estados de §11/E7.1).** Se o worker cair entre a chamada à Meta e a gravação do resultado, não há como saber se a mensagem saiu. A Cloud API não aceita chave de idempotência. A reconciliação move `enviando` com mais de N minutos para `falhou` com erro `resultado_incerto`, **sem reenvio automático**: o reenvio fica manual (E8.3). Isso privilegia "nunca duplicar mensagem" (PLAN). O risco residual é documentado.
- A substituição (S3) só afeta `pendente`, nunca `enviando` nem `enviada`. O `revisao++` acontece por `UPDATE reserva … RETURNING revisao` na transação da remarcação, o que serializa remarcações concorrentes.
- Índices:
  - `(salao_id, criado_em DESC)` para E7.3/E8.3;
  - `(estado, criado_em) WHERE estado IN ('pendente','enviando','falhou')` para a reconciliação e a fila do painel;
  - `reserva(atualizado_em)` para a reconciliação varrer só uma janela recente.

### E8.1 — Auditoria append-only: **aprovado, com complementos**
- Na migração SQL de E0.4: uma função `auditoria_somente_insercao()` que levanta a exceção `SQLSTATE 'P0001'` com a mensagem `auditoria é somente inserção`, e os triggers `BEFORE UPDATE OR DELETE … FOR EACH ROW` e `BEFORE TRUNCATE … FOR EACH STATEMENT`.
- O `REVOKE` não basta: a aplicação conecta como dona das tabelas, e o dono ignora o `REVOKE`. O trigger é a garantia efetiva. Limitação documentada: o dono ou um superusuário ainda pode fazer `ALTER TABLE … DISABLE TRIGGER`. Separar o papel de migração do papel da aplicação fica como melhoria pós-v1 (DevOps).
- Colunas: `ator_id` anulável (falha de login com e-mail inexistente), `ator_email_informado`, `ocorrido_em DEFAULT now()`, `acao`, `entidade`, `entidade_id`, `salao_id` (FK `RESTRICT`), `antes jsonb`, `depois jsonb`, `resultado`.
- Índices: `(ocorrido_em DESC)`, `(salao_id, ocorrido_em DESC)`, `(ator_id, ocorrido_em DESC)`.
- **Conflito entre RN-2 e S14.** "Sem auditoria, sem mutação" vale para as mutações. Uma tentativa **falha** (TOTP inválido) não tem mutação, e sua auditoria precisa ser gravada em transação própria, confirmada mesmo que a operação falhe. Se ficasse na mesma transação, o rollback apagaria o registro.

### E9.2 — Seed: **aprovado, com complementos**
- **Idempotência por IDs fixos (UUIDs constantes no seed) com `upsert`/`createMany({ skipDuplicates })`**, sem criar `UNIQUE` de negócio só para o seed (ex.: nome de serviço). Salão por slug, usuário por e-mail.
- Os horários das reservas são relativos à data da **primeira** execução. Uma reexecução não altera o que já existe, então as reservas "futuras" envelhecem, o que é aceitável e deve ser documentado no README.
- O seed passa pela constraint e pelos CHECKs. Isso também vale como teste deles: reservas do mesmo profissional não podem se sobrepor nem violar `ocupado_ate`.
- **Proteção:** o seed recusa execução com `NODE_ENV=production`, salvo com um flag explícito. Nunca usa `migrate reset` nem apaga dados.
- Super admin: a senha vem do env e é gravada com hash. O segredo TOTP (E1.5) precisa ser recuperável, por isso é gravado **cifrado** (AES-256-GCM com chave do env), nunca em claro.

## 2. Ajustes pedidos ao analista

| chave | mudança concreta no texto (CA/RN/especificação) |
|---|---|
| E0.4 | Escopo: aplicar §11/E0.4 do design (expressão com `ocupado_ate`, lista explícita de status, CHECK de ordem, `revisao`, `chave_requisicao`, `suspenso_manual_em`, `sessao`, `email_log`, `rate_limit_janela`, trigger de auditoria). |
| E0.4 | Trocar "slug histórico" por: tabela única `salao_slug` (atuais + históricos), `UNIQUE(slug)`, `UNIQUE(salao_id) WHERE atual`, `CHECK` de formato. |
| E0.4 | RN-1: acrescentar "instantes em `timestamptz`; jornada em hora local (`dia_semana`, `inicio_min`, `fim_min`), com exclusion `int4range` por profissional e dia". |
| E0.4 | RN-2: trocar "`salao_id` não nulo e indexado" por "`salao_id` não nulo, `UNIQUE(salao_id, id)` e FKs compostas `(salao_id, <fk>)` entre entidades do mesmo salão; índices escopados começam por `salao_id`". |
| E0.4 | Novo RN: "todas as FKs `ON DELETE RESTRICT` explícito; nenhum CASCADE/SET NULL; IDs `uuid` e `criado_em` com default no banco". |
| E0.4 | RN-5: acrescentar "unicidade com NULLS DISTINCT (anonimizadas coexistem); CHECK de anonimização coerente (todos nulos + `anonimizada_em`, ou nenhum nulo); CHECK de formato E.164 BR". |
| E0.4 | RN-8: trocar a unicidade da mensagem por `UNIQUE(reserva_id, tipo, revisao)`; webhook `UNIQUE(provedor, chave_dedupe) WHERE origem_valida`; `assinatura_pagamento.pagamento_id UNIQUE`; `UNIQUE(salao_id) WHERE estado <> 'encerrada'` em assinatura. |
| E0.4 | CA-1: acrescentar "e, depois de aplicadas, `prisma migrate dev` não gera nova migração nem acusa drift (constraint, CHECKs, triggers e índices parciais preservados)". |
| E0.4 | CA-2: acrescentar "o erro tem SQLSTATE `23P01` e constraint `reserva_sem_sobreposicao`". |
| E0.4 | Novo CA (do arquiteto): intervalo de 15 min; 10:00–10:30 (`ocupado_ate` 10:45) e 10:30–11:00 do mesmo profissional → a segunda é rejeitada. |
| E0.4 | Novo CA: "Dado uma reserva `cancelado` 10:00–11:00 e outra `confirmado` 10:30–11:30 do mesmo profissional, quando se faz UPDATE da primeira para `confirmado`, então o banco rejeita com `23P01`". |
| E0.4 | Novo CA: "Dado reserva com `fim <= inicio` ou `ocupado_ate < fim`, quando inserida, então é rejeitada pelo CHECK". |
| E0.4 | Novo CA: "Dado `salao_id` do salão A e `profissional_id` (ou `cliente_id`, `servico_id`) do salão B, quando se insere a reserva/item via SQL, então a FK composta rejeita". |
| E0.4 | Novo CA: "Dado duas clientes anonimizadas (telefone nulo) no mesmo salão, quando inseridas, então ambas são aceitas; dado cliente com `anonimizada_em` preenchido e nome não nulo, então o CHECK rejeita". |
| E0.4 | Novo CA: "Dado um slug atual ou histórico de um salão, quando outro salão insere o mesmo slug em `salao_slug`, então é rejeitado; dado um salão com dois slugs `atual`, então é rejeitado". |
| E0.4 | Novo CA: "Dado um registro em `auditoria`, quando se executa UPDATE, DELETE ou TRUNCATE via SQL, então o banco rejeita; INSERT é aceito". |
| E0.4 | Validação: os testes de E0.4 usam conexão direta (`pg`/Prisma) contra o banco do compose ou da CI; migram para o harness compartilhado quando E0.5 existir. |
| E0.5 | Escopo: "reset entre arquivos por recriação a partir do template (sem TRUNCATE); template inclui schema `pgboss`; pool ≥ nº de requisições paralelas nos testes de concorrência". |
| E0.5 | Novo CA: "Dado dois arquivos de teste de concorrência executando em workers paralelos, quando rodam juntos, então nenhum vê dados do outro e ambos passam de forma determinística em 10 execuções seguidas". |
| E0.7 | Novo RN: "versão do pg-boss fixada; payload do job contém apenas IDs (sem PII); tabelas do pg-boss não são fonte do histórico de tentativas". |
| E3.2 | Novo RN: "transação `READ COMMITTED` na ordem: upsert da cliente → contagem de E4.2 → reserva → itens → consentimento; `23P01` identificado por SQLSTATE + nome da constraint; `23505` em `chave_requisicao` devolve a reserva existente". |
| E3.2 | CA-2: acrescentar "com pool de conexões ≥ 10, de modo que as 10 transações sejam de fato concorrentes; as 9 recusas vêm de `23P01`". |
| E3.2 | Novo CA: "Dado uma reserva que falha por `23P01` com nome de cliente diferente do cadastrado, quando a transação é desfeita, então o nome da cliente não muda e não existe item órfão". |
| E3.1 | Validação: acrescentar "`EXPLAIN (ANALYZE)` da consulta de ocupação com volume do seed anexado à issue, sem `Seq Scan` em `reserva`; consulta usa a mesma expressão e predicado da constraint". |
| E3.5 | Novo CA: "Dado reserva 10:00–11:00, quando remarcada para 10:30–11:30 do mesmo profissional (sobrepondo a própria posição antiga), então é aceita (UPDATE da mesma linha, não cancelamento + nova reserva)". |
| E4.2 | RN-1: acrescentar "chave por número armazenada como HMAC-SHA256 do E.164; upsert atômico `ON CONFLICT … RETURNING contador`; limpeza periódica no worker". |
| E4.2 | RN-2: acrescentar "contagem feita na transação de criação, após o upsert que trava a linha da cliente". |
| E4.2 | Novo CA: "Dado um número com 2 reservas futuras, quando 5 reservas públicas desse número (horários distintos) são enviadas em paralelo, então exatamente 1 é aceita e o total de futuras é 3". |
| E5.2 | RN-4/RN-7: decidir "na mesma transação: mensagens `pendente`/`falhou` → `cancelada_anonimizacao`; `destinatario_e164`, `parametros` e `erro_detalhe` das tentativas nulos em todas as mensagens da cliente; consentimentos mantidos". |
| E5.2 | Novo CA: "Dado a cliente anonimizada, quando se busca o telefone antigo em `cliente`, `mensagem`, `mensagem_tentativa` e `rate_limit_janela`, então não há ocorrência em claro". |
| E5.2 | Novo CA: "Dado a cliente anonimizada, quando se tenta voltar a preencher nome/telefone via SQL, então o CHECK rejeita". |
| E6.2 | RN-2/RN-6: "unicidade da chave de dedupe só entre eventos com origem válida (`WHERE origem_valida`); efeito por `assinatura_pagamento.pagamento_id UNIQUE` + `FOR UPDATE` na assinatura; persistir só o corpo da notificação, não a resposta completa do provedor". |
| E6.2 | Novo CA: "Dado um evento forjado (assinatura inválida) com o mesmo `id`/`x-request-id` de um evento legítimo, recebido antes dele, quando o legítimo chega, então é processado normalmente". |
| E6.2 | Novo CA: "Dado duas notificações distintas referentes ao mesmo `pagamento_id` aprovado, quando processadas, então o período é estendido uma vez". |
| E6.3 | Novo RN: "job de prazo por UPDATE condicional ao estado esperado; webhook e job serializam pela linha da assinatura; transições registradas em `assinatura_transicao` (somente inserção)". |
| E6.3 | Novo CA: "Dado `em_carencia` com prazo vencendo, quando o job de suspensão e um webhook de pagamento aprovado são processados em paralelo, então o estado final é `ativa`". |
| E6.1 | RN-1: acrescentar "garantido por `UNIQUE(salao_id) WHERE estado <> 'encerrada'`; uma `pendente` abandonada é reutilizada". |
| E7.1 | Estados: acrescentar `enviando`; RN nova: "envio só após reivindicação atômica (`UPDATE … WHERE estado IN ('pendente','falhou') … RETURNING`); `enviando` além do prazo vira `falhou` com `resultado_incerto`, sem reenvio automático (reenvio manual em E8.3); substituição atinge só `pendente`". |
| E7.1 | RN-2: unicidade no banco por `UNIQUE(reserva_id, tipo, revisao)`; a string `reserva:tipo:revisao` é a `singletonKey` do pg-boss. |
| E7.1 | Novo CA: "Dado o mesmo job entregue a dois workers simultaneamente, quando ambos executam, então o adaptador recebe uma única chamada". |
| E7.1 | Novo CA: "Dado uma mensagem em `enviando` há mais que o prazo (worker interrompido), quando a reconciliação roda, então fica `falhou` com `resultado_incerto` e não é reenviada automaticamente". |
| E8.1 | RN-2: acrescentar "falhas sem mutação (ex.: TOTP inválido) são auditadas em transação própria, confirmada mesmo com a operação recusada". |
| E8.1 | RN-3: acrescentar "garantido por trigger (UPDATE/DELETE por linha e TRUNCATE por instrução) criado em E0.4; REVOKE não basta porque a aplicação é dona das tabelas". |
| E8.1 | Novo CA: "Dado TOTP inválido no login do super admin, quando a tentativa é recusada, então existe registro de auditoria da falha". |
| E9.2 | RN-1: "idempotência por UUIDs fixos e upsert/skipDuplicates; reservas relativas à data da primeira execução"; novo RN: "seed recusa `NODE_ENV=production` sem flag explícito e nunca apaga dados". |
| E1.5 | (fora da lista, impacto em dados) Novo RN: "segredo TOTP gravado cifrado (AES-256-GCM, chave por env), nunca em claro". |

## 3. Ajustes pedidos ao arquiteto

| chave | mudança no JSON |
|---|---|
| E0.4 | `deliverables`: trocar `slug_historico` por `salao_slug (atuais + históricos)`; acrescentar "FKs compostas `(salao_id, id)` e `onDelete: Restrict` explícito", "exclusion `int4range` da jornada", "CHECKs de cliente anonimizada e E.164", "índices parciais únicos (gestor por salão, slug atual, assinatura vigente, webhook com origem válida)" e "teste de ausência de drift (`migrate dev` sem nova migração)"; trocar "Trigger append-only na tabela de auditoria" por "Triggers append-only (UPDATE/DELETE por linha, TRUNCATE por instrução) em auditoria". `size` permanece `L` (limite superior; se o desenvolvedor estimar acima, dividir em E0.4a esquema e E0.4b SQL bruto + testes). |
| E3.1 | `support`: acrescentar `"dba"` (EXPLAIN da consulta de ocupação e índices de bloqueio). |
| E3.5 | `support`: acrescentar `"dba"` (UPDATE sob a constraint, `revisao++` serializado). |
| E4.2 | `deliverables`: acrescentar "contagem de reservas futuras dentro da transação de criar-reserva, após o lock da cliente" e "job de limpeza de `rate_limit_janela` no worker". `related`: acrescentar `"E3.2"`. |
| E7.1 | `deliverables`: acrescentar "estado `enviando` com reivindicação atômica" e "reconciliação marca `enviando` vencido como `falhou` (`resultado_incerto`)". |
| E6.3 | `deliverables`: acrescentar "`assinatura_transicao` (somente inserção)". |

Dependências: o grafo do JSON está correto do ponto de vista de dados. Todo item que cria tabela ou coluna depende transitivamente de E0.4. Os testes de E0.5 dependem do template com `pgboss`, e o pg-boss já está disponível em E0.5 porque é dependência de pacote, não de E0.7. Os itens posteriores que precisarem de colunas novas criam **migração própria** (nunca editam a migração de E0.4 depois de aplicada) e acionam o DBA como `support`.

## 4. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Prisma propor remover ou acusar drift da constraint `EXCLUDE`, dos CHECKs, triggers ou índices parciais | Perda silenciosa da garantia anti-sobreposição numa migração futura | CA de ausência de drift em E0.4, executado também na CI; nome fixo das constraints; revisão do DBA em toda migração |
| Renomear um valor do enum `status` | Quebra o predicado da constraint | Proibido renomear; novo status exige migração que recria a constraint com decisão explícita (lista fechada) |
| Recriar a constraint em produção com dados | `ACCESS EXCLUSIVE` + varredura completa | Volume da v1 pequeno; janela de manutenção documentada |
| Teste de concorrência "verde" sem concorrência real (pool pequeno) | Falsa evidência do CA 3/CA 11 do PLAN | Pool ≥ N no teste; asserção de 9 erros `23P01` |
| Corrida no limite de 3 reservas futuras | Abuso da página pública e custo da Meta | Contagem após o lock da cliente (E3.2/E4.2) + CA concorrente |
| Envio em dobro ou perdido por queda do worker durante a chamada à Meta | Mensagem duplicada ou não enviada | Estado `enviando`, reivindicação atômica e resolução manual de `resultado_incerto` (risco residual documentado no README) |
| Deduplicação de webhook contaminada por evento forjado | Evento legítimo do MP ignorado | Unicidade parcial `WHERE origem_valida` |
| PII residual após anonimização (log de mensagens, erros do provedor, pg-boss, rate limit) | Descumprimento da LGPD | Limpeza na transação de E5.2, payloads só com IDs e HMAC do telefone; CA de varredura |
| Dono das tabelas desabilita o trigger de auditoria | Log adulterável por quem tem acesso ao banco | Limitação documentada; separar o papel de migração do papel da aplicação após a v1 |
| Upgrade do pg-boss altera o schema `pgboss` | Worker não sobe após o deploy | Versão fixada; upgrade como demanda própria |
| Segredo TOTP em claro | Comprometimento do segundo fator | Cifragem com chave do env (E1.5) |
