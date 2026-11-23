import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { editar as editarCliente } from '@/server/clientes/servico';
import { desativar } from '@/server/profissionais/servico';
import { criarReserva } from '@/server/reservas/criar-reserva';
import { obterPrisma } from '@/server/repos/db';

import {
  AGORA,
  DIA,
  contarLinhas,
  criarBarreira,
  criarCenarioReserva,
  entradaReserva,
  esperarTrava,
  sp,
} from '../../support/reservas';
import type { CenarioReserva } from '../../support/reservas';
import { conectar, telefoneNovo } from '../../support/sql';

import { item, jornadaDaBia, revalidacao, um } from './apoio-itens';

// D-025 T-6b: CA-2, CA-2b, CA-15; D-050 T-5: CA-17 (10 reservas com um item disputado e outros livres) e
// CA-22 (criação × desativação). A ordem de travas com itens cruzados (CA-18) fica em travas.test.ts. Pool de 16 (POOL_MAX_TESTES). Sem sleep fixo: as esperas de trava são
// observadas em pg_stat_activity (marcadores FOR SHARE OF sa|p|s). A verificação usa a conexão `pg` própria.

let c: pg.Client;
let trava: pg.Client;

beforeAll(async () => {
  c = await conectar();
  trava = await conectar();
});
afterAll(async () => {
  await trava.end();
  await c.end();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

const db = () => obterPrisma();
const enfileirar = async () => ({ criado: true as const, id: 'job' });
const dispara = (cen: CenarioReserva, sobre: Parameters<typeof entradaReserva>[1], deps = {}) =>
  criarReserva(cen.ctxSistema, entradaReserva(cen, sobre), { enfileirar, ...deps });

describe('CA-2: 10 requisições, mesmo telefone, chaves distintas', () => {
  it('1 reserva, 1 cliente nova, 1 conjunto de itens, 1 mensagem; 9 horario_indisponivel; nenhum erro', async () => {
    const cen = await criarCenarioReserva();
    const antes = await contarLinhas(cen.s.salaoId);
    const telefone = telefoneNovo();
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => dispara(cen, { cliente: { nome: 'Ana', telefone }, chaveRequisicao: randomUUID() })),
    );
    expect(rs.filter((r) => r.resultado === 'criada')).toHaveLength(1);
    const outras = rs.filter((r) => r.resultado !== 'criada');
    expect(outras).toHaveLength(9);
    for (const r of outras) {
      // A trava do profissional serializa as criações: a perdedora sempre vê a reserva da vencedora.
      expect(r).toEqual(revalidacao());
    }
    const depois = await contarLinhas(cen.s.salaoId);
    expect(depois).toEqual({ ...antes, reserva: 1, itens: 1, cliente: antes.cliente + 1, consentimento: 1, mensagem: 1 });
  });

  it('mesmo telefone em 10 horários distintos: 1 só cliente, 10 reservas', async () => {
    const cen = await criarCenarioReserva();
    const antes = await contarLinhas(cen.s.salaoId);
    const telefone = telefoneNovo();
    const rs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => dispara(cen, { cliente: { nome: 'Ana', telefone }, ...um(cen, sp(DIA, `${String(9 + i).padStart(2, '0')}:00`)) })),
    );
    expect(rs.map((r) => r.resultado)).toEqual(Array(10).fill('criada'));
    const depois = await contarLinhas(cen.s.salaoId);
    expect(depois).toMatchObject({ reserva: 10, cliente: antes.cliente + 1, mensagem: 10 });
  });
});

