# D-007 — Parecer do DBA (T-1): tabelas dos adaptadores simulados

Autor: dba. Entradas: `docs/demandas/D-007/design.md` (§1, §3.4, §3.5, §3.10, §4, §9 T-1), `spec.md` (RN-15, RN-17..RN-19, CA-15..CA-21, CA-24, D-2, D-4, D-5), `docs/demandas/D-004/dba.md` (contrato de nomes), `docs/demandas/D-005/dba.md` (harness de template), `prisma/schema.prisma`, `prisma/migrations/**`, `tests/integration/db/drift.test.ts`, `tests/integration/harness/template.test.ts`.

**Veredito: §4 do desenho aceito com ajustes A-1..A-7.** Nenhum ajuste muda as interfaces do §3.10. Todos cabem no T-5, que deve aplicá-los. O A-1 e o A-2 mudam nomes ou tipos da proposta inicial.

Arquivos entregues:
- `prisma/schema.prisma`: seção "Adaptadores simulados" no fim, com 4 enums e 6 models.
- `prisma/migrations/20261119000000_simuladores_integracao/migration.sql`. A parte 1 foi gerada por `prisma migrate diff` e não foi editada. A parte 2 é SQL bruto: 4 CHECKs e `COMMENT ON TABLE`. O cabeçalho traz o rollback.
- `tests/integration/db/drift.test.ts`: tabelas 24 → 30, enums +4, CHECKs +4, FKs 35 → 37, migração nova no CA-22 e um bloco novo, `CA-24 (D-007)`.
- `tests/integration/harness/template.test.ts`: `MIGRACOES` com a migração nova.

## 1. Impacto e compatibilidade

- **Só cria objetos**: 4 tipos, 6 tabelas vazias, 7 índices, 2 FKs, 4 CHECKs e 6 comentários. Nenhuma tabela, tipo ou dado existente é alterado.
- **Locks e tempo**: nenhum lock em tabela existente. O `migrate deploy` levou cerca de 1 s numa base com dados prévios.
- **Bancos existentes**: o `migrate deploy` do entrypoint da app aplica a migração nova sem intervenção, porque a migração é aditiva. Isso foi provado numa base com as 3 migrações da D-004 e dados em `salao` e `email_log` (§9).
- **Harness (D-005)**: o template é recriado a cada execução com todas as migrações. Os testes só precisaram da lista `MIGRACOES` atualizada.

## 2. Respostas aos itens 1 a 8 do §4 do desenho

### 2.1 Contrato da D-004 (item 1)
- Toda tabela nova tem `id uuid DEFAULT gen_random_uuid()` e `criado_em timestamptz(6) DEFAULT now()` (o Prisma grava `CURRENT_TIMESTAMP`).
- Todas as datas são `timestamptz(6)`.
- As 2 FKs novas são `ON DELETE RESTRICT ON UPDATE RESTRICT`.
- **`ocorrido_em` → `cobrado_em` (A-1).** A coluna de `sim_mp_pagamento` passou a se chamar `cobrado_em` (Prisma `cobradoEm`). Ela continua sem default, porque é o instante do disparo, com relógio controlado nos testes.
  - Motivo: no catálogo, `ocorrido_em` significa "instante de registro com `now()`" (`auditoria`). O `drift.test.ts` confere essa regra por nome de coluna. Renomear preserva a convenção sem afrouxar a asserção.
  - A porta continua expondo `PagamentoProvedor.ocorridoEm`, e o repositório faz o mapeamento.
  - O teste novo do CA-24 fixa que `cobrado_em` é `NOT NULL` e não tem default.
- `drift.test.ts` atualizado (lista completa na §3). O teste "toda coluna `id`" e o teste "instantes de registro" passam sem mudar as exceções: todas as tabelas novas têm `id` e `criado_em`.

### 2.2 Sem FK para o domínio (item 2, D-2): confirmado
- `sim_mp_assinatura.referencia_externa` é `text NOT NULL`, sem FK. Ele guarda o `salaoId` como o `external_reference` do MP.
- As únicas FKs são `sim_mp_pagamento → sim_mp_assinatura` e `sim_mp_adiamento → sim_mp_assinatura`.
- Um teste novo garante que nenhuma FK liga `sim_*` ao domínio, nos dois sentidos.
- Consequência aceita: apagar um salão nunca é bloqueado por linhas `sim_*`, e uma referência a um salão inexistente é aceita, como no provedor real. A E6.2 resolve o salão pela referência e precisa tratar referência desconhecida.

