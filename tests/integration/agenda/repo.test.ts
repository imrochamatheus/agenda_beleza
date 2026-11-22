import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultaAgenda } from '@/server/repos/agenda';
import { repos } from '@/server/repos';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarSalaoCompleto } from '../../support/factories';
import { instalarContadorDeComandos } from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { conectar } from '../../support/sql';

import {
  UUID_INEXISTENTE,
  anonimizarPorSql,
  criarCenario,
  ctxDoGestor,
  hora,
  inserirCliente,
  reservar,
} from './apoio';

// D-028 T-2: repositório da agenda (CA-6, CA-11, CA-12, CA-13, CA-16 e o plano com índice).

let c: pg.Client;
let ce: CenarioReserva;
let ctx: ReturnType<typeof ctxDoGestor>;
const periodo = { de: hora('00:00'), ate: hora('00:00', 1) };

beforeAll(async () => {
  c = await conectar();
  ce = await criarCenario();
  ctx = ce.ctxEquipe;
});
afterAll(async () => {
  await c.end();
});

describe('listarAgenda', () => {
  it('todos os status, por início e id, com itens de snapshot e cliente; sem telefone no DTO', async () => {
    const cli = await inserirCliente(c, ce.s.salaoId, 'Maria Souza', '+5511912340001');
    const ids: Record<string, string> = {};
    for (const [i, status] of (['confirmado', 'cancelado', 'concluido', 'nao_compareceu'] as const).entries()) {
      ids[status] = await reservar(c, ce, {
        profissionalId: ce.ana,
        inicio: hora(`${9 + i}:00`),
        status,
        clienteId: cli,
        itens: [
          { servicoId: ce.A, precoCentavos: 5000, duracaoMin: 30 },
          { servicoId: ce.B, precoCentavos: 7000, duracaoMin: 30 },
        ],
      });
    }
    const { reservas, truncada } = await repos().agenda.listarAgenda(ctx, { periodo, profissionalId: null, limite: 200 });
    expect(truncada).toBe(false);
    expect(reservas.map((r) => [r.id, r.status])).toEqual([
      [ids.confirmado, 'confirmado'],
      [ids.cancelado, 'cancelado'],
      [ids.concluido, 'concluido'],
      [ids.nao_compareceu, 'nao_compareceu'],
    ]);
    expect(reservas[0]).toMatchObject({
      profissionalId: ce.ana,
      profissionalNome: 'Ana',
      profissionalAtivo: true,
      clienteNome: 'Maria Souza',
      clienteAnonimizada: false,
      origem: 'equipe',
      encaixe: false,
      itens: [
        { nome: 'A', precoCentavos: 5000, duracaoMin: 30 },
        { nome: 'B', precoCentavos: 7000, duracaoMin: 30 },
      ],
    });
    expect(JSON.stringify(reservas)).not.toContain('+5511912340001');
    expect(Object.keys(reservas[0])).not.toContain('telefone');
  });

  it('o item é o snapshot: mudar o preço do serviço depois não altera a reserva (CA-5)', async () => {
    const s = await criarCenario();
    const id = await reservar(c, s, { profissionalId: s.ana, inicio: hora('10:00'), itens: [{ servicoId: s.A, precoCentavos: 5000, duracaoMin: 60 }] });
    await c.query('UPDATE servico SET preco_centavos = 9999, duracao_min = 10 WHERE id = $1', [s.A]);
    const { reservas } = await repos().agenda.listarAgenda(s.ctxEquipe, { periodo, profissionalId: null, limite: 10 });
    expect(reservas.find((r) => r.id === id)!.itens).toEqual([{ nome: 'A', precoCentavos: 5000, duracaoMin: 60 }]);
  });

  it('anonimizada: nome null e clienteAnonimizada (CA-5)', async () => {
    const s = await criarCenario();
    const cli = await inserirCliente(c, s.s.salaoId, 'Será Removida');
    await reservar(c, s, { profissionalId: s.ana, inicio: hora('10:00'), clienteId: cli });
    await anonimizarPorSql(c, cli);
    const { reservas } = await repos().agenda.listarAgenda(s.ctxEquipe, { periodo, profissionalId: null, limite: 10 });
    expect(reservas).toHaveLength(1);
    expect(reservas[0]).toMatchObject({ clienteNome: null, clienteAnonimizada: true });
    expect(reservas[0].itens).toHaveLength(1);
  });

  it('sobreposição ao período: cruza a meia-noite nos dois dias; encostar na fronteira não conta (CA-13)', async () => {
    const s = await criarCenario();
    const id = await reservar(c, s, { profissionalId: s.ana, inicio: hora('23:00'), fim: hora('01:00', 1) });
    const antes = await reservar(c, s, { profissionalId: s.ana, inicio: hora('22:00', -1), fim: hora('00:00') });
    const depois = await reservar(c, s, { profissionalId: s.ana, inicio: hora('00:00', 1), fim: hora('01:00', 1), status: 'cancelado' });
    const dia = (n: number) => ({ de: hora('00:00', n), ate: hora('00:00', n + 1) });
    const ids = async (n: number) => (await repos().agenda.listarAgenda(s.ctxEquipe, { periodo: dia(n), profissionalId: null, limite: 10 })).reservas.map((r) => r.id);
    expect(await ids(0)).toEqual([id]);
    expect(await ids(1)).toEqual([id, depois]);
    expect(await ids(-1)).toEqual([antes]);
  });

  it('profissional inativo continua listado com o nome (CA-6)', async () => {
    const s = await criarCenario();
    const id = await reservar(c, s, { profissionalId: s.bia, inicio: hora('10:00'), status: 'concluido' });
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [s.bia]);
    const { reservas } = await repos().agenda.listarAgenda(s.ctxEquipe, { periodo, profissionalId: null, limite: 10 });
    expect(reservas).toMatchObject([{ id, profissionalNome: 'Bia', profissionalAtivo: false }]);
  });

  it('filtro por profissional; id malformado → NaoEncontrado sem consultar; limite inválido → RangeError', async () => {
    const s = await criarCenario();
    await reservar(c, s, { profissionalId: s.ana, inicio: hora('10:00') });
    const b = await reservar(c, s, { profissionalId: s.bia, inicio: hora('11:00') });
    const so = await repos().agenda.listarAgenda(s.ctxEquipe, { periodo, profissionalId: s.bia, limite: 10 });
    expect(so.reservas.map((r) => r.id)).toEqual([b]);
    await expect(repos().agenda.listarAgenda(s.ctxEquipe, { periodo, profissionalId: 'x', limite: 10 })).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().agenda.listarAgenda(s.ctxEquipe, { periodo, profissionalId: null, limite: 0 })).rejects.toBeInstanceOf(RangeError);
  });

  it('limite: devolve até `limite` e marca truncada', async () => {
    const s = await criarCenario();
    const cli = await inserirCliente(c, s.s.salaoId, 'Muitas');
    await c.query(
      `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::timestamptz + g * interval '1 minute', $4::timestamptz + (g + 1) * interval '1 minute',
              $4::timestamptz + (g + 1) * interval '1 minute', 'cancelado', 'equipe'
         FROM generate_series(0, 24) g`,
      [s.s.salaoId, s.ana, cli, hora('08:00')],
    );
    const dez = await repos().agenda.listarAgenda(s.ctxEquipe, { periodo, profissionalId: null, limite: 10 });
    expect(dez.reservas).toHaveLength(10);
    expect(dez.truncada).toBe(true);
    const todas = await repos().agenda.listarAgenda(s.ctxEquipe, { periodo, profissionalId: null, limite: 25 });
    expect(todas.reservas).toHaveLength(25);
    expect(todas.truncada).toBe(false);
  });
});