describe('CA-2b: 10 telefones distintos, mesmo horário', () => {
  it('sem barreira: 1 criada, 9 perdedoras sem nada persistido', async () => {
    const cen = await criarCenarioReserva();
    const antes = await contarLinhas(cen.s.salaoId);
    const rs = await Promise.all(Array.from({ length: 10 }, () => dispara(cen, {})));
    expect(rs.filter((r) => r.resultado === 'criada')).toHaveLength(1);
    for (const r of rs.filter((x) => x.resultado !== 'criada')) {
      expect(r).toEqual(revalidacao());
    }
    expect(await contarLinhas(cen.s.salaoId)).toEqual({ ...antes, reserva: 1, itens: 1, cliente: antes.cliente + 1, consentimento: 1, mensagem: 1 });
  });

  it('com largada simultânea (barreira ANTES de criarReserva): 1 criada e 9 revalidacao', async () => {
    const cen = await criarCenarioReserva();
    const antes = await contarLinhas(cen.s.salaoId);
    const largada = criarBarreira(10);
    const rs = await Promise.all(
      Array.from({ length: 10 }, async () => {
        await largada();
        return dispara(cen, {});
      }),
    );
    expect(rs.filter((r) => r.resultado === 'criada')).toHaveLength(1);
    expect(rs.filter((r) => r.resultado !== 'criada')).toEqual(Array(9).fill(revalidacao()));
    expect(await contarLinhas(cen.s.salaoId)).toEqual({ ...antes, reserva: 1, itens: 1, cliente: antes.cliente + 1, consentimento: 1, mensagem: 1 });
  });

  it('ramo 23P01: reserva sobreposta confirmada por OUTRA conexão depois da revalidação → horario_indisponivel/23P01', async () => {
    const cen = await criarCenarioReserva();
    const antes = await contarLinhas(cen.s.salaoId);
    const aposRevalidar = async () => {
      // Reserva + item num único comando (outra conexão, autocommit), no mesmo horário da Ana.
      await c.query(
        `WITH r AS (
           INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem)
           SELECT $1, id, $3, $4, 'confirmado', 'equipe' FROM cliente WHERE salao_id = $1 LIMIT 1
           RETURNING id
         )
         INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, inicio, fim, ocupado_ate, status, preco_centavos, duracao_min)
         SELECT $1, r.id, $5, $2, 0, $3, $4, $4, 'confirmado', 5000, 30 FROM r`,
        [cen.s.salaoId, cen.ana, sp(DIA, '10:00'), sp(DIA, '10:30'), cen.A],
      );
    };
    const r = await dispara(cen, {}, { aposRevalidar });
    expect(r).toEqual({ resultado: 'horario_indisponivel', causa: '23P01', itens: [] });
    expect(await contarLinhas(cen.s.salaoId)).toEqual({ ...antes, reserva: 1, itens: 1 });
  });
});