### 2.3 Enums × `text` (item 3)
- **`modelo`: `text` (A-2), e não `tipo_mensagem`.**
  - Pela RN-19 e pelo §3.10, uma chamada reprovada em `validarEnvioModelo` é **registrada** como `falha`/`permanente`. Com o enum, um `modelo` fora da lista (possível em runtime, por exemplo vindo de JS ou de dado corrompido) faria o `INSERT` falhar com `22P02`, e a chamada não seria registrada.
  - Como `text`, a coluna guarda exatamente o nome do template que o "provedor" recebeu e desacopla o simulado do domínio.
  - Sem CHECK, de propósito.
- **`resultado`: reaproveita `resultado_tentativa` (`sucesso`, `falha`).** O valor é produzido pelo próprio simulado, nunca vem da entrada, e tem a mesma semântica do domínio. O acoplamento é aceitável: mudar esse enum já exige migração e revisão do DBA. O rollback não remove o tipo.
- **Enums próprios**: `sim_mp_estado_assinatura`, `sim_mp_status_pagamento`, `sim_mp_operacao` (os 5 nomes de `OPERACOES_MP`, em camelCase, para o repositório repassar a string sem tradução) e `sim_whatsapp_tipo_falha`.

### 2.4 SQL do consumo atômico (item 4): aprovado (§4.1 e §4.2)
- O consumo usa uma subconsulta escalar com `FOR UPDATE SKIP LOCKED`. No plano, ela é um `InitPlan`, executado **uma vez** por instrução (§6). Não use `IN (…)`.
- No WhatsApp, o consumo e o `INSERT` da chamada ficam numa **única instrução** (CTE com `DELETE`), o que dispensa a transação interativa (A-5). Se o `INSERT` falhar (por exemplo, por CHECK), o `DELETE` é desfeito junto.
- Provas em PostgreSQL 17 real, com pool de 16 conexões:
  - 200 rodadas de 12 envios concorrentes com 1 falha forçada: sempre exatamente 1 falha, 12 linhas e a fila vazia;
  - 100 rodadas com 5 falhas forçadas: sempre exatamente 5 falhas;
  - 20 falhas e 12 envios: 12 falhas e 8 restantes;
  - ordem FIFO (2 temporárias e depois 1 permanente): `temporaria, temporaria, permanente, sucesso`;
  - **controle negativo** (a mesma instrução sem `FOR UPDATE SKIP LOCKED`): em 50 de 50 rodadas, o número de falhas foi diferente de 5. Os concorrentes escolhem a mesma linha, só um a apaga e a falha forçada "sobra".
- **Deadlock com o MP: impossível pela ordem de travas.** O `SKIP LOCKED` nunca espera. Cada transação do MP trava no máximo **uma** linha de `sim_mp_assinatura` e espera só por ela. Sem duas esperas encadeadas, não há ciclo. Isso vale também se o T-5 consumir o erro forçado dentro da mesma transação da operação.
  - Provado em 50 rodadas com 7 operações concorrentes sobre a mesma assinatura (2 cobranças, 1 adiamento, 2 consumos de erro forçado, cancelamento e mais 1 cobrança): 0 erros, 0 deadlocks, exatamente 1 consumo, estado final `cancelada`.

### 2.5 Transições do MP simulado (item 5): aprovado (§4.3)
- `autorizar` e `cancelar` usam um `UPDATE … WHERE id = $1 AND estado = …` condicional. Se afetar 0 linhas, o repositório relê o estado para distinguir `nao_encontrada`, `estado_invalido` e `ja_cancelada`.
  - Prova: 8 `autorizar` concorrentes, em 50 rodadas, deram sempre exatamente 1 com `rowCount = 1`. Em `READ COMMITTED`, o segundo `UPDATE` espera a trava, reavalia o `WHERE` sobre a versão nova e não casa mais.
