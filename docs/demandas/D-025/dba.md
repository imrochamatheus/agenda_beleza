# D-025 (E3.2) — Parecer do DBA (T-1)

**Parecer: APROVADO, sem migração e sem mudança de interface exigida.** Duas recomendações (lock_timeout e atualização do cabeçalho de `repos/servico.ts`) estão no item 4 e no item 7. Experimentos em base descartável `dba_d025` (migrações do repositório aplicadas em ordem; apagada ao fim), PostgreSQL 17 do compose.

## 1. Ordem de travas e ausência de ciclo

Níveis: (1) salão, (2) profissional, (3) serviços por `id`, (4) cliente, (5) reserva, itens, consentimento, mensagem. Cada transação adquire em ordem não decrescente; a §6.1 do design está correta e é confirmada. Pontos conferidos no esquema:

- Todas as FKs de `reserva`/`reserva_item`/`mensagem`/`consentimento` são compostas `(salao_id, x_id)`, `ON UPDATE/DELETE RESTRICT`. Os inserts tomam só `FOR KEY SHARE` nas linhas pai, que não conflita com `FOR SHARE`, `FOR NO KEY UPDATE` nem entre si; conflita apenas com `FOR UPDATE`.
- Desativar profissional pede `FOR UPDATE` no profissional e não toca o salão: ou espera a nossa `FOR SHARE`, ou nós esperamos e lemos `ativo = false`. Nunca seguramos nível posterior enquanto esperamos nível anterior.
- Edição de salão / de telefone (D-022): `FOR NO KEY UPDATE` no salão conflita com a nossa `FOR SHARE`; é o primeiro nível nos dois lados, então só há fila, não ciclo.
- Edição de serviço: profissionais `FOR SHARE` → serviço `FOR NO KEY UPDATE`; `FOR SHARE` × `FOR SHARE` não conflita, mesma ordem.
- Obrigação para E3.5: salão `FOR SHARE` → profissional → reserva `FOR UPDATE` → itens → mensagem.

**Evidência (sessões reais em paralelo, `lock_timeout = 6s`, 25 rodadas, 5 telefones alternados):** em cada rodada, 2 transações de reserva (chaves distintas, mesmo horário, upsert da mesma cliente) + edição de salão (`NO KEY UPDATE`) + desativação/reativação de profissional (`FOR UPDATE`) + edição de serviço (profissional `FOR SHARE` → serviço `NO KEY UPDATE`) + edição de telefone (salão `NO KEY UPDATE` → cliente `FOR UPDATE`). Resultado: 0 deadlocks (`40P01`) e 0 `lock timeout` (`55P03`) no log do servidor; as 25 rodadas terminaram com exatamente 1 reserva criada cada (a perdedora recebeu `23P01`, esperado). O mesmo roteiro, escrito de forma invertida na sua ordem, é o que o teste de concorrência da T-6 deve repetir (ver item 6).

## 2. `ON CONFLICT (salao_id, chave_requisicao) DO NOTHING` × `reserva_sem_sobreposicao`

Confirmado (cenários com duas sessões; B inicia 0,4 s depois de A; A segura 1,5 s):

| Cenário | Resultado |
|---|---|
| Mesma chave, mesmo horário, A comita | B **espera** o commit de A (retornou 1,5 s depois) e então `RETURNING` vazio (DO NOTHING); 1 linha. **Não** dá `23P01`. |
| Chaves distintas, mesmo horário, A comita | B espera e então falha `23P01` (`reserva_sem_sobreposicao`); 1 linha. |
| Mesma chave, A faz rollback | B espera e insere normalmente; 1 linha. |

Logo: o árbitro do `ON CONFLICT` é só o `UNIQUE (salao_id, chave_requisicao)` (conferido; `NULL` de chave não conflita, então reservas sem chave seguem só a exclusion). O `23P01` não é suprimido pelo `DO NOTHING` e deve ser tratado pelo desenvolvedor. A ampliação A-10(c) do design (releitura por chave fora da transação diante de qualquer `horario_indisponivel` com chave) é necessária e suficiente: uma requisição atrasada que vê o horário ocupado pela vencedora na revalidação, ou que toma `23P01` quando a chave era outra, só pode distinguir "repetida" relendo por chave.

## 3. `SELECT … ORDER BY s.id FOR SHARE OF s` trava na ordem do `ORDER BY`

