# D-004 — Parecer do DBA (T-1 e T-2)

Entradas: `spec.md`, `design.md` (§0, §1, §4, §9), `issue-6.md`, `docs/demandas/D-001/dba.md` (E0.4, E4.2, E6.2, E6.3, E7.1, E8.1) e `docs/demandas/D-003/dba.md`.
Arquivos entregues:
- `prisma/schema.prisma`
- `prisma/migrations/migration_lock.toml`
- `prisma/migrations/20261118000000_init/migration.sql`: gerado por `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` e **não editado**
- `prisma/migrations/20261118000100_reserva_exclusion/migration.sql`: SQL bruto
- `prisma/migrations/20261118000200_restricoes_sql/migration.sql`: SQL bruto

## 1. Impacto e compatibilidade

- É a primeira migração de domínio. Não há dados de produção. Nos bancos locais, `_prisma_migrations` está vazia (D-003 §4), então o `migrate deploy` do entrypoint aplica as três migrações sem nenhuma intervenção.
- Locks e tempo: todas as tabelas nascem vazias, e as três migrações rodam em cerca de 1 s.
- Um volume local antigo, criado com `db push` (proibido, D-003 N-5), teria drift. A saída é `docker compose down -v`, só no volume de dev.
- O `migrate deploy` roda cada migração numa transação. Se uma falha, ela fica registrada como falha em `_prisma_migrations` e o deploy seguinte recusa continuar. Isso não acontece num banco limpo (evidência na §6).

## 2. Decisões de modelagem

| Ponto | Decisão |
|---|---|
| S-1 (`onUpdate`) | `onDelete: Restrict, onUpdate: Restrict` em **todas** as 35 relações. O init gerado tem 35× `ON DELETE RESTRICT ON UPDATE RESTRICT`, 0× `CASCADE` e 0× `SET NULL`. No catálogo, 0 FKs com `confdeltype` ou `confupdtype` diferente de `r`. |
| S-6 (tabelas) | Mantive os 24 nomes da spec §3, item 1, sem nenhuma renomeação (lista na §3.1). |
| FKs compostas (RN-2) | São compostas, no formato `(salao_id, x_id) → (salao_id, id)`: `reserva.profissional_id`, `reserva.cliente_id`, `reserva_item.reserva_id`, `reserva_item.servico_id`, `servico_profissional` (os dois lados), `jornada.profissional_id`, `bloqueio.profissional_id` (opcional, `MATCH SIMPLE`: nulo = salão inteiro), `mensagem.reserva_id`, `consentimento.cliente_id`, `convite.profissional_id` e `profissional.usuario_id` (opcional; alvo `usuario(salao_id, id)`). |
| `profissional.usuario_id` único (RN-12) | O Prisma exige que uma relação 1:1 com FK composta seja única **nas colunas da FK**, por isso a constraint é `UNIQUE (salao_id, usuario_id)` (`profissional_salao_id_usuario_id_key`). Ela equivale a `UNIQUE (usuario_id)`: a FK composta obriga `profissional.salao_id = usuario.salao_id`, e cada usuário tem um só salão. Dois profissionais com o mesmo usuário recebem `23505`. |
| Tabelas sem `salao_id` | `sessao`, `token` (dados do usuário; o super admin não tem salão), `assinatura_pagamento`, `assinatura_transicao` (escopo via `assinatura`), `mensagem_tentativa` (escopo via `mensagem`), `email_log` e `rate_limit_janela` (dados da plataforma). Em `webhook_evento` e `auditoria`, o `salao_id` é anulável, porque o salão pode não ser resolvido (evento rejeitado, login de super admin). |
| Tempo | Todo `DateTime` é `@db.Timestamptz(6)`. O catálogo tem 0 colunas `timestamp without time zone` fora de `_prisma_migrations`. A jornada fica em minutos locais (`dia_semana smallint`, `inicio_min` e `fim_min int`). |
| Defaults no banco | `id uuid DEFAULT gen_random_uuid()` e `criado_em DEFAULT now()`. Exceções: `rate_limit_janela` (PK composta, sem `id` nem `criado_em`) e `servico_profissional` (PK composta). As tabelas append-only usam `ocorrido_em` (auditoria) e `ocorrida_em` (transição), e `webhook_evento` usa `recebido_em`, também com `DEFAULT now()`. `atualizado_em` tem `DEFAULT now()` e o `@updatedAt` do Prisma. Quem atualiza por SQL bruto precisa gravar `atualizado_em = now()`, porque não há trigger. |
| Configurações do salão | `fuso 'America/Sao_Paulo'`, `grade_min 15`, `antecedencia_min 120`, `janela_dias 60` e `intervalo_min 0`, como `DEFAULT` no banco. Os CHECKs de faixa aguardam a E2.5. |
| `salao_slug.atual` | Fica **sem default**: quem insere decide se o slug é o atual, o que evita a troca silenciosa de slug. |
| Colunas além do mínimo da spec | `reserva.origem` (`publico`/`equipe`, obrigatório: o limite de E4.2 e o S4 dependem dele), `reserva.encaixe` (default `false`, para a E3.3/E3.4), `reserva.cancelada_em`, `mensagem.provedor_mensagem_id`, `mensagem.erro_codigo`, `mensagem.enviada_em`, `sessao.totp_verificado_em`, `sessao.ultimo_uso_em`, `usuario.totp_segredo_cifrado` e `usuario.totp_ativado_em` (E1.5: cifrado, nunca em claro) e `webhook_evento.salao_id`. Nenhuma coluna de cartão nem de itens fora da v1. |
| Função append-only | Uma função genérica, `rejeitar_alteracao_somente_insercao()`, que levanta `'<tabela> é somente inserção'` (via `TG_TABLE_NAME`) com `ERRCODE 'P0001'`. Ela é ligada a `auditoria` e `assinatura_transicao` por trigger de linha (UPDATE/DELETE) e de instrução (TRUNCATE). Limitação conhecida: o dono das tabelas pode usar `DISABLE TRIGGER` (D-001 E8.1). |
| Idempotência das mensagens | `UNIQUE (reserva_id, tipo, revisao)`, por decisão do usuário (P1). |