- `registrarCobranca` e `adiar` usam `SELECT … FOR UPDATE` da assinatura **antes** de qualquer escrita, depois o `INSERT` do filho e depois o `UPDATE`, numa só transação. A próxima data é calculada sobre o valor lido **sob trava**.
  - Prova: 6 aprovações concorrentes geraram 6 pagamentos, e a próxima cobrança avançou exatamente 6 meses.
  - Um disparo gera um pagamento. Dois disparos simultâneos geram dois, legítimos, e nunca um duplicado.

### 2.6 Presença em produção (item 6): aceito
- As tabelas existem vazias em produção (adaptadores reais). O custo é desprezível: 6 tabelas e 7 índices vazios.
- Separá-las num schema próprio exigiria `multiSchema` e mudaria o harness (§1.1 do desenho). Mantive o prefixo `sim_` em `public`.
- Acrescentei um `COMMENT ON TABLE` em cada uma: `Somente adaptador simulado do <Mercado Pago|WhatsApp> (D-007). Vazia em produção.` O `drift.test.ts` confere o comentário e confere que as tabelas estão vazias no template.
- **CA-24**: nenhuma coluna guarda cartão, segredo ou token de provedor. O teste fixa a lista exata de colunas e aplica um filtro de nomes (`cart|card|cvv|pan|token|secret|segredo|senha|password|access|chave_api`).
  - `chave_idempotencia` não é segredo: é o `reserva:tipo:revisao`.
  - `provedor_mensagem_id` é um identificador público (`wamid`).
- Risco D-5 (simulado ligado num ambiente publicado): as tabelas passariam a acumular dados pessoais. O registro fica com o DevOps (T-8). O comentário de tabela torna a anomalia visível a quem inspecionar a base.

### 2.7 Dados pessoais (item 7, D-4): confirmado, com procedimento de limpeza
- `sim_mp_assinatura.email_pagador` (e-mail do gestor) e `sim_whatsapp_chamada.destinatario` (telefone da cliente), mais os `parametros` (que podem conter o nome da cliente), ficam **fora** da anonimização da E5.2. Também ficam fora de qualquer tela.
- Isso é aceitável porque só existem no modo simulado, que não é para publicação (README, T-7).
- A E5.2 **não** deve tocar `sim_*`, para não acoplar o domínio ao simulado.
- Limpeza manual, só na base local ou de teste (é destrutiva: fora delas, precisa de autorização do usuário):
  ```sql
  DELETE FROM sim_mp_pagamento; DELETE FROM sim_mp_adiamento; DELETE FROM sim_mp_assinatura;
  DELETE FROM sim_mp_erro_forcado; DELETE FROM sim_whatsapp_chamada; DELETE FROM sim_whatsapp_falha_forcada;
  ```
  A alternativa é `docker compose down -v`. Sugestão ao T-7: citar no README, junto do aviso de que o modo simulado não é para publicação.
- `email_log` (D-004) já guarda o destinatário em claro. São e-mails de equipe, não de cliente, e a anonimização de cliente não se aplica a eles. Sem mudança.

### 2.8 Down (item 8)
O cabeçalho da migração traz o rollback manual: `DROP TABLE` dos filhos e depois dos pais, `DROP TYPE` dos 4 enums `sim_*` (`resultado_tentativa` **não** é removido) e `DELETE` em `_prisma_migrations`. Foi executado de verdade numa base descartável com dados (§9): os dados de domínio ficaram intactos, e o reaplicar e o diff saíram limpos.

## 3. Contrato de nomes (consumido pelo T-5; nomes fixos)

### 3.1 Enums
| Tipo no banco | Enum Prisma | Valores |
|---|---|---|
| `sim_mp_estado_assinatura` | `SimMpEstadoAssinatura` | `pendente`, `autorizada`, `cancelada` |
| `sim_mp_status_pagamento` | `SimMpStatusPagamento` | `aprovado`, `recusado` |
| `sim_mp_operacao` | `SimMpOperacao` | `criarAssinatura`, `consultarAssinatura`, `consultarPagamento`, `cancelarAssinatura`, `adiarProximaCobranca` |
| `sim_whatsapp_tipo_falha` | `SimWhatsappTipoFalha` | `temporaria`, `permanente` |
| `resultado_tentativa` (D-004, reaproveitado) | `ResultadoTentativa` | `sucesso`, `falha` |

