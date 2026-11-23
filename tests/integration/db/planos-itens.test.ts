import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar } from '../../support/sql';

// D-050 T-1 (design §4.7, dba.md Q4–Q8): planos das consultas sobre reserva_item com volume, ANTES de existir o
// código (T-3/T-4/T-7 reescrevem os testes de plano com as funções reais). O SQL aqui é o CONTRATO proposto no
// dba.md; mudar a forma (literal de status, expressão tstzrange, margem) exige medir de novo.
// Volume: 2 salões × 10 profissionais × 10.000 reservas de 3 itens (60.000 itens), 10% dos itens cancelados,
// 1 confirmação por reserva e 1 falha a cada 7. Só ANALYZE (sem enable_seqscan = off nem DROP INDEX).
// Planos impressos com o prefixo [D-050-plano].

let c: pg.Client;
type Salao = { salao: string; profissionais: string[]; cliente: string; reservaGrande: string };
const sal: Salao[] = [];

const BASE = '2026-01-01T00:00:00Z';
const SEMANA = { de: '2027-03-01T03:00:00Z', ate: '2027-03-08T03:00:00Z' };
const DIA = { de: '2027-03-02T03:00:00Z', ate: '2027-03-03T03:00:00Z' };
const LONGO = { de: '2027-01-01T00:00:00Z', ate: '2027-03-02T00:00:00Z' };