## 3. Contrato de nomes (usado pela T-4 e pela E3.2; nomes fixos)

### 3.1 Tabelas (24, schema `public`, sem contar `_prisma_migrations`)
`assinatura`, `assinatura_pagamento`, `assinatura_transicao`, `auditoria`, `bloqueio`, `cliente`, `consentimento`, `convite`, `email_log`, `jornada`, `mensagem`, `mensagem_tentativa`, `profissional`, `rate_limit_janela`, `reserva`, `reserva_item`, `salao`, `salao_slug`, `servico`, `servico_profissional`, `sessao`, `token`, `usuario`, `webhook_evento`.

### 3.2 Enums (tipo no banco: valores)
| Tipo | Valores |
|---|---|
| `papel_usuario` | `gestor`, `profissional`, `super_admin` |
| `tipo_token` | `confirmacao_email`, `recuperacao_senha` |
| `status_reserva` | `confirmado`, `cancelado`, `concluido`, `nao_compareceu` (**proibido renomear**) |
| `origem_reserva` | `publico`, `equipe` |
| `origem_consentimento` | `publico`, `equipe` |
| `estado_assinatura` | `pendente`, `em_teste`, `ativa`, `em_carencia`, `suspensa`, `cancelada`, `encerrada` |
| `resultado_webhook` | `recebido`, `processado`, `ignorado`, `rejeitado`, `erro` |
| `tipo_mensagem` | `confirmacao`, `remarcacao`, `cancelamento` |
| `estado_mensagem` | `pendente`, `enviando`, `enviada`, `falhou`, `nao_enviada`, `substituida`, `cancelada_anonimizacao` |
| `resultado_tentativa` | `sucesso`, `falha` |
| `resultado_auditoria` | `sucesso`, `falha` |