describe('detalhe', () => {
  it('uma reserva do salão; do profissional certo; ids estranhos → NaoEncontrado', async () => {
    const s = await criarCenario();
    const id = await reservar(c, s, { profissionalId: s.ana, inicio: hora('10:00') });
    expect(await repos().agenda.detalhe(s.ctxEquipe, id, null)).toMatchObject({ id, profissionalNome: 'Ana' });
    expect(await repos().agenda.detalhe(s.ctxEquipe, id, s.ana)).toMatchObject({ id });
    await expect(repos().agenda.detalhe(s.ctxEquipe, id, s.bia)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().agenda.detalhe(s.ctxEquipe, UUID_INEXISTENTE, null)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().agenda.detalhe(s.ctxEquipe, 'x', null)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().agenda.detalhe(s.ctxEquipe, id, 'x')).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().agenda.detalhe(s.ctxEquipe, 7, null)).rejects.toBeInstanceOf(NaoEncontrado);
  });
});

describe('listarJornadas', () => {
  it('do salão inteiro ou de um profissional; id malformado → NaoEncontrado', async () => {
    const s = await criarCenario({ jornada: [['09:00', '12:00'], ['14:00', '18:00']] });
    const todas = await repos().agenda.listarJornadas(s.ctxEquipe, null);
    expect(todas).toHaveLength(14);
    expect(new Set(todas.map((j) => j.profissionalId))).toEqual(new Set([s.ana]));
    expect(await repos().agenda.listarJornadas(s.ctxEquipe, s.bia)).toEqual([]);
    await expect(repos().agenda.listarJornadas(s.ctxEquipe, 'x')).rejects.toBeInstanceOf(NaoEncontrado);
  });
});

