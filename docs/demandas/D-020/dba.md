# D-020 — Parecer do DBA (T-0): perfil público e horário de funcionamento do salão

Entradas: `docs/demandas/D-020/spec.md`, `docs/demandas/D-020/design.md` (§0, §3.5, §4 e a transferência), `CLAUDE.md`, `prisma/schema.prisma`, migrações `20261118000200_restricoes_sql` (jornada, `cliente_telefone_e164_chk`) e `20261119000000_simuladores_integracao` (padrão de cabeçalho), `src/lib/texto.ts` (`normalizarNome`), `tests/integration/db/*` e `tests/support/sql.ts`.

**Veredito: aprovado, com os CHECKs de defesa do perfil e sem índice btree próprio em `salao_funcionamento`.** As interfaces de §3 do desenho não mudam: nomes de colunas, tipos e o delegate Prisma são os previstos. Há duas diferenças em relação ao §4. Nenhuma das duas muda código de aplicação:

> **Diferenças em relação ao §4 do desenho (sem impacto em §3):**
> 1. **Sem `@@index([salaoId, diaSemana])`** em `SalaoFuncionamento`. O índice GiST da exclusion começa por `salao_id` e atende as três leituras e a FK (§5, com `EXPLAIN`).
> 2. **As listas `meios_pagamento` e `comodidades` são `NOT NULL` por `ALTER COLUMN … SET NOT NULL` na parte 2.** O Prisma cria `text[]` **anulável** para `String[]` e não compara a nulidade de listas no diff (verificado: `No difference detected` com a coluna `NOT NULL`). O default gerado é `ARRAY[]::TEXT[]` (equivale a `'{}'`). O `drift.test.ts` confere a nulidade no catálogo.
>
> **Os CHECKs de texto são mais amplos que o §4** (uma linha, sem espaço nas pontas, sem caractere de controle, além do tamanho). Eles foram calibrados para nunca recusar o que a validação de §3.3 produz (§2.1).

## 1. Impacto e compatibilidade

- **Migração:** `prisma/migrations/20261120000000_perfil_funcionamento/migration.sql`. A parte 1 é gerada pelo `prisma migrate diff` e não foi editada: comparei byte a byte com um diff novo sobre uma base com as 4 migrações anteriores. A parte 2 é SQL bruto. O cabeçalho registra impacto e reversão (§3).
- **Aditiva.** 14 colunas novas em `salao` e a tabela nova `salao_funcionamento`. Nenhuma coluna, constraint ou índice existente é alterado. Nada em reservas, jornada, bloqueios, mensagens ou tenant muda.
- **Escritores atuais de `salao`** (`INSERT INTO salao (nome)` em `repos/cadastro.ts` e `tests/support/sql.ts`, `db.salao.create` nas fábricas) continuam válidos: as colunas novas são anuláveis ou têm default constante.
- **Locks e tempo:** `ADD COLUMN` com default constante (`NULL`, `ARRAY[]::text[]`, `false`) não reescreve a tabela no PG ≥ 11 (o compose usa o 17). `SET NOT NULL` e os 14 CHECKs varrem `salao` uma vez sob `ACCESS EXCLUSIVE`, sem reescrita. `salao` tem uma linha por salão. Medição: 2.000 salões legados, migração inteira em **76 ms** (psql, base local). O script roda numa transação implícita: se algum comando falhar, nada fica aplicado.
- **Dados legados:** todo salão fica com o perfil vazio (NULL e listas vazias), `funcionamento_definido = false` e nenhuma linha de funcionamento (CA-6). Conferido em 2.000 de 2.000 salões.
- **Seed:** o projeto ainda não tem seed (`prisma/` só tem schema e migrações; `package.json` não tem `prisma.seed`). O teste "base com dados" foi feito com salões legados inseridos antes da migração (§9).

## 2. Respostas às pendências 1 a 9 da transferência

### 2.1 CHECKs de defesa do perfil (pendência 1): aprovados, todos com o nome `salao_<coluna>_chk`