beforeAll(async () => {
  c = await conectar();
  for (let k = 0; k < 2; k++) {
    const salao = (await c.query<{ id: string }>("INSERT INTO salao (nome) VALUES ('Plano') RETURNING id")).rows[0].id;
    const profissionais = (
      await c.query<{ id: string }>(
        "INSERT INTO profissional (salao_id, nome) SELECT $1, 'P' || g FROM generate_series(0, 9) g RETURNING id",
        [salao],
      )
    ).rows.map((x) => x.id);
    await c.query(
      `INSERT INTO cliente (salao_id, nome, telefone_e164)
       SELECT $1, 'Cliente ' || g, '+55119' || lpad(($2::int * 1000 + g)::text, 8, '0') FROM generate_series(0, 499) g`,
      [salao, k],
    );
    await c.query(
      "INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min) SELECT $1, 'S' || g, 5000, 40 FROM generate_series(0, 2) g",
      [salao],
    );
    // Reserva g a cada 2 h: 3 itens de 40 min em sequência, profissionais g, g+1, g+2 (mod 10) — sem sobreposição.
    await c.query(
      `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem, revisao)
       SELECT $1, (SELECT id FROM cliente WHERE salao_id = $1 ORDER BY id OFFSET (g % 500) LIMIT 1),
              $2::timestamptz + g * interval '2 hours', $2::timestamptz + g * interval '2 hours' + interval '120 minutes',
              (CASE WHEN g % 10 = 9 THEN 'cancelado' WHEN g % 3 = 0 THEN 'concluido' WHEN g % 3 = 1 THEN 'confirmado'
                    ELSE 'nao_compareceu' END)::status_reserva, 'publico', g % 3
         FROM generate_series(0, 9999) g`,
      [salao, BASE],
    );
    await c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                 inicio, fim, ocupado_ate, status, revisao)
       SELECT r.salao_id, r.id, s.id, ($3::uuid[])[((x.g + s.k) % 10) + 1], s.k, 5000, 40,
              r.inicio + s.k * interval '40 minutes', r.inicio + (s.k + 1) * interval '40 minutes',
              r.inicio + (s.k + 1) * interval '40 minutes', r.status, r.revisao
         FROM (SELECT r.*, row_number() OVER (ORDER BY r.inicio) - 1 AS g FROM reserva r WHERE r.salao_id = $1) x
         JOIN reserva r ON r.id = x.id
         CROSS JOIN LATERAL (SELECT id, (row_number() OVER (ORDER BY id) - 1)::int AS k FROM servico WHERE salao_id = $1) s
        WHERE r.salao_id = $2::uuid`,
      [salao, salao, profissionais],
    );
    await c.query(
      `INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao, estado)
       SELECT salao_id, id, 'confirmacao', 0,
              (CASE WHEN extract(epoch FROM inicio)::bigint % 7 = 0 THEN 'falhou' ELSE 'enviada' END)::estado_mensagem
         FROM reserva WHERE salao_id = $1`,
      [salao],
    );
    // Cliente 0 com 50 reservas (CA-15/RN-18): já tem ~20 pela distribuição; completa com futuras de 1 item.
    const cliente = (await c.query<{ id: string }>('SELECT id FROM cliente WHERE salao_id = $1 ORDER BY id LIMIT 1', [salao])).rows[0]
      .id;
    // Reserva grande: 10 itens (10 serviços novos) e 30 mensagens, para substituirNaoVigentes.
    const servicos10 = (
      await c.query<{ id: string }>(
        "INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min) SELECT $1, 'G' || g, 100, 10 FROM generate_series(0, 9) g RETURNING id",
        [salao],
      )
    ).rows.map((x) => x.id);
    const reservaGrande = (
      await c.query<{ id: string }>(
        `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem, revisao)
         VALUES ($1, $2, '2030-01-01T10:00:00Z', '2030-01-01T11:40:00Z', 'confirmado', 'equipe', 30) RETURNING id`,
        [salao, cliente],
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                 inicio, fim, ocupado_ate, status, revisao)
       SELECT $1, $2, ($3::uuid[])[k + 1], ($4::uuid[])[k + 1], k, 100, 10,
              '2030-01-01T10:00:00Z'::timestamptz + k * interval '10 minutes',
              '2030-01-01T10:00:00Z'::timestamptz + (k + 1) * interval '10 minutes',
              '2030-01-01T10:00:00Z'::timestamptz + (k + 1) * interval '10 minutes',
              (CASE WHEN k < 3 THEN 'cancelado' ELSE 'confirmado' END)::status_reserva, 20 + k
         FROM generate_series(0, 9) k`,
      [salao, reservaGrande, servicos10, profissionais],
    );
    await c.query(
      `INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao, estado)
       SELECT $1, $2, (CASE WHEN g = 0 THEN 'confirmacao' WHEN g % 2 = 0 THEN 'remarcacao' ELSE 'cancelamento' END)::tipo_mensagem,
              g, (CASE WHEN g % 3 = 0 THEN 'pendente' ELSE 'enviada' END)::estado_mensagem
         FROM generate_series(0, 29) g`,
      [salao, reservaGrande],
    );
    const { rows } = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM reserva WHERE cliente_id = $1', [cliente]);
    const faltam = 50 - rows[0].n;
    await c.query(
      `WITH r AS (
         INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem)
         SELECT $1, $2, '2031-01-01T10:00:00Z'::timestamptz + g * interval '1 day',
                '2031-01-01T10:40:00Z'::timestamptz + g * interval '1 day', 'confirmado', 'publico'
           FROM generate_series(1, $5::int) g
         RETURNING id, inicio, fim)
       INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                 inicio, fim, ocupado_ate, status)
       SELECT $1, r.id, $3, $4, 0, 100, 40, r.inicio, r.fim, r.fim, 'confirmado' FROM r`,
      [salao, cliente, servicos10[0], profissionais[0], faltam],
    );
    sal.push({ salao, profissionais, cliente, reservaGrande });
  }
  await c.query('ANALYZE');
}, 180_000);

afterAll(async () => {
  await c.end();
});

type Linha = { 'QUERY PLAN': string };
const texto = (rows: Linha[]) => rows.map((l) => l['QUERY PLAN']).join('\n');
const tempo = (plano: string) => /Execution Time: ([\d.]+) ms/.exec(plano)?.[1];

/** Plano custom (parâmetros conhecidos). `$n` do SQL recebe `args`. */
async function planoCustom(sql: string, args: unknown[]): Promise<string> {
  const { rows } = await c.query<Linha>(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, args);
  return texto(rows);
}