describe('CA-16: uma instrução por chamada, qualquer volume', () => {
  it('1 e 50 reservas (clientes e itens distintos): 1 instrução em listarAgenda e 1 em detalhe', async () => {
    const um = await criarCenario();
    const muitos = await criarCenario();
    const idUm = await reservar(c, um, { profissionalId: um.ana, inicio: hora('10:00') });
    let ultimo = '';
    for (let i = 0; i < 50; i++) {
      ultimo = await reservar(c, muitos, {
        profissionalId: i % 2 === 0 ? muitos.ana : muitos.bia,
        inicio: hora('08:00') && new Date(hora('08:00').getTime() + i * 10 * 60_000),
        fim: new Date(hora('08:00').getTime() + (i * 10 + 5) * 60_000),
        itens: [
          { servicoId: muitos.A, precoCentavos: 5000, duracaoMin: 3 },
          { servicoId: muitos.B, precoCentavos: 7000, duracaoMin: 2 },
        ],
      });
    }
    const contador = instalarContadorDeComandos();
    try {
      for (const [cenario, esperadas] of [[um, 1], [muitos, 50]] as const) {
        contador.reiniciar();
        const { reservas } = await repos().agenda.listarAgenda(cenario.ctxEquipe, { periodo, profissionalId: null, limite: 200 });
        expect(reservas).toHaveLength(esperadas);
        expect(contador.contar()).toBe(1);
      }
      contador.reiniciar();
      await repos().agenda.detalhe(muitos.ctxEquipe, ultimo, null);
      expect(contador.contar()).toBe(1);
      contador.reiniciar();
      await repos().agenda.detalhe(um.ctxEquipe, idUm, null);
      expect(contador.contar()).toBe(1);
      contador.reiniciar();
      await repos().agenda.listarJornadas(muitos.ctxEquipe, null);
      expect(contador.contar()).toBe(1);
    } finally {
      await contador.encerrar();
    }
  });
});