### 3.3 Objetos de SQL bruto (o `migrate diff` não os enxerga, por isso o CA-1 os confere pelo nome)
Extensão: `btree_gist` (em `pg_extension`).

Exclusions (`pg_constraint.contype = 'x'`, SQLSTATE `23P01`):
| Nome | Tabela | Migração |
|---|---|---|
| `reserva_sem_sobreposicao` | `reserva` | `_reserva_exclusion` |
| `jornada_sem_sobreposicao` | `jornada` | `_restricoes_sql` |

CHECKs (`contype = 'c'`, SQLSTATE `23514`):
| Nome | Tabela | Regra |
|---|---|---|
| `reserva_ordem_chk` | `reserva` | `fim > inicio AND ocupado_ate >= fim` (migração `_reserva_exclusion`) |
| `cliente_anonimizacao_chk` | `cliente` | anonimizada ⇔ nome e telefone nulos |
| `cliente_telefone_e164_chk` | `cliente` | `^\+55[1-9][0-9]{9,10}$` |
| `mensagem_destinatario_e164_chk` | `mensagem` | mesmo formato (nulo é aceito) |
| `salao_slug_formato_chk` | `salao_slug` | `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `usuario_email_minusculo_chk` | `usuario` | `email = lower(email)` |
| `usuario_papel_salao_chk` | `usuario` | `(papel = 'super_admin') = (salao_id IS NULL)` |
| `convite_email_minusculo_chk` | `convite` | `email = lower(email)` |
| `jornada_dia_semana_chk` | `jornada` | `dia_semana BETWEEN 0 AND 6` |
| `jornada_faixa_chk` | `jornada` | `0 <= inicio_min < fim_min <= 1440` |
| `servico_preco_chk` | `servico` | `preco_centavos >= 0` |
| `servico_duracao_chk` | `servico` | `duracao_min > 0` |
| `reserva_item_preco_chk` | `reserva_item` | `preco_centavos >= 0` |
| `reserva_item_duracao_chk` | `reserva_item` | `duracao_min > 0` |
| `assinatura_pagamento_valor_chk` | `assinatura_pagamento` | `valor_centavos >= 0` |
| `bloqueio_ordem_chk` | `bloqueio` | `fim > inicio` |

Índices (`pg_indexes.indexname`). Os únicos parciais violados dão `23505` com `constraint` igual ao nome do índice:
| Nome | Definição |
|---|---|
| `usuario_gestor_por_salao_uniq` | UNIQUE `usuario (salao_id) WHERE papel = 'gestor'` |
| `salao_slug_atual_uniq` | UNIQUE `salao_slug (salao_id) WHERE atual` |
| `assinatura_vigente_por_salao_uniq` | UNIQUE `assinatura (salao_id) WHERE estado <> 'encerrada'` |
| `webhook_evento_dedupe_uniq` | UNIQUE `webhook_evento (provedor, chave_dedupe) WHERE origem_valida` |
| `reserva_cliente_confirmada_idx` | `reserva (salao_id, cliente_id, inicio) WHERE status = 'confirmado'` |
| `mensagem_pendentes_idx` | `mensagem (estado, criado_em) WHERE estado IN ('pendente','enviando','falhou')` |
| `bloqueio_periodo_idx` | GiST `bloqueio (salao_id, tstzrange(inicio, fim, '[)'))` |

As exclusions também criam índices com o próprio nome (`reserva_sem_sobreposicao`, `jornada_sem_sobreposicao`).

Função e triggers (`pg_trigger`, `NOT tgisinternal`):
| Trigger | Tabela | `tgtype` |
|---|---|---|
| `auditoria_somente_insercao_linha` | `auditoria` | 27 (BEFORE, ROW, UPDATE, DELETE) |
| `auditoria_somente_insercao_truncate` | `auditoria` | 34 (BEFORE, STATEMENT, TRUNCATE) |
| `assinatura_transicao_somente_insercao_linha` | `assinatura_transicao` | 27 |
| `assinatura_transicao_somente_insercao_truncate` | `assinatura_transicao` | 34 |

Função: `rejeitar_alteracao_somente_insercao()`, SQLSTATE `P0001`, mensagem `auditoria é somente inserção` ou `assinatura_transicao é somente inserção`.

### 3.4 Objetos gerados pelo Prisma que os testes usam (vêm do init e o diff os cobre)
- FKs compostas (`23503`): `reserva_salao_id_profissional_id_fkey`, `reserva_salao_id_cliente_id_fkey`, `reserva_item_salao_id_reserva_id_fkey`, `reserva_item_salao_id_servico_id_fkey`, `servico_profissional_salao_id_servico_id_fkey`, `servico_profissional_salao_id_profissional_id_fkey`, `jornada_salao_id_profissional_id_fkey`, `bloqueio_salao_id_profissional_id_fkey`, `mensagem_salao_id_reserva_id_fkey`, `consentimento_salao_id_cliente_id_fkey`, `convite_salao_id_profissional_id_fkey`, `profissional_salao_id_usuario_id_fkey`.
- Únicos (`23505`):
  - `cliente_salao_id_telefone_e164_key` (NULLS DISTINCT)
  - `salao_slug_pkey` (slug global)
  - `usuario_email_key`
  - `mensagem_reserva_id_tipo_revisao_key`
  - `assinatura_pagamento_pagamento_id_key`
  - `reserva_salao_id_chave_requisicao_key`
  - `profissional_salao_id_usuario_id_key`
  - `assinatura_provedor_assinatura_id_key`
  - alvos das FKs compostas: `<tabela>_salao_id_id_key` em `usuario`, `profissional`, `servico`, `cliente` e `reserva`.

### 3.5 Colunas obrigatórias sem default (para as fábricas da T-4)
- `salao`: `nome`.
- `salao_slug`: `slug`, `salao_id`, `atual`.
- `usuario`: `papel`, `email`, `nome`, `senha_hash`; `salao_id` só se o papel não for `super_admin`.
- `profissional`: `salao_id`, `nome`.
- `servico`: `salao_id`, `nome`, `preco_centavos`, `duracao_min`.
- `servico_profissional`: as 3 chaves.
- `jornada`: `salao_id`, `profissional_id`, `dia_semana`, `inicio_min`, `fim_min`.
- `bloqueio`: `salao_id`, `inicio`, `fim`.
- `cliente`: `salao_id`, mais `nome` e `telefone_e164` (ou `anonimizada_em` com os dois nulos).
- `consentimento`: `salao_id`, `cliente_id`, `origem`, `versao_termos`.
- **`reserva`**: `salao_id`, `profissional_id`, `cliente_id`, `inicio`, `fim`, `ocupado_ate` e **`origem`**. O `status` tem default `confirmado`, e `revisao` tem default 0.
- `reserva_item`: `salao_id`, `reserva_id`, `servico_id`, `ordem`, `preco_centavos`, `duracao_min`.
- `assinatura`: `salao_id` (o `estado` tem default `pendente`).
- `assinatura_pagamento`: `assinatura_id`, `pagamento_id`, `status`, `valor_centavos`.
- `assinatura_transicao`: `assinatura_id`, `para`, `causa`.
- `webhook_evento`: `provedor`, `chave_dedupe`, `payload`, `origem_valida`.
- `mensagem`: `salao_id`, `reserva_id`, `tipo`, `revisao`.
- `mensagem_tentativa`: `mensagem_id`, `numero`.
- `auditoria`: `acao`, `resultado`.

Exceções à coluna `criado_em` (o CA-15 confere `criado_em DEFAULT now()` só onde ela existe):
- `mensagem_tentativa` usa `iniciada_em` (`DEFAULT now()`), e não `criado_em`.
- `rate_limit_janela` não tem coluna de instante de registro. A PK é `(chave, janela_inicio)`, e `janela_inicio` é o início da janela, informado pela aplicação, sem default.
- Pelo mesmo motivo: `auditoria` usa `ocorrido_em`, `assinatura_transicao` usa `ocorrida_em` e `webhook_evento` usa `recebido_em`, todas com `DEFAULT now()`. `servico_profissional` tem `criado_em`, mas não tem `id` (PK composta).

## 4. Reversão

O Prisma não tem "migrate down". O SQL inverso está em comentário no cabeçalho de cada migração de SQL bruto (RN-14):
- `_restricoes_sql`: remove os triggers, a função, os 7 índices e as 17 constraints, em ordem inversa, e depois a linha em `_prisma_migrations`. Precisa ser revertida **antes** de `_reserva_exclusion`.
- `_reserva_exclusion`: `DROP CONSTRAINT reserva_sem_sobreposicao` e `reserva_ordem_chk`. A `btree_gist` **não** é removida.
- `_init`: não tem reversão parcial. Num ambiente sem dados, a reversão é `docker compose down -v` (dev) ou `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` numa base descartável. Num banco com dados, nenhum desses passos se aplica sem autorização explícita do usuário.
- As três migrações ficam **congeladas** depois do merge. Toda mudança futura cria uma migração nova, revisada pelo DBA. A revisão confere que nenhum objeto da §3.3 foi removido, porque o diff não acusa essa remoção (design R-1).

## 5. Consultas e desempenho

Esta demanda não exige `EXPLAIN` (design §4). Notas para as próximas:
- **E3.1/E3.2:** a consulta de ocupação precisa repetir `status IN ('confirmado','concluido','nao_compareceu') AND tstzrange(inicio, ocupado_ate, '[)') && …`, para usar o índice GiST de `reserva_sem_sobreposicao`.
- **E3.1:** a consulta de bloqueios usa `salao_id = $1 AND tstzrange(inicio, fim, '[)') && …` (`bloqueio_periodo_idx`).
- **E4.2:** a contagem de reservas futuras usa `salao_id = $1 AND cliente_id = $2 AND status = 'confirmado' AND inicio > now()` (`reserva_cliente_confirmada_idx`).

## 6. Evidências (projeto compose isolado `-p dba-d004`, `POSTGRES_PORT=55841`, PG 17, removido com `down -v` ao final)

```
$ npx prisma validate                       → The schema at prisma/schema.prisma is valid
$ npm run db:generate                       → Generated Prisma Client (7.10.1)
$ grep -c CASCADE init/migration.sql        → 0
$ grep -c "SET NULL" init/migration.sql     → 0
$ grep -c "ON DELETE RESTRICT ON UPDATE RESTRICT" init/migration.sql → 35 (= nº de FOREIGN KEY)
$ npx prisma migrate deploy (base vazia)    → 20261118000000_init, 20261118000100_reserva_exclusion,
                                              20261118000200_restricoes_sql — "All migrations have been successfully applied."
