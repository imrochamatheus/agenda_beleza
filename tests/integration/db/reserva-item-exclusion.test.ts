import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conectar, criarCenario, criarProfissional, criarServico, erroSql } from '../../support/sql';

// D-050 T-1: CA-19 (RN-15/RN-16) e as restrições novas de reserva_item/mensagem, por SQL direto
// (err.code e err.constraint do driver pg). Contrato de nomes: docs/demandas/D-050/dba.md §2.
let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});

afterAll(async () => {
  await c.end();
});

type Cenario = { salaoId: string; profissionalId: string; clienteId: string };

type Item = {
  profissionalId?: string;
  inicio: string;
  /** minutos; fim = inicio + duracao (reserva_item_fim_chk). */
  duracao?: number;
  /** minutos de intervalo depois do fim; ocupado_ate = fim + intervalo. */
  intervalo?: number;
  status?: 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
  encaixe?: boolean;
  servicoId?: string;
  /** Padrão: a posição no array. */
  ordem?: number;
};

async function novaReserva(s: Cenario, inicio = '2026-12-01T09:00:00Z'): Promise<string> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem)
     VALUES ($1, $2, $3::timestamptz, $3::timestamptz + interval '1 hour', 'confirmado', 'equipe') RETURNING id`,
    [s.salaoId, s.clienteId, inicio],
  );
  return r.rows[0].id;
}

/** Insere N itens num ÚNICO comando (INSERT … SELECT FROM unnest), como fará `criarItens`. */
async function inserirItens(s: Cenario, reservaId: string, itens: Item[], cli: pg.Client = c): Promise<string[]> {
  const servicos: string[] = [];
  for (const it of itens) servicos.push(it.servicoId ?? (await criarServico(c, s.salaoId)));
  const r = await cli.query<{ id: string }>(
    `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                               inicio, fim, ocupado_ate, status, encaixe)
     SELECT $1, $2, x.servico, x.prof, x.ordem, 5000, x.dur, x.ini,
            x.ini + make_interval(mins => x.dur), x.ini + make_interval(mins => x.dur + x.intv), x.st, x.enc
       FROM unnest($3::uuid[], $4::uuid[], $5::int[], $6::int[], $7::timestamptz[], $8::int[], $9::status_reserva[], $10::bool[])
            AS x(servico, prof, ordem, dur, ini, intv, st, enc)
     RETURNING id`,
    [
      s.salaoId,
      reservaId,
      servicos,
      itens.map((i) => i.profissionalId ?? s.profissionalId),
      itens.map((i, k) => i.ordem ?? k),
      itens.map((i) => i.duracao ?? 40),
      itens.map((i) => i.inicio),
      itens.map((i) => i.intervalo ?? 0),
      itens.map((i) => i.status ?? 'confirmado'),
      itens.map((i) => i.encaixe ?? false),
    ],
  );
  return r.rows.map((x) => x.id);
}

async function itensDoProfissional(profissionalId: string): Promise<number> {
  const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM reserva_item WHERE profissional_id = $1', [
    profissionalId,
  ]);
  return r.rows[0].n;
}

const SOBREPOSICAO = { code: '23P01', constraint: 'reserva_item_sem_sobreposicao' };
const MESMA_RESERVA = { code: '23P01', constraint: 'reserva_item_mesma_reserva_sem_sobreposicao' };

describe('CA-19: reserva_item_sem_sobreposicao (por profissional, status ativos)', () => {
  it('CA-19: item ativo de P1 em [10:00, 10:40) recusa outro item ativo de P1 que o cruze (outra reserva), com 23P01 e o nome novo', async () => {
    const s = await criarCenario(c);
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:00:00Z' }]);
    const erro = await erroSql(inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:20:00Z' }]));
    expect(erro).toEqual(SOBREPOSICAO);
    expect(await itensDoProfissional(s.profissionalId)).toBe(1);
  });

  it('CA-19 (RN-16): encaixe = true não tem exceção', async () => {
    const s = await criarCenario(c);
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:00:00Z' }]);
    const erro = await erroSql(
      inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:39:00Z', encaixe: true }]),
    );
    expect(erro).toEqual(SOBREPOSICAO);
  });

  it('CA-19: um item cancelado no mesmo intervalo é aceito (e um ativo sobre um cancelado também)', async () => {
    const s = await criarCenario(c);
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:00:00Z' }]);
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:00:00Z', status: 'cancelado' }]);
    const t = await criarCenario(c);
    await inserirItens(t, await novaReserva(t), [{ inicio: '2026-12-01T10:00:00Z', status: 'cancelado' }]);
    await inserirItens(t, await novaReserva(t), [{ inicio: '2026-12-01T10:10:00Z' }]);
    expect(await itensDoProfissional(s.profissionalId)).toBe(2);
    expect(await itensDoProfissional(t.profissionalId)).toBe(2);
  });

  it.each(['concluido', 'nao_compareceu'] as const)('item %s também ocupa o horário', async (status) => {
    const s = await criarCenario(c);
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:00:00Z', status }]);
    expect(await erroSql(inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:30:00Z' }]))).toEqual(
      SOBREPOSICAO,
    );
  });

  it('semiaberto: itens adjacentes do mesmo profissional são aceitos; 1 s de sobreposição é recusado', async () => {
    const s = await criarCenario(c);
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:00:00Z' }]);
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:40:00Z' }]);
    const erro = await erroSql(
      c.query(
        `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                   inicio, fim, ocupado_ate, status)
         VALUES ($1, $2, $3, $4, 0, 0, 1, '2026-12-01T10:39:59Z', '2026-12-01T10:40:59Z', '2026-12-01T10:40:59Z', 'confirmado')`,
        [s.salaoId, await novaReserva(s), await criarServico(c, s.salaoId), s.profissionalId],
      ),
    );
    expect(erro).toEqual(SOBREPOSICAO);
  });

  it('o intervalo gravado em ocupado_ate bloqueia o item seguinte do mesmo profissional', async () => {
    const s = await criarCenario(c);
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:00:00Z', duracao: 30, intervalo: 10 }]);
    expect(await erroSql(inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:30:00Z' }]))).toEqual(
      SOBREPOSICAO,
    );
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:40:00Z' }]);
  });

  it('profissionais distintos podem ter itens sobrepostos (reservas diferentes)', async () => {
    const s = await criarCenario(c);
    const outro = await criarProfissional(c, s.salaoId);
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:00:00Z' }]);
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:10:00Z', profissionalId: outro }]);
    expect(await itensDoProfissional(outro)).toBe(1);
  });

  it('reativar por UPDATE um item cancelado sobre outro ativo é recusado e ele continua cancelado', async () => {
    const s = await criarCenario(c);
    const [cancelado] = await inserirItens(s, await novaReserva(s), [
      { inicio: '2026-12-01T10:00:00Z', status: 'cancelado' },
    ]);
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:20:00Z' }]);
    expect(await erroSql(c.query("UPDATE reserva_item SET status = 'confirmado' WHERE id = $1", [cancelado]))).toEqual(
      SOBREPOSICAO,
    );
    const r = await c.query('SELECT status::text AS status FROM reserva_item WHERE id = $1', [cancelado]);
    expect(r.rows).toEqual([{ status: 'cancelado' }]);
  });

  it('remarcar por UPDATE (mesma linha) para um horário que só cruza a própria posição antiga é aceito', async () => {
    const s = await criarCenario(c);
    const [id] = await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:00:00Z' }]);
    await c.query(
      `UPDATE reserva_item SET inicio = '2026-12-01T10:20:00Z', fim = '2026-12-01T11:00:00Z', ocupado_ate = '2026-12-01T11:00:00Z'
        WHERE id = $1 AND status = 'confirmado'`,
      [id],
    );
    const r = await c.query('SELECT inicio FROM reserva_item WHERE id = $1', [id]);
    expect((r.rows[0] as { inicio: Date }).inicio.toISOString()).toBe('2026-12-01T10:20:00.000Z');
  });

  it('duas transações concorrentes com itens sobrepostos do mesmo profissional: uma grava, a outra recebe 23P01', async () => {
    const s = await criarCenario(c);
    const r1 = await novaReserva(s);
    const r2 = await novaReserva(s);
    const servico1 = await criarServico(c, s.salaoId);
    const servico2 = await criarServico(c, s.salaoId);
    const t1 = await conectar();
    const t2 = await conectar();
    try {
      await t1.query('BEGIN');
      await t2.query('BEGIN');
      await inserirItens(s, r1, [{ inicio: '2026-12-01T10:00:00Z', servicoId: servico1 }], t1);
      // t2 espera o desfecho de t1 no índice da exclusion; depois do COMMIT de t1, falha.
      const segundo = erroSql(inserirItens(s, r2, [{ inicio: '2026-12-01T10:30:00Z', servicoId: servico2 }], t2));
      await new Promise((ok) => setTimeout(ok, 100));
      await t1.query('COMMIT');
      expect(await segundo).toEqual(SOBREPOSICAO);
      await t2.query('ROLLBACK');
    } finally {
      await t1.end();
      await t2.end();
    }
    expect(await itensDoProfissional(s.profissionalId)).toBe(1);
  });

  it('virada de dia: o resultado não depende do TimeZone da sessão', async () => {
    const s = await criarCenario(c);
    const local = await conectar();
    try {
      await local.query("SET TIME ZONE 'America/Sao_Paulo'");
      await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T23:40:00Z' }], local);
      expect(
        await erroSql(inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-02T00:00:00Z' }], local)),
      ).toEqual(SOBREPOSICAO);
      await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-02T00:20:00Z' }], local);
    } finally {
      await local.end();
    }
    expect(await itensDoProfissional(s.profissionalId)).toBe(2);
  });
});

describe('RN-8 (Q2): reserva_item_mesma_reserva_sem_sobreposicao (defesa em profundidade)', () => {
  it('dois itens da MESMA reserva com profissionais diferentes e [inicio, fim) cruzados, num só INSERT: 23P01 com o nome da segunda exclusion e nada gravado', async () => {
    const s = await criarCenario(c);
    const outro = await criarProfissional(c, s.salaoId);
    const reserva = await novaReserva(s);
    const erro = await erroSql(
      inserirItens(s, reserva, [
        { inicio: '2026-12-01T10:00:00Z' },
        { inicio: '2026-12-01T10:30:00Z', profissionalId: outro },
      ]),
    );
    expect(erro).toEqual(MESMA_RESERVA);
    const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM reserva_item WHERE reserva_id = $1', [reserva]);
    expect(r.rows[0].n).toBe(0);
  });

  it('o mesmo conflito em dois comandos (item novo contra item gravado) também é recusado', async () => {
    const s = await criarCenario(c);
    const outro = await criarProfissional(c, s.salaoId);
    const reserva = await novaReserva(s);
    await inserirItens(s, reserva, [{ inicio: '2026-12-01T10:00:00Z' }]);
    expect(
      await erroSql(inserirItens(s, reserva, [{ inicio: '2026-12-01T10:39:00Z', profissionalId: outro, ordem: 1 }])),
    ).toEqual(MESMA_RESERVA);
  });

  it('mesmo profissional, mesma reserva, sobrepostos: dispara reserva_item_sem_sobreposicao (criada antes; ordem de OID)', async () => {
    const s = await criarCenario(c);
    const erro = await erroSql(
      inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T10:00:00Z' }, { inicio: '2026-12-01T10:20:00Z' }]),
    );
    expect(erro).toEqual(SOBREPOSICAO);
  });

  it('itens adjacentes da mesma reserva (A.fim = B.inicio) com profissionais diferentes são aceitos num só INSERT', async () => {
    const s = await criarCenario(c);
    const outro = await criarProfissional(c, s.salaoId);
    const ids = await inserirItens(s, await novaReserva(s), [
      { inicio: '2026-12-01T10:00:00Z', intervalo: 15 },
      { inicio: '2026-12-01T10:40:00Z', profissionalId: outro },
    ]);
    expect(ids).toHaveLength(2);
  });

  it('o intervalo (ocupado_ate) NÃO conta entre profissionais diferentes da mesma reserva (RN-8 sem buffer)', async () => {
    const s = await criarCenario(c);
    const outro = await criarProfissional(c, s.salaoId);
    // A: [10:00, 10:40) ocupado até 10:50; B começa 10:40 com outro profissional.
    const ids = await inserirItens(s, await novaReserva(s), [
      { inicio: '2026-12-01T10:00:00Z', intervalo: 10 },
      { inicio: '2026-12-01T10:40:00Z', profissionalId: outro },
    ]);
    expect(ids).toHaveLength(2);
  });

  it('item cancelado da mesma reserva não bloqueia outro no mesmo horário', async () => {
    const s = await criarCenario(c);
    const outro = await criarProfissional(c, s.salaoId);
    const ids = await inserirItens(s, await novaReserva(s), [
      { inicio: '2026-12-01T10:00:00Z', status: 'cancelado' },
      { inicio: '2026-12-01T10:00:00Z', profissionalId: outro },
    ]);
    expect(ids).toHaveLength(2);
  });

  it('CA-20 (RN-9) no banco: mesmo profissional, A [09:00, 09:30) com intervalo 10: B às 09:30 é recusado, às 09:40 aceito', async () => {
    const s = await criarCenario(c);
    const reserva = await novaReserva(s);
    expect(
      await erroSql(
        inserirItens(s, reserva, [
          { inicio: '2026-12-01T09:00:00Z', duracao: 30, intervalo: 10 },
          { inicio: '2026-12-01T09:30:00Z', duracao: 30, intervalo: 10 },
        ]),
      ),
    ).toEqual(SOBREPOSICAO);
    const ids = await inserirItens(s, reserva, [
      { inicio: '2026-12-01T09:00:00Z', duracao: 30, intervalo: 10 },
      { inicio: '2026-12-01T09:40:00Z', duracao: 30, intervalo: 10 },
    ]);
    expect(ids).toHaveLength(2);
  });
});

describe('CHECKs e unicidade de reserva_item', () => {
  async function inserirCru(
    s: Cenario,
    campos: { inicio: string; fim: string; ocupadoAte: string; duracao: number; revisao?: number },
    reservaId?: string,
    servicoId?: string,
  ) {
    return c.query(
      `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                 inicio, fim, ocupado_ate, status, revisao)
       VALUES ($1, $2, $3, $4, 0, 0, $5, $6, $7, $8, 'confirmado', $9)`,
      [
        s.salaoId,
        reservaId ?? (await novaReserva(s)),
        servicoId ?? (await criarServico(c, s.salaoId)),
        s.profissionalId,
        campos.duracao,
        campos.inicio,
        campos.fim,
        campos.ocupadoAte,
        campos.revisao ?? 0,
      ],
    );
  }

  it.each([
    ['ocupado_ate < fim', '2026-12-01T10:00:00Z', '2026-12-01T10:30:00Z', '2026-12-01T10:20:00Z', 30, 'reserva_item_ordem_chk'],
    ['fim <> inicio + duracao', '2026-12-01T10:00:00Z', '2026-12-01T10:45:00Z', '2026-12-01T10:45:00Z', 30, 'reserva_item_fim_chk'],
    ['duracao > 1440 (teto da margem da agenda)', '2026-12-01T10:00:00Z', '2026-12-02T10:01:00Z', '2026-12-02T10:01:00Z', 1441, 'reserva_item_duracao_teto_chk'],
  ])('%s é recusado com 23514', async (_caso, inicio, fim, ocupadoAte, duracao, constraint) => {
    const s = await criarCenario(c);
    expect(await erroSql(inserirCru(s, { inicio, fim, ocupadoAte, duracao }))).toEqual({ code: '23514', constraint });
  });

  it('revisao negativa é recusada (23514)', async () => {
    const s = await criarCenario(c);
    expect(
      await erroSql(
        inserirCru(s, {
          inicio: '2026-12-01T10:00:00Z',
          fim: '2026-12-01T10:30:00Z',
          ocupadoAte: '2026-12-01T10:30:00Z',
          duracao: 30,
          revisao: -1,
        }),
      ),
    ).toEqual({ code: '23514', constraint: 'reserva_item_revisao_chk' });
  });

  it('Q11: fim = inicio + duracao vale com sessão em fuso com horário de verão, atravessando a mudança', async () => {
    const s = await criarCenario(c);
    const local = await conectar();
    try {
      // 01/11/2026 06:00 UTC: fim do horário de verão em Nova York (02:00 → 01:00 local).
      await local.query("SET TIME ZONE 'America/New_York'");
      await local.query(
        `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                   inicio, fim, ocupado_ate, status)
         VALUES ($1, $2, $3, $4, 0, 0, 90, '2026-11-01T05:30:00Z', '2026-11-01T07:00:00Z', '2026-11-01T07:00:00Z', 'confirmado')`,
        [s.salaoId, await novaReserva(s), await criarServico(c, s.salaoId), s.profissionalId],
      );
      const r = await local.query<{ ok: boolean }>(
        "SELECT fim = inicio + make_interval(mins => duracao_min) AS ok FROM reserva_item WHERE profissional_id = $1",
        [s.profissionalId],
      );
      expect(r.rows).toEqual([{ ok: true }]);
    } finally {
      await local.end();
    }
  });

  it('Q10 (RN-2): o mesmo serviço duas vezes na reserva é recusado (23505), inclusive com o primeiro cancelado', async () => {
    const s = await criarCenario(c);
    const outro = await criarProfissional(c, s.salaoId);
    const reserva = await novaReserva(s);
    const servico = await criarServico(c, s.salaoId);
    await inserirItens(s, reserva, [{ inicio: '2026-12-01T10:00:00Z', servicoId: servico, status: 'cancelado' }]);
    const erro = await erroSql(
      c.query(
        `INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                   inicio, fim, ocupado_ate, status)
         VALUES ($1, $2, $3, $4, 1, 0, 40, '2026-12-01T11:00:00Z', '2026-12-01T11:40:00Z', '2026-12-01T11:40:00Z', 'confirmado')`,
        [s.salaoId, reserva, servico, outro],
      ),
    );
    expect(erro).toEqual({ code: '23505', constraint: 'reserva_item_salao_id_reserva_id_servico_id_key' });
    // Controle: o mesmo serviço em OUTRA reserva é aceito.
    await inserirItens(s, await novaReserva(s), [{ inicio: '2026-12-01T12:00:00Z', servicoId: servico }]);
  });
});

describe('mensagem.reserva_item_id (Q3)', () => {
  it('nulo é aceito em todos os tipos; preenchido só em remarcacao/cancelamento (mensagem_item_tipo_chk)', async () => {
    const s = await criarCenario(c);
    const reserva = await novaReserva(s);
    const [item] = await inserirItens(s, reserva, [{ inicio: '2026-12-01T10:00:00Z' }]);
    const inserir = (tipo: string, revisao: number, itemId: string | null) =>
      c.query('INSERT INTO mensagem (salao_id, reserva_id, reserva_item_id, tipo, revisao) VALUES ($1, $2, $3, $4::tipo_mensagem, $5)', [
        s.salaoId,
        reserva,
        itemId,
        tipo,
        revisao,
      ]);
    for (const tipo of ['confirmacao', 'convite_avaliacao']) {
      expect(await erroSql(inserir(tipo, 0, item))).toEqual({ code: '23514', constraint: 'mensagem_item_tipo_chk' });
      await inserir(tipo, 0, null);
    }
    await inserir('remarcacao', 1, item);
    await inserir('cancelamento', 2, item);
    await inserir('cancelamento', 3, null);
    const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM mensagem WHERE reserva_id = $1', [reserva]);
    expect(r.rows[0].n).toBe(5);
  });

  it('item inexistente é recusado pela FK de 3 colunas (23503)', async () => {
    const s = await criarCenario(c);
    const reserva = await novaReserva(s);
    expect(
      await erroSql(
        c.query(
          "INSERT INTO mensagem (salao_id, reserva_id, reserva_item_id, tipo, revisao) VALUES ($1, $2, gen_random_uuid(), 'remarcacao', 1)",
          [s.salaoId, reserva],
        ),
      ),
    ).toEqual({ code: '23503', constraint: 'mensagem_salao_id_reserva_id_reserva_item_id_fkey' });
  });

  it('o item citado por uma mensagem não pode ser apagado (RESTRICT)', async () => {
    const s = await criarCenario(c);
    const reserva = await novaReserva(s);
    const [item] = await inserirItens(s, reserva, [{ inicio: '2026-12-01T10:00:00Z' }]);
    await c.query(
      "INSERT INTO mensagem (salao_id, reserva_id, reserva_item_id, tipo, revisao) VALUES ($1, $2, $3, 'cancelamento', 1)",
      [s.salaoId, reserva, item],
    );
    expect(await erroSql(c.query('DELETE FROM reserva_item WHERE id = $1', [item]))).toEqual({
      code: '23503',
      constraint: 'mensagem_salao_id_reserva_id_reserva_item_id_fkey',
    });
  });
});