Confirmado. Plano: `LockRows` sobre `Index Scan using servico_salao_id_id_key` (índice entrega por `id`; se o planejador usasse outro caminho, o `Sort` fica abaixo do `LockRows`, então a ordem das travas é sempre a do `ORDER BY`). Experimento: serviço 102 preso por `FOR UPDATE` em outra sessão, pedido de 103, 101, 102 com `ORDER BY s.id`: `pgrowlocks` mostrou a nossa sessão segurando 101 e esperando 102, sem ter tocado 103. Mantenha `ORDER BY s.id` (UUID em texto ou nativo; use a mesma ordenação em todo o código; o `ORDER BY` por `uuid` é a ordem bytewise, estável). Não confie em `WHERE id = ANY(...)` sem `ORDER BY`.

## 4. Pool de 16 e `lock_timeout`

- 10 transações com upsert do mesmo telefone, cada uma segurando a linha por 0,3 s: serializaram sem erro (3,2 s no total, dominado pelo `docker exec`); cada uma segura 1 conexão enquanto espera. Com `POOL_MAX_TESTES = 16` sobram 6 conexões livres para a leitura de verificação e o `buscarPorChave` fora da transação. Importante: o teste não deve usar o `Pool` do harness para disparar as 10 e, ao mesmo tempo, para consultar (já avisado em `tests/support/sql.ts`); use um pool separado para a verificação.
- `max_connections` do compose é 100. 4 workers de Vitest × 16 conexões = 64 no pior caso por execução; execuções simultâneas (permitidas) podem se aproximar do limite. Os pools são preguiçosos (só conta conexão usada), então o risco existe apenas se muitos arquivos de concorrência rodarem juntos: mantenha o teste de 10 concorrentes em **um** arquivo e não aumente `POOL_MAX_TESTES`.
- **`lock_timeout`: recomendo, sem variável de ambiente.** Dentro da transação de criação, `SET LOCAL lock_timeout = '5s'` como constante do código do repositório (não envolve DevOps, compose nem `.env`). Justificativa: espera máxima legítima é a duração da transação da vencedora (milissegundos) mais a de uma gravação de regras do salão (curta, D-017); 5 s nunca dispara no caminho normal e evita que uma transação presa (ex.: sessão pendurada) esgote o pool de 10 em produção. `statement_timeout`: não recomendo (nenhuma instrução é longa). Mapeamento: o `55P03` (SQLSTATE `lock_not_available`) deve virar erro transitório (503/"tente novamente") sem criar reserva, nunca `horario_indisponivel`. Se o arquiteto preferir não tratar `55P03`, a alternativa aceitável é não usar `lock_timeout` (A-18 vigente); decisão dele, sem impacto de infraestrutura em nenhum dos dois casos.

## 5. Planos (`EXPLAIN (ANALYZE, BUFFERS)`, 730 mil linhas em `reserva`, 10 salões, ANALYZE feito)

- `consultaOcupacoes` (2 profissionais, janela de 1 dia): `Nested Loop` → `Bitmap Heap Scan on reserva` → `Bitmap Index Scan on reserva_sem_sobreposicao` (condição `profissional_id = x.pid` e `tstzrange(...) &&`); 16 linhas, 0,6 ms; sem `Seq Scan`. O filtro `salao_id` fica como `Filter` e o literal de status do índice parcial segue aplicável. (Com a tabela vazia o planejador escolhe `reserva_salao_id_profissional_id_inicio_idx`; irrelevante e esperado.) O teste de plano existente (CA-25) continua válido.
- `buscarPorChave`: `Index Scan using reserva_salao_id_chave_requisicao_key`, 1 linha, 0,05 ms.

## 6. Testes de integridade sugeridos (T-6)

1. N requisições com a mesma chave e mesmo corpo (10, pool 16): 1 `criada` + 9 `repetida` com o mesmo `id`; 1 linha em `reserva`, 1 em `mensagem` (`reserva:confirmacao:0`).
2. 2 chaves distintas, mesmo profissional e horário: 1 `criada`, 1 `horario_indisponivel`; 1 linha.
3. Mesma chave com corpo diferente: `chave_reutilizada`.
4. Mesmo telefone em 10 requisições com horários distintos: 1 só `cliente` (UNIQUE do salão), 10 reservas.
5. Reserva × (edição de salão, desativação de profissional, edição de serviço, edição de telefone) disparadas juntas, com `lock_timeout` curto na sessão de teste: sem `40P01`, sem `55P03`; o desfecho é "criada" (quando a trava vem antes da desativação) ou o motivo de indisponibilidade, nunca 5xx.
6. Verificação por `pg_stat_activity`/`pg_locks` do padrão do projeto (marcadores `FOR SHARE OF p`, `FOR NO KEY UPDATE OF s`): não altere o texto dessas travas.