describe('plano (R-2): índice de reserva, sem varrer o histórico', () => {
  it('com 60.000 reservas num salão, o dia e a semana usam Index Scan e nunca Seq Scan em reserva', async () => {
    const s = await criarSalaoCompleto();
    const salaoId = s.salaoId;
    await c.query('DELETE FROM reserva_item WHERE salao_id = $1', [salaoId]);
    await c.query('DELETE FROM reserva WHERE salao_id = $1', [salaoId]);
    // 2.000 clientes (um salão real não tem uma cliente só): o plano não pode depender de uma única.
    const { rows: cl } = await c.query<{ id: string }>(
      `INSERT INTO cliente (salao_id, nome, telefone_e164)
       SELECT $1::uuid, 'Cliente ' || g, '+55119' || lpad(g::text, 8, '0') FROM generate_series(1, 2000) g RETURNING id::text AS id`,
      [salaoId],
    );
    const clientes = cl.map((x) => x.id);
    const profissionais = [s.profissional.profissionalId];
    for (let k = 1; k < 10; k++) {
      const { rows } = await c.query<{ id: string }>('INSERT INTO profissional (salao_id, nome) VALUES ($1, $2) RETURNING id::text AS id', [salaoId, `P${k}`]);
      profissionais.push(rows[0].id);
    }
    // 6.000 reservas de 30 min por profissional, a cada 7 h (~4,8 anos), sem sobreposição.
    await c.query(
      `INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
       SELECT $1::uuid, p, ($2::uuid[])[1 + g % 2000], t, t + interval '30 minutes', t + interval '30 minutes',
              (CASE WHEN g % 10 = 0 THEN 'cancelado' ELSE 'concluido' END)::status_reserva, 'equipe'
         FROM unnest($3::uuid[]) AS p
         CROSS JOIN generate_series(0, 5999) AS g
         CROSS JOIN LATERAL (SELECT '2024-01-01T00:00:00Z'::timestamptz + g * interval '7 hours' AS t) AS x`,
      [salaoId, clientes, profissionais],
    );
    // D-043: uma confirmação por reserva (1 em 10 falhou) e uma remarcação falha vigente em algumas; o EXISTS da
    // grade tem de usar o índice de `mensagem`, nunca varrê-la.
    await c.query(
      `INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao, estado, criado_em, atualizado_em)
       SELECT salao_id, id, 'confirmacao', 0, (CASE WHEN random() < 0.1 THEN 'falhou' ELSE 'enviada' END)::estado_mensagem, now(), now()
         FROM reserva WHERE salao_id = $1`,
      [salaoId],
    );
    await c.query('ANALYZE mensagem');
    await c.query('ANALYZE reserva');
    await c.query('ANALYZE cliente');
    await c.query('ANALYZE profissional');
    const dia = { de: new Date('2026-03-10T03:00:00Z'), ate: new Date('2026-03-11T03:00:00Z') };
    const semana = { de: new Date('2026-03-08T03:00:00Z'), ate: new Date('2026-03-15T03:00:00Z') };
    for (const [nome, per] of [['dia', dia], ['semana', semana]] as const) {
      for (const prof of [null, profissionais[3]]) {
        const sql = consultaAgenda(salaoId, per, prof, 201);
        const { rows } = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS) ${sql.text}`, sql.values as unknown[]);
        const plano = rows.map((l) => l['QUERY PLAN']).join('\n');
        console.info(`[D-028 plano] ${nome} profissional=${prof === null ? 'todos' : 'um'}\n${plano}`);
        expect(plano, `${nome}/${prof}`).toMatch(/(Index|Bitmap Index) Scan using reserva_salao_id_(profissional_id_)?inicio_idx on reserva/);
        // O limite inferior de `inicio` (margem de 7 dias) entra na condição do índice.
        expect(plano, `${nome}/${prof}`).toMatch(/Index Cond: .*\(inicio >= /);
        expect(plano, `${nome}/${prof}`).not.toMatch(/Seq Scan on reserva\b/);
        // D-043: o EXISTS da falha de mensagem usa índice de `mensagem`; nunca Seq Scan nela.
        expect(plano, `${nome}/${prof}`).toMatch(/Index (Only )?Scan using mensagem_\w+ on mensagem/);
        expect(plano, `${nome}/${prof}`).not.toMatch(/Seq Scan on mensagem\b/);
      }
    }
  }, 120_000);
});