Motivo geral: a E8.2 (super admin) também vai escrever no perfil, e esses formatos são definições estáveis (CEP, UF, E.164, nome de usuário do Instagram, normalização de texto), não faixas de produto. Regra de calibração: **o banco nunca é mais estrito que a validação de §3.3**. Onde as contagens divergem, a aplicação é a mais estrita: `String#length` (UTF-16) ≥ `char_length` (code points). Todo CHECK passa com `NULL`, porque `NULL` significa ausente (RN-4).

| Constraint | Expressão (resumo) | Decisão e motivo |
|---|---|---|
| `salao_descricao_chk` | `char_length BETWEEN 1 AND 1000`, `= btrim(descricao, E' \n')`, sem `[\x01-\x09\x0B-\x1F\x7F-\x9F]` | **Aprovado e ampliado.** Garante "nunca `''`" e nada de espaço ou quebra nas pontas (a aplicação apara). Recusa \p{Cc} exceto `\n`; o `\t` vira espaço na aplicação, então não chega ao banco. Os 1.000 são contados em code points: 1.000 emojis passam no banco e são recusados na aplicação (R-10, testado). |
| `salao_endereco_logradouro_chk` (120), `_numero_chk` (10), `_complemento_chk` (60), `_bairro_chk` (80), `_cidade_chk` (80) | `char_length BETWEEN 1 AND max`, `= btrim(x)`, sem `[\x01-\x1F\x7F-\x9F]` | **Aprovado (substitui o "btrim(x) <> ''" do §4).** Espelha `normalizarNome`: uma linha, aparada, sem controle. O espaço interno colapsado não é conferido (o banco é mais tolerante). `s/n` passa. |
| `salao_endereco_uf_chk` | `endereco_uf IN (27 siglas)` | **Aprovado.** Lista fechada e estável (a mesma `UFS` de `perfil-tipos.ts`). Sigla em minúscula é recusada; a aplicação converte para maiúscula antes. |
| `salao_endereco_cep_chk` | `~ '^[0-9]{8}$' AND <> '00000000'` | **Aprovado.** Grava só os 8 dígitos (RN-6). |
| `salao_endereco_completo_chk` | `num_nonnulls(6 obrigatórios) IN (0, 6) AND (complemento IS NULL OR logradouro IS NOT NULL)` | **Aprovado.** "Tudo ou nada" (RN-6/D-5). Como o endereço inteiro vai num único `UPDATE`, não há estado intermediário. |
| `salao_telefone_e164_chk`, `salao_whatsapp_e164_chk` | `~ '^\+55[1-9][0-9]{9,10}$'` | **Aprovado.** É a mesma expressão de `cliente_telefone_e164_chk`. Os DDDs válidos (A-10) ficam só na aplicação: a lista é regra de produto e muda com a Anatel. |
| `salao_instagram_chk` | `~ '^[a-z0-9._]{1,30}$' AND !~ '^\.\|\.$\|\.\.'` | **Aprovado e completo** (pontas e `..`, como na RN-8). Sem `@` e só em minúsculas. |
| `salao_meios_pagamento_chk`, `salao_comodidades_chk` | `array_position(x, NULL) IS NULL AND cardinality(x) <= 20` | **Aprovado.** Sem CHECK de valores (D-8): uma chave desconhecida é aceita pelo banco e filtrada na leitura por `filtrarChaves` (testado com `cheque`). O limite de 20 é o `itensListaMax` da aplicação. Hoje as listas têm 6 e 7 itens, o que deixa folga. |
| `NOT NULL` em `meios_pagamento` e `comodidades` | `ALTER COLUMN … SET NOT NULL` | **Aprovado** (diferença 2 do quadro acima). |

Recusado: nenhum. Testes: §6.

### 2.2 Forma de aplicar os CHECKs (pendência 2): direto, sem `NOT VALID` + `VALIDATE`

`NOT VALID` só ajuda quando a validação pode rodar depois, sob `SHARE UPDATE EXCLUSIVE`. Aqui o próprio `ADD COLUMN` da parte 1 já toma `ACCESS EXCLUSIVE` na mesma transação, então separar a validação não encurta a janela de trava. As colunas são novas e estão NULL ou vazias em todo o legado, e a varredura de `salao` leva milissegundos (§1). Não pus `lock_timeout` na migração. Uma falha deixaria a migração marcada como falha no `_prisma_migrations`, o que exige `prisma migrate resolve`. Esse custo operacional é maior que o de esperar alguns milissegundos pelas transações curtas da app, que é quem aplica as migrações ao iniciar.