### 3.2 Tabelas e colunas (delegate Prisma entre parênteses)
`NN` = `NOT NULL`. Todo `*_em`/`*_data` é `timestamptz(6)`.

**`sim_mp_assinatura`** (`simMpAssinatura`)
| Coluna | Campo Prisma | Tipo | Regra |
|---|---|---|---|
| `id` | `id` | uuid | PK, `gen_random_uuid()` |
| `referencia_externa` | `referenciaExterna` | text NN | `salaoId`, sem FK |
| `email_pagador` | `emailPagador` | text NN | |
| `url_retorno` | `urlRetorno` | text NN | |
| `estado` | `estado` | `sim_mp_estado_assinatura` NN | default `pendente` |
| `valor_centavos` | `valorCentavos` | int NN | **sem default** (vem de `plano.ts`); `> 0` |
| `autorizada_em` | `autorizadaEm` | timestamptz | anulável |
| `proxima_cobranca_em` | `proximaCobrancaEm` | timestamptz | anulável |
| `cancelada_em` | `canceladaEm` | timestamptz | anulável |
| `criado_em` | `criadoEm` | timestamptz NN | `now()` |
| `atualizado_em` | `atualizadoEm` | timestamptz NN | `now()` + `@updatedAt`; **SQL bruto precisa gravar `atualizado_em = now()`** |

Índice: `sim_mp_assinatura_referencia_externa_idx (referencia_externa)`.

**`sim_mp_pagamento`** (`simMpPagamento`)
| Coluna | Campo Prisma | Tipo | Regra |
|---|---|---|---|
| `id` | `id` | uuid | PK |
| `assinatura_id` | `assinaturaId` | uuid NN | FK `sim_mp_pagamento_assinatura_id_fkey`, RESTRICT/RESTRICT |
| `status` | `status` | `sim_mp_status_pagamento` NN | |
| `valor_centavos` | `valorCentavos` | int NN | `> 0` |
| `cobrado_em` | `cobradoEm` | timestamptz NN | **sem default**; a porta o expõe como `ocorridoEm` |
| `criado_em` | `criadoEm` | timestamptz NN | `now()` |

Índice: `sim_mp_pagamento_assinatura_id_cobrado_em_idx (assinatura_id, cobrado_em)`.

**`sim_mp_adiamento`** (`simMpAdiamento`)
| Coluna | Campo Prisma | Tipo | Regra |
|---|---|---|---|
| `id` | `id` | uuid | PK |
| `assinatura_id` | `assinaturaId` | uuid NN | FK `sim_mp_adiamento_assinatura_id_fkey` |
| `data_anterior` | `dataAnterior` | timestamptz | anulável |
| `nova_data` | `novaData` | timestamptz NN | |
| `criado_em` | `criadoEm` | timestamptz NN | `now()` |

Índice: `sim_mp_adiamento_assinatura_id_criado_em_idx (assinatura_id, criado_em)`.

**`sim_mp_erro_forcado`** (`simMpErroForcado`)
| Coluna | Campo Prisma | Tipo | Regra |
|---|---|---|---|
| `id` | `id` | uuid | PK |
| `operacao` | `operacao` | `sim_mp_operacao` NN | |
| `criado_em` | `criadoEm` | timestamptz NN | `now()` |

Índice: `sim_mp_erro_forcado_operacao_criado_em_id_idx (operacao, criado_em, id)` (A-4: inclui `id`, que desempata a ordem).

**`sim_whatsapp_chamada`** (`simWhatsappChamada`)
| Coluna | Campo Prisma | Tipo | Regra |
|---|---|---|---|
| `id` | `id` | uuid | PK |
| `destinatario` | `destinatario` | text NN | sem CHECK de E.164 (chamada inválida também é registrada) |
| `modelo` | `modelo` | **text** NN | sem CHECK (A-2) |
| `parametros` | `parametros` | jsonb NN | |
| `chave_idempotencia` | `chaveIdempotencia` | text NN | **sem UNIQUE** (o simulado não deduplica) |
| `resultado` | `resultado` | `resultado_tentativa` NN | |
| `tipo_falha` | `tipoFalha` | `sim_whatsapp_tipo_falha` | anulável |
| `provedor_mensagem_id` | `provedorMensagemId` | text | anulável |
| `criado_em` | `criadoEm` | timestamptz NN | `now()` |