## 7. Orientações ao desenvolvedor

- **Nada a migrar.** `UNIQUE(salao_id, chave_requisicao)`, `reserva_ordem_chk`, `reserva_item UNIQUE(salao_id, reserva_id, ordem)` e a exclusion já existem na `init`.
- Capture `23P01` (e só ele) em `erros-banco`, fora do repositório, como o design prevê; não capture `23505`: o `DO NOTHING` já o evita para a chave, e o do telefone é resolvido pelo upsert.
- Faça sempre o upsert da cliente como `INSERT … ON CONFLICT (salao_id, telefone_e164) DO UPDATE SET atualizado_em = now() RETURNING id` (ou o equivalente do design): serializa por telefone até o commit, sem `23505`.
- Atualizar o cabeçalho de `src/server/repos/servico.ts`: acrescentar que a criação de reserva pega o salão `FOR SHARE` (hoje só cita `FOR NO KEY UPDATE`) e que E3.5 repete essa ordem.
- Qualquer SQL novo com `status` deve manter o literal `'confirmado'`/lista literal (índice parcial da exclusion).

## 8. Reversão

Não aplicável: nenhuma migração, nenhum objeto de banco criado. Base `dba_d025` apagada; nenhum arquivo em `prisma/` alterado.

## 9. Leitura do vínculo serviço × profissional sob `FOR SHARE` (EvalPlanQual)

**Confirmado: não leia o vínculo por `EXISTS`/subconsulta no mesmo `SELECT … FOR SHARE OF s`.** Em READ COMMITTED, quando a trava espera um escritor concorrente, o PostgreSQL só reavalia (EvalPlanQual) a versão nova da linha travada; as demais tabelas da consulta (`servico_profissional`) continuam vistas no snapshot do início do comando.

Experimento (2 sessões): A = `FOR NO KEY UPDATE` no serviço, `DELETE` do vínculo, 1,5 s, `COMMIT`; B começa 0,5 s depois e espera a trava.

| Forma de B | Resultado após o commit de A (vínculo já apagado) |
|---|---|
| `SELECT … WHERE … AND EXISTS (vínculo) FOR SHARE OF s` | **devolve a linha** (vínculo obsoleto) |
| `SELECT s.id, EXISTS (vínculo) … FOR SHARE OF s` | `vinculado = t` (**obsoleto**) |
| 1.º comando `SELECT s.id … FOR SHARE OF s`; 2.º comando `SELECT count(*) FROM servico_profissional …` | `0` (**correto**: o 2.º comando toma snapshot novo) |

**Forma segura (a do desenvolvedor): dois comandos.** Primeiro a trava (`ORDER BY s.id FOR SHARE OF s`), depois a leitura do vínculo (e de `ativo`, quando vier de outra tabela) em comando separado dentro da mesma transação. Vale também para o `ativo` do serviço/profissional e para o gancho de revalidação: qualquer dado lido de OUTRA tabela precisa vir depois da trava, em comando novo. Os campos da própria linha travada (`ativo` do serviço no mesmo `SELECT`) são reavaliados e seguros. Como a edição de serviço (D-014) trava o serviço antes de mexer nos vínculos, a espera ocorre exatamente neste ponto; a leitura em 2.º comando enxerga o resultado dela.

## Revisão 2 — DEF-1 (`40P01 deadlock detected`)