### 2.3 Índice btree (`salao_id`, `dia_semana`) (pendência 3): dispensado

Medi numa base descartável com 5.000 salões e 30.000 linhas de funcionamento (12 por salão definido). Planos em §5. Nas três leituras o planejador usa o **índice GiST da exclusion** (`salao_funcionamento_sem_sobreposicao`, que começa por `salao_id`), com 3 a 4 buffers e menos de 0,1 ms. A ordenação por (`dia_semana`, `inicio_min`) é um *quicksort* de no máximo 42 linhas (7 dias × 6 intervalos), que um btree também não eliminaria para `ORDER BY … , id`. A checagem da FK ao apagar um salão usa o mesmo GiST. Um btree a mais só custaria escrita. A jornada tem btree por paridade com a D-004, mas lá a consulta da E3.1 filtra por profissional.

### 2.4 Exclusion (pendência 4): confirmada

`salao_funcionamento_sem_sobreposicao EXCLUDE USING gist (salao_id WITH =, dia_semana WITH =, int4range(inicio_min, fim_min) WITH &&)`, sem predicado. O `btree_gist` já vem da `20261118000100`. `int4range(a, b)` é `[)`, então intervalos contíguos (09:00–12:00 e 12:00–18:00) não colidem (testado). Com `salao_funcionamento_faixa_chk`, `inicio < fim` garante range não vazio. Violação: SQLSTATE `23P01`, constraint `salao_funcionamento_sem_sobreposicao`. O "DELETE dos removidos → INSERT dos novos" na mesma transação é aceito (testado).

### 2.5 Invariante `funcionamento_definido = false` ⇒ sem linhas (pendência 5): confirmado, aplicação + predicado na leitura, sem trigger

Um CHECK não alcança outra tabela. Um trigger de constraint (`DEFERRABLE INITIALLY DEFERRED`) em `salao` e em `salao_funcionamento` daria a garantia, mas teria custo. Ele obrigaria a ordem "apaga as linhas → troca o estado" a ser validada no commit, ficaria fora do diff do Prisma (mais um objeto no contrato) e não protegeria a leitura de nada além do que o predicado já protege. A garantia escolhida tem duas partes:
1. **Escrita:** a única via é o `RepoFuncionamento`, sob `salao FOR NO KEY UPDATE`. Ao gravar "não informar", a transação apaga as linhas e grava o estado. A E8.2 deve reutilizar esse repositório (registrado em §8).
2. **Leitura:** o fragmento `COLUNAS_FUNCIONAMENTO` só agrega com `AND s.funcionamento_definido`. Mesmo com linhas plantadas, `definido = false` devolve `[]`. O planejador transforma o predicado num `One-Time Filter` e nem chega a ler o índice (§5).

### 2.6 Fragmento `COLUNAS_FUNCIONAMENTO` (pendência 6): aprovado sem mudança

- **Snapshot:** a subconsulta correlacionada faz parte do mesmo comando. Em READ COMMITTED, cada comando usa um único snapshot, então `funcionamento_definido` e as linhas vêm do mesmo instante. Isso resolve o R-3 sem transação explícita.
- **Plano:** `Index Scan using salao_pkey` → `SubPlan` → `One-Time Filter: s.funcionamento_definido` → `Bitmap Index Scan on salao_funcionamento_sem_sobreposicao (salao_id = s.id)` → `Sort` → `Aggregate`. Com `false`, `never executed` (§5).
- `COALESCE(…, '[]'::json)` é necessário: `json_agg` sem linhas devolve `NULL`. `dia_semana` (smallint) e os minutos (int) saem como números JSON. `funcionamentoDaLinha` deve validar inteiros, como o desenho prevê.
- Na E3.1, numa consulta com N salões, o `SubPlan` roda uma vez por salão, com o mesmo plano por índice. Não precisa de `LATERAL`.