Índices: `sim_whatsapp_chamada_chave_idempotencia_idx (chave_idempotencia)` e `sim_whatsapp_chamada_criado_em_idx (criado_em)`.

**`sim_whatsapp_falha_forcada`** (`simWhatsappFalhaForcada`)
| Coluna | Campo Prisma | Tipo | Regra |
|---|---|---|---|
| `id` | `id` | uuid | PK |
| `tipo` | `tipo` | `sim_whatsapp_tipo_falha` NN | |
| `criado_em` | `criadoEm` | timestamptz NN | `now()` |

Índice: `sim_whatsapp_falha_forcada_criado_em_id_idx (criado_em, id)`.

### 3.3 CHECKs de SQL bruto (SQLSTATE `23514`, A-3)
| Nome | Tabela | Regra |
|---|---|---|
| `sim_mp_assinatura_estado_chk` | `sim_mp_assinatura` | `pendente` ⇒ `autorizada_em` e `proxima_cobranca_em` nulos; `autorizada` ⇒ ambos preenchidos; `cancelada` ⇔ `cancelada_em` preenchido |
| `sim_mp_assinatura_valor_chk` | `sim_mp_assinatura` | `valor_centavos > 0` |
| `sim_mp_pagamento_valor_chk` | `sim_mp_pagamento` | `valor_centavos > 0` |
| `sim_whatsapp_chamada_resultado_chk` | `sim_whatsapp_chamada` | `sucesso` ⇔ `tipo_falha` nulo e `provedor_mensagem_id` preenchido; `falha` ⇔ `tipo_falha` preenchido e `provedor_mensagem_id` nulo |

Os CHECKs só pegam bug de implementação. O T-5 nunca deve depender deles para validar regras de negócio, porque a validação acontece antes (estado esperado no `WHERE` e `validarEnvioModelo`).

## 4. SQL aprovados (para os repositórios do T-5, via `$queryRaw`/`$executeRaw` com template marcado)

Os parâmetros de enum precisam de cast explícito (`${status}::sim_mp_status_pagamento`). Nas colunas de enum devolvidas, use `::text`.

### 4.1 WhatsApp: `registrarChamada` (uma instrução, sem transação interativa)
```sql
WITH falha AS (
  DELETE FROM sim_whatsapp_falha_forcada
  WHERE id = (SELECT id FROM sim_whatsapp_falha_forcada
              ORDER BY criado_em, id LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING tipo
)
INSERT INTO sim_whatsapp_chamada
  (destinatario, modelo, parametros, chave_idempotencia, resultado, tipo_falha, provedor_mensagem_id)
SELECT $destinatario, $modelo, $parametros::jsonb, $chave,
       CASE WHEN f.tipo IS NULL THEN 'sucesso' ELSE 'falha' END::resultado_tentativa,
       f.tipo,
       CASE WHEN f.tipo IS NULL THEN $provedorMensagemId END     -- gerarId() calculado antes
FROM (SELECT 1) AS um LEFT JOIN falha AS f ON true
RETURNING id, resultado::text AS resultado, tipo_falha::text AS tipo_falha, provedor_mensagem_id;
```
Chamada inválida (`invalida: true`): faz um `INSERT` simples com `resultado = 'falha'`, `tipo_falha = 'permanente'` e `provedor_mensagem_id = NULL`, **sem** o CTE, ou seja, sem consumir falha forçada. A forma equivalente em transação (`BEGIN; DELETE … RETURNING; INSERT …; COMMIT`, em `READ COMMITTED`) também é aceita. A forma de instrução única é a preferida.

`forcarFalhas(n, tipo)` (`n ≥ 1`, validado na aplicação):
```sql
INSERT INTO sim_whatsapp_falha_forcada (tipo)
SELECT $tipo::sim_whatsapp_tipo_falha FROM generate_series(1, $n);
```

### 4.2 MP: `consumirErroForcado(operacao)` → `true` se `RETURNING` devolveu uma linha
```sql
DELETE FROM sim_mp_erro_forcado
WHERE id = (SELECT id FROM sim_mp_erro_forcado
            WHERE operacao = $operacao::sim_mp_operacao
            ORDER BY criado_em, id LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id;
```

