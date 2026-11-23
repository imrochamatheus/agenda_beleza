import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consultaAgenda, criarRepoAgenda } from '@/server/repos/agenda';
import { obterPrisma } from '@/server/repos/db';
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
  hora,
  inserirCliente,
  reservar,
  reservarComItens,
} from './apoio';

// D-028 T-2 / D-050 T-7: repositório da agenda por item (CA-6, CA-11, CA-12, CA-13, CA-16; D-050 CA-32..CA-35,
// M-2) e o plano com índice de reserva_item.

let c: pg.Client;
let ce: CenarioReserva;
const periodo = { de: hora('00:00'), ate: hora('00:00', 1) };

beforeAll(async () => {
  c = await conectar();
  ce = await criarCenario();
});
afterAll(async () => {
  await c.end();
});

const listar = (cx: CenarioReserva, extra: Partial<{ profissionalId: string | null; limite: number; comPosicao: boolean; periodo: { de: Date; ate: Date } }> = {}) =>
  repos().agenda.listarAgenda(cx.ctxEquipe, { periodo, profissionalId: null, limite: 200, comPosicao: true, ...extra });

/** Serviço extra no salão do cenário, executado por Ana e Bia (a UNIQUE (reserva, serviço) pede serviços distintos). */
async function criarServicoExtra(s: CenarioReserva, nome: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "INSERT INTO servico (salao_id, nome, preco_centavos, duracao_min) VALUES ($1, $2, 3000, 30) RETURNING id::text AS id",
    [s.s.salaoId, nome],
  );
  return rows[0].id;
}