### Causa (reproduzida)
- Log do servidor: `Process A waits for ShareLock on speculative token N of transaction X; blocked by process B. Process B waits for ShareLock on speculative token N of transaction Y; blocked by A`, no `INSERT INTO reserva … ON CONFLICT (salao_id, chave_requisicao) DO NOTHING`.
- Mecanismo: o `ON CONFLICT DO NOTHING` faz inserção especulativa (a tupla fica visível com um "speculative token" até a confirmação). A exclusion `reserva_sem_sobreposicao` insere a entrada no índice GiST e só depois procura conflito. Com N transações na mesma faixa, cada uma encontra a tupla especulativa de outra e espera pelo token, formando ciclo. Com 2 transações a janela quase não existe; com 10 a 16 e carga, existe. O upsert de cliente (telefones distintos) e o consentimento/mensagem não participam: o ciclo está só no INSERT da reserva.
- Medição do baseline (trava `FOR SHARE` do profissional, 12 transações, barreira após a revalidação como `aposRevalidar`, 6 cópias em paralelo × 400 requisições): 33, 36, 55, 111, 145 e 154 `40P01` por 400 (até 38%); p95 de 5 a 9 s (esperas do `deadlock_timeout`). Sozinho, 10 × 400: 27 `40P01`. O ambiente quieto do tester não expõe porque a barreira dele é mais curta.

### Recomendação única: (a) trava `FOR NO KEY UPDATE` do profissional
Ponto exato: `src/server/repos/profissional.ts`, `travarParaReserva` (linha ~187): trocar `FOR SHARE OF p` por `FOR NO KEY UPDATE OF p`. Nada mais muda no repositório; sem migração, sem mudança de plano (o INSERT é o mesmo).
- Resultado: a criação de reservas do MESMO profissional é serializada antes da revalidação e do INSERT; a revalidação (READ COMMITTED) enxerga a reserva da vencedora. Profissionais distintos não se bloqueiam (trava por linha); o salão continua só com `FOR SHARE`.
- Protótipo (script descartável reproduzido no apêndice abaixo, base descartável já apagada; modos `share`/`nokey`/`advisory`; uso: `node proto.cjs <modo> <N> <rodadas> <base>`, com as migrações aplicadas): `nokey`, 100 execuções de 400 requisições (20 ondas × 5 cópias simultâneas; 10 transações × 40 horários cada; 40 000 requisições): 0 `40P01`, exatamente 1 reserva por horário (`ok` = 40 em todas as 100), 360 `horario_indisponivel` por revalidação por execução, nenhum outro erro. Também 6 cópias × 12 transações: 0 `40P01`. Latência por requisição: p50 14 ms, p95 ~44 ms (o baseline falha). `pg_advisory_xact_lock(hashtextextended(profissional_id, 0))` dá resultado equivalente (0 `40P01`, p95 ~35 ms), mas não aparece na ordem canônica de travas e outras trilhas precisariam conhecê-lo; descartado.
- (b) retry em `40P01`: não recomendado como correção: cada tentativa perdida espera o `deadlock_timeout` (1 s) e a mensagem/outbox repetiria; mantenha só como rede de segurança futura, se alguém criar um escritor sem a trava.

### Compatibilidade com as outras travas
- Ordem canônica inalterada (salão `FOR SHARE` → profissional → serviços → …). A reserva toma uma única trava de profissional, sem promoção (nunca `FOR SHARE` e depois `FOR NO KEY UPDATE` na mesma transação: duas promoções simultâneas seriam impasse).
- Desativação (`FOR UPDATE`): continua serializando, como antes. Jornada (`FOR NO KEY UPDATE`): agora serializa com a criação, por poucos ms; sem ciclo (ambas vão ao profissional primeiro). Edição/criação de serviço (`FOR SHARE` em profissional → serviço): espera a reserva; sem ciclo, pois a ordem é sempre profissional → serviço. Bloqueios e INSERTs com FK (`FOR KEY SHARE`): não conflitam com `FOR NO KEY UPDATE`.
- E3.4/E3.5: todo comando que INSERE ou ATUALIZA `reserva` para um status ocupante (criar, reagendar, qualquer retorno a `confirmado`) deve tomar `FOR NO KEY UPDATE` (ou mais forte) no profissional ANTES do comando. Cancelar (sai do predicado) não cria o ciclo e pode manter `FOR SHARE`. Atualizar o comentário do cabeçalho de `repos/servico.ts` e de `profissional.ts`.