/** Plano genérico: PREPARE + force_generic_plan (como o Prisma reexecuta a mesma instrução). */
async function planoGenerico(sql: string, tipos: string[], args: unknown[], dml = false): Promise<string> {
  await c.query('BEGIN');
  try {
    await c.query('SET LOCAL plan_cache_mode = force_generic_plan');
    await c.query(`PREPARE plano_d050(${tipos.join(', ')}) AS ${sql}`);
    const lista = args
      .map((v) => (Array.isArray(v) ? c.escapeLiteral(`{${v.join(',')}}`) : c.escapeLiteral(String(v))))
      .join(', ');
    const { rows } = await c.query<Linha>(`EXPLAIN (ANALYZE, BUFFERS) EXECUTE plano_d050(${lista})`);
    return texto(rows);
  } finally {
    await c.query('ROLLBACK');
    await c.query('DEALLOCATE ALL');
    void dml;
  }
}

const SEM_SEQ_ITEM = /Seq Scan on reserva_item\b/;
const GIST = /(Index Scan|Bitmap Index Scan)( using| on) reserva_item_sem_sobreposicao/;

// ---- Contratos SQL propostos (dba.md) ----

/** Q6: consultaOcupacoes sobre itens (mesma forma da D-018). $1 salão, $2 profissionais, $3/$4 período. */
const OCUPACOES = `
  SELECT x.pid::text AS profissional_id, o.inicio, o.ocupado_ate
    FROM unnest($2::uuid[]) AS x(pid)
    CROSS JOIN LATERAL (
      SELECT i.id, i.inicio, i.ocupado_ate
        FROM reserva_item i
       WHERE i.profissional_id = x.pid
         AND i.salao_id = $1::uuid
         AND i.status IN ('confirmado', 'concluido', 'nao_compareceu')
         AND tstzrange(i.inicio, i.ocupado_ate, '[)') && tstzrange($3::timestamptz, $4::timestamptz, '[)')
    ) o
   ORDER BY x.pid, o.inicio, o.id`;

/** Q7: PREDICADO_VIGENTE (aliases m e r). */
const PREDICADO_VIGENTE = `
  ((m.tipo = 'confirmacao' AND r.status = 'confirmado')
   OR (m.tipo = 'convite_avaliacao' AND r.status = 'concluido')
   OR (m.tipo = 'remarcacao' AND EXISTS (SELECT 1 FROM reserva_item vi
         WHERE vi.salao_id = m.salao_id AND vi.reserva_id = m.reserva_id AND vi.revisao = m.revisao AND vi.status = 'confirmado'))
   OR (m.tipo = 'cancelamento' AND EXISTS (SELECT 1 FROM reserva_item vi
         WHERE vi.salao_id = m.salao_id AND vi.reserva_id = m.reserva_id AND vi.revisao = m.revisao AND vi.status = 'cancelado')))`;

/** Q4/Q7: consultaAgenda sobre itens. $1 salão, $2 de, $3 ate; `margem` e filtro de profissional ($4) no texto. */
function agenda(margem: '1 day' | '7 days', comProfissional: boolean): string {
  return `
  SELECT i.id::text AS item_id, i.reserva_id::text AS reserva_id, i.profissional_id::text AS profissional_id,
         p.nome AS profissional_nome, i.inicio, i.fim, i.status::text AS status, r.origem::text AS origem, i.encaixe,
         c.nome AS cliente_nome, s.nome AS servico_nome, i.preco_centavos, i.duracao_min,
         EXISTS (SELECT 1 FROM mensagem m
                  WHERE m.salao_id = r.salao_id AND m.reserva_id = r.id AND m.estado = 'falhou'
                    AND ${PREDICADO_VIGENTE}) AS tem_falha_mensagem,
         (SELECT count(*) FROM reserva_item o
           WHERE o.salao_id = i.salao_id AND o.reserva_id = i.reserva_id AND o.status <> 'cancelado'
             AND (o.inicio, o.id) <= (i.inicio, i.id))::int AS posicao_n,
         (SELECT count(*) FROM reserva_item o
           WHERE o.salao_id = i.salao_id AND o.reserva_id = i.reserva_id AND o.status <> 'cancelado')::int AS posicao_de
    FROM reserva_item i
    JOIN reserva r ON r.salao_id = i.salao_id AND r.id = i.reserva_id
    JOIN profissional p ON p.salao_id = i.salao_id AND p.id = i.profissional_id
    JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
    JOIN servico s ON s.salao_id = i.salao_id AND s.id = i.servico_id
   WHERE i.salao_id = $1::uuid
     AND i.inicio < $3::timestamptz AND i.fim > $2::timestamptz
     AND i.inicio >= $2::timestamptz - interval '${margem}'
     ${comProfissional ? 'AND i.profissional_id = $4::uuid' : ''}
   ORDER BY i.inicio, i.id
   LIMIT 201`;
}