describe('listarAgenda (D-050: um bloco por item)', () => {
  it('todos os status, por início e id, um bloco por item com serviço e snapshot; sem telefone no DTO', async () => {
    const cli = await inserirCliente(c, ce.s.salaoId, 'Maria Souza', '+5511912340001');
    const ids: Record<string, { reservaId: string; itemIds: string[] }> = {};
    for (const [i, status] of (['confirmado', 'cancelado', 'concluido', 'nao_compareceu'] as const).entries()) {
      ids[status] = await reservarComItens(c, ce, {
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
    const { blocos, truncada } = await listar(ce);
    expect(truncada).toBe(false);
    expect(blocos.map((b) => [b.reservaId, b.itemId, b.status, b.servicoNome])).toEqual(
      (['confirmado', 'cancelado', 'concluido', 'nao_compareceu'] as const).flatMap((st) => [
        [ids[st].reservaId, ids[st].itemIds[0], st, 'A'],
        [ids[st].reservaId, ids[st].itemIds[1], st, 'B'],
      ]),
    );
    expect(blocos[1]).toMatchObject({
      profissionalId: ce.ana,
      clienteNome: 'Maria Souza',
      clienteAnonimizada: false,
      origem: 'equipe',
      encaixe: false,
      servicoNome: 'B',
      precoCentavos: 7000,
      duracaoMin: 30,
      inicio: hora('09:30'),
      fim: hora('10:00'),
      temFalhaDeMensagem: false,
      posicao: { n: 2, de: 2 },
    });
    expect(JSON.stringify(blocos)).not.toContain('+5511912340001');
    expect(Object.keys(blocos[0]).join()).not.toMatch(/telefone/i);
  });

  it('o item é o snapshot: mudar o preço do serviço depois não altera o bloco (CA-5)', async () => {
    const s = await criarCenario();
    const { itemIds } = await reservarComItens(c, s, { profissionalId: s.ana, inicio: hora('10:00'), itens: [{ servicoId: s.A, precoCentavos: 5000, duracaoMin: 60 }] });
    await c.query('UPDATE servico SET preco_centavos = 9999, duracao_min = 10 WHERE id = $1', [s.A]);
    const { blocos } = await listar(s, { limite: 10 });
    expect(blocos.find((b) => b.itemId === itemIds[0])).toMatchObject({ precoCentavos: 5000, duracaoMin: 60 });
  });

  it('anonimizada: nome null e clienteAnonimizada (CA-5)', async () => {
    const s = await criarCenario();
    const cli = await inserirCliente(c, s.s.salaoId, 'Será Removida');
    await reservar(c, s, { profissionalId: s.ana, inicio: hora('10:00'), clienteId: cli });
    await anonimizarPorSql(c, cli);
    const { blocos } = await listar(s, { limite: 10 });
    expect(blocos).toHaveLength(1);
    expect(blocos[0]).toMatchObject({ clienteNome: null, clienteAnonimizada: true, servicoNome: 'A' });
  });

  it('sobreposição ao período: cruza a meia-noite nos dois dias; encostar na fronteira não conta (CA-13)', async () => {
    const s = await criarCenario();
    const id = await reservar(c, s, { profissionalId: s.ana, inicio: hora('23:00'), fim: hora('01:00', 1) });
    const antes = await reservar(c, s, { profissionalId: s.ana, inicio: hora('22:00', -1), fim: hora('00:00') });
    const depois = await reservar(c, s, { profissionalId: s.ana, inicio: hora('00:00', 1), fim: hora('01:00', 1), status: 'cancelado' });
    const dia = (n: number) => ({ de: hora('00:00', n), ate: hora('00:00', n + 1) });
    const ids = async (n: number) => (await listar(s, { periodo: dia(n), limite: 10 })).blocos.map((b) => b.reservaId);
    expect(await ids(0)).toEqual([id]);
    expect(await ids(1)).toEqual([id, depois]);
    expect(await ids(-1)).toEqual([antes]);
  });

  it('M-2: item de 1440 min que começa 1 dia antes do período ainda aparece (margem de 1 dia exata)', async () => {
    const s = await criarCenario();
    // [00:30 do dia anterior, 00:30 de hoje): cruza o início do dia de hoje.
    const id = await reservar(c, s, { profissionalId: s.ana, inicio: hora('00:30', -1), fim: hora('00:30') });
    expect((await listar(s, { limite: 10 })).blocos.map((b) => b.reservaId)).toEqual([id]);
  });

  it('item de outro profissional aparece na coluna dele: o bloco carrega o profissional DO ITEM (RN-36)', async () => {
    const s = await criarCenario();
    const { reservaId, itemIds } = await reservarComItens(c, s, {
      profissionalId: s.ana,
      inicio: hora('10:00'),
      itens: [
        { servicoId: s.A, precoCentavos: 5000, duracaoMin: 30, profissionalId: s.bia },
        { servicoId: s.B, precoCentavos: 7000, duracaoMin: 45 },
      ],
    });
    const { blocos } = await listar(s, { limite: 10 });
    expect(blocos.map((b) => [b.itemId, b.profissionalId, b.reservaId])).toEqual([
      [itemIds[0], s.bia, reservaId],
      [itemIds[1], s.ana, reservaId],
    ]);
    const daAna = await listar(s, { profissionalId: s.ana, limite: 10 });
    expect(daAna.blocos.map((b) => b.itemId)).toEqual([itemIds[1]]);
  });

  it('posição "n de N": só entre itens não cancelados, por (inicio, id); null sem comPosicao, com 1 item ou no cancelado', async () => {
    const s = await criarCenario();
    const C = await criarServicoExtra(s, 'C');
    const tres = await reservarComItens(c, s, {
      profissionalId: s.ana,
      inicio: hora('09:00'),
      itens: [
        { servicoId: s.A, precoCentavos: 5000, duracaoMin: 30 },
        { servicoId: s.B, precoCentavos: 7000, duracaoMin: 30, status: 'cancelado' },
        { servicoId: C, precoCentavos: 3000, duracaoMin: 30, profissionalId: s.bia },
      ],
    });
    const um = await reservarComItens(c, s, { profissionalId: s.ana, inicio: hora('14:00') });
    const pos = (bl: { itemId: string; posicao: unknown }[]) => Object.fromEntries(bl.map((b) => [b.itemId, b.posicao]));
    const comGestor = pos((await listar(s, { limite: 10 })).blocos);
    expect(comGestor).toEqual({
      [tres.itemIds[0]]: { n: 1, de: 2 },
      [tres.itemIds[1]]: null,
      [tres.itemIds[2]]: { n: 2, de: 2 },
      [um.itemIds[0]]: null,
    });
    // Filtro do gestor por profissional: a contagem continua sobre a reserva inteira.
    expect(pos((await listar(s, { profissionalId: s.bia, limite: 10 })).blocos)).toEqual({ [tres.itemIds[2]]: { n: 2, de: 2 } });
    const sem = (await listar(s, { limite: 10, comPosicao: false })).blocos;
    expect(sem).toHaveLength(4);
    expect(sem.every((b) => b.posicao === null)).toBe(true);
  });

  it('profissional inativo: o bloco continua listado (CA-6)', async () => {
    const s = await criarCenario();
    const id = await reservar(c, s, { profissionalId: s.bia, inicio: hora('10:00'), status: 'concluido' });
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [s.bia]);
    const { blocos } = await listar(s, { limite: 10 });
    expect(blocos).toMatchObject([{ reservaId: id, profissionalId: s.bia, status: 'concluido' }]);
  });

  it('filtro por profissional; id malformado → NaoEncontrado sem consultar; limite inválido → RangeError', async () => {
    const s = await criarCenario();
    await reservar(c, s, { profissionalId: s.ana, inicio: hora('10:00') });
    const b = await reservar(c, s, { profissionalId: s.bia, inicio: hora('11:00') });
    const so = await listar(s, { profissionalId: s.bia, limite: 10 });
    expect(so.blocos.map((x) => x.reservaId)).toEqual([b]);
    await expect(listar(s, { profissionalId: 'x', limite: 10 })).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(listar(s, { limite: 0 })).rejects.toBeInstanceOf(RangeError);
  });

  it('limite conta ITENS: devolve até `limite` e marca truncada', async () => {
    const s = await criarCenario();
    const cli = await inserirCliente(c, s.s.salaoId, 'Muitas');
    // 5 reservas × 5 itens (serviços distintos) = 25 itens de 1 min, cancelados (sem exclusion).
    const servicos = [s.A, s.B];
    for (const n of ['C', 'D', 'E']) servicos.push(await criarServicoExtra(s, n));
    for (let r = 0; r < 5; r++) {
      await reservarComItens(c, s, {
        profissionalId: s.ana,
        inicio: new Date(hora('08:00').getTime() + r * 5 * 60_000),
        clienteId: cli,
        status: 'cancelado',
        itens: servicos.map((servicoId) => ({ servicoId, precoCentavos: 100, duracaoMin: 1 })),
      });
    }
    const dez = await listar(s, { limite: 10 });
    expect(dez.blocos).toHaveLength(10);
    expect(dez.truncada).toBe(true);
    const todas = await listar(s, { limite: 25 });
    expect(todas.blocos).toHaveLength(25);
    expect(todas.truncada).toBe(false);
  });
});

describe('detalhe (D-050: itens por reserva; profissional só os próprios)', () => {
  it('uma reserva do salão; ids estranhos → NaoEncontrado', async () => {
    const s = await criarCenario();
    const id = await reservar(c, s, { profissionalId: s.ana, inicio: hora('10:00') });
    expect(await repos().agenda.detalhe(s.ctxEquipe, id, null)).toMatchObject({ id, itens: [{ profissionalNome: 'Ana' }] });
    expect(await repos().agenda.detalhe(s.ctxEquipe, id, s.ana)).toMatchObject({ id });
    await expect(repos().agenda.detalhe(s.ctxEquipe, id, s.bia)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().agenda.detalhe(s.ctxEquipe, UUID_INEXISTENTE, null)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().agenda.detalhe(s.ctxEquipe, 'x', null)).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().agenda.detalhe(s.ctxEquipe, id, 'x')).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(repos().agenda.detalhe(s.ctxEquipe, 7, null)).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('gestor: todos os itens por (inicio, id) com instantes exatos; profissional: só os próprios (CA-33)', async () => {
    const s = await criarCenario();
    const C = await criarServicoExtra(s, 'C');
    const { reservaId, itemIds } = await reservarComItens(c, s, {
      profissionalId: s.ana,
      inicio: hora('09:00'),
      itens: [
        { servicoId: C, precoCentavos: 4000, duracaoMin: 45, inicio: hora('15:00'), encaixe: true },
        { servicoId: s.A, precoCentavos: 5000, duracaoMin: 60, inicio: hora('09:00') },
        { servicoId: s.B, precoCentavos: 7500, duracaoMin: 40, inicio: hora('10:00'), profissionalId: s.bia, status: 'cancelado' },
      ],
    });
    const g = await repos().agenda.detalhe(s.ctxEquipe, reservaId, null);
    expect(g).toMatchObject({ status: 'confirmado', origem: 'equipe', inicio: hora('09:00'), fim: hora('15:45') });
    expect(g.itens).toEqual([
      { id: itemIds[1], servicoId: s.A, servicoNome: 'A', profissionalId: s.ana, profissionalNome: 'Ana', profissionalAtivo: true, inicio: hora('09:00'), fim: hora('10:00'), status: 'confirmado', encaixe: false, precoCentavos: 5000, duracaoMin: 60 },
      { id: itemIds[2], servicoId: s.B, servicoNome: 'B', profissionalId: s.bia, profissionalNome: 'Bia', profissionalAtivo: true, inicio: hora('10:00'), fim: hora('10:40'), status: 'cancelado', encaixe: false, precoCentavos: 7500, duracaoMin: 40 },
      { id: itemIds[0], servicoId: C, servicoNome: 'C', profissionalId: s.ana, profissionalNome: 'Ana', profissionalAtivo: true, inicio: hora('15:00'), fim: hora('15:45'), status: 'confirmado', encaixe: true, precoCentavos: 4000, duracaoMin: 45 },
    ]);
    const daBia = await repos().agenda.detalhe(s.ctxEquipe, reservaId, s.bia);
    expect(daBia.itens.map((i) => i.id)).toEqual([itemIds[2]]);
    expect(JSON.stringify(daBia)).not.toMatch(new RegExp(`${itemIds[0]}|${itemIds[1]}|"C"|4000|5000`));
    const daAna = await repos().agenda.detalhe(s.ctxEquipe, reservaId, s.ana);
    expect(daAna.itens.map((i) => i.id)).toEqual([itemIds[1], itemIds[0]]);
  });

  it('o instante dos itens não depende do TimeZone da sessão do banco', async () => {
    const s = await criarCenario();
    const { reservaId } = await reservarComItens(c, s, { profissionalId: s.ana, inicio: new Date('2026-12-01T12:34:00Z') });
    const d = await obterPrisma().$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'Asia/Kathmandu'`);
      return criarRepoAgenda(tx).detalhe(s.ctxEquipe, reservaId, null);
    });
    expect(d.itens[0].inicio).toEqual(new Date('2026-12-01T12:34:00Z'));
    expect(d.itens[0].fim).toEqual(new Date('2026-12-01T13:34:00Z'));
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

describe('CA-16 / D-050 CA-34: uma instrução por chamada, qualquer volume', () => {
  it('1 e 50 reservas de 2 itens (clientes distintos), com e sem posição: 1 instrução em listarAgenda e 1 em detalhe', async () => {
    const um = await criarCenario();
    const muitos = await criarCenario();
    const idUm = await reservar(c, um, { profissionalId: um.ana, inicio: hora('10:00') });
    let ultimo = '';
    for (let i = 0; i < 50; i++) {
      ultimo = await reservar(c, muitos, {
        profissionalId: i % 2 === 0 ? muitos.ana : muitos.bia,
        inicio: new Date(hora('08:00').getTime() + i * 10 * 60_000),
        itens: [
          { servicoId: muitos.A, precoCentavos: 5000, duracaoMin: 3 },
          { servicoId: muitos.B, precoCentavos: 7000, duracaoMin: 2, profissionalId: i % 2 === 0 ? muitos.bia : muitos.ana },
        ],
      });
    }
    const contador = instalarContadorDeComandos();
    try {
      for (const [cenario, esperadas] of [[um, 1], [muitos, 100]] as const) {
        for (const comPosicao of [true, false]) {
          contador.reiniciar();
          const { blocos } = await listar(cenario, { comPosicao });
          expect(blocos).toHaveLength(esperadas);
          expect(contador.contar()).toBe(1);
        }
      }
      for (const [cenario, id, prof] of [[muitos, ultimo, null], [um, idUm, null], [muitos, ultimo, muitos.ana]] as const) {
        contador.reiniciar();
        await repos().agenda.detalhe(cenario.ctxEquipe, id, prof);
        expect(contador.contar()).toBe(1);
      }
      contador.reiniciar();
      await repos().agenda.listarJornadas(muitos.ctxEquipe, null);
      expect(contador.contar()).toBe(1);
    } finally {
      await contador.encerrar();
    }
  });
});

describe('plano (R-2; D-050 R-5/Q4/Q7): índice de reserva_item, sem varrer o histórico', () => {
  it('com 60.000 itens num salão, o dia e a semana usam o índice de agenda de reserva_item e nunca Seq Scan', async () => {
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
    // 6.000 itens de 30 min por profissional, a cada 7 h (~4,8 anos), um por reserva, sem sobreposição.
    await c.query(
      `WITH d AS (
         SELECT gen_random_uuid() AS id, p, g, x.t,
                (CASE WHEN g % 10 = 0 THEN 'cancelado' ELSE 'concluido' END)::status_reserva AS st
           FROM unnest($3::uuid[]) AS p
           CROSS JOIN generate_series(0, 5999) AS g
           CROSS JOIN LATERAL (SELECT '2024-01-01T00:00:00Z'::timestamptz + g * interval '7 hours' AS t) AS x
       ), r AS (
         INSERT INTO reserva (id, salao_id, cliente_id, inicio, fim, status, origem, cancelada_em)
         SELECT id, $1::uuid, ($2::uuid[])[1 + g % 2000], t, t + interval '30 minutes', st, 'equipe',
                CASE WHEN st = 'cancelado' THEN t END
           FROM d
       )
       INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, preco_centavos, duracao_min,
                                 inicio, fim, ocupado_ate, status)
       SELECT $1::uuid, id, $4::uuid, p, 0, 5000, 30, t, t + interval '30 minutes', t + interval '30 minutes', st FROM d`,
      [salaoId, clientes, profissionais, s.servicos.ativos[0]],
    );
    // D-043: uma confirmação por reserva (1 em 10 falhou); o EXISTS da grade usa o índice de `mensagem`.
    await c.query(
      `INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao, estado, criado_em, atualizado_em)
       SELECT salao_id, id, 'confirmacao', 0, (CASE WHEN random() < 0.1 THEN 'falhou' ELSE 'enviada' END)::estado_mensagem, now(), now()
         FROM reserva WHERE salao_id = $1`,
      [salaoId],
    );
    for (const t of ['mensagem', 'reserva', 'reserva_item', 'cliente', 'profissional', 'servico']) await c.query(`ANALYZE ${t}`);
    const dia = { de: new Date('2026-03-10T03:00:00Z'), ate: new Date('2026-03-11T03:00:00Z') };
    const semana = { de: new Date('2026-03-08T03:00:00Z'), ate: new Date('2026-03-15T03:00:00Z') };
    for (const [nome, per] of [['dia', dia], ['semana', semana]] as const) {
      for (const prof of [null, profissionais[3]]) {
        for (const comPosicao of [true, false]) {
          const sql = consultaAgenda(salaoId, per, prof, 201, comPosicao);
          const { rows } = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS) ${sql.text}`, sql.values as unknown[]);
          const plano = rows.map((l) => l['QUERY PLAN']).join('\n');
          const rotulo = `${nome}/${prof === null ? 'todos' : 'um'}/posicao=${comPosicao}`;
          console.info(`[D-050 plano agenda] ${rotulo}\n${plano}`);
          expect(plano, rotulo).toMatch(/(Index|Bitmap Index) Scan (using|on) reserva_item_salao_id_(profissional_id_)?inicio_idx/);
          // O limite inferior de `inicio` (margem de 1 dia, M-2) entra na condição do índice.
          expect(plano, rotulo).toMatch(/Index Cond: .*\(inicio >= /);
          expect(plano, rotulo).not.toMatch(/Seq Scan on reserva_item\b/);
          expect(plano, rotulo).not.toMatch(/Seq Scan on reserva\b/);
          // D-043 + PREDICADO_VIGENTE: o EXISTS da falha usa índice de `mensagem`; nunca Seq Scan nela.
          expect(plano, rotulo).toMatch(/(Index (Only )?Scan using|Bitmap Index Scan on) mensagem_\w+/);
          expect(plano, rotulo).not.toMatch(/Seq Scan on mensagem\b/);
        }
      }
    }
    // O resultado no volume: 7 dias / 7 h = 24 itens por profissional na semana, 10 profissionais = 240 > 201.
    const sql = consultaAgenda(salaoId, semana, null, 201, true);
    const { rows: semanaToda } = await c.query<{ profissional_id: string }>(sql.text, sql.values as unknown[]);
    expect(semanaToda).toHaveLength(201);
  }, 180_000);
});