### 2.7 `UPDATE` do estado e ordem de travas (pendência 7): confirmado

- `UPDATE salao SET funcionamento_definido = $2, atualizado_em = now() WHERE id = $1 AND funcionamento_definido IS DISTINCT FROM $2`. A coluna é `NOT NULL`, então `IS DISTINCT FROM` equivale a `<>`; manter assim é inofensivo. Sem mudança, nenhuma linha é atualizada, e `xmin` e `atualizado_em` ficam iguais (testado, CA-4). `SELECT … FOR NO KEY UPDATE` sozinho também não muda `xmin` (testado). `now()` é o início da transação; isso está correto para `atualizado_em`. O `@updatedAt` do Prisma não age em SQL bruto, daí o `atualizado_em` explícito.
- **Atualização HOT:** nenhuma coluna nova é indexada, então os `UPDATE` de perfil e de estado podem ser HOT (sem tocar índices de `salao`).
- **Sem ciclo de espera.** Ordem: `salao` (`FOR NO KEY UPDATE`, explícito ou implícito no `UPDATE`) → `salao_funcionamento` (DELETE/INSERT; o INSERT toma `FOR KEY SHARE` em `salao`, compatível com o `FOR NO KEY UPDATE` da própria transação e com o de qualquer outra). Provado em teste com `lock_timeout = 500ms`:
  - com T1 segurando `salao FOR NO KEY UPDATE`, T2 insere em `salao_funcionamento` e em `jornada` **sem esperar**, e o `UPDATE salao` de T2 **espera** (`55P03`): a serialização entre gravações de configuração funciona;
  - com T1 segurando uma inserção pendente em `salao_funcionamento` (`FOR KEY SHARE`), o `UPDATE` do estado em T2 **não espera**.
- Todas as gravações que travam `salao` (regras e slug da D-017, perfil, funcionamento) pegam essa trava como **primeira** trava conflitante. Nenhuma transação existente trava `salao` depois de `profissional` com um modo que conflite com `FOR NO KEY UPDATE`. A ordem canônica do §3.5 está correta.

### 2.8 Testes de banco (pendência 8): criados (§6)

### 2.9 Cabeçalho e reversão (pendência 9): no padrão da D-007 (§3)

## 3. Reversão

Não existe "migrate down" no Prisma. O procedimento manual está no cabeçalho da migração: `DROP TABLE salao_funcionamento`; `ALTER TABLE salao DROP CONSTRAINT` (14 CHECKs) e `DROP COLUMN` (14 colunas); `DELETE FROM _prisma_migrations WHERE migration_name = '20261120000000_perfil_funcionamento'`; e reverter o `schema.prisma`. Ele **apaga o perfil e o funcionamento de todos os salões**. Use só onde esses dados não importam; em qualquer base que não seja local ou de teste, exige autorização explícita do usuário. O `btree_gist` permanece, porque a D-004 depende dele. Para recuperar dados, a alternativa é restaurar o backup anterior ao deploy.

## 4. Contrato de nomes (consumido pela T-5 e pelos testes)

- Colunas de `salao` (campo Prisma → coluna): `descricao`, `enderecoLogradouro` → `endereco_logradouro`, `enderecoNumero` → `endereco_numero`, `enderecoComplemento` → `endereco_complemento`, `enderecoBairro` → `endereco_bairro`, `enderecoCidade` → `endereco_cidade`, `enderecoUf` → `endereco_uf`, `enderecoCep` → `endereco_cep`, `telefoneE164` → `telefone_e164`, `whatsappE164` → `whatsapp_e164`, `instagram`, `meiosPagamento` → `meios_pagamento` (`text[]`), `comodidades` (`text[]`), `funcionamentoDefinido` → `funcionamento_definido` (`boolean NOT NULL DEFAULT false`). Relação `Salao.funcionamento`.
- Tabela `salao_funcionamento` (delegate `salaoFuncionamento`): `id uuid` (`gen_random_uuid()`), `salao_id uuid` (FK `salao_funcionamento_salao_id_fkey` RESTRICT/RESTRICT), `dia_semana smallint`, `inicio_min int`, `fim_min int`, `criado_em timestamptz(6) DEFAULT CURRENT_TIMESTAMP`.
- SQL bruto: `salao_funcionamento_sem_sobreposicao` (x, `23P01`), `salao_funcionamento_dia_semana_chk`, `salao_funcionamento_faixa_chk` e os 14 `salao_*_chk` de §2.1 (`23514`). `NULL` em lista ou em `funcionamento_definido` → `23502`.