async function segurar<T>(marcador: string, preparar: () => Promise<void>, disparar: () => Promise<T>, liberar: () => Promise<void>): Promise<T> {
  await trava.query('BEGIN');
  try {
    await preparar();
    const p = disparar();
    await esperarTrava(c, marcador, 1);
    await liberar();
    return await p;
  } catch (e) {
    await trava.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

describe('CA-15: travas FOR SHARE × gravações concorrentes', () => {
  it('(c) troca das regras do salão: a revalidação vê o intervalo vigente no commit', async () => {
    const cen = await criarCenarioReserva();
    const r = await segurar(
      'FOR SHARE OF sa',
      async () => {
        await trava.query('SELECT 1 FROM salao WHERE id = $1 FOR NO KEY UPDATE', [cen.s.salaoId]);
        await trava.query('UPDATE salao SET intervalo_min = 20 WHERE id = $1', [cen.s.salaoId]);
      },
      () => dispara(cen, {}),
      async () => {
        await trava.query('COMMIT');
      },
    );
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(r.reserva.itens[0].ocupadoAte).toEqual(new Date(r.reserva.fim.getTime() + 20 * 60_000));
  });

  it('(a) desativação confirmada antes da trava do profissional (FOR NO KEY UPDATE): profissional_indisponivel', async () => {
    const cen = await criarCenarioReserva();
    const r = await segurar(
      'FOR NO KEY UPDATE OF p',
      async () => {
        await trava.query('SELECT 1 FROM profissional WHERE id = $1 FOR UPDATE', [cen.ana]);
        await trava.query('UPDATE profissional SET ativo = false WHERE id = $1', [cen.ana]);
      },
      () => dispara(cen, {}),
      async () => {
        await trava.query('COMMIT');
      },
    );
    expect(r).toEqual({ resultado: 'profissional_indisponivel', itens: [0] });
    expect((await contarLinhas(cen.s.salaoId)).reserva).toBe(0);
  });

  it('(a) reserva × desativação reais em paralelo: nunca reserva em profissional inativo', async () => {
    for (let i = 0; i < 5; i++) {
      const cen = await criarCenarioReserva();
      const [r, d] = await Promise.all([
        dispara(cen, {}),
        desativar(cen.ctxEquipe, { id: cen.ana }, AGORA),
      ]);
      const prof = await db().profissional.findUniqueOrThrow({ where: { id: cen.ana } });
      const reservas = await db().reserva.count({ where: { salaoId: cen.s.salaoId } });
      if (r.resultado === 'criada') {
        expect(d.resultado).toBe('recusado');
        expect(prof.ativo).toBe(true);
        expect(reservas).toBe(1);
      } else {
        expect(r).toEqual({ resultado: 'profissional_indisponivel', itens: [0] });
        expect(d.resultado).toBe('desativado');
        expect(prof.ativo).toBe(false);
        expect(reservas).toBe(0);
      }
    }
  });

  it('mesmo profissional: a segunda criação espera a primeira; profissional distinto não espera', async () => {
    const cen = await criarCenarioReserva();
    await jornadaDaBia(cen);
    await trava.query('BEGIN');
    try {
      // `trava` faz o papel de uma criação em andamento da Ana (FOR NO KEY UPDATE no profissional).
      await trava.query('SELECT 1 FROM profissional WHERE id = $1 FOR NO KEY UPDATE', [cen.ana]);
      const daAna = dispara(cen, {});
      await esperarTrava(c, 'FOR NO KEY UPDATE OF p', 1);
      // A Bia não espera: termina com a trava da Ana ainda aberta.
      const daBia = await dispara(cen, um(cen, sp(DIA, '10:00'), { profissionalId: cen.bia }));
      expect(daBia.resultado).toBe('criada');
      expect((await contarLinhas(cen.s.salaoId)).reserva).toBe(1);
      await trava.query('COMMIT');
      expect((await daAna).resultado).toBe('criada');
    } catch (e) {
      await trava.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
    expect((await contarLinhas(cen.s.salaoId)).reserva).toBe(2);
  });

  it('(b) edição do preço do serviço confirmada antes da trava: o snapshot é o preço novo, coerente', async () => {
    const cen = await criarCenarioReserva();
    const r = await segurar(
      'FOR SHARE OF s',
      async () => {
        await trava.query('SELECT 1 FROM servico WHERE id = $1 FOR NO KEY UPDATE', [cen.A]);
        await trava.query('UPDATE servico SET preco_centavos = 9900, duracao_min = 45 WHERE id = $1', [cen.A]);
      },
      () => dispara(cen, {}),
      async () => {
        await trava.query('COMMIT');
      },
    );
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(r.reserva.itens.map((i) => [i.precoCentavos, i.duracaoMin])).toEqual([[9900, 45]]);
    const item = await db().reservaItem.findFirstOrThrow({ where: { salaoId: cen.s.salaoId } });
    expect([item.precoCentavos, item.duracaoMin]).toEqual([9900, 45]);
    expect(r.reserva.fim).toEqual(sp(DIA, '10:45'));
  });

  it('(b) vínculo removido por edição confirmada durante a espera: profissional_indisponivel (snapshot novo)', async () => {
    const cen = await criarCenarioReserva();
    const r = await segurar(
      'FOR SHARE OF s',
      async () => {
        await trava.query('SELECT 1 FROM servico WHERE id = $1 FOR NO KEY UPDATE', [cen.A]);
        await trava.query('DELETE FROM servico_profissional WHERE servico_id = $1 AND profissional_id = $2', [cen.A, cen.ana]);
      },
      () => dispara(cen, {}),
      async () => {
        await trava.query('COMMIT');
      },
    );
    expect(r).toEqual({ resultado: 'profissional_indisponivel', itens: [0] });
  });

  it('(d) reserva × edição de telefone da mesma cliente: sem erro, sem impasse', async () => {
    for (let i = 0; i < 5; i++) {
      const cen = await criarCenarioReserva();
      const telefone = telefoneNovo();
      const cliente = await db().cliente.create({ data: { salaoId: cen.s.salaoId, nome: 'Bia', telefoneE164: telefone }, select: { id: true } });
      const [r, e] = await Promise.all([
        dispara(cen, { cliente: { nome: 'Bia', telefone } }),
        editarCliente(cen.ctxEquipe, { id: cliente.id, nome: 'Bia', telefone: telefoneNovo() }),
      ]);
      expect(r.resultado).toBe('criada');
      expect(e.resultado).toBe('ok');
    }
  });

  it('(e) duas reservas da mesma cliente em horários diferentes, em paralelo: ambas criadas, 1 cliente', async () => {
    const cen = await criarCenarioReserva();
    const antes = await contarLinhas(cen.s.salaoId);
    const telefone = telefoneNovo();
    const rs = await Promise.all([
      dispara(cen, { cliente: { nome: 'Ana', telefone }, ...um(cen, sp(DIA, '10:00')) }),
      dispara(cen, { cliente: { nome: 'Ana', telefone }, ...um(cen, sp(DIA, '14:00')) }),
    ]);
    expect(rs.map((r) => r.resultado)).toEqual(['criada', 'criada']);
    expect(await contarLinhas(cen.s.salaoId)).toMatchObject({ reserva: 2, cliente: antes.cliente + 1 });
  });
});

describe('D-050 CA-17: 10 reservas diferentes com um item no mesmo profissional e horário', () => {
  it('1 criada; 9 horario_indisponivel no item disputado, sem item gravado; sem 23505, 40P01 nem erro', async () => {
    const cen = await criarCenarioReserva({ jornada: [['00:00', '24:00']] });
    await jornadaDaBia(cen, [['00:00', '24:00']]);
    const antes = await contarLinhas(cen.s.salaoId);
    // Cada reserva: A com a Bia em um horário livre próprio (item 0) + B com a Ana às 12:00 (item 1, disputado).
    const rs = await Promise.allSettled(
      Array.from({ length: 10 }, (_, k) =>
        dispara(cen, {
          chaveRequisicao: randomUUID(),
          itens: [item(cen, sp(DIA, `${String(13 + k).padStart(2, '0')}:00`), { profissionalId: cen.bia }), item(cen, sp(DIA, '12:00'), { servicoId: cen.B })],
        }),
      ),
    );
    expect(rs.filter((r) => r.status === 'rejected')).toEqual([]);
    const valores = rs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    expect(valores.filter((r) => r.resultado === 'criada')).toHaveLength(1);
    expect(valores.filter((r) => r.resultado !== 'criada')).toEqual(Array(9).fill(revalidacao(1)));
    expect(await contarLinhas(cen.s.salaoId)).toEqual({ ...antes, reserva: 1, itens: 2, cliente: antes.cliente + 1, consentimento: 1, mensagem: 1 });
  });
});

describe('D-050 CA-22: criação com item em P1 × desativação de P1, em paralelo', () => {
  it('ou a reserva (2 itens, P1 num deles) é criada e a desativação recusada, ou a desativação ocorre e a reserva é profissional_indisponivel', async () => {
    for (let i = 0; i < 5; i++) {
      const cen = await criarCenarioReserva();
      await jornadaDaBia(cen);
      const [r, d] = await Promise.all([
        dispara(cen, { itens: [item(cen, sp(DIA, '10:00'), { profissionalId: cen.bia }), item(cen, sp(DIA, '11:00'), { servicoId: cen.B })] }),
        desativar(cen.ctxEquipe, { id: cen.ana }, AGORA),
      ]);
      const reservas = await db().reserva.count({ where: { salaoId: cen.s.salaoId } });
      if (r.resultado === 'criada') {
        expect(d.resultado).toBe('recusado');
        expect(reservas).toBe(1);
      } else {
        expect(r).toEqual({ resultado: 'profissional_indisponivel', itens: [1] });
        expect(d.resultado).toBe('desativado');
        expect(reservas).toBe(0);
        expect(await db().reservaItem.count({ where: { salaoId: cen.s.salaoId } })).toBe(0);
      }
    }
  });
});