### Impacto nos testes (para o desenvolvedor)
- A barreira `aposRevalidar` de 10 fica DENTRO da trava: só uma transação entra por vez, então a barreira nunca fecha e o teste trava. Use a barreira ANTES de `criarReserva` (largada simultânea), ou barreira com limite de tempo.
- CA-2/CA-2b passam a esperar exatamente 1 `criada` e 9 `horario_indisponivel`, com `causa: 'revalidacao'` (a determinística `causa: '23P01'` não ocorre mais entre criações). Para cobrir `23P01` e o mapeamento da violação: dentro de `aposRevalidar`, grave (commit, outra conexão) uma reserva sobreposta direta no banco, sem a trava; deve resultar `horario_indisponivel/23P01` sem exceção.
- Teste de regressão do DEF-1: 10 e 16 `criarReserva` simultâneas no mesmo horário, 40 rodadas, sem barreira interna, afirmando 0 rejeições.

#### Apêndice — protótipo (`proto.cjs`, fora do repositório)

```js
const { Pool } = require('/home/cliente/Área de Trabalho/agenda_beleza/node_modules/pg');
const crypto = require('crypto');
const [,, mode, N, ROUNDS, DB] = process.argv; // mode: share | nokey | advisory | none
const n = +N, rounds = +ROUNDS;
const pool = new Pool({ connectionString: `postgresql://agenda:agenda_dev@localhost:5432/${DB}`, max: n });
(async () => {
  const salao = crypto.randomUUID(), prof = crypto.randomUUID();
  await pool.query(`insert into salao(id,nome) values($1,'s')`, [salao]);
  await pool.query(`insert into profissional(id,salao_id,nome) values($1,$2,'p')`, [prof, salao]);
  const cnt = { ok: 0, indisp23P01: 0, revalid: 0, d40P01: 0, outros: 0 }; const lat = [];
  const outros = new Set();
  for (let r = 0; r < rounds; r++) {
    const inicio = new Date(Date.UTC(2027, 0, 1) + r * 3600e3 * 2);
    const fim = new Date(+inicio + 3600e3);
    let arrived = 0, release; const gate = new Promise((res) => (release = res));
    const barrier = async () => { if (++arrived === n) release(); await gate; };
    await Promise.all(Array.from({ length: n }, async (_, i) => {
      const c = await pool.connect(); const t0 = Date.now();
      try {
        await c.query('begin');
        await c.query(`select 1 from salao where id=$1 for share`, [salao]);
        if (mode !== 'share') await barrier(); // antes da trava p/ modos serializados
        if (mode === 'share') await c.query(`select ativo from profissional where id=$1 for share`, [prof]);
        else if (mode === 'nokey') await c.query(`select ativo from profissional where id=$1 for no key update`, [prof]);
        else if (mode === 'advisory') await c.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [prof]), await c.query(`select ativo from profissional where id=$1 for share`, [prof]);
        else await c.query(`select ativo from profissional where id=$1 for share`, [prof]);
        // revalidação (READ COMMITTED)
        const rv = await c.query(`select 1 from reserva where profissional_id=$1 and status='confirmado' and tstzrange(inicio,ocupado_ate,'[)') && tstzrange($2,$3,'[)')`, [prof, inicio, fim]);
        if (rv.rowCount) { await c.query('rollback'); cnt.revalid++; return; }
        if (mode === 'share') await barrier(); // baseline: barreira após revalidar (como aposRevalidar)
        const cl = await c.query(`insert into cliente(salao_id,nome,telefone_e164) values($1,'x',$2) returning id`, [salao, '+5511' + String(Math.floor(Math.random()*9e8)+1e8).slice(0,9)]);
        await c.query(`insert into reserva(salao_id,profissional_id,cliente_id,inicio,fim,ocupado_ate,origem,chave_requisicao) values($1,$2,$3,$4,$5,$5,'publico',$6) on conflict (salao_id,chave_requisicao) do nothing`, [salao, prof, cl.rows[0].id, inicio, fim, crypto.randomUUID()]);
        await c.query('commit'); cnt.ok++;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        if (e.code === '23P01') cnt.indisp23P01++; else if (e.code === '40P01') cnt.d40P01++; else { cnt.outros++; outros.add(e.code + e.message); }
      } finally { lat.push(Date.now() - t0); c.release(); }
    }));
  }
  lat.sort((a, b) => a - b);
  console.log(mode, n, JSON.stringify(cnt), 'p50', lat[lat.length >> 1], 'p95', lat[Math.floor(lat.length * .95)], [...outros].join('|'));
  await pool.end();
})();
```