## 5. Consultas e `EXPLAIN` (PG 17, base descartável, 5.000 salões e 30.000 linhas, `ANALYZE` feito)

```
Fragmento, definido = true:
 Index Scan using salao_pkey on salao s (actual rows=1)
   SubPlan 1 -> Aggregate -> Sort (dia_semana, inicio_min; quicksort 25kB)
     -> Result  One-Time Filter: s.funcionamento_definido
       -> Bitmap Heap Scan on salao_funcionamento f (rows=12)
         -> Bitmap Index Scan on salao_funcionamento_sem_sobreposicao  Index Cond: (salao_id = s.id)
 Buffers: shared hit=7 · Execution Time: 0.083 ms

Fragmento, definido = false:
   ... One-Time Filter: s.funcionamento_definido
       -> Bitmap Heap Scan on salao_funcionamento f (never executed)
 Execution Time: 0.025 ms

listar (WHERE salao_id = $1 ORDER BY dia_semana, inicio_min, id):
 Sort -> Bitmap Heap Scan -> Bitmap Index Scan on salao_funcionamento_sem_sobreposicao
 Buffers: shared hit=4 · Execution Time: 0.024 ms

DELETE … WHERE salao_id = $1 AND id = ANY($2):
 Delete -> Bitmap Heap Scan (Filter: id = ANY) -> Bitmap Index Scan on salao_funcionamento_sem_sobreposicao
 Buffers: shared hit=11 · Execution Time: 0.080 ms
```

A leitura do perfil e o `UPDATE` do perfil são por `salao.id` (PK). Não há risco de desempenho.

## 6. Testes

- **`tests/integration/db/perfil-funcionamento.test.ts`** (novo): defaults do salão inserido só com nome (CA-6/CA-14); `23502` com `NULL` nas listas e no estado; exclusion `23P01` (sobreposição e intervalo idêntico); contíguos, outro dia, dia inteiro e 22:00–24:00 aceitos; mesmo intervalo em outro salão aceito; CHECKs de faixa e de dia; FK `23503` nos dois sentidos; DELETE → INSERT na mesma transação; cada CHECK de texto do perfil com aceite no limite e recusa (acima do limite, vazio, espaço nas pontas, `\n`, `\t`, U+0085, U+007F); descrição com quebras internas, 1.000 caracteres e 1.000 emojis (R-10); UF (as 27 siglas e as recusas); CEP; E.164 nos dois campos; Instagram; endereço tudo ou nada (cada um dos 6 faltando e o complemento sozinho); listas (chave desconhecida aceita, 20 itens, 21 itens e elemento `NULL` recusados); travas e `xmin` (§2.7).
- **`tests/integration/db/drift.test.ts`** (atualizado): 31 tabelas; os 17 objetos novos de SQL bruto pelo nome, tabela e tipo; a definição exata da exclusion nova; `NOT NULL` e o default das listas; 38 FKs RESTRICT; 5 migrações aplicadas. O `migrate diff` sem diferença e o controle negativo continuam valendo.

## 7. Orientações para o desenvolvedor (T-5/T-6)