$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
                                            → "No difference detected.", exit 0
$ npx prisma migrate dev  (sem --create-only) → "Already in sync, no schema change or pending migration was found."
                                              (nenhuma pasta nova em prisma/migrations)
Controle negativo: DROP INDEX reserva_salao_id_inicio_idx → diff "Added index on columns (salao_id, inicio)", exit 2
Catálogo: 24 tabelas (lista da §3.1); btree_gist 1.7; 2 exclusions + 16 CHECKs da §3.3; 7 índices da §3.3;
          4 triggers (tgtype 27/34); 35 FKs, 0 com confdeltype/confupdtype ≠ 'r'; 0 colunas timestamp sem fuso; 11 enums
Reset: DROP SCHEMA public CASCADE; CREATE SCHEMA public  (com 1 linha em auditoria) → ok, sem disparar trigger;
       migrate deploy → aplicadas as 3; 2º migrate deploy → "No pending migrations to apply."; diff → exit 0
$ npm run lint / npm run typecheck          → exit 0 / exit 0
```

Fumaça por SQL (não substitui a T-4). Cada caso deu o resultado esperado:

| Caso | Resultado |
|---|---|
| CA-2 sobreposição | `23P01` / `reserva_sem_sobreposicao` |
| CA-4 adjacência | aceita |
| CA-5 outro profissional | aceita |
| CA-6 `ocupado_ate` 10:45 contra 10:30 | `23P01` |
| CA-3 cancelado libera | aceita |
| CA-7 UPDATE cancelado → confirmado | `23P01` |
| CA-8 (×3) | `reserva_ordem_chk` |
| CA-9 profissional e cliente de B | `reserva_salao_id_profissional_id_fkey` e `reserva_salao_id_cliente_id_fkey` |
| Bloqueio de salão (nulo) | aceito |
| Bloqueio com profissional de B | `bloqueio_salao_id_profissional_id_fkey` |
| CA-10 | duplicado `cliente_salao_id_telefone_e164_key`; 2 anonimizadas aceitas; incoerente `cliente_anonimizacao_chk` |
| CA-16 | `+551133334444` aceito; `11987654321`, `+5501987654321` e `+55119876543210` → `cliente_telefone_e164_chk` |
| CA-11 | slug de outro salão `salao_slug_pkey`; 2º atual `salao_slug_atual_uniq`; `a--b` `salao_slug_formato_chk` |
| CA-18 | `usuario_gestor_por_salao_uniq`, `usuario_email_minusculo_chk`, `usuario_papel_salao_chk` (×2) |
| CA-12 | INSERT aceito; UPDATE, DELETE e TRUNCATE → `P0001` `auditoria é somente inserção` |
| CA-13/19 | 540–720 e 720–1080 na segunda e 540–720 na terça aceitos; 600–660 → `jornada_sem_sobreposicao`; 600–600 e 600–1441 → `jornada_faixa_chk`; dia 7 → `jornada_dia_semana_chk` |
| CA-20 | `ativo = t`; defaults do salão `America/Sao_Paulo`/15/120/60/0 |
| CA-17 | webhook falso + válido aceitos e 2º válido `webhook_evento_dedupe_uniq`; encerrada + pendente aceitas e 2ª vigente `assinatura_vigente_por_salao_uniq` |
| Virada de dia com `SET TIME ZONE 'America/Sao_Paulo'` | 23:30Z–00:30Z e 00:29:59Z–01:00Z → `23P01` (1 s de sobreposição) |

## 7. Orientações para o desenvolvedor

- **T-4:** as asserções usam os nomes da §3 por igualdade (`err.code` e `err.constraint` do driver `pg`). Num índice único parcial violado, o `err.constraint` traz o nome do **índice**. No CHECK de `P0001` não há `constraint`: confira `err.code === 'P0001'` e a mensagem.
- Os inserts de `reserva` precisam informar `origem` (§3.5).
- **E3.2:** traduza `23P01` + `constraint === 'reserva_sem_sobreposicao'` para "horário indisponível". Trate `23505` em `reserva_salao_id_chave_requisicao_key` devolvendo a reserva existente. Os demais `23505`/`23514` são erro de validação ou bug, nunca "horário indisponível".
- O Prisma não conhece os objetos da §3.3. Nunca rode `prisma db push`. Se um `migrate dev` propuser remover algo, pare e acione o DBA.
- Uma nova migração é criada com `npx prisma migrate dev --create-only --name <nome>` e revisada **antes** de ser aplicada. O SQL bruto vai em migração própria, com o SQL inverso em comentário.

## 8. Pendências e riscos
- R-1 (design): o diff não protege os objetos da §3.3. A mitigação é o CA-1 por catálogo, mais a revisão do DBA em toda migração futura.
- A retenção de `webhook_evento` rejeitados e a limpeza de `sessao`, `token` e `rate_limit_janela` ficam para os itens donos (E4.2, E6.2, E1.x). Os índices `*_expira_em_idx` e `rate_limit_janela_janela_inicio_idx` já atendem essas limpezas.
- Separar o papel de migração do papel da aplicação (para impedir `DISABLE TRIGGER`) fica para depois da v1 (D-001 E8.1).