/** Q8: listarConfirmadasQueCruzam sobre itens; literal 'confirmado' e o predicado tstzrange redundante. */
function cruzam(comProfissional: boolean): string {
  return `
  SELECT i.reserva_id::text AS id, i.id::text AS item_id, i.profissional_id::text AS profissional_id, p.nome AS profissional_nome,
         i.inicio, i.fim, c.nome AS cliente_nome, count(*) OVER () AS total
    FROM reserva_item i
    JOIN reserva r ON r.salao_id = i.salao_id AND r.id = i.reserva_id
    JOIN profissional p ON p.salao_id = i.salao_id AND p.id = i.profissional_id
    JOIN cliente c ON c.salao_id = r.salao_id AND c.id = r.cliente_id
   WHERE i.salao_id = $1::uuid
     AND i.status = 'confirmado'
     AND tstzrange(i.inicio, i.ocupado_ate, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
     AND i.inicio < $3::timestamptz AND i.fim > $2::timestamptz
     ${comProfissional ? 'AND i.profissional_id = $5::uuid' : ''}
   ORDER BY i.inicio, i.id
   LIMIT $4::int`;
}

/** Q5: contarFuturasDaCliente (RN-18). $1 salão, $2 cliente, $3 agora, $4 chave ignorada. */
const FUTURAS = `
  SELECT count(*) AS total FROM reserva r
   WHERE r.salao_id = $1::uuid AND r.cliente_id = $2::uuid AND r.status = 'confirmado'
     AND (r.chave_requisicao IS DISTINCT FROM $4::text OR $4::text IS NULL)
     AND EXISTS (SELECT 1 FROM reserva_item i
                  WHERE i.salao_id = r.salao_id AND i.reserva_id = r.id
                    AND i.status = 'confirmado' AND i.inicio > $3::timestamptz)`;

/** substituirNaoVigentes: um UPDATE com o mesmo predicado. $1 salão, $2 reserva, $3 agora. */
const SUBSTITUIR = `
  UPDATE mensagem m SET estado = 'substituida', atualizado_em = $3::timestamptz
    FROM reserva r
   WHERE m.salao_id = $1::uuid AND m.reserva_id = $2::uuid AND m.estado = 'pendente'
     AND r.salao_id = m.salao_id AND r.id = m.reserva_id
     AND NOT ${PREDICADO_VIGENTE}`;

describe('D-050 volume', () => {
  it('60.000 itens em 20.000 reservas; 10% dos itens cancelados', async () => {
    const { rows } = await c.query<{ itens: number; reservas: number; cancelados: number }>(
      `SELECT count(*)::int AS itens, count(DISTINCT reserva_id)::int AS reservas,
              count(*) FILTER (WHERE status = 'cancelado')::int AS cancelados
         FROM reserva_item WHERE salao_id = ANY($1) AND duracao_min = 40 AND servico_id IN (SELECT id FROM servico WHERE nome LIKE 'S%')`,
      [sal.map((s) => s.salao)],
    );
    expect(rows[0]).toEqual({ itens: 60_000, reservas: 20_000, cancelados: 6_000 });
  });
});