- Rode `npm run db:generate` antes de usar `salaoFuncionamento` e os campos novos.
- `atualizarPerfil`: um único `updateMany({ where: { id }, data: <as 13 colunas> })`. Grave sempre o endereço inteiro (as 7 colunas) no mesmo comando, porque gravar campos soltos viola `salao_endereco_completo_chk`. `''` nunca chega ao banco: use `null`.
- `aplicarDiferenca`: `deleteMany({ where: { salaoId, id: { in: remover } } })` e depois `createMany`. Sempre filtre por `salaoId` (escopo) e sempre depois de `travar`. Listas vazias pulam o comando.
- `definirEstado`: o SQL do §3.5 por `$executeRaw` (template marcado), com `atualizado_em = now()` explícito. `rowCount = 1` significa que escreveu.
- `COLUNAS_FUNCIONAMENTO`: use o texto do §3.5 sem alteração (o `AND s.funcionamento_definido` é a garantia da §2.5).
- **Violações (`23P01`, `23514`, `23502`) não devem acontecer:** a validação de §3.3/§3.4 é igual ou mais estrita. Se acontecerem, é defeito: deixe virar 500 com log de ids, sem traduzir para mensagem ao usuário e sem `catch` para repetir.
- Não use `FOR UPDATE` em `salao`, porque bloqueia os `INSERT` com FK (D-017). Use só `FOR NO KEY UPDATE`.

## 8. Pendências e riscos

- **`tests/integration/harness/template.test.ts`** lista as migrações aplicadas e falhava com a quinta migração (2 testes do CA-15). **Resolvido na T-0** (posse transferida pelo líder nesta rodada): `'20261120000000_perfil_funcionamento'` acrescentada a `MIGRACOES` e comentário atualizado. Resultado em §9.
- **E8.2:** escrever o perfil e o funcionamento só pelos repositórios desta demanda (`atualizarPerfil`, `RepoFuncionamento`), para preservar a invariante da §2.5.
- **Lista nova de meios de pagamento ou comodidades:** é mudança só de código. O banco aceita até 20 itens por lista. Acima disso, o CHECK precisa de uma migração.
- **DDDs:** o banco aceita qualquer DDD de `1-9` seguido de um dígito (`[1-9][0-9]`). A lista real é da aplicação (`src/lib/telefone.ts`).

## 9. Evidências

Bases descartáveis `d020_dba_rascunho` e `d020_dba_rascunho4`, criadas no PostgreSQL 17 do compose (apagadas no fim).

| Comando | Resultado |
|---|---|
| `npx prisma format` / `npx prisma validate` | schema válido |
| `prisma migrate deploy` (4 migrações) → `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | parte 1 (ALTER TABLE salao com 14 colunas, CREATE TABLE salao_funcionamento, FK) |
| mesmo diff refeito a partir de uma base com as 4 migrações, comparado com a parte 1 do arquivo | idêntica |
| parte 1 + `SET NOT NULL` nas listas → `migrate diff --exit-code` | `No difference detected`, status 0 |
| base limpa: `DATABASE_URL=…/d020_dba_rascunho npx prisma migrate deploy` | 5 migrações aplicadas |
| `migrate diff --exit-code` nessa base | `No difference detected`, status 0 |
| base com 2.000 salões legados (4 migrações) + `psql -f migration.sql` | 76 ms; 2.000/2.000 com perfil vazio, `false` e 0 linhas |
| `EXPLAIN (ANALYZE, BUFFERS)` (5.000 salões, 30.000 linhas) | §5 |
| `npm run db:generate` | cliente gerado (Prisma 7.10.1) |
| `npm run typecheck` | 0 erros |
| `npx eslint --max-warnings=0 tests/integration/db/` | sem avisos |
| `npx vitest run --project integration tests/integration/db` | 9 arquivos, 242 testes, todos verdes |
| `npx vitest run --project integration tests/integration/db tests/integration/harness tests/integration/salao` | 372 verdes, 2 falhas em `harness/template.test.ts` (antes da correção, §8) |
| depois da correção: `npx vitest run --project integration tests/integration/harness/template.test.ts tests/integration/db` | 10 arquivos, 251 testes, todos verdes; `eslint` do arquivo sem avisos |
| `npx vitest run --project integration tests/integration/harness/template.test.ts` (sozinho) | 1 arquivo, 9 testes, todos verdes |
| `docker compose up -d --build --wait` (base local `agenda_beleza`, 57 salões) | log da app: `Applying migration 20261120000000_perfil_funcionamento` … `All migrations have been successfully applied.`; 57/57 salões com `false` e listas vazias; `/api/health` 200. Depois, `docker compose stop app worker`, para liberar a porta 3000 |