### 4.3 MP: transições
```sql
-- autorizar (0 linhas → SELECT estado::text FROM sim_mp_assinatura WHERE id = $id: null = nao_encontrada; senão estado_invalido)
UPDATE sim_mp_assinatura
SET estado = 'autorizada', autorizada_em = $em, proxima_cobranca_em = $proxima, atualizado_em = now()
WHERE id = $id AND estado = 'pendente';

-- cancelar (0 linhas → reler: 'cancelada' = ja_cancelada; null = nao_encontrada)
UPDATE sim_mp_assinatura
SET estado = 'cancelada', cancelada_em = $em, atualizado_em = now()
WHERE id = $id AND estado IN ('pendente', 'autorizada');

-- registrarCobranca, numa transação ($transaction interativa, READ COMMITTED):
SELECT estado::text AS estado, proxima_cobranca_em FROM sim_mp_assinatura WHERE id = $id FOR UPDATE;
--   nenhuma linha → nao_encontrada; estado <> 'autorizada' → estado_invalido (retorna sem escrever)
INSERT INTO sim_mp_pagamento (assinatura_id, status, valor_centavos, cobrado_em)
VALUES ($id, $status::sim_mp_status_pagamento, $valor, $em) RETURNING id;
--   só se aprovado, com somarUmMes(proxima_cobranca_em LIDA ACIMA):
UPDATE sim_mp_assinatura SET proxima_cobranca_em = $novaProxima, atualizado_em = now() WHERE id = $id;

-- adiar, numa transação:
SELECT estado::text AS estado, proxima_cobranca_em FROM sim_mp_assinatura WHERE id = $id FOR UPDATE;
--   nao_encontrada / estado_invalido (≠ autorizada) / data_invalida (novaData <= agora) → retorna sem escrever
INSERT INTO sim_mp_adiamento (assinatura_id, data_anterior, nova_data) VALUES ($id, $proximaLida, $novaData);
UPDATE sim_mp_assinatura SET proxima_cobranca_em = $novaData, atualizado_em = now() WHERE id = $id;
```
Os IDs que não são UUID devem ser recusados na aplicação, **antes** do SQL (`nao_encontrada`), como na D-005. Senão o cast gera `22P02`.

As operações simples (`criarAssinatura`, `buscarAssinatura`, `buscarPagamento`, `listarAdiamentos`, `listarChamadas`, `forcarErro`) podem usar o cliente Prisma tipado (`db.simMpAssinatura.create` etc.). O `@updatedAt` só é aplicado por esse caminho.

## 5. Reversão
Está no cabeçalho de `migration.sql`: o SQL inverso completo, executado e provado (§9). Também é preciso reverter o trecho "Adaptadores simulados" do `schema.prisma`. Antes do merge, a reversão equivale a apagar a pasta da migração (as bases de teste são recriadas). Depois do merge, a migração fica **congelada**, e qualquer mudança é feita numa migração nova, revisada pelo DBA.

## 6. Consultas e `EXPLAIN`
As tabelas são pequenas: dezenas de linhas por execução de teste. O risco de desempenho é nulo, e o `EXPLAIN` serviu para provar a **semântica**:
```
Delete on sim_mp_erro_forcado
  InitPlan 1
    ->  Limit
          ->  LockRows
                ->  Index Scan using sim_mp_erro_forcado_operacao_criado_em_id_idx …
                      Index Cond: (operacao = 'cancelarAssinatura'::sim_mp_operacao)
  ->  Index Scan … Index Cond: (id = (InitPlan 1).col1)
```
- A subconsulta é um `InitPlan` (uma execução) com `LockRows` abaixo do `Limit`. O registro de `sim_whatsapp_chamada` tem a mesma forma, dentro do CTE.
- `listarChamadas({ chaveIdempotencia })` usa `sim_whatsapp_chamada_chave_idempotencia_idx`.
- `listarAdiamentos` usa `(assinatura_id, criado_em)`.

## 7. Testes
- **Criados** (`drift.test.ts`, bloco `CA-24 (D-007)`):
  - as 6 tabelas existem, vazias e com o comentário;
  - nenhuma FK `sim_* ↔ domínio`;
  - a lista exata de colunas por tabela, sem coluna de cartão, segredo ou token;
  - `modelo` é `text`, e `cobrado_em` é `NOT NULL` sem default.
  - O catálogo do CA-1/CA-15/CA-22 também foi atualizado.