describe('Q6: consultaOcupacoes sobre itens', () => {
  it.each([
    ['10 profissionais × 61 dias', LONGO, 10],
    ['1 profissional × 1 dia', DIA, 1],
  ])('custom e genérico (%s): GiST reserva_item_sem_sobreposicao, sem Seq Scan em reserva_item', async (nome, p, n) => {
    const s = sal[0];
    const args = [s.salao, s.profissionais.slice(0, n), p.de, p.ate];
    const custom = await planoCustom(OCUPACOES, args);
    const generico = await planoGenerico(OCUPACOES, ['uuid', 'uuid[]', 'timestamptz', 'timestamptz'], args);
    console.log(`[D-050-plano] ocupacoes custom ${nome} (ms=${tempo(custom)})\n${custom}`);
    console.log(`[D-050-plano] ocupacoes genérico ${nome} (ms=${tempo(generico)})\n${generico}`);
    for (const plano of [custom, generico]) {
      expect(plano).not.toMatch(SEM_SEQ_ITEM);
      expect(plano).toMatch(GIST);
    }
  }, 60_000);
});

describe('Q4/Q7: agenda sobre itens (EXISTS da falha com PREDICADO_VIGENTE e posição "n de N")', () => {
  it.each([
    ['semana, sem filtro', SEMANA, false],
    ['semana, um profissional', SEMANA, true],
    ['dia, sem filtro', DIA, false],
    ['dia, um profissional', DIA, true],
  ])('%s: índice de agenda em reserva_item, sem Seq Scan em reserva_item nem em mensagem', async (nome, p, comProf) => {
    const s = sal[1];
    const args = comProf ? [s.salao, p.de, p.ate, s.profissionais[3]] : [s.salao, p.de, p.ate];
    const tipos = comProf ? ['uuid', 'timestamptz', 'timestamptz', 'uuid'] : ['uuid', 'timestamptz', 'timestamptz'];
    for (const margem of ['1 day', '7 days'] as const) {
      const custom = await planoCustom(agenda(margem, comProf), args);
      const generico = await planoGenerico(agenda(margem, comProf), tipos, args);
      console.log(`[D-050-plano] agenda ${nome} margem ${margem} custom (ms=${tempo(custom)}) genérico (ms=${tempo(generico)})`);
      if (margem === '1 day') console.log(`[D-050-plano] agenda ${nome} genérico\n${generico}`);
      for (const plano of [custom, generico]) {
        expect(plano).not.toMatch(SEM_SEQ_ITEM);
        expect(plano).not.toMatch(/Seq Scan on mensagem\b/);
        expect(plano).toMatch(/(Index Scan using|Bitmap Index Scan on) reserva_item_salao_id_(profissional_id_)?inicio_idx\b/);
        // Qualquer índice que começa pela reserva (o planejador escolhe a UNIQUE (reserva_id, tipo, revisao)).
        expect(plano).toMatch(/(Index Scan using|Bitmap Index Scan on) mensagem_(salao_id_reserva_id_idx|reserva_id_tipo_revisao_key)\b/);
      }
    }
  }, 60_000);

  it('a agenda devolve o que se espera no volume (itens do período, posição e falhas)', async () => {
    const s = sal[1];
    const { rows } = await c.query<{ posicao_n: number; posicao_de: number; tem_falha_mensagem: boolean; status: string }>(
      agenda('1 day', false),
      [s.salao, SEMANA.de, SEMANA.ate],
    );
    // 7 dias × 12 reservas × 3 itens = 252 > 201: truncado no limite.
    expect(rows).toHaveLength(201);
    expect(rows.every((x) => x.posicao_de <= 3 && x.posicao_n <= x.posicao_de)).toBe(true);
    expect(rows.some((x) => x.tem_falha_mensagem)).toBe(true);
  });
});

describe('Q8: listarConfirmadasQueCruzam sobre itens', () => {
  it.each([
    ['todos os profissionais', false],
    ['um profissional', true],
  ])('%s: GiST da exclusion pela implicação do literal, custom e genérico', async (nome, comProf) => {
    const s = sal[0];
    const args = comProf ? [s.salao, SEMANA.de, SEMANA.ate, 50, s.profissionais[2]] : [s.salao, SEMANA.de, SEMANA.ate, 50];
    const tipos = comProf ? ['uuid', 'timestamptz', 'timestamptz', 'int', 'uuid'] : ['uuid', 'timestamptz', 'timestamptz', 'int'];
    const custom = await planoCustom(cruzam(comProf), args);
    const generico = await planoGenerico(cruzam(comProf), tipos, args);
    console.log(`[D-050-plano] cruzam ${nome} custom (ms=${tempo(custom)})\n${custom}`);
    console.log(`[D-050-plano] cruzam ${nome} genérico (ms=${tempo(generico)})\n${generico}`);
    for (const plano of [custom, generico]) {
      expect(plano).not.toMatch(SEM_SEQ_ITEM);
      expect(plano).toMatch(GIST);
    }
  }, 60_000);
});

describe('Q5: contarFuturasDaCliente', () => {
  it('cliente com 50 reservas: reserva_cliente_confirmada_idx + item pela reserva', async () => {
    const s = sal[0];
    const { rows } = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM reserva WHERE cliente_id = $1', [s.cliente]);
    expect(rows[0].n).toBe(50);
    const args = [s.salao, s.cliente, '2030-06-01T00:00:00Z', null];
    const custom = await planoCustom(FUTURAS, args);
    const generico = await planoGenerico(FUTURAS, ['uuid', 'uuid', 'timestamptz', 'text'], [s.salao, s.cliente, '2030-06-01T00:00:00Z', 'x']);
    console.log(`[D-050-plano] futuras custom (ms=${tempo(custom)})\n${custom}\n[D-050-plano] futuras genérico\n${generico}`);
    for (const plano of [custom, generico]) {
      expect(plano).toMatch(/reserva_cliente_confirmada_idx/);
      expect(plano).not.toMatch(SEM_SEQ_ITEM);
      expect(plano).not.toMatch(/Seq Scan on reserva\b/);
    }
    const total = await c.query<{ total: string }>(FUTURAS, args);
    // 29 futuras de 2031; a reserva grande (2030-01-01) já passou nesse `agora`.
    expect(Number(total.rows[0].total)).toBe(29);
  }, 60_000);
});

describe('substituirNaoVigentes', () => {
  it('reserva com 10 itens e 30 mensagens: acessa só a reserva (sem varredura de mensagem/itens) e substitui as pendentes não vigentes', async () => {
    const s = sal[0];
    await c.query('BEGIN');
    try {
      const { rows } = await c.query<Linha>(`EXPLAIN (ANALYZE, BUFFERS) ${SUBSTITUIR}`, [s.salao, s.reservaGrande, '2029-12-31T00:00:00Z']);
      const plano = texto(rows);
      console.log(`[D-050-plano] substituirNaoVigentes (ms=${tempo(plano)})\n${plano}`);
      expect(plano).toMatch(/mensagem_salao_id_reserva_id_idx/);
      expect(plano).not.toMatch(/Seq Scan on (mensagem|reserva_item|reserva)\b/);
    } finally {
      await c.query('ROLLBACK');
    }
    // Efeito: pendentes = revisões 0, 3, …, 27 (10). Itens: revisões 20..22 cancelados, 23..29 confirmados.
    // Vigentes entre as pendentes: confirmacao 0 (reserva confirmada), cancelamento 21 (item 21 cancelado) e
    // remarcacao 24 (item 24 confirmado); 27 é cancelamento de item confirmado (obsoleto). Substituídas: 7.
    await c.query('BEGIN');
    try {
      const r = await c.query(SUBSTITUIR, [s.salao, s.reservaGrande, '2029-12-31T00:00:00Z']);
      expect(r.rowCount).toBe(7);
      const fica = await c.query<{ revisao: number }>(
        "SELECT revisao FROM mensagem WHERE reserva_id = $1 AND estado = 'pendente' ORDER BY revisao",
        [s.reservaGrande],
      );
      expect(fica.rows.map((x) => x.revisao)).toEqual([0, 21, 24]);
    } finally {
      await c.query('ROLLBACK');
    }
  }, 60_000);
});