- **Para o T-5** (`whatsapp-concorrencia.test.ts`, `mp-simulado.test.ts`): reproduzir as provas da §2.4 e da §2.5 pela porta. O laço de 10 execuções do CA-21 fica com o T-7/T-9. A mutação "tirar `SKIP LOCKED`" deve reprovar o CA-21 com 1 falha **e** um caso com várias falhas forçadas. Com 1 só falha forçada, a versão sem trava também dá exatamente 1 falha, porque o `DELETE … RETURNING` já é atômico. Sugestão: no CA-21, acrescentar um caso com N = 12 e 5 falhas forçadas, esperando exatamente 5.

## 8. Orientações para o desenvolvedor (T-5)
1. Aplicar A-1 (`cobrado_em`/`cobradoEm` ↔ `ocorridoEm` da porta) e A-2 (`modelo` como string).
2. Usar exatamente os SQL da §4. Todo `UPDATE` bruto em `sim_mp_assinatura` grava `atualizado_em = now()`.
3. Respeitar o `sim_mp_assinatura_estado_chk`: autorizar grava `autorizada_em` e `proxima_cobranca_em` juntos, e cancelar grava `cancelada_em`.
4. Um `23514` vindo de um CHECK `sim_*` é bug. Não traduza esse erro em erro de porta: deixe-o propagar.
5. Os repositórios usam o executor recebido ou `obterPrisma()` resolvido na chamada, **fora** da transação do chamador (RN-15). Para as transações de §4.3, use `$transaction` interativo sobre esse executor, com o nível padrão (`READ COMMITTED`).
6. Não há `salao_id` nem escopo de tenant nessas tabelas. Elas não podem ser expostas por nenhuma ação de tenant.

## 9. Evidências (PostgreSQL 17 do compose; bases descartáveis `dba_d007_*`, criadas de `template0` e apagadas no fim)
```
$ npx prisma format && npx prisma validate        → schema válido; diff do schema = só a seção nova (+136 linhas, 0 removidas)
Geração da parte 1: base dba_d007_scratch com as 3 migrações da D-004 (config temporária no scratchpad apontando só para elas)
$ npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script   → copiado sem edição
Base limpa (dba_d007_limpo):
$ npx prisma migrate deploy                        → 4 migrações aplicadas
$ npx prisma migrate diff … --exit-code            → "No difference detected", exit 0 (COMMENT e CHECK não geram drift)
$ npx prisma migrate dev                           → "Already in sync, no schema change or pending migration was found."
Base com dados (dba_d007_dados: 3 migrações + 2 salões + 1 email_log):
$ npx prisma migrate deploy                        → aplica só 20261119000000_simuladores_integracao (~1,1 s); dados intactos (2/1); diff exit 0
Rollback (SQL do cabeçalho)                        → 0 objetos sim_*, tipo_mensagem/resultado_tentativa preservados, 2 salões;
                                                     migrate deploy reaplica; diff exit 0
Provas de concorrência e CHECK (node + pg, pool 16): 20/20 verificações ok (§2.4, §2.5; CHECKs → 23514 com o nome certo;
                                                     DELETE de assinatura com pagamento → 23503 sim_mp_pagamento_assinatura_id_fkey)
$ npm run db:generate                              → Generated Prisma Client (7.10.1)
$ npm run typecheck                                → exit 0
$ npm run lint                                     → exit 0
$ npm run test:integration                         → 26 arquivos, 545 testes passando (drift: 18 testes, incluindo os 3 do CA-24)
```
Na hora da medição, a árvore de trabalho continha as mudanças em andamento do T-2 e do T-3, e os três comandos passaram com elas.

## 10. Pendências e riscos
- **D-5** (simulado num ambiente publicado acumula dados pessoais em `sim_*`): fica com o DevOps (T-8) e com a etapa de publicação.
- **E6.2**: tratar `referencia_externa` desconhecida (sem FK, §2.2).
- **E5.2**: não tocar `sim_*` (§2.7).
- Migrações futuras: o diff não protege os 4 CHECKs nem os comentários. A proteção é o `drift.test.ts` (catálogo), como na D-004 R-1.
